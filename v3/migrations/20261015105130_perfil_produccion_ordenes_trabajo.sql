-- Cuenta técnica independiente del depósito; los permisos de stock no cambian.
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin','depositor','production'));
alter table public.profiles add constraint production_without_warehouse check (role <> 'production' or warehouse_id is null);

-- Solo el servicio de alta, después de validar la sesión administradora, puede
-- crear el perfil y su autorización en una misma transacción.
create function avh_work_order_private.provision_user(p_user_id uuid,p_username text,p_full_name text,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user jsonb;
begin
 if p_actor_id is null or not exists(select 1 from public.profiles where id=p_actor_id and role='admin' and active) then
  raise exception 'Solo un administrador activo puede crear usuarios.';
 end if;
 if p_user_id is null or p_user_id=p_actor_id or p_username is null or p_username !~ '^[a-z0-9][a-z0-9._-]{1,38}[a-z0-9]$'
  or p_username in ('admin','admin.avh','administrador','administrador.avh') or length(coalesce(p_full_name,''))>200 then
  raise exception 'Datos de usuario inválidos.';
 end if;
 insert into public.profiles(id,username,full_name,role,warehouse_id,active,must_change_password,password_changed_at)
 values(p_user_id,p_username,nullif(trim(p_full_name),''),'production',null,true,true,null);
 insert into public.work_order_access(user_id,access_level,granted_by) values(p_user_id,'editor',p_actor_id);
 insert into public.audit_events(entity_type,entity_id,action,actor_id,detail)
 values('profile',p_user_id,'production_user_created',p_actor_id,jsonb_build_object('username',p_username,'role','production','access_level','editor'));
 select to_jsonb(p) into v_user from public.profiles p where id=p_user_id;
 return jsonb_build_object('ok',true,'user',v_user);
end $$;
revoke all on function avh_work_order_private.provision_user(uuid,text,text,uuid) from public,anon,authenticated;
grant usage on schema avh_work_order_private to service_role;
grant execute on function avh_work_order_private.provision_user(uuid,text,text,uuid) to service_role;
create function public.provision_work_order_user(p_user_id uuid,p_username text,p_full_name text,p_actor_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select avh_work_order_private.provision_user(p_user_id,p_username,p_full_name,p_actor_id)
$$;
revoke all on function public.provision_work_order_user(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.provision_work_order_user(uuid,text,text,uuid) to service_role;

create function avh_work_order_private.update_user(p_user_id uuid,p_active boolean,p_full_name text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or public.current_profile_role() is distinct from 'admin' then raise exception 'Solo administrador.';end if;
 if p_user_id=auth.uid() or not exists(select 1 from public.profiles where id=p_user_id and role='production') then
  raise exception 'Usuario de Producción inválido.';
 end if;
 if length(coalesce(p_full_name,''))>200 then raise exception 'El nombre es demasiado largo.';end if;
 update public.profiles set active=coalesce(p_active,active),full_name=case when p_full_name is null then full_name else nullif(trim(p_full_name),'') end
 where id=p_user_id and role='production';
end $$;
revoke all on function avh_work_order_private.update_user(uuid,boolean,text) from public,anon;
grant execute on function avh_work_order_private.update_user(uuid,boolean,text) to authenticated;
create function public.admin_update_work_order_user(p_user_id uuid,p_active boolean default null,p_full_name text default null)
returns void language sql security invoker set search_path='' as $$
 select avh_work_order_private.update_user(p_user_id,p_active,p_full_name)
$$;
revoke all on function public.admin_update_work_order_user(uuid,boolean,text) from public,anon;
grant execute on function public.admin_update_work_order_user(uuid,boolean,text) to authenticated;
