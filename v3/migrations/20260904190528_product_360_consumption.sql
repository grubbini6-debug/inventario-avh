-- Ficha 360° del producto: consumo exacto en ventanas 30/60/90 días.
create or replace view public.v_product_360_consumption
with (security_invoker = true)
as
select
  ml.product_id,
  p.name as product_name,
  p.base_unit,
  coalesce(sum(ml.base_quantity) filter (where m.created_at >= now() - interval '30 days'),0)::numeric(18,6) as qty_30d,
  coalesce(sum(ml.base_quantity) filter (where m.created_at >= now() - interval '60 days'),0)::numeric(18,6) as qty_60d,
  coalesce(sum(ml.base_quantity) filter (where m.created_at >= now() - interval '90 days'),0)::numeric(18,6) as qty_90d,
  count(distinct m.id) filter (where m.created_at >= now() - interval '30 days')::integer as exits_30d,
  count(distinct m.id) filter (where m.created_at >= now() - interval '60 days')::integer as exits_60d,
  count(distinct m.id) filter (where m.created_at >= now() - interval '90 days')::integer as exits_90d,
  max(m.created_at) as last_exit_at
from public.movements m
join public.movement_lines ml on ml.movement_id=m.id
join public.products p on p.id=ml.product_id
where m.type='exit'
  and m.status='confirmed'
group by ml.product_id,p.name,p.base_unit;

grant select on public.v_product_360_consumption to authenticated;
revoke all on public.v_product_360_consumption from anon;
