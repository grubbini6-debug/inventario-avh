-- AVH V3 — costo de entrada manual reservado a Administración.
-- Regla de negocio: el depositario puede registrar una entrada manual,
-- pero no puede fijar ni alterar su valorización.
--
-- Excepción controlada: receive_purchase() puede generar la entrada valorizada
-- usando exclusivamente los precios ya aprobados en la compra. Para evitar que
-- un depositario pueda imitar esa excepción, record_entry() exige un receipt_id
-- recién creado por el mismo usuario, en el mismo depósito y todavía sin movement_id.

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
  v_role text;
  v_purchase_receipt_id uuid;
begin
  perform public.assert_can_access_warehouse(p_warehouse_id);
  v_role:=public.current_profile_role();

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then
    raise exception 'Agregá al menos un producto';
  end if;

  v_request_id := nullif(p_items->0->>'request_id','')::uuid;
  v_purchase_receipt_id := nullif(p_items->0->>'purchase_receipt_id','')::uuid;

  if v_role <> 'admin' and exists(
    select 1
    from jsonb_array_elements(p_items) as item
    where nullif(trim(coalesce(item->>'unit_cost','')),'') is not null
       or nullif(trim(coalesce(item->>'currency','')),'') is not null
       or nullif(trim(coalesce(item->>'exchange_rate','')),'') is not null
  ) then
    if v_purchase_receipt_id is null or not exists(
      select 1
      from public.purchase_receipts pr
      join public.purchases p on p.id=pr.purchase_id
      where pr.id=v_purchase_receipt_id
        and pr.received_by=auth.uid()
        and pr.warehouse_id=p_warehouse_id
        and pr.movement_id is null
        and p.destination_type='warehouse'
        and p.warehouse_id=p_warehouse_id
        and p.status in ('ordered','in_transit','partially_received')
    ) then
      raise exception 'Solo Administración puede asignar costos a una entrada manual.';
    end if;
  end if;

  insert into public.movements(
    type,status,warehouse_to_id,supplier_id,document_id,notes,created_by,client_request_id
  )
  values(
    'entry','confirmed',p_warehouse_id,p_supplier_id,p_document_id,p_notes,auth.uid(),v_request_id
  )
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

    insert into public.movement_lines(
      movement_id,product_id,quantity,unit,factor_to_base,presentation_label,
      entry_unit_cost,entry_currency,exchange_rate
    )
    values(
      v_movement,v_product,v_qty,v_unit,v_factor,nullif(v_item->>'presentation_label',''),
      v_cost_present,v_currency,v_fx
    )
    returning id into v_line;

    insert into public.inventory_batches(
      warehouse_id,product_id,source_line_id,quantity_received,quantity_remaining,
      unit_cost,currency,exchange_rate,lot_reference
    )
    values(
      p_warehouse_id,v_product,v_line,v_base,v_base,
      v_cost_base,v_currency,v_fx,nullif(v_item->>'lot_reference','')
    );
  end loop;

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
  if public.current_profile_role() not in ('depositor','admin') then
    raise exception 'Usuario no autorizado para recibir compras.';
  end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then
    raise exception 'Indicá al menos una cantidad recibida.';
  end if;
  v_request_id := nullif(p_items->0->>'request_id','')::uuid;

  if v_request_id is not null then
    select id,purchase_id into v_receipt,v_existing_purchase
    from public.purchase_receipts
    where received_by=auth.uid() and client_request_id=v_request_id;
    if v_receipt is not null then
      if v_existing_purchase<>p_purchase_id then
        raise exception 'La misma operación ya fue utilizada en otra recepción.';
      end if;
      return v_receipt;
    end if;
  end if;

  select * into v_p
  from public.purchases
  where id=p_purchase_id
  for update;
  if not found then raise exception 'Compra inexistente.'; end if;

  if v_request_id is not null then
    select id,purchase_id into v_receipt,v_existing_purchase
    from public.purchase_receipts
    where received_by=auth.uid() and client_request_id=v_request_id;
    if v_receipt is not null then
      if v_existing_purchase<>p_purchase_id then
        raise exception 'La misma operación ya fue utilizada en otra recepción.';
      end if;
      return v_receipt;
    end if;
  end if;

  if v_p.destination_type<>'warehouse' or v_p.warehouse_id is null then
    raise exception 'Esta compra no requiere recepción de depósito.';
  end if;
  perform public.assert_can_access_warehouse(v_p.warehouse_id);
  if v_p.status not in ('ordered','in_transit','partially_received') then
    raise exception 'La compra no está disponible para recepción.';
  end if;

  if p_file_path is not null or p_document_number is not null then
    insert into public.documents(
      supplier_id,document_type,document_number,document_date,currency,exchange_rate,file_path,uploaded_by
    )
    values(
      v_p.supplier_id,'remito',p_document_number,coalesce(p_document_date,current_date),
      v_p.currency,v_p.exchange_rate,p_file_path,auth.uid()
    )
    returning id into v_doc;
  end if;

  insert into public.purchase_receipts(
    purchase_id,warehouse_id,received_by,document_id,notes,client_request_id
  )
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
    if v_pi.received_qty+v_qty>v_pi.quantity then
      raise exception 'La recepción supera la cantidad comprada para %.',v_pi.description;
    end if;

    insert into public.purchase_receipt_items(receipt_id,purchase_item_id,quantity)
    values(v_receipt,v_pi.id,v_qty);

    update public.purchase_items
    set received_qty=received_qty+v_qty
    where id=v_pi.id;

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
        'lot_reference',coalesce(nullif(v_item->>'lot_reference',''),v_p.order_reference),
        'purchase_receipt_id',v_receipt
      ));
    end if;
  end loop;

  if jsonb_array_length(v_stock_items)>0 then
    v_move:=public.record_entry(
      v_p.warehouse_id,
      v_p.supplier_id,
      v_doc,
      v_stock_items,
      concat(
        'Recepción de compra',
        case when v_p.order_reference is not null then ' · '||v_p.order_reference else '' end,
        case when p_notes is not null then ' · '||p_notes else '' end
      )
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
