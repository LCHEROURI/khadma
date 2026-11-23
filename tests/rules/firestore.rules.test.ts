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
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
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

  it('enforces strict transactional +1 counter cap (max 5) and blocks posterPhone on public gigs', async () => {
    const phoneCtx = testEnv.authenticatedContext('phone-user-1', { phone_number: PHONE });
    const db = phoneCtx.firestore();

    // Legitimate transactional post #1
    await assertSucceeds(
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

    // Attack: create gig_2 WITHOUT incrementing phoneCounters (rate-limit bypass) -> MUST DENY
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
        tx.update(doc(db, 'phoneCounters', PHONE), { count: 2 });
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

    // Seed counter at 5 and verify 6th gig is denied
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'phoneCounters', PHONE), { count: 5 });
    });

    await assertFails(
      runTransaction(db, async (tx) => {
        const now = serverTimestamp();
        tx.update(doc(db, 'phoneCounters', PHONE), { count: 6 });
        tx.set(doc(db, 'gigs', 'gig_6'), makeGigPayload('phone-user-1'));
        tx.set(doc(db, 'gigContacts', 'gig_6'), {
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
    await assertSucceeds(updateDoc(doc(verifiedAdmin, 'gigs', 'g1'), { status: 'active', flags: 0 }));

    // Server-only contactRateLimits must be denied to all clients (including admin)
    const anonDb = testEnv.unauthenticatedContext().firestore();
    const phoneDb = testEnv.authenticatedContext('p1', { phone_number: PHONE }).firestore();
    await assertFails(getDoc(doc(anonDb, 'contactRateLimits', 'uid_p1')));
    await assertFails(setDoc(doc(phoneDb, 'contactRateLimits', 'uid_p1'), { gigIds: [], windowStartMs: 0 }));
    await assertFails(setDoc(doc(verifiedAdmin, 'contactRateLimits', 'uid_p1'), { gigIds: [], windowStartMs: 0 }));
  });

  it('validates optional listingType (job/service) and scopes hidden/removed reads to phone-verified owner', async () => {
    const ownerDb = testEnv.authenticatedContext('owner-uid', { phone_number: PHONE }).firestore();
    const otherPhoneDb = testEnv.authenticatedContext('other-uid', { phone_number: '+213555010001' }).firestore();

    // Creating a job listing succeeds
    await assertSucceeds(
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

    // Creating a service listing succeeds
    await assertSucceeds(
      runTransaction(ownerDb, async (tx) => {
        const now = serverTimestamp();
        tx.set(doc(ownerDb, 'phoneCounters', PHONE), { count: 2 });
        tx.set(doc(ownerDb, 'gigs', 'gig_svc'), { ...makeGigPayload('owner-uid'), listingType: 'service' });
        tx.set(doc(ownerDb, 'gigContacts', 'gig_svc'), {
          posterPhone: PHONE,
          counterId: PHONE,
          posterUid: 'owner-uid',
          createdAt: now
        });
      })
    );

    // Creating a gig with invalid listingType MUST be denied
    await assertFails(
      runTransaction(ownerDb, async (tx) => {
        const now = serverTimestamp();
        tx.set(doc(ownerDb, 'phoneCounters', PHONE), { count: 3 });
        tx.set(doc(ownerDb, 'gigs', 'gig_bad_type'), { ...makeGigPayload('owner-uid'), listingType: 'invalid' });
        tx.set(doc(ownerDb, 'gigContacts', 'gig_bad_type'), {
          posterPhone: PHONE,
          counterId: PHONE,
          posterUid: 'owner-uid',
          createdAt: now
        });
      })
    );

    // Seed a removed gig owned by owner-uid
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'gigs', 'gig_removed_own'), {
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
});
