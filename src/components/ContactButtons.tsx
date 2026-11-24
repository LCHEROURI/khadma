import { useRef, useState } from 'react';
import { useLang } from '../lib/i18n';
import { requestGigContactLink } from '../lib/db';
import { resolveEnabledContactMethods } from '../lib/contactLink';
import type { ContactMethod } from '../lib/types';
import { Icon } from './Icon';

function isCoarsePointer(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)').matches
    : false;
}

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
  const [fallbackLink, setFallbackLink] = useState<{ channel: ContactMethod; url: string } | null>(null);
  const inFlightRef = useRef(false);

  const methods = resolveEnabledContactMethods(contactMethods);
  if (methods.length === 0) {
    return <p className="muted">{t('contact.unavailable')}</p>;
  }

  const handleContact = async (channel: ContactMethod) => {
    if (inFlightRef.current || busyChannel !== null) return;
    inFlightRef.current = true;
    setBusyChannel(channel);
    setErr('');
    setFailedChannel(null);
    setFallbackLink(null);

    const mobile = isCoarsePointer();
    const popup = channel === 'whatsapp' && !mobile ? window.open('', '_blank') : null;
    if (popup) {
      popup.opener = null;
    }

    try {
      const url = await requestGigContactLink(gigId, lang, channel);
      // Always expose a safe direct fallback link in case the browser blocks external app launch.
      setFallbackLink({ channel, url });
      if (popup && !popup.closed) {
        popup.location.replace(url);
      } else {
        window.location.assign(url);
      }
    } catch (e) {
      if (popup && !popup.closed) {
        popup.close();
      }
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

      {fallbackLink && !err && (
        <p className="contact-fallback muted small">
          <a
            href={fallbackLink.url}
            target={fallbackLink.channel === 'whatsapp' ? '_blank' : undefined}
            rel={fallbackLink.channel === 'whatsapp' ? 'noopener noreferrer' : undefined}
          >
            {fallbackLink.channel === 'whatsapp'
              ? t('contact.openWhatsappFallback')
              : t('contact.openEmailFallback')}
          </a>
        </p>
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
    </div>
  );
}
