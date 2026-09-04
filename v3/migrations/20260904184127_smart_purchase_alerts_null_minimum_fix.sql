-- Alertas inteligentes de abastecimiento AVH
-- Combina stock, consumo 30d, compras pendientes y fecha prometida.
create or replace view public.v_smart_stock_alerts
with (security_invoker = true)
as
with usage30 as (
  select m.warehouse_from_id as warehouse_id, ml.product_id,
         sum(ml.base_quantity) as qty_30d,
         count(distinct m.id) as exit_count_30d,
         max(m.created_at) as last_exit_at
  from public.movements m
  join public.movement_lines ml on ml.movement_id=m.id
  where m.type='exit' and m.status='confirmed'
    and m.created_at >= now() - interval '30 days'
  group by m.warehouse_from_id, ml.product_id
),
pending_rows as (
  select p.warehouse_id, pi.product_id, p.id as purchase_id,
         p.po_number, p.order_reference, p.expected_date, p.ordered_date, p.created_at,
         s.name as supplier_name,
         greatest(pi.quantity-coalesce(pi.received_qty,0),0) * coalesce(pi.factor_to_base,1) as pending_base_qty
  from public.purchases p
  join public.purchase_items pi on pi.purchase_id=p.id
  left join public.suppliers s on s.id=p.supplier_id
  where p.destination_type='warehouse'
    and p.status in ('ordered','in_transit','partially_received')
    and pi.affects_inventory=true
    and pi.product_id is not null
    and greatest(pi.quantity-coalesce(pi.received_qty,0),0) > 0
),
inbound as (
  select warehouse_id, product_id,
         sum(pending_base_qty) as inbound_qty,
         count(distinct purchase_id)::integer as pending_purchase_count,
         min(expected_date) filter (where expected_date is not null) as next_expected_date,
         sum(pending_base_qty) filter (where expected_date < current_date) as overdue_inbound_qty,
         (array_agg(supplier_name order by (expected_date is null), expected_date, ordered_date nulls last, created_at))[1] as next_supplier_name,
         (array_agg(coalesce(po_number,order_reference) order by (expected_date is null), expected_date, ordered_date nulls last, created_at))[1] as next_order_reference
  from pending_rows
  group by warehouse_id, product_id
),
base as (
  select s.warehouse_id, s.warehouse_name, s.product_id, s.product_name, s.base_unit,
         s.minimum_qty, s.stock_qty, s.is_critical,
         coalesce(u.qty_30d,0::numeric) as qty_30d,
         coalesce(u.exit_count_30d,0::bigint) as exit_count_30d,
         u.last_exit_at,
         coalesce(u.qty_30d,0::numeric)/30.0 as avg_daily_30d,
         coalesce(i.inbound_qty,0::numeric) as inbound_qty,
         coalesce(i.pending_purchase_count,0) as pending_purchase_count,
         i.next_expected_date,
         coalesce(i.overdue_inbound_qty,0::numeric) as overdue_inbound_qty,
         i.next_supplier_name,
         i.next_order_reference
  from public.v_stock_status s
  left join usage30 u on u.warehouse_id=s.warehouse_id and u.product_id=s.product_id
  left join inbound i on i.warehouse_id=s.warehouse_id and i.product_id=s.product_id
),
calc as (
  select b.*,
         case when avg_daily_30d>0 then round(stock_qty/avg_daily_30d,1) end as coverage_days,
         case when next_expected_date is not null then next_expected_date-current_date end as days_to_next_receipt,
         case when avg_daily_30d>0 and next_expected_date is not null
              then round(stock_qty - avg_daily_30d*greatest(next_expected_date-current_date,0),2) end as projected_stock_before_receipt,
         case when avg_daily_30d>0 then round((stock_qty+inbound_qty)/avg_daily_30d,1) end as coverage_with_inbound_days,
         case when avg_daily_30d>0 then current_date + ceil(stock_qty/avg_daily_30d)::integer end as projected_stockout_date,
         round(greatest(avg_daily_30d*14 + coalesce(minimum_qty,0) - stock_qty - inbound_qty,0),2) as recommended_buy_qty
  from base b
)
select warehouse_id, warehouse_name, product_id, product_name, base_unit,
       minimum_qty, stock_qty, is_critical, qty_30d, exit_count_30d, last_exit_at,
       avg_daily_30d, coverage_days,
       case
         when minimum_qty is not null and stock_qty<=minimum_qty then 'critical'
         when avg_daily_30d>0 and coverage_days<=3 then 'critical'
         when next_expected_date is not null and next_expected_date>current_date and projected_stock_before_receipt<0 then 'critical'
         when overdue_inbound_qty>0 and avg_daily_30d>0 and coverage_days<=7 then 'critical'
         when avg_daily_30d>0 and coverage_days<=7 then 'low'
         when overdue_inbound_qty>0 then 'low'
         when recommended_buy_qty>0 then 'low'
         else 'normal'
       end as alert_level,
       inbound_qty, pending_purchase_count, next_expected_date, days_to_next_receipt,
       projected_stock_before_receipt, coverage_with_inbound_days, projected_stockout_date,
       overdue_inbound_qty, next_supplier_name, next_order_reference, recommended_buy_qty,
       case
         when minimum_qty is not null and stock_qty<=minimum_qty then 'Stock igual o debajo del mínimo'
         when avg_daily_30d>0 and coverage_days<=3 then 'Cobertura de 3 días o menos'
         when next_expected_date is not null and next_expected_date>current_date and projected_stock_before_receipt<0 then 'El stock se agotaría antes de la próxima recepción'
         when overdue_inbound_qty>0 and avg_daily_30d>0 and coverage_days<=7 then 'Compra atrasada y cobertura corta'
         when avg_daily_30d>0 and coverage_days<=7 then 'Cobertura de 7 días o menos'
         when overdue_inbound_qty>0 then 'Hay mercadería pendiente con fecha vencida'
         when recommended_buy_qty>0 then 'Conviene reponer para recuperar cobertura'
         else 'Cobertura normal'
       end as risk_reason
from calc;
