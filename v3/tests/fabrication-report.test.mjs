import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import * as pdfLib from 'pdf-lib';
import {makeFabricationPdf,reportSections,base64} from '../edge-functions/_shared/fabrication-pdf.mjs';
const ID='10000000-0000-0000-0000-000000000001';
const report={id:ID,report_date:'2026-10-08',revision:2,source:'automatic',payload:{warehouse:{name:'Taller existente'},generated_at:'2026-10-09T03:10:00Z',movements:[],orders:[],work_logs:[],quality:[],materials:[],costs:[],events:[],supply_requests:[],stock_alerts:[],closure:null,data_notes:['Control interno independiente de aprobación formal.']}};
function handler(file,env,fetch){
  let run;const code=fs.readFileSync(new URL(file,import.meta.url),'utf8').replace(/^import .*\n/gm,'');
  const scope={Deno:{env:{get:k=>env[k]},serve:h=>{run=h;}},fetch,Request,Response,crypto:globalThis.crypto,TextEncoder,Uint8Array,JSON,makeFabricationPdf,pdfLib,base64};
  vm.runInNewContext(stripTypeScriptTypes(code),scope);return run;
}
test('daily PDF preserves absent-data labels and paginates the complete history',async()=>{
  const large=structuredClone(report);large.payload.movements=Array.from({length:420},(_,i)=>({number:i+1,type:'entry',status:'confirmed',lines:[{product:'Acero','quantity':1,unit:'kg'}],notes:i===419?'ÚLTIMO REGISTRO '+ 'x'.repeat(300):'Ingreso real'}));
  const sections=reportSections(large);assert.equal(sections.find(s=>s.title==='Movimientos del depósito').lines.length,420);
  assert.ok(sections.find(s=>s.title==='Movimientos del depósito').lines.at(-1).includes('ÚLTIMO REGISTRO'));
  assert.deepEqual(sections.find(s=>s.title==='Cierre y actividades previstas').lines,['Sin registros para esta sección.']);
  const bytes=await makeFabricationPdf(large,pdfLib),pdf=await pdfLib.PDFDocument.load(bytes);assert.ok(pdf.getPageCount()>10);assert.equal(new TextDecoder().decode(bytes.slice(0,4)),'%PDF');
});
test('PDF endpoint validates the session and reads with the user JWT; RLS blocks another workshop',async()=>{
  const calls=[],env={SUPABASE_URL:'https://fixture.test',SUPABASE_PUBLISHABLE_KEY:'test-publishable'};
  const run=handler('../edge-functions/fabrication-report-pdf/index.ts',env,async(url,options)=>{calls.push({url,options});return url.endsWith('/auth/v1/user')?Response.json({id:ID}):Response.json([]);});
  assert.equal((await run(new Request('https://fn.test',{method:'POST',body:JSON.stringify({report_id:ID})}))).status,401);
  const r=await run(new Request('https://fn.test',{method:'POST',headers:{Authorization:'Bearer user-session'},body:JSON.stringify({report_id:ID})}));assert.equal(r.status,404);
  assert.equal(calls.length,2);assert.ok(calls.every(x=>x.options.headers.Authorization==='Bearer user-session'));assert.ok(calls.every(x=>x.options.headers.apikey==='test-publishable'));
});
test('authorized PDF download returns an actual PDF and rejects invalid report IDs',async()=>{
  const run=handler('../edge-functions/fabrication-report-pdf/index.ts',{SUPABASE_URL:'https://fixture.test',SUPABASE_ANON_KEY:'public'},async url=>url.endsWith('/auth/v1/user')?Response.json({id:ID}):Response.json([report]));
  const request=id=>new Request('https://fn.test',{method:'POST',headers:{Authorization:'Bearer user'},body:JSON.stringify({report_id:id})});
  assert.equal((await run(request('invalid'))).status,400);const r=await run(request(ID));assert.equal(r.status,200);const body=await r.json();assert.equal(body.filename,'AVH_Fabricacion_2026-10-08_r2.pdf');assert.equal(atob(body.pdf_base64).slice(0,4),'%PDF');
});
test('automatic email uses configured recipients, a service claim and a stable provider idempotency key',async()=>{
  const calls=[];let claimed=false;
  const env={FABRICATION_CRON_SECRET:'fixture-secret',SUPABASE_URL:'https://fixture.test',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',RESEND_API_KEY:'fixture-mail',FABRICATION_REPORT_FROM:'AVH <reports@example.test>'};
  const run=handler('../edge-functions/fabrication-report-mail/index.ts',env,async(url,options)=>{
    calls.push({url,options});if(url.endsWith('fabrication_email_claim')){if(claimed)return Response.json(null);claimed=true;return Response.json({report,recipients:['compras@example.test'],claim_token:ID});}
    return Response.json(url.includes('resend.com')?{id:'provider-id'}:true);
  });
  assert.equal((await run(new Request('https://fn.test',{method:'POST'}))).status,401);assert.equal(calls.length,0);
  const response=await run(new Request('https://fn.test',{method:'POST',headers:{'x-fabrication-cron-secret':'fixture-secret'}}));assert.deepEqual(await response.json(),{sent:1,failed:0});
  const sent=calls.find(c=>c.url.includes('resend.com')),body=JSON.parse(sent.options.body);assert.deepEqual(body.to,['compras@example.test']);assert.equal(sent.options.headers['Idempotency-Key'],`avh-fabrication-${ID}`);assert.equal(atob(body.attachments[0].content).slice(0,4),'%PDF');
  assert.ok(calls.some(c=>c.url.endsWith('fabrication_email_finish')&&JSON.parse(c.options.body).p_error===null));
});
test('provider rejection is recorded in the queue and never reported as sent',async()=>{
  let claimed=false,finished;
  const env={FABRICATION_CRON_SECRET:'fixture-secret',SUPABASE_URL:'https://fixture.test',SUPABASE_SERVICE_ROLE_KEY:'service',RESEND_API_KEY:'mail',FABRICATION_REPORT_FROM:'reports@example.test'};
  const run=handler('../edge-functions/fabrication-report-mail/index.ts',env,async(url,options)=>{
    if(url.endsWith('fabrication_email_claim')){if(claimed)return Response.json(null);claimed=true;return Response.json({report,recipients:['compras@example.test'],claim_token:ID});}
    if(url.includes('resend.com'))return new Response('unavailable',{status:503});finished=JSON.parse(options.body);return Response.json(true);
  });
  const r=await run(new Request('https://fn.test',{method:'POST',headers:{'x-fabrication-cron-secret':'fixture-secret'}}));assert.deepEqual(await r.json(),{sent:0,failed:1});assert.match(finished.p_error,/503/);
});
