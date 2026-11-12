import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');

function ui({role='admin',warehouse=false,quantity=6,received=0,cancelled=0}={}){
  const dom=new JSDOM('<main id="modalBody"></main>',{url:'https://avh.test',runScripts:'outside-only'}),w=dom.window,calls=[],uploads=[];
  const p={id:'p',supplier_id:'supplier',supplier_name:'Proveedor de prueba',company_id:'company',po_number:'OC-123',currency:'PYG',destination_type:warehouse?'warehouse':'service',purchase_type:warehouse?'stock':'service',warehouse_id:warehouse?'w':null,delivery_warehouse_ids:warehouse?['w','w2']:[],status:received===quantity?'received':received?'partially_received':'ordered'};
  const item={id:'item',purchase_id:'p',description:warehouse?'Alambre de prueba':'Servicio de grúa 35 t',product_id:'product',quantity,received_qty:received,cancelled_qty:cancelled,unit:warehouse?'unidad':'hora',factor_to_base:1,affects_inventory:warehouse};
  let doc={document_type:'invoice',document_number:'001-001-0001234',date:'2026-10-31',supplier_name:'Proveedor de prueba',supplier_tax_id:'80000000-0',customer_tax_id:'80000000-1',currency:'PYG',total:450000,confidence:.99,complete:true,items:[{description:item.description,quantity:warehouse?10:3,unit:warehouse?'UN':'hs',confidence:.99}]};
  Object.assign(w,{
    $:s=>w.document.querySelector(s),$$:s=>[...w.document.querySelectorAll(s)],profile:{id:'gabriel',role,active:true},
    D:{purchases:[p],purchaseItems:[item],purchaseReceipts:[],purchaseDocuments:[],products:[{id:'product',name:item.description,base_unit:item.unit}],presentations:[],suppliers:[{id:'supplier',name:'Proveedor de prueba',tax_id:'80000000-0'}],purchaseCompanies:[{id:'company',tax_id:'80000000-1'}]},
    esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),fmt:v=>String(v),money:(v,c)=>`${c} ${v}`,whName:id=>id,
    openModal:(_title,_subtitle,html)=>{w.$('#modalBody').innerHTML=html},closeModal:()=>{w.$('#modalBody').innerHTML=''},msg:(el,text)=>{el.textContent=text},
    edge:async(name,args)=>{calls.push({name,args});return{data:{document:doc}}},
    rpc:async(name,args)=>{calls.push({name,args:JSON.parse(JSON.stringify(args))});return{data:name==='register_purchase_receipt_document'?'document':'receipt'}},
    request:async(path,args)=>{uploads.push({path,args});return{data:{}}},query:async()=>({data:[]}),loadAll:async()=>{},renderPurchases:()=>{},openPurchaseDetail:()=>{},
    AVHPurchaseControl:{analyzeInvoice:async(...args)=>{calls.push({name:'control',args})}},
  });
  w.FileReader=class{readAsDataURL(){this.result='data:image/jpeg;base64,AAAA';queueMicrotask(()=>this.onload())}};
  w.eval(read('../edge-functions/_shared/product-identity.js'));w.eval(read('../edge-functions/_shared/purchase-receiving-model.js'));w.eval(read('../src/features/purchases/receive-invoice-ai.js'));
  const file=async(name='factura.jpg')=>{const input=w.$('#raiFile');Object.defineProperty(input,'files',{configurable:true,value:[new w.File(['photo'],name,{type:'image/jpeg'})]});await input.onchange()};
  return{w,p,item,calls,uploads,file,setDoc:d=>{doc=d},get doc(){return doc},close:()=>w.close()};
}

test('Recibir reads the invoice before any mutation and confirms only reviewed service hours',async()=>{
  const h=ui(),{w,calls,uploads}=h;try{
    assert.equal(w.AVHPurchaseReceiving.action(h.p),'Recibir');await w.AVHPurchaseReceiving.open('p');
    await w.$('#raiSave').onclick();assert.match(w.$('#raiMessage').textContent,/Subí la foto/);assert.equal(calls.length,0);
    await h.file();assert.equal(calls.length,1);assert.equal(calls[0].name,'purchase-document-ai');
    assert.equal(w.$('#raiNumber').value,'001-001-0001234');assert.equal(w.$('#raiDocumentDate').value,'2026-10-31');assert.equal(w.$('[data-rai-quantity]').value,'3');
    assert.equal(w.$('#raiDate').value===w.$('#raiDocumentDate').value,false,'invoice date does not replace service performance date');
    w.$('[data-rai-quantity]').value='2';w.$('#raiDate').value='2026-10-30';await w.$('#raiSave').onclick();
    const confirmation=calls.find(x=>x.name==='admin_confirm_direct_purchase');assert.equal(confirmation.args.p_items[0].quantity,2);assert.equal(confirmation.args.p_effective_date,'2026-10-30');assert.ok(confirmation.args.p_request_id);
    assert.equal(calls.filter(x=>x.name==='receive_purchase').length,0);assert.equal(uploads.length,1);
    const document=calls.find(x=>x.name==='register_purchase_receipt_document');assert.equal(document.args.p_receipt_id,'receipt');assert.equal(document.args.p_kind,'invoice');assert.equal(document.args.p_document_number,'001-001-0001234');assert.equal(document.args.p_document_date,'2026-10-31');
    assert.match(w.$('#purchaseReceiptAI').textContent,/Servicio confirmado y documento guardado/);
  }finally{h.close()}
});

test('warehouse receipts use the selected authorized warehouse and catalog packaging conversions',async()=>{
  const h=ui({warehouse:true,quantity:72}),{w}=h;try{
    w.D.presentations=[{product_id:'product',unit:'rollo',label:'Rollo 15 kg',factor_to_base:1}];
    h.setDoc({...h.doc,document_type:'receipt',currency:null,total:null,items:[{description:h.item.description,quantity:150,unit:'kg',factor_to_base:15,base_unit:'kg',confidence:.99}]});
    await w.AVHPurchaseReceiving.open('p');await h.file();assert.equal(w.$('[data-rai-quantity]').value,'10','150 kg means ten stock units, never 150 or 2250');assert.equal(w.$('#raiKind').value,'remittance');
    w.$('#raiWarehouse').value='w2';await w.$('#raiSave').onclick();
    const call=h.calls.find(x=>x.name==='receive_purchase');assert.equal(call.args.p_items[0].quantity,10);assert.equal(call.args.p_items[0].warehouse_id,'w2');assert.ok(call.args.p_items[0].request_id);
    assert.equal(h.calls.some(x=>x.name==='admin_confirm_direct_purchase'||x.name==='control'),false);
    assert.equal(h.calls.find(x=>x.name==='register_purchase_receipt_document').args.p_kind,'remittance');
  }finally{h.close()}
});

test('uncertain, ambiguous, excessive or incompatible OCR never silently fills a received quantity',async t=>{
  for(const kind of ['confidence','ambiguous','excess','supplier','buyer','unit','identity'])await t.test(kind,async()=>{
    const h=ui(),{w}=h;try{
      const d=structuredClone(h.doc);
      if(kind==='confidence')d.items[0].confidence=.6;
      if(kind==='ambiguous')w.D.purchaseItems.push({...h.item,id:'item2'});
      if(kind==='excess'){h.item.received_qty=4;d.items[0].quantity=6;}
      if(kind==='supplier')d.supplier_tax_id='999-9';
      if(kind==='buyer')d.customer_tax_id='999-9';
      if(kind==='unit'){d.items[0].unit='caja';d.items[0].factor_to_base=50;d.items[0].base_unit='hora';}
      if(kind==='identity'){h.item.description='Disco de corte Norton';w.D.products[0].name=h.item.description;d.items[0].description='Disco de corte Maxflexx';}
      h.setDoc(d);await w.AVHPurchaseReceiving.open('p');await h.file();
      assert.ok([...w.document.querySelectorAll('[data-rai-quantity]')].every(x=>x.value===''));
      await w.$('#raiSave').onclick();assert.equal(h.calls.filter(x=>x.name==='admin_confirm_direct_purchase'||x.name==='receive_purchase').length,0);
    }finally{h.close()}
  });
});

test('lost confirmation responses retain the exact request and lock edits until the retry resolves',async()=>{
  const h=ui(),{w,calls}=h;try{
    let attempt=0;w.rpc=async(name,args)=>{calls.push({name,args:JSON.parse(JSON.stringify(args))});return name==='admin_confirm_direct_purchase'&&++attempt===1?{network:true,error:'Respuesta perdida'}:{data:name==='register_purchase_receipt_document'?'document':'receipt'}};
    await w.AVHPurchaseReceiving.open('p');await h.file();await w.$('#raiSave').onclick();
    assert.equal(w.$('[data-rai-quantity]').disabled,true);assert.match(w.$('#raiMessage').textContent,/no se duplicará/);
    w.$('[data-rai-quantity]').value='1';await w.$('#raiSave').onclick();
    const confirmations=calls.filter(x=>x.name==='admin_confirm_direct_purchase');assert.equal(confirmations.length,2);assert.deepEqual(confirmations[0].args,confirmations[1].args);assert.equal(confirmations[1].args.p_items[0].quantity,3);
  }finally{h.close()}
});

test('document failures retry the attachment without receiving the purchase a second time',async()=>{
  const h=ui(),{w}=h;try{
    let uploads=0;w.request=async()=>++uploads===1?{error:'Error al subir foto'}:{data:{}};
    await w.AVHPurchaseReceiving.open('p');await h.file();await w.$('#raiSave').onclick();
    assert.match(w.$('#raiMessage').textContent,/recepción ya está registrada/);assert.equal(w.$('#raiSave').textContent,'Reintentar guardar documento');
    await w.$('#raiSave').onclick();assert.equal(h.calls.filter(x=>x.name==='admin_confirm_direct_purchase').length,1);assert.equal(h.calls.filter(x=>x.name==='register_purchase_receipt_document').length,1);
  }finally{h.close()}
});

test('a lost document-registration response is recovered by its receipt and file path',async()=>{
  const h=ui(),{w}=h;try{
    let registered=false;
    w.query=async(_table,_select,filter)=>{assert.match(filter,/purchase_id=eq.p&receipt_id=eq.receipt&file_path=eq./);return{data:registered?[{id:'document'}]:[]}};
    w.rpc=async(name,args)=>{h.calls.push({name,args});if(name==='register_purchase_receipt_document'){registered=true;return{network:true,error:'Respuesta perdida'}}return{data:'receipt'}};
    await w.AVHPurchaseReceiving.open('p');await h.file();await w.$('#raiSave').onclick();await w.$('#raiSave').onclick();
    assert.equal(h.calls.filter(x=>x.name==='admin_confirm_direct_purchase').length,1);assert.equal(h.calls.filter(x=>x.name==='register_purchase_receipt_document').length,1);
    assert.equal(h.uploads.length,1);assert.ok(w.$('#raiDone'));
  }finally{h.close()}
});

test('Cargar factura and document-only mode attach to an existing receipt without any quantity mutation',async()=>{
  for(const received of [3,6]){
    const h=ui({received}),{w}=h;try{
      w.D.purchaseReceipts=[{id:'previous',purchase_id:'p',effective_date:'2026-10-30'}];
      assert.equal(w.AVHPurchaseReceiving.action(h.p),received===6?'Cargar factura':'Recibir');
      await w.AVHPurchaseReceiving.open('p');await h.file();w.$('#raiOperation').value='document';w.$('#raiOperation').onchange?.();await w.$('#raiSave').onclick();
      assert.equal(h.calls.some(x=>x.name==='receive_purchase'||x.name==='admin_confirm_direct_purchase'),false);
      assert.equal(h.calls.find(x=>x.name==='register_purchase_receipt_document').args.p_receipt_id,'previous');
    }finally{h.close()}
  }
});

test('switching files clears old OCR values, and a late response cannot replace another purchase form',async()=>{
  const h=ui(),{w}=h;try{
    await w.AVHPurchaseReceiving.open('p');await h.file();
    w.edge=async()=>({error:'Foto ilegible'});await h.file('otra.jpg');assert.equal(w.$('[data-rai-quantity]').value,'');assert.equal(w.$('#raiNumber').value,'');assert.equal(w.$('#raiNotes').value,'');
    let resolve;w.edge=()=>new Promise(r=>{resolve=r});const old=h.file('pendiente.jpg');await new Promise(r=>setTimeout(r,0));
    await w.AVHPurchaseReceiving.open('p');resolve({data:{document:h.doc}});await old;
    assert.equal(w.$('#raiNumber').value,'');assert.equal(w.$('#raiFileInfo').textContent,'');
  }finally{h.close()}
});

test('unauthorized roles and unconfirmed purchases have no receiving action',async()=>{
  for(const role of ['depositor','production','admin_viewer']){const h=ui({role});try{assert.equal(h.w.AVHPurchaseReceiving.action(h.p),null);await h.w.AVHPurchaseReceiving.open('p');assert.equal(h.w.$('#raiFile'),null)}finally{h.close()}}
  const h=ui();try{for(const status of ['draft','requested','quoted','approved','cancelled']){h.p.status=status;assert.equal(h.w.AVHPurchaseReceiving.action(h.p),null)}h.p.status='ordered';h.w.profile.active=false;assert.equal(h.w.AVHPurchaseReceiving.action(h.p),null)}finally{h.close()}
});
