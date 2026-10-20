-- A gas can have several cylinder sizes. Keep each presentation in the existing
-- inventory/FIFO and custody circuit, so 20 kg and 50 kg cylinders never mix.
begin;
alter table public.gas_products add column kg_per_cylinder numeric(9,3)
 check(kg_per_cylinder>0 and kg_per_cylinder<=1000 and kg_per_cylinder::text not in ('NaN','Infinity','-Infinity'));
alter table public.gas_products drop constraint gas_products_gas_kind_key;
alter table public.gas_products add constraint gas_products_presentation_key unique nulls not distinct(gas_kind,kg_per_cylinder);
-- Only GLP has an explicitly recorded size. Never guess a weight for CO2/O2.
update public.gas_products set kg_per_cylinder=10 where gas_kind='glp' and product_id in(select id from public.products where sku='GLP-10KG');

create or replace view public.v_gas_stock_status with(security_invoker=true) as
select c.warehouse_id,w.name as warehouse_name,c.product_id,g.gas_kind,g.gas_name,g.sort_order,
 coalesce((select sum(b.quantity_remaining) from public.inventory_batches b where b.warehouse_id=c.warehouse_id and b.product_id=c.product_id),0) as full_qty,
 c.empty_qty,c.version,c.counted_at,c.counted_by,
 coalesce((select sum(h.quantity) from public.gas_custody h where h.warehouse_id=c.warehouse_id and h.product_id=c.product_id and h.location='production'),0) as outside_qty,
 coalesce((select sum(h.quantity) from public.gas_custody h where h.warehouse_id=c.warehouse_id and h.product_id=c.product_id and h.location='supplier'),0) as supplier_qty,
 g.kg_per_cylinder,
 case when g.kg_per_cylinder is not null then g.kg_per_cylinder*coalesce((select sum(b.quantity_remaining) from public.inventory_batches b where b.warehouse_id=c.warehouse_id and b.product_id=c.product_id),0) end as full_kg
from public.gas_controls c join public.gas_products g on g.product_id=c.product_id
join public.warehouses w on w.id=c.warehouse_id join public.products p on p.id=c.product_id where w.active and p.active;
revoke all on public.v_gas_stock_status from public,anon,authenticated;
grant select on public.v_gas_stock_status to authenticated;
commit;
