import React, { useEffect, useState } from 'react';
import {
  Banknote,
  Clock,
  Edit3,
  Plus,
  Receipt,
  Trash2,
  Users,
  Wallet,
} from 'lucide-react';
import { apiFetch } from '../api.js';
import { formatEGP, pickName, t } from '../i18n.js';
import Modal from '../components/Modal.jsx';
import StatCard from '../components/StatCard.jsx';

const EMPTY_SUPPLIER = {
  name: '',
  name_ar: '',
  category: 'oil',
  phone: '',
  city: '',
  default_payment_type: 'cash',
  credit_days: '0',
  notes: '',
};

export default function Suppliers({ lang }) {
  const [tab, setTab] = useState('directory');
  const [suppliers, setSuppliers] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [showSupModal, setShowSupModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [sForm, setSForm] = useState(EMPTY_SUPPLIER);

  const [showPayModal, setShowPayModal] = useState(false);
  const [payForm, setPayForm] = useState({
    supplier_id: '',
    purchase_id: '',
    amount: '',
    payment_method: 'cash',
    payment_date: new Date().toISOString().slice(0, 10),
    reference_no: '',
    notes: '',
  });

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      const [sRes, pRes, payRes] = await Promise.all([
        apiFetch('/api/purchases/suppliers'),
        apiFetch('/api/purchases'),
        apiFetch('/api/purchases/supplier-payments').catch(() => ({ payments: [] })),
      ]);
      setSuppliers(sRes.suppliers || []);
      setPurchases(pRes.purchases || []);
      setPayments(payRes.payments || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  function openNewSupplier() {
    setEditingId(null);
    setSForm(EMPTY_SUPPLIER);
    setShowSupModal(true);
  }

  function openEditSupplier(sup) {
    setEditingId(sup.id);
    setSForm({
      name: sup.name || '',
      name_ar: sup.name_ar || '',
      category: sup.category || 'general',
      phone: sup.phone || '',
      city: sup.city || '',
      default_payment_type: sup.default_payment_type || 'cash',
      credit_days: String(sup.credit_days ?? 0),
      notes: sup.notes || '',
    });
    setShowSupModal(true);
  }

  function openPayModal(sup = null, purchase = null) {
    const targetSup = sup || suppliers.find((s) => Number(s.balance_due) > 0) || suppliers[0];
    const defaultAmt = purchase
      ? Number(purchase.remaining_due || 0)
      : targetSup
        ? Number(targetSup.balance_due || 0)
        : 0;
    setPayForm({
      supplier_id: targetSup ? String(targetSup.id) : '',
      purchase_id: purchase ? String(purchase.id) : '',
      amount: defaultAmt > 0 ? String(defaultAmt) : '',
      payment_method: 'cash',
      payment_date: new Date().toISOString().slice(0, 10),
      reference_no: '',
      notes: '',
    });
    setShowPayModal(true);
  }

  async function submitSupplier(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        ...sForm,
        credit_days: sForm.default_payment_type === 'credit' ? Number(sForm.credit_days || 0) : 0,
      };
      if (editingId) {
        await apiFetch(`/api/purchases/suppliers/${editingId}`, {
          method: 'PATCH',
          body: payload,
        });
      } else {
        await apiFetch('/api/purchases/suppliers', {
          method: 'POST',
          body: payload,
        });
      }
      setShowSupModal(false);
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteSupplier(id) {
    setError('');
    try {
      await apiFetch(`/api/purchases/suppliers/${id}`, { method: 'DELETE' });
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  async function submitPayment(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiFetch('/api/purchases/supplier-payments', {
        method: 'POST',
        body: {
          supplier_id: Number(payForm.supplier_id),
          purchase_id: payForm.purchase_id ? Number(payForm.purchase_id) : null,
          amount: Number(payForm.amount),
          payment_method: payForm.payment_method,
          payment_date: payForm.payment_date,
          reference_no: payForm.reference_no,
          notes: payForm.notes,
        },
      });
      setShowPayModal(false);
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const totalPurchased = suppliers.reduce((acc, s) => acc + Number(s.total_purchased || 0), 0);
  const totalPaid = suppliers.reduce((acc, s) => acc + Number(s.total_paid || 0), 0);
  const totalDue = suppliers.reduce((acc, s) => acc + Number(s.balance_due || 0), 0);
  const openCreditPurchases = purchases.filter((p) => Number(p.remaining_due || 0) > 0.01);
  const supplierOpenInvoices = openCreditPurchases.filter(
    (p) => String(p.supplier_id) === String(payForm.supplier_id)
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t(lang, 'suppliersPageTitle')}</h1>
          <p className="page-subtitle">{t(lang, 'suppliersPageSubtitle')}</p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn btn-secondary" onClick={() => openPayModal()}>
            <Banknote size={15} />
            {t(lang, 'btnRecordPayment')}
          </button>
          <button type="button" className="btn btn-primary" onClick={openNewSupplier}>
            <Plus size={15} />
            {t(lang, 'btnNewSupplier')}
          </button>
        </div>
      </div>

      {error && <div className="alert-banner error">{error}</div>}

      {/* Top KPI Summary */}
      <section className="kpi-grid">
        <StatCard
          label={t(lang, 'totalSuppliers')}
          value={suppliers.length}
          icon={Users}
          tone="olive"
        />
        <StatCard
          label={t(lang, 'totalPurchased')}
          value={formatEGP(totalPurchased, lang)}
          icon={Receipt}
          tone="gold"
        />
        <StatCard
          label={t(lang, 'totalPaid')}
          value={formatEGP(totalPaid, lang)}
          icon={Wallet}
          tone="emerald"
        />
        <StatCard
          label={t(lang, 'totalCreditDue')}
          value={formatEGP(totalDue, lang)}
          sub={`${openCreditPurchases.length} ${t(lang, 'tabCreditInvoices')}`}
          icon={Clock}
          tone={totalDue > 0 ? 'clay' : 'emerald'}
        />
      </section>

      <div className="tabs-bar">
        <button
          type="button"
          className={`tab-btn ${tab === 'directory' ? 'active' : ''}`}
          onClick={() => setTab('directory')}
        >
          {t(lang, 'tabSuppliersDir')} ({suppliers.length})
        </button>
        <button
          type="button"
          className={`tab-btn ${tab === 'credit' ? 'active' : ''}`}
          onClick={() => setTab('credit')}
        >
          {t(lang, 'tabCreditInvoices')} ({openCreditPurchases.length})
        </button>
        <button
          type="button"
          className={`tab-btn ${tab === 'payments' ? 'active' : ''}`}
          onClick={() => setTab('payments')}
        >
          {t(lang, 'tabPaymentHistory')} ({payments.length})
        </button>
      </div>

      {/* TAB 1: SUPPLIERS DIRECTORY */}
      {tab === 'directory' && (
        <div className="card">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t(lang, 'supplier')}</th>
                  <th>{t(lang, 'category')}</th>
                  <th>{t(lang, 'defaultPaymentType')}</th>
                  <th>{t(lang, 'totalPurchased')}</th>
                  <th>{t(lang, 'totalPaid')}</th>
                  <th>{t(lang, 'remainingDue')}</th>
                  <th>{t(lang, 'actions')}</th>
                </tr>
              </thead>
              <tbody>
                {loading && suppliers.length === 0 ? (
                  <tr><td colSpan="7">{t(lang, 'loading')}</td></tr>
                ) : suppliers.length === 0 ? (
                  <tr><td colSpan="7">{t(lang, 'noData')}</td></tr>
                ) : (
                  suppliers.map((s) => {
                    const due = Number(s.balance_due || 0);
                    const isCredit = s.default_payment_type === 'credit';
                    return (
                      <tr key={s.id}>
                        <td>
                          <div className="cell-main">{pickName(s, lang)}</div>
                          <div className="cell-sub">
                            {s.phone || '—'} {s.city ? `· ${s.city}` : ''}
                          </div>
                        </td>
                        <td>
                          <span className="badge badge-olive">
                            {t(lang, `supCat_${s.category}`)}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${isCredit ? 'badge-gold' : 'badge-emerald'}`}>
                            {t(lang, `payType_${s.default_payment_type || 'cash'}`)}
                            {isCredit && Number(s.credit_days) > 0 ? ` (${s.credit_days}d)` : ''}
                          </span>
                        </td>
                        <td className="num">{formatEGP(s.total_purchased, lang)}</td>
                        <td className="num">{formatEGP(s.total_paid, lang)}</td>
                        <td className="num">
                          <span className={due > 0 ? 'val-negative' : 'val-positive'}>
                            {formatEGP(due, lang)}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {due > 0 && (
                              <button
                                type="button"
                                className="btn btn-gold btn-sm"
                                onClick={() => openPayModal(s)}
                              >
                                <Banknote size={13} />
                                {t(lang, 'settlePay')}
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => openEditSupplier(s)}
                              aria-label={t(lang, 'edit')}
                            >
                              <Edit3 size={13} />
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger-ghost btn-sm"
                              onClick={() => deleteSupplier(s.id)}
                              aria-label={t(lang, 'delete')}
                            >
                              <Trash2 size={13} />
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

      {/* TAB 2: OPEN CREDIT (آجل) INVOICES */}
      {tab === 'credit' && (
        <div className="card">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t(lang, 'date')}</th>
                  <th>{t(lang, 'supplier')}</th>
                  <th>{t(lang, 'material')}</th>
                  <th>{t(lang, 'totalLanded')}</th>
                  <th>{t(lang, 'totalPaid')}</th>
                  <th>{t(lang, 'remainingDue')}</th>
                  <th>{t(lang, 'dueDate')}</th>
                  <th>{t(lang, 'actions')}</th>
                </tr>
              </thead>
              <tbody>
                {openCreditPurchases.length === 0 ? (
                  <tr><td colSpan="8">{t(lang, 'noData')}</td></tr>
                ) : (
                  openCreditPurchases.map((p) => {
                    const sup = suppliers.find((s) => s.id === p.supplier_id);
                    return (
                      <tr key={p.id}>
                        <td>
                          <div className="cell-main">{p.reference_no}</div>
                          <div className="cell-sub">{String(p.purchase_date).slice(0, 10)}</div>
                        </td>
                        <td className="cell-main">{pickName(p, lang, 'supplier_name') || '—'}</td>
                        <td>{pickName(p, lang, 'material_name')}</td>
                        <td className="num">{formatEGP(p.total_landed_cost, lang)}</td>
                        <td className="num">{formatEGP(p.amount_paid, lang)}</td>
                        <td className="num val-negative">{formatEGP(p.remaining_due, lang)}</td>
                        <td className="num">{p.due_date ? String(p.due_date).slice(0, 10) : '—'}</td>
                        <td>
                          {sup && (
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => openPayModal(sup, p)}
                            >
                              <Banknote size={13} />
                              {t(lang, 'settlePay')}
                            </button>
                          )}
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

      {/* TAB 3: SUPPLIER PAYMENT SETTLEMENTS */}
      {tab === 'payments' && (
        <div className="card">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t(lang, 'date')}</th>
                  <th>{t(lang, 'supplier')}</th>
                  <th>{t(lang, 'paymentStatus')}</th>
                  <th>{t(lang, 'egp')}</th>
                  <th>{t(lang, 'notes')}</th>
                </tr>
              </thead>
              <tbody>
                {payments.length === 0 ? (
                  <tr><td colSpan="5">{t(lang, 'noData')}</td></tr>
                ) : (
                  payments.map((pm) => (
                    <tr key={pm.id}>
                      <td>
                        <div className="cell-main">{pm.reference_no || `#${pm.id}`}</div>
                        <div className="cell-sub">{String(pm.payment_date).slice(0, 10)}</div>
                      </td>
                      <td className="cell-main">{pickName(pm, lang, 'supplier_name')}</td>
                      <td>
                        <span className="badge badge-olive">{t(lang, `pay_${pm.payment_method}`)}</span>
                        {pm.purchase_ref && <div className="cell-sub">{pm.purchase_ref}</div>}
                      </td>
                      <td className="num val-positive">{formatEGP(pm.amount, lang)}</td>
                      <td className="cell-sub">{pm.notes || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* MODAL: CREATE / EDIT SUPPLIER */}
      <Modal
        open={showSupModal}
        title={editingId ? t(lang, 'editSupplier') : t(lang, 'btnNewSupplier')}
        onClose={() => setShowSupModal(false)}
        wide
      >
        <form onSubmit={submitSupplier}>
          <div className="form-grid">
            <div className="form-field">
              <label className="form-label">Name (EN)</label>
              <input
                type="text"
                className="input"
                placeholder="e.g. Al-Arish Cold-Press Mill"
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
                placeholder="مثال: معصرة العريش للزيتون"
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
                {['oil', 'bottles', 'stickers', 'logistics', 'general'].map((c) => (
                  <option key={c} value={c}>{t(lang, `supCat_${c}`)}</option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label className="form-label">{t(lang, 'defaultPaymentType')}</label>
              <select
                className="select"
                value={sForm.default_payment_type}
                onChange={(e) =>
                  setSForm({
                    ...sForm,
                    default_payment_type: e.target.value,
                    credit_days: e.target.value === 'credit' && sForm.credit_days === '0' ? '30' : sForm.credit_days,
                  })
                }
              >
                <option value="cash">{t(lang, 'payType_cash')}</option>
                <option value="credit">{t(lang, 'payType_credit')}</option>
              </select>
            </div>

            {sForm.default_payment_type === 'credit' && (
              <div className="form-field">
                <label className="form-label">{t(lang, 'creditDays')}</label>
                <input
                  type="number"
                  min="0"
                  className="input"
                  value={sForm.credit_days}
                  onChange={(e) => setSForm({ ...sForm, credit_days: e.target.value })}
                />
              </div>
            )}

            <div className="form-field">
              <label className="form-label">{t(lang, 'customerPhone')}</label>
              <input
                type="text"
                className="input"
                placeholder="010..."
                value={sForm.phone}
                onChange={(e) => setSForm({ ...sForm, phone: e.target.value })}
              />
            </div>

            <div className="form-field">
              <label className="form-label">{t(lang, 'city')}</label>
              <input
                type="text"
                className="input"
                placeholder="El-Arish / Cairo"
                value={sForm.city}
                onChange={(e) => setSForm({ ...sForm, city: e.target.value })}
              />
            </div>

            <div className="form-field full">
              <label className="form-label">{t(lang, 'notes')}</label>
              <input
                type="text"
                className="input"
                value={sForm.notes}
                onChange={(e) => setSForm({ ...sForm, notes: e.target.value })}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setShowSupModal(false)}>
              {t(lang, 'cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {t(lang, 'save')}
            </button>
          </div>
        </form>
      </Modal>

      {/* MODAL: RECORD SUPPLIER PAYMENT (SETTLE آجل) */}
      <Modal
        open={showPayModal}
        title={t(lang, 'btnRecordPayment')}
        onClose={() => setShowPayModal(false)}
      >
        <form onSubmit={submitPayment}>
          <div className="form-grid">
            <div className="form-field full">
              <label className="form-label">{t(lang, 'supplier')}</label>
              <select
                className="select"
                value={payForm.supplier_id}
                onChange={(e) => {
                  const s = suppliers.find((x) => String(x.id) === e.target.value);
                  setPayForm({
                    ...payForm,
                    supplier_id: e.target.value,
                    purchase_id: '',
                    amount: s && Number(s.balance_due) > 0 ? String(s.balance_due) : payForm.amount,
                  });
                }}
                required
              >
                <option value="">—</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {pickName(s, lang)} — {t(lang, 'remainingDue')}: {formatEGP(s.balance_due, lang)}
                  </option>
                ))}
              </select>
            </div>

            {supplierOpenInvoices.length > 0 && (
              <div className="form-field full">
                <label className="form-label">{t(lang, 'specificInvoice')}</label>
                <select
                  className="select"
                  value={payForm.purchase_id}
                  onChange={(e) => {
                    const inv = supplierOpenInvoices.find((x) => String(x.id) === e.target.value);
                    setPayForm({
                      ...payForm,
                      purchase_id: e.target.value,
                      amount: inv ? String(inv.remaining_due) : payForm.amount,
                    });
                  }}
                >
                  <option value="">— Auto FIFO —</option>
                  {supplierOpenInvoices.map((inv) => (
                    <option key={inv.id} value={inv.id}>
                      {inv.reference_no} · {pickName(inv, lang, 'material_name')} ({formatEGP(inv.remaining_due, lang)})
                    </option>
                  ))}
                </select>
                <span className="cell-sub">{t(lang, 'autoFifoHint')}</span>
              </div>
            )}

            <div className="form-field">
              <label className="form-label">{t(lang, 'egp')}</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                className="input"
                value={payForm.amount}
                onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                required
              />
            </div>

            <div className="form-field">
              <label className="form-label">{t(lang, 'paymentStatus')}</label>
              <select
                className="select"
                value={payForm.payment_method}
                onChange={(e) => setPayForm({ ...payForm, payment_method: e.target.value })}
              >
                {['cash', 'instapay', 'bank_transfer', 'vodafone_cash', 'cheque'].map((pm) => (
                  <option key={pm} value={pm}>{t(lang, `pay_${pm}`)}</option>
                ))}
              </select>
            </div>

            <div className="form-field">
              <label className="form-label">{t(lang, 'date')}</label>
              <input
                type="date"
                className="input"
                value={payForm.payment_date}
                onChange={(e) => setPayForm({ ...payForm, payment_date: e.target.value })}
                required
              />
            </div>

            <div className="form-field">
              <label className="form-label">{t(lang, 'notes')}</label>
              <input
                type="text"
                className="input"
                value={payForm.notes}
                onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
            <button type="button" className="btn btn-secondary" onClick={() => setShowPayModal(false)}>
              {t(lang, 'cancel')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              <Banknote size={15} />
              {t(lang, 'save')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
