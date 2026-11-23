import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import { useLang } from '../lib/i18n';
import { BROWSE_PAGE_SIZE, CATEGORIES, NEIGHBORHOODS } from '../lib/constants';
import { getActiveGigsPage } from '../lib/db';
import { formatNeighborhood } from '../lib/format';
import { filterGigsByMode, type BrowseMode } from '../lib/listingType';
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
  const [cat, setCat] = useState('');
  const [neigh, setNeigh] = useState('');

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
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
          // Transient failures (e.g. a Firestore index still building) get a
          // few silent retries before we give up.
          attempts += 1;
          if (attempts < 6) {
            setTimeout(tryLoad, 4000);
          } else {
            setError(t('common.error'));
            setLoading(false);
          }
        });
    };
    tryLoad();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMore = async () => {
    if (!lastDoc || loadingMore) return;
    setLoadingMore(true);
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

  const modeGigs = filterGigsByMode(gigs, mode);
  const filtered = modeGigs.filter(
    (g) => (!cat || g.category === cat) && (!neigh || g.neighborhood === neigh)
  );

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
      <div className="results-count">
        {t('browse.results', { n: filtered.length })}
        {(cat || neigh) && (
          <button className="link-btn" onClick={() => { setCat(''); setNeigh(''); }}>
            {t('browse.filters.reset')}
          </button>
        )}
      </div>
      {(cat || neigh) && lastDoc && !loading && (
        <p className="muted small" role="status">
          {t('browse.filterPartial', { loaded: gigs.length })}
        </p>
      )}

      {loading ? (
        <p className="muted center">{t('common.loading')}</p>
      ) : error ? (
        <p className="muted center">{error}</p>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <Icon name="algeriaEmblem" size={34} />
          <p>{emptyText}</p>
          {modeGigs.length === 0 && (
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
