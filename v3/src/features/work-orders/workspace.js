// Workspace authorization and issued document numbers are enforced in PostgreSQL.
(function(){
 const M=AVHWorkOrderModel,states={draft:'Borrador',issued:'Emitida',in_progress:'En ejecución',closed:'Cerrada',cancelled:'Anulada'};
 const W={user:null,context:null,orders:[],current:null,dirty:false,followDirty:false,busy:false,file:null,book:null,error:'',tab:'scope',opened:new Set(),epoch:0};
 const allowed=()=>!!W.context?.access_level,editor=()=>['admin','editor'].includes(W.context?.access_level),quality=()=>['admin','quality'].includes(W.context?.access_level);
 const e=esc,empty=t=>`<div class="empty">${e(t)}</div>`,value=v=>v==null?'':v;
 const readonly=()=>W.current?.status!=='draft'||!editor();
 const current=()=>W.current?.payload;
 const field=(key,label,v,type='text',attrs='')=>`<div class="field"><label for="wo-${key}">${e(label)}</label><input id="wo-${key}" data-header="${key}" type="${type}" value="${e(value(v))}" ${readonly()?'disabled':''} ${attrs}></div>`;
 const area=(key,label,v)=>`<div class="field"><label for="wo-${key}">${e(label)}</label><textarea id="wo-${key}" data-header="${key}" ${readonly()?'disabled':''}>${e(v||'')}</textarea></div>`;
 function error(t){W.error=t?.message||String(t);const el=$('#woError');if(el)el.innerHTML=`<div class="error" role="alert">${e(W.error)}</div>`;if(!$('#modal')?.classList.contains('hide')){let m=$('#woModalError');if(!m){m=document.createElement('div');m.id='woModalError';$('#modalBody')?.appendChild(m);}m.innerHTML=`<div class="error" role="alert">${e(W.error)}</div>`;}}
 function navigation(){
  $$('.work-orders-nav').forEach(b=>{b.classList.toggle('hide',!allowed());b.style.display=allowed()?'':'none';});
  document.body.classList.toggle('work-orders-authorized',allowed());
  document.body.classList.toggle('production-mode',profile?.role==='production');
 }
 async function context(){
  if(!profile)return;
  const user=profile.id;
  if(W.user!==user){Object.assign(W,{user,context:null,orders:[],current:null,dirty:false,busy:false,file:null,book:null,error:'',tab:'scope'});W.epoch++;W.opened.clear();}
  const r=await rpc('work_order_context');if(profile?.id!==user)return;
  const was=allowed();W.context=r.error?null:r.data;navigation();if(profile.role==='production'&&!$('#page-work-orders')?.classList.contains('on')&&!$('#page-help')?.classList.contains('on')&&!$('#page-production-inventory')?.classList.contains('on')&&!$('#page-commercial')?.classList.contains('on'))goPage('work-orders');if($('#page-work-orders')?.classList.contains('on')&&(!allowed()||!was))render();
 }
 async function orders(){
  const user=profile?.id,r=await queryAll('work_orders','id,number,status,version,created_at,updated_at,title:payload->>title,vessel:payload->>vessel,client:payload->>client','order=created_at.desc');
  if(profile?.id!==user)return;if(r.error)throw Error(r.error);W.orders=r.data;
 }
 async function command(action,data){
  const user=profile?.id,key=`avh_ot_request:${user}:${action}:${JSON.stringify(canonicalOperationValue(data))}`;
  let id;try{id=localStorage.getItem(key)}catch{}id=id||crypto.randomUUID();try{localStorage.setItem(key,id)}catch{}
  const r=await rpc('work_order_command',{p_action:action,p_data:data,p_request_id:id});
  if(!r.network&&r.status!==408&&r.status!==429&&!(r.status>=500))try{localStorage.removeItem(key)}catch{}
  if(profile?.id!==user)throw Error('La sesión cambió. Volvé a abrir Órdenes de Trabajo.');if(r.error)throw Error(r.error);return r.data;
 }
 async function run(fn,button){
  if(W.busy)return;const owner=profile?.id;W.busy=true;if(button)button.disabled=true;W.error='';
  try{await fn();}catch(err){if(profile?.id===owner)error(err);}finally{if(profile?.id===owner){W.busy=false;if(button)button.disabled=false;}}
 }
 function newDraft(analysis){
  W.current={id:crypto.randomUUID(),status:'draft',version:null,payload:M.draft(analysis||{title:'Orden de trabajo naval',tasks:[]},null)};
  W.current.payload.warehouse_id=profile?.inventory_warehouse_id||profile?.warehouse_id||'';W.current.payload.location=W.current.payload.location||profile?.work_location||'';W.current.payload.responsible=profile?.username||'';W.dirty=true;W.tab='scope';W.file=null;W.book=null;W.opened.clear();render();
 }
 async function open(id){
  if(W.dirty)return error('Guardá el borrador actual antes de abrir otra orden.');
  const owner=profile?.id,epoch=++W.epoch,r=await query('work_orders','*',`id=eq.${id}`);
  if(owner!==profile?.id||epoch!==W.epoch)return;if(r.error)throw Error(r.error);if(!r.data?.[0])throw Error('Orden inexistente o sin acceso.');
  W.current=r.data[0];W.file=null;W.book=null;W.tab='scope';W.opened.clear();
  const results=await Promise.all([query('work_order_progress','*',`order_id=eq.${id}`),query('work_order_quality','*',`order_id=eq.${id}&order=created_at.desc,id.desc`),query('work_order_events','action,actor_id,created_at,request_data',`order_id=eq.${id}&order=created_at.desc&limit=100`)]);
  if(owner!==profile?.id||epoch!==W.epoch)return;const failed=results.find(x=>x.error);if(failed)throw Error(failed.error);
  [W.current.progress,W.current.quality,W.current.events]=results.map(x=>x.data);W.followDirty=false;render();
 }
 function list(){
  const q=($('#woSearch')?.value||'').toLowerCase(),status=$('#woFilter')?.value||'all';
  const rows=W.orders.filter(o=>(status==='all'||o.status===status)&&[o.number,o.title,o.vessel,o.client].join(' ').toLowerCase().includes(q));
  $('#woList').innerHTML=rows.map(o=>`<button type="button" class="wo-order ${o.id===W.current?.id?'selected':''}" data-order="${o.id}"><span class="badge ${o.status==='closed'?'green':o.status==='cancelled'?'red':'amber'}">${e(states[o.status])}</span><strong>${e(o.number||'Borrador sin emitir')}</strong><span>${e(o.vessel||o.title)}</span><small>${e(o.client||'Cliente pendiente')}</small></button>`).join('')||empty('No hay órdenes para este filtro.');
  $$('[data-order]').forEach(b=>b.onclick=()=>run(()=>open(b.dataset.order),b));
 }
 function taskView(t,index){
  const p=W.current.progress?.find(x=>x.task_id===t.id),qc=W.current.quality?.find(x=>x.task_id===t.id),disabled=readonly()?'disabled':'';
  const input=(key,label,type='number')=>`<div class="field"><label>${e(label)}</label><input data-task-key="${key}" type="${type}" value="${e(value(t[key]))}" ${disabled} ${type==='number'?'min="0" step="any"':''}></div>`;
  return `<details class="wo-task" data-task="${e(t.id)}" ${W.opened.has(t.id)?'open':''}><summary><span class="wo-item-number">${index+1}</span><span><small>${e(t.sector||'General')}</small><strong>${e(t.description)}</strong><small>${t.weight_kg!=null?fmt(t.weight_kg)+' kg · ':''}${t.quantity!=null?fmt(t.quantity)+' '+e(t.unit):'Cantidad por revisar'}${p?' · Avance '+fmt(p.percent)+'%':''}${qc?' · Calidad: '+e({approved:'Aprobado',rework:'Retrabajo',rejected:'Rechazado'}[qc.result]):''}</small></span></summary><div class="wo-task-body">
   <div class="field"><label>Descripción del trabajo</label><textarea data-task-key="description" ${disabled}>${e(t.description)}</textarea></div>
   <div class="wo-grid">${input('sector','Sector','text')}${input('unit','Unidad','text')}${input('quantity','Cantidad')}${input('length_mm','Largo (mm)')}${input('width_mm','Ancho (mm)')}${input('thickness_mm','Espesor (mm)')}${input('area_m2','Área por pieza (m²)')}${input('weight_kg','Peso total (kg)')}</div>
   <div class="two"><div class="field"><label>Operaciones propuestas</label><textarea data-task-key="operations" ${disabled}>${e((t.operations||[]).join('\n'))}</textarea></div><div class="field"><label>Controles propuestos</label><textarea data-task-key="acceptance" ${disabled}>${e((t.acceptance||[]).join('\n'))}</textarea></div></div>
   <h3>Materiales e insumos de este trabajo</h3><p class="hint">Revisá la unidad y confirmá la cantidad cuando esté definida.</p>
   ${(t.materials||[]).map((m,i)=>`<div class="wo-material" data-material="${i}"><div class="wo-material-grid"><div class="field"><label>Insumo</label><input data-material-key="description" value="${e(m.description)}" ${disabled}></div><div class="field"><label>Cantidad</label><input data-material-key="quantity" type="number" min="0" step="any" value="${e(value(m.quantity))}" placeholder="Por definir" ${disabled}></div><div class="field"><label>Unidad</label><input data-material-key="unit" value="${e(m.unit)}" ${disabled}></div></div>
    <div class="field"><label>Producto del catálogo</label><select data-material-key="product_id" ${disabled}><option value="">Pendiente de vincular</option>${D.products.filter(p=>p.active).map(p=>`<option value="${p.id}" ${p.id===m.product_id?'selected':''}>${e(p.name)} · ${e(p.base_unit)}</option>`).join('')}</select></div>
    <div class="field"><label>Base del requerimiento</label><input data-material-key="basis" value="${e(m.basis||'')}" ${disabled}></div><label class="wo-check"><input type="checkbox" data-material-key="confirmed" ${m.confirmed?'checked':''} ${disabled}> Cantidad confirmada por el responsable</label>${!readonly()?`<button class="btn sm" type="button" data-remove-material="${i}">Quitar insumo</button>`:''}</div>`).join('')||empty('Sin insumos registrados para este trabajo.')}
   ${!readonly()?`<button class="btn sm soft" type="button" data-add-material="${e(t.id)}">+ Agregar insumo</button><button class="btn sm" type="button" data-remove-task="${e(t.id)}">Quitar trabajo</button>`:''}
   ${['issued','in_progress'].includes(W.current.status)?`<div class="wo-follow"><h3>Seguimiento del trabajo</h3>${editor()?`<div class="two"><div class="field"><label>Avance (%)</label><input data-progress type="number" min="0" max="100" value="${e(value(p?.percent))}"></div><div class="field"><label>Actividad / observación</label><input data-progress-notes value="${e(p?.notes||'')}"></div></div><button class="btn sm primary" data-save-progress type="button">Registrar avance</button>`:''}${quality()?`<div class="two"><div class="field"><label>Resultado de inspección</label><select data-quality><option value="approved">Aprobado</option><option value="rework">Retrabajo</option><option value="rejected">Rechazado</option></select></div><div class="field"><label>Inspección realizada</label><input data-quality-notes></div></div><button class="btn sm" data-save-quality type="button">Registrar Calidad</button>`:''}</div>`:''}
  </div></details>`;
 }
 function materialGroups(){
  const groups=new Map();current().tasks.forEach((t,index)=>(t.materials||[]).forEach(m=>{
   const key=(m.product_id||m.description.toLowerCase())+'|'+m.unit;
   if(!groups.has(key))groups.set(key,{name:D.products.find(p=>p.id===m.product_id)?.name||m.description,product_id:m.product_id,unit:m.unit,defined:0,definedCount:0,confirmed:0,confirmedCount:0,pending:0,tasks:[]});
   const g=groups.get(key);g.tasks.push(index+1);if(m.quantity==null)g.pending++;else{g.defined+=Number(m.quantity);g.definedCount++;if(m.confirmed){g.confirmed+=Number(m.quantity);g.confirmedCount++;}}
  }));return [...groups.values()];
 }
 function bom(){
  const p=current(),access=profile.role==='admin'||(profile.role==='depositor'&&!!profile.warehouse_id&&p.warehouse_id===profile.warehouse_id),requester=profile.role==='depositor'&&p.warehouse_id===profile.warehouse_id;
  const rows=materialGroups().map((g,i)=>{
   const product=D.products.find(x=>x.id===g.product_id),productionStock=profile.role==='production'&&product&&product.base_unit===g.unit?window.AVHProductionInventory?.stock(product.id,p.warehouse_id):null,stock=productionStock!=null?productionStock:access&&p.warehouse_id&&product&&product.base_unit===g.unit?Number(D.stocks.find(x=>x.warehouse_id===p.warehouse_id&&x.product_id===product.id)?.stock_qty||0):null;
   const missing=stock===null||!g.confirmedCount?null:Math.max(0,g.confirmed-stock);
   return '<tr><td>'+e(g.name)+'<small>Trabajos '+g.tasks.join(', ')+'</small></td><td>'+(g.definedCount?fmt(g.defined)+' '+e(g.unit):'Por definir')+(g.pending?'<small>'+g.pending+' cantidades pendientes</small>':'')+'</td><td>'+(g.confirmedCount?fmt(g.confirmed)+' '+e(g.unit):'Por confirmar')+'</td><td>'+(stock===null?'Sin consulta':fmt(stock)+' '+e(g.unit))+'</td><td>'+(missing===null?'Por revisar':fmt(missing)+' '+e(g.unit))+'</td><td>'+(editor()&&requester&&g.confirmedCount&&(missing===null||missing>0)?'<button type="button" class="btn sm" data-group-supply="'+i+'">Preparar solicitud</button>':'')+'</td></tr>';
  });
  return '<div class="card"><h3>Requerimientos acumulados por producto</h3><p class="hint">Se suman los insumos de todos los trabajos de la orden. Las cantidades por definir siguen pendientes. La consulta de stock depende del permiso de depósito de la cuenta.</p><div class="wo-table-wrap"><table class="wo-table"><thead><tr><th>Material e ítems</th><th>Cantidad definida</th><th>Confirmada</th><th>Stock registrado</th><th>Faltante confirmado</th><th></th></tr></thead><tbody>'+ (rows.join('')||'<tr><td colspan="6">Sin insumos registrados.</td></tr>')+'</tbody></table></div></div>';
 }
 function documentView(){
  if(!W.current)return empty('Subí un Excel o abrí una orden para trabajar.');
  const o=W.current,p=o.payload;
  return `<div class="wo-document-head"><div><span class="badge">${e(states[o.status])}</span><h2>${e(o.number||'Nueva orden · borrador')}</h2><p>${e(p.vessel||'Embarcación por definir')}</p></div><div class="wo-actions">${!readonly()?'<button class="btn" id="woSave" type="button">Guardar borrador</button><button class="btn primary" id="woIssue" type="button">Emitir OT numerada</button>':''}${o.number?'<button class="btn primary" id="woPdf" type="button">Descargar OT</button>':''}${!o.number&&editor()?'<button class="btn" id="woPreview" type="button">Vista previa OT</button>':''}${o.source_file_path?'<button class="btn" id="woSource" type="button">Excel original</button>':''}${editor()&&['issued','in_progress'].includes(o.status)?'<button class="btn" id="woClose" type="button">Cerrar orden</button>':''}${editor()&&!['closed','cancelled'].includes(o.status)?'<button class="btn" id="woCancel" type="button">Anular</button>':''}</div></div>
   ${editor()&&['admin','production'].includes(profile.role)?'<div class="wo-actions cd-from-order"><button class="btn" id="woQuote" type="button">Crear presupuesto desde esta OT</button>'+(profile.role==='admin'?'<button class="btn" id="woPurchaseOrder" type="button">Crear OC de insumos</button>':'')+'</div>':''}<p class="hint">La OT comunica los trabajos a ejecutar. Insumos, presupuestos y órdenes de compra se revisan por separado.</p><div class="wo-tabs"><button class="btn ${W.tab==='scope'?'primary':''}" data-wo-tab="scope">Orden y trabajos</button><button class="btn ${W.tab==='materials'?'primary':''}" data-wo-tab="materials">Insumos internos</button><button class="btn ${W.tab==='history'?'primary':''}" data-wo-tab="history">Historial</button></div>
   ${W.tab==='materials'?bom():W.tab==='history'?`<div class="list">${(o.events||[]).map(x=>`<div class="row"><strong>${e({save:'Borrador guardado',issue:'Orden emitida',progress:'Avance registrado',quality:'Inspección de Calidad',attachment:'Excel archivado',close:'Orden cerrada',cancel:'Orden anulada'}[x.action]||x.action)}</strong><div class="subtext">${dt(x.created_at)}</div><p>${e(x.request_data.notes||x.request_data.observations||x.request_data.reason||'')}</p></div>`).join('')||empty('Sin eventos registrados.')}</div>`:`
   <div class="card"><div class="wo-grid">${field('title','Título',p.title)}${field('vessel','Embarcación',p.vessel)}${field('client','Cliente',p.client)}${field('location','Lugar de ejecución',p.location)}${field('responsible','Responsable técnico',p.responsible)}${field('executor','Ejecutor / empresa',p.executor)}${field('order_date','Fecha de la orden',p.order_date,'date')}${field('due_date','Fecha prevista',p.due_date,'date')}
   <div class="field"><label for="wo-warehouse">${profile.role==='production'?'Depósito de abastecimiento':'Depósito para consultar insumos'}</label><select id="wo-warehouse" data-header="warehouse_id" ${readonly()?'disabled':''}><option value="">Seleccionar</option>${D.warehouses.filter(x=>x.active&&(profile.role==='admin'||profile.role==='production'||x.id===profile.warehouse_id)).map(x=>`<option value="${x.id}" ${x.id===p.warehouse_id?'selected':''}>${e(x.name)}</option>`).join('')}</select></div></div>${area('notes','Alcance general y observaciones',p.notes)}
   ${p.source?`<p class="hint">Origen: ${e(p.source.file_name)} · Hoja ${e(p.source.sheet)} · ${p.tasks.length} trabajos.</p>`:''}
   ${p.ai_warnings?.length?`<div class="wo-review"><strong>Puntos para revisar</strong>${p.ai_warnings.map(w=>`<p>${e(w)}</p>`).join('')}</div>`:''}</div>
   <div class="section-head"><h3>Trabajos e implicancias</h3>${!readonly()?'<button class="btn sm" id="woAddTask" type="button">+ Agregar trabajo</button>':''}</div><div class="wo-task-list">${p.tasks.map(taskView).join('')||empty('Subí un Excel para analizar sus trabajos.')}</div>`}`;
 }
 function render(){
  const el=$('#workOrderPanel');if(!el)return;
  if(!allowed()){el.innerHTML=empty('Órdenes de Trabajo requiere un usuario habilitado por Administración.');return;}
  el.innerHTML=`<div class="wo-heading"><div><div class="eyebrow">OPERACIÓN NAVAL</div><h2>Órdenes de Trabajo</h2><p>Prepará, emití y seguí los trabajos de cada embarcación.</p></div>${editor()?'<button class="btn primary" id="woNew" type="button">+ Nueva orden</button>':''}${W.context.access_level==='admin'?'<button class="btn" id="woAccess" type="button">Accesos</button>':''}</div><div id="woError">${W.error?`<div class="error">${e(W.error)}</div>`:''}</div>
   ${editor()?`<div class="card wo-import"><div><h3>Crear desde Excel</h3><p>Subí el archivo, elegí la hoja y dejá que la IA prepare los trabajos e insumos.</p></div><label class="btn" for="woFile">Seleccionar Excel</label><input class="wo-file" id="woFile" type="file" accept=".xlsx,.xls"><select id="woSheet" aria-label="Hoja de Excel" ${W.book?'':'disabled'}>${W.book?W.book.SheetNames.map(n=>`<option ${n===W.sheet?'selected':''}>${e(n)}</option>`).join(''):'<option>Elegir hoja</option>'}</select><button class="btn primary" id="woAnalyze" ${W.book?'':'disabled'} type="button">Analizar con IA</button><span id="woImportStatus" class="hint">${e(W.file?.name||'Excel .xlsx o .xls · hasta 10 MB')}</span></div>`:''}
   <div class="wo-layout"><aside class="wo-sidebar card"><div class="field"><label for="woSearch">Buscar órdenes</label><input id="woSearch" placeholder="Número, embarcación o cliente"></div><select id="woFilter" aria-label="Estado"><option value="all">Todos los estados</option>${Object.entries(states).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select><div id="woList"></div></aside><div id="woDocument">${documentView()}</div></div>`;
  list();$('#woSearch').oninput=list;$('#woFilter').onchange=list;
  $('#woNew')?.addEventListener('click',()=>{if(W.dirty)return error('Guardá el borrador antes de crear otra orden.');newDraft();});
  $('#woFile')?.addEventListener('change',evt=>run(()=>readFile(evt.target.files[0]),evt.target));
  $('#woSheet')?.addEventListener('change',evt=>W.sheet=evt.target.value);
  $('#woAnalyze')?.addEventListener('click',evt=>run(analyze,evt.target));
  $('#woAccess')?.addEventListener('click',accessForm);
  $$('[data-wo-tab]').forEach(b=>b.onclick=()=>{W.tab=b.dataset.woTab;render();});
  $$('[data-header]').forEach(el=>el.oninput=()=>{if(!readonly()){current()[el.dataset.header]=el.value;W.dirty=true;}});
  $$('[data-task]').forEach(el=>{
   const t=current().tasks.find(t=>t.id===el.dataset.task);
   el.ontoggle=()=>el.open?W.opened.add(t.id):W.opened.delete(t.id);
   el.querySelectorAll('[data-progress],[data-progress-notes],[data-quality],[data-quality-notes]').forEach(input=>input.oninput=()=>W.followDirty=true);
   el.querySelectorAll('[data-task-key]').forEach(input=>input.oninput=()=>{const k=input.dataset.taskKey;t[k]=['operations','acceptance'].includes(k)?input.value.split('\n').map(x=>x.trim()).filter(Boolean):input.type==='number'?(input.value===''?null:Number(input.value)):input.value;W.dirty=true;});
   el.querySelectorAll('[data-material-key]').forEach(input=>input.oninput=()=>{
    const m=t.materials[Number(input.closest('[data-material]').dataset.material)],k=input.dataset.materialKey;
    m[k]=input.type==='checkbox'?input.checked:input.type==='number'?(input.value===''?null:Number(input.value)):input.value||null;W.dirty=true;
    if(k==='product_id'&&m.product_id){const p=D.products.find(x=>x.id===m.product_id);if(p&&m.unit!==p.base_unit){m.unit=p.base_unit;m.quantity=null;m.confirmed=false;render();error('Se cambió la unidad al producto seleccionado. Indicá y confirmá la cantidad en esa unidad.');}}
   });
   el.querySelector('[data-add-material]')?.addEventListener('click',()=>{t.materials.push({id:crypto.randomUUID(),description:'',quantity:null,unit:'unidad',confirmed:false,basis:'',product_id:null});W.dirty=true;W.opened.add(t.id);render();});
   el.querySelectorAll('[data-remove-material]').forEach(b=>b.onclick=()=>{t.materials.splice(Number(b.dataset.removeMaterial),1);W.dirty=true;render();});
   el.querySelector('[data-remove-task]')?.addEventListener('click',()=>{current().tasks=current().tasks.filter(x=>x!==t);W.dirty=true;render();});
   el.querySelector('[data-save-progress]')?.addEventListener('click',evt=>run(async()=>{const raw=el.querySelector('[data-progress]').value;if(raw==='')throw Error('Indicá un porcentaje de avance.');await command('progress',{order_id:W.current.id,task_id:t.id,percent:Number(raw),notes:el.querySelector('[data-progress-notes]').value.trim()});await open(W.current.id);},evt.target));
   el.querySelector('[data-save-quality]')?.addEventListener('click',evt=>run(async()=>{await command('quality',{order_id:W.current.id,task_id:t.id,result:el.querySelector('[data-quality]').value,observations:el.querySelector('[data-quality-notes]').value.trim()});await open(W.current.id);},evt.target));
  });
  $('#woAddTask')?.addEventListener('click',()=>{const id=crypto.randomUUID();current().tasks.push({id,source_row:null,sector:'General',description:'Nuevo trabajo',kind:'other',unit:'unidad',quantity:null,length_mm:null,width_mm:null,thickness_mm:null,area_m2:null,weight_kg:null,operations:[],acceptance:[],materials:[]});W.dirty=true;W.opened.add(id);render();});
  for(const [id,kind] of [['#woQuote','quote'],['#woPurchaseOrder','purchase_order']])$(id)?.addEventListener('click',evt=>run(async()=>{if(W.dirty||!W.current.version)await save();await window.AVHCommercial.fromWorkOrder(W.current,kind);},evt.target));
  $('#woSave')?.addEventListener('click',evt=>run(save,evt.target));
  $('#woIssue')?.addEventListener('click',evt=>run(async()=>{if(W.dirty||!W.current.version||(W.file&&!W.current.source_file_path))await save();const id=W.current.id;await open(id);if(W.current.status!=='draft')return;const r=await command('issue',{order_id:id,expected_version:W.current.version});W.dirty=false;await orders();await open(r.id);},evt.target));
  $('#woPdf')?.addEventListener('click',evt=>run(pdf,evt.target));
  $('#woPreview')?.addEventListener('click',evt=>run(async()=>{if(W.dirty||!W.current.version)await save();await pdf();},evt.target));
  $('#woSource')?.addEventListener('click',evt=>run(downloadSource,evt.target));
  $('#woClose')?.addEventListener('click',evt=>run(async()=>{await command('close',{order_id:W.current.id});await orders();await open(W.current.id);},evt.target));
  $('#woCancel')?.addEventListener('click',()=>{openModal('Anular orden','El historial y el número se conservan.','<div class="field"><label for="woCancelReason">Motivo</label><textarea id="woCancelReason"></textarea></div><button class="btn primary" id="woConfirmCancel" type="button">Registrar anulación</button><div id="woCancelError"></div>');$('#woConfirmCancel').onclick=evt=>run(async()=>{await command('cancel',{order_id:W.current.id,reason:$('#woCancelReason').value.trim()});W.dirty=false;closeModal();await orders();await open(W.current.id);},evt.target);});
  $$('#woDocument textarea').forEach(el=>{const fit=()=>{el.style.height='auto';el.style.height=Math.max(76,el.scrollHeight+4)+'px';};el.addEventListener('input',fit);fit();});
  $$('[data-group-supply]').forEach(b=>b.onclick=()=>supplyForm(Number(b.dataset.groupSupply)));
 }
 async function excel(){
  if(window.XLSX)return window.XLSX;
  await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='assets/xlsx-0.20.3.min.js';s.onload=resolve;s.onerror=()=>reject(Error('No se pudo cargar el lector de Excel.'));document.head.appendChild(s);});return window.XLSX;
 }
 async function readFile(file){
  if(!file)return;if(W.dirty&&current()?.tasks?.length)throw Error('Guardá el borrador antes de importar otro Excel.');
  if(!/\.(xlsx|xls)$/i.test(file.name)||file.size>10*1024*1024)throw Error('Subí un Excel .xlsx o .xls de hasta 10 MB.');
  const owner=profile?.id,epoch=++W.epoch,X=await excel(),bytes=await file.arrayBuffer();
  const book=X.read(bytes,{type:'array',cellDates:false,sheetRows:1201});
  if(owner!==profile?.id||epoch!==W.epoch)return;if(!book.SheetNames.length)throw Error('El archivo no tiene hojas.');
  W.file=file;W.book=book;W.sheet=book.SheetNames[0];render();
 }
 async function analyze(){
  const owner=profile?.id,file=W.file,sheet=W.sheet;
  if(!file||!W.book)throw Error('Seleccioná un Excel.');
  if(W.dirty&&current()?.tasks?.length)throw Error('Guardá el borrador antes de analizar otro archivo.');
  const X=await excel(),ws=W.book.Sheets[sheet],full=X.utils.decode_range(ws['!fullref']||ws['!ref']||'A1');
  if(full.e.r>=1200||full.e.c>=60)throw Error('La hoja supera 1.200 filas o 60 columnas. Dividila antes de analizar.');
  const rows=X.utils.sheet_to_json(ws,{header:1,defval:null,blankrows:true,raw:true,range:0}),base=M.parseRows(rows,sheet);
  const status=$('#woImportStatus');if(status)status.textContent='La IA está leyendo la hoja y preparando los insumos…';
  const r=await edge('work-order-ai',{file_name:file.name,sheet,rows,tasks:base.tasks});
  if(owner!==profile?.id||file!==W.file||sheet!==W.sheet)return;if(r.error)throw Error(r.error);if(!r.data?.analysis?.tasks?.length)throw Error('La IA no encontró trabajos.');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))).map(x=>x.toString(16).padStart(2,'0')).join('');
  W.current={id:crypto.randomUUID(),status:'draft',version:null,payload:M.draft(r.data.analysis,{file_name:file.name,sheet,sha256:hash,rows})};
  current().responsible=profile.username;current().warehouse_id=profile.warehouse_id||'';W.dirty=true;W.tab='scope';render();
 }
 async function save(){
  M.validate(current());const r=await command('save',{order_id:W.current.id,expected_version:W.current.version,payload:current()});
  W.current.version=r.version;W.dirty=false;
  if(W.file&&!W.current.source_file_path){
   const safe=W.file.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g,'_');
   const path=W.current.pending_source_path||`${W.current.id}/${crypto.randomUUID()}/${safe}`;W.current.pending_source_path=path;
   const upload=await request(`/storage/v1/object/work-order-documents/${path}`,{method:'POST',headers:{'Content-Type':W.file.type||'application/octet-stream'},body:W.file});
   if(upload.error&&!/already exists|duplicate/i.test(upload.error))throw Error('El borrador se guardó, pero faltó archivar el Excel: '+upload.error);
   await command('attachment',{order_id:W.current.id,path});W.current.source_file_path=path;
  }
  await orders();render();
 }
 function download(bytes,name,type){const url=URL.createObjectURL(new Blob([bytes],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
 async function pdf(){const r=await edge('work-order-pdf',{order_id:W.current.id});if(r.error)throw Error(r.error);const data=r.data;if(!data?.pdf_base64)throw Error('El PDF no pudo generarse.');download(Uint8Array.from(atob(data.pdf_base64),c=>c.charCodeAt(0)),data.filename,'application/pdf');}
 async function downloadSource(){
  if(session?.expires_at&&Date.now()>session.expires_at-45000)await refreshSession();const path=W.current.source_file_path.split('/').map(encodeURIComponent).join('/');
  const r=await fetch(`${API}/storage/v1/object/authenticated/work-order-documents/${path}`,{headers:{apikey:KEY,Authorization:`Bearer ${session.access_token}`}});if(!r.ok)throw Error('No se pudo descargar el Excel original.');download(await r.arrayBuffer(),current().source?.file_name||'Orden_original.xlsx','application/octet-stream');
 }
 function supplyForm(groupIndex){
  if(profile.role!=='depositor'||!profile.warehouse_id||current().warehouse_id!==profile.warehouse_id)return error('La solicitud requiere el usuario del depósito asignado.');
  const g=materialGroups()[groupIndex],product=D.products.find(p=>p.id===g.product_id),stock=product?Number(D.stocks.find(s=>s.warehouse_id===profile.warehouse_id&&s.product_id===g.product_id)?.stock_qty||0):null;
  const quantity=stock==null?g.confirmed:Math.max(0,g.confirmed-stock);
  openModal('Preparar solicitud de insumo',W.current.number||'Borrador de orden','<p>'+e(g.name)+'</p><div class="two"><div class="field"><label for="woSupplyQty">Cantidad a solicitar ('+e(g.unit)+')</label><input id="woSupplyQty" type="number" min="0" step="any" value="'+quantity+'"></div><div class="field"><label for="woSupplyNotes">Motivo / uso</label><input id="woSupplyNotes" value="'+e(current().vessel+' - Trabajos '+g.tasks.join(', '))+'"></div></div><button class="btn primary" id="woSupplySend" type="button">Enviar solicitud a Compras</button>');
  $('#woSupplySend').onclick=evt=>run(async()=>{const qty=Number($('#woSupplyQty').value);if(qty<=0)throw Error('Indicá una cantidad mayor a cero.');const r=await rpc('create_supply_request',{p_product_id:g.product_id||null,p_name:g.product_id?null:g.name,p_quantity:qty,p_unit:g.unit,p_urgency:'normal',p_reason:'Necesidad para orden de trabajo',p_notes:'[OT:'+W.current.id+'] '+(W.current.number||'Borrador')+' - '+$('#woSupplyNotes').value});if(r.error)throw Error(r.error);closeModal();},evt.target);
 }
 function accessForm(){
  const users=D.profiles.filter(p=>p.active&&p.role!=='admin');
  openModal('Accesos a Órdenes de Trabajo','Habilitá el usuario de Galo y los usuarios de Calidad.',`<div class="field"><label for="woAccessUser">Usuario existente</label><select id="woAccessUser">${users.map(p=>`<option value="${p.id}">${e(p.username)} · ${e(p.full_name)}</option>`).join('')}</select></div><div class="field"><label for="woAccessRole">Acceso</label><select id="woAccessRole"><option value="editor">Preparar, emitir y seguir órdenes</option><option value="quality">Inspeccionar trabajos (Calidad)</option><option value="viewer">Consultar</option><option value="none">Revocar acceso</option></select></div><button class="btn primary" id="woAccessSave" type="button">Guardar acceso</button><div class="list">${(W.context.access||[]).map(a=>`<div class="row">${e(a.username)} · ${e(a.access_level)}</div>`).join('')}</div><p class="hint">Las cuentas nuevas con perfil Producción / Órdenes de Trabajo quedan habilitadas al crearlas desde Administración → Usuarios.</p>`);
  $('#woAccessSave').onclick=evt=>run(async()=>{await command('access',{user_id:$('#woAccessUser').value,access_level:$('#woAccessRole').value});await context();closeModal();render();},evt.target);
 }
 const go=window.goPage;window.goPage=function(page){if(profile?.role==='production'&&!['work-orders','production-inventory','commercial','help'].includes(page))page='work-orders';if(page==='work-orders'&&!allowed()&&profile?.role!=='production')return;const r=go.call(this,page);if(page==='work-orders'){render();if(allowed()&&!W.dirty&&!W.busy)run(async()=>{await orders();render();});}return r;};
 const load=window.loadAll;window.loadAll=async function(){const r=await load.apply(this,arguments);await context();if(allowed()&&$('#page-work-orders')?.classList.contains('on')&&!W.dirty&&!W.followDirty&&!W.busy&&canRefreshView('#page-work-orders')){await orders();render();}return r;};
 window.AVHWorkOrders={refresh:async()=>{await context();await orders();render();},state:W};
})();
