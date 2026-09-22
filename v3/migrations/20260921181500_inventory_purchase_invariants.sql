-- AVH V3 — invariantes estructurales de inventario y compras.
-- Defensa en profundidad: aunque una futura función/Edge Function tenga un bug,
-- PostgreSQL no debe aceptar saldos imposibles ni sobre-recepciones.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.inventory_batches'::regclass
      and conname='inventory_batches_remaining_lte_received'
  ) then
    alter table public.inventory_batches
      add constraint inventory_batches_remaining_lte_received
      check (quantity_remaining <= quantity_received) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.purchase_items'::regclass
      and conname='purchase_items_received_lte_quantity'
  ) then
    alter table public.purchase_items
      add constraint purchase_items_received_lte_quantity
      check (received_qty <= quantity) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.movements'::regclass
      and conname='movements_location_by_type'
  ) then
    alter table public.movements
      add constraint movements_location_by_type
      check (
        (type='exit' and warehouse_from_id is not null and warehouse_to_id is null)
        or
        (type in ('entry','initial','return') and warehouse_to_id is not null and warehouse_from_id is null)
        or
        (type='transfer' and warehouse_from_id is not null and warehouse_to_id is not null and warehouse_from_id<>warehouse_to_id)
        or
        (type in ('adjustment','correction') and (warehouse_from_id is not null or warehouse_to_id is not null))
      ) not valid;
  end if;
end $$;

alter table public.inventory_batches
  validate constraint inventory_batches_remaining_lte_received;

alter table public.purchase_items
  validate constraint purchase_items_received_lte_quantity;

alter table public.movements
  validate constraint movements_location_by_type;
