import {commercialCopySchema,commercialCopyRules,validateCommercialCopy} from '../_shared/commercial-copy.mjs';
const origin=Deno.env.get('AVH_ALLOWED_ORIGIN')||'https://grubbini6-debug.github.io';
const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return json({error:'Método no permitido'},405);
 if(req.headers.get('Origin')&&req.headers.get('Origin')!==origin)return json({error:'Origen no autorizado'},403);
 const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_PUBLISHABLE_KEY')||Deno.env.get('SUPABASE_ANON_KEY'),auth=req.headers.get('Authorization');
 if(!auth?.startsWith('Bearer '))return json({error:'No autenticado'},401);
 if(!url||!key)return json({error:'Servicio sin configurar'},503);
 const headers={apikey:key,Authorization:auth,'Content-Type':'application/json'};
 try{
  const user=await fetch(`${url}/auth/v1/user`,{headers});if(!user.ok)return json({error:'Sesión inválida'},401);
  const body=await req.json(),id=body.document_id;if(typeof id!=='string'||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))return json({error:'Documento inválido'},400);
  const r=await fetch(`${url}/rest/v1/rpc/commercial_document`,{method:'POST',headers,body:JSON.stringify({p_id:id})});if(!r.ok)return json({error:'Documento inexistente o sin acceso'},403);
  const doc=await r.json();if(doc.status!=='draft')return json({error:'La IA solo modifica borradores'},400);
  const apiKey=Deno.env.get('OPENAI_API_KEY');if(!apiKey)return json({error:'La IA no está configurada. Avisá a Administración.'},503);
  const input=JSON.stringify({kind:doc.kind,title:doc.payload.title,introduction:doc.payload.introduction,items:doc.payload.items.map((i:any)=>({id:i.id,description:i.description}))});if(input.length>350000)return json({error:'Dividí el documento en documentos más pequeños para mejorar la redacción con IA.'},413);
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(110000),body:JSON.stringify({model:Deno.env.get('OPENAI_WORK_ORDER_MODEL')||'gpt-5.4-mini',store:false,max_output_tokens:18000,input:[{role:'developer',content:commercialCopyRules},{role:'user',content:input}],text:{format:{type:'json_schema',name:'avh_commercial_copy',strict:true,schema:commercialCopySchema}}})});
  const data=await response.json();if(!response.ok||data.status==='incomplete')return json({error:'La IA no pudo completar la redacción. Reintentá; el documento original se conserva.'},502);
  const output=data.output_text||data.output?.flatMap((x:any)=>x.content||[]).find((x:any)=>x.type==='output_text')?.text;if(!output)throw Error('La IA no devolvió una propuesta.');
  return json({suggestion:validateCommercialCopy(doc.payload,JSON.parse(output))});
 }catch(e){return json({error:e instanceof Error?e.message:'No se pudo preparar la propuesta de IA.'},400);}
});
