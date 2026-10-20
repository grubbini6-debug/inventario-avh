begin;
create function avh_gas_private.ensure_presentation(p_warehouse_id uuid,p_gas_kind text,p_kg_per_cylinder numeric)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u public.profiles; g public.gas_products; p uuid; label text; size text; v_sku text; created boolean:=false; result jsonb;
begin
 select * into u from public.profiles where id=auth.uid() and active;
 if not found or u.role not in ('admin','depositor') then raise exception 'Usuario no autorizado';end if;
 perform public.assert_can_access_warehouse(p_warehouse_id);
 if not exists(select 1 from public.warehouses where id=p_warehouse_id and active) then raise exception 'Depósito inexistente o inactivo';end if;
 if p_gas_kind is null or p_gas_kind not in ('co2','oxygen','glp') then raise exception 'Gas inválido';end if;
 if p_kg_per_cylinder is null or p_kg_per_cylinder::text in ('NaN','Infinity','-Infinity') or p_kg_per_cylinder<=0 or p_kg_per_cylinder>1000 or p_kg_per_cylinder<>round(p_kg_per_cylinder,3) then
  raise exception 'Indicá los kg por cilindro: un peso mayor que cero, hasta 1000 kg y con hasta tres decimales';
 end if;
 size:=trim_scale(p_kg_per_cylinder)::text;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('avh:gas:'||p_gas_kind||':'||size,0));
 select * into g from public.gas_products where gas_kind=p_gas_kind and kg_per_cylinder=p_kg_per_cylinder;
 if found then
  if not exists(select 1 from public.products where id=g.product_id and active) then raise exception 'La presentación está inactiva. Pedí a administración que la revise';end if;
 else
  label:=case p_gas_kind when 'co2' then 'CO₂' when 'oxygen' then 'Oxígeno' else 'GLP' end;
  v_sku:='GAS-'||case p_gas_kind when 'oxygen' then 'O2' else upper(p_gas_kind) end||'-'||size||'KG';
  if exists(select 1 from public.products x where x.sku=v_sku or x.name=label||' cilindro '||size||' kg') then raise exception 'Ya existe un producto con esa presentación. Pedí a administración que lo vincule al control de gases';end if;
  insert into public.products(sku,name,base_unit,created_by) values(v_sku,label||' cilindro '||size||' kg','cilindro',u.id) returning id into p;
  insert into public.gas_products(product_id,gas_kind,gas_name,sort_order,kg_per_cylinder)
   values(p,p_gas_kind,label||' · '||size||' kg',case p_gas_kind when 'co2' then 1 when 'oxygen' then 2 else 3 end,p_kg_per_cylinder) returning * into g;
  insert into public.gas_controls(warehouse_id,product_id) select id,p from public.warehouses where active;
  insert into public.audit_events(entity_type,entity_id,action,actor_id,warehouse_id,detail)
   values('gas',p,'gas_presentation_created',u.id,p_warehouse_id,jsonb_build_object('gas_kind',p_gas_kind,'kg_per_cylinder',p_kg_per_cylinder,'unit','cilindro'));
  created:=true;
 end if;
 -- A newly created catalog entry is not a physical count or a stock movement.
 select to_jsonb(v) into result from public.v_gas_stock_status v where warehouse_id=p_warehouse_id and product_id=g.product_id;
 return result||jsonb_build_object('created',created);
end $$;
create function public.gas_ensure_presentation(p_warehouse_id uuid,p_gas_kind text,p_kg_per_cylinder numeric)
returns jsonb language sql security invoker set search_path='' as $$select avh_gas_private.ensure_presentation(p_warehouse_id,p_gas_kind,p_kg_per_cylinder)$$;
revoke all on function avh_gas_private.ensure_presentation(uuid,text,numeric) from public,anon,authenticated;
grant execute on function avh_gas_private.ensure_presentation(uuid,text,numeric) to authenticated;
revoke all on function public.gas_ensure_presentation(uuid,text,numeric) from public,anon,authenticated;
grant execute on function public.gas_ensure_presentation(uuid,text,numeric) to authenticated;

-- Snapshot the actual presentation on every event, including ordinary inventory
-- receipts/transfers. Empty returns have zero gas kg even for a known size.
create or replace function avh_gas_private.event(p_before jsonb,p_action text,p_qty integer,p_full numeric,p_empty integer,p_outside integer,p_supplier integer,p_person text,p_destination text,p_reference text,p_notes text,p_movement uuid default null,p_line uuid default null,p_detail jsonb default '{}'::jsonb)
returns uuid language plpgsql set search_path='' as $$
declare v_id uuid; v_w uuid:=(p_before->>'warehouse_id')::uuid; v_p uuid:=(p_before->>'product_id')::uuid; v_kg numeric; v_detail jsonb;
begin
 select kg_per_cylinder into v_kg from public.gas_products where product_id=v_p;
 v_detail:=p_detail||jsonb_build_object('kg_per_cylinder',v_kg,'gas_kg_delta',case when p_full=0 then 0 when v_kg is not null then p_full*v_kg end);
 update public.gas_controls set empty_qty=empty_qty+p_empty,version=version+1 where warehouse_id=v_w and product_id=v_p;
 insert into public.gas_events(warehouse_id,product_id,action,quantity,full_delta,empty_delta,outside_delta,supplier_delta,full_before,full_after,empty_before,empty_after,person,destination,reference,notes,movement_id,movement_line_id,actor_id,actor_name,detail)
 values(v_w,v_p,p_action,p_qty,p_full,p_empty,p_outside,p_supplier,(p_before->>'full_qty')::numeric,(p_before->>'full_qty')::numeric+p_full,(p_before->>'empty_qty')::integer,(p_before->>'empty_qty')::integer+p_empty,p_person,p_destination,p_reference,p_notes,p_movement,p_line,auth.uid(),coalesce((select coalesce(nullif(p.full_name,''),p.username) from public.profiles p where p.id=auth.uid()),'Usuario'),v_detail)
 returning id into v_id;
 insert into public.audit_events(entity_type,entity_id,action,actor_id,warehouse_id,movement_id,detail)
 values('gas',v_id,'gas_'||p_action,auth.uid(),v_w,p_movement,jsonb_build_object('product_id',v_p,'full_delta',p_full,'empty_delta',p_empty,'outside_delta',p_outside,'supplier_delta',p_supplier,'person',p_person,'reference',p_reference)||v_detail);
 return v_id;
end $$;
revoke all on function avh_gas_private.event(jsonb,text,integer,numeric,integer,integer,integer,text,text,text,text,uuid,uuid,jsonb) from public,anon,authenticated;
commit;
