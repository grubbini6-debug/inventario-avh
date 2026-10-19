import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {PGlite} from '@electric-sql/pglite';
import {setupInitialInventory} from './helpers/initial-inventory-fixture.mjs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
test('Ordinary depositor chooses caja, unidad, kg or metro and counts stock with explicit conversion',async()=>{
 const db=new PGlite(),ids={admin:randomUUID(),user:randomUUID(),warehouse:randomUUID(),other:randomUUID(),kg:randomUUID(),unit:randomUUID(),metre:randomUUID()};
 const q=(sql,args=[])=>db.query(sql,args),calls=[];
 const dom=new JSDOM('<nav class="nav"><button data-page="home"></button><button data-page="stock"></button></nav><section class="page on" id="page-home"></section><section class="page" id="page-stock"><div class="section-head"></div></section><div class="modal hide" id="modal"><div id="modalBody"></div></div>',{url:'https://avh.test/',runScripts:'outside-only'}),w=dom.window;
 const products=[{id:ids.kg,name:'Alambre de prueba',base_unit:'kg',active:true},{id:ids.unit,name:'Equipo de prueba',base_unit:'unidad',active:true},{id:ids.metre,name:'Cable de prueba',base_unit:'metro',active:true}];
 const change=(id,value,event='input')=>{const el=w.document.querySelector(id);el.value=String(value);el.dispatchEvent(new w.Event(event,{bubbles:true}));};
 const selectUnit=unit=>{const select=w.document.querySelector('#depInitialPresentation'),option=[...select.options].find(o=>o.textContent===unit||o.textContent.startsWith(unit+' ·'));assert.ok(option,'Missing unit '+unit);change('#depInitialPresentation',option.value,'change');};
 const save=()=>w.document.querySelector('#depInitialSaveNext').onclick();
 try{
  await db.exec(read('./fixtures/fabrication-inventory.sql'));await setupInitialInventory(db);
  await db.exec(read('../migrations/20261008232715_fabricacion_naval.sql'));
  await db.exec(read('../migrations/20261009123306_initial_inventory_named_material.sql'));
  await db.exec(read('../migrations/20261019131602_depositor_manual_initial_inventory.sql'));
  await q('insert into auth.users(id) select unnest($1::uuid[])',[[ids.admin,ids.user]]);
  await q("insert into warehouses(id,code,name) values($1,'W','Depósito de prueba'),($2,'OTHER','Otro depósito')",[ids.warehouse,ids.other]);
  await q("insert into profiles(id,username,role,warehouse_id,active) values($1,'compras','admin',null,true),($2,'depositario','depositor',$3,true)",[ids.admin,ids.user,ids.warehouse]);
  for(const p of products)await q('insert into products(id,name,base_unit) values($1,$2,$3)',[p.id,p.name,p.base_unit]);
  await q('insert into warehouse_opening_inventory(warehouse_id,opened_by) values($1,$2)',[ids.warehouse,ids.admin]);
  Object.assign(w,{
   profile:{id:ids.user,username:'depositario',role:'depositor',warehouse_id:ids.warehouse},
   D:{products,presentations:[{product_id:ids.kg,label:'Rollo 12 kg',unit:'rollo',factor_to_base:12}],warehouses:[{id:ids.warehouse,name:'Depósito de prueba',active:true}],openingInventorySessions:[{warehouse_id:ids.warehouse,status:'open'}],moves:[],stocks:[],stockStatus:[],purchases:[],purchaseItems:[],barges:[]},
   $:s=>w.document.querySelector(s),$$:s=>[...w.document.querySelectorAll(s)],esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),fmt:v=>Number(v).toLocaleString('es-PY'),dt:v=>String(v),msg:(el,message)=>{el.textContent=message;},
   loadAll:async()=>{},renderHome:()=>{},renderStock:()=>{},goPage:()=>{},canRefreshView:()=>false,
   openModal:(title,subtitle,html)=>{w.document.querySelector('#modalBody').innerHTML=html;w.document.querySelector('#modal').classList.remove('hide');},
   AVHManufacturing:{allowed:()=>false,writable:()=>false},alert:message=>{throw Error(message);}
  });
  w.rpc=async(name,args)=>{
   assert.ok(['record_initial_inventory','record_initial_inventory_named'].includes(name));calls.push(structuredClone(args));
   try{return{data:await db.transaction(async tx=>{await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:ids.user,role:'authenticated'})]);await tx.exec('set local role authenticated');return(await tx.query(`select ${name}($1,$2::jsonb,$3) id`,[args.p_warehouse_id,JSON.stringify(args.p_items.map(i=>({...i,request_id:randomUUID()}))),args.p_notes])).rows[0].id;})};}catch(error){return{error:error.message};}
  };
  w.eval(read('../src/features/inventory/depositor-mobile-ai.js'));w.document.querySelector('#depInitialPriority').click();
  assert.equal(w.document.querySelector('#depInitialProduct').tagName,'INPUT','An ordinary depositor must be able to type a material without manufacturing access');
  change('#depInitialProduct',products[0].name);
  for(const unit of ['caja','unidad','kg','metro','litro','pieza','bolsa'])assert.ok([...w.document.querySelector('#depInitialPresentation').options].some(o=>o.textContent===unit),unit);
  selectUnit('caja');change('#depInitialQty',2);change('#depInitialLot','L-CAJAS');change('#depInitialNotes','Conteo físico por caja');
  await save();assert.equal(calls.length,0);assert.match(w.document.querySelector('#depInitialMsg').textContent,/cuántos kg tiene 1 caja/);
  change('#depInitialFactor',0);await save();assert.equal(calls.length,0);change('#depInitialFactor',-1);await save();assert.equal(calls.length,0);
  change('#depInitialFactor',15);assert.match(w.document.querySelector('#depInitialEquivalence').textContent,/30 kg/);
  const factorNode=w.document.querySelector('#depInitialFactor');
  w.D.presentations.unshift({product_id:ids.kg,label:'Paquete nuevo',unit:'paquete',factor_to_base:99});
  await w.loadAll(true);assert.equal(w.document.querySelector('#depInitialFactor'),factorNode);assert.equal(factorNode.value,'15');assert.equal(w.document.querySelector('#depInitialQty').value,'2');
  await save();assert.ok(w.document.querySelector('.success'));assert.equal(calls.length,1);assert.equal(calls[0].p_items[0].unit,'caja');assert.equal(calls[0].p_items[0].factor_to_base,15);assert.equal(calls[0].p_items[0].quantity,2);
  const line=(await q('select * from movement_lines limit 1')).rows[0];assert.equal(line.unit,'caja');assert.equal(Number(line.factor_to_base),15);assert.equal(line.entry_unit_cost,null);
  assert.equal((await q('select sum(quantity_remaining)::float n from inventory_batches where product_id=$1',[ids.kg])).rows[0].n,30);
  // Configured presentations keep their exact equivalence and need no manual entry.
  change('#depInitialProduct',products[0].name);selectUnit('Rollo 12 kg');assert.ok(w.document.querySelector('#depInitialFactorBlock').classList.contains('hide'));change('#depInitialQty',1);await save();assert.equal(calls.at(-1).p_items[0].factor_to_base,12);
  // Changing products clears a pending conversion, while the base-unit count remains direct.
  change('#depInitialProduct',products[0].name);selectUnit('caja');change('#depInitialFactor',99);change('#depInitialProduct',products[1].name);assert.equal(w.document.querySelector('#depInitialFactor').value,'');assert.ok(w.document.querySelector('#depInitialFactorBlock').classList.contains('hide'));change('#depInitialQty',5);await save();assert.equal(calls.at(-1).p_items[0].unit,'unidad');assert.equal(calls.at(-1).p_items[0].factor_to_base,1);
  change('#depInitialProduct',products[2].name);change('#depInitialQty',10);await save();assert.equal(calls.at(-1).p_items[0].unit,'metro');
  change('#depInitialProduct',products[0].name);change('#depInitialQty',7);await save();assert.equal(calls.at(-1).p_items[0].unit,'kg');
  assert.equal((await q('select sum(quantity_remaining)::float n from inventory_batches where product_id=$1',[ids.kg])).rows[0].n,49);
  assert.equal((await q('select sum(quantity_remaining)::float n from inventory_batches where product_id=$1',[ids.unit])).rows[0].n,5);
  assert.equal((await q('select sum(quantity_remaining)::float n from inventory_batches where product_id=$1',[ids.metre])).rows[0].n,10);
  assert.equal((await q('select count(*)::int n from inventory_batches where warehouse_id=$1',[ids.other])).rows[0].n,0);
  assert.equal((await q('select base_unit from products where id=$1',[ids.kg])).rows[0].base_unit,'kg');
  // An empty catalog and an absent manufacturing module must still allow a typed physical count.
  w.D.products=[];delete w.AVHManufacturing;w.document.querySelector('#depInitialPriority').click();
  const materialInput=w.document.querySelector('#depInitialProduct');materialInput.focus();change('#depInitialProduct','D');
  selectUnit('caja');change('#depInitialQty',4);change('#depInitialLot','L-NUEVO');change('#depInitialNotes','Conteo manual sin fabricación');
  for(const letter of 'isco de corte 7 pulgadas')change('#depInitialProduct',materialInput.value+letter);
  assert.equal(w.document.querySelector('#depInitialProduct'),materialInput);assert.equal(w.document.activeElement,materialInput);
  assert.equal(w.document.querySelector('#depInitialPresentation').value,'caja');assert.equal(w.document.querySelector('#depInitialQty').value,'4');assert.equal(w.document.querySelector('#depInitialLot').value,'L-NUEVO');
  await save();assert.ok(w.document.querySelector('.success'));assert.equal(calls.at(-1).p_items[0].product_name,'Disco de corte 7 pulgadas');
  const added=(await q("select b.quantity_remaining,b.unit_cost,b.currency,b.warehouse_id,p.base_unit,p.created_by from inventory_batches b join products p on p.id=b.product_id where p.name='Disco de corte 7 pulgadas'")).rows;
  assert.equal(added.length,1);assert.equal(Number(added[0].quantity_remaining),4);assert.equal(added[0].base_unit,'caja');assert.equal(added[0].unit_cost,null);assert.equal(added[0].currency,null);assert.equal(added[0].created_by,ids.user);assert.equal(added[0].warehouse_id,ids.warehouse);
 }finally{dom.window.close();await db.close();}
});
