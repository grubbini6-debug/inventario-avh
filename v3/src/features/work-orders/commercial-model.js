(function(){
 const fixed=v=>BigInt(Number(v).toFixed(6).replace('.',''));
 const round=(v,d)=>v>=0n?(v+d/2n)/d:-((-v+d/2n)/d);
 function totals(p){
  const decimals=p.currency==='USD'?2:0,scale=10n**BigInt(decimals),div=1000000000000n/scale;let subtotal=0n,raw=0n,pending=false;
  const items=p.items.map(i=>{if(i.quantity==null||i.unit_price==null){pending=true;return{...i,amount:null};}const product=fixed(i.quantity)*fixed(i.unit_price),amount=round(product,div);raw+=product;subtotal+=amount;return{...i,amount:Number(amount)/Number(scale)};});
  const base=round(raw,div),rate=fixed(p.tax_rate||0),tax=p.tax_mode==='add'?round(base*rate,100000000n):p.tax_mode==='included'?round(base*rate,100000000n+rate):0n;
  return{items,pending,subtotal:Number(subtotal)/Number(scale),rounding_adjustment:Number(base-subtotal)/Number(scale),tax_amount:Number(tax)/Number(scale),total:Number(base+(p.tax_mode==='add'?tax:0n))/Number(scale)};
 }
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Asuncion',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 function draft(kind,order,user){
  const p=order?.issued_payload||order?.payload,items=[];
  if(p&&kind==='quote')for(const t of p.tasks){const measures=[t.length_mm!=null?'Largo '+t.length_mm+' mm':'',t.width_mm!=null?'Ancho '+t.width_mm+' mm':'',t.thickness_mm!=null?'Espesor '+t.thickness_mm+' mm':''].filter(Boolean).join(' / ');items.push({id:crypto.randomUUID(),description:[t.sector,t.description,measures].filter(Boolean).join(' - '),quantity:t.quantity??null,unit:t.unit||'unidad',unit_price:null});}
  if(p&&kind==='purchase_order'){
   const groups=new Map();for(const t of p.tasks)for(const m of t.materials||[]){const key=(m.product_id||m.description.trim().toLowerCase())+'|'+m.unit;if(!groups.has(key))groups.set(key,{id:crypto.randomUUID(),description:m.description,quantity:0,unit:m.unit||'unidad',unit_price:null,pending:false});const g=groups.get(key);if(!m.confirmed||m.quantity==null)g.pending=true;else g.quantity+=Number(m.quantity);}
   for(const g of groups.values()){g.quantity=g.pending?null:Number(g.quantity.toFixed(6));delete g.pending;items.push(g);}
  }
  if(!items.length)items.push({id:crypto.randomUUID(),description:'',quantity:null,unit:'unidad',unit_price:null});
  return{title:(kind==='quote'?'Presupuesto de trabajos':'Adquisición de insumos')+(p?.vessel?' - '+p.vessel:''),document_date:today(),valid_until:'',delivery_date:'',currency:'PYG',tax_mode:'included',tax_rate:0,recipient_name:kind==='quote'?p?.client||'':'',recipient_tax_id:'',recipient_address:'',recipient_contact:'',supplier_id:null,location:p?.location||user?.work_location||'',reference:[order?.number,p?.vessel].filter(Boolean).join(' - '),issuer_name:user?.full_name||user?.username||'',introduction:'',payment_terms:'',delivery_terms:'',notes:'',items};
 }
 window.AVHCommercialModel={totals,draft};
})();
