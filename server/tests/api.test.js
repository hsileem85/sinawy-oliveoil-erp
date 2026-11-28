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

test('Suppliers & Credit (آجل): Immutable ledger transactions, reversals, and running-balance statement', async () => {
  const { query } = await import('../db.js');

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

  // 2. Record a Credit (آجل) purchase with partial down payment (total = 10,000, down_payment = 3,000, due = 7,000)
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
      payment_method: 'instapay',
      amount_paid: 3000,
      due_date: '2026-12-20',
    }),
  });
  assert.equal(pRes.status, 201);
  const { purchase } = await pRes.json();
  assert.equal(purchase.payment_type, 'credit');
  assert.equal(Number(purchase.amount_paid), 3000);
  assert.equal(Number(purchase.remaining_due), 7000);
  assert.equal(purchase.payment_status, 'partial');

  // Verify raw purchases row itself was NOT stored with amount_paid=3000 (ledger is single source of truth)
  const rawPoBefore = (await query('SELECT amount_paid, payment_status FROM purchases WHERE id = $1', [purchase.id])).rows[0];
  assert.equal(Number(rawPoBefore.amount_paid), 0);

  // 3. Check supplier balance_due == 7,000
  const listRes = await fetch(`${baseUrl}/api/purchases/suppliers`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const supAfterPo = (await listRes.json()).suppliers.find((s) => s.id === supplier.id);
  assert.equal(Number(supAfterPo.balance_due), 7000);
  assert.equal(Number(supAfterPo.total_paid), 3000);

  // 4. Record settlement payment of 7,000 EGP (pure INSERT transaction, ZERO UPDATE on purchases)
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
  const { payment } = await payRes.json();
  assert.equal(payment.transaction_type, 'payment');
  assert.equal(payment.is_reversed, false);

  // Confirm purchases row was NOT mutated by recording the payment!
  const rawPoAfterPay = (await query('SELECT amount_paid, payment_status FROM purchases WHERE id = $1', [purchase.id])).rows[0];
  assert.equal(Number(rawPoAfterPay.amount_paid), 0);
  assert.equal(rawPoAfterPay.payment_status, 'unpaid');

  // 5. Verify dynamic supplier balance_due is 0 AND dynamic purchase status is 'paid'
  const listRes2 = await fetch(`${baseUrl}/api/purchases/suppliers`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const supAfterPay = (await listRes2.json()).suppliers.find((s) => s.id === supplier.id);
  assert.equal(Number(supAfterPay.balance_due), 0);
  assert.equal(Number(supAfterPay.total_paid), 10000);

  const poListAfterPay = (await (await fetch(`${baseUrl}/api/purchases`, { headers: { Authorization: `Bearer ${token}` } })).json()).purchases;
  const dynPoAfterPay = poListAfterPay.find((p) => p.id === purchase.id);
  assert.equal(Number(dynPoAfterPay.amount_paid), 10000);
  assert.equal(Number(dynPoAfterPay.remaining_due), 0);
  assert.equal(dynPoAfterPay.payment_status, 'paid');

  // 6. Reverse the settlement payment (appends a 'reversal' row without deleting or editing the original)
  const revRes = await fetch(`${baseUrl}/api/purchases/supplier-payments/${payment.id}/reverse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ notes: 'Entered wrong bank account' }),
  });
  assert.equal(revRes.status, 200);
  const revData = await revRes.json();
  assert.equal(revData.ok, true);
  assert.equal(revData.reversal.transaction_type, 'reversal');
  assert.equal(revData.reversal.reversed_payment_id, payment.id);
  assert.equal(Number(revData.reversal.signed_amount), -7000);

  // 7. Verify double-reversal is rejected (409) and reversing a reversal is rejected (400)
  const doubleRevRes = await fetch(`${baseUrl}/api/purchases/supplier-payments/${payment.id}/reverse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({}),
  });
  assert.equal(doubleRevRes.status, 409);

  const revOfRevRes = await fetch(`${baseUrl}/api/purchases/supplier-payments/${revData.reversal.id}/reverse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({}),
  });
  assert.equal(revOfRevRes.status, 400);

  // 8. Verify direct SQL UPDATE and DELETE on supplier_payments are blocked by immutability trigger
  await assert.rejects(
    () => query('UPDATE supplier_payments SET amount = 1 WHERE id = $1', [payment.id]),
    /immutable append-only ledger/i
  );
  await assert.rejects(
    () => query('DELETE FROM supplier_payments WHERE id = $1', [payment.id]),
    /immutable append-only ledger/i
  );

  // 9. Verify original payment still exists in ledger and is marked is_reversed = true
  const ledgerRes = await fetch(`${baseUrl}/api/purchases/supplier-payments`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const ledgerRows = (await ledgerRes.json()).payments.filter((r) => r.supplier_id === supplier.id);
  assert.equal(ledgerRows.length, 3); // down_payment + payment + reversal
  const origRow = ledgerRows.find((r) => r.id === payment.id);
  assert.equal(origRow.is_reversed, true);
  assert.equal(origRow.reversal_id, revData.reversal.id);

  // 10. Verify balance_due restored to 7,000 and Supplier Statement running balance is exact
  const listRes3 = await fetch(`${baseUrl}/api/purchases/suppliers`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const supAfterCancel = (await listRes3.json()).suppliers.find((s) => s.id === supplier.id);
  assert.equal(Number(supAfterCancel.balance_due), 7000);

  const stmtRes = await fetch(`${baseUrl}/api/purchases/suppliers/${supplier.id}/statement`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(stmtRes.status, 200);
  const stmt = await stmtRes.json();
  assert.equal(stmt.entries.length, 4); // purchase, down_payment, payment, reversal
  assert.equal(stmt.entries.map((e) => e.entry_type).join(','), 'purchase,down_payment,payment,reversal');
  assert.deepEqual(
    stmt.entries.map((e) => Number(e.running_balance)),
    [10000, 7000, 0, 7000]
  );
  assert.equal(Number(stmt.supplier.balance_due), 7000);
});

test('Edit operations: Raw Material, Purchase, Finished Product, and Bottling Batch update atomically', async () => {
  // 1. Edit Raw Material
  const matsBefore = (await (await fetch(`${baseUrl}/api/purchases/materials`, { headers: { Authorization: `Bearer ${token}` } })).json()).materials;
  const evoo = matsBefore.find((m) => m.code === 'OIL-EVOO');
  const mEditRes = await fetch(`${baseUrl}/api/purchases/materials/${evoo.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ min_stock: 40, notes: 'Updated EVOO notes' }),
  });
  assert.equal(mEditRes.status, 200);
  const { material: editedMat } = await mEditRes.json();
  assert.equal(Number(editedMat.min_stock), 40);

  // 2. Edit Purchase (increase qty by +1 gallon => +17L raw oil)
  const pos = (await (await fetch(`${baseUrl}/api/purchases`, { headers: { Authorization: `Bearer ${token}` } })).json()).purchases;
  const oilPo = pos.find((p) => p.raw_material_id === evoo.id);
  const stockBeforePoEdit = Number(editedMat.stock_qty);
  const poEditRes = await fetch(`${baseUrl}/api/purchases/${oilPo.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      raw_material_id: oilPo.raw_material_id,
      supplier_id: oilPo.supplier_id,
      purchase_date: String(oilPo.purchase_date).slice(0, 10),
      purchase_qty: Number(oilPo.purchase_qty) + 1,
      units_per_purchase: 17,
      unit_price: Number(oilPo.unit_price),
      hidden_cost: Number(oilPo.hidden_cost),
      payment_type: oilPo.payment_type || 'cash',
      amount_paid: Number(oilPo.amount_paid || 0),
    }),
  });
  assert.equal(poEditRes.status, 200);
  const evooAfterPo = (await (await fetch(`${baseUrl}/api/purchases/materials`, { headers: { Authorization: `Bearer ${token}` } })).json()).materials.find((m) => m.id === evoo.id);
  assert.equal(Number(evooAfterPo.stock_qty), Number((stockBeforePoEdit + 17).toFixed(3)));

  // 3. Edit Finished Product (retail price & min_stock)
  const prods = (await (await fetch(`${baseUrl}/api/bottling/products`, { headers: { Authorization: `Bearer ${token}` } })).json()).products;
  const sku = prods.find((p) => p.sku === 'SNW-EVOO-500G');
  const pEditRes = await fetch(`${baseUrl}/api/bottling/products/${sku.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      ...sku,
      retail_price: 410,
      min_stock: 20,
    }),
  });
  assert.equal(pEditRes.status, 200);
  const { product: editedProd } = await pEditRes.json();
  assert.equal(Number(editedProd.retail_price), 410);

  // 4. Edit Bottling Batch (increase produced quantity by +2 bottles => finished stock +2, oil -1L)
  const batches = (await (await fetch(`${baseUrl}/api/bottling/batches`, { headers: { Authorization: `Bearer ${token}` } })).json()).batches;
  const batch = batches.find((b) => b.finished_product_id === sku.id);
  const fpStockBefore = Number(editedProd.stock_qty);
  const bEditRes = await fetch(`${baseUrl}/api/bottling/batches/${batch.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      batch_date: String(batch.batch_date).slice(0, 10),
      quantity_produced: Number(batch.quantity_produced) + 2,
      spillage_litres: Number(batch.spillage_litres),
      batch_hidden_cost: Number(batch.batch_hidden_cost) + 40,
      harvest_note: 'Updated Harvest',
    }),
  });
  assert.equal(bEditRes.status, 200);
  const skuAfterBatch = (await (await fetch(`${baseUrl}/api/bottling/products`, { headers: { Authorization: `Bearer ${token}` } })).json()).products.find((p) => p.id === sku.id);
  assert.equal(Number(skuAfterBatch.stock_qty), fpStockBefore + 2);
});


