import { createRequire } from 'node:module';
import type {
  AuditRecordInput,
  IdempotencyRecord,
  ListingStore,
  StoredEmployerProfile,
  StoredGig,
  StoredModerationSettings
} from '../../functions/src/listingHandler';
import type { AdminStore } from '../../functions/src/adminHandler';
import type { ExpirationStore } from '../../functions/src/expirationHandler';
import {
  evaluateListingBurstBucket,
  evaluateRateBucket,
  RATE_TTL_MS,
  type ContactStore,
  type ListingBurstBucket,
  type PrivateContactRecord,
  type RateBucket
} from '../../functions/src/contactHandler';
import {
  AUDIT_LOGS_COLLECTION,
  EMPLOYERS_COLLECTION,
  MARKETPLACE_SETTINGS_DOC_ID,
  SETTINGS_COLLECTION
} from '../../functions/src/types';

export const PROJECT_ID = 'demo-khadma';
export const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
export const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

const IDEMPOTENCY_COLLECTION = 'listingIdempotency';
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

const require = createRequire(new URL('../../functions/package.json', import.meta.url));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adminApp = require('firebase-admin/app') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adminFirestore = require('firebase-admin/firestore') as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adminAuth = require('firebase-admin/auth') as any;

const { Timestamp } = adminFirestore;

function ensureAdminApp() {
  process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
  const existing = adminApp.getApps().find((a: { name: string }) => a.name === 'khadma-integration');
  if (existing) return existing;
  return adminApp.initializeApp({ projectId: PROJECT_ID }, 'khadma-integration');
}

export function getEmulatorDb() {
  return adminFirestore.getFirestore(ensureAdminApp());
}

export function getEmulatorAuth() {
  return adminAuth.getAuth(ensureAdminApp());
}

export async function clearFirestoreEmulator(): Promise<void> {
  const res = await fetch(
    `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' }
  );
  if (!res.ok) {
    throw new Error(`Failed to clear Firestore emulator: ${res.status}`);
  }
}

export async function clearAuthEmulator(): Promise<void> {
  const res = await fetch(`http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`, {
    method: 'DELETE'
  });
  if (!res.ok) {
    throw new Error(`Failed to clear Auth emulator: ${res.status}`);
  }
}

function toFirestoreTimestamps(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...obj };
  for (const key of ['createdAt', 'updatedAt', 'expiresAt']) {
    if (typeof out[key] === 'number') {
      out[key] = Timestamp.fromMillis(out[key] as number);
    }
  }
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeSanitizedAudit(db: any, tx: any, entry: AuditRecordInput): void {
  const ref = db.collection(AUDIT_LOGS_COLLECTION).doc();
  tx.set(ref, {
    actorUid: entry.actorUid,
    actorRole: entry.actorRole,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    ...(entry.reason ? { reason: entry.reason } : {}),
    ...(entry.metadata ? { metadata: entry.metadata } : {}),
    createdAt: Timestamp.fromMillis(entry.nowMs)
  });
}

export function createFirestoreEmulatorStores() {
  const db = getEmulatorDb();

  const listingStore: ListingStore = {
    runTransaction(fn) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return db.runTransaction(async (tx: any) =>
        fn({
          async getEmployer(uid) {
            const snap = await tx.get(db.collection(EMPLOYERS_COLLECTION).doc(uid));
            return snap.exists ? ({ uid: snap.id, ...snap.data() } as StoredEmployerProfile) : null;
          },
          setEmployer(uid, data) {
            tx.set(
              db.collection(EMPLOYERS_COLLECTION).doc(uid),
              toFirestoreTimestamps(data as unknown as Record<string, unknown>),
              { merge: true }
            );
          },
          async getModerationSettings() {
            const snap = await tx.get(
              db.collection(SETTINGS_COLLECTION).doc(MARKETPLACE_SETTINGS_DOC_ID)
            );
            return snap.exists ? (snap.data() as StoredModerationSettings) : null;
          },
          async getGig(gigId) {
            const snap = await tx.get(db.collection('gigs').doc(gigId));
            return snap.exists ? ({ id: snap.id, ...snap.data() } as StoredGig) : null;
          },
          async listEmployerGigs(uid) {
            const q = db
              .collection('gigs')
              .where('posterUid', '==', uid)
              .where('status', 'in', ['active', 'pending'])
              .limit(51);
            const snap = await tx.get(q);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return snap.docs.map((d: any) => ({ id: d.id, ...d.data() }) as StoredGig);
          },
          createGig(data) {
            const ref = db.collection('gigs').doc();
            tx.set(ref, toFirestoreTimestamps(data as unknown as Record<string, unknown>));
            return ref.id;
          },
          updateGig(gigId, patch) {
            tx.update(
              db.collection('gigs').doc(gigId),
              toFirestoreTimestamps(patch as unknown as Record<string, unknown>)
            );
          },
          setGigContact(gigId, data) {
            tx.set(
              db.collection('gigContacts').doc(gigId),
              {
                posterUid: data.posterUid,
                contactPhone: data.contactPhone,
                contactEmail: data.contactEmail,
                whatsappConsent: data.whatsappConsent,
                emailConsent: data.emailConsent,
                updatedAt: Timestamp.fromMillis(data.updatedAtMs),
                ...(data.createdAtMs ? { createdAt: Timestamp.fromMillis(data.createdAtMs) } : {})
              },
              { merge: true }
            );
          },
          async getIdempotency(key) {
            const snap = await tx.get(db.collection(IDEMPOTENCY_COLLECTION).doc(key));
            return snap.exists ? (snap.data() as IdempotencyRecord) : null;
          },
          setIdempotency(key, record, nowMs) {
            tx.set(db.collection(IDEMPOTENCY_COLLECTION).doc(key), {
              ...record,
              expireAt: Timestamp.fromMillis(nowMs + IDEMPOTENCY_TTL_MS)
            });
          },
          writeAuditLog(entry) {
            writeSanitizedAudit(db, tx, entry);
          }
        })
      );
    }
  };

  const adminStore: AdminStore = {
    runTransaction(fn) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return db.runTransaction(async (tx: any) =>
        fn({
          async getGig(gigId) {
            const snap = await tx.get(db.collection('gigs').doc(gigId));
            return snap.exists ? ({ id: snap.id, ...snap.data() } as StoredGig) : null;
          },
          updateGig(gigId, patch) {
            tx.update(
              db.collection('gigs').doc(gigId),
              toFirestoreTimestamps(patch as unknown as Record<string, unknown>)
            );
          },
          async getEmployer(uid) {
            const snap = await tx.get(db.collection(EMPLOYERS_COLLECTION).doc(uid));
            return snap.exists ? ({ uid: snap.id, ...snap.data() } as StoredEmployerProfile) : null;
          },
          setEmployer(uid, data) {
            tx.set(
              db.collection(EMPLOYERS_COLLECTION).doc(uid),
              toFirestoreTimestamps(data as unknown as Record<string, unknown>),
              { merge: true }
            );
          },
          async listEmployerGigs(uid) {
            const q = db
              .collection('gigs')
              .where('posterUid', '==', uid)
              .where('status', 'in', ['active', 'pending'])
              .limit(51);
            const snap = await tx.get(q);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return snap.docs.map((d: any) => ({ id: d.id, ...d.data() }) as StoredGig);
          },
          async getModerationSettings() {
            const snap = await tx.get(
              db.collection(SETTINGS_COLLECTION).doc(MARKETPLACE_SETTINGS_DOC_ID)
            );
            return snap.exists ? (snap.data() as StoredModerationSettings) : null;
          },
          setModerationSettings(data) {
            tx.set(
              db.collection(SETTINGS_COLLECTION).doc(MARKETPLACE_SETTINGS_DOC_ID),
              toFirestoreTimestamps(data as unknown as Record<string, unknown>),
              { merge: true }
            );
          },
          writeAuditLog(entry) {
            writeSanitizedAudit(db, tx, entry);
          }
        })
      );
    }
  };

  const expirationStore: ExpirationStore = {
    async findStaleActiveGigIds(nowMs, batchSize, afterId) {
      let q = db
        .collection('gigs')
        .where('status', '==', 'active')
        .where('expiresAt', '<=', Timestamp.fromMillis(nowMs))
        .orderBy('expiresAt', 'asc')
        .limit(batchSize);
      if (afterId) {
        const cursorSnap = await db.collection('gigs').doc(afterId).get();
        if (cursorSnap.exists) {
          q = q.startAfter(cursorSnap);
        }
      }
      const snap = await q.get();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return snap.docs.map((d: any) => d.id as string);
    },
    runTransaction(fn) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return db.runTransaction(async (tx: any) =>
        fn({
          async getGig(gigId) {
            const snap = await tx.get(db.collection('gigs').doc(gigId));
            return snap.exists ? ({ id: snap.id, ...snap.data() } as StoredGig) : null;
          },
          updateGig(gigId, patch) {
            tx.update(
              db.collection('gigs').doc(gigId),
              toFirestoreTimestamps(patch as unknown as Record<string, unknown>)
            );
          },
          async getEmployer(uid) {
            const snap = await tx.get(db.collection(EMPLOYERS_COLLECTION).doc(uid));
            return snap.exists ? ({ uid: snap.id, ...snap.data() } as StoredEmployerProfile) : null;
          },
          setEmployer(uid, data) {
            tx.set(
              db.collection(EMPLOYERS_COLLECTION).doc(uid),
              toFirestoreTimestamps(data as unknown as Record<string, unknown>),
              { merge: true }
            );
          },
          async listEmployerGigs(uid) {
            const q = db
              .collection('gigs')
              .where('posterUid', '==', uid)
              .where('status', 'in', ['active', 'pending'])
              .limit(51);
            const snap = await tx.get(q);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return snap.docs.map((d: any) => ({ id: d.id, ...d.data() }) as StoredGig);
          },
          writeAuditLog(entry) {
            writeSanitizedAudit(db, tx, entry);
          }
        })
      );
    }
  };

  const contactStore: ContactStore = {
    async getGig(gigId) {
      const snap = await db.collection('gigs').doc(gigId).get();
      return snap.exists ? (snap.data() ?? null) : null;
    },
    async getContactRecord(gigId): Promise<PrivateContactRecord | null> {
      const snap = await db.collection('gigContacts').doc(gigId).get();
      if (!snap.exists) return null;
      const d = snap.data();
      return {
        contactPhone: d?.contactPhone,
        contactEmail: d?.contactEmail,
        posterPhone: d?.posterPhone,
        whatsappConsent: d?.whatsappConsent,
        emailConsent: d?.emailConsent
      };
    },
    async checkAndConsumeIpRateLimit(
      bucketKey,
      slotKey,
      maxUniquePerWindow,
      maxTotalPerWindow,
      windowMs,
      nowMs
    ) {
      const ref = db.collection('contactRateLimits').doc(bucketKey);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return db.runTransaction(async (tx: any) => {
        const snap = await tx.get(ref);
        const existing: RateBucket | null = snap.exists
          ? {
              gigIds: Array.isArray(snap.data()?.gigIds) ? (snap.data()?.gigIds as string[]) : [],
              totalRequests:
                typeof snap.data()?.totalRequests === 'number'
                  ? (snap.data()?.totalRequests as number)
                  : undefined,
              windowStartMs:
                typeof snap.data()?.windowStartMs === 'number'
                  ? (snap.data()?.windowStartMs as number)
                  : 0
            }
          : null;
        const { allowed, alreadyCounted, nextBucket } = evaluateRateBucket(
          existing,
          slotKey,
          maxUniquePerWindow,
          windowMs,
          nowMs,
          maxTotalPerWindow
        );
        if (allowed) {
          tx.set(ref, {
            gigIds: nextBucket.gigIds,
            totalRequests: nextBucket.totalRequests,
            windowStartMs: nextBucket.windowStartMs,
            updatedAtMs: nowMs,
            expireAt: Timestamp.fromMillis(nowMs + RATE_TTL_MS)
          });
        }
        return { allowed, alreadyCounted };
      });
    },
    async checkAndConsumeListingRateLimit(gigId, maxPerWindow, windowMs, nowMs) {
      const ref = db.collection('contactRateLimits').doc(`gig_${gigId}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return db.runTransaction(async (tx: any) => {
        const snap = await tx.get(ref);
        const existing: ListingBurstBucket | null = snap.exists
          ? {
              count: typeof snap.data()?.count === 'number' ? (snap.data()?.count as number) : 0,
              windowStartMs:
                typeof snap.data()?.windowStartMs === 'number'
                  ? (snap.data()?.windowStartMs as number)
                  : 0
            }
          : null;
        const { allowed, nextBucket } = evaluateListingBurstBucket(
          existing,
          maxPerWindow,
          windowMs,
          nowMs
        );
        if (allowed) {
          tx.set(ref, {
            count: nextBucket.count,
            windowStartMs: nextBucket.windowStartMs,
            updatedAtMs: nowMs,
            expireAt: Timestamp.fromMillis(nowMs + RATE_TTL_MS)
          });
        }
        return allowed;
      });
    }
  };

  return { db, listingStore, adminStore, expirationStore, contactStore };
}
