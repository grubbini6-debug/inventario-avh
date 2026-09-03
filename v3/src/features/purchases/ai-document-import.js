// AVH — Lectura inteligente de presupuestos/OC/facturas con IA.
// El archivo original va a una Edge Function segura. La IA solo propone; nada se guarda hasta confirmación del administrador.
(function(){
  const AI_EDGE='purchase-document-ai';
  const MAX_BYTES=12*1024*1024;
  const AI_EXT=/\.(pdf|png|jpe?g|webp|xlsx?|xls)$/i;
  const UNIT_ALIASES={
    un:'unidad',und:'unidad',uni:'unidad',u:'unidad',unidad:'unidad',unidades:'unidad',pieza:'pieza',pza:'pieza',pz:'pieza',
    kg:'kg',kgs:'kg',kilogramo:'kg',kilogramos:'kg',ton:'tonelada',tn:'tonelada',tonelada:'tonelada',toneladas:'tonelada',
    rollo:'rollo',rollos:'rollo',bobina:'bobina',bobinas:'bobina',caja:'caja',cajas:'caja',paquete:'paquete',paq:'paquete',
    bolsa:'bolsa',bolsas:'bolsa',m:'metro',mt:'metro',mts:'metro',metro:'metro',metros:'metro',l:'litro',lt:'litro',lts:'litro',
    litro:'litro',litros:'litro',cilindro:'cilindro',cilindros:'cilindro',tambor:'tambor',pallet:'pallet',pallets:'pallet',
    plancha:'plancha',planchas:'plancha',barra:'barra',barras:'barra',tubo:'tubo',tubos:'tubo',perfil:'perfil',perfiles:'perfil',
    bidon:'bidón','bidón':'bidón',servicio:'servicio',viaje:'viaje',hora:'hora',dia:'día','día':'día',otro:'otro'
  };

  const norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const digits=s=>String(s??'').replace(/\D/g,'');
  const escHtml=s=>typeof esc==='function'?esc(String(s??'')):String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
  const unit=v=>UNIT_ALIASES[norm(v).replace(/\s/g,'')]||String(v||'unidad').trim().toLowerCase()||'unidad';
  const moneyText=(v,c)=>typeof money==='function'?money(num(v),c||'PYG'):`${c||''} ${num(v).toLocaleString('es-PY')}`;

  function fileToDataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||''));r.onerror=()=>reject(Error('No pude leer el archivo.'));r.readAsDataURL(file)})}

  function matchByNameOrTax(rows,name,tax){
    const taxDigits=digits(tax);if(taxDigits){const exact=(rows||[]).find(x=>digits(x.tax_id)===taxDigits);if(exact)return exact}
    const n=norm(name);if(!n)return null;
    const candidates=(rows||[]).filter(x=>x.name).map(x=>({x,n:norm(x.name)})).filter(x=>x.n&&((n.includes(x.n)&&x.n.length>=5)||(x.n.includes(n)&&n.length>=5))).sort((a,b)=>b.n.length-a.n.length);
    return candidates[0]?.x||null;
  }

  function matchProduct(item){
    const ps=(D.products||[]).filter(x=>x.active),code=norm(item.product_code||item.barcode||''),desc=norm(item.description||'');
    if(code){const byCode=ps.find(p=>norm(p.code||'')===code);if(byCode)return byCode}
    if(!desc)return null;
    const exact=ps.find(p=>norm(p.name)===desc);if(exact)return exact;
    const contained=ps.map(p=>({p,n:norm(p.name)})).filter(x=>x.n.length>=8&&(desc.includes(x.n)||x.n.includes(desc))).sort((a,b)=>b.n.length-a.n.length);
    return contained[0]?.p||null;
  }

  function productOptions(selected){return `<option value="">No vincular</option>${(D.products||[]).filter(x=>x.active).map(p=>`<option value="${p.id}" ${p.id===selected?'selected':''}>${escHtml(p.name)} · ${escHtml(p.base_unit||'')}</option>`).join('')}`}
  function supplierOptions(selected){return `<option value="">Sin definir</option>${(D.suppliers||[]).map(s=>`<option value="${s.id}" ${s.id===selected?'selected':''}>${escHtml(s.name)}</option>`).join('')}`}
  function companyOptions(selected){return (D.purchaseCompanies||[]).filter(x=>x.active).map(c=>`<option value="${c.id}" ${c.id===selected?'selected':''}>${escHtml(c.name)}</option>`).join('')}
  function unitOptions(selected){const opts=['unidad','pieza','kg','tonelada','rollo','bobina','caja','paquete','bolsa','metro','m²','m³','litro','cilindro','tambor','pallet','plancha','barra','tubo','perfil','bidón','servicio','viaje','hora','día','otro'];return opts.map(x=>`<option value="${escHtml(x)}" ${x===selected?'selected':''}>${escHtml(x)}</option>`).join('')}

  function normalizedDoc(raw){
    const d=raw&&typeof raw==='object'?raw:{};
    d.items=Array.isArray(d.items)?d.items:[];
    d.document_type=['quote','purchase_order','invoice','receipt','other'].includes(d.document_type)?d.document_type:'other';
    d.currency=String(d.currency||'').toUpperCase();if(!['PYG','USD'].includes(d.currency))d.currency='PYG';
    d.items=d.items.filter(x=>x&&String(x.description||'').trim()&&num(x.quantity)>0).map(x=>({...x,description:String(x.description).trim(),quantity:num(x.quantity),unit:unit(x.unit),unit_price:num(x.unit_price),line_total:num(x.line_total),factor_to_base:num(x.factor_to_base)>0?num(x.factor_to_base):null}));
    return d;
  }

  function docLabel(t){return ({quote:'Presupuesto / cotización',purchase_order:'Orden de compra',invoice:'Factura',receipt:'Remito / recepción',other:'Documento de compra'})[t]||'Documento de compra'}

  function renderAiPreview(doc,fileName,meta={}){
    const host=document.querySelector('#pcImportResult');if(!host)return;
    const supplier=matchByNameOrTax(D.suppliers,doc.supplier_name,doc.supplier_tax_id);
    const company=matchByNameOrTax(D.purchaseCompanies,doc.customer_name,doc.customer_tax_id);
    const rows=doc.items.map((item,i)=>{const p=matchProduct(item),factor=item.factor_to_base||1,base=p?.base_unit||item.base_unit||'';const conversionWarning=!!p&&unit(item.unit)!==unit(base)&&!item.factor_to_base;return `<tr data-ai-row="${i}">
      <td><select data-ai-product>${productOptions(p?.id||'')}</select>${conversionWarning?'<div class="hint" style="color:#9a6700">⚠️ Revisar conversión para ingreso a stock</div>':''}</td>
      <td><input data-ai-desc value="${escHtml(item.description)}"></td>
      <td><input data-ai-qty type="number" step="0.001" value="${item.quantity}"></td>
      <td><select data-ai-unit>${unitOptions(unit(item.unit))}</select></td>
      <td><input data-ai-price type="number" step="0.0001" value="${item.unit_price||0}"></td>
      <td><input data-ai-factor type="number" step="0.0001" value="${factor}"></td>
    </tr>`}).join('');
    const conf=Math.round(num(doc.confidence)*100)||0;
    host.innerHTML=`<div class="pc-import-detected good" data-ai-preview="1">
      <div class="line"><div><b>✨ ${escHtml(docLabel(doc.document_type))} detectado con IA</b><div class="hint">${escHtml(fileName)} · confianza ${conf?conf+'%':'sin puntaje'}</div></div><span class="badge green">IA</span></div>
      <div class="pc-import-meta"><span>Proveedor leído: <b>${escHtml(doc.supplier_name||'—')}</b></span><span>Cliente leído: <b>${escHtml(doc.customer_name||'—')}</b></span><span>Total: <b>${moneyText(doc.total,doc.currency)}</b></span>${meta.model?`<span>Modelo: ${escHtml(meta.model)}</span>`:''}</div>
      <div class="pc-import-fields">
        <div class="field"><label>Proveedor AVH</label><select id="pcAiSupplier">${supplierOptions(supplier?.id||'')}</select></div>
        <div class="field"><label>Empresa compradora</label><select id="pcAiCompany">${companyOptions(company?.id||document.querySelector('#pcCompany')?.value||'')}</select></div>
        <div class="field"><label>Tipo de documento</label><select id="pcAiType"><option value="quote" ${doc.document_type==='quote'?'selected':''}>Presupuesto / cotización</option><option value="purchase_order" ${doc.document_type==='purchase_order'?'selected':''}>Orden de compra</option><option value="invoice" ${doc.document_type==='invoice'?'selected':''}>Factura</option><option value="receipt" ${doc.document_type==='receipt'?'selected':''}>Remito / recepción</option><option value="other" ${doc.document_type==='other'?'selected':''}>Otro</option></select></div>
        <div class="field"><label>Número</label><input id="pcAiNumber" value="${escHtml(doc.document_number||'')}"></div>
        <div class="field"><label>Fecha</label><input id="pcAiDate" type="date" value="${escHtml(doc.date||'')}"></div>
        <div class="field"><label>Moneda</label><select id="pcAiCurrency"><option value="PYG" ${doc.currency==='PYG'?'selected':''}>PYG</option><option value="USD" ${doc.currency==='USD'?'selected':''}>USD</option></select></div>
        <div class="field"><label>Condición de pago</label><input id="pcAiTerms" value="${escHtml(doc.payment_terms||'')}"></div>
        <div class="field"><label>Entrega / validez</label><input id="pcAiDelivery" value="${escHtml(doc.delivery_terms||doc.valid_until||'')}"></div>
      </div>
      <div class="pc-import-preview" style="margin-top:10px"><table><thead><tr><th>Producto AVH</th><th>Descripción detectada</th><th>Cant.</th><th>Unidad</th><th>Precio unit.</th><th>Conv. base</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="hint" style="margin-top:8px">Revisá solamente si algo quedó mal. Confirmar agrega todo directo al carrito; no vuelve a Carga múltiple.</div>
      <div class="pc-bulk-actions" style="margin-top:10px"><button type="button" id="pcAiConfirm" class="btn primary">✅ Confirmar e importar ${doc.items.length} ítem${doc.items.length===1?'':'s'}</button><button type="button" id="pcAiUseClassic" class="btn soft">Usar lector clásico</button></div>
      <div id="pcAiMsg"></div>
    </div>`;
    document.querySelector('#pcAiConfirm').onclick=()=>confirmAi(doc);
    document.querySelector('#pcAiUseClassic').onclick=()=>{const file=document.querySelector('#pcImportFile');if(file?.__classicHandler)file.__classicHandler.call(file,{target:file});};
  }

  function applyHeader(doc){
    const val=(id,v,event=false)=>{const el=document.querySelector(id);if(!el||v===null||v===undefined||v==='')return;el.value=v;if(event)el.dispatchEvent(new Event('change',{bubbles:true}))};
    val('#pcSupplier',document.querySelector('#pcAiSupplier')?.value||'');
    val('#pcCompany',document.querySelector('#pcAiCompany')?.value||'');
    val('#pcCurrency',document.querySelector('#pcAiCurrency')?.value||doc.currency,true);
    val('#pcDate',document.querySelector('#pcAiDate')?.value||doc.date);
    val('#pcTerms',document.querySelector('#pcAiTerms')?.value||doc.payment_terms);
    const type=document.querySelector('#pcAiType')?.value||doc.document_type,number=document.querySelector('#pcAiNumber')?.value.trim()||doc.document_number||'';
    if(type==='invoice'){val('#pcInvoice',number);if(doc.purchase_order_number)val('#pcReference',doc.purchase_order_number);val('#pcStatus','ordered')}
    else if(type==='purchase_order'){val('#pcReference',number);val('#pcStatus','ordered')}
    else if(type==='quote'){val('#pcReference',number);val('#pcStatus','quoted')}
    if(doc.delivery_date)val('#pcExpected',doc.delivery_date);
  }

  function pushRow(tr){
    const productId=tr.querySelector('[data-ai-product]')?.value||'',description=tr.querySelector('[data-ai-desc]')?.value.trim()||'',quantity=num(tr.querySelector('[data-ai-qty]')?.value),u=tr.querySelector('[data-ai-unit]')?.value||'unidad',price=num(tr.querySelector('[data-ai-price]')?.value),factor=num(tr.querySelector('[data-ai-factor]')?.value)||1;
    if(!description||quantity<=0||factor<=0)return false;
    const ps=document.querySelector('#pciProduct'),desc=document.querySelector('#pciDesc'),qty=document.querySelector('#pciQty'),unitEl=document.querySelector('#pciUnit'),priceEl=document.querySelector('#pciPrice'),factorEl=document.querySelector('#pciFactor'),stock=document.querySelector('#pciStock'),add=document.querySelector('#pcAddItem');
    if(!desc||!qty||!unitEl||!priceEl||!factorEl||!stock||!add)return false;
    if(ps){ps.value=productId;if(productId)ps.dispatchEvent(new Event('change',{bubbles:true}))}
    desc.value=description;qty.value=String(quantity);if([...unitEl.options].some(o=>o.value===u))unitEl.value=u;else unitEl.value='otro';priceEl.value=String(price);factorEl.value=String(factor);
    const p=(D.products||[]).find(x=>x.id===productId),base=unit(p?.base_unit||'');stock.checked=!!productId&&document.querySelector('#pcDest')?.value==='warehouse'&&(unit(u)===base||factor!==1);
    add.click();return true;
  }

  function confirmAi(doc){
    const rows=[...document.querySelectorAll('#pcImportResult [data-ai-row]')],out=document.querySelector('#pcAiMsg');if(!rows.length)return;
    applyHeader(doc);let ok=0;for(const tr of rows)if(pushRow(tr))ok++;
    if(ok!==rows.length){if(typeof msg==='function')msg(out,`Importé ${ok} de ${rows.length}. Revisá las filas incompletas.`);return}
    const panel=document.querySelector('#pcImportPanel');if(panel)panel.classList.remove('on');const toggle=document.querySelector('#pcImportToggle');if(toggle)toggle.textContent='Importar';
    const cart=document.querySelector('#pcCart');if(cart){const n=document.createElement('div');n.className='hint';n.style.marginTop='8px';n.innerHTML=`✨ <b>${ok} ítem${ok===1?'':'s'} leído${ok===1?'':'s'} con IA e importado${ok===1?'':'s'} automáticamente.</b> Revisá destino/depósito y guardá.`;cart.appendChild(n);cart.scrollIntoView({behavior:'smooth',block:'center'})}
  }

  async function analyzeWithAi(file){
    if(file.size>MAX_BYTES)throw Error('El archivo supera 12 MB. Usá un documento más liviano.');
    const fileData=await fileToDataUrl(file),button=document.querySelector('#pcImportAnalyze'),result=document.querySelector('#pcImportResult');
    if(button){button.disabled=true;button.textContent='✨ Analizando con IA…'}if(result)result.innerHTML='<div class="notice">✨ La IA está leyendo el documento original y separando proveedor, cliente, importes e ítems…</div>';
    const r=await edge(AI_EDGE,{file_name:file.name,mime_type:file.type||'application/octet-stream',file_data:fileData});
    if(button){button.disabled=false;button.textContent='Detectar automáticamente'}
    if(r.error){const e=Error(r.error);e.status=r.status;e.aiNotConfigured=r.status===503;throw e}
    const doc=normalizedDoc(r.data?.document);if(!doc.items.length)throw Error('La IA no encontró ítems comprables en este documento.');
    renderAiPreview(doc,file.name,{model:r.data?.model,usage:r.data?.usage});
  }

  document.addEventListener('change',async e=>{
    const fileInput=e.target?.closest?.('#pcImportFile');if(!fileInput)return;const file=fileInput.files?.[0];if(!file||!AI_EXT.test(file.name))return;
    const classic=fileInput.onchange;if(classic&&!fileInput.__classicHandler)fileInput.__classicHandler=classic;
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
    try{await analyzeWithAi(file)}catch(err){
      const button=document.querySelector('#pcImportAnalyze');if(button){button.disabled=false;button.textContent='Detectar automáticamente'}
      if(err?.aiNotConfigured){const host=document.querySelector('#pcImportResult');if(host)host.innerHTML='<div class="notice">⚠️ La IA todavía no tiene configurada la clave de OpenAI. Por ahora voy a usar el lector clásico.</div>';if(fileInput.__classicHandler)return fileInput.__classicHandler.call(fileInput,{target:fileInput})}
      alert(`No pude analizar con IA: ${err?.message||String(err)}`);
    }
  },true);

  function decorate(){
    const box=document.querySelector('#pcImportBox');if(!box||box.dataset.aiDecorated==='1')return;box.dataset.aiDecorated='1';const title=box.querySelector('b');if(title)title.textContent='✨ Importar documento con IA';const hint=box.querySelector('.hint');if(hint)hint.textContent='Subí presupuesto, OC o factura. AVH usa IA para detectar todo y vos solo confirmás; el lector clásico queda como respaldo.';
  }
  let queued=false;const obs=new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;decorate()})});obs.observe(document.body,{childList:true,subtree:true});decorate();
})();
