import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {JSDOM} from 'jsdom';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
function harness(role='depositor'){
 const dom=new JSDOM('<nav class="nav"></nav><section id="page-home"></section><section id="page-stock"><div class="section-head"></div></section><div id="modalBody"></div>',{url:'https://avh.test/',runScripts:'outside-only'}),w=dom.window;
 Object.defineProperty(w.crypto,'randomUUID',{value:randomUUID});
 const calls=[];
 Object.assign(w,{$:s=>w.document.querySelector(s),$$:s=>[...w.document.querySelectorAll(s)],profile:{id:'user',role,warehouse_id:'w'},D:{products:[{id:'wire',name:'Material de prueba',base_unit:'unidad',active:true}],stocks:[{warehouse_id:'w',product_id:'wire',product_name:'Material de prueba',stock_qty:20}],presentations:[],warehouses:[{id:'w',name:'Depósito de prueba',active:true}],barges:[{id:'barge',number:7,active:true}],suppliers:[],moves:[],stockStatus:[],purchases:[],purchaseItems:[],openingInventorySessions:[],bargeConsumption:[]},
 fmt:v=>String(v),money:(v,c)=>c+' '+v,dt:v=>String(v),esc:v=>String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),
 msg:(el,m)=>{el.textContent=m;},openModal:(title,subtitle,html)=>{w.document.querySelector('#modalBody').innerHTML=html;},closeModal:()=>{},loadAll:async()=>{},renderHome:()=>{},renderStock:()=>{},goPage:()=>{},canRefreshView:()=>false,alert:m=>{throw Error(m);},
 TYPE_LABEL:{exit:'Salida'},activeWhOptions:()=>'<option value="w">Depósito de prueba</option>',product:id=>w.D.products.find(x=>x.id===id),whName:()=> 'Depósito de prueba',AVHManufacturing:{allowed:()=>false,writable:()=>false},
 rpc:async(name,args)=>{calls.push({name,args:JSON.parse(JSON.stringify(args))});return{data:'movement'};}
 });
 const set=(selector,value,event='input')=>{const el=w.document.querySelector(selector);el.value=String(value);el.dispatchEvent(new w.Event(event,{bubbles:true}));return el;};
 return{dom,w,calls,set,close:()=>w.close()};
}
test('mobile depositor splits one product between two module destinations and validates every line',async()=>{
 const h=harness('admin'),{w,set}=h;
 try{
  w.eval(read('../src/features/inventory/barge-modules.js'));
  w.eval(read('../src/features/inventory/depositor-mobile-ai.js'));w.profile.role='depositor';
  w.AVHDepositorManual.openExit();
  set('#depExitBarge','barge','change');set('#depExitQty',4);w.document.querySelector('#depAddManualExit').click();
  set('[data-dep-hull-row="0"] [data-hull-section]','fondo','change');const field=set('[data-dep-hull-row="0"] [data-hull-module]','f12');
  assert.equal(w.document.activeElement===field,false);assert.equal(w.document.querySelector('[data-dep-hull-row="0"] [data-hull-module]'),field);
  set('#depExitQty',6);w.document.querySelector('#depAddManualExit').click();
  assert.equal(w.document.querySelector('[data-dep-hull-row="0"] [data-hull-module]').value,'f12','adding another material preserves the first destination');
  set('#depExitPerson','Persona de prueba');set('#depExitDestination','Trabajo de prueba');
  await w.document.querySelector('#depConfirmManualExit').onclick();assert.equal(h.calls.length,0);assert.match(w.document.querySelector('#depExitMsg').textContent,/parte/);
  set('[data-dep-hull-row="1"] [data-hull-section]','costado','change');set('[data-dep-hull-row="1"] [data-hull-module]','co3');
  await w.document.querySelector('#depConfirmManualExit').onclick();
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].name,'record_exit');
  assert.deepEqual(h.calls[0].args.p_items.map(x=>[x.quantity,x.naval_section,x.naval_module]),[[4,'fondo','F12'],[6,'costado','CO3']]);
  assert.equal(h.calls[0].args.p_barge_id,'barge');
 }finally{h.close();}
});
test('desktop exit keeps module data across cart redraws and includes it in the saved stock RPC',async()=>{
 const h=harness('admin'),{w,set}=h;
 try{
  w.eval(read('../src/features/inventory/operations.js')+'\n'+read('../src/features/inventory/forms-and-presentations.js')+'\n'+read('../src/features/inventory/barge-modules.js')+'\nwindow.testCart=()=>cart;');
  w.openMovement('exit');set('#moveBargeSel','barge','change');set('[data-f="qty"]',3);
  set('[data-hull-section]','proa','change');set('[data-hull-module]','P01');
  w.renderCart();assert.equal(w.document.querySelector('[data-hull-module]').value,'P01');
  await w.document.querySelector('#movementForm').onsubmit({preventDefault(){}});
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].args.p_items[0].naval_section,'proa');assert.equal(h.calls[0].args.p_items[0].naval_module,'P01');
 }finally{h.close();}
});
test('general deliveries clear a stale module and no-barge deliveries never keep a naval allocation',()=>{
 const h=harness();try{
  h.w.eval(read('../src/features/inventory/barge-modules.js'));const M=h.w.AVHHullCosts,row={naval_section:'fondo',naval_module:'F12'};
  h.w.document.querySelector('#modalBody').innerHTML=M.fieldsHTML(row);M.bindFields(h.w.document.querySelector('#modalBody'),row,true);
  h.set('[data-hull-section]','general','change');assert.equal(row.naval_module,'');assert.equal(h.w.document.querySelector('[data-hull-module]').disabled,true);
  assert.equal(M.problem(row,'barge'),null);assert.deepEqual(JSON.parse(JSON.stringify(M.metadata({naval_section:'fondo',naval_module:'F12'},null))),{naval_section:null,naval_module:null});
  assert.match(M.problem({naval_section:'fondo',naval_module:'x'.repeat(41)},'barge'),/40/);
 }finally{h.close();}
});
test('admin module report filters destinations, separates currencies and shows missing valuation',async()=>{
 const h=harness('admin'),{w,set}=h;
 try{
  w.queryAll=async()=>({data:[
   {naval_section:'fondo',naval_module:'F12',product_name:'Material de prueba',base_unit:'unidad',base_quantity:4,currency:'PYG',real_cost:40,priced_quantity:4,unpriced_quantity:0},
   {naval_section:'costado',naval_module:'CO3',product_name:'Material de prueba',base_unit:'unidad',base_quantity:6,currency:'USD',real_cost:12,priced_quantity:6,unpriced_quantity:0},
   {naval_section:null,naval_module:null,product_name:'Material histórico',base_unit:'kg',base_quantity:2,currency:null,real_cost:0,priced_quantity:0,unpriced_quantity:2}
  ]});
  w.eval(read('../src/features/inventory/barge-modules.js'));await w.openBarge('barge');
  assert.equal(w.document.querySelectorAll('.hull-cost-section').length,3);assert.match(w.document.body.textContent,/PYG 40.*USD 12/);assert.match(w.document.body.textContent,/total valorizado es parcial/);
  set('#hullCostModule','F12');assert.equal(w.document.querySelectorAll('.hull-cost-section').length,1);assert.match(w.document.querySelector('#hullCostRows').textContent,/F12/);assert.doesNotMatch(w.document.querySelector('#hullCostRows').textContent,/CO3/);
  set('#hullCostModule','');set('#hullCostSection','unclassified','change');assert.match(w.document.querySelector('#hullCostRows').textContent,/Sin valorizar/);
 }finally{h.close();}
});
test('module CSV includes the allocation and does not execute a supplier-provided spreadsheet formula',()=>{
 const h=harness();try{
  h.w.eval(read('../src/features/inventory/barge-modules.js'));const csv=h.w.AVHHullCosts.exportRows([{naval_section:'fondo',naval_module:'F12',product_name:'=2+2',base_quantity:4,base_unit:'unidad',currency:null,real_cost:0,priced_quantity:0,unpriced_quantity:4}],7);
  assert.match(csv,/Módulo/);assert.match(csv,/"F12"/);assert.ok(csv.includes("\"'=2+2\""));assert.ok(csv.includes('"unidad";"";"";"4"'),'unpriced stock is not exported as a known zero cost');
 }finally{h.close();}
});
