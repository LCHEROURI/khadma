import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { auth } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { useLang } from '../lib/i18n';
import { MAX_ACTIVE_GIGS } from '../lib/constants';
import {
  callManageEmployerListing,
  getEmployerProfile,
  getMyGigs,
  getRemainingForPhone
} from '../lib/db';
import {
  isValidEmail,
  linkEmailToLegacyPhoneAccount,
  mapAuthErrorKey,
  resolveEmployerEligibility,
  signOutEmployer,
  validatePassword
} from '../lib/employerAuth';
import { formatNeighborhood, formatPay, timeAgo } from '../lib/format';
import {
  canRepublishGig,
  filterOwnedListings,
  isEligibleForRenewal,
  summarizeOwnedListings,
  type OwnedStatusFilter
} from '../lib/listingManagement';
import type { EmployerProfile, Gig } from '../lib/types';
import { Banner } from '../components/Banner';
import { EmployerAuthPanel } from '../components/EmployerAuthPanel';
import { Icon } from '../components/Icon';

export function Employer() {
  const { t, lang } = useLang();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    user,
    email,
    emailVerified,
    phoneNumber,
    isAnonymous,
    isEmployer,
    loading: authLoading,
    refreshAuth
  } = useAuth();
  const [gigs, setGigs] = useState<Gig[] | null>(null);
  const [profile, setProfile] = useState<EmployerProfile | null>(null);
  const [legacyRemaining, setLegacyRemaining] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<OwnedStatusFilter>('all');
  const [reloadTick, setReloadTick] = useState(0);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [err, setErr] = useState('');

  // In-app legacy phone -> email linking state
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkEmail, setLinkEmail] = useState('');
  const [linkPassword, setLinkPassword] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkErr, setLinkErr] = useState('');
  const [linkSuccess, setLinkSuccess] = useState(false);

  const eligibility = resolveEmployerEligibility(
    {
      uid: user?.uid ?? null,
      email,
      emailVerified,
      phoneNumber,
      isAnonymous
    },
    profile
  );

  useEffect(() => {
    if (searchParams.get('verified') !== '1' || !user) return;
    void refreshAuth().finally(() => {
      const next = new URLSearchParams(searchParams);
      next.delete('verified');
      setSearchParams(next, { replace: true });
    });
  }, [searchParams, setSearchParams, user, refreshAuth]);

  useEffect(() => {
    if (!user || !isEmployer) {
      setGigs(null);
      setProfile(null);
      setLegacyRemaining(null);
      setErr('');
      return;
    }
    let cancelled = false;
    setErr('');
    const tasks: [
      Promise<Gig[]>,
      Promise<EmployerProfile | null>,
      Promise<number | null>
    ] = [
      getMyGigs(user.uid),
      getEmployerProfile(user.uid).catch(() => null),
      phoneNumber ? getRemainingForPhone(phoneNumber).catch(() => null) : Promise.resolve(null)
    ];

    Promise.all(tasks)
      .then(([items, prof, rem]) => {
        if (cancelled) return;
        setGigs(items);
        setProfile(prof);
        setLegacyRemaining(rem);
      })
      .catch(() => {
        if (cancelled) return;
        setErr(t('common.error'));
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, isEmployer, phoneNumber, reloadTick]);

  const summary = summarizeOwnedListings(gigs ?? []);
  const visibleGigs = gigs ? filterOwnedListings(gigs, statusFilter) : null;

  const activeUsed =
    typeof profile?.activeCount === 'number'
      ? profile.activeCount
      : phoneNumber && legacyRemaining !== null
        ? Math.max(0, MAX_ACTIVE_GIGS - legacyRemaining)
        : summary.active + summary.pending;

  const statusTabs: { id: OwnedStatusFilter; label: string; count: number }[] = [
    { id: 'all', label: t('employer.statusAll'), count: summary.total },
    { id: 'active', label: t('employer.statusActive'), count: summary.active },
    { id: 'pending', label: t('employer.statusPending'), count: summary.pending },
    { id: 'expired', label: t('employer.statusExpired'), count: summary.expired },
    { id: 'archived', label: t('employer.statusArchived'), count: summary.archived },
    { id: 'hidden', label: t('employer.statusHidden'), count: summary.hidden },
    { id: 'removed', label: t('employer.statusRemoved'), count: summary.removed }
  ];

  const runListingAction = async (
    gigId: string,
    action: 'archive' | 'renew' | 'republish'
  ) => {
    if (actionBusyId) return;
    setActionBusyId(gigId);
    setErr('');
    try {
      await callManageEmployerListing({ action, gigId });
      setReloadTick((n) => n + 1);
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      if (code === 'functions/resource-exhausted') setErr(t('post.rateLimit'));
      else setErr(t('common.error'));
    } finally {
      setActionBusyId(null);
    }
  };

  const handleLinkEmail = async () => {
    if (!user) return;
    setLinkErr('');
    setLinkSuccess(false);
    if (!isValidEmail(linkEmail)) {
      setLinkErr(t('auth.invalidEmail'));
      return;
    }
    if (validatePassword(linkPassword) !== 'ok') {
      setLinkErr(t('auth.weakPassword'));
      return;
    }
    setLinkBusy(true);
    try {
      await linkEmailToLegacyPhoneAccount(user, linkEmail, linkPassword, auth, lang);
      setLinkPassword('');
      setLinkSuccess(true);
      await refreshAuth();
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      setLinkErr(t(mapAuthErrorKey(code)));
    } finally {
      setLinkBusy(false);
    }
  };

  const handleSignOut = async () => {
    await signOutEmployer(auth);
  };

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
          {isEmployer && (
            <div className="employer-head-actions">
              <button
                type="button"
                className="btn btn-ghost btn-icon-only"
                aria-label={t('common.refresh')}
                onClick={() => setReloadTick((n) => n + 1)}
              >
                <Icon name="refresh" size={16} />
              </button>
              <button type="button" className="btn btn-ghost btn-small" onClick={handleSignOut}>
                {t('employer.signOut')}
              </button>
            </div>
          )}
        </div>

        {authLoading ? (
          <p className="muted center">{t('common.loading')}</p>
        ) : !isEmployer ? (
          <div className="employer-auth-wrap">
            <p className="muted">{t('employer.notVerified')}</p>
            <EmployerAuthPanel />
          </div>
        ) : (
          <>
            <div className="verified-banner">
              <span>✓</span>
              {email && emailVerified ? (
                <span dir="ltr">{t('employer.emailVerifiedBadge', { email })}</span>
              ) : phoneNumber ? (
                <span dir="ltr">
                  {t('employer.legacyBadge')} ({phoneNumber})
                </span>
              ) : null}
            </div>

            {eligibility.isSuspended && (
              <div className="load-more-error" role="alert">
                <p className="form-error">{t('employer.suspendedNotice')}</p>
              </div>
            )}

            <p className="remaining">
              {t('employer.quotaSummary', { used: activeUsed, max: eligibility.quotaMax })}
            </p>

            {eligibility.needsEmailLink && (
              <div className="panel legacy-link-card">
                <h3>{t('employer.legacyLinkTitle')}</h3>
                <p className="muted small">{t('employer.legacyLinkText')}</p>
                {linkSuccess && (
                  <p className="status-note sample-note" role="status">
                    {t('employer.legacyLinkSuccess')}
                  </p>
                )}
                {!linkOpen ? (
                  <button
                    type="button"
                    className="btn btn-soft-green"
                    onClick={() => setLinkOpen(true)}
                  >
                    {t('employer.legacyLinkCta')}
                  </button>
                ) : (
                  <form
                    noValidate
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!linkBusy) void handleLinkEmail();
                    }}
                  >
                    <label className="field">
                      <span>{t('auth.emailLabel')}</span>
                      <input
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        dir="ltr"
                        placeholder={t('auth.emailPlaceholder')}
                        value={linkEmail}
                        onChange={(e) => setLinkEmail(e.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span>{t('auth.passwordLabel')}</span>
                      <input
                        type="password"
                        autoComplete="new-password"
                        placeholder={t('auth.passwordPlaceholder')}
                        value={linkPassword}
                        onChange={(e) => setLinkPassword(e.target.value)}
                      />
                    </label>
                    {linkErr && (
                      <p className="form-error" role="alert">
                        {linkErr}
                      </p>
                    )}
                    <button
                      type="submit"
                      className="btn btn-primary btn-block"
                      disabled={linkBusy}
                    >
                      {linkBusy ? t('common.loading') : t('employer.legacyLinkCta')}
                    </button>
                  </form>
                )}
              </div>
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

            {err && (
              <p className="form-error" role="alert">
                {err}
              </p>
            )}

            {visibleGigs === null ? (
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
              <div className="card-list">
                {visibleGigs.map((g) => {
                  const canEdit = g.status === 'active' || g.status === 'pending';
                  const canArchive = g.status === 'active' || g.status === 'pending';
                  const canRenew = isEligibleForRenewal(g);
                  const canRepublish = canRepublishGig(g);
                  const isModeratedLocked = g.status === 'hidden' || g.status === 'removed';
                  const rowBusy = actionBusyId === g.id;

                  return (
                    <div key={g.id} className="card employer-card">
                      <Link to={`/gig/${g.id}`} className="employer-card-link">
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

                      {!eligibility.isSuspended && (
                        <div className="employer-card-actions">
                          {canEdit && (
                            <Link to={`/employer/edit/${g.id}`} className="btn btn-ghost btn-small">
                              {t('employer.actionEdit')}
                            </Link>
                          )}
                          {canRenew && (
                            <button
                              type="button"
                              className="btn btn-soft-green btn-small"
                              disabled={rowBusy}
                              onClick={() => void runListingAction(g.id, 'renew')}
                            >
                              {t('employer.actionRenew')}
                            </button>
                          )}
                          {canArchive && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-small"
                              disabled={rowBusy}
                              onClick={() => void runListingAction(g.id, 'archive')}
                            >
                              {t('employer.actionArchive')}
                            </button>
                          )}
                          {canRepublish && (
                            <button
                              type="button"
                              className="btn btn-primary btn-small"
                              disabled={rowBusy}
                              onClick={() => void runListingAction(g.id, 'republish')}
                            >
                              {t('employer.actionRepublish')}
                            </button>
                          )}
                          {isModeratedLocked && (
                            <span className="muted small">
                              {g.moderationReason || t('employer.moderatedLockedHint')}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
