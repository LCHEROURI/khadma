import { useNavigate } from 'react-router-dom';
import { useLang } from '../lib/i18n';
import { Banner } from '../components/Banner';
import { EmployerAuthPanel } from '../components/EmployerAuthPanel';

export function EmployerAuth() {
  const { t } = useLang();
  const navigate = useNavigate();

  return (
    <div className="page">
      <Banner />
      <h1 className="page-title">{t('auth.title')}</h1>
      <p className="page-subtitle">{t('auth.subtitle')}</p>
      <EmployerAuthPanel onVerified={() => navigate('/employer')} />
    </div>
  );
}
