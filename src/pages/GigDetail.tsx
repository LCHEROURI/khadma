import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useLang } from '../lib/i18n';
import { getGig } from '../lib/db';
import { formatNeighborhood, formatPay, timeAgo } from '../lib/format';
import { isGigExpired } from '../lib/expiration';
import { isSaved, toggleSaved } from '../lib/db';
import type { Gig } from '../lib/types';
import { Banner } from '../components/Banner';
import { ContactButtons } from '../components/ContactButtons';
import { ReportSheet } from '../components/ReportSheet';
import { Icon } from '../components/Icon';

export function GigDetail() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLang();
  const [gig, setGig] = useState<Gig | null>(null);
  const [missing, setMissing] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [justPosted, setJustPosted] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!id) return;
    getGig(id)
      .then((g) => {
        if (!g) setMissing(true);
        else {
          setGig(g);
          setSaved(isSaved(g.id));
        }
      })
      .catch(() => setMissing(true));
  }, [id]);

  useEffect(() => {
    const st = (window.history.state as { usr?: { justPosted?: boolean } } | null)?.usr;
    if (!st?.justPosted) return;
    setJustPosted(true);
    const timer = window.setTimeout(() => setJustPosted(false), 5000);
    return () => window.clearTimeout(timer);
  }, []);

  if (missing) {
    return (
      <div className="page">
        <p className="muted center">{t('common.error')}</p>
        <div className="center">
          <Link to="/" className="btn btn-primary">{t('detail.back')}</Link>
        </div>
      </div>
    );
  }

  if (!gig) {
    return (
      <div className="page">
        <p className="muted center">{t('common.loading')}</p>
      </div>
    );
  }

  const hidden = gig.status === 'hidden';
  const removed = gig.status === 'removed';
  const expired = gig.status === 'expired' || isGigExpired(gig, nowMs);
  const canContact = gig.status === 'active' && !expired;

  return (
    <div className="page">
      <Link to="/" className="back-link">
        <Icon name="arrowLeft" size={18} />
        {t('detail.back')}
      </Link>
      {justPosted && <div className="toast">{t('post.success')}</div>}
      <Banner />

      <div className="detail-card">
        <div className="card-chips">
          <span className={`chip chip-type-${gig.listingType ?? 'legacy'}`}>
            {t(`listingType.${gig.listingType ?? 'legacy'}`)}
          </span>
          <span className="chip">{t(`categories.${gig.category}`)}</span>
          <span className="chip chip-neigh">{formatNeighborhood(gig.neighborhood, t)}</span>
          {gig.isSample && <span className="chip chip-sample">{t('gig.sampleBadge')}</span>}
          {gig.verified && (
            <span className="verified">
              <Icon name="shield" size={13} />
              {t('gig.verifiedBadge')}
            </span>
          )}
        </div>
        <h1 className="detail-title">{gig.title}</h1>
        <div className="detail-pay">{formatPay(gig.payMin, gig.payMax, t('common.currency'))}</div>
        <p className="detail-desc">{gig.description}</p>
        <div className="detail-meta">{timeAgo(gig, t)}</div>

        {hidden && <div className="status-note">{t('detail.statusHiddenNote')}</div>}
        {removed && <div className="status-note">{t('detail.statusRemovedNote')}</div>}
        {expired && <div className="status-note">{t('detail.statusExpiredNote')}</div>}
        {gig.isSample && <div className="status-note sample-note">{t('detail.sampleNote')}</div>}

        {gig.isSample ? (
          <p className="muted">{t('gig.whatsappSampleNote')}</p>
        ) : canContact ? (
          <ContactButtons gigId={gig.id} contactMethods={gig.contactMethods} />
        ) : null}

        <div className="detail-actions">
          <button
            className={`btn btn-ghost${saved ? ' saved' : ''}`}
            onClick={() => setSaved(toggleSaved(gig.id))}
          >
            <Icon name="bookmark" size={18} />
            {saved ? t('gig.saved') : t('gig.save')}
          </button>
          {canContact && (
            <button className="btn btn-ghost" onClick={() => setReporting(true)}>
              <Icon name="flag" size={18} />
              {t('gig.report')}
            </button>
          )}
        </div>
      </div>

      {reporting && <ReportSheet gigId={gig.id} onClose={() => setReporting(false)} />}
    </div>
  );
}
