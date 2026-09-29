-- Safe purchase-receipt reversal with full audit trail.
BEGIN;

ALTER TABLE public.purchase_receipts
  ADD COLUMN IF NOT EXISTS purchase_status_before text,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid,
  ADD COLUMN IF NOT EXISTS void_reason text;

CREATE OR REPLACE FUNCTION public.capture_purchase_receipt_previous_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.purchase_status_before IS NULL THEN
    SELECT p.status
      INTO NEW.purchase_status_before
      FROM public.purchases p
     WHERE p.id = NEW.purchase_id;
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS capture_purchase_receipt_previous_status
ON public.purchase_receipts;

CREATE TRIGGER capture_purchase_receipt_previous_status
BEFORE INSERT ON public.purchase_receipts
FOR EACH ROW
EXECUTE FUNCTION public.capture_purchase_receipt_previous_status();

CREATE OR REPLACE FUNCTION public.guard_purchase_receipt_movement_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'cancelled'
     AND OLD.status IS DISTINCT FROM 'cancelled'
     AND EXISTS (
       SELECT 1
       FROM public.purchase_receipts pr
       WHERE pr.movement_id = OLD.id
         AND pr.voided_at IS NULL
     )
  THEN
    RAISE EXCEPTION 'Este movimiento pertenece a una recepción de compra activa. Anulá primero la recepción desde Compras.';
  END IF;

  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.admin_void_purchase_receipt(
  p_receipt_id uuid,
  p_reason text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_receipt public.purchase_receipts%rowtype;
  v_purchase public.purchases%rowtype;
  v_correction uuid;
  v_any_received boolean;
  v_all_received boolean;
  v_restore_status text;
BEGIN
  IF public.current_profile_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Solo el administrador puede anular una recepción de compra.';
  END IF;

  IF nullif(trim(coalesce(p_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Indicá el motivo de la anulación.';
  END IF;

  SELECT *
    INTO v_receipt
    FROM public.purchase_receipts
   WHERE id = p_receipt_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recepción inexistente.';
  END IF;

  IF v_receipt.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'Esta recepción ya fue anulada.';
  END IF;

  SELECT *
    INTO v_purchase
    FROM public.purchases
   WHERE id = v_receipt.purchase_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Compra inexistente.';
  END IF;

  -- Lock affected purchase items in deterministic order before changing received_qty.
  PERFORM 1
    FROM public.purchase_items pi
   WHERE pi.id IN (
     SELECT pri.purchase_item_id
       FROM public.purchase_receipt_items pri
      WHERE pri.receipt_id = p_receipt_id
   )
   ORDER BY pi.id
   FOR UPDATE;

  IF EXISTS (
    SELECT 1
      FROM public.purchase_receipt_items pri
      JOIN public.purchase_items pi ON pi.id = pri.purchase_item_id
     WHERE pri.receipt_id = p_receipt_id
       AND pi.received_qty < pri.quantity
  ) THEN
    RAISE EXCEPTION 'La recepción no puede revertirse porque las cantidades recibidas ya no son consistentes.';
  END IF;

  IF v_receipt.movement_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.inventory_batches b
      JOIN public.movement_lines ml ON ml.id = b.source_line_id
     WHERE ml.movement_id = v_receipt.movement_id
       AND (
         b.quantity_remaining <> b.quantity_received
         OR EXISTS (
           SELECT 1
             FROM public.batch_allocations ba
            WHERE ba.batch_id = b.id
         )
       )
  ) THEN
    RAISE EXCEPTION 'No se puede anular esta recepción porque parte del material ya fue utilizada o asignada. Usá una corrección auditada.';
  END IF;

  -- Mark first so the movement guard allows only this controlled reversal.
  UPDATE public.purchase_receipts
     SET voided_at = now(),
         voided_by = auth.uid(),
         void_reason = trim(p_reason)
   WHERE id = p_receipt_id;

  IF v_receipt.movement_id IS NOT NULL THEN
    v_correction := public.admin_void_stock_in_movement(
      v_receipt.movement_id,
      concat('Recepción de compra anulada: ', trim(p_reason))
    );
  END IF;

  UPDATE public.purchase_items pi
     SET received_qty = pi.received_qty - pri.quantity
    FROM public.purchase_receipt_items pri
   WHERE pri.receipt_id = p_receipt_id
     AND pri.purchase_item_id = pi.id;

  SELECT coalesce(bool_or(received_qty > 0), false),
         coalesce(bool_and(received_qty >= quantity), false)
    INTO v_any_received, v_all_received
    FROM public.purchase_items
   WHERE purchase_id = v_receipt.purchase_id;

  IF v_all_received THEN
    v_restore_status := 'received';
  ELSIF v_any_received THEN
    v_restore_status := 'partially_received';
  ELSE
    v_restore_status := CASE
      WHEN v_receipt.purchase_status_before IN ('ordered','in_transit')
        THEN v_receipt.purchase_status_before
      ELSE 'ordered'
    END;
  END IF;

  UPDATE public.purchases
     SET status = v_restore_status,
         updated_at = now()
   WHERE id = v_receipt.purchase_id;

  INSERT INTO public.audit_events(
    entity_type, entity_id, purchase_id, action, actor_id, warehouse_id, detail
  )
  VALUES(
    'purchase',
    v_receipt.purchase_id,
    v_receipt.purchase_id,
    'purchase_receipt_voided',
    auth.uid(),
    v_receipt.warehouse_id,
    jsonb_build_object(
      'receipt_id', p_receipt_id,
      'movement_id', v_receipt.movement_id,
      'correction_movement_id', v_correction,
      'reason', trim(p_reason),
      'restored_purchase_status', v_restore_status
    )
  );

  RETURN v_correction;
END
$function$;

REVOKE ALL ON FUNCTION public.capture_purchase_receipt_previous_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_void_purchase_receipt(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_void_purchase_receipt(uuid,text) TO authenticated;

COMMIT;
