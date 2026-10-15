import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID,webcrypto} from 'node:crypto';
import {JSDOM} from 'jsdom';
import * as pdfLib from 'pdf-lib';
import {database} from './fixtures/commercial-database.mjs';
import {makeCommercialPdf} from '../edge-functions/_shared/commercial-pdf.mjs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
test('Galo uploads a real XLSX, selects the price sheet, reviews exact values, saves to PostgreSQL and emits the numbered PDF',async()=>{
 const db=await database(),admin=randomUUID(),galo=randomUUID(),company=randomUUID();
 const q=(sql,args=[])=>db.query(sql,args);
 await q('insert into auth.users(id) values($1),($2)',[admin,galo]);await q("insert into profiles(id,username,full_name,role,active) values($1,'compras','Gabriel','admin',true),($2,'galo','Galo','production',true)",[admin,galo]);await q("insert into work_order_access(user_id,access_level,granted_by) values($1,'editor',$2)",[galo,admin]);await q("insert into purchase_companies(id,name,legal_name,tax_id) values($1,'AVH','Astillero Villa Hayes S.A.','80091371-0')",[company]);await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:galo,role:'authenticated'})]);await db.exec('set role authenticated');
 const dom=new JSDOM('<nav><button class="commercial-nav"><span></span></button></nav><section id="page-commercial" class="page on"><div id="commercialPanel"></div></section>',{url:'https://avh.test/',runScripts:'outside-only'}),w=dom.window,downloads=[];
 const wait=async check=>{for(let n=0;n<250;n++){if(check())return;await new Promise(r=>setTimeout(r,10));}throw Error(w.document.querySelector('#commercialError')?.textContent||'UI timeout');};
 const input=(selector,value)=>{const el=w.document.querySelector(selector);el.value=String(value);el.dispatchEvent(new w.Event('input',{bubbles:true}));};
 Object.defineProperty(w,'crypto',{value:webcrypto});w.URL.createObjectURL=blob=>{downloads.push({blob});return 'blob:quote';};w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){downloads.at(-1).name=this.download;};
 Object.assign(w,{structuredClone,profile:{id:galo,username:'galo',full_name:'Galo',role:'production'},$:s=>w.document.querySelector(s),$$:s=>[...w.document.querySelectorAll(s)],esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),canonicalOperationValue:v=>v,canRefreshView:()=>true,loadAll:async()=>{},goPage:()=>{},closeModal:()=>{}});
 w.rpc=async(name,args={})=>{
  try{
   if(name==='commercial_context')return{data:(await q('select commercial_context() d')).rows[0].d};
   if(name==='commercial_document')return{data:(await q('select commercial_document($1) d',[args.p_id])).rows[0].d};
   if(name==='commercial_command')return{data:(await q('select commercial_command($1,$2,$3) d',[args.p_action,JSON.stringify(args.p_data),args.p_request_id])).rows[0].d};
   throw Error(name);
  }catch(error){return{error:error.message,status:400};}
 };
 w.queryAll=async()=>({data:(await q('select * from commercial_documents')).rows.map(d=>({...d,title:d.payload.title,recipient_name:d.payload.recipient_name,reference:d.payload.reference}))});
 w.edge=async(name,args)=>{
  if(name==='quote-excel-ai'){assert.equal(args.sheet,'Precios');return{data:{analysis:w.AVHQuoteExcelModel.parse(args.rows,args.sheet)}};}
  assert.equal(name,'commercial-pdf');const d=(await q('select commercial_document($1) d',[args.document_id])).rows[0].d;return{data:{filename:d.number+'.pdf',pdf_base64:Buffer.from(await makeCommercialPdf(d,pdfLib)).toString('base64')}};
 };
 try{
  for(const file of ['../src/assets/xlsx-0.20.3.min.js','../edge-functions/_shared/quote-excel-model.js','../src/features/work-orders/commercial-model.js','../src/features/work-orders/commercial.js'])w.eval(read(file));
  await w.AVHCommercial.refresh();assert.ok(w.document.querySelector('#cdExcelFile'));assert.equal(w.document.querySelector('#cdNewOc'),null);
  const rows=[['Presupuesto de trabajos 716'],['Cliente','Cliente naval'],['Moneda','USD'],['IVA incluido 10%'],['Válido hasta','15/11/2026'],['Condición de pago','Contado'],['Plazo de entrega','En una semana'],['Descripción','Cantidad','Unidad','Precio unitario USD','Importe USD'],['Reparación de chapa 7.9 mm',3,'unidad',.335,1.01],['Corte y plegado',2,'servicio',7.5,15],['Total general',null,null,null,16.01]];
  const book=w.XLSX.utils.book_new();w.XLSX.utils.book_append_sheet(book,w.XLSX.utils.aoa_to_sheet([['Información general']]),'Datos');w.XLSX.utils.book_append_sheet(book,w.XLSX.utils.aoa_to_sheet(rows),'Precios');
  const bytes=w.XLSX.write(book,{bookType:'xlsx',type:'array'}),file={name:'Trabajos_con_precios.xlsx',size:bytes.byteLength,arrayBuffer:async()=>bytes};
  let field=w.document.querySelector('#cdExcelFile');Object.defineProperty(field,'files',{value:[file]});field.dispatchEvent(new w.Event('change',{bubbles:true}));await wait(()=>w.AVHCommercial.state.excel&&!w.AVHCommercial.state.busy);
  field=w.document.querySelector('#cdExcelSheet');field.value='Precios';field.dispatchEvent(new w.Event('change',{bubbles:true}));w.document.querySelector('#cdExcelAnalyze').click();await wait(()=>w.AVHCommercial.state.current&&!w.AVHCommercial.state.busy);
  const draft=w.AVHCommercial.state.current;assert.equal(draft.payload.items.length,2);assert.equal(draft.payload.items[0].quantity,3);assert.equal(draft.payload.items[0].unit_price,.335);assert.equal(draft.payload.recipient_name,'Cliente naval');assert.equal(draft.payload.valid_until,'2026-11-15');assert.equal(draft.payload.payment_terms,'Contado');assert.equal(draft.payload.tax_rate,10);assert.equal(w.AVHCommercialModel.totals(draft.payload).total,16.01);
  input('#cd-notes','Alcance confirmado para el cliente.');const note=w.document.querySelector('#cd-notes');await w.loadAll();assert.equal(w.document.querySelector('#cd-notes'),note);assert.equal(note.value,'Alcance confirmado para el cliente.');
  w.document.querySelector('#cdIssue').click();await wait(()=>!!w.AVHCommercial.state.current.number&&!w.AVHCommercial.state.busy);const issued=w.AVHCommercial.state.current;assert.match(issued.number,/^PRE-AVH-2026-/);assert.equal(issued.issued_payload.total,16.01);assert.equal(issued.issued_payload.items[0].unit_price,.335);assert.equal(issued.issued_payload.notes,'Alcance confirmado para el cliente.');
  const audit=(await q("select request_data->'excel_source' source from commercial_document_events where document_id=$1 and action='save' order by created_at",[issued.id])).rows[0].source;assert.equal(audit.file_name,file.name);assert.equal(audit.sheet,'Precios');assert.equal(audit.sha256.length,64);assert.equal(audit.source_rows.length,rows.length);
  w.document.querySelector('#cdPdf').click();await wait(()=>downloads.length===1&&!w.AVHCommercial.state.busy);assert.match(downloads[0].name,/PRE-AVH/);assert.ok(downloads[0].blob.size>40000);assert.equal((await q("select count(*)::int n from commercial_documents where kind='purchase_order'")).rows[0].n,0);
 }finally{w.close();await db.close();}
});
