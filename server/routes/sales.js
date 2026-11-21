import express from 'express';
import { query, withTransaction } from '../db.js';

const router = express.Router();

function genOrderNo() {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const rnd = String(Math.floor(1000 + Math.random() * 9000));
  return `ORD-${ym}-${rnd}`;
}

export async function createOrderTx(tx, payload) {
  const {
    order_date,
    external_order_id = null,
    channel = 'phone_offline',
    social_platform = 'none',
    campaign_name = '',
    customer_name,
    customer_phone = '',
    city = '',
    address = '',
    payment_method = 'cod',
    payment_status = 'cod_pending',
    order_status = 'confirmed',
    discount = 0,
    shipping_charged = 0,
    shipping_actual_cost = 0,
    notes = '',
    raw_payload = null,
    items = [],
    allow_negative_stock = false,
  } = payload;

  if (!customer_name?.trim() || !Array.isArray(items) || items.length === 0) {
    const e = new Error('Customer name and at least one order item are required');
    e.status = 400;
    throw e;
  }

  // Idempotency check for external orders (e.g. EasyOrders webhooks)
  if (external_order_id) {
    const existing = await tx.query('SELECT * FROM sales_orders WHERE external_order_id = $1', [
      String(external_order_id),
    ]);
    if (existing.rows.length > 0) {
      return { order: existing.rows[0], duplicate: true };
    }
  }

  let subtotal = 0;
  let totalCogs = 0;
  const resolvedItems = [];

  for (const item of items) {
    const qty = Math.floor(Number(item.quantity));
    if (!(qty > 0)) continue;

    let fp = null;
    if (item.finished_product_id) {
      const r = await tx.query('SELECT * FROM finished_products WHERE id = $1', [
        Number(item.finished_product_id),
      ]);
      fp = r.rows[0] || null;
    } else if (item.sku) {
      const code = String(item.sku).trim().toUpperCase();
      const r = await tx.query(
        'SELECT * FROM finished_products WHERE UPPER(sku) = $1 OR UPPER(external_sku) = $1 LIMIT 1',
        [code]
      );
      fp = r.rows[0] || null;
    }

    if (!fp) {
      const e = new Error(`Product not found for item: ${item.sku || item.finished_product_id}`);
      e.status = 404;
      throw e;
    }

    const shouldDeduct = !['cancelled', 'returned'].includes(order_status);
    if (shouldDeduct && !allow_negative_stock && Number(fp.stock_qty) < qty) {
      const e = new Error(
        `Insufficient finished stock for ${fp.name} (${fp.sku}): requested ${qty}, available ${fp.stock_qty}`
      );
      e.status = 400;
      throw e;
    }

    const unitPrice =
      item.unit_price !== undefined && item.unit_price !== ''
        ? Number(item.unit_price)
        : Number(fp.retail_price);
    const unitCogs = Number(fp.unit_cogs || 0);
    const lineTotal = Number((qty * unitPrice).toFixed(2));
    const lineCogs = Number((qty * unitCogs).toFixed(2));

    subtotal += lineTotal;
    totalCogs += lineCogs;

    resolvedItems.push({
      fp,
      qty,
      unitPrice,
      unitCogs,
      lineTotal,
      lineCogs,
    });
  }

  if (resolvedItems.length === 0) {
    const e = new Error('At least one valid line item with quantity > 0 is required');
    e.status = 400;
    throw e;
  }

  const disc = Number(discount) || 0;
  const shipCharged = Number(shipping_charged) || 0;
  const shipActual = Number(shipping_actual_cost) || 0;
  const totalAmount = Number((subtotal - disc + shipCharged).toFixed(2));
  const netProfit = Number((subtotal - disc - totalCogs + (shipCharged - shipActual)).toFixed(2));
  const orderNo = genOrderNo();
  const deductStock = !['cancelled', 'returned'].includes(order_status);

  const ordRes = await tx.query(
    `INSERT INTO sales_orders
      (order_no, external_order_id, order_date, channel, social_platform, campaign_name,
       customer_name, customer_phone, city, address, payment_method, payment_status, order_status,
       subtotal, discount, shipping_charged, shipping_actual_cost, total_amount, total_cogs,
       net_profit, stock_deducted, notes, raw_payload)
     VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
             $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
     RETURNING *`,
    [
      orderNo,
      external_order_id ? String(external_order_id) : null,
      order_date || null,
      channel,
      channel === 'social_ads' ? social_platform || 'facebook' : social_platform || 'none',
      campaign_name,
      customer_name.trim(),
      customer_phone,
      city,
      address,
      payment_method,
      payment_status,
      order_status,
      Number(subtotal.toFixed(2)),
      disc,
      shipCharged,
      shipActual,
      totalAmount,
      Number(totalCogs.toFixed(2)),
      netProfit,
      deductStock,
      notes,
      raw_payload ? JSON.stringify(raw_payload) : null,
    ]
  );

  const order = ordRes.rows[0];

  for (const li of resolvedItems) {
    await tx.query(
      `INSERT INTO sales_order_items
        (order_id, finished_product_id, sku_snapshot, product_name_snapshot,
         quantity, unit_price, unit_cogs, line_total, line_cogs)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        order.id,
        li.fp.id,
        li.fp.sku,
        li.fp.name,
        li.qty,
        li.unitPrice,
        li.unitCogs,
        li.lineTotal,
        li.lineCogs,
      ]
    );

    if (deductStock) {
      await tx.query(
        'UPDATE finished_products SET stock_qty = stock_qty - $1, updated_at = NOW() WHERE id = $2',
        [li.qty, li.fp.id]
      );
      await tx.query(
        `INSERT INTO stock_movements (item_type, item_id, movement_type, qty_delta, unit_cost, reference_no, notes)
         VALUES ('finished', $1, 'sale', $2, $3, $4, $5)`,
        [li.fp.id, -li.qty, li.unitCogs, orderNo, `Sold via ${channel} to ${customer_name.trim()}`]
      );
    }
  }

  return { order, duplicate: false };
}

/* ==================== LIST ORDERS ==================== */
router.get('/orders', async (req, res) => {
  const { channel, status } = req.query;
  const conditions = [];
  const params = [];

  if (channel && channel !== 'all') {
    params.push(channel);
    conditions.push(`o.channel = $${params.length}`);
  }
  if (status && status !== 'all') {
    params.push(status);
    conditions.push(`o.order_status = $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const ordersRes = await query(
    `SELECT o.* FROM sales_orders o ${where} ORDER BY o.order_date DESC, o.id DESC`,
    params
  );

  const orderIds = ordersRes.rows.map((o) => o.id);
  let itemsByOrder = {};
  if (orderIds.length > 0) {
    const itemsRes = await query(
      `SELECT i.*, fp.name_ar AS product_name_ar
       FROM sales_order_items i
       LEFT JOIN finished_products fp ON fp.id = i.finished_product_id
       WHERE i.order_id = ANY($1::int[])
       ORDER BY i.id ASC`,
      [orderIds]
    );
    for (const item of itemsRes.rows) {
      if (!itemsByOrder[item.order_id]) itemsByOrder[item.order_id] = [];
      itemsByOrder[item.order_id].push(item);
    }
  }

  const orders = ordersRes.rows.map((o) => ({
    ...o,
    items: itemsByOrder[o.id] || [],
  }));

  res.json({ orders });
});

/* ==================== CREATE ORDER ==================== */
router.post('/orders', async (req, res) => {
  try {
    const result = await withTransaction((tx) => createOrderTx(tx, req.body || {}));
    res.status(result.duplicate ? 200 : 201).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Create order error:', err);
    res.status(500).json({ error: 'Failed to create sales order' });
  }
});

/* ==================== UPDATE ORDER STATUS ==================== */
router.patch('/orders/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { order_status, payment_status, shipping_actual_cost, notes } = req.body || {};

    const updated = await withTransaction(async (tx) => {
      const curRes = await tx.query('SELECT * FROM sales_orders WHERE id = $1', [id]);
      if (curRes.rows.length === 0) {
        const e = new Error('Order not found');
        e.status = 404;
        throw e;
      }
      const cur = curRes.rows[0];
      const nextStatus = order_status || cur.order_status;
      const nextPayStatus = payment_status || (nextStatus === 'delivered' ? 'paid' : cur.payment_status);
      const nextShipActual =
        shipping_actual_cost !== undefined ? Number(shipping_actual_cost) : Number(cur.shipping_actual_cost);

      const shouldBeDeducted = !['cancelled', 'returned'].includes(nextStatus);
      let stockDeducted = cur.stock_deducted;

      // Handle stock restoration on cancel/return or re-deduction if reactivated
      if (cur.stock_deducted && !shouldBeDeducted) {
        const itemsRes = await tx.query('SELECT * FROM sales_order_items WHERE order_id = $1', [id]);
        for (const item of itemsRes.rows) {
          if (item.finished_product_id) {
            await tx.query(
              'UPDATE finished_products SET stock_qty = stock_qty + $1, updated_at = NOW() WHERE id = $2',
              [item.quantity, item.finished_product_id]
            );
            await tx.query(
              `INSERT INTO stock_movements (item_type, item_id, movement_type, qty_delta, unit_cost, reference_no, notes)
               VALUES ('finished', $1, 'sale_return', $2, $3, $4, $5)`,
              [item.finished_product_id, item.quantity, item.unit_cogs, cur.order_no, `Restored (${nextStatus})`]
            );
          }
        }
        stockDeducted = false;
      } else if (!cur.stock_deducted && shouldBeDeducted) {
        const itemsRes = await tx.query('SELECT * FROM sales_order_items WHERE order_id = $1', [id]);
        for (const item of itemsRes.rows) {
          if (item.finished_product_id) {
            const fpRes = await tx.query('SELECT stock_qty, name FROM finished_products WHERE id = $1', [
              item.finished_product_id,
            ]);
            if (fpRes.rows[0] && Number(fpRes.rows[0].stock_qty) < item.quantity) {
              const e = new Error(`Insufficient stock to reactivate order for ${fpRes.rows[0].name}`);
              e.status = 400;
              throw e;
            }
            await tx.query(
              'UPDATE finished_products SET stock_qty = stock_qty - $1, updated_at = NOW() WHERE id = $2',
              [item.quantity, item.finished_product_id]
            );
            await tx.query(
              `INSERT INTO stock_movements (item_type, item_id, movement_type, qty_delta, unit_cost, reference_no, notes)
               VALUES ('finished', $1, 'sale', $2, $3, $4, $5)`,
              [item.finished_product_id, -item.quantity, item.unit_cogs, cur.order_no, 'Order reactivated']
            );
          }
        }
        stockDeducted = true;
      }

      const nextNetProfit = Number(
        (
          Number(cur.subtotal) -
          Number(cur.discount) -
          Number(cur.total_cogs) +
          (Number(cur.shipping_charged) - nextShipActual)
        ).toFixed(2)
      );

      const uRes = await tx.query(
        `UPDATE sales_orders
         SET order_status = $1,
             payment_status = $2,
             shipping_actual_cost = $3,
             net_profit = $4,
             stock_deducted = $5,
             notes = COALESCE($6, notes),
             updated_at = NOW()
         WHERE id = $7
         RETURNING *`,
        [nextStatus, nextPayStatus, nextShipActual, nextNetProfit, stockDeducted, notes ?? null, id]
      );
      return uRes.rows[0];
    });

    res.json({ order: updated });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Update order error:', err);
    res.status(500).json({ error: 'Failed to update order' });
  }
});

/* ==================== SOCIAL MEDIA AD SPEND ==================== */
router.get('/ad-spend', async (_req, res) => {
  const result = await query('SELECT * FROM ad_spend ORDER BY spend_date DESC, id DESC');
  res.json({ ad_spend: result.rows });
});

router.post('/ad-spend', async (req, res) => {
  try {
    const { spend_date, platform = 'facebook', campaign_name, amount, notes = '' } = req.body || {};
    if (!campaign_name?.trim() || !(Number(amount) > 0)) {
      return res.status(400).json({ error: 'Campaign name and positive amount are required' });
    }
    const result = await query(
      `INSERT INTO ad_spend (spend_date, platform, campaign_name, amount, notes)
       VALUES (COALESCE($1::date, CURRENT_DATE), $2, $3, $4, $5) RETURNING *`,
      [spend_date || null, platform, campaign_name.trim(), Number(amount), notes]
    );
    res.status(201).json({ entry: result.rows[0] });
  } catch (err) {
    console.error('Create ad spend error:', err);
    res.status(500).json({ error: 'Failed to record ad spend' });
  }
});

router.delete('/ad-spend/:id', async (req, res) => {
  const result = await query('DELETE FROM ad_spend WHERE id = $1 RETURNING id', [Number(req.params.id)]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Ad spend record not found' });
  res.json({ ok: true });
});

/* ==================== CSV EXPORT (UTF-8 BOM for Arabic Excel) ==================== */
router.get('/export/csv', async (_req, res) => {
  const ordersRes = await query(
    'SELECT * FROM sales_orders ORDER BY order_date DESC, id DESC'
  );
  const headers = [
    'Order No',
    'Date',
    'Channel',
    'Platform',
    'Campaign',
    'Customer',
    'Phone',
    'City',
    'Status',
    'Payment',
    'Subtotal (EGP)',
    'Discount (EGP)',
    'Shipping Charged',
    'Shipping Actual',
    'Total (EGP)',
    'COGS (EGP)',
    'Net Profit (EGP)',
  ];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [headers.join(',')];
  for (const o of ordersRes.rows) {
    lines.push(
      [
        o.order_no,
        String(o.order_date).slice(0, 10),
        o.channel,
        o.social_platform,
        o.campaign_name,
        o.customer_name,
        o.customer_phone,
        o.city,
        o.order_status,
        o.payment_method,
        o.subtotal,
        o.discount,
        o.shipping_charged,
        o.shipping_actual_cost,
        o.total_amount,
        o.total_cogs,
        o.net_profit,
      ]
        .map(esc)
        .join(',')
    );
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="sinawy-sales-orders.csv"');
  res.send('\uFEFF' + lines.join('\n'));
});

export default router;
