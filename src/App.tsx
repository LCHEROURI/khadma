import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { LangProvider, useLang } from './lib/i18n';
import { Header } from './components/Header';
import { BottomNav } from './components/BottomNav';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Home } from './pages/Home';

const Browse = lazy(() => import('./pages/Browse').then((m) => ({ default: m.Browse })));
const Employer = lazy(() => import('./pages/Employer').then((m) => ({ default: m.Employer })));
const GigDetail = lazy(() => import('./pages/GigDetail').then((m) => ({ default: m.GigDetail })));
const PostGig = lazy(() => import('./pages/PostGig').then((m) => ({ default: m.PostGig })));
const Saved = lazy(() => import('./pages/Saved').then((m) => ({ default: m.Saved })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
const Admin = lazy(() => import('./pages/Admin').then((m) => ({ default: m.Admin })));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function RouteFallback() {
  const { t } = useLang();
  return (
    <div className="page">
      <p className="muted center">{t('common.loading')}</p>
    </div>
  );
}

export default function App() {
  return (
    <LangProvider>
      <BrowserRouter>
        <ScrollToTop />
        <div className="app">
          <Header />
          <main className="main">
            <ErrorBoundary>
              <Suspense fallback={<RouteFallback />}>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/jobs" element={<Browse mode="job" />} />
                  <Route path="/services" element={<Browse mode="service" />} />
                  <Route path="/listings" element={<Browse mode="all" />} />
                  <Route path="/employer" element={<Employer />} />
                  <Route path="/employer/post" element={<PostGig lockedType="job" />} />
                  <Route path="/services/post" element={<PostGig lockedType="service" />} />
                  <Route path="/gig/:id" element={<GigDetail />} />
                  <Route path="/post" element={<PostGig defaultType="job" />} />
                  <Route path="/saved" element={<Saved />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/admin" element={<Admin />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </main>
          <BottomNav />
        </div>
      </BrowserRouter>
    </LangProvider>
  );
}
