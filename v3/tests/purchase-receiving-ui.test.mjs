import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const wire={id:'wst',sku:'CHT711120P',name:'TUBULAR WST E71T1C 1,2MM 15KG PREMIUM',base_unit:'unidad',active:true};
const presentations=[{product_id:'wst',unit:'rollo',label:'Rollo 15 kg',factor_to_base:1}];
function ui(){
  const dom=new JSDOM('<main id="modalBody"></main>',{url:'https://avh.test',runScripts:'outside-only'}),w=dom.window;
  Object.assign(w,{$:s=>w.document.querySelector(s),$$:s=>[...w.document.querySelectorAll(s)],profile:{id:'admin',role:'admin'},D:{products:[wire],presentations,suppliers:[],purchaseCompanies:[],warehouses:[],barges:[]},fmt:n=>String(n),money:(n,c)=>`${c} ${Number(n).toFixed(2)}`,msg:(el,text)=>{el.textContent=text;},openModal:(title,subtitle,html)=>{w.document.querySelector('#modalBody').innerHTML=html;},closeModal:()=>{},loadAll:async()=>{},openPurchaseDetail:async()=>{}});
  w.eval(read('../edge-functions/_shared/product-identity.js'));w.eval(read('../edge-functions/_shared/purchase-receiving-model.js'));return{dom,w};
}

test('quote preview uses the catalog stock unit and refuses a manually restored 15x count factor',async()=>{
  const {w}=ui();let saves=0;
  try{
    w.D.warehouses=[{id:'ac',name:'ACOMAR',active:true}];w.D.purchaseCompanies=[{id:'maq',name:'MAQMOVEIS',active:true}];
    w.FileReader=class{readAsDataURL(){this.result='data:application/pdf;base64,AAAA';queueMicrotask(()=>this.onload());}};
    w.edge=async()=>({data:{document:{currency:'USD',total:1836,confidence:.99,supplier_name:'COMAGRO',items:[{description:wire.name,product_code:wire.sku,quantity:72,unit:'UN',base_unit:'kg',factor_to_base:15,unit_price:25.5,presentation:'15 kg'}]}}});
    w.rpc=async()=>{saves++;return{error:'Unexpected save'};};
    w.eval(read('../src/features/purchases/smart-purchase-flow.js'));w.AVHSmartPurchase.open();
    const input=w.document.querySelector('#smartFile');Object.defineProperty(input,'files',{value:[new w.File(['PDF'],'quote.pdf',{type:'application/pdf'})]});await input.onchange();
    assert.equal(w.document.querySelector('[data-product]').value,'wst');
    assert.equal(w.document.querySelector('[data-factor]').value,'1');
    assert.match(w.document.querySelector('[data-smart-stock-preview]').textContent,/72 unidad.*15 kg.*1080 kg/);
    w.document.querySelector('#smartCompany').value='maq';w.document.querySelector('[data-factor]').value='15';await w.document.querySelector('#smartGenerate').onclick();
    assert.match(w.document.querySelector('#smartGenerateMsg').textContent,/conversión debe ser 1/);assert.equal(saves,0);
  }finally{w.close();}
});

test('another abrasive brand stays new, missing prices remain blank and a conflicting manual link cannot be saved',async()=>{
 const {w}=ui();let saves=0,savedItem;
 try{
  w.D.products=[{id:'max',sku:'1633',name:'Disco de corte 4 1/2 pulgadas x 1,2 mm Maxflexx',brand:'Maxflexx',base_unit:'unidad',active:true}];w.D.warehouses=[{id:'ac',name:'ACOMAR',active:true}];w.D.purchaseCompanies=[{id:'maq',name:'MAQMOVEIS',active:true}];
  const doc={currency:null,confidence:.8,supplier_name:'Proveedor',items:[{brand:'Norton',description:'Disco de corte 4 1/2 pulgadas x 1,2 mm Norton',quantity:50,unit:'UN',unit_price:null,product_code:'1633'}]};
  w.FileReader=class{readAsDataURL(){this.result='data:application/pdf;base64,AAAA';queueMicrotask(()=>this.onload());}};w.edge=async()=>({data:{document:doc}});w.D.suppliers=[{id:'supplier',name:'Proveedor'}];w.rpc=async(name,args)=>{saves++;savedItem=args.p_items[0];return{error:'Stopped after validation'};};
  w.eval(read('../src/features/purchases/smart-purchase-flow.js'));w.AVHSmartPurchase.open();const input=w.document.querySelector('#smartFile');Object.defineProperty(input,'files',{value:[new w.File(['PDF'],'source.pdf',{type:'application/pdf'})]});await input.onchange();
  assert.equal(w.document.querySelector('[data-product]').value,'__auto__');assert.equal(w.document.querySelector('[data-price]').value,'');assert.equal(w.document.querySelector('#smartCurrency').value,'');assert.equal(w.document.querySelector('#smartCompany').value,'');
  await w.document.querySelector('#smartGenerate').onclick();assert.match(w.document.querySelector('#smartGenerateMsg').textContent,/moneda/);
  w.document.querySelector('#smartCurrency').value='PYG';w.document.querySelector('#smartCompany').value='maq';w.document.querySelector('[data-price]').value='2550';w.document.querySelector('[data-product]').value='max';
  await w.document.querySelector('#smartGenerate').onclick();assert.match(w.document.querySelector('#smartGenerateMsg').textContent,/marca no coincide/);assert.equal(saves,0);
  assert.equal(w.document.querySelector('[data-brand]').value,'Norton');w.document.querySelector('[data-brand]').value='Maxflexx';w.document.querySelector('[data-model]').value='MCA-1633';w.document.querySelector('[data-desc]').value=w.D.products[0].name;await w.document.querySelector('#smartGenerate').onclick();assert.equal(saves,1);assert.equal(savedItem.brand,'Maxflexx');assert.equal(savedItem.manufacturer_code,'MCA-1633');assert.equal(savedItem.product_id,'max');
 }finally{w.close();}
});

test('invoice control distinguishes included IVA, pending legacy readings and invalid stock conversion',async()=>{
  const {w}=ui();
  try{
    const purchase={id:'p',currency:'USD',supplier_id:'supplier',company_id:'company'},item={id:'i',purchase_id:'p',product_id:'wst',description:wire.name,quantity:72,received_qty:72,unit:'unidad',factor_to_base:1,unit_price:25.5,affects_inventory:true};
    const invoice={currency:'USD',supplier_name:'COMAGRO',supplier_tax_id:'123-4',customer_tax_id:'1234-5',total:1836,subtotal:1836,tax:166.91,items:[{description:wire.name,quantity:72,unit:'UN',factor_to_base:15,base_unit:'kg',unit_price:25.5,line_total:1836,confidence:.99}]};
    Object.assign(w.D,{purchases:[purchase],purchaseItems:[item],suppliers:[{id:'supplier',name:'COMAGRO',tax_id:'123-4'}],purchaseCompanies:[{id:'company',tax_id:'1234-5'}],purchaseDocuments:[{id:'doc',purchase_id:'p',kind:'invoice',created_at:'2026-10-19',analysis_status:'ok',analysis_data:invoice}]});
    w.eval(read('../src/features/purchases/purchase-document-control.js'));
    assert.equal(w.AVHPurchaseControl.controlState(purchase).state,'pending');
    invoice.tax_mode='included';assert.equal(w.AVHPurchaseControl.controlState(purchase).state,'ok');
    await w.openPurchaseDetail('p');assert.match(w.document.body.textContent,/IVA incluido en el total.*Total factura: USD 1836.00.*IVA: USD 166.91.*Neto: USD 1669.09/);
    item.factor_to_base=15;assert.equal(w.AVHPurchaseControl.controlState(purchase).state,'review');item.factor_to_base=1;
    invoice.items[0].quantity=71;assert.equal(w.AVHPurchaseControl.controlState(purchase).state,'review');invoice.items[0].quantity=72;
    invoice.items[0].unit_price=0;assert.equal(w.AVHPurchaseControl.controlState(purchase).state,'review');invoice.items[0].unit_price=25.5;
    invoice.customer_tax_id='999-9';assert.equal(w.AVHPurchaseControl.controlState(purchase).state,'review');
  }finally{w.close();}
});

function receiptUi(){
  const {w}=ui();w.document.body.insertAdjacentHTML('beforeend','<section id="page-home"></section>');
  Object.assign(w,{profile:{id:'depositor',role:'admin',warehouse_id:'ac'},goPage:()=>{},canRefreshView:()=>false,renderStock:()=>{},alert:()=>{}});
  Object.assign(w.D,{warehouses:[{id:'ac',name:'ACOMAR',active:true}],purchases:[{id:'p',po_number:'OC-1',supplier_name:'COMAGRO',destination_type:'warehouse',warehouse_id:'ac',status:'ordered'},{id:'other',po_number:'OC-2',destination_type:'warehouse',warehouse_id:'ac',status:'ordered'}],purchaseItems:[{id:'item',purchase_id:'p',product_id:'wst',description:wire.name,quantity:72,received_qty:0,unit:'unidad',factor_to_base:1,unit_price:25.5,affects_inventory:true}],moves:[],stocks:[],stockStatus:[],openingInventorySessions:[]});
  // Expose the real private confirmation handler only in this isolated UI harness.
  const source=read('../src/features/inventory/depositor-mobile-ai.js').replace('window.AVHDepositorAI={openReceipt:openReceiptPhotoFlow}','window.AVHDepositorAI={openReceipt:openReceiptPhotoFlow,confirm:renderReceiptConfirm}');
  w.eval(source);w.profile.role='depositor';return w;
}
test('the same partial OC is selectable at each assigned depot and shows the shared balance after cancellations',()=>{
 for(const warehouse of ['ac','vh','vil']){
  const w=receiptUi();try{
   w.profile.warehouse_id=warehouse;w.D.purchases[0].delivery_warehouse_ids=['ac','vh','vil'];w.D.purchases[0].delivery_mode='partial';w.D.purchaseItems[0].received_qty=20;w.D.purchaseItems[0].cancelled_qty=12;
   w.D.purchaseItems.push({...w.D.purchaseItems[0],id:'cancelled',quantity:10,received_qty:0,cancelled_qty:10});
   w.AVHDepositorAI.confirm({matched_purchase_id:'p',confidence:1,detected_items:[]},null);
   assert.equal(w.document.querySelector('#depReceiptPurchase').value,'p');assert.equal(w.document.querySelectorAll('[data-dep-receipt-qty]').length,1);assert.equal(w.document.querySelector('[data-dep-receipt-qty]').max,'40');assert.equal(w.document.querySelector('[data-dep-receipt-qty]').value,'');
  }finally{w.close();}
 }
 const w=receiptUi();try{w.profile.warehouse_id='mar';w.D.purchases[0].delivery_warehouse_ids=['ac','vh','vil'];w.AVHDepositorAI.confirm({matched_purchase_id:'p',confidence:1,detected_items:[]},null);assert.equal(w.document.querySelector('#depReceiptPurchase'),null);}finally{w.close();}
});
test('an unidentified delivery does not preselect the first pending OC',()=>{
  const w=receiptUi();try{
    w.AVHDepositorAI.confirm({matched_purchase_id:null,confidence:.3,detected_items:[]},null);
    assert.equal(w.document.querySelector('#depReceiptPurchase').value,'');assert.equal(w.document.querySelector('#depConfirmReceipt').disabled,true);
    assert.equal(w.document.querySelector('[data-dep-receipt-qty]'),null);
    assert.equal(w.document.querySelector('#depReceiptDocDate').value,'');
  }finally{w.close();}
});
test('mobile reception recognizes UN as units, shows kg separately and controls its saved invoice automatically',async()=>{
  const w=receiptUi(),calls=[];try{
    w.rpc=async(name,args)=>{calls.push({name,args});return{data:name==='receive_purchase'?'receipt':'invoice'};};
    w.request=async()=>{calls.push({name:'upload'});return{data:{}};};
    w.AVHPurchaseControl={analyzeInvoice:async(p,d)=>{calls.push({name:'analyze',p,d});return{ok:true};}};
    w.AVHDepositorAI.confirm({matched_purchase_id:'p',matched_po_number:'OC-1',confidence:.99,document_kind:'invoice',document_number:'001-001-0177076',document_date:'2026-10-19',detected_items:[{purchase_item_id:'item',quantity:72,unit:'UN',confidence:.99}]},{name:'invoice.jpg',blob:new w.Blob(['photo'],{type:'image/jpeg'})});
    assert.equal(w.document.querySelector('[data-dep-receipt-qty]').value,'72');assert.match(w.document.querySelector('[data-dep-receipt-preview]').textContent,/72 unidad.*15 kg.*1080 kg/);
    assert.doesNotMatch(w.document.querySelector('#modalBody').textContent,/USD|25[.,]50/);
    await w.document.querySelector('#depConfirmReceipt').onclick();
    assert.deepEqual(calls.map(x=>x.name),['receive_purchase','upload','register_purchase_receipt_document','analyze']);
    assert.equal(calls[0].args.p_items[0].quantity,72);assert.equal(calls[3].p,'p');assert.equal(calls[3].d,'invoice');
  }finally{w.close();}
});
