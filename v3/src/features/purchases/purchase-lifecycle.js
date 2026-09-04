// AVH — Expediente completo de compra y recepción documental.
(function(){
  const DOC_LABEL={quotation:'Presupuesto / cotización',order:'Orden de Compra',invoice:'Factura',remittance:'Remito',payment:'Comprobante de pago',other:'Otro'};
  const safe=s=>typeof esc==='function'?esc(String(s??'')):String(s??'').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
  const nowDate=()=>new Date().toISOString().slice(0,10);
  const st=document.createElement('style');
  st.textContent=`.purchase-lifecycle{border:1px solid #dbe7df;border-radius:16px;padding:14px;background:#f9fcfa;margin-top:10px}.life-steps{display:grid;gap:7px}.life-step{display:flex;align-items:flex-start;gap:9px;padding:8px 0;border-bottom:1px solid #e7eee9}.life-step:last-child{border-bottom:0}.life-dot{width:24px;height:24px;border-radius:999px;display:grid;place-items:center;background:#e8f2eb;font-size:12px;flex:0 0 24px}.life-dot.ok{background:#dff3e6;color:#126b34}.life-dot.warn{background:#fff1cf;color:#8b5b00}.life-files{display:grid;gap:7px;margin-top:10px}.life-file{display:flex;justify-content:space-between;gap:10px;align-items:center;border:1px solid #e0e9e3;border-radius:11px;padding:9px;background:#fff}.receive-doc-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.receive-doc-box{border:1px solid #dce7e0;border-radius:14px;padding:12px;background:#fbfdfb}.receive-doc-box h3{margin:0 0 8px}.doc-pending{border-left:4px solid #e8a72e}@media(max-width:700px){.receive-doc-grid{grid-template-columns:1fr}}`;
  document.head.appendChild(st);

  function purchaseItems(id){return (D.purchaseItems||[]).filter(x=>x.purchase_id===id)}
  function purchaseReceipts(id){return (D.purchaseReceipts||[]).filter(x=>x.purchase_id===id).sort((a,b)=>new Date(b.received_at)-new Date(a.received_at))}
  function purchaseDocs(id){return (D.purchaseDocuments||[]).filter(x=>x.purchase_id===id).sort((a,b)=>new Date(a.created_at)-new Date(b.created_at))}
  function whNameLocal(id){return typeof whName==='function'?whName(id):(D.warehouses||[]).find(x=>x.id===id)?.name||'Depósito'}
  function dateOnly(v){if(!v)return'—';try{return new Date(String(v).slice(0,10)+'T12:00:00').toLocaleDateString('es-PY')}catch{return String(v)}}
  function dtLocal(v){if(!v)return'—';try{return new Date(v).toLocaleString('es-PY')}catch{return String(v)}}
  function statusText(s){return ({ordered:'Comprado / pedido',in_transit:'En camino',partially_received:'Recibido parcial',received:'Recibido total',invoiced:'Facturado',closed:'Cerrado'})[s]||s}
  function productName(id){return (D.products||[]).find(x=>x.id===id)?.name||'Producto AVH'}

  async function signedPurchaseDocument(path){
    const encoded=String(path||'').split('/').map(encodeURIComponent).join('/');
    const r=await request(`/storage/v1/object/sign/purchase-documents/${encoded}`,{method:'POST',body:{expiresIn:600}});if(r.error)throw Error(r.error);
    const u=r.data?.signedURL||r.data?.signedUrl;if(!u)throw Error('No se pudo abrir el archivo.');return /^https?:/.test(u)?u:`${API}/storage/v1${u.startsWith('/')?u:'/'+u}`;
  }
  async function openPurchaseDocument(path){const tab=window.open('about:blank','_blank');try{const u=await signedPurchaseDocument(path);if(tab)tab.location.href=u;else location.href=u}catch(e){if(tab)tab.close();alert(e.message||String(e))}}
  async function uploadReceiptFile(file,purchaseId,kind){
    if(!file)return null;const clean=file.name.replace(/[^a-zA-Z0-9._-]+/g,'_'),path=`${purchaseId}/receipts/${Date.now()}_${kind}_${clean}`;
    const r=await request(`/storage/v1/object/purchase-documents/${path}`,{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream','x-upsert':'false'},body:file});if(r.error)throw Error('No se pudo subir '+file.name+': '+r.error);return path;
  }
  async function registerReceiptFile(receiptId,kind,file,purchaseId,number,date){
    if(!file)return null;const path=await uploadReceiptFile(file,purchaseId,kind);
    const r=await rpc('register_purchase_receipt_document',{p_receipt_id:receiptId,p_kind:kind,p_file_path:path,p_file_name:file.name,p_document_number:String(number||'').trim()||null,p_document_date:date||null});
    if(r.error)throw Error(r.error);return{path,documentId:r.data||null};
  }

  function receiptPurchaseCard(p){
    const pending=purchaseItems(p.id).filter(x=>Number(x.received_qty||0)<Number(x.quantity||0));
    return `<div class="row clickable purchase-row ${p.urgency||''}" data-life-receive="${p.id}"><div class="line"><div class="grow"><div class="title">${safe(p.supplier_name||'Proveedor sin definir')}</div><div class="subtext">${safe(p.company_name||'')} · ${safe(p.po_number||'Sin OC')} · ${safe(whNameLocal(p.warehouse_id))}</div><div class="metric-pills"><span>${pending.length} ítem${pending.length===1?'':'s'} pendientes</span>${p.expected_date?`<span>Entrega ${dateOnly(p.expected_date)}</span>`:''}</div></div><span class="badge amber">${safe(statusText(p.status))}</span></div></div>`;
  }

  function openReceivePurchase(id){
    const p=(D.purchases||[]).find(x=>x.id===id);if(!p||p.warehouse_id!==profile.warehouse_id)return alert('Esta compra no pertenece a tu depósito.');
    const items=purchaseItems(id).filter(x=>Number(x.received_qty||0)<Number(x.quantity||0));
    openModal('Recibir compra',`${p.po_number||'OC'} · ${p.supplier_name||'Proveedor'}`,`<div class="notice">Confirmá lo que llegó físicamente. AVH mantiene recepciones parciales y el stock/FIFO se actualiza con la lógica normal.</div>
      <div class="section-head"><div><h2>Cantidades recibidas</h2><p>Pedido asociado a ${safe(p.po_number||'la compra')}</p></div></div>
      <div class="list">${items.map(x=>{const rem=Number(x.quantity)-Number(x.received_qty||0);return`<div class="row"><div class="receive-grid"><div><div class="title">${safe(x.description)}</div><div class="subtext">Producto AVH: ${safe(productName(x.product_id))} · Pendiente ${fmt(rem)} ${safe(x.unit)}${x.affects_inventory?' · ingresa a stock':''}</div></div><div class="field" style="margin:0"><label>Recibido ahora</label><input type="number" step="0.001" min="0" max="${rem}" value="${rem}" data-life-qty="${x.id}"></div></div></div>`}).join('')}</div>
      <div class="section-head"><div><h2>Documentación recibida</h2><p>Factura y remito quedan dentro de esta misma compra.</p></div></div>
      <div class="receive-doc-grid"><div class="receive-doc-box"><h3>🧾 Factura</h3><div class="field"><label>Nº factura</label><input id="lifeInvoiceNo" placeholder="Ej.: 001-001-0001234"></div><div class="field"><label>Fecha factura</label><input id="lifeInvoiceDate" type="date" value="${nowDate()}"></div><div class="field"><label>PDF o foto</label><input id="lifeInvoiceFile" type="file" accept="application/pdf,image/*" capture="environment"></div></div>
      <div class="receive-doc-box"><h3>📄 Remito</h3><div class="field"><label>Nº remito</label><input id="lifeRemitNo" placeholder="Opcional"></div><div class="field"><label>Fecha remito</label><input id="lifeRemitDate" type="date" value="${nowDate()}"></div><div class="field"><label>PDF o foto</label><input id="lifeRemitFile" type="file" accept="application/pdf,image/*" capture="environment"></div></div></div>
      <div class="field"><label>Observación de recepción</label><textarea id="lifeReceiveNotes" placeholder="Ej.: faltaron 10 unidades, embalaje golpeado, entrega conforme…"></textarea></div>
      <button id="lifeReceiveConfirm" class="btn primary" style="width:100%">✅ Confirmar recepción</button><div id="lifeReceiveMsg"></div>`);
    $('#lifeReceiveConfirm').onclick=async()=>{
      const lines=[];$$('[data-life-qty]').forEach(inp=>{const q=Number(inp.value||0);if(q>0)lines.push({purchase_item_id:inp.dataset.lifeQty,quantity:q})});if(!lines.length)return msg($('#lifeReceiveMsg'),'Indicá al menos una cantidad recibida.');
      const b=$('#lifeReceiveConfirm');b.disabled=true;b.textContent='Registrando recepción…';
      try{
        const remitNo=$('#lifeRemitNo').value.trim(),remitDate=$('#lifeRemitDate').value||null;
        const r=await rpc('receive_purchase',{p_purchase_id:id,p_items:lines,p_notes:$('#lifeReceiveNotes').value.trim()||null,p_document_number:remitNo||null,p_document_date:remitDate,p_file_path:null});if(r.error)throw Error(r.error);
        const receiptId=r.data;if(!receiptId)throw Error('La recepción se registró pero no recibí su identificador.');
        const docErrors=[];
        const inv=$('#lifeInvoiceFile').files?.[0],rem=$('#lifeRemitFile').files?.[0];
        if(inv)try{const saved=await registerReceiptFile(receiptId,'invoice',inv,id,$('#lifeInvoiceNo').value,$('#lifeInvoiceDate').value);if(saved?.documentId&&window.AVHPurchaseControl?.analyzeInvoice)try{await window.AVHPurchaseControl.analyzeInvoice(id,saved.documentId,{reload:false})}catch(e){docErrors.push('Factura guardada; análisis pendiente: '+(e.message||e))}}catch(e){docErrors.push('Factura: '+(e.message||e))}
        if(rem)try{await registerReceiptFile(receiptId,'remittance',rem,id,remitNo,remitDate)}catch(e){docErrors.push('Remito: '+(e.message||e))}
        await loadAll(true);closeModal();activeModule='purchase-receipts';renderPurchaseReceipts();
        if(docErrors.length)setTimeout(()=>alert('La mercadería fue recibida correctamente, pero hubo un problema con documentos: '+docErrors.join(' · ')),100);
      }catch(e){msg($('#lifeReceiveMsg'),e.message||String(e))}finally{b.disabled=false;b.textContent='✅ Confirmar recepción'}
    };
  }

  function openAttachReceiptDocs(purchaseId){
    const p=(D.purchases||[]).find(x=>x.id===purchaseId),receipt=purchaseReceipts(purchaseId)[0];if(!p||!receipt)return alert('No encontré una recepción para esta compra.');
    openModal('Completar documentos',`${p.po_number||'Compra'} · ${p.supplier_name||'Proveedor'}`,`<div class="notice">La mercadería ya fue recibida. Acá podés completar factura o remito sin volver a tocar el stock.</div><div class="receive-doc-grid"><div class="receive-doc-box"><h3>🧾 Factura</h3><div class="field"><label>Nº factura</label><input id="lateInvoiceNo" value="${safe(p.invoice_number||'')}"></div><div class="field"><label>Fecha</label><input id="lateInvoiceDate" type="date" value="${p.invoice_date||nowDate()}"></div><div class="field"><label>Archivo</label><input id="lateInvoiceFile" type="file" accept="application/pdf,image/*" capture="environment"></div></div><div class="receive-doc-box"><h3>📄 Remito</h3><div class="field"><label>Nº remito</label><input id="lateRemitNo"></div><div class="field"><label>Fecha</label><input id="lateRemitDate" type="date" value="${nowDate()}"></div><div class="field"><label>Archivo</label><input id="lateRemitFile" type="file" accept="application/pdf,image/*" capture="environment"></div></div></div><button id="lateSaveDocs" class="btn primary" style="width:100%">Guardar documentos</button><div id="lateDocsMsg"></div>`);
    $('#lateSaveDocs').onclick=async()=>{const inv=$('#lateInvoiceFile').files?.[0],rem=$('#lateRemitFile').files?.[0];if(!inv&&!rem)return msg($('#lateDocsMsg'),'Elegí al menos un archivo.');const b=$('#lateSaveDocs');b.disabled=true;try{if(inv){const saved=await registerReceiptFile(receipt.id,'invoice',inv,purchaseId,$('#lateInvoiceNo').value,$('#lateInvoiceDate').value);if(saved?.documentId&&window.AVHPurchaseControl?.analyzeInvoice)try{await window.AVHPurchaseControl.analyzeInvoice(purchaseId,saved.documentId,{reload:false})}catch(e){console.warn('Análisis de factura pendiente',e)}}if(rem)await registerReceiptFile(receipt.id,'remittance',rem,purchaseId,$('#lateRemitNo').value,$('#lateRemitDate').value);await loadAll(true);closeModal();activeModule='purchase-receipts';renderPurchaseReceipts()}catch(e){msg($('#lateDocsMsg'),e.message||String(e))}finally{b.disabled=false}};
  }

  window.renderPurchaseReceipts=function(){
    if(profile?.role!=='depositor')return;
    const own=(D.purchases||[]).filter(p=>p.destination_type==='warehouse'&&p.warehouse_id===profile.warehouse_id),pending=own.filter(p=>['ordered','in_transit','partially_received'].includes(p.status));
    const docPending=own.filter(p=>['received','invoiced','closed'].includes(p.status)&&purchaseReceipts(p.id).length&&!purchaseDocs(p.id).some(d=>d.kind==='invoice')).slice(0,20);
    $('#moduleContent').innerHTML=`<div class="section-head"><div><h2>Recepciones de compras</h2><p>Recepción física + documentación de ${safe(whNameLocal(profile.warehouse_id))}</p></div><span class="badge amber">${pending.length} pendientes</span></div><div class="notice">Cada recepción queda vinculada a la compra, su OC, presupuesto, factura/remito y movimiento de stock.</div><div class="list" style="margin-top:10px">${pending.map(receiptPurchaseCard).join('')||'<div class="empty">No hay compras pendientes de recepción.</div>'}</div>${docPending.length?`<div class="section-head"><div><h2>Documentación pendiente</h2><p>Compras ya recibidas que todavía no tienen factura adjunta.</p></div></div><div class="list">${docPending.map(p=>`<div class="row doc-pending"><div class="line"><div><div class="title">${safe(p.po_number||'Compra')} · ${safe(p.supplier_name||'Proveedor')}</div><div class="subtext">Recibida · falta factura en el expediente</div></div><button class="btn sm soft" data-life-docs="${p.id}">Adjuntar factura/remito</button></div></div>`).join('')}</div>`:''}`;
    $$('[data-life-receive]').forEach(x=>x.onclick=()=>openReceivePurchase(x.dataset.lifeReceive));$$('[data-life-docs]').forEach(x=>x.onclick=()=>openAttachReceiptDocs(x.dataset.lifeDocs));
  };

  function lifecycleHtml(p){
    const docs=purchaseDocs(p.id),receipts=purchaseReceipts(p.id),quote=docs.find(d=>d.kind==='quotation'),order=docs.find(d=>d.kind==='order'),invoice=docs.find(d=>d.kind==='invoice'),remit=docs.find(d=>d.kind==='remittance');
    const steps=[
      {ok:!!quote,title:'Presupuesto',meta:quote?`${quote.file_name||'Adjunto'}${p.source_document_number?' · '+p.source_document_number:''}`:'Sin presupuesto adjunto'},
      {ok:!!p.po_number,title:'Orden de Compra',meta:p.po_number?`${p.po_number}${order?' · PDF archivado':' · PDF pendiente de archivar'}`:'Sin OC'},
      {ok:!!p.purchase_confirmed_at||['ordered','in_transit','partially_received','received','invoiced','closed'].includes(p.status),title:'Compra confirmada',meta:p.purchase_confirmed_at?dtLocal(p.purchase_confirmed_at):statusText(p.status)},
      {ok:receipts.length>0,title:'Recepción',meta:receipts.length?`${receipts.length} recepción${receipts.length===1?'':'es'} · última ${dtLocal(receipts[0].received_at)}`:'Pendiente de recibir'},
      {ok:!!invoice,title:'Factura',meta:invoice?`${invoice.document_number||p.invoice_number||'Adjunta'}${invoice.document_date?' · '+dateOnly(invoice.document_date):''}`:'Pendiente'},
      {ok:!!remit,title:'Remito',meta:remit?`${remit.document_number||'Adjunto'}${remit.document_date?' · '+dateOnly(remit.document_date):''}`:'No adjunto'}
    ];
    return `<div class="purchase-lifecycle"><div class="title">📁 Expediente de compra</div><div class="subtext">Presupuesto → OC → compra → recepción → factura/remito</div><div class="life-steps">${steps.map(s=>`<div class="life-step"><div class="life-dot ${s.ok?'ok':'warn'}">${s.ok?'✓':'•'}</div><div><b>${safe(s.title)}</b><div class="subtext">${safe(s.meta)}</div></div></div>`).join('')}</div><div class="life-files">${docs.map(d=>`<div class="life-file"><div><b>${safe(DOC_LABEL[d.kind]||d.kind)}</b><div class="subtext">${safe(d.document_number||d.file_name||'Archivo')}${d.document_date?' · '+dateOnly(d.document_date):''}${d.receipt_id?' · vinculado a recepción':''}</div></div><button class="btn sm soft" data-life-open="${safe(d.file_path)}">Abrir</button></div>`).join('')||'<div class="empty">Sin archivos en el expediente.</div>'}</div><div style="margin-top:10px"><b>Productos AVH</b>${purchaseItems(p.id).map(x=>`<div class="subtext">✓ ${safe(x.description)} → ${safe(productName(x.product_id))}</div>`).join('')}</div></div>`;
  }

  const oldDetail=window.openPurchaseDetail;
  window.openPurchaseDetail=async function(id){
    await oldDetail?.apply(this,arguments);const p=(D.purchases||[]).find(x=>x.id===id),body=$('#modalBody');if(!p||!body)return;
    const wrap=document.createElement('div');wrap.innerHTML=lifecycleHtml(p);body.prepend(wrap.firstElementChild);$$('[data-life-open]').forEach(b=>b.onclick=()=>openPurchaseDocument(b.dataset.lifeOpen));
  };
})();
