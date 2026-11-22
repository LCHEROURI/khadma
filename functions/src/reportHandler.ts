import { createHash } from 'node:crypto';
import { evaluateRateBucket, type RateBucket } from './contactHandler.js';

export const HIDE_AFTER_REPORTS = 3;
export const MAX_REPORTS_PER_IP_PER_HOUR = 10;
export const REPORT_WINDOW_MS = 60 * 60 * 1000;

export const ALLOWED_REPORT_REASONS = new Set([
  'scam',
  'offensive',
  'wrongInfo',
  'spam',
  'other'
]);

const GIG_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export type ReportErrorCode =
  | 'unauthenticated'
  | 'failed-precondition'
  | 'invalid-argument'
  | 'not-found'
  | 'already-exists'
  | 'resource-exhausted';

export class ReportHandlerError extends Error {
  constructor(
    public readonly code: ReportErrorCode,
    message: string
  ) {
    super(message);
  }
}

export interface ReportStore {
  submitReportTransaction(params: {
    gigId: string;
    reason: string;
    uid: string;
    ipHash: string | null;
    nowMs: number;
  }): Promise<{ flags: number; status: 'active' | 'hidden' }>;
}

export interface ReportCallRequest {
  authUid: string | null;
  hasAppCheck: boolean;
  clientIp: string | null;
  gigId: unknown;
  reason: unknown;
  nowMs?: number;
}

export function hashReportIp(ip: string): string {
  return createHash('sha256').update(`khadma-report-ip:${ip}`).digest('hex').slice(0, 32);
}

export function checkIpReportRate(
  existing: RateBucket | null,
  gigId: string,
  nowMs: number
): { duplicateForGig: boolean; rateLimited: boolean; nextBucket: RateBucket } {
  const expired = !existing || nowMs - existing.windowStartMs >= REPORT_WINDOW_MS;
  const base: RateBucket = expired
    ? { gigIds: [], windowStartMs: nowMs }
    : { gigIds: [...existing.gigIds], windowStartMs: existing.windowStartMs };

  // Block Sybil abuse: same IP cannot report the same gig again via a fresh anonymous UID.
  if (base.gigIds.includes(gigId)) {
    return { duplicateForGig: true, rateLimited: false, nextBucket: base };
  }

  const { allowed, nextBucket } = evaluateRateBucket(
    base,
    gigId,
    MAX_REPORTS_PER_IP_PER_HOUR,
    REPORT_WINDOW_MS,
    nowMs
  );
  return { duplicateForGig: false, rateLimited: !allowed, nextBucket };
}

export async function handleReportGigListing(
  store: ReportStore,
  req: ReportCallRequest
): Promise<{ flags: number; status: 'active' | 'hidden' }> {
  if (!req.hasAppCheck) {
    throw new ReportHandlerError('failed-precondition', 'App Check verification required.');
  }
  if (!req.authUid) {
    throw new ReportHandlerError('unauthenticated', 'Authentication required.');
  }

  const gigId = typeof req.gigId === 'string' ? req.gigId.trim() : '';
  if (!GIG_ID_RE.test(gigId)) {
    throw new ReportHandlerError('invalid-argument', 'Invalid gig ID.');
  }

  const reason = typeof req.reason === 'string' ? req.reason : '';
  if (!ALLOWED_REPORT_REASONS.has(reason)) {
    throw new ReportHandlerError('invalid-argument', 'Invalid report reason.');
  }

  return store.submitReportTransaction({
    gigId,
    reason,
    uid: req.authUid,
    ipHash: req.clientIp ? hashReportIp(req.clientIp) : null,
    nowMs: req.nowMs ?? Date.now()
  });
}
