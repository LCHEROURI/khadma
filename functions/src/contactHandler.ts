import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import type { ContactMethod } from './types.js';

export const MAX_CONTACTS_PER_IP_PER_HOUR = 30; // Unique gig:channel slots per IP/hr (CGNAT-balanced)
export const MAX_TOTAL_REQUESTS_PER_IP_PER_HOUR = 60; // Total requests per IP/hr (closes repetitive abuse)
export const MAX_UNKNOWN_IP_CONTACTS_PER_HOUR = 20; // Bounded fallback when client IP is missing/malformed
export const MAX_CONTACTS_PER_GIG_PER_HOUR = 60; // Per-listing unique IP burst cap/hr
export const MAX_REPEATS_PER_SLOT_IN_MEMORY = 6; // In-memory 10-min burst shedder (0 Firestore ops)
export const IN_MEMORY_BURST_WINDOW_MS = 10 * 60 * 1000;
export const RATE_WINDOW_MS = 60 * 60 * 1000;
export const RATE_TTL_MS = 2 * 60 * 60 * 1000;

export const WA_MESSAGES: Record<string, string> = {
  fr: "Bonjour, j'ai vu votre annonce sur KHADMA et je souhaite obtenir plus d'informations. Merci.",
  ar: 'السلام عليكم، شاهدت إعلانكم على خدامة وأرغب في الحصول على مزيد من المعلومات. شكراً.',
  dar: "Bonjour, j'ai vu votre annonce sur KHADMA et je souhaite obtenir plus d'informations. Merci."
};

export const EMAIL_BODIES: Record<string, string> = {
  fr: "Bonjour, j'ai vu votre annonce sur KHADMA et je souhaite obtenir plus d'informations.",
  ar: 'السلام عليكم، شاهدت إعلانكم على خدامة وأرغب في الحصول على مزيد من المعلومات.'
};

export const EMAIL_SUBJECT_PREFIX: Record<string, string> = {
  fr: 'Candidature KHADMA - ',
  ar: 'تقديم عبر خدامة - '
};

const GIG_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const DZ_E164_RE = /^\+213[567]\d{8}$/;
// Strict RFC-safe email regex forbidding CR/LF, whitespace, angle brackets, quotes, and header chars
const STRICT_EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;

function hasControlChars(input: string): boolean {
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function stripControlChars(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    out += code <= 0x1f || code === 0x7f ? ' ' : input[i];
  }
  return out;
}

function isPrivateOrLoopbackIp(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd')) {
    return true;
  }
  const v4 = lower.startsWith('::ffff:') ? lower.slice(7) : lower;
  if (
    v4.startsWith('127.') ||
    v4.startsWith('10.') ||
    v4.startsWith('192.168.') ||
    v4.startsWith('169.254.') ||
    v4 === '0.0.0.0'
  ) {
    return true;
  }
  if (v4.startsWith('172.')) {
    const second = parseInt(v4.split('.')[1] ?? '', 10);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

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
  totalRequests?: number;
  windowStartMs: number;
}

export interface ListingBurstBucket {
  count: number;
  windowStartMs: number;
}

export interface GigRecord {
  title?: unknown;
  status?: unknown;
  isSample?: unknown;
  expiresAt?: unknown;
  contactMethods?: unknown;
  posterPhone?: unknown; // Legacy V1.3 fallback only
}

export interface PrivateContactRecord {
  contactPhone?: unknown;
  contactEmail?: unknown;
  posterPhone?: unknown; // Legacy V1.3 field
  whatsappConsent?: unknown;
  emailConsent?: unknown;
}

export interface RateCheckResult {
  allowed: boolean;
  alreadyCounted: boolean;
}

export interface ContactStore {
  getGig(gigId: string): Promise<GigRecord | null>;
  getContactRecord(gigId: string): Promise<PrivateContactRecord | null>;
  checkAndConsumeIpRateLimit(
    bucketKey: string,
    slotKey: string,
    maxUniquePerWindow: number,
    maxTotalPerWindow: number,
    windowMs: number,
    nowMs: number
  ): Promise<RateCheckResult>;
  checkAndConsumeListingRateLimit(
    gigId: string,
    maxPerWindow: number,
    windowMs: number,
    nowMs: number
  ): Promise<boolean>;
}

export interface ContactCallRequest {
  authUid?: string | null;
  hasAppCheck: boolean;
  clientIp: string | null;
  gigId: unknown;
  channel?: unknown;
  lang: unknown;
  nowMs?: number;
  bypassInMemoryGuard?: boolean; // Test helper only; production always enforces in-memory guard
}

export interface ContactLinkResponse {
  url: string;
  channel: ContactMethod;
  waUrl?: string; // Preserved for V1.3 client compatibility when channel === 'whatsapp'
  mailtoUrl?: string;
}

export function hashIp(ip: string): string {
  return createHash('sha256').update(`khadma-contact-ip:${ip}`).digest('hex').slice(0, 32);
}

/**
 * Extracts a trustworthy public client IP on Cloud Functions v2 / Cloud Run behind Google Frontend.
 * - Validates every candidate with `net.isIP()`.
 * - Walks X-Forwarded-For from right to left, skipping private/loopback proxy hops so neither
 *   spoofed leftmost client headers nor internal Google proxy IPs are mistaken for the client IP.
 */
export function extractTrustedClientIp(rawRequest?: {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
}): string | null {
  const xff = rawRequest?.headers?.['x-forwarded-for'];
  const headerParts = (Array.isArray(xff) ? xff.join(',') : typeof xff === 'string' ? xff : '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  for (let i = headerParts.length - 1; i >= 0; i -= 1) {
    const candidate = headerParts[i];
    if (isIP(candidate) !== 0 && !isPrivateOrLoopbackIp(candidate)) {
      return candidate;
    }
  }

  const directIp = typeof rawRequest?.ip === 'string' ? rawRequest.ip.trim() : '';
  if (directIp && isIP(directIp) !== 0 && !isPrivateOrLoopbackIp(directIp)) {
    return directIp;
  }
  return null;
}

export function normalizeDzPhoneServer(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let d = input.replace(/[\s\-().]/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = '+' + d.slice(2);
  if (/^213/.test(d) && !d.startsWith('+')) d = '+' + d;
  if (d.startsWith('0')) d = '+213' + d.slice(1);
  if (/^[567]\d{8}$/.test(d)) d = '+213' + d;
  return DZ_E164_RE.test(d) ? d : null;
}

export function validateContactEmailServer(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  if (hasControlChars(input)) return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 254) return null;
  if (!STRICT_EMAIL_RE.test(trimmed)) return null;
  return trimmed;
}

export function sanitizeSubjectTitle(title: unknown): string {
  if (typeof title !== 'string') return 'KHADMA';
  const cleaned = stripControlChars(title).replace(/\s+/g, ' ').trim();
  if (!cleaned) return 'KHADMA';
  return cleaned.slice(0, 80);
}

export type ExpirationClassification =
  | { kind: 'legacy_missing' }
  | { kind: 'valid'; expiresAtMs: number }
  | { kind: 'malformed' };

export function classifyExpiresAt(value: unknown): ExpirationClassification {
  if (value === null || value === undefined) return { kind: 'legacy_missing' };
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

export function parseExpiresAtMs(value: unknown): number | null {
  const c = classifyExpiresAt(value);
  return c.kind === 'valid' ? c.expiresAtMs : null;
}

export const MAX_IN_MEMORY_BURST_ENTRIES = 2000;

/**
 * Lightweight in-memory per-instance burst guard for repetitive single-target clicks.
 * Sheds rapid repetitive loops at 0 Firestore reads/writes before entering transactions.
 * Strictly bounded to MAX_IN_MEMORY_BURST_ENTRIES with stale-first + oldest-entry eviction.
 */
const inMemoryRepeatBuckets = new Map<string, { count: number; windowStartMs: number }>();

export function resetInMemoryBurstGuard(): void {
  inMemoryRepeatBuckets.clear();
}

export function getInMemoryBurstGuardSize(): number {
  return inMemoryRepeatBuckets.size;
}

export function checkInMemorySlotBurst(key: string, nowMs: number): boolean {
  if (inMemoryRepeatBuckets.size >= MAX_IN_MEMORY_BURST_ENTRIES) {
    for (const [k, v] of inMemoryRepeatBuckets) {
      if (nowMs - v.windowStartMs >= IN_MEMORY_BURST_WINDOW_MS) {
        inMemoryRepeatBuckets.delete(k);
      }
    }
    // Hard cap: if still at/over capacity after sweeping expired entries, evict oldest entries.
    while (inMemoryRepeatBuckets.size >= MAX_IN_MEMORY_BURST_ENTRIES) {
      const oldestKey = inMemoryRepeatBuckets.keys().next().value;
      if (oldestKey === undefined) break;
      inMemoryRepeatBuckets.delete(oldestKey);
    }
  }
  const existing = inMemoryRepeatBuckets.get(key);
  if (!existing || nowMs - existing.windowStartMs >= IN_MEMORY_BURST_WINDOW_MS) {
    inMemoryRepeatBuckets.delete(key);
    inMemoryRepeatBuckets.set(key, { count: 1, windowStartMs: nowMs });
    return true;
  }
  if (existing.count >= MAX_REPEATS_PER_SLOT_IN_MEMORY) {
    return false;
  }
  existing.count += 1;
  return true;
}

export function evaluateRateBucket(
  existing: RateBucket | null,
  slotKey: string,
  maxUniquePerWindow: number,
  windowMs: number,
  nowMs: number,
  maxTotalPerWindow = MAX_TOTAL_REQUESTS_PER_IP_PER_HOUR
): { allowed: boolean; alreadyCounted: boolean; nextBucket: RateBucket } {
  const expired = !existing || nowMs - existing.windowStartMs >= windowMs;
  const base: RateBucket = expired
    ? { gigIds: [], totalRequests: 0, windowStartMs: nowMs }
    : {
        gigIds: [...existing.gigIds],
        totalRequests:
          typeof existing.totalRequests === 'number'
            ? existing.totalRequests
            : existing.gigIds.length,
        windowStartMs: existing.windowStartMs
      };

  const currentTotal = base.totalRequests ?? base.gigIds.length;
  if (currentTotal >= maxTotalPerWindow) {
    return { allowed: false, alreadyCounted: base.gigIds.includes(slotKey), nextBucket: base };
  }

  // Idempotent on unique-slot count (allows legitimate retries), while still bounding total requests.
  if (base.gigIds.includes(slotKey)) {
    return {
      allowed: true,
      alreadyCounted: true,
      nextBucket: { ...base, totalRequests: currentTotal + 1 }
    };
  }

  if (base.gigIds.length >= maxUniquePerWindow) {
    return { allowed: false, alreadyCounted: false, nextBucket: base };
  }

  base.gigIds.push(slotKey);
  return {
    allowed: true,
    alreadyCounted: false,
    nextBucket: { ...base, totalRequests: currentTotal + 1 }
  };
}

export function evaluateListingBurstBucket(
  existing: ListingBurstBucket | null,
  maxPerWindow: number,
  windowMs: number,
  nowMs: number
): { allowed: boolean; nextBucket: ListingBurstBucket } {
  const expired = !existing || nowMs - existing.windowStartMs >= windowMs;
  const base: ListingBurstBucket = expired
    ? { count: 0, windowStartMs: nowMs }
    : { count: existing.count, windowStartMs: existing.windowStartMs };

  if (base.count >= maxPerWindow) {
    return { allowed: false, nextBucket: base };
  }

  return {
    allowed: true,
    nextBucket: { count: base.count + 1, windowStartMs: base.windowStartMs }
  };
}

export function buildWhatsAppUrl(e164: string, langKey: 'fr' | 'ar'): string {
  const text = WA_MESSAGES[langKey] ?? WA_MESSAGES.fr;
  return `https://wa.me/${e164.replace(/^\+/, '')}?text=${encodeURIComponent(text)}`;
}

export function buildMailtoUrl(email: string, title: unknown, langKey: 'fr' | 'ar'): string {
  const prefix = EMAIL_SUBJECT_PREFIX[langKey] ?? EMAIL_SUBJECT_PREFIX.fr;
  const body = EMAIL_BODIES[langKey] ?? EMAIL_BODIES.fr;
  const subject = `${prefix}${sanitizeSubjectTitle(title)}`;
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function resolveChannel(raw: unknown): ContactMethod {
  // V1.3 backward compatibility: omitted channel defaults to 'whatsapp'.
  if (raw === undefined || raw === null) return 'whatsapp';
  if (raw === 'whatsapp' || raw === 'email') return raw;
  throw new ContactHandlerError('invalid-argument', 'Invalid contact channel.');
}

function isChannelEnabledOnGig(gig: GigRecord, channel: ContactMethod): boolean {
  if (Array.isArray(gig.contactMethods)) {
    return gig.contactMethods.includes(channel);
  }
  // Legacy V1.3 gigs without contactMethods implicitly support WhatsApp only.
  return channel === 'whatsapp';
}

export async function handleGetGigContactLink(
  store: ContactStore,
  req: ContactCallRequest
): Promise<ContactLinkResponse> {
  if (!req.hasAppCheck) {
    throw new ContactHandlerError('failed-precondition', 'App Check verification required.');
  }

  const gigId = typeof req.gigId === 'string' ? req.gigId.trim() : '';
  if (!GIG_ID_RE.test(gigId)) {
    throw new ContactHandlerError('invalid-argument', 'Invalid gig ID.');
  }

  const channel = resolveChannel(req.channel);
  const nowMs = req.nowMs ?? Date.now();

  const normalizedIp =
    typeof req.clientIp === 'string' && isIP(req.clientIp.trim()) !== 0 && !isPrivateOrLoopbackIp(req.clientIp.trim())
      ? req.clientIp.trim()
      : null;
  const ipBucketKey = normalizedIp ? `ip_${hashIp(normalizedIp)}` : 'ip_unknown';
  const slotKey = `${gigId}:${channel}`;

  // Layer 1 (0 Firestore ops): in-memory burst shedder for repetitive single-target spam.
  if (!req.bypassInMemoryGuard && !checkInMemorySlotBurst(`${ipBucketKey}:${slotKey}`, nowMs)) {
    throw new ContactHandlerError(
      'resource-exhausted',
      'Too many repeated contact requests. Please try again later.'
    );
  }

  const gig = await store.getGig(gigId);
  if (!gig || gig.status !== 'active' || gig.isSample === true) {
    throw new ContactHandlerError('not-found', 'Contact unavailable.');
  }

  // Enforce expiration even if status has not yet transitioned to 'expired'.
  // Legacy V1.3 docs with missing expiresAt remain eligible; malformed timestamps fail closed.
  const expClass = classifyExpiresAt(gig.expiresAt);
  if (expClass.kind === 'malformed' || (expClass.kind === 'valid' && expClass.expiresAtMs <= nowMs)) {
    throw new ContactHandlerError('not-found', 'Contact unavailable.');
  }

  if (!isChannelEnabledOnGig(gig, channel)) {
    throw new ContactHandlerError('not-found', 'Contact unavailable.');
  }

  // Layer 2 (Firestore atomic): per-IP unique-slot cap + bounded total-request cap.
  // Missing/malformed IPs fall back to a strict shared `ip_unknown` bucket rather than bypassing limits.
  const ipMaxUnique = normalizedIp ? MAX_CONTACTS_PER_IP_PER_HOUR : MAX_UNKNOWN_IP_CONTACTS_PER_HOUR;
  const ipMaxTotal = normalizedIp ? MAX_TOTAL_REQUESTS_PER_IP_PER_HOUR : MAX_UNKNOWN_IP_CONTACTS_PER_HOUR;
  const ipResult = await store.checkAndConsumeIpRateLimit(
    ipBucketKey,
    slotKey,
    ipMaxUnique,
    ipMaxTotal,
    RATE_WINDOW_MS,
    nowMs
  );
  if (!ipResult.allowed) {
    throw new ContactHandlerError(
      'resource-exhausted',
      'Too many contact requests from this network.'
    );
  }

  // Layer 3 (Firestore atomic): per-listing burst cap (skipped on idempotent duplicate clicks from same IP).
  if (!ipResult.alreadyCounted) {
    const listingAllowed = await store.checkAndConsumeListingRateLimit(
      gigId,
      MAX_CONTACTS_PER_GIG_PER_HOUR,
      RATE_WINDOW_MS,
      nowMs
    );
    if (!listingAllowed) {
      throw new ContactHandlerError(
        'resource-exhausted',
        'Too many contact requests for this listing.'
      );
    }
  }

  const contact = await store.getContactRecord(gigId);
  const langKey: 'fr' | 'ar' = req.lang === 'ar' ? 'ar' : 'fr';
  const isV14Listing = Array.isArray(gig.contactMethods);

  if (channel === 'whatsapp') {
    if (contact?.whatsappConsent === false) {
      throw new ContactHandlerError('not-found', 'Contact unavailable.');
    }
    let rawPhone: unknown = null;
    if (isV14Listing) {
      // V1.4 listings ALWAYS require explicit whatsappConsent === true (closes legacy fallback bypass).
      if (!contact || contact.whatsappConsent !== true) {
        throw new ContactHandlerError('not-found', 'Contact unavailable.');
      }
      rawPhone = contact.contactPhone ?? contact.posterPhone ?? null;
    } else if (contact && contact.contactPhone !== undefined && contact.contactPhone !== null) {
      if (contact.whatsappConsent !== true) {
        throw new ContactHandlerError('not-found', 'Contact unavailable.');
      }
      rawPhone = contact.contactPhone;
    } else {
      // Genuine V1.3 legacy doc (no contactMethods field)
      rawPhone = contact?.posterPhone ?? gig.posterPhone ?? null;
    }

    const normalized = normalizeDzPhoneServer(rawPhone);
    if (!normalized) {
      throw new ContactHandlerError('not-found', 'Contact unavailable.');
    }

    const waUrl = buildWhatsAppUrl(normalized, langKey);
    return { url: waUrl, waUrl, channel: 'whatsapp' };
  }

  // channel === 'email': strict explicit consent required; never auto-expose registration email.
  if (!contact || contact.emailConsent !== true) {
    throw new ContactHandlerError('not-found', 'Contact unavailable.');
  }
  const validEmail = validateContactEmailServer(contact.contactEmail);
  if (!validEmail) {
    throw new ContactHandlerError('not-found', 'Contact unavailable.');
  }

  const mailtoUrl = buildMailtoUrl(validEmail, gig.title, langKey);
  return { url: mailtoUrl, mailtoUrl, channel: 'email' };
}
