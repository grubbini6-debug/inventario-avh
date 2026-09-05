alter table public.stock_minimums
  add column if not exists safety_stock_qty numeric not null default 0,
  add column if not exists target_coverage_days numeric not null default 14,
  add column if not exists lead_time_days integer not null default 0,
  add column if not exists min_order_qty numeric not null default 0,
  add column if not exists order_multiple_qty numeric,
  add column if not exists preferred_supplier_id uuid references public.suppliers(id) on delete set null,
  add column if not exists criticality text not null default 'normal',
  add column if not exists policy_active boolean not null default true,
  add column if not exists policy_notes text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='stock_minimums_safety_stock_qty_check') then alter table public.stock_minimums add constraint stock_minimums_safety_stock_qty_check check (safety_stock_qty >= 0); end if;
  if not exists (select 1 from pg_constraint where conname='stock_minimums_target_coverage_days_check') then alter table public.stock_minimums add constraint stock_minimums_target_coverage_days_check check (target_coverage_days >= 0); end if;
  if not exists (select 1 from pg_constraint where conname='stock_minimums_lead_time_days_check') then alter table public.stock_minimums add constraint stock_minimums_lead_time_days_check check (lead_time_days >= 0); end if;
  if not exists (select 1 from pg_constraint where conname='stock_minimums_min_order_qty_check') then alter table public.stock_minimums add constraint stock_minimums_min_order_qty_check check (min_order_qty >= 0); end if;
  if not exists (select 1 from pg_constraint where conname='stock_minimums_order_multiple_qty_check') then alter table public.stock_minimums add constraint stock_minimums_order_multiple_qty_check check (order_multiple_qty is null or order_multiple_qty > 0); end if;
  if not exists (select 1 from pg_constraint where conname='stock_minimums_criticality_check') then alter table public.stock_minimums add constraint stock_minimums_criticality_check check (criticality = any(array['normal'::text,'important'::text,'critical'::text])); end if;
end $$;

create index if not exists stock_minimums_preferred_supplier_idx
  on public.stock_minimums(preferred_supplier_id)
  where preferred_supplier_id is not null;

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
  where m.type='exit' and m.status='confirmed' and m.created_at>=now()-interval '30 days'
  group by m.warehouse_from_id,ml.product_id
),
stock as (
  select warehouse_id,product_id,sum(quantity_remaining)::numeric(18,6) as stock_qty
  from public.inventory_batches
  where quantity_remaining>0
  group by warehouse_id,product_id
),
pending_rows as (
  select p.warehouse_id,pi.product_id,p.id as purchase_id,p.po_number,p.order_reference,p.expected_date,p.ordered_date,p.created_at,
    s.name as supplier_name,
    greatest(pi.quantity-coalesce(pi.received_qty,0),0)*coalesce(pi.factor_to_base,1) as pending_base_qty
  from public.purchases p
  join public.purchase_items pi on pi.purchase_id=p.id
  left join public.suppliers s on s.id=p.supplier_id
  where p.destination_type='warehouse'
    and p.status=any(array['ordered'::text,'in_transit'::text,'partially_received'::text])
    and pi.affects_inventory=true
    and pi.product_id is not null
    and greatest(pi.quantity-coalesce(pi.received_qty,0),0)>0
),
inbound as (
  select warehouse_id,product_id,sum(pending_base_qty) as inbound_qty,
    count(distinct purchase_id)::integer as pending_purchase_count,
    min(expected_date) filter(where expected_date is not null) as next_expected_date,
    sum(pending_base_qty) filter(where expected_date<current_date) as overdue_inbound_qty,
    (array_agg(supplier_name order by (expected_date is null),expected_date,ordered_date,created_at))[1] as next_supplier_name,
    (array_agg(coalesce(po_number,order_reference) order by (expected_date is null),expected_date,ordered_date,created_at))[1] as next_order_reference
  from pending_rows
  group by warehouse_id,product_id
),
keys as (
  select warehouse_id,product_id from public.stock_minimums
  union select warehouse_id,product_id from stock
  union select warehouse_id,product_id from usage30
  union select warehouse_id,product_id from inbound
),
base as (
  select k.warehouse_id,w.name as warehouse_name,k.product_id,p.name as product_name,p.base_unit,
    sm.minimum_qty,
    coalesce(sm.safety_stock_qty,0) as safety_stock_qty,
    coalesce(sm.target_coverage_days,14) as target_coverage_days,
    coalesce(sm.lead_time_days,0) as lead_time_days,
    coalesce(sm.min_order_qty,0) as min_order_qty,
    sm.order_multiple_qty,
    sm.preferred_supplier_id,
    ps.name as preferred_supplier_name,
    coalesce(sm.criticality,'normal') as criticality,
    coalesce(sm.policy_active,false) as policy_active,
    sm.policy_notes,
    sm.warehouse_id is not null as policy_configured,
    coalesce(st.stock_qty,0)::numeric(18,6) as stock_qty,
    sm.minimum_qty is not null and coalesce(st.stock_qty,0)<=sm.minimum_qty as is_critical,
    coalesce(u.qty_30d,0) as qty_30d,
    coalesce(u.exit_count_30d,0) as exit_count_30d,
    u.last_exit_at,
    coalesce(u.qty_30d,0)/30.0 as avg_daily_30d,
    coalesce(i.inbound_qty,0) as inbound_qty,
    coalesce(i.pending_purchase_count,0) as pending_purchase_count,
    i.next_expected_date,
    coalesce(i.overdue_inbound_qty,0) as overdue_inbound_qty,
    i.next_supplier_name,i.next_order_reference
  from keys k
  join public.warehouses w on w.id=k.warehouse_id
  join public.products p on p.id=k.product_id
  left join public.stock_minimums sm on sm.warehouse_id=k.warehouse_id and sm.product_id=k.product_id
  left join public.suppliers ps on ps.id=sm.preferred_supplier_id
  left join stock st on st.warehouse_id=k.warehouse_id and st.product_id=k.product_id
  left join usage30 u on u.warehouse_id=k.warehouse_id and u.product_id=k.product_id
  left join inbound i on i.warehouse_id=k.warehouse_id and i.product_id=k.product_id
),
calc as (
  select b.*,
    case when b.avg_daily_30d>0 then round(b.stock_qty/b.avg_daily_30d,1) end as coverage_days,
    case when b.next_expected_date is not null then b.next_expected_date-current_date end as days_to_next_receipt,
    case when b.avg_daily_30d>0 and b.next_expected_date is not null then round(b.stock_qty-b.avg_daily_30d*greatest(b.next_expected_date-current_date,0)::numeric,2) end as projected_stock_before_receipt,
    case when b.avg_daily_30d>0 then round((b.stock_qty+b.inbound_qty)/b.avg_daily_30d,1) end as coverage_with_inbound_days,
    case when b.avg_daily_30d>0 then current_date+ceil(b.stock_qty/b.avg_daily_30d)::integer end as projected_stockout_date,
    greatest(coalesce(b.minimum_qty,0),b.safety_stock_qty) as effective_safety_stock_qty,
    greatest(
      b.avg_daily_30d * case when b.policy_active then b.target_coverage_days else 14 end
      + greatest(coalesce(b.minimum_qty,0),case when b.policy_active then b.safety_stock_qty else 0 end)
      - b.stock_qty-b.inbound_qty,0
    ) as raw_recommended_buy_qty,
    b.avg_daily_30d * case when b.policy_active then b.lead_time_days else 0 end
      + greatest(coalesce(b.minimum_qty,0),case when b.policy_active then b.safety_stock_qty else 0 end) as reorder_point_qty
  from base b
),
rounded as (
  select c.*,
    case
      when c.raw_recommended_buy_qty<=0 then 0::numeric
      when c.policy_active and c.order_multiple_qty is not null then ceil(greatest(c.raw_recommended_buy_qty,c.min_order_qty)/c.order_multiple_qty)*c.order_multiple_qty
      when c.policy_active then greatest(c.raw_recommended_buy_qty,c.min_order_qty)
      else round(c.raw_recommended_buy_qty,2)
    end as recommended_buy_qty
  from calc c
),
final as (
  select r.*,
    case
      when minimum_qty is not null and stock_qty<=minimum_qty then 'critical'
      when avg_daily_30d>0 and coverage_days<=3 then 'critical'
      when policy_active and avg_daily_30d>0 and lead_time_days>0 and coverage_days<=lead_time_days and inbound_qty<=0 then 'critical'
      when next_expected_date is not null and next_expected_date>current_date and projected_stock_before_receipt<effective_safety_stock_qty then 'critical'
      when overdue_inbound_qty>0 and avg_daily_30d>0 and coverage_days<=7 then 'critical'
      when policy_active and avg_daily_30d>0 and coverage_days<=target_coverage_days then 'low'
      when avg_daily_30d>0 and coverage_days<=7 then 'low'
      when overdue_inbound_qty>0 then 'low'
      when recommended_buy_qty>0 then 'low'
      else 'normal'
    end as computed_alert_level,
    case
      when minimum_qty is not null and stock_qty<=minimum_qty then 'Stock igual o debajo del mínimo'
      when avg_daily_30d>0 and coverage_days<=3 then 'Cobertura de 3 días o menos'
      when policy_active and avg_daily_30d>0 and lead_time_days>0 and coverage_days<=lead_time_days and inbound_qty<=0 then 'La cobertura actual no alcanza el lead time de reposición'
      when next_expected_date is not null and next_expected_date>current_date and projected_stock_before_receipt<effective_safety_stock_qty then 'El stock caería debajo del nivel de seguridad antes de la próxima recepción'
      when overdue_inbound_qty>0 and avg_daily_30d>0 and coverage_days<=7 then 'Compra atrasada y cobertura corta'
      when policy_active and avg_daily_30d>0 and coverage_days<=target_coverage_days then 'Cobertura por debajo del objetivo definido'
      when avg_daily_30d>0 and coverage_days<=7 then 'Cobertura de 7 días o menos'
      when overdue_inbound_qty>0 then 'Hay mercadería pendiente con fecha vencida'
      when recommended_buy_qty>0 then 'Conviene reponer para recuperar cobertura'
      else 'Cobertura normal'
    end as computed_risk_reason
  from rounded r
)
select
  warehouse_id,warehouse_name,product_id,product_name,base_unit,minimum_qty,
  stock_qty,is_critical,qty_30d,exit_count_30d,last_exit_at,avg_daily_30d,coverage_days,
  computed_alert_level as alert_level,inbound_qty,pending_purchase_count,next_expected_date,days_to_next_receipt,
  projected_stock_before_receipt,coverage_with_inbound_days,projected_stockout_date,overdue_inbound_qty,
  next_supplier_name,next_order_reference,recommended_buy_qty,computed_risk_reason as risk_reason,
  safety_stock_qty,effective_safety_stock_qty,target_coverage_days,lead_time_days,min_order_qty,order_multiple_qty,
  preferred_supplier_id,preferred_supplier_name,criticality,policy_active,policy_notes,policy_configured,
  reorder_point_qty,raw_recommended_buy_qty
from final;

revoke all on public.v_smart_stock_alerts from anon;
grant select on public.v_smart_stock_alerts to authenticated;
