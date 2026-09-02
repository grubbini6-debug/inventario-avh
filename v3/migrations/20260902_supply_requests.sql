-- Solicitudes de abastecimiento: depositario -> administrador -> depositario.
create table if not exists public.supply_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references public.profiles(id),
  warehouse_id uuid not null references public.warehouses(id),
  product_id uuid references public.products(id),
  requested_name text not null,
  quantity numeric not null check (quantity > 0),
  unit text not null,
  urgency text not null default 'normal' check (urgency in ('normal','urgent','critical')),
  reason text,
  notes text,
  status text not null default 'pending' check (status in ('pending','in_progress','fulfilled','rejected')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  resolution_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists supply_requests_status_created_idx on public.supply_requests(status, created_at desc);
create index if not exists supply_requests_requested_by_idx on public.supply_requests(requested_by, created_at desc);
create index if not exists supply_requests_warehouse_idx on public.supply_requests(warehouse_id, created_at desc);

alter table public.supply_requests enable row level security;

drop policy if exists supply_requests_read on public.supply_requests;
create policy supply_requests_read on public.supply_requests
for select to authenticated
using (requested_by = auth.uid() or public.current_profile_role() = 'admin');

revoke insert, update, delete on public.supply_requests from authenticated;
grant select on public.supply_requests to authenticated;

create or replace function public.create_supply_request(
  p_product_id uuid,
  p_name text,
  p_quantity numeric,
  p_unit text,
  p_urgency text,
  p_reason text,
  p_notes text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles%rowtype;
  v_product public.products%rowtype;
  v_name text;
  v_unit text;
  v_id uuid;
  v_admin record;
begin
  select * into v_profile from public.profiles where id = auth.uid() and active = true;
  if not found or v_profile.role <> 'depositor' or v_profile.warehouse_id is null then
    raise exception 'Solo un depositario activo con depósito asignado puede enviar solicitudes';
  end if;
  if coalesce(p_quantity,0) <= 0 then raise exception 'La cantidad debe ser mayor a cero'; end if;
  if coalesce(p_urgency,'') not in ('normal','urgent','critical') then raise exception 'Urgencia inválida'; end if;

  if p_product_id is not null then
    select * into v_product from public.products where id = p_product_id and active = true;
    if not found then raise exception 'Producto inválido o inactivo'; end if;
    v_name := v_product.name;
    v_unit := coalesce(nullif(trim(p_unit),''), v_product.base_unit);
  else
    v_name := nullif(trim(p_name),'');
    v_unit := nullif(trim(p_unit),'');
    if v_name is null then raise exception 'Escribí qué material necesitás'; end if;
    if v_unit is null then raise exception 'Indicá la unidad'; end if;
  end if;

  insert into public.supply_requests(requested_by,warehouse_id,product_id,requested_name,quantity,unit,urgency,reason,notes)
  values(auth.uid(),v_profile.warehouse_id,p_product_id,v_name,p_quantity,v_unit,p_urgency,nullif(trim(p_reason),''),nullif(trim(p_notes),''))
  returning id into v_id;

  for v_admin in select id from public.profiles where role='admin' and active=true loop
    insert into public.notifications(user_id,kind,title,body,metadata,dedupe_key)
    values(
      v_admin.id,
      case when p_urgency='critical' then 'critical' when p_urgency='urgent' then 'warning' else 'info' end,
      case when p_urgency='critical' then 'Solicitud CRÍTICA de abastecimiento' else 'Nueva solicitud de abastecimiento' end,
      v_profile.username || ' solicita ' || trim(to_char(p_quantity,'FM999999990.###')) || ' ' || v_unit || ' de ' || v_name,
      jsonb_build_object('supply_request_id',v_id,'warehouse_id',v_profile.warehouse_id,'requested_by',auth.uid()),
      'supply_request:' || v_id::text
    ) on conflict do nothing;
  end loop;

  insert into public.audit_events(entity_type,entity_id,action,actor_id,warehouse_id,detail)
  values('supply_request',v_id,'supply_request_created',auth.uid(),v_profile.warehouse_id,
    jsonb_build_object('name',v_name,'quantity',p_quantity,'unit',v_unit,'urgency',p_urgency));

  return v_id;
end;
$$;

revoke all on function public.create_supply_request(uuid,text,numeric,text,text,text,text) from public;
revoke execute on function public.create_supply_request(uuid,text,numeric,text,text,text,text) from anon;
grant execute on function public.create_supply_request(uuid,text,numeric,text,text,text,text) to authenticated;

create or replace function public.review_supply_request(
  p_request_id uuid,
  p_status text,
  p_notes text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_req public.supply_requests%rowtype;
  v_label text;
begin
  if public.current_profile_role() <> 'admin' then raise exception 'Solo administrador'; end if;
  if p_status not in ('in_progress','fulfilled','rejected') then raise exception 'Estado inválido'; end if;

  select * into v_req from public.supply_requests where id=p_request_id for update;
  if not found then raise exception 'Solicitud no encontrada'; end if;
  if v_req.status in ('fulfilled','rejected') then raise exception 'La solicitud ya está cerrada'; end if;

  update public.supply_requests
     set status=p_status, reviewed_by=auth.uid(), reviewed_at=now(), resolution_notes=nullif(trim(p_notes),''), updated_at=now()
   where id=p_request_id;

  v_label := case p_status when 'in_progress' then 'En gestión' when 'fulfilled' then 'Atendida' else 'Rechazada' end;
  insert into public.notifications(user_id,kind,title,body,metadata,dedupe_key)
  values(
    v_req.requested_by,
    case when p_status='fulfilled' then 'success' when p_status='rejected' then 'warning' else 'info' end,
    'Solicitud de abastecimiento: ' || v_label,
    v_req.requested_name || ' · ' || trim(to_char(v_req.quantity,'FM999999990.###')) || ' ' || v_req.unit || case when nullif(trim(p_notes),'') is not null then ' · '||trim(p_notes) else '' end,
    jsonb_build_object('supply_request_id',v_req.id,'status',p_status),
    'supply_request_status:' || v_req.id::text || ':' || p_status
  ) on conflict do nothing;

  insert into public.audit_events(entity_type,entity_id,action,actor_id,warehouse_id,detail)
  values('supply_request',v_req.id,'supply_request_'||p_status,auth.uid(),v_req.warehouse_id,
    jsonb_build_object('status',p_status,'notes',nullif(trim(p_notes),'')));
end;
$$;

revoke all on function public.review_supply_request(uuid,text,text) from public;
revoke execute on function public.review_supply_request(uuid,text,text) from anon;
grant execute on function public.review_supply_request(uuid,text,text) to authenticated;

-- Realtime es complementario: la notificación ya fuerza recarga, pero esto mantiene el modelo consistente.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='supply_requests'
  ) then
    alter publication supabase_realtime add table public.supply_requests;
  end if;
end $$;