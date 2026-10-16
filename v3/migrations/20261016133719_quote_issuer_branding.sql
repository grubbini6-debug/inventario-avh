-- Issuer details belong to each quote; they never modify the purchasing company catalog.
begin;
create function avh_commercial_private.quote_company(p jsonb,p_complete boolean default false)
returns jsonb language plpgsql stable set search_path='' as $$
declare c jsonb;v jsonb;k text;logo text;data bytea;mime text;size integer;pos integer;marker integer;segment integer;w bigint:=0;h bigint:=0;
begin
 if auth.uid() is null or avh_commercial_private.role() is null then raise exception 'No autorizado para presupuestos.';end if;
 if p is not null and jsonb_typeof(p) is distinct from 'object' then raise exception 'Empresa emisora inválida.';end if;
 if p->'brand_avh' is distinct from 'false'::jsonb then
  c:=avh_commercial_private.company();
  if c is null then raise exception 'Empresa emisora no configurada.';end if;
  v:=c||jsonb_build_object('brand_avh',true);
  if p->'brand_avh' is distinct from 'true'::jsonb then return v;end if;
 else v:=jsonb_build_object('brand_avh',false);end if;
 foreach k in array array['legal_name','tax_id','address','phone','email'] loop
  if p ? k and p->k<>'null'::jsonb and jsonb_typeof(p->k) is distinct from 'string' then raise exception 'Campo de empresa inválido: %.',k;end if;
  if length(coalesce(p->>k,''))>500 then raise exception 'Campo de empresa demasiado extenso: %.',k;end if;
  v:=v||jsonb_build_object(k,trim(coalesce(p->>k,v->>k,'')));
 end loop;
 v:=v||jsonb_build_object('name',v->>'legal_name');
 if v->'brand_avh'='false'::jsonb then
  if p ? 'logo_data_url' and jsonb_typeof(p->'logo_data_url') is distinct from 'string' then raise exception 'Logo inválido.';end if;
  logo:=coalesce(p->>'logo_data_url','');
  if logo<>'' then
   if length(logo)>409630 or logo!~'^data:image/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$' then raise exception 'El logo debe ser PNG o JPG de hasta 300 KB.';end if;
   mime:=split_part(split_part(logo,';',1),':',2);data:=decode(split_part(logo,',',2),'base64');size:=octet_length(data);
   if size>307200 or size<12 then raise exception 'Tamaño de logo inválido (hasta 300 KB).';end if;
   if mime='image/png' then
    if size<45 or substring(data from 1 for 16)<>decode('89504e470d0a1a0a0000000d49484452','hex') or substring(data from size-11 for 12)<>decode('0000000049454e44ae426082','hex') then raise exception 'El logo PNG no es válido.';end if;
    w:=get_byte(data,16)::bigint*16777216+get_byte(data,17)*65536+get_byte(data,18)*256+get_byte(data,19);
    h:=get_byte(data,20)::bigint*16777216+get_byte(data,21)*65536+get_byte(data,22)*256+get_byte(data,23);
   else
    if substring(data from 1 for 2)<>decode('ffd8','hex') or substring(data from size-1 for 2)<>decode('ffd9','hex') then raise exception 'El logo JPG no es válido.';end if;
    pos:=2;
    while pos+3<size loop
     if get_byte(data,pos)<>255 then raise exception 'El logo JPG no es válido.';end if;pos:=pos+1;
     while pos<size and get_byte(data,pos)=255 loop pos:=pos+1;end loop;
     if pos+2>=size then exit;end if;marker:=get_byte(data,pos);pos:=pos+1;
     if marker in (217,218) then exit;end if;
     if marker=1 or marker between 208 and 215 then continue;end if;
     segment:=get_byte(data,pos)*256+get_byte(data,pos+1);
     if segment<2 or pos+segment>size then raise exception 'El logo JPG está incompleto.';end if;
     if marker in (192,193,194,195,197,198,199,201,202,203,205,206,207) then
      if segment<8 then exit;end if;h:=get_byte(data,pos+3)*256+get_byte(data,pos+4);w:=get_byte(data,pos+5)*256+get_byte(data,pos+6);exit;
     end if;pos:=pos+segment;
    end loop;
   end if;
   if w<1 or h<1 or w>2048 or h>2048 or w*h>2097152 then raise exception 'El logo admite hasta 2.048 píxeles por lado y 2 megapíxeles.';end if;
  end if;
  v:=v||jsonb_build_object('logo_data_url',logo);
 end if;
 if p_complete and (coalesce(v->>'legal_name','')='' or coalesce(v->>'tax_id','')='') then raise exception 'Completá razón social y RUC de la empresa emisora.';end if;
 return v;
end $$;
revoke all on function avh_commercial_private.quote_company(jsonb,boolean) from public,anon,authenticated;

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
 if p_kind='quote' then v:=v||jsonb_build_object('company',avh_commercial_private.quote_company(p->'company',p_complete));end if;
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
    v_number:=case when v->'company'->'brand_avh'='false'::jsonb then 'PRE-' else 'PRE-AVH-' end||v_year||'-'||lpad(v_no::text,5,'0');
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
commit;
