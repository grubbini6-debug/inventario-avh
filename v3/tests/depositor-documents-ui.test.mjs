import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';

const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const complete='../src/features/inventory/depositor-complete-mobile.js';
const lifecycle='../src/features/purchases/purchase-lifecycle.js';
const mainPurchase={id:'p',po_number:'OC-1',supplier_name:'Proveedor',destination_type:'warehouse',warehouse_id:'ac',status:'partially_received',invoice_number:'FACTURA-DE-OTRA-ENTREGA',invoice_date:'2001-01-01'};
const receipts=[
 {id:'old',purchase_id:'p',received_at:'2026-10-10T12:00:00Z'},
 {id:'latest',purchase_id:'p',received_at:'2026-10-12T12:00:00Z'},
 {id:'void',purchase_id:'p',received_at:'2026-10-13T12:00:00Z',voided_at:'2026-10-14T12:00:00Z'},
 {id:'release',purchase_id:'p',received_at:'2026-10-14T12:00:00Z',depot_parent_receipt_id:'old'},
 {id:'foreign',purchase_id:'other',received_at:'2026-10-15T12:00:00Z'}
];
const docs=[{id:'invoice-latest',purchase_id:'p',receipt_id:'latest',kind:'invoice',document_number:'FACTURA-NUEVA',document_date:'2026-10-12',created_at:'2026-10-12T13:00:00Z'}];
const variants=[
 {name:'home',file:complete,button:'[data-dep-complete-docs]',receiptData:'depReceiptId',invoiceNo:'#depDocInvoiceNo',invoiceDate:'#depDocInvoiceDate',invoiceFile:'#depDocInvoiceFile',remitNo:'#depDocRemitNo',remitDate:'#depDocRemitDate',remitFile:'#depDocRemitFile',save:'#depDocSave'},
 {name:'receipts module',file:lifecycle,button:'[data-life-docs]',receiptData:'lifeReceiptId',invoiceNo:'#lateInvoiceNo',invoiceDate:'#lateInvoiceDate',invoiceFile:'#lateInvoiceFile',remitNo:'#lateRemitNo',remitDate:'#lateRemitDate',remitFile:'#lateRemitFile',save:'#lateSaveDocs'}
];
function home(anchor){return '<div class="dep-home"><div class="dep-actions"></div><div class="'+anchor+'"></div><div class="section-head"><h2>Actividad de hoy</h2></div><div class="list"></div></div>';}
function harness(variant,{anchor='dep-today',extraDocs=[]}={}){
 const dom=new JSDOM('<section id="page-home">'+home(anchor)+'</section><div id="moduleContent"></div><div id="modalBody"></div>',{url:'https://avh.test/',runScripts:'outside-only'}),w=dom.window,calls=[],alerts=[];
 Object.assign(w,{
  $:s=>w.document.querySelector(s),$$:s=>[...w.document.querySelectorAll(s)],
  profile:{id:'user',role:'depositor',warehouse_id:'ac'},
  D:{warehouses:[{id:'ac',name:'ACOMAR',active:true}],purchases:[structuredClone(mainPurchase),{...mainPurchase,id:'other',warehouse_id:'foreign'}],purchaseReceipts:structuredClone(receipts),purchaseDocuments:structuredClone([...docs,...extraDocs]),purchaseItems:[],moves:[],stockStatus:[],supplyRequests:[],openingInventorySessions:[],products:[]},
  esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  fmt:v=>String(v),dt:v=>String(v),goPage:()=>{},renderStock:()=>{},
  alert:m=>alerts.push(m),msg:(el,m)=>{el.textContent=m;},
  openModal:(title,subtitle,html)=>{w.document.querySelector('#modalBody').innerHTML=html;},
  closeModal:()=>calls.push({type:'close'}),loadAll:async()=>{calls.push({type:'load'});},
  request:async(path)=>{calls.push({type:'upload',path});return{data:{}};},
  rpc:async(name,args)=>{calls.push({type:'rpc',name,args:JSON.parse(JSON.stringify(args))});return{data:'doc-'+args.p_kind};},
  AVHPurchaseControl:{analyzeInvoice:async(p,id)=>{calls.push({type:'analysis',p,id});}},
  openPurchaseDetail:async()=>{}
 });
 w.eval(read(variant.file));
 if(variant.name!=='home')w.renderPurchaseReceipts();
 return{w,dom,calls,alerts,close:()=>dom.window.close()};
}
const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
const file=(w,selector,name)=>Object.defineProperty(w.document.querySelector(selector),'files',{configurable:true,value:[new w.File(['test'],name,{type:'application/pdf'})]});

for(const variant of variants){
 test(variant.name+': pending invoices belong to each active receipt, including partial deliveries',async()=>{
  const h=harness(variant);try{
   await settle();
   const buttons=[...h.w.document.querySelectorAll(variant.button)];
   assert.deepEqual(buttons.map(x=>x.dataset[variant.receiptData]),['old'],'a newer invoiced receipt must not hide the older pending receipt; voided, release and foreign receipts are excluded');
   assert.match(buttons[0].closest('.dep-attention-row,.row').textContent,/OC-1.*falta factura/);
   if(variant.name==='home'){
    h.w.document.body.appendChild(h.w.document.createElement('div'));await settle();
    assert.equal(h.w.document.querySelectorAll('#depAttention').length,1,'DOM notifications must not duplicate the panel');
    h.w.document.querySelector('#page-home').innerHTML=home('dep-today');await settle();
    assert.equal(h.w.document.querySelectorAll('#depAttention').length,1,'a re-rendered home must restore the panel');
   }
   assert.deepEqual(h.alerts,[]);
  }finally{h.close();}
 });
 test(variant.name+': document upload targets the selected older receipt and leaves unknown dates empty',async()=>{
  const h=harness(variant);try{
   h.w.document.querySelector(variant.button).click();
   assert.equal(h.w.document.querySelector(variant.invoiceNo).value,'','do not borrow the invoice number from the purchase header or another receipt');
   assert.equal(h.w.document.querySelector(variant.invoiceDate).value,'');
   assert.equal(h.w.document.querySelector(variant.remitDate).value,'');
   assert.equal(h.w.document.querySelector(variant.remitNo).value,'');
   file(h.w,variant.invoiceFile,'factura.pdf');file(h.w,variant.remitFile,'remito.pdf');
   await h.w.document.querySelector(variant.save).onclick();
   const saved=h.calls.filter(x=>x.type==='rpc');
   assert.deepEqual(saved.map(x=>x.name),['register_purchase_receipt_document','register_purchase_receipt_document'],'attaching documents must not invoke a stock mutation');
   assert.deepEqual(saved.map(x=>[x.args.p_receipt_id,x.args.p_kind,x.args.p_document_date]),[['old','invoice',null],['old','remittance',null]]);
   assert.deepEqual(h.calls.find(x=>x.type==='analysis'),{type:'analysis',p:'p',id:'doc-invoice'});
   assert.ok(h.calls.some(x=>x.type==='close'));
   assert.deepEqual(h.alerts,[]);
  }finally{h.close();}
 });
 test(variant.name+': existing remittance metadata comes only from the selected receipt',()=>{
  const h=harness(variant,{extraDocs:[
   {id:'old-remit',purchase_id:'p',receipt_id:'old',kind:'remittance',document_number:'REM-ANTIGUO',document_date:'2026-10-09',created_at:'2026-10-10T13:00:00Z'},
   {id:'old-remit-newer',purchase_id:'p',receipt_id:'old',kind:'remittance',document_number:'REM-CORREGIDO',document_date:'2026-10-10',created_at:'2026-10-11T13:00:00Z'},
   {id:'other-remit',purchase_id:'p',receipt_id:'latest',kind:'remittance',document_number:'REM-OTRA-ENTREGA',document_date:'2026-10-12',created_at:'2026-10-12T13:00:00Z'}
  ]});try{
   h.w.document.querySelector(variant.button).click();
   assert.equal(h.w.document.querySelector(variant.remitNo).value,'REM-CORREGIDO');
   assert.equal(h.w.document.querySelector(variant.remitDate).value,'2026-10-10');
   assert.equal(h.w.document.querySelector(variant.invoiceDate).value,'');
  }finally{h.close();}
 });
}

test('attention panel also works with the legacy KPI anchor and with the actions fallback',async()=>{
 for(const anchor of ['dep-kpis','unrelated']){
  const h=harness(variants[0],{anchor});try{await settle();assert.equal(h.w.document.querySelectorAll('#depAttention').length,1);}finally{h.close();}
 }
});

test('legacy manual reception asks for actual invoice and remittance dates',()=>{
 const h=harness(variants[1]);try{
  h.w.document.querySelector('[data-life-receive]').click();
  assert.equal(h.w.document.querySelector('#lifeInvoiceDate').value,'');
  assert.equal(h.w.document.querySelector('#lifeRemitDate').value,'');
 }finally{h.close();}
});

test('initial inventory cannot silently turn a blank price into zero or assume its currency',async()=>{
 const dom=new JSDOM('<div id="adminBox"></div>',{url:'https://avh.test/',runScripts:'outside-only'}),w=dom.window,prices=[],alerts=[];
 const row={movement_line_id:'line',product_id:'product',product_name:'Producto',quantity:2,unit:'unidad',base_quantity:2,movement_no:1,entry_unit_cost:null,entry_currency:null,priced:false};
 Object.assign(w,{
  profile:{role:'admin'},D:{warehouses:[{id:'ac',name:'ACOMAR',active:true}],openingInventorySessions:[]},
  $:s=>w.document.querySelector(s),$$:s=>[...w.document.querySelectorAll(s)],esc:v=>String(v??''),fmt:v=>String(v),product:()=>({base_unit:'unidad'}),
  query:async()=>({data:[{warehouse_id:'ac',status:'open'}]}),
  rpc:async(name,args)=>{if(name==='admin_opening_inventory_lines')return{data:[{...row}]};if(name==='admin_price_initial_inventory'){prices.push(args);Object.assign(row,{entry_unit_cost:args.p_unit_cost,entry_currency:args.p_currency,priced:true});return{data:true};}throw Error('Unexpected RPC '+name);},
  alert:m=>alerts.push(m),confirm:()=>true,msg:(el,m)=>{el.textContent=m;}
 });
 try{
  w.eval(read('../src/features/admin/opening-inventory.js'));w.adminOpeningInventory();await settle();
  const price=()=>w.document.querySelector('[data-opening-price]'),currency=()=>w.document.querySelector('[data-opening-currency]'),save=()=>w.document.querySelector('[data-save-opening-price]').onclick();
  assert.equal(price().value,'');assert.equal(currency().value,'');
  await save();assert.equal(prices.length,0);assert.match(alerts.at(-1),/precio/);
  currency().value='PYG';await save();assert.equal(prices.length,0,'choosing a currency must not make a blank price valid');
  price().value='10';currency().value='';await save();assert.equal(prices.length,0);assert.match(alerts.at(-1),/moneda/);
  price().value='-1';currency().value='USD';await save();assert.equal(prices.length,0);
  price().value='0';currency().value='USD';await save();
  assert.equal(prices.length,1,'an explicitly entered zero remains a valid deliberate choice');
  assert.equal(prices[0].p_unit_cost,0);assert.equal(prices[0].p_currency,'USD');
  assert.equal(price().value,'0');assert.equal(currency().value,'USD','a saved currency remains selected after re-render');
  price().value='25.5';await save();assert.equal(prices[1].p_unit_cost,25.5);assert.equal(prices[1].p_currency,'USD');
 }finally{dom.window.close();}
});
