// Excel source values and planning are kept separate. Import never changes stock.
(function(root){
  const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const num=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
  const text=v=>String(v??'').trim();
  function parseRows(rows,sheetName=''){
    const names={description:['description','descripcion','trabajos','trabajo','detalle','actividad'],length_mm:['length','largo','longitud'],width_mm:['width','ancho'],thickness_mm:['thk','espesor','thickness'],quantity:['quantity','cantidad','cant'],area_m2:['m2','area','superficie'],weight_kg:['totalweight','pesototal','peso','kg'],unit:['unidad','unit','unid'],sector:['sector','ubicacion','compartimento','zona']};
    let h=-1,cols={};
    for(let r=0;r<Math.min(rows.length,30);r++){
      const c={};for(const [key,aliases] of Object.entries(names)){const at=rows[r].findIndex(v=>aliases.includes(norm(v)));if(at>=0)c[key]=at;}
      if(c.description!==undefined&&(c.quantity!==undefined||c.length_mm!==undefined||c.unit!==undefined)){h=r;cols=c;break;}
    }
    const title=rows.slice(0,h<0?5:h).flat().filter(v=>typeof v==='string'&&text(v)).map(text).join(' - ').slice(0,180);
    if(h<0)return{title,sheet:sheetName,tasks:[],needs_ai_extraction:true};
    let sector='General';const tasks=[];
    for(let r=h+1;r<rows.length;r++){
      const row=rows[r],description=text(row[cols.description]);
      if(/^tarea\s*\//i.test(description)){sector='General';continue;}
      if(!description||/^(sub.?total\b|total\b|descripcion$|description$|trbajos$|trabajos$|actividad$|bonificacion\b)/i.test(description))continue;
      if(cols.sector!==undefined&&text(row[cols.sector]))sector=text(row[cols.sector]);
      else if(cols.description>0&&text(row[cols.description-1]))sector=text(row[cols.description-1]);
      const values={};for(const key of ['length_mm','width_mm','thickness_mm','quantity','area_m2','weight_kg'])values[key]=cols[key]===undefined?null:num(row[cols[key]]);
      const service=values.length_mm===null&&values.width_mm===null;
      const areaUnit=/m[²2]|por\s*m|x\s*m/i.test(description);
      if(service&&values.quantity===null&&values.area_m2!==null){values.quantity=values.area_m2;values.area_m2=areaUnit?values.area_m2:null;}
      const unit=cols.unit===undefined?(service?(areaUnit?'m²':/varado/i.test(description)?'servicio':'unidad'):'unidad'):text(row[cols.unit])||'unidad';
      tasks.push({id:'fila-'+(r+1),source_row:r+1,sector,description,kind:service?'service':'steel',unit,...values,operations:[],acceptance:[],materials:[]});
    }
    return{title,sheet:sheetName,tasks,needs_ai_extraction:false};
  }
  function materialsFor(task){
    const m=Array.isArray(task.materials)?task.materials:[];
    return m.map((x,i)=>({id:x.id||task.id+'-insumo-'+i,description:text(x.description),quantity:num(x.quantity),unit:text(x.unit),basis:text(x.basis),confirmed:x.confirmed===true,product_id:x.product_id||null}));
  }
  function draft(analysis,source){
    const tasks=(analysis.tasks||[]).map((t,i)=>({...t,id:t.id||'item-'+(i+1),materials:materialsFor(t)}));
    return{title:analysis.title||'Orden de trabajo naval',vessel:analysis.vessel||analysis.title||'',client:analysis.client||'',location:'',responsible:'',executor:'',order_date:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Asuncion'}).format(new Date()),due_date:'',warehouse_id:'',notes:analysis.notes||'',tasks,source,ai_warnings:analysis.warnings||[]};
  }
  function validate(p){
    if(!text(p.title)||!text(p.vessel))throw Error('Completá el título y la embarcación.');
    if(!Array.isArray(p.tasks)||!p.tasks.length)throw Error('La orden necesita al menos un trabajo.');
    if(p.tasks.length>300)throw Error('La orden supera 300 trabajos. Dividí el alcance en varias órdenes.');
    const ids=new Set();
    for(const t of p.tasks){
      if(!t.id||ids.has(t.id)||!text(t.description))throw Error('Revisá identificadores y descripciones de los trabajos.');ids.add(t.id);
      for(const k of ['length_mm','width_mm','thickness_mm','quantity','area_m2','weight_kg'])if(t[k]!=null&&(!Number.isFinite(Number(t[k]))||Number(t[k])<0))throw Error('Las cantidades y medidas deben ser números positivos.');
      for(const m of materialsFor(t)){if(!m.description||!m.unit)throw Error('Cada insumo necesita descripción y unidad.');if(m.quantity!==null&&m.quantity<=0)throw Error('La cantidad de un insumo debe ser mayor que cero.');if(m.confirmed&&m.quantity===null)throw Error('Un insumo confirmado necesita cantidad.');}
    }
    return p;
  }
  root.AVHWorkOrderModel={parseRows,draft,validate,materialsFor};
})(globalThis);
