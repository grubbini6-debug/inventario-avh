// AVH V8: edición segura de ítems de Compras con preservación de recepciones y costos históricos.
(function(){
  const UNITS=['unidad','pieza','kg','tonelada','rollo','bobina','caja','paquete','bolsa','metro','m²','m³','litro','cilindro','tambor','pallet','juego','par','docena','plancha','barra','tubo','perfil','balde','bidón','kit','servicio','viaje','hora','día','otro'];
  const priorOpenPurchaseDetail=window.openPurchaseDetail;

  function purchaseItemProductOptions(item){
    const active=(D.products||[]).filter(x=>x.active||x.id===item.product_id);
    return `<option value="">Sin producto de catálogo</option>${active.map(x=>`<option value="${x.id}" ${x.id===item.product_id?'selected':''}>${esc(x.name)} · ${esc(x.base_unit||'')}</option>`).join('')}`;
  }
  function purchaseItemUnitOptions(selected){
    const vals=[...new Set([selected,...UNITS].filter(Boolean))];
    return vals.map(x=>`<option value="${esc(x)}" ${x===selected?'selected':''}>${esc(x)}</option>`).join('');
  }
  function findPurchaseItemSection(){
    const body=document.querySelector('#modalBody');
    if(!body)return null;
    const head=[...body.querySelectorAll('.section-head')].find(x=>x.querySelector('h2')?.textContent?.trim()==='Ítems comprados');
    return head?.nextElementSibling?.classList?.contains('list')?head.nextElementSibling:null;
  }

  async function openPurchaseItemEditor(itemId){
    if(profile?.role!=='admin')return;
    const item=(D.purchaseItems||[]).find(x=>x.id===itemId);
    if(!item)return alert('Ítem de compra no encontrado.');
    const p=(D.purchases||[]).find(x=>x.id===item.purchase_id);
    if(!p)return alert('Compra no encontrada.');
    if(['closed','cancelled','invoiced'].includes(p.status))return alert('Esta compra ya está cerrada, cancelada o facturada y sus ítems no se pueden modificar.');
    const received=Number(item.received_qty||0),pending=Math.max(0,Number(item.quantity||0)-received);
    openModal('Editar ítem de compra',`${p.supplier_name||'Proveedor'} · ${received?`${fmt(received)} recibido · ${fmt(pending)} pendiente`:'Todavía sin recepción'}`,`
      ${received?`<div class="notice"><b>Hay mercadería ya recibida.</b> Podés corregir la cantidad total. Si cambiás producto, unidad, conversión, precio o condición de stock, el sistema preservará lo recibido y creará una línea nueva solamente para el saldo pendiente.</div>`:`<div class="notice">Como todavía no hubo recepción, podés corregir libremente este ítem. Todos los cambios quedan en Auditoría.</div>`}
      <div class="field"><label>Descripción *</label><input id="peiDescription" value="${esc(item.description||'')}"></div>
      <div class="two"><div class="field"><label>Producto del inventario</label><select id="peiProduct">${purchaseItemProductOptions(item)}</select></div><div class="field"><label>Ingresa a stock</label><label class="check-line"><input id="peiStock" type="checkbox" ${item.affects_inventory?'checked':''} ${p.destination_type!=='warehouse'?'disabled':''}> ${p.destination_type==='warehouse'?'Sí, al recibir entra al inventario':'No disponible: el destino no es un depósito'}</label></div></div>
      <div class="two"><div class="field"><label>Cantidad total comprada *</label><input id="peiQty" type="number" min="${received>0?received:0.000001}" step="any" value="${Number(item.quantity||0)}"><div class="hint">Ya recibido: ${fmt(received)} · No puede quedar por debajo de ese valor.</div></div><div class="field"><label>Unidad *</label><select id="peiUnit">${purchaseItemUnitOptions(item.unit)}</select></div></div>
      <div class="two"><div class="field"><label>Conversión a unidad base *</label><input id="peiFactor" type="number" min="0.000001" step="any" value="${Number(item.factor_to_base||1)}"><div class="hint">Ej.: 1 rollo = 15 kg → factor 15.</div></div><div class="field"><label>Precio unitario (${esc(p.currency||'')}) *</label><input id="peiPrice" type="number" min="0" step="any" value="${Number(item.unit_price||0)}"></div></div>
      <div class="field"><label>Notas</label><textarea id="peiNotes" rows="3" placeholder="Motivo del cambio, aclaración del proveedor, etc.">${esc(item.notes||'')}</textarea></div>
      <div id="peiRule" class="hint" style="margin-bottom:8px"></div>
      <div class="modal-actions"><button id="peiCancel" class="btn">Cancelar</button><button id="peiSave" class="btn primary">Guardar corrección</button></div><div id="peiMsg"></div>`);

    const rule=document.querySelector('#peiRule');
    function refreshRule(){
      if(!received){rule.textContent='Se actualizará la misma línea porque todavía no existe una recepción.';return}
      const qty=Number(document.querySelector('#peiQty')?.value||0);
      const material=(document.querySelector('#peiProduct')?.value||null)!==(item.product_id||null)
        ||document.querySelector('#peiUnit')?.value!==item.unit
        ||Number(document.querySelector('#peiFactor')?.value||0)!==Number(item.factor_to_base||0)
        ||Number(document.querySelector('#peiPrice')?.value||0)!==Number(item.unit_price||0)
        ||Boolean(document.querySelector('#peiStock')?.checked)!==Boolean(item.affects_inventory);
      if(material&&qty>received)rule.innerHTML=`<b>Se dividirá automáticamente:</b> ${fmt(received)} queda histórico con los datos anteriores y ${fmt(qty-received)} quedará pendiente con los datos nuevos.`;
      else if(material&&qty<=received)rule.innerHTML='<b>No hay saldo pendiente para aplicar ese cambio.</b> Si la modificación corresponde a unidades adicionales, aumentá primero la cantidad total.';
      else rule.textContent=`Se mantendrá la misma línea. Pendiente resultante: ${fmt(Math.max(0,qty-received))}.`;
    }
    ['peiProduct','peiUnit','peiFactor','peiPrice','peiQty','peiStock'].forEach(id=>document.querySelector('#'+id)?.addEventListener('input',refreshRule));
    refreshRule();
    document.querySelector('#peiCancel').onclick=()=>window.openPurchaseDetail(p.id);
    document.querySelector('#peiSave').onclick=async()=>{
      const btn=document.querySelector('#peiSave'),msgEl=document.querySelector('#peiMsg');
      const description=document.querySelector('#peiDescription').value.trim(),qty=Number(document.querySelector('#peiQty').value),factor=Number(document.querySelector('#peiFactor').value),price=Number(document.querySelector('#peiPrice').value);
      if(!description)return msg(msgEl,'Escribí la descripción del ítem.');
      if(!(qty>0)||qty<received)return msg(msgEl,`La cantidad debe ser igual o mayor a lo ya recibido (${fmt(received)}).`);
      if(!(factor>0))return msg(msgEl,'La conversión debe ser mayor a cero.');
      if(!(price>=0))return msg(msgEl,'El precio no puede ser negativo.');
      const affects=Boolean(document.querySelector('#peiStock').checked);
      const product=document.querySelector('#peiProduct').value||null;
      if(affects&&!product)return msg(msgEl,'Si ingresa a stock, elegí el producto del inventario.');
      btn.disabled=true;btn.textContent='Guardando…';
      const r=await rpc('admin_update_purchase_item',{p_item_id:item.id,p_patch:{description,quantity:qty,product_id:product,unit:document.querySelector('#peiUnit').value,factor_to_base:factor,unit_price:price,affects_inventory:affects,notes:document.querySelector('#peiNotes').value.trim()||null}});
      btn.disabled=false;btn.textContent='Guardar corrección';
      if(r.error)return msg(msgEl,r.error);
      const mode=r.data?.mode;
      msg(msgEl,mode==='split'?'Corrección guardada. El saldo pendiente se separó sin alterar lo ya recibido.':'Ítem actualizado correctamente.',true);
      await loadAll(true);
      setTimeout(()=>window.openPurchaseDetail(p.id),250);
    };
  }

  window.openPurchaseDetail=async function(id){
    await priorOpenPurchaseDetail(id);
    if(profile?.role!=='admin')return;
    const p=(D.purchases||[]).find(x=>x.id===id);if(!p)return;
    const list=findPurchaseItemSection();if(!list)return;
    const items=(D.purchaseItems||[]).filter(x=>x.purchase_id===id);
    [...list.querySelectorAll(':scope > .row')].forEach((row,index)=>{
      const item=items[index];if(!item||row.querySelector('[data-edit-purchase-item]'))return;
      const received=Number(item.received_qty||0),pending=Math.max(0,Number(item.quantity||0)-received);
      const foot=document.createElement('div');foot.className='line';foot.style.marginTop='8px';foot.innerHTML=`<div class="subtext">Precio: <b>${money(Number(item.unit_price||0),p.currency)}</b>${received?` · ${fmt(pending)} pendiente`:''}</div><button class="btn sm soft" data-edit-purchase-item="${item.id}">Editar ítem</button>`;
      row.appendChild(foot);
    });
    list.querySelectorAll('[data-edit-purchase-item]').forEach(b=>b.onclick=e=>{e.stopPropagation();openPurchaseItemEditor(b.dataset.editPurchaseItem)});
  };
})();