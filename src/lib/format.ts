import type { Gig } from './types';

const nf = new Intl.NumberFormat('fr-FR');

export function formatPay(min: number, max: number): string {
  const lo = nf.format(min);
  if (min === max) return `${lo} DZD`;
  return `${lo}–${nf.format(max)} DZD`;
}

export function timeAgo(gig: Gig, t: (k: string, vars?: Record<string, string | number>) => string): string {
  const created = gig.createdAt;
  if (!created || !created.seconds) return '';
  const diffMs = Date.now() - created.seconds * 1000;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return t('gig.justNow');
  const hours = Math.floor(mins / 60);
  if (hours < 1) return t('gig.minsAgo', { n: mins });
  if (hours < 24) return t('gig.hoursAgo', { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t('gig.daysAgo', { n: days });
  const months = Math.floor(days / 30);
  return t('gig.monthsAgo', { n: months });
}

export function errKey(code: string): string {
  switch (code) {
    case 'auth/invalid-phone-number':
      return 'post.phoneInvalid';
    case 'auth/invalid-verification-code':
      return 'post.codeInvalid';
    case 'auth/code-expired':
    case 'auth/session-expired':
      return 'post.codeExpired';
    case 'auth/too-many-requests':
      return 'post.tooMany';
    case 'auth/invalid-app-credential':
      return 'auth.recaptchaError';
    default:
      return 'common.error';
  }
}
