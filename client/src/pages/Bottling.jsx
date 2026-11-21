import React, { useEffect, useState } from 'react';
import { Calculator, Edit3, Factory, FlaskConical, PackagePlus, Plus } from 'lucide-react';
import { apiFetch } from '../api.js';
import { formatEGP, formatNum, pickName, t } from '../i18n.js';
import Modal from '../components/Modal.jsx';

export default function Bottling({ lang }) {
  const [tab, setTab] = useState('skus');
  const [products, setProducts] = useState([]);
  const [batches, setBatches] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [showBatchModal, setShowBatchModal] = useState(false);
  const [editingBatch, setEditingBatch] = useState(null);
  const [showSkuModal, setShowSkuModal] = useState(false);
  const [editingSkuId, setEditingSkuId] = useState(null);
  const [saving, setSaving] = useState(false);

  const [bForm, setBForm] = useState({
    batch_date: new Date().toISOString().slice(0, 10),
    finished_product_id: '',
    quantity_produced: '20',
    spillage_litres: '0.2',
    batch_hidden_cost: '100',
    harvest_note: '',
    notes: '',
  });

  const [skuForm, setSkuForm] = useState({
    sku: '',
    external_sku: '',
    name: '',
    name_ar: '',
    oil_type: 'extra_virgin',
    container_type: 'glass',
    size_ml: '500',
    oil_material_id: '',
    oil_litres_per_unit: '0.5',
    container_material_id: '',
    containers_per_unit: '1',
    sticker_material_id: '',
    stickers_per_unit: '1',
    extra_material_id: '',
    extra_qty_per_unit: '1',
    retail_price: '390',
    min_stock: '10',
    stock_qty: '',
    unit_cogs: '',
  });

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      const [pRes, bRes, mRes] = await Promise.all([
        apiFetch('/api/bottling/products'),
        apiFetch('/api/bottling/batches'),
        apiFetch('/api/purchases/materials'),
      ]);
      setProducts(pRes.products);
      setBatches(bRes.batches);
      setMaterials(mRes.materials);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  function openBatchFor(sku = null) {
    const chosen = sku || products[0];
    setEditingBatch(null);
    setBForm({
      batch_date: new Date().toISOString().slice(0, 10),
      finished_product_id: chosen ? String(chosen.id) : '',
      quantity_produced: chosen && chosen.max_producible > 0 ? String(Math.min(20, chosen.max_producible)) : '10',
      spillage_litres: '0.2',
      batch_hidden_cost: '100',
      harvest_note: 'Sinai Nov-26',
      notes: '',
    });
    setShowBatchModal(true);
  }

  function openEditBatch(batch) {
    setEditingBatch(batch);
    setBForm({
      batch_date: String(batch.batch_date).slice(0, 10),
      finished_product_id: String(batch.finished_product_id),
      quantity_produced: String(batch.quantity_produced),
      spillage_litres: String(batch.spillage_litres ?? 0),
      batch_hidden_cost: String(batch.batch_hidden_cost ?? 0),
      harvest_note: batch.harvest_note || '',
      notes: batch.notes || '',
    });
    setShowBatchModal(true);
  }

  function openNewSkuModal() {
    const oil = materials.find((m) => m.category === 'oil');
    const cont = materials.find((m) => m.category === 'container');
    const stk = materials.find((m) => m.category === 'sticker');
    const pkg = materials.find((m) => m.category === 'packaging');
    setEditingSkuId(null);
    setSkuForm({
      sku: '',
      external_sku: '',
      name: '',
      name_ar: '',
      oil_type: 'extra_virgin',
      container_type: cont?.container_material || 'glass',
      size_ml: String(cont?.capacity_ml || 500),
      oil_material_id: oil ? String(oil.id) : '',
      oil_litres_per_unit: String((cont?.capacity_ml || 500) / 1000),
      container_material_id: cont ? String(cont.id) : '',
      containers_per_unit: '1',
      sticker_material_id: stk ? String(stk.id) : '',
      stickers_per_unit: '1',
      extra_material_id: pkg ? String(pkg.id) : '',
      extra_qty_per_unit: pkg ? '1' : '0',
      retail_price: '400',
      min_stock: '10',
      stock_qty: '',
      unit_cogs: '',
    });
    setShowSkuModal(true);
  }

  function openEditSkuModal(prod) {
    setEditingSkuId(prod.id);
    setSkuForm({
      sku: prod.sku || '',
      external_sku: prod.external_sku || '',
      name: prod.name || '',
      name_ar: prod.name_ar || '',
      oil_type: prod.oil_type || 'extra_virgin',
      container_type: prod.container_type || 'glass',
      size_ml: String(prod.size_ml || 500),
      oil_material_id: prod.oil_material_id ? String(prod.oil_material_id) : '',
      oil_litres_per_unit: String(prod.oil_litres_per_unit ?? 0.5),
      container_material_id: prod.container_material_id ? String(prod.container_material_id) : '',
      containers_per_unit: String(prod.containers_per_unit ?? 1),
      sticker_material_id: prod.sticker_material_id ? String(prod.sticker_material_id) : '',
      stickers_per_unit: String(prod.stickers_per_unit ?? 1),
      extra_material_id: prod.extra_material_id ? String(prod.extra_material_id) : '',
      extra_qty_per_unit: String(prod.extra_qty_per_unit ?? 0),
      retail_price: String(prod.retail_price ?? 0),
      min_stock: String(prod.min_stock ?? 10),
      stock_qty: String(prod.stock_qty ?? 0),
      unit_cogs: String(prod.unit_cogs ?? 0),
    });
    setShowSkuModal(true);
  }

  const selectedSku = products.find((p) => String(p.id) === String(bForm.finished_product_id));
  const qty = Math.max(0, Math.floor(Number(bForm.quantity_produced) || 0));
  const spill = Math.max(0, Number(bForm.spillage_litres) || 0);
  const bHidden = Math.max(0, Number(bForm.batch_hidden_cost) || 0);

  const reqOil = selectedSku ? qty * Number(selectedSku.oil_litres_per_unit || 0) + spill : 0;
  const reqCont = selectedSku ? qty * Number(selectedSku.containers_per_unit || 0) : 0;
  const reqStk = selectedSku ? qty * Number(selectedSku.stickers_per_unit || 0) : 0;
  const reqExt = selectedSku ? qty * Number(selectedSku.extra_qty_per_unit || 0) : 0;

  // When editing an existing batch, add back what that batch already consumed to check true available stock
  const availOil = selectedSku
    ? Number(selectedSku.oil_stock_qty || 0) +
      (editingBatch ? Number(editingBatch.oil_litres_used || 0) + Number(editingBatch.spillage_litres || 0) : 0)
    : 0;
  const availCont = selectedSku
    ? Number(selectedSku.container_stock_qty || 0) + (editingBatch ? Number(editingBatch.containers_used || 0) : 0)
    : 0;
  const availStk = selectedSku
    ? Number(selectedSku.sticker_stock_qty || 0) + (editingBatch ? Number(editingBatch.stickers_used || 0) : 0)
    : 0;
  const availExt = selectedSku
    ? Number(selectedSku.extra_stock_qty || 0) + (editingBatch ? Number(editingBatch.extra_used || 0) : 0)
    : 0;

  const estTotalBatch = selectedSku
    ? reqOil * Number(selectedSku.oil_unit_cost || 0) +
      reqCont * Number(selectedSku.container_unit_cost || 0) +
      reqStk * Number(selectedSku.sticker_unit_cost || 0) +
      reqExt * Number(selectedSku.extra_unit_cost || 0) +
      bHidden
    : 0;
  const estUnitCogs = qty > 0 ? estTotalBatch / qty : 0;
  const estProfit = selectedSku ? Number(selectedSku.retail_price || 0) - estUnitCogs : 0;

  const oilShort = selectedSku && reqOil > availOil + 0.001;
  const contShort = selectedSku && reqCont > availCont + 0.001;
  const stkShort = selectedSku && reqStk > availStk + 0.001;
  const extShort = selectedSku && selectedSku.extra_material_id && reqExt > availExt + 0.001;
  const anyShortage = oilShort || contShort || stkShort || extShort;

  async function submitBatch(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...bForm,
        finished_product_id: Number(bForm.finished_product_id),
        quantity_produced: qty,
        spillage_litres: spill,
        batch_hidden_cost: bHidden,
      };
      if (editingBatch) {
        await apiFetch(`/api/bottling/batches/${editingBatch.id}`, {
          method: 'PATCH',
          body: payload,
        });
      } else {
        await apiFetch('/api/bottling/batches', {
          method: 'POST',
          body: payload,
        });
      }
      setShowBatchModal(false);
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function submitSku(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...skuForm,
        size_ml: Number(skuForm.size_ml),
        oil_litres_per_unit: Number(skuForm.oil_litres_per_unit),
        containers_per_unit: Number(skuForm.containers_per_unit),
        stickers_per_unit: Number(skuForm.stickers_per_unit),
        extra_qty_per_unit: Number(skuForm.extra_qty_per_unit || 0),
        retail_price: Number(skuForm.retail_price),
        min_stock: Number(skuForm.min_stock),
        ...(editingSkuId
          ? {
              stock_qty: skuForm.stock_qty !== '' ? Math.floor(Number(skuForm.stock_qty)) : undefined,
              unit_cogs: skuForm.unit_cogs !== '' ? Number(skuForm.unit_cogs) : undefined,
            }
          : {}),
      };
      if (editingSkuId) {
        await apiFetch(`/api/bottling/products/${editingSkuId}`, {
          method: 'PATCH',
          body: payload,
        });
      } else {
        await apiFetch('/api/bottling/products', {
          method: 'POST',
          body: payload,
        });
      }
      setShowSkuModal(false);
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const oilMats = materials.filter((m) => m.category === 'oil');
  const contMats = materials.filter((m) => m.category === 'container');
  const stkMats = materials.filter((m) => m.category === 'sticker');
  const pkgMats = materials.filter((m) => m.category === 'packaging');

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t(lang, 'bottlingTitle')}</h1>
          <p className="page-subtitle">{t(lang, 'bottlingSubtitle')}</p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn btn-secondary" onClick={openNewSkuModal}>
            <Plus size={15} />
            {t(lang, 'btnNewSku')}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => openBatchFor()}>
            <Factory size={15} />
            {t(lang, 'btnNewBatch')}
          </button>
        </div>
      </div>

      {error && <div className="alert-banner error">{error}</div>}

      <div className="tabs-bar">
        <button type="button" className={`tab-btn ${tab === 'skus' ? 'active' : ''}`} onClick={() => setTab('skus')}>
          {t(lang, 'tabFinishedSkus')} ({products.length})
        </button>
        <button type="button" className={`tab-btn ${tab === 'batches' ? 'active' : ''}`} onClick={() => setTab('batches')}>
          {t(lang, 'tabBatches')} ({batches.length})
        </button>
      </div>

      {tab === 'skus' && (
        <div className="card">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t(lang, 'productName')}</th>
                  <th>{t(lang, 'containerType')}</th>
                  <th>{t(lang, 'finishedStock')}</th>
                  <th>{t(lang, 'unitCogs')}</th>
                  <th>{t(lang, 'retailPrice')}</th>
                  <th>{t(lang, 'grossMargin')}</th>
                  <th>{t(lang, 'maxCanBottle')}</th>
                  <th>{t(lang, 'actions')}</th>
                </tr>
              </thead>
              <tbody>
                {loading && products.length === 0 ? (
                  <tr><td colSpan="8">{t(lang, 'loading')}</td></tr>
                ) : (
                  products.map((p) => {
                    const effectiveCogs = Number(p.unit_cogs) > 0 ? Number(p.unit_cogs) : Number(p.estimated_bom_cost);
                    const marginVal = Number(p.retail_price) - effectiveCogs;
                    const marginPct = Number(p.retail_price) > 0 ? ((marginVal / Number(p.retail_price)) * 100).toFixed(1) : '0';
                    const low = Number(p.stock_qty) <= Number(p.min_stock);
                    return (
                      <tr key={p.id}>
                        <td>
                          <div className="cell-main">{pickName(p, lang)}</div>
                          <div className="cell-sub">
                            {p.sku} · {formatNum(p.oil_litres_per_unit, 2)}L + {formatNum(p.stickers_per_unit, 0)} stk
                          </div>
                        </td>
                        <td>
                          <span className={`badge ${p.container_type === 'tin' ? 'badge-gold' : 'badge-olive'}`}>
                            {t(lang, p.container_type)} · {p.size_ml}ml
                          </span>
                        </td>
                        <td className="num">
                          <span className="cell-main" style={{ color: low ? 'var(--clay-danger)' : undefined }}>
                            {p.stock_qty} {t(lang, 'pcs')}
                          </span>
                        </td>
                        <td className="num">{formatEGP(effectiveCogs, lang)}</td>
                        <td className="num cell-main">{formatEGP(p.retail_price, lang)}</td>
                        <td className="num">
                          <span className="badge badge-emerald">
                            +{formatEGP(marginVal, lang)} ({marginPct}%)
                          </span>
                        </td>
                        <td className="num">
                          <div className="cell-main">{p.max_producible} {t(lang, 'pcs')}</div>
                          {p.bottleneck && (
                            <div className="cell-sub">
                              {t(lang, 'bottleneck')}: {p.bottleneck}
                            </div>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => openBatchFor(p)}
                            >
                              <FlaskConical size={14} />
                              {t(lang, 'bottleNow')}
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => openEditSkuModal(p)}
                              aria-label={t(lang, 'edit')}
                            >
                              <Edit3 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'batches' && (
        <div className="card">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t(lang, 'batchCode')}</th>
                  <th>{t(lang, 'productName')}</th>
                  <th>Qty</th>
                  <th>{t(lang, 'oilCost')}</th>
                  <th>{t(lang, 'bottleCost')}</th>
                  <th>{t(lang, 'stickerCost')}</th>
                  <th>{t(lang, 'hiddenShare')}</th>
                  <th>{t(lang, 'totalBatchCost')}</th>
                  <th>{t(lang, 'unitCogs')}</th>
                  <th>{t(lang, 'actions')}</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <div className="cell-main">{b.batch_code}</div>
                      <div className="cell-sub">{String(b.batch_date).slice(0, 10)}</div>
                    </td>
                    <td>
                      <div className="cell-main">{pickName(b, lang, 'product_name')}</div>
                      <div className="cell-sub">
                        {formatNum(b.oil_litres_used, 1)}L {Number(b.spillage_litres) > 0 ? `(+${b.spillage_litres}L loss)` : ''}
                      </div>
                    </td>
                    <td className="num cell-main">{b.quantity_produced}</td>
                    <td className="num">{formatEGP(b.oil_cost, lang)}</td>
                    <td className="num">{formatEGP(b.container_cost, lang)}</td>
                    <td className="num">{formatEGP(Number(b.sticker_cost) + Number(b.extra_cost), lang)}</td>
                    <td className="num">{formatEGP(b.batch_hidden_cost, lang)}</td>
                    <td className="num cell-main">{formatEGP(b.total_batch_cost, lang)}</td>
                    <td className="num">
                      <span className="badge badge-olive">{formatEGP(b.unit_cogs, lang)}</span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => openEditBatch(b)}
                        aria-label={t(lang, 'edit')}
                      >
                        <Edit3 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL: NEW / EDIT BOTTLING RUN */}
      <Modal
        open={showBatchModal}
        title={editingBatch ? `${t(lang, 'editBatch')} (${editingBatch.batch_code})` : t(lang, 'btnNewBatch')}
        onClose={() => setShowBatchModal(false)}
        wide
      >
        <form onSubmit={submitBatch}>
          <div className="form-grid">
            <div className="form-field full">
              <label className="form-label">{t(lang, 'productName')}</label>
              <select
                className="select"
                value={bForm.finished_product_id}
                onChange={(e) => setBForm({ ...bForm, finished_product_id: e.target.value })}
                disabled={Boolean(editingBatch)}
                required
              >
                <option value="">—</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {pickName(p, lang)} ({p.sku}) — Max {p.max_producible} pcs
                  </option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label className="form-label">{t(lang, 'qtyToProduce')}</label>
              <input
                type="number"
                min="1"
                step="1"
                className="input"
                value={bForm.quantity_produced}
                onChange={(e) => setBForm({ ...bForm, quantity_produced: e.target.value })}
                required
              />
            </div>

            <div className="form-field">
              <label className="form-label">{t(lang, 'date')}</label>
              <input
                type="date"
                className="input"
                value={bForm.batch_date}
                onChange={(e) => setBForm({ ...bForm, batch_date: e.target.value })}
                required
              />
            </div>

            <div className="form-field">
              <label className="form-label">{t(lang, 'spillageLitres')}</label>
              <input
                type="number"
                min="0"
                step="0.05"
                className="input"
                value={bForm.spillage_litres}
                onChange={(e) => setBForm({ ...bForm, spillage_litres: e.target.value })}
              />
            </div>

            <div className="form-field">
              <label className="form-label">{t(lang, 'batchHiddenCost')}</label>
              <input
                type="number"
                min="0"
                step="1"
                className="input"
                value={bForm.batch_hidden_cost}
                onChange={(e) => setBForm({ ...bForm, batch_hidden_cost: e.target.value })}
              />
            </div>

            <div className="form-field">
              <label className="form-label">{t(lang, 'harvestLot')}</label>
              <input
                type="text"
                className="input"
                value={bForm.harvest_note}
                onChange={(e) => setBForm({ ...bForm, harvest_note: e.target.value })}
              />
            </div>

            <div className="form-field">
              <label className="form-label">{t(lang, 'notes')}</label>
              <input
                type="text"
                className="input"
                value={bForm.notes}
                onChange={(e) => setBForm({ ...bForm, notes: e.target.value })}
              />
            </div>
          </div>

          {selectedSku && (
            <div className="preview-box">
              <div className="preview-box-title">
                <Calculator size={15} />
                {t(lang, 'bomCheckTitle')}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12, fontSize: 13 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: oilShort ? 'var(--clay-danger)' : undefined }}>
                  <span>{pickName(selectedSku, lang, 'oil_name')}</span>
                  <span className="num">
                    {t(lang, 'needed')}: <strong>{formatNum(reqOil, 2)}L</strong> ({formatNum(reqOil / 17, 2)} gal) / {t(lang, 'available')}:{' '}
                    {formatNum(availOil, 2)}L
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: contShort ? 'var(--clay-danger)' : undefined }}>
                  <span>{pickName(selectedSku, lang, 'container_name')}</span>
                  <span className="num">
                    {t(lang, 'needed')}: <strong>{formatNum(reqCont, 0)}</strong> / {t(lang, 'available')}:{' '}
                    {formatNum(availCont, 0)}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: stkShort ? 'var(--clay-danger)' : undefined }}>
                  <span>{pickName(selectedSku, lang, 'sticker_name')}</span>
                  <span className="num">
                    {t(lang, 'needed')}: <strong>{formatNum(reqStk, 0)}</strong> / {t(lang, 'available')}:{' '}
                    {formatNum(availStk, 0)}
                  </span>
                </div>
                {selectedSku.extra_material_id && reqExt > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: extShort ? 'var(--clay-danger)' : undefined }}>
                    <span>{pickName(selectedSku, lang, 'extra_name')}</span>
                    <span className="num">
                      {t(lang, 'needed')}: <strong>{formatNum(reqExt, 0)}</strong> / {t(lang, 'available')}:{' '}
                      {formatNum(availExt, 0)}
                    </span>
                  </div>
                )}
              </div>

              <div className="preview-grid" style={{ paddingTop: 10, borderTop: '1px solid var(--border-hairline)' }}>
                <div>
                  <div className="mini-metric-label">{t(lang, 'totalBatchCost')}</div>
                  <div className="mini-metric-val num">{formatEGP(estTotalBatch, lang)}</div>
                </div>
                <div>
                  <div className="mini-metric-label">{t(lang, 'estUnitCogs')}</div>
                  <div className="mini-metric-val num" style={{ color: 'var(--olive-text)' }}>
                    {formatEGP(estUnitCogs, lang)}
                  </div>
                </div>
                <div>
                  <div className="mini-metric-label">{t(lang, 'estProfitPerBottle')}</div>
                  <div className={`mini-metric-val num ${estProfit >= 0 ? 'val-positive' : 'val-negative'}`}>
                    {formatEGP(estProfit, lang)}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setShowBatchModal(false)}>
              {t(lang, 'cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving || anyShortage || !(qty > 0)}>
              <PackagePlus size={15} />
              {t(lang, 'save')}
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL: NEW / EDIT FINISHED SKU & BOM */}
      <Modal
        open={showSkuModal}
        title={editingSkuId ? t(lang, 'editProduct') : t(lang, 'btnNewSku')}
        onClose={() => setShowSkuModal(false)}
        wide
      >
        <form onSubmit={submitSku}>
          <div className="form-grid">
            <div className="form-field">
              <label className="form-label">{t(lang, 'skuCode')}</label>
              <input
                type="text"
                className="input"
                placeholder="SNW-EVOO-2000T"
                value={skuForm.sku}
                onChange={(e) =>
                  setSkuForm({
                    ...skuForm,
                    sku: e.target.value,
                    ...(editingSkuId ? {} : { external_sku: e.target.value }),
                  })
                }
                required
              />
            </div>
            <div className="form-field">
              <label className="form-label">EasyOrders SKU</label>
              <input
                type="text"
                className="input"
                value={skuForm.external_sku}
                onChange={(e) => setSkuForm({ ...skuForm, external_sku: e.target.value })}
              />
            </div>
            <div className="form-field">
              <label className="form-label">Product Name (EN)</label>
              <input
                type="text"
                className="input"
                placeholder="Sinawy EVOO 2L Family Tin"
                value={skuForm.name}
                onChange={(e) => setSkuForm({ ...skuForm, name: e.target.value })}
                required
              />
            </div>
            <div className="form-field">
              <label className="form-label">اسم المنتج (عربي)</label>
              <input
                type="text"
                className="input"
                placeholder="سيناوي بكر ممتاز ٢ لتر صفيح"
                value={skuForm.name_ar}
                onChange={(e) => setSkuForm({ ...skuForm, name_ar: e.target.value })}
              />
            </div>
            <div className="form-field">
              <label className="form-label">{t(lang, 'containerType')}</label>
              <select
                className="select"
                value={skuForm.container_type}
                onChange={(e) => setSkuForm({ ...skuForm, container_type: e.target.value })}
              >
                <option value="glass">{t(lang, 'glass')}</option>
                <option value="tin">{t(lang, 'tin')}</option>
                <option value="sachet">{t(lang, 'sachet')}</option>
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">Size (ml)</label>
              <input
                type="number"
                className="input"
                value={skuForm.size_ml}
                onChange={(e) =>
                  setSkuForm({
                    ...skuForm,
                    size_ml: e.target.value,
                    oil_litres_per_unit: String(Number(e.target.value) / 1000),
                  })
                }
                required
              />
            </div>
            <div className="form-field">
              <label className="form-label">Bulk Oil Material</label>
              <select
                className="select"
                value={skuForm.oil_material_id}
                onChange={(e) => setSkuForm({ ...skuForm, oil_material_id: e.target.value })}
              >
                <option value="">—</option>
                {oilMats.map((m) => (
                  <option key={m.id} value={m.id}>{pickName(m, lang)}</option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">Litres / Unit</label>
              <input
                type="number"
                step="0.01"
                className="input"
                value={skuForm.oil_litres_per_unit}
                onChange={(e) => setSkuForm({ ...skuForm, oil_litres_per_unit: e.target.value })}
              />
            </div>
            <div className="form-field">
              <label className="form-label">Bottle / Tin Material</label>
              <select
                className="select"
                value={skuForm.container_material_id}
                onChange={(e) => setSkuForm({ ...skuForm, container_material_id: e.target.value })}
              >
                <option value="">—</option>
                {contMats.map((m) => (
                  <option key={m.id} value={m.id}>{pickName(m, lang)}</option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">Sticker Material</label>
              <select
                className="select"
                value={skuForm.sticker_material_id}
                onChange={(e) => setSkuForm({ ...skuForm, sticker_material_id: e.target.value })}
              >
                <option value="">—</option>
                {stkMats.map((m) => (
                  <option key={m.id} value={m.id}>{pickName(m, lang)}</option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">Stickers / Bottle</label>
              <input
                type="number"
                min="0"
                className="input"
                value={skuForm.stickers_per_unit}
                onChange={(e) => setSkuForm({ ...skuForm, stickers_per_unit: e.target.value })}
              />
            </div>
            <div className="form-field">
              <label className="form-label">Extra Packaging (Box/Seal)</label>
              <select
                className="select"
                value={skuForm.extra_material_id}
                onChange={(e) =>
                  setSkuForm({ ...skuForm, extra_material_id: e.target.value, extra_qty_per_unit: e.target.value ? '1' : '0' })
                }
              >
                <option value="">None</option>
                {pkgMats.map((m) => (
                  <option key={m.id} value={m.id}>{pickName(m, lang)}</option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">{t(lang, 'retailPrice')} (EGP)</label>
              <input
                type="number"
                step="1"
                className="input"
                value={skuForm.retail_price}
                onChange={(e) => setSkuForm({ ...skuForm, retail_price: e.target.value })}
                required
              />
            </div>
            <div className="form-field">
              <label className="form-label">{t(lang, 'minAlert')}</label>
              <input
                type="number"
                className="input"
                value={skuForm.min_stock}
                onChange={(e) => setSkuForm({ ...skuForm, min_stock: e.target.value })}
              />
            </div>
            {editingSkuId && (
              <>
                <div className="form-field">
                  <label className="form-label">{t(lang, 'currentStockAdj')}</label>
                  <input
                    type="number"
                    min="0"
                    className="input"
                    value={skuForm.stock_qty}
                    onChange={(e) => setSkuForm({ ...skuForm, stock_qty: e.target.value })}
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">{t(lang, 'unitCogs')} (EGP)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="input"
                    value={skuForm.unit_cogs}
                    onChange={(e) => setSkuForm({ ...skuForm, unit_cogs: e.target.value })}
                  />
                </div>
              </>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setShowSkuModal(false)}>
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
