import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { LangProvider } from './lib/i18n';
import { Header } from './components/Header';
import { BottomNav } from './components/BottomNav';
import { Browse } from './pages/Browse';
import { GigDetail } from './pages/GigDetail';
import { PostGig } from './pages/PostGig';
import { Saved } from './pages/Saved';
import { Settings } from './pages/Settings';
import { Admin } from './pages/Admin';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <LangProvider>
      <BrowserRouter>
        <ScrollToTop />
        <div className="app">
          <Header />
          <main className="main">
            <Routes>
              <Route path="/" element={<Browse />} />
              <Route path="/gig/:id" element={<GigDetail />} />
              <Route path="/post" element={<PostGig />} />
              <Route path="/saved" element={<Saved />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
          <BottomNav />
        </div>
      </BrowserRouter>
    </LangProvider>
  );
}
