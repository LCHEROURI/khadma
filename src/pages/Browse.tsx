import { useEffect, useState } from 'react';
import { getDocs, collection, query, where, orderBy, limit, startAfter, type QueryDocumentSnapshot, type DocumentData } from 'firebase/firestore';
import { db } from '../firebase';
import { useLang } from '../lib/i18n';
import { CATEGORIES, NEIGHBORHOODS } from '../lib/constants';
import type { Gig } from '../lib/types';
import { Banner } from '../components/Banner';
import { GigCard } from '../components/GigCard';

const PAGE = 50;

export function Browse() {
  const { t } = useLang();
  const [gigs, setGigs] = useState<Gig[]>([]);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [cat, setCat] = useState('');
  const [neigh, setNeigh] = useState('');

  const load = async (after: QueryDocumentSnapshot<DocumentData> | null) => {
    const q = after
      ? query(
          collection(db, 'gigs'),
          where('status', '==', 'active'),
          orderBy('createdAt', 'desc'),
          startAfter(after),
          limit(PAGE)
        )
      : query(
          collection(db, 'gigs'),
          where('status', '==', 'active'),
          orderBy('createdAt', 'desc'),
          limit(PAGE)
        );
    const snap = await getDocs(q);
    return snap;
  };

  useEffect(() => {
    setLoading(true);
    setError('');
    load(null)
      .then((snap) => {
        const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Gig);
        setGigs(items);
        setLastDoc(snap.docs.length ? snap.docs[snap.docs.length - 1] : null);
      })
      .catch(() => setError(t('common.error')))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMore = async () => {
    if (!lastDoc || loadingMore) return;
    setLoadingMore(true);
    try {
      const snap = await load(lastDoc);
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Gig);
      setGigs((g) => [...g, ...items]);
      setLastDoc(snap.docs.length ? snap.docs[snap.docs.length - 1] : null);
    } catch {
      setError(t('common.error'));
    } finally {
      setLoadingMore(false);
    }
  };

  const filtered = gigs.filter(
    (g) => (!cat || g.category === cat) && (!neigh || g.neighborhood === neigh)
  );

  return (
    <div className="page">
      <Banner />
      <h1 className="page-title">{t('browse.title')}</h1>
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
                {n}
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

      {loading ? (
        <p className="muted center">{t('common.loading')}</p>
      ) : error ? (
        <p className="muted center">{error}</p>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <p>{gigs.length === 0 ? t('browse.emptyNoGigs') : t('browse.empty')}</p>
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
