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
 function requirements(p){
  const missing=[],add=(label,target)=>missing.push({label,target}),validDate=v=>/^\d{4}-\d\d-\d\d$/.test(v||'')&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v,decimal=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max&&Number(v.toFixed(6))===v;
  for(const [k,label] of [['title','Título'],['recipient_name','Cliente / destinatario'],['issuer_name','Preparado por'],['payment_terms','Condición de pago'],['delivery_terms','Plazo y condiciones de ejecución']])if(!String(p[k]||'').trim())add(label,'#cd-'+k);
  if(!validDate(p.document_date)||Number(p.document_date.slice(0,4))<2000||Number(p.document_date.slice(0,4))>2100)add('Fecha del presupuesto válida','#cd-document_date');
  if(!validDate(p.valid_until)||p.valid_until<p.document_date)add('Vigencia igual o posterior a la fecha del presupuesto','#cd-valid_until');
  if(!['USD','PYG'].includes(p.currency))add('Moneda','#cd-currency');
  if(!['none','included','add'].includes(p.tax_mode))add('Tratamiento del IVA','#cd-tax_mode');
  if(p.tax_mode!=='none'&&(!decimal(p.tax_rate,0,100)||p.tax_rate===0))add('Porcentaje de IVA, o seleccionar Sin IVA','#cd-tax_rate');
  for(const [k,label] of [['legal_name','Razón social de la empresa emisora'],['tax_id','RUC de la empresa emisora']])if(!String(p.company?.[k]||'').trim())add(label,'#cd-company-'+k);
  if(!p.items?.length||p.items.length>300)add('Entre 1 y 300 trabajos','#cdAdd');
  (p.items||[]).forEach((i,n)=>{const target=k=>`[data-cd-item="${n}"] [data-cd-line="${k}"]`;if(!String(i.description||'').trim()||i.description.length>4000)add(`Ítem ${n+1}: descripción técnica (hasta 4.000 caracteres)`,target('description'));if(!String(i.unit||'').trim()||i.unit.length>50)add(`Ítem ${n+1}: unidad`,target('unit'));if(!decimal(i.quantity,.000001,1000000))add(`Ítem ${n+1}: cantidad y precio · completá una cantidad válida`,target('quantity'));if(!decimal(i.unit_price,0,1000000000))add(`Ítem ${n+1}: cantidad y precio · completá un precio válido`,target('unit_price'));});
  return missing;
 }
 function sourceMatches(p,analysis,links=[]){
  const names=new Map();analysis.items.forEach((i,n)=>{for(const name of new Set([i.source_description||i.description,i.description].map(v=>v.trim()))){if(!names.has(name))names.set(name,[]);names.get(name).push(n);}});
  return p.items.map(item=>{const linked=links.find(l=>l.id===item.id),indices=names.get(item.description.trim())||[],index=linked?.index??(indices.length===1?indices[0]:-1);return Number.isInteger(index)&&index>=0?analysis.items[index]||null:null;});
 }
 function recover(p,analysis,links=[]){
  let count=0;const matches=sourceMatches(p,analysis,links);
  p.items.forEach((item,n)=>{const original=matches[n];if(!original||item.unit_price!=null||original.unit_price==null||original.quantity==null)return;const physical=globalThis.AVHQuoteExcelModel.number(original.source_values?.quantity,p.currency);if(item.quantity!=null&&item.quantity!==original.quantity&&item.quantity!==physical)return;item.quantity=original.quantity;item.unit=original.unit;item.unit_price=original.unit_price;if(original.pricing_basis==='source_amount'&&physical!==original.quantity&&physical!=null)item.description+=` - Cantidad indicada en el original: ${original.source_values.quantity}${original.source_values.unit?' '+original.source_values.unit:''}`;count++;});
  return count;
 }
 window.AVHCommercialModel={totals,draft,requirements,sourceMatches,recover};
})();
