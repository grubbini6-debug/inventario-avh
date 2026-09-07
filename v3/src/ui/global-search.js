// AVH — Búsqueda global por lupa, disponible para todos los roles.
// Los resultados respetan el alcance de datos ya cargado por RLS y las pantallas permitidas por rol.
(function(){
  let selectedIndex=0;
  let currentResults=[];

  const normalize=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const compact=v=>normalize(v).replace(/[^a-z0-9]+/g,' ');
  const date=v=>{if(!v)return'';try{return new Date(String(v).length===10?v+'T12:00:00':v).toLocaleDateString('es-PY')}catch{return String(v)}};
  const product=id=>(D.products||[]).find(x=>x.id===id);
  const supplier=id=>(D.suppliers||[]).find(x=>x.id===id);
  const purchaseItems=id=>(D.purchaseItems||[]).filter(x=>x.purchase_id===id);
  const purchaseRef=p=>p.po_number||p.order_reference||('COMPRA-'+String(p.id||'').slice(0,8).toUpperCase());

  function ensureOverlay(){
    let overlay=document.querySelector('#globalSearchOverlay');
    if(overlay)return overlay;
    overlay=document.createElement('div');
    overlay.id='globalSearchOverlay';
    overlay.className='global-search-overlay hide';
    overlay.innerHTML=`
      <div class="global-search-dialog" role="dialog" aria-modal="true" aria-label="Buscar en AVH">
        <div class="global-search-input-wrap">
          <span class="global-search-icon" aria-hidden="true">🔍</span>
          <input id="globalSearchInput" type="search" autocomplete="off" spellcheck="false" placeholder="Buscar producto, compra, proveedor, barcaza…">
          <button id="globalSearchClose" type="button" aria-label="Cerrar búsqueda">✕</button>
        </div>
        <div id="globalSearchHint" class="global-search-hint">Buscá por nombre, SKU, OC, proveedor, barcaza o movimiento.</div>
        <div id="globalSearchResults" class="global-search-results"></div>
        <div class="global-search-footer"><span>↑ ↓ navegar · Enter abrir</span><span class="desktop-search-shortcut">Ctrl K</span></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('mousedown',e=>{if(e.target===overlay)closeSearch()});
    $('#globalSearchClose').onclick=closeSearch;
    $('#globalSearchInput').addEventListener('input',render);
    $('#globalSearchInput').addEventListener('keydown',onKeyDown);
    return overlay;
  }

  function scoreText(query,fields){
    const q=compact(query);if(!q)return 0;
    let best=0;
    for(const raw of fields){
      const t=compact(raw);if(!t)continue;
      if(t===q)best=Math.max(best,100);
      else if(t.startsWith(q))best=Math.max(best,80);
      else if(t.split(' ').some(x=>x.startsWith(q)))best=Math.max(best,65);
      else if(t.includes(q))best=Math.max(best,45);
      const parts=q.split(' ').filter(Boolean);
      if(parts.length>1&&parts.every(x=>t.includes(x)))best=Math.max(best,55);
    }
    return best;
  }

  function buildResults(query){
    const out=[];
    const admin=profile?.role==='admin';

    (D.products||[]).filter(x=>x.active!==false).forEach(p=>{
      const score=scoreText(query,[p.name,p.sku,p.base_unit]);
      if(score)out.push({type:'product',section:'Productos',id:p.id,title:p.name,meta:[p.sku||'Sin SKU',p.base_unit].filter(Boolean).join(' · '),score:score+20});
    });

    (D.barges||[]).filter(x=>x.active!==false).forEach(b=>{
      const score=scoreText(query,[b.name,'Barcaza '+b.number,String(b.number)]);
      if(score)out.push({type:'barge',section:'Barcazas',id:b.id,title:'Barcaza '+b.number,meta:b.name&&b.name!=='Barcaza '+b.number?b.name:'Proyecto / consumo',score:score+8});
    });

    (D.moves||[]).forEach(m=>{
      const lines=(m.movement_lines||[]).map(l=>l.products?.name||product(l.product_id)?.name||'');
      const score=scoreText(query,[m.movement_no,'Movimiento '+m.movement_no,m.person_receiving,m.destination,m.destination_text,...lines]);
      if(score)out.push({type:'movement',section:'Movimientos',id:m.id,title:`Movimiento #${m.movement_no||'—'}`,meta:[date(m.created_at),lines.filter(Boolean).slice(0,2).join(' · '),m.destination||m.destination_text].filter(Boolean).join(' · '),score});
    });

    (D.warehouses||[]).filter(x=>x.active!==false).forEach(w=>{
      const score=scoreText(query,[w.name,w.code,'Deposito '+w.name]);
      if(score)out.push({type:'warehouse',section:'Depósitos',id:w.id,title:w.name,meta:w.code||'Ver inventario del depósito',score});
    });

    if(admin){
      (D.suppliers||[]).forEach(s=>{
        const score=scoreText(query,[s.name,s.tax_id,s.phone]);
        if(score)out.push({type:'supplier',section:'Proveedores',id:s.id,title:s.name,meta:[s.tax_id?'RUC '+s.tax_id:'',s.phone].filter(Boolean).join(' · ')||'Ficha de proveedor',score:score+15});
      });

      (D.purchases||[]).forEach(p=>{
        const items=purchaseItems(p.id);
        const s=supplier(p.supplier_id);
        const score=scoreText(query,[
          purchaseRef(p),p.po_number,p.order_reference,p.invoice_number,p.company_name,p.supplier_name,s?.name,
          p.destination_text,p.warehouse_name,p.requester,p.sector,...items.map(i=>i.description)
        ]);
        if(score)out.push({
          type:'purchase',section:'Compras',id:p.id,title:purchaseRef(p),
          meta:[p.supplier_name||s?.name||'Sin proveedor',date(p.ordered_date||p.created_at),items.slice(0,2).map(i=>i.description).filter(Boolean).join(' · ')].filter(Boolean).join(' · '),
          score:score+25
        });
      });
    }

    return out.sort((a,b)=>b.score-a.score||a.title.localeCompare(b.title,'es')).slice(0,36);
  }

  function emptyHtml(query){
    if(!query.trim())return `<div class="global-search-empty"><div class="global-search-empty-icon">🔍</div><b>Buscá en todo AVH</b><span>${profile?.role==='admin'?'Productos, compras, proveedores, barcazas, movimientos y depósitos.':'Productos, barcazas, movimientos y depósitos habilitados para tu usuario.'}</span></div>`;
    return `<div class="global-search-empty"><b>Sin resultados para “${esc(query)}”</b><span>Probá con otro nombre, código o referencia.</span></div>`;
  }

  function render(){
    const input=$('#globalSearchInput'),box=$('#globalSearchResults');if(!input||!box)return;
    const q=input.value;
    currentResults=q.trim()?buildResults(q):[];
    selectedIndex=Math.min(selectedIndex,Math.max(0,currentResults.length-1));
    if(!currentResults.length){box.innerHTML=emptyHtml(q);return}

    const groups=[];
    currentResults.forEach((r,i)=>{
      let g=groups.find(x=>x.section===r.section);
      if(!g){g={section:r.section,rows:[]};groups.push(g)}
      g.rows.push({...r,index:i});
    });
    box.innerHTML=groups.map(g=>`<div class="global-search-group"><div class="global-search-group-title">${esc(g.section)}</div>${g.rows.map(r=>`
      <button type="button" class="global-search-result ${r.index===selectedIndex?'selected':''}" data-global-result="${r.index}">
        <span class="global-search-result-kind">${iconFor(r.type)}</span>
        <span class="global-search-result-copy"><b>${esc(r.title)}</b><small>${esc(r.meta||'')}</small></span>
        <span class="global-search-result-arrow">›</span>
      </button>`).join('')}</div>`).join('');
    box.querySelectorAll('[data-global-result]').forEach(b=>{
      b.onmouseenter=()=>{selectedIndex=Number(b.dataset.globalResult);syncSelected()};
      b.onclick=()=>openResult(Number(b.dataset.globalResult));
    });
    syncSelected(false);
  }

  function iconFor(type){
    return {product:'▦',purchase:'🛒',supplier:'◉',barge:'⚓',movement:'⇅',warehouse:'⌂'}[type]||'•';
  }

  function syncSelected(scroll=true){
    document.querySelectorAll('.global-search-result').forEach(x=>x.classList.toggle('selected',Number(x.dataset.globalResult)===selectedIndex));
    if(scroll)document.querySelector(`.global-search-result[data-global-result="${selectedIndex}"]`)?.scrollIntoView({block:'nearest'});
  }

  function onKeyDown(e){
    if(e.key==='ArrowDown'){e.preventDefault();if(currentResults.length){selectedIndex=(selectedIndex+1)%currentResults.length;syncSelected()}}
    else if(e.key==='ArrowUp'){e.preventDefault();if(currentResults.length){selectedIndex=(selectedIndex-1+currentResults.length)%currentResults.length;syncSelected()}}
    else if(e.key==='Enter'){e.preventDefault();if(currentResults.length)openResult(selectedIndex)}
    else if(e.key==='Escape'){e.preventDefault();closeSearch()}
  }

  function openResult(index){
    const r=currentResults[index];if(!r)return;
    closeSearch();
    if(r.type==='product'){
      if(profile?.role==='admin')return window.openProduct360?.(r.id);
      if(profile?.warehouse_id&&typeof window.openStockDetail==='function')return window.openStockDetail(profile.warehouse_id,r.id);
      goPage('stock');const q=$('#stockSearch');if(q){q.value=product(r.id)?.name||'';renderStock()}
      return;
    }
    if(r.type==='purchase'&&profile?.role==='admin')return window.openPurchaseDetail?.(r.id);
    if(r.type==='supplier'&&profile?.role==='admin')return window.openSupplierProfile?.(r.id);
    if(r.type==='barge')return typeof window.openBarge==='function'?window.openBarge(r.id):null;
    if(r.type==='movement')return typeof window.openMovementDetail==='function'?window.openMovementDetail(r.id):null;
    if(r.type==='warehouse'){
      goPage('stock');const sel=$('#stockWarehouse');if(sel){sel.value=r.id;renderStock()}
    }
  }

  function openSearch(){
    if(!profile)return;
    const overlay=ensureOverlay();
    overlay.classList.remove('hide');
    selectedIndex=0;currentResults=[];
    const input=$('#globalSearchInput');input.value='';
    render();
    requestAnimationFrame(()=>input.focus());
    document.body.classList.add('global-search-open');
  }

  function closeSearch(){
    document.querySelector('#globalSearchOverlay')?.classList.add('hide');
    document.body.classList.remove('global-search-open');
  }

  function bind(){
    const b=$('#globalSearchBtn');
    if(b&&!b.dataset.globalSearchBound){b.dataset.globalSearchBound='1';b.onclick=openSearch}
  }

  document.addEventListener('keydown',e=>{
    const target=e.target;
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){
      e.preventDefault();
      if(document.querySelector('#globalSearchOverlay')?.classList.contains('hide')===false)closeSearch();else openSearch();
      return;
    }
    if(e.key==='Escape'&&document.querySelector('#globalSearchOverlay')&&!document.querySelector('#globalSearchOverlay').classList.contains('hide'))closeSearch();
    if(target?.matches?.('input,textarea,select,[contenteditable="true"]'))return;
  });

  const previousLoadAll=window.loadAll;
  if(typeof previousLoadAll==='function')window.loadAll=async function(){
    const r=await previousLoadAll.apply(this,arguments);
    bind();
    return r;
  };

  window.AVHGlobalSearch={open:openSearch,close:closeSearch,search:buildResults};
  setTimeout(bind,0);
})();