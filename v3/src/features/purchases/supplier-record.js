// AVH V3 — Ficha empresarial dedicada de Proveedor.
// Convierte la antigua ficha 360 modal en una página navegable, sin cambiar backend.
(function(){
  let activeSupplierRecordId=null;
  const STATUS={draft:'Borrador',requested:'Solicitado',quoted:'Cotizando',approved:'Aprobado',ordered:'Comprado / pedido',in_transit:'En camino',partially_received:'Recibido parcial',received:'Recibido total',invoiced:'Facturado',closed:'Cerrado',cancelled:'Cancelado'};
  const n=v=>Number.isFinite(Number(v))?Number(v):0;
  const supplier=id=>(D.suppliers||[]).find(x=>x.id===id);
  const product=id=>(D.products||[]).find(x=>x.id===id);
  const purchases=id=>(D.purchases||[]).filter(p=>p.supplier_id===id&&p.status!=='cancelled').sort((a,b)=>new Date(b.ordered_date||b.created_at)-new Date(a.ordered_date||a.created_at));
  const itemsOf=id=>(D.purchaseItems||[]).filter(i=>i.purchase_id===id);
  const date=v=>{if(!v)return'—';try{return new Date(String(v).length===10?v+'T12:00:00':v).toLocaleDateString('es-PY')}catch{return String(v)}};
  const purchaseTotal=p=>n(p.total_amount)||itemsOf(p.id).reduce((a,i)=>a+n(i.quantity)*n(i.unit_price),0);
  const purchaseRef=p=>p.po_number||p.order_reference||('COMPRA-'+String(p.id||'').slice(0,8).toUpperCase());
  const statusBadge=s=>{const cls=s==='cancelled'?'red':s==='partially_received'||s==='in_transit'?'amber':s==='received'||s==='invoiced'||s==='closed'?'green':'';return `<span class="badge ${cls}">${esc(STATUS[s]||s||'—')}</span>`};

  function ensureSupplierPage(){
    let page=document.querySelector('#page-supplier-record');
    if(!page){
      page=document.createElement('section');
      page.id='page-supplier-record';
      page.className='page';
      document.querySelector('#page-purchases')?.after(page);
      if(!page.parentNode)document.querySelector('.app')?.appendChild(page);
    }
    return page;
  }

  function supplierItemRows(id){
    const ps=purchases(id),pmap=new Map(ps.map(p=>[p.id,p]));
    return (D.purchaseItems||[]).map(i=>{
      const p=pmap.get(i.purchase_id);if(!p||!i.product_id)return null;
      const factor=n(i.factor_to_base)||1;
      return{item:i,p,product:product(i.product_id),currency:p.currency||'PYG',date:p.ordered_date||p.created_at||i.created_at,qty:n(i.quantity)*factor,price:n(i.unit_price)/factor};
    }).filter(Boolean).sort((a,b)=>new Date(b.date)-new Date(a.date));
  }

  function priceGroups(id){
    const map=new Map;
    supplierItemRows(id).forEach(x=>{
      const key=x.item.product_id+'|'+x.currency;
      const a=map.get(key)||[];a.push(x);map.set(key,a);
    });
    return [...map.values()].map(list=>{
      list.sort((a,b)=>new Date(b.date)-new Date(a.date));
      const q=list.reduce((s,x)=>s+x.qty,0);
      return{
        product_id:list[0].item.product_id,
        product_name:list[0].product?.name||list[0].item.description||'Producto',
        base_unit:list[0].product?.base_unit||'base',
        currency:list[0].currency,
        records:list.length,
        qty:q,
        last:list[0],
        best:list.reduce((a,b)=>b.price<a.price?b:a,list[0]),
        avg:q?list.reduce((s,x)=>s+x.price*x.qty,0)/q:0
      };
    }).sort((a,b)=>new Date(b.last.date)-new Date(a.last.date));
  }

  function supplierEvents(id){
    const ps=purchases(id),ids=new Set(ps.map(p=>p.id)),events=[];
    ps.forEach(p=>{
      events.push({at:p.created_at||p.ordered_date,title:'Compra registrada',meta:purchaseRef(p)+' · '+money(purchaseTotal(p),p.currency),purchase_id:p.id});
      if(p.purchase_confirmed_at)events.push({at:p.purchase_confirmed_at,title:'Compra confirmada',meta:purchaseRef(p),purchase_id:p.id});
    });
    (D.purchaseReceipts||[]).filter(r=>ids.has(r.purchase_id)).forEach(r=>{
      const p=ps.find(x=>x.id===r.purchase_id);
      events.push({at:r.received_at,title:'Recepción registrada',meta:(p?purchaseRef(p)+' · ':'')+(r.movement_id?'ingresó a inventario':'sin movimiento de inventario'),purchase_id:r.purchase_id});
    });
    (D.purchaseDocuments||[]).filter(d=>ids.has(d.purchase_id)).forEach(d=>{
      const p=ps.find(x=>x.id===d.purchase_id);
      const label={quotation:'Cotización',order:'Pedido / OC',invoice:'Factura',remittance:'Remito',payment:'Comprobante de pago',other:'Documento'}[d.kind]||'Documento';
      events.push({at:d.created_at||d.document_date,title:label+' agregado',meta:(p?purchaseRef(p)+' · ':'')+(d.document_number||d.file_name||'Archivo'),purchase_id:d.purchase_id});
    });
    return events.filter(x=>x.at).sort((a,b)=>new Date(b.at)-new Date(a.at));
  }

  function totalsByCurrency(ps){
    return ps.reduce((a,p)=>{const c=p.currency||'PYG';a[c]=(a[c]||0)+purchaseTotal(p);return a},{});
  }

  function bindTabs(){
    const tabs=[...document.querySelectorAll('#page-supplier-record [data-supplier-tab]')];
    const panels=[...document.querySelectorAll('#page-supplier-record [data-supplier-panel]')];
    tabs.forEach(b=>b.onclick=()=>{
      tabs.forEach(x=>x.classList.toggle('on',x===b));
      panels.forEach(p=>p.classList.toggle('on',p.dataset.supplierPanel===b.dataset.supplierTab));
    });
  }

  function returnToSuppliers(){
    activeSupplierRecordId=null;
    activeModule='admin';activeAdminTab='suppliers';
    goPage('more');renderAdmin('suppliers');
    window.AVHShell?.syncActive?.('more','admin');
  }

  function renderSupplierRecord(id){
    const s=supplier(id);if(!s||profile?.role!=='admin')return;
    activeSupplierRecordId=id;
    const page=ensureSupplierPage(),ps=purchases(id),pg=priceGroups(id),events=supplierEvents(id),tot=totalsByCurrency(ps);
    const open=ps.filter(p=>!['closed','cancelled'].includes(p.status)).length;
    const last=ps[0],productIds=[...new Set(pg.map(x=>x.product_id))];
    const recentProducts=[...new Map(pg.map(x=>[x.product_id,x])).values()];
    goPage('supplier-record');
    activeAdminTab='suppliers';
    page.innerHTML=`<div class="supplier-record">
      <div class="purchase-breadcrumb"><button class="purchase-back" id="supplierBack">← Proveedores</button><span>›</span><b>${esc(s.name)}</b></div>
      <div class="supplier-record-hero">
        <div class="supplier-record-main">
          <div class="eyebrow">FICHA DE PROVEEDOR</div>
          <h2>${esc(s.name)}</h2>
          <div class="supplier-record-contact">${esc(s.tax_id||'Sin RUC')}${s.phone?' · '+esc(s.phone):' · Sin teléfono'}</div>
          <div class="supplier-record-meta">${ps.length} compra${ps.length===1?'':'s'} registrada${ps.length===1?'':'s'} · ${productIds.length} producto${productIds.length===1?'':'s'} vinculado${productIds.length===1?'':'s'}</div>
        </div>
        <div class="supplier-record-actions">
          <button class="btn" id="supplierEditData">Editar datos</button>
          <button class="btn primary" id="supplierNewPurchase">+ Nueva compra</button>
        </div>
      </div>

      <div class="supplier-record-kpis">
        <div class="kpi"><div class="label">Compras registradas</div><div class="value">${ps.length}</div><div class="meta">Sin canceladas</div></div>
        <div class="kpi ${open?'transit':''}"><div class="label">Compras abiertas</div><div class="value">${open}</div><div class="meta">Pendientes de cierre</div></div>
        <div class="kpi"><div class="label">Productos comprados</div><div class="value">${productIds.length}</div><div class="meta">Con vínculo al catálogo</div></div>
        <div class="kpi"><div class="label">Última compra</div><div class="value supplier-kpi-date">${last?date(last.ordered_date||last.created_at):'—'}</div><div class="meta">${last?esc(purchaseRef(last)):'Sin historial'}</div></div>
      </div>

      <div class="supplier-record-tabs">
        <button class="on" data-supplier-tab="summary">Resumen</button>
        <button data-supplier-tab="purchases">Compras <span>${ps.length}</span></button>
        <button data-supplier-tab="products">Productos y precios <span>${productIds.length}</span></button>
        <button data-supplier-tab="activity">Actividad</button>
      </div>

      <div class="supplier-record-panel on" data-supplier-panel="summary">
        <div class="supplier-summary-grid">
          <div class="detail-box"><span>RUC</span><b>${esc(s.tax_id||'Sin RUC')}</b></div>
          <div class="detail-box"><span>Teléfono</span><b>${esc(s.phone||'Sin teléfono')}</b></div>
          <div class="detail-box"><span>Última compra</span><b>${last?date(last.ordered_date||last.created_at):'—'}</b></div>
          <div class="detail-box"><span>Compras abiertas</span><b>${open}</b></div>
        </div>
        <div class="section-head"><div><h2>Monto histórico registrado</h2><p>Monedas separadas; nunca se mezclan USD y PYG</p></div></div>
        <div class="supplier-money-grid">${Object.entries(tot).map(([c,v])=>`<div class="card"><div class="eyebrow">${esc(c)}</div><div class="supplier-money">${money(v,c)}</div><div class="subtext">Total de compras no canceladas</div></div>`).join('')||'<div class="card"><div class="empty">Sin compras registradas.</div></div>'}</div>
        ${s.notes?`<div class="section-head"><div><h2>Notas</h2><p>Información registrada del proveedor</p></div></div><div class="card">${esc(s.notes)}</div>`:''}
        <div class="section-head"><div><h2>Últimas compras</h2><p>Acceso directo al expediente</p></div><button class="btn sm soft" data-supplier-tab-jump="purchases">Ver todas</button></div>
        <div class="list">${ps.slice(0,5).map(p=>`<div class="row clickable supplier-purchase-row" data-supplier-purchase="${p.id}"><div class="line"><div class="grow"><div class="title">${esc(purchaseRef(p))}</div><div class="subtext">${date(p.ordered_date||p.created_at)} · ${esc(p.company_name||'Empresa')} · ${itemsOf(p.id).length} ítem${itemsOf(p.id).length===1?'':'s'}</div></div><div style="text-align:right">${statusBadge(p.status)}<div class="num" style="margin-top:5px">${money(purchaseTotal(p),p.currency)}</div></div></div></div>`).join('')||'<div class="empty">Sin compras registradas.</div>'}</div>
      </div>

      <div class="supplier-record-panel" data-supplier-panel="purchases">
        <div class="section-head"><div><h2>Compras</h2><p>Historial completo con este proveedor</p></div><button class="btn sm primary" id="supplierNewPurchase2">+ Nueva compra</button></div>
        <div class="list">${ps.map(p=>`<div class="row clickable supplier-purchase-row" data-supplier-purchase="${p.id}"><div class="line"><div class="grow"><div class="title">${esc(purchaseRef(p))} · ${esc(p.company_name||'Empresa')}</div><div class="subtext">${date(p.ordered_date||p.created_at)} · ${itemsOf(p.id).map(i=>esc(i.description)).slice(0,3).join(' · ')||'Sin ítems'}</div></div><div style="text-align:right">${statusBadge(p.status)}<div class="num" style="margin-top:5px">${money(purchaseTotal(p),p.currency)}</div></div></div></div>`).join('')||'<div class="empty">Sin compras registradas.</div>'}</div>
      </div>

      <div class="supplier-record-panel" data-supplier-panel="products">
        <div class="section-head"><div><h2>Productos y precios</h2><p>Precio normalizado a unidad base por moneda</p></div></div>
        <div class="supplier-price-list">${recentProducts.map(g=>`<div class="card supplier-price-card"><div class="line"><div class="grow"><div class="title">${esc(g.product_name)}</div><div class="subtext">${g.records} compra${g.records===1?'':'s'} comparable${g.records===1?'':'s'} · ${fmt(g.qty)} ${esc(g.base_unit)}</div></div><button class="btn sm soft" data-supplier-price-product="${g.product_id}">Historial general</button></div><div class="supplier-price-metrics"><div><span>Moneda</span><b>${esc(g.currency)}</b></div><div><span>Último</span><b>${money(g.last.price,g.currency)}</b></div><div><span>Mejor</span><b>${money(g.best.price,g.currency)}</b></div><div><span>Promedio</span><b>${money(g.avg,g.currency)}</b></div></div><div class="subtext" style="margin-top:8px">Última compra: ${date(g.last.date)} · precio por ${esc(g.base_unit)}</div></div>`).join('')||'<div class="empty">No hay productos del catálogo vinculados a este proveedor.</div>'}</div>
      </div>

      <div class="supplier-record-panel" data-supplier-panel="activity">
        <div class="section-head"><div><h2>Actividad</h2><p>Compras, confirmaciones, recepciones y documentos relacionados</p></div></div>
        <div class="purchase-timeline">${events.map(e=>`<div class="purchase-timeline-row ${e.purchase_id?'clickable':''}" ${e.purchase_id?`data-supplier-event-purchase="${e.purchase_id}"`:''}><div class="purchase-timeline-mark"></div><div><b>${esc(e.title)}</b><div class="subtext">${date(e.at)}${e.meta?' · '+esc(e.meta):''}</div></div></div>`).join('')||'<div class="empty">Todavía no hay actividad registrada.</div>'}</div>
      </div>
    </div>`;

    const openNew=()=>window.openNewPurchaseForSupplier?.(id);
    $('#supplierBack').onclick=returnToSuppliers;
    $('#supplierNewPurchase').onclick=openNew;$('#supplierNewPurchase2').onclick=openNew;
    $('#supplierEditData').onclick=()=>{activeModule='admin';activeAdminTab='suppliers';goPage('more');renderAdmin('suppliers');window.AVHShell?.syncActive?.('more','admin')};
    bindTabs();
    document.querySelectorAll('[data-supplier-tab-jump]').forEach(b=>b.onclick=()=>document.querySelector(`[data-supplier-tab="${b.dataset.supplierTabJump}"]`)?.click());
    document.querySelectorAll('[data-supplier-purchase],[data-supplier-event-purchase]').forEach(x=>x.onclick=()=>window.openPurchaseDetail?.(x.dataset.supplierPurchase||x.dataset.supplierEventPurchase));
    document.querySelectorAll('[data-supplier-price-product]').forEach(x=>x.onclick=()=>window.openPriceAnalysis?.(x.dataset.supplierPriceProduct));
    setTimeout(()=>{window.AVHShell?.syncActive?.('more','admin');const title=$('#sectionTitle');if(title)title.textContent=s.name},0);
  }

  const oldOpenSupplierProfile=window.openSupplierProfile;
  window.openSupplierProfile=function(id){if(profile?.role!=='admin')return;return renderSupplierRecord(id)};
  window.openSupplier360=window.openSupplierProfile;

  const previousLoadAll=window.loadAll;
  window.loadAll=async function(force=false){
    await previousLoadAll.apply(this,arguments);
    if(activeSupplierRecordId&&document.querySelector('#page-supplier-record')?.classList.contains('on')&&(D.suppliers||[]).some(x=>x.id===activeSupplierRecordId)){
      renderSupplierRecord(activeSupplierRecordId);
    }
  };

  window.AVHSupplierRecord={open:renderSupplierRecord,back:returnToSuppliers,legacy:oldOpenSupplierProfile};
})();