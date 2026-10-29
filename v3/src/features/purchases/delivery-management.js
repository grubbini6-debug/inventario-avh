// Purchase delivery destinations and documented closure of unfulfilled balances.
(function(){
  const safe=v=>esc(String(v??''));
  const pending=x=>Math.max(0,Number(x.quantity||0)-Number(x.received_qty||0)-Number(x.cancelled_qty||0));
  const items=id=>(D.purchaseItems||[]).filter(x=>x.purchase_id===id);
  const warehouses=p=>[...new Set([p.warehouse_id,...(p.delivery_warehouse_ids||[])].filter(Boolean))];

  function closeBalance(p){
    const rows=items(p.id).filter(x=>pending(x)>0);
    openModal('Cerrar saldo no entregado',p.po_number||'Compra',`
      <div class="notice">Seleccioná lo que el proveedor ya no entregará. Se conservarán la OC, las cantidades recibidas y sus documentos.</div>
      <div class="list" style="margin-top:12px">${rows.map(x=>`<label class="row line" style="justify-content:flex-start;gap:12px"><input type="checkbox" data-close-balance-item="${safe(x.id)}" checked style="width:20px;height:20px"><span><b>${safe(x.description)}</b><br><span class="subtext">Cancelar saldo: ${fmt(pending(x))} ${safe(x.unit)} · recibido: ${fmt(x.received_qty||0)}</span></span></label>`).join('')}</div>
      <div class="field" style="margin-top:12px"><label for="balanceCloseReason">Motivo del cierre *</label><textarea id="balanceCloseReason" placeholder="Ej.: el proveedor entregó solo lo disponible y confirmó que no enviará el saldo."></textarea></div>
      <button id="balanceCloseSave" class="btn primary" style="width:100%">Confirmar cierre del saldo</button><div id="balanceCloseMsg"></div>`);
    document.querySelector('#balanceCloseSave').onclick=async()=>{
      const reason=document.querySelector('#balanceCloseReason').value.trim(),ids=[...document.querySelectorAll('[data-close-balance-item]:checked')].map(x=>x.dataset.closeBalanceItem),out=document.querySelector('#balanceCloseMsg'),button=document.querySelector('#balanceCloseSave');
      if(!reason)return msg(out,'Indicá por qué el proveedor no entregará el saldo.');
      if(!ids.length)return msg(out,'Seleccioná al menos un ítem.');
      button.disabled=true;
      try{
        const result=await rpc('admin_cancel_purchase_balance',{p_purchase_id:p.id,p_item_ids:ids,p_reason:reason});
        if(result.error)throw Error(result.error);
        closeModal();await loadAll(true);await window.openPurchaseDetail(p.id);
      }catch(error){msg(out,error.message||String(error));button.disabled=false;}
    };
  }

  const previous=window.openPurchaseDetail;
  window.openPurchaseDetail=async function(id){
    await previous?.apply(this,arguments);
    if(profile?.role!=='admin')return;
    const p=(D.purchases||[]).find(x=>x.id===id),host=document.querySelector('#purchaseRecordEnhancements')||document.querySelector('#modalBody');
    if(!p||!host)return;
    document.querySelector('#purchaseDeliveryManagement')?.remove();
    const rows=items(id),cancelled=rows.filter(x=>Number(x.cancelled_qty)>0),hasPending=rows.some(x=>pending(x)>0),selected=warehouses(p),active=(D.warehouses||[]).filter(x=>x.active||selected.includes(x.id)),configurable=p.destination_type==='warehouse'&&!['closed','cancelled'].includes(p.status);
    const names=selected.map(w=>(D.warehouses||[]).find(x=>x.id===w)?.name||'Depósito').join(' · '),card=document.createElement('div');
    card.id='purchaseDeliveryManagement';card.className='card';
    card.innerHTML=`<h3>Entregas y saldo de la OC</h3>${p.destination_type==='warehouse'?`<p>${safe(names)}</p>${selected.length>1?'<div class="notice">Saldo compartido entre los depósitos habilitados. Compras indica dónde enviar cada entrega; el depositero confirma solo lo que recibe en su depósito.</div>':''}`:''}
      ${configurable?`<details style="margin-top:12px"><summary><b>Depósitos habilitados para recibir</b></summary><div style="display:grid;gap:10px;margin:12px 0">${active.map(w=>`<label class="line" style="justify-content:flex-start;gap:10px"><input type="checkbox" data-delivery-warehouse="${safe(w.id)}" ${selected.includes(w.id)?'checked':''} ${w.id===p.warehouse_id?'disabled':''} style="width:20px;height:20px">${safe(w.name)}${w.id===p.warehouse_id?' · principal':''}</label>`).join('')}</div><button id="purchaseDeliverySave" class="btn soft">Guardar depósitos de entrega</button><div id="purchaseDeliveryMsg"></div></details>`:''}
      ${cancelled.length?`<div class="notice" style="margin-top:12px"><b>Saldo cancelado por falta de entrega</b>${cancelled.map(x=>`<div style="margin-top:8px">${safe(x.description)}: <b>${fmt(x.cancelled_qty)} ${safe(x.unit)}</b><br><span class="subtext">${safe(x.cancellation_reason)}${x.cancelled_at?' · '+safe(dt(x.cancelled_at)):''}</span></div>`).join('')}</div>`:''}
      ${hasPending&&!['draft','requested','quoted','approved','cancelled'].includes(p.status)?'<button id="purchaseCloseBalance" class="btn soft" style="margin-top:12px">Cerrar saldo no entregado</button>':''}`;
    host.prepend(card);
    document.querySelector('#purchaseCloseBalance')?.addEventListener('click',()=>closeBalance(p));
    const save=document.querySelector('#purchaseDeliverySave');
    if(save)save.onclick=async()=>{
      save.disabled=true;const out=document.querySelector('#purchaseDeliveryMsg'),ids=[...document.querySelectorAll('[data-delivery-warehouse]:checked')].map(x=>x.dataset.deliveryWarehouse);
      try{const result=await rpc('admin_set_purchase_delivery_warehouses',{p_purchase_id:id,p_warehouse_ids:ids});if(result.error)throw Error(result.error);await loadAll(true);await window.openPurchaseDetail(id);}
      catch(error){msg(out,error.message||String(error));save.disabled=false;}
    };
  };
})();
