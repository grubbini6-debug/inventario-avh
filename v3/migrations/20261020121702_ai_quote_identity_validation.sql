CREATE OR REPLACE FUNCTION public.admin_create_purchase_from_quote(p_data jsonb, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_known numeric;
  v_known_count integer;
  v_identity_problem text;
begin
  if public.current_profile_role() IS DISTINCT FROM 'admin' then raise exception 'Solo el administrador puede crear compras.'; end if;
  if coalesce(p_data->>'currency','') not in ('PYG','USD') then raise exception 'Elegí una moneda válida antes de crear la compra.';end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'La compra no tiene ítems.'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := nullif(v_item->>'product_id','')::uuid;
    v_product_name := nullif(trim(v_item->>'description'),'');
    v_product_sku := nullif(trim(coalesce(v_item->>'product_code',v_item->>'barcode')),'');
    if jsonb_typeof(v_item->'quantity') is distinct from 'number' or jsonb_typeof(v_item->'unit_price') is distinct from 'number' or nullif(trim(v_item->>'unit'),'') is null or nullif(v_item->>'quantity','') is null or (v_item->>'quantity')::numeric<=0 or nullif(v_item->>'unit_price','') is null or (v_item->>'unit_price')::numeric<0 then raise exception 'Completá cantidad, unidad y precio de cada ítem antes de crear la compra.';end if;
    v_unit := public.purchase_normalize_unit(v_item->>'unit');
    v_factor := coalesce(nullif(v_item->>'factor_to_base','')::numeric,1);
    if v_factor<=0 then raise exception 'Conversión inválida para %.',v_product_name; end if;
    v_product_base_unit := null;
    v_note := nullif(v_item->>'notes','');

    if v_product_id is not null then
      select base_unit into v_product_base_unit from public.products where id=v_product_id and active;
      if v_product_base_unit is null then raise exception 'Producto inexistente o inactivo. Elegí una ficha activa.'; end if;
    end if;
    if v_product_id is null and v_product_sku is not null then
      select id,base_unit into v_product_id,v_product_base_unit from public.products where active and lower(coalesce(sku,''))=lower(v_product_sku) limit 1;
    end if;
    if v_product_id is null and v_product_name is not null then
      select id,base_unit into v_product_id,v_product_base_unit from public.products where active and lower(trim(name))=lower(trim(v_product_name)) limit 1;
    end if;

    if v_product_id is null then
      if v_product_name is null then raise exception 'Hay un ítem sin descripción; no puedo crear el producto.'; end if;
      begin
        insert into public.products(sku,name,base_unit,active,created_by,brand,manufacturer_code)
        values(v_product_sku,v_product_name,v_unit,true,auth.uid(),nullif(trim(v_item->>'brand'),''),nullif(trim(v_item->>'manufacturer_code'),''))
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

    v_identity_problem:=avh_purchase_private.product_identity_problem(v_product_name,v_item->>'brand',v_item->>'manufacturer_code',v_product_id);
    if v_identity_problem is not null then raise exception '%',v_identity_problem;end if;

    v_affects := coalesce((p_data->>'destination_type')='warehouse',false);
    if v_affects then
      v_product_base_unit:=public.purchase_normalize_unit(v_product_base_unit);
      if v_product_base_unit=v_unit then
        -- 72 units of 15 kg are 72 stock units, never 1080 units.
        v_factor:=1;
      else
        select count(distinct pp.factor_to_base),min(pp.factor_to_base)
          into v_known_count,v_known
        from public.product_presentations pp
        where pp.product_id=v_product_id and public.purchase_normalize_unit(pp.unit)=v_unit and pp.factor_to_base>0;
        if v_known_count=1 then v_factor:=v_known;
        elsif v_known_count>1 then raise exception 'Hay varias presentaciones para %. Revisá la conversión.',v_product_name;
        elsif v_unit='tonelada' and v_product_base_unit='kg' then v_factor:=1000;
        elsif v_unit='kg' and v_product_base_unit='tonelada' then v_factor:=0.001;
        elsif nullif(v_item->>'base_unit','') is not null and public.purchase_normalize_unit(v_item->>'base_unit')<>v_product_base_unit then
          raise exception 'La lectura convierte a %, pero el producto se controla en %. Revisá %.',v_item->>'base_unit',v_product_base_unit,v_product_name;
        elsif v_factor=1 then
          raise exception 'Falta confirmar la conversión de % a % para %. La compra no se creó.',v_unit,v_product_base_unit,v_product_name;
        end if;
      end if;
      if v_product_base_unit=v_unit and nullif(trim(v_item->>'presentation'),'') is not null then
        insert into public.product_presentations(product_id,label,unit,factor_to_base)
        values(v_product_id,trim(v_item->>'presentation'),v_unit,1) on conflict do nothing;
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
end$function$;

revoke all on function public.admin_create_purchase_from_quote(jsonb,jsonb) from public,anon;
grant execute on function public.admin_create_purchase_from_quote(jsonb,jsonb) to authenticated;

revoke all on function public.admin_create_purchase_from_quote(jsonb,jsonb) from public,anon;
grant execute on function public.admin_create_purchase_from_quote(jsonb,jsonb) to authenticated;
