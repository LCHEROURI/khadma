import { Link, useLocation } from 'react-router-dom';
import { useLang } from '../lib/i18n';
import { Icon } from './Icon';

interface NavItem {
  to: string;
  icon: string;
  key: string;
  matches: (pathname: string) => boolean;
}

const ITEMS: NavItem[] = [
  {
    to: '/',
    icon: 'home',
    key: 'nav.home',
    matches: (p) => p === '/'
  },
  {
    to: '/jobs',
    icon: 'briefcase',
    key: 'nav.jobs',
    matches: (p) => p === '/jobs' || p === '/listings' || p.startsWith('/gig/')
  },
  {
    to: '/services',
    icon: 'wrench',
    key: 'nav.services',
    matches: (p) => p === '/services' || p === '/services/post'
  },
  {
    to: '/employer',
    icon: 'plus',
    key: 'nav.employer',
    matches: (p) => p === '/employer' || p === '/employer/post' || p === '/post'
  },
  {
    to: '/settings',
    icon: 'settings',
    key: 'nav.settings',
    matches: (p) => p === '/settings' || p === '/saved' || p === '/admin'
  }
];

export function BottomNav() {
  const { t } = useLang();
  const { pathname } = useLocation();

  return (
    <nav className="bottom-nav" aria-label={t('nav.label')}>
      <div className="bottom-nav-inner">
        {ITEMS.map((item) => {
          const active = item.matches(pathname);
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? 'page' : undefined}
              className={`nav-item${active ? ' active' : ''}`}
            >
              <Icon name={item.icon} size={20} />
              <span className="nav-label">{t(item.key)}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
