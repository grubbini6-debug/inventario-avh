// AVH — Solicitudes de abastecimiento: depositario -> admin -> seguimiento.
(function(){
  D.supplyRequests=D.supplyRequests||[];
  const UNITS=['unidad','pieza','kg','tonelada','rollo','bobina','caja','paquete','bolsa','metro','m²','m³','litro','cilindro','tambor','pallet','plancha','barra','tubo','perfil','bidón','otro'];
  const STATUS={pending:'Pendiente',in_progress:'En gestión',fulfilled:'Atendida',rejected:'Rechazada'};
  const URG={normal:'Normal',urgent:'Urgente',critical:'Crítica'};
  const REASONS=['Sin stock','Stock crítico','Reposición preventiva','Necesidad nueva','Uso urgente','Otro'];

  const style=document.createElement('style');
  style.textContent=`.sr-status{display:flex;gap:6px;flex-wrap:wrap}.sr-card{border-left:4px solid #dfe9e2}.sr-card.urgent{border-left-color:var(--amber)}.sr-card.critical{border-left-color:var(--red)}.sr-badge{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:99px;background:var(--red);color:#fff;font-size:11px;font-weight:900;margin-left:6px}`;
  document.head.appendChild(style);

  function requestStatusBadge(s){const cls=s==='fulfilled'?'green':s==='rejected'?'red':s==='pending'||s==='in_progress'?'amber':'';return `<span class="badge ${cls}">${esc(STATUS[s]||s)}</span>`}
  function requestWarehouse(r){return whName(r.warehouse_id)||'Depósito'}
  function requestUser(r){return (D.profiles||[]).find(x=>x.id===r.requested_by)?.username||'Depositario'}
  function openCount(){return (D.supplyRequests||[]).filter(x=>['pending','in_progress'].includes(x.status)).length}
  function myOpenCount(){return (D.supplyRequests||[]).filter(x=>x.requested_by===profile?.id&&['pending','in_progress'].includes(x.status)).length}

  async function loadSupplyRequests(){
    if(!profile)return;
    const r=await query('supply_requests','*','order=created_at.desc&limit=250');
    D.supplyRequests=r.data||[];
  }

  function ensureRequestShortcut(){
    const grid=document.querySelector('#page-more .more-grid');
    if(!grid||!profile)return;
    let b=grid.querySelector('#supplyRequestModule');
    if(profile.role==='depositor'){
      if(!b){b=document.createElement('button');b.id='supplyRequestModule';b.className='card more-card';grid.prepend(b)}
      const n=myOpenCount();
      b.innerHTML=`<span>📝</span><strong>Solicitar abastecimiento${n?` <i class="sr-badge">${n}</i>`:''}</strong><small>Pedir materiales al administrador</small>`;
      b.onclick=()=>{activeModule='supply-requests';renderSupplyRequests()};
      b.style.display='';
    }else if(b)b.style.display='none';

    const alertBtn=grid.querySelector('[data-module="alerts"]');
    if(alertBtn&&profile.role==='admin'){
      alertBtn.querySelector('.sr-badge')?.remove();
      const n=openCount();
      if(n){const badge=document.createElement('i');badge.className='sr-badge';badge.textContent=n;alertBtn.querySelector('strong')?.appendChild(badge)}
    }
  }

  function openNewSupplyRequest(productId=null,urgency='normal'){
    if(profile?.role!=='depositor')return;
    const current=productId?product(productId):null;
    openModal('Solicitar abastecimiento','La solicitud llegará al administrador y quedará pendiente hasta ser atendida.',`
      <div class="field"><label>Material</label><select id="srProduct"><option value="">Elegir producto</option>${D.products.filter(x=>x.active).map(p=>`<option value="${p.id}" ${p.id===productId?'selected':''}>${esc(p.name)} · ${esc(p.base_unit)}</option>`).join('')}<option value="__free">No está en el catálogo</option></select></div>
      <div id="srFree" class="field hide"><label>Qué necesitás</label><input id="srName" placeholder="Ej.: Manguera para oxígeno 3/8"></div>
      <div class="two"><div class="field"><label>Cantidad</label><input id="srQty" type="number" step="0.001" min="0.001"></div><div class="field"><label>Unidad</label><select id="srUnit">${UNITS.map(u=>`<option value="${u}" ${u===(current?.base_unit||'unidad')?'selected':''}>${u}</option>`).join('')}</select></div></div>
      <div class="two"><div class="field"><label>Urgencia</label><select id="srUrgency"><option value="normal" ${urgency==='normal'?'selected':''}>Normal</option><option value="urgent" ${urgency==='urgent'?'selected':''}>Urgente</option><option value="critical" ${urgency==='critical'?'selected':''}>Crítica</option></select></div><div class="field"><label>Motivo</label><select id="srReason">${REASONS.map(x=>`<option>${x}</option>`).join('')}</select></div></div>
      <div class="field"><label>Detalle / observación</label><textarea id="srNotes" placeholder="Ej.: necesitamos reponer antes del turno de tarde"></textarea></div>
      <button id="srSend" class="btn primary" style="width:100%">Enviar solicitud</button><div id="srMsg"></div>`);
    const sync=()=>{const v=$('#srProduct').value,p=product(v);$('#srFree').classList.toggle('hide',v!=='__free');if(p&&UNITS.includes(p.base_unit))$('#srUnit').value=p.base_unit};
    $('#srProduct').onchange=sync;sync();
    $('#srSend').onclick=async()=>{const b=$('#srSend'),pid=$('#srProduct').value,name=$('#srName')?.value.trim()||'',qty=Number($('#srQty').value),unit=$('#srUnit').value,urg=$('#srUrgency').value,reason=$('#srReason').value,notes=$('#srNotes').value.trim();if(!pid)return msg($('#srMsg'),'Elegí un producto o la opción “No está en el catálogo”.');if(pid==='__free'&&!name)return msg($('#srMsg'),'Escribí qué material necesitás.');if(!qty||qty<=0)return msg($('#srMsg'),'Indicá una cantidad mayor a cero.');b.disabled=true;b.textContent='Enviando…';const r=await rpc('create_supply_request',{p_product_id:pid==='__free'?null:pid,p_name:pid==='__free'?name:null,p_quantity:qty,p_unit:unit,p_urgency:urg,p_reason:reason,p_notes:notes||null});b.disabled=false;b.textContent='Enviar solicitud';if(r.error)return msg($('#srMsg'),r.error);closeModal();await loadAll(true);activeModule='supply-requests';renderSupplyRequests()};
  }
  window.openNewSupplyRequest=openNewSupplyRequest;

  window.renderSupplyRequests=function(){
    if(profile?.role!=='depositor')return;
    const mine=(D.supplyRequests||[]).filter(x=>x.requested_by===profile.id);
    $('#moduleContent').innerHTML=`<div class="section-head"><div><h2>Solicitudes de abastecimiento</h2><p>Pedí lo que falta aunque no esté cargado en inventario</p></div><button id="newSupplyRequest" class="btn sm primary">+ Nueva solicitud</button></div><div class="grid kpis" style="grid-template-columns:repeat(2,1fr)"><div class="kpi alert"><div class="label">Pendientes</div><div class="value">${mine.filter(x=>x.status==='pending').length}</div><div class="meta">Esperando revisión</div></div><div class="kpi transit"><div class="label">En gestión</div><div class="value">${mine.filter(x=>x.status==='in_progress').length}</div><div class="meta">Ya la están gestionando</div></div></div><div class="section-head"><h2>Historial</h2></div><div class="list">${mine.map(r=>`<div class="row sr-card ${r.urgency}"><div class="line"><div class="grow"><div class="title">${esc(r.requested_name)} · ${fmt(r.quantity)} ${esc(r.unit)}</div><div class="subtext">${esc(requestWarehouse(r))} · ${esc(URG[r.urgency]||r.urgency)} · ${dt(r.created_at)}${r.reason?`<br>${esc(r.reason)}`:''}${r.notes?` · ${esc(r.notes)}`:''}${r.resolution_notes?`<br><b>Respuesta:</b> ${esc(r.resolution_notes)}`:''}</div></div>${requestStatusBadge(r.status)}</div></div>`).join('')||'<div class="empty">Todavía no enviaste solicitudes.</div>'}</div>`;
    $('#newSupplyRequest').onclick=()=>openNewSupplyRequest();
  };

  async function reviewRequest(id,status){
    const r=(D.supplyRequests||[]).find(x=>x.id===id);if(!r||profile?.role!=='admin')return;
    let notes='';
    if(status==='fulfilled')notes=prompt('Observación opcional para el depositario (ej.: comprado / enviado / disponible):')||'';
    if(status==='rejected'){notes=prompt('Motivo del rechazo:')||'';if(!notes.trim())return}
    const out=await rpc('review_supply_request',{p_request_id:id,p_status:status,p_notes:notes.trim()||null});if(out.error)return alert(out.error);await loadAll(true);renderAlerts();
  }

  function injectAdminRequests(){
    if(profile?.role!=='admin')return;
    const host=$('#moduleContent');if(!host)return;
    const open=(D.supplyRequests||[]).filter(x=>['pending','in_progress'].includes(x.status));
    const sec=document.createElement('div');sec.id='supplyAdminSection';sec.innerHTML=`<div class="section-head"><div><h2>Solicitudes de abastecimiento</h2><p>Pedidos enviados directamente por los depositarios</p></div><span class="badge ${open.length?'amber':'green'}">${open.length} ABIERTA${open.length===1?'':'S'}</span></div><div class="list">${open.map(r=>`<div class="row sr-card ${r.urgency}"><div class="line"><div class="grow"><div class="title">${esc(r.requested_name)} · ${fmt(r.quantity)} ${esc(r.unit)}</div><div class="subtext"><b>${esc(requestUser(r))}</b> · ${esc(requestWarehouse(r))} · ${esc(URG[r.urgency]||r.urgency)} · ${dt(r.created_at)}${r.reason?`<br>${esc(r.reason)}`:''}${r.notes?` · ${esc(r.notes)}`:''}</div></div>${requestStatusBadge(r.status)}</div><div class="split-actions" style="margin-top:8px">${r.status==='pending'?`<button class="btn sm soft" data-sr-action="in_progress" data-sr-id="${r.id}">En gestión</button>`:''}<button class="btn sm primary" data-sr-action="fulfilled" data-sr-id="${r.id}">Atendida</button><button class="btn sm danger" data-sr-action="rejected" data-sr-id="${r.id}">Rechazar</button></div></div>`).join('')||'<div class="empty">No hay solicitudes de abastecimiento abiertas.</div>'}</div>`;
    const first=host.querySelector('.section-head');first?.insertAdjacentElement('afterend',sec);
    $$('[data-sr-action]').forEach(b=>b.onclick=()=>reviewRequest(b.dataset.srId,b.dataset.srAction));
    const kpis=[...host.querySelectorAll('.kpi')];const pendingKpi=kpis.find(k=>k.querySelector('.label')?.textContent.trim()==='Pendientes admin');if(pendingKpi){const val=pendingKpi.querySelector('.value');if(val)val.textContent=Number(val.textContent||0)+open.length}
  }

  function injectCriticalRequestButtons(){
    if(profile?.role!=='depositor')return;
    $$('[data-smart-stock]').forEach(row=>{if(row.querySelector('[data-sr-quick]'))return;const [wid,pid]=row.dataset.smartStock.split('|');if(wid!==profile.warehouse_id)return;const b=document.createElement('button');b.type='button';b.className='btn sm soft';b.dataset.srQuick=pid;b.textContent='Solicitar reposición';b.onclick=e=>{e.stopPropagation();openNewSupplyRequest(pid,'critical')};row.querySelector('.line')?.appendChild(b)});
  }

  const baseRenderAlerts=window.renderAlerts;
  if(typeof baseRenderAlerts==='function')window.renderAlerts=function(){const x=baseRenderAlerts.apply(this,arguments);setTimeout(()=>{injectAdminRequests();injectCriticalRequestButtons();ensureRequestShortcut()},0);return x};

  const baseRenderModule=window.renderModule;
  if(typeof baseRenderModule==='function')window.renderModule=function(name){if(name==='supply-requests'){activeModule=name;return renderSupplyRequests()}return baseRenderModule(name)};

  const baseLoadAll=window.loadAll;
  window.loadAll=async function(force=false){await baseLoadAll(force);if(!profile)return;await loadSupplyRequests();ensureRequestShortcut();if(activeModule==='supply-requests'&&profile.role==='depositor')renderSupplyRequests();if(activeModule==='alerts')renderAlerts()};

  const observer=new MutationObserver(()=>ensureRequestShortcut());observer.observe(document.body,{childList:true,subtree:true});
})();