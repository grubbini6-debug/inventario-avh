import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import * as pdfLib from 'npm:pdf-lib@1.17.1';
import {makeCommercialPdf} from '../_shared/commercial-pdf.mjs';
import {purchaseOrderDocument} from '../_shared/purchase-order-document.mjs';
import {base64} from '../_shared/work-order-pdf.mjs';
const origin=Deno.env.get('AVH_ALLOWED_ORIGIN')||'https://grubbini6-debug.github.io';
const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,x-client-info,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Vary':'Origin'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
const UUID=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const PDF_SOURCE='generated_professional_header_v8_institutional';
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return json({error:'Método no permitido'},405);
 if(req.headers.get('Origin')&&req.headers.get('Origin')!==origin)return json({error:'Origen no autorizado'},403);
 const url=Deno.env.get('SUPABASE_URL'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),auth=req.headers.get('Authorization');
 if(!auth?.startsWith('Bearer '))return json({error:'No autenticado'},401);
 if(!url||!service)return json({error:'Servicio sin configurar'},503);
 const admin=createClient(url,service,{auth:{persistSession:false}});
 const {data:userData,error:userErr}=await admin.auth.getUser(auth.slice(7));
 if(userErr||!userData.user)return json({error:'No autenticado'},401);
 const {data:caller}=await admin.from('profiles').select('role,active').eq('id',userData.user.id).maybeSingle();
 if(!caller||caller.role!=='admin'||!caller.active)return json({error:'Solo Administración puede generar la OC.'},403);
 try{
  const body=await req.json(),id=body.purchase_id;if(typeof id!=='string'||!UUID.test(id))return json({error:'Compra inválida'},400);
  const {data:p,error:pErr}=await admin.from('purchases').select('*').eq('id',id).maybeSingle();
  if(pErr||!p)return json({error:'Compra inexistente'},404);if(!p.po_number)return json({error:'La compra todavía no tiene número de OC'},400);
  const source=PDF_SOURCE+(p.status==='cancelled'?'_cancelled':'');
  const {data:stored}=await admin.from('purchase_documents').select('file_path,file_name').eq('purchase_id',id).eq('kind','order').eq('source',source).order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(stored?.file_path){const d=await admin.storage.from('purchase-documents').download(stored.file_path);if(!d.error&&d.data)return json({ok:true,reused:true,filename:stored.file_name,pdf_base64:base64(new Uint8Array(await d.data.arrayBuffer())),file_path:stored.file_path});}
  const [companyR,supplierR,itemsR,bargeR,warehouseR,snapshotR]=await Promise.all([
   admin.from('purchase_companies').select('*').eq('id',p.company_id).maybeSingle(),
   p.supplier_id?admin.from('suppliers').select('*').eq('id',p.supplier_id).maybeSingle():Promise.resolve({data:null,error:null}),
   admin.from('purchase_items').select('*').eq('purchase_id',id).order('created_at'),
   p.barge_id?admin.from('barges').select('number,name').eq('id',p.barge_id).maybeSingle():Promise.resolve({data:null,error:null}),
   p.warehouse_id?admin.from('warehouses').select('name').eq('id',p.warehouse_id).maybeSingle():Promise.resolve({data:null,error:null}),
   admin.from('commercial_documents').select('id,kind,number,status,issued_payload').eq('purchase_id',id).maybeSingle()
  ]);
  if([companyR,supplierR,itemsR,bargeR,warehouseR,snapshotR].some(r=>r.error))throw Error('No se pudo consultar el detalle completo de la OC.');
  const destination=p.destination_type==='warehouse'?(warehouseR.data?.name||'Depósito'):p.destination_type==='barge'?'Barcaza '+(bargeR.data?.number||''):(p.destination_text||'Entrega directa');
  const project=p.barge_id?'Barcaza '+(bargeR.data?.number||''):'';
  const document=snapshotR.data?.issued_payload?{...snapshotR.data,purchase_status:p.status}:purchaseOrderDocument(p,companyR.data||{},supplierR.data||{},itemsR.data||[],destination,project);
  const bytes=await makeCommercialPdf(document,pdfLib),filename=p.po_number+'.pdf',path=id+'/'+p.po_number+'-professional-v8-institutional'+(p.status==='cancelled'?'-cancelled':'')+'.pdf';
  const up=await admin.storage.from('purchase-documents').upload(path,bytes,{contentType:'application/pdf',upsert:true});if(up.error)throw Error('No se pudo archivar la OC.');
  const inserted=await admin.from('purchase_documents').insert({purchase_id:id,kind:'order',file_path:path,file_name:filename,document_number:p.po_number,document_date:String(p.po_generated_at||p.created_at).slice(0,10),source,uploaded_by:userData.user.id});if(inserted.error)throw Error('No se pudo registrar el PDF archivado.');
  await admin.from('audit_events').insert({entity_type:'purchase',entity_id:id,purchase_id:id,action:'purchase_order_pdf_generated',actor_id:userData.user.id,detail:{po_number:p.po_number,file_name:filename,source}});
  return json({ok:true,reused:false,filename,pdf_base64:base64(bytes),file_path:path});
 }catch(e){return json({error:e instanceof Error?e.message:'No se pudo generar la OC.'},400);}
});
