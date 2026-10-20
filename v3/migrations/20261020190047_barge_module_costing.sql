-- Destino naval por línea. Los datos históricos permanecen sin clasificación.
alter table public.movement_lines
  add column naval_section text,
  add column naval_module text;

alter table public.movement_lines
  add constraint movement_lines_naval_section_valid
    check (naval_section is null or naval_section in ('fondo','costado','popa','proa','general')),
  add constraint movement_lines_naval_module_valid
    check (naval_module is null or (
      naval_section is not null and naval_section<>'general'
      and char_length(naval_module) between 1 and 40
      and naval_module=upper(btrim(naval_module))
      and naval_module !~ '[[:cntrl:]]'
    ));

comment on column public.movement_lines.naval_section is
  'Destino de la entrega: fondo, costado, popa, proa o general. NULL conserva el dato histórico no informado.';
comment on column public.movement_lines.naval_module is
  'Código de módulo informado al entregar el material, dentro de la parte seleccionada. No se deduce del texto histórico.';

-- Conservar autorización, idempotencia, bloqueos y consumo FIFO de la RPC auditada.
do $migration$
declare
  v_def text;
  v_old text := $old$    insert into public.movement_lines(movement_id,product_id,quantity,unit,factor_to_base,presentation_label)
    values(v_movement,v_product,v_qty,v_unit,v_factor,nullif(v_item->>'presentation_label',''))
    returning id into v_line;$old$;
  v_new text := $new$    v_section:=nullif(lower(btrim(v_item->>'naval_section')),'');
    v_module:=nullif(regexp_replace(upper(btrim(v_item->>'naval_module')),'[[:space:]]+',' ','g'),'');
    if v_section is not null and v_section not in ('fondo','costado','popa','proa','general') then
      raise exception 'Parte de barcaza inválida. Elegí fondo, costado, popa, proa o general.';
    end if;
    if v_module is not null and (v_section is null or v_section='general') then
      raise exception 'Para indicar un módulo, elegí su parte de la barcaza.';
    end if;
    if v_module is not null and (char_length(v_module)>40 or coalesce(v_item->>'naval_module','') ~ '[[:cntrl:]]') then
      raise exception 'El código de módulo admite hasta 40 caracteres, sin saltos de línea.';
    end if;
    if v_section is not null and (p_barge_id is null or not exists(select 1 from public.barges where id=p_barge_id and active)) then
      raise exception 'Elegí una barcaza activa para indicar parte y módulo.';
    end if;
    insert into public.movement_lines(movement_id,product_id,quantity,unit,factor_to_base,presentation_label,naval_section,naval_module)
    values(v_movement,v_product,v_qty,v_unit,v_factor,nullif(v_item->>'presentation_label',''),v_section,v_module)
    returning id into v_line;$new$;
begin
  v_def:=pg_get_functiondef('public.record_exit(uuid,uuid,uuid,text,text,jsonb,text)'::regprocedure);
  if position(v_old in v_def)=0 or position('  v_request_id uuid;' in v_def)=0 then
    raise exception 'La RPC record_exit cambió. Revisar su contrato antes de instalar el destino por módulo.';
  end if;
  v_def:=replace(v_def,'  v_request_id uuid;',E'  v_request_id uuid;\n  v_section text;\n  v_module text;');
  v_def:=replace(v_def,v_old,v_new);
  execute v_def;
end
$migration$;

-- El flujo especializado de gases utiliza la misma salida FIFO.
do $migration$
declare
  v_oid regprocedure:=to_regprocedure('avh_gas_private.command(text,jsonb,uuid)');
  v_def text;
  v_old text := $old$v_move:=public.record_exit(v_w,nullif(p_data->>'barge_id','')::uuid,null,v_person,v_dest,jsonb_build_array(jsonb_build_object('product_id',v_p,'quantity',v_qty,'unit','cilindro','factor_to_base',1,'request_id',gen_random_uuid())),v_notes);$old$;
  v_new text := $new$v_move:=public.record_exit(v_w,nullif(p_data->>'barge_id','')::uuid,null,v_person,v_dest,jsonb_build_array(jsonb_build_object('product_id',v_p,'quantity',v_qty,'unit','cilindro','factor_to_base',1,'request_id',gen_random_uuid(),'naval_section',p_data->>'naval_section','naval_module',p_data->>'naval_module')),v_notes);$new$;
begin
  if v_oid is not null then
    v_def:=pg_get_functiondef(v_oid);
    if position(v_old in v_def)=0 then
      raise exception 'El flujo de gases cambió. Revisar la salida antes de instalar su destino naval.';
    end if;
    execute replace(v_def,v_old,v_new);
  end if;
end
$migration$;

-- Una fila por barcaza/parte/módulo/producto/moneda. Sumar las asignaciones,
-- no repetir la cantidad de la línea cuando FIFO utiliza varios lotes.
create view public.v_barge_module_consumption
with (security_invoker=true,security_barrier=true)
as
select
  m.barge_id,
  b.number barge_number,
  ml.naval_section,
  ml.naval_module,
  ml.product_id,
  p.name product_name,
  p.base_unit,
  ba.currency,
  sum(ba.quantity) base_quantity,
  sum(ba.quantity*coalesce(ba.unit_cost,0)) real_cost,
  coalesce(sum(ba.quantity) filter(where ba.unit_cost is null or ba.currency is null),0) unpriced_quantity,
  coalesce(sum(ba.quantity) filter(where ba.unit_cost is not null and ba.currency is not null),0) priced_quantity,
  count(distinct ml.id) line_count,
  count(distinct m.id) movement_count,
  max(m.created_at) last_movement_at
from public.movements m
join public.movement_lines ml on ml.movement_id=m.id
join public.products p on p.id=ml.product_id
join public.barges b on b.id=m.barge_id
join public.batch_allocations ba on ba.movement_line_id=ml.id
where m.type='exit' and m.status='confirmed' and m.barge_id is not null
  and (select public.current_profile_role())='admin'
group by m.barge_id,b.number,ml.naval_section,ml.naval_module,ml.product_id,p.name,p.base_unit,ba.currency;

revoke all on public.v_barge_module_consumption from public,anon,authenticated;
grant select on public.v_barge_module_consumption to authenticated;
comment on view public.v_barge_module_consumption is
  'Costos FIFO de salidas confirmadas por parte y módulo. Administración; monedas separadas; cantidades sin valorizar explícitas.';

notify pgrst,'reload schema';
