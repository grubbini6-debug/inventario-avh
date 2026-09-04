// AVH — Shell profesional: navegación coherente entre desktop y móvil.
// No cambia reglas de negocio; solo organiza navegación, contexto y sesión.
(function(){
  const pageTitles={
    home:'Inicio',
    purchases:'Compras',
    stock:'Inventario',
    moves:'Movimientos',
    barges:'Barcazas',
    more:'Gestión'
  };
  const moduleTitles={
    alerts:'Alertas y pendientes',
    reports:'Reportes',
    'product-request':'Solicitar producto',
    audit:'Auditoría',
    admin:'Administración',
    'admin-attention':'Centro de atención',
    'data-quality':'Calidad de datos',
    'purchase-receipts':'Recepciones de compras'
  };

  function visiblePage(){
    const p=document.querySelector('.page.on');
    return p?.id?.replace(/^page-/,'')||'home';
  }
  function setTitle(text){
    const el=$('#sectionTitle');if(el)el.textContent=text||'AVH';
    document.title=(text&&text!=='Inicio'?text+' · ':'')+'Inventario AVH';
  }
  function clearActive(){
    document.querySelectorAll('.nav button.on').forEach(x=>x.classList.remove('on'));
  }
  function syncActive(page=visiblePage(),module=activeModule){
    clearActive();
    let target=null,title=pageTitles[page]||'AVH';
    if(page==='more'&&module){
      target=document.querySelector(`.nav [data-shell-module="${CSS.escape(module)}"]`);
      title=moduleTitles[module]||title;
      if(module==='admin'&&activeAdminTab==='suppliers'){
        target=document.querySelector('.nav [data-shell-admin="suppliers"]')||target;
        title='Proveedores';
      }
    }
    if(!target)target=document.querySelector(`.nav [data-page="${CSS.escape(page)}"]`);
    target?.classList.add('on');
    setTitle(title);
  }
  function syncRole(){
    const admin=profile?.role==='admin';
    document.querySelectorAll('.admin-shell-only').forEach(x=>x.classList.toggle('shell-role-hidden',!admin));
  }
  function syncUser(){
    const name=(profile?.full_name||profile?.username||'Usuario AVH').trim();
    const role=profile?.role==='admin'?'Administrador':'Depósito';
    const sw=$('#sidebarWho'),sr=$('#sidebarRole'),av=document.querySelector('.nav-user-avatar');
    if(sw)sw.textContent=name;
    if(sr)sr.textContent=role;
    if(av){
      const initials=name.split(/[\s._-]+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase();
      av.textContent=initials||'AVH';
    }
  }
  function bindDirect(){
    document.querySelectorAll('[data-shell-module]').forEach(b=>{
      if(b.dataset.shellBound)return;b.dataset.shellBound='1';
      b.onclick=()=>{
        goPage('more');
        activeModule=b.dataset.shellModule;
        renderModule(activeModule);
        syncActive('more',activeModule);
      };
    });
    document.querySelectorAll('[data-shell-admin]').forEach(b=>{
      if(b.dataset.shellBound)return;b.dataset.shellBound='1';
      b.onclick=()=>{
        goPage('more');
        activeModule='admin';
        activeAdminTab=b.dataset.shellAdmin;
        renderAdmin(activeAdminTab);
        syncActive('more','admin');
      };
    });
    const out=$('#sidebarLogout');
    if(out&&!out.dataset.shellBound){out.dataset.shellBound='1';out.onclick=signOut}
  }
  function sync(){
    syncRole();syncUser();bindDirect();syncActive();
  }

  const baseGoPage=window.goPage;
  if(typeof baseGoPage==='function')window.goPage=function(page){
    const r=baseGoPage.apply(this,arguments);
    queueMicrotask(()=>syncActive(page,page==='more'?activeModule:''));
    return r;
  };
  const baseRenderModule=window.renderModule;
  if(typeof baseRenderModule==='function')window.renderModule=function(name){
    const r=baseRenderModule.apply(this,arguments);
    queueMicrotask(()=>syncActive('more',name));
    return r;
  };
  const baseRenderAdmin=window.renderAdmin;
  if(typeof baseRenderAdmin==='function')window.renderAdmin=function(tab){
    const r=baseRenderAdmin.apply(this,arguments);
    queueMicrotask(()=>{
      if(tab==='suppliers')setTitle('Proveedores');
      else setTitle('Administración');
      syncActive('more','admin');
    });
    return r;
  };

  const observer=new MutationObserver(()=>{bindDirect();syncRole()});
  observer.observe(document.body,{childList:true,subtree:true});
  window.AVHShell={sync,syncActive};
  setTimeout(sync,0);
})();