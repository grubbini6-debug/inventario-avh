-- Hardening operativo previo a salida a producción de depósitos.
-- Sin cambios de UX: protege concurrencia, reintentos y escritura directa.

alter table public.movements
  add column if not exists client_request_id uuid;

alter table public.purchase_receipts
  add column if not exists client_request_id uuid;

create unique index if not exists movements_actor_type_request_uidx
  on public.movements(created_by, type, client_request_id)
  where client_request_id is not null;

create unique index if not exists purchase_receipts_actor_request_uidx
  on public.purchase_receipts(received_by, client_request_id)
  where client_request_id is not null;

revoke insert, update, delete on table public.purchase_receipt_items from anon, authenticated;

create or replace function public.record_entry(
  p_warehouse_id uuid,
  p_supplier_id uuid,
  p_document_id uuid,
  p_items jsonb,
  p_notes text default null::text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_movement uuid;
  v_item jsonb;
  v_line uuid;
  v_product uuid;
  v_qty numeric;
  v_unit text;
  v_factor numeric;
  v_base numeric;
  v_cost_present numeric;
  v_cost_base numeric;
  v_currency text;
  v_fx numeric;
  v_request_id uuid;
begin
  perform public.assert_can_access_warehouse(p_warehouse_id);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then
    raise exception 'Agregá al menos un producto';
  end if;
  v_request_id := nullif(p_items->0->>'request_id','')::uuid;

  insert into public.movements(type,status,warehouse_to_id,supplier_id,document_id,notes,created_by,client_request_id)
  values('entry','confirmed',p_warehouse_id,p_supplier_id,p_document_id,p_notes,auth.uid(),v_request_id)
  on conflict (created_by,type,client_request_id) where client_request_id is not null do nothing
  returning id into v_movement;

  if v_movement is null and v_request_id is not null then
    select id into v_movement
    from public.movements
    where created_by=auth.uid() and type='entry' and client_request_id=v_request_id;
    if v_movement is not null then return v_movement; end if;
    raise exception 'No se pudo confirmar la entrada. Volvé a intentar.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product=(v_item->>'product_id')::uuid;
    v_qty=(v_item->>'quantity')::numeric;
    if not exists(select 1 from public.products where id=v_product and active=true) then
      raise exception 'Producto inexistente o inactivo.';
    end if;
    v_unit=coalesce(nullif(v_item->>'unit',''),(select base_unit from public.products where id=v_product));
    v_factor=coalesce(nullif(v_item->>'factor_to_base','')::numeric,1);
    v_base=v_qty*v_factor;
    v_cost_present=nullif(v_item->>'unit_cost','')::numeric;
    v_cost_base=case when v_cost_present is null then null else v_cost_present/v_factor end;
    v_currency=nullif(v_item->>'currency','');
    v_fx=nullif(v_item->>'exchange_rate','')::numeric;
    if v_qty is null or v_qty<=0 or v_factor<=0 then raise exception 'Cantidad o conversión inválida'; end if;
    insert into public.movement_lines(movement_id,product_id,quantity,unit,factor_to_base,presentation_label,entry_unit_cost,entry_currency,exchange_rate)
    values(v_movement,v_product,v_qty,v_unit,v_factor,nullif(v_item->>'presentation_label',''),v_cost_present,v_currency,v_fx)
    returning id into v_line;
    insert into public.inventory_batches(warehouse_id,product_id,source_line_id,quantity_received,quantity_remaining,unit_cost,currency,exchange_rate,lot_reference)
    values(p_warehouse_id,v_product,v_line,v_base,v_base,v_cost_base,v_currency,v_fx,nullif(v_item->>'lot_reference',''));
  end loop;
  return v_movement;
end
$function$;

create or replace function public.record_exit(
  p_warehouse_id uuid,
  p_barge_id uuid,
  p_contractor_id uuid,
  p_person_receiving text,
  p_destination text,
  p_items jsonb,
  p_notes text default null::text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_movement uuid;
  v_item jsonb;
  v_line uuid;
  v_product uuid;
  v_qty numeric;
  v_unit text;
  v_factor numeric;
  v_need numeric;
  v_take numeric;
  v_batch record;
  v_request_id uuid;
begin
  perform public.assert_can_access_warehouse(p_warehouse_id);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then
    raise exception 'Agregá al menos un producto';
  end if;
  v_request_id := nullif(p_items->0->>'request_id','')::uuid;

  perform 1
  from public.inventory_batches b
  where b.warehouse_id=p_warehouse_id
    and b.product_id in (
      select distinct (x->>'product_id')::uuid
      from jsonb_array_elements(p_items) x
    )
    and b.quantity_remaining>0
  order by b.product_id,b.received_at,b.created_at,b.id
  for update;

  insert into public.movements(type,status,warehouse_from_id,barge_id,contractor_id,person_receiving,destination,destination_text,notes,created_by,client_request_id)
  values('exit','confirmed',p_warehouse_id,p_barge_id,p_contractor_id,p_person_receiving,p_destination,p_destination,p_notes,auth.uid(),v_request_id)
  on conflict (created_by,type,client_request_id) where client_request_id is not null do nothing
  returning id into v_movement;

  if v_movement is null and v_request_id is not null then
    select id into v_movement
    from public.movements
    where created_by=auth.uid() and type='exit' and client_request_id=v_request_id;
    if v_movement is not null then return v_movement; end if;
    raise exception 'No se pudo confirmar la salida. Volvé a intentar.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product=(v_item->>'product_id')::uuid;
    v_qty=(v_item->>'quantity')::numeric;
    v_unit=coalesce(nullif(v_item->>'unit',''),(select base_unit from public.products where id=v_product));
    v_factor=coalesce(nullif(v_item->>'factor_to_base','')::numeric,1);
    v_need=v_qty*v_factor;
    if v_qty is null or v_qty<=0 or v_factor<=0 then raise exception 'Cantidad o conversión inválida'; end if;
    if coalesce((select sum(quantity_remaining) from public.inventory_batches where warehouse_id=p_warehouse_id and product_id=v_product),0)<v_need then
      raise exception 'Stock insuficiente';
    end if;
    insert into public.movement_lines(movement_id,product_id,quantity,unit,factor_to_base,presentation_label)
    values(v_movement,v_product,v_qty,v_unit,v_factor,nullif(v_item->>'presentation_label',''))
    returning id into v_line;
    for v_batch in
      select *
      from public.inventory_batches
      where warehouse_id=p_warehouse_id and product_id=v_product and quantity_remaining>0
      order by received_at,created_at,id
      for update
    loop
      exit when v_need<=0;
      v_take=least(v_need,v_batch.quantity_remaining);
      update public.inventory_batches set quantity_remaining=quantity_remaining-v_take where id=v_batch.id;
      insert into public.batch_allocations(movement_line_id,batch_id,quantity,unit_cost,currency,exchange_rate)
      values(v_line,v_batch.id,v_take,v_batch.unit_cost,v_batch.currency,v_batch.exchange_rate);
      v_need=v_need-v_take;
    end loop;
    if v_need>0 then
      raise exception 'El stock cambió mientras confirmabas. Actualizá y volvé a intentar.';
    end if;
  end loop;
  return v_movement;
end
$function$;

create or replace function public.record_transfer(
  p_from_warehouse_id uuid,
  p_to_warehouse_id uuid,
  p_items jsonb,
  p_notes text default null::text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_movement uuid;
  v_item jsonb;
  v_line uuid;
  v_product uuid;
  v_qty numeric;
  v_unit text;
  v_factor numeric;
  v_need numeric;
  v_take numeric;
  v_batch record;
  v_request_id uuid;
begin
  perform public.assert_can_access_warehouse(p_from_warehouse_id);
  if p_from_warehouse_id=p_to_warehouse_id then raise exception 'Origen y destino iguales'; end if;
  if not exists(select 1 from public.warehouses where id=p_to_warehouse_id and active=true) then raise exception 'El depósito de destino no existe o está inactivo.'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then raise exception 'Agregá al menos un producto'; end if;
  v_request_id := nullif(p_items->0->>'request_id','')::uuid;

  perform 1
  from public.inventory_batches b
  where b.warehouse_id=p_from_warehouse_id
    and b.product_id in (
      select distinct (x->>'product_id')::uuid
      from jsonb_array_elements(p_items) x
    )
    and b.quantity_remaining>0
  order by b.product_id,b.received_at,b.created_at,b.id
  for update;

  insert into public.movements(type,status,warehouse_from_id,warehouse_to_id,notes,created_by,client_request_id)
  values('transfer','in_transit',p_from_warehouse_id,p_to_warehouse_id,p_notes,auth.uid(),v_request_id)
  on conflict (created_by,type,client_request_id) where client_request_id is not null do nothing
  returning id into v_movement;

  if v_movement is null and v_request_id is not null then
    select id into v_movement
    from public.movements
    where created_by=auth.uid() and type='transfer' and client_request_id=v_request_id;
    if v_movement is not null then return v_movement; end if;
    raise exception 'No se pudo confirmar la transferencia. Volvé a intentar.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product=(v_item->>'product_id')::uuid;
    v_qty=(v_item->>'quantity')::numeric;
    if not exists(select 1 from public.products where id=v_product and active=true) then raise exception 'Producto inexistente o inactivo.'; end if;
    v_unit=coalesce(nullif(v_item->>'unit',''),(select base_unit from public.products where id=v_product));
    v_factor=coalesce(nullif(v_item->>'factor_to_base','')::numeric,1);
    v_need=v_qty*v_factor;
    if v_qty is null or v_qty<=0 or v_factor<=0 then raise exception 'Cantidad o conversión inválida'; end if;
    if coalesce((select sum(quantity_remaining) from public.inventory_batches where warehouse_id=p_from_warehouse_id and product_id=v_product),0)<v_need then
      raise exception 'Stock insuficiente para transferencia';
    end if;
    insert into public.movement_lines(movement_id,product_id,quantity,unit,factor_to_base,presentation_label)
    values(v_movement,v_product,v_qty,v_unit,v_factor,nullif(v_item->>'presentation_label',''))
    returning id into v_line;
    for v_batch in
      select *
      from public.inventory_batches
      where warehouse_id=p_from_warehouse_id and product_id=v_product and quantity_remaining>0
      order by received_at,created_at,id
      for update
    loop
      exit when v_need<=0;
      v_take=least(v_need,v_batch.quantity_remaining);
      update public.inventory_batches set quantity_remaining=quantity_remaining-v_take where id=v_batch.id;
      insert into public.batch_allocations(movement_line_id,batch_id,quantity,unit_cost,currency,exchange_rate)
      values(v_line,v_batch.id,v_take,v_batch.unit_cost,v_batch.currency,v_batch.exchange_rate);
      v_need=v_need-v_take;
    end loop;
    if v_need>0 then
      raise exception 'El stock cambió mientras confirmabas. Actualizá y volvé a intentar.';
    end if;
  end loop;
  return v_movement;
end
$function$;

create or replace function public.record_return(
  p_warehouse_id uuid,
  p_barge_id uuid,
  p_contractor_id uuid,
  p_person_returning text,
  p_items jsonb,
  p_notes text default null::text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_movement uuid;
  v_item jsonb;
  v_line uuid;
  v_product uuid;
  v_qty numeric;
  v_unit text;
  v_factor numeric;
  v_base numeric;
  v_cost numeric;
  v_currency text;
  v_fx numeric;
  v_request_id uuid;
begin
  perform public.assert_can_access_warehouse(p_warehouse_id);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then raise exception 'Agregá al menos un producto'; end if;
  v_request_id := nullif(p_items->0->>'request_id','')::uuid;

  insert into public.movements(type,status,warehouse_to_id,barge_id,contractor_id,person_receiving,notes,created_by,client_request_id)
  values('return','confirmed',p_warehouse_id,p_barge_id,p_contractor_id,p_person_returning,p_notes,auth.uid(),v_request_id)
  on conflict (created_by,type,client_request_id) where client_request_id is not null do nothing
  returning id into v_movement;

  if v_movement is null and v_request_id is not null then
    select id into v_movement
    from public.movements
    where created_by=auth.uid() and type='return' and client_request_id=v_request_id;
    if v_movement is not null then return v_movement; end if;
    raise exception 'No se pudo confirmar la devolución. Volvé a intentar.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product=(v_item->>'product_id')::uuid;
    v_qty=(v_item->>'quantity')::numeric;
    if not exists(select 1 from public.products where id=v_product and active=true) then raise exception 'Producto inexistente o inactivo.'; end if;
    v_unit=coalesce(nullif(v_item->>'unit',''),(select base_unit from public.products where id=v_product));
    v_factor=coalesce(nullif(v_item->>'factor_to_base','')::numeric,1);
    v_base=v_qty*v_factor;
    v_cost=case when nullif(v_item->>'unit_cost','') is null then null else (v_item->>'unit_cost')::numeric/v_factor end;
    v_currency=nullif(v_item->>'currency','');
    v_fx=nullif(v_item->>'exchange_rate','')::numeric;
    if v_qty is null or v_qty<=0 or v_factor<=0 then raise exception 'Cantidad inválida'; end if;
    insert into public.movement_lines(movement_id,product_id,quantity,unit,factor_to_base,presentation_label,entry_unit_cost,entry_currency,exchange_rate)
    values(v_movement,v_product,v_qty,v_unit,v_factor,nullif(v_item->>'presentation_label',''),nullif(v_item->>'unit_cost','')::numeric,v_currency,v_fx)
    returning id into v_line;
    insert into public.inventory_batches(warehouse_id,product_id,source_line_id,quantity_received,quantity_remaining,unit_cost,currency,exchange_rate,lot_reference)
    values(p_warehouse_id,v_product,v_line,v_base,v_base,v_cost,v_currency,v_fx,'DEVOLUCION');
  end loop;
  return v_movement;
end
$function$;

create or replace function public.record_initial_inventory(
  p_warehouse_id uuid,
  p_items jsonb,
  p_notes text default null::text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session uuid;
  v_movement uuid;
  v_item jsonb;
  v_line uuid;
  v_product uuid;
  v_qty numeric;
  v_unit text;
  v_factor numeric;
  v_base numeric;
  v_request_id uuid;
begin
  perform public.assert_can_access_warehouse(p_warehouse_id);
  select id into v_session
  from public.warehouse_opening_inventory
  where warehouse_id=p_warehouse_id and status='open';
  if v_session is null then raise exception 'El inventario inicial de este depósito no está abierto por administración.'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Agregá al menos un producto.'; end if;
  v_request_id := nullif(p_items->0->>'request_id','')::uuid;

  insert into public.movements(type,status,warehouse_to_id,notes,opening_session_id,created_by,client_request_id)
  values('initial','confirmed',p_warehouse_id,p_notes,v_session,auth.uid(),v_request_id)
  on conflict (created_by,type,client_request_id) where client_request_id is not null do nothing
  returning id into v_movement;

  if v_movement is null and v_request_id is not null then
    select id into v_movement
    from public.movements
    where created_by=auth.uid() and type='initial' and client_request_id=v_request_id;
    if v_movement is not null then return v_movement; end if;
    raise exception 'No se pudo confirmar el inventario inicial. Volvé a intentar.';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product=(v_item->>'product_id')::uuid;
    v_qty=(v_item->>'quantity')::numeric;
    v_unit=coalesce(nullif(v_item->>'unit',''),(select base_unit from public.products where id=v_product));
    v_factor=coalesce(nullif(v_item->>'factor_to_base','')::numeric,1);
    v_base=v_qty*v_factor;
    if not exists(select 1 from public.products where id=v_product and active=true) then raise exception 'Producto inexistente o inactivo.'; end if;
    if v_qty is null or v_qty<=0 or v_factor<=0 then raise exception 'Cantidad o conversión inválida.'; end if;
    insert into public.movement_lines(movement_id,product_id,quantity,unit,factor_to_base,presentation_label,entry_unit_cost,entry_currency,exchange_rate)
    values(v_movement,v_product,v_qty,v_unit,v_factor,nullif(v_item->>'presentation_label',''),null,null,null)
    returning id into v_line;
    insert into public.inventory_batches(warehouse_id,product_id,source_line_id,quantity_received,quantity_remaining,unit_cost,currency,exchange_rate,lot_reference)
    values(p_warehouse_id,v_product,v_line,v_base,v_base,null,null,null,nullif(v_item->>'lot_reference',''));
  end loop;

  insert into public.audit_events(entity_type,entity_id,action,actor_id,warehouse_id,detail)
  values('opening_inventory',v_session,'opening_inventory_count_added',auth.uid(),p_warehouse_id,
    jsonb_build_object('movement_id',v_movement,'line_count',jsonb_array_length(p_items)));
  return v_movement;
end
$function$;

create or replace function public.receive_purchase(
  p_purchase_id uuid,
  p_items jsonb,
  p_notes text default null::text,
  p_document_number text default null::text,
  p_document_date date default null::date,
  p_file_path text default null::text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
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
begin
  if public.current_profile_role() not in ('depositor','admin') then raise exception 'Usuario no autorizado para recibir compras.'; end if;
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
  perform public.assert_can_access_warehouse(v_p.warehouse_id);
  if v_p.status not in ('ordered','in_transit','partially_received') then raise exception 'La compra no está disponible para recepción.'; end if;

  if p_file_path is not null or p_document_number is not null then
    insert into public.documents(supplier_id,document_type,document_number,document_date,currency,exchange_rate,file_path,uploaded_by)
    values(v_p.supplier_id,'remito',p_document_number,coalesce(p_document_date,current_date),v_p.currency,v_p.exchange_rate,p_file_path,auth.uid())
    returning id into v_doc;
  end if;

  insert into public.purchase_receipts(purchase_id,warehouse_id,received_by,document_id,notes,client_request_id)
  values(p_purchase_id,v_p.warehouse_id,auth.uid(),v_doc,p_notes,v_request_id)
  returning id into v_receipt;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_pi
    from public.purchase_items
    where id=(v_item->>'purchase_item_id')::uuid and purchase_id=p_purchase_id
    for update;
    if not found then raise exception 'Ítem de compra inválido.'; end if;
    v_qty:=(v_item->>'quantity')::numeric;
    if v_qty is null or v_qty<=0 then raise exception 'Cantidad recibida inválida.'; end if;
    if v_pi.received_qty+v_qty>v_pi.quantity then raise exception 'La recepción supera la cantidad comprada para %.',v_pi.description; end if;
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
      v_p.warehouse_id,
      v_p.supplier_id,
      v_doc,
      v_stock_items,
      concat('Recepción de compra',case when v_p.order_reference is not null then ' · '||v_p.order_reference else '' end,case when p_notes is not null then ' · '||p_notes else '' end)
    );
    update public.purchase_receipts set movement_id=v_move where id=v_receipt;
  end if;

  select bool_and(received_qty>=quantity) into v_all_received
  from public.purchase_items
  where purchase_id=p_purchase_id;

  update public.purchases
  set status=case when v_all_received then 'received' else 'partially_received' end,
      updated_at=now()
  where id=p_purchase_id;
  return v_receipt;
end
$function$;
