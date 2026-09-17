// AVH V3 — Inteligencia de Compras. Dashboard analítico sobre vistas BI de PostgreSQL.
(function(){
  let cache={facts:[],items:[],risks:[]};
  let loadedAt=null;
  let loadingPromise=null;
  const n=v=>Number.isFinite(Number(v))?Number(v):0;
  const today=()=>new Date().toISOString().slice(0,10);
  const ago90=()=>{const d=new Date();d.setDate(d.getDate()-89);return d.toISOString().slice(0,10)};
  const shortDate=v=>v?new Date(String(v).slice(0,10)+'T12:00:00').toLocaleDateString('es-PY',{day:'2-digit',month:'2-digit',year:'2-digit'}):'—';
  const monthLabel=v=>v?new Date(String(v).slice(0,10)+'T12:00:00').toLocaleDateString('es-PY',{month:'short',year:'2-digit'}).replace('.',''):'—';
  const avg=a=>a.length?a.reduce((s,x)=>s+n(x),0)/a.length:null;
  const escAttr=v=>esc(String(v??''));

  async function loadAnalytics(force=false){
    if(profile?.role!=='admin')return {error:'Solo administración puede ver Inteligencia de Compras.'};
    if(!force&&loadedAt&&(Date.now()-loadedAt.getTime())<120000&&cache.facts.length)return {data:cache};
    if(loadingPromise)return loadingPromise;
    loadingPromise=(async()=>{
      const [facts,items,risks]=await Promise.all([
        query('bi_purchase_facts','*','order=ordered_date.desc&limit=1000'),
        query('bi_purchase_item_facts','*','order=ordered_date.desc&limit=1000'),
        query('v_smart_stock_alerts','*','order=warehouse_name.asc&limit=1000')
      ]);
      const errors=[facts,items,risks].filter(x=>x.error).map(x=>x.error);
      if(errors.length)return {error:errors.join(' · ')};
      cache={facts:facts.data||[],items:items.data||[],risks:risks.data||[]};
      loadedAt=new Date();
      return {data:cache};
    })().finally(()=>{loadingPromise=null});
    return loadingPromise;
  }

  function totals(rows,field='total_amount'){
    return rows.reduce((o,r)=>{const c=r.currency||'PYG';o[c]=(o[c]||0)+n(r[field]);return o},{USD:0,PYG:0});
  }
  function moneyPair(t){return `<b>${money(t.USD||0,'USD')}</b><span>${money(t.PYG||0,'PYG')}</span>`}
  function options(rows,key,label,empty){
    const m=new Map;
    rows.forEach(x=>{const id=x[key];if(id)m.set(id,x[label]||id)});
    return `<option value="all">${empty}</option>`+[...m.entries()].sort((a,b)=>String(a[1]).localeCompare(String(b[1]))).map(([id,name])=>`<option value="${escAttr(id)}">${esc(name)}</option>`).join('');
  }
  function currentFilters(){
    return {
      from:$('#biFrom')?.value||'',to:$('#biTo')?.value||'',company:$('#biCompany')?.value||'all',supplier:$('#biSupplier')?.value||'all',warehouse:$('#biWarehouse')?.value||'all',currency:$('#biCurrency')?.value||'all'
    };
  }
  function applyFacts(rows,f){return rows.filter(x=>x.status!=='cancelled'&&(!f.from||x.ordered_date>=f.from)&&(!f.to||x.ordered_date<=f.to)&&(f.company==='all'||x.company_id===f.company)&&(f.supplier==='all'||x.supplier_id===f.supplier)&&(f.warehouse==='all'||x.warehouse_id===f.warehouse)&&(f.currency==='all'||x.currency===f.currency))}
  function applyItems(rows,f){return rows.filter(x=>x.status!=='cancelled'&&(!f.from||x.ordered_date>=f.from)&&(!f.to||x.ordered_date<=f.to)&&(f.company==='all'||x.company_id===f.company)&&(f.supplier==='all'||x.supplier_id===f.supplier)&&(f.warehouse==='all'||x.warehouse_id===f.warehouse)&&(f.currency==='all'||x.currency===f.currency))}

  function supplierStats(rows){
    const map=new Map;
    rows.forEach(r=>{
      const k=r.supplier_id||'none',o=map.get(k)||{id:k,name:r.supplier_name||'Sin proveedor',count:0,USD:0,PYG:0,pendingUSD:0,pendingPYG:0,promised:0,onTime:0,lead:[],late:0};
      o.count++;o[r.currency]=(o[r.currency]||0)+n(r.total_amount);o['pending'+r.currency]=(o['pending'+r.currency]||0)+n(r.pending_amount);
      if(r.is_complete_receipt&&r.expected_date){o.promised++;if(r.completed_on_time===true)o.onTime++}
      if(r.days_to_complete!=null)o.lead.push(n(r.days_to_complete));
      if(n(r.days_late_open)>0)o.late++;
      map.set(k,o);
    });
    return [...map.values()].sort((a,b)=>b.count-a.count||String(a.name).localeCompare(String(b.name)));
  }

  function priceSignals(items){
    const groups=new Map;
    items.filter(x=>x.product_id&&n(x.unit_price_base)>0).forEach(x=>{const k=x.product_id+'|'+x.currency;const a=groups.get(k)||[];a.push(x);groups.set(k,a)});
    const out=[];
    for(const a of groups.values()){
      a.sort((x,y)=>String(y.ordered_date).localeCompare(String(x.ordered_date))||String(y.created_at).localeCompare(String(x.created_at)));
      const latest=a[0];
      const previous=a.find(x=>x.purchase_id!==latest.purchase_id);
      if(!previous||!n(previous.unit_price_base))continue;
      const diff=(n(latest.unit_price_base)-n(previous.unit_price_base))/n(previous.unit_price_base)*100;
      out.push({product_id:latest.product_id,product_name:latest.product_name||latest.description,currency:latest.currency,base_unit:latest.base_unit||latest.unit,latest:n(latest.unit_price_base),previous:n(previous.unit_price_base),diff,date:latest.ordered_date});
    }
    return out.sort((a,b)=>Math.abs(b.diff)-Math.abs(a.diff)).slice(0,8);
  }

  function monthlyHtml(rows){
    const map=new Map;
    rows.forEach(r=>{const m=r.ordered_month||String(r.ordered_date).slice(0,7)+'-01',o=map.get(m)||{month:m,USD:0,PYG:0,count:0};o[r.currency]=(o[r.currency]||0)+n(r.total_amount);o.count++;map.set(m,o)});
    const data=[...map.values()].sort((a,b)=>a.month.localeCompare(b.month)).slice(-8);
    if(!data.length)return '<div class="empty">Todavía no hay compras en el período.</div>';
    const maxUSD=Math.max(1,...data.map(x=>x.USD)),maxPYG=Math.max(1,...data.map(x=>x.PYG));
    return `<div class="bi-months">${data.map(x=>`<div class="bi-month"><div class="bi-month-head"><b>${monthLabel(x.month)}</b><span>${x.count} compra${x.count===1?'':'s'}</span></div><div class="bi-bar-line"><span>USD</span><i><b style="width:${Math.max(2,x.USD/maxUSD*100)}%"></b></i><em>${money(x.USD,'USD')}</em></div><div class="bi-bar-line"><span>PYG</span><i><b style="width:${Math.max(2,x.PYG/maxPYG*100)}%"></b></i><em>${money(x.PYG,'PYG')}</em></div></div>`).join('')}</div>`;
  }

  function draw(){
    const f=currentFilters(),facts=applyFacts(cache.facts,f),items=applyItems(cache.items,f),spend=totals(facts),pending=totals(facts.filter(x=>x.is_pending_receipt),'pending_amount');
    const completedPromised=facts.filter(x=>x.is_complete_receipt&&x.expected_date&&x.completed_on_time!==null),onTime=completedPromised.filter(x=>x.completed_on_time===true).length;
    const onTimeRate=completedPromised.length?onTime/completedPromised.length*100:null;
    const leadRows=facts.filter(x=>x.days_to_complete!=null).map(x=>n(x.days_to_complete)),leadAvg=avg(leadRows);
    const urgent=facts.filter(x=>['urgent','critical'].includes(x.urgency)).length,urgentRate=facts.length?urgent/facts.length*100:0;
    const late=facts.filter(x=>n(x.days_late_open)>0).sort((a,b)=>n(b.days_late_open)-n(a.days_late_open));
    const suppliers=supplierStats(facts),signals=priceSignals(items);
    const risks=cache.risks.filter(x=>(f.warehouse==='all'||x.warehouse_id===f.warehouse)&&x.alert_level!=='normal').sort((a,b)=>(a.alert_level==='critical'?0:1)-(b.alert_level==='critical'?0:1)||n(a.coverage_days)-n(b.coverage_days));

    $('#biResults').innerHTML=`
      <div class="bi-kpis">
        <div class="kpi"><div class="label">Comprado en período</div><div class="bi-money">${moneyPair(spend)}</div><div class="meta">${facts.length} compra${facts.length===1?'':'s'}</div></div>
        <div class="kpi ${pending.USD||pending.PYG?'transit':''}"><div class="label">Pendiente de recibir</div><div class="bi-money">${moneyPair(pending)}</div><div class="meta">A valor de OC pendiente</div></div>
        <div class="kpi"><div class="label">Entrega a tiempo</div><div class="value">${onTimeRate==null?'—':onTimeRate.toFixed(1)+'%'}</div><div class="meta">${completedPromised.length?`${onTime}/${completedPromised.length} completas con fecha prometida`:'Sin entregas completas con fecha prometida'}</div></div>
        <div class="kpi"><div class="label">Lead time real</div><div class="value">${leadAvg==null?'—':leadAvg.toFixed(1)}</div><div class="meta">${leadAvg==null?'Sin compras completas':'días · pedido → última recepción'}</div></div>
        <div class="kpi ${urgentRate>20?'alert':''}"><div class="label">Compras urgentes</div><div class="value">${urgentRate.toFixed(1)}%</div><div class="meta">${urgent} de ${facts.length||0} compras</div></div>
        <div class="kpi ${late.length?'alert':''}"><div class="label">OC vencidas abiertas</div><div class="value">${late.length}</div><div class="meta">Con fecha prometida vencida</div></div>
      </div>

      <div class="bi-grid two">
        <div class="card"><div class="bi-card-head"><div><div class="eyebrow">MOVIMIENTO</div><h3>Evolución mensual de compras</h3></div><span class="badge">MONEDA SEPARADA</span></div>${monthlyHtml(facts)}</div>
        <div class="card"><div class="bi-card-head"><div><div class="eyebrow">ABASTECIMIENTO</div><h3>Riesgos actuales de stock</h3></div><span class="badge ${risks.length?'amber':'green'}">${risks.length}</span></div><div class="bi-list">${risks.slice(0,7).map(x=>`<div class="bi-row clickable" data-bi-stock="${x.warehouse_id}|${x.product_id}"><div><b>${esc(x.product_name)}</b><small>${esc(x.warehouse_name)} · stock ${fmt(x.stock_qty)} ${esc(x.base_unit)}${x.coverage_days==null?'':' · '+fmt(x.coverage_days)+' días'}</small><small>${esc(x.risk_reason||'Revisar abastecimiento')}</small></div><span class="badge ${x.alert_level==='critical'?'red':'amber'}">${x.alert_level==='critical'?'CRÍTICO':'REVISAR'}</span></div>`).join('')||'<div class="empty">Sin riesgos actuales.</div>'}</div></div>
      </div>

      <div class="card bi-section-card"><div class="bi-card-head"><div><div class="eyebrow">PROVEEDORES</div><h3>Cumplimiento y actividad</h3></div><span class="subtext">Ordenado por cantidad de compras</span></div><div class="bi-table-wrap"><table class="bi-table"><thead><tr><th>Proveedor</th><th>Compras</th><th>Volumen</th><th>A tiempo</th><th>Lead time</th><th>Vencidas</th></tr></thead><tbody>${suppliers.slice(0,12).map(s=>`<tr><td><b>${esc(s.name)}</b></td><td>${s.count}</td><td><span>${money(s.USD,'USD')}</span><small>${money(s.PYG,'PYG')}</small></td><td>${s.promised?(s.onTime/s.promised*100).toFixed(0)+'%':'—'}<small>${s.promised?`${s.onTime}/${s.promised}`:'sin muestra'}</small></td><td>${s.lead.length?avg(s.lead).toFixed(1)+' d':'—'}</td><td>${s.late?`<span class="badge red">${s.late}</span>`:'0'}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">Sin compras en el período.</td></tr>'}</tbody></table></div></div>

      <div class="bi-grid two">
        <div class="card"><div class="bi-card-head"><div><div class="eyebrow">PRECIOS</div><h3>Variaciones recientes</h3></div><span class="subtext">Precio por unidad base</span></div><div class="bi-list">${signals.map(x=>`<div class="bi-row"><div><b>${esc(x.product_name)}</b><small>${money(x.previous,x.currency)} → ${money(x.latest,x.currency)} / ${esc(x.base_unit||'unidad')} · ${shortDate(x.date)}</small></div><span class="badge ${x.diff>5?'red':x.diff<0?'green':'amber'}">${x.diff>=0?'+':''}${x.diff.toFixed(1)}%</span></div>`).join('')||'<div class="empty">Necesitamos al menos dos compras comparables del mismo producto y moneda.</div>'}</div></div>
        <div class="card"><div class="bi-card-head"><div><div class="eyebrow">SEGUIMIENTO</div><h3>OC pendientes de recepción</h3></div><span class="badge ${late.length?'red':''}">${facts.filter(x=>x.is_pending_receipt).length}</span></div><div class="bi-list">${facts.filter(x=>x.is_pending_receipt).sort((a,b)=>n(b.days_late_open)-n(a.days_late_open)||String(a.ordered_date).localeCompare(String(b.ordered_date))).slice(0,8).map(x=>`<div class="bi-row clickable" data-bi-purchase="${x.purchase_id}"><div><b>${esc(x.supplier_name||'Sin proveedor')}</b><small>${esc(x.po_number||x.order_reference||'Sin referencia')} · ${shortDate(x.ordered_date)} · ${money(x.pending_amount,x.currency)}</small></div>${n(x.days_late_open)>0?`<span class="badge red">${x.days_late_open} d tarde</span>`:`<span class="badge">${x.value_received_pct}% recibido</span>`}</div>`).join('')||'<div class="empty">Sin OC pendientes en el período.</div>'}</div></div>
      </div>

      <div class="card bi-method"><div><b>Definiciones del tablero</b><p>Entrega a tiempo = compra de depósito completada cuya última recepción ocurrió en o antes de la fecha prometida. Lead time = días desde la fecha de pedido hasta la última recepción. Pendiente = cantidad aún no recibida × precio unitario de la OC. Los montos PYG y USD nunca se suman entre sí.</p></div><div><span class="badge green">POWER BI READY</span><small>Fuente analítica: bi_purchase_facts + bi_purchase_item_facts</small></div></div>`;

    $$('[data-bi-stock]').forEach(x=>x.onclick=()=>openStockDetail(...x.dataset.biStock.split('|')));
    $$('[data-bi-purchase]').forEach(x=>x.onclick=()=>window.openPurchaseDetail?.(x.dataset.biPurchase));
    const count=$('#biCount');if(count)count.textContent=`${facts.length} compras en el período`;
  }

  async function renderPurchaseIntelligence(force=false){
    if(profile?.role!=='admin')return;
    activeModule='purchase-intelligence';
    const box=$('#moduleContent');if(!box)return;
    box.innerHTML=`<div class="section-head"><div><h2>Inteligencia de Compras</h2><p>Indicadores de gasto, proveedores, entregas, precios y abastecimiento</p></div><span class="badge">Cargando datos…</span></div><div class="card"><div class="empty">Preparando indicadores desde la base de datos…</div></div>`;
    const r=await loadAnalytics(force);
    if(r.error){box.innerHTML=`<div class="section-head"><div><h2>Inteligencia de Compras</h2><p>No se pudieron cargar los datos analíticos</p></div></div><div class="notice danger">${esc(r.error)}</div>`;return}
    box.innerHTML=`<div class="section-head"><div><h2>Inteligencia de Compras</h2><p>Indicadores para gestionar Compras con los mismos datos del sistema</p></div><div class="split-actions"><span class="badge green" id="biFreshness">Actualizado ${loadedAt.toLocaleTimeString('es-PY',{hour:'2-digit',minute:'2-digit'})}</span><button id="biReload" class="btn sm soft">↻ Actualizar</button></div></div>
      <div class="card bi-filters"><div class="toolbar"><div class="field"><label>Desde</label><input id="biFrom" type="date" value="${ago90()}"></div><div class="field"><label>Hasta</label><input id="biTo" type="date" value="${today()}"></div><div class="field"><label>Empresa</label><select id="biCompany">${options(cache.facts,'company_id','company_name','Todas las empresas')}</select></div><div class="field"><label>Proveedor</label><select id="biSupplier">${options(cache.facts,'supplier_id','supplier_name','Todos los proveedores')}</select></div><div class="field"><label>Depósito</label><select id="biWarehouse">${options(cache.facts,'warehouse_id','warehouse_name','Todos los depósitos')}</select></div><div class="field"><label>Moneda</label><select id="biCurrency"><option value="all">PYG + USD separados</option><option value="PYG">Solo PYG</option><option value="USD">Solo USD</option></select></div></div><div class="line"><span class="subtext" id="biCount"></span><span class="subtext">Los filtros afectan compras, proveedores y precios. Riesgo de stock usa el depósito seleccionado.</span></div></div><div id="biResults"></div>`;
    ['biFrom','biTo','biCompany','biSupplier','biWarehouse','biCurrency'].forEach(id=>{$('#'+id).onchange=draw});
    $('#biReload').onclick=()=>renderPurchaseIntelligence(true);
    draw();
  }

  const style=document.createElement('style');
  style.textContent=`
    .bi-filters{margin-bottom:12px}.bi-filters .toolbar{grid-template-columns:repeat(2,minmax(0,1fr));align-items:end}.bi-filters .field{margin:0}.bi-filters .line{margin-top:8px;justify-content:space-between;gap:10px;flex-wrap:wrap}
    .bi-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-bottom:12px}.bi-money{display:grid;gap:2px;font-size:17px}.bi-money span{font-size:12px;color:var(--muted);font-weight:700}
    .bi-grid{display:grid;gap:10px;margin-bottom:10px}.bi-card-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:10px}.bi-card-head h3{margin:2px 0 0;font-size:16px}.bi-list{display:grid}.bi-row{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:10px 0;border-bottom:1px solid #e7eee9}.bi-row:last-child{border-bottom:0}.bi-row>div{min-width:0}.bi-row b{display:block}.bi-row small{display:block;color:var(--muted);margin-top:3px;line-height:1.35}
    .bi-months{display:grid;gap:10px}.bi-month{padding:8px 0;border-bottom:1px solid #edf2ee}.bi-month:last-child{border-bottom:0}.bi-month-head{display:flex;justify-content:space-between;margin-bottom:6px}.bi-month-head span{font-size:11px;color:var(--muted)}.bi-bar-line{display:grid;grid-template-columns:34px minmax(70px,1fr) 118px;gap:7px;align-items:center;margin:5px 0}.bi-bar-line>span{font-size:10px;font-weight:900}.bi-bar-line i{height:8px;border-radius:99px;background:#edf2ee;overflow:hidden}.bi-bar-line i b{display:block;height:100%;border-radius:99px;background:var(--green)}.bi-bar-line em{font-size:10px;font-style:normal;text-align:right;color:var(--muted);font-weight:700}
    .bi-section-card{margin:10px 0}.bi-table-wrap{overflow:auto}.bi-table{width:100%;border-collapse:collapse;min-width:760px}.bi-table th,.bi-table td{padding:9px 8px;text-align:left;border-bottom:1px solid #e7eee9;font-size:12px;vertical-align:top}.bi-table th{font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}.bi-table td small{display:block;color:var(--muted);margin-top:2px}.bi-method{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;margin-top:10px}.bi-method p{margin:5px 0 0;color:var(--muted);font-size:12px;line-height:1.5}.bi-method>div:last-child{text-align:right;min-width:160px}.bi-method small{display:block;margin-top:6px;color:var(--muted)}
    @media(min-width:760px){.bi-filters .toolbar{grid-template-columns:repeat(3,minmax(0,1fr))}.bi-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}.bi-grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(min-width:1100px){.bi-filters .toolbar{grid-template-columns:repeat(6,minmax(0,1fr))}.bi-kpis{grid-template-columns:repeat(6,minmax(0,1fr))}}
  `;
  document.head.appendChild(style);

  const previousRenderModule=window.renderModule;
  window.renderModule=function(name){
    if(name==='purchase-intelligence'){renderPurchaseIntelligence();return}
    return previousRenderModule.apply(this,arguments);
  };
  window.renderPurchaseIntelligence=renderPurchaseIntelligence;
})();
