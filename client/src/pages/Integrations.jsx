import React, { useEffect, useState } from 'react';
import { Check, Copy, Database, KeyRound, Play, Plug, Plus, RefreshCw } from 'lucide-react';
import { apiFetch } from '../api.js';
import { formatEGP, t } from '../i18n.js';

export default function Integrations({ lang }) {
  const [keys, setKeys] = useState([]);
  const [health, setHealth] = useState(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [copiedId, setCopiedId] = useState('');
  const [simResult, setSimResult] = useState(null);
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState('');

  const origin = window.location.origin;
  const sbBase = health?.supabase_url ? `${health.supabase_url}/functions/v1` : '';
  const webhookUrl = sbBase ? `${sbBase}/easyorders-webhook` : `${origin}/api/integrations/easyorders/webhook`;
  const stockFeedUrl = sbBase ? `${sbBase}/stock-feed` : `${origin}/api/integrations/stock`;

  async function loadAll() {
    setError('');
    try {
      const [kRes, hRes] = await Promise.all([
        apiFetch('/api/auth/api-keys'),
        apiFetch('/api/health'),
      ]);
      setKeys(kRes.keys);
      setHealth(hRes);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function copyText(id, text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(''), 1800);
    } catch {
      // ignore clipboard errors in restricted contexts
    }
  }

  async function createApiKey(e) {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    try {
      await apiFetch('/api/auth/api-keys', {
        method: 'POST',
        body: { name: newKeyName.trim() },
      });
      setNewKeyName('');
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  async function toggleKey(id) {
    try {
      await apiFetch(`/api/auth/api-keys/${id}/toggle`, { method: 'PATCH' });
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  async function simulateEasyOrders() {
    setSimulating(true);
    setError('');
    setSimResult(null);
    try {
      const res = await apiFetch('/api/integrations/easyorders/simulate', { method: 'POST' });
      setSimResult(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setSimulating(false);
    }
  }

  const activeKey = keys.find((k) => k.active)?.key_value || 'YOUR_ERP_API_KEY';

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t(lang, 'integrationsTitle')}</h1>
          <p className="page-subtitle">{t(lang, 'integrationsSubtitle')}</p>
        </div>
        <div className="header-actions">
          {health && (
            <span className="badge badge-olive" style={{ padding: '8px 14px', fontSize: 13 }}>
              <Database size={14} />
              {t(lang, 'dbEngine')}:{' '}
              {health.db_mode === 'supabase'
                ? 'Supabase (PostgreSQL)'
                : health.db_mode === 'postgres'
                  ? 'PostgreSQL (Remote)'
                  : 'PostgreSQL (PGlite)'}
            </span>
          )}
        </div>
      </div>

      {error && <div className="alert-banner error">{error}</div>}

      {simResult && (
        <div className="alert-banner success">
          <Check size={16} />
          <span>
            EasyOrders order <strong>{simResult.order.order_no}</strong> ({simResult.order.external_order_id}) synced —{' '}
            {formatEGP(simResult.order.total_amount, lang)} (Net profit: {formatEGP(simResult.order.net_profit, lang)}).
          </span>
        </div>
      )}

      <div className="equal-grid">
        {/* EasyOrders Webhook Card */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">
              <Plug size={17} />
              {t(lang, 'webhookCardTitle')}
            </h2>
            <span className="badge badge-gold">POST</span>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13.5 }}>{t(lang, 'webhookDesc')}</p>

            <div className="copy-row">
              <code>{webhookUrl}</code>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => copyText('wh', webhookUrl)}>
                {copiedId === 'wh' ? <Check size={14} /> : <Copy size={14} />}
                {copiedId === 'wh' ? t(lang, 'copied') : t(lang, 'copy')}
              </button>
            </div>

            <div>
              <button type="button" className="btn btn-gold" onClick={simulateEasyOrders} disabled={simulating}>
                <Play size={14} />
                {simulating ? t(lang, 'simulating') : t(lang, 'simulateBtn')}
              </button>
            </div>

            <pre className="code-block">{`# Example EasyOrders Webhook Test
curl -X POST "${webhookUrl}" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${activeKey}" \\
  -d '{
    "id": "EO-90125",
    "full_name": "Kareem Nabil",
    "phone": "01011223344",
    "government": "Cairo",
    "shipping_cost": 65,
    "payment_method": "cod",
    "cart_items": [
      { "product": { "sku": "SNW-EVOO-500G" }, "quantity": 2, "price": 390 }
    ]
  }'`}</pre>
          </div>
        </div>

        {/* Stock Sync Feed Card */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">
              <RefreshCw size={17} />
              {t(lang, 'stockFeedTitle')}
            </h2>
            <span className="badge badge-emerald">GET</span>
          </div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 13.5 }}>{t(lang, 'stockFeedDesc')}</p>

            <div className="copy-row">
              <code>{stockFeedUrl}</code>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => copyText('sf', stockFeedUrl)}>
                {copiedId === 'sf' ? <Check size={14} /> : <Copy size={14} />}
                {copiedId === 'sf' ? t(lang, 'copied') : t(lang, 'copy')}
              </button>
            </div>

            <pre className="code-block">{`# Pull Live Bottled Stock for sinawy.net / EasyOrders
curl -X GET "${stockFeedUrl}" \\
  -H "X-API-Key: ${activeKey}"

# All ERP endpoints also accept X-API-Key:
# GET  /api/dashboard/summary
# GET  /api/purchases/materials
# GET  /api/bottling/products
# POST /api/sales/orders`}</pre>
          </div>
        </div>
      </div>

      {/* API Keys Table */}
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">
            <KeyRound size={17} />
            {t(lang, 'apiKeysTitle')}
          </h2>
          <form onSubmit={createApiKey} style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              className="input"
              placeholder={t(lang, 'keyNamePlaceholder')}
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              style={{ width: 220 }}
            />
            <button type="submit" className="btn btn-primary btn-sm">
              <Plus size={14} />
              {t(lang, 'createKey')}
            </button>
          </form>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Key (X-API-Key)</th>
                <th>{t(lang, 'status')}</th>
                <th>{t(lang, 'actions')}</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td className="cell-main">{k.name}</td>
                  <td>
                    <code style={{ fontSize: 12.5 }}>{k.key_value}</code>
                  </td>
                  <td>
                    <span className={`badge ${k.active ? 'badge-emerald' : 'badge-clay'}`}>
                      {k.active ? t(lang, 'active') : t(lang, 'revoked')}
                    </span>
                  </td>
                  <td style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => copyText(`k-${k.id}`, k.key_value)}
                    >
                      {copiedId === `k-${k.id}` ? <Check size={13} /> : <Copy size={13} />}
                      {copiedId === `k-${k.id}` ? t(lang, 'copied') : t(lang, 'copy')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => toggleKey(k.id)}
                    >
                      {k.active ? t(lang, 'revoked') : t(lang, 'active')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
