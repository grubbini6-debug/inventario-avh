-- Production prepares quotes. Purchase orders are exclusively administered by Administration.
begin;
create schema avh_commercial_private;
revoke all on schema avh_commercial_private from public,anon;
grant usage on schema avh_commercial_private to authenticated;
create table avh_commercial_private.quote_counters(year integer primary key,last_number integer not null);
alter table avh_commercial_private.quote_counters enable row level security;
create table public.commercial_documents(
 id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('quote','purchase_order')),
 number text unique,status text not null default 'draft' check(status in ('draft','submitted','issued','cancelled')),
 payload jsonb not null,issued_payload jsonb,work_order_id uuid references public.work_orders(id),
 purchase_id uuid unique references public.purchases(id),version integer not null default 1,
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),issued_at timestamptz,issued_by uuid references public.profiles(id),
 review_note text,check(jsonb_typeof(payload)='object'),check((number is null)=(issued_payload is null))
);
create index commercial_documents_owner_date_idx on public.commercial_documents(created_by,created_at desc,id);
create index commercial_documents_status_date_idx on public.commercial_documents(status,created_at desc,id);
create index commercial_documents_work_order_idx on public.commercial_documents(work_order_id);
create table public.commercial_document_events(
 id uuid primary key default gen_random_uuid(),document_id uuid not null references public.commercial_documents(id),
 actor_id uuid not null references public.profiles(id),action text not null,request_id uuid not null,
 request_data jsonb not null,result jsonb not null,created_at timestamptz not null default now(),unique(actor_id,request_id)
);
create index commercial_document_events_doc_date_idx on public.commercial_document_events(document_id,created_at desc);
create function avh_commercial_private.role()
returns text language sql stable security definer set search_path='' as $$
 select case when p.role='admin' then 'admin' when p.role='production' and a.access_level='editor' then 'editor' end
 from public.profiles p left join public.work_order_access a on a.user_id=p.id where p.id=(select auth.uid()) and p.active
$$;
create function avh_commercial_private.company()
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',id,'name',name,'legal_name',legal_name,'tax_id',tax_id,'address',address,'phone',phone,'email',email)
 from public.purchase_companies where active and (name ilike '%Villa Hayes%' or legal_name ilike '%Villa Hayes%' or name='AVH') order by legal_name nulls last,name limit 1
$$;
create function avh_commercial_private.context()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or avh_commercial_private.role() is null then raise exception 'No autorizado para documentos comerciales.';end if;
 return jsonb_build_object('access_level',avh_commercial_private.role(),'company',avh_commercial_private.company(),
 'suppliers',case when avh_commercial_private.role()='admin' then coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'tax_id',tax_id,'phone',phone) order by name) from public.suppliers),'[]'::jsonb) else '[]'::jsonb end);
end $$;
create function public.commercial_context()
returns jsonb language sql stable security invoker set search_path='' as $$select avh_commercial_private.context()$$;
alter table public.commercial_documents enable row level security;
alter table public.commercial_document_events enable row level security;
revoke all on public.commercial_documents,public.commercial_document_events from public,anon,authenticated;
grant select on public.commercial_documents,public.commercial_document_events to authenticated;
create policy commercial_read on public.commercial_documents for select to authenticated
 using ((select avh_commercial_private.role())='admin' or ((select avh_commercial_private.role())='editor' and kind='quote' and created_by=(select auth.uid())));
create policy commercial_event_read on public.commercial_document_events for select to authenticated
 using(exists(select 1 from public.commercial_documents d where d.id=document_id));
create function avh_commercial_private.normalize(p jsonb,p_kind text,p_complete boolean default false)
returns jsonb language plpgsql set search_path='' as $$
declare v jsonb:='{}';k text;i jsonb;items jsonb:='[]';q numeric;price numeric;amount numeric;subtotal numeric:=0;raw_total numeric:=0;adjustment numeric:=0;
 tax numeric:=0;rate numeric;scale integer;s public.suppliers;c jsonb;line_no integer:=0;
begin
 if jsonb_typeof(p) is distinct from 'object' or length(p::text)>1500000 or p_kind not in ('quote','purchase_order') then raise exception 'Documento inválido.';end if;
 foreach k in array array['title','document_date','valid_until','delivery_date','recipient_name','recipient_tax_id','recipient_address','recipient_contact','location','reference','payment_terms','delivery_terms','notes','introduction','issuer_name','currency','tax_mode'] loop
  if length(coalesce(p->>k,''))>(case when k in ('notes','introduction') then 4000 else 500 end) then raise exception 'Campo demasiado extenso: %.',k;end if;
  v:=v||jsonb_build_object(k,trim(coalesce(p->>k,'')));
 end loop;
 if v->>'title'='' then raise exception 'Indicá el título del documento.';end if;
 if coalesce(v->>'currency','') not in ('PYG','USD') then raise exception 'Moneda inválida.';end if;
 if coalesce(v->>'tax_mode','') not in ('included','add','none') then raise exception 'Indicá el tratamiento del IVA.';end if;
 if v->>'document_date'='' then raise exception 'Indicá la fecha del documento.';end if;
 if extract(year from (v->>'document_date')::date) not between 2000 and 2100 then raise exception 'Fecha de documento inválida.';end if;
 foreach k in array array['valid_until','delivery_date'] loop
  if v->>k<>'' then perform (v->>k)::date;end if;
 end loop;
 if v->>'valid_until'<>'' and (v->>'valid_until')::date<(v->>'document_date')::date then raise exception 'La vigencia no puede terminar antes de la fecha del presupuesto.';end if;
 rate:=coalesce(nullif(p->>'tax_rate','')::numeric,0);
 if rate<0 or rate>100 or rate='NaN'::numeric or rate<>round(rate,6) then raise exception 'Porcentaje de IVA inválido.';end if;
 if v->>'tax_mode'='none' then rate:=0;end if;
 v:=v||jsonb_build_object('tax_rate',rate);
 if nullif(p->>'supplier_id','') is not null then
  select * into s from public.suppliers where id=(p->>'supplier_id')::uuid;
  if s.id is null then raise exception 'Proveedor inexistente.';end if;
  v:=v||jsonb_build_object('supplier_id',s.id);
 else v:=v||jsonb_build_object('supplier_id',null);end if;
 if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') not between 1 and 300 then raise exception 'Agregá entre 1 y 300 ítems.';end if;
 if (select count(*) from jsonb_array_elements(p->'items'))<>(select count(distinct x->>'id') from jsonb_array_elements(p->'items') x) then raise exception 'Ítems duplicados.';end if;
 scale:=case when v->>'currency'='PYG' then 0 else 2 end;
 for i in select value from jsonb_array_elements(p->'items') loop
  line_no:=line_no+1;
  if coalesce(length(i->>'id'),0) not between 1 and 100 or coalesce(length(trim(i->>'description')),0) not between 1 and 4000 or coalesce(length(trim(i->>'unit')),0) not between 1 and 50 then raise exception 'Revisá descripción y unidad del ítem %.',line_no;end if;
  if i->'quantity' is not null and i->'quantity'<>'null'::jsonb and jsonb_typeof(i->'quantity')<>'number' then raise exception 'Cantidad inválida en el ítem %.',line_no;end if;
  if i->'unit_price' is not null and i->'unit_price'<>'null'::jsonb and jsonb_typeof(i->'unit_price')<>'number' then raise exception 'Precio inválido en el ítem %.',line_no;end if;
  q:=nullif(i->>'quantity','')::numeric;price:=nullif(i->>'unit_price','')::numeric;
  if q is not null and (q<=0 or q>1000000 or q='NaN'::numeric or q<>round(q,6)) then raise exception 'Cantidad inválida en el ítem % (hasta 6 decimales).',line_no;end if;
  if price is not null and (price<0 or price>1000000000 or price='NaN'::numeric or price<>round(price,6)) then raise exception 'Precio inválido en el ítem % (hasta 6 decimales).',line_no;end if;
  if p_complete and (q is null or price is null) then raise exception 'Completá cantidad y precio del ítem % antes de emitir o solicitar autorización.',line_no;end if;
  amount:=round(q*price,scale);subtotal:=subtotal+coalesce(amount,0);raw_total:=raw_total+coalesce(q*price,0);
  items:=items||jsonb_build_array(jsonb_build_object('id',i->>'id','description',trim(i->>'description'),'unit',trim(i->>'unit'),'quantity',q,'unit_price',price,'amount',amount));
 end loop;
 adjustment:=round(raw_total,scale)-subtotal;
 if subtotal>1000000000000 then raise exception 'El importe supera el límite permitido.';end if;
 tax:=case when v->>'tax_mode'='add' then round((subtotal+adjustment)*rate/100,scale) when v->>'tax_mode'='included' then round((subtotal+adjustment)*rate/(100+rate),scale) else 0 end;
 v:=v||jsonb_build_object('items',items,'subtotal',subtotal,'tax_amount',tax,'rounding_adjustment',adjustment,'total',subtotal+adjustment+case when v->>'tax_mode'='add' then tax else 0 end);
 if p_complete then
  if v->>'recipient_name'='' or v->>'issuer_name'='' or v->>'payment_terms'='' or v->>'delivery_terms'='' then raise exception 'Completá destinatario, responsable, pago y entrega.';end if;
  if v->>'tax_mode'<>'none' and rate=0 then raise exception 'Indicá el porcentaje de IVA o seleccioná Sin IVA.';end if;
  if p_kind='quote' and v->>'valid_until'='' then raise exception 'Indicá la vigencia del presupuesto.';end if;
  if p_kind='purchase_order' and s.id is null then raise exception 'Vinculá un proveedor del catálogo. Administración puede registrarlo en Proveedores.';end if;
  if p_kind='purchase_order' and v->>'recipient_name' is distinct from s.name then raise exception 'El proveedor debe coincidir con el catálogo.';end if;
  c:=avh_commercial_private.company();
  if c is null or coalesce(c->>'legal_name','')='' or coalesce(c->>'tax_id','')='' then raise exception 'Administración debe completar la empresa emisora y su RUC.';end if;
  v:=v||jsonb_build_object('company',c);
 end if;
 return v;
end $$;
create function avh_commercial_private.document(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d public.commercial_documents;r text:=avh_commercial_private.role();result jsonb;
begin
 if auth.uid() is null or r is null then raise exception 'No autorizado.';end if;
 select * into d from public.commercial_documents where id=p_id;
 if d.id is null or (r<>'admin' and (d.created_by<>auth.uid() or d.kind<>'quote')) then raise exception 'Documento inexistente o sin acceso.';end if;
 result:=to_jsonb(d)||jsonb_build_object('company',avh_commercial_private.company(),'purchase_status',(select status from public.purchases where id=d.purchase_id));
 return result;
end $$;
create function public.commercial_document(p_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$select avh_commercial_private.document(p_id)$$;
create function avh_commercial_private.command(p_action text,p_data jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r text:=avh_commercial_private.role();d public.commercial_documents;prev public.commercial_document_events;
 v_id uuid;v jsonb;result jsonb;v_year integer;v_no integer;purchase uuid;v_number text;items jsonb;
begin
 if auth.uid() is null or r is null then raise exception 'No autorizado para documentos comerciales.';end if;
 if p_request_id is null or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Solicitud inválida.';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into prev from public.commercial_document_events where actor_id=auth.uid() and request_id=p_request_id;
 if found then
  if prev.action<>p_action or prev.request_data<>p_data then raise exception 'Solicitud reutilizada con datos distintos.';end if;return prev.result;
 end if;
 v_id:=(p_data->>'document_id')::uuid;if v_id is null then raise exception 'Falta identificador.';end if;
 select * into d from public.commercial_documents where id=v_id for update;
 if d.id is not null and r<>'admin' and (d.created_by<>auth.uid() or d.kind<>'quote') then raise exception 'Documento inexistente o sin acceso.';end if;
 if d.id is not null and d.version is distinct from (p_data->>'expected_version')::integer then raise exception 'El documento cambió. Volvé a abrirlo.';end if;
 if p_action='save' then
  if p_data->>'kind'='purchase_order' and r<>'admin' then raise exception 'Solo Administración puede crear órdenes de compra.';end if;
  if d.id is not null and d.status<>'draft' then raise exception 'Solo se puede editar un borrador.';end if;
  if d.id is not null and d.kind is distinct from p_data->>'kind' then raise exception 'El tipo de documento no puede cambiar.';end if;
  v:=avh_commercial_private.normalize(p_data->'payload',p_data->>'kind',false);
  if nullif(p_data->>'work_order_id','') is not null and not exists(select 1 from public.work_orders where id=(p_data->>'work_order_id')::uuid) then raise exception 'Orden de trabajo inexistente.';end if;
  if d.id is null then
   insert into public.commercial_documents(id,kind,payload,work_order_id,created_by) values(v_id,p_data->>'kind',v,nullif(p_data->>'work_order_id','')::uuid,auth.uid());
  else update public.commercial_documents set payload=v,work_order_id=nullif(p_data->>'work_order_id','')::uuid,version=version+1,updated_at=now(),review_note=null where id=v_id;end if;
 else
  if d.id is null then raise exception 'Documento inexistente.';end if;
  if p_action='submit' then
   if d.kind<>'purchase_order' or d.status<>'draft' then raise exception 'La OC no se puede solicitar en este estado.';end if;
   v:=avh_commercial_private.normalize(d.payload,d.kind,true);
   update public.commercial_documents set payload=v,status='submitted',version=version+1,updated_at=now() where id=v_id;
  elsif p_action='issue' then
   if d.kind='purchase_order' and r<>'admin' then raise exception 'Administración debe autorizar la OC.';end if;
   if (d.kind='quote' and d.status<>'draft') or (d.kind='purchase_order' and d.status not in ('draft','submitted')) then raise exception 'El documento no se puede emitir en este estado.';end if;
   v:=avh_commercial_private.normalize(d.payload,d.kind,true);
   if d.kind='quote' then
    v_year:=extract(year from (v->>'document_date')::date);
    insert into avh_commercial_private.quote_counters values(v_year,1) on conflict(year) do update set last_number=avh_commercial_private.quote_counters.last_number+1 returning last_number into v_no;
    v_number:='PRE-AVH-'||v_year||'-'||lpad(v_no::text,5,'0');
   else
    select jsonb_agg(jsonb_build_object('description',i->>'description','quantity',i->'quantity','unit',i->>'unit','unit_price',i->'unit_price','affects_inventory',false,'factor_to_base',1) order by ord)
     into items from jsonb_array_elements(v->'items') with ordinality a(i,ord);
    if v->>'tax_mode'='add' and (v->>'tax_amount')::numeric>0 then
     items:=items||jsonb_build_array(jsonb_build_object('description','IVA '||(v->>'tax_rate')||'%','quantity',1,'unit','servicio','unit_price',v->'tax_amount','affects_inventory',false,'factor_to_base',1));
    end if;
    purchase:=public.admin_create_purchase(jsonb_build_object('company_id',v->'company'->>'id','supplier_id',v->>'supplier_id','status','quoted','purchase_type','other','destination_type','direct','destination_text',v->>'location','currency',v->>'currency','requester',v->>'issuer_name','payment_terms',v->>'payment_terms','order_reference',v->>'reference','expected_date',nullif(v->>'delivery_date',''),'notes','Preparada desde Documentos de Producción. '||coalesce(v->>'notes','')||E'\nEntrega: '||(v->>'delivery_terms'),'delivery_mode','single'),items);
    v_number:=public.admin_prepare_purchase_order(purchase);
   end if;
   update public.commercial_documents set payload=v,issued_payload=v,number=v_number,status='issued',purchase_id=purchase,issued_at=now(),issued_by=auth.uid(),version=version+1,updated_at=now() where id=v_id;
  elsif p_action='return' then
   if r<>'admin' or d.status<>'submitted' or coalesce(length(trim(p_data->>'reason')),0) not between 5 and 2000 then raise exception 'Indicá el motivo para devolver la OC a revisión.';end if;
   update public.commercial_documents set status='draft',review_note=trim(p_data->>'reason'),version=version+1,updated_at=now() where id=v_id;
  elsif p_action='cancel' then
   if d.status='cancelled' or (d.kind='purchase_order' and d.status='issued') then raise exception 'La OC emitida se gestiona desde Compras.';end if;
   if coalesce(length(trim(p_data->>'reason')),0) not between 5 and 2000 then raise exception 'Indicá el motivo de anulación.';end if;
   update public.commercial_documents set status='cancelled',review_note=trim(p_data->>'reason'),version=version+1,updated_at=now() where id=v_id;
  else raise exception 'Acción no reconocida.';end if;
 end if;
 select jsonb_build_object('id',id,'number',cd.number,'status',status,'version',version,'purchase_id',purchase_id) into result from public.commercial_documents cd where id=v_id;
 insert into public.commercial_document_events(document_id,actor_id,action,request_id,request_data,result) values(v_id,auth.uid(),p_action,p_request_id,p_data,result);
 insert into public.audit_events(entity_type,entity_id,action,actor_id,detail) values('commercial_document',v_id,'COMMERCIAL_'||upper(p_action),auth.uid(),jsonb_build_object('result',result,'request_id',p_request_id));
 return result;
end $$;
create function public.commercial_command(p_action text,p_data jsonb,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select avh_commercial_private.command(p_action,p_data,p_request_id)$$;
revoke all on all tables in schema avh_commercial_private from public,anon,authenticated;
revoke all on all functions in schema avh_commercial_private from public,anon,authenticated;
grant execute on function avh_commercial_private.role(),avh_commercial_private.context(),avh_commercial_private.document(uuid),avh_commercial_private.command(text,jsonb,uuid) to authenticated;
revoke all on function public.commercial_context(),public.commercial_document(uuid),public.commercial_command(text,jsonb,uuid) from public,anon;
grant execute on function public.commercial_context(),public.commercial_document(uuid),public.commercial_command(text,jsonb,uuid) to authenticated;
create function avh_work_order_private.brand()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or avh_work_order_private.role() is null then raise exception 'No autorizado.';end if;
 return avh_commercial_private.company();
end $$;
create function public.work_order_brand()
returns jsonb language sql stable security invoker set search_path='' as $$select avh_work_order_private.brand()$$;
revoke all on function avh_work_order_private.brand(),public.work_order_brand() from public,anon;
grant execute on function avh_work_order_private.brand(),public.work_order_brand() to authenticated;
commit;
