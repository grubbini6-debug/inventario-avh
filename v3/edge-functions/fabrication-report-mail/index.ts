import * as pdfLib from 'npm:pdf-lib@1.17.1';
import {makeFabricationPdf,base64} from '../_shared/fabrication-pdf.mjs';

async function sameSecret(a:string,b:string){const encode=new TextEncoder(),[x,y]=await Promise.all([a,b].map(v=>crypto.subtle.digest('SHA-256',encode.encode(v))));let diff=0;const xx=new Uint8Array(x),yy=new Uint8Array(y);for(let i=0;i<xx.length;i++)diff|=xx[i]^yy[i];return diff===0;}
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
Deno.serve(async(req:Request)=>{
  if(req.method!=='POST')return reply({error:'Método no permitido'},405);
  const secret=Deno.env.get('FABRICATION_CRON_SECRET'),provided=req.headers.get('x-fabrication-cron-secret');
  if(!secret||!provided||!await sameSecret(secret,provided))return reply({error:'No autorizado'},401);
  const url=Deno.env.get('SUPABASE_URL'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),apiKey=Deno.env.get('RESEND_API_KEY'),from=Deno.env.get('FABRICATION_REPORT_FROM');
  if(!url||!service||!apiKey||!from)return reply({error:'Servicio de correo sin configurar'},503);
  const rpc=async(name:string,body:unknown)=>{
    const r=await fetch(`${url}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:service,Authorization:`Bearer ${service}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
    if(!r.ok)throw Error('No se pudo actualizar la cola de correo');return r.json();
  };
  let sent=0,failed=0;
  try{
    // Bounded batches; pending messages stay in the database and are retried by the next run.
    for(let i=0;i<10;i++){
      const item=await rpc('fabrication_email_claim',{});if(!item)break;
      const r=item.report;
      try{
        const pdf=await makeFabricationPdf(r,pdfLib),response=await fetch('https://api.resend.com/emails',{
          method:'POST',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json','Idempotency-Key':`avh-fabrication-${r.id}`},
          body:JSON.stringify({from,to:item.recipients,subject:`AVH · Fabricación Naval · ${r.report_date}`,
            text:`Reporte diario de ${r.payload.warehouse.name}, correspondiente al ${r.report_date}. Se adjunta el PDF con los registros de depósito, fabricación, personal, calidad y pendientes.`,
            attachments:[{filename:`AVH_Fabricacion_${r.report_date}_r${r.revision}.pdf`,content:base64(pdf)}]})});
        if(!response.ok)throw Error(`El proveedor de correo rechazó el envío (${response.status})`);
        if(!await rpc('fabrication_email_finish',{p_report:r.id,p_token:item.claim_token,p_error:null}))throw Error('La reserva del reporte venció');
        sent++;
      }catch(error){
        await rpc('fabrication_email_finish',{p_report:r.id,p_token:item.claim_token,p_error:error instanceof Error?error.message:'Error de envío'});failed++;
      }
    }
    return reply({sent,failed});
  }catch{return reply({error:'No se pudo procesar la cola',sent,failed},500);}
});
