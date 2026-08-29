// AVH V7: completar vínculo Compras → Contratistas sin alterar el circuito de recepción.
(function(){
  const oldRpc=window.rpc;
  window.rpc=async function(name,args={}){
    if(name==='admin_create_purchase'&&args?.p_data&&document.querySelector('#pcContractor')){
      args={...args,p_data:{...args.p_data,contractor_id:document.querySelector('#pcContractor').value||null}};
    }
    return oldRpc(name,args);
  };

  function injectContractorField(){
    if(profile?.role!=='admin'||!document.querySelector('#pcRequester')||document.querySelector('#pcContractor'))return;
    const anchor=document.querySelector('#pcRequester')?.closest('.two');if(!anchor)return;
    const field=document.createElement('div');field.className='field';field.innerHTML=`<label>Contratista asociado</label><select id="pcContractor"><option value="">Sin contratista</option>${(D.contractors||[]).filter(x=>x.active).map(x=>`<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select><div class="hint">Opcional. Sirve para reportar cuánto se compró vinculado a cada contratista.</div>`;
    anchor.insertAdjacentElement('afterend',field);
  }
  const observer=new MutationObserver(()=>injectContractorField());
  observer.observe(document.body,{childList:true,subtree:true});

  const previousOpen=window.openPurchaseDetail;
  window.openPurchaseDetail=async function(id){
    await previousOpen(id);
    if(profile?.role!=='admin')return;
    const p=(D.purchases||[]).find(x=>x.id===id),host=document.querySelector('#modalBody .detail-grid');
    if(!p||!host||host.querySelector('[data-purchase-contractor]'))return;
    const box=document.createElement('div');box.className='detail-box';box.dataset.purchaseContractor='1';box.innerHTML=`<span>Contratista</span><b>${esc((D.contractors||[]).find(x=>x.id===p.contractor_id)?.name||'—')}</b>`;host.appendChild(box);
  };
})();
