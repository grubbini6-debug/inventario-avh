import * as pdfLib from 'npm:pdf-lib@1.17.1';
import {makeCommercialPdf} from '../_shared/commercial-pdf.mjs';
import {base64} from '../_shared/work-order-pdf.mjs';
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
  const body=await req.json(),id=body.document_id;
  if(typeof id!=='string'||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))return json({error:'Documento inválido'},400);
  const response=await fetch(`${url}/rest/v1/rpc/commercial_document`,{method:'POST',headers,body:JSON.stringify({p_id:id})});
  if(!response.ok)return json({error:'Documento inexistente o sin acceso'},403);
  const order=await response.json();if(!order?.payload)return json({error:'Documento inexistente'},404);
  const bytes=await makeCommercialPdf(order,pdfLib);return json({pdf_base64:base64(bytes),filename:(order.number||'BORRADOR_'+(order.kind==='quote'?'PRE':'OC')+'_'+id.slice(0,8))+'.pdf'});
 }catch{return json({error:'No se pudo generar el documento PDF'},500);}
});
