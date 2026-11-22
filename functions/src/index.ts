import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  ContactHandlerError,
  evaluateRateBucket,
  handleGetGigContactLink,
  type ContactStore,
  type RateBucket
} from './contactHandler.js';

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
