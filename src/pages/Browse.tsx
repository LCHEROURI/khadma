import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import { useLang } from '../lib/i18n';
import { BROWSE_PAGE_SIZE, CATEGORIES, NEIGHBORHOODS } from '../lib/constants';
import { getActiveGigsPage } from '../lib/db';
import { formatNeighborhood } from '../lib/format';
import { filterGigsByMode, type BrowseMode } from '../lib/listingType';
import { countActiveFilters, filterListings } from '../lib/search';
import type { Gig } from '../lib/types';
import { Banner } from '../components/Banner';
import { GigCard } from '../components/GigCard';
import { Icon } from '../components/Icon';

export function Browse({ mode = 'all' }: { mode?: BrowseMode }) {
  const { t } = useLang();
  const [gigs, setGigs] = useState<Gig[]>([]);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [reloadTick, setReloadTick] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [cat, setCat] = useState('');
  const [neigh, setNeigh] = useState('');

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    setLoading(true);
    setError('');
    const tryLoad = () => {
      getActiveGigsPage(null, BROWSE_PAGE_SIZE)
        .then(({ gigs: items, lastDoc: nextLast }) => {
          if (cancelled) return;
          setGigs(items);
          setLastDoc(nextLast);
          setLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          attempts += 1;
          if (attempts < 4) {
            retryTimer = setTimeout(tryLoad, 3000);
          } else {
            setError(t('common.loadError'));
            setLoading(false);
          }
        });
    };
    tryLoad();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadTick]);

  const loadMore = async () => {
    if (!lastDoc || loadingMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const { gigs: items, lastDoc: nextLast } = await getActiveGigsPage(lastDoc, BROWSE_PAGE_SIZE);
      setGigs((g) => [...g, ...items]);
      setLastDoc(nextLast);
    } catch {
      setError(t('common.error'));
    } finally {
      setLoadingMore(false);
    }
  };

  const resetAllFilters = () => {
    setSearchQuery('');
    setCat('');
    setNeigh('');
  };

  const modeGigs = filterGigsByMode(gigs, mode);
  const filtered = filterListings(gigs, {
    mode,
    query: searchQuery,
    category: cat,
    neighborhood: neigh
  });
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

      <div className="results-count" role="status" aria-live="polite">
        {t('browse.results', { n: filtered.length })}
      </div>

      {activeFilterCount > 0 && lastDoc && !loading && (
        <p className="muted small" role="status">
          {t('browse.filterPartial', { loaded: gigs.length })}
        </p>
      )}

      {loading ? (
        <p className="muted center">{t('common.loading')}</p>
      ) : error ? (
        <div className="empty">
          <p>{error}</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setReloadTick((n) => n + 1)}
          >
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

      {lastDoc && !loading && (
        <div className="center load-more">
          <button className="btn btn-ghost" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? t('common.loading') : t('browse.loadMore')}
          </button>
        </div>
      )}
    </div>
  );
}
