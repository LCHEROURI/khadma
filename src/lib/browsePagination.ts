import type { Gig } from './types';

export interface PageResult<TCursor> {
  gigs: Gig[];
  lastDoc: TCursor | null;
  hasMore: boolean;
}

export interface BrowsePaginationState<TCursor> {
  gigs: Gig[];
  lastDoc: TCursor | null;
  loading: boolean;
  loadingMore: boolean;
  initialError: string;
  loadMoreError: string;
}

export interface FetchPageOptions {
  bypassCache?: boolean;
}

export interface BrowsePaginationDeps<TCursor> {
  fetchPage: (
    after: TCursor | null,
    pageSize: number,
    options?: FetchPageOptions
  ) => Promise<PageResult<TCursor>>;
  pageSize: number;
  maxInitialAttempts?: number;
  retryDelayMs?: number;
  getInitialErrorMessage: () => string;
  getLoadMoreErrorMessage: () => string;
  onStateChange: (state: BrowsePaginationState<TCursor>) => void;
}

export interface BrowsePaginationController {
  loadInitial(options?: FetchPageOptions): Promise<void>;
  refresh(): Promise<void>;
  loadMore(): Promise<void>;
  dispose(): void;
}

/**
 * Appends incoming gigs while preventing duplicate cards by ID (e.g. when a
 * pagination retry or cursor overlap returns previously loaded documents).
 */
export function mergeUniqueGigs(existing: readonly Gig[], incoming: readonly Gig[]): Gig[] {
  const seen = new Set<string>(existing.map((g) => g.id));
  const merged = [...existing];
  for (const item of incoming) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item);
    }
  }
  return merged;
}

/**
 * Pagination lifecycle controller keeping initial-load errors strictly isolated
 * from Load More failures, preserving loaded cards and cursor on retry,
 * deduplicating overlapping pages, and guarding against duplicate in-flight requests.
 */
export function createBrowsePaginationController<TCursor>(
  deps: BrowsePaginationDeps<TCursor>
): BrowsePaginationController {
  const maxInitialAttempts = deps.maxInitialAttempts ?? 4;
  const retryDelayMs = deps.retryDelayMs ?? 3000;

  let mounted = true;
  let initialSeq = 0;
  let loadingMoreInFlight = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  let state: BrowsePaginationState<TCursor> = {
    gigs: [],
    lastDoc: null,
    loading: true,
    loadingMore: false,
    initialError: '',
    loadMoreError: ''
  };

  const emit = (patch: Partial<BrowsePaginationState<TCursor>>) => {
    if (!mounted) return;
    state = { ...state, ...patch };
    deps.onStateChange(state);
  };

  const clearRetryTimer = () => {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const loadInitial = async (options: FetchPageOptions = {}): Promise<void> => {
    if (!mounted) return;
    clearRetryTimer();
    const seq = ++initialSeq;
    loadingMoreInFlight = false;
    const preserveExisting = options.bypassCache === true && state.gigs.length > 0;
    emit({
      loading: !preserveExisting,
      loadingMore: false,
      initialError: '',
      loadMoreError: ''
    });

    const attemptLoad = async (attempt: number): Promise<void> => {
      if (!mounted || seq !== initialSeq) return;
      try {
        const res = await deps.fetchPage(null, deps.pageSize, options);
        if (!mounted || seq !== initialSeq) return;
        emit({
          gigs: mergeUniqueGigs([], res.gigs),
          lastDoc: res.lastDoc,
          loading: false,
          initialError: '',
          loadMoreError: ''
        });
      } catch {
        if (!mounted || seq !== initialSeq) return;
        if (!preserveExisting && attempt < maxInitialAttempts) {
          await new Promise<void>((resolve) => {
            retryTimer = setTimeout(() => {
              retryTimer = null;
              resolve();
            }, retryDelayMs);
          });
          await attemptLoad(attempt + 1);
        } else if (preserveExisting) {
          // Preserve already-loaded results if an explicit refresh fails
          emit({
            loading: false,
            loadMoreError: deps.getLoadMoreErrorMessage()
          });
        } else {
          emit({
            loading: false,
            initialError: deps.getInitialErrorMessage()
          });
        }
      }
    };

    await attemptLoad(1);
  };

  const refresh = async (): Promise<void> => {
    await loadInitial({ bypassCache: true });
  };

  const loadMore = async (): Promise<void> => {
    if (!mounted || loadingMoreInFlight || state.loading || !state.lastDoc) return;
    const seq = initialSeq;
    const cursor = state.lastDoc;
    loadingMoreInFlight = true;
    emit({ loadingMore: true, loadMoreError: '' });

    try {
      const res = await deps.fetchPage(cursor, deps.pageSize);
      if (!mounted || seq !== initialSeq) return;
      emit({
        gigs: mergeUniqueGigs(state.gigs, res.gigs),
        lastDoc: res.lastDoc,
        loadingMore: false,
        loadMoreError: ''
      });
    } catch {
      if (!mounted || seq !== initialSeq) return;
      // Preserve existing gigs and cursor verbatim so Retry resumes from cursor.
      emit({
        loadingMore: false,
        loadMoreError: deps.getLoadMoreErrorMessage()
      });
    } finally {
      if (seq === initialSeq) {
        loadingMoreInFlight = false;
      }
    }
  };

  const dispose = (): void => {
    mounted = false;
    initialSeq += 1;
    loadingMoreInFlight = false;
    clearRetryTimer();
  };

  return { loadInitial, refresh, loadMore, dispose };
}
