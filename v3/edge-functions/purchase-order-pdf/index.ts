import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'npm:pdf-lib@1.17.1';

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const green=rgb(0.08,0.30,0.20),dark=rgb(0.09,0.14,0.11),muted=rgb(0.36,0.44,0.39),line=rgb(0.84,0.88,0.85),pale=rgb(0.95,0.98,0.96);
const safe=(v:unknown)=>String(v??'').replace(/[\u0000-\u001f]/g,' ').trim();
const n=(v:unknown)=>{const x=Number(v);return Number.isFinite(x)?x:0};
const money=(v:number,currency:string)=>currency==='USD'?`USD ${v.toLocaleString('es-PY',{minimumFractionDigits:2,maximumFractionDigits:2})}`:`Gs. ${Math.round(v).toLocaleString('es-PY')}`;
const datePY=(v:unknown)=>{if(!v)return '—';const s=String(v).slice(0,10).split('-');return s.length===3?`${s[2]}/${s[1]}/${s[0]}`:String(v)};

function b64(bytes:Uint8Array){let binary='';const step=0x8000;for(let i=0;i<bytes.length;i+=step)binary+=String.fromCharCode(...bytes.subarray(i,i+step));return btoa(binary)}
function linesFor(text:string,font:PDFFont,size:number,maxWidth:number){
  const words=safe(text).split(/\s+/).filter(Boolean),out:string[]=[];let row='';
  for(const w of words){const candidate=row?`${row} ${w}`:w;if(font.widthOfTextAtSize(candidate,size)<=maxWidth){row=candidate;continue}if(row)out.push(row);if(font.widthOfTextAtSize(w,size)<=maxWidth){row=w;continue}let part='';for(const ch of w){const c=part+ch;if(font.widthOfTextAtSize(c,size)>maxWidth&&part){out.push(part);part=ch}else part=c}row=part}
  if(row)out.push(row);return out.length?out:[''];
}
function drawText(page:PDFPage,text:string,x:number,y:number,font:PDFFont,size=9,color=dark,maxWidth?:number){
  const rows=maxWidth?linesFor(text,font,size,maxWidth):[safe(text)];let yy=y;for(const r of rows){page.drawText(r,{x,y:yy,font,size,color});yy-=size+3}return yy;
}
function brand(page:PDFPage,company:any,bold:PDFFont,regular:PDFFont){
  const name=safe(company?.legal_name||company?.name||'');
  page.drawRectangle({x:36,y:758,width:88,height:44,color:green});
  if(name.toLowerCase().includes('astillero villa hayes')){
    page.drawText('AVH',{x:49,y:771,font:bold,size:24,color:rgb(1,1,1)});
    page.drawText('ASTILLERO VILLA HAYES S.A.',{x:136,y:786,font:bold,size:14,color:green});
  }else if(name.toLowerCase().includes('maqmoveis')){
    page.drawText('MM',{x:50,y:771,font:bold,size:23,color:rgb(1,1,1)});
    page.drawText('MAQMOVEIS PARAGUAY S.A.',{x:136,y:786,font:bold,size:14,color:green});
  }else{
    page.drawText('AVH',{x:49,y:771,font:bold,size:24,color:rgb(1,1,1)});
    page.drawText(name.slice(0,42),{x:136,y:786,font:bold,size:13,color:green});
  }
  const details=[company?.tax_id?`RUC: ${company.tax_id}`:'',company?.address||'',company?.phone||'',company?.email||''].filter(Boolean).join(' · ');
  drawText(page,details,136,770,regular,8,muted,330);
}
function pageBase(pdf:PDFDocument,company:any,bold:PDFFont,regular:PDFFont,po:string){
  const page=pdf.addPage([595.28,841.89]);brand(page,company,bold,regular);
  page.drawText('ORDEN DE COMPRA',{x:392,y:797,font:bold,size:16,color:dark});
  page.drawText(po,{x:392,y:778,font:bold,size:12,color:green});
  page.drawLine({start:{x:36,y:746},end:{x:559,y:746},thickness:1.5,color:green});
  return page;
}
function labelValue(page:PDFPage,label:string,value:string,x:number,y:number,w:number,bold:PDFFont,regular:PDFFont){
  page.drawRectangle({x,y:y-44,width:w,height:44,borderColor:line,borderWidth:0.8,color:rgb(1,1,1)});
  page.drawText(label.toUpperCase(),{x:x+8,y:y-13,font:bold,size:7.5,color:muted});
  drawText(page,value||'—',x+8,y-27,bold,9,dark,w-16);
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return json({error:'Método no permitido'},405);
  const supabaseUrl=Deno.env.get('SUPABASE_URL')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
  const admin=createClient(supabaseUrl,service,{auth:{persistSession:false}});
  const {data:userData,error:userErr}=await admin.auth.getUser(token);if(userErr||!userData.user)return json({error:'No autenticado'},401);
  const {data:caller}=await admin.from('profiles').select('role,active').eq('id',userData.user.id).maybeSingle();if(!caller||caller.role!=='admin'||!caller.active)return json({error:'Solo el administrador puede generar la OC.'},403);
  try{
    const body=await req.json(),purchaseId=safe(body?.purchase_id);if(!UUID.test(purchaseId))return json({error:'Compra inválida.'},400);
    const {data:p,error:pErr}=await admin.from('purchases').select('*').eq('id',purchaseId).maybeSingle();if(pErr||!p)return json({error:'Compra inexistente.'},404);
    if(!p.po_number)return json({error:'La compra todavía no tiene número de OC.'},400);
    const [companyR,supplierR,itemsR,bargeR,warehouseR]=await Promise.all([
      admin.from('purchase_companies').select('*').eq('id',p.company_id).maybeSingle(),
      p.supplier_id?admin.from('suppliers').select('*').eq('id',p.supplier_id).maybeSingle():Promise.resolve({data:null,error:null}),
      admin.from('purchase_items').select('*').eq('purchase_id',purchaseId).order('created_at'),
      p.barge_id?admin.from('barges').select('number,name').eq('id',p.barge_id).maybeSingle():Promise.resolve({data:null,error:null}),
      p.warehouse_id?admin.from('warehouses').select('name').eq('id',p.warehouse_id).maybeSingle():Promise.resolve({data:null,error:null})
    ]);
    const company=companyR.data||{},supplier=supplierR.data||{},items=itemsR.data||[];
    const destination=p.destination_type==='warehouse'?(warehouseR.data?.name||'Depósito'):p.destination_type==='barge'?`Barcaza ${bargeR.data?.number||''}`:(p.destination_text||'Entrega directa');
    const project=p.barge_id?`Barcaza ${bargeR.data?.number||''}`:'Sin asignar';

    const pdf=await PDFDocument.create(),regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
    let page=pageBase(pdf,company,bold,regular,p.po_number),y=730;
    page.drawText(`Fecha: ${datePY(p.po_generated_at||p.created_at)}`,{x:392,y:761,font:regular,size:8,color:muted});
    labelValue(page,'Proveedor',supplier.name||'Proveedor sin definir',36,y,252,bold,regular);
    labelValue(page,'RUC proveedor',supplier.tax_id||'—',307,y,122,bold,regular);
    labelValue(page,'Teléfono',supplier.phone||'—',437,y,122,bold,regular);y-=55;
    labelValue(page,'Referencia',p.source_document_number?`Presupuesto ${p.source_document_number}`:(p.order_reference||'—'),36,y,175,bold,regular);
    labelValue(page,'Condición de pago',p.payment_terms||'Según presupuesto',219,y,150,bold,regular);
    labelValue(page,'Moneda',p.currency||'PYG',377,y,82,bold,regular);
    labelValue(page,'Proyecto',project,467,y,92,bold,regular);y-=55;
    labelValue(page,'Lugar de entrega',destination||'—',36,y,340,bold,regular);
    labelValue(page,'Entrega prevista',p.expected_date?datePY(p.expected_date):'Según presupuesto',384,y,175,bold,regular);y-=62;

    const cols={code:36,desc:100,qty:355,unit:405,price:455,total:520};
    const tableHeader=()=>{page.drawRectangle({x:36,y:y-19,width:523,height:19,color:pale});page.drawText('COD.',{x:cols.code+3,y:y-13,font:bold,size:7,color:muted});page.drawText('DESCRIPCIÓN TÉCNICA',{x:cols.desc+3,y:y-13,font:bold,size:7,color:muted});page.drawText('CANT.',{x:cols.qty,y:y-13,font:bold,size:7,color:muted});page.drawText('UNIDAD',{x:cols.unit,y:y-13,font:bold,size:7,color:muted});page.drawText('PRECIO',{x:cols.price,y:y-13,font:bold,size:7,color:muted});page.drawText('TOTAL',{x:cols.total,y:y-13,font:bold,size:7,color:muted});y-=24};
    tableHeader();let total=0;
    const productIds=[...new Set(items.map((x:any)=>x.product_id).filter(Boolean))];
    const productMap=new Map<string,any>();
    if(productIds.length){const {data:products}=await admin.from('products').select('id,sku,name').in('id',productIds);for(const pr of products||[])productMap.set(pr.id,pr)}
    for(const item of items){
      const product=item.product_id?productMap.get(item.product_id):null;
      const desc=product?.name&&product.name!==item.description?`${item.description} · AVH: ${product.name}`:item.description;
      const descLines=linesFor(desc||'Ítem',regular,8,245),rowH=Math.max(20,descLines.length*11+5);
      if(y-rowH<92){page=pageBase(pdf,company,bold,regular,p.po_number);y=730;tableHeader()}
      page.drawLine({start:{x:36,y:y-rowH},end:{x:559,y:y-rowH},thickness:0.5,color:line});
      drawText(page,product?.sku||'—',cols.code+3,y-11,regular,7.5,dark,56);
      let dy=y-11;for(const row of descLines){page.drawText(row,{x:cols.desc+3,y:dy,font:regular,size:8,color:dark});dy-=11}
      page.drawText(n(item.quantity).toLocaleString('es-PY',{maximumFractionDigits:3}),{x:cols.qty,y:y-11,font:regular,size:8,color:dark});
      page.drawText(safe(item.unit),{x:cols.unit,y:y-11,font:regular,size:8,color:dark});
      page.drawText(money(n(item.unit_price),p.currency),{x:cols.price-8,y:y-11,font:regular,size:7.5,color:dark});
      const lineTotal=n(item.quantity)*n(item.unit_price);total+=lineTotal;
      page.drawText(money(lineTotal,p.currency),{x:cols.total-14,y:y-11,font:bold,size:7.5,color:dark});y-=rowH;
    }
    if(y<120){page=pageBase(pdf,company,bold,regular,p.po_number);y=700}
    page.drawRectangle({x:355,y:y-40,width:204,height:40,color:pale,borderColor:line,borderWidth:0.8});
    page.drawText('TOTAL OC',{x:369,y:y-17,font:bold,size:9,color:muted});page.drawText(money(total,p.currency),{x:433,y:y-18,font:bold,size:13,color:green});y-=58;
    drawText(page,`Responsable de Compras: Gabriel Ortega · ${company.phone||'0971 800 829'} · ${company.email||'gortega@astillerovh.com'}`,36,y,regular,8,muted,523);
    drawText(page,`Documento generado por AVH y vinculado a la compra ${p.po_number}.`,36,y-18,regular,7.5,muted,523);

    const pdfBytes=await pdf.save(),filename=`${p.po_number}-${safe(supplier.name||'PROVEEDOR').replace(/[^A-Za-z0-9_-]+/g,'_').slice(0,40)}.pdf`,path=`${purchaseId}/${p.po_number}.pdf`;
    const up=await admin.storage.from('purchase-documents').upload(path,pdfBytes,{contentType:'application/pdf',upsert:true});if(up.error)throw Error(`No pude archivar la OC: ${up.error.message}`);
    const {data:existing}=await admin.from('purchase_documents').select('id').eq('purchase_id',purchaseId).eq('kind','order').eq('file_path',path).maybeSingle();
    const docPayload={purchase_id:purchaseId,kind:'order',file_path:path,file_name:filename,document_number:p.po_number,document_date:String(p.po_generated_at||p.created_at).slice(0,10),source:'generated',uploaded_by:userData.user.id};
    if(existing?.id)await admin.from('purchase_documents').update(docPayload).eq('id',existing.id);else await admin.from('purchase_documents').insert(docPayload);
    await admin.from('audit_events').insert({entity_type:'purchase',entity_id:purchaseId,purchase_id:purchaseId,action:'purchase_order_pdf_generated',actor_id:userData.user.id,detail:{po_number:p.po_number,file_name:filename}});
    return json({ok:true,filename,pdf_base64:b64(pdfBytes),file_path:path});
  }catch(e){return json({error:e instanceof Error?e.message:'No pude generar la OC.'},400)}
});
