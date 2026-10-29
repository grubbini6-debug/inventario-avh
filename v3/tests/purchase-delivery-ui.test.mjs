import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
const source=fs.readFileSync(new URL('../src/features/purchases/delivery-management.js',import.meta.url),'utf8');
function ui(role='admin'){
 const dom=new JSDOM('<main id="purchaseRecordEnhancements"></main><div id="modalBody"></div>',{url:'https://avh.test',runScripts:'outside-only'}),w=dom.window,calls=[];
 Object.assign(w,{profile:{role},D:{warehouses:[{id:'ac',name:'ACOMAR',active:true},{id:'vh',name:'Villa Hayes',active:true},{id:'vil',name:'Villeta',active:true},{id:'mar',name:'Mariano',active:true}],purchases:[{id:'p',po_number:'OC-47',destination_type:'warehouse',warehouse_id:'ac',delivery_warehouse_ids:['ac','vh','vil'],status:'partially_received'}],purchaseItems:[{id:'disc',purchase_id:'p',description:'Discos',quantity:50,received_qty:20,cancelled_qty:0,unit:'unidad'},{id:'gloves',purchase_id:'p',description:'Guantes',quantity:20,received_qty:0,cancelled_qty:20,cancellation_reason:'Proveedor sin stock',unit:'unidad'}]},esc:v=>String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),fmt:v=>String(v),dt:v=>String(v),msg:(e,m)=>{e.textContent=m;},openPurchaseDetail:async()=>{},openModal:(_t,_s,html)=>{w.document.querySelector('#modalBody').innerHTML=html;},closeModal:()=>{w.document.querySelector('#modalBody').innerHTML='';},loadAll:async()=>{},rpc:async(name,args)=>{calls.push({name,args:JSON.parse(JSON.stringify(args))});return{data:{}};}});
 w.eval(source);return{w,calls,close:()=>w.close()};
}
test('Compras can choose receiving depots without inventing a quantity allocation',async()=>{
 const h=ui();try{
  await h.w.openPurchaseDetail('p');
  assert.match(h.w.document.querySelector('#purchaseDeliveryManagement').textContent,/Saldo compartido/);
  assert.deepEqual([...h.w.document.querySelectorAll('[data-delivery-warehouse]:checked')].map(x=>x.dataset.deliveryWarehouse),['ac','vh','vil']);
  assert.equal(h.w.document.querySelector('[data-delivery-warehouse="ac"]').disabled,true);
  assert.equal(h.w.document.querySelectorAll('#purchaseDeliveryManagement input[type="number"]').length,0);
  await h.w.document.querySelector('#purchaseDeliverySave').onclick();
  assert.deepEqual(h.calls,[{name:'admin_set_purchase_delivery_warehouses',args:{p_purchase_id:'p',p_warehouse_ids:['ac','vh','vil']}}]);
 }finally{h.close();}
});
test('closing a missing balance requires a reason and excludes already cancelled quantities',async()=>{
 const h=ui();try{
  await h.w.openPurchaseDetail('p');h.w.document.querySelector('#purchaseCloseBalance').click();
  assert.equal(h.w.document.querySelectorAll('[data-close-balance-item]').length,1);
  assert.match(h.w.document.querySelector('#modalBody').textContent,/Cancelar saldo: 30 unidad/);
  await h.w.document.querySelector('#balanceCloseSave').onclick();assert.equal(h.calls.length,0);assert.match(h.w.document.querySelector('#balanceCloseMsg').textContent,/Indicá por qué/);
  h.w.document.querySelector('#balanceCloseReason').value='El proveedor no enviará los 30 discos restantes.';await h.w.document.querySelector('#balanceCloseSave').onclick();
  assert.deepEqual(h.calls,[{name:'admin_cancel_purchase_balance',args:{p_purchase_id:'p',p_item_ids:['disc'],p_reason:'El proveedor no enviará los 30 discos restantes.'}}]);
 }finally{h.close();}
});
test('depositors and read-only administrators do not get delivery or balance mutation controls',async()=>{
 for(const role of ['depositor','production','admin_viewer']){const h=ui(role);try{await h.w.openPurchaseDetail('p');assert.equal(h.w.document.querySelector('#purchaseDeliveryManagement'),null);assert.equal(h.calls.length,0);}finally{h.close();}}
});
