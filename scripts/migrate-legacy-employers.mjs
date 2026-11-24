/**
 * KHADMA V1.4 — Deterministic, Idempotent Legacy Employer Migration Script (DRY-RUN BY DEFAULT)
 *
 * Provisions `employers/{uid}` with `legacyGrandfathered: true`, `legacyCutoffVerified: true`,
 * `maxActiveGigs: 5`, and ground-truth reconciled `activeCount` ONLY for existing Firebase Auth
 * phone-authenticated users whose `metadata.creationTime` is strictly BEFORE `--cutoff=<ISO>`.
 *
 * Security invariants:
 * - Never trusts `phoneCounters` existence alone.
 * - Never deletes or unlinks existing Firebase Auth accounts or providers.
 * - Never overwrites an admin-adjusted quota on an already-migrated `employers/{uid}` doc.
 * - Dry-run unless `--apply` is explicitly passed.
 */

export const LEGACY_QUOTA = 5;

export function isEligibleLegacyAuthUser(user, cutoffMs) {
  if (!user || !user.uid || !user.phoneNumber) return false;
  const createdMs = Date.parse(user.metadata?.creationTime ?? '');
  if (!Number.isFinite(createdMs)) return false;
  return createdMs < cutoffMs;
}

export async function migrateLegacyEmployers({ authUsers, store, cutoffMs, apply = false, nowMs = Date.now() }) {
  const summary = {
    scanned: authUsers.length,
    eligibleLegacy: 0,
    skippedPostCutoff: 0,
    created: 0,
    reconciled: 0,
    unchanged: 0,
    apply
  };

  for (const user of authUsers) {
    if (!isEligibleLegacyAuthUser(user, cutoffMs)) {
      summary.skippedPostCutoff += 1;
      continue;
    }
    summary.eligibleLegacy += 1;

    const existing = await store.getEmployer(user.uid);
    const gigs = await store.listEmployerGigs(user.uid);
    const activeOrPending = gigs.filter((g) => g.status === 'active' || g.status === 'pending').length;

    if (!existing) {
      if (apply) {
        await store.setEmployer(user.uid, {
          uid: user.uid,
          email: user.email ?? null,
          legacyPhone: user.phoneNumber,
          legacyGrandfathered: true,
          legacyCutoffVerified: true,
          maxActiveGigs: LEGACY_QUOTA,
          activeCount: activeOrPending,
          trustLevel: 'new',
          suspended: false,
          createdAt: nowMs,
          updatedAt: nowMs
        });
      }
      summary.created += 1;
      continue;
    }

    const needsUpdate =
      existing.legacyGrandfathered !== true ||
      existing.legacyCutoffVerified !== true ||
      existing.activeCount !== activeOrPending;

    if (needsUpdate) {
      if (apply) {
        await store.setEmployer(user.uid, {
          ...existing,
          legacyPhone: existing.legacyPhone ?? user.phoneNumber,
          legacyGrandfathered: true,
          legacyCutoffVerified: true,
          // Preserve any admin-adjusted quota if already set; otherwise ensure >= LEGACY_QUOTA
          maxActiveGigs:
            typeof existing.maxActiveGigs === 'number' ? existing.maxActiveGigs : LEGACY_QUOTA,
          activeCount: activeOrPending,
          updatedAt: nowMs
        });
      }
      summary.reconciled += 1;
    } else {
      summary.unchanged += 1;
    }
  }

  return summary;
}

/**
 * Explicitly initializes `settings/marketplace` with the approved V1.4 launch default
 * (`requirePreApproval: false`, `remoderateMaterialEdits: true`) if absent.
 * Idempotent: never overwrites an existing operator-configured settings document.
 */
export async function initMarketplaceSettings({ store, actorUid = 'system:v1.4-migration', apply = false, nowMs = Date.now() }) {
  const existing = await store.getModerationSettings();
  if (existing && typeof existing.requirePreApproval === 'boolean') {
    return { initialized: false, alreadyExists: true, apply };
  }
  if (apply) {
    await store.setModerationSettings({
      requirePreApproval: false,
      remoderateMaterialEdits: true,
      remoderateMaterialEditsWhenEnabled: true,
      updatedAt: nowMs,
      updatedBy: actorUid
    });
  }
  return { initialized: true, alreadyExists: false, apply };
}
