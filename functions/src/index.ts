import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  ContactHandlerError,
  evaluateRateBucket,
  handleGetGigContactLink,
  type ContactStore,
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
  async getContactPhone(gigId: string) {
    const snap = await db.collection('gigContacts').doc(gigId).get();
    const phone = snap.exists ? snap.data()?.posterPhone : null;
    return typeof phone === 'string' ? phone : null;
  },
  async checkAndConsumeRateLimit(bucketKey, gigId, maxPerWindow, windowMs, nowMs) {
    const ref = db.collection('contactRateLimits').doc(bucketKey);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing: RateBucket | null = snap.exists
        ? {
            gigIds: Array.isArray(snap.data()?.gigIds) ? (snap.data()?.gigIds as string[]) : [],
            windowStartMs:
              typeof snap.data()?.windowStartMs === 'number'
                ? (snap.data()?.windowStartMs as number)
                : 0
          }
        : null;
      const { allowed, nextBucket } = evaluateRateBucket(
        existing,
        gigId,
        maxPerWindow,
        windowMs,
        nowMs
      );
      if (allowed) {
        tx.set(ref, {
          gigIds: nextBucket.gigIds,
          windowStartMs: nextBucket.windowStartMs,
          updatedAtMs: nowMs
        });
      }
      return allowed;
    });
  }
};

export const CONTACT_FUNCTION_OPTIONS = {
  region: 'europe-west1',
  enforceAppCheck: true,
  maxInstances: 20
} as const;

/**
 * Authenticated, App-Check-protected, rate-limited WhatsApp contact handoff.
 * Replaces the old public GET /api/contact/:gigId 302 redirect.
 */
export const getGigContactLink = onCall(CONTACT_FUNCTION_OPTIONS, async (request) => {
  const forwarded = request.rawRequest?.headers?.['x-forwarded-for'];
  const forwardedIp =
    typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : Array.isArray(forwarded) ? forwarded[0] : null;
  const clientIp = forwardedIp || request.rawRequest?.ip || null;

  try {
    return await handleGetGigContactLink(firestoreStore, {
      authUid: request.auth?.uid ?? null,
      hasAppCheck: Boolean(request.app),
      clientIp,
      gigId: (request.data as { gigId?: unknown } | null)?.gigId,
      lang: (request.data as { lang?: unknown } | null)?.lang
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
          updatedAtMs: nowMs
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
  const forwarded = request.rawRequest?.headers?.['x-forwarded-for'];
  const forwardedIp =
    typeof forwarded === 'string'
      ? forwarded.split(',')[0]?.trim()
      : Array.isArray(forwarded)
        ? forwarded[0]
        : null;
  const clientIp = forwardedIp || request.rawRequest?.ip || null;

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
