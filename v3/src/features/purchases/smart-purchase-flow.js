// AVH — Flujo principal de compra: presupuesto IA -> destino -> OC -> confirmar compra.
(function(){
  const DOC_EDGE='purchase-document-ai';
  const MAX_BYTES=12*1024*1024;
  const UNIT_ALIASES={un:'unidad',und:'unidad',u:'unidad',unidad:'unidad',unidades:'unidad',kg:'kg',kgs:'kg',kilogramo:'kg',kilogramos:'kg',tn:'tonelada',ton:'tonelada',tonelada:'tonelada',rollo:'rollo',rollos:'rollo',bobina:'bobina',bobinas:'bobina',caja:'caja',cajas:'caja',m:'metro',mt:'metro',mts:'metro',metro:'metro',metros:'metro',l:'litro',lt:'litro',lts:'litro',litro:'litro',litros:'litro'};
  const norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const digits=s=>String(s??'').replace(/\D/g,'');
  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
  const unit=v=>UNIT_ALIASES[norm(v).replace(/\s/g,'')]||String(v||'unidad').trim().toLowerCase()||'unidad';
  const safe=s=>typeof esc==='function'?esc(String(s??'')):String(s??'').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
  const dateOnly=v=>{if(!v)return'—';try{return new Date(String(v).slice(0,10)+'T12:00:00').toLocaleDateString('es-PY')}catch{return String(v)}};
  const st=document.createElement('style');
  st.textContent=`
    .smart-buy-drop{border:2px dashed #b8cfc0;border-radius:18px;padding:24px;text-align:center;background:#f8fbf9}.smart-buy-drop.drag{border-color:var(--green);background:#f0f8f3}.smart-buy-drop input{display:none}.smart-buy-main{display:grid;gap:12px}.smart-buy-summary{border:1px solid #dce8df;border-radius:16px;padding:14px;background:#fff}.smart-buy-total{font-size:25px;font-weight:900}.smart-buy-dest{border:2px solid #dbe9df;border-radius:16px;padding:14px;background:#fbfdfb}.smart-buy-items{overflow:auto}.smart-buy-items table{min-width:760px;width:100%;border-collapse:collapse}.smart-buy-items th,.smart-buy-items td{padding:8px;border-bottom:1px solid #e8eeea;text-align:left}.smart-buy-items input,.smart-buy-items select{min-width:95px}.po-sheet{background:#fff;border:1px solid #dce5df;border-radius:16px;padding:22px}.po-head{display:flex;justify-content:space-between;gap:20px;border-bottom:2px solid #183c2c;padding-bottom:14px}.po-title{font-size:27px;font-weight:950}.po-no{font-size:20px;font-weight:900}.po-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:14px 0}.po-box{border:1px solid #e0e8e3;border-radius:12px;padding:11px}.po-box span{display:block;font-size:12px;color:#6b7c72}.po-table{width:100%;border-collapse:collapse;margin-top:14px}.po-table th,.po-table td{padding:9px;border-bottom:1px solid #e2e8e4;text-align:left}.po-table th:nth-child(n+3),.po-table td:nth-child(n+3){text-align:right}.po-total{font-size:22px;font-weight:950;text-align:right;margin-top:14px}.po-status{display:inline-block;padding:6px 10px;border-radius:999px;font-weight:800;background:#fff4d6;color:#815b00}.po-status.ok{background:#e9f7ee;color:#146b35}.smart-buy-warning{color:#8b5a00;font-size:12px;margin-top:4px}.assistant-launch{white-space:nowrap}`;
  document.head.appendChild(st);

  let legacyNewPurchase=null;
  let smartState={file:null,doc:null,meta:null};

  function fileToDataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||''));r.onerror=()=>reject(Error('No pude leer el archivo.'));r.readAsDataURL(file)})}
  function activeCompanies(){return (D.purchaseCompanies||[]).filter(x=>x.active)}
  function matchCompany(doc){const tax=digits(doc?.customer_tax_id);if(tax){const x=activeCompanies().find(c=>digits(c.tax_id)===tax);if(x)return x}const n=norm(doc?.customer_name);if(!n)return null;return activeCompanies().map(c=>({c,n:norm(c.name)})).filter(x=>x.n&&((n.includes(x.n)&&x.n.length>5)||(x.n.includes(n)&&n.length>5))).sort((a,b)=>b.n.length-a.n.length)[0]?.c||null}
  function matchSupplier(doc){const rows=D.suppliers||[],tax=digits(doc?.supplier_tax_id);if(tax){const x=rows.find(s=>digits(s.tax_id)===tax);if(x)return x}const n=norm(doc?.supplier_name);if(!n)return null;return rows.map(s=>({s,n:norm(s.name)})).filter(x=>x.n&&((n.includes(x.n)&&x.n.length>4)||(x.n.includes(n)&&n.length>4))).sort((a,b)=>b.n.length-a.n.length)[0]?.s||null}
  function matchProduct(item){const ps=(D.products||[]).filter(x=>x.active),desc=norm(item?.description),code=norm(item?.product_code||item?.barcode);if(code){const exact=ps.find(p=>norm(p.sku||p.code)===code);if(exact)return exact}if(!desc)return null;const exact=ps.find(p=>norm(p.name)===desc);if(exact)return exact;return ps.map(p=>({p,n:norm(p.name)})).filter(x=>x.n.length>=7&&(desc.includes(x.n)||x.n.includes(desc))).sort((a,b)=>b.n.length-a.n.length)[0]?.p||null}
  function companyOptions(selected){return activeCompanies().map(c=>`<option value="${c.id}" ${c.id===selected?'selected':''}>${safe(c.name)}</option>`).join('')}
  function productOptions(selected){return `<option value="">Sin vincular</option>${(D.products||[]).filter(x=>x.active).map(p=>`<option value="${p.id}" ${p.id===selected?'selected':''}>${safe(p.name)} · ${safe(p.base_unit)}</option>`).join('')}`}
  function warehouseOptions(){return (D.warehouses||[]).filter(x=>x.active).map(w=>`<option value="${w.id}">${safe(w.name)}</option>`).join('')}
  function bargeOptions(){return `<option value="">Elegí barcaza</option>${(D.barges||[]).filter(x=>x.active).sort((a,b)=>Number(a.number)-Number(b.number)).map(b=>`<option value="${b.id}">Barcaza ${b.number}</option>`).join('')}`}

  async function analyzeFile(file){
    if(!file)throw Error('Elegí un presupuesto.');if(file.size>MAX_BYTES)throw Error('El archivo supera 12 MB.');
    const data=await fileToDataUrl(file);
    const r=await edge(DOC_EDGE,{file_name:file.name,mime_type:file.type||'application/octet-stream',file_data:data});
    if(r.error)throw Error(r.error);
    const d=r.data?.document||{};d.items=Array.isArray(d.items)?d.items.filter(x=>String(x?.description||'').trim()&&num(x?.quantity)>0):[];
    if(!d.items.length)throw Error('La IA no encontró ítems comprables.');
    d.currency=['PYG','USD'].includes(String(d.currency||'').toUpperCase())?String(d.currency).toUpperCase():'PYG';
    smartState={file,doc:d,meta:{model:r.data?.model,usage:r.data?.usage}};return d;
  }

  function openSmartPurchase(){
    if(profile?.role!=='admin')return;
    smartState={file:null,doc:null,meta:null};
    openModal('Nueva compra','Presupuesto → destino → OC → confirmar compra',`<div class="smart-buy-main">
      <div id="smartDrop" class="smart-buy-drop"><div style="font-size:32px">✨📄</div><h3>Subí el presupuesto</h3><p class="subtext">PDF, foto o Excel. AVH lee proveedor, empresa, ítems, precios, moneda y condiciones.</p><label class="btn primary" for="smartFile">Elegir presupuesto</label><input id="smartFile" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls"><div id="smartFileName" class="hint" style="margin-top:8px"></div></div>
      <div id="smartMsg"></div><div id="smartResult"></div>
      <div class="line" style="justify-content:space-between"><button id="smartManual" class="btn sm soft">Carga manual / avanzada</button><span class="hint">La IA prepara; vos confirmás.</span></div>
    </div>`);
    const input=$('#smartFile'),drop=$('#smartDrop');
    async function run(file){if(!file)return;$('#smartFileName').textContent=file.name;$('#smartMsg').innerHTML='<div class="notice">✨ Analizando presupuesto…</div>';$('#smartResult').innerHTML='';try{const doc=await analyzeFile(file);$('#smartMsg').innerHTML='';renderDetected(doc)}catch(e){msg($('#smartMsg'),e.message||String(e))}}
    input.onchange=()=>run(input.files?.[0]);
    ['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('drag')}));['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('drag')}));drop.addEventListener('drop',e=>run(e.dataTransfer?.files?.[0]));
    $('#smartManual').onclick=()=>{closeModal();legacyNewPurchase?.()};
  }

  function renderDetected(doc){
    const company=matchCompany(doc),supplier=matchSupplier(doc),conf=Math.round(num(doc.confidence)*100),total=num(doc.total)||doc.items.reduce((a,x)=>a+num(x.quantity)*num(x.unit_price),0);
    const rows=doc.items.map((x,i)=>{const p=matchProduct(x),base=unit(p?.base_unit),u=unit(x.unit),hasFactor=num(x.factor_to_base)>0,warning=p&&u!==base&&!hasFactor;return `<tr data-smart-item="${i}"><td><select data-product>${productOptions(p?.id||'')}</select>${warning?'<div class="smart-buy-warning">⚠ Revisá conversión antes de ingreso a stock</div>':''}</td><td><input data-desc value="${safe(x.description)}"></td><td><input data-qty type="number" step="0.001" value="${num(x.quantity)}"></td><td><input data-unit value="${safe(unit(x.unit))}"></td><td><input data-price type="number" step="0.0001" value="${num(x.unit_price)}"></td><td><input data-factor type="number" step="0.0001" value="${hasFactor?num(x.factor_to_base):1}"></td></tr>`}).join('');
    $('#smartResult').innerHTML=`<div class="smart-buy-summary"><div class="line"><div><div class="title">${safe(doc.supplier_name||'Proveedor detectado')}</div><div class="subtext">${safe(doc.document_number?'Presupuesto '+doc.document_number:'Presupuesto')} · ${safe(doc.payment_terms||'Condición de pago no indicada')} ${conf?`· confianza ${conf}%`:''}</div></div><div class="smart-buy-total">${money(total,doc.currency)}</div></div></div>
      <div class="smart-buy-dest"><div class="title">¿Para dónde va esta compra?</div><div class="two" style="margin-top:8px"><div class="field"><label>Destino *</label><select id="smartDest"><option value="warehouse">Depósito</option><option value="barge">Barcaza / proyecto</option><option value="direct">Entrega directa</option><option value="other">Otro</option></select></div><div class="field" id="smartWhWrap"><label>Depósito</label><select id="smartWh">${warehouseOptions()}</select></div><div class="field hide" id="smartBargeWrap"><label>Barcaza</label><select id="smartBarge">${bargeOptions()}</select></div><div class="field hide" id="smartTextWrap"><label>Lugar / detalle</label><input id="smartDestText" placeholder="Ej.: taller, obra, producción…"></div></div></div>
      <details class="card"><summary><b>Editar datos detectados</b> <span class="hint">solo si algo quedó mal</span></summary><div class="two" style="margin-top:10px"><div class="field"><label>Empresa compradora</label><select id="smartCompany">${companyOptions(company?.id||activeCompanies()[0]?.id||'')}</select>${company?'':'<div class="smart-buy-warning">⚠ No pude identificar la empresa con total seguridad.</div>'}</div><div class="field"><label>Proveedor detectado</label><input id="smartSupplierName" value="${safe(doc.supplier_name||supplier?.name||'')}"></div></div><div class="smart-buy-items"><table><thead><tr><th>Producto AVH</th><th>Descripción</th><th>Cant.</th><th>Unidad</th><th>Precio</th><th>Conv.</th></tr></thead><tbody>${rows}</tbody></table></div></details>
      <div class="line" style="justify-content:flex-end;margin-top:12px"><button id="smartGenerate" class="btn primary">📄 Generar Orden de Compra</button></div><div id="smartGenerateMsg"></div>`;
    const dest=$('#smartDest');function sync(){const d=dest.value;$('#smartWhWrap').classList.toggle('hide',d!=='warehouse');$('#smartBargeWrap').classList.toggle('hide',d!=='barge');$('#smartTextWrap').classList.toggle('hide',!['barge','direct','other'].includes(d))}dest.onchange=sync;sync();
    $('#smartGenerate').onclick=generatePO;
  }

  async function ensureSupplier(doc){
    const existing=matchSupplier(doc);if(existing)return existing.id;
    const name=$('#smartSupplierName')?.value.trim()||String(doc.supplier_name||'').trim();if(!name)return null;
    const r=await insert('suppliers',{name,tax_id:String(doc.supplier_tax_id||'').trim()||null,notes:'Creado desde presupuesto leído con IA',created_by:profile.id},true);
    if(r.error){await loadAll(true);const found=matchSupplier({...doc,supplier_name:name});if(found)return found.id;throw Error(r.error)}
    if(r.data)D.suppliers=[...(D.suppliers||[]),r.data];return r.data?.id||null;
  }

  function collectItems(doc,destination){
    return [...document.querySelectorAll('[data-smart-item]')].map((tr,i)=>{const productId=tr.querySelector('[data-product]')?.value||null,p=(D.products||[]).find(x=>x.id===productId),u=unit(tr.querySelector('[data-unit]')?.value||doc.items[i]?.unit),factor=num(tr.querySelector('[data-factor]')?.value)||1,explicitFactor=num(doc.items[i]?.factor_to_base)>0,canStock=!!productId&&destination==='warehouse'&&(unit(p?.base_unit)===u||explicitFactor);return{product_id:productId,description:tr.querySelector('[data-desc]')?.value.trim()||doc.items[i]?.description||'Ítem',quantity:num(tr.querySelector('[data-qty]')?.value),unit:u,factor_to_base:factor,unit_price:num(tr.querySelector('[data-price]')?.value),affects_inventory:canStock}}).filter(x=>x.description&&x.quantity>0&&x.factor_to_base>0)
  }

  async function uploadQuote(file,purchaseId){
    if(!file)return null;const safeName=file.name.replace(/[^a-zA-Z0-9._-]+/g,'_'),path=`${purchaseId}/${Date.now()}_${safeName}`;
    const r=await request(`/storage/v1/object/purchase-documents/${path}`,{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream','x-upsert':'false'},body:file});if(r.error)throw Error(r.error);
    const ir=await insert('purchase_documents',{purchase_id:purchaseId,kind:'quotation',file_path:path,file_name:file.name,uploaded_by:profile.id});if(ir.error)throw Error(ir.error);return path;
  }

  async function generatePO(){
    const doc=smartState.doc;if(!doc)return;const out=$('#smartGenerateMsg'),btn=$('#smartGenerate'),destination=$('#smartDest').value,companyId=$('#smartCompany').value;
    if(!companyId)return msg(out,'Elegí la empresa compradora.');if(destination==='warehouse'&&!$('#smartWh').value)return msg(out,'Elegí el depósito.');if(destination==='barge'&&!$('#smartBarge').value)return msg(out,'Elegí la barcaza.');
    const items=collectItems(doc,destination);if(!items.length)return msg(out,'No hay ítems válidos para generar la OC.');
    btn.disabled=true;btn.textContent='Generando OC…';
    try{
      const supplierId=await ensureSupplier(doc),data={company_id:companyId,supplier_id:supplierId,purchase_type:destination==='warehouse'?'stock':'direct_consumption',urgency:'normal',destination_type:destination,warehouse_id:destination==='warehouse'?$('#smartWh').value:null,barge_id:destination==='barge'?$('#smartBarge').value:null,destination_text:['barge','direct','other'].includes(destination)?($('#smartDestText').value.trim()||null):null,currency:doc.currency||'PYG',payment_method:doc.payment_method||null,payment_terms:doc.payment_terms||null,order_reference:doc.document_number||null,expected_date:doc.delivery_date||null,source_document_number:doc.document_number||null,source_document_date:doc.date||null,source_document_kind:'quotation'};
      const r=await rpc('admin_create_purchase_from_quote',{p_data:data,p_items:items});if(r.error)throw Error(r.error);
      const result=r.data||{},purchaseId=result.purchase_id||result.id||result;if(!purchaseId)throw Error('La compra se creó pero no recibí su identificador.');
      let uploadWarning='';try{await uploadQuote(smartState.file,purchaseId)}catch(e){uploadWarning='El presupuesto no pudo adjuntarse: '+(e.message||e)}
      await loadAll(true);closeModal();showPurchaseOrder(purchaseId,uploadWarning);
    }catch(e){msg(out,e.message||String(e))}finally{btn.disabled=false;btn.textContent='📄 Generar Orden de Compra'}
  }

  function purchaseById(id){return (D.purchases||[]).find(x=>x.id===id)}
  function itemsByPurchase(id){return (D.purchaseItems||[]).filter(x=>x.purchase_id===id)}
  function companyById(id){return (D.purchaseCompanies||[]).find(x=>x.id===id)}
  function supplierById(id){return (D.suppliers||[]).find(x=>x.id===id)}
  function destLabel(p){if(p.destination_type==='warehouse')return p.warehouse_name||whName(p.warehouse_id);if(p.destination_type==='barge')return p.barge_number?`Barcaza ${p.barge_number}`:`Barcaza ${bargeNo(p.barge_id)}`;return p.destination_text||'Entrega directa'}

  function poHtml(p,items){
    const c=companyById(p.company_id)||{},s=supplierById(p.supplier_id)||{},total=items.reduce((a,x)=>a+num(x.quantity)*num(x.unit_price),0),confirmed=p.status==='ordered'||p.purchase_confirmed_at;
    return `<div class="po-sheet" id="poSheet"><div class="po-head"><div><div class="po-title">ORDEN DE COMPRA</div><div>${safe(c.legal_name||c.name||p.company_name||'')}</div>${c.tax_id?`<div class="subtext">RUC ${safe(c.tax_id)}</div>`:''}</div><div style="text-align:right"><div class="po-no">${safe(p.po_number||'OC')}</div><div>${dateOnly(p.po_generated_at||p.created_at)}</div><span class="po-status ${confirmed?'ok':''}">${confirmed?'COMPRADO / PEDIDO':'PENDIENTE DE COMPRA'}</span></div></div><div class="po-grid"><div class="po-box"><span>PROVEEDOR</span><b>${safe(s.name||p.supplier_name||'—')}</b>${s.tax_id?`<div>RUC ${safe(s.tax_id)}</div>`:''}${s.phone?`<div>${safe(s.phone)}</div>`:''}</div><div class="po-box"><span>DESTINO</span><b>${safe(destLabel(p)||'—')}</b><div>${safe(p.payment_terms||'')}</div></div></div><table class="po-table"><thead><tr><th>Descripción</th><th>Unidad</th><th>Cantidad</th><th>Precio unit.</th><th>Total</th></tr></thead><tbody>${items.map(x=>`<tr><td>${safe(x.description)}</td><td>${safe(x.unit)}</td><td>${fmt(x.quantity)}</td><td>${money(x.unit_price,p.currency)}</td><td>${money(num(x.quantity)*num(x.unit_price),p.currency)}</td></tr>`).join('')}</tbody></table><div class="po-total">TOTAL: ${money(total,p.currency)}</div>${p.order_reference?`<div class="hint" style="margin-top:10px">Presupuesto / referencia: ${safe(p.order_reference)}</div>`:''}${c.address?`<div class="hint">${safe(c.address)}${c.phone?' · '+safe(c.phone):''}${c.email?' · '+safe(c.email):''}</div>`:''}</div>`
  }

  function showPurchaseOrder(id,warning=''){
    const p=purchaseById(id);if(!p)return alert('No encontré la compra.');const items=itemsByPurchase(id),confirmed=p.status==='ordered'||p.purchase_confirmed_at;
    openModal(p.po_number||'Orden de compra',p.supplier_name||supplierById(p.supplier_id)?.name||'Proveedor',`${poHtml(p,items)}${warning?`<div class="notice" style="margin-top:10px">${safe(warning)}</div>`:''}<div class="split-actions" style="margin-top:14px"><button id="poPrint" class="btn soft">🖨 Imprimir / Guardar PDF</button>${confirmed?'':`<button id="poConfirm" class="btn primary">✅ Confirmar que se compró</button>`}<button id="poOpenDetail" class="btn soft">Ver compra</button></div><div id="poMsg"></div>`);
    $('#poPrint').onclick=()=>printPurchaseOrder(id);$('#poOpenDetail').onclick=()=>window.openPurchaseDetail?.(id);if($('#poConfirm'))$('#poConfirm').onclick=()=>confirmPurchase(id);
  }

  function printPurchaseOrder(id){
    const p=purchaseById(id),items=itemsByPurchase(id);if(!p)return;const tab=window.open('','_blank');if(!tab)return alert('El navegador bloqueó la ventana de impresión.');
    tab.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${safe(p.po_number||'Orden de compra')}</title><style>body{font-family:Arial,sans-serif;color:#17231d;padding:28px}.po-head{display:flex;justify-content:space-between;border-bottom:2px solid #183c2c;padding-bottom:14px}.po-title{font-size:25px;font-weight:900}.po-no{font-size:19px;font-weight:900}.po-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:14px 0}.po-box{border:1px solid #ccc;padding:10px}.po-box span{display:block;font-size:11px;color:#666}.po-table{width:100%;border-collapse:collapse}.po-table th,.po-table td{padding:8px;border-bottom:1px solid #ddd;text-align:left}.po-table th:nth-child(n+3),.po-table td:nth-child(n+3){text-align:right}.po-total{text-align:right;font-size:20px;font-weight:900;margin-top:14px}.po-status{display:inline-block;margin-top:8px;font-weight:700}.subtext,.hint{font-size:12px;color:#666}</style></head><body>${poHtml(p,items)}</body></html>`);tab.document.close();tab.focus();setTimeout(()=>tab.print(),250);
  }

  async function confirmPurchase(id){
    const out=$('#poMsg'),b=$('#poConfirm');if(b){b.disabled=true;b.textContent='Confirmando…'}const r=await rpc('admin_confirm_purchase',{p_purchase_id:id});if(r.error){if(b){b.disabled=false;b.textContent='✅ Confirmar que se compró'}return msg(out,r.error)}await loadAll(true);showPurchaseOrder(id);
  }

  function enhancePurchaseList(){
    const button=$('#newPurchase');if(button){if(button.onclick&&button.onclick!==openSmartPurchase)legacyNewPurchase=button.onclick;button.onclick=openSmartPurchase;button.textContent='+ Nueva compra con IA'}
    const head=document.querySelector('#page-purchases .section-head .split-actions');if(head&&!head.querySelector('#purchaseAssistant')){const b=document.createElement('button');b.id='purchaseAssistant';b.className='btn sm soft assistant-launch';b.textContent='✨ Asistente IA';b.onclick=()=>window.openAVHPurchaseAssistant?.();head.prepend(b)}
    $$('[data-purchase]').forEach(row=>{const id=row.dataset.purchase,p=purchaseById(id);if(!p?.po_number||row.querySelector('[data-open-po]'))return;const btn=document.createElement('button');btn.className='btn sm soft';btn.dataset.openPo=id;btn.textContent=p.po_number;btn.onclick=e=>{e.preventDefault();e.stopPropagation();showPurchaseOrder(id)};row.querySelector('.line')?.appendChild(btn)})
  }

  const oldRender=window.renderPurchases;window.renderPurchases=function(){const r=oldRender?.apply(this,arguments);enhancePurchaseList();return r};
  const oldDetail=window.openPurchaseDetail;window.openPurchaseDetail=async function(id){await oldDetail?.apply(this,arguments);const p=purchaseById(id),body=$('#modalBody');if(!p?.po_number||!body)return;const bar=document.createElement('div');bar.className='split-actions';bar.style.marginTop='12px';bar.innerHTML=`<button id="detailOpenPo" class="btn soft">📄 ${safe(p.po_number)}</button>${p.status==='approved'?'<button id="detailConfirmBuy" class="btn primary">✅ Confirmar comprado</button>':''}`;body.prepend(bar);$('#detailOpenPo').onclick=()=>showPurchaseOrder(id);if($('#detailConfirmBuy'))$('#detailConfirmBuy').onclick=()=>confirmPurchase(id)};
  window.AVHSmartPurchase={open:openSmartPurchase,showPurchaseOrder,printPurchaseOrder};
})();
