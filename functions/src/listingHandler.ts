import { createHash } from 'node:crypto';
import {
  ACTIVE_CITY,
  ACTIVE_WILAYA_CODE,
  ALLOWED_CATEGORIES,
  ALLOWED_NEIGHBORHOODS,
  DEFAULT_REMODERATE_MATERIAL_EDITS,
  LEGACY_EMPLOYER_MAX_ACTIVE_GIGS,
  LISTING_LIFESPAN_MS,
  LISTING_RENEWAL_WINDOW_MS,
  NEW_EMPLOYER_MAX_ACTIVE_GIGS,
  type AuditAction,
  type Category,
  type ContactMethod,
  type EmployerTrustLevel,
  type GigStatus,
  type ListingType
} from './types.js';
import {
  classifyExpiresAt,
  normalizeDzPhoneServer,
  parseExpiresAtMs,
  validateContactEmailServer
} from './contactHandler.js';

export type ListingAction =
  | 'create'
  | 'edit'
  | 'archive'
  | 'renew'
  | 'republish'
  | 'updateContact';

export type ListingErrorCode =
  | 'unauthenticated'
  | 'permission-denied'
  | 'failed-precondition'
  | 'invalid-argument'
  | 'not-found'
  | 'resource-exhausted';

export class ListingHandlerError extends Error {
  constructor(
    public readonly code: ListingErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
  }
}

export interface StoredEmployerProfile {
  uid: string;
  email: string | null;
  legacyPhone: string | null;
  legacyGrandfathered?: boolean;
  legacyCutoffVerified?: boolean;
  maxActiveGigs: number;
  activeCount: number;
  trustLevel: EmployerTrustLevel;
  suspended: boolean;
  suspendedReason?: string;
  defaultContactMethods?: ContactMethod[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface StoredGig {
  id: string;
  title: string;
  description: string;
  category: Category;
  listingType: ListingType;
  city?: string;
  wilayaCode?: string;
  contactMethods?: ContactMethod[];
  payMin: number;
  payMax: number;
  neighborhood: string;
  posterUid: string;
  flags: number;
  status: GigStatus;
  verified: boolean;
  isSample: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
  expiresAt?: unknown;
  moderationReason?: string;
}

export interface StoredModerationSettings {
  requirePreApproval?: unknown;
  remoderateMaterialEdits?: unknown;
  remoderateMaterialEditsWhenEnabled?: unknown;
}

export interface ResolvedModerationPolicy {
  requirePreApproval: boolean;
  remoderateMaterialEdits: boolean;
  configMalformed: boolean;
}

export interface AuditRecordInput {
  actorUid: string;
  actorRole: 'employer' | 'admin' | 'system';
  action: AuditAction | 'expire' | 'counter_reconciled';
  targetType: 'gig' | 'employer' | 'settings';
  targetId: string;
  reason?: string;
  metadata?: Record<string, unknown>;
  nowMs: number;
}

export interface IdempotencyRecord {
  gigId: string;
  status: GigStatus;
  expiresAtMs: number | null;
  action: ListingAction;
  payloadHash: string;
}

export interface ListingTxContext {
  getEmployer(uid: string): Promise<StoredEmployerProfile | null>;
  setEmployer(uid: string, data: StoredEmployerProfile): void;
  getModerationSettings(): Promise<StoredModerationSettings | null>;
  getGig(gigId: string): Promise<StoredGig | null>;
  listEmployerGigs(uid: string): Promise<StoredGig[]>;
  createGig(data: Omit<StoredGig, 'id'>): string;
  updateGig(gigId: string, patch: Partial<Omit<StoredGig, 'id'>>): void;
  setGigContact(
    gigId: string,
    data: {
      posterUid: string;
      contactPhone: string | null;
      contactEmail: string | null;
      whatsappConsent: boolean;
      emailConsent: boolean;
      updatedAtMs: number;
      createdAtMs?: number;
    }
  ): void;
  getIdempotency(key: string): Promise<IdempotencyRecord | null>;
  setIdempotency(key: string, record: IdempotencyRecord, nowMs: number): void;
  writeAuditLog(entry: AuditRecordInput): void;
}

export interface ListingStore {
  runTransaction<T>(fn: (tx: ListingTxContext) => Promise<T>): Promise<T>;
}

export interface ListingCallRequest {
  authUid: string | null;
  authEmail: string | null;
  authEmailVerified: boolean;
  authPhone: string | null;
  hasAppCheck: boolean;
  payload: unknown;
  nowMs?: number;
}

export interface ListingMutationResult {
  gigId: string;
  status: GigStatus;
  expiresAtMs: number | null;
  quotaUsed: number;
  quotaMax: number;
  idempotentReplay?: boolean;
}

const GIG_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;
const MIN_TITLE_LENGTH = 3;
const MAX_TITLE_LENGTH = 120;
const MAX_DESC_LENGTH = 2000;
const MAX_PAY_DZD = 100_000_000;

const CREATE_ALLOWLIST = new Set([
  'action',
  'idempotencyKey',
  'title',
  'description',
  'category',
  'listingType',
  'payMin',
  'payMax',
  'neighborhood',
  'city',
  'wilayaCode',
  'contactMethods',
  'contactPhone',
  'contactEmail',
  'whatsappConsent',
  'emailConsent'
]);

const EDIT_ALLOWLIST = new Set([
  'action',
  'gigId',
  'title',
  'description',
  'category',
  'listingType',
  'payMin',
  'payMax',
  'neighborhood',
  'city',
  'wilayaCode'
]);

const LIFECYCLE_ALLOWLIST = new Set(['action', 'gigId', 'idempotencyKey']);

const CONTACT_ALLOWLIST = new Set([
  'action',
  'gigId',
  'contactMethods',
  'contactPhone',
  'contactEmail',
  'whatsappConsent',
  'emailConsent'
]);

export function computePayloadHash(input: Record<string, unknown>): string {
  const keys = Object.keys(input)
    .filter((k) => k !== 'idempotencyKey')
    .sort();
  const normalized: Record<string, unknown> = {};
  for (const k of keys) {
    normalized[k] = input[k];
  }
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 32);
}

/**
 * Fail-safe resolution of `settings/marketplace`.
 *
 * Security invariant (Phase 4 Checkpoint):
 * - Missing, unreadable, or malformed settings MUST fail safely to `requirePreApproval: true` (`pending`).
 * - Immediate publication (`requirePreApproval: false`) is active ONLY when explicitly
 *   persisted in `settings/marketplace` (initialized via the authorized migration script).
 */
export function resolveModerationPolicy(
  raw: StoredModerationSettings | null
): ResolvedModerationPolicy {
  if (!raw || typeof raw.requirePreApproval !== 'boolean') {
    return {
      requirePreApproval: true,
      remoderateMaterialEdits: true,
      configMalformed: true
    };
  }
  const remoderateRaw =
    raw.remoderateMaterialEdits !== undefined
      ? raw.remoderateMaterialEdits
      : raw.remoderateMaterialEditsWhenEnabled;
  const remoderateMaterialEdits =
    typeof remoderateRaw === 'boolean' ? remoderateRaw : DEFAULT_REMODERATE_MATERIAL_EDITS;
  return {
    requirePreApproval: raw.requirePreApproval,
    remoderateMaterialEdits,
    configMalformed: false
  };
}

function assertAllowedKeys(obj: Record<string, unknown>, allowlist: Set<string>): void {
  for (const key of Object.keys(obj)) {
    if (!allowlist.has(key)) {
      throw new ListingHandlerError('invalid-argument', `Unsupported field: ${key}`);
    }
  }
}

function validateListingFields(input: Record<string, unknown>): {
  title: string;
  description: string;
  category: Category;
  listingType: ListingType;
  payMin: number;
  payMax: number;
  neighborhood: string;
} {
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (title.length < MIN_TITLE_LENGTH || title.length > MAX_TITLE_LENGTH) {
    throw new ListingHandlerError('invalid-argument', 'Invalid listing title.');
  }
  if (description.length === 0 || description.length > MAX_DESC_LENGTH) {
    throw new ListingHandlerError('invalid-argument', 'Invalid listing description.');
  }
  const category = input.category as Category;
  if (!ALLOWED_CATEGORIES.includes(category)) {
    throw new ListingHandlerError('invalid-argument', 'Invalid category.');
  }
  const listingType = input.listingType as ListingType;
  if (listingType !== 'job' && listingType !== 'service') {
    throw new ListingHandlerError('invalid-argument', 'Invalid listingType.');
  }
  if (input.city !== undefined && input.city !== ACTIVE_CITY) {
    throw new ListingHandlerError('invalid-argument', 'Only Oran is supported in V1.4.');
  }
  if (input.wilayaCode !== undefined && input.wilayaCode !== ACTIVE_WILAYA_CODE) {
    throw new ListingHandlerError('invalid-argument', 'Only wilaya 31 (Oran) is supported in V1.4.');
  }
  const neighborhood = typeof input.neighborhood === 'string' ? input.neighborhood : '';
  if (!ALLOWED_NEIGHBORHOODS.includes(neighborhood)) {
    throw new ListingHandlerError('invalid-argument', 'Invalid Oran neighborhood.');
  }
  const payMin = typeof input.payMin === 'number' ? Math.round(input.payMin) : NaN;
  const payMax =
    input.payMax === undefined
      ? payMin
      : typeof input.payMax === 'number'
        ? Math.round(input.payMax)
        : NaN;
  if (
    !Number.isInteger(payMin) ||
    payMin < 0 ||
    payMin > MAX_PAY_DZD ||
    !Number.isInteger(payMax) ||
    payMax < payMin ||
    payMax > MAX_PAY_DZD
  ) {
    throw new ListingHandlerError('invalid-argument', 'Invalid pay range.');
  }
  return { title, description, category, listingType, payMin, payMax, neighborhood };
}

function validateContactInput(input: Record<string, unknown>): {
  contactMethods: ContactMethod[];
  contactPhone: string | null;
  contactEmail: string | null;
  whatsappConsent: boolean;
  emailConsent: boolean;
} {
  if (!Array.isArray(input.contactMethods) || input.contactMethods.length === 0) {
    throw new ListingHandlerError('invalid-argument', 'At least one contact method is required.');
  }
  const methods: ContactMethod[] = [];
  for (const m of input.contactMethods) {
    if (m !== 'whatsapp' && m !== 'email') {
      throw new ListingHandlerError('invalid-argument', 'Invalid contact method.');
    }
    if (!methods.includes(m)) methods.push(m);
  }

  let contactPhone: string | null = null;
  let whatsappConsent = false;
  if (methods.includes('whatsapp')) {
    if (input.whatsappConsent !== true) {
      throw new ListingHandlerError('invalid-argument', 'Explicit WhatsApp consent is required.');
    }
    contactPhone = normalizeDzPhoneServer(input.contactPhone);
    if (!contactPhone) {
      throw new ListingHandlerError('invalid-argument', 'Invalid Algerian WhatsApp number.');
    }
    whatsappConsent = true;
  }

  let contactEmail: string | null = null;
  let emailConsent = false;
  if (methods.includes('email')) {
    if (input.emailConsent !== true) {
      throw new ListingHandlerError('invalid-argument', 'Explicit email contact consent is required.');
    }
    contactEmail = validateContactEmailServer(input.contactEmail);
    if (!contactEmail) {
      throw new ListingHandlerError('invalid-argument', 'Invalid contact email address.');
    }
    emailConsent = true;
  }

  return { contactMethods: methods, contactPhone, contactEmail, whatsappConsent, emailConsent };
}

/**
 * Ensures the caller is an eligible employer and provisions `employers/{uid}` server-side.
 *
 * Security invariant:
 * - New verified email employers receive maxActiveGigs = 3.
 * - Grandfathered legacy phone employers (maxActiveGigs = 5) MUST already have
 *   `employers/{uid}.legacyGrandfathered === true && legacyCutoffVerified === true`
 *   provisioned server-side via migration. Phone auth alone or phoneCounters existence
 *   NEVER grants grandfathered eligibility.
 */
async function resolveAndProvisionEmployer(
  tx: ListingTxContext,
  req: ListingCallRequest,
  nowMs: number
): Promise<{ employer: StoredEmployerProfile; needsPersist: boolean }> {
  if (!req.authUid) {
    throw new ListingHandlerError('unauthenticated', 'Authentication required.');
  }
  const existing = await tx.getEmployer(req.authUid);
  const isGrandfatheredLegacy = Boolean(
    existing?.legacyGrandfathered === true && existing?.legacyCutoffVerified === true
  );
  const hasVerifiedEmail = Boolean(req.authEmail && req.authEmailVerified);

  if (!hasVerifiedEmail && !isGrandfatheredLegacy) {
    throw new ListingHandlerError(
      'permission-denied',
      'Verified email is required to publish advertisements.'
    );
  }

  if (existing) {
    if (existing.suspended) {
      throw new ListingHandlerError('permission-denied', 'Employer account is suspended.');
    }
    // Keep email synced if legacy employer later linked & verified an email (persisted after all tx reads)
    if (hasVerifiedEmail && existing.email !== req.authEmail) {
      return {
        employer: { ...existing, email: req.authEmail, updatedAt: nowMs },
        needsPersist: true
      };
    }
    return { employer: existing, needsPersist: false };
  }

  // Provision new verified-email employer profile server-side (default quota = 3; persisted after all tx reads)
  const created: StoredEmployerProfile = {
    uid: req.authUid,
    email: req.authEmail,
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
  return { employer: created, needsPersist: true };
}

export const EMPLOYER_ACTIVE_QUERY_LIMIT = 50;

/**
 * Lazily transitions any of the employer's active listings whose expiresAt <= nowMs
 * (or whose expiresAt is malformed/corrupted) to 'expired' and reconciles activeCount
 * from ground truth inside the transaction.
 *
 * Overflow safety: `listEmployerGigs` fetches up to `EMPLOYER_ACTIVE_QUERY_LIMIT + 1` (51)
 * active/pending docs. If >50 are returned, the result is truncated and MUST NOT be treated
 * as an authoritative total — activeCount is never silently reduced below stored or observed count.
 */
async function reconcileEmployerQuotaAndExpiry(
  tx: ListingTxContext,
  employer: StoredEmployerProfile,
  nowMs: number
): Promise<{
  employer: StoredEmployerProfile;
  gigs: StoredGig[];
  actualActiveOrPending: number;
  overflowed: boolean;
}> {
  const gigs = await tx.listEmployerGigs(employer.uid);
  const overflowed = gigs.length > EMPLOYER_ACTIVE_QUERY_LIMIT;
  let observedActiveOrPending = 0;

  for (const g of gigs) {
    if (g.status === 'active') {
      const expClass = classifyExpiresAt(g.expiresAt);
      const shouldExpire =
        expClass.kind === 'malformed' || (expClass.kind === 'valid' && expClass.expiresAtMs <= nowMs);
      if (shouldExpire) {
        tx.updateGig(g.id, { status: 'expired', updatedAt: nowMs });
        g.status = 'expired';
        tx.writeAuditLog({
          actorUid: employer.uid,
          actorRole: 'system',
          action: 'expire',
          targetType: 'gig',
          targetId: g.id,
          metadata: {
            source: 'lazy_reconcile',
            previousStatus: 'active',
            ...(expClass.kind === 'malformed' ? { malformedExpiresAt: true } : {})
          },
          nowMs
        });
        continue;
      }
      observedActiveOrPending += 1;
    } else if (g.status === 'pending') {
      observedActiveOrPending += 1;
    }
  }

  if (overflowed) {
    // Truncated query result: NEVER silently reduce activeCount or treat 50 as authoritative.
    const safeMinimumCount = Math.max(employer.activeCount, observedActiveOrPending);
    tx.writeAuditLog({
      actorUid: employer.uid,
      actorRole: 'system',
      action: 'counter_reconciled',
      targetType: 'employer',
      targetId: employer.uid,
      metadata: {
        overflowDetected: true,
        previousCount: employer.activeCount,
        observedMinimumCount: observedActiveOrPending,
        retainedCount: safeMinimumCount
      },
      nowMs
    });
    if (safeMinimumCount !== employer.activeCount) {
      const raised = { ...employer, activeCount: safeMinimumCount, updatedAt: nowMs };
      tx.setEmployer(employer.uid, raised);
      return { employer: raised, gigs, actualActiveOrPending: safeMinimumCount, overflowed: true };
    }
    return { employer, gigs, actualActiveOrPending: safeMinimumCount, overflowed: true };
  }

  if (employer.activeCount !== observedActiveOrPending) {
    tx.writeAuditLog({
      actorUid: employer.uid,
      actorRole: 'system',
      action: 'counter_reconciled',
      targetType: 'employer',
      targetId: employer.uid,
      metadata: { previousCount: employer.activeCount, reconciledCount: observedActiveOrPending },
      nowMs
    });
    const reconciled = { ...employer, activeCount: observedActiveOrPending, updatedAt: nowMs };
    tx.setEmployer(employer.uid, reconciled);
    return { employer: reconciled, gigs, actualActiveOrPending: observedActiveOrPending, overflowed: false };
  }

  return { employer, gigs, actualActiveOrPending: observedActiveOrPending, overflowed: false };
}

export async function handleManageEmployerListing(
  store: ListingStore,
  req: ListingCallRequest
): Promise<ListingMutationResult> {
  if (!req.hasAppCheck) {
    throw new ListingHandlerError('failed-precondition', 'App Check verification required.');
  }
  if (!req.authUid) {
    throw new ListingHandlerError('unauthenticated', 'Authentication required.');
  }
  if (!req.payload || typeof req.payload !== 'object' || Array.isArray(req.payload)) {
    throw new ListingHandlerError('invalid-argument', 'Invalid request payload.');
  }

  const input = req.payload as Record<string, unknown>;
  const action = input.action as ListingAction;
  const nowMs = req.nowMs ?? Date.now();

  if (
    action !== 'create' &&
    action !== 'edit' &&
    action !== 'archive' &&
    action !== 'renew' &&
    action !== 'republish' &&
    action !== 'updateContact'
  ) {
    throw new ListingHandlerError('invalid-argument', 'Invalid listing action.');
  }

  if (action === 'create') assertAllowedKeys(input, CREATE_ALLOWLIST);
  else if (action === 'edit') assertAllowedKeys(input, EDIT_ALLOWLIST);
  else if (action === 'updateContact') assertAllowedKeys(input, CONTACT_ALLOWLIST);
  else assertAllowedKeys(input, LIFECYCLE_ALLOWLIST);

  const rawIdem = input.idempotencyKey;
  let idemKey: string | null = null;
  if (rawIdem !== undefined) {
    if (typeof rawIdem !== 'string' || !IDEMPOTENCY_KEY_RE.test(rawIdem)) {
      throw new ListingHandlerError('invalid-argument', 'Invalid idempotencyKey.');
    }
    idemKey = `${req.authUid}_${action}_${rawIdem}`;
  }

  const payloadHash = computePayloadHash(input);

  return store.runTransaction(async (tx) => {
    // Phase 1 of Firestore transaction: ALL reads first before any writes
    const { employer, needsPersist } = await resolveAndProvisionEmployer(tx, req, nowMs);

    if (idemKey) {
      const prior = await tx.getIdempotency(idemKey);
      if (prior) {
        if (prior.payloadHash && prior.payloadHash !== payloadHash) {
          throw new ListingHandlerError(
            'failed-precondition',
            'Idempotency key was already used with a different payload.'
          );
        }
        return {
          gigId: prior.gigId,
          status: prior.status,
          expiresAtMs: prior.expiresAtMs,
          quotaUsed: employer.activeCount,
          quotaMax: employer.maxActiveGigs,
          idempotentReplay: true
        };
      }
    }

    const policy = resolveModerationPolicy(await tx.getModerationSettings());
    // Mandatory moderation applies uniformly to ALL employers (including trusted) when enabled.
    const needsPreApproval = policy.requirePreApproval;

    if (action === 'create') {
      const fields = validateListingFields(input);
      const contact = validateContactInput(input);
      const { employer: synced, actualActiveOrPending } = await reconcileEmployerQuotaAndExpiry(
        tx,
        employer,
        nowMs
      );

      if (actualActiveOrPending >= synced.maxActiveGigs) {
        throw new ListingHandlerError(
          'resource-exhausted',
          `Advertisement quota reached (${synced.maxActiveGigs}).`,
          { quotaMax: synced.maxActiveGigs, quotaUsed: synced.activeCount }
        );
      }

      const nextStatus: GigStatus = needsPreApproval ? 'pending' : 'active';
      // Pending ads receive their 30-day expiration when approved and activated (Decision 5).
      const expiresAtMs = nextStatus === 'active' ? nowMs + LISTING_LIFESPAN_MS : null;

      const gigId = tx.createGig({
        ...fields,
        city: ACTIVE_CITY,
        wilayaCode: ACTIVE_WILAYA_CODE,
        contactMethods: contact.contactMethods,
        posterUid: synced.uid,
        flags: 0,
        status: nextStatus,
        verified: true,
        isSample: false,
        createdAt: nowMs,
        updatedAt: nowMs,
        expiresAt: expiresAtMs
      });

      tx.setGigContact(gigId, {
        posterUid: synced.uid,
        contactPhone: contact.contactPhone,
        contactEmail: contact.contactEmail,
        whatsappConsent: contact.whatsappConsent,
        emailConsent: contact.emailConsent,
        createdAtMs: nowMs,
        updatedAtMs: nowMs
      });

      const nextCount = actualActiveOrPending + 1;
      tx.setEmployer(synced.uid, {
        ...synced,
        activeCount: nextCount,
        defaultContactMethods: contact.contactMethods,
        updatedAt: nowMs
      });

      tx.writeAuditLog({
        actorUid: synced.uid,
        actorRole: 'employer',
        action: 'create',
        targetType: 'gig',
        targetId: gigId,
        metadata: {
          status: nextStatus,
          listingType: fields.listingType,
          category: fields.category,
          contactMethods: contact.contactMethods,
          configMalformed: policy.configMalformed
        },
        nowMs
      });

      if (idemKey) {
        tx.setIdempotency(
          idemKey,
          { gigId, status: nextStatus, expiresAtMs, action, payloadHash },
          nowMs
        );
      }

      return {
        gigId,
        status: nextStatus,
        expiresAtMs,
        quotaUsed: nextCount,
        quotaMax: synced.maxActiveGigs
      };
    }

    // All remaining actions require an owned gigId
    const gigId = typeof input.gigId === 'string' ? input.gigId.trim() : '';
    if (!GIG_ID_RE.test(gigId)) {
      throw new ListingHandlerError('invalid-argument', 'Invalid gigId.');
    }
    const gig = await tx.getGig(gigId);
    if (!gig) {
      throw new ListingHandlerError('not-found', 'Advertisement not found.');
    }
    if (gig.posterUid !== employer.uid) {
      throw new ListingHandlerError('permission-denied', 'You do not own this advertisement.');
    }

    if (action === 'edit') {
      if (gig.status !== 'active' && gig.status !== 'pending') {
        throw new ListingHandlerError(
          'failed-precondition',
          'Only active or pending advertisements can be edited.'
        );
      }
      const fields = validateListingFields(input);
      const isMaterialEdit =
        fields.title !== gig.title ||
        fields.description !== gig.description ||
        fields.category !== gig.category ||
        fields.listingType !== gig.listingType ||
        fields.payMin !== gig.payMin ||
        fields.payMax !== gig.payMax ||
        fields.neighborhood !== gig.neighborhood;

      const nextStatus: GigStatus =
        gig.status === 'active' &&
        isMaterialEdit &&
        needsPreApproval &&
        policy.remoderateMaterialEdits
          ? 'pending'
          : gig.status;

      if (needsPersist) {
        tx.setEmployer(employer.uid, employer);
      }
      tx.updateGig(gigId, {
        ...fields,
        city: ACTIVE_CITY,
        wilayaCode: ACTIVE_WILAYA_CODE,
        status: nextStatus,
        updatedAt: nowMs
      });

      tx.writeAuditLog({
        actorUid: employer.uid,
        actorRole: 'employer',
        action: 'edit',
        targetType: 'gig',
        targetId: gigId,
        metadata: {
          previousStatus: gig.status,
          nextStatus,
          isMaterialEdit
        },
        nowMs
      });

      return {
        gigId,
        status: nextStatus,
        expiresAtMs: parseExpiresAtMs(gig.expiresAt),
        quotaUsed: employer.activeCount,
        quotaMax: employer.maxActiveGigs
      };
    }

    if (action === 'updateContact') {
      if (gig.status === 'hidden' || gig.status === 'removed') {
        throw new ListingHandlerError(
          'failed-precondition',
          'Cannot update contact settings on a moderated advertisement.'
        );
      }
      const contact = validateContactInput(input);
      if (needsPersist) {
        tx.setEmployer(employer.uid, employer);
      }
      tx.updateGig(gigId, {
        contactMethods: contact.contactMethods,
        updatedAt: nowMs
      });
      tx.setGigContact(gigId, {
        posterUid: employer.uid,
        contactPhone: contact.contactPhone,
        contactEmail: contact.contactEmail,
        whatsappConsent: contact.whatsappConsent,
        emailConsent: contact.emailConsent,
        updatedAtMs: nowMs
      });
      tx.writeAuditLog({
        actorUid: employer.uid,
        actorRole: 'employer',
        action: 'update_contact',
        targetType: 'gig',
        targetId: gigId,
        metadata: { contactMethods: contact.contactMethods },
        nowMs
      });
      return {
        gigId,
        status: gig.status,
        expiresAtMs: parseExpiresAtMs(gig.expiresAt),
        quotaUsed: employer.activeCount,
        quotaMax: employer.maxActiveGigs
      };
    }

    if (action === 'archive') {
      if (gig.status !== 'active' && gig.status !== 'pending') {
        throw new ListingHandlerError(
          'failed-precondition',
          'Only active or pending advertisements can be archived.'
        );
      }
      const { employer: synced, gigs: reconciledGigs, actualActiveOrPending } =
        await reconcileEmployerQuotaAndExpiry(tx, employer, nowMs);
      // If lazy reconciliation already expired this gig, reject archive as expired
      const latestGig = reconciledGigs.find((g) => g.id === gigId);
      if (latestGig?.status === 'expired') {
        throw new ListingHandlerError('failed-precondition', 'Advertisement is already expired.');
      }

      tx.updateGig(gigId, { status: 'archived', updatedAt: nowMs });
      const nextCount = Math.max(0, actualActiveOrPending - 1);
      tx.setEmployer(synced.uid, { ...synced, activeCount: nextCount, updatedAt: nowMs });
      tx.writeAuditLog({
        actorUid: synced.uid,
        actorRole: 'employer',
        action: 'archive',
        targetType: 'gig',
        targetId: gigId,
        metadata: { previousStatus: gig.status },
        nowMs
      });
      return {
        gigId,
        status: 'archived',
        expiresAtMs: parseExpiresAtMs(gig.expiresAt),
        quotaUsed: nextCount,
        quotaMax: synced.maxActiveGigs
      };
    }

    if (action === 'renew') {
      if (gig.status !== 'active') {
        throw new ListingHandlerError(
          'failed-precondition',
          'Only active advertisements can be renewed.'
        );
      }
      const expClass = classifyExpiresAt(gig.expiresAt);
      if (expClass.kind === 'legacy_missing') {
        throw new ListingHandlerError(
          'failed-precondition',
          'Legacy advertisements without an expiration date do not need renewal.'
        );
      }
      if (expClass.kind === 'malformed') {
        throw new ListingHandlerError(
          'failed-precondition',
          'Advertisement has a corrupted expiration timestamp. Use republish instead.'
        );
      }
      const currentExpiryMs = expClass.expiresAtMs;
      if (nowMs >= currentExpiryMs) {
        throw new ListingHandlerError(
          'failed-precondition',
          'Advertisement has already expired. Use republish instead.'
        );
      }
      const renewalOpensAtMs = currentExpiryMs - LISTING_RENEWAL_WINDOW_MS;
      if (nowMs < renewalOpensAtMs) {
        throw new ListingHandlerError(
          'failed-precondition',
          'Renewal is available only during the final 7 days before expiration.'
        );
      }

      // Decision 5: Extend expiration by 30 days from the EXISTING expiration timestamp.
      // Because newExpiry = currentExpiry + 30d, nowMs is now 30+ days before newExpiry,
      // making a second/concurrent renewal automatically fail the 7-day window check!
      const nextExpiresAtMs = currentExpiryMs + LISTING_LIFESPAN_MS;
      if (needsPersist) {
        tx.setEmployer(employer.uid, employer);
      }
      tx.updateGig(gigId, { expiresAt: nextExpiresAtMs, updatedAt: nowMs });
      tx.writeAuditLog({
        actorUid: employer.uid,
        actorRole: 'employer',
        action: 'renew',
        targetType: 'gig',
        targetId: gigId,
        metadata: { previousExpiresAtMs: currentExpiryMs, nextExpiresAtMs },
        nowMs
      });
      if (idemKey) {
        tx.setIdempotency(
          idemKey,
          { gigId, status: 'active', expiresAtMs: nextExpiresAtMs, action, payloadHash },
          nowMs
        );
      }
      return {
        gigId,
        status: 'active',
        expiresAtMs: nextExpiresAtMs,
        quotaUsed: employer.activeCount,
        quotaMax: employer.maxActiveGigs
      };
    }

    // action === 'republish'
    const {
      employer: synced,
      gigs: reconciledGigs,
      actualActiveOrPending
    } = await reconcileEmployerQuotaAndExpiry(tx, employer, nowMs);
    const refreshedGig = reconciledGigs.find((g) => g.id === gigId) ?? gig;
    // Also treat an active ad whose expiresAt <= nowMs OR is malformed as expired after lazy reconciliation
    const repExpClass = classifyExpiresAt(refreshedGig.expiresAt);
    const effectiveStatus =
      refreshedGig.status === 'active' &&
      (repExpClass.kind === 'malformed' ||
        (repExpClass.kind === 'valid' && repExpClass.expiresAtMs <= nowMs))
        ? 'expired'
        : refreshedGig.status;

    if (effectiveStatus !== 'expired' && effectiveStatus !== 'archived') {
      throw new ListingHandlerError(
        'failed-precondition',
        'Only expired or archived advertisements can be republished.'
      );
    }
    if (actualActiveOrPending >= synced.maxActiveGigs) {
      throw new ListingHandlerError(
        'resource-exhausted',
        `Advertisement quota reached (${synced.maxActiveGigs}).`,
        { quotaMax: synced.maxActiveGigs, quotaUsed: actualActiveOrPending }
      );
    }

    const nextStatus: GigStatus = needsPreApproval ? 'pending' : 'active';
    const nextExpiresAtMs = nextStatus === 'active' ? nowMs + LISTING_LIFESPAN_MS : null;

    tx.updateGig(gigId, {
      status: nextStatus,
      expiresAt: nextExpiresAtMs,
      updatedAt: nowMs
    });

    const nextCount = actualActiveOrPending + 1;
    tx.setEmployer(synced.uid, { ...synced, activeCount: nextCount, updatedAt: nowMs });
    tx.writeAuditLog({
      actorUid: synced.uid,
      actorRole: 'employer',
      action: 'republish',
      targetType: 'gig',
      targetId: gigId,
      metadata: { previousStatus: effectiveStatus, nextStatus },
      nowMs
    });

    if (idemKey) {
      tx.setIdempotency(
        idemKey,
        { gigId, status: nextStatus, expiresAtMs: nextExpiresAtMs, action, payloadHash },
        nowMs
      );
    }

    return {
      gigId,
      status: nextStatus,
      expiresAtMs: nextExpiresAtMs,
      quotaUsed: nextCount,
      quotaMax: synced.maxActiveGigs
    };
  });
}

export { LEGACY_EMPLOYER_MAX_ACTIVE_GIGS };
