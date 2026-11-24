import { useEffect, useState } from 'react';
import { useLang } from '../lib/i18n';
import { getSavedIds, getGigsByIds } from '../lib/db';
import { filterPubliclyActiveGigs } from '../lib/expiration';
import type { Gig } from '../lib/types';
import { GigCard } from '../components/GigCard';
import { Icon } from '../components/Icon';

export function Saved() {
  const { t } = useLang();
  const [gigs, setGigs] = useState<Gig[] | null>(null);

  useEffect(() => {
    let active = true;
    getGigsByIds(getSavedIds())
      .then((list) => {
        if (active) setGigs(filterPubliclyActiveGigs(list));
      })
      .catch(() => {
        if (active) setGigs([]);
      });
    return () => {
      active = false;
    };
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
