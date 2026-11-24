import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { applyActionCode, confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import { auth } from '../firebase';
import { useLang } from '../lib/i18n';
import { validatePassword } from '../lib/employerAuth';
import {
  mapActionCodeErrorKey,
  parseAuthActionParams,
  resolveSafeReturnPath
} from '../lib/authAction';
import { Icon } from '../components/Icon';

type ActionStatus =
  | 'loading'
  | 'verify_success'
  | 'reset_form'
  | 'reset_success'
  | 'error';

type ActionOutcome =
  | { status: 'verify_success' }
  | { status: 'reset_form' }
  | { status: 'error'; errorKey: string };

// Deduplicate one-time Firebase oobCode verification across React 18 StrictMode remounts
// without dropping state updates when the first effect invocation cleans up.
const actionOutcomeCache = new Map<string, Promise<ActionOutcome>>();

function executeAuthActionOnce(
  mode: 'verifyEmail' | 'resetPassword',
  oobCode: string
): Promise<ActionOutcome> {
  const cacheKey = `${mode}:${oobCode}`;
  const existing = actionOutcomeCache.get(cacheKey);
  if (existing) return existing;

  // Keep cache bounded for long-lived SPA sessions.
  if (actionOutcomeCache.size >= 20) {
    const oldestKey = actionOutcomeCache.keys().next().value;
    if (oldestKey) actionOutcomeCache.delete(oldestKey);
  }

  const promise: Promise<ActionOutcome> =
    mode === 'verifyEmail'
      ? applyActionCode(auth, oobCode)
          .then(async () => {
            // Reload authenticated user & refresh ID token so emailVerified claim updates immediately.
            const current = auth.currentUser;
            if (current) {
              await current.reload();
              await current.getIdToken(true);
            }
            return { status: 'verify_success' as const };
          })
          .catch((err) => {
            const code = (err as { code?: string }).code ?? '';
            return { status: 'error' as const, errorKey: mapActionCodeErrorKey(code) };
          })
      : verifyPasswordResetCode(auth, oobCode)
          .then(() => ({ status: 'reset_form' as const }))
          .catch((err) => {
            const code = (err as { code?: string }).code ?? '';
            return { status: 'error' as const, errorKey: mapActionCodeErrorKey(code) };
          });

  actionOutcomeCache.set(cacheKey, promise);
  return promise;
}

export function AuthAction() {
  const { search } = useLocation();
  const { t, setLang } = useLang();
  const parsed = parseAuthActionParams(search);
  const safeReturnPath = resolveSafeReturnPath(
    parsed.continueUrl,
    typeof window !== 'undefined' ? window.location.origin : 'https://khadma-oran.web.app',
    '/employer'
  );

  const [status, setStatus] = useState<ActionStatus>('loading');
  const [errorKey, setErrorKey] = useState<string>('');
  const [newPassword, setNewPassword] = useState('');
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetFormErr, setResetFormErr] = useState('');

  useEffect(() => {
    if (parsed.lang) {
      setLang(parsed.lang);
    }
  }, [parsed.lang, setLang]);

  useEffect(() => {
    setResetFormErr('');
    setErrorKey('');

    if (!parsed.mode || (parsed.mode !== 'verifyEmail' && parsed.mode !== 'resetPassword')) {
      setErrorKey('authAction.errorUnsupported');
      setStatus('error');
      return;
    }

    if (!parsed.oobCode) {
      setErrorKey('authAction.errorInvalid');
      setStatus('error');
      return;
    }

    let active = true;
    setStatus('loading');

    void executeAuthActionOnce(parsed.mode, parsed.oobCode).then((outcome) => {
      if (!active) return;
      if (outcome.status === 'error') {
        setErrorKey(outcome.errorKey);
        setStatus('error');
      } else {
        setStatus(outcome.status);
      }
    });

    return () => {
      active = false;
    };
  }, [parsed.mode, parsed.oobCode]);

  const handleConfirmReset = async () => {
    setResetFormErr('');
    if (validatePassword(newPassword) !== 'ok') {
      setResetFormErr(t('auth.weakPassword'));
      return;
    }
    setResetSubmitting(true);
    try {
      await confirmPasswordReset(auth, parsed.oobCode, newPassword);
      setNewPassword('');
      setStatus('reset_success');
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      setResetFormErr(t(mapActionCodeErrorKey(code)));
    } finally {
      setResetSubmitting(false);
    }
  };

  return (
    <div className="page">
      <div className="panel auth-action-card">
        <div className="auth-action-brand">
          <span className="brand-mark" aria-hidden="true">
            <Icon name="algeriaEmblem" size={24} />
          </span>
          <span className="brand-name">{t('appName')}</span>
        </div>

        {status === 'loading' && (
          <div className="auth-action-body" role="status" aria-live="polite">
            <h1 className="page-title">{t('authAction.loadingTitle')}</h1>
            <p className="muted">{t('common.loading')}</p>
          </div>
        )}

        {status === 'verify_success' && (
          <div className="auth-action-body" role="status" aria-live="polite">
            <h1 className="page-title">{t('authAction.verifySuccessTitle')}</h1>
            <p className="muted">{t('authAction.verifySuccessText')}</p>
            <div className="auth-actions">
              <Link to={safeReturnPath} className="btn btn-primary btn-block">
                {t('authAction.returnToKhadma')}
              </Link>
            </div>
          </div>
        )}

        {status === 'reset_form' && (
          <form
            className="auth-action-body"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!resetSubmitting) void handleConfirmReset();
            }}
          >
            <h1 className="page-title">{t('authAction.resetTitle')}</h1>
            <p className="muted">{t('authAction.resetText')}</p>
            <label className="field">
              <span>{t('authAction.newPasswordLabel')}</span>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t('auth.passwordPlaceholder')}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
            {resetFormErr && (
              <p className="form-error" role="alert">
                {resetFormErr}
              </p>
            )}
            <div className="auth-actions">
              <button type="submit" className="btn btn-primary btn-block" disabled={resetSubmitting}>
                {resetSubmitting ? t('common.loading') : t('authAction.resetSubmit')}
              </button>
            </div>
          </form>
        )}

        {status === 'reset_success' && (
          <div className="auth-action-body" role="status" aria-live="polite">
            <h1 className="page-title">{t('authAction.resetSuccessTitle')}</h1>
            <p className="muted">{t('authAction.resetSuccessText')}</p>
            <div className="auth-actions">
              <Link to={safeReturnPath} className="btn btn-primary btn-block">
                {t('authAction.returnToKhadma')}
              </Link>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div className="auth-action-body" role="alert">
            <h1 className="page-title">{t('authAction.errorTitle')}</h1>
            <p className="form-error">{t(errorKey || 'authAction.errorGeneric')}</p>
            <div className="auth-actions">
              <Link to="/employer" className="btn btn-primary btn-block">
                {t('authAction.returnToKhadma')}
              </Link>
              <Link to="/" className="btn btn-ghost btn-block">
                {t('nav.home')}
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
