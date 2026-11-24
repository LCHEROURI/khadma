import type { Gig } from './types';

export type ExpirationClassification =
  | { kind: 'legacy_missing' }
  | { kind: 'valid'; expiresAtMs: number }
  | { kind: 'malformed' };

/**
 * Classifies a listing's `expiresAt` field into three distinct states:
 * - `legacy_missing`: `null` or `undefined` (legitimate pre-V1.4 legacy listing).
 * - `valid`: valid positive finite epoch timestamp.
 * - `malformed`: present but corrupted/unparseable value — MUST fail closed (treated as expired),
 *   never treated as a non-expiring legacy advertisement.
 */
export function classifyGigExpiration(gig: Pick<Gig, 'expiresAt'>): ExpirationClassification {
  const value = gig.expiresAt as unknown;
  if (value === null || value === undefined) {
    return { kind: 'legacy_missing' };
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0
      ? { kind: 'valid', expiresAtMs: value }
      : { kind: 'malformed' };
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) && ms > 0
      ? { kind: 'valid', expiresAtMs: ms }
      : { kind: 'malformed' };
  }
  if (typeof value === 'object') {
    const rec = value as { toMillis?: unknown; seconds?: unknown };
    if (typeof rec.toMillis === 'function') {
      const ms = (rec.toMillis as () => unknown)();
      return typeof ms === 'number' && Number.isFinite(ms) && ms > 0
        ? { kind: 'valid', expiresAtMs: ms }
        : { kind: 'malformed' };
    }
    if (typeof rec.seconds === 'number') {
      const ms = rec.seconds * 1000;
      return Number.isFinite(ms) && ms > 0
        ? { kind: 'valid', expiresAtMs: ms }
        : { kind: 'malformed' };
    }
  }
  return { kind: 'malformed' };
}

/**
 * Parses a listing's `expiresAt` timestamp into epoch milliseconds, or `null` when
 * missing or malformed. Use `classifyGigExpiration` when distinguishing legacy missing
 * from malformed values.
 */
export function parseGigExpiresAtMs(gig: Pick<Gig, 'expiresAt'>): number | null {
  const classified = classifyGigExpiration(gig);
  return classified.kind === 'valid' ? classified.expiresAtMs : null;
}

/**
 * Defensive client-side check for whether a listing's expiration timestamp has elapsed
 * OR is malformed/corrupted (fail-closed). Legitimate legacy listings with missing
 * `expiresAt` (`null`/`undefined`) return `false`.
 * Server-side `getGigContactLink` and `expireStaleGigs` remain the authoritative boundaries.
 */
export function isGigExpired(gig: Pick<Gig, 'expiresAt'>, nowMs = Date.now()): boolean {
  const classified = classifyGigExpiration(gig);
  if (classified.kind === 'legacy_missing') return false;
  if (classified.kind === 'malformed') return true;
  return classified.expiresAtMs <= nowMs;
}

/**
 * Returns true iff the listing is `active` and neither expired nor carrying a malformed `expiresAt`.
 */
export function isPubliclyActiveGig(
  gig: Pick<Gig, 'status' | 'expiresAt'>,
  nowMs = Date.now()
): boolean {
  return gig.status === 'active' && !isGigExpired(gig, nowMs);
}

/**
 * Filters a list of advertisements down to publicly active, non-expired entries.
 */
export function filterPubliclyActiveGigs<T extends Pick<Gig, 'status' | 'expiresAt'>>(
  gigs: readonly T[],
  nowMs = Date.now()
): T[] {
  return gigs.filter((g) => isPubliclyActiveGig(g, nowMs));
}
