// AVH — Destino naval por material y costos FIFO por parte y módulo.
(function(){
  const sections=[['fondo','Fondo'],['costado','Costado'],['popa','Popa'],['proa','Proa'],['general','General de la barcaza']];
  const safe=v=>typeof esc==='function'?esc(String(v??'')):String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const number=v=>Number.isFinite(Number(v))?Number(v):0;
  const moduleCode=v=>String(v||'').trim().replace(/\s+/g,' ').toUpperCase();
  const sectionName=v=>sections.find(x=>x[0]===v)?.[1]||'Sin clasificar';
  function label(row){return row?.naval_section?sectionName(row.naval_section)+(row.naval_module?' · '+row.naval_module:''):'';}
  function problem(row,barge){
    if(!barge)return null;
    if(!sections.some(x=>x[0]===row?.naval_section))return 'Elegí la parte de la barcaza en cada material.';
    const code=moduleCode(row.naval_module);
    if(code&&(row.naval_section==='general'||code.length>40||/[\x00-\x1f\x7f]/.test(String(row.naval_module))))return 'Revisá el módulo: elegí su parte y usá un código de hasta 40 caracteres.';
    return null;
  }
  function metadata(row,barge){return barge?{naval_section:row.naval_section||null,naval_module:moduleCode(row.naval_module)||null}:{naval_section:null,naval_module:null};}
  function fieldsHTML(row={},prefix='naval',named=false){
    return '<div class="two hull-fields"><div class="field"><label for="'+safe(prefix)+'-section">Parte de la barcaza *</label><select id="'+safe(prefix)+'-section" data-hull-section'+(named?' name="naval_section"':'')+'><option value="">Elegí la parte</option>'+sections.map(([id,name])=>'<option value="'+id+'"'+(row.naval_section===id?' selected':'')+'>'+name+'</option>').join('')+'</select></div><div class="field"><label for="'+safe(prefix)+'-module">Módulo (si corresponde)</label><input id="'+safe(prefix)+'-module" data-hull-module'+(named?' name="naval_module"':'')+' maxlength="40" autocomplete="off" value="'+safe(row.naval_module||'')+'" placeholder="Ej.: F12 o CO3" list="'+safe(prefix)+'-suggestions"><datalist id="'+safe(prefix)+'-suggestions" data-hull-suggestions></datalist><small>Dejá vacío para un trabajo general de esa parte.</small></div></div>';
  }
  function bindFields(root,row,enabled=true){
    const section=root.querySelector('[data-hull-section]'),module=root.querySelector('[data-hull-module]'),suggestions=root.querySelector('[data-hull-suggestions]');
    if(!section||!module)return;
    const update=()=>{
      const current=row.naval_section||'';
      section.disabled=!enabled;section.required=!!enabled;
      module.disabled=!enabled||!current||current==='general';
      module.placeholder=current==='fondo'?'Ej.: F12':current==='costado'?'Ej.: CO3':'Código del módulo, si corresponde';
      if(current==='general'){row.naval_module='';module.value='';}
      if(suggestions)suggestions.innerHTML=current==='fondo'?Array.from({length:20},(_,i)=>'<option value="F'+(i+1)+'"></option>').join(''):'';
    };
    section.onchange=()=>{row.naval_section=section.value;update();};
    module.oninput=()=>{row.naval_module=module.value;};
    update();
  }
  function decorateGeneric(){
    if(typeof moveType==='undefined'||moveType!=='exit'||typeof cart==='undefined')return;
    const barge=document.querySelector('#moveBargeSel')?.value;
    for(const row of cart){
      const line=[...document.querySelectorAll('.cart-line')].find(el=>el.dataset.line===String(row.id));if(!line)continue;
      let box=line.querySelector('[data-hull-line]');if(!box){box=document.createElement('div');box.dataset.hullLine='1';box.innerHTML=fieldsHTML(row,'hull-'+row.id);line.appendChild(box);}
      box.hidden=!barge;bindFields(box,row,!!barge);
    }
  }
  const oldCart=window.renderCart;
  if(oldCart)window.renderCart=function(){const result=oldCart.apply(this,arguments);decorateGeneric();return result;};
  const oldOpen=window.openMovement;
  if(oldOpen)window.openMovement=function(type){
    const after=()=>{if(type!=='exit')return;const barge=document.querySelector('#moveBargeSel');barge?.addEventListener('change',decorateGeneric);decorateGeneric();};
    const result=oldOpen.apply(this,arguments);if(result?.then)return result.then(value=>{after();return value;});after();return result;
  };
  function summarize(rows){
    const totals={},unpriced=rows.some(r=>number(r.unpriced_quantity)>0);
    for(const row of rows)if(row.currency&&number(row.priced_quantity)>0)totals[row.currency]=(totals[row.currency]||0)+number(row.real_cost);
    return{totals,unpriced};
  }
  function amounts(rows){
    const summary=summarize(rows),cost=Object.entries(summary.totals).map(([currency,total])=>typeof money==='function'?money(total,currency):currency+' '+total).join(' · ');
    return (cost||'Sin valorización')+(summary.unpriced?' · material sin valorizar':'');
  }
  function csvCell(value){let s=String(value??'');if(/^[=+\-@\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
  function exportRows(rows,bargeNumber){
    const data=[['Barcaza','Parte','Módulo','Material','Cantidad base','Unidad','Moneda','Costo valorizado','Cantidad sin valorizar']];
    rows.forEach(r=>data.push([bargeNumber,sectionName(r.naval_section),r.naval_module||'',r.product_name,r.base_quantity,r.base_unit,r.currency||'',r.priced_quantity>0?r.real_cost:'',r.unpriced_quantity]));
    return '\ufeff'+data.map(r=>r.map(csvCell).join(';')).join('\n');
  }
  function download(rows,barge){
    const blob=new Blob([exportRows(rows,barge.number)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='AVH_Barcaza_'+barge.number+'_Partes_Modulos.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  let reportEpoch=0;
  const oldBarge=window.openBarge;
  window.openBarge=async function(id){
    if(profile?.role!=='admin')return oldBarge?.apply(this,arguments);
    const barge=(D.barges||[]).find(x=>x.id===id);if(!barge)return;
    const epoch=++reportEpoch;
    openModal('Barcaza '+barge.number,'Insumos entregados desde depósito','<div id="hullCostReport"><div class="empty">Cargando costos por parte y módulo…</div></div>');
    const box=document.querySelector('#hullCostReport'),result=await queryAll('v_barge_module_consumption','*','barge_id=eq.'+encodeURIComponent(id)+'&order=naval_section.asc,naval_module.asc,product_name.asc');
    if(epoch!==reportEpoch||!box?.isConnected||profile?.role!=='admin')return;
    if(result.error){box.innerHTML='<div class="notice">'+safe(result.error)+'</div>';return;}
    const rows=result.data||[],summary=summarize(rows);
    box.innerHTML='<div class="notice">Costo de las salidas confirmadas, calculado con los lotes FIFO utilizados. USD y PYG se muestran por separado.</div><div class="card" style="margin-top:10px"><div class="eyebrow">TOTAL DE LA BARCAZA</div><div class="title">'+safe(amounts(rows))+'</div>'+(summary.unpriced?'<div class="hint">El total valorizado es parcial: hay materiales pendientes de precio.</div>':'')+'</div><div class="two" style="margin-top:12px"><div class="field"><label>Parte</label><select id="hullCostSection"><option value="">Todas las partes</option>'+sections.map(([id,name])=>'<option value="'+id+'">'+name+'</option>').join('')+'<option value="unclassified">Sin clasificar</option></select></div><div class="field"><label>Buscar módulo</label><input id="hullCostModule" placeholder="Ej.: F12" autocomplete="off"></div></div><div class="split-actions"><button type="button" class="btn sm soft" id="hullCostExport">Exportar desglose CSV</button></div><div id="hullCostRows" style="display:grid;gap:12px;margin-top:12px"></div><div class="hint" style="margin-top:12px">Los movimientos sin parte informada se mantienen en “Sin clasificar”. El módulo vacío indica una entrega general a esa parte.</div>';
    if(typeof movementRows==='function'){box.insertAdjacentHTML('beforeend','<div class="section-head"><h2>Retiros recientes</h2></div><div class="list">'+movementRows((D.moves||[]).filter(m=>m.barge_id===id).slice(0,10))+'</div>');if(typeof bindMovementRows==='function')bindMovementRows();}
    let filtered=rows;
    const render=()=>{
      const section=box.querySelector('#hullCostSection').value,term=moduleCode(box.querySelector('#hullCostModule').value);
      filtered=rows.filter(r=>(!section||(section==='unclassified'?!r.naval_section:r.naval_section===section))&&(!term||moduleCode(r.naval_module).includes(term)));
      const order=[...sections.map(x=>x[0]),null],html=[];
      for(const key of order){
        const current=filtered.filter(r=>(r.naval_section||null)===key);if(!current.length)continue;
        current.sort((a,b)=>String(a.naval_module||'').localeCompare(String(b.naval_module||''),'es',{numeric:true})||String(a.product_name).localeCompare(String(b.product_name)));
        html.push('<details class="card hull-cost-section" open><summary><b>'+safe(sectionName(key))+'</b> · '+safe(amounts(current))+'</summary><div style="overflow:auto;margin-top:10px"><table class="table hull-cost-table" style="min-width:440px;width:100%"><thead><tr><th>Módulo</th><th>Material</th><th>Cantidad</th><th>Costo</th></tr></thead><tbody>'+current.map(r=>'<tr><td>'+safe(r.naval_module||(key?'General de esta parte':'Sin dato histórico'))+'</td><td>'+safe(r.product_name)+'</td><td>'+safe(typeof fmt==='function'?fmt(r.base_quantity):r.base_quantity)+' '+safe(r.base_unit)+'</td><td>'+safe(number(r.priced_quantity)>0?(typeof money==='function'?money(r.real_cost,r.currency):r.currency+' '+r.real_cost):'Sin valorizar')+(number(r.unpriced_quantity)>0?'<div class="hint">'+safe(typeof fmt==='function'?fmt(r.unpriced_quantity):r.unpriced_quantity)+' '+safe(r.base_unit)+' sin valorizar</div>':'')+'</td></tr>').join('')+'</tbody></table></div></details>');
      }
      box.querySelector('#hullCostRows').innerHTML=html.join('')||'<div class="empty">Sin salidas para esta selección.</div>';
    };
    box.querySelector('#hullCostSection').onchange=render;box.querySelector('#hullCostModule').oninput=render;
    box.querySelector('#hullCostExport').onclick=()=>download(filtered,barge);render();
  };
  window.AVHHullCosts=Object.freeze({sections,sectionName,label,moduleCode,problem,metadata,fieldsHTML,bindFields,summarize,exportRows});
})();
