// AVH — Flujo principal: presupuesto IA -> productos AVH -> OC PDF -> confirmar compra.
(function(){
  const DOC_EDGE='purchase-document-ai';
  const MAX_BYTES=12*1024*1024;
  const UNIT_ALIASES={un:'unidad',und:'unidad',u:'unidad',unidad:'unidad',unidades:'unidad',pieza:'pieza',piezas:'pieza',kg:'kg',kgs:'kg',kilogramo:'kg',kilogramos:'kg',tn:'tonelada',ton:'tonelada',tonelada:'tonelada',toneladas:'tonelada',rollo:'rollo',rollos:'rollo',bobina:'bobina',bobinas:'bobina',caja:'caja',cajas:'caja',paquete:'paquete',paquetes:'paquete',bolsa:'bolsa',bolsas:'bolsa',m:'metro',mt:'metro',mts:'metro',metro:'metro',metros:'metro',m2:'m²','m²':'m²',m3:'m³','m³':'m³',l:'litro',lt:'litro',lts:'litro',litro:'litro',litros:'litro',cilindro:'cilindro',cilindros:'cilindro',tambor:'tambor',tambores:'tambor',pallet:'pallet',pallets:'pallet',plancha:'plancha',planchas:'plancha',barra:'barra',barras:'barra',tubo:'tubo',tubos:'tubo',perfil:'perfil',perfiles:'perfil',bidon:'bidón','bidón':'bidón',bidones:'bidón',servicio:'servicio',servicios:'servicio',viaje:'viaje',viajes:'viaje',h:'hora',hs:'hora',hr:'hora',hrs:'hora',hour:'hora',hours:'hora',hora:'hora',horas:'hora',dia:'día','día':'día',dias:'día','días':'día',otro:'otro'};
  const norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const digits=s=>String(s??'').replace(/\D/g,'');
  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
  const unit=v=>UNIT_ALIASES[norm(v).replace(/\s/g,'')]||String(v||'unidad').trim().toLowerCase()||'unidad';
  const safe=s=>typeof esc==='function'?esc(String(s??'')):String(s??'').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
  const dateOnly=v=>{if(!v)return'—';try{return new Date(String(v).slice(0,10)+'T12:00:00').toLocaleDateString('es-PY')}catch{return String(v)}};
  const st=document.createElement('style');
  st.textContent=`
    .smart-buy-drop{border:2px dashed #b8cfc0;border-radius:18px;padding:24px;text-align:center;background:#f8fbf9}.smart-buy-drop.drag{border-color:var(--green);background:#f0f8f3}.smart-buy-drop input{display:none}.smart-buy-main{display:grid;gap:12px}.smart-buy-summary{border:1px solid #dce8df;border-radius:16px;padding:14px;background:#fff}.smart-buy-total{font-size:25px;font-weight:900}.smart-buy-dest{border:2px solid #dbe9df;border-radius:16px;padding:14px;background:#fbfdfb}.smart-buy-items{overflow:auto}.smart-buy-items table{min-width:760px;width:100%;border-collapse:collapse}.smart-buy-items th,.smart-buy-items td{padding:8px;border-bottom:1px solid #e8eeea;text-align:left}.smart-buy-items input,.smart-buy-items select{min-width:95px}.auto-product{font-size:11px;color:#24603f;font-weight:750;margin-top:4px}.po-sheet{background:#fff;border:1px solid #dce5df;border-radius:16px;padding:22px;color:#17231d}.po-head{display:flex;justify-content:space-between;gap:18px;border-bottom:2px solid #183c2c;padding-bottom:14px}.po-brand{display:flex;align-items:center;gap:12px}.po-brandmark{display:grid;place-items:center;width:78px;height:44px;background:#184f37;color:#fff;border-radius:7px;font-size:22px;font-weight:950;letter-spacing:.04em}.po-brandtext b{display:block;color:#184f37;font-size:14px}.po-brandtext small{display:block;margin-top:3px;line-height:1.35}.po-title{font-size:25px;font-weight:950}.po-no{font-size:18px;font-weight:900;color:#184f37}.po-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:14px 0}.po-box{border:1px solid #e0e8e3;border-radius:12px;padding:11px;line-height:1.45}.po-box span{display:block;font-size:11px;color:#6b7c72;font-weight:700}.po-table{width:100%;border-collapse:collapse;margin-top:14px}.po-table th,.po-table td{padding:9px;border-bottom:1px solid #e2e8e4;text-align:left}.po-table th:nth-child(n+3),.po-table td:nth-child(n+3){text-align:right}.po-total{font-size:22px;font-weight:950;text-align:right;margin-top:14px}.po-status{display:inline-block;padding:6px 10px;border-radius:999px;font-weight:800;background:#fff4d6;color:#815b00}.po-status.ok{background:#e9f7ee;color:#146b35}.smart-buy-warning{color:#8b5a00;font-size:12px;margin-top:4px}.assistant-launch{white-space:nowrap}@media(max-width:700px){.po-head{flex-direction:column}.po-grid{grid-template-columns:1fr}}`;
  document.head.appendChild(st);

  let legacyNewPurchase=null;
  let smartState={file:null,doc:null,meta:null};

  function fileToDataUrl(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||''));r.onerror=()=>reject(Error('No pude leer el archivo.'));r.readAsDataURL(file)})}
  function activeCompanies(){return (D.purchaseCompanies||[]).filter(x=>x.active)}
  function matchCompany(doc){const tax=digits(doc?.customer_tax_id);if(tax){const x=activeCompanies().find(c=>digits(c.tax_id)===tax);return x||null}const n=norm(doc?.customer_name);if(!n)return null;return activeCompanies().map(c=>({c,n:norm(c.name)})).filter(x=>x.n&&((n.includes(x.n)&&x.n.length>5)||(x.n.includes(n)&&n.length>5))).sort((a,b)=>b.n.length-a.n.length)[0]?.c||null}
  function matchSupplier(doc){const rows=D.suppliers||[],tax=digits(doc?.supplier_tax_id);if(tax){const x=rows.find(s=>digits(s.tax_id)===tax);return x||null}const n=norm(doc?.supplier_name);if(!n)return null;return rows.map(s=>({s,n:norm(s.name)})).filter(x=>x.n&&((n.includes(x.n)&&x.n.length>4)||(x.n.includes(n)&&n.length>4))).sort((a,b)=>b.n.length-a.n.length)[0]?.s||null}
  function productMatches(item){return window.AVHReceiving.matches(item,D.products||[],D.presentations||[])}
  function matchProduct(item){const matches=productMatches(item);return matches.length===1?matches[0]:null}
  function companyOptions(selected){return `<option value="">Elegí la empresa compradora</option>`+activeCompanies().map(c=>`<option value="${c.id}" ${c.id===selected?'selected':''}>${safe(c.name)}</option>`).join('')}
  function productOptions(selected){return `<option value="__auto__" ${selected?'':'selected'}>✨ Vincular / crear automáticamente</option>${(D.products||[]).filter(x=>x.active).map(p=>`<option value="${p.id}" ${p.id===selected?'selected':''}>${safe(p.name)} · ${safe(p.base_unit)}</option>`).join('')}`}
  function warehouseOptions(){return (D.warehouses||[]).filter(x=>x.active).map(w=>`<option value="${w.id}">${safe(w.name)}</option>`).join('')}
  function bargeOptions(){return `<option value="">Elegí barcaza</option>${(D.barges||[]).filter(x=>x.active).sort((a,b)=>Number(a.number)-Number(b.number)).map(b=>`<option value="${b.id}">Barcaza ${b.number}</option>`).join('')}`}

  async function analyzeFile(file){
    if(!file)throw Error('Elegí un presupuesto.');if(file.size>MAX_BYTES)throw Error('El archivo supera 12 MB.');
    const data=await fileToDataUrl(file);
    const context={
      suppliers:(D.suppliers||[]).filter(x=>x.active!==false).slice(0,120).map(x=>({name:x.name,tax_id:x.tax_id||null})),
      buyer_companies:activeCompanies().slice(0,20).map(x=>({name:x.name,legal_name:x.legal_name||null,tax_id:x.tax_id||null})),
      product_catalog:(D.products||[]).filter(x=>x.active).slice(0,250).map(x=>({sku:x.sku||x.code||null,name:x.name,base_unit:x.base_unit||null}))
    };
    const r=await edge(DOC_EDGE,{file_name:file.name,mime_type:file.type||'application/octet-stream',file_data:data,context});
    if(r.error)throw Error(r.error);
    const d=r.data?.document||{};d.items=Array.isArray(d.items)?d.items.filter(x=>String(x?.description||'').trim()):[];
    if(!d.items.length)throw Error('La IA no encontró ítems comprables.');
    d.currency=['PYG','USD'].includes(String(d.currency||'').toUpperCase())?String(d.currency).toUpperCase():'';
    smartState={file,doc:d,meta:{model:r.data?.model,usage:r.data?.usage,reviewed:!!r.data?.reviewed,review_signals:r.data?.review_signals||[],review_error:r.data?.review_error||null}};return d;
  }

  function openSmartPurchase(){
    if(profile?.role!=='admin')return;
    smartState={file:null,doc:null,meta:null};
    openModal('Nueva compra','Presupuesto → productos AVH → OC PDF → confirmar compra',`<div class="smart-buy-main">
      <div id="smartDrop" class="smart-buy-drop"><div style="font-size:32px">✨📄</div><h3>Subí el presupuesto</h3><p class="subtext">PDF, foto o Excel. AVH lee proveedor, empresa, ítems, precios, moneda y condiciones.</p><label class="btn primary" for="smartFile">Elegir presupuesto</label><input id="smartFile" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.xlsx,.xls"><div id="smartFileName" class="hint" style="margin-top:8px"></div></div>
      <div id="smartMsg"></div><div id="smartResult"></div>
      <div class="line" style="justify-content:space-between"><button id="smartManual" class="btn sm soft">Carga manual / avanzada</button><span class="hint">Si un producto no existe, AVH lo crea al generar la compra.</span></div>
    </div>`);
    const input=$('#smartFile'),drop=$('#smartDrop');
    async function run(file){if(!file)return;$('#smartFileName').textContent=file.name;$('#smartMsg').innerHTML='<div class="notice">✨ Analizando presupuesto…</div>';$('#smartResult').innerHTML='';try{const doc=await analyzeFile(file);$('#smartMsg').innerHTML='';renderDetected(doc)}catch(e){msg($('#smartMsg'),e.message||String(e))}}
    input.onchange=()=>run(input.files?.[0]);
    ['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('drag')}));['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('drag')}));drop.addEventListener('drop',e=>run(e.dataTransfer?.files?.[0]));
    $('#smartManual').onclick=()=>{closeModal();legacyNewPurchase?.()};
  }

  function renderDetected(doc){
    const company=matchCompany(doc),supplier=matchSupplier(doc),conf=Math.round(num(doc.confidence)*100),total=num(doc.total)||doc.items.reduce((a,x)=>a+num(x.quantity)*num(x.unit_price),0);
    const rows=doc.items.map((x,i)=>{const p=matchProduct(x),f=p?window.AVHReceiving.factor(x,p,D.presentations||[]):1;return `<tr data-smart-item="${i}"><td><select data-product>${productOptions(p?.id||'')}</select><div data-smart-stock-preview class="hint"></div></td><td><input data-desc value="${safe(x.description)}"><div class="two" style="margin-top:6px"><input data-brand aria-label="Marca del ítem ${i+1}" placeholder="Marca" value="${safe(x.brand||'')}"><input data-model aria-label="Código de fabricante del ítem ${i+1}" placeholder="Código de fabricante" value="${safe(x.manufacturer_code||'')}"></div></td><td><input data-qty type="number" step="any" value="${x.quantity==null?'':num(x.quantity)}"></td><td><input data-unit value="${safe(x.unit?unit(x.unit):'')}"></td><td><input data-price type="number" step="any" value="${x.unit_price==null?'':num(x.unit_price)}"></td><td><input data-factor type="number" step="any" min="0.000001" value="${f??''}"></td></tr>`}).join('');
    $('#smartResult').innerHTML=`<div class="smart-buy-summary"><div class="line"><div><div class="title">${safe(doc.supplier_name||'Proveedor detectado')}</div><div class="subtext">${safe(doc.document_number?'Presupuesto '+doc.document_number:'Presupuesto')} · ${safe(doc.payment_terms||'Condición de pago no indicada')} ${conf?`· confianza ${conf}%`:''}</div></div><div class="smart-buy-total">${doc.currency&&doc.total!=null?money(total,doc.currency):'Total / moneda por confirmar'}</div></div></div>
      ${(doc.validation?.issues||window.AVHReceiving.documentIssues(doc)).length?`<div class="notice"><b>Revisar contra el original</b><ul>${(doc.validation?.issues||window.AVHReceiving.documentIssues(doc)).map(x=>`<li>${safe(x)}</li>`).join('')}</ul></div>`:''}
      <div class="smart-buy-dest"><div class="title">¿Para dónde va esta compra?</div><div class="two" style="margin-top:8px"><div class="field"><label>Destino *</label><select id="smartDest"><option value="warehouse">Depósito</option><option value="barge">Barcaza / proyecto</option><option value="direct">Entrega directa</option><option value="service">Servicio</option><option value="other">Otro</option></select></div><div class="field" id="smartWhWrap"><label>Depósito</label><select id="smartWh">${warehouseOptions()}</select></div><div class="field hide" id="smartBargeWrap"><label>Barcaza</label><select id="smartBarge">${bargeOptions()}</select></div><div class="field hide" id="smartTextWrap"><label>Lugar / detalle</label><input id="smartDestText" placeholder="Ej.: taller, obra, producción…"><div class="field"><label>Modalidad de entrega</label><select id="smartDeliveryMode"><option value="single" selected>Entrega única</option><option value="partial">Entregas parciales / liberaciones</option></select></div></div></div></div>
      <details class="card" ${!doc.currency?'open':''}><summary><b>Editar datos detectados</b> <span class="hint">solo si algo quedó mal</span></summary><div class="two" style="margin-top:10px"><div class="field"><label>Fecha del documento</label><input id="smartSourceDate" type="date" value="${safe(doc.date||'')}"></div><div class="field"><label>Entrega prevista</label><input id="smartExpectedDate" type="date" value="${safe(doc.delivery_date||'')}"></div><div class="field"><label>Moneda *</label><select id="smartCurrency"><option value="">Elegí moneda</option><option value="PYG" ${doc.currency==='PYG'?'selected':''}>PYG</option><option value="USD" ${doc.currency==='USD'?'selected':''}>USD</option></select></div><div class="field"><label>Empresa compradora</label><select id="smartCompany">${companyOptions(company?.id||'')}</select>${company?'':'<div class="smart-buy-warning">⚠ No pude identificar la empresa con total seguridad.</div>'}</div><div class="field"><label>Proveedor detectado</label><input id="smartSupplierName" value="${safe(doc.supplier_name||supplier?.name||'')}"></div></div><div class="smart-buy-items"><table><thead><tr><th>Producto AVH</th><th>Descripción</th><th>Cant.</th><th>Unidad</th><th>Precio</th><th>Conv.</th></tr></thead><tbody>${rows}</tbody></table></div></details>
      <div class="line" style="justify-content:flex-end;margin-top:12px"><button id="smartGenerate" class="btn primary">📄 Generar Orden de Compra</button></div><div id="smartGenerateMsg"></div>`;
    const dest=$('#smartDest'),itemDraws=[];function sync(){const d=dest.value;$('#smartWhWrap').classList.toggle('hide',d!=='warehouse');$('#smartBargeWrap').classList.toggle('hide',d!=='barge');$('#smartTextWrap').classList.toggle('hide',!['barge','direct','service','other'].includes(d));itemDraws.forEach(draw=>draw());}dest.onchange=sync;sync();
    document.querySelectorAll('[data-smart-item]').forEach(tr=>{
      const original=doc.items[Number(tr.dataset.smartItem)],preview=tr.querySelector('[data-smart-stock-preview]');
      const current=()=>({unit:tr.querySelector('[data-unit]').value,quantity:tr.querySelector('[data-qty]').value,factor_to_base:tr.querySelector('[data-factor]').value,base_unit:original.base_unit});
      const selected=()=>D.products.find(p=>p.id===tr.querySelector('[data-product]').value);
      function draw(){const p=selected(),value=current();if(dest.value!=='warehouse'){preview.className='hint';preview.textContent=dest.value==='service'?'Servicio: sin ingreso a stock.':'Sin ingreso a stock.';return;}if(!p){const ambiguous=productMatches(original).length>1;preview.className=ambiguous?'smart-buy-warning':'hint';preview.textContent=ambiguous?'Hay varias fichas parecidas. Elegí el producto correcto para evitar duplicarlo.':'Producto nuevo: el stock se contará en la unidad de compra.';return;}const error=window.AVHReceiving.stockProblem(value,p),q=window.AVHReceiving.quantity(value,p,D.presentations||[]);preview.className=error?'smart-buy-warning':'auto-product';preview.textContent=error||`Stock: ${fmt(q?.quantity||0)} ${p.base_unit}${q?.package_kg?` · ${fmt(q.package_kg)} kg por unidad · ${fmt(q.kg)} kg en total`:''}`;}
      function sync(){const p=selected(),f=p?window.AVHReceiving.factor({...original,unit:current().unit},p,D.presentations||[]):1;tr.querySelector('[data-factor]').value=f??'';draw();}
      tr.querySelector('[data-product]').onchange=sync;tr.querySelector('[data-unit]').onchange=sync;
      ['[data-qty]','[data-factor]'].forEach(selector=>tr.querySelector(selector).oninput=draw);itemDraws.push(draw);draw();
    });
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
    return [...document.querySelectorAll('[data-smart-item]')].map((tr,i)=>{
      const original=doc.items[i],raw=tr.querySelector('[data-product]')?.value||'__auto__',productId=raw==='__auto__'?null:raw;
      if(!productId&&productMatches(original).length>1)throw Error(`Ítem ${i+1}: elegí cuál de las fichas existentes corresponde al material.`);
      const item={brand:tr.querySelector('[data-brand]')?.value.trim()||null,manufacturer_code:tr.querySelector('[data-model]')?.value.trim()||null,product_id:productId,product_code:original?.product_code||null,barcode:original?.barcode||null,description:tr.querySelector('[data-desc]')?.value.trim()||original?.description||'Ítem',quantity:num(tr.querySelector('[data-qty]')?.value),unit:tr.querySelector('[data-unit]')?.value.trim()?unit(tr.querySelector('[data-unit]').value):'',factor_to_base:num(tr.querySelector('[data-factor]')?.value),unit_price:window.AVHReceiving.number(tr.querySelector('[data-price]')?.value),base_unit:original?.base_unit||null,presentation:original?.presentation||null,affects_inventory:destination==='warehouse'};
      if(!item.unit)throw Error(`Ítem ${i+1}: falta la unidad de compra.`);
      if(!(item.quantity>0)||!(item.factor_to_base>0)||item.unit_price===null||item.unit_price<0)throw Error(`Ítem ${i+1}: revisá cantidad, precio y conversión.`);
      const p=D.products.find(p=>p.id===productId),identity=p&&window.AVHProductIdentity.conflicts(item,p,D.products);if(identity?.length)throw Error(`Ítem ${i+1}: ${identity.join(' ')}`);
      const error=p&&destination==='warehouse'?window.AVHReceiving.stockProblem(item,p):null;if(error)throw Error(`Ítem ${i+1}: ${error}`);
      return item;
    });
  }

  async function uploadQuote(file,purchaseId){
    if(!file)return null;const safeName=file.name.replace(/[^a-zA-Z0-9._-]+/g,'_'),path=`${purchaseId}/${Date.now()}_${safeName}`;
    const r=await request(`/storage/v1/object/purchase-documents/${path}`,{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream','x-upsert':'false'},body:file});if(r.error)throw Error(r.error);
    const doc=smartState.doc||{},ir=await insert('purchase_documents',{purchase_id:purchaseId,kind:'quotation',file_path:path,file_name:file.name,document_number:doc.document_number||null,document_date:doc.date||null,analysis_status:'ok',analysis_data:doc,analysis_model:smartState.meta?.model||null,analysis_confidence:num(doc.confidence)||null,analyzed_at:new Date().toISOString(),uploaded_by:profile.id});if(ir.error)throw Error(ir.error);return path;
  }

  async function generatePurchaseOrderPdf(id){
    if(profile?.role!=='admin')throw Error('Solo Administración puede generar órdenes de compra.');
    return window.AVHCommercial.editPurchaseOrder(id);
  }

  async function generatePO(){
    const doc=smartState.doc;if(!doc)return;const out=$('#smartGenerateMsg'),btn=$('#smartGenerate'),destination=$('#smartDest').value,companyId=$('#smartCompany').value;
    if(!['PYG','USD'].includes($('#smartCurrency')?.value))return msg(out,'Elegí la moneda leída del documento antes de generar la compra.');
    if(!companyId)return msg(out,'Elegí la empresa compradora.');if(destination==='warehouse'&&!$('#smartWh').value)return msg(out,'Elegí el depósito.');if(destination==='barge'&&!$('#smartBarge').value)return msg(out,'Elegí la barcaza.');
    let items;try{items=collectItems(doc,destination)}catch(e){return msg(out,e.message||String(e))}if(!items.length)return msg(out,'No hay ítems válidos para generar la OC.');
    btn.disabled=true;btn.textContent='Generando compra y OC…';
    try{
      const supplierId=await ensureSupplier(doc),data={company_id:companyId,supplier_id:supplierId,purchase_type:destination==='warehouse'?'stock':destination==='service'?'service':'direct_consumption',urgency:'normal',destination_type:destination,warehouse_id:destination==='warehouse'?$('#smartWh').value:null,barge_id:destination==='barge'?$('#smartBarge').value:null,destination_text:['barge','direct','service','other'].includes(destination)?($('#smartDestText').value.trim()||null):null,currency:$('#smartCurrency').value,payment_method:doc.payment_method||null,payment_terms:doc.payment_terms||null,delivery_mode:$('#smartDeliveryMode')?.value||'single',order_reference:doc.document_number||null,expected_date:$('#smartExpectedDate').value||null,source_document_number:doc.document_number||null,source_document_date:$('#smartSourceDate').value||null,source_document_kind:'quotation'};
      const r=await rpc('admin_create_purchase_from_quote',{p_data:data,p_items:items});if(r.error)throw Error(r.error);
      const result=r.data||{},purchaseId=result.purchase_id||result.id||result;if(!purchaseId)throw Error('La compra se creó pero no recibí su identificador.');
      const warnings=[];try{await uploadQuote(smartState.file,purchaseId)}catch(e){warnings.push('Presupuesto: '+(e.message||e))}
      await loadAll(true);closeModal();showPurchaseOrder(purchaseId,warnings.join(' · '));
    }catch(e){msg(out,e.message||String(e))}finally{btn.disabled=false;btn.textContent='📄 Generar Orden de Compra'}
  }

  function purchaseById(id){return (D.purchases||[]).find(x=>x.id===id)}
  function itemsByPurchase(id){return (D.purchaseItems||[]).filter(x=>x.purchase_id===id)}
  function companyById(id){return (D.purchaseCompanies||[]).find(x=>x.id===id)}
  function supplierById(id){return (D.suppliers||[]).find(x=>x.id===id)}
  function productById(id){return (D.products||[]).find(x=>x.id===id)}
  function destLabel(p){if(p.destination_type==='warehouse')return p.warehouse_name||whName(p.warehouse_id);if(p.destination_type==='barge')return p.barge_number?`Barcaza ${p.barge_number}`:`Barcaza ${bargeNo(p.barge_id)}`;return p.destination_text||(p.destination_type==='service'?'Servicio':'Entrega directa')}

  function poHtml(p,items){
    const c=companyById(p.company_id)||{},s=supplierById(p.supplier_id)||{},total=items.reduce((a,x)=>a+num(x.quantity)*num(x.unit_price),0),confirmed=p.status==='ordered'||p.purchase_confirmed_at,brand=norm(c.name).includes('maqmoveis')?'MM':'AVH';
    return `<div class="po-sheet" id="poSheet"><div class="po-head"><div class="po-brand"><div class="po-brandmark">${brand}</div><div class="po-brandtext"><b>${safe(c.legal_name||c.name||p.company_name||'')}</b><small>${c.tax_id?'RUC '+safe(c.tax_id)+' · ':''}${safe(c.address||'')}${c.phone?' · '+safe(c.phone):''}</small></div></div><div style="text-align:right"><div class="po-title">ORDEN DE COMPRA</div><div class="po-no">${safe(p.po_number||'OC')}</div><div>${dateOnly(p.po_generated_at||p.created_at)}</div></div></div><div class="po-grid"><div class="po-box"><span>PROVEEDOR</span><b>${safe(s.name||p.supplier_name||'—')}</b>${s.tax_id?`<div>RUC ${safe(s.tax_id)}</div>`:''}${s.phone?`<div>${safe(s.phone)}</div>`:''}</div><div class="po-box"><span>ENTREGA / CONDICIONES</span><b>${safe(destLabel(p)||'—')}</b><div>${safe(p.payment_terms||'Según presupuesto')}</div><div>${p.delivery_mode==='partial'?'Entregas parciales / liberaciones':'Entrega única'}</div>${p.expected_date?`<div>Entrega: ${dateOnly(p.expected_date)}</div>`:''}</div></div><table class="po-table"><thead><tr><th>Código</th><th>Descripción técnica</th><th>Unidad</th><th>Cantidad</th><th>Precio unit.</th><th>Total</th></tr></thead><tbody>${items.map(x=>{const pr=productById(x.product_id)||{};return`<tr><td>${safe(pr.sku||'—')}</td><td>${safe(x.description)}</td><td>${safe(x.unit)}</td><td>${fmt(x.quantity)}</td><td>${money(x.unit_price,p.currency)}</td><td>${money(num(x.quantity)*num(x.unit_price),p.currency)}</td></tr>`}).join('')}</tbody></table><div class="po-total">TOTAL OC: ${money(total,p.currency)}</div>${p.order_reference?`<div class="hint" style="margin-top:10px">Presupuesto / referencia: ${safe(p.order_reference)}</div>`:''}<div class="hint">Responsable de Compras: Gabriel Ortega${c.email?' · '+safe(c.email):''}</div></div>`
  }

  function showPurchaseOrder(id,warning=''){
    const p=purchaseById(id);if(!p)return alert('No encontré la compra.');const items=itemsByPurchase(id),confirmed=p.status==='ordered'||p.purchase_confirmed_at;
    openModal(p.po_number||'Orden de compra',p.supplier_name||supplierById(p.supplier_id)?.name||'Proveedor',`${poHtml(p,items)}${warning?`<div class="notice" style="margin-top:10px">${safe(warning)}</div>`:''}<div style="margin-top:10px"><span class="po-status ${confirmed?'ok':''}">${confirmed?'COMPRADO / PEDIDO':'OC GENERADA · PENDIENTE DE CONFIRMAR COMPRA'}</span></div><div class="split-actions" style="margin-top:14px"><button id="poDownload" class="btn primary">Revisar y descargar PDF</button>${confirmed?'':`<button id="poConfirm" class="btn soft">✅ Confirmar que se compró</button>`}<button id="poOpenDetail" class="btn soft">Ver expediente</button></div><div id="poMsg"></div>`);
    $('#poDownload').onclick=async()=>{const b=$('#poDownload');b.disabled=true;b.textContent='Generando PDF…';try{await generatePurchaseOrderPdf(id,true);msg($('#poMsg'),'OC descargada y guardada dentro de la compra.',true);await loadAll(true)}catch(e){msg($('#poMsg'),e.message||String(e))}finally{b.disabled=false;b.textContent='Revisar y descargar PDF'}};
    $('#poOpenDetail').onclick=()=>window.openPurchaseDetail?.(id);if($('#poConfirm'))$('#poConfirm').onclick=()=>confirmPurchase(id);
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
  const oldDetail=window.openPurchaseDetail;window.openPurchaseDetail=async function(id){await oldDetail?.apply(this,arguments);const p=purchaseById(id),body=$('#modalBody');if(!p?.po_number||!body)return;const bar=document.createElement('div');bar.className='split-actions';bar.style.marginTop='12px';bar.innerHTML=`<button id="detailOpenPo" class="btn soft">📄 ${safe(p.po_number)}</button><button id="detailDownloadPo" class="btn soft">Revisar OC / PDF</button>${p.status==='approved'?'<button id="detailConfirmBuy" class="btn primary">✅ Confirmar comprado</button>':''}`;body.prepend(bar);$('#detailOpenPo').onclick=()=>showPurchaseOrder(id);$('#detailDownloadPo').onclick=async()=>{try{await generatePurchaseOrderPdf(id,true);await loadAll(true)}catch(e){alert(e.message||String(e))}};if($('#detailConfirmBuy'))$('#detailConfirmBuy').onclick=()=>confirmPurchase(id)};
  window.AVHSmartPurchase={open:openSmartPurchase,showPurchaseOrder,downloadPurchaseOrderPdf:(id)=>generatePurchaseOrderPdf(id,true)};
})();
