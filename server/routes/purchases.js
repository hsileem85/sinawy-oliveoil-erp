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
    SELECT s.*,
           COUNT(p.id)::int AS purchase_count,
           COALESCE(SUM(p.total_landed_cost), 0) AS total_purchased,
           COALESCE(SUM(p.amount_paid), 0) AS total_paid,
           COALESCE(SUM(GREATEST(0, p.total_landed_cost - p.amount_paid)), 0) AS balance_due
    FROM suppliers s
    LEFT JOIN purchases p ON p.supplier_id = s.id
    GROUP BY s.id
    ORDER BY s.name ASC
  `);
  res.json({ suppliers: result.rows });
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
    res.status(500).json({ error: 'Failed to delete supplier' });
  }
});

/* ==================== SUPPLIER PAYMENTS (آجل SETTLEMENT) ==================== */
router.get('/supplier-payments', async (_req, res) => {
  const result = await query(`
    SELECT sp.*,
           s.name AS supplier_name,
           s.name_ar AS supplier_name_ar,
           p.reference_no AS purchase_ref
    FROM supplier_payments sp
    JOIN suppliers s ON s.id = sp.supplier_id
    LEFT JOIN purchases p ON p.id = sp.purchase_id
    ORDER BY sp.payment_date DESC, sp.id DESC
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
      const ref = reference_no?.trim() || genRef('PAY');
      const pRes = await tx.query(
        `INSERT INTO supplier_payments (payment_date, supplier_id, purchase_id, amount, payment_method, reference_no, notes)
         VALUES (COALESCE($1::date, CURRENT_DATE), $2, $3, $4, $5, $6, $7) RETURNING *`,
        [payment_date || null, Number(supplier_id), purchase_id ? Number(purchase_id) : null, Number(amt.toFixed(2)), payment_method, ref, notes]
      );

      let remaining = Number(amt.toFixed(2));

      if (purchase_id) {
        const poRes = await tx.query(
          'SELECT id, total_landed_cost, amount_paid FROM purchases WHERE id = $1 AND supplier_id = $2',
          [Number(purchase_id), Number(supplier_id)]
        );
        if (poRes.rows.length > 0) {
          const po = poRes.rows[0];
          const due = Math.max(0, Number(po.total_landed_cost) - Number(po.amount_paid));
          const apply = Math.min(remaining, due);
          if (apply > 0) {
            const nextPaid = Number((Number(po.amount_paid) + apply).toFixed(2));
            await tx.query(
              `UPDATE purchases SET amount_paid = $1, payment_status = CASE WHEN $1 >= total_landed_cost THEN 'paid' ELSE 'partial' END WHERE id = $2`,
              [nextPaid, po.id]
            );
            remaining = Number((remaining - apply).toFixed(2));
          }
        }
      }

      if (remaining > 0) {
        const openPos = await tx.query(
          `SELECT id, total_landed_cost, amount_paid
           FROM purchases
           WHERE supplier_id = $1 AND amount_paid < total_landed_cost
           ORDER BY purchase_date ASC, id ASC`,
          [Number(supplier_id)]
        );
        for (const po of openPos.rows) {
          if (remaining <= 0) break;
          const due = Math.max(0, Number(po.total_landed_cost) - Number(po.amount_paid));
          const apply = Math.min(remaining, due);
          if (apply > 0) {
            const nextPaid = Number((Number(po.amount_paid) + apply).toFixed(2));
            await tx.query(
              `UPDATE purchases SET amount_paid = $1, payment_status = CASE WHEN $1 >= total_landed_cost THEN 'paid' ELSE 'partial' END WHERE id = $2`,
              [nextPaid, po.id]
            );
            remaining = Number((remaining - apply).toFixed(2));
          }
        }
      }

      return pRes.rows[0];
    });

    res.status(201).json({ payment });
  } catch (err) {
    console.error('Create supplier payment error:', err);
    res.status(500).json({ error: 'Failed to record supplier payment' });
  }
});

router.delete('/supplier-payments/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await withTransaction(async (tx) => {
      const pRes = await tx.query('SELECT * FROM supplier_payments WHERE id = $1', [id]);
      if (pRes.rows.length === 0) {
        const e = new Error('Supplier payment not found');
        e.status = 404;
        throw e;
      }
      const pay = pRes.rows[0];
      let remaining = Number(pay.amount);

      if (pay.purchase_id) {
        const poRes = await tx.query(
          'SELECT id, total_landed_cost, amount_paid FROM purchases WHERE id = $1 AND supplier_id = $2',
          [pay.purchase_id, pay.supplier_id]
        );
        if (poRes.rows.length > 0 && Number(poRes.rows[0].amount_paid) > 0) {
          const po = poRes.rows[0];
          const deduct = Math.min(remaining, Number(po.amount_paid));
          const nextPaid = Number(Math.max(0, Number(po.amount_paid) - deduct).toFixed(2));
          await tx.query(
            `UPDATE purchases
             SET amount_paid = $1,
                 payment_status = CASE WHEN $1 >= total_landed_cost THEN 'paid' WHEN $1 > 0 THEN 'partial' ELSE 'unpaid' END
             WHERE id = $2`,
            [nextPaid, po.id]
          );
          remaining = Number((remaining - deduct).toFixed(2));
        }
      }

      if (remaining > 0) {
        const pos = await tx.query(
          `SELECT id, total_landed_cost, amount_paid
           FROM purchases
           WHERE supplier_id = $1 AND amount_paid > 0
           ORDER BY CASE WHEN payment_type = 'credit' THEN 0 ELSE 1 END ASC, purchase_date DESC, id DESC`,
          [pay.supplier_id]
        );
        for (const po of pos.rows) {
          if (remaining <= 0) break;
          const deduct = Math.min(remaining, Number(po.amount_paid));
          if (deduct > 0) {
            const nextPaid = Number(Math.max(0, Number(po.amount_paid) - deduct).toFixed(2));
            await tx.query(
              `UPDATE purchases
               SET amount_paid = $1,
                   payment_status = CASE WHEN $1 >= total_landed_cost THEN 'paid' WHEN $1 > 0 THEN 'partial' ELSE 'unpaid' END
               WHERE id = $2`,
              [nextPaid, po.id]
            );
            remaining = Number((remaining - deduct).toFixed(2));
          }
        }
      }

      await tx.query('DELETE FROM supplier_payments WHERE id = $1', [id]);
      return pay;
    });

    res.json({ ok: true, cancelled_payment: result });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Cancel supplier payment error:', err);
    res.status(500).json({ error: 'Failed to cancel supplier payment' });
  }
});

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
    const { name, name_ar, min_stock, notes } = req.body || {};
    const result = await query(
      `UPDATE raw_materials
       SET name = COALESCE($1, name),
           name_ar = COALESCE($2, name_ar),
           min_stock = COALESCE($3, min_stock),
           notes = COALESCE($4, notes),
           updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [name || null, name_ar || null, min_stock !== undefined ? Number(min_stock) : null, notes ?? null, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Material not found' });
    res.json({ material: result.rows[0] });
  } catch (err) {
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
    where = 'WHERE rm.category = $1';
  }
  const result = await query(
    `SELECT p.*,
            GREATEST(0, p.total_landed_cost - p.amount_paid) AS remaining_due,
            rm.code AS material_code,
            rm.name AS material_name,
            rm.name_ar AS material_name_ar,
            rm.category AS material_category,
            rm.base_unit,
            rm.purchase_unit,
            s.name AS supplier_name,
            s.name_ar AS supplier_name_ar
     FROM purchases p
     JOIN raw_materials rm ON rm.id = p.raw_material_id
     LEFT JOIN suppliers s ON s.id = p.supplier_id
     ${where}
     ORDER BY p.purchase_date DESC, p.id DESC`,
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

      const resolvedPayType = payment_type === 'credit' ? 'credit' : 'cash';
      let resolvedPaid = totalLandedCost;
      let resolvedPayStatus = 'paid';
      if (resolvedPayType === 'credit') {
        resolvedPaid = Math.min(totalLandedCost, Math.max(0, Number(amount_paid) || 0));
        resolvedPaid = Number(resolvedPaid.toFixed(2));
        resolvedPayStatus =
          resolvedPaid >= totalLandedCost ? 'paid' : resolvedPaid > 0 ? 'partial' : 'unpaid';
      }

      const pRes = await tx.query(
        `INSERT INTO purchases
          (reference_no, purchase_date, supplier_id, raw_material_id, purchase_qty, units_per_purchase,
           base_qty, unit_price, subtotal, hidden_cost, total_landed_cost, landed_cost_per_base_unit,
           harvest_lot, payment_type, amount_paid, due_date, payment_status, notes)
         VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::date, $17, $18)
         RETURNING *`,
        [
          refNo,
          purchase_date || null,
          supplier_id ? Number(supplier_id) : null,
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
          resolvedPaid,
          due_date || null,
          resolvedPayStatus,
          notes,
        ]
      );

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

      return pRes.rows[0];
    });

    res.status(201).json({ purchase: created });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Create purchase error:', err);
    res.status(500).json({ error: 'Failed to record purchase' });
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
