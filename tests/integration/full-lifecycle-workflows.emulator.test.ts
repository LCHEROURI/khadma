import { beforeEach, describe, expect, it } from 'vitest';
import { handleManageEmployerListing } from '../../functions/src/listingHandler';
import { ADMIN_EMAIL, handleAdminManageMarketplace } from '../../functions/src/adminHandler';
import { handleGetGigContactLink } from '../../functions/src/contactHandler';
import {
  LISTING_LIFESPAN_MS,
  LISTING_RENEWAL_WINDOW_MS,
  MARKETPLACE_SETTINGS_DOC_ID,
  SETTINGS_COLLECTION
} from '../../functions/src/types';
import { initMarketplaceSettings } from '../../scripts/migrate-legacy-employers.mjs';
import {
  AUTH_HOST,
  clearAuthEmulator,
  clearFirestoreEmulator,
  createFirestoreEmulatorStores,
  getEmulatorAuth,
  PROJECT_ID
} from './emulatorAdapters';

const NOW = 1_760_000_000_000;

async function registerEmailUserInAuthEmulator(
  email: string,
  password: string
): Promise<{ uid: string; idToken: string }> {
  const res = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true })
    }
  );
  if (!res.ok) throw new Error(`Auth signUp failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { localId: string; idToken: string };
  return { uid: data.localId, idToken: data.idToken };
}

async function verifyEmailViaEmulatorOob(idToken: string, email: string): Promise<void> {
  // 1. Request OOB email verification code
  const sendRes = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'VERIFY_EMAIL', idToken })
    }
  );
  if (!sendRes.ok) throw new Error(`sendOobCode failed: ${sendRes.status}`);

  // 2. Read generated OOB code from Auth Emulator inspection endpoint
  const oobRes = await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/oobCodes`);
  const oobData = (await oobRes.json()) as {
    oobCodes: Array<{ email: string; oobCode: string; requestType: string }>;
  };
  const match = oobData.oobCodes.find(
    (c) => c.email.toLowerCase() === email.toLowerCase() && c.requestType === 'VERIFY_EMAIL'
  );
  if (!match) throw new Error(`No VERIFY_EMAIL oobCode found for ${email}`);

  // 3. Apply OOB code to mark email verified in Auth Emulator
  const applyRes = await fetch(
    `http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:update?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oobCode: match.oobCode })
    }
  );
  if (!applyRes.ok) throw new Error(`verifyEmail apply failed: ${applyRes.status}`);
}

function validListingPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: 'create',
    title: 'Serveur restaurant — Canastel',
    description: 'Service midi et soir à Canastel, Oran. Expérience souhaitée.',
    category: 'restaurant',
    listingType: 'job',
    payMin: 2500,
    payMax: 3500,
    neighborhood: 'Canastel',
    city: 'oran',
    wilayaCode: '31',
    contactMethods: ['whatsapp', 'email'],
    contactPhone: '0551 22 33 44',
    whatsappConsent: true,
    contactEmail: 'resto@canastel-oran.dz',
    emailConsent: true,
    ...overrides
  };
}

describe('Complete Integrated Workflows (Firebase Auth Emulator + Firestore Emulator)', () => {
  beforeEach(async () => {
    await Promise.all([clearFirestoreEmulator(), clearAuthEmulator()]);
  });

  it('executes complete Employer Workflow end-to-end (register -> verify -> provision -> publish -> contact -> edit -> consent revoke -> archive -> republish -> renew -> quota)', async () => {
    const { db, listingStore, contactStore } = createFirestoreEmulatorStores();
    const auth = getEmulatorAuth();

    // 0. Explicitly initialize settings/marketplace via migration (launch policy: requirePreApproval: false)
    const migrationRes = await initMarketplaceSettings({
      store: {
        async getModerationSettings() {
          const snap = await db.collection(SETTINGS_COLLECTION).doc(MARKETPLACE_SETTINGS_DOC_ID).get();
          return snap.exists ? (snap.data() as Record<string, unknown>) : null;
        },
        async setModerationSettings(data: Record<string, unknown>) {
          await db.collection(SETTINGS_COLLECTION).doc(MARKETPLACE_SETTINGS_DOC_ID).set(data);
        }
      },
      apply: true,
      nowMs: NOW
    });
    expect(migrationRes).toEqual({ initialized: true, alreadyExists: false, apply: true });

    // 1. Register new email/password employer in Auth Emulator (unverified initially)
    const { uid, idToken } = await registerEmailUserInAuthEmulator(
      'employeur.e2e@oran.dz',
      'StrongPass!2026'
    );
    const unverifiedUser = await auth.getUser(uid);
    expect(unverifiedUser.emailVerified).toBe(false);

    // Unverified employer cannot publish
    await expect(
      handleManageEmployerListing(listingStore, {
        authUid: unverifiedUser.uid,
        authEmail: unverifiedUser.email ?? null,
        authEmailVerified: unverifiedUser.emailVerified,
        authPhone: null,
        hasAppCheck: true,
        payload: validListingPayload(),
        nowMs: NOW
      })
    ).rejects.toMatchObject({ code: 'permission-denied' });

    // 2. Complete email verification via Auth Emulator OOB flow
    await verifyEmailViaEmulatorOob(idToken, 'employeur.e2e@oran.dz');
    const verifiedUser = await auth.getUser(uid);
    expect(verifiedUser.emailVerified).toBe(true);

    // 3. Create first ad -> provisions employers/{uid} (quota 3) & publishes immediately (active)
    const ad1 = await handleManageEmployerListing(listingStore, {
      authUid: verifiedUser.uid,
      authEmail: verifiedUser.email ?? null,
      authEmailVerified: verifiedUser.emailVerified,
      authPhone: null,
      hasAppCheck: true,
      payload: validListingPayload({ idempotencyKey: 'e2e_emp_create_1' }),
      nowMs: NOW
    });
    expect(ad1.status).toBe('active');
    expect(ad1.quotaMax).toBe(3);
    expect(ad1.quotaUsed).toBe(1);
    expect(ad1.expiresAtMs).toBe(NOW + LISTING_LIFESPAN_MS);

    // 4. Unauthenticated job seeker requests WhatsApp & Email contact links -> BOTH succeed
    const waContact = await handleGetGigContactLink(contactStore, {
      authUid: null,
      hasAppCheck: true,
      clientIp: '198.51.100.21',
      gigId: ad1.gigId,
      channel: 'whatsapp',
      lang: 'fr',
      nowMs: NOW + 1000
    });
    expect(waContact.url).toContain('https://wa.me/213551223344');

    const mailContact = await handleGetGigContactLink(contactStore, {
      authUid: null,
      hasAppCheck: true,
      clientIp: '198.51.100.21',
      gigId: ad1.gigId,
      channel: 'email',
      lang: 'ar',
      nowMs: NOW + 1500
    });
    expect(mailContact.url).toContain('mailto:resto@canastel-oran.dz');

    // 5. Employer edits listing (moderation OFF -> stays active)
    const edited = await handleManageEmployerListing(listingStore, {
      authUid: verifiedUser.uid,
      authEmail: verifiedUser.email ?? null,
      authEmailVerified: verifiedUser.emailVerified,
      authPhone: null,
      hasAppCheck: true,
      payload: {
        action: 'edit',
        gigId: ad1.gigId,
        title: 'Chef de rang — Canastel',
        description: 'Service soir uniquement, bonne rémunération.',
        category: 'restaurant',
        listingType: 'job',
        payMin: 3000,
        payMax: 4000,
        neighborhood: 'Canastel'
      },
      nowMs: NOW + 2000
    });
    expect(edited.status).toBe('active');

    // 6. Employer updates contact & revokes email consent
    await handleManageEmployerListing(listingStore, {
      authUid: verifiedUser.uid,
      authEmail: verifiedUser.email ?? null,
      authEmailVerified: verifiedUser.emailVerified,
      authPhone: null,
      hasAppCheck: true,
      payload: {
        action: 'updateContact',
        gigId: ad1.gigId,
        contactMethods: ['whatsapp'],
        contactPhone: '0551 22 33 44',
        whatsappConsent: true
      },
      nowMs: NOW + 3000
    });

    // Revoked email channel is immediately blocked; WhatsApp still works
    await expect(
      handleGetGigContactLink(contactStore, {
        authUid: null,
        hasAppCheck: true,
        clientIp: '198.51.100.22',
        gigId: ad1.gigId,
        channel: 'email',
        lang: 'fr',
        nowMs: NOW + 3500
      })
    ).rejects.toMatchObject({ code: 'not-found' });

    // 7. Archive listing -> activeCount drops to 0, contact link denied
    const archived = await handleManageEmployerListing(listingStore, {
      authUid: verifiedUser.uid,
      authEmail: verifiedUser.email ?? null,
      authEmailVerified: verifiedUser.emailVerified,
      authPhone: null,
      hasAppCheck: true,
      payload: { action: 'archive', gigId: ad1.gigId },
      nowMs: NOW + 4000
    });
    expect(archived.status).toBe('archived');
    expect(archived.quotaUsed).toBe(0);

    await expect(
      handleGetGigContactLink(contactStore, {
        authUid: null,
        hasAppCheck: true,
        clientIp: '198.51.100.23',
        gigId: ad1.gigId,
        channel: 'whatsapp',
        lang: 'fr',
        nowMs: NOW + 4500
      })
    ).rejects.toMatchObject({ code: 'not-found' });

    // 8. Republish listing -> active again with fresh 30-day expiry
    const repubTime = NOW + 5000;
    const republished = await handleManageEmployerListing(listingStore, {
      authUid: verifiedUser.uid,
      authEmail: verifiedUser.email ?? null,
      authEmailVerified: verifiedUser.emailVerified,
      authPhone: null,
      hasAppCheck: true,
      payload: { action: 'republish', gigId: ad1.gigId },
      nowMs: repubTime
    });
    expect(republished.status).toBe('active');
    expect(republished.quotaUsed).toBe(1);
    expect(republished.expiresAtMs).toBe(repubTime + LISTING_LIFESPAN_MS);

    // 9. Renew inside final 7 days -> extends by 30 days
    const renewTime = republished.expiresAtMs! - LISTING_RENEWAL_WINDOW_MS + 60_000;
    const renewed = await handleManageEmployerListing(listingStore, {
      authUid: verifiedUser.uid,
      authEmail: verifiedUser.email ?? null,
      authEmailVerified: verifiedUser.emailVerified,
      authPhone: null,
      hasAppCheck: true,
      payload: { action: 'renew', gigId: ad1.gigId },
      nowMs: renewTime
    });
    expect(renewed.expiresAtMs).toBe(republished.expiresAtMs! + LISTING_LIFESPAN_MS);

    // 10. Reach 3-ad quota limit, confirm 4th ad rejected
    for (let i = 2; i <= 3; i++) {
      await handleManageEmployerListing(listingStore, {
        authUid: verifiedUser.uid,
        authEmail: verifiedUser.email ?? null,
        authEmailVerified: verifiedUser.emailVerified,
        authPhone: null,
        hasAppCheck: true,
        payload: validListingPayload({ title: `Annonce Quota ${i}` }),
        nowMs: renewTime + i * 100
      });
    }
    await expect(
      handleManageEmployerListing(listingStore, {
        authUid: verifiedUser.uid,
        authEmail: verifiedUser.email ?? null,
        authEmailVerified: verifiedUser.emailVerified,
        authPhone: null,
        hasAppCheck: true,
        payload: validListingPayload({ title: 'Annonce Quota 4 Bloquée' }),
        nowMs: renewTime + 1000
      })
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
  });

  it('executes complete Moderation-Enabled & Suspension Workflow end-to-end', async () => {
    const { db, listingStore, adminStore, contactStore } = createFirestoreEmulatorStores();
    const auth = getEmulatorAuth();

    // Register & verify admin + employer in Auth Emulator
    const adminSignup = await registerEmailUserInAuthEmulator(ADMIN_EMAIL, 'AdminStrong!2026');
    await verifyEmailViaEmulatorOob(adminSignup.idToken, ADMIN_EMAIL);
    const adminUser = await auth.getUser(adminSignup.uid);

    const empSignup = await registerEmailUserInAuthEmulator('mod.emp@oran.dz', 'EmpStrong!2026');
    await verifyEmailViaEmulatorOob(empSignup.idToken, 'mod.emp@oran.dz');
    const empUser = await auth.getUser(empSignup.uid);

    // 1. Admin enables mandatory pre-approval at runtime
    await handleAdminManageMarketplace(adminStore, {
      authUid: adminUser.uid,
      authEmail: adminUser.email ?? null,
      authEmailVerified: adminUser.emailVerified,
      hasAppCheck: true,
      payload: {
        action: 'updateModerationSettings',
        requirePreApproval: true,
        remoderateMaterialEdits: true
      },
      nowMs: NOW
    });

    // 2. Employer creates ad -> enters pending (expiresAt: null)
    const pendingAd = await handleManageEmployerListing(listingStore, {
      authUid: empUser.uid,
      authEmail: empUser.email ?? null,
      authEmailVerified: empUser.emailVerified,
      authPhone: null,
      hasAppCheck: true,
      payload: validListingPayload({ title: 'Annonce Modérée Oran' }),
      nowMs: NOW + 1000
    });
    expect(pendingAd.status).toBe('pending');
    expect(pendingAd.expiresAtMs).toBeNull();

    // 3. Pending ad is inaccessible to unauthenticated job seekers for contact
    await expect(
      handleGetGigContactLink(contactStore, {
        authUid: null,
        hasAppCheck: true,
        clientIp: '198.51.100.31',
        gigId: pendingAd.gigId,
        channel: 'whatsapp',
        lang: 'fr',
        nowMs: NOW + 1500
      })
    ).rejects.toMatchObject({ code: 'not-found' });

    // 4. Admin approves ad -> active with 30-day expiration
    const approveTime = NOW + 2000;
    await handleAdminManageMarketplace(adminStore, {
      authUid: adminUser.uid,
      authEmail: adminUser.email ?? null,
      authEmailVerified: adminUser.emailVerified,
      hasAppCheck: true,
      payload: { action: 'approveGig', gigId: pendingAd.gigId },
      nowMs: approveTime
    });
    const approvedDoc = (await db.collection('gigs').doc(pendingAd.gigId).get()).data()!;
    expect(approvedDoc.status).toBe('active');

    // 5. Approved ad is now contactable by unauthenticated job seekers
    const contactRes = await handleGetGigContactLink(contactStore, {
      authUid: null,
      hasAppCheck: true,
      clientIp: '198.51.100.32',
      gigId: pendingAd.gigId,
      channel: 'whatsapp',
      lang: 'fr',
      nowMs: approveTime + 500
    });
    expect(contactRes.url).toContain('https://wa.me/213551223344');

    // 6. Admin suspends employer -> atomically hides active ads & blocks contact & mutations
    const suspRes = await handleAdminManageMarketplace(adminStore, {
      authUid: adminUser.uid,
      authEmail: adminUser.email ?? null,
      authEmailVerified: adminUser.emailVerified,
      hasAppCheck: true,
      payload: { action: 'suspendEmployer', employerUid: empUser.uid, reason: 'Fraud report' },
      nowMs: approveTime + 1000
    });
    expect(suspRes.hiddenActiveCount).toBe(1);

    await expect(
      handleGetGigContactLink(contactStore, {
        authUid: null,
        hasAppCheck: true,
        clientIp: '198.51.100.33',
        gigId: pendingAd.gigId,
        channel: 'whatsapp',
        lang: 'fr',
        nowMs: approveTime + 1500
      })
    ).rejects.toMatchObject({ code: 'not-found' });

    // 7. Admin reinstates employer -> previously hidden ad remains hidden (not auto-republished)
    await handleAdminManageMarketplace(adminStore, {
      authUid: adminUser.uid,
      authEmail: adminUser.email ?? null,
      authEmailVerified: adminUser.emailVerified,
      hasAppCheck: true,
      payload: {
        action: 'reinstateEmployer',
        employerUid: empUser.uid,
        reason: 'Appeal approved after review'
      },
      nowMs: approveTime + 2000
    });
    const afterReinstate = (await db.collection('gigs').doc(pendingAd.gigId).get()).data()!;
    expect(afterReinstate.status).toBe('hidden');
  });
});
