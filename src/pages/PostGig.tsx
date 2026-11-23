import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { useLang } from '../lib/i18n';
import { CATEGORIES, MAX_ACTIVE_GIGS, MAX_PAY_DZD, MIN_TITLE_LENGTH, NEIGHBORHOODS } from '../lib/constants';
import { getRemainingForPhone, postGig, RateLimitError } from '../lib/db';
import { errKey, formatNeighborhood } from '../lib/format';
import { normalizeDzPhone } from '../lib/phone';
import { createFirebaseSmsAdapter, type PhoneVerificationAdapter } from '../lib/phoneAuth';
import type { Category, ListingType } from '../lib/types';
import { Banner } from '../components/Banner';

type Step = 'verify' | 'code' | 'form';

export function PostGig({
  defaultType = 'job',
  lockedType
}: {
  defaultType?: ListingType;
  lockedType?: ListingType;
}) {
  const { t } = useLang();
  const navigate = useNavigate();
  const { phoneNumber: authPhone, loading: authLoading } = useAuth();
  const recapRef = useRef<HTMLDivElement>(null);
  const verifierRef = useRef<PhoneVerificationAdapter | null>(null);

  const [step, setStep] = useState<Step>(authPhone ? 'form' : 'verify');
  const [phoneInput, setPhoneInput] = useState('');
  const [phone, setPhone] = useState(authPhone ?? '');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Form state
  const [selectedType, setSelectedType] = useState<ListingType>(lockedType ?? defaultType);
  const listingType: ListingType = lockedType ?? selectedType;
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<Category>('construction');
  const [description, setDescription] = useState('');
  const [payMin, setPayMin] = useState('');
  const [payMax, setPayMax] = useState('');
  const [neighborhood, setNeighborhood] = useState(NEIGHBORHOODS[0]);
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    verifierRef.current = createFirebaseSmsAdapter(auth);
    return () => {
      verifierRef.current?.dispose();
      verifierRef.current = null;
    };
  }, []);

  useEffect(() => {
    setSelectedType(lockedType ?? defaultType);
  }, [defaultType, lockedType]);

  useEffect(() => {
    if (authPhone) {
      setPhone(authPhone);
      setStep('form');
    }
  }, [authPhone]);

  useEffect(() => {
    if (phone) {
      getRemainingForPhone(phone)
        .then(setRemaining)
        .catch(() => setRemaining(null));
    }
  }, [phone]);

  const sendCode = async () => {
    const normalized = normalizeDzPhone(phoneInput || phone);
    if (!normalized) {
      setErr(t('post.phoneInvalid'));
      return;
    }
    if (!recapRef.current || !verifierRef.current) {
      setErr(t('auth.recaptchaError'));
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await verifierRef.current.sendCode(normalized, recapRef.current);
      setPhone(normalized);
      setStep('code');
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      setErr(t(errKey(code)));
    } finally {
      setBusy(false);
    }
  };

  const confirmCode = async () => {
    if (!verifierRef.current?.hasPendingConfirmation() || code.trim().length < 4) return;
    setBusy(true);
    setErr('');
    try {
      await verifierRef.current.confirmCode(code.trim());
      setStep('form');
    } catch (e) {
      const c = (e as { code?: string }).code ?? '';
      setErr(t(errKey(c)));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    const cleanTitle = title.trim();
    const cleanDesc = description.trim();
    if (cleanTitle.length < MIN_TITLE_LENGTH || !cleanDesc || !payMin) {
      setErr(t('post.required'));
      return;
    }
    const min = parseInt(payMin, 10);
    const max = payMax ? parseInt(payMax, 10) : min;
    if (
      Number.isNaN(min) ||
      min < 0 ||
      min > MAX_PAY_DZD ||
      Number.isNaN(max) ||
      max < min ||
      max > MAX_PAY_DZD
    ) {
      setErr(t('post.required'));
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const id = await postGig({
        title: cleanTitle,
        description: cleanDesc,
        category,
        listingType,
        payMin: min,
        payMax: max,
        neighborhood
      });
      navigate(`/gig/${id}`, { state: { justPosted: true } });
    } catch (e) {
      if (e instanceof RateLimitError) setErr(t('post.rateLimit'));
      else setErr(t('post.error'));
      setBusy(false);
    }
  };

  const changeNumber = async () => {
    verifierRef.current?.reset();
    await auth.signOut();
    setPhoneInput('');
    setPhone('');
    setCode('');
    setErr('');
    setStep('verify');
  };

  const heading =
    listingType === 'service' ? t('post.serviceTitle') : t('post.employerTitle');

  return (
    <div className="page">
      <Banner />
      <h1 className="page-title">{heading}</h1>
      {lockedType ? (
        <div className="locked-type-row">
          <span className={`chip chip-type-${lockedType}`}>{t(`listingType.${lockedType}`)}</span>
        </div>
      ) : (
        <div className="type-switcher" role="group" aria-label={t('listingType.label')}>
          <button
            type="button"
            className={`type-pill${listingType === 'job' ? ' active' : ''}`}
            aria-pressed={listingType === 'job'}
            onClick={() => setSelectedType('job')}
          >
            {t('listingType.job')}
          </button>
          <button
            type="button"
            className={`type-pill${listingType === 'service' ? ' active' : ''}`}
            aria-pressed={listingType === 'service'}
            onClick={() => setSelectedType('service')}
          >
            {t('listingType.service')}
          </button>
        </div>
      )}
      <div ref={recapRef} className="recap" />

      {authLoading ? (
        <p className="muted center">{t('common.loading')}</p>
      ) : null}

      {!authLoading && step === 'verify' && (
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && phoneInput.trim()) void sendCode();
          }}
        >
          <h2>{t('post.verifyTitle')}</h2>
          <p className="muted">{t('post.verifyText')}</p>
          <label className="field">
            <span>{t('post.phoneLabel')}</span>
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              dir="ltr"
              placeholder={t('post.phonePlaceholder')}
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
            />
          </label>
          {err && <p className="form-error">{err}</p>}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy || !phoneInput.trim()}>
            {busy ? t('common.loading') : t('post.sendCode')}
          </button>
        </form>
      )}

      {step === 'code' && (
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && code.trim().length >= 4) void confirmCode();
          }}
        >
          <h2>{t('post.codeTitle')}</h2>
          <p className="muted">{t('post.codeText', { phone })}</p>
          <label className="field">
            <span>{t('post.codeLabel')}</span>
            <input
              type="tel"
              inputMode="numeric"
              dir="ltr"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </label>
          {err && <p className="form-error">{err}</p>}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy || code.trim().length < 4}>
            {busy ? t('common.loading') : t('post.confirm')}
          </button>
          <div className="sheet-actions">
            <button type="button" className="btn btn-ghost" onClick={sendCode} disabled={busy || !phone}>
              {t('post.resend')}
            </button>
            <button type="button" className="btn btn-ghost" onClick={changeNumber} disabled={busy}>
              {t('post.changeNumber')}
            </button>
          </div>
        </form>
      )}

      {step === 'form' && (
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void submit();
          }}
        >
          <div className="verified-banner">
            <span>✓</span>
            {t('post.verifiedAs', { phone })}
          </div>
          {remaining !== null && (
            <p className="remaining">{t('post.remaining', { n: MAX_ACTIVE_GIGS - remaining })}</p>
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
                <span className="pay-suffix">{t('common.currency')}</span>
              </div>
            </label>
          </div>
          <label className="field">
            <span>{t('post.neighborhoodLabel')}</span>
            <select value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)}>
              {NEIGHBORHOODS.map((n) => (
                <option key={n} value={n}>
                  {formatNeighborhood(n, t)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('post.whatsappLabel')}</span>
            <input value={phone} disabled dir="ltr" />
            <p className="field-hint">{t('post.whatsappNote')}</p>
          </label>
          {err && <p className="form-error">{err}</p>}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? t('common.loading') : t('post.submit')}
          </button>
          <div className="center">
            <button type="button" className="btn btn-ghost" onClick={changeNumber}>
              {t('post.changeNumber')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
