import type { ContactMethod } from './types';

export interface ParsedMailtoLink {
  to: string;
  subject: string;
  body: string;
}

/**
 * Returns the employer-enabled contact methods for a listing.
 * Legacy V1.3 listings without `contactMethods` default to WhatsApp only.
 */
export function resolveEnabledContactMethods(
  contactMethods?: readonly ContactMethod[] | null
): ContactMethod[] {
  if (!contactMethods) return ['whatsapp'];
  const unique: ContactMethod[] = [];
  for (const m of contactMethods) {
    if ((m === 'whatsapp' || m === 'email') && !unique.includes(m)) {
      unique.push(m);
    }
  }
  return unique;
}

/**
 * Defense-in-depth client-side URL scheme check preventing unsafe redirects
 * or malformed external contact links.
 */
export function isSafeContactUrl(url: unknown, channel: ContactMethod): url is string {
  if (typeof url !== 'string' || url.length === 0) return false;
  for (let i = 0; i < url.length; i += 1) {
    const code = url.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return false;
  }
  if (channel === 'whatsapp') {
    return /^https:\/\/wa\.me\/213[567]\d{8}(\?.*)?$/.test(url);
  }
  return /^mailto:[^\s<>"]+@[^\s<>"]+(\?.*)?$/.test(url);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Parses a validated `mailto:` URL into recipient, subject, and body components.
 */
export function parseMailtoUrl(mailtoUrl: string): ParsedMailtoLink | null {
  if (!isSafeContactUrl(mailtoUrl, 'email')) return null;
  const withoutScheme = mailtoUrl.slice('mailto:'.length);
  const queryIdx = withoutScheme.indexOf('?');
  const rawTo = queryIdx >= 0 ? withoutScheme.slice(0, queryIdx) : withoutScheme;
  const rawQuery = queryIdx >= 0 ? withoutScheme.slice(queryIdx + 1) : '';
  const to = safeDecode(rawTo).trim();
  if (!to || !to.includes('@') || /\s/.test(to)) return null;

  const params = new URLSearchParams(rawQuery);
  const subject = params.get('subject') ?? '';
  const body = params.get('body') ?? '';
  return { to, subject, body };
}

/**
 * Builds a properly encoded Gmail web compose URL from a validated `mailto:` URL.
 */
export function buildGmailComposeUrl(mailtoUrl: string): string | null {
  const parsed = parseMailtoUrl(mailtoUrl);
  if (!parsed) return null;
  const params = new URLSearchParams();
  params.set('view', 'cm');
  params.set('fs', '1');
  params.set('to', parsed.to);
  if (parsed.subject) {
    params.set('su', parsed.subject);
  }
  if (parsed.body) {
    params.set('body', parsed.body);
  }
  return `https://mail.google.com/mail/?${params.toString()}`;
}
