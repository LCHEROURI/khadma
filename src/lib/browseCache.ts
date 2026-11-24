import type { Gig } from './types';
import { filterPubliclyActiveGigs, isPubliclyActiveGig } from './expiration';

export const BROWSE_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes session-level cache
export const MAX_BROWSE_CACHE_ENTRIES = 40;
export const MAX_PUBLIC_GIG_CACHE_ENTRIES = 80;

export interface BrowseCacheKeyParams {
  mode?: string;
  category?: string;
  neighborhood?: string;
  cursorId?: string | null;
  pageSize: number;
}

export interface CachedBrowsePage<TCursor> {
  gigs: Gig[];
  lastDoc: TCursor | null;
  hasMore: boolean;
}

interface PageEntry<TCursor> {
  value: CachedBrowsePage<TCursor>;
  storedAtMs: number;
}

interface GigEntry {
  value: Gig;
  storedAtMs: number;
}

/**
 * Deterministic key separating cached public browse pages by listing type/mode,
 * category, neighborhood, pagination cursor ID, and page size.
 */
export function buildBrowseCacheKey(params: BrowseCacheKeyParams): string {
  const mode = (params.mode ?? 'all').trim() || 'all';
  const category = (params.category ?? '').trim();
  const neighborhood = (params.neighborhood ?? '').trim();
  const cursorId = params.cursorId ?? 'FIRST';
  return `m=${mode}|c=${category}|n=${neighborhood}|cur=${cursorId}|sz=${params.pageSize}`;
}

/**
 * Bounded session-level in-memory cache for PUBLIC advertisement data ONLY.
 *
 * Security invariants:
 * - Never caches `gigContacts`, retrieved WhatsApp/mailto URLs, or authenticated
 *   employer/admin records.
 * - Re-evaluates `expiresAt` on every cache hit so ads expiring while a tab is open
 *   are excluded immediately.
 * - Deduplicates simultaneous identical in-flight requests.
 * - Enforces hard entry caps with stale-first + LRU eviction.
 */
export class PublicBrowseCache<TCursor = unknown> {
  private readonly pages = new Map<string, PageEntry<TCursor>>();
  private readonly inFlightPages = new Map<string, Promise<CachedBrowsePage<TCursor>>>();
  private readonly gigs = new Map<string, GigEntry>();
  private readonly inFlightGigs = new Map<string, Promise<Gig | null>>();
  private generation = 0;

  constructor(
    private readonly ttlMs = BROWSE_CACHE_TTL_MS,
    private readonly maxPageEntries = MAX_BROWSE_CACHE_ENTRIES,
    private readonly maxGigEntries = MAX_PUBLIC_GIG_CACHE_ENTRIES
  ) {}

  private evictPagesIfNeeded(nowMs: number): void {
    if (this.pages.size < this.maxPageEntries) return;
    for (const [k, entry] of this.pages) {
      if (nowMs - entry.storedAtMs >= this.ttlMs) {
        this.pages.delete(k);
      }
    }
    while (this.pages.size >= this.maxPageEntries) {
      const oldestKey = this.pages.keys().next().value;
      if (oldestKey === undefined) break;
      this.pages.delete(oldestKey);
    }
  }

  private evictGigsIfNeeded(nowMs: number): void {
    if (this.gigs.size < this.maxGigEntries) return;
    for (const [k, entry] of this.gigs) {
      if (nowMs - entry.storedAtMs >= this.ttlMs) {
        this.gigs.delete(k);
      }
    }
    while (this.gigs.size >= this.maxGigEntries) {
      const oldestKey = this.gigs.keys().next().value;
      if (oldestKey === undefined) break;
      this.gigs.delete(oldestKey);
    }
  }

  private seedPublicGig(gig: Gig, nowMs: number): void {
    if (!isPubliclyActiveGig(gig, nowMs)) return;
    this.evictGigsIfNeeded(nowMs);
    this.gigs.delete(gig.id);
    this.gigs.set(gig.id, { value: gig, storedAtMs: nowMs });
  }

  async getOrFetchPage(
    key: string,
    fetcher: () => Promise<CachedBrowsePage<TCursor>>,
    options: { bypassCache?: boolean; nowMs?: number } = {}
  ): Promise<CachedBrowsePage<TCursor>> {
    const nowMs = options.nowMs ?? Date.now();
    if (!options.bypassCache) {
      const cached = this.pages.get(key);
      if (cached && nowMs - cached.storedAtMs < this.ttlMs) {
        // Refresh LRU position and re-evaluate expiration defensively on read
        this.pages.delete(key);
        this.pages.set(key, cached);
        return {
          gigs: filterPubliclyActiveGigs(cached.value.gigs, nowMs),
          lastDoc: cached.value.lastDoc,
          hasMore: cached.value.hasMore
        };
      }
      if (cached) {
        this.pages.delete(key);
      }
      const existingInFlight = this.inFlightPages.get(key);
      if (existingInFlight) {
        return existingInFlight;
      }
    }

    const startGen = this.generation;
    const promise = fetcher()
      .then((res) => {
        const fetchedAt = options.nowMs ?? Date.now();
        const activeGigs = filterPubliclyActiveGigs(res.gigs, fetchedAt);
        const sanitized: CachedBrowsePage<TCursor> = {
          gigs: activeGigs,
          lastDoc: res.lastDoc,
          hasMore: res.hasMore
        };
        // Only write back into cache if no invalidation occurred while this request was in flight
        if (this.generation === startGen) {
          this.evictPagesIfNeeded(fetchedAt);
          this.pages.delete(key);
          this.pages.set(key, { value: sanitized, storedAtMs: fetchedAt });
          for (const g of activeGigs) {
            this.seedPublicGig(g, fetchedAt);
          }
        }
        return sanitized;
      })
      .finally(() => {
        if (this.inFlightPages.get(key) === promise) {
          this.inFlightPages.delete(key);
        }
      });

    if (!options.bypassCache) {
      this.inFlightPages.set(key, promise);
    }
    return promise;
  }

  async getOrFetchPublicGig(
    id: string,
    fetcher: () => Promise<Gig | null>,
    options: { bypassCache?: boolean; nowMs?: number } = {}
  ): Promise<Gig | null> {
    const nowMs = options.nowMs ?? Date.now();
    if (!options.bypassCache) {
      const cached = this.gigs.get(id);
      if (cached && nowMs - cached.storedAtMs < this.ttlMs) {
        if (!isPubliclyActiveGig(cached.value, nowMs)) {
          this.gigs.delete(id);
          // Re-fetch from Firestore so detail page can show accurate expired/hidden status if needed
        } else {
          this.gigs.delete(id);
          this.gigs.set(id, cached);
          return cached.value;
        }
      } else if (cached) {
        this.gigs.delete(id);
      }

      const existingInFlight = this.inFlightGigs.get(id);
      if (existingInFlight) {
        return existingInFlight;
      }
    }

    const startGen = this.generation;
    const promise = fetcher()
      .then((gig) => {
        const fetchedAt = options.nowMs ?? Date.now();
        if (this.generation === startGen) {
          if (gig && isPubliclyActiveGig(gig, fetchedAt)) {
            this.seedPublicGig(gig, fetchedAt);
          } else {
            this.gigs.delete(id);
          }
        }
        return gig;
      })
      .finally(() => {
        if (this.inFlightGigs.get(id) === promise) {
          this.inFlightGigs.delete(id);
        }
      });

    if (!options.bypassCache) {
      this.inFlightGigs.set(id, promise);
    }
    return promise;
  }

  invalidate(gigId?: string): void {
    this.generation += 1;
    this.pages.clear();
    this.inFlightPages.clear();
    if (gigId) {
      this.gigs.delete(gigId);
      this.inFlightGigs.delete(gigId);
    } else {
      this.gigs.clear();
      this.inFlightGigs.clear();
    }
  }

  stats(): { pageEntries: number; gigEntries: number; inFlightPages: number; inFlightGigs: number } {
    return {
      pageEntries: this.pages.size,
      gigEntries: this.gigs.size,
      inFlightPages: this.inFlightPages.size,
      inFlightGigs: this.inFlightGigs.size
    };
  }
}

export const publicBrowseCache = new PublicBrowseCache();
