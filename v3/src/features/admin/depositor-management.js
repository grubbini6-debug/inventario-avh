// AVH hotfix UI 2026-08-29: alta de depositarios sin autofill/confusión con admin.
(function(){
const DEPOSITOR_USER_RE=/^[a-z0-9](?:[a-z0-9._-]{1,38}[a-z0-9])?$/;
const RESERVED_USERS=new Set(['admin','admin.avh','administrador','administrador.avh']);
function validTempPassword(v){return v.length>=10&&/[A-Z]/.test(v)&&/[a-z]/.test(v)&&/[0-9]/.test(v)}

window.adminUsers=function(){
  const depositors=D.profiles.filter(u=>u.role==='depositor'),admins=D.profiles.filter(u=>u.role==='admin');
  $('#adminBox').innerHTML=`
  <div class="card">
    <div class="eyebrow">CUENTA ADMINISTRADORA</div>
    ${admins.map(u=>`<div class="line" style="margin-top:8px"><div><div class="title">${esc(u.username)}</div><div class="subtext">Administrador general · sin depósito asignado</div></div><span class="badge green">ADMIN</span></div>`).join('')}
    <div class="notice" style="margin-top:10px">Crear o gestionar un depositario <b>no modifica tu cuenta administradora</b>.</div>
  </div>
  <div class="section-head"><div><h2>Agregar depositario</h2><p>Se crea siempre con rol DEPOSITARIO y un solo depósito</p></div></div>
  <div class="card" id="depositorCreateCard">
    <div class="two">
      <div class="field"><label>Usuario del depositario</label><input id="newUser" name="avh_new_depositor_username" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="ej.: galo.deposito"><div class="hint">3–40 caracteres: letras minúsculas, números, punto, guion o guion bajo.</div></div>
      <div class="field"><label>Depósito asignado</label><select id="newUserWh" name="avh_new_depositor_warehouse" autocomplete="off">${activeWhOptions()}</select></div>
    </div>
    <div class="two">
      <div class="field"><label>Nombre del responsable</label><input id="newUserName" name="avh_new_depositor_person" autocomplete="off" data-lpignore="true" placeholder="Nombre de la persona (opcional)"><div class="hint">No pongas acá tu usuario admin.</div></div>
      <div class="field"><label>Contraseña temporal</label><div class="line" style="gap:8px;align-items:stretch"><input id="newUserPass" name="avh_new_depositor_password" type="password" autocomplete="new-password" data-lpignore="true" placeholder="Contraseña temporal" style="flex:1"><button type="button" id="toggleNewUserPass" class="btn sm soft">Ver</button></div><div class="hint">Mínimo 10 caracteres, con mayúscula, minúscula y número.</div></div>
    </div>
    <button id="createUser" class="btn primary">Crear depositario</button>
    <div id="adminMsg"></div>
  </div>
  <div class="section-head"><h2>Depositarios</h2></div>
  <div class="list">${depositors.map(u=>`<div class="row"><div class="line"><div><div class="title">${esc(u.username)}</div><div class="subtext">${esc(u.full_name||'Sin responsable')} · ${esc(whName(u.warehouse_id)||'Sin depósito')} · ${u.active?'Activo':'Desactivado'}${u.must_change_password?' · Cambio de contraseña pendiente':''}</div></div><button class="btn sm" data-user-manage="${u.id}">Gestionar</button></div></div>`).join('')||'<div class="empty">Todavía no hay depositarios.</div>'}</div>`;

  const pass=$('#newUserPass'),toggle=$('#toggleNewUserPass');
  if(toggle)toggle.onclick=()=>{pass.type=pass.type==='password'?'text':'password';toggle.textContent=pass.type==='password'?'Ver':'Ocultar'};

  $('#createUser').onclick=async()=>{
    const b=$('#createUser'),msgEl=$('#adminMsg');
    let username=$('#newUser').value.trim().toLowerCase();
    let fullName=$('#newUserName').value.trim();
    const password=$('#newUserPass').value,warehouseId=$('#newUserWh').value;
    $('#newUser').value=username;
    msg(msgEl,'');
    if(!DEPOSITOR_USER_RE.test(username))return msg(msgEl,'Usuario inválido. Usá 3 a 40 caracteres: letras minúsculas, números, punto, guion o guion bajo.');
    if(RESERVED_USERS.has(username))return msg(msgEl,'Ese usuario está reservado para administración. Elegí otro nombre para el depositario.');
    const existing=D.profiles.find(x=>(x.username||'').toLowerCase()===username);
    if(existing)return msg(msgEl,existing.role==='depositor'?`Ese depositario ya existe (${existing.active?'activo':'desactivado'}). Usá “Gestionar” en la lista de abajo.`:'Ese usuario pertenece a administración y no puede reutilizarse.');
    if(!warehouseId)return msg(msgEl,'Elegí el depósito que va a manejar.');
    if(!validTempPassword(password))return msg(msgEl,'La contraseña temporal debe tener mínimo 10 caracteres, mayúscula, minúscula y número.');
    const adminNames=admins.map(a=>(a.username||'').toLowerCase());
    if(fullName&&adminNames.includes(fullName.toLowerCase())){
      $('#newUserName').value='';fullName='';
      return msg(msgEl,'El navegador había puesto tu usuario admin en “Nombre del responsable”. Lo limpié para que no se mezclen las cuentas. Escribí el nombre de la persona o dejalo vacío y volvé a crear.');
    }
    b.disabled=true;b.textContent='Creando depositario…';
    const r=await edge('admin-create-user',{username,warehouse_id:warehouseId,password,full_name:fullName});
    b.disabled=false;b.textContent='Crear depositario';
    if(r.error)return msg(msgEl,r.error);
    const created=r.data?.user;
    if(!created||created.role!=='depositor'||created.warehouse_id!==warehouseId)return msg(msgEl,'El servidor no confirmó correctamente el perfil. No uses este usuario y avisá al administrador.');
    await loadAll(true);
    const check=D.profiles.find(x=>x.id===created.id);
    if(!check||check.role!=='depositor')return msg(msgEl,'El acceso fue creado pero la verificación visual no terminó. Recargá la página antes de usarlo.');
    msg(msgEl,`Depositario ${username} creado correctamente en ${whName(warehouseId)}. Tu cuenta admin sigue separada.`,true);
    $('#newUser').value='';$('#newUserName').value='';$('#newUserPass').value='';
    setTimeout(()=>renderAdmin('users'),500);
  };
  $$('[data-user-manage]').forEach(x=>x.onclick=()=>manageUser(x.dataset.userManage));
};

window.manageUser=function(id){
  const u=D.profiles.find(x=>x.id===id);
  if(!u||u.role!=='depositor')return alert('Solo se gestionan depositarios desde aquí.');
  if(profile?.id===id)return alert('La cuenta administradora no se puede gestionar como depositario.');
  openModal(u.username,'Gestión de depositario',`
    <div class="notice">Rol: <b>DEPOSITARIO</b>. Tu cuenta administradora no se toca.</div>
    <div class="field"><label>Nombre del responsable</label><input id="manageFullName" autocomplete="off" data-lpignore="true" value="${esc(u.full_name||'')}" placeholder="Opcional"></div>
    <div class="field"><label>Depósito asignado</label><select id="manageWh">${activeWhOptions()}</select></div>
    <div class="split-actions"><button id="saveUserProfile" class="btn primary">Guardar datos</button><button id="toggleUser" class="btn ${u.active?'danger':'soft'}">${u.active?'Desactivar':'Activar'}</button></div>
    <div class="divider"></div>
    <div class="field"><label>Nueva contraseña temporal</label><input id="resetPass" type="password" autocomplete="new-password" data-lpignore="true" placeholder="Mínimo 10 caracteres, mayúscula, minúscula y número"></div>
    <button id="resetUserPass" class="btn">Restablecer contraseña</button><div id="manageMsg"></div>`);
  $('#manageWh').value=u.warehouse_id||'';
  $('#saveUserProfile').onclick=async()=>{
    const name=$('#manageFullName').value.trim(),wh=$('#manageWh').value;
    if(!wh)return msg($('#manageMsg'),'Elegí un depósito.');
    if(name&&D.profiles.filter(x=>x.role==='admin').some(a=>(a.username||'').toLowerCase()===name.toLowerCase()))return msg($('#manageMsg'),'El nombre del responsable no puede ser tu usuario admin.');
    const r=await rpc('admin_update_depositor',{p_user_id:id,p_active:null,p_warehouse_id:wh,p_full_name:name});
    if(r.error)return msg($('#manageMsg'),r.error);
    msg($('#manageMsg'),'Datos del depositario actualizados.',true);await loadAll(true);
  };
  $('#toggleUser').onclick=async()=>{const r=await rpc('admin_update_depositor',{p_user_id:id,p_active:!u.active,p_warehouse_id:null,p_full_name:null});if(r.error)return msg($('#manageMsg'),r.error);await loadAll(true);closeModal()};
  $('#resetUserPass').onclick=async()=>{const p=$('#resetPass').value;if(!validTempPassword(p))return msg($('#manageMsg'),'La contraseña debe tener mínimo 10 caracteres, mayúscula, minúscula y número.');const r=await edge('admin-reset-user-password',{user_id:id,password:p});if(r.error)return msg($('#manageMsg'),r.error);msg($('#manageMsg'),'Contraseña temporal restablecida. Se pedirá cambio al ingresar.',true);$('#resetPass').value=''};
};

const prevRenderAdmin=window.renderAdmin;
window.renderAdmin=function(tab){prevRenderAdmin(tab);if(tab==='users')window.adminUsers()};
})();