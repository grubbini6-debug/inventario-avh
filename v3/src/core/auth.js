// AVH V3 — Autenticación y cambio obligatorio de contraseña.
async function signIn(user,password){const email=user.includes('@')?user:`${user}@avh.local`;const r=await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}});if(r.error)return r;saveSession({...r.data,expires_at:Date.now()+Number(r.data.expires_in||3600)*1000});return r}
async function signOut(){const old=session;saveSession(null);profile=null;clearInterval(refreshTimer);showApp(false);const pass=$('#loginPass');if(pass)pass.value='';try{if(old?.access_token){session=old;await request('/auth/v1/logout',{method:'POST'},false)}}catch{}session=null;location.reload()}
function forcePassword(){
  const login=$('#login'),main=$('#main');
  if(main)main.classList.add('hide');
  if(!login)throw new Error('No se encontró la pantalla de autenticación.');
  login.classList.remove('hide');
  login.innerHTML=`<div class="login-card"><div class="login-logo">AVH</div><h1>Cambiar contraseña</h1><p>Es tu primer ingreso. Elegí una contraseña propia para continuar.</p><form id="pwForm"><div class="field"><label>Nueva contraseña</label><input autocomplete="new-password" id="pw1" type="password"></div><div class="field"><label>Repetir contraseña</label><input autocomplete="new-password" id="pw2" type="password"></div><div id="pwMsg"></div><button class="btn primary" id="pwSave" style="width:100%">Guardar y entrar</button></form><button class="btn" id="pwLogout" style="width:100%;margin-top:8px">Cerrar sesión</button><div class="foot">Astillero Villa Hayes · Primer ingreso</div></div>`;
  $('#pwLogout').onclick=()=>signOut();
  $('#pwForm').onsubmit=async e=>{
    e.preventDefault();
    const a=$('#pw1').value,b=$('#pw2').value,btn=$('#pwSave');
    if(a!==b||a.length<10||!/[A-Z]/.test(a)||!/[a-z]/.test(a)||!/[0-9]/.test(a))return msg($('#pwMsg'),'Mínimo 10 caracteres, con mayúscula, minúscula y número.');
    btn.disabled=true;btn.textContent='Guardando…';msg($('#pwMsg'),'');
    let r=await request('/auth/v1/user',{method:'PUT',body:{password:a}});
    if(r.error){btn.disabled=false;btn.textContent='Guardar y entrar';return msg($('#pwMsg'),r.error)}
    r=await rpc('complete_password_change');
    if(r.error){btn.disabled=false;btn.textContent='Guardar y entrar';return msg($('#pwMsg'),r.error)}
    profile.must_change_password=false;
    location.reload();
  };
}
