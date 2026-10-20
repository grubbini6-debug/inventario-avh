import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import * as runtime from '../edge-functions/_shared/ai-runtime.mjs';
import * as receipt from '../edge-functions/_shared/receipt-analysis.mjs';
import '../edge-functions/_shared/product-identity.js';
import '../edge-functions/_shared/purchase-receiving-model.js';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
function endpoint(name,client,fetch){
 let handler;const ctx={...runtime,...receipt,createClient:()=>client,fetch,Request,Response,AbortSignal,TextDecoder,Uint8Array,atob,btoa,console,Deno:{env:{get:k=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'private-test',OPENAI_API_KEY:'private-ai'}[k])},serve:f=>handler=f}};
 for(const name of ['product-identity.js','purchase-receiving-model.js'])vm.runInNewContext(read('../edge-functions/_shared/'+name),ctx);
 vm.runInNewContext(stripTypeScriptTypes(read('../edge-functions/'+name+'/index.ts').replace(/^import .*;\n/gm,''),{mode:'strip'}),ctx);return handler;
}
function clientFor(tables,profile={role:'admin',active:true},errors={}){
 return{auth:{getUser:async()=>({data:{user:{id:'caller'}}})},from:name=>{const result=()=>({data:name==='profiles'?profile:tables[name]||[],count:name==='products'?300:(tables[name]||[]).length,error:errors[name]||null});const q={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>result(),then:(resolve,reject)=>Promise.resolve(result()).then(resolve,reject),insert:()=>assert.fail('AI must not create business records')};return q;}};
}
const request=body=>new Request('https://test/functions',{method:'POST',headers:{Authorization:'Bearer caller','Content-Type':'application/json'},body:JSON.stringify(body)});
const source={complete:true,warnings:[],document_type:'quote',document_number:'15777',purchase_order_number:null,date:'2026-09-11',valid_until:null,delivery_date:null,supplier_name:'Electromaq',supplier_tax_id:null,customer_name:'MAQMOVEIS',customer_tax_id:null,currency:'PYG',payment_terms:'Crédito',payment_method:null,delivery_terms:null,subtotal:127500,tax:null,total:127500,tax_mode:'unknown',notes:null,confidence:.99,items:[{brand:'Maxflexx',manufacturer_code:'MCA-1633',product_code:'1633',barcode:null,description:'Disco de corte 4 1/2 pulgadas x 1,2 mm Maxflexx',presentation:null,quantity:50,unit:'UN',base_unit:null,factor_to_base:null,unit_price:2550,line_total:127500,confidence:.99}]};
const file={file_name:'source.pdf',mime_type:'application/pdf',file_data:'data:application/pdf;base64,'+Buffer.from('%PDF-1.7 source').toString('base64')};
test('purchase extraction preserves uncertain rows and original figures, clears impossible dates and never writes',async()=>{
 let calls=0,doc=structuredClone(source);const run=endpoint('purchase-document-ai',clientFor({}),async(url,options)=>{calls++;const b=JSON.parse(options.body);assert.equal(b.input[0].role,'developer');assert.match(b.input[0].content,/marca|brand/);return Response.json({status:'completed',output_text:JSON.stringify(doc)});});
 let result=await (await run(request(file))).json();assert.equal(result.document.items[0].unit_price,2550);assert.equal(result.document.items[0].brand,'Maxflexx');assert.equal(calls,1);
 doc=structuredClone(source);doc.currency=null;doc.date='2026-02-31';doc.items[0].confidence=.5;
 result=await (await run(request(file))).json();assert.equal(result.document.items.length,1);assert.equal(result.document.items[0].quantity,null);assert.equal(result.document.items[0].unit_price,null);assert.equal(result.document.items[0].source_values.unit_price,2550);assert.equal(result.document.date,null);assert.equal(result.document.source_dates.date,'2026-02-31');assert.equal(result.document.currency,null);assert.ok(result.document.validation.issues.length);assert.equal(calls,3);
 doc=structuredClone(source);doc.complete=false;assert.equal((await run(request(file))).status,400);
 const denied=endpoint('purchase-document-ai',clientFor({},{role:'depositor',active:true}),()=>assert.fail('Unauthorized caller must not spend AI tokens'));assert.equal((await denied(request(file))).status,403);
});
test('the purchase assistant exposes snapshot coverage and refuses to answer from failed queries',async()=>{
 let calls=0;const tables={products:[{id:'p',name:'Disco',base_unit:'unidad'}]};
 const provider=async(url,options)=>{calls++;const b=JSON.parse(options.body),context=b.input.at(-1).content[0].text;assert.match(context,/"partial":true/);assert.match(b.input[0].content,/No sumes monedas ni unidades distintas/);return Response.json({status:'completed',output_text:'Muestra disponible: disco por unidad.'});};
 const run=endpoint('avh-purchase-assistant',clientFor(tables),provider),r=await (await run(request({question:'Stock'}))).json();assert.equal(r.coverage.products.partial,true);assert.match(r.answer,/Muestra disponible/);
 const failed=endpoint('avh-purchase-assistant',clientFor(tables,undefined,{purchase_items:{message:'database detail'}}),provider);assert.equal((await failed(request({question:'Stock'}))).status,400);assert.equal(calls,1);
});
test('photo receiving stays inside the depositor warehouse, removes wrong-brand suggestions and never sends purchase prices',async()=>{
 const tables={v_purchase_overview:[{id:'p',po_number:'OC-1',supplier_name:'Proveedor',status:'ordered'}],purchase_items:[{id:'i',purchase_id:'p',product_id:'max',description:source.items[0].description,quantity:50,received_qty:0,unit:'unidad',unit_price:2550}],products:[{id:'max',brand:'Maxflexx'}]};
 const analysis={mode:'receipt',confidence:.99,summary:'Entrega',document_kind:'invoice',document_number:'123',document_date:'2026-10-20',matched_purchase_id:'p',matched_po_number:'fake',matched_supplier_name:'fake',detected_items:[{brand:'Norton',manufacturer_code:null,product_id:'max',purchase_item_id:'i',description:'Disco de corte 4 1/2 pulgadas x 1,2 mm Norton',quantity:50,unit:'UN',confidence:.99}]};
 const run=endpoint('depositor-photo-ai',clientFor(tables,{role:'depositor',active:true,warehouse_id:'ac'}),async(url,options)=>{const b=JSON.parse(options.body);assert.doesNotMatch(JSON.stringify(b.input),/unit_price|2550/);return Response.json({status:'completed',output_text:JSON.stringify(analysis)});});
 const r=await (await run(request({mode:'receipt',warehouse_id:'foreign',file_data:'data:image/jpeg;base64,'+Buffer.from([255,216,255,217]).toString('base64')}))).json();assert.equal(r.analysis.detected_items[0].product_id,null);assert.equal(r.analysis.detected_items[0].quantity,null);assert.equal(r.analysis.matched_po_number,'OC-1');assert.ok(r.analysis.warnings.length);
});
