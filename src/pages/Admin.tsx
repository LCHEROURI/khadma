import { useEffect, useState } from 'react';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '../firebase';
import { useLang } from '../lib/i18n';
import { ADMIN_EMAIL } from '../lib/constants';
import { adminApprove, adminRemove, getAdminQueue, hasSamples, removeAllSamples, seedSamples } from '../lib/db';
import { formatPay } from '../lib/format';
import type { Gig } from '../lib/types';
import { Icon } from '../components/Icon';

export function Admin() {
  const { t } = useLang();
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authErr, setAuthErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'flagged' | 'latest'>('flagged');
  const [latest, setLatest] = useState<Gig[] | null>(null);
  const [flagged, setFlagged] = useState<Gig[] | null>(null);
  const [samples, setSamples] = useState(false);
  const [notice, setNotice] = useState('');

  const refresh = () => {
    getAdminQueue().then(({ latest: l, flagged: f }) => {
      setLatest(l);
      setFlagged(f);
    });
    hasSamples().then(setSamples);
  };

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u && u.email === ADMIN_EMAIL) refresh();
    });
    return unsub;
  }, []);

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
    await signOut(auth);
    setLatest(null);
    setFlagged(null);
  };

  const isAdmin = user?.email === ADMIN_EMAIL;

  if (user === undefined) {
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
        <div className="detail-card">
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
          <button className="btn btn-primary wide" onClick={login} disabled={busy || !email || !password}>
            {busy ? t('common.loading') : t('admin.login')}
          </button>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="page">
        <h1 className="page-title">{t('admin.title')}</h1>
        <div className="empty">
          <p>{t('admin.notAdmin')}</p>
          <p className="muted">{user.email}</p>
          <button className="btn btn-ghost" onClick={logout}>
            {t('admin.signout')}
          </button>
        </div>
      </div>
    );
  }

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      setNotice('');
      refresh();
    } catch {
      setNotice(t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  const rows = tab === 'flagged' ? flagged : latest;

  return (
    <div className="page">
      <h1 className="page-title">{t('admin.title')}</h1>
      <div className="admin-bar">
        <span className="muted">cherouri@gmail.com</span>
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
        <button className="btn btn-ghost" onClick={refresh}>
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
                  <span className="chip chip-neigh">{g.neighborhood}</span>
                  <span>{formatPay(g.payMin, g.payMax)}</span>
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
