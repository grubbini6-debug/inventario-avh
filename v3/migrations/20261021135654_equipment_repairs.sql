-- Machine identity, repair budgets and service custody. Installation creates no operational data.
begin;
create schema avh_repair_private;
revoke all on schema avh_repair_private from public,anon;
grant usage on schema avh_repair_private to authenticated;
create sequence avh_repair_private.order_seq;

create table public.equipment_assets(
 id uuid primary key default gen_random_uuid(),code text not null unique check(length(code) between 1 and 60),
 name text not null check(length(trim(name)) between 1 and 200),brand text,model text,serial_number text,
 warehouse_id uuid not null references public.warehouses(id),company_id uuid references public.purchase_companies(id),
 status text not null default 'available' check(status in ('available','needs_repair','in_repair','testing','inactive')),
 current_location text,notes text,version integer not null default 1,
 created_by uuid not null references public.profiles(id),updated_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index equipment_assets_serial_unique on public.equipment_assets(lower(trim(serial_number))) where serial_number is not null;
create index equipment_assets_warehouse_idx on public.equipment_assets(warehouse_id,status);
create index equipment_assets_company_idx on public.equipment_assets(company_id);
create index equipment_assets_created_by_idx on public.equipment_assets(created_by);
create index equipment_assets_updated_by_idx on public.equipment_assets(updated_by);
create table public.repair_orders(
 id uuid primary key,number text not null unique,status text not null default 'draft' check(status in ('draft','pending','approved','in_service','testing','completed','cancelled')),
 warehouse_id uuid references public.warehouses(id),company_id uuid references public.purchase_companies(id),supplier_id uuid references public.suppliers(id),
 payload jsonb not null,approved_payload jsonb,proposed_payload jsonb,approval jsonb,invoice jsonb,
 approved_total numeric(18,2),currency text check(currency in ('PYG','USD')),purchase_id uuid unique references public.purchases(id),
 additional_purchase_ids uuid[] not null default '{}',version integer not null default 1,
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index repair_orders_state_date_idx on public.repair_orders(status,created_at desc,id);
create index repair_orders_supplier_idx on public.repair_orders(supplier_id);
create index repair_orders_warehouse_idx on public.repair_orders(warehouse_id);
create index repair_orders_company_idx on public.repair_orders(company_id);
create index repair_orders_created_by_idx on public.repair_orders(created_by);
create index repair_orders_additional_purchases_idx on public.repair_orders using gin(additional_purchase_ids);
create unique index repair_orders_invoice_unique on public.repair_orders(supplier_id,lower(trim(invoice->>'number'))) where invoice is not null;
create table public.repair_assets(
 order_id uuid not null references public.repair_orders(id),equipment_id uuid not null references public.equipment_assets(id),
 status text not null default 'awaiting' check(status in ('awaiting','service','testing','rework','ready','cancelled')),
 snapshot jsonb not null,approved_amount numeric(18,2),actual_amount numeric(18,2),dispatch jsonb,receipt jsonb,test jsonb,warranty_until date,
 primary key(order_id,equipment_id)
);
create index repair_assets_equipment_idx on public.repair_assets(equipment_id,order_id);
create unique index repair_assets_one_active on public.repair_assets(equipment_id) where status in ('awaiting','service','testing','rework');
create table public.repair_attachments(
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.repair_orders(id),
 kind text not null check(kind in ('quote','invoice','dispatch','receipt','diagnosis','authorization')),
 file_path text not null unique,file_name text not null check(length(file_name) between 1 and 180),
 uploaded_by uuid not null references public.profiles(id),created_at timestamptz not null default now()
);
create index repair_attachments_actor_idx on public.repair_attachments(uploaded_by);
create index repair_attachments_order_idx on public.repair_attachments(order_id,created_at);
create table public.repair_events(
 id uuid primary key default gen_random_uuid(),order_id uuid references public.repair_orders(id),equipment_id uuid references public.equipment_assets(id),
 actor_id uuid not null references public.profiles(id),actor_name text not null,action text not null,detail jsonb not null,
 created_at timestamptz not null default now()
);
create index repair_events_actor_idx on public.repair_events(actor_id);
create index repair_events_order_idx on public.repair_events(order_id,created_at,id);
create index repair_events_equipment_idx on public.repair_events(equipment_id,created_at,id);
create table avh_repair_private.requests(id uuid primary key,actor_id uuid not null,action text not null,payload jsonb not null,result jsonb,created_at timestamptz not null default now());
alter table avh_repair_private.requests enable row level security;
create policy repair_requests_deny on avh_repair_private.requests for all to authenticated using(false) with check(false);

do $$declare t text;begin
 foreach t in array array['equipment_assets','repair_orders','repair_assets','repair_attachments','repair_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy repair_admin_read on public.%I for select to authenticated using ((select public.current_profile_role())=''admin'')',t);
 end loop;
end $$;

create function avh_repair_private.require_admin() returns void language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active and role='admin' and not coalesce(must_change_password,false)) then raise exception 'Solo Compras / Administración puede gestionar reparaciones.';end if;
end $$;
create function avh_repair_private.txt(v text,maximum integer default 2000) returns text language plpgsql immutable set search_path='' as $$
begin if length(coalesce(v,''))>maximum then raise exception 'Un texto supera el largo permitido (% caracteres).',maximum;end if;return nullif(trim(v),'');end $$;
create function avh_repair_private.num(v text) returns numeric language plpgsql immutable set search_path='' as $$
declare n numeric;begin
 if nullif(v,'') is null then return null;end if;
 begin n:=v::numeric;exception when others then raise exception 'Cantidad o importe inválido.';end;
 if n::text in ('NaN','Infinity','-Infinity') or n<0 or n>1000000000000 then raise exception 'Cantidad o importe fuera de rango.';end if;return n;
end $$;
create function avh_repair_private.normalize(p jsonb,complete boolean default false) returns jsonb language plpgsql set search_path='' as $$
declare v jsonb:='{}';items jsonb:='[]';assets jsonb;allocations jsonb:='[]';j jsonb;k text;eq public.equipment_assets;
 wh uuid;co uuid;su uuid;curr text;mode text;rate numeric;quantity numeric;price numeric;line numeric;subtotal numeric:=0;tax numeric;total numeric;allocated numeric:=0;part numeric;rec record;precision integer;
begin
 if jsonb_typeof(p) is distinct from 'object' or length(p::text)>500000 or jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items')>100 then raise exception 'Presupuesto inválido; se admiten hasta 100 partidas.';end if;
 wh:=nullif(p->>'warehouse_id','')::uuid;co:=nullif(p->>'company_id','')::uuid;su:=nullif(p->>'supplier_id','')::uuid;
 if wh is not null and not exists(select 1 from public.warehouses where id=wh and active) then raise exception 'Depósito inválido.';end if;
 if co is not null and not exists(select 1 from public.purchase_companies where id=co and active) then raise exception 'Empresa inválida.';end if;
 if su is not null and not exists(select 1 from public.suppliers where id=su) then raise exception 'Taller / proveedor inválido.';end if;
 curr:=nullif(p->>'currency','');mode:=nullif(p->>'tax_mode','');rate:=avh_repair_private.num(p->>'tax_rate');precision:=case when curr='PYG' then 0 else 2 end;
 if curr is not null and curr not in ('PYG','USD') or mode is not null and mode not in ('included','add','none') or coalesce(rate,0)>100 then raise exception 'Revisá moneda e impuestos.';end if;
 foreach k in array array['quote_number','problem','payment_terms','notes'] loop v:=v||jsonb_build_object(k,avh_repair_private.txt(p->>k,case when k='quote_number' then 160 else 4000 end));end loop;
 foreach k in array array['quote_date','valid_until'] loop
  if nullif(p->>k,'') is not null then
   if (p->>k)!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Fecha inválida.';end if;
   v:=v||jsonb_build_object(k,(p->>k)::date);
  end if;
 end loop;
 if v->>'valid_until' is not null and v->>'quote_date' is not null and (v->>'valid_until')::date<(v->>'quote_date')::date then raise exception 'La vigencia no puede ser anterior al presupuesto.';end if;
 if avh_repair_private.num(p->>'warranty_days')>3650 or avh_repair_private.num(p->>'warranty_days')<>trunc(avh_repair_private.num(p->>'warranty_days')) then raise exception 'Garantía inválida; indicá días enteros.';end if;
 for j in select value from jsonb_array_elements(p->'items') loop
  select * into eq from public.equipment_assets where id=nullif(j->>'equipment_id','')::uuid;
  if eq.id is not null and (eq.status='inactive' or eq.warehouse_id is distinct from wh or (eq.company_id is not null and eq.company_id is distinct from co)) then raise exception 'La máquina debe corresponder al depósito y a la empresa de la reparación.';end if;
  if nullif(j->>'equipment_id','') is not null and eq.id is null then raise exception 'Máquina inexistente.';end if;
  quantity:=avh_repair_private.num(j->>'quantity');price:=avh_repair_private.num(j->>'unit_price');
  if quantity>1000000 then raise exception 'Cantidad fuera de rango.';end if;
  if nullif(j->>'kind','') is not null and j->>'kind' not in ('labor','part','other') then raise exception 'Tipo de partida inválido.';end if;
  if complete and (eq.id is null or quantity is null or quantity<=0 or price is null or avh_repair_private.txt(j->>'description',4000) is null) then raise exception 'Asigná cada partida a una máquina y completá descripción, cantidad y precio.';end if;
  line:=round(quantity*price,precision);subtotal:=subtotal+coalesce(line,0);
  if subtotal>1000000000000 then raise exception 'El presupuesto supera el importe permitido.';end if;
  items:=items||jsonb_build_array(jsonb_build_object('equipment_id',eq.id,'kind',coalesce(nullif(j->>'kind',''),'labor'),'description',avh_repair_private.txt(j->>'description',4000),'quantity',quantity,'unit_price',price,'line_total',line));
 end loop;
 tax:=case when mode='add' then round(subtotal*coalesce(rate,0)/100,precision) else 0 end;total:=subtotal+tax;
 if total>1000000000000 then raise exception 'El presupuesto supera el importe permitido.';end if;
 if complete and (wh is null or co is null or su is null or curr is null or mode is null or (mode='add' and rate is null) or jsonb_array_length(items)=0 or v->>'problem' is null or v->>'quote_number' is null or v->>'quote_date' is null or coalesce((p->>'reviewed')::boolean,false) is not true) then raise exception 'Completá empresa, depósito, taller, referencia, fecha, falla, moneda e impuestos y confirmá la revisión del presupuesto.';end if;
 if complete and avh_repair_private.num(p->>'source_total') is not null and avh_repair_private.num(p->>'source_total')<>total then raise exception 'El total no coincide con el original. Revisá el IVA, las cantidades y los precios.';end if;
 for rec in select (i->>'equipment_id')::uuid as id,sum((i->>'line_total')::numeric) as base,row_number() over(order by i->>'equipment_id') as n,count(*) over() as cnt from jsonb_array_elements(items) i where i->>'equipment_id' is not null group by i->>'equipment_id' order by i->>'equipment_id' loop
  part:=case when rec.n=rec.cnt then total-allocated when subtotal=0 then 0 else round(coalesce(rec.base,0)/subtotal*total,precision) end;allocated:=allocated+part;
  allocations:=allocations||jsonb_build_array(jsonb_build_object('equipment_id',rec.id,'amount',part));
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'code',e.code,'name',e.name,'brand',e.brand,'model',e.model,'serial_number',e.serial_number) order by e.id),'[]'::jsonb) into assets from public.equipment_assets e where e.id in(select (i->>'equipment_id')::uuid from jsonb_array_elements(items) i);
 return v||jsonb_build_object('warehouse_id',wh,'company_id',co,'supplier_id',su,'currency',curr,'tax_mode',mode,'tax_rate',rate,'source_total',avh_repair_private.num(p->>'source_total'),'warranty_days',avh_repair_private.num(p->>'warranty_days'),'reviewed',coalesce((p->>'reviewed')::boolean,false),'items',items,'assets',assets,'allocations',allocations,'subtotal',subtotal,'tax_amount',tax,'total',total,
 'company',(select to_jsonb(c)-'created_at' from public.purchase_companies c where c.id=co),'supplier',(select jsonb_build_object('id',s.id,'name',s.name,'tax_id',s.tax_id,'phone',s.phone) from public.suppliers s where s.id=su),'warehouse_name',(select name from public.warehouses where id=wh));
end $$;

create function avh_repair_private.purchase(p jsonb,ref text) returns uuid language plpgsql set search_path='' as $$
declare v_purchase_id uuid;items jsonb;
begin
 select jsonb_agg(jsonb_build_object('description',e.code||' · '||(i->>'description'),'quantity',i->'quantity','unit','servicio','factor_to_base',1,'unit_price',i->'unit_price','affects_inventory',false) order by n) into items from jsonb_array_elements(p->'items') with ordinality a(i,n) join public.equipment_assets e on e.id=(i->>'equipment_id')::uuid;
 if (p->>'tax_amount')::numeric>0 then items:=items||jsonb_build_array(jsonb_build_object('description','IVA adicional del servicio','quantity',1,'unit','servicio','unit_price',p->'tax_amount','factor_to_base',1,'affects_inventory',false));end if;
 v_purchase_id:=public.admin_create_purchase(jsonb_build_object('company_id',p->>'company_id','supplier_id',p->>'supplier_id','purchase_type','service','status','quoted','destination_type','direct','destination_text',p->>'warehouse_name','currency',p->>'currency','order_reference',ref,'source_document_number',p->>'quote_number','source_document_date',p->>'quote_date','requester',(select full_name from public.profiles where profiles.id=auth.uid()),'sector','Mantenimiento','payment_terms',p->>'payment_terms','notes','Reparación de equipos · '||ref||E'\n'||coalesce(p->>'problem','')||E'\n'||coalesce(p->>'notes',''),'delivery_mode','single'),items);
 perform public.admin_prepare_purchase_order(v_purchase_id);return v_purchase_id;
end $$;

create function avh_repair_private.command(p_action text,p_data jsonb,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
<<repair_op>>
declare req avh_repair_private.requests;o public.repair_orders;a public.equipment_assets;c public.repair_assets;
 id uuid;eid uuid;v jsonb;j jsonb;result jsonb;detail jsonb;act text;date_value date;precision integer;total numeric;cost numeric;sum_cost numeric:=0;po uuid;po_ids uuid[];rec record;reference text;authorizer text;next_status text;
begin
 perform avh_repair_private.require_admin();
 if p_request_id is null or jsonb_typeof(p_data) is distinct from 'object' or length(p_data::text)>700000 then raise exception 'Operación de reparación inválida.';end if;
 insert into avh_repair_private.requests(id,actor_id,action,payload) values(p_request_id,auth.uid(),p_action,p_data) on conflict do nothing;
 select * into req from avh_repair_private.requests where requests.id=p_request_id for update;
 if req.actor_id<>auth.uid() or req.action<>p_action or req.payload<>p_data then raise exception 'La operación ya fue utilizada con otros datos.';end if;
 if req.result is not null then return req.result;end if;
 if p_action='asset_save' then
  eid:=(p_data->>'equipment_id')::uuid;if eid is null then raise exception 'Falta identificador de máquina.';end if;
  select * into a from public.equipment_assets where equipment_assets.id=eid for update;
  if a.id is not null and a.version is distinct from (p_data->>'expected_version')::integer then raise exception 'La máquina cambió. Actualizá su ficha.';end if;
  if exists(select 1 from public.repair_assets where equipment_id=eid and status in ('awaiting','service','testing','rework')) then raise exception 'La ficha tiene una reparación abierta. Completá su seguimiento antes de cambiar sus datos.';end if;
  v:=p_data->'asset';
  if avh_repair_private.txt(v->>'code',60) is null or avh_repair_private.txt(v->>'name',200) is null or not exists(select 1 from public.warehouses where warehouses.id=(v->>'warehouse_id')::uuid and active) then raise exception 'Completá código, nombre y depósito de la máquina.';end if;
  if coalesce(v->>'status','available') not in ('available','needs_repair','inactive') then raise exception 'El estado de reparación se actualiza desde la orden.';end if;
  if nullif(v->>'company_id','') is not null and not exists(select 1 from public.purchase_companies where purchase_companies.id=(v->>'company_id')::uuid and active) then raise exception 'Empresa de la máquina inválida.';end if;
  insert into public.equipment_assets(id,code,name,brand,model,serial_number,warehouse_id,company_id,status,current_location,notes,created_by,updated_by)
  values(eid,upper(trim(v->>'code')),trim(v->>'name'),avh_repair_private.txt(v->>'brand',180),avh_repair_private.txt(v->>'model',180),avh_repair_private.txt(v->>'serial_number',180),(v->>'warehouse_id')::uuid,nullif(v->>'company_id','')::uuid,coalesce(v->>'status','available'),avh_repair_private.txt(v->>'current_location',300),avh_repair_private.txt(v->>'notes',4000),auth.uid(),auth.uid())
  on conflict on constraint equipment_assets_pkey do update set code=excluded.code,name=excluded.name,brand=excluded.brand,model=excluded.model,serial_number=excluded.serial_number,warehouse_id=excluded.warehouse_id,company_id=excluded.company_id,status=excluded.status,current_location=excluded.current_location,notes=excluded.notes,version=equipment_assets.version+1,updated_by=auth.uid(),updated_at=now();
  select jsonb_build_object('equipment_id',equipment_assets.id,'version',version) into result from public.equipment_assets where equipment_assets.id=eid;
  detail:=v;
 else
  id:=(p_data->>'order_id')::uuid;if id is null then raise exception 'Falta identificador de reparación.';end if;
  -- Serialize requests against one order, including its first save.
  perform pg_advisory_xact_lock(hashtextextended(repair_op.id::text,0));
  select * into o from public.repair_orders where repair_orders.id=repair_op.id for update;
  if p_action<>'attachment' and o.id is not null and o.version is distinct from (p_data->>'expected_version')::integer then raise exception 'La reparación cambió. Volvé a abrirla antes de guardar.';end if;
  if p_action='save' then
   if o.id is not null and o.status<>'draft' then raise exception 'Solo se edita un borrador. Los trabajos adicionales requieren una nueva autorización.';end if;
   v:=avh_repair_private.normalize(p_data->'payload',false);
   insert into public.repair_orders(id,number,payload,warehouse_id,company_id,supplier_id,currency,created_by)
   values(repair_op.id,'REP-'||extract(year from now() at time zone 'America/Asuncion')::text||'-'||lpad(nextval('avh_repair_private.order_seq')::text,5,'0'),v,(v->>'warehouse_id')::uuid,(v->>'company_id')::uuid,(v->>'supplier_id')::uuid,v->>'currency',auth.uid())
   on conflict on constraint repair_orders_pkey do update set payload=v,warehouse_id=excluded.warehouse_id,company_id=excluded.company_id,supplier_id=excluded.supplier_id,currency=excluded.currency,version=repair_orders.version+1,updated_at=now();
   detail:=v;
  else
   if o.id is null then raise exception 'Reparación inexistente.';end if;
   detail:=p_data-'expected_version';
   if p_action='submit' then
    if o.status<>'draft' then raise exception 'La reparación no está en borrador.';end if;
    v:=avh_repair_private.normalize(o.payload,true);update public.repair_orders set payload=v,status='pending' where repair_orders.id=repair_op.id;
   elsif p_action='withdraw' then
    if o.status<>'pending' then raise exception 'Solo se devuelve una reparación pendiente.';end if;
    update public.repair_orders set status='draft' where repair_orders.id=repair_op.id;
   elsif p_action in ('approve','approve_extra') then
    authorizer:=avh_repair_private.txt(p_data->>'authorized_by',180);reference:=avh_repair_private.txt(p_data->>'authorization_reference',500);
    if authorizer is null or reference is null or coalesce((p_data->>'authorization_received')::boolean,false) is not true then raise exception 'Registrá quién autorizó y la referencia de su autorización.';end if;
    if p_action='approve' then
     if o.status<>'pending' then raise exception 'La reparación debe estar pendiente de autorización.';end if;
     v:=avh_repair_private.normalize(o.payload,true);
     if v->>'valid_until' is not null and (v->>'valid_until')::date<(now() at time zone 'America/Asuncion')::date then raise exception 'El presupuesto está vencido. Pedí su actualización.';end if;
     perform 1 from public.equipment_assets where equipment_assets.id in(select (x->>'id')::uuid from jsonb_array_elements(v->'assets') x) order by equipment_assets.id for update;
     if exists(select 1 from public.repair_assets where equipment_id in(select (x->>'id')::uuid from jsonb_array_elements(v->'assets') x) and status in ('awaiting','service','testing','rework')) then raise exception 'Una de las máquinas ya tiene otra reparación abierta.';end if;
     po:=avh_repair_private.purchase(v,o.number);
     for j in select value from jsonb_array_elements(v->'allocations') loop
      insert into public.repair_assets(order_id,equipment_id,snapshot,approved_amount) values(repair_op.id,(j->>'equipment_id')::uuid,(select x from jsonb_array_elements(v->'assets') x where x->>'id'=j->>'equipment_id'),(j->>'amount')::numeric);
     end loop;
     update public.equipment_assets set status='needs_repair',version=version+1,updated_at=now(),updated_by=auth.uid() where equipment_assets.id in(select equipment_id from public.repair_assets where order_id=repair_op.id);
     update public.repair_orders set purchase_id=po,status='approved' where repair_orders.id=repair_op.id;
    else
     if o.proposed_payload is null or o.status in ('draft','pending','completed','cancelled') then raise exception 'No hay trabajos adicionales pendientes.';end if;
     v:=o.proposed_payload;
     j:=v||jsonb_build_object('items',(select jsonb_agg(item) from jsonb_array_elements(v->'items') with ordinality x(item,n) where n>jsonb_array_length(o.approved_payload->'items')),'tax_amount',(v->>'tax_amount')::numeric-(o.approved_payload->>'tax_amount')::numeric);
     po:=avh_repair_private.purchase(j,o.number||' · Adicional');
     update public.repair_orders set additional_purchase_ids=array_append(additional_purchase_ids,po),proposed_payload=null where repair_orders.id=repair_op.id;
     update public.repair_assets rc set approved_amount=(x.value->>'amount')::numeric from jsonb_array_elements(v->'allocations') x(value) where rc.order_id=repair_op.id and rc.equipment_id=(x.value->>'equipment_id')::uuid;
    end if;
    j:=jsonb_build_object('authorized_by',authorizer,'reference',reference,'recorded_by',auth.uid(),'recorded_at',now());
    update public.repair_orders set approved_payload=v,payload=v,approved_total=(v->>'total')::numeric,approval=j where repair_orders.id=repair_op.id;
    detail:=jsonb_build_object('authorization',j,'approved_payload',v,'purchase_id',po);
   elsif p_action='propose_extra' then
    if o.status in ('draft','pending','completed','cancelled') or o.proposed_payload is not null then raise exception 'No se puede agregar un adicional en este estado.';end if;
    if avh_repair_private.txt(p_data->>'reason',2000) is null then raise exception 'Indicá el motivo del adicional.';end if;
    v:=avh_repair_private.normalize(o.approved_payload||jsonb_build_object('source_total',null,'reviewed',true,'items',o.approved_payload->'items'||coalesce(p_data->'items','[]'::jsonb)),true);
    if jsonb_array_length(v->'items')<=jsonb_array_length(o.approved_payload->'items') then raise exception 'Agregá las partidas adicionales.';end if;
    if exists(select 1 from jsonb_array_elements(v->'assets') x where not exists(select 1 from public.repair_assets where order_id=repair_op.id and equipment_id=(x->>'id')::uuid)) then raise exception 'El adicional debe corresponder a las máquinas de esta reparación.';end if;
    update public.repair_orders set proposed_payload=v where repair_orders.id=repair_op.id;detail:=jsonb_build_object('reason',p_data->>'reason','proposed_payload',v);
   elsif p_action='reject_extra' then
    if o.proposed_payload is null then raise exception 'No hay adicional pendiente.';end if;
    if avh_repair_private.txt(p_data->>'reason',2000) is null then raise exception 'Indicá el motivo del rechazo.';end if;
    update public.repair_orders set proposed_payload=null where repair_orders.id=repair_op.id;
   elsif p_action in ('dispatch','receive','test') then
    if o.status in ('draft','pending','completed','cancelled') then raise exception 'La reparación debe estar autorizada y abierta.';end if;
    eid:=(p_data->>'equipment_id')::uuid;
    select * into c from public.repair_assets where order_id=repair_op.id and equipment_id=eid for update;
    if c.equipment_id is null then raise exception 'La máquina no pertenece a esta reparación.';end if;
    select * into a from public.equipment_assets where equipment_assets.id=eid for update;
    date_value:=(p_data->>'date')::date;
    if date_value is null or date_value>(now() at time zone 'America/Asuncion')::date then raise exception 'Indicá una fecha válida, hasta hoy.';end if;
    if p_action='dispatch' then
     if c.status not in ('awaiting','rework') then raise exception 'La máquina no está disponible para envío.';end if;
     if coalesce(p_data->>'mode','') not in ('workshop','onsite') or avh_repair_private.txt(p_data->>'condition',2000) is null or avh_repair_private.txt(p_data->>'accessories',2000) is null then raise exception 'Indicá lugar de reparación, estado y accesorios entregados.';end if;
     if p_data->>'mode'='workshop' and avh_repair_private.txt(p_data->>'carrier',180) is null then raise exception 'Identificá a quien transporta o retira la máquina.';end if;
     if c.receipt is not null and date_value<(c.receipt->>'date')::date then raise exception 'El nuevo envío no puede ser anterior al regreso.';end if;
     if nullif(p_data->>'expected_return','') is not null and (p_data->>'expected_return')::date<date_value then raise exception 'El regreso previsto no puede ser anterior al envío.';end if;
     reference:=o.number||'-'||a.code||'-'||(1+(select count(*) from public.repair_events where order_id=repair_op.id and equipment_id=eid and action='dispatch'))::text;
     j:=jsonb_build_object('date',date_value,'mode',p_data->>'mode','condition',avh_repair_private.txt(p_data->>'condition',2000),'accessories',avh_repair_private.txt(p_data->>'accessories',2000),'carrier',avh_repair_private.txt(p_data->>'carrier',180),'plate',avh_repair_private.txt(p_data->>'plate',60),'expected_return',nullif(p_data->>'expected_return','')::date,'reference',reference,'notes',avh_repair_private.txt(p_data->>'notes',2000),'recorded_by',auth.uid(),'recorded_at',now());
     update public.repair_assets set status='service',dispatch=j,receipt=null,test=null,warranty_until=null where order_id=repair_op.id and equipment_id=eid;
     update public.equipment_assets set status='in_repair',current_location=case when p_data->>'mode'='workshop' then o.approved_payload->'supplier'->>'name' else o.approved_payload->>'warehouse_name' end,version=version+1,updated_at=now(),updated_by=auth.uid() where equipment_assets.id=eid;
    elsif p_action='receive' then
     if c.status<>'service' then raise exception 'La máquina no tiene un envío abierto.';end if;
     if date_value<(c.dispatch->>'date')::date or avh_repair_private.txt(p_data->>'received_by',180) is null or avh_repair_private.txt(p_data->>'condition',2000) is null then raise exception 'Revisá la fecha de regreso, quién recibe y el estado recibido.';end if;
     if nullif(p_data->>'warranty_until','') is not null and ((p_data->>'warranty_until')::date<date_value or (p_data->>'warranty_until')::date>date_value+3650) then raise exception 'Revisá el vencimiento de garantía confirmado con el taller.';end if;
     j:=jsonb_build_object('date',date_value,'received_by',avh_repair_private.txt(p_data->>'received_by',180),'condition',avh_repair_private.txt(p_data->>'condition',2000),'warranty_until',nullif(p_data->>'warranty_until','')::date,'notes',avh_repair_private.txt(p_data->>'notes',2000),'recorded_by',auth.uid(),'recorded_at',now());
     update public.repair_assets set status='testing',receipt=j where order_id=repair_op.id and equipment_id=eid;
     update public.equipment_assets set status='testing',current_location=o.approved_payload->>'warehouse_name',version=version+1,updated_by=auth.uid(),updated_at=now() where equipment_assets.id=eid;
    else
     if c.status<>'testing' then raise exception 'Registrá primero la recepción de la máquina.';end if;
     if date_value<(c.receipt->>'date')::date or coalesce(p_data->>'result','') not in ('passed','failed') or avh_repair_private.txt(p_data->>'responsible',180) is null or avh_repair_private.txt(p_data->>'observations',2000) is null then raise exception 'Completá fecha, resultado, responsable técnico y prueba realizada.';end if;
     j:=jsonb_build_object('date',date_value,'result',p_data->>'result','responsible',avh_repair_private.txt(p_data->>'responsible',180),'observations',avh_repair_private.txt(p_data->>'observations',2000),'recorded_by',auth.uid(),'recorded_at',now());
     update public.repair_assets set status=case when p_data->>'result'='passed' then 'ready' else 'rework' end,test=j,warranty_until=case when p_data->>'result'='passed' then (c.receipt->>'warranty_until')::date end where order_id=repair_op.id and equipment_id=eid;
     update public.equipment_assets set status=case when p_data->>'result'='passed' then 'available' else 'needs_repair' end,version=version+1,updated_at=now(),updated_by=auth.uid() where equipment_assets.id=eid;
    end if;
    next_status:=case when exists(select 1 from public.repair_assets where order_id=repair_op.id and status in ('service','rework')) then 'in_service' when exists(select 1 from public.repair_assets where order_id=repair_op.id and status in ('testing','ready')) then 'testing' else 'approved' end;
    update public.repair_orders set status=next_status where repair_orders.id=repair_op.id;detail:=j;
   elsif p_action='close' then
    if o.status not in ('approved','in_service','testing') or o.proposed_payload is not null then raise exception 'Resolvé la reparación y sus adicionales antes de cerrar.';end if;
    if not exists(select 1 from public.repair_assets where order_id=repair_op.id) or exists(select 1 from public.repair_assets where order_id=repair_op.id and status<>'ready') then raise exception 'Todas las máquinas deben estar recibidas y con prueba conforme.';end if;
    v:=p_data->'invoice';precision:=case when o.currency='PYG' then 0 else 2 end;
    if avh_repair_private.txt(v->>'number',180) is null or nullif(v->>'date','') is null or v->>'currency' is distinct from o.currency then raise exception 'Completá número, fecha y moneda de la factura.';end if;
    date_value:=(v->>'date')::date;if date_value>(now() at time zone 'America/Asuncion')::date then raise exception 'La factura no puede tener fecha futura.';end if;
    total:=avh_repair_private.num(v->>'total');
    if total is null or total<>round(total,precision) or total>o.approved_total then raise exception 'La factura supera lo autorizado o tiene un importe inválido. Aprobá el adicional antes de cerrar.';end if;
    if jsonb_typeof(v->'allocations') is distinct from 'array' or jsonb_array_length(v->'allocations')<>(select count(*) from public.repair_assets where order_id=repair_op.id) or (select count(distinct x->>'equipment_id') from jsonb_array_elements(v->'allocations') x)<>jsonb_array_length(v->'allocations') then raise exception 'Distribuí la factura una vez por cada máquina.';end if;
    for j in select value from jsonb_array_elements(v->'allocations') loop
     cost:=avh_repair_private.num(j->>'amount');
     select * into c from public.repair_assets where order_id=repair_op.id and equipment_id=(j->>'equipment_id')::uuid;
     if c.equipment_id is null or cost is null or cost<>round(cost,precision) or cost>c.approved_amount then raise exception 'El costo de una máquina supera su importe autorizado.';end if;
     sum_cost:=sum_cost+cost;update public.repair_assets set actual_amount=cost where order_id=repair_op.id and equipment_id=c.equipment_id;
    end loop;
    if sum_cost<>total then raise exception 'La distribución por máquina no coincide con el total facturado.';end if;
    if exists(select 1 from public.repair_orders ro where ro.id<>repair_op.id and ro.supplier_id=o.supplier_id and lower(trim(ro.invoice->>'number'))=lower(trim(v->>'number'))) then raise exception 'Esa factura del taller ya está registrada en otra reparación. Revisá el comprobante antes de duplicar el costo.';end if;
    v:=jsonb_build_object('number',trim(v->>'number'),'date',date_value,'currency',o.currency,'total',total,'allocations',v->'allocations','recorded_by',auth.uid(),'recorded_at',now());
    -- Service acceptance is recorded here; the linked OC is invoiced without a stock receipt.
    po_ids:=array_prepend(o.purchase_id,o.additional_purchase_ids);
    foreach po in array po_ids loop
     if exists(select 1 from public.purchases where purchases.id=po and nullif(invoice_number,'') is not null and invoice_number<>v->>'number') then raise exception 'La OC ya tiene otra factura. Conciliá el comprobante en Compras antes de cerrar.';end if;
     perform public.admin_update_purchase(po,jsonb_build_object('status','invoiced','invoice_number',v->>'number','invoice_date',v->>'date'));
    end loop;
    update public.repair_orders set invoice=v,status='completed' where repair_orders.id=repair_op.id;detail:=v;
   elsif p_action='cancel' then
    if o.status not in ('draft','pending','approved') or exists(select 1 from public.repair_assets where order_id=repair_op.id and status<>'awaiting') then raise exception 'La reparación ya tiene entregas o recepción. Conservá su seguimiento y gestioná la resolución con Compras.';end if;
    if avh_repair_private.txt(p_data->>'reason',2000) is null then raise exception 'Indicá el motivo de anulación.';end if;
    if o.status='approved' then
     if avh_repair_private.txt(p_data->>'authorized_by',180) is null or avh_repair_private.txt(p_data->>'authorization_reference',500) is null or coalesce((p_data->>'authorization_received')::boolean,false) is not true then raise exception 'Registrá la autorización para dejar sin efecto esta reparación.';end if;
     po_ids:=array_prepend(o.purchase_id,o.additional_purchase_ids);
     if exists(select 1 from public.purchases where purchases.id=any(po_ids) and (nullif(invoice_number,'') is not null or status in ('invoiced','closed','received','partially_received'))) then raise exception 'La reparación ya tiene factura o conformidad registrada; conciliá su resolución en Compras.';end if;
     update public.repair_orders set status='cancelled',proposed_payload=null where repair_orders.id=repair_op.id;
     update public.repair_assets set status='cancelled' where order_id=repair_op.id;
     foreach po in array po_ids loop perform public.admin_update_purchase(po,jsonb_build_object('status','cancelled'));end loop;
    else update public.repair_orders set status='cancelled' where repair_orders.id=repair_op.id;end if;
   elsif p_action='attachment' then
    reference:=p_data->>'path';act:=p_data->>'kind';
    if act not in ('quote','invoice','dispatch','receipt','diagnosis','authorization') or reference not like repair_op.id::text||'/'||act||'/%' or reference like '%..%' or length(reference)>500 or not exists(select 1 from storage.objects where bucket_id='repair-documents' and name=reference) then raise exception 'Adjunto inexistente o ajeno a esta reparación.';end if;
    insert into public.repair_attachments(order_id,kind,file_path,file_name,uploaded_by) values(repair_op.id,act,reference,avh_repair_private.txt(p_data->>'file_name',180),auth.uid()) on conflict(file_path) do nothing;
   else raise exception 'Acción de reparación inválida.';
   end if;
   if p_action<>'attachment' then update public.repair_orders set version=version+1,updated_at=now() where repair_orders.id=repair_op.id;end if;
  end if;
  select jsonb_build_object('order_id',repair_orders.id,'number',number,'status',status,'version',version,'purchase_id',purchase_id) into result from public.repair_orders where repair_orders.id=repair_op.id;
 end if;
 insert into public.repair_events(order_id,equipment_id,actor_id,actor_name,action,detail) values(repair_op.id,eid,auth.uid(),coalesce((select nullif(full_name,'') from public.profiles where profiles.id=auth.uid()),'Administración'),p_action,detail);
 insert into public.audit_events(entity_type,entity_id,action,actor_id,warehouse_id,detail) values(case when p_action='asset_save' then 'equipment' else 'repair' end,coalesce(repair_op.id,eid),'repair_'||p_action,auth.uid(),coalesce((select warehouse_id from public.repair_orders where repair_orders.id=repair_op.id),(select warehouse_id from public.equipment_assets where equipment_assets.id=eid)),jsonb_build_object('number',result->>'number','equipment_id',eid));
 update avh_repair_private.requests set result=repair_op.result where requests.id=p_request_id;
 return result;
end $$;


-- A linked service OC must preserve the authorized scope, including edits attempted through Compras.
create function avh_repair_private.guard_purchase() returns trigger language plpgsql security definer set search_path='' as $$
declare pid uuid;linked public.repair_orders;
begin
 if tg_table_name='purchase_items' then pid:=(coalesce(to_jsonb(new),to_jsonb(old))->>'purchase_id')::uuid;else pid:=(coalesce(to_jsonb(new),to_jsonb(old))->>'id')::uuid;end if;
 select * into linked from public.repair_orders where purchase_id=pid or additional_purchase_ids @> array[pid] limit 1;
 if linked.id is not null then
  if tg_table_name='purchase_items' or tg_op='DELETE' then raise exception 'Esta OC corresponde a una reparación autorizada. Gestioná los adicionales desde Reparaciones.';end if;
  if (to_jsonb(new)-array['invoice_number','invoice_date','status','notes','updated_at']) is distinct from (to_jsonb(old)-array['invoice_number','invoice_date','status','notes','updated_at']) or (new.status='cancelled' and linked.status<>'cancelled') or (new.status='closed' and linked.status<>'completed') then raise exception 'Conservá el alcance autorizado de la reparación. Revisá sus adicionales o su conformidad técnica.';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
create trigger trg_repair_po_items_guard before insert or update or delete on public.purchase_items for each row execute function avh_repair_private.guard_purchase();
create trigger trg_repair_po_guard before update or delete on public.purchases for each row execute function avh_repair_private.guard_purchase();

create function avh_repair_private.document(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v jsonb;begin
 perform avh_repair_private.require_admin();
 select to_jsonb(o)||jsonb_build_object('assets',coalesce((select jsonb_agg(to_jsonb(c) order by c.equipment_id) from public.repair_assets c where c.order_id=o.id),'[]'::jsonb),'attachments',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at,a.id) from public.repair_attachments a where a.order_id=o.id),'[]'::jsonb),'events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at,e.id) from public.repair_events e where e.order_id=o.id),'[]'::jsonb)) into v from public.repair_orders o where o.id=p_id;
 if v is null then raise exception 'Reparación inexistente.';end if;return v;
end $$;
create function avh_repair_private.asset_history(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform avh_repair_private.require_admin();
 if not exists(select 1 from public.equipment_assets where id=p_id) then raise exception 'Máquina inexistente.';end if;
 return jsonb_build_object('asset',(select to_jsonb(a) from public.equipment_assets a where id=p_id),'repairs',coalesce((select jsonb_agg(jsonb_build_object('order_id',o.id,'number',o.number,'status',o.status,'currency',o.currency,'supplier',o.approved_payload->'supplier','created_at',o.created_at,'approved_amount',c.approved_amount,'actual_amount',c.actual_amount,'warranty_until',c.warranty_until,'custody_status',c.status) order by o.created_at desc,o.id) from public.repair_assets c join public.repair_orders o on o.id=c.order_id where c.equipment_id=p_id),'[]'::jsonb));
end $$;
create function public.repair_command(p_action text,p_data jsonb,p_request_id uuid) returns jsonb language sql security invoker set search_path='' as $$select avh_repair_private.command(p_action,p_data,p_request_id)$$;
create function public.repair_document(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select avh_repair_private.document(p_id)$$;
create function public.repair_asset_history(p_id uuid) returns jsonb language sql stable security invoker set search_path='' as $$select avh_repair_private.asset_history(p_id)$$;
revoke all on all tables in schema avh_repair_private from public,anon,authenticated;
revoke all on all sequences in schema avh_repair_private from public,anon,authenticated;
revoke execute on all functions in schema avh_repair_private from public,anon,authenticated;
grant execute on function avh_repair_private.command(text,jsonb,uuid),avh_repair_private.document(uuid),avh_repair_private.asset_history(uuid) to authenticated;
revoke execute on function public.repair_command(text,jsonb,uuid),public.repair_document(uuid),public.repair_asset_history(uuid) from public,anon;
grant execute on function public.repair_command(text,jsonb,uuid),public.repair_document(uuid),public.repair_asset_history(uuid) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('repair-documents','repair-documents',false,12582912,array['application/pdf','image/png','image/jpeg','image/webp','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','text/csv','text/tab-separated-values','application/octet-stream']);
create policy repair_documents_read on storage.objects for select to authenticated using(bucket_id='repair-documents' and (select public.current_profile_role())='admin');
create policy repair_documents_insert on storage.objects for insert to authenticated with check(bucket_id='repair-documents' and (select public.current_profile_role())='admin' and exists(select 1 from public.repair_orders where id::text=split_part(name,'/',1)) and split_part(name,'/',2) in ('quote','invoice','dispatch','receipt','diagnosis','authorization'));
notify pgrst,'reload schema';
commit;
