// AVH — Confirmación automática del importador: los ítems detectados van directo al carrito existente.
// Evita que el usuario tenga que volver a cargarlos en Carga múltiple.
(function(){
  const norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();

  function parseDisplayNumber(v){
    let s=String(v??'').trim().replace(/\s/g,'').replace(/[^0-9,.-]/g,'');if(!s)return 0;
    const comma=s.lastIndexOf(','),dot=s.lastIndexOf('.');
    if(comma>=0&&dot>=0){const dec=comma>dot?',':'.',th=dec===','?'.':',';s=s.split(th).join('').replace(dec,'.')}
    else if(comma>=0){const p=s.length-comma-1;s=p===3&&comma>0?s.replace(/,/g,''):s.replace(',','.')}
    else if(dot>=0){const p=s.length-dot-1;s=p===3&&dot>0?s.replace(/\./g,''):s}
    const n=Number(s);return Number.isFinite(n)?n:0;
  }

  function findProduct(description){
    const d=norm(description);if(!d)return null;const ps=(D.products||[]).filter(x=>x.active);
    return ps.find(p=>norm(p.name)===d||norm(p.code||'')===d)||ps.find(p=>{const pn=norm(p.name);return pn.length>=8&&(d.includes(pn)||pn.includes(d))})||null;
  }

  function detectedItems(){
    const tables=[...document.querySelectorAll('#pcImportResult .pc-import-preview table')];
    const table=tables.find(t=>/producto avh/i.test(t.querySelector('thead')?.textContent||''));if(!table)return[];
    return [...table.querySelectorAll('tbody tr')].map(tr=>{
      const td=[...tr.querySelectorAll('td')];if(td.length<4)return null;
      const description=td[0].textContent.trim(),quantity=parseDisplayNumber(td[1].textContent),unit=td[2].textContent.trim()||'unidad',unit_price=parseDisplayNumber(td[3].textContent),p=findProduct(description);
      return description&&quantity>0?{product_id:p?.id||null,description,quantity,unit,unit_price,factor_to_base:1}:null;
    }).filter(Boolean);
  }

  function documentType(raw){const n=norm(raw);if(/\b(factura|timbrado|invoice)\b/.test(n))return'invoice';if(/\b(orden de compra|purchase order)\b/.test(n)||/(^|\s)oc(\s|$)/.test(n))return'po';if(/\b(presupuesto|cotizacion|quotation|oferta|proforma)\b/.test(n))return'quote';return'unknown'}

  function autoCompany(raw){
    const n=norm(raw);const matches=(D.purchaseCompanies||[]).filter(x=>x.active&&x.name).map(x=>({x,n:norm(x.name)})).filter(v=>v.n.length>=5&&n.includes(v.n)).sort((a,b)=>b.n.length-a.n.length);
    if(matches.length){const sel=document.querySelector('#pcCompany');if(sel)sel.value=matches[0].x.id;return matches[0].x}return null;
  }

  function applyDetectedHeader(raw){
    const supplier=document.querySelector('#pcDetectedSupplier')?.value||'',currency=document.querySelector('#pcDetectedCurrency')?.value||'',reference=document.querySelector('#pcDetectedReference')?.value.trim()||'',date=document.querySelector('#pcDetectedDate')?.value||'',terms=document.querySelector('#pcDetectedTerms')?.value.trim()||'';
    const set=(id,value,event=false)=>{const el=document.querySelector(id);if(!el||!value)return;el.value=value;if(event)el.dispatchEvent(new Event('change',{bubbles:true}))};
    set('#pcSupplier',supplier);set('#pcCurrency',currency,true);set('#pcReference',reference);set('#pcDate',date);set('#pcTerms',terms);
    const type=documentType(raw),status=document.querySelector('#pcStatus');
    if(type==='invoice'){set('#pcInvoice',reference);if(status)status.value='ordered'}
    else if(type==='po'){if(status)status.value='ordered'}
    else if(type==='quote'){if(status)status.value='quoted'}
    return autoCompany(raw);
  }

  function pushItem(item){
    const ps=document.querySelector('#pciProduct'),desc=document.querySelector('#pciDesc'),qty=document.querySelector('#pciQty'),unit=document.querySelector('#pciUnit'),price=document.querySelector('#pciPrice'),factor=document.querySelector('#pciFactor'),stock=document.querySelector('#pciStock'),add=document.querySelector('#pcAddItem');
    if(!desc||!qty||!unit||!price||!factor||!stock||!add)return false;
    if(ps){ps.value=item.product_id||'';if(item.product_id)ps.dispatchEvent(new Event('change',{bubbles:true}))}
    desc.value=item.description;qty.value=String(item.quantity);
    if([...unit.options].some(o=>o.value===item.unit))unit.value=item.unit;else unit.value='unidad';
    price.value=String(item.unit_price||0);factor.value='1';stock.checked=!!item.product_id&&document.querySelector('#pcDest')?.value==='warehouse';
    add.click();return true;
  }

  function markPreview(){
    const b=document.querySelector('#pcImportConfirm');if(!b||b.dataset.directCart==='1')return;
    b.dataset.directCart='1';b.textContent='Confirmar e importar ítems';
    const actions=b.closest('.pc-bulk-actions');if(actions&&!actions.querySelector('[data-direct-cart-hint]')){
      const h=document.createElement('div');h.dataset.directCartHint='1';h.className='hint';h.style.width='100%';h.textContent='No vas a volver a cargar los productos: al confirmar pasan directo al carrito de la compra.';actions.appendChild(h);
    }
    autoCompany(document.querySelector('#pcImportText')?.value||'');
  }

  document.addEventListener('click',e=>{
    const b=e.target?.closest?.('#pcImportConfirm');if(!b)return;
    e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
    const raw=document.querySelector('#pcImportText')?.value||'',items=detectedItems(),out=document.querySelector('#pcImportResultMsg');
    if(!items.length){if(typeof msg==='function')msg(out,'No encontré ítems válidos para importar. Revisá la detección.');else alert('No encontré ítems válidos para importar.');return}
    applyDetectedHeader(raw);
    let ok=0;for(const item of items)if(pushItem(item))ok++;
    if(!ok){alert('No pude pasar los ítems al carrito. Cerrá y abrí Nueva compra e intentá de nuevo.');return}
    const panel=document.querySelector('#pcImportPanel');if(panel)panel.classList.remove('on');const toggle=document.querySelector('#pcImportToggle');if(toggle)toggle.textContent='Importar';
    const cart=document.querySelector('#pcCart');if(cart){const note=document.createElement('div');note.className='hint';note.style.marginTop='8px';note.innerHTML=`✅ <b>${ok} ítem${ok===1?'':'s'} importado${ok===1?'':'s'} automáticamente.</b> Revisá únicamente empresa/destino y guardá la compra.`;cart.appendChild(note);cart.scrollIntoView({behavior:'smooth',block:'center'})}
  },true);

  let queued=false;const obs=new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;markPreview()})});obs.observe(document.body,{childList:true,subtree:true});markPreview();
})();
