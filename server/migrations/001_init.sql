-- Sinawy Olive Oil ERP — PostgreSQL Schema (Phases 1, 2, 3 + Integrations)

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  key_value TEXT UNIQUE NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  name_ar TEXT,
  category TEXT NOT NULL DEFAULT 'general',
  phone TEXT,
  city TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS raw_materials (
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

CREATE TABLE IF NOT EXISTS purchases (
  id SERIAL PRIMARY KEY,
  reference_no TEXT UNIQUE NOT NULL,
  purchase_date DATE NOT NULL DEFAULT CURRENT_DATE,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  raw_material_id INTEGER NOT NULL REFERENCES raw_materials(id) ON DELETE RESTRICT,
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

CREATE TABLE IF NOT EXISTS hidden_costs (
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

CREATE TABLE IF NOT EXISTS finished_products (
  id SERIAL PRIMARY KEY,
  sku TEXT UNIQUE NOT NULL,
  external_sku TEXT,
  name TEXT NOT NULL,
  name_ar TEXT,
  oil_type TEXT NOT NULL DEFAULT 'extra_virgin',
  container_type TEXT NOT NULL DEFAULT 'glass' CHECK (container_type IN ('glass', 'tin', 'sachet', 'box')),
  size_ml INTEGER NOT NULL DEFAULT 500,
  oil_material_id INTEGER REFERENCES raw_materials(id) ON DELETE SET NULL,
  oil_litres_per_unit NUMERIC(10, 4) NOT NULL DEFAULT 0.5,
  container_material_id INTEGER REFERENCES raw_materials(id) ON DELETE SET NULL,
  containers_per_unit NUMERIC(10, 3) NOT NULL DEFAULT 1,
  sticker_material_id INTEGER REFERENCES raw_materials(id) ON DELETE SET NULL,
  stickers_per_unit NUMERIC(10, 3) NOT NULL DEFAULT 1,
  extra_material_id INTEGER REFERENCES raw_materials(id) ON DELETE SET NULL,
  extra_qty_per_unit NUMERIC(10, 3) NOT NULL DEFAULT 0,
  stock_qty INTEGER NOT NULL DEFAULT 0,
  unit_cogs NUMERIC(12, 4) NOT NULL DEFAULT 0,
  retail_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 10,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bottling_batches (
  id SERIAL PRIMARY KEY,
  batch_code TEXT UNIQUE NOT NULL,
  batch_date DATE NOT NULL DEFAULT CURRENT_DATE,
  finished_product_id INTEGER NOT NULL REFERENCES finished_products(id) ON DELETE RESTRICT,
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

CREATE TABLE IF NOT EXISTS sales_orders (
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

CREATE TABLE IF NOT EXISTS sales_order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  finished_product_id INTEGER REFERENCES finished_products(id) ON DELETE SET NULL,
  sku_snapshot TEXT NOT NULL,
  product_name_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price NUMERIC(12, 2) NOT NULL,
  unit_cogs NUMERIC(12, 4) NOT NULL DEFAULT 0,
  line_total NUMERIC(12, 2) NOT NULL,
  line_cogs NUMERIC(12, 2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ad_spend (
  id SERIAL PRIMARY KEY,
  spend_date DATE NOT NULL DEFAULT CURRENT_DATE,
  platform TEXT NOT NULL CHECK (platform IN ('facebook', 'instagram', 'tiktok', 'google', 'other')),
  campaign_name TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stock_movements (
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

CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(purchase_date DESC);
CREATE INDEX IF NOT EXISTS idx_bottling_date ON bottling_batches(batch_date DESC);
CREATE INDEX IF NOT EXISTS idx_orders_date ON sales_orders(order_date DESC);
CREATE INDEX IF NOT EXISTS idx_orders_channel ON sales_orders(channel);
CREATE INDEX IF NOT EXISTS idx_orders_status ON sales_orders(order_status);
CREATE INDEX IF NOT EXISTS idx_ad_spend_date ON ad_spend(spend_date DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_item ON stock_movements(item_type, item_id);
