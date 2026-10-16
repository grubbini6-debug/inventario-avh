// Quotes for Production. Only Administration can create or view purchase orders.
(function(){
 const M=AVHCommercialModel,T=AVHQuoteTheme,C={user:null,context:null,documents:[],current:null,dirty:false,busy:false,error:'',kind:'quote',epoch:0,colorEpoch:0,logoEpoch:0,excel:null};
 const labels={draft:'Borrador',submitted:'Pendiente de autorización',issued:'Emitido',cancelled:'Anulado'},e=esc;
 const allowed=()=>C.user===profile?.id&&['admin','editor'].includes(C.context?.access_level);
 const admin=()=>profile?.role==='admin'&&C.context?.access_level==='admin',editable=()=>C.current?.status==='draft'&&allowed();
 const root=()=>$('#commercialPanel'),payload=()=>C.current?.payload;
 const money=v=>v==null?'Por definir':Number(v).toLocaleString('es-PY',{minimumFractionDigits:payload()?.currency==='USD'?2:0,maximumFractionDigits:payload()?.currency==='USD'?2:0});
 function navigation(){$$('.commercial-nav').forEach(b=>{b.classList.toggle('hide',!allowed());b.style.display=allowed()?'':'none';const label=b.querySelector('span');if(label)label.textContent=admin()?'Presupuestos y OC':'Presupuestos';});document.body.classList.toggle('commercial-authorized',allowed());}
 function error(err){C.error=err?.message||String(err);const el=$('#commercialError');if(el)el.textContent=C.error;}
 async function run(fn,button){if(C.busy)return;const owner=profile?.id;C.busy=true;if(button)button.disabled=true;error('');try{await fn();}catch(err){if(profile?.id===owner)error(err);}finally{if(profile?.id===owner){C.busy=false;if(button?.isConnected)button.disabled=false;}}}
 async function context(){
  const owner=profile?.id;if(C.user!==owner){globalThis.AVHQuoteFiles?.release(C.excel);Object.assign(C,{user:owner,context:null,documents:[],current:null,dirty:false,error:'',busy:false,excel:null});C.epoch++;}
  if(!['admin','production'].includes(profile?.role)){C.context=null;navigation();return;}
  const r=await rpc('commercial_context');if(profile?.id!==owner)return;
  C.context=r.error?null:r.data;if(!admin()&&C.kind==='purchase_order'){C.kind='quote';C.current=null;C.dirty=false;}if(!allowed()){C.current=null;C.documents=[];C.dirty=false;}navigation();
 }
 async function documents(){const owner=profile?.id,r=await queryAll('commercial_documents','id,kind,number,status,version,created_at,updated_at,title:payload->>title,recipient_name:payload->>recipient_name,reference:payload->>reference','order=created_at.desc');if(profile?.id!==owner)return;if(r.error)throw Error(r.error);C.documents=r.data;}
 async function command(action,data){
  const owner=profile?.id,key='avh_commercial_request:'+owner+':'+action+':'+JSON.stringify(canonicalOperationValue(data));let id;try{id=localStorage.getItem(key)}catch{}id=id||crypto.randomUUID();try{localStorage.setItem(key,id)}catch{}
  const r=await rpc('commercial_command',{p_action:action,p_data:data,p_request_id:id});
  if(!r.network&&r.status!==408&&r.status!==429&&!(r.status>=500))try{localStorage.removeItem(key)}catch{}
  if(profile?.id!==owner)throw Error('La sesión cambió. Volvé a abrir Documentos.');if(r.error)throw Error(r.error);return r.data;
 }
 async function open(id){
  if(C.dirty)throw Error('Guardá el borrador antes de abrir otro documento.');const owner=profile?.id,epoch=++C.epoch,r=await rpc('commercial_document',{p_id:id});if(profile?.id!==owner||epoch!==C.epoch)return;if(r.error)throw Error(r.error);const d=r.data;if(!d.payload.company)d.payload.company={...structuredClone(d.company||C.context.company),brand_avh:true};let changed=false;
  if(d.kind==='quote'){
   const c=d.payload.company;let prepared;if(c.brand_avh===false&&c.logo_data_url)try{prepared=await T.prepare(c.logo_data_url);}catch{}
   if(d.status==='draft'){
    if(prepared&&prepared.data_url!==c.logo_data_url){c.logo_data_url=prepared.data_url;changed=true;}
    if(c.brand_color_mode!=='manual'&&(!T.normalize(c.brand_color)||changed)){const color=prepared?.color||await automaticColor(c);if(color){c.brand_color=color;c.brand_color_mode='auto';changed=true;}}
   }else if(prepared)d.brandingPreview={...c,logo_data_url:prepared.data_url,brand_color:c.brand_color_mode!=='manual'&&prepared.removedRules?prepared.color:c.brand_color};
  }
  if(profile?.id!==owner||epoch!==C.epoch||C.dirty)return;C.current=d;C.dirty=changed;C.kind=d.kind;render();
 }
 function newDraft(kind,order){
  if(kind==='purchase_order'&&!admin())throw Error('Solo Administración puede crear órdenes de compra.');if(C.dirty)throw Error('Guardá el borrador antes de crear otro documento.');
  C.kind=kind;C.current={id:crypto.randomUUID(),kind,status:'draft',version:null,work_order_id:order?.id||null,payload:M.draft(kind,order,profile)};C.current.payload.company={...structuredClone(C.context.company),brand_avh:true,...(kind==='quote'?{brand_color:T.fallback({brand_avh:true}),brand_color_mode:'auto'}:{})};C.dirty=true;render();
 }
 async function editPurchaseOrder(id){
  if(profile?.role!=='admin')throw Error('Solo Administración puede modificar órdenes de compra.');
  if(C.dirty)throw Error('Guardá los cambios antes de abrir otra orden.');
  const owner=profile.id;await context();if(!admin())throw Error('Solo Administración puede modificar órdenes de compra.');
  const epoch=++C.epoch,r=await rpc('admin_purchase_order_document',{p_purchase_id:id});if(profile?.id!==owner||epoch!==C.epoch)return;if(r.error)throw Error(r.error);
  C.current=r.data;C.kind='purchase_order';C.dirty=false;closeModal();goPage('commercial');render();
 }
 function importPanel(){
  if(C.kind!=='quote')return '';
  const x=C.excel;
  return `<div class="card wo-import cd-import"><div><h3>Crear presupuesto desde archivos</h3><p>Subí un Excel/CSV, un PDF o varias fotos del mismo presupuesto. Revisá los trabajos, precios, la empresa emisora y su logo.</p></div><label class="btn" for="cdExcelFile">Seleccionar archivos</label><input class="wo-file" id="cdExcelFile" type="file" accept=".xlsx,.xls,.csv,.tsv,.pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp" multiple><label class="btn" for="cdCameraFile">Tomar / agregar foto</label><input class="wo-file" id="cdCameraFile" type="file" accept="image/jpeg,image/png,image/webp" capture="environment"><select id="cdExcelSheet" aria-label="Hoja del presupuesto" ${x?.book?'':'disabled hidden'}>${x?.book?x.book.SheetNames.map(name=>`<option ${name===x.sheet?'selected':''}>${e(name)}</option>`).join(''):'<option>Elegir hoja</option>'}</select><button class="btn primary" id="cdExcelAnalyze" type="button" ${x?'':'disabled'}>Preparar presupuesto</button><span id="cdExcelStatus" class="hint" role="status">${e(x?.file.name||'Excel/CSV: un archivo de hasta 10 MB · PDF/fotos: hasta 6 archivos, 12 MB y 20 páginas en total')}</span></div>`;
 }
 function importSummary(){
  const info=C.current?.importInfo;if(!info)return '';
  return `<div class="card cd-import-summary"><strong>Presupuesto preparado desde ${info.source.kind==='documents'?'PDF / fotos':'Excel / CSV'}</strong><p>${e(info.source.file_name)}${info.source.sheet?' · '+e(info.source.sheet):''} · ${info.source.items_count} trabajos</p>${info.source.source_total!=null?`<p>Total indicado en el original: <b>${e(payload().currency)} ${e(money(info.source.source_total))}</b></p>`:''}${info.warnings.length?`<div class="wo-review"><strong>Revisá estos datos antes de emitir</strong>${info.warnings.map(value=>`<p>${e(value)}</p>`).join('')}</div>`:''}<p class="hint">Los datos del cliente, la vigencia y las condiciones quedan editables. Guardá y usá Vista previa PDF para revisar el documento.</p></div>`;
 }
 function hasUnsavedWork(){
  if(!C.dirty||!payload())return false;const p=payload();return !!(C.current.version||p.items.some(i=>i.description.trim()||i.quantity!=null||i.unit_price!=null)||p.recipient_name||p.reference||p.notes||p.payment_terms||p.delivery_terms||p.valid_until||p.recipient_tax_id||p.recipient_address||p.introduction||p.company?.brand_avh===false||p.company?.brand_color_mode==='manual'||['legal_name','tax_id','address','phone','email'].some(k=>String(p.company?.[k]||'')!==String(C.context.company?.[k]||''))||p.title!=='Presupuesto de trabajos');
 }
 async function readQuoteFiles(selected,append=false){
  let files=Array.from(selected||[]);if(!files.length)return;if(!allowed())throw Error('No autorizado para preparar presupuestos.');if(hasUnsavedWork())throw Error('Guardá los cambios del documento antes de importar otros archivos.');if(append&&C.excel?.mode==='documents'&&!C.excel.prepared)files=[...C.excel.files.map(f=>f.original),...files];
  if(files.some(f=>AVHQuoteFiles.kind(f)==='excel')){if(files.length!==1)throw Error('Subí un Excel por vez, o varias fotos/PDF del mismo presupuesto.');return readQuoteExcel(files[0]);}
  const owner=profile.id,epoch=++C.epoch,next=await AVHQuoteFiles.readDocuments(files);if(profile?.id!==owner||epoch!==C.epoch){AVHQuoteFiles.release(next);return;}
  if(hasUnsavedWork()){AVHQuoteFiles.release(next);throw Error('Hay cambios sin guardar. Guardalos antes de seleccionar otros archivos.');}
  AVHQuoteFiles.release(C.excel);if(C.current)delete C.current.importFiles;C.excel={...next,file:{name:files.map(f=>f.name).join(' + ')}};C.kind='quote';render();
 }
 async function readQuoteExcel(file){
  if(!file)return;if(!allowed())throw Error('No autorizado para preparar presupuestos.');if(hasUnsavedWork())throw Error('Guardá los cambios del documento antes de importar otro Excel.');
  if(!/\.(xlsx|xls|csv|tsv)$/i.test(file.name)||file.size>10*1024*1024)throw Error('Subí un Excel .xlsx/.xls o CSV de hasta 10 MB.');
  const owner=profile.id,epoch=++C.epoch,X=await excelReader(),bytes=await file.arrayBuffer();let input=bytes,type='array';if(/\.(csv|tsv)$/i.test(file.name)){try{input=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{input=new TextDecoder('windows-1252').decode(bytes);}type='string';}const book=X.read(input,{type,cellDates:false,sheetRows:1201,bookFiles:true});
  if(profile?.id!==owner||epoch!==C.epoch)return;if(!book.SheetNames.length)throw Error('El Excel no tiene hojas.');
  if(hasUnsavedWork())throw Error('Hay cambios sin guardar. Guardalos antes de seleccionar otro archivo.');globalThis.AVHQuoteFiles?.release(C.excel);if(C.current)delete C.current.importFiles;C.excel={mode:'excel',file,book,sheet:book.SheetNames[0],bytes};C.kind='quote';render();
 }
 let excelLoading;
 async function excelReader(){
  if(window.XLSX)return window.XLSX;
  if(!excelLoading)excelLoading=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='assets/xlsx-0.20.3.min.js';script.onload=()=>resolve(window.XLSX);script.onerror=()=>{excelLoading=null;reject(Error('No se pudo cargar el lector de Excel.'));};document.head.appendChild(script);});return excelLoading;
 }
 async function prepareQuoteExcel(){
  if(!allowed())throw Error('No autorizado para preparar presupuestos.');if(hasUnsavedWork())throw Error('Guardá los cambios del documento antes de preparar otro presupuesto.');
  const x=C.excel;if(!x)throw Error('Seleccioná un archivo.');if(x.mode==='documents')return prepareQuoteDocuments(x);const owner=profile.id,sheet=x.sheet,epoch=++C.epoch,X=await excelReader(),ws=x.book.Sheets[sheet],range=X.utils.decode_range(ws['!fullref']||ws['!ref']||'A1');
  if(range.e.r>=1200||range.e.c>=60)throw Error('La hoja supera 1.200 filas o 60 columnas. Dividila antes de importar.');
  const rows=X.utils.sheet_to_json(ws,{header:1,defval:null,blankrows:true,raw:true,range:0}),status=$('#cdExcelStatus');if(status)status.textContent='Leyendo los trabajos y precios del Excel…';
  const response=await edge('quote-excel-ai',{file_name:x.file.name,sheet,rows});
  if(profile?.id!==owner||epoch!==C.epoch||C.excel!==x||x.sheet!==sheet)return;if(response.error)throw Error(response.error);
  if(hasUnsavedWork())throw Error('Hay cambios sin guardar. Guardalos antes de volver a preparar el presupuesto.');
  const a=response.data?.analysis;if(!a?.items?.length)throw Error('No encontré trabajos con precios en esta hoja.');
  const logos=AVHCompanyLogo.fromWorkbook(x.book,sheet),warnings=[];
  if(Object.values(ws).some(cell=>cell&&typeof cell==='object'&&(cell.f&&cell.v==null||cell.t==='e')))warnings.push('Hay fórmulas sin resultado guardado o con error. Revisá los precios y guardá el archivo en Excel para actualizar sus cálculos.');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',x.bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
  if(profile?.id!==owner||epoch!==C.epoch||C.excel!==x||x.sheet!==sheet)return;if(hasUnsavedWork())throw Error('Hay cambios sin guardar. Guardalos antes de preparar otro presupuesto.');
  await installImportedDraft(a,{kind:'excel',file_name:x.file.name,sheet,sha256:hash,rows_count:rows.length,items_count:a.items.length,mapping:a.mapping,source_total:a.source_total,source_rows:rows},{...logos,warnings:[...logos.warnings,...warnings]});
 }
 async function prepareQuoteDocuments(x){
  const owner=profile.id,epoch=++C.epoch,status=$('#cdExcelStatus');if(status)status.textContent='Leyendo los trabajos, precios y empresa del PDF o las fotos…';
  const response=await edge('quote-document-ai',{files:x.files.map(f=>({file_name:f.name,file_data:f.data_url}))});if(profile?.id!==owner||epoch!==C.epoch||C.excel!==x)return;if(response.error)throw Error(response.error);
  const a=response.data?.analysis;if(!a?.items?.length)throw Error('No encontré trabajos legibles en estos archivos.');const logos={images:[],warnings:[]};
  if(a.logo_region){try{logos.images.push({name:'Logo leído del original',data_url:await AVHQuoteFiles.crop(x,a.logo_region)});logos.warnings.push('Revisá el recorte del logo del emisor. Podés ajustarlo con Recortar logo del original.');}catch{logos.warnings.push('No se pudo recortar el logo automáticamente. Usá Recortar logo del original o adjuntalo por separado.');}}
  if(profile?.id!==owner||epoch!==C.epoch||C.excel!==x)return;if(hasUnsavedWork())throw Error('Hay cambios sin guardar. Guardalos antes de preparar otro presupuesto.');
  await installImportedDraft(a,{kind:'documents',file_name:x.file.name,files:x.files.map(f=>({file_name:f.name,mime_type:f.mime_type,size:f.size,sha256:f.sha256,pages:f.pages})),items_count:a.items.length,source_total:a.source_total,reading:a.reading},logos,x);
 }
 async function installImportedDraft(a,source,logos,files){
  const owner=profile.id,epoch=C.epoch;
  const p=M.draft('quote',null,profile);for(const k of ['title','document_date','valid_until','delivery_date','recipient_name','recipient_tax_id','recipient_address','recipient_contact','location','reference','payment_terms','delivery_terms','introduction','notes'])if(a.fields?.[k])p[k]=a.fields[k];
  p.currency=a.currency||'PYG';p.tax_mode=a.tax_mode||'included';p.tax_rate=a.tax_rate??0;p.items=a.items.map(i=>({id:crypto.randomUUID(),description:i.description,quantity:i.quantity,unit:i.unit,unit_price:i.unit_price}));const warnings=[...(a.warnings||[]),...logos.warnings];
  p.company={brand_avh:false,legal_name:'',tax_id:'',address:'',phone:'',email:'',...(a.company||{}),logo_data_url:logos.images.length===1?logos.images[0].data_url:''};
  p.company.logo_data_url=await cleanLogo(p.company.logo_data_url);delete p.company.brand_color;const color=await automaticColor(p.company);p.company.brand_color_mode='auto';if(color)p.company.brand_color=color;
  if(profile?.id!==owner||epoch!==C.epoch)return;if(hasUnsavedWork())throw Error('Hay cambios sin guardar. Guardalos antes de preparar otro presupuesto.');if(files)files.prepared=true;
  if(!p.company.legal_name||!p.company.tax_id)warnings.push('Completá o confirmá la razón social y el RUC de la empresa emisora.');
  if(logos.images.length>1)warnings.push('La hoja contiene varias imágenes. Elegí cuál es el logo de la empresa emisora.');
  if(!logos.images.length)warnings.push('No se encontró un logo automático. Podés '+(files?'recortarlo del original o ':'')+'adjuntarlo en PNG/JPG. El presupuesto no usará el logo AVH automáticamente.');
  C.current={id:crypto.randomUUID(),kind:'quote',status:'draft',version:null,payload:p,importLogos:logos.images,importFiles:files,importInfo:{source,warnings,archived:false}};C.dirty=true;C.kind='quote';render();
 }
 function field(key,label,type='text',attrs=''){return `<div class="field"><label for="cd-${key}">${e(label)}</label><input id="cd-${key}" data-cd-header="${key}" type="${type}" value="${e(payload()[key]??'')}" ${editable()?'':'disabled'} ${attrs}></div>`;}
 function area(key,label){return `<div class="field"><label for="cd-${key}">${e(label)}</label><textarea id="cd-${key}" data-cd-header="${key}" ${editable()?'':'disabled'}>${e(payload()[key]||'')}</textarea></div>`;}
 async function automaticColor(company){
  if(company.brand_avh!==false)return T.fallback(company);if(!company.logo_data_url)return null;try{return await T.detect(company.logo_data_url);}catch{return null;}
 }
 async function cleanLogo(url){if(!url)return '';try{return(await T.prepare(url)).data_url;}catch{return url;}}
 function brandTheme(){const c=C.current.brandingPreview||payload().company||{};return T.colors(T.normalize(c.brand_color)||T.fallback(c));}
 function brandMessage(){const c=payload().company||{};return c.brand_color_mode==='manual'?'Color personalizado.':c.brand_avh!==false?'Color institucional AVH.':T.normalize(c.brand_color)?'Color tomado del logo.':c.logo_data_url?'Elegí un color si no se pudo detectar el del logo.':'Adjuntá el logo para tomar sus colores o elegí un color.';}
 function themeFields(){
  const c=payload().company||{},t=brandTheme();
  return `<div class="cd-brand"><div class="cd-brand-settings"><div class="field"><label for="cdBrandColor">Color del presupuesto</label><input id="cdBrandColor" type="color" value="${t.primary}" ${editable()?'':'disabled'}></div>${editable()?`<button class="btn" id="cdBrandAuto" type="button" ${c.brand_avh===false&&!c.logo_data_url?'disabled':''}>${c.brand_avh===false?'Usar colores del logo':'Usar color AVH'}</button>`:''}<span class="hint" id="cdBrandMode" role="status">${e(brandMessage())}</span></div><div class="cd-brand-sample" id="cdBrandSample" style="--cd-brand:${t.primary};--cd-brand-heading:${t.heading};--cd-brand-text:${t.headerText};--cd-brand-pale:${t.pale};--cd-brand-line:${t.line}" aria-label="Muestra de los colores del presupuesto"><strong class="cd-brand-heading">PRESUPUESTO</strong><div class="cd-brand-table"><span>Detalle de trabajos</span><span>Importe</span></div><div class="cd-brand-row">Colores de la empresa emisora</div><strong class="cd-brand-total">TOTAL</strong></div><p class="hint">Usamos únicamente el logo: sin márgenes vacíos ni franjas de la tabla original. Los tonos claros se ajustan para que el texto se lea bien.</p></div>`;
 }
 function updateBrandPreview(){
  const t=brandTheme(),sample=$('#cdBrandSample');if(!sample)return;for(const [key,value] of Object.entries({brand:t.primary,'brand-heading':t.heading,'brand-text':t.headerText,'brand-pale':t.pale,'brand-line':t.line}))sample.style.setProperty('--cd-'+key,value);$('#cdBrandColor').value=t.primary;$('#cdBrandMode').textContent=brandMessage();
 }
 async function useLogoColor(){
  if(!editable()||C.current.kind!=='quote')return;const company=payload().company,owner=profile.id,id=C.current.id,logo=company.logo_data_url,epoch=++C.colorEpoch;company.brand_color_mode='auto';delete company.brand_color;C.dirty=true;updateBrandPreview();const color=await automaticColor(company);
  if(profile?.id!==owner||C.current?.id!==id||payload().company!==company||company.logo_data_url!==logo||epoch!==C.colorEpoch||!editable()||company.brand_color_mode==='manual')return;if(color)company.brand_color=color;updateBrandPreview();
 }
 async function setLogo(url){
  if(!editable()||C.current.kind!=='quote'||payload().company?.brand_avh!==false)return;const owner=profile.id,id=C.current.id,company=payload().company,epoch=++C.logoEpoch,colorEpoch=C.colorEpoch,clean=await cleanLogo(url);
  if(profile?.id!==owner||C.current?.id!==id||payload().company!==company||epoch!==C.logoEpoch||!editable())return;company.logo_data_url=clean;const auto=colorEpoch===C.colorEpoch;if(auto){delete company.brand_color;company.brand_color_mode='auto';}C.dirty=true;render();if(auto)await useLogoColor();
 }
 function companyFields(){
  const c=payload().company||{},quote=C.current.kind==='quote',custom=c.brand_avh===false,logos=C.current.importLogos||[];let logo='';
  if(custom&&(C.current.brandingPreview||c).logo_data_url)try{logo=(C.current.brandingPreview||c).logo_data_url;AVHCompanyLogo.read(logo);}catch{logo='';}
  const selector=quote?`<div class="field"><label for="cd-company_brand">Empresa que emite el presupuesto</label><select id="cd-company_brand" ${editable()?'':'disabled'}><option value="custom" ${custom?'selected':''}>Empresa del archivo / otra empresa</option><option value="avh" ${custom?'':'selected'}>Astillero Villa Hayes</option></select></div>`:`<div class="field"><label for="cd-company_id">Empresa del catálogo</label><select id="cd-company_id" ${editable()?'':'disabled'}>${(C.context.companies||[C.context.company]).filter(Boolean).map(x=>`<option value="${e(x.id)}" ${c.id===x.id?'selected':''}>${e(x.name)}</option>`).join('')}</select></div>`;
  return `<div class="card"><h3>Empresa emisora</h3>${quote?'<p class="hint">Estos datos y el logo identifican a quien presenta el presupuesto. El cliente se completa por separado.</p>':''}${selector}<div class="wo-grid">${[['legal_name','Razón social'],['tax_id','RUC'],['address','Dirección'],['phone','Teléfono'],['email','Correo']].map(([key,label])=>`<div class="field"><label for="cd-company-${key}">${label}</label><input id="cd-company-${key}" data-cd-company="${key}" value="${e(c[key]||'')}" ${editable()?'':'disabled'}></div>`).join('')}</div>${quote&&custom?`<div class="cd-company-logo">${logo?`<img class="cd-logo-preview" src="${e(logo)}" alt="Logo de la empresa emisora">`:'<p class="hint">Presupuesto sin logo. Podés adjuntar el de la empresa emisora.</p>'}${editable()?`${logos.length?`<div class="field"><label for="cdLogoCandidate">Imágenes encontradas en la hoja</label><select id="cdLogoCandidate"><option value="">Sin logo / logo adjunto</option>${logos.map((l,i)=>`<option value="${i}" ${l.data_url===logo?'selected':''}>${e(l.name)}</option>`).join('')}</select></div>`:''}<label class="btn" for="cdLogoFile">Adjuntar o cambiar logo</label><input class="wo-file" id="cdLogoFile" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg">${logo?'<button class="btn" id="cdRemoveLogo" type="button">Quitar logo</button>':''}${C.current.importFiles?'<button class="btn" id="cdCropLogo" type="button">Recortar logo del original</button>':''}<p class="hint">PNG o JPG · hasta 300 KB · máximo 2 megapíxeles.</p>`:''}</div>`:''}${quote?themeFields():''}</div>`;
 }
 async function attachLogo(file){
  if(!file)return;if(!editable()||C.current.kind!=='quote'||payload().company?.brand_avh!==false)throw Error('Elegí la empresa emisora del archivo para adjuntar su logo.');
  if(file.size>300*1024)throw Error('El logo supera 300 KB. Usá una imagen más pequeña.');
  const owner=profile.id,id=C.current.id,epoch=++C.epoch,bytes=new Uint8Array(await file.arrayBuffer()),mime=bytes[0]===137?'image/png':'image/jpeg',url=AVHCompanyLogo.encode(bytes,mime);AVHCompanyLogo.read(url);
  if(profile?.id!==owner||C.current?.id!==id||epoch!==C.epoch||!editable())return;await setLogo(url);
 }
 function inventoryFields(item){
  if(!C.current.purchase_editor)return '';
  return `<div class="wo-grid"><div class="field"><label>Producto de inventario</label><select data-cd-line="product_id" ${editable()?'':'disabled'}><option value="">Sin producto de catálogo</option>${(window.D?.products||D.products||[]).filter(x=>x.active||x.id===item.product_id).map(x=>`<option value="${e(x.id)}" ${x.id===item.product_id?'selected':''}>${e(x.name)}</option>`).join('')}</select></div><div class="field"><label>Conversión a unidad base</label><input data-cd-line="factor_to_base" type="number" min="0.000001" step="0.000001" value="${e(item.factor_to_base||1)}" ${editable()?'':'disabled'}></div><div class="field"><label><input data-cd-line="affects_inventory" type="checkbox" ${item.affects_inventory?'checked':''} ${editable()?'':'disabled'}> Ingresa a stock</label></div></div>`;
 }
 function list(){
  const host=$('#cdList');if(!host)return;const q=($('#cdSearch')?.value||'').toLowerCase(),state=$('#cdFilter')?.value||'all';
  host.innerHTML=C.documents.filter(d=>d.kind===C.kind&&(admin()||d.kind==='quote')&&(state==='all'||d.status===state)&&[d.number,d.title,d.recipient_name,d.reference].join(' ').toLowerCase().includes(q)).map(d=>`<button class="wo-order ${d.id===C.current?.id?'selected':''}" data-cd-open="${d.id}" type="button"><span class="badge">${e(labels[d.status])}</span><strong>${e(d.number||'Borrador sin emitir')}</strong><span>${e(d.recipient_name||d.title)}</span><small>${e(d.reference||'')}</small></button>`).join('')||'<div class="empty">No hay documentos para este filtro.</div>';
  $$('[data-cd-open]').forEach(b=>b.onclick=()=>run(()=>open(b.dataset.cdOpen),b));
 }
 function lines(){
  return payload().items.map((item,i)=>`<div class="cd-item" data-cd-item="${i}"><div class="cd-item-title"><strong>Ítem ${i+1}</strong>${editable()?`<button class="btn sm" data-cd-remove="${i}" type="button">Quitar</button>`:''}</div><div class="field"><label>Descripción técnica / alcance</label><textarea data-cd-line="description" ${editable()?'':'disabled'}>${e(item.description)}</textarea></div>${inventoryFields(item)}<div class="cd-line-fields">${[['quantity','Cantidad','number'],['unit','Unidad','text'],['unit_price','Precio unitario','number']].map(([k,label,type])=>`<div class="field"><label>${label}</label><input data-cd-line="${k}" type="${type}" value="${e(item[k]??'')}" ${editable()?'':'disabled'} ${type==='number'?'step="0.000001" min="0" placeholder="Por definir"':''}></div>`).join('')}<div class="field"><label>Importe ${e(payload().currency)}</label><output data-cd-amount="${i}"></output></div></div></div>`).join('');
 }
 function documentView(){
  if(!C.current)return '<div class="card empty">'+(admin()?'Elegí un documento o creá un presupuesto o una orden de compra.':'Elegí un presupuesto o creá uno nuevo.')+'</div>';
  const d=C.current,p=payload(),quote=d.kind==='quote';
  return `<div class="wo-document-head"><div><span class="badge">${e(d.purchase_editor?'Revisar OC antes del PDF':labels[d.status]||d.status)}</span><h2>${e(d.number||'Nuevo '+(quote?'presupuesto':'borrador de OC'))}</h2><p>${e(p.reference||'Documento comercial AVH')}</p></div><div class="wo-actions">${editable()?'<button class="btn" id="cdSave" type="button">'+(d.purchase_editor?'Guardar cambios':'Guardar borrador')+'</button>'+(!d.purchase_editor?'<button class="btn" id="cdAi" type="button">Mejorar redacción con IA</button>':''):''}<button class="btn" id="cdPdf" type="button">${d.number?'Descargar PDF para enviar':'Vista previa PDF'}</button>${editable()&&quote?'<button class="btn primary" id="cdIssue" type="button">Emitir presupuesto numerado</button>':''}${admin()&&!quote&&!d.purchase_editor&&['draft','submitted'].includes(d.status)?'<button class="btn primary" id="cdApprove" type="button">Emitir OC numerada</button>':''}${admin()&&d.status==='submitted'?'<button class="btn" id="cdReturn" type="button">Devolver a revisión</button>':''}${!d.purchase_editor&&!['cancelled'].includes(d.status)&&!(d.kind==='purchase_order'&&d.status==='issued')?'<button class="btn" id="cdCancel" type="button">Anular</button>':''}</div></div>
   ${d.review_note?`<div class="wo-review">${e(d.review_note)}</div>`:''}${d.status==='submitted'?'<div class="cd-status">OC enviada a Administración. El PDF definitivo estará disponible cuando sea autorizada.</div>':''}${d.purchase_id?'<p class="hint">OC registrada también en Compras. '+(admin()?'<button class="btn sm" id="cdPurchase" type="button">Ver compra</button>':'')+'</p>':''}
   ${importSummary()}<div class="card"><h3>Datos del documento</h3><div class="wo-grid">${!quote&&admin()?field('document_number','Número de OC (automático si se deja vacío)'):''}${field('title','Título')}${field('document_date','Fecha','date')}${field('reference','OT / proyecto / referencia')}${field('location','Lugar')}${field('issuer_name','Preparado por')}${quote?field('valid_until','Válido hasta','date'):field('delivery_date','Entrega prevista','date')}</div></div>
   ${quote||admin()?companyFields():''}<div class="card"><h3>${quote?'Cliente / destinatario':'Proveedor'}</h3>${!quote?`<div class="field"><label for="cd-supplier_id">Proveedor del catálogo</label><select id="cd-supplier_id" ${editable()?'':'disabled'}><option value="">Seleccionar proveedor</option>${(C.context.suppliers||[]).map(s=>`<option value="${s.id}" ${p.supplier_id===s.id?'selected':''}>${e(s.name)}</option>`).join('')}</select><p class="hint">Administración puede registrar proveedores nuevos desde Proveedores.</p></div>`:''}<div class="wo-grid">${field('recipient_name',quote?'Razón social / nombre':'Razón social del proveedor')}${field('recipient_tax_id','RUC / identificación')}${field('recipient_contact','Contacto')}${field('recipient_address','Dirección')}</div>${area('introduction','Presentación / alcance para el destinatario')}</div>
   <div class="card"><h3>Importes</h3><div class="wo-grid"><div class="field"><label for="cd-currency">Moneda</label><select id="cd-currency" data-cd-header="currency" ${editable()?'':'disabled'}><option value="PYG" ${p.currency==='PYG'?'selected':''}>Guaraníes (PYG)</option><option value="USD" ${p.currency==='USD'?'selected':''}>Dólares (USD)</option></select></div><div class="field"><label for="cd-tax_mode">Tratamiento del IVA</label><select id="cd-tax_mode" data-cd-header="tax_mode" ${editable()?'':'disabled'}>${!quote?'<option value="unspecified" '+(p.tax_mode==='unspecified'?'selected':'')+'>Según presupuesto de referencia</option>':''}<option value="included" ${p.tax_mode==='included'?'selected':''}>IVA incluido en los precios</option><option value="add" ${p.tax_mode==='add'?'selected':''}>Agregar IVA al subtotal</option><option value="none" ${p.tax_mode==='none'?'selected':''}>Sin IVA</option></select></div>${field('tax_rate','IVA (%)','number','min="0" max="100" step="0.000001"')}</div><p class="hint">Confirmá precios, cantidades e impuestos antes de emitir. Los campos sin precio quedan pendientes.</p><div id="cdItems">${lines()}</div>${editable()?'<button class="btn" id="cdAdd" type="button">+ Agregar ítem</button>':''}<div class="cd-totals" id="cdTotals" aria-live="polite"></div></div>
   <div class="card"><h3>Condiciones para enviar</h3>${area('payment_terms','Condición de pago')}${area('delivery_terms','Plazo y condiciones de entrega / ejecución')}${area('notes','Observaciones visibles en el PDF')}</div>`;
 }
 function updateTotals(){
  if(!payload())return;try{const t=M.totals(payload());t.items.forEach((i,n)=>{const el=$('[data-cd-amount="'+n+'"]');if(el)el.textContent=money(i.amount);});$('#cdTotals').textContent=t.pending?'Total pendiente: completá cantidades y precios.':'Subtotal '+payload().currency+' '+money(t.subtotal)+(t.rounding_adjustment?' · Ajuste de redondeo '+money(t.rounding_adjustment):'')+(payload().tax_mode==='add'?' · IVA '+money(t.tax_amount):payload().tax_mode==='included'?' · IVA incluido '+money(t.tax_amount):payload().tax_mode==='none'?' · Sin IVA':' · Impuestos según presupuesto')+' · TOTAL '+payload().currency+' '+money(t.total);}catch{$('#cdTotals').textContent='Revisá los importes.';}
 }
 function render(){
  if(!root())return;if(!allowed()){root().innerHTML='<div class="card">Documentos comerciales requiere una cuenta de Producción habilitada o de Administración.</div>';return;}
  root().innerHTML=`<div class="wo-heading"><div><div class="eyebrow">DOCUMENTOS AVH</div><h2>${admin()?'Presupuestos y órdenes de compra':'Presupuestos'}</h2><p>Documentos numerados con membrete institucional, listos para descargar y enviar.</p></div><div class="wo-actions"><button class="btn primary" id="cdNewQuote" type="button">+ Presupuesto</button>${admin()?'<button class="btn" id="cdNewOc" type="button">+ Orden de compra</button>':''}</div></div><div id="commercialError" class="error" role="alert">${e(C.error)}</div>${importPanel()}<div class="wo-tabs"><button class="btn ${C.kind==='quote'?'primary':''}" data-cd-kind="quote">Presupuestos</button>${admin()?'<button class="btn '+(C.kind==='purchase_order'?'primary':'')+'" data-cd-kind="purchase_order">Órdenes de compra</button>':''}</div><div class="wo-layout"><aside class="wo-sidebar card"><div class="field"><label for="cdSearch">Buscar documentos</label><input id="cdSearch" type="search" placeholder="Número, cliente, proyecto"></div><select id="cdFilter" aria-label="Estado"><option value="all">Todos los estados</option>${Object.entries(labels).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select><div id="cdList"></div></aside><div class="cd-document">${documentView()}</div></div>`;
  list();$('#cdExcelFile')?.addEventListener('change',evt=>run(()=>readQuoteFiles(evt.target.files),evt.target));$('#cdCameraFile')?.addEventListener('change',evt=>run(()=>readQuoteFiles(evt.target.files,true),evt.target));$('#cdExcelSheet')?.addEventListener('change',evt=>{if(C.excel)C.excel.sheet=evt.target.value;});$('#cdExcelAnalyze')?.addEventListener('click',evt=>run(prepareQuoteExcel,evt.target));$('#cdSearch').oninput=list;$('#cdFilter').onchange=list;
  $('#cdNewQuote').onclick=()=>run(()=>newDraft('quote'));$('#cdNewOc')?.addEventListener('click',()=>run(()=>newDraft('purchase_order')));
  $$('[data-cd-kind]').forEach(b=>b.onclick=()=>{if(b.dataset.cdKind==='purchase_order'&&!admin())return;if(C.dirty)return error('Guardá el borrador antes de cambiar de apartado.');C.kind=b.dataset.cdKind;C.current=null;render();});
  $$('[data-cd-header]').forEach(el=>el.oninput=()=>{if(!editable())return;payload()[el.dataset.cdHeader]=el.type==='number'?(el.value===''?null:Number(el.value)):el.value;C.dirty=true;updateTotals();});
  $$('[data-cd-company]').forEach(el=>el.oninput=()=>{if(!editable()||!(C.current.kind==='quote'||admin()))return;payload().company[el.dataset.cdCompany]=el.value;C.dirty=true;});
  $('#cd-company_brand')?.addEventListener('change',evt=>{if(!editable()||C.current.kind!=='quote')return;const choices=C.current.companyDrafts||(C.current.companyDrafts={});choices[payload().company.brand_avh===false?'custom':'avh']=structuredClone(payload().company);payload().company=structuredClone(choices[evt.target.value]||(evt.target.value==='avh'?{...C.context.company,brand_avh:true,brand_color:T.fallback({brand_avh:true}),brand_color_mode:'auto'}:{brand_avh:false,legal_name:'',tax_id:'',address:'',phone:'',email:'',logo_data_url:''}));C.dirty=true;render();});
  $('#cdLogoFile')?.addEventListener('change',evt=>run(()=>attachLogo(evt.target.files?.[0]),evt.target));
  $('#cdLogoCandidate')?.addEventListener('change',evt=>run(()=>{const logo=evt.target.value===''?null:C.current.importLogos?.[Number(evt.target.value)];return setLogo(logo?.data_url||'');},evt.target));
  $('#cdRemoveLogo')?.addEventListener('click',evt=>run(()=>setLogo(''),evt.target));
  $('#cdBrandColor')?.addEventListener('input',evt=>{if(!editable()||C.current.kind!=='quote')return;const color=T.normalize(evt.target.value);if(!color)return;C.colorEpoch++;payload().company.brand_color=color;payload().company.brand_color_mode='manual';C.dirty=true;updateBrandPreview();});
  $('#cdBrandAuto')?.addEventListener('click',evt=>run(useLogoColor,evt.target));
  $('#cdCropLogo')?.addEventListener('click',evt=>run(async()=>{if(!editable()||!C.current.importFiles)return;const owner=profile.id,id=C.current.id,files=C.current.importFiles;await AVHQuoteFiles.showPicker(files,{openModal,closeModal,valid:()=>profile?.id===owner&&C.current?.id===id&&C.current?.importFiles===files&&editable(),onApply:url=>setLogo(url)});},evt.target));
  $('#cd-company_id')?.addEventListener('change',evt=>{if(!editable()||!admin())return;const company=(C.context.companies||[]).find(c=>c.id===evt.target.value);if(company){payload().company=structuredClone(company);C.dirty=true;render();}});
  $('#cd-supplier_id')?.addEventListener('change',evt=>{const s=C.context.suppliers.find(s=>s.id===evt.target.value);payload().supplier_id=s?.id||null;payload().recipient_name=s?.name||'';payload().recipient_tax_id=s?.tax_id||'';payload().recipient_contact=s?.phone||'';C.dirty=true;render();});
  $$('[data-cd-item]').forEach(el=>el.querySelectorAll('[data-cd-line]').forEach(input=>input.oninput=()=>{const item=payload().items[Number(el.dataset.cdItem)],k=input.dataset.cdLine;if(!editable())return;item[k]=input.type==='checkbox'?input.checked:input.type==='number'?(input.value===''?null:Number(input.value)):input.value;C.dirty=true;updateTotals();}));
  $$('[data-cd-remove]').forEach(b=>b.onclick=()=>{payload().items.splice(Number(b.dataset.cdRemove),1);C.dirty=true;render();});
  $('#cdAdd')?.addEventListener('click',()=>{payload().items.push({id:crypto.randomUUID(),description:'',unit:'unidad',quantity:null,unit_price:null});C.dirty=true;render();});
  $('#cdSave')?.addEventListener('click',evt=>run(save,evt.target));
  $('#cdPdf')?.addEventListener('click',evt=>run(async()=>{if(C.dirty||!C.current.version)await save();if(C.current.kind==='purchase_order'&&C.current.purchase_id&&!C.current.purchase_editor)return editPurchaseOrder(C.current.purchase_id);const owner=profile?.id,id=C.current.id,r=C.current.purchase_editor?await edge('purchase-order-pdf',{purchase_id:C.current.purchase_id,expected_version:C.current.version}):await edge('commercial-pdf',{document_id:id});if(profile?.id!==owner||C.current?.id!==id)return;if(r.error)throw Error(r.error);if(!r.data?.pdf_base64)throw Error('El PDF no pudo generarse.');const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(r.data.pdf_base64),c=>c.charCodeAt(0))],{type:'application/pdf'})),a=document.createElement('a');a.href=url;a.download=r.data.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);},evt.target));
  for(const [id,action] of [['#cdIssue','issue'],['#cdApprove','issue']])$(id)?.addEventListener('click',evt=>run(async()=>{if(C.dirty||!C.current.version)await save();const id=C.current.id;await open(id);if(C.current.number)return;await command(action,{document_id:id,expected_version:C.current.version});await documents();await open(id);},evt.target));
  for(const [id,action] of [['#cdCancel','cancel'],['#cdReturn','return']])$(id)?.addEventListener('click',()=>{const reason=window.prompt(action==='return'?'Motivo de devolución a revisión':'Motivo de anulación');if(reason)void run(async()=>{await command(action,{document_id:C.current.id,expected_version:C.current.version,reason});C.dirty=false;await documents();await open(C.current.id);});});
  $('#cdAi')?.addEventListener('click',evt=>run(improve,evt.target));
  $('#cdPurchase')?.addEventListener('click',()=>{if(admin())openPurchaseDetail(C.current.purchase_id);});
  $$('textarea[data-cd-header],textarea[data-cd-line]').forEach(el=>{const fit=()=>{el.style.height='auto';el.style.height=Math.max(76,el.scrollHeight+4)+'px';};el.addEventListener('input',fit);fit();});updateTotals();
 }
 async function save(){
  if(C.current.purchase_editor){
   if(!admin())throw Error('Solo Administración puede modificar órdenes de compra.');
   const owner=profile.id,data={p_purchase_id:C.current.purchase_id,p_payload:payload(),p_expected_version:C.current.version},key='avh_po_review:'+owner+':'+JSON.stringify(canonicalOperationValue(data));
   let requestId;try{requestId=localStorage.getItem(key)}catch{}requestId=requestId||crypto.randomUUID();try{localStorage.setItem(key,requestId)}catch{}
   const r=await rpc('admin_save_purchase_order_document',{...data,p_request_id:requestId});
   if(!r.network&&r.status!==408&&r.status!==429&&!(r.status>=500))try{localStorage.removeItem(key)}catch{}
   if(profile?.id!==owner)throw Error('La sesión cambió. Volvé a abrir la OC.');if(r.error)throw Error(r.error);
   C.current=r.data;C.dirty=false;await loadAll(true);render();return;
  }
  const id=C.current.id,info=C.current.importInfo,logos=C.current.importLogos,files=C.current.importFiles;await command('save',{document_id:id,kind:C.current.kind,expected_version:C.current.version,work_order_id:C.current.work_order_id,payload:payload(),...(info&&!info.archived?{[info.source.kind==='documents'?'document_source':'excel_source']:{...info.source,warnings:info.warnings}}:{})});C.dirty=false;await documents();await open(id);if(info){info.archived=true;C.current.importInfo=info;C.current.importLogos=logos;C.current.importFiles=files;render();}
 }
 async function improve(){
  if(C.dirty||!C.current.version)await save();const id=C.current.id,version=C.current.version,owner=profile?.id;
  const r=await edge('commercial-ai',{document_id:id});if(profile?.id!==owner||C.current?.id!==id||C.current?.version!==version)return;if(r.error)throw Error(r.error);
  const suggestion=r.data?.suggestion;if(!suggestion)throw Error('La IA no devolvió una propuesta.');
  openModal('Revisar redacción de IA','Las cantidades, precios, impuestos y condiciones se conservan.',`<h3>${e(suggestion.title)}</h3><p>${e(suggestion.introduction)}</p><div class="cd-ai-review">${suggestion.items.map(i=>`<p>${e(i.description)}</p>`).join('')}</div><button class="btn primary" id="cdApplyAi" type="button">Aplicar redacción</button>`);
  $('#cdApplyAi').onclick=()=>{if(C.current?.id!==id||C.current?.version!==version||profile?.id!==owner)return closeModal();payload().title=suggestion.title;payload().introduction=suggestion.introduction;const descriptions=new Map(suggestion.items.map(i=>[i.id,i.description]));payload().items.forEach(i=>{if(descriptions.has(i.id))i.description=descriptions.get(i.id);});C.dirty=true;closeModal();render();};
 }
 async function refresh(){await context();if(allowed()&&$('#page-commercial')?.classList.contains('on')&&!C.dirty&&!C.busy&&canRefreshView('#page-commercial')){await documents();if(C.current?.purchase_editor)await editPurchaseOrder(C.current.purchase_id);else if(C.current?.version)await open(C.current.id);else render();}else if(!allowed()&&$('#page-commercial')?.classList.contains('on'))render();}
 const go=window.goPage;window.goPage=function(name){if(name==='commercial'&&!allowed())return;const r=go.call(this,name);if(name==='commercial'){render();void run(async()=>{await documents();list();});}return r;};
 const load=window.loadAll;window.loadAll=async function(){const r=await load.apply(this,arguments);await refresh();return r;};
 window.AVHCommercial={state:C,refresh,editPurchaseOrder,fromWorkOrder:async(order,kind)=>{await context();if(!allowed())throw Error('Se requiere el perfil Producción o Administración.');newDraft(kind,order);goPage('commercial');}};
})();
