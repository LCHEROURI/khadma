import { useEffect, useState } from 'react';
import { auth } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { useLang } from '../lib/i18n';
import {
  getRemainingCooldownSeconds,
  isValidEmail,
  mapAuthErrorKey,
  registerEmployerWithEmail,
  requestPasswordReset,
  resendVerificationEmail,
  signInEmployerWithEmail,
  signOutEmployer,
  validatePassword
} from '../lib/employerAuth';

type AuthMode = 'register' | 'login' | 'reset';

export function EmployerAuthPanel({
  onVerified
}: {
  onVerified?: () => void;
}) {
  const { t, lang } = useLang();
  const { user, email: authEmail, emailVerified, isAnonymous, refreshAuth } = useAuth();
  const [mode, setMode] = useState<AuthMode>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');
  const [lastSentMs, setLastSentMs] = useState<number | null>(null);
  const [cooldownSec, setCooldownSec] = useState(0);

  useEffect(() => {
    if (lastSentMs === null) {
      setCooldownSec(0);
      return;
    }
    const tick = () => {
      const rem = getRemainingCooldownSeconds(lastSentMs, Date.now());
      setCooldownSec(rem);
      if (rem <= 0) setLastSentMs(null);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [lastSentMs]);

  const showVerifyGate = Boolean(user && !isAnonymous && authEmail && !emailVerified);

  const handleRegisterOrLogin = async () => {
    setErr('');
    setNotice('');
    if (!isValidEmail(email)) {
      setErr(t('auth.invalidEmail'));
      return;
    }
    if (mode === 'register' && validatePassword(password) !== 'ok') {
      setErr(t('auth.weakPassword'));
      return;
    }
    if (mode === 'login' && !password) {
      setErr(t('auth.invalidCredentials'));
      return;
    }

    setBusy(true);
    try {
      if (mode === 'register') {
        const res = await registerEmployerWithEmail(auth, email, password, lang);
        setPassword('');
        if (res.verificationSent) {
          setLastSentMs(Date.now());
        }
      } else {
        const signedInUser = await signInEmployerWithEmail(auth, email, password);
        setPassword('');
        if (signedInUser.emailVerified && onVerified) {
          onVerified();
        }
      }
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      setErr(t(mapAuthErrorKey(code)));
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    setErr('');
    setNotice('');
    if (!isValidEmail(email)) {
      setErr(t('auth.invalidEmail'));
      return;
    }
    setBusy(true);
    try {
      await requestPasswordReset(auth, email, lang);
      setNotice(t('auth.resetSent'));
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      setErr(t(mapAuthErrorKey(code)));
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    if (!user || cooldownSec > 0 || busy) return;
    setBusy(true);
    setErr('');
    setNotice('');
    try {
      await resendVerificationEmail(user, auth, lang);
      setLastSentMs(Date.now());
      setNotice(t('auth.verifyResent'));
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      setErr(t(mapAuthErrorKey(code)));
    } finally {
      setBusy(false);
    }
  };

  const handleCheckVerified = async () => {
    if (!user || busy) return;
    setBusy(true);
    setErr('');
    setNotice('');
    try {
      await refreshAuth();
      if (auth.currentUser?.emailVerified) {
        onVerified?.();
      } else {
        setErr(t('auth.verifyStillPending'));
      }
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      setErr(t(mapAuthErrorKey(code)));
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    setBusy(true);
    setErr('');
    setNotice('');
    try {
      await signOutEmployer(auth);
    } finally {
      setBusy(false);
    }
  };

  if (showVerifyGate && authEmail) {
    return (
      <div className="panel auth-panel">
        <h2>{t('auth.verifyTitle')}</h2>
        <p className="muted">{t('auth.verifyText', { email: authEmail })}</p>
        {notice && (
          <p className="status-note sample-note" role="status">
            {notice}
          </p>
        )}
        {err && (
          <p className="form-error" role="alert">
            {err}
          </p>
        )}
        <div className="auth-actions">
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={busy}
            onClick={handleCheckVerified}
          >
            {busy ? t('common.loading') : t('auth.verifyRefresh')}
          </button>
          <button
            type="button"
            className="btn btn-soft-green btn-block"
            disabled={busy || cooldownSec > 0}
            onClick={handleResend}
          >
            {cooldownSec > 0
              ? t('auth.verifyResendWait', { s: cooldownSec })
              : t('auth.verifyResend')}
          </button>
          <button type="button" className="btn btn-ghost btn-block" disabled={busy} onClick={handleSignOut}>
            {t('employer.signOut')}
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'reset') {
    return (
      <form
        className="panel auth-panel"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) void handleReset();
        }}
      >
        <h2>{t('auth.resetTitle')}</h2>
        <p className="muted">{t('auth.resetText')}</p>
        <label className="field">
          <span>{t('auth.emailLabel')}</span>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            dir="ltr"
            placeholder={t('auth.emailPlaceholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        {notice && (
          <p className="status-note sample-note" role="status">
            {notice}
          </p>
        )}
        {err && (
          <p className="form-error" role="alert">
            {err}
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? t('common.loading') : t('auth.resetSubmit')}
        </button>
        <div className="center">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setMode('login');
              setErr('');
              setNotice('');
            }}
          >
            {t('auth.backToLogin')}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form
      className="panel auth-panel"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) void handleRegisterOrLogin();
      }}
    >
      <div className="type-switcher" role="tablist" aria-label={t('auth.title')}>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'register'}
          className={`type-pill${mode === 'register' ? ' active' : ''}`}
          onClick={() => {
            setMode('register');
            setErr('');
            setNotice('');
          }}
        >
          {t('auth.tabRegister')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'login'}
          className={`type-pill${mode === 'login' ? ' active' : ''}`}
          onClick={() => {
            setMode('login');
            setErr('');
            setNotice('');
          }}
        >
          {t('auth.tabLogin')}
        </button>
      </div>

      <p className="muted">{t('auth.subtitle')}</p>

      <label className="field">
        <span>{t('auth.emailLabel')}</span>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          dir="ltr"
          placeholder={t('auth.emailPlaceholder')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>

      <label className="field">
        <span>{t('auth.passwordLabel')}</span>
        <input
          type="password"
          autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          placeholder={t('auth.passwordPlaceholder')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>

      {err && (
        <p className="form-error" role="alert">
          {err}
        </p>
      )}

      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
        {busy
          ? t('common.loading')
          : mode === 'register'
            ? t('auth.registerSubmit')
            : t('auth.loginSubmit')}
      </button>

      {mode === 'login' && (
        <div className="center">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setMode('reset');
              setErr('');
              setNotice('');
            }}
          >
            {t('auth.forgotPassword')}
          </button>
        </div>
      )}
    </form>
  );
}
