import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID,webcrypto} from 'node:crypto';
import {JSDOM} from 'jsdom';
import * as pdfLib from 'pdf-lib';
import {makeCommercialPdf} from '../edge-functions/_shared/commercial-pdf.mjs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');

test('An existing OC opens fully editable, unsaved edits survive refresh, and PDF waits for a successful save',async()=>{
 const dom=new JSDOM('<nav><button class="commercial-nav"><span></span></button></nav><section id="page-commercial" class="page on"><div id="commercialPanel"></div></section>',{url:'https://avh.test/',runScripts:'outside-only'}),w=dom.window;
 const company={id:randomUUID(),name:'AVH',legal_name:'Astillero Villa Hayes S.A.',tax_id:'80091371-0',address:'Villa Hayes'},supplier={id:randomUUID(),name:'Proveedor',tax_id:'123-4'},purchaseId=randomUUID();let record,saves=0,pdfs=0,fail=false;const downloads=[];
 const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('UI timeout: '+w.document.querySelector('#commercialError')?.textContent);};
 const input=(selector,value)=>{const el=w.document.querySelector(selector);assert.ok(el,selector);assert.equal(el.disabled,false,selector);assert.equal(el.readOnly,false,selector);el.value=String(value);el.dispatchEvent(new w.Event('input',{bubbles:true}));};
 Object.defineProperty(w,'crypto',{value:webcrypto});w.URL.createObjectURL=blob=>{downloads.push(blob);return 'blob:test';};w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){};
 Object.assign(w,{structuredClone,profile:{id:randomUUID(),role:'admin',username:'compras'},D:{products:[]},$:s=>w.document.querySelector(s),$$:s=>[...w.document.querySelectorAll(s)],esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),canonicalOperationValue:v=>v,canRefreshView:()=>true,goPage:()=>{},loadAll:async()=>{},closeModal:()=>{}});
 w.rpc=async(name,args={})=>{
  if(name==='commercial_context')return{data:{access_level:'admin',company,companies:[company],suppliers:[supplier]}};
  if(name==='admin_purchase_order_document')return{data:structuredClone(record)};
  if(name==='admin_save_purchase_order_document'){
   saves++;if(fail)return{error:'La OC cambió. Volvé a abrirla antes de guardar.',status:409};
   assert.equal(args.p_expected_version,record.version);const p=structuredClone(args.p_payload);record={...record,number:p.document_number,version:'version-'+saves,payload:{...p,...w.AVHCommercialModel.totals(p)}};return{data:structuredClone(record)};
  }throw Error(name);
 };
 w.queryAll=async()=>({data:[]});w.edge=async(name,args)=>{assert.equal(name,'purchase-order-pdf');assert.equal(args.purchase_id,purchaseId);assert.equal(args.expected_version,record.version);pdfs++;return{data:{filename:record.number+'.pdf',pdf_base64:Buffer.from(await makeCommercialPdf(record,pdfLib)).toString('base64')}};};
 try{
  w.eval(read('../src/features/work-orders/commercial-model.js'));
  const p={...w.AVHCommercialModel.draft('purchase_order',null,w.profile),company,supplier_id:supplier.id,recipient_name:supplier.name,document_number:'OC-2026-00001',tax_mode:'unspecified',items:[{id:randomUUID(),description:'Chapa',quantity:2,unit:'kg',unit_price:3}]};
  record={id:purchaseId,purchase_id:purchaseId,purchase_editor:true,kind:'purchase_order',status:'draft',number:p.document_number,version:'version-0',payload:p};
  w.eval(read('../src/features/work-orders/commercial.js'));await w.AVHCommercial.editPurchaseOrder(purchaseId);await wait(()=>!w.AVHCommercial.state.busy);
  assert.equal(w.document.querySelector('#cdApprove'),null);assert.equal(w.document.querySelector('#cdAi'),null);
  for(const [selector,value] of Object.entries({'#cd-document_number':'OC-AVH-REVISADA','#cd-title':'Compra revisada','#cd-document_date':'2026-10-14','#cd-reference':'REF-TEST','#cd-location':'Dirección revisada','#cd-issuer_name':'Gabriel Ortega','#cd-delivery_date':'2026-10-20','#cd-recipient_name':'Nombre proveedor corregido','#cd-recipient_tax_id':'999-1','#cd-recipient_contact':'Contacto proveedor','#cd-recipient_address':'Dirección proveedor','#cd-introduction':'Alcance acordado','#cd-company-legal_name':'Astillero Villa Hayes S.A.','#cd-company-tax_id':'80091371-0','#cd-company-address':'Dirección empresa corregida','#cd-company-phone':'021123456','#cd-company-email':'compras@example.test','#cd-payment_terms':'Crédito 30 días','#cd-delivery_terms':'En una semana','#cd-notes':'Notas revisadas','[data-cd-line="description"]':'Chapa naval 7.9 mm','[data-cd-line="quantity"]':4,'[data-cd-line="unit"]':'kg','[data-cd-line="unit_price"]':5}))input(selector,value);
  const node=w.document.querySelector('#cd-recipient_name');await w.loadAll();assert.equal(w.document.querySelector('#cd-recipient_name'),node);assert.equal(node.value,'Nombre proveedor corregido');
  fail=true;w.document.querySelector('#cdPdf').click();await wait(()=>!w.AVHCommercial.state.busy);assert.equal(pdfs,0);assert.equal(w.AVHCommercial.state.dirty,true);assert.equal(node.value,'Nombre proveedor corregido');
  fail=false;w.document.querySelector('#cdPdf').click();await wait(()=>pdfs===1&&!w.AVHCommercial.state.busy);assert.equal(record.payload.recipient_name,'Nombre proveedor corregido');assert.equal(record.payload.company.address,'Dirección empresa corregida');assert.equal(record.payload.total,20);assert.equal(record.number,'OC-AVH-REVISADA');assert.equal(downloads.length,1);assert.ok(downloads[0].size>40000);assert.equal(w.AVHCommercial.state.dirty,false);
 }finally{w.close();}
});
