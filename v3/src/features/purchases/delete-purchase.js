// AVH — Eliminación segura de compras sin recepción.
(function(){
  const previousOpenPurchaseDetail=window.openPurchaseDetail;
  if(typeof previousOpenPurchaseDetail!=='function')return;

  async function deleteStoredDocs(docs){
    for(const d of docs||[]){
      if(!d?.file_path)continue;
      try{
        const encoded=String(d.file_path).split('/').map(encodeURIComponent).join('/');
        await request(`/storage/v1/object/purchase-documents/${encoded}`,{method:'DELETE'});
      }catch(e){console.warn('No se pudo limpiar archivo de compra eliminado',e)}
    }
  }

  function isDeletable(id){
    const hasReceipt=(D.purchaseReceipts||[]).some(x=>x.purchase_id===id);
    const hasReceivedQty=(D.purchaseItems||[]).some(x=>x.purchase_id===id&&Number(x.received_qty||0)>0);
    return !hasReceipt&&!hasReceivedQty;
  }

  function addDeleteButton(id){
    if(profile?.role!=='admin'||document.querySelector('#pdDelete')||!isDeletable(id))return;
    const actions=document.querySelector('.purchase-record-actions');
    const save=document.querySelector('#pdSave');
    const host=actions||save?.closest('.card');
    if(!host)return;

    const btn=document.createElement('button');
    btn.id='pdDelete';btn.type='button';btn.className='btn';
    btn.style.cssText='background:#b42318;color:#fff;border-color:#b42318';
    btn.textContent='🗑 Eliminar compra';
    host.appendChild(btn);

    btn.onclick=async()=>{
      const p=(D.purchases||[]).find(x=>x.id===id);if(!p)return;
      if(!isDeletable(id))return alert('Esta compra ya tuvo recepción y no se puede eliminar.');
      const supplier=p.supplier_name||((D.suppliers||[]).find(x=>x.id===p.supplier_id)?.name)||'esta compra';
      const ref=p.po_number||p.order_reference||'sin referencia';
      if(!confirm(`¿Eliminar definitivamente ${ref} de ${supplier}?\n\nSolo se permite porque todavía no tuvo ninguna recepción. Esta acción no se puede deshacer.`))return;
      const docs=(D.purchaseDocuments||[]).filter(x=>x.purchase_id===id);
      btn.disabled=true;btn.textContent='Eliminando…';
      const r=await rpc('admin_delete_purchase',{p_purchase_id:id});
      if(r.error){btn.disabled=false;btn.textContent='🗑 Eliminar compra';return alert(r.error)}
      await deleteStoredDocs(docs);
      await loadAll(true);
      if(typeof renderPurchases==='function')renderPurchases();
      window.AVHShell?.syncActive?.('purchases');
    };
  }

  window.openPurchaseDetail=async function(id){
    await previousOpenPurchaseDetail.apply(this,arguments);
    queueMicrotask(()=>addDeleteButton(id));
  };
})();
