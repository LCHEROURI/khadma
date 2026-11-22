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
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

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
});
