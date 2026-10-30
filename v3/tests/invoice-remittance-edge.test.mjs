import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import * as runtime from '../edge-functions/_shared/ai-runtime.mjs';

const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const ids={purchase:'00000000-0000-4000-8000-000000000001',document:'00000000-0000-4000-8000-000000000002',warehouse:'00000000-0000-4000-8000-000000000003'};
const cdc='07800326415007002000394322026103010000198506';
function remittance(){return{
 complete:true,warnings:[],document_kind:'remittance',document_title:'Nota de remisión electrónica',document_number:'007-002-0003943',date:'2026-10-30',
 supplier_name:'Petersen',supplier_tax_id:'80032641-5',customer_name:'MAQMOVEIS',customer_tax_id:'80102016-6',
 currency:null,subtotal:null,tax:null,total:null,tax_mode:'unknown',confidence:.99,
 items:[{brand:null,manufacturer_code:null,product_code:'EB032095',description:'FLUX 429 - SC 25KG',quantity:625,unit:'kg',base_unit:null,factor_to_base:null,unit_price:null,line_total:null,confidence:.99}]
};}
function harness({document=remittance(),primaryDocument=null,role='admin',warehouse=ids.warehouse,reviewFails=false,concurrentInvoice=false,alreadyAttached=false}={}){
 const tables={
  profiles:[{id:'caller',active:true,role,warehouse_id:warehouse}],
  purchases:[{id:ids.purchase,warehouse_id:ids.warehouse,delivery_warehouse_ids:[ids.warehouse],destination_type:'warehouse',po_number:'OC-2026-00047',currency:'USD',invoice_number:cdc,invoice_date:'2026-10-30',updated_at:'2026-10-30T19:22:00Z'}],
  purchase_documents:[{id:ids.document,purchase_id:ids.purchase,kind:'invoice',file_path:'p/remito.pdf',file_name:'remito.pdf',document_number:cdc,document_date:'2026-10-30',receipt_id:'receipt'}],
  purchase_items:[{description:'FLUX 429 - SC 25KG',quantity:5200,received_qty:625,unit:'kg',unit_price:2.65,factor_to_base:1}],audit_events:[]
 };
 if(alreadyAttached)tables.purchase_documents.push({id:'another',purchase_id:ids.purchase,kind:'invoice',document_number:cdc});
 const writes=[];
 const client={auth:{getUser:async()=>({data:{user:{id:'caller'}}})},storage:{from:()=>({download:async()=>({data:new Blob(['%PDF-1.7 source'],{type:'application/pdf'})})})},from:name=>{
  const filters=[];let patch,insert,limit=Infinity;
  const execute=()=>{
   const selected=(tables[name]||[]).filter(row=>filters.every(([key,value])=>row[key]===value)).slice(0,limit);
   if(patch){writes.push({name,patch:structuredClone(patch),filters:structuredClone(filters)});for(const row of selected)Object.assign(row,structuredClone(patch));}
   if(insert){writes.push({name,insert:structuredClone(insert)});tables[name].push(structuredClone(insert));return{data:[structuredClone(insert)],error:null};}
   return{data:structuredClone(selected),error:null};
  };
  const q={select:()=>q,eq:(key,value)=>{filters.push([key,value]);return q;},order:()=>q,limit:value=>{limit=value;return q;},update:value=>{patch=value;return q;},insert:value=>{insert=value;return q;},maybeSingle:async()=>{const result=execute();return{...result,data:result.data[0]||null};},then:(resolve,reject)=>Promise.resolve(execute()).then(resolve,reject)};return q;
 }};
 let handler,calls=0;const ctx={...runtime,createClient:()=>client,Request,Response,AbortSignal,TextDecoder,Uint8Array,atob,btoa,console,
  fetch:async(url,options)=>{
   calls++;const sent=JSON.parse(options.body);assert.match(sent.input[0].content,/encabezado visible/);assert.match(sent.input[0].content,/CDC/);
   if(calls===2&&concurrentInvoice)Object.assign(tables.purchases[0],{invoice_number:'001-001-0000099',invoice_date:'2026-10-31',updated_at:'2026-10-30T20:30:00Z'});
   if(calls===2&&reviewFails)return Response.json({status:'completed',output_text:'{}'});
   return Response.json({status:'completed',output_text:JSON.stringify(calls===1&&primaryDocument?primaryDocument:document)});
  },Deno:{env:{get:k=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'private-test',OPENAI_API_KEY:'private-ai'}[k])},serve:f=>handler=f}
 };
 for(const file of ['product-identity.js','purchase-receiving-model.js'])vm.runInNewContext(read('../edge-functions/_shared/'+file),ctx);
 vm.runInNewContext(stripTypeScriptTypes(read('../edge-functions/purchase-invoice-control-ai/index.ts').replace(/^import .*;\n/gm,''),{mode:'strip'}),ctx);
 const run=()=>handler(new Request('https://test/functions',{method:'POST',headers:{Authorization:'Bearer caller','Content-Type':'application/json'},body:JSON.stringify({purchase_id:ids.purchase,document_id:ids.document})}));
 return{run,tables,writes,calls:()=>calls};
}

test('two readings of a remittance reclassify the attachment, clear only its stale invoice header and never touch stock',async()=>{
 const h=harness(),response=await h.run(),result=await response.json();
 assert.equal(response.status,200);assert.equal(h.calls(),2);assert.equal(result.kind,'remittance');
 const doc=h.tables.purchase_documents[0];assert.equal(doc.kind,'remittance');assert.equal(doc.document_number,'007-002-0003943');assert.equal(doc.receipt_id,'receipt');
 assert.equal(doc.analysis_data.items[0].quantity,625);assert.equal(doc.analysis_data.currency,null);assert.equal(doc.analysis_data.items[0].unit_price,null);
 assert.equal(doc.analysis_data.validation.financial,null);assert.deepEqual(doc.analysis_data.validation.issues,[]);
 assert.equal(h.tables.purchases[0].invoice_number,null);assert.equal(h.tables.purchases[0].invoice_date,null);
 assert.equal(h.tables.audit_events[0].action,'purchase_document_reclassified');assert.equal(h.tables.audit_events[0].detail.previous_number,cdc);assert.equal(h.tables.audit_events[0].detail.stock_changed,false);
 assert.ok(h.writes.every(x=>['purchase_documents','purchases','audit_events'].includes(x.name)));assert.equal(h.tables.purchase_items[0].received_qty,625);
});

test('a real invoice with unreadable prices stays an invoice and retains financial errors',async()=>{
 const document={...remittance(),document_kind:'invoice',document_title:'Factura electrónica'},h=harness({document}),result=await(await h.run()).json();
 assert.equal(result.kind,'invoice');assert.equal(h.tables.purchase_documents[0].kind,'invoice');assert.equal(h.tables.purchases[0].invoice_number,cdc);
 assert.ok(result.document.validation.issues.some(x=>/total válido/.test(x)));assert.ok(result.document.validation.issues.some(x=>/moneda/.test(x)));
 assert.equal(h.tables.audit_events[0].action,'purchase_invoice_analyzed');
});

test('a weak classification or failed second reading cannot reclassify a financial document',async()=>{
 for(const options of [{document:{...remittance(),confidence:.7}},{reviewFails:true},{document:{...remittance(),document_title:'Documento sin título'}},{primaryDocument:{...remittance(),document_kind:'invoice',document_title:'Factura electrónica'}}]){
  const h=harness(options),response=await h.run(),result=await response.json();assert.equal(response.status,200);assert.equal(result.kind,'invoice');assert.equal(h.tables.purchase_documents[0].kind,'invoice');assert.equal(h.tables.purchases[0].invoice_number,cdc);
 }
});

test('a concurrent real invoice or another attachment using the old reference keeps its header',async()=>{
 for(const options of [{concurrentInvoice:true},{alreadyAttached:true}]){
  const h=harness(options),result=await(await h.run()).json();assert.equal(result.kind,'remittance');assert.equal(h.tables.purchases[0].invoice_number,options.concurrentInvoice?'001-001-0000099':cdc);
 }
});

test('viewers and unrelated depositors cannot analyze or reclassify a document',async()=>{
 for(const options of [{role:'admin_viewer'},{role:'depositor',warehouse:'00000000-0000-4000-8000-000000000099'}]){
  const h=harness(options),response=await h.run();assert.equal(response.status,403);assert.equal(h.calls(),0);assert.equal(h.writes.length,0);
 }
});
