-- ============================================================================
-- Sinawy Olive Oil ERP — Migration 003: Cancel Supplier Payment RPC
-- Safely reverses a supplier settlement payment and restores آجل balance.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.erp_cancel_supplier_payment(p_payment_id INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_pay public.supplier_payments%ROWTYPE;
  v_remaining NUMERIC(12, 2);
  v_po RECORD;
  v_deduct NUMERIC(12, 2);
  v_new_paid NUMERIC(12, 2);
BEGIN
  SELECT * INTO v_pay FROM public.supplier_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier payment not found';
  END IF;

  v_remaining := ROUND(v_pay.amount, 2);

  -- 1. If linked to a specific purchase invoice, reverse from it first
  IF v_pay.purchase_id IS NOT NULL THEN
    SELECT id, total_landed_cost, amount_paid INTO v_po
    FROM public.purchases
    WHERE id = v_pay.purchase_id AND supplier_id = v_pay.supplier_id
    FOR UPDATE;

    IF FOUND AND v_po.amount_paid > 0 THEN
      v_deduct := LEAST(v_remaining, v_po.amount_paid);
      v_new_paid := ROUND(GREATEST(0, v_po.amount_paid - v_deduct), 2);
      UPDATE public.purchases
      SET amount_paid = v_new_paid,
          payment_status = CASE
            WHEN v_new_paid >= total_landed_cost THEN 'paid'
            WHEN v_new_paid > 0 THEN 'partial'
            ELSE 'unpaid'
          END
      WHERE id = v_po.id;
      v_remaining := ROUND(v_remaining - v_deduct, 2);
    END IF;
  END IF;

  -- 2. Reverse any remaining amount LIFO (credit invoices first, newest to oldest)
  IF v_remaining > 0 THEN
    FOR v_po IN
      SELECT id, total_landed_cost, amount_paid
      FROM public.purchases
      WHERE supplier_id = v_pay.supplier_id AND amount_paid > 0
      ORDER BY
        CASE WHEN payment_type = 'credit' THEN 0 ELSE 1 END ASC,
        purchase_date DESC,
        id DESC
      FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_deduct := LEAST(v_remaining, v_po.amount_paid);
      IF v_deduct > 0 THEN
        v_new_paid := ROUND(GREATEST(0, v_po.amount_paid - v_deduct), 2);
        UPDATE public.purchases
        SET amount_paid = v_new_paid,
            payment_status = CASE
              WHEN v_new_paid >= total_landed_cost THEN 'paid'
              WHEN v_new_paid > 0 THEN 'partial'
              ELSE 'unpaid'
            END
        WHERE id = v_po.id;
        v_remaining := ROUND(v_remaining - v_deduct, 2);
      END IF;
    END LOOP;
  END IF;

  DELETE FROM public.supplier_payments WHERE id = p_payment_id;

  RETURN jsonb_build_object(
    'ok', true,
    'cancelled_payment', to_jsonb(v_pay)
  );
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.erp_cancel_supplier_payment(INTEGER) TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.erp_cancel_supplier_payment(INTEGER) TO service_role;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
