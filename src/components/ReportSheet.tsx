import { useState } from 'react';
import { useLang } from '../lib/i18n';
import { reportGig } from '../lib/db';
import { REPORT_REASONS } from '../lib/constants';
import type { ReportReason } from '../lib/types';

const REPORTED_KEY = 'khadma-reported';

function getReported(): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(REPORTED_KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function ReportSheet({ gigId, onClose }: { gigId: string; onClose: () => void }) {
  const { t } = useLang();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState('');

  const already = getReported().includes(gigId);

  const submit = async () => {
    if (!reason) return;
    setBusy(true);
    setErr('');
    try {
      await reportGig(gigId, reason);
      localStorage.setItem(REPORTED_KEY, JSON.stringify([...getReported(), gigId]));
      setDone(true);
    } catch {
      setErr(t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2 className="sheet-title">{t('report.title')}</h2>
        {done ? (
          <div className="sheet-done">
            <div className="done-check">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            </div>
            <p>{t('gig.reportThanks')}</p>
            <button className="btn btn-primary" onClick={onClose}>
              {t('report.cancel')}
            </button>
          </div>
        ) : already ? (
          <div className="sheet-done">
            <p>{t('report.alreadyReported')}</p>
            <button className="btn btn-primary" onClick={onClose}>
              {t('report.cancel')}
            </button>
          </div>
        ) : (
          <>
            <p className="sheet-label">{t('report.reasonLabel')}</p>
            <div className="reason-list">
              {REPORT_REASONS.map((r) => (
                <button
                  key={r}
                  className={`reason-item${reason === r ? ' selected' : ''}`}
                  onClick={() => setReason(r)}
                >
                  {t(`report.reasons.${r}`)}
                </button>
              ))}
            </div>
            {err && <p className="form-error">{err}</p>}
            <div className="sheet-actions">
              <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
                {t('report.cancel')}
              </button>
              <button className="btn btn-danger" onClick={submit} disabled={!reason || busy}>
                {busy ? t('common.loading') : t('report.submit')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
