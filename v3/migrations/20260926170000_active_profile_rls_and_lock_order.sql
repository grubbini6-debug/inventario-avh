-- Auditoría AVH: endurecimiento RLS para cuentas desactivadas.\n-- Mantiene frontend_assets como recurso público intencional.\n\ndrop policy if exists barges_read on public.barges;\ncreate policy barges_read on public.barges for select to authenticated using (exists (select 1 from public.profiles pr where pr.id=(select auth.uid()) and pr.active=true));\n\ndrop policy if exists contractors_read on public.contractors;\ncreate policy contractors_read on public.contractors for select to authenticated using (exists (select 1 from public.profiles pr where pr.id=(select auth.uid()) and pr.active=true));\n\ndrop policy if exists presentations_read on public.product_presentations;\ncreate policy presentations_read on public.product_presentations for select to authenticated using (exists (select 1 from public.profiles pr where pr.id=(select auth.uid()) and pr.active=true));\n\ndrop policy if exists suppliers_read on public.suppliers;\ncreate policy suppliers_read on public.suppliers for select to authenticated using (exists (select 1 from public.profiles pr where pr.id=(select auth.uid()) and pr.active=true));\n\ndrop policy if exists warehouses_read on public.warehouses;\ncreate policy warehouses_read on public.warehouses for select to authenticated using (exists (select 1 from public.profiles pr where pr.id=(select auth.uid()) and pr.active=true));\n\ndrop policy if exists products_read on public.products;\ncreate policy products_read on public.products for select to authenticated using (\n  exists (select 1 from public.profiles pr where pr.id=(select auth.uid()) and pr.active=true)\n  and (active=true or public.current_profile_role()='admin')\n);\n\ndrop policy if exists documents_insert on public.documents;\ncreate policy documents_insert on public.documents for insert to authenticated with check (\n  uploaded_by=(select auth.uid()) and exists (select 1 from public.profiles pr where pr.id=(select auth.uid()) and pr.active=true)\n);\n\ndrop policy if exists suppliers_insert on public.suppliers;\ncreate policy suppliers_insert on public.suppliers for insert to authenticated with check (\n  created_by=(select auth.uid()) and exists (select 1 from public.profiles pr where pr.id=(select auth.uid()) and pr.active=true)\n);\n\ndrop policy if exists notifications_read on public.notifications;\ncreate policy notifications_read on public.notifications for select to authenticated using (\n  user_id=(select auth.uid()) and exists (select 1 from public.profiles pr where pr.id=(select auth.uid()) and pr.active=true)\n);\n\ndrop policy if exists notifications_update on public.notifications;\ncreate policy notifications_update on public.notifications for update to authenticated\nusing (user_id=(select auth.uid()) and exists (select 1 from public.profiles pr where pr.id=(select auth.uid()) and pr.active=true))\nwith check (user_id=(select auth.uid()) and exists (select 1 from public.profiles pr where pr.id=(select auth.uid()) and pr.active=true));\n\n\n-- Concurrencia: inventario inicial y recepción de compras.\n\ncreate or replace function public.record_initial_inventory(
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
  where warehouse_id=p_warehouse_id and status='open'\n  for update;
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
$function$;\n\ncreate or replace function public.receive_purchase(
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

  -- Lock submitted items first, in a deterministic order, then the purchase.\n  -- This matches admin_update_purchase_item (item -> purchase) and avoids lock inversion.\n  perform 1\n  from public.purchase_items pi\n  where pi.purchase_id=p_purchase_id\n    and pi.id in (\n      select distinct (x->>'purchase_item_id')::uuid\n      from jsonb_array_elements(p_items) x\n    )\n  order by pi.id\n  for update;\n\n  select * into v_p from public.purchases where id=p_purchase_id for update;
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
$function$;\n