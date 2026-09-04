// AVH V3 — Utilidades de UI y formato sin acceso de red.
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
const fmt=n=>new Intl.NumberFormat('es-PY',{maximumFractionDigits:2}).format(Number(n||0));
const money=(n,c)=>`${fmt(n)} ${c||''}`.trim();
const dt=v=>v?new Date(v).toLocaleString('es-PY',{dateStyle:'short',timeStyle:'short'}):'';
const today=v=>new Date(v).toDateString()===new Date().toDateString();
function msg(el,text,ok=false){el.innerHTML=text?`<div class="${ok?'success':'error'}">${esc(text)}</div>`:''}
function whName(id){return D.warehouses.find(x=>x.id===id)?.name||''}
function bargeNo(id){return D.barges.find(x=>x.id===id)?.number||''}
function product(id){return D.products.find(x=>x.id===id)}
function showApp(on){$('#login').classList.toggle('hide',on);$('#main').classList.toggle('hide',!on)}
