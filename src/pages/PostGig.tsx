import { useEffect, useRef, useState } from 'react';
import { RecaptchaVerifier, signInWithPhoneNumber, type ConfirmationResult } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase';
import { useLang } from '../lib/i18n';
import { CATEGORIES, NEIGHBORHOODS } from '../lib/constants';
import { getRemainingForPhone, postGig, RateLimitError } from '../lib/db';
import { errKey } from '../lib/format';
import { normalizeDzPhone } from '../lib/phone';
import type { Category } from '../lib/types';
import { Banner } from '../components/Banner';

type Step = 'verify' | 'code' | 'form';

export function PostGig() {
  const { t } = useLang();
  const navigate = useNavigate();
  const recapRef = useRef<HTMLDivElement>(null);
  const [recap, setRecap] = useState<RecaptchaVerifier | null>(null);

  const phoneUser = auth.currentUser?.phoneNumber ?? null;
  const [step, setStep] = useState<Step>(phoneUser ? 'form' : 'verify');
  const [phoneInput, setPhoneInput] = useState('');
  const [phone, setPhone] = useState(phoneUser ?? '');
  const [code, setCode] = useState('');
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Form state
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<Category>('construction');
  const [description, setDescription] = useState('');
  const [payMin, setPayMin] = useState('');
  const [payMax, setPayMax] = useState('');
  const [neighborhood, setNeighborhood] = useState(NEIGHBORHOODS[0]);
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (recapRef.current && !recap) {
      try {
        const r = new RecaptchaVerifier(auth, recapRef.current, {
          size: 'invisible',
          callback: () => {}
        });
        setRecap(r);
      } catch {
        // recaptcha already rendered — ignore
      }
    }
  }, [recap]);

  useEffect(() => {
    if (phone) {
      getRemainingForPhone(phone)
        .then(setRemaining)
        .catch(() => setRemaining(null));
    }
  }, [phone]);

  const sendCode = async () => {
    const normalized = normalizeDzPhone(phoneInput);
    if (!normalized) {
      setErr(t('post.phoneInvalid'));
      return;
    }
    if (!recap) {
      setErr(t('auth.recaptchaError'));
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const c = await signInWithPhoneNumber(auth, normalized, recap);
      setPhone(normalized);
      setConfirmation(c);
      setStep('code');
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      setErr(t(errKey(code)));
    } finally {
      setBusy(false);
    }
  };

  const confirmCode = async () => {
    if (!confirmation || code.trim().length < 4) return;
    setBusy(true);
    setErr('');
    try {
      await confirmation.confirm(code.trim());
      setStep('form');
    } catch (e) {
      const c = (e as { code?: string }).code ?? '';
      setErr(t(errKey(c)));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!title.trim() || !description.trim() || !payMin) {
      setErr(t('post.required'));
      return;
    }
    const min = parseInt(payMin, 10);
    const max = payMax ? parseInt(payMax, 10) : min;
    if (Number.isNaN(min) || min < 0 || Number.isNaN(max) || max < min) {
      setErr(t('post.required'));
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const id = await postGig({ title, description, category, payMin: min, payMax: max, neighborhood });
      navigate(`/gig/${id}`, { state: { justPosted: true } });
    } catch (e) {
      if (e instanceof RateLimitError) setErr(t('post.rateLimit'));
      else setErr(t('post.error'));
      setBusy(false);
    }
  };

  const changeNumber = async () => {
    await auth.signOut();
    setConfirmation(null);
    setPhoneInput('');
    setPhone('');
    setCode('');
    setStep('verify');
  };

  return (
    <div className="page">
      <Banner />
      <h1 className="page-title">{t('post.title')}</h1>
      <div ref={recapRef} className="recap" />

      {step === 'verify' && (
        <div className="panel">
          <h2>{t('post.verifyTitle')}</h2>
          <p className="muted">{t('post.verifyText')}</p>
          <label className="field">
            <span>{t('post.phoneLabel')}</span>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder={t('post.phonePlaceholder')}
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
            />
          </label>
          {err && <p className="form-error">{err}</p>}
          <button className="btn btn-primary btn-block" onClick={sendCode} disabled={busy || !phoneInput.trim()}>
            {busy ? t('common.loading') : t('post.sendCode')}
          </button>
        </div>
      )}

      {step === 'code' && (
        <div className="panel">
          <h2>{t('post.codeTitle')}</h2>
          <p className="muted">{t('post.codeText', { phone })}</p>
          <label className="field">
            <span>{t('post.codeLabel')}</span>
            <input
              type="tel"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </label>
          {err && <p className="form-error">{err}</p>}
          <button className="btn btn-primary btn-block" onClick={confirmCode} disabled={busy || code.trim().length < 4}>
            {busy ? t('common.loading') : t('post.confirm')}
          </button>
          <div className="sheet-actions">
            <button className="btn btn-ghost" onClick={sendCode} disabled={busy || !confirmation}>
              {t('post.resend')}
            </button>
            <button className="btn btn-ghost" onClick={changeNumber} disabled={busy}>
              {t('post.changeNumber')}
            </button>
          </div>
        </div>
      )}

      {step === 'form' && (
        <div className="panel">
          <div className="verified-banner">
            <span>✓</span>
            {t('post.verifiedAs', { phone })}
          </div>
          {remaining !== null && (
            <p className="muted small">{t('post.remaining', { n: remaining })}</p>
          )}
          <h2>{t('post.formTitle')}</h2>
          <label className="field">
            <span>{t('post.titleLabel')} *</span>
            <input value={title} maxLength={120} placeholder={t('post.titlePlaceholder')} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="field">
            <span>{t('post.categoryLabel')}</span>
            <select value={category} onChange={(e) => setCategory(e.target.value as Category)}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`categories.${c}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('post.descriptionLabel')} *</span>
            <textarea
              rows={4}
              maxLength={2000}
              value={description}
              placeholder={t('post.descriptionPlaceholder')}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
          <div className="field-row">
            <label className="field">
              <span>{t('post.payLabel')} *</span>
              <div className="pay-inputs">
                <input type="number" inputMode="numeric" min={0} placeholder={t('post.payMin')} value={payMin} onChange={(e) => setPayMin(e.target.value)} />
                <input type="number" inputMode="numeric" min={0} placeholder={t('post.payMax')} value={payMax} onChange={(e) => setPayMax(e.target.value)} />
                <span className="pay-suffix">DZD</span>
              </div>
            </label>
          </div>
          <label className="field">
            <span>{t('post.neighborhoodLabel')}</span>
            <select value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)}>
              {NEIGHBORHOODS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('post.whatsappLabel')}</span>
            <input value={phone} disabled />
            <p className="field-hint">{t('post.whatsappNote')}</p>
          </label>
          {err && <p className="form-error">{err}</p>}
          <button className="btn btn-primary btn-block" onClick={submit} disabled={busy}>
            {busy ? t('common.loading') : t('post.submit')}
          </button>
          <div className="center">
            <button className="btn btn-ghost" onClick={changeNumber}>
              {t('post.changeNumber')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
