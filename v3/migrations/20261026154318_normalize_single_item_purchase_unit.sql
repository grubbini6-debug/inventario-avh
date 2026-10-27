-- Normalize single-item notation before product validation without changing quantities or prices.
CREATE OR REPLACE FUNCTION public.purchase_normalize_unit(p_unit text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case
    -- x1 is the supplier's single-item notation, not a new stock unit.
    -- Larger packs such as x10 must retain their explicit conversion.
    when lower(trim(coalesce(p_unit,''))) ~ '^(x|×)[[:space:]]*1$' then 'unidad'
    else case lower(trim(coalesce(p_unit,'')))
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
  end
$function$;
