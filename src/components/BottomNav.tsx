import { NavLink } from 'react-router-dom';
import { useLang } from '../lib/i18n';
import { Icon } from './Icon';

const ITEMS = [
  { to: '/', icon: 'home', key: 'nav.browse' },
  { to: '/post', icon: 'plus', key: 'nav.post' },
  { to: '/saved', icon: 'bookmark', key: 'nav.saved' },
  { to: '/settings', icon: 'settings', key: 'nav.settings' }
];

export function BottomNav() {
  const { t } = useLang();
  return (
    <nav className="bottom-nav">
      {ITEMS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
        >
          <Icon name={item.icon} size={22} />
          <span>{t(item.key)}</span>
        </NavLink>
      ))}
    </nav>
  );
}
