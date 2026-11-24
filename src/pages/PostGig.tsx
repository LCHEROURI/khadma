import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { auth } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { useLang } from '../lib/i18n';
import { CATEGORIES, MAX_ACTIVE_GIGS, MAX_PAY_DZD, MIN_TITLE_LENGTH, NEIGHBORHOODS } from '../lib/constants';
import { getEmployerProfile, getRemainingForPhone, postGig, RateLimitError } from '../lib/db';
import { resolveEmployerEligibility, signOutEmployer } from '../lib/employerAuth';
import { formatNeighborhood } from '../lib/format';
import type { Category, EmployerProfile, ListingType } from '../lib/types';
import { Banner } from '../components/Banner';
import { EmployerAuthPanel } from '../components/EmployerAuthPanel';

export function PostGig({
  defaultType = 'job',
  lockedType
}: {
  defaultType?: ListingType;
  lockedType?: ListingType;
}) {
  const { t } = useLang();
  const navigate = useNavigate();
  const {
    user,
    email,
    emailVerified,
    phoneNumber: authPhone,
    isAnonymous,
    isPhoneUser,
    isEmployer,
    loading: authLoading
  } = useAuth();

  const [profile, setProfile] = useState<EmployerProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Form state (preserved for existing legacy phone employers during Phase 2 -> Phase 4 transition)
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
    setSelectedType(lockedType ?? defaultType);
  }, [defaultType, lockedType]);

  useEffect(() => {
    if (!user || !isEmployer) {
      setProfile(null);
      return;
    }
    let cancelled = false;
    getEmployerProfile(user.uid)
      .then((prof) => {
        if (!cancelled) setProfile(prof);
      })
      .catch(() => {
        if (!cancelled) setProfile(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user, isEmployer]);

  useEffect(() => {
    if (authPhone) {
      getRemainingForPhone(authPhone)
        .then(setRemaining)
        .catch(() => setRemaining(null));
    } else {
      setRemaining(null);
    }
  }, [authPhone]);

  const eligibility = resolveEmployerEligibility(
    {
      uid: user?.uid ?? null,
      email,
      emailVerified,
      phoneNumber: authPhone,
      isAnonymous
    },
    profile
  );

  const submitLegacyPhonePost = async () => {
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

  const handleSignOut = async () => {
    await signOutEmployer(auth);
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

      {authLoading ? (
        <p className="muted center">{t('common.loading')}</p>
      ) : !eligibility.eligible ? (
        eligibility.isSuspended ? (
          <div className="panel">
            <div className="load-more-error" role="alert">
              <p className="form-error">{t('employer.suspendedNotice')}</p>
            </div>
            <div className="center">
              <button type="button" className="btn btn-ghost" onClick={handleSignOut}>
                {t('employer.signOut')}
              </button>
            </div>
          </div>
        ) : (
          // Email-first registration & verification (ordinary SMS registration removed in V1.4 Phase 2)
          <EmployerAuthPanel />
        )
      ) : isPhoneUser && authPhone ? (
        // Legacy phone-authenticated employers retain V1.3 publishing until Phase 4 server callable cutover
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void submitLegacyPhonePost();
          }}
        >
          <div className="verified-banner">
            <span>✓</span>
            {t('post.verifiedAs', { phone: authPhone })}
          </div>
          {remaining !== null && (
            <p className="remaining">{t('post.remaining', { n: MAX_ACTIVE_GIGS - remaining })}</p>
          )}
          <h2>{t('post.formTitle')}</h2>
          <label className="field">
            <span>{t('post.titleLabel')} *</span>
            <input
              value={title}
              maxLength={120}
              placeholder={t('post.titlePlaceholder')}
              onChange={(e) => setTitle(e.target.value)}
            />
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
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  placeholder={t('post.payMin')}
                  value={payMin}
                  onChange={(e) => setPayMin(e.target.value)}
                />
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  placeholder={t('post.payMax')}
                  value={payMax}
                  onChange={(e) => setPayMax(e.target.value)}
                />
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
            <input value={authPhone} disabled dir="ltr" />
            <p className="field-hint">{t('post.whatsappNote')}</p>
          </label>
          {err && <p className="form-error">{err}</p>}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? t('common.loading') : t('post.submit')}
          </button>
          <div className="center">
            <button type="button" className="btn btn-ghost" onClick={handleSignOut}>
              {t('employer.signOut')}
            </button>
          </div>
        </form>
      ) : (
        <div className="panel">
          <div className="verified-banner">
            <span>✓</span>
            <span dir="ltr">{email}</span>
          </div>
          <h2>{t('post.emailReadyTitle')}</h2>
          <p className="muted">
            {t('post.emailReadyText', { email: email ?? '', max: eligibility.quotaMax })}
          </p>
          <div className="auth-actions">
            <Link to="/employer" className="btn btn-primary btn-block">
              {t('post.goToDashboard')}
            </Link>
            <button type="button" className="btn btn-ghost btn-block" onClick={handleSignOut}>
              {t('employer.signOut')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
