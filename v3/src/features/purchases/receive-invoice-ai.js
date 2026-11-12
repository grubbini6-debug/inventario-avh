// Invoice-assisted receipt. Reading a file never posts stock or confirms a service.
(function(){
  const safe=v=>esc(String(v??'')),num=v=>window.AVHReceiving.number(v);
  const items=id=>(D.purchaseItems||[]).filter(x=>x.purchase_id===id);
  const pending=x=>Math.max(0,Number(x.quantity||0)-Number(x.received_qty||0)-Number(x.cancelled_qty||0));
  const receipts=id=>(D.purchaseReceipts||[]).filter(x=>x.purchase_id===id&&!x.voided_at&&!x.depot_parent_receipt_id).sort((a,b)=>new Date(b.received_at)-new Date(a.received_at));
  const allowed=()=>profile?.role==='admin'&&profile.active!==false;
  const direct=p=>['service','direct','barge','other'].includes(p.destination_type)&&!p.warehouse_id&&!items(p.id).some(x=>x.affects_inventory);
  const service=p=>p.destination_type==='service'||['service','rental','freight'].includes(p.purchase_type);
  const canReceive=p=>p&&['ordered','in_transit','partially_received'].includes(p.status)&&items(p.id).some(x=>pending(x)>0)&&(p.destination_type==='warehouse'&&p.warehouse_id||direct(p));
  const action=p=>!allowed()||!p||p.status==='cancelled'?null:canReceive(p)?'Recibir':receipts(p.id).length?'Cargar factura':null;
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Asuncion',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const validDate=v=>/^\d{4}-\d\d-\d\d$/.test(String(v||''))&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
  const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const digits=v=>String(v||'').replace(/\D/g,'');
  let view=0;
  const current=s=>allowed()&&profile.id===s.actor&&$('#purchaseReceiptAI')?.dataset.view===String(s.token)&&!$('#modal')?.classList.contains('hide');

  function score(po,ext){
    const product=(D.products||[]).find(x=>x.id===po.product_id)||{};
    if(window.AVHProductIdentity.conflicts(ext,{...product,description:po.description},D.products||[]).length)return 0;
    const code=norm(ext.product_code||ext.barcode),sku=norm(product.sku||product.code);
    if(code&&sku&&code===sku)return 1.2;
    let best=0;
    for(const name of [po.description,product.name]){
      const a=norm(name),b=norm(ext.description);if(!a||!b)continue;
      if(a===b)return 1;
      if(Math.min(a.length,b.length)>=10&&(a.includes(b)||b.includes(a)))best=Math.max(best,.95);
      const A=new Set(a.split(' ').filter(x=>x.length>2)),B=new Set(b.split(' ').filter(x=>x.length>2));
      if(A.size&&B.size)best=Math.max(best,[...A].filter(x=>B.has(x)).length/Math.max(A.size,B.size));
    }
    return best;
  }
  function quantityInPurchaseUnit(po,ext){
    const q=num(ext.quantity);if(!(q>0))return null;
    const unit=window.AVHReceiving.unit;
    if(unit(ext.unit)&&unit(ext.unit)===unit(po.unit))return q;
    const product=(D.products||[]).find(x=>x.id===po.product_id);if(!product)return null;
    // Only catalog conversions, never a conversion invented by OCR.
    const converted=window.AVHReceiving.quantity({...ext,factor_to_base:null,base_unit:null},product,D.presentations||[]);
    const factor=window.AVHReceiving.factor(po,product,D.presentations||[]);
    return converted&&factor>0?converted.quantity/factor:null;
  }
  function review(p,doc){
    const warnings=[...(doc.warnings||[]),...(doc.validation?.issues||[])].map(String),rows=items(p.id).filter(x=>pending(x)>0),matched=new Map();
    const supplier=(D.suppliers||[]).find(x=>x.id===p.supplier_id)||{},company=(D.purchaseCompanies||[]).find(x=>x.id===p.company_id)||{};
    let identityIssue=false;
    for(const [label,a,b] of [['proveedor',supplier.tax_id,doc.supplier_tax_id],['empresa compradora',company.tax_id,doc.customer_tax_id]])if(digits(a)&&digits(b)&&digits(a)!==digits(b)){warnings.push(`El RUC de ${label} leído no coincide con esta compra. Revisá el documento.`);identityIssue=true;}
    if(!digits(supplier.tax_id)&&supplier.name&&doc.supplier_name&&norm(supplier.name)!==norm(doc.supplier_name))warnings.push('El nombre del proveedor leído es diferente. Revisá que sea la factura de esta compra.');
    if(doc.currency&&p.currency&&doc.currency!==p.currency)warnings.push(`La factura está en ${doc.currency} y la compra en ${p.currency}. Revisá los importes.`);
    if(doc.complete===false||Number(doc.confidence||0)<.85)warnings.push('La lectura tiene dudas. Completá las cantidades mirando el original.');
    let unmatched=0;
    for(const ext of Array.isArray(doc.items)?doc.items:[]){
      const candidates=rows.map(po=>({po,score:score(po,ext)})).filter(x=>x.score>=.7).sort((a,b)=>b.score-a.score);
      if(!candidates.length||candidates[1]&&candidates[0].score-candidates[1].score<.05){unmatched++;continue;}
      const po=candidates[0].po,group=matched.get(po.id)||{quantity:0,valid:true,read:[]};
      const quantity=quantityInPurchaseUnit(po,ext);
      group.read.push(`${ext.quantity??'—'} ${ext.unit||''} ${ext.description||''}`);
      if(identityIssue||doc.complete===false||Number(doc.confidence||0)<.85||Number(ext.confidence||0)<.9||quantity===null)group.valid=false;
      else group.quantity+=quantity;
      matched.set(po.id,group);
    }
    if(unmatched)warnings.push(`${unmatched} renglón(es) de la factura no se pudieron vincular con seguridad. Revisalos contra la compra.`);
    for(const po of rows){const group=matched.get(po.id);if(!group)continue;if(group.quantity>pending(po)+.000001){group.valid=false;warnings.push(`La factura indica más de lo pendiente en “${po.description}”. Completá solamente lo recibido ahora.`);}}
    return{warnings:[...new Set(warnings)],matched};
  }

  async function open(id){
    const p=(D.purchases||[]).find(x=>x.id===id);if(!action(p))return;
    const available=receipts(id),s={token:++view,actor:profile.id,p,file:null,doc:null,busy:false,reading:false,snapshot:null,receiptId:null,documentId:null,path:null,uploaded:false};
    const receive=!!canReceive(p),warehouses=[...new Set([p.warehouse_id,...(p.delivery_warehouse_ids||[])].filter(Boolean))];
    openModal(receive?'Recibir compra y cargar factura':'Cargar factura',`${p.po_number||'Compra'} · ${p.supplier_name||'Proveedor'}`,`
      <div id="purchaseReceiptAI" data-view="${s.token}">
        <div class="notice">${receive?'Subí una foto de la factura o del remito. La IA propone los datos; revisá las cantidades antes de confirmar.':'La recepción ya está registrada. Acá podés agregar la factura o el remito.'}</div>
        <div class="rai-upload"><b>Foto de la factura o remito</b><p class="subtext">También podés subir un PDF. Hasta 12 MB.</p><div class="split-actions"><label class="btn primary" for="raiCamera">Tomar foto</label><label class="btn soft" for="raiFile">Subir foto o PDF</label></div><input id="raiCamera" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden><input id="raiFile" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" hidden><div id="raiFileInfo" class="subtext" role="status"></div><div id="raiOriginal"></div></div>
        <div id="raiAnalysis" role="status" aria-live="polite"></div>
        ${receive&&available.length?'<div class="field"><label for="raiOperation">¿Qué querés registrar?</label><select id="raiOperation"><option value="receive">Lo recibido o realizado ahora, con su factura</option><option value="document">Solo la factura de una recepción ya registrada</option></select></div>':`<input id="raiOperation" type="hidden" value="${receive?'receive':'document'}">`}
        <div id="raiReceiveFields">
          ${p.destination_type==='warehouse'?`<div class="field"><label for="raiWarehouse">Depósito que recibió</label><select id="raiWarehouse">${warehouses.map(id=>`<option value="${safe(id)}">${safe(whName(id)||'Depósito')}</option>`).join('')}</select></div>`:`<div class="field"><label for="raiDate">Fecha real de ${service(p)?'realización':'recepción'}</label><input id="raiDate" type="date" max="${today()}" value="${today()}"></div>`}
          <div class="section-head"><div><h2>${service(p)?'Servicio realizado':'Lo recibido ahora'}</h2><p>Comprobá las cantidades contra la entrega o el trabajo realizado.</p></div></div>
          <div class="list">${items(id).filter(x=>pending(x)>0).map(x=>`<div class="row"><div class="receive-grid"><div><b>${safe(x.description)}</b><div class="subtext">Pendiente: ${fmt(pending(x))} ${safe(x.unit)}</div><div class="subtext" data-rai-reading="${safe(x.id)}"></div></div><div class="field" style="margin:0"><label for="raiQty-${safe(x.id)}">${service(p)?'Realizado':'Recibido'} (${safe(x.unit)})</label><input id="raiQty-${safe(x.id)}" data-rai-quantity="${safe(x.id)}" type="number" inputmode="decimal" step="0.000001" min="0" max="${pending(x)}" value=""></div></div></div>`).join('')}</div>
        </div>
        <div id="raiExistingReceipt" class="field"><label for="raiReceipt">Entrega o servicio ya registrado</label><select id="raiReceipt">${available.map(r=>`<option value="${safe(r.id)}">${safe(String(r.effective_date||r.received_at||'').slice(0,10))}${r.warehouse_id?' · '+safe(whName(r.warehouse_id)):''}${r.notes?' · '+safe(String(r.notes).slice(0,80)):''}</option>`).join('')}</select></div>
        <div class="two"><div class="field"><label for="raiKind">Documento</label><select id="raiKind"><option value="invoice">Factura</option><option value="remittance">Remito</option><option value="other">Otro</option></select></div><div class="field"><label for="raiNumber">Número del documento</label><input id="raiNumber" placeholder="Ej.: 001-001-0001234" maxlength="200"></div></div>
        <div class="field"><label for="raiDocumentDate">Fecha del documento</label><input id="raiDocumentDate" type="date"></div>
        <div class="field"><label for="raiNotes">${service(p)?'Detalle del servicio / observación':'Observación de la entrega'}</label><textarea id="raiNotes" maxlength="4000" rows="2" placeholder="Revisá el trabajo realizado o indicá faltantes y observaciones."></textarea></div>
        <button type="button" id="raiSave" class="btn primary" style="width:100%">Confirmar recepción</button><div id="raiMessage" role="status" aria-live="polite"></div>
      </div>`);
    function operation(){return $('#raiOperation').value}
    function updateMode(){
      const receiving=operation()==='receive';$('#raiReceiveFields').hidden=!receiving;$('#raiExistingReceipt').hidden=receiving;
      $('#raiSave').textContent=receiving?service(p)?'Confirmar servicio realizado y guardar documento':'Confirmar recepción y guardar documento':'Guardar documento';
    }
    $('#raiOperation').onchange=updateMode;updateMode();
    async function readFile(input){
      if(s.busy||s.reading||s.snapshot||!current(s))return;
      const file=input.files?.[0];if(!file)return;
      const mime=file.type||({pdf:'application/pdf',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp'})[file.name.split('.').pop().toLowerCase()];
      if(!['application/pdf','image/jpeg','image/png','image/webp'].includes(mime))return msg($('#raiMessage'),'Elegí una foto JPG, PNG o WebP, o un PDF.');
      if(file.size>12*1024*1024)return msg($('#raiMessage'),'El archivo supera 12 MB. Subí una foto o un PDF más liviano.');
      s.file=file;s.doc=null;s.reading=true;$('#raiSave').disabled=true;
      document.querySelector('#purchaseReceiptAI').querySelectorAll('input,select,textarea').forEach(x=>x.disabled=true);
      $('#raiFileInfo').textContent=file.name;$('#raiAnalysis').textContent='Leyendo factura con IA…';msg($('#raiMessage'),'');
      // Replacing the document also clears suggestions from the previous photo.
      $$('[data-rai-quantity]').forEach(x=>x.value='');$$('[data-rai-reading]').forEach(x=>x.textContent='');$('#raiNumber').value='';$('#raiDocumentDate').value='';
      if($('#raiNotes').value===s.suggestedNotes)$('#raiNotes').value='';
      $('#raiOriginal').innerHTML='';
      try{
        const fileData=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('No se pudo leer el archivo.'));reader.readAsDataURL(file)});
        if(!current(s))return;
        if(mime.startsWith('image/')){const image=document.createElement('img');image.src=fileData;image.alt='Documento original para revisar';image.className='rai-preview';$('#raiOriginal').appendChild(image);}
        const result=await edge('purchase-document-ai',{file_name:file.name,mime_type:mime,file_data:fileData,context:{task:'Leer la factura o remito para revisar la recepción de esta compra. No asumir que lo facturado ya se recibió.',purchase:{po_number:p.po_number,currency:p.currency,supplier_name:p.supplier_name},items:items(id).map(x=>({description:x.description,unit:x.unit,ordered:x.quantity,pending:pending(x)}))}});
        if(!current(s))return;
        if(result.error)throw Error(result.error);
        const doc=result.data?.document;if(!doc||!Array.isArray(doc.items))throw Error('La IA no pudo completar la lectura.');s.doc=doc;
        const proposed=review(p,doc);
        $('#raiKind').value=doc.document_type==='receipt'?'remittance':doc.document_type==='invoice'?'invoice':'other';
        $('#raiNumber').value=doc.document_number||'';$('#raiDocumentDate').value=validDate(doc.date)?doc.date:'';
        if(!['invoice','receipt'].includes(doc.document_type))proposed.warnings.unshift('La IA no identificó una factura o un remito. Revisá el tipo de documento.');
        $('#raiAnalysis').innerHTML=`<div class="rai-summary"><b>Lectura lista para revisar</b><div>${safe(doc.supplier_name||'Proveedor sin identificar')}</div>${num(doc.total)!==null?`<div>Total leído: <b>${safe(money(doc.total,doc.currency||p.currency))}</b></div>`:''}</div>${proposed.warnings.length?`<div class="notice">${proposed.warnings.map(safe).join('<br>')}</div>`:''}`;
        $$('[data-rai-quantity]').forEach(input=>{const group=proposed.matched.get(input.dataset.raiQuantity);if(group?.valid&&group.quantity>0&&group.quantity<=Number(input.max)+.000001)input.value=Number(group.quantity.toFixed(6));const text=$$('[data-rai-reading]').find(x=>x.dataset.raiReading===input.dataset.raiQuantity);if(text&&group)text.textContent='En el documento: '+group.read.join(' · ');});
        if(!$('#raiNotes').value.trim()&&service(p)){s.suggestedNotes=doc.items.map(x=>x.description).filter(Boolean).join(' · ').slice(0,4000);$('#raiNotes').value=s.suggestedNotes;}
      }catch(error){if(current(s))$('#raiAnalysis').textContent='No se pudo completar la lectura: '+(error.message||String(error))+'. Podés volver a subir el archivo o completar los datos manualmente.';}
      finally{if(current(s)){s.reading=false;$('#raiSave').disabled=false;document.querySelector('#purchaseReceiptAI').querySelectorAll('input,select,textarea').forEach(x=>x.disabled=false);}}
    }
    $('#raiCamera').onchange=()=>readFile($('#raiCamera'));$('#raiFile').onchange=()=>readFile($('#raiFile'));
    function snapshot(){
      const mode=operation(),lines=[];
      if(!s.file)throw Error('Subí la foto o el PDF del documento.');
      const kind=$('#raiKind').value,number=$('#raiNumber').value.trim(),date=$('#raiDocumentDate').value,notes=$('#raiNotes').value.trim();
      if(!['invoice','remittance','other'].includes(kind))throw Error('Elegí un tipo de documento válido.');
      if(!number&&kind!=='other')throw Error('Completá el número impreso de la factura o remito.');
      if(!validDate(date))throw Error('Completá la fecha que figura en el documento.');
      let name,args,receiptId;
      if(mode==='document'){
        receiptId=$('#raiReceipt').value;if(!receipts(id).some(x=>x.id===receiptId))throw Error('Elegí una recepción vigente para adjuntar el documento.');
      }else{
        if(!canReceive((D.purchases||[]).find(x=>x.id===id)))throw Error('La compra cambió. Actualizala antes de confirmar.');
        $$('[data-rai-quantity]').forEach(input=>{
          const q=num(input.value),po=items(id).find(x=>x.id===input.dataset.raiQuantity);
          if(q===null)return;
          if(!po||q<0||q>pending(po)||Math.abs(q*1e6-Math.round(q*1e6))>.001)throw Error('Revisá las cantidades: no pueden superar lo pendiente y admiten hasta seis decimales.');
          if(q>0){if(po.affects_inventory){const problem=window.AVHReceiving.stockProblem(po,(D.products||[]).find(x=>x.id===po.product_id));if(problem)throw Error(problem);}lines.push({purchase_item_id:po.id,quantity:q});}
        });
        if(!lines.length)throw Error('Indicá al menos una cantidad realmente recibida o realizada.');
        const requestId=crypto.randomUUID();
        if(direct(p)){
          const effective=$('#raiDate').value;if(!validDate(effective)||effective>today())throw Error('Indicá la fecha real de recepción o realización; no puede ser futura.');
          if(!notes)throw Error('Describí el servicio realizado o la entrega que estás confirmando.');
          name='admin_confirm_direct_purchase';args={p_purchase_id:id,p_items:lines,p_effective_date:effective,p_notes:notes,p_request_id:requestId};
        }else{
          const warehouse=$('#raiWarehouse').value;if(!warehouses.includes(warehouse))throw Error('Elegí un depósito habilitado para recibir.');
          lines.forEach((x,i)=>{x.warehouse_id=warehouse;if(i===0)x.request_id=requestId});
          name='receive_purchase';args={p_purchase_id:id,p_items:lines,p_notes:notes||'Recepción revisada desde documento',p_document_number:null,p_document_date:null,p_file_path:null};
        }
      }
      return{mode,name,args,receiptId,kind,number,date,file:s.file};
    }
    $('#raiSave').onclick=async()=>{
      if(s.busy||s.reading||!current(s))return;
      const button=$('#raiSave'),out=$('#raiMessage');
      try{if(!s.snapshot)s.snapshot=snapshot();}catch(error){return msg(out,error.message||String(error));}
      s.busy=true;button.disabled=true;document.querySelector('#purchaseReceiptAI').querySelectorAll('input,select,textarea').forEach(x=>x.disabled=true);
      const frozen=s.snapshot;
      try{
        if(!s.receiptId){
          s.receiptId=frozen.receiptId||null;
          if(!s.receiptId){
            button.textContent=service(p)?'Guardando conformidad…':'Guardando recepción…';
            const result=await rpc(frozen.name,frozen.args);
            if(result.error){
              if(!result.network&&![408,429].includes(result.status)&&Number(result.status||0)<500){s.snapshot=null;if(current(s))document.querySelector('#purchaseReceiptAI').querySelectorAll('input,select,textarea').forEach(x=>x.disabled=false);}
              throw Error(result.error);
            }
            if(!result.data)throw Error('No se pudo comprobar la recepción. Reintentá con los mismos datos.');s.receiptId=result.data;
          }
        }
        button.textContent='Guardando documento…';
        if(!s.path)s.path=`${id}/receipts/${crypto.randomUUID()}_${frozen.file.name.replace(/[^a-zA-Z0-9._-]+/g,'_')}`;
        if(!s.uploaded){const upload=await request(`/storage/v1/object/purchase-documents/${s.path}`,{method:'POST',headers:{'Content-Type':frozen.file.type||'application/octet-stream','x-upsert':'false'},body:frozen.file});if(upload.error&&upload.status!==409)throw Error(upload.error);s.uploaded=true;}
        if(!s.documentId){
          // Resolve a possibly lost registration response before trying to register again.
          const existing=await query('purchase_documents','id',`purchase_id=eq.${id}&receipt_id=eq.${s.receiptId}&file_path=eq.${encodeURIComponent(s.path)}&limit=1`);
          if(existing.error)throw Error(existing.error);
          s.documentId=existing.data?.[0]?.id||null;
          if(!s.documentId){const registered=await rpc('register_purchase_receipt_document',{p_receipt_id:s.receiptId,p_kind:frozen.kind,p_file_path:s.path,p_file_name:frozen.file.name,p_document_number:frozen.number||null,p_document_date:frozen.date});if(registered.error)throw Error(registered.error);if(!registered.data)throw Error('No se pudo comprobar el documento. Reintentá guardarlo.');s.documentId=registered.data;}
        }
        let pendingControl=false;
        if(frozen.kind==='invoice'&&window.AVHPurchaseControl?.analyzeInvoice){button.textContent='Documento guardado. Controlando factura…';try{await window.AVHPurchaseControl.analyzeInvoice(id,s.documentId,{reload:false});}catch{pendingControl=true;}}
        if(!current(s))return;
        let refreshed=true;try{await loadAll(true);}catch{refreshed=false;}
        if(!current(s))return;
        $('#purchaseReceiptAI').innerHTML=`<div class="success"><b>${frozen.mode==='document'?'Documento guardado':service(p)?'Servicio confirmado y documento guardado':'Recepción y documento guardados'}</b><p>El comprobante quedó vinculado a esta compra.</p></div>${pendingControl?'<div class="notice">La factura está guardada. Su control de importes quedó pendiente; podés revisarlo desde la compra.</div>':''}${refreshed?'':'<div class="notice">Los datos se guardaron. Actualizá la pantalla para verlos.</div>'}<div class="split-actions"><button type="button" class="btn primary" id="raiDone">Listo</button><button type="button" class="btn soft" id="raiOpenPurchase">Abrir compra</button></div>`;
        $('#raiDone').onclick=()=>{closeModal();renderPurchases()};$('#raiOpenPurchase').onclick=()=>{closeModal();window.openPurchaseDetail(id)};
      }catch(error){if(current(s))msg(out,(s.receiptId?'La recepción ya está registrada. Falta guardar el documento. ':s.snapshot?'Reintentá con los mismos datos; la recepción no se duplicará. ':'')+(error.message||String(error)));}
      finally{if(current(s)&&$('#raiSave')){s.busy=false;button.disabled=false;button.textContent=s.receiptId?'Reintentar guardar documento':'Reintentar confirmación';}}
    };
  }
  const style=document.createElement('style');style.textContent='.purchase-row-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.rai-upload{padding:16px;border:2px dashed #bfd6c7;border-radius:14px;margin:12px 0}.rai-preview{display:block;max-width:100%;max-height:280px;object-fit:contain;margin-top:10px;border-radius:8px}.rai-summary{padding:12px;background:#edf7f0;border-radius:12px;margin:10px 0}#purchaseReceiptAI [hidden]{display:none!important}';document.head.appendChild(style);
  window.AVHPurchaseReceiving={action,open};
})();
