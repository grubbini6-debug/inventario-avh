import * as pdfLib from 'npm:pdf-lib@1.17.1';
import {makeFabricationPdf,base64} from '../_shared/fabrication-pdf.mjs';

const origin=Deno.env.get('AVH_ALLOWED_ORIGIN')||'https://grubbini6-debug.github.io';
const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return json({error:'Método no permitido'},405);
  if(req.headers.get('Origin')&&req.headers.get('Origin')!==origin)return json({error:'Origen no autorizado'},403);
  const auth=req.headers.get('Authorization'),url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_PUBLISHABLE_KEY')||Deno.env.get('SUPABASE_ANON_KEY');
  if(!auth?.startsWith('Bearer '))return json({error:'No autenticado'},401);
  if(!url||!key)return json({error:'Servicio de PDF sin configurar'},503);
  const headers={apikey:key,Authorization:auth};
  try{
    const user=await fetch(`${url}/auth/v1/user`,{headers});if(!user.ok)return json({error:'Sesión inválida'},401);
    const body=await req.json(),id=body.report_id;
    if(typeof id!=='string'||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))return json({error:'Reporte inválido'},400);
    // Read with the USER JWT, never service_role. RLS enforces active profile + workshop membership.
    const response=await fetch(`${url}/rest/v1/fabrication_reports?id=eq.${id}&select=id,report_date,revision,source,payload`,{headers});
    if(!response.ok)return json({error:'No se pudo consultar el reporte'},response.status===401?401:403);
    const reports=await response.json();if(!reports[0])return json({error:'Reporte inexistente o no autorizado'},404);
    const pdf=await makeFabricationPdf(reports[0],pdfLib);
    return json({pdf_base64:base64(pdf),filename:`AVH_Fabricacion_${reports[0].report_date}_r${reports[0].revision}.pdf`});
  }catch{ return json({error:'No se pudo generar el PDF'},500); }
});
