import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID,webcrypto} from 'node:crypto';
import {JSDOM} from 'jsdom';
import * as pdfLib from 'pdf-lib';
import {makeCommercialPdf} from '../edge-functions/_shared/commercial-pdf.mjs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8'),copy=v=>JSON.parse(JSON.stringify(v));
test('Production creates, reviews and emits quotes, retains edits on refresh and has no OC controls',async()=>{
 const dom=new JSDOM('<nav class="nav"><button class="commercial-nav hide" data-page="commercial"><span></span></button></nav><section id="page-commercial" class="page on"><div id="commercialPanel"></div></section><div id="modal" class="hide"><div id="modalBody"></div></div>',{url:'https://avh.test/',runScripts:'outside-only'}),w=dom.window,rows=new Map(),downloads=[];let role='editor',numbers=0,loseIssue=true;
 const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('UI timeout: '+w.document.querySelector('#commercialError')?.textContent);};
 const click=s=>w.document.querySelector(s).click(),input=(s,v)=>{const el=w.document.querySelector(s);el.value=String(v);el.dispatchEvent(new w.Event('input',{bubbles:true}));};
 Object.defineProperty(w,'crypto',{value:webcrypto});w.URL.createObjectURL=blob=>{downloads.push({blob});return 'blob:test';};w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){downloads.at(-1).name=this.download;};
 const company={name:'AVH',legal_name:'Astillero Villa Hayes S.A.',tax_id:'80091371-0'};
 Object.assign(w,{profile:{id:randomUUID(),username:'galo',full_name:'Galo',role:'production',active:true},$:s=>w.document.querySelector(s),$$:s=>[...w.document.querySelectorAll(s)],esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),canonicalOperationValue:v=>v,canRefreshView:()=>true,goPage:()=>{},loadAll:async()=>{},openModal:(title,sub,html)=>{w.document.querySelector('#modalBody').innerHTML=html;w.document.querySelector('#modal').classList.remove('hide');},closeModal:()=>w.document.querySelector('#modal').classList.add('hide')});
 w.rpc=async(name,args={})=>{
  if(name==='commercial_context')return{data:{access_level:role,company,suppliers:[]}};
  if(name==='commercial_document')return{data:copy(rows.get(args.p_id))};
  const d=args.p_data,old=rows.get(d.document_id);
  if(args.p_action==='save'){const p={...copy(d.payload),...w.AVHCommercialModel.totals(d.payload)};rows.set(d.document_id,{id:d.document_id,kind:d.kind,status:'draft',payload:p,company,version:(old?.version||0)+1});return{data:copy(rows.get(d.document_id))};}
  if(args.p_action==='issue'){old.number='PRE-AVH-2026-'+String(++numbers).padStart(5,'0');old.status='issued';old.issued_payload={...copy(old.payload),company};old.version++;if(loseIssue){loseIssue=false;return{error:'Respuesta perdida',status:503};}return{data:copy(old)};}
  throw Error('Unexpected command');
 };
 w.queryAll=async()=>({data:[...rows.values()].map(d=>({...copy(d),recipient_name:d.payload.recipient_name,title:d.payload.title,reference:d.payload.reference}))});
 w.edge=async(name,body)=>{
  const d=rows.get(body.document_id);
  if(name==='commercial-ai')return{data:{suggestion:{title:'Presupuesto técnico',introduction:'Detalle de los trabajos solicitados.',items:d.payload.items.map(i=>({id:i.id,description:i.description+' según alcance'}))}}};
  const bytes=await makeCommercialPdf(d,pdfLib);return{data:{filename:d.number+'.pdf',pdf_base64:Buffer.from(bytes).toString('base64')}};
 };
 try{
  w.structuredClone=structuredClone;w.eval(read('../edge-functions/_shared/company-logo.js'));w.eval(read('../src/features/work-orders/commercial-model.js'));w.eval(read('../edge-functions/_shared/quote-theme.js'));w.eval(read('../src/features/work-orders/commercial.js'));await w.AVHCommercial.refresh();
  assert.equal(w.document.querySelector('#cdNewOc'),null);assert.equal(w.document.querySelector('[data-cd-kind="purchase_order"]'),null);
  assert.doesNotMatch(w.document.querySelector('#commercialPanel').textContent,/\bOC\b|órdenes de compra/i);
  await assert.rejects(w.AVHCommercial.editPurchaseOrder(randomUUID()),/Solo Administración/);
  await assert.rejects(w.AVHCommercial.fromWorkOrder({},'purchase_order'),/Solo Administración/);
  const order={id:randomUUID(),number:'OT-AVH-2026-00001',payload:{vessel:'TEST 716',client:'Cliente naval',location:'Villa Hayes',tasks:[{sector:'Popa',description:'Chapa 12.7 mm',quantity:3,unit:'unidad'}]}};
  await w.AVHCommercial.fromWorkOrder(order,'quote');assert.equal(w.AVHCommercial.state.current.payload.items[0].unit_price,null);
  input('#cd-currency','USD');input('#cd-tax_mode','add');input('#cd-tax_rate',10);input('#cd-valid_until','2026-11-15');input('#cd-payment_terms','Contado');input('#cd-delivery_terms','Según alcance');input('[data-cd-line="unit_price"]',.335);
  assert.match(w.document.querySelector('#cdTotals').textContent,/1,11/);const node=w.document.querySelector('#cd-payment_terms');await w.loadAll();assert.equal(w.document.querySelector('#cd-payment_terms'),node);assert.equal(node.value,'Contado');
  click('#cdAi');await wait(()=>w.document.querySelector('#cdApplyAi')&&!w.AVHCommercial.state.busy);click('#cdApplyAi');assert.equal(w.AVHCommercial.state.dirty,true);assert.equal(w.AVHCommercial.state.current.payload.items[0].unit_price,.335);
  click('#cdSave');await wait(()=>!w.AVHCommercial.state.busy&&!w.AVHCommercial.state.dirty);click('#cdIssue');await wait(()=>!w.AVHCommercial.state.busy&&w.document.querySelector('#commercialError').textContent.includes('perdida'));
  click('#cdIssue');await wait(()=>!w.AVHCommercial.state.busy&&w.AVHCommercial.state.current.number);assert.equal(numbers,1);assert.equal(w.document.querySelector('#cd-payment_terms').disabled,true);assert.equal(w.document.querySelector('#cdIssue'),null);
  click('#cdPdf');await wait(()=>downloads.length===1&&!w.AVHCommercial.state.busy);assert.match(downloads[0].name,/PRE-AVH/);assert.ok(downloads[0].blob.size>40000);
  role=null;await w.AVHCommercial.refresh();assert.equal(w.AVHCommercial.state.current,null);assert.match(w.document.querySelector('#commercialPanel').textContent,/requiere/);
 }finally{w.close();}
});
