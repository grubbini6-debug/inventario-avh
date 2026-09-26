-- Audit 2026-09-26: reject missing/inactive profiles before privileged operations.
-- Definitions captured read-only from production; only role guards change.
-- No role, stock, pricing or purchase lifecycle rules are changed.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_close_initial_inventory(p_warehouse_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_lines int; v_unpriced int;
begin
  if public.current_profile_role() IS DISTINCT FROM 'admin' then raise exception 'Solo el administrador puede cerrar el inventario inicial.'; end if;
  select id into v_id from public.warehouse_opening_inventory where warehouse_id=p_warehouse_id and status='open' for update;
  if v_id is null then raise exception 'No hay un inventario inicial abierto para este depósito.'; end if;

  select count(*),
         count(*) filter (where ml.entry_unit_cost is null or ml.entry_currency is null)
    into v_lines,v_unpriced
  from public.movements m
  join public.movement_lines ml on ml.movement_id=m.id
  where m.opening_session_id=v_id and m.type='initial' and m.status<>'cancelled';

  if v_lines=0 then raise exception 'El depositario todavía no cargó productos en este inventario inicial.'; end if;
  if v_unpriced>0 then raise exception 'Faltan valorar % ítem(s) antes de cerrar.',v_unpriced; end if;

  update public.warehouse_opening_inventory
     set status='closed',closed_by=auth.uid(),closed_at=now(),updated_at=now()
   where id=v_id;

  insert into public.audit_events(entity_type,entity_id,action,actor_id,warehouse_id,detail)
  values('opening_inventory',v_id,'opening_inventory_closed',auth.uid(),p_warehouse_id,jsonb_build_object('line_count',v_lines));
end $function$;

CREATE OR REPLACE FUNCTION public.admin_confirm_purchase(p_purchase_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_purchase public.purchases%rowtype;
begin
  if public.current_profile_role() IS DISTINCT FROM 'admin' then raise exception 'Solo el administrador puede confirmar compras.'; end if;
  select * into v_purchase from public.purchases where id=p_purchase_id for update;
  if not found then raise exception 'Compra inexistente.'; end if;
  if v_purchase.po_number is null then raise exception 'Primero generá la Orden de Compra.'; end if;
  if v_purchase.status='cancelled' then raise exception 'La compra está cancelada.'; end if;
  if v_purchase.status in ('partially_received','received','invoiced','closed') then raise exception 'La compra ya avanzó a recepción/facturación.'; end if;
  if v_purchase.status='ordered' and v_purchase.purchase_confirmed_at is not null then return; end if;
  update public.purchases set status='ordered',ordered_date=current_date,purchase_confirmed_at=coalesce(purchase_confirmed_at,now()),updated_at=now() where id=p_purchase_id;
  insert into public.audit_events(entity_type,entity_id,purchase_id,action,actor_id,detail)
  values('purchase',p_purchase_id,p_purchase_id,'purchase_confirmed',auth.uid(),jsonb_build_object('po_number',v_purchase.po_number));
end$function$;

CREATE OR REPLACE FUNCTION public.admin_create_purchase(p_data jsonb, p_items jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid; v_item jsonb; v_dest text; v_wh uuid; v_status text; v_product uuid;
  v_supplier uuid; v_barge uuid; v_contractor uuid; v_delivery_mode text;
begin
  if public.current_profile_role() IS DISTINCT FROM 'admin' then raise exception 'Solo el administrador puede crear compras.'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Agregá al menos un ítem a la compra.'; end if;
  v_dest:=coalesce(nullif(p_data->>'destination_type',''),'warehouse');
  v_wh:=nullif(p_data->>'warehouse_id','')::uuid;
  v_status:=coalesce(nullif(p_data->>'status',''),'ordered');
  v_supplier:=nullif(p_data->>'supplier_id','')::uuid;
  v_barge:=nullif(p_data->>'barge_id','')::uuid;
  v_contractor:=nullif(p_data->>'contractor_id','')::uuid;
  v_delivery_mode:=coalesce(nullif(p_data->>'delivery_mode',''),'single');
  if v_delivery_mode not in ('single','partial') then raise exception 'Modalidad de entrega inválida.'; end if;
  if v_status not in ('draft','requested','quoted','approved','ordered','in_transit') then raise exception 'Estado inicial de compra inválido.'; end if;
  if v_dest='warehouse' and v_wh is null then raise exception 'Elegí el depósito de destino.'; end if;
  if not exists(select 1 from public.purchase_companies where id=(p_data->>'company_id')::uuid and active) then raise exception 'Empresa de pago inválida.'; end if;
  if v_supplier is not null and not exists(select 1 from public.suppliers where id=v_supplier) then raise exception 'Proveedor inválido.'; end if;
  if v_wh is not null and not exists(select 1 from public.warehouses where id=v_wh and active) then raise exception 'Depósito inválido o inactivo.'; end if;
  if v_barge is not null and not exists(select 1 from public.barges where id=v_barge and active) then raise exception 'Barcaza inválida o inactiva.'; end if;
  if v_contractor is not null and not exists(select 1 from public.contractors where id=v_contractor and active) then raise exception 'Contratista inválido o inactivo.'; end if;
  if v_dest<>'warehouse' and exists(select 1 from jsonb_array_elements(p_items) j where coalesce((j->>'affects_inventory')::boolean,false)) then
    raise exception 'Una compra que no va a depósito no puede marcar ítems para ingreso automático a stock.';
  end if;
  insert into public.purchases(
    company_id,supplier_id,purchase_type,status,urgency,destination_type,warehouse_id,barge_id,contractor_id,destination_text,
    requester,sector,currency,exchange_rate,payment_method,payment_terms,order_reference,ordered_date,expected_date,
    invoice_number,invoice_date,notes,delivery_mode,created_by
  )
  values(
    (p_data->>'company_id')::uuid,v_supplier,coalesce(nullif(p_data->>'purchase_type',''),'stock'),v_status,
    coalesce(nullif(p_data->>'urgency',''),'normal'),v_dest,v_wh,v_barge,v_contractor,nullif(p_data->>'destination_text',''),
    nullif(p_data->>'requester',''),nullif(p_data->>'sector',''),coalesce(nullif(p_data->>'currency',''),'PYG'),
    nullif(p_data->>'exchange_rate','')::numeric,nullif(p_data->>'payment_method',''),nullif(p_data->>'payment_terms',''),
    nullif(p_data->>'order_reference',''),coalesce(nullif(p_data->>'ordered_date','')::date,current_date),
    nullif(p_data->>'expected_date','')::date,nullif(p_data->>'invoice_number',''),nullif(p_data->>'invoice_date','')::date,
    nullif(p_data->>'notes',''),v_delivery_mode,auth.uid()
  ) returning id into v_id;
  for v_item in select * from jsonb_array_elements(p_items) loop
    if coalesce((v_item->>'quantity')::numeric,0)<=0 then raise exception 'Cantidad inválida en un ítem.'; end if;
    if coalesce((v_item->>'factor_to_base')::numeric,1)<=0 then raise exception 'Conversión inválida en un ítem.'; end if;
    if coalesce((v_item->>'unit_price')::numeric,0)<0 then raise exception 'Precio inválido en un ítem.'; end if;
    v_product:=nullif(v_item->>'product_id','')::uuid;
    if coalesce((v_item->>'affects_inventory')::boolean,false) then
      if v_product is null then raise exception 'Los ítems que ingresan a stock deben estar vinculados a un producto.'; end if;
      if not exists(select 1 from public.products where id=v_product and active) then raise exception 'El producto de inventario no existe o está inactivo.'; end if;
    end if;
    insert into public.purchase_items(purchase_id,product_id,description,quantity,unit,factor_to_base,unit_price,affects_inventory,notes)
    values(v_id,v_product,coalesce(nullif(v_item->>'description',''),'Ítem sin descripción'),(v_item->>'quantity')::numeric,
      coalesce(nullif(v_item->>'unit',''),'unidad'),coalesce(nullif(v_item->>'factor_to_base','')::numeric,1),
      coalesce(nullif(v_item->>'unit_price','')::numeric,0),coalesce((v_item->>'affects_inventory')::boolean,false),
      nullif(v_item->>'notes',''));
  end loop;
  return v_id;
end
$function$;

CREATE OR REPLACE FUNCTION public.admin_create_purchase_from_quote(p_data jsonb, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_po text;
  v_data jsonb;
  v_item jsonb;
  v_items jsonb := '[]'::jsonb;
  v_product_id uuid;
  v_product_name text;
  v_product_sku text;
  v_product_base_unit text;
  v_unit text;
  v_factor numeric;
  v_affects boolean;
  v_note text;
begin
  if public.current_profile_role() IS DISTINCT FROM 'admin' then raise exception 'Solo el administrador puede crear compras.'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'La compra no tiene ítems.'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := nullif(v_item->>'product_id','')::uuid;
    v_product_name := nullif(trim(v_item->>'description'),'');
    v_product_sku := nullif(trim(coalesce(v_item->>'product_code',v_item->>'barcode')),'');
    v_unit := public.purchase_normalize_unit(v_item->>'unit');
    v_factor := greatest(coalesce(nullif(v_item->>'factor_to_base','')::numeric,1),0.000001);
    v_product_base_unit := null;
    v_note := nullif(v_item->>'notes','');

    if v_product_id is not null then
      select base_unit into v_product_base_unit from public.products where id=v_product_id;
      if v_product_base_unit is null then v_product_id:=null; end if;
    end if;
    if v_product_id is null and v_product_sku is not null then
      select id,base_unit into v_product_id,v_product_base_unit from public.products where lower(coalesce(sku,''))=lower(v_product_sku) limit 1;
    end if;
    if v_product_id is null and v_product_name is not null then
      select id,base_unit into v_product_id,v_product_base_unit from public.products where lower(trim(name))=lower(trim(v_product_name)) limit 1;
    end if;

    if v_product_id is null then
      if v_product_name is null then raise exception 'Hay un ítem sin descripción; no puedo crear el producto.'; end if;
      begin
        insert into public.products(sku,name,base_unit,active,created_by)
        values(v_product_sku,v_product_name,v_unit,true,auth.uid())
        returning id,base_unit into v_product_id,v_product_base_unit;
      exception when unique_violation then
        select id,base_unit into v_product_id,v_product_base_unit
        from public.products
        where (v_product_sku is not null and lower(coalesce(sku,''))=lower(v_product_sku))
           or lower(trim(name))=lower(trim(v_product_name))
        order by case when v_product_sku is not null and lower(coalesce(sku,''))=lower(v_product_sku) then 0 else 1 end
        limit 1;
        if v_product_id is null then raise; end if;
      end;
    end if;

    v_affects := coalesce((p_data->>'destination_type')='warehouse',false);
    if v_affects and v_product_base_unit<>v_unit then
      if v_factor=1 and v_unit='tonelada' and v_product_base_unit='kg' then
        v_factor:=1000;
      elsif v_factor=1 and v_unit='kg' and v_product_base_unit='tonelada' then
        v_factor:=0.001;
      elsif v_factor=1 then
        v_affects:=false;
        v_note:=concat_ws(' · ',v_note,format('Producto vinculado; revisar conversión %s → %s antes de afectar stock.',v_unit,v_product_base_unit));
      end if;
    end if;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'product_id',v_product_id,
      'description',v_product_name,
      'quantity',coalesce((v_item->>'quantity')::numeric,0),
      'unit',v_unit,
      'factor_to_base',v_factor,
      'unit_price',coalesce((v_item->>'unit_price')::numeric,0),
      'affects_inventory',v_affects,
      'notes',v_note
    ));
  end loop;

  v_data:=coalesce(p_data,'{}'::jsonb)||jsonb_build_object('status','approved');
  v_id:=public.admin_create_purchase(v_data,v_items);
  update public.purchases
     set source_document_number=nullif(p_data->>'source_document_number',''),
         source_document_date=nullif(p_data->>'source_document_date','')::date,
         source_document_kind=nullif(p_data->>'source_document_kind',''),
         updated_at=now()
   where id=v_id;
  v_po:=public.admin_prepare_purchase_order(v_id);
  return jsonb_build_object('purchase_id',v_id,'po_number',v_po);
end$function$;

CREATE OR REPLACE FUNCTION public.admin_delete_purchase(p_purchase_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_purchase public.purchases%rowtype;
  v_item_count integer;
  v_total numeric;
begin
  if public.current_profile_role() IS DISTINCT FROM 'admin' then
    raise exception 'Solo el administrador puede eliminar compras.';
  end if;

  select * into v_purchase
  from public.purchases
  where id = p_purchase_id
  for update;

  if not found then
    raise exception 'Compra inexistente.';
  end if;

  if exists (
    select 1 from public.purchase_receipts where purchase_id = p_purchase_id
  ) or exists (
    select 1 from public.purchase_items
    where purchase_id = p_purchase_id and coalesce(received_qty, 0) > 0
  ) then
    raise exception 'Esta compra ya tuvo recepción y no se puede eliminar.';
  end if;

  select count(*), coalesce(sum(quantity * unit_price), 0)
    into v_item_count, v_total
  from public.purchase_items
  where purchase_id = p_purchase_id;

  insert into public.audit_events(
    entity_type, entity_id, action, actor_id, purchase_id, detail
  ) values (
    'purchase',
    p_purchase_id,
    'delete',
    auth.uid(),
    p_purchase_id,
    jsonb_build_object(
      'supplier_id', v_purchase.supplier_id,
      'company_id', v_purchase.company_id,
      'reference', v_purchase.order_reference,
      'invoice_number', v_purchase.invoice_number,
      'currency', v_purchase.currency,
      'item_count', v_item_count,
      'total', v_total
    )
  );

  delete from public.purchases where id = p_purchase_id;
end
$function$;

CREATE OR REPLACE FUNCTION public.admin_open_initial_inventory(p_warehouse_id uuid, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_status text;
begin
  if public.current_profile_role() IS DISTINCT FROM 'admin' then raise exception 'Solo el administrador puede abrir el inventario inicial.'; end if;
  if not exists(select 1 from public.warehouses where id=p_warehouse_id and active=true) then raise exception 'Depósito inválido o inactivo.'; end if;

  select id,status into v_id,v_status
  from public.warehouse_opening_inventory
  where warehouse_id=p_warehouse_id
  for update;

  if v_id is not null then
    if v_status='open' then return v_id; end if;
    raise exception 'El inventario inicial de este depósito está cerrado. Usá Reabrir si necesitás corregirlo.';
  end if;

  insert into public.warehouse_opening_inventory(warehouse_id,status,notes,opened_by)
  values(p_warehouse_id,'open',nullif(trim(p_notes),''),auth.uid())
  returning id into v_id;

  insert into public.audit_events(entity_type,entity_id,action,actor_id,warehouse_id,detail)
  values('opening_inventory',v_id,'opening_inventory_opened',auth.uid(),p_warehouse_id,jsonb_build_object('notes',nullif(trim(p_notes),'')));
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.admin_opening_inventory_lines(p_warehouse_id uuid)
 RETURNS TABLE(session_id uuid, session_status text, warehouse_id uuid, opened_at timestamp with time zone, closed_at timestamp with time zone, movement_line_id uuid, movement_no bigint, product_id uuid, product_name text, quantity numeric, unit text, presentation_label text, factor_to_base numeric, base_quantity numeric, entry_unit_cost numeric, entry_currency text, exchange_rate numeric, priced boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.current_profile_role() IS DISTINCT FROM 'admin' then raise exception 'Solo el administrador puede ver la valorización inicial.'; end if;
  return query
  select oi.id,oi.status,oi.warehouse_id,oi.opened_at,oi.closed_at,
         ml.id,m.movement_no,ml.product_id,p.name,ml.quantity,ml.unit,ml.presentation_label,
         ml.factor_to_base,coalesce(ml.base_quantity,ml.quantity*ml.factor_to_base),
         ml.entry_unit_cost,ml.entry_currency,ml.exchange_rate,
         (ml.id is not null and ml.entry_unit_cost is not null and ml.entry_currency is not null)
  from public.warehouse_opening_inventory oi
  left join public.movements m
    on m.opening_session_id=oi.id and m.type='initial' and m.status<>'cancelled'
  left join public.movement_lines ml on ml.movement_id=m.id
  left join public.products p on p.id=ml.product_id
  where oi.warehouse_id=p_warehouse_id
  order by m.created_at nulls first,ml.id;
end $function$;

CREATE OR REPLACE FUNCTION public.admin_prepare_purchase_order(p_purchase_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_purchase public.purchases%rowtype;
  v_prefix text;
  v_number text;
begin
  if public.current_profile_role() IS DISTINCT FROM 'admin' then raise exception 'Solo el administrador puede generar órdenes de compra.'; end if;
  select * into v_purchase from public.purchases where id=p_purchase_id for update;
  if not found then raise exception 'Compra inexistente.'; end if;
  if v_purchase.po_number is not null then return v_purchase.po_number; end if;
  if v_purchase.status in ('cancelled','partially_received','received','invoiced','closed') then raise exception 'El estado actual no permite generar una OC.'; end if;
  select coalesce(nullif(po_prefix,''),'OC') into v_prefix from public.purchase_companies where id=v_purchase.company_id;
  v_number:=v_prefix||'-'||extract(year from current_date)::int||'-'||lpad(nextval('public.purchase_order_seq')::text,5,'0');
  update public.purchases
     set po_number=v_number,
         po_generated_at=now(),
         status=case when status in ('draft','requested','quoted') then 'approved' else status end,
         updated_at=now()
   where id=p_purchase_id;
  insert into public.audit_events(entity_type,entity_id,purchase_id,action,actor_id,detail)
  values('purchase',p_purchase_id,p_purchase_id,'purchase_order_generated',auth.uid(),jsonb_build_object('po_number',v_number));
  return v_number;
end$function$;

CREATE OR REPLACE FUNCTION public.admin_price_initial_inventory(p_movement_line_id uuid, p_unit_cost numeric, p_currency text, p_exchange_rate numeric DEFAULT NULL::numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_session uuid;
  v_warehouse uuid;
  v_factor numeric;
  v_base_cost numeric;
  v_status text;
  v_product uuid;
begin
  if public.current_profile_role() IS DISTINCT FROM 'admin' then raise exception 'Solo el administrador puede valorar el stock inicial.'; end if;
  if p_unit_cost is null or p_unit_cost<0 then raise exception 'Precio inválido.'; end if;
  if upper(coalesce(p_currency,'')) not in ('PYG','USD') then raise exception 'Moneda inválida. Usá PYG o USD.'; end if;

  select m.opening_session_id,m.warehouse_to_id,ml.factor_to_base,oi.status,ml.product_id
    into v_session,v_warehouse,v_factor,v_status,v_product
  from public.movement_lines ml
  join public.movements m on m.id=ml.movement_id
  join public.warehouse_opening_inventory oi on oi.id=m.opening_session_id
  where ml.id=p_movement_line_id and m.type='initial' and m.status<>'cancelled'
  for update of ml;

  if v_session is null then raise exception 'Ítem de inventario inicial inválido.'; end if;
  if v_status<>'open' then raise exception 'El inventario inicial está cerrado. Reabrilo antes de cambiar precios.'; end if;
  if coalesce(v_factor,0)<=0 then raise exception 'La conversión de este ítem es inválida.'; end if;

  v_base_cost:=p_unit_cost/v_factor;

  update public.movement_lines
     set entry_unit_cost=p_unit_cost,
         entry_currency=upper(p_currency),
         exchange_rate=p_exchange_rate
   where id=p_movement_line_id;

  update public.inventory_batches
     set unit_cost=v_base_cost,
         currency=upper(p_currency),
         exchange_rate=p_exchange_rate
   where source_line_id=p_movement_line_id;

  update public.batch_allocations ba
     set unit_cost=v_base_cost,
         currency=upper(p_currency),
         exchange_rate=p_exchange_rate
  from public.inventory_batches b
  where ba.batch_id=b.id and b.source_line_id=p_movement_line_id;

  insert into public.audit_events(entity_type,entity_id,action,actor_id,warehouse_id,detail)
  values('opening_inventory',v_session,'opening_inventory_priced',auth.uid(),v_warehouse,
    jsonb_build_object('movement_line_id',p_movement_line_id,'product_id',v_product,'unit_cost',p_unit_cost,'currency',upper(p_currency),'factor_to_base',v_factor));
end $function$;

CREATE OR REPLACE FUNCTION public.admin_reopen_initial_inventory(p_warehouse_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  if public.current_profile_role() IS DISTINCT FROM 'admin' then raise exception 'Solo el administrador puede reabrir el inventario inicial.'; end if;
  update public.warehouse_opening_inventory
     set status='open',closed_by=null,closed_at=null,updated_at=now()
   where warehouse_id=p_warehouse_id
   returning id into v_id;
  if v_id is null then raise exception 'Todavía no existe un inventario inicial para este depósito.'; end if;
  insert into public.audit_events(entity_type,entity_id,action,actor_id,warehouse_id)
  values('opening_inventory',v_id,'opening_inventory_reopened',auth.uid(),p_warehouse_id);
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.admin_update_depositor(p_user_id uuid, p_active boolean DEFAULT NULL::boolean, p_warehouse_id uuid DEFAULT NULL::uuid, p_full_name text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.current_profile_role() IS DISTINCT FROM 'admin' then raise exception 'Solo administrador'; end if;
  if p_user_id=auth.uid() then raise exception 'La cuenta administradora no se gestiona como depositario'; end if;
  if not exists(select 1 from public.profiles where id=p_user_id and role='depositor') then raise exception 'Usuario depositario inválido'; end if;
  if p_warehouse_id is not null and not exists(select 1 from public.warehouses where id=p_warehouse_id and active=true) then raise exception 'Depósito inválido o inactivo'; end if;
  update public.profiles
  set active=coalesce(p_active,active),
      warehouse_id=coalesce(p_warehouse_id,warehouse_id),
      full_name=case when p_full_name is null then full_name else nullif(trim(p_full_name),'') end
  where id=p_user_id and role='depositor';
end $function$;

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
  select coalesce(bool_or(received_qty>0),false),coalesce(bool_and(received_qty>=quantity),false)
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

CREATE OR REPLACE FUNCTION public.admin_update_purchase_item(p_item_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_i public.purchase_items%rowtype;
  v_p public.purchases%rowtype;
  v_new_product uuid;
  v_new_description text;
  v_new_qty numeric;
  v_new_unit text;
  v_new_factor numeric;
  v_new_price numeric;
  v_new_affects boolean;
  v_new_notes text;
  v_remaining numeric;
  v_material_change boolean;
  v_new_id uuid;
  v_before jsonb;
  v_after jsonb;
begin
  if public.current_profile_role() IS DISTINCT FROM 'admin' then
    raise exception 'Solo el administrador puede editar ítems de compras.';
  end if;

  select * into v_i from public.purchase_items where id=p_item_id for update;
  if not found then raise exception 'Ítem de compra inexistente.'; end if;
  select * into v_p from public.purchases where id=v_i.purchase_id for update;
  if not found then raise exception 'Compra inexistente.'; end if;
  if v_p.status in ('closed','cancelled') then raise exception 'No se pueden editar ítems de una compra cerrada o cancelada.'; end if;

  v_before:=to_jsonb(v_i);
  v_new_product:=case when p_patch ? 'product_id' then nullif(p_patch->>'product_id','')::uuid else v_i.product_id end;
  v_new_description:=coalesce(nullif(trim(p_patch->>'description'),''),v_i.description);
  v_new_qty:=case when p_patch ? 'quantity' then nullif(p_patch->>'quantity','')::numeric else v_i.quantity end;
  v_new_unit:=coalesce(nullif(trim(p_patch->>'unit'),''),v_i.unit);
  v_new_factor:=case when p_patch ? 'factor_to_base' then nullif(p_patch->>'factor_to_base','')::numeric else v_i.factor_to_base end;
  v_new_price:=case when p_patch ? 'unit_price' then nullif(p_patch->>'unit_price','')::numeric else v_i.unit_price end;
  v_new_affects:=case when p_patch ? 'affects_inventory' then (p_patch->>'affects_inventory')::boolean else v_i.affects_inventory end;
  v_new_notes:=case when p_patch ? 'notes' then nullif(trim(p_patch->>'notes'),'') else v_i.notes end;

  if v_new_qty is null or v_new_qty<=0 then raise exception 'La cantidad debe ser mayor a cero.'; end if;
  if v_new_qty < v_i.received_qty then raise exception 'La cantidad no puede quedar por debajo de lo ya recibido (%).',v_i.received_qty; end if;
  if v_new_factor is null or v_new_factor<=0 then raise exception 'La conversión a unidad base debe ser mayor a cero.'; end if;
  if v_new_price is null or v_new_price<0 then raise exception 'El precio unitario no puede ser negativo.'; end if;
  if v_new_affects and v_new_product is null then raise exception 'Un ítem que ingresa a stock debe estar vinculado a un producto.'; end if;
  if v_new_affects and v_p.destination_type<>'warehouse' then raise exception 'Solo una compra destinada a depósito puede ingresar a stock.'; end if;
  if v_new_product is not null and not exists(select 1 from public.products where id=v_new_product and active) then raise exception 'Producto inválido o inactivo.'; end if;

  v_material_change :=
      v_new_product is distinct from v_i.product_id
      or v_new_unit is distinct from v_i.unit
      or v_new_factor is distinct from v_i.factor_to_base
      or v_new_price is distinct from v_i.unit_price
      or v_new_affects is distinct from v_i.affects_inventory;

  if v_i.received_qty=0 then
    update public.purchase_items set
      product_id=v_new_product,description=v_new_description,quantity=v_new_qty,unit=v_new_unit,
      factor_to_base=v_new_factor,unit_price=v_new_price,affects_inventory=v_new_affects,notes=v_new_notes
    where id=v_i.id;
    select to_jsonb(x) into v_after from public.purchase_items x where x.id=v_i.id;
    insert into public.audit_events(entity_type,entity_id,action,actor_id,warehouse_id,purchase_id,detail)
    values('purchase_item',v_i.id,'purchase_item_updated',auth.uid(),v_p.warehouse_id,v_p.id,jsonb_build_object('before',v_before,'after',v_after));
    update public.purchases set updated_at=now() where id=v_p.id;
    return jsonb_build_object('mode','updated','item_id',v_i.id);
  end if;

  if v_material_change then
    v_remaining:=v_new_qty-v_i.received_qty;
    if v_remaining<=0 then
      raise exception 'Este ítem ya no tiene saldo pendiente. No se puede cambiar precio, unidad, producto o condición de stock de lo ya recibido.';
    end if;
    update public.purchase_items set quantity=v_i.received_qty where id=v_i.id;
    insert into public.purchase_items(purchase_id,product_id,description,quantity,unit,factor_to_base,unit_price,affects_inventory,received_qty,notes)
    values(v_i.purchase_id,v_new_product,v_new_description,v_remaining,v_new_unit,v_new_factor,v_new_price,v_new_affects,0,v_new_notes)
    returning id into v_new_id;
    insert into public.audit_events(entity_type,entity_id,action,actor_id,warehouse_id,purchase_id,detail)
    values('purchase_item',v_i.id,'purchase_item_split',auth.uid(),v_p.warehouse_id,v_p.id,
      jsonb_build_object('original_before',v_before,'received_preserved',v_i.received_qty,'new_pending_item_id',v_new_id,'new_pending_quantity',v_remaining,'new_values',jsonb_build_object('product_id',v_new_product,'description',v_new_description,'unit',v_new_unit,'factor_to_base',v_new_factor,'unit_price',v_new_price,'affects_inventory',v_new_affects,'notes',v_new_notes)));
    update public.purchases set updated_at=now() where id=v_p.id;
    return jsonb_build_object('mode','split','item_id',v_i.id,'new_item_id',v_new_id,'preserved_received_qty',v_i.received_qty,'new_pending_qty',v_remaining);
  end if;

  update public.purchase_items set description=v_new_description,quantity=v_new_qty,notes=v_new_notes where id=v_i.id;
  select to_jsonb(x) into v_after from public.purchase_items x where x.id=v_i.id;
  insert into public.audit_events(entity_type,entity_id,action,actor_id,warehouse_id,purchase_id,detail)
  values('purchase_item',v_i.id,'purchase_item_updated',auth.uid(),v_p.warehouse_id,v_p.id,jsonb_build_object('before',v_before,'after',v_after));
  update public.purchases set updated_at=now() where id=v_p.id;
  return jsonb_build_object('mode','updated','item_id',v_i.id);
end
$function$;

CREATE OR REPLACE FUNCTION public.admin_void_movement(p_movement_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_m public.movements%rowtype;
  v_correction uuid;
begin
  if public.current_profile_role() IS DISTINCT FROM 'admin' then
    raise exception 'Solo el administrador puede anular movimientos directamente.';
  end if;

  select * into v_m
  from public.movements
  where id = p_movement_id
  for update;

  if not found then raise exception 'Movimiento inexistente.'; end if;
  if v_m.status = 'cancelled' then raise exception 'Este movimiento ya está anulado.'; end if;
  if v_m.type = 'correction' then raise exception 'No se puede anular una corrección desde esta opción.'; end if;
  if exists(select 1 from public.movements where corrected_movement_id=p_movement_id and type='correction') then
    raise exception 'Este movimiento ya tiene una corrección asociada.';
  end if;

  if v_m.type in ('initial','entry','return') then
    if exists (
      select 1
      from public.inventory_batches b
      join public.movement_lines ml on ml.id=b.source_line_id
      where ml.movement_id=p_movement_id
        and (b.quantity_remaining<>b.quantity_received
          or exists(select 1 from public.batch_allocations ba where ba.batch_id=b.id))
    ) then
      raise exception 'Parte de esta carga ya fue utilizada en otro movimiento. No se puede borrar sin alterar la trazabilidad y los costos.';
    end if;

    update public.inventory_batches b
       set quantity_remaining=0
      from public.movement_lines ml
     where b.source_line_id=ml.id and ml.movement_id=p_movement_id;

    insert into public.movements(type,status,warehouse_from_id,notes,corrected_movement_id,created_by)
    values('correction','confirmed',v_m.warehouse_to_id,
      concat('ANULACIÓN ADMIN: ',coalesce(nullif(trim(p_reason),''),'Movimiento cargado por error')),
      p_movement_id,auth.uid())
    returning id into v_correction;

  elsif v_m.type='exit' then
    update public.inventory_batches b
       set quantity_remaining=b.quantity_remaining+x.qty
      from (
        select ba.batch_id,sum(ba.quantity) qty
        from public.batch_allocations ba
        join public.movement_lines ml on ml.id=ba.movement_line_id
        where ml.movement_id=p_movement_id
        group by ba.batch_id
      ) x
     where b.id=x.batch_id;

    insert into public.movements(type,status,warehouse_to_id,notes,corrected_movement_id,created_by)
    values('correction','confirmed',v_m.warehouse_from_id,
      concat('ANULACIÓN ADMIN: ',coalesce(nullif(trim(p_reason),''),'Movimiento cargado por error')),
      p_movement_id,auth.uid())
    returning id into v_correction;

  elsif v_m.type='transfer' then
    if v_m.status='received' then
      if exists (
        select 1
        from public.inventory_batches b
        join public.movement_lines ml on ml.id=b.source_line_id
        where ml.movement_id=p_movement_id
          and (b.quantity_remaining<>b.quantity_received
            or exists(select 1 from public.batch_allocations ba where ba.batch_id=b.id))
      ) then
        raise exception 'La transferencia ya fue recibida y parte del stock de destino fue utilizada. No se puede anular sin alterar movimientos posteriores.';
      end if;

      update public.inventory_batches b
         set quantity_remaining=0
        from public.movement_lines ml
       where b.source_line_id=ml.id and ml.movement_id=p_movement_id;
    end if;

    update public.inventory_batches b
       set quantity_remaining=b.quantity_remaining+x.qty
      from (
        select ba.batch_id,sum(ba.quantity) qty
        from public.batch_allocations ba
        join public.movement_lines ml on ml.id=ba.movement_line_id
        where ml.movement_id=p_movement_id
        group by ba.batch_id
      ) x
     where b.id=x.batch_id;

    insert into public.movements(type,status,warehouse_from_id,warehouse_to_id,notes,corrected_movement_id,created_by)
    values('correction','confirmed',v_m.warehouse_to_id,v_m.warehouse_from_id,
      concat('ANULACIÓN ADMIN: ',coalesce(nullif(trim(p_reason),''),'Movimiento cargado por error')),
      p_movement_id,auth.uid())
    returning id into v_correction;
  else
    raise exception 'Tipo de movimiento no soportado para anulación directa.';
  end if;

  insert into public.movement_lines(
    movement_id,product_id,quantity,unit,factor_to_base,presentation_label,
    entry_unit_cost,entry_currency,exchange_rate,notes
  )
  select v_correction,product_id,quantity,unit,factor_to_base,presentation_label,
         entry_unit_cost,entry_currency,exchange_rate,
         concat('Anula movimiento #',v_m.movement_no)
  from public.movement_lines
  where movement_id=p_movement_id;

  update public.movements set status='cancelled' where id=p_movement_id;
  return v_correction;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_void_stock_in_movement(p_movement_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_m public.movements%rowtype;
  v_correction uuid;
begin
  if public.current_profile_role() IS DISTINCT FROM 'admin' then
    raise exception 'Solo el administrador puede anular una carga.';
  end if;

  select * into v_m
  from public.movements
  where id = p_movement_id
  for update;

  if not found then
    raise exception 'Movimiento inexistente.';
  end if;

  if v_m.status = 'cancelled' then
    raise exception 'Este movimiento ya está anulado.';
  end if;

  if v_m.type not in ('initial','entry','return') then
    raise exception 'Esta opción solo anula cargas de stock. Para salidas o transferencias usá el flujo de corrección.';
  end if;

  if exists (
    select 1
    from public.inventory_batches b
    join public.movement_lines ml on ml.id = b.source_line_id
    where ml.movement_id = p_movement_id
      and (
        b.quantity_remaining <> b.quantity_received
        or exists (select 1 from public.batch_allocations ba where ba.batch_id = b.id)
      )
  ) then
    raise exception 'No se puede anular porque parte de esta carga ya fue utilizada. Debe hacerse una corrección auditada.';
  end if;

  if exists (
    select 1 from public.movements
    where corrected_movement_id = p_movement_id
      and type = 'correction'
  ) then
    raise exception 'Este movimiento ya tiene una corrección asociada.';
  end if;

  insert into public.movements(
    type,status,warehouse_from_id,notes,corrected_movement_id,created_by
  ) values (
    'correction','confirmed',v_m.warehouse_to_id,
    concat('ANULACIÓN ADMIN: ', coalesce(nullif(trim(p_reason),''),'Carga registrada por error')),
    p_movement_id,auth.uid()
  ) returning id into v_correction;

  insert into public.movement_lines(
    movement_id,product_id,quantity,unit,factor_to_base,presentation_label,
    entry_unit_cost,entry_currency,exchange_rate,notes
  )
  select
    v_correction,product_id,quantity,unit,factor_to_base,presentation_label,
    entry_unit_cost,entry_currency,exchange_rate,
    concat('Anula movimiento #', v_m.movement_no)
  from public.movement_lines
  where movement_id = p_movement_id;

  update public.inventory_batches b
  set quantity_remaining = 0
  from public.movement_lines ml
  where b.source_line_id = ml.id
    and ml.movement_id = p_movement_id;

  update public.movements
  set status = 'cancelled'
  where id = p_movement_id;

  return v_correction;
end;
$function$;

CREATE OR REPLACE FUNCTION public.approve_product_request(p_request_id uuid, p_sku text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_req public.product_requests%rowtype; v_product uuid;
begin
  if public.current_profile_role() IS DISTINCT FROM 'admin' then raise exception 'Solo administrador'; end if;
  select * into v_req from public.product_requests where id=p_request_id for update;
  if not found or v_req.status<>'pending' then raise exception 'Solicitud inválida o ya revisada'; end if;
  insert into public.products(sku,name,base_unit,created_by)
  values(nullif(trim(p_sku),''),trim(v_req.proposed_name),v_req.proposed_unit,auth.uid()) returning id into v_product;
  update public.product_requests set status='approved',reviewed_by=auth.uid(),reviewed_at=now() where id=p_request_id;
  return v_product;
end $function$;

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
begin
  if coalesce(public.current_profile_role(), '') not in ('depositor','admin') then raise exception 'Usuario no autorizado para recibir compras.'; end if;
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

CREATE OR REPLACE FUNCTION public.reject_product_request(p_request_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public.current_profile_role() IS DISTINCT FROM 'admin' then raise exception 'Solo administrador'; end if;
  update public.product_requests set status='rejected',reviewed_by=auth.uid(),reviewed_at=now() where id=p_request_id and status='pending';
end $function$;

CREATE OR REPLACE FUNCTION public.request_product_deletion(p_product_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_name text;
begin
  if public.current_profile_role() IS DISTINCT FROM 'depositor' then
    raise exception 'Solo un depositario puede solicitar la baja de un producto.';
  end if;
  select name into v_name from public.products where id = p_product_id and active = true;
  if v_name is null then raise exception 'Producto inválido o inactivo.'; end if;
  if exists(select 1 from public.product_deletion_requests where product_id=p_product_id and requested_by=auth.uid() and status='pending') then
    raise exception 'Ya existe una solicitud pendiente para este producto.';
  end if;
  insert into public.product_deletion_requests(product_id,product_name_snapshot,requested_by,reason)
  values(p_product_id,v_name,auth.uid(),nullif(trim(p_reason),'')) returning id into v_id;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.review_product_deletion(p_request_id uuid, p_approve boolean)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req public.product_deletion_requests%rowtype;
  v_resolution text;
begin
  if public.current_profile_role() IS DISTINCT FROM 'admin' then raise exception 'Solo administrador'; end if;
  select * into v_req from public.product_deletion_requests where id=p_request_id for update;
  if not found then raise exception 'Solicitud no encontrada'; end if;
  if v_req.status <> 'pending' then raise exception 'La solicitud ya fue revisada'; end if;
  if not p_approve then
    update public.product_deletion_requests
      set status='rejected', reviewed_by=auth.uid(), reviewed_at=now()
      where id=p_request_id;
    return 'rejected';
  end if;
  if v_req.product_id is null then raise exception 'El producto ya no existe'; end if;
  if exists(select 1 from public.movement_lines where product_id=v_req.product_id)
     or exists(select 1 from public.inventory_batches where product_id=v_req.product_id)
     or exists(select 1 from public.stock_minimums where product_id=v_req.product_id)
     or exists(select 1 from public.product_presentations where product_id=v_req.product_id) then
    update public.products set active=false where id=v_req.product_id;
    v_resolution := 'deactivated';
  else
    delete from public.products where id=v_req.product_id;
    v_resolution := 'deleted';
  end if;
  update public.product_deletion_requests
    set status='approved', resolution=v_resolution, reviewed_by=auth.uid(), reviewed_at=now()
    where id=p_request_id;
  return v_resolution;
end;
$function$;

CREATE OR REPLACE FUNCTION public.review_supply_request(p_request_id uuid, p_status text, p_notes text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_req public.supply_requests%rowtype; v_label text;
begin
  if public.current_profile_role() IS DISTINCT FROM 'admin' then raise exception 'Solo administrador'; end if;
  if p_status not in ('in_progress','fulfilled','rejected') then raise exception 'Estado inválido'; end if;
  select * into v_req from public.supply_requests where id=p_request_id for update;
  if not found then raise exception 'Solicitud no encontrada'; end if;
  if v_req.status in ('fulfilled','rejected') then raise exception 'La solicitud ya está cerrada'; end if;
  update public.supply_requests set status=p_status,reviewed_by=auth.uid(),reviewed_at=now(),resolution_notes=nullif(trim(p_notes),''),updated_at=now() where id=p_request_id;
  v_label:=case p_status when 'in_progress' then 'En gestión' when 'fulfilled' then 'Atendida' else 'Rechazada' end;
  insert into public.notifications(user_id,kind,title,body,metadata,dedupe_key)
  values(v_req.requested_by,case when p_status='fulfilled' then 'success' when p_status='rejected' then 'warning' else 'info' end,
    'Solicitud de abastecimiento: '||v_label,
    v_req.requested_name||' · '||trim(to_char(v_req.quantity,'FM999999990.###'))||' '||v_req.unit||case when nullif(trim(p_notes),'') is not null then ' · '||trim(p_notes) else '' end,
    jsonb_build_object('supply_request_id',v_req.id,'status',p_status),'supply_request_status:'||v_req.id::text||':'||p_status) on conflict do nothing;
  insert into public.audit_events(entity_type,entity_id,action,actor_id,warehouse_id,detail)
  values('supply_request',v_req.id,'supply_request_'||p_status,auth.uid(),v_req.warehouse_id,jsonb_build_object('status',p_status,'notes',nullif(trim(p_notes),'')));
end $function$;

CREATE OR REPLACE FUNCTION public.request_movement_correction(p_movement_id uuid, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_m public.movements%rowtype;
begin
  select * into v_m from public.movements where id=p_movement_id;
  if not found then raise exception 'Movimiento inexistente'; end if;
  if (public.current_profile_role()='admin' or public.can_access_warehouse(v_m.warehouse_from_id) or public.can_access_warehouse(v_m.warehouse_to_id)) IS NOT TRUE then raise exception 'No autorizado'; end if;
  insert into public.correction_requests(movement_id,requested_by,reason) values(p_movement_id,auth.uid(),trim(p_reason)) returning id into v_id;
  return v_id;
end $function$;

COMMIT;
