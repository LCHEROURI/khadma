import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
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

initializeApp();
const db = getFirestore();

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
  enforceAppCheck: true,
  maxInstances: 20,
  timeoutSeconds: 15
} as const;

/**
 * Account-free, App-Check-protected, IP + listing rate-limited WhatsApp & email contact handoff.
 * Backward-compatible with V1.3 clients (channel defaults to 'whatsapp', response includes waUrl).
 */
export const getGigContactLink = onCall(CONTACT_FUNCTION_OPTIONS, async (request) => {
  const clientIp = extractTrustedClientIp(request.rawRequest);
  const data = (request.data ?? {}) as { gigId?: unknown; channel?: unknown; lang?: unknown };

  try {
    return await handleGetGigContactLink(firestoreStore, {
      authUid: request.auth?.uid ?? null,
      hasAppCheck: Boolean(request.app),
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

/**
 * Authenticated, App-Check-protected, IP-Sybil-resistant gig reporting endpoint (SEC-002).
 */
export const reportGigListing = onCall(CONTACT_FUNCTION_OPTIONS, async (request) => {
  const clientIp = extractTrustedClientIp(request.rawRequest);

  try {
    return await handleReportGigListing(firestoreReportStore, {
      authUid: request.auth?.uid ?? null,
      hasAppCheck: Boolean(request.app),
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
