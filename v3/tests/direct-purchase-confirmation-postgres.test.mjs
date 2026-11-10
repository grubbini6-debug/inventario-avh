import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database} from './fixtures/direct-purchase-database.mjs';

test('Compras confirms real services and direct deliveries with audit, partial balances, retries and no inventory',async t=>{
 const db=await database(),q=(sql,args=[])=>db.query(sql,args);
 const ids=Object.fromEntries(['admin','depositor','production','viewer','inactive','noProfile','company','warehouse','supplier','product','service','serviceItem','direct','directItem','warehousePurchase','stockItem','foreignItem','mixed','mixedItem','draft','draftItem'].map(k=>[k,randomUUID()]));
 const login=async user=>{await db.exec('reset role');await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:ids[user],role:'authenticated'})]);await db.exec('set role authenticated');};
 const owner=async(sql,args=[])=>{await db.exec('reset role');return q(sql,args);};
 const confirm=(purchase,item,quantity,request=randomUUID(),date='2026-10-30',notes='Servicio realizado en Villeta; conforme.')=>q('select public.admin_confirm_direct_purchase($1,$2,$3,$4,$5) id',[ids[purchase],JSON.stringify([{purchase_item_id:ids[item],quantity}]),date,notes,request]);
 try{
  for(const user of ['admin','depositor','production','viewer','inactive','noProfile'])await q('insert into auth.users(id) values($1)',[ids[user]]);
  await q("insert into warehouses(id,code,name) values($1,'QA','Villeta')",[ids.warehouse]);
  for(const [user,role] of [['admin','admin'],['depositor','depositor'],['production','production'],['viewer','admin_viewer'],['inactive','admin']])await q('insert into profiles(id,username,full_name,role,active,warehouse_id) values($1,$2,$3,$4,$5,$6)',[ids[user],user,user==='admin'?'Gabriel Ortega':user,role,user!=='inactive',role==='depositor'?ids.warehouse:null]);
  await q("insert into purchase_companies(id,name) values($1,'AVH')",[ids.company]);await q("insert into suppliers(id,name) values($1,'Grúas QA')",[ids.supplier]);
  for(const [key,dest,state] of [['service','service','ordered'],['direct','direct','ordered'],['warehousePurchase','warehouse','ordered'],['mixed','direct','ordered'],['draft','service','draft']])await q('insert into purchases(id,company_id,supplier_id,created_by,purchase_type,destination_type,warehouse_id,status) values($1,$2,$3,$4,$5,$6,$7,$8)',[ids[key],ids.company,ids.supplier,ids.admin,key==='service'?'service':'other',dest,dest==='warehouse'?ids.warehouse:null,state]);
  await q("insert into products(id,sku,name,base_unit) values($1,'DIRECT-QA','Material QA','unidad')",[ids.product]);
  for(const [key,purchase,stock] of [['serviceItem','service',false],['directItem','direct',false],['stockItem','warehousePurchase',true],['foreignItem','direct',false],['mixedItem','mixed',true],['draftItem','draft',false]])await q('insert into purchase_items(id,purchase_id,description,quantity,unit,unit_price,affects_inventory,product_id) values($1,$2,$3,6,$4,150000,$5,$6)',[ids[key],ids[purchase],key,key==='serviceItem'?'hora':'unidad',stock,stock?ids.product:null]);
  await t.test('depositor, production, readonly, inactive, missing profile and anonymous users cannot confirm',async()=>{
   for(const user of ['depositor','production','viewer','inactive','noProfile']){await login(user);await assert.rejects(confirm('service','serviceItem',1),/Solo Compras/);}
   await db.exec('reset role;set role anon');await assert.rejects(confirm('service','serviceItem',1),/permission denied/);
  });
  await t.test('invalid, duplicated, foreign, stock and unconfirmed purchases make no writes',async()=>{
   await login('admin');
   for(const qty of [0,-1,7,'NaN','Infinity',0.0000001])await assert.rejects(confirm('service','serviceItem',qty),/cantidades|supera/);
   await assert.rejects(confirm('service','serviceItem',1,randomUUID(),'2099-01-01'),/futura/);
   await assert.rejects(confirm('service','serviceItem',1,randomUUID(),'2026-10-30',' '),/conformidad/);
   await assert.rejects(confirm('service','foreignItem',1),/no pertenece/);
   await assert.rejects(confirm('warehousePurchase','stockItem',1),/depósito/);
   await assert.rejects(confirm('mixed','mixedItem',1),/depósito/);
   await assert.rejects(confirm('draft','draftItem',1),/primero la compra/);
   const repeated=JSON.stringify([{purchase_item_id:ids.serviceItem,quantity:1},{purchase_item_id:ids.serviceItem,quantity:1}]);
   await assert.rejects(q('select admin_confirm_direct_purchase($1,$2,$3,$4,$5)',[ids.service,repeated,'2026-10-30','Conforme',randomUUID()]),/repetida/);
   assert.equal((await owner('select count(*)::int n from purchase_receipts')).rows[0].n,0);
  });
  let first;const request=randomUUID();
  await t.test('a partial three-hour service has real date, signed-in actor, audit and one receipt across retries',async()=>{
   await login('admin');first=(await confirm('service','serviceItem',3,request)).rows[0].id;
   assert.equal((await confirm('service','serviceItem',3,request)).rows[0].id,first);
   await assert.rejects(confirm('service','serviceItem',2,request),/datos distintos/);
   await assert.rejects(confirm('direct','directItem',3,request),/datos distintos/);
   const r=(await owner('select warehouse_id,movement_id,confirmation_type,effective_date::text,received_by,notes from purchase_receipts where id=$1',[first])).rows[0];
   assert.equal(r.warehouse_id,null);assert.equal(r.movement_id,null);assert.equal(r.confirmation_type,'direct');assert.equal(r.effective_date,'2026-10-30');assert.equal(r.received_by,ids.admin);
   assert.equal((await q('select status from purchases where id=$1',[ids.service])).rows[0].status,'partially_received');
   const audit=(await q("select actor_id,detail from audit_events where action='purchase_direct_confirmed' and purchase_id=$1",[ids.service])).rows;
   assert.equal(audit.length,1);assert.equal(audit[0].actor_id,ids.admin);assert.equal(audit[0].detail.items[0].quantity,3);
   for(const table of ['movements','inventory_batches'])assert.equal((await q('select count(*)::int n from '+table)).rows[0].n,0);
  });
  await t.test('a service confirmation stays private from depositors and cannot exceed its remaining quantity',async()=>{
   await login('depositor');assert.equal((await q('select count(*)::int n from purchase_receipts where id=$1',[first])).rows[0].n,0);assert.equal((await q('select count(*)::int n from purchases where id=$1',[ids.service])).rows[0].n,0);
   await login('admin');await assert.rejects(confirm('service','serviceItem',4),/supera/);await confirm('service','serviceItem',3);
   assert.equal((await q('select status from purchases where id=$1',[ids.service])).rows[0].status,'received');
   assert.equal(Number((await q('select received_qty from purchase_items where id=$1',[ids.serviceItem])).rows[0].received_qty),6);
  });
  await t.test('late invoice attaches to the same confirmation without receiving anything again',async()=>{
   await login('admin');const before=Number((await q('select received_qty from purchase_items where id=$1',[ids.serviceItem])).rows[0].received_qty);
   const doc=(await q('select register_purchase_receipt_document($1,$2,$3,$4,$5,$6) id',[first,'invoice',ids.service+'/receipts/factura.pdf','factura.pdf','001-001-0001234','2026-10-31'])).rows[0].id;
   assert.ok(doc);assert.equal((await q('select receipt_id from purchase_documents where id=$1',[doc])).rows[0].receipt_id,first);
   assert.equal(Number((await q('select received_qty from purchase_items where id=$1',[ids.serviceItem])).rows[0].received_qty),before);
  });
  await t.test('reversing a mistaken confirmation restores only that balance and preserves its evidence',async()=>{
   await login('admin');await q('select admin_void_purchase_receipt($1,$2)',[first,'Se confirmaron horas de otra fecha.']);
   assert.equal((await q('select status from purchases where id=$1',[ids.service])).rows[0].status,'partially_received');
   assert.equal(Number((await q('select received_qty from purchase_items where id=$1',[ids.serviceItem])).rows[0].received_qty),3);
   assert.ok((await q('select voided_at from purchase_receipts where id=$1',[first])).rows[0].voided_at);
   await assert.rejects(confirm('service','serviceItem',3,request),/anulada/);
   assert.equal((await q('select count(*)::int n from purchase_documents where receipt_id=$1',[first])).rows[0].n,1);
  });
  await t.test('direct goods can be confirmed without a fictitious warehouse or stock movement',async()=>{
   await login('admin');await confirm('direct','directItem',6);
   for(const table of ['movements','inventory_batches'])assert.equal((await owner('select count(*)::int n from '+table)).rows[0].n,0);
   assert.equal((await q('select count(*)::int n from purchase_receipts where warehouse_id is null and confirmation_type<>\'direct\'')).rows[0].n,0);
  });
 }finally{await db.close();}
});
