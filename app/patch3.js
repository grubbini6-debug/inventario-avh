(function(){
window.voidStockMovement=async function(id){
  if(profile.role!=='admin')return alert('Solo el administrador puede anular una carga.');
  const m=D.moves.find(x=>x.id===id);if(!m)return alert('Movimiento no encontrado.');
  if(!['initial','entry','return'].includes(m.type))return alert('Esta opción solo anula cargas de stock.');
  if(m.status==='cancelled')return alert('Este movimiento ya está anulado.');
  const label=(TYPE_LABEL[m.type]||m.type)+' #'+m.movement_no;
  if(!confirm(`¿Anular ${label}?\n\nEl stock ingresado por este movimiento se quitará, pero el historial quedará guardado para auditoría.`))return;
  const reason=prompt('Motivo de la anulación:','Carga registrada por error');
  if(reason===null)return;
  const r=await rpc('admin_void_stock_in_movement',{p_movement_id:id,p_reason:reason.trim()||'Carga registrada por error'});
  if(r.error)return alert(r.error);
  alert('Carga anulada correctamente. El stock fue revertido y el movimiento quedó en el historial.');
  await loadAll(true);
};

window.movementRows=function(arr){
  if(!arr.length)return'<div class="empty">Sin movimientos.</div>';
  return arr.map(m=>{
    const type=TYPE_LABEL[m.type]||m.type;
    const route=m.type==='transfer'?`${whName(m.warehouse_from_id)} → ${whName(m.warehouse_to_id)}`:whName(m.warehouse_from_id||m.warehouse_to_id);
    const lines=(m.movement_lines||[]).map(l=>`${fmt(l.quantity)} ${esc(l.presentation_label||l.unit)} ${esc(l.products?.name||'')}`).join(' · ');
    const detail=[m.barge_id?`Barcaza ${bargeNo(m.barge_id)}`:'',m.contractor_id?contractorName(m.contractor_id):'',m.person_receiving||'',m.destination||m.destination_text||''].filter(Boolean).join(' · ');
    const cancelled=m.status==='cancelled';
    const badgeClass=cancelled?'red':m.status==='in_transit'?'amber':m.type==='entry'?'green':m.type==='exit'?'red':'blue';
    const badgeText=cancelled?'ANULADO':m.status==='in_transit'?'EN TRÁNSITO':type.toUpperCase();
    const canVoid=profile.role==='admin'&&!cancelled&&['initial','entry','return'].includes(m.type);
    return`<div class="row clickable movement-row" data-movement="${m.id}"><div class="line"><div class="grow"><div class="title">${esc(type)} #${m.movement_no}</div><div class="subtext">${esc(lines||'Sin detalle')}<br>${esc(route)}${detail?` · ${esc(detail)}`:''}<br>${dt(m.created_at)}</div></div><span class="badge ${badgeClass}">${esc(badgeText)}</span></div><div class="split-actions">${m.type==='transfer'&&m.status==='in_transit'&&(profile.role==='admin'||profile.warehouse_id===m.warehouse_to_id)?`<button class="btn sm primary" data-receive="${m.id}">Confirmar recepción</button>`:''}${!cancelled&&m.type!=='correction'?`<button class="btn sm" data-correct="${m.id}">Solicitar corrección</button>`:''}${canVoid?`<button class="btn sm danger" data-void-stock="${m.id}">Anular carga</button>`:''}</div></div>`;
  }).join('');
};

window.bindMovementRows=function(){
  $$('[data-movement]').forEach(x=>x.onclick=e=>{if(e.target.closest('button'))return;openMovementDetail(x.dataset.movement)});
  $$('[data-receive]').forEach(x=>x.onclick=async e=>{e.stopPropagation();x.disabled=true;const r=await rpc('receive_transfer',{p_movement_id:x.dataset.receive});if(r.error)alert(r.error);await loadAll(true)});
  $$('[data-correct]').forEach(x=>x.onclick=e=>{e.stopPropagation();requestCorrection(x.dataset.correct)});
  $$('[data-void-stock]').forEach(x=>x.onclick=e=>{e.stopPropagation();voidStockMovement(x.dataset.voidStock)});
};
})();
