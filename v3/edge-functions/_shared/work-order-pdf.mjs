import {documentLayout} from './document-layout.mjs';
const qty=v=>v==null?'':Number(v).toLocaleString('es-PY',{maximumFractionDigits:3});
const executionDescription=v=>String(v||'').replace(/\s*\((?:cotizar|presupuestar)\b[^)]*\)/gi,'').trim();
function technicalData(t){
 const dimensions=t.length_mm!=null&&t.width_mm!=null,areaFromDimensions=dimensions?Number(t.length_mm)*Number(t.width_mm)/1000000:null;
 const redundantArea=dimensions&&Math.abs(Number(t.area_m2)-areaFromDimensions)<=.0005||t.unit==='m²'&&t.quantity!=null&&Number(t.quantity)===Number(t.area_m2);
 const size=dimensions?`${qty(t.length_mm)} x ${qty(t.width_mm)}${t.thickness_mm!=null?' x '+qty(t.thickness_mm):''} mm`:[t.length_mm!=null?'Largo '+qty(t.length_mm)+' mm':'',t.width_mm!=null?'Ancho '+qty(t.width_mm)+' mm':'',t.thickness_mm!=null?'Espesor '+qty(t.thickness_mm)+' mm':''].filter(Boolean).join(' / ');
 return[size,t.area_m2!=null&&!redundantArea?`${t.kind==='service'?'Superficie':'Área/pieza'} ${qty(t.area_m2)} m²`:''].filter(Boolean).join(' / ');
}
export function base64(bytes){let out='';for(let i=0;i<bytes.length;i+=8192)out+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(out);}
export async function makeWorkOrderPdf(order,lib){
 const p=order.issued_payload||order.payload,c=p.company||{},tasks=p.tasks||[],number=order.number||'BORRADOR - SIN EMITIR';
 const doc=await documentLayout(lib,{company:c,title:'ORDEN DE TRABAJO',number,date:p.order_date,status:order.status==='cancelled'?'ORDEN ANULADA':!order.number?'BORRADOR PARA REVISIÓN':'',reference:p.vessel||''});
 doc.heading(/recetas|plan de trabajo|planificaci[oó]n/i.test(p.title||'')?'Trabajos a ejecutar':p.title||'Trabajos a ejecutar');
 doc.table(['Datos del proyecto','Datos de ejecución'],[261,262],[
  [`Embarcación: ${p.vessel||''}`,`Responsable técnico: ${p.responsible||''}`],
  [`Cliente: ${p.client||''}`,`Ejecutor: ${p.executor||'A definir'}`],
  [`Lugar: ${p.location||'A definir'}`,`Fecha prevista: ${p.due_date||'A definir'}`]
 ]);
 const notes=String(p.notes||'').split(/\r?\n/).filter(s=>!/\bsource_row\b|\bgroups\.rows\b|\bJSON\b/i.test(s)).join('\n').trim();
 if(notes){doc.heading('Observaciones de ejecución');doc.paragraph(notes);}
 doc.heading('Detalle de trabajos');
 doc.table(['Ítem','Sector y trabajo','Medidas / espesor','Cantidad'],[31,296,126,70],tasks.map((t,i)=>[
  String(i+1),`${t.sector||'General'}: ${executionDescription(t.description)}`,
  technicalData(t),
  t.quantity==null?'Por definir':`${qty(t.quantity)} ${t.unit||''}`
 ]),{lineHeight:10,rowPadding:8});
 const weights=tasks.filter(t=>t.weight_kg!=null);doc.paragraph(`Trabajos: ${tasks.length}${weights.length?`. Peso total indicado (${weights.length} ítems con peso): ${qty(weights.reduce((s,t)=>s+Number(t.weight_kg),0))} kg.`:'.'}`,{font:doc.bold});
 if(p.source)doc.paragraph(`Referencia: ${p.source.file_name} - Hoja: ${p.source.sheet}`,{size:8,ink:doc.color.muted});
 doc.signatures(['Responsable técnico','Ejecutor / recepción','Autorización'],[p.responsible||'']);return doc.save();
}
