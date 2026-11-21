import { createClient } from '@supabase/supabase-js';

const LS_URL_KEY = 'sinawy_supabase_url';
const LS_ANON_KEY = 'sinawy_supabase_anon_key';

let cachedClient = null;
let cachedSignature = '';

export function getSupabaseConfig() {
  const envUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim();
  const envKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
  if (envUrl && envKey) {
    return { url: envUrl.replace(/\/+$/, ''), anonKey: envKey, source: 'env' };
  }

  const lsUrl = (localStorage.getItem(LS_URL_KEY) || '').trim();
  const lsKey = (localStorage.getItem(LS_ANON_KEY) || '').trim();
  if (lsUrl && lsKey) {
    return { url: lsUrl.replace(/\/+$/, ''), anonKey: lsKey, source: 'local' };
  }

  return { url: '', anonKey: '', source: 'none' };
}

export function saveLocalSupabaseConfig(url, anonKey) {
  const cleanUrl = String(url || '').trim().replace(/\/+$/, '');
  const cleanKey = String(anonKey || '').trim();
  if (cleanUrl && cleanKey) {
    localStorage.setItem(LS_URL_KEY, cleanUrl);
    localStorage.setItem(LS_ANON_KEY, cleanKey);
  } else {
    localStorage.removeItem(LS_URL_KEY);
    localStorage.removeItem(LS_ANON_KEY);
  }
  cachedClient = null;
  cachedSignature = '';
}

export function isSupabaseMode() {
  const cfg = getSupabaseConfig();
  return Boolean(cfg.url && cfg.anonKey);
}

export function isStaticHost() {
  return (
    window.location.hostname.endsWith('github.io') ||
    import.meta.env.VITE_HOST_MODE === 'static'
  );
}

export function getSupabaseClient() {
  const cfg = getSupabaseConfig();
  if (!cfg.url || !cfg.anonKey) return null;
  const sig = `${cfg.url}|${cfg.anonKey}`;
  if (cachedClient && cachedSignature === sig) return cachedClient;
  cachedClient = createClient(cfg.url, cfg.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });
  cachedSignature = sig;
  return cachedClient;
}
