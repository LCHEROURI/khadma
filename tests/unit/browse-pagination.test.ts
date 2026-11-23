import { describe, expect, it } from 'vitest';
import {
  createBrowsePaginationController,
  mergeUniqueGigs,
  type BrowsePaginationState,
  type PageResult
} from '../../src/lib/browsePagination';
import { filterListings } from '../../src/lib/search';
import { STRINGS } from '../../src/lib/strings';
import type { Gig } from '../../src/lib/types';

function makeGig(id: string, overrides: Partial<Gig> = {}): Gig {
  return {
    id,
    title: `Offre ${id}`,
    description: `Description ${id}`,
    category: 'construction',
    listingType: 'job',
    payMin: 2000,
    payMax: 3000,
    neighborhood: 'Bir El Djir',
    posterUid: 'u1',
    flags: 0,
    status: 'active',
    verified: true,
    isSample: false,
    createdAt: { seconds: 1000, nanoseconds: 0 },
    ...overrides
  };
}

describe('KHADMA V1.3 Browse pagination reliability', () => {
  it('shows initialError when initial load fails and recovers cleanly on initial retry', async () => {
    let shouldFail = true;
    const cursors: Array<string | null> = [];
    const g1 = makeGig('g1');

    let latest!: BrowsePaginationState<string>;
    const ctrl = createBrowsePaginationController<string>({
      fetchPage: async (after) => {
        cursors.push(after);
        if (shouldFail) throw new Error('offline');
        return { gigs: [g1], lastDoc: 'cursor-1', hasMore: true };
      },
      pageSize: 50,
      maxInitialAttempts: 1,
      retryDelayMs: 0,
      getInitialErrorMessage: () => STRINGS.fr['common.loadError'],
      getLoadMoreErrorMessage: () => STRINGS.fr['browse.loadMoreError'],
      onStateChange: (s) => {
        latest = s;
      }
    });

    await ctrl.loadInitial();
    expect(latest.loading).toBe(false);
    expect(latest.initialError).toBe(STRINGS.fr['common.loadError']);
    expect(latest.loadMoreError).toBe('');
    expect(latest.gigs).toEqual([]);

    shouldFail = false;
    await ctrl.loadInitial();
    expect(latest.initialError).toBe('');
    expect(latest.gigs.map((g) => g.id)).toEqual(['g1']);
    expect(cursors).toEqual([null, null]);
  });

  it('preserves loaded cards, cursor, active filters, and job/service separation on Load More failure and deduplicates overlapping retry', async () => {
    const gJob1 = makeGig('g-job-1', { title: 'Peintre Oran', listingType: 'job', category: 'construction' });
    const gSvc1 = makeGig('g-svc-1', { title: 'Peintre service', listingType: 'service', category: 'construction' });
    const gJob2 = makeGig('g-job-2', { title: 'Peintre Canastel', listingType: 'job', category: 'construction' });

    const seenCursors: Array<string | null> = [];
    let failSecondPage = true;

    let latest!: BrowsePaginationState<string>;
    const ctrl = createBrowsePaginationController<string>({
      fetchPage: async (after): Promise<PageResult<string>> => {
        seenCursors.push(after);
        if (after === null) {
          return { gigs: [gJob1, gSvc1], lastDoc: 'cursor-p1', hasMore: true };
        }
        if (failSecondPage) {
          throw new Error('transient network drop');
        }
        // Return overlapping gJob1 + new gJob2 to prove deduplication
        return { gigs: [gJob1, gJob2], lastDoc: null, hasMore: false };
      },
      pageSize: 50,
      maxInitialAttempts: 1,
      retryDelayMs: 0,
      getInitialErrorMessage: () => STRINGS.fr['common.loadError'],
      getLoadMoreErrorMessage: () => STRINGS.fr['browse.loadMoreError'],
      onStateChange: (s) => {
        latest = s;
      }
    });

    await ctrl.loadInitial();
    expect(latest.gigs.map((g) => g.id)).toEqual(['g-job-1', 'g-svc-1']);

    // Load More fails -> existing cards & cursor MUST remain intact, initialError MUST stay empty
    await ctrl.loadMore();
    expect(latest.initialError).toBe('');
    expect(latest.loadMoreError).toBe(STRINGS.fr['browse.loadMoreError']);
    expect(latest.loadingMore).toBe(false);
    expect(latest.lastDoc).toBe('cursor-p1');
    expect(latest.gigs.map((g) => g.id)).toEqual(['g-job-1', 'g-svc-1']);

    // Active filters and strict job/service separation remain intact while loadMoreError is shown
    const activeCriteria = { mode: 'job' as const, query: 'peintre', category: 'construction' };
    expect(filterListings(latest.gigs, activeCriteria).map((g) => g.id)).toEqual(['g-job-1']);

    // Retry Load More -> resumes from exact same cursor-p1, clears loadMoreError, deduplicates g-job-1
    failSecondPage = false;
    await ctrl.loadMore();
    expect(seenCursors).toEqual([null, 'cursor-p1', 'cursor-p1']);
    expect(latest.loadMoreError).toBe('');
    expect(latest.lastDoc).toBeNull();
    expect(latest.gigs.map((g) => g.id)).toEqual(['g-job-1', 'g-svc-1', 'g-job-2']);
    expect(filterListings(latest.gigs, activeCriteria).map((g) => g.id)).toEqual(['g-job-1', 'g-job-2']);
  });

  it('prevents duplicate concurrent Load More requests on rapid repeated clicks', async () => {
    let page2Calls = 0;
    let resolvePage2!: (res: PageResult<string>) => void;
    const page2Promise = new Promise<PageResult<string>>((res) => {
      resolvePage2 = res;
    });

    let latest!: BrowsePaginationState<string>;
    const ctrl = createBrowsePaginationController<string>({
      fetchPage: async (after) => {
        if (after === null) return { gigs: [makeGig('g1')], lastDoc: 'c1', hasMore: true };
        page2Calls += 1;
        return page2Promise;
      },
      pageSize: 50,
      maxInitialAttempts: 1,
      retryDelayMs: 0,
      getInitialErrorMessage: () => STRINGS.fr['common.loadError'],
      getLoadMoreErrorMessage: () => STRINGS.fr['browse.loadMoreError'],
      onStateChange: (s) => {
        latest = s;
      }
    });

    await ctrl.loadInitial();
    const pA = ctrl.loadMore();
    const pB = ctrl.loadMore();
    expect(latest.loadingMore).toBe(true);
    expect(page2Calls).toBe(1);

    resolvePage2({ gigs: [makeGig('g2')], lastDoc: null, hasMore: false });
    await Promise.all([pA, pB]);
    expect(page2Calls).toBe(1);
    expect(latest.loadingMore).toBe(false);
    expect(latest.gigs.map((g) => g.id)).toEqual(['g1', 'g2']);
  });

  it('deduplicates overlapping arrays via mergeUniqueGigs and has localized FR/AR pagination strings', () => {
    const merged = mergeUniqueGigs([makeGig('a'), makeGig('b')], [makeGig('b'), makeGig('c')]);
    expect(merged.map((g) => g.id)).toEqual(['a', 'b', 'c']);

    expect(STRINGS.fr['browse.loadMoreError']?.trim().length).toBeGreaterThan(0);
    expect(STRINGS.fr['browse.loadMoreRetry']?.trim().length).toBeGreaterThan(0);
    expect(STRINGS.ar['browse.loadMoreError']?.trim().length).toBeGreaterThan(0);
    expect(STRINGS.ar['browse.loadMoreRetry']?.trim().length).toBeGreaterThan(0);
  });
});
