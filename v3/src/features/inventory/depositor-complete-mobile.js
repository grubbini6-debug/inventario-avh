// AVH — Completa el modo Depositero móvil sin volver a mostrar módulos innecesarios.
(function(){
  const safe=s=>typeof esc==='function'?esc(String(s??'')):String(s??'').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
  const n=v=>{const x=Number(v);return Number.isFinite(x)?x:0};
  const isDep=()=>profile?.role==='depositor'&&!!profile?.warehouse_id;
  const ownWh=()=>profile?.warehouse_id;
  const whNameLocal=()=> (D.warehouses||[]).find(x=>x.id===ownWh())?.name||'Mi depósito';
  const ownMoves=()=> (D.moves||[]).filter(m=>m.warehouse_from_id===ownWh()||m.warehouse_to_id===ownWh());
  const incomingTransfers=()=>ownMoves().filter(m=>m.type==='transfer'&&m.status==='in_transit'&&m.warehouse_to_id===ownWh());
  const criticalStock=()=> (D.stockStatus||[]).filter(x=>x.warehouse_id===ownWh()&&x.is_critical);
  const lowStock=()=> (D.stockStatus||[]).filter(x=>x.warehouse_id===ownWh()&&!x.is_critical&&x.minimum_qty!==null&&n(x.minimum_qty)>0&&n(x.stock_qty)<=n(x.minimum_qty)*1.25);
  const myRequests=()=> (D.supplyRequests||[]).filter(x=>x.requested_by===profile?.id);
  const myOpenRequests=()=>myRequests().filter(x=>['pending','in_progress'].includes(x.status));
  const ownPurchases=()=> (D.purchases||[]).filter(p=>p.destination_type==='warehouse'&&p.warehouse_id===ownWh());
  const receiptsFor=id=>(D.purchaseReceipts||[]).filter(r=>r.purchase_id===id);
  const docsFor=id=>(D.purchaseDocuments||[]).filter(d=>d.purchase_id===id);
  const docPending=()=>ownPurchases().filter(p=>receiptsFor(p.id).length&&!docsFor(p.id).some(d=>d.kind==='invoice'));

  const style=document.createElement('style');
  style.textContent=`
    .dep-complete-section{display:grid;gap:9px}.dep-complete-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px}.dep-complete-head h2{margin:0;font-size:18px}.dep-complete-head p{margin:3px 0 0;color:#6d7d74;font-size:12px}
    .dep-ops-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.dep-op{border:1px solid #dce8e0;background:#fff;border-radius:15px;padding:13px;text-align:left;min-height:88px;cursor:pointer}.dep-op:active{transform:scale(.985)}.dep-op .ico{display:block;font-size:22px;margin-bottom:7px}.dep-op b{display:block;font-size:14px}.dep-op small{display:block;margin-top:4px;color:#708078;line-height:1.3}.dep-op.warn{background:#fffaf0;border-color:#ebd79e}.dep-op.request{background:#f3f8ff;border-color:#cfdef2}
    .dep-attention{display:grid;gap:8px}.dep-attention-row{border:1px solid #dfe8e2;border-radius:13px;padding:11px;background:#fff}.dep-attention-row.amber{border-left:4px solid #dfa62d}.dep-attention-row.red{border-left:4px solid #cc473f}.dep-attention-row.blue{border-left:4px solid #547ab7}.dep-attention-row .line{gap:8px}.dep-attention-row .title{font-size:13px}.dep-attention-row .subtext{font-size:11px;line-height:1.4}
    .dep-history-row{border:1px solid #e0e8e3;border-radius:12px;padding:10px;background:#fff}.dep-history-actions{display:flex;justify-content:flex-end;margin-top:7px}.dep-doc-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.dep-doc-box{border:1px solid #dfe8e2;border-radius:13px;padding:11px}.dep-doc-box h3{margin:0 0 8px}
    @media(max-width:620px){.dep-op{min-height:82px;padding:12px}.dep-doc-grid{grid-template-columns:1fr}.dep-complete-head{align-items:flex-start;flex-direction:column}}
  `;
  document.head.appendChild(style);

  function openInitialGuard(){
    openModal('Cargar stock inicial','Uso excepcional',`<div class="notice">Usá <b>Stock inicial</b> solo para registrar existencia que ya estaba físicamente en el depósito y todavía no figura en AVH. No lo uses para mercadería nueva que llegó por compra, devolución o transferencia.</div><button id="depInitialContinue" class="btn primary" style="width:100%;margin-top:10px">Entiendo · cargar stock inicial</button>`);
    $('#depInitialContinue').onclick=()=>openMovement('initial');
  }

  function goStockState(state){
    goPage('stock');const w=$('#stockWarehouse'),s=$('#stockState');if(w)w.value=ownWh();if(s)s.value=state;renderStock();
  }

  async function receiveTransfer(id,btn){
    if(!id)return;btn.disabled=true;btn.textContent='Confirmando…';
    try{const r=await rpc('receive_transfer',{p_movement_id:id});if(r.error)throw Error(r.error);await loadAll(true)}catch(e){alert(e.message||String(e));btn.disabled=false;btn.textContent='Confirmar llegada'}
  }

  function openMyRequests(){
    const rows=myRequests().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
    const status={pending:'Pendiente',in_progress:'En gestión',fulfilled:'Atendida',rejected:'Rechazada'};
    openModal('Mis solicitudes','Abastecimiento enviado al administrador',`<div class="split-actions" style="margin-bottom:10px"><button id="depNewRequestModal" class="btn primary sm">+ Nueva solicitud</button></div><div class="list">${rows.map(r=>`<div class="row"><div class="line"><div class="grow"><div class="title">${safe(r.requested_name)} · ${fmt(r.quantity)} ${safe(r.unit)}</div><div class="subtext">${safe(r.reason||'Sin motivo')} · ${dt(r.created_at)}${r.resolution_notes?`<br><b>Respuesta:</b> ${safe(r.resolution_notes)}`:''}</div></div><span class="badge ${r.status==='fulfilled'?'green':r.status==='rejected'?'red':'amber'}">${safe(status[r.status]||r.status)}</span></div></div>`).join('')||'<div class="empty">Todavía no enviaste solicitudes.</div>'}</div>`);
    $('#depNewRequestModal').onclick=()=>window.openNewSupplyRequest?.();
  }

  async function uploadReceiptFile(file,purchaseId,kind){
    if(!file)return null;const clean=(file.name||`${kind}.jpg`).replace(/[^a-zA-Z0-9._-]+/g,'_'),path=`${purchaseId}/receipts/${Date.now()}_${kind}_${clean}`;
    const up=await request(`/storage/v1/object/purchase-documents/${path}`,{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream','x-upsert':'false'},body:file});if(up.error)throw Error('No se pudo subir el archivo: '+up.error);return path;
  }

  async function registerReceiptDoc(receiptId,purchaseId,kind,file,number,date){
    if(!file)return;const path=await uploadReceiptFile(file,purchaseId,kind);const r=await rpc('register_purchase_receipt_document',{p_receipt_id:receiptId,p_kind:kind,p_file_path:path,p_file_name:file.name||`${kind}.jpg`,p_document_number:String(number||'').trim()||null,p_document_date:date||null});if(r.error)throw Error(r.error);
  }

  function openCompleteDocs(purchaseId){
    const p=(D.purchases||[]).find(x=>x.id===purchaseId),receipt=receiptsFor(purchaseId).sort((a,b)=>new Date(b.received_at)-new Date(a.received_at))[0];if(!p||!receipt)return alert('No encontré una recepción para esta compra.');
    const today=new Date().toISOString().slice(0,10);
    openModal('Completar documentos',`${p.po_number||'Compra'} · ${p.supplier_name||'Proveedor'}`,`<div class="notice">La mercadería ya está recibida. Esto <b>solo adjunta documentación</b>; no vuelve a ingresar stock.</div><div class="dep-doc-grid" style="margin-top:10px"><div class="dep-doc-box"><h3>🧾 Factura</h3><div class="field"><label>Nº factura</label><input id="depDocInvoiceNo" value="${safe(p.invoice_number||'')}"></div><div class="field"><label>Fecha</label><input id="depDocInvoiceDate" type="date" value="${p.invoice_date||today}"></div><div class="field"><label>PDF o foto</label><input id="depDocInvoiceFile" type="file" accept="application/pdf,image/*" capture="environment"></div></div><div class="dep-doc-box"><h3>📄 Remito</h3><div class="field"><label>Nº remito</label><input id="depDocRemitNo"></div><div class="field"><label>Fecha</label><input id="depDocRemitDate" type="date" value="${today}"></div><div class="field"><label>PDF o foto</label><input id="depDocRemitFile" type="file" accept="application/pdf,image/*" capture="environment"></div></div></div><button id="depDocSave" class="btn primary" style="width:100%;margin-top:10px">Guardar documentos</button><div id="depDocMsg"></div>`);
    $('#depDocSave').onclick=async()=>{const inv=$('#depDocInvoiceFile').files?.[0],rem=$('#depDocRemitFile').files?.[0];if(!inv&&!rem)return msg($('#depDocMsg'),'Elegí al menos un archivo.');const b=$('#depDocSave');b.disabled=true;b.textContent='Guardando…';try{if(inv)await registerReceiptDoc(receipt.id,purchaseId,'invoice',inv,$('#depDocInvoiceNo').value,$('#depDocInvoiceDate').value);if(rem)await registerReceiptDoc(receipt.id,purchaseId,'remittance',rem,$('#depDocRemitNo').value,$('#depDocRemitDate').value);await loadAll(true);closeModal()}catch(e){msg($('#depDocMsg'),e.message||String(e))}finally{b.disabled=false;b.textContent='Guardar documentos'}};
  }

  function attentionHtml(){
    const trans=incomingTransfers(),crit=criticalStock(),low=lowStock(),req=myOpenRequests(),docs=docPending();const rows=[];
    trans.slice(0,4).forEach(m=>rows.push(`<div class="dep-attention-row amber"><div class="line"><div class="grow"><div class="title">⇄ Transferencia #${m.movement_no} por recibir</div><div class="subtext">${(m.movement_lines||[]).map(l=>`${fmt(l.quantity)} ${safe(l.presentation_label||l.unit)} ${safe(l.products?.name||'')}`).join(' · ')||'Material en tránsito'}</div></div><button class="btn sm primary" data-dep-confirm-transfer="${m.id}">Confirmar llegada</button></div></div>`));
    if(crit.length)rows.push(`<div class="dep-attention-row red"><div class="line"><div class="grow"><div class="title">⚠ ${crit.length} producto${crit.length===1?'':'s'} en stock crítico</div><div class="subtext">Revisá y solicitá reposición si corresponde.</div></div><button class="btn sm soft" data-dep-stock-state="critical">Ver</button></div></div>`);
    if(low.length)rows.push(`<div class="dep-attention-row amber"><div class="line"><div class="grow"><div class="title">Stock bajo: ${low.length} producto${low.length===1?'':'s'}</div><div class="subtext">Todavía hay existencia, pero está cerca del mínimo.</div></div><button class="btn sm soft" data-dep-stock-state="low">Ver</button></div></div>`);
    if(req.length)rows.push(`<div class="dep-attention-row blue"><div class="line"><div class="grow"><div class="title">📝 ${req.length} solicitud${req.length===1?'':'es'} abierta${req.length===1?'':'s'}</div><div class="subtext">Pendientes o en gestión por administración.</div></div><button class="btn sm soft" id="depViewRequests">Ver</button></div></div>`);
    docs.slice(0,4).forEach(p=>rows.push(`<div class="dep-attention-row blue"><div class="line"><div class="grow"><div class="title">🧾 ${safe(p.po_number||'Compra')} · falta factura</div><div class="subtext">${safe(p.supplier_name||'Proveedor')} · la mercadería ya fue recibida.</div></div><button class="btn sm soft" data-dep-complete-docs="${p.id}">Completar</button></div></div>`));
    return rows.join('')||'<div class="empty">No tenés pendientes operativos ahora.</div>';
  }

  function recentHtml(){
    const rows=ownMoves().filter(m=>m.type!=='correction').slice(0,8);
    return rows.map(m=>`<div class="dep-history-row"><div class="line"><div class="grow"><div class="title">${safe((typeof TYPE_LABEL!=='undefined'&&TYPE_LABEL[m.type])||m.type)} #${m.movement_no}</div><div class="subtext">${(m.movement_lines||[]).map(l=>`${fmt(l.quantity)} ${safe(l.presentation_label||l.unit)} ${safe(l.products?.name||'')}`).join(' · ')||'Sin detalle'}<br>${dt(m.created_at)}</div></div><span class="badge">${safe(m.status||'')}</span></div>${m.created_by===profile.id?`<div class="dep-history-actions"><button class="btn sm soft" data-dep-correct="${m.id}">Solicitar corrección</button></div>`:''}</div>`).join('')||'<div class="empty">Todavía no hay movimientos.</div>';
  }

  function bind(){
    $('#depManualEntry')?.addEventListener('click',()=>openMovement('entry'));
    $('#depTransfer')?.addEventListener('click',()=>{if((D.warehouses||[]).filter(x=>x.active&&x.id!==ownWh()).length)openMovement('transfer');else alert('No hay otro depósito activo para transferir.')});
    $('#depReturn')?.addEventListener('click',()=>openMovement('return'));
    $('#depInitial')?.addEventListener('click',openInitialGuard);
    $('#depSupplyRequest')?.addEventListener('click',()=>window.openNewSupplyRequest?.());
    $('#depViewRequests')?.addEventListener('click',openMyRequests);
    $$('[data-dep-confirm-transfer]').forEach(b=>b.onclick=()=>receiveTransfer(b.dataset.depConfirmTransfer,b));
    $$('[data-dep-stock-state]').forEach(b=>b.onclick=()=>goStockState(b.dataset.depStockState));
    $$('[data-dep-complete-docs]').forEach(b=>b.onclick=()=>openCompleteDocs(b.dataset.depCompleteDocs));
    $$('[data-dep-correct]').forEach(b=>b.onclick=()=>requestCorrection(b.dataset.depCorrect));
  }

  function decorate(){
    if(!isDep())return;const home=$('#page-home .dep-home');if(!home||$('#depCompleteOps'))return;
    const actions=home.querySelector('.dep-actions');if(actions)actions.insertAdjacentHTML('afterend',`<section id="depCompleteOps" class="dep-complete-section"><div class="dep-complete-head"><div><h2>Otras operaciones</h2><p>Lo necesario para operar el depósito sin menús extra.</p></div></div><div class="dep-ops-grid"><button id="depManualEntry" class="dep-op"><span class="ico">➕</span><b>Entrada manual</b><small>Ingreso que no viene de una OC.</small></button><button id="depTransfer" class="dep-op"><span class="ico">⇄</span><b>Transferir</b><small>Enviar material a otro depósito.</small></button><button id="depReturn" class="dep-op"><span class="ico">↩️</span><b>Devolución</b><small>Material que vuelve al depósito.</small></button><button id="depSupplyRequest" class="dep-op request"><span class="ico">📝</span><b>Solicitar material</b><small>Pedí reposición o algo nuevo a administración.</small></button><button id="depInitial" class="dep-op warn"><span class="ico">🧮</span><b>Stock inicial</b><small>Solo existencia previa que aún no figura en AVH.</small></button></div></section>`);
    const kpis=home.querySelector('.dep-kpis');if(kpis)kpis.insertAdjacentHTML('afterend',`<section id="depAttention" class="dep-complete-section"><div class="dep-complete-head"><div><h2>Atención requerida</h2><p>Transferencias, faltantes, solicitudes y documentos.</p></div></div><div class="dep-attention">${attentionHtml()}</div></section>`);
    const heads=[...home.querySelectorAll('.section-head')],activity=heads.find(h=>h.querySelector('h2')?.textContent.trim()==='Actividad de hoy');if(activity){const oldList=activity.nextElementSibling;activity.style.display='none';if(oldList)oldList.style.display='none';activity.insertAdjacentHTML('afterend',`<section id="depRecentManaged" class="dep-complete-section"><div class="dep-complete-head"><div><h2>Mis últimos movimientos</h2><p>Revisá lo cargado y pedí corrección si algo quedó mal.</p></div></div><div class="dep-attention">${recentHtml()}</div></section>`)}
    bind();
  }

  let scheduled=false;const schedule=()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;decorate()})};
  const observer=new MutationObserver(schedule);observer.observe(document.body,{childList:true,subtree:true});
  let tries=0;(function boot(){decorate();if(!$('#depCompleteOps')&&++tries<100)setTimeout(boot,250)})();
})();
