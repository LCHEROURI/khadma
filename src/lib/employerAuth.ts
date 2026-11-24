import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  linkWithCredential,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type User
} from 'firebase/auth';
import { LEGACY_EMPLOYER_MAX_ACTIVE_GIGS, NEW_EMPLOYER_MAX_ACTIVE_GIGS } from './constants';
import type { EmployerProfile } from './types';

export const VERIFICATION_RESEND_COOLDOWN_MS = 60_000;
export const MIN_PASSWORD_LENGTH = 8;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(input: string): boolean {
  const trimmed = input.trim();
  return trimmed.length > 0 && trimmed.length <= 254 && EMAIL_RE.test(trimmed);
}

export function validatePassword(password: string): 'ok' | 'too_short' {
  return password.length >= MIN_PASSWORD_LENGTH ? 'ok' : 'too_short';
}

export function getRemainingCooldownSeconds(lastSentMs: number | null, nowMs = Date.now()): number {
  if (lastSentMs === null) return 0;
  const remainingMs = VERIFICATION_RESEND_COOLDOWN_MS - (nowMs - lastSentMs);
  return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
}

export function mapAuthErrorKey(code: string): string {
  switch (code) {
    case 'auth/email-already-in-use':
      return 'auth.emailInUse';
    case 'auth/credential-already-in-use':
      return 'auth.credentialInUse';
    case 'auth/provider-already-linked':
      return 'auth.providerAlreadyLinked';
    case 'auth/invalid-email':
      return 'auth.invalidEmail';
    case 'auth/weak-password':
      return 'auth.weakPassword';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'auth.invalidCredentials';
    case 'auth/requires-recent-login':
      return 'auth.requiresRecentLogin';
    case 'auth/too-many-requests':
      return 'post.tooMany';
    case 'auth/network-request-failed':
      return 'auth.networkError';
    default:
      return 'common.error';
  }
}

export interface EmployerIdentityInput {
  uid: string | null;
  email: string | null;
  emailVerified: boolean;
  phoneNumber: string | null;
  isAnonymous: boolean;
}

export type EmployerEligibilityReason =
  | 'unauthenticated'
  | 'email_unverified'
  | 'suspended'
  | 'eligible_email'
  | 'eligible_legacy_phone';

export interface EmployerEligibility {
  eligible: boolean;
  reason: EmployerEligibilityReason;
  isLegacyPhone: boolean;
  isSuspended: boolean;
  needsEmailVerification: boolean;
  needsEmailLink: boolean;
  quotaMax: number;
}

/**
 * Computes client-side display eligibility and quota ceiling from Firebase Auth state
 * and the server-managed `employers/{uid}` document.
 *
 * Security note: All publishing/quota/legacy-cutoff decisions are enforced server-side
 * (Phase 4 `manageEmployerListing` + Firestore Rules). Clients cannot self-assign
 * quotas, trust levels, suspension overrides, or legacy eligibility.
 */
export function resolveEmployerEligibility(
  identity: EmployerIdentityInput,
  profile: EmployerProfile | null
): EmployerEligibility {
  if (!identity.uid || identity.isAnonymous) {
    return {
      eligible: false,
      reason: 'unauthenticated',
      isLegacyPhone: false,
      isSuspended: false,
      needsEmailVerification: false,
      needsEmailLink: false,
      quotaMax: NEW_EMPLOYER_MAX_ACTIVE_GIGS
    };
  }

  const hasPhone = Boolean(identity.phoneNumber);
  const hasEmail = Boolean(identity.email);
  const isLegacyPhone = hasPhone && (profile ? Boolean(profile.legacyPhone) : true);
  const quotaMax =
    typeof profile?.maxActiveGigs === 'number' && profile.maxActiveGigs >= 0
      ? profile.maxActiveGigs
      : isLegacyPhone
        ? LEGACY_EMPLOYER_MAX_ACTIVE_GIGS
        : NEW_EMPLOYER_MAX_ACTIVE_GIGS;

  if (profile?.suspended === true) {
    return {
      eligible: false,
      reason: 'suspended',
      isLegacyPhone,
      isSuspended: true,
      needsEmailVerification: hasEmail && !identity.emailVerified,
      needsEmailLink: hasPhone && !hasEmail,
      quotaMax
    };
  }

  if (hasEmail && identity.emailVerified) {
    return {
      eligible: true,
      reason: 'eligible_email',
      isLegacyPhone,
      isSuspended: false,
      needsEmailVerification: false,
      needsEmailLink: false,
      quotaMax
    };
  }

  if (hasPhone) {
    return {
      eligible: true,
      reason: 'eligible_legacy_phone',
      isLegacyPhone: true,
      isSuspended: false,
      needsEmailVerification: hasEmail && !identity.emailVerified,
      needsEmailLink: !hasEmail,
      quotaMax
    };
  }

  return {
    eligible: false,
    reason: 'email_unverified',
    isLegacyPhone: false,
    isSuspended: false,
    needsEmailVerification: true,
    needsEmailLink: false,
    quotaMax
  };
}

export async function registerEmployerWithEmail(
  authInstance: Auth,
  email: string,
  password: string
): Promise<{ user: User; verificationSent: boolean }> {
  const cred = await createUserWithEmailAndPassword(authInstance, email.trim(), password);
  let verificationSent = false;
  try {
    await sendEmailVerification(cred.user);
    verificationSent = true;
  } catch {
    // User account is created; caller shows resend UI cleanly without losing session.
    verificationSent = false;
  }
  return { user: cred.user, verificationSent };
}

export async function signInEmployerWithEmail(
  authInstance: Auth,
  email: string,
  password: string
): Promise<User> {
  const cred = await signInWithEmailAndPassword(authInstance, email.trim(), password);
  return cred.user;
}

export async function signOutEmployer(authInstance: Auth): Promise<void> {
  await signOut(authInstance);
}

export async function requestPasswordReset(authInstance: Auth, email: string): Promise<void> {
  await sendPasswordResetEmail(authInstance, email.trim());
}

export async function resendVerificationEmail(user: User): Promise<void> {
  await sendEmailVerification(user);
}

export async function refreshEmailVerification(user: User): Promise<boolean> {
  await user.reload();
  await user.getIdToken(true);
  return Boolean(user.emailVerified);
}

/**
 * Securely links an Email/Password credential to an existing legacy phone-authenticated
 * Firebase user while preserving the exact UID, listing ownership, and phone provider.
 * Never unlinks phone credentials or merges conflicting accounts.
 */
export async function linkEmailToLegacyPhoneAccount(
  user: User,
  email: string,
  password: string
): Promise<{ user: User; verificationSent: boolean }> {
  const credential = EmailAuthProvider.credential(email.trim(), password);
  const result = await linkWithCredential(user, credential);
  let verificationSent = false;
  try {
    await sendEmailVerification(result.user);
    verificationSent = true;
  } catch {
    verificationSent = false;
  }
  return { user: result.user, verificationSent };
}
