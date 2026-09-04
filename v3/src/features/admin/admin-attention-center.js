// AVH — Centro de atención del administrador.
(function(){
  const isAdmin=()=>profile?.role==='admin';
  const safe=s=>typeof esc==='function'?esc(String(s??'')):String(s??'');
  const rank={critical:0,action:1,info:2};
  let cache=null,filter='all';

  const style=document.createElement('style');
  style.textContent=`
    .ac-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.ac-kpi{border:1px solid #dfe8e2;border-radius:14px;padding:12px;background:#fff}.ac-kpi.critical{border-left:4px solid #c8443e}.ac-kpi.action{border-left:4px solid #d49a28}.ac-kpi.ok{border-left:4px solid #3b8b5c}.ac-kpi .n{font-size:27px;font-weight:900;margin-top:3px}.ac-list{display:grid;gap:8px}.ac-row{border:1px solid #dfe8e2;border-radius:13px;padding:11px;background:#fff;cursor:pointer}.ac-row.critical{border-left:4px solid #c8443e}.ac-row.action{border-left:4px solid #d49a28}.ac-row.info{border-left:4px solid #6c8799}.ac-row .subtext{font-size:11px;line-height:1.45}.ac-toolbar{display:flex;gap:7px;flex-wrap:wrap}.ac-chip{border:1px solid #dce6df;background:#fff;border-radius:999px;padding:6px 10px;font-size:11px;cursor:pointer}.ac-chip.on{background:#153126;color:#fff;border-color:#153126}.ac-empty{padding:22px;text-align:center;border:1px dashed #cfdcd4;border-radius:14px;color:#65776d;background:#fbfdfc}@media(max-width:720px){.ac-grid{grid-template-columns:1fr 1fr}}`;
  document.head.appendChild(style);

  const wh=id=>(D.warehouses||[]).find(x=>x.id===id)?.name||'Depósito';
  const sup=id=>(D.suppliers||[]).find(x=>x.id===id)?.name||'Proveedor';

  async function load(){
    const [stock,pAlerts,supply,corr,pReq,pDel,opening,docs,receipts,purchases]=await Promise.all([
      query('v_smart_stock_alerts'),
      query('v_purchase_alerts'),
      query('supply_requests','*','order=created_at.desc&limit=250'),
      query('correction_requests','*','order=created_at.desc&limit=200'),
      query('product_requests','*','order=created_at.desc&limit=150'),
      query('product_deletion_requests','*','order=created_at.desc&limit=150'),
      query('warehouse_opening_inventory','*','order=opened_at.desc'),
      query('purchase_documents','*','order=created_at.desc&limit=500'),
      query('purchase_receipts','*','order=received_at.desc&limit=500'),
      query('purchases','id,po_number,status,supplier_id,warehouse_id,expected_date,urgency,created_at','order=created_at.desc&limit=500')
    ]);
    const d={stock:stock.data||[],pAlerts:pAlerts.data||[],supply:supply.data||[],corr:corr.data||[],pReq:pReq.data||[],pDel:pDel.data||[],opening:opening.data||[],docs:docs.data||[],receipts:receipts.data||[],purchases:purchases.data||[]};
    const opens=d.opening.filter(x=>x.status==='open');
    d.openingDetails=await Promise.all(opens.map(async s=>{
      const r=await rpc('admin_opening_inventory_lines',{p_warehouse_id:s.warehouse_id});
      const rows=r.error?[]:(r.data||[]).filter(x=>x.movement_line_id);
      return{...s,lines:rows.length,unpriced:rows.filter(x=>!x.priced).length};
    }));
    cache=d;
  }

  function rows(){
    const d=cache||{},out=[];
    (d.stock||[]).filter(x=>x.alert_level==='critical').forEach(x=>out.push({level:'critical',kind:'stock',wid:x.warehouse_id,pid:x.product_id,title:`Stock crítico · ${x.product_name}`,detail:`${x.warehouse_name} · ${fmt(x.stock_qty)} ${x.base_unit}`}));
    (d.stock||[]).filter(x=>x.alert_level==='low').slice(0,12).forEach(x=>out.push({level:'action',kind:'stock',wid:x.warehouse_id,pid:x.product_id,title:`Stock bajo · ${x.product_name}`,detail:`${x.warehouse_name} · cobertura ${fmt(x.coverage_days||0)} días`}));
    (d.corr||[]).filter(x=>x.status==='pending').forEach(x=>out.push({level:'critical',kind:'alerts',title:'Corrección de movimiento pendiente',detail:`${x.reason||'Sin motivo'} · ${dt(x.created_at)}`}));
    (d.supply||[]).filter(x=>['pending','in_progress'].includes(x.status)).forEach(x=>out.push({level:x.urgency==='critical'?'critical':'action',kind:'alerts',title:`Abastecimiento · ${x.requested_name}`,detail:`${wh(x.warehouse_id)} · ${fmt(x.quantity)} ${x.unit} · ${x.urgency||'normal'}`}));
    (d.pReq||[]).filter(x=>x.status==='pending').forEach(x=>out.push({level:'action',kind:'alerts',title:`Alta de producto · ${x.proposed_name}`,detail:`${x.proposed_unit||''} · pendiente de aprobación`}));
    (d.pDel||[]).filter(x=>x.status==='pending').forEach(x=>out.push({level:'action',kind:'alerts',title:`Baja de producto · ${x.product_name_snapshot}`,detail:x.reason||'Pendiente de revisión'}));

    (d.docs||[]).filter(x=>x.kind==='invoice'&&x.analysis_status==='error').forEach(doc=>{
      const p=(d.purchases||[]).find(x=>x.id===doc.purchase_id);
      out.push({level:'critical',kind:'purchase',purchaseId:doc.purchase_id,title:`Factura con error · ${p?.po_number||'Compra'}`,detail:doc.analysis_error||'Revisar análisis de factura'});
    });

    const invIds=new Set((d.docs||[]).filter(x=>x.kind==='invoice').map(x=>x.purchase_id));
    [...new Set((d.receipts||[]).map(x=>x.purchase_id))].filter(id=>!invIds.has(id)).forEach(id=>{
      const p=(d.purchases||[]).find(x=>x.id===id);if(p)out.push({level:'action',kind:'purchase',purchaseId:id,title:`Falta factura · ${p.po_number||'Compra'}`,detail:`${sup(p.supplier_id)} · mercadería ya recibida`});
    });

    (d.pAlerts||[]).filter(x=>Number(x.days_late||0)>0).forEach(x=>out.push({level:Number(x.days_late)>=3?'critical':'action',kind:'purchase',purchaseId:x.purchase_id,title:`Compra atrasada · ${x.supplier_name||'Proveedor'}`,detail:`${x.days_late} día(s) · ${x.pending_items||0} ítem(s) pendientes`}));
    (d.pAlerts||[]).filter(x=>x.status==='partially_received'&&Number(x.days_late||0)<=0).forEach(x=>out.push({level:'action',kind:'purchase',purchaseId:x.purchase_id,title:`Recepción parcial · ${x.supplier_name||'Proveedor'}`,detail:`${x.pending_items||0} ítem(s) pendientes`}));

    (d.openingDetails||[]).forEach(x=>out.push({level:x.unpriced>0?'action':'info',kind:'opening',warehouseId:x.warehouse_id,title:`Inventario inicial abierto · ${wh(x.warehouse_id)}`,detail:x.lines===0?'Todavía sin productos':x.unpriced>0?`${x.unpriced} de ${x.lines} sin precio`:'Todo valorizado · listo para cerrar'}));

    (D.moves||[]).filter(x=>x.type==='transfer'&&x.status==='in_transit').forEach(x=>out.push({level:'action',kind:'transfer',title:`Transferencia #${x.movement_no} en tránsito`,detail:`${wh(x.warehouse_from_id)} → ${wh(x.warehouse_to_id)}`}));

    const seen=new Set();
    return out.filter(r=>{const k=[r.kind,r.title,r.purchaseId||'',r.wid||'',r.warehouseId||''].join('|');if(seen.has(k))return false;seen.add(k);return true}).sort((a,b)=>(rank[a.level]??9)-(rank[b.level]??9));
  }

  function go(r){
    if(r.kind==='stock'){goPage('stock');if($('#stockWarehouse'))$('#stockWarehouse').value=r.wid||'all';renderStock();return}
    if(r.kind==='purchase'&&r.purchaseId&&typeof window.openPurchaseDetail==='function'){window.openPurchaseDetail(r.purchaseId);return}
    if(r.kind==='opening'){goPage('more');activeModule='admin';activeAdminTab='opening';renderAdmin('opening');return}
    if(r.kind==='transfer'){goPage('moves');if($('#moveType'))$('#moveType').value='transfer';renderMoves();return}
    goPage('more');renderModule('alerts');
  }

  function draw(){
    const all=rows(),critical=all.filter(x=>x.level==='critical').length,action=all.filter(x=>x.level==='action').length,visible=filter==='all'?all:all.filter(x=>x.level===filter);
    $('#moduleContent').innerHTML=`<div class="section-head"><div><h2>🎯 Centro de atención</h2><p>Solo lo que necesita una decisión o seguimiento tuyo</p></div><button id="acRefresh" class="btn sm soft">↻ Actualizar</button></div>
    <div class="ac-grid"><div class="ac-kpi critical"><div class="label">Crítico</div><div class="n">${critical}</div><div class="subtext">Atender primero</div></div><div class="ac-kpi action"><div class="label">Requiere acción</div><div class="n">${action}</div><div class="subtext">Pendientes operativos</div></div><div class="ac-kpi ok"><div class="label">Estado</div><div class="n">${critical+action?'ACTIVO':'OK'}</div><div class="subtext">${critical+action?'Hay cosas para revisar':'Sin pendientes importantes'}</div></div></div>
    <div class="section-head"><div><h2>Prioridades</h2><p>${all.length} asunto(s)</p></div></div>
    <div class="ac-toolbar"><button class="ac-chip ${filter==='all'?'on':''}" data-ac-filter="all">Todo</button><button class="ac-chip ${filter==='critical'?'on':''}" data-ac-filter="critical">🔴 Crítico</button><button class="ac-chip ${filter==='action'?'on':''}" data-ac-filter="action">🟠 Acción</button><button class="ac-chip ${filter==='info'?'on':''}" data-ac-filter="info">🔵 Seguimiento</button></div>
    <div class="ac-list" style="margin-top:10px">${visible.map((r,i)=>`<div class="ac-row ${r.level}" data-ac-row="${i}"><div class="line"><div class="grow"><div class="title">${safe(r.title)}</div><div class="subtext">${safe(r.detail)}</div></div><span class="badge ${r.level==='critical'?'red':r.level==='action'?'amber':''}">${r.level==='critical'?'CRÍTICO':r.level==='action'?'ACCIÓN':'SEGUIR'}</span></div></div>`).join('')||'<div class="ac-empty">No hay asuntos en esta categoría.</div>'}</div>`;
    $$('[data-ac-row]').forEach(el=>el.onclick=()=>go(visible[Number(el.dataset.acRow)]));
    $$('[data-ac-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.acFilter;draw()});
    $('#acRefresh').onclick=()=>render(true);
  }

  async function render(force=false){
    if(!isAdmin())return;
    activeModule='admin-attention';
    $('#moduleContent').innerHTML='<div class="empty">Revisando operación…</div>';
    try{if(force||!cache)await load();draw()}catch(e){$('#moduleContent').innerHTML=`<div class="empty">${safe(e.message||String(e))}</div>`}
  }
  window.renderAdminAttention=render;

  function ensureCard(){
    const grid=document.querySelector('#page-more .more-grid');if(!grid||!profile)return;
    let b=grid.querySelector('#adminAttentionModule');
    if(!isAdmin()){b?.remove();return}
    if(!b){b=document.createElement('button');b.id='adminAttentionModule';b.className='card more-card';b.innerHTML='<span>🎯</span><strong>Centro de atención</strong><small>Lo que requiere tu decisión hoy</small>';grid.prepend(b)}
    b.onclick=()=>{goPage('more');render(true)};
  }

  const baseRenderModule=window.renderModule;
  window.renderModule=function(name){if(name==='admin-attention'){activeModule=name;return render(true)}return baseRenderModule(name)};
  const baseLoadAll=window.loadAll;
  window.loadAll=async function(force=false){await baseLoadAll(force);cache=null;ensureCard();if(activeModule==='admin-attention'&&isAdmin())render(true)};
  const observer=new MutationObserver(ensureCard);observer.observe(document.body,{childList:true,subtree:true});
  let tries=0;(function boot(){ensureCard();if(!document.querySelector('#adminAttentionModule')&&++tries<60)setTimeout(boot,250)})();
})();
