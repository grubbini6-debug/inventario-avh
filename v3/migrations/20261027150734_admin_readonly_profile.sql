-- A distinct role: read access never impersonates an operational administrator.
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
 check(role in ('admin','depositor','production','admin_viewer'));
alter table public.profiles add constraint admin_viewer_without_warehouse
 check(role <> 'admin_viewer' or (warehouse_id is null and inventory_warehouse_id is null));

create schema if not exists avh_readonly_private;
revoke all on schema avh_readonly_private from public,anon;
grant usage on schema avh_readonly_private to authenticated,service_role;

create function avh_readonly_private.can_read()
returns boolean language sql stable security definer set search_path=''
as $$select exists(select 1 from public.profiles
 where id=(select auth.uid()) and role='admin_viewer' and active and not must_change_password)$$;
create function avh_readonly_private.is_viewer()
returns boolean language sql stable security definer set search_path=''
as $$select exists(select 1 from public.profiles where id=(select auth.uid()) and role='admin_viewer')$$;
revoke all on function avh_readonly_private.can_read(),avh_readonly_private.is_viewer() from public,anon;
grant execute on function avh_readonly_private.can_read(),avh_readonly_private.is_viewer() to authenticated,service_role;

-- SECURITY DEFINER business commands can bypass RLS, so a trigger also denies
-- their writes. Changing one's own password is the only permitted profile update.
create function avh_readonly_private.reject_write()
returns trigger language plpgsql security definer set search_path=''
as $$begin
 if avh_readonly_private.is_viewer() then
  if tg_table_schema='public' and tg_table_name='profiles' and tg_op='UPDATE' then
   if old.id=(select auth.uid()) and new.id=old.id
     and (to_jsonb(new)-array['must_change_password','password_changed_at'])
       is not distinct from (to_jsonb(old)-array['must_change_password','password_changed_at'])
     and not new.must_change_password and new.password_changed_at is not null then
    return new;
   end if;
  end if;
  raise exception 'Administrador de solo lectura: no puede modificar datos.' using errcode='42501';
 end if;
 if tg_op='DELETE' then return old;end if;
 return new;
end$$;
revoke all on function avh_readonly_private.reject_write() from public,anon,authenticated;

-- Explicit list of current business tables. Tokens and legacy deployment assets
-- are not granted by this role; new tables require an explicit migration.
do $$declare t text;begin
 foreach t in array array[
  'audit_events','barges','batch_allocations','commercial_document_events','commercial_documents',
  'correction_requests','documents','fabrication_access','fabrication_attachments',
  'fabrication_closures','fabrication_components','fabrication_events','fabrication_logs',
  'fabrication_materials','fabrication_orders','fabrication_quality_checks','fabrication_reports',
  'fabrication_settings','fabrication_stock_links','fabrication_workers','gas_controls',
  'gas_custody','gas_events','gas_products','inventory_batches','movement_lines','movements',
  'notifications','product_deletion_requests','product_presentations','product_requests',
  'products','profiles','purchase_companies','purchase_documents','purchase_items',
  'purchase_receipt_items','purchase_receipts','purchases','stock_minimums','suppliers',
  'supply_requests','warehouse_opening_inventory','warehouses','work_order_access',
  'work_order_events','work_order_progress','work_order_quality','work_orders'
 ] loop
  if to_regclass('public.'||t) is null then continue;end if;
  execute format('alter table public.%I enable row level security',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy admin_viewer_read on public.%I for select to authenticated using ((select avh_readonly_private.can_read()))',t);
 end loop;
 -- Restrictive policies combine with all existing permissive policies; the
 -- trigger additionally protects RLS-bypassing commands, including legacy RPCs.
 for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r' loop
  execute format('create policy admin_viewer_no_insert on public.%I as restrictive for insert to authenticated with check(not (select avh_readonly_private.is_viewer()))',t);
  execute format('create policy admin_viewer_no_update on public.%I as restrictive for update to authenticated using(not (select avh_readonly_private.is_viewer())) with check(not (select avh_readonly_private.is_viewer()))',t);
  execute format('create policy admin_viewer_no_delete on public.%I as restrictive for delete to authenticated using(not (select avh_readonly_private.is_viewer()))',t);
  execute format('create trigger admin_viewer_reject_write before insert or update or delete on public.%I for each row execute function avh_readonly_private.reject_write()',t);
 end loop;
end$$;

create policy admin_viewer_registered_files on storage.objects for select to authenticated using(
 (select avh_readonly_private.can_read()) and (
  (bucket_id='purchase-documents' and exists(select 1 from public.purchase_documents d where d.file_path=name)) or
  (bucket_id='inventory-documents' and exists(select 1 from public.documents d where d.file_path=name)) or
  (bucket_id='fabrication-documents' and exists(select 1 from public.fabrication_attachments a where a.file_path=name)) or
  (bucket_id='work-order-documents' and exists(select 1 from public.work_orders o where o.source_file_path=name))
 ));
create policy admin_viewer_no_insert on storage.objects as restrictive for insert to authenticated
 with check(not (select avh_readonly_private.is_viewer()));
create policy admin_viewer_no_update on storage.objects as restrictive for update to authenticated
 using(not (select avh_readonly_private.is_viewer())) with check(not (select avh_readonly_private.is_viewer()));
create policy admin_viewer_no_delete on storage.objects as restrictive for delete to authenticated
 using(not (select avh_readonly_private.is_viewer()));

create function avh_readonly_private.update_user(p_user_id uuid,p_active boolean default null,p_full_name text default null)
returns void language plpgsql security definer set search_path=''
as $$begin
 if public.current_profile_role() is distinct from 'admin' then raise exception 'Solo administrador.' using errcode='42501';end if;
 if p_full_name is not null and length(p_full_name)>200 then raise exception 'El nombre admite hasta 200 caracteres.';end if;
 update public.profiles set active=coalesce(p_active,active),
  full_name=case when p_full_name is null then full_name else nullif(trim(p_full_name),'') end
 where id=p_user_id and role='admin_viewer' and id<>(select auth.uid());
 if not found then raise exception 'Usuario de solo lectura inválido.';end if;
 insert into public.audit_events(entity_type,entity_id,action,actor_id,detail)
 values('profile',p_user_id,'readonly_user_updated',auth.uid(),jsonb_build_object('active',p_active,'full_name',p_full_name));
end$$;
revoke all on function avh_readonly_private.update_user(uuid,boolean,text) from public,anon;
grant execute on function avh_readonly_private.update_user(uuid,boolean,text) to authenticated;
create function public.admin_update_readonly_user(p_user_id uuid,p_active boolean default null,p_full_name text default null)
returns void language sql security invoker set search_path=''
as $$select avh_readonly_private.update_user(p_user_id,p_active,p_full_name)$$;
revoke all on function public.admin_update_readonly_user(uuid,boolean,text) from public,anon;
grant execute on function public.admin_update_readonly_user(uuid,boolean,text) to authenticated;

-- Preserve the FIFO view's explicit role gate as well as its underlying RLS.
create or replace view public.v_barge_module_consumption
with (security_invoker=true,security_barrier=true) as
select m.barge_id,b.number barge_number,ml.naval_section,ml.naval_module,
 ml.product_id,p.name product_name,p.base_unit,ba.currency,
 sum(ba.quantity) base_quantity,sum(ba.quantity*coalesce(ba.unit_cost,0)) real_cost,
 coalesce(sum(ba.quantity) filter(where ba.unit_cost is null or ba.currency is null),0) unpriced_quantity,
 coalesce(sum(ba.quantity) filter(where ba.unit_cost is not null and ba.currency is not null),0) priced_quantity,
 count(distinct ml.id) line_count,count(distinct m.id) movement_count,max(m.created_at) last_movement_at
from public.movements m
join public.movement_lines ml on ml.movement_id=m.id
join public.products p on p.id=ml.product_id
join public.barges b on b.id=m.barge_id
join public.batch_allocations ba on ba.movement_line_id=ml.id
where m.type='exit' and m.status='confirmed' and m.barge_id is not null
 and ((select public.current_profile_role())='admin' or (select avh_readonly_private.can_read()))
group by m.barge_id,b.number,ml.naval_section,ml.naval_module,ml.product_id,p.name,p.base_unit,ba.currency;
revoke all on public.v_barge_module_consumption from public,anon;
grant select on public.v_barge_module_consumption to authenticated;
notify pgrst,'reload schema';
