// One conversion model for the purchase preview, physical receipt and invoice control.
// Package weight is different from the unit in which an existing product is stocked.
(function(root){
  const aliases={un:'unidad',und:'unidad',u:'unidad',unidades:'unidad',unidad:'unidad',piezas:'pieza',pieza:'pieza',kgs:'kg',kilogramo:'kg',kilogramos:'kg',kg:'kg',tn:'tonelada',ton:'tonelada',toneladas:'tonelada',tonelada:'tonelada',rollos:'rollo',rollo:'rollo',bobinas:'bobina',bobina:'bobina',bolsas:'bolsa',bolsa:'bolsa',cajas:'caja',caja:'caja',paquetes:'paquete',paquete:'paquete',m:'metro',mt:'metro',mts:'metro',metros:'metro',metro:'metro',l:'litro',lt:'litro',lts:'litro',litros:'litro',litro:'litro',pr:'par',pares:'par',par:'par'};
  const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
  const unit=v=>aliases[norm(v)]||norm(v);
  const number=v=>v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;
  const countUnits=new Set(['unidad','pieza','rollo','bobina','bolsa']);
  const forProduct=(product,presentations=[])=>presentations.filter(p=>!p.product_id||p.product_id===product?.id);
  function packageKg(product,presentations=[]){
    if(!countUnits.has(unit(product?.base_unit)))return null;
    const weights=forProduct(product,presentations).filter(p=>countUnits.has(unit(p.unit))&&Number(p.factor_to_base)===1).map(p=>String(p.label||'').match(/\b(\d+(?:[.,]\d+)?)\s*kg\b/i)).filter(Boolean).map(m=>Number(m[1].replace(',','.'))).filter(n=>n>0);
    const unique=[...new Set(weights)];return unique.length===1?unique[0]:null;
  }
  function factor(item,product,presentations=[]){
    const from=unit(item?.unit),base=unit(product?.base_unit);
    if(!from||!base)return null;
    if(from===base)return 1;
    const known=[...new Set(forProduct(product,presentations).filter(p=>unit(p.unit)===from&&Number(p.factor_to_base)>0).map(p=>Number(p.factor_to_base)))];
    if(known.length===1)return known[0];if(known.length>1)return null;
    if(from==='tonelada'&&base==='kg')return 1000;
    if(from==='kg'&&base==='tonelada')return .001;
    const kg=packageKg(product,presentations);
    if(kg&&countUnits.has(base)){
      if(from==='kg')return 1/kg;
      if(from==='tonelada')return 1000/kg;
      if(['rollo','bobina','bolsa'].includes(from))return 1;
    }
    // A factor extracted to kg cannot be used as a factor to units.
    const declaredBase=unit(item?.base_unit),explicit=number(item?.factor_to_base);
    if(declaredBase&&declaredBase!==base)return null;
    return explicit>0?explicit:null;
  }
  function quantity(item,product,presentations=[]){
    const f=factor(item,product,presentations),q=number(item?.quantity);
    if(f===null||q===null)return null;
    const baseQuantity=q*f,base=unit(product?.base_unit),kg=packageKg(product,presentations);
    return{quantity:baseQuantity,unit:base,factor:f,kg:base==='kg'?baseQuantity:kg?baseQuantity*kg:null,package_kg:kg};
  }
  function stockProblem(item,product){
    if(!product)return 'Falta vincular el producto del inventario.';
    const f=number(item?.factor_to_base);
    if(!(f>0))return 'Falta una conversión válida para ingresar al stock.';
    if(unit(item.unit)===unit(product.base_unit)&&f!==1)return 'La compra y el stock usan la misma unidad: la conversión debe ser 1. El peso del envase se informa por separado.';
    return null;
  }
  function comparable(po,invoice,product,presentations=[]){
    const a=quantity(po,product,presentations),b=quantity(invoice,product,presentations);
    if(!a||!b||stockProblem(po,product))return null;
    return{poQty:a.quantity,extQty:b.quantity,poPrice:number(po.unit_price)===null?null:Number(po.unit_price)/a.factor,extPrice:number(invoice.unit_price)===null?null:Number(invoice.unit_price)/b.factor,unit:a.unit};
  }
  function wireIdentity(item){
    const text=String(item?.description||item?.name||''),brand=text.match(/\b(WST|ESAB|HYUNDAI|LINCOLN|THOR|ATLANTIC|CONARCO)\b/i)?.[1]?.toUpperCase();
    const spec=text.toUpperCase().replace(/[^A-Z0-9]/g,'').match(/E71T1C?/i)?.[0];
    const diameter=text.match(/\b(\d+(?:[.,]\d+)?)\s*mm\b/i)?.[1];
    if(!brand||!spec||!diameter)return null;
    const weight=text.match(/\b(\d+(?:[.,]\d+)?)\s*kg\b/i)?.[1];
    return{key:[brand,spec,Number(diameter.replace(',','.'))].join('|'),kg:weight?Number(weight.replace(',','.')):null};
  }
  function matches(item,products=[],presentations=[]){
    if(!(item?.description||item?.name)&&item?.product_code)return products.filter(p=>p.active!==false&&norm(p.sku||p.code).replace(/[^a-z0-9]/g,'')===norm(item.product_code).replace(/[^a-z0-9]/g,''));
    const active=products.filter(p=>p.active!==false),rows=active.filter(p=>!root.AVHProductIdentity||root.AVHProductIdentity.automatic(item,p,active)),code=norm(item?.product_code||item?.barcode).replace(/[^a-z0-9]/g,''),description=norm(item?.description).replace(/\s+/g,' ');
    if(code){const exact=rows.filter(p=>norm(p.sku||p.code).replace(/[^a-z0-9]/g,'')===code);if(exact.length)return exact;}
    const exact=rows.filter(p=>norm(p.name).replace(/\s+/g,' ')===description);if(exact.length)return exact;
    if(root.AVHProductIdentity){const I=root.AVHProductIdentity,key=I.key,canonical=rows.filter(p=>key(p.name)===key(item?.description));if(canonical.length)return canonical;
      const source=I.identity(item,active);if(source.brand&&source.model){const technical=rows.filter(p=>{const candidate=I.identity(p,active);return candidate.brand&&key(candidate.brand)===key(source.brand)&&candidate.model===source.model;});if(technical.length)return technical;}
    }
    const identity=wireIdentity(item);
    if(identity)return rows.filter(p=>{const candidate=wireIdentity(p);if(!candidate||candidate.key!==identity.key)return false;const weight=candidate.kg||packageKg(p,presentations);return !identity.kg||!weight||identity.kg===weight;});
    return rows.filter(p=>{const name=norm(p.name).replace(/\s+/g,' ');return description.length>=8&&name.length>=8&&(description.includes(name)||name.includes(description));});
  }
  function financial(doc){
    const currency=String(doc?.currency||'').toUpperCase(),tolerance=currency==='PYG'?1:.02,total=number(doc?.total),subtotal=number(doc?.subtotal),tax=number(doc?.tax);
    const mode=['included','excluded','none'].includes(doc?.tax_mode)?doc.tax_mode:'unknown',issues=[];
    const add=(level,text)=>issues.push({level,text});
    const same=(a,b)=>Math.abs(a-b)<=tolerance+1e-9;
    if(total===null||total<0)add('review','Falta un total válido en la factura.');
    if(tax!==null&&(tax<0||(total!==null&&tax>total)))add('review','El IVA extraído es inválido frente al total.');
    if(mode==='included'&&tax!==null&&total!==null){if(subtotal!==null&&!same(subtotal,total)&&!same(subtotal+tax,total))add('review','El subtotal y el IVA incluido no concilian con el total.');}
    else if(mode==='excluded'&&subtotal!==null&&tax!==null&&total!==null&&!same(subtotal+tax,total))add('review','El subtotal más IVA no coincide con el total.');
    else if(mode==='none'&&tax>0)add('review','La factura indica sin IVA, pero tiene un impuesto extraído.');
    else if(mode==='unknown'&&tax>0)add('pending','Confirmar si el IVA está incluido o se suma; no se agrega nuevamente al total.');
    const items=Array.isArray(doc?.items)?doc.items:[];
    if(!items.length)add('review','La factura no tiene ítems legibles.');
    for(const [i,item] of items.entries()){
      const q=number(item.quantity),p=number(item.unit_price),t=number(item.line_total);
      if(q===null||q<=0||p===null||p<0||t===null||t<0)add('pending',`Ítem ${i+1}: faltan cantidad, precio o importe legibles.`);
      else if(!same(Math.round(q*p*(currency==='PYG'?1:100))/(currency==='PYG'?1:100),t))add('review',`Ítem ${i+1}: cantidad por precio no coincide con el importe.`);
      if(number(item.confidence)!==null&&Number(item.confidence)<.9)add('pending',`Ítem ${i+1}: revisar la lectura del documento.`);
    }
    const amounts=items.map(i=>number(i.line_total));
    if(items.length&&amounts.every(v=>v!==null)&&total!==null){
      const sum=amounts.reduce((a,b)=>a+b,0);
      if(mode==='excluded'&&subtotal!==null&&!same(sum,subtotal))add('review','La suma de ítems no coincide con el subtotal.');
      else if(['included','none'].includes(mode)&&!same(sum,total))add('review','La suma de ítems no coincide con el total.');
      else if(mode==='unknown'&&!same(sum,total)&&!(subtotal!==null&&same(sum,subtotal)&&tax!==null&&same(sum+tax,total)))add('review','Los ítems, impuestos y total requieren conciliación.');
    }
    return{mode,total,tax,net:mode==='included'&&total!==null&&tax!==null?Math.round((total-tax)*100)/100:mode==='excluded'?subtotal:null,issues};
  }
  function documentIssues(doc){
    const issues=financial(doc).issues.map(x=>x.text);
    if(doc?.complete===false)issues.unshift('La lectura no cubre todo el documento. Dividí el archivo o cargá páginas más claras.');
    if(!['PYG','USD'].includes(doc?.currency))issues.push('La moneda no está identificada; debe elegirse antes de guardar.');
    if(!doc?.supplier_name)issues.push('Falta identificar el proveedor.');
    for(const field of ['date','document_date','valid_until','delivery_date'])if(doc?.[field]){const v=doc[field];if(!/^\d{4}-\d\d-\d\d$/.test(v)||Number.isNaN(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)issues.push('Revisar la fecha '+field+': no es una fecha válida.');}
    (doc?.items||[]).forEach((x,i)=>{if(!String(x.unit||'').trim())issues.push(`Ítem ${i+1}: falta la unidad de compra.`);if(number(x.quantity)===null||number(x.quantity)<=0)issues.push(`Ítem ${i+1}: falta una cantidad positiva.`);if(number(x.confidence)!==null&&number(x.confidence)<.9)issues.push(`Ítem ${i+1}: lectura dudosa; revisar contra el original.`);});
    return [...new Set([...issues,...(Array.isArray(doc?.warnings)?doc.warnings:[])])].slice(0,40);
  }
  root.AVHReceiving=Object.freeze({unit,number,packageKg,factor,quantity,stockProblem,comparable,matches,financial,documentIssues});
})(globalThis);
