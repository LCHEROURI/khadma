import { createHash } from 'node:crypto';

export const MAX_CONTACTS_PER_UID_PER_HOUR = 8;
export const MAX_CONTACTS_PER_IP_PER_HOUR = 15;
export const RATE_WINDOW_MS = 60 * 60 * 1000;

export const WA_MESSAGES: Record<string, string> = {
  dar: 'Salam 👋 Choftek 3la KHADMA, 7abbit nse9sik 3la li3lan.',
  fr: 'Bonjour 👋 Je vous contacte via KHADMA au sujet de votre annonce.',
  ar: 'سلام 👋 تواصلت معك عبر خدامة بخصوص إعلانك.'
};

const GIG_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export type ContactErrorCode =
  | 'unauthenticated'
  | 'failed-precondition'
  | 'invalid-argument'
  | 'not-found'
  | 'resource-exhausted';

export class ContactHandlerError extends Error {
  constructor(
    public readonly code: ContactErrorCode,
    message: string
  ) {
    super(message);
  }
}

export interface RateBucket {
  gigIds: string[];
  windowStartMs: number;
}

export interface GigRecord {
  status?: unknown;
  isSample?: unknown;
  posterPhone?: unknown;
}

export interface ContactStore {
  getGig(gigId: string): Promise<GigRecord | null>;
  getContactPhone(gigId: string): Promise<string | null>;
  checkAndConsumeRateLimit(
    bucketKey: string,
    gigId: string,
    maxPerWindow: number,
    windowMs: number,
    nowMs: number
  ): Promise<boolean>;
}

export interface ContactCallRequest {
  authUid: string | null;
  hasAppCheck: boolean;
  clientIp: string | null;
  gigId: unknown;
  lang: unknown;
  nowMs?: number;
}

export function hashIp(ip: string): string {
  return createHash('sha256').update(`khadma-contact-ip:${ip}`).digest('hex').slice(0, 32);
}

export function evaluateRateBucket(
  existing: RateBucket | null,
  gigId: string,
  maxPerWindow: number,
  windowMs: number,
  nowMs: number
): { allowed: boolean; nextBucket: RateBucket } {
  const expired = !existing || nowMs - existing.windowStartMs >= windowMs;
  const base: RateBucket = expired
    ? { gigIds: [], windowStartMs: nowMs }
    : { gigIds: [...existing.gigIds], windowStartMs: existing.windowStartMs };

  // Idempotent: reopening the same gig within the window does not consume a new slot.
  if (base.gigIds.includes(gigId)) {
    return { allowed: true, nextBucket: base };
  }

  if (base.gigIds.length >= maxPerWindow) {
    return { allowed: false, nextBucket: base };
  }

  base.gigIds.push(gigId);
  return { allowed: true, nextBucket: base };
}

export async function handleGetGigContactLink(
  store: ContactStore,
  req: ContactCallRequest
): Promise<{ waUrl: string }> {
  if (!req.hasAppCheck) {
    throw new ContactHandlerError('failed-precondition', 'App Check verification required.');
  }
  if (!req.authUid) {
    throw new ContactHandlerError('unauthenticated', 'Authentication required.');
  }

  const gigId = typeof req.gigId === 'string' ? req.gigId.trim() : '';
  if (!GIG_ID_RE.test(gigId)) {
    throw new ContactHandlerError('invalid-argument', 'Invalid gig ID.');
  }

  const gig = await store.getGig(gigId);
  if (!gig || gig.status !== 'active' || gig.isSample === true) {
    throw new ContactHandlerError('not-found', 'Contact unavailable.');
  }

  const nowMs = req.nowMs ?? Date.now();

  // Enforce per-UID sliding-window rate limit.
  const uidAllowed = await store.checkAndConsumeRateLimit(
    `uid_${req.authUid}`,
    gigId,
    MAX_CONTACTS_PER_UID_PER_HOUR,
    RATE_WINDOW_MS,
    nowMs
  );
  if (!uidAllowed) {
    throw new ContactHandlerError('resource-exhausted', 'Too many contact requests. Please try again later.');
  }

  // Enforce per-IP sliding-window rate limit to block anonymous UID cycling from a single IP.
  if (req.clientIp) {
    const ipAllowed = await store.checkAndConsumeRateLimit(
      `ip_${hashIp(req.clientIp)}`,
      gigId,
      MAX_CONTACTS_PER_IP_PER_HOUR,
      RATE_WINDOW_MS,
      nowMs
    );
    if (!ipAllowed) {
      throw new ContactHandlerError('resource-exhausted', 'Too many contact requests from this network.');
    }
  }

  // Prefer private gigContacts/{gigId}; fall back to legacy gigs/{gigId}.posterPhone
  // until an approved migration removes legacy fields from live documents.
  const privatePhone = await store.getContactPhone(gigId);
  const rawPhone =
    privatePhone ?? (typeof gig.posterPhone === 'string' ? gig.posterPhone : null);

  if (!rawPhone || !/^\+213[567]\d{8}$/.test(rawPhone)) {
    throw new ContactHandlerError('not-found', 'Contact unavailable.');
  }

  const langKey = typeof req.lang === 'string' && req.lang in WA_MESSAGES ? req.lang : 'dar';
  const waUrl = `https://wa.me/${rawPhone.replace(/^\+/, '')}?text=${encodeURIComponent(WA_MESSAGES[langKey])}`;
  return { waUrl };
}
