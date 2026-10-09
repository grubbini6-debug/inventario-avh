-- Fabricación Naval: additive migration. No production data or warehouse/profile changes.
-- Apply only to an isolated database first. Enable a workshop explicitly after approval.
begin;
create schema if not exists avh_fabrication_private;
revoke all on schema avh_fabrication_private from public, anon;
grant usage on schema avh_fabrication_private to authenticated, service_role;

create table public.fabrication_settings (
  warehouse_id uuid primary key references public.warehouses(id),
  enabled boolean not null default false,
  timezone text not null default 'America/Asuncion',
  email_enabled boolean not null default false,
  email_recipients text[] not null default '{}',
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now()
);
create table public.fabrication_access (
  warehouse_id uuid not null references public.fabrication_settings(warehouse_id),
  user_id uuid not null references public.profiles(id),
  access_level text not null check (access_level in ('operator','supervisor')),
  granted_by uuid not null references public.profiles(id),
  granted_at timestamptz not null default now(),
  primary key (warehouse_id,user_id)
);
create index fabrication_access_user_idx on public.fabrication_access(user_id,warehouse_id);
create table public.fabrication_components (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 1 and 120),
  active boolean not null default true
);
insert into public.fabrication_components(name) values ('Bularcamas'),('Brasolas de los costados'),('Tambuchos'),('Escaleras');
create table public.fabrication_workers (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.fabrication_settings(warehouse_id),
  name text not null check (length(trim(name)) between 1 and 120),
  specialty text,
  active boolean not null default true,
  hourly_rate numeric(18,6) check (hourly_rate >= 0 and hourly_rate <> 'NaN'::numeric),
  currency text check (currency in ('PYG','USD')),
  unique(warehouse_id,name),
  check ((hourly_rate is null) = (currency is null))
);
create index fabrication_workers_warehouse_idx on public.fabrication_workers(warehouse_id);
create table public.fabrication_orders (
  id uuid primary key default gen_random_uuid(),
  order_no bigint generated always as identity unique,
  warehouse_id uuid not null references public.fabrication_settings(warehouse_id),
  order_date date not null default (now() at time zone 'America/Asuncion')::date,
  barge_id uuid references public.barges(id),
  project text,
  component_id uuid not null references public.fabrication_components(id),
  piece_code text not null check (length(trim(piece_code)) between 1 and 120),
  drawing text not null check (length(trim(drawing)) between 1 and 160),
  drawing_revision text not null check (length(trim(drawing_revision)) between 1 and 80),
  requested_qty integer not null check (requested_qty > 0),
  produced_qty integer not null default 0 check (produced_qty >= 0),
  approved_qty integer not null default 0 check (approved_qty >= 0),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  due_date date not null,
  state text not null default 'pending' check (state in ('pending','preparation','manufacturing','quality','completed','delivered','cancelled')),
  worker_ids uuid[] not null default '{}',
  output_product_id uuid references public.products(id),
  blocked_reason text,
  notes text,
  internal_quality text not null default 'pending' check (internal_quality in ('pending','partial','approved','rework','rejected')),
  estimated_cost numeric(18,6) check (estimated_cost >= 0 and estimated_cost <> 'NaN'::numeric),
  estimated_currency text check (estimated_currency in ('PYG','USD')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  delivered_at timestamptz,
  check (approved_qty <= produced_qty and produced_qty <= requested_qty),
  check (barge_id is not null or nullif(trim(project),'') is not null),
  check ((estimated_cost is null) = (estimated_currency is null))
);
create index fabrication_orders_warehouse_state_idx on public.fabrication_orders(warehouse_id,state,due_date);
create table public.fabrication_materials (
  order_id uuid not null references public.fabrication_orders(id),
  product_id uuid not null references public.products(id),
  required_qty numeric(18,6) not null check (required_qty > 0 and required_qty <> 'NaN'::numeric),
  reserved_qty numeric(18,6) not null default 0 check (reserved_qty >= 0 and reserved_qty <> 'NaN'::numeric),
  primary key(order_id,product_id)
);
create index fabrication_materials_product_idx on public.fabrication_materials(product_id,order_id) where reserved_qty > 0;
create table public.fabrication_logs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.fabrication_orders(id),
  work_date date not null,
  activity text not null check (length(trim(activity)) between 1 and 4000),
  completed_qty integer not null default 0 check (completed_qty >= 0),
  personnel jsonb not null check (jsonb_typeof(personnel)='array' and jsonb_array_length(personnel)>0),
  incident text,
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index fabrication_logs_order_date_idx on public.fabrication_logs(order_id,work_date);
create table public.fabrication_quality_checks (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.fabrication_orders(id),
  drawing text not null,
  drawing_revision text not null,
  measurements text not null check (length(trim(measurements))>0),
  weld_finish text not null check (length(trim(weld_finish))>0),
  result text not null check (result in ('approved','rework','rejected')),
  quantity integer not null check (quantity > 0),
  defects text,
  notes text,
  scope text not null default 'internal' check (scope='internal'),
  responsible_id uuid not null references public.profiles(id),
  responsible_name text not null,
  created_at timestamptz not null default now()
);
create index fabrication_quality_order_idx on public.fabrication_quality_checks(order_id,created_at);
create table public.fabrication_stock_links (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.fabrication_orders(id),
  movement_id uuid not null unique references public.movements(id),
  kind text not null check (kind in ('consume','return','output','delivery')),
  product_id uuid not null references public.products(id),
  quantity numeric(18,6) not null check (quantity > 0 and quantity <> 'NaN'::numeric),
  source_link_id uuid references public.fabrication_stock_links(id),
  allocation_returns jsonb,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  check ((kind='return') = (source_link_id is not null))
);
create index fabrication_stock_order_idx on public.fabrication_stock_links(order_id,kind);
create index fabrication_stock_source_idx on public.fabrication_stock_links(source_link_id) where source_link_id is not null;
create table public.fabrication_events (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.fabrication_settings(warehouse_id),
  order_id uuid references public.fabrication_orders(id),
  action text not null,
  actor_id uuid not null references public.profiles(id),
  actor_name text not null,
  request_id uuid not null,
  request_data jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique(actor_id,request_id)
);
create index fabrication_events_order_idx on public.fabrication_events(order_id,created_at);
create table public.fabrication_attachments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.fabrication_orders(id),
  quality_check_id uuid references public.fabrication_quality_checks(id),
  file_path text not null unique,
  file_name text not null,
  kind text not null check (kind in ('photo','drawing')),
  uploaded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index fabrication_attachments_order_idx on public.fabrication_attachments(order_id);
create table public.fabrication_closures (
  warehouse_id uuid not null references public.fabrication_settings(warehouse_id),
  report_date date not null,
  notes text,
  next_day_plan text,
  equipment_problems text,
  purchase_needs text,
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key(warehouse_id,report_date)
);
create table public.fabrication_reports (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.fabrication_settings(warehouse_id),
  report_date date not null,
  revision integer not null check (revision > 0),
  source text not null check (source in ('manual','automatic')),
  payload jsonb not null,
  generated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  email_status text not null default 'disabled' check (email_status in ('disabled','pending','processing','sent','error')),
  email_attempts integer not null default 0,
  email_claimed_at timestamptz,
  email_claim_token uuid,
  email_sent_at timestamptz,
  email_error text,
  unique(warehouse_id,report_date,revision)
);
create index fabrication_reports_history_idx on public.fabrication_reports(warehouse_id,report_date desc,revision desc);
create unique index fabrication_reports_automatic_idx on public.fabrication_reports(warehouse_id,report_date) where source='automatic';
create index fabrication_reports_email_idx on public.fabrication_reports(email_status,created_at) where email_status in ('pending','error','processing');

create function avh_fabrication_private.can_access(p_warehouse uuid,p_write boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists (
    select 1 from public.profiles p join public.fabrication_access a on a.user_id=p.id
    join public.fabrication_settings s on s.warehouse_id=a.warehouse_id
    join public.warehouses w on w.id=s.warehouse_id
    where p.id=auth.uid() and p.active and w.active and s.enabled and a.warehouse_id=p_warehouse
    and (not p_write or a.access_level='operator')
    and (p.role='admin' or (p.role='depositor' and p.warehouse_id=p_warehouse and a.access_level='operator'))
  )
$$;
create function avh_fabrication_private.order_access(p_order uuid,p_write boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.fabrication_orders o where o.id=p_order and avh_fabrication_private.can_access(o.warehouse_id,p_write))
$$;
create function avh_fabrication_private.available(p_warehouse uuid,p_product uuid)
returns numeric language sql volatile security definer set search_path='' as $$
 select coalesce((select sum(quantity_remaining) from public.inventory_batches where warehouse_id=p_warehouse and product_id=p_product),0)
  -coalesce((select sum(m.reserved_qty) from public.fabrication_materials m join public.fabrication_orders o on o.id=m.order_id
    where o.warehouse_id=p_warehouse and m.product_id=p_product),0)
$$;
-- Protect reservations even when stock leaves through the existing normal exit/transfer/correction RPCs.
-- Reservations and consumption lock ALL existing FIFO batch rows in exactly the stock RPC's order.
create function avh_fabrication_private.guard_reserved_stock()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.quantity_remaining < old.quantity_remaining and
    avh_fabrication_private.available(old.warehouse_id,old.product_id) < old.quantity_remaining-new.quantity_remaining then
   raise exception 'Material reservado para fabricación. Liberá la reserva de la orden antes de retirarlo.';
 end if;
 return new;
end $$;
create trigger fabrication_reserved_stock_guard before update of quantity_remaining on public.inventory_batches
for each row execute function avh_fabrication_private.guard_reserved_stock();
create function avh_fabrication_private.guard_linked_movement()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='cancelled' and old.status is distinct from new.status and
    exists(select 1 from public.fabrication_stock_links l where l.movement_id=old.id) then
   raise exception 'Movimiento vinculado a fabricación: utilizá la devolución trazable desde la orden.';
 end if;
 return new;
end $$;
create trigger fabrication_linked_movement_guard before update of status on public.movements
for each row execute function avh_fabrication_private.guard_linked_movement();

do $policies$
declare t text;
begin
 foreach t in array array['fabrication_settings','fabrication_access','fabrication_components','fabrication_workers','fabrication_orders',
  'fabrication_materials','fabrication_logs','fabrication_quality_checks','fabrication_stock_links','fabrication_events',
  'fabrication_attachments','fabrication_closures','fabrication_reports'] loop
   execute format('alter table public.%I enable row level security',t);
   execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
   execute format('grant select on public.%I to authenticated',t);
 end loop;
 foreach t in array array['fabrication_workers','fabrication_orders','fabrication_events','fabrication_closures','fabrication_reports'] loop
   execute format('create policy fabrication_read on public.%I for select to authenticated using (avh_fabrication_private.can_access(warehouse_id))',t);
 end loop;
 foreach t in array array['fabrication_materials','fabrication_logs','fabrication_quality_checks','fabrication_stock_links','fabrication_attachments'] loop
   execute format('create policy fabrication_read on public.%I for select to authenticated using (avh_fabrication_private.order_access(order_id))',t);
 end loop;
end $policies$;
create policy fabrication_settings_read on public.fabrication_settings for select to authenticated
using ((select public.current_profile_role())='admin' or avh_fabrication_private.can_access(warehouse_id));
create policy fabrication_access_read on public.fabrication_access for select to authenticated
using ((select public.current_profile_role())='admin' or (user_id=(select auth.uid()) and avh_fabrication_private.can_access(warehouse_id)));
create policy fabrication_components_read on public.fabrication_components for select to authenticated
using ((select public.current_profile_role())='admin' or exists(select 1 from public.fabrication_access a where a.user_id=(select auth.uid()) and avh_fabrication_private.can_access(a.warehouse_id)));

create view public.v_fabrication_material_status with (security_invoker=true) as
select m.*,o.warehouse_id,p.name as product_name,p.base_unit,
 coalesce(s.stock_qty,0) as stock_qty,
 coalesce(s.stock_qty,0)-coalesce(r.reserved_qty,0) as available_qty,
 coalesce(c.net_consumed_qty,0) as net_consumed_qty,
 greatest(m.required_qty-coalesce(c.net_consumed_qty,0)-m.reserved_qty,0) as to_reserve_qty,
 greatest(m.required_qty-coalesce(c.net_consumed_qty,0)-greatest(coalesce(s.stock_qty,0)-coalesce(r.reserved_qty,0)+m.reserved_qty,0),0) as missing_qty
from public.fabrication_materials m join public.fabrication_orders o on o.id=m.order_id join public.products p on p.id=m.product_id
left join public.v_stock_by_warehouse s on s.warehouse_id=o.warehouse_id and s.product_id=m.product_id
left join lateral (select sum(x.reserved_qty) as reserved_qty from public.fabrication_materials x join public.fabrication_orders y on y.id=x.order_id
 where y.warehouse_id=o.warehouse_id and x.product_id=m.product_id) r on true
left join lateral (select sum(case when l.kind='consume' then l.quantity else -l.quantity end) as net_consumed_qty
 from public.fabrication_stock_links l where l.order_id=m.order_id and l.product_id=m.product_id and l.kind in ('consume','return')) c on true;
grant select on public.v_fabrication_material_status to authenticated;

-- One transactional API. Public wrappers remain SECURITY INVOKER; privileged code is private.
create function avh_fabrication_private.command(p_action text,p_data jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_wh uuid; v_order public.fabrication_orders; v_id uuid; v_result jsonb; v_previous public.fabrication_events;
 v_qty numeric; v_net numeric; v_stock numeric; v_product uuid; v_movement uuid;
 v_worker public.fabrication_workers; v_person jsonb; v_personnel jsonb:='[]'; v_worker_ids uuid[];
 v_items jsonb; v_line record; v_remaining numeric; v_take numeric; v_already numeric; v_allocations jsonb:='[]';
 v_source public.fabrication_stock_links; v_role text; v_state text; v_notes text;
begin
 v_role:=public.current_profile_role();
 if auth.uid() is null or v_role is null then raise exception 'Usuario no autorizado'; end if;
 if p_request_id is null or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'Solicitud inválida'; end if;
 if p_action not in ('configure','access','component','worker','order','material','reserve','consume','return','output','delivery','state','block','unblock','log','quality','attachment','closure','report') then
   raise exception 'Acción de fabricación desconocida';
 end if;
 -- Serialize identical requests, including creation requests that do not yet have an order row.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':fabrication:'||p_request_id::text,0));
 if nullif(p_data->>'order_id','') is not null then
   select * into v_order from public.fabrication_orders where id=(p_data->>'order_id')::uuid for update;
   if not found then raise exception 'Orden inexistente o no autorizada'; end if;
   v_wh:=v_order.warehouse_id;
 else v_wh:=nullif(p_data->>'warehouse_id','')::uuid;
 end if;
 if p_action in ('configure','access') then
   if v_role is distinct from 'admin' then raise exception 'Solo administración puede configurar accesos'; end if;
   perform public.assert_can_access_warehouse(v_wh);
 elsif p_action='report' then
   if not avh_fabrication_private.can_access(v_wh) then raise exception 'No autorizado para fabricación'; end if;
 elsif p_action in ('worker','component') and v_role='admin' then
   if not avh_fabrication_private.can_access(v_wh) then raise exception 'No autorizado para fabricación'; end if;
 else
   if not avh_fabrication_private.can_access(v_wh,true) then raise exception 'No autorizado para operar fabricación'; end if;
 end if;
 select * into v_previous from public.fabrication_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then
   if v_previous.action<>p_action or v_previous.request_data<>p_data then raise exception 'La solicitud ya se utilizó con otros datos'; end if;
   return v_previous.result;
 end if;
 v_notes:=nullif(trim(p_data->>'notes'),'');

 if p_action='configure' then
   if coalesce((p_data->>'enabled')::boolean,false)=false and exists(
     select 1 from public.fabrication_materials m join public.fabrication_orders o on o.id=m.order_id where o.warehouse_id=v_wh and m.reserved_qty>0
   ) then raise exception 'Liberá las reservas antes de desactivar fabricación'; end if;
   if not exists(select 1 from pg_timezone_names where name=coalesce(p_data->>'timezone','America/Asuncion')) then raise exception 'Zona horaria inválida'; end if;
   if coalesce(jsonb_typeof(p_data->'email_recipients'),'array')<>'array' or exists(
     select 1 from jsonb_array_elements_text(coalesce(p_data->'email_recipients','[]')) x where x !~ '^[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$'
   ) then raise exception 'Destinatario de correo inválido'; end if;
   if jsonb_array_length(coalesce(p_data->'email_recipients','[]'))>10 then raise exception 'Máximo 10 destinatarios'; end if;
   if coalesce((p_data->>'email_enabled')::boolean,false) and jsonb_array_length(coalesce(p_data->'email_recipients','[]'))=0 then raise exception 'Indicá los destinatarios del reporte'; end if;
   insert into public.fabrication_settings(warehouse_id,enabled,timezone,email_enabled,email_recipients,updated_by)
   values(v_wh,coalesce((p_data->>'enabled')::boolean,false),coalesce(p_data->>'timezone','America/Asuncion'),
     coalesce((p_data->>'email_enabled')::boolean,false),array(select distinct lower(trim(x)) from jsonb_array_elements_text(coalesce(p_data->'email_recipients','[]')) x),auth.uid())
   on conflict(warehouse_id) do update set enabled=excluded.enabled,timezone=excluded.timezone,email_enabled=excluded.email_enabled,
     email_recipients=excluded.email_recipients,updated_by=auth.uid(),updated_at=now();
   v_result:=jsonb_build_object('warehouse_id',v_wh);
 elsif p_action='access' then
   if coalesce((p_data->>'revoke')::boolean,false) then
     delete from public.fabrication_access where warehouse_id=v_wh and user_id=(p_data->>'user_id')::uuid;
   else
     if not exists(select 1 from public.profiles p where p.id=(p_data->>'user_id')::uuid and p.active and (
       p.role='admin' or (p.role='depositor' and p.warehouse_id=v_wh and p_data->>'access_level'='operator')
     )) then raise exception 'El usuario debe estar activo y tener permiso en este depósito'; end if;
     insert into public.fabrication_access(warehouse_id,user_id,access_level,granted_by)
     values(v_wh,(p_data->>'user_id')::uuid,p_data->>'access_level',auth.uid())
     on conflict(warehouse_id,user_id) do update set access_level=excluded.access_level,granted_by=auth.uid(),granted_at=now();
   end if;
   v_result:=jsonb_build_object('warehouse_id',v_wh);
 elsif p_action='component' then
   insert into public.fabrication_components(name) values(trim(p_data->>'name')) returning id into v_id;
   v_result:=jsonb_build_object('id',v_id);
 elsif p_action='worker' then
   v_id:=coalesce(nullif(p_data->>'worker_id','')::uuid,gen_random_uuid());
   if exists(select 1 from public.fabrication_workers where id=v_id and warehouse_id<>v_wh) then raise exception 'Personal no autorizado'; end if;
   insert into public.fabrication_workers(id,warehouse_id,name,specialty,active,hourly_rate,currency)
   values(v_id,v_wh,trim(p_data->>'name'),nullif(trim(p_data->>'specialty'),''),coalesce((p_data->>'active')::boolean,true),
     nullif(p_data->>'hourly_rate','')::numeric,nullif(p_data->>'currency',''))
   on conflict(id) do update set name=excluded.name,specialty=excluded.specialty,active=excluded.active,hourly_rate=excluded.hourly_rate,currency=excluded.currency;
   v_result:=jsonb_build_object('id',v_id);
 elsif p_action='order' then
   select coalesce(array_agg(x::uuid),'{}'::uuid[]) into v_worker_ids from jsonb_array_elements_text(coalesce(p_data->'worker_ids','[]')) x;
   if exists(select 1 from unnest(v_worker_ids) x where not exists(select 1 from public.fabrication_workers w where w.id=x and w.warehouse_id=v_wh and w.active))
     or cardinality(v_worker_ids)<>(select count(distinct x) from unnest(v_worker_ids) x) then raise exception 'Revisá el personal asignado'; end if;
   if not exists(select 1 from public.fabrication_components where id=(p_data->>'component_id')::uuid and active) then raise exception 'Componente inválido'; end if;
   v_product:=nullif(p_data->>'output_product_id','')::uuid;
   if v_product is not null and not exists(select 1 from public.products where id=v_product and active and base_unit='unidad') then
     raise exception 'El producto fabricado debe estar activo y usar unidad como base'; end if;
   if nullif(p_data->>'barge_id','') is not null and not exists(select 1 from public.barges where id=(p_data->>'barge_id')::uuid and active) then raise exception 'Barcaza inválida'; end if;
   if (p_data->>'due_date')::date < (p_data->>'order_date')::date then raise exception 'La fecha prevista es anterior a la orden'; end if;
   if v_order.id is null then
     insert into public.fabrication_orders(warehouse_id,order_date,barge_id,project,component_id,piece_code,drawing,drawing_revision,requested_qty,priority,due_date,worker_ids,output_product_id,notes,estimated_cost,estimated_currency,created_by)
     values(v_wh,(p_data->>'order_date')::date,nullif(p_data->>'barge_id','')::uuid,nullif(trim(p_data->>'project'),''),(p_data->>'component_id')::uuid,
       trim(p_data->>'piece_code'),trim(p_data->>'drawing'),trim(p_data->>'drawing_revision'),(p_data->>'requested_qty')::integer,coalesce(p_data->>'priority','normal'),
       (p_data->>'due_date')::date,v_worker_ids,v_product,v_notes,nullif(p_data->>'estimated_cost','')::numeric,nullif(p_data->>'estimated_currency',''),auth.uid())
       returning id into v_id;
     select * into v_order from public.fabrication_orders where id=v_id;
   else
     if v_order.state in ('completed','delivered','cancelled') then raise exception 'La orden ya está cerrada'; end if;
     if v_order.produced_qty>0 and (v_order.drawing is distinct from trim(p_data->>'drawing') or v_order.drawing_revision is distinct from trim(p_data->>'drawing_revision')
       or v_order.piece_code is distinct from trim(p_data->>'piece_code') or v_order.component_id is distinct from (p_data->>'component_id')::uuid) then
       raise exception 'No se puede cambiar la identificación de piezas ya fabricadas; creá una nueva orden'; end if;
     if exists(select 1 from public.fabrication_stock_links where order_id=v_order.id and kind='output') and v_order.output_product_id is distinct from v_product then
       raise exception 'El producto de salida ya tiene movimientos'; end if;
     update public.fabrication_orders set order_date=(p_data->>'order_date')::date,barge_id=nullif(p_data->>'barge_id','')::uuid,project=nullif(trim(p_data->>'project'),''),
       component_id=(p_data->>'component_id')::uuid,piece_code=trim(p_data->>'piece_code'),drawing=trim(p_data->>'drawing'),drawing_revision=trim(p_data->>'drawing_revision'),
       requested_qty=(p_data->>'requested_qty')::integer,priority=p_data->>'priority',due_date=(p_data->>'due_date')::date,worker_ids=v_worker_ids,
       output_product_id=v_product,notes=v_notes,estimated_cost=nullif(p_data->>'estimated_cost','')::numeric,estimated_currency=nullif(p_data->>'estimated_currency',''),updated_at=now()
     where id=v_order.id;
   end if;
   v_result:=jsonb_build_object('id',v_order.id);
 elsif p_action in ('material','reserve','consume','return','output','delivery') then
   if v_order.id is null then raise exception 'Elegí una orden'; end if;
   if v_order.state in ('delivered','cancelled') and p_action<>'return' then raise exception 'La orden está cerrada'; end if;
   if v_order.blocked_reason is not null and p_action in ('consume','output','delivery') then raise exception 'La orden está bloqueada'; end if;
   if p_action in ('consume','return','output','delivery') and exists(select 1 from public.movements where created_by=auth.uid() and client_request_id=p_request_id) then
     raise exception 'La solicitud ya está utilizada por un movimiento de inventario'; end if;
   v_product:=(p_data->>'product_id')::uuid; v_qty:=(p_data->>'quantity')::numeric;
   if v_qty is null or v_qty='NaN'::numeric or v_qty<0 or (p_action<>'reserve' and v_qty=0) then raise exception 'Cantidad inválida'; end if;
   if not exists(select 1 from public.products where id=v_product and active) then raise exception 'Producto inválido'; end if;
   perform 1 from public.inventory_batches b where b.warehouse_id=v_wh and b.product_id=v_product and b.quantity_remaining>0
     order by b.product_id,b.received_at,b.created_at,b.id for update;
   select coalesce(sum(case when kind='consume' then quantity else -quantity end),0) into v_net
     from public.fabrication_stock_links where order_id=v_order.id and product_id=v_product and kind in ('consume','return');
   if p_action='material' then
     if v_order.state='completed' then raise exception 'La orden ya está terminada'; end if;
     if v_qty<v_net+coalesce((select reserved_qty from public.fabrication_materials where order_id=v_order.id and product_id=v_product),0) then
       raise exception 'El requerimiento no puede ser menor que el consumo y la reserva'; end if;
     insert into public.fabrication_materials(order_id,product_id,required_qty) values(v_order.id,v_product,v_qty)
       on conflict(order_id,product_id) do update set required_qty=excluded.required_qty;
     v_result:=jsonb_build_object('order_id',v_order.id);
   elsif p_action='reserve' then
     select reserved_qty into v_stock from public.fabrication_materials where order_id=v_order.id and product_id=v_product;
     if not found then raise exception 'Agregá el material requerido antes de reservar'; end if;
     if v_qty+v_net>(select required_qty from public.fabrication_materials where order_id=v_order.id and product_id=v_product) then raise exception 'La reserva supera el material pendiente'; end if;
     if v_qty>avh_fabrication_private.available(v_wh,v_product)+v_stock then raise exception 'Stock disponible insuficiente para reservar'; end if;
     update public.fabrication_materials set reserved_qty=v_qty where order_id=v_order.id and product_id=v_product;
     v_result:=jsonb_build_object('order_id',v_order.id,'reserved_qty',v_qty);
   elsif p_action='consume' then
     if v_order.state not in ('preparation','manufacturing') then raise exception 'La orden debe estar en preparación o fabricación'; end if;
     update public.fabrication_materials set reserved_qty=reserved_qty-v_qty where order_id=v_order.id and product_id=v_product and reserved_qty>=v_qty;
     if not found then raise exception 'Reservá la cantidad antes de consumir'; end if;
     v_items:=jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',v_qty,'unit',(select base_unit from public.products where id=v_product),'factor_to_base',1,'request_id',p_request_id));
     v_movement:=public.record_exit(v_wh,v_order.barge_id,null,null,'Fabricación OF-'||v_order.order_no,v_items,v_notes);
   elsif p_action='return' then
     select * into v_source from public.fabrication_stock_links where id=(p_data->>'source_link_id')::uuid and order_id=v_order.id and kind='consume' and product_id=v_product;
     if not found then raise exception 'Consumo de origen inválido'; end if;
     if v_qty>v_source.quantity-coalesce((select sum(quantity) from public.fabrication_stock_links where source_link_id=v_source.id),0) then
       raise exception 'La devolución supera el consumo pendiente de devolver'; end if;
     v_items:='[]'; v_remaining:=v_qty;
     for v_line in select a.* from public.batch_allocations a join public.movement_lines ml on ml.id=a.movement_line_id
       join public.inventory_batches b on b.id=a.batch_id
       where ml.movement_id=v_source.movement_id order by b.received_at,b.created_at,b.id,a.id loop
       select coalesce(sum((x->>'quantity')::numeric),0) into v_already from public.fabrication_stock_links l,
         lateral jsonb_array_elements(l.allocation_returns) x where l.source_link_id=v_source.id and x->>'batch_id'=v_line.batch_id::text;
       v_take:=least(v_remaining,v_line.quantity-v_already);
       if v_take>0 then
         v_items:=v_items||jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',v_take,'factor_to_base',1,
           'unit',(select base_unit from public.products where id=v_product),'unit_cost',v_line.unit_cost,'currency',v_line.currency,'exchange_rate',v_line.exchange_rate));
         v_allocations:=v_allocations||jsonb_build_array(jsonb_build_object('batch_id',v_line.batch_id,'quantity',v_take));
         v_remaining:=v_remaining-v_take;
       end if;
       exit when v_remaining<=0;
     end loop;
     if v_remaining>0 then raise exception 'No se encontraron las asignaciones FIFO del consumo'; end if;
     v_items:=jsonb_set(v_items,'{0,request_id}',to_jsonb(p_request_id));
     v_movement:=public.record_return(v_wh,v_order.barge_id,null,'Fabricación OF-'||v_order.order_no,v_items,v_notes);
   elsif p_action='output' then
     if v_product is distinct from v_order.output_product_id or v_qty<>trunc(v_qty) then raise exception 'Usá el producto fabricado y cantidades enteras'; end if;
     if v_qty+coalesce((select sum(quantity) from public.fabrication_stock_links where order_id=v_order.id and kind='output'),0)>v_order.approved_qty then
       raise exception 'Solo se pueden ingresar piezas aprobadas por control interno'; end if;
     if (nullif(p_data->>'unit_cost','') is null) <> (nullif(p_data->>'currency','') is null) or nullif(p_data->>'unit_cost','')::numeric<0 or nullif(p_data->>'unit_cost','')::numeric='NaN'::numeric then raise exception 'Revisá costo y moneda'; end if;
     v_items:=jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',v_qty,'unit','unidad','factor_to_base',1,
       'unit_cost',nullif(p_data->>'unit_cost',''),'currency',nullif(p_data->>'currency',''),'lot_reference','OF-'||v_order.order_no,'request_id',p_request_id));
     v_movement:=public.record_entry(v_wh,null,null,v_items,'Producto fabricado OF-'||v_order.order_no||coalesce(' · '||v_notes,''));
   elsif p_action='delivery' then
     if v_order.state<>'completed' or v_product is distinct from v_order.output_product_id or v_qty<>trunc(v_qty) then raise exception 'La orden debe estar terminada y usar su producto fabricado'; end if;
     if nullif(trim(p_data->>'destination'),'') is null or nullif(trim(p_data->>'person_receiving'),'') is null then raise exception 'Indicá destino y persona que recibe'; end if;
     select coalesce(sum(quantity),0) into v_net from public.fabrication_stock_links where order_id=v_order.id and kind='delivery';
     if v_qty+v_net>coalesce((select sum(quantity) from public.fabrication_stock_links where order_id=v_order.id and kind='output'),0) then raise exception 'La entrega supera las piezas ingresadas'; end if;
     v_items:=jsonb_build_array(jsonb_build_object('product_id',v_product,'quantity',v_qty,'unit','unidad','factor_to_base',1,'request_id',p_request_id));
     -- Manufacturing raw materials already belong to the project. Do not charge the fabricated product twice to the barge consumption dashboard.
     v_movement:=public.record_exit(v_wh,null,null,trim(p_data->>'person_receiving'),trim(p_data->>'destination'),v_items,'Entrega OF-'||v_order.order_no||coalesce(' · '||v_notes,''));
     if v_qty+v_net=v_order.requested_qty then update public.fabrication_orders set state='delivered',delivered_at=now(),updated_at=now() where id=v_order.id; end if;
   end if;
   if v_movement is not null then
     if exists(select 1 from public.fabrication_stock_links where movement_id=v_movement) then raise exception 'Movimiento ya vinculado a fabricación'; end if;
     insert into public.fabrication_stock_links(order_id,movement_id,kind,product_id,quantity,source_link_id,allocation_returns,created_by)
     values(v_order.id,v_movement,p_action,v_product,v_qty,case when p_action='return' then v_source.id end,
       case when p_action='return' then v_allocations end,auth.uid()) returning id into v_id;
     v_result:=jsonb_build_object('id',v_id,'movement_id',v_movement);
   end if;
 elsif p_action in ('state','block','unblock') then
   if v_order.id is null or v_order.state in ('delivered','cancelled') then raise exception 'Orden cerrada o inválida'; end if;
   if p_action='block' then
     if v_notes is null then raise exception 'Indicá el motivo del bloqueo'; end if;
     update public.fabrication_orders set blocked_reason=v_notes,updated_at=now() where id=v_order.id;
   elsif p_action='unblock' then
     if v_notes is null then raise exception 'Indicá cómo se resolvió el bloqueo'; end if;
     update public.fabrication_orders set blocked_reason=null,updated_at=now() where id=v_order.id;
   else
     v_state:=p_data->>'state';
     if v_state='cancelled' then
       if v_notes is null then raise exception 'Indicá el motivo de cancelación'; end if;
       if exists(select 1 from public.fabrication_stock_links where order_id=v_order.id and kind in ('output','delivery')) then raise exception 'La orden tiene piezas en inventario o entregadas'; end if;
       update public.fabrication_materials set reserved_qty=0 where order_id=v_order.id;
     elsif v_order.blocked_reason is not null then raise exception 'Resolvé el bloqueo antes de avanzar';
     elsif not ((v_order.state='pending' and v_state='preparation') or (v_order.state='preparation' and v_state='manufacturing') or
       (v_order.state='manufacturing' and v_state='quality') or (v_order.state='quality' and v_state in ('manufacturing','completed'))) then
       raise exception 'Transición de estado inválida';
     end if;
     if v_order.state='quality' and v_state='manufacturing' and v_notes is null then raise exception 'Registrá el motivo del retrabajo'; end if;
     if v_state='completed' and (v_order.produced_qty<>v_order.requested_qty or v_order.approved_qty<>v_order.requested_qty or
       exists(select 1 from public.fabrication_materials where order_id=v_order.id and reserved_qty>0)) then
       raise exception 'Completá fabricación, aprobación interna y liberación de reservas'; end if;
     update public.fabrication_orders set state=v_state,completed_at=case when v_state='completed' then now() else completed_at end,updated_at=now() where id=v_order.id;
   end if;
   v_result:=jsonb_build_object('order_id',v_order.id);
 elsif p_action='log' then
   if v_order.id is null or v_order.state not in ('preparation','manufacturing') or v_order.blocked_reason is not null then raise exception 'La orden no admite avance en su estado actual'; end if;
   if (p_data->>'work_date')::date < v_order.order_date or (p_data->>'work_date')::date > (now() at time zone (select timezone from public.fabrication_settings where warehouse_id=v_wh))::date then raise exception 'Fecha de trabajo inválida'; end if;
   if jsonb_typeof(p_data->'personnel') is distinct from 'array' or jsonb_array_length(p_data->'personnel')=0 then raise exception 'Indicá operarios y horas'; end if;
   if (select count(distinct x->>'worker_id') from jsonb_array_elements(p_data->'personnel') x)<>jsonb_array_length(p_data->'personnel') then raise exception 'Operario repetido'; end if;
   perform 1 from public.fabrication_workers where id in (select (x->>'worker_id')::uuid from jsonb_array_elements(p_data->'personnel') x) order by id for update;
   for v_person in select * from jsonb_array_elements(p_data->'personnel') order by value->>'worker_id' loop
     select * into v_worker from public.fabrication_workers where id=(v_person->>'worker_id')::uuid and warehouse_id=v_wh and active;
     if not found or not (v_worker.id=any(v_order.worker_ids)) then raise exception 'El operario no está asignado a la orden'; end if;
     v_qty:=(v_person->>'hours')::numeric;
     if v_qty is null or v_qty='NaN'::numeric or v_qty<=0 or v_qty>24 then raise exception 'Horas inválidas'; end if;
     if v_qty+coalesce((select sum((x->>'hours')::numeric) from public.fabrication_logs l join public.fabrication_orders o on o.id=l.order_id,
       lateral jsonb_array_elements(l.personnel) x where o.warehouse_id=v_wh and l.work_date=(p_data->>'work_date')::date and x->>'worker_id'=v_worker.id::text),0)>24 then
       raise exception 'El operario supera 24 horas registradas en el día'; end if;
     v_personnel:=v_personnel||jsonb_build_array(jsonb_build_object('worker_id',v_worker.id,'name',v_worker.name,'hours',v_qty,'hourly_rate',v_worker.hourly_rate,'currency',v_worker.currency));
   end loop;
   insert into public.fabrication_logs(order_id,work_date,activity,completed_qty,personnel,incident,notes,created_by)
   values(v_order.id,(p_data->>'work_date')::date,trim(p_data->>'activity'),coalesce((p_data->>'completed_qty')::integer,0),v_personnel,nullif(trim(p_data->>'incident'),''),v_notes,auth.uid()) returning id into v_id;
   update public.fabrication_orders set produced_qty=produced_qty+coalesce((p_data->>'completed_qty')::integer,0),updated_at=now() where id=v_order.id;
   v_result:=jsonb_build_object('id',v_id);
 elsif p_action='quality' then
   if v_order.id is null or v_order.state<>'quality' or v_order.blocked_reason is not null then raise exception 'Pasá la orden a control de calidad'; end if;
   v_qty:=(p_data->>'quantity')::integer;
   if v_qty is null or v_qty<=0 or v_qty>v_order.produced_qty-v_order.approved_qty then raise exception 'Cantidad de inspección inválida'; end if;
   if p_data->>'result' in ('rework','rejected') and nullif(trim(p_data->>'defects'),'') is null then raise exception 'Describí los defectos detectados'; end if;
   insert into public.fabrication_quality_checks(order_id,drawing,drawing_revision,measurements,weld_finish,result,quantity,defects,notes,responsible_id,responsible_name)
   values(v_order.id,v_order.drawing,v_order.drawing_revision,trim(p_data->>'measurements'),trim(p_data->>'weld_finish'),p_data->>'result',v_qty,
     nullif(trim(p_data->>'defects'),''),v_notes,auth.uid(),(select coalesce(nullif(full_name,''),username) from public.profiles where id=auth.uid())) returning id into v_id;
   update public.fabrication_orders set approved_qty=approved_qty+case when p_data->>'result'='approved' then v_qty else 0 end,
     internal_quality=case when p_data->>'result'='approved' and v_order.approved_qty+v_qty<v_order.requested_qty then 'partial' else p_data->>'result' end,updated_at=now() where id=v_order.id;
   v_result:=jsonb_build_object('id',v_id);
 elsif p_action='attachment' then
   if v_order.id is null then raise exception 'Orden inválida'; end if;
   if split_part(p_data->>'file_path','/',1)<>v_wh::text or split_part(p_data->>'file_path','/',2)<>v_order.id::text or not exists(
     select 1 from storage.objects where bucket_id='fabrication-documents' and name=p_data->>'file_path'
   ) then raise exception 'Archivo inexistente o ajeno a la orden'; end if;
   if nullif(p_data->>'quality_check_id','') is not null and not exists(select 1 from public.fabrication_quality_checks where id=(p_data->>'quality_check_id')::uuid and order_id=v_order.id) then raise exception 'Inspección ajena a la orden'; end if;
   insert into public.fabrication_attachments(order_id,quality_check_id,file_path,file_name,kind,uploaded_by)
   values(v_order.id,nullif(p_data->>'quality_check_id','')::uuid,p_data->>'file_path',p_data->>'file_name',p_data->>'kind',auth.uid()) returning id into v_id;
   v_result:=jsonb_build_object('id',v_id);
 elsif p_action='closure' then
   if (p_data->>'report_date')::date>(now() at time zone (select timezone from public.fabrication_settings where warehouse_id=v_wh))::date then raise exception 'No se puede cerrar una fecha futura'; end if;
   insert into public.fabrication_closures(warehouse_id,report_date,notes,next_day_plan,equipment_problems,purchase_needs,updated_by)
   values(v_wh,(p_data->>'report_date')::date,v_notes,nullif(trim(p_data->>'next_day_plan'),''),nullif(trim(p_data->>'equipment_problems'),''),nullif(trim(p_data->>'purchase_needs'),''),auth.uid())
   on conflict(warehouse_id,report_date) do update set notes=excluded.notes,next_day_plan=excluded.next_day_plan,
     equipment_problems=excluded.equipment_problems,purchase_needs=excluded.purchase_needs,updated_by=auth.uid(),updated_at=now();
   v_result:=jsonb_build_object('id',avh_fabrication_private.save_report(v_wh,(p_data->>'report_date')::date,'manual',auth.uid()));
 elsif p_action='report' then
   v_result:=jsonb_build_object('id',avh_fabrication_private.save_report(v_wh,(p_data->>'report_date')::date,'manual',auth.uid()));
 end if;
 insert into public.fabrication_events(warehouse_id,order_id,action,actor_id,actor_name,request_id,request_data,result)
 values(v_wh,v_order.id,p_action,auth.uid(),(select coalesce(nullif(full_name,''),username) from public.profiles where id=auth.uid()),p_request_id,p_data,v_result);
 if v_order.id is not null then update public.fabrication_orders set updated_at=now() where id=v_order.id; end if;
 return v_result;
end $$;
create function public.fabrication_command(p_action text,p_data jsonb,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
 select avh_fabrication_private.command(p_action,p_data,p_request_id)
$$;

create view public.v_fabrication_costs with (security_invoker=true) as
with material as (
 select l.order_id,a.currency,sum(a.quantity*a.unit_cost) as known_cost,count(*) filter(where a.unit_cost is null or a.currency is null) as unpriced
 from public.fabrication_stock_links l join public.movement_lines ml on ml.movement_id=l.movement_id
 join public.batch_allocations a on a.movement_line_id=ml.id where l.kind='consume' group by l.order_id,a.currency
 union all
 select l.order_id,b.currency,-sum(b.quantity_received*b.unit_cost),count(*) filter(where b.unit_cost is null or b.currency is null)
 from public.fabrication_stock_links l join public.movement_lines ml on ml.movement_id=l.movement_id
 join public.inventory_batches b on b.source_line_id=ml.id where l.kind='return' group by l.order_id,b.currency
), labor as (
 select l.order_id,x->>'currency' as currency,sum((x->>'hours')::numeric*(x->>'hourly_rate')::numeric) as known_cost,
 count(*) filter(where nullif(x->>'hourly_rate','') is null or nullif(x->>'currency','') is null) as unpriced
 from public.fabrication_logs l cross join lateral jsonb_array_elements(l.personnel) x group by l.order_id,x->>'currency'
)
select c.order_id,o.warehouse_id,c.currency,sum(known_cost) as known_cost,sum(unpriced) as unpriced_records,
 case when sum(unpriced)=0 then sum(known_cost) end as recorded_cost
from (select * from material union all select * from labor) c join public.fabrication_orders o on o.id=c.order_id group by c.order_id,o.warehouse_id,c.currency;
grant select on public.v_fabrication_costs to authenticated;

create function avh_fabrication_private.report_payload(p_warehouse uuid,p_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_timezone text; v_from timestamptz; v_to timestamptz; v_payload jsonb;
begin
 select timezone into strict v_timezone from public.fabrication_settings where warehouse_id=p_warehouse;
 v_from:=p_date::timestamp at time zone v_timezone; v_to:=(p_date+1)::timestamp at time zone v_timezone;
 select jsonb_build_object(
  'schema_version',1,'report_date',p_date,'timezone',v_timezone,'generated_at',now(),
  'warehouse',jsonb_build_object('id',w.id,'name',w.name),
  'data_notes',jsonb_build_array('Sin registros significa información no registrada.','Estados, stock y costos acumulados corresponden al momento de generación.',
   'El control de calidad es interno: no equivale a aprobación de Ingeniería, Calidad o Bureau Veritas.',
   'Costos: materiales FIFO y mano de obra registrada. No incluyen costos indirectos. Monedas separadas; sin conversión implícita.'),
  'movements',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'number',m.movement_no,'type',m.type,'status',m.status,'notes',m.notes,
    'created_at',m.created_at,'received_at',m.received_at,'received_today',m.received_at>=v_from and m.received_at<v_to,
    'actor',p.username,'warehouse_from',wf.name,'warehouse_to',wt.name,'fabrication_order',o.order_no,'fabrication_kind',fl.kind,
    'lines',(select jsonb_agg(jsonb_build_object('product',pr.name,'quantity',ml.base_quantity,'unit',pr.base_unit))
      from public.movement_lines ml join public.products pr on pr.id=ml.product_id where ml.movement_id=m.id)) order by m.created_at,m.id)
    from public.movements m left join public.profiles p on p.id=m.created_by left join public.warehouses wf on wf.id=m.warehouse_from_id
    left join public.warehouses wt on wt.id=m.warehouse_to_id left join public.fabrication_stock_links fl on fl.movement_id=m.id
    left join public.fabrication_orders o on o.id=fl.order_id where (m.warehouse_from_id=p_warehouse or m.warehouse_to_id=p_warehouse)
    and ((m.created_at>=v_from and m.created_at<v_to) or (m.type='transfer' and m.warehouse_to_id=p_warehouse and m.received_at>=v_from and m.received_at<v_to))),'[]'),
  'stock_alerts',coalesce((select jsonb_agg(to_jsonb(s)) from public.v_stock_status s where s.warehouse_id=p_warehouse and s.is_critical),'[]'),
  'orders',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'number',o.order_no,'component',c.name,'piece_code',o.piece_code,'project',coalesce(b.name,o.project),
    'state',o.state,'internal_quality',o.internal_quality,'requested_qty',o.requested_qty,'produced_qty',o.produced_qty,'approved_qty',o.approved_qty,
    'pending_qty',o.requested_qty-o.produced_qty,'progress_percent',round(100.0*o.produced_qty/o.requested_qty,2),
    'due_date',o.due_date,'delayed',o.due_date<p_date and o.state not in ('completed','delivered','cancelled'),'blocked_reason',o.blocked_reason,
    'produced_today',coalesce((select sum(l.completed_qty) from public.fabrication_logs l where l.order_id=o.id and l.work_date=p_date),0),
    'estimated_cost',o.estimated_cost,'estimated_currency',o.estimated_currency) order by o.order_no)
    from public.fabrication_orders o join public.fabrication_components c on c.id=o.component_id left join public.barges b on b.id=o.barge_id
    where o.warehouse_id=p_warehouse and (o.state not in ('delivered','cancelled') or exists(select 1 from public.fabrication_logs l where l.order_id=o.id and l.work_date=p_date)
      or exists(select 1 from public.fabrication_events e where e.order_id=o.id and e.created_at>=v_from and e.created_at<v_to))),'[]'),
  'work_logs',coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('order_number',o.order_no) order by l.created_at,l.id)
    from public.fabrication_logs l join public.fabrication_orders o on o.id=l.order_id where o.warehouse_id=p_warehouse and l.work_date=p_date),'[]'),
  'quality',coalesce((select jsonb_agg(to_jsonb(q)||jsonb_build_object('order_number',o.order_no,'responsible',q.responsible_name) order by q.created_at,q.id)
    from public.fabrication_quality_checks q join public.fabrication_orders o on o.id=q.order_id
    where o.warehouse_id=p_warehouse and q.created_at>=v_from and q.created_at<v_to),'[]'),
  'events',coalesce((select jsonb_agg(jsonb_build_object('order_number',o.order_no,'action',e.action,'actor',e.actor_name,'notes',e.request_data->>'notes','created_at',e.created_at) order by e.created_at,e.id)
    from public.fabrication_events e left join public.fabrication_orders o on o.id=e.order_id where e.warehouse_id=p_warehouse and e.created_at>=v_from and e.created_at<v_to),'[]'),
  'materials',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('order_number',o.order_no)) from public.v_fabrication_material_status s
    join public.fabrication_orders o on o.id=s.order_id where o.warehouse_id=p_warehouse and o.state not in ('completed','delivered','cancelled')),'[]'),
  'costs',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('order_number',o.order_no)) from public.v_fabrication_costs c
    join public.fabrication_orders o on o.id=c.order_id where o.warehouse_id=p_warehouse),'[]'),
  'supply_requests',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.requested_name,'quantity',s.quantity,'unit',s.unit,'urgency',s.urgency,'status',s.status,'notes',s.notes))
    from public.supply_requests s where s.warehouse_id=p_warehouse and s.status in ('pending','in_progress')),'[]'),
  'closure',(select to_jsonb(c) from public.fabrication_closures c where c.warehouse_id=p_warehouse and c.report_date=p_date)
 ) into v_payload from public.warehouses w where w.id=p_warehouse;
 return v_payload;
end $$;
create function avh_fabrication_private.save_report(p_warehouse uuid,p_date date,p_source text,p_actor uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_revision integer; v_settings public.fabrication_settings;
begin
 select * into strict v_settings from public.fabrication_settings where warehouse_id=p_warehouse;
 if p_date is null or p_date>(now() at time zone v_settings.timezone)::date then raise exception 'Fecha de reporte inválida'; end if;
 perform pg_advisory_xact_lock(hashtextextended('fabrication-report:'||p_warehouse::text||':'||p_date::text,0));
 if p_source='automatic' then
   select id into v_id from public.fabrication_reports where warehouse_id=p_warehouse and report_date=p_date and source='automatic';
   if found then return v_id; end if;
 end if;
 select coalesce(max(revision),0)+1 into v_revision from public.fabrication_reports where warehouse_id=p_warehouse and report_date=p_date;
 insert into public.fabrication_reports(warehouse_id,report_date,revision,source,payload,generated_by,email_status)
 values(p_warehouse,p_date,v_revision,p_source,avh_fabrication_private.report_payload(p_warehouse,p_date),p_actor,
   case when p_source='automatic' and v_settings.email_enabled then 'pending' else 'disabled' end) returning id into v_id;
 return v_id;
end $$;
-- pg_cron invokes this as its owner, never as a browser user. Complete calendar days only.
create function avh_fabrication_private.generate_due_reports()
returns integer language plpgsql security definer set search_path='' as $$
declare s record; v_date date; v_first date; v_day date; v_count integer:=0;
begin
 for s in select f.* from public.fabrication_settings f join public.warehouses w on w.id=f.warehouse_id where f.enabled and w.active loop
   v_date:=(now() at time zone s.timezone)::date-1;
   select coalesce(max(report_date)+1,v_date) into v_first from public.fabrication_reports where warehouse_id=s.warehouse_id and source='automatic';
   for v_day in select d::date from generate_series(v_first::timestamp,least(v_date,v_first+29)::timestamp,interval '1 day') d loop
     perform avh_fabrication_private.save_report(s.warehouse_id,v_day,'automatic');v_count:=v_count+1;
   end loop;
 end loop;
 return v_count;
end $$;
create function public.fabrication_context()
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('workshops',coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('access_level',a.access_level))
   from public.fabrication_settings s left join public.fabrication_access a on a.warehouse_id=s.warehouse_id and a.user_id=auth.uid()),'[]'),
  'active_orders',(select count(*) from public.fabrication_orders where state not in ('completed','delivered','cancelled')),
  'produced_qty',(select coalesce(sum(produced_qty),0) from public.fabrication_orders))
$$;
create function avh_fabrication_private.day(p_warehouse uuid,p_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not avh_fabrication_private.can_access(p_warehouse) then raise exception 'No autorizado para fabricación'; end if;
 if p_date is null then raise exception 'Fecha inválida'; end if;
 return avh_fabrication_private.report_payload(p_warehouse,p_date);
end $$;
create function public.fabrication_day(p_warehouse uuid,p_date date)
returns jsonb language sql security invoker set search_path='' as $$select avh_fabrication_private.day(p_warehouse,p_date)$$;

create function avh_fabrication_private.email_claim()
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.fabrication_reports; s public.fabrication_settings; v_token uuid;
begin
 if coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' is distinct from 'service_role' then raise exception 'Solo el servicio de reportes'; end if;
 select x.* into r from public.fabrication_reports x join public.fabrication_settings f on f.warehouse_id=x.warehouse_id
 where f.enabled and f.email_enabled and cardinality(f.email_recipients)>0 and x.source='automatic' and x.email_attempts<5
   and (x.email_status='pending' or (x.email_status='error' and x.email_claimed_at<now()-interval '15 minutes')
     or (x.email_status='processing' and x.email_claimed_at<now()-interval '10 minutes'))
 order by x.created_at for update of x skip locked limit 1;
 if not found then return null; end if;
 select * into s from public.fabrication_settings where warehouse_id=r.warehouse_id;
 v_token:=gen_random_uuid();
 update public.fabrication_reports set email_status='processing',email_claimed_at=now(),email_claim_token=v_token,email_attempts=email_attempts+1 where id=r.id;
 return jsonb_build_object('report',to_jsonb(r),'recipients',s.email_recipients,'claim_token',v_token);
end $$;
create function avh_fabrication_private.email_finish(p_report uuid,p_token uuid,p_error text default null)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' is distinct from 'service_role' then raise exception 'Solo el servicio de reportes'; end if;
 update public.fabrication_reports set email_status=case when p_error is null then 'sent' else 'error' end,
   email_error=left(p_error,1000),email_sent_at=case when p_error is null then now() else null end,email_claim_token=null
 where id=p_report and email_claim_token=p_token and email_status='processing';
 return found;
end $$;
create function public.fabrication_email_claim() returns jsonb language sql security invoker set search_path='' as $$select avh_fabrication_private.email_claim()$$;
create function public.fabrication_email_finish(p_report uuid,p_token uuid,p_error text default null) returns boolean language sql security invoker set search_path='' as $$select avh_fabrication_private.email_finish(p_report,p_token,p_error)$$;

-- Private attachments; path = existing warehouse UUID / manufacturing order UUID / file.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('fabrication-documents','fabrication-documents',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf']);
create function avh_fabrication_private.file_access(p_name text,p_write boolean default false)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.fabrication_orders o where o.id::text=split_part(p_name,'/',2)
 and o.warehouse_id::text=split_part(p_name,'/',1) and avh_fabrication_private.can_access(o.warehouse_id,p_write))
$$;
create policy fabrication_files_read on storage.objects for select to authenticated
using (bucket_id='fabrication-documents' and avh_fabrication_private.file_access(name));
create policy fabrication_files_insert on storage.objects for insert to authenticated
with check (bucket_id='fabrication-documents' and avh_fabrication_private.file_access(name,true));

-- Explicit ACLs for new tables, views, sequences and functions (no reliance on platform defaults).
revoke all on public.fabrication_orders_order_no_seq from public,anon,authenticated,service_role;
revoke all on all functions in schema avh_fabrication_private from public,anon,authenticated,service_role;
grant execute on function avh_fabrication_private.can_access(uuid,boolean),avh_fabrication_private.order_access(uuid,boolean),
 avh_fabrication_private.file_access(text,boolean),avh_fabrication_private.command(text,jsonb,uuid),avh_fabrication_private.day(uuid,date) to authenticated;
grant execute on function avh_fabrication_private.email_claim(),avh_fabrication_private.email_finish(uuid,uuid,text) to service_role;
revoke all on function public.fabrication_command(text,jsonb,uuid),public.fabrication_context(),public.fabrication_day(uuid,date),public.fabrication_email_claim(),public.fabrication_email_finish(uuid,uuid,text)
 from public,anon,authenticated,service_role;
grant execute on function public.fabrication_command(text,jsonb,uuid),public.fabrication_context(),public.fabrication_day(uuid,date) to authenticated;
grant execute on function public.fabrication_email_claim(),public.fabrication_email_finish(uuid,uuid,text) to service_role;
revoke all on public.v_fabrication_material_status,public.v_fabrication_costs from public,anon,service_role;

-- No job is activated in production by this PR. This runs only wherever the migration is approved and applied.
do $cron$
begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
   perform cron.schedule('avh-fabrication-daily','10 * * * *','select avh_fabrication_private.generate_due_reports();');
 end if;
end $cron$;
notify pgrst,'reload schema';
commit;
