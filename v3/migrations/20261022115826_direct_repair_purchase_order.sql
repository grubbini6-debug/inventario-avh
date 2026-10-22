-- Repair budgets become ordinary service purchases. No machine catalog or custody record is required.
begin;
create function avh_repair_private.purchase_from_quote(p_data jsonb,p_items jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare req avh_repair_private.requests;request_data jsonb;result jsonb;items jsonb:='[]';j jsonb;
 v_purchase_id uuid;tax_id uuid;po text;company_id uuid;supplier_id uuid;currency text;mode text;
 rate numeric;quantity numeric;price numeric;subtotal numeric:=0;tax numeric;total numeric;source_total numeric;precision integer;
 description text;unit text;reference text;quote_date date;valid_until date;machine text;serial text;notes text;warranty numeric;
begin
 perform avh_repair_private.require_admin();
 if p_request_id is null then raise exception 'Solicitud inválida.';end if;
 request_data:=jsonb_build_object('data',p_data,'items',p_items);
 if length(request_data::text)>500000 then raise exception 'El presupuesto supera el tamaño permitido.';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into req from avh_repair_private.requests where id=p_request_id;
 if found then
  if req.actor_id is distinct from auth.uid() or req.action<>'purchase_from_quote' or req.payload is distinct from request_data then raise exception 'Solicitud reutilizada con datos distintos.';end if;
  if not exists(select 1 from public.purchases where id=(req.result->>'purchase_id')::uuid) then raise exception 'La OC anterior fue eliminada. Tocá Generar OC para crear una nueva.';end if;
  return req.result;
 end if;
 if jsonb_typeof(p_data) is distinct from 'object' or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Agregá entre 1 y 100 partidas al presupuesto.';end if;
 company_id:=nullif(p_data->>'company_id','')::uuid;supplier_id:=nullif(p_data->>'supplier_id','')::uuid;
 if not exists(select 1 from public.purchase_companies c where c.id=company_id and c.active) then raise exception 'Elegí la empresa compradora.';end if;
 if not exists(select 1 from public.suppliers s where s.id=supplier_id) then raise exception 'Elegí el taller / proveedor.';end if;
 currency:=p_data->>'currency';mode:=p_data->>'tax_mode';rate:=avh_repair_private.num(p_data->>'tax_rate');
 if currency is null or currency not in ('PYG','USD') or mode is null or mode not in ('included','add','none') or coalesce(rate,0)>100 or mode='add' and rate is null then raise exception 'Revisá la moneda y el IVA del presupuesto.';end if;
 precision:=case when currency='PYG' then 0 else 2 end;
 for j in select value from jsonb_array_elements(p_items) loop
  description:=avh_repair_private.txt(j->>'description',4000);unit:=avh_repair_private.txt(j->>'unit',60);
  quantity:=avh_repair_private.num(j->>'quantity');price:=avh_repair_private.num(j->>'unit_price');
  if description is null or unit is null or quantity is null or quantity<=0 or quantity>1000000 or price is null then raise exception 'Completá descripción, cantidad, unidad y precio de cada partida.';end if;
  if quantity<>round(quantity,6) or price<>round(price,6) then raise exception 'Se admiten hasta seis decimales por cantidad o precio.';end if;
  subtotal:=subtotal+round(quantity*price,precision);
  items:=items||jsonb_build_array(jsonb_build_object('description',description,'quantity',quantity,'unit',unit,'unit_price',price,'factor_to_base',1,'affects_inventory',false));
 end loop;
 tax:=case when mode='add' then round(subtotal*rate/100,precision) else 0 end;total:=subtotal+tax;
 if total>1000000000000 then raise exception 'El presupuesto supera el importe permitido.';end if;
 source_total:=avh_repair_private.num(p_data->>'source_total');
 if source_total is not null and source_total<>total then raise exception 'El total no coincide con el original. Revisá IVA, cantidades y precios.';end if;
 if tax>0 then items:=items||jsonb_build_array(jsonb_build_object('description','IVA '||rate::text||'%','quantity',1,'unit','servicio','unit_price',tax,'factor_to_base',1,'affects_inventory',false,'notes','AVH_OC_TAX'));end if;
 reference:=avh_repair_private.txt(p_data->>'quote_number',160);quote_date:=nullif(p_data->>'quote_date','')::date;valid_until:=nullif(p_data->>'valid_until','')::date;
 machine:=avh_repair_private.txt(p_data->>'machine_name',2000);serial:=avh_repair_private.txt(p_data->>'serial_number',180);
 warranty:=avh_repair_private.num(p_data->>'warranty_days');if warranty is not null and (warranty>3650 or warranty<>trunc(warranty)) then raise exception 'Garantía inválida.';end if;
 notes:=concat_ws(E'\n',case when machine is not null then 'Máquina: '||machine end,case when serial is not null then 'Serie: '||serial end,
  avh_repair_private.txt(p_data->>'problem',4000),avh_repair_private.txt(p_data->>'notes',4000),case when warranty is not null then 'Garantía ofrecida: '||warranty::text||' días' end,case when valid_until is not null then 'Presupuesto válido hasta: '||valid_until::text end);
 if length(notes)>4000 then raise exception 'Las observaciones de la OC superan los 4000 caracteres.';end if;
 v_purchase_id:=public.admin_create_purchase(jsonb_build_object('company_id',company_id,'supplier_id',supplier_id,'purchase_type','service','status','quoted','destination_type','direct',
  'destination_text',avh_repair_private.txt(p_data->>'destination_text',300),'currency',currency,'order_reference',reference,
  'requester',(select coalesce(full_name,username) from public.profiles where id=auth.uid()),'sector','Mantenimiento',
  'payment_terms',avh_repair_private.txt(p_data->>'payment_terms',4000),'notes',notes,'delivery_mode','single'),items);
 po:=public.admin_prepare_purchase_order(v_purchase_id);
 select i.id into tax_id from public.purchase_items i where i.purchase_id=v_purchase_id and i.notes='AVH_OC_TAX';
 update public.purchases p set source_document_number=reference,source_document_date=quote_date,source_document_kind='quotation',
  po_document=jsonb_build_object('tax_mode',mode,'tax_rate',coalesce(rate,0),'_tax_item_id',tax_id) where p.id=v_purchase_id;
 result:=jsonb_build_object('purchase_id',v_purchase_id,'po_number',po,'total',total,'currency',currency);
 insert into avh_repair_private.requests(id,actor_id,action,payload,result) values(p_request_id,auth.uid(),'purchase_from_quote',request_data,result);
 insert into public.audit_events(entity_type,entity_id,purchase_id,action,actor_id,detail)
 values('purchase',v_purchase_id,v_purchase_id,'service_purchase_from_quote',auth.uid(),jsonb_build_object('request_id',p_request_id,'total',total,'currency',currency));
 return result;
end $$;
create function public.admin_create_service_purchase_from_quote(p_data jsonb,p_items jsonb,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select avh_repair_private.purchase_from_quote(p_data,p_items,p_request_id)$$;
revoke all on function avh_repair_private.purchase_from_quote(jsonb,jsonb,uuid),public.admin_create_service_purchase_from_quote(jsonb,jsonb,uuid) from public,anon;
grant execute on function avh_repair_private.purchase_from_quote(jsonb,jsonb,uuid),public.admin_create_service_purchase_from_quote(jsonb,jsonb,uuid) to authenticated;

-- Accidental saved uploads can be removed before they create a service commitment.
create function avh_repair_private.delete_draft(p_id uuid,p_expected_version integer,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.repair_orders;req avh_repair_private.requests;request_data jsonb;files jsonb;events jsonb;result jsonb;
begin
 perform avh_repair_private.require_admin();
 if p_id is null or p_request_id is null then raise exception 'Solicitud inválida.';end if;
 request_data:=jsonb_build_object('order_id',p_id,'expected_version',p_expected_version);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||p_request_id::text,0));
 select * into req from avh_repair_private.requests where id=p_request_id;
 if found then
  if req.actor_id is distinct from auth.uid() or req.action<>'delete_draft' or req.payload is distinct from request_data then raise exception 'Solicitud reutilizada con datos distintos.';end if;
  return req.result;
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,0));
 select * into o from public.repair_orders where id=p_id for update;
 if not found then raise exception 'El borrador ya no existe. Actualizá el listado.';end if;
 if o.version is distinct from p_expected_version then raise exception 'La reparación cambió. Volvé a abrirla antes de eliminar.';end if;
 if o.status not in ('draft','pending','cancelled') or o.purchase_id is not null or cardinality(o.additional_purchase_ids)>0 or o.approved_payload is not null or exists(select 1 from public.repair_assets where order_id=p_id) then raise exception 'Solo se puede eliminar un presupuesto sin OC ni reparación autorizada.';end if;
 select coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) into files from public.repair_attachments a where a.order_id=p_id;
 select coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) into events from public.repair_events e where e.order_id=p_id;
 result:=jsonb_build_object('order_id',p_id,'number',o.number,'file_paths',(select coalesce(jsonb_agg(a->>'file_path'),'[]'::jsonb) from jsonb_array_elements(files) a));
 insert into public.audit_events(entity_type,entity_id,action,actor_id,warehouse_id,detail) values('repair',p_id,'repair_draft_deleted',auth.uid(),o.warehouse_id,jsonb_build_object('order',to_jsonb(o),'attachments',files,'events',events,'file_paths',result->'file_paths'));
 delete from public.repair_attachments where order_id=p_id;
 delete from public.repair_events where order_id=p_id;
 delete from public.repair_orders where id=p_id;
 insert into avh_repair_private.requests(id,actor_id,action,payload,result) values(p_request_id,auth.uid(),'delete_draft',request_data,result);
 return result;
end $$;
create function public.admin_delete_repair_draft(p_id uuid,p_expected_version integer,p_request_id uuid)
returns jsonb language sql security invoker set search_path='' as $$select avh_repair_private.delete_draft(p_id,p_expected_version,p_request_id)$$;
revoke all on function avh_repair_private.delete_draft(uuid,integer,uuid),public.admin_delete_repair_draft(uuid,integer,uuid) from public,anon;
grant execute on function avh_repair_private.delete_draft(uuid,integer,uuid),public.admin_delete_repair_draft(uuid,integer,uuid) to authenticated;

create function avh_repair_private.guard_deleted_draft() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.audit_events where entity_type='repair' and entity_id=new.id and action='repair_draft_deleted') then raise exception 'Ese borrador fue eliminado. Cargá un presupuesto nuevo.';end if;
 return new;
end $$;
revoke all on function avh_repair_private.guard_deleted_draft() from public,anon,authenticated;
create trigger repair_draft_not_deleted before insert on public.repair_orders for each row execute function avh_repair_private.guard_deleted_draft();
create function avh_repair_private.deleted_draft_file(path text) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(public.current_profile_role()='admin',false) and exists(select 1 from public.audit_events where entity_type='repair' and action='repair_draft_deleted' and detail->'file_paths' ? path)
$$;
revoke all on function avh_repair_private.deleted_draft_file(text) from public,anon;
grant execute on function avh_repair_private.deleted_draft_file(text) to authenticated;
create policy repair_deleted_draft_file_delete on storage.objects for delete to authenticated using(bucket_id='repair-documents' and avh_repair_private.deleted_draft_file(name));
commit;
