-- Free-text initial counts for explicitly authorized fabrication operators.
-- Uses the existing catalog, opening sessions, stock RPC and audit trail; no new tables.
begin;
create function avh_fabrication_private.record_initial_inventory_named(
  p_warehouse_id uuid,p_items jsonb,p_notes text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_item jsonb; v_name text; v_key text; v_unit text; v_qty numeric; v_request_id uuid;
  v_session uuid; v_movement uuid; v_product public.products%rowtype;
  v_matches integer; v_created boolean:=false; v_request jsonb; v_previous jsonb;
begin
  perform public.assert_can_access_warehouse(p_warehouse_id);
  if not avh_fabrication_private.can_access(p_warehouse_id,true) then
    raise exception 'Solo un operador autorizado de Fabricación Naval puede cargar materiales nuevos en su inventario inicial.';
  end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' then
    raise exception 'Cargá un material por vez.';
  end if;
  if jsonb_array_length(p_items)<>1 or jsonb_typeof(p_items->0)<>'object' then
    raise exception 'Cargá un material por vez.';
  end if;
  v_item:=p_items->0;
  v_name:=nullif(trim(regexp_replace(v_item->>'product_name','[[:space:]]+',' ','g')),'');
  v_key:=lower(v_name); v_unit:=nullif(trim(v_item->>'unit'),'');
  v_qty:=(v_item->>'quantity')::numeric;
  v_request_id:=nullif(v_item->>'request_id','')::uuid;
  if v_name is null or length(v_name)>300 then raise exception 'Escribí el nombre del material (hasta 300 caracteres).'; end if;
  if v_qty is null or v_qty<=0 or v_qty::text in ('NaN','Infinity','-Infinity') then raise exception 'La cantidad debe ser finita y mayor a cero.'; end if;
  if v_unit is null or v_unit not in ('unidad','pieza','kg','tonelada','rollo','bobina','caja','paquete','bolsa','metro','m²','m³','litro','cilindro','tambor','pallet','plancha','barra','tubo','perfil','bidón','servicio','viaje','hora','día','otro') then
    raise exception 'Elegí una unidad válida para el material.';
  end if;
  if coalesce((v_item->>'factor_to_base')::numeric,1)<>1 then raise exception 'Un material nuevo se cuenta en su unidad base, sin conversión.'; end if;
  if v_request_id is null then raise exception 'Falta el identificador del conteo. Volvé a intentar.'; end if;
  v_request:=jsonb_build_object('warehouse_id',p_warehouse_id,'product_name',v_key,'quantity',v_qty,'unit',v_unit,
    'lot_reference',nullif(trim(v_item->>'lot_reference'),''),'notes',nullif(trim(p_notes),''));
  -- Same ordering as the original initial RPC: opening session before any stock writes.
  perform pg_advisory_xact_lock(hashtextextended('initial-name-request:'||auth.uid()::text||':'||v_request_id::text,0));
  select id into v_session from public.warehouse_opening_inventory
    where warehouse_id=p_warehouse_id and status='open' for update;
  if v_session is null then raise exception 'El inventario inicial de este depósito no está abierto por administración.'; end if;
  select id into v_movement from public.movements
    where created_by=auth.uid() and type='initial' and client_request_id=v_request_id;
  if v_movement is not null then
    select detail->'request' into v_previous from public.audit_events
      where movement_id=v_movement and action='opening_inventory_named_count_added' and actor_id=auth.uid();
    if v_previous is distinct from v_request then raise exception 'Este identificador ya se usó para otro conteo.'; end if;
    return v_movement;
  end if;
  -- Concurrent named counts share one existing catalog entry, across workshops too.
  perform pg_advisory_xact_lock(hashtextextended('inventory-product-name:'||v_key,0));
  select count(*) into v_matches from public.products where lower(trim(regexp_replace(name,'[[:space:]]+',' ','g')))=v_key;
  if v_matches>1 then raise exception 'Hay varias coincidencias. Elegí el nombre exacto del catálogo.'; end if;
  if v_matches=1 then
    select * into v_product from public.products where lower(trim(regexp_replace(name,'[[:space:]]+',' ','g')))=v_key for update;
    if not v_product.active then raise exception 'El material ya existe pero está inactivo. Consultá a administración.'; end if;
    if v_product.base_unit<>v_unit then raise exception 'El material ya existe con otra unidad. Seleccionalo desde el catálogo.'; end if;
  else
    insert into public.products(name,base_unit,created_by) values(v_name,v_unit,auth.uid()) returning * into v_product;
    v_created:=true;
  end if;
  v_movement:=public.record_initial_inventory(p_warehouse_id,jsonb_build_array(jsonb_build_object(
    'product_id',v_product.id,'quantity',v_qty,'unit',v_unit,'factor_to_base',1,'request_id',v_request_id,
    'lot_reference',v_request->>'lot_reference')),v_request->>'notes');
  insert into public.audit_events(entity_type,entity_id,action,actor_id,warehouse_id,movement_id,detail)
  values('opening_inventory',v_session,'opening_inventory_named_count_added',auth.uid(),p_warehouse_id,v_movement,
    jsonb_build_object('movement_id',v_movement,'request_id',v_request_id,'product_id',v_product.id,
      'product_name',v_product.name,'created_product',v_created,'request',v_request));
  return v_movement;
end $$;
create function public.record_initial_inventory_named(p_warehouse_id uuid,p_items jsonb,p_notes text default null)
returns uuid language sql security invoker set search_path='' as $$
  select avh_fabrication_private.record_initial_inventory_named(p_warehouse_id,p_items,p_notes)
$$;
revoke all on function avh_fabrication_private.record_initial_inventory_named(uuid,jsonb,text),public.record_initial_inventory_named(uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function avh_fabrication_private.record_initial_inventory_named(uuid,jsonb,text),public.record_initial_inventory_named(uuid,jsonb,text) to authenticated;
comment on function public.record_initial_inventory_named(uuid,jsonb,text) is 'Conteo físico inicial por nombre, limitado a operadores autorizados de fabricación. Reutiliza productos y record_initial_inventory de forma atómica e idempotente.';
notify pgrst,'reload schema';
commit;
