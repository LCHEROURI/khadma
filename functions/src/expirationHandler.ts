import { classifyExpiresAt } from './contactHandler.js';
import {
  EMPLOYER_ACTIVE_QUERY_LIMIT,
  type AuditRecordInput,
  type StoredEmployerProfile,
  type StoredGig
} from './listingHandler.js';

export const EXPIRATION_BATCH_SIZE = 200;
export const EXPIRATION_MAX_BATCHES_PER_RUN = 5;

export interface ExpirationTxContext {
  getGig(gigId: string): Promise<StoredGig | null>;
  updateGig(gigId: string, patch: Partial<Omit<StoredGig, 'id'>>): void;
  getEmployer(uid: string): Promise<StoredEmployerProfile | null>;
  setEmployer(uid: string, data: StoredEmployerProfile): void;
  listEmployerGigs(uid: string): Promise<StoredGig[]>;
  writeAuditLog(entry: AuditRecordInput): void;
}

export interface ExpirationStore {
  findStaleActiveGigIds(nowMs: number, batchSize: number, afterId: string | null): Promise<string[]>;
  runTransaction<T>(fn: (tx: ExpirationTxContext) => Promise<T>): Promise<T>;
}

export interface ExpirationRunSummary {
  batchesProcessed: number;
  scanned: number;
  expiredCount: number;
  skippedCount: number;
  missingEmployerCount: number;
  driftReconciledCount: number;
  hasBacklog: boolean;
}

/**
 * Idempotent, concurrency-safe scheduled expiration sweep (`expireStaleGigs`).
 *
 * - Paginates in bounded batches (200/batch, max 5 batches = 1,000 ads/run).
 * - Re-checks `status === 'active' && expiresAt <= nowMs` inside a transaction so a
 *   concurrent employer `renew` extending `expiresAt` is NEVER clobbered.
 * - Reconciles `employers/{uid}.activeCount` from ground truth rather than silently
 *   masking drift by blind clamping; logs explicit `counter_reconciled` audit events.
 * - Handles missing employer profiles gracefully without aborting the batch.
 */
export async function runExpireStaleGigs(
  store: ExpirationStore,
  nowMs = Date.now(),
  batchSize = EXPIRATION_BATCH_SIZE,
  maxBatches = EXPIRATION_MAX_BATCHES_PER_RUN
): Promise<ExpirationRunSummary> {
  const summary: ExpirationRunSummary = {
    batchesProcessed: 0,
    scanned: 0,
    expiredCount: 0,
    skippedCount: 0,
    missingEmployerCount: 0,
    driftReconciledCount: 0,
    hasBacklog: false
  };

  let cursor: string | null = null;

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const ids = await store.findStaleActiveGigIds(nowMs, batchSize, cursor);
    if (ids.length === 0) break;

    summary.batchesProcessed += 1;
    summary.scanned += ids.length;

    for (const gigId of ids) {
      const outcome = await store.runTransaction(async (tx) => {
        // Phase 1: ALL Firestore transaction reads before any writes
        const gig = await tx.getGig(gigId);
        if (!gig || gig.status !== 'active') {
          return { expired: false, missingEmployer: false, driftReconciled: false };
        }
        const expClass = classifyExpiresAt(gig.expiresAt);
        if (expClass.kind === 'legacy_missing' || (expClass.kind === 'valid' && expClass.expiresAtMs > nowMs)) {
          // Concurrent renewal extended expiresAt before this transaction ran -> safe skip!
          return { expired: false, missingEmployer: false, driftReconciled: false };
        }
        const expMs = expClass.kind === 'valid' ? expClass.expiresAtMs : null;

        const hasOwner = Boolean(gig.posterUid && gig.posterUid !== 'sample');
        const employer = hasOwner ? await tx.getEmployer(gig.posterUid) : null;
        const employerGigs = employer ? await tx.listEmployerGigs(employer.uid) : [];

        // Phase 2: ALL Firestore transaction writes
        tx.updateGig(gigId, { status: 'expired', updatedAt: nowMs });
        tx.writeAuditLog({
          actorUid: 'system:expireStaleGigs',
          actorRole: 'system',
          action: 'expire',
          targetType: 'gig',
          targetId: gigId,
          metadata: { previousExpiresAtMs: expMs },
          nowMs
        });

        if (!hasOwner) {
          return { expired: true, missingEmployer: false, driftReconciled: false };
        }
        if (!employer) {
          return { expired: true, missingEmployer: true, driftReconciled: false };
        }

        const overflowed = employerGigs.length > EMPLOYER_ACTIVE_QUERY_LIMIT;
        let remainingActiveOrPending = 0;
        for (const eg of employerGigs) {
          if (eg.id === gigId) continue;
          if (eg.status === 'active' || eg.status === 'pending') {
            remainingActiveOrPending += 1;
          }
        }

        const expectedWithoutDrift = Math.max(0, employer.activeCount - 1);
        // On overflow (>50 active/pending), NEVER silently reduce activeCount to a truncated count.
        const nextActiveCount = overflowed
          ? Math.max(expectedWithoutDrift, remainingActiveOrPending)
          : remainingActiveOrPending;
        const driftDetected = overflowed || expectedWithoutDrift !== nextActiveCount;
        if (driftDetected) {
          tx.writeAuditLog({
            actorUid: 'system:expireStaleGigs',
            actorRole: 'system',
            action: 'counter_reconciled',
            targetType: 'employer',
            targetId: employer.uid,
            metadata: {
              ...(overflowed ? { overflowDetected: true } : {}),
              previousCount: employer.activeCount,
              expectedAfterDecrement: expectedWithoutDrift,
              reconciledCount: nextActiveCount
            },
            nowMs
          });
        }

        tx.setEmployer(employer.uid, {
          ...employer,
          activeCount: nextActiveCount,
          updatedAt: nowMs
        });

        return { expired: true, missingEmployer: false, driftReconciled: driftDetected };
      });

      if (outcome.expired) summary.expiredCount += 1;
      else summary.skippedCount += 1;
      if (outcome.missingEmployer) summary.missingEmployerCount += 1;
      if (outcome.driftReconciled) summary.driftReconciledCount += 1;
    }

    if (ids.length < batchSize) break;
    cursor = ids[ids.length - 1];

    // If the final allowed batch was full, probe for remaining stale ads to flag backlog clearly.
    if (batch === maxBatches - 1) {
      const nextProbe = await store.findStaleActiveGigIds(nowMs, 1, cursor);
      if (nextProbe.length > 0) {
        summary.hasBacklog = true;
        console.warn(
          JSON.stringify({
            event: 'expireStaleGigs_backlog_detected',
            scanned: summary.scanned,
            expiredCount: summary.expiredCount,
            batchSize,
            maxBatches
          })
        );
      }
    }
  }

  return summary;
}
