import React, { useState } from 'react';
import { Database, Droplets, Globe, Lock, Settings, UserPlus } from 'lucide-react';
import { apiFetch, setAuthSession, signUpSupabase } from '../api.js';
import {
  getSupabaseConfig,
  isStaticHost,
  isSupabaseMode,
  saveLocalSupabaseConfig,
} from '../supabase.js';
import { t } from '../i18n.js';

export default function Login({ lang, onToggleLang, onSuccess }) {
  const sbConfigured = isSupabaseMode();
  const staticMode = isStaticHost();
  const initialCfg = getSupabaseConfig();

  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [name, setName] = useState('Sinawy Admin');
  const [email, setEmail] = useState(sbConfigured ? '' : 'admin@sinawy.net');
  const [password, setPassword] = useState(sbConfigured ? '' : 'sinawy2026');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  // Runtime Supabase connection panel (useful when opened on GitHub Pages before env vars are configured)
  const [showConfig, setShowConfig] = useState(staticMode && !sbConfigured);
  const [sbUrl, setSbUrl] = useState(initialCfg.url);
  const [sbAnon, setSbAnon] = useState(initialCfg.anonKey);

  function handleSaveSupabase(e) {
    e.preventDefault();
    saveLocalSupabaseConfig(sbUrl, sbAnon);
    window.location.reload();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setInfo('');
    if (staticMode && !isSupabaseMode()) {
      setShowConfig(true);
      setError(
        lang === 'ar'
          ? 'يرجى ربط مشروع Supabase أولاً بإدخال Project URL و Anon Key.'
          : 'Please connect your Supabase Project URL and Anon Key first.'
      );
      return;
    }

    setLoading(true);
    try {
      if (isSupabaseMode() && mode === 'signup') {
        const res = await signUpSupabase(email, password, name);
        if (res.user) {
          onSuccess(res.user);
        } else {
          setInfo(
            lang === 'ar'
              ? 'تم إنشاء الحساب! يرجى تأكيد البريد الإلكتروني ثم تسجيل الدخول.'
              : 'Account created! Please confirm your email (if enabled in Supabase Auth) and sign in.'
          );
          setMode('signin');
        }
      } else {
        const data = await apiFetch('/api/auth/login', {
          method: 'POST',
          body: { email, password },
        });
        setAuthSession(data.token, data.user);
        onSuccess(data.user);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setShowConfig((v) => !v)}
            title="Supabase Connection"
          >
            <Settings size={14} />
            {sbConfigured ? 'Supabase' : 'Connect DB'}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onToggleLang}>
            <Globe size={15} />
            {t(lang, 'langSwitch')}
          </button>
        </div>

        <div className="login-header">
          <div className="login-logo">
            <Droplets size={26} />
          </div>
          <h1 className="login-title">{t(lang, 'loginTitle')}</h1>
          <p className="login-sub">{t(lang, 'loginSubtitle')}</p>
        </div>

        {showConfig && (
          <form
            onSubmit={handleSaveSupabase}
            className="preview-box"
            style={{ marginTop: 0, marginBottom: 18, display: 'flex', flexDirection: 'column', gap: 10 }}
          >
            <div className="preview-box-title">
              <Database size={14} />
              {lang === 'ar' ? 'إعداد اتصال Supabase PostgreSQL' : 'Connect Supabase PostgreSQL'}
            </div>
            <input
              type="url"
              className="input"
              placeholder="https://xxxxx.supabase.co"
              value={sbUrl}
              onChange={(e) => setSbUrl(e.target.value)}
              required
            />
            <input
              type="text"
              className="input"
              placeholder="Supabase anon public key (eyJ...)"
              value={sbAnon}
              onChange={(e) => setSbAnon(e.target.value)}
              required
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" className="btn btn-primary btn-sm" style={{ flex: 1 }}>
                {lang === 'ar' ? 'حفظ والاتصال' : 'Save & Connect'}
              </button>
              {initialCfg.source === 'local' && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    saveLocalSupabaseConfig('', '');
                    window.location.reload();
                  }}
                >
                  {lang === 'ar' ? 'مسح' : 'Clear'}
                </button>
              )}
            </div>
          </form>
        )}

        {error && <div className="alert-banner error">{error}</div>}
        {info && <div className="alert-banner success">{info}</div>}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {sbConfigured && mode === 'signup' && (
            <div className="form-field">
              <label className="form-label" htmlFor="login-name">
                {lang === 'ar' ? 'الاسم' : 'Full Name'}
              </label>
              <input
                id="login-name"
                type="text"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
          )}

          <div className="form-field">
            <label className="form-label" htmlFor="login-email">
              {t(lang, 'email')}
            </label>
            <input
              id="login-email"
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@sinawy.net"
              required
              autoComplete="email"
            />
          </div>

          <div className="form-field">
            <label className="form-label" htmlFor="login-password">
              {t(lang, 'password')}
            </label>
            <input
              id="login-password"
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            />
          </div>

          <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%', padding: '11px' }}>
            {mode === 'signup' ? <UserPlus size={15} /> : <Lock size={15} />}
            {loading
              ? t(lang, 'signingIn')
              : mode === 'signup'
                ? lang === 'ar'
                  ? 'إنشاء حساب المدير'
                  : 'Create Admin Account'
                : t(lang, 'signIn')}
          </button>
        </form>

        {sbConfigured ? (
          <div style={{ marginTop: 14, textAlign: 'center' }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setMode((m) => (m === 'signin' ? 'signup' : 'signin'))}
            >
              {mode === 'signin'
                ? lang === 'ar'
                  ? 'أول مرة؟ إنشاء حساب مدير جديد على Supabase'
                  : 'First time? Create your Supabase admin account'
                : lang === 'ar'
                  ? 'لديك حساب بالفعل؟ تسجيل الدخول'
                  : 'Already have an account? Sign In'}
            </button>
          </div>
        ) : (
          <div className="login-hint">{t(lang, 'demoCredentials')}</div>
        )}
      </div>
    </main>
  );
}
