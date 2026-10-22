// Repair quotes use the same purchase and editable OC as Compras. Equipment is descriptive only.
(function(root){
 const M=root.AVHRepairModel;
 function missing(p){
  const result=[];
  for(const [key,label] of [['company_id','Empresa'],['supplier_id','Taller'],['currency','Moneda'],['tax_mode','IVA']])if(!p[key])result.push({key,label});
  if(p.tax_mode==='add'&&(p.tax_rate==null||p.tax_rate<0||p.tax_rate>100))result.push({key:'tax_rate',label:'Porcentaje de IVA'});
  if(!p.items?.length)result.push({key:'items',label:'Trabajos del presupuesto'});
  (p.items||[]).forEach((i,n)=>{for(const [key,label,bad] of [['description','Trabajo',!i.description?.trim()],['quantity','Cantidad',i.quantity==null||i.quantity<=0],['unit','Unidad',!i.unit?.trim()],['price','Precio',i.unit_price==null||i.unit_price<0]])if(bad)result.push({key:'line-'+n+'-'+key,label:label+' · partida '+(n+1)});});
  return result;
 }
 const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 const sameUser=id=>{if(profile?.id!==id||!profile.active||profile.role!=='admin')throw Error('La sesión cambió. Volvé a abrir la compra.');};
 function sourceDocument(a){
  if(!a)return null;const p=M.imported(a,[],[]),t=M.totals(p),r=a.repair||{},supplier=r.supplier||a.company||{},recipient=r.recipient||{},items=p.items.map(i=>({description:i.description,quantity:i.quantity,unit:i.unit,unit_price:i.unit_price}));
  if(!t.financial_pending&&p.tax_mode==='add'&&t.tax_amount>0)items.push({description:'IVA '+p.tax_rate+'%',quantity:1,unit:'servicio',unit_price:t.tax_amount});
  return{...a,document_type:'quotation',document_number:p.quote_number||null,date:p.quote_date||null,supplier_name:supplier.legal_name||null,supplier_tax_id:supplier.tax_id||null,customer_name:recipient.legal_name||null,customer_tax_id:recipient.tax_id||null,total:a.source_total??a.calculated_total??(t.financial_pending?null:t.total),items};
 }
 async function create(p,files,analysis,attempt){
  const user=profile?.id;sameUser(user);
  if(!attempt.args){
   const pending=missing(p);if(pending.length)throw Error('Completá: '+pending.map(x=>x.label).join(', ')+'.');
   const totals=M.totals(p);if(totals.financial_pending)throw Error('Completá los importes del presupuesto.');
   if(totals.source_difference!==null&&totals.source_difference!==0)throw Error('El total no coincide con el original. Revisá IVA, cantidades y precios.');
   const data={};for(const key of ['company_id','supplier_id','currency','tax_mode','tax_rate','source_total','quote_number','quote_date','valid_until','problem','payment_terms','notes','warranty_days','machine_name','serial_number','destination_text'])data[key]=p[key]??null;
   data.source_files=await Promise.all(files.map(async f=>({name:f.name,sha256:await hash(await f.arrayBuffer())})));
   const items=p.items.map(i=>({description:i.description,quantity:i.quantity,unit:i.unit,unit_price:i.unit_price})),key='avh_service_po:'+user+':'+await hash(new TextEncoder().encode(JSON.stringify(canonicalOperationValue({data,items}))));
   sameUser(user);let requestId;try{requestId=localStorage.getItem(key)}catch{}requestId=requestId||crypto.randomUUID();try{localStorage.setItem(key,requestId)}catch{}
   attempt.key=key;attempt.args={p_data:data,p_items:items,p_request_id:requestId};
  }
  if(!attempt.result){
   const r=await rpc('admin_create_service_purchase_from_quote',attempt.args);sameUser(user);
   if(r.error){const uncertain=r.network||[408,429].includes(r.status)||r.status>=500;if(!uncertain){if(/OC anterior fue eliminada/.test(r.error)){try{localStorage.removeItem(attempt.key)}catch{}}delete attempt.args;}throw Error(uncertain?'No llegó la confirmación. Tocá Generar OC de nuevo para recuperar la misma orden.':r.error);}
   if(!r.data?.purchase_id)throw Error('No llegó el identificador de la OC. Reintentá para recuperar la misma orden.');attempt.result=r.data;
  }
  const id=attempt.result.purchase_id;
  for(let n=0;n<files.length;n++){
   const f=files[n],source=attempt.args.p_data.source_files[n],path=`${id}/quotation/${source.sha256}_${f.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g,'_')}`;
   const stored=await request('/storage/v1/object/purchase-documents/'+path,{method:'POST',headers:{'Content-Type':f.type||'application/octet-stream','x-upsert':'false'},body:f});sameUser(user);
   if(stored.error&&!/already exists|duplicate/i.test(stored.error))throw Error('La OC '+attempt.result.po_number+' ya está creada. Reintentá para adjuntar '+f.name+': '+stored.error);
   const existing=await query('purchase_documents','id','purchase_id=eq.'+id+'&file_path=eq.'+encodeURIComponent(path));sameUser(user);if(existing.error)throw Error(existing.error);
   if(!existing.data?.length){const r=await insert('purchase_documents',{purchase_id:id,kind:'quotation',file_path:path,file_name:f.name,document_number:p.quote_number||null,document_date:p.quote_date||null,analysis_status:analysis?'ok':null,analysis_data:sourceDocument(analysis),analyzed_at:analysis?new Date().toISOString():null,uploaded_by:user});sameUser(user);if(r.error)throw Error('La OC ya está creada. Reintentá para archivar su presupuesto: '+r.error);}
  }
  return attempt.result;
 }
 root.AVHRepairPurchase={missing,create,sourceDocument};
})(globalThis);
