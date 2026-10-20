// Control de gases: el gas lleno utiliza el stock existente; los envases se siguen aparte.
(function(){
  const G={user:null,warehouse:null,rows:[],holders:[],events:[],from:'',to:'',gas:'',error:'',epoch:0};
  const labels={count:'Conteo físico',exit:'Entrega de lleno',return_empty:'Devolución de vacío',return_full:'Devolución de lleno',send_refill:'Vacíos al proveedor',refill:'Recarga / canje',new_full:'Ingreso de llenos nuevos',entry:'Entrada de llenos',initial:'Carga inicial anterior',transfer_out:'Transferencia enviada',transfer_in:'Transferencia recibida'};
  const n=x=>Number(x)||0,s=x=>esc(String(x??''));
  const kgFmt=x=>new Intl.NumberFormat('es-PY',{maximumFractionDigits:3}).format(n(x));
  const kinds=[{id:'co2',name:'CO₂'},{id:'oxygen',name:'Oxígeno'},{id:'glp',name:'GLP'}];
  const sizeLabel=r=>r.kg_per_cylinder!=null?`${kgFmt(r.kg_per_cylinder)} kg por cilindro`:'Peso sin registrar';
  const gasTitle=r=>`${kinds.find(k=>k.id===r.gas_kind)?.name||r.gas_name} · ${sizeLabel(r)}`;
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Asuncion',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const permitted=()=>profile?.active&&['admin','depositor'].includes(profile.role);
  const rows=()=>G.rows.filter(x=>x.warehouse_id===G.warehouse);
  const holders=id=>G.holders.filter(x=>x.warehouse_id===G.warehouse&&x.product_id===id&&n(x.quantity)>0);
  const productRow=id=>rows().find(x=>x.product_id===id);
  const choices=(items,value,key='id',title='name')=>items.map(original=>{const x=title==='display_name'?{...original,display_name:gasTitle(original)}:original;return `<option value="${s(x[key])}" ${x[key]===value?'selected':''}>${s(x[title])}</option>`;}).join('');
  const input=(name,label,type='text',attrs='',value='')=>`<div class="field"><label for="gas-${name}">${s(label)}</label><input id="gas-${name}" name="${name}" type="${type}" ${attrs} value="${s(value)}"></div>`;
  const select=(name,label,html)=>`<div class="field"><label for="gas-${name}">${s(label)}</label><select id="gas-${name}" name="${name}">${html}</select></div>`;
  async function command(action,data){
    const user=profile?.id,key=`avh_gas_request:${user}:${action}:${JSON.stringify(canonicalOperationValue(data))}`;
    let id;try{id=localStorage.getItem(key)}catch{}id=id||crypto.randomUUID();
    try{localStorage.setItem(key,id)}catch{}
    const r=await rpc('gas_command',{p_action:action,p_data:data,p_request_id:id});
    if(!r.network&&r.status!==408&&r.status!==429&&!(r.status>=500)){try{localStorage.removeItem(key)}catch{}}
    if(r.error)throw Error(r.error);
    if(profile?.id!==user)throw Error('La sesión cambió. Volvé a abrir Gases.');
    return r.data;
  }
  async function load(){
    if(!permitted())return;
    if(G.user!==profile.id){G.epoch++;Object.assign(G,{user:profile.id,warehouse:null,rows:[],holders:[],events:[],from:today(),to:today(),gas:'',error:''});}
    const user=profile.id,epoch=++G.epoch;
    const results=await Promise.all([queryAll('v_gas_stock_status','*','order=warehouse_name.asc,sort_order.asc'),queryAll('gas_custody','*','quantity=gt.0&order=person.asc')]);
    if(user!==profile?.id||epoch!==G.epoch)return;
    if(results.some(x=>x.error)){G.error=results.filter(x=>x.error).map(x=>x.error).join(' · ');return;}
    [G.rows,G.holders]=results.map(x=>x.data||[]);G.rows.sort((a,b)=>n(a.sort_order)-n(b.sort_order)||n(a.kg_per_cylinder)-n(b.kg_per_cylinder));G.error='';
    const allowed=[...new Set(G.rows.map(x=>x.warehouse_id))];
    if(!allowed.includes(G.warehouse))G.warehouse=profile.role==='depositor'?profile.warehouse_id:(D.warehouses.find(w=>w.code==='ACOMAR'&&allowed.includes(w.id))?.id||allowed[0]||null);
    syncHome();
  }
  async function loadEvents(){
    if(!G.warehouse)return;
    const user=profile?.id,warehouse=G.warehouse,from=G.from,to=G.to;
    const r=await queryAll('gas_events','*',`warehouse_id=eq.${warehouse}&work_date=gte.${from}&work_date=lte.${to}&order=event_no.desc`);
    if(user!==profile?.id||warehouse!==G.warehouse||from!==G.from||to!==G.to)return;
    if(r.error){G.error=r.error;G.events=[];}else{G.events=r.data||[];G.error='';}
    renderResults();
  }
  function render(){
    const host=$('#gasContent');if(!host||!$('#page-gases')?.classList.contains('on'))return;
    if(!permitted()){host.innerHTML='<div class="empty">No tenés acceso al control de gases.</div>';return;}
    const warehouses=(D.warehouses||[]).filter(w=>G.rows.some(x=>x.warehouse_id===w.id));
    host.innerHTML=`<div class="hero gas-hero"><div><div class="eyebrow">CONTROL DE GASES</div><h2>CO₂, oxígeno y GLP</h2><p>Elegí los kg de cada presentación. Controlá el gas disponible y los envases por separado.</p></div>${profile.role==='admin'?select('warehouse','Depósito',choices(warehouses,G.warehouse)):''}</div>
      <div class="gas-actions"><button class="btn primary" id="gasExit">− Entregar llenos</button><button class="btn soft" id="gasEmpty">↩ Recibir vacíos</button><button class="btn soft" id="gasRefill">+ Ingreso / recarga</button><button class="btn soft" id="gasSend">Vacíos al proveedor</button><button class="btn soft" id="gasFullReturn">Devolución de lleno</button><button class="btn" id="gasCount">Nuevo conteo</button><button class="btn icon" id="gasRefresh" aria-label="Actualizar gases">↻</button></div>
      <button class="btn soft" id="gasPresentation">+ Presentación en kg</button><div id="gasError" role="alert"></div><div id="gasCards" class="gas-grid"></div>
      <div class="card gas-start"><h3>Cómo empezar con el nuevo depositario</h3><ol><li>Contar por separado los cilindros llenos y vacíos de cada gas.</li><li>En <b>Nuevo conteo</b>, anotar también los cilindros que están con otras personas o con el proveedor.</li><li>Registrar cada entrega de lleno, devolución de vacío y recarga cuando sucede.</li></ol><p>El conteo reemplaza el saldo de gases por lo contado y deja la diferencia en el historial. Un vacío devuelto no suma gas disponible.</p></div>
      <div class="section-head"><div><h2>Pendientes de devolución</h2><p>Quién tiene los cilindros y cuántos faltan devolver.</p></div></div><div id="gasPending" class="list"></div>
      <div class="section-head"><div><h2>Entradas, salidas y diferencial</h2><p>Resumen separado por gas para el período elegido.</p></div><button class="btn sm soft" id="gasExport">Descargar CSV</button></div>
      <div class="gas-filters">${input('from','Desde','date','required',G.from)}${input('to','Hasta','date','required',G.to)}${select('filter','Gas / presentación','<option value="">Los tres gases</option>'+choices(rows(),G.gas,'product_id','display_name'))}<button class="btn soft" id="gasApply">Ver período</button></div>
      <div id="gasPeriod" class="gas-grid"></div><div id="gasHistory" class="list" style="margin-top:12px"></div>`;
    $('#gas-warehouse')?.addEventListener('change',async e=>{G.warehouse=e.target.value;G.events=[];render();await loadEvents();});
    $('#gasExit').onclick=()=>movement('exit');$('#gasEmpty').onclick=()=>movement('return_empty');$('#gasRefill').onclick=()=>movement('refill');$('#gasSend').onclick=()=>movement('send_refill');$('#gasFullReturn').onclick=()=>movement('return_full');
    $('#gasCount').onclick=()=>countForm();$('#gasRefresh').onclick=()=>refresh();$('#gasPresentation').onclick=()=>presentationForm();
    $('#gasApply').onclick=async()=>{const a=$('#gas-from').value,b=$('#gas-to').value;if(!a||!b||a>b){msg($('#gasError'),'Revisá las fechas del período.');return;}G.from=a;G.to=b;G.gas=$('#gas-filter').value;await loadEvents();};
    $('#gas-filter').onchange=e=>{G.gas=e.target.value;renderResults();};$('#gasExport').onclick=exportCSV;
    renderResults();
  }
  function renderResults(){
    if(!$('#gasCards')||!$('#page-gases')?.classList.contains('on'))return;
    const err=$('#gasError');if(err){err.className=G.error?'error':'';err.textContent=G.error;}
    $('#gasCards').innerHTML=rows().map(r=>`<article class="card gas-card"><div class="line"><h3>${s(gasTitle(r))}</h3><span class="badge ${r.counted_at?'green':'amber'}">${r.counted_at?'CONTADO':'SIN CONTEO'}</span></div><div class="gas-values"><div><b>${fmt(r.full_qty)}</b><span>Cilindros llenos</span></div><div><b>${r.counted_at?fmt(r.empty_qty):'—'}</b><span>Vacíos en depósito</span></div><div><b>${r.counted_at?fmt(r.outside_qty):'—'}</b><span>En uso / por devolver</span></div><div><b>${r.counted_at?fmt(r.supplier_qty):'—'}</b><span>Con proveedor</span></div></div><div class="gas-weight">${r.full_kg!=null?`<b>${kgFmt(r.full_kg)} kg</b> de gas disponible`:'Kg pendientes de identificar'}</div><div class="subtext">${r.counted_at?`Último conteo: ${dt(r.counted_at)} · ${fmt(n(r.full_qty)+n(r.empty_qty)+n(r.outside_qty)+n(r.supplier_qty))} cilindros controlados`:'Hacé el conteo físico antes de entregar o devolver cilindros.'}</div><button class="btn sm soft" data-gas-exit="${r.product_id}" ${!r.counted_at?'disabled':''}>Entregar ${s(gasTitle(r))}</button></article>`).join('')||'<div class="empty">No hay gases configurados para este depósito.</div>';
    $$('[data-gas-exit]').forEach(b=>b.onclick=()=>movement('exit',b.dataset.gasExit));
    const pending=G.holders.filter(x=>x.warehouse_id===G.warehouse&&n(x.quantity)>0);
    $('#gasPending').innerHTML=pending.map(h=>`<div class="row"><div class="line"><div class="grow"><div class="title">${s(h.person)} · ${s(productRow(h.product_id)?gasTitle(productRow(h.product_id)):'Gas')}</div><div class="subtext">${h.location==='supplier'?'Con proveedor / recarga':'Pendiente de devolución'} · ${fmt(h.quantity)} cilindros${h.destination?' · '+s(h.destination):''}</div></div><button class="btn sm soft" data-gas-holder="${h.id}">${h.location==='supplier'?'Recibir recarga':'Recibir devolución'}</button></div></div>`).join('')||'<div class="empty">Sin cilindros pendientes registrados. Si todavía no hiciste el conteo, cargalos allí.</div>';
    $$('[data-gas-holder]').forEach(b=>b.onclick=()=>{const h=G.holders.find(x=>x.id===b.dataset.gasHolder);movement(h.location==='supplier'?'refill':'return_empty',h.product_id,h);});
    const events=G.events.filter(e=>!G.gas||e.product_id===G.gas);
    $('#gasPeriod').innerHTML=rows().filter(r=>!G.gas||r.product_id===G.gas).map(r=>{const a=events.filter(e=>e.product_id===r.product_id&&e.action!=='count'),entered=a.reduce((t,e)=>t+Math.max(0,n(e.full_delta)),0),left=a.reduce((t,e)=>t+Math.max(0,-n(e.full_delta)),0),empty=a.reduce((t,e)=>t+Math.max(0,n(e.empty_delta)),0),diff=entered-left;return`<div class="card"><h3>${s(gasTitle(r))}</h3><div class="gas-period-values"><span>Entraron llenos <b>${fmt(entered)}</b></span><span>Salieron llenos <b>${fmt(left)}</b></span><span>Diferencial <b>${diff>0?'+':''}${fmt(diff)}</b></span><span>Vacíos recibidos <b>${fmt(empty)}</b></span>${r.kg_per_cylinder!=null?`<span>Gas ingresado <b>${kgFmt(entered*n(r.kg_per_cylinder))} kg</b></span><span>Gas entregado <b>${kgFmt(left*n(r.kg_per_cylinder))} kg</b></span>`:''}</div><div class="hint">${G.from===G.to?s(G.from):s(G.from)+' al '+s(G.to)} · ajustes por conteo se muestran en el historial.</div></div>`;}).join('');
    $('#gasHistory').innerHTML=events.map(e=>`<div class="row"><div class="line"><div class="grow"><div class="title">${s(productRow(e.product_id)?gasTitle(productRow(e.product_id)):'Gas')} · ${s(labels[e.action]||e.action)}</div><div class="subtext">${dt(e.created_at)} · ${s(e.actor_name)}${e.person?' · '+s(e.person):''}${e.destination?' · '+s(e.destination):''}${e.reference?' · Ref. '+s(e.reference):''}</div></div><span class="badge">#${s(e.event_no)}</span></div><div class="gas-event-deltas"><span>Llenos: <b>${n(e.full_delta)>0?'+':''}${fmt(e.full_delta)}</b></span><span>Vacíos: <b>${n(e.empty_delta)>0?'+':''}${fmt(e.empty_delta)}</b></span><span>Saldo de llenos: <b>${fmt(e.full_before)} → ${fmt(e.full_after)}</b></span>${e.detail?.gas_kg_delta!=null?`<span>Gas: <b>${n(e.detail.gas_kg_delta)>0?'+':''}${kgFmt(e.detail.gas_kg_delta)} kg</b></span>`:''}</div>${e.notes?`<div class="hint">${s(e.notes)}</div>`:''}</div>`).join('')||'<div class="empty">Sin movimientos de gases en el período elegido.</div>';
  }
  function form(title,html,submit,afterSave){
    openModal(title,whName(G.warehouse),`<form id="gasForm" class="gas-form">${html}<div id="gasFormError" role="alert"></div><button class="btn primary" type="submit">Registrar</button></form>`);
    $('#gasForm').onsubmit=async e=>{e.preventDefault();const b=e.submitter;if(b.disabled)return;b.disabled=true;b.textContent='Registrando…';let saved=false;try{await submit(Object.fromEntries(new FormData(e.target)),e.target);saved=true;await loadAll(true);closeModal();render();await loadEvents();if(afterSave)await afterSave();}catch(error){if(saved){closeModal();G.error='Operación registrada. No se pudo actualizar la vista: '+error.message;renderResults();}else msg($('#gasFormError'),error.message||String(error));}finally{if(b.isConnected){b.disabled=false;b.textContent='Registrar';}}};
  }
  async function movement(action,id,holder){
    await load();const counted=rows().filter(x=>x.counted_at);if(!counted.length){goPage('gases');return countForm();}
    id=counted.some(x=>x.product_id===id)?id:counted[0].product_id;
    const production=['exit','return_empty','return_full'].includes(action),hasEmpty=['exit','refill'].includes(action),r=productRow(id);
    form(labels[action],`${action==='refill'?select('entry_mode','Tipo de ingreso','<option value="refill">Recarga / canje de vacíos por llenos</option><option value="new_full">Cilindros llenos nuevos o prestados</option>'):''}
      ${select('product_id','Gas y presentación',choices(counted,id,'product_id','display_name'))}<div class="notice" id="gasAvailable">Llenos disponibles: <b>${fmt(r.full_qty)}</b> · vacíos en depósito: <b>${fmt(r.empty_qty)}</b></div>
      <div class="two">${input('quantity',action==='return_empty'||action==='send_refill'?'Cantidad de vacíos':'Cantidad de llenos','number','required min="1" max="1000000" step="1"')}${hasEmpty?input('empty_quantity',action==='exit'?'Vacíos que devuelve en esta entrega':'Vacíos entregados al proveedor en este canje','number','min="0" max="1000000" step="1"','0'):''}</div>
      ${input('person',production?'Persona que retira / devuelve':'Proveedor / persona que recibe','text','required maxlength="160" list="gasPeople" autocomplete="off"',holder?.person||'')}<datalist id="gasPeople"></datalist>
      ${action==='exit'?`<div class="two">${input('destination','Destino / trabajo','text','required maxlength="240"',holder?.destination||'')}${select('barge_id','Barcaza (opcional)','<option value="">Sin barcaza</option>'+choices(D.barges.filter(b=>b.active).map(b=>({id:b.id,name:'Barcaza '+b.number})),null))}</div>`:''}
      ${input('reference','Vale / remito / referencia','text','maxlength="160"')}${input('notes','Observación','text','maxlength="2000"')}
      ${['refill'].includes(action)&&profile.role==='admin'?`<div class="two">${input('unit_cost','Precio de la recarga por cilindro (opcional)','number','min="0" step="any"')}${select('currency','Moneda','<option value="">Sin precio</option><option value="PYG">PYG</option><option value="USD">USD</option>')}</div>`:''}
      <div class="notice gas-weight" id="gasWeightPreview" aria-live="polite"></div><div class="hint" id="gasFormHint">${action==='exit'?'Cada lleno entregado queda pendiente hasta que devuelven el envase.':'Elegí la misma persona o proveedor que figura en los pendientes.'}</div>`,
      d=>command(d.entry_mode||action,{...d,warehouse_id:G.warehouse}));
    function hints(){const p=productRow($('#gas-product_id').value),loc=production?'production':'supplier';$('#gasAvailable').innerHTML=`Llenos disponibles: <b>${fmt(p.full_qty)}</b> · vacíos en depósito: <b>${fmt(p.empty_qty)}</b>`;const people=[...new Set([...holders(p.product_id).filter(h=>h.location===loc).map(h=>h.person),...(!production?D.suppliers.filter(x=>x.active!==false).map(x=>x.name):[])])];$('#gasPeople').innerHTML=people.map(name=>`<option value="${s(name)}"></option>`).join('');const pending=holders(p.product_id).find(h=>h.location===loc&&h.person.toLowerCase()===$('#gas-person').value.trim().toLowerCase());$('#gasFormHint').textContent=pending?`${pending.person}: ${fmt(pending.quantity)} cilindros pendientes. ${action==='exit'?'La entrega suma pendientes y los vacíos devueltos los descuentan.':''}`:action==='refill'?'En una recarga, los llenos recibidos deben corresponder a vacíos entregados ahora o pendientes con el proveedor.':'Usá el nombre registrado en los pendientes para devolver cilindros.';}
    function weightPreview(){const p=productRow($('#gas-product_id').value),q=n($('#gas-quantity').value),emptyOnly=['return_empty','send_refill'].includes(action);$('#gasWeightPreview').textContent=emptyOnly?'Este movimiento registra envases vacíos; no suma kg de gas.':p.kg_per_cylinder!=null?`${fmt(q)} cilindros × ${kgFmt(p.kg_per_cylinder)} kg = ${kgFmt(q*n(p.kg_per_cylinder))} kg de gas.`:'Esta presentación todavía no tiene un peso registrado. En Nuevo conteo podés agregar la presentación en kg.';}$('#gas-product_id').onchange=()=>{hints();weightPreview();};$('#gas-quantity').oninput=weightPreview;$('#gas-person').oninput=hints;hints();weightPreview();
    $('#gas-entry_mode')?.addEventListener('change',e=>{const empty=$('#gas-empty_quantity');empty.disabled=e.target.value==='new_full';if(empty.disabled)empty.value='0';$('#gasFormHint').textContent=empty.disabled?'Este ingreso incorpora cilindros; no descuenta pendientes con el proveedor.':'La recarga/canje descuenta vacíos entregados ahora o pendientes con el proveedor.';});
  }
  async function ensurePresentation(kind,kg){
    const user=profile?.id;
    const r=await rpc('gas_ensure_presentation',{p_warehouse_id:G.warehouse,p_gas_kind:kind,p_kg_per_cylinder:Number(kg)});
    if(r.error)throw Error(r.error);
    if(user!==profile?.id)throw Error('La sesión cambió. Volvé a abrir Gases.');
    return r.data;
  }
  const weightButtons=()=>'<div class="gas-size-buttons">'+[20,25,30,50].map(kg=>`<button class="btn sm soft" type="button" data-gas-size="${kg}">${kg} kg</button>`).join('')+'</div>';
  function bindSizes(target){$$('[data-gas-size]').forEach(b=>b.onclick=()=>{const field=$(target);field.value=b.dataset.gasSize;field.dispatchEvent(new Event('input',{bubbles:true}));});}
  function presentationForm(){
    form('Agregar presentación de gas',`${select('kind','Gas',choices(kinds,'co2'))}${input('kg','Kg de gas por cilindro','number','required min="0.001" max="1000" step="0.001"')}${weightButtons()}<p class="hint">Podés escribir cualquier peso hasta tres decimales. Registrá el contenido de gas indicado por el proveedor, sin sumar el peso del envase. Después completá el conteo de esta presentación.</p>`,d=>ensurePresentation(d.kind,d.kg),()=>countForm());
    bindSizes('#gas-kg');
  }
  async function countForm(){
    await load();if(!rows().length)return;
    const snapshot=rows().map(r=>({...r})),entries=[...snapshot];let serial=0;
    const groupHTML=r=>`<fieldset class="gas-count-group" data-gas-count="${r.product_id}"><legend>${s(gasTitle(r))}</legend>${r.draft?'<button class="btn sm" type="button" data-remove-presentation>Quitar presentación sin guardar</button>':''}<div class="two">${input('full_'+r.product_id,'Cilindros llenos en depósito','number','required min="0" max="1000000" step="1"')}${input('empty_'+r.product_id,'Cilindros vacíos en depósito','number','required min="0" max="1000000" step="1"')}</div><div class="hint" data-count-difference>Saldo actual de llenos: ${fmt(r.full_qty)}. Ingresá el conteo físico.</div><h4>Cilindros fuera del depósito</h4><div data-count-holders></div><button class="btn sm soft" type="button" data-add-holder>+ Persona o proveedor</button><p class="hint">Si falta identificar al responsable, anotá “Pendientes del conteo”.</p></fieldset>`;
    form('Nuevo conteo de gases',`<div class="notice"><b>Contá antes de registrar.</b> Separá los envases por gas y por kg. Escribí <b>0</b> donde no hay ninguno y revisá los cilindros fuera del depósito. Podés agregar varias presentaciones abajo: por ejemplo, 20 kg y 50 kg del mismo gas.</div>
      <div id="gasCountGroups" class="gas-form">${entries.map(groupHTML).join('')}</div>
      <div class="card gas-presentation-draft"><h4>Agregar otra presentación al conteo</h4><div class="two">${select('new_kind','Gas',choices(kinds,'co2'))}${input('new_kg','Kg de gas por cilindro','number','min="0.001" max="1000" step="0.001"')}</div>${weightButtons()}<button class="btn soft" type="button" id="gasAddCountSize">+ Agregar esta presentación</button><div id="gasSizeError" role="alert"></div><p class="hint">El peso corresponde al gas, sin el envase. Una presentación nueva no agrega stock hasta guardar el conteo.</p></div>
      ${input('notes','Motivo / observación del conteo','text','required minlength="5" maxlength="2000"')}
      <label class="gas-check"><input type="checkbox" required> Revisé todas las presentaciones de gases, incluidos los cilindros fuera del depósito.</label>`,
      async(d,f)=>{
        // Keep each resolved presentation/version across retries. A lost response
        // must retry the exact same count payload and request key.
        const items=[];
        for(const r of entries){
          const group=f.querySelector(`[data-gas-count="${r.product_id}"]`);
          const item={product_id:r.product_id,expected_version:r.version,full_qty:Number(d['full_'+r.product_id]),empty_qty:Number(d['empty_'+r.product_id]),holders:[...group.querySelectorAll('[data-count-holder]')].map(h=>({person:h.querySelector('[data-person]').value,location:h.querySelector('[data-location]').value,quantity:Number(h.querySelector('[data-quantity]').value)}))};
          if(r.draft){
            if(!r.resolved){
              const found=await ensurePresentation(r.gas_kind,r.kg_per_cylinder);
              if(found.counted_at||n(found.full_qty)||n(found.empty_qty)||n(found.outside_qty)||n(found.supplier_qty))throw Error('Esa presentación fue registrada mientras contabas. Volvé a abrir el conteo y revisá sus saldos.');
              r.resolved=found;group.querySelector('[data-remove-presentation]').disabled=true;
            }
            item.product_id=r.resolved.product_id;item.expected_version=r.resolved.version;
          }
          items.push(item);
        }
        return command('count',{warehouse_id:G.warehouse,notes:d.notes,items});
      });
    function bindGroup(r){
      const group=document.querySelector(`[data-gas-count="${r.product_id}"]`);
      function add(h={}){const row=document.createElement('div');row.className='gas-count-holder';row.dataset.countHolder='';row.innerHTML=`<input data-person aria-label="Persona o proveedor" placeholder="Persona o proveedor" maxlength="160" value="${s(h.person||'')}" required><select data-location aria-label="Ubicación"><option value="production" ${h.location==='production'?'selected':''}>En uso / por devolver</option><option value="supplier" ${h.location==='supplier'?'selected':''}>Con proveedor</option></select><input data-quantity aria-label="Cilindros pendientes" type="number" min="1" max="1000000" step="1" required placeholder="Cantidad" value="${h.quantity??''}"><button class="btn sm" type="button" aria-label="Quitar responsable">Quitar</button>`;row.querySelector('button').onclick=()=>row.remove();group.querySelector('[data-count-holders]').appendChild(row);}
      holders(r.product_id).forEach(add);group.querySelector('[data-add-holder]').onclick=()=>add();
      group.querySelector('[data-remove-presentation]')?.addEventListener('click',()=>{entries.splice(entries.indexOf(r),1);group.remove();});
      group.querySelector(`[name="full_${r.product_id}"]`).oninput=e=>{const q=Number(e.target.value),diff=q-n(r.full_qty);group.querySelector('[data-count-difference]').textContent=e.target.value===''?`Saldo actual de llenos: ${fmt(r.full_qty)}.`:`Sistema: ${fmt(r.full_qty)} · contado: ${fmt(q)} · diferencia: ${diff>0?'+':''}${fmt(diff)} cilindros.${r.kg_per_cylinder!=null?' Gas disponible: '+kgFmt(q*n(r.kg_per_cylinder))+' kg.':''}`;};
    }
    entries.forEach(bindGroup);bindSizes('#gas-new_kg');
    $('#gasAddCountSize').onclick=()=>{
      const field=$('#gas-new_kg'),kg=Number(field.value),kind=$('#gas-new_kind').value;
      if(!field.value||!field.checkValidity()||!Number.isFinite(kg)||kg<=0)return msg($('#gasSizeError'),'Indicá los kg de gas por cilindro.');
      if(entries.some(r=>r.gas_kind===kind&&n(r.kg_per_cylinder)===kg))return msg($('#gasSizeError'),'Esa presentación ya está en el conteo. Completá su fila.');
      const r={product_id:'draft-'+(++serial),gas_kind:kind,kg_per_cylinder:kg,full_qty:0,version:0,draft:true};entries.push(r);
      $('#gasCountGroups').insertAdjacentHTML('beforeend',groupHTML(r));bindGroup(r);field.value='';$('#gasSizeError').replaceChildren();
      document.querySelector(`[name="full_${r.product_id}"]`).focus();
    };
  }
  function exportCSV(){
    if(G.error)return msg($('#gasError'),'Actualizá los datos antes de descargar el historial.');
    const clean=v=>{const x=String(v??'');return '"'+(typeof v!=='number'&&/^[=+\-@\t\r]/.test(x)?"'"+x:x).replaceAll('"','""')+'"';};
    const records=G.events.filter(e=>!G.gas||e.product_id===G.gas);
    const data=[['Fecha','Gas','Movimiento','Kg por cilindro','Kg de gas + / -','Llenos + / -','Vacíos + / -','Llenos antes','Llenos después','Persona / proveedor','Destino','Referencia','Registrado por','Observación'],...records.map(e=>[e.created_at,productRow(e.product_id)?.gas_name,labels[e.action]||e.action,e.detail?.kg_per_cylinder??'',e.detail?.gas_kg_delta??'',n(e.full_delta),n(e.empty_delta),n(e.full_before),n(e.full_after),e.person,e.destination,e.reference,e.actor_name,e.notes])];
    const url=URL.createObjectURL(new Blob(['\uFEFF'+data.map(row=>row.map(clean).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=`Gases_${whName(G.warehouse).replace(/[^\w-]/g,'_')}_${G.from}_${G.to}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function syncHome(){
    if(!permitted())return;const host=$('#page-home');if(!host||!canRefreshView(host))return;
    let box=$('#gasHomeSummary');if(!box){box=document.createElement('div');box.id='gasHomeSummary';box.className='card gas-home';host.appendChild(box);}
    const mine=profile.role==='depositor'?G.rows.filter(x=>x.warehouse_id===profile.warehouse_id):G.rows;
    box.innerHTML=`<div><div class="eyebrow">CO₂ · OXÍGENO · GLP</div><h3>Control de gases</h3><p>${mine.filter(r=>r.counted_at).length} controles con conteo · ${fmt(mine.reduce((a,r)=>a+n(r.outside_qty),0))} cilindros por devolver</p></div><button class="btn primary" type="button">Abrir gases</button>`;box.querySelector('button').onclick=()=>goPage('gases');
  }
  async function refresh(){try{await load();render();await loadEvents();if(afterSave)await afterSave();}catch(error){G.error=error.message||String(error);renderResults();}}
  const oldGo=window.goPage;window.goPage=function(page){if(page==='gases'&&!permitted())return;const result=oldGo.apply(this,arguments);if(page==='gases'){render();refresh();}return result;};
  const oldLoad=window.loadAll;window.loadAll=async function(force=false){await oldLoad.apply(this,arguments);if(!permitted())return;await load();if($('#page-gases')?.classList.contains('on')&&canRefreshView('#page-gases')){render();await loadEvents();}};
  window.AVHGases={state:G,refresh,command,openCount:countForm,openMovement:movement};
})();
