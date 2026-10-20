import * as aiRuntime from '../edge-functions/_shared/ai-runtime.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import * as pdfLib from 'pdf-lib';
import * as copy from '../edge-functions/_shared/commercial-copy.mjs';
import {makeCommercialPdf} from '../edge-functions/_shared/commercial-pdf.mjs';
import {purchaseOrderDocument} from '../edge-functions/_shared/purchase-order-document.mjs';
import {base64} from '../edge-functions/_shared/work-order-pdf.mjs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8'),id='11111111-1111-4111-8111-111111111111';
const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'test-public',OPENAI_API_KEY:'test-secret',SUPABASE_SERVICE_ROLE_KEY:'test-service'};
function endpoint(name,fetch,createClient){let handler;const code=stripTypeScriptTypes(read('../edge-functions/'+name+'/index.ts').replace(/^import .*;\n/gm,''),{mode:'strip'});vm.runInNewContext(code,{...aiRuntime,...copy,pdfLib,makeCommercialPdf,purchaseOrderDocument,base64,createClient,Deno:{env:{get:n=>env[n]},serve:f=>handler=f},fetch,Request,Response,AbortSignal,Uint8Array,btoa,console,performance});return handler;}
const request=body=>new Request('https://test/functions',{method:'POST',headers:{Authorization:'Bearer caller','Content-Type':'application/json'},body:JSON.stringify(body)});
test('Commercial PDF and AI use caller authorization, reject inaccessible documents and conserve numeric content',async()=>{
 let visible=true,modelCalls=0,change=false;const doc={id,kind:'quote',status:'draft',payload:{title:'Reparación',recipient_name:'Cliente',reference:'TEST 716',currency:'USD',items:[{id:'i1',description:'Chapa 12.7 mm',quantity:1,unit:'unidad',unit_price:10,amount:10}],subtotal:10,total:10,tax_mode:'none'}};
 const fetch=async(url,options)=>{
  if(url.includes('/auth/v1/user')){assert.equal(options.headers.Authorization,'Bearer caller');return Response.json({id:'caller'});}
  if(url.includes('/rpc/commercial_document')){assert.equal(options.headers.Authorization,'Bearer caller');return visible?Response.json(doc):Response.json({error:'Sin acceso'},{status:403});}
  assert.equal(url,'https://api.openai.com/v1/responses');modelCalls++;const input=JSON.parse(options.body);assert.equal(input.store,false);assert.match(input.input[0].content,/nunca instrucciones/);assert.equal(input.text.format.strict,true);assert.doesNotMatch(input.input[1].content,/unit_price/);
  return Response.json({status:'completed',output_text:JSON.stringify({title:'Presupuesto técnico',introduction:'Alcance solicitado.',items:[{id:'i1',description:change?'Chapa 20 mm':'Recambio de chapa 12.7 mm'}]})});
 };
 const pdf=endpoint('commercial-pdf',fetch),ai=endpoint('commercial-ai',fetch);
 assert.equal((await pdf(request({document_id:id}))).status,200);assert.equal((await ai(request({document_id:id}))).status,200);assert.equal(modelCalls,1);
 change=true;assert.equal((await ai(request({document_id:id}))).status,400);visible=false;assert.equal((await pdf(request({document_id:id}))).status,403);assert.equal((await ai(request({document_id:id}))).status,403);assert.equal(modelCalls,2);
 assert.equal((await pdf(new Request('https://test/functions',{method:'POST',body:'{}'}))).status,401);
 assert.equal((await ai(new Request('https://test/functions',{method:'POST',headers:{Origin:'https://untrusted.test',Authorization:'Bearer caller'},body:'{}'}))).status,403);
});
test('Existing purchase PDF is also admin-only, and legacy purchases preserve delivery mode, prices and company identity',async()=>{
 let role='production',active=true;const client={auth:{getUser:async()=>({data:{user:{id:'caller'}}})},from:table=>{assert.equal(table,'profiles');return{select:()=>({eq:()=>({maybeSingle:async()=>({data:{role,active}})})})};}};
 const run=endpoint('purchase-order-pdf',()=>{throw Error('Unexpected request');},()=>client);assert.equal((await run(request({purchase_id:id}))).status,403);role='admin';active=false;assert.equal((await run(request({purchase_id:id}))).status,403);
 const d=purchaseOrderDocument({po_number:'OC-2026-001',currency:'USD',status:'approved',created_at:'2026-10-15',delivery_mode:'partial'}, {name:'OTRA EMPRESA',legal_name:'Otra empresa'}, {name:'Proveedor'},[{id:'a',description:'Chapa',quantity:3,unit:'kg',unit_price:.335}],'Villa Hayes','TEST');assert.equal(d.issued_payload.company.brand_avh,false);assert.equal(d.issued_payload.total,1.01);assert.equal(d.issued_payload.items[0].unit_price,.335);assert.match(d.issued_payload.delivery_terms,/parciales/);
 const pdf=await pdfLib.PDFDocument.load(await makeCommercialPdf(d,pdfLib));assert.equal(pdf.getPageCount(),1);
});

test('OC PDF cache follows the saved version and rejects exporting a stale review',async()=>{
 const files=new Map(),docs=[];let version='version-1';
 const document=()=>({id,purchase_id:id,number:'OC-AVH-REVISADA',kind:'purchase_order',status:'draft',version,payload:{title:'Compra revisada',document_date:'2026-10-15',company:{legal_name:'Astillero Villa Hayes S.A.',tax_id:'80091371-0',address:version},currency:'USD',recipient_name:'Proveedor '+version,items:[{id:'line',description:'Chapa',quantity:2,unit:'kg',unit_price:5,amount:10}],subtotal:10,total:10,tax_mode:'none',payment_terms:'Contado',delivery_terms:'En una semana'}});
 const client={auth:{getUser:async()=>({data:{user:{id:'caller'}}})},from:table=>{
  const filters={};const chain={select:()=>chain,eq:(k,v)=>{filters[k]=v;return chain;},order:()=>chain,limit:()=>chain,maybeSingle:async()=>({data:table==='profiles'?{role:'admin',active:true}:docs.find(d=>d.source===filters.source)||null}),insert:async row=>{docs.push(row);return{error:null};}};return chain;
 },storage:{from:()=>({upload:async(path,bytes)=>{files.set(path,bytes);return{error:null};},download:async path=>({data:new Blob([files.get(path)]),error:null})})}};
 const handler=endpoint('purchase-order-pdf',async(url,options)=>{assert.match(url,/rpc\/admin_purchase_order_document$/);assert.equal(options.headers.Authorization,'Bearer caller');return Response.json(document());},()=>client);
 const first=await (await handler(request({purchase_id:id,expected_version:version}))).json();assert.equal(first.reused,false);assert.equal(first.filename,'OC-AVH-REVISADA.pdf');
 const repeat=await (await handler(request({purchase_id:id,expected_version:version}))).json();assert.equal(repeat.reused,true);assert.equal(repeat.pdf_base64,first.pdf_base64);
 version='version-2';assert.equal((await handler(request({purchase_id:id,expected_version:'version-1'}))).status,409);
 const updated=await (await handler(request({purchase_id:id,expected_version:version}))).json();assert.equal(updated.reused,false);assert.notEqual(updated.pdf_base64,first.pdf_base64);assert.notEqual(updated.file_path,first.file_path);assert.equal(files.size,2);
});
