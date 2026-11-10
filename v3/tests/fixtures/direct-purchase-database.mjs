import fs from 'node:fs';
import {database as baseDatabase} from './commercial-database.mjs';
const read=p=>fs.readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export async function database(){
 const db=await baseDatabase();
 await db.exec(`
  alter table public.profiles drop constraint profiles_role_check;
  alter table public.profiles add constraint profiles_role_check check(role in ('admin','depositor','production','admin_viewer'));
  alter table public.purchases enable row level security;
  alter table public.purchase_items enable row level security;
  alter table public.purchase_receipts enable row level security;
  alter table public.purchase_documents enable row level security;
  create policy purchases_admin_all on public.purchases for all to authenticated using(current_profile_role()='admin') with check(current_profile_role()='admin');
  create policy purchases_depositor_read on public.purchases for select to authenticated using(current_profile_role()='depositor' and warehouse_id=current_profile_warehouse());
  create policy purchase_items_admin_all on public.purchase_items for all to authenticated using(current_profile_role()='admin') with check(current_profile_role()='admin');
  create policy purchase_items_depositor_read on public.purchase_items for select to authenticated using(exists(select 1 from purchases p where p.id=purchase_id));
  create policy purchase_documents_admin_all on public.purchase_documents for all to authenticated using(current_profile_role()='admin') with check(current_profile_role()='admin');
  create policy purchase_documents_depositor_read on public.purchase_documents for select to authenticated using(exists(select 1 from purchases p where p.id=purchase_id));
  create policy purchase_receipts_admin_read on public.purchase_receipts for select to authenticated using(current_profile_role()='admin');
  create policy purchase_receipts_depositor_read on public.purchase_receipts for select to authenticated using(current_profile_role()='depositor' and warehouse_id=current_profile_warehouse());
  create policy purchase_docs_read on storage.objects for select to authenticated using(bucket_id='purchase-documents');
  create policy purchase_docs_depositor_insert on storage.objects for insert to authenticated with check(false);
  grant select,insert,update,delete on public.purchases,public.purchase_items,public.purchase_documents to authenticated;
  grant select on public.purchase_receipts,public.purchase_receipt_items to authenticated;
  grant select on public.purchase_companies,public.contractors,public.suppliers,public.warehouses,public.barges,public.audit_events to authenticated;
  drop table if exists public.v_smart_stock_alerts;
  create view public.v_smart_stock_alerts as select p.id,p.warehouse_id,greatest(pi.quantity-coalesce(pi.received_qty,0::numeric),0::numeric) pending_qty
   from public.purchases p join public.purchase_items pi on pi.purchase_id=p.id where p.destination_type='warehouse';
 `);
 await db.exec(read('migrations/20261029120725_purchase_partial_deliveries_and_short_close.sql'));
 const lifecycle=read('migrations/20260903_purchase_lifecycle_complete.sql');
 await db.exec(lifecycle.match(/create or replace function public\.register_purchase_receipt_document\([\s\S]*?\$\$;/i)[0]);
 await db.exec('revoke execute on function public.register_purchase_receipt_document(uuid,text,text,text,text,date) from public,anon;grant execute on function public.register_purchase_receipt_document(uuid,text,text,text,text,date) to authenticated;');
 await db.exec(read('migrations/20261110113752_compras_directas_conformidad.sql'));
 return db;
}
