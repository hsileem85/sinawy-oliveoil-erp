import React, { useEffect, useState } from 'react';
import { Download, Megaphone, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import { apiFetch, downloadCsv } from '../api.js';
import { formatEGP, pickName, t } from '../i18n.js';
import Modal from '../components/Modal.jsx';

export default function Sales({ lang }) {
  const [tab, setTab] = useState('orders');
  const [channelFilter, setChannelFilter] = useState('all');
  const [orders, setOrders] = useState([]);
  const [products, setProducts] = useState([]);
  const [adSpend, setAdSpend] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showOrderModal, setShowOrderModal] = useState(false);
  const [showAdModal, setShowAdModal] = useState(false);
  const [saving, setSaving] = useState(false);

  const [oForm, setOForm] = useState({
    order_date: new Date().toISOString().slice(0, 10),
    channel: 'phone_offline',
    social_platform: 'facebook',
    campaign_name: '',
    customer_name: '',
    customer_phone: '',
    city: 'Cairo',
    address: '',
    payment_method: 'cod',
    order_status: 'confirmed',
    discount: '0',
    shipping_charged: '65',
    shipping_actual_cost: '55',
    notes: '',
    items: [],
  });

  const [adForm, setAdForm] = useState({
    spend_date: new Date().toISOString().slice(0, 10),
    platform: 'facebook',
    campaign_name: '',
    amount: '',
    notes: '',
  });

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      const [oRes, pRes, aRes] = await Promise.all([
        apiFetch('/api/sales/orders'),
        apiFetch('/api/bottling/products'),
        apiFetch('/api/sales/ad-spend'),
      ]);
      setOrders(oRes.orders);
      setProducts(pRes.products);
      setAdSpend(aRes.ad_spend);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  function openNewOrder() {
    const first = products.find((p) => p.stock_qty > 0) || products[0];
    setOForm({
      order_date: new Date().toISOString().slice(0, 10),
      channel: 'phone_offline',
      social_platform: 'facebook',
      campaign_name: '',
      customer_name: '',
      customer_phone: '',
      city: 'Cairo',
      address: '',
      payment_method: 'cod',
      order_status: 'confirmed',
      discount: '0',
      shipping_charged: '65',
      shipping_actual_cost: '55',
      notes: '',
      items: first
        ? [{ finished_product_id: String(first.id), quantity: 1, unit_price: String(first.retail_price) }]
        : [],
    });
    setShowOrderModal(true);
  }

  function addLineItem() {
    const first = products[0];
    if (!first) return;
    setOForm((prev) => ({
      ...prev,
      items: [
        ...prev.items,
        { finished_product_id: String(first.id), quantity: 1, unit_price: String(first.retail_price) },
      ],
    }));
  }

  function updateLineItem(idx, patch) {
    setOForm((prev) => {
      const next = [...prev.items];
      next[idx] = { ...next[idx], ...patch };
      if (patch.finished_product_id) {
        const p = products.find((x) => String(x.id) === String(patch.finished_product_id));
        if (p) next[idx].unit_price = String(p.retail_price);
      }
      return { ...prev, items: next };
    });
  }

  function removeLineItem(idx) {
    setOForm((prev) => ({
      ...prev,
      items: prev.items.filter((_, i) => i !== idx),
    }));
  }

  // Live order profit preview
  let pSubtotal = 0;
  let pCogs = 0;
  for (const li of oForm.items) {
    const prod = products.find((p) => String(p.id) === String(li.finished_product_id));
    const q = Math.max(0, Number(li.quantity) || 0);
    pSubtotal += q * (Number(li.unit_price) || 0);
    pCogs += q * Number(prod?.unit_cogs || 0);
  }
  const pDisc = Number(oForm.discount) || 0;
  const pShipCharged = Number(oForm.shipping_charged) || 0;
  const pShipActual = Number(oForm.shipping_actual_cost) || 0;
  const pTotal = pSubtotal - pDisc + pShipCharged;
  const pNetProfit = pSubtotal - pDisc - pCogs + (pShipCharged - pShipActual);

  async function submitOrder(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiFetch('/api/sales/orders', {
        method: 'POST',
        body: {
          ...oForm,
          discount: pDisc,
          shipping_charged: pShipCharged,
          shipping_actual_cost: pShipActual,
          payment_status:
            oForm.payment_method === 'cod'
              ? 'cod_pending'
              : oForm.payment_method === 'credit'
                ? 'unpaid'
                : 'paid',
          items: oForm.items.map((li) => ({
            finished_product_id: Number(li.finished_product_id),
            quantity: Number(li.quantity),
            unit_price: Number(li.unit_price),
          })),
        },
      });
      setShowOrderModal(false);
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function updateOrderStatus(orderId, nextStatus) {
    setError('');
    try {
      await apiFetch(`/api/sales/orders/${orderId}`, {
        method: 'PATCH',
        body: { order_status: nextStatus },
      });
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  async function submitAdSpend(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiFetch('/api/sales/ad-spend', {
        method: 'POST',
        body: { ...adForm, amount: Number(adForm.amount) },
      });
      setShowAdModal(false);
      setAdForm({ spend_date: new Date().toISOString().slice(0, 10), platform: 'facebook', campaign_name: '', amount: '', notes: '' });
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteAdSpend(id) {
    try {
      await apiFetch(`/api/sales/ad-spend/${id}`, { method: 'DELETE' });
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  const filteredOrders =
    channelFilter === 'all' ? orders : orders.filter((o) => o.channel === channelFilter);

  const totalAdSpendSum = adSpend.reduce((s, a) => s + Number(a.amount || 0), 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t(lang, 'salesTitle')}</h1>
          <p className="page-subtitle">{t(lang, 'salesSubtitle')}</p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => downloadCsv('/api/sales/export/csv', 'sinawy-sales-orders.csv')}
          >
            <Download size={15} />
            {t(lang, 'btnExportCsv')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setShowAdModal(true)}>
            <Megaphone size={15} />
            {t(lang, 'btnAddAdSpend')}
          </button>
          <button type="button" className="btn btn-primary" onClick={openNewOrder}>
            <Plus size={15} />
            {t(lang, 'btnNewOrder')}
          </button>
        </div>
      </div>

      {error && <div className="alert-banner error">{error}</div>}

      <div className="tabs-bar">
        <button type="button" className={`tab-btn ${tab === 'orders' ? 'active' : ''}`} onClick={() => setTab('orders')}>
          {t(lang, 'tabOrders')} ({orders.length})
        </button>
        <button type="button" className={`tab-btn ${tab === 'ads' ? 'active' : ''}`} onClick={() => setTab('ads')}>
          {t(lang, 'tabAdSpend')} ({formatEGP(totalAdSpendSum, lang)})
        </button>
      </div>

      {tab === 'orders' && (
        <div>
          <div className="filter-pills">
            {['all', 'online_store', 'phone_offline', 'social_ads'].map((c) => (
              <button
                key={c}
                type="button"
                className={`pill-btn ${channelFilter === c ? 'active' : ''}`}
                onClick={() => setChannelFilter(c)}
              >
                {c === 'all' ? t(lang, 'all') : t(lang, `ch_${c}`)}
              </button>
            ))}
          </div>

          <div className="card">
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t(lang, 'orderNo')}</th>
                    <th>{t(lang, 'channel')}</th>
                    <th>{t(lang, 'customer')}</th>
                    <th>{t(lang, 'items')}</th>
                    <th>{t(lang, 'totalAmount')}</th>
                    <th>{t(lang, 'profit')}</th>
                    <th>{t(lang, 'orderStatus')}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && orders.length === 0 ? (
                    <tr><td colSpan="7">{t(lang, 'loading')}</td></tr>
                  ) : (
                    filteredOrders.map((o) => {
                      const inactive = ['cancelled', 'returned'].includes(o.order_status);
                      return (
                        <tr key={o.id} style={{ opacity: inactive ? 0.6 : 1 }}>
                          <td>
                            <div className="cell-main">{o.order_no}</div>
                            <div className="cell-sub">
                              {String(o.order_date).slice(0, 10)}
                              {o.external_order_id ? ` · ${o.external_order_id}` : ''}
                            </div>
                          </td>
                          <td>
                            <span
                              className={`badge ${
                                o.channel === 'online_store'
                                  ? 'badge-olive'
                                  : o.channel === 'social_ads'
                                    ? 'badge-slate'
                                    : 'badge-gold'
                              }`}
                            >
                              {t(lang, `ch_${o.channel}`)}
                            </span>
                            {o.campaign_name && <div className="cell-sub">{o.campaign_name}</div>}
                          </td>
                          <td>
                            <div className="cell-main">{o.customer_name}</div>
                            <div className="cell-sub">
                              {o.customer_phone} {o.city ? `· ${o.city}` : ''}
                            </div>
                          </td>
                          <td>
                            {o.items.map((it) => (
                              <div key={it.id} style={{ fontSize: 12.5 }}>
                                <strong>{it.quantity}×</strong> {it.sku_snapshot}
                              </div>
                            ))}
                          </td>
                          <td className="num">
                            <div className="cell-main">{formatEGP(o.total_amount, lang)}</div>
                            <div className="cell-sub">{t(lang, `pay_${o.payment_method}`)}</div>
                          </td>
                          <td className="num">
                            <span className={inactive ? 'cell-sub' : Number(o.net_profit) >= 0 ? 'val-positive' : 'val-negative'}>
                              {inactive ? '—' : formatEGP(o.net_profit, lang)}
                            </span>
                          </td>
                          <td>
                            <select
                              className="select-inline"
                              value={o.order_status}
                              onChange={(e) => updateOrderStatus(o.id, e.target.value)}
                              aria-label={t(lang, 'orderStatus')}
                            >
                              {['pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled', 'returned'].map(
                                (st) => (
                                  <option key={st} value={st}>
                                    {t(lang, `st_${st}`)}
                                  </option>
                                )
                              )}
                            </select>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'ads' && (
        <div className="card">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t(lang, 'date')}</th>
                  <th>{t(lang, 'platform')}</th>
                  <th>{t(lang, 'campaignName')}</th>
                  <th>{t(lang, 'notes')}</th>
                  <th>{t(lang, 'egp')}</th>
                  <th>{t(lang, 'actions')}</th>
                </tr>
              </thead>
              <tbody>
                {adSpend.length === 0 ? (
                  <tr><td colSpan="6">{t(lang, 'noData')}</td></tr>
                ) : (
                  adSpend.map((a) => (
                    <tr key={a.id}>
                      <td className="num">{String(a.spend_date).slice(0, 10)}</td>
                      <td><span className="badge badge-slate">{a.platform}</span></td>
                      <td className="cell-main">{a.campaign_name}</td>
                      <td className="cell-sub">{a.notes || '—'}</td>
                      <td className="num cell-main">{formatEGP(a.amount, lang)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-danger-ghost btn-sm"
                          onClick={() => deleteAdSpend(a.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL: NEW SALE ORDER */}
      <Modal
        open={showOrderModal}
        title={t(lang, 'btnNewOrder')}
        onClose={() => setShowOrderModal(false)}
        wide
      >
        <form onSubmit={submitOrder}>
          <div className="form-grid">
            <div className="form-field">
              <label className="form-label">{t(lang, 'channel')}</label>
              <select
                className="select"
                value={oForm.channel}
                onChange={(e) => setOForm({ ...oForm, channel: e.target.value })}
              >
                <option value="online_store">{t(lang, 'ch_online_store')}</option>
                <option value="phone_offline">{t(lang, 'ch_phone_offline')}</option>
                <option value="social_ads">{t(lang, 'ch_social_ads')}</option>
              </select>
            </div>

            <div className="form-field">
              <label className="form-label">{t(lang, 'date')}</label>
              <input
                type="date"
                className="input"
                value={oForm.order_date}
                onChange={(e) => setOForm({ ...oForm, order_date: e.target.value })}
                required
              />
            </div>

            {oForm.channel === 'social_ads' && (
              <>
                <div className="form-field">
                  <label className="form-label">{t(lang, 'platform')}</label>
                  <select
                    className="select"
                    value={oForm.social_platform}
                    onChange={(e) => setOForm({ ...oForm, social_platform: e.target.value })}
                  >
                    <option value="facebook">Facebook Ads</option>
                    <option value="instagram">Instagram Ads</option>
                    <option value="tiktok">TikTok Ads</option>
                    <option value="whatsapp">WhatsApp Click-to-Chat</option>
                  </select>
                </div>
                <div className="form-field">
                  <label className="form-label">{t(lang, 'campaignName')}</label>
                  <input
                    type="text"
                    className="input"
                    placeholder="e.g. Nov Harvest Video"
                    value={oForm.campaign_name}
                    onChange={(e) => setOForm({ ...oForm, campaign_name: e.target.value })}
                  />
                </div>
              </>
            )}

            <div className="form-field">
              <label className="form-label">{t(lang, 'customerName')}</label>
              <input
                type="text"
                className="input"
                value={oForm.customer_name}
                onChange={(e) => setOForm({ ...oForm, customer_name: e.target.value })}
                required
              />
            </div>

            <div className="form-field">
              <label className="form-label">{t(lang, 'customerPhone')}</label>
              <input
                type="text"
                className="input"
                placeholder="010..."
                value={oForm.customer_phone}
                onChange={(e) => setOForm({ ...oForm, customer_phone: e.target.value })}
              />
            </div>

            <div className="form-field">
              <label className="form-label">{t(lang, 'city')}</label>
              <input
                type="text"
                className="input"
                value={oForm.city}
                onChange={(e) => setOForm({ ...oForm, city: e.target.value })}
              />
            </div>

            <div className="form-field">
              <label className="form-label">{t(lang, 'paymentStatus')}</label>
              <select
                className="select"
                value={oForm.payment_method}
                onChange={(e) => setOForm({ ...oForm, payment_method: e.target.value })}
              >
                {['cod', 'cash', 'credit', 'instapay', 'vodafone_cash', 'card', 'bank_transfer'].map((pm) => (
                  <option key={pm} value={pm}>{t(lang, `pay_${pm}`)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Line items */}
          <div style={{ marginTop: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label className="form-label">{t(lang, 'items')}</label>
              <button type="button" className="btn btn-secondary btn-sm" onClick={addLineItem}>
                + {t(lang, 'addLineItem')}
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {oForm.items.map((li, idx) => (
                <div key={idx} className="order-item-row">
                  <select
                    className="select"
                    value={li.finished_product_id}
                    onChange={(e) => updateLineItem(idx, { finished_product_id: e.target.value })}
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {pickName(p, lang)} ({p.stock_qty} in stock)
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="1"
                    className="input"
                    placeholder="Qty"
                    aria-label="Quantity"
                    value={li.quantity}
                    onChange={(e) => updateLineItem(idx, { quantity: e.target.value })}
                    required
                  />
                  <input
                    type="number"
                    min="0"
                    step="1"
                    className="input"
                    placeholder={t(lang, 'egp')}
                    aria-label="Unit Price"
                    value={li.unit_price}
                    onChange={(e) => updateLineItem(idx, { unit_price: e.target.value })}
                    required
                  />
                  <button
                    type="button"
                    className="btn btn-danger-ghost btn-sm"
                    onClick={() => removeLineItem(idx)}
                    disabled={oForm.items.length <= 1}
                    aria-label={t(lang, 'delete')}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="form-grid" style={{ marginTop: 14 }}>
            <div className="form-field">
              <label className="form-label">{t(lang, 'discount')}</label>
              <input
                type="number"
                min="0"
                className="input"
                value={oForm.discount}
                onChange={(e) => setOForm({ ...oForm, discount: e.target.value })}
              />
            </div>
            <div className="form-field">
              <label className="form-label">{t(lang, 'shippingCharged')}</label>
              <input
                type="number"
                min="0"
                className="input"
                value={oForm.shipping_charged}
                onChange={(e) => setOForm({ ...oForm, shipping_charged: e.target.value })}
              />
            </div>
            <div className="form-field">
              <label className="form-label">{t(lang, 'shippingActual')}</label>
              <input
                type="number"
                min="0"
                className="input"
                value={oForm.shipping_actual_cost}
                onChange={(e) => setOForm({ ...oForm, shipping_actual_cost: e.target.value })}
              />
            </div>
            <div className="form-field">
              <label className="form-label">{t(lang, 'notes')}</label>
              <input
                type="text"
                className="input"
                value={oForm.notes}
                onChange={(e) => setOForm({ ...oForm, notes: e.target.value })}
              />
            </div>
          </div>

          <div className="preview-box">
            <div className="preview-box-title">{t(lang, 'orderProfitPreview')}</div>
            <div className="preview-grid">
              <div>
                <div className="mini-metric-label">{t(lang, 'totalAmount')}</div>
                <div className="mini-metric-val num">{formatEGP(pTotal, lang)}</div>
              </div>
              <div>
                <div className="mini-metric-label">COGS</div>
                <div className="mini-metric-val num">{formatEGP(pCogs, lang)}</div>
              </div>
              <div>
                <div className="mini-metric-label">{t(lang, 'profit')}</div>
                <div className={`mini-metric-val num ${pNetProfit >= 0 ? 'val-positive' : 'val-negative'}`}>
                  {formatEGP(pNetProfit, lang)}
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setShowOrderModal(false)}>
              {t(lang, 'cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              <ShoppingBag size={15} />
              {t(lang, 'save')}
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL: ADD AD SPEND */}
      <Modal open={showAdModal} title={t(lang, 'btnAddAdSpend')} onClose={() => setShowAdModal(false)}>
        <form onSubmit={submitAdSpend}>
          <div className="form-grid">
            <div className="form-field">
              <label className="form-label">{t(lang, 'date')}</label>
              <input
                type="date"
                className="input"
                value={adForm.spend_date}
                onChange={(e) => setAdForm({ ...adForm, spend_date: e.target.value })}
                required
              />
            </div>
            <div className="form-field">
              <label className="form-label">{t(lang, 'platform')}</label>
              <select
                className="select"
                value={adForm.platform}
                onChange={(e) => setAdForm({ ...adForm, platform: e.target.value })}
              >
                <option value="facebook">Facebook</option>
                <option value="instagram">Instagram</option>
                <option value="tiktok">TikTok</option>
                <option value="google">Google</option>
              </select>
            </div>
            <div className="form-field full">
              <label className="form-label">{t(lang, 'campaignName')}</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. Ramadan / Harvest Offer"
                value={adForm.campaign_name}
                onChange={(e) => setAdForm({ ...adForm, campaign_name: e.target.value })}
                required
              />
            </div>
            <div className="form-field">
              <label className="form-label">{t(lang, 'egp')}</label>
              <input
                type="number"
                min="1"
                step="1"
                className="input"
                value={adForm.amount}
                onChange={(e) => setAdForm({ ...adForm, amount: e.target.value })}
                required
              />
            </div>
            <div className="form-field">
              <label className="form-label">{t(lang, 'notes')}</label>
              <input
                type="text"
                className="input"
                value={adForm.notes}
                onChange={(e) => setAdForm({ ...adForm, notes: e.target.value })}
              />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setShowAdModal(false)}>
              {t(lang, 'cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {t(lang, 'save')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
