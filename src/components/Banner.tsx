import { useLang } from '../lib/i18n';
import { Icon } from './Icon';

export function Banner() {
  const { t } = useLang();
  return (
    <div className="banner" role="note">
      <Icon name="warn" size={18} />
      <span>{t('banner.text')}</span>
    </div>
  );
}
