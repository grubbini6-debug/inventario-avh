// AVH — Eliminación simple de compras sin recepción.
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

  function addDeleteButton(id){
    if(profile?.role!=='admin')return;
    const save=document.querySelector('#pdSave');
    if(!save||document.querySelector('#pdDelete'))return;
    const card=save.closest('.card');if(!card)return;
    const btn=document.createElement('button');
    btn.id='pdDelete';btn.type='button';btn.className='btn';
    btn.style.cssText='margin-top:8px;width:100%;background:#b42318;color:#fff;border-color:#b42318';
    btn.textContent='🗑 Eliminar compra';
    card.appendChild(btn);

    btn.onclick=async()=>{
      const p=(D.purchases||[]).find(x=>x.id===id);if(!p)return;
      const supplier=p.supplier_name||((D.suppliers||[]).find(x=>x.id===p.supplier_id)?.name)||'esta compra';
      if(!confirm(`¿Eliminar definitivamente la compra de ${supplier}?\n\nEsta acción no se puede deshacer.`))return;
      const docs=(D.purchaseDocuments||[]).filter(x=>x.purchase_id===id);
      btn.disabled=true;btn.textContent='Eliminando…';
      const r=await rpc('admin_delete_purchase',{p_purchase_id:id});
      if(r.error){btn.disabled=false;btn.textContent='🗑 Eliminar compra';return alert(r.error)}
      await deleteStoredDocs(docs);
      await loadAll(true);
      closeModal();
      if(typeof renderPurchases==='function')renderPurchases();
    };
  }

  window.openPurchaseDetail=async function(id){
    await previousOpenPurchaseDetail(id);
    queueMicrotask(()=>addDeleteButton(id));
  };
})();
