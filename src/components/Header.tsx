import { useLang } from '../lib/i18n';

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
      <rect width="512" height="512" rx="112" fill="#0b6e69" />
      <rect x="144" y="92" width="80" height="328" rx="26" fill="#ffffff" />
      <path d="M224 96 L388 96 L224 234 Z" fill="#ffffff" />
      <path d="M224 254 L376 424 L224 424 Z" fill="#ffffff" />
      <circle cx="416" cy="112" r="40" fill="#f59e0b" />
    </svg>
  );
}

export function Header() {
  const { t } = useLang();
  return (
    <header className="header">
      <div className="header-inner">
        <Logo size={32} />
        <div className="header-text">
          <div className="header-name">KHADMA</div>
          <div className="header-tag">{t('tagline')}</div>
        </div>
      </div>
    </header>
  );
}
