import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage, PDFImage } from 'npm:pdf-lib@1.17.1';

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const green=rgb(0.06,0.28,0.18),dark=rgb(0.08,0.13,0.10),muted=rgb(0.37,0.44,0.40),line=rgb(0.84,0.88,0.85),pale=rgb(0.95,0.98,0.96),white=rgb(1,1,1);
const LOGO_BASE='https://grubbini6-debug.github.io/inventario-avh/assets';
const PDF_SOURCE='generated_vector_logo_v2';
const logoBytes=new Map<string,Uint8Array>();
const safe=(v:unknown)=>String(v??'').replace(/[\u0000-\u001f]/g,' ').trim();
const n=(v:unknown)=>{const x=Number(v);return Number.isFinite(x)?x:0};
const money=(v:number,currency:string)=>currency==='USD'?`USD ${v.toLocaleString('es-PY',{minimumFractionDigits:2,maximumFractionDigits:2})}`:`Gs. ${Math.round(v).toLocaleString('es-PY')}`;
const datePY=(v:unknown)=>{if(!v)return '—';const s=String(v).slice(0,10).split('-');return s.length===3?`${s[2]}/${s[1]}/${s[0]}`:String(v)};
function b64(bytes:Uint8Array){let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(binary)}
function linesFor(text:string,font:PDFFont,size:number,maxWidth:number){const words=safe(text).split(/\s+/).filter(Boolean),out:string[]=[];let row='';for(const w of words){const c=row?`${row} ${w}`:w;if(font.widthOfTextAtSize(c,size)<=maxWidth){row=c;continue}if(row)out.push(row);row=w}if(row)out.push(row);return out.length?out:['']}
function drawText(page:PDFPage,text:string,x:number,y:number,font:PDFFont,size=9,color=dark,maxWidth?:number){const rows=maxWidth?linesFor(text,font,size,maxWidth):[safe(text)];let yy=y;for(const r of rows){page.drawText(r,{x,y:yy,font,size,color});yy-=size+3}return yy}
async function fetchLogoBytes(file:string){if(logoBytes.has(file))return logoBytes.get(file)!;const r=await fetch(`${LOGO_BASE}/${file}`,{headers:{'cache-control':'max-age=3600'}});if(!r.ok)throw Error(`No pude cargar ${file}`);const bytes=new Uint8Array(await r.arrayBuffer());logoBytes.set(file,bytes);return bytes}
function isMaq(company:any){return safe(company?.legal_name||company?.name||'').toLowerCase().includes('maqmoveis')}
async function embedMaqLogo(pdf:PDFDocument,company:any){if(!isMaq(company))return null;try{return await pdf.embedJpg(await fetchLogoBytes('logo-maqmoveis.jpg'))}catch{return null}}
function fitImage(img:PDFImage,maxW:number,maxH:number){const d=img.scale(1),ratio=Math.min(maxW/d.width,maxH/d.height);return{width:d.width*ratio,height:d.height*ratio}}
function drawAvhVectorLogo(page:PDFPage,bold:PDFFont){
  const x=36,y=764;
  page.drawSvgPath('M 0 27 L 27 43 L 54 27 L 54 -4 L 27 -20 L 0 -4 Z',{x,y,scale:1,color:green});
  page.drawSvgPath('M 5 0 C 14 -5 23 -8 31 -7 C 39 -6 45 -2 50 2 C 41 1 34 4 27 5 C 19 6 12 5 5 0 Z',{x,y:y+1,scale:1,color:white});
  page.drawRectangle({x:x+20,y:y+10,width:15,height:10,color:white});
  page.drawRectangle({x:x+23,y:y+21,width:11,height:7,color:white});
  page.drawLine({start:{x:x+28,y:y+8},end:{x:x+28,y:y+34},thickness:1.8,color:white});
  page.drawLine({start:{x:99,y:755},end:{x:99,y:813},thickness:2,color:green});
  page.drawRectangle({x:110,y:796,width:111,height:16,color:green});
  page.drawText('• ASTILLERO •',{x:118,y:800,font:bold,size:8.2,color:white});
  page.drawText('VILLA HAYES',{x:109,y:768,font:bold,size:17.5,color:green});
}
function drawBrand(page:PDFPage,company:any,bold:PDFFont,regular:PDFFont,maqLogo:PDFImage|null){
  if(isMaq(company)){
    if(maqLogo){const s=fitImage(maqLogo,184,66);page.drawImage(maqLogo,{x:36,y:798-s.height,width:s.width,height:s.height})}
  }else drawAvhVectorLogo(page,bold);
  const name=safe(company?.legal_name||company?.name||'');
  page.drawText(name.slice(0,48),{x:240,y:790,font:bold,size:10.5,color:green});
  const details=[company?.tax_id?`RUC ${company.tax_id}`:'',company?.address||'',company?.phone||'',company?.email||''].filter(Boolean).join(' · ');
  drawText(page,details,240,773,regular,7.1,muted,150);
}
function pageBase(pdf:PDFDocument,company:any,bold:PDFFont,regular:PDFFont,maqLogo:PDFImage|null,po:string){const page=pdf.addPage([595.28,841.89]);drawBrand(page,company,bold,regular,maqLogo);page.drawText('ORDEN DE COMPRA',{x:400,y:797,font:bold,size:15.5,color:dark});page.drawText(po,{x:400,y:778,font:bold,size:12,color:green});page.drawLine({start:{x:36,y:746},end:{x:559,y:746},thickness:2,color:green});return page}
function box(page:PDFPage,label:string,value:string,x:number,y:number,w:number,bold:PDFFont,regular:PDFFont){page.drawRectangle({x,y:y-44,width:w,height:44,borderColor:line,borderWidth:.8,color:white});page.drawText(label.toUpperCase(),{x:x+8,y:y-13,font:bold,size:7.3,color:muted});drawText(page,value||'—',x+8,y-27,bold,8.7,dark,w-16)}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return json({error:'Método no permitido'},405);
  const supabaseUrl=Deno.env.get('SUPABASE_URL')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
  const admin=createClient(supabaseUrl,service,{auth:{persistSession:false}});
  const {data:userData,error:userErr}=await admin.auth.getUser(token);if(userErr||!userData.user)return json({error:'No autenticado'},401);
  const {data:caller}=await admin.from('profiles').select('role,active').eq('id',userData.user.id).maybeSingle();if(!caller||caller.role!=='admin'||!caller.active)return json({error:'Solo el administrador puede generar la OC.'},403);
  try{
    const body=await req.json(),purchaseId=safe(body?.purchase_id);if(!UUID.test(purchaseId))return json({error:'Compra inválida.'},400);
    const {data:p,error:pErr}=await admin.from('purchases').select('*').eq('id',purchaseId).maybeSingle();if(pErr||!p)return json({error:'Compra inexistente.'},404);if(!p.po_number)return json({error:'La compra todavía no tiene número de OC.'},400);

    // Solo reutilizar PDFs generados con el logo vectorial vigente. Las versiones anteriores se regeneran una vez.
    const {data:stored}=await admin.from('purchase_documents').select('file_path,file_name,source').eq('purchase_id',purchaseId).eq('kind','order').eq('source',PDF_SOURCE).order('created_at',{ascending:false}).limit(1).maybeSingle();
    if(stored?.file_path){const d=await admin.storage.from('purchase-documents').download(stored.file_path);if(!d.error&&d.data){const bytes=new Uint8Array(await d.data.arrayBuffer());return json({ok:true,reused:true,filename:stored.file_name||`${p.po_number}.pdf`,pdf_base64:b64(bytes),file_path:stored.file_path})}}

    const [companyR,supplierR,itemsR,bargeR,warehouseR]=await Promise.all([
      admin.from('purchase_companies').select('*').eq('id',p.company_id).maybeSingle(),
      p.supplier_id?admin.from('suppliers').select('*').eq('id',p.supplier_id).maybeSingle():Promise.resolve({data:null,error:null}),
      admin.from('purchase_items').select('*').eq('purchase_id',purchaseId).order('created_at'),
      p.barge_id?admin.from('barges').select('number,name').eq('id',p.barge_id).maybeSingle():Promise.resolve({data:null,error:null}),
      p.warehouse_id?admin.from('warehouses').select('name').eq('id',p.warehouse_id).maybeSingle():Promise.resolve({data:null,error:null})
    ]);
    const company=companyR.data||{},supplier=supplierR.data||{},items=itemsR.data||[];
    const destination=p.destination_type==='warehouse'?(warehouseR.data?.name||'Depósito'):p.destination_type==='barge'?`Barcaza ${bargeR.data?.number||''}`:(p.destination_text||'Entrega directa');
    const project=p.barge_id?`Barcaza ${bargeR.data?.number||''}`:'—';
    const pdf=await PDFDocument.create(),regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold),maqLogo=await embedMaqLogo(pdf,company);
    let page=pageBase(pdf,company,bold,regular,maqLogo,p.po_number),y=730;page.drawText(`Fecha: ${datePY(p.po_generated_at||p.created_at)}`,{x:400,y:761,font:regular,size:7.5,color:muted});
    box(page,'Proveedor',supplier.name||'Proveedor sin definir',36,y,252,bold,regular);box(page,'RUC proveedor',supplier.tax_id||'—',307,y,122,bold,regular);box(page,'Contacto',supplier.phone||supplier.email||'—',437,y,122,bold,regular);y-=55;
    box(page,'Presupuesto / referencia',p.source_document_number||p.order_reference||'—',36,y,175,bold,regular);box(page,'Condición de pago',p.payment_terms||'Según presupuesto',219,y,150,bold,regular);box(page,'Moneda',p.currency||'PYG',377,y,82,bold,regular);box(page,'Proyecto',project,467,y,92,bold,regular);y-=55;
    box(page,'Lugar de entrega',destination||'—',36,y,340,bold,regular);box(page,'Entrega prevista',p.expected_date?datePY(p.expected_date):'Según coordinación',384,y,175,bold,regular);y-=62;

    const cols={desc:39,unit:350,qty:401,price:455,total:518};
    const head=()=>{page.drawRectangle({x:36,y:y-20,width:523,height:20,color:green});page.drawText('DESCRIPCIÓN TÉCNICA',{x:cols.desc,y:y-14,font:bold,size:7,color:white});page.drawText('UNIDAD',{x:cols.unit,y:y-14,font:bold,size:7,color:white});page.drawText('CANT.',{x:cols.qty,y:y-14,font:bold,size:7,color:white});page.drawText('PRECIO',{x:cols.price,y:y-14,font:bold,size:7,color:white});page.drawText('TOTAL',{x:cols.total,y:y-14,font:bold,size:7,color:white});y-=25};
    head();let total=0;const productIds=[...new Set(items.map((x:any)=>x.product_id).filter(Boolean))],productMap=new Map<string,any>();if(productIds.length){const {data:products}=await admin.from('products').select('id,sku,name').in('id',productIds);for(const pr of products||[])productMap.set(pr.id,pr)}
    for(const item of items){const product=item.product_id?productMap.get(item.product_id):null,desc=product?.sku?`${item.description} [${product.sku}]`:item.description,rows=linesFor(desc||'Ítem',regular,8,300),rowH=Math.max(23,rows.length*11+7);if(y-rowH<92){page=pageBase(pdf,company,bold,regular,maqLogo,p.po_number);y=730;head()}page.drawLine({start:{x:36,y:y-rowH},end:{x:559,y:y-rowH},thickness:.5,color:line});let dy=y-12;for(const row of rows){page.drawText(row,{x:cols.desc,y:dy,font:regular,size:8,color:dark});dy-=11}page.drawText(safe(item.unit),{x:cols.unit,y:y-12,font:regular,size:7.6,color:dark});page.drawText(n(item.quantity).toLocaleString('es-PY',{maximumFractionDigits:3}),{x:cols.qty,y:y-12,font:regular,size:7.6,color:dark});page.drawText(money(n(item.unit_price),p.currency),{x:cols.price-9,y:y-12,font:regular,size:7.1,color:dark});const lt=n(item.quantity)*n(item.unit_price);total+=lt;page.drawText(money(lt,p.currency),{x:cols.total-14,y:y-12,font:bold,size:7.1,color:dark});y-=rowH}
    if(y<125){page=pageBase(pdf,company,bold,regular,maqLogo,p.po_number);y=700}page.drawRectangle({x:346,y:y-43,width:213,height:43,color:pale,borderColor:line,borderWidth:.8});page.drawText('TOTAL ORDEN DE COMPRA',{x:358,y:y-18,font:bold,size:8.3,color:muted});page.drawText(money(total,p.currency),{x:430,y:y-35,font:bold,size:13.5,color:green});y-=61;
    drawText(page,`Contacto de Compras: Gabriel Ortega · ${company.phone||'0971 800 829'} · ${company.email||'gortega@astillerovh.com'}`,36,y,regular,8,muted,523);
    drawText(page,`OC asociada al presupuesto/referencia indicado y registrada en AVH.`,36,y-17,regular,7.3,muted,523);

    const pdfBytes=await pdf.save(),filename=`${p.po_number}-${safe(supplier.name||'PROVEEDOR').replace(/[^A-Za-z0-9_-]+/g,'_').slice(0,40)}.pdf`,path=`${purchaseId}/${p.po_number}-vector-v2.pdf`;
    const up=await admin.storage.from('purchase-documents').upload(path,pdfBytes,{contentType:'application/pdf',upsert:true});if(up.error)throw Error(`No pude archivar la OC: ${up.error.message}`);
    await admin.from('purchase_documents').insert({purchase_id:purchaseId,kind:'order',file_path:path,file_name:filename,document_number:p.po_number,document_date:String(p.po_generated_at||p.created_at).slice(0,10),source:PDF_SOURCE,uploaded_by:userData.user.id});
    await admin.from('audit_events').insert({entity_type:'purchase',entity_id:purchaseId,purchase_id:purchaseId,action:'purchase_order_pdf_generated',actor_id:userData.user.id,detail:{po_number:p.po_number,file_name:filename,source:PDF_SOURCE}});
    return json({ok:true,reused:false,filename,pdf_base64:b64(pdfBytes),file_path:path});
  }catch(e){return json({error:e instanceof Error?e.message:'No pude generar la OC.'},400)}
});
