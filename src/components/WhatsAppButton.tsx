import { useState } from 'react';
import { useLang } from '../lib/i18n';
import { requestGigContactLink } from '../lib/db';
import { Icon } from './Icon';

function isCoarsePointer(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(pointer: coarse)').matches
    : false;
}

export function WhatsAppButton({ gigId }: { gigId: string }) {
  const { t, lang } = useLang();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    setErr('');

    // On desktop browsers, open a blank tab synchronously during user gesture (without
    // noopener in features so we retain a handle to detect popup blocking and avoid
    // desktop Safari double-navigation), then immediately null out opener.
    const mobile = isCoarsePointer();
    const popup = mobile ? null : window.open('', '_blank');
    if (popup) {
      popup.opener = null;
    }

    try {
      const waUrl = await requestGigContactLink(gigId, lang);
      if (popup && !popup.closed) {
        popup.location.replace(waUrl);
      } else {
        window.location.assign(waUrl);
      }
    } catch (e) {
      if (popup && !popup.closed) {
        popup.close();
      }
      const code = (e as { code?: string }).code ?? '';
      if (code === 'functions/resource-exhausted') {
        setErr(t('contact.rateLimit'));
      } else {
        setErr(t('common.error'));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button type="button" className="btn btn-whatsapp" onClick={handleClick} disabled={busy}>
        <Icon name="whatsapp" size={22} />
        {busy ? t('common.loading') : t('gig.whatsapp')}
      </button>
      {err && <p className="form-error">{err}</p>}
    </div>
  );
}
