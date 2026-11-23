import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useLang } from '../lib/i18n';
import { MAX_ACTIVE_GIGS } from '../lib/constants';
import { getMyGigs, getRemainingForPhone } from '../lib/db';
import { formatNeighborhood, formatPay } from '../lib/format';
import type { Gig } from '../lib/types';
import { Banner } from '../components/Banner';
import { Icon } from '../components/Icon';

export function Employer() {
  const { t } = useLang();
  const { user, phoneNumber, loading: authLoading } = useAuth();
  const [gigs, setGigs] = useState<Gig[] | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!user || !phoneNumber) {
      setGigs(null);
      setRemaining(null);
      return;
    }
    let cancelled = false;
    setErr('');
    Promise.all([getMyGigs(user.uid), getRemainingForPhone(phoneNumber)])
      .then(([items, rem]) => {
        if (cancelled) return;
        setGigs(items);
        setRemaining(rem);
      })
      .catch(() => {
        if (cancelled) return;
        setErr(t('common.error'));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, phoneNumber]);

  return (
    <div className="page">
      <Banner />
      <h1 className="page-title">{t('employer.title')}</h1>
      <p className="page-subtitle">{t('employer.subtitle')}</p>

      <div className="panel employer-cta-panel">
        <Link to="/employer/post" className="btn btn-primary btn-block">
          <Icon name="plus" size={18} />
          {t('home.employerCta')}
        </Link>
        <Link to="/services/post" className="btn btn-soft-green btn-block">
          <Icon name="wrench" size={17} />
          {t('employer.offerService')}
        </Link>
      </div>

      <section className="employer-section" aria-labelledby="employer-listings-heading">
        <h2 id="employer-listings-heading" className="section-heading">
          {t('employer.myListingsTitle')}
        </h2>

        {authLoading ? (
          <p className="muted center">{t('common.loading')}</p>
        ) : !phoneNumber ? (
          <div className="empty">
            <Icon name="algeriaEmblem" size={32} />
            <p>{t('employer.notVerified')}</p>
          </div>
        ) : (
          <>
            <div className="verified-banner">
              <span>✓</span>
              <span dir="ltr">{phoneNumber}</span>
            </div>
            {remaining !== null && (
              <p className="remaining">{t('post.remaining', { n: MAX_ACTIVE_GIGS - remaining })}</p>
            )}
            {err ? (
              <p className="form-error">{err}</p>
            ) : gigs === null ? (
              <p className="muted center">{t('common.loading')}</p>
            ) : gigs.length === 0 ? (
              <div className="empty">
                <Icon name="algeriaEmblem" size={32} />
                <p>{t('employer.empty')}</p>
              </div>
            ) : (
              <div className="card-list">
                {gigs.map((g) => (
                  <Link key={g.id} to={`/gig/${g.id}`} className="card">
                    <div className="card-chips">
                      <span className={`chip chip-type-${g.listingType ?? 'legacy'}`}>
                        {t(`listingType.${g.listingType ?? 'legacy'}`)}
                      </span>
                      <span className="chip">{t(`categories.${g.category}`)}</span>
                      <span className="chip chip-neigh">{formatNeighborhood(g.neighborhood, t)}</span>
                      <span className="status-chip">{t(`admin.status.${g.status}`)}</span>
                    </div>
                    <h3 className="card-title">{g.title}</h3>
                    <div className="card-pay">{formatPay(g.payMin, g.payMax, t('common.currency'))}</div>
                  </Link>
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
