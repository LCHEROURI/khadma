import { describe, expect, it } from 'vitest';
import type { Auth } from 'firebase/auth';
import {
  buildActionCodeSettings,
  mapActionCodeErrorKey,
  parseAuthActionParams,
  resolveSafeReturnPath
} from '../../src/lib/authAction';
import { syncAuthLanguage } from '../../src/lib/employerAuth';

describe('KHADMA V1.4 Phase 6B.1 — Branded Auth Action helpers', () => {
  it('parses standard verifyEmail and resetPassword query parameters', () => {
    const parsed = parseAuthActionParams(
      '?mode=verifyEmail&oobCode=abc123&lang=ar&continueUrl=https%3A%2F%2Fkhadma-oran-staging.web.app%2Femployer%3Fverified%3D1'
    );
    expect(parsed).toEqual({
      mode: 'verifyEmail',
      oobCode: 'abc123',
      continueUrl: 'https://khadma-oran-staging.web.app/employer?verified=1',
      lang: 'ar'
    });
  });

  it('recovers HTML-encoded &amp; separators from wrapped email client links', () => {
    const parsed = parseAuthActionParams(
      '?mode=verifyEmail&amp;oobCode=xyz789&amp;lang=fr&amp;continueUrl=%2Femployer'
    );
    expect(parsed.mode).toBe('verifyEmail');
    expect(parsed.oobCode).toBe('xyz789');
    expect(parsed.lang).toBe('fr');
    expect(parsed.continueUrl).toBe('/employer');
  });

  it('returns empty mode/oobCode cleanly when parameters are missing or invalid', () => {
    expect(parseAuthActionParams('')).toEqual({
      mode: '',
      oobCode: '',
      continueUrl: null,
      lang: null
    });
    expect(parseAuthActionParams('?mode=invalidMode')).toEqual({
      mode: 'invalidMode',
      oobCode: '',
      continueUrl: null,
      lang: null
    });
  });

  it('prevents open redirects by enforcing same-origin return paths', () => {
    const origin = 'https://khadma-oran-staging.web.app';
    expect(
      resolveSafeReturnPath('https://khadma-oran-staging.web.app/employer?verified=1', origin)
    ).toBe('/employer?verified=1');
    expect(resolveSafeReturnPath('/employer', origin)).toBe('/employer');
    expect(resolveSafeReturnPath('https://evil.example.com/phish', origin)).toBe('/employer');
    expect(resolveSafeReturnPath('javascript:alert(1)', origin)).toBe('/employer');
    expect(resolveSafeReturnPath('//evil.example.com/phish', origin)).toBe('/employer');
    expect(resolveSafeReturnPath(null, origin, '/employer')).toBe('/employer');
  });

  it('maps Firebase Auth action code errors to localized user-safe keys', () => {
    expect(mapActionCodeErrorKey('auth/expired-action-code')).toBe('authAction.errorExpired');
    expect(mapActionCodeErrorKey('auth/invalid-action-code')).toBe('authAction.errorInvalid');
    expect(mapActionCodeErrorKey('auth/user-disabled')).toBe('authAction.errorUserDisabled');
    expect(mapActionCodeErrorKey('auth/network-request-failed')).toBe('auth.networkError');
    expect(mapActionCodeErrorKey('auth/unknown')).toBe('authAction.errorGeneric');
  });

  it('builds ActionCodeSettings with same-origin employer return URL', () => {
    const settings = buildActionCodeSettings('https://khadma-oran-staging.web.app');
    expect(settings).toBeDefined();
    expect(settings!.url).toBe('https://khadma-oran-staging.web.app/employer?verified=1');
    expect(settings!.handleCodeInApp).toBe(false);
  });

  it('syncs Firebase Auth languageCode with active app language', () => {
    const fakeAuth = { languageCode: null } as unknown as Auth;
    syncAuthLanguage(fakeAuth, 'fr');
    expect(fakeAuth.languageCode).toBe('fr');
    syncAuthLanguage(fakeAuth, 'ar');
    expect(fakeAuth.languageCode).toBe('ar');
  });
});
