-- AVH V3 hardening & cleanup
-- Seguridad defensiva + rendimiento de RLS/FK. No modifica datos operativos.

-- El sistema es privado: usuarios sin sesión no necesitan acceso al esquema público.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- SECURITY DEFINER: quitar herencia genérica y acceso anónimo.
-- Los RPC que usa la app conservan sus GRANT explícitos a authenticated/service_role.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosecdef
  loop
    execute format('revoke execute on function %s from public, anon', f.fn);
  end loop;
end $$;

-- Índices faltantes sobre foreign keys detectados por Database Advisor.
create index if not exists correction_requests_reviewed_by_idx
  on public.correction_requests(reviewed_by);
create index if not exists movements_received_by_idx
  on public.movements(received_by);
create index if not exists product_deletion_requests_product_id_idx
  on public.product_deletion_requests(product_id);
create index if not exists product_deletion_requests_requested_by_idx
  on public.product_deletion_requests(requested_by);
create index if not exists product_deletion_requests_reviewed_by_idx
  on public.product_deletion_requests(reviewed_by);
create index if not exists product_requests_requested_by_idx
  on public.product_requests(requested_by);
create index if not exists product_requests_reviewed_by_idx
  on public.product_requests(reviewed_by);
create index if not exists product_requests_warehouse_id_idx
  on public.product_requests(warehouse_id);
create index if not exists products_created_by_idx
  on public.products(created_by);
create index if not exists stock_minimums_updated_by_idx
  on public.stock_minimums(updated_by);
create index if not exists suppliers_created_by_idx
  on public.suppliers(created_by);
create index if not exists supply_requests_product_id_idx
  on public.supply_requests(product_id);
create index if not exists supply_requests_reviewed_by_idx
  on public.supply_requests(reviewed_by);
create index if not exists warehouse_opening_inventory_closed_by_idx
  on public.warehouse_opening_inventory(closed_by);
create index if not exists warehouse_opening_inventory_opened_by_idx
  on public.warehouse_opening_inventory(opened_by);

-- Evitar reevaluar auth.uid() por cada fila en policies.
alter policy corrections_insert on public.correction_requests
  with check (
    requested_by = (select auth.uid())
    and exists (
      select 1 from public.movements m
      where m.id=correction_requests.movement_id
        and (public.can_access_warehouse(m.warehouse_from_id)
          or public.can_access_warehouse(m.warehouse_to_id))
    )
  );

alter policy corrections_read on public.correction_requests
  using (
    requested_by = (select auth.uid())
    or public.current_profile_role()='admin'
  );

alter policy documents_insert on public.documents
  with check (uploaded_by = (select auth.uid()));

alter policy documents_read on public.documents
  using (
    uploaded_by = (select auth.uid())
    or public.current_profile_role()='admin'
    or exists (
      select 1 from public.movements m
      where m.document_id=documents.id
        and (public.can_access_warehouse(m.warehouse_from_id)
          or public.can_access_warehouse(m.warehouse_to_id))
    )
  );

alter policy notifications_read on public.notifications
  using (user_id = (select auth.uid()));

alter policy notifications_update on public.notifications
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

alter policy product_deletion_requests_insert on public.product_deletion_requests
  with check (
    requested_by = (select auth.uid())
    and public.current_profile_role()='depositor'
  );

alter policy product_deletion_requests_read on public.product_deletion_requests
  using (
    requested_by = (select auth.uid())
    or public.current_profile_role()='admin'
  );

alter policy product_requests_insert on public.product_requests
  with check (
    requested_by = (select auth.uid())
    and public.can_access_warehouse(warehouse_id)
  );

alter policy product_requests_read on public.product_requests
  using (
    requested_by = (select auth.uid())
    or public.current_profile_role()='admin'
  );

alter policy profiles_read on public.profiles
  using (
    id = (select auth.uid())
    or public.current_profile_role()='admin'
  );

alter policy suppliers_insert on public.suppliers
  with check (created_by = (select auth.uid()));

alter policy supply_requests_read on public.supply_requests
  using (
    requested_by = (select auth.uid())
    or public.current_profile_role()='admin'
  );
