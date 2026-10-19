CREATE OR REPLACE FUNCTION public.purchase_normalize_unit(p_unit text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
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
    when 'pr' then 'par' when 'par' then 'par' when 'pares' then 'par'
    when 'otro' then 'otro'
    else coalesce(nullif(lower(trim(p_unit)),''),'unidad')
  end
$function$;


-- Reject dimensionally invalid stock conversions on every receiving path.
-- The quote reader's factor may describe package weight; the product defines stock units.
create schema if not exists avh_purchase_private;
revoke all on schema avh_purchase_private from public,anon,authenticated;

create function avh_purchase_private.guard_stock_conversion()
returns trigger language plpgsql security invoker set search_path='' as $guard$
declare
  v_base text;
begin
  if TG_TABLE_NAME='purchase_items' then
    if not coalesce(NEW.affects_inventory,false) then return NEW; end if;
  end if;
  select public.purchase_normalize_unit(p.base_unit) into v_base from public.products p where p.id=NEW.product_id;
  if v_base is null then raise exception 'Producto de stock inexistente o no visible.'; end if;
  if NEW.factor_to_base is null or NEW.factor_to_base<=0 then raise exception 'La conversión del material debe ser mayor a cero.'; end if;
  if public.purchase_normalize_unit(NEW.unit)=v_base and NEW.factor_to_base<>1 then
    raise exception 'La compra y el stock están en %: la conversión debe ser 1. El peso del rollo o envase se informa por separado.',v_base;
  end if;
  return NEW;
end $guard$;
revoke all on function avh_purchase_private.guard_stock_conversion() from public,anon,authenticated;

create trigger purchase_items_stock_conversion_guard
before insert or update of product_id,unit,factor_to_base,affects_inventory on public.purchase_items
for each row execute function avh_purchase_private.guard_stock_conversion();

create trigger movement_lines_stock_conversion_guard
before insert or update of product_id,unit,factor_to_base on public.movement_lines
for each row execute function avh_purchase_private.guard_stock_conversion();

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
begin
  if public.current_profile_role() IS DISTINCT FROM 'admin' then raise exception 'Solo el administrador puede crear compras.'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'La compra no tiene ítems.'; end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := nullif(v_item->>'product_id','')::uuid;
    v_product_name := nullif(trim(v_item->>'description'),'');
    v_product_sku := nullif(trim(coalesce(v_item->>'product_code',v_item->>'barcode')),'');
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
