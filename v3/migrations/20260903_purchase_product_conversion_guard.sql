-- AVH — Guardia de conversión para productos existentes con unidad base distinta.
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
  v_product_base_unit text;
  v_unit text;
  v_factor numeric;
  v_affects boolean;
  v_note text;
begin
  if public.current_profile_role()<>'admin' then raise exception 'Solo el administrador puede crear compras.'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'La compra no tiene ítems.'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := nullif(v_item->>'product_id','')::uuid;
    v_product_name := nullif(trim(v_item->>'description'),'');
    v_product_sku := nullif(trim(coalesce(v_item->>'product_code',v_item->>'barcode')),'');
    v_unit := public.purchase_normalize_unit(v_item->>'unit');
    v_factor := greatest(coalesce(nullif(v_item->>'factor_to_base','')::numeric,1),0.000001);
    v_product_base_unit := null;
    v_note := nullif(v_item->>'notes','');

    if v_product_id is not null then
      select base_unit into v_product_base_unit from public.products where id=v_product_id;
      if v_product_base_unit is null then v_product_id:=null; end if;
    end if;
    if v_product_id is null and v_product_sku is not null then
      select id,base_unit into v_product_id,v_product_base_unit from public.products where lower(coalesce(sku,''))=lower(v_product_sku) limit 1;
    end if;
    if v_product_id is null and v_product_name is not null then
      select id,base_unit into v_product_id,v_product_base_unit from public.products where lower(trim(name))=lower(trim(v_product_name)) limit 1;
    end if;

    if v_product_id is null then
      if v_product_name is null then raise exception 'Hay un ítem sin descripción; no puedo crear el producto.'; end if;
      begin
        insert into public.products(sku,name,base_unit,active,created_by)
        values(v_product_sku,v_product_name,v_unit,true,auth.uid())
        returning id,base_unit into v_product_id,v_product_base_unit;
      exception when unique_violation then
        select id,base_unit into v_product_id,v_product_base_unit
        from public.products
        where (v_product_sku is not null and lower(coalesce(sku,''))=lower(v_product_sku))
           or lower(trim(name))=lower(trim(v_product_name))
        order by case when v_product_sku is not null and lower(coalesce(sku,''))=lower(v_product_sku) then 0 else 1 end
        limit 1;
        if v_product_id is null then raise; end if;
      end;
    end if;

    v_affects := coalesce((p_data->>'destination_type')='warehouse',false);
    if v_affects and v_product_base_unit<>v_unit then
      if v_factor=1 and v_unit='tonelada' and v_product_base_unit='kg' then
        v_factor:=1000;
      elsif v_factor=1 and v_unit='kg' and v_product_base_unit='tonelada' then
        v_factor:=0.001;
      elsif v_factor=1 then
        v_affects:=false;
        v_note:=concat_ws(' · ',v_note,format('Producto vinculado; revisar conversión %s → %s antes de afectar stock.',v_unit,v_product_base_unit));
      end if;
    end if;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'product_id',v_product_id,
      'description',v_product_name,
      'quantity',coalesce((v_item->>'quantity')::numeric,0),
      'unit',v_unit,
      'factor_to_base',v_factor,
      'unit_price',coalesce((v_item->>'unit_price')::numeric,0),
      'affects_inventory',v_affects,
      'notes',v_note
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
