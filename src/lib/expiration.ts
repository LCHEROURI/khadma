import type { Gig } from './types';

export type ExpirationClassification =
  | { kind: 'legacy_missing' }
  | { kind: 'valid'; expiresAtMs: number }
  | { kind: 'malformed' };

export type GigExpirationInput = Pick<Gig, 'expiresAt'> & {
  city?: unknown;
  wilayaCode?: unknown;
  contactMethods?: unknown;
  isSample?: unknown;
};

/**
 * Returns true if the document carries V1.4 schema markers (`city`, `wilayaCode`, or `contactMethods`).
 * New V1.4 active advertisements MUST have a valid `expiresAt` timestamp; missing/null `expiresAt`
 * on a V1.4 document fails closed rather than receiving the pre-V1.4 legacy exemption.
 */
export function isV14ListingRecord(gig: GigExpirationInput): boolean {
  return (
    gig.city !== undefined ||
    gig.wilayaCode !== undefined ||
    gig.contactMethods !== undefined
  );
}

/**
 * Classifies a listing's `expiresAt` field into three distinct states:
 * - `legacy_missing`: `null` or `undefined` on a genuine pre-V1.4 legacy listing (no V1.4 markers).
 * - `valid`: valid positive finite epoch timestamp.
 * - `malformed`: present but corrupted/unparseable value, OR missing/null on a V1.4 listing —
 *   MUST fail closed (treated as expired), never treated as a non-expiring legacy advertisement.
 */
export function classifyGigExpiration(gig: GigExpirationInput): ExpirationClassification {
  const value = gig.expiresAt as unknown;
  if (value === null || value === undefined) {
    if (gig.isSample === true) return { kind: 'legacy_missing' };
    return isV14ListingRecord(gig) ? { kind: 'malformed' } : { kind: 'legacy_missing' };
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
export function parseGigExpiresAtMs(gig: GigExpirationInput): number | null {
  const classified = classifyGigExpiration(gig);
  return classified.kind === 'valid' ? classified.expiresAtMs : null;
}

/**
 * Defensive client-side check for whether a listing's expiration timestamp has elapsed
 * OR is malformed/corrupted (fail-closed). Legitimate legacy listings with missing
 * `expiresAt` (`null`/`undefined`) return `false`.
 * Server-side `getGigContactLink` and `expireStaleGigs` remain the authoritative boundaries.
 */
export function isGigExpired(gig: GigExpirationInput, nowMs = Date.now()): boolean {
  const classified = classifyGigExpiration(gig);
  if (classified.kind === 'legacy_missing') return false;
  if (classified.kind === 'malformed') return true;
  return classified.expiresAtMs <= nowMs;
}

/**
 * Returns true iff the listing is `active` and neither expired nor carrying a malformed `expiresAt`.
 */
export function isPubliclyActiveGig(
  gig: GigExpirationInput & Pick<Gig, 'status'>,
  nowMs = Date.now()
): boolean {
  return gig.status === 'active' && !isGigExpired(gig, nowMs);
}

/**
 * Filters a list of advertisements down to publicly active, non-expired entries.
 */
export function filterPubliclyActiveGigs<T extends GigExpirationInput & Pick<Gig, 'status'>>(
  gigs: readonly T[],
  nowMs = Date.now()
): T[] {
  return gigs.filter((g) => isPubliclyActiveGig(g, nowMs));
}
