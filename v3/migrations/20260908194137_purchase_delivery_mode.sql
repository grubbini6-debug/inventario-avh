alter table public.purchases
  add column if not exists delivery_mode text not null default 'single';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.purchases'::regclass
      and conname='purchases_delivery_mode_check'
  ) then
    alter table public.purchases
      add constraint purchases_delivery_mode_check
      check (delivery_mode in ('single','partial'));
  end if;
end $$;

create or replace function public.admin_create_purchase(p_data jsonb, p_items jsonb)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid; v_item jsonb; v_dest text; v_wh uuid; v_status text; v_product uuid;
  v_supplier uuid; v_barge uuid; v_contractor uuid; v_delivery_mode text;
begin
  if public.current_profile_role()<>'admin' then raise exception 'Solo el administrador puede crear compras.'; end if;
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

create or replace function public.admin_update_purchase(p_purchase_id uuid, p_patch jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_old public.purchases%rowtype; v_status text; v_wh uuid; v_dest text;
  v_any_received boolean; v_all_received boolean; v_delivery_mode text;
begin
  if public.current_profile_role()<>'admin' then raise exception 'Solo el administrador puede modificar compras.'; end if;
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

create or replace view public.v_purchase_overview
with (security_invoker = true)
as
select
  p.id,
  p.company_id,
  c.name as company_name,
  p.supplier_id,
  s.name as supplier_name,
  p.purchase_type,
  p.status,
  p.urgency,
  p.destination_type,
  p.warehouse_id,
  w.name as warehouse_name,
  p.barge_id,
  b.number as barge_number,
  p.contractor_id,
  ct.name as contractor_name,
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
  coalesce(sum(pi.quantity*pi.unit_price),0::numeric) as total_amount,
  coalesce(sum(pi.received_qty*pi.unit_price),0::numeric) as received_amount,
  coalesce(sum(pi.quantity),0::numeric) as item_units,
  coalesce(sum(pi.received_qty),0::numeric) as received_units,
  count(pi.id)::integer as item_count,
  p.po_number,
  p.po_generated_at,
  p.purchase_confirmed_at,
  p.source_document_number,
  p.source_document_date,
  p.source_document_kind,
  p.delivery_mode
from public.purchases p
join public.purchase_companies c on c.id=p.company_id
left join public.suppliers s on s.id=p.supplier_id
left join public.warehouses w on w.id=p.warehouse_id
left join public.barges b on b.id=p.barge_id
left join public.contractors ct on ct.id=p.contractor_id
left join public.purchase_items pi on pi.purchase_id=p.id
group by p.id,c.name,s.name,w.name,b.number,ct.name;
