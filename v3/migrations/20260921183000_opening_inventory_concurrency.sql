-- AVH V3 — serializar carga vs cierre del inventario inicial.
-- Sin este lock, una carga que leyera la sesión como "open" podía continuar
-- mientras Administración la cerraba en otra transacción.

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
  where warehouse_id=p_warehouse_id and status='open'
  for update;

  if v_session is null then
    raise exception 'El inventario inicial de este depósito no está abierto por administración.';
  end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then
    raise exception 'Agregá al menos un producto.';
  end if;

  v_request_id := nullif(p_items->0->>'request_id','')::uuid;

  insert into public.movements(
    type,status,warehouse_to_id,notes,opening_session_id,created_by,client_request_id
  )
  values(
    'initial','confirmed',p_warehouse_id,p_notes,v_session,auth.uid(),v_request_id
  )
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

    if not exists(select 1 from public.products where id=v_product and active=true) then
      raise exception 'Producto inexistente o inactivo.';
    end if;
    if v_qty is null or v_qty<=0 or v_factor<=0 then
      raise exception 'Cantidad o conversión inválida.';
    end if;

    insert into public.movement_lines(
      movement_id,product_id,quantity,unit,factor_to_base,presentation_label,
      entry_unit_cost,entry_currency,exchange_rate
    )
    values(
      v_movement,v_product,v_qty,v_unit,v_factor,
      nullif(v_item->>'presentation_label',''),null,null,null
    )
    returning id into v_line;

    insert into public.inventory_batches(
      warehouse_id,product_id,source_line_id,quantity_received,quantity_remaining,
      unit_cost,currency,exchange_rate,lot_reference
    )
    values(
      p_warehouse_id,v_product,v_line,v_base,v_base,
      null,null,null,nullif(v_item->>'lot_reference','')
    );
  end loop;

  insert into public.audit_events(
    entity_type,entity_id,action,actor_id,warehouse_id,detail
  )
  values(
    'opening_inventory',v_session,'opening_inventory_count_added',auth.uid(),p_warehouse_id,
    jsonb_build_object('movement_id',v_movement,'line_count',jsonb_array_length(p_items))
  );

  return v_movement;
end
$function$;
