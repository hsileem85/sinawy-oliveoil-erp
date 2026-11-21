import express from 'express';
import { query, withTransaction } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { createOrderTx } from './sales.js';

const router = express.Router();

/**
 * GET /api/integrations/stock
 * Protected via X-API-Key or Bearer JWT.
 * Returns live finished goods stock for EasyOrders / sinawy.net sync.
 */
router.get('/stock', requireAuth, async (_req, res) => {
  const result = await query(
    `SELECT id, sku, external_sku, name, name_ar, container_type, size_ml,
            stock_qty, retail_price, active, updated_at
     FROM finished_products
     ORDER BY sku ASC`
  );
  res.json({
    store: 'sinawy.net',
    currency: 'EGP',
    synced_at: new Date().toISOString(),
    products: result.rows,
  });
});

/**
 * POST /api/integrations/easyorders/webhook
 * Ready for EasyOrders (easy-orders.net) order webhook integration.
 * Validates optional secret header (`x-easyorders-secret` or `secret` header or `?secret=`)
 * against EASYORDERS_WEBHOOK_SECRET if configured.
 */
router.post('/easyorders/webhook', async (req, res) => {
  try {
    const configuredSecret = process.env.EASYORDERS_WEBHOOK_SECRET;
    const providedSecret =
      req.headers['x-easyorders-secret'] ||
      req.headers['secret'] ||
      req.query.secret ||
      '';

    // If an API key is provided instead, also allow it
    const apiKeyHeader = req.headers['x-api-key'];
    let authorized = false;

    if (apiKeyHeader) {
      const k = await query(
        'SELECT id FROM api_keys WHERE key_value = $1 AND active = TRUE',
        [String(apiKeyHeader)]
      );
      if (k.rows.length > 0) authorized = true;
    }
    if (!authorized && configuredSecret && providedSecret === configuredSecret) {
      authorized = true;
    }
    if (!authorized && !configuredSecret) {
      // Dev mode when no secret configured
      authorized = true;
    }

    if (!authorized) {
      return res.status(401).json({ error: 'Invalid EasyOrders webhook secret' });
    }

    const body = req.body || {};
    const externalOrderId = body.id || body.order_id || `EO-${Date.now()}`;
    const customerName = body.full_name || body.customer_name || 'EasyOrders Customer';
    const customerPhone = body.phone || body.customer_phone || '';
    const city = body.government || body.city || '';
    const address = body.address || '';
    const shippingCharged = Number(body.shipping_cost ?? body.shipping_charged ?? 0);
    const discount = Number(body.coupon_discount ?? body.discount ?? 0);

    const rawItems = Array.isArray(body.cart_items)
      ? body.cart_items
      : Array.isArray(body.items)
        ? body.items
        : [];

    const mappedItems = rawItems.map((ci) => ({
      sku: ci.product?.sku || ci.sku || ci.variant?.sku || '',
      finished_product_id: ci.finished_product_id,
      quantity: Number(ci.quantity || 1),
      unit_price: ci.price !== undefined ? Number(ci.price) : undefined,
    }));

    const result = await withTransaction((tx) =>
      createOrderTx(tx, {
        external_order_id: String(externalOrderId),
        channel: 'online_store',
        social_platform: 'none',
        campaign_name: body.utm_campaign || 'sinawy.net (EasyOrders)',
        customer_name: customerName,
        customer_phone: customerPhone,
        city,
        address,
        payment_method: body.payment_method === 'card' ? 'card' : 'cod',
        payment_status: body.payment_method === 'card' ? 'paid' : 'cod_pending',
        order_status: 'pending',
        discount,
        shipping_charged: shippingCharged,
        shipping_actual_cost: Number(body.shipping_actual_cost ?? 55),
        notes: body.note || body.notes || 'Synced via EasyOrders Webhook',
        raw_payload: body,
        items: mappedItems,
        allow_negative_stock: true,
      })
    );

    res.status(result.duplicate ? 200 : 201).json({
      ok: true,
      duplicate: result.duplicate,
      order: result.order,
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('EasyOrders webhook error:', err);
    res.status(500).json({ error: 'Failed to process EasyOrders webhook' });
  }
});

/**
 * POST /api/integrations/easyorders/simulate
 * Protected admin utility to test an incoming EasyOrders order live from the ERP UI.
 */
router.post('/easyorders/simulate', requireAuth, async (_req, res) => {
  try {
    const fpRes = await query(
      'SELECT id, sku, external_sku, retail_price FROM finished_products WHERE active = TRUE AND stock_qty > 0 ORDER BY id ASC LIMIT 1'
    );
    if (fpRes.rows.length === 0) {
      return res.status(400).json({ error: 'No finished products in stock to simulate an order' });
    }
    const fp = fpRes.rows[0];
    const simId = `EO-SIM-${Math.floor(100000 + Math.random() * 900000)}`;

    const samplePayload = {
      id: simId,
      full_name: 'Tarek El-Masry / طارق المصري',
      phone: '01092837465',
      government: 'Cairo - New Cairo',
      address: '5th Settlement, District 3',
      shipping_cost: 65,
      payment_method: 'cod',
      utm_campaign: 'sinawy.net-easyorders',
      cart_items: [
        {
          product: { sku: fp.external_sku || fp.sku },
          quantity: 1,
          price: Number(fp.retail_price),
        },
      ],
    };

    const result = await withTransaction((tx) =>
      createOrderTx(tx, {
        external_order_id: simId,
        channel: 'online_store',
        social_platform: 'none',
        campaign_name: 'sinawy.net (EasyOrders Test)',
        customer_name: samplePayload.full_name,
        customer_phone: samplePayload.phone,
        city: samplePayload.government,
        address: samplePayload.address,
        payment_method: 'cod',
        payment_status: 'cod_pending',
        order_status: 'pending',
        shipping_charged: 65,
        shipping_actual_cost: 55,
        notes: 'Simulated EasyOrders webhook order',
        raw_payload: samplePayload,
        items: [{ finished_product_id: fp.id, quantity: 1, unit_price: Number(fp.retail_price) }],
      })
    );

    res.status(201).json({
      ok: true,
      simulated_payload: samplePayload,
      order: result.order,
    });
  } catch (err) {
    console.error('Simulate EasyOrders error:', err);
    res.status(500).json({ error: err.message || 'Simulation failed' });
  }
});

export default router;
