// Fabricación Naval uses the existing API, inventory, profiles and warehouse assignment.
// No manufacturing mutation writes inventory tables directly.
(function(){
  const STATES={pending:'Pendiente',preparation:'Preparación',manufacturing:'En fabricación',quality:'Control de calidad',completed:'Terminado',delivered:'Entregado',cancelled:'Cancelado'};
  const PRIORITY={low:'Baja',normal:'Normal',high:'Alta',urgent:'Urgente'};
  const ACTIONS={configure:'Configuración del taller',access:'Permiso actualizado',component:'Componente agregado',worker:'Personal actualizado',order:'Orden registrada / actualizada',material:'Requerimiento de material',reserve:'Reserva actualizada',consume:'Consumo registrado',return:'Sobrante devuelto',output:'Piezas ingresadas al inventario',delivery:'Piezas entregadas',state:'Cambio de estado',block:'Orden bloqueada',unblock:'Bloqueo resuelto',log:'Avance de producción',quality:'Inspección interna',attachment:'Archivo adjuntado',closure:'Cierre diario',report:'Reporte generado'};
  const F={user:null,context:null,installed:null,warehouse:null,tab:'orders',date:'',orders:[],workers:[],components:[],materials:[],day:null,reports:[],detail:null,detailData:null,loading:null,epoch:0,error:''};
  const n=v=>Number(v)||0, s=v=>esc(v), empty=t=>`<div class="empty">${s(t||'Sin registros.')}</div>`;
  const workshop=()=>F.context?.workshops?.find(x=>x.warehouse_id===F.warehouse);
  const permitted=()=>F.context?.workshops?.filter(x=>x.enabled&&x.access_level)||[];
  const allowed=()=>!!profile?.active&&(profile.role==='admin'||(F.user===profile.id&&permitted().length>0));
  const writable=()=>workshop()?.access_level==='operator';
  const localDate=(v=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:workshop()?.timezone||'America/Asuncion',year:'numeric',month:'2-digit',day:'2-digit'}).format(v);
  const label=o=>`OF-${String(o.order_no).padStart(6,'0')}`;
  const comp=id=>F.components.find(x=>x.id===id)?.name||'Componente';
  const project=o=>o.barge_id?`Barcaza ${bargeNo(o.barge_id)}`:o.project;
  const badge=o=>`<span class="badge ${o.blocked_reason?'red':o.state==='completed'||o.state==='delivered'?'green':'amber'}">${s(o.blocked_reason?'Bloqueado':STATES[o.state])}</span>`;
  const options=(rows,selected,key='id',text='name')=>rows.map(x=>`<option value="${s(x[key])}" ${x[key]===selected?'selected':''}>${s(x[text])}</option>`).join('');
  const field=(name,title,value='',type='text',attrs='')=>`<div class="field"><label for="fn-${name}">${s(title)}</label><input id="fn-${name}" name="${name}" type="${type}" value="${s(value)}" ${attrs}></div>`;
  const area=(name,title,value='')=>`<div class="field"><label for="fn-${name}">${s(title)}</label><textarea id="fn-${name}" name="${name}">${s(value)}</textarea></div>`;
  const select=(name,title,content)=>`<div class="field"><label for="fn-${name}">${s(title)}</label><select id="fn-${name}" name="${name}">${content}</select></div>`;
  const closed=o=>['completed','delivered','cancelled'].includes(o.state);
  function setError(error){F.error=error?.message||String(error);render();}
  async function command(action,data){
    const user=profile?.id,key=`avh_fabrication_request:${user}:${action}:${JSON.stringify(canonicalOperationValue(data))}`;
    let id;try{id=localStorage.getItem(key)}catch{} id=id||crypto.randomUUID();
    try{localStorage.setItem(key,id)}catch{}
    const r=await rpc('fabrication_command',{p_action:action,p_data:data,p_request_id:id});
    if(!r.network&&r.status!==408&&r.status!==429&&!(r.status>=500)){try{localStorage.removeItem(key)}catch{}}
    if(r.error)throw Error(r.error);
    if(profile?.id!==user)throw Error('La sesión cambió. Volvé a abrir fabricación.');
    return r.data;
  }
  async function context(force=false){
    if(!profile)return;
    if(F.user!==profile.id){F.epoch++;Object.assign(F,{user:profile.id,context:null,warehouse:null,tab:'orders',date:'',detail:null,detailData:null,orders:[],workers:[],components:[],materials:[],reports:[],day:null,error:'',installed:null});}
    if(!force&&F.context)return;
    const owner=profile.id,r=await rpc('fabrication_context');if(profile?.id!==owner)return;
    if(r.error){F.context=null;F.installed=false;F.error='Fabricación todavía no está habilitada en la base de datos. La activación se realiza después de aprobar la migración.';syncNavigation();return;}
    F.installed=true;F.context=r.data;F.error='';
    if(!permitted().some(x=>x.warehouse_id===F.warehouse)){F.warehouse=permitted()[0]?.warehouse_id||null;F.detail=null;F.detailData=null;}
    F.date=F.date||localDate();syncNavigation();
  }
  function syncNavigation(){
    const on=allowed(),nav=$('.nav');
    $$('.fabrication-nav').forEach(b=>{b.classList.toggle('hide',!on);b.style.display=on?'':'none';});
    document.body.classList.toggle('fabrication-authorized',on);
    nav?.classList.toggle('fabrication-enabled',on);
    if(profile?.role==='depositor'&&nav)nav.style.gridTemplateColumns=on?'repeat(3,1fr)':'repeat(2,1fr)';
    if(on&&F.context&&$('#page-home')&&!$('#fabricationHomeSummary')){
      const box=document.createElement('div');box.id='fabricationHomeSummary';box.className='card fabrication-home';
      box.innerHTML=`<div><div class="eyebrow">FABRICACIÓN NAVAL</div><h2>${n(F.context.active_orders)} órdenes activas</h2><p>${n(F.context.produced_qty)} piezas fabricadas acumuladas</p></div><button class="btn primary" type="button">${profile.role==='admin'?'Supervisar':'Abrir fabricación'}</button>`;
      box.querySelector('button').onclick=()=>goPage('fabrication');$('#page-home').appendChild(box);
    }else if(on&&$('#fabricationHomeSummary')){
      $('#fabricationHomeSummary h2').textContent=`${n(F.context?.active_orders)} órdenes activas`;
      $('#fabricationHomeSummary p').textContent=`${n(F.context?.produced_qty)} piezas fabricadas acumuladas`;
    }else if(!on)$('#fabricationHomeSummary')?.remove();
  }
  async function load(){
    if(!F.warehouse||!F.installed)return render();
    const epoch=++F.epoch,owner=profile?.id,w=F.warehouse,date=F.date;
    const r=await Promise.all([
      queryAll('fabrication_orders','*',`warehouse_id=eq.${w}&order=due_date.asc,order_no.desc`),
      queryAll('fabrication_workers','*',`warehouse_id=eq.${w}&order=name.asc`),
      queryAll('fabrication_components','*','order=name.asc'),
      queryAll('v_fabrication_material_status','*',`warehouse_id=eq.${w}&order=order_id.asc,product_id.asc`),
      rpc('fabrication_day',{p_warehouse:w,p_date:date}),
      query('fabrication_reports','id,warehouse_id,report_date,revision,source,created_at,email_status,email_error',`warehouse_id=eq.${w}&order=report_date.desc,revision.desc&limit=40`)
    ]);
    if(epoch!==F.epoch||profile?.id!==owner||w!==F.warehouse)return;
    const errors=r.filter(x=>x.error);if(errors.length){F.error=errors.map(x=>x.error).join(' · ');return render();}
    [F.orders,F.workers,F.components,F.materials,F.day,F.reports]=r.map(x=>x.data||[]);F.error='';
    if(F.detail)await detail(F.detail,false,epoch);else render();
  }
  async function refresh(){await context(true);if(F.warehouse)await load();else render();}
  function form(title,subtitle,html,submit){
    openModal(title,subtitle,`<form id="fabricationForm" class="fabrication-form">${html}<div id="fabricationFormError" role="alert"></div><button class="btn primary" type="submit">Guardar</button></form>`);
    $('#fabricationForm').onsubmit=async e=>{
      e.preventDefault();const b=e.submitter||$('#fabricationForm button[type="submit"]');if(b.disabled)return;
      b.disabled=true;b.textContent='Guardando…';const data=Object.fromEntries(new FormData(e.target));
      let saved=false;
      try{await submit(data,e.target);saved=true;await loadAll(true);await load();if($('#fabricationForm')===e.target)closeModal();}
      catch(error){if(saved){if($('#fabricationForm')===e.target)closeModal();setError('Operación registrada. No se pudo actualizar la vista: '+(error.message||String(error)));}else if($('#fabricationFormError'))msg($('#fabricationFormError'),error.message||String(error));}
      finally{if(b.isConnected){b.disabled=false;b.textContent='Guardar';}}
    };
  }
  function render(){
    if(!$('#page-fabrication')?.classList.contains('on'))return;
    if(!allowed()){$('#fabricationContent').innerHTML=empty('No tenés autorización para Fabricación Naval.');return;}
    const tabs=[['orders',writable()?'Órdenes':'Supervisión'],['workers','Personal'],['reports','Reportes diarios']];
    if(profile.role==='admin')tabs.push(['settings','Configuración']);
    $('#fabricationContent').innerHTML=`<div class="hero fabrication-hero"><div><div class="eyebrow">FABRICACIÓN NAVAL · ${writable()?'OPERACIÓN':'SUPERVISIÓN'}</div><h2>${s(F.warehouse?whName(F.warehouse):'Configuración de fabricación')}</h2><p>${writable()?'Órdenes, personal y materiales de tu depósito.':'Producción, abastecimiento y reportes del taller autorizado.'}</p></div>${permitted().length>1?select('warehouse','Depósito existente',options(permitted().map(x=>({id:x.warehouse_id,name:whName(x.warehouse_id)})),F.warehouse)):''}</div>
      <div class="chipbar fabrication-tabs" role="tablist">${tabs.map(([id,name])=>`<button class="chip ${F.tab===id?'on':''}" data-fn-tab="${id}" role="tab" aria-selected="${F.tab===id}">${s(name)}</button>`).join('')}</div>
      ${F.error?`<div class="error" role="alert">${s(F.error)}</div>`:''}<div id="fabricationPanel"></div>`;
    $$('[data-fn-tab]').forEach(b=>b.onclick=()=>{F.tab=b.dataset.fnTab;F.detail=null;render();});
    $('#fn-warehouse')?.addEventListener('change',async e=>{F.warehouse=e.target.value;F.detail=null;F.day=null;F.orders=[];await load();});
    if(F.tab==='settings')return settings();
    if(!F.warehouse)return $('#fabricationPanel').innerHTML=empty('Seleccioná un depósito y autorizá los usuarios desde Configuración. No se crean depósitos nuevos.');
    if(F.detail&&F.tab==='orders')return renderDetail();
    if(F.tab==='orders')renderOrders();if(F.tab==='workers')renderWorkers();if(F.tab==='reports')renderReports();
  }
  function renderOrders(){
    const logs=F.day?.work_logs||[],hours=logs.reduce((a,l)=>a+(l.personnel||[]).reduce((b,p)=>b+n(p.hours),0),0),daily=logs.reduce((a,l)=>a+n(l.completed_qty),0);
    const active=F.orders.filter(o=>!closed(o)),late=active.filter(o=>o.due_date<F.date),pendingQuality=F.orders.reduce((a,o)=>a+(o.state==='cancelled'?0:n(o.produced_qty)-n(o.approved_qty)),0);
    $('#fabricationPanel').innerHTML=`<div class="fabrication-date">${field('day','Actividad del día',F.date,'date')}<button class="btn soft" id="fnRefresh">Actualizar</button></div>
      <div class="grid kpis fabrication-kpis">${[['Piezas del día',daily],['Acumuladas',F.orders.reduce((a,o)=>a+n(o.produced_qty),0)],['Órdenes activas',active.length],['Atrasadas',late.length],['Pendientes de calidad',pendingQuality],['Horas registradas',fmt(hours)]].map(([k,v])=>`<div class="kpi"><div class="label">${s(k)}</div><div class="value">${s(v)}</div></div>`).join('')}</div>
      <div class="card fabrication-note">${hours?`Productividad registrada del día: ${fmt(daily/hours)} piezas/hora-persona. Incluye componentes diferentes.`:'Productividad: sin horas registradas.'} ${writable()?'':'La supervisión consulta datos; las operaciones corresponden al usuario autorizado como operador.'}</div>
      <div class="section-head"><h2>Órdenes de fabricación</h2>${writable()?'<button class="btn primary" id="fnNewOrder">+ Orden</button>':''}</div>
      <div class="toolbar">${field('search','Buscar orden o pieza','','search')}${select('state','Estado','<option value="">Todos</option>'+Object.entries(STATES).map(([k,v])=>`<option value="${k}">${v}</option>`).join(''))}</div>
      <div id="fabricationOrderList" class="list"></div>
      <div class="section-head"><h2>Necesidades de materiales</h2></div><div class="list">${F.materials.filter(m=>n(m.missing_qty)>0&&active.some(o=>o.id===m.order_id)).map(m=>`<div class="row"><div class="title">${s(m.product_name)}</div><div class="subtext">${s(label(F.orders.find(o=>o.id===m.order_id)))} · faltan ${fmt(m.missing_qty)} ${s(m.base_unit)} · stock ${fmt(m.stock_qty)} · reservado ${fmt(m.reserved_qty)}</div></div>`).join('')||empty('Sin faltantes calculados para los requerimientos registrados.')}</div>
      <div class="section-head"><h2>Trabajo registrado del día</h2></div><div class="list">${logs.map(l=>`<div class="row"><div class="title">OF-${s(l.order_number)} · ${s(l.activity)}</div><div class="subtext">${(l.personnel||[]).map(p=>`${s(p.name)}: ${fmt(p.hours)} h`).join(' · ')} · ${fmt(l.completed_qty)} piezas</div>${l.incident?`<div class="error">${s(l.incident)}</div>`:''}</div>`).join('')||empty()}</div>
      <div class="section-head"><h2>Costos acumulados registrados</h2></div><div class="list">${(F.day?.costs||[]).map(c=>`<div class="row"><div class="title">OF-${s(c.order_number)} · ${c.currency?s(c.currency):'Sin moneda / costo'}</div><div class="subtext">${c.known_cost==null?'Sin costos registrados':money(c.known_cost,c.currency)}${n(c.unpriced_records)?` · parcial: ${n(c.unpriced_records)} registros sin precio`:' · materiales FIFO y horas valorizadas'}</div></div>`).join('')||empty('Sin datos de costos. Los presupuestos se muestran en cada orden.')}</div>`;
    function list(){const text=$('#fn-search').value.toLowerCase(),state=$('#fn-state').value,rows=F.orders.filter(o=>(!state||o.state===state)&&`${label(o)} ${o.piece_code} ${comp(o.component_id)} ${project(o)} ${o.drawing}`.toLowerCase().includes(text));
      $('#fabricationOrderList').innerHTML=rows.map(o=>`<button class="row fabrication-order" data-fn-order="${o.id}"><div class="line"><div class="grow"><div class="title">${s(label(o))} · ${s(comp(o.component_id))}</div><div class="subtext">${s(o.piece_code)} · ${s(project(o))} · prevista ${s(o.due_date)} · prioridad ${s(PRIORITY[o.priority])}</div></div>${badge(o)}</div><div class="fabrication-progress"><span>${fmt(o.produced_qty)} / ${fmt(o.requested_qty)} piezas · ${fmt(100*n(o.produced_qty)/n(o.requested_qty))}%</span><progress max="${o.requested_qty}" value="${o.produced_qty}"></progress></div></button>`).join('')||empty('Sin órdenes que coincidan.');
      $$('[data-fn-order]').forEach(b=>b.onclick=()=>detail(b.dataset.fnOrder));}
    $('#fn-search').oninput=list;$('#fn-state').onchange=list;list();$('#fnNewOrder')?.addEventListener('click',()=>orderForm());
    $('#fn-day').onchange=async e=>{F.date=e.target.value||localDate();await load();};$('#fnRefresh').onclick=refresh;
  }
  function orderForm(o={}){
    const people=F.workers.filter(w=>w.active||o.worker_ids?.includes(w.id));
    form(o.id?'Editar orden':'Nueva orden','El número lo asigna el servidor.',`
      <div class="two">${field('order_date','Fecha',o.order_date||localDate(),'date','required')}${field('due_date','Fecha prevista',o.due_date||localDate(),'date','required')}</div>
      <div class="two">${select('barge_id','Barcaza','<option value="">Otro proyecto</option>'+options(D.barges.filter(b=>b.active).map(b=>({id:b.id,name:`Barcaza ${b.number}`})),o.barge_id))}${field('project','Proyecto / referencia',o.project||'')}</div>
      <div class="two">${select('component_id','Componente',options(F.components.filter(c=>c.active),o.component_id))}${field('piece_code','Código de pieza',o.piece_code||'','text','required maxlength="120"')}</div>
      <div class="two">${field('drawing','Plano',o.drawing||'','text','required maxlength="160"')}${field('drawing_revision','Revisión',o.drawing_revision||'','text','required maxlength="80"')}</div>
      <div class="two">${field('requested_qty','Cantidad solicitada',o.requested_qty||1,'number','min="1" step="1" required')}${select('priority','Prioridad',Object.entries(PRIORITY).map(([k,v])=>`<option value="${k}" ${k===(o.priority||'normal')?'selected':''}>${v}</option>`).join(''))}</div>
      ${select('output_product_id','Producto terminado del catálogo existente','<option value="">Asignar antes de ingresar las piezas</option>'+options(D.products.filter(p=>p.active&&p.base_unit==='unidad'),o.output_product_id))}
      <fieldset><legend>Personal asignado</legend>${people.map(w=>`<label class="fabrication-check"><input type="checkbox" name="worker_ids" value="${w.id}" ${o.worker_ids?.includes(w.id)?'checked':''}>${s(w.name)}</label>`).join('')||empty('Registrá el personal en su sección.')}</fieldset>
      <div class="two">${field('estimated_cost','Costo estimado (opcional)',o.estimated_cost??'','number','min="0" step="any"')}${select('estimated_currency','Moneda estimada','<option value="">Sin estimación</option>'+options(['PYG','USD'].map(x=>({id:x,name:x})),o.estimated_currency))}</div>${area('notes','Observaciones',o.notes||'')}`,
      (d,f)=>command('order',{...d,warehouse_id:F.warehouse,...(o.id?{order_id:o.id}:{}),worker_ids:new FormData(f).getAll('worker_ids')}));
  }
  async function detail(id,paint=true,parentEpoch){
    F.detail=id;F.tab='orders';const owner=profile?.id,epoch=parentEpoch||++F.epoch;
    if(paint)$('#fabricationPanel').innerHTML=empty('Cargando orden…');
    const tables=['fabrication_logs','fabrication_quality_checks','fabrication_stock_links','fabrication_events','fabrication_attachments'];
    const rs=await Promise.all(tables.map(t=>queryAll(t,t==='fabrication_stock_links'?'*,movements(movement_no)':'*',`order_id=eq.${id}&order=created_at.desc,id.desc`)));
    if(epoch!==F.epoch||owner!==profile?.id||F.detail!==id)return;
    if(rs.some(r=>r.error))return setError(rs.filter(r=>r.error).map(r=>r.error).join(' · '));
    F.detailData=Object.fromEntries(tables.map((t,i)=>[t,rs[i].data]));render();
  }
  function renderDetail(){
    const o=F.orders.find(x=>x.id===F.detail);if(!o)return $('#fabricationPanel').innerHTML=empty('Orden no disponible.');
    const dd=F.detailData;if(!dd)return $('#fabricationPanel').innerHTML=empty('Cargando registros…');
    const mats=F.materials.filter(m=>m.order_id===o.id),links=dd.fabrication_stock_links,checks=dd.fabrication_quality_checks;
    const out=links.filter(l=>l.kind==='output').reduce((a,l)=>a+n(l.quantity),0),del=links.filter(l=>l.kind==='delivery').reduce((a,l)=>a+n(l.quantity),0);
    $('#fabricationPanel').innerHTML=`<div class="section-head"><div><button class="btn sm soft" id="fnBack">← Órdenes</button><h2>${s(label(o))} · ${s(comp(o.component_id))}</h2><p>${s(o.piece_code)} · ${s(project(o))} · ${s(o.drawing)} / revisión ${s(o.drawing_revision)}</p></div>${badge(o)}</div>
      ${o.blocked_reason?`<div class="error">Bloqueo: ${s(o.blocked_reason)}</div>`:''}<div class="grid kpis fabrication-kpis">${[['Solicitadas',o.requested_qty],['Fabricadas',o.produced_qty],['Pendientes',n(o.requested_qty)-n(o.produced_qty)],['Aprobadas internamente',o.approved_qty],['Ingresadas al inventario',out],['Entregadas',del]].map(([k,v])=>`<div class="kpi"><div class="label">${k}</div><div class="value">${fmt(v)}</div></div>`).join('')}</div>
      <div class="card"><p>Prevista: ${s(o.due_date)} · prioridad ${s(PRIORITY[o.priority])}</p><p>Personal: ${o.worker_ids.map(id=>s(F.workers.find(w=>w.id===id)?.name||'Operario')).join(', ')||'Sin asignar'}</p><p>${o.estimated_cost==null?'Sin costo estimado':`Estimado: ${money(o.estimated_cost,o.estimated_currency)}`}</p><p>${s(o.notes||'Sin observaciones.')}</p>${o.completed_at?`<p>Finalizada: ${dt(o.completed_at)}</p>`:''}</div>
      ${writable()?`<div class="fabrication-actions">${!closed(o)?'<button class="btn soft" id="fnEdit">Editar orden</button><button class="btn soft" id="fnState">Cambiar estado</button><button class="btn soft" id="fnBlock">'+(o.blocked_reason?'Resolver bloqueo':'Registrar bloqueo')+'</button>':''}${['preparation','manufacturing'].includes(o.state)?'<button class="btn primary" id="fnLog">Registrar producción</button>':''}${o.state==='quality'?'<button class="btn primary" id="fnQuality">Control interno</button>':''}${o.output_product_id&&n(o.approved_qty)>out&&!['cancelled','delivered'].includes(o.state)?'<button class="btn primary" id="fnOutput">Ingresar piezas al inventario</button>':''}${o.state==='completed'&&out>del?'<button class="btn primary" id="fnDelivery">Entregar piezas</button>':''}<button class="btn soft" id="fnPhoto">Adjuntar foto / plano</button></div>`:''}
      <div class="section-head"><h2>Materiales del depósito</h2>${writable()&&!closed(o)?'<button class="btn sm soft" id="fnMaterial">+ Requerimiento</button>':''}</div><div class="list">${mats.map(m=>`<div class="row"><div class="title">${s(m.product_name)} · ${s(m.base_unit)}</div><div class="subtext">Requerido ${fmt(m.required_qty)} · consumo neto ${fmt(m.net_consumed_qty)} · reserva ${fmt(m.reserved_qty)}<br>Stock real ${fmt(m.stock_qty)} · disponible sin reservas ${fmt(m.available_qty)} · faltante ${fmt(m.missing_qty)}</div>${writable()&&!closed(o)?`<div class="fabrication-actions"><button class="btn sm soft" data-fn-reserve="${m.product_id}">Reservar / liberar</button><button class="btn sm soft" data-fn-consume="${m.product_id}">Consumir</button><button class="btn sm soft" data-fn-require="${m.product_id}">Editar requerimiento</button></div>`:''}</div>`).join('')||empty('Sin materiales requeridos registrados.')}</div>
      ${writable()&&profile.role==='depositor'?'<button class="btn soft" id="fnSupplyRequest">Solicitar abastecimiento con el formulario existente</button>':''}
      <div class="section-head"><h2>Movimientos vinculados</h2></div><div class="list">${links.map(l=>`<div class="row"><div class="title">${s({consume:'Consumo',return:'Devolución / sobrante',output:'Producto fabricado',delivery:'Entrega'}[l.kind])} · ${fmt(l.quantity)} ${s(product(l.product_id)?.base_unit)} ${s(product(l.product_id)?.name)}</div><div class="subtext">${dt(l.created_at)} · movimiento #${s(l.movements?.movement_no||'')}</div>${writable()&&l.kind==='consume'?`<button class="btn sm soft" data-fn-return="${l.id}">Devolver sobrante</button>`:''}</div>`).join('')||empty()}</div>
      <div class="section-head"><h2>Avances y horas</h2></div><div class="list">${dd.fabrication_logs.map(l=>`<div class="row"><div class="title">${s(l.work_date)} · ${s(l.activity)} · ${fmt(l.completed_qty)} piezas</div><div class="subtext">${l.personnel.map(p=>`${s(p.name)}: ${fmt(p.hours)} h`).join(' · ')}<br>${s(l.notes||'')}${l.incident?' · Incidente: '+s(l.incident):''}</div></div>`).join('')||empty()}</div>
      <div class="section-head"><h2>Inspección interna</h2></div><div class="notice">El control interno no sustituye aprobaciones de Ingeniería, Calidad o Bureau Veritas.</div><div class="list">${checks.map(q=>`<div class="row"><div class="title">${s({approved:'Aprobado internamente',rework:'Retrabajo',rejected:'Rechazado internamente'}[q.result])} · ${q.quantity} piezas</div><div class="subtext">${s(q.drawing)} / ${s(q.drawing_revision)} · ${dt(q.created_at)} · responsable ${s(q.responsible_name)}<br>Medidas: ${s(q.measurements)}<br>Soldaduras: ${s(q.weld_finish)}<br>${s(q.defects||'Sin defectos registrados')} · ${s(q.notes||'')}</div></div>`).join('')||empty()}</div>
      <div class="section-head"><h2>Fotografías y planos</h2></div><div class="list">${dd.fabrication_attachments.map(a=>`<button class="row fabrication-file" data-fn-file="${s(a.file_path)}"><strong>${s(a.file_name)}</strong><small>${s(a.kind==='photo'?'Fotografía':'Plano')}${a.quality_check_id?' · inspección vinculada':''} · ${dt(a.created_at)}</small></button>`).join('')||empty()}</div>
      <div class="section-head"><h2>Trazabilidad</h2></div><div class="list">${dd.fabrication_events.map(e=>`<div class="row"><div class="title">${s(ACTIONS[e.action]||e.action)} · ${dt(e.created_at)}</div><div class="subtext">${s(e.request_data?.notes||'Registro confirmado')} · ${s(e.actor_name)}</div></div>`).join('')||empty()}</div>`;
    $('#fnBack').onclick=()=>{F.detail=null;F.epoch++;render();};$('#fnEdit')?.addEventListener('click',()=>orderForm(o));
    $('#fnMaterial')?.addEventListener('click',()=>material(o));
    $('#fnSupplyRequest')?.addEventListener('click',()=>window.openNewSupplyRequest?.());
    $('#fnState')?.addEventListener('click',()=>{
      const next={pending:['preparation'],preparation:['manufacturing'],manufacturing:['quality'],quality:['manufacturing','completed']}[o.state]||[];
      form('Estado de la orden',label(o),select('state','Próximo estado',[...next,'cancelled'].map(k=>`<option value="${k}">${STATES[k]}</option>`).join(''))+area('notes','Motivo / observación (obligatorio para cancelación o retrabajo)'),d=>command('state',{...d,order_id:o.id}));
    });
    $('#fnBlock')?.addEventListener('click',()=>form(o.blocked_reason?'Resolver bloqueo':'Bloquear orden',label(o),area('notes','Motivo o solución'),d=>command(o.blocked_reason?'unblock':'block',{...d,order_id:o.id})));
    $('#fnLog')?.addEventListener('click',()=>production(o));$('#fnQuality')?.addEventListener('click',()=>quality(o));$('#fnPhoto')?.addEventListener('click',()=>attachment(o,checks));
    $('#fnOutput')?.addEventListener('click',()=>stockForm(o,'output',o.output_product_id,n(o.approved_qty)-out));$('#fnDelivery')?.addEventListener('click',()=>stockForm(o,'delivery',o.output_product_id,out-del));
    $$('[data-fn-reserve]').forEach(b=>b.onclick=()=>{const m=mats.find(x=>x.product_id===b.dataset.fnReserve);stockForm(o,'reserve',m.product_id,m.reserved_qty);});
    $$('[data-fn-consume]').forEach(b=>b.onclick=()=>stockForm(o,'consume',b.dataset.fnConsume,''));
    $$('[data-fn-require]').forEach(b=>b.onclick=()=>material(o,mats.find(x=>x.product_id===b.dataset.fnRequire)));
    $$('[data-fn-return]').forEach(b=>b.onclick=()=>{const l=links.find(x=>x.id===b.dataset.fnReturn);stockForm(o,'return',l.product_id,'',l.id);});
    $$('[data-fn-file]').forEach(b=>b.onclick=()=>file(b.dataset.fnFile,dd.fabrication_attachments.find(a=>a.file_path===b.dataset.fnFile)?.file_name||'archivo'));
  }
  function material(o,m={}){form('Material requerido',label(o),select('product_id','Producto del inventario existente',options(D.products.filter(p=>p.active),m.product_id))+field('quantity','Cantidad en unidad base',m.required_qty||'','number','min="0.000001" step="any" required'),d=>command('material',{...d,order_id:o.id}));}
  function stockForm(o,kind,pid,qty='',source){
    const titles={reserve:'Reserva pendiente total (0 libera)',consume:'Consumo efectivo',return:'Devolución de sobrante',output:'Ingreso de piezas aprobadas',delivery:'Entrega de piezas'};
    form(titles[kind],`${label(o)} · ${product(pid)?.name||''}`,field('quantity',kind==='reserve'?'Nueva reserva total en unidad base':'Cantidad en unidad base',qty,'number',`min="${kind==='reserve'?0:['output','delivery'].includes(kind)?1:0.000001}" step="${['output','delivery'].includes(kind)?'1':'any'}" required`)+
      (kind==='output'?`<div class="two">${field('unit_cost','Costo unitario (opcional)','','number','min="0" step="any"')}${select('currency','Moneda','<option value="">Sin costo</option><option>PYG</option><option>USD</option>')}</div>`:'')+
      (kind==='delivery'?field('person_receiving','Persona que recibe','','text','required')+field('destination','Destino / sector','','text','required'):'')+area('notes','Observación'),d=>command(kind,{...d,order_id:o.id,product_id:pid,...(source?{source_link_id:source}:{})}));
  }
  function production(o){
    const people=F.workers.filter(w=>w.active&&o.worker_ids.includes(w.id));
    form('Registrar producción',label(o),field('work_date','Fecha de trabajo',F.date,'date','required')+area('activity','Actividad realizada')+field('completed_qty','Piezas nuevas fabricadas (0 para retrabajo)',0,'number','min="0" step="1" required')+
      `<fieldset><legend>Horas por operario</legend>${people.map(w=>field(`hours-${w.id}`,w.name,'','number','min="0" max="24" step="0.25"')).join('')||empty('Primero asigná personal a la orden.')}</fieldset>`+area('incident','Incidentes / equipos')+area('notes','Observaciones'),
      d=>command('log',{order_id:o.id,work_date:d.work_date,activity:d.activity,completed_qty:d.completed_qty,incident:d.incident,notes:d.notes,personnel:people.filter(w=>n(d[`hours-${w.id}`])>0).map(w=>({worker_id:w.id,hours:n(d[`hours-${w.id}`])}))}));
  }
  function quality(o){form('Control de calidad interno',`${o.drawing} / revisión ${o.drawing_revision}`,field('quantity','Cantidad inspeccionada','','number','min="1" step="1" required')+select('result','Resultado','<option value="approved">Aprobado internamente</option><option value="rework">Requiere retrabajo</option><option value="rejected">Rechazado internamente</option>')+area('measurements','Medidas verificadas: esperado, medido y tolerancia')+area('weld_finish','Terminación de soldaduras')+area('defects','Defectos / retrabajos necesarios')+area('notes','Observaciones'),d=>command('quality',{...d,order_id:o.id}));}
  function attachment(o,checks){
    form('Adjuntar fotografía o plano',label(o),select('kind','Tipo','<option value="photo">Fotografía</option><option value="drawing">Plano PDF</option>')+select('quality_check_id','Vincular a inspección interna','<option value="">Sin inspección</option>'+checks.map(q=>`<option value="${q.id}">${s(q.result)} · ${dt(q.created_at)}</option>`).join(''))+field('file','Archivo (máximo 10 MB)','','file','accept="image/jpeg,image/png,image/webp,application/pdf" required'),async(d,f)=>{
      const uploaded=f.querySelector('[name="file"]').files[0];if(!uploaded||uploaded.size>10485760)throw Error('Archivo inválido o mayor a 10 MB.');
      const signature=`${uploaded.name}:${uploaded.size}:${uploaded.lastModified}`;
      let path=f._fabricationUpload?.signature===signature?f._fabricationUpload.path:null;
      if(!path){path=`${F.warehouse}/${o.id}/${crypto.randomUUID()}_${uploaded.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
        const r=await request(`/storage/v1/object/fabrication-documents/${path}`,{method:'POST',headers:{'Content-Type':uploaded.type,'x-upsert':'false'},body:uploaded});if(r.error)throw Error(r.error);
        f._fabricationUpload={signature,path};}
      return command('attachment',{order_id:o.id,file_path:path,file_name:uploaded.name,kind:d.kind,quality_check_id:d.quality_check_id});
    });
  }
  async function file(path,name){
    if(session?.expires_at&&Date.now()>session.expires_at-45000&&!await refreshSession())return alert('La sesión venció. Volvé a ingresar.');
    const response=await fetch(`${API}/storage/v1/object/authenticated/fabrication-documents/${path}`,{headers:{apikey:KEY,Authorization:`Bearer ${session.access_token}`}});
    if(!response.ok)return alert('No se pudo descargar el archivo.');download(await response.blob(),name.trim()||'archivo');
  }
  function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
  function renderWorkers(){
    $('#fabricationPanel').innerHTML=`<div class="section-head"><div><h2>Personal del taller</h2><p>Registrá los nombres reales. No se agregan operarios ficticios.</p></div>${writable()||profile.role==='admin'?'<button class="btn primary" id="fnNewWorker">+ Operario</button><button class="btn soft" id="fnNewComponent">+ Componente</button>':''}</div><div class="list">${F.workers.map(w=>`<div class="row"><div class="line"><div><div class="title">${s(w.name)} ${w.active?'':'· Inactivo'}</div><div class="subtext">${s(w.specialty||'Polivalente')} · ${w.hourly_rate==null?'Tarifa no registrada':money(w.hourly_rate,w.currency)+'/h'}</div></div>${writable()||profile.role==='admin'?`<button class="btn sm soft" data-fn-worker="${w.id}">Editar</button>`:''}</div></div>`).join('')||empty()}</div>`;
    const edit=(w={})=>form(w.id?'Editar operario':'Agregar operario','Podés agregar más personal posteriormente.',field('name','Nombre',w.name||'','text','required')+field('specialty','Especialidad',w.specialty||'Polivalente')+select('active','Estado',`<option value="true">Activo</option><option value="false" ${w.active===false?'selected':''}>Inactivo</option>`)+field('hourly_rate','Tarifa por hora (opcional)',w.hourly_rate??'','number','min="0" step="any"')+select('currency','Moneda','<option value="">Sin tarifa</option>'+options(['PYG','USD'].map(x=>({id:x,name:x})),w.currency)),d=>command('worker',{...d,warehouse_id:F.warehouse,...(w.id?{worker_id:w.id}:{})}));
    $('#fnNewWorker')?.addEventListener('click',()=>edit());$$('[data-fn-worker]').forEach(b=>b.onclick=()=>edit(F.workers.find(w=>w.id===b.dataset.fnWorker)));
    $('#fnNewComponent')?.addEventListener('click',()=>form('Nuevo componente','Catálogo de Fabricación Naval',field('name','Nombre','','text','required'),d=>command('component',{...d,warehouse_id:F.warehouse})));
  }
  function renderReports(){
    $('#fabricationPanel').innerHTML=`<div class="section-head"><div><h2>Reportes diarios</h2><p>Generación automática del día completo; cada actualización conserva una revisión.</p></div></div><div class="fabrication-date">${field('report_date','Fecha',F.date,'date')}<button class="btn primary" id="fnGenerate">Generar / actualizar</button>${writable()?'<button class="btn soft" id="fnClosure">Observaciones de cierre</button>':''}</div><div id="fnReportError" role="alert"></div>
      <div class="list">${F.reports.map(r=>`<div class="row"><div class="line"><div><div class="title">${s(r.report_date)} · revisión ${r.revision}</div><div class="subtext">${r.source==='automatic'?'Automático':'Actualización manual'} · ${dt(r.created_at)} · correo ${s(r.email_status)}${r.email_error?' · '+s(r.email_error):''}</div></div><button class="btn sm soft" data-fn-pdf="${r.id}">PDF</button></div></div>`).join('')||empty('Todavía no hay reportes guardados.')}</div>${F.reports.length===40?'<button class="btn soft" id="fnOlderReports">Cargar reportes anteriores</button>':''}`;
    $('#fnGenerate').onclick=async e=>{e.target.disabled=true;try{F.date=$('#fn-report_date').value;await command('report',{warehouse_id:F.warehouse,report_date:F.date});await load();}catch(error){msg($('#fnReportError'),error.message);}finally{if(e.target.isConnected)e.target.disabled=false;}};
    $('#fnClosure')?.addEventListener('click',()=>{F.date=$('#fn-report_date').value;const c=F.day?.report_date===F.date?F.day.closure:{};
      form('Cierre diario',F.date,area('notes','Observaciones de cierre',c?.notes||'')+area('equipment_problems','Problemas de equipos',c?.equipment_problems||'')+area('purchase_needs','Necesidades de compras',c?.purchase_needs||'')+area('next_day_plan','Actividades previstas para mañana',c?.next_day_plan||''),d=>command('closure',{...d,warehouse_id:F.warehouse,report_date:F.date}));});
    $$('[data-fn-pdf]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const r=await edge('fabrication-report-pdf',{report_id:b.dataset.fnPdf});if(r.error)throw Error(r.error);const raw=atob(r.data.pdf_base64);download(new Blob([Uint8Array.from(raw,c=>c.charCodeAt(0))],{type:'application/pdf'}),r.data.filename);}catch(error){msg($('#fnReportError'),error.message);}finally{b.disabled=false;}});
    $('#fnOlderReports')?.addEventListener('click',async()=>{const r=await queryAll('fabrication_reports','id,warehouse_id,report_date,revision,source,created_at,email_status,email_error',`warehouse_id=eq.${F.warehouse}&order=report_date.desc,revision.desc`);if(r.error)return msg($('#fnReportError'),r.error);F.reports=r.data;renderReports();});
  }
  function settings(){
    if(!F.installed)return $('#fabricationPanel').innerHTML=empty('La migración y las funciones de fabricación deben aprobarse y aplicarse antes de configurar el módulo.');
    const whs=D.warehouses.filter(w=>w.active),target=F.context?.workshops.find(w=>w.warehouse_id===F.warehouse)||F.context?.workshops[0]||{};
    $('#fabricationPanel').innerHTML=`<div class="card"><h2>Activar en un depósito existente</h2><p>Usa la asignación actual del depositario. Supervisores: cuentas de administración autorizadas.</p><form id="fabricationSettings">${select('warehouse_id','Depósito existente',options(whs,target.warehouse_id))}${select('enabled','Fabricación',`<option value="true">Habilitada</option><option value="false" ${!target.enabled?'selected':''}>Deshabilitada</option>`)}${field('timezone','Zona horaria',target.timezone||'America/Asuncion','text','required')}${select('email_enabled','Correo automático',`<option value="false">Deshabilitado</option><option value="true" ${target.email_enabled?'selected':''}>Habilitado</option>`)}${field('email_recipients','Correos destinatarios (separados por coma)',(target.email_recipients||[]).join(', '),'text')}<div class="notice">El envío requiere desplegar y configurar el servicio de correo. Activarlo aquí habilita la cola de reportes.</div><button class="btn primary">Guardar configuración</button></form><div id="fnSettingsError"></div></div>
      <div class="card"><h2>Autorizar usuario</h2><form id="fabricationGrant">${select('warehouse_id','Depósito configurado',options(F.context?.workshops.map(w=>({id:w.warehouse_id,name:whName(w.warehouse_id)}))||[],target.warehouse_id))}${select('user_id','Cuenta existente',options(D.profiles.filter(p=>p.active).map(p=>({id:p.id,name:`${p.username} · ${p.role==='admin'?'Administración':whName(p.warehouse_id)}`}))))}${select('access_level','Permiso','<option value="operator">Operación</option><option value="supervisor">Supervisión (administradores)</option>')}${select('revoke','Acción','<option value="false">Autorizar / actualizar</option><option value="true">Revocar acceso</option>')}<button class="btn primary">Aplicar permiso</button></form><div id="fnGrantError"></div><div id="fnGrants"></div></div>`;
    $('#fabricationSettings').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{const d=Object.fromEntries(new FormData(e.target));d.email_recipients=d.email_recipients.split(',').map(x=>x.trim()).filter(Boolean);await command('configure',d);await context(true);settings();}catch(error){msg($('#fnSettingsError'),error.message);}finally{b.disabled=false;}};
    $('#fabricationSettings [name="warehouse_id"]').onchange=e=>{const w=F.context.workshops.find(x=>x.warehouse_id===e.target.value)||{};for(const k of ['enabled','email_enabled'])e.target.form.elements[k].value=String(w[k]||false);e.target.form.elements.timezone.value=w.timezone||'America/Asuncion';e.target.form.elements.email_recipients.value=(w.email_recipients||[]).join(', ');};
    $('#fabricationGrant').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await command('access',Object.fromEntries(new FormData(e.target)));await refresh();}catch(error){msg($('#fnGrantError'),error.message);}finally{b.disabled=false;}};
    queryAll('fabrication_access','*','order=granted_at.desc').then(r=>{if(!$('#fnGrants')||r.error)return;$('#fnGrants').innerHTML='<h3>Accesos vigentes</h3>'+r.data.map(a=>`<p>${s(D.profiles.find(p=>p.id===a.user_id)?.username||a.user_id)} · ${s(whName(a.warehouse_id))} · ${s(a.access_level==='operator'?'Operación':'Supervisión')}</p>`).join('');});
  }
  const originalGo=window.goPage;
  window.goPage=function(page){
    if(page==='fabrication'&&!allowed())return;
    const r=originalGo.apply(this,arguments);
    if(page==='fabrication'){render();refresh().catch(setError);}
    return r;
  };
  const originalLoad=window.loadAll;
  window.loadAll=async function(force=false){
    await originalLoad.apply(this,arguments);await context(true);syncNavigation();
    if($('#page-fabrication')?.classList.contains('on')&&canRefreshView('#page-fabrication'))await load();
  };
  window.AVHManufacturing={allowed,writable,refresh,command,state:F};
})();
