import test from 'node:test';
import assert from 'node:assert/strict';
import {operationalDb,seed,asUser,id} from './helpers/operational-db.mjs';
async function setup(t){const db=await operationalDb();t.after(()=>db.close());await seed(db);return db}
const receiptItems=(quantity,request=100)=>JSON.stringify([{purchase_item_id:id(60),quantity,request_id:id(request),unit_cost:999}]);
async function receive(db,quantity,request=100){return (await db.query('SELECT receive_purchase($1,$2::jsonb) id',[id(50),receiptItems(quantity,request)])).rows[0].id}
async function scalar(db,sql,params=[]){return Object.values((await db.query(sql,params)).rows[0])[0]}

test('combined migrations preserve approved prices, partial receipts, replay and stock limits',async t=>{
  const db=await setup(t);await asUser(db,id(2));
  const first=await receive(db,4);
  assert.equal(await receive(db,4),first);
  assert.equal(Number(await scalar(db,'SELECT received_qty FROM purchase_items WHERE id=$1',[id(60)])),4);
  assert.equal(await scalar(db,'SELECT status FROM purchases WHERE id=$1',[id(50)]),'partially_received');
  assert.equal(Number(await scalar(db,'SELECT unit_cost FROM inventory_batches')),2);
  await assert.rejects(receive(db,7,101),/supera/);
  assert.equal(Number(await scalar(db,'SELECT sum(quantity_remaining) FROM inventory_batches')),4);
  await receive(db,6,102);
  assert.equal(await scalar(db,'SELECT status FROM purchases WHERE id=$1',[id(50)]),'received');
  assert.equal(Number(await scalar(db,'SELECT sum(quantity_remaining) FROM inventory_batches')),10);
});

test('RLS and RPC matrix isolates deposits and rejects inactive/missing profiles',async t=>{
  const db=await setup(t);
  await asUser(db,id(2));await receive(db,4);
  await asUser(db,id(3));
  assert.equal(Number(await scalar(db,'SELECT count(*) FROM inventory_batches')),0);
  await assert.rejects(receive(db,1,103),/No autorizado/);
  for(const user of [id(4),id(5)]){
    await asUser(db,user);
    for(const table of ['products','suppliers','warehouses','purchase_items','inventory_batches'])
      assert.equal(Number(await scalar(db,'SELECT count(*) FROM '+table)),0,table+' '+user);
    await assert.rejects(receive(db,1,104),/Usuario no autorizado/);
    await assert.rejects(db.query('INSERT INTO suppliers(name,created_by) VALUES ($1,$2)',['forbidden',user]),/row-level security/);
    await assert.rejects(db.query('INSERT INTO documents(document_type,uploaded_by) VALUES ($1,$2)',['remito',user]),/row-level security/);
  }
  await asUser(db,id(1));assert.equal(Number(await scalar(db,'SELECT count(*) FROM inventory_batches')),1);
  await asUser(db,null);await assert.rejects(receive(db,1,105),/permission denied|Usuario no autorizado/);
});

test('manual entry costs remain admin-only and receipt reference cannot authorize fabricated stock',async t=>{
  const db=await setup(t);await asUser(db,id(2));
  const item={product_id:id(20),quantity:2,unit:'kg',factor_to_base:1};
  const entry=items=>db.query('SELECT record_entry($1,$2,null,$3::jsonb)',[id(10),id(30),JSON.stringify(items)]);
  await assert.rejects(entry([{...item,unit_cost:5,currency:'USD',exchange_rate:7500}]),/Solo Administración/);
  await entry([item]);
  // A receipt for non-stock items may legitimately have no movement. Its ID must not be a cost bypass.
  await db.exec('RESET ROLE');
  await db.query('INSERT INTO purchase_receipts(id,purchase_id,warehouse_id,received_by) VALUES ($1,$2,$3,$4)',[id(70),id(50),id(10),id(2)]);
  await asUser(db,id(2));
  await assert.rejects(entry([{...item,unit_cost:5,currency:'USD',exchange_rate:7500,purchase_receipt_id:id(70)}]),/coincidir/);
  await asUser(db,id(1));await entry([{...item,unit_cost:5,currency:'USD',exchange_rate:7500}]);
  assert.equal(Number(await scalar(db,'SELECT sum(quantity_remaining) FROM inventory_batches')),4);
});

test('receipt attachments require own purchase prefix and existing Storage object after all migrations',async t=>{
  const db=await setup(t);await asUser(db,id(2));const receipt=await receive(db,4);
  const attach=path=>db.query("SELECT register_purchase_receipt_document($1,'remittance',$2)",[receipt,path]);
  await assert.rejects(attach(id(51)+'/receipts/file.pdf'),/no pertenece/);
  await assert.rejects(attach(id(50)+'/receipts/missing.pdf'),/no existe/);
  await db.exec('RESET ROLE');
  const path=id(50)+'/receipts/file.pdf';await db.query("INSERT INTO storage.objects(bucket_id,name) VALUES ('purchase-documents',$1)",[path]);
  await asUser(db,id(2));await attach(path);
  await asUser(db,id(3));await assert.rejects(attach(path),/No autorizado/);
  await asUser(db,id(4));await assert.rejects(attach(path),/Usuario no autorizado/);
});

test('stock exit, transfer and destination receipt preserve quantities and forbid cross-deposit actions',async t=>{
  const db=await setup(t);await asUser(db,id(2));await receive(db,10);
  const items=quantity=>JSON.stringify([{product_id:id(20),quantity,unit:'kg',factor_to_base:1}]);
  await db.query("SELECT record_exit($1,null,null,'Test','Test',$2::jsonb)",[id(10),items(2)]);
  const movement=await scalar(db,'SELECT record_transfer($1,$2,$3::jsonb)',[id(10),id(11),items(3)]);
  assert.equal(Number(await scalar(db,'SELECT sum(quantity_remaining) FROM inventory_batches')),5);
  await assert.rejects(db.query('SELECT receive_transfer($1)',[movement]),/No autorizado/);
  await asUser(db,id(3));await db.query('SELECT receive_transfer($1)',[movement]);
  assert.equal(Number(await scalar(db,'SELECT sum(quantity_remaining) FROM inventory_batches')),3);
  await assert.rejects(db.query('SELECT receive_transfer($1)',[movement]),/Transferencia inválida/);
  await asUser(db,id(1));assert.equal(Number(await scalar(db,'SELECT sum(quantity_remaining) FROM inventory_batches')),8);
});

test('inventory closure rejects further counts and database constraints reject impossible balances',async t=>{
  const db=await setup(t);await asUser(db,id(1));await db.query('SELECT admin_open_initial_inventory($1)',[id(10)]);
  await asUser(db,id(2));
  const count=()=>db.query('SELECT record_initial_inventory($1,$2::jsonb)',[id(10),JSON.stringify([{product_id:id(20),quantity:2,unit:'kg'}])]);
  await count();await asUser(db,id(1));
  const line=await scalar(db,"SELECT id FROM movement_lines LIMIT 1");
  await db.query("SELECT admin_price_initial_inventory($1,2,'USD',7500)",[line]);
  await db.query('SELECT admin_close_initial_inventory($1)',[id(10)]);
  await asUser(db,id(2));await assert.rejects(count(),/no está abierto/);
  await db.exec('RESET ROLE');
  await assert.rejects(db.exec('UPDATE inventory_batches SET quantity_remaining=quantity_received+1'),/inventory_batches_remaining_lte_received/);
  await assert.rejects(db.exec('UPDATE purchase_items SET received_qty=quantity+1'),/purchase_items_received_lte_quantity/);
});
