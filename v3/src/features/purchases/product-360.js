// AVH V3 — Página propia del Producto 360°.
// Consolida inventario, abastecimiento, consumo, compras, precios, proveedores, barcazas y lotes.
(function(){
  let activeProductRecordId=null;
  let activeProductFocusWarehouseId=null;

  const n=v=>Number.isFinite(Number(v))?Number(v):0;
  const d=v=>{if(!v)return'—';try{return new Date(String(v).length===10?v+'T12:00:00':v).toLocaleDateString('es-PY')}catch{return String(v)}};
  const cash=(v,c)=>typeof money==='function'?money(v,c):`${c||''} ${n(v).toLocaleString('es-PY')}`;
  const prod=id=>(D.products||[]).find(x=>x.id===id);
  const purchase=id=>(D.purchases||[]).find(x=>x.id===id);
  const supplier=id=>(D.suppliers||[]).find(x=>x.id===id);
  const barge=id=>(D.barges||[]).find(x=>x.id===id);
  const PURCHASE_STATUS={draft:'Borrador',requested:'Solicitado',quoted:'Cotizando',approved:'Aprobado',ordered:'Comprado / pedido',in_transit:'En camino',partially_received:'Recibido parcial',received:'Recibido total',invoiced:'Facturado',closed:'Cerrado',cancelled:'Cancelado'};

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

  function uniquePurchaseRows(rows){
    const map=new Map;
    rows.forEach(x=>{
      if(!map.has(x.purchase.id))map.set(x.purchase.id,{purchase:x.purchase,items:[],base_qty:0,received_base_qty:0});
      const o=map.get(x.purchase.id);o.items.push(x);o.base_qty+=x.base_qty;o.received_base_qty+=x.received_base_qty;
    });
    return [...map.values()].sort((a,b)=>new Date(b.purchase.ordered_date||b.purchase.created_at)-new Date(a.purchase.ordered_date||a.purchase.created_at));
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
    return (D.moves||[]).filter(m=>(m.movement_lines||[]).some(l=>l.product_id===productId)).slice(0,20);
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

  function ensureProductPage(){
    let page=document.querySelector('#page-product-record');
    if(!page){
      page=document.createElement('section');
      page.id='page-product-record';
      page.className='page';
      document.querySelector('#page-stock')?.after(page);
      if(!page.parentNode)document.querySelector('.app')?.appendChild(page);
    }
    return page;
  }

  function purchaseRef(p){return p.po_number||p.order_reference||('COMPRA-'+String(p.id||'').slice(0,8).toUpperCase())}
  function statusBadge(s){
    const cls=s==='cancelled'?'red':s==='partially_received'||s==='in_transit'?'amber':s==='received'||s==='invoiced'||s==='closed'?'green':'';
    return `<span class="badge ${cls}">${esc(PURCHASE_STATUS[s]||s||'—')}</span>`;
  }

  function stockHtml(rows,focusId){
    return rows.map(x=>`<div class="p360-stock ${x.warehouse_id===focusId?'focus':''}">
      <div class="line"><div><b>${esc(x.warehouse_name||whName(x.warehouse_id))}</b><div class="subtext">Mínimo ${x.minimum_qty==null?'no definido':fmt(x.minimum_qty)+' '+esc(x.base_unit||'')}</div></div><div style="text-align:right"><div class="num">${fmt(x.stock_qty)} ${esc(x.base_unit||'')}</div><span class="badge ${x.alert_level==='critical'?'red':x.alert_level==='low'?'amber':'green'}">${x.alert_level==='critical'?'CRÍTICO':x.alert_level==='low'?'REVISAR':'NORMAL'}</span></div></div>
      <div class="metric-pills">${x.coverage_days!=null?`<span>${fmt(x.coverage_days)} días cobertura</span>`:''}${x.policy_configured?`<span>objetivo ${fmt(x.target_coverage_days)} días</span>`:''}${n(x.inbound_qty)>0?`<span>${fmt(x.inbound_qty)} ${esc(x.base_unit||'')} en camino</span>`:''}${x.next_expected_date?`<span>llega ${d(x.next_expected_date)}</span>`:''}${x.preferred_supplier_name?`<span>preferido: ${esc(x.preferred_supplier_name)}</span>`:''}</div>
    </div>`).join('')||'<div class="empty">Sin stock ni parámetros registrados en depósitos.</div>';
  }

  function minimumPolicy(productId,warehouseId){
    return (D.minimums||[]).find(x=>x.product_id===productId&&x.warehouse_id===warehouseId)||null;
  }

  function smartPolicy(productId,warehouseId){
    return (D.smartAlerts||[]).find(x=>x.product_id===productId&&x.warehouse_id===warehouseId)||null;
  }

  function criticalityLabel(v){return v==='critical'?'Crítico':v==='important'?'Importante':'Normal'}

  function supplyPolicyHtml(productId,p){
    const warehouses=(D.warehouses||[]).filter(x=>x.active);
    return warehouses.map(w=>{
      const policy=minimumPolicy(productId,w.id),smart=smartPolicy(productId,w.id)||{};
      const configured=Boolean(policy);
      const preferred=policy?.preferred_supplier_id?supplier(policy.preferred_supplier_id):null;
      const recommended=n(smart.recommended_buy_qty);
      return `<div class="card supply-policy-card ${configured?'configured':'empty-policy'}">
        <div class="line"><div class="grow"><div class="eyebrow">DEPÓSITO</div><div class="title">${esc(w.name)}</div><div class="subtext">${configured?`Política activa · ${esc(criticalityLabel(policy.criticality))}`:'Sin política definida'}</div></div><span class="badge ${configured?'green':''}">${configured?'CONFIGURADA':'PENDIENTE'}</span></div>
        <div class="supply-policy-metrics">
          <div><span>Stock</span><b>${fmt(smart.stock_qty||0)} ${esc(p.base_unit)}</b></div>
          <div><span>Cobertura</span><b>${smart.coverage_days==null?'—':fmt(smart.coverage_days)+' días'}</b></div>
          <div><span>Objetivo</span><b>${configured?fmt(policy.target_coverage_days)+' días':'—'}</b></div>
          <div><span>Seguridad</span><b>${configured?fmt(policy.safety_stock_qty)+' '+esc(p.base_unit):'—'}</b></div>
          <div><span>Lead time</span><b>${configured?fmt(policy.lead_time_days)+' días':'—'}</b></div>
          <div><span>MOQ</span><b>${configured?fmt(policy.min_order_qty)+' '+esc(p.base_unit):'—'}</b></div>
          <div><span>Múltiplo</span><b>${configured&&policy.order_multiple_qty?fmt(policy.order_multiple_qty)+' '+esc(p.base_unit):'—'}</b></div>
          <div><span>Proveedor</span><b>${esc(preferred?.name||'—')}</b></div>
        </div>
        ${recommended>0?`<div class="notice supply-policy-recommend">Compra sugerida: <b>${fmt(recommended)} ${esc(p.base_unit)}</b>${smart.raw_recommended_buy_qty!=null&&Number(smart.raw_recommended_buy_qty)!==recommended?` · necesidad calculada ${fmt(smart.raw_recommended_buy_qty)}`:''}</div>`:''}
        <div class="split-actions" style="margin-top:10px"><button class="btn sm soft" data-edit-supply-policy="${w.id}">${configured?'Editar política':'Definir política'}</button>${recommended>0?`<button class="btn sm primary" data-buy-supply-policy="${w.id}">Crear compra sugerida</button>`:''}</div>
      </div>`;
    }).join('')||'<div class="empty">No hay depósitos activos.</div>';
  }

  function openSupplyPolicyEditor(productId,warehouseId){
    if(profile?.role!=='admin')return;
    const p=prod(productId),w=(D.warehouses||[]).find(x=>x.id===warehouseId);if(!p||!w)return;
    const row=minimumPolicy(productId,warehouseId)||{};
    openModal('Política de abastecimiento',`${p.name} · ${w.name}`,`
      <div class="notice">La política se aplica por producto y depósito. La recomendación usa consumo real de 30 días, stock disponible y compras en camino.</div>
      <div class="two"><div class="field"><label>Mínimo duro</label><input id="spMinimum" type="number" min="0" step="any" value="${n(row.minimum_qty)}"><div class="hint">Nivel que nunca debería perforarse.</div></div><div class="field"><label>Stock de seguridad</label><input id="spSafety" type="number" min="0" step="any" value="${n(row.safety_stock_qty)}"></div></div>
      <div class="two"><div class="field"><label>Cobertura objetivo (días)</label><input id="spTarget" type="number" min="0" step="any" value="${row.target_coverage_days==null?14:n(row.target_coverage_days)}"></div><div class="field"><label>Lead time (días)</label><input id="spLead" type="number" min="0" step="1" value="${n(row.lead_time_days)}"></div></div>
      <div class="two"><div class="field"><label>Compra mínima / MOQ</label><input id="spMoq" type="number" min="0" step="any" value="${n(row.min_order_qty)}"></div><div class="field"><label>Múltiplo de compra</label><input id="spMultiple" type="number" min="0" step="any" value="${row.order_multiple_qty==null?'':n(row.order_multiple_qty)}" placeholder="Ej. 1080 kg por pallet"></div></div>
      <div class="two"><div class="field"><label>Proveedor preferido</label><select id="spSupplier"><option value="">Sin preferido</option>${(D.suppliers||[]).map(s=>`<option value="${s.id}" ${s.id===row.preferred_supplier_id?'selected':''}>${esc(s.name)}</option>`).join('')}</select></div><div class="field"><label>Criticidad</label><select id="spCriticality"><option value="normal" ${row.criticality==='normal'||!row.criticality?'selected':''}>Normal</option><option value="important" ${row.criticality==='important'?'selected':''}>Importante</option><option value="critical" ${row.criticality==='critical'?'selected':''}>Crítico</option></select></div></div>
      <label class="check-line"><input id="spActive" type="checkbox" ${row.policy_active===false?'':'checked'}> Política activa</label>
      <div class="field"><label>Notas</label><textarea id="spNotes" rows="3" placeholder="Ej. compra por pallet completo, proveedor con 180 días de crédito…">${esc(row.policy_notes||'')}</textarea></div>
      <button id="spSave" class="btn primary" style="width:100%">Guardar política</button><div id="spMsg"></div>`);
    $('#spSave').onclick=async()=>{
      const numericIds=['spMinimum','spSafety','spTarget','spLead','spMoq'],vals={};for(const id of numericIds){vals[id]=Number($('#'+id).value||0);if(vals[id]<0||!Number.isFinite(vals[id]))return msg($('#spMsg'),'Los valores numéricos deben ser cero o mayores.')}
      const mult=$('#spMultiple').value.trim()===''?null:Number($('#spMultiple').value);if(mult!==null&&(!(mult>0)||!Number.isFinite(mult)))return msg($('#spMsg'),'El múltiplo debe ser mayor a cero o quedar vacío.');
      const body={warehouse_id:warehouseId,product_id:productId,minimum_qty:vals.spMinimum,safety_stock_qty:vals.spSafety,target_coverage_days:vals.spTarget,lead_time_days:Math.round(vals.spLead),min_order_qty:vals.spMoq,order_multiple_qty:mult,preferred_supplier_id:$('#spSupplier').value||null,criticality:$('#spCriticality').value,policy_active:$('#spActive').checked,policy_notes:$('#spNotes').value.trim()||null,updated_by:profile.id,updated_at:new Date().toISOString()};
      const b=$('#spSave');b.disabled=true;b.textContent='Guardando…';const r=await upsert('stock_minimums',body);if(r.error){b.disabled=false;b.textContent='Guardar política';return msg($('#spMsg'),r.error)}
      msg($('#spMsg'),'Política guardada.',true);await loadAll(true);closeModal();
    };
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
    return rows.map(x=>{
      const priceText=[...x.prices.entries()].map(([c,list])=>{list.sort((a,b)=>new Date(b.date)-new Date(a.date));return`${esc(c)} ${cash(list[0].base_price,c)} / ${esc(unit)}`}).join(' · ');
      const clickable=x.id!=='none'?'clickable':'';
      return`<div class="row ${clickable}" ${x.id!=='none'?`data-p360-supplier="${x.id}"`:''}><div class="line"><div class="grow"><div class="title">${esc(x.name)}</div><div class="subtext">${x.purchaseIds.size} compra${x.purchaseIds.size===1?'':'s'} · ${fmt(x.qty)} ${esc(unit)} · última ${d(x.lastDate)}<br>${priceText}</div></div>${x.id!=='none'?'<button class="btn sm soft">Ver proveedor</button>':''}</div></div>`;
    }).join('')||'<div class="empty">Sin proveedores vinculados a compras del producto.</div>';
  }

  function bargeHtml(rows,unit){
    return rows.map(x=>{
      const costs=Object.entries(x.costs).map(([c,v])=>cash(v,c)).join(' · ');
      return`<div class="row clickable" data-p360-barge="${x.id}"><div class="line"><div><div class="title">Barcaza ${esc(x.number||'—')}</div><div class="subtext">${costs||'Sin costo FIFO disponible'}</div></div><div class="num">${fmt(x.qty)} ${esc(unit)}</div></div></div>`;
    }).join('')||'<div class="empty">Todavía no hay salidas asociadas a barcazas para este producto.</div>';
  }

  function lotsHtml(lots,unit){
    return lots.map(l=>`<div class="row"><div class="line"><div><div class="title">${esc(l.lot_reference||('#'+(l.movement_no||'')))}</div><div class="subtext">${esc(l.warehouse_name||whName(l.warehouse_id)||'Depósito')} · ${esc(l.supplier_name||'Sin proveedor')} · ${d(l.received_at)}</div></div><div style="text-align:right"><div class="num">${fmt(l.quantity_remaining)} ${esc(unit)}</div><div class="subtext">${l.unit_cost==null?'Sin costo':cash(l.unit_cost,l.currency)+' / '+esc(unit)}</div></div></div></div>`).join('')||'<div class="empty">Sin lotes abiertos.</div>';
  }

  function bindTabs(){
    const tabs=[...document.querySelectorAll('#page-product-record [data-product-tab]')];
    const panels=[...document.querySelectorAll('#page-product-record [data-product-panel]')];
    tabs.forEach(b=>b.onclick=()=>{
      tabs.forEach(x=>x.classList.toggle('on',x===b));
      panels.forEach(p=>p.classList.toggle('on',p.dataset.productPanel===b.dataset.productTab));
    });
  }

  function backToStock(){
    activeProductRecordId=null;activeProductFocusWarehouseId=null;
    goPage('stock');renderStock?.();
    setTimeout(()=>window.AVHShell?.syncActive?.('stock'),0);
  }

  window.openProduct360=async function(productId,focusWarehouseId=null){
    if(profile?.role!=='admin'){
      const legacy=window.AVHOperationalStockDetail;
      return legacy?legacy(focusWarehouseId,productId):null;
    }
    const p=prod(productId);if(!p)return;
    activeProductRecordId=productId;
    activeProductFocusWarehouseId=focusWarehouseId||activeProductFocusWarehouseId||null;
    const page=ensureProductPage();
    goPage('product-record');
    page.innerHTML='<div class="card"><div class="empty">Armando ficha del producto…</div></div>';

    const [consRes,lotsRes]=await Promise.all([
      query('v_product_360_consumption','*',`product_id=eq.${productId}`),
      query('v_inventory_batch_detail','*',`product_id=eq.${productId}&order=received_at.asc`)
    ]);
    if(activeProductRecordId!==productId)return;

    const cons=consRes.data?.[0]||{};
    const lots=lotsRes.data||[];
    const stocks=stockRows(productId);
    const prs=purchaseRows(productId);
    const purchaseList=uniquePurchaseRows(prs);
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
    const openPurchases=purchaseList.filter(x=>!['closed','cancelled'].includes(x.purchase.status)).length;
    const lotValue=lots.reduce((acc,l)=>{if(l.unit_cost==null||!l.currency)return acc;acc[l.currency]=(acc[l.currency]||0)+n(l.quantity_remaining)*n(l.unit_cost);return acc},{});
    const configuredPolicies=(D.minimums||[]).filter(x=>x.product_id===productId&&x.policy_active!==false).length;

    page.innerHTML=`<div class="product-record">
      <div class="purchase-breadcrumb"><button class="purchase-back" id="productBack">← Inventario</button><span>›</span><b>${esc(p.name)}</b></div>

      <div class="product-record-hero">
        <div class="product-record-main">
          <div class="eyebrow">FICHA 360° DEL PRODUCTO</div>
          <div class="product-record-titleline"><h2>${esc(p.name)}</h2><span class="badge ${risk.level==='critical'?'red':risk.level==='low'?'amber':'green'}">${risk.level==='critical'?'CRÍTICO':risk.level==='low'?'REVISAR':'NORMAL'}</span></div>
          <div class="product-record-meta">Unidad base: ${esc(p.base_unit||'—')}${p.sku?` · SKU: ${esc(p.sku)}`:''} · ${stocks.length} depósito${stocks.length===1?'':'s'} · ${suppliers.length} proveedor${suppliers.length===1?'':'es'}</div>
        </div>
        <div class="product-record-actions">
          <button class="btn" id="productPriceHistory">Historial de precios</button>
          <button class="btn primary" id="productNewPurchase">+ Nueva compra</button>
        </div>
      </div>

      <div class="p360-hero ${risk.level}">
        <div><div class="eyebrow">DECISIÓN DE ABASTECIMIENTO</div><h3>${esc(risk.text)}</h3><div class="subtext">${risk.stockout?`Agotamiento estimado más próximo: <b>${d(risk.stockout)}</b> · `:''}Stock total: <b>${fmt(totalStock)} ${esc(p.base_unit)}</b>${overallInbound>0?` · En camino: <b>${fmt(overallInbound)} ${esc(p.base_unit)}</b>`:''}</div></div>
        <span class="badge ${risk.level==='critical'?'red':risk.level==='low'?'amber':'green'}">${risk.level==='critical'?'CRÍTICO':risk.level==='low'?'REVISAR':'NORMAL'}</span>
      </div>
      ${risk.recommended>0?`<div class="notice p360-recommend">Compra sugerida con la regla actual: <b>${fmt(risk.recommended)} ${esc(p.base_unit)}</b> para recuperar cobertura.</div>`:''}

      <div class="product-record-kpis">
        <div class="kpi"><div class="label">Stock total</div><div class="value">${fmt(totalStock)}</div><div class="meta">${esc(p.base_unit)} · ${stocks.length} depósito${stocks.length===1?'':'s'}</div></div>
        <div class="kpi"><div class="label">Cobertura global</div><div class="value">${globalCoverage==null?'—':fmt(globalCoverage)}</div><div class="meta">${globalCoverage==null?'Sin consumo 30d':'días al ritmo 30d'}</div></div>
        <div class="kpi"><div class="label">Consumo 30 días</div><div class="value">${fmt(cons.qty_30d||0)}</div><div class="meta">${esc(p.base_unit)} · ${cons.exits_30d||0} salidas</div></div>
        <div class="kpi"><div class="label">Compras</div><div class="value">${uniquePurchases.size}</div><div class="meta">${openPurchases} abierta${openPurchases===1?'':'s'}${latestPurchase?` · última ${d(latestPurchase.date)}`:''}</div></div>
      </div>

      <div class="product-record-tabs">
        <button class="on" data-product-tab="summary">Resumen</button>
        <button data-product-tab="stock">Stock <span>${stocks.length}</span></button>
        <button data-product-tab="supply">Abastecimiento <span>${configuredPolicies}</span></button>
        <button data-product-tab="consumption">Consumo</button>
        <button data-product-tab="purchases">Compras <span>${purchaseList.length}</span></button>
        <button data-product-tab="prices">Precios <span>${groups.length}</span></button>
        <button data-product-tab="suppliers">Proveedores <span>${suppliers.length}</span></button>
        <button data-product-tab="lots">Lotes y costos <span>${lots.length}</span></button>
      </div>

      <div class="product-record-panel on" data-product-panel="summary">
        <div class="product-summary-grid">
          <div class="detail-box"><span>Unidad base</span><b>${esc(p.base_unit||'—')}</b></div>
          <div class="detail-box"><span>Stock en camino</span><b>${fmt(overallInbound)} ${esc(p.base_unit||'')}</b></div>
          <div class="detail-box"><span>Consumo 60 días</span><b>${fmt(cons.qty_60d||0)} ${esc(p.base_unit||'')}</b></div>
          <div class="detail-box"><span>Consumo 90 días</span><b>${fmt(cons.qty_90d||0)} ${esc(p.base_unit||'')}</b></div>
          <div class="detail-box"><span>Proveedores usados</span><b>${suppliers.length}</b></div>
          <div class="detail-box"><span>Compras abiertas</span><b>${openPurchases}</b></div>
          <div class="detail-box"><span>Última compra</span><b>${latestPurchase?d(latestPurchase.date):'—'}</b></div>
          <div class="detail-box"><span>Lotes abiertos</span><b>${lots.length}</b></div>
        </div>
        <div class="section-head"><div><h2>Stock por depósito</h2><p>Resumen de existencia, cobertura y mercadería en camino</p></div><button class="btn sm soft" data-product-tab-jump="stock">Ver detalle</button></div>
        <div class="p360-stock-grid">${stockHtml(stocks,activeProductFocusWarehouseId)}</div>
        <div class="section-head"><div><h2>Política de abastecimiento</h2><p>${configuredPolicies} depósito${configuredPolicies===1?'':'s'} con política activa</p></div><button class="btn sm soft" data-product-tab-jump="supply">Configurar</button></div>
        <div class="card supply-policy-summary"><div class="line"><div><b>Reposición inteligente</b><div class="subtext">Objetivo de cobertura + seguridad + lead time + MOQ/múltiplos + proveedor preferido.</div></div><span class="badge ${configuredPolicies?'green':''}">${configuredPolicies?'ACTIVA':'SIN CONFIGURAR'}</span></div></div>
        <div class="section-head"><div><h2>Últimos precios</h2><p>Último y mejor precio histórico por moneda</p></div><button class="btn sm soft" data-product-tab-jump="prices">Ver precios</button></div>
        <div class="p360-price-grid">${priceHtml(groups,p.base_unit)}</div>
      </div>

      <div class="product-record-panel" data-product-panel="stock">
        <div class="section-head"><div><h2>Stock por depósito</h2><p>Existencia, mínimo, cobertura, riesgo y compras en camino</p></div></div>
        <div class="p360-stock-grid">${stockHtml(stocks,activeProductFocusWarehouseId)}</div>
      </div>

      <div class="product-record-panel" data-product-panel="supply">
        <div class="section-head"><div><h2>Política de abastecimiento</h2><p>Definí cómo comprar este producto en cada depósito</p></div></div>
        <div class="supply-policy-grid">${supplyPolicyHtml(productId,p)}</div>
      </div>

      <div class="product-record-panel" data-product-panel="consumption">
        <div class="product-consumption-kpis">
          <div class="kpi"><div class="label">30 días</div><div class="value">${fmt(cons.qty_30d||0)}</div><div class="meta">${esc(p.base_unit)} · ${cons.exits_30d||0} salidas</div></div>
          <div class="kpi"><div class="label">60 días</div><div class="value">${fmt(cons.qty_60d||0)}</div><div class="meta">${esc(p.base_unit)} · ${cons.exits_60d||0} salidas</div></div>
          <div class="kpi"><div class="label">90 días</div><div class="value">${fmt(cons.qty_90d||0)}</div><div class="meta">${esc(p.base_unit)} · ${cons.exits_90d||0} salidas</div></div>
        </div>
        <div class="section-head"><div><h2>Consumo por barcaza</h2><p>Cantidad consumida y costo FIFO cuando está disponible</p></div></div>
        <div class="list">${bargeHtml(barges,p.base_unit)}</div>
        <div class="section-head"><div><h2>Actividad reciente</h2><p>Últimos movimientos cargados que incluyen este producto</p></div></div>
        <div class="list">${recent.length?movementRows(recent):'<div class="empty">Sin movimientos recientes en la ventana cargada.</div>'}</div>
      </div>

      <div class="product-record-panel" data-product-panel="purchases">
        <div class="section-head"><div><h2>Compras del producto</h2><p>Historial de compras con acceso directo al expediente</p></div><button class="btn sm primary" id="productNewPurchase2">+ Nueva compra</button></div>
        <div class="list">${purchaseList.map(x=>{const pch=x.purchase,pct=x.base_qty>0?Math.min(100,Math.round(x.received_base_qty/x.base_qty*100)):0;return`<div class="row clickable product-purchase-row" data-product-purchase="${pch.id}"><div class="line"><div class="grow"><div class="title">${esc(purchaseRef(pch))} · ${esc(pch.supplier_name||supplier(pch.supplier_id)?.name||'Sin proveedor')}</div><div class="subtext">${d(pch.ordered_date||pch.created_at)} · ${fmt(x.base_qty)} ${esc(p.base_unit)} · ${pct}% recibido</div><div class="purchase-progress"><i style="width:${pct}%"></i></div></div><div style="text-align:right">${statusBadge(pch.status)}<div class="num" style="margin-top:5px">${cash(x.items.reduce((s,i)=>s+i.base_price*i.base_qty,0),pch.currency||'PYG')}</div></div></div></div>`}).join('')||'<div class="empty">Sin compras registradas.</div>'}</div>
      </div>

      <div class="product-record-panel" data-product-panel="prices">
        <div class="section-head"><div><h2>Precios</h2><p>Último, mejor, promedio ponderado y cantidad comprada por moneda</p></div><button class="btn sm soft" id="productPriceHistory2">Abrir análisis completo</button></div>
        <div class="p360-price-grid">${priceHtml(groups,p.base_unit)}</div>
        <div class="section-head"><div><h2>Historial reciente</h2><p>Precio normalizado a ${esc(p.base_unit)}</p></div></div>
        <div class="list">${prs.slice(0,20).map(x=>`<div class="row clickable" data-product-purchase="${x.purchase.id}"><div class="line"><div><div class="title">${esc(x.supplier?.name||'Sin proveedor')} · ${d(x.date)}</div><div class="subtext">${esc(purchaseRef(x.purchase))} · ${fmt(x.base_qty)} ${esc(p.base_unit)}</div></div><div class="num">${cash(x.base_price,x.currency)} / ${esc(p.base_unit)}</div></div></div>`).join('')||'<div class="empty">Sin historial de precios.</div>'}</div>
      </div>

      <div class="product-record-panel" data-product-panel="suppliers">
        <div class="section-head"><div><h2>Proveedores</h2><p>Quiénes suministraron este producto y a qué precio</p></div></div>
        <div class="list">${supplierHtml(suppliers,p.base_unit)}</div>
      </div>

      <div class="product-record-panel" data-product-panel="lots">
        <div class="section-head"><div><h2>Lotes abiertos y costos</h2><p>Stock disponible con origen y costo real registrado</p></div></div>
        ${Object.keys(lotValue).length?`<div class="product-lot-value">${Object.entries(lotValue).map(([c,v])=>`<div class="card"><div class="eyebrow">VALOR ABIERTO ${esc(c)}</div><div class="supplier-money">${cash(v,c)}</div><div class="subtext">Suma de lotes abiertos con costo disponible</div></div>`).join('')}</div>`:''}
        <div class="list" style="margin-top:10px">${lotsHtml(lots,p.base_unit)}</div>
      </div>
    </div>`;

    const openNew=()=>window.openNewPurchaseForProduct?.(productId);
    $('#productBack').onclick=backToStock;
    $('#productNewPurchase').onclick=openNew;$('#productNewPurchase2').onclick=openNew;
    $('#productPriceHistory').onclick=()=>window.openPriceAnalysis?.(productId);
    $('#productPriceHistory2').onclick=()=>window.openPriceAnalysis?.(productId);
    bindTabs();
    document.querySelectorAll('[data-product-tab-jump]').forEach(b=>b.onclick=()=>document.querySelector(`[data-product-tab="${b.dataset.productTabJump}"]`)?.click());
    document.querySelectorAll('[data-product-purchase]').forEach(x=>x.onclick=()=>window.openPurchaseDetail?.(x.dataset.productPurchase));
    document.querySelectorAll('[data-p360-supplier]').forEach(x=>x.onclick=e=>{e.stopPropagation();window.openSupplierProfile?.(x.dataset.p360Supplier)});
    document.querySelectorAll('[data-edit-supply-policy]').forEach(x=>x.onclick=()=>openSupplyPolicyEditor(productId,x.dataset.editSupplyPolicy));
    document.querySelectorAll('[data-buy-supply-policy]').forEach(x=>x.onclick=()=>{const wh=x.dataset.buySupplyPolicy,smart=smartPolicy(productId,wh),policy=minimumPolicy(productId,wh);window.openNewPurchaseForProduct?.(productId,policy?.preferred_supplier_id||null,smart?.recommended_buy_qty||null)});
    document.querySelectorAll('[data-p360-barge]').forEach(x=>x.onclick=()=>openBarge(x.dataset.p360Barge));
    if(typeof bindMovementRows==='function')bindMovementRows();

    setTimeout(()=>{
      window.AVHShell?.syncActive?.('stock');
      const title=$('#sectionTitle');if(title)title.textContent=p.name;
    },0);
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

  const previousLoadAll=window.loadAll;
  window.loadAll=async function(force=false){
    await previousLoadAll.apply(this,arguments);
    if(activeProductRecordId&&document.querySelector('#page-product-record')?.classList.contains('on')&&(D.products||[]).some(x=>x.id===activeProductRecordId)){
      window.openProduct360(activeProductRecordId,activeProductFocusWarehouseId);
    }
  };

  const style=document.createElement('style');
  style.textContent=`
    .p360-hero{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;border:1px solid #dfe9e2;border-left:5px solid var(--green);border-radius:14px;padding:14px;background:#fbfdfb}.p360-hero.critical{border-left-color:var(--red);background:#fff7f6}.p360-hero.low{border-left-color:var(--amber);background:#fffaf0}.p360-hero h3{font-size:16px;margin:3px 0 5px}.p360-recommend{margin-top:10px}.p360-stock-grid,.p360-price-grid{display:grid;gap:8px}.p360-stock,.p360-price-card{border:1px solid #dfe9e2;border-radius:12px;padding:11px;background:#fff}.p360-stock.focus{box-shadow:0 0 0 2px rgba(15,90,49,.14);border-color:#8bb99d}.p360-price-main{font-size:18px;font-weight:900;margin-top:4px}.p360-price-main small{font-size:11px;font-weight:600}.p360-price-meta{display:grid;gap:3px;margin-top:7px;font-size:11px;color:#607268}.p360-chip{font-weight:800;color:var(--green)}
    .product-record{display:grid;gap:14px;padding-bottom:18px}.product-record-hero{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;background:#fff;border:1px solid var(--line);border-radius:18px;padding:18px;box-shadow:var(--shadow)}.product-record-main{min-width:0}.product-record-titleline{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:4px}.product-record-titleline h2{font-size:25px;letter-spacing:-.035em;margin:0}.product-record-meta{font-size:11px;color:var(--muted);margin-top:7px}.product-record-actions{display:flex;gap:7px;flex-wrap:wrap}.product-record-kpis,.product-consumption-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.product-record-tabs{display:flex;gap:4px;overflow-x:auto;border-bottom:1px solid var(--line);padding:0 2px}.product-record-tabs button{border:0;background:transparent;padding:11px 12px;color:var(--muted);font-size:12px;font-weight:850;white-space:nowrap;border-bottom:2px solid transparent}.product-record-tabs button.on{color:var(--green);border-bottom-color:var(--green)}.product-record-tabs button span{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:#edf3ef;font-size:9px;margin-left:3px}.product-record-tabs button.on span{background:var(--green3)}.product-record-panel{display:none}.product-record-panel.on{display:block}.product-summary-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.product-lot-value{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.product-purchase-row:hover{border-color:#b8d3c1}.supply-policy-grid{display:grid;gap:10px}.supply-policy-card.empty-policy{border-style:dashed}.supply-policy-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:11px}.supply-policy-metrics div{background:#f5f8f6;border-radius:10px;padding:9px}.supply-policy-metrics span{display:block;color:var(--muted);font-size:9px;font-weight:780;margin-bottom:4px}.supply-policy-metrics b{font-size:11px}.supply-policy-recommend{margin-top:10px}.supply-policy-summary{box-shadow:none}
    @media(min-width:760px){.p360-stock-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.p360-price-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(min-width:900px){.supply-policy-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.supply-policy-metrics{grid-template-columns:repeat(4,minmax(0,1fr))}.product-record-kpis{grid-template-columns:repeat(4,minmax(0,1fr))}.product-consumption-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}.product-summary-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
    @media(max-width:640px){.product-record{gap:11px}.product-record-hero{display:grid;align-items:start;padding:14px}.product-record-titleline h2{font-size:21px}.product-record-actions{display:grid;grid-template-columns:1fr 1fr;width:100%}.product-record-actions .btn{min-width:0;font-size:11px}.product-record-tabs button{padding:10px 9px;font-size:11px}.product-lot-value{grid-template-columns:1fr}.p360-hero{display:grid}}
  `;
  document.head.appendChild(style);

  window.AVHProductRecord={open:window.openProduct360,back:backToStock};
  setTimeout(mark360,0);
})();