// AVH — Limpieza visual al salir del modo Depositero en la misma sesión del navegador.
(function(){
  function syncRoleUI(){
    if(profile?.role==='depositor')return;
    document.body.classList.remove('depositor-mode');
    const nav=document.querySelector('.nav');
    nav?.querySelectorAll('button').forEach(b=>{
      if(['home','stock','moves','barges','more'].includes(b.dataset.page||''))b.style.display='';
    });
    if(nav)nav.style.gridTemplateColumns='';
    const sw=document.querySelector('#stockWarehouse');if(sw)sw.style.display='';
    document.querySelector('#depStockAI')?.remove();
  }
  const previousLoad=window.loadAll;
  window.loadAll=async function(force=false){await previousLoad(force);syncRoleUI()};
  let tries=0;(function boot(){if(profile){syncRoleUI();return}if(++tries<80)setTimeout(boot,300)})();
})();
