-- AVH — Inventario de apertura por depósito.
-- El depositario carga cantidades físicas sin costo; administración valoriza y cierra.

create table if not exists public.warehouse_opening_inventory (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null unique references public.warehouses(id) on delete restrict,
  status text not null default 'open' check (status in ('open','closed')),
  notes text,
  opened_by uuid references public.profiles(id),
  opened_at timestamptz not null default now(),
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.warehouse_opening_inventory enable row level security;

drop policy if exists opening_inventory_admin_read on public.warehouse_opening_inventory;
create policy opening_inventory_admin_read on public.warehouse_opening_inventory
for select to authenticated
using (public.current_profile_role()='admin');

drop policy if exists opening_inventory_depositor_read on public.warehouse_opening_inventory;
create policy opening_inventory_depositor_read on public.warehouse_opening_inventory
for select to authenticated
using (public.current_profile_role()='depositor' and public.can_access_warehouse(warehouse_id));

revoke all on public.warehouse_opening_inventory from anon;
grant select on public.warehouse_opening_inventory to authenticated;

alter table public.movements
  add column if not exists opening_session_id uuid references public.warehouse_opening_inventory(id) on delete restrict;

create index if not exists movements_opening_session_idx
  on public.movements(opening_session_id)
  where opening_session_id is not null;

create or replace function public.admin_open_initial_inventory(p_warehouse_id uuid, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path='public'
as $$
declare v_id uuid; v_status text;
begin
  if public.current_profile_role()<>'admin' then raise exception 'Solo el administrador puede abrir el inventario inicial.'; end if;
  if not exists(select 1 from public.warehouses where id=p_warehouse_id and active=true) then raise exception 'Depósito inválido o inactivo.'; end if;

  select id,status into v_id,v_status
  from public.warehouse_opening_inventory
  where warehouse_id=p_warehouse_id
  for update;

  if v_id is not null then
    if v_status='open' then return v_id; end if;
    raise exception 'El inventario inicial de este depósito está cerrado. Usá Reabrir si necesitás corregirlo.';
  end if;

  insert into public.warehouse_opening_inventory(warehouse_id,status,notes,opened_by)
  values(p_warehouse_id,'open',nullif(trim(p_notes),''),auth.uid())
  returning id into v_id;

  insert into public.audit_events(entity_type,entity_id,action,actor_id,warehouse_id,detail)
  values('opening_inventory',v_id,'opening_inventory_opened',auth.uid(),p_warehouse_id,jsonb_build_object('notes',nullif(trim(p_notes),'')));
  return v_id;
end $$;

create or replace function public.admin_reopen_initial_inventory(p_warehouse_id uuid)
returns uuid
language plpgsql
security definer
set search_path='public'
as $$
declare v_id uuid;
begin
  if public.current_profile_role()<>'admin' then raise exception 'Solo el administrador puede reabrir el inventario inicial.'; end if;
  update public.warehouse_opening_inventory
     set status='open',closed_by=null,closed_at=null,updated_at=now()
   where warehouse_id=p_warehouse_id
   returning id into v_id;
  if v_id is null then raise exception 'Todavía no existe un inventario inicial para este depósito.'; end if;
  insert into public.audit_events(entity_type,entity_id,action,actor_id,warehouse_id)
  values('opening_inventory',v_id,'opening_inventory_reopened',auth.uid(),p_warehouse_id);
  return v_id;
end $$;

create or replace function public.admin_close_initial_inventory(p_warehouse_id uuid)
returns void
language plpgsql
security definer
set search_path='public'
as $$
declare v_id uuid; v_lines int; v_unpriced int;
begin
  if public.current_profile_role()<>'admin' then raise exception 'Solo el administrador puede cerrar el inventario inicial.'; end if;
  select id into v_id from public.warehouse_opening_inventory where warehouse_id=p_warehouse_id and status='open' for update;
  if v_id is null then raise exception 'No hay un inventario inicial abierto para este depósito.'; end if;

  select count(*),
         count(*) filter (where ml.entry_unit_cost is null or ml.entry_currency is null)
    into v_lines,v_unpriced
  from public.movements m
  join public.movement_lines ml on ml.movement_id=m.id
  where m.opening_session_id=v_id and m.type='initial' and m.status<>'cancelled';

  if v_lines=0 then raise exception 'El depositario todavía no cargó productos en este inventario inicial.'; end if;
  if v_unpriced>0 then raise exception 'Faltan valorar % ítem(s) antes de cerrar.',v_unpriced; end if;

  update public.warehouse_opening_inventory
     set status='closed',closed_by=auth.uid(),closed_at=now(),updated_at=now()
   where id=v_id;

  insert into public.audit_events(entity_type,entity_id,action,actor_id,warehouse_id,detail)
  values('opening_inventory',v_id,'opening_inventory_closed',auth.uid(),p_warehouse_id,jsonb_build_object('line_count',v_lines));
end $$;

create or replace function public.admin_price_initial_inventory(
  p_movement_line_id uuid,
  p_unit_cost numeric,
  p_currency text,
  p_exchange_rate numeric default null
)
returns void
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_session uuid;
  v_warehouse uuid;
  v_factor numeric;
  v_base_cost numeric;
  v_status text;
  v_product uuid;
begin
  if public.current_profile_role()<>'admin' then raise exception 'Solo el administrador puede valorar el stock inicial.'; end if;
  if p_unit_cost is null or p_unit_cost<0 then raise exception 'Precio inválido.'; end if;
  if upper(coalesce(p_currency,'')) not in ('PYG','USD') then raise exception 'Moneda inválida. Usá PYG o USD.'; end if;

  select m.opening_session_id,m.warehouse_to_id,ml.factor_to_base,oi.status,ml.product_id
    into v_session,v_warehouse,v_factor,v_status,v_product
  from public.movement_lines ml
  join public.movements m on m.id=ml.movement_id
  join public.warehouse_opening_inventory oi on oi.id=m.opening_session_id
  where ml.id=p_movement_line_id and m.type='initial' and m.status<>'cancelled'
  for update of ml;

  if v_session is null then raise exception 'Ítem de inventario inicial inválido.'; end if;
  if v_status<>'open' then raise exception 'El inventario inicial está cerrado. Reabrilo antes de cambiar precios.'; end if;
  if coalesce(v_factor,0)<=0 then raise exception 'La conversión de este ítem es inválida.'; end if;

  v_base_cost:=p_unit_cost/v_factor;

  update public.movement_lines
     set entry_unit_cost=p_unit_cost,
         entry_currency=upper(p_currency),
         exchange_rate=p_exchange_rate
   where id=p_movement_line_id;

  update public.inventory_batches
     set unit_cost=v_base_cost,
         currency=upper(p_currency),
         exchange_rate=p_exchange_rate
   where source_line_id=p_movement_line_id;

  update public.batch_allocations ba
     set unit_cost=v_base_cost,
         currency=upper(p_currency),
         exchange_rate=p_exchange_rate
  from public.inventory_batches b
  where ba.batch_id=b.id and b.source_line_id=p_movement_line_id;

  insert into public.audit_events(entity_type,entity_id,action,actor_id,warehouse_id,detail)
  values('opening_inventory',v_session,'opening_inventory_priced',auth.uid(),v_warehouse,
    jsonb_build_object('movement_line_id',p_movement_line_id,'product_id',v_product,'unit_cost',p_unit_cost,'currency',upper(p_currency),'factor_to_base',v_factor));
end $$;

create or replace function public.admin_opening_inventory_lines(p_warehouse_id uuid)
returns table(
  session_id uuid,
  session_status text,
  warehouse_id uuid,
  opened_at timestamptz,
  closed_at timestamptz,
  movement_line_id uuid,
  movement_no bigint,
  product_id uuid,
  product_name text,
  quantity numeric,
  unit text,
  presentation_label text,
  factor_to_base numeric,
  base_quantity numeric,
  entry_unit_cost numeric,
  entry_currency text,
  exchange_rate numeric,
  priced boolean
)
language plpgsql
security definer
set search_path='public'
as $$
begin
  if public.current_profile_role()<>'admin' then raise exception 'Solo el administrador puede ver la valorización inicial.'; end if;
  return query
  select oi.id,oi.status,oi.warehouse_id,oi.opened_at,oi.closed_at,
         ml.id,m.movement_no,ml.product_id,p.name,ml.quantity,ml.unit,ml.presentation_label,
         ml.factor_to_base,coalesce(ml.base_quantity,ml.quantity*ml.factor_to_base),
         ml.entry_unit_cost,ml.entry_currency,ml.exchange_rate,
         (ml.id is not null and ml.entry_unit_cost is not null and ml.entry_currency is not null)
  from public.warehouse_opening_inventory oi
  left join public.movements m
    on m.opening_session_id=oi.id and m.type='initial' and m.status<>'cancelled'
  left join public.movement_lines ml on ml.movement_id=m.id
  left join public.products p on p.id=ml.product_id
  where oi.warehouse_id=p_warehouse_id
  order by m.created_at nulls first,ml.id;
end $$;

create or replace function public.record_initial_inventory(p_warehouse_id uuid, p_items jsonb, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path='public'
as $$
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
begin
  perform public.assert_can_access_warehouse(p_warehouse_id);
  select id into v_session
  from public.warehouse_opening_inventory
  where warehouse_id=p_warehouse_id and status='open';
  if v_session is null then raise exception 'El inventario inicial de este depósito no está abierto por administración.'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Agregá al menos un producto.'; end if;

  insert into public.movements(type,status,warehouse_to_id,notes,opening_session_id,created_by)
  values('initial','confirmed',p_warehouse_id,p_notes,v_session,auth.uid())
  returning id into v_movement;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product=(v_item->>'product_id')::uuid;
    v_qty=(v_item->>'quantity')::numeric;
    v_unit=coalesce(nullif(v_item->>'unit',''),(select base_unit from public.products where id=v_product));
    v_factor=coalesce(nullif(v_item->>'factor_to_base','')::numeric,1);
    v_base=v_qty*v_factor;

    if not exists(select 1 from public.products where id=v_product and active=true) then raise exception 'Producto inexistente o inactivo.'; end if;
    if v_qty is null or v_qty<=0 or v_factor<=0 then raise exception 'Cantidad o conversión inválida.'; end if;

    insert into public.movement_lines(
      movement_id,product_id,quantity,unit,factor_to_base,presentation_label,
      entry_unit_cost,entry_currency,exchange_rate
    ) values(
      v_movement,v_product,v_qty,v_unit,v_factor,nullif(v_item->>'presentation_label',''),
      null,null,null
    ) returning id into v_line;

    insert into public.inventory_batches(
      warehouse_id,product_id,source_line_id,quantity_received,quantity_remaining,
      unit_cost,currency,exchange_rate,lot_reference
    ) values(
      p_warehouse_id,v_product,v_line,v_base,v_base,
      null,null,null,nullif(v_item->>'lot_reference','')
    );
  end loop;

  insert into public.audit_events(entity_type,entity_id,action,actor_id,warehouse_id,detail)
  values('opening_inventory',v_session,'opening_inventory_count_added',auth.uid(),p_warehouse_id,
    jsonb_build_object('movement_id',v_movement,'line_count',jsonb_array_length(p_items)));
  return v_movement;
end $$;

revoke all on function public.admin_open_initial_inventory(uuid,text) from public,anon;
revoke all on function public.admin_reopen_initial_inventory(uuid) from public,anon;
revoke all on function public.admin_close_initial_inventory(uuid) from public,anon;
revoke all on function public.admin_price_initial_inventory(uuid,numeric,text,numeric) from public,anon;
revoke all on function public.admin_opening_inventory_lines(uuid) from public,anon;
revoke all on function public.record_initial_inventory(uuid,jsonb,text) from public,anon;

grant execute on function public.admin_open_initial_inventory(uuid,text) to authenticated;
grant execute on function public.admin_reopen_initial_inventory(uuid) to authenticated;
grant execute on function public.admin_close_initial_inventory(uuid) to authenticated;
grant execute on function public.admin_price_initial_inventory(uuid,numeric,text,numeric) to authenticated;
grant execute on function public.admin_opening_inventory_lines(uuid) to authenticated;
grant execute on function public.record_initial_inventory(uuid,jsonb,text) to authenticated;
