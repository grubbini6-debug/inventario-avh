-- AVH — Ciclo completo de compra y recepción.
-- Presupuesto -> productos vinculados/creados -> OC -> recepción -> factura/remito.

-- 1) Permitir que el catálogo represente las unidades usadas realmente en compras.
alter table public.products drop constraint if exists products_base_unit_check;
alter table public.products add constraint products_base_unit_check check (base_unit = any (array[
  'unidad','pieza','kg','tonelada','rollo','bobina','caja','paquete','bolsa','metro','m²','m³','litro','cilindro','tambor','pallet','plancha','barra','tubo','perfil','bidón','servicio','viaje','hora','día','otro'
]::text[]));

alter table public.product_presentations drop constraint if exists product_presentations_unit_check;
alter table public.product_presentations add constraint product_presentations_unit_check check (unit = any (array[
  'unidad','pieza','kg','tonelada','rollo','bobina','caja','paquete','bolsa','metro','m²','m³','litro','cilindro','tambor','pallet','plancha','barra','tubo','perfil','bidón','servicio','viaje','hora','día','otro'
]::text[]));

create or replace function public.purchase_normalize_unit(p_unit text)
returns text
language sql
immutable
set search_path='public'
as $$
  select case lower(trim(coalesce(p_unit,'')))
    when 'un' then 'unidad' when 'und' then 'unidad' when 'u' then 'unidad'
    when 'unidades' then 'unidad' when 'unidad' then 'unidad'
    when 'pieza' then 'pieza' when 'piezas' then 'pieza'
    when 'kg' then 'kg' when 'kgs' then 'kg' when 'kilogramo' then 'kg' when 'kilogramos' then 'kg'
    when 'tn' then 'tonelada' when 'ton' then 'tonelada' when 'toneladas' then 'tonelada' when 'tonelada' then 'tonelada'
    when 'rollos' then 'rollo' when 'rollo' then 'rollo'
    when 'bobinas' then 'bobina' when 'bobina' then 'bobina'
    when 'cajas' then 'caja' when 'caja' then 'caja'
    when 'paquetes' then 'paquete' when 'paquete' then 'paquete'
    when 'bolsas' then 'bolsa' when 'bolsa' then 'bolsa'
    when 'm' then 'metro' when 'mt' then 'metro' when 'mts' then 'metro' when 'metros' then 'metro' when 'metro' then 'metro'
    when 'm2' then 'm²' when 'm²' then 'm²'
    when 'm3' then 'm³' when 'm³' then 'm³'
    when 'l' then 'litro' when 'lt' then 'litro' when 'lts' then 'litro' when 'litros' then 'litro' when 'litro' then 'litro'
    when 'cilindros' then 'cilindro' when 'cilindro' then 'cilindro'
    when 'tambores' then 'tambor' when 'tambor' then 'tambor'
    when 'pallets' then 'pallet' when 'pallet' then 'pallet'
    when 'planchas' then 'plancha' when 'plancha' then 'plancha'
    when 'barras' then 'barra' when 'barra' then 'barra'
    when 'tubos' then 'tubo' when 'tubo' then 'tubo'
    when 'perfiles' then 'perfil' when 'perfil' then 'perfil'
    when 'bidones' then 'bidón' when 'bidon' then 'bidón' when 'bidón' then 'bidón'
    when 'servicios' then 'servicio' when 'servicio' then 'servicio'
    when 'viajes' then 'viaje' when 'viaje' then 'viaje'
    when 'horas' then 'hora' when 'hora' then 'hora'
    when 'dias' then 'día' when 'días' then 'día' when 'dia' then 'día' when 'día' then 'día'
    when 'otro' then 'otro'
    else 'unidad'
  end
$$;

-- 2) El expediente documental de una compra puede apuntar a una recepción concreta.
alter table public.purchase_documents
  add column if not exists receipt_id uuid references public.purchase_receipts(id) on delete set null,
  add column if not exists document_number text,
  add column if not exists document_date date,
  add column if not exists source text not null default 'upload';

create index if not exists purchase_documents_receipt_idx on public.purchase_documents(receipt_id);
create index if not exists purchase_documents_purchase_kind_idx on public.purchase_documents(purchase_id,kind);

-- 3) Crear/vincular productos automáticamente al crear una compra desde presupuesto.
create or replace function public.admin_create_purchase_from_quote(p_data jsonb,p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_id uuid;
  v_po text;
  v_data jsonb;
  v_item jsonb;
  v_items jsonb := '[]'::jsonb;
  v_product_id uuid;
  v_product_name text;
  v_product_sku text;
  v_unit text;
  v_factor numeric;
  v_affects boolean;
begin
  if public.current_profile_role()<>'admin' then raise exception 'Solo el administrador puede crear compras.'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'La compra no tiene ítems.'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := nullif(v_item->>'product_id','')::uuid;
    v_product_name := nullif(trim(v_item->>'description'),'');
    v_product_sku := nullif(trim(coalesce(v_item->>'product_code',v_item->>'barcode')),'');
    v_unit := public.purchase_normalize_unit(v_item->>'unit');
    v_factor := greatest(coalesce(nullif(v_item->>'factor_to_base','')::numeric,1),0.000001);

    if v_product_id is null and v_product_sku is not null then
      select id into v_product_id from public.products where lower(coalesce(sku,''))=lower(v_product_sku) limit 1;
    end if;
    if v_product_id is null and v_product_name is not null then
      select id into v_product_id from public.products where lower(trim(name))=lower(trim(v_product_name)) limit 1;
    end if;

    if v_product_id is null then
      if v_product_name is null then raise exception 'Hay un ítem sin descripción; no puedo crear el producto.'; end if;
      begin
        insert into public.products(sku,name,base_unit,active,created_by)
        values(v_product_sku,v_product_name,v_unit,true,auth.uid())
        returning id into v_product_id;
      exception when unique_violation then
        select id into v_product_id
        from public.products
        where (v_product_sku is not null and lower(coalesce(sku,''))=lower(v_product_sku))
           or lower(trim(name))=lower(trim(v_product_name))
        order by case when v_product_sku is not null and lower(coalesce(sku,''))=lower(v_product_sku) then 0 else 1 end
        limit 1;
        if v_product_id is null then raise; end if;
      end;
    end if;

    v_affects := coalesce((p_data->>'destination_type')='warehouse',false);
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'product_id',v_product_id,
      'description',v_product_name,
      'quantity',coalesce((v_item->>'quantity')::numeric,0),
      'unit',v_unit,
      'factor_to_base',v_factor,
      'unit_price',coalesce((v_item->>'unit_price')::numeric,0),
      'affects_inventory',v_affects,
      'notes',nullif(v_item->>'notes','')
    ));
  end loop;

  v_data:=coalesce(p_data,'{}'::jsonb)||jsonb_build_object('status','approved');
  v_id:=public.admin_create_purchase(v_data,v_items);
  update public.purchases
     set source_document_number=nullif(p_data->>'source_document_number',''),
         source_document_date=nullif(p_data->>'source_document_date','')::date,
         source_document_kind=nullif(p_data->>'source_document_kind',''),
         updated_at=now()
   where id=v_id;
  v_po:=public.admin_prepare_purchase_order(v_id);
  return jsonb_build_object('purchase_id',v_id,'po_number',v_po);
end$$;

-- 4) Registrar factura/remito dentro de la misma compra y de la recepción concreta.
create or replace function public.register_purchase_receipt_document(
  p_receipt_id uuid,
  p_kind text,
  p_file_path text,
  p_file_name text default null,
  p_document_number text default null,
  p_document_date date default null
)
returns uuid
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_receipt public.purchase_receipts%rowtype;
  v_purchase public.purchases%rowtype;
  v_doc uuid;
  v_role text;
begin
  v_role:=public.current_profile_role();
  if v_role not in ('admin','depositor') then raise exception 'Usuario no autorizado para adjuntar documentos de recepción.'; end if;
  if p_kind not in ('invoice','remittance','other') then raise exception 'Tipo de documento inválido.'; end if;
  if nullif(trim(coalesce(p_file_path,'')),'') is null then raise exception 'Falta el archivo del documento.'; end if;

  select * into v_receipt from public.purchase_receipts where id=p_receipt_id;
  if not found then raise exception 'Recepción inexistente.'; end if;
  select * into v_purchase from public.purchases where id=v_receipt.purchase_id;
  if not found then raise exception 'Compra inexistente.'; end if;
  if v_role='depositor' then perform public.assert_can_access_warehouse(v_receipt.warehouse_id); end if;

  insert into public.purchase_documents(purchase_id,receipt_id,kind,file_path,file_name,document_number,document_date,source,uploaded_by)
  values(v_purchase.id,v_receipt.id,p_kind,p_file_path,p_file_name,p_document_number,p_document_date,'receipt',auth.uid())
  returning id into v_doc;

  if p_kind='invoice' then
    update public.purchases
       set invoice_number=coalesce(nullif(trim(p_document_number),''),invoice_number),
           invoice_date=coalesce(p_document_date,invoice_date),
           updated_at=now()
     where id=v_purchase.id;
  end if;

  insert into public.audit_events(entity_type,entity_id,purchase_id,action,actor_id,detail)
  values('purchase',v_purchase.id,v_purchase.id,'purchase_receipt_document_attached',auth.uid(),
    jsonb_build_object('receipt_id',v_receipt.id,'kind',p_kind,'document_number',p_document_number,'file_name',p_file_name));
  return v_doc;
end$$;

revoke execute on function public.register_purchase_receipt_document(uuid,text,text,text,text,date) from public,anon;
grant execute on function public.register_purchase_receipt_document(uuid,text,text,text,text,date) to authenticated;

-- 5) El depositero puede subir archivos únicamente a carpetas de compras de su propio depósito.
drop policy if exists purchase_docs_depositor_insert on storage.objects;
create policy purchase_docs_depositor_insert on storage.objects
for insert to authenticated
with check (
  bucket_id='purchase-documents'
  and public.current_profile_role()='depositor'
  and exists (
    select 1 from public.purchases p
    where p.id::text=split_part(storage.objects.name,'/',1)
      and p.destination_type='warehouse'
      and p.warehouse_id=public.current_profile_warehouse()
      and p.status in ('ordered','in_transit','partially_received','received','invoiced','closed')
  )
);
