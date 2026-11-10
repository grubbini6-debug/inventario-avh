-- Compras confirms work performed / direct deliveries using the existing receipt history.
-- These confirmations have no warehouse, movement or inventory batches.
alter table public.purchase_receipts
 alter column warehouse_id drop not null,
 add column confirmation_type text not null default 'warehouse',
 add column effective_date date,
 add constraint purchase_receipts_confirmation_type_check check (
  (confirmation_type='warehouse' and warehouse_id is not null) or
  (confirmation_type='direct' and warehouse_id is null and movement_id is null and effective_date is not null));

create schema avh_purchase_confirmation_private;
revoke all on schema avh_purchase_confirmation_private from public,anon,authenticated,service_role;
grant usage on schema avh_purchase_confirmation_private to authenticated;

create function avh_purchase_confirmation_private.confirm_direct(
 p_purchase_id uuid,p_items jsonb,p_effective_date date,p_notes text,p_request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare
 p public.purchases; r public.purchase_receipts; i public.purchase_items; line record;
 lines jsonb; saved_lines jsonb; notes text:=nullif(trim(p_notes),''); result uuid;
 all_received boolean; cancelled boolean;
begin
 if auth.uid() is null or public.current_profile_role() is distinct from 'admin' then
  raise exception 'Solo Compras puede confirmar servicios y entregas directas.';
 end if;
 if p_request_id is null then raise exception 'Falta el identificador de la confirmación.';end if;
 if p_effective_date is null or p_effective_date>(now() at time zone 'America/Asuncion')::date then
  raise exception 'Indicá la fecha de realización o recepción; no puede ser futura.';
 end if;
 if notes is null or length(notes)>4000 then raise exception 'Describí la conformidad en hasta 4000 caracteres.';end if;
 if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Indicá las cantidades realizadas o recibidas.';end if;
 if jsonb_array_length(p_items) not between 1 and 100 or length(p_items::text)>50000 then
  raise exception 'Confirmá entre 1 y 100 partidas.';
 end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where jsonb_typeof(x) is distinct from 'object') then
  raise exception 'Partida de confirmación inválida.';
 end if;
 select jsonb_agg(jsonb_build_object('purchase_item_id',x.purchase_item_id,'quantity',x.quantity) order by x.purchase_item_id)
 into lines from jsonb_to_recordset(p_items) as x(purchase_item_id uuid,quantity numeric);
 if exists(select 1 from jsonb_to_recordset(lines) as x(purchase_item_id uuid,quantity numeric)
  where x.purchase_item_id is null or x.quantity is null or not (x.quantity>0 and x.quantity<=1000000000000)
   or x.quantity<>round(x.quantity,6)) then raise exception 'Revisá las cantidades de la confirmación.';end if;
 if (select count(distinct x->>'purchase_item_id') from jsonb_array_elements(lines) x)<>jsonb_array_length(lines) then
  raise exception 'Una partida está repetida en la confirmación.';
 end if;

 -- Serialize retries even when a request is reused against a different purchase.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into r from public.purchase_receipts where received_by=auth.uid() and client_request_id=p_request_id;
 if found then
  select jsonb_agg(jsonb_build_object('purchase_item_id',ri.purchase_item_id,'quantity',ri.quantity) order by ri.purchase_item_id)
  into saved_lines from public.purchase_receipt_items ri where ri.receipt_id=r.id;
  if r.purchase_id is distinct from p_purchase_id or r.confirmation_type<>'direct' or r.effective_date is distinct from p_effective_date
   or r.notes is distinct from notes or saved_lines is distinct from lines then raise exception 'Solicitud reutilizada con datos distintos.';end if;
  if r.voided_at is not null then raise exception 'Esta confirmación fue anulada. Abrí de nuevo la compra.';end if;
  return r.id;
 end if;

 -- Preserve item -> purchase lock order used by receiving, corrections and short-close.
 perform 1 from public.purchase_items where purchase_id=p_purchase_id order by id for update;
 select * into p from public.purchases where id=p_purchase_id for update;
 if not found then raise exception 'Compra inexistente.';end if;
 if p.destination_type not in ('service','direct','barge','other') or p.warehouse_id is not null or
  exists(select 1 from public.purchase_items where purchase_id=p.id and affects_inventory) then
  raise exception 'La mercadería para stock debe recibirse en el depósito de destino.';
 end if;
 if p.status not in ('ordered','in_transit','partially_received') then
  raise exception 'Confirmá primero la compra al proveedor; debe estar pendiente de recepción.';
 end if;
 for line in select * from jsonb_to_recordset(lines) as x(purchase_item_id uuid,quantity numeric) loop
  select * into i from public.purchase_items where id=line.purchase_item_id and purchase_id=p.id;
  if not found then raise exception 'La partida no pertenece a esta compra.';end if;
  if i.received_qty+i.cancelled_qty+line.quantity>i.quantity then raise exception 'La confirmación supera lo pendiente para %.',i.description;end if;
 end loop;

 insert into public.purchase_receipts(purchase_id,warehouse_id,received_by,notes,client_request_id,purchase_status_before,confirmation_type,effective_date)
 values(p.id,null,auth.uid(),notes,p_request_id,p.status,'direct',p_effective_date) returning id into result;
 for line in select * from jsonb_to_recordset(lines) as x(purchase_item_id uuid,quantity numeric) loop
  insert into public.purchase_receipt_items(receipt_id,purchase_item_id,quantity) values(result,line.purchase_item_id,line.quantity);
  update public.purchase_items set received_qty=received_qty+line.quantity where id=line.purchase_item_id;
 end loop;
 select bool_and(received_qty+cancelled_qty>=quantity),bool_or(cancelled_qty>0) into all_received,cancelled
 from public.purchase_items where purchase_id=p.id;
 update public.purchases set status=case when all_received and cancelled then 'closed' when all_received then 'received' else 'partially_received' end,
  updated_at=now() where id=p.id;
 insert into public.audit_events(entity_type,entity_id,purchase_id,action,actor_id,detail)
 values('purchase_receipt',result,p.id,'purchase_direct_confirmed',auth.uid(),
  jsonb_build_object('effective_date',p_effective_date,'notes',notes,'items',lines,'destination_type',p.destination_type,'request_id',p_request_id));
 return result;
end $$;

create function public.admin_confirm_direct_purchase(
 p_purchase_id uuid,p_items jsonb,p_effective_date date,p_notes text,p_request_id uuid)
returns uuid language sql security invoker set search_path='' as $$
 select avh_purchase_confirmation_private.confirm_direct(p_purchase_id,p_items,p_effective_date,p_notes,p_request_id)
$$;
revoke all on function avh_purchase_confirmation_private.confirm_direct(uuid,jsonb,date,text,uuid),
 public.admin_confirm_direct_purchase(uuid,jsonb,date,text,uuid) from public,anon,authenticated,service_role;
grant execute on function avh_purchase_confirmation_private.confirm_direct(uuid,jsonb,date,text,uuid),
 public.admin_confirm_direct_purchase(uuid,jsonb,date,text,uuid) to authenticated;
