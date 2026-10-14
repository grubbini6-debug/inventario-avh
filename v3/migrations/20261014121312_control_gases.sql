-- Gases: existing FIFO stock holds full cylinders. Empty cylinders and custody are separate.
-- No production counts, warehouse assignments or historical movements are reset by installation.
begin;
create schema if not exists avh_gas_private;
revoke all on schema avh_gas_private from public,anon;
grant usage on schema avh_gas_private to authenticated;

create table public.gas_products (
  product_id uuid primary key references public.products(id),
  gas_kind text not null unique check(gas_kind in ('co2','oxygen','glp')),
  gas_name text not null,
  sort_order integer not null
);
insert into public.gas_products(product_id,gas_kind,gas_name,sort_order)
select p.id,m.kind,m.label,m.sort_order from public.products p
join (values ('CO2','co2','CO₂',1),('OXIGENO','oxygen','Oxígeno',2),('GLP-10KG','glp','GLP 10 kg',3)) m(sku,kind,label,sort_order) on p.sku=m.sku
where p.active and p.base_unit='cilindro';

create table public.gas_controls (
  warehouse_id uuid not null references public.warehouses(id),
  product_id uuid not null references public.gas_products(product_id),
  empty_qty integer not null default 0 check(empty_qty>=0),
  version bigint not null default 0,
  counted_at timestamptz,
  counted_by uuid references public.profiles(id),
  primary key(warehouse_id,product_id)
);
insert into public.gas_controls(warehouse_id,product_id)
select w.id,g.product_id from public.warehouses w cross join public.gas_products g where w.active;

create table public.gas_custody (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null,
  product_id uuid not null,
  location text not null check(location in ('production','supplier')),
  person text not null check(length(trim(person)) between 1 and 160),
  person_key text generated always as (lower(regexp_replace(trim(person),'\s+',' ','g'))) stored,
  quantity integer not null check(quantity>=0),
  destination text,
  updated_at timestamptz not null default now(),
  foreign key(warehouse_id,product_id) references public.gas_controls(warehouse_id,product_id),
  unique(warehouse_id,product_id,location,person_key)
);
create index gas_custody_warehouse_idx on public.gas_custody(warehouse_id,product_id);

create table public.gas_events (
  id uuid primary key default gen_random_uuid(),
  event_no bigint generated always as identity unique,
  warehouse_id uuid not null,
  product_id uuid not null,
  action text not null,
  quantity integer not null check(quantity>=0),
  full_delta numeric(18,6) not null,
  empty_delta integer not null,
  outside_delta integer not null,
  supplier_delta integer not null,
  full_before numeric(18,6) not null,
  full_after numeric(18,6) not null check(full_after>=0),
  empty_before integer not null,
  empty_after integer not null check(empty_after>=0),
  person text,
  destination text,
  reference text,
  notes text,
  movement_id uuid references public.movements(id),
  movement_line_id uuid references public.movement_lines(id),
  actor_id uuid not null references public.profiles(id),
  actor_name text not null,
  detail jsonb not null default '{}'::jsonb,
  work_date date not null default (now() at time zone 'America/Asuncion')::date,
  created_at timestamptz not null default now(),
  foreign key(warehouse_id,product_id) references public.gas_controls(warehouse_id,product_id)
);
create index gas_events_history_idx on public.gas_events(warehouse_id,work_date,event_no desc);
create index gas_events_movement_idx on public.gas_events(movement_id);
create table avh_gas_private.requests (
  id uuid primary key,
  actor_id uuid not null references public.profiles(id),
  action text not null,
  payload jsonb not null,
  result jsonb,
  created_at timestamptz not null default now()
);
alter table avh_gas_private.requests enable row level security;

alter table public.gas_products enable row level security;
alter table public.gas_controls enable row level security;
alter table public.gas_custody enable row level security;
alter table public.gas_events enable row level security;
create policy gas_products_read on public.gas_products for select to authenticated using(public.current_profile_role() in ('admin','depositor'));
create policy gas_controls_read on public.gas_controls for select to authenticated using(public.can_access_warehouse(warehouse_id));
create policy gas_custody_read on public.gas_custody for select to authenticated using(public.can_access_warehouse(warehouse_id));
create policy gas_events_read on public.gas_events for select to authenticated using(public.can_access_warehouse(warehouse_id));
revoke all on public.gas_products,public.gas_controls,public.gas_custody,public.gas_events from public,anon,authenticated;
grant select on public.gas_products,public.gas_controls,public.gas_custody,public.gas_events to authenticated;

create view public.v_gas_stock_status with(security_invoker=true) as
select c.warehouse_id,w.name as warehouse_name,c.product_id,g.gas_kind,g.gas_name,g.sort_order,
 coalesce((select sum(b.quantity_remaining) from public.inventory_batches b where b.warehouse_id=c.warehouse_id and b.product_id=c.product_id),0) as full_qty,
 c.empty_qty,c.version,c.counted_at,c.counted_by,
 coalesce((select sum(h.quantity) from public.gas_custody h where h.warehouse_id=c.warehouse_id and h.product_id=c.product_id and h.location='production'),0) as outside_qty,
 coalesce((select sum(h.quantity) from public.gas_custody h where h.warehouse_id=c.warehouse_id and h.product_id=c.product_id and h.location='supplier'),0) as supplier_qty
from public.gas_controls c join public.gas_products g on g.product_id=c.product_id
join public.warehouses w on w.id=c.warehouse_id join public.products p on p.id=c.product_id where w.active and p.active;
revoke all on public.v_gas_stock_status from public,anon,authenticated;
grant select on public.v_gas_stock_status to authenticated;

create function avh_gas_private.whole(p_value text,p_zero boolean default false)
returns integer language plpgsql immutable set search_path='' as $$
declare v numeric;
begin
 begin v:=p_value::numeric; exception when others then raise exception 'Cantidad de cilindros inválida'; end;
 if v is null or v::text in ('NaN','Infinity','-Infinity') or v<>trunc(v) or v>1000000 or v<(case when p_zero then 0 else 1 end) then raise exception 'Cantidad de cilindros inválida; usá números enteros'; end if;
 return v::integer;
end $$;
create function avh_gas_private.managed() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from avh_gas_private.requests r where r.id::text=current_setting('avh.gas_request',true) and r.actor_id=auth.uid() and r.result is null)
$$;
create function avh_gas_private.event(p_before jsonb,p_action text,p_qty integer,p_full numeric,p_empty integer,p_outside integer,p_supplier integer,p_person text,p_destination text,p_reference text,p_notes text,p_movement uuid default null,p_line uuid default null,p_detail jsonb default '{}'::jsonb)
returns uuid language plpgsql set search_path='' as $$
declare v_id uuid; v_w uuid:=(p_before->>'warehouse_id')::uuid; v_p uuid:=(p_before->>'product_id')::uuid;
begin
 update public.gas_controls set empty_qty=empty_qty+p_empty,version=version+1 where warehouse_id=v_w and product_id=v_p;
 insert into public.gas_events(warehouse_id,product_id,action,quantity,full_delta,empty_delta,outside_delta,supplier_delta,full_before,full_after,empty_before,empty_after,person,destination,reference,notes,movement_id,movement_line_id,actor_id,actor_name,detail)
 values(v_w,v_p,p_action,p_qty,p_full,p_empty,p_outside,p_supplier,(p_before->>'full_qty')::numeric,(p_before->>'full_qty')::numeric+p_full,(p_before->>'empty_qty')::integer,(p_before->>'empty_qty')::integer+p_empty,p_person,p_destination,p_reference,p_notes,p_movement,p_line,auth.uid(),coalesce((select coalesce(nullif(p.full_name,''),p.username) from public.profiles p where p.id=auth.uid()),'Usuario'),p_detail)
 returning id into v_id;
 insert into public.audit_events(entity_type,entity_id,action,actor_id,warehouse_id,movement_id,detail)
 values('gas',v_id,'gas_'||p_action,auth.uid(),v_w,p_movement,jsonb_build_object('product_id',v_p,'full_delta',p_full,'empty_delta',p_empty,'outside_delta',p_outside,'supplier_delta',p_supplier,'person',p_person,'reference',p_reference)||p_detail);
 return v_id;
end $$;
create function avh_gas_private.custody(p_w uuid,p_p uuid,p_location text,p_person text,p_delta integer,p_destination text default null)
returns void language plpgsql set search_path='' as $$
begin
 insert into public.gas_custody(warehouse_id,product_id,location,person,quantity,destination)
 values(p_w,p_p,p_location,p_person,greatest(0,p_delta),p_destination)
 on conflict(warehouse_id,product_id,location,person_key) do update
 set quantity=public.gas_custody.quantity+p_delta,destination=coalesce(p_destination,public.gas_custody.destination),updated_at=now();
end $$;

create function avh_gas_private.command(p_action text,p_data jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 v_user public.profiles; v_req avh_gas_private.requests; v_w uuid; v_p uuid; v_qty integer; v_empty integer; v_person text; v_key text; v_location text;
 v_dest text; v_ref text; v_notes text; v_c public.gas_controls; v_before jsonb; v_full numeric; v_move uuid; v_id uuid; v_delta numeric;
 v_item jsonb; v_holder jsonb; v_holders jsonb; v_old_holders jsonb; v_old_out integer; v_old_sup integer; v_out integer; v_sup integer; v_pending integer;
 v_new_full integer; v_new_empty integer; v_cost numeric; v_currency text; v_result jsonb; v_ids jsonb:='[]'::jsonb;
begin
 select * into v_user from public.profiles where id=auth.uid() and active;
 if not found or v_user.role not in ('admin','depositor') then raise exception 'Usuario no autorizado'; end if;
 if p_request_id is null or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'Solicitud de gases inválida'; end if;
 v_w:=(p_data->>'warehouse_id')::uuid; perform public.assert_can_access_warehouse(v_w);
 if p_action not in ('count','exit','return_empty','return_full','send_refill','refill','new_full') then raise exception 'Movimiento de gases inválido'; end if;
 insert into avh_gas_private.requests(id,actor_id,action,payload) values(p_request_id,v_user.id,p_action,p_data) on conflict do nothing;
 select * into v_req from avh_gas_private.requests where id=p_request_id for update;
 if v_req.actor_id<>v_user.id or v_req.action<>p_action or v_req.payload<>p_data then raise exception 'La solicitud ya fue usada con otros datos'; end if;
 if v_req.result is not null then return v_req.result; end if;
 perform set_config('avh.gas_request',p_request_id::text,true);
 v_notes:=nullif(trim(p_data->>'notes'),'');v_ref:=nullif(trim(p_data->>'reference'),'');
 if coalesce(length(v_notes),0)>2000 or coalesce(length(v_ref),0)>160 then raise exception 'Observación o referencia demasiado larga'; end if;

 if p_action='count' then
  if length(coalesce(v_notes,''))<5 then raise exception 'Indicá el motivo del conteo'; end if;
  if jsonb_typeof(p_data->'items') is distinct from 'array' then raise exception 'Completá el conteo de los tres gases'; end if;
  if jsonb_array_length(p_data->'items')<>(select count(*) from public.gas_products g join public.products p on p.id=g.product_id where p.active)
   or (select count(distinct x->>'product_id') from jsonb_array_elements(p_data->'items') x)<>jsonb_array_length(p_data->'items')
   or exists(select 1 from jsonb_array_elements(p_data->'items') x where not exists(select 1 from public.gas_products g join public.products p on p.id=g.product_id where g.product_id=(x->>'product_id')::uuid and p.active))
  then raise exception 'Completá una sola fila para cada gas'; end if;
  -- Match the original stock RPC lock order: batches first, then gas controls.
  perform 1 from public.inventory_batches b where b.warehouse_id=v_w and b.product_id in(select (x->>'product_id')::uuid from jsonb_array_elements(p_data->'items') x)
   order by b.product_id,b.received_at,b.created_at,b.id for update;
  perform 1 from public.gas_controls c where c.warehouse_id=v_w order by c.product_id for update;
  for v_item in select x from jsonb_array_elements(p_data->'items') x order by x->>'product_id' loop
   v_p:=(v_item->>'product_id')::uuid;select * into v_c from public.gas_controls where warehouse_id=v_w and product_id=v_p;
   if not found or v_c.version is distinct from (v_item->>'expected_version')::bigint then raise exception 'El saldo cambió durante el conteo. Actualizá Gases y revisá las cantidades antes de volver a guardar.'; end if;
   v_new_full:=avh_gas_private.whole(v_item->>'full_qty',true);v_new_empty:=avh_gas_private.whole(v_item->>'empty_qty',true);
   v_holders:=v_item->'holders';if jsonb_typeof(v_holders) is distinct from 'array' then raise exception 'Revisá los cilindros fuera del depósito'; end if;
   v_full:=coalesce((select sum(quantity_remaining) from public.inventory_batches where warehouse_id=v_w and product_id=v_p),0);
   v_before:=to_jsonb(v_c)||jsonb_build_object('full_qty',v_full);
   select coalesce(jsonb_agg(to_jsonb(h)),'[]'::jsonb),coalesce(sum(quantity) filter(where location='production'),0),coalesce(sum(quantity) filter(where location='supplier'),0)
    into v_old_holders,v_old_out,v_old_sup from public.gas_custody h where warehouse_id=v_w and product_id=v_p;
   delete from public.gas_custody where warehouse_id=v_w and product_id=v_p;
   v_out:=0;v_sup:=0;
   for v_holder in select x from jsonb_array_elements(v_holders) x loop
    v_person:=regexp_replace(trim(v_holder->>'person'),'\s+',' ','g');v_location:=v_holder->>'location';v_qty:=avh_gas_private.whole(v_holder->>'quantity');
    if v_person is null or length(v_person) not between 1 and 160 or v_location is null or v_location not in ('production','supplier') then raise exception 'Revisá nombre y ubicación del responsable'; end if;
    insert into public.gas_custody(warehouse_id,product_id,location,person,quantity) values(v_w,v_p,v_location,v_person,v_qty);
    if v_location='production' then v_out:=v_out+v_qty;else v_sup:=v_sup+v_qty;end if;
   end loop;
   v_delta:=v_new_full-v_full;v_move:=null;
   if v_delta>0 then
    v_move:=public.record_entry(v_w,null,null,jsonb_build_array(jsonb_build_object('product_id',v_p,'quantity',v_delta,'unit','cilindro','factor_to_base',1,'request_id',gen_random_uuid(),'lot_reference','CONTEO DE GASES')),v_notes);
   elsif v_delta<0 then
    v_move:=public.record_exit(v_w,null,null,null,null,jsonb_build_array(jsonb_build_object('product_id',v_p,'quantity',-v_delta,'unit','cilindro','factor_to_base',1,'request_id',gen_random_uuid())),v_notes);
   end if;
   if v_move is not null then update public.movements set type='adjustment',notes='Conteo de gases: '||v_notes where id=v_move;end if;
   update public.gas_controls set counted_at=now(),counted_by=v_user.id where warehouse_id=v_w and product_id=v_p;
   v_id:=avh_gas_private.event(v_before,'count',v_new_full,v_delta,v_new_empty-v_c.empty_qty,v_out-v_old_out,v_sup-v_old_sup,null,null,null,v_notes,v_move,null,jsonb_build_object('holders_before',v_old_holders,'holders_after',v_holders,'counted_full',v_new_full,'counted_empty',v_new_empty));
   v_ids:=v_ids||jsonb_build_array(v_id);
  end loop;
  v_result:=jsonb_build_object('event_ids',v_ids);
 else
  v_p:=(p_data->>'product_id')::uuid;
  if not exists(select 1 from public.gas_products g join public.products p on p.id=g.product_id where g.product_id=v_p and p.active) then raise exception 'Gas inexistente o inactivo'; end if;
  v_qty:=avh_gas_private.whole(p_data->>'quantity');v_empty:=avh_gas_private.whole(coalesce(nullif(p_data->>'empty_quantity',''),'0'),true);
  if p_action not in ('exit','refill') and v_empty<>0 then raise exception 'Este movimiento no admite un canje de vacíos';end if;
  v_person:=regexp_replace(trim(p_data->>'person'),'\s+',' ','g');v_dest:=nullif(trim(p_data->>'destination'),'');
  if v_person is null or length(v_person) not between 1 and 160 or coalesce(length(v_dest),0)>240 then raise exception 'Indicá una persona o proveedor válido'; end if;
  if p_action='exit' and v_dest is null then raise exception 'Indicá el destino o trabajo';end if;
  v_key:=lower(v_person);
  perform 1 from public.inventory_batches b where b.warehouse_id=v_w and b.product_id=v_p order by b.product_id,b.received_at,b.created_at,b.id for update;
  select * into v_c from public.gas_controls where warehouse_id=v_w and product_id=v_p for update;
  if not found or v_c.counted_at is null then raise exception 'Hacé primero el nuevo conteo físico de gases';end if;
  v_full:=coalesce((select sum(quantity_remaining) from public.inventory_batches where warehouse_id=v_w and product_id=v_p),0);
  v_before:=to_jsonb(v_c)||jsonb_build_object('full_qty',v_full);
  v_location:=case when p_action in ('send_refill','refill','new_full') then 'supplier' else 'production' end;
  v_pending:=coalesce((select quantity from public.gas_custody where warehouse_id=v_w and product_id=v_p and location=v_location and person_key=v_key),0);
  v_delta:=0;v_out:=0;v_sup:=0;v_new_empty:=0;v_move:=null;
  if p_action='exit' then
   if v_empty>v_pending then raise exception 'Los vacíos devueltos superan los pendientes de esta persona'; end if;
   v_move:=public.record_exit(v_w,nullif(p_data->>'barge_id','')::uuid,null,v_person,v_dest,jsonb_build_array(jsonb_build_object('product_id',v_p,'quantity',v_qty,'unit','cilindro','factor_to_base',1,'request_id',gen_random_uuid())),v_notes);
   perform avh_gas_private.custody(v_w,v_p,'production',v_person,v_qty-v_empty,v_dest);v_delta:=-v_qty;v_out:=v_qty-v_empty;v_new_empty:=v_empty;
  elsif p_action in ('return_empty','return_full') then
   if v_qty>v_pending then raise exception 'La devolución supera los cilindros pendientes de esta persona';end if;
   perform avh_gas_private.custody(v_w,v_p,'production',v_person,-v_qty);
   v_out:=-v_qty;
   if p_action='return_empty' then v_new_empty:=v_qty;
   else v_move:=public.record_return(v_w,null,null,v_person,jsonb_build_array(jsonb_build_object('product_id',v_p,'quantity',v_qty,'unit','cilindro','factor_to_base',1,'request_id',gen_random_uuid())),v_notes);v_delta:=v_qty;end if;
  elsif p_action='send_refill' then
   if v_qty>v_c.empty_qty then raise exception 'Vacíos insuficientes en el depósito';end if;
   perform avh_gas_private.custody(v_w,v_p,'supplier',v_person,v_qty);v_new_empty:=-v_qty;v_sup:=v_qty;
  elsif p_action in ('refill','new_full') then
   if p_action='refill' then
    if v_empty>v_c.empty_qty then raise exception 'Vacíos insuficientes para el canje';end if;
    if v_qty>v_pending+v_empty then raise exception 'La recarga supera los vacíos entregados o pendientes con este proveedor. Para cilindros nuevos elegí el otro tipo de ingreso.';end if;
    perform avh_gas_private.custody(v_w,v_p,'supplier',v_person,v_empty-v_qty);v_sup:=v_empty-v_qty;v_new_empty:=-v_empty;
   end if;
   v_cost:=nullif(p_data->>'unit_cost','')::numeric;v_currency:=nullif(p_data->>'currency','');
   if v_user.role<>'admin' and (v_cost is not null or v_currency is not null) then raise exception 'Solo administración puede cargar precios';end if;
   if (v_cost is null)<>(v_currency is null) or (v_cost is not null and (v_cost<0 or v_cost::text in ('NaN','Infinity','-Infinity') or v_currency not in ('USD','PYG'))) then raise exception 'Revisá precio y moneda de la recarga';end if;
   v_move:=public.record_entry(v_w,null,null,jsonb_build_array(jsonb_build_object('product_id',v_p,'quantity',v_qty,'unit','cilindro','factor_to_base',1,'request_id',gen_random_uuid(),'unit_cost',v_cost,'currency',v_currency,'lot_reference',coalesce(v_ref,'GASES'))),v_notes);v_delta:=v_qty;
  end if;
  v_id:=avh_gas_private.event(v_before,p_action,v_qty,v_delta,v_new_empty,v_out,v_sup,v_person,v_dest,v_ref,v_notes,v_move);
  v_result:=jsonb_build_object('event_id',v_id,'movement_id',v_move);
 end if;
 update avh_gas_private.requests set result=v_result where id=p_request_id;
 perform set_config('avh.gas_request','',true);
 return v_result;
end $$;
create function public.gas_command(p_action text,p_data jsonb,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select avh_gas_private.command(p_action,p_data,p_request_id)$$;

-- Ordinary material entries and purchase receipts appear in the same gas history.
-- Ordinary gas exits require the same custody details as the dedicated form.
create function avh_gas_private.capture_line() returns trigger language plpgsql security definer set search_path='' as $$
declare m public.movements; c public.gas_controls; w uuid; q integer; f numeric; d numeric; a text; person text; k text; pending integer; outside integer:=0; before jsonb;
begin
 if not exists(select 1 from public.gas_products where product_id=new.product_id) or avh_gas_private.managed() then return new;end if;
 select * into m from public.movements where id=new.movement_id;
 w:=case when m.type in ('exit','transfer') then m.warehouse_from_id else m.warehouse_to_id end;
 if w is null then return new;end if;
 insert into public.gas_controls(warehouse_id,product_id) values(w,new.product_id) on conflict do nothing;
 select * into c from public.gas_controls where warehouse_id=w and product_id=new.product_id for update;
 q:=avh_gas_private.whole(new.base_quantity::text);
 f:=coalesce((select sum(quantity_remaining) from public.inventory_batches where warehouse_id=w and product_id=new.product_id),0);
 before:=to_jsonb(c)||jsonb_build_object('full_qty',f);person:=regexp_replace(trim(m.person_receiving),'\s+',' ','g');k:=lower(person);
 a:=m.type;d:=q;
 if m.type='exit' then
  if c.counted_at is null then raise exception 'Hacé primero el conteo físico en Gases';end if;
  if person is null or length(person) not between 1 and 160 or nullif(trim(coalesce(m.destination_text,m.destination)),'') is null then raise exception 'Para retirar gases registrá persona y destino desde Gases';end if;
  perform avh_gas_private.custody(w,new.product_id,'production',person,q,coalesce(m.destination_text,m.destination));d:=-q;outside:=q;
 elsif m.type='return' then
  if c.counted_at is null then raise exception 'Hacé primero el conteo físico en Gases';end if;
  pending:=coalesce((select quantity from public.gas_custody where warehouse_id=w and product_id=new.product_id and location='production' and person_key=k),0);
  if q>pending then raise exception 'La devolución de lleno supera los pendientes. Si recibiste vacíos usá Gases → Recibir vacíos';end if;
  perform avh_gas_private.custody(w,new.product_id,'production',person,-q);outside:=-q;a:='return_full';
 elsif m.type='transfer' then a:='transfer_out';d:=-q;
 elsif m.type='initial' and c.counted_at is not null then raise exception 'Los gases ya tienen conteo. Usá Gases → Nuevo conteo para registrar una diferencia';
 elsif m.type not in ('entry','initial') then raise exception 'Corregí las cantidades desde Gases → Nuevo conteo';
 end if;
 perform avh_gas_private.event(before,a,q,d,0,outside,0,person,coalesce(m.destination_text,m.destination),null,m.notes,m.id,new.id,jsonb_build_object('source','inventory'));
 return new;
end $$;
create trigger gas_capture_movement_line after insert on public.movement_lines for each row execute function avh_gas_private.capture_line();

create function avh_gas_private.capture_transfer_receipt() returns trigger language plpgsql security definer set search_path='' as $$
declare m public.movements; c public.gas_controls; line public.movement_lines; f numeric; q integer;
begin
 if not exists(select 1 from public.gas_products where product_id=new.product_id) or avh_gas_private.managed() then return new;end if;
 select * into line from public.movement_lines where id=new.source_line_id;select * into m from public.movements where id=line.movement_id;
 if m.type<>'transfer' then return new;end if;
 insert into public.gas_controls(warehouse_id,product_id) values(new.warehouse_id,new.product_id) on conflict do nothing;
 select * into c from public.gas_controls where warehouse_id=new.warehouse_id and product_id=new.product_id for update;
 q:=avh_gas_private.whole(new.quantity_received::text);f:=coalesce((select sum(quantity_remaining) from public.inventory_batches where warehouse_id=new.warehouse_id and product_id=new.product_id),0);
 perform avh_gas_private.event(to_jsonb(c)||jsonb_build_object('full_qty',f-q),'transfer_in',q,q,0,0,0,null,null,null,m.notes,m.id,line.id,jsonb_build_object('batch_id',new.id));
 return new;
end $$;
create trigger gas_capture_transfer_receipt after insert on public.inventory_batches for each row execute function avh_gas_private.capture_transfer_receipt();

create function avh_gas_private.protect_movement() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if avh_gas_private.managed() or not exists(select 1 from public.gas_events where movement_id=old.id) then
  if tg_op='DELETE' then return old;else return new;end if;
 end if;
 if tg_op='DELETE' then raise exception 'El historial de gases se conserva. Corregí mediante un nuevo conteo';end if;
 if new.type is distinct from old.type or (new.status is distinct from old.status and not (old.type='transfer' and old.status='in_transit' and new.status='received'))
  or new.warehouse_from_id is distinct from old.warehouse_from_id or new.warehouse_to_id is distinct from old.warehouse_to_id or new.person_receiving is distinct from old.person_receiving
 then raise exception 'Este movimiento pertenece al control de gases. Corregí las cantidades desde Gases → Nuevo conteo';end if;
 return new;
end $$;
create trigger gas_protect_movement before update or delete on public.movements for each row execute function avh_gas_private.protect_movement();

create function avh_gas_private.new_warehouse() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.gas_controls(warehouse_id,product_id) select new.id,g.product_id from public.gas_products g;return new;end $$;
create trigger gas_initialize_warehouse after insert on public.warehouses for each row execute function avh_gas_private.new_warehouse();

revoke all on all tables in schema avh_gas_private from public,anon,authenticated;
revoke all on all functions in schema avh_gas_private from public,anon,authenticated;
grant execute on function avh_gas_private.command(text,jsonb,uuid) to authenticated;
revoke all on function public.gas_command(text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.gas_command(text,jsonb,uuid) to authenticated;
revoke all on all sequences in schema avh_gas_private from public,anon,authenticated;
revoke all on sequence public.gas_events_event_no_seq from public,anon,authenticated;
commit;
