import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import {
  ContactHandlerError,
  evaluateListingBurstBucket,
  evaluateRateBucket,
  extractTrustedClientIp,
  handleGetGigContactLink,
  RATE_TTL_MS,
  type ContactStore,
  type ListingBurstBucket,
  type PrivateContactRecord,
  type RateBucket
} from './contactHandler.js';
import {
  checkIpReportRate,
  handleReportGigListing,
  HIDE_AFTER_REPORTS,
  ReportHandlerError,
  type ReportStore
} from './reportHandler.js';
import {
  EMPLOYER_ACTIVE_QUERY_LIMIT,
  handleManageEmployerListing,
  ListingHandlerError,
  type AuditRecordInput,
  type IdempotencyRecord,
  type ListingStore,
  type StoredEmployerProfile,
  type StoredGig,
  type StoredModerationSettings
} from './listingHandler.js';
import { handleAdminManageMarketplace, type AdminStore } from './adminHandler.js';
import { runExpireStaleGigs, type ExpirationStore } from './expirationHandler.js';
import {
  AUDIT_LOGS_COLLECTION,
  EMPLOYERS_COLLECTION,
  MARKETPLACE_SETTINGS_DOC_ID,
  SETTINGS_COLLECTION
} from './types.js';

initializeApp();
const db = getFirestore();

const IDEMPOTENCY_COLLECTION = 'listingIdempotency';
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
// N+1 sentinel probe: fetch 51 docs so >50 active/pending ads triggers overflow protection instead of silent truncation
const EMPLOYER_ACTIVE_QUERY_PROBE_LIMIT = EMPLOYER_ACTIVE_QUERY_LIMIT + 1;

/**
 * Pure predicate verifying that the runtime is strictly an isolated local `demo-*`
 * Firebase Functions Emulator (and NEVER deployed Cloud Run / Cloud Functions v2 where K_SERVICE is set).
 * No client-controlled header or payload can influence this check.
 */
export function isDemoEmulatorEnv(env: Record<string, string | undefined> = process.env): boolean {
  return (
    env.FUNCTIONS_EMULATOR === 'true' &&
    typeof env.GCLOUD_PROJECT === 'string' &&
    env.GCLOUD_PROJECT.startsWith('demo-') &&
    Boolean(env.FIRESTORE_EMULATOR_HOST)
  );
}

const IS_DEMO_EMULATOR = isDemoEmulatorEnv(process.env);

/**
 * Evaluates App Check attestation for callable requests.
 * Production always requires a verified `request.app` (in addition to `enforceAppCheck: true`).
 * Strictly scoped accommodation ONLY for isolated local `demo-*` Firebase Functions Emulator runs.
 */
export function resolveHasAppCheck(
  request: { app?: unknown },
  env: Record<string, string | undefined> = process.env
): boolean {
  if (request.app) return true;
  return isDemoEmulatorEnv(env);
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

function writeSanitizedAudit(
  tx: FirebaseFirestore.Transaction,
  entry: AuditRecordInput
): void {
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

const firestoreStore: ContactStore = {
  async getGig(gigId: string) {
    const snap = await db.collection('gigs').doc(gigId).get();
    return snap.exists ? (snap.data() ?? null) : null;
  },
  async getContactRecord(gigId: string): Promise<PrivateContactRecord | null> {
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
    return db.runTransaction(async (tx) => {
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
    return db.runTransaction(async (tx) => {
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

export const CONTACT_FUNCTION_OPTIONS = {
  region: 'europe-west1',
  enforceAppCheck: !IS_DEMO_EMULATOR,
  maxInstances: 20,
  timeoutSeconds: 15
} as const;

export const getGigContactLink = onCall(CONTACT_FUNCTION_OPTIONS, async (request) => {
  const clientIp = extractTrustedClientIp(request.rawRequest);
  const data = (request.data ?? {}) as { gigId?: unknown; channel?: unknown; lang?: unknown };

  try {
    return await handleGetGigContactLink(firestoreStore, {
      authUid: request.auth?.uid ?? null,
      hasAppCheck: resolveHasAppCheck(request),
      clientIp,
      gigId: data.gigId,
      channel: data.channel,
      lang: data.lang
    });
  } catch (err) {
    if (err instanceof ContactHandlerError) {
      throw new HttpsError(err.code, err.message);
    }
    throw new HttpsError('internal', 'Internal Server Error');
  }
});

const firestoreReportStore: ReportStore = {
  async submitReportTransaction({ gigId, reason, uid, ipHash, nowMs }) {
    const gigRef = db.collection('gigs').doc(gigId);
    const reportRef = db.collection('reports').doc(`${gigId}_${uid}`);
    const ipLimitRef = ipHash ? db.collection('reportRateLimits').doc(`ip_${ipHash}`) : null;

    return db.runTransaction(async (tx) => {
      const [gigSnap, reportSnap, ipSnap] = await Promise.all([
        tx.get(gigRef),
        tx.get(reportRef),
        ipLimitRef ? tx.get(ipLimitRef) : Promise.resolve(null)
      ]);

      if (!gigSnap.exists || gigSnap.data()?.status !== 'active') {
        throw new ReportHandlerError('not-found', 'Listing is not active.');
      }
      if (reportSnap.exists) {
        throw new ReportHandlerError('already-exists', 'Already reported.');
      }

      if (ipLimitRef) {
        const existingIp: RateBucket | null = ipSnap?.exists
          ? {
              gigIds: Array.isArray(ipSnap.data()?.gigIds) ? (ipSnap.data()?.gigIds as string[]) : [],
              windowStartMs:
                typeof ipSnap.data()?.windowStartMs === 'number'
                  ? (ipSnap.data()?.windowStartMs as number)
                  : 0
            }
          : null;
        const { duplicateForGig, rateLimited, nextBucket } = checkIpReportRate(
          existingIp,
          gigId,
          nowMs
        );
        if (duplicateForGig) {
          throw new ReportHandlerError('already-exists', 'Already reported from this network.');
        }
        if (rateLimited) {
          throw new ReportHandlerError('resource-exhausted', 'Too many reports from this network.');
        }
        tx.set(ipLimitRef, {
          gigIds: nextBucket.gigIds,
          windowStartMs: nextBucket.windowStartMs,
          updatedAtMs: nowMs,
          expireAt: Timestamp.fromMillis(nowMs + RATE_TTL_MS)
        });
      }

      const currentFlags = typeof gigSnap.data()?.flags === 'number' ? (gigSnap.data()?.flags as number) : 0;
      const newFlags = currentFlags + 1;
      const nextStatus: 'active' | 'hidden' = newFlags >= HIDE_AFTER_REPORTS ? 'hidden' : 'active';

      tx.set(reportRef, {
        gigId,
        reason,
        reporterId: uid,
        createdAt: FieldValue.serverTimestamp()
      });
      tx.update(gigRef, { flags: newFlags, status: nextStatus });

      return { flags: newFlags, status: nextStatus };
    });
  }
};

export const reportGigListing = onCall(CONTACT_FUNCTION_OPTIONS, async (request) => {
  const clientIp = extractTrustedClientIp(request.rawRequest);

  try {
    return await handleReportGigListing(firestoreReportStore, {
      authUid: request.auth?.uid ?? null,
      hasAppCheck: resolveHasAppCheck(request),
      clientIp,
      gigId: (request.data as { gigId?: unknown } | null)?.gigId,
      reason: (request.data as { reason?: unknown } | null)?.reason
    });
  } catch (err) {
    if (err instanceof ReportHandlerError) {
      throw new HttpsError(err.code, err.message);
    }
    throw new HttpsError('internal', 'Internal Server Error');
  }
});

// ---------- Phase 4: Employer Listing Lifecycle ----------

const firestoreListingStore: ListingStore = {
  runTransaction(fn) {
    return db.runTransaction(async (tx) => {
      return fn({
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
            .limit(EMPLOYER_ACTIVE_QUERY_PROBE_LIMIT);
          const snap = await tx.get(q);
          return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as StoredGig);
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
          writeSanitizedAudit(tx, entry);
        }
      });
    });
  }
};

export const manageEmployerListing = onCall(CONTACT_FUNCTION_OPTIONS, async (request) => {
  try {
    return await handleManageEmployerListing(firestoreListingStore, {
      authUid: request.auth?.uid ?? null,
      authEmail: typeof request.auth?.token?.email === 'string' ? request.auth.token.email : null,
      authEmailVerified: request.auth?.token?.email_verified === true,
      authPhone:
        typeof request.auth?.token?.phone_number === 'string'
          ? request.auth.token.phone_number
          : null,
      hasAppCheck: resolveHasAppCheck(request),
      payload: request.data
    });
  } catch (err) {
    if (err instanceof ListingHandlerError) {
      throw new HttpsError(err.code, err.message, err.details);
    }
    throw new HttpsError('internal', 'Internal Server Error');
  }
});

// ---------- Phase 4: Administrator Moderation & Quotas ----------

const firestoreAdminStore: AdminStore = {
  runTransaction(fn) {
    return db.runTransaction(async (tx) => {
      return fn({
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
            .limit(EMPLOYER_ACTIVE_QUERY_PROBE_LIMIT);
          const snap = await tx.get(q);
          return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as StoredGig);
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
          writeSanitizedAudit(tx, entry);
        }
      });
    });
  },
  async seedSamples(items, adminUid, nowMs) {
    const batch = db.batch();
    const expiresAt = Timestamp.fromMillis(nowMs + 30 * 24 * 60 * 60 * 1000);
    for (const s of items) {
      const ref = db.collection('gigs').doc();
      batch.set(ref, {
        title: s.title,
        description: s.description,
        category: s.category,
        listingType: 'job',
        city: 'oran',
        wilayaCode: '31',
        payMin: s.payMin,
        payMax: s.payMax,
        neighborhood: s.neighborhood,
        posterUid: 'sample',
        flags: 0,
        status: 'active',
        verified: false,
        isSample: true,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        expiresAt
      });
    }
    const auditRef = db.collection('auditLogs').doc();
    batch.set(auditRef, {
      actorUid: adminUid,
      actorRole: 'admin',
      action: 'seedSamples',
      targetType: 'gig',
      targetId: 'samples',
      reason: 'Seed sample listings',
      metadata: { count: items.length },
      createdAt: FieldValue.serverTimestamp()
    });
    await batch.commit();
    return items.length;
  },
  async removeAllSamples(adminUid, _nowMs) {
    const snap = await db.collection('gigs').where('isSample', '==', true).limit(150).get();
    const toRemove = snap.docs.filter((d) => d.data().status !== 'removed');
    if (toRemove.length > 0) {
      const batch = db.batch();
      for (const d of toRemove) {
        batch.update(d.ref, { status: 'removed', updatedAt: FieldValue.serverTimestamp() });
      }
      const auditRef = db.collection('auditLogs').doc();
      batch.set(auditRef, {
        actorUid: adminUid,
        actorRole: 'admin',
        action: 'removeAllSamples',
        targetType: 'gig',
        targetId: 'samples',
        reason: 'Remove all sample listings',
        metadata: { count: toRemove.length },
        createdAt: FieldValue.serverTimestamp()
      });
      await batch.commit();
    }
    return toRemove.length;
  }
};

export const adminManageMarketplace = onCall(CONTACT_FUNCTION_OPTIONS, async (request) => {
  try {
    return await handleAdminManageMarketplace(firestoreAdminStore, {
      authUid: request.auth?.uid ?? null,
      authEmail: typeof request.auth?.token?.email === 'string' ? request.auth.token.email : null,
      authEmailVerified: request.auth?.token?.email_verified === true,
      hasAppCheck: resolveHasAppCheck(request),
      payload: request.data
    });
  } catch (err) {
    if (err instanceof ListingHandlerError) {
      throw new HttpsError(err.code, err.message, err.details);
    }
    throw new HttpsError('internal', 'Internal Server Error');
  }
});

// ---------- Phase 4: Scheduled Expiration Sweep (Every 6 Hours) ----------

const firestoreExpirationStore: ExpirationStore = {
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
    return snap.docs.map((d) => d.id);
  },
  runTransaction(fn) {
    return db.runTransaction(async (tx) => {
      return fn({
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
            .limit(EMPLOYER_ACTIVE_QUERY_PROBE_LIMIT);
          const snap = await tx.get(q);
          return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as StoredGig);
        },
        writeAuditLog(entry) {
          writeSanitizedAudit(tx, entry);
        }
      });
    });
  }
};

export const expireStaleGigs = onSchedule(
  {
    schedule: 'every 6 hours',
    region: 'europe-west1',
    maxInstances: 1,
    timeoutSeconds: 120
  },
  async () => {
    await runExpireStaleGigs(firestoreExpirationStore);
  }
);
