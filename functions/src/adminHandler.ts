import {
  DEFAULT_REMODERATE_MATERIAL_EDITS,
  DEFAULT_REQUIRE_PRE_APPROVAL,
  LISTING_LIFESPAN_MS,
  NEW_EMPLOYER_MAX_ACTIVE_GIGS,
  type GigStatus
} from './types.js';
import {
  ListingHandlerError,
  resolveModerationPolicy,
  type AuditRecordInput,
  type StoredEmployerProfile,
  type StoredGig,
  type StoredModerationSettings
} from './listingHandler.js';
import { parseExpiresAtMs } from './contactHandler.js';

export const ADMIN_EMAIL = 'cherouri@gmail.com';
export const MAX_ADMIN_QUOTA = 50;

export type AdminAction =
  | 'approveGig'
  | 'hideGig'
  | 'removeGig'
  | 'restoreGig'
  | 'suspendEmployer'
  | 'reinstateEmployer'
  | 'setEmployerQuota'
  | 'updateModerationSettings';

export interface AdminTxContext {
  getGig(gigId: string): Promise<StoredGig | null>;
  updateGig(gigId: string, patch: Partial<Omit<StoredGig, 'id'>>): void;
  getEmployer(uid: string): Promise<StoredEmployerProfile | null>;
  setEmployer(uid: string, data: StoredEmployerProfile): void;
  listEmployerGigs(uid: string): Promise<StoredGig[]>;
  getModerationSettings(): Promise<StoredModerationSettings | null>;
  setModerationSettings(data: {
    requirePreApproval: boolean;
    remoderateMaterialEdits: boolean;
    remoderateMaterialEditsWhenEnabled: boolean;
    updatedAt: number;
    updatedBy: string;
  }): void;
  writeAuditLog(entry: AuditRecordInput): void;
}

export interface AdminStore {
  runTransaction<T>(fn: (tx: AdminTxContext) => Promise<T>): Promise<T>;
}

export interface AdminCallRequest {
  authUid: string | null;
  authEmail: string | null;
  authEmailVerified: boolean;
  hasAppCheck: boolean;
  payload: unknown;
  nowMs?: number;
}

export interface AdminMutationResult {
  ok: true;
  action: AdminAction;
  targetId: string;
  status?: GigStatus;
  requirePreApproval?: boolean;
  remoderateMaterialEdits?: boolean;
  hiddenActiveCount?: number;
}

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function assertVerifiedAdmin(req: AdminCallRequest): string {
  if (!req.hasAppCheck) {
    throw new ListingHandlerError('failed-precondition', 'App Check verification required.');
  }
  if (!req.authUid || req.authEmail !== ADMIN_EMAIL || req.authEmailVerified !== true) {
    throw new ListingHandlerError('permission-denied', 'Verified administrator access required.');
  }
  return req.authUid;
}

function requireReason(raw: unknown): string {
  const reason = typeof raw === 'string' ? raw.trim() : '';
  if (reason.length < 3 || reason.length > 300) {
    throw new ListingHandlerError(
      'invalid-argument',
      'A moderation or administrative reason (3–300 chars) is required.'
    );
  }
  return reason;
}

function countActiveOrPending(gigs: readonly StoredGig[]): number {
  let n = 0;
  for (const g of gigs) {
    if (g.status === 'active' || g.status === 'pending') n += 1;
  }
  return n;
}

export async function handleAdminManageMarketplace(
  store: AdminStore,
  req: AdminCallRequest
): Promise<AdminMutationResult> {
  const adminUid = assertVerifiedAdmin(req);
  if (!req.payload || typeof req.payload !== 'object' || Array.isArray(req.payload)) {
    throw new ListingHandlerError('invalid-argument', 'Invalid admin payload.');
  }
  const input = req.payload as Record<string, unknown>;
  const action = input.action as AdminAction;
  const nowMs = req.nowMs ?? Date.now();

  if (action === 'updateModerationSettings') {
    if (typeof input.requirePreApproval !== 'boolean') {
      throw new ListingHandlerError('invalid-argument', 'requirePreApproval must be a boolean.');
    }
    const remoderate =
      input.remoderateMaterialEdits === undefined
        ? DEFAULT_REMODERATE_MATERIAL_EDITS
        : input.remoderateMaterialEdits;
    if (typeof remoderate !== 'boolean') {
      throw new ListingHandlerError('invalid-argument', 'remoderateMaterialEdits must be a boolean.');
    }

    return store.runTransaction(async (tx) => {
      const beforeRaw = await tx.getModerationSettings();
      const before = resolveModerationPolicy(beforeRaw);

      // Non-retroactive: NEVER modifies existing active or pending advertisements!
      // Existing pending ads remain in the pending queue for explicit admin review even when toggled OFF.
      tx.setModerationSettings({
        requirePreApproval: input.requirePreApproval as boolean,
        remoderateMaterialEdits: remoderate,
        remoderateMaterialEditsWhenEnabled: remoderate,
        updatedAt: nowMs,
        updatedBy: adminUid
      });

      tx.writeAuditLog({
        actorUid: adminUid,
        actorRole: 'admin',
        action: 'moderation_settings_change',
        targetType: 'settings',
        targetId: 'marketplace',
        reason: typeof input.reason === 'string' ? input.reason.trim().slice(0, 300) : undefined,
        metadata: {
          before: {
            requirePreApproval: before.requirePreApproval,
            remoderateMaterialEdits: before.remoderateMaterialEdits
          },
          after: {
            requirePreApproval: input.requirePreApproval,
            remoderateMaterialEdits: remoderate
          }
        },
        nowMs
      });

      return {
        ok: true,
        action,
        targetId: 'marketplace',
        requirePreApproval: input.requirePreApproval as boolean,
        remoderateMaterialEdits: remoderate
      };
    });
  }

  if (
    action === 'approveGig' ||
    action === 'hideGig' ||
    action === 'removeGig' ||
    action === 'restoreGig'
  ) {
    const gigId = typeof input.gigId === 'string' ? input.gigId.trim() : '';
    if (!ID_RE.test(gigId)) {
      throw new ListingHandlerError('invalid-argument', 'Invalid gigId.');
    }
    const reason =
      action === 'hideGig' || action === 'removeGig'
        ? requireReason(input.reason)
        : typeof input.reason === 'string'
          ? input.reason.trim().slice(0, 300)
          : undefined;

    return store.runTransaction(async (tx) => {
      const gig = await tx.getGig(gigId);
      if (!gig) {
        throw new ListingHandlerError('not-found', 'Advertisement not found.');
      }

      const employer =
        gig.posterUid && gig.posterUid !== 'sample'
          ? await tx.getEmployer(gig.posterUid)
          : null;
      const employerGigs = employer ? await tx.listEmployerGigs(employer.uid) : [];
      const currentQuotaUsed = countActiveOrPending(employerGigs);

      if (action === 'approveGig' || action === 'restoreGig') {
        if (action === 'approveGig' && gig.status !== 'pending') {
          throw new ListingHandlerError('failed-precondition', 'Only pending ads can be approved.');
        }
        if (action === 'restoreGig' && gig.status !== 'hidden' && gig.status !== 'removed') {
          throw new ListingHandlerError(
            'failed-precondition',
            'Only hidden or removed ads can be restored.'
          );
        }
        if (employer?.suspended) {
          throw new ListingHandlerError(
            'failed-precondition',
            'Cannot activate advertisement for a suspended employer.'
          );
        }
        if (action === 'restoreGig' && employer && currentQuotaUsed >= employer.maxActiveGigs) {
          throw new ListingHandlerError(
            'resource-exhausted',
            `Cannot restore advertisement: employer is already at quota (${currentQuotaUsed}/${employer.maxActiveGigs}). Increase quota first if intended.`
          );
        }

        // Pending ads receive their 30-day expiration when actually approved and activated.
        const existingExpMs = parseExpiresAtMs(gig.expiresAt);
        const nextExpiresAtMs =
          action === 'approveGig' || existingExpMs === null || existingExpMs <= nowMs
            ? nowMs + LISTING_LIFESPAN_MS
            : existingExpMs;

        tx.updateGig(gigId, {
          status: 'active',
          flags: 0,
          expiresAt: nextExpiresAtMs,
          moderationReason: '',
          updatedAt: nowMs
        });

        if (employer) {
          const delta = gig.status === 'pending' ? 0 : 1;
          tx.setEmployer(employer.uid, {
            ...employer,
            activeCount: currentQuotaUsed + delta,
            updatedAt: nowMs
          });
        }

        tx.writeAuditLog({
          actorUid: adminUid,
          actorRole: 'admin',
          action: 'approve',
          targetType: 'gig',
          targetId: gigId,
          reason,
          metadata: { previousStatus: gig.status, nextStatus: 'active', nextExpiresAtMs },
          nowMs
        });

        return { ok: true, action, targetId: gigId, status: 'active' };
      }

      // hideGig or removeGig
      const nextStatus: GigStatus = action === 'hideGig' ? 'hidden' : 'removed';
      const wasCounted = gig.status === 'active' || gig.status === 'pending';

      tx.updateGig(gigId, {
        status: nextStatus,
        moderationReason: reason,
        updatedAt: nowMs
      });

      if (employer && wasCounted) {
        tx.setEmployer(employer.uid, {
          ...employer,
          activeCount: Math.max(0, currentQuotaUsed - 1),
          updatedAt: nowMs
        });
      }

      tx.writeAuditLog({
        actorUid: adminUid,
        actorRole: 'admin',
        action: 'remove',
        targetType: 'gig',
        targetId: gigId,
        reason,
        metadata: { previousStatus: gig.status, nextStatus },
        nowMs
      });

      return { ok: true, action, targetId: gigId, status: nextStatus };
    });
  }

  if (
    action === 'suspendEmployer' ||
    action === 'reinstateEmployer' ||
    action === 'setEmployerQuota'
  ) {
    const employerUid = typeof input.employerUid === 'string' ? input.employerUid.trim() : '';
    if (!ID_RE.test(employerUid)) {
      throw new ListingHandlerError('invalid-argument', 'Invalid employerUid.');
    }
    const reason = requireReason(input.reason);

    return store.runTransaction(async (tx) => {
      const existing = await tx.getEmployer(employerUid);
      const base: StoredEmployerProfile = existing ?? {
        uid: employerUid,
        email: null,
        legacyPhone: null,
        legacyGrandfathered: false,
        legacyCutoffVerified: false,
        maxActiveGigs: NEW_EMPLOYER_MAX_ACTIVE_GIGS,
        activeCount: 0,
        trustLevel: 'new',
        suspended: false,
        createdAt: nowMs,
        updatedAt: nowMs
      };

      if (action === 'setEmployerQuota') {
        const nextQuota =
          typeof input.maxActiveGigs === 'number' && Number.isInteger(input.maxActiveGigs)
            ? input.maxActiveGigs
            : -1;
        if (nextQuota < 0 || nextQuota > MAX_ADMIN_QUOTA) {
          throw new ListingHandlerError(
            'invalid-argument',
            `Quota must be an integer between 0 and ${MAX_ADMIN_QUOTA}.`
          );
        }
        tx.setEmployer(employerUid, {
          ...base,
          maxActiveGigs: nextQuota,
          updatedAt: nowMs
        });
        tx.writeAuditLog({
          actorUid: adminUid,
          actorRole: 'admin',
          action: 'quota_change',
          targetType: 'employer',
          targetId: employerUid,
          reason,
          metadata: { previousMax: base.maxActiveGigs, nextMax: nextQuota },
          nowMs
        });
        return { ok: true, action, targetId: employerUid };
      }

      if (action === 'suspendEmployer') {
        // Policy: Suspending an employer atomically hides all their active/pending listings
        // so suspended accounts cannot receive new contact links, and reconciles activeCount to 0.
        const gigs = await tx.listEmployerGigs(employerUid);
        let hiddenActiveCount = 0;
        for (const g of gigs) {
          if (g.status === 'active' || g.status === 'pending') {
            tx.updateGig(g.id, {
              status: 'hidden',
              moderationReason: reason,
              updatedAt: nowMs
            });
            hiddenActiveCount += 1;
          }
        }
        tx.setEmployer(employerUid, {
          ...base,
          suspended: true,
          suspendedReason: reason,
          activeCount: 0,
          updatedAt: nowMs
        });
        tx.writeAuditLog({
          actorUid: adminUid,
          actorRole: 'admin',
          action: 'suspend',
          targetType: 'employer',
          targetId: employerUid,
          reason,
          metadata: { hiddenActiveCount },
          nowMs
        });
        return { ok: true, action, targetId: employerUid, hiddenActiveCount };
      }

      // reinstateEmployer (does NOT auto-reactivate previously hidden ads; admin restores explicitly)
      tx.setEmployer(employerUid, {
        ...base,
        suspended: false,
        suspendedReason: '',
        updatedAt: nowMs
      });
      tx.writeAuditLog({
        actorUid: adminUid,
        actorRole: 'admin',
        action: 'unsuspend',
        targetType: 'employer',
        targetId: employerUid,
        reason,
        metadata: { previousSuspended: base.suspended },
        nowMs
      });
      return { ok: true, action, targetId: employerUid };
    });
  }

  throw new ListingHandlerError('invalid-argument', 'Unknown admin action.');
}

export { DEFAULT_REQUIRE_PRE_APPROVAL };
