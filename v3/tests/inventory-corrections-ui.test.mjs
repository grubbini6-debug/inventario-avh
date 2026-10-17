import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {PGlite} from '@electric-sql/pglite';
import {setupInitialInventory} from './helpers/initial-inventory-fixture.mjs';
import {setupInventoryCorrections} from './helpers/inventory-corrections-fixture.mjs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');

test('Admin removes erroneous inventory loads through a complete review and the real stock RPC',async t=>{
  const db=new PGlite(),ids={admin:randomUUID(),depositor:randomUUID(),inactive:randomUUID(),w:randomUUID(),a:randomUUID(),b:randomUUID()};
  const q=(sql,args=[])=>db.query(sql,args),calls=[],reads=[];
  const dom=new JSDOM('<div id="stockList"></div><div id="modal" class="hide"><div id="modalBody"></div></div>',{runScripts:'outside-only',url:'https://avh.test/'}),w=dom.window;
  const products=[{id:ids.a,name:'Alambre <prueba>',base_unit:'kg'},{id:ids.b,name:'Pieza adicional',base_unit:'unidad'}];
  const as=(actor,sql,args=[])=>db.transaction(async tx=>{await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:actor,role:'authenticated'})]);await tx.exec('set local role authenticated');return tx.query(sql,args)});
  const count=async(items,notes='Conteo')=>(await as(ids.depositor,'select record_initial_inventory($1,$2::jsonb,$3) id',[ids.w,JSON.stringify(items),notes])).rows[0].id;
  const item=(product,quantity,unit,factor=1)=>({product_id:product,quantity,unit,factor_to_base:factor});
  const stock=async product=>Number((await q('select coalesce(sum(quantity_remaining),0) n from inventory_batches where product_id=$1',[product])).rows[0].n);
  const rows=async filter=>{
    const params=new URLSearchParams(filter),conditions=[],args=[];
    for(const [key,column] of [['id','m.id'],['warehouse_to_id','m.warehouse_to_id']])if(params.has(key)){args.push(params.get(key).slice(3));conditions.push(`${column}=$${args.length}`)}
    for(const [key,column] of [['matched_lines.id','l.id'],['matched_lines.product_id','l.product_id']])if(params.has(key)){args.push(params.get(key).slice(3));conditions.push(`exists(select 1 from movement_lines l where l.movement_id=m.id and ${column}=$${args.length})`)}
    if(params.has('type'))conditions.push("m.type in ('initial','entry','return')");
    if(params.has('status'))conditions.push("m.status<>'cancelled'");
    return(await q(`select m.*,(select jsonb_agg(to_jsonb(l)||jsonb_build_object('products',jsonb_build_object('name',p.name,'base_unit',p.base_unit))) from movement_lines l join products p on p.id=l.product_id where l.movement_id=m.id) movement_lines,'[]'::jsonb purchase_receipts from movements m ${conditions.length?'where '+conditions.join(' and '):''} order by m.created_at desc`,args)).rows;
  };
  const change=(selector,value)=>{const el=w.document.querySelector(selector);if(typeof value==='boolean')el.checked=value;else el.value=value;el.dispatchEvent(new w.Event('change',{bubbles:true}))};
  try{
    await db.exec(read('./fixtures/fabrication-inventory.sql'));await setupInitialInventory(db);await setupInventoryCorrections(db);
    await q('insert into auth.users(id) select unnest($1::uuid[])',[[ids.admin,ids.depositor,ids.inactive]]);
    await q("insert into warehouses(id,code,name) values($1,'VH','Villa Hayes de prueba')",[ids.w]);
    await q("insert into profiles(id,username,role,warehouse_id,active) values($1,'compras','admin',null,true),($2,'deposito','depositor',$4,true),($3,'inactivo','admin',null,false)",[ids.admin,ids.depositor,ids.inactive,ids.w]);
    for(const p of products)await q('insert into products(id,name,base_unit) values($1,$2,$3)',[p.id,p.name,p.base_unit]);
    await q('insert into warehouse_opening_inventory(warehouse_id,opened_by) values($1,$2)',[ids.w,ids.admin]);
    const wrong=await count([item(ids.a,2,'caja',15),item(ids.b,4,'unidad')],'Carga duplicada'),good=await count([item(ids.a,5,'kg')]);
    let refreshes=0,completed=0;
    Object.assign(w,{profile:{id:ids.admin,role:'admin'},D:{products,moves:[]},product:id=>products.find(p=>p.id===id),whName:()=> 'Villa Hayes de prueba',
      $:s=>w.document.querySelector(s),$$:s=>[...w.document.querySelectorAll(s)],esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),fmt:v=>String(Number(v)),dt:v=>String(v),
      msg:(el,message)=>{el.textContent=message},loadAll:async()=>{refreshes++},
      renderStock:()=>{w.document.querySelector('#stockList').innerHTML=`<div data-stock="${ids.w}|${ids.a}"></div>`},
      openModal:(title,subtitle,html)=>{w.document.querySelector('#modalBody').innerHTML=html;w.document.querySelector('#modal').classList.remove('hide')},closeModal:()=>w.document.querySelector('#modal').classList.add('hide'),
      query:async(table,select,filter)=>{reads.push({table,select,filter});assert.equal(table,'movements');return{data:await rows(filter)}},
      queryAll:async(table,select,filter)=>{reads.push({table,select,filter});assert.match(select,/matched_lines:movement_lines!inner\(product_id\)/);assert.match(select,/movement_lines\(\*,products/);return{data:await rows(filter)}}
    });
    w.rpc=async(name,args)=>{assert.equal(name,'admin_void_movement');calls.push(args);try{return{data:(await as(w.profile.id,'select admin_void_movement($1,$2) id',[args.p_movement_id,args.p_reason])).rows[0].id}}catch(e){return{error:e.message}}};
    w.eval(read('../src/features/inventory/inventory-corrections.js'));
    await t.test('Only admin sees inventory removal; server rejects depositor and inactive admin',async()=>{
      for(const role of ['depositor','production']){
        w.profile.role=role;w.renderStock();assert.equal(w.document.querySelector('[data-remove-inventory]'),null);
        const before=reads.length;await w.AVHInventoryCorrections.open(ids.w,ids.a);assert.equal(reads.length,before);
      }
      for(const actor of [ids.depositor,ids.inactive])await assert.rejects(as(actor,'select admin_void_movement($1,$2)',[wrong,'No autorizado']),/Solo el administrador/);
      assert.equal(await stock(ids.a),35);w.profile.role='admin';w.renderStock();assert.ok(w.document.querySelector('[data-remove-inventory]'));
    });
    await t.test('Opening line resolves history beyond the 400 cached movements and reviews every item',async()=>{
      const line=(await q('select id from movement_lines where movement_id=$1 and product_id=$2',[wrong,ids.a])).rows[0].id;
      await w.AVHInventoryCorrections.openLine(line,{onSuccess:()=>{completed++}});
      assert.match(w.document.querySelector('#modalBody').textContent,/2 ítems/);assert.match(w.document.querySelector('#modalBody').textContent,/Pieza adicional/);assert.match(w.document.querySelector('#modalBody').textContent,/30 kg/);
      assert.match(w.document.querySelector('#modalBody').textContent,/Alambre <prueba>/);assert.equal(w.document.querySelector('prueba'),null);
      assert.ok(w.document.querySelector('#inventoryCorrectionSave').disabled);change('#inventoryCorrectionConfirm',true);
      await w.document.querySelector('#inventoryCorrectionSave').onclick();assert.equal(calls.length,0);assert.match(w.document.querySelector('#inventoryCorrectionMsg').textContent,/motivo/);
      change('#inventoryCorrectionReason','Duplicado al contar');
      const save=w.document.querySelector('#inventoryCorrectionSave').onclick;await Promise.all([save(),save()]);assert.equal(calls.length,1);
      assert.equal(await stock(ids.a),5);assert.equal(await stock(ids.b),0);assert.equal(refreshes,1);assert.equal(completed,1);
      assert.equal((await q('select status from movements where id=$1',[wrong])).rows[0].status,'cancelled');
      assert.equal((await q('select status from movements where id=$1',[good])).rows[0].status,'confirmed');
      const audit=(await q("select m.*, (select count(*) from movement_lines l where l.movement_id=m.id)::int items from movements m where corrected_movement_id=$1",[wrong])).rows[0];
      assert.equal(audit.created_by,ids.admin);assert.equal(audit.items,2);assert.match(audit.notes,/Duplicado al contar/);
      assert.equal((await q("select count(*)::int n from audit_events where movement_id=$1 and action='movement_cancelled' and actor_id=$2",[wrong,ids.admin])).rows[0].n,1);
      await assert.rejects(as(ids.admin,'select admin_void_movement($1,$2)',[wrong,'Reintento']),/ya está anulado/);
    });
    await t.test('Product lists complete matching history and preserves a load already used',async()=>{
      const used=await count([item(ids.b,6,'unidad')]);
      await as(ids.depositor,'select record_exit($1,null,null,$2,$3,$4::jsonb,null)',[ids.w,'Responsable','Taller',JSON.stringify([item(ids.b,1,'unidad')])]);
      await w.AVHInventoryCorrections.open(ids.w,ids.b);assert.equal(w.document.querySelectorAll('[data-review-inventory-load]').length,1);
      await w.document.querySelector('[data-review-inventory-load]').onclick();change('#inventoryCorrectionConfirm',true);change('#inventoryCorrectionReason','Se contó mal');
      await w.document.querySelector('#inventoryCorrectionSave').onclick();assert.match(w.document.querySelector('#inventoryCorrectionMsg').textContent,/ya fue utilizada/);assert.equal(await stock(ids.b),5);
      assert.equal((await q('select status from movements where id=$1',[used])).rows[0].status,'confirmed');
      assert.equal(w.document.querySelector('#inventoryCorrectionReason').value,'Se contó mal');assert.equal(w.document.querySelector('#inventoryCorrectionSave').disabled,false);
    });
    await t.test('Purchase receipt opens its own reversal workflow without a generic delete',async()=>{
      const originalQuery=w.query;w.query=async(...args)=>{const r=await originalQuery(...args);r.data.forEach(m=>m.purchase_receipts=[{id:randomUUID(),purchase_id:ids.a}]);return r};
      let purchaseId=null;w.openPurchaseDetail=id=>{purchaseId=id};
      const line=(await q('select id from movement_lines where movement_id=$1',[good])).rows[0].id;
      const before=calls.length;await w.AVHInventoryCorrections.openLine(line);assert.equal(w.document.querySelector('#inventoryCorrectionSave'),null);
      w.document.querySelector('[data-correction-purchase]').click();assert.equal(purchaseId,ids.a);assert.equal(calls.length,before);
    });
  }finally{dom.window.close();await db.close()}
});
