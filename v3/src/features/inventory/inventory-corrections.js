// Administrative correction of erroneous loads. Stock and audit remain server controlled.
(function(){
  let view=0;
  const select='*,movement_lines(*,products(name,base_unit)),purchase_receipts(id,purchase_id)';
  const allowed=()=>profile?.role==='admin';
  const kinds={initial:'Inventario inicial',entry:'Entrada',return:'Devolución'};
  const lines=m=>m.movement_lines||[];
  const receipt=m=>(m.purchase_receipts||[])[0];
  const quantity=l=>`${fmt(l.quantity)} ${esc(l.presentation_label||l.unit||'')}`;
  const visible=token=>$('#inventoryCorrection')?.dataset.view===String(token)&&!$('#modal')?.classList.contains('hide');
  function show(token,title,subtitle,html){
    openModal(title,subtitle,`<div id="inventoryCorrection" data-view="${token}">${html}</div>`);
  }
  function error(token,message){if(visible(token))msg($('#inventoryCorrectionMsg'),message)}
  function summary(m,productId){
    return lines(m).filter(l=>!productId||l.product_id===productId).map(l=>`${quantity(l)} ${esc(l.products?.name||product(l.product_id)?.name||'Producto')}`).join(' · ');
  }
  function purchaseLink(m){
    const r=receipt(m);if(!r)return'';
    return `<div class="card"><div class="title">Recepción de compra</div><p class="subtext">Esta carga se corrige desde su compra para actualizar también las cantidades recibidas y pendientes.</p><button type="button" class="btn soft" data-correction-purchase="${esc(r.purchase_id)}">Revisar recepción en Compras</button></div>`;
  }
  function bindPurchase(){
    $('#inventoryCorrection [data-correction-purchase]')?.addEventListener('click',e=>{closeModal();window.openPurchaseDetail?.(e.currentTarget.dataset.correctionPurchase)});
  }
  async function review(id,options={},token=++view){
    if(!allowed())return;
    show(token,'Eliminar carga del inventario','Revisión de la carga original','<div class="empty">Consultando la carga completa…</div><div id="inventoryCorrectionMsg" role="status"></div>');
    const r=await query('movements',select,`id=eq.${encodeURIComponent(id)}&limit=1`);
    if(!visible(token))return;
    if(r.error)return error(token,r.error);
    const m=r.data?.[0];
    if(!m||m.status==='cancelled')return error(token,'Esta carga ya fue anulada o no está disponible. Actualizá el inventario.');
    if(!kinds[m.type]||!lines(m).length)return error(token,'Esta operación se corrige desde Movimientos.');
    if(receipt(m)){
      show(token,'Revisar carga del inventario',`Movimiento #${m.movement_no}`,purchaseLink(m));bindPurchase();return;
    }
    show(token,'Eliminar carga del inventario',`${kinds[m.type]} #${m.movement_no} · ${whName(m.warehouse_to_id)}`,`
      <div class="card"><div class="title">Se descontarán estas cantidades</div><p class="subtext">${lines(m).length>1?`Esta carga incluye ${lines(m).length} ítems. Se eliminará la carga completa con todos los ítems de abajo.`:'Revisá el producto, el depósito y la cantidad antes de confirmar.'}</p><div class="subtext">Cargado el ${esc(dt(m.created_at))}${m.notes?` · ${esc(m.notes)}`:''}</div></div>
      <div class="list" style="margin:10px 0">${lines(m).map(l=>`<div class="row"><div class="title">${esc(l.products?.name||product(l.product_id)?.name||'Producto')}</div><div class="subtext">${quantity(l)} · equivale a ${fmt(Number(l.quantity)*Number(l.factor_to_base))} ${esc(l.products?.base_unit||product(l.product_id)?.base_unit||l.unit||'')}</div></div>`).join('')}</div>
      <p class="subtext">El historial conservará la carga original, tu usuario y el motivo. Si el material ya se usó en otro movimiento, el sistema bloqueará la eliminación.</p>
      <div class="field"><label for="inventoryCorrectionReason">Motivo de la eliminación</label><textarea id="inventoryCorrectionReason" rows="2" maxlength="1000" placeholder="Ej. carga duplicada o cantidad ingresada por error"></textarea></div>
      <label class="check-line"><input id="inventoryCorrectionConfirm" type="checkbox"> Revisé todos los ítems y quiero descontar esta carga del inventario.</label>
      <div id="inventoryCorrectionMsg" role="status" aria-live="polite"></div>
      <div class="split-actions" style="margin-top:12px"><button type="button" class="btn soft" id="inventoryCorrectionCancel">Cancelar</button><button type="button" class="btn danger" id="inventoryCorrectionSave" disabled>Eliminar carga</button></div>`);
    const button=$('#inventoryCorrectionSave'),check=$('#inventoryCorrectionConfirm'),reason=$('#inventoryCorrectionReason');
    let pending=false;
    check.onchange=()=>{button.disabled=pending||!check.checked};
    $('#inventoryCorrectionCancel').onclick=closeModal;
    button.onclick=async()=>{
      if(pending||!allowed()||!check.checked)return;
      const motive=reason.value.trim();
      if(motive.length<3){error(token,'Escribí el motivo de la eliminación.');reason.focus();return}
      pending=true;button.disabled=true;check.disabled=true;reason.disabled=true;button.textContent='Eliminando…';
      const result=await rpc('admin_void_movement',{p_movement_id:m.id,p_reason:motive});
      if(result.error){
        pending=false;button.disabled=!check.checked;check.disabled=false;reason.disabled=false;button.textContent='Eliminar carga';error(token,result.error);return;
      }
      let refreshed=true;
      try{await loadAll(true);await options.onSuccess?.()}catch{refreshed=false}
      if(!visible(token))return;
      show(token,'Carga eliminada del inventario',`Movimiento #${m.movement_no}`,`<div class="card"><div class="title">La carga quedó anulada</div><p class="subtext">${refreshed?'El stock se actualizó.':'Recargá la página para consultar el stock actualizado.'} El historial conserva la carga original y el motivo de la eliminación.</p></div><button type="button" class="btn primary" id="inventoryCorrectionDone" style="margin-top:12px">Cerrar</button>`);
      $('#inventoryCorrectionDone').onclick=closeModal;
    };
  }
  async function open(warehouseId,productId,options={}){
    if(!allowed())return;
    const token=++view;
    show(token,'Eliminar carga del inventario',`${product(productId)?.name||'Producto'} · ${whName(warehouseId)}`,'<div class="empty">Buscando las cargas de este producto…</div><div id="inventoryCorrectionMsg" role="status"></div>');
    // The matching alias filters the parent without hiding other items in the same load.
    const r=await queryAll('movements',`${select},matched_lines:movement_lines!inner(product_id)`,`warehouse_to_id=eq.${encodeURIComponent(warehouseId)}&type=in.(initial,entry,return)&status=neq.cancelled&matched_lines.product_id=eq.${encodeURIComponent(productId)}&order=created_at.desc,id.desc`);
    if(!visible(token))return;
    if(r.error)return error(token,r.error);
    const rows=r.data||[];
    show(token,'Eliminar carga del inventario',`${product(productId)?.name||'Producto'} · ${whName(warehouseId)}`,`
      <p class="subtext">Elegí la carga que se ingresó mal. Antes de eliminarla vas a revisar todos sus ítems y registrar el motivo.</p>
      <div class="list">${rows.map(m=>`<div class="row"><div class="title">${esc(kinds[m.type]||m.type)} #${esc(m.movement_no)}</div><div class="subtext">${summary(m,productId)}<br>${esc(dt(m.created_at))}${m.notes?` · ${esc(m.notes)}`:''}${lines(m).length>1?`<br>La carga completa contiene ${lines(m).length} ítems.`:''}${receipt(m)?'<br>Recepción de compra: se revisa desde Compras.':''}</div><button type="button" class="btn sm soft" data-review-inventory-load="${esc(m.id)}" style="margin-top:8px">Revisar carga</button></div>`).join('')||'<div class="empty">No hay cargas de inventario inicial, entradas o devoluciones para este producto. Las transferencias y salidas se revisan desde Movimientos.</div>'}</div>
      <div id="inventoryCorrectionMsg" role="status"></div>`);
    document.querySelectorAll('#inventoryCorrection [data-review-inventory-load]').forEach(b=>b.onclick=()=>review(b.dataset.reviewInventoryLoad,options));
  }
  async function openLine(lineId,options={}){
    if(!allowed())return;
    const token=++view;
    show(token,'Eliminar carga del inventario','Inventario inicial','<div class="empty">Buscando la carga original…</div><div id="inventoryCorrectionMsg" role="status"></div>');
    const r=await query('movements','id,matched_lines:movement_lines!inner(id)',`matched_lines.id=eq.${encodeURIComponent(lineId)}&limit=1`);
    if(!visible(token))return;
    if(r.error)return error(token,r.error);
    if(!r.data?.[0])return error(token,'No se encontró la carga original. Actualizá el inventario.');
    return review(r.data[0].id,options,token);
  }
  const previousRenderStock=window.renderStock;
  window.renderStock=function(){
    const result=previousRenderStock.apply(this,arguments);
    if(allowed())$$('#stockList [data-stock]').forEach(row=>{
      const [warehouseId,productId]=row.dataset.stock.split('|');
      const actions=document.createElement('div');actions.className='split-actions';actions.style.marginTop='10px';
      const button=document.createElement('button');button.type='button';button.className='btn sm danger';button.textContent='Eliminar carga';button.dataset.removeInventory=row.dataset.stock;
      button.onclick=e=>{e.stopPropagation();open(warehouseId,productId)};actions.appendChild(button);row.appendChild(actions);
    });
    return result;
  };
  window.AVHInventoryCorrections={open,openLine};
})();
