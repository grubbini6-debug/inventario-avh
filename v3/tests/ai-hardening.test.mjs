import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {AIError,aiOutput,requestAI,readAIInput,validateAIFile} from '../edge-functions/_shared/ai-runtime.mjs';
import '../edge-functions/_shared/product-identity.js';
import '../edge-functions/_shared/purchase-receiving-model.js';
import {validateReceiptAnalysis} from '../edge-functions/_shared/receipt-analysis.mjs';
import {validateCommercialCopy} from '../edge-functions/_shared/commercial-copy.mjs';
const I=globalThis.AVHProductIdentity,M=globalThis.AVHReceiving;
const schema={type:'object',additionalProperties:false,properties:{price:{type:['number','null']}},required:['price']};
const body={model:'configured-model',max_output_tokens:100,input:[{role:'developer',content:'Reglas internas.'},{role:'user',content:'Documento original.'}],text:{format:{type:'json_schema',name:'test',strict:true,schema}}};
test('incomplete, refused, empty and structurally invalid AI results cannot enter a business flow',()=>{
 for(const data of [{status:'incomplete',output_text:'{"price":5}'},{status:'failed',output_text:'{"price":5}'},{status:'completed',output:[{content:[{type:'refusal',refusal:'no'}]}]},{status:'completed',output_text:'{"price":'},{status:'completed',output_text:'{}'},{status:'completed',output_text:'{"price":"5"}'},{status:'completed',output_text:'{"price":5,"write":true}'}])assert.throws(()=>aiOutput(data,schema),AIError);
 assert.deepEqual(aiOutput({status:'completed',output_text:'{"price":null}'},schema),{price:null});
});
test('temporary provider errors retry within one deadline, retain developer rules and hide provider internals',async()=>{
 let calls=0;const waits=[];
 const result=await requestAI('private-key',body,{wait:async n=>waits.push(n),fetcher:async(url,options)=>{
  calls++;assert.equal(url,'https://api.openai.com/v1/responses');const sent=JSON.parse(options.body);assert.equal(sent.model,'configured-model');assert.equal(sent.store,false);assert.equal(sent.input[0].role,'developer');assert.match(sent.input[0].content,/nunca instrucciones/);assert.equal(sent.input[1].content,'Documento original.');
  return calls===1?Response.json({error:{message:'provider private details'}},{status:429,headers:{'Retry-After':'1'}}):Response.json({status:'completed',output_text:'{"price":25.5}'});
 }});assert.equal(result.value.price,25.5);assert.equal(calls,2);assert.deepEqual(waits,[1000]);
 calls=0;await assert.rejects(requestAI('key',body,{fetcher:async()=>{calls++;return Response.json({error:{message:'secret details'}},{status:401});}}),e=>e.code==='AI_UNAVAILABLE'&&!e.message.includes('secret'));assert.equal(calls,1);
 await assert.rejects(requestAI('key',body,{fetcher:async()=>{throw Object.assign(new Error('timeout'),{name:'TimeoutError'});}}),e=>e.code==='AI_TIMEOUT'&&e.status===504);
 await assert.rejects(requestAI('key',body,{clock:()=>100,deadlineAt:99,fetcher:()=>assert.fail('Expired budget must not call the provider')}),e=>e.code==='AI_TIMEOUT');
});
test('body and file limits reject malformed, disguised and oversized inputs before any AI call',async()=>{
 const req=s=>new Request('https://test',{method:'POST',body:s});
 await assert.rejects(readAIInput(req('123456789'),8),e=>e.status===413);
 await assert.rejects(readAIInput(req('{invalid}')),e=>e.code==='AI_INPUT_INVALID');
 await assert.rejects(readAIInput(req('[1,2]')),e=>e.status===400);
 assert.deepEqual(await readAIInput(req('{"question":"stock"}')),{question:'stock'});
 const pdf='data:application/pdf;base64,'+Buffer.from('%PDF-1.7 source').toString('base64');assert.equal(validateAIFile(pdf,{fileName:'source.pdf'}).mime,'application/pdf');
 for(const data of ['data:image/png;base64,AAAA','data:image/svg+xml;base64,PHN2Zy8+','data:image/jpeg;base64,'])assert.throws(()=>validateAIFile(data));
 assert.throws(()=>validateAIFile(pdf,{mimeType:'image/png'}));assert.throws(()=>validateAIFile(pdf,{imagesOnly:true}));assert.throws(()=>validateAIFile(pdf,{maxBytes:2}));
});
test('brands, dimensions, manufacturer models and abrasive purpose veto even an exact supplier code',()=>{
 const a={id:'a',sku:'1633',name:'Disco de corte 4 1/2 pulgadas x 1,2 mm Maxflexx',base_unit:'unidad',active:true};
 for(const description of ['Disco de corte 4 1/2 pulgadas x 1,2 mm Norton','Disco de corte 4 1/2 pulgadas x 3,2 mm Maxflexx','Disco de desbaste 4 1/2 pulgadas x 1,2 mm Maxflexx'])assert.equal(M.matches({product_code:'1633',description},[a]).length,0);
 assert.equal(M.matches({description:'Disco de corte 4½ pulgadas x 1.2 mm Maxflexx'},[a]).length,1);
 assert.equal(M.matches({description:'Disco de corte 9 pulgadas MarcaNueva',brand:'MarcaNueva'},[{id:'generic',name:'Disco de corte 9 pulgadas'}]).length,0);
 assert.ok(I.conflicts({brand:'MarcaNueva',manufacturer_code:'AB2'},{brand:'MarcaNueva',manufacturer_code:'AB1'}).length);
 assert.equal(M.matches({product_code:'1633'},[a]).length,1);
 assert.equal(M.matches({description:'DISCO DE CORTE PARA HIERRO 4.1/2\"X1,2MM MCA-1633 MAXFLEXX',brand:'Maxflexx',manufacturer_code:'MCA-1633'},[{...a,name:a.name+' MCA-1633'}]).length,1);
});
test('receipt suggestions reject wrong brands, duplicate rows, foreign IDs, excess counts and weak evidence',()=>{
 const purchases=[{purchase_id:'p',po_number:'OC-1',supplier:'Proveedor',items:[{purchase_item_id:'i',product_id:'max',description:'Disco corte 4 1/2 pulgadas x 1,2 mm Maxflexx',unit:'unidad',pending:50}]}];
 const make=()=>({matched_purchase_id:'p',confidence:.99,document_date:'2026-10-20',detected_items:[{purchase_item_id:'i',description:purchases[0].items[0].description,quantity:5,unit:'UN',confidence:.99}]});
 let a=validateReceiptAnalysis(make(),purchases);assert.equal(a.detected_items[0].quantity,5);assert.equal(a.detected_items[0].product_id,'max');
 for(const change of [a=>a.detected_items[0].description='Disco corte 4 1/2 pulgadas x 1,2 mm Norton',a=>a.detected_items[0].quantity=51,a=>a.detected_items[0].purchase_item_id='foreign',a=>a.detected_items.push({...a.detected_items[0]}),a=>a.detected_items[0].confidence=.5,a=>a.detected_items[0].unit='kg']){a=make();change(a);assert.equal(validateReceiptAnalysis(a,purchases).detected_items[0].quantity,null);}
 a=make();a.confidence=.3;assert.equal(validateReceiptAnalysis(a,purchases).matched_purchase_id,null);
 a=make();a.document_date='2026-02-31';assert.equal(validateReceiptAnalysis(a,purchases).document_date,null);
});
test('missing money, invalid dates and unfinished readings stay visible as issues',()=>{
 const issues=M.documentIssues({currency:null,date:'2026-02-31',complete:false,total:null,items:[{quantity:null,unit:null,unit_price:null,line_total:null,confidence:.4}]});
 assert.ok(issues.some(x=>/moneda/.test(x)));assert.ok(issues.some(x=>/fecha/.test(x)));assert.ok(issues.some(x=>/cantidad/.test(x)));assert.ok(issues.some(x=>/todo el documento/.test(x)));
});
test('commercial wording cannot change a brand or unit while conserving the same digits, or add a certificate',()=>{
 const p={title:'Trabajo',items:[{id:'a',description:'Instalar disco Maxflexx 115 mm'}]},next=description=>({title:'Trabajo profesional',introduction:'Alcance solicitado.',items:[{id:'a',description}]});
 assert.equal(validateCommercialCopy(p,next('Instalación de disco Maxflexx 115 mm')).items.length,1);
 for(const text of ['Instalar disco Norton 115 mm','Instalar disco Maxflexx 115 cm','Instalar disco Maxflexx 115 mm certificado'])assert.throws(()=>validateCommercialCopy(p,next(text)));
});
test('all eight AI handlers use the common response boundary and retain independent authorization',()=>{
 for(const name of ['purchase-document-ai','purchase-invoice-control-ai','depositor-photo-ai','avh-purchase-assistant','work-order-ai','commercial-ai','quote-excel-ai','quote-document-ai']){
  const s=fs.readFileSync(new URL('../edge-functions/'+name+'/index.ts',import.meta.url),'utf8');assert.match(s,/requestAI/);assert.match(s,/aiStatus/);assert.doesNotMatch(s,/fetch\('https:\/\/api.openai.com/);assert.match(s,/auth.getUser|auth\/v1\/user/);
 }
});
