import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {database} from './fixtures/commercial-database.mjs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const migration=read('../migrations/20261019203337_purchase_receiving_unit_integrity.sql');
const repair=read('../operations/unify-wst-stock-units.sql');

test('receiving units: merge preserves physical stock, invoice, cost lots and authorization',async t=>{
  const db=await database(),id=Object.fromEntries(['admin','depositor','wh','company','supplier','old','wire','opening','initial','entry','initialLine','entryLine','purchase','item','receipt','invoice'].map(k=>[k,randomUUID()]));
  const q=(sql,args=[])=>db.query(sql,args);
  const login=async user=>{await db.exec('reset role');await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user,role:'authenticated'})]);};
  try{
    // Only the reference-presence checks need these unrelated module tables.
    await db.exec('create table if not exists fabrication_materials(product_id uuid); create table if not exists fabrication_orders(output_product_id uuid); create table if not exists fabrication_stock_links(product_id uuid); create table if not exists gas_products(product_id uuid);');
    await q('insert into auth.users(id) values($1),($2)',[id.admin,id.depositor]);
    await q("insert into warehouses(id,code,name) values($1,'ACOMAR','ACOMAR')",[id.wh]);
    await q("insert into profiles(id,username,role,warehouse_id) values($1,'admin.avh','admin',null),($2,'deposito','depositor',$3)",[id.admin,id.depositor,id.wh]);
    await q("insert into purchase_companies(id,name) values($1,'MAQMOVEIS')",[id.company]);
    await q("insert into suppliers(id,name) values($1,'COMAGRO')",[id.supplier]);
    await q("insert into products(id,sku,name,base_unit) values($1,'TUB-WST-E71T1C-12','Alambre tubular WST E71T-1C 1.2 mm','kg'),($2,'CHT711120P','TUBULAR WST E71T1C 1,2MM 15KG PREMIUM','unidad')",[id.old,id.wire]);
    await q("insert into product_presentations(product_id,label,unit,factor_to_base) values($1,'Rollo 15 kg','rollo',15)",[id.old]);
    await q("insert into warehouse_opening_inventory(id,warehouse_id,opened_by) values($1,$2,$3)",[id.opening,id.wh,id.admin]);
    await q("insert into movements(id,type,warehouse_to_id,opening_session_id,created_by) values($1,'initial',$3,$4,$5),($2,'entry',$3,null,$5)",[id.initial,id.entry,id.wh,id.opening,id.admin]);
    await q("insert into movement_lines(id,movement_id,product_id,quantity,unit,factor_to_base,entry_unit_cost,entry_currency) values($1,$2,$3,14,'unidad',15,25.5,'USD'),($4,$5,$6,72,'unidad',15,25.5,'USD')",[id.initialLine,id.initial,id.old,id.entryLine,id.entry,id.wire]);
    await q("insert into inventory_batches(warehouse_id,product_id,source_line_id,quantity_received,quantity_remaining,unit_cost,currency) values($1,$2,$3,210,210,1.7,'USD'),($1,$4,$5,1080,1080,1.7,'USD')",[id.wh,id.old,id.initialLine,id.wire,id.entryLine]);
    await q("insert into purchases(id,company_id,supplier_id,warehouse_id,status,currency,po_number,created_by) values($1,$2,$3,$4,'received','USD','OC-2026-00032',$5)",[id.purchase,id.company,id.supplier,id.wh,id.admin]);
    await q("insert into purchase_items(id,purchase_id,product_id,description,quantity,unit,factor_to_base,unit_price,received_qty,affects_inventory) values($1,$2,$3,'WST 15 kg',72,'unidad',15,25.5,72,true)",[id.item,id.purchase,id.wire]);
    await q('insert into purchase_receipts(id,purchase_id,warehouse_id,received_by,movement_id) values($1,$2,$3,$4,$5)',[id.receipt,id.purchase,id.wh,id.admin,id.entry]);
    await q('insert into purchase_receipt_items(receipt_id,purchase_item_id,quantity) values($1,$2,72)',[id.receipt,id.item]);
    await q("insert into purchase_documents(id,purchase_id,receipt_id,kind,file_path,uploaded_by,document_number,analysis_status,analysis_data) values($1,$2,$3,'invoice','private/actual.jpg',$4,'001-001-0177076','ok',$5::jsonb)",[id.invoice,id.purchase,id.receipt,id.admin,JSON.stringify({total:1836,tax:166.91,subtotal:1836})]);
    await login(id.admin);await db.exec(migration);
    const audited=read('../migrations/20260926170000_active_profile_rls_and_lock_order.sql'),start=audited.indexOf('create or replace function public.receive_purchase('),end=audited.indexOf('$function$;',start)+11;
    assert.ok(start>=0&&end>start);await db.exec(audited.slice(start,end));
    await db.exec('revoke all on function public.receive_purchase(uuid,jsonb,text,text,date,text) from public,anon; grant execute on function public.receive_purchase(uuid,jsonb,text,text,date,text) to authenticated;');
    const invoiceBefore=(await q('select to_jsonb(d) x from purchase_documents d where id=$1',[id.invoice])).rows[0].x;
    await t.test('a consumed lot aborts the repair before any product or quantity changes',async()=>{
      await q('update inventory_batches set quantity_remaining=209 where source_line_id=$1',[id.initialLine]);
      await assert.rejects(db.exec(repair),/consumo o cambios de lote/);
      assert.equal((await q('select active from products where id=$1',[id.old])).rows[0].active,true);
      assert.equal(Number((await q('select factor_to_base from movement_lines where id=$1',[id.entryLine])).rows[0].factor_to_base),15);
      await q('update inventory_batches set quantity_remaining=210 where source_line_id=$1',[id.initialLine]);
    });
    await t.test('the correction unifies 14 + 72 rolls as 86 units at the same USD 2193 value',async()=>{
      await db.exec(repair);
      const stock=(await q('select product_id,sum(quantity_remaining)::float quantity,sum(quantity_remaining*unit_cost)::float value from inventory_batches group by product_id')).rows;
      assert.equal(stock.length,1);assert.equal(stock[0].product_id,id.wire);assert.equal(stock[0].quantity,86);assert.equal(stock[0].value,2193);
      const lines=(await q('select quantity::float,factor_to_base::float,base_quantity::float,entry_unit_cost::float,product_id from movement_lines order by quantity')).rows;
      assert.deepEqual(lines.map(x=>x.base_quantity),[14,72]);assert.ok(lines.every(x=>x.product_id===id.wire&&x.factor_to_base===1&&x.entry_unit_cost===25.5));
      const lots=(await q('select quantity_remaining::float q,unit_cost::float c from inventory_batches order by quantity_remaining')).rows;
      assert.deepEqual(lots,[{q:14,c:25.5},{q:72,c:25.5}]);
      assert.equal((await q('select active from products where id=$1',[id.old])).rows[0].active,false);
      assert.equal(Number((await q('select factor_to_base from purchase_items where id=$1',[id.item])).rows[0].factor_to_base),1);
      assert.deepEqual((await q('select to_jsonb(d) x from purchase_documents d where id=$1',[id.invoice])).rows[0].x,invoiceBefore);
      assert.equal((await q('select count(*)::int n from purchase_receipts')).rows[0].n,1);
      const log=(await q("select detail from audit_events where action='wst_inventory_unified_in_units'")).rows[0].detail;
      assert.equal(log.total_units,86);assert.equal(log.stock_value_before,log.stock_value_after);assert.ok(log.before.lines.length&&log.after.batches.length);
    });
    await t.test('repeating the same repair neither doubles stock nor creates another audit',async()=>{
      await db.exec(repair);assert.equal((await q("select count(*)::int n from audit_events where action='wst_inventory_unified_in_units'")).rows[0].n,1);
      assert.equal(Number((await q('select sum(quantity_remaining) n from inventory_batches')).rows[0].n),86);
    });
    await t.test('manual purchase and stock APIs reject weight masquerading as a count factor',async()=>{
      await assert.rejects(q('update purchase_items set factor_to_base=15 where id=$1',[id.item]),/conversión debe ser 1/);
      await assert.rejects(q('update movement_lines set factor_to_base=15 where id=$1',[id.entryLine]),/conversión debe ser 1/);
      const before=(await q('select count(*)::int n from movements')).rows[0].n;
      await assert.rejects(q('select record_entry($1,null,null,$2::jsonb,null)',[id.wh,JSON.stringify([{product_id:id.wire,quantity:72,unit:'UN',factor_to_base:15,unit_cost:25.5,currency:'USD'}])]),/conversión debe ser 1/);
      assert.equal((await q('select count(*)::int n from movements')).rows[0].n,before);
    });
    await t.test('quote import reuses the active SKU and keeps the 15 kg package separate from unit conversion',async()=>{
      const result=(await q('select admin_create_purchase_from_quote($1::jsonb,$2::jsonb) x',[JSON.stringify({company_id:id.company,supplier_id:id.supplier,warehouse_id:id.wh,destination_type:'warehouse',currency:'USD'}),JSON.stringify([{product_code:'CHT711120P',description:'TUBULAR WST 15KG',quantity:72,unit:'UN',factor_to_base:15,base_unit:'kg',presentation:'15 kg',unit_price:25.5}])])).rows[0].x;
      const item=(await q('select * from purchase_items where purchase_id=$1',[result.purchase_id])).rows[0];
      assert.equal(item.product_id,id.wire);assert.equal(Number(item.factor_to_base),1);assert.equal(Number(item.quantity),72);assert.equal(Number(item.unit_price),25.5);assert.equal(item.affects_inventory,true);
      assert.equal((await q('select count(*)::int n from products')).rows[0].n,2);
      await q("update purchases set status='ordered' where id=$1",[result.purchase_id]);
      await login(id.depositor);await db.exec('set role authenticated');
      const payload=JSON.stringify([{purchase_item_id:item.id,quantity:72,request_id:randomUUID()}]);
      const receive=async()=>(await q('select receive_purchase($1,$2::jsonb) id',[result.purchase_id,payload])).rows[0].id;
      const receiptId=await receive();assert.equal(await receive(),receiptId);
      await login(id.admin);
      const posted=(await q('select l.quantity::float,l.factor_to_base::float,b.quantity_remaining::float,b.unit_cost::float from purchase_receipts r join movement_lines l on l.movement_id=r.movement_id join inventory_batches b on b.source_line_id=l.id where r.id=$1',[receiptId])).rows[0];
      assert.deepEqual(posted,{quantity:72,factor_to_base:1,quantity_remaining:72,unit_cost:25.5});
      assert.equal((await q('select count(*)::int n from purchase_receipts where purchase_id=$1',[result.purchase_id])).rows[0].n,1);
    });
    await t.test('depositor and anonymous callers cannot create purchases or invoke private guards',async()=>{
      await login(id.depositor);await db.exec('set role authenticated');
      await assert.rejects(q("select admin_create_purchase_from_quote('{}','[]')"),/Solo el administrador/);
      await assert.rejects(q('select avh_purchase_private.guard_stock_conversion()'),/permission denied/);
      await db.exec('reset role; set role anon');await assert.rejects(q("select admin_create_purchase_from_quote('{}','[]')"),/permission denied/);
    });
  }finally{await db.close();}
});
