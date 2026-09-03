-- AVH — Endurece permisos del flujo IA de compras.
-- El view usa las políticas RLS del usuario que consulta y los RPC nuevos no son públicos.

alter view public.v_purchase_overview set (security_invoker = true);

revoke execute on function public.admin_prepare_purchase_order(uuid) from public, anon;
revoke execute on function public.admin_create_purchase_from_quote(jsonb,jsonb) from public, anon;
revoke execute on function public.admin_confirm_purchase(uuid) from public, anon;

grant execute on function public.admin_prepare_purchase_order(uuid) to authenticated;
grant execute on function public.admin_create_purchase_from_quote(jsonb,jsonb) to authenticated;
grant execute on function public.admin_confirm_purchase(uuid) to authenticated;
