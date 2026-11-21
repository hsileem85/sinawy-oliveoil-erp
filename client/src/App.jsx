import React, { useEffect, useState } from 'react';
import {
  Droplets,
  Factory,
  Globe,
  LayoutDashboard,
  LogOut,
  Menu,
  Plug,
  ShoppingBag,
  ShoppingCart,
} from 'lucide-react';
import { clearAuthSession, getStoredUser, getToken, restoreSession } from './api.js';
import { getSupabaseClient, isSupabaseMode } from './supabase.js';
import { t } from './i18n.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Purchases from './pages/Purchases.jsx';
import Bottling from './pages/Bottling.jsx';
import Sales from './pages/Sales.jsx';
import Integrations from './pages/Integrations.jsx';

export default function App() {
  const [lang, setLang] = useState(() => localStorage.getItem('sinawy_lang') || 'en');
  const [user, setUser] = useState(() => (getToken() ? getStoredUser() : null));
  const [booting, setBooting] = useState(() => isSupabaseMode());
  const [page, setPage] = useState('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    localStorage.setItem('sinawy_lang', lang);
  }, [lang]);

  useEffect(() => {
    const onExpired = () => setUser(null);
    window.addEventListener('sinawy-auth-expired', onExpired);

    let sub = null;
    if (isSupabaseMode()) {
      restoreSession()
        .then((u) => setUser(u))
        .finally(() => setBooting(false));

      const sb = getSupabaseClient();
      const { data } = sb.auth.onAuthStateChange((_event, session) => {
        if (!session) setUser(null);
      });
      sub = data?.subscription;
    }

    return () => {
      window.removeEventListener('sinawy-auth-expired', onExpired);
      sub?.unsubscribe();
    };
  }, []);

  function toggleLang() {
    setLang((prev) => (prev === 'en' ? 'ar' : 'en'));
  }

  function handleLogout() {
    clearAuthSession();
    setUser(null);
  }

  if (booting) {
    return (
      <main className="login-page">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <p>{t(lang, 'loading')}</p>
        </div>
      </main>
    );
  }

  if (!user) {
    return <Login lang={lang} onToggleLang={toggleLang} onSuccess={(u) => setUser(u)} />;
  }

  const navItems = [
    { id: 'dashboard', label: t(lang, 'navOverview'), icon: LayoutDashboard },
    { id: 'purchases', label: t(lang, 'navPurchases'), icon: ShoppingCart },
    { id: 'bottling', label: t(lang, 'navBottling'), icon: Factory },
    { id: 'sales', label: t(lang, 'navSales'), icon: ShoppingBag },
    { id: 'integrations', label: t(lang, 'navIntegrations'), icon: Plug },
  ];

  return (
    <div className="app-shell">
      <div
        className={`sidebar-backdrop ${mobileMenuOpen ? 'open' : ''}`}
        onClick={() => setMobileMenuOpen(false)}
      />

      <aside className={`sidebar ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-mark">
            <Droplets size={21} />
          </div>
          <div>
            <div className="brand-title">{t(lang, 'brandName')}</div>
            <div className="brand-sub">{t(lang, 'brandTagline')}</div>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Primary Navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={`nav-item ${page === item.id ? 'active' : ''}`}
                onClick={() => {
                  setPage(item.id);
                  setMobileMenuOpen(false);
                }}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-user-name">{user.name}</div>
            <div className="sidebar-user-email">{user.email}</div>
          </div>
          <button type="button" className="nav-item" onClick={handleLogout}>
            <LogOut size={16} />
            <span>{t(lang, 'logout')}</span>
          </button>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="mobile-menu-btn"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Toggle menu"
            >
              <Menu size={18} />
            </button>
            <a
              href="https://sinawy.net"
              target="_blank"
              rel="noreferrer"
              className="store-chip"
            >
              <Droplets size={14} />
              <span>{t(lang, 'storeDomain')}</span>
            </a>
          </div>

          <div className="topbar-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={toggleLang}>
              <Globe size={15} />
              {t(lang, 'langSwitch')}
            </button>
          </div>
        </header>

        <main className="page-content">
          {page === 'dashboard' && <Dashboard lang={lang} onNavigate={setPage} />}
          {page === 'purchases' && <Purchases lang={lang} />}
          {page === 'bottling' && <Bottling lang={lang} />}
          {page === 'sales' && <Sales lang={lang} />}
          {page === 'integrations' && <Integrations lang={lang} />}
        </main>
      </div>
    </div>
  );
}
