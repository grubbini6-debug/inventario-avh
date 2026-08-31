// AVH V6: integración fina de Compras con tiempo real, auditoría, alertas y panel gerencial.
(function(){
  D.purchaseAlerts=D.purchaseAlerts||[];
  const purchaseStyle=document.createElement('style');
  purchaseStyle.textContent=`.purchase-alert-row{border-left:4px solid var(--amber)}.purchase-alert-row.critical{border-left-color:var(--red)}.purchase-audit-row{border-left:3px solid #d9e7de}.purchase-audit-row.receipt{border-left-color:var(--green)}.purchase-report-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}@media(min-width:760px){.purchase-report-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}`;
  document.head.appendChild(purchaseStyle);

  const STATUS_LABEL={draft:'Borrador',requested:'Solicitado',quoted:'Cotizando',approved:'Aprobado',ordered:'Comprado / pedido',in_transit:'En camino',partially_received:'Recibido parcial',received:'Recibido total',invoiced:'Facturado',closed:'Cerrado',cancelled:'Cancelado'};
  const AUDIT_LABEL={purchase_created:'Compra creada',purchase_updated:'Compra modificada',purchase_status_changed:'Estado de compra modificado',purchase_received:'Compra recibida',purchase_stock_entry_created:'Entrada de stock generada desde compra',purchase_document_uploaded:'Documento de compra cargado'};
  const pItems=id=>(D.purchaseItems||[]).filter(x=>x.purchase_id===id);
  const pPendingQty=p=>pItems(p.id).reduce((a,x)=>a+Math.max(0,Number(x.quantity||0)-Number(x.received_qty||0)),0);
  const pAllReceived=p=>pItems(p.id).length>0&&pItems(p.id).every(x=>Number(x.received_qty||0)>=Number(x.quantity||0));
  const pAnyReceived=p=>pItems(p.id).some(x=>Number(x.received_qty||0)>0);
  const pTotal=p=>Number(p.total_amount||pItems(p.id).reduce((a,x)=>a+Number(x.quantity||0)*Number(x.unit_price||0),0));
  const pCompany=id=>(D.purchaseCompanies||[]).find(x=>x.id===id)?.name||'';
  const pSupplier=id=>(D.suppliers||[]).find(x=>x.id===id)?.name||'';
  function toastPurchase(text){const t=document.querySelector('.avh-toast');if(!t)return;t.textContent=text;t.classList.add('on');clearTimeout(window.__avhPurchaseToast);window.__avhPurchaseToast=setTimeout(()=>t.classList.remove('on'),3800)}

  const prevLoadAllV6=window.loadAll;
  window.loadAll=async function(force=false){
    await prevLoadAllV6(force);
    if(!profile)return;
    try{const a=await query('v_purchase_alerts','*','order=days_late.desc');D.purchaseAlerts=a.data||[]}catch{D.purchaseAlerts=[]}
    if(activeModule==='alerts'&&profile.role==='admin')try{window.renderAlerts()}catch{}
    if(activeModule==='reports'&&profile.role==='admin')try{window.renderReports()}catch{}
    if(activeModule==='audit'&&profile.role==='admin')try{window.renderAudit()}catch{}
  };

  let ps=null,ph=null,pr=null,pRef=5000,pStarted=null,pRefresh=null;
  const pTopic='realtime:avh-compras';
  function closePurchaseRealtime(){clearInterval(ph);clearTimeout(pr);clearTimeout(pRefresh);if(ps){try{ps.onclose=null;ps.close()}catch{}ps=null}}
  function schedulePurchaseReload(){clearTimeout(pRefresh);pRefresh=setTimeout(async()=>{if(!profile)return;try{await loadAll(true)}catch{}},650)}
  function startPurchaseRealtime(force=false){
    if(!profile||!session?.access_token)return;
    if(!force&&ps&&[WebSocket.OPEN,WebSocket.CONNECTING].includes(ps.readyState)&&pStarted===profile.id)return;
    closePurchaseRealtime();pStarted=profile.id;
    const wsBase=API.replace(/^https:/,'wss:').replace(/^http:/,'ws:');
    ps=new WebSocket(`${wsBase}/realtime/v1/websocket?apikey=${encodeURIComponent(KEY)}&vsn=1.0.0`);
    ps.onopen=()=>{ps.send(JSON.stringify({topic:pTopic,event:'phx_join',payload:{config:{broadcast:{ack:false,self:false},presence:{key:''},postgres_changes:['purchases','purchase_items','purchase_receipts','purchase_documents','purchase_companies'].map(table=>({event:'*',schema:'public',table}))},access_token:session.access_token},ref:String(pRef++)}));ph=setInterval(()=>{if(ps?.readyState===WebSocket.OPEN)ps.send(JSON.stringify({topic:'phoenix',event:'heartbeat',payload:{},ref:String(pRef++)}))},25000)};
    ps.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}if(m.event!=='postgres_changes')return;const d=m.payload?.data||{},rec=d.record||{},table=d.table||'';
      if(table==='purchases'&&d.type==='INSERT'&&profile.role==='depositor'&&rec.warehouse_id===profile.warehouse_id&&['ordered','in_transit'].includes(rec.status))toastPurchase('Nueva compra pendiente de recepción en tu depósito');
      if(table==='purchase_receipts'&&d.type==='INSERT'&&profile.role==='admin')toastPurchase('Nueva recepción de compra registrada');
      schedulePurchaseReload();
    };
    ps.onclose=()=>{clearInterval(ph);ps=null;if(profile&&session){clearTimeout(pr);pr=setTimeout(()=>startPurchaseRealtime(true),2400)}};
  }
  let ready=0;(function boot(){if(profile&&session?.access_token){startPurchaseRealtime();return}if(++ready<50)setTimeout(boot,500)})();

  const prevRenderPurchases=window.renderPurchases;
  window.renderPurchases=function(){
    prevRenderPurchases();
    document.querySelectorAll('[data-purchase]').forEach(row=>{const p=D.purchases?.find(x=>x.id===row.dataset.purchase);if(!p)return;const items=pItems(p.id),bar=row.querySelector('.purchase-progress i');if(!bar||!items.length)return;const avg=items.reduce((a,x)=>a+Math.min(1,Number(x.received_qty||0)/Math.max(Number(x.quantity||0),1e-9)),0)/items.length;bar.style.width=`${Math.round(avg*100)}%`});
  };

  const prevOpenPurchaseDetail=window.openPurchaseDetail;
  window.openPurchaseDetail=async function(id){
    await prevOpenPurchaseDetail(id);
    const p=D.purchases?.find(x=>x.id===id);if(!p||profile?.role!=='admin')return;
    const sel=document.querySelector('#pdStatus');if(!sel)return;
    const any=pAnyReceived(p),pending=pPendingQty(p)>0;
    [...sel.options].forEach(o=>{
      if(['partially_received','received'].includes(o.value)&&o.value!==p.status)o.disabled=true;
      if(any&&['draft','requested','quoted','approved','cancelled'].includes(o.value)&&o.value!==p.status)o.disabled=true;
      if(p.destination_type==='warehouse'&&pending&&['invoiced','closed'].includes(o.value)&&o.value!==p.status)o.disabled=true;
    });
    const card=sel.closest('.card');
    if(card&&!card.querySelector('.purchase-state-help')){const h=document.createElement('div');h.className='hint purchase-state-help';h.style.marginTop='8px';h.textContent='Recibido parcial/total lo actualiza el depósito automáticamente. Si ya hubo recepción, la compra no se puede cancelar ni volver a estados anteriores.';card.appendChild(h)}
    const two=card?.querySelector('.two');if(two&&!document.querySelector('#pdInvoiceDate')){const f=document.createElement('div');f.className='field';f.style.margin='0';f.innerHTML=`<label>Fecha factura</label><input id="pdInvoiceDate" type="date" value="${p.invoice_date||''}">`;two.appendChild(f)}
    const save=document.querySelector('#pdSave');if(save)save.onclick=async()=>{save.disabled=true;const r=await rpc('admin_update_purchase',{p_purchase_id:id,p_patch:{status:sel.value,invoice_number:document.querySelector('#pdInvoice')?.value.trim()||null,invoice_date:document.querySelector('#pdInvoiceDate')?.value||null,expected_date:document.querySelector('#pdExpected')?.value||null,order_reference:document.querySelector('#pdReference')?.value.trim()||null}});save.disabled=false;if(r.error)return msg(document.querySelector('#pdMsg'),r.error);msg(document.querySelector('#pdMsg'),'Compra actualizada.',true);await loadAll(true);setTimeout(()=>window.openPurchaseDetail(id),100)};
  };

  document.addEventListener('change',e=>{const el=e.target;if(!(el instanceof HTMLSelectElement)||el.id!=='pciUnit'||el.value!=='otro')return;const u=prompt('Escribí la unidad real (ej.: juego, kit, balde, lote):');if(!u?.trim()){el.value='unidad';return}const value=u.trim().toLowerCase();const op=document.createElement('option');op.value=value;op.textContent=value;el.appendChild(op);el.value=value});
  document.addEventListener('click',e=>{const b=e.target?.closest?.('#pcSave');if(!b)return;const dest=document.querySelector('#pcDest')?.value;if(dest&&dest!=='warehouse'&&/entra a stock/i.test(document.querySelector('#pcCart')?.textContent||'')){e.preventDefault();e.stopImmediatePropagation();alert('Hay un ítem marcado para ingresar a stock, pero el destino ya no es un depósito. Quitá ese ítem y volvé a agregarlo como compra directa/servicio.');}},true);

  const prevAlerts=window.renderAlerts;
  window.renderAlerts=function(){
    prevAlerts();if(profile?.role!=='admin')return;const host=document.querySelector('#moduleContent');if(!host)return;const rows=(D.purchaseAlerts||[]).filter(x=>Number(x.pending_items||0)>0);
    const sec=document.createElement('div');sec.innerHTML=`<div class="section-head"><div><h2>Compras que requieren atención</h2><p>Entregas atrasadas y compras urgentes pendientes</p></div><span class="badge ${rows.some(x=>x.alert_level==='critical')?'red':'amber'}">${rows.length}</span></div><div class="list">${rows.map(x=>`<div class="row clickable purchase-alert-row ${x.alert_level==='critical'?'critical':''}" data-alert-purchase="${x.purchase_id}"><div class="line"><div><div class="title">${esc(x.supplier_name||'Proveedor sin definir')} · ${esc(x.company_name||'')}</div><div class="subtext">${esc(x.warehouse_name||'')} · ${x.pending_items} ítem${Number(x.pending_items)===1?'':'s'} pendiente${Number(x.pending_items)===1?'':'s'}${Number(x.days_late)>0?` · <b>${x.days_late} días de atraso</b>`:''}</div></div><span class="badge ${x.alert_level==='critical'?'red':'amber'}">${x.urgency==='critical'?'CRÍTICA':Number(x.days_late)>0?'ATRASADA':'URGENTE'}</span></div></div>`).join('')||'<div class="empty">No hay compras atrasadas o urgentes pendientes.</div>'}</div>`;host.appendChild(sec);sec.querySelectorAll('[data-alert-purchase]').forEach(x=>x.onclick=()=>window.openPurchaseDetail(x.dataset.alertPurchase));
  };

  const prevReports=window.renderReports;
  window.renderReports=function(){
    prevReports();if(profile?.role!=='admin')return;const host=document.querySelector('#moduleContent');if(!host)return;const now=new Date(),start=new Date(now.getFullYear(),now.getMonth(),1);const month=(D.purchases||[]).filter(p=>p.status!=='cancelled'&&new Date((p.ordered_date||'1900-01-01')+'T12:00:00')>=start);const usd=month.filter(p=>p.currency==='USD').reduce((a,p)=>a+pTotal(p),0),pyg=month.filter(p=>p.currency==='PYG').reduce((a,p)=>a+pTotal(p),0),open=(D.purchases||[]).filter(p=>!['closed','cancelled'].includes(p.status)).length,late=(D.purchaseAlerts||[]).filter(x=>Number(x.days_late||0)>0).length;const byCompany=(D.purchaseCompanies||[]).map(c=>{const ps=month.filter(p=>p.company_id===c.id);return{name:c.name,usd:ps.filter(p=>p.currency==='USD').reduce((a,p)=>a+pTotal(p),0),pyg:ps.filter(p=>p.currency==='PYG').reduce((a,p)=>a+pTotal(p),0),n:ps.length}}).filter(x=>x.n).sort((a,b)=>(b.usd+b.pyg)-(a.usd+a.pyg));
    const sec=document.createElement('div');sec.innerHTML=`<div class="section-head"><div><h2>Compras — gestión</h2><p>Integrado con empresas, proveedores y recepciones</p></div></div><div class="purchase-report-grid"><div class="kpi"><div class="label">Compras abiertas</div><div class="value">${open}</div><div class="meta">Sin cerrar/cancelar</div></div><div class="kpi ${late?'alert':''}"><div class="label">Entregas atrasadas</div><div class="value">${late}</div><div class="meta">Con saldo pendiente</div></div><div class="kpi"><div class="label">Comprado este mes USD</div><div class="value" style="font-size:17px">${money(usd,'USD')}</div><div class="meta">Todas las empresas</div></div><div class="kpi"><div class="label">Comprado este mes PYG</div><div class="value" style="font-size:17px">${money(pyg,'PYG')}</div><div class="meta">Todas las empresas</div></div></div><div class="section-head"><h2>Compras por empresa — mes actual</h2></div><div class="list">${byCompany.map(x=>`<div class="row"><div class="line"><div><div class="title">${esc(x.name)}</div><div class="subtext">${x.n} compra${x.n===1?'':'s'}</div></div><div style="text-align:right"><b>${money(x.usd,'USD')}</b><br><span class="subtext">${money(x.pyg,'PYG')}</span></div></div></div>`).join('')||'<div class="empty">Todavía no hay compras cargadas este mes.</div>'}</div>`;host.appendChild(sec);
  };

  const prevAudit=window.renderAudit;
  window.renderAudit=function(){
    prevAudit();if(profile?.role!=='admin')return;const host=document.querySelector('#moduleContent');if(!host)return;const rows=(D.auditEvents||[]).filter(x=>x.purchase_id).slice(0,120);const sec=document.createElement('div');sec.innerHTML=`<div class="section-head"><div><h2>Trazabilidad de Compras</h2><p>Creación, cambios, recepción, documentos y entrada a stock</p></div></div><div class="list">${rows.map(ev=>{const p=D.purchases?.find(x=>x.id===ev.purchase_id),receipt=ev.action==='purchase_received'||ev.action==='purchase_stock_entry_created';return`<div class="row clickable purchase-audit-row ${receipt?'receipt':''}" data-audit-purchase="${ev.purchase_id}"><div class="line"><div><div class="title">${esc(AUDIT_LABEL[ev.action]||String(ev.action||'Evento').replaceAll('_',' '))}</div><div class="subtext">${esc(D.profiles?.find(x=>x.id===ev.actor_id)?.username||'Sistema')} · ${dt(ev.created_at)}${p?` · ${esc(p.supplier_name||pSupplier(p.supplier_id)||'Compra')} · ${esc(p.company_name||pCompany(p.company_id))}`:''}</div></div><span class="badge ${receipt?'green':''}">${esc(ev.entity_type||'compra')}</span></div></div>`}).join('')||'<div class="empty">Todavía no hay actividad de Compras.</div>'}</div>`;host.appendChild(sec);sec.querySelectorAll('[data-audit-purchase]').forEach(x=>x.onclick=()=>window.openPurchaseDetail(x.dataset.auditPurchase));
  };
})();
