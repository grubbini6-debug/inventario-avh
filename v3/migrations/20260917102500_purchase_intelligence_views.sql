-- AVH · Inteligencia de Compras / capa BI
-- Vistas de solo lectura para el dashboard interno y futura conexión Power BI.
-- Todas respetan RLS de las tablas base mediante security_invoker.

create or replace view public.bi_purchase_facts
with (security_invoker = true)
as
with item_totals as (
  select
    pi.purchase_id,
    count(*)::int as item_count,
    count(*) filter (where pi.received_qty >= pi.quantity)::int as completed_item_count,
    coalesce(sum(pi.quantity * pi.unit_price), 0)::numeric as total_amount,
    coalesce(sum(pi.received_qty * pi.unit_price), 0)::numeric as received_amount,
    coalesce(sum(greatest(pi.quantity - pi.received_qty, 0) * pi.unit_price), 0)::numeric as pending_amount
  from public.purchase_items pi
  group by pi.purchase_id
), receipt_summary as (
  select
    pr.purchase_id,
    min(pr.received_at) as first_received_at,
    max(pr.received_at) as last_received_at,
    count(*)::int as receipt_count
  from public.purchase_receipts pr
  group by pr.purchase_id
)
select
  p.id as purchase_id,
  p.ordered_date,
  date_trunc('month', p.ordered_date)::date as ordered_month,
  p.company_id,
  c.name as company_name,
  p.supplier_id,
  s.name as supplier_name,
  p.warehouse_id,
  w.name as warehouse_name,
  p.barge_id,
  b.number as barge_number,
  p.purchase_type,
  p.status,
  p.urgency,
  p.destination_type,
  p.destination_text,
  p.currency,
  p.exchange_rate,
  p.payment_method,
  p.payment_terms,
  p.expected_date,
  p.delivery_mode,
  p.order_reference,
  p.po_number,
  p.invoice_number,
  p.requester,
  p.sector,
  p.created_at,
  p.updated_at,
  coalesce(it.item_count, 0) as item_count,
  coalesce(it.completed_item_count, 0) as completed_item_count,
  coalesce(it.total_amount, 0) as total_amount,
  coalesce(it.received_amount, 0) as received_amount,
  coalesce(it.pending_amount, 0) as pending_amount,
  case
    when coalesce(it.total_amount, 0) > 0
      then round(it.received_amount / it.total_amount * 100, 1)
    else 0
  end as value_received_pct,
  rs.first_received_at,
  rs.last_received_at,
  coalesce(rs.receipt_count, 0) as receipt_count,
  (
    p.destination_type = 'warehouse'
    and coalesce(it.item_count, 0) > 0
    and it.completed_item_count = it.item_count
  ) as is_complete_receipt,
  (
    p.destination_type = 'warehouse'
    and coalesce(it.item_count, 0) > 0
    and it.completed_item_count < it.item_count
    and p.status in ('ordered', 'in_transit', 'partially_received')
  ) as is_pending_receipt,
  case
    when rs.first_received_at is not null
      then rs.first_received_at::date - p.ordered_date
    else null
  end as days_to_first_receipt,
  case
    when p.destination_type = 'warehouse'
      and coalesce(it.item_count, 0) > 0
      and it.completed_item_count = it.item_count
      and rs.last_received_at is not null
      then rs.last_received_at::date - p.ordered_date
    else null
  end as days_to_complete,
  case
    when p.destination_type = 'warehouse'
      and coalesce(it.item_count, 0) > 0
      and it.completed_item_count = it.item_count
      and p.expected_date is not null
      and rs.last_received_at is not null
      then rs.last_received_at::date <= p.expected_date
    else null
  end as completed_on_time,
  case
    when p.destination_type = 'warehouse'
      and coalesce(it.item_count, 0) > 0
      and it.completed_item_count < it.item_count
      and p.expected_date is not null
      and p.expected_date < current_date
      then current_date - p.expected_date
    else 0
  end as days_late_open
from public.purchases p
join public.purchase_companies c on c.id = p.company_id
left join public.suppliers s on s.id = p.supplier_id
left join public.warehouses w on w.id = p.warehouse_id
left join public.barges b on b.id = p.barge_id
left join item_totals it on it.purchase_id = p.id
left join receipt_summary rs on rs.purchase_id = p.id;

comment on view public.bi_purchase_facts is
'Una fila por compra. Montos siempre permanecen en la moneda original de la compra. Entrega a tiempo solo se calcula para compras de depósito completadas con fecha comprometida.';

create or replace view public.bi_purchase_item_facts
with (security_invoker = true)
as
select
  pi.id as purchase_item_id,
  p.id as purchase_id,
  p.ordered_date,
  date_trunc('month', p.ordered_date)::date as ordered_month,
  p.company_id,
  c.name as company_name,
  p.supplier_id,
  s.name as supplier_name,
  p.warehouse_id,
  w.name as warehouse_name,
  p.purchase_type,
  p.status,
  p.urgency,
  p.destination_type,
  p.currency,
  p.expected_date,
  p.delivery_mode,
  p.order_reference,
  p.po_number,
  pi.product_id,
  pr.name as product_name,
  pr.base_unit,
  pi.description,
  pi.unit,
  pi.factor_to_base,
  pi.quantity,
  pi.received_qty,
  greatest(pi.quantity - pi.received_qty, 0) as pending_qty,
  (pi.quantity * pi.factor_to_base)::numeric as ordered_base_qty,
  (pi.received_qty * pi.factor_to_base)::numeric as received_base_qty,
  (greatest(pi.quantity - pi.received_qty, 0) * pi.factor_to_base)::numeric as pending_base_qty,
  pi.unit_price,
  case when pi.factor_to_base > 0 then (pi.unit_price / pi.factor_to_base)::numeric else null end as unit_price_base,
  (pi.quantity * pi.unit_price)::numeric as line_total,
  (pi.received_qty * pi.unit_price)::numeric as received_amount,
  (greatest(pi.quantity - pi.received_qty, 0) * pi.unit_price)::numeric as pending_amount,
  pi.affects_inventory,
  pi.created_at
from public.purchase_items pi
join public.purchases p on p.id = pi.purchase_id
join public.purchase_companies c on c.id = p.company_id
left join public.suppliers s on s.id = p.supplier_id
left join public.warehouses w on w.id = p.warehouse_id
left join public.products pr on pr.id = pi.product_id;

comment on view public.bi_purchase_item_facts is
'Una fila por ítem comprado. unit_price_base normaliza el precio a la unidad base mediante factor_to_base y permite comparar históricos del mismo producto y moneda.';

create or replace view public.bi_purchase_monthly
with (security_invoker = true)
as
select
  f.ordered_month,
  f.currency,
  count(*) filter (where f.status <> 'cancelled')::int as purchase_count,
  count(*) filter (where f.status <> 'cancelled' and f.urgency in ('urgent', 'critical'))::int as urgent_purchase_count,
  count(*) filter (where f.status <> 'cancelled' and f.is_pending_receipt)::int as pending_receipt_count,
  count(*) filter (where f.status <> 'cancelled' and f.days_late_open > 0)::int as late_open_count,
  coalesce(sum(f.total_amount) filter (where f.status <> 'cancelled'), 0)::numeric as ordered_amount,
  coalesce(sum(f.received_amount) filter (where f.status <> 'cancelled'), 0)::numeric as received_amount,
  coalesce(sum(f.pending_amount) filter (where f.status <> 'cancelled'), 0)::numeric as pending_amount
from public.bi_purchase_facts f
group by f.ordered_month, f.currency;

comment on view public.bi_purchase_monthly is
'Resumen mensual por moneda. No mezcla PYG y USD en una misma cifra monetaria.';

create or replace view public.bi_supplier_performance
with (security_invoker = true)
as
select
  f.supplier_id,
  coalesce(f.supplier_name, 'Sin proveedor') as supplier_name,
  count(*) filter (where f.status <> 'cancelled')::int as purchase_count,
  count(*) filter (where f.status <> 'cancelled' and f.destination_type = 'warehouse')::int as warehouse_purchase_count,
  count(*) filter (where f.status <> 'cancelled' and f.is_complete_receipt)::int as completed_purchase_count,
  count(*) filter (where f.status <> 'cancelled' and f.is_complete_receipt and f.expected_date is not null)::int as completed_with_promise_count,
  count(*) filter (where f.status <> 'cancelled' and f.completed_on_time is true)::int as on_time_completed_count,
  case
    when count(*) filter (where f.status <> 'cancelled' and f.is_complete_receipt and f.expected_date is not null) > 0
      then round(
        count(*) filter (where f.status <> 'cancelled' and f.completed_on_time is true)::numeric
        / count(*) filter (where f.status <> 'cancelled' and f.is_complete_receipt and f.expected_date is not null)::numeric
        * 100,
        1
      )
    else null
  end as on_time_rate_pct,
  round(avg(f.days_to_complete) filter (where f.status <> 'cancelled' and f.days_to_complete is not null), 1) as avg_lead_time_days,
  count(*) filter (where f.status <> 'cancelled' and f.days_late_open > 0)::int as late_open_count,
  max(f.ordered_date) filter (where f.status <> 'cancelled') as last_order_date,
  coalesce(sum(f.total_amount) filter (where f.status <> 'cancelled' and f.currency = 'PYG'), 0)::numeric as ordered_amount_pyg,
  coalesce(sum(f.total_amount) filter (where f.status <> 'cancelled' and f.currency = 'USD'), 0)::numeric as ordered_amount_usd,
  coalesce(sum(f.pending_amount) filter (where f.status <> 'cancelled' and f.currency = 'PYG'), 0)::numeric as pending_amount_pyg,
  coalesce(sum(f.pending_amount) filter (where f.status <> 'cancelled' and f.currency = 'USD'), 0)::numeric as pending_amount_usd
from public.bi_purchase_facts f
group by f.supplier_id, f.supplier_name;

comment on view public.bi_supplier_performance is
'Resumen de desempeño por proveedor. on_time_rate_pct usa solo compras de depósito completadas que tenían expected_date.';

revoke all on public.bi_purchase_facts from anon, authenticated;
revoke all on public.bi_purchase_item_facts from anon, authenticated;
revoke all on public.bi_purchase_monthly from anon, authenticated;
revoke all on public.bi_supplier_performance from anon, authenticated;

grant select on public.bi_purchase_facts to authenticated, service_role;
grant select on public.bi_purchase_item_facts to authenticated, service_role;
grant select on public.bi_purchase_monthly to authenticated, service_role;
grant select on public.bi_supplier_performance to authenticated, service_role;
