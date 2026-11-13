-- Physical recounts change today's balance, preserving every original stock load.
begin;
create schema if not exists avh_inventory_private;
revoke all on schema avh_inventory_private from public,anon;
grant usage on schema avh_inventory_private to authenticated;

create unique index inventory_recount_request_idx on public.audit_events(actor_id,(detail->>'request_id'))
  where action='inventory_recounted';

create function avh_inventory_private.recount_snapshot(p_warehouse uuid,p_product uuid) returns jsonb
language sql security invoker set search_path='' as $$
  select jsonb_build_object('stock_qty',coalesce(sum(b.quantity_remaining),0),'batches',coalesce(jsonb_agg(
    jsonb_build_object('id',b.id,'source_line_id',b.source_line_id,'received',b.quantity_received,'remaining',b.quantity_remaining,
      'unit_cost',b.unit_cost,'currency',b.currency,'exchange_rate',b.exchange_rate) order by b.received_at,b.created_at,b.id),'[]'::jsonb),
    'revision',(select count(*) from public.audit_events a where a.action='inventory_recounted'
      and a.warehouse_id=p_warehouse and a.entity_id=p_product))
  from public.inventory_batches b where b.warehouse_id=p_warehouse and b.product_id=p_product
$$;
revoke all on function avh_inventory_private.recount_snapshot(uuid,uuid) from public,anon,authenticated,service_role;

create function avh_inventory_private.recount(p_warehouse uuid,p_product uuid,p_command text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor public.profiles%rowtype; v_product public.products%rowtype;
  v_before jsonb; v_after jsonb; v_previous jsonb; v_version text; v_hash text; v_request uuid;
  v_count numeric; v_stock numeric; v_delta numeric; v_need numeric; v_take numeric;
  v_reason text; v_movement uuid; v_line uuid; v_audit uuid; v_batch record; v_result jsonb; v_gas boolean;
begin
  select * into v_actor from public.profiles where id=auth.uid() and active for share nowait;
  if not found or v_actor.role<>'depositor' or v_actor.warehouse_id is distinct from p_warehouse or p_warehouse is null then
    raise exception 'Solo el depositario activo puede corregir cantidades en su depósito asignado.';
  end if;
  perform public.assert_can_access_warehouse(p_warehouse);
  if not exists(select 1 from public.warehouses where id=p_warehouse and active) then raise exception 'El depósito está inactivo.'; end if;
  select * into v_product from public.products where id=p_product and active for share nowait;
  if not found then raise exception 'Elegí un producto activo del catálogo.'; end if;
  if p_command is null or p_command not in ('context','save') then raise exception 'Operación de conteo inválida.'; end if;
  v_gas:=exists(select 1 from public.gas_products where product_id=p_product);
  if p_command='save' then
    if v_gas then raise exception 'Corregí los cilindros desde Gases → Nuevo conteo, incluyendo llenos y vacíos.'; end if;
    if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Conteo inválido.'; end if;
    v_count:=(p_payload->>'counted_qty')::numeric;v_reason:=nullif(trim(p_payload->>'reason'),'');v_request:=(p_payload->>'request_id')::uuid;
    if v_count is null or v_count<0 or v_count>=1e12 or v_count::text in ('NaN','Infinity','-Infinity') or v_count<>round(v_count,6) then
      raise exception 'La cantidad debe ser igual o mayor que cero, finita y con hasta 6 decimales.';
    end if;
    if v_reason is null or length(v_reason) not between 3 and 1000 then raise exception 'Escribí el motivo del conteo (entre 3 y 1000 caracteres).'; end if;
    if v_request is null then raise exception 'Falta el identificador del conteo. Volvé a intentar.'; end if;
    v_hash:=md5(jsonb_build_object('warehouse',p_warehouse,'product',p_product,'counted_qty',v_count,'reason',v_reason,'version',p_payload->>'expected_version')::text);
    perform pg_advisory_xact_lock(hashtextextended('inventory-recount-request:'||v_actor.id::text||':'||v_request::text,0));
    select detail into v_previous from public.audit_events where actor_id=v_actor.id and action='inventory_recounted' and detail->>'request_id'=v_request::text;
    if found then
      if v_previous->>'request_hash' is distinct from v_hash then raise exception 'Este identificador ya se usó para otro conteo.'; end if;
      return v_previous->'result';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('inventory-recount:'||p_warehouse::text||':'||p_product::text,0));
    -- Same FIFO lock order as exits and manufacturing; never wait through an inversion.
    perform 1 from public.inventory_batches b where b.warehouse_id=p_warehouse and b.product_id=p_product
      order by b.product_id,b.received_at,b.created_at,b.id for update nowait;
  end if;
  v_before:=avh_inventory_private.recount_snapshot(p_warehouse,p_product);
  v_version:=md5((v_before||jsonb_build_object('base_unit',v_product.base_unit))::text);
  v_stock:=(v_before->>'stock_qty')::numeric;
  if p_command='context' then
    return jsonb_build_object('warehouse_id',p_warehouse,'product_id',p_product,'product_name',v_product.name,
      'base_unit',v_product.base_unit,'stock_qty',v_stock,'version',v_version,'gas_managed',v_gas);
  end if;
  if p_payload->>'expected_version' is distinct from v_version then
    raise exception 'El stock cambió mientras contabas. Volvé a consultar y revisá las cantidades antes de guardar.';
  end if;
  v_delta:=v_count-v_stock;
  if v_delta<>0 then
    insert into public.movements(type,status,warehouse_from_id,warehouse_to_id,notes,created_by,client_request_id)
    values('adjustment','confirmed',case when v_delta<0 then p_warehouse end,case when v_delta>0 then p_warehouse end,
      'Nuevo conteo de inventario: '||v_reason,v_actor.id,v_request) returning id into v_movement;
    insert into public.movement_lines(movement_id,product_id,quantity,unit,factor_to_base)
    values(v_movement,p_product,abs(v_delta),v_product.base_unit,1) returning id into v_line;
    if v_delta>0 then
      -- An unpriced physical surplus must never invent a supplier price.
      insert into public.inventory_batches(warehouse_id,product_id,source_line_id,quantity_received,quantity_remaining,lot_reference)
      values(p_warehouse,p_product,v_line,v_delta,v_delta,'CONTEO FÍSICO');
    else
      v_need:=-v_delta;
      for v_batch in select * from public.inventory_batches where warehouse_id=p_warehouse and product_id=p_product and quantity_remaining>0
        order by received_at,created_at,id for update loop
        exit when v_need<=0;
        v_take:=least(v_need,v_batch.quantity_remaining);
        -- The existing reservation guard also protects material committed to fabrication.
        update public.inventory_batches set quantity_remaining=quantity_remaining-v_take where id=v_batch.id;
        insert into public.batch_allocations(movement_line_id,batch_id,quantity,unit_cost,currency,exchange_rate)
        values(v_line,v_batch.id,v_take,v_batch.unit_cost,v_batch.currency,v_batch.exchange_rate);
        v_need:=v_need-v_take;
      end loop;
      if v_need<>0 then raise exception 'El stock cambió mientras contabas. Volvé a consultar el inventario.'; end if;
    end if;
  end if;
  v_after:=avh_inventory_private.recount_snapshot(p_warehouse,p_product);
  if (v_after->>'stock_qty')::numeric<>v_count then raise exception 'El stock cambió mientras contabas. Volvé a consultar el inventario.'; end if;
  v_result:=jsonb_build_object('movement_id',v_movement,'stock_before',v_stock,'stock_after',v_count,'difference',v_delta,'base_unit',v_product.base_unit);
  insert into public.audit_events(entity_type,entity_id,action,actor_id,warehouse_id,movement_id,detail)
  values('inventory',p_product,'inventory_recounted',v_actor.id,p_warehouse,v_movement,
    jsonb_build_object('request_id',v_request,'request_hash',v_hash,'product_id',p_product,'reason',v_reason,
      'stock_before',v_stock,'stock_after',v_count,'difference',v_delta,'base_unit',v_product.base_unit,'before',v_before,'after',v_after,'result',v_result)) returning id into v_audit;
  insert into public.notifications(user_id,kind,title,body,metadata,dedupe_key)
  select id,'inventory_recount','Inventario corregido: '||v_product.name,
    format('%s registró %s %s; antes figuraban %s. Motivo: %s.',coalesce(v_actor.full_name,v_actor.username),v_count,v_product.base_unit,v_stock,v_reason),
    v_result||jsonb_build_object('warehouse_id',p_warehouse,'product_id',p_product,'actor_id',v_actor.id,'audit_id',v_audit),
    'inventory-recount:'||v_audit::text from public.profiles where role='admin' and active;
  return v_result;
exception when lock_not_available then
  raise exception 'Hay otra operación usando este inventario. Esperá un momento y volvé a consultar.';
end $$;
revoke all on function avh_inventory_private.recount(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function avh_inventory_private.recount(uuid,uuid,text,jsonb) to authenticated;

create function public.inventory_recount_context(p_warehouse_id uuid,p_product_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
  select avh_inventory_private.recount(p_warehouse_id,p_product_id,'context','{}'::jsonb)
$$;
create function public.record_inventory_recount(p_warehouse_id uuid,p_product_id uuid,p_counted_qty numeric,p_expected_version text,p_reason text,p_request_id uuid) returns jsonb
language sql security invoker set search_path='' as $$
  select avh_inventory_private.recount(p_warehouse_id,p_product_id,'save',jsonb_build_object(
    'counted_qty',p_counted_qty,'expected_version',p_expected_version,'reason',p_reason,'request_id',p_request_id))
$$;
revoke all on function public.inventory_recount_context(uuid,uuid),public.record_inventory_recount(uuid,uuid,numeric,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.inventory_recount_context(uuid,uuid),public.record_inventory_recount(uuid,uuid,numeric,text,text,uuid) to authenticated;
comment on function public.record_inventory_recount(uuid,uuid,numeric,text,text,uuid) is 'Conteo físico auditado e idempotente en el depósito asignado, con versión del saldo, diferencias FIFO y protección de reservas. No reemplaza cargas ni recepciones históricas.';
notify pgrst,'reload schema';
commit;
