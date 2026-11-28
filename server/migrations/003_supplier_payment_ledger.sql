-- Migration 003: Immutable Supplier Payment Ledger Transactions + Dynamic Balance Views

ALTER TABLE supplier_payments
  ADD COLUMN IF NOT EXISTS transaction_type TEXT NOT NULL DEFAULT 'payment';

ALTER TABLE supplier_payments
  DROP CONSTRAINT IF EXISTS supplier_payments_transaction_type_check;

ALTER TABLE supplier_payments
  ADD CONSTRAINT supplier_payments_transaction_type_check
  CHECK (transaction_type IN ('payment', 'down_payment', 'reversal'));

ALTER TABLE supplier_payments
  ADD COLUMN IF NOT EXISTS reversed_payment_id INTEGER REFERENCES supplier_payments(id) ON DELETE RESTRICT;

ALTER TABLE supplier_payments
  DROP CONSTRAINT IF EXISTS chk_supplier_payments_reversal_link;

ALTER TABLE supplier_payments
  ADD CONSTRAINT chk_supplier_payments_reversal_link
  CHECK (
    (transaction_type = 'reversal' AND reversed_payment_id IS NOT NULL)
    OR (transaction_type <> 'reversal' AND reversed_payment_id IS NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_payments_unique_reversal
  ON supplier_payments (reversed_payment_id)
  WHERE reversed_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_payments_purchase
  ON supplier_payments (purchase_id)
  WHERE purchase_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_payments_type
  ON supplier_payments (transaction_type);

-- Idempotent backfill of existing cash purchases & credit down payments
DO $$
DECLARE
  v_sup RECORD;
  v_po RECORD;
  v_fifo_pool NUMERIC(12, 2);
  v_direct_payments NUMERIC(12, 2);
  v_rem_paid NUMERIC(12, 2);
  v_fifo_used NUMERIC(12, 2);
BEGIN
  INSERT INTO supplier_payments (
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
  FROM purchases p
  WHERE p.supplier_id IS NOT NULL
    AND p.payment_type = 'cash'
    AND p.total_landed_cost > 0
    AND NOT EXISTS (
      SELECT 1 FROM supplier_payments sp
      WHERE sp.purchase_id = p.id AND sp.transaction_type = 'down_payment'
    );

  FOR v_sup IN
    SELECT DISTINCT supplier_id
    FROM purchases
    WHERE supplier_id IS NOT NULL
      AND payment_type = 'credit'
      AND amount_paid > 0
  LOOP
    SELECT COALESCE(SUM(CASE WHEN transaction_type = 'reversal' THEN -amount ELSE amount END), 0)
    INTO v_fifo_pool
    FROM supplier_payments
    WHERE supplier_id = v_sup.supplier_id
      AND purchase_id IS NULL
      AND transaction_type IN ('payment', 'reversal');

    v_fifo_pool := GREATEST(0, ROUND(v_fifo_pool, 2));

    FOR v_po IN
      SELECT id, reference_no, purchase_date, amount_paid, created_at
      FROM purchases
      WHERE supplier_id = v_sup.supplier_id
        AND payment_type = 'credit'
        AND amount_paid > 0
      ORDER BY purchase_date ASC, id ASC
    LOOP
      IF EXISTS (
        SELECT 1 FROM supplier_payments sp
        WHERE sp.purchase_id = v_po.id AND sp.transaction_type = 'down_payment'
      ) THEN
        CONTINUE;
      END IF;

      SELECT COALESCE(SUM(CASE WHEN transaction_type = 'reversal' THEN -amount ELSE amount END), 0)
      INTO v_direct_payments
      FROM supplier_payments
      WHERE purchase_id = v_po.id
        AND transaction_type IN ('payment', 'reversal');

      v_rem_paid := GREATEST(0, ROUND(v_po.amount_paid - GREATEST(0, v_direct_payments), 2));
      v_fifo_used := LEAST(v_rem_paid, v_fifo_pool);
      v_rem_paid := ROUND(v_rem_paid - v_fifo_used, 2);
      v_fifo_pool := ROUND(v_fifo_pool - v_fifo_used, 2);

      IF v_rem_paid > 0 THEN
        INSERT INTO supplier_payments (
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

-- Immutability trigger on supplier_payments
CREATE OR REPLACE FUNCTION erp_prevent_supplier_payment_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'supplier_payments is an immutable append-only ledger. Record a reversal transaction instead of %.', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS trg_supplier_payments_immutable ON supplier_payments;
CREATE TRIGGER trg_supplier_payments_immutable
  BEFORE UPDATE OR DELETE ON supplier_payments
  FOR EACH ROW
  EXECUTE FUNCTION erp_prevent_supplier_payment_mutation();

-- Dynamic ledger views
CREATE OR REPLACE VIEW v_supplier_payment_ledger AS
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
FROM supplier_payments sp
JOIN suppliers s ON s.id = sp.supplier_id
LEFT JOIN purchases p ON p.id = sp.purchase_id
LEFT JOIN supplier_payments orig ON orig.id = sp.reversed_payment_id
LEFT JOIN supplier_payments rev ON rev.reversed_payment_id = sp.id;

CREATE OR REPLACE VIEW v_supplier_balances AS
WITH po_agg AS (
  SELECT
    supplier_id,
    COUNT(*)::int AS purchase_count,
    COALESCE(SUM(total_landed_cost), 0)::numeric(12, 2) AS total_purchased
  FROM purchases
  WHERE supplier_id IS NOT NULL
  GROUP BY supplier_id
),
pay_agg AS (
  SELECT
    supplier_id,
    COUNT(*)::int AS transaction_count,
    COALESCE(SUM(CASE WHEN transaction_type = 'reversal' THEN -amount ELSE amount END), 0)::numeric(12, 2) AS total_paid
  FROM supplier_payments
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
FROM suppliers s
LEFT JOIN po_agg po ON po.supplier_id = s.id
LEFT JOIN pay_agg pa ON pa.supplier_id = s.id;

CREATE OR REPLACE VIEW v_purchase_balances AS
WITH direct_pay AS (
  SELECT
    purchase_id,
    COALESCE(SUM(CASE WHEN transaction_type = 'reversal' THEN -amount ELSE amount END), 0)::numeric(12, 2) AS direct_net
  FROM supplier_payments
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
  FROM purchases p
  LEFT JOIN direct_pay dp ON dp.purchase_id = p.id
),
unallocated_pool AS (
  SELECT
    supplier_id,
    COALESCE(SUM(CASE WHEN transaction_type = 'reversal' THEN -amount ELSE amount END), 0)::numeric(12, 2) AS unallocated_net
  FROM supplier_payments
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
  FROM suppliers s
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
JOIN raw_materials rm ON rm.id = pf.raw_material_id
LEFT JOIN suppliers s ON s.id = pf.supplier_id;
