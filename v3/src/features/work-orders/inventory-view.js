// Read-only stock for the warehouse explicitly assigned to a Production account.
(function(){
 const S={user:null,data:null,error:'',pending:null};
 const allowed=()=>profile?.role==='production'&&S.user===profile.id&&!!S.data?.warehouse;
 const page=()=>$('#page-production-inventory');
 const normal=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 function navigation(){
  $$('.production-inventory-nav').forEach(b=>{b.classList.toggle('hide',!allowed());b.style.display=allowed()?'':'none';});
  document.body.classList.toggle('production-inventory-authorized',allowed());
 }
 function list(){
  const root=page();if(!root)return;
  const query=normal($('#productionStockSearch')?.value),critical=$('#productionStockFilter')?.value==='critical';
  const rows=(S.data?.items||[]).filter(x=>(!query||normal(x.product_name).includes(query))&&(!critical||(x.minimum_qty!=null&&Number(x.stock_qty)<=Number(x.minimum_qty))));
  const host=$('#productionStockRows');if(!host)return;
  host.innerHTML=rows.map(x=>`<tr><td>${esc(x.product_name)}</td><td class="num">${fmt(x.stock_qty)}</td><td>${esc(x.base_unit)}</td><td>${x.minimum_qty==null?'Sin definir':fmt(x.minimum_qty)}</td><td><span class="badge ${x.minimum_qty!=null&&Number(x.stock_qty)<=Number(x.minimum_qty)?'amber':'green'}">${x.minimum_qty!=null&&Number(x.stock_qty)<=Number(x.minimum_qty)?'Bajo mínimo':'Disponible'}</span></td></tr>`).join('')||'<tr><td colspan="5">No hay existencias para esta búsqueda.</td></tr>';
  $('#productionStockCount').textContent=rows.length+' productos';
 }
 function render(){
  const root=page();if(!root)return;
  if(!allowed()){root.innerHTML=`<div class="card"><h2>Consulta de inventario</h2><p>${esc(S.error||'Administración puede habilitar el inventario de tu lugar de trabajo desde tu cuenta de Producción.')}</p></div>`;return;}
  if(!$('#productionStockSearch')){
   root.innerHTML='<div class="section-head"><div><div class="eyebrow">CONSULTA DE EXISTENCIAS</div><h2 id="productionStockTitle"></h2><p id="productionStockLocation"></p></div><button type="button" class="btn" id="productionStockRefresh">Actualizar</button></div><p class="hint" id="productionStockUpdated"></p><div class="card"><div class="two"><div class="field"><label for="productionStockSearch">Buscar material</label><input id="productionStockSearch" type="search" placeholder="Nombre del material"></div><div class="field"><label for="productionStockFilter">Mostrar</label><select id="productionStockFilter"><option value="all">Todas las existencias</option><option value="critical">Bajo mínimo</option></select></div></div><p id="productionStockCount"></p><div class="wo-table-wrap"><table class="wo-table"><thead><tr><th>Material</th><th>Disponible</th><th>Unidad</th><th>Mínimo</th><th>Estado</th></tr></thead><tbody id="productionStockRows"></tbody></table></div></div>';
   $('#productionStockSearch').oninput=list;$('#productionStockFilter').onchange=list;
   $('#productionStockRefresh').onclick=async()=>{const b=$('#productionStockRefresh');b.disabled=true;try{await refresh();}finally{if(b.isConnected)b.disabled=false;}};
  }
  $('#productionStockTitle').textContent='Inventario · '+S.data.warehouse.name;
  $('#productionStockLocation').textContent=S.data.work_location||S.data.warehouse.name;
  $('#productionStockUpdated').textContent='Existencias registradas · Actualizado '+dt(S.data.updated_at);
  list();
 }
 async function refresh(){
  if(profile?.role!=='production'){S.user=null;S.data=null;S.error='';navigation();return;}
  const owner=profile.id;
  if(S.user!==owner){S.user=owner;S.data=null;S.error='';}
  if(S.pending?.user===owner)return S.pending.promise;
  const promise=(async()=>{
   try{
    let after=null,data=null;const items=[],seen=new Set();
    do{
     const r=await rpc('work_order_inventory',{p_after:after});
     if(profile?.id!==owner)return;
     if(r.error)throw Error(r.error);
     if(!r.data||!Array.isArray(r.data.items))throw Error('No se pudo verificar la consulta de inventario.');
     if(data&&data.warehouse?.id!==r.data.warehouse?.id)throw Error('El permiso de inventario cambió. Volvé a actualizar.');
     data=r.data;items.push(...data.items);after=data.next_cursor;
     if(after&&(seen.has(after)||items.length>=100000))throw Error('La consulta supera el límite disponible. Pedí a Administración que revise el inventario.');
     if(after)seen.add(after);
    }while(after);
    data.items=items.sort((a,b)=>a.product_name.localeCompare(b.product_name,'es'));
    S.data=data;S.error='';profile.work_location=data.work_location;profile.inventory_warehouse_id=data.warehouse?.id||null;
   }catch(err){if(profile?.id!==owner)return;S.data=null;S.error=err.message||String(err);}
   navigation();
   if(page()?.classList.contains('on')){render();if(!S.error&&!allowed())goPage('work-orders');}
  })();
  S.pending={user:owner,promise};try{return await promise;}finally{if(S.pending?.promise===promise)S.pending=null;}
 }
 function stock(productId,warehouseId){if(!allowed()||S.data.warehouse.id!==warehouseId)return null;return Number(S.data.items.find(x=>x.product_id===productId)?.stock_qty||0);}
 const baseGo=window.goPage;
 window.goPage=function(name){if(name==='production-inventory'&&!allowed())name='work-orders';const r=baseGo.call(this,name);if(name==='production-inventory'){render();void refresh();}return r;};
 const baseLoad=window.loadAll;
 window.loadAll=async function(){const r=await baseLoad.apply(this,arguments);await refresh();return r;};
 window.AVHProductionInventory={refresh,allowed,stock,state:S};
})();
