import { describe, expect, it, vi } from 'vitest';
import {
  BROWSE_CACHE_TTL_MS,
  buildBrowseCacheKey,
  PublicBrowseCache
} from '../../src/lib/browseCache';
import {
  classifyGigExpiration,
  filterPubliclyActiveGigs,
  isGigExpired,
  parseGigExpiresAtMs
} from '../../src/lib/expiration';
import { filterListings } from '../../src/lib/search';
import { createBrowsePaginationController } from '../../src/lib/browsePagination';
import type { Gig } from '../../src/lib/types';

function makeGig(overrides: Partial<Gig> = {}): Gig {
  return {
    id: 'gig_1',
    title: 'Électricien Oran',
    description: 'Chantier à Es Sénia',
    category: 'construction',
    listingType: 'job',
    payMin: 3000,
    payMax: 4500,
    neighborhood: 'Es Sénia',
    posterUid: 'u_1',
    flags: 0,
    status: 'active',
    verified: true,
    isSample: false,
    createdAt: null,
    expiresAt: null,
    ...overrides
  };
}

describe('Phase 5 — Bounded Browse Caching & Defensive Expiration Filtering', () => {
  it('separates cache keys by mode, category, neighborhood, cursor, and pageSize', () => {
    const k1 = buildBrowseCacheKey({ mode: 'job', pageSize: 20 });
    const k2 = buildBrowseCacheKey({ mode: 'service', pageSize: 20 });
    const k3 = buildBrowseCacheKey({ mode: 'job', category: 'delivery', pageSize: 20 });
    const k4 = buildBrowseCacheKey({ mode: 'job', neighborhood: 'Canastel', pageSize: 20 });
    const k5 = buildBrowseCacheKey({ mode: 'job', cursorId: 'doc_20', pageSize: 20 });
    const k6 = buildBrowseCacheKey({ mode: 'job', pageSize: 10 });

    expect(new Set([k1, k2, k3, k4, k5, k6]).size).toBe(6);
  });

  it('caches public pages for 2 minutes, deduplicates concurrent identical requests, and supports explicit refresh & invalidation', async () => {
    const cache = new PublicBrowseCache<string>(BROWSE_CACHE_TTL_MS, 5, 10);
    const now = 1_760_000_000_000;
    const key = buildBrowseCacheKey({ mode: 'job', pageSize: 20 });

    let resolveFetch!: (v: { gigs: Gig[]; lastDoc: string | null; hasMore: boolean }) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<{ gigs: Gig[]; lastDoc: string | null; hasMore: boolean }>((resolve) => {
          resolveFetch = resolve;
        })
    );

    // Two simultaneous identical requests -> strictly 1 underlying fetch call
    const p1 = cache.getOrFetchPage(key, fetcher, { nowMs: now });
    const p2 = cache.getOrFetchPage(key, fetcher, { nowMs: now + 5 });
    resolveFetch({ gigs: [makeGig({ id: 'g1' })], lastDoc: 'g1', hasMore: false });
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(r1.gigs.map((g) => g.id)).toEqual(['g1']);
    expect(r2.gigs.map((g) => g.id)).toEqual(['g1']);

    // Within 2-minute TTL -> cache hit (0 new fetches)
    const r3 = await cache.getOrFetchPage(key, fetcher, { nowMs: now + 60_000 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(r3.gigs).toHaveLength(1);

    // Explicit refresh bypasses cache
    const fetcher2 = vi.fn(async () => ({ gigs: [makeGig({ id: 'g2' })], lastDoc: null, hasMore: false }));
    const r4 = await cache.getOrFetchPage(key, fetcher2, { bypassCache: true, nowMs: now + 61_000 });
    expect(fetcher2).toHaveBeenCalledTimes(1);
    expect(r4.gigs.map((g) => g.id)).toEqual(['g2']);

    // Mutation invalidation clears cached pages
    cache.invalidate('g2');
    const fetcher3 = vi.fn(async () => ({ gigs: [makeGig({ id: 'g3' })], lastDoc: null, hasMore: false }));
    const r5 = await cache.getOrFetchPage(key, fetcher3, { nowMs: now + 62_000 });
    expect(fetcher3).toHaveBeenCalledTimes(1);
    expect(r5.gigs.map((g) => g.id)).toEqual(['g3']);

    // After 2-minute TTL expires -> fetches fresh data
    const fetcher4 = vi.fn(async () => ({ gigs: [], lastDoc: null, hasMore: false }));
    await cache.getOrFetchPage(key, fetcher4, { nowMs: now + 62_000 + BROWSE_CACHE_TTL_MS + 1 });
    expect(fetcher4).toHaveBeenCalledTimes(1);
  });

  it('bounds cache memory via hard entry caps (LRU + stale-first eviction)', async () => {
    const cache = new PublicBrowseCache<string>(BROWSE_CACHE_TTL_MS, 3, 4);
    const now = 1_760_000_000_000;

    for (let i = 1; i <= 10; i++) {
      await cache.getOrFetchPage(
        `page_${i}`,
        async () => ({ gigs: [makeGig({ id: `g_${i}` })], lastDoc: null, hasMore: false }),
        { nowMs: now + i * 100 }
      );
    }

    const s = cache.stats();
    expect(s.pageEntries).toBeLessThanOrEqual(3);
    expect(s.gigEntries).toBeLessThanOrEqual(4);
  });

  it('reevaluates expiration on cached data while tab stays open, preserves legacy missing timestamps, and fails closed on malformed timestamps', async () => {
    const cache = new PublicBrowseCache<string>(BROWSE_CACHE_TTL_MS, 10, 20);
    const t0 = 1_760_000_000_000;

    const expiringSoon = makeGig({
      id: 'exp_soon',
      expiresAt: { toMillis: () => t0 + 30_000 } as unknown as Gig['expiresAt']
    });
    const legacyNoExpiry = makeGig({ id: 'legacy_null', expiresAt: null });
    const malformedString = makeGig({
      id: 'malformed_str',
      expiresAt: 'not-a-timestamp' as unknown as Gig['expiresAt']
    });
    const malformedNeg = makeGig({
      id: 'malformed_neg',
      expiresAt: -500 as unknown as Gig['expiresAt']
    });

    // Legitimate legacy missing timestamp -> non-expiring
    expect(classifyGigExpiration(legacyNoExpiry)).toEqual({ kind: 'legacy_missing' });
    expect(parseGigExpiresAtMs(legacyNoExpiry)).toBeNull();
    expect(isGigExpired(legacyNoExpiry, t0 + 999_999)).toBe(false);

    // Malformed / corrupted timestamps -> FAIL CLOSED (treated as expired, never non-expiring!)
    expect(classifyGigExpiration(malformedString)).toEqual({ kind: 'malformed' });
    expect(classifyGigExpiration(malformedNeg)).toEqual({ kind: 'malformed' });
    expect(parseGigExpiresAtMs(malformedString)).toBeNull();
    expect(isGigExpired(malformedString, t0)).toBe(true);
    expect(isGigExpired(malformedNeg, t0)).toBe(true);

    const key = buildBrowseCacheKey({ mode: 'job', pageSize: 20 });
    const fetcher = vi.fn(async () => ({
      gigs: [expiringSoon, legacyNoExpiry, malformedString, malformedNeg],
      lastDoc: null,
      hasMore: false
    }));

    // At t0: malformed ads are immediately excluded; only valid non-expired + legacy_null remain
    const before = await cache.getOrFetchPage(key, fetcher, { nowMs: t0 });
    expect(before.gigs.map((g) => g.id)).toEqual(['exp_soon', 'legacy_null']);

    // At t0 + 45s (still within 2-min cache TTL, but past exp_soon's expiresAt!):
    // Cache hit excludes exp_soon without needing a Firestore refetch!
    const after = await cache.getOrFetchPage(key, fetcher, { nowMs: t0 + 45_000 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(after.gigs.map((g) => g.id)).toEqual(['legacy_null']);

    // Search & Saved defensive filters also exclude expired AND malformed ads
    const searchFiltered = filterListings(
      [expiringSoon, legacyNoExpiry, malformedString],
      { mode: 'job' },
      t0 + 45_000
    );
    expect(searchFiltered.map((g) => g.id)).toEqual(['legacy_null']);

    const savedFiltered = filterPubliclyActiveGigs(
      [expiringSoon, legacyNoExpiry, malformedString, makeGig({ id: 'archived_1', status: 'archived' })],
      t0 + 45_000
    );
    expect(savedFiltered.map((g) => g.id)).toEqual(['legacy_null']);
  });

  it('prevents stale in-flight responses from repopulating cache after invalidation and evicts remotely hidden/removed ads on revalidation', async () => {
    const cache = new PublicBrowseCache<string>(BROWSE_CACHE_TTL_MS, 10, 20);
    const t0 = 1_760_000_000_000;
    const key = buildBrowseCacheKey({ mode: 'job', pageSize: 20 });

    // 1. Invalidation during an in-flight request must NOT poison the cache when the old promise resolves
    let resolveStale!: (v: { gigs: Gig[]; lastDoc: string | null; hasMore: boolean }) => void;
    const staleFetcher = vi.fn(
      () =>
        new Promise<{ gigs: Gig[]; lastDoc: string | null; hasMore: boolean }>((resolve) => {
          resolveStale = resolve;
        })
    );
    const inFlight = cache.getOrFetchPage(key, staleFetcher, { nowMs: t0 });
    cache.invalidate(); // Mutation or sign-out occurs while request is still in flight
    resolveStale({ gigs: [makeGig({ id: 'stale_ad' })], lastDoc: null, hasMore: false });
    await inFlight;

    // Cache must remain empty so next request fetches fresh data
    expect(cache.stats().pageEntries).toBe(0);
    expect(cache.stats().gigEntries).toBe(0);

    // 2. Cross-session admin removal/hiding: cached ad is evicted upon TTL expiry or explicit refresh
    const freshFetcher = vi.fn(async () => ({
      gigs: [makeGig({ id: 'mod_ad', status: 'active' })],
      lastDoc: null,
      hasMore: false
    }));
    await cache.getOrFetchPage(key, freshFetcher, { nowMs: t0 + 100 });
    expect(cache.stats().gigEntries).toBe(1);

    // Simulate admin hiding the ad in another session -> after TTL expires, getOrFetchPublicGig revalidates & does NOT cache hidden ad
    const hiddenFetcher = vi.fn(async () => makeGig({ id: 'mod_ad', status: 'hidden' }));
    const revalidated = await cache.getOrFetchPublicGig('mod_ad', hiddenFetcher, {
      nowMs: t0 + 100 + BROWSE_CACHE_TTL_MS + 1
    });
    expect(revalidated?.status).toBe('hidden');
    expect(cache.stats().gigEntries).toBe(0);
  });

  it('preserves already-loaded results when an explicit user refresh fails', async () => {
    let callCount = 0;
    const states: Array<{ gigs: Gig[]; loadMoreError: string }> = [];
    const controller = createBrowsePaginationController<string>({
      fetchPage: async () => {
        callCount += 1;
        if (callCount === 1) {
          return { gigs: [makeGig({ id: 'loaded_1' })], lastDoc: 'loaded_1', hasMore: true };
        }
        throw new Error('network down');
      },
      pageSize: 20,
      maxInitialAttempts: 1,
      retryDelayMs: 0,
      getInitialErrorMessage: () => 'init-err',
      getLoadMoreErrorMessage: () => 'refresh-err',
      onStateChange: (s) => states.push({ gigs: s.gigs, loadMoreError: s.loadMoreError })
    });

    await controller.loadInitial();
    expect(states[states.length - 1].gigs.map((g) => g.id)).toEqual(['loaded_1']);

    await controller.refresh();
    const last = states[states.length - 1];
    expect(last.gigs.map((g) => g.id)).toEqual(['loaded_1']);
    expect(last.loadMoreError).toBe('refresh-err');
    controller.dispose();
  });
});
