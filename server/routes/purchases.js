import express from 'express';
import { query, withTransaction } from '../db.js';

const router = express.Router();

function genRef(prefix) {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const rnd = String(Math.floor(1000 + Math.random() * 9000));
  return `${prefix}-${ym}-${rnd}`;
}

/* ==================== SUPPLIERS ==================== */
router.get('/suppliers', async (_req, res) => {
  const result = await query(`
    SELECT *
    FROM v_supplier_balances
    ORDER BY name ASC
  `);
  res.json({ suppliers: result.rows });
});

router.get('/suppliers/:id/statement', async (req, res) => {
  try {
    const supplierId = Number(req.params.id);
    const supRes = await query('SELECT * FROM v_supplier_balances WHERE id = $1', [supplierId]);
    if (supRes.rows.length === 0) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    const entriesRes = await query(
      `WITH raw_entries AS (
         SELECT
           'purchase'::text AS entry_type,
           1 AS sort_rank,
           p.id AS source_id,
           p.purchase_date AS entry_date,
           p.created_at,
           p.reference_no,
           p.id AS purchase_id,
           p.reference_no AS purchase_ref,
           NULL::integer AS reversed_payment_id,
           NULL::text AS reversed_ref,
           FALSE AS is_reversed,
           NULL::text AS reversal_ref,
           p.payment_type AS payment_method,
           rm.name AS description,
           rm.name_ar AS description_ar,
           p.notes,
           ROUND(p.total_landed_cost, 2) AS debit_amount,
           0::numeric(12, 2) AS credit_amount
         FROM purchases p
         JOIN raw_materials rm ON rm.id = p.raw_material_id
         WHERE p.supplier_id = $1

         UNION ALL

         SELECT
           sp.transaction_type AS entry_type,
           CASE sp.transaction_type
             WHEN 'down_payment' THEN 2
             WHEN 'payment' THEN 3
             ELSE 4
           END AS sort_rank,
           sp.id AS source_id,
           sp.payment_date AS entry_date,
           sp.created_at,
           COALESCE(sp.reference_no, '#' || sp.id::text) AS reference_no,
           sp.purchase_id,
           sp.purchase_ref,
           sp.reversed_payment_id,
           sp.reversed_ref,
           sp.is_reversed,
           sp.reversal_ref,
           sp.payment_method,
           CASE sp.transaction_type
             WHEN 'down_payment' THEN COALESCE('Down payment — ' || sp.purchase_ref, 'Down payment')
             WHEN 'reversal' THEN 'Reversal of ' || COALESCE(sp.reversed_ref, '#' || sp.reversed_payment_id::text)
             ELSE COALESCE('Payment — ' || sp.purchase_ref, 'Account settlement payment')
           END AS description,
           CASE sp.transaction_type
             WHEN 'down_payment' THEN COALESCE('دفعة مقدمة — ' || sp.purchase_ref, 'دفعة مقدمة')
             WHEN 'reversal' THEN 'عكس دفعة ' || COALESCE(sp.reversed_ref, '#' || sp.reversed_payment_id::text)
             ELSE COALESCE('سداد دفعة — ' || sp.purchase_ref, 'سداد دفعة على الحساب')
           END AS description_ar,
           sp.notes,
           CASE WHEN sp.transaction_type = 'reversal' THEN ROUND(sp.amount, 2) ELSE 0::numeric(12, 2) END AS debit_amount,
           CASE WHEN sp.transaction_type = 'reversal' THEN 0::numeric(12, 2) ELSE ROUND(sp.amount, 2) END AS credit_amount
         FROM v_supplier_payment_ledger sp
         WHERE sp.supplier_id = $1
       )
       SELECT
         re.*,
         ROUND(
           SUM(re.debit_amount - re.credit_amount) OVER (
             ORDER BY re.entry_date ASC, re.sort_rank ASC, re.created_at ASC, re.source_id ASC
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
           ),
           2
         ) AS running_balance
       FROM raw_entries re
       ORDER BY re.entry_date ASC, re.sort_rank ASC, re.created_at ASC, re.source_id ASC`,
      [supplierId]
    );

    res.json({ supplier: supRes.rows[0], entries: entriesRes.rows });
  } catch (err) {
    console.error('Supplier statement error:', err);
    res.status(500).json({ error: 'Failed to load supplier statement' });
  }
});

router.post('/suppliers', async (req, res) => {
  try {
    const {
      name,
      name_ar,
      category = 'general',
      phone = '',
      city = '',
      default_payment_type = 'cash',
      credit_days = 0,
      notes = '',
    } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'Supplier name is required' });
    const payType = default_payment_type === 'credit' ? 'credit' : 'cash';
    const result = await query(
      `INSERT INTO suppliers (name, name_ar, category, phone, city, default_payment_type, credit_days, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [name.trim(), name_ar?.trim() || name.trim(), category, phone, city, payType, Number(credit_days) || 0, notes]
    );
    res.status(201).json({ supplier: result.rows[0] });
  } catch (err) {
    console.error('Create supplier error:', err);
    res.status(500).json({ error: 'Failed to create supplier' });
  }
});

router.patch('/suppliers/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, name_ar, category, phone, city, default_payment_type, credit_days, notes } = req.body || {};
    const result = await query(
      `UPDATE suppliers
       SET name = COALESCE($1, name),
           name_ar = COALESCE($2, name_ar),
           category = COALESCE($3, category),
           phone = COALESCE($4, phone),
           city = COALESCE($5, city),
           default_payment_type = COALESCE($6, default_payment_type),
           credit_days = COALESCE($7, credit_days),
           notes = COALESCE($8, notes)
       WHERE id = $9 RETURNING *`,
      [
        name?.trim() || null,
        name_ar?.trim() || null,
        category || null,
        phone ?? null,
        city ?? null,
        default_payment_type || null,
        credit_days !== undefined ? Number(credit_days) : null,
        notes ?? null,
        id,
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });
    res.json({ supplier: result.rows[0] });
  } catch (err) {
    console.error('Update supplier error:', err);
    res.status(500).json({ error: 'Failed to update supplier' });
  }
});

router.delete('/suppliers/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await query('DELETE FROM suppliers WHERE id = $1 RETURNING id', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete supplier error:', err);
    res.status(400).json({ error: err.message || 'Failed to delete supplier' });
  }
});

/* ==================== SUPPLIER PAYMENTS (IMMUTABLE LEDGER) ==================== */
router.get('/supplier-payments', async (_req, res) => {
  const result = await query(`
    SELECT *
    FROM v_supplier_payment_ledger
    ORDER BY payment_date DESC, id DESC
  `);
  res.json({ payments: result.rows });
});

router.post('/supplier-payments', async (req, res) => {
  try {
    const {
      supplier_id,
      purchase_id = null,
      amount,
      payment_method = 'cash',
      payment_date,
      reference_no = '',
      notes = '',
    } = req.body || {};

    const amt = Number(amount);
    if (!supplier_id || !(amt > 0)) {
      return res.status(400).json({ error: 'Supplier and positive payment amount are required' });
    }

    const payment = await withTransaction(async (tx) => {
      const supCheck = await tx.query('SELECT id FROM suppliers WHERE id = $1', [Number(supplier_id)]);
      if (supCheck.rows.length === 0) {
        const e = new Error('Supplier not found');
        e.status = 404;
        throw e;
      }

      if (purchase_id) {
        const poCheck = await tx.query(
          'SELECT id FROM purchases WHERE id = $1 AND supplier_id = $2',
          [Number(purchase_id), Number(supplier_id)]
        );
        if (poCheck.rows.length === 0) {
          const e = new Error('Selected purchase invoice does not belong to this supplier');
          e.status = 400;
          throw e;
        }
      }

      // Append-only ledger transaction (ZERO UPDATE on purchases!)
      const ref = reference_no?.trim() || genRef('PAY');
      const pRes = await tx.query(
        `INSERT INTO supplier_payments
           (payment_date, supplier_id, purchase_id, amount, payment_method, transaction_type, reversed_payment_id, reference_no, notes)
         VALUES (COALESCE($1::date, CURRENT_DATE), $2, $3, $4, $5, 'payment', NULL, $6, $7)
         RETURNING id`,
        [
          payment_date || null,
          Number(supplier_id),
          purchase_id ? Number(purchase_id) : null,
          Number(amt.toFixed(2)),
          payment_method,
          ref,
          notes,
        ]
      );

      const ledgerRow = await tx.query('SELECT * FROM v_supplier_payment_ledger WHERE id = $1', [pRes.rows[0].id]);
      return ledgerRow.rows[0];
    });

    res.status(201).json({ payment });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Create supplier payment error:', err);
    res.status(500).json({ error: 'Failed to record supplier payment' });
  }
});

async function reverseSupplierPaymentHandler(req, res) {
  try {
    const id = Number(req.params.id);
    const notes = req.body?.notes || '';
    const result = await withTransaction(async (tx) => {
      const pRes = await tx.query('SELECT * FROM supplier_payments WHERE id = $1', [id]);
      if (pRes.rows.length === 0) {
        const e = new Error('Supplier payment not found');
        e.status = 404;
        throw e;
      }
      const pay = pRes.rows[0];

      if (pay.transaction_type === 'reversal') {
        const e = new Error('Cannot reverse a reversal transaction');
        e.status = 400;
        throw e;
      }

      const existingRev = await tx.query(
        'SELECT id FROM supplier_payments WHERE reversed_payment_id = $1',
        [pay.id]
      );
      if (existingRev.rows.length > 0) {
        const e = new Error('This payment has already been reversed');
        e.status = 409;
        throw e;
      }

      // Append-only reversal transaction (ZERO UPDATE / ZERO DELETE!)
      const revRef = genRef('REV');
      const revNotes = String(notes).trim() || `Reversal of ${pay.reference_no || `#${pay.id}`}`;
      const revRes = await tx.query(
        `INSERT INTO supplier_payments
           (payment_date, supplier_id, purchase_id, amount, payment_method, transaction_type, reversed_payment_id, reference_no, notes)
         VALUES (CURRENT_DATE, $1, $2, $3, $4, 'reversal', $5, $6, $7)
         RETURNING id`,
        [
          pay.supplier_id,
          pay.purchase_id,
          Number(Number(pay.amount).toFixed(2)),
          pay.payment_method,
          pay.id,
          revRef,
          revNotes,
        ]
      );

      const ledgerRev = await tx.query('SELECT * FROM v_supplier_payment_ledger WHERE id = $1', [revRes.rows[0].id]);
      return { reversal: ledgerRev.rows[0], cancelled_payment: pay };
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === '23505') {
      return res.status(409).json({ error: 'This payment has already been reversed' });
    }
    console.error('Reverse supplier payment error:', err);
    res.status(500).json({ error: 'Failed to reverse supplier payment' });
  }
}

router.post('/supplier-payments/:id/reverse', reverseSupplierPaymentHandler);
router.delete('/supplier-payments/:id', reverseSupplierPaymentHandler);

/* ==================== RAW MATERIALS ==================== */
router.get('/materials', async (_req, res) => {
  const result = await query(
    `SELECT *,
      CASE WHEN category = 'oil' AND units_per_purchase > 0
           THEN ROUND(stock_qty / units_per_purchase, 2)
           ELSE NULL END AS equivalent_gallons
     FROM raw_materials
     ORDER BY
       CASE category WHEN 'oil' THEN 1 WHEN 'container' THEN 2 WHEN 'sticker' THEN 3 ELSE 4 END,
       name ASC`
  );
  res.json({ materials: result.rows });
});

router.post('/materials', async (req, res) => {
  try {
    const {
      code,
      name,
      name_ar,
      category,
      container_material = 'none',
      capacity_ml = null,
      base_unit,
      purchase_unit,
      units_per_purchase,
      min_stock = 0,
      notes = '',
    } = req.body || {};

    if (!code?.trim() || !name?.trim() || !category) {
      return res.status(400).json({ error: 'Code, name, and category are required' });
    }

    const isOil = category === 'oil';
    const resolvedBaseUnit = base_unit || (isOil ? 'litre' : 'pcs');
    const resolvedPurchaseUnit = purchase_unit || (isOil ? 'gallon_17l' : 'pcs');
    const resolvedUnitsPerPurchase = Number(units_per_purchase) || (isOil ? 17 : 1);

    const result = await query(
      `INSERT INTO raw_materials
        (code, name, name_ar, category, container_material, capacity_ml, base_unit, purchase_unit, units_per_purchase, min_stock, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        code.trim().toUpperCase(),
        name.trim(),
        name_ar?.trim() || name.trim(),
        category,
        category === 'container' ? container_material : 'none',
        capacity_ml ? Number(capacity_ml) : null,
        resolvedBaseUnit,
        resolvedPurchaseUnit,
        resolvedUnitsPerPurchase,
        Number(min_stock) || 0,
        notes,
      ]
    );
    res.status(201).json({ material: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A raw material with this code already exists' });
    }
    console.error('Create raw material error:', err);
    res.status(500).json({ error: 'Failed to create raw material' });
  }
});

router.patch('/materials/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const {
      code,
      name,
      name_ar,
      category,
      container_material,
      capacity_ml,
      units_per_purchase,
      stock_qty,
      avg_unit_cost,
      min_stock,
      notes,
    } = req.body || {};

    const updated = await withTransaction(async (tx) => {
      const curRes = await tx.query('SELECT * FROM raw_materials WHERE id = $1', [id]);
      if (curRes.rows.length === 0) {
        const e = new Error('Material not found');
        e.status = 404;
        throw e;
      }
      const cur = curRes.rows[0];
      const nextCat = category || cur.category;
      const isOil = nextCat === 'oil';
      const nextBaseUnit = isOil ? 'litre' : 'pcs';
      const nextPurchaseUnit = isOil ? 'gallon_17l' : 'pcs';
      const nextStock = stock_qty !== undefined && stock_qty !== '' ? Number(stock_qty) : Number(cur.stock_qty);
      const nextAvg = avg_unit_cost !== undefined && avg_unit_cost !== '' ? Number(avg_unit_cost) : Number(cur.avg_unit_cost);
      const delta = Number((nextStock - Number(cur.stock_qty)).toFixed(3));

      const r = await tx.query(
        `UPDATE raw_materials
         SET code = COALESCE($1, code),
             name = COALESCE($2, name),
             name_ar = COALESCE($3, name_ar),
             category = $4,
             container_material = $5,
             capacity_ml = $6,
             base_unit = $7,
             purchase_unit = $8,
             units_per_purchase = COALESCE($9, units_per_purchase),
             stock_qty = $10,
             avg_unit_cost = $11,
             min_stock = COALESCE($12, min_stock),
             notes = COALESCE($13, notes),
             updated_at = NOW()
         WHERE id = $14 RETURNING *`,
        [
          code?.trim() ? code.trim().toUpperCase() : null,
          name?.trim() || null,
          name_ar?.trim() || null,
          nextCat,
          nextCat === 'container' ? container_material || cur.container_material || 'glass' : 'none',
          nextCat === 'container'
            ? capacity_ml !== undefined && capacity_ml !== ''
              ? Number(capacity_ml)
              : cur.capacity_ml
            : null,
          nextBaseUnit,
          nextPurchaseUnit,
          units_per_purchase !== undefined && units_per_purchase !== '' ? Number(units_per_purchase) : null,
          nextStock,
          nextAvg,
          min_stock !== undefined && min_stock !== '' ? Number(min_stock) : null,
          notes ?? null,
          id,
        ]
      );

      if (Math.abs(delta) > 0.0001) {
        await tx.query(
          `INSERT INTO stock_movements (item_type, item_id, movement_type, qty_delta, unit_cost, reference_no, notes)
           VALUES ('raw', $1, 'adjustment', $2, $3, 'MANUAL-ADJ', 'Manual material stock edit')`,
          [id, delta, nextAvg]
        );
      }

      return r.rows[0];
    });

    res.json({ material: updated });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === '23505') return res.status(409).json({ error: 'A raw material with this code already exists' });
    console.error('Update material error:', err);
    res.status(500).json({ error: 'Failed to update material' });
  }
});

/* ==================== PURCHASES ==================== */
router.get('/', async (req, res) => {
  const category = req.query.category;
  const params = [];
  let where = '';
  if (category && category !== 'all') {
    params.push(category);
    where = 'WHERE material_category = $1';
  }
  const result = await query(
    `SELECT *
     FROM v_purchase_balances
     ${where}
     ORDER BY purchase_date DESC, id DESC`,
    params
  );
  res.json({ purchases: result.rows });
});

router.post('/', async (req, res) => {
  try {
    const {
      purchase_date,
      supplier_id = null,
      raw_material_id,
      purchase_qty,
      units_per_purchase,
      unit_price,
      hidden_cost = 0,
      harvest_lot = '',
      payment_type = 'cash',
      payment_method = 'cash',
      amount_paid,
      due_date = null,
      notes = '',
    } = req.body || {};

    const qty = Number(purchase_qty);
    const price = Number(unit_price);
    const extraCost = Number(hidden_cost) || 0;

    if (!raw_material_id || !(qty > 0) || !(price >= 0) || extraCost < 0) {
      return res.status(400).json({ error: 'Valid material, quantity (>0), and unit price are required' });
    }

    const created = await withTransaction(async (tx) => {
      const matRes = await tx.query('SELECT * FROM raw_materials WHERE id = $1', [
        Number(raw_material_id),
      ]);
      if (matRes.rows.length === 0) {
        const e = new Error('Raw material not found');
        e.status = 404;
        throw e;
      }
      const mat = matRes.rows[0];
      const factor = Number(units_per_purchase) > 0 ? Number(units_per_purchase) : Number(mat.units_per_purchase) || 1;
      const baseQty = Number((qty * factor).toFixed(3));
      const subtotal = Number((qty * price).toFixed(2));
      const totalLandedCost = Number((subtotal + extraCost).toFixed(2));
      const landedPerBase = Number((totalLandedCost / baseQty).toFixed(4));
      const refNo = genRef('PO');

      const resolvedSupplierId = supplier_id ? Number(supplier_id) : null;
      const resolvedPayType = payment_type === 'credit' ? 'credit' : 'cash';
      const validMethods = new Set(['cash', 'bank_transfer', 'instapay', 'vodafone_cash', 'cheque']);
      const resolvedPayMethod = validMethods.has(payment_method) ? payment_method : 'cash';

      let initialPaid = totalLandedCost;
      let resolvedPayStatus = 'paid';
      if (resolvedPayType === 'credit') {
        initialPaid = Math.min(totalLandedCost, Math.max(0, Number(amount_paid) || 0));
        initialPaid = Number(initialPaid.toFixed(2));
        resolvedPayStatus =
          initialPaid >= totalLandedCost ? 'paid' : initialPaid > 0 ? 'partial' : 'unpaid';
      }

      const pRes = await tx.query(
        `INSERT INTO purchases
          (reference_no, purchase_date, supplier_id, raw_material_id, purchase_qty, units_per_purchase,
           base_qty, unit_price, subtotal, hidden_cost, total_landed_cost, landed_cost_per_base_unit,
           harvest_lot, payment_type, amount_paid, due_date, payment_status, notes)
         VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::date, $17, $18)
         RETURNING id`,
        [
          refNo,
          purchase_date || null,
          resolvedSupplierId,
          Number(raw_material_id),
          qty,
          factor,
          baseQty,
          price,
          subtotal,
          extraCost,
          totalLandedCost,
          landedPerBase,
          harvest_lot,
          resolvedPayType,
          resolvedSupplierId ? 0 : initialPaid,
          resolvedPayType === 'credit' ? due_date || null : null,
          resolvedSupplierId ? 'unpaid' : resolvedPayStatus,
          notes,
        ]
      );
      const purchaseId = pRes.rows[0].id;

      // Record immutable down_payment transaction in supplier_payments when paid upfront to a supplier
      if (resolvedSupplierId && initialPaid > 0) {
        const dpRef = resolvedPayType === 'cash' ? `CASH-${refNo}` : `DP-${refNo}`;
        const dpNotes =
          resolvedPayType === 'cash'
            ? `Cash purchase payment (${refNo})`
            : `Down payment on purchase (${refNo})`;
        await tx.query(
          `INSERT INTO supplier_payments
             (payment_date, supplier_id, purchase_id, amount, payment_method, transaction_type, reversed_payment_id, reference_no, notes)
           VALUES (COALESCE($1::date, CURRENT_DATE), $2, $3, $4, $5, 'down_payment', NULL, $6, $7)`,
          [purchase_date || null, resolvedSupplierId, purchaseId, initialPaid, resolvedPayMethod, dpRef, dpNotes]
        );
      }

      // Weighted Average Cost update on raw_materials
      const curQty = Number(mat.stock_qty) || 0;
      const curAvg = Number(mat.avg_unit_cost) || 0;
      const newQty = Number((curQty + baseQty).toFixed(3));
      const newAvg =
        newQty > 0
          ? Number(((curQty * curAvg + totalLandedCost) / newQty).toFixed(4))
          : landedPerBase;

      await tx.query(
        `UPDATE raw_materials
         SET stock_qty = $1, avg_unit_cost = $2, updated_at = NOW()
         WHERE id = $3`,
        [newQty, newAvg, mat.id]
      );

      // Stock movement audit log
      await tx.query(
        `INSERT INTO stock_movements (item_type, item_id, movement_type, qty_delta, unit_cost, reference_no, notes)
         VALUES ('raw', $1, 'purchase', $2, $3, $4, $5)`,
        [
          mat.id,
          baseQty,
          landedPerBase,
          refNo,
          `Purchased ${qty} ${mat.purchase_unit} (${baseQty} ${mat.base_unit})`,
        ]
      );

      // Mirror attached purchase hidden cost in hidden_costs table marked as scope='purchase' (so it's visible in cost breakdown without double-counting in P&L!)
      if (extraCost > 0) {
        await tx.query(
          `INSERT INTO hidden_costs (cost_date, category, title, title_ar, amount, allocation_scope, related_ref, notes)
           VALUES (COALESCE($1::date, CURRENT_DATE), 'shipping_inbound', $2, $3, $4, 'purchase', $5, $6)`,
          [
            purchase_date || null,
            `Purchase landed hidden cost (${mat.name})`,
            `تكلفة خفية للمشتريات (${mat.name_ar || mat.name})`,
            extraCost,
            refNo,
            notes || 'Absorbed into raw material landed unit cost',
          ]
        );
      }

      const balRes = await tx.query('SELECT * FROM v_purchase_balances WHERE id = $1', [purchaseId]);
      return balRes.rows[0];
    });

    res.status(201).json({ purchase: created });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Create purchase error:', err);
    res.status(500).json({ error: 'Failed to record purchase' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const {
      purchase_date,
      supplier_id = null,
      raw_material_id,
      purchase_qty,
      units_per_purchase,
      unit_price,
      hidden_cost = 0,
      harvest_lot = '',
      payment_type = 'cash',
      amount_paid,
      due_date = null,
      notes = '',
    } = req.body || {};

    const qty = Number(purchase_qty);
    const price = Number(unit_price);
    const extraCost = Number(hidden_cost) || 0;

    if (!raw_material_id || !(qty > 0) || !(price >= 0) || extraCost < 0) {
      return res.status(400).json({ error: 'Valid material, quantity (>0), and unit price are required' });
    }

    const updated = await withTransaction(async (tx) => {
      const oldRes = await tx.query('SELECT * FROM purchases WHERE id = $1', [id]);
      if (oldRes.rows.length === 0) {
        const e = new Error('Purchase not found');
        e.status = 404;
        throw e;
      }
      const old = oldRes.rows[0];
      const nextSupplierId = supplier_id ? Number(supplier_id) : null;

      if ((old.supplier_id ?? null) !== nextSupplierId) {
        const activePay = await tx.query(
          `SELECT 1 FROM supplier_payments sp
           WHERE sp.purchase_id = $1
             AND sp.transaction_type <> 'reversal'
             AND NOT EXISTS (SELECT 1 FROM supplier_payments r WHERE r.reversed_payment_id = sp.id)
           LIMIT 1`,
          [id]
        );
        if (activePay.rows.length > 0) {
          const e = new Error('Cannot change supplier on a purchase that has active payment transactions. Reverse the payments first.');
          e.status = 409;
          throw e;
        }
      }

      const newMatRes = await tx.query('SELECT * FROM raw_materials WHERE id = $1', [Number(raw_material_id)]);
      if (newMatRes.rows.length === 0) {
        const e = new Error('Raw material not found');
        e.status = 404;
        throw e;
      }
      const newMat = newMatRes.rows[0];

      const factor = Number(units_per_purchase) > 0 ? Number(units_per_purchase) : Number(newMat.units_per_purchase) || 1;
      const baseQty = Number((qty * factor).toFixed(3));
      const subtotal = Number((qty * price).toFixed(2));
      const totalLanded = Number((subtotal + extraCost).toFixed(2));
      const landedPerBase = Number((totalLanded / baseQty).toFixed(4));

      const resolvedPayType = payment_type === 'credit' ? 'credit' : 'cash';
      let resolvedPaid = old.amount_paid;
      let resolvedPayStatus = old.payment_status;
      if (!nextSupplierId) {
        if (resolvedPayType === 'cash') {
          resolvedPaid = totalLanded;
          resolvedPayStatus = 'paid';
        } else {
          const rawPaid = amount_paid !== undefined && amount_paid !== null ? Number(amount_paid) : Number(old.amount_paid || 0);
          resolvedPaid = Number(Math.min(totalLanded, Math.max(0, rawPaid)).toFixed(2));
          resolvedPayStatus = resolvedPaid >= totalLanded ? 'paid' : resolvedPaid > 0 ? 'partial' : 'unpaid';
        }
      }

      if (Number(old.raw_material_id) === Number(raw_material_id)) {
        const deltaQty = Number((baseQty - Number(old.base_qty)).toFixed(3));
        const nextQty = Math.max(0, Number((Number(newMat.stock_qty) + deltaQty).toFixed(3)));
        const nextVal = Math.max(0, Number(newMat.stock_qty) * Number(newMat.avg_unit_cost) - Number(old.total_landed_cost) + totalLanded);
        const nextAvg = nextQty > 0 ? Number((nextVal / nextQty).toFixed(4)) : landedPerBase;

        await tx.query('UPDATE raw_materials SET stock_qty = $1, avg_unit_cost = $2, updated_at = NOW() WHERE id = $3', [
          nextQty,
          nextAvg,
          newMat.id,
        ]);

        if (deltaQty !== 0) {
          await tx.query(
            `INSERT INTO stock_movements (item_type, item_id, movement_type, qty_delta, unit_cost, reference_no, notes)
             VALUES ('raw', $1, 'adjustment', $2, $3, $4, 'Purchase edited')`,
            [newMat.id, deltaQty, landedPerBase, old.reference_no]
          );
        }
      } else {
        const oldMat = (await tx.query('SELECT * FROM raw_materials WHERE id = $1', [old.raw_material_id])).rows[0];
        const oldNextQty = Math.max(0, Number((Number(oldMat.stock_qty) - Number(old.base_qty)).toFixed(3)));
        const oldNextVal = Math.max(0, Number(oldMat.stock_qty) * Number(oldMat.avg_unit_cost) - Number(old.total_landed_cost));
        const oldNextAvg = oldNextQty > 0 ? Number((oldNextVal / oldNextQty).toFixed(4)) : Number(oldMat.avg_unit_cost);
        await tx.query('UPDATE raw_materials SET stock_qty = $1, avg_unit_cost = $2, updated_at = NOW() WHERE id = $3', [
          oldNextQty,
          oldNextAvg,
          oldMat.id,
        ]);

        const newNextQty = Number((Number(newMat.stock_qty) + baseQty).toFixed(3));
        const newNextVal = Number(newMat.stock_qty) * Number(newMat.avg_unit_cost) + totalLanded;
        const newNextAvg = newNextQty > 0 ? Number((newNextVal / newNextQty).toFixed(4)) : landedPerBase;
        await tx.query('UPDATE raw_materials SET stock_qty = $1, avg_unit_cost = $2, updated_at = NOW() WHERE id = $3', [
          newNextQty,
          newNextAvg,
          newMat.id,
        ]);
      }

      await tx.query(
        `UPDATE purchases
         SET purchase_date = COALESCE($1::date, purchase_date),
             supplier_id = $2,
             raw_material_id = $3,
             purchase_qty = $4,
             units_per_purchase = $5,
             base_qty = $6,
             unit_price = $7,
             subtotal = $8,
             hidden_cost = $9,
             total_landed_cost = $10,
             landed_cost_per_base_unit = $11,
             harvest_lot = $12,
             payment_type = $13,
             amount_paid = $14,
             due_date = $15::date,
             payment_status = $16,
             notes = $17
         WHERE id = $18`,
        [
          purchase_date || null,
          nextSupplierId,
          Number(raw_material_id),
          qty,
          factor,
          baseQty,
          price,
          subtotal,
          extraCost,
          totalLanded,
          landedPerBase,
          harvest_lot,
          resolvedPayType,
          resolvedPaid,
          resolvedPayType === 'credit' ? due_date || null : null,
          resolvedPayStatus,
          notes,
          id,
        ]
      );

      await tx.query("DELETE FROM hidden_costs WHERE allocation_scope = 'purchase' AND related_ref = $1", [old.reference_no]);
      if (extraCost > 0) {
        await tx.query(
          `INSERT INTO hidden_costs (cost_date, category, title, title_ar, amount, allocation_scope, related_ref, notes)
           VALUES (COALESCE($1::date, CURRENT_DATE), 'shipping_inbound', $2, $3, $4, 'purchase', $5, $6)`,
          [
            purchase_date || old.purchase_date,
            `Purchase landed hidden cost (${newMat.name})`,
            `تكلفة خفية للمشتريات (${newMat.name_ar || newMat.name})`,
            extraCost,
            old.reference_no,
            notes || 'Absorbed into raw material landed unit cost',
          ]
        );
      }

      const balRes = await tx.query('SELECT * FROM v_purchase_balances WHERE id = $1', [id]);
      return balRes.rows[0];
    });

    res.json({ purchase: updated });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Update purchase error:', err);
    res.status(500).json({ error: 'Failed to update purchase' });
  }
});

/* ==================== HIDDEN COSTS ==================== */
router.get('/hidden-costs', async (_req, res) => {
  const result = await query(
    'SELECT * FROM hidden_costs ORDER BY cost_date DESC, id DESC'
  );
  res.json({ hidden_costs: result.rows });
});

router.post('/hidden-costs', async (req, res) => {
  try {
    const {
      cost_date,
      category = 'other',
      title,
      title_ar,
      amount,
      allocation_scope = 'overhead',
      related_ref = '',
      notes = '',
    } = req.body || {};

    if (!title?.trim() || !(Number(amount) > 0)) {
      return res.status(400).json({ error: 'Title and positive amount are required' });
    }

    const result = await query(
      `INSERT INTO hidden_costs (cost_date, category, title, title_ar, amount, allocation_scope, related_ref, notes)
       VALUES (COALESCE($1::date, CURRENT_DATE), $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        cost_date || null,
        category,
        title.trim(),
        title_ar?.trim() || title.trim(),
        Number(amount),
        allocation_scope,
        related_ref,
        notes,
      ]
    );
    res.status(201).json({ hidden_cost: result.rows[0] });
  } catch (err) {
    console.error('Create hidden cost error:', err);
    res.status(500).json({ error: 'Failed to record hidden cost' });
  }
});

router.delete('/hidden-costs/:id', async (req, res) => {
  const id = Number(req.params.id);
  const result = await query(
    "DELETE FROM hidden_costs WHERE id = $1 AND allocation_scope = 'overhead' RETURNING id",
    [id]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Standalone hidden cost not found' });
  }
  res.json({ ok: true });
});

export default router;
