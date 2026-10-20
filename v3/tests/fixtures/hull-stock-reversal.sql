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

revoke all on function public.admin_void_movement(uuid,text) from public,anon;
grant execute on function public.admin_void_movement(uuid,text) to authenticated;
