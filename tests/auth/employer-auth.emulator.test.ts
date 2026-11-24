import { deleteApp, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  signInWithCustomToken,
  type Auth
} from 'firebase/auth';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  linkEmailToLegacyPhoneAccount,
  refreshEmailVerification,
  registerEmployerWithEmail,
  requestPasswordReset,
  resendVerificationEmail,
  resolveEmployerEligibility,
  signInEmployerWithEmail,
  signOutEmployer
} from '../../src/lib/employerAuth';

const PROJECT_ID = 'demo-khadma';
const AUTH_EMULATOR_HOST = 'http://127.0.0.1:9099';

interface EmulatorOobCode {
  email: string;
  requestType: string;
  oobCode: string;
  oobLink: string;
}

interface EmulatorVerificationCode {
  phoneNumber: string;
  code: string;
  sessionInfo: string;
}

async function clearAuthEmulator(): Promise<void> {
  const res = await fetch(`${AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`, {
    method: 'DELETE'
  });
  expect(res.ok).toBe(true);
}

async function getOobCodes(): Promise<EmulatorOobCode[]> {
  const res = await fetch(`${AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/oobCodes`);
  expect(res.ok).toBe(true);
  const data = (await res.json()) as { oobCodes?: EmulatorOobCode[] };
  return data.oobCodes ?? [];
}

async function signInLegacyPhoneOnEmulator(auth: Auth, phoneNumber: string): Promise<string> {
  // Start local emulator phone verification (zero real SMS)
  const startRes = await fetch(
    `${AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:sendVerificationCode?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phoneNumber, recaptchaToken: 'emulator-bypass' })
    }
  );
  expect(startRes.ok).toBe(true);
  const { sessionInfo } = (await startRes.json()) as { sessionInfo: string };

  const codesRes = await fetch(
    `${AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/verificationCodes`
  );
  expect(codesRes.ok).toBe(true);
  const { verificationCodes } = (await codesRes.json()) as {
    verificationCodes?: EmulatorVerificationCode[];
  };
  const match = (verificationCodes ?? []).find(
    (c) => c.phoneNumber === phoneNumber && c.sessionInfo === sessionInfo
  );
  expect(match).toBeDefined();

  // Complete phone sign-in on the Auth Emulator REST API to create a genuine phone-provider user
  const signInRes = await fetch(
    `${AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPhoneNumber?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionInfo, code: match!.code })
    }
  );
  expect(signInRes.ok).toBe(true);
  const { localId } = (await signInRes.json()) as { localId: string };

  // Authenticate the JS SDK as that exact phone user using an unsigned Auth Emulator custom token
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      uid: localId,
      iss: 'firebase-auth-emulator@example.com',
      sub: 'firebase-auth-emulator@example.com',
      aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600
    })
  ).toString('base64url');
  const userCred = await signInWithCustomToken(auth, `${header}.${payload}.`);
  return userCred.user.uid;
}

describe('KHADMA V1.4 Phase 2 — Firebase Auth Emulator Integration', () => {
  let app: FirebaseApp;
  let auth: Auth;

  beforeAll(() => {
    app = initializeApp({ apiKey: 'fake-api-key', projectId: PROJECT_ID }, 'auth-emulator-test');
    auth = getAuth(app);
    connectAuthEmulator(auth, AUTH_EMULATOR_HOST, { disableWarnings: true });
  });

  beforeEach(async () => {
    await signOutEmployer(auth).catch(() => undefined);
    await clearAuthEmulator();
  });

  afterAll(async () => {
    await signOutEmployer(auth).catch(() => undefined);
    await deleteApp(app);
  });

  it('registers a new email employer, blocks until verified, verifies via OOB link, supports login/logout and password reset', async () => {
    const email = 'boulangerie.oran@example.dz';
    const password = 'Password123!';

    // 1. Register -> unverified -> ineligible
    const reg = await registerEmployerWithEmail(auth, email, password);
    expect(reg.verificationSent).toBe(true);
    expect(reg.user.email).toBe(email);
    expect(reg.user.emailVerified).toBe(false);

    const beforeVerify = resolveEmployerEligibility(
      {
        uid: reg.user.uid,
        email: reg.user.email,
        emailVerified: reg.user.emailVerified,
        phoneNumber: reg.user.phoneNumber,
        isAnonymous: reg.user.isAnonymous
      },
      null
    );
    expect(beforeVerify.eligible).toBe(false);
    expect(beforeVerify.needsEmailVerification).toBe(true);

    // 2. Resend verification email
    await resendVerificationEmail(reg.user);
    const oobCodes = await getOobCodes();
    const verifyCode = oobCodes.filter((c) => c.email === email && c.requestType === 'VERIFY_EMAIL').pop();
    expect(verifyCode).toBeDefined();

    // 3. Complete verification via emulator OOB link
    const confirmRes = await fetch(verifyCode!.oobLink);
    expect(confirmRes.ok).toBe(true);

    const verified = await refreshEmailVerification(reg.user);
    expect(verified).toBe(true);

    const afterVerify = resolveEmployerEligibility(
      {
        uid: reg.user.uid,
        email: reg.user.email,
        emailVerified: true,
        phoneNumber: reg.user.phoneNumber,
        isAnonymous: reg.user.isAnonymous
      },
      null
    );
    expect(afterVerify.eligible).toBe(true);
    expect(afterVerify.quotaMax).toBe(3);

    // 4. Sign out, reject wrong password, sign back in with valid password
    await signOutEmployer(auth);
    expect(auth.currentUser).toBeNull();

    await expect(signInEmployerWithEmail(auth, email, 'WrongPass99!')).rejects.toThrow();

    const signedIn = await signInEmployerWithEmail(auth, email, password);
    expect(signedIn.uid).toBe(reg.user.uid);
    expect(signedIn.emailVerified).toBe(true);

    // 5. Password reset issues PASSWORD_RESET OOB code on emulator
    await requestPasswordReset(auth, email);
    const afterResetCodes = await getOobCodes();
    expect(afterResetCodes.some((c) => c.email === email && c.requestType === 'PASSWORD_RESET')).toBe(
      true
    );
  });

  it('preserves legacy phone UID & phone provider during in-app email linking and blocks linking conflicts cleanly', async () => {
    // Seed a conflicting email account first
    const conflictEmail = 'already.taken@example.dz';
    const conflictReg = await registerEmployerWithEmail(auth, conflictEmail, 'Conflict123!');
    const conflictUid = conflictReg.user.uid;
    await signOutEmployer(auth);

    // Sign in as legacy phone employer on Auth Emulator
    const phone = '+213555012345';
    const legacyUid = await signInLegacyPhoneOnEmulator(auth, phone);
    expect(auth.currentUser?.phoneNumber).toBe(phone);
    expect(legacyUid).not.toBe(conflictUid);

    // Attempt to link an email already owned by another account -> MUST FAIL without merging or unlinking
    await expect(
      linkEmailToLegacyPhoneAccount(auth.currentUser!, conflictEmail, 'NewPass123!')
    ).rejects.toMatchObject({
      code: expect.stringMatching(/auth\/(email|credential)-already-in-use/)
    });
    expect(auth.currentUser?.uid).toBe(legacyUid);
    expect(auth.currentUser?.phoneNumber).toBe(phone);

    // Link a fresh email -> preserves exact UID, keeps phone provider intact, sends verification email
    const freshEmail = 'legacy.linked@example.dz';
    const linked = await linkEmailToLegacyPhoneAccount(auth.currentUser!, freshEmail, 'SecurePass123!');
    expect(linked.user.uid).toBe(legacyUid);
    expect(linked.user.phoneNumber).toBe(phone);
    expect(linked.user.email).toBe(freshEmail);
    expect(linked.verificationSent).toBe(true);

    const providerIds = linked.user.providerData.map((p) => p.providerId);
    expect(providerIds).toContain('phone');
    expect(providerIds).toContain('password');

    // Duplicate link attempt -> rejected cleanly
    await expect(
      linkEmailToLegacyPhoneAccount(linked.user, 'second@example.dz', 'Another123!')
    ).rejects.toMatchObject({ code: 'auth/provider-already-linked' });
  });
});
