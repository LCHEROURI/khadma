import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { useLang } from '../lib/i18n';
import { LANGS } from '../lib/strings';
import { Icon } from '../components/Icon';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

export function Settings() {
  const { t, lang, setLang } = useLang();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [phone, setPhone] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const h = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);

  useEffect(() => {
    setPhone(auth.currentUser?.phoneNumber ?? null);
    return auth.onAuthStateChanged((u) => setPhone(u?.phoneNumber ?? null));
  }, []);

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    const choice = await deferred.userChoice;
    if (choice.outcome === 'accepted') setInstalled(true);
    setDeferred(null);
  };

  return (
    <div className="page">
      <h1 className="page-title">{t('settings.title')}</h1>

      <section className="settings-section">
        <h2 className="settings-heading">{t('settings.language')}</h2>
        <div className="lang-list">
          {LANGS.map((l) => (
            <button
              key={l.id}
              className={`lang-item${lang === l.id ? ' selected' : ''}`}
              onClick={() => setLang(l.id)}
            >
              <span>{l.label}</span>
              {lang === l.id && <Icon name="check" size={18} />}
            </button>
          ))}
        </div>
      </section>

      {deferred && (
        <section className="settings-section">
          <button className="btn btn-primary wide" onClick={install}>
            <Icon name="download" size={18} />
            {t('settings.install')}
          </button>
          {installed && <p className="muted center">{t('settings.installDone')}</p>}
        </section>
      )}

      {phone && (
        <section className="settings-section">
          <p className="muted">{t('post.verifiedAs', { phone })}</p>
          <button
            className="btn btn-ghost wide"
            onClick={async () => {
              await signOut(auth);
            }}
          >
            <Icon name="logout" size={18} />
            {t('settings.signout')}
          </button>
        </section>
      )}

      <section className="settings-section">
        <Link to="/admin" className="btn btn-ghost wide">
          {t('settings.admin')}
        </Link>
      </section>

      <section className="settings-section about">
        <h2 className="settings-heading">{t('settings.about')}</h2>
        <p>{t('settings.aboutText')}</p>
      </section>
    </div>
  );
}
