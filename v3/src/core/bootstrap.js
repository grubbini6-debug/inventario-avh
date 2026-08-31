// AVH V3 — Único punto de arranque de la aplicación.
async function boot(){
  try{
    session=readSession();
    if(!session){showApp(false);return}
    if(session.expires_at&&Date.now()>session.expires_at-45000&&!await refreshSession()){showApp(false);return}
    const r=await query('profiles','*',`id=eq.${session.user.id}`);profile=r.data?.[0];
    if(r.error||!profile||!profile.active){saveSession(null);showApp(false);return}

    // Primer ingreso: no intentamos cargar el tablero todavía.
    if(profile.must_change_password){
      forcePassword();
      return;
    }

    // Los módulos administrativos se ocultan antes de cargar datos.
    $('#adminModule').style.display=profile.role==='admin'?'':'none';
    $('#auditModule').style.display=profile.role==='admin'?'':'none';

    // Cargamos primero los datos permitidos por RLS. Así un depositario nunca
    // depende de catálogos aún vacíos para completar el encabezado o el tablero.
    await loadAll(true);

    $('#who').textContent=profile.role==='admin'
      ?'Administrador general'
      :`${profile.username} · ${whName(profile.warehouse_id)||'Depósito asignado'}`;
    showApp(true);

    clearInterval(refreshTimer);
    refreshTimer=setInterval(()=>loadAll(false),20000);
  }catch(err){
    console.error('AVH boot error',err);
    clearInterval(refreshTimer);
    const login=$('#login');
    const main=$('#main');
    if(main)main.classList.add('hide');
    if(login){
      login.classList.remove('hide');
      login.innerHTML=`<div class="login-card"><div class="login-logo">AVH</div><h1>No se pudo abrir la sesión</h1><p>Ocurrió un error al cargar tu depósito. Tus datos no fueron modificados.</p><div class="error">${esc(err?.message||'Error de carga')}</div><button class="btn primary" id="bootRetry" style="width:100%;margin-top:12px">Reintentar</button><button class="btn" id="bootLogout" style="width:100%;margin-top:8px">Cerrar sesión</button></div>`;
      $('#bootRetry').onclick=()=>location.reload();
      $('#bootLogout').onclick=()=>signOut();
    }
    throw err;
  }
}
function bindBootstrapEvents(){
  $('#loginForm').onsubmit=async e=>{
    e.preventDefault();msg($('#loginMsg'),'');const b=e.submitter;b.disabled=true;b.textContent='Ingresando…';
    const r=await signIn($('#loginUser').value.trim().toLowerCase(),$('#loginPass').value);b.disabled=false;b.textContent='Ingresar';
    if(r.error)return msg($('#loginMsg'),'Usuario o contraseña incorrectos.');await boot();
  };
  $('#logoutBtn').onclick=signOut;
  $('#refreshBtn').onclick=()=>loadAll(true);
}
bindBootstrapEvents();
boot()
  .then(()=>{document.documentElement.dataset.avhBoot='ok'})
  .catch(err=>{document.documentElement.dataset.avhBoot='error';console.error('AVH boot error',err)});
