import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const product=(id,name)=>({id,name,base_unit:'unidad',active:true});
const po=(id,name,quantity=20,price=350)=>({id,purchase_id:'p',product_id:id,description:name,quantity,received_qty:quantity,unit:'unidad',factor_to_base:1,unit_price:price,affects_inventory:true});
function invoice(id,lines,overrides={}){
 const total=lines.reduce((s,x)=>s+x.quantity*x.price,0);
 return{id,purchase_id:'p',kind:'invoice',document_number:'001-001-'+id,file_path:'p/'+id+'.jpg',file_name:id+'.jpg',document_date:'2026-10-20',created_at:id==='a'?'2026-10-20T12:00:00Z':'2026-10-20T13:00:00Z',analysis_status:'ok',analysis_data:{document_number:'001-001-'+id,date:'2026-10-20',currency:'PYG',supplier_name:'Proveedor',supplier_tax_id:'123-4',customer_tax_id:'456-7',total,subtotal:total,tax:0,tax_mode:'included',complete:true,confidence:.99,validation:{reviewed:true,issues:[]},items:lines.map(x=>({description:x.name,quantity:x.quantity,unit:x.unit||'UN',unit_price:x.price,line_total:x.quantity*x.price,confidence:.99,brand:x.brand||null}))},...overrides};
}
function ui({rows,documents,receipts=[]}){
 const dom=new JSDOM('<main id="modalBody"></main>',{url:'https://avh.test/',runScripts:'outside-only'}),w=dom.window;
 const purchase={id:'p',currency:'PYG',supplier_id:'s',company_id:'c',destination_type:'warehouse',warehouse_id:'ac'};
 Object.assign(w,{$:s=>w.document.querySelector(s),$$:s=>[...w.document.querySelectorAll(s)],profile:{role:'admin'},D:{purchases:[purchase],purchaseItems:rows,products:rows.map(x=>product(x.product_id,x.description)),presentations:[],purchaseDocuments:documents,purchaseReceipts:receipts,suppliers:[{id:'s',name:'Proveedor',tax_id:'123-4'}],purchaseCompanies:[{id:'c',name:'Comprador',tax_id:'456-7'}]},fmt:n=>String(n),money:(n,c)=>c+' '+Number(n).toFixed(2),esc:v=>String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])),openPurchaseDetail:async()=>{},loadAll:async()=>{},alert:m=>{throw Error(m);}});
 w.eval(read('../edge-functions/_shared/product-identity.js'));w.eval(read('../edge-functions/_shared/purchase-receiving-model.js'));w.eval(read('../src/features/purchases/purchase-document-control.js'));
 return{w,purchase,state:()=>w.AVHPurchaseControl.controlState(purchase),close:()=>w.close()};
}
const solder='GUANTE DE CUERO REFORZADO P/SOLDADOR 36CM',vaqueta='GUANTE VAQUETA/CUERO 15CM NACIONAL';
const oneLine=(quantity=100)=>po('wire','Material de prueba',quantity,10);

test('cancelled undelivered quantities close reconciliation without falsifying receipts or requiring an invoice for them',()=>{
 const row={...oneLine(50),received_qty:20,cancelled_qty:30},missing={...po('glove','Guantes',20,5),received_qty:0,cancelled_qty:20};
 const h=ui({rows:[row,missing],documents:[invoice('a',[{name:row.description,quantity:20,price:10}])]});try{
  const state=h.state();assert.equal(state.state,'ok');assert.equal(state.rec.received,20);assert.equal(state.rec.cancelled,50);assert.equal(state.rec.complete,true);assert.equal(state.billing.complete,true);
 }finally{h.close();}
});

test('invoiced quantities on a cancelled balance still require financial review',()=>{
 const row={...oneLine(50),received_qty:20,cancelled_qty:30};
 const h=ui({rows:[row],documents:[invoice('a',[{name:row.description,quantity:50,price:10}])]});try{assert.equal(h.state().state,'review');assert.ok(h.state().issues.some(x=>/saldo cancelado/.test(x.text)));}finally{h.close();}
});

test('Partial PO: first delivery and its invoice are conforming partials, not a missing-product error',()=>{
 const a=po('solder',solder),b={...po('vaqueta',vaqueta,20,212),received_qty:0};
 const d=invoice('a',[{name:solder,quantity:20,price:350,unit:'UNI'}]);
 d.analysis_data.date=null;d.analysis_data.source_dates={date:'2025-10-20T13:46:07'};d.analysis_data.validation.issues=['Revisar la fecha date: no es una fecha válida.'];
 const h=ui({rows:[a,b],documents:[d]});try{
  const s=h.state();assert.equal(s.state,'pending');assert.equal(s.billing.count,1);assert.equal(s.billing.totals.PYG,7000);
  assert.equal(s.issues.filter(x=>x.level==='review').length,0);assert.equal(s.billing.rows[0].quantity,20);assert.equal(s.billing.rows[1].quantity,0);
  assert.ok(!s.issues.some(x=>/fecha|no pude vincular|total.*vs OC/i.test(x.text)));
  assert.equal(s.invoiceData.date,'2026-10-20');assert.equal(d.analysis_data.date,null);assert.equal(d.analysis_data.source_dates.date,'2025-10-20T13:46:07','keep original OCR evidence unchanged');
 }finally{h.close();}
});
test('Partial PO: second delivery with a different invoice completes the same purchase',async()=>{
 const documents=[invoice('a',[{name:solder,quantity:20,price:350}]),invoice('b',[{name:vaqueta,quantity:20,price:212}])];
 const h=ui({rows:[po('solder',solder),po('vaqueta',vaqueta,20,212)],documents});try{
  const s=h.state();assert.equal(s.state,'ok');assert.equal(s.billing.count,2);assert.equal(s.billing.totals.PYG,11240);assert.equal(s.billing.complete,true);
  await h.w.openPurchaseDetail('p');
  assert.equal(h.w.document.querySelectorAll('.pc-invoice-record').length,2);assert.match(h.w.document.querySelector('.pc-billing-summary').textContent,/2 factura.*11240/);
  assert.equal(h.w.document.querySelector('.pc-control-badge').textContent,'OK');
 }finally{h.close();}
});
test('different invoices for partial quantities of the same product accumulate in the PO unit',()=>{
 const row=oneLine(),h=ui({rows:[row],documents:[invoice('a',[{name:row.description,quantity:40,price:10}]),invoice('b',[{name:row.description,quantity:60,price:10}])]});try{
  assert.equal(h.state().state,'ok');assert.equal(h.state().billing.rows[0].quantity,100);assert.equal(h.state().billing.totals.PYG,1000);
 }finally{h.close();}
});
test('an older price difference stays visible even when a later opposite difference cancels its total',()=>{
 const row=oneLine(),h=ui({rows:[row],documents:[invoice('a',[{name:row.description,quantity:50,price:11}]),invoice('b',[{name:row.description,quantity:50,price:9}])]});try{
  const s=h.state();assert.equal(s.billing.totals.PYG,1000);assert.equal(s.state,'review');assert.equal(s.billing.rows[0].priceVariance,true);assert.ok(s.issues.some(x=>x.text.includes('001-001-a')&&x.level==='review'));assert.ok(s.issues.some(x=>x.text.includes('001-001-b')&&x.level==='review'));
 }finally{h.close();}
});
test('accumulated invoicing cannot exceed the ordered quantity',()=>{
 const row=oneLine(),h=ui({rows:[row],documents:[invoice('a',[{name:row.description,quantity:60,price:10}]),invoice('b',[{name:row.description,quantity:60,price:10}])]});try{
  assert.equal(h.state().state,'review');assert.ok(h.state().issues.some(x=>/excede la OC/.test(x.text)));assert.equal(h.state().billing.rows[0].quantity,120);
 }finally{h.close();}
});
test('an older unread invoice remains pending while the latest invoice is legible',()=>{
 const row=oneLine(),a=invoice('a',[{name:row.description,quantity:40,price:10}],{analysis_status:'error',analysis_error:'Reintentar'}),b=invoice('b',[{name:row.description,quantity:60,price:10}]);
 const h=ui({rows:[row],documents:[a,b]});try{
  assert.equal(h.state().state,'pending');assert.equal(h.state().billing.unread,1);assert.ok(h.state().issues.some(x=>x.text.includes('001-001-a')&&/falló/.test(x.text)));
 }finally{h.close();}
});
test('the same invoice linked to two deliveries counts once, with punctuation-insensitive numbering',()=>{
 const row=oneLine(),a=invoice('a',[{name:row.description,quantity:100,price:10}],{document_number:'001-001-0001234',receipt_id:'r1'}),b={...structuredClone(a),id:'b',file_path:'p/another.jpg',receipt_id:'r2',document_number:'0010010001234'};
 const h=ui({rows:[row],documents:[a,b],receipts:[{id:'r1'},{id:'r2'}]});try{
  assert.equal(h.state().state,'ok');assert.equal(h.state().billing.count,1);assert.equal(h.state().billing.totals.PYG,1000);assert.equal(h.state().billing.rows[0].quantity,100);
 }finally{h.close();}
});
test('conflicting files under the same invoice number require review rather than double counting',()=>{
 const row=oneLine(),a=invoice('a',[{name:row.description,quantity:100,price:10}],{document_number:'001-001-0001234'}),b=invoice('b',[{name:row.description,quantity:100,price:12}],{document_number:'001-001-0001234'});
 const h=ui({rows:[row],documents:[a,b]});try{
  assert.equal(h.state().state,'review');assert.equal(h.state().billing.count,1);assert.ok(h.state().issues.some(x=>/lecturas diferentes/.test(x.text)));
 }finally{h.close();}
});
test('voided receipts stay in the document history and do not duplicate the active stock reconciliation',()=>{
 const row=oneLine(),a=invoice('a',[{name:row.description,quantity:100,price:10}],{receipt_id:'void'}),b=invoice('b',[{name:row.description,quantity:100,price:10}],{receipt_id:'active'});
 const h=ui({rows:[row],documents:[a,b],receipts:[{id:'void',voided_at:'2026-10-20T14:00:00Z'},{id:'active'}]});try{
  assert.equal(h.state().state,'ok');assert.equal(h.state().billing.count,1);assert.equal(h.w.D.purchaseDocuments.length,2);
 }finally{h.close();}
});
test('a foreign currency in an older invoice cannot be hidden by a correct latest invoice',()=>{
 const row=oneLine(),a=invoice('a',[{name:row.description,quantity:40,price:10}]),b=invoice('b',[{name:row.description,quantity:60,price:10}]);a.analysis_data.currency='USD';
 const h=ui({rows:[row],documents:[a,b]});try{assert.equal(h.state().state,'review');assert.equal(h.state().billing.totals.USD,400);assert.equal(h.state().billing.totals.PYG,600);assert.ok(h.state().issues.some(x=>/moneda USD/.test(x.text)));}finally{h.close();}
});
test('repeated product lines within one invoice are accumulated without concealing price differences',()=>{
 const row=oneLine(),h=ui({rows:[row],documents:[invoice('a',[{name:row.description,quantity:40,price:10},{name:row.description,quantity:60,price:10}])]});try{assert.equal(h.state().state,'ok');assert.equal(h.state().billing.rows[0].quantity,100);}finally{h.close();}
});
test('unknown units remain pending and a valid conflicting date remains visible',()=>{
 const row=oneLine(),d=invoice('a',[{name:row.description,quantity:100,price:10,unit:'kg'}]);d.analysis_data.date='2025-10-20';
 const h=ui({rows:[row],documents:[d]});try{
  assert.equal(h.state().state,'pending');assert.equal(h.state().billing.rows[0].quantity,null);assert.ok(h.state().issues.some(x=>/unidad o conversión/.test(x.text)));assert.ok(h.state().issues.some(x=>/fecha leída difiere/.test(x.text)));
 }finally{h.close();}
});
test('earlier supplier and buyer mismatches remain independently visible',()=>{
 const row=oneLine(),a=invoice('a',[{name:row.description,quantity:40,price:10}]),b=invoice('b',[{name:row.description,quantity:60,price:10}]);a.analysis_data.supplier_tax_id='999-1';a.analysis_data.customer_tax_id='888-2';
 const h=ui({rows:[row],documents:[a,b]});try{assert.equal(h.state().state,'review');assert.ok(h.state().issues.some(x=>/RUC del proveedor/.test(x.text)));assert.ok(h.state().issues.some(x=>/empresa compradora/.test(x.text)));}finally{h.close();}
});
test('each invoice can be reanalyzed by its own document id',async()=>{
 const row=oneLine(),h=ui({rows:[row],documents:[invoice('a',[{name:row.description,quantity:40,price:10}]),invoice('b',[{name:row.description,quantity:60,price:10}])]});
 try{
  const calls=[];h.w.edge=async(name,args)=>{calls.push({name,args:JSON.parse(JSON.stringify(args))});return{data:{ok:true}};};
  await h.w.openPurchaseDetail('p');await h.w.document.querySelector('[data-pc-analyze-invoice="a"]').onclick();
  assert.deepEqual(calls,[{name:'purchase-invoice-control-ai',args:{purchase_id:'p',document_id:'a'}}]);
 }finally{h.close();}
});
test('a wrong brand in an earlier invoice cannot pass through matching by description or code',()=>{
 const name='Disco de corte 115 mm x 1,2 mm Maxflexx',row=po('disc',name,100,10),a=invoice('a',[{name:'Disco de corte 115 mm x 1,2 mm Norton',quantity:40,price:10,brand:'Norton'}]),b=invoice('b',[{name,quantity:60,price:10,brand:'Maxflexx'}]);
 const h=ui({rows:[row],documents:[a,b]});try{assert.equal(h.state().state,'review');assert.ok(h.state().issues.some(x=>/no vinculadas/.test(x.text)));}finally{h.close();}
});

test('a mathematically valid partial bill after full delivery stays pending for the unbilled balance',()=>{
 const row=oneLine(),h=ui({rows:[row],documents:[invoice('a',[{name:row.description,quantity:99,price:10}])]});try{
  assert.equal(h.state().state,'pending');assert.ok(h.state().issues.some(x=>/1 unidad recibidos todavía sin factura/.test(x.text)));assert.equal(h.state().issues.filter(x=>x.level==='review').length,0);
 }finally{h.close();}
});
