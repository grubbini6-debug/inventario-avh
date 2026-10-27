// The viewer has its own query-only workspace. Operational screens and commands
// keep their existing admin/depositor/production checks.
(function(){
 const viewer=()=>profile?.role==='admin_viewer';
 const S={user:null,section:'purchases',source:null,search:'',status:'all',company:'all',warehouse:'all',from:'',to:'',page:0,rows:[],catalogs:{},purchases:[],items:[],documents:[],error:'',busy:false,epoch:0,detailEpoch:0};
 const C={
  purchases:{title:'Compras',icon:'🛒',sources:[['v_purchase_overview','Compras']]},
  inventory:{title:'Inventario',icon:'▦',sources:[['v_stock_by_warehouse','Existencias'],['v_stock_status','Mínimos y alertas'],['v_inventory_batch_detail','Lotes y costos']]},
  moves:{title:'Movimientos',icon:'⇅',sources:[['movements','Movimientos','*,movement_lines(*)']]},
  suppliers:{title:'Proveedores',icon:'◉',sources:[['suppliers','Proveedores']]},
  barges:{title:'Barcazas',icon:'⚓',sources:[['barges','Barcazas'],['v_barge_consumption','Consumos y costos'],['v_barge_module_consumption','Costos por módulo']]},
  fabrication:{title:'Fabricación Naval',icon:'⚒',sources:[['fabrication_orders','Órdenes'],['fabrication_logs','Avances'],['fabrication_quality_checks','Calidad'],['fabrication_materials','Materiales'],['fabrication_stock_links','Consumos y entregas'],['fabrication_reports','Reportes diarios'],['fabrication_workers','Personal'],['fabrication_closures','Cierres diarios'],['fabrication_attachments','Documentos'],['fabrication_components','Componentes'],['fabrication_settings','Talleres'],['fabrication_access','Permisos']]},
  gases:{title:'Gases',icon:'◉',sources:[['v_gas_stock_status','Existencias'],['gas_custody','Cilindros en poder de terceros'],['gas_events','Historial'],['gas_products','Presentaciones']]},
  workorders:{title:'Órdenes de Trabajo',icon:'▤',sources:[['work_orders','Órdenes'],['work_order_progress','Avances'],['work_order_quality','Calidad'],['work_order_events','Historial']]},
  commercial:{title:'Presupuestos y OC',icon:'▧',sources:[['commercial_documents','Documentos'],['commercial_document_events','Historial']]},
  reports:{title:'Reportes',icon:'▥',sources:[['v_stock_value_by_warehouse','Valor del inventario'],['bi_purchase_monthly','Compras por mes'],['bi_supplier_performance','Cumplimiento de proveedores'],['v_fabrication_costs','Costos de fabricación'],['v_management_daily_30d','Actividad de 30 días']]},
  alerts:{title:'Alertas y solicitudes',icon:'🔔',sources:[['v_purchase_alerts','Compras pendientes'],['supply_requests','Abastecimiento'],['product_requests','Altas de productos'],['product_deletion_requests','Bajas de productos'],['correction_requests','Correcciones'],['v_data_quality_issues','Calidad de datos'],['notifications','Avisos']]},
  audit:{title:'Auditoría',icon:'☷',sources:[['audit_events','Actividad del sistema']]},
  catalogs:{title:'Catálogos y usuarios',icon:'⚙',sources:[['products','Productos'],['product_presentations','Presentaciones'],['warehouses','Depósitos'],['stock_minimums','Políticas de abastecimiento'],['purchase_companies','Empresas'],['profiles','Usuarios'],['warehouse_opening_inventory','Inventario inicial']]}
 };
 const names={id:'Identificador',username:'Usuario',full_name:'Nombre',role:'Perfil',active:'Activo',name:'Nombre',code:'Código',number:'Número',order_no:'Nº de fabricación',movement_no:'Nº de movimiento',po_number:'Orden de compra',status:'Estado',state:'Estado',kind:'Tipo de documento',purchase_type:'Tipo de compra',urgency:'Urgencia',description:'Descripción',quantity:'Cantidad',received_qty:'Cantidad recibida',unit:'Unidad',base_unit:'Unidad base',base_quantity:'Cantidad base',factor_to_base:'Equivalencia a unidad base',unit_price:'Precio unitario',total_amount:'Importe total',currency:'Moneda',exchange_rate:'Tipo de cambio',unit_cost:'Costo unitario',real_cost:'Costo real',stock_qty:'Stock',stock_value:'Valor del stock',minimum_qty:'Mínimo',warehouse_id:'Depósito',warehouse_from_id:'Depósito de origen',warehouse_to_id:'Depósito de destino',supplier_id:'Proveedor',company_id:'Empresa',barge_id:'Barcaza',product_id:'Producto',order_id:'Orden',user_id:'Usuario',created_by:'Creado por',updated_by:'Actualizado por',actor_id:'Usuario',received_by:'Recibido por',uploaded_by:'Adjuntado por',responsible_id:'Responsable',granted_by:'Autorizado por',issued_by:'Emitido por',requested_by:'Solicitado por',warehouse_name:'Depósito',supplier_name:'Proveedor',company_name:'Empresa',product_name:'Producto',barge_number:'Barcaza',created_at:'Creado el',updated_at:'Actualizado el',received_at:'Recibido el',ordered_date:'Fecha de compra',expected_date:'Entrega prevista',invoice_number:'Nº de factura',invoice_date:'Fecha de factura',source_document_number:'Presupuesto de referencia',source_document_date:'Fecha del presupuesto',document_number:'Nº de documento',document_date:'Fecha del documento',payment_method:'Forma de pago',payment_terms:'Condición de pago',order_reference:'Referencia',destination:'Destino',destination_type:'Tipo de destino',destination_text:'Detalle del destino',requester:'Solicitante',sector:'Sector',notes:'Observaciones',file_name:'Archivo',file_path:'Ruta del archivo',delivery_mode:'Modalidad de entrega',tax_id:'RUC',phone:'Teléfono',address:'Dirección',legal_name:'Razón social',title:'Título',body:'Detalle',action:'Acción',entity_type:'Registro',detail:'Detalle',payload:'Datos del documento',issued_payload:'Versión emitida',items:'Ítems',tasks:'Trabajos',source:'Origen',requested_qty:'Cantidad solicitada',produced_qty:'Cantidad fabricada',approved_qty:'Cantidad aprobada',required_qty:'Cantidad necesaria',reserved_qty:'Cantidad reservada',priority:'Prioridad',due_date:'Fecha prevista',work_date:'Fecha de trabajo',report_date:'Fecha del reporte',piece_code:'Código de pieza',project:'Proyecto',drawing:'Plano',drawing_revision:'Revisión del plano',personnel:'Personal',activity:'Actividad',completed_qty:'Cantidad realizada',result:'Resultado',measurements:'Mediciones',defects:'Defectos',scope:'Alcance',internal_quality:'Calidad interna',estimated_cost:'Costo estimado',estimated_currency:'Moneda estimada',known_cost:'Costo conocido',recorded_cost:'Costo registrado',unpriced_records:'Registros sin precio',hourly_rate:'Tarifa por hora',specialty:'Especialidad',full_qty:'Cilindros llenos',empty_qty:'Cilindros vacíos',outside_qty:'En producción',supplier_qty:'En proveedor',kg_per_cylinder:'Kg por cilindro',full_kg:'Kg disponibles',location:'Lugar',person:'Persona',reference:'Referencia',gas_name:'Gas',gas_kind:'Tipo de gas',counted_at:'Último conteo',counted_by:'Contado por',naval_section:'Sección naval',naval_module:'Módulo naval',analysis_status:'Control de factura',analysis_data:'Resultado del control',analysis_confidence:'Confianza de lectura',analysis_error:'Observación del análisis',analyzed_at:'Analizado el',must_change_password:'Cambio de contraseña pendiente',work_location:'Lugar de trabajo',inventory_warehouse_id:'Inventario de consulta',access_level:'Nivel de acceso',enabled:'Habilitado',blocked_reason:'Motivo de bloqueo',review_note:'Observación de revisión',reviewed_at:'Revisado el',resolution_notes:'Resolución',voided_at:'Anulado el',void_reason:'Motivo de anulación',client:'Cliente',recipient_name:'Destinatario',recipient_tax_id:'RUC del destinatario',recipient_contact:'Contacto del destinatario',responsible:'Responsable',issuer_name:'Preparado por',vessel:'Embarcación',subtotal:'Subtotal',tax_amount:'Impuestos',total:'Total',payment_terms_text:'Condiciones de pago',delivery_terms:'Condiciones de entrega',unit_price_base:'Precio por unidad base'};
 const labels={admin:'Administrador general',admin_viewer:'Administrador · Solo lectura',depositor:'Depositario',production:'Producción',draft:'Borrador',requested:'Solicitado',quoted:'Cotizando',approved:'Aprobado',ordered:'Comprado / pedido',in_transit:'En camino',partially_received:'Recibido parcial',received:'Recibido total',invoiced:'Facturado',closed:'Cerrado',cancelled:'Anulado',issued:'Emitido',submitted:'Pendiente de autorización',in_progress:'En ejecución',pending:'Pendiente',preparation:'Preparación',manufacturing:'En fabricación',quality:'Calidad',completed:'Terminado',delivered:'Entregado',normal:'Normal',urgent:'Urgente',critical:'Crítico',high:'Alta',low:'Baja',stock:'Stock',service:'Servicio',spare_part:'Repuesto',rental:'Alquiler',freight:'Flete',direct_consumption:'Consumo directo',warehouse:'Depósito',barge:'Barcaza',direct:'Entrega directa',other:'Otro',single:'Entrega única',partial:'Entregas parciales',quote:'Presupuesto',order:'Orden de compra',purchase_order:'Orden de compra',invoice:'Factura',remittance:'Remito',entry:'Entrada',exit:'Salida',transfer:'Transferencia',return:'Devolución',initial:'Inventario inicial',correction:'Corrección',confirmed:'Confirmado'};
 const numeric=v=>Number(v)||0,label=v=>labels[v]||String(v??'—'),source=()=>C[S.section].sources.find(x=>x[0]===S.source)||C[S.section].sources[0];
 const root=()=>$('#readonlyPanel');
 const title=r=>r.po_number||r.number||(r.order_no?'OF-'+String(r.order_no).padStart(6,'0'):'')||(r.movement_no?'Movimiento '+r.movement_no:'')||r.title||r.description||r.product_name||r.name||r.username||r.file_name||r.proposed_name||r.requested_name||r.action||r.report_date||r.work_date||'Registro';
 const catalogs={warehouse_id:'warehouses',warehouse_from_id:'warehouses',warehouse_to_id:'warehouses',inventory_warehouse_id:'warehouses',supplier_id:'suppliers',company_id:'purchase_companies',barge_id:'barges',product_id:'products',user_id:'profiles',actor_id:'profiles',created_by:'profiles',updated_by:'profiles',received_by:'profiles',uploaded_by:'profiles',responsible_id:'profiles',issued_by:'profiles',granted_by:'profiles',requested_by:'profiles',counted_by:'profiles'};
 const resolved=(key,value)=>{const r=S.catalogs[catalogs[key]]?.find(x=>x.id===value);return r?(r.full_name||r.username||r.name||'Barcaza '+r.number):null;};
 function display(key,value){
  if(value==null||value==='')return'—';
  if(typeof value==='boolean')return value?'Sí':'No';
  const named=resolved(key,value);if(named)return named;
  if(typeof value==='number')return fmt(value);
  if(/(_at|_date)$/.test(key)&&/^\d{4}-\d{2}-\d{2}/.test(String(value)))return value.length===10?value.split('-').reverse().join('/'):dt(value);
  return label(value);
 }
 const omitted=new Set(['client_request_id','request_id','request_data','request_data_hash','email_claim_token','email_claimed_at','password_changed_at','logo_data_url','source_rows','reading','result_cache']);
 function detailHtml(obj,depth=0){
  if(obj==null)return'<span class="subtext">Sin datos</span>';
  if(typeof obj!=='object')return esc(obj);
  if(depth>6)return'<span class="subtext">Detalle anidado disponible en el documento original.</span>';
  if(Array.isArray(obj))return obj.map((r,i)=>`<div class="readonly-nested"><b>${i+1}.</b>${detailHtml(r,depth+1)}</div>`).join('')||'<span class="subtext">Sin registros</span>';
  return `<dl class="readonly-fields">${Object.entries(obj).filter(([k])=>!omitted.has(k)&&!/^.*_base64$/.test(k)&&(!k.endsWith('_id')||names[k])).map(([k,v])=>`<div><dt>${esc(names[k]||k.replaceAll('_',' '))}</dt><dd>${v&&typeof v==='object'?detailHtml(v,depth+1):esc(display(k,v))}</dd></div>`).join('')}</dl>`;
 }
 async function read(table,select='*',extra=''){
  const orders={v_stock_by_warehouse:'warehouse_id,product_id',v_stock_status:'warehouse_id,product_id',v_inventory_batch_detail:'batch_id',v_stock_value_by_warehouse:'warehouse_id,currency',v_gas_stock_status:'warehouse_id,product_id',v_barge_consumption:'barge_id,product_id,currency',v_barge_module_consumption:'barge_id,naval_section,naval_module,product_id,currency',v_fabrication_costs:'order_id,currency',bi_purchase_monthly:'ordered_month,currency',bi_supplier_performance:'supplier_id',v_management_daily_30d:'day,warehouse_id',v_purchase_alerts:'purchase_id',v_data_quality_issues:'issue_key',stock_minimums:'warehouse_id,product_id',fabrication_materials:'order_id,product_id',fabrication_settings:'warehouse_id',fabrication_access:'warehouse_id,user_id',fabrication_closures:'warehouse_id,report_date',work_order_progress:'order_id,task_id',work_order_access:'user_id',gas_products:'product_id'};
  const order=orders[table]||'id';
  const paging=/order=/.test(extra)?extra+(order==='id'?',id.desc':''):[extra,'order='+order].filter(Boolean).join('&');
  const r=await queryAll(table,select,paging);if(r.error)throw Error(r.error);return r.data||[];
 }
 function navigation(){
  if(!viewer())return;
  document.body.classList.add('admin-viewer-mode');
  let page=$('#page-readonly');if(!page){page=document.createElement('section');page.id='page-readonly';page.className='page';page.innerHTML='<div id="readonlyPanel"></div>';$('.app').append(page);}
  $$('.page').forEach(p=>p.classList.toggle('on',p===page));
  let nav=$('#readonlyNav');if(!nav){nav=document.createElement('div');nav.id='readonlyNav';nav.className='readonly-nav';nav.innerHTML=Object.entries(C).map(([key,c])=>`<button type="button" data-readonly-section="${key}"><b aria-hidden="true">${c.icon}</b><span>${c.title}</span></button>`).join('');$('.nav-brand').after(nav);nav.querySelectorAll('button').forEach(b=>b.onclick=()=>openSection(b.dataset.readonlySection));}
  nav.querySelectorAll('button').forEach(b=>{const on=b.dataset.readonlySection===S.section;b.classList.toggle('on',on);b.setAttribute('aria-current',on?'page':'false');});
  $('#who').textContent=(profile.full_name||profile.username)+' · Administrador de solo lectura';
  $('#sidebarRole').textContent='Administrador · Solo lectura';$('#sidebarWho').textContent=profile.full_name||profile.username;
  $('#sectionTitle').textContent=C[S.section].title;document.title=C[S.section].title+' · Inventario AVH';
 }
 function render(){
  if(!viewer())return;navigation();
  root().innerHTML=`<div class="readonly-banner"><div><span class="eyebrow">ADMINISTRADOR · SOLO LECTURA</span><h2>Consulta general</h2><p>Consultá toda la información y abrí los documentos registrados.</p></div><span class="badge green">Solo lectura</span></div>
   <div class="field readonly-mobile-section"><label for="readonlySection">Sección</label><select id="readonlySection">${Object.entries(C).map(([key,c])=>`<option value="${key}" ${key===S.section?'selected':''}>${c.title}</option>`).join('')}</select></div>
   ${S.section==='purchases'?purchaseKpis():''}
   <div class="section-head"><div><h2>${esc(C[S.section].title)}</h2><p>${esc(source()[1])}</p></div><button id="readonlyExport" type="button" class="btn soft sm">Descargar listado</button></div>
   ${C[S.section].sources.length>1?`<div class="readonly-tabs" role="tablist">${C[S.section].sources.map(([key,text])=>`<button type="button" class="btn sm ${source()[0]===key?'primary':''}" role="tab" aria-selected="${source()[0]===key}" data-readonly-source="${key}">${text}</button>`).join('')}</div>`:''}
   <div class="card readonly-filters"><div class="toolbar"><input id="readonlySearch" type="search" aria-label="Buscar registros" placeholder="${S.section==='purchases'?'Proveedor, OC, factura, presupuesto o ítem…':'Buscar en esta consulta…'}" value="${esc(S.search)}"><select id="readonlyStatus" aria-label="Estado"><option value="all">Todos los estados</option>${[...new Set(S.rows.map(r=>r.status||r.state).filter(Boolean))].map(s=>`<option value="${esc(s)}" ${s===S.status?'selected':''}>${esc(label(s))}</option>`).join('')}</select><select id="readonlyWarehouse" aria-label="Depósito"><option value="all">Todos los depósitos</option>${(S.catalogs.warehouses||[]).map(w=>`<option value="${w.id}" ${w.id===S.warehouse?'selected':''}>${esc(w.name)}</option>`).join('')}</select>${S.section==='purchases'?`<select id="readonlyCompany" aria-label="Empresa"><option value="all">Todas las empresas</option>${(S.catalogs.purchase_companies||[]).map(c=>`<option value="${c.id}" ${c.id===S.company?'selected':''}>${esc(c.name)}</option>`).join('')}</select>`:''}<label>Desde <input id="readonlyFrom" type="date" value="${S.from}"></label><label>Hasta <input id="readonlyTo" type="date" value="${S.to}"></label></div></div>
   <p id="readonlyError" class="error" role="alert">${esc(S.error)}</p><p id="readonlyCount" class="subtext" aria-live="polite"></p><div id="readonlyRows" class="list" aria-busy="${S.busy}"></div><div id="readonlyPager" class="split-actions readonly-pager"></div>`;
  $('#readonlySection').onchange=e=>openSection(e.target.value);
  $$('[data-readonly-source]').forEach(b=>b.onclick=()=>openSection(S.section,b.dataset.readonlySource));
  $('#readonlySearch').oninput=e=>{S.search=e.target.value;S.page=0;draw();};
  for(const [id,key] of [['readonlyStatus','status'],['readonlyWarehouse','warehouse'],['readonlyCompany','company'],['readonlyFrom','from'],['readonlyTo','to']]){const el=$('#'+id);if(el)el.onchange=()=>{S[key]=el.value;S.page=0;draw();};}
  $('#readonlyExport').onclick=exportRows;draw();
 }
 function purchaseKpis(){
  const open=S.purchases.filter(p=>!['closed','cancelled'].includes(p.status));
  const amount=currency=>S.purchases.filter(p=>p.status!=='cancelled'&&p.currency===currency).reduce((a,p)=>a+numeric(p.total_amount),0);
  return `<div class="grid purchase-kpis readonly-kpis"><div class="kpi"><span class="label">Compras registradas</span><div class="value">${S.purchases.length}</div></div><div class="kpi"><span class="label">Compras abiertas</span><div class="value">${open.length}</div></div><div class="kpi"><span class="label">Comprado · USD</span><div class="value">${money(amount('USD'),'USD')}</div></div><div class="kpi"><span class="label">Comprado · PYG</span><div class="value">${money(amount('PYG'),'PYG')}</div></div></div>`;
 }
 function searchable(r){return Object.entries(r).filter(([key])=>!omitted.has(key)).map(([key,value])=>resolved(key,value)||((typeof value==='object')?JSON.stringify(value):String(value??''))).join(' ').toLocaleLowerCase();}
 function filtered(){
  const q=S.search.trim().toLocaleLowerCase();
  return S.rows.filter(r=>{
   const date=String(r.ordered_date||r.report_date||r.work_date||r.document_date||r.created_at||r.received_at||'').slice(0,10);
   const wh=[r.warehouse_id,r.warehouse_from_id,r.warehouse_to_id];
   return (!q||searchable(r).includes(q)||(S.section==='purchases'&&S.items.some(i=>i.purchase_id===r.id&&searchable(i).includes(q))))&&(S.status==='all'||(r.status||r.state)===S.status)&&(S.warehouse==='all'||wh.includes(S.warehouse))&&(S.company==='all'||r.company_id===S.company)&&(!S.from||date>=S.from)&&(!S.to||date<=S.to);
  });
 }
 function rowHtml(r,index){
  const state=r.status||r.state;
  const subtitle=[r.supplier_name,r.company_name,r.warehouse_name,resolved('warehouse_id',r.warehouse_id),resolved('supplier_id',r.supplier_id),r.full_name,r.po_number?null:r.invoice_number,r.ordered_date,r.report_date,r.created_at?dt(r.created_at):null].filter(Boolean);
  let right=state?`<span class="badge ${['cancelled','critical'].includes(state)?'red':['received','closed','completed','delivered'].includes(state)?'green':'amber'}">${esc(label(state))}</span>`:'';
  if(r.total_amount!=null)right+=`<strong>${money(r.total_amount,r.currency)}</strong>`;
  if(r.stock_qty!=null)right+=`<strong>${fmt(r.stock_qty)} ${esc(r.base_unit||'')}</strong>`;
  if(r.full_qty!=null)right+=`<strong>${fmt(r.full_qty)} llenos · ${fmt(r.empty_qty)} vacíos</strong>`;
  if(S.section==='purchases'){
   const docs=S.documents.filter(d=>d.purchase_id===r.id);
   right+=`<small>${docs.length} documento${docs.length===1?'':'s'}</small>`;
  }
  return `<div class="row readonly-row"><div class="line"><div class="grow"><div class="title">${esc(title(r))}</div><div class="subtext">${esc([...new Set(subtitle)].join(' · '))}</div>${S.section==='purchases'?`<div class="subtext">Factura: ${esc(r.invoice_number||'Pendiente')} · OC: ${esc(r.po_number||'Sin emitir')}</div>`:''}</div><div class="readonly-row-side">${right}<button type="button" class="btn sm soft" data-readonly-open="${index}">Ver detalle</button></div></div></div>`;
 }
 function draw(){
  if(!viewer()||!$('#readonlyRows'))return;
  const rows=filtered(),pages=Math.max(1,Math.ceil(rows.length/50));S.page=Math.min(S.page,pages-1);
  $('#readonlyCount').textContent=S.busy?'Consultando…':`${rows.length} registros · página ${S.page+1} de ${pages}`;
  const start=S.page*50;
  $('#readonlyRows').innerHTML=rows.slice(start,start+50).map((r,i)=>rowHtml(r,start+i)).join('')||`<div class="empty">${S.busy?'Cargando información…':S.error?'No se pudo completar esta consulta. Usá Actualizar para reintentar.':'No hay registros con esos filtros.'}</div>`;
  $$('[data-readonly-open]').forEach(b=>b.onclick=()=>openRecord(rows[Number(b.dataset.readonlyOpen)]));
  $('#readonlyPager').innerHTML=pages>1?`<button type="button" class="btn" id="readonlyPrev" ${S.page===0?'disabled':''}>← Anterior</button><button type="button" class="btn" id="readonlyNext" ${S.page+1>=pages?'disabled':''}>Siguiente →</button>`:'';
  if($('#readonlyPrev'))$('#readonlyPrev').onclick=()=>{S.page--;draw();};if($('#readonlyNext'))$('#readonlyNext').onclick=()=>{S.page++;draw();};
 }
 async function openSection(section,table){
  if(!viewer()||!C[section])return;
  Object.assign(S,{section,source:table||C[section].sources[0][0],rows:[],search:'',status:'all',company:'all',warehouse:'all',from:'',to:'',page:0,error:'',busy:true});
  const epoch=++S.epoch;render();await loadRows(epoch);
 }
 async function loadRows(epoch=S.epoch){
  const owner=profile?.id,config=source(),rebuild=S.busy||!$('#readonlyRows');
  try{
   const select=config[0]==='fabrication_reports'?'id,warehouse_id,report_date,revision,source,payload,generated_by,created_at,email_status':config[2]||'*';
   const rows=await read(config[0],select,config[0]==='v_purchase_overview'?'order=created_at.desc':config[0]==='movements'?'order=created_at.desc':config[0]==='audit_events'?'order=created_at.desc':'');
   if(profile?.id!==owner||epoch!==S.epoch||!viewer())return;
   S.rows=rows;S.error='';if(config[0]==='v_purchase_overview')S.purchases=rows;
  }catch(error){if(profile?.id===owner&&epoch===S.epoch){S.rows=[];S.error=error.message;}}
  finally{if(profile?.id===owner&&epoch===S.epoch&&viewer()){S.busy=false;if(rebuild)render();else{draw();$('#readonlyError').textContent=S.error;}}}
 }
 async function openFile(bucket,path){
  const tab=window.open('about:blank','_blank');
  try{
   if(!viewer()||!path)throw Error('No hay un archivo registrado.');
   const encoded=path.split('/').map(encodeURIComponent).join('/');
   const r=await request(`/storage/v1/object/sign/${bucket}/${encoded}`,{method:'POST',body:{expiresIn:600}});
   if(r.error)throw Error(r.error);const signed=r.data?.signedURL||r.data?.signedUrl;if(!signed)throw Error('No se pudo abrir el documento.');
   const url=new URL(/^https?:/.test(signed)?signed:API+'/storage/v1/'+signed.replace(/^\//,''));
   if(url.origin!==new URL(API).origin)throw Error('La dirección del documento no es válida.');
   if(tab)tab.location.href=url.href;else location.href=url.href;
  }catch(error){tab?.close();alert(error.message);}
 }
 function documentsHtml(docs){
  return `<div class="list">${docs.map((d,i)=>`<div class="row line"><div><div class="title">${esc(label(d.kind||d.document_type))} · ${esc(d.document_number||d.file_name||'Documento')}</div><div class="subtext">${esc(d.file_name||'')} · ${esc(display('document_date',d.document_date||d.created_at))}</div></div><button type="button" class="btn sm soft" data-readonly-file="${i}">Abrir archivo</button></div>`).join('')||'<div class="empty">Todavía no se adjuntaron archivos.</div>'}</div>`;
 }
 function bindFiles(docs,bucket){$$('[data-readonly-file]').forEach(b=>b.onclick=()=>openFile(bucket,docs[Number(b.dataset.readonlyFile)].file_path));}
 async function openRecord(row){
  if(!viewer()||!row)return;
  const table=source()[0],owner=profile.id,epoch=++S.detailEpoch;
  openModal(title(row),C[S.section].title+' · Solo lectura','<div class="empty">Consultando detalle…</div>');
  try{
   let html='',files=[],bucket='';
   if(table==='v_purchase_overview'){
    const [purchase,items,receipts,docs,events]=await Promise.all([read('purchases','*',`id=eq.${row.id}`),read('purchase_items','*',`purchase_id=eq.${row.id}&order=created_at.asc`),read('purchase_receipts','*,purchase_receipt_items(*)',`purchase_id=eq.${row.id}&order=received_at.desc`),read('purchase_documents','*',`purchase_id=eq.${row.id}&order=created_at.desc`),read('audit_events','*',`purchase_id=eq.${row.id}&order=created_at.desc`)]);
    files=docs;bucket='purchase-documents';
    html=`<div class="readonly-purchase-summary"><h3>${esc(row.supplier_name||'Proveedor pendiente')}</h3><strong>${money(row.total_amount,row.currency)}</strong><p>${esc(row.company_name||'')} · ${esc(label(row.status))}</p></div><div class="notice">Factura: <b>${esc(row.invoice_number||'Pendiente')}</b> · OC: <b>${esc(row.po_number||'Sin emitir')}</b></div>
     <h3>Presupuestos, facturas, OC y remitos</h3>${documentsHtml(docs)}<details open class="readonly-detail"><summary>Datos de la compra</summary>${detailHtml(purchase[0]||row)}</details><details open class="readonly-detail"><summary>Ítems (${items.length})</summary>${detailHtml(items)}</details><details class="readonly-detail"><summary>Recepciones (${receipts.length})</summary>${detailHtml(receipts)}</details><details class="readonly-detail"><summary>Historial (${events.length})</summary>${detailHtml(events)}</details>`;
   }else{
    html=detailHtml(row);
    if(table==='movements'&&row.document_id){files=await read('documents','*',`id=eq.${row.document_id}`);bucket='inventory-documents';}
    if(table==='fabrication_orders'){
     const [materials,logs,quality,attachments]=await Promise.all(['fabrication_materials','fabrication_logs','fabrication_quality_checks','fabrication_attachments'].map(t=>read(t,'*',`order_id=eq.${row.id}`)));
     html+=`<h3>Materiales</h3>${detailHtml(materials)}<h3>Avances</h3>${detailHtml(logs)}<h3>Calidad</h3>${detailHtml(quality)}`;files=attachments;bucket='fabrication-documents';
    }
    if(table==='fabrication_attachments'){files=[row];bucket='fabrication-documents';}
    if(table==='work_orders'&&row.source_file_path){files=[{file_path:row.source_file_path,file_name:'Archivo de origen',kind:'other'}];bucket='work-order-documents';}
    if(table==='suppliers'){
     const purchases=S.purchases.filter(p=>p.supplier_id===row.id);
     html+=`<h3>Compras (${purchases.length})</h3><div class="list">${purchases.map((p,i)=>`<div class="row line"><div>${esc(title(p))} · ${money(p.total_amount,p.currency)}</div><button class="btn sm soft" type="button" data-readonly-related="${i}">Ver compra</button></div>`).join('')||'<div class="empty">Sin compras registradas.</div>'}</div>`;
    }
    if(files.length)html=`<h3>Documentos</h3>${documentsHtml(files)}`+html;
   }
   if(profile?.id!==owner||epoch!==S.detailEpoch||!viewer()||$('#modal').classList.contains('hide'))return;
   $('#modalBody').innerHTML=html;bindFiles(files,bucket);
   $$('[data-readonly-related]').forEach(b=>b.onclick=async()=>{const p=S.purchases.filter(p=>p.supplier_id===row.id)[Number(b.dataset.readonlyRelated)];S.section='purchases';S.source='v_purchase_overview';await openRecord(p);});
  }catch(error){if(profile?.id===owner&&epoch===S.detailEpoch&&!$('#modal').classList.contains('hide'))$('#modalBody').innerHTML=`<div class="error" role="alert">${esc(error.message)}</div>`;}
 }
 function exportRows(){
  const rows=filtered(),keys=[...new Set(rows.flatMap(r=>Object.keys(r)))].filter(k=>!omitted.has(k)&&!rows.some(r=>r[k]&&typeof r[k]==='object'));
  const quote=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
  const csv=[keys.map(k=>quote(names[k]||k)).join(';'),...rows.map(r=>keys.map(k=>quote(display(k,r[k]))).join(';'))].join('\r\n');
  const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='Consulta_AVH_'+S.section+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 const baseLoad=window.loadAll;
 window.loadAll=async function(force=false){
  if(!viewer())return baseLoad.apply(this,arguments);
  if(loading)return;loading=true;
  const owner=profile.id,epoch=S.epoch;
  try{
   const check=await query('profiles','id,role,active,must_change_password',`id=eq.${owner}`),current=check.data?.[0];
   if(profile?.id!==owner)return;
   if(check.error||!current?.active||current.role!=='admin_viewer'){S.rows=[];S.catalogs={};root()?.replaceChildren();await signOut();return;}
   if(current.must_change_password){profile.must_change_password=true;forcePassword();return;}
   if(S.user!==owner){Object.assign(S,{user:owner,section:'purchases',source:'v_purchase_overview',rows:[],catalogs:{},error:''});}
   const tables=['warehouses','products','product_presentations','barges','suppliers','purchase_companies','profiles'];
   const values=await Promise.all(tables.map(t=>read(t)));
   const [purchases,items,docs]=await Promise.all([read('v_purchase_overview','*','order=created_at.desc'),read('purchase_items'),read('purchase_documents','id,purchase_id,kind,document_number,file_name,created_at')]);
   if(profile?.id!==owner||!viewer())return;
   tables.forEach((t,i)=>S.catalogs[t]=values[i]);Object.assign(S,{purchases,items,documents:docs});
   D.warehouses=S.catalogs.warehouses;D.products=S.catalogs.products;D.suppliers=S.catalogs.suppliers;D.profiles=S.catalogs.profiles;
   if(epoch===S.epoch)await loadRows(epoch);
   updateSyncState(S.error?[{key:'readonly',error:S.error}]:[]);
  }catch(error){if(profile?.id===owner){S.error=error.message;updateSyncState([{key:'readonly',error:S.error}]);render();}}
  finally{loading=false;}
 };
 const baseGo=window.goPage;
 window.goPage=function(page){if(!viewer())return baseGo.apply(this,arguments);const mapping={home:'purchases',stock:'inventory','work-orders':'workorders',more:'catalogs'};return openSection(mapping[page]||page||'purchases');};
 const searchButton=$('#globalSearchBtn');if(searchButton)searchButton.addEventListener('click',event=>{if(!viewer())return;event.preventDefault();event.stopImmediatePropagation();$('#readonlySearch')?.focus();},true);
 document.addEventListener('keydown',event=>{if(viewer()&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();event.stopImmediatePropagation();$('#readonlySearch')?.focus();}},true);
 window.AVHReadonly={state:S,open:openSection,refresh:()=>loadAll(true)};
})();
