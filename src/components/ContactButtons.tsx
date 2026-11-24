import { useEffect, useRef, useState } from 'react';
import { useLang } from '../lib/i18n';
import { requestGigContactLink } from '../lib/db';
import {
  buildGmailComposeUrl,
  parseMailtoUrl,
  resolveEnabledContactMethods
} from '../lib/contactLink';
import type { ContactMethod } from '../lib/types';
import { Icon } from './Icon';

export function ContactButtons({
  gigId,
  contactMethods
}: {
  gigId: string;
  contactMethods?: readonly ContactMethod[] | null;
}) {
  const { t, lang } = useLang();
  const [busyChannel, setBusyChannel] = useState<ContactMethod | null>(null);
  const [err, setErr] = useState('');
  const [failedChannel, setFailedChannel] = useState<ContactMethod | null>(null);
  // Session-local, memory-only cache per gig mount so repeated clicks do not fire duplicate callable calls.
  const [cachedUrls, setCachedUrls] = useState<Partial<Record<ContactMethod, string>>>({});
  const [activeSheet, setActiveSheet] = useState<ContactMethod | null>(null);
  const [copied, setCopied] = useState(false);
  const [showCopyFallback, setShowCopyFallback] = useState(false);
  const inFlightRef = useRef(false);

  useEffect(() => {
    setCachedUrls({});
    setActiveSheet(null);
    setCopied(false);
    setShowCopyFallback(false);
    setErr('');
    setFailedChannel(null);
  }, [gigId]);

  useEffect(() => {
    if (!activeSheet) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActiveSheet(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeSheet]);

  const methods = resolveEnabledContactMethods(contactMethods);
  if (methods.length === 0) {
    return <p className="muted">{t('contact.unavailable')}</p>;
  }

  const closeSheet = () => {
    setActiveSheet(null);
  };

  const handleContact = async (channel: ContactMethod) => {
    if (inFlightRef.current || busyChannel !== null) return;
    setErr('');
    setFailedChannel(null);
    setCopied(false);
    setShowCopyFallback(false);

    if (cachedUrls[channel]) {
      setActiveSheet(channel);
      return;
    }

    inFlightRef.current = true;
    setBusyChannel(channel);

    try {
      const url = await requestGigContactLink(gigId, lang, channel);
      setCachedUrls((prev) => ({ ...prev, [channel]: url }));
      setActiveSheet(channel);
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      setFailedChannel(channel);
      if (code === 'functions/resource-exhausted') {
        setErr(t('contact.rateLimit'));
      } else if (code === 'functions/not-found') {
        setErr(t('contact.unavailable'));
      } else {
        setErr(t('contact.error'));
      }
    } finally {
      inFlightRef.current = false;
      setBusyChannel(null);
    }
  };

  const waUrl = cachedUrls.whatsapp ?? null;
  const emailUrl = cachedUrls.email ?? null;
  const parsedEmail = emailUrl ? parseMailtoUrl(emailUrl) : null;
  const gmailUrl = emailUrl ? buildGmailComposeUrl(emailUrl) : null;

  const handleCopyEmail = async () => {
    if (!parsedEmail) return;
    setCopied(false);
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(parsedEmail.to);
        setCopied(true);
        setShowCopyFallback(false);
        return;
      }
    } catch {
      // Fallback below displays a selectable read-only field when clipboard access is denied.
    }
    setShowCopyFallback(true);
  };

  return (
    <div className="contact-buttons">
      {methods.includes('whatsapp') && (
        <button
          type="button"
          className="btn btn-whatsapp btn-block"
          onClick={() => void handleContact('whatsapp')}
          disabled={busyChannel !== null}
          aria-busy={busyChannel === 'whatsapp'}
        >
          <Icon name="whatsapp" size={22} />
          {busyChannel === 'whatsapp' ? t('common.loading') : t('gig.whatsapp')}
        </button>
      )}

      {methods.includes('email') && (
        <button
          type="button"
          className="btn btn-soft-green btn-block"
          onClick={() => void handleContact('email')}
          disabled={busyChannel !== null}
          aria-busy={busyChannel === 'email'}
        >
          <Icon name="mail" size={20} />
          {busyChannel === 'email' ? t('common.loading') : t('gig.email')}
        </button>
      )}

      {err && (
        <div className="load-more-error" role="alert">
          <p className="form-error">{err}</p>
          {failedChannel && (
            <button
              type="button"
              className="btn btn-ghost btn-small"
              disabled={busyChannel !== null}
              onClick={() => void handleContact(failedChannel)}
            >
              {t('common.retry')}
            </button>
          )}
        </div>
      )}

      {activeSheet === 'whatsapp' && waUrl && (
        <div
          className="sheet-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeSheet();
          }}
        >
          <div
            className="contact-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="contact-sheet-title"
          >
            <h2 id="contact-sheet-title" className="contact-sheet-title">
              {t('contact.waSheetTitle')}
            </h2>
            <p className="muted contact-sheet-body">{t('contact.waSheetBody')}</p>
            <div className="contact-sheet-actions">
              <a
                href={waUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-whatsapp btn-block"
              >
                <Icon name="whatsapp" size={20} />
                {t('contact.waSheetContinue')}
              </a>
              <button
                type="button"
                className="btn btn-ghost btn-block"
                onClick={closeSheet}
              >
                {t('contact.backToListing')}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeSheet === 'email' && emailUrl && parsedEmail && (
        <div
          className="sheet-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeSheet();
          }}
        >
          <div
            className="contact-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="contact-sheet-title"
          >
            <h2 id="contact-sheet-title" className="contact-sheet-title">
              {t('contact.emailSheetTitle')}
            </h2>
            <p className="muted contact-sheet-body">{t('contact.emailSheetSubtitle')}</p>
            <div className="contact-sheet-actions">
              <a href={emailUrl} className="btn btn-primary btn-block">
                <Icon name="mail" size={18} />
                {t('contact.emailSheetMailApp')}
              </a>
              {gmailUrl && (
                <a
                  href={gmailUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-soft-green btn-block"
                >
                  <Icon name="mail" size={18} />
                  {t('contact.emailSheetGmail')}
                </a>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-block"
                onClick={() => void handleCopyEmail()}
              >
                {t('contact.emailSheetCopy')}
              </button>

              {copied && (
                <p className="status-note contact-copy-status" role="status">
                  {t('contact.emailCopied')}
                </p>
              )}

              {showCopyFallback && (
                <div className="contact-copy-fallback">
                  <p className="muted small">{t('contact.emailCopyFallbackHint')}</p>
                  <input
                    type="text"
                    readOnly
                    dir="ltr"
                    className="contact-copy-input"
                    value={parsedEmail.to}
                    aria-label={t('contact.emailSheetCopy')}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </div>
              )}

              <button
                type="button"
                className="btn btn-ghost btn-block"
                onClick={closeSheet}
              >
                {t('contact.backToListing')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
