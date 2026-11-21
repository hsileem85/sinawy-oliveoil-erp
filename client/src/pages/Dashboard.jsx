import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Droplets,
  Package,
  RefreshCw,
  TrendingUp,
  Wallet,
  CheckCircle2,
  BarChart3,
} from 'lucide-react';
import { apiFetch } from '../api.js';
import { formatEGP, formatNum, pickName, t } from '../i18n.js';
import StatCard from '../components/StatCard.jsx';

export default function Dashboard({ lang, onNavigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [seeding, setSeeding] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch('/api/dashboard/summary');
      setData(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSeedStarter() {
    setSeeding(true);
    setError('');
    try {
      await apiFetch('/api/seed-demo', { method: 'POST' });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSeeding(false);
    }
  }

  if (loading && !data) {
    return <div className="card"><div className="card-body">{t(lang, 'loading')}</div></div>;
  }

  if (error) {
    return <div className="alert-banner error">{error}</div>;
  }

  const { pnl, orders_kpi, channels, marketing, inventory, low_stock_alerts, recent_batches, recent_orders } = data;
  const maxChannelRev = Math.max(1, ...channels.map((c) => c.revenue));
  const isFreshDb = data.db_mode === 'supabase' && inventory.oil_tanks.length === 0 && orders_kpi.total_orders === 0;

  return (
    <div>
      {isFreshDb && (
        <div className="alert-banner success" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <span>
            {lang === 'ar'
              ? 'قاعدة بيانات Supabase جاهزة وفارغة! يمكنك تحميل بيانات سيناوي التجريبية (جراكن ١٧ لتر، عبوات زجاج وصفيح، استيكر وطلبات) بنقرة واحدة.'
              : 'Your Supabase PostgreSQL database is connected and empty! Load the Sinawy Olive Oil starter catalog (17L gallons, glass/tin bottles, stickers & sample orders) in one click.'}
          </span>
          <button type="button" className="btn btn-primary btn-sm" onClick={handleSeedStarter} disabled={seeding}>
            {seeding ? t(lang, 'loading') : lang === 'ar' ? 'تحميل البيانات الافتراضية' : 'Load Starter Data'}
          </button>
        </div>
      )}
      <div className="page-header">
        <div>
          <h1 className="page-title">{t(lang, 'overviewTitle')}</h1>
          <p className="page-subtitle">{t(lang, 'overviewSubtitle')}</p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn btn-secondary" onClick={load}>
            <RefreshCw size={15} />
            {t(lang, 'refresh')}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onNavigate('sales')}>
            + {t(lang, 'btnNewOrder')}
          </button>
        </div>
      </div>

      {/* Top 4 KPIs */}
      <section className="kpi-grid">
        <StatCard
          label={t(lang, 'netSalesRevenue')}
          value={formatEGP(pnl.net_sales_revenue, lang)}
          sub={`${orders_kpi.active_orders} ${t(lang, 'ordersCount')} · ${t(lang, 'codPending')}: ${formatEGP(pnl.cod_pending_amount, lang)}`}
          icon={Wallet}
          tone="olive"
        />
        <StatCard
          label={t(lang, 'trueNetProfit')}
          value={formatEGP(pnl.true_net_profit, lang)}
          sub={`${pnl.net_margin_pct}% ${t(lang, 'margin')} · ${t(lang, 'pnlGrossProfit')}: ${pnl.gross_margin_pct}%`}
          icon={TrendingUp}
          tone={pnl.true_net_profit >= 0 ? 'emerald' : 'clay'}
        />
        <StatCard
          label={t(lang, 'bulkOilTank')}
          value={`${formatNum(inventory.total_oil_litres, 1)} ${t(lang, 'litres')}`}
          sub={`≈ ${formatNum(inventory.total_oil_gallons_17l, 2)} ${t(lang, 'gallons')} · ${t(lang, 'costValue')}: ${formatEGP(inventory.raw_inventory_value, lang)}`}
          icon={Droplets}
          tone="gold"
        />
        <StatCard
          label={t(lang, 'finishedReady')}
          value={`${inventory.finished_stock_count} ${t(lang, 'pcs')}`}
          sub={`${t(lang, 'retailValue')}: ${formatEGP(inventory.finished_inventory_retail_value, lang)}`}
          icon={Package}
          tone="olive"
        />
      </section>

      {/* P&L Waterfall + Channel Breakdown */}
      <div className="two-col-grid">
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">{t(lang, 'pnlTitle')}</h2>
            <span className="badge badge-olive">
              {pnl.net_margin_pct}% {t(lang, 'margin')}
            </span>
          </div>
          <div className="card-body">
            <div className="pnl-rows">
              <div className="pnl-row">
                <span>{t(lang, 'pnlRevenue')}</span>
                <span className="num cell-main">{formatEGP(pnl.net_sales_revenue, lang)}</span>
              </div>
              <div className="pnl-row">
                <span>− {t(lang, 'pnlCogs')}</span>
                <span className="num val-negative">−{formatEGP(pnl.total_cogs, lang)}</span>
              </div>
              <div className="pnl-row subtotal">
                <span>= {t(lang, 'pnlGrossProfit')} ({pnl.gross_margin_pct}%)</span>
                <span className="num">{formatEGP(pnl.gross_profit, lang)}</span>
              </div>
              <div className="pnl-row">
                <span>± {t(lang, 'pnlShippingMargin')}</span>
                <span className={`num ${pnl.net_shipping_margin >= 0 ? 'val-positive' : 'val-negative'}`}>
                  {pnl.net_shipping_margin >= 0 ? '+' : ''}
                  {formatEGP(pnl.net_shipping_margin, lang)}
                </span>
              </div>
              <div className="pnl-row">
                <span>− {t(lang, 'pnlAdSpend')}</span>
                <span className="num val-negative">−{formatEGP(pnl.total_ad_spend, lang)}</span>
              </div>
              <div className="pnl-row">
                <span>− {t(lang, 'pnlHiddenOverhead')}</span>
                <span className="num val-negative">−{formatEGP(pnl.unallocated_hidden_costs, lang)}</span>
              </div>
              <div className="pnl-row highlight">
                <span>= {t(lang, 'pnlNetProfit')}</span>
                <span className={`num ${pnl.true_net_profit >= 0 ? 'val-positive' : 'val-negative'}`}>
                  {formatEGP(pnl.true_net_profit, lang)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="card-title">
              <BarChart3 size={17} />
              {t(lang, 'channelsTitle')}
            </h2>
          </div>
          <div className="card-body">
            {channels.map((ch) => {
              const pct = Math.round((ch.revenue / maxChannelRev) * 100);
              const tone =
                ch.channel === 'online_store' ? 'online' : ch.channel === 'phone_offline' ? 'phone' : 'social';
              return (
                <div key={ch.channel} className="channel-bar-item">
                  <div className="channel-bar-head">
                    <div>
                      <div className="cell-main">{t(lang, `ch_${ch.channel}`)}</div>
                      <div className="cell-sub">
                        {ch.order_count} {t(lang, 'ordersCount')} · {t(lang, 'profit')}: {formatEGP(ch.profit, lang)}
                      </div>
                    </div>
                    <div className="num cell-main">{formatEGP(ch.revenue, lang)}</div>
                  </div>
                  <div className="bar-track">
                    <div className={`bar-fill ${tone}`} style={{ width: `${Math.max(4, pct)}%` }} />
                  </div>
                </div>
              );
            })}

            <div className="mini-metrics-row">
              <div className="mini-metric">
                <div className="mini-metric-label">{t(lang, 'totalAdSpend')}</div>
                <div className="mini-metric-val num">{formatEGP(marketing.total_ad_spend, lang)}</div>
              </div>
              <div className="mini-metric">
                <div className="mini-metric-label">{t(lang, 'roasLabel')}</div>
                <div className="mini-metric-val num" style={{ color: 'var(--olive-text)' }}>
                  {marketing.roas > 0 ? `${marketing.roas}x` : '—'}
                </div>
              </div>
              <div className="mini-metric">
                <div className="mini-metric-label">{t(lang, 'cpaLabel')}</div>
                <div className="mini-metric-val num">
                  {marketing.cpa > 0 ? formatEGP(marketing.cpa, lang) : '—'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Oil Tanks & Low Stock Alerts */}
      <div className="equal-grid">
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">
              <Droplets size={17} />
              {t(lang, 'oilTanksTitle')}
            </h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onNavigate('purchases')}>
              {t(lang, 'navPurchases')}
            </button>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t(lang, 'material')}</th>
                  <th>{t(lang, 'inStock')}</th>
                  <th>{t(lang, 'gallons')}</th>
                  <th>{t(lang, 'avgCostPerLitre')}</th>
                </tr>
              </thead>
              <tbody>
                {inventory.oil_tanks.map((tank) => (
                  <tr key={tank.id}>
                    <td>
                      <div className="cell-main">{pickName(tank, lang)}</div>
                      <div className="cell-sub">{tank.code}</div>
                    </td>
                    <td className="num cell-main">
                      {formatNum(tank.stock_qty, 1)} {t(lang, 'litres')}
                    </td>
                    <td className="num">
                      <span className="badge badge-gold">
                        {formatNum(Number(tank.stock_qty) / Number(tank.units_per_purchase || 17), 2)}
                      </span>
                    </td>
                    <td className="num">{formatEGP(tank.avg_unit_cost, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="card-title">
              <AlertTriangle size={17} />
              {t(lang, 'lowStockTitle')}
            </h2>
            <span className={`badge ${low_stock_alerts.length > 0 ? 'badge-clay' : 'badge-emerald'}`}>
              {low_stock_alerts.length}
            </span>
          </div>
          <div className="card-body">
            {low_stock_alerts.length === 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--emerald-ok)' }}>
                <CheckCircle2 size={18} />
                <span>{t(lang, 'allStockHealthy')}</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {low_stock_alerts.map((al) => (
                  <div
                    key={`${al.type}-${al.code}`}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '10px 12px',
                      borderRadius: '8px',
                      background: 'var(--clay-soft)',
                    }}
                  >
                    <div>
                      <div className="cell-main">{pickName(al, lang)}</div>
                      <div className="cell-sub">{al.code}</div>
                    </div>
                    <div className="num" style={{ textAlign: 'end' }}>
                      <div style={{ fontWeight: 700, color: 'var(--clay-danger)' }}>
                        {formatNum(al.stock_qty, 1)} {al.unit}
                      </div>
                      <div className="cell-sub">
                        {t(lang, 'minAlert')}: {formatNum(al.min_stock, 0)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recent Bottling & Recent Orders */}
      <div className="equal-grid">
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">{t(lang, 'recentBatches')}</h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onNavigate('bottling')}>
              {t(lang, 'navBottling')}
            </button>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t(lang, 'batchCode')}</th>
                  <th>{t(lang, 'productName')}</th>
                  <th>Qty</th>
                  <th>{t(lang, 'unitCogs')}</th>
                </tr>
              </thead>
              <tbody>
                {recent_batches.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <div className="cell-main">{b.batch_code}</div>
                      <div className="cell-sub">{String(b.batch_date).slice(0, 10)}</div>
                    </td>
                    <td>{pickName(b, lang, 'product_name')}</td>
                    <td className="num cell-main">{b.quantity_produced}</td>
                    <td className="num">{formatEGP(b.unit_cogs, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="card-title">{t(lang, 'recentOrders')}</h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onNavigate('sales')}>
              {t(lang, 'navSales')}
            </button>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t(lang, 'orderNo')}</th>
                  <th>{t(lang, 'customer')}</th>
                  <th>{t(lang, 'totalAmount')}</th>
                  <th>{t(lang, 'status')}</th>
                </tr>
              </thead>
              <tbody>
                {recent_orders.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <div className="cell-main">{o.order_no}</div>
                      <div className="cell-sub">{t(lang, `ch_${o.channel}`)}</div>
                    </td>
                    <td>{o.customer_name}</td>
                    <td className="num cell-main">{formatEGP(o.total_amount, lang)}</td>
                    <td>
                      <span
                        className={`badge ${
                          o.order_status === 'delivered'
                            ? 'badge-emerald'
                            : o.order_status === 'cancelled' || o.order_status === 'returned'
                              ? 'badge-clay'
                              : 'badge-gold'
                        }`}
                      >
                        {t(lang, `st_${o.order_status}`)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
