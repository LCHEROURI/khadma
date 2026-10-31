import { useLang } from '../lib/i18n';
import { waLink } from '../lib/phone';
import { Icon } from './Icon';

export function WhatsAppButton({ phone }: { phone: string }) {
  const { t } = useLang();
  return (
    <a className="btn btn-whatsapp" href={waLink(phone, t('wa.message'))} target="_blank" rel="noopener noreferrer">
      <Icon name="whatsapp" size={22} />
      {t('gig.whatsapp')}
    </a>
  );
}
