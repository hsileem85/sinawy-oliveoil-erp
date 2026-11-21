import express from 'express';
import { query, withTransaction } from '../db.js';

const router = express.Router();

function genBatchCode() {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const rnd = String(Math.floor(1000 + Math.random() * 9000));
  return `BTH-${ym}-${rnd}`;
}

/* ==================== FINISHED SKUS & BOM ==================== */
router.get('/products', async (_req, res) => {
  const result = await query(
    `SELECT fp.*,
            oil.name AS oil_name, oil.name_ar AS oil_name_ar, oil.stock_qty AS oil_stock_qty, oil.avg_unit_cost AS oil_unit_cost,
            cnt.name AS container_name, cnt.name_ar AS container_name_ar, cnt.stock_qty AS container_stock_qty, cnt.avg_unit_cost AS container_unit_cost,
            stk.name AS sticker_name, stk.name_ar AS sticker_name_ar, stk.stock_qty AS sticker_stock_qty, stk.avg_unit_cost AS sticker_unit_cost,
            ext.name AS extra_name, ext.name_ar AS extra_name_ar, ext.stock_qty AS extra_stock_qty, ext.avg_unit_cost AS extra_unit_cost
     FROM finished_products fp
     LEFT JOIN raw_materials oil ON oil.id = fp.oil_material_id
     LEFT JOIN raw_materials cnt ON cnt.id = fp.container_material_id
     LEFT JOIN raw_materials stk ON stk.id = fp.sticker_material_id
     LEFT JOIN raw_materials ext ON ext.id = fp.extra_material_id
     ORDER BY fp.size_ml ASC, fp.container_type ASC, fp.name ASC`
  );

  // Compute live max_producible bottles and estimated unit BOM cost for every SKU
  const products = result.rows.map((p) => {
    const limits = [];
    if (p.oil_material_id && Number(p.oil_litres_per_unit) > 0) {
      limits.push({
        key: 'oil',
        max: Math.floor(Number(p.oil_stock_qty || 0) / Number(p.oil_litres_per_unit)),
      });
    }
    if (p.container_material_id && Number(p.containers_per_unit) > 0) {
      limits.push({
        key: 'container',
        max: Math.floor(Number(p.container_stock_qty || 0) / Number(p.containers_per_unit)),
      });
    }
    if (p.sticker_material_id && Number(p.stickers_per_unit) > 0) {
      limits.push({
        key: 'sticker',
        max: Math.floor(Number(p.sticker_stock_qty || 0) / Number(p.stickers_per_unit)),
      });
    }
    if (p.extra_material_id && Number(p.extra_qty_per_unit) > 0) {
      limits.push({
        key: 'extra',
        max: Math.floor(Number(p.extra_stock_qty || 0) / Number(p.extra_qty_per_unit)),
      });
    }

    limits.sort((a, b) => a.max - b.max);
    const maxProducible = limits.length > 0 ? Math.max(0, limits[0].max) : 0;
    const bottleneck = limits.length > 0 ? limits[0].key : null;

    const estBomCost = Number(
      (
        Number(p.oil_litres_per_unit || 0) * Number(p.oil_unit_cost || 0) +
        Number(p.containers_per_unit || 0) * Number(p.container_unit_cost || 0) +
        Number(p.stickers_per_unit || 0) * Number(p.sticker_unit_cost || 0) +
        Number(p.extra_qty_per_unit || 0) * Number(p.extra_unit_cost || 0)
      ).toFixed(2)
    );

    return {
      ...p,
      max_producible: maxProducible,
      bottleneck,
      estimated_bom_cost: estBomCost,
    };
  });

  res.json({ products });
});

router.post('/products', async (req, res) => {
  try {
    const {
      sku,
      external_sku = '',
      name,
      name_ar,
      oil_type = 'extra_virgin',
      container_type = 'glass',
      size_ml = 500,
      oil_material_id = null,
      oil_litres_per_unit,
      container_material_id = null,
      containers_per_unit = 1,
      sticker_material_id = null,
      stickers_per_unit = 1,
      extra_material_id = null,
      extra_qty_per_unit = 0,
      retail_price = 0,
      min_stock = 10,
    } = req.body || {};

    if (!sku?.trim() || !name?.trim()) {
      return res.status(400).json({ error: 'SKU and product name are required' });
    }

    const litresPerUnit =
      oil_litres_per_unit !== undefined && Number(oil_litres_per_unit) > 0
        ? Number(oil_litres_per_unit)
        : Number(size_ml) / 1000;

    const result = await query(
      `INSERT INTO finished_products
        (sku, external_sku, name, name_ar, oil_type, container_type, size_ml,
         oil_material_id, oil_litres_per_unit, container_material_id, containers_per_unit,
         sticker_material_id, stickers_per_unit, extra_material_id, extra_qty_per_unit,
         retail_price, min_stock)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING *`,
      [
        sku.trim().toUpperCase(),
        external_sku?.trim() || sku.trim().toUpperCase(),
        name.trim(),
        name_ar?.trim() || name.trim(),
        oil_type,
        container_type,
        Number(size_ml),
        oil_material_id ? Number(oil_material_id) : null,
        litresPerUnit,
        container_material_id ? Number(container_material_id) : null,
        Number(containers_per_unit) || 1,
        sticker_material_id ? Number(sticker_material_id) : null,
        Number(stickers_per_unit) || 1,
        extra_material_id ? Number(extra_material_id) : null,
        Number(extra_qty_per_unit) || 0,
        Number(retail_price) || 0,
        Number(min_stock) || 10,
      ]
    );
    res.status(201).json({ product: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A finished product with this SKU already exists' });
    }
    console.error('Create finished product error:', err);
    res.status(500).json({ error: 'Failed to create finished product' });
  }
});

router.patch('/products/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, name_ar, external_sku, retail_price, min_stock, active } = req.body || {};
    const result = await query(
      `UPDATE finished_products
       SET name = COALESCE($1, name),
           name_ar = COALESCE($2, name_ar),
           external_sku = COALESCE($3, external_sku),
           retail_price = COALESCE($4, retail_price),
           min_stock = COALESCE($5, min_stock),
           active = COALESCE($6, active),
           updated_at = NOW()
       WHERE id = $7 RETURNING *`,
      [
        name || null,
        name_ar || null,
        external_sku ?? null,
        retail_price !== undefined ? Number(retail_price) : null,
        min_stock !== undefined ? Number(min_stock) : null,
        active !== undefined ? Boolean(active) : null,
        id,
      ]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Product not found' });
    res.json({ product: result.rows[0] });
  } catch (err) {
    console.error('Update product error:', err);
    res.status(500).json({ error: 'Failed to update finished product' });
  }
});

/* ==================== BOTTLING & PACKAGING BATCHES ==================== */
router.get('/batches', async (_req, res) => {
  const result = await query(
    `SELECT b.*,
            fp.sku, fp.name AS product_name, fp.name_ar AS product_name_ar,
            fp.container_type, fp.size_ml, fp.retail_price
     FROM bottling_batches b
     JOIN finished_products fp ON fp.id = b.finished_product_id
     ORDER BY b.batch_date DESC, b.id DESC`
  );
  res.json({ batches: result.rows });
});

router.post('/batches', async (req, res) => {
  try {
    const {
      batch_date,
      finished_product_id,
      quantity_produced,
      spillage_litres = 0,
      batch_hidden_cost = 0,
      harvest_note = '',
      notes = '',
    } = req.body || {};

    const qty = Math.floor(Number(quantity_produced));
    const spillage = Number(spillage_litres) || 0;
    const hiddenCost = Number(batch_hidden_cost) || 0;

    if (!finished_product_id || !(qty > 0) || spillage < 0 || hiddenCost < 0) {
      return res.status(400).json({ error: 'Valid finished SKU and positive quantity are required' });
    }

    const batch = await withTransaction(async (tx) => {
      const fpRes = await tx.query('SELECT * FROM finished_products WHERE id = $1', [
        Number(finished_product_id),
      ]);
      if (fpRes.rows.length === 0) {
        const e = new Error('Finished product SKU not found');
        e.status = 404;
        throw e;
      }
      const fp = fpRes.rows[0];

      const oilBaseNeeded = Number((qty * Number(fp.oil_litres_per_unit || 0)).toFixed(3));
      const totalOilDeducted = Number((oilBaseNeeded + spillage).toFixed(3));
      const containersNeeded = Number((qty * Number(fp.containers_per_unit || 0)).toFixed(3));
      const stickersNeeded = Number((qty * Number(fp.stickers_per_unit || 0)).toFixed(3));
      const extraNeeded = Number((qty * Number(fp.extra_qty_per_unit || 0)).toFixed(3));

      const batchCode = genBatchCode();

      async function consumeMaterial(materialId, requiredQty, label) {
        if (!materialId || !(requiredQty > 0)) return 0;
        const mRes = await tx.query('SELECT * FROM raw_materials WHERE id = $1', [materialId]);
        if (mRes.rows.length === 0) return 0;
        const m = mRes.rows[0];
        const available = Number(m.stock_qty) || 0;
        if (available + 0.0001 < requiredQty) {
          const e = new Error(
            `Insufficient ${label} (${m.name}): need ${requiredQty} ${m.base_unit}, available ${available} ${m.base_unit}`
          );
          e.status = 400;
          throw e;
        }
        const newStock = Number(Math.max(0, available - requiredQty).toFixed(3));
        await tx.query('UPDATE raw_materials SET stock_qty = $1, updated_at = NOW() WHERE id = $2', [
          newStock,
          m.id,
        ]);
        await tx.query(
          `INSERT INTO stock_movements (item_type, item_id, movement_type, qty_delta, unit_cost, reference_no, notes)
           VALUES ('raw', $1, 'bottling_consume', $2, $3, $4, $5)`,
          [m.id, -requiredQty, Number(m.avg_unit_cost), batchCode, `Bottling ${qty}x ${fp.sku}`]
        );
        return Number((requiredQty * Number(m.avg_unit_cost || 0)).toFixed(2));
      }

      const oilCost = await consumeMaterial(fp.oil_material_id, totalOilDeducted, 'Bulk Olive Oil');
      const containerCost = await consumeMaterial(fp.container_material_id, containersNeeded, 'Bottles/Containers');
      const stickerCost = await consumeMaterial(fp.sticker_material_id, stickersNeeded, 'Stickers/Labels');
      const extraCost = await consumeMaterial(fp.extra_material_id, extraNeeded, 'Extra Packaging');

      const totalBatchCost = Number(
        (oilCost + containerCost + stickerCost + extraCost + hiddenCost).toFixed(2)
      );
      const unitCogs = Number((totalBatchCost / qty).toFixed(4));

      const bRes = await tx.query(
        `INSERT INTO bottling_batches
          (batch_code, batch_date, finished_product_id, quantity_produced,
           oil_litres_used, spillage_litres, containers_used, stickers_used, extra_used,
           oil_cost, container_cost, sticker_cost, extra_cost, batch_hidden_cost,
           total_batch_cost, unit_cogs, harvest_note, notes)
         VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         RETURNING *`,
        [
          batchCode,
          batch_date || null,
          fp.id,
          qty,
          oilBaseNeeded,
          spillage,
          containersNeeded,
          stickersNeeded,
          extraNeeded,
          oilCost,
          containerCost,
          stickerCost,
          extraCost,
          hiddenCost,
          totalBatchCost,
          unitCogs,
          harvest_note,
          notes,
        ]
      );

      // Weighted average COGS on finished product
      const curStock = Number(fp.stock_qty) || 0;
      const curCogs = Number(fp.unit_cogs) || 0;
      const newStock = curStock + qty;
      const newUnitCogs =
        newStock > 0
          ? Number(((curStock * curCogs + totalBatchCost) / newStock).toFixed(4))
          : unitCogs;

      await tx.query(
        `UPDATE finished_products
         SET stock_qty = $1, unit_cogs = $2, updated_at = NOW()
         WHERE id = $3`,
        [newStock, newUnitCogs, fp.id]
      );

      await tx.query(
        `INSERT INTO stock_movements (item_type, item_id, movement_type, qty_delta, unit_cost, reference_no, notes)
         VALUES ('finished', $1, 'bottling_produce', $2, $3, $4, $5)`,
        [fp.id, qty, unitCogs, batchCode, `Produced ${qty} units (${fp.sku})`]
      );

      if (hiddenCost > 0) {
        await tx.query(
          `INSERT INTO hidden_costs (cost_date, category, title, title_ar, amount, allocation_scope, related_ref, notes)
           VALUES (COALESCE($1::date, CURRENT_DATE), 'packaging_misc', $2, $3, $4, 'production', $5, $6)`,
          [
            batch_date || null,
            `Bottling batch cost (${fp.sku})`,
            `تكلفة تعبئة وتغليف (${fp.name_ar || fp.name})`,
            hiddenCost,
            batchCode,
            notes || 'Absorbed into finished product unit COGS',
          ]
        );
      }

      return bRes.rows[0];
    });

    res.status(201).json({ batch });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Create bottling batch error:', err);
    res.status(500).json({ error: 'Failed to record bottling batch' });
  }
});

export default router;
