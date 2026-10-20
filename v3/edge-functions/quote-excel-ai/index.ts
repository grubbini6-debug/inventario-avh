import {requestAI,readAIInput,aiFailure,aiStatus} from '../_shared/ai-runtime.mjs';
import '../_shared/quote-excel-model.js';
import {commercialCopySchema,commercialCopyRules,validateCommercialCopy} from '../_shared/commercial-copy.mjs';
const Q=(globalThis as any).AVHQuoteExcelModel;
const origin=Deno.env.get('AVH_ALLOWED_ORIGIN')||'https://grubbini6-debug.github.io';
const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
async function structured(key:string,schema:unknown,name:string,rules:string,input:unknown,deadline:number){
 const {value}=await requestAI(key,{model:Deno.env.get('OPENAI_WORK_ORDER_MODEL')||'gpt-5.4-mini',max_output_tokens:18000,input:[{role:'developer',content:rules},{role:'user',content:JSON.stringify(input)}],text:{format:{type:'json_schema',name,strict:true,schema}}},{fetcher:fetch,deadlineAt:deadline});return value;
}
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return json({error:'Método no permitido'},405);
 if(req.headers.get('Origin')&&req.headers.get('Origin')!==origin)return json({error:'Origen no autorizado'},403);
 const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_PUBLISHABLE_KEY')||Deno.env.get('SUPABASE_ANON_KEY'),auth=req.headers.get('Authorization');
 if(!auth?.startsWith('Bearer '))return json({error:'No autenticado'},401);if(!url||!key)return json({error:'Servicio sin configurar'},503);
 const headers={apikey:key,Authorization:auth,'Content-Type':'application/json'};
 try{
  const aiDeadline=Date.now()+115000;
  const user=await fetch(url+'/auth/v1/user',{headers});if(!user.ok)return json({error:'Sesión inválida'},401);
  const access=await fetch(url+'/rest/v1/rpc/commercial_context',{method:'POST',headers,body:'{}'}),context=await access.json();
  if(!access.ok||!['admin','editor'].includes(context?.access_level))return json({error:'No autorizado para preparar presupuestos'},403);
  const body=await readAIInput(req),apiKey=Deno.env.get('OPENAI_API_KEY');let analysis=Q.parse(body.rows,String(body.sheet||'').slice(0,180));
  if(analysis.needs_mapping){
   if(!apiKey)return json({error:'No pude reconocer las columnas. Usá encabezados Descripción, Cantidad, Unidad, Precio unitario e Importe.'},400);
   const map=await structured(apiKey,Q.mappingSchema,'avh_quote_excel_columns',Q.mappingRules,{file_name:String(body.file_name||'Excel').slice(0,180),sheet:body.sheet,rows:body.rows},aiDeadline);analysis=Q.parse(body.rows,body.sheet,map);
  }
  if(!analysis.items.length)return json({error:'No encontré trabajos con precios. Elegí la hoja que contiene el presupuesto.'},400);
  if(apiKey){
   try{
    const payload={title:analysis.fields.title,items:analysis.items.map((i:any,n:number)=>({id:String(n),description:i.description}))};
    const suggestion=validateCommercialCopy(payload,await structured(apiKey,commercialCopySchema,'avh_quote_excel_wording',commercialCopyRules,{kind:'quote',...payload},aiDeadline));
    analysis.fields.title=suggestion.title;analysis.fields.introduction=suggestion.introduction;analysis.items=analysis.items.map((i:any,n:number)=>({...i,description:suggestion.items[n].description}));
   }catch{analysis.warnings.push('Se conservaron los trabajos y precios del Excel. Podés mejorar la redacción con IA después de guardar.');}
  }
  return json({ok:true,analysis});
 }catch(e){return json(aiFailure(e),aiStatus(e));}
});
