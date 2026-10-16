import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {PDFDocument} from 'pdf-lib';
import {endpoint} from './fixtures/quote-document-endpoint.mjs';
import {reading} from './fixtures/quote-reading.mjs';
import {logoDataUrl} from './fixtures/quote-workbook.mjs';
const ctx={};for(const name of ['quote-excel-model.js','quote-document-model.js'])vm.runInNewContext(fs.readFileSync(new URL('../edge-functions/_shared/'+name,import.meta.url),'utf8'),ctx);const Q=ctx.AVHQuoteDocumentModel;
const files=[{pages:2,mime_type:'application/pdf'}],request=body=>new Request('https://test/functions/v1/quote-document-ai',{method:'POST',headers:{Authorization:'Bearer caller','Content-Type':'application/json'},body:JSON.stringify(body)}),photo={file_name:'presupuesto.png',file_data:logoDataUrl()};
test('PDF/photo readings conserve raw prices, issuer and exact totals; doubtful digits stay pending',()=>{
 const raw=reading(),a=Q.normalize(raw,files);assert.equal(a.company.legal_name,'Talleres del Puerto S.A.');assert.equal(a.company.brand_avh,false);assert.equal(a.company.logo_data_url,'');assert.equal(a.fields.recipient_name,'Astillero Villa Hayes S.A.');assert.equal(a.items[0].unit_price,.335);assert.equal(a.calculated_total,16.01);assert.equal(a.reading.items[0].unit_price_raw,'0.335');
 raw.items[0].uncertain_fields=['quantity'];let b=Q.normalize(raw,files);assert.equal(b.items[0].quantity,null);assert.equal(b.calculated_total,null);
 raw.items[0].uncertain_fields=['unit_price'];b=Q.normalize(raw,files);assert.equal(b.items[0].unit_price,null,'a clear line amount must not fill a price explicitly marked uncertain');
 raw.items[0].confidence=.5;b=Q.normalize(raw,files);assert.equal(b.items[0].quantity,null);assert.equal(b.items[0].unit_price,null);
 const conflict=reading();conflict.items[0].line_total_raw='5.00';const c=Q.normalize(conflict,files).items[0];assert.equal(c.unit_price,5);assert.equal(c.quantity,1);assert.equal(c.unit,'trabajo');assert.equal(c.source_values.unit_price,'0.335');assert.match(c.description,/original: 3/);
});
test('The complete source billing quantity, specifications and conditions survive without multiplying pieces by a kg tariff',()=>{
 const r=reading();Object.assign(r.items[0],{quantity_raw:'2',unit:'piezas',billing_quantity_raw:'1.286,00',billing_unit:'kg',unit_price_raw:'4,20',line_total_raw:'5.401,20',details:'Largo 4.000 mm / Ancho 2.000 mm / Espesor 7,9 mm'});r.source_total_raw='5.416,20';const a=Q.normalize(r,files);assert.equal(a.items[0].quantity,1286);assert.equal(a.items[0].unit,'kg');assert.equal(a.items[0].unit_price,4.2);assert.equal(a.calculated_total,5416.2);assert.match(a.items[0].description,/Espesor 7,9 mm/);assert.match(a.items[0].description,/Cantidad física: 2 piezas/);
});
test('Partial readings, mixed companies, invalid pages and non-source numeric values cannot become a budget',()=>{
 for(const change of [r=>r.complete=false,r=>r.same_issuer=false,r=>r.items[0].source_page=3,r=>r.items[0].source_file=2,r=>r.items[0].unit_price_raw=100,r=>r.items[0].confidence=undefined]){const raw=reading();change(raw);assert.throws(()=>Q.normalize(raw,files));}
 const raw=reading();raw.logo_region={source_file:1,source_page:1,x:.1,y:.1,width:1,height:1};const a=Q.normalize(raw,files);assert.equal(a.logo_region,null);assert.match(a.warnings.join(' '),/recorte/);
 raw.fields.valid_until='2026-02-31';assert.equal(Q.normalize(raw,files).fields.valid_until,undefined);
});
test('The authenticated document endpoint accepts multiple photos and PDFs with strict structured reading and no writes',async()=>{
 let role='editor',calls=0,received;
 const run=endpoint(async(url,options)=>{
  if(url.endsWith('/auth/v1/user')){assert.equal(options.headers.Authorization,'Bearer caller');return Response.json({id:'caller'});}
  if(url.includes('/rpc/commercial_context'))return Response.json({access_level:role});
  assert.equal(url,'https://api.openai.com/v1/responses');calls++;received=JSON.parse(options.body);const raw=reading();if(received.input[1].content.filter(c=>c.type==='input_image').length>1)raw.items[1].source_file=2;return Response.json({status:'completed',output_text:JSON.stringify(raw)});
 });
 const result=await (await run(request({files:[photo,{...photo,file_name:'pagina-2.png'}]}))).json();assert.equal(result.analysis.items.length,2);assert.equal(result.analysis.calculated_total,16.01);assert.equal(received.store,false);assert.equal(received.text.format.strict,true);assert.match(received.input[0].content,/nunca instrucciones/);assert.equal(received.input[1].content.filter(c=>c.type==='input_image').length,2);
 const pdf=await PDFDocument.create();pdf.addPage();const file={file_name:'presupuesto.pdf',file_data:'data:application/pdf;base64,'+Buffer.from(await pdf.save()).toString('base64')};assert.equal((await run(request({files:[file]}))).status,200);assert.equal(received.input[1].content.find(c=>c.type==='input_file').detail,'high');
 role=null;assert.equal((await run(request({files:[photo]}))).status,403);assert.equal(calls,2);assert.equal((await run(new Request('https://test/functions',{method:'POST',body:'{}'}))).status,401);
});
test('File limits, invalid formats, encrypted/broken PDFs, incomplete model output and missing configuration fail clearly',async()=>{
 let modelCalls=0,incomplete=false;
 const fetch=async url=>{if(url.includes('commercial_context'))return Response.json({access_level:'admin'});if(url.includes('/auth/'))return Response.json({id:'caller'});modelCalls++;return Response.json(incomplete?{status:'incomplete'}:{status:'completed',output_text:JSON.stringify(reading())});};
 const run=endpoint(fetch);
 for(const input of [{files:[]},{files:Array.from({length:7},()=>photo)},{files:[{file_name:'file.svg',file_data:'data:image/svg+xml;base64,PHN2Zy8+'}]},{files:[{file_name:'broken.pdf',file_data:'data:application/pdf;base64,'+Buffer.from('%PDF-1.7 broken').toString('base64')}]}])assert.equal((await run(request(input))).status,400);
 const huge=request({files:[photo]});huge.headers.set('Content-Length',String(18*1024*1024));assert.equal((await run(huge)).status,400);assert.equal(modelCalls,0);
 const pdf=await PDFDocument.create();for(let i=0;i<21;i++)pdf.addPage();assert.equal((await run(request({files:[{file_name:'large.pdf',file_data:'data:application/pdf;base64,'+Buffer.from(await pdf.save()).toString('base64')}]}))).status,400);assert.equal(modelCalls,0);
 incomplete=true;assert.equal((await run(request({files:[photo]}))).status,422);assert.equal((await endpoint(fetch,{OPENAI_API_KEY:undefined})(request({files:[photo]}))).status,503);
});
