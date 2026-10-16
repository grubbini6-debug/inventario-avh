import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID,webcrypto} from 'node:crypto';
import {JSDOM} from 'jsdom';
import * as pdfLib from 'pdf-lib';
import {database} from './fixtures/commercial-database.mjs';
import {makeCommercialPdf} from '../edge-functions/_shared/commercial-pdf.mjs';
import {logoDataUrl,workbookWithLogos} from './fixtures/quote-workbook.mjs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
test('Galo imports the issuer and its sheet logo from XLSX, reviews both parties, saves to PostgreSQL and emits that company PDF',async()=>{
 const db=await database(),admin=randomUUID(),galo=randomUUID(),company=randomUUID();
 const q=(sql,args=[])=>db.query(sql,args);
 await q('insert into auth.users(id) values($1),($2)',[admin,galo]);await q("insert into profiles(id,username,full_name,role,active) values($1,'compras','Gabriel','admin',true),($2,'galo','Galo','production',true)",[admin,galo]);await q("insert into work_order_access(user_id,access_level,granted_by) values($1,'editor',$2)",[galo,admin]);await q("insert into purchase_companies(id,name,legal_name,tax_id) values($1,'AVH','Astillero Villa Hayes S.A.','80091371-0')",[company]);await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:galo,role:'authenticated'})]);await db.exec('set role authenticated');
 const dom=new JSDOM('<nav><button class="commercial-nav"><span></span></button></nav><section id="page-commercial" class="page on"><div id="commercialPanel"></div></section>',{url:'https://avh.test/',runScripts:'outside-only'}),w=dom.window,downloads=[];
 const wait=async check=>{for(let n=0;n<250;n++){if(check())return;await new Promise(r=>setTimeout(r,10));}throw Error(w.document.querySelector('#commercialError')?.textContent||'UI timeout');};
 const input=(selector,value)=>{const el=w.document.querySelector(selector);el.value=String(value);el.dispatchEvent(new w.Event('input',{bubbles:true}));};
 Object.defineProperty(w,'crypto',{value:webcrypto});w.URL.createObjectURL=blob=>{downloads.push({blob});return 'blob:quote';};w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){downloads.at(-1).name=this.download;};
 Object.assign(w,{structuredClone,TextDecoder,profile:{id:galo,username:'galo',full_name:'Galo',role:'production'},$:s=>w.document.querySelector(s),$$:s=>[...w.document.querySelectorAll(s)],esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),canonicalOperationValue:v=>v,canRefreshView:()=>true,loadAll:async()=>{},goPage:()=>{},closeModal:()=>{}});
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
  for(const file of ['../src/assets/xlsx-0.20.3.min.js','../edge-functions/_shared/quote-excel-model.js','../edge-functions/_shared/company-logo.js','../src/features/work-orders/commercial-model.js','../src/features/work-orders/commercial.js'])w.eval(read(file));
  await w.AVHCommercial.refresh();assert.ok(w.document.querySelector('#cdExcelFile'));assert.equal(w.document.querySelector('#cdNewOc'),null);
  const rows=[['Presupuesto de trabajos 716'],['Empresa emisora','Talleres del Puerto S.A.'],['RUC','80123456-7'],['Dirección','Ruta 9 - Villa Hayes'],['Teléfono','021 555 100'],['Correo','presupuestos@example.test'],['Cliente','Cliente naval'],['Moneda','USD'],['IVA incluido 10%'],['Válido hasta','15/11/2026'],['Condición de pago','Contado'],['Plazo de entrega','En una semana'],['Descripción','Cantidad','Unidad','Precio unitario USD','Importe USD'],['Reparación de chapa 7.9 mm',3,'unidad',.335,1.01],['Corte y plegado',2,'servicio',7.5,15],['Total general',null,null,null,16.01]];
  const book=w.XLSX.utils.book_new();w.XLSX.utils.book_append_sheet(book,w.XLSX.utils.aoa_to_sheet([['Información general']]),'Datos');w.XLSX.utils.book_append_sheet(book,w.XLSX.utils.aoa_to_sheet(rows),'Precios');
  const logo=logoDataUrl(),bytes=workbookWithLogos(w.XLSX,w.XLSX.write(book,{bookType:'xlsx',type:'array'}),[{sheet:1,name:'otra-hoja.png',data_url:logoDataUrl(20,20)},{sheet:2,name:'logo-puerto.png',data_url:logo},{sheet:2,name:'logo-cliente.png',data_url:logoDataUrl(40,40)}]),file={name:'Trabajos_con_precios.xlsx',size:bytes.byteLength,arrayBuffer:async()=>bytes};
  let field=w.document.querySelector('#cdExcelFile');Object.defineProperty(field,'files',{value:[file]});field.dispatchEvent(new w.Event('change',{bubbles:true}));await wait(()=>w.AVHCommercial.state.excel&&!w.AVHCommercial.state.busy);
  field=w.document.querySelector('#cdExcelSheet');field.value='Precios';field.dispatchEvent(new w.Event('change',{bubbles:true}));w.document.querySelector('#cdExcelAnalyze').click();await wait(()=>w.AVHCommercial.state.current&&!w.AVHCommercial.state.busy);
  const draft=w.AVHCommercial.state.current;assert.equal(draft.payload.items.length,2);assert.equal(draft.payload.items[0].quantity,3);assert.equal(draft.payload.items[0].unit_price,.335);assert.equal(draft.payload.recipient_name,'Cliente naval');assert.equal(draft.payload.valid_until,'2026-11-15');assert.equal(draft.payload.payment_terms,'Contado');assert.equal(draft.payload.tax_rate,10);assert.equal(w.AVHCommercialModel.totals(draft.payload).total,16.01);
  assert.equal(draft.payload.company.legal_name,'Talleres del Puerto S.A.');assert.equal(draft.payload.company.tax_id,'80123456-7');assert.equal(draft.payload.company.brand_avh,false);assert.equal(draft.payload.company.logo_data_url,'');assert.equal(draft.importLogos.length,2);
  field=w.document.querySelector('#cdLogoCandidate');field.value='0';field.dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(w.document.querySelector('.cd-logo-preview').src,logo);
  for(const choice of ['avh','custom']){field=w.document.querySelector('#cd-company_brand');field.value=choice;field.dispatchEvent(new w.Event('change',{bubbles:true}));}assert.equal(draft.payload.company.legal_name,'Talleres del Puerto S.A.');assert.equal(draft.payload.company.logo_data_url,logo);
  input('#cd-company-address','Puerto de Villa Hayes');input('#cd-recipient_name','Astillero Villa Hayes S.A.');
  input('#cd-notes','Alcance confirmado para el cliente.');const note=w.document.querySelector('#cd-notes');await w.loadAll();assert.equal(w.document.querySelector('#cd-notes'),note);assert.equal(note.value,'Alcance confirmado para el cliente.');
  w.document.querySelector('#cdSave').click();await wait(()=>!w.AVHCommercial.state.dirty&&!w.AVHCommercial.state.busy);assert.equal(w.AVHCommercial.state.current.payload.company.logo_data_url,logo);assert.equal(w.AVHCommercial.state.current.payload.company.address,'Puerto de Villa Hayes');
  w.document.querySelector('#cdRemoveLogo').click();assert.equal(w.document.querySelector('.cd-logo-preview'),null);
  const jpg=fs.readFileSync(new URL('../src/assets/logo-maqmoveis.jpg',import.meta.url)),attachment={name:'logo.jpg',size:jpg.length,arrayBuffer:async()=>jpg};field=w.document.querySelector('#cdLogoFile');Object.defineProperty(field,'files',{value:[attachment]});field.dispatchEvent(new w.Event('change',{bubbles:true}));await wait(()=>!!w.document.querySelector('.cd-logo-preview')&&!w.AVHCommercial.state.busy);assert.match(w.AVHCommercial.state.current.payload.company.logo_data_url,/^data:image\/jpeg;/);
  w.document.querySelector('#cdSave').click();await wait(()=>!w.AVHCommercial.state.dirty&&!w.AVHCommercial.state.busy);assert.match(w.AVHCommercial.state.current.payload.company.logo_data_url,/^data:image\/jpeg;/);field=w.document.querySelector('#cdLogoCandidate');field.value='0';field.dispatchEvent(new w.Event('change',{bubbles:true}));
  w.document.querySelector('#cdIssue').click();await wait(()=>!!w.AVHCommercial.state.current.number&&!w.AVHCommercial.state.busy);const issued=w.AVHCommercial.state.current;assert.match(issued.number,/^PRE-2026-/);assert.equal(issued.issued_payload.total,16.01);assert.equal(issued.issued_payload.items[0].unit_price,.335);assert.equal(issued.issued_payload.notes,'Alcance confirmado para el cliente.');assert.equal(issued.issued_payload.company.legal_name,'Talleres del Puerto S.A.');assert.equal(issued.issued_payload.company.logo_data_url,logo);assert.equal(issued.issued_payload.recipient_name,'Astillero Villa Hayes S.A.');
  const audit=(await q("select request_data->'excel_source' source from commercial_document_events where document_id=$1 and action='save' order by created_at",[issued.id])).rows[0].source;assert.equal(audit.file_name,file.name);assert.equal(audit.sheet,'Precios');assert.equal(audit.sha256.length,64);assert.equal(audit.source_rows.length,rows.length);
  const pdf=await makeCommercialPdf(issued,pdfLib),doc=await pdfLib.PDFDocument.load(pdf);assert.equal(doc.getAuthor(),'Talleres del Puerto S.A.');const objects=doc.getPages()[0].node.Resources().lookup(pdfLib.PDFName.of('XObject'));assert.equal(objects.keys().length,1);const image=objects.lookup(objects.keys()[0]);assert.equal(image.dict.get(pdfLib.PDFName.of('Width')).asNumber(),192);assert.equal(image.dict.get(pdfLib.PDFName.of('Height')).asNumber(),64);
  if(process.env.AVH_QUOTE_PDF_QA_DIR){fs.mkdirSync(process.env.AVH_QUOTE_PDF_QA_DIR,{recursive:true});fs.writeFileSync(process.env.AVH_QUOTE_PDF_QA_DIR+'/issuer-quote.pdf',pdf);fs.writeFileSync(process.env.AVH_QUOTE_PDF_QA_DIR+'/issuer-source.xlsx',new Uint8Array(bytes));}
  w.document.querySelector('#cdPdf').click();await wait(()=>downloads.length===1&&!w.AVHCommercial.state.busy);assert.match(downloads[0].name,/PRE-2026/);assert.ok(downloads[0].blob.size>1500);assert.equal((await q("select count(*)::int n from commercial_documents where kind='purchase_order'")).rows[0].n,0);
 }finally{w.close();await db.close();}
});
