-- AVH — Presupuesto IA -> Orden de Compra -> Confirmación de compra.

alter table public.purchase_companies
  add column if not exists legal_name text,
  add column if not exists tax_id text,
  add column if not exists address text,
  add column if not exists phone text,
  add column if not exists email text,
  add column if not exists po_prefix text default 'OC';

update public.purchase_companies set legal_name='Astillero Villa Hayes S.A.',tax_id='80091371-0',address='Mariscal Francisco Solano López, Villa Hayes 150405',phone='0971800829',email='gortega@astillerovh.com' where name='Astillero Villa Hayes';
update public.purchase_companies set legal_name='MAQMOVEIS PARAGUAY SOCIEDAD ANONIMA',tax_id='80102016-6',address='Avenida Mcal. José F. Estigarribia 1460' where name='MAQMOVEIS';
update public.purchase_companies set address='Avenida Mcal. José F. Estigarribia 1460' where name='ACOMAR';

alter table public.purchases
  add column if not exists po_number text,
  add column if not exists po_generated_at timestamptz,
  add column if not exists purchase_confirmed_at timestamptz,
  add column if not exists source_document_number text,
  add column if not exists source_document_date date,
  add column if not exists source_document_kind text;

create unique index if not exists purchases_po_number_uidx on public.purchases(po_number) where po_number is not null;
create sequence if not exists public.purchase_order_seq start with 1 increment by 1;

create or replace function public.admin_prepare_purchase_order(p_purchase_id uuid)
returns text
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_purchase public.purchases%rowtype;
  v_prefix text;
  v_number text;
begin
  if public.current_profile_role()<>'admin' then raise exception 'Solo el administrador puede generar órdenes de compra.'; end if;
  select * into v_purchase from public.purchases where id=p_purchase_id for update;
  if not found then raise exception 'Compra inexistente.'; end if;
  if v_purchase.po_number is not null then return v_purchase.po_number; end if;
  if v_purchase.status in ('cancelled','partially_received','received','invoiced','closed') then raise exception 'El estado actual no permite generar una OC.'; end if;
  select coalesce(nullif(po_prefix,''),'OC') into v_prefix from public.purchase_companies where id=v_purchase.company_id;
  v_number:=v_prefix||'-'||extract(year from current_date)::int||'-'||lpad(nextval('public.purchase_order_seq')::text,5,'0');
  update public.purchases
     set po_number=v_number,
         po_generated_at=now(),
         status=case when status in ('draft','requested','quoted') then 'approved' else status end,
         updated_at=now()
   where id=p_purchase_id;
  insert into public.audit_events(entity_type,entity_id,purchase_id,action,actor_id,detail)
  values('purchase',p_purchase_id,p_purchase_id,'purchase_order_generated',auth.uid(),jsonb_build_object('po_number',v_number));
  return v_number;
end$$;

create or replace function public.admin_create_purchase_from_quote(p_data jsonb,p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_id uuid;
  v_po text;
  v_data jsonb;
begin
  if public.current_profile_role()<>'admin' then raise exception 'Solo el administrador puede crear compras.'; end if;
  v_data:=coalesce(p_data,'{}'::jsonb)||jsonb_build_object('status','approved');
  v_id:=public.admin_create_purchase(v_data,p_items);
  update public.purchases
     set source_document_number=nullif(p_data->>'source_document_number',''),
         source_document_date=nullif(p_data->>'source_document_date','')::date,
         source_document_kind=nullif(p_data->>'source_document_kind',''),
         updated_at=now()
   where id=v_id;
  v_po:=public.admin_prepare_purchase_order(v_id);
  return jsonb_build_object('purchase_id',v_id,'po_number',v_po);
end$$;

create or replace function public.admin_confirm_purchase(p_purchase_id uuid)
returns void
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_purchase public.purchases%rowtype;
begin
  if public.current_profile_role()<>'admin' then raise exception 'Solo el administrador puede confirmar compras.'; end if;
  select * into v_purchase from public.purchases where id=p_purchase_id for update;
  if not found then raise exception 'Compra inexistente.'; end if;
  if v_purchase.po_number is null then raise exception 'Primero generá la Orden de Compra.'; end if;
  if v_purchase.status='cancelled' then raise exception 'La compra está cancelada.'; end if;
  if v_purchase.status in ('partially_received','received','invoiced','closed') then raise exception 'La compra ya avanzó a recepción/facturación.'; end if;
  if v_purchase.status='ordered' and v_purchase.purchase_confirmed_at is not null then return; end if;
  update public.purchases set status='ordered',ordered_date=current_date,purchase_confirmed_at=coalesce(purchase_confirmed_at,now()),updated_at=now() where id=p_purchase_id;
  insert into public.audit_events(entity_type,entity_id,purchase_id,action,actor_id,detail)
  values('purchase',p_purchase_id,p_purchase_id,'purchase_confirmed',auth.uid(),jsonb_build_object('po_number',v_purchase.po_number));
end$$;

grant execute on function public.admin_prepare_purchase_order(uuid) to authenticated;
grant execute on function public.admin_create_purchase_from_quote(jsonb,jsonb) to authenticated;
grant execute on function public.admin_confirm_purchase(uuid) to authenticated;

create or replace view public.v_purchase_overview as
select p.id,p.company_id,c.name as company_name,p.supplier_id,s.name as supplier_name,p.purchase_type,p.status,p.urgency,p.destination_type,p.warehouse_id,w.name as warehouse_name,p.barge_id,b.number as barge_number,p.contractor_id,ct.name as contractor_name,p.destination_text,p.requester,p.sector,p.currency,p.exchange_rate,p.payment_method,p.payment_terms,p.order_reference,p.ordered_date,p.expected_date,p.invoice_number,p.invoice_date,p.notes,p.created_by,p.created_at,p.updated_at,
  coalesce(sum(pi.quantity*pi.unit_price),0::numeric) as total_amount,
  coalesce(sum(pi.received_qty*pi.unit_price),0::numeric) as received_amount,
  coalesce(sum(pi.quantity),0::numeric) as item_units,
  coalesce(sum(pi.received_qty),0::numeric) as received_units,
  count(pi.id)::integer as item_count,
  p.po_number,p.po_generated_at,p.purchase_confirmed_at,p.source_document_number,p.source_document_date,p.source_document_kind
from public.purchases p
join public.purchase_companies c on c.id=p.company_id
left join public.suppliers s on s.id=p.supplier_id
left join public.warehouses w on w.id=p.warehouse_id
left join public.barges b on b.id=p.barge_id
left join public.contractors ct on ct.id=p.contractor_id
left join public.purchase_items pi on pi.purchase_id=p.id
group by p.id,c.name,s.name,w.name,b.number,ct.name;
