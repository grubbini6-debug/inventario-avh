create or replace function public.admin_delete_purchase(p_purchase_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_purchase public.purchases%rowtype;
  v_item_count integer;
  v_total numeric;
begin
  if public.current_profile_role() <> 'admin' then
    raise exception 'Solo el administrador puede eliminar compras.';
  end if;

  select * into v_purchase
  from public.purchases
  where id = p_purchase_id
  for update;

  if not found then
    raise exception 'Compra inexistente.';
  end if;

  if exists (
    select 1 from public.purchase_receipts where purchase_id = p_purchase_id
  ) or exists (
    select 1 from public.purchase_items
    where purchase_id = p_purchase_id and coalesce(received_qty, 0) > 0
  ) then
    raise exception 'Esta compra ya tuvo recepción y no se puede eliminar.';
  end if;

  select count(*), coalesce(sum(quantity * unit_price), 0)
    into v_item_count, v_total
  from public.purchase_items
  where purchase_id = p_purchase_id;

  insert into public.audit_events(
    entity_type, entity_id, action, actor_id, purchase_id, detail
  ) values (
    'purchase',
    p_purchase_id,
    'delete',
    auth.uid(),
    p_purchase_id,
    jsonb_build_object(
      'supplier_id', v_purchase.supplier_id,
      'company_id', v_purchase.company_id,
      'reference', v_purchase.order_reference,
      'invoice_number', v_purchase.invoice_number,
      'currency', v_purchase.currency,
      'item_count', v_item_count,
      'total', v_total
    )
  );

  delete from public.purchases where id = p_purchase_id;
end
$function$;

revoke all on function public.admin_delete_purchase(uuid) from public;
revoke all on function public.admin_delete_purchase(uuid) from anon;
grant execute on function public.admin_delete_purchase(uuid) to authenticated;
