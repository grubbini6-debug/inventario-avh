import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import * as runtime from '../edge-functions/_shared/ai-runtime.mjs';
import * as copy from '../edge-functions/_shared/commercial-copy.mjs';
import {endpoint as documentEndpoint} from './fixtures/quote-document-endpoint.mjs';
import {reading} from './fixtures/quote-reading.mjs';
import {logoDataUrl} from './fixtures/quote-workbook.mjs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
function excelEndpoint(fetch){
 const ctx={...runtime,...copy,fetch,Request,Response,AbortSignal,console,Deno:{env:{get:k=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'public',OPENAI_API_KEY:'isolated'}[k])},serve:h=>ctx.handler=h}};
 for(const n of ['quote-excel-model.js','repair-budget-reading.js'])vm.runInNewContext(read('edge-functions/_shared/'+n),ctx);
 vm.runInNewContext(stripTypeScriptTypes(read('edge-functions/quote-excel-ai/index.ts').replace(/^import .*;\n/gm,''),{mode:'strip'}),ctx);return ctx.handler;
}
const metadata=()=>({quote_number:'TALLER-210',quote_date:'2026-10-21',valid_until:null,problem:'No alimenta alambre',payment_terms:'Crédito 30 días',notes:'Entrega en 5 días',warehouse_name:null,warranty_days:30,supplier:{legal_name:'Taller de prueba',tax_id:'80000000-0'},recipient:{legal_name:'Astillero Villa Hayes S.A.',tax_id:'80000000-1'},equipment:[{code:'MIG-07',name:'Soldadora MIG',brand:'Marca de prueba',model:'400 A',serial_number:'S-777',item_indices:[0,1]}],item_kinds:[{item_index:0,kind:'labor'},{item_index:1,kind:'part'}]});
const request=body=>new Request('https://test/functions',{method:'POST',headers:{Authorization:'Bearer caller','Content-Type':'application/json'},body:JSON.stringify(body)});
test('repair Excel context reads source metadata without letting AI change prices or authorizing Production',async()=>{
 let role='admin',calls=0,invalid=false;
 const run=excelEndpoint(async(url,opt)=>{
  if(url.endsWith('/auth/v1/user'))return Response.json({id:'caller'});
  if(url.includes('commercial_context'))return Response.json({access_level:role});
  calls++;const b=JSON.parse(opt.body);assert.equal(b.text.format.name,'avh_repair_excel');assert.match(b.input[0].content,/modelo no es un código/);assert.equal(b.store,false);assert.equal(b.text.format.schema.properties.unit_price,undefined);
  return Response.json({status:'completed',output_text:JSON.stringify({...metadata(),...(invalid?{unit_price:0}:{})})});
 });
 const body={purpose:'equipment_repair',rows:[['Moneda','PYG'],['IVA 10%'],['Descripción','Cantidad','Precio unitario'],['Reparación',1,1000],['Rodillo',1,500]]};
 const r=await (await run(request(body))).json();assert.equal(r.analysis.repair.quote_number,'TALLER-210');assert.equal(r.analysis.repair.warranty_days,30);assert.equal(r.analysis.items[0].unit_price,1000);assert.equal(r.analysis.calculated_total,1650);
 invalid=true;const fallback=await (await run(request(body))).json();assert.equal(fallback.analysis.items[0].unit_price,1000);assert.equal(fallback.analysis.repair,undefined);assert.match(fallback.analysis.warnings.join(' '),/no se pudieron completar/);
 role='editor';assert.equal((await run(request(body))).status,403);assert.equal(calls,2);
});
test('repair PDF/photo context uses one structured reading, preserves uncertain amounts and requires admin',async()=>{
 let role='admin',calls=0,uncertain=false;
 const run=documentEndpoint(async(url,opt)=>{
  if(url.endsWith('/auth/v1/user'))return Response.json({id:'caller'});
  if(url.includes('commercial_context'))return Response.json({access_level:role});
  calls++;const b=JSON.parse(opt.body);assert.equal(b.text.format.name,'avh_repair_document');assert.ok(b.text.format.schema.required.includes('repair'));assert.equal(b.input[1].content.filter(c=>c.type==='input_image').length,1);
  const raw=reading();raw.repair=metadata();if(uncertain)raw.items[0].uncertain_fields=['unit_price'];return Response.json({status:'completed',output_text:JSON.stringify(raw)});
 });
 const body={purpose:'equipment_repair',files:[{file_name:'taller.png',file_data:logoDataUrl()}]};
 const r=await (await run(request(body))).json();assert.equal(r.analysis.repair.problem,'No alimenta alambre');assert.equal(r.analysis.repair.equipment[0].serial_number,'S-777');assert.equal(r.analysis.items[0].unit_price,.335);
 uncertain=true;const partial=await (await run(request(body))).json();assert.equal(partial.analysis.items[0].unit_price,null);assert.equal(partial.analysis.repair.warranty_days,30);
 role='editor';assert.equal((await run(request(body))).status,403);assert.equal(calls,2);
});
