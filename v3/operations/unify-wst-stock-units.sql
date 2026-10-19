-- Authorized correction of the first WST receipt and the opening count.
-- Run in one transaction. Identifiers are resolved from catalog/OC business keys.
-- Preserve the original receipt, invoice, purchase value and separate cost lots.
do $unify_wst$
declare
  v_old uuid; v_target uuid; v_actor uuid; v_open record; v_entry record;
  v_purchase record; v_before jsonb; v_after jsonb; v_old_value numeric; v_new_value numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended('avh:unify-wst-in-units:20261019',0));
  if exists(select 1 from public.audit_events where action='wst_inventory_unified_in_units' and detail->>'operation'='wst_units_20261019') then return; end if;
  select id into strict v_actor from public.profiles where username='admin.avh' and role='admin' and active;
  select id into strict v_old from public.products where sku='TUB-WST-E71T1C-12' and base_unit='kg' and active;
  select id into strict v_target from public.products where sku='CHT711120P' and base_unit='unidad' and active;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_actor,'role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub',v_actor::text,true);
  perform 1 from public.purchase_items where product_id in (v_old,v_target) order by id for update;
  select pi.*,p.po_number into strict v_purchase from public.purchase_items pi join public.purchases p on p.id=pi.purchase_id
    where p.po_number='OC-2026-00032' and pi.product_id=v_target and p.status='received' for update of p;
  perform 1 from public.inventory_batches where product_id in (v_old,v_target) order by id for update;
  perform 1 from public.movement_lines where product_id in (v_old,v_target) order by id for update;
  perform 1 from public.products where id in (v_old,v_target) order by id for update;
  if exists(select 1 from public.fabrication_materials where product_id=v_old)
    or exists(select 1 from public.fabrication_orders where output_product_id=v_old)
    or exists(select 1 from public.fabrication_stock_links where product_id=v_old)
    or exists(select 1 from public.gas_products where product_id=v_old)
    or exists(select 1 from public.stock_minimums where product_id=v_old)
    or exists(select 1 from public.supply_requests where product_id=v_old)
    or exists(select 1 from public.product_deletion_requests where product_id=v_old)
    or exists(select 1 from public.purchase_items where product_id=v_old)
    or exists(select 1 from public.product_presentations where product_id=v_target) then
    raise exception 'Cambió una referencia del catálogo WST. Revisar antes de unificar.';
  end if;
  if (select count(*) from public.movement_lines l join public.movements m on m.id=l.movement_id where l.product_id=v_old and m.status<>'cancelled')<>1 then
    raise exception 'El WST inicial tiene movimientos adicionales. Revisar sus conversiones.';
  end if;
  select l.*,m.warehouse_to_id into strict v_open from public.movement_lines l join public.movements m on m.id=l.movement_id
    where l.product_id=v_old and m.type='initial' and m.status='confirmed';
  select l.*,m.warehouse_to_id into strict v_entry from public.purchase_receipts r join public.movements m on m.id=r.movement_id
    join public.movement_lines l on l.movement_id=m.id
    where r.purchase_id=v_purchase.purchase_id and r.voided_at is null and l.product_id=v_target and m.status='confirmed';
  if v_open.unit<>'unidad' or v_entry.unit<>'unidad' or v_open.factor_to_base<>15 or v_entry.factor_to_base<>15
     or v_open.warehouse_to_id<>v_entry.warehouse_to_id or v_entry.quantity<>v_purchase.received_qty
     or v_purchase.received_qty<>v_purchase.quantity or v_purchase.factor_to_base<>15 then
    raise exception 'La presentación o la recepción WST cambió. No se convierte automáticamente.';
  end if;
  if exists(select 1 from public.inventory_batches b where b.source_line_id in (v_open.id,v_entry.id)
       and (b.quantity_remaining<>b.quantity_received or b.quantity_received<>15*(case when b.source_line_id=v_open.id then v_open.quantity else v_entry.quantity end)))
    or exists(select 1 from public.batch_allocations a join public.inventory_batches b on b.id=a.batch_id where b.source_line_id in (v_open.id,v_entry.id))
    or (select count(*) from public.inventory_batches where source_line_id in (v_open.id,v_entry.id))<>2 then
    raise exception 'Ya hubo consumo o cambios de lote. Revisar la recepción WST antes de convertir.';
  end if;
  select jsonb_build_object(
    'products',(select jsonb_agg(to_jsonb(p)) from public.products p where id in (v_old,v_target)),
    'presentations',(select jsonb_agg(to_jsonb(p)) from public.product_presentations p where product_id in (v_old,v_target)),
    'lines',(select jsonb_agg(to_jsonb(l)) from public.movement_lines l where product_id in (v_old,v_target)),
    'batches',(select jsonb_agg(to_jsonb(b)) from public.inventory_batches b where product_id in (v_old,v_target)),
    'purchase_item',to_jsonb(v_purchase)) into v_before;
  select sum(quantity_remaining*unit_cost) into v_old_value from public.inventory_batches where source_line_id in (v_open.id,v_entry.id);
  update public.movement_lines set product_id=v_target,factor_to_base=1,presentation_label='Rollo 15 kg'
    where id in (v_open.id,v_entry.id);
  update public.inventory_batches set product_id=v_target,quantity_received=quantity_received/15,
    quantity_remaining=quantity_remaining/15,unit_cost=unit_cost*15 where source_line_id in (v_open.id,v_entry.id);
  update public.purchase_items set factor_to_base=1 where id=v_purchase.id;
  update public.product_presentations set product_id=v_target,factor_to_base=factor_to_base/15 where product_id=v_old;
  if not exists(select 1 from public.product_presentations where product_id=v_target and unit='rollo' and factor_to_base=1) then
    insert into public.product_presentations(product_id,label,unit,factor_to_base) values(v_target,'Rollo 15 kg','rollo',1);
  end if;
  update public.products set active=false where id=v_old;
  select sum(quantity_remaining*unit_cost) into v_new_value from public.inventory_batches where source_line_id in (v_open.id,v_entry.id);
  if v_old_value is distinct from v_new_value then raise exception 'La conversión alteraría la valorización del stock.'; end if;
  if (select sum(quantity_remaining) from public.inventory_batches where source_line_id in (v_open.id,v_entry.id))<>v_open.quantity+v_entry.quantity then
    raise exception 'La conversión no conserva la cantidad física de rollos.';
  end if;
  select jsonb_build_object(
    'products',(select jsonb_agg(to_jsonb(p)) from public.products p where id in (v_old,v_target)),
    'presentations',(select jsonb_agg(to_jsonb(p)) from public.product_presentations p where product_id=v_target),
    'lines',(select jsonb_agg(to_jsonb(l)) from public.movement_lines l where id in (v_open.id,v_entry.id)),
    'batches',(select jsonb_agg(to_jsonb(b)) from public.inventory_batches b where source_line_id in (v_open.id,v_entry.id)),
    'purchase_item',(select to_jsonb(pi) from public.purchase_items pi where id=v_purchase.id)) into v_after;
  insert into public.audit_events(entity_type,entity_id,action,actor_id,warehouse_id,purchase_id,detail)
    values('product',v_target,'wst_inventory_unified_in_units',v_actor,v_entry.warehouse_to_id,v_purchase.purchase_id,
      jsonb_build_object('operation','wst_units_20261019','request','Contar en unidades; unificar el mismo alambre y corregir la recepción',
        'source_product_id',v_old,'target_product_id',v_target,'stock_unit','unidad','kg_per_unit',15,
        'opening_units',v_open.quantity,'received_units',v_entry.quantity,'total_units',v_open.quantity+v_entry.quantity,
        'stock_value_before',v_old_value,'stock_value_after',v_new_value,'before',v_before,'after',v_after));
end $unify_wst$;
