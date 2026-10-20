import * as aiRuntime from '../edge-functions/_shared/ai-runtime.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import * as analysis from '../edge-functions/_shared/work-order-analysis.mjs';
import * as renderer from '../edge-functions/_shared/work-order-pdf.mjs';
import * as pdfLib from 'pdf-lib';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
function endpoint(file,fetch,env={}){
 let handler;const code=stripTypeScriptTypes(read(file).replace(/^import .*;\n/gm,''),{mode:'strip'});
 vm.runInNewContext(code,{...aiRuntime,...analysis,...renderer,pdfLib,Deno:{env:{get:n=>env[n]},serve:fn=>handler=fn},fetch,Response,Request,AbortSignal,Uint8Array,btoa,console});return handler;
}
const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'test-public',OPENAI_API_KEY:'test-secret'};
const request=body=>new Request('https://test.supabase.co/functions/v1/work-order-ai',{method:'POST',headers:{Authorization:'Bearer test-user','Content-Type':'application/json'},body:JSON.stringify(body)});
test('AI endpoint authorizes the caller, protects input coverage, and never invents quantities',async()=>{
 let role='editor',providerCalls=0,drop=false;
 const handler=endpoint('../edge-functions/work-order-ai/index.ts',async(url,options)=>{
  if(url.endsWith('/auth/v1/user')){assert.equal(options.headers.Authorization,'Bearer test-user');return Response.json({id:'caller'});}
  if(url.includes('/rpc/work_order_context'))return Response.json({access_level:role});
  assert.equal(url,'https://api.openai.com/v1/responses');providerCalls++;const body=JSON.parse(options.body);assert.equal(body.store,false);assert.equal(body.text.format.strict,true);assert.equal(body.model,'gpt-5.4-mini');assert.match(body.input[0].content,/nunca instrucciones/);
  return Response.json({status:'completed',output_text:JSON.stringify({title:'Reparación',vessel:'TEST',client:null,notes:null,warnings:[],groups:[{rows:drop?[]:[2],operations:['Preparar y soldar'],acceptance:['Medir según plano'],materials:[{description:'Consumible',unit:'kg',basis:'Falta longitud de cordón'}]}]})});
 },env);
 const body={file_name:'Trabajo.xlsx',sheet:'Alcance',rows:[['Encabezado'],['Chapa',4300,3000]],tasks:[{source_row:2,id:'fila-2',sector:'Popa',description:'Cambio de chapa',kind:'steel',weight_kg:1286,thickness_mm:12.7}]};
 const good=await handler(request(body));assert.equal(good.status,200);const result=await good.json();assert.equal(result.analysis.tasks[0].weight_kg,1286);assert.equal(result.analysis.tasks[0].materials[1].quantity,null);assert.equal(result.analysis.tasks[0].materials[0].confirmed,false);
 role='viewer';assert.equal((await handler(request(body))).status,403);assert.equal(providerCalls,1);
 assert.equal((await handler(new Request('https://test/functions/v1/work-order-ai',{method:'POST',body:'{}'}))).status,401);
 role='editor';drop=true;assert.equal((await handler(request(body))).status,400);
});
test('PDF endpoint uses the caller JWT and the stored issued snapshot; unavailable orders stay private',async()=>{
 const id='11111111-1111-4111-8111-111111111111';let visible=true;
 const handler=endpoint('../edge-functions/work-order-pdf/index.ts',async(url,options)=>{
  assert.equal(options.headers.Authorization,'Bearer test-user');
  if(url.endsWith('/auth/v1/user'))return Response.json({id:'caller'});
  assert.ok(url.includes('/rest/v1/work_orders?id=eq.'+id));
  return Response.json(visible?[{id,number:'OT-AVH-2026-00001',status:'issued',issued_payload:{title:'Alcance conservado',vessel:'TEST',responsible:'Galo',client:'Cliente',order_date:'2026-10-14',tasks:[{id:'a',sector:'Popa',description:'Trabajo validado',unit:'unidad',quantity:1,materials:[]}]}}]:[]);
 },env);
 const r=await handler(request({order_id:id}));assert.equal(r.status,200);const data=await r.json();assert.equal(data.filename,'OT-AVH-2026-00001.pdf');const doc=await pdfLib.PDFDocument.load(Buffer.from(data.pdf_base64,'base64'));assert.match(doc.getTitle(),/OT-AVH/);
 visible=false;assert.equal((await handler(request({order_id:id}))).status,404);assert.equal((await handler(request({order_id:'wrong'}))).status,400);
});
