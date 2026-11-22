import { useLang } from '../lib/i18n';
import { gigContactLink } from '../lib/phone';
import { Icon } from './Icon';

export function WhatsAppButton({ gigId }: { gigId: string }) {
  const { t, lang } = useLang();
  return (
    <a
      className="btn btn-whatsapp"
      href={gigContactLink(gigId, lang)}
      target="_blank"
      rel="noopener noreferrer"
    >
      <Icon name="whatsapp" size={22} />
      {t('gig.whatsapp')}
    </a>
  );
}
