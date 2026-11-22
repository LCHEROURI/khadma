import { describe, expect, it } from 'vitest';
import type { RateBucket } from '../../functions/src/contactHandler';
import {
  checkIpReportRate,
  handleReportGigListing,
  HIDE_AFTER_REPORTS,
  MAX_REPORTS_PER_IP_PER_HOUR,
  ReportHandlerError,
  type ReportStore
} from '../../functions/src/reportHandler';

function createMemoryReportStore(initialGigs: Record<string, { status: string; flags: number }>): ReportStore {
  const gigs = new Map(Object.entries(initialGigs).map(([k, v]) => [k, { ...v }]));
  const reports = new Set<string>();
  const ipBuckets = new Map<string, RateBucket>();

  return {
    async submitReportTransaction({ gigId, uid, ipHash, nowMs }) {
      const gig = gigs.get(gigId);
      if (!gig || gig.status !== 'active') {
        throw new ReportHandlerError('not-found', 'Listing is not active.');
      }
      const reportKey = `${gigId}_${uid}`;
      if (reports.has(reportKey)) {
        throw new ReportHandlerError('already-exists', 'Already reported.');
      }
      if (ipHash) {
        const { duplicateForGig, rateLimited, nextBucket } = checkIpReportRate(
          ipBuckets.get(ipHash) ?? null,
          gigId,
          nowMs
        );
        if (duplicateForGig) {
          throw new ReportHandlerError('already-exists', 'Already reported from this network.');
        }
        if (rateLimited) {
          throw new ReportHandlerError('resource-exhausted', 'Too many reports.');
        }
        ipBuckets.set(ipHash, nextBucket);
      }

      reports.add(reportKey);
      gig.flags += 1;
      const nextStatus: 'active' | 'hidden' = gig.flags >= HIDE_AFTER_REPORTS ? 'hidden' : 'active';
      gig.status = nextStatus;
      return { flags: gig.flags, status: nextStatus };
    }
  };
}

describe('SEC-002 gig reporting Sybil & abuse protection', () => {
  it('blocks App Check and Auth bypass attempts', async () => {
    const store = createMemoryReportStore({ g1: { status: 'active', flags: 0 } });
    await expect(
      handleReportGigListing(store, {
        authUid: 'u1',
        hasAppCheck: false,
        clientIp: '197.200.1.1',
        gigId: 'g1',
        reason: 'scam'
      })
    ).rejects.toMatchObject<Partial<ReportHandlerError>>({ code: 'failed-precondition' });

    await expect(
      handleReportGigListing(store, {
        authUid: null,
        hasAppCheck: true,
        clientIp: '197.200.1.1',
        gigId: 'g1',
        reason: 'scam'
      })
    ).rejects.toMatchObject<Partial<ReportHandlerError>>({ code: 'unauthenticated' });
  });

  it('blocks anonymous UID-cycling Sybil auto-hide from the same IP', async () => {
    const store = createMemoryReportStore({ g1: { status: 'active', flags: 0 } });
    const t0 = 1_700_000_000_000;

    // 1st anonymous UID succeeds
    await expect(
      handleReportGigListing(store, {
        authUid: 'anon-1',
        hasAppCheck: true,
        clientIp: '197.200.5.5',
        gigId: 'g1',
        reason: 'scam',
        nowMs: t0
      })
    ).resolves.toEqual({ flags: 1, status: 'active' });

    // Same UID trying to report the same gig again even from a different IP is blocked
    await expect(
      handleReportGigListing(store, {
        authUid: 'anon-1',
        hasAppCheck: true,
        clientIp: '197.200.99.99',
        gigId: 'g1',
        reason: 'spam',
        nowMs: t0 + 500
      })
    ).rejects.toMatchObject<Partial<ReportHandlerError>>({ code: 'already-exists' });

    // 2nd fresh anonymous UID from the SAME IP is blocked (cannot auto-hide)
    await expect(
      handleReportGigListing(store, {
        authUid: 'anon-2',
        hasAppCheck: true,
        clientIp: '197.200.5.5',
        gigId: 'g1',
        reason: 'spam',
        nowMs: t0 + 1000
      })
    ).rejects.toMatchObject<Partial<ReportHandlerError>>({ code: 'already-exists' });
  });

  it('auto-hides gig after 3 reports from distinct users and networks', async () => {
    const store = createMemoryReportStore({ g1: { status: 'active', flags: 0 } });
    const t0 = 1_700_000_000_000;

    await expect(
      handleReportGigListing(store, { authUid: 'u1', hasAppCheck: true, clientIp: '10.0.0.1', gigId: 'g1', reason: 'scam', nowMs: t0 })
    ).resolves.toEqual({ flags: 1, status: 'active' });
    await expect(
      handleReportGigListing(store, { authUid: 'u2', hasAppCheck: true, clientIp: '10.0.0.2', gigId: 'g1', reason: 'scam', nowMs: t0 })
    ).resolves.toEqual({ flags: 2, status: 'active' });
    await expect(
      handleReportGigListing(store, { authUid: 'u3', hasAppCheck: true, clientIp: '10.0.0.3', gigId: 'g1', reason: 'scam', nowMs: t0 })
    ).resolves.toEqual({ flags: 3, status: 'hidden' });
  });

  it('enforces per-IP hourly report cap across distinct gigs', async () => {
    const init: Record<string, { status: string; flags: number }> = {};
    for (let i = 1; i <= MAX_REPORTS_PER_IP_PER_HOUR + 1; i += 1) {
      init[`g_${i}`] = { status: 'active', flags: 0 };
    }
    const store = createMemoryReportStore(init);
    const t0 = 1_700_000_000_000;

    for (let i = 1; i <= MAX_REPORTS_PER_IP_PER_HOUR; i += 1) {
      await expect(
        handleReportGigListing(store, {
          authUid: `u_${i}`,
          hasAppCheck: true,
          clientIp: '197.200.8.8',
          gigId: `g_${i}`,
          reason: 'spam',
          nowMs: t0
        })
      ).resolves.toEqual({ flags: 1, status: 'active' });
    }

    await expect(
      handleReportGigListing(store, {
        authUid: 'u_overflow',
        hasAppCheck: true,
        clientIp: '197.200.8.8',
        gigId: `g_${MAX_REPORTS_PER_IP_PER_HOUR + 1}`,
        reason: 'spam',
        nowMs: t0 + 1000
      })
    ).rejects.toMatchObject<Partial<ReportHandlerError>>({ code: 'resource-exhausted' });
  });
});
