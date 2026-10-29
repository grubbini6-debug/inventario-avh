-- Preserve the approved quantities and actual receipts; cancel only the unfulfilled balance.
alter table public.purchase_items
  add column cancelled_qty numeric(18,6) not null default 0,
  add column cancellation_reason text,
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references public.profiles(id),
  add constraint purchase_items_cancelled_balance_check check
    (cancelled_qty>=0 and received_qty+cancelled_qty<=quantity and
     (cancelled_qty=0 or (nullif(trim(cancellation_reason),'') is not null and cancelled_at is not null)));

-- An empty list keeps the existing single-warehouse behavior.
alter table public.purchases add column delivery_warehouse_ids uuid[] not null default '{}';
create index purchase_items_cancelled_by_idx on public.purchase_items(cancelled_by) where cancelled_by is not null;
create index purchases_delivery_warehouse_ids_idx on public.purchases using gin(delivery_warehouse_ids);

create schema if not exists avh_purchase_delivery_private;
revoke all on schema avh_purchase_delivery_private from public,anon,authenticated,service_role;

create function avh_purchase_delivery_private.guard_delivery_warehouses()
returns trigger language plpgsql set search_path='' as $$
begin
 if cardinality(new.delivery_warehouse_ids)>0 then
  if new.destination_type<>'warehouse' or new.warehouse_id is null or
     not new.warehouse_id=any(new.delivery_warehouse_ids) or
     exists(select 1 from unnest(new.delivery_warehouse_ids) id where id is null) or
     cardinality(new.delivery_warehouse_ids)<>(select count(distinct id) from unnest(new.delivery_warehouse_ids) id) or
     exists(select 1 from unnest(new.delivery_warehouse_ids) id where not exists(select 1 from public.warehouses w where w.id=id and w.active))
  then raise exception 'Elegí depósitos activos, sin duplicados, e incluí el depósito principal.';end if;
 end if;
 if tg_op='UPDATE' and (new.delivery_warehouse_ids is distinct from old.delivery_warehouse_ids or new.warehouse_id is distinct from old.warehouse_id) and exists(
   select 1 from public.purchase_receipts r where r.purchase_id=new.id and not r.warehouse_id=any(array_append(new.delivery_warehouse_ids,new.warehouse_id)))
 then raise exception 'No se puede quitar un depósito que ya tiene recepciones de esta OC.';end if;
 return new;
end $$;
create trigger purchase_delivery_warehouses_guard before insert or update of delivery_warehouse_ids,warehouse_id,destination_type on public.purchases
for each row execute function avh_purchase_delivery_private.guard_delivery_warehouses();

create function avh_purchase_delivery_private.guard_cancelled_item()
returns trigger language plpgsql set search_path='' as $$
begin
 if old.cancelled_qty>0 and (to_jsonb(new)-array['received_qty','cancelled_qty','cancellation_reason','cancelled_at','cancelled_by','notes']) is distinct from
   (to_jsonb(old)-array['received_qty','cancelled_qty','cancellation_reason','cancelled_at','cancelled_by','notes'])
 then raise exception 'Este ítem tiene saldo cancelado. Conservá la cantidad y los datos originales de la OC.';end if;
 return new;
end $$;
create trigger purchase_cancelled_item_guard before update on public.purchase_items
for each row execute function avh_purchase_delivery_private.guard_cancelled_item();

create function avh_purchase_delivery_private.audit_cancelled_balance()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.cancelled_qty is distinct from old.cancelled_qty then
  insert into public.audit_events(entity_type,entity_id,purchase_id,action,actor_id,detail)
  values('purchase_item',new.id,new.purchase_id,'purchase_balance_cancelled',auth.uid(),
   jsonb_build_object('description',new.description,'ordered_qty',new.quantity,'received_qty',new.received_qty,
    'previous_cancelled_qty',old.cancelled_qty,'cancelled_qty',new.cancelled_qty,'unit',new.unit,'reason',new.cancellation_reason));
 end if;
 return new;
end $$;
create trigger purchase_cancelled_balance_audit after update of cancelled_qty on public.purchase_items
for each row execute function avh_purchase_delivery_private.audit_cancelled_balance();
revoke all on all functions in schema avh_purchase_delivery_private from public,anon,authenticated,service_role;

create or replace function public.admin_set_purchase_delivery_warehouses(p_purchase_id uuid,p_warehouse_ids uuid[])
returns void language plpgsql security definer set search_path='' as $$
declare p public.purchases%rowtype;
begin
 if public.current_profile_role() is distinct from 'admin' then raise exception 'Solo Compras puede definir los depósitos de entrega.';end if;
 select * into p from public.purchases where id=p_purchase_id for update;
 if not found then raise exception 'Compra inexistente.';end if;
 if p.status in ('cancelled','closed') or p.destination_type<>'warehouse' then raise exception 'Esta compra no admite destinos de recepción.';end if;
 if coalesce(cardinality(p_warehouse_ids),0)=0 then raise exception 'Elegí al menos un depósito de entrega.';end if;
 update public.purchases set delivery_warehouse_ids=p_warehouse_ids,
  delivery_mode=case when cardinality(p_warehouse_ids)>1 then 'partial' else delivery_mode end,updated_at=now() where id=p.id;
 insert into public.audit_events(entity_type,entity_id,purchase_id,action,actor_id,detail)
 values('purchase',p.id,p.id,'purchase_delivery_warehouses_updated',auth.uid(),
  jsonb_build_object('before',p.delivery_warehouse_ids,'warehouse_ids',p_warehouse_ids,'shared_balance',true));
end $$;

create or replace function public.admin_cancel_purchase_balance(p_purchase_id uuid,p_item_ids uuid[],p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.purchases%rowtype; affected int;
begin
 if public.current_profile_role() is distinct from 'admin' then raise exception 'Solo Compras puede cerrar saldos no entregados.';end if;
 if nullif(trim(p_reason),'') is null then raise exception 'Indicá por qué el proveedor no entregará el saldo.';end if;
 if coalesce(cardinality(p_item_ids),0)=0 then raise exception 'Seleccioná los ítems cuyo saldo se cancela.';end if;
 -- Same item -> purchase locking order as receiving and item corrections.
 perform 1 from public.purchase_items where purchase_id=p_purchase_id order by id for update;
 select * into p from public.purchases where id=p_purchase_id for update;
 if not found then raise exception 'Compra inexistente.';end if;
 if p.status not in ('ordered','in_transit','partially_received','received','invoiced','closed') then raise exception 'La compra no admite cierre de saldo.';end if;
 if exists(select 1 from unnest(p_item_ids) id where id is null or not exists(select 1 from public.purchase_items i where i.id=id and i.purchase_id=p.id))
 then raise exception 'Ítem de compra inválido.';end if;
 update public.purchase_items set cancelled_qty=quantity-received_qty,cancellation_reason=trim(p_reason),cancelled_at=now(),cancelled_by=auth.uid()
 where purchase_id=p.id and id=any(p_item_ids) and quantity>received_qty+cancelled_qty;
 get diagnostics affected=row_count;
 if not exists(select 1 from public.purchase_items where purchase_id=p.id and received_qty+cancelled_qty<quantity) and
    exists(select 1 from public.purchase_items where purchase_id=p.id and cancelled_qty>0) then
  update public.purchases set status='closed',updated_at=now() where id=p.id;
 end if;
 return jsonb_build_object('cancelled_items',affected,'purchase_id',p.id);
end $$;
revoke all on function public.admin_set_purchase_delivery_warehouses(uuid,uuid[]) from public,anon;
revoke all on function public.admin_cancel_purchase_balance(uuid,uuid[],text) from public,anon;
grant execute on function public.admin_set_purchase_delivery_warehouses(uuid,uuid[]),public.admin_cancel_purchase_balance(uuid,uuid[],text) to authenticated;

-- Each assigned depot sees the shared order and lines; actual receipts remain scoped to their own depot.
alter policy purchases_depositor_read on public.purchases using (
 (select public.current_profile_role())='depositor' and destination_type='warehouse' and
 ((select public.current_profile_warehouse())=warehouse_id or (select public.current_profile_warehouse())=any(delivery_warehouse_ids)) and
 status in ('ordered','in_transit','partially_received','received','invoiced','closed'));
alter policy purchase_items_depositor_read on public.purchase_items using (exists(select 1 from public.purchases p where p.id=purchase_id));
alter policy purchase_documents_depositor_read on public.purchase_documents using (exists(select 1 from public.purchases p where p.id=purchase_id));
alter policy purchase_docs_read on storage.objects using (bucket_id='purchase-documents' and
 ((select public.current_profile_role())='admin' or ((select public.current_profile_role())='depositor' and exists(select 1 from public.purchases p where p.id::text=split_part(storage.objects.name,'/',1)))));
alter policy purchase_docs_depositor_insert on storage.objects with check (bucket_id='purchase-documents' and
 (select public.current_profile_role())='depositor' and exists(select 1 from public.purchases p where p.id::text=split_part(storage.objects.name,'/',1)));

CREATE OR REPLACE FUNCTION public.receive_purchase(p_purchase_id uuid, p_items jsonb, p_notes text DEFAULT NULL::text, p_document_number text DEFAULT NULL::text, p_document_date date DEFAULT NULL::date, p_file_path text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_p public.purchases%rowtype;
  v_item jsonb;
  v_pi public.purchase_items%rowtype;
  v_qty numeric;
  v_receipt uuid;
  v_existing_purchase uuid;
  v_doc uuid;
  v_move uuid;
  v_stock_items jsonb:='[]'::jsonb;
  v_all_received boolean;
  v_request_id uuid;
  v_warehouse uuid;
  v_cancelled boolean;
begin
  if coalesce(public.current_profile_role() in ('depositor','admin'),false) is not true then raise exception 'Usuario no autorizado para recibir compras.'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Indicá al menos una cantidad recibida.'; end if;
  v_request_id := nullif(p_items->0->>'request_id','')::uuid;

  if v_request_id is not null then
    select id,purchase_id into v_receipt,v_existing_purchase
    from public.purchase_receipts
    where received_by=auth.uid() and client_request_id=v_request_id;
    if v_receipt is not null then
      if v_existing_purchase<>p_purchase_id then raise exception 'La misma operación ya fue utilizada en otra recepción.'; end if;
      return v_receipt;
    end if;
  end if;

  -- Lock submitted items first, in a deterministic order, then the purchase.
  -- This matches admin_update_purchase_item (item -> purchase) and avoids lock inversion.
  perform 1
  from public.purchase_items pi
  where pi.purchase_id=p_purchase_id
    and pi.id in (
      select distinct (x->>'purchase_item_id')::uuid
      from jsonb_array_elements(p_items) x
    )
  order by pi.id
  for update;

  select * into v_p from public.purchases where id=p_purchase_id for update;
  if not found then raise exception 'Compra inexistente.'; end if;

  if v_request_id is not null then
    select id,purchase_id into v_receipt,v_existing_purchase
    from public.purchase_receipts
    where received_by=auth.uid() and client_request_id=v_request_id;
    if v_receipt is not null then
      if v_existing_purchase<>p_purchase_id then raise exception 'La misma operación ya fue utilizada en otra recepción.'; end if;
      return v_receipt;
    end if;
  end if;

  if v_p.destination_type<>'warehouse' or v_p.warehouse_id is null then raise exception 'Esta compra no requiere recepción de depósito.'; end if;
  v_warehouse:=case when public.current_profile_role()='depositor' then public.current_profile_warehouse()
    else coalesce(nullif(p_items->0->>'warehouse_id','')::uuid,v_p.warehouse_id) end;
  if v_warehouse is null or not (v_warehouse=v_p.warehouse_id or v_warehouse=any(v_p.delivery_warehouse_ids)) or
    not exists(select 1 from public.warehouses w where w.id=v_warehouse and w.active) or
    exists(select 1 from jsonb_array_elements(p_items) x where x ? 'warehouse_id' and (x->>'warehouse_id')::uuid is distinct from v_warehouse)
  then raise exception 'Esta OC no está habilitada para recibir en este depósito.';end if;
  perform public.assert_can_access_warehouse(v_warehouse);
  if v_p.status not in ('ordered','in_transit','partially_received') then raise exception 'La compra no está disponible para recepción.'; end if;

  if p_file_path is not null or p_document_number is not null then
    insert into public.documents(supplier_id,document_type,document_number,document_date,currency,exchange_rate,file_path,uploaded_by)
    values(v_p.supplier_id,'remito',p_document_number,coalesce(p_document_date,current_date),v_p.currency,v_p.exchange_rate,p_file_path,auth.uid())
    returning id into v_doc;
  end if;

  insert into public.purchase_receipts(purchase_id,warehouse_id,received_by,document_id,notes,client_request_id)
  values(p_purchase_id,v_warehouse,auth.uid(),v_doc,p_notes,v_request_id)
  returning id into v_receipt;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_pi
    from public.purchase_items
    where id=(v_item->>'purchase_item_id')::uuid and purchase_id=p_purchase_id
    for update;
    if not found then raise exception 'Ítem de compra inválido.'; end if;
    v_qty:=(v_item->>'quantity')::numeric;
    if v_qty is null or v_qty<=0 then raise exception 'Cantidad recibida inválida.'; end if;
    if v_pi.received_qty+v_qty+v_pi.cancelled_qty>v_pi.quantity then raise exception 'La recepción supera la cantidad comprada para %.',v_pi.description; end if;
    insert into public.purchase_receipt_items(receipt_id,purchase_item_id,quantity)
    values(v_receipt,v_pi.id,v_qty);
    update public.purchase_items set received_qty=received_qty+v_qty where id=v_pi.id;
    if v_pi.affects_inventory then
      v_stock_items:=v_stock_items || jsonb_build_array(jsonb_build_object(
        'product_id',v_pi.product_id,
        'quantity',v_qty,
        'unit',v_pi.unit,
        'factor_to_base',v_pi.factor_to_base,
        'unit_cost',v_pi.unit_price,
        'currency',v_p.currency,
        'exchange_rate',v_p.exchange_rate,
        'presentation_label',v_pi.unit,
        'lot_reference',coalesce(nullif(v_item->>'lot_reference',''),v_p.order_reference)
      ));
    end if;
  end loop;

  if jsonb_array_length(v_stock_items)>0 then
    v_move:=public.record_entry(
      v_warehouse,
      v_p.supplier_id,
      v_doc,
      v_stock_items,
      concat('Recepción de compra',case when v_p.order_reference is not null then ' · '||v_p.order_reference else '' end,case when p_notes is not null then ' · '||p_notes else '' end)
    );
    update public.purchase_receipts set movement_id=v_move where id=v_receipt;
  end if;

  select bool_and(received_qty+cancelled_qty>=quantity),bool_or(cancelled_qty>0) into v_all_received,v_cancelled
  from public.purchase_items
  where purchase_id=p_purchase_id;

  update public.purchases
  set status=case when v_all_received and v_cancelled then 'closed' when v_all_received then 'received' else 'partially_received' end,
      updated_at=now()
  where id=p_purchase_id;
  return v_receipt;
end
$function$;


create or replace function public.sync_purchase_receipt_status_from_items()
returns trigger language plpgsql security definer set search_path='public' as $$
declare pid uuid; pending boolean; cancelled boolean; received boolean; state text; target text;
begin
 pid:=coalesce(new.purchase_id,old.purchase_id);
 select status into state from public.purchases where id=pid;
 if state is null or state not in ('ordered','in_transit','partially_received','received','invoiced','closed') then return coalesce(new,old);end if;
 select coalesce(bool_or(received_qty+cancelled_qty<quantity),false),coalesce(bool_or(cancelled_qty>0),false),coalesce(bool_or(received_qty>0),false)
 into pending,cancelled,received from public.purchase_items where purchase_id=pid;
 target:=state;
 if pending and state in ('received','closed') then target:=case when received then 'partially_received' else 'ordered' end;
 elsif not pending and cancelled then target:='closed';
 elsif not pending and state='partially_received' then target:='received';end if;
 if target<>state then update public.purchases set status=target,updated_at=now() where id=pid;end if;
 return coalesce(new,old);
end $$;
drop trigger if exists trg_sync_purchase_receipt_status_from_items on public.purchase_items;
create trigger trg_sync_purchase_receipt_status_from_items after insert or update of quantity,received_qty,cancelled_qty on public.purchase_items
for each row execute function public.sync_purchase_receipt_status_from_items();

CREATE OR REPLACE FUNCTION public.admin_void_purchase_receipt(p_receipt_id uuid, p_reason text DEFAULT NULL::text)
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
  v_cancelled boolean;
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


  SELECT *
    INTO v_purchase
    FROM public.purchases
   WHERE id = v_receipt.purchase_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Compra inexistente.';
  END IF;

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
         coalesce(bool_and(received_qty+cancelled_qty >= quantity), false),coalesce(bool_or(cancelled_qty>0),false)
    INTO v_any_received, v_all_received,v_cancelled
    FROM public.purchase_items
   WHERE purchase_id = v_receipt.purchase_id;

  IF v_all_received THEN
    v_restore_status := case when v_cancelled then 'closed' else 'received' end;
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


CREATE OR REPLACE FUNCTION public.admin_update_purchase(p_purchase_id uuid, p_patch jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_old public.purchases%rowtype; v_status text; v_wh uuid; v_dest text;
  v_any_received boolean; v_all_received boolean; v_delivery_mode text;
begin
  if public.current_profile_role() IS DISTINCT FROM 'admin' then raise exception 'Solo el administrador puede modificar compras.'; end if;
  select * into v_old from public.purchases where id=p_purchase_id for update;
  if not found then raise exception 'Compra inexistente.'; end if;
  select coalesce(bool_or(received_qty>0),false),coalesce(bool_and(received_qty+cancelled_qty>=quantity),false)
    into v_any_received,v_all_received from public.purchase_items where purchase_id=p_purchase_id;
  v_status:=coalesce(nullif(p_patch->>'status',''),v_old.status);
  v_dest:=coalesce(nullif(p_patch->>'destination_type',''),v_old.destination_type);
  v_wh:=case when p_patch ? 'warehouse_id' then nullif(p_patch->>'warehouse_id','')::uuid else v_old.warehouse_id end;
  v_delivery_mode:=case when p_patch ? 'delivery_mode' then coalesce(nullif(p_patch->>'delivery_mode',''),'single') else v_old.delivery_mode end;
  if v_delivery_mode not in ('single','partial') then raise exception 'Modalidad de entrega inválida.'; end if;
  if v_dest='warehouse' and v_wh is null then raise exception 'La compra para depósito necesita un depósito de destino.'; end if;
  if v_any_received and (p_patch ? 'destination_type' or p_patch ? 'warehouse_id' or p_patch ? 'company_id' or p_patch ? 'supplier_id' or p_patch ? 'currency') then
    raise exception 'Esta compra ya tiene recepción. No se puede cambiar empresa, proveedor, moneda ni destino.';
  end if;
  if v_status in ('partially_received','received') and v_status<>v_old.status then raise exception 'El estado de recepción lo controla el depósito automáticamente.'; end if;
  if v_status='cancelled' and v_any_received then raise exception 'No se puede cancelar una compra que ya tuvo mercadería recibida. Cerrala o dejá registrado el pendiente.'; end if;
  if v_any_received and v_status in ('draft','requested','quoted','approved') then raise exception 'No se puede volver a un estado anterior después de una recepción.'; end if;
  if v_dest='warehouse' and v_status in ('invoiced','closed') and not v_all_received then raise exception 'Todavía hay cantidades pendientes de recibir. Podés cargar la factura, pero no cerrar/facturar el estado operativo todavía.'; end if;
  if p_patch ? 'company_id' and not exists(select 1 from public.purchase_companies where id=nullif(p_patch->>'company_id','')::uuid and active) then raise exception 'Empresa inválida.'; end if;
  if v_wh is not null and not exists(select 1 from public.warehouses where id=v_wh and active) then raise exception 'Depósito inválido o inactivo.'; end if;
  update public.purchases set
    company_id=coalesce(nullif(p_patch->>'company_id','')::uuid,company_id),
    supplier_id=case when p_patch ? 'supplier_id' then nullif(p_patch->>'supplier_id','')::uuid else supplier_id end,
    purchase_type=coalesce(nullif(p_patch->>'purchase_type',''),purchase_type),
    status=v_status,
    urgency=coalesce(nullif(p_patch->>'urgency',''),urgency),
    destination_type=v_dest,
    warehouse_id=case when p_patch ? 'warehouse_id' then nullif(p_patch->>'warehouse_id','')::uuid else warehouse_id end,
    barge_id=case when p_patch ? 'barge_id' then nullif(p_patch->>'barge_id','')::uuid else barge_id end,
    contractor_id=case when p_patch ? 'contractor_id' then nullif(p_patch->>'contractor_id','')::uuid else contractor_id end,
    destination_text=case when p_patch ? 'destination_text' then nullif(p_patch->>'destination_text','') else destination_text end,
    requester=case when p_patch ? 'requester' then nullif(p_patch->>'requester','') else requester end,
    sector=case when p_patch ? 'sector' then nullif(p_patch->>'sector','') else sector end,
    currency=coalesce(nullif(p_patch->>'currency',''),currency),
    exchange_rate=case when p_patch ? 'exchange_rate' then nullif(p_patch->>'exchange_rate','')::numeric else exchange_rate end,
    payment_method=case when p_patch ? 'payment_method' then nullif(p_patch->>'payment_method','') else payment_method end,
    payment_terms=case when p_patch ? 'payment_terms' then nullif(p_patch->>'payment_terms','') else payment_terms end,
    order_reference=case when p_patch ? 'order_reference' then nullif(p_patch->>'order_reference','') else order_reference end,
    ordered_date=coalesce(nullif(p_patch->>'ordered_date','')::date,ordered_date),
    expected_date=case when p_patch ? 'expected_date' then nullif(p_patch->>'expected_date','')::date else expected_date end,
    invoice_number=case when p_patch ? 'invoice_number' then nullif(p_patch->>'invoice_number','') else invoice_number end,
    invoice_date=case when p_patch ? 'invoice_date' then nullif(p_patch->>'invoice_date','')::date else invoice_date end,
    notes=case when p_patch ? 'notes' then nullif(p_patch->>'notes','') else notes end,
    delivery_mode=v_delivery_mode,
    updated_at=now()
  where id=p_purchase_id;
end
$function$;

CREATE OR REPLACE FUNCTION public.notify_purchase_warehouse()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.destination_type='warehouse' and new.warehouse_id is not null and new.status in ('ordered','in_transit','partially_received') and (tg_op='INSERT' or old.status is distinct from new.status or old.warehouse_id is distinct from new.warehouse_id or old.delivery_warehouse_ids is distinct from new.delivery_warehouse_ids) then
    insert into public.notifications(user_id,kind,title,body,metadata,dedupe_key)
    select pr.id,'purchase_receipt','Compra pendiente de recepción',concat(coalesce((select name from public.suppliers where id=new.supplier_id),'Proveedor sin definir'),' · ',coalesce((select name from public.purchase_companies where id=new.company_id),'Compra'),' · ',new.status),jsonb_build_object('purchase_id',new.id,'warehouse_id',pr.warehouse_id),concat('purchase:',new.id,':',new.status,':',pr.id)
    from public.profiles pr where pr.role='depositor' and pr.active and (pr.warehouse_id=new.warehouse_id or pr.warehouse_id=any(new.delivery_warehouse_ids))
    on conflict do nothing;
  end if;
  return new;
end $function$;


create or replace view public.v_purchase_alerts with (security_invoker=true) as
 SELECT p.id AS purchase_id,
    p.company_id,
    c.name AS company_name,
    p.supplier_id,
    s.name AS supplier_name,
    p.warehouse_id,
    w.name AS warehouse_name,
    p.status,
    p.urgency,
    p.ordered_date,
    p.expected_date,
    p.currency,
    COALESCE(sum((GREATEST((pi.quantity - pi.received_qty - pi.cancelled_qty), (0)::numeric) * pi.unit_price)), (0)::numeric) AS pending_amount,
    (count(pi.id) FILTER (WHERE (pi.received_qty+pi.cancelled_qty < pi.quantity)))::integer AS pending_items,
        CASE
            WHEN (p.expected_date IS NULL) THEN 0
            ELSE GREATEST((CURRENT_DATE - p.expected_date), 0)
        END AS days_late,
        CASE
            WHEN (p.urgency = 'critical'::text) THEN 'critical'::text
            WHEN ((p.expected_date < CURRENT_DATE) AND (EXISTS ( SELECT 1
               FROM purchase_items x
              WHERE ((x.purchase_id = p.id) AND (x.received_qty+x.cancelled_qty < x.quantity))))) THEN 'critical'::text
            WHEN (p.urgency = 'urgent'::text) THEN 'warning'::text
            ELSE 'info'::text
        END AS alert_level
   FROM ((((purchases p
     JOIN purchase_companies c ON ((c.id = p.company_id)))
     LEFT JOIN suppliers s ON ((s.id = p.supplier_id)))
     LEFT JOIN warehouses w ON ((w.id = p.warehouse_id)))
     LEFT JOIN purchase_items pi ON ((pi.purchase_id = p.id)))
  WHERE ((p.destination_type = 'warehouse'::text) AND (p.status = ANY (ARRAY['ordered'::text, 'in_transit'::text, 'partially_received'::text])))
  GROUP BY p.id, c.name, s.name, w.name;

create or replace view public.v_purchase_overview with (security_invoker=true) as
 SELECT p.id,
    p.company_id,
    c.name AS company_name,
    p.supplier_id,
    s.name AS supplier_name,
    p.purchase_type,
    p.status,
    p.urgency,
    p.destination_type,
    p.warehouse_id,
    w.name AS warehouse_name,
    p.barge_id,
    b.number AS barge_number,
    p.contractor_id,
    ct.name AS contractor_name,
    p.destination_text,
    p.requester,
    p.sector,
    p.currency,
    p.exchange_rate,
    p.payment_method,
    p.payment_terms,
    p.order_reference,
    p.ordered_date,
    p.expected_date,
    p.invoice_number,
    p.invoice_date,
    p.notes,
    p.created_by,
    p.created_at,
    p.updated_at,
    COALESCE(sum((pi.quantity * pi.unit_price)), (0)::numeric) AS total_amount,
    COALESCE(sum((pi.received_qty * pi.unit_price)), (0)::numeric) AS received_amount,
    COALESCE(sum(pi.quantity), (0)::numeric) AS item_units,
    COALESCE(sum(pi.received_qty), (0)::numeric) AS received_units,
    (count(pi.id))::integer AS item_count,
    p.po_number,
    p.po_generated_at,
    p.purchase_confirmed_at,
    p.source_document_number,
    p.source_document_date,
    p.source_document_kind,
    p.delivery_mode,
    p.delivery_warehouse_ids,
    coalesce(sum(pi.cancelled_qty*pi.unit_price),0)::numeric as cancelled_amount,
    coalesce(sum(greatest(pi.quantity-pi.received_qty-pi.cancelled_qty,0)*pi.unit_price),0)::numeric as pending_amount
   FROM ((((((purchases p
     JOIN purchase_companies c ON ((c.id = p.company_id)))
     LEFT JOIN suppliers s ON ((s.id = p.supplier_id)))
     LEFT JOIN warehouses w ON ((w.id = p.warehouse_id)))
     LEFT JOIN barges b ON ((b.id = p.barge_id)))
     LEFT JOIN contractors ct ON ((ct.id = p.contractor_id)))
     LEFT JOIN purchase_items pi ON ((pi.purchase_id = p.id)))
  GROUP BY p.id, c.name, s.name, w.name, b.number, ct.name;

do $views$
declare name text; definition text;
begin
 foreach name in array array['bi_purchase_facts','bi_purchase_item_facts','v_smart_stock_alerts','v_data_quality_issues'] loop
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=name and c.relkind='v') then
   definition:=pg_get_viewdef(format('public.%I',name)::regclass,true);
   definition:=replace(definition,'pi.quantity - pi.received_qty','pi.quantity - pi.received_qty - pi.cancelled_qty');
   definition:=replace(definition,'pi.quantity - COALESCE(pi.received_qty, 0::numeric)','pi.quantity - COALESCE(pi.received_qty, 0::numeric) - pi.cancelled_qty');
   definition:=replace(definition,'pi.received_qty < pi.quantity','pi.received_qty+pi.cancelled_qty < pi.quantity');
   if name='v_smart_stock_alerts' then
    definition:=replace(definition,'p.destination_type = ''warehouse''::text', 'p.destination_type = ''warehouse''::text AND cardinality(p.delivery_warehouse_ids)<=1');
   end if;
   execute format('create or replace view public.%I with (security_invoker=true) as %s',name,definition);
  end if;
 end loop;
end $views$;
revoke all on function public.sync_purchase_receipt_status_from_items() from public,anon,authenticated;

revoke all on function public.receive_purchase(uuid,jsonb,text,text,date,text),public.admin_void_purchase_receipt(uuid,text),public.admin_update_purchase(uuid,jsonb) from public,anon;
grant execute on function public.receive_purchase(uuid,jsonb,text,text,date,text),public.admin_void_purchase_receipt(uuid,text),public.admin_update_purchase(uuid,jsonb) to authenticated;
revoke all on function public.notify_purchase_warehouse() from public,anon,authenticated;
