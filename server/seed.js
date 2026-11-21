import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, withTransaction } from './db.js';
import { runMigrations } from './migrate.js';
import { createOrderTx } from './routes/sales.js';

export async function seedDemoData({ force = false } = {}) {
  await runMigrations();

  const existing = await query('SELECT COUNT(*)::int AS cnt FROM raw_materials');
  if (existing.rows[0].cnt > 0 && !force) {
    return { seeded: false, message: 'Database already contains data' };
  }

  if (force) {
    await query(`
      TRUNCATE TABLE
        stock_movements, sales_order_items, sales_orders, ad_spend,
        bottling_batches, finished_products, hidden_costs, purchases,
        raw_materials, suppliers
      RESTART IDENTITY CASCADE
    `);
  }

  // 1. Suppliers
  const supRes = await query(`
    INSERT INTO suppliers (name, name_ar, category, phone, city, notes) VALUES
      ('Al-Arish Cold-Press Mill', 'معصرة العريش للزيتون', 'oil', '01001122334', 'El-Arish, North Sinai', 'Single-origin cold-pressed Sinai olive oil in 17L gallons'),
      ('El-Obour Glass & Tin Co.', 'العبور لعبوات الزجاج والصفيح', 'bottles', '01122334455', 'El-Obour, Cairo', 'Dark UV glass bottles & food-grade gold tins'),
      ('Delta Label & Print', 'دلتا لطباعة الاستيكر والتغليف', 'stickers', '01233445566', '10th of Ramadan', 'Waterproof oil-resistant labels & corrugated boxes')
    RETURNING id, category
  `);
  const supOil = supRes.rows.find((s) => s.category === 'oil').id;
  const supBottles = supRes.rows.find((s) => s.category === 'bottles').id;
  const supStickers = supRes.rows.find((s) => s.category === 'stickers').id;

  // 2. Raw Materials (Phase 1)
  const matRes = await query(`
    INSERT INTO raw_materials
      (code, name, name_ar, category, container_material, capacity_ml, base_unit, purchase_unit, units_per_purchase, min_stock, notes)
    VALUES
      ('OIL-EVOO', 'Sinai Extra Virgin Olive Oil (Bulk)', 'زيت زيتون بكر ممتاز سيناوي (جملة)', 'oil', 'none', NULL, 'litre', 'gallon_17l', 17, 34, 'Acidity < 0.6%, bought in 17L gallons'),
      ('OIL-VOO', 'Sinai Virgin Olive Oil (Bulk)', 'زيت زيتون بكر سيناوي (جملة)', 'oil', 'none', NULL, 'litre', 'gallon_17l', 17, 17, 'First cold-press virgin oil in 17L gallons'),
      ('BTL-GLS-500', '500ml Dark Glass Bottle + Cap', 'زجاجة زجاج داكن ٥٠٠ مل بالغطاء', 'container', 'glass', 500, 'pcs', 'pcs', 1, 40, 'Dorica UV-protected dark green glass'),
      ('BTL-GLS-250', '250ml Dark Glass Bottle + Cap', 'زجاجة زجاج داكن ٢٥٠ مل بالغطاء', 'container', 'glass', 250, 'pcs', 'pcs', 1, 40, 'Dorica 250ml glass bottle'),
      ('BTL-TIN-1000', '1L Gold Metal Tin + Pour Spout', 'عبوة صفيح ذهبي ١ لتر', 'container', 'tin', 1000, 'pcs', 'pcs', 1, 30, 'Food-grade coated tin can'),
      ('BTL-TIN-2000', '2L Family Metal Tin', 'عبوة صفيح عائلي ٢ لتر', 'container', 'tin', 2000, 'pcs', 'pcs', 1, 15, '2-Litre family metal tin'),
      ('STK-SINAWY', 'Sinawy Waterproof Label Sticker', 'استيكر سيناوي مقاوم للزيت', 'sticker', 'none', NULL, 'pcs', 'pcs', 1, 100, 'Front & back bilingual EN/AR label'),
      ('PKG-BOX', 'Protective Shipping Box & Neck Seal', 'كرتونة شحن مبطنة + سيل أمان', 'packaging', 'none', NULL, 'pcs', 'pcs', 1, 50, 'E-commerce safe shipping carton')
    RETURNING id, code
  `);
  const M = Object.fromEntries(matRes.rows.map((r) => [r.code, r.id]));

  // Helper to record a purchase cleanly in DB (same math as API)
  async function recordPurchase({
    ref, date, supplierId, materialId, qty, factor, unitPrice, hiddenCost, lot, notes,
  }) {
    await withTransaction(async (tx) => {
      const m = (await tx.query('SELECT * FROM raw_materials WHERE id = $1', [materialId])).rows[0];
      const baseQty = Number((qty * factor).toFixed(3));
      const subtotal = Number((qty * unitPrice).toFixed(2));
      const totalLanded = Number((subtotal + hiddenCost).toFixed(2));
      const landedPerBase = Number((totalLanded / baseQty).toFixed(4));

      await tx.query(
        `INSERT INTO purchases
          (reference_no, purchase_date, supplier_id, raw_material_id, purchase_qty, units_per_purchase,
           base_qty, unit_price, subtotal, hidden_cost, total_landed_cost, landed_cost_per_base_unit,
           harvest_lot, payment_status, notes)
         VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'paid',$14)`,
        [ref, date, supplierId, materialId, qty, factor, baseQty, unitPrice, subtotal, hiddenCost, totalLanded, landedPerBase, lot, notes]
      );

      const curQty = Number(m.stock_qty);
      const curAvg = Number(m.avg_unit_cost);
      const newQty = Number((curQty + baseQty).toFixed(3));
      const newAvg = Number(((curQty * curAvg + totalLanded) / newQty).toFixed(4));

      await tx.query('UPDATE raw_materials SET stock_qty = $1, avg_unit_cost = $2 WHERE id = $3', [newQty, newAvg, m.id]);
      await tx.query(
        `INSERT INTO stock_movements (item_type, item_id, movement_type, qty_delta, unit_cost, reference_no, notes)
         VALUES ('raw', $1, 'purchase', $2, $3, $4, $5)`,
        [m.id, baseQty, landedPerBase, ref, notes]
      );
      if (hiddenCost > 0) {
        await tx.query(
          `INSERT INTO hidden_costs (cost_date, category, title, title_ar, amount, allocation_scope, related_ref, notes)
           VALUES ($1::date, 'shipping_inbound', $2, $3, $4, 'purchase', $5, $6)`,
          [date, `Inbound transport (${m.name})`, `شحن ونقل (${m.name_ar})`, hiddenCost, ref, 'Absorbed into landed cost']
        );
      }
    });
  }

  // Record realistic November 2026 purchases
  await recordPurchase({
    ref: 'PO-202611-101', date: '2026-11-02', supplierId: supOil, materialId: M['OIL-EVOO'],
    qty: 6, factor: 17, unitPrice: 5100, hiddenCost: 1020, lot: 'Sinai Harvest Nov-26 #A1',
    notes: '6 Gallons (102L) Extra Virgin + El-Arish to Cairo freight',
  });
  await recordPurchase({
    ref: 'PO-202611-102', date: '2026-11-03', supplierId: supOil, materialId: M['OIL-VOO'],
    qty: 3, factor: 17, unitPrice: 4250, hiddenCost: 510, lot: 'Sinai Harvest Nov-26 #B1',
    notes: '3 Gallons (51L) Virgin Olive Oil + transport',
  });
  await recordPurchase({
    ref: 'PO-202611-103', date: '2026-11-04', supplierId: supBottles, materialId: M['BTL-GLS-500'],
    qty: 160, factor: 1, unitPrice: 24, hiddenCost: 240, lot: 'GLS-500-Nov',
    notes: '500ml UV dark glass bottles + delivery',
  });
  await recordPurchase({
    ref: 'PO-202611-104', date: '2026-11-04', supplierId: supBottles, materialId: M['BTL-GLS-250'],
    qty: 120, factor: 1, unitPrice: 18, hiddenCost: 180, lot: 'GLS-250-Nov',
    notes: '250ml UV dark glass bottles + delivery',
  });
  await recordPurchase({
    ref: 'PO-202611-105', date: '2026-11-05', supplierId: supBottles, materialId: M['BTL-TIN-1000'],
    qty: 90, factor: 1, unitPrice: 38, hiddenCost: 270, lot: 'TIN-1L-Nov',
    notes: '1L food-grade gold tins + delivery',
  });
  await recordPurchase({
    ref: 'PO-202611-106', date: '2026-11-05', supplierId: supBottles, materialId: M['BTL-TIN-2000'],
    qty: 12, factor: 1, unitPrice: 54, hiddenCost: 60, lot: 'TIN-2L-Nov',
    notes: '2L family metal tins (low stock test)',
  });
  await recordPurchase({
    ref: 'PO-202611-107', date: '2026-11-06', supplierId: supStickers, materialId: M['STK-SINAWY'],
    qty: 500, factor: 1, unitPrice: 3.5, hiddenCost: 150, lot: 'PRNT-2026-11',
    notes: '500 waterproof bilingual stickers',
  });
  await recordPurchase({
    ref: 'PO-202611-108', date: '2026-11-06', supplierId: supStickers, materialId: M['PKG-BOX'],
    qty: 240, factor: 1, unitPrice: 14, hiddenCost: 160, lot: 'BOX-2026-11',
    notes: 'Protective shipping cartons & tamper seals',
  });

  // Standalone Hidden Overhead Costs (unallocated -> directly visible in P&L)
  await query(`
    INSERT INTO hidden_costs (cost_date, category, title, title_ar, amount, allocation_scope, related_ref, notes) VALUES
      ('2026-11-07', 'other', 'Olive Oil Lab Acidity Certificate', 'شهادة تحليل الحموضة بالمعمل', 650, 'overhead', 'LAB-2611', 'Verified 0.48% acidity for Nov 2026 harvest'),
      ('2026-11-10', 'utilities', 'Bottling Room Utilities & Sanitation', 'كهرباء وتعقيم غرفة التعبئة', 850, 'overhead', 'UTIL-NOV', 'Monthly bottling workspace overhead')
  `);

  // 3. Finished Products (Phase 2 SKUs with BOM recipes)
  const fpRes = await query(
    `INSERT INTO finished_products
      (sku, external_sku, name, name_ar, oil_type, container_type, size_ml,
       oil_material_id, oil_litres_per_unit, container_material_id, containers_per_unit,
       sticker_material_id, stickers_per_unit, extra_material_id, extra_qty_per_unit,
       retail_price, min_stock)
     VALUES
      ('SNW-EVOO-500G', 'SNW-EVOO-500G', 'Sinawy EVOO 500ml Dark Glass', 'سيناوي بكر ممتاز ٥٠٠ مل زجاج', 'extra_virgin', 'glass', 500,
       $1, 0.5000, $3, 1, $6, 2, $7, 1, 390, 15),
      ('SNW-EVOO-1000T', 'SNW-EVOO-1000T', 'Sinawy EVOO 1L Gold Tin', 'سيناوي بكر ممتاز ١ لتر صفيح', 'extra_virgin', 'tin', 1000,
       $1, 1.0000, $5, 1, $6, 1, $7, 1, 710, 12),
      ('SNW-EVOO-250G', 'SNW-EVOO-250G', 'Sinawy EVOO 250ml Dark Glass', 'سيناوي بكر ممتاز ٢٥٠ مل زجاج', 'extra_virgin', 'glass', 250,
       $1, 0.2500, $4, 1, $6, 1, $7, 1, 220, 15),
      ('SNW-VOO-1000T', 'SNW-VOO-1000T', 'Sinawy Virgin 1L Gold Tin', 'سيناوي زيت بكر ١ لتر صفيح', 'virgin', 'tin', 1000,
       $2, 1.0000, $5, 1, $6, 1, $7, 1, 580, 10)
     RETURNING id, sku`,
    [M['OIL-EVOO'], M['OIL-VOO'], M['BTL-GLS-500'], M['BTL-GLS-250'], M['BTL-TIN-1000'], M['STK-SINAWY'], M['PKG-BOX']]
  );
  const FP = Object.fromEntries(fpRes.rows.map((r) => [r.sku, r.id]));

  // Helper to run bottling batch
  async function runBatch({ code, date, skuId, qty, spillage, hiddenCost, harvestNote, notes }) {
    await withTransaction(async (tx) => {
      const fp = (await tx.query('SELECT * FROM finished_products WHERE id = $1', [skuId])).rows[0];
      const oilBase = Number((qty * Number(fp.oil_litres_per_unit)).toFixed(3));
      const oilTotal = Number((oilBase + spillage).toFixed(3));
      const cntUsed = Number((qty * Number(fp.containers_per_unit)).toFixed(3));
      const stkUsed = Number((qty * Number(fp.stickers_per_unit)).toFixed(3));
      const extUsed = Number((qty * Number(fp.extra_qty_per_unit)).toFixed(3));

      async function take(matId, amt) {
        if (!matId || !(amt > 0)) return 0;
        const m = (await tx.query('SELECT * FROM raw_materials WHERE id = $1', [matId])).rows[0];
        await tx.query('UPDATE raw_materials SET stock_qty = stock_qty - $1 WHERE id = $2', [amt, m.id]);
        await tx.query(
          `INSERT INTO stock_movements (item_type, item_id, movement_type, qty_delta, unit_cost, reference_no, notes)
           VALUES ('raw', $1, 'bottling_consume', $2, $3, $4, $5)`,
          [m.id, -amt, m.avg_unit_cost, code, `Bottled ${qty}x ${fp.sku}`]
        );
        return Number((amt * Number(m.avg_unit_cost)).toFixed(2));
      }

      const oilCost = await take(fp.oil_material_id, oilTotal);
      const cntCost = await take(fp.container_material_id, cntUsed);
      const stkCost = await take(fp.sticker_material_id, stkUsed);
      const extCost = await take(fp.extra_material_id, extUsed);
      const totalCost = Number((oilCost + cntCost + stkCost + extCost + hiddenCost).toFixed(2));
      const unitCogs = Number((totalCost / qty).toFixed(4));

      await tx.query(
        `INSERT INTO bottling_batches
          (batch_code, batch_date, finished_product_id, quantity_produced,
           oil_litres_used, spillage_litres, containers_used, stickers_used, extra_used,
           oil_cost, container_cost, sticker_cost, extra_cost, batch_hidden_cost,
           total_batch_cost, unit_cogs, harvest_note, notes)
         VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [code, date, fp.id, qty, oilBase, spillage, cntUsed, stkUsed, extUsed, oilCost, cntCost, stkCost, extCost, hiddenCost, totalCost, unitCogs, harvestNote, notes]
      );

      const curStock = Number(fp.stock_qty);
      const curCogs = Number(fp.unit_cogs);
      const newStock = curStock + qty;
      const newCogs = Number(((curStock * curCogs + totalCost) / newStock).toFixed(4));
      await tx.query('UPDATE finished_products SET stock_qty = $1, unit_cogs = $2 WHERE id = $3', [newStock, newCogs, fp.id]);
      await tx.query(
        `INSERT INTO stock_movements (item_type, item_id, movement_type, qty_delta, unit_cost, reference_no, notes)
         VALUES ('finished', $1, 'bottling_produce', $2, $3, $4, $5)`,
        [fp.id, qty, unitCogs, code, `Produced ${qty} units`]
      );
      if (hiddenCost > 0) {
        await tx.query(
          `INSERT INTO hidden_costs (cost_date, category, title, title_ar, amount, allocation_scope, related_ref, notes)
           VALUES ($1::date, 'packaging_misc', $2, $3, $4, 'production', $5, $6)`,
          [date, `Bottling labor & seals (${fp.sku})`, `عمالة وتغليف (${fp.name_ar})`, hiddenCost, code, 'Absorbed into batch unit COGS']
        );
      }
    });
  }

  await runBatch({
    code: 'BTH-202611-201', date: '2026-11-08', skuId: FP['SNW-EVOO-500G'],
    qty: 70, spillage: 0.4, hiddenCost: 280, harvestNote: 'Sinai Nov-26 #A1',
    notes: 'First bottling run of 500ml dark glass bottles',
  });
  await runBatch({
    code: 'BTH-202611-202', date: '2026-11-09', skuId: FP['SNW-EVOO-1000T'],
    qty: 35, spillage: 0.3, hiddenCost: 175, harvestNote: 'Sinai Nov-26 #A1',
    notes: '1L gold tins filled and sealed',
  });
  await runBatch({
    code: 'BTH-202611-203', date: '2026-11-10', skuId: FP['SNW-EVOO-250G'],
    qty: 40, spillage: 0.2, hiddenCost: 120, harvestNote: 'Sinai Nov-26 #A1',
    notes: '250ml gift/trial glass bottles',
  });
  await runBatch({
    code: 'BTH-202611-204', date: '2026-11-11', skuId: FP['SNW-VOO-1000T'],
    qty: 24, spillage: 0.2, hiddenCost: 120, harvestNote: 'Sinai Nov-26 #B1',
    notes: '1L Virgin Olive Oil gold tins',
  });

  // 4. Phase 3 Multi-Channel Sales Orders
  const sampleOrders = [
    {
      order_date: '2026-11-12', external_order_id: 'EO-88401', channel: 'online_store',
      social_platform: 'none', campaign_name: 'sinawy.net (EasyOrders)',
      customer_name: 'Ahmed Hassan / أحمد حسن', customer_phone: '01012345678',
      city: 'Cairo - Maadi', address: 'Degla, St. 233', payment_method: 'cod',
      payment_status: 'paid', order_status: 'delivered', shipping_charged: 65, shipping_actual_cost: 55,
      items: [
        { finished_product_id: FP['SNW-EVOO-500G'], quantity: 2, unit_price: 390 },
        { finished_product_id: FP['SNW-EVOO-1000T'], quantity: 1, unit_price: 710 },
      ],
    },
    {
      order_date: '2026-11-14', channel: 'social_ads', social_platform: 'facebook',
      campaign_name: 'Nov Harvest Cold-Press Video',
      customer_name: 'Nourhan Adel / نورهان عادل', customer_phone: '01145678901',
      city: 'Giza - Sheikh Zayed', address: 'Beverly Hills Compound', payment_method: 'instapay',
      payment_status: 'paid', order_status: 'delivered', discount: 40, shipping_charged: 65, shipping_actual_cost: 60,
      items: [
        { finished_product_id: FP['SNW-EVOO-1000T'], quantity: 2, unit_price: 710 },
        { finished_product_id: FP['SNW-EVOO-250G'], quantity: 2, unit_price: 220 },
      ],
    },
    {
      order_date: '2026-11-16', channel: 'phone_offline', social_platform: 'whatsapp',
      campaign_name: 'Direct Phone / Repeat Family Order',
      customer_name: 'Dr. Mahmoud El-Sayed / د. محمود السيد', customer_phone: '01223344556',
      city: 'Alexandria - Smouha', address: 'Fawzy Moaz St.', payment_method: 'bank_transfer',
      payment_status: 'paid', order_status: 'delivered', discount: 150, shipping_charged: 85, shipping_actual_cost: 75,
      items: [
        { finished_product_id: FP['SNW-EVOO-1000T'], quantity: 5, unit_price: 710 },
        { finished_product_id: FP['SNW-VOO-1000T'], quantity: 3, unit_price: 580 },
      ],
    },
    {
      order_date: '2026-11-18', channel: 'social_ads', social_platform: 'instagram',
      campaign_name: 'Sinai Liquid Gold Reels',
      customer_name: 'Salma Karim / سلمى كريم', customer_phone: '01099887766',
      city: 'Cairo - New Cairo', address: 'Madinaty B6', payment_method: 'cod',
      payment_status: 'cod_pending', order_status: 'shipped', shipping_charged: 65, shipping_actual_cost: 55,
      items: [
        { finished_product_id: FP['SNW-EVOO-500G'], quantity: 3, unit_price: 390 },
      ],
    },
    {
      order_date: '2026-11-19', external_order_id: 'EO-88459', channel: 'online_store',
      social_platform: 'none', campaign_name: 'sinawy.net (EasyOrders)',
      customer_name: 'Omar Farouk / عمر فاروق', customer_phone: '01554433221',
      city: 'Cairo - Nasr City', address: 'Abbas El-Akkad', payment_method: 'cod',
      payment_status: 'cod_pending', order_status: 'confirmed', shipping_charged: 60, shipping_actual_cost: 55,
      items: [
        { finished_product_id: FP['SNW-EVOO-500G'], quantity: 2, unit_price: 390 },
        { finished_product_id: FP['SNW-EVOO-250G'], quantity: 1, unit_price: 220 },
      ],
    },
    {
      order_date: '2026-11-20', channel: 'phone_offline', social_platform: 'none',
      campaign_name: 'Phone Order',
      customer_name: 'Heba Mostafa / هبة مصطفى', customer_phone: '01066554433',
      city: 'Giza - Dokki', address: 'Mesaha Square', payment_method: 'vodafone_cash',
      payment_status: 'paid', order_status: 'packed', shipping_charged: 50, shipping_actual_cost: 50,
      items: [
        { finished_product_id: FP['SNW-VOO-1000T'], quantity: 2, unit_price: 580 },
        { finished_product_id: FP['SNW-EVOO-500G'], quantity: 1, unit_price: 390 },
      ],
    },
  ];

  for (const ord of sampleOrders) {
    await withTransaction((tx) => createOrderTx(tx, ord));
  }

  // 5. Social Media Ad Spend
  await query(`
    INSERT INTO ad_spend (spend_date, platform, campaign_name, amount, notes) VALUES
      ('2026-11-12', 'facebook', 'Nov Harvest Cold-Press Video', 650, 'Meta Ads - Cairo & Giza targeting'),
      ('2026-11-17', 'instagram', 'Sinai Liquid Gold Reels', 480, 'IG Reels engagement + Messages campaign')
  `);

  return { seeded: true, message: 'Seeded Sinawy Olive Oil ERP demo dataset' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const force = process.argv.includes('--reset');
  seedDemoData({ force })
    .then((res) => {
      console.log(res.message);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Seed failed:', err);
      process.exit(1);
    });
}
