// Portable renderer: pdf-lib is injected by Edge Functions and the Node validation suite.
const text=v=>String(v??'').replace(/[\u0000-\u001f]/g,' ').replace(/[–—]/g,'-').replace(/[^\u0020-\u00ff]/g,'?');
const val=v=>v==null?'Sin registro':text(v), qty=v=>v==null?'Sin registro':Number(v).toLocaleString('es-PY',{maximumFractionDigits:3});
const states={pending:'Pendiente',preparation:'Preparación',manufacturing:'En fabricación',quality:'Control interno',completed:'Terminado',delivered:'Entregado',cancelled:'Cancelado'};
const types={entry:'Entrada',exit:'Salida',transfer:'Transferencia',return:'Devolución',initial:'Inventario inicial',adjustment:'Ajuste',correction:'Corrección'};
const actions={configure:'Configuración del taller',access:'Permiso actualizado',component:'Componente agregado',worker:'Personal actualizado',order:'Orden registrada / actualizada',material:'Requerimiento de material',reserve:'Reserva actualizada',consume:'Consumo registrado',return:'Sobrante devuelto',output:'Piezas ingresadas al inventario',delivery:'Piezas entregadas',state:'Cambio de estado',block:'Orden bloqueada',unblock:'Bloqueo resuelto',log:'Avance de producción',quality:'Inspección interna',attachment:'Archivo adjuntado',closure:'Cierre diario',report:'Reporte generado'};
function section(title,rows){return{title,lines:rows.length?rows:['Sin registros para esta sección.']};}
export function reportSections(report){
  const p=report.payload,logs=p.work_logs||[],hours=logs.reduce((a,l)=>a+(l.personnel||[]).reduce((b,x)=>b+Number(x.hours||0),0),0),made=logs.reduce((a,l)=>a+Number(l.completed_qty||0),0),c=p.closure;
  return [
    section('Resumen del día',[
      `Piezas nuevas fabricadas: ${qty(made)}. Horas-persona registradas: ${qty(hours)}.`,
      hours?`Productividad registrada: ${qty(made/hours)} piezas/hora-persona. Incluye distintos componentes.`:'Productividad: sin horas registradas.',
      `Generación: ${val(p.generated_at)}. Fuente: ${report.source==='automatic'?'Automática':'Manual'}.`,...(p.data_notes||[])
    ]),
    section('Movimientos del depósito',(p.movements||[]).map(m=>
      `#${m.number} ${types[m.type]||m.type} - ${m.status}. ${val(m.warehouse_from)} > ${val(m.warehouse_to)}. Usuario: ${val(m.actor)}. `+
      `${m.received_today?'Recepción de transferencia registrada este día. ':''}${(m.lines||[]).map(l=>`${qty(l.quantity)} ${val(l.unit)} ${val(l.product)}`).join('; ')}. `+
      `${m.fabrication_order?`OF-${m.fabrication_order} (${m.fabrication_kind}). `:''}${m.notes?val(m.notes):''}`)),
    section('Alertas de stock',(p.stock_alerts||[]).map(a=>`${val(a.product_name)}: stock ${qty(a.stock_qty)} ${val(a.base_unit)}; mínimo ${qty(a.minimum_qty)}.`)),
    section('Órdenes y producción',(p.orders||[]).map(o=>
      `OF-${o.number} - ${val(o.component)} / ${val(o.piece_code)} / ${val(o.project)}. ${states[o.state]||o.state}. `+
      `Solicitadas ${qty(o.requested_qty)}, fabricadas ${qty(o.produced_qty)}, hoy ${qty(o.produced_today)}, pendientes ${qty(o.pending_qty)}; avance ${qty(o.progress_percent)}%. `+
      `Aprobadas internamente ${qty(o.approved_qty)}. Fecha prevista ${val(o.due_date)}${o.delayed?' - ATRASADA':''}. ${o.blocked_reason?'BLOQUEO: '+val(o.blocked_reason):''}`)),
    section('Personal, actividades e incidentes',logs.map(l=>
      `OF-${l.order_number} - ${val(l.activity)}. ${qty(l.completed_qty)} piezas nuevas. `+
      `${(l.personnel||[]).map(x=>`${val(x.name)}: ${qty(x.hours)} h; tarifa ${x.hourly_rate==null?'sin registrar':qty(x.hourly_rate)+' '+val(x.currency)+'/h'}`).join('; ')}. `+
      `${l.incident?'Incidente: '+val(l.incident)+'. ':''}${l.notes?val(l.notes):''}`)),
    section('Calidad interna y retrabajos',(p.quality||[]).map(q=>
      `OF-${q.order_number} - ${q.result==='approved'?'Aprobado internamente':q.result==='rework'?'Retrabajo':'Rechazado internamente'}: ${qty(q.quantity)} piezas. `+
      `Responsable ${val(q.responsible)}. Plano ${val(q.drawing)} / revisión ${val(q.drawing_revision)}. `+
      `Medidas: ${val(q.measurements)}. Soldaduras: ${val(q.weld_finish)}. Defectos: ${val(q.defects)}. Observaciones: ${val(q.notes)}.`)),
    section('Materiales requeridos y faltantes',(p.materials||[]).map(m=>
      `OF-${m.order_number} - ${val(m.product_name)} (${val(m.base_unit)}). Requerido ${qty(m.required_qty)}, consumo neto ${qty(m.net_consumed_qty)}, reservado ${qty(m.reserved_qty)}, stock ${qty(m.stock_qty)}, disponible ${qty(m.available_qty)}, faltante ${qty(m.missing_qty)}.`)),
    section('Costos acumulados registrados',(p.costs||[]).map(k=>
      `OF-${k.order_number}: ${k.known_cost==null?'sin costos registrados':qty(k.known_cost)+' '+val(k.currency)}. `+
      `${Number(k.unpriced_records)>0?'PARCIAL: '+k.unpriced_records+' registros sin precio.':'Materiales FIFO y mano de obra valorizada.'}`)
      .concat((p.orders||[]).filter(o=>o.estimated_cost!=null).map(o=>`OF-${o.number}: estimado ${qty(o.estimated_cost)} ${val(o.estimated_currency)}.`))),
    section('Solicitudes de abastecimiento',(p.supply_requests||[]).map(r=>`${val(r.name)}: ${qty(r.quantity)} ${val(r.unit)}; prioridad ${val(r.urgency)}, estado ${val(r.status)}. ${r.notes?val(r.notes):''}`)),
    section('Bloqueos, cambios y observaciones',(p.events||[]).map(e=>`${e.order_number?'OF-'+e.order_number:'Taller'} - ${actions[e.action]||val(e.action)}: ${e.notes?val(e.notes):'Sin observación adicional'}. Responsable: ${val(e.actor)}. ${val(e.created_at)}`)),
    section('Cierre y actividades previstas',c?[
      `Cierre: ${val(c.notes)}.`, `Problemas de equipos: ${val(c.equipment_problems)}.`,
      `Necesidades de compras: ${val(c.purchase_needs)}.`, `Plan para el día siguiente: ${val(c.next_day_plan)}.`
    ]:[])
  ];
}
function wrap(content,font,size,width){
  const words=text(content).split(/\s+/),lines=[];let current='';
  for(let word of words){
    while(font.widthOfTextAtSize(word,size)>width){
      if(current){lines.push(current);current='';}
      let cut=1;while(cut<word.length&&font.widthOfTextAtSize(word.slice(0,cut+1),size)<=width)cut++;
      lines.push(word.slice(0,cut));word=word.slice(cut);
    }
    if(!word)continue;
    const candidate=current?current+' '+word:word;
    if(font.widthOfTextAtSize(candidate,size)>width){lines.push(current);current=word;}else current=candidate;
  }
  if(current)lines.push(current);return lines;
}
export async function makeFabricationPdf(report,lib){
  const {PDFDocument,StandardFonts,rgb}=lib,pdf=await PDFDocument.create();
  const regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
  const green=rgb(.06,.32,.18),dark=rgb(.12,.18,.14),muted=rgb(.38,.45,.4);let page,y;
  const add=()=>{
    page=pdf.addPage([595.28,841.89]);y=735;
    page.drawRectangle({x:0,y:768,width:595.28,height:74,color:green});
    page.drawText('ASTILLERO VILLA HAYES S.A.',{x:36,y:814,font:bold,size:12,color:rgb(1,1,1)});
    page.drawText('REPORTE DIARIO - FABRICACIÓN NAVAL',{x:36,y:793,font:bold,size:13,color:rgb(1,1,1)});
    page.drawText(text(`${report.payload.warehouse?.name||'Depósito'} | ${report.report_date} | Revisión ${report.revision}`),{x:36,y:779,font:regular,size:9,color:rgb(1,1,1)});
  };
  add();
  for(const block of reportSections(report)){
    if(y<120)add();
    page.drawText(text(block.title),{x:36,y,font:bold,size:11,color:green});y-=20;
    for(const row of block.lines){
      for(const line of wrap(row,regular,9,523)){
        if(y<62)add();page.drawText(line,{x:36,y,font:regular,size:9,color:dark});y-=13;
      }
      y-=7;
    }
    y-=9;
  }
  const pages=pdf.getPages();pages.forEach((pg,i)=>{
    pg.drawLine({start:{x:36,y:43},end:{x:559,y:43},thickness:.6,color:muted});
    pg.drawText(`AVH-FAB-RD | ${report.report_date} | Rev. ${report.revision} | ${i+1}/${pages.length}`,{x:36,y:28,font:regular,size:8,color:muted});
  });
  pdf.setTitle(`Reporte diario Fabricación Naval ${report.report_date}`);pdf.setAuthor('Astillero Villa Hayes S.A.');
  return pdf.save();
}
export function base64(bytes){let out='';for(let i=0;i<bytes.length;i+=32768)out+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(out);}
