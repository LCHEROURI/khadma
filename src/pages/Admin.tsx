import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { sendEmailVerification, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore';
import { app, auth } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { useLang } from '../lib/i18n';
import { ADMIN_EMAIL } from '../lib/constants';
import { createAdminQueueController, type AdminQueueController } from '../lib/adminQueue';
import {
  callAdminManageMarketplace,
  getAdminAuditLogs,
  getAdminEmployers,
  getAdminPendingGigs,
  getAdminQueue,
  getAdminReportsPage,
  getMarketplaceModerationSettings,
  hasSamples,
  removeAllSamples,
  seedSamples
} from '../lib/db';
import { formatNeighborhood, formatPay } from '../lib/format';
import type {
  AdminReportItem,
  AuditLogEntry,
  EmployerProfile,
  Gig,
  MarketplaceModerationSettings
} from '../lib/types';
import { Icon } from '../components/Icon';

const ACTIVE_PROJECT_ID = app.options.projectId || 'khadma-oran';

const MONITORING_CONSOLE_LINKS = [
  {
    key: 'admin.monitoring.authUsage',
    url: `https://console.firebase.google.com/project/${ACTIVE_PROJECT_ID}/authentication/usage`
  },
  {
    key: 'admin.monitoring.firestoreUsage',
    url: `https://console.firebase.google.com/project/${ACTIVE_PROJECT_ID}/firestore/usage`
  },
  {
    key: 'admin.monitoring.functionsMonitoring',
    url: `https://console.cloud.google.com/functions/list?project=${ACTIVE_PROJECT_ID}`
  },
  {
    key: 'admin.monitoring.cloudBilling',
    url: `https://console.cloud.google.com/billing?project=${ACTIVE_PROJECT_ID}`
  },
  {
    key: 'admin.monitoring.billingBudgets',
    url: `https://console.cloud.google.com/billing/budgets?project=${ACTIVE_PROJECT_ID}`
  },
  {
    key: 'admin.monitoring.schedulerHistory',
    url: `https://console.cloud.google.com/cloudscheduler?project=${ACTIVE_PROJECT_ID}`
  },
  {
    key: 'admin.monitoring.appCheckMetrics',
    url: `https://console.firebase.google.com/project/${ACTIVE_PROJECT_ID}/appcheck/metrics`
  }
] as const;

type AdminTab = 'pending' | 'flagged' | 'reports' | 'latest' | 'employers' | 'audit' | 'monitoring';

export function Admin() {
  const { t, lang } = useLang();
  const { user, loading: authLoading, isAdmin } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authErr, setAuthErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<AdminTab>('pending');
  const [latest, setLatest] = useState<Gig[] | null>(null);
  const [flagged, setFlagged] = useState<Gig[] | null>(null);
  const [pending, setPending] = useState<Gig[] | null>(null);
  const [reports, setReports] = useState<AdminReportItem[] | null>(null);
  const [reportsCursor, setReportsCursor] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [reportsHasMore, setReportsHasMore] = useState(false);
  const [reportsLoadingMore, setReportsLoadingMore] = useState(false);
  const [employers, setEmployers] = useState<EmployerProfile[] | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[] | null>(null);
  const [modSettings, setModSettings] = useState<MarketplaceModerationSettings | null>(null);
  const [samples, setSamples] = useState(false);
  const [notice, setNotice] = useState('');
  const [verifySent, setVerifySent] = useState(false);

  const errorMessageRef = useRef(() => t('common.error'));
  errorMessageRef.current = () => t('common.error');

  const controllerRef = useRef<AdminQueueController | null>(null);

  const loadPhase4AdminData = async () => {
    const [pGigs, repPage, emps, logs, settings] = await Promise.all([
      getAdminPendingGigs().catch(() => []),
      getAdminReportsPage(null).catch(() => ({ items: [], lastDoc: null, hasMore: false })),
      getAdminEmployers().catch(() => []),
      getAdminAuditLogs().catch(() => []),
      getMarketplaceModerationSettings().catch(() => null)
    ]);
    setPending(pGigs);
    setReports(repPage.items);
    setReportsCursor(repPage.lastDoc);
    setReportsHasMore(repPage.hasMore);
    setEmployers(emps);
    setAuditLogs(logs);
    setModSettings(settings);
  };

  const loadMoreReports = async () => {
    if (reportsLoadingMore || !reportsHasMore || !reportsCursor) return;
    setReportsLoadingMore(true);
    try {
      const nextPage = await getAdminReportsPage(reportsCursor);
      setReports((prev) => [...(prev ?? []), ...nextPage.items]);
      setReportsCursor(nextPage.lastDoc);
      setReportsHasMore(nextPage.hasMore);
    } catch {
      setNotice(t('common.error'));
    } finally {
      setReportsLoadingMore(false);
    }
  };

  const formatReportDate = (ts: { seconds: number } | null): string => {
    if (!ts || !ts.seconds) return '';
    try {
      return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-DZ' : 'fr-FR', {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(new Date(ts.seconds * 1000));
    } catch {
      return new Date(ts.seconds * 1000).toISOString().slice(0, 16).replace('T', ' ');
    }
  };

  useEffect(() => {
    const controller = createAdminQueueController({
      fetchQueue: getAdminQueue,
      fetchHasSamples: hasSamples,
      onLatest: setLatest,
      onFlagged: setFlagged,
      onSamples: setSamples,
      onNotice: setNotice,
      onBusy: setBusy,
      getErrorMessage: () => errorMessageRef.current()
    });
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  const refresh = () => {
    void controllerRef.current?.refresh();
    void loadPhase4AdminData();
  };

  useEffect(() => {
    if (isAdmin) {
      void controllerRef.current?.refresh();
      void loadPhase4AdminData();
    } else {
      controllerRef.current?.invalidate();
    }
  }, [isAdmin]);

  const login = async () => {
    setBusy(true);
    setAuthErr('');
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      setPassword('');
    } catch {
      setAuthErr(t('admin.loginError'));
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    controllerRef.current?.invalidate();
    await signOut(auth);
  };

  if (authLoading) {
    return (
      <div className="page">
        <p className="muted center">{t('common.loading')}</p>
      </div>
    );
  }

  if (!user || user.isAnonymous) {
    return (
      <div className="page">
        <h1 className="page-title">{t('admin.title')}</h1>
        <form
          className="detail-card"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && email && password) void login();
          }}
        >
          <h2 className="sheet-title">{t('admin.loginTitle')}</h2>
          <label className="field">
            <span>{t('admin.emailLabel')}</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </label>
          <label className="field">
            <span>{t('admin.passwordLabel')}</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          {authErr && <p className="form-error">{authErr}</p>}
          <button type="submit" className="btn btn-primary wide" disabled={busy || !email || !password}>
            {busy ? t('common.loading') : t('admin.login')}
          </button>
        </form>
      </div>
    );
  }

  if (!isAdmin) {
    const needsEmailVerify = user.email === ADMIN_EMAIL && !user.emailVerified;
    return (
      <div className="page">
        <h1 className="page-title">{t('admin.title')}</h1>
        {needsEmailVerify ? (
          <div className="detail-card">
            <h2 className="sheet-title">{t('admin.verifyTitle')}</h2>
            <p className="muted">{t('admin.verifyText')}</p>
            <p className="muted">{user.email}</p>
            {verifySent && <p className="status-note sample-note">{t('admin.verifySent')}</p>}
            {notice && <p className="form-error">{notice}</p>}
            <div className="detail-actions">
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setNotice('');
                  try {
                    await sendEmailVerification(user);
                    setVerifySent(true);
                  } catch {
                    setNotice(t('common.error'));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t('admin.sendVerify')}
              </button>
              <button
                className="btn btn-ghost"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await user.reload();
                    await user.getIdToken(true);
                    window.location.reload();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t('admin.verifyRefresh')}
              </button>
            </div>
            <div className="center" style={{ marginTop: 12 }}>
              <button className="btn btn-ghost" onClick={logout}>
                {t('admin.signout')}
              </button>
            </div>
          </div>
        ) : (
          <div className="empty">
            <p>{t('admin.notAdmin')}</p>
            <p className="muted">{user.email}</p>
            <button className="btn btn-ghost" onClick={logout}>
              {t('admin.signout')}
            </button>
          </div>
        )}
      </div>
    );
  }

  const runServerAdminAction = async (payload: Record<string, unknown>) => {
    setBusy(true);
    setNotice('');
    try {
      await callAdminManageMarketplace(payload);
      await Promise.all([controllerRef.current?.refresh(), loadPhase4AdminData()]);
    } catch {
      setNotice(t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const toggleModeration = async () => {
    const nextValue = !(modSettings?.requirePreApproval === true);
    if (!window.confirm(t('admin.confirmAction'))) return;
    await runServerAdminAction({
      action: 'updateModerationSettings',
      requirePreApproval: nextValue,
      remoderateMaterialEdits: true,
      reason: nextValue ? 'Enable pre-publication moderation' : 'Disable pre-publication moderation'
    });
  };

  const actWithReason = async (action: string, target: Record<string, unknown>) => {
    const reason = window.prompt(t('admin.reasonPrompt'))?.trim() ?? '';
    if (reason.length < 3) return;
    if (!window.confirm(t('admin.confirmAction'))) return;
    await runServerAdminAction({ action, ...target, reason });
  };

  const adjustQuota = async (emp: EmployerProfile) => {
    const raw = window.prompt(t('admin.quotaPrompt'), String(emp.maxActiveGigs));
    if (raw === null) return;
    const quota = parseInt(raw, 10);
    if (Number.isNaN(quota) || quota < 0 || quota > 50) return;
    const reason = window.prompt(t('admin.reasonPrompt'))?.trim() ?? '';
    if (reason.length < 3) return;
    await runServerAdminAction({
      action: 'setEmployerQuota',
      employerUid: emp.uid,
      maxActiveGigs: quota,
      reason
    });
  };

  const preApprovalOn = modSettings?.requirePreApproval === true;
  const rows = tab === 'pending' ? pending : tab === 'flagged' ? flagged : latest;

  return (
    <div className="page">
      <h1 className="page-title">{t('admin.title')}</h1>
      <div className="admin-bar">
        <span className="muted">{user.email}</span>
        <button className="btn btn-ghost" onClick={logout}>
          {t('admin.signout')}
        </button>
      </div>

      <div className="panel moderation-toggle-card">
        <div>
          <strong>{t('admin.moderationTitle')}</strong>
          <p className="muted small">
            {preApprovalOn ? t('admin.moderationOn') : t('admin.moderationOff')}
          </p>
          <p className="muted small">{t('admin.moderationNonRetroNote')}</p>
        </div>
        <button
          type="button"
          className={`btn btn-small ${preApprovalOn ? 'btn-danger' : 'btn-soft-green'}`}
          disabled={busy}
          onClick={() => void toggleModeration()}
        >
          {preApprovalOn ? t('admin.moderationToggleDisable') : t('admin.moderationToggleEnable')}
        </button>
      </div>

      <div className="tabs" role="tablist" aria-label={t('admin.title')}>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'pending'}
          className={`tab${tab === 'pending' ? ' active' : ''}`}
          onClick={() => setTab('pending')}
        >
          {t('admin.tabs.pending')}
          {pending && pending.length > 0 ? ` (${pending.length})` : ''}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'flagged'}
          className={`tab${tab === 'flagged' ? ' active' : ''}`}
          onClick={() => setTab('flagged')}
        >
          {t('admin.tabs.flagged')}
          {flagged && flagged.length > 0 ? ` (${flagged.length})` : ''}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'reports'}
          className={`tab${tab === 'reports' ? ' active' : ''}`}
          onClick={() => setTab('reports')}
        >
          {t('admin.tabs.reports')}
          {reports && reports.length > 0 ? ` (${reports.length}${reportsHasMore ? '+' : ''})` : ''}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'latest'}
          className={`tab${tab === 'latest' ? ' active' : ''}`}
          onClick={() => setTab('latest')}
        >
          {t('admin.tabs.latest')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'employers'}
          className={`tab${tab === 'employers' ? ' active' : ''}`}
          onClick={() => setTab('employers')}
        >
          {t('admin.tabs.employers')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'audit'}
          className={`tab${tab === 'audit' ? ' active' : ''}`}
          onClick={() => setTab('audit')}
        >
          {t('admin.tabs.audit')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'monitoring'}
          className={`tab${tab === 'monitoring' ? ' active' : ''}`}
          onClick={() => setTab('monitoring')}
        >
          {t('admin.tabs.monitoring')}
        </button>
      </div>

      <div className="admin-tools">
        {samples ? (
          <button
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => void controllerRef.current?.runAction(async () => void (await removeAllSamples()))}
          >
            <Icon name="trash" size={16} />
            {t('admin.removeSamples')}
          </button>
        ) : (
          <button
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => void controllerRef.current?.runAction(async () => void (await seedSamples()))}
          >
            <Icon name="plus" size={16} />
            {t('admin.seed')}
          </button>
        )}
        <button className="btn btn-ghost" onClick={refresh} aria-label={t('common.refresh')}>
          <Icon name="refresh" size={16} />
        </button>
      </div>
      {notice && <p className="form-error">{notice}</p>}

      {tab === 'monitoring' ? (
        <section className="card monitoring-card" aria-labelledby="admin-monitoring-title">
          <h2 id="admin-monitoring-title" className="section-title">
            {t('admin.monitoring.title')}
          </h2>
          <p className="muted small">{t('admin.monitoring.subtitle')}</p>
          <p className="muted small">{t('admin.monitoring.consoleDisclaimer')}</p>

          <div className="monitoring-list">
            {MONITORING_CONSOLE_LINKS.map((item) => (
              <div key={item.key} className="admin-row">
                <div className="admin-row-main">
                  <div className="admin-row-title">{t(item.key)}</div>
                </div>
                <div className="admin-row-actions">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-small btn-ghost"
                  >
                    {t('admin.monitoring.openConsole')}
                  </a>
                </div>
              </div>
            ))}
          </div>

          <div className="status-note">
            <strong>{t('admin.monitoring.budgetThresholdsTitle')}</strong>
            <p className="small">{t('admin.monitoring.budgetThresholdsNote')}</p>
          </div>
        </section>
      ) : tab === 'reports' ? (
        reports === null ? (
          <p className="muted center">{t('common.loading')}</p>
        ) : reports.length === 0 ? (
          <div className="empty">
            <p>{t('admin.empty')}</p>
          </div>
        ) : (
          <>
            <div className="admin-list">
              {reports.map((rep) => {
                const g = rep.gig;
                const dateLabel = formatReportDate(rep.createdAt);
                return (
                  <div
                    key={rep.id}
                    className={`admin-row${g && g.status !== 'active' ? ' muted-row' : ''}`}
                  >
                    <div className="admin-row-main">
                      <div className="admin-row-title">
                        {g ? (
                          <Link to={`/gig/${g.id}`}>{g.title}</Link>
                        ) : (
                          t('admin.reports.missingGig', { id: rep.gigId })
                        )}
                      </div>
                      <div className="admin-row-meta">
                        <span className="flag-chip">
                          {t('admin.reports.reasonPrefix', {
                            reason: t(`report.reasons.${rep.reason}`)
                          })}
                        </span>
                        {dateLabel && (
                          <span className="muted small">
                            {t('admin.reports.submittedAt', { date: dateLabel })}
                          </span>
                        )}
                        {g && (
                          <>
                            <span className="chip">{t(`categories.${g.category}`)}</span>
                            <span className="chip chip-neigh">
                              {formatNeighborhood(g.neighborhood, t)}
                            </span>
                            <span className="pay-value" dir="ltr">
                              {formatPay(g.payMin, g.payMax, t('common.currency'))}
                            </span>
                            <span className="status-chip">{t(`admin.status.${g.status}`)}</span>
                            <span className="flag-chip">🚩 {t('admin.flags', { n: g.flags })}</span>
                          </>
                        )}
                      </div>
                    </div>
                    {g && (
                      <div className="admin-row-actions">
                        {g.status === 'pending' && (
                          <button
                            type="button"
                            className="btn btn-small btn-approve"
                            disabled={busy}
                            onClick={() =>
                              void runServerAdminAction({ action: 'approveGig', gigId: g.id })
                            }
                          >
                            {t('admin.approve')}
                          </button>
                        )}
                        {(g.status === 'hidden' || g.status === 'removed') && (
                          <button
                            type="button"
                            className="btn btn-small btn-approve"
                            disabled={busy}
                            onClick={() =>
                              void runServerAdminAction({ action: 'restoreGig', gigId: g.id })
                            }
                          >
                            {t('admin.restore')}
                          </button>
                        )}
                        {g.status === 'active' && (
                          <button
                            type="button"
                            className="btn btn-small btn-ghost"
                            disabled={busy}
                            onClick={() => void actWithReason('hideGig', { gigId: g.id })}
                          >
                            {t('admin.hide')}
                          </button>
                        )}
                        {g.status !== 'removed' && (
                          <button
                            type="button"
                            className="btn btn-small btn-danger"
                            disabled={busy}
                            onClick={() => void actWithReason('removeGig', { gigId: g.id })}
                          >
                            {t('admin.remove')}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {reportsHasMore && (
              <div className="center load-more">
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={reportsLoadingMore}
                  onClick={() => void loadMoreReports()}
                >
                  {reportsLoadingMore ? t('common.loading') : t('admin.reports.loadMore')}
                </button>
              </div>
            )}
          </>
        )
      ) : tab === 'employers' ? (
        employers === null ? (
          <p className="muted center">{t('common.loading')}</p>
        ) : employers.length === 0 ? (
          <div className="empty">
            <p>{t('admin.empty')}</p>
          </div>
        ) : (
          <div className="admin-list">
            {employers.map((emp) => (
              <div key={emp.uid} className={`admin-row${emp.suspended ? ' muted-row' : ''}`}>
                <div className="admin-row-main">
                  <div className="admin-row-title" dir="ltr">
                    {emp.email ?? emp.legacyPhone ?? emp.uid}
                  </div>
                  <div className="admin-row-meta">
                    <span className="status-chip">
                      {emp.suspended ? t('admin.suspendedTag') : t('admin.activeTag')}
                    </span>
                    <span className="chip">
                      {t('admin.setQuota')}: {emp.activeCount} / {emp.maxActiveGigs}
                    </span>
                  </div>
                </div>
                <div className="admin-row-actions">
                  <button
                    className="btn btn-small btn-ghost"
                    disabled={busy}
                    onClick={() => void adjustQuota(emp)}
                  >
                    {t('admin.setQuota')}
                  </button>
                  {emp.suspended ? (
                    <button
                      className="btn btn-small btn-approve"
                      disabled={busy}
                      onClick={() => void actWithReason('reinstateEmployer', { employerUid: emp.uid })}
                    >
                      {t('admin.reinstate')}
                    </button>
                  ) : (
                    <button
                      className="btn btn-small btn-danger"
                      disabled={busy}
                      onClick={() => void actWithReason('suspendEmployer', { employerUid: emp.uid })}
                    >
                      {t('admin.suspend')}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      ) : tab === 'audit' ? (
        auditLogs === null ? (
          <p className="muted center">{t('common.loading')}</p>
        ) : auditLogs.length === 0 ? (
          <div className="empty">
            <p>{t('admin.empty')}</p>
          </div>
        ) : (
          <div className="admin-list">
            {auditLogs.map((entry) => (
              <div key={entry.id} className="admin-row">
                <div className="admin-row-main">
                  <div className="admin-row-title">
                    {entry.action} — {entry.targetType}/{entry.targetId}
                  </div>
                  <div className="admin-row-meta">
                    <span className="chip">{entry.actorRole}</span>
                    <span className="muted small" dir="ltr">
                      {entry.actorUid}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : rows === null ? (
        <p className="muted center">{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <div className="empty">
          <p>{t('admin.empty')}</p>
        </div>
      ) : (
        <div className="admin-list">
          {rows.map((g) => (
            <div key={g.id} className={`admin-row${g.status !== 'active' ? ' muted-row' : ''}`}>
              <div className="admin-row-main">
                <div className="admin-row-title">
                  {g.title}
                  {g.isSample && <span className="chip chip-sample">{t('gig.sampleBadge')}</span>}
                  {g.verified && (
                    <span className="verified">
                      <Icon name="shield" size={12} />
                      {t('gig.verifiedBadge')}
                    </span>
                  )}
                </div>
                <div className="admin-row-meta">
                  <span className="chip">{t(`categories.${g.category}`)}</span>
                  <span className="chip chip-neigh">{formatNeighborhood(g.neighborhood, t)}</span>
                  <span className="pay-value">{formatPay(g.payMin, g.payMax, t('common.currency'))}</span>
                  <span className="status-chip">{t(`admin.status.${g.status}`)}</span>
                  {g.flags > 0 && <span className="flag-chip">🚩 {t('admin.flags', { n: g.flags })}</span>}
                </div>
              </div>
              <div className="admin-row-actions">
                {g.status === 'pending' && (
                  <button
                    className="btn btn-small btn-approve"
                    disabled={busy}
                    onClick={() => void runServerAdminAction({ action: 'approveGig', gigId: g.id })}
                  >
                    {t('admin.approve')}
                  </button>
                )}
                {(g.status === 'hidden' || g.status === 'removed') && (
                  <button
                    className="btn btn-small btn-approve"
                    disabled={busy}
                    onClick={() => void runServerAdminAction({ action: 'restoreGig', gigId: g.id })}
                  >
                    {t('admin.restore')}
                  </button>
                )}
                {g.status === 'active' && (
                  <button
                    className="btn btn-small btn-ghost"
                    disabled={busy}
                    onClick={() => void actWithReason('hideGig', { gigId: g.id })}
                  >
                    {t('admin.hide')}
                  </button>
                )}
                {g.status !== 'removed' && (
                  <button
                    className="btn btn-small btn-danger"
                    disabled={busy}
                    onClick={() => void actWithReason('removeGig', { gigId: g.id })}
                  >
                    {t('admin.remove')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
