-- ============================================================================
-- Sinawy Olive Oil ERP — Migration 005: Immutable Supplier Payment Ledger
-- Converts supplier_payments into an append-only immutable transaction ledger:
--   - Every payment ('payment') and initial/cash payment ('down_payment') is an
--     independent immutable record (NO UPDATE on purchases).
--   - Cancelling a payment appends a new 'reversal' transaction linked via
--     reversed_payment_id (NO UPDATE or DELETE on existing payment rows).
--   - A unique partial index prevents reversing the same payment twice.
--   - A BEFORE UPDATE OR DELETE trigger enforces ledger immutability.
--   - Dynamic SQL views & Supplier Statement RPC compute all invoice paid
--     amounts, payment statuses, supplier balances, and running balances live.
-- Safe & idempotent to run on top of an existing Supabase database.
-- ============================================================================

-- 1. Extend public.supplier_payments for immutable ledger transactions
ALTER TABLE public.supplier_payments
  ADD COLUMN IF NOT EXISTS transaction_type TEXT NOT NULL DEFAULT 'payment';

ALTER TABLE public.supplier_payments
  DROP CONSTRAINT IF EXISTS supplier_payments_transaction_type_check;

ALTER TABLE public.supplier_payments
  ADD CONSTRAINT supplier_payments_transaction_type_check
  CHECK (transaction_type IN ('payment', 'down_payment', 'reversal'));

ALTER TABLE public.supplier_payments
  ADD COLUMN IF NOT EXISTS reversed_payment_id INTEGER REFERENCES public.supplier_payments(id) ON DELETE RESTRICT;

ALTER TABLE public.supplier_payments
  DROP CONSTRAINT IF EXISTS chk_supplier_payments_reversal_link;

ALTER TABLE public.supplier_payments
  ADD CONSTRAINT chk_supplier_payments_reversal_link
  CHECK (
    (transaction_type = 'reversal' AND reversed_payment_id IS NOT NULL)
    OR (transaction_type <> 'reversal' AND reversed_payment_id IS NULL)
  );

-- Guarantee each original payment can be reversed at most once
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_payments_unique_reversal
  ON public.supplier_payments (reversed_payment_id)
  WHERE reversed_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_payments_purchase
  ON public.supplier_payments (purchase_id)
  WHERE purchase_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_payments_type
  ON public.supplier_payments (transaction_type);

-- 2. Safe, idempotent backfill of historical cash purchases & credit down payments
--    (Before Migration 005, cash purchases and credit down payments were stored
--     only on purchases.amount_paid without a row in supplier_payments.)
DO $$
DECLARE
  v_sup RECORD;
  v_po RECORD;
  v_fifo_pool NUMERIC(12, 2);
  v_direct_payments NUMERIC(12, 2);
  v_rem_paid NUMERIC(12, 2);
  v_fifo_used NUMERIC(12, 2);
BEGIN
  -- 2a. Backfill existing Cash purchases (with a supplier) that have no down_payment ledger row yet
  INSERT INTO public.supplier_payments (
    payment_date, supplier_id, purchase_id, amount, payment_method,
    transaction_type, reversed_payment_id, reference_no, notes, created_at
  )
  SELECT
    p.purchase_date,
    p.supplier_id,
    p.id,
    ROUND(p.total_landed_cost, 2),
    'cash',
    'down_payment',
    NULL,
    'CASH-' || p.reference_no,
    'Cash purchase payment (migrated to ledger)',
    p.created_at
  FROM public.purchases p
  WHERE p.supplier_id IS NOT NULL
    AND p.payment_type = 'cash'
    AND p.total_landed_cost > 0
    AND NOT EXISTS (
      SELECT 1
      FROM public.supplier_payments sp
      WHERE sp.purchase_id = p.id
        AND sp.transaction_type = 'down_payment'
    );

  -- 2b. Backfill historical Credit purchase down payments (accounting for any existing payments)
  FOR v_sup IN
    SELECT DISTINCT supplier_id
    FROM public.purchases
    WHERE supplier_id IS NOT NULL
      AND payment_type = 'credit'
      AND amount_paid > 0
  LOOP
    -- Unallocated (FIFO) settlement payments already in supplier_payments for this supplier
    SELECT COALESCE(SUM(CASE WHEN transaction_type = 'reversal' THEN -amount ELSE amount END), 0)
    INTO v_fifo_pool
    FROM public.supplier_payments
    WHERE supplier_id = v_sup.supplier_id
      AND purchase_id IS NULL
      AND transaction_type IN ('payment', 'reversal');

    v_fifo_pool := GREATEST(0, ROUND(v_fifo_pool, 2));

    FOR v_po IN
      SELECT id, reference_no, purchase_date, amount_paid, created_at
      FROM public.purchases
      WHERE supplier_id = v_sup.supplier_id
        AND payment_type = 'credit'
        AND amount_paid > 0
      ORDER BY purchase_date ASC, id ASC
    LOOP
      -- Skip if already backfilled or recorded as a ledger down_payment
      IF EXISTS (
        SELECT 1 FROM public.supplier_payments sp
        WHERE sp.purchase_id = v_po.id AND sp.transaction_type = 'down_payment'
      ) THEN
        CONTINUE;
      END IF;

      -- Subtract direct settlement payments already linked to this purchase
      SELECT COALESCE(SUM(CASE WHEN transaction_type = 'reversal' THEN -amount ELSE amount END), 0)
      INTO v_direct_payments
      FROM public.supplier_payments
      WHERE purchase_id = v_po.id
        AND transaction_type IN ('payment', 'reversal');

      v_rem_paid := GREATEST(0, ROUND(v_po.amount_paid - GREATEST(0, v_direct_payments), 2));

      -- Subtract FIFO unallocated payments that had previously been applied to this purchase
      v_fifo_used := LEAST(v_rem_paid, v_fifo_pool);
      v_rem_paid := ROUND(v_rem_paid - v_fifo_used, 2);
      v_fifo_pool := ROUND(v_fifo_pool - v_fifo_used, 2);

      IF v_rem_paid > 0 THEN
        INSERT INTO public.supplier_payments (
          payment_date, supplier_id, purchase_id, amount, payment_method,
          transaction_type, reversed_payment_id, reference_no, notes, created_at
        ) VALUES (
          v_po.purchase_date,
          v_sup.supplier_id,
          v_po.id,
          v_rem_paid,
          'cash',
          'down_payment',
          NULL,
          'DP-' || v_po.reference_no,
          'Initial down payment (migrated to ledger)',
          v_po.created_at
        );
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- 3. Enforce append-only immutability on public.supplier_payments (NO UPDATE / NO DELETE)
CREATE OR REPLACE FUNCTION public.erp_prevent_supplier_payment_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'supplier_payments is an immutable append-only ledger. Record a reversal transaction instead of %.', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_supplier_payments_immutable ON public.supplier_payments;
CREATE TRIGGER trg_supplier_payments_immutable
  BEFORE UPDATE OR DELETE ON public.supplier_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.erp_prevent_supplier_payment_mutation();

-- 4. Dynamic Ledger Views (RLS-enforced via security_invoker = true)

-- 4a. Payment Ledger View (with signed_amount, is_reversed, reversal_ref, reversed_ref)
CREATE OR REPLACE VIEW public.v_supplier_payment_ledger
WITH (security_invoker = true)
AS
SELECT
  sp.id,
  sp.payment_date,
  sp.supplier_id,
  sp.purchase_id,
  sp.amount,
  CASE
    WHEN sp.transaction_type = 'reversal' THEN -sp.amount
    ELSE sp.amount
  END AS signed_amount,
  sp.payment_method,
  sp.transaction_type,
  sp.reversed_payment_id,
  sp.reference_no,
  sp.notes,
  sp.created_at,
  s.name AS supplier_name,
  s.name_ar AS supplier_name_ar,
  p.reference_no AS purchase_ref,
  orig.reference_no AS reversed_ref,
  (rev.id IS NOT NULL) AS is_reversed,
  rev.id AS reversal_id,
  rev.reference_no AS reversal_ref,
  rev.payment_date AS reversal_date
FROM public.supplier_payments sp
JOIN public.suppliers s ON s.id = sp.supplier_id
LEFT JOIN public.purchases p ON p.id = sp.purchase_id
LEFT JOIN public.supplier_payments orig ON orig.id = sp.reversed_payment_id
LEFT JOIN public.supplier_payments rev ON rev.reversed_payment_id = sp.id;

-- 4b. Dynamic Supplier Balances View (Purchases vs Net Ledger Transactions)
CREATE OR REPLACE VIEW public.v_supplier_balances
WITH (security_invoker = true)
AS
WITH po_agg AS (
  SELECT
    supplier_id,
    COUNT(*)::int AS purchase_count,
    COALESCE(SUM(total_landed_cost), 0)::numeric(12, 2) AS total_purchased
  FROM public.purchases
  WHERE supplier_id IS NOT NULL
  GROUP BY supplier_id
),
pay_agg AS (
  SELECT
    supplier_id,
    COUNT(*)::int AS transaction_count,
    COALESCE(SUM(CASE WHEN transaction_type = 'reversal' THEN -amount ELSE amount END), 0)::numeric(12, 2) AS total_paid
  FROM public.supplier_payments
  GROUP BY supplier_id
)
SELECT
  s.id,
  s.name,
  s.name_ar,
  s.category,
  s.phone,
  s.city,
  s.default_payment_type,
  s.credit_days,
  s.notes,
  s.created_at,
  COALESCE(po.purchase_count, 0)::int AS purchase_count,
  COALESCE(pa.transaction_count, 0)::int AS transaction_count,
  COALESCE(po.total_purchased, 0)::numeric(12, 2) AS total_purchased,
  COALESCE(pa.total_paid, 0)::numeric(12, 2) AS total_paid,
  ROUND(COALESCE(po.total_purchased, 0) - COALESCE(pa.total_paid, 0), 2) AS net_balance,
  ROUND(GREATEST(0, COALESCE(po.total_purchased, 0) - COALESCE(pa.total_paid, 0)), 2) AS balance_due,
  ROUND(GREATEST(0, COALESCE(pa.total_paid, 0) - COALESCE(po.total_purchased, 0)), 2) AS advance_balance
FROM public.suppliers s
LEFT JOIN po_agg po ON po.supplier_id = s.id
LEFT JOIN pay_agg pa ON pa.supplier_id = s.id;

-- 4c. Dynamic Purchase Balances View (Direct invoice-linked payments + FIFO general pool)
CREATE OR REPLACE VIEW public.v_purchase_balances
WITH (security_invoker = true)
AS
WITH direct_pay AS (
  SELECT
    purchase_id,
    COALESCE(SUM(CASE WHEN transaction_type = 'reversal' THEN -amount ELSE amount END), 0)::numeric(12, 2) AS direct_net
  FROM public.supplier_payments
  WHERE purchase_id IS NOT NULL
  GROUP BY purchase_id
),
po_with_direct AS (
  SELECT
    p.*,
    CASE
      WHEN p.supplier_id IS NULL THEN
        CASE WHEN p.payment_type = 'cash' THEN p.total_landed_cost ELSE LEAST(p.total_landed_cost, GREATEST(0, p.amount_paid)) END
      ELSE
        LEAST(p.total_landed_cost, GREATEST(0, COALESCE(dp.direct_net, 0)))
    END AS direct_applied,
    CASE
      WHEN p.supplier_id IS NULL THEN 0::numeric(12, 2)
      ELSE GREATEST(0, COALESCE(dp.direct_net, 0) - p.total_landed_cost)
    END AS direct_overflow
  FROM public.purchases p
  LEFT JOIN direct_pay dp ON dp.purchase_id = p.id
),
unallocated_pool AS (
  SELECT
    supplier_id,
    COALESCE(SUM(CASE WHEN transaction_type = 'reversal' THEN -amount ELSE amount END), 0)::numeric(12, 2) AS unallocated_net
  FROM public.supplier_payments
  WHERE purchase_id IS NULL
  GROUP BY supplier_id
),
overflow_pool AS (
  SELECT
    supplier_id,
    COALESCE(SUM(direct_overflow), 0)::numeric(12, 2) AS overflow_net
  FROM po_with_direct
  WHERE supplier_id IS NOT NULL
  GROUP BY supplier_id
),
supplier_fifo_pool AS (
  SELECT
    s.id AS supplier_id,
    GREATEST(0, COALESCE(u.unallocated_net, 0) + COALESCE(o.overflow_net, 0))::numeric(12, 2) AS fifo_pool
  FROM public.suppliers s
  LEFT JOIN unallocated_pool u ON u.supplier_id = s.id
  LEFT JOIN overflow_pool o ON o.supplier_id = s.id
),
po_fifo_calc AS (
  SELECT
    pwd.*,
    GREATEST(0, pwd.total_landed_cost - pwd.direct_applied) AS after_direct_due,
    COALESCE(sfp.fifo_pool, 0) AS supplier_fifo_pool,
    COALESCE(
      SUM(GREATEST(0, pwd.total_landed_cost - pwd.direct_applied)) OVER (
        PARTITION BY pwd.supplier_id
        ORDER BY pwd.purchase_date ASC, pwd.id ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
      ),
      0
    ) AS prev_due_before_me
  FROM po_with_direct pwd
  LEFT JOIN supplier_fifo_pool sfp ON sfp.supplier_id = pwd.supplier_id
),
po_final AS (
  SELECT
    pfc.*,
    CASE
      WHEN pfc.supplier_id IS NULL THEN 0::numeric(12, 2)
      ELSE ROUND(
        LEAST(pfc.after_direct_due, GREATEST(0, pfc.supplier_fifo_pool - pfc.prev_due_before_me)),
        2
      )
    END AS fifo_applied
  FROM po_fifo_calc pfc
)
SELECT
  pf.id,
  pf.reference_no,
  pf.purchase_date,
  pf.supplier_id,
  pf.raw_material_id,
  pf.purchase_qty,
  pf.units_per_purchase,
  pf.base_qty,
  pf.unit_price,
  pf.subtotal,
  pf.hidden_cost,
  pf.total_landed_cost,
  pf.landed_cost_per_base_unit,
  pf.harvest_lot,
  pf.payment_type,
  pf.due_date,
  pf.notes,
  pf.created_at,
  ROUND(pf.direct_applied, 2) AS direct_paid,
  ROUND(pf.fifo_applied, 2) AS fifo_paid,
  ROUND(pf.direct_applied + pf.fifo_applied, 2) AS amount_paid,
  ROUND(GREATEST(0, pf.total_landed_cost - (pf.direct_applied + pf.fifo_applied)), 2) AS remaining_due,
  CASE
    WHEN (pf.direct_applied + pf.fifo_applied) >= pf.total_landed_cost - 0.005 THEN 'paid'
    WHEN (pf.direct_applied + pf.fifo_applied) > 0.005 THEN 'partial'
    ELSE 'unpaid'
  END AS payment_status,
  rm.code AS material_code,
  rm.name AS material_name,
  rm.name_ar AS material_name_ar,
  rm.category AS material_category,
  rm.base_unit,
  rm.purchase_unit,
  s.name AS supplier_name,
  s.name_ar AS supplier_name_ar
FROM po_final pf
JOIN public.raw_materials rm ON rm.id = pf.raw_material_id
LEFT JOIN public.suppliers s ON s.id = pf.supplier_id;

-- 5. Update erp_record_purchase: inserts down_payment ledger transaction for cash/partial payments
DROP FUNCTION IF EXISTS public.erp_record_purchase(INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, INTEGER, DATE, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.erp_record_purchase(INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, INTEGER, DATE, TEXT, TEXT, TEXT, TEXT, NUMERIC, DATE);
DROP FUNCTION IF EXISTS public.erp_record_purchase(INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, INTEGER, DATE, TEXT, TEXT, TEXT, TEXT, NUMERIC, DATE, TEXT);

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
  p_due_date DATE DEFAULT NULL,
  p_payment_method TEXT DEFAULT 'cash'
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
  v_pay_method TEXT;
  v_initial_paid NUMERIC(12, 2);
  v_pay_status TEXT;
  v_purchase public.purchases%ROWTYPE;
  v_result JSONB;
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
  v_pay_method := CASE
    WHEN p_payment_method IN ('cash', 'bank_transfer', 'instapay', 'vodafone_cash', 'cheque') THEN p_payment_method
    ELSE 'cash'
  END;

  IF v_pay_type = 'cash' THEN
    v_initial_paid := v_total_landed;
    v_pay_status := 'paid';
  ELSE
    v_initial_paid := LEAST(GREATEST(ROUND(COALESCE(p_amount_paid, 0), 2), 0), v_total_landed);
    IF v_initial_paid >= v_total_landed THEN
      v_pay_status := 'paid';
    ELSIF v_initial_paid > 0 THEN
      v_pay_status := 'partial';
    ELSE
      v_pay_status := 'unpaid';
    END IF;
  END IF;

  -- For supplier purchases, payment state lives exclusively in supplier_payments (ledger);
  -- purchases.amount_paid is only populated as fallback when supplier_id IS NULL.
  INSERT INTO public.purchases (
    reference_no, purchase_date, supplier_id, raw_material_id, purchase_qty, units_per_purchase,
    base_qty, unit_price, subtotal, hidden_cost, total_landed_cost, landed_cost_per_base_unit,
    harvest_lot, payment_type, amount_paid, due_date, payment_status, notes
  ) VALUES (
    v_ref, COALESCE(p_purchase_date, CURRENT_DATE), p_supplier_id, p_raw_material_id, p_purchase_qty, v_factor,
    v_base_qty, p_unit_price, v_subtotal, COALESCE(p_hidden_cost, 0), v_total_landed, v_landed_per_base,
    COALESCE(p_harvest_lot, ''), v_pay_type,
    CASE WHEN p_supplier_id IS NULL THEN v_initial_paid ELSE 0 END,
    CASE WHEN v_pay_type = 'credit' THEN p_due_date ELSE NULL END,
    CASE WHEN p_supplier_id IS NULL THEN v_pay_status ELSE 'unpaid' END,
    COALESCE(p_notes, '')
  ) RETURNING * INTO v_purchase;

  -- Record immutable down_payment transaction in supplier_payments when paid upfront to a supplier
  IF p_supplier_id IS NOT NULL AND v_initial_paid > 0 THEN
    INSERT INTO public.supplier_payments (
      payment_date, supplier_id, purchase_id, amount, payment_method,
      transaction_type, reversed_payment_id, reference_no, notes
    ) VALUES (
      COALESCE(p_purchase_date, CURRENT_DATE),
      p_supplier_id,
      v_purchase.id,
      v_initial_paid,
      v_pay_method,
      'down_payment',
      NULL,
      CASE WHEN v_pay_type = 'cash' THEN 'CASH-' || v_ref ELSE 'DP-' || v_ref END,
      CASE WHEN v_pay_type = 'cash'
        THEN 'Cash purchase payment (' || v_ref || ')'
        ELSE 'Down payment on purchase (' || v_ref || ')'
      END
    );
  END IF;

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

  SELECT to_jsonb(pb) INTO v_result FROM public.v_purchase_balances pb WHERE pb.id = v_purchase.id;
  RETURN COALESCE(v_result, to_jsonb(v_purchase));
END;
$$;

-- 6. Update erp_update_purchase: preserves immutable payment ledger (no mutation of supplier_payments)
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
  v_result JSONB;
BEGIN
  IF p_purchase_qty <= 0 OR p_unit_price < 0 OR COALESCE(p_hidden_cost, 0) < 0 THEN
    RAISE EXCEPTION 'Valid quantity (>0), unit price, and non-negative hidden cost are required';
  END IF;

  SELECT * INTO v_old FROM public.purchases WHERE id = p_purchase_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase not found';
  END IF;

  IF v_old.supplier_id IS DISTINCT FROM p_supplier_id THEN
    IF EXISTS (
      SELECT 1 FROM public.supplier_payments sp
      WHERE sp.purchase_id = p_purchase_id
        AND sp.transaction_type <> 'reversal'
        AND NOT EXISTS (
          SELECT 1 FROM public.supplier_payments r WHERE r.reversed_payment_id = sp.id
        )
    ) THEN
      RAISE EXCEPTION 'Cannot change supplier on a purchase that has active payment transactions. Reverse the payments first.';
    END IF;
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
  IF p_supplier_id IS NULL THEN
    IF v_pay_type = 'cash' THEN
      v_paid := v_total_landed;
      v_pay_status := 'paid';
    ELSE
      v_paid := LEAST(GREATEST(ROUND(COALESCE(p_amount_paid, v_old.amount_paid, 0), 2), 0), v_total_landed);
      v_pay_status := CASE WHEN v_paid >= v_total_landed THEN 'paid' WHEN v_paid > 0 THEN 'partial' ELSE 'unpaid' END;
    END IF;
  ELSE
    v_paid := v_old.amount_paid;
    v_pay_status := v_old.payment_status;
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
    SELECT * INTO v_old_mat FROM public.raw_materials WHERE id = v_old.raw_material_id FOR UPDATE;
    v_next_qty := GREATEST(0, ROUND(v_old_mat.stock_qty - v_old.base_qty, 3));
    v_next_val := GREATEST(0, (v_old_mat.stock_qty * v_old_mat.avg_unit_cost) - v_old.total_landed_cost);
    v_next_avg := CASE WHEN v_next_qty > 0 THEN ROUND(v_next_val / v_next_qty, 4) ELSE v_old_mat.avg_unit_cost END;
    UPDATE public.raw_materials SET stock_qty = v_next_qty, avg_unit_cost = v_next_avg, updated_at = NOW() WHERE id = v_old_mat.id;
    INSERT INTO public.stock_movements (item_type, item_id, movement_type, qty_delta, unit_cost, reference_no, notes)
    VALUES ('raw', v_old_mat.id, 'adjustment', -v_old.base_qty, v_old.landed_cost_per_base_unit, v_old.reference_no, 'Purchase moved to another material');

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

  SELECT to_jsonb(pb) INTO v_result FROM public.v_purchase_balances pb WHERE pb.id = v_updated.id;
  RETURN COALESCE(v_result, to_jsonb(v_updated));
END;
$$;

-- 7. Pure Append-Only RPC: Record Supplier Payment (ZERO UPDATE on purchases!)
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
  v_result JSONB;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = p_supplier_id) THEN
    RAISE EXCEPTION 'Supplier not found';
  END IF;

  IF p_purchase_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.purchases WHERE id = p_purchase_id AND supplier_id = p_supplier_id
    ) THEN
      RAISE EXCEPTION 'Selected purchase invoice does not belong to this supplier';
    END IF;
  END IF;

  INSERT INTO public.supplier_payments (
    payment_date, supplier_id, purchase_id, amount, payment_method,
    transaction_type, reversed_payment_id, reference_no, notes
  ) VALUES (
    COALESCE(p_payment_date, CURRENT_DATE),
    p_supplier_id,
    p_purchase_id,
    ROUND(p_amount, 2),
    COALESCE(NULLIF(trim(p_payment_method), ''), 'cash'),
    'payment',
    NULL,
    COALESCE(NULLIF(trim(p_reference_no), ''), public.erp_gen_ref('PAY')),
    COALESCE(p_notes, '')
  ) RETURNING * INTO v_payment;

  SELECT to_jsonb(l) INTO v_result FROM public.v_supplier_payment_ledger l WHERE l.id = v_payment.id;
  RETURN COALESCE(v_result, to_jsonb(v_payment));
END;
$$;

-- 8. Pure Append-Only RPC: Reverse Supplier Payment (ZERO UPDATE / ZERO DELETE!)
DROP FUNCTION IF EXISTS public.erp_cancel_supplier_payment(INTEGER);
DROP FUNCTION IF EXISTS public.erp_cancel_supplier_payment(INTEGER, TEXT);

CREATE OR REPLACE FUNCTION public.erp_cancel_supplier_payment(
  p_payment_id INTEGER,
  p_notes TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_pay public.supplier_payments%ROWTYPE;
  v_rev public.supplier_payments%ROWTYPE;
  v_rev_json JSONB;
BEGIN
  SELECT * INTO v_pay FROM public.supplier_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier payment not found';
  END IF;

  IF v_pay.transaction_type = 'reversal' THEN
    RAISE EXCEPTION 'Cannot reverse a reversal transaction';
  END IF;

  IF EXISTS (SELECT 1 FROM public.supplier_payments WHERE reversed_payment_id = p_payment_id) THEN
    RAISE EXCEPTION 'This payment has already been reversed';
  END IF;

  INSERT INTO public.supplier_payments (
    payment_date, supplier_id, purchase_id, amount, payment_method,
    transaction_type, reversed_payment_id, reference_no, notes
  ) VALUES (
    CURRENT_DATE,
    v_pay.supplier_id,
    v_pay.purchase_id,
    ROUND(v_pay.amount, 2),
    v_pay.payment_method,
    'reversal',
    v_pay.id,
    public.erp_gen_ref('REV'),
    COALESCE(NULLIF(trim(p_notes), ''), 'Reversal of ' || COALESCE(v_pay.reference_no, '#' || v_pay.id::text))
  ) RETURNING * INTO v_rev;

  SELECT to_jsonb(l) INTO v_rev_json FROM public.v_supplier_payment_ledger l WHERE l.id = v_rev.id;

  RETURN jsonb_build_object(
    'ok', true,
    'reversal', COALESCE(v_rev_json, to_jsonb(v_rev)),
    'cancelled_payment', to_jsonb(v_pay)
  );
END;
$$;

-- 9. Supplier Statement RPC (Chronological Ledger + Cumulative Running Balance)
CREATE OR REPLACE FUNCTION public.erp_get_supplier_statement(p_supplier_id INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_supplier JSONB;
  v_entries JSONB;
BEGIN
  SELECT to_jsonb(sb) INTO v_supplier
  FROM public.v_supplier_balances sb
  WHERE sb.id = p_supplier_id;

  IF v_supplier IS NULL THEN
    RAISE EXCEPTION 'Supplier not found';
  END IF;

  WITH raw_entries AS (
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
    FROM public.purchases p
    JOIN public.raw_materials rm ON rm.id = p.raw_material_id
    WHERE p.supplier_id = p_supplier_id

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
    FROM public.v_supplier_payment_ledger sp
    WHERE sp.supplier_id = p_supplier_id
  ),
  ordered AS (
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
    ORDER BY re.entry_date ASC, re.sort_rank ASC, re.created_at ASC, re.source_id ASC
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(ordered)), '[]'::jsonb)
  INTO v_entries
  FROM ordered;

  RETURN jsonb_build_object(
    'supplier', v_supplier,
    'entries', v_entries
  );
END;
$$;

-- 10. Grants & PostgREST Schema Cache Reload
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT SELECT ON public.v_supplier_payment_ledger TO authenticated;
    GRANT SELECT ON public.v_supplier_balances TO authenticated;
    GRANT SELECT ON public.v_purchase_balances TO authenticated;
    GRANT EXECUTE ON FUNCTION public.erp_record_purchase(INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, INTEGER, DATE, TEXT, TEXT, TEXT, TEXT, NUMERIC, DATE, TEXT) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.erp_update_purchase(INTEGER, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, INTEGER, DATE, TEXT, TEXT, NUMERIC, DATE, TEXT) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.erp_record_supplier_payment(INTEGER, NUMERIC, TEXT, DATE, INTEGER, TEXT, TEXT) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.erp_cancel_supplier_payment(INTEGER, TEXT) TO authenticated;
    GRANT EXECUTE ON FUNCTION public.erp_get_supplier_statement(INTEGER) TO authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT ON public.v_supplier_payment_ledger TO service_role;
    GRANT SELECT ON public.v_supplier_balances TO service_role;
    GRANT SELECT ON public.v_purchase_balances TO service_role;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
