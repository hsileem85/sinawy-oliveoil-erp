-- Migration 002: Suppliers Setup + Cash / Credit (آجل) Payment Support

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS default_payment_type TEXT NOT NULL DEFAULT 'cash'
    CHECK (default_payment_type IN ('cash', 'credit'));

ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS credit_days INTEGER NOT NULL DEFAULT 0;

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'cash'
    CHECK (payment_type IN ('cash', 'credit'));

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE purchases
  ADD COLUMN IF NOT EXISTS due_date DATE;

UPDATE purchases
SET amount_paid = total_landed_cost
WHERE payment_status = 'paid' AND amount_paid = 0 AND total_landed_cost > 0;

ALTER TABLE sales_orders
  DROP CONSTRAINT IF EXISTS sales_orders_payment_method_check;

ALTER TABLE sales_orders
  ADD CONSTRAINT sales_orders_payment_method_check
  CHECK (payment_method IN ('cod', 'instapay', 'vodafone_cash', 'card', 'bank_transfer', 'cash', 'credit'));

CREATE TABLE IF NOT EXISTS supplier_payments (
  id SERIAL PRIMARY KEY,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  purchase_id INTEGER REFERENCES purchases(id) ON DELETE SET NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL DEFAULT 'cash'
    CHECK (payment_method IN ('cash', 'bank_transfer', 'instapay', 'vodafone_cash', 'cheque')),
  reference_no TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON supplier_payments(supplier_id, payment_date DESC);
