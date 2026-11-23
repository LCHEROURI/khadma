import { useEffect, useRef, useState } from 'react';
import { sendEmailVerification, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { useLang } from '../lib/i18n';
import { ADMIN_EMAIL } from '../lib/constants';
import { createAdminQueueController, type AdminQueueController } from '../lib/adminQueue';
import { adminApprove, adminRemove, getAdminQueue, hasSamples, removeAllSamples, seedSamples } from '../lib/db';
import { formatNeighborhood, formatPay } from '../lib/format';
import type { Gig } from '../lib/types';
import { Icon } from '../components/Icon';

export function Admin() {
  const { t } = useLang();
  const { user, loading: authLoading, isAdmin } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authErr, setAuthErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'flagged' | 'latest'>('flagged');
  const [latest, setLatest] = useState<Gig[] | null>(null);
  const [flagged, setFlagged] = useState<Gig[] | null>(null);
  const [samples, setSamples] = useState(false);
  const [notice, setNotice] = useState('');
  const [verifySent, setVerifySent] = useState(false);

  const errorMessageRef = useRef(() => t('common.error'));
  errorMessageRef.current = () => t('common.error');

  const controllerRef = useRef<AdminQueueController | null>(null);

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
  };

  useEffect(() => {
    if (isAdmin) {
      void controllerRef.current?.refresh();
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

  if (!user) {
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

  const act = (fn: () => Promise<void>) => {
    void controllerRef.current?.runAction(fn);
  };

  const rows = tab === 'flagged' ? flagged : latest;

  return (
    <div className="page">
      <h1 className="page-title">{t('admin.title')}</h1>
      <div className="admin-bar">
        <span className="muted">{user.email}</span>
        <button className="btn btn-ghost" onClick={logout}>
          {t('admin.signout')}
        </button>
      </div>

      <div className="tabs">
        <button className={`tab${tab === 'flagged' ? ' active' : ''}`} onClick={() => setTab('flagged')}>
          {t('admin.tabs.flagged')}
          {flagged && flagged.length > 0 ? ` (${flagged.length})` : ''}
        </button>
        <button className={`tab${tab === 'latest' ? ' active' : ''}`} onClick={() => setTab('latest')}>
          {t('admin.tabs.latest')}
        </button>
      </div>

      <div className="admin-tools">
        {samples ? (
          <button
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => act(async () => void (await removeAllSamples()))}
          >
            <Icon name="trash" size={16} />
            {t('admin.removeSamples')}
          </button>
        ) : (
          <button
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => act(async () => void (await seedSamples()))}
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

      {rows === null ? (
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
                  {g.verified && <span className="verified"><Icon name="shield" size={12} />{t('gig.verifiedBadge')}</span>}
                </div>
                <div className="admin-row-meta">
                  <span className="chip">{t(`categories.${g.category}`)}</span>
                  <span className="chip chip-neigh">{formatNeighborhood(g.neighborhood, t)}</span>
                  <span>{formatPay(g.payMin, g.payMax, t('common.currency'))}</span>
                  <span className="status-chip">{t(`admin.status.${g.status}`)}</span>
                  {g.flags > 0 && <span className="flag-chip">🚩 {t('admin.flags', { n: g.flags })}</span>}
                </div>
                {!g.isSample && g.posterPhone && (
                  <div className="admin-row-phone">☎ {g.posterPhone}</div>
                )}
              </div>
              <div className="admin-row-actions">
                {g.status !== 'active' && (
                  <button className="btn btn-small btn-approve" disabled={busy} onClick={() => act(() => adminApprove(g.id))}>
                    {t('admin.approve')}
                  </button>
                )}
                {g.status !== 'removed' && (
                  <button className="btn btn-small btn-danger" disabled={busy} onClick={() => act(() => adminRemove(g.id))}>
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
