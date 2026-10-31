import { Link } from 'react-router-dom';
import { useLang } from '../lib/i18n';
import { formatPay, timeAgo } from '../lib/format';
import type { Gig } from '../lib/types';
import { Icon } from './Icon';

export function GigCard({ gig }: { gig: Gig }) {
  const { t } = useLang();
  return (
    <Link to={`/gig/${gig.id}`} className="card">
      <div className="card-chips">
        <span className="chip">{t(`categories.${gig.category}`)}</span>
        <span className="chip chip-neigh">{gig.neighborhood}</span>
      </div>
      <h3 className="card-title">{gig.title}</h3>
      <div className="card-pay">{formatPay(gig.payMin, gig.payMax)}</div>
      <div className="card-meta">
        <span className="meta-item">{timeAgo(gig, t)}</span>
        {gig.verified && (
          <span className="verified">
            <Icon name="shield" size={13} />
            {t('gig.verifiedBadge')}
          </span>
        )}
        {gig.isSample && <span className="chip chip-sample">{t('gig.sampleBadge')}</span>}
      </div>
    </Link>
  );
}
