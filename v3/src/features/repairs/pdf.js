// PDFs use a fresh server snapshot, and never approve an order or debit warehouse stock.
(function(root){
 let runtime;
 async function script(src,global){if(root[global])return root[global];await new Promise((resolve,reject)=>{const el=document.createElement('script');el.src=src;el.onload=resolve;el.onerror=()=>reject(Error('No se pudo cargar el generador de PDF.'));document.head.appendChild(el);});return root[global];}
 async function dependencies(){if(!runtime)runtime=(async()=>{const lib=await script('assets/pdf-lib.min.js','PDFLib'),fontkit=await script('assets/fontkit.umd.min.js','fontkit');const bytes=await Promise.all(['inter-latin-400-normal.woff','inter-latin-700-normal.woff'].map(async name=>{const r=await fetch('assets/'+name);if(!r.ok)throw Error('No se pudieron cargar las fuentes del PDF.');return new Uint8Array(await r.arrayBuffer());}));return{lib,fontkit,regular:bytes[0],bold:bytes[1]};})().catch(err=>{runtime=null;throw err;});return runtime;}
 async function create(order,kind='order',equipmentId=null,deps=null){
  const p=order.approved_payload;if(!p||!order.approval)throw Error('El PDF de ejecución requiere una reparación autorizada.');
  const c=kind==='dispatch'?order.assets?.find(x=>x.equipment_id===equipmentId):null;if(kind==='dispatch'&&!c?.dispatch)throw Error('Registrá la entrega del equipo antes de generar su remito.');
  const d=deps||await dependencies(),{PDFDocument,rgb}=d.lib,pdf=await PDFDocument.create();pdf.registerFontkit(d.fontkit);
  const regular=await pdf.embedFont(d.regular,{subset:true}),bold=await pdf.embedFont(d.bold,{subset:true}),ink=rgb(.10,.17,.25),muted=rgb(.36,.42,.48),blue=rgb(.10,.25,.39),line=rgb(.83,.87,.90);
  const company=p.company||{},companyName=company.legal_name||company.name||'Empresa',ref=kind==='dispatch'?c.dispatch.reference:order.number;
  let logo=null,avhLogo=null;
  if(d.logo){logo=await pdf.embedJpg(d.logo);}else if(!deps){
   if(/villa hayes|^avh$/i.test(companyName)){const brand=await import(new URL('assets/avh-brand.mjs',document.baseURI).href);logo=await brand.embedAvhLogo(pdf);avhLogo=brand.drawAvhLogo;}
   else if(/maqmoveis|maqpy/i.test(companyName)){const r=await fetch('assets/logo-maqmoveis.jpg');if(r.ok)logo=await pdf.embedJpg(await r.arrayBuffer());}
  }
  let page,y;const pages=[];
  const clean=value=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
  function wrap(value,width,size=10,font=regular){const out=[];for(const paragraph of clean(value).split('\n')){let current='';for(const word of paragraph.split(/\s+/).filter(Boolean)){if(font.widthOfTextAtSize((current?current+' ':'')+word,size)<=width){current+=(current?' ':'')+word;continue;}if(current){out.push(current);current='';}let chunk='';for(const ch of word){if(chunk&&font.widthOfTextAtSize(chunk+ch,size)>width){out.push(chunk);chunk='';}chunk+=ch;}current=chunk;}out.push(current);}return out.length?out:[''];}
  function text(value,x,baseline,size=10,font=regular,color=ink){page.drawText(clean(value),{x,y:baseline,size,font,color});}
  function newPage(){page=pdf.addPage([595.28,841.89]);pages.push(page);let top=793;
   const companyLines=wrap(companyName,logo?393:510,12,bold);for(const row of companyLines){text(row,38,top,12,bold,blue);top-=15;}
   if(avhLogo){avhLogo(page,logo,d.lib,470,750,45);}else if(logo){const scale=Math.min(84/logo.width,48/logo.height);page.drawImage(logo,{x:470,y:750,width:logo.width*scale,height:logo.height*scale});}
   for(const value of [company.tax_id?'RUC: '+company.tax_id:'',company.address,[company.phone,company.email].filter(Boolean).join(' · ')].filter(Boolean)){for(const row of wrap(value,logo?410:515,8)){text(row,38,top,8,regular,muted);top-=11;}}
   y=Math.min(top-14,715);text(kind==='dispatch'?'REMITO DE EQUIPO A REPARACIÓN':'ORDEN DE REPARACIÓN',38,y,15,bold,blue);y-=22;
   for(const row of wrap(ref,515,10,bold)){text(row,38,y,10,bold);y-=14;}page.drawLine({start:{x:38,y:y-2},end:{x:557,y:y-2},thickness:1,color:line});y-=22;
  }
  function ensure(height){if(y-height<55)newPage();}
  function paragraph(value,{size=10,font=regular,color=ink,space=7}={}){for(const row of wrap(value,515,size,font)){ensure(size+5);text(row,38,y,size,font,color);y-=size+5;}y-=space;}
  const heading=value=>{ensure(40);paragraph(value,{size:11,font:bold,color:blue,space:4});};
  const money=(n)=>new Intl.NumberFormat('es-PY',{minimumFractionDigits:p.currency==='USD'?2:0,maximumFractionDigits:p.currency==='USD'?2:0}).format(Number(n||0))+' '+p.currency;
  const date=v=>!v?'':/^\d{4}-\d{2}-\d{2}$/.test(v)?v.split('-').reverse().join('/'):new Intl.DateTimeFormat('es-PY',{timeZone:'America/Asuncion',dateStyle:'short',timeStyle:'short'}).format(new Date(v));
  const datum=(label,value)=>{if(value!==null&&value!==undefined&&value!=='')paragraph(label+': '+value);};
  newPage();datum('Taller / proveedor',p.supplier?.name);datum('RUC del taller',p.supplier?.tax_id);datum('Depósito responsable',p.warehouse_name);
  if(kind==='dispatch'){
   datum('Orden vinculada',order.number);datum('Fecha de entrega',date(c.dispatch.date));datum('Reparación en',c.dispatch.mode==='onsite'?'Depósito de origen':'Taller externo');
   heading('Equipo entregado');datum('Código',c.snapshot.code);datum('Equipo',c.snapshot.name);datum('Marca / modelo',[c.snapshot.brand,c.snapshot.model].filter(Boolean).join(' · '));datum('Número de serie',c.snapshot.serial_number||'Sin registrar');
   heading('Estado y accesorios');datum('Estado / falla',c.dispatch.condition);datum('Accesorios entregados',c.dispatch.accessories);datum('Transportista / persona que retira',c.dispatch.carrier);datum('Chapa',c.dispatch.plate);datum('Regreso previsto',date(c.dispatch.expected_return));datum('Observaciones',c.dispatch.notes);
   paragraph('La recepción del equipo y su prueba de funcionamiento se registran al regresar.',{size:9,color:muted});
   ensure(102);y-=12;for(const [x,title] of [[38,'ENTREGÓ'],[215,'TRANSPORTÓ'],[392,'RECIBIÓ EN DESTINO']]){page.drawLine({start:{x,y:y-34},end:{x:x+152,y:y-34},thickness:.7,color:line});text(title,x,y-50,8,bold);text('Nombre, firma y fecha',x,y-65,8,regular,muted);}
  }else{
   datum('Presupuesto del taller',p.quote_number);datum('Fecha del presupuesto',date(p.quote_date));datum('Falla / alcance',p.problem);
   for(const machine of p.assets||[]){heading(machine.code+' · '+machine.name);datum('Serie',machine.serial_number||'Sin registrar');
    for(const i of p.items.filter(i=>i.equipment_id===machine.id)){paragraph(i.description,{font:bold,space:2});paragraph((root.AVHRepairModel?.types[i.kind]||i.kind)+' · '+i.quantity+' × '+money(i.unit_price)+' = '+money(i.line_total),{size:9,color:muted,space:10});}
    datum('Importe autorizado para este equipo (con impuestos)',money(p.allocations.find(a=>a.equipment_id===machine.id)?.amount));
   }
   heading('Resumen del servicio');datum('Subtotal',money(p.subtotal));if(p.tax_mode==='add')datum('IVA adicional '+p.tax_rate+'%',money(p.tax_amount));else paragraph(p.tax_mode==='included'?'Precios con IVA incluido.':'Sin IVA / exento según el presupuesto.');
   paragraph('TOTAL AUTORIZADO: '+money(p.total),{size:12,font:bold,color:blue,space:12});datum('Condiciones de pago',p.payment_terms);if(p.warranty_days!=null)datum('Garantía ofrecida',p.warranty_days+' días');datum('Observaciones / exclusiones',p.notes);
   heading('Autorización registrada');datum('Autorización recibida de',order.approval.authorized_by);datum('Respaldo / referencia',order.approval.reference);datum('Registro',date(order.approval.recorded_at));
   paragraph('El servicio queda sujeto a recepción y conformidad técnica. Los trabajos adicionales requieren autorización previa.',{size:9,color:muted});
  }
  pages.forEach((p,i)=>{p.drawLine({start:{x:38,y:42},end:{x:557,y:42},thickness:.6,color:line});p.drawText(ref+' · '+(i+1)+' / '+pages.length,{x:38,y:27,size:8,font:regular,color:muted});});
  pdf.setTitle((kind==='dispatch'?'Remito ':'Orden de reparación ')+ref);pdf.setAuthor(companyName);pdf.setProducer('Inventario AVH');return pdf.save();
 }
 root.AVHRepairPDF={create};
})(globalThis);
