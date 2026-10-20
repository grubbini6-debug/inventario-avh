import {requestAI,readAIInput,aiFailure,aiStatus} from '../_shared/ai-runtime.mjs';
import {extractionSchema,planSchema,sourceRules,planningRules,enrichWorkOrder} from '../_shared/work-order-analysis.mjs';
const origin=Deno.env.get('AVH_ALLOWED_ORIGIN')||'https://grubbini6-debug.github.io';
const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
async function structured(key:string,model:string,schema:unknown,name:string,input:string,deadline:number){
 const {value}=await requestAI(key,{model,max_output_tokens:18000,input:[{role:'developer',content:sourceRules},{role:'user',content:input}],text:{format:{type:'json_schema',name,strict:true,schema}}},{fetcher:fetch,deadlineAt:deadline});return value;
}
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:{...cors,'X-AVH-AI-Configured':Deno.env.get('OPENAI_API_KEY')?'true':'false'}});
 if(req.method!=='POST')return json({error:'Método no permitido'},405);
 if(req.headers.get('Origin')&&req.headers.get('Origin')!==origin)return json({error:'Origen no autorizado'},403);
 const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_PUBLISHABLE_KEY')||Deno.env.get('SUPABASE_ANON_KEY'),auth=req.headers.get('Authorization');
 if(!url||!key)return json({error:'Servicio sin configurar'},503);
 if(!auth?.startsWith('Bearer '))return json({error:'No autenticado'},401);
 const headers={apikey:key,Authorization:auth,'Content-Type':'application/json'};
 try{
  const aiDeadline=Date.now()+115000;
  const user=await fetch(`${url}/auth/v1/user`,{headers});if(!user.ok)return json({error:'Sesión inválida'},401);
  const access=await fetch(`${url}/rest/v1/rpc/work_order_context`,{method:'POST',headers,body:'{}'}),ctx=await access.json();
  if(!access.ok||!['admin','editor'].includes(ctx?.access_level))return json({error:'No autorizado para analizar órdenes de trabajo'},403);
  const apiKey=Deno.env.get('OPENAI_API_KEY');if(!apiKey)return json({error:'La IA del sistema no está configurada. Avisá al administrador.'},503);
  const body=await readAIInput(req),rows=body.rows;
  if(!Array.isArray(rows)||!rows.length||rows.length>1200||rows.some((r:any)=>!Array.isArray(r)||r.length>60||r.some((v:any)=>v!==null&&!['string','number','boolean'].includes(typeof v))))throw Error('La hoja admite hasta 1.200 filas y 60 columnas.');
  let tasks=Array.isArray(body.tasks)?body.tasks:[];
  const model=Deno.env.get('OPENAI_WORK_ORDER_MODEL')||'gpt-5.4-mini';
  const source=JSON.stringify({file_name:String(body.file_name||'Excel').slice(0,180),sheet:String(body.sheet||'').slice(0,180),rows:rows.map((values:any,index:number)=>({source_row:index+1,values}))});
  if(!tasks.length){
   const extracted=await structured(apiKey,model,extractionSchema,'avh_work_order_extraction',`Extraé los trabajos de la hoja. source_row es la fila real de Excel.\n${source}`,aiDeadline);tasks=extracted.tasks;
  }
  if(!tasks.length||tasks.length>300||tasks.some((t:any)=>!Number.isInteger(t.source_row)||t.source_row<1||t.source_row>rows.length)||new Set(tasks.map((t:any)=>t.source_row)).size!==tasks.length)throw Error('La IA no pudo identificar correctamente las filas de trabajo.');
  const plan=await structured(apiKey,model,planSchema,'avh_work_order_planning',`${planningRules}\nHOJA ORIGINAL:\n${source}\nTRABAJOS A PLANIFICAR (valores fuente que debés conservar):\n${JSON.stringify(tasks)}`,aiDeadline);
  const sourceText=JSON.stringify(rows).toLowerCase();for(const key of ['client','vessel'])if(plan[key]&&!sourceText.includes(String(plan[key]).toLowerCase())){plan.warnings.push('El dato '+key+' no se identificó de forma literal en la hoja; completalo manualmente.');plan[key]='';}
  return json({ok:true,analysis:enrichWorkOrder(tasks,plan),model});
 }catch(e){return json(aiFailure(e),aiStatus(e));}
});
