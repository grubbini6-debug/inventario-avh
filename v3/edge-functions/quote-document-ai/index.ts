import {requestAI,readAIInput,aiFailure,aiStatus} from '../_shared/ai-runtime.mjs';
import {PDFDocument} from 'npm:pdf-lib@1.17.1';
import '../_shared/quote-excel-model.js';
import '../_shared/quote-document-model.js';
import '../_shared/repair-budget-reading.js';
const Q=(globalThis as any).AVHQuoteDocumentModel;
const R=(globalThis as any).AVHRepairBudgetReading;
const maxBytes=12*1024*1024,maxBody=17*1024*1024,origin=Deno.env.get('AVH_ALLOWED_ORIGIN')||'https://grubbini6-debug.github.io';
const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
async function boundedBody(req:Request){
 if(Number(req.headers.get('Content-Length'))>maxBody)throw Error('Los archivos superan 12 MB en total.');const reader=req.body?.getReader();if(!reader)throw Error('Faltan los archivos.');const parts:Uint8Array[]=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>maxBody){await reader.cancel();throw Error('Los archivos superan 12 MB en total.');}parts.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return JSON.parse(new TextDecoder().decode(bytes));
}
async function attachments(body:any){
 if(!Array.isArray(body.files)||body.files.length<1||body.files.length>6)throw Error('Seleccioná de 1 a 6 PDF o fotos de un mismo presupuesto.');let total=0,pages=0;const files:any[]=[],content:any[]=[];
 for(const [index,file] of body.files.entries()){
  if(typeof file.file_name!=='string'||file.file_name.length>180||typeof file.file_data!=='string'||file.file_data.length>maxBody)throw Error('Archivo inválido.');
  const match=file.file_data.match(/^data:(application\/pdf|image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);if(!match)throw Error('Usá PDF o fotos JPG, PNG o WebP.');
  const [all,mime,data]=match;void all;const raw=atob(data),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));total+=bytes.length;if(total>maxBytes)throw Error('Los archivos superan 12 MB en total.');
  let count=1;
  if(mime==='application/pdf'){
   if(!new TextDecoder().decode(bytes.slice(0,1024)).includes('%PDF-'))throw Error('El archivo no contiene un PDF válido.');
   try{const pdf=await PDFDocument.load(bytes,{updateMetadata:false});count=pdf.getPageCount();}catch{throw Error('No se pudo abrir un PDF. Revisá que no esté dañado ni protegido con contraseña.');}
  }else if(mime==='image/png'&&![137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)||mime==='image/jpeg'&&!(bytes[0]===255&&bytes[1]===216)||mime==='image/webp'&&!(new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP'))throw Error('Una foto no coincide con su formato. Volvé a guardarla en JPG, PNG o WebP.');
  pages+=count;if(count<1||count>20||pages>20)throw Error('La carga admite hasta 20 páginas en total. Dividí el presupuesto.');
  files.push({file_name:file.file_name,mime_type:mime,pages:count});content.push({type:'input_text',text:`Archivo ${index+1}: ${file.file_name} (${count} página/s).`},mime==='application/pdf'?{type:'input_file',filename:file.file_name,file_data:file.file_data,detail:'high'}:{type:'input_image',image_url:file.file_data,detail:'high'});
 }
 return{files,content};
}
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return json({error:'Método no permitido'},405);if(req.headers.get('Origin')&&req.headers.get('Origin')!==origin)return json({error:'Origen no autorizado'},403);
 const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_PUBLISHABLE_KEY')||Deno.env.get('SUPABASE_ANON_KEY'),auth=req.headers.get('Authorization');if(!auth?.startsWith('Bearer '))return json({error:'No autenticado'},401);if(!url||!key)return json({error:'Servicio sin configurar'},503);
 try{
  const headers={apikey:key,Authorization:auth,'Content-Type':'application/json'},user=await fetch(url+'/auth/v1/user',{headers});if(!user.ok)return json({error:'Sesión inválida'},401);
  const access=await fetch(url+'/rest/v1/rpc/commercial_context',{method:'POST',headers,body:'{}'}),context=await access.json();if(!access.ok||!['admin','editor'].includes(context?.access_level))return json({error:'No autorizado para preparar presupuestos'},403);
  const body=await boundedBody(req),repair=body.purpose==='equipment_repair';if(repair&&context.access_level!=='admin')return json({error:'Solo Compras / Administración puede preparar reparaciones.'},403);
  const {files,content}=await attachments(body),apiKey=Deno.env.get('OPENAI_API_KEY');if(!apiKey)return json({error:'La lectura de PDF y fotos todavía no está configurada.'},503);
  const schema=repair?{...Q.schema,properties:{...Q.schema.properties,repair:R.schema},required:[...Q.schema.required,'repair']}:Q.schema;
  const {value}=await requestAI(apiKey,{model:Deno.env.get('OPENAI_WORK_ORDER_MODEL')||'gpt-5.4-mini',max_output_tokens:22000,input:[{role:'developer',content:Q.rules+(repair?'\n'+R.rules:'')},{role:'user',content:[{type:'input_text',text:repair?'Leé el presupuesto recibido del taller y prepará todas las partidas y los datos de la reparación para revisión.':'Prepará un presupuesto editable con los trabajos, precios y empresa emisora de estos archivos.'},...content]}],text:{format:{type:'json_schema',name:repair?'avh_repair_document':'avh_quote_document',strict:true,schema}}},{fetcher:fetch});
  const analysis=Q.normalize(value,files);if(repair)analysis.repair=R.normalize(value.repair,analysis.items.length);return json({ok:true,analysis,files});
 }catch(e){return json(aiFailure(e),aiStatus(e));}
});
