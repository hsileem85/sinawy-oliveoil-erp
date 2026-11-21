-- ============================================================================
-- Sinawy Olive Oil ERP — Migration 002: Suppliers Setup + Cash / Credit (آجل)
-- Safe to run on top of an existing Supabase database.
-- ============================================================================

-- 1. Extend suppliers with default payment terms (cash vs credit/آجل)
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS default_payment_type TEXT NOT NULL DEFAULT 'cash'
    CHECK (default_payment_type IN ('cash', 'credit'));

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS credit_days INTEGER NOT NULL DEFAULT 0;

-- 2. Extend purchases with payment_type (cash / credit), amount_paid, and due_date
ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS payment_type TEXT NOT NULL DEFAULT 'cash'
    CHECK (payment_type IN ('cash', 'credit'));

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.purchases
  ADD COLUMN IF NOT EXISTS due_date DATE;

-- Backfill existing paid purchases so balance calculation stays accurate
UPDATE public.purchases
SET amount_paid = total_landed_cost
WHERE payment_status = 'paid' AND amount_paid = 0 AND total_landed_cost > 0;

-- 3. Allow 'credit' (آجل) as a payment method on sales_orders too
ALTER TABLE public.sales_orders
  DROP CONSTRAINT IF EXISTS sales_orders_payment_method_check;

ALTER TABLE public.sales_orders
  ADD CONSTRAINT sales_orders_payment_method_check
  CHECK (payment_method IN ('cod', 'instapay', 'vodafone_cash', 'card', 'bank_transfer', 'cash', 'credit'));

-- 4. Supplier Payments table (for settling آجل / credit balances)
CREATE TABLE IF NOT EXISTS public.supplier_payments (
  id SERIAL PRIMARY KEY,
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  supplier_id INTEGER NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  purchase_id INTEGER REFERENCES public.purchases(id) ON DELETE SET NULL,
  amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL DEFAULT 'cash'
    CHECK (payment_method IN ('cash', 'bank_transfer', 'instapay', 'vodafone_cash', 'cheque')),
  reference_no TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON public.supplier_payments(supplier_id, payment_date DESC);

-- RLS for supplier_payments
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    DROP POLICY IF EXISTS "authenticated_all_supplier_payments" ON public.supplier_payments;
    CREATE POLICY "authenticated_all_supplier_payments"
      ON public.supplier_payments FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 5. Update erp_record_purchase RPC to support Cash vs Credit (آجل), partial down payment, and due_date
DROP FUNCTION IF EXISTS public.erp_record_purchase(INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, INTEGER, DATE, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.erp_record_purchase(INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, INTEGER, DATE, TEXT, TEXT, TEXT, TEXT, NUMERIC, DATE);

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
  p_notes TEXT DEFAULT '',
  p_payment_type TEXT DEFAULT 'cash',
  p_amount_paid NUMERIC DEFAULT NULL,
  p_due_date DATE DEFAULT NULL
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
  v_pay_type TEXT;
  v_paid NUMERIC(12, 2);
  v_pay_status TEXT;
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

  v_pay_type := CASE WHEN p_payment_type = 'credit' THEN 'credit' ELSE 'cash' END;
  IF v_pay_type = 'cash' THEN
    v_paid := v_total_landed;
    v_pay_status := 'paid';
  ELSE
    v_paid := LEAST(GREATEST(ROUND(COALESCE(p_amount_paid, 0), 2), 0), v_total_landed);
    IF v_paid >= v_total_landed THEN
      v_pay_status := 'paid';
    ELSIF v_paid > 0 THEN
      v_pay_status := 'partial';
    ELSE
      v_pay_status := 'unpaid';
    END IF;
  END IF;

  INSERT INTO public.purchases (
    reference_no, purchase_date, supplier_id, raw_material_id, purchase_qty, units_per_purchase,
    base_qty, unit_price, subtotal, hidden_cost, total_landed_cost, landed_cost_per_base_unit,
    harvest_lot, payment_type, amount_paid, due_date, payment_status, notes
  ) VALUES (
    v_ref, COALESCE(p_purchase_date, CURRENT_DATE), p_supplier_id, p_raw_material_id, p_purchase_qty, v_factor,
    v_base_qty, p_unit_price, v_subtotal, COALESCE(p_hidden_cost, 0), v_total_landed, v_landed_per_base,
    COALESCE(p_harvest_lot, ''), v_pay_type, v_paid, p_due_date, v_pay_status, COALESCE(p_notes, '')
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
          format('Purchased %s %s (%s %s) [%s]', p_purchase_qty, v_mat.purchase_unit, v_base_qty, v_mat.base_unit, v_pay_type));

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

-- 6. New RPC: Record Supplier Payment (settles آجل balance FIFO across open purchases)
CREATE OR REPLACE FUNCTION public.erp_record_supplier_payment(
  p_supplier_id INTEGER,
  p_amount NUMERIC,
  p_payment_method TEXT DEFAULT 'cash',
  p_payment_date DATE DEFAULT CURRENT_DATE,
  p_purchase_id INTEGER DEFAULT NULL,
  p_reference_no TEXT DEFAULT '',
  p_notes TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_payment public.supplier_payments%ROWTYPE;
  v_remaining NUMERIC(12, 2);
  v_po RECORD;
  v_po_due NUMERIC(12, 2);
  v_apply NUMERIC(12, 2);
  v_new_paid NUMERIC(12, 2);
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = p_supplier_id) THEN
    RAISE EXCEPTION 'Supplier not found';
  END IF;

  INSERT INTO public.supplier_payments (
    payment_date, supplier_id, purchase_id, amount, payment_method, reference_no, notes
  ) VALUES (
    COALESCE(p_payment_date, CURRENT_DATE),
    p_supplier_id,
    p_purchase_id,
    ROUND(p_amount, 2),
    COALESCE(p_payment_method, 'cash'),
    COALESCE(NULLIF(trim(p_reference_no), ''), public.erp_gen_ref('PAY')),
    COALESCE(p_notes, '')
  ) RETURNING * INTO v_payment;

  v_remaining := ROUND(p_amount, 2);

  -- Apply to specific purchase first if requested
  IF p_purchase_id IS NOT NULL THEN
    SELECT id, total_landed_cost, amount_paid INTO v_po
    FROM public.purchases
    WHERE id = p_purchase_id AND supplier_id = p_supplier_id
    FOR UPDATE;

    IF FOUND THEN
      v_po_due := GREATEST(0, v_po.total_landed_cost - v_po.amount_paid);
      v_apply := LEAST(v_remaining, v_po_due);
      IF v_apply > 0 THEN
        v_new_paid := ROUND(v_po.amount_paid + v_apply, 2);
        UPDATE public.purchases
        SET amount_paid = v_new_paid,
            payment_status = CASE WHEN v_new_paid >= total_landed_cost THEN 'paid' ELSE 'partial' END
        WHERE id = v_po.id;
        v_remaining := ROUND(v_remaining - v_apply, 2);
      END IF;
    END IF;
  END IF;

  -- Apply any remaining payment FIFO to oldest unpaid/partial purchases for this supplier
  IF v_remaining > 0 THEN
    FOR v_po IN
      SELECT id, total_landed_cost, amount_paid
      FROM public.purchases
      WHERE supplier_id = p_supplier_id AND amount_paid < total_landed_cost
      ORDER BY purchase_date ASC, id ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_po_due := GREATEST(0, v_po.total_landed_cost - v_po.amount_paid);
      v_apply := LEAST(v_remaining, v_po_due);
      IF v_apply > 0 THEN
        v_new_paid := ROUND(v_po.amount_paid + v_apply, 2);
        UPDATE public.purchases
        SET amount_paid = v_new_paid,
            payment_status = CASE WHEN v_new_paid >= total_landed_cost THEN 'paid' ELSE 'partial' END
        WHERE id = v_po.id;
        v_remaining := ROUND(v_remaining - v_apply, 2);
      END IF;
    END LOOP;
  END IF;

  RETURN to_jsonb(v_payment);
END;
$$;

-- 7. Grants & PostgREST Schema Cache Reload
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_payments TO authenticated;
    GRANT USAGE, SELECT ON SEQUENCE public.supplier_payments_id_seq TO authenticated;
    GRANT EXECUTE ON FUNCTION public.erp_record_purchase(INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, INTEGER, DATE, TEXT, TEXT, TEXT, TEXT, NUMERIC, DATE) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.erp_record_supplier_payment(INTEGER, NUMERIC, TEXT, DATE, INTEGER, TEXT, TEXT) TO authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON public.supplier_payments TO service_role;
    GRANT ALL ON SEQUENCE public.supplier_payments_id_seq TO service_role;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
