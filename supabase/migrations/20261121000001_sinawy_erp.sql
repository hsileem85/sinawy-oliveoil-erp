-- ============================================================================
-- Sinawy Olive Oil ERP (sinawy.net) — Supabase PostgreSQL Schema, RLS & RPCs
-- Phases 1 (Purchases), 2 (Bottling & COGS), 3 (Multi-Channel Sales) & API
-- ============================================================================

-- 1. TABLES
CREATE TABLE IF NOT EXISTS public.api_keys (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  key_value TEXT UNIQUE NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.suppliers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  name_ar TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  phone TEXT,
  city TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.raw_materials (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  name_ar TEXT,
  category TEXT NOT NULL CHECK (category IN ('oil', 'container', 'sticker', 'packaging')),
  container_material TEXT DEFAULT 'none' CHECK (container_material IN ('glass', 'tin', 'sachet', 'none')),
  capacity_ml INTEGER,
  base_unit TEXT NOT NULL DEFAULT 'pcs',
  purchase_unit TEXT NOT NULL DEFAULT 'pcs',
  units_per_purchase NUMERIC(12, 3) NOT NULL DEFAULT 1,
  stock_qty NUMERIC(12, 3) NOT NULL DEFAULT 0,
  avg_unit_cost NUMERIC(12, 4) NOT NULL DEFAULT 0,
  min_stock NUMERIC(12, 3) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.purchases (
  id SERIAL PRIMARY KEY,
  reference_no TEXT UNIQUE NOT NULL,
  purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
  supplier_id INTEGER REFERENCES public.suppliers(id) ON DELETE SET NULL,
  raw_material_id INTEGER NOT NULL REFERENCES public.raw_materials(id) ON DELETE RESTRICT,
  purchase_qty NUMERIC(12, 3) NOT NULL,
  units_per_purchase NUMERIC(12, 3) NOT NULL DEFAULT 1,
  base_qty NUMERIC(12, 3) NOT NULL,
  unit_price NUMERIC(12, 2) NOT NULL,
  subtotal NUMERIC(12, 2) NOT NULL,
  hidden_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_landed_cost NUMERIC(12, 2) NOT NULL,
  landed_cost_per_base_unit NUMERIC(12, 4) NOT NULL,
  harvest_lot TEXT,
  payment_status TEXT NOT NULL DEFAULT 'paid' CHECK (payment_status IN ('paid', 'partial', 'unpaid')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.hidden_costs (
  id SERIAL PRIMARY KEY,
  cost_date DATE NOT NULL DEFAULT CURRENT_DATE,
  category TEXT NOT NULL CHECK (category IN (
    'shipping_inbound', 'spillage_waste', 'labor', 'utilities',
    'storage', 'packaging_misc', 'customs_fees', 'other'
  )),
  title TEXT NOT NULL,
  title_ar TEXT,
  amount NUMERIC(12, 2) NOT NULL,
  allocation_scope TEXT NOT NULL DEFAULT 'overhead' CHECK (allocation_scope IN ('overhead', 'purchase', 'production')),
  related_ref TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.finished_products (
  id SERIAL PRIMARY KEY,
  sku TEXT UNIQUE NOT NULL,
  external_sku TEXT,
  name TEXT NOT NULL,
  name_ar TEXT,
  oil_type TEXT NOT NULL DEFAULT 'extra_virgin',
  container_type TEXT NOT NULL DEFAULT 'glass' CHECK (container_type IN ('glass', 'tin', 'sachet', 'box')),
  size_ml INTEGER NOT NULL DEFAULT 500,
  oil_material_id INTEGER REFERENCES public.raw_materials(id) ON DELETE SET NULL,
  oil_litres_per_unit NUMERIC(10, 4) NOT NULL DEFAULT 0.5,
  container_material_id INTEGER REFERENCES public.raw_materials(id) ON DELETE SET NULL,
  containers_per_unit NUMERIC(10, 3) NOT NULL DEFAULT 1,
  sticker_material_id INTEGER REFERENCES public.raw_materials(id) ON DELETE SET NULL,
  stickers_per_unit NUMERIC(10, 3) NOT NULL DEFAULT 1,
  extra_material_id INTEGER REFERENCES public.raw_materials(id) ON DELETE SET NULL,
  extra_qty_per_unit NUMERIC(10, 3) NOT NULL DEFAULT 0,
  stock_qty INTEGER NOT NULL DEFAULT 0,
  unit_cogs NUMERIC(12, 4) NOT NULL DEFAULT 0,
  retail_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 10,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.bottling_batches (
  id SERIAL PRIMARY KEY,
  batch_code TEXT UNIQUE NOT NULL,
  batch_date DATE NOT NULL DEFAULT CURRENT_DATE,
  finished_product_id INTEGER NOT NULL REFERENCES public.finished_products(id) ON DELETE RESTRICT,
  quantity_produced INTEGER NOT NULL,
  oil_litres_used NUMERIC(12, 3) NOT NULL DEFAULT 0,
  spillage_litres NUMERIC(12, 3) NOT NULL DEFAULT 0,
  containers_used NUMERIC(12, 3) NOT NULL DEFAULT 0,
  stickers_used NUMERIC(12, 3) NOT NULL DEFAULT 0,
  extra_used NUMERIC(12, 3) NOT NULL DEFAULT 0,
  oil_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
  container_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
  sticker_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
  extra_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
  batch_hidden_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_batch_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
  unit_cogs NUMERIC(12, 4) NOT NULL DEFAULT 0,
  harvest_note TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sales_orders (
  id SERIAL PRIMARY KEY,
  order_no TEXT UNIQUE NOT NULL,
  external_order_id TEXT UNIQUE,
  order_date DATE NOT NULL DEFAULT CURRENT_DATE,
  channel TEXT NOT NULL CHECK (channel IN ('online_store', 'phone_offline', 'social_ads')),
  social_platform TEXT NOT NULL DEFAULT 'none' CHECK (social_platform IN ('facebook', 'instagram', 'tiktok', 'whatsapp', 'none')),
  campaign_name TEXT,
  customer_name TEXT NOT NULL,
  customer_phone TEXT,
  city TEXT,
  address TEXT,
  payment_method TEXT NOT NULL DEFAULT 'cod' CHECK (payment_method IN ('cod', 'instapay', 'vodafone_cash', 'card', 'bank_transfer', 'cash')),
  payment_status TEXT NOT NULL DEFAULT 'cod_pending' CHECK (payment_status IN ('unpaid', 'paid', 'cod_pending', 'refunded')),
  order_status TEXT NOT NULL DEFAULT 'pending' CHECK (order_status IN ('pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled', 'returned')),
  subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0,
  discount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  shipping_charged NUMERIC(12, 2) NOT NULL DEFAULT 0,
  shipping_actual_cost NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_cogs NUMERIC(12, 2) NOT NULL DEFAULT 0,
  net_profit NUMERIC(12, 2) NOT NULL DEFAULT 0,
  stock_deducted BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sales_order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  finished_product_id INTEGER REFERENCES public.finished_products(id) ON DELETE SET NULL,
  sku_snapshot TEXT NOT NULL,
  product_name_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price NUMERIC(12, 2) NOT NULL,
  unit_cogs NUMERIC(12, 4) NOT NULL DEFAULT 0,
  line_total NUMERIC(12, 2) NOT NULL,
  line_cogs NUMERIC(12, 2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.ad_spend (
  id SERIAL PRIMARY KEY,
  spend_date DATE NOT NULL DEFAULT CURRENT_DATE,
  platform TEXT NOT NULL CHECK (platform IN ('facebook', 'instagram', 'tiktok', 'google', 'other')),
  campaign_name TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.stock_movements (
  id SERIAL PRIMARY KEY,
  item_type TEXT NOT NULL CHECK (item_type IN ('raw', 'finished')),
  item_id INTEGER NOT NULL,
  movement_type TEXT NOT NULL,
  qty_delta NUMERIC(12, 3) NOT NULL,
  unit_cost NUMERIC(12, 4) NOT NULL DEFAULT 0,
  reference_no TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchases_date ON public.purchases(purchase_date DESC);
CREATE INDEX IF NOT EXISTS idx_bottling_date ON public.bottling_batches(batch_date DESC);
CREATE INDEX IF NOT EXISTS idx_orders_date ON public.sales_orders(order_date DESC);
CREATE INDEX IF NOT EXISTS idx_orders_channel ON public.sales_orders(channel);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.sales_orders(order_status);
CREATE INDEX IF NOT EXISTS idx_ad_spend_date ON public.ad_spend(spend_date DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_item ON public.stock_movements(item_type, item_id);

-- Ensure at least one default API key exists for EasyOrders / Stock Sync
INSERT INTO public.api_keys (name, key_value, active)
SELECT 'EasyOrders / sinawy.net Store Sync', 'snw_live_' || substr(md5(random()::text || clock_timestamp()::text), 1, 24), TRUE
WHERE NOT EXISTS (SELECT 1 FROM public.api_keys LIMIT 1);

-- 2. ROW LEVEL SECURITY (authenticated ERP users only; public anon has zero access)
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'api_keys', 'suppliers', 'raw_materials', 'purchases', 'hidden_costs',
    'finished_products', 'bottling_batches', 'sales_orders', 'sales_order_items',
    'ad_spend', 'stock_movements'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('DROP POLICY IF EXISTS "authenticated_all_%I" ON public.%I', tbl, tbl);
      EXECUTE format(
        'CREATE POLICY "authenticated_all_%I" ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
        tbl, tbl
      );
    END IF;
  END LOOP;
END $$;

-- 3. HELPER REFERENCE CODE GENERATOR
CREATE OR REPLACE FUNCTION public.erp_gen_ref(p_prefix TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN p_prefix || '-' || to_char(NOW(), 'YYYYMM') || '-' || lpad((floor(random() * 9000) + 1000)::int::text, 4, '0');
END;
$$;

-- 4. PHASE 1 RPC: RECORD PURCHASE (17L Gallon conversion + Landed Hidden Cost + WAC)
CREATE OR REPLACE FUNCTION public.erp_record_purchase(
  p_raw_material_id INTEGER,
  p_purchase_qty NUMERIC,
  p_unit_price NUMERIC,
  p_units_per_purchase NUMERIC DEFAULT NULL,
  p_hidden_cost NUMERIC DEFAULT 0,
  p_supplier_id INTEGER DEFAULT NULL,
  p_purchase_date DATE DEFAULT CURRENT_DATE,
  p_harvest_lot TEXT DEFAULT '',
  p_payment_status TEXT DEFAULT 'paid',
  p_notes TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_mat public.raw_materials%ROWTYPE;
  v_factor NUMERIC(12, 3);
  v_base_qty NUMERIC(12, 3);
  v_subtotal NUMERIC(12, 2);
  v_total_landed NUMERIC(12, 2);
  v_landed_per_base NUMERIC(12, 4);
  v_new_qty NUMERIC(12, 3);
  v_new_avg NUMERIC(12, 4);
  v_ref TEXT;
  v_purchase public.purchases%ROWTYPE;
BEGIN
  IF p_purchase_qty <= 0 OR p_unit_price < 0 OR COALESCE(p_hidden_cost, 0) < 0 THEN
    RAISE EXCEPTION 'Valid quantity (>0), unit price, and non-negative hidden cost are required';
  END IF;

  SELECT * INTO v_mat FROM public.raw_materials WHERE id = p_raw_material_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Raw material not found';
  END IF;

  v_factor := COALESCE(NULLIF(p_units_per_purchase, 0), v_mat.units_per_purchase, 1);
  v_base_qty := ROUND(p_purchase_qty * v_factor, 3);
  v_subtotal := ROUND(p_purchase_qty * p_unit_price, 2);
  v_total_landed := ROUND(v_subtotal + COALESCE(p_hidden_cost, 0), 2);
  v_landed_per_base := ROUND(v_total_landed / v_base_qty, 4);
  v_ref := public.erp_gen_ref('PO');

  INSERT INTO public.purchases (
    reference_no, purchase_date, supplier_id, raw_material_id, purchase_qty, units_per_purchase,
    base_qty, unit_price, subtotal, hidden_cost, total_landed_cost, landed_cost_per_base_unit,
    harvest_lot, payment_status, notes
  ) VALUES (
    v_ref, COALESCE(p_purchase_date, CURRENT_DATE), p_supplier_id, p_raw_material_id, p_purchase_qty, v_factor,
    v_base_qty, p_unit_price, v_subtotal, COALESCE(p_hidden_cost, 0), v_total_landed, v_landed_per_base,
    COALESCE(p_harvest_lot, ''), COALESCE(p_payment_status, 'paid'), COALESCE(p_notes, '')
  ) RETURNING * INTO v_purchase;

  v_new_qty := ROUND(v_mat.stock_qty + v_base_qty, 3);
  v_new_avg := CASE WHEN v_new_qty > 0
    THEN ROUND(((v_mat.stock_qty * v_mat.avg_unit_cost) + v_total_landed) / v_new_qty, 4)
    ELSE v_landed_per_base END;

  UPDATE public.raw_materials
  SET stock_qty = v_new_qty, avg_unit_cost = v_new_avg, updated_at = NOW()
  WHERE id = v_mat.id;

  INSERT INTO public.stock_movements (item_type, item_id, movement_type, qty_delta, unit_cost, reference_no, notes)
  VALUES ('raw', v_mat.id, 'purchase', v_base_qty, v_landed_per_base, v_ref,
          format('Purchased %s %s (%s %s)', p_purchase_qty, v_mat.purchase_unit, v_base_qty, v_mat.base_unit));

  IF COALESCE(p_hidden_cost, 0) > 0 THEN
    INSERT INTO public.hidden_costs (cost_date, category, title, title_ar, amount, allocation_scope, related_ref, notes)
    VALUES (
      COALESCE(p_purchase_date, CURRENT_DATE),
      'shipping_inbound',
      'Purchase landed hidden cost (' || v_mat.name || ')',
      'تكلفة خفية للمشتريات (' || COALESCE(v_mat.name_ar, v_mat.name) || ')',
      p_hidden_cost,
      'purchase',
      v_ref,
      COALESCE(NULLIF(p_notes, ''), 'Absorbed into raw material landed unit cost')
    );
  END IF;

  RETURN to_jsonb(v_purchase);
END;
$$;

-- 5. PHASE 2 RPC: RUN BOTTLING & PACKAGING BATCH (Atomic Raw Deduction + Unit COGS)
CREATE OR REPLACE FUNCTION public.erp_run_bottling_batch(
  p_finished_product_id INTEGER,
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
  v_fp public.finished_products%ROWTYPE;
  v_mat public.raw_materials%ROWTYPE;
  v_batch_code TEXT;
  v_oil_base NUMERIC(12, 3);
  v_oil_total NUMERIC(12, 3);
  v_cnt_needed NUMERIC(12, 3);
  v_stk_needed NUMERIC(12, 3);
  v_ext_needed NUMERIC(12, 3);
  v_oil_cost NUMERIC(12, 2) := 0;
  v_cnt_cost NUMERIC(12, 2) := 0;
  v_stk_cost NUMERIC(12, 2) := 0;
  v_ext_cost NUMERIC(12, 2) := 0;
  v_total_cost NUMERIC(12, 2);
  v_unit_cogs NUMERIC(12, 4);
  v_new_stock INTEGER;
  v_new_cogs NUMERIC(12, 4);
  v_batch public.bottling_batches%ROWTYPE;
BEGIN
  IF p_quantity_produced <= 0 OR COALESCE(p_spillage_litres, 0) < 0 OR COALESCE(p_batch_hidden_cost, 0) < 0 THEN
    RAISE EXCEPTION 'Positive quantity and non-negative spillage/hidden cost are required';
  END IF;

  SELECT * INTO v_fp FROM public.finished_products WHERE id = p_finished_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Finished product SKU not found';
  END IF;

  v_batch_code := public.erp_gen_ref('BTH');
  v_oil_base := ROUND(p_quantity_produced * COALESCE(v_fp.oil_litres_per_unit, 0), 3);
  v_oil_total := ROUND(v_oil_base + COALESCE(p_spillage_litres, 0), 3);
  v_cnt_needed := ROUND(p_quantity_produced * COALESCE(v_fp.containers_per_unit, 0), 3);
  v_stk_needed := ROUND(p_quantity_produced * COALESCE(v_fp.stickers_per_unit, 0), 3);
  v_ext_needed := ROUND(p_quantity_produced * COALESCE(v_fp.extra_qty_per_unit, 0), 3);

  -- Deduct Bulk Oil
  IF v_fp.oil_material_id IS NOT NULL AND v_oil_total > 0 THEN
    SELECT * INTO v_mat FROM public.raw_materials WHERE id = v_fp.oil_material_id FOR UPDATE;
    IF v_mat.stock_qty + 0.0001 < v_oil_total THEN
      RAISE EXCEPTION 'Insufficient Bulk Olive Oil (%): need % L, available % L', v_mat.name, v_oil_total, v_mat.stock_qty;
    END IF;
    UPDATE public.raw_materials SET stock_qty = GREATEST(0, ROUND(stock_qty - v_oil_total, 3)), updated_at = NOW() WHERE id = v_mat.id;
    INSERT INTO public.stock_movements (item_type, item_id, movement_type, qty_delta, unit_cost, reference_no, notes)
    VALUES ('raw', v_mat.id, 'bottling_consume', -v_oil_total, v_mat.avg_unit_cost, v_batch_code, 'Bottling ' || p_quantity_produced || 'x ' || v_fp.sku);
    v_oil_cost := ROUND(v_oil_total * v_mat.avg_unit_cost, 2);
  END IF;

  -- Deduct Containers
  IF v_fp.container_material_id IS NOT NULL AND v_cnt_needed > 0 THEN
    SELECT * INTO v_mat FROM public.raw_materials WHERE id = v_fp.container_material_id FOR UPDATE;
    IF v_mat.stock_qty + 0.0001 < v_cnt_needed THEN
      RAISE EXCEPTION 'Insufficient Containers (%): need %, available %', v_mat.name, v_cnt_needed, v_mat.stock_qty;
    END IF;
    UPDATE public.raw_materials SET stock_qty = GREATEST(0, ROUND(stock_qty - v_cnt_needed, 3)), updated_at = NOW() WHERE id = v_mat.id;
    INSERT INTO public.stock_movements (item_type, item_id, movement_type, qty_delta, unit_cost, reference_no, notes)
    VALUES ('raw', v_mat.id, 'bottling_consume', -v_cnt_needed, v_mat.avg_unit_cost, v_batch_code, 'Bottling ' || p_quantity_produced || 'x ' || v_fp.sku);
    v_cnt_cost := ROUND(v_cnt_needed * v_mat.avg_unit_cost, 2);
  END IF;

  -- Deduct Stickers
  IF v_fp.sticker_material_id IS NOT NULL AND v_stk_needed > 0 THEN
    SELECT * INTO v_mat FROM public.raw_materials WHERE id = v_fp.sticker_material_id FOR UPDATE;
    IF v_mat.stock_qty + 0.0001 < v_stk_needed THEN
      RAISE EXCEPTION 'Insufficient Stickers (%): need %, available %', v_mat.name, v_stk_needed, v_mat.stock_qty;
    END IF;
    UPDATE public.raw_materials SET stock_qty = GREATEST(0, ROUND(stock_qty - v_stk_needed, 3)), updated_at = NOW() WHERE id = v_mat.id;
    INSERT INTO public.stock_movements (item_type, item_id, movement_type, qty_delta, unit_cost, reference_no, notes)
    VALUES ('raw', v_mat.id, 'bottling_consume', -v_stk_needed, v_mat.avg_unit_cost, v_batch_code, 'Bottling ' || p_quantity_produced || 'x ' || v_fp.sku);
    v_stk_cost := ROUND(v_stk_needed * v_mat.avg_unit_cost, 2);
  END IF;

  -- Deduct Extra Packaging
  IF v_fp.extra_material_id IS NOT NULL AND v_ext_needed > 0 THEN
    SELECT * INTO v_mat FROM public.raw_materials WHERE id = v_fp.extra_material_id FOR UPDATE;
    IF v_mat.stock_qty + 0.0001 < v_ext_needed THEN
      RAISE EXCEPTION 'Insufficient Extra Packaging (%): need %, available %', v_mat.name, v_ext_needed, v_mat.stock_qty;
    END IF;
    UPDATE public.raw_materials SET stock_qty = GREATEST(0, ROUND(stock_qty - v_ext_needed, 3)), updated_at = NOW() WHERE id = v_mat.id;
    INSERT INTO public.stock_movements (item_type, item_id, movement_type, qty_delta, unit_cost, reference_no, notes)
    VALUES ('raw', v_mat.id, 'bottling_consume', -v_ext_needed, v_mat.avg_unit_cost, v_batch_code, 'Bottling ' || p_quantity_produced || 'x ' || v_fp.sku);
    v_ext_cost := ROUND(v_ext_needed * v_mat.avg_unit_cost, 2);
  END IF;

  v_total_cost := ROUND(v_oil_cost + v_cnt_cost + v_stk_cost + v_ext_cost + COALESCE(p_batch_hidden_cost, 0), 2);
  v_unit_cogs := ROUND(v_total_cost / p_quantity_produced, 4);

  INSERT INTO public.bottling_batches (
    batch_code, batch_date, finished_product_id, quantity_produced,
    oil_litres_used, spillage_litres, containers_used, stickers_used, extra_used,
    oil_cost, container_cost, sticker_cost, extra_cost, batch_hidden_cost,
    total_batch_cost, unit_cogs, harvest_note, notes
  ) VALUES (
    v_batch_code, COALESCE(p_batch_date, CURRENT_DATE), v_fp.id, p_quantity_produced,
    v_oil_base, COALESCE(p_spillage_litres, 0), v_cnt_needed, v_stk_needed, v_ext_needed,
    v_oil_cost, v_cnt_cost, v_stk_cost, v_ext_cost, COALESCE(p_batch_hidden_cost, 0),
    v_total_cost, v_unit_cogs, COALESCE(p_harvest_note, ''), COALESCE(p_notes, '')
  ) RETURNING * INTO v_batch;

  v_new_stock := v_fp.stock_qty + p_quantity_produced;
  v_new_cogs := CASE WHEN v_new_stock > 0
    THEN ROUND(((v_fp.stock_qty * v_fp.unit_cogs) + v_total_cost) / v_new_stock, 4)
    ELSE v_unit_cogs END;

  UPDATE public.finished_products
  SET stock_qty = v_new_stock, unit_cogs = v_new_cogs, updated_at = NOW()
  WHERE id = v_fp.id;

  INSERT INTO public.stock_movements (item_type, item_id, movement_type, qty_delta, unit_cost, reference_no, notes)
  VALUES ('finished', v_fp.id, 'bottling_produce', p_quantity_produced, v_unit_cogs, v_batch_code, 'Produced ' || p_quantity_produced || ' units (' || v_fp.sku || ')');

  IF COALESCE(p_batch_hidden_cost, 0) > 0 THEN
    INSERT INTO public.hidden_costs (cost_date, category, title, title_ar, amount, allocation_scope, related_ref, notes)
    VALUES (
      COALESCE(p_batch_date, CURRENT_DATE),
      'packaging_misc',
      'Bottling batch cost (' || v_fp.sku || ')',
      'تكلفة تعبئة وتغليف (' || COALESCE(v_fp.name_ar, v_fp.name) || ')',
      p_batch_hidden_cost,
      'production',
      v_batch_code,
      COALESCE(NULLIF(p_notes, ''), 'Absorbed into finished product unit COGS')
    );
  END IF;

  RETURN to_jsonb(v_batch);
END;
$$;

-- 6. PHASE 3 RPC: CREATE SALES ORDER (Multi-channel + Idempotent EasyOrders + Stock Deduction)
CREATE OR REPLACE FUNCTION public.erp_create_sales_order(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_ext_id TEXT := NULLIF(trim(COALESCE(p_payload->>'external_order_id', '')), '');
  v_existing public.sales_orders%ROWTYPE;
  v_order_no TEXT;
  v_order_status TEXT := COALESCE(p_payload->>'order_status', 'confirmed');
  v_channel TEXT := COALESCE(p_payload->>'channel', 'phone_offline');
  v_deduct BOOLEAN := v_order_status NOT IN ('cancelled', 'returned');
  v_allow_neg BOOLEAN := COALESCE((p_payload->>'allow_negative_stock')::boolean, FALSE);
  v_item JSONB;
  v_fp public.finished_products%ROWTYPE;
  v_qty INTEGER;
  v_price NUMERIC(12, 2);
  v_subtotal NUMERIC(12, 2) := 0;
  v_total_cogs NUMERIC(12, 2) := 0;
  v_discount NUMERIC(12, 2) := COALESCE((p_payload->>'discount')::numeric, 0);
  v_ship_charged NUMERIC(12, 2) := COALESCE((p_payload->>'shipping_charged')::numeric, 0);
  v_ship_actual NUMERIC(12, 2) := COALESCE((p_payload->>'shipping_actual_cost')::numeric, 0);
  v_total_amount NUMERIC(12, 2);
  v_net_profit NUMERIC(12, 2);
  v_order public.sales_orders%ROWTYPE;
BEGIN
  IF v_ext_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.sales_orders WHERE external_order_id = v_ext_id;
    IF FOUND THEN
      RETURN jsonb_build_object('duplicate', true, 'order', to_jsonb(v_existing));
    END IF;
  END IF;

  IF NULLIF(trim(COALESCE(p_payload->>'customer_name', '')), '') IS NULL
     OR jsonb_typeof(p_payload->'items') <> 'array'
     OR jsonb_array_length(p_payload->'items') = 0 THEN
    RAISE EXCEPTION 'Customer name and at least one order item are required';
  END IF;

  v_order_no := public.erp_gen_ref('ORD');

  -- Insert order shell first, then compute exact totals from line items
  INSERT INTO public.sales_orders (
    order_no, external_order_id, order_date, channel, social_platform, campaign_name,
    customer_name, customer_phone, city, address, payment_method, payment_status, order_status,
    discount, shipping_charged, shipping_actual_cost, stock_deducted, notes, raw_payload
  ) VALUES (
    v_order_no,
    v_ext_id,
    COALESCE((p_payload->>'order_date')::date, CURRENT_DATE),
    v_channel,
    CASE WHEN v_channel = 'social_ads' THEN COALESCE(NULLIF(p_payload->>'social_platform', ''), 'facebook') ELSE COALESCE(NULLIF(p_payload->>'social_platform', ''), 'none') END,
    COALESCE(p_payload->>'campaign_name', ''),
    trim(p_payload->>'customer_name'),
    COALESCE(p_payload->>'customer_phone', ''),
    COALESCE(p_payload->>'city', ''),
    COALESCE(p_payload->>'address', ''),
    COALESCE(p_payload->>'payment_method', 'cod'),
    COALESCE(p_payload->>'payment_status', 'cod_pending'),
    v_order_status,
    v_discount,
    v_ship_charged,
    v_ship_actual,
    v_deduct,
    COALESCE(p_payload->>'notes', ''),
    p_payload->'raw_payload'
  ) RETURNING * INTO v_order;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items')
  LOOP
    v_qty := COALESCE((v_item->>'quantity')::int, 0);
    IF v_qty <= 0 THEN CONTINUE; END IF;

    IF v_item ? 'finished_product_id' AND NULLIF(v_item->>'finished_product_id', '') IS NOT NULL THEN
      SELECT * INTO v_fp FROM public.finished_products WHERE id = (v_item->>'finished_product_id')::int FOR UPDATE;
    ELSIF v_item ? 'sku' AND NULLIF(v_item->>'sku', '') IS NOT NULL THEN
      SELECT * INTO v_fp FROM public.finished_products
      WHERE UPPER(sku) = UPPER(trim(v_item->>'sku')) OR UPPER(external_sku) = UPPER(trim(v_item->>'sku'))
      LIMIT 1 FOR UPDATE;
    ELSE
      v_fp := NULL;
    END IF;

    IF v_fp.id IS NULL THEN
      RAISE EXCEPTION 'Product not found for item: %', COALESCE(v_item->>'sku', v_item->>'finished_product_id');
    END IF;

    IF v_deduct AND NOT v_allow_neg AND v_fp.stock_qty < v_qty THEN
      RAISE EXCEPTION 'Insufficient finished stock for % (%): requested %, available %', v_fp.name, v_fp.sku, v_qty, v_fp.stock_qty;
    END IF;

    v_price := COALESCE(NULLIF(v_item->>'unit_price', '')::numeric, v_fp.retail_price);

    INSERT INTO public.sales_order_items (
      order_id, finished_product_id, sku_snapshot, product_name_snapshot,
      quantity, unit_price, unit_cogs, line_total, line_cogs
    ) VALUES (
      v_order.id, v_fp.id, v_fp.sku, v_fp.name,
      v_qty, v_price, v_fp.unit_cogs, ROUND(v_qty * v_price, 2), ROUND(v_qty * v_fp.unit_cogs, 2)
    );

    v_subtotal := v_subtotal + ROUND(v_qty * v_price, 2);
    v_total_cogs := v_total_cogs + ROUND(v_qty * v_fp.unit_cogs, 2);

    IF v_deduct THEN
      UPDATE public.finished_products SET stock_qty = stock_qty - v_qty, updated_at = NOW() WHERE id = v_fp.id;
      INSERT INTO public.stock_movements (item_type, item_id, movement_type, qty_delta, unit_cost, reference_no, notes)
      VALUES ('finished', v_fp.id, 'sale', -v_qty, v_fp.unit_cogs, v_order_no, 'Sold via ' || v_channel);
    END IF;
  END LOOP;

  v_total_amount := ROUND(v_subtotal - v_discount + v_ship_charged, 2);
  v_net_profit := ROUND((v_subtotal - v_discount) - v_total_cogs + (v_ship_charged - v_ship_actual), 2);

  UPDATE public.sales_orders
  SET subtotal = v_subtotal,
      total_amount = v_total_amount,
      total_cogs = v_total_cogs,
      net_profit = v_net_profit,
      updated_at = NOW()
  WHERE id = v_order.id
  RETURNING * INTO v_order;

  RETURN jsonb_build_object('duplicate', false, 'order', to_jsonb(v_order));
END;
$$;

-- 7. PHASE 3 RPC: UPDATE ORDER STATUS (Auto-restores stock on cancel/return)
CREATE OR REPLACE FUNCTION public.erp_update_order_status(
  p_order_id INTEGER,
  p_order_status TEXT DEFAULT NULL,
  p_payment_status TEXT DEFAULT NULL,
  p_shipping_actual_cost NUMERIC DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_cur public.sales_orders%ROWTYPE;
  v_next_status TEXT;
  v_next_pay TEXT;
  v_next_ship NUMERIC(12, 2);
  v_should_deduct BOOLEAN;
  v_deducted BOOLEAN;
  v_item RECORD;
  v_fp public.finished_products%ROWTYPE;
  v_profit NUMERIC(12, 2);
  v_updated public.sales_orders%ROWTYPE;
BEGIN
  SELECT * INTO v_cur FROM public.sales_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  v_next_status := COALESCE(p_order_status, v_cur.order_status);
  v_next_pay := COALESCE(p_payment_status, CASE WHEN v_next_status = 'delivered' THEN 'paid' ELSE v_cur.payment_status END);
  v_next_ship := COALESCE(p_shipping_actual_cost, v_cur.shipping_actual_cost);
  v_should_deduct := v_next_status NOT IN ('cancelled', 'returned');
  v_deducted := v_cur.stock_deducted;

  IF v_cur.stock_deducted AND NOT v_should_deduct THEN
    FOR v_item IN SELECT * FROM public.sales_order_items WHERE order_id = p_order_id LOOP
      IF v_item.finished_product_id IS NOT NULL THEN
        UPDATE public.finished_products SET stock_qty = stock_qty + v_item.quantity, updated_at = NOW() WHERE id = v_item.finished_product_id;
        INSERT INTO public.stock_movements (item_type, item_id, movement_type, qty_delta, unit_cost, reference_no, notes)
        VALUES ('finished', v_item.finished_product_id, 'sale_return', v_item.quantity, v_item.unit_cogs, v_cur.order_no, 'Restored (' || v_next_status || ')');
      END IF;
    END LOOP;
    v_deducted := FALSE;
  ELSIF NOT v_cur.stock_deducted AND v_should_deduct THEN
    FOR v_item IN SELECT * FROM public.sales_order_items WHERE order_id = p_order_id LOOP
      IF v_item.finished_product_id IS NOT NULL THEN
        SELECT * INTO v_fp FROM public.finished_products WHERE id = v_item.finished_product_id FOR UPDATE;
        IF v_fp.stock_qty < v_item.quantity THEN
          RAISE EXCEPTION 'Insufficient stock to reactivate order for %', v_fp.name;
        END IF;
        UPDATE public.finished_products SET stock_qty = stock_qty - v_item.quantity, updated_at = NOW() WHERE id = v_item.finished_product_id;
        INSERT INTO public.stock_movements (item_type, item_id, movement_type, qty_delta, unit_cost, reference_no, notes)
        VALUES ('finished', v_item.finished_product_id, 'sale', -v_item.quantity, v_item.unit_cogs, v_cur.order_no, 'Order reactivated');
      END IF;
    END LOOP;
    v_deducted := TRUE;
  END IF;

  v_profit := ROUND((v_cur.subtotal - v_cur.discount) - v_cur.total_cogs + (v_cur.shipping_charged - v_next_ship), 2);

  UPDATE public.sales_orders
  SET order_status = v_next_status,
      payment_status = v_next_pay,
      shipping_actual_cost = v_next_ship,
      net_profit = v_profit,
      stock_deducted = v_deducted,
      notes = COALESCE(p_notes, notes),
      updated_at = NOW()
  WHERE id = p_order_id
  RETURNING * INTO v_updated;

  RETURN to_jsonb(v_updated);
END;
$$;

-- 8. DASHBOARD SUMMARY RPC (Executive P&L, Channels, ROAS, Oil Tanks, Low Stock)
CREATE OR REPLACE FUNCTION public.erp_get_dashboard_summary()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_total_orders INTEGER := 0;
  v_active_orders INTEGER := 0;
  v_delivered_orders INTEGER := 0;
  v_net_sales NUMERIC(12, 2) := 0;
  v_total_cogs NUMERIC(12, 2) := 0;
  v_ship_margin NUMERIC(12, 2) := 0;
  v_cod_pending NUMERIC(12, 2) := 0;
  v_ad_spend NUMERIC(12, 2) := 0;
  v_overhead NUMERIC(12, 2) := 0;
  v_hidden_all NUMERIC(12, 2) := 0;
  v_total_purchases NUMERIC(12, 2) := 0;
  v_gross_profit NUMERIC(12, 2);
  v_true_net NUMERIC(12, 2);
  v_gross_pct NUMERIC(6, 1);
  v_net_pct NUMERIC(6, 1);
  v_social_rev NUMERIC(12, 2) := 0;
  v_social_cnt INTEGER := 0;
  v_roas NUMERIC(10, 2) := 0;
  v_cpa NUMERIC(10, 2) := 0;
  v_channels JSONB;
  v_oil_litres NUMERIC(12, 2) := 0;
  v_raw_val NUMERIC(12, 2) := 0;
  v_fin_cnt INTEGER := 0;
  v_fin_cost NUMERIC(12, 2) := 0;
  v_fin_retail NUMERIC(12, 2) := 0;
  v_oil_tanks JSONB;
  v_fin_skus JSONB;
  v_low_stock JSONB;
  v_recent_batches JSONB;
  v_recent_orders JSONB;
BEGIN
  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE order_status NOT IN ('cancelled', 'returned'))::int,
    COUNT(*) FILTER (WHERE order_status = 'delivered')::int,
    COALESCE(SUM(subtotal - discount) FILTER (WHERE order_status NOT IN ('cancelled', 'returned')), 0),
    COALESCE(SUM(total_cogs) FILTER (WHERE order_status NOT IN ('cancelled', 'returned')), 0),
    COALESCE(SUM(shipping_charged - shipping_actual_cost) FILTER (WHERE order_status NOT IN ('cancelled', 'returned')), 0),
    COALESCE(SUM(total_amount) FILTER (WHERE payment_status = 'cod_pending' AND order_status NOT IN ('cancelled', 'returned')), 0)
  INTO v_total_orders, v_active_orders, v_delivered_orders, v_net_sales, v_total_cogs, v_ship_margin, v_cod_pending
  FROM public.sales_orders;

  SELECT COALESCE(SUM(amount), 0) INTO v_ad_spend FROM public.ad_spend;
  SELECT COALESCE(SUM(amount), 0) INTO v_overhead FROM public.hidden_costs WHERE allocation_scope = 'overhead';
  SELECT COALESCE(SUM(amount), 0) INTO v_hidden_all FROM public.hidden_costs;
  SELECT COALESCE(SUM(total_landed_cost), 0) INTO v_total_purchases FROM public.purchases;

  v_gross_profit := ROUND(v_net_sales - v_total_cogs, 2);
  v_true_net := ROUND(v_gross_profit + v_ship_margin - v_ad_spend - v_overhead, 2);
  v_gross_pct := CASE WHEN v_net_sales > 0 THEN ROUND((v_gross_profit / v_net_sales) * 100, 1) ELSE 0 END;
  v_net_pct := CASE WHEN v_net_sales > 0 THEN ROUND((v_true_net / v_net_sales) * 100, 1) ELSE 0 END;

  SELECT jsonb_agg(row_data) INTO v_channels FROM (
    SELECT jsonb_build_object(
      'channel', ch.channel,
      'order_count', COALESCE(COUNT(o.id) FILTER (WHERE o.order_status NOT IN ('cancelled', 'returned')), 0),
      'revenue', COALESCE(SUM(o.subtotal - o.discount) FILTER (WHERE o.order_status NOT IN ('cancelled', 'returned')), 0),
      'profit', COALESCE(SUM(o.net_profit) FILTER (WHERE o.order_status NOT IN ('cancelled', 'returned')), 0)
    ) AS row_data
    FROM (VALUES ('online_store'), ('phone_offline'), ('social_ads')) AS ch(channel)
    LEFT JOIN public.sales_orders o ON o.channel = ch.channel
    GROUP BY ch.channel
  ) t;

  SELECT
    COALESCE(SUM(subtotal - discount), 0),
    COUNT(*)::int
  INTO v_social_rev, v_social_cnt
  FROM public.sales_orders
  WHERE channel = 'social_ads' AND order_status NOT IN ('cancelled', 'returned');

  v_roas := CASE WHEN v_ad_spend > 0 THEN ROUND(v_social_rev / v_ad_spend, 2) ELSE 0 END;
  v_cpa := CASE WHEN v_social_cnt > 0 AND v_ad_spend > 0 THEN ROUND(v_ad_spend / v_social_cnt, 2) ELSE 0 END;

  SELECT COALESCE(SUM(stock_qty), 0) INTO v_oil_litres FROM public.raw_materials WHERE category = 'oil';
  SELECT COALESCE(ROUND(SUM(stock_qty * avg_unit_cost), 2), 0) INTO v_raw_val FROM public.raw_materials;
  SELECT
    COALESCE(SUM(stock_qty), 0)::int,
    COALESCE(ROUND(SUM(stock_qty * unit_cogs), 2), 0),
    COALESCE(ROUND(SUM(stock_qty * retail_price), 2), 0)
  INTO v_fin_cnt, v_fin_cost, v_fin_retail
  FROM public.finished_products WHERE active = TRUE;

  SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO v_oil_tanks
  FROM (SELECT id, code, name, name_ar, stock_qty, avg_unit_cost, units_per_purchase, min_stock FROM public.raw_materials WHERE category = 'oil' ORDER BY id ASC) r;

  SELECT COALESCE(jsonb_agg(to_jsonb(p)), '[]'::jsonb) INTO v_fin_skus
  FROM (SELECT id, sku, external_sku, name, name_ar, container_type, size_ml, stock_qty, unit_cogs, retail_price, min_stock FROM public.finished_products WHERE active = TRUE ORDER BY stock_qty DESC) p;

  SELECT COALESCE(jsonb_agg(al), '[]'::jsonb) INTO v_low_stock FROM (
    SELECT jsonb_build_object('type', 'raw', 'code', code, 'name', name, 'name_ar', name_ar, 'stock_qty', stock_qty, 'min_stock', min_stock, 'unit', base_unit) AS al
    FROM public.raw_materials WHERE stock_qty <= min_stock
    UNION ALL
    SELECT jsonb_build_object('type', 'finished', 'code', sku, 'name', name, 'name_ar', name_ar, 'stock_qty', stock_qty, 'min_stock', min_stock, 'unit', 'pcs') AS al
    FROM public.finished_products WHERE active = TRUE AND stock_qty <= min_stock
  ) a;

  SELECT COALESCE(jsonb_agg(to_jsonb(b)), '[]'::jsonb) INTO v_recent_batches FROM (
    SELECT b.id, b.batch_code, b.batch_date, b.quantity_produced, b.unit_cogs, b.total_batch_cost,
           fp.name AS product_name, fp.name_ar AS product_name_ar, fp.sku
    FROM public.bottling_batches b
    JOIN public.finished_products fp ON fp.id = b.finished_product_id
    ORDER BY b.batch_date DESC, b.id DESC LIMIT 5
  ) b;

  SELECT COALESCE(jsonb_agg(to_jsonb(o)), '[]'::jsonb) INTO v_recent_orders FROM (
    SELECT id, order_no, order_date, channel, social_platform, customer_name, total_amount, net_profit, order_status
    FROM public.sales_orders
    ORDER BY order_date DESC, id DESC LIMIT 6
  ) o;

  RETURN jsonb_build_object(
    'db_mode', 'supabase',
    'pnl', jsonb_build_object(
      'net_sales_revenue', v_net_sales,
      'total_cogs', v_total_cogs,
      'gross_profit', v_gross_profit,
      'gross_margin_pct', v_gross_pct,
      'net_shipping_margin', v_ship_margin,
      'total_ad_spend', v_ad_spend,
      'unallocated_hidden_costs', v_overhead,
      'total_hidden_tracked', v_hidden_all,
      'true_net_profit', v_true_net,
      'net_margin_pct', v_net_pct,
      'cod_pending_amount', v_cod_pending,
      'total_purchases', v_total_purchases
    ),
    'orders_kpi', jsonb_build_object(
      'total_orders', v_total_orders,
      'active_orders', v_active_orders,
      'delivered_orders', v_delivered_orders
    ),
    'channels', COALESCE(v_channels, '[]'::jsonb),
    'marketing', jsonb_build_object(
      'total_ad_spend', v_ad_spend,
      'social_revenue', v_social_rev,
      'social_orders', v_social_cnt,
      'roas', v_roas,
      'cpa', v_cpa
    ),
    'inventory', jsonb_build_object(
      'total_oil_litres', ROUND(v_oil_litres, 2),
      'total_oil_gallons_17l', ROUND(v_oil_litres / 17.0, 2),
      'raw_inventory_value', v_raw_val,
      'finished_stock_count', v_fin_cnt,
      'finished_inventory_cost_value', v_fin_cost,
      'finished_inventory_retail_value', v_fin_retail,
      'oil_tanks', v_oil_tanks,
      'finished_skus', v_fin_skus
    ),
    'low_stock_alerts', v_low_stock,
    'recent_batches', v_recent_batches,
    'recent_orders', v_recent_orders
  );
END;
$$;

-- 9. OPTIONAL STARTER SEED RPC (1-Click Starter Catalog & Sample Data for Sinawy)
CREATE OR REPLACE FUNCTION public.erp_seed_demo_data()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_cnt INTEGER;
  v_sup_oil INTEGER;
  v_sup_btl INTEGER;
  v_sup_stk INTEGER;
  v_m_evoo INTEGER;
  v_m_voo INTEGER;
  v_m_g500 INTEGER;
  v_m_g250 INTEGER;
  v_m_t1000 INTEGER;
  v_m_t2000 INTEGER;
  v_m_stk INTEGER;
  v_m_box INTEGER;
  v_fp_500g INTEGER;
  v_fp_1000t INTEGER;
  v_fp_250g INTEGER;
  v_fp_v1000t INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_cnt FROM public.raw_materials;
  IF v_cnt > 0 THEN
    RETURN jsonb_build_object('seeded', false, 'message', 'Database already contains materials');
  END IF;

  INSERT INTO public.suppliers (name, name_ar, category, phone, city, notes)
  VALUES ('Al-Arish Cold-Press Mill', 'معصرة العريش للزيتون', 'oil', '01001122334', 'El-Arish, North Sinai', 'Single-origin cold-pressed Sinai olive oil in 17L gallons')
  RETURNING id INTO v_sup_oil;

  INSERT INTO public.suppliers (name, name_ar, category, phone, city, notes)
  VALUES ('El-Obour Glass & Tin Co.', 'العبور لعبوات الزجاج والصفيح', 'bottles', '01122334455', 'El-Obour, Cairo', 'Dark UV glass bottles & food-grade gold tins')
  RETURNING id INTO v_sup_btl;

  INSERT INTO public.suppliers (name, name_ar, category, phone, city, notes)
  VALUES ('Delta Label & Print', 'دلتا لطباعة الاستيكر والتغليف', 'stickers', '01233445566', '10th of Ramadan', 'Waterproof oil-resistant labels & corrugated boxes')
  RETURNING id INTO v_sup_stk;

  INSERT INTO public.raw_materials (code, name, name_ar, category, container_material, capacity_ml, base_unit, purchase_unit, units_per_purchase, min_stock)
  VALUES ('OIL-EVOO', 'Sinai Extra Virgin Olive Oil (Bulk)', 'زيت زيتون بكر ممتاز سيناوي (جملة)', 'oil', 'none', NULL, 'litre', 'gallon_17l', 17, 34)
  RETURNING id INTO v_m_evoo;

  INSERT INTO public.raw_materials (code, name, name_ar, category, container_material, capacity_ml, base_unit, purchase_unit, units_per_purchase, min_stock)
  VALUES ('OIL-VOO', 'Sinai Virgin Olive Oil (Bulk)', 'زيت زيتون بكر سيناوي (جملة)', 'oil', 'none', NULL, 'litre', 'gallon_17l', 17, 17)
  RETURNING id INTO v_m_voo;

  INSERT INTO public.raw_materials (code, name, name_ar, category, container_material, capacity_ml, base_unit, purchase_unit, units_per_purchase, min_stock)
  VALUES ('BTL-GLS-500', '500ml Dark Glass Bottle + Cap', 'زجاجة زجاج داكن ٥٠٠ مل بالغطاء', 'container', 'glass', 500, 'pcs', 'pcs', 1, 40)
  RETURNING id INTO v_m_g500;

  INSERT INTO public.raw_materials (code, name, name_ar, category, container_material, capacity_ml, base_unit, purchase_unit, units_per_purchase, min_stock)
  VALUES ('BTL-GLS-250', '250ml Dark Glass Bottle + Cap', 'زجاجة زجاج داكن ٢٥٠ مل بالغطاء', 'container', 'glass', 250, 'pcs', 'pcs', 1, 40)
  RETURNING id INTO v_m_g250;

  INSERT INTO public.raw_materials (code, name, name_ar, category, container_material, capacity_ml, base_unit, purchase_unit, units_per_purchase, min_stock)
  VALUES ('BTL-TIN-1000', '1L Gold Metal Tin + Pour Spout', 'عبوة صفيح ذهبي ١ لتر', 'container', 'tin', 1000, 'pcs', 'pcs', 1, 30)
  RETURNING id INTO v_m_t1000;

  INSERT INTO public.raw_materials (code, name, name_ar, category, container_material, capacity_ml, base_unit, purchase_unit, units_per_purchase, min_stock)
  VALUES ('BTL-TIN-2000', '2L Family Metal Tin', 'عبوة صفيح عائلي ٢ لتر', 'container', 'tin', 2000, 'pcs', 'pcs', 1, 15)
  RETURNING id INTO v_m_t2000;

  INSERT INTO public.raw_materials (code, name, name_ar, category, container_material, capacity_ml, base_unit, purchase_unit, units_per_purchase, min_stock)
  VALUES ('STK-SINAWY', 'Sinawy Waterproof Label Sticker', 'استيكر سيناوي مقاوم للزيت', 'sticker', 'none', NULL, 'pcs', 'pcs', 1, 100)
  RETURNING id INTO v_m_stk;

  INSERT INTO public.raw_materials (code, name, name_ar, category, container_material, capacity_ml, base_unit, purchase_unit, units_per_purchase, min_stock)
  VALUES ('PKG-BOX', 'Protective Shipping Box & Neck Seal', 'كرتونة شحن مبطنة + سيل أمان', 'packaging', 'none', NULL, 'pcs', 'pcs', 1, 50)
  RETURNING id INTO v_m_box;

  PERFORM public.erp_record_purchase(v_m_evoo, 6, 5100, 17, 1020, v_sup_oil, CURRENT_DATE - 12, 'Sinai Harvest #A1', 'paid', '6 Gallons (102L) Extra Virgin + freight');
  PERFORM public.erp_record_purchase(v_m_voo, 3, 4250, 17, 510, v_sup_oil, CURRENT_DATE - 11, 'Sinai Harvest #B1', 'paid', '3 Gallons (51L) Virgin + freight');
  PERFORM public.erp_record_purchase(v_m_g500, 160, 24, 1, 240, v_sup_btl, CURRENT_DATE - 10, 'GLS-500', 'paid', '500ml UV dark glass');
  PERFORM public.erp_record_purchase(v_m_g250, 120, 18, 1, 180, v_sup_btl, CURRENT_DATE - 10, 'GLS-250', 'paid', '250ml UV dark glass');
  PERFORM public.erp_record_purchase(v_m_t1000, 90, 38, 1, 270, v_sup_btl, CURRENT_DATE - 9, 'TIN-1L', 'paid', '1L gold tins');
  PERFORM public.erp_record_purchase(v_m_t2000, 12, 54, 1, 60, v_sup_btl, CURRENT_DATE - 9, 'TIN-2L', 'paid', '2L family tins');
  PERFORM public.erp_record_purchase(v_m_stk, 500, 3.5, 1, 150, v_sup_stk, CURRENT_DATE - 8, 'STK-1', 'paid', 'Waterproof bilingual stickers');
  PERFORM public.erp_record_purchase(v_m_box, 240, 14, 1, 160, v_sup_stk, CURRENT_DATE - 8, 'BOX-1', 'paid', 'Protective boxes & neck seals');

  INSERT INTO public.hidden_costs (cost_date, category, title, title_ar, amount, allocation_scope, related_ref, notes) VALUES
    (CURRENT_DATE - 7, 'other', 'Olive Oil Lab Acidity Certificate', 'شهادة تحليل الحموضة بالمعمل', 650, 'overhead', 'LAB-01', 'Verified 0.48% acidity'),
    (CURRENT_DATE - 5, 'utilities', 'Bottling Room Utilities & Sanitation', 'كهرباء وتعقيم غرفة التعبئة', 850, 'overhead', 'UTIL-01', 'Monthly workspace overhead');

  INSERT INTO public.finished_products (sku, external_sku, name, name_ar, oil_type, container_type, size_ml, oil_material_id, oil_litres_per_unit, container_material_id, containers_per_unit, sticker_material_id, stickers_per_unit, extra_material_id, extra_qty_per_unit, retail_price, min_stock)
  VALUES ('SNW-EVOO-500G', 'SNW-EVOO-500G', 'Sinawy EVOO 500ml Dark Glass', 'سيناوي بكر ممتاز ٥٠٠ مل زجاج', 'extra_virgin', 'glass', 500, v_m_evoo, 0.5, v_m_g500, 1, v_m_stk, 2, v_m_box, 1, 390, 15)
  RETURNING id INTO v_fp_500g;

  INSERT INTO public.finished_products (sku, external_sku, name, name_ar, oil_type, container_type, size_ml, oil_material_id, oil_litres_per_unit, container_material_id, containers_per_unit, sticker_material_id, stickers_per_unit, extra_material_id, extra_qty_per_unit, retail_price, min_stock)
  VALUES ('SNW-EVOO-1000T', 'SNW-EVOO-1000T', 'Sinawy EVOO 1L Gold Tin', 'سيناوي بكر ممتاز ١ لتر صفيح', 'extra_virgin', 'tin', 1000, v_m_evoo, 1.0, v_m_t1000, 1, v_m_stk, 1, v_m_box, 1, 710, 12)
  RETURNING id INTO v_fp_1000t;

  INSERT INTO public.finished_products (sku, external_sku, name, name_ar, oil_type, container_type, size_ml, oil_material_id, oil_litres_per_unit, container_material_id, containers_per_unit, sticker_material_id, stickers_per_unit, extra_material_id, extra_qty_per_unit, retail_price, min_stock)
  VALUES ('SNW-EVOO-250G', 'SNW-EVOO-250G', 'Sinawy EVOO 250ml Dark Glass', 'سيناوي بكر ممتاز ٢٥٠ مل زجاج', 'extra_virgin', 'glass', 250, v_m_evoo, 0.25, v_m_g250, 1, v_m_stk, 1, v_m_box, 1, 220, 15)
  RETURNING id INTO v_fp_250g;

  INSERT INTO public.finished_products (sku, external_sku, name, name_ar, oil_type, container_type, size_ml, oil_material_id, oil_litres_per_unit, container_material_id, containers_per_unit, sticker_material_id, stickers_per_unit, extra_material_id, extra_qty_per_unit, retail_price, min_stock)
  VALUES ('SNW-VOO-1000T', 'SNW-VOO-1000T', 'Sinawy Virgin 1L Gold Tin', 'سيناوي زيت بكر ١ لتر صفيح', 'virgin', 'tin', 1000, v_m_voo, 1.0, v_m_t1000, 1, v_m_stk, 1, v_m_box, 1, 580, 10)
  RETURNING id INTO v_fp_v1000t;

  PERFORM public.erp_run_bottling_batch(v_fp_500g, 70, 0.4, 280, CURRENT_DATE - 6, 'Sinai #A1', 'First 500ml glass run');
  PERFORM public.erp_run_bottling_batch(v_fp_1000t, 35, 0.3, 175, CURRENT_DATE - 5, 'Sinai #A1', '1L gold tins run');
  PERFORM public.erp_run_bottling_batch(v_fp_250g, 40, 0.2, 120, CURRENT_DATE - 5, 'Sinai #A1', '250ml glass run');
  PERFORM public.erp_run_bottling_batch(v_fp_v1000t, 24, 0.2, 120, CURRENT_DATE - 4, 'Sinai #B1', '1L virgin tins run');

  PERFORM public.erp_create_sales_order(jsonb_build_object(
    'order_date', CURRENT_DATE - 3, 'external_order_id', 'EO-88401', 'channel', 'online_store',
    'campaign_name', 'sinawy.net (EasyOrders)', 'customer_name', 'Ahmed Hassan / أحمد حسن',
    'customer_phone', '01012345678', 'city', 'Cairo - Maadi', 'payment_method', 'cod',
    'payment_status', 'paid', 'order_status', 'delivered', 'shipping_charged', 65, 'shipping_actual_cost', 55,
    'items', jsonb_build_array(
      jsonb_build_object('finished_product_id', v_fp_500g, 'quantity', 2, 'unit_price', 390),
      jsonb_build_object('finished_product_id', v_fp_1000t, 'quantity', 1, 'unit_price', 710)
    )
  ));

  PERFORM public.erp_create_sales_order(jsonb_build_object(
    'order_date', CURRENT_DATE - 2, 'channel', 'social_ads', 'social_platform', 'facebook',
    'campaign_name', 'Harvest Cold-Press Video', 'customer_name', 'Nourhan Adel / نورهان عادل',
    'customer_phone', '01145678901', 'city', 'Giza - Sheikh Zayed', 'payment_method', 'instapay',
    'payment_status', 'paid', 'order_status', 'delivered', 'discount', 40, 'shipping_charged', 65, 'shipping_actual_cost', 60,
    'items', jsonb_build_array(
      jsonb_build_object('finished_product_id', v_fp_1000t, 'quantity', 2, 'unit_price', 710),
      jsonb_build_object('finished_product_id', v_fp_250g, 'quantity', 2, 'unit_price', 220)
    )
  ));

  PERFORM public.erp_create_sales_order(jsonb_build_object(
    'order_date', CURRENT_DATE - 1, 'channel', 'phone_offline', 'social_platform', 'whatsapp',
    'campaign_name', 'Direct Phone / Repeat Order', 'customer_name', 'Dr. Mahmoud El-Sayed / د. محمود السيد',
    'customer_phone', '01223344556', 'city', 'Alexandria - Smouha', 'payment_method', 'bank_transfer',
    'payment_status', 'paid', 'order_status', 'delivered', 'discount', 150, 'shipping_charged', 85, 'shipping_actual_cost', 75,
    'items', jsonb_build_array(
      jsonb_build_object('finished_product_id', v_fp_1000t, 'quantity', 5, 'unit_price', 710),
      jsonb_build_object('finished_product_id', v_fp_v1000t, 'quantity', 3, 'unit_price', 580)
    )
  ));

  INSERT INTO public.ad_spend (spend_date, platform, campaign_name, amount, notes) VALUES
    (CURRENT_DATE - 3, 'facebook', 'Harvest Cold-Press Video', 650, 'Meta Ads - Cairo & Giza'),
    (CURRENT_DATE - 1, 'instagram', 'Sinai Liquid Gold Reels', 480, 'IG Reels campaign');

  RETURN jsonb_build_object('seeded', true, 'message', 'Seeded Sinawy Olive Oil ERP starter data');
END;
$$;
