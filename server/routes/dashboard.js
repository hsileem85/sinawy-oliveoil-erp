import express from 'express';
import { query, getDbMode } from '../db.js';

const router = express.Router();

router.get('/summary', async (_req, res) => {
  try {
    const [
      salesAgg,
      channelAgg,
      adSpendAgg,
      hiddenOverheadAgg,
      hiddenAllAgg,
      purchasesAgg,
      oilMaterials,
      allRawMaterials,
      finishedProducts,
      recentBatches,
      recentOrders,
    ] = await Promise.all([
      query(`
        SELECT
          COUNT(*)::int AS total_orders,
          COUNT(*) FILTER (WHERE order_status NOT IN ('cancelled', 'returned'))::int AS active_orders,
          COUNT(*) FILTER (WHERE order_status = 'delivered')::int AS delivered_orders,
          COALESCE(SUM(subtotal - discount) FILTER (WHERE order_status NOT IN ('cancelled', 'returned')), 0) AS net_sales_revenue,
          COALESCE(SUM(total_cogs) FILTER (WHERE order_status NOT IN ('cancelled', 'returned')), 0) AS total_cogs,
          COALESCE(SUM(shipping_charged - shipping_actual_cost) FILTER (WHERE order_status NOT IN ('cancelled', 'returned')), 0) AS net_shipping_margin,
          COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'cod_pending' AND order_status NOT IN ('cancelled', 'returned')), 0) AS cod_pending_amount
        FROM sales_orders
      `),
      query(`
        SELECT
          channel,
          COUNT(*) FILTER (WHERE order_status NOT IN ('cancelled', 'returned'))::int AS order_count,
          COALESCE(SUM(subtotal - discount) FILTER (WHERE order_status NOT IN ('cancelled', 'returned')), 0) AS revenue,
          COALESCE(SUM(net_profit) FILTER (WHERE order_status NOT IN ('cancelled', 'returned')), 0) AS profit
        FROM sales_orders
        GROUP BY channel
      `),
      query(`SELECT COALESCE(SUM(amount), 0) AS total_ad_spend FROM ad_spend`),
      query(`SELECT COALESCE(SUM(amount), 0) AS total_overhead FROM hidden_costs WHERE allocation_scope = 'overhead'`),
      query(`SELECT COALESCE(SUM(amount), 0) AS total_hidden_all FROM hidden_costs`),
      query(`SELECT COALESCE(SUM(total_landed_cost), 0) AS total_purchases, COUNT(*)::int AS purchase_count FROM purchases`),
      query(`
        SELECT id, code, name, name_ar, stock_qty, avg_unit_cost, units_per_purchase, min_stock
        FROM raw_materials
        WHERE category = 'oil'
        ORDER BY id ASC
      `),
      query(`
        SELECT id, code, name, name_ar, category, container_material, capacity_ml, base_unit, stock_qty, avg_unit_cost, min_stock
        FROM raw_materials
        ORDER BY category ASC, name ASC
      `),
      query(`
        SELECT id, sku, external_sku, name, name_ar, container_type, size_ml, stock_qty, unit_cogs, retail_price, min_stock
        FROM finished_products
        WHERE active = TRUE
        ORDER BY stock_qty DESC
      `),
      query(`
        SELECT b.id, b.batch_code, b.batch_date, b.quantity_produced, b.unit_cogs, b.total_batch_cost,
               fp.name AS product_name, fp.name_ar AS product_name_ar, fp.sku
        FROM bottling_batches b
        JOIN finished_products fp ON fp.id = b.finished_product_id
        ORDER BY b.batch_date DESC, b.id DESC
        LIMIT 5
      `),
      query(`
        SELECT id, order_no, order_date, channel, social_platform, customer_name, total_amount, net_profit, order_status
        FROM sales_orders
        ORDER BY order_date DESC, id DESC
        LIMIT 6
      `),
    ]);

    const s = salesAgg.rows[0];
    const netSalesRevenue = Number(s.net_sales_revenue || 0);
    const totalCogs = Number(s.total_cogs || 0);
    const grossProfit = Number((netSalesRevenue - totalCogs).toFixed(2));
    const netShippingMargin = Number(s.net_shipping_margin || 0);
    const totalAdSpend = Number(adSpendAgg.rows[0].total_ad_spend || 0);
    const unallocatedHiddenCosts = Number(hiddenOverheadAgg.rows[0].total_overhead || 0);
    const totalHiddenTracked = Number(hiddenAllAgg.rows[0].total_hidden_all || 0);
    const trueNetProfit = Number(
      (grossProfit + netShippingMargin - totalAdSpend - unallocatedHiddenCosts).toFixed(2)
    );
    const grossMarginPct = netSalesRevenue > 0 ? Number(((grossProfit / netSalesRevenue) * 100).toFixed(1)) : 0;
    const netMarginPct = netSalesRevenue > 0 ? Number(((trueNetProfit / netSalesRevenue) * 100).toFixed(1)) : 0;

    // Channel analytics & ROAS
    const channelMap = {
      online_store: { channel: 'online_store', order_count: 0, revenue: 0, profit: 0 },
      phone_offline: { channel: 'phone_offline', order_count: 0, revenue: 0, profit: 0 },
      social_ads: { channel: 'social_ads', order_count: 0, revenue: 0, profit: 0 },
    };
    for (const row of channelAgg.rows) {
      channelMap[row.channel] = {
        channel: row.channel,
        order_count: Number(row.order_count),
        revenue: Number(row.revenue),
        profit: Number(row.profit),
      };
    }

    const socialRevenue = channelMap.social_ads.revenue;
    const socialOrders = channelMap.social_ads.order_count;
    const roas = totalAdSpend > 0 ? Number((socialRevenue / totalAdSpend).toFixed(2)) : 0;
    const cpa = socialOrders > 0 && totalAdSpend > 0 ? Number((totalAdSpend / socialOrders).toFixed(2)) : 0;

    // Inventory valuation
    const totalOilLitres = oilMaterials.rows.reduce((acc, m) => acc + Number(m.stock_qty || 0), 0);
    const totalOilGallons = Number((totalOilLitres / 17).toFixed(2));
    const rawInventoryValue = Number(
      allRawMaterials.rows
        .reduce((acc, m) => acc + Number(m.stock_qty || 0) * Number(m.avg_unit_cost || 0), 0)
        .toFixed(2)
    );
    const finishedStockCount = finishedProducts.rows.reduce((acc, p) => acc + Number(p.stock_qty || 0), 0);
    const finishedInventoryCostValue = Number(
      finishedProducts.rows
        .reduce((acc, p) => acc + Number(p.stock_qty || 0) * Number(p.unit_cogs || 0), 0)
        .toFixed(2)
    );
    const finishedInventoryRetailValue = Number(
      finishedProducts.rows
        .reduce((acc, p) => acc + Number(p.stock_qty || 0) * Number(p.retail_price || 0), 0)
        .toFixed(2)
    );

    // Low stock alerts
    const lowStockAlerts = [
      ...allRawMaterials.rows
        .filter((m) => Number(m.stock_qty) <= Number(m.min_stock))
        .map((m) => ({
          type: 'raw',
          code: m.code,
          name: m.name,
          name_ar: m.name_ar,
          stock_qty: Number(m.stock_qty),
          min_stock: Number(m.min_stock),
          unit: m.base_unit,
        })),
      ...finishedProducts.rows
        .filter((p) => Number(p.stock_qty) <= Number(p.min_stock))
        .map((p) => ({
          type: 'finished',
          code: p.sku,
          name: p.name,
          name_ar: p.name_ar,
          stock_qty: Number(p.stock_qty),
          min_stock: Number(p.min_stock),
          unit: 'pcs',
        })),
    ];

    res.json({
      db_mode: getDbMode(),
      pnl: {
        net_sales_revenue: netSalesRevenue,
        total_cogs: totalCogs,
        gross_profit: grossProfit,
        gross_margin_pct: grossMarginPct,
        net_shipping_margin: netShippingMargin,
        total_ad_spend: totalAdSpend,
        unallocated_hidden_costs: unallocatedHiddenCosts,
        total_hidden_tracked: totalHiddenTracked,
        true_net_profit: trueNetProfit,
        net_margin_pct: netMarginPct,
        cod_pending_amount: Number(s.cod_pending_amount || 0),
        total_purchases: Number(purchasesAgg.rows[0].total_purchases || 0),
      },
      orders_kpi: {
        total_orders: s.total_orders,
        active_orders: s.active_orders,
        delivered_orders: s.delivered_orders,
      },
      channels: Object.values(channelMap),
      marketing: {
        total_ad_spend: totalAdSpend,
        social_revenue: socialRevenue,
        social_orders: socialOrders,
        roas,
        cpa,
      },
      inventory: {
        total_oil_litres: Number(totalOilLitres.toFixed(2)),
        total_oil_gallons_17l: totalOilGallons,
        raw_inventory_value: rawInventoryValue,
        finished_stock_count: finishedStockCount,
        finished_inventory_cost_value: finishedInventoryCostValue,
        finished_inventory_retail_value: finishedInventoryRetailValue,
        oil_tanks: oilMaterials.rows,
        finished_skus: finishedProducts.rows,
      },
      low_stock_alerts: lowStockAlerts,
      recent_batches: recentBatches.rows,
      recent_orders: recentOrders.rows,
    });
  } catch (err) {
    console.error('Dashboard summary error:', err);
    res.status(500).json({ error: 'Failed to load dashboard summary' });
  }
});

export default router;
