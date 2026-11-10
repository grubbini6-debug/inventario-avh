import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
const source=fs.readFileSync(new URL('../src/features/purchases/purchase-lifecycle.js',import.meta.url),'utf8');
function ui(role='admin',destination='service'){
 const dom=new JSDOM('<section id="purchaseRecordEnhancements"></section><main id="modalBody"></main>',{url:'https://avh.test/',runScripts:'outside-only'}),w=dom.window,calls=[],alerts=[];
 const purchase={id:'p',supplier_name:'Grúas QA',po_number:'OC-AVH-001',purchase_type:destination==='service'?'service':'stock',destination_type:destination,status:'ordered',warehouse_id:destination==='warehouse'?'w':null};
 Object.assign(w,{$:s=>w.document.querySelector(s),$$:s=>[...w.document.querySelectorAll(s)],profile:{id:'gabriel',full_name:'Gabriel Ortega',role,warehouse_id:'w'},D:{purchases:[purchase],purchaseItems:[{id:'item',purchase_id:'p',description:'Grúa 35 t',quantity:6,received_qty:0,cancelled_qty:0,unit:'hora',affects_inventory:destination==='warehouse'}],purchaseReceipts:[],purchaseDocuments:[],profiles:[{id:'gabriel',full_name:'Gabriel Ortega',username:'admin.avh'}]},fmt:n=>String(n),msg:(element,text)=>{element.textContent=text;},openModal:(_title,_subtitle,html)=>{w.document.querySelector('#modalBody').innerHTML=html;},closeModal:()=>{w.document.querySelector('#modalBody').innerHTML='';},loadAll:async()=>{},alert:text=>alerts.push(text),openPurchaseDetail:async()=>{w.document.querySelector('#purchaseRecordEnhancements').innerHTML='';},request:async()=>({data:{}}),rpc:async(name,args)=>{calls.push({name,args});return{data:'receipt'};}});
 w.eval(source);return{w,calls,alerts,purchase,close:()=>w.close()};
}

test('a service requires actual quantities, date and details, then saves the confirmation and documents once',async()=>{
 const h=ui(),{w,calls}=h;
 try{
  await w.openPurchaseDetail('p');w.document.querySelector('#confirmDirectPurchase').click();
  assert.equal(w.document.querySelector('[data-direct-qty]').value,'','never assume the complete service was performed');
  await w.document.querySelector('#directSave').onclick();assert.match(w.document.querySelector('#directMsg').textContent,/cantidad/);assert.equal(calls.length,0);
  w.document.querySelector('[data-direct-qty]').value='7';await w.document.querySelector('#directSave').onclick();assert.equal(calls.length,0);
  w.document.querySelector('[data-direct-qty]').value='3';await w.document.querySelector('#directSave').onclick();assert.match(w.document.querySelector('#directMsg').textContent,/Describí/);
  w.document.querySelector('#directNotes').value='3 horas realizadas en Villeta.';
  Object.defineProperty(w.document.querySelector('#directInvoiceFile'),'files',{value:[new w.File(['PDF'],'factura.pdf',{type:'application/pdf'})]});
  await w.document.querySelector('#directSave').onclick();
  assert.equal(calls[0].name,'admin_confirm_direct_purchase');assert.equal(calls[0].args.p_items[0].quantity,3);
  assert.equal(calls[1].name,'register_purchase_receipt_document');assert.equal(calls[1].args.p_receipt_id,'receipt');assert.equal(calls[1].args.p_kind,'invoice');
  assert.equal(calls.filter(x=>x.name==='receive_purchase'||x.name==='record_entry').length,0);
 }finally{h.close();}
});

test('an uncertain response locks the submitted values and retries the same confirmation',async()=>{
 const h=ui(),{w,calls}=h;
 try{
  let attempt=0;w.rpc=async(name,args)=>{calls.push({name,args:JSON.parse(JSON.stringify(args))});return ++attempt===1?{network:true,error:'Conexión perdida'}:{data:'receipt'};};
  await w.openPurchaseDetail('p');w.document.querySelector('#confirmDirectPurchase').click();w.document.querySelector('[data-direct-qty]').value='2';w.document.querySelector('#directNotes').value='Conforme';
  await w.document.querySelector('#directSave').onclick();assert.equal(w.document.querySelector('[data-direct-qty]').disabled,true);assert.match(w.document.querySelector('#directMsg').textContent,/no se duplicará/);
  await w.document.querySelector('#directSave').onclick();assert.deepEqual(calls[0].args,calls[1].args);
 }finally{h.close();}
});

test('a document failure preserves the confirmation, and later attachment never confirms quantities again',async()=>{
 const h=ui(),{w,calls,alerts}=h;
 try{
  w.request=async()=>({error:'Archivo no disponible'});
  await w.openPurchaseDetail('p');w.document.querySelector('#confirmDirectPurchase').click();w.document.querySelector('[data-direct-qty]').value='1';w.document.querySelector('#directNotes').value='Servicio realizado';
  Object.defineProperty(w.document.querySelector('#directInvoiceFile'),'files',{value:[new w.File(['PDF'],'factura.pdf')]});
  await w.document.querySelector('#directSave').onclick();assert.equal(calls.length,1);assert.match(alerts[0],/conformidad quedó guardada/);
  w.D.purchaseReceipts.push({id:'receipt',purchase_id:'p',confirmation_type:'direct',received_by:'gabriel',effective_date:'2026-10-30',received_at:'2026-10-30T12:00:00Z',notes:'Conforme'});
  await w.openPurchaseDetail('p');assert.match(w.document.querySelector('#directPurchaseConfirmation').textContent,/Gabriel Ortega/);w.document.querySelector('[data-direct-docs]').click();
  w.request=async()=>({data:{}});Object.defineProperty(w.document.querySelector('#lateInvoiceFile'),'files',{value:[new w.File(['PDF'],'factura.pdf')]});
  await w.document.querySelector('#lateSaveDocs').onclick();assert.equal(calls.filter(x=>x.name==='admin_confirm_direct_purchase').length,1);assert.equal(calls.at(-1).name,'register_purchase_receipt_document');
 }finally{h.close();}
});

test('warehouse purchases and non-operating roles never show the direct confirmation action',async()=>{
 for(const [role,dest] of [['admin','warehouse'],['depositor','service'],['production','service'],['admin_viewer','service']]){
  const h=ui(role,dest);try{await h.w.openPurchaseDetail('p');assert.equal(h.w.document.querySelector('#confirmDirectPurchase'),null);}finally{h.close();}
 }
});
