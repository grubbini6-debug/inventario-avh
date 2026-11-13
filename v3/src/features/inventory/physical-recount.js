// A physical count replaces the current balance through an audited difference.
(function(){
  let view=0;
  const allowed=warehouseId=>profile?.active&&profile.role==='depositor'&&!!profile.warehouse_id&&profile.warehouse_id===warehouseId;
  const visible=(token,user)=>profile?.id===user&&$('#inventoryRecount')?.dataset.view===String(token)&&!$('#modal')?.classList.contains('hide');
  const show=(token,title,warehouseId,html)=>openModal(title,whName(warehouseId),`<div id="inventoryRecount" data-view="${token}">${html}</div>`);
  function choose(){
    const warehouseId=profile?.warehouse_id;if(!allowed(warehouseId))return;
    const token=++view;
    show(token,'Nuevo conteo de inventario',warehouseId,`
      <p class="subtext">Elegí el producto y cargá la cantidad total que tenés físicamente hoy.</p>
      <div class="field"><label for="inventoryRecountProduct">Producto</label><select id="inventoryRecountProduct">${(D.products||[]).filter(p=>p.active).map(p=>`<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.base_unit)}</option>`).join('')}</select></div>
      <button type="button" class="btn primary" id="inventoryRecountChoose">Consultar cantidad actual</button>`);
    $('#inventoryRecountChoose').onclick=()=>open(warehouseId,$('#inventoryRecountProduct').value);
  }
  async function open(warehouseId,productId){
    if(!allowed(warehouseId)||!productId)return;
    const token=++view,user=profile.id;
    show(token,'Corregir cantidad',warehouseId,'<div class="empty">Consultando el stock actual…</div><div id="inventoryRecountMsg" role="status"></div>');
    const r=await rpc('inventory_recount_context',{p_warehouse_id:warehouseId,p_product_id:productId});
    if(!visible(token,user))return;
    if(r.error){msg($('#inventoryRecountMsg'),r.error);return}
    const c=r.data;
    if(!c?.version){msg($('#inventoryRecountMsg'),'No se pudo consultar la cantidad actual. Volvé a abrir el conteo.');return}
    if(c.gas_managed){
      show(token,'Corregir conteo de gases',warehouseId,`<p class="subtext">Para ${esc(c.product_name)}, contá los cilindros llenos, vacíos y los que están con otras personas desde Gases.</p><button type="button" class="btn primary" id="inventoryRecountGas">Abrir nuevo conteo de gases</button>`);
      $('#inventoryRecountGas').onclick=async()=>{closeModal();goPage('gases');await window.AVHGases.refresh();window.AVHGases.openCount()};return;
    }
    show(token,'Corregir cantidad',warehouseId,`
      <div class="card"><div class="title">${esc(c.product_name)}</div><p class="subtext">Cantidad registrada: <b>${fmt(c.stock_qty)} ${esc(c.base_unit)}</b></p></div>
      <p class="subtext">Ingresá el total que tenés ahora, incluyendo lo que ya estaba cargado. El sistema registrará la diferencia y conservará el historial.</p>
      <form id="inventoryRecountForm">
        <div class="field"><label for="inventoryRecountQty">Cantidad física total (${esc(c.base_unit)})</label><input id="inventoryRecountQty" type="number" inputmode="decimal" min="0" max="999999999999.999999" step="any" required value="${esc(c.stock_qty)}"></div>
        <div id="inventoryRecountPreview" class="notice" role="status" aria-live="polite"></div>
        <div class="field"><label for="inventoryRecountReason">Motivo de la corrección</label><textarea id="inventoryRecountReason" rows="2" minlength="3" maxlength="1000" required placeholder="Ej.: corregí una cantidad mal cargada al contar el depósito"></textarea></div>
        <div id="inventoryRecountMsg" role="status" aria-live="polite"></div>
        <div class="split-actions"><button type="button" class="btn soft" id="inventoryRecountCancel">Cancelar</button><button type="submit" class="btn primary" id="inventoryRecountSave">Guardar cantidad corregida</button><button type="button" class="btn soft hide" id="inventoryRecountReload">Volver a consultar stock</button></div>
      </form>`);
    const qty=$('#inventoryRecountQty'),reason=$('#inventoryRecountReason'),button=$('#inventoryRecountSave'),reload=$('#inventoryRecountReload');
    let pending=false,attempt=null;
    function preview(){
      const raw=qty.value.trim(),value=Number(raw),delta=value-Number(c.stock_qty);
      $('#inventoryRecountPreview').textContent=raw!==''&&Number.isFinite(value)&&value>=0?`El stock quedará en ${fmt(value)} ${c.base_unit}. Diferencia: ${delta>0?'+':''}${fmt(delta)} ${c.base_unit}.`:'Ingresá una cantidad válida, igual o mayor que cero.';
    }
    qty.oninput=preview;preview();$('#inventoryRecountCancel').onclick=closeModal;reload.onclick=()=>open(warehouseId,productId);
    $('#inventoryRecountForm').onsubmit=async e=>{
      e.preventDefault();if(pending||!allowed(warehouseId)||profile.id!==user)return;
      if(!attempt){
        const raw=qty.value.trim(),value=Number(raw),motive=reason.value.trim();
        if(raw===''||!Number.isFinite(value)||value<0||value>=1e12){msg($('#inventoryRecountMsg'),'Ingresá una cantidad válida, igual o mayor que cero.');qty.focus();return}
        if(motive.length<3){msg($('#inventoryRecountMsg'),'Escribí el motivo de la corrección.');reason.focus();return}
        attempt={p_warehouse_id:warehouseId,p_product_id:productId,p_counted_qty:value,p_expected_version:c.version,p_reason:motive,p_request_id:crypto.randomUUID()};
      }
      pending=true;qty.disabled=reason.disabled=button.disabled=true;reload.classList.add('hide');button.textContent='Guardando conteo…';
      let result;try{result=await rpc('record_inventory_recount',attempt)}catch{result={error:'No se pudo conectar con el servidor.',network:true}}
      if(!visible(token,user))return;
      if(result.error){
        const uncertain=result.network||[408,429].includes(result.status)||Number(result.status)>=500;
        pending=false;button.disabled=false;
        if(uncertain){button.textContent='Reintentar guardado';msg($('#inventoryRecountMsg'),'No se pudo confirmar el resultado. Reintentá el mismo conteo para verificarlo sin duplicar el ajuste.');return}
        attempt=null;qty.disabled=reason.disabled=false;button.textContent='Guardar cantidad corregida';reload.classList.remove('hide');msg($('#inventoryRecountMsg'),result.error);return;
      }
      let refreshed=true;try{await loadAll(true)}catch{refreshed=false}
      if(!visible(token,user))return;
      const saved=result.data;
      show(token,'Cantidad corregida',warehouseId,`<div class="success">El stock de ${esc(c.product_name)} quedó en ${fmt(saved?.stock_after??attempt.p_counted_qty)} ${esc(c.base_unit)}.</div><p class="subtext">Quedaron registrados la cantidad anterior, el nuevo conteo, tu usuario y el motivo.</p>${refreshed?'':'<p class="subtext">Actualizá la página para consultar el inventario.</p>'}<button type="button" class="btn primary" id="inventoryRecountDone">Volver al inventario</button>`);
      $('#inventoryRecountDone').onclick=()=>{closeModal();renderStock()};
    };
  }
  const previousStock=window.renderStock;
  window.renderStock=function(){
    const result=previousStock.apply(this,arguments),warehouseId=profile?.warehouse_id,host=$('#stockList');
    $('#inventoryRecountToolbar')?.remove();
    if(allowed(warehouseId)&&host){
      const toolbar=document.createElement('div');toolbar.id='inventoryRecountToolbar';toolbar.className='card';toolbar.style.marginBottom='12px';
      toolbar.innerHTML='<div class="title">Revisar cantidades del depósito</div><p class="subtext">Si una cantidad está mal cargada, registrá el total que tenés físicamente.</p><button type="button" class="btn primary" id="inventoryRecountNew">Nuevo conteo</button>';
      host.before(toolbar);$('#inventoryRecountNew').onclick=choose;
      $$('[data-stock]').forEach(row=>{
        const [wh,productId]=row.dataset.stock.split('|');if(wh!==warehouseId)return;
        const b=document.createElement('button');b.type='button';b.className='btn sm primary';b.textContent='Corregir cantidad';b.dataset.recountStock=productId;b.style.marginTop='10px';b.style.marginRight='8px';
        b.onclick=e=>{e.stopPropagation();open(wh,productId)};row.appendChild(b);
      });
    }
    return result;
  };
  window.AVHInventoryRecount={open,choose};
})();
