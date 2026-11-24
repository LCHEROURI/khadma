import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { auth } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { useLang } from '../lib/i18n';
import {
  ACTIVE_CITY,
  ACTIVE_WILAYA_CODE,
  CATEGORIES,
  MAX_PAY_DZD,
  MIN_TITLE_LENGTH,
  NEIGHBORHOODS
} from '../lib/constants';
import { callManageEmployerListing, getEmployerProfile, getGig } from '../lib/db';
import { isValidEmail, resolveEmployerEligibility, signOutEmployer } from '../lib/employerAuth';
import { formatNeighborhood } from '../lib/format';
import { normalizeDzPhone } from '../lib/phone';
import type { Category, ContactMethod, EmployerProfile, ListingType } from '../lib/types';
import { Banner } from '../components/Banner';
import { EmployerAuthPanel } from '../components/EmployerAuthPanel';

function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '');
  }
  return `idem_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function PostGig({
  defaultType = 'job',
  lockedType
}: {
  defaultType?: ListingType;
  lockedType?: ListingType;
}) {
  const { id: editGigId } = useParams<{ id?: string }>();
  const isEditMode = Boolean(editGigId);
  const { t } = useLang();
  const navigate = useNavigate();
  const {
    user,
    email,
    emailVerified,
    phoneNumber: authPhone,
    isAnonymous,
    isEmployer,
    loading: authLoading
  } = useAuth();

  const [profile, setProfile] = useState<EmployerProfile | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(isEditMode);
  const [editLoadError, setEditLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const idempotencyKeyRef = useRef(createIdempotencyKey());

  // Listing fields
  const [selectedType, setSelectedType] = useState<ListingType>(lockedType ?? defaultType);
  const listingType: ListingType = lockedType ?? selectedType;
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<Category>('construction');
  const [description, setDescription] = useState('');
  const [payMin, setPayMin] = useState('');
  const [payMax, setPayMax] = useState('');
  const [neighborhood, setNeighborhood] = useState(NEIGHBORHOODS[0]);

  // Explicit contact preferences & consent (registration email is NEVER auto-published)
  const [enableWhatsapp, setEnableWhatsapp] = useState(true);
  const [contactPhone, setContactPhone] = useState(authPhone ?? '');
  const [whatsappConsent, setWhatsappConsent] = useState(false);
  const [enableEmail, setEnableEmail] = useState(false);
  const [contactEmail, setContactEmail] = useState('');
  const [emailConsent, setEmailConsent] = useState(false);

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
    if (!editGigId || !user || !isEmployer) {
      setLoadingEdit(false);
      setEditLoadError(false);
      return;
    }
    let cancelled = false;
    setLoadingEdit(true);
    setEditLoadError(false);
    setErr('');
    getGig(editGigId)
      .then((g) => {
        if (cancelled) return;
        if (!g || g.posterUid !== user.uid) {
          setEditLoadError(true);
          setErr(t('common.error'));
          setLoadingEdit(false);
          return;
        }
        setTitle(g.title);
        setDescription(g.description);
        setCategory(g.category);
        if (g.listingType === 'job' || g.listingType === 'service') {
          setSelectedType(g.listingType);
        }
        setPayMin(String(g.payMin));
        setPayMax(String(g.payMax));
        setNeighborhood(g.neighborhood);
        setLoadingEdit(false);
      })
      .catch(() => {
        if (!cancelled) {
          setEditLoadError(true);
          setErr(t('common.error'));
          setLoadingEdit(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editGigId, user?.uid, isEmployer]);

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

    const methods: ContactMethod[] = [];
    if (!isEditMode) {
      if (enableWhatsapp) methods.push('whatsapp');
      if (enableEmail) methods.push('email');
      if (methods.length === 0) {
        setErr(t('post.contactMethodRequired'));
        return;
      }
      if (enableWhatsapp && (!whatsappConsent || !normalizeDzPhone(contactPhone))) {
        setErr(t('post.contactMethodRequired'));
        return;
      }
      if (enableEmail && (!emailConsent || !isValidEmail(contactEmail))) {
        setErr(t('post.contactMethodRequired'));
        return;
      }
    }

    setBusy(true);
    setErr('');
    try {
      if (isEditMode && editGigId) {
        await callManageEmployerListing({
          action: 'edit',
          gigId: editGigId,
          title: cleanTitle,
          description: cleanDesc,
          category,
          listingType,
          payMin: min,
          payMax: max,
          neighborhood,
          city: ACTIVE_CITY,
          wilayaCode: ACTIVE_WILAYA_CODE
        });
        navigate('/employer');
      } else {
        const res = await callManageEmployerListing({
          action: 'create',
          idempotencyKey: idempotencyKeyRef.current,
          title: cleanTitle,
          description: cleanDesc,
          category,
          listingType,
          payMin: min,
          payMax: max,
          neighborhood,
          city: ACTIVE_CITY,
          wilayaCode: ACTIVE_WILAYA_CODE,
          contactMethods: methods,
          ...(enableWhatsapp ? { contactPhone: contactPhone.trim(), whatsappConsent: true } : {}),
          ...(enableEmail ? { contactEmail: contactEmail.trim(), emailConsent: true } : {})
        });
        navigate(`/gig/${res.gigId}`, {
          state: { justPosted: true, pendingModeration: res.status === 'pending' }
        });
      }
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      if (code === 'functions/resource-exhausted') setErr(t('post.rateLimit'));
      else setErr(t('post.error'));
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    await signOutEmployer(auth);
  };

  const heading = isEditMode
    ? t('post.editTitle')
    : listingType === 'service'
      ? t('post.serviceTitle')
      : t('post.employerTitle');

  return (
    <div className="page">
      <Banner />
      <h1 className="page-title">{heading}</h1>
      {!isEditMode &&
        (lockedType ? (
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
        ))}

      {authLoading || loadingEdit ? (
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
          <EmployerAuthPanel />
        )
      ) : isEditMode && editLoadError ? (
        <div className="panel">
          <p className="form-error" role="alert">
            {err || t('common.error')}
          </p>
          <div className="center">
            <Link to="/employer" className="btn btn-primary">
              {t('post.goToDashboard')}
            </Link>
          </div>
        </div>
      ) : (
        <form
          className="panel"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void submit();
          }}
        >
          <div className="verified-banner">
            <span>✓</span>
            <span dir="ltr">{email ?? authPhone}</span>
          </div>
          <p className="remaining">
            {t('employer.quotaSummary', {
              used: profile?.activeCount ?? 0,
              max: eligibility.quotaMax
            })}
          </p>

          <h2>{isEditMode ? t('post.editTitle') : t('post.formTitle')}</h2>
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

          {!isEditMode && (
            <fieldset className="contact-prefs-fieldset">
              <legend>{t('post.contactSectionTitle')}</legend>

              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={enableWhatsapp}
                  onChange={(e) => setEnableWhatsapp(e.target.checked)}
                />
                <span>{t('post.contactMethodWhatsapp')}</span>
              </label>

              {enableWhatsapp && (
                <div className="contact-subfields">
                  <label className="field">
                    <span>{t('post.whatsappLabel')}</span>
                    <input
                      type="tel"
                      inputMode="tel"
                      dir="ltr"
                      placeholder={t('post.phonePlaceholder')}
                      value={contactPhone}
                      onChange={(e) => setContactPhone(e.target.value)}
                    />
                  </label>
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={whatsappConsent}
                      onChange={(e) => setWhatsappConsent(e.target.checked)}
                    />
                    <span>{t('post.contactWhatsappConsent')}</span>
                  </label>
                </div>
              )}

              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={enableEmail}
                  onChange={(e) => setEnableEmail(e.target.checked)}
                />
                <span>{t('post.contactMethodEmail')}</span>
              </label>

              {enableEmail && (
                <div className="contact-subfields">
                  <label className="field">
                    <span>{t('post.contactEmailLabel')}</span>
                    <input
                      type="email"
                      inputMode="email"
                      dir="ltr"
                      placeholder={t('post.contactEmailPlaceholder')}
                      value={contactEmail}
                      onChange={(e) => setContactEmail(e.target.value)}
                    />
                  </label>
                  <label className="checkbox-field">
                    <input
                      type="checkbox"
                      checked={emailConsent}
                      onChange={(e) => setEmailConsent(e.target.checked)}
                    />
                    <span>{t('post.contactEmailConsent')}</span>
                  </label>
                </div>
              )}
            </fieldset>
          )}

          {err && (
            <p className="form-error" role="alert">
              {err}
            </p>
          )}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? t('common.loading') : isEditMode ? t('post.saveChanges') : t('post.submit')}
          </button>
          <div className="center">
            <button type="button" className="btn btn-ghost" onClick={handleSignOut}>
              {t('employer.signOut')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
