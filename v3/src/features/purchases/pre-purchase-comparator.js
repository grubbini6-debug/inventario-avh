// AVH V3 — Comparador automático antes de comprar.
// Compara el precio ingresado contra el último precio registrado de cada proveedor.
(function(){
  const n=v=>Number.isFinite(Number(v))?Number(v):0;
  const supplier=id=>(D.suppliers||[]).find(x=>x.id===id);
  const purchase=id=>(D.purchases||[]).find(x=>x.id===id);
  const product=id=>(D.products||[]).find(x=>x.id===id);
  const cash=(v,c)=>typeof money==='function'?money(v,c):`${c||''} ${n(v).toLocaleString('es-PY',{maximumFractionDigits:4})}`;
  const date=v=>{if(!v)return'—';try{return new Date(String(v).length===10?v+'T12:00:00':v).toLocaleDateString('es-PY')}catch{return String(v)}};
  const dayDiff=(a,b)=>{if(!a||!b)return null;const x=new Date(a+'T12:00:00'),y=new Date(b+'T12:00:00');if(Number.isNaN(+x)||Number.isNaN(+y))return null;return Math.round((y-x)/86400000)};

  function history(productId,currency){
    return (D.purchaseItems||[]).filter(i=>i.product_id===productId).map(i=>{
      const p=purchase(i.purchase_id);if(!p||p.status==='cancelled'||p.currency!==currency||!p.supplier_id)return null;
      const factor=n(i.factor_to_base)||1;
      return{
        supplier_id:p.supplier_id,
        supplier_name:supplier(p.supplier_id)?.name||p.supplier_name||'Proveedor',
        purchase:p,
        date:p.ordered_date||p.created_at||i.created_at,
        price:n(i.unit_price)/factor,
        qty:n(i.quantity)*factor,
        terms:p.payment_terms||'',
        lead_days:dayDiff(p.ordered_date,p.expected_date)
      };
    }).filter(Boolean).sort((a,b)=>new Date(b.date)-new Date(a.date));
  }

  function latestBySupplier(rows){
    const map=new Map;
    rows.forEach(x=>{if(!map.has(x.supplier_id))map.set(x.supplier_id,x)});
    return [...map.values()].sort((a,b)=>a.price-b.price||new Date(b.date)-new Date(a.date));
  }

  function ensureBox(){
    let box=$('#prePurchaseComparator');if(box)return box;
    const price=$('#pciPrice');if(!price)return null;
    box=document.createElement('div');box.id='prePurchaseComparator';box.className='ppc';
    const live=$('#piLive');
    if(live)live.insertAdjacentElement('afterend',box);
    else price.closest('.two')?.insertAdjacentElement('afterend',box);
    return box;
  }

  function draw(){
    if(profile?.role!=='admin')return;
    const ps=$('#pciProduct'),price=$('#pciPrice'),currency=$('#pcCurrency'),factor=$('#pciFactor'),qty=$('#pciQty'),supplierSelect=$('#pcSupplier');
    if(!ps||!price||!currency||!factor||!qty||!supplierSelect)return;
    const box=ensureBox();if(!box)return;
    const productId=ps.value,c=currency.value,p=product(productId);
    if(!productId){box.innerHTML='';box.className='ppc hide';return}
    box.className='ppc';
    const rows=latestBySupplier(history(productId,c));
    if(!rows.length){
      box.innerHTML='<div class="ppc-head"><div><b>Comparador de proveedores</b><div class="hint">Todavía no hay precios de otros proveedores para este producto y moneda.</div></div><span class="badge">SIN HISTORIAL</span></div>';
      return;
    }
    const best=rows[0],selectedId=supplierSelect.value,currentBase=n(price.value)/(n(factor.value)||1);
    const baseQty=n(qty.value)*(n(factor.value)||1);
    const selected=rows.find(x=>x.supplier_id===selectedId)||null;
    const diffBest=currentBase>0&&best.price>0?((currentBase-best.price)/best.price)*100:null;
    const saving=currentBase>best.price&&baseQty>0?(currentBase-best.price)*baseQty:0;
    let state='neutral',headline='Compará el precio actual con los últimos precios registrados';
    if(currentBase>0){
      if(diffBest>10){state='bad';headline=`🔴 Hay un último precio registrado ${diffBest.toFixed(1)}% menor`}
      else if(diffBest>5){state='warn';headline=`🟡 Hay un último precio registrado ${diffBest.toFixed(1)}% menor`}
      else if(diffBest<=2){state='good';headline='🟢 El precio actual está competitivo frente al historial por proveedor'}
      else headline='Precio actual dentro de un rango cercano al mejor último precio';
    }
    box.className=`ppc ${state}`;
    box.innerHTML=`<div class="ppc-head"><div><b>${headline}</b><div class="subtext">${esc(p?.name||'Producto')} · ${esc(c)} por ${esc(p?.base_unit||'unidad base')}</div></div><span class="badge ${state==='bad'?'red':state==='warn'?'amber':state==='good'?'green':''}">COMPARADOR</span></div>
      <div class="metric-pills">
        <span>Mejor último: <b>${cash(best.price,c)}</b> · ${esc(best.supplier_name)}</span>
        ${selected?`<span>Proveedor elegido: <b>${cash(selected.price,c)}</b> última vez</span>`:''}
        ${currentBase>0?`<span>Precio cargado: <b>${cash(currentBase,c)}</b></span>`:''}
        ${saving>0?`<span>Diferencia estimada ítem: <b>${cash(saving,c)}</b></span>`:''}
      </div>
      <div class="ppc-list">${rows.slice(0,6).map((x,i)=>`<div class="ppc-row ${x.supplier_id===selectedId?'selected':''}">
        <div class="grow"><div class="title">${esc(x.supplier_name)} ${i===0?'<span class="badge green">MEJOR ÚLTIMO</span>':''}</div>
          <div class="subtext">${cash(x.price,c)} / ${esc(p?.base_unit||'base')} · ${date(x.date)}${x.terms?` · ${esc(x.terms)}`:''}${x.lead_days!=null&&x.lead_days>=0?` · plazo prometido ${x.lead_days} días`:''}</div>
        </div>
        ${x.supplier_id===selectedId?'<span class="badge">ELEGIDO</span>':`<button type="button" class="btn sm soft" data-ppc-supplier="${x.supplier_id}">Elegir</button>`}
      </div>`).join('')}</div>
      <div class="hint">Usa el último precio registrado de cada proveedor. Confirmá vigencia, crédito, plazo y condiciones antes de emitir la compra.</div>`;
    $$('[data-ppc-supplier]').forEach(b=>b.onclick=()=>{supplierSelect.value=b.dataset.ppcSupplier;supplierSelect.dispatchEvent(new Event('change',{bubbles:true}));draw()});
  }

  function bind(){
    if(profile?.role!=='admin')return;
    const ids=['pciProduct','pciPrice','pcCurrency','pciFactor','pciQty','pcSupplier'];
    const els=ids.map(id=>$('#'+id));if(els.some(x=>!x))return;
    if($('#pciProduct').dataset.ppcBound)return;
    $('#pciProduct').dataset.ppcBound='1';
    ['change','input'].forEach(ev=>els.forEach(el=>el.addEventListener(ev,draw)));
    $('#pcAddItem')?.addEventListener('click',()=>setTimeout(draw,0));
    draw();
  }

  const style=document.createElement('style');
  style.textContent=`.ppc{border:1px solid #dce6df;border-radius:13px;background:#fff;padding:11px;margin:9px 0}.ppc.good{border-color:#79b890;background:#f5fbf7}.ppc.warn{border-color:#d7ad5c;background:#fffaf0}.ppc.bad{border-color:#d87878;background:#fff6f5}.ppc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.ppc-list{display:grid;margin-top:8px}.ppc-row{display:flex;align-items:center;gap:9px;padding:8px 0;border-top:1px solid #e7eee9}.ppc-row.selected{background:rgba(15,90,49,.04);padding-left:7px;padding-right:7px;border-radius:9px}.ppc-row .title{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.ppc .hint{margin-top:7px}@media(max-width:650px){.ppc-row{align-items:flex-start}.ppc-row button{white-space:nowrap}}`;
  document.head.appendChild(style);

  const observer=new MutationObserver(()=>bind());
  observer.observe(document.body,{childList:true,subtree:true});
  setTimeout(bind,0);
})();