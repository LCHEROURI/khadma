import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import { useLang } from '../lib/i18n';
import { BROWSE_PAGE_SIZE, CATEGORIES, NEIGHBORHOODS } from '../lib/constants';
import { getActiveGigsPage } from '../lib/db';
import { formatNeighborhood } from '../lib/format';
import { filterPubliclyActiveGigs } from '../lib/expiration';
import { filterGigsByMode, type BrowseMode } from '../lib/listingType';
import {
  createBrowsePaginationController,
  type BrowsePaginationController,
  type BrowsePaginationState
} from '../lib/browsePagination';
import { countActiveFilters, filterListings } from '../lib/search';
import { Banner } from '../components/Banner';
import { GigCard } from '../components/GigCard';
import { Icon } from '../components/Icon';

type Cursor = QueryDocumentSnapshot<DocumentData>;

const INITIAL_PAGINATION_STATE: BrowsePaginationState<Cursor> = {
  gigs: [],
  lastDoc: null,
  loading: true,
  loadingMore: false,
  initialError: '',
  loadMoreError: ''
};

export function Browse({ mode = 'all' }: { mode?: BrowseMode }) {
  const { t } = useLang();
  const [pageState, setPageState] = useState<BrowsePaginationState<Cursor>>(INITIAL_PAGINATION_STATE);
  const [searchQuery, setSearchQuery] = useState('');
  const [cat, setCat] = useState('');
  const [neigh, setNeigh] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);

  const initialErrRef = useRef(() => t('common.loadError'));
  initialErrRef.current = () => t('common.loadError');
  const loadMoreErrRef = useRef(() => t('browse.loadMoreError'));
  loadMoreErrRef.current = () => t('browse.loadMoreError');

  const controllerRef = useRef<BrowsePaginationController | null>(null);

  useEffect(() => {
    // Periodically re-evaluate listing expiration while the browser tab stays open
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = createBrowsePaginationController<Cursor>({
      fetchPage: (after, pageSize, options) =>
        getActiveGigsPage(after, pageSize, {
          bypassCache: options?.bypassCache,
          mode
        }),
      pageSize: BROWSE_PAGE_SIZE,
      getInitialErrorMessage: () => initialErrRef.current(),
      getLoadMoreErrorMessage: () => loadMoreErrRef.current(),
      onStateChange: setPageState
    });
    controllerRef.current = controller;
    void controller.loadInitial();
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, [mode]);

  const retryInitial = () => {
    void controllerRef.current?.loadInitial({ bypassCache: true });
  };

  const handleRefresh = async () => {
    if (refreshing || !controllerRef.current) return;
    setRefreshing(true);
    setNowMs(Date.now());
    try {
      await controllerRef.current.refresh();
    } finally {
      setRefreshing(false);
    }
  };

  const loadMore = () => {
    void controllerRef.current?.loadMore();
  };

  const resetAllFilters = () => {
    setSearchQuery('');
    setCat('');
    setNeigh('');
  };

  const { gigs, lastDoc, loading, loadingMore, initialError, loadMoreError } = pageState;
  const activeGigs = filterPubliclyActiveGigs(gigs, nowMs);
  const modeGigs = filterGigsByMode(activeGigs, mode);
  const filtered = filterListings(
    activeGigs,
    {
      mode,
      query: searchQuery,
      category: cat,
      neighborhood: neigh
    },
    nowMs
  );
  const activeFilterCount = countActiveFilters({
    query: searchQuery,
    category: cat,
    neighborhood: neigh
  });

  const pageTitle =
    mode === 'job'
      ? t('browse.jobsTitle')
      : mode === 'service'
        ? t('browse.servicesTitle')
        : t('browse.allTitle');
  const pageSubtitle =
    mode === 'job'
      ? t('browse.jobsSubtitle')
      : mode === 'service'
        ? t('browse.servicesSubtitle')
        : t('browse.allSubtitle');
  const emptyText =
    modeGigs.length === 0
      ? mode === 'job'
        ? t('browse.jobsEmpty')
        : mode === 'service'
          ? t('browse.servicesEmpty')
          : t('browse.emptyNoGigs')
      : t('browse.empty');
  const postPath = mode === 'service' ? '/services/post' : '/employer/post';
  const postCtaLabel = mode === 'service' ? t('home.servicesPost') : t('home.employerCta');

  return (
    <div className="page">
      <Banner />
      <h1 className="page-title">{pageTitle}</h1>
      <p className="page-subtitle">{pageSubtitle}</p>

      <div className="search-box" role="search">
        <label htmlFor="browse-search-input" className="sr-only">
          {t('browse.searchLabel')}
        </label>
        <Icon name="search" size={18} className="search-icon" />
        <input
          id="browse-search-input"
          type="search"
          className="search-input"
          value={searchQuery}
          placeholder={t('browse.searchPlaceholder')}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery.length > 0 && (
          <button
            type="button"
            className="search-clear"
            aria-label={t('browse.searchClear')}
            onClick={() => setSearchQuery('')}
          >
            ×
          </button>
        )}
      </div>

      <div className="filters">
        <label className="filter">
          <span>{t('browse.filters.categoryLabel')}</span>
          <select value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">{t('browse.filters.categoryAll')}</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`categories.${c}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="filter">
          <span>{t('browse.filters.neighborhoodLabel')}</span>
          <select value={neigh} onChange={(e) => setNeigh(e.target.value)}>
            <option value="">{t('browse.filters.neighborhoodAll')}</option>
            {NEIGHBORHOODS.map((n) => (
              <option key={n} value={n}>
                {formatNeighborhood(n, t)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {activeFilterCount > 0 && (
        <div className="active-filters" aria-live="polite">
          <span className="active-filters-badge">
            {t('browse.filters.activeCount', { n: activeFilterCount })}
          </span>
          {searchQuery.trim() && (
            <button
              type="button"
              className="filter-pill"
              aria-label={t('browse.filters.removeAria', { label: searchQuery.trim() })}
              onClick={() => setSearchQuery('')}
            >
              <span>“{searchQuery.trim()}”</span>
              <span aria-hidden="true">×</span>
            </button>
          )}
          {cat && (
            <button
              type="button"
              className="filter-pill"
              aria-label={t('browse.filters.removeAria', { label: t(`categories.${cat}`) })}
              onClick={() => setCat('')}
            >
              <span>{t(`categories.${cat}`)}</span>
              <span aria-hidden="true">×</span>
            </button>
          )}
          {neigh && (
            <button
              type="button"
              className="filter-pill"
              aria-label={t('browse.filters.removeAria', { label: formatNeighborhood(neigh, t) })}
              onClick={() => setNeigh('')}
            >
              <span>{formatNeighborhood(neigh, t)}</span>
              <span aria-hidden="true">×</span>
            </button>
          )}
          <button type="button" className="link-btn" onClick={resetAllFilters}>
            {t('browse.filters.reset')}
          </button>
        </div>
      )}

      <div className="results-bar">
        <div className="results-count" role="status" aria-live="polite">
          {t('browse.results', { n: filtered.length })}
        </div>
        <button
          type="button"
          className="link-btn"
          disabled={loading || refreshing}
          onClick={() => void handleRefresh()}
        >
          {refreshing ? t('common.loading') : t('browse.refresh')}
        </button>
      </div>

      {activeFilterCount > 0 && lastDoc && !loading && (
        <p className="muted small" role="status">
          {t('browse.filterPartial', { loaded: gigs.length })}
        </p>
      )}

      {loading ? (
        <p className="muted center">{t('common.loading')}</p>
      ) : initialError ? (
        <div className="empty" role="alert">
          <p>{initialError}</p>
          <button type="button" className="btn btn-primary" onClick={retryInitial}>
            {t('common.retry')}
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <Icon name="algeriaEmblem" size={34} />
          <p>{emptyText}</p>
          {activeFilterCount > 0 && modeGigs.length > 0 ? (
            <button type="button" className="btn btn-soft-green" onClick={resetAllFilters}>
              {t('browse.filters.reset')}
            </button>
          ) : (
            modeGigs.length === 0 && (
              <div className="empty-actions">
                <Link to={postPath} className="btn btn-primary">
                  {postCtaLabel}
                </Link>
                {mode !== 'all' && (
                  <Link to="/listings" className="btn btn-soft-green">
                    {t('browse.viewAllLink')}
                  </Link>
                )}
              </div>
            )
          )}
        </div>
      ) : (
        <div className="card-list">
          {filtered.map((g) => (
            <GigCard key={g.id} gig={g} />
          ))}
        </div>
      )}

      {lastDoc && !loading && !initialError && (
        <div className="center load-more">
          {loadMoreError ? (
            <div className="load-more-error" role="alert">
              <p className="form-error">{loadMoreError}</p>
              <button
                type="button"
                className="btn btn-soft-green"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? t('common.loading') : t('browse.loadMoreRetry')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={loadMore}
              disabled={loadingMore}
            >
              {loadingMore ? t('common.loading') : t('browse.loadMore')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
