import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {database} from './fixtures/commercial-database.mjs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const migration=read('../migrations/20261029120725_purchase_partial_deliveries_and_short_close.sql');

test('shared deliveries keep one balance, post into the receiving depot and close unfulfilled quantities without inventing stock',async t=>{
 const db=await database(),q=(s,a=[])=>db.query(s,a),ids=Object.fromEntries(['admin','ac','vh','vil','other','inactive','production','whAC','whVH','whVil','whOther','company','supplier','product','purchase','item','item2','partial','partialItem'].map(k=>[k,randomUUID()]));
 const login=async user=>{await db.exec('reset role');await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:ids[user],role:'authenticated'})]);await db.exec('set role authenticated');};
 const owner=async(s,a=[])=>{await db.exec('reset role');return q(s,a);};
 try{
  await db.exec(`
   alter table public.purchases enable row level security;
   alter table public.purchase_items enable row level security;
   alter table public.purchase_receipts enable row level security;
   alter table public.purchase_documents enable row level security;
   create policy purchases_admin_all on public.purchases for all to authenticated using(current_profile_role()='admin') with check(current_profile_role()='admin');
   create policy purchases_depositor_read on public.purchases for select to authenticated using(current_profile_role()='depositor' and warehouse_id=current_profile_warehouse());
   create policy purchase_items_admin_all on public.purchase_items for all to authenticated using(current_profile_role()='admin') with check(current_profile_role()='admin');
   create policy purchase_items_depositor_read on public.purchase_items for select to authenticated using(exists(select 1 from purchases p where p.id=purchase_id and p.warehouse_id=current_profile_warehouse()));
   create policy purchase_documents_admin_all on public.purchase_documents for all to authenticated using(current_profile_role()='admin') with check(current_profile_role()='admin');
   create policy purchase_documents_depositor_read on public.purchase_documents for select to authenticated using(exists(select 1 from purchases p where p.id=purchase_id and p.warehouse_id=current_profile_warehouse()));
   create policy purchase_receipts_admin_read on public.purchase_receipts for select to authenticated using(current_profile_role()='admin');
   create policy purchase_receipts_depositor_read on public.purchase_receipts for select to authenticated using(warehouse_id=current_profile_warehouse());
   create policy purchase_docs_read on storage.objects for select to authenticated using(bucket_id='purchase-documents');
   create policy purchase_docs_depositor_insert on storage.objects for insert to authenticated with check(false);
   grant select,insert,update,delete on public.purchases,public.purchase_items,public.purchase_documents to authenticated;
   grant select on public.purchase_receipts to authenticated;
   grant select on public.purchase_companies,public.contractors,public.suppliers,public.warehouses,public.barges to authenticated;
   grant select on public.audit_events to authenticated;
  `);
  const functions=read('../migrations/20260926130000_null_safe_rpc_authorization.sql');
  await db.exec(functions.match(/CREATE OR REPLACE FUNCTION public\.admin_void_stock_in_movement\([\s\S]*?\$function\$;/)[0]);
  await db.exec(`drop table if exists public.v_smart_stock_alerts;
   create view public.v_smart_stock_alerts as select p.id,p.warehouse_id,greatest(pi.quantity-coalesce(pi.received_qty,0::numeric),0::numeric) pending_qty
   from public.purchases p join public.purchase_items pi on pi.purchase_id=p.id where p.destination_type='warehouse'::text;`);
  await db.exec(migration).catch(error=>{const at=Number(error.position||0);throw Error(error.message+' at '+at+' '+migration.slice(Math.max(0,at-100),at+120));});
  await db.exec('grant select on public.v_purchase_overview,public.v_purchase_alerts to authenticated;');
  for(const user of ['admin','ac','vh','vil','other','inactive','production'])await q('insert into auth.users(id) values($1)',[ids[user]]);
  for(const [code,name] of [['AC','ACOMAR'],['VH','Villa Hayes'],['Vil','Villeta'],['Other','Mariano']])await q('insert into warehouses(id,code,name) values($1,$2,$3)',[ids['wh'+code],code,name]);
  for(const [user,role,wh] of [['admin','admin',null],['ac','depositor','whAC'],['vh','depositor','whVH'],['vil','depositor','whVil'],['other','depositor','whOther'],['inactive','depositor','whVH'],['production','production',null]])await q('insert into profiles(id,username,role,warehouse_id,active) values($1,$2,$3,$4,$5)',[ids[user],user,role,wh?ids[wh]:null,user!=='inactive']);
  await q("insert into purchase_companies(id,name) values($1,'AVH')",[ids.company]);await q("insert into suppliers(id,name) values($1,'Petersen')",[ids.supplier]);
  await q("insert into products(id,sku,name,base_unit) values($1,'FLUX','Flux','kg')",[ids.product]);
  for(const key of ['purchase','partial'])await q("insert into purchases(id,company_id,supplier_id,warehouse_id,status,currency,created_by) values($1,$2,$3,$4,'ordered','USD',$5)",[ids[key],ids.company,ids.supplier,ids.whAC,ids.admin]);
  for(const [item,purchase,qty] of [['item','purchase',100],['item2','purchase',10],['partialItem','partial',50]])await q("insert into purchase_items(id,purchase_id,product_id,description,quantity,unit,factor_to_base,unit_price,affects_inventory) values($1,$2,$3,'Flux',$4,'kg',1,2,true)",[ids[item],ids[purchase],ids.product,qty]);
  const payload=(item,quantity,extra={})=>JSON.stringify([{purchase_item_id:ids[item],quantity,request_id:randomUUID(),...extra}]);
  await t.test('only Compras can choose active delivery depots or cancel a balance',async()=>{
   for(const user of ['ac','production','inactive']){await login(user);await assert.rejects(q('select admin_set_purchase_delivery_warehouses($1,$2)',[ids.purchase,[ids.whAC,ids.whVH]]),/Solo Compras/);await assert.rejects(q('select admin_cancel_purchase_balance($1,$2,$3)',[ids.purchase,[ids.item],'Sin stock']),/Solo Compras/);}
   await login('admin');await assert.rejects(q('select admin_set_purchase_delivery_warehouses($1,$2)',[ids.purchase,[ids.whVH]]),/principal/);
   await q('select admin_set_purchase_delivery_warehouses($1,$2)',[ids.purchase,[ids.whAC,ids.whVH,ids.whVil]]);
   assert.equal((await q('select delivery_mode from purchases where id=$1',[ids.purchase])).rows[0].delivery_mode,'partial');
   assert.equal((await owner('select count(*)::int n from v_smart_stock_alerts where id=$1',[ids.purchase])).rows[0].n,0,'an unallocated shared order must not promise its full balance to ACOMAR stock');await login('admin');
  });
  await t.test('assigned depots see the OC, shared items and document upload path; unrelated depots do not',async()=>{
   for(const user of ['ac','vh','vil']){await login(user);assert.equal((await q('select count(*)::int n from purchases where id=$1',[ids.purchase])).rows[0].n,1);assert.equal((await q('select count(*)::int n from purchase_items where purchase_id=$1',[ids.purchase])).rows[0].n,2);await q("insert into storage.objects(bucket_id,name) values('purchase-documents',$1)",[ids.purchase+'/receipts/'+user+'.pdf']);}
   await login('other');assert.equal((await q('select count(*)::int n from purchases where id=$1',[ids.purchase])).rows[0].n,0);await assert.rejects(q("insert into storage.objects(bucket_id,name) values('purchase-documents',$1)",[ids.purchase+'/receipts/foreign.pdf']),/row-level security/);
   await assert.rejects(q('select receive_purchase($1,$2::jsonb)',[ids.purchase,payload('item',1)]),/no está habilitada/);
  });
  let receipt;
  await t.test('Villa Hayes receives 40 once and cannot spoof the receiving warehouse',async()=>{
   await login('vh');await assert.rejects(q('select receive_purchase($1,$2::jsonb)',[ids.purchase,payload('item',40,{warehouse_id:ids.whAC})]),/no está habilitada/);
   const data=payload('item',40);receipt=(await q('select receive_purchase($1,$2::jsonb) id',[ids.purchase,data])).rows[0].id;assert.equal((await q('select receive_purchase($1,$2::jsonb) id',[ids.purchase,data])).rows[0].id,receipt);
   const posted=(await owner('select r.warehouse_id,m.warehouse_to_id,b.quantity_remaining::float qty from purchase_receipts r join movements m on m.id=r.movement_id join movement_lines l on l.movement_id=m.id join inventory_batches b on b.source_line_id=l.id where r.id=$1',[receipt])).rows[0];assert.deepEqual(posted,{warehouse_id:ids.whVH,warehouse_to_id:ids.whVH,qty:40});
  });
  await t.test('remaining 60 is shared across Villeta and ACOMAR; the OC cannot be over-received or lose a used depot',async()=>{
   await login('vil');await q('select receive_purchase($1,$2::jsonb)',[ids.purchase,payload('item',30)]);
   await login('ac');await assert.rejects(q('select receive_purchase($1,$2::jsonb)',[ids.purchase,payload('item',31)]),/supera la cantidad/);await q('select receive_purchase($1,$2::jsonb)',[ids.purchase,payload('item',30)]);
   await login('admin');await assert.rejects(q('select admin_set_purchase_delivery_warehouses($1,$2)',[ids.purchase,[ids.whAC,ids.whVil]]),/ya tiene recepciones/);
   assert.equal(Number((await q('select received_qty from purchase_items where id=$1',[ids.item])).rows[0].received_qty),100);
  });
  await t.test('cancel a wholly missing line without changing its approved quantity or manufacturing inventory',async()=>{
   const before=(await owner('select sum(quantity_remaining)::float qty,sum(quantity_remaining*unit_cost)::float value from inventory_batches')).rows[0];
   await login('admin');await q('select admin_cancel_purchase_balance($1,$2,$3)',[ids.purchase,[ids.item2],'Proveedor entregó solo lo disponible. El saldo ya no se entregará.']);
   const row=(await q('select quantity::float,received_qty::float,cancelled_qty::float from purchase_items where id=$1',[ids.item2])).rows[0];assert.deepEqual(row,{quantity:10,received_qty:0,cancelled_qty:10});assert.equal((await q('select status from purchases where id=$1',[ids.purchase])).rows[0].status,'closed');
   assert.deepEqual((await owner('select sum(quantity_remaining)::float qty,sum(quantity_remaining*unit_cost)::float value from inventory_batches')).rows[0],before);
   await login('admin');assert.equal((await q('select pending_amount::float,cancelled_amount::float from v_purchase_overview where id=$1',[ids.purchase])).rows[0].pending_amount,0);
   await assert.rejects(q('select admin_update_purchase_item($1,$2::jsonb)',[ids.item2,JSON.stringify({quantity:12})]),/cerrada|saldo cancelado/);
   const auditCount=(await q("select count(*)::int n from audit_events where action='purchase_balance_cancelled' and purchase_id=$1",[ids.purchase])).rows[0].n;await q('select admin_cancel_purchase_balance($1,$2,$3)',[ids.purchase,[ids.item2],'Sin stock']);assert.equal((await q("select count(*)::int n from audit_events where action='purchase_balance_cancelled' and purchase_id=$1",[ids.purchase])).rows[0].n,auditCount);
  });
  await t.test('a receipt reversal preserves cancelled quantities and reopens exactly the reversed balance',async()=>{
   await login('admin');await q('select admin_void_purchase_receipt($1,$2)',[receipt,'Entrega registrada en depósito equivocado']);
   const row=(await q('select sum(quantity-received_qty-cancelled_qty)::float pending from purchase_items where purchase_id=$1',[ids.purchase])).rows[0];assert.equal(row.pending,40);assert.equal((await q('select status from purchases where id=$1',[ids.purchase])).rows[0].status,'partially_received');
  });
  await t.test('partially delivered line retains 20 received and closes 30 with stock unchanged',async()=>{
   await login('ac');await q('select receive_purchase($1,$2::jsonb)',[ids.partial,payload('partialItem',20)]);
   await login('admin');const count=(await q('select count(*)::int n from movements')).rows[0].n;await q('select admin_cancel_purchase_balance($1,$2,$3)',[ids.partial,[ids.partialItem],'Proveedor sin stock; no habrá entrega del saldo']);
   assert.deepEqual((await q('select quantity::float,received_qty::float,cancelled_qty::float from purchase_items where id=$1',[ids.partialItem])).rows[0],{quantity:50,received_qty:20,cancelled_qty:30});assert.equal((await q('select count(*)::int n from movements')).rows[0].n,count);
   await login('ac');await assert.rejects(q('select receive_purchase($1,$2::jsonb)',[ids.partial,payload('partialItem',1)]),/no está disponible/);
   await db.exec('reset role;set role anon');await assert.rejects(q('select admin_cancel_purchase_balance($1,$2,$3)',[ids.partial,[ids.partialItem],'Sin stock']),/permission denied/);
  });
 }finally{await db.close();}
});
