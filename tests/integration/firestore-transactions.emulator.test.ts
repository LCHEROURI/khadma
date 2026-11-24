import { beforeEach, describe, expect, it } from 'vitest';
import { handleManageEmployerListing } from '../../functions/src/listingHandler';
import { ADMIN_EMAIL, handleAdminManageMarketplace } from '../../functions/src/adminHandler';
import { runExpireStaleGigs } from '../../functions/src/expirationHandler';
import { handleGetGigContactLink } from '../../functions/src/contactHandler';
import {
  LISTING_LIFESPAN_MS,
  MARKETPLACE_SETTINGS_DOC_ID,
  SETTINGS_COLLECTION
} from '../../functions/src/types';
import {
  clearFirestoreEmulator,
  createFirestoreEmulatorStores
} from './emulatorAdapters';

const NOW = 1_760_000_000_000;

function validCreatePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: 'create',
    title: 'Plombier qualifié — Bir El Djir',
    description: 'Installation sanitaire résidentielle, paiement hebdomadaire.',
    category: 'construction',
    listingType: 'job',
    payMin: 3500,
    payMax: 5000,
    neighborhood: 'Bir El Djir',
    city: 'oran',
    wilayaCode: '31',
    contactMethods: ['whatsapp', 'email'],
    contactPhone: '0550 11 22 33',
    whatsappConsent: true,
    contactEmail: 'contact@oran-plomb.dz',
    emailConsent: true,
    ...overrides
  };
}

describe('Real Firestore Emulator Transactions — Concurrency, Atomicity, Fail-Safe & Backlog', () => {
  beforeEach(async () => {
    await clearFirestoreEmulator();
  });

  it('enforces quota boundary under 5 real concurrent Firestore transactions (strictly 1 succeeds, 4 rejected)', async () => {
    const { db, listingStore } = createFirestoreEmulatorStores();
    await db
      .collection(SETTINGS_COLLECTION)
      .doc(MARKETPLACE_SETTINGS_DOC_ID)
      .set({ requirePreApproval: false, remoderateMaterialEdits: true });

    // Create 2 ads first (1 slot remaining out of 3)
    for (let i = 0; i < 2; i++) {
      await handleManageEmployerListing(listingStore, {
        authUid: 'u_conc_tx',
        authEmail: 'conc@oran.dz',
        authEmailVerified: true,
        authPhone: null,
        hasAppCheck: true,
        payload: validCreatePayload({ title: `Initial Ad ${i + 1}` }),
        nowMs: NOW + i
      });
    }

    // Fire 5 parallel real Firestore transactions for the single remaining slot
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, idx) =>
        handleManageEmployerListing(listingStore, {
          authUid: 'u_conc_tx',
          authEmail: 'conc@oran.dz',
          authEmailVerified: true,
          authPhone: null,
          hasAppCheck: true,
          payload: validCreatePayload({ title: `Parallel Ad ${idx}` }),
          nowMs: NOW + 100 + idx
        })
      )
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(4);

    // Verify Firestore ground truth: activeCount === 3 and actual gigs count === 3
    const empSnap = await db.collection('employers').doc('u_conc_tx').get();
    expect(empSnap.data()?.activeCount).toBe(3);

    const gigsSnap = await db.collection('gigs').where('posterUid', '==', 'u_conc_tx').get();
    expect(gigsSnap.size).toBe(3);

    // Verify atomic gig + gigContacts persistence with zero PII in public gigs
    for (const doc of gigsSnap.docs) {
      expect(JSON.stringify(doc.data())).not.toContain('213550112233');
      expect(JSON.stringify(doc.data())).not.toContain('contact@oran-plomb.dz');
      const contactSnap = await db.collection('gigContacts').doc(doc.id).get();
      expect(contactSnap.exists).toBe(true);
      expect(contactSnap.data()?.contactPhone).toBe('+213550112233');
    }
  });

  it('enforces real Firestore idempotency replay and rejects different payload with same key', async () => {
    const { db, listingStore } = createFirestoreEmulatorStores();
    await db
      .collection(SETTINGS_COLLECTION)
      .doc(MARKETPLACE_SETTINGS_DOC_ID)
      .set({ requirePreApproval: false, remoderateMaterialEdits: true });

    const first = await handleManageEmployerListing(listingStore, {
      authUid: 'u_idem_tx',
      authEmail: 'idemtx@oran.dz',
      authEmailVerified: true,
      authPhone: null,
      hasAppCheck: true,
      payload: validCreatePayload({ idempotencyKey: 'emul_idem_001', title: 'Titre Exact' }),
      nowMs: NOW
    });

    const replay = await handleManageEmployerListing(listingStore, {
      authUid: 'u_idem_tx',
      authEmail: 'idemtx@oran.dz',
      authEmailVerified: true,
      authPhone: null,
      hasAppCheck: true,
      payload: validCreatePayload({ idempotencyKey: 'emul_idem_001', title: 'Titre Exact' }),
      nowMs: NOW + 1000
    });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.gigId).toBe(first.gigId);

    await expect(
      handleManageEmployerListing(listingStore, {
        authUid: 'u_idem_tx',
        authEmail: 'idemtx@oran.dz',
        authEmailVerified: true,
        authPhone: null,
        hasAppCheck: true,
        payload: validCreatePayload({ idempotencyKey: 'emul_idem_001', title: 'Titre Différent' }),
        nowMs: NOW + 2000
      })
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    const gigsSnap = await db.collection('gigs').where('posterUid', '==', 'u_idem_tx').get();
    expect(gigsSnap.size).toBe(1);
  });

  it('handles concurrent renewal vs expiration safely on real Firestore and detects expiration backlog', async () => {
    const { db, listingStore, expirationStore, contactStore } = createFirestoreEmulatorStores();
    await db
      .collection(SETTINGS_COLLECTION)
      .doc(MARKETPLACE_SETTINGS_DOC_ID)
      .set({ requirePreApproval: false, remoderateMaterialEdits: true });

    // Create 1 listing that will race renew vs expire, plus 4 stale listings for backlog test
    const raceAd = await handleManageEmployerListing(listingStore, {
      authUid: 'u_race_exp',
      authEmail: 'raceexp@oran.dz',
      authEmailVerified: true,
      authPhone: null,
      hasAppCheck: true,
      payload: validCreatePayload({ title: 'Race Renew vs Expire' }),
      nowMs: NOW
    });

    // Time is at exact expiry boundary (NOW + 30 days): renew & expireStaleGigs race in parallel
    const atExpiry = NOW + LISTING_LIFESPAN_MS;
    const [renewOutcome, expireOutcome] = await Promise.allSettled([
      handleManageEmployerListing(listingStore, {
        authUid: 'u_race_exp',
        authEmail: 'raceexp@oran.dz',
        authEmailVerified: true,
        authPhone: null,
        hasAppCheck: true,
        payload: { action: 'renew', gigId: raceAd.gigId },
        nowMs: atExpiry - 1000 // valid 1s before expiry
      }),
      runExpireStaleGigs(expirationStore, atExpiry)
    ]);

    expect(expireOutcome.status).toBe('fulfilled');
    const finalGig = (await db.collection('gigs').doc(raceAd.gigId).get()).data()!;
    const finalEmp = (await db.collection('employers').doc('u_race_exp').get()).data()!;

    // Regardless of which transaction won first, Firestore state MUST be completely consistent!
    if (finalGig.status === 'active') {
      expect(renewOutcome.status).toBe('fulfilled');
      expect(finalEmp.activeCount).toBe(1);
    } else {
      expect(finalGig.status).toBe('expired');
      expect(finalEmp.activeCount).toBe(0);
      // Expired ad NEVER returns contact links
      await expect(
        handleGetGigContactLink(contactStore, {
          authUid: null,
          hasAppCheck: true,
          clientIp: '198.51.100.10',
          gigId: raceAd.gigId,
          channel: 'whatsapp',
          lang: 'fr'
        })
      ).rejects.toMatchObject({ code: 'not-found' });
    }

    // Backlog test: seed 5 stale ads across employers, run with batchSize=2, maxBatches=2 (capacity=4)
    for (let i = 0; i < 5; i++) {
      await handleManageEmployerListing(listingStore, {
        authUid: `u_bk_${i}`,
        authEmail: `bk${i}@oran.dz`,
        authEmailVerified: true,
        authPhone: null,
        hasAppCheck: true,
        payload: validCreatePayload({ title: `Backlog Ad ${i}` }),
        nowMs: NOW - LISTING_LIFESPAN_MS - 10_000 + i * 100
      });
    }

    const sweep1 = await runExpireStaleGigs(expirationStore, NOW, 2, 2);
    expect(sweep1.expiredCount).toBe(4);
    expect(sweep1.hasBacklog).toBe(true);

    const sweep2 = await runExpireStaleGigs(expirationStore, NOW + 1000, 2, 2);
    expect(sweep2.expiredCount).toBe(1);
    expect(sweep2.hasBacklog).toBe(false);
  });

  it('enforces admin restoreGig quota boundary and concurrent suspendEmployer vs create on real Firestore', async () => {
    const { db, listingStore, adminStore } = createFirestoreEmulatorStores();
    await db
      .collection(SETTINGS_COLLECTION)
      .doc(MARKETPLACE_SETTINGS_DOC_ID)
      .set({ requirePreApproval: false, remoderateMaterialEdits: true });

    // Create 3 ads, archive #1, create #4 -> employer at 3/3 active
    const first = await handleManageEmployerListing(listingStore, {
      authUid: 'u_adm_race',
      authEmail: 'admrace@oran.dz',
      authEmailVerified: true,
      authPhone: null,
      hasAppCheck: true,
      payload: validCreatePayload({ title: 'Ad 1' }),
      nowMs: NOW
    });
    await handleAdminManageMarketplace(adminStore, {
      authUid: 'admin_uid',
      authEmail: ADMIN_EMAIL,
      authEmailVerified: true,
      hasAppCheck: true,
      payload: { action: 'removeGig', gigId: first.gigId, reason: 'Temporary removal' },
      nowMs: NOW + 10
    });
    for (let i = 2; i <= 4; i++) {
      await handleManageEmployerListing(listingStore, {
        authUid: 'u_adm_race',
        authEmail: 'admrace@oran.dz',
        authEmailVerified: true,
        authPhone: null,
        hasAppCheck: true,
        payload: validCreatePayload({ title: `Ad ${i}` }),
        nowMs: NOW + i * 10
      });
    }

    // Admin restoreGig on archived Ad 1 at 3/3 quota -> rejected!
    await expect(
      handleAdminManageMarketplace(adminStore, {
        authUid: 'admin_uid',
        authEmail: ADMIN_EMAIL,
        authEmailVerified: true,
        hasAppCheck: true,
        payload: { action: 'restoreGig', gigId: first.gigId },
        nowMs: NOW + 100
      })
    ).rejects.toMatchObject({ code: 'resource-exhausted' });

    // Concurrent suspendEmployer vs create for another employer
    await handleManageEmployerListing(listingStore, {
      authUid: 'u_susp_race',
      authEmail: 'susprace@oran.dz',
      authEmailVerified: true,
      authPhone: null,
      hasAppCheck: true,
      payload: validCreatePayload({ title: 'Pre-suspend Ad' }),
      nowMs: NOW + 200
    });

    const [suspRes] = await Promise.allSettled([
      handleAdminManageMarketplace(adminStore, {
        authUid: 'admin_uid',
        authEmail: ADMIN_EMAIL,
        authEmailVerified: true,
        hasAppCheck: true,
        payload: { action: 'suspendEmployer', employerUid: 'u_susp_race', reason: 'Policy violation' },
        nowMs: NOW + 300
      }),
      handleManageEmployerListing(listingStore, {
        authUid: 'u_susp_race',
        authEmail: 'susprace@oran.dz',
        authEmailVerified: true,
        authPhone: null,
        hasAppCheck: true,
        payload: validCreatePayload({ title: 'Concurrent During Suspend' }),
        nowMs: NOW + 301
      })
    ]);

    expect(suspRes.status).toBe('fulfilled');
    const empSnap = await db.collection('employers').doc('u_susp_race').get();
    expect(empSnap.data()?.suspended).toBe(true);
    // Subsequent create after suspension is always blocked
    await expect(
      handleManageEmployerListing(listingStore, {
        authUid: 'u_susp_race',
        authEmail: 'susprace@oran.dz',
        authEmailVerified: true,
        authPhone: null,
        hasAppCheck: true,
        payload: validCreatePayload({ title: 'Post-suspend Ad' }),
        nowMs: NOW + 400
      })
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('bounds employer quota reconciliation reads with 60 historical archived/expired ads on real Firestore', async () => {
    const { db, listingStore } = createFirestoreEmulatorStores();
    await db
      .collection(SETTINGS_COLLECTION)
      .doc(MARKETPLACE_SETTINGS_DOC_ID)
      .set({ requirePreApproval: false, remoderateMaterialEdits: true });

    // Seed 60 historical archived/expired listings for employer u_hist
    const batch = db.batch();
    for (let i = 0; i < 60; i++) {
      const ref = db.collection('gigs').doc(`hist_${i}`);
      batch.set(ref, {
        title: `Historical Ad ${i}`,
        description: 'Historical listing',
        category: 'delivery',
        listingType: 'job',
        city: 'oran',
        wilayaCode: '31',
        contactMethods: ['whatsapp'],
        payMin: 2000,
        payMax: 3000,
        neighborhood: 'Es Sénia',
        posterUid: 'u_hist',
        flags: 0,
        status: i % 2 === 0 ? 'archived' : 'expired',
        verified: true,
        isSample: false,
        createdAt: NOW - 100_000 - i
      });
    }
    await batch.commit();

    // Create 3 active ads -> all 3 succeed despite 60 historical ads!
    for (let i = 1; i <= 3; i++) {
      const created = await handleManageEmployerListing(listingStore, {
        authUid: 'u_hist',
        authEmail: 'hist@oran.dz',
        authEmailVerified: true,
        authPhone: null,
        hasAppCheck: true,
        payload: validCreatePayload({ title: `Active Ad ${i}` }),
        nowMs: NOW + i * 10
      });
      expect(created.quotaUsed).toBe(i);
    }

    // 4th active ad -> strictly rejected at quota 3/3
    await expect(
      handleManageEmployerListing(listingStore, {
        authUid: 'u_hist',
        authEmail: 'hist@oran.dz',
        authEmailVerified: true,
        authPhone: null,
        hasAppCheck: true,
        payload: validCreatePayload({ title: 'Active Ad 4 Blocked' }),
        nowMs: NOW + 100
      })
    ).rejects.toMatchObject({ code: 'resource-exhausted' });

    const empSnap = await db.collection('employers').doc('u_hist').get();
    expect(empSnap.data()?.activeCount).toBe(3);
  });

  it('handles exact 50 and >50 active/pending overflow safely on real Firestore without silently reducing activeCount', async () => {
    const { db, listingStore } = createFirestoreEmulatorStores();
    await db
      .collection(SETTINGS_COLLECTION)
      .doc(MARKETPLACE_SETTINGS_DOC_ID)
      .set({ requirePreApproval: false, remoderateMaterialEdits: true });

    // Case A: Exactly 50 active ads with corrupted activeCount = 2 -> reconciles to exact 50 & blocks new create
    await db.collection('employers').doc('u_exact50').set({
      uid: 'u_exact50',
      email: 'exact50@oran.dz',
      legacyPhone: null,
      legacyGrandfathered: false,
      legacyCutoffVerified: false,
      maxActiveGigs: 3,
      activeCount: 2, // corrupted counter
      trustLevel: 'new',
      suspended: false
    });
    const batch50 = db.batch();
    for (let i = 0; i < 50; i++) {
      batch50.set(db.collection('gigs').doc(`e50_${i}`), {
        title: `Exact50 Ad ${i}`,
        description: 'Active listing',
        category: 'delivery',
        listingType: 'job',
        city: 'oran',
        wilayaCode: '31',
        contactMethods: ['whatsapp'],
        payMin: 2000,
        payMax: 3000,
        neighborhood: 'Es Sénia',
        posterUid: 'u_exact50',
        flags: 0,
        status: 'active',
        verified: true,
        isSample: false,
        createdAt: NOW - 10_000 - i
      });
    }
    await batch50.commit();

    await expect(
      handleManageEmployerListing(listingStore, {
        authUid: 'u_exact50',
        authEmail: 'exact50@oran.dz',
        authEmailVerified: true,
        authPhone: null,
        hasAppCheck: true,
        payload: validCreatePayload({ title: 'Blocked At 50' }),
        nowMs: NOW
      })
    ).rejects.toMatchObject({ code: 'resource-exhausted' });

    // Archiving one of the 50 reconciles exact count to 49
    const arch50 = await handleManageEmployerListing(listingStore, {
      authUid: 'u_exact50',
      authEmail: 'exact50@oran.dz',
      authEmailVerified: true,
      authPhone: null,
      hasAppCheck: true,
      payload: { action: 'archive', gigId: 'e50_0' },
      nowMs: NOW + 10
    });
    expect(arch50.quotaUsed).toBe(49);

    // Case B: 55 active ads (>50 overflow!) with stored activeCount = 55 -> MUST NOT silently reduce to 50!
    await db.collection('employers').doc('u_over50').set({
      uid: 'u_over50',
      email: 'over50@oran.dz',
      legacyPhone: null,
      legacyGrandfathered: false,
      legacyCutoffVerified: false,
      maxActiveGigs: 3,
      activeCount: 55,
      trustLevel: 'new',
      suspended: false
    });
    const batch55 = db.batch();
    for (let i = 0; i < 55; i++) {
      batch55.set(db.collection('gigs').doc(`o55_${i}`), {
        title: `Over50 Ad ${i}`,
        description: 'Active listing',
        category: 'delivery',
        listingType: 'job',
        city: 'oran',
        wilayaCode: '31',
        contactMethods: ['whatsapp'],
        payMin: 2000,
        payMax: 3000,
        neighborhood: 'Es Sénia',
        posterUid: 'u_over50',
        flags: 0,
        status: 'active',
        verified: true,
        isSample: false,
        createdAt: NOW - 10_000 - i
      });
    }
    await batch55.commit();

    // New create is rejected with resource-exhausted
    await expect(
      handleManageEmployerListing(listingStore, {
        authUid: 'u_over50',
        authEmail: 'over50@oran.dz',
        authEmailVerified: true,
        authPhone: null,
        hasAppCheck: true,
        payload: validCreatePayload({ title: 'Blocked Over 50' }),
        nowMs: NOW + 20
      })
    ).rejects.toMatchObject({ code: 'resource-exhausted' });

    // Archiving one of the 55 decrements 55 -> 54 (NEVER silently truncated to 49/50!)
    const arch55 = await handleManageEmployerListing(listingStore, {
      authUid: 'u_over50',
      authEmail: 'over50@oran.dz',
      authEmailVerified: true,
      authPhone: null,
      hasAppCheck: true,
      payload: { action: 'archive', gigId: 'o55_0' },
      nowMs: NOW + 30
    });
    expect(arch55.quotaUsed).toBe(54);
    const overSnap = await db.collection('employers').doc('u_over50').get();
    expect(overSnap.data()?.activeCount).toBe(54);
  });
});
