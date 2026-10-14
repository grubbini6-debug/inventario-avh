-- Additive workspace for naval work orders. Existing inventory is untouched.
begin;
create schema avh_work_order_private;
revoke all on schema avh_work_order_private from public,anon;
grant usage on schema avh_work_order_private to authenticated;
create table public.work_order_access (
 user_id uuid primary key references public.profiles(id),
 access_level text not null check(access_level in ('editor','quality','viewer')),
 granted_by uuid not null references public.profiles(id), granted_at timestamptz not null default now()
);
create table avh_work_order_private.counters (year integer primary key,last_number integer not null);
create table public.work_orders (
 id uuid primary key default gen_random_uuid(), number text unique,
 status text not null default 'draft' check(status in ('draft','issued','in_progress','closed','cancelled')),
 payload jsonb not null,issued_payload jsonb,
 version integer not null default 1,created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 issued_at timestamptz,issued_by uuid references public.profiles(id),source_file_path text,
 check(jsonb_typeof(payload)='object'),check((number is null)=(issued_payload is null))
);
create index work_orders_status_date_idx on public.work_orders(status,created_at desc,id);
create table public.work_order_progress (
 order_id uuid not null references public.work_orders(id),task_id text not null,
 percent numeric not null check(percent>=0 and percent<=100 and percent<>'NaN'::numeric),
 notes text not null,updated_by uuid not null references public.profiles(id),updated_at timestamptz not null default now(),
 primary key(order_id,task_id)
);
create table public.work_order_quality (
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.work_orders(id),task_id text not null,
 result text not null check(result in ('approved','rework','rejected')),observations text not null,
 responsible_id uuid not null references public.profiles(id),created_at timestamptz not null default now()
);
create index work_order_quality_task_date_idx on public.work_order_quality(order_id,task_id,created_at desc,id);
create table public.work_order_events (
 id uuid primary key default gen_random_uuid(),order_id uuid references public.work_orders(id),
 actor_id uuid not null references public.profiles(id),action text not null,
 request_id uuid not null,request_data jsonb not null,result jsonb not null,created_at timestamptz not null default now(),
 unique(actor_id,request_id)
);
create index work_order_events_order_date_idx on public.work_order_events(order_id,created_at desc);
create function avh_work_order_private.role()
returns text language sql stable security definer set search_path='' as $$
 select case when p.role='admin' then 'admin' else a.access_level end
 from public.profiles p left join public.work_order_access a on a.user_id=p.id
 where p.id=(select auth.uid()) and p.active
$$;
create function avh_work_order_private.validate_payload(p jsonb)
returns void language plpgsql set search_path='' as $$
declare t jsonb;m jsonb;k text;
begin
 if jsonb_typeof(p) is distinct from 'object' or length(p::text)>1500000 or
    coalesce(length(trim(p->>'title')),0) not between 1 and 180 or
    coalesce(length(trim(p->>'vessel')),0) not between 1 and 180 or
    jsonb_typeof(p->'tasks') is distinct from 'array' then raise exception 'Completá título, embarcación y trabajos.';end if;
 if jsonb_array_length(p->'tasks') not between 1 and 300 then raise exception 'La orden admite de 1 a 300 trabajos.';end if;
 if (select count(*) from jsonb_array_elements(p->'tasks'))<>(select count(distinct x->>'id') from jsonb_array_elements(p->'tasks') x) then raise exception 'Identificadores de trabajos duplicados.';end if;
 perform (p->>'order_date')::date;
 if nullif(p->>'order_date','') is null then raise exception 'Indicá la fecha de la orden.';end if;
 if nullif(p->>'due_date','') is not null then perform (p->>'due_date')::date;end if;
 for t in select value from jsonb_array_elements(p->'tasks') loop
   if coalesce(length(t->>'id'),0) not between 1 and 100 or coalesce(length(trim(t->>'description')),0) not between 1 and 4000 then raise exception 'Trabajo sin identificador o descripción válida.';end if;
   foreach k in array array['length_mm','width_mm','thickness_mm','quantity','area_m2','weight_kg'] loop
    if t->k is not null and t->k<>'null'::jsonb and (jsonb_typeof(t->k)<>'number' or (t->>k)::numeric<0) then raise exception 'Medidas y cantidades inválidas.';end if;
   end loop;
   if jsonb_typeof(t->'materials') is distinct from 'array' or jsonb_array_length(t->'materials')>30 then raise exception 'Plan de insumos inválido.';end if;
   for m in select value from jsonb_array_elements(t->'materials') loop
    if coalesce(length(trim(m->>'description')),0) not between 1 and 500 or coalesce(length(trim(m->>'unit')),0) not between 1 and 50 then raise exception 'Insumo sin descripción o unidad.';end if;
    if m->'quantity' is not null and m->'quantity'<>'null'::jsonb and (jsonb_typeof(m->'quantity')<>'number' or (m->>'quantity')::numeric<=0) then raise exception 'Cantidad de insumo inválida.';end if;
    if coalesce((m->>'confirmed')::boolean,false) and (m->'quantity' is null or m->'quantity'='null'::jsonb) then raise exception 'Un insumo confirmado necesita cantidad.';end if;
    if nullif(m->>'product_id','') is not null then
     if not exists(select 1 from public.products where id=(m->>'product_id')::uuid and active and base_unit=m->>'unit') then raise exception 'Revisá el producto vinculado y su unidad base.';end if;
    end if;
   end loop;
 end loop;
end $$;
do $$ declare t text;begin
 foreach t in array array['work_order_access','work_orders','work_order_progress','work_order_quality','work_order_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
 end loop;
 foreach t in array array['work_orders','work_order_progress','work_order_quality','work_order_events'] loop
  execute format('create policy work_order_read on public.%I for select to authenticated using ((select avh_work_order_private.role()) is not null)',t);
 end loop;
end $$;
create policy work_order_access_read on public.work_order_access for select to authenticated
 using ((select avh_work_order_private.role())='admin' or user_id=(select auth.uid()));
create function avh_work_order_private.context()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('access_level',avh_work_order_private.role(),'access',
 case when avh_work_order_private.role()='admin' then coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('username',p.username,'full_name',p.full_name)) from public.work_order_access a join public.profiles p on p.id=a.user_id),'[]'::jsonb) else '[]'::jsonb end)
$$;
create function public.work_order_context()
returns jsonb language sql stable security invoker set search_path='' as $$select avh_work_order_private.context()$$;
create function avh_work_order_private.command(p_action text,p_data jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r text:=avh_work_order_private.role();o public.work_orders;prev public.work_order_events;
 v_id uuid;v_result jsonb;v_payload jsonb;v_year integer;v_no integer;v_company jsonb;
begin
 if auth.uid() is null or r is null then raise exception 'No autorizado para Órdenes de Trabajo.';end if;
 if p_request_id is null or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Solicitud inválida.';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into prev from public.work_order_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if prev.action<>p_action or prev.request_data<>p_data then raise exception 'Solicitud reutilizada con datos distintos.';end if;
  return prev.result;
 end if;
 if p_action='access' then
  if r<>'admin' then raise exception 'Solo Administración puede habilitar usuarios.';end if;
  if not exists(select 1 from public.profiles where id=(p_data->>'user_id')::uuid and active) then raise exception 'Usuario no activo.';end if;
  if p_data->>'access_level'='none' then delete from public.work_order_access where user_id=(p_data->>'user_id')::uuid;
  else insert into public.work_order_access(user_id,access_level,granted_by) values((p_data->>'user_id')::uuid,p_data->>'access_level',auth.uid())
   on conflict(user_id) do update set access_level=excluded.access_level,granted_by=excluded.granted_by,granted_at=now();end if;
  v_result:=jsonb_build_object('ok',true);
 else
  v_id:=(p_data->>'order_id')::uuid;
  select * into o from public.work_orders where id=v_id for update;
  if p_action='save' then
   if r not in ('admin','editor') then raise exception 'Solo un editor puede preparar órdenes.';end if;
   v_payload:=p_data->'payload';perform avh_work_order_private.validate_payload(v_payload);
   if o.id is null then
    if v_id is null then raise exception 'Falta identificador de orden.';end if;
    insert into public.work_orders(id,payload,created_by) values(v_id,v_payload,auth.uid());
   else
    if o.status<>'draft' then raise exception 'El alcance de una orden emitida queda conservado. Creá un nuevo borrador para trabajos adicionales.';end if;
    if o.version is distinct from (p_data->>'expected_version')::integer then raise exception 'La orden cambió. Volvé a abrirla antes de guardar.';end if;
    update public.work_orders set payload=v_payload,version=version+1,updated_at=now() where id=v_id;
   end if;
  else
   if o.id is null then raise exception 'Orden inexistente.';end if;
   if p_action='issue' then
    if r not in ('admin','editor') or o.status<>'draft' then raise exception 'La orden no se puede emitir en este estado.';end if;
    if o.version is distinct from (p_data->>'expected_version')::integer then raise exception 'La orden cambió. Volvé a abrirla.';end if;
    perform avh_work_order_private.validate_payload(o.payload);
    if coalesce(length(trim(o.payload->>'client')),0)=0 or coalesce(length(trim(o.payload->>'responsible')),0)=0 then raise exception 'Completá cliente y responsable técnico antes de emitir.';end if;
    v_year:=extract(year from (o.payload->>'order_date')::date);
    if v_year not between 2000 and 2100 then raise exception 'Fecha de orden inválida.';end if;
    insert into avh_work_order_private.counters values(v_year,1) on conflict(year) do update set last_number=avh_work_order_private.counters.last_number+1 returning last_number into v_no;
    select jsonb_build_object('legal_name',c.legal_name,'name',c.name,'tax_id',c.tax_id,'address',c.address,'phone',c.phone,'email',c.email) into v_company
     from public.purchase_companies c where c.active and (c.name ilike '%AVH%' or c.legal_name ilike '%Villa Hayes%') order by c.name limit 1;
    update public.work_orders set number='OT-AVH-'||v_year||'-'||lpad(v_no::text,5,'0'),
     issued_payload=payload||jsonb_build_object('company',coalesce(v_company,'{}'::jsonb)),status='issued',issued_at=now(),issued_by=auth.uid(),version=version+1,updated_at=now() where id=v_id;
   elsif p_action='progress' then
    if r not in ('admin','editor') or o.status not in ('issued','in_progress') then raise exception 'No se puede registrar avance en este estado.';end if;
    if not exists(select 1 from jsonb_array_elements(o.payload->'tasks') t where t->>'id'=p_data->>'task_id') then raise exception 'Trabajo no encontrado.';end if;
    if coalesce(length(trim(p_data->>'notes')),0)=0 then raise exception 'Indicá la actividad realizada.';end if;
    insert into public.work_order_progress(order_id,task_id,percent,notes,updated_by) values(v_id,p_data->>'task_id',(p_data->>'percent')::numeric,p_data->>'notes',auth.uid())
     on conflict(order_id,task_id) do update set percent=excluded.percent,notes=excluded.notes,updated_by=excluded.updated_by,updated_at=now();
    update public.work_orders set status='in_progress',updated_at=now() where id=v_id;
   elsif p_action='quality' then
    if r not in ('admin','quality') or o.status not in ('issued','in_progress') then raise exception 'Se requiere acceso de Calidad para inspeccionar.';end if;
    if not exists(select 1 from jsonb_array_elements(o.payload->'tasks') t where t->>'id'=p_data->>'task_id') then raise exception 'Trabajo no encontrado.';end if;
    if coalesce(length(trim(p_data->>'observations')),0)=0 then raise exception 'Registrá la inspección realizada.';end if;
    insert into public.work_order_quality(order_id,task_id,result,observations,responsible_id) values(v_id,p_data->>'task_id',p_data->>'result',p_data->>'observations',auth.uid());
   elsif p_action='attachment' then
    if r not in ('admin','editor') or o.status<>'draft' then raise exception 'No se puede adjuntar en este estado.';end if;
    if split_part(p_data->>'path','/',1)<>v_id::text or not exists(select 1 from storage.objects where bucket_id='work-order-documents' and name=p_data->>'path') then raise exception 'Archivo no encontrado en la orden.';end if;
    update public.work_orders set source_file_path=p_data->>'path' where id=v_id;
   elsif p_action='close' then
    if r not in ('admin','editor') or o.status not in ('issued','in_progress') then raise exception 'No se puede cerrar esta orden.';end if;
    if exists(select 1 from jsonb_array_elements(o.payload->'tasks') t where not exists(select 1 from public.work_order_progress p where p.order_id=v_id and p.task_id=t->>'id' and p.percent=100)) then raise exception 'Quedan trabajos con avance pendiente.';end if;
    if exists(select 1 from jsonb_array_elements(o.payload->'tasks') t where (select q.result from public.work_order_quality q where q.order_id=v_id and q.task_id=t->>'id' order by q.created_at desc,q.id desc limit 1) is distinct from 'approved') then raise exception 'Calidad debe aprobar los trabajos antes del cierre.';end if;
    update public.work_orders set status='closed',updated_at=now() where id=v_id;
   elsif p_action='cancel' then
    if r not in ('admin','editor') or o.status in ('closed','cancelled') then raise exception 'No se puede anular esta orden.';end if;
    if coalesce(length(trim(p_data->>'reason')),0)<5 then raise exception 'Indicá el motivo de anulación.';end if;
    update public.work_orders set status='cancelled',updated_at=now() where id=v_id;
   else raise exception 'Acción no reconocida.';end if;
  end if;
  select jsonb_build_object('id',id,'number',number,'status',status,'version',version) into v_result from public.work_orders where id=v_id;
 end if;
 insert into public.work_order_events(order_id,actor_id,action,request_id,request_data,result) values(v_id,auth.uid(),p_action,p_request_id,p_data,v_result);
 insert into public.audit_events(entity_type,entity_id,action,actor_id,detail)
 values('work_order',v_id,'WORK_ORDER_'||upper(p_action),auth.uid(),jsonb_build_object('result',v_result,'request_id',p_request_id));
 return v_result;
end $$;
create function public.work_order_command(p_action text,p_data jsonb,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$ select avh_work_order_private.command(p_action,p_data,p_request_id) $$;
revoke all on all tables in schema avh_work_order_private from public,anon,authenticated;
revoke all on all functions in schema avh_work_order_private from public,anon;
grant execute on function avh_work_order_private.role(),avh_work_order_private.context(),avh_work_order_private.command(text,jsonb,uuid) to authenticated;
revoke all on function public.work_order_context(),public.work_order_command(text,jsonb,uuid) from public,anon;
grant execute on function public.work_order_context(),public.work_order_command(text,jsonb,uuid) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('work-order-documents','work-order-documents',false,10485760,array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','application/octet-stream','application/pdf','image/jpeg','image/png']);
create policy work_order_file_read on storage.objects for select to authenticated using(bucket_id='work-order-documents' and (select avh_work_order_private.role()) is not null and exists(select 1 from public.work_orders o where o.id::text=split_part(name,'/',1)));
create policy work_order_file_insert on storage.objects for insert to authenticated with check(bucket_id='work-order-documents' and (select avh_work_order_private.role()) in ('admin','editor') and exists(select 1 from public.work_orders o where o.id::text=split_part(name,'/',1) and o.status='draft'));
commit;
