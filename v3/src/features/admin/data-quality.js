// AVH V3 — Centro de calidad de datos.
// Solo lectura: detecta inconsistencias y dirige al lugar donde corregirlas.
(function(){
  const isAdmin=()=>profile?.role==='admin';
  const safe=v=>typeof esc==='function'?esc(String(v??'')):String(v??'');
  const severityRank={critical:0,warning:1,info:2};
  const severityLabel={critical:'CRÍTICO',warning:'REVISAR',info:'SEGUIR'};
  const domainLabel={compras:'Compras',inventario:'Inventario',catalogo:'Catálogo',proveedores:'Proveedores'};
  let cache=null,sev='all',domain='all',search='';

  const style=document.createElement('style');
  style.textContent=`
    .dq-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.dq-score{border:1px solid #dfe8e2;border-radius:15px;padding:13px;background:#fff}.dq-score .big{font-size:30px;font-weight:900}.dq-score.good{border-left:5px solid #3b8b5c}.dq-score.warn{border-left:5px solid #d49a28}.dq-score.bad{border-left:5px solid #c8443e}.dq-toolbar{display:grid;grid-template-columns:1fr 1fr;gap:8px}.dq-row{border:1px solid #dfe8e2;border-radius:13px;padding:11px;background:#fff;cursor:pointer}.dq-row.critical{border-left:4px solid #c8443e}.dq-row.warning{border-left:4px solid #d49a28}.dq-row.info{border-left:4px solid #6c8799}.dq-action{white-space:nowrap}.dq-domain{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#687a70}.dq-help{margin-top:8px;font-size:11px;color:#65776d}@media(min-width:760px){.dq-kpis{grid-template-columns:repeat(4,minmax(0,1fr))}.dq-toolbar{grid-template-columns:1fr 180px 180px}}`;
  document.head.appendChild(style);

  async function load(force=false){
    if(cache&&!force)return cache;
    const r=await query('v_data_quality_issues','*');
    if(r.error)throw new Error(r.error);
    cache=(r.data||[]).sort((a,b)=>(severityRank[a.severity]??9)-(severityRank[b.severity]??9)||String(a.domain).localeCompare(String(b.domain))||String(a.title).localeCompare(String(b.title)));
    return cache;
  }

  function qualityScore(rows){
    const c=rows.filter(x=>x.severity==='critical').length,w=rows.filter(x=>x.severity==='warning').length,i=rows.filter(x=>x.severity==='info').length;
    return Math.max(0,Math.round(100-c*10-w*3-i*.5));
  }

  function actionLabel(x){
    if(x.purchase_id)return'Abrir compra';
    if(x.issue_code==='missing_minimum')return'Configurar mínimo';
    if(x.supplier_id)return'Abrir proveedor';
    if(x.issue_code==='duplicate_product')return'Ver catálogo';
    if(x.product_id)return'Ficha 360°';
    return'Revisar';
  }

  function go(x){
    if(x.purchase_id&&typeof window.openPurchaseDetail==='function'){window.openPurchaseDetail(x.purchase_id);return}
    if(x.issue_code==='missing_minimum'){
      goPage('more');activeModule='admin';activeAdminTab='minimums';renderAdmin('minimums');return;
    }
    if(x.supplier_id){
      if(typeof window.openSupplierProfile==='function'){window.openSupplierProfile(x.supplier_id);return}
      goPage('more');activeModule='admin';activeAdminTab='suppliers';renderAdmin('suppliers');return;
    }
    if(x.issue_code==='duplicate_product'){
      goPage('more');activeModule='admin';activeAdminTab='products';renderAdmin('products');return;
    }
    if(x.product_id&&typeof window.openProduct360==='function'){window.openProduct360(x.product_id,x.warehouse_id||null);return}
    goPage('more');activeModule='admin';renderAdmin(activeAdminTab);
  }

  function draw(){
    const all=cache||[];
    const critical=all.filter(x=>x.severity==='critical').length,warning=all.filter(x=>x.severity==='warning').length,info=all.filter(x=>x.severity==='info').length;
    const score=qualityScore(all),scoreClass=score>=90?'good':score>=75?'warn':'bad';
    const q=search.trim().toLowerCase();
    const visible=all.filter(x=>(sev==='all'||x.severity===sev)&&(domain==='all'||x.domain===domain)&&(!q||[x.title,x.detail,x.issue_code,x.domain].filter(Boolean).join(' ').toLowerCase().includes(q)));
    $('#moduleContent').innerHTML=`
      <div class="section-head"><div><h2>🧹 Calidad de datos</h2><p>Errores, datos incompletos y registros que pueden distorsionar Compras o Inventario</p></div><button id="dqRefresh" class="btn sm soft">↻ Recalcular</button></div>
      <div class="dq-kpis">
        <div class="dq-score ${scoreClass}"><div class="label">Índice de calidad</div><div class="big">${score}%</div><div class="subtext">Indicador interno de limpieza</div></div>
        <div class="kpi ${critical?'alert':''}"><div class="label">Críticos</div><div class="value">${critical}</div><div class="meta">Pueden invalidar datos</div></div>
        <div class="kpi"><div class="label">Revisar</div><div class="value">${warning}</div><div class="meta">Conviene corregir</div></div>
        <div class="kpi"><div class="label">Seguimiento</div><div class="value">${info}</div><div class="meta">Completar cuando puedas</div></div>
      </div>
      <div class="card" style="margin-top:10px"><div class="dq-toolbar">
        <input id="dqSearch" placeholder="Buscar producto, proveedor, OC o problema" value="${safe(search)}">
        <select id="dqSeverity"><option value="all">Todas las prioridades</option><option value="critical" ${sev==='critical'?'selected':''}>Crítico</option><option value="warning" ${sev==='warning'?'selected':''}>Revisar</option><option value="info" ${sev==='info'?'selected':''}>Seguimiento</option></select>
        <select id="dqDomain"><option value="all">Todas las áreas</option>${Object.entries(domainLabel).map(([k,v])=>`<option value="${k}" ${domain===k?'selected':''}>${v}</option>`).join('')}</select>
      </div><div class="dq-help">Crítico: inconsistencia objetiva. Revisar: dato que afecta control o previsión. Seguimiento: mejora de completitud.</div></div>
      <div class="section-head"><div><h2>Hallazgos</h2><p>${visible.length} de ${all.length}</p></div></div>
      <div class="list">${visible.map((x,i)=>`<div class="dq-row ${safe(x.severity)}" data-dq-index="${i}">
        <div class="line"><div class="grow"><div class="dq-domain">${safe(domainLabel[x.domain]||x.domain)}</div><div class="title">${safe(x.title)}</div><div class="subtext">${safe(x.detail)}</div></div>
        <div style="text-align:right"><span class="badge ${x.severity==='critical'?'red':x.severity==='warning'?'amber':''}">${severityLabel[x.severity]||safe(x.severity)}</span><div style="margin-top:7px"><button class="btn sm soft dq-action" data-dq-action="${i}">${actionLabel(x)}</button></div></div></div>
      </div>`).join('')||'<div class="empty">No hay hallazgos con estos filtros. Si el total es 0, los controles actuales no detectan problemas.</div>'}</div>
      <div class="notice" style="margin-top:10px">El índice es orientativo: penaliza más los errores críticos que los datos incompletos. No modifica información automáticamente.</div>`;
    $('#dqSearch').oninput=e=>{search=e.target.value;draw()};
    $('#dqSeverity').onchange=e=>{sev=e.target.value;draw()};
    $('#dqDomain').onchange=e=>{domain=e.target.value;draw()};
    $('#dqRefresh').onclick=()=>render(true);
    $$('[data-dq-action]').forEach(b=>b.onclick=e=>{e.stopPropagation();go(visible[Number(b.dataset.dqAction)])});
    $$('[data-dq-index]').forEach(row=>row.onclick=e=>{if(e.target.closest('button'))return;go(visible[Number(row.dataset.dqIndex)])});
  }

  async function render(force=false){
    if(!isAdmin())return;
    activeModule='data-quality';
    $('#moduleContent').innerHTML='<div class="empty">Revisando calidad de datos…</div>';
    try{await load(force);draw()}catch(e){$('#moduleContent').innerHTML=`<div class="empty">${safe(e.message||String(e))}</div>`}
  }
  window.renderDataQuality=render;

  function ensureCard(){
    const grid=document.querySelector('#page-more .more-grid');if(!grid||!profile)return;
    let b=grid.querySelector('#dataQualityModule');
    if(!isAdmin()){b?.remove();return}
    if(!b){
      b=document.createElement('button');b.id='dataQualityModule';b.className='card more-card';
      b.innerHTML='<span>🧹</span><strong>Calidad de datos</strong><small>Errores, faltantes y duplicados</small>';
      const attention=grid.querySelector('#adminAttentionModule');
      if(attention)attention.insertAdjacentElement('afterend',b);else grid.prepend(b);
    }
    b.onclick=()=>{goPage('more');render(false)};
  }

  const baseRenderModule=window.renderModule;
  window.renderModule=function(name){if(name==='data-quality'){activeModule=name;return render(false)}return baseRenderModule(name)};
  const baseLoadAll=window.loadAll;
  window.loadAll=async function(force=false){await baseLoadAll(force);cache=null;ensureCard();if(activeModule==='data-quality'&&isAdmin())render(true)};

  const observer=new MutationObserver(ensureCard);observer.observe(document.body,{childList:true,subtree:true});
  let tries=0;(function boot(){ensureCard();if(!document.querySelector('#dataQualityModule')&&++tries<60)setTimeout(boot,250)})();
})();