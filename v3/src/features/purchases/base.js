// AVH V5: módulo de Compras + recepción de depósito + Excel de compras.
(function(){
  D.purchaseCompanies=D.purchaseCompanies||[];
  D.purchases=D.purchases||[];
  D.purchaseItems=D.purchaseItems||[];
  D.purchaseReceipts=D.purchaseReceipts||[];
  D.purchaseDocuments=D.purchaseDocuments||[];

  const PURCHASE_STATUS={draft:'Borrador',requested:'Solicitado',quoted:'Cotizando',approved:'Aprobado',ordered:'Comprado / pedido',in_transit:'En camino',partially_received:'Recibido parcial',received:'Recibido total',invoiced:'Facturado',closed:'Cerrado',cancelled:'Cancelado'};
  const PURCHASE_TYPE={stock:'Stock',direct_consumption:'Consumo directo',service:'Servicio',spare_part:'Repuesto',rental:'Alquiler',freight:'Flete',urgent:'Compra urgente',other:'Otro'};
  const DEST_LABEL={warehouse:'Depósito',barge:'Barcaza / proyecto',direct:'Entrega directa',service:'Servicio',other:'Otro'};
  const URGENCY_LABEL={normal:'Normal',urgent:'Urgente',critical:'Crítico'};
  const PURCHASE_UNITS=['unidad','pieza','kg','tonelada','rollo','bobina','caja','paquete','bolsa','metro','m²','m³','litro','cilindro','tambor','pallet','plancha','barra','tubo','perfil','bidón','servicio','viaje','hora','día','otro'];
  let activePurchaseRecordId=null;

  const st=document.createElement('style');
  st.textContent=`.purchase-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.purchase-row{border-left:4px solid #dfe9e2}.purchase-row.urgent{border-left-color:var(--amber)}.purchase-row.critical{border-left-color:var(--red)}.purchase-item-line{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:start}.purchase-money{font-size:17px;font-weight:900}.purchase-progress{height:7px;border-radius:99px;background:#e8efea;overflow:hidden;margin-top:7px}.purchase-progress i{display:block;height:100%;background:var(--green);border-radius:99px}.purchase-form-actions{display:flex;gap:7px;flex-wrap:wrap}.receive-grid{display:grid;grid-template-columns:1fr 120px;gap:8px;align-items:end}.purchase-doc{display:flex;align-items:center;justify-content:space-between;gap:10px}.purchase-destination-fields{display:grid;gap:0}@media(min-width:760px){.purchase-kpis{grid-template-columns:repeat(4,minmax(0,1fr))}.receive-grid{grid-template-columns:1fr 160px}}`;
  document.head.appendChild(st);

  function supplierName(id){return D.suppliers?.find(x=>x.id===id)?.name||''}
  function companyName(id){return D.purchaseCompanies?.find(x=>x.id===id)?.name||''}
  function purchaseItems(id){return (D.purchaseItems||[]).filter(x=>x.purchase_id===id)}
  function purchaseReceipts(id){return (D.purchaseReceipts||[]).filter(x=>x.purchase_id===id).sort((a,b)=>new Date(b.received_at)-new Date(a.received_at))}
  function purchaseDocs(id){return (D.purchaseDocuments||[]).filter(x=>x.purchase_id===id).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))}
  function dateOnly(v){if(!v)return'';try{return new Date(v+'T12:00:00').toLocaleDateString('es-PY')}catch{return v}}
  function purchaseTotal(p){return Number(p.total_amount||purchaseItems(p.id).reduce((a,x)=>a+Number(x.quantity||0)*Number(x.unit_price||0),0))}
  function pendingPurchase(p){return p.destination_type==='warehouse'&&['ordered','in_transit','partially_received'].includes(p.status)}
  function statusBadge(s){const cls=s==='cancelled'?'red':s==='partially_received'||s==='in_transit'?'amber':s==='received'||s==='closed'?'green':'';return `<span class="badge ${cls}">${esc(PURCHASE_STATUS[s]||s)}</span>`}
  function purchaseDest(p){if(p.destination_type==='warehouse')return p.warehouse_name||whName(p.warehouse_id)||'Depósito';if(p.destination_type==='barge')return p.barge_number?`Barcaza ${p.barge_number}`:(p.barge_id?`Barcaza ${bargeNo(p.barge_id)}`:'Barcaza');return p.destination_text||DEST_LABEL[p.destination_type]||'Directo'}

  async function loadPurchaseData(){
    if(!profile)return;
    const [c,p,i,r,d]=await Promise.all([
      query('purchase_companies','*','order=name.asc'),
      query('v_purchase_overview','*','order=created_at.desc'),
      query('purchase_items','*','order=created_at.asc'),
      query('purchase_receipts','*','order=received_at.desc'),
      query('purchase_documents','*','order=created_at.desc')
    ]);
    D.purchaseCompanies=c.data||[];D.purchases=p.data||[];D.purchaseItems=i.data||[];D.purchaseReceipts=r.data||[];D.purchaseDocuments=d.data||[];
  }

  function ensurePurchasePage(){
    let page=document.querySelector('#page-purchases');
    if(!page){page=document.createElement('section');page.id='page-purchases';page.className='page';document.querySelector('#page-moves')?.after(page)}
    const nav=document.querySelector('.nav');
    let btn=nav?.querySelector('[data-page="purchases"]');
    if(profile?.role==='admin'){
      if(!btn){btn=document.createElement('button');btn.dataset.page='purchases';btn.innerHTML='<b>🛒</b>Compras';const more=nav.querySelector('[data-page="more"]');nav.insertBefore(btn,more);btn.onclick=()=>{goPage('purchases');renderPurchases()}}
      btn.style.display='';nav.style.gridTemplateColumns='repeat(6,1fr)';
    }else{
      if(btn)btn.style.display='none';if(nav)nav.style.gridTemplateColumns='repeat(5,1fr)';
    }
    const grid=document.querySelector('#page-more .more-grid');
    let rc=grid?.querySelector('#purchaseReceiptsModule');
    if(profile?.role==='depositor'){
      if(!rc){rc=document.createElement('button');rc.id='purchaseReceiptsModule';rc.className='card more-card';rc.innerHTML='<span>📦</span><strong>Recepciones de compras</strong><small>Confirmar lo que llegó al depósito</small>';grid?.prepend(rc)}
      rc.style.display='';rc.onclick=()=>{activeModule='purchase-receipts';renderPurchaseReceipts()};
    }else if(rc)rc.style.display='none';
  }

  const previousLoadAllPurchases=window.loadAll;
  window.loadAll=async function(force=false){
    await previousLoadAllPurchases(force);
    if(!profile)return;
    await loadPurchaseData();ensurePurchasePage();
    if(document.querySelector('#page-purchases')?.classList.contains('on')&&profile.role==='admin'){
      if(activePurchaseRecordId&&(D.purchases||[]).some(x=>x.id===activePurchaseRecordId))window.openPurchaseDetail(activePurchaseRecordId);
      else renderPurchases();
    }
    if(activeModule==='purchase-receipts'&&profile.role==='depositor')renderPurchaseReceipts();
  };

  window.renderPurchases=function(){
    if(profile?.role!=='admin')return;
    activePurchaseRecordId=null;
    ensurePurchasePage();
    const page=$('#page-purchases'),rows=D.purchases||[];
    const month=new Date().toISOString().slice(0,7);
    const thisMonth=rows.filter(x=>(x.ordered_date||x.created_at||'').slice(0,7)===month&&x.status!=='cancelled');
    const pyg=thisMonth.filter(x=>x.currency==='PYG').reduce((a,x)=>a+purchaseTotal(x),0),usd=thisMonth.filter(x=>x.currency==='USD').reduce((a,x)=>a+purchaseTotal(x),0);
    const open=rows.filter(x=>!['closed','cancelled'].includes(x.status)).length,pending=rows.filter(pendingPurchase).length,urgent=rows.filter(x=>['urgent','critical'].includes(x.urgency)&&!['closed','cancelled'].includes(x.status)).length;
    page.innerHTML=`<div class="section-head"><div><h2>Compras</h2><p>Pedidos, proveedores, empresas, costos y recepciones</p></div><div class="split-actions"><button id="purchaseExcel" class="btn sm soft">Descargar Excel</button><button id="newPurchase" class="btn sm primary">+ Nueva compra</button></div></div>
      <div class="grid purchase-kpis"><div class="kpi"><div class="label">Compras abiertas</div><div class="value">${open}</div><div class="meta">Sin cerrar/cancelar</div></div><div class="kpi transit"><div class="label">Pendientes de recibir</div><div class="value">${pending}</div><div class="meta">Asignadas a depósitos</div></div><div class="kpi alert"><div class="label">Urgentes / críticas</div><div class="value">${urgent}</div><div class="meta">Requieren seguimiento</div></div><div class="kpi"><div class="label">Comprado este mes</div><div class="value" style="font-size:17px">${money(usd,'USD')}</div><div class="meta">${money(pyg,'PYG')}</div></div></div>
      ${window.AVHPurchaseDashboard?.html(rows)||''}
      <div class="card" style="margin-top:12px"><div class="toolbar"><input id="purchaseSearch" placeholder="Buscar proveedor, empresa, destino, ítem…"><select id="purchaseStatus"><option value="all">Todos los estados</option>${Object.entries(PURCHASE_STATUS).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select><select id="purchaseCompany"><option value="all">Todas las empresas</option>${D.purchaseCompanies.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select><select id="purchaseDest"><option value="all">Todos los destinos</option>${Object.entries(DEST_LABEL).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select><input id="purchaseFrom" type="date" title="Desde"><input id="purchaseTo" type="date" title="Hasta"></div></div>
      <div class="section-head"><div><h2>Historial de compras</h2><p id="purchaseCount"></p></div></div><div id="purchaseList" class="list"></div>`;
    function draw(){const q=$('#purchaseSearch').value.trim().toLowerCase(),s=$('#purchaseStatus').value,c=$('#purchaseCompany').value,d=$('#purchaseDest').value,f=$('#purchaseFrom').value,t=$('#purchaseTo').value;const filtered=rows.filter(p=>{const text=[p.company_name,p.supplier_name,p.order_reference,p.destination_text,p.warehouse_name,p.requester,p.sector,p.invoice_number,...purchaseItems(p.id).map(x=>x.description)].filter(Boolean).join(' ').toLowerCase();const date=p.ordered_date||'';return(!q||text.includes(q))&&(s==='all'||p.status===s)&&(c==='all'||p.company_id===c)&&(d==='all'||p.destination_type===d)&&(!f||date>=f)&&(!t||date<=t)});$('#purchaseCount').textContent=`${filtered.length} compras`;$('#purchaseList').innerHTML=filtered.map(p=>{const total=purchaseTotal(p),items=purchaseItems(p.id),pct=items.length?Math.min(100,Math.round(items.reduce((a,x)=>a+Number(x.received_qty||0),0)/Math.max(1,items.reduce((a,x)=>a+Number(x.quantity||0),0))*100)):0;return`<div class="row clickable purchase-row ${p.urgency}" data-purchase="${p.id}"><div class="line"><div class="grow"><div class="title">${esc(p.supplier_name||'Proveedor sin definir')} · ${esc(p.company_name||companyName(p.company_id))}</div><div class="subtext">${dateOnly(p.ordered_date)} · ${esc(PURCHASE_TYPE[p.purchase_type]||p.purchase_type)} · ${esc(purchaseDest(p))}${p.order_reference?` · Ref. ${esc(p.order_reference)}`:''}</div><div class="metric-pills"><span>${items.length} ítem${items.length===1?'':'s'}</span><span>${esc(URGENCY_LABEL[p.urgency]||p.urgency)}</span>${p.expected_date?`<span>Entrega ${dateOnly(p.expected_date)}</span>`:''}</div>${p.destination_type==='warehouse'?`<div class="purchase-progress"><i style="width:${pct}%"></i></div>`:''}</div><div style="text-align:right">${statusBadge(p.status)}<div class="purchase-money" style="margin-top:7px">${money(total,p.currency)}</div></div></div></div>`}).join('')||'<div class="empty">No hay compras con esos filtros.</div>';$$('[data-purchase]').forEach(x=>x.onclick=()=>openPurchaseDetail(x.dataset.purchase))}
    ['purchaseStatus','purchaseCompany','purchaseDest','purchaseFrom','purchaseTo'].forEach(id=>$('#'+id).onchange=draw);$('#purchaseSearch').oninput=draw;draw();
    $('#newPurchase').onclick=openNewPurchase;
    $('#purchaseExcel').onclick=downloadPurchasesExcel;
    window.AVHPurchaseDashboard?.bind();
  };

  function unitOptions(selected='unidad'){return PURCHASE_UNITS.map(u=>`<option value="${esc(u)}" ${u===selected?'selected':''}>${esc(u)}</option>`).join('')}
  function openNewPurchase(preselectedSupplierId=null){
    if(profile?.role!=='admin')return;
    let cart=[];
    openModal('Nueva compra','Solo administrador · sin numeración automática',`<div class="two"><div class="field"><label>Empresa que compra/paga *</label><div class="line" style="gap:6px"><select id="pcCompany" style="flex:1">${D.purchaseCompanies.filter(x=>x.active).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select><button id="pcAddCompany" type="button" class="btn sm soft">+ Empresa</button></div></div><div class="field"><label>Proveedor</label><div class="line" style="gap:6px"><select id="pcSupplier" style="flex:1"><option value="">Sin definir</option>${D.suppliers.map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select><button id="pcAddSupplier" type="button" class="btn sm soft">+ Proveedor</button></div></div></div>
      <div class="two"><div class="field"><label>Tipo de compra</label><select id="pcType">${Object.entries(PURCHASE_TYPE).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></div><div class="field"><label>Urgencia</label><select id="pcUrgency"><option value="normal">Normal</option><option value="urgent">Urgente</option><option value="critical">Crítico</option></select></div></div>
      <div class="two"><div class="field"><label>Estado</label><select id="pcStatus">${['draft','requested','quoted','approved','ordered','in_transit'].map(k=>`<option value="${k}" ${k==='ordered'?'selected':''}>${PURCHASE_STATUS[k]}</option>`).join('')}</select></div><div class="field"><label>Destino</label><select id="pcDest"><option value="warehouse">Depósito</option><option value="barge">Barcaza / proyecto</option><option value="direct">Entrega directa</option><option value="service">Servicio</option><option value="other">Otro</option></select></div></div>
      <div id="pcDestFields" class="purchase-destination-fields"><div class="field" id="pcWhWrap"><label>Depósito que debe recibir</label><select id="pcWh">${D.warehouses.filter(x=>x.active).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></div><div class="field hide" id="pcBargeWrap"><label>Barcaza</label><select id="pcBarge"><option value="">Sin barcaza</option>${D.barges.filter(x=>x.active).map(x=>`<option value="${x.id}">Barcaza ${x.number}</option>`).join('')}</select></div><div class="field hide" id="pcDestTextWrap"><label>Destino / lugar</label><input id="pcDestText" placeholder="Ej.: taller, producción, oficina, obra…"></div></div>
      <div class="two"><div class="field"><label>Solicitante</label><input id="pcRequester" placeholder="Quién pidió"></div><div class="field"><label>Sector</label><input id="pcSector" placeholder="Producción, mantenimiento, depósito…"></div></div>
      <div class="two"><div class="field"><label>Moneda</label><select id="pcCurrency"><option value="PYG">Guaraníes (PYG)</option><option value="USD">Dólares (USD)</option></select></div><div class="field"><label>Tipo de cambio</label><input id="pcFx" type="number" step="0.01" placeholder="Opcional"></div></div>
      <div class="two"><div class="field"><label>Fecha de compra/pedido</label><input id="pcDate" type="date" value="${new Date().toISOString().slice(0,10)}"></div><div class="field"><label>Fecha prometida</label><input id="pcExpected" type="date"></div></div>
      <div class="two"><div class="field"><label>Forma de pago</label><input id="pcPayment" placeholder="Transferencia, crédito, contado…"></div><div class="field"><label>Condición</label><input id="pcTerms" placeholder="30 días, 50% anticipo…"></div></div>
      <div class="two"><div class="field"><label>Referencia / OC / pedido</label><input id="pcReference" placeholder="Opcional; sin numeración automática"></div><div class="field"><label>Factura</label><input id="pcInvoice" placeholder="Número si ya existe"></div></div>
      <div class="field"><label>Observaciones</label><textarea id="pcNotes" placeholder="Motivo, urgencia, condiciones especiales…"></textarea></div>
      <div class="section-head"><div><h2>Ítems</h2><p>Producto de stock o descripción libre</p></div></div>
      <div class="card" style="background:#fbfdfb"><div class="field"><label>Producto del inventario</label><select id="pciProduct"><option value="">No vincular / compra libre</option>${D.products.filter(x=>x.active).map(x=>`<option value="${x.id}">${esc(x.name)} · ${esc(x.base_unit)}</option>`).join('')}</select></div><div class="field"><label>Descripción *</label><input id="pciDesc" placeholder="Qué estás comprando"></div><div class="two"><div class="field"><label>Cantidad</label><input id="pciQty" type="number" step="0.001"></div><div class="field"><label>Unidad</label><select id="pciUnit">${unitOptions()}</select></div></div><div class="two"><div class="field"><label>Precio unitario</label><input id="pciPrice" type="number" step="0.0001"></div><div class="field"><label>Conversión a unidad base</label><input id="pciFactor" type="number" step="0.0001" value="1"><div class="hint">Ej.: 1 rollo = 15 kg → poné 15.</div></div></div><label class="line" style="justify-content:flex-start;margin:6px 0 10px"><input id="pciStock" type="checkbox" style="width:18px;height:18px"> <b>Este ítem debe ingresar al inventario cuando lo reciba el depósito</b></label><button id="pcAddItem" type="button" class="btn soft">+ Agregar ítem</button></div><div id="pcCart" style="margin-top:10px"></div>
      <button id="pcSave" type="button" class="btn primary" style="width:100%;margin-top:12px">Guardar compra</button><div id="pcMsg"></div>`);

    if(preselectedSupplierId&&$('#pcSupplier'))$('#pcSupplier').value=preselectedSupplierId;
    function destUI(){const d=$('#pcDest').value;$('#pcWhWrap').classList.toggle('hide',d!=='warehouse');$('#pcBargeWrap').classList.toggle('hide',d!=='barge');$('#pcDestTextWrap').classList.toggle('hide',!['direct','service','other','barge'].includes(d));if(d!=='warehouse')$('#pciStock').checked=false}
    $('#pcDest').onchange=destUI;destUI();
    $('#pciProduct').onchange=()=>{const p=product($('#pciProduct').value);if(p){$('#pciDesc').value=p.name;$('#pciUnit').value=PURCHASE_UNITS.includes(p.base_unit)?p.base_unit:'otro';$('#pciFactor').value='1';if($('#pcDest').value==='warehouse')$('#pciStock').checked=true}};
    function drawCart(){const c=$('#pcCurrency').value;$('#pcCart').innerHTML=cart.map((x,i)=>`<div class="cart-line"><div class="purchase-item-line"><div><b>${esc(x.description)}</b><div class="subtext">${fmt(x.quantity)} ${esc(x.unit)} × ${money(x.unit_price,c)}${x.affects_inventory?' · entra a stock':''}</div></div><button type="button" class="btn sm soft remove" data-pc-remove="${i}">Quitar</button></div></div>`).join('')+(cart.length?`<div class="cart-total"><b>Total estimado: ${money(cart.reduce((a,x)=>a+x.quantity*x.unit_price,0),c)}</b></div>`:'<div class="empty">Agregá los ítems de la compra.</div>');$$('[data-pc-remove]').forEach(b=>b.onclick=()=>{cart.splice(Number(b.dataset.pcRemove),1);drawCart()})}
    $('#pcCurrency').onchange=drawCart;drawCart();
    $('#pcAddItem').onclick=()=>{const productId=$('#pciProduct').value,description=$('#pciDesc').value.trim(),quantity=Number($('#pciQty').value),unit=$('#pciUnit').value,unitPrice=Number($('#pciPrice').value||0),factor=Number($('#pciFactor').value||1),affects=$('#pciStock').checked;if(!description)return alert('Escribí la descripción del ítem.');if(!quantity||quantity<=0)return alert('La cantidad debe ser mayor a cero.');if(!factor||factor<=0)return alert('La conversión debe ser mayor a cero.');if(affects&&!productId)return alert('Para ingresar a stock tenés que vincular el ítem a un producto del inventario.');cart.push({product_id:productId||null,description,quantity,unit,factor_to_base:factor,unit_price:unitPrice,affects_inventory:affects});$('#pciProduct').value='';$('#pciDesc').value='';$('#pciQty').value='';$('#pciPrice').value='';$('#pciFactor').value='1';$('#pciStock').checked=false;drawCart()};
    $('#pcAddSupplier').onclick=async()=>{const name=prompt('Nombre del proveedor:');if(!name?.trim())return;const tax=prompt('RUC (opcional):')||'',phone=prompt('Teléfono (opcional):')||'';const r=await insert('suppliers',{name:name.trim(),tax_id:tax.trim()||null,phone:phone.trim()||null,created_by:profile.id},true);if(r.error)return alert(r.error);await previousLoadAllPurchases(true);await loadPurchaseData();const s=(D.suppliers||[]).find(x=>x.name===name.trim());$('#pcSupplier').insertAdjacentHTML('beforeend',`<option value="${s?.id||r.data?.id||''}">${esc(name.trim())}</option>`);if(s)$('#pcSupplier').value=s.id};
    $('#pcAddCompany').onclick=async()=>{const name=prompt('Nombre de la empresa que compra/paga:');if(!name?.trim())return;const r=await insert('purchase_companies',{name:name.trim(),active:true},true);if(r.error)return alert(r.error);await loadPurchaseData();const c=D.purchaseCompanies.find(x=>x.name===name.trim());$('#pcCompany').insertAdjacentHTML('beforeend',`<option value="${c?.id||r.data?.id||''}">${esc(name.trim())}</option>`);if(c)$('#pcCompany').value=c.id};
    $('#pcSave').onclick=async()=>{const msgEl=$('#pcMsg');if(!cart.length)return msg(msgEl,'Agregá al menos un ítem.');const d=$('#pcDest').value;if(d==='warehouse'&&!$('#pcWh').value)return msg(msgEl,'Elegí el depósito que debe recibir.');const body={company_id:$('#pcCompany').value,supplier_id:$('#pcSupplier').value||null,purchase_type:$('#pcType').value,status:$('#pcStatus').value,urgency:$('#pcUrgency').value,destination_type:d,warehouse_id:d==='warehouse'?$('#pcWh').value:null,barge_id:d==='barge'?($('#pcBarge').value||null):null,destination_text:['direct','service','other','barge'].includes(d)?($('#pcDestText').value.trim()||null):null,requester:$('#pcRequester').value.trim()||null,sector:$('#pcSector').value.trim()||null,currency:$('#pcCurrency').value,exchange_rate:$('#pcFx').value||null,payment_method:$('#pcPayment').value.trim()||null,payment_terms:$('#pcTerms').value.trim()||null,order_reference:$('#pcReference').value.trim()||null,ordered_date:$('#pcDate').value,expected_date:$('#pcExpected').value||null,invoice_number:$('#pcInvoice').value.trim()||null,notes:$('#pcNotes').value.trim()||null};const b=$('#pcSave');b.disabled=true;b.textContent='Guardando compra…';const r=await rpc('admin_create_purchase',{p_data:body,p_items:cart});b.disabled=false;b.textContent='Guardar compra';if(r.error)return msg(msgEl,r.error);const id=r.data;await loadAll(true);closeModal();renderPurchases();setTimeout(()=>openPurchaseDetail(id),100)};
  }

  async function uploadPurchaseDocument(file,purchaseId){if(!file)return null;const safe=file.name.replace(/[^a-zA-Z0-9._-]+/g,'_'),path=`${purchaseId}/${Date.now()}_${safe}`;const r=await request(`/storage/v1/object/purchase-documents/${path}`,{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream','x-upsert':'false'},body:file});if(r.error)throw Error('No se pudo subir el archivo: '+r.error);return path}
  async function signedPurchaseDocument(path){if(!path)throw Error('Archivo inexistente.');const encoded=String(path).split('/').map(encodeURIComponent).join('/');const r=await request(`/storage/v1/object/sign/purchase-documents/${encoded}`,{method:'POST',body:{expiresIn:600}});if(r.error)throw Error(r.error);const u=r.data?.signedURL||r.data?.signedUrl;if(!u)throw Error('No se pudo abrir el archivo.');return /^https?:/.test(u)?u:`${API}/storage/v1${u.startsWith('/')?u:'/'+u}`}
  async function openPurchaseDocument(path){const tab=window.open('about:blank','_blank');try{const u=await signedPurchaseDocument(path);if(tab)tab.location.href=u;else location.href=u}catch(e){if(tab)tab.close();alert(e.message||String(e))}}

  function purchaseRecordRef(p){return p.po_number||p.order_reference||('COMPRA-'+String(p.id||'').slice(0,8).toUpperCase())}
  function purchaseRecordTimeline(p,items,receipts,docs){
    const events=[];
    if(p.created_at)events.push({at:p.created_at,title:'Compra creada',meta:[p.supplier_name||supplierName(p.supplier_id),p.company_name||companyName(p.company_id)].filter(Boolean).join(' · ')});
    if(p.ordered_date)events.push({at:p.ordered_date+'T12:00:00',title:'Pedido registrado',meta:purchaseRecordRef(p)});
    if(p.purchase_confirmed_at)events.push({at:p.purchase_confirmed_at,title:'Compra confirmada',meta:'Pedido confirmado al proveedor'});
    docs.forEach(d=>events.push({at:d.created_at||d.document_date,title:'Documento agregado',meta:(({quotation:'Cotización',order:'Pedido / OC',invoice:'Factura',remittance:'Remito',payment:'Comprobante de pago',other:'Otro'})[d.kind]||d.kind)+' · '+(d.document_number||d.file_name||'Archivo')}));
    receipts.forEach(r=>events.push({at:r.received_at,title:'Recepción registrada',meta:(r.movement_id?'Entrada al inventario':'Recepción sin ingreso a stock')+(r.notes?' · '+r.notes:'')}));
    const audit=(D.auditEvents||[]).filter(a=>a.entity_type==='purchase'&&String(a.entity_id||'')===String(p.id));
    audit.forEach(a=>events.push({at:a.created_at,title:'Actualización de compra',meta:a.action||'Cambio registrado'}));
    return events.filter(x=>x.at).sort((a,b)=>new Date(b.at)-new Date(a.at));
  }
  function bindPurchaseRecordTabs(){
    const tabs=[...document.querySelectorAll('[data-purchase-tab]')];
    const panels=[...document.querySelectorAll('[data-purchase-panel]')];
    tabs.forEach(b=>b.onclick=()=>{
      tabs.forEach(x=>x.classList.toggle('on',x===b));
      panels.forEach(p=>p.classList.toggle('on',p.dataset.purchasePanel===b.dataset.purchaseTab));
    });
  }

  window.openPurchaseDetail=async function(id){
    const p=D.purchases.find(x=>x.id===id);if(!p||profile?.role!=='admin')return;
    activePurchaseRecordId=id;
    ensurePurchasePage();goPage('purchases');
    const page=$('#page-purchases'),items=purchaseItems(id),receipts=purchaseReceipts(id),docs=purchaseDocs(id),total=purchaseTotal(p);
    const receivedQty=items.reduce((a,x)=>a+Number(x.received_qty||0),0),orderedQty=items.reduce((a,x)=>a+Number(x.quantity||0),0);
    const pct=items.length?Math.min(100,Math.round(items.reduce((a,x)=>a+Math.min(1,Number(x.received_qty||0)/Math.max(Number(x.quantity||0),1e-9)),0)/items.length*100)):0;
    const timeline=purchaseRecordTimeline(p,items,receipts,docs);
    const ref=purchaseRecordRef(p);
    page.innerHTML=`<div class="purchase-record">
      <div class="purchase-breadcrumb"><button class="purchase-back" id="purchaseBack">← Compras</button><span>›</span><b>${esc(ref)}</b></div>
      <div class="purchase-record-hero">
        <div class="purchase-record-main"><div class="eyebrow">EXPEDIENTE DE COMPRA</div><div class="purchase-record-titleline"><h2>${esc(ref)}</h2>${statusBadge(p.status)}</div><div class="purchase-record-supplier">${esc(p.supplier_name||supplierName(p.supplier_id)||'Proveedor sin definir')}</div><div class="purchase-record-meta">${esc(p.company_name||companyName(p.company_id))} · ${dateOnly(p.ordered_date)||'Sin fecha'} · ${esc(purchaseDest(p))}</div></div>
        <div class="purchase-record-total"><small>Total de compra</small><strong>${money(total,p.currency)}</strong><span>${items.length} ítem${items.length===1?'':'s'} · ${pct}% recibido</span></div>
      </div>
      <div class="purchase-record-actions">
        <button class="btn soft" id="purchaseRecordBack">← Volver</button>
        ${p.supplier_id?'<button class="btn" id="purchaseRecordSupplier">Ver proveedor</button>':''}
        <button class="btn" data-purchase-tab-jump="documents">Adjuntar / ver documentos</button>
        <button class="btn primary" data-purchase-tab-jump="summary">Gestionar compra</button>
      </div>
      <div class="purchase-record-tabs">
        <button class="on" data-purchase-tab="summary">Resumen</button>
        <button data-purchase-tab="items">Ítems <span>${items.length}</span></button>
        <button data-purchase-tab="receipts">Recepciones <span>${receipts.length}</span></button>
        <button data-purchase-tab="documents">Documentos <span>${docs.length}</span></button>
        <button data-purchase-tab="history">Historial</button>
      </div>

      <div class="purchase-record-panel on" data-purchase-panel="summary">
        <div id="purchaseRecordEnhancements"></div>
        <div class="purchase-summary-grid">
          <div class="detail-box"><span>Estado</span><b>${esc(PURCHASE_STATUS[p.status]||p.status)}</b></div>
          <div class="detail-box"><span>Urgencia</span><b>${esc(URGENCY_LABEL[p.urgency]||p.urgency)}</b></div>
          <div class="detail-box"><span>Destino</span><b>${esc(purchaseDest(p))}</b></div>
          <div class="detail-box"><span>Entrega prometida</span><b>${p.expected_date?dateOnly(p.expected_date):'—'}</b></div>
          <div class="detail-box"><span>Solicitante / sector</span><b>${esc([p.requester,p.sector].filter(Boolean).join(' · ')||'—')}</b></div>
          <div class="detail-box"><span>Pago</span><b>${esc([p.payment_method,p.payment_terms].filter(Boolean).join(' · ')||'—')}</b></div>
          <div class="detail-box"><span>Factura</span><b>${esc(p.invoice_number||'—')}</b></div>
          <div class="detail-box"><span>Referencia</span><b>${esc(p.order_reference||p.po_number||'—')}</b></div>
        </div>
        <div class="card purchase-receipt-overview"><div class="line"><div><div class="eyebrow">CUMPLIMIENTO</div><div class="title">Recepción de la compra</div><div class="subtext">${fmt(receivedQty)} recibido sobre ${fmt(orderedQty)} registrado en ${items.length} ítem${items.length===1?'':'s'}.</div></div><b>${pct}%</b></div><div class="purchase-progress"><i style="width:${pct}%"></i></div></div>
        ${p.notes?`<div class="notice">${esc(p.notes)}</div>`:''}
        <div class="section-head"><div><h2>Gestión</h2><p>Estado y datos principales de la compra</p></div></div>
        <div class="card"><div class="two"><div class="field" style="margin:0"><label>Estado</label><select id="pdStatus">${Object.entries(PURCHASE_STATUS).map(([k,v])=>`<option value="${k}" ${k===p.status?'selected':''}>${v}</option>`).join('')}</select></div><div class="field" style="margin:0"><label>Factura</label><input id="pdInvoice" value="${esc(p.invoice_number||'')}" placeholder="Nº factura"></div></div><div class="two" style="margin-top:9px"><div class="field" style="margin:0"><label>Fecha prometida</label><input id="pdExpected" type="date" value="${p.expected_date||''}"></div><div class="field" style="margin:0"><label>Referencia / OC</label><input id="pdReference" value="${esc(p.order_reference||'')}"></div></div><button id="pdSave" class="btn primary" style="margin-top:10px">Guardar cambios</button><div id="pdMsg"></div></div>
      </div>

      <div class="purchase-record-panel" data-purchase-panel="items">
        <div class="section-head"><div><h2>Ítems comprados</h2><p>Cantidad, recepción, precio y vínculo con inventario</p></div></div>
        <div class="list">${items.map(x=>{const remain=Math.max(0,Number(x.quantity)-Number(x.received_qty||0));const linePct=Number(x.quantity)>0?Math.min(100,Math.round(Number(x.received_qty||0)/Number(x.quantity)*100)):0;return`<div class="row purchase-record-item"><div class="line"><div class="grow"><div class="title">${esc(x.description)}</div><div class="subtext">Comprado: ${fmt(x.quantity)} ${esc(x.unit)} · Recibido: ${fmt(x.received_qty||0)} · Pendiente: ${fmt(remain)}${x.affects_inventory?' · INGRESA A STOCK':''}</div><div class="purchase-progress"><i style="width:${linePct}%"></i></div></div><div class="purchase-item-money"><b>${money(Number(x.quantity)*Number(x.unit_price||0),p.currency)}</b><small>${money(Number(x.unit_price||0),p.currency)} / ${esc(x.unit)}</small></div></div></div>`}).join('')||'<div class="empty">Sin ítems.</div>'}</div>
      </div>

      <div class="purchase-record-panel" data-purchase-panel="receipts">
        <div class="section-head"><div><h2>Recepciones</h2><p>Trazabilidad de lo que llegó físicamente</p></div></div>
        <div class="list">${receipts.map(r=>`<div class="row purchase-record-event"><div class="purchase-event-dot green"></div><div><div class="title">${dt(r.received_at)}</div><div class="subtext">${esc(D.profiles.find(x=>x.id===r.received_by)?.username||'Usuario')} · ${r.movement_id?'Entrada al inventario generada':'Recepción sin ingreso a stock'}${r.notes?' · '+esc(r.notes):''}</div></div></div>`).join('')||'<div class="empty">Todavía no hay recepciones.</div>'}</div>
      </div>

      <div class="purchase-record-panel" data-purchase-panel="documents">
        <div class="section-head"><div><h2>Documentos</h2><p>Cotización, OC, factura, remito y comprobantes</p></div><button id="pdAddDoc" class="btn sm primary">+ Adjuntar documento</button></div>
        <div class="list" id="pdDocs">${docs.map(d=>`<div class="row purchase-doc"><div><div class="title">${esc(({quotation:'Cotización',order:'Pedido / OC',invoice:'Factura',remittance:'Remito',payment:'Comprobante de pago',other:'Otro'})[d.kind]||d.kind)}</div><div class="subtext">${esc(d.file_name||'Archivo')} · ${dt(d.created_at)}</div></div><button class="btn sm" data-pdoc="${esc(d.file_path)}">Abrir</button></div>`).join('')||'<div class="empty">Sin documentos adjuntos.</div>'}</div>
      </div>

      <div class="purchase-record-panel" data-purchase-panel="history">
        <div class="section-head"><div><h2>Historial</h2><p>Vida del expediente de compra</p></div></div>
        <div class="purchase-timeline">${timeline.map(e=>`<div class="purchase-timeline-row"><div class="purchase-timeline-mark"></div><div><b>${esc(e.title)}</b><div class="subtext">${dt(e.at)}${e.meta?' · '+esc(e.meta):''}</div></div></div>`).join('')||'<div class="empty">Todavía no hay eventos.</div>'}</div>
      </div>
    </div>`;

    const back=()=>{renderPurchases();window.AVHShell?.syncActive?.('purchases')};
    $('#purchaseBack').onclick=back;$('#purchaseRecordBack').onclick=back;
    bindPurchaseRecordTabs();
    $$('[data-purchase-tab-jump]').forEach(b=>b.onclick=()=>document.querySelector(`[data-purchase-tab="${b.dataset.purchaseTabJump}"]`)?.click());
    $$('[data-pdoc]').forEach(b=>b.onclick=()=>openPurchaseDocument(b.dataset.pdoc));
    $('#purchaseRecordSupplier')?.addEventListener('click',()=>window.openSupplierProfile?.(p.supplier_id));
    $('#pdSave').onclick=async()=>{const b=$('#pdSave');b.disabled=true;const r=await rpc('admin_update_purchase',{p_purchase_id:id,p_patch:{status:$('#pdStatus').value,invoice_number:$('#pdInvoice').value.trim()||null,expected_date:$('#pdExpected').value||null,order_reference:$('#pdReference').value.trim()||null}});b.disabled=false;if(r.error)return msg($('#pdMsg'),r.error);msg($('#pdMsg'),'Compra actualizada.',true);await loadAll(true);setTimeout(()=>openPurchaseDetail(id),100)};
    $('#pdAddDoc').onclick=()=>{const kind=prompt('Tipo: cotización / orden / factura / remito / pago / otro','factura')||'';const map={cotizacion:'quotation','cotización':'quotation',orden:'order',oc:'order',pedido:'order',factura:'invoice',remito:'remittance',pago:'payment',otro:'other'};const k=map[kind.trim().toLowerCase()]||'other';const inp=document.createElement('input');inp.type='file';inp.accept='application/pdf,image/*';inp.onchange=async()=>{const file=inp.files?.[0];if(!file)return;try{const path=await uploadPurchaseDocument(file,id);const r=await insert('purchase_documents',{purchase_id:id,kind:k,file_path:path,file_name:file.name,uploaded_by:profile.id});if(r.error)throw Error(r.error);await loadAll(true);openPurchaseDetail(id)}catch(e){alert(e.message||String(e))}};inp.click()};
    const title=$('#sectionTitle');if(title)title.textContent=ref;
  };

  window.openNewPurchaseForSupplier=function(supplierId){return openNewPurchase(supplierId||null)};
  window.renderPurchaseReceipts=function(){
    if(profile?.role!=='depositor')return;
    const pending=(D.purchases||[]).filter(pendingPurchase);
    $('#moduleContent').innerHTML=`<div class="section-head"><div><h2>Recepciones de compras</h2><p>Confirmá solamente lo que llegó físicamente a ${esc(whName(profile.warehouse_id))}</p></div><span class="badge amber">${pending.length} pendientes</span></div><div class="notice">Una compra no aumenta el stock hasta que la recibas. Podés hacer recepciones parciales si llegó menos de lo comprado.</div><div class="list" style="margin-top:10px">${pending.map(p=>`<div class="row clickable purchase-row ${p.urgency}" data-receive-purchase="${p.id}"><div class="line"><div><div class="title">${esc(p.supplier_name||supplierName(p.supplier_id)||'Proveedor sin definir')}</div><div class="subtext">${esc(p.company_name||companyName(p.company_id))} · ${dateOnly(p.ordered_date)}${p.expected_date?' · Prometido '+dateOnly(p.expected_date):''}</div><div class="metric-pills"><span>${purchaseItems(p.id).filter(x=>Number(x.received_qty)<Number(x.quantity)).length} ítems pendientes</span><span>${esc(URGENCY_LABEL[p.urgency]||p.urgency)}</span></div></div>${statusBadge(p.status)}</div></div>`).join('')||'<div class="empty">No hay compras pendientes de recepción para tu depósito.</div>'}</div>`;$$('[data-receive-purchase]').forEach(x=>x.onclick=()=>openPurchaseReceipt(x.dataset.receivePurchase))
  };

  function openPurchaseReceipt(id){
    const p=D.purchases.find(x=>x.id===id);if(!p||p.warehouse_id!==profile.warehouse_id)return alert('Esta compra no pertenece a tu depósito.');const items=purchaseItems(id).filter(x=>Number(x.received_qty)<Number(x.quantity));
    openModal('Recibir compra',`${p.supplier_name||supplierName(p.supplier_id)||'Proveedor'} · ${p.company_name||companyName(p.company_id)}`,`<div class="notice">Cargá únicamente la cantidad que tenés físicamente delante. Si falta mercadería, dejá el saldo para otra recepción.</div><div class="section-head"><h2>Cantidades recibidas</h2></div><div class="list">${items.map(x=>{const rem=Number(x.quantity)-Number(x.received_qty||0);return`<div class="row"><div class="receive-grid"><div><div class="title">${esc(x.description)}</div><div class="subtext">Pendiente: ${fmt(rem)} ${esc(x.unit)}${x.affects_inventory?' · se sumará al stock':''}</div></div><div class="field" style="margin:0"><label>Recibido ahora</label><input type="number" step="0.001" min="0" max="${rem}" value="${rem}" data-receive-qty="${x.id}"></div></div></div>`}).join('')}</div><div class="two" style="margin-top:10px"><div class="field"><label>Nº remito / factura</label><input id="prDocNo" placeholder="Opcional"></div><div class="field"><label>Fecha documento</label><input id="prDocDate" type="date" value="${new Date().toISOString().slice(0,10)}"></div></div><div class="field"><label>Foto o PDF del remito/factura</label><input id="prFile" type="file" accept="image/*,.pdf" capture="environment"><div class="hint">Desde el celular podés sacar la foto en el momento.</div></div><div class="field"><label>Observación de recepción</label><textarea id="prNotes" placeholder="Ej.: llegaron 2 cajas golpeadas, faltan 10 unidades…"></textarea></div><button id="prConfirm" class="btn primary" style="width:100%">Confirmar recepción</button><div id="prMsg"></div>`);
    $('#prConfirm').onclick=async()=>{const lines=[];$$('[data-receive-qty]').forEach(inp=>{const q=Number(inp.value||0);if(q>0)lines.push({purchase_item_id:inp.dataset.receiveQty,quantity:q})});if(!lines.length)return msg($('#prMsg'),'Indicá al menos una cantidad recibida.');const b=$('#prConfirm');b.disabled=true;b.textContent='Registrando recepción…';try{let path=null;const f=$('#prFile').files?.[0];if(f)path=await uploadDocument(f,p.warehouse_id);const r=await rpc('receive_purchase',{p_purchase_id:id,p_items:lines,p_notes:$('#prNotes').value.trim()||null,p_document_number:$('#prDocNo').value.trim()||null,p_document_date:$('#prDocDate').value||null,p_file_path:path});if(r.error)throw Error(r.error);await loadAll(true);closeModal();activeModule='purchase-receipts';renderPurchaseReceipts()}catch(e){msg($('#prMsg'),e.message||String(e))}finally{b.disabled=false;b.textContent='Confirmar recepción'}};
  }

  async function downloadPurchasesExcel(){
    if(profile?.role!=='admin')return;
    const from=$('#purchaseFrom')?.value||'',to=$('#purchaseTo')?.value||'',company_id=$('#purchaseCompany')?.value||'all',status=$('#purchaseStatus')?.value||'all';const btn=$('#purchaseExcel');if(btn){btn.disabled=true;btn.textContent='Generando…'}
    try{const r=await fetch(`${API}/functions/v1/admin-export-purchases-excel`,{method:'POST',headers:{apikey:KEY,Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({from,to,company_id:company_id==='all'?'':company_id,status:status==='all'?'':status})});if(!r.ok){let t=await r.text();try{t=JSON.parse(t).error||t}catch{}throw Error(t||'No se pudo generar el Excel.')}const blob=await r.blob(),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=`Compras_AVH_${new Date().toISOString().slice(0,10)}.xlsx`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1000)}catch(e){alert(e.message||String(e))}finally{if(btn){btn.disabled=false;btn.textContent='Descargar Excel'}}
  }

  ensurePurchasePage();
})();
