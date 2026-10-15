// AVH hotfix UI 2026-08-29: alta de depositarios en dos pasos para evitar interferencia del gestor de contraseñas del navegador.
(function(){
const USER_RE=/^[a-z0-9][a-z0-9._-]{1,38}[a-z0-9]$/;
const RESERVED=new Set(['admin','admin.avh','administrador','administrador.avh']);
const goodKey=v=>v.length>=10&&/[A-Z]/.test(v)&&/[a-z]/.test(v)&&/[0-9]/.test(v);
const inventoryOptions=()=>'<option value="">Sin acceso a inventario</option>'+D.warehouses.filter(w=>w.active).map(w=>`<option value="${esc(w.id)}">${esc(w.name)}</option>`).join('');
const productionFields=(prefix,u={})=>`<div class="two"><div class="field"><label for="${prefix}Location">Lugar de trabajo</label><input id="${prefix}Location" maxlength="200" value="${esc(u.work_location||'')}" placeholder="Ej.: Astillero Villa Hayes"></div><div class="field"><label for="${prefix}InventoryWh">Inventario que puede consultar</label><select id="${prefix}InventoryWh">${inventoryOptions()}</select><div class="hint">Consulta de existencias de ese lugar.</div></div></div>`;
function bindLocation(prefix){$('#'+prefix+'InventoryWh').onchange=()=>{const location=$('#'+prefix+'Location');if(!location.value.trim())location.value=D.warehouses.find(w=>w.id===$('#'+prefix+'InventoryWh').value)?.name||'';};}

function maskedInput(id,placeholder){
  return `<div class="line" style="gap:8px;align-items:stretch"><input id="${id}" type="text" inputmode="text" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" placeholder="${placeholder}" style="flex:1;-webkit-text-security:disc"><button type="button" class="btn sm soft" data-key-toggle="${id}">Ver</button></div>`;
}
function bindMaskToggle(root=document){
  root.querySelectorAll('[data-key-toggle]').forEach(btn=>btn.onclick=()=>{const el=document.getElementById(btn.dataset.keyToggle);if(!el)return;const hidden=el.style.webkitTextSecurity!=='none';el.style.webkitTextSecurity=hidden?'none':'disc';btn.textContent=hidden?'Ocultar':'Ver';});
}

window.adminUsers=function(){
  const depositors=D.profiles.filter(u=>u.role==='depositor'),production=D.profiles.filter(u=>u.role==='production'),admins=D.profiles.filter(u=>u.role==='admin');
  const userRows=(users,description)=>users.map(u=>`<div class="row"><div class="line"><div><div class="title">${esc(u.username)}</div><div class="subtext">${esc(u.full_name||'Sin responsable')} · ${esc(description(u))} · ${u.active?'Activo':'Desactivado'}${u.must_change_password?' · Cambio de clave pendiente':''}</div></div><button class="btn sm" data-user-manage="${u.id}">Gestionar</button></div></div>`).join('');
  $('#adminBox').innerHTML=`
    <div class="card">
      <div class="eyebrow">CUENTA ADMINISTRADORA</div>
      ${admins.map(u=>`<div class="line" style="margin-top:8px"><div><div class="title">${esc(u.username)}</div><div class="subtext">Administrador general · sin depósito asignado</div></div><span class="badge green">ADMIN</span></div>`).join('')}
      <div class="notice" style="margin-top:10px">Elegí el perfil según el trabajo de la persona.</div>
    </div>
    <div class="section-head"><div><h2>Agregar usuario</h2><p>Paso 1 de 2 · perfil y datos de la persona</p></div></div>
    <div class="card" id="depositorCreateCard">
      <div class="field"><label for="newUserRole">Perfil de trabajo</label><select id="newUserRole"><option value="depositor">Depositario</option><option value="production">Producción / Órdenes de Trabajo</option></select><div class="hint" id="newUserRoleHint">Recibe, entrega y controla materiales en un depósito.</div></div>
      <div class="two">
        <div class="field"><label for="newUser">Usuario</label><input id="newUser" type="text" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" placeholder="ej.: deposito.villahayes"><div class="hint">3–40 caracteres: minúsculas, números, punto, guion o guion bajo.</div></div>
        <div class="field" id="newUserWarehouseField"><label>Depósito asignado</label><select id="newUserWh" autocomplete="off">${activeWhOptions()}</select></div>
      </div>
      <div class="field"><label>Nombre del responsable</label><input id="newUserName" type="text" autocomplete="off" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" placeholder="Nombre de la persona (opcional)"></div>
      <div id="newProductionFields" hidden>${productionFields('newProduction')}</div>
      <button id="continueCreateUser" type="button" class="btn primary">Continuar y definir clave temporal</button>
      <div id="adminMsg"></div>
    </div>
    <div class="section-head"><h2>Producción / Órdenes de Trabajo</h2></div>
    <div class="list">${userRows(production,u=>[u.work_location||'Lugar pendiente',u.inventory_warehouse_id?'Consulta: '+whName(u.inventory_warehouse_id):'Órdenes de Trabajo'].join(' · '))||'<div class="empty">Todavía no hay usuarios de Producción.</div>'}</div>
    <div class="section-head"><h2>Depositarios</h2></div>
    <div class="list">${userRows(depositors,u=>whName(u.warehouse_id)||'Sin depósito')||'<div class="empty">Todavía no hay depositarios.</div>'}</div>`;

  $('#newUserRole').onchange=()=>{
    const production=$('#newUserRole').value==='production';
    $('#newUserWarehouseField').hidden=production;$('#newUserWh').disabled=production;
    $('#newProductionFields').hidden=!production;
    $('#newUser').placeholder=production?'ej.: galo.produccion':'ej.: deposito.villahayes';
    $('#newUserRoleHint').textContent=production?'Sube Excel, prepara tareas e insumos, emite PDF numerados y registra avances. El panel se habilita al crear la cuenta.':'Recibe, entrega y controla materiales en un depósito.';
  };
  bindLocation('newProduction');

  $('#continueCreateUser').onclick=()=>{
    const msgEl=$('#adminMsg');
    let username=$('#newUser').value.trim().toLowerCase();
    const fullName=$('#newUserName').value.trim();
    const role=$('#newUserRole').value,production=role==='production';
    const warehouseId=production?null:$('#newUserWh').value;
    const label=production?'usuario de Producción':'depositario';
    const workLocation=production?$('#newProductionLocation').value.trim():null,inventoryWarehouseId=production?$('#newProductionInventoryWh').value||null:null;
    $('#newUser').value=username;
    msg(msgEl,'');
    if(!USER_RE.test(username))return msg(msgEl,'Usuario inválido. Usá 3 a 40 caracteres: minúsculas, números, punto, guion o guion bajo.');
    if(RESERVED.has(username))return msg(msgEl,'Ese usuario está reservado para administración.');
    const existing=D.profiles.find(x=>(x.username||'').toLowerCase()===username);
    if(existing)return msg(msgEl,existing.role==='admin'?'Ese usuario pertenece a administración.':`Ese usuario ya existe (${existing.active?'activo':'desactivado'}). Usá “Gestionar”.`);
    if(!production&&!warehouseId)return msg(msgEl,'Elegí el depósito que va a manejar.');
    if(workLocation?.length>200)return msg(msgEl,'El lugar de trabajo admite hasta 200 caracteres.');
    if(fullName&&admins.some(a=>(a.username||'').toLowerCase()===fullName.toLowerCase()))return msg(msgEl,'En “Nombre del responsable” escribí el nombre de la persona, no tu usuario admin.');

    const wh=production?'Producción / Órdenes de Trabajo':whName(warehouseId);
    openModal('Crear '+label,'Paso 2 de 2 · clave temporal',`
      <div class="notice"><b>${esc(username)}</b><br>${esc(fullName||'Sin nombre de responsable')} · ${esc(wh)}${production?'<br>'+esc(workLocation||'Lugar pendiente')+(inventoryWarehouseId?' · Consulta: '+esc(whName(inventoryWarehouseId)):''):''}</div>
      <div class="field"><label>Clave temporal</label>${maskedInput('tempAccessKey','Mínimo 10 caracteres')}</div>
      <div class="hint">Debe incluir mayúscula, minúscula y número. Este campo está aislado para que Chrome no lo confunda con el login del administrador.</div>
      <button id="confirmCreateDepositor" type="button" class="btn primary" style="width:100%;margin-top:12px">Crear ${label}</button>
      <div id="createDepositorMsg"></div>`);
    bindMaskToggle(document);
    setTimeout(()=>$('#tempAccessKey')?.focus(),50);

    $('#confirmCreateDepositor').onclick=async()=>{
      const b=$('#confirmCreateDepositor'),key=$('#tempAccessKey').value,msgEl2=$('#createDepositorMsg');
      if(!goodKey(key))return msg(msgEl2,'La clave temporal debe tener mínimo 10 caracteres, mayúscula, minúscula y número.');
      b.disabled=true;b.textContent='Creando usuario…';
      const r=await edge('admin-create-user',{username,role,warehouse_id:warehouseId,password:key,full_name:fullName,...(production?{work_location:workLocation,inventory_warehouse_id:inventoryWarehouseId}:{})});
      b.disabled=false;b.textContent='Crear '+label;
      if(r.error)return msg(msgEl2,r.error);
      const created=r.data?.user;
      if(!created||created.role!==role||created.warehouse_id!==warehouseId)return msg(msgEl2,'El servidor no confirmó correctamente el perfil.');
      if(production&&((created.work_location||'')!==(workLocation||'')||(created.inventory_warehouse_id||null)!==inventoryWarehouseId))return msg(msgEl2,'El servidor no confirmó el lugar o el inventario autorizado. Revisá el usuario en Gestionar.');
      await loadAll(true);
      const check=D.profiles.find(x=>x.id===created.id);
      if(!check||check.role!==role||check.warehouse_id!==warehouseId)return msg(msgEl2,'La verificación final del usuario no coincidió.');
      closeModal();
      renderAdmin('users');
      setTimeout(()=>{const m=$('#adminMsg');if(m)msg(m,production?`Usuario ${username} creado con acceso a Órdenes de Trabajo.`:`Depositario ${username} creado correctamente en ${wh}.`,true)},50);
    };
  };
  $$('[data-user-manage]').forEach(x=>x.onclick=()=>manageUser(x.dataset.userManage));
};

window.manageUser=function(id){
  const u=D.profiles.find(x=>x.id===id);
  if(!u||!['depositor','production'].includes(u.role))return alert('Elegí un usuario de Depósito o Producción.');
  if(profile?.id===id)return alert('La cuenta administradora no se gestiona desde aquí.');
  const production=u.role==='production';
  const update=args=>production?rpc('admin_update_work_order_user',{p_user_id:id,p_active:args.p_active??null,p_full_name:args.p_full_name??null,...('p_work_location' in args?{p_work_location:args.p_work_location,p_inventory_warehouse_id:args.p_inventory_warehouse_id}:{})}):rpc('admin_update_depositor',{p_user_id:id,p_active:null,p_warehouse_id:null,p_full_name:null,...args});
  openModal(u.username,production?'Gestión de Producción':'Gestión de depositario',`
    <div class="notice">Perfil: <b>${production?'PRODUCCIÓN / ÓRDENES DE TRABAJO':'DEPOSITARIO'}</b>.</div>
    <div class="field"><label>Nombre del responsable</label><input id="manageFullName" type="text" autocomplete="off" data-lpignore="true" data-1p-ignore="true" value="${esc(u.full_name||'')}" placeholder="Opcional"></div>
    ${production?productionFields('manageProduction',u):'<div class="field"><label>Depósito asignado</label><select id="manageWh">'+activeWhOptions()+'</select></div>'}
    <div class="split-actions"><button id="saveUserProfile" class="btn primary">Guardar datos</button><button id="toggleUser" class="btn ${u.active?'danger':'soft'}">${u.active?'Desactivar':'Activar'}</button></div>
    <div class="divider"></div>
    <div class="field"><label>Nueva clave temporal</label>${maskedInput('resetAccessKey','Mínimo 10 caracteres')}</div>
    <button id="resetUserPass" type="button" class="btn">Restablecer clave</button><div id="manageMsg"></div>`);
  bindMaskToggle(document);
  if(!production)$('#manageWh').value=u.warehouse_id||'';
  else{$('#manageProductionInventoryWh').value=u.inventory_warehouse_id||'';bindLocation('manageProduction');}
  $('#saveUserProfile').onclick=async()=>{
    const name=$('#manageFullName').value.trim(),wh=production?null:$('#manageWh').value;
    if(!production&&!wh)return msg($('#manageMsg'),'Elegí un depósito.');
    if(name&&D.profiles.filter(x=>x.role==='admin').some(a=>(a.username||'').toLowerCase()===name.toLowerCase()))return msg($('#manageMsg'),'El nombre del responsable no puede ser tu usuario admin.');
    const r=await update({p_warehouse_id:wh,p_full_name:name,...(production?{p_work_location:$('#manageProductionLocation').value.trim()||null,p_inventory_warehouse_id:$('#manageProductionInventoryWh').value||null}:{})});
    if(r.error)return msg($('#manageMsg'),r.error);
    msg($('#manageMsg'),'Datos actualizados.',true);await loadAll(true);
  };
  $('#toggleUser').onclick=async()=>{const r=await update({p_active:!u.active});if(r.error)return msg($('#manageMsg'),r.error);await loadAll(true);closeModal()};
  $('#resetUserPass').onclick=async()=>{const key=$('#resetAccessKey').value;if(!goodKey(key))return msg($('#manageMsg'),'La clave debe tener mínimo 10 caracteres, mayúscula, minúscula y número.');const r=await edge('admin-reset-user-password',{user_id:id,password:key});if(r.error)return msg($('#manageMsg'),r.error);msg($('#manageMsg'),'Clave temporal restablecida. Se pedirá cambio al ingresar.',true);$('#resetAccessKey').value=''};
};

const previousRenderAdmin=window.renderAdmin;
window.renderAdmin=function(tab){previousRenderAdmin(tab);if(tab==='users')window.adminUsers()};
})();
