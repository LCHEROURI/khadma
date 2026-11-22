import { useState } from 'react';
import { useLang } from '../lib/i18n';
import { requestGigContactLink } from '../lib/db';
import { Icon } from './Icon';

export function WhatsAppButton({ gigId }: { gigId: string }) {
  const { t, lang } = useLang();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      const waUrl = await requestGigContactLink(gigId, lang);
      const opened = window.open(waUrl, '_blank', 'noopener,noreferrer');
      if (!opened) {
        // Mobile Safari/Chrome fallback when async window.open is blocked.
        window.location.assign(waUrl);
      }
    } catch (e) {
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
