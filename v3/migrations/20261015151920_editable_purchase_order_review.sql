-- Administration reviews every printed OC field; financial edits use the existing receipt guards.
begin;
alter table public.purchases add column po_document jsonb;
alter table public.purchases add column po_document_revision integer not null default 0;

create function avh_commercial_private.review_company(p jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare c public.purchase_companies;v jsonb;k text;
begin
 select * into c from public.purchase_companies where id=nullif(p->>'id','')::uuid and active;
 if c.id is null then raise exception 'Elegí una empresa emisora activa.';end if;
 v:=jsonb_build_object('id',c.id,'name',c.name,'brand_avh',c.name='AVH' or coalesce(c.legal_name,c.name) ilike '%Villa Hayes%');
 foreach k in array array['legal_name','tax_id','address','phone','email'] loop
  if length(coalesce(p->>k,''))>500 then raise exception 'Campo de empresa demasiado extenso: %.',k;end if;
  v:=v||jsonb_build_object(k,trim(coalesce(p->>k,'')));
 end loop;
 if v->>'legal_name'='' or v->>'tax_id'='' then raise exception 'Completá razón social y RUC de la empresa emisora.';end if;
 return v;
end $$;

create or replace function avh_commercial_private.context()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or avh_commercial_private.role() is null then raise exception 'No autorizado para documentos comerciales.';end if;
 return jsonb_build_object('access_level',avh_commercial_private.role(),'company',avh_commercial_private.company(),
 'companies',case when avh_commercial_private.role()='admin' then coalesce((select jsonb_agg(to_jsonb(c) order by c.name) from public.purchase_companies c where active),'[]'::jsonb) else '[]'::jsonb end,
 'suppliers',case when avh_commercial_private.role()='admin' then coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'tax_id',tax_id,'phone',phone) order by name) from public.suppliers),'[]'::jsonb) else '[]'::jsonb end);
end $$;

create or replace function avh_commercial_private.normalize(p jsonb,p_kind text,p_complete boolean default false)
returns jsonb language plpgsql set search_path='' as $$
declare v jsonb:='{}';k text;i jsonb;items jsonb:='[]';q numeric;price numeric;amount numeric;subtotal numeric:=0;raw_total numeric:=0;adjustment numeric:=0;
 tax numeric:=0;rate numeric;scale integer;s public.suppliers;c jsonb;line_no integer:=0;
begin
 if jsonb_typeof(p) is distinct from 'object' or length(p::text)>1500000 or p_kind not in ('quote','purchase_order') then raise exception 'Documento inválido.';end if;
 foreach k in array array['title','document_number','document_date','valid_until','delivery_date','recipient_name','recipient_tax_id','recipient_address','recipient_contact','location','reference','payment_terms','delivery_terms','notes','introduction','issuer_name','currency','tax_mode'] loop
  if length(coalesce(p->>k,''))>(case when k in ('notes','introduction') then 4000 else 500 end) then raise exception 'Campo demasiado extenso: %.',k;end if;
  v:=v||jsonb_build_object(k,trim(coalesce(p->>k,'')));
 end loop;
 if v->>'title'='' then raise exception 'Indicá el título del documento.';end if;
 if coalesce(v->>'currency','') not in ('PYG','USD') then raise exception 'Moneda inválida.';end if;
 if coalesce(v->>'tax_mode','') not in ('included','add','none') and not(p_kind='purchase_order' and v->>'tax_mode'='unspecified') then raise exception 'Indicá el tratamiento del IVA.';end if;
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
 if p_kind='purchase_order' and avh_commercial_private.role()='admin' then
  if v->>'document_number'<>'' and v->>'document_number'!~'^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$' then raise exception 'Número de OC inválido: usá letras, números, puntos o guiones.';end if;
  v:=v||jsonb_build_object('company',avh_commercial_private.review_company(coalesce(p->'company',avh_commercial_private.company())));
 end if;
 if p_complete then
  if v->>'recipient_name'='' or v->>'issuer_name'='' or v->>'payment_terms'='' or v->>'delivery_terms'='' then raise exception 'Completá destinatario, responsable, pago y entrega.';end if;
  if v->>'tax_mode' in ('included','add') and rate=0 then raise exception 'Indicá el porcentaje de IVA o seleccioná Sin IVA.';end if;
  if p_kind='quote' and v->>'valid_until'='' then raise exception 'Indicá la vigencia del presupuesto.';end if;
  if p_kind='purchase_order' and s.id is null then raise exception 'Vinculá un proveedor del catálogo. Administración puede registrarlo en Proveedores.';end if;
  c:=coalesce(v->'company',avh_commercial_private.company());
  if c is null or coalesce(c->>'legal_name','')='' or coalesce(c->>'tax_id','')='' then raise exception 'Administración debe completar la empresa emisora y su RUC.';end if;
  v:=v||jsonb_build_object('company',c);
 end if;
 return v;
end $$;

create or replace function avh_commercial_private.command(p_action text,p_data jsonb,p_request_id uuid)
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
    purchase:=public.admin_create_purchase(jsonb_build_object('company_id',v->'company'->>'id','supplier_id',v->>'supplier_id','status','quoted','purchase_type','other','destination_type','direct','destination_text',v->>'location','currency',v->>'currency','requester',v->>'issuer_name','payment_terms',v->>'payment_terms','order_reference',v->>'reference','expected_date',nullif(v->>'delivery_date',''),'notes',v->>'notes','delivery_mode','single'),items);
    v_number:=public.admin_prepare_purchase_order(purchase);
    if coalesce(v->>'document_number','')<>'' then
     v_number:=v->>'document_number';
     if exists(select 1 from public.purchases where po_number=v_number and id<>purchase) then raise exception 'Ese número de OC ya está utilizado.';end if;
     update public.purchases set po_number=v_number where id=purchase;
    end if;
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


create function avh_commercial_private.purchase_document(p_purchase_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p public.purchases;c jsonb;s public.suppliers;snapshot jsonb;base jsonb;v jsonb;rows jsonb;tax_id uuid;fingerprint text;dest text;
begin
 if auth.uid() is null or avh_commercial_private.role() is distinct from 'admin' then raise exception 'Solo Administración puede editar o descargar órdenes de compra.';end if;
 select * into p from public.purchases where id=p_purchase_id;
 if p.id is null or p.po_number is null then raise exception 'Orden de compra inexistente.';end if;
 select to_jsonb(x) into c from public.purchase_companies x where id=p.company_id;
 select * into s from public.suppliers where id=p.supplier_id;
 select issued_payload into snapshot from public.commercial_documents where purchase_id=p.id;
 base:=coalesce(p.po_document,snapshot,'{}'::jsonb);
 tax_id:=nullif(base->>'_tax_item_id','')::uuid;
 if tax_id is null and base->>'tax_mode'='add' and coalesce((base->>'tax_amount')::numeric,0)>0 then
  select id into tax_id from public.purchase_items where purchase_id=p.id and description='IVA '||(base->>'tax_rate')||'%' and unit_price=(base->>'tax_amount')::numeric and quantity=1 and not affects_inventory order by created_at desc,id desc limit 1;
 end if;
 select coalesce(jsonb_agg(to_jsonb(i) order by i.created_at,i.id),'[]'::jsonb) into rows from public.purchase_items i where purchase_id=p.id and i.id is distinct from tax_id;
 dest:=case when p.destination_type='warehouse' then (select name from public.warehouses where id=p.warehouse_id) when p.destination_type='barge' then 'Barcaza '||(select number::text from public.barges where id=p.barge_id) else p.destination_text end;
 v:=jsonb_build_object('title','Orden de compra - '||coalesce(p.order_reference,s.name,''),'document_date',coalesce(p.po_generated_at,p.created_at)::date,'valid_until','','delivery_date',coalesce(p.expected_date::text,''),
  'recipient_name',coalesce(s.name,''),'recipient_tax_id',coalesce(s.tax_id,''),'recipient_contact',coalesce(s.phone,''),'recipient_address','','location',coalesce(dest,''),'reference',coalesce(p.order_reference,''),
  'issuer_name',coalesce(p.requester,(select coalesce(full_name,username) from public.profiles where id=auth.uid()),''),'payment_terms',coalesce(p.payment_terms,'Según presupuesto de referencia'),
  'delivery_terms',case when p.delivery_mode='partial' then 'Entregas parciales / liberaciones' else 'Entrega única' end,'introduction','','notes',coalesce(p.notes,''),'tax_mode','unspecified','tax_rate',0)||base;
 if v->'company'->>'id' is distinct from p.company_id::text then v:=v||jsonb_build_object('company',c);end if;
 if base->>'supplier_id' is not null and base->>'supplier_id' is distinct from p.supplier_id::text then
  v:=v||jsonb_build_object('recipient_name',coalesce(s.name,''),'recipient_tax_id',coalesce(s.tax_id,''),'recipient_contact',coalesce(s.phone,''),'recipient_address','');
 end if;
 v:=v||jsonb_build_object('items',rows,'currency',p.currency,'supplier_id',p.supplier_id,'document_number',p.po_number,
  'payment_terms',coalesce(p.payment_terms,''),'reference',coalesce(p.order_reference,''),'delivery_date',coalesce(p.expected_date::text,''),'issuer_name',coalesce(p.requester,v->>'issuer_name'),'notes',coalesce(p.notes,''));
 if v->>'payment_terms'='' then v:=jsonb_set(v,'{payment_terms}','"Según presupuesto de referencia"');end if;
 v:=avh_commercial_private.normalize(v,'purchase_order',false);
 select jsonb_agg(i||jsonb_build_object('amount',(select n->'amount' from jsonb_array_elements(v->'items') n where n->>'id'=i->>'id')) order by ord) into rows from jsonb_array_elements(rows) with ordinality a(i,ord);
 v:=v||jsonb_build_object('items',rows,'_tax_item_id',tax_id);
 fingerprint:=md5(to_jsonb(p)::text||rows::text||coalesce(tax_id::text,'')||coalesce(snapshot::text,'')||coalesce(c::text,'')||coalesce(to_jsonb(s)::text,''));
 return jsonb_build_object('id',p.id,'purchase_id',p.id,'purchase_editor',true,'kind','purchase_order','status',case when p.status in ('closed','cancelled') then p.status else 'draft' end,
  'purchase_status',p.status,'number',p.po_number,'version',fingerprint,'revision',p.po_document_revision,'payload',v);
end $$;
create function public.admin_purchase_order_document(p_purchase_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$select avh_commercial_private.purchase_document(p_purchase_id)$$;

create function avh_commercial_private.save_purchase_document(p_purchase_id uuid,p_payload jsonb,p_expected_version text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.purchases;before_doc jsonb;after_doc jsonb;previous jsonb;v jsonb;patch jsonb;i jsonb;meta jsonb;old public.purchase_items;
 item_id uuid;product_id uuid;factor numeric;stock boolean;tax_id uuid;old_tax uuid;result jsonb;request_data jsonb;ids uuid[]:='{}';
begin
 if auth.uid() is null or avh_commercial_private.role() is distinct from 'admin' then raise exception 'Solo Administración puede modificar órdenes de compra.';end if;
 if p_request_id is null then raise exception 'Solicitud inválida.';end if;
 request_data:=jsonb_build_object('purchase_id',p_purchase_id,'payload',p_payload,'expected_version',p_expected_version);
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||p_request_id::text,0));
 select detail into previous from public.audit_events where actor_id=auth.uid() and action='purchase_order_review_saved' and detail->>'request_id'=p_request_id::text limit 1;
 if previous is not null then
  if previous->'request_data' is distinct from request_data then raise exception 'Solicitud reutilizada con datos distintos.';end if;
  return avh_commercial_private.purchase_document(p_purchase_id);
 end if;
 select * into p from public.purchases where id=p_purchase_id for update;
 before_doc:=avh_commercial_private.purchase_document(p_purchase_id);
 if before_doc->>'version' is distinct from p_expected_version then raise exception 'La OC cambió. Volvé a abrirla antes de guardar.';end if;
 if p.status in ('closed','cancelled') then raise exception 'Esta OC está cerrada o anulada.';end if;
 v:=avh_commercial_private.normalize(p_payload,'purchase_order',true);
 if v->>'document_number'='' then v:=jsonb_set(v,'{document_number}',to_jsonb(p.po_number));end if;
 if exists(select 1 from public.purchases where po_number=v->>'document_number' and id<>p.id) then raise exception 'Ese número de OC ya está utilizado.';end if;
 patch:=jsonb_build_object('requester',v->>'issuer_name','payment_terms',v->>'payment_terms','expected_date',v->>'delivery_date','order_reference',v->>'reference','notes',v->>'notes');
 if p.company_id::text is distinct from v->'company'->>'id' then patch:=patch||jsonb_build_object('company_id',v->'company'->>'id');end if;
 if p.supplier_id::text is distinct from v->>'supplier_id' then patch:=patch||jsonb_build_object('supplier_id',v->>'supplier_id');end if;
 if p.currency is distinct from v->>'currency' then patch:=patch||jsonb_build_object('currency',v->>'currency');end if;
 if p.destination_type in ('direct','service','other') and p.destination_text is distinct from v->>'location' then patch:=patch||jsonb_build_object('destination_text',v->>'location');end if;
 perform public.admin_update_purchase(p.id,patch);
 old_tax:=nullif(before_doc->'payload'->>'_tax_item_id','')::uuid;
 for i in select value from jsonb_array_elements(v->'items') loop
  item_id:=(i->>'id')::uuid;ids:=array_append(ids,item_id);
  select * into old from public.purchase_items where id=item_id;
  if old.id is not null and (old.purchase_id<>p.id or old.id=old_tax) then raise exception 'Ítem ajeno a esta orden de compra.';end if;
  select value into meta from jsonb_array_elements(p_payload->'items') where value->>'id'=i->>'id';
  product_id:=case when meta ? 'product_id' then nullif(meta->>'product_id','')::uuid else old.product_id end;
  factor:=case when meta ? 'factor_to_base' then (meta->>'factor_to_base')::numeric else coalesce(old.factor_to_base,1) end;
  stock:=case when meta ? 'affects_inventory' then (meta->>'affects_inventory')::boolean else coalesce(old.affects_inventory,false) end;
  if factor is null or factor<=0 or factor>1000000 or factor='NaN'::numeric or factor<>round(factor,6) then raise exception 'Conversión de unidad inválida.';end if;
  if stock is null or (stock and (product_id is null or p.destination_type<>'warehouse')) then raise exception 'Revisá el producto y el destino de los ítems que ingresan a stock.';end if;
  if product_id is not null and not exists(select 1 from public.products where id=product_id and active) then raise exception 'Producto de inventario inválido.';end if;
  patch:=jsonb_build_object('description',i->>'description','quantity',i->'quantity','unit',i->>'unit','unit_price',i->'unit_price','product_id',product_id,'factor_to_base',factor,'affects_inventory',stock);
  if old.id is null then
   insert into public.purchase_items(id,purchase_id,description,quantity,unit,unit_price,product_id,factor_to_base,affects_inventory)
   values(item_id,p.id,i->>'description',(i->>'quantity')::numeric,i->>'unit',(i->>'unit_price')::numeric,product_id,factor,stock);
  elsif (to_jsonb(old)->>'description',old.quantity,old.unit,old.unit_price,old.product_id,old.factor_to_base,old.affects_inventory) is distinct from
   (i->>'description',(i->>'quantity')::numeric,i->>'unit',(i->>'unit_price')::numeric,product_id,factor,stock) then
   result:=public.admin_update_purchase_item(item_id,patch);
   if result->>'mode'='split' then ids:=array_append(ids,(result->>'new_item_id')::uuid);end if;
  end if;
 end loop;
 for old in select * from public.purchase_items where purchase_id=p.id and not(id=any(ids)) and id is distinct from old_tax loop
  if old.received_qty>0 or exists(select 1 from public.purchase_receipt_items where purchase_item_id=old.id) then raise exception 'No se puede quitar un ítem con recepción registrada.';end if;
  delete from public.purchase_items where id=old.id;
 end loop;
 -- A received item may split into its historical part and a new pending line.
 -- Recompute IVA from the actual preserved prices before updating the tax line.
 select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) into result from public.purchase_items x where purchase_id=p.id and id is distinct from old_tax;
 v:=avh_commercial_private.normalize(jsonb_set(v,'{items}',result),'purchase_order',true);
 tax_id:=old_tax;
 if v->>'tax_mode'='add' and (v->>'tax_amount')::numeric>0 then
  if old_tax is null then
   insert into public.purchase_items(purchase_id,description,quantity,unit,unit_price,affects_inventory,notes) values(p.id,'IVA '||(v->>'tax_rate')||'%',1,'servicio',(v->>'tax_amount')::numeric,false,'AVH_OC_TAX') returning id into tax_id;
  else
   perform public.admin_update_purchase_item(old_tax,jsonb_build_object('description','IVA '||(v->>'tax_rate')||'%','quantity',1,'unit_price',v->'tax_amount'));
  end if;
 elsif old_tax is not null then
  if exists(select 1 from public.purchase_items where id=old_tax and received_qty>0) or exists(select 1 from public.purchase_receipt_items where purchase_item_id=old_tax) then raise exception 'No se puede cambiar el IVA de una línea recibida.';end if;
  delete from public.purchase_items where id=old_tax;tax_id:=null;
 end if;
 update public.purchases set po_number=v->>'document_number',po_document=v||jsonb_build_object('_tax_item_id',tax_id),po_document_revision=po_document_revision+1,updated_at=now() where id=p.id;
 after_doc:=avh_commercial_private.purchase_document(p.id);
 update public.commercial_documents set number=after_doc->>'number',payload=after_doc->'payload',issued_payload=after_doc->'payload',version=version+1,updated_at=now() where purchase_id=p.id;
 after_doc:=avh_commercial_private.purchase_document(p.id);
 insert into public.audit_events(entity_type,entity_id,purchase_id,action,actor_id,detail) values('purchase',p.id,p.id,'purchase_order_review_saved',auth.uid(),jsonb_build_object('request_id',p_request_id,'request_data',request_data,'before',before_doc,'after',after_doc));
 return after_doc;
end $$;
create function public.admin_save_purchase_order_document(p_purchase_id uuid,p_payload jsonb,p_expected_version text,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select avh_commercial_private.save_purchase_document(p_purchase_id,p_payload,p_expected_version,p_request_id)$$;

revoke all on function avh_commercial_private.review_company(jsonb),avh_commercial_private.purchase_document(uuid),avh_commercial_private.save_purchase_document(uuid,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function avh_commercial_private.purchase_document(uuid),avh_commercial_private.save_purchase_document(uuid,jsonb,text,uuid) to authenticated;
revoke all on function public.admin_purchase_order_document(uuid),public.admin_save_purchase_order_document(uuid,jsonb,text,uuid) from public,anon;
grant execute on function public.admin_purchase_order_document(uuid),public.admin_save_purchase_order_document(uuid,jsonb,text,uuid) to authenticated;
commit;
