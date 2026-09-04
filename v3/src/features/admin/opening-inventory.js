// AVH — Inventario de apertura: depósito cuenta, administración valoriza y cierra.
(function(){
  let selectedWarehouse=null;
  const safe=s=>typeof esc==='function'?esc(String(s??'')):String(s??'');
  const n=v=>{const x=Number(v);return Number.isFinite(x)?x:0};

  async function refreshSessions(){
    const r=await query('warehouse_opening_inventory','*','order=opened_at.desc');
    if(!r.error)D.openingInventorySessions=r.data||[];
  }
  async function rowsFor(warehouseId){
    const r=await rpc('admin_opening_inventory_lines',{p_warehouse_id:warehouseId});
    if(r.error)throw Error(r.error);
    return r.data||[];
  }
  function sessionFor(warehouseId){return(D.openingInventorySessions||[]).find(x=>x.warehouse_id===warehouseId)||null}
  function whOptions(selected){return(D.warehouses||[]).filter(x=>x.active).map(w=>`<option value="${w.id}" ${w.id===selected?'selected':''}>${safe(w.name)}</option>`).join('')}

  async function renderWarehouse(){
    const box=$('#openingInventoryBody');if(!box||!selectedWarehouse)return;
    box.innerHTML='<div class="empty">Cargando inventario inicial…</div>';
    try{
      await refreshSessions();
      const session=sessionFor(selectedWarehouse),rows=(await rowsFor(selectedWarehouse)).filter(x=>x.movement_line_id);
      const pending=rows.filter(x=>!x.priced).length,priced=rows.length-pending;
      if(!session){
        box.innerHTML=`<div class="card"><div class="eyebrow">INVENTARIO DE APERTURA</div><div class="title" style="margin-top:5px">Todavía no está abierto</div><div class="subtext" style="margin-top:6px">Abrilo para que el depositario cargue todo lo que ya existe físicamente. Él no verá ni cargará precios.</div><button id="openInitialSession" class="btn primary" style="margin-top:12px">Abrir inventario inicial</button><div id="openingMsg"></div></div>`;
        $('#openInitialSession').onclick=async()=>{const b=$('#openInitialSession');b.disabled=true;b.textContent='Abriendo…';const r=await rpc('admin_open_initial_inventory',{p_warehouse_id:selectedWarehouse,p_notes:'Inventario de apertura del depósito'});if(r.error){b.disabled=false;b.textContent='Abrir inventario inicial';return msg($('#openingMsg'),r.error)}await renderWarehouse()};
        return;
      }
      const open=session.status==='open';
      box.innerHTML=`<div class="grid kpis" style="grid-template-columns:repeat(3,minmax(0,1fr));margin-bottom:10px">
        <div class="kpi"><div class="label">Estado</div><div class="value" style="font-size:20px">${open?'ABIERTO':'CERRADO'}</div><div class="meta">${open?'El depósito puede seguir contando':'Carga inicial bloqueada'}</div></div>
        <div class="kpi"><div class="label">Ítems cargados</div><div class="value">${rows.length}</div><div class="meta">Líneas físicas</div></div>
        <div class="kpi ${pending?'alert':''}"><div class="label">Pendientes de precio</div><div class="value">${pending}</div><div class="meta">${priced} valorizados</div></div>
      </div>
      <div class="card"><div class="line"><div class="grow"><div class="title">${open?'El depositario puede seguir cargando':'Inventario inicial cerrado'}</div><div class="subtext">${open?'Cuando termine de contar, poné precio y moneda a cada ítem. El cierre se habilita cuando todos estén valorizados.':'Para corregir cantidades o precios, reabrilo explícitamente.'}</div></div><div class="split-actions">${open?`<button id="closeInitialSession" class="btn primary" ${rows.length===0||pending?'disabled':''}>Cerrar inventario</button>`:`<button id="reopenInitialSession" class="btn soft">Reabrir</button>`}</div></div><div id="openingMsg"></div></div>
      <div class="section-head"><div><h2>Valorar stock inicial</h2><p>Precio por la unidad/presentación que contó el depositario.</p></div></div>
      <div class="list">${rows.map(r=>`<div class="row" data-opening-line="${r.movement_line_id}"><div class="line"><div class="grow"><div class="title">${safe(r.product_name||'Producto')}</div><div class="subtext">Cargado: <b>${fmt(r.quantity)} ${safe(r.presentation_label||r.unit)}</b> · equivale a ${fmt(r.base_quantity)} ${safe(product(r.product_id)?.base_unit||'')} · movimiento #${safe(r.movement_no||'')}</div></div><span class="badge ${r.priced?'green':'amber'}">${r.priced?'VALORIZADO':'SIN PRECIO'}</span></div>
        <div class="two" style="margin-top:9px"><div class="field" style="margin:0"><label>Precio por ${safe(r.presentation_label||r.unit)}</label><input data-opening-price type="number" min="0" step="any" value="${r.entry_unit_cost==null?'':safe(r.entry_unit_cost)}" ${open?'':'disabled'}></div><div class="field" style="margin:0"><label>Moneda</label><select data-opening-currency ${open?'':'disabled'}><option value="PYG" ${r.entry_currency==='PYG'||!r.entry_currency?'selected':''}>PYG</option><option value="USD" ${r.entry_currency==='USD'?'selected':''}>USD</option></select></div></div>
        ${open?`<button class="btn sm primary" data-save-opening-price="${r.movement_line_id}" style="margin-top:8px">Guardar precio</button>`:''}
      </div>`).join('')||'<div class="empty">El depositario todavía no cargó productos.</div>'}</div>`;

      $('#closeInitialSession')?.addEventListener('click',async()=>{const b=$('#closeInitialSession');if(!confirm('¿Cerrar el inventario inicial? Después el depositario ya no podrá cargar Stock inicial hasta que vos lo reabras.'))return;b.disabled=true;b.textContent='Cerrando…';const r=await rpc('admin_close_initial_inventory',{p_warehouse_id:selectedWarehouse});if(r.error){b.disabled=false;b.textContent='Cerrar inventario';return msg($('#openingMsg'),r.error)}await renderWarehouse()});
      $('#reopenInitialSession')?.addEventListener('click',async()=>{const r=await rpc('admin_reopen_initial_inventory',{p_warehouse_id:selectedWarehouse});if(r.error)return msg($('#openingMsg'),r.error);await renderWarehouse()});
      $$('[data-save-opening-price]').forEach(b=>b.onclick=async()=>{const row=b.closest('[data-opening-line]'),price=Number(row.querySelector('[data-opening-price]').value),currency=row.querySelector('[data-opening-currency]').value;if(!Number.isFinite(price)||price<0)return alert('Ingresá un precio válido.');b.disabled=true;b.textContent='Guardando…';const r=await rpc('admin_price_initial_inventory',{p_movement_line_id:b.dataset.saveOpeningPrice,p_unit_cost:price,p_currency:currency,p_exchange_rate:null});if(r.error){b.disabled=false;b.textContent='Guardar precio';return alert(r.error)}await renderWarehouse()});
    }catch(e){box.innerHTML=`<div class="empty">${safe(e.message||String(e))}</div>`}
  }

  window.adminOpeningInventory=function(){
    if(profile?.role!=='admin')return;
    const active=(D.warehouses||[]).filter(x=>x.active);
    if(!selectedWarehouse||!active.some(x=>x.id===selectedWarehouse))selectedWarehouse=active[0]?.id||null;
    $('#adminBox').innerHTML=`<div class="card"><div class="field" style="margin:0"><label>Depósito</label><select id="openingWarehouse">${whOptions(selectedWarehouse)}</select></div></div><div id="openingInventoryBody" style="margin-top:10px"></div>`;
    $('#openingWarehouse').onchange=e=>{selectedWarehouse=e.target.value;renderWarehouse()};
    renderWarehouse();
  };
})();
