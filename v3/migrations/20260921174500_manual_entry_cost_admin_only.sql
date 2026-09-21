-- AVH V3 — costo de entrada manual reservado a Administración.
-- Regla de negocio confirmada: el depositario puede registrar una entrada manual,
-- pero no puede fijar ni alterar su valorización. Solo admin puede enviar costo,
-- moneda o tipo de cambio en record_entry().

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
begin
  perform public.assert_can_access_warehouse(p_warehouse_id);
  v_role:=public.current_profile_role();

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then
    raise exception 'Agregá al menos un producto';
  end if;

  if v_role <> 'admin' and exists(
    select 1
    from jsonb_array_elements(p_items) as item
    where nullif(trim(coalesce(item->>'unit_cost','')),'') is not null
       or nullif(trim(coalesce(item->>'currency','')),'') is not null
       or nullif(trim(coalesce(item->>'exchange_rate','')),'') is not null
  ) then
    raise exception 'Solo Administración puede asignar costos a una entrada manual.';
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
