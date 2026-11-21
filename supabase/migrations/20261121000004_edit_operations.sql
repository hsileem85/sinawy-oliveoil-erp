-- ============================================================================
-- Sinawy Olive Oil ERP — Migration 004: Edit Purchases & Edit Bottling Batches
-- Atomically adjusts raw/finished stock, WAC/COGS, and mirrored hidden costs.
-- ============================================================================

-- 1. RPC: Update an existing Purchase (recalculates landed cost, raw stock, WAC & credit due)
CREATE OR REPLACE FUNCTION public.erp_update_purchase(
  p_purchase_id INTEGER,
  p_raw_material_id INTEGER,
  p_purchase_qty NUMERIC,
  p_unit_price NUMERIC,
  p_units_per_purchase NUMERIC DEFAULT NULL,
  p_hidden_cost NUMERIC DEFAULT 0,
  p_supplier_id INTEGER DEFAULT NULL,
  p_purchase_date DATE DEFAULT CURRENT_DATE,
  p_harvest_lot TEXT DEFAULT '',
  p_payment_type TEXT DEFAULT 'cash',
  p_amount_paid NUMERIC DEFAULT NULL,
  p_due_date DATE DEFAULT NULL,
  p_notes TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_old public.purchases%ROWTYPE;
  v_old_mat public.raw_materials%ROWTYPE;
  v_new_mat public.raw_materials%ROWTYPE;
  v_factor NUMERIC(12, 3);
  v_base_qty NUMERIC(12, 3);
  v_subtotal NUMERIC(12, 2);
  v_total_landed NUMERIC(12, 2);
  v_landed_per_base NUMERIC(12, 4);
  v_pay_type TEXT;
  v_paid NUMERIC(12, 2);
  v_pay_status TEXT;
  v_delta_qty NUMERIC(12, 3);
  v_next_qty NUMERIC(12, 3);
  v_next_val NUMERIC(14, 4);
  v_next_avg NUMERIC(12, 4);
  v_updated public.purchases%ROWTYPE;
BEGIN
  IF p_purchase_qty <= 0 OR p_unit_price < 0 OR COALESCE(p_hidden_cost, 0) < 0 THEN
    RAISE EXCEPTION 'Valid quantity (>0), unit price, and non-negative hidden cost are required';
  END IF;

  SELECT * INTO v_old FROM public.purchases WHERE id = p_purchase_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase not found';
  END IF;

  SELECT * INTO v_new_mat FROM public.raw_materials WHERE id = p_raw_material_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Raw material not found';
  END IF;

  v_factor := COALESCE(NULLIF(p_units_per_purchase, 0), v_new_mat.units_per_purchase, 1);
  v_base_qty := ROUND(p_purchase_qty * v_factor, 3);
  v_subtotal := ROUND(p_purchase_qty * p_unit_price, 2);
  v_total_landed := ROUND(v_subtotal + COALESCE(p_hidden_cost, 0), 2);
  v_landed_per_base := ROUND(v_total_landed / v_base_qty, 4);

  v_pay_type := CASE WHEN p_payment_type = 'credit' THEN 'credit' ELSE 'cash' END;
  IF v_pay_type = 'cash' THEN
    v_paid := v_total_landed;
    v_pay_status := 'paid';
  ELSE
    v_paid := LEAST(GREATEST(ROUND(COALESCE(p_amount_paid, v_old.amount_paid, 0), 2), 0), v_total_landed);
    IF v_paid >= v_total_landed THEN
      v_pay_status := 'paid';
    ELSIF v_paid > 0 THEN
      v_pay_status := 'partial';
    ELSE
      v_pay_status := 'unpaid';
    END IF;
  END IF;

  -- Adjust raw_materials stock & weighted average cost
  IF v_old.raw_material_id = p_raw_material_id THEN
    v_delta_qty := ROUND(v_base_qty - v_old.base_qty, 3);
    v_next_qty := GREATEST(0, ROUND(v_new_mat.stock_qty + v_delta_qty, 3));
    v_next_val := GREATEST(0, (v_new_mat.stock_qty * v_new_mat.avg_unit_cost) - v_old.total_landed_cost + v_total_landed);
    v_next_avg := CASE WHEN v_next_qty > 0 THEN ROUND(v_next_val / v_next_qty, 4) ELSE v_landed_per_base END;

    UPDATE public.raw_materials
    SET stock_qty = v_next_qty, avg_unit_cost = v_next_avg, updated_at = NOW()
    WHERE id = v_new_mat.id;

    IF v_delta_qty <> 0 THEN
      INSERT INTO public.stock_movements (item_type, item_id, movement_type, qty_delta, unit_cost, reference_no, notes)
      VALUES ('raw', v_new_mat.id, 'adjustment', v_delta_qty, v_landed_per_base, v_old.reference_no, 'Purchase edited');
    END IF;
  ELSE
    -- Reverse old material
    SELECT * INTO v_old_mat FROM public.raw_materials WHERE id = v_old.raw_material_id FOR UPDATE;
    v_next_qty := GREATEST(0, ROUND(v_old_mat.stock_qty - v_old.base_qty, 3));
    v_next_val := GREATEST(0, (v_old_mat.stock_qty * v_old_mat.avg_unit_cost) - v_old.total_landed_cost);
    v_next_avg := CASE WHEN v_next_qty > 0 THEN ROUND(v_next_val / v_next_qty, 4) ELSE v_old_mat.avg_unit_cost END;
    UPDATE public.raw_materials SET stock_qty = v_next_qty, avg_unit_cost = v_next_avg, updated_at = NOW() WHERE id = v_old_mat.id;
    INSERT INTO public.stock_movements (item_type, item_id, movement_type, qty_delta, unit_cost, reference_no, notes)
    VALUES ('raw', v_old_mat.id, 'adjustment', -v_old.base_qty, v_old.landed_cost_per_base_unit, v_old.reference_no, 'Purchase moved to another material');

    -- Apply to new material
    v_next_qty := ROUND(v_new_mat.stock_qty + v_base_qty, 3);
    v_next_val := (v_new_mat.stock_qty * v_new_mat.avg_unit_cost) + v_total_landed;
    v_next_avg := CASE WHEN v_next_qty > 0 THEN ROUND(v_next_val / v_next_qty, 4) ELSE v_landed_per_base END;
    UPDATE public.raw_materials SET stock_qty = v_next_qty, avg_unit_cost = v_next_avg, updated_at = NOW() WHERE id = v_new_mat.id;
    INSERT INTO public.stock_movements (item_type, item_id, movement_type, qty_delta, unit_cost, reference_no, notes)
    VALUES ('raw', v_new_mat.id, 'purchase', v_base_qty, v_landed_per_base, v_old.reference_no, 'Purchase reassigned');
  END IF;

  UPDATE public.purchases
  SET purchase_date = COALESCE(p_purchase_date, purchase_date),
      supplier_id = p_supplier_id,
      raw_material_id = p_raw_material_id,
      purchase_qty = p_purchase_qty,
      units_per_purchase = v_factor,
      base_qty = v_base_qty,
      unit_price = p_unit_price,
      subtotal = v_subtotal,
      hidden_cost = COALESCE(p_hidden_cost, 0),
      total_landed_cost = v_total_landed,
      landed_cost_per_base_unit = v_landed_per_base,
      harvest_lot = COALESCE(p_harvest_lot, ''),
      payment_type = v_pay_type,
      amount_paid = v_paid,
      due_date = CASE WHEN v_pay_type = 'credit' THEN p_due_date ELSE NULL END,
      payment_status = v_pay_status,
      notes = COALESCE(p_notes, '')
  WHERE id = p_purchase_id
  RETURNING * INTO v_updated;

  -- Sync mirrored purchase hidden cost record
  DELETE FROM public.hidden_costs WHERE allocation_scope = 'purchase' AND related_ref = v_old.reference_no;
  IF COALESCE(p_hidden_cost, 0) > 0 THEN
    INSERT INTO public.hidden_costs (cost_date, category, title, title_ar, amount, allocation_scope, related_ref, notes)
    VALUES (
      COALESCE(p_purchase_date, v_old.purchase_date),
      'shipping_inbound',
      'Purchase landed hidden cost (' || v_new_mat.name || ')',
      'تكلفة خفية للمشتريات (' || COALESCE(v_new_mat.name_ar, v_new_mat.name) || ')',
      p_hidden_cost,
      'purchase',
      v_old.reference_no,
      COALESCE(NULLIF(p_notes, ''), 'Absorbed into raw material landed unit cost')
    );
  END IF;

  RETURN to_jsonb(v_updated);
END;
$$;

-- 2. RPC: Update an existing Bottling & Packaging Batch (adjusts raw stock, finished stock & unit COGS)
CREATE OR REPLACE FUNCTION public.erp_update_bottling_batch(
  p_batch_id INTEGER,
  p_quantity_produced INTEGER,
  p_spillage_litres NUMERIC DEFAULT 0,
  p_batch_hidden_cost NUMERIC DEFAULT 0,
  p_batch_date DATE DEFAULT CURRENT_DATE,
  p_harvest_note TEXT DEFAULT '',
  p_notes TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_old public.bottling_batches%ROWTYPE;
  v_fp public.finished_products%ROWTYPE;
  v_mat public.raw_materials%ROWTYPE;
  v_oil_base NUMERIC(12, 3);
  v_oil_total NUMERIC(12, 3);
  v_cnt_needed NUMERIC(12, 3);
  v_stk_needed NUMERIC(12, 3);
  v_ext_needed NUMERIC(12, 3);
  v_d_oil NUMERIC(12, 3);
  v_d_cnt NUMERIC(12, 3);
  v_d_stk NUMERIC(12, 3);
  v_d_ext NUMERIC(12, 3);
  v_oil_cost NUMERIC(12, 2) := 0;
  v_cnt_cost NUMERIC(12, 2) := 0;
  v_stk_cost NUMERIC(12, 2) := 0;
  v_ext_cost NUMERIC(12, 2) := 0;
  v_total_cost NUMERIC(12, 2);
  v_unit_cogs NUMERIC(12, 4);
  v_d_qty INTEGER;
  v_next_fp_stock INTEGER;
  v_next_fp_val NUMERIC(14, 4);
  v_next_fp_cogs NUMERIC(12, 4);
  v_updated public.bottling_batches%ROWTYPE;
BEGIN
  IF p_quantity_produced <= 0 OR COALESCE(p_spillage_litres, 0) < 0 OR COALESCE(p_batch_hidden_cost, 0) < 0 THEN
    RAISE EXCEPTION 'Positive quantity and non-negative spillage/hidden cost are required';
  END IF;

  SELECT * INTO v_old FROM public.bottling_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bottling batch not found';
  END IF;

  SELECT * INTO v_fp FROM public.finished_products WHERE id = v_old.finished_product_id FOR UPDATE;

  v_d_qty := p_quantity_produced - v_old.quantity_produced;
  IF v_fp.stock_qty + v_d_qty < 0 THEN
    RAISE EXCEPTION 'Cannot reduce batch quantity below already-sold stock (current stock: %, reduction: %)', v_fp.stock_qty, -v_d_qty;
  END IF;

  v_oil_base := ROUND(p_quantity_produced * COALESCE(v_fp.oil_litres_per_unit, 0), 3);
  v_oil_total := ROUND(v_oil_base + COALESCE(p_spillage_litres, 0), 3);
  v_cnt_needed := ROUND(p_quantity_produced * COALESCE(v_fp.containers_per_unit, 0), 3);
  v_stk_needed := ROUND(p_quantity_produced * COALESCE(v_fp.stickers_per_unit, 0), 3);
  v_ext_needed := ROUND(p_quantity_produced * COALESCE(v_fp.extra_qty_per_unit, 0), 3);

  v_d_oil := ROUND(v_oil_total - (v_old.oil_litres_used + v_old.spillage_litres), 3);
  v_d_cnt := ROUND(v_cnt_needed - v_old.containers_used, 3);
  v_d_stk := ROUND(v_stk_needed - v_old.stickers_used, 3);
  v_d_ext := ROUND(v_ext_needed - v_old.extra_used, 3);

  -- Adjust Bulk Oil
  IF v_fp.oil_material_id IS NOT NULL THEN
    SELECT * INTO v_mat FROM public.raw_materials WHERE id = v_fp.oil_material_id FOR UPDATE;
    IF v_d_oil > 0 AND v_mat.stock_qty + 0.0001 < v_d_oil THEN
      RAISE EXCEPTION 'Insufficient Bulk Olive Oil (%): need % more L, available % L', v_mat.name, v_d_oil, v_mat.stock_qty;
    END IF;
    IF v_d_oil <> 0 THEN
      UPDATE public.raw_materials SET stock_qty = GREATEST(0, ROUND(stock_qty - v_d_oil, 3)), updated_at = NOW() WHERE id = v_mat.id;
      INSERT INTO public.stock_movements (item_type, item_id, movement_type, qty_delta, unit_cost, reference_no, notes)
      VALUES ('raw', v_mat.id, 'adjustment', -v_d_oil, v_mat.avg_unit_cost, v_old.batch_code, 'Bottling batch edited');
    END IF;
    v_oil_cost := ROUND(v_oil_total * v_mat.avg_unit_cost, 2);
  END IF;

  -- Adjust Containers
  IF v_fp.container_material_id IS NOT NULL THEN
    SELECT * INTO v_mat FROM public.raw_materials WHERE id = v_fp.container_material_id FOR UPDATE;
    IF v_d_cnt > 0 AND v_mat.stock_qty + 0.0001 < v_d_cnt THEN
      RAISE EXCEPTION 'Insufficient Containers (%): need % more, available %', v_mat.name, v_d_cnt, v_mat.stock_qty;
    END IF;
    IF v_d_cnt <> 0 THEN
      UPDATE public.raw_materials SET stock_qty = GREATEST(0, ROUND(stock_qty - v_d_cnt, 3)), updated_at = NOW() WHERE id = v_mat.id;
      INSERT INTO public.stock_movements (item_type, item_id, movement_type, qty_delta, unit_cost, reference_no, notes)
      VALUES ('raw', v_mat.id, 'adjustment', -v_d_cnt, v_mat.avg_unit_cost, v_old.batch_code, 'Bottling batch edited');
    END IF;
    v_cnt_cost := ROUND(v_cnt_needed * v_mat.avg_unit_cost, 2);
  END IF;

  -- Adjust Stickers
  IF v_fp.sticker_material_id IS NOT NULL THEN
    SELECT * INTO v_mat FROM public.raw_materials WHERE id = v_fp.sticker_material_id FOR UPDATE;
    IF v_d_stk > 0 AND v_mat.stock_qty + 0.0001 < v_d_stk THEN
      RAISE EXCEPTION 'Insufficient Stickers (%): need % more, available %', v_mat.name, v_d_stk, v_mat.stock_qty;
    END IF;
    IF v_d_stk <> 0 THEN
      UPDATE public.raw_materials SET stock_qty = GREATEST(0, ROUND(stock_qty - v_d_stk, 3)), updated_at = NOW() WHERE id = v_mat.id;
      INSERT INTO public.stock_movements (item_type, item_id, movement_type, qty_delta, unit_cost, reference_no, notes)
      VALUES ('raw', v_mat.id, 'adjustment', -v_d_stk, v_mat.avg_unit_cost, v_old.batch_code, 'Bottling batch edited');
    END IF;
    v_stk_cost := ROUND(v_stk_needed * v_mat.avg_unit_cost, 2);
  END IF;

  -- Adjust Extra Packaging
  IF v_fp.extra_material_id IS NOT NULL THEN
    SELECT * INTO v_mat FROM public.raw_materials WHERE id = v_fp.extra_material_id FOR UPDATE;
    IF v_d_ext > 0 AND v_mat.stock_qty + 0.0001 < v_d_ext THEN
      RAISE EXCEPTION 'Insufficient Extra Packaging (%): need % more, available %', v_mat.name, v_d_ext, v_mat.stock_qty;
    END IF;
    IF v_d_ext <> 0 THEN
      UPDATE public.raw_materials SET stock_qty = GREATEST(0, ROUND(stock_qty - v_d_ext, 3)), updated_at = NOW() WHERE id = v_mat.id;
      INSERT INTO public.stock_movements (item_type, item_id, movement_type, qty_delta, unit_cost, reference_no, notes)
      VALUES ('raw', v_mat.id, 'adjustment', -v_d_ext, v_mat.avg_unit_cost, v_old.batch_code, 'Bottling batch edited');
    END IF;
    v_ext_cost := ROUND(v_ext_needed * v_mat.avg_unit_cost, 2);
  END IF;

  v_total_cost := ROUND(v_oil_cost + v_cnt_cost + v_stk_cost + v_ext_cost + COALESCE(p_batch_hidden_cost, 0), 2);
  v_unit_cogs := ROUND(v_total_cost / p_quantity_produced, 4);

  UPDATE public.bottling_batches
  SET batch_date = COALESCE(p_batch_date, batch_date),
      quantity_produced = p_quantity_produced,
      oil_litres_used = v_oil_base,
      spillage_litres = COALESCE(p_spillage_litres, 0),
      containers_used = v_cnt_needed,
      stickers_used = v_stk_needed,
      extra_used = v_ext_needed,
      oil_cost = v_oil_cost,
      container_cost = v_cnt_cost,
      sticker_cost = v_stk_cost,
      extra_cost = v_ext_cost,
      batch_hidden_cost = COALESCE(p_batch_hidden_cost, 0),
      total_batch_cost = v_total_cost,
      unit_cogs = v_unit_cogs,
      harvest_note = COALESCE(p_harvest_note, ''),
      notes = COALESCE(p_notes, '')
  WHERE id = p_batch_id
  RETURNING * INTO v_updated;

  -- Update finished product stock & weighted average COGS
  v_next_fp_stock := GREATEST(0, v_fp.stock_qty + v_d_qty);
  v_next_fp_val := GREATEST(0, (v_fp.stock_qty * v_fp.unit_cogs) - v_old.total_batch_cost + v_total_cost);
  v_next_fp_cogs := CASE WHEN v_next_fp_stock > 0 THEN ROUND(v_next_fp_val / v_next_fp_stock, 4) ELSE v_unit_cogs END;

  UPDATE public.finished_products
  SET stock_qty = v_next_fp_stock, unit_cogs = v_next_fp_cogs, updated_at = NOW()
  WHERE id = v_fp.id;

  IF v_d_qty <> 0 THEN
    INSERT INTO public.stock_movements (item_type, item_id, movement_type, qty_delta, unit_cost, reference_no, notes)
    VALUES ('finished', v_fp.id, 'adjustment', v_d_qty, v_unit_cogs, v_old.batch_code, 'Bottling batch edited');
  END IF;

  -- Sync mirrored production hidden cost record
  DELETE FROM public.hidden_costs WHERE allocation_scope = 'production' AND related_ref = v_old.batch_code;
  IF COALESCE(p_batch_hidden_cost, 0) > 0 THEN
    INSERT INTO public.hidden_costs (cost_date, category, title, title_ar, amount, allocation_scope, related_ref, notes)
    VALUES (
      COALESCE(p_batch_date, v_old.batch_date),
      'packaging_misc',
      'Bottling batch cost (' || v_fp.sku || ')',
      'تكلفة تعبئة وتغليف (' || COALESCE(v_fp.name_ar, v_fp.name) || ')',
      p_batch_hidden_cost,
      'production',
      v_old.batch_code,
      COALESCE(NULLIF(p_notes, ''), 'Absorbed into finished product unit COGS')
    );
  END IF;

  RETURN to_jsonb(v_updated);
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.erp_update_purchase(INTEGER, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, INTEGER, DATE, TEXT, TEXT, NUMERIC, DATE, TEXT) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.erp_update_bottling_batch(INTEGER, INTEGER, NUMERIC, NUMERIC, DATE, TEXT, TEXT) TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.erp_update_purchase(INTEGER, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, INTEGER, DATE, TEXT, TEXT, NUMERIC, DATE, TEXT) TO service_role;
    GRANT EXECUTE ON FUNCTION public.erp_update_bottling_batch(INTEGER, INTEGER, NUMERIC, NUMERIC, DATE, TEXT, TEXT) TO service_role;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
