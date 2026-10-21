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
  let pending=!['PYG','USD'].includes(p.currency)||!['included','add','none'].includes(p.tax_mode),subtotal=0;let financial_pending=pending;const byAsset=new Map();
  const items=(p.items||[]).map(i=>{const q=amount(i.quantity),price=amount(i.unit_price),line=q===null||price===null?null:round(q*price,p.currency);if(q===null||q<=0||price===null||!i.equipment_id||!i.description?.trim())pending=true;if(line!==null){subtotal+=line;byAsset.set(i.equipment_id,(byAsset.get(i.equipment_id)||0)+line);}return{...i,line_total:line};});
  if(items.some(i=>i.quantity==null||i.quantity<=0||i.unit_price==null))financial_pending=true;
  subtotal=round(subtotal,p.currency);const rate=amount(p.tax_rate);if(p.tax_mode==='add'&&(rate===null||rate>100)){pending=true;financial_pending=true;}
  const tax=p.tax_mode==='add'?round(subtotal*(rate||0)/100,p.currency):0,total=round(subtotal+tax,p.currency);let allocated=0;
  const allocations=[...byAsset].sort(([a],[b])=>String(a).localeCompare(String(b))).map(([equipment_id,base],i,all)=>{const value=i===all.length-1?round(total-allocated,p.currency):round(subtotal?base/subtotal*total:0,p.currency);allocated=round(allocated+value,p.currency);return{equipment_id,amount:value};});
  return{items,subtotal,tax_amount:tax,total,allocations,pending,financial_pending,source_difference:p.source_total==null?null:round(total-Number(p.source_total),p.currency)};
 }
 const clean=v=>String(v||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim(),identity=v=>clean(v).replace(/[^a-z0-9]/g,'');
 function partyMatch(list,party={}){const matches=list.filter(s=>party.tax_id?identity(s.tax_id)===identity(party.tax_id):party.legal_name&&[s.name,s.legal_name].some(n=>identity(n)===identity(party.legal_name)));return matches.length===1?matches[0]:null;}
 function equipmentMatch(list,source={}){
  const matches=list.filter(a=>a.status!=='inactive'&&[['code',source.code],['serial_number',source.serial_number]].some(([k,v])=>v&&identity(a[k])===identity(v)));
  return matches.length===1&&(!source.serial_number||!matches[0].serial_number||identity(source.serial_number)===identity(matches[0].serial_number))?matches[0]:null;
 }
 function imported(a,assets,suppliers,base=blank(),context={}){
  const r=a.repair||{},p={...base,items:[],currency:a.currency||'',tax_mode:a.tax_mode||'',tax_rate:a.tax_rate??null,source_total:a.source_total??null,quote_number:r.quote_number||a.fields?.reference||'',quote_date:r.quote_date||a.fields?.document_date||'',valid_until:r.valid_until||a.fields?.valid_until||'',payment_terms:r.payment_terms||a.fields?.payment_terms||'',warranty_days:r.warranty_days??null,notes:[...new Set([r.notes,a.fields?.notes,a.fields?.delivery_terms].filter(Boolean))].join('\n'),reviewed:false};
  const supplier=partyMatch(suppliers,r.supplier?.tax_id||r.supplier?.legal_name?r.supplier:a.company);if(supplier)p.supplier_id=supplier.id;
  const recipient=r.recipient?.tax_id||r.recipient?.legal_name?r.recipient:{legal_name:a.fields?.recipient_name,tax_id:a.fields?.recipient_tax_id},company=partyMatch(context.companies||[],recipient);if(company)p.company_id=company.id;
  const detected=r.equipment||[],matches=detected.map(source=>equipmentMatch(assets,source));
  p.items=(a.items||[]).map((i,n)=>{
   const description=[i.description,i.details].filter(Boolean).join(' · '),text=clean(description),explicit=assets.filter(e=>e.status!=='inactive'&&[e.code,e.serial_number].filter(v=>String(v||'').length>=3).some(v=>{const token=clean(v);return new RegExp('(^|[^a-z0-9])'+token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'($|[^a-z0-9])').test(text);}));
   const links=detected.map((d,k)=>d.item_indices?.includes(n)?k:-1).filter(k=>k>=0),linked=links.length===1?matches[links[0]]:null,kinds=(r.item_kinds||[]).filter(k=>k.item_index===n);
   const match=explicit.length===1?explicit[0]:explicit.length===0&&links.length<=1?(linked||(detected.length===1?matches[0]:null)):null;
   return{equipment_id:match?.id||'',kind:kinds.length===1?kinds[0].kind:'labor',description,quantity:i.quantity??null,unit_price:i.unit_price??null};
  });
  const assigned=assets.filter(a=>p.items.some(i=>i.equipment_id===a.id)),wh=[...new Set(assigned.map(a=>a.warehouse_id).filter(Boolean))],co=[...new Set(assigned.map(a=>a.company_id).filter(Boolean))];
  const warehouses=(context.warehouses||[]).filter(w=>w.active!==false),named=warehouses.filter(w=>r.warehouse_name&&[w.name,w.code].some(n=>identity(n)===identity(r.warehouse_name)));
  if(!p.warehouse_id)p.warehouse_id=named.length===1?named[0].id:r.warehouse_name?'':wh.length===1?wh[0]:warehouses.length===1?warehouses[0].id:'';
  if(!p.company_id&&!recipient.tax_id&&!recipient.legal_name)p.company_id=co.length===1?co[0]:(context.companies||[]).length===1?context.companies[0].id:'';
  p.items.forEach(i=>{const e=assets.find(a=>a.id===i.equipment_id);if(e&&(p.warehouse_id&&e.warehouse_id&&p.warehouse_id!==e.warehouse_id||p.company_id&&e.company_id&&p.company_id!==e.company_id))i.equipment_id='';});
  p.problem=r.problem||base.problem||(p.items.length?'Reparación según presupuesto: '+p.items.map(i=>i.description).join(' · ').slice(0,3900):'');
  return p;
 }
 function missing(p){
  const result=[];for(const [key,label] of [['company_id','Empresa'],['warehouse_id','Depósito'],['supplier_id','Taller'],['quote_number','N.º de presupuesto'],['quote_date','Fecha'],['problem','Falla o reparación solicitada'],['currency','Moneda'],['tax_mode','IVA']])if(!p[key])result.push({key,label});
  if(p.tax_mode==='add'&&(p.tax_rate==null||p.tax_rate<0||p.tax_rate>100))result.push({key:'tax_rate',label:'Porcentaje de IVA'});
  (p.items||[]).forEach((i,n)=>{for(const [key,label,bad] of [['equipment_id','Máquina',!i.equipment_id],['description','Trabajo',!i.description?.trim()],['quantity','Cantidad',i.quantity==null||i.quantity<=0],['unit_price','Precio',i.unit_price==null||i.unit_price<0]])if(bad)result.push({key:'line-'+n+'-'+(key==='equipment_id'?'equipment':key==='unit_price'?'price':key),label:label+' · partida '+(n+1)});});
  return result;
 }
 root.AVHRepairModel={states,custody,assetStates,types,day,blank,totals,imported,round,partyMatch,equipmentMatch,missing};
})(globalThis);
