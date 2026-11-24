import { describe, expect, it } from 'vitest';
import {
  getRemainingCooldownSeconds,
  isValidEmail,
  mapAuthErrorKey,
  resolveEmployerEligibility,
  validatePassword,
  VERIFICATION_RESEND_COOLDOWN_MS
} from '../../src/lib/employerAuth';
import type { EmployerProfile } from '../../src/lib/types';

function makeProfile(overrides: Partial<EmployerProfile> = {}): EmployerProfile {
  return {
    uid: 'u1',
    email: 'emp@oran.dz',
    legacyPhone: null,
    maxActiveGigs: 3,
    activeCount: 1,
    trustLevel: 'new',
    suspended: false,
    createdAt: null,
    updatedAt: null,
    ...overrides
  };
}

describe('KHADMA V1.4 Phase 2 — Employer Auth & Identity', () => {
  it('validates email format, minimum password length, and resend cooldown timer', () => {
    expect(isValidEmail('contact@oran-entreprise.dz')).toBe(true);
    expect(isValidEmail('  user+1@gmail.com  ')).toBe(true);
    expect(isValidEmail('invalid-email')).toBe(false);
    expect(isValidEmail('')).toBe(false);

    expect(validatePassword('1234567')).toBe('too_short');
    expect(validatePassword('12345678')).toBe('ok');

    const t0 = 1_700_000_000_000;
    expect(getRemainingCooldownSeconds(null, t0)).toBe(0);
    expect(getRemainingCooldownSeconds(t0, t0)).toBe(60);
    expect(getRemainingCooldownSeconds(t0, t0 + 15_200)).toBe(45);
    expect(getRemainingCooldownSeconds(t0, t0 + VERIFICATION_RESEND_COOLDOWN_MS)).toBe(0);
  });

  it('maps Firebase Auth and credential linking error codes to localized string keys', () => {
    expect(mapAuthErrorKey('auth/email-already-in-use')).toBe('auth.emailInUse');
    expect(mapAuthErrorKey('auth/credential-already-in-use')).toBe('auth.credentialInUse');
    expect(mapAuthErrorKey('auth/provider-already-linked')).toBe('auth.providerAlreadyLinked');
    expect(mapAuthErrorKey('auth/requires-recent-login')).toBe('auth.requiresRecentLogin');
    expect(mapAuthErrorKey('auth/weak-password')).toBe('auth.weakPassword');
    expect(mapAuthErrorKey('auth/invalid-credential')).toBe('auth.invalidCredentials');
    expect(mapAuthErrorKey('auth/too-many-requests')).toBe('post.tooMany');
    expect(mapAuthErrorKey('auth/network-request-failed')).toBe('auth.networkError');
    expect(mapAuthErrorKey('auth/unknown')).toBe('common.error');
  });

  it('enforces verified-email eligibility, 3-ad new quota, 5-ad legacy quota, and suspension blocks', () => {
    // Unauthenticated & anonymous cannot publish
    expect(
      resolveEmployerEligibility(
        { uid: null, email: null, emailVerified: false, phoneNumber: null, isAnonymous: false },
        null
      )
    ).toMatchObject({ eligible: false, reason: 'unauthenticated', quotaMax: 3 });

    expect(
      resolveEmployerEligibility(
        { uid: 'anon-1', email: null, emailVerified: false, phoneNumber: null, isAnonymous: true },
        null
      )
    ).toMatchObject({ eligible: false, reason: 'unauthenticated', quotaMax: 3 });

    // Unverified email is blocked until verified
    expect(
      resolveEmployerEligibility(
        { uid: 'e1', email: 'new@oran.dz', emailVerified: false, phoneNumber: null, isAnonymous: false },
        null
      )
    ).toMatchObject({
      eligible: false,
      reason: 'email_unverified',
      needsEmailVerification: true,
      quotaMax: 3
    });

    // Verified new email employer receives 3-ad quota
    expect(
      resolveEmployerEligibility(
        { uid: 'e1', email: 'new@oran.dz', emailVerified: true, phoneNumber: null, isAnonymous: false },
        null
      )
    ).toMatchObject({
      eligible: true,
      reason: 'eligible_email',
      isLegacyPhone: false,
      needsEmailLink: false,
      quotaMax: 3
    });

    // Legacy phone employer retains 5-ad quota and gets non-blocking link prompt
    expect(
      resolveEmployerEligibility(
        { uid: 'p1', email: null, emailVerified: false, phoneNumber: '+213555010000', isAnonymous: false },
        null
      )
    ).toMatchObject({
      eligible: true,
      reason: 'eligible_legacy_phone',
      isLegacyPhone: true,
      needsEmailLink: true,
      quotaMax: 5
    });

    // Server-controlled admin quota override & suspension are respected
    expect(
      resolveEmployerEligibility(
        { uid: 'e1', email: 'new@oran.dz', emailVerified: true, phoneNumber: null, isAnonymous: false },
        makeProfile({ maxActiveGigs: 8, suspended: false })
      )
    ).toMatchObject({ eligible: true, quotaMax: 8 });

    expect(
      resolveEmployerEligibility(
        { uid: 'e1', email: 'new@oran.dz', emailVerified: true, phoneNumber: null, isAnonymous: false },
        makeProfile({ suspended: true })
      )
    ).toMatchObject({ eligible: false, reason: 'suspended', isSuspended: true });
  });
});
