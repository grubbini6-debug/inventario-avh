-- Depositors correct their own unused stock loads without direct table UPDATE grants.
begin;
create schema avh_inventory_private;
revoke all on schema avh_inventory_private from public,anon,authenticated,service_role;
grant usage on schema avh_inventory_private to authenticated;

create index inventory_load_edit_audit_idx on public.audit_events(movement_id,actor_id,(detail->>'request_id'))
  where action='inventory_load_edited';

-- Internal snapshot includes valuation for conflict detection and the admin audit only.
create function avh_inventory_private.load_snapshot(p_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
  select jsonb_build_object('movement',to_jsonb(m),'lines',(
    select jsonb_agg(to_jsonb(l)||jsonb_build_object('batch',to_jsonb(b),'product',jsonb_build_object('name',p.name,'base_unit',p.base_unit)) order by l.id)
    from public.movement_lines l join public.products p on p.id=l.product_id
    left join public.inventory_batches b on b.source_line_id=l.id where l.movement_id=m.id
  ),'revision',(select count(*) from public.audit_events a where a.movement_id=m.id and a.action='inventory_load_edited'))
  from public.movements m where m.id=p_id
$$;
revoke all on function avh_inventory_private.load_snapshot(uuid) from public,anon,authenticated,service_role;

create function avh_inventory_private.inventory_load(p_id uuid,p_command text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor public.profiles%rowtype; v_m public.movements%rowtype;
  v_session public.warehouse_opening_inventory%rowtype;
  v_before jsonb; v_after jsonb; v_version text; v_result jsonb; v_previous jsonb;
  v_request uuid; v_request_hash text; v_items jsonb; v_item jsonb;
  v_line public.movement_lines%rowtype; v_product public.products%rowtype;
  v_qty numeric; v_factor numeric; v_base numeric; v_unit text;
  v_notes text; v_reason text; v_label text; v_lot text;
  v_changed_conversion boolean; v_reset boolean:=false; v_count integer;
begin
  select * into v_actor from public.profiles where id=auth.uid() and active=true;
  if not found or v_actor.role<>'depositor' or v_actor.warehouse_id is null then
    raise exception 'Solo el depositario activo puede editar sus propias cargas.';
  end if;
  select * into v_m from public.movements where id=p_id;
  if not found or v_m.created_by is distinct from v_actor.id or v_m.warehouse_to_id is distinct from v_actor.warehouse_id
    or v_m.type not in ('initial','entry','return') then
    raise exception 'Solo podés editar las cargas que vos ingresaste en tu depósito.';
  end if;
  perform public.assert_can_access_warehouse(v_actor.warehouse_id);
  if p_command not in ('context','save') or p_command is null then raise exception 'Operación inválida.'; end if;
  if p_command='save' then
    if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Datos de edición inválidos.'; end if;
    v_request:=(p_payload->>'request_id')::uuid;
    if v_request is null then raise exception 'Falta el identificador de la edición. Volvé a intentar.'; end if;
    v_request_hash:=md5(p_payload::text);
    -- Opening session precedes the movement, as in the initial-count and closing RPCs.
    if v_m.type='initial' then
      select * into v_session from public.warehouse_opening_inventory where id=v_m.opening_session_id for update;
    end if;
    select * into v_m from public.movements where id=p_id for update;
    if v_m.created_by is distinct from v_actor.id or v_m.warehouse_to_id is distinct from v_actor.warehouse_id then
      raise exception 'Esta carga ya no está disponible para tu usuario.';
    end if;
    select detail into v_previous from public.audit_events where movement_id=p_id and actor_id=v_actor.id
      and action='inventory_load_edited' and detail->>'request_id'=v_request::text;
    if found then
      if v_previous->>'request_hash' is distinct from v_request_hash then raise exception 'Este identificador ya se usó para otros cambios.'; end if;
      return v_previous->'result';
    end if;
    -- NOWAIT avoids lock inversion with existing multi-product FIFO operations.
    perform 1 from public.movement_lines where movement_id=p_id order by id for update nowait;
    perform 1 from public.inventory_batches b join public.movement_lines l on l.id=b.source_line_id
      where l.movement_id=p_id order by b.id for update of b nowait;
  end if;
  if v_m.status<>'confirmed' or exists(select 1 from public.movements where corrected_movement_id=p_id) then
    raise exception 'Esta carga ya está anulada o corregida. Actualizá el inventario.';
  end if;
  if v_m.type='initial' and not exists(select 1 from public.warehouse_opening_inventory
    where id=v_m.opening_session_id and warehouse_id=v_actor.warehouse_id and status='open') then
    raise exception 'El inventario inicial está cerrado. Administración debe reabrirlo para corregir el conteo.';
  end if;
  if exists(select 1 from public.purchase_receipts where movement_id=p_id) then
    raise exception 'Esta carga es una recepción de compra. Pedí a Administración la corrección de la recepción.';
  end if;
  if exists(select 1 from public.fabrication_stock_links where movement_id=p_id) then
    raise exception 'Esta carga pertenece a Fabricación Naval. Corregila desde la orden de fabricación.';
  end if;
  if exists(select 1 from public.gas_events where movement_id=p_id or movement_line_id in(select id from public.movement_lines where movement_id=p_id)) then
    raise exception 'Esta carga pertenece al control de gases. Corregila desde Gases.';
  end if;
  if exists(select 1 from public.movement_lines l left join public.inventory_batches b on b.source_line_id=l.id
    where l.movement_id=p_id group by l.id having count(b.id)<>1) then
    raise exception 'Esta carga requiere revisión de Administración por su distribución de lotes.';
  end if;
  if exists(select 1 from public.inventory_batches b join public.movement_lines l on l.id=b.source_line_id
    where l.movement_id=p_id and (b.warehouse_id<>v_actor.warehouse_id or b.product_id<>l.product_id or b.quantity_received<>l.base_quantity)) then
    raise exception 'El lote no coincide con la carga original. Solicitá la revisión de Administración.';
  end if;
  if exists(select 1 from public.inventory_batches b join public.movement_lines l on l.id=b.source_line_id
    where l.movement_id=p_id and (b.quantity_remaining<>b.quantity_received or exists(select 1 from public.batch_allocations where batch_id=b.id))) then
    raise exception 'Esta carga ya fue utilizada en otro movimiento. Solicitá una corrección a Administración.';
  end if;
  v_before:=avh_inventory_private.load_snapshot(p_id); v_version:=md5(v_before::text);
  if p_command='context' then
    return jsonb_build_object('id',v_m.id,'movement_no',v_m.movement_no,'type',v_m.type,'warehouse_id',v_actor.warehouse_id,
      'notes',v_m.notes,'version',v_version,'lines',(
        select jsonb_agg(jsonb_build_object('line_id',l.id,'product_id',l.product_id,'product_name',p.name,'base_unit',p.base_unit,
          'quantity',l.quantity,'unit',l.unit,'factor_to_base',l.factor_to_base,'presentation_label',l.presentation_label,
          'lot_reference',b.lot_reference,'conversion_locked',v_m.type<>'initial' and l.entry_unit_cost is not null) order by l.id)
        from public.movement_lines l join public.products p on p.id=l.product_id join public.inventory_batches b on b.source_line_id=l.id where l.movement_id=p_id));
  end if;
  if p_payload->>'expected_version' is distinct from v_version then
    raise exception 'La carga cambió mientras la editabas. Volvé a abrirla para revisar la versión actual.';
  end if;
  v_items:=p_payload->'items'; v_reason:=nullif(trim(p_payload->>'reason'),''); v_notes:=nullif(trim(p_payload->>'notes'),'');
  if v_reason is null or length(v_reason)<3 or length(v_reason)>1000 then raise exception 'Escribí el motivo de la corrección (entre 3 y 1000 caracteres).'; end if;
  if length(v_notes)>2000 then raise exception 'La observación admite hasta 2000 caracteres.'; end if;
  if jsonb_typeof(v_items) is distinct from 'array' then raise exception 'Revisá los ítems de la carga.'; end if;
  select count(*) into v_count from public.movement_lines where movement_id=p_id;
  if v_count=0 or v_count>100 or jsonb_array_length(v_items)<>v_count then raise exception 'La edición debe conservar todos los ítems de la carga.'; end if;
  if exists(select 1 from jsonb_array_elements(v_items) x group by x->>'line_id' having count(*)>1)
    or exists(select 1 from jsonb_array_elements(v_items) x where jsonb_typeof(x)<>'object'
      or not exists(select 1 from public.movement_lines where id=(x->>'line_id')::uuid and movement_id=p_id)) then
    raise exception 'Los ítems no corresponden a la carga original.';
  end if;
  for v_item in select * from jsonb_array_elements(v_items) loop
    if exists(select 1 from jsonb_object_keys(v_item) k where k not in ('line_id','product_id','quantity','unit','factor_to_base','presentation_label','lot_reference')) then
      raise exception 'Solo podés editar producto, cantidad, unidad, equivalencia y lote.';
    end if;
    select * into v_line from public.movement_lines where id=(v_item->>'line_id')::uuid and movement_id=p_id;
    select * into v_product from public.products where id=(v_item->>'product_id')::uuid and active=true for share nowait;
    if not found then raise exception 'Elegí un producto activo del catálogo.'; end if;
    v_qty:=(v_item->>'quantity')::numeric; v_factor:=(v_item->>'factor_to_base')::numeric; v_unit:=nullif(trim(v_item->>'unit'),'');
    if v_qty is null or v_factor is null or v_qty<=0 or v_factor<=0 or v_qty::text in ('NaN','Infinity','-Infinity')
      or v_factor::text in ('NaN','Infinity','-Infinity') or v_qty>=1e12 or v_factor>=1e12
      or v_qty<>round(v_qty,6) or v_factor<>round(v_factor,6) then raise exception 'Cantidad o equivalencia inválida. Usá valores positivos con hasta 6 decimales.'; end if;
    v_base:=round(v_qty*v_factor,6);
    if v_base<=0 or v_base>=1e12 then raise exception 'La cantidad en la unidad base queda fuera del rango permitido.'; end if;
    if v_unit is null or length(v_unit)>80 or (v_unit=v_product.base_unit and v_factor<>1) then raise exception 'Revisá la unidad y su equivalencia.'; end if;
    if v_unit<>v_product.base_unit and v_unit<>v_line.unit
      and v_unit not in ('unidad','pieza','kg','tonelada','rollo','bobina','caja','paquete','bolsa','metro','m²','m³','litro','cilindro','tambor','pallet','plancha','barra','tubo','perfil','bidón','servicio','viaje','hora','día','otro')
      and not exists(select 1 from public.product_presentations where product_id=v_product.id and unit=v_unit) then raise exception 'Elegí una unidad válida.'; end if;
    v_label:=nullif(trim(v_item->>'presentation_label'),''); v_lot:=nullif(trim(v_item->>'lot_reference'),'');
    if length(v_label)>150 or length(v_lot)>200 then raise exception 'Revisá la presentación o el lote: el texto es demasiado largo.'; end if;
    v_changed_conversion:=v_product.id<>v_line.product_id or v_unit<>v_line.unit or v_factor<>v_line.factor_to_base;
    if v_changed_conversion and v_line.entry_unit_cost is not null and v_m.type<>'initial' then
      raise exception 'Esta entrada o devolución ya está valorizada. Administración debe revisar su producto o unidad. Podés corregir la cantidad.';
    end if;
    v_reset:=v_reset or (v_changed_conversion and v_line.entry_unit_cost is not null);
    update public.movement_lines set product_id=v_product.id,quantity=v_qty,unit=v_unit,factor_to_base=v_factor,presentation_label=v_label,
      entry_unit_cost=case when v_changed_conversion then null else entry_unit_cost end,
      entry_currency=case when v_changed_conversion then null else entry_currency end,
      exchange_rate=case when v_changed_conversion then null else exchange_rate end where id=v_line.id;
    update public.inventory_batches set product_id=v_product.id,quantity_received=v_base,quantity_remaining=v_base,lot_reference=v_lot,
      unit_cost=case when v_changed_conversion then null else unit_cost end,
      currency=case when v_changed_conversion then null else currency end,
      exchange_rate=case when v_changed_conversion then null else exchange_rate end where source_line_id=v_line.id;
  end loop;
  update public.movements set notes=v_notes where id=p_id;
  v_after:=avh_inventory_private.load_snapshot(p_id);
  v_after:=jsonb_set(v_after,'{revision}',to_jsonb((v_after->>'revision')::bigint+1));
  v_result:=jsonb_build_object('movement_id',p_id,'version',md5(v_after::text),'price_review_required',v_reset);
  insert into public.audit_events(entity_type,entity_id,action,actor_id,warehouse_id,movement_id,detail)
  values('movement',p_id,'inventory_load_edited',v_actor.id,v_actor.warehouse_id,p_id,
    jsonb_build_object('request_id',v_request,'request_hash',v_request_hash,'reason',v_reason,'before',v_before,'after',v_after,'result',v_result));
  return v_result;
exception when lock_not_available then
  raise exception 'Hay otra operación usando esta carga. Esperá un momento y volvé a intentar.';
end $$;
revoke all on function avh_inventory_private.inventory_load(uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function avh_inventory_private.inventory_load(uuid,text,jsonb) to authenticated;

create function public.inventory_load_edit_context(p_movement_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
  select avh_inventory_private.inventory_load(p_movement_id,'context','{}'::jsonb)
$$;
create function public.edit_inventory_load(p_movement_id uuid,p_expected_version text,p_items jsonb,p_notes text,p_reason text,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select avh_inventory_private.inventory_load(p_movement_id,'save',jsonb_build_object('expected_version',p_expected_version,
    'items',p_items,'notes',p_notes,'reason',p_reason,'request_id',p_request_id))
$$;
revoke all on function public.inventory_load_edit_context(uuid),public.edit_inventory_load(uuid,text,jsonb,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.inventory_load_edit_context(uuid),public.edit_inventory_load(uuid,text,jsonb,text,text,uuid) to authenticated;
comment on function public.edit_inventory_load(uuid,text,jsonb,text,text,uuid) is 'Edición auditada e idempotente de cargas propias no utilizadas; valida autor, depósito, sesión inicial, versión y lotes en el servidor.';
notify pgrst,'reload schema';
commit;
