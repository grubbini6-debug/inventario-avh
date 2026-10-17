// Depositor edits use a scoped server context; no stock table is written by the browser.
(function(){
  let view=0;
  const units=['unidad','pieza','kg','tonelada','rollo','bobina','caja','paquete','bolsa','metro','m²','m³','litro','cilindro','tambor','pallet','plancha','barra','tubo','perfil','bidón','servicio','viaje','hora','día','otro'];
  const allowed=()=>profile?.role==='depositor'&&!!profile.warehouse_id;
  const canEdit=m=>allowed()&&m.created_by===profile.id&&m.warehouse_to_id===profile.warehouse_id&&m.status==='confirmed'&&['initial','entry','return'].includes(m.type);
  const current=token=>$('#ownLoadEditor')?.dataset.view===String(token)&&!$('#modal')?.classList.contains('hide');
  const show=(token,title,html)=>openModal(title,whName(profile.warehouse_id),`<div id="ownLoadEditor" data-view="${token}">${html}</div>`);
  function failure(token,message,id){
    if(!current(token))return;
    msg($('#ownLoadMsg'),message);
    if(id&&!$('#ownLoadRequest')){
      const b=document.createElement('button');b.type='button';b.id='ownLoadRequest';b.className='btn soft';b.textContent='Solicitar corrección a Administración';b.onclick=()=>requestCorrection(id);$('#ownLoadEditor').appendChild(b);
    }
  }
  function choicesFor(id,source){
    const p=product(id),choices=[];
    const add=x=>{if(!choices.some(y=>y.unit===x.unit&&y.label===x.label&&y.factor===x.factor))choices.push(x)};
    if(source.product_id===id)add({label:source.presentation_label||source.unit,unit:source.unit,factor:Number(source.factor_to_base),presentation_label:source.presentation_label});
    add({label:p?.base_unit||'unidad',unit:p?.base_unit||'unidad',factor:1,presentation_label:null});
    (D.presentations||[]).filter(x=>x.product_id===id).forEach(x=>add({label:x.label,unit:x.unit,factor:Number(x.factor_to_base),presentation_label:x.label}));
    units.forEach(unit=>{if(!choices.some(x=>x.unit===unit&&x.label===unit))add({label:unit,unit,factor:unit===p?.base_unit?1:null,presentation_label:null})});
    return choices;
  }
  async function open(id){
    if(!allowed())return;
    const token=++view;
    show(token,'Editar mi carga','<div class="empty">Consultando la carga original…</div><div id="ownLoadMsg" role="status"></div>');
    const r=await rpc('inventory_load_edit_context',{p_movement_id:id});
    if(!current(token))return;
    if(r.error)return failure(token,r.error,id);
    const context=r.data;
    if(!context?.lines?.length)return failure(token,'No se encontró el detalle de esta carga.',id);
    show(token,`Editar mi carga #${context.movement_no}`,`
      <p class="subtext">Corregí lo que ingresaste. Al guardar se actualiza el stock y queda un historial de los cambios.</p>
      <div class="list">${context.lines.map((line,i)=>`<div class="row" data-own-load-line="${i}">
        <div class="subtext">Antes: ${esc(line.product_name)} · ${fmt(line.quantity)} ${esc(line.presentation_label||line.unit)} = ${fmt(Number(line.quantity)*Number(line.factor_to_base))} ${esc(line.base_unit)}</div>
        ${line.conversion_locked?'<p class="subtext">Esta carga ya está valorizada. Podés corregir la cantidad y el lote; Administración revisa cambios de producto o unidad.</p>':''}
        <div class="field"><label for="ownLoadProduct${i}">Producto</label><select id="ownLoadProduct${i}" data-own-product ${line.conversion_locked?'disabled':''}>${(D.products||[]).filter(p=>p.active||p.id===line.product_id).map(p=>`<option value="${esc(p.id)}" ${p.id===line.product_id?'selected':''}>${esc(p.name)} · ${esc(p.base_unit)}</option>`).join('')}</select></div>
        <div class="two"><div class="field"><label for="ownLoadQuantity${i}">Cantidad</label><input id="ownLoadQuantity${i}" data-own-quantity type="number" inputmode="decimal" min="0.000001" step="any" value="${esc(line.quantity)}"></div><div class="field"><label for="ownLoadUnit${i}">Unidad / presentación</label><select id="ownLoadUnit${i}" data-own-unit ${line.conversion_locked?'disabled':''}></select></div></div>
        <div class="field"><label for="ownLoadFactor${i}" data-own-factor-label>Equivalencia</label><input id="ownLoadFactor${i}" data-own-factor type="number" inputmode="decimal" min="0.000001" step="any"></div>
        <div class="hint" data-own-preview aria-live="polite"></div>
        <div class="field"><label for="ownLoadLot${i}">Lote / referencia</label><input id="ownLoadLot${i}" data-own-lot maxlength="200" value="${esc(line.lot_reference||'')}"></div>
      </div>`).join('')}</div>
      <div class="field"><label for="ownLoadNotes">Observación de la carga</label><textarea id="ownLoadNotes" rows="2" maxlength="2000">${esc(context.notes||'')}</textarea></div>
      <div class="field"><label for="ownLoadReason">Motivo de la corrección</label><textarea id="ownLoadReason" rows="2" maxlength="1000" placeholder="Ej.: puse kg y correspondía caja, o ingresé mal la cantidad"></textarea></div>
      <div id="ownLoadMsg" role="status" aria-live="polite"></div>
      <div class="split-actions"><button type="button" class="btn soft" id="ownLoadCancel">Cancelar</button><button type="button" class="btn primary" id="ownLoadSave">Guardar cambios y actualizar stock</button></div>`);
    const editors=[];
    document.querySelectorAll('[data-own-load-line]').forEach(row=>{
      const source=context.lines[Number(row.dataset.ownLoadLine)],p=row.querySelector('[data-own-product]'),q=row.querySelector('[data-own-quantity]'),u=row.querySelector('[data-own-unit]'),f=row.querySelector('[data-own-factor]');let choices=[];
      const preview=()=>{
        const base=product(p.value)?.base_unit||source.base_unit,choice=choices[Number(u.value)],factor=Number(f.value),qty=Number(q.value);
        row.querySelector('[data-own-factor-label]').textContent=`1 ${choice?.unit||'presentación'} equivale a cuántos ${base}`;
        row.querySelector('[data-own-preview]').textContent=Number.isFinite(qty)&&qty>0&&Number.isFinite(factor)&&factor>0?`Cantidad corregida: ${fmt(qty*factor)} ${base}.`:'Completá la cantidad y su equivalencia para revisar el stock corregido.';
      };
      const changeUnit=()=>{const choice=choices[Number(u.value)],base=product(p.value)?.base_unit||source.base_unit;f.value=choice.unit===base?'1':choice.factor??'';f.readOnly=!!source.conversion_locked||choice.unit===base;preview()};
      const changeProduct=()=>{choices=choicesFor(p.value,source);u.innerHTML=choices.map((x,j)=>`<option value="${j}">${esc(x.label)}${x.factor!=null&&x.factor!==1?` · 1 = ${fmt(x.factor)} ${esc(product(p.value)?.base_unit||source.base_unit)}`:''}</option>`).join('');changeUnit()};
      p.onchange=changeProduct;u.onchange=changeUnit;q.oninput=preview;f.oninput=preview;changeProduct();
      editors.push(()=>{
        const choice=choices[Number(u.value)],qty=Number(q.value),factor=Number(f.value);
        if(!p.value||!choice||!Number.isFinite(qty)||qty<=0||!Number.isFinite(factor)||factor<=0)throw Error('Revisá el producto, la cantidad y la equivalencia de cada ítem.');
        return{line_id:source.line_id,product_id:p.value,quantity:qty,unit:choice.unit,factor_to_base:factor,presentation_label:factor===choice.factor?choice.presentation_label:null,lot_reference:row.querySelector('[data-own-lot]').value.trim()||null};
      });
    });
    $('#ownLoadCancel').onclick=closeModal;
    const button=$('#ownLoadSave');let pending=false;
    button.onclick=async()=>{
      if(pending||!allowed())return;
      const motive=$('#ownLoadReason').value.trim();if(motive.length<3){msg($('#ownLoadMsg'),'Escribí el motivo de la corrección.');$('#ownLoadReason').focus();return}
      let items;try{items=editors.map(read=>read())}catch(e){return msg($('#ownLoadMsg'),e.message)}
      const args={p_movement_id:id,p_expected_version:context.version,p_items:items,p_notes:$('#ownLoadNotes').value.trim()||null,p_reason:motive};
      const controls=[...$('#ownLoadEditor').querySelectorAll('input,select,textarea,button')].map(el=>[el,el.disabled]);
      pending=true;controls.forEach(([el])=>{el.disabled=true});button.textContent='Guardando cambios…';
      const result=await rpc('edit_inventory_load',args);
      if(result.error){pending=false;controls.forEach(([el,disabled])=>{el.disabled=disabled});button.textContent='Guardar cambios y actualizar stock';return failure(token,result.error,id)}
      let refreshed=true;try{await loadAll(true)}catch{refreshed=false}
      if(!current(token))return;
      show(token,'Carga corregida',`<div class="success">Los cambios quedaron guardados y el stock se actualizó.</div>${refreshed?'':'<p class="subtext">Recargá la página para consultar las cantidades actualizadas.</p>'}${result.data?.price_review_required?'<p class="subtext">El cambio de producto o unidad dejó la valoración pendiente para Administración.</p>':''}<div class="split-actions" style="margin-top:12px"><button type="button" class="btn primary" id="ownLoadDone">Cerrar</button><button type="button" class="btn soft" id="ownLoadContinue">Ver mis cargas</button></div>`);
      $('#ownLoadDone').onclick=()=>{closeModal();renderHome()};$('#ownLoadContinue').onclick=()=>list();
    };
  }
  async function list(productId=null){
    if(!allowed())return;
    const token=++view;
    show(token,'Mis cargas de inventario','<div class="empty">Buscando tus cargas…</div><div id="ownLoadMsg" role="status"></div>');
    const select='id,movement_no,type,status,created_by,warehouse_to_id,created_at,movement_lines(product_id,quantity,unit,presentation_label,products(name))'+(productId?',matched_lines:movement_lines!inner(product_id)':'');
    const filter=`created_by=eq.${profile.id}&warehouse_to_id=eq.${profile.warehouse_id}&status=eq.confirmed&type=in.(initial,entry,return)${productId?`&matched_lines.product_id=eq.${encodeURIComponent(productId)}`:''}&order=created_at.desc,id.desc`;
    const r=await queryAll('movements',select,filter);if(!current(token))return;if(r.error)return failure(token,r.error);
    show(token,'Mis cargas de inventario',`<p class="subtext">Elegí la carga que querés corregir${productId?' de '+esc(product(productId)?.name||'este producto'):''}.</p><div class="list">${(r.data||[]).map(m=>`<div class="row"><div class="title">${esc(TYPE_LABEL[m.type]||m.type)} #${esc(m.movement_no)}</div><div class="subtext">${(m.movement_lines||[]).map(l=>`${fmt(l.quantity)} ${esc(l.presentation_label||l.unit)} ${esc(l.products?.name||'Producto')}`).join(' · ')}<br>${esc(dt(m.created_at))}</div><button type="button" class="btn sm primary" data-open-own-load="${esc(m.id)}" style="margin-top:8px">Editar carga</button></div>`).join('')||'<div class="empty">No tenés cargas para editar en este inventario.</div>'}</div><div id="ownLoadMsg" role="status"></div>`);
    document.querySelectorAll('[data-open-own-load]').forEach(b=>b.onclick=()=>open(b.dataset.openOwnLoad));
  }
  const previousStock=window.renderStock;
  window.renderStock=function(){
    const r=previousStock.apply(this,arguments);
    if(allowed())$$('#stockList [data-stock]').forEach(row=>{
      const [warehouseId,productId]=row.dataset.stock.split('|');if(warehouseId!==profile.warehouse_id)return;
      const b=document.createElement('button');b.type='button';b.className='btn sm soft';b.textContent='Editar mis cargas';b.dataset.editOwnStock=productId;b.style.marginTop='10px';b.onclick=e=>{e.stopPropagation();list(productId)};row.appendChild(b);
    });return r;
  };
  window.AVHInventoryEditor={open,list,canEdit};
})();
