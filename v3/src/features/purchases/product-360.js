// AVH V3 — Ficha 360° del producto.
// Consolida inventario, abastecimiento, consumo, compras, precios, proveedores y barcazas.
(function(){
  const n=v=>Number.isFinite(Number(v))?Number(v):0;
  const d=v=>{if(!v)return'—';try{return new Date(String(v).length===10?v+'T12:00:00':v).toLocaleDateString('es-PY')}catch{return String(v)}};
  const cash=(v,c)=>typeof money==='function'?money(v,c):`${c||''} ${n(v).toLocaleString('es-PY')}`;
  const prod=id=>(D.products||[]).find(x=>x.id===id);
  const purchase=id=>(D.purchases||[]).find(x=>x.id===id);
  const supplier=id=>(D.suppliers||[]).find(x=>x.id===id);
  const barge=id=>(D.barges||[]).find(x=>x.id===id);

  function purchaseRows(productId){
    return (D.purchaseItems||[]).filter(i=>i.product_id===productId).map(i=>{
      const p=purchase(i.purchase_id);if(!p||p.status==='cancelled')return null;
      const factor=n(i.factor_to_base)||1;
      return{
        purchase:p,item:i,supplier:supplier(p.supplier_id),
        date:p.ordered_date||p.created_at||i.created_at,
        currency:p.currency||'PYG',
        base_qty:n(i.quantity)*factor,
        received_base_qty:n(i.received_qty)*factor,
        base_price:n(i.unit_price)/factor
      };
    }).filter(Boolean).sort((a,b)=>new Date(b.date)-new Date(a.date));
  }

  function priceGroups(rows){
    const map=new Map;
    rows.forEach(x=>{const a=map.get(x.currency)||[];a.push(x);map.set(x.currency,a)});
    return [...map.entries()].map(([currency,list])=>{
      const qty=list.reduce((s,x)=>s+x.base_qty,0);
      const last=list[0]||null;
      const best=list.length?list.reduce((a,b)=>b.base_price<a.base_price?b:a):null;
      const avg=qty?list.reduce((s,x)=>s+x.base_price*x.base_qty,0)/qty:0;
      const spend=list.reduce((s,x)=>s+x.base_price*x.base_qty,0);
      return{currency,list,qty,last,best,avg,spend};
    });
  }

  function supplierStats(rows){
    const map=new Map;
    rows.forEach(x=>{
      const id=x.purchase.supplier_id||'none';
      let o=map.get(id);
      if(!o){o={id,name:x.supplier?.name||'Sin proveedor',purchaseIds:new Set,qty:0,lastDate:null,prices:new Map};map.set(id,o)}
      o.purchaseIds.add(x.purchase.id);o.qty+=x.base_qty;
      if(!o.lastDate||new Date(x.date)>new Date(o.lastDate))o.lastDate=x.date;
      const cur=o.prices.get(x.currency)||[];cur.push(x);o.prices.set(x.currency,cur);
    });
    return [...map.values()].sort((a,b)=>b.purchaseIds.size-a.purchaseIds.size||b.qty-a.qty);
  }

  function stockRows(productId){
    const base=typeof stockDataset==='function'?stockDataset():(D.stocks||[]);
    const map=new Map;
    base.filter(x=>x.product_id===productId).forEach(x=>map.set(x.warehouse_id,{...x}));
    (D.smartAlerts||[]).filter(x=>x.product_id===productId).forEach(x=>{
      const prev=map.get(x.warehouse_id)||x;
      map.set(x.warehouse_id,{...prev,...x});
    });
    return [...map.values()].sort((a,b)=>n(b.stock_qty)-n(a.stock_qty));
  }

  function bargeRows(productId){
    const map=new Map;
    (D.bargeConsumption||[]).filter(x=>x.product_id===productId).forEach(x=>{
      let o=map.get(x.barge_id);
      if(!o){o={id:x.barge_id,number:x.barge_number||barge(x.barge_id)?.number,qty:0,costs:{}};map.set(x.barge_id,o)}
      o.qty+=n(x.base_quantity);
      if(x.currency)o.costs[x.currency]=(o.costs[x.currency]||0)+n(x.real_cost);
    });
    return [...map.values()].sort((a,b)=>b.qty-a.qty);
  }

  function recentMovements(productId){
    return (D.moves||[]).filter(m=>(m.movement_lines||[]).some(l=>l.product_id===productId)).slice(0,10);
  }

  function riskSummary(rows,p){
    const alerts=rows.filter(x=>x.alert_level&&x.alert_level!=='normal');
    const critical=alerts.filter(x=>x.alert_level==='critical');
    const recommended=rows.reduce((s,x)=>s+n(x.recommended_buy_qty),0);
    const inbound=rows.reduce((s,x)=>s+n(x.inbound_qty),0);
    const stock=rows.reduce((s,x)=>s+n(x.stock_qty),0);
    const dates=rows.map(x=>x.projected_stockout_date).filter(Boolean).sort();
    const level=critical.length?'critical':alerts.length?'low':'normal';
    const reasons=[...new Set(alerts.map(x=>x.risk_reason).filter(Boolean))];
    let text='Sin alerta de abastecimiento con los datos actuales.';
    if(level==='critical')text=reasons[0]||'Hay riesgo crítico de abastecimiento.';
    else if(level==='low')text=reasons[0]||'Conviene revisar la reposición.';
    return{alerts,critical,recommended,inbound,stock,level,reasons,text,stockout:dates[0]||null,unit:p?.base_unit||''};
  }

  function stockHtml(rows,focusId){
    return rows.map(x=>`<div class="p360-stock ${x.warehouse_id===focusId?'focus':''}">
      <div class="line"><div><b>${esc(x.warehouse_name||whName(x.warehouse_id))}</b><div class="subtext">Mínimo ${x.minimum_qty==null?'no definido':fmt(x.minimum_qty)+' '+esc(x.base_unit||'')}</div></div><div style="text-align:right"><div class="num">${fmt(x.stock_qty)} ${esc(x.base_unit||'')}</div><span class="badge ${x.alert_level==='critical'?'red':x.alert_level==='low'?'amber':'green'}">${x.alert_level==='critical'?'CRÍTICO':x.alert_level==='low'?'REVISAR':'NORMAL'}</span></div></div>
      <div class="metric-pills">${x.coverage_days!=null?`<span>${fmt(x.coverage_days)} días cobertura</span>`:''}${n(x.inbound_qty)>0?`<span>${fmt(x.inbound_qty)} ${esc(x.base_unit||'')} en camino</span>`:''}${x.next_expected_date?`<span>llega ${d(x.next_expected_date)}</span>`:''}</div>
    </div>`).join('')||'<div class="empty">Sin stock ni parámetros registrados en depósitos.</div>';
  }

  function priceHtml(groups,unit){
    return groups.map(g=>`<div class="p360-price-card">
      <div class="eyebrow">${esc(g.currency)}</div>
      <div class="p360-price-main">${g.last?cash(g.last.base_price,g.currency):'—'} <small>/ ${esc(unit)}</small></div>
      <div class="p360-price-meta">
        <span>Último · ${g.last?esc(g.last.supplier?.name||'Sin proveedor'):'—'} · ${g.last?d(g.last.date):'—'}</span>
        <span>Mejor · ${g.best?cash(g.best.base_price,g.currency):'—'}</span>
        <span>Promedio · ${cash(g.avg,g.currency)}</span>
        <span>Comprado · ${fmt(g.qty)} ${esc(unit)}</span>
      </div>
    </div>`).join('')||'<div class="empty">Sin historial de precios comparable.</div>';
  }

  function supplierHtml(rows,unit){
    return rows.slice(0,6).map(x=>{
      const priceText=[...x.prices.entries()].map(([c,list])=>{list.sort((a,b)=>new Date(b.date)-new Date(a.date));return`${esc(c)} ${cash(list[0].base_price,c)} / ${esc(unit)}`}).join(' · ');
      return`<div class="row"><div class="line"><div><div class="title">${esc(x.name)}</div><div class="subtext">${x.purchaseIds.size} compra${x.purchaseIds.size===1?'':'s'} · ${fmt(x.qty)} ${esc(unit)} · última ${d(x.lastDate)}<br>${priceText}</div></div></div></div>`;
    }).join('')||'<div class="empty">Sin proveedores vinculados a compras del producto.</div>';
  }

  function bargeHtml(rows,unit){
    return rows.slice(0,8).map(x=>{
      const costs=Object.entries(x.costs).map(([c,v])=>cash(v,c)).join(' · ');
      return`<div class="row clickable" data-p360-barge="${x.id}"><div class="line"><div><div class="title">Barcaza ${esc(x.number||'—')}</div><div class="subtext">${costs||'Sin costo FIFO disponible'}</div></div><div class="num">${fmt(x.qty)} ${esc(unit)}</div></div></div>`;
    }).join('')||'<div class="empty">Todavía no hay salidas asociadas a barcazas para este producto.</div>';
  }

  function lotsHtml(lots,unit){
    return lots.slice(0,12).map(l=>`<div class="row"><div class="line"><div><div class="title">${esc(l.lot_reference||('#'+(l.movement_no||'')))}</div><div class="subtext">${esc(l.warehouse_name||whName(l.warehouse_id)||'Depósito')} · ${esc(l.supplier_name||'Sin proveedor')} · ${d(l.received_at)}</div></div><div style="text-align:right"><div class="num">${fmt(l.quantity_remaining)} ${esc(unit)}</div><div class="subtext">${l.unit_cost==null?'Sin costo':cash(l.unit_cost,l.currency)+' / '+esc(unit)}</div></div></div></div>`).join('')||'<div class="empty">Sin lotes abiertos.</div>';
  }

  window.openProduct360=async function(productId,focusWarehouseId=null){
    if(profile?.role!=='admin'){
      const legacy=window.AVHOperationalStockDetail;
      return legacy?legacy(focusWarehouseId,productId):null;
    }
    const p=prod(productId);if(!p)return;
    openModal(p.name,'Ficha 360° · Inventario + Compras + Consumo','<div class="empty">Armando ficha 360°…</div>');
    const [consRes,lotsRes]=await Promise.all([
      query('v_product_360_consumption','*',`product_id=eq.${productId}`),
      query('v_inventory_batch_detail','*',`product_id=eq.${productId}&order=received_at.asc`)
    ]);
    const cons=consRes.data?.[0]||{};
    const lots=lotsRes.data||[];
    const stocks=stockRows(productId);
    const prs=purchaseRows(productId);
    const groups=priceGroups(prs);
    const suppliers=supplierStats(prs);
    const barges=bargeRows(productId);
    const recent=recentMovements(productId);
    const risk=riskSummary(stocks,p);
    const uniquePurchases=new Set(prs.map(x=>x.purchase.id));
    const totalStock=stocks.reduce((s,x)=>s+n(x.stock_qty),0);
    const avgDaily=n(cons.qty_30d)/30;
    const globalCoverage=avgDaily>0?totalStock/avgDaily:null;
    const overallInbound=stocks.reduce((s,x)=>s+n(x.inbound_qty),0);
    const latestPurchase=prs[0]||null;

    $('#modalBody').innerHTML=`
      <div class="p360-hero ${risk.level}">
        <div><div class="eyebrow">DECISIÓN DE ABASTECIMIENTO</div><h3>${esc(risk.text)}</h3><div class="subtext">${risk.stockout?`Agotamiento estimado más próximo: <b>${d(risk.stockout)}</b> · `:''}Stock total: <b>${fmt(totalStock)} ${esc(p.base_unit)}</b>${overallInbound>0?` · En camino: <b>${fmt(overallInbound)} ${esc(p.base_unit)}</b>`:''}</div></div>
        <span class="badge ${risk.level==='critical'?'red':risk.level==='low'?'amber':'green'}">${risk.level==='critical'?'CRÍTICO':risk.level==='low'?'REVISAR':'NORMAL'}</span>
      </div>
      ${risk.recommended>0?`<div class="notice p360-recommend">Compra sugerida con la regla actual: <b>${fmt(risk.recommended)} ${esc(p.base_unit)}</b> para recuperar cobertura.</div>`:''}

      <div class="p360-kpis">
        <div class="kpi"><div class="label">Stock total</div><div class="value">${fmt(totalStock)}</div><div class="meta">${esc(p.base_unit)} · ${stocks.length} depósito${stocks.length===1?'':'s'}</div></div>
        <div class="kpi"><div class="label">Cobertura global</div><div class="value">${globalCoverage==null?'—':fmt(globalCoverage)}</div><div class="meta">${globalCoverage==null?'Sin consumo 30d':'días al ritmo 30d'}</div></div>
        <div class="kpi"><div class="label">Consumo 30 días</div><div class="value">${fmt(cons.qty_30d||0)}</div><div class="meta">${esc(p.base_unit)} · ${cons.exits_30d||0} salidas</div></div>
        <div class="kpi"><div class="label">Consumo 60 días</div><div class="value">${fmt(cons.qty_60d||0)}</div><div class="meta">${esc(p.base_unit)} · ${cons.exits_60d||0} salidas</div></div>
        <div class="kpi"><div class="label">Consumo 90 días</div><div class="value">${fmt(cons.qty_90d||0)}</div><div class="meta">${esc(p.base_unit)} · ${cons.exits_90d||0} salidas</div></div>
        <div class="kpi"><div class="label">Compras registradas</div><div class="value">${uniquePurchases.size}</div><div class="meta">${suppliers.length} proveedor${suppliers.length===1?'':'es'}${latestPurchase?` · última ${d(latestPurchase.date)}`:''}</div></div>
      </div>

      <div class="p360-actions">
        <button id="p360Prices" class="btn sm soft">📈 Historial de precios</button>
        <button id="p360Purchases" class="btn sm soft">🛒 Ver compras del producto</button>
      </div>

      <div class="section-head"><div><h2>Stock por depósito</h2><p>Existencia, mínimo, cobertura y mercadería en camino</p></div></div>
      <div class="p360-stock-grid">${stockHtml(stocks,focusWarehouseId)}</div>

      <div class="section-head"><div><h2>Precios</h2><p>Último, mejor y promedio ponderado por moneda</p></div></div>
      <div class="p360-price-grid">${priceHtml(groups,p.base_unit)}</div>

      <div class="section-head"><div><h2>Proveedores</h2><p>Historial real de compras de este producto</p></div></div>
      <div class="list">${supplierHtml(suppliers,p.base_unit)}</div>

      <div class="section-head"><div><h2>Consumo por barcaza</h2><p>Cantidad consumida y costo FIFO cuando está disponible</p></div></div>
      <div class="list">${bargeHtml(barges,p.base_unit)}</div>

      <div class="section-head"><div><h2>Lotes abiertos</h2><p>Stock disponible con origen y costo</p></div></div>
      <div class="list">${lotsHtml(lots,p.base_unit)}</div>

      <div class="section-head"><div><h2>Actividad reciente</h2><p>Últimos movimientos cargados que incluyen este producto</p></div></div>
      <div class="list">${recent.length?movementRows(recent):'<div class="empty">Sin movimientos recientes en la ventana cargada.</div>'}</div>
    `;

    $('#p360Prices').onclick=()=>window.openPriceAnalysis?.(productId);
    $('#p360Purchases').onclick=()=>{
      closeModal();goPage('purchases');window.renderPurchases?.();
      setTimeout(()=>{const q=$('#purchaseSearch');if(q){q.value=p.name;q.dispatchEvent(new Event('input',{bubbles:true}));q.focus()}},0);
    };
    $$('[data-p360-barge]').forEach(x=>x.onclick=()=>openBarge(x.dataset.p360Barge));
    bindMovementRows();
  };

  if(!window.AVHOperationalStockDetail)window.AVHOperationalStockDetail=window.openStockDetail;
  const previousStockDetail=window.AVHOperationalStockDetail;
  window.openStockDetail=function(warehouseId,productId){
    if(profile?.role==='admin')return window.openProduct360(productId,warehouseId);
    return previousStockDetail?.(warehouseId,productId);
  };

  function mark360(){
    if(profile?.role!=='admin')return;
    $$('#stockList [data-stock]').forEach(row=>{
      if(row.querySelector('.p360-chip'))return;
      const sub=row.querySelector('.subtext');if(sub)sub.insertAdjacentHTML('beforeend',' <span class="p360-chip">· Ficha 360°</span>');
    });
    $$('#topProducts .row').forEach((row,i)=>{
      const item=(D.productConsumption||[])[i];if(!item||row.dataset.p360Bound)return;
      row.dataset.p360Bound='1';row.classList.add('clickable');row.onclick=()=>openProduct360(item.product_id);
      row.querySelector('.subtext')?.insertAdjacentHTML('beforeend',' · Ficha 360°');
    });
  }

  const oldRenderStock=window.renderStock;
  if(typeof oldRenderStock==='function')window.renderStock=function(){const r=oldRenderStock.apply(this,arguments);mark360();return r};
  const oldRenderHome=window.renderHome;
  if(typeof oldRenderHome==='function')window.renderHome=function(){const r=oldRenderHome.apply(this,arguments);mark360();return r};

  const style=document.createElement('style');
  style.textContent=`
    .p360-hero{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;border:1px solid #dfe9e2;border-left:5px solid var(--green);border-radius:14px;padding:14px;background:#fbfdfb}.p360-hero.critical{border-left-color:var(--red);background:#fff7f6}.p360-hero.low{border-left-color:var(--amber);background:#fffaf0}.p360-hero h3{font-size:16px;margin:3px 0 5px}.p360-recommend{margin-top:10px}.p360-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:10px}.p360-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.p360-stock-grid,.p360-price-grid{display:grid;gap:8px}.p360-stock,.p360-price-card{border:1px solid #dfe9e2;border-radius:12px;padding:11px;background:#fff}.p360-stock.focus{box-shadow:0 0 0 2px rgba(15,90,49,.14);border-color:#8bb99d}.p360-price-main{font-size:18px;font-weight:900;margin-top:4px}.p360-price-main small{font-size:11px;font-weight:600}.p360-price-meta{display:grid;gap:3px;margin-top:7px;font-size:11px;color:#607268}.p360-chip{font-weight:800;color:var(--green)}@media(min-width:760px){.p360-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}.p360-stock-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.p360-price-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}`;
  document.head.appendChild(style);

  setTimeout(mark360,0);
})();