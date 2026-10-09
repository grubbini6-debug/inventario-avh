import fs from 'node:fs';

// Exercise the original stock RPC from its audited migration, rather than a mock.
// The schema-only manufacturing fixture does not include initial-count RPCs or these policies.
export async function setupInitialInventory(db){
  const source=fs.readFileSync(new URL('../../migrations/20260926170000_active_profile_rls_and_lock_order.sql',import.meta.url),'utf8');
  const start=source.indexOf('create or replace function public.record_initial_inventory('),end=source.indexOf('\ncreate or replace function public.receive_purchase(',start);
  if(start<0||end<0)throw Error('Original initial inventory RPC not found');
  await db.exec(source.slice(start,end));
  await db.exec(`
    revoke all on function public.record_initial_inventory(uuid,jsonb,text) from public,anon;
    grant execute on function public.record_initial_inventory(uuid,jsonb,text) to authenticated;
    alter table public.warehouse_opening_inventory enable row level security;
    grant select on public.warehouse_opening_inventory to authenticated;
    create policy opening_inventory_admin_read on public.warehouse_opening_inventory for select to authenticated using (public.current_profile_role()='admin');
    create policy opening_inventory_depositor_read on public.warehouse_opening_inventory for select to authenticated using (public.current_profile_role()='depositor' and public.can_access_warehouse(warehouse_id));
    alter table public.product_presentations enable row level security;
    grant select on public.product_presentations to authenticated;
    create policy presentations_read on public.product_presentations for select to authenticated using (exists(select 1 from public.profiles p where p.id=auth.uid() and p.active));
    -- Production grants INSERT to authenticated but restricts it to admins through RLS.
    grant insert on public.products to authenticated;
    create policy products_admin_write on public.products for all to authenticated using (public.current_profile_role()='admin') with check (public.current_profile_role()='admin');
  `);
}
