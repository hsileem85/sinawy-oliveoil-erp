import React, { useEffect, useState } from 'react';
import { Calculator, Droplets, Plus, Receipt, Trash2, Truck, Users } from 'lucide-react';
import { apiFetch } from '../api.js';
import { formatEGP, formatNum, pickName, t } from '../i18n.js';
import Modal from '../components/Modal.jsx';

export default function Purchases({ lang }) {
  const [tab, setTab] = useState('stock');
  const [catFilter, setCatFilter] = useState('all');
  const [materials, setMaterials] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [hiddenCosts, setHiddenCosts] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Modals
  const [showPurchaseModal, setShowPurchaseModal] = useState(false);
  const [showHiddenModal, setShowHiddenModal] = useState(false);
  const [showMaterialModal, setShowMaterialModal] = useState(false);
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [saving, setSaving] = useState(false);

  // Purchase form
  const [pForm, setPForm] = useState({
    purchase_date: new Date().toISOString().slice(0, 10),
    raw_material_id: '',
    supplier_id: '',
    purchase_qty: '1',
    units_per_purchase: '17',
    unit_price: '',
    hidden_cost: '0',
    harvest_lot: '',
    payment_type: 'cash',
    amount_paid: '0',
    due_date: '',
    notes: '',
  });

  // Hidden cost form
  const [hcForm, setHcForm] = useState({
    cost_date: new Date().toISOString().slice(0, 10),
    category: 'shipping_inbound',
    title: '',
    title_ar: '',
    amount: '',
    notes: '',
  });

  // Material form
  const [mForm, setMForm] = useState({
    code: '',
    name: '',
    name_ar: '',
    category: 'container',
    container_material: 'glass',
    capacity_ml: '500',
    units_per_purchase: '1',
    min_stock: '20',
    notes: '',
  });

  // Supplier form
  const [sForm, setSForm] = useState({
    name: '',
    name_ar: '',
    category: 'oil',
    phone: '',
    city: '',
    default_payment_type: 'cash',
    credit_days: '0',
    notes: '',
  });

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      const [mRes, pRes, hcRes, sRes] = await Promise.all([
        apiFetch('/api/purchases/materials'),
        apiFetch('/api/purchases'),
        apiFetch('/api/purchases/hidden-costs'),
        apiFetch('/api/purchases/suppliers'),
      ]);
      setMaterials(mRes.materials);
      setPurchases(pRes.purchases);
      setHiddenCosts(hcRes.hidden_costs);
      setSuppliers(sRes.suppliers);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  function calcDueDate(baseDate, days) {
    if (!days || Number(days) <= 0) return '';
    const d = new Date(baseDate || new Date().toISOString().slice(0, 10));
    d.setDate(d.getDate() + Number(days));
    return d.toISOString().slice(0, 10);
  }

  function openPurchaseFor(mat = null) {
    const selected = mat || materials[0];
    const defaultSup = suppliers[0];
    const today = new Date().toISOString().slice(0, 10);
    const defaultPayType = defaultSup?.default_payment_type === 'credit' ? 'credit' : 'cash';
    setPForm({
      purchase_date: today,
      raw_material_id: selected ? String(selected.id) : '',
      supplier_id: defaultSup ? String(defaultSup.id) : '',
      purchase_qty: selected?.category === 'oil' ? '5' : '100',
      units_per_purchase: selected ? String(Number(selected.units_per_purchase) || 1) : '1',
      unit_price: selected?.category === 'oil' ? '5100' : '',
      hidden_cost: '0',
      harvest_lot: '',
      payment_type: defaultPayType,
      amount_paid: '0',
      due_date: defaultPayType === 'credit' ? calcDueDate(today, defaultSup?.credit_days || 30) : '',
      notes: '',
    });
    setShowPurchaseModal(true);
  }

  function onSelectPurchaseSupplier(supId) {
    const sup = suppliers.find((s) => String(s.id) === String(supId));
    const payType = sup?.default_payment_type === 'credit' ? 'credit' : 'cash';
    setPForm((prev) => ({
      ...prev,
      supplier_id: supId,
      payment_type: payType,
      due_date: payType === 'credit' ? calcDueDate(prev.purchase_date, sup?.credit_days || 30) : '',
    }));
  }

  function onSelectPurchaseMaterial(matId) {
    const m = materials.find((x) => String(x.id) === String(matId));
    setPForm((prev) => ({
      ...prev,
      raw_material_id: matId,
      units_per_purchase: m ? String(Number(m.units_per_purchase) || 1) : '1',
    }));
  }

  const selectedMat = materials.find((m) => String(m.id) === String(pForm.raw_material_id));
  const previewQty = Number(pForm.purchase_qty) || 0;
  const previewFactor = Number(pForm.units_per_purchase) || 1;
  const previewBaseAdded = previewQty * previewFactor;
  const previewSubtotal = previewQty * (Number(pForm.unit_price) || 0);
  const previewLanded = previewSubtotal + (Number(pForm.hidden_cost) || 0);
  const previewPerBase = previewBaseAdded > 0 ? previewLanded / previewBaseAdded : 0;
  const previewRemainingDue =
    pForm.payment_type === 'credit'
      ? Math.max(0, previewLanded - (Number(pForm.amount_paid) || 0))
      : 0;

  async function submitPurchase(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiFetch('/api/purchases', {
        method: 'POST',
        body: {
          ...pForm,
          raw_material_id: Number(pForm.raw_material_id),
          supplier_id: pForm.supplier_id ? Number(pForm.supplier_id) : null,
          purchase_qty: Number(pForm.purchase_qty),
          units_per_purchase: Number(pForm.units_per_purchase),
          unit_price: Number(pForm.unit_price),
          hidden_cost: Number(pForm.hidden_cost) || 0,
          payment_type: pForm.payment_type,
          amount_paid: pForm.payment_type === 'credit' ? Number(pForm.amount_paid || 0) : previewLanded,
          due_date: pForm.payment_type === 'credit' && pForm.due_date ? pForm.due_date : null,
        },
      });
      setShowPurchaseModal(false);
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function submitHiddenCost(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiFetch('/api/purchases/hidden-costs', {
        method: 'POST',
        body: { ...hcForm, amount: Number(hcForm.amount), allocation_scope: 'overhead' },
      });
      setShowHiddenModal(false);
      setHcForm({ cost_date: new Date().toISOString().slice(0, 10), category: 'shipping_inbound', title: '', title_ar: '', amount: '', notes: '' });
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteHiddenCost(id) {
    try {
      await apiFetch(`/api/purchases/hidden-costs/${id}`, { method: 'DELETE' });
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  async function submitMaterial(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const isOil = mForm.category === 'oil';
      await apiFetch('/api/purchases/materials', {
        method: 'POST',
        body: {
          ...mForm,
          base_unit: isOil ? 'litre' : 'pcs',
          purchase_unit: isOil ? 'gallon_17l' : 'pcs',
          units_per_purchase: isOil ? Number(mForm.units_per_purchase || 17) : 1,
          capacity_ml: mForm.category === 'container' ? Number(mForm.capacity_ml || 500) : null,
          min_stock: Number(mForm.min_stock || 0),
        },
      });
      setShowMaterialModal(false);
      setMForm({ code: '', name: '', name_ar: '', category: 'container', container_material: 'glass', capacity_ml: '500', units_per_purchase: '1', min_stock: '20', notes: '' });
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function submitSupplier(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiFetch('/api/purchases/suppliers', { method: 'POST', body: sForm });
      setShowSupplierModal(false);
      setSForm({ name: '', name_ar: '', category: 'oil', phone: '', city: '', notes: '' });
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const filteredMaterials =
    catFilter === 'all' ? materials : materials.filter((m) => m.category === catFilter);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t(lang, 'purchasesTitle')}</h1>
          <p className="page-subtitle">{t(lang, 'purchasesSubtitle')}</p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn btn-secondary" onClick={() => setShowHiddenModal(true)}>
            <Receipt size={15} />
            {t(lang, 'btnNewHiddenCost')}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setShowMaterialModal(true)}>
            <Plus size={15} />
            {t(lang, 'btnNewMaterial')}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => openPurchaseFor()}>
            <Plus size={15} />
            {t(lang, 'btnNewPurchase')}
          </button>
        </div>
      </div>

      {error && <div className="alert-banner error">{error}</div>}

      <div className="tabs-bar">
        <button type="button" className={`tab-btn ${tab === 'stock' ? 'active' : ''}`} onClick={() => setTab('stock')}>
          {t(lang, 'tabRawStock')} ({materials.length})
        </button>
        <button type="button" className={`tab-btn ${tab === 'purchases' ? 'active' : ''}`} onClick={() => setTab('purchases')}>
          {t(lang, 'tabPurchaseLog')} ({purchases.length})
        </button>
        <button type="button" className={`tab-btn ${tab === 'hidden' ? 'active' : ''}`} onClick={() => setTab('hidden')}>
          {t(lang, 'tabHiddenCosts')} ({hiddenCosts.length})
        </button>
        <button type="button" className={`tab-btn ${tab === 'suppliers' ? 'active' : ''}`} onClick={() => setTab('suppliers')}>
          {t(lang, 'tabSuppliers')} ({suppliers.length})
        </button>
      </div>

      {/* TAB 1: RAW INVENTORY STOCK */}
      {tab === 'stock' && (
        <div>
          <div className="filter-pills">
            {['all', 'oil', 'container', 'sticker', 'packaging'].map((c) => (
              <button
                key={c}
                type="button"
                className={`pill-btn ${catFilter === c ? 'active' : ''}`}
                onClick={() => setCatFilter(c)}
              >
                {c === 'all' ? t(lang, 'all') : t(lang, `cat_${c}`)}
              </button>
            ))}
          </div>

          <div className="card">
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t(lang, 'material')}</th>
                    <th>{t(lang, 'category')}</th>
                    <th>{t(lang, 'inStock')}</th>
                    <th>{t(lang, 'avgLandedCost')}</th>
                    <th>{t(lang, 'stockValue')}</th>
                    <th>{t(lang, 'actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && materials.length === 0 ? (
                    <tr><td colSpan="6">{t(lang, 'loading')}</td></tr>
                  ) : (
                    filteredMaterials.map((m) => {
                      const isLow = Number(m.stock_qty) <= Number(m.min_stock);
                      const val = Number(m.stock_qty) * Number(m.avg_unit_cost);
                      return (
                        <tr key={m.id}>
                          <td>
                            <div className="cell-main">{pickName(m, lang)}</div>
                            <div className="cell-sub">
                              {m.code}
                              {m.category === 'container' && m.capacity_ml
                                ? ` · ${t(lang, m.container_material)} ${m.capacity_ml}ml`
                                : ''}
                            </div>
                          </td>
                          <td>
                            <span
                              className={`badge ${
                                m.category === 'oil'
                                  ? 'badge-gold'
                                  : m.category === 'container'
                                    ? 'badge-olive'
                                    : 'badge-slate'
                              }`}
                            >
                              {t(lang, `cat_${m.category}`)}
                            </span>
                          </td>
                          <td className="num">
                            <div className="cell-main" style={{ color: isLow ? 'var(--clay-danger)' : undefined }}>
                              {formatNum(m.stock_qty, m.category === 'oil' ? 1 : 0)}{' '}
                              {m.base_unit === 'litre' ? t(lang, 'litres') : t(lang, 'pcs')}
                            </div>
                            {m.category === 'oil' && (
                              <div className="cell-sub">
                                ≈ {formatNum(m.equivalent_gallons, 2)} {t(lang, 'gallons')}
                              </div>
                            )}
                          </td>
                          <td className="num">
                            {formatEGP(m.avg_unit_cost, lang)} / {m.base_unit === 'litre' ? t(lang, 'litres') : t(lang, 'pcs')}
                          </td>
                          <td className="num cell-main">{formatEGP(val, lang)}</td>
                          <td>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => openPurchaseFor(m)}
                            >
                              + {t(lang, 'btnNewPurchase')}
                            </button>
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

      {/* TAB 2: PURCHASE LOG */}
      {tab === 'purchases' && (
        <div className="card">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t(lang, 'date')}</th>
                  <th>{t(lang, 'material')}</th>
                  <th>{t(lang, 'supplier')}</th>
                  <th>{t(lang, 'purchaseQty')}</th>
                  <th>{t(lang, 'totalBaseAdded')}</th>
                  <th>{t(lang, 'totalLanded')}</th>
                  <th>{t(lang, 'paymentType')}</th>
                  <th>{t(lang, 'landedPerUnit')}</th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((p) => {
                  const isCredit = p.payment_type === 'credit';
                  const rem = Number(p.remaining_due || 0);
                  return (
                    <tr key={p.id}>
                      <td>
                        <div className="cell-main">{p.reference_no}</div>
                        <div className="cell-sub">{String(p.purchase_date).slice(0, 10)}</div>
                      </td>
                      <td>
                        <div className="cell-main">{pickName(p, lang, 'material_name')}</div>
                        {p.harvest_lot && <div className="cell-sub">{p.harvest_lot}</div>}
                      </td>
                      <td>{pickName(p, lang, 'supplier_name') || '—'}</td>
                      <td className="num">
                        {formatNum(p.purchase_qty, 2)} × {formatEGP(p.unit_price, lang)}
                      </td>
                      <td className="num cell-main">
                        {formatNum(p.base_qty, 1)} {p.base_unit === 'litre' ? t(lang, 'litres') : t(lang, 'pcs')}
                      </td>
                      <td className="num">
                        <div className="cell-main">{formatEGP(p.total_landed_cost, lang)}</div>
                        {Number(p.hidden_cost) > 0 && (
                          <div className="cell-sub">+{formatEGP(p.hidden_cost, lang)}</div>
                        )}
                      </td>
                      <td>
                        <span className={`badge ${!isCredit ? 'badge-emerald' : rem > 0 ? 'badge-clay' : 'badge-gold'}`}>
                          {t(lang, `payType_${p.payment_type || 'cash'}`)}
                        </span>
                        {isCredit && rem > 0 && (
                          <div className="cell-sub num" style={{ color: 'var(--clay-danger)' }}>
                            {t(lang, 'remainingDue')}: {formatEGP(rem, lang)}
                          </div>
                        )}
                        {isCredit && p.due_date && rem > 0 && (
                          <div className="cell-sub num">
                            {t(lang, 'dueDate')}: {String(p.due_date).slice(0, 10)}
                          </div>
                        )}
                      </td>
                      <td className="num">
                        <span className="badge badge-olive">
                          {formatEGP(p.landed_cost_per_base_unit, lang)} / {p.base_unit === 'litre' ? t(lang, 'litres') : t(lang, 'pcs')}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: HIDDEN COSTS */}
      {tab === 'hidden' && (
        <div className="card">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t(lang, 'date')}</th>
                  <th>{t(lang, 'hiddenCostCategory')}</th>
                  <th>{t(lang, 'notes')}</th>
                  <th>{t(lang, 'hiddenCostScope')}</th>
                  <th>{t(lang, 'egp')}</th>
                  <th>{t(lang, 'actions')}</th>
                </tr>
              </thead>
              <tbody>
                {hiddenCosts.map((hc) => (
                  <tr key={hc.id}>
                    <td className="num">{String(hc.cost_date).slice(0, 10)}</td>
                    <td>
                      <div className="cell-main">{pickName(hc, lang, 'title')}</div>
                      <div className="cell-sub">{t(lang, `hc_${hc.category}`)}</div>
                    </td>
                    <td>
                      <div>{hc.notes || '—'}</div>
                      {hc.related_ref && <div className="cell-sub">{hc.related_ref}</div>}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          hc.allocation_scope === 'overhead' ? 'badge-clay' : 'badge-neutral'
                        }`}
                      >
                        {t(lang, `scope_${hc.allocation_scope}`)}
                      </span>
                    </td>
                    <td className="num cell-main">{formatEGP(hc.amount, lang)}</td>
                    <td>
                      {hc.allocation_scope === 'overhead' ? (
                        <button
                          type="button"
                          className="btn btn-danger-ghost btn-sm"
                          onClick={() => deleteHiddenCost(hc.id)}
                          aria-label={t(lang, 'delete')}
                        >
                          <Trash2 size={14} />
                        </button>
                      ) : (
                        <span className="cell-sub">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: SUPPLIERS */}
      {tab === 'suppliers' && (
        <div>
          <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setShowSupplierModal(true)}>
              <Users size={15} />
              {t(lang, 'btnNewSupplier')}
            </button>
          </div>
          <div className="card">
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t(lang, 'supplier')}</th>
                    <th>{t(lang, 'category')}</th>
                    <th>{t(lang, 'defaultPaymentType')}</th>
                    <th>{t(lang, 'remainingDue')}</th>
                    <th>{t(lang, 'customerPhone')}</th>
                    <th>{t(lang, 'city')}</th>
                  </tr>
                </thead>
                <tbody>
                  {suppliers.map((s) => (
                    <tr key={s.id}>
                      <td className="cell-main">{pickName(s, lang)}</td>
                      <td><span className="badge badge-olive">{t(lang, `supCat_${s.category}`)}</span></td>
                      <td>
                        <span className={`badge ${s.default_payment_type === 'credit' ? 'badge-gold' : 'badge-emerald'}`}>
                          {t(lang, `payType_${s.default_payment_type || 'cash'}`)}
                        </span>
                      </td>
                      <td className={`num ${Number(s.balance_due) > 0 ? 'val-negative' : 'val-positive'}`}>
                        {formatEGP(s.balance_due || 0, lang)}
                      </td>
                      <td className="num">{s.phone || '—'}</td>
                      <td>{s.city || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: RECORD PURCHASE */}
      <Modal
        open={showPurchaseModal}
        title={t(lang, 'btnNewPurchase')}
        onClose={() => setShowPurchaseModal(false)}
        wide
      >
        <form onSubmit={submitPurchase}>
          <div className="form-grid">
            <div className="form-field full">
              <label className="form-label">{t(lang, 'material')}</label>
              <select
                className="select"
                value={pForm.raw_material_id}
                onChange={(e) => onSelectPurchaseMaterial(e.target.value)}
                required
              >
                <option value="">—</option>
                {materials.map((m) => (
                  <option key={m.id} value={m.id}>
                    {pickName(m, lang)} ({m.code}) — {m.category === 'oil' ? '17L Gallon' : m.base_unit}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label className="form-label">{t(lang, 'supplier')}</label>
              <select
                className="select"
                value={pForm.supplier_id}
                onChange={(e) => onSelectPurchaseSupplier(e.target.value)}
              >
                <option value="">—</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {pickName(s, lang)} ({t(lang, `payType_${s.default_payment_type || 'cash'}`)})
                  </option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label className="form-label">{t(lang, 'date')}</label>
              <input
                type="date"
                className="input"
                value={pForm.purchase_date}
                onChange={(e) => setPForm({ ...pForm, purchase_date: e.target.value })}
                required
              />
            </div>

            <div className="form-field">
              <label className="form-label">
                {t(lang, 'purchaseQty')} ({selectedMat?.category === 'oil' ? t(lang, 'gallons') : t(lang, 'pcs')})
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                className="input"
                value={pForm.purchase_qty}
                onChange={(e) => setPForm({ ...pForm, purchase_qty: e.target.value })}
                required
              />
            </div>

            <div className="form-field">
              <label className="form-label">{t(lang, 'unitsPerPurchase')}</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                className="input"
                value={pForm.units_per_purchase}
                onChange={(e) => setPForm({ ...pForm, units_per_purchase: e.target.value })}
                required
              />
            </div>

            <div className="form-field">
              <label className="form-label">{t(lang, 'unitPrice')}</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="input"
                value={pForm.unit_price}
                onChange={(e) => setPForm({ ...pForm, unit_price: e.target.value })}
                required
              />
            </div>

            <div className="form-field">
              <label className="form-label">{t(lang, 'attachedHiddenCost')}</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="input"
                value={pForm.hidden_cost}
                onChange={(e) => setPForm({ ...pForm, hidden_cost: e.target.value })}
              />
            </div>

            <div className="form-field">
              <label className="form-label">{t(lang, 'paymentType')}</label>
              <select
                className="select"
                value={pForm.payment_type}
                onChange={(e) => {
                  const nextType = e.target.value;
                  const sup = suppliers.find((s) => String(s.id) === String(pForm.supplier_id));
                  setPForm({
                    ...pForm,
                    payment_type: nextType,
                    amount_paid: nextType === 'credit' ? '0' : String(previewLanded),
                    due_date:
                      nextType === 'credit'
                        ? pForm.due_date || calcDueDate(pForm.purchase_date, sup?.credit_days || 30)
                        : '',
                  });
                }}
              >
                <option value="cash">{t(lang, 'payType_cash')}</option>
                <option value="credit">{t(lang, 'payType_credit')}</option>
              </select>
            </div>

            {pForm.payment_type === 'credit' && (
              <>
                <div className="form-field">
                  <label className="form-label">{t(lang, 'amountPaidNow')}</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="input"
                    value={pForm.amount_paid}
                    onChange={(e) => setPForm({ ...pForm, amount_paid: e.target.value })}
                  />
                </div>
                <div className="form-field">
                  <label className="form-label">{t(lang, 'dueDate')}</label>
                  <input
                    type="date"
                    className="input"
                    value={pForm.due_date}
                    onChange={(e) => setPForm({ ...pForm, due_date: e.target.value })}
                  />
                </div>
              </>
            )}

            <div className="form-field">
              <label className="form-label">{t(lang, 'harvestLot')}</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. Sinai Nov-26 #A2"
                value={pForm.harvest_lot}
                onChange={(e) => setPForm({ ...pForm, harvest_lot: e.target.value })}
              />
            </div>

            <div className="form-field">
              <label className="form-label">{t(lang, 'notes')}</label>
              <input
                type="text"
                className="input"
                value={pForm.notes}
                onChange={(e) => setPForm({ ...pForm, notes: e.target.value })}
              />
            </div>
          </div>

          <div className="preview-box">
            <div className="preview-box-title">
              <Calculator size={15} />
              {t(lang, 'liveConversion')}
            </div>
            <div className="preview-grid">
              <div>
                <div className="mini-metric-label">{t(lang, 'totalBaseAdded')}</div>
                <div className="mini-metric-val num">
                  {formatNum(previewBaseAdded, 2)}{' '}
                  {selectedMat?.base_unit === 'litre' ? t(lang, 'litres') : t(lang, 'pcs')}
                </div>
              </div>
              <div>
                <div className="mini-metric-label">{t(lang, 'totalLanded')}</div>
                <div className="mini-metric-val num">{formatEGP(previewLanded, lang)}</div>
              </div>
              <div>
                <div className="mini-metric-label">
                  {pForm.payment_type === 'credit' ? t(lang, 'remainingDue') : t(lang, 'landedPerUnit')}
                </div>
                <div
                  className="mini-metric-val num"
                  style={{ color: pForm.payment_type === 'credit' ? 'var(--clay-danger)' : 'var(--olive-text)' }}
                >
                  {pForm.payment_type === 'credit'
                    ? formatEGP(previewRemainingDue, lang)
                    : formatEGP(previewPerBase, lang)}
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setShowPurchaseModal(false)}>
              {t(lang, 'cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              <Truck size={15} />
              {t(lang, 'save')}
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL: LOG HIDDEN COST */}
      <Modal
        open={showHiddenModal}
        title={t(lang, 'btnNewHiddenCost')}
        onClose={() => setShowHiddenModal(false)}
      >
        <form onSubmit={submitHiddenCost}>
          <div className="form-grid">
            <div className="form-field">
              <label className="form-label">{t(lang, 'date')}</label>
              <input
                type="date"
                className="input"
                value={hcForm.cost_date}
                onChange={(e) => setHcForm({ ...hcForm, cost_date: e.target.value })}
                required
              />
            </div>
            <div className="form-field">
              <label className="form-label">{t(lang, 'hiddenCostCategory')}</label>
              <select
                className="select"
                value={hcForm.category}
                onChange={(e) => setHcForm({ ...hcForm, category: e.target.value })}
              >
                {['shipping_inbound', 'spillage_waste', 'labor', 'utilities', 'storage', 'packaging_misc', 'customs_fees', 'other'].map(
                  (c) => (
                    <option key={c} value={c}>
                      {t(lang, `hc_${c}`)}
                    </option>
                  )
                )}
              </select>
            </div>
            <div className="form-field full">
              <label className="form-label">Title (EN)</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. Filter papers & funnel cleaning"
                value={hcForm.title}
                onChange={(e) => setHcForm({ ...hcForm, title: e.target.value })}
                required
              />
            </div>
            <div className="form-field full">
              <label className="form-label">العنوان (عربي)</label>
              <input
                type="text"
                className="input"
                placeholder="مثال: فلاتر تصفية وتنظيف معدات"
                value={hcForm.title_ar}
                onChange={(e) => setHcForm({ ...hcForm, title_ar: e.target.value })}
              />
            </div>
            <div className="form-field">
              <label className="form-label">{t(lang, 'egp')}</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                className="input"
                value={hcForm.amount}
                onChange={(e) => setHcForm({ ...hcForm, amount: e.target.value })}
                required
              />
            </div>
            <div className="form-field">
              <label className="form-label">{t(lang, 'notes')}</label>
              <input
                type="text"
                className="input"
                value={hcForm.notes}
                onChange={(e) => setHcForm({ ...hcForm, notes: e.target.value })}
              />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setShowHiddenModal(false)}>
              {t(lang, 'cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {t(lang, 'save')}
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL: NEW RAW MATERIAL */}
      <Modal
        open={showMaterialModal}
        title={t(lang, 'btnNewMaterial')}
        onClose={() => setShowMaterialModal(false)}
      >
        <form onSubmit={submitMaterial}>
          <div className="form-grid">
            <div className="form-field">
              <label className="form-label">Code</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. BTL-TIN-500"
                value={mForm.code}
                onChange={(e) => setMForm({ ...mForm, code: e.target.value })}
                required
              />
            </div>
            <div className="form-field">
              <label className="form-label">{t(lang, 'category')}</label>
              <select
                className="select"
                value={mForm.category}
                onChange={(e) =>
                  setMForm({
                    ...mForm,
                    category: e.target.value,
                    units_per_purchase: e.target.value === 'oil' ? '17' : '1',
                  })
                }
              >
                <option value="oil">{t(lang, 'cat_oil')}</option>
                <option value="container">{t(lang, 'cat_container')}</option>
                <option value="sticker">{t(lang, 'cat_sticker')}</option>
                <option value="packaging">{t(lang, 'cat_packaging')}</option>
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">Name (EN)</label>
              <input
                type="text"
                className="input"
                value={mForm.name}
                onChange={(e) => setMForm({ ...mForm, name: e.target.value })}
                required
              />
            </div>
            <div className="form-field">
              <label className="form-label">الاسم (عربي)</label>
              <input
                type="text"
                className="input"
                value={mForm.name_ar}
                onChange={(e) => setMForm({ ...mForm, name_ar: e.target.value })}
              />
            </div>
            {mForm.category === 'container' && (
              <>
                <div className="form-field">
                  <label className="form-label">{t(lang, 'containerType')}</label>
                  <select
                    className="select"
                    value={mForm.container_material}
                    onChange={(e) => setMForm({ ...mForm, container_material: e.target.value })}
                  >
                    <option value="glass">{t(lang, 'glass')}</option>
                    <option value="tin">{t(lang, 'tin')}</option>
                    <option value="sachet">{t(lang, 'sachet')}</option>
                  </select>
                </div>
                <div className="form-field">
                  <label className="form-label">Capacity (ml)</label>
                  <input
                    type="number"
                    className="input"
                    value={mForm.capacity_ml}
                    onChange={(e) => setMForm({ ...mForm, capacity_ml: e.target.value })}
                  />
                </div>
              </>
            )}
            {mForm.category === 'oil' && (
              <div className="form-field">
                <label className="form-label">Litres / Gallon</label>
                <input
                  type="number"
                  className="input"
                  value={mForm.units_per_purchase}
                  onChange={(e) => setMForm({ ...mForm, units_per_purchase: e.target.value })}
                />
              </div>
            )}
            <div className="form-field">
              <label className="form-label">{t(lang, 'minAlert')}</label>
              <input
                type="number"
                className="input"
                value={mForm.min_stock}
                onChange={(e) => setMForm({ ...mForm, min_stock: e.target.value })}
              />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setShowMaterialModal(false)}>
              {t(lang, 'cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              <Droplets size={15} />
              {t(lang, 'save')}
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL: NEW SUPPLIER */}
      <Modal
        open={showSupplierModal}
        title={t(lang, 'btnNewSupplier')}
        onClose={() => setShowSupplierModal(false)}
      >
        <form onSubmit={submitSupplier}>
          <div className="form-grid">
            <div className="form-field">
              <label className="form-label">Name (EN)</label>
              <input
                type="text"
                className="input"
                value={sForm.name}
                onChange={(e) => setSForm({ ...sForm, name: e.target.value })}
                required
              />
            </div>
            <div className="form-field">
              <label className="form-label">الاسم (عربي)</label>
              <input
                type="text"
                className="input"
                value={sForm.name_ar}
                onChange={(e) => setSForm({ ...sForm, name_ar: e.target.value })}
              />
            </div>
            <div className="form-field">
              <label className="form-label">{t(lang, 'category')}</label>
              <select
                className="select"
                value={sForm.category}
                onChange={(e) => setSForm({ ...sForm, category: e.target.value })}
              >
                <option value="oil">Oil Mill</option>
                <option value="bottles">Tin & Glass Bottles</option>
                <option value="stickers">Stickers & Print</option>
                <option value="logistics">Shipping / Freight</option>
              </select>
            </div>
            <div className="form-field">
              <label className="form-label">{t(lang, 'customerPhone')}</label>
              <input
                type="text"
                className="input"
                value={sForm.phone}
                onChange={(e) => setSForm({ ...sForm, phone: e.target.value })}
              />
            </div>
            <div className="form-field full">
              <label className="form-label">{t(lang, 'city')}</label>
              <input
                type="text"
                className="input"
                value={sForm.city}
                onChange={(e) => setSForm({ ...sForm, city: e.target.value })}
              />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setShowSupplierModal(false)}>
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
