-- La sede de Producción y su consulta de stock son independientes del permiso
-- de operar un depósito: profiles.warehouse_id permanece reservado al depositario.
alter table public.profiles add column work_location text check (length(work_location)<=200);
alter table public.profiles add column inventory_warehouse_id uuid references public.warehouses(id);
alter table public.profiles add constraint production_inventory_scope check (role='production' or inventory_warehouse_id is null);
create index profiles_inventory_warehouse_idx on public.profiles(inventory_warehouse_id) where inventory_warehouse_id is not null;

create function avh_work_order_private.validate_location(p_work_location text,p_inventory_warehouse_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if length(coalesce(p_work_location,''))>200 then raise exception 'El lugar de trabajo es demasiado largo.';end if;
 if p_inventory_warehouse_id is not null and not exists(select 1 from public.warehouses where id=p_inventory_warehouse_id and active) then
  raise exception 'El inventario elegido no existe o está inactivo.';
 end if;
end $$;
revoke all on function avh_work_order_private.validate_location(text,uuid) from public,anon,authenticated;

-- Se conserva el alta anterior de cuatro argumentos para clientes en caché.
create function avh_work_order_private.provision_user(p_user_id uuid,p_username text,p_full_name text,p_actor_id uuid,p_work_location text,p_inventory_warehouse_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
 perform avh_work_order_private.validate_location(p_work_location,p_inventory_warehouse_id);
 v_result:=avh_work_order_private.provision_user(p_user_id,p_username,p_full_name,p_actor_id);
 update public.profiles set work_location=nullif(trim(p_work_location),''),inventory_warehouse_id=p_inventory_warehouse_id where id=p_user_id;
 insert into public.audit_events(entity_type,entity_id,action,actor_id,detail)
 values('profile',p_user_id,'production_location_assigned',p_actor_id,jsonb_build_object('work_location',nullif(trim(p_work_location),''),'inventory_warehouse_id',p_inventory_warehouse_id,'access','read_only'));
 select to_jsonb(p) into v_result from public.profiles p where id=p_user_id;
 return jsonb_build_object('ok',true,'user',v_result);
end $$;
revoke all on function avh_work_order_private.provision_user(uuid,text,text,uuid,text,uuid) from public,anon,authenticated;
grant execute on function avh_work_order_private.provision_user(uuid,text,text,uuid,text,uuid) to service_role;
create function public.provision_work_order_user(p_user_id uuid,p_username text,p_full_name text,p_actor_id uuid,p_work_location text,p_inventory_warehouse_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select avh_work_order_private.provision_user(p_user_id,p_username,p_full_name,p_actor_id,p_work_location,p_inventory_warehouse_id)
$$;
revoke all on function public.provision_work_order_user(uuid,text,text,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.provision_work_order_user(uuid,text,text,uuid,text,uuid) to service_role;

create function avh_work_order_private.update_user(p_user_id uuid,p_active boolean,p_full_name text,p_work_location text,p_inventory_warehouse_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_previous jsonb;
begin
 -- La función existente verifica sesión, administrador activo y perfil destino.
 perform avh_work_order_private.update_user(p_user_id,p_active,p_full_name);
 perform avh_work_order_private.validate_location(p_work_location,p_inventory_warehouse_id);
 select jsonb_build_object('work_location',work_location,'inventory_warehouse_id',inventory_warehouse_id) into v_previous from public.profiles where id=p_user_id;
 update public.profiles set work_location=nullif(trim(p_work_location),''),inventory_warehouse_id=p_inventory_warehouse_id where id=p_user_id;
 insert into public.audit_events(entity_type,entity_id,action,actor_id,detail)
 values('profile',p_user_id,'production_location_updated',auth.uid(),jsonb_build_object('previous',v_previous,'work_location',nullif(trim(p_work_location),''),'inventory_warehouse_id',p_inventory_warehouse_id,'access','read_only'));
end $$;
revoke all on function avh_work_order_private.update_user(uuid,boolean,text,text,uuid) from public,anon;
grant execute on function avh_work_order_private.update_user(uuid,boolean,text,text,uuid) to authenticated;
create function public.admin_update_work_order_user(p_user_id uuid,p_active boolean,p_full_name text,p_work_location text,p_inventory_warehouse_id uuid)
returns void language sql security invoker set search_path='' as $$
 select avh_work_order_private.update_user(p_user_id,p_active,p_full_name,p_work_location,p_inventory_warehouse_id)
$$;
revoke all on function public.admin_update_work_order_user(uuid,boolean,text,text,uuid) from public,anon;
grant execute on function public.admin_update_work_order_user(uuid,boolean,text,text,uuid) to authenticated;

-- Solo cantidades y mínimos. No expone lotes, precios, proveedores ni movimientos.
-- El depósito se toma del perfil verificado, nunca de un parámetro del cliente.
create function avh_work_order_private.inventory(p_after uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_profile public.profiles;v_warehouse jsonb;v_items jsonb;v_next uuid;
begin
 if auth.uid() is null then raise exception 'Sesión requerida.';end if;
 select * into v_profile from public.profiles where id=auth.uid() and active and role='production';
 if not found then raise exception 'Consulta disponible para un usuario activo de Producción.';end if;
 select jsonb_build_object('id',id,'name',name) into v_warehouse from public.warehouses where id=v_profile.inventory_warehouse_id and active;
 if v_warehouse is null then return jsonb_build_object('work_location',v_profile.work_location,'warehouse',null,'items','[]'::jsonb,'next_cursor',null,'updated_at',now());end if;
 with balances as (
  select product_id,sum(quantity_remaining) stock_qty from public.inventory_batches
  where warehouse_id=v_profile.inventory_warehouse_id and quantity_remaining>0 group by product_id
 ), rows as (
  select p.id product_id,p.name product_name,p.base_unit,coalesce(b.stock_qty,0) stock_qty,m.minimum_qty
  from public.products p left join balances b on b.product_id=p.id
  left join public.stock_minimums m on m.product_id=p.id and m.warehouse_id=v_profile.inventory_warehouse_id
  where (b.stock_qty>0 or m.minimum_qty>0) and (p_after is null or p.id>p_after)
  order by p.id limit 501
 )
 select coalesce((select jsonb_agg(to_jsonb(r) order by r.product_id) from (select * from rows order by product_id limit 500) r),'[]'::jsonb),
  case when (select count(*) from rows)>500 then (select product_id from rows order by product_id offset 499 limit 1) end
 into v_items,v_next;
 return jsonb_build_object('work_location',v_profile.work_location,'warehouse',v_warehouse,'items',v_items,'next_cursor',v_next,'updated_at',now());
end $$;
revoke all on function avh_work_order_private.inventory(uuid) from public,anon;
grant execute on function avh_work_order_private.inventory(uuid) to authenticated;
create function public.work_order_inventory(p_after uuid default null)
returns jsonb language sql security invoker set search_path='' as $$ select avh_work_order_private.inventory(p_after) $$;
revoke all on function public.work_order_inventory(uuid) from public,anon;
grant execute on function public.work_order_inventory(uuid) to authenticated;
