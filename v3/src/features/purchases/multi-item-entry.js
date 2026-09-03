// AVH — Dos modos de carga de ítems en Compras: simple + múltiple.
// La carga múltiple reutiliza el mismo carrito y validaciones del formulario existente.
(function(){
  const UNITS=['unidad','pieza','kg','tonelada','rollo','bobina','caja','paquete','bolsa','metro','m²','m³','litro','cilindro','tambor','pallet','plancha','barra','tubo','perfil','bidón','servicio','viaje','hora','día','otro'];

  const css=document.createElement('style');
  css.textContent=`
    .pc-mode-tabs{display:flex;gap:7px;margin:10px 0 8px;padding:4px;background:#eef4ef;border-radius:12px}
    .pc-mode-tabs button{flex:1;border:0;border-radius:9px;padding:9px 10px;background:transparent;font-weight:800;cursor:pointer}
    .pc-mode-tabs button.on{background:#fff;box-shadow:0 1px 5px rgba(0,0,0,.08)}
    .pc-bulk{display:none;background:#fbfdfb}
    .pc-bulk.on{display:block}
    .pc-bulk-row{border:1px solid #dfe9e2;border-radius:12px;padding:10px;margin-bottom:8px;background:#fff}
    .pc-bulk-main{display:grid;grid-template-columns:minmax(180px,1.6fr) minmax(150px,1.4fr) 90px 120px 120px;gap:7px;align-items:end}
    .pc-bulk-extra{display:grid;grid-template-columns:120px 1fr auto;gap:8px;align-items:center;margin-top:8px}
    .pc-bulk-row .field{margin:0}.pc-bulk-row label{font-size:11px}
    .pc-bulk-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}
    .pc-bulk-summary{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:8px;padding:9px 10px;border-radius:10px;background:#eef4ef;font-size:12px}
    @media(max-width:900px){.pc-bulk-main{grid-template-columns:1fr 1fr}.pc-bulk-extra{grid-template-columns:1fr}.pc-bulk-main .field:nth-child(1),.pc-bulk-main .field:nth-child(2){grid-column:span 2}}
  `;
  document.head.appendChild(css);

  const activeProducts=()=> (D.products||[]).filter(x=>x.active);
  const pById=id=>activeProducts().find(x=>x.id===id);
  const unitOptions=selected=>UNITS.map(u=>`<option value="${esc(u)}" ${u===selected?'selected':''}>${esc(u)}</option>`).join('');
  const productOptions=()=>`<option value="">Compra libre / no vincular</option>${activeProducts().map(p=>`<option value="${p.id}">${esc(p.name)} · ${esc(p.base_unit)}</option>`).join('')}`;

  function rowTemplate(){
    return `<div class="pc-bulk-row">
      <div class="pc-bulk-main">
        <div class="field"><label>Producto del inventario</label><select data-bulk-product>${productOptions()}</select></div>
        <div class="field"><label>Descripción *</label><input data-bulk-desc placeholder="Qué estás comprando"></div>
        <div class="field"><label>Cantidad</label><input data-bulk-qty type="number" min="0" step="0.001"></div>
        <div class="field"><label>Unidad</label><select data-bulk-unit>${unitOptions('unidad')}</select></div>
        <div class="field"><label>Precio unitario</label><input data-bulk-price type="number" min="0" step="0.0001"></div>
      </div>
      <div class="pc-bulk-extra">
        <div class="field"><label>Conversión a base</label><input data-bulk-factor type="number" min="0.0001" step="0.0001" value="1"></div>
        <label class="line" style="justify-content:flex-start"><input data-bulk-stock type="checkbox" style="width:18px;height:18px"> <b>Ingresar a inventario al recibir</b></label>
        <div class="split-actions"><button type="button" class="btn sm soft" data-bulk-history title="Historial de precios">📈</button><button type="button" class="btn sm soft" data-bulk-remove>Quitar</button></div>
      </div>
    </div>`;
  }

  function enhance(){
    const simpleProduct=document.querySelector('#pciProduct');
    const addItem=document.querySelector('#pcAddItem');
    const cart=document.querySelector('#pcCart');
    if(!simpleProduct||!addItem||!cart||document.querySelector('#pcEntryModes'))return;
    const simpleCard=simpleProduct.closest('.card');
    if(!simpleCard)return;

    const tabs=document.createElement('div');
    tabs.id='pcEntryModes';
    tabs.className='pc-mode-tabs';
    tabs.innerHTML='<button type="button" id="pcModeSimple" class="on">Carga simple</button><button type="button" id="pcModeBulk">Carga múltiple</button>';
    simpleCard.insertAdjacentElement('beforebegin',tabs);

    const bulk=document.createElement('div');
    bulk.id='pcBulkPanel';
    bulk.className='card pc-bulk';
    bulk.innerHTML=`<div class="line"><div><b>Carga rápida de varios ítems</b><div class="hint">Completá varias filas y agregalas juntas al mismo carrito de la compra.</div></div></div><div id="pcBulkRows"></div><div class="pc-bulk-summary"><span id="pcBulkCount">0 filas completas</span><b id="pcBulkTotal">Subtotal: 0</b></div><div class="pc-bulk-actions"><button type="button" id="pcBulkAddRow" class="btn sm soft">+ Agregar fila</button><button type="button" id="pcBulkAddAll" class="btn sm primary">Agregar todos al carrito</button></div><div id="pcBulkMsg"></div>`;
    simpleCard.insertAdjacentElement('afterend',bulk);

    const rowsHost=bulk.querySelector('#pcBulkRows');
    const currency=()=>document.querySelector('#pcCurrency')?.value||'PYG';
    const moneyFmt=v=>typeof money==='function'?money(v,currency()):`${currency()} ${Number(v||0).toLocaleString('es-PY')}`;

    function setMode(mode){
      const multi=mode==='bulk';
      simpleCard.style.display=multi?'none':'';
      bulk.classList.toggle('on',multi);
      tabs.querySelector('#pcModeSimple').classList.toggle('on',!multi);
      tabs.querySelector('#pcModeBulk').classList.toggle('on',multi);
    }

    function bindRow(row){
      const ps=row.querySelector('[data-bulk-product]'),desc=row.querySelector('[data-bulk-desc]'),unit=row.querySelector('[data-bulk-unit]'),factor=row.querySelector('[data-bulk-factor]'),stock=row.querySelector('[data-bulk-stock]');
      ps.onchange=()=>{const p=pById(ps.value);if(p){desc.value=p.name;unit.value=UNITS.includes(p.base_unit)?p.base_unit:'otro';factor.value='1';stock.checked=document.querySelector('#pcDest')?.value==='warehouse'}drawSummary()};
      row.querySelector('[data-bulk-remove]').onclick=()=>{row.remove();if(!rowsHost.children.length)addRow();drawSummary()};
      row.querySelector('[data-bulk-history]').onclick=()=>{if(!ps.value)return alert('Elegí un producto del inventario para ver su historial.');if(typeof window.openPriceAnalysis==='function')window.openPriceAnalysis(ps.value)};
      row.querySelectorAll('input,select').forEach(el=>{el.addEventListener('input',drawSummary);el.addEventListener('change',drawSummary)});
    }

    function addRow(prefill=null){
      rowsHost.insertAdjacentHTML('beforeend',rowTemplate());
      const row=rowsHost.lastElementChild;bindRow(row);
      if(prefill){
        const ps=row.querySelector('[data-bulk-product]');ps.value=prefill.product_id||'';ps.dispatchEvent(new Event('change'));
        if(prefill.description)row.querySelector('[data-bulk-desc]').value=prefill.description;
        if(prefill.quantity!=null)row.querySelector('[data-bulk-qty]').value=prefill.quantity;
        if(prefill.unit)row.querySelector('[data-bulk-unit]').value=prefill.unit;
        if(prefill.unit_price!=null)row.querySelector('[data-bulk-price]').value=prefill.unit_price;
      }
      drawSummary();
      return row;
    }

    function rowData(row){
      return {
        product_id:row.querySelector('[data-bulk-product]').value||null,
        description:row.querySelector('[data-bulk-desc]').value.trim(),
        quantity:Number(row.querySelector('[data-bulk-qty]').value||0),
        unit:row.querySelector('[data-bulk-unit]').value,
        unit_price:Number(row.querySelector('[data-bulk-price]').value||0),
        factor_to_base:Number(row.querySelector('[data-bulk-factor]').value||1),
        affects_inventory:row.querySelector('[data-bulk-stock]').checked
      };
    }

    function meaningful(x){return !!(x.product_id||x.description||x.quantity||x.unit_price)}
    function drawSummary(){
      const rows=[...rowsHost.querySelectorAll('.pc-bulk-row')].map(rowData).filter(meaningful);
      const complete=rows.filter(x=>x.description&&x.quantity>0);
      bulk.querySelector('#pcBulkCount').textContent=`${complete.length} fila${complete.length===1?'':'s'} lista${complete.length===1?'':'s'}`;
      bulk.querySelector('#pcBulkTotal').textContent=`Subtotal: ${moneyFmt(complete.reduce((a,x)=>a+x.quantity*x.unit_price,0))}`;
    }

    function validateRows(rows){
      if(!rows.length)return 'Completá al menos una fila.';
      for(let i=0;i<rows.length;i++){
        const x=rows[i],n=i+1;
        if(!x.description)return `Fila ${n}: escribí la descripción.`;
        if(!x.quantity||x.quantity<=0)return `Fila ${n}: la cantidad debe ser mayor a cero.`;
        if(!x.factor_to_base||x.factor_to_base<=0)return `Fila ${n}: la conversión debe ser mayor a cero.`;
        if(x.affects_inventory&&!x.product_id)return `Fila ${n}: para ingresar a stock vinculá un producto del inventario.`;
      }
      return null;
    }

    function pushThroughSimple(x){
      const ps=document.querySelector('#pciProduct'),desc=document.querySelector('#pciDesc'),qty=document.querySelector('#pciQty'),unit=document.querySelector('#pciUnit'),price=document.querySelector('#pciPrice'),factor=document.querySelector('#pciFactor'),stock=document.querySelector('#pciStock');
      ps.value=x.product_id||'';
      if(x.product_id)ps.dispatchEvent(new Event('change',{bubbles:true}));
      desc.value=x.description;qty.value=String(x.quantity);unit.value=x.unit;price.value=String(x.unit_price);factor.value=String(x.factor_to_base);stock.checked=!!x.affects_inventory;
      addItem.click();
    }

    tabs.querySelector('#pcModeSimple').onclick=()=>setMode('simple');
    tabs.querySelector('#pcModeBulk').onclick=()=>setMode('bulk');
    bulk.querySelector('#pcBulkAddRow').onclick=()=>addRow();
    bulk.querySelector('#pcBulkAddAll').onclick=()=>{
      const data=[...rowsHost.querySelectorAll('.pc-bulk-row')].map(rowData).filter(meaningful);
      const error=validateRows(data),msgEl=bulk.querySelector('#pcBulkMsg');
      if(error){if(typeof msg==='function')return msg(msgEl,error);return alert(error)}
      data.forEach(pushThroughSimple);
      rowsHost.innerHTML='';for(let i=0;i<4;i++)addRow();
      if(typeof msg==='function')msg(msgEl,`${data.length} ítem${data.length===1?'':'s'} agregado${data.length===1?'':'s'} al carrito.`);
      cart.scrollIntoView({behavior:'smooth',block:'nearest'});
    };

    document.querySelector('#pcCurrency')?.addEventListener('change',drawSummary);
    document.querySelector('#pcDest')?.addEventListener('change',()=>{
      if(document.querySelector('#pcDest')?.value!=='warehouse')rowsHost.querySelectorAll('[data-bulk-stock]').forEach(x=>x.checked=false);
      drawSummary();
    });

    for(let i=0;i<4;i++)addRow();
    setMode('simple');
  }

  let queued=false;
  const observer=new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;enhance()})});
  observer.observe(document.body,{childList:true,subtree:true});
  enhance();
})();
