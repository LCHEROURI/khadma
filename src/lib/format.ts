import type { Gig } from './types';
import { NEIGHBORHOOD_KEYS } from './constants';
import { mapAuthErrorKey } from './employerAuth';
import type { Lang } from './strings';

const nf = new Intl.NumberFormat('fr-FR');
const pluralRulesCache: Partial<Record<Lang, Intl.PluralRules>> = {};

function getPluralRules(lang: Lang): Intl.PluralRules {
  if (!pluralRulesCache[lang]) {
    pluralRulesCache[lang] = new Intl.PluralRules(lang === 'ar' ? 'ar' : 'fr');
  }
  return pluralRulesCache[lang]!;
}

/**
 * Formats a localized listing count with grammatically accurate French and Arabic pluralization.
 * - French: 0 -> "0 annonce", 1 -> "1 annonce", 2+ -> "N annonces"
 * - Arabic: Intl.PluralRules('ar') categories (zero / one / two / few / many / other)
 */
export function formatListingCount(
  count: number,
  lang: Lang,
  t: (k: string, vars?: Record<string, string | number>) => string
): string {
  const safeCount = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
  if (safeCount === 0) return t('browse.resultsZero', { n: 0 });
  if (lang === 'fr') {
    if (safeCount === 1) return t('browse.resultsOne', { n: 1 });
    return t('browse.resultsOther', { n: safeCount });
  }
  const category = getPluralRules('ar').select(safeCount);
  switch (category) {
    case 'zero':
      return t('browse.resultsZero', { n: safeCount });
    case 'one':
      return t('browse.resultsOne', { n: safeCount });
    case 'two':
      return t('browse.resultsTwo', { n: safeCount });
    case 'few':
      return t('browse.resultsFew', { n: safeCount });
    case 'many':
      return t('browse.resultsMany', { n: safeCount });
    default:
      return t('browse.resultsOther', { n: safeCount });
  }
}

export function formatPay(min: number, max: number, currency = 'DZD'): string {
  const lo = nf.format(min);
  if (min === max) return `${lo} ${currency}`;
  return `${lo}–${nf.format(max)} ${currency}`;
}

export function formatNeighborhood(
  name: string,
  t: (k: string, vars?: Record<string, string | number>) => string
): string {
  const key = NEIGHBORHOOD_KEYS[name];
  return key ? t(key) : name;
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
      return mapAuthErrorKey(code);
  }
}
