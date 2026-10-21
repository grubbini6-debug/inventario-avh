// Repair budgets are service commitments. None of these calculations change FIFO stock.
(function(root){
 const states={draft:'Borrador',pending:'Pendiente de autorización',approved:'Autorizada',in_service:'En reparación',testing:'En prueba',completed:'Cerrada',cancelled:'Anulada'};
 const custody={awaiting:'Pendiente de envío',service:'En reparación',testing:'Pendiente de prueba',rework:'Requiere retrabajo',ready:'Conforme',cancelled:'Anulada'};
 const assetStates={available:'Disponible',needs_repair:'Necesita reparación',in_repair:'En reparación',testing:'En prueba',inactive:'Fuera de servicio'};
 const types={labor:'Mano de obra',part:'Repuesto instalado',other:'Otro servicio'};
 const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Asuncion',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const blank=()=>({warehouse_id:'',company_id:'',supplier_id:'',quote_number:'',quote_date:'',valid_until:'',problem:'',currency:'',tax_mode:'',tax_rate:null,source_total:null,warranty_days:null,payment_terms:'',notes:'',reviewed:false,items:[]});
 function amount(value){if(value===null||value===undefined||value==='')return null;const n=Number(value);if(!Number.isFinite(n)||n<0||n>1e12)throw Error('Revisá las cantidades y los importes.');return n;}
 const round=(v,c)=>Math.round((v+Number.EPSILON)*(c==='PYG'?1:100))/(c==='PYG'?1:100);
 function totals(p){
  let pending=!['PYG','USD'].includes(p.currency)||!['included','add','none'].includes(p.tax_mode),subtotal=0;const byAsset=new Map();
  const items=(p.items||[]).map(i=>{const q=amount(i.quantity),price=amount(i.unit_price),line=q===null||price===null?null:round(q*price,p.currency);if(q===null||q<=0||price===null||!i.equipment_id||!i.description?.trim())pending=true;if(line!==null){subtotal+=line;byAsset.set(i.equipment_id,(byAsset.get(i.equipment_id)||0)+line);}return{...i,line_total:line};});
  subtotal=round(subtotal,p.currency);const rate=amount(p.tax_rate);if(p.tax_mode==='add'&&(rate===null||rate>100))pending=true;
  const tax=p.tax_mode==='add'?round(subtotal*(rate||0)/100,p.currency):0,total=round(subtotal+tax,p.currency);let allocated=0;
  const allocations=[...byAsset].sort(([a],[b])=>String(a).localeCompare(String(b))).map(([equipment_id,base],i,all)=>{const value=i===all.length-1?round(total-allocated,p.currency):round(subtotal?base/subtotal*total:0,p.currency);allocated=round(allocated+value,p.currency);return{equipment_id,amount:value};});
  return{items,subtotal,tax_amount:tax,total,allocations,pending,source_difference:p.source_total==null?null:round(total-Number(p.source_total),p.currency)};
 }
 function imported(a,assets,suppliers,base=blank()){
  const p={...base,items:[],currency:a.currency||'',tax_mode:a.tax_mode||'',tax_rate:a.tax_rate??null,source_total:a.source_total??null,quote_number:a.fields?.reference||'',quote_date:a.fields?.document_date||'',valid_until:a.fields?.valid_until||'',payment_terms:a.fields?.payment_terms||'',notes:[a.fields?.notes,a.fields?.delivery_terms].filter(Boolean).join('\n'),reviewed:false};
  const issuer=a.company||{},clean=v=>String(v||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
  const found=suppliers.filter(s=>issuer.tax_id?clean(s.tax_id)===clean(issuer.tax_id):clean(s.name)===clean(issuer.legal_name));if(found.length===1)p.supplier_id=found[0].id;
  p.items=(a.items||[]).map(i=>{const description=[i.description,i.details].filter(Boolean).join(' · '),text=clean(description),matches=assets.filter(e=>[e.code,e.serial_number].filter(v=>String(v||'').length>=3).some(v=>{const token=clean(v);return new RegExp('(^|[^a-z0-9])'+token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'($|[^a-z0-9])').test(text);}));return{equipment_id:matches.length===1?matches[0].id:'',kind:'labor',description,quantity:i.quantity??null,unit_price:i.unit_price??null};});
  return p;
 }
 root.AVHRepairModel={states,custody,assetStates,types,day,blank,totals,imported,round};
})(globalThis);
