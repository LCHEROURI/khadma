import { Link } from 'react-router-dom';
import { useLang } from '../lib/i18n';

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
      <rect width="512" height="512" rx="112" fill="#087B52" />
      <rect x="144" y="92" width="80" height="328" rx="26" fill="#ffffff" />
      <path d="M224 96 L388 96 L224 234 Z" fill="#ffffff" />
      <path d="M224 254 L376 424 L224 424 Z" fill="#ffffff" />
      <circle cx="416" cy="112" r="40" fill="#D32235" />
    </svg>
  );
}

export function Header() {
  const { t, lang, setLang } = useLang();
  return (
    <header className="header">
      <div className="header-inner">
        <Link to="/" className="header-brand">
          <Logo size={32} />
          <div className="header-text">
            <div className="header-name">{t('appName')}</div>
            <div className="header-tag">{t('tagline')}</div>
          </div>
        </Link>
        <div className="lang-toggle" role="group" aria-label={t('lang.switchLabel')}>
          <button
            type="button"
            className={`lang-toggle-btn${lang === 'fr' ? ' active' : ''}`}
            aria-pressed={lang === 'fr'}
            lang="fr"
            onClick={() => setLang('fr')}
          >
            FR
          </button>
          <span className="lang-toggle-sep" aria-hidden="true">|</span>
          <button
            type="button"
            className={`lang-toggle-btn${lang === 'ar' ? ' active' : ''}`}
            aria-pressed={lang === 'ar'}
            lang="ar"
            onClick={() => setLang('ar')}
          >
            العربية
          </button>
        </div>
      </div>
    </header>
  );
}
