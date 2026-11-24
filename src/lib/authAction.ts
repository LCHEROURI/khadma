import type { ActionCodeSettings } from 'firebase/auth';
import type { Lang } from './strings';

export type SupportedAuthActionMode = 'verifyEmail' | 'resetPassword';

export interface ParsedAuthActionParams {
  mode: string;
  oobCode: string;
  lang: Lang | null;
  continueUrl: string | null;
}

/**
 * Parses Firebase Authentication email action query parameters defensively.
 * Recovers cleanly even if an email client or redirect HTML-escaped `&amp;` in the query string.
 */
export function parseAuthActionParams(search: string): ParsedAuthActionParams {
  const normalized = search.replace(/&amp;/gi, '&');
  const params = new URLSearchParams(normalized.startsWith('?') ? normalized : `?${normalized}`);
  const mode = (params.get('mode') ?? '').trim();
  const oobCode = (params.get('oobCode') ?? '').trim();
  const rawLang = (params.get('lang') ?? '').trim().toLowerCase();
  const lang: Lang | null = rawLang.startsWith('ar')
    ? 'ar'
    : rawLang.startsWith('fr')
      ? 'fr'
      : null;
  const rawContinue = params.get('continueUrl');
  const continueUrl = rawContinue && rawContinue.trim() ? rawContinue.trim() : null;
  return { mode, oobCode, lang, continueUrl };
}

/**
 * Validates `continueUrl` and returns a strictly same-origin internal path (preventing open redirects).
 */
export function resolveSafeReturnPath(
  continueUrl: string | null | undefined,
  currentOrigin: string,
  fallback = '/employer'
): string {
  if (!continueUrl) return fallback;
  const trimmed = continueUrl.trim();
  if (!trimmed) return fallback;

  // Allow safe internal relative paths like `/employer` or `/employer/post` (never `//evil.com`)
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    const base = new URL(currentOrigin);
    if (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      parsed.origin === base.origin
    ) {
      const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
      return path.startsWith('/') && !path.startsWith('//') ? path : fallback;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

export function mapActionCodeErrorKey(code: string): string {
  switch (code) {
    case 'auth/expired-action-code':
      return 'authAction.errorExpired';
    case 'auth/invalid-action-code':
    case 'auth/user-not-found':
      return 'authAction.errorInvalid';
    case 'auth/user-disabled':
      return 'authAction.errorUserDisabled';
    case 'auth/weak-password':
      return 'auth.weakPassword';
    case 'auth/network-request-failed':
      return 'auth.networkError';
    default:
      return 'authAction.errorGeneric';
  }
}

export function buildActionCodeSettings(
  origin?: string,
  returnPath = '/employer?verified=1'
): ActionCodeSettings | undefined {
  const resolvedOrigin =
    origin ?? (typeof window !== 'undefined' && window.location ? window.location.origin : '');
  if (!resolvedOrigin || !/^https?:\/\//i.test(resolvedOrigin)) {
    return undefined;
  }
  const safePath = returnPath.startsWith('/') && !returnPath.startsWith('//') ? returnPath : '/employer';
  return {
    url: `${resolvedOrigin}${safePath}`,
    handleCodeInApp: false
  };
}
