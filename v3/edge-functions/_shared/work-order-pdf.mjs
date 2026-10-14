const clean=v=>String(v??'').replace(/[\u0000-\u001f]/g,' ').replace(/[–—]/g,'-').replace(/[^\u0020-\u00ff]/g,'?');
const qty=v=>v==null?'':Number(v).toLocaleString('es-PY',{maximumFractionDigits:3});
function wrap(v,font,size,width){
 const lines=[];let line='';
 for(let word of clean(v).split(/\s+/)){
  while(word&&font.widthOfTextAtSize(word,size)>width){if(line){lines.push(line);line='';}let at=1;while(at<word.length&&font.widthOfTextAtSize(word.slice(0,at+1),size)<=width)at++;lines.push(word.slice(0,at));word=word.slice(at);}
  if(!word)continue;const next=line?line+' '+word:word;if(font.widthOfTextAtSize(next,size)>width){if(line)lines.push(line);line=word;}else line=next;
 }
 if(line)lines.push(line);return lines.length?lines:[''];
}
export function base64(bytes){let out='';for(let i=0;i<bytes.length;i+=8192)out+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(out);}
export async function makeWorkOrderPdf(order,lib){
 const {PDFDocument,StandardFonts,rgb}=lib,pdf=await PDFDocument.create(),regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
 const draft=!order.number,p=order.issued_payload||order.payload,c=p.company||{},tasks=p.tasks||[],number=order.number||'BORRADOR - SIN EMITIR';
 const green=rgb(.07,.32,.18),ink=rgb(.14,.19,.16),gray=rgb(.4,.47,.43),lineColor=rgb(.82,.87,.83),pale=rgb(.94,.97,.94);
 let page,y;
 const text=(v,x,yy,size=9,font=regular,color=ink)=>page.drawText(clean(v),{x,y:yy,size,font,color});
 const add=()=>{
  page=pdf.addPage([595.28,841.89]);y=722;
  page.drawRectangle({x:36,y:769,width:110,height:55,borderColor:green,borderWidth:1.3});text('AVH',53,786,26,bold,green);
  const company=clean(c.legal_name||c.name||'ASTILLERO VILLA HAYES S.A.');
  wrap(company,bold,10,380).slice(0,2).forEach((s,i)=>text(s,160,814-i*13,10,bold,green));
  text('ORDEN DE TRABAJO',160,779,15,bold,green);text(number,160,760,11,bold,green);
  if(c.tax_id)text('RUC '+c.tax_id,36,750,8,regular,gray);
  text('Fecha: '+clean(p.order_date||''),415,760,9,regular,gray);
  page.drawLine({start:{x:36,y:737},end:{x:559,y:737},color:green,thickness:1.3});
  if(draft||order.status==='cancelled'){text(draft?'BORRADOR PARA REVISIÓN':'ORDEN ANULADA',330,795,9,bold,rgb(.65,.24,.13));}
 };
 const ensure=height=>{if(y-height<65)add();};
 const paragraph=(v,size=9,font=regular,color=ink)=>{for(const s of wrap(v,font,size,523)){ensure(size+8);text(s,36,y,size,font,color);y-=size+4;}y-=6;};
 const heading=v=>{ensure(42);y-=7;text(v,36,y,11,bold,green);y-=20;};
 function table(headers,widths,rows){
  const xs=[];let at=36;for(const w of widths){xs.push(at);at+=w;}
  function header(){ensure(42);page.drawRectangle({x:36,y:y-24,width:523,height:24,color:green});headers.forEach((h,i)=>text(h,xs[i]+6,y-15,8,bold,rgb(1,1,1)));y-=24;}
  header();
  rows.forEach((row,index)=>{
   const cells=row.map((v,i)=>wrap(v,regular,8.1,widths[i]-12));let remaining=Math.max(...cells.map(x=>x.length)),offset=0;
   // Keep normal rows together. Very long descriptions may continue on the next page.
   if(y-(remaining*11+12)<65&&remaining*11+12<600){add();header();}
   while(remaining>0){
    if(y-32<65){add();header();}
    const count=Math.min(remaining,Math.max(1,Math.floor((y-65-12)/11))),height=count*11+12;
    if(index%2===0)page.drawRectangle({x:36,y:y-height,width:523,height,color:pale});
    cells.forEach((lines,i)=>lines.slice(offset,offset+count).forEach((s,j)=>text(s,xs[i]+6,y-14-j*11,8.1)));
    page.drawLine({start:{x:36,y:y-height},end:{x:559,y:y-height},color:lineColor,thickness:.5});
    y-=height;remaining-=count;offset+=count;if(remaining>0){add();header();}
   }
  });y-=12;
 }
 add();
 heading(p.title||'Trabajos navales');
 table(['Datos del proyecto','Datos de ejecución'],[261,262],[
  [`Embarcación: ${p.vessel||''}`,`Responsable técnico: ${p.responsible||''}`],
  [`Cliente: ${p.client||''}`,`Ejecutor: ${p.executor||'A definir'}`],
  [`Lugar: ${p.location||'A definir'}`,`Fecha prevista: ${p.due_date||'A definir'}`]
 ]);
 if(p.notes){heading('Alcance general y observaciones');paragraph(p.notes);}
 heading('Detalle de trabajos');
 table(['Ítem','Sector y trabajo','Datos técnicos','Cantidad','Peso kg'],[30,245,130,65,53],tasks.map((t,i)=>[
  String(i+1),`${t.sector||'General'}: ${t.description}`,
  [t.length_mm!=null&&t.width_mm!=null?`${qty(t.length_mm)} x ${qty(t.width_mm)} mm`:'',t.thickness_mm!=null?`Espesor ${qty(t.thickness_mm)} mm`:'',t.area_m2!=null?`${t.kind==='service'?'Superficie':'Área/pieza'} ${qty(t.area_m2)} m²`:''].filter(Boolean).join(' / '),
  t.quantity==null?'Por definir':`${qty(t.quantity)} ${t.unit||''}`,qty(t.weight_kg)
 ]));
 const weights=tasks.filter(t=>t.weight_kg!=null);paragraph(`Trabajos: ${tasks.length}${weights.length?`. Peso total indicado (${weights.length} ítems con peso): ${qty(weights.reduce((s,t)=>s+Number(t.weight_kg),0))} kg.`:'.'}`,9,bold);
 const plans=new Map();tasks.forEach((t,i)=>{const key=JSON.stringify([t.operations||[],t.acceptance||[]]);if(!plans.has(key))plans.set(key,{items:[],operations:t.operations||[],acceptance:t.acceptance||[]});plans.get(key).items.push(i+1);});
 if([...plans.values()].some(g=>g.operations.length||g.acceptance.length)){
  heading('Plan de ejecución y controles');
  for(const g of plans.values()){
   if(!g.operations.length&&!g.acceptance.length)continue;
   paragraph('Trabajos '+g.items.join(', '),9,bold,green);
   if(g.operations.length)paragraph('Operaciones: '+g.operations.join('; '));
   if(g.acceptance.length)paragraph('Verificaciones previstas: '+g.acceptance.join('; '));
  }
 }
 const materials=[];tasks.forEach((t,i)=>(t.materials||[]).forEach(m=>materials.push([String(i+1),m.description,m.quantity==null?'Por definir':qty(m.quantity)+' '+m.unit,m.confirmed?'Confirmado':'Por confirmar',m.basis||''])));
 if(materials.length){heading('Plan de materiales e insumos');paragraph('Las cantidades por confirmar y los consumos sin definir requieren validación del responsable antes de abastecer.');table(['Ítem','Material / insumo','Cantidad','Estado','Base del requerimiento'],[30,185,80,75,153],materials);}
 if(p.source){heading('Documento de referencia');paragraph(`${p.source.file_name} - Hoja: ${p.source.sheet}`);}
 ensure(115);y-=18;
 [36,214,392].forEach(x=>page.drawLine({start:{x,y:y-30},end:{x:x+155,y:y-30},color:gray,thickness:.6}));
 text('Responsable técnico',36,y-44,9,bold);text('Ejecutor / recepción',214,y-44,9,bold);text('Autorización',392,y-44,9,bold);
 if(p.responsible)wrap(p.responsible,regular,8,155).slice(0,2).forEach((s,i)=>text(s,36,y-58-i*11,8));
 pdf.getPages().forEach((pg,index)=>{
  pg.drawLine({start:{x:36,y:43},end:{x:559,y:43},color:lineColor,thickness:.6});
  pg.drawText(clean(number),{x:36,y:29,font:regular,size:8,color:gray});
  pg.drawText(`Página ${index+1} de ${pdf.getPageCount()}`,{x:463,y:29,font:regular,size:8,color:gray});
 });
 pdf.setTitle(`${number} - ${clean(p.vessel)}`);pdf.setAuthor(clean(c.legal_name||c.name||'Astillero Villa Hayes S.A.'));return pdf.save();
}
