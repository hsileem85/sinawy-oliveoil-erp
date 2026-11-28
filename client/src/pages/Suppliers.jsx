import React, { useEffect, useState } from 'react';
import {
  Banknote,
  Clock,
  Download,
  Edit3,
  FileText,
  Lock,
  Plus,
  Receipt,
  RotateCcw,
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

  // Payment Ledger filters
  const [txTypeFilter, setTxTypeFilter] = useState('all');
  const [ledgerSupFilter, setLedgerSupFilter] = useState('all');

  // Supplier Statement state
  const [statementSupplierId, setStatementSupplierId] = useState('');
  const [statementData, setStatementData] = useState(null);
  const [statementLoading, setStatementLoading] = useState(false);

  // Supplier Create/Edit modal
  const [showSupModal, setShowSupModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [sForm, setSForm] = useState(EMPTY_SUPPLIER);

  // Record Payment modal
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

  // Reverse Payment modal
  const [reversingPayment, setReversingPayment] = useState(null);
  const [reverseReason, setReverseReason] = useState('');

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      const [sRes, pRes, payRes] = await Promise.all([
        apiFetch('/api/purchases/suppliers'),
        apiFetch('/api/purchases'),
        apiFetch('/api/purchases/supplier-payments').catch(() => ({ payments: [] })),
      ]);
      const nextSuppliers = sRes.suppliers || [];
      setSuppliers(nextSuppliers);
      setPurchases(pRes.purchases || []);
      setPayments(payRes.payments || []);

      if (!statementSupplierId && nextSuppliers.length > 0) {
        const preferred =
          nextSuppliers.find((s) => Number(s.balance_due) > 0) ||
          nextSuppliers.find((s) => Number(s.total_purchased) > 0) ||
          nextSuppliers[0];
        if (preferred) setStatementSupplierId(String(preferred.id));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadStatement(supId) {
    if (!supId) {
      setStatementData(null);
      return;
    }
    setStatementLoading(true);
    setError('');
    try {
      const data = await apiFetch(`/api/purchases/suppliers/${supId}/statement`);
      setStatementData(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setStatementLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    if (tab === 'statement' && statementSupplierId) {
      loadStatement(statementSupplierId);
    }
  }, [tab, statementSupplierId]);

  function openSupplierStatement(sup) {
    setStatementSupplierId(String(sup.id));
    setTab('statement');
  }

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

  function openReverseModal(pm) {
    setReversingPayment(pm);
    setReverseReason('');
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
      if (tab === 'statement' && statementSupplierId) {
        await loadStatement(statementSupplierId);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmReversePayment(e) {
    e.preventDefault();
    if (!reversingPayment) return;
    setSaving(true);
    setError('');
    try {
      await apiFetch(`/api/purchases/supplier-payments/${reversingPayment.id}/reverse`, {
        method: 'POST',
        body: { notes: reverseReason.trim() },
      });
      setReversingPayment(null);
      setReverseReason('');
      await loadAll();
      if (tab === 'statement' && statementSupplierId) {
        await loadStatement(statementSupplierId);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function exportStatementCsv() {
    if (!statementData?.supplier) return;
    const sup = statementData.supplier;
    const entries = statementData.entries || [];
    const headers = [
      'Date',
      'Reference',
      'Type',
      'Description',
      'Method',
      'Debit (Charges EGP)',
      'Credit (Paid EGP)',
      'Running Balance (EGP)',
      'Status',
      'Notes',
    ];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [headers.join(',')];
    for (const row of entries) {
      lines.push(
        [
          String(row.entry_date).slice(0, 10),
          row.reference_no,
          t(lang, `txType_${row.entry_type}`),
          pickName(row, lang, 'description'),
          row.entry_type === 'purchase'
            ? t(lang, `payType_${row.payment_method || 'cash'}`)
            : t(lang, `pay_${row.payment_method || 'cash'}`),
          Number(row.debit_amount || 0).toFixed(2),
          Number(row.credit_amount || 0).toFixed(2),
          Number(row.running_balance || 0).toFixed(2),
          row.is_reversed ? `${t(lang, 'txReversed')} (${row.reversal_ref || ''})` : '',
          row.notes || '',
        ]
          .map(esc)
          .join(',')
      );
    }
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = String(sup.name || `supplier-${sup.id}`).replace(/[^a-z0-9-_]+/gi, '_');
    a.download = `statement_${safeName}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const totalPurchased = suppliers.reduce((acc, s) => acc + Number(s.total_purchased || 0), 0);
  const totalPaid = suppliers.reduce((acc, s) => acc + Number(s.total_paid || 0), 0);
  const totalDue = suppliers.reduce((acc, s) => acc + Number(s.balance_due || 0), 0);
  const openCreditPurchases = purchases.filter((p) => Number(p.remaining_due || 0) > 0.01);
  const supplierOpenInvoices = openCreditPurchases.filter(
    (p) => String(p.supplier_id) === String(payForm.supplier_id)
  );

  const filteredPayments = payments.filter((pm) => {
    const txType = pm.transaction_type || 'payment';
    if (txTypeFilter !== 'all' && txType !== txTypeFilter) return false;
    if (ledgerSupFilter !== 'all' && String(pm.supplier_id) !== String(ledgerSupFilter)) return false;
    return true;
  });

  function renderTxBadge(txType) {
    if (txType === 'reversal') {
      return <span className="badge badge-clay">{t(lang, 'txType_reversal')}</span>;
    }
    if (txType === 'down_payment') {
      return <span className="badge badge-gold">{t(lang, 'txType_down_payment')}</span>;
    }
    if (txType === 'purchase') {
      return <span className="badge badge-slate">{t(lang, 'txType_purchase')}</span>;
    }
    return <span className="badge badge-emerald">{t(lang, 'txType_payment')}</span>;
  }

  const stmtSup = statementData?.supplier;
  const stmtEntries = statementData?.entries || [];

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
          label={t(lang, 'netPayments')}
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
          {t(lang, 'tabPaymentLedger')} ({payments.length})
        </button>
        <button
          type="button"
          className={`tab-btn ${tab === 'statement' ? 'active' : ''}`}
          onClick={() => setTab('statement')}
        >
          {t(lang, 'tabSupplierStatement')}
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
                  <th>{t(lang, 'netPayments')}</th>
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
                    const adv = Number(s.advance_balance || 0);
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
                          {adv > 0.01 && (
                            <div className="cell-sub val-positive">
                              {t(lang, 'advanceCredit')}: {formatEGP(adv, lang)}
                            </div>
                          )}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => openSupplierStatement(s)}
                            >
                              <FileText size={13} />
                              {t(lang, 'viewStatement')}
                            </button>
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
                        <td className="num">
                          <div>{formatEGP(p.amount_paid, lang)}</div>
                          <span className={`badge ${p.payment_status === 'partial' ? 'badge-gold' : 'badge-clay'}`}>
                            {t(lang, `payStatus_${p.payment_status || 'unpaid'}`)}
                          </span>
                        </td>
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

      {/* TAB 3: IMMUTABLE PAYMENT LEDGER TRANSACTIONS */}
      {tab === 'payments' && (
        <div>
          <div className="ledger-note-bar">
            <Lock size={14} />
            <span>{t(lang, 'ledgerImmutableNote')}</span>
          </div>

          <div className="ledger-toolbar">
            <div className="filter-pills" style={{ marginBottom: 0 }}>
              {['all', 'payment', 'down_payment', 'reversal'].map((ft) => (
                <button
                  key={ft}
                  type="button"
                  className={`pill-btn ${txTypeFilter === ft ? 'active' : ''}`}
                  onClick={() => setTxTypeFilter(ft)}
                >
                  {ft === 'all' ? t(lang, 'all') : t(lang, `txType_${ft}`)}
                </button>
              ))}
            </div>

            <select
              className="select ledger-sup-select"
              value={ledgerSupFilter}
              onChange={(e) => setLedgerSupFilter(e.target.value)}
            >
              <option value="all">{t(lang, 'allSuppliers')}</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {pickName(s, lang)}
                </option>
              ))}
            </select>
          </div>

          <div className="card">
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t(lang, 'date')}</th>
                    <th>{t(lang, 'supplier')}</th>
                    <th>{t(lang, 'stmtType')}</th>
                    <th>{t(lang, 'paymentMethod')}</th>
                    <th>{t(lang, 'egp')}</th>
                    <th>{t(lang, 'notes')}</th>
                    <th>{t(lang, 'actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPayments.length === 0 ? (
                    <tr><td colSpan="7">{t(lang, 'noData')}</td></tr>
                  ) : (
                    filteredPayments.map((pm) => {
                      const txType = pm.transaction_type || 'payment';
                      const isReversal = txType === 'reversal';
                      const isReversed = Boolean(pm.is_reversed);
                      const amt = Number(pm.amount || 0);
                      return (
                        <tr key={pm.id} className={isReversed ? 'row-reversed' : isReversal ? 'row-reversal' : ''}>
                          <td>
                            <div className="cell-main">{pm.reference_no || `#${pm.id}`}</div>
                            <div className="cell-sub">{String(pm.payment_date).slice(0, 10)}</div>
                          </td>
                          <td className="cell-main">{pickName(pm, lang, 'supplier_name')}</td>
                          <td>
                            {renderTxBadge(txType)}
                            {isReversal && (pm.reversed_ref || pm.reversed_payment_id) && (
                              <div className="cell-sub">
                                {t(lang, 'reversedOf')}: {pm.reversed_ref || `#${pm.reversed_payment_id}`}
                              </div>
                            )}
                            {isReversed && (
                              <div className="cell-sub">
                                <span className="badge badge-neutral" style={{ marginTop: 4 }}>
                                  {t(lang, 'txReversed')}
                                  {pm.reversal_ref ? ` · ${pm.reversal_ref}` : ''}
                                </span>
                              </div>
                            )}
                          </td>
                          <td>
                            <span className="badge badge-olive">{t(lang, `pay_${pm.payment_method || 'cash'}`)}</span>
                            {pm.purchase_ref && <div className="cell-sub">{pm.purchase_ref}</div>}
                          </td>
                          <td className="num">
                            <span
                              className={
                                isReversal
                                  ? 'val-negative'
                                  : isReversed
                                    ? 'val-reversed'
                                    : 'val-positive'
                              }
                            >
                              {isReversal ? '−' : '+'}
                              {formatEGP(amt, lang)}
                            </span>
                          </td>
                          <td className="cell-sub">{pm.notes || '—'}</td>
                          <td>
                            {isReversal ? (
                              <span className="badge badge-neutral">{t(lang, 'txReversalEntry')}</span>
                            ) : isReversed ? (
                              <span className="badge badge-neutral">{t(lang, 'txReversed')}</span>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-danger-ghost btn-sm"
                                onClick={() => openReverseModal(pm)}
                              >
                                <RotateCcw size={13} />
                                {t(lang, 'cancelPayment')}
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
        </div>
      )}

      {/* TAB 4: SUPPLIER STATEMENT (كشف حساب مورد بالرصيد التراكمي) */}
      {tab === 'statement' && (
        <div>
          <div className="statement-controls card">
            <div className="statement-controls-row">
              <div className="form-field" style={{ minWidth: 240, flex: 1 }}>
                <label className="form-label">{t(lang, 'selectSupplierForStatement')}</label>
                <select
                  className="select"
                  value={statementSupplierId}
                  onChange={(e) => setStatementSupplierId(e.target.value)}
                >
                  <option value="">—</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {pickName(s, lang)} — {t(lang, 'remainingDue')}: {formatEGP(s.balance_due, lang)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="header-actions" style={{ alignSelf: 'flex-end' }}>
                {stmtSup && (
                  <>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={exportStatementCsv}
                      disabled={stmtEntries.length === 0}
                    >
                      <Download size={15} />
                      {t(lang, 'exportStatementCsv')}
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => openPayModal(stmtSup)}
                    >
                      <Banknote size={15} />
                      {t(lang, 'btnRecordPayment')}
                    </button>
                  </>
                )}
              </div>
            </div>

            {stmtSup && (
              <div className="statement-summary-grid">
                <div className="statement-summary-item">
                  <div className="mini-metric-label">{t(lang, 'totalPurchased')}</div>
                  <div className="mini-metric-val num">{formatEGP(stmtSup.total_purchased, lang)}</div>
                </div>
                <div className="statement-summary-item">
                  <div className="mini-metric-label">{t(lang, 'netPayments')}</div>
                  <div className="mini-metric-val num val-positive">{formatEGP(stmtSup.total_paid, lang)}</div>
                </div>
                <div className="statement-summary-item">
                  <div className="mini-metric-label">
                    {Number(stmtSup.advance_balance || 0) > 0.01
                      ? t(lang, 'advanceCredit')
                      : t(lang, 'remainingDue')}
                  </div>
                  <div
                    className={`mini-metric-val num ${
                      Number(stmtSup.balance_due || 0) > 0.01 ? 'val-negative' : 'val-positive'
                    }`}
                  >
                    {Number(stmtSup.advance_balance || 0) > 0.01
                      ? formatEGP(stmtSup.advance_balance, lang)
                      : formatEGP(stmtSup.balance_due, lang)}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t(lang, 'date')}</th>
                    <th>{t(lang, 'stmtType')}</th>
                    <th>{t(lang, 'stmtDescription')}</th>
                    <th>{t(lang, 'stmtDebit')}</th>
                    <th>{t(lang, 'stmtCredit')}</th>
                    <th>{t(lang, 'stmtRunningBalance')}</th>
                    <th>{t(lang, 'actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {statementLoading ? (
                    <tr><td colSpan="7">{t(lang, 'loading')}</td></tr>
                  ) : !statementSupplierId || stmtEntries.length === 0 ? (
                    <tr><td colSpan="7">{t(lang, 'noData')}</td></tr>
                  ) : (
                    stmtEntries.map((row) => {
                      const isPayEntry = row.entry_type === 'payment' || row.entry_type === 'down_payment';
                      const isRev = row.entry_type === 'reversal';
                      const isReversed = Boolean(row.is_reversed);
                      const debit = Number(row.debit_amount || 0);
                      const credit = Number(row.credit_amount || 0);
                      const running = Number(row.running_balance || 0);
                      return (
                        <tr
                          key={`${row.entry_type}-${row.source_id}`}
                          className={isReversed ? 'row-reversed' : isRev ? 'row-reversal' : ''}
                        >
                          <td>
                            <div className="cell-main">{row.reference_no}</div>
                            <div className="cell-sub">{String(row.entry_date).slice(0, 10)}</div>
                          </td>
                          <td>
                            {renderTxBadge(row.entry_type)}
                            {isReversed && (
                              <div className="cell-sub">
                                <span className="badge badge-neutral" style={{ marginTop: 4 }}>
                                  {t(lang, 'txReversed')}
                                </span>
                              </div>
                            )}
                          </td>
                          <td>
                            <div className="cell-main">{pickName(row, lang, 'description')}</div>
                            <div className="cell-sub">
                              {row.entry_type === 'purchase'
                                ? t(lang, `payType_${row.payment_method || 'cash'}`)
                                : t(lang, `pay_${row.payment_method || 'cash'}`)}
                              {row.notes ? ` · ${row.notes}` : ''}
                            </div>
                          </td>
                          <td className="num">
                            {debit > 0 ? (
                              <span className={isRev ? 'val-negative' : ''}>{formatEGP(debit, lang)}</span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="num">
                            {credit > 0 ? (
                              <span className={isReversed ? 'val-reversed' : 'val-positive'}>
                                {formatEGP(credit, lang)}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="num cell-main">
                            <span className={running > 0.01 ? 'val-negative' : 'val-positive'}>
                              {formatEGP(running, lang)}
                            </span>
                          </td>
                          <td>
                            {isPayEntry && !isReversed ? (
                              <button
                                type="button"
                                className="btn btn-danger-ghost btn-sm"
                                onClick={() =>
                                  openReverseModal({
                                    id: row.source_id,
                                    reference_no: row.reference_no,
                                    payment_date: row.entry_date,
                                    amount: credit,
                                    supplier_name: stmtSup?.name,
                                    supplier_name_ar: stmtSup?.name_ar,
                                  })
                                }
                              >
                                <RotateCcw size={13} />
                                {t(lang, 'cancelPayment')}
                              </button>
                            ) : isReversed ? (
                              <span className="cell-sub">{row.reversal_ref || t(lang, 'txReversed')}</span>
                            ) : (
                              <span className="cell-sub">—</span>
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

      {/* MODAL: RECORD SUPPLIER PAYMENT (APPEND IMMUTABLE LEDGER TRANSACTION) */}
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
              <label className="form-label">{t(lang, 'paymentMethod')}</label>
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

      {/* MODAL: APPEND REVERSAL TRANSACTION (NO DELETE / NO EDIT OF ORIGINAL RECORD) */}
      <Modal
        open={Boolean(reversingPayment)}
        title={t(lang, 'reversePaymentTitle')}
        onClose={() => setReversingPayment(null)}
      >
        {reversingPayment && (
          <form onSubmit={confirmReversePayment}>
            <div className="preview-box" style={{ marginBottom: 14 }}>
              <div className="preview-box-title">
                <RotateCcw size={15} />
                {reversingPayment.reference_no || `#${reversingPayment.id}`}
              </div>
              <p className="cell-sub" style={{ margin: '6px 0 10px' }}>
                {t(lang, 'reversePaymentDesc')}
              </p>
              <div className="preview-grid">
                <div>
                  <div className="mini-metric-label">{t(lang, 'supplier')}</div>
                  <div className="mini-metric-val">
                    {pickName(reversingPayment, lang, 'supplier_name')}
                  </div>
                </div>
                <div>
                  <div className="mini-metric-label">{t(lang, 'date')}</div>
                  <div className="mini-metric-val num">
                    {String(reversingPayment.payment_date).slice(0, 10)}
                  </div>
                </div>
                <div>
                  <div className="mini-metric-label">{t(lang, 'egp')}</div>
                  <div className="mini-metric-val num val-negative">
                    −{formatEGP(reversingPayment.amount, lang)}
                  </div>
                </div>
              </div>
            </div>

            <div className="form-field full">
              <label className="form-label">{t(lang, 'reversalReason')}</label>
              <input
                type="text"
                className="input"
                placeholder={t(lang, 'reversalReasonPlaceholder')}
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setReversingPayment(null)}
              >
                {t(lang, 'cancel')}
              </button>
              <button type="submit" className="btn btn-danger" disabled={saving}>
                <RotateCcw size={15} />
                {t(lang, 'confirmReverse')}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
