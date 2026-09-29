-- Prevent generic stock/movement cancellation from desynchronizing purchase receipts.
-- A movement referenced by purchase_receipts must be reversed through a dedicated
-- purchase-receipt workflow so received_qty and purchase status stay consistent.
BEGIN;

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
     )
  THEN
    RAISE EXCEPTION 'Este movimiento pertenece a una recepción de compra. No puede anularse desde Movimientos; requiere una reversión específica de la recepción.';
  END IF;

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS guard_purchase_receipt_movement_cancellation
ON public.movements;

CREATE TRIGGER guard_purchase_receipt_movement_cancellation
BEFORE UPDATE OF status ON public.movements
FOR EACH ROW
WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.guard_purchase_receipt_movement_cancellation();

COMMIT;
