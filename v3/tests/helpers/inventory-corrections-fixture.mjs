import fs from 'node:fs';

export async function setupInventoryCorrections(db){
  const source=fs.readFileSync(new URL('../../migrations/20260926130000_null_safe_rpc_authorization.sql',import.meta.url),'utf8');
  const start=source.indexOf('CREATE OR REPLACE FUNCTION public.admin_void_movement('),end=source.indexOf('CREATE OR REPLACE FUNCTION public.admin_void_stock_in_movement(',start);
  if(start<0||end<0)throw Error('Audited movement reversal RPC not found');
  await db.exec(source.slice(start,end));
  await db.exec('revoke all on function public.admin_void_movement(uuid,text) from public,anon; grant execute on function public.admin_void_movement(uuid,text) to authenticated;');
  await db.exec("alter table public.purchase_receipts enable row level security; grant select on public.purchase_receipts to authenticated; create policy correction_receipts_admin_read on public.purchase_receipts for select to authenticated using (public.current_profile_role()='admin');");
  await db.exec(fs.readFileSync(new URL('../../migrations/20260929130000_purchase_receipt_void_guard.sql',import.meta.url),'utf8'));
}
