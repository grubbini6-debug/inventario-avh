// AVH hotfix UI 2026-08-29: alta de depositarios en dos pasos para evitar interferencia del gestor de contraseñas del navegador.
(function(){
const USER_RE=/^[a-z0-9](?:[a-z0-9._-]{1,38}[a-z0-9])?$/;
const RESERVED=new Set(['admin','admin.avh','administrador','administrador.avh']);
const goodKey=v=>v.length>=10&&/[A-Z]/.test(v)&&/[a-z]/.test(v)&&/[0-9]/.test(v);

function maskedInput(id,placeholder){
  return `<div class="line" style="gap:8px;align-items:stretch"><input id="${id}" type="text" inputmode="text" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" data-bwignore="true" placeholder="${placeholder}" style="flex:1;-webkit-text-security:disc"><button type="button" class="btn sm soft" data-key-toggle="${id}">Ver</button></div>`;
}
function bindMaskToggle(root=document){
  root.querySelectorAll('[data-key-toggle]').forEach(btn=>btn.onclick=()=>{const el=document.getElementById(btn.dataset.keyToggle);if(!el)return;const hidden=el.style.webkitTextSecurity!=='none';el.style.webkitTextSecurity=hidden?'none':'disc';btn.textContent=hidden?'Ocultar':'Ver';});
}

window.adminUsers=function(){
  const depositors=D.profiles.filter(u=>u.role==='depositor'),admins=D.profiles.filter(u=>u.role==='admin');
  $('#adminBox').innerHTML=`
    <div class="card">
      <div class="eyebrow">CUENTA ADMINISTRADORA</div>
      ${admins.map(u=>`<div class="line" style="margin-top:8px"><div><div class="title">${esc(u.username)}</div><div class="subtext">Administrador general · sin depósito asignado</div></div><span class="badge green">ADMIN</span></div>`).join('')}
      <div class="notice" style="margin-top:10px">Los depositarios se crean en un flujo separado. Tu cuenta administradora no se usa ni se modifica.</div>
    </div>
    <div class="section-head"><div><h2>Agregar depositario</h2><p>Paso 1 de 2 · datos del usuario y depósito</p></div></div>
    <div class="card" id="depositorCreateCard">
      <div class="two">
        <div class="field"><label>Usuario del depositario</label><input id="newUser" type="text" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" placeholder="ej.: galo.deposito"><div class="hint">3–40 caracteres: minúsculas, números, punto, guion o guion bajo.</div></div>
        <div class="field"><label>Depósito asignado</label><select id="newUserWh" autocomplete="off">${activeWhOptions()}</select></div>
      </div>
      <div class="field"><label>Nombre del responsable</label><input id="newUserName" type="text" autocomplete="off" autocorrect="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" placeholder="Nombre de la persona (opcional)"></div>
      <button id="continueCreateUser" type="button" class="btn primary">Continuar y definir clave temporal</button>
      <div id="adminMsg"></div>
    </div>
    <div class="section-head"><h2>Depositarios</h2></div>
    <div class="list">${depositors.map(u=>`<div class="row"><div class="line"><div><div class="title">${esc(u.username)}</div><div class="subtext">${esc(u.full_name||'Sin responsable')} · ${esc(whName(u.warehouse_id)||'Sin depósito')} · ${u.active?'Activo':'Desactivado'}${u.must_change_password?' · Cambio de clave pendiente':''}</div></div><button class="btn sm" data-user-manage="${u.id}">Gestionar</button></div></div>`).join('')||'<div class="empty">Todavía no hay depositarios.</div>'}</div>`;

  $('#continueCreateUser').onclick=()=>{
    const msgEl=$('#adminMsg');
    let username=$('#newUser').value.trim().toLowerCase();
    const fullName=$('#newUserName').value.trim();
    const warehouseId=$('#newUserWh').value;
    $('#newUser').value=username;
    msg(msgEl,'');
    if(!USER_RE.test(username))return msg(msgEl,'Usuario inválido. Usá 3 a 40 caracteres: minúsculas, números, punto, guion o guion bajo.');
    if(RESERVED.has(username))return msg(msgEl,'Ese usuario está reservado para administración.');
    const existing=D.profiles.find(x=>(x.username||'').toLowerCase()===username);
    if(existing)return msg(msgEl,existing.role==='depositor'?`Ese depositario ya existe (${existing.active?'activo':'desactivado'}). Usá “Gestionar”.`:'Ese usuario pertenece a administración.');
    if(!warehouseId)return msg(msgEl,'Elegí el depósito que va a manejar.');
    if(fullName&&admins.some(a=>(a.username||'').toLowerCase()===fullName.toLowerCase()))return msg(msgEl,'En “Nombre del responsable” escribí el nombre de la persona, no tu usuario admin.');

    const wh=whName(warehouseId);
    openModal('Crear depositario','Paso 2 de 2 · clave temporal',`
      <div class="notice"><b>${esc(username)}</b><br>${esc(fullName||'Sin nombre de responsable')} · ${esc(wh)}</div>
      <div class="field"><label>Clave temporal</label>${maskedInput('tempAccessKey','Mínimo 10 caracteres')}</div>
      <div class="hint">Debe incluir mayúscula, minúscula y número. Este campo está aislado para que Chrome no lo confunda con el login del administrador.</div>
      <button id="confirmCreateDepositor" type="button" class="btn primary" style="width:100%;margin-top:12px">Crear depositario</button>
      <div id="createDepositorMsg"></div>`);
    bindMaskToggle(document);
    setTimeout(()=>$('#tempAccessKey')?.focus(),50);

    $('#confirmCreateDepositor').onclick=async()=>{
      const b=$('#confirmCreateDepositor'),key=$('#tempAccessKey').value,msgEl2=$('#createDepositorMsg');
      if(!goodKey(key))return msg(msgEl2,'La clave temporal debe tener mínimo 10 caracteres, mayúscula, minúscula y número.');
      b.disabled=true;b.textContent='Creando depositario…';
      const r=await edge('admin-create-user',{username,warehouse_id:warehouseId,password:key,full_name:fullName});
      b.disabled=false;b.textContent='Crear depositario';
      if(r.error)return msg(msgEl2,r.error);
      const created=r.data?.user;
      if(!created||created.role!=='depositor'||created.warehouse_id!==warehouseId)return msg(msgEl2,'El servidor no confirmó correctamente el perfil. No uses este usuario.');
      await loadAll(true);
      const check=D.profiles.find(x=>x.id===created.id);
      if(!check||check.role!=='depositor'||check.warehouse_id!==warehouseId)return msg(msgEl2,'La verificación final del depositario no coincidió.');
      closeModal();
      renderAdmin('users');
      setTimeout(()=>{const m=$('#adminMsg');if(m)msg(m,`Depositario ${username} creado correctamente en ${wh}.`,true)},50);
    };
  };
  $$('[data-user-manage]').forEach(x=>x.onclick=()=>manageUser(x.dataset.userManage));
};

window.manageUser=function(id){
  const u=D.profiles.find(x=>x.id===id);
  if(!u||u.role!=='depositor')return alert('Solo se gestionan depositarios desde aquí.');
  if(profile?.id===id)return alert('La cuenta administradora no se puede gestionar como depositario.');
  openModal(u.username,'Gestión de depositario',`
    <div class="notice">Rol: <b>DEPOSITARIO</b>. La cuenta admin queda separada.</div>
    <div class="field"><label>Nombre del responsable</label><input id="manageFullName" type="text" autocomplete="off" data-lpignore="true" data-1p-ignore="true" value="${esc(u.full_name||'')}" placeholder="Opcional"></div>
    <div class="field"><label>Depósito asignado</label><select id="manageWh">${activeWhOptions()}</select></div>
    <div class="split-actions"><button id="saveUserProfile" class="btn primary">Guardar datos</button><button id="toggleUser" class="btn ${u.active?'danger':'soft'}">${u.active?'Desactivar':'Activar'}</button></div>
    <div class="divider"></div>
    <div class="field"><label>Nueva clave temporal</label>${maskedInput('resetAccessKey','Mínimo 10 caracteres')}</div>
    <button id="resetUserPass" type="button" class="btn">Restablecer clave</button><div id="manageMsg"></div>`);
  bindMaskToggle(document);
  $('#manageWh').value=u.warehouse_id||'';
  $('#saveUserProfile').onclick=async()=>{
    const name=$('#manageFullName').value.trim(),wh=$('#manageWh').value;
    if(!wh)return msg($('#manageMsg'),'Elegí un depósito.');
    if(name&&D.profiles.filter(x=>x.role==='admin').some(a=>(a.username||'').toLowerCase()===name.toLowerCase()))return msg($('#manageMsg'),'El nombre del responsable no puede ser tu usuario admin.');
    const r=await rpc('admin_update_depositor',{p_user_id:id,p_active:null,p_warehouse_id:wh,p_full_name:name});
    if(r.error)return msg($('#manageMsg'),r.error);
    msg($('#manageMsg'),'Datos actualizados.',true);await loadAll(true);
  };
  $('#toggleUser').onclick=async()=>{const r=await rpc('admin_update_depositor',{p_user_id:id,p_active:!u.active,p_warehouse_id:null,p_full_name:null});if(r.error)return msg($('#manageMsg'),r.error);await loadAll(true);closeModal()};
  $('#resetUserPass').onclick=async()=>{const key=$('#resetAccessKey').value;if(!goodKey(key))return msg($('#manageMsg'),'La clave debe tener mínimo 10 caracteres, mayúscula, minúscula y número.');const r=await edge('admin-reset-user-password',{user_id:id,password:key});if(r.error)return msg($('#manageMsg'),r.error);msg($('#manageMsg'),'Clave temporal restablecida. Se pedirá cambio al ingresar.',true);$('#resetAccessKey').value=''};
};

const previousRenderAdmin=window.renderAdmin;
window.renderAdmin=function(tab){previousRenderAdmin(tab);if(tab==='users')window.adminUsers()};
})();
