import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {database} from './fixtures/commercial-database.mjs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');

test('a six-hour crane quote creates an OC with canonical hours, unchanged price and no stock',async()=>{
 const db=await database(),id=Object.fromEntries(['admin','depositor','warehouse','company','supplier'].map(k=>[k,randomUUID()]));
 const q=(sql,args=[])=>db.query(sql,args);
 try{
  for(const file of ['20261019203337_purchase_receiving_unit_integrity.sql','20261020121555_ai_product_identity_metadata.sql','20261020121638_ai_product_identity_functions.sql','20261020121651_ai_product_identity_guards.sql','20261020121702_ai_quote_identity_validation.sql','20261020121938_ai_fractional_measure_aliases.sql'])await db.exec(read('../migrations/'+file));
  await q('insert into auth.users(id) values($1),($2)',[id.admin,id.depositor]);
  await q("insert into warehouses(id,code,name) values($1,'QA','Depósito de prueba')",[id.warehouse]);
  await q("insert into profiles(id,username,role,warehouse_id) values($1,'compras','admin',null),($2,'deposito','depositor',$3)",[id.admin,id.depositor,id.warehouse]);
  await q("insert into purchase_companies(id,name) values($1,'AVH')",[id.company]);await q("insert into suppliers(id,name) values($1,'Grúas de prueba')",[id.supplier]);
  await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id.admin,role:'authenticated'})]);
  const data={company_id:id.company,supplier_id:id.supplier,purchase_type:'service',destination_type:'service',currency:'PYG',source_document_kind:'quotation',source_document_number:'GRUA-1002'},item={product_code:'1002',description:'Servicios de Grúa. 6 hs mínimas; si se excede se ajusta a facturación.',quantity:6,unit:'hs',factor_to_base:1,unit_price:150000};
  const create=async unit=>(await q('select admin_create_purchase_from_quote($1::jsonb,$2::jsonb) result',[JSON.stringify(data),JSON.stringify([{...item,unit}])])).rows[0].result;
  await assert.rejects(create('hs'),/products_base_unit_check/,'reproduce the reported error before the fix');
  assert.equal((await q('select count(*)::int n from products')).rows[0].n,0);assert.equal((await q('select count(*)::int n from purchases')).rows[0].n,0,'failed attempts roll back instead of leaving partial OCs');
  const constraintBefore=(await q("select pg_get_constraintdef(oid) definition from pg_constraint where conrelid='products'::regclass and conname='products_base_unit_check'")).rows[0].definition;
  await db.exec(read('../migrations/20261031130353_service_hour_unit_aliases.sql'));
  for(const unit of ['hs','HS','h','Hr','Hrs.','h.s.','hora','horas','hour','hours']){
   const result=await create(unit);assert.match(result.po_number,/OC-/);
   const row=(await q('select p.status,p.purchase_type,p.destination_type,p.warehouse_id,i.quantity::float,i.unit,i.unit_price::float,i.factor_to_base::float,i.affects_inventory,pr.base_unit from purchases p join purchase_items i on i.purchase_id=p.id join products pr on pr.id=i.product_id where p.id=$1',[result.purchase_id])).rows[0];
   assert.deepEqual(row,{status:'approved',purchase_type:'service',destination_type:'service',warehouse_id:null,quantity:6,unit:'hora',unit_price:150000,factor_to_base:1,affects_inventory:false,base_unit:'hora'});
  }
  assert.equal((await q('select count(*)::int n from products')).rows[0].n,1,'equivalent spellings reuse the same service product');
  for(const table of ['movements','inventory_batches','purchase_receipts'])assert.equal((await q('select count(*)::int n from '+table)).rows[0].n,0);
  const constraintAfter=(await q("select pg_get_constraintdef(oid) definition from pg_constraint where conrelid='products'::regclass and conname='products_base_unit_check'")).rows[0].definition;assert.equal(constraintAfter,constraintBefore);
  for(const [raw,expected] of [['x1','unidad'],['× 1','unidad'],['x10','x10'],['kg','kg'],['TN','tonelada'],['servicios','servicio'],['viajes','viaje']])assert.equal((await q('select purchase_normalize_unit($1) unit',[raw])).rows[0].unit,expected);
  await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id.depositor,role:'authenticated'})]);await db.exec('set role authenticated');await assert.rejects(create('hs'),/Solo el administrador/);
  await db.exec('reset role;set role anon');await assert.rejects(create('hs'),/permission denied/);
 }finally{await db.close();}
});
