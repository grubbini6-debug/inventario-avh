// AVH V3 — Dashboard de Compras e inteligencia de abastecimiento.
(function(){
  const n=v=>Number.isFinite(Number(v))?Number(v):0;
  const dateOf=p=>new Date((p.ordered_date||p.created_at||'1970-01-01').slice(0,10)+'T12:00:00');
  const within=(p,days)=>dateOf(p)>=new Date(Date.now()-days*86400000);
  const itemsOf=id=>(D.purchaseItems||[]).filter(x=>x.purchase_id===id);
  const valid=rows=>(rows||[]).filter(p=>p.status!=='cancelled');
  const cashTotals=rows=>rows.reduce((a,p)=>{const c=p.currency||'PYG',v=n(p.total_amount)||itemsOf(p.id).reduce((s,i)=>s+n(i.quantity)*n(i.unit_price),0);a[c]=(a[c]||0)+v;return a},{});
  const cashPair=t=>`${money(t.USD||0,'USD')} · ${money(t.PYG||0,'PYG')}`;
  const shortDate=v=>v?new Date(v+'T12:00:00').toLocaleDateString('es-PY',{day:'2-digit',month:'2-digit'}):'—';
  const productName=id=>(D.products||[]).find(x=>x.id===id)?.name||'Producto';
  const supplierName=id=>(D.suppliers||[]).find(x=>x.id===id)?.name||'Sin proveedor';

  function purchasesWindow(rows,days){return valid(rows).filter(p=>within(p,days))}
  function pendingPurchase(p){return p.destination_type==='warehouse'&&['ordered','in_transit','partially_received'].includes(p.status)}
  function latePurchases(rows){
    const today=new Date().toISOString().slice(0,10);
    return valid(rows).filter(p=>pendingPurchase(p)&&p.expected_date&&p.expected_date<today)
      .sort((a,b)=>a.expected_date.localeCompare(b.expected_date));
  }
  function supplierRanking(rows){
    const map=new Map;
    purchasesWindow(rows,90).forEach(p=>{
      const id=p.supplier_id||'none',o=map.get(id)||{id,count:0,USD:0,PYG:0};
      o.count++;const total=n(p.total_amount)||itemsOf(p.id).reduce((s,i)=>s+n(i.quantity)*n(i.unit_price),0);
      o[p.currency]=(o[p.currency]||0)+total;map.set(id,o);
    });
    return [...map.values()].sort((a,b)=>b.count-a.count).slice(0,5);
  }
  function productRanking(rows){
    const ids=new Set(purchasesWindow(rows,90).map(x=>x.id)),map=new Map;
    (D.purchaseItems||[]).filter(i=>ids.has(i.purchase_id)&&i.product_id).forEach(i=>{
      const o=map.get(i.product_id)||{id:i.product_id,qty:0,unit:(D.products||[]).find(p=>p.id===i.product_id)?.base_unit||''};
      o.qty+=n(i.quantity)*(n(i.factor_to_base)||1);map.set(i.product_id,o);
    });
    return [...map.values()].sort((a,b)=>b.qty-a.qty).slice(0,5);
  }
  function priceRows(rows){
    const pmap=new Map(valid(rows).map(p=>[p.id,p])),out=[];
    (D.purchaseItems||[]).forEach(i=>{
      const p=pmap.get(i.purchase_id);if(!p||!i.product_id)return;
      const factor=n(i.factor_to_base)||1;
      out.push({product_id:i.product_id,currency:p.currency||'PYG',date:dateOf(p),price:n(i.unit_price)/factor,qty:n(i.quantity)*factor});
    });
    return out;
  }
  function priceSignals(rows){
    const groups=new Map;
    priceRows(rows).forEach(x=>{const k=x.product_id+'|'+x.currency;const a=groups.get(k)||[];a.push(x);groups.set(k,a)});
    const out=[];
    for(const [k,a] of groups){a.sort((x,y)=>y.date-x.date);if(a.length<2||!a[1].price)continue;const diff=(a[0].price-a[1].price)/a[1].price*100;out.push({product_id:a[0].product_id,currency:a[0].currency,price:a[0].price,previous:a[1].price,diff})}
    return out.sort((a,b)=>Math.abs(b.diff)-Math.abs(a.diff)).slice(0,5);
  }
  function estimatedSavings(rows){
    const all=priceRows(rows).sort((a,b)=>a.date-b.date),cut=new Date(Date.now()-90*86400000),tot={USD:0,PYG:0};
    all.forEach((x,idx)=>{
      if(x.date<cut)return;
      const prev=all.slice(0,idx).filter(y=>y.product_id===x.product_id&&y.currency===x.currency);
      if(!prev.length)return;
      const q=prev.reduce((s,y)=>s+y.qty,0),avg=q?prev.reduce((s,y)=>s+y.price*y.qty,0)/q:0;
      if(avg>x.price)tot[x.currency]=(tot[x.currency]||0)+(avg-x.price)*x.qty;
    });
    return tot;
  }
  function supplyRisks(){
    return (D.smartAlerts||[]).filter(x=>x.alert_level!=='normal')
      .sort((a,b)=>({critical:0,low:1}[a.alert_level]??2)-({critical:0,low:1}[b.alert_level]??2)
        ||n(a.coverage_days)-n(b.coverage_days));
  }
  function pendingItems(p){return itemsOf(p.id).filter(i=>n(i.received_qty)<n(i.quantity)).length}

  function html(rows){
    const p30=purchasesWindow(rows,30),p90=purchasesWindow(rows,90),t30=cashTotals(p30),t90=cashTotals(p90);
    const late=latePurchases(rows),risks=supplyRisks(),critical=risks.filter(x=>x.alert_level==='critical').length;
    const savings=estimatedSavings(rows),suppliers=supplierRanking(rows),products=productRanking(rows),signals=priceSignals(rows);
    return `
      <div class="section-head"><div><h2>Dashboard de Compras</h2><p>Qué requiere atención y cómo viene Compras</p></div></div>
      <div class="purchase-dashboard-kpis">
        <div class="kpi"><div class="label">Comprado 30 días</div><div class="value purchase-dash-money">${money(t30.USD||0,'USD')}</div><div class="meta">${money(t30.PYG||0,'PYG')}</div></div>
        <div class="kpi"><div class="label">Comprado 90 días</div><div class="value purchase-dash-money">${money(t90.USD||0,'USD')}</div><div class="meta">${money(t90.PYG||0,'PYG')}</div></div>
        <div class="kpi ${late.length?'alert':''}"><div class="label">Entregas vencidas</div><div class="value">${late.length}</div><div class="meta">Compras sin completar</div></div>
        <div class="kpi ${risks.length?'alert':''}"><div class="label">Riesgo de abastecimiento</div><div class="value">${risks.length}</div><div class="meta">${critical} críticos</div></div>
        <div class="kpi"><div class="label">Ahorro estimado 90d</div><div class="value purchase-dash-money">${money(savings.USD||0,'USD')}</div><div class="meta">${money(savings.PYG||0,'PYG')} · vs promedio previo</div></div>
      </div>
      <div class="section-head"><div><h2>Atención hoy</h2><p>Stock que puede faltar y entregas atrasadas</p></div></div>
      <div class="purchase-dashboard-grid">
        <div class="card"><div class="eyebrow">ABASTECIMIENTO</div><div class="purchase-dashboard-list">${risks.slice(0,6).map(x=>`
          <div class="purchase-dash-row clickable" data-supply-stock="${x.warehouse_id}|${x.product_id}">
            <div class="grow"><b>${esc(x.product_name)}</b><div class="subtext">${esc(x.warehouse_name)} · stock ${fmt(x.stock_qty)} ${esc(x.base_unit)} · cobertura ${x.coverage_days==null?'sin consumo':fmt(x.coverage_days)+' días'}<br>${esc(x.risk_reason||'Revisar abastecimiento')}${n(x.inbound_qty)>0?` · en camino ${fmt(x.inbound_qty)} ${esc(x.base_unit)}`:''}${x.next_expected_date?` · llega ${shortDate(x.next_expected_date)}`:''}${n(x.recommended_buy_qty)>0?` · sugerido ${fmt(x.recommended_buy_qty)} ${esc(x.base_unit)}`:''}</div></div>
            <span class="badge ${x.alert_level==='critical'?'red':'amber'}">${x.alert_level==='critical'?'CRÍTICO':'REVISAR'}</span>
          </div>`).join('')||'<div class="empty">Sin riesgos de abastecimiento.</div>'}</div></div>
        <div class="card"><div class="eyebrow">ENTREGAS</div><div class="purchase-dashboard-list">${late.slice(0,6).map(p=>{const days=Math.max(1,Math.floor((Date.now()-new Date(p.expected_date+'T12:00:00'))/86400000));return`
          <div class="purchase-dash-row clickable" data-late-purchase="${p.id}"><div class="grow"><b>${esc(p.supplier_name||supplierName(p.supplier_id))}</b><div class="subtext">${esc(p.po_number||p.order_reference||'Sin referencia')} · vencida hace ${days} día${days===1?'':'s'} · ${pendingItems(p)} ítem(s) pendientes</div></div><span class="badge red">VENCIDA</span></div>`}).join('')||'<div class="empty">No hay entregas vencidas.</div>'}</div></div>
      </div>
      <div class="section-head"><div><h2>Últimos 90 días</h2><p>Proveedores, productos y evolución de precios</p></div></div>
      <div class="purchase-dashboard-grid">
        <div class="card"><div class="eyebrow">PROVEEDORES MÁS USADOS</div><div class="purchase-dashboard-list">${suppliers.map(x=>`<div class="purchase-dash-row"><div><b>${esc(supplierName(x.id))}</b><div class="subtext">${x.count} compra${x.count===1?'':'s'}</div></div><div class="num purchase-dash-small">${money(x.USD||0,'USD')}<br>${money(x.PYG||0,'PYG')}</div></div>`).join('')||'<div class="empty">Sin compras en 90 días.</div>'}</div></div>
        <div class="card"><div class="eyebrow">PRODUCTOS MÁS COMPRADOS</div><div class="purchase-dashboard-list">${products.map((x,i)=>`<div class="purchase-dash-row"><div><b>${i+1}. ${esc(productName(x.id))}</b></div><div class="num">${fmt(x.qty)} ${esc(x.unit)}</div></div>`).join('')||'<div class="empty">Sin productos vinculados.</div>'}</div></div>
        <div class="card"><div class="eyebrow">VARIACIÓN DE PRECIOS</div><div class="purchase-dashboard-list">${signals.map(x=>`<div class="purchase-dash-row clickable" data-price-product="${x.product_id}"><div><b>${esc(productName(x.product_id))}</b><div class="subtext">${money(x.previous,x.currency)} → ${money(x.price,x.currency)}</div></div><span class="badge ${x.diff>5?'red':x.diff<0?'green':'amber'}">${x.diff>=0?'+':''}${x.diff.toFixed(1)}%</span></div>`).join('')||'<div class="empty">Todavía no hay suficientes compras comparables.</div>'}</div></div>
      </div>`;
  }

  function bind(){
    document.querySelectorAll('[data-supply-stock]').forEach(x=>x.onclick=()=>openStockDetail(...x.dataset.supplyStock.split('|')));
    document.querySelectorAll('[data-late-purchase]').forEach(x=>x.onclick=()=>window.openPurchaseDetail?.(x.dataset.latePurchase));
    document.querySelectorAll('[data-price-product]').forEach(x=>x.onclick=()=>window.openPriceAnalysis?.(x.dataset.priceProduct));
  }

  function enhanceAlerts(){
    const heading=[...document.querySelectorAll('#moduleContent .section-head h2')].find(x=>x.textContent.trim()==='Riesgo de stock');
    if(heading){
      heading.textContent='Alertas inteligentes de compras';
      const p=heading.parentElement?.querySelector('p');if(p)p.textContent='Stock + consumo 30d + compras en camino + fecha prometida';
    }
    document.querySelectorAll('[data-smart-stock]').forEach(row=>{
      const [warehouseId,productId]=row.dataset.smartStock.split('|');
      const x=(D.smartAlerts||[]).find(a=>a.warehouse_id===warehouseId&&a.product_id===productId);if(!x)return;
      const sub=row.querySelector('.subtext');if(!sub)return;
      const inbound=n(x.inbound_qty),recommended=n(x.recommended_buy_qty);
      sub.innerHTML=`<b>${esc(x.risk_reason||'Revisar abastecimiento')}</b><br>${esc(x.warehouse_name)} · stock ${fmt(x.stock_qty)} ${esc(x.base_unit)} · consumo ${fmt(x.avg_daily_30d)} ${esc(x.base_unit)}/día · cobertura ${x.coverage_days==null?'—':fmt(x.coverage_days)+' días'}${inbound>0?`<br>En camino: <b>${fmt(inbound)} ${esc(x.base_unit)}</b>${x.next_expected_date?` · próxima recepción ${shortDate(x.next_expected_date)}`:''}${x.next_supplier_name?` · ${esc(x.next_supplier_name)}`:''}`:''}${recommended>0?`<br>Compra sugerida: <b>${fmt(recommended)} ${esc(x.base_unit)}</b>`:''}`;
      const badge=row.querySelector('.badge');if(badge)badge.textContent=x.alert_level==='critical'?'CRÍTICO':'REVISAR';
    });
  }

  const style=document.createElement('style');
  style.textContent=`.purchase-dashboard-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.purchase-dashboard-grid{display:grid;gap:10px}.purchase-dashboard-list{display:grid;gap:0}.purchase-dash-row{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid #e7eee9}.purchase-dash-row:last-child{border-bottom:0}.purchase-dash-money{font-size:15px!important}.purchase-dash-small{font-size:11px!important;text-align:right}@media(min-width:900px){.purchase-dashboard-kpis{grid-template-columns:repeat(5,minmax(0,1fr))}.purchase-dashboard-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.purchase-dashboard-grid .card:last-child:nth-child(odd){grid-column:span 2}}`;
  document.head.appendChild(style);
  window.AVHPurchaseDashboard={html,bind,enhanceAlerts};
})();