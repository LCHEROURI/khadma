import type { ContactMethod } from './types';

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
