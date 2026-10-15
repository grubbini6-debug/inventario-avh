// Quotes for Production. Only Administration can create or view purchase orders.
(function(){
 const M=AVHCommercialModel,C={user:null,context:null,documents:[],current:null,dirty:false,busy:false,error:'',kind:'quote',epoch:0};
 const labels={draft:'Borrador',submitted:'Pendiente de autorización',issued:'Emitido',cancelled:'Anulado'},e=esc;
 const allowed=()=>C.user===profile?.id&&['admin','editor'].includes(C.context?.access_level);
 const admin=()=>profile?.role==='admin'&&C.context?.access_level==='admin',editable=()=>C.current?.status==='draft'&&allowed();
 const root=()=>$('#commercialPanel'),payload=()=>C.current?.payload;
 const money=v=>v==null?'Por definir':Number(v).toLocaleString('es-PY',{minimumFractionDigits:payload()?.currency==='USD'?2:0,maximumFractionDigits:payload()?.currency==='USD'?2:0});
 function navigation(){$$('.commercial-nav').forEach(b=>{b.classList.toggle('hide',!allowed());b.style.display=allowed()?'':'none';const label=b.querySelector('span');if(label)label.textContent=admin()?'Presupuestos y OC':'Presupuestos';});document.body.classList.toggle('commercial-authorized',allowed());}
 function error(err){C.error=err?.message||String(err);const el=$('#commercialError');if(el)el.textContent=C.error;}
 async function run(fn,button){if(C.busy)return;const owner=profile?.id;C.busy=true;if(button)button.disabled=true;error('');try{await fn();}catch(err){if(profile?.id===owner)error(err);}finally{if(profile?.id===owner){C.busy=false;if(button?.isConnected)button.disabled=false;}}}
 async function context(){
  const owner=profile?.id;if(C.user!==owner){Object.assign(C,{user:owner,context:null,documents:[],current:null,dirty:false,error:'',busy:false});C.epoch++;}
  if(!['admin','production'].includes(profile?.role)){C.context=null;navigation();return;}
  const r=await rpc('commercial_context');if(profile?.id!==owner)return;
  C.context=r.error?null:r.data;if(!admin()&&C.kind==='purchase_order'){C.kind='quote';C.current=null;C.dirty=false;}if(!allowed()){C.current=null;C.documents=[];C.dirty=false;}navigation();
 }
 async function documents(){const owner=profile?.id,r=await queryAll('commercial_documents','id,kind,number,status,version,created_at,updated_at,title:payload->>title,recipient_name:payload->>recipient_name,reference:payload->>reference','order=created_at.desc');if(profile?.id!==owner)return;if(r.error)throw Error(r.error);C.documents=r.data;}
 async function command(action,data){
  const owner=profile?.id,key='avh_commercial_request:'+owner+':'+action+':'+JSON.stringify(canonicalOperationValue(data));let id;try{id=localStorage.getItem(key)}catch{}id=id||crypto.randomUUID();try{localStorage.setItem(key,id)}catch{}
  const r=await rpc('commercial_command',{p_action:action,p_data:data,p_request_id:id});
  if(!r.network&&r.status!==408&&r.status!==429&&!(r.status>=500))try{localStorage.removeItem(key)}catch{}
  if(profile?.id!==owner)throw Error('La sesión cambió. Volvé a abrir Documentos.');if(r.error)throw Error(r.error);return r.data;
 }
 async function open(id){
  if(C.dirty)throw Error('Guardá el borrador antes de abrir otro documento.');const owner=profile?.id,epoch=++C.epoch,r=await rpc('commercial_document',{p_id:id});if(profile?.id!==owner||epoch!==C.epoch)return;if(r.error)throw Error(r.error);C.current=r.data;if(admin()&&C.current.kind==='purchase_order'&&!C.current.payload.company)C.current.payload.company=structuredClone(C.context.company);C.kind=C.current.kind;render();
 }
 function newDraft(kind,order){
  if(kind==='purchase_order'&&!admin())throw Error('Solo Administración puede crear órdenes de compra.');if(C.dirty)throw Error('Guardá el borrador antes de crear otro documento.');
  C.kind=kind;C.current={id:crypto.randomUUID(),kind,status:'draft',version:null,work_order_id:order?.id||null,payload:M.draft(kind,order,profile)};if(kind==='purchase_order')C.current.payload.company=structuredClone(C.context.company);C.dirty=true;render();
 }
 async function editPurchaseOrder(id){
  if(profile?.role!=='admin')throw Error('Solo Administración puede modificar órdenes de compra.');
  if(C.dirty)throw Error('Guardá los cambios antes de abrir otra orden.');
  const owner=profile.id;await context();if(!admin())throw Error('Solo Administración puede modificar órdenes de compra.');
  const epoch=++C.epoch,r=await rpc('admin_purchase_order_document',{p_purchase_id:id});if(profile?.id!==owner||epoch!==C.epoch)return;if(r.error)throw Error(r.error);
  C.current=r.data;C.kind='purchase_order';C.dirty=false;closeModal();goPage('commercial');render();
 }
 function field(key,label,type='text',attrs=''){return `<div class="field"><label for="cd-${key}">${e(label)}</label><input id="cd-${key}" data-cd-header="${key}" type="${type}" value="${e(payload()[key]??'')}" ${editable()?'':'disabled'} ${attrs}></div>`;}
 function area(key,label){return `<div class="field"><label for="cd-${key}">${e(label)}</label><textarea id="cd-${key}" data-cd-header="${key}" ${editable()?'':'disabled'}>${e(payload()[key]||'')}</textarea></div>`;}
 function companyFields(){
  const c=payload().company||{};
  return `<div class="card"><h3>Empresa emisora</h3><div class="field"><label for="cd-company_id">Empresa del catálogo</label><select id="cd-company_id" ${editable()?'':'disabled'}>${(C.context.companies||[C.context.company]).filter(Boolean).map(x=>`<option value="${e(x.id)}" ${c.id===x.id?'selected':''}>${e(x.name)}</option>`).join('')}</select></div><div class="wo-grid">${[['legal_name','Razón social'],['tax_id','RUC'],['address','Dirección'],['phone','Teléfono'],['email','Correo']].map(([key,label])=>`<div class="field"><label for="cd-company-${key}">${label}</label><input id="cd-company-${key}" data-cd-company="${key}" value="${e(c[key]||'')}" ${editable()?'':'disabled'}></div>`).join('')}</div></div>`;
 }
 function inventoryFields(item){
  if(!C.current.purchase_editor)return '';
  return `<div class="wo-grid"><div class="field"><label>Producto de inventario</label><select data-cd-line="product_id" ${editable()?'':'disabled'}><option value="">Sin producto de catálogo</option>${(window.D?.products||D.products||[]).filter(x=>x.active||x.id===item.product_id).map(x=>`<option value="${e(x.id)}" ${x.id===item.product_id?'selected':''}>${e(x.name)}</option>`).join('')}</select></div><div class="field"><label>Conversión a unidad base</label><input data-cd-line="factor_to_base" type="number" min="0.000001" step="0.000001" value="${e(item.factor_to_base||1)}" ${editable()?'':'disabled'}></div><div class="field"><label><input data-cd-line="affects_inventory" type="checkbox" ${item.affects_inventory?'checked':''} ${editable()?'':'disabled'}> Ingresa a stock</label></div></div>`;
 }
 function list(){
  const host=$('#cdList');if(!host)return;const q=($('#cdSearch')?.value||'').toLowerCase(),state=$('#cdFilter')?.value||'all';
  host.innerHTML=C.documents.filter(d=>d.kind===C.kind&&(admin()||d.kind==='quote')&&(state==='all'||d.status===state)&&[d.number,d.title,d.recipient_name,d.reference].join(' ').toLowerCase().includes(q)).map(d=>`<button class="wo-order ${d.id===C.current?.id?'selected':''}" data-cd-open="${d.id}" type="button"><span class="badge">${e(labels[d.status])}</span><strong>${e(d.number||'Borrador sin emitir')}</strong><span>${e(d.recipient_name||d.title)}</span><small>${e(d.reference||'')}</small></button>`).join('')||'<div class="empty">No hay documentos para este filtro.</div>';
  $$('[data-cd-open]').forEach(b=>b.onclick=()=>run(()=>open(b.dataset.cdOpen),b));
 }
 function lines(){
  return payload().items.map((item,i)=>`<div class="cd-item" data-cd-item="${i}"><div class="cd-item-title"><strong>Ítem ${i+1}</strong>${editable()?`<button class="btn sm" data-cd-remove="${i}" type="button">Quitar</button>`:''}</div><div class="field"><label>Descripción técnica / alcance</label><textarea data-cd-line="description" ${editable()?'':'disabled'}>${e(item.description)}</textarea></div>${inventoryFields(item)}<div class="cd-line-fields">${[['quantity','Cantidad','number'],['unit','Unidad','text'],['unit_price','Precio unitario','number']].map(([k,label,type])=>`<div class="field"><label>${label}</label><input data-cd-line="${k}" type="${type}" value="${e(item[k]??'')}" ${editable()?'':'disabled'} ${type==='number'?'step="0.000001" min="0" placeholder="Por definir"':''}></div>`).join('')}<div class="field"><label>Importe ${e(payload().currency)}</label><output data-cd-amount="${i}"></output></div></div></div>`).join('');
 }
 function documentView(){
  if(!C.current)return '<div class="card empty">'+(admin()?'Elegí un documento o creá un presupuesto o una orden de compra.':'Elegí un presupuesto o creá uno nuevo.')+'</div>';
  const d=C.current,p=payload(),quote=d.kind==='quote';
  return `<div class="wo-document-head"><div><span class="badge">${e(d.purchase_editor?'Revisar OC antes del PDF':labels[d.status]||d.status)}</span><h2>${e(d.number||'Nuevo '+(quote?'presupuesto':'borrador de OC'))}</h2><p>${e(p.reference||'Documento comercial AVH')}</p></div><div class="wo-actions">${editable()?'<button class="btn" id="cdSave" type="button">'+(d.purchase_editor?'Guardar cambios':'Guardar borrador')+'</button>'+(!d.purchase_editor?'<button class="btn" id="cdAi" type="button">Mejorar redacción con IA</button>':''):''}<button class="btn" id="cdPdf" type="button">${d.number?'Descargar PDF para enviar':'Vista previa PDF'}</button>${editable()&&quote?'<button class="btn primary" id="cdIssue" type="button">Emitir presupuesto numerado</button>':''}${admin()&&!quote&&!d.purchase_editor&&['draft','submitted'].includes(d.status)?'<button class="btn primary" id="cdApprove" type="button">Emitir OC numerada</button>':''}${admin()&&d.status==='submitted'?'<button class="btn" id="cdReturn" type="button">Devolver a revisión</button>':''}${!d.purchase_editor&&!['cancelled'].includes(d.status)&&!(d.kind==='purchase_order'&&d.status==='issued')?'<button class="btn" id="cdCancel" type="button">Anular</button>':''}</div></div>
   ${d.review_note?`<div class="wo-review">${e(d.review_note)}</div>`:''}${d.status==='submitted'?'<div class="cd-status">OC enviada a Administración. El PDF definitivo estará disponible cuando sea autorizada.</div>':''}${d.purchase_id?'<p class="hint">OC registrada también en Compras. '+(admin()?'<button class="btn sm" id="cdPurchase" type="button">Ver compra</button>':'')+'</p>':''}
   <div class="card"><h3>Datos del documento</h3><div class="wo-grid">${!quote&&admin()?field('document_number','Número de OC (automático si se deja vacío)'):''}${field('title','Título')}${field('document_date','Fecha','date')}${field('reference','OT / proyecto / referencia')}${field('location','Lugar')}${field('issuer_name','Preparado por')}${quote?field('valid_until','Válido hasta','date'):field('delivery_date','Entrega prevista','date')}</div></div>
   ${!quote&&admin()?companyFields():''}<div class="card"><h3>${quote?'Cliente / destinatario':'Proveedor'}</h3>${!quote?`<div class="field"><label for="cd-supplier_id">Proveedor del catálogo</label><select id="cd-supplier_id" ${editable()?'':'disabled'}><option value="">Seleccionar proveedor</option>${(C.context.suppliers||[]).map(s=>`<option value="${s.id}" ${p.supplier_id===s.id?'selected':''}>${e(s.name)}</option>`).join('')}</select><p class="hint">Administración puede registrar proveedores nuevos desde Proveedores.</p></div>`:''}<div class="wo-grid">${field('recipient_name',quote?'Razón social / nombre':'Razón social del proveedor')}${field('recipient_tax_id','RUC / identificación')}${field('recipient_contact','Contacto')}${field('recipient_address','Dirección')}</div>${area('introduction','Presentación / alcance para el destinatario')}</div>
   <div class="card"><h3>Importes</h3><div class="wo-grid"><div class="field"><label for="cd-currency">Moneda</label><select id="cd-currency" data-cd-header="currency" ${editable()?'':'disabled'}><option value="PYG" ${p.currency==='PYG'?'selected':''}>Guaraníes (PYG)</option><option value="USD" ${p.currency==='USD'?'selected':''}>Dólares (USD)</option></select></div><div class="field"><label for="cd-tax_mode">Tratamiento del IVA</label><select id="cd-tax_mode" data-cd-header="tax_mode" ${editable()?'':'disabled'}>${!quote?'<option value="unspecified" '+(p.tax_mode==='unspecified'?'selected':'')+'>Según presupuesto de referencia</option>':''}<option value="included" ${p.tax_mode==='included'?'selected':''}>IVA incluido en los precios</option><option value="add" ${p.tax_mode==='add'?'selected':''}>Agregar IVA al subtotal</option><option value="none" ${p.tax_mode==='none'?'selected':''}>Sin IVA</option></select></div>${field('tax_rate','IVA (%)','number','min="0" max="100" step="0.000001"')}</div><p class="hint">Confirmá precios, cantidades e impuestos antes de emitir. Los campos sin precio quedan pendientes.</p><div id="cdItems">${lines()}</div>${editable()?'<button class="btn" id="cdAdd" type="button">+ Agregar ítem</button>':''}<div class="cd-totals" id="cdTotals" aria-live="polite"></div></div>
   <div class="card"><h3>Condiciones para enviar</h3>${area('payment_terms','Condición de pago')}${area('delivery_terms','Plazo y condiciones de entrega / ejecución')}${area('notes','Observaciones visibles en el PDF')}</div>`;
 }
 function updateTotals(){
  if(!payload())return;try{const t=M.totals(payload());t.items.forEach((i,n)=>{const el=$('[data-cd-amount="'+n+'"]');if(el)el.textContent=money(i.amount);});$('#cdTotals').textContent=t.pending?'Total pendiente: completá cantidades y precios.':'Subtotal '+payload().currency+' '+money(t.subtotal)+(t.rounding_adjustment?' · Ajuste de redondeo '+money(t.rounding_adjustment):'')+(payload().tax_mode==='add'?' · IVA '+money(t.tax_amount):payload().tax_mode==='included'?' · IVA incluido '+money(t.tax_amount):payload().tax_mode==='none'?' · Sin IVA':' · Impuestos según presupuesto')+' · TOTAL '+payload().currency+' '+money(t.total);}catch{$('#cdTotals').textContent='Revisá los importes.';}
 }
 function render(){
  if(!root())return;if(!allowed()){root().innerHTML='<div class="card">Documentos comerciales requiere una cuenta de Producción habilitada o de Administración.</div>';return;}
  root().innerHTML=`<div class="wo-heading"><div><div class="eyebrow">DOCUMENTOS AVH</div><h2>${admin()?'Presupuestos y órdenes de compra':'Presupuestos'}</h2><p>Documentos numerados con membrete institucional, listos para descargar y enviar.</p></div><div class="wo-actions"><button class="btn primary" id="cdNewQuote" type="button">+ Presupuesto</button>${admin()?'<button class="btn" id="cdNewOc" type="button">+ Orden de compra</button>':''}</div></div><div id="commercialError" class="error" role="alert">${e(C.error)}</div><div class="wo-tabs"><button class="btn ${C.kind==='quote'?'primary':''}" data-cd-kind="quote">Presupuestos</button>${admin()?'<button class="btn '+(C.kind==='purchase_order'?'primary':'')+'" data-cd-kind="purchase_order">Órdenes de compra</button>':''}</div><div class="wo-layout"><aside class="wo-sidebar card"><div class="field"><label for="cdSearch">Buscar documentos</label><input id="cdSearch" type="search" placeholder="Número, cliente, proyecto"></div><select id="cdFilter" aria-label="Estado"><option value="all">Todos los estados</option>${Object.entries(labels).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select><div id="cdList"></div></aside><div class="cd-document">${documentView()}</div></div>`;
  list();$('#cdSearch').oninput=list;$('#cdFilter').onchange=list;
  $('#cdNewQuote').onclick=()=>run(()=>newDraft('quote'));$('#cdNewOc')?.addEventListener('click',()=>run(()=>newDraft('purchase_order')));
  $$('[data-cd-kind]').forEach(b=>b.onclick=()=>{if(b.dataset.cdKind==='purchase_order'&&!admin())return;if(C.dirty)return error('Guardá el borrador antes de cambiar de apartado.');C.kind=b.dataset.cdKind;C.current=null;render();});
  $$('[data-cd-header]').forEach(el=>el.oninput=()=>{if(!editable())return;payload()[el.dataset.cdHeader]=el.type==='number'?(el.value===''?null:Number(el.value)):el.value;C.dirty=true;updateTotals();});
  $$('[data-cd-company]').forEach(el=>el.oninput=()=>{if(!editable()||!admin())return;payload().company[el.dataset.cdCompany]=el.value;C.dirty=true;});
  $('#cd-company_id')?.addEventListener('change',evt=>{if(!editable()||!admin())return;const company=(C.context.companies||[]).find(c=>c.id===evt.target.value);if(company){payload().company=structuredClone(company);C.dirty=true;render();}});
  $('#cd-supplier_id')?.addEventListener('change',evt=>{const s=C.context.suppliers.find(s=>s.id===evt.target.value);payload().supplier_id=s?.id||null;payload().recipient_name=s?.name||'';payload().recipient_tax_id=s?.tax_id||'';payload().recipient_contact=s?.phone||'';C.dirty=true;render();});
  $$('[data-cd-item]').forEach(el=>el.querySelectorAll('[data-cd-line]').forEach(input=>input.oninput=()=>{const item=payload().items[Number(el.dataset.cdItem)],k=input.dataset.cdLine;if(!editable())return;item[k]=input.type==='checkbox'?input.checked:input.type==='number'?(input.value===''?null:Number(input.value)):input.value;C.dirty=true;updateTotals();}));
  $$('[data-cd-remove]').forEach(b=>b.onclick=()=>{payload().items.splice(Number(b.dataset.cdRemove),1);C.dirty=true;render();});
  $('#cdAdd')?.addEventListener('click',()=>{payload().items.push({id:crypto.randomUUID(),description:'',unit:'unidad',quantity:null,unit_price:null});C.dirty=true;render();});
  $('#cdSave')?.addEventListener('click',evt=>run(save,evt.target));
  $('#cdPdf')?.addEventListener('click',evt=>run(async()=>{if(C.dirty||!C.current.version)await save();if(C.current.kind==='purchase_order'&&C.current.purchase_id&&!C.current.purchase_editor)return editPurchaseOrder(C.current.purchase_id);const owner=profile?.id,id=C.current.id,r=C.current.purchase_editor?await edge('purchase-order-pdf',{purchase_id:C.current.purchase_id,expected_version:C.current.version}):await edge('commercial-pdf',{document_id:id});if(profile?.id!==owner||C.current?.id!==id)return;if(r.error)throw Error(r.error);if(!r.data?.pdf_base64)throw Error('El PDF no pudo generarse.');const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(r.data.pdf_base64),c=>c.charCodeAt(0))],{type:'application/pdf'})),a=document.createElement('a');a.href=url;a.download=r.data.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);},evt.target));
  for(const [id,action] of [['#cdIssue','issue'],['#cdApprove','issue']])$(id)?.addEventListener('click',evt=>run(async()=>{if(C.dirty||!C.current.version)await save();const id=C.current.id;await open(id);if(C.current.number)return;await command(action,{document_id:id,expected_version:C.current.version});await documents();await open(id);},evt.target));
  for(const [id,action] of [['#cdCancel','cancel'],['#cdReturn','return']])$(id)?.addEventListener('click',()=>{const reason=window.prompt(action==='return'?'Motivo de devolución a revisión':'Motivo de anulación');if(reason)void run(async()=>{await command(action,{document_id:C.current.id,expected_version:C.current.version,reason});C.dirty=false;await documents();await open(C.current.id);});});
  $('#cdAi')?.addEventListener('click',evt=>run(improve,evt.target));
  $('#cdPurchase')?.addEventListener('click',()=>{if(admin())openPurchaseDetail(C.current.purchase_id);});
  $$('textarea[data-cd-header],textarea[data-cd-line]').forEach(el=>{const fit=()=>{el.style.height='auto';el.style.height=Math.max(76,el.scrollHeight+4)+'px';};el.addEventListener('input',fit);fit();});updateTotals();
 }
 async function save(){
  if(C.current.purchase_editor){
   if(!admin())throw Error('Solo Administración puede modificar órdenes de compra.');
   const owner=profile.id,data={p_purchase_id:C.current.purchase_id,p_payload:payload(),p_expected_version:C.current.version},key='avh_po_review:'+owner+':'+JSON.stringify(canonicalOperationValue(data));
   let requestId;try{requestId=localStorage.getItem(key)}catch{}requestId=requestId||crypto.randomUUID();try{localStorage.setItem(key,requestId)}catch{}
   const r=await rpc('admin_save_purchase_order_document',{...data,p_request_id:requestId});
   if(!r.network&&r.status!==408&&r.status!==429&&!(r.status>=500))try{localStorage.removeItem(key)}catch{}
   if(profile?.id!==owner)throw Error('La sesión cambió. Volvé a abrir la OC.');if(r.error)throw Error(r.error);
   C.current=r.data;C.dirty=false;await loadAll(true);render();return;
  }
  const id=C.current.id;await command('save',{document_id:id,kind:C.current.kind,expected_version:C.current.version,work_order_id:C.current.work_order_id,payload:payload()});C.dirty=false;await documents();await open(id);
 }
 async function improve(){
  if(C.dirty||!C.current.version)await save();const id=C.current.id,version=C.current.version,owner=profile?.id;
  const r=await edge('commercial-ai',{document_id:id});if(profile?.id!==owner||C.current?.id!==id||C.current?.version!==version)return;if(r.error)throw Error(r.error);
  const suggestion=r.data?.suggestion;if(!suggestion)throw Error('La IA no devolvió una propuesta.');
  openModal('Revisar redacción de IA','Las cantidades, precios, impuestos y condiciones se conservan.',`<h3>${e(suggestion.title)}</h3><p>${e(suggestion.introduction)}</p><div class="cd-ai-review">${suggestion.items.map(i=>`<p>${e(i.description)}</p>`).join('')}</div><button class="btn primary" id="cdApplyAi" type="button">Aplicar redacción</button>`);
  $('#cdApplyAi').onclick=()=>{if(C.current?.id!==id||C.current?.version!==version||profile?.id!==owner)return closeModal();payload().title=suggestion.title;payload().introduction=suggestion.introduction;const descriptions=new Map(suggestion.items.map(i=>[i.id,i.description]));payload().items.forEach(i=>{if(descriptions.has(i.id))i.description=descriptions.get(i.id);});C.dirty=true;closeModal();render();};
 }
 async function refresh(){await context();if(allowed()&&$('#page-commercial')?.classList.contains('on')&&!C.dirty&&!C.busy&&canRefreshView('#page-commercial')){await documents();if(C.current?.purchase_editor)await editPurchaseOrder(C.current.purchase_id);else if(C.current?.version)await open(C.current.id);else render();}else if(!allowed()&&$('#page-commercial')?.classList.contains('on'))render();}
 const go=window.goPage;window.goPage=function(name){if(name==='commercial'&&!allowed())return;const r=go.call(this,name);if(name==='commercial'){render();void run(async()=>{await documents();list();});}return r;};
 const load=window.loadAll;window.loadAll=async function(){const r=await load.apply(this,arguments);await refresh();return r;};
 window.AVHCommercial={state:C,refresh,editPurchaseOrder,fromWorkOrder:async(order,kind)=>{await context();if(!allowed())throw Error('Se requiere el perfil Producción o Administración.');newDraft(kind,order);goPage('commercial');}};
})();
