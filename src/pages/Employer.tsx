import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useLang } from '../lib/i18n';
import { MAX_ACTIVE_GIGS } from '../lib/constants';
import { getMyGigs, getRemainingForPhone } from '../lib/db';
import { formatNeighborhood, formatPay, timeAgo } from '../lib/format';
import {
  filterOwnedListings,
  summarizeOwnedListings,
  type OwnedStatusFilter
} from '../lib/listingManagement';
import type { Gig } from '../lib/types';
import { Banner } from '../components/Banner';
import { Icon } from '../components/Icon';

export function Employer() {
  const { t } = useLang();
  const { user, phoneNumber, loading: authLoading } = useAuth();
  const [gigs, setGigs] = useState<Gig[] | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<OwnedStatusFilter>('all');
  const [reloadTick, setReloadTick] = useState(0);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!user || !phoneNumber) {
      setGigs(null);
      setRemaining(null);
      setErr('');
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
  }, [user?.uid, phoneNumber, reloadTick]);

  const summary = summarizeOwnedListings(gigs ?? []);
  const visibleGigs = gigs ? filterOwnedListings(gigs, statusFilter) : null;

  const statusTabs: { id: OwnedStatusFilter; label: string; count: number }[] = [
    { id: 'all', label: t('employer.statusAll'), count: summary.total },
    { id: 'active', label: t('employer.statusActive'), count: summary.active },
    { id: 'hidden', label: t('employer.statusHidden'), count: summary.hidden },
    { id: 'removed', label: t('employer.statusRemoved'), count: summary.removed }
  ];

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
        <div className="employer-head-row">
          <h2 id="employer-listings-heading" className="section-heading">
            {t('employer.myListingsTitle')}
          </h2>
          {phoneNumber && (
            <button
              type="button"
              className="btn btn-ghost btn-icon-only"
              aria-label={t('common.refresh')}
              onClick={() => setReloadTick((n) => n + 1)}
            >
              <Icon name="refresh" size={16} />
            </button>
          )}
        </div>

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

            {gigs && gigs.length > 0 && (
              <div className="status-tabs" role="tablist" aria-label={t('employer.myListingsTitle')}>
                {statusTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={statusFilter === tab.id}
                    className={`status-tab${statusFilter === tab.id ? ' active' : ''}`}
                    onClick={() => setStatusFilter(tab.id)}
                  >
                    {tab.label} ({tab.count})
                  </button>
                ))}
              </div>
            )}

            {err ? (
              <div className="empty">
                <p className="form-error">{err}</p>
                <button
                  type="button"
                  className="btn btn-soft-green"
                  onClick={() => setReloadTick((n) => n + 1)}
                >
                  {t('common.retry')}
                </button>
              </div>
            ) : visibleGigs === null ? (
              <p className="muted center">{t('common.loading')}</p>
            ) : gigs && gigs.length === 0 ? (
              <div className="empty">
                <Icon name="algeriaEmblem" size={32} />
                <p>{t('employer.empty')}</p>
              </div>
            ) : visibleGigs.length === 0 ? (
              <div className="empty">
                <p>{t('employer.emptyForStatus')}</p>
                <button
                  type="button"
                  className="btn btn-soft-green"
                  onClick={() => setStatusFilter('all')}
                >
                  {t('employer.statusAll')}
                </button>
              </div>
            ) : (
              <>
                <div className="card-list">
                  {visibleGigs.map((g) => (
                    <Link key={g.id} to={`/gig/${g.id}`} className="card">
                      <div className="card-chips">
                        <span className={`chip chip-type-${g.listingType ?? 'legacy'}`}>
                          {t(`listingType.${g.listingType ?? 'legacy'}`)}
                        </span>
                        <span className="chip">{t(`categories.${g.category}`)}</span>
                        <span className="chip chip-neigh">{formatNeighborhood(g.neighborhood, t)}</span>
                        <span className={`status-chip status-badge-${g.status}`}>
                          {t(`admin.status.${g.status}`)}
                        </span>
                        {g.flags > 0 && (
                          <span className="flag-chip">🚩 {t('admin.flags', { n: g.flags })}</span>
                        )}
                      </div>
                      <h3 className="card-title">{g.title}</h3>
                      <div className="card-pay">{formatPay(g.payMin, g.payMax, t('common.currency'))}</div>
                      <div className="card-meta">
                        <span className="meta-item">{timeAgo(g, t)}</span>
                      </div>
                    </Link>
                  ))}
                </div>
                <p className="muted small employer-note">{t('employer.moderationNote')}</p>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
