// AVH V3 — Único punto de arranque de la aplicación.
async function boot(){
  session=readSession();
  if(!session){showApp(false);return}
  if(session.expires_at&&Date.now()>session.expires_at-45000&&!await refreshSession()){showApp(false);return}
  const r=await query('profiles','*',`id=eq.${session.user.id}`);profile=r.data?.[0];
  if(r.error||!profile||!profile.active){saveSession(null);showApp(false);return}
  if(profile.must_change_password)return forcePassword();
  showApp(true);
  $('#who').textContent=profile.role==='admin'?'Administrador general':`${profile.username} · ${whName(profile.warehouse_id)}`;
  $('#adminModule').style.display=profile.role==='admin'?'':'none';
  $('#auditModule').style.display=profile.role==='admin'?'':'none';
  await loadAll(true);
  clearInterval(refreshTimer);refreshTimer=setInterval(()=>loadAll(false),20000);
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
