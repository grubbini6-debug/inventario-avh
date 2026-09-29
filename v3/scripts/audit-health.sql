-- AVH V3 — auditoría de salud operativa (SOLO LECTURA)
-- No modifica datos. Puede ejecutarse periódicamente para detectar deriva.

-- 1) Saldos físicamente imposibles.
select 'negative_or_overdrawn_batches' as check_name, count(*) as issues
from public.inventory_batches
where quantity_remaining < 0 or quantity_remaining > quantity_received;

-- 2) Lotes activos cuyo saldo no reconcilia con consumos no anulados.
select 'active_batch_balance_mismatch' as check_name, count(*) as issues
from (
  select b.id
  from public.inventory_batches b
  join public.movement_lines src_ml on src_ml.id=b.source_line_id
  join public.movements src_m on src_m.id=src_ml.movement_id
  left join public.batch_allocations ba on ba.batch_id=b.id
  left join public.movement_lines use_ml on use_ml.id=ba.movement_line_id
  left join public.movements use_m on use_m.id=use_ml.movement_id
  where src_m.status<>'cancelled'
  group by b.id,b.quantity_received,b.quantity_remaining
  having abs(
    (b.quantity_received-b.quantity_remaining)
    - coalesce(sum(ba.quantity) filter (where use_m.status<>'cancelled'),0)
  ) > 0.000001
) q;

-- 3) Stock abierto sin valorizar, discriminando inventario inicial todavía abierto.
select
  case
    when src_m.type='initial' and oi.status='open' then 'opening_inventory_pending_price'
    else 'unexpected_unvalued_stock'
  end as category,
  count(*) as batches
from public.inventory_batches b
join public.movement_lines ml on ml.id=b.source_line_id
join public.movements src_m on src_m.id=ml.movement_id
left join public.warehouse_opening_inventory oi on oi.id=src_m.opening_session_id
where b.quantity_remaining>0
  and b.unit_cost is null
  and src_m.status<>'cancelled'
group by 1;

-- 4) Movimientos sin detalle.
select 'movements_without_lines' as check_name,count(*) as issues
from public.movements m
where m.status<>'cancelled'
  and not exists(select 1 from public.movement_lines ml where ml.movement_id=m.id);

-- 5) Recepciones que exceden la compra.
select 'purchase_items_over_received' as check_name,count(*) as issues
from public.purchase_items
where received_qty<0 or received_qty>quantity;

-- 6) Estado de compra incompatible con cantidades recibidas.
select 'purchase_status_mismatch' as check_name,count(*) as issues
from public.purchases p
where
  (
    p.status='received'
    and exists(
      select 1 from public.purchase_items pi
      where pi.purchase_id=p.id and pi.received_qty<pi.quantity
    )
  )
  or
  (
    p.status='partially_received'
    and not exists(
      select 1 from public.purchase_items pi
      where pi.purchase_id=p.id and pi.received_qty>0 and pi.received_qty<pi.quantity
    )
    and not (
      exists(select 1 from public.purchase_items pi where pi.purchase_id=p.id and pi.received_qty>0)
      and exists(select 1 from public.purchase_items pi where pi.purchase_id=p.id and pi.received_qty<pi.quantity)
    )
  );

-- 7) Transferencias todavía en tránsito.
select
  m.id,m.movement_no,m.warehouse_from_id,m.warehouse_to_id,m.created_at,
  now()-m.created_at as age
from public.movements m
where m.type='transfer' and m.status='in_transit'
order by m.created_at;

-- 8) Documentos huérfanos.
select 'purchase_documents_without_purchase' as check_name,count(*) as issues
from public.purchase_documents d
where not exists(select 1 from public.purchases p where p.id=d.purchase_id);

-- 9) Duplicados de catálogo activos.
select 'duplicate_active_product_names' as check_name,count(*) as issues
from (
  select lower(trim(name))
  from public.products
  where active
  group by 1
  having count(*)>1
) q;

-- 10) Correcciones y anulaciones para revisión administrativa.
select
  count(*) filter(where status='cancelled') as cancelled_movements,
  count(*) filter(where type='correction') as correction_movements,
  count(*) filter(where corrected_movement_id is not null) as linked_corrections
from public.movements;
