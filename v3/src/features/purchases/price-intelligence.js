// AVH V3 — Inteligencia de precios y ficha 360° de proveedores.
// Módulo aditivo: solo lectura sobre compras/proveedores existentes; no altera FIFO ni recepción.
(function(){
  const st=document.createElement('style');
  st.textContent=`
    .price-intel-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:10px 0}
    .price-intel-card{border:1px solid #dfe9e2;border-radius:12px;padding:10px;background:#fbfdfb}
    .price-intel-card .label{font-size:11px;color:#6f7f76;text-transform:uppercase;letter-spacing:.05em;font-weight:800}
    .price-intel-card .value{font-size:18px;font-weight:900;margin-top:3px}
    .price-intel-panel{margin-top:10px;border:1px solid #dfe9e2;border-radius:12px;padding:10px;background:#fff}
    .price-intel-panel.good{border-color:#79b890;background:#f4fbf6}
    .price-intel-panel.warn{border-color:#d6aa54;background:#fffaf0}
    .price-intel-panel.bad{border-color:#d87878;background:#fff5f5}
    .price-intel-table{width:100%;border-collapse:collapse;font-size:12px}
    .price-intel-table th,.price-intel-table td{padding:7px 6px;border-bottom:1px solid #e8efea;text-align:left;vertical-align:top}
    .price-intel-table th{font-size:10px;text-transform:uppercase;color:#718078;letter-spacing:.04em}
    .supplier-profile-products{display:grid;gap:8px}
    @media(min-width:760px){.price-intel-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
  `;
  document.head.appendChild(st);

  function productById(id){return (D.products||[]).find(x=>x.id===id)}
  function supplierById(id){return (D.suppliers||[]).find(x=>x.id===id)}
  function purchaseById(id){return (D.purchases||[]).find(x=>x.id===id)}
  function safeDate(v){if(!v)return'';try{return new Date(v.length===10?v+'T12:00:00':v).toLocaleDateString('es-PY')}catch{return v}}
  function num(v){const n=Number(v);return Number.isFinite(n)?n:0}
  function fmtPrice(v,c){return typeof money==='function'?money(v,c):`${c||''} ${num(v).toLocaleString('es-PY',{maximumFractionDigits:4})}`}
  function pct(v){return `${v>=0?'+':''}${v.toFixed(1)}%`}

  function priceHistory(productId){
    if(!productId)return[];
    return (D.purchaseItems||[]).filter(i=>i.product_id===productId).map(i=>{
      const p=purchaseById(i.purchase_id);
      if(!p||p.status==='cancelled')return null;
      const factor=num(i.factor_to_base)||1;
      const quantity=num(i.quantity);
      const baseQty=quantity*factor;
      const basePrice=num(i.unit_price)/factor;
      return {purchase:p,item:i,supplier:supplierById(p.supplier_id),date:p.ordered_date||p.created_at||i.created_at,currency:p.currency||'',baseQty,basePrice,unit:i.unit,factor};
    }).filter(Boolean).sort((a,b)=>new Date(b.date)-new Date(a.date));
  }

  function currencyStats(rows){
    const by={};
    rows.forEach(r=>(by[r.currency]=by[r.currency]||[]).push(r));
    return Object.entries(by).map(([currency,list])=>{
      const last=list[0],best=list.reduce((a,b)=>b.basePrice<a.basePrice?b:a,list[0]),worst=list.reduce((a,b)=>b.basePrice>a.basePrice?b:a,list[0]);
      const totalQty=list.reduce((a,x)=>a+x.baseQty,0),weighted=totalQty?list.reduce((a,x)=>a+x.basePrice*x.baseQty,0)/totalQty:0;
      return {currency,list,last,best,worst,weighted,totalQty};
    });
  }

  function historyTable(rows,limit=30){
    const p=productById(rows[0]?.item?.product_id);
    return `<div style="overflow:auto"><table class="price-intel-table"><thead><tr><th>Fecha</th><th>Proveedor</th><th>Cantidad base</th><th>Precio base</th><th>Compra</th></tr></thead><tbody>${rows.slice(0,limit).map(r=>`<tr><td>${safeDate(r.date)}</td><td>${esc(r.supplier?.name||'Sin proveedor')}</td><td>${fmt(r.baseQty)} ${esc(p?.base_unit||'')}</td><td><b>${fmtPrice(r.basePrice,r.currency)}</b> / ${esc(p?.base_unit||'')}</td><td>${esc(r.item.description||'')}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function openPriceAnalysis(initialProductId){
    if(profile?.role!=='admin')return;
    const products=(D.products||[]).filter(x=>x.active||priceHistory(x.id).length);
    openModal('Análisis de precios','Historial calculado desde compras reales; compara por moneda sin mezclar USD y PYG.',`<div class="field"><label>Producto</label><select id="priceIntelProduct">${products.map(p=>`<option value="${p.id}" ${p.id===initialProductId?'selected':''}>${esc(p.name)} · ${esc(p.base_unit)}</option>`).join('')}</select></div><div id="priceIntelBody"></div>`);
    const draw=()=>{
      const id=$('#priceIntelProduct').value,p=productById(id),rows=priceHistory(id),host=$('#priceIntelBody');
      if(!rows.length){host.innerHTML='<div class="empty">Todavía no hay compras históricas vinculadas a este producto.</div>';return}
      host.innerHTML=currencyStats(rows).map(s=>`<div class="section-head"><div><h2>${esc(s.currency||'Sin moneda')}</h2><p>${s.list.length} registro${s.list.length===1?'':'s'} · ${fmt(s.totalQty)} ${esc(p?.base_unit||'')} comprados</p></div></div><div class="price-intel-grid"><div class="price-intel-card"><div class="label">Último</div><div class="value">${fmtPrice(s.last.basePrice,s.currency)}</div><div class="subtext">${esc(s.last.supplier?.name||'Sin proveedor')} · ${safeDate(s.last.date)}</div></div><div class="price-intel-card"><div class="label">Mejor</div><div class="value">${fmtPrice(s.best.basePrice,s.currency)}</div><div class="subtext">${esc(s.best.supplier?.name||'Sin proveedor')}</div></div><div class="price-intel-card"><div class="label">Promedio ponderado</div><div class="value">${fmtPrice(s.weighted,s.currency)}</div><div class="subtext">Por cantidad comprada</div></div><div class="price-intel-card"><div class="label">Más alto</div><div class="value">${fmtPrice(s.worst.basePrice,s.currency)}</div><div class="subtext">${esc(s.worst.supplier?.name||'Sin proveedor')}</div></div></div>${historyTable(s.list)}`).join('');
    };
    $('#priceIntelProduct').onchange=draw;draw();
  }
  window.openPriceAnalysis=openPriceAnalysis;

  function injectPriceAnalysisButton(){
    if(profile?.role!=='admin')return;
    const page=document.querySelector('#page-purchases');
    if(!page||page.querySelector('#priceIntelOpen'))return;
    const head=page.querySelector('.section-head .split-actions');
    if(!head)return;
    const b=document.createElement('button');b.id='priceIntelOpen';b.className='btn sm soft';b.textContent='📈 Análisis de precios';b.onclick=()=>openPriceAnalysis();head.prepend(b);
  }

  function livePricePanel(){
    if(profile?.role!=='admin')return;
    const productSel=document.querySelector('#pciProduct'),priceInput=document.querySelector('#pciPrice'),currencySel=document.querySelector('#pcCurrency'),factorInput=document.querySelector('#pciFactor');
    if(!productSel||!priceInput||!currencySel||!factorInput)return;
    let panel=document.querySelector('#priceIntelLive');
    if(!panel){panel=document.createElement('div');panel.id='priceIntelLive';priceInput.closest('.two')?.insertAdjacentElement('afterend',panel)}
    const render=()=>{
      document.querySelector('#priceIntelRecent')?.remove();
      const productId=productSel.value,currency=currencySel.value,factor=num(factorInput.value)||1,current=num(priceInput.value)/factor,rows=priceHistory(productId).filter(x=>x.currency===currency),p=productById(productId);
      if(!productId||!rows.length){panel.className='';panel.innerHTML=productId?'<div class="price-intel-panel"><b>Sin historial comparable todavía.</b><div class="hint">Esta compra empezará el historial de precios de este producto.</div></div>':'';return}
      const s=currencyStats(rows)[0],diff=s.last.basePrice?((current-s.last.basePrice)/s.last.basePrice)*100:0;
      let cls='',label='Ingresá el precio para compararlo';
      if(current>0){if(current<s.weighted){cls='good';label='🟢 Buen precio: por debajo del promedio histórico';}else if(diff>10){cls='bad';label='🔴 Precio alto: más de 10% sobre la última compra';}else if(diff>=5){cls='warn';label='🟡 Revisar: entre 5% y 10% sobre la última compra';}else{label='Precio dentro del rango reciente';}}
      panel.className=`price-intel-panel ${cls}`;panel.innerHTML=`<div class="line"><div><b>${label}</b><div class="subtext">${esc(p?.name||'')} · comparación en ${esc(currency)} por ${esc(p?.base_unit||'unidad base')}</div></div><button type="button" id="priceIntelDetail" class="btn sm soft">Últimas 5</button></div><div class="metric-pills"><span>Último: ${fmtPrice(s.last.basePrice,currency)}</span><span>Mejor: ${fmtPrice(s.best.basePrice,currency)}</span><span>Promedio: ${fmtPrice(s.weighted,currency)}</span>${current>0?`<span>Actual: ${fmtPrice(current,currency)}${s.last.basePrice?' · '+pct(diff):''}</span>`:''}</div>`;
      const recent=document.createElement('div');recent.id='priceIntelRecent';recent.style.display='none';recent.innerHTML=historyTable(rows,5);panel.insertAdjacentElement('afterend',recent);document.querySelector('#priceIntelDetail').onclick=()=>{recent.style.display=recent.style.display==='none'?'block':'none'};
    };
    if(!productSel.dataset.priceIntelBound){productSel.dataset.priceIntelBound='1';['change','input'].forEach(ev=>productSel.addEventListener(ev,render));priceInput.addEventListener('input',render);currencySel.addEventListener('change',render);factorInput.addEventListener('input',render);document.querySelector('#pcAddItem')?.addEventListener('click',()=>setTimeout(render,0))}
    render();
  }

  function supplierPurchases(id){return (D.purchases||[]).filter(p=>p.supplier_id===id&&p.status!=='cancelled').sort((a,b)=>new Date(b.ordered_date||b.created_at)-new Date(a.ordered_date||a.created_at))}
  function supplierItems(id){const ids=new Set(supplierPurchases(id).map(p=>p.id));return (D.purchaseItems||[]).filter(i=>ids.has(i.purchase_id))}
  function supplierTotals(id){const result={};supplierPurchases(id).forEach(p=>{const total=(D.purchaseItems||[]).filter(i=>i.purchase_id===p.id).reduce((a,i)=>a+num(i.quantity)*num(i.unit_price),0);result[p.currency]=(result[p.currency]||0)+total});return result}

  function openSupplierProfile(id){
    if(profile?.role!=='admin')return;
    const s=supplierById(id);if(!s)return;
    const purchases=supplierPurchases(id),items=supplierItems(id),totals=supplierTotals(id),linked=items.filter(i=>i.product_id),productIds=[...new Set(linked.map(i=>i.product_id))],latest=purchases[0];
    const productCards=productIds.map(pid=>{
      const p=productById(pid),rows=priceHistory(pid).filter(r=>r.purchase.supplier_id===id);
      return `<div class="row"><div class="line"><div><div class="title">${esc(p?.name||linked.find(i=>i.product_id===pid)?.description||'Producto')}</div><div class="subtext">${rows.length} compra${rows.length===1?'':'s'} registrada${rows.length===1?'':'s'}</div></div><button class="btn sm soft" data-supplier-price-product="${pid}">Historial</button></div><div class="metric-pills">${currencyStats(rows).map(x=>`<span>${esc(x.currency)} último ${fmtPrice(x.last.basePrice,x.currency)} / ${esc(p?.base_unit||'base')}</span><span>mejor ${fmtPrice(x.best.basePrice,x.currency)}</span>`).join('')}</div></div>`;
    }).join('');
    openModal(s.name,'Ficha 360° del proveedor',`<div class="price-intel-grid"><div class="price-intel-card"><div class="label">RUC</div><div class="value" style="font-size:15px">${esc(s.tax_id||'Sin RUC')}</div></div><div class="price-intel-card"><div class="label">Teléfono</div><div class="value" style="font-size:15px">${esc(s.phone||'Sin teléfono')}</div></div><div class="price-intel-card"><div class="label">Compras</div><div class="value">${purchases.length}</div><div class="subtext">No canceladas</div></div><div class="price-intel-card"><div class="label">Última compra</div><div class="value" style="font-size:15px">${latest?safeDate(latest.ordered_date||latest.created_at):'—'}</div><div class="subtext">${latest?esc(latest.order_reference||latest.status||''):'Sin compras'}</div></div></div><div class="card"><div class="eyebrow">MONTO HISTÓRICO REGISTRADO</div><div class="metric-pills" style="margin-top:8px">${Object.entries(totals).map(([c,v])=>`<span><b>${fmtPrice(v,c)}</b></span>`).join('')||'<span>Sin compras</span>'}</div>${s.notes?`<div class="hint" style="margin-top:8px">${esc(s.notes)}</div>`:''}</div><div class="section-head"><div><h2>Productos comprados</h2><p>Precios normalizados a la unidad base del inventario</p></div></div><div class="supplier-profile-products">${productCards||'<div class="empty">Todavía no hay productos de inventario vinculados a este proveedor.</div>'}</div><div class="section-head"><div><h2>Compras recientes</h2><p>Últimos movimientos comerciales registrados</p></div></div><div class="list">${purchases.slice(0,15).map(p=>`<div class="row"><div class="line"><div><div class="title">${safeDate(p.ordered_date||p.created_at)} · ${esc(p.order_reference||'Sin referencia')}</div><div class="subtext">${(D.purchaseItems||[]).filter(i=>i.purchase_id===p.id).map(i=>esc(i.description)).slice(0,3).join(' · ')}</div></div><span class="badge">${esc(p.currency||'')}</span></div></div>`).join('')||'<div class="empty">Sin compras registradas.</div>'}</div>`);
    $$('[data-supplier-price-product]').forEach(b=>b.onclick=()=>openPriceAnalysis(b.dataset.supplierPriceProduct));
  }
  window.openSupplierProfile=openSupplierProfile;

  function enhanceSupplierAdmin(){
    if(profile?.role!=='admin')return;
    const box=document.querySelector('#adminBox');if(!box||!document.querySelector('#supplierNew'))return;
    const list=box.querySelector('.list');if(!list)return;
    [...list.querySelectorAll('.row')].forEach((row,i)=>{
      const s=(D.suppliers||[])[i];if(!s||row.querySelector('[data-supplier-profile]'))return;
      row.classList.add('clickable');row.dataset.supplierProfile=s.id;
      const b=document.createElement('button');b.type='button';b.className='btn sm soft';b.dataset.supplierProfile=s.id;b.textContent='Ficha 360°';row.appendChild(b);
      row.onclick=e=>{if(e.target.closest('button'))return;openSupplierProfile(s.id)};b.onclick=e=>{e.stopPropagation();openSupplierProfile(s.id)};
    });
  }

  const previousRenderPurchases=window.renderPurchases;
  if(typeof previousRenderPurchases==='function')window.renderPurchases=function(){const out=previousRenderPurchases.apply(this,arguments);setTimeout(injectPriceAnalysisButton,0);return out};
  const previousAdminSuppliers=window.adminSuppliers;
  if(typeof previousAdminSuppliers==='function')window.adminSuppliers=function(){const out=previousAdminSuppliers.apply(this,arguments);setTimeout(enhanceSupplierAdmin,0);return out};
  const observer=new MutationObserver(()=>{injectPriceAnalysisButton();livePricePanel();enhanceSupplierAdmin()});
  observer.observe(document.body,{childList:true,subtree:true});
})();
