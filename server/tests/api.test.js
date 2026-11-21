import assert from 'node:assert/strict';
import test from 'node:test';

// Use isolated in-memory PostgreSQL (PGlite) for automated tests
process.env.PGLITE_DATA_DIR = 'memory://';
process.env.DATABASE_URL = '';
process.env.EASYORDERS_WEBHOOK_SECRET = 'test_eo_secret';

import { closeDb } from '../db.js';
import { createApp } from '../index.js';
import { seedDemoData } from '../seed.js';

let server;
let baseUrl;
let token;
let apiKey;

test.before(async () => {
  await seedDemoData({ force: false });
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });

  // Login as default admin
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@sinawy.net', password: 'sinawy2026' }),
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  token = data.token;
  assert.ok(token);

  const keysRes = await fetch(`${baseUrl}/api/auth/api-keys`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const keysData = await keysRes.json();
  apiKey = keysData.keys[0].key_value;
  assert.ok(apiKey);
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  await closeDb();
});

test('Phase 1: Recording 17L oil gallon purchase updates litres and weighted avg landed cost', async () => {
  const matRes = await fetch(`${baseUrl}/api/purchases/materials`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { materials } = await matRes.json();
  const evoo = materials.find((m) => m.code === 'OIL-EVOO');
  const beforeLitres = Number(evoo.stock_qty);

  // Buy 2 gallons (34 litres) @ 5,270 EGP/gal + 340 EGP transport = 10,880 EGP -> 320 EGP/L
  const pRes = await fetch(`${baseUrl}/api/purchases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      raw_material_id: evoo.id,
      purchase_qty: 2,
      units_per_purchase: 17,
      unit_price: 5270,
      hidden_cost: 340,
      harvest_lot: 'Test Lot #T1',
    }),
  });
  assert.equal(pRes.status, 201);
  const { purchase } = await pRes.json();
  assert.equal(Number(purchase.base_qty), 34);
  assert.equal(Number(purchase.total_landed_cost), 10880);
  assert.equal(Number(purchase.landed_cost_per_base_unit), 320);

  const matRes2 = await fetch(`${baseUrl}/api/purchases/materials`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { materials: materials2 } = await matRes2.json();
  const evooAfter = materials2.find((m) => m.code === 'OIL-EVOO');
  assert.equal(Number(evooAfter.stock_qty), Number((beforeLitres + 34).toFixed(3)));
});

test('Phase 2: Bottling batch deducts oil + bottles + stickers and computes exact unit COGS', async () => {
  const prodRes = await fetch(`${baseUrl}/api/bottling/products`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { products } = await prodRes.json();
  const sku500 = products.find((p) => p.sku === 'SNW-EVOO-500G');
  const beforeStock = Number(sku500.stock_qty);

  const bRes = await fetch(`${baseUrl}/api/bottling/batches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      finished_product_id: sku500.id,
      quantity_produced: 10,
      spillage_litres: 0.1,
      batch_hidden_cost: 50,
      harvest_note: 'Test Batch',
    }),
  });
  assert.equal(bRes.status, 201);
  const { batch } = await bRes.json();
  assert.equal(batch.quantity_produced, 10);
  assert.equal(Number(batch.oil_litres_used), 5);
  assert.ok(Number(batch.unit_cogs) > 150);

  const prodRes2 = await fetch(`${baseUrl}/api/bottling/products`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const { products: products2 } = await prodRes2.json();
  const skuAfter = products2.find((p) => p.sku === 'SNW-EVOO-500G');
  assert.equal(Number(skuAfter.stock_qty), beforeStock + 10);
});

test('Phase 3 & Integrations: EasyOrders webhook creates idempotent order and cancel restores stock', async () => {
  const stockBeforeRes = await fetch(`${baseUrl}/api/integrations/stock`, {
    headers: { 'X-API-Key': apiKey },
  });
  assert.equal(stockBeforeRes.status, 200);
  const stockBefore = (await stockBeforeRes.json()).products.find((p) => p.sku === 'SNW-EVOO-500G').stock_qty;

  const eoPayload = {
    id: 'EO-TEST-9991',
    full_name: 'Mona Salem',
    phone: '01009998877',
    government: 'Cairo',
    shipping_cost: 65,
    payment_method: 'cod',
    cart_items: [{ product: { sku: 'SNW-EVOO-500G' }, quantity: 2, price: 390 }],
  };

  // First webhook call creates order
  const w1 = await fetch(`${baseUrl}/api/integrations/easyorders/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-easyorders-secret': 'test_eo_secret' },
    body: JSON.stringify(eoPayload),
  });
  assert.equal(w1.status, 201);
  const d1 = await w1.json();
  assert.equal(d1.duplicate, false);
  assert.equal(d1.order.channel, 'online_store');

  // Second identical webhook call is idempotent
  const w2 = await fetch(`${baseUrl}/api/integrations/easyorders/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-easyorders-secret': 'test_eo_secret' },
    body: JSON.stringify(eoPayload),
  });
  assert.equal(w2.status, 200);
  const d2 = await w2.json();
  assert.equal(d2.duplicate, true);

  // Stock deducted by 2
  const stockMidRes = await fetch(`${baseUrl}/api/integrations/stock`, {
    headers: { 'X-API-Key': apiKey },
  });
  const stockMid = (await stockMidRes.json()).products.find((p) => p.sku === 'SNW-EVOO-500G').stock_qty;
  assert.equal(stockMid, stockBefore - 2);

  // Cancelling order restores stock back to original
  const cancelRes = await fetch(`${baseUrl}/api/sales/orders/${d1.order.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ order_status: 'cancelled' }),
  });
  assert.equal(cancelRes.status, 200);

  const stockAfterRes = await fetch(`${baseUrl}/api/integrations/stock`, {
    headers: { 'X-API-Key': apiKey },
  });
  const stockAfter = (await stockAfterRes.json()).products.find((p) => p.sku === 'SNW-EVOO-500G').stock_qty;
  assert.equal(stockAfter, stockBefore);
});

test('Dashboard summary returns complete P&L and marketing metrics', async () => {
  const res = await fetch(`${baseUrl}/api/dashboard/summary`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(data.pnl.net_sales_revenue > 0);
  assert.ok(data.pnl.total_cogs > 0);
  assert.equal(data.channels.length, 3);
  assert.ok(data.inventory.total_oil_litres > 0);
});

test('Suppliers & Credit (آجل): Credit purchase tracks balance due and settlement clears it', async () => {
  // 1. Create a credit supplier
  const sRes = await fetch(`${baseUrl}/api/purchases/suppliers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: 'Sinai Farms Credit Mill',
      name_ar: 'معصرة مزارع سيناء',
      category: 'oil',
      default_payment_type: 'credit',
      credit_days: 30,
    }),
  });
  assert.equal(sRes.status, 201);
  const { supplier } = await sRes.json();
  assert.equal(supplier.default_payment_type, 'credit');

  // 2. Record a Credit (آجل) purchase with partial down payment (total = 10,000, paid = 3,000, due = 7,000)
  const matRes = await fetch(`${baseUrl}/api/purchases/materials`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const evoo = (await matRes.json()).materials.find((m) => m.code === 'OIL-EVOO');

  const pRes = await fetch(`${baseUrl}/api/purchases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      raw_material_id: evoo.id,
      supplier_id: supplier.id,
      purchase_qty: 2,
      units_per_purchase: 17,
      unit_price: 5000,
      hidden_cost: 0,
      payment_type: 'credit',
      amount_paid: 3000,
      due_date: '2026-12-20',
    }),
  });
  assert.equal(pRes.status, 201);
  const { purchase } = await pRes.json();
  assert.equal(purchase.payment_type, 'credit');
  assert.equal(Number(purchase.amount_paid), 3000);
  assert.equal(purchase.payment_status, 'partial');

  // 3. Check supplier balance_due == 7,000
  const listRes = await fetch(`${baseUrl}/api/purchases/suppliers`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const supAfterPo = (await listRes.json()).suppliers.find((s) => s.id === supplier.id);
  assert.equal(Number(supAfterPo.balance_due), 7000);

  // 4. Record settlement payment of 7,000 EGP
  const payRes = await fetch(`${baseUrl}/api/purchases/supplier-payments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      supplier_id: supplier.id,
      amount: 7000,
      payment_method: 'cash',
      notes: 'Full آجل settlement',
    }),
  });
  assert.equal(payRes.status, 201);

  // 5. Verify supplier balance_due is now 0
  const listRes2 = await fetch(`${baseUrl}/api/purchases/suppliers`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const supAfterPay = (await listRes2.json()).suppliers.find((s) => s.id === supplier.id);
  assert.equal(Number(supAfterPay.balance_due), 0);
});

