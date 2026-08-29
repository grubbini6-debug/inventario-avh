// AVH V9: Producto/Concepto de Compras escribible con vínculo opcional al catálogo.
(function(){
  function norm(v){return String(v||'').trim().toLowerCase()}
  function productByText(text){
    const q=norm(text);
    if(!q)return null;
    return (D.products||[]).find(p=>p.active && (norm(p.name)===q || norm(p.sku)===q)) || null;
  }
  function datalistHtml(id){
    return `<datalist id="${id}">${(D.products||[]).filter(p=>p.active).map(p=>`<option value="${esc(p.name)}">${esc(p.sku||p.base_unit||'')}</option>`).join('')}</datalist>`;
  }
  function enhanceNewPurchaseProduct(){
    const select=document.querySelector('#pciProduct');
    if(!select || document.querySelector('#pciProductText'))return;
    const field=select.closest('.field');
    if(!field)return;
    const label=field.querySelector('label');
    if(label)label.textContent='Producto / concepto';
    select.style.display='none';
    select.setAttribute('aria-hidden','true');
    const input=document.createElement('input');
    input.id='pciProductText';
    input.setAttribute('list','pciProductList');
    input.setAttribute('autocomplete','off');
    input.placeholder='Escribí cualquier producto, servicio o concepto…';
    select.insertAdjacentElement('beforebegin',input);
    input.insertAdjacentHTML('afterend',datalistHtml('pciProductList'));
    const hint=document.createElement('div');
    hint.className='hint';
    hint.textContent='Podés escribir libremente. Si coincide con Inventario, se vincula solo.';
    field.appendChild(hint);

    input.addEventListener('input',()=>{
      const text=input.value.trim();
      const p=productByText(text);
      select.value=p?.id||'';
      if(p){
        select.dispatchEvent(new Event('change',{bubbles:true}));
      }else{
        const desc=document.querySelector('#pciDesc');
        if(desc)desc.value=text;
      }
    });
    input.addEventListener('change',()=>{
      const p=productByText(input.value);
      select.value=p?.id||'';
      if(p)select.dispatchEvent(new Event('change',{bubbles:true}));
    });
    const add=document.querySelector('#pcAddItem');
    if(add){
      add.addEventListener('click',()=>setTimeout(()=>{
        const desc=document.querySelector('#pciDesc');
        if(desc && !desc.value)input.value='';
      },0));
    }
  }

  function enhanceEditPurchaseProduct(){
    const select=document.querySelector('#peiProduct');
    if(!select || document.querySelector('#peiProductText'))return;
    const field=select.closest('.field');
    if(!field)return;
    const label=field.querySelector('label');
    if(label)label.textContent='Producto / concepto';
    const selected=(D.products||[]).find(p=>p.id===select.value);
    const desc=document.querySelector('#peiDescription');
    select.style.display='none';
    select.setAttribute('aria-hidden','true');
    const input=document.createElement('input');
    input.id='peiProductText';
    input.setAttribute('list','peiProductList');
    input.setAttribute('autocomplete','off');
    input.placeholder='Escribí cualquier producto, servicio o concepto…';
    input.value=selected?.name || desc?.value || '';
    select.insertAdjacentElement('beforebegin',input);
    input.insertAdjacentHTML('afterend',datalistHtml('peiProductList'));
    const hint=document.createElement('div');
    hint.className='hint';
    hint.textContent='Texto libre. Para ingresar a stock debe coincidir con un producto de Inventario.';
    field.appendChild(hint);

    input.addEventListener('input',()=>{
      const text=input.value.trim();
      const p=productByText(text);
      select.value=p?.id||'';
      if(desc)desc.value=text;
      select.dispatchEvent(new Event('input',{bubbles:true}));
      select.dispatchEvent(new Event('change',{bubbles:true}));
    });
    input.addEventListener('change',()=>{
      const p=productByText(input.value);
      select.value=p?.id||'';
      select.dispatchEvent(new Event('input',{bubbles:true}));
      select.dispatchEvent(new Event('change',{bubbles:true}));
    });
  }

  function run(){
    if(profile?.role!=='admin')return;
    enhanceNewPurchaseProduct();
    enhanceEditPurchaseProduct();
  }
  const obs=new MutationObserver(run);
  obs.observe(document.body,{childList:true,subtree:true});
  setTimeout(run,0);
})();
