import { Link } from 'react-router-dom';
import { useLang } from '../lib/i18n';
import { Banner } from '../components/Banner';
import { Icon } from '../components/Icon';

export function Home() {
  const { t } = useLang();

  return (
    <div className="page home-page">
      <section className="hero-card" aria-labelledby="home-hero-title">
        <div className="hero-top">
          <span className="hero-eyebrow">
            <Icon name="redStar" size={13} />
            {t('home.eyebrow')}
          </span>
          <Icon name="algeriaEmblem" size={34} className="hero-emblem" />
        </div>
        <h1 id="home-hero-title" className="hero-title">
          {t('home.heroTitle')}
        </h1>
        <p className="hero-subtitle">{t('home.heroSubtitle')}</p>
      </section>

      <Banner />

      <div className="journey-grid">
        <section className="journey-card journey-employer" aria-labelledby="journey-employer-title">
          <div className="journey-head">
            <span className="journey-icon journey-icon-green">
              <Icon name="briefcase" size={22} />
            </span>
            <h2 id="journey-employer-title" className="journey-title">
              {t('home.employerTitle')}
            </h2>
          </div>
          <p className="journey-desc">{t('home.employerDesc')}</p>
          <div className="journey-actions">
            <Link to="/employer/post" className="btn btn-primary btn-block">
              <Icon name="plus" size={18} />
              {t('home.employerCta')}
            </Link>
            <Link to="/employer" className="btn btn-soft-green btn-block">
              <Icon name="user" size={17} />
              {t('home.employerManage')}
            </Link>
          </div>
        </section>

        <section className="journey-card journey-seeker" aria-labelledby="journey-seeker-title">
          <div className="journey-head">
            <span className="journey-icon journey-icon-red">
              <Icon name="search" size={22} />
            </span>
            <h2 id="journey-seeker-title" className="journey-title">
              {t('home.seekerTitle')}
            </h2>
          </div>
          <p className="journey-desc">{t('home.seekerDesc')}</p>
          <div className="journey-actions">
            <Link to="/jobs" className="btn btn-accent-red btn-block">
              <Icon name="search" size={18} />
              {t('home.seekerCta')}
            </Link>
            <Link to="/saved" className="btn btn-soft-red btn-block">
              <Icon name="bookmark" size={17} />
              {t('home.seekerSaved')}
            </Link>
          </div>
        </section>
      </div>

      <section className="journey-card journey-services" aria-labelledby="journey-services-title">
        <div className="journey-head">
          <span className="journey-icon journey-icon-neutral">
            <Icon name="wrench" size={20} />
          </span>
          <h2 id="journey-services-title" className="journey-title">
            {t('home.servicesTitle')}
          </h2>
        </div>
        <p className="journey-desc">{t('home.servicesDesc')}</p>
        <div className="journey-actions journey-actions-row">
          <Link to="/services" className="btn btn-soft-green">
            {t('home.servicesBrowse')}
          </Link>
          <Link to="/services/post" className="btn btn-ghost">
            {t('home.servicesPost')}
          </Link>
        </div>
      </section>

      <div className="home-legacy-wrap">
        <Link to="/listings" className="home-legacy-link">
          {t('home.allListingsLink')}
        </Link>
      </div>
    </div>
  );
}
