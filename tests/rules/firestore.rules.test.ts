import fs from 'node:fs';
import path from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment
} from '@firebase/rules-unit-testing';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const PROJECT_ID = 'demo-khadma';
const PHONE = '+213555010000';
const ADMIN_EMAIL = 'cherouri@gmail.com';

let testEnv: RulesTestEnvironment;

function makeGigPayload(posterUid: string) {
  return {
    title: 'Peintre appartement — Bir El Djir',
    description: 'Khedma 2 youm f Bir El Djir.',
    category: 'construction',
    payMin: 3000,
    payMax: 4000,
    neighborhood: 'Bir El Djir',
    posterUid,
    flags: 0,
    status: 'active',
    verified: true,
    isSample: false,
    createdAt: serverTimestamp()
  };
}

describe('KHADMA Firestore Security Rules', () => {
  beforeAll(async () => {
    const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules,
        host: '127.0.0.1',
        port: 8080
      }
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  it('allows public read of active gigs and denies hidden/removed gigs and gigContacts', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'gigs', 'g_active'), { ...makeGigPayload('u1'), status: 'active' });
      await setDoc(doc(db, 'gigs', 'g_hidden'), { ...makeGigPayload('u1'), status: 'hidden' });
      await setDoc(doc(db, 'gigs', 'g_removed'), { ...makeGigPayload('u1'), status: 'removed' });
      await setDoc(doc(db, 'gigContacts', 'g_active'), {
        posterPhone: PHONE,
        counterId: PHONE,
        posterUid: 'u1',
        createdAt: serverTimestamp()
      });
    });

    const anonDb = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(anonDb, 'gigs', 'g_active')));
    await assertFails(getDoc(doc(anonDb, 'gigs', 'g_hidden')));
    await assertFails(getDoc(doc(anonDb, 'gigs', 'g_removed')));
    await assertFails(getDoc(doc(anonDb, 'gigContacts', 'g_active')));
  });

  it('denies all direct client transactional writes to gigs, gigContacts, and phoneCounters (V1.4 server-authoritative)', async () => {
    const phoneCtx = testEnv.authenticatedContext('phone-user-1', { phone_number: PHONE });
    const db = phoneCtx.firestore();

    // Direct client transactional post is DENIED after V1.4 cutover (must go through manageEmployerListing callable)
    await assertFails(
      runTransaction(db, async (tx) => {
        const now = serverTimestamp();
        tx.set(doc(db, 'phoneCounters', PHONE), { count: 1 });
        tx.set(doc(db, 'gigs', 'gig_1'), makeGigPayload('phone-user-1'));
        tx.set(doc(db, 'gigContacts', 'gig_1'), {
          posterPhone: PHONE,
          counterId: PHONE,
          posterUid: 'phone-user-1',
          createdAt: now
        });
      })
    );

    // Attack: create gig_2 WITHOUT incrementing phoneCounters -> MUST DENY
    await assertFails(
      runTransaction(db, async (tx) => {
        const now = serverTimestamp();
        tx.set(doc(db, 'gigs', 'gig_bypass'), makeGigPayload('phone-user-1'));
        tx.set(doc(db, 'gigContacts', 'gig_bypass'), {
          posterPhone: PHONE,
          counterId: PHONE,
          posterUid: 'phone-user-1',
          createdAt: now
        });
      })
    );

    // Attack: write raw posterPhone onto public gigs doc -> MUST DENY
    await assertFails(
      runTransaction(db, async (tx) => {
        const now = serverTimestamp();
        tx.set(doc(db, 'gigs', 'gig_pii'), {
          ...makeGigPayload('phone-user-1'),
          posterPhone: PHONE
        });
        tx.set(doc(db, 'gigContacts', 'gig_pii'), {
          posterPhone: PHONE,
          counterId: PHONE,
          posterUid: 'phone-user-1',
          createdAt: now
        });
      })
    );
  });

  it('denies direct client gig flagging and report creation (enforcing reportGigListing callable)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'gigs', 'gig_r'), makeGigPayload('u1'));
    });

    const r1 = testEnv.authenticatedContext('anon-1').firestore();

    // Direct client flag update MUST be denied (must go through App-Check + IP-limited callable)
    await assertFails(updateDoc(doc(r1, 'gigs', 'gig_r'), { flags: 1, status: 'active' }));

    // Direct client report creation MUST be denied
    await assertFails(
      setDoc(doc(r1, 'reports', 'gig_r_anon-1'), {
        gigId: 'gig_r',
        reason: 'scam',
        reporterId: 'anon-1',
        createdAt: serverTimestamp()
      })
    );

    // Server-only reportRateLimits MUST be denied to clients
    await assertFails(getDoc(doc(r1, 'reportRateLimits', 'ip_test')));
    await assertFails(setDoc(doc(r1, 'reportRateLimits', 'ip_test'), { gigIds: [], windowStartMs: 0 }));
  });

  it('denies unverified admin email and allows verified admin email + flagged queue query (DB-001)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'gigs', 'g1'), { ...makeGigPayload('u1'), status: 'hidden', flags: 3 });
      await setDoc(doc(db, 'gigContacts', 'g1'), {
        posterPhone: PHONE,
        counterId: PHONE,
        posterUid: 'u1',
        createdAt: serverTimestamp()
      });
    });

    const unverifiedAdmin = testEnv
      .authenticatedContext('admin-unverified', { email: ADMIN_EMAIL, email_verified: false })
      .firestore();
    await assertFails(getDoc(doc(unverifiedAdmin, 'gigs', 'g1')));
    await assertFails(getDoc(doc(unverifiedAdmin, 'gigContacts', 'g1')));

    const verifiedAdmin = testEnv
      .authenticatedContext('admin-verified', { email: ADMIN_EMAIL, email_verified: true })
      .firestore();
    await assertSucceeds(getDoc(doc(verifiedAdmin, 'gigs', 'g1')));
    await assertSucceeds(getDoc(doc(verifiedAdmin, 'gigContacts', 'g1')));
    await assertSucceeds(
      getDocs(
        query(
          collection(verifiedAdmin, 'gigs'),
          where('flags', '>', 0),
          orderBy('flags', 'asc'),
          orderBy('createdAt', 'desc'),
          limit(50)
        )
      )
    );
    // Direct client admin mutation is denied in V1.4 cutover (enforcing adminManageMarketplace callable)
    await assertFails(updateDoc(doc(verifiedAdmin, 'gigs', 'g1'), { status: 'active', flags: 0 }));

    // Server-only contactRateLimits must be denied to all clients (including admin)
    const anonDb = testEnv.unauthenticatedContext().firestore();
    const phoneDb = testEnv.authenticatedContext('p1', { phone_number: PHONE }).firestore();
    await assertFails(getDoc(doc(anonDb, 'contactRateLimits', 'uid_p1')));
    await assertFails(setDoc(doc(phoneDb, 'contactRateLimits', 'uid_p1'), { gigIds: [], windowStartMs: 0 }));
    await assertFails(setDoc(doc(verifiedAdmin, 'contactRateLimits', 'uid_p1'), { gigIds: [], windowStartMs: 0 }));
  });

  it('scopes hidden/removed reads to phone-verified owner and denies all direct client gig writes', async () => {
    const ownerDb = testEnv.authenticatedContext('owner-uid', { phone_number: PHONE }).firestore();
    const otherPhoneDb = testEnv.authenticatedContext('other-uid', { phone_number: '+213555010001' }).firestore();

    // Direct client creation is denied (must go through manageEmployerListing callable)
    await assertFails(
      runTransaction(ownerDb, async (tx) => {
        const now = serverTimestamp();
        tx.set(doc(ownerDb, 'phoneCounters', PHONE), { count: 1 });
        tx.set(doc(ownerDb, 'gigs', 'gig_job'), { ...makeGigPayload('owner-uid'), listingType: 'job' });
        tx.set(doc(ownerDb, 'gigContacts', 'gig_job'), {
          posterPhone: PHONE,
          counterId: PHONE,
          posterUid: 'owner-uid',
          createdAt: now
        });
      })
    );

    // Seed active and removed gigs owned by owner-uid via server/admin context
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'gigs', 'gig_job'), {
        ...makeGigPayload('owner-uid'),
        listingType: 'job',
        status: 'active'
      });
      await setDoc(doc(db, 'gigs', 'gig_removed_own'), {
        ...makeGigPayload('owner-uid'),
        listingType: 'job',
        status: 'removed'
      });
    });

    // Owner can read own removed gig; other phone user cannot
    await assertSucceeds(getDoc(doc(ownerDb, 'gigs', 'gig_removed_own')));
    await assertFails(getDoc(doc(otherPhoneDb, 'gigs', 'gig_removed_own')));

    // Owner cannot mutate listing ownership, status, or flags (moderation bypass blocked)
    await assertFails(updateDoc(doc(ownerDb, 'gigs', 'gig_removed_own'), { status: 'active' }));
    await assertFails(updateDoc(doc(ownerDb, 'gigs', 'gig_job'), { posterUid: 'other-uid' }));
  });

  it('authorizes getMyGigs() collection query only for the phone-verified owner across active/inactive/empty states', async () => {
    const ownerDb = testEnv.authenticatedContext('owner-1', { phone_number: PHONE }).firestore();
    const emptyOwnerDb = testEnv
      .authenticatedContext('owner-empty', { phone_number: '+213555010002' })
      .firestore();
    const otherOwnerDb = testEnv
      .authenticatedContext('owner-2', { phone_number: '+213555010003' })
      .firestore();
    const anonAuthDb = testEnv.authenticatedContext('anon-uid', {}).firestore();
    const unauthDb = testEnv.unauthenticatedContext().firestore();

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'gigs', 'own_active'), { ...makeGigPayload('owner-1'), listingType: 'job', status: 'active' });
      await setDoc(doc(db, 'gigs', 'own_hidden'), { ...makeGigPayload('owner-1'), listingType: 'job', status: 'hidden' });
      await setDoc(doc(db, 'gigs', 'own_removed'), { ...makeGigPayload('owner-1'), listingType: 'service', status: 'removed' });
      await setDoc(doc(db, 'gigs', 'other_hidden'), { ...makeGigPayload('owner-2'), listingType: 'job', status: 'hidden' });
    });

    // Exact getMyGigs() query for owner with active + hidden + removed listings -> SUCCEEDS & returns all 3
    const ownSnap = await assertSucceeds(
      getDocs(query(collection(ownerDb, 'gigs'), where('posterUid', '==', 'owner-1'), limit(25)))
    );
    expect(ownSnap.docs.map((d) => d.id).sort()).toEqual(['own_active', 'own_hidden', 'own_removed']);

    // Exact getMyGigs() query for owner with zero listings -> SUCCEEDS & returns 0
    const emptySnap = await assertSucceeds(
      getDocs(query(collection(emptyOwnerDb, 'gigs'), where('posterUid', '==', 'owner-empty'), limit(25)))
    );
    expect(emptySnap.size).toBe(0);

    // Different authenticated phone user querying owner-1's listings -> MUST DENY
    await assertFails(
      getDocs(query(collection(otherOwnerDb, 'gigs'), where('posterUid', '==', 'owner-1'), limit(25)))
    );

    // Authenticated anonymous user (no phone_number) querying owner-1's listings -> MUST DENY
    await assertFails(
      getDocs(query(collection(anonAuthDb, 'gigs'), where('posterUid', '==', 'owner-1'), limit(25)))
    );

    // Unauthenticated user querying owner-1's listings -> MUST DENY
    await assertFails(
      getDocs(query(collection(unauthDb, 'gigs'), where('posterUid', '==', 'owner-1'), limit(25)))
    );
  });

  it('V1.4 Phase 1: blocks public get of expired/pending/archived gigs while preserving legacy docs and owner/admin reads', async () => {
    const pastExpiry = Timestamp.fromMillis(Date.now() - 60_000);
    const futureExpiry = Timestamp.fromMillis(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      // Active unexpired V1.4 ad -> public get ALLOWED
      await setDoc(doc(db, 'gigs', 'g_v14_active'), {
        ...makeGigPayload('email-owner-1'),
        city: 'oran',
        wilayaCode: '31',
        expiresAt: futureExpiry
      });
      // Active status BUT past expiresAt -> public get MUST BE DENIED even before status transition
      await setDoc(doc(db, 'gigs', 'g_v14_past_expiry'), {
        ...makeGigPayload('email-owner-1'),
        status: 'active',
        expiresAt: pastExpiry
      });
      // Legacy V1.3 active doc without expiresAt -> public get ALLOWED (backward compatibility)
      await setDoc(doc(db, 'gigs', 'g_v13_legacy'), {
        ...makeGigPayload('phone-owner-1'),
        status: 'active'
      });
      // Lifecycle non-public states -> public get MUST BE DENIED
      await setDoc(doc(db, 'gigs', 'g_v14_pending'), {
        ...makeGigPayload('email-owner-1'),
        status: 'pending'
      });
      await setDoc(doc(db, 'gigs', 'g_v14_archived'), {
        ...makeGigPayload('email-owner-1'),
        status: 'archived'
      });
      await setDoc(doc(db, 'gigs', 'g_v14_expired_status'), {
        ...makeGigPayload('email-owner-1'),
        status: 'expired',
        expiresAt: pastExpiry
      });
    });

    const publicDb = testEnv.unauthenticatedContext().firestore();
    const verifiedOwnerDb = testEnv
      .authenticatedContext('email-owner-1', { email: 'employer@example.dz', email_verified: true })
      .firestore();
    const unverifiedEmailDb = testEnv
      .authenticatedContext('email-owner-1', { email: 'employer@example.dz', email_verified: false })
      .firestore();
    const otherVerifiedEmailDb = testEnv
      .authenticatedContext('email-owner-2', { email: 'other@example.dz', email_verified: true })
      .firestore();
    const adminDb = testEnv
      .authenticatedContext('admin-verified', { email: ADMIN_EMAIL, email_verified: true })
      .firestore();

    // Public get assertions
    await assertSucceeds(getDoc(doc(publicDb, 'gigs', 'g_v14_active')));
    await assertSucceeds(getDoc(doc(publicDb, 'gigs', 'g_v13_legacy')));
    await assertFails(getDoc(doc(publicDb, 'gigs', 'g_v14_past_expiry')));
    await assertFails(getDoc(doc(publicDb, 'gigs', 'g_v14_pending')));
    await assertFails(getDoc(doc(publicDb, 'gigs', 'g_v14_archived')));
    await assertFails(getDoc(doc(publicDb, 'gigs', 'g_v14_expired_status')));

    // Public list compatibility (V1.3 active browse query continues working and excludes expired/pending/archived statuses)
    const activeList = await assertSucceeds(
      getDocs(query(collection(publicDb, 'gigs'), where('status', '==', 'active'), limit(50)))
    );
    expect(activeList.docs.map((d) => d.id)).not.toContain('g_v14_pending');
    expect(activeList.docs.map((d) => d.id)).not.toContain('g_v14_archived');
    expect(activeList.docs.map((d) => d.id)).not.toContain('g_v14_expired_status');

    // Verified email owner can read & list all own lifecycle states
    await assertSucceeds(getDoc(doc(verifiedOwnerDb, 'gigs', 'g_v14_past_expiry')));
    await assertSucceeds(getDoc(doc(verifiedOwnerDb, 'gigs', 'g_v14_pending')));
    await assertSucceeds(getDoc(doc(verifiedOwnerDb, 'gigs', 'g_v14_archived')));
    await assertSucceeds(getDoc(doc(verifiedOwnerDb, 'gigs', 'g_v14_expired_status')));
    const ownerList = await assertSucceeds(
      getDocs(query(collection(verifiedOwnerDb, 'gigs'), where('posterUid', '==', 'email-owner-1'), limit(25)))
    );
    expect(ownerList.size).toBe(5);

    // Unverified email user and cross-account verified user MUST be denied
    await assertFails(getDoc(doc(unverifiedEmailDb, 'gigs', 'g_v14_pending')));
    await assertFails(getDoc(doc(otherVerifiedEmailDb, 'gigs', 'g_v14_pending')));
    await assertFails(
      getDocs(query(collection(otherVerifiedEmailDb, 'gigs'), where('posterUid', '==', 'email-owner-1'), limit(25)))
    );

    // Admin can read expired/pending/archived listings
    await assertSucceeds(getDoc(doc(adminDb, 'gigs', 'g_v14_past_expiry')));
    await assertSucceeds(getDoc(doc(adminDb, 'gigs', 'g_v14_pending')));
  });

  it('V1.4 Cutover: blocks all direct client creates including Oran-valid and expiresAt-spoofed payloads', async () => {
    const phoneDb = testEnv.authenticatedContext('phone-geo-1', { phone_number: PHONE }).firestore();

    // Even valid Oran payloads MUST be denied via direct client write after V1.4 cutover
    await assertFails(
      runTransaction(phoneDb, async (tx) => {
        const now = serverTimestamp();
        tx.set(doc(phoneDb, 'phoneCounters', PHONE), { count: 1 });
        tx.set(doc(phoneDb, 'gigs', 'gig_oran_ok'), {
          ...makeGigPayload('phone-geo-1'),
          city: 'oran',
          wilayaCode: '31'
        });
        tx.set(doc(phoneDb, 'gigContacts', 'gig_oran_ok'), {
          posterPhone: PHONE,
          counterId: PHONE,
          posterUid: 'phone-geo-1',
          createdAt: now
        });
      })
    );

    // Non-Oran city MUST be denied
    await assertFails(
      runTransaction(phoneDb, async (tx) => {
        tx.set(doc(phoneDb, 'gigs', 'gig_bad_city'), {
          ...makeGigPayload('phone-geo-1'),
          city: 'algiers',
          wilayaCode: '16'
        });
      })
    );

    // Client-supplied expiresAt MUST be denied (server-managed only)
    await assertFails(
      runTransaction(phoneDb, async (tx) => {
        tx.set(doc(phoneDb, 'gigs', 'gig_bad_expiry'), {
          ...makeGigPayload('phone-geo-1'),
          expiresAt: Timestamp.fromMillis(Date.now() + 365 * 24 * 60 * 60 * 1000)
        });
      })
    );
  });

  it('V1.4 Phase 1: locks employers/{uid}, settings/marketplace, and auditLogs against client tampering', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'employers', 'emp-1'), {
        uid: 'emp-1',
        email: 'emp1@example.dz',
        legacyPhone: null,
        maxActiveGigs: 3,
        activeCount: 1,
        trustLevel: 'new',
        suspended: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      await setDoc(doc(db, 'settings', 'marketplace'), {
        requirePreApproval: false,
        remoderateMaterialEditsWhenEnabled: true,
        updatedAt: serverTimestamp(),
        updatedBy: 'admin-verified'
      });
      await setDoc(doc(db, 'auditLogs', 'log-1'), {
        actorUid: 'admin-verified',
        actorRole: 'admin',
        action: 'moderation_settings_change',
        targetType: 'settings',
        targetId: 'marketplace',
        createdAt: serverTimestamp()
      });
    });

    const emp1Db = testEnv
      .authenticatedContext('emp-1', { email: 'emp1@example.dz', email_verified: true })
      .firestore();
    const emp2Db = testEnv
      .authenticatedContext('emp-2', { email: 'emp2@example.dz', email_verified: true })
      .firestore();
    const unauthDb = testEnv.unauthenticatedContext().firestore();
    const unverifiedAdminDb = testEnv
      .authenticatedContext('admin-unverified', { email: ADMIN_EMAIL, email_verified: false })
      .firestore();
    const adminDb = testEnv
      .authenticatedContext('admin-verified', { email: ADMIN_EMAIL, email_verified: true })
      .firestore();

    // employers/{uid}: owner & admin can read; cross-account & unauth denied; ALL client writes denied
    await assertSucceeds(getDoc(doc(emp1Db, 'employers', 'emp-1')));
    await assertSucceeds(getDoc(doc(adminDb, 'employers', 'emp-1')));
    await assertFails(getDoc(doc(emp2Db, 'employers', 'emp-1')));
    await assertFails(getDoc(doc(unauthDb, 'employers', 'emp-1')));
    await assertFails(updateDoc(doc(emp1Db, 'employers', 'emp-1'), { maxActiveGigs: 99, activeCount: 0 }));
    await assertFails(updateDoc(doc(adminDb, 'employers', 'emp-1'), { maxActiveGigs: 10 }));

    // settings/marketplace: verified admin read only; ALL client writes denied (Admin SDK callable only)
    await assertSucceeds(getDoc(doc(adminDb, 'settings', 'marketplace')));
    await assertFails(getDoc(doc(unverifiedAdminDb, 'settings', 'marketplace')));
    await assertFails(getDoc(doc(emp1Db, 'settings', 'marketplace')));
    await assertFails(getDoc(doc(unauthDb, 'settings', 'marketplace')));
    await assertFails(updateDoc(doc(emp1Db, 'settings', 'marketplace'), { requirePreApproval: false }));
    await assertFails(updateDoc(doc(adminDb, 'settings', 'marketplace'), { requirePreApproval: true }));

    // auditLogs/{id}: verified admin read only; ALL client writes denied
    await assertSucceeds(getDoc(doc(adminDb, 'auditLogs', 'log-1')));
    await assertFails(getDoc(doc(emp1Db, 'auditLogs', 'log-1')));
    await assertFails(getDoc(doc(unauthDb, 'auditLogs', 'log-1')));
    await assertFails(
      setDoc(doc(emp1Db, 'auditLogs', 'forged'), {
        actorUid: 'emp-1',
        actorRole: 'employer',
        action: 'create',
        targetType: 'gig',
        targetId: 'x',
        createdAt: serverTimestamp()
      })
    );
    await assertFails(
      setDoc(doc(adminDb, 'auditLogs', 'forged-admin'), {
        actorUid: 'admin-verified',
        actorRole: 'admin',
        action: 'approve',
        targetType: 'gig',
        targetId: 'x',
        createdAt: serverTimestamp()
      })
    );
  });

  it('V1.4 Phase 1 Security Checkpoint: explicit negative tests blocking unauthorized contact reads, quota changes, and settings mutations', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'gigContacts', 'g_priv'), {
        posterPhone: PHONE,
        posterEmail: 'owner@example.dz',
        counterId: PHONE,
        posterUid: 'emp-1',
        createdAt: serverTimestamp()
      });
      await setDoc(doc(db, 'employers', 'emp-1'), {
        uid: 'emp-1',
        email: 'owner@example.dz',
        legacyPhone: null,
        maxActiveGigs: 3,
        activeCount: 3,
        trustLevel: 'new',
        suspended: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      await setDoc(doc(db, 'phoneCounters', PHONE), { count: 5 });
      await setDoc(doc(db, 'settings', 'marketplace'), {
        requirePreApproval: true,
        remoderateMaterialEditsWhenEnabled: true,
        updatedAt: serverTimestamp(),
        updatedBy: 'admin-verified'
      });
    });

    const unauthDb = testEnv.unauthenticatedContext().firestore();
    const ownerEmailDb = testEnv
      .authenticatedContext('emp-1', { email: 'owner@example.dz', email_verified: true })
      .firestore();
    const otherEmailDb = testEnv
      .authenticatedContext('emp-2', { email: 'other@example.dz', email_verified: true })
      .firestore();
    const phoneOtherDb = testEnv
      .authenticatedContext('phone-other', { phone_number: '+213555019999' })
      .firestore();
    const unverifiedAdminDb = testEnv
      .authenticatedContext('admin-unverified', { email: ADMIN_EMAIL, email_verified: false })
      .firestore();
    const adminDb = testEnv
      .authenticatedContext('admin-verified', { email: ADMIN_EMAIL, email_verified: true })
      .firestore();

    // 1. Private employer contacts (gigContacts/{gigId}): blocked for unauth, other users, AND non-admin owners
    await assertFails(getDoc(doc(unauthDb, 'gigContacts', 'g_priv')));
    await assertFails(getDocs(collection(unauthDb, 'gigContacts')));
    await assertFails(getDoc(doc(ownerEmailDb, 'gigContacts', 'g_priv')));
    await assertFails(getDocs(collection(ownerEmailDb, 'gigContacts')));
    await assertFails(getDoc(doc(otherEmailDb, 'gigContacts', 'g_priv')));
    await assertFails(getDoc(doc(phoneOtherDb, 'gigContacts', 'g_priv')));
    await assertFails(getDoc(doc(unverifiedAdminDb, 'gigContacts', 'g_priv')));
    await assertFails(updateDoc(doc(ownerEmailDb, 'gigContacts', 'g_priv'), { posterPhone: '+213555000000' }));
    await assertFails(deleteDoc(doc(ownerEmailDb, 'gigContacts', 'g_priv')));
    await assertFails(
      setDoc(doc(ownerEmailDb, 'gigContacts', 'g_new_email'), {
        posterPhone: PHONE,
        counterId: PHONE,
        posterUid: 'emp-1',
        createdAt: serverTimestamp()
      })
    );

    // 2. Employer quotas (employers/{uid} & phoneCounters/{e164}): no client create/update/delete/cross-list
    await assertFails(getDocs(collection(unauthDb, 'employers')));
    await assertFails(getDocs(collection(ownerEmailDb, 'employers')));
    await assertFails(
      setDoc(doc(ownerEmailDb, 'employers', 'emp-self-forged'), {
        uid: 'emp-self-forged',
        maxActiveGigs: 100,
        activeCount: 0,
        suspended: false
      })
    );
    await assertFails(updateDoc(doc(ownerEmailDb, 'employers', 'emp-1'), { maxActiveGigs: 10, activeCount: 0 }));
    await assertFails(deleteDoc(doc(ownerEmailDb, 'employers', 'emp-1')));
    await assertFails(updateDoc(doc(otherEmailDb, 'employers', 'emp-1'), { suspended: true }));
    await assertFails(deleteDoc(doc(adminDb, 'employers', 'emp-1')));
    await assertFails(getDoc(doc(ownerEmailDb, 'phoneCounters', PHONE)));
    await assertFails(updateDoc(doc(ownerEmailDb, 'phoneCounters', PHONE), { count: 0 }));
    await assertFails(updateDoc(doc(phoneOtherDb, 'phoneCounters', PHONE), { count: 0 }));
    await assertFails(deleteDoc(doc(unauthDb, 'phoneCounters', PHONE)));

    // 3. Marketplace moderation settings (settings/marketplace): no client create/update/delete or non-admin list
    await assertFails(getDocs(collection(unauthDb, 'settings')));
    await assertFails(getDocs(collection(ownerEmailDb, 'settings')));
    await assertFails(getDocs(collection(phoneOtherDb, 'settings')));
    await assertFails(getDocs(collection(unverifiedAdminDb, 'settings')));
    await assertFails(setDoc(doc(unauthDb, 'settings', 'marketplace'), { requirePreApproval: false }));
    await assertFails(updateDoc(doc(ownerEmailDb, 'settings', 'marketplace'), { requirePreApproval: false }));
    await assertFails(updateDoc(doc(phoneOtherDb, 'settings', 'marketplace'), { requirePreApproval: false }));
    await assertFails(updateDoc(doc(unverifiedAdminDb, 'settings', 'marketplace'), { requirePreApproval: false }));
    await assertFails(setDoc(doc(adminDb, 'settings', 'marketplace'), { requirePreApproval: false }));
    await assertFails(deleteDoc(doc(adminDb, 'settings', 'marketplace')));
  });

  it('V1.4 Phase 4 Final Cutover Rules: denies ALL direct client writes to gigs, gigContacts, employers, settings, auditLogs, and listingIdempotency', async () => {
    const cutoverRules = fs.readFileSync(
      path.resolve(process.cwd(), 'firestore.rules.v14-cutover'),
      'utf8'
    );
    const cutoverEnv = await initializeTestEnvironment({
      projectId: `${PROJECT_ID}-cutover`,
      firestore: {
        rules: cutoverRules,
        host: '127.0.0.1',
        port: 8080
      }
    });

    try {
      const futureExpiry = Timestamp.fromMillis(Date.now() + 10 * 24 * 60 * 60 * 1000);
      const pastExpiry = Timestamp.fromMillis(Date.now() - 60_000);

      await cutoverEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        await setDoc(doc(db, 'gigs', 'g_live'), { ...makeGigPayload('u_emp'), expiresAt: futureExpiry });
        await setDoc(doc(db, 'gigs', 'g_exp'), { ...makeGigPayload('u_emp'), expiresAt: pastExpiry });
        await setDoc(doc(db, 'employers', 'u_emp'), { uid: 'u_emp', maxActiveGigs: 3, activeCount: 1 });
        await setDoc(doc(db, 'settings', 'marketplace'), { requirePreApproval: false });
      });

      const unauthDb = cutoverEnv.unauthenticatedContext().firestore();
      const phoneDb = cutoverEnv.authenticatedContext('u_phone', { phone_number: PHONE }).firestore();
      const emailDb = cutoverEnv
        .authenticatedContext('u_emp', { email: 'emp@oran.dz', email_verified: true })
        .firestore();
      const adminDb = cutoverEnv
        .authenticatedContext('admin-1', { email: ADMIN_EMAIL, email_verified: true })
        .firestore();

      // Public reads: unexpired active allowed, expired get denied
      await assertSucceeds(getDoc(doc(unauthDb, 'gigs', 'g_live')));
      await assertFails(getDoc(doc(unauthDb, 'gigs', 'g_exp')));

      // Owner & admin reads still work
      await assertSucceeds(getDoc(doc(emailDb, 'gigs', 'g_exp')));
      await assertSucceeds(getDoc(doc(emailDb, 'employers', 'u_emp')));
      await assertSucceeds(getDoc(doc(adminDb, 'settings', 'marketplace')));

      // ALL direct client creates/updates/deletes MUST be denied (including phone users & admin!)
      await assertFails(setDoc(doc(phoneDb, 'gigs', 'g_bypass'), makeGigPayload('u_phone')));
      await assertFails(setDoc(doc(emailDb, 'gigs', 'g_bypass2'), makeGigPayload('u_emp')));
      await assertFails(updateDoc(doc(adminDb, 'gigs', 'g_live'), { status: 'removed' }));
      await assertFails(deleteDoc(doc(adminDb, 'gigs', 'g_live')));
      await assertFails(
        setDoc(doc(phoneDb, 'gigContacts', 'g_bypass'), {
          posterPhone: PHONE,
          counterId: PHONE,
          posterUid: 'u_phone',
          createdAt: serverTimestamp()
        })
      );
      await assertFails(updateDoc(doc(emailDb, 'employers', 'u_emp'), { maxActiveGigs: 99 }));
      await assertFails(updateDoc(doc(adminDb, 'settings', 'marketplace'), { requirePreApproval: true }));
      await assertFails(getDoc(doc(adminDb, 'listingIdempotency', 'k1')));
      await assertFails(setDoc(doc(emailDb, 'listingIdempotency', 'k1'), { gigId: 'g_live' }));
    } finally {
      await cutoverEnv.cleanup();
    }
  });
});
