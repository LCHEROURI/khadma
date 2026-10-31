import { useEffect, useState } from 'react';
import { useLang } from '../lib/i18n';
import { getSavedIds, getGigsByIds } from '../lib/db';
import type { Gig } from '../lib/types';
import { GigCard } from '../components/GigCard';
import { Icon } from '../components/Icon';

export function Saved() {
  const { t } = useLang();
  const [gigs, setGigs] = useState<Gig[] | null>(null);

  const load = () => {
    getGigsByIds(getSavedIds()).then((list) => setGigs(list));
  };

  useEffect(() => {
    load();
    const h = () => load();
    window.addEventListener('focus', h);
    return () => window.removeEventListener('focus', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="page">
      <h1 className="page-title">{t('saved.title')}</h1>
      {gigs === null ? (
        <p className="muted center">{t('common.loading')}</p>
      ) : gigs.length === 0 ? (
        <div className="empty">
          <Icon name="bookmark" size={40} />
          <p>{t('saved.empty')}</p>
        </div>
      ) : (
        <div className="card-list">
          {gigs.map((g) => (
            <GigCard key={g.id} gig={g} />
          ))}
        </div>
      )}
    </div>
  );
}
