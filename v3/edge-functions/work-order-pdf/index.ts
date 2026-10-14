import * as pdfLib from 'npm:pdf-lib@1.17.1';
import {makeWorkOrderPdf,base64} from '../_shared/work-order-pdf.mjs';
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
 const headers={apikey:key,Authorization:auth};
 try{
  const user=await fetch(`${url}/auth/v1/user`,{headers});if(!user.ok)return json({error:'Sesión inválida'},401);
  const body=await req.json(),id=body.order_id;
  if(typeof id!=='string'||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))return json({error:'Orden inválida'},400);
  const response=await fetch(`${url}/rest/v1/work_orders?id=eq.${id}&select=id,number,status,payload,issued_payload,issued_at`,{headers});
  if(!response.ok)return json({error:'No se pudo consultar la orden'},403);
  const data=await response.json(),order=data[0];if(!order)return json({error:'Orden inexistente o sin acceso'},404);
  const bytes=await makeWorkOrderPdf(order,pdfLib);
  const name=order.number||'BORRADOR_OT_'+id.slice(0,8);return json({pdf_base64:base64(bytes),filename:name+'.pdf'});
 }catch{return json({error:'No se pudo generar el PDF de la orden'},500);}
});
