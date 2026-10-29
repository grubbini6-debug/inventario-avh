// AVH — Control Presupuesto ↔ OC ↔ Factura ↔ Recibido. Solo lectura/alerta.
(function(){
  const CONTROL_EDGE='purchase-invoice-control-ai';
  const safe=s=>typeof esc==='function'?esc(String(s??'')):String(s??'').replace(/[&<>\"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
  const n=v=>{const x=Number(v);return Number.isFinite(x)?x:0};
  const norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const digits=s=>String(s??'').replace(/\D/g,'');
  const unit=v=>{const x=norm(v).replace(/\s/g,'');return({un:'unidad',uni:'unidad',und:'unidad',u:'unidad',unidad:'unidad',unidades:'unidad',kgs:'kg',kilogramo:'kg',kilogramos:'kg',kg:'kg',tn:'tonelada',ton:'tonelada',toneladas:'tonelada',tonelada:'tonelada',mts:'metro',mt:'metro',m:'metro',metros:'metro',metro:'metro',lts:'litro',lt:'litro',l:'litro',litros:'litro',litro:'litro'})[x]||String(v||'').toLowerCase().trim()};
  const fmtN=v=>typeof fmt==='function'?fmt(v):n(v).toLocaleString('es-PY',{maximumFractionDigits:3});
  const cash=(v,c)=>typeof money==='function'?money(v,c):`${c||''} ${n(v).toLocaleString('es-PY',{maximumFractionDigits:4})}`;
  const docs=id=>(D.purchaseDocuments||[]).filter(x=>x.purchase_id===id),items=id=>(D.purchaseItems||[]).filter(x=>x.purchase_id===id);
  const product=id=>(D.products||[]).find(x=>x.id===id)||{},supplier=id=>(D.suppliers||[]).find(x=>x.id===id)||{};
  const latest=(id,kind)=>docs(id).filter(x=>x.kind===kind).sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0))[0]||null;
  const data=d=>d&&d.analysis_status==='ok'&&d.analysis_data&&typeof d.analysis_data==='object'?d.analysis_data:null;
  const same=(a,b)=>Math.abs(n(a)-n(b))<=Math.max(.000001,Math.abs(n(a))*.000001);
  const pct=(base,val)=>n(base)?((n(val)-n(base))/Math.abs(n(base)))*100:0,pctText=(base,val)=>{const p=pct(base,val);return`${p>=0?'+':''}${p.toFixed(1)}%`};
  const totalDoc=d=>n(d?.total)||((d?.items||[]).reduce((a,x)=>a+(n(x.line_total)||n(x.quantity)*n(x.unit_price)),0));
  const totalPo=p=>items(p.id).reduce((a,x)=>a+n(x.quantity)*n(x.unit_price),0);
  const style=document.createElement('style');
  style.textContent=`.pc-control{border:1px solid #dbe7df;border-radius:16px;padding:14px;background:#fff;margin:10px 0}.pc-control-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.pc-control-head h3{margin:0;font-size:16px}.pc-control-badge{padding:6px 10px;border-radius:999px;font-size:11px;font-weight:900}.pc-control-badge.ok{background:#e4f5e9;color:#126936}.pc-control-badge.pending{background:#fff2cf;color:#805800}.pc-control-badge.review{background:#ffe3e1;color:#a52e29}.pc-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px}.pc-stage{border:1px solid #e0e9e3;border-radius:12px;padding:10px;background:#fbfdfb}.pc-stage b{display:block;font-size:12px}.pc-stage span{display:block;font-size:11px;color:#6b7b72;margin-top:4px;line-height:1.35}.pc-issues{display:grid;gap:6px;margin-top:10px}.pc-issue{border-radius:10px;padding:8px 10px;font-size:12px}.pc-issue.review{background:#fff0ef;color:#8e2d29}.pc-issue.pending{background:#fff9e9;color:#765600}.pc-issue.info{background:#f2f7f4;color:#4b6155}.pc-table-wrap{overflow:auto;margin-top:12px}.pc-table{width:100%;min-width:760px;border-collapse:collapse;font-size:11px}.pc-table th,.pc-table td{padding:8px;border-bottom:1px solid #e8eee9;text-align:left}.pc-table th:nth-child(n+2),.pc-table td:nth-child(n+2){text-align:right}.pc-line-ok{color:#126936;font-weight:800}.pc-line-review{color:#a52e29;font-weight:850}.pc-line-pending{color:#805800;font-weight:800}@media(max-width:700px){.pc-grid{grid-template-columns:1fr}.pc-control-head{flex-direction:column}}`;
  document.head.appendChild(style);

  function tokens(s){return new Set(norm(s).split(' ').filter(x=>x.length>2))}
  function similarity(a,b){const aa=norm(a),bb=norm(b);if(!aa||!bb)return 0;if(aa===bb)return 1;if((aa.includes(bb)&&bb.length>=7)||(bb.includes(aa)&&aa.length>=7))return .82;const A=tokens(aa),B=tokens(bb);if(!A.size||!B.size)return 0;let inter=0;A.forEach(x=>{if(B.has(x))inter++});return inter/Math.max(A.size,B.size)}
  function lineScore(po,ext){const pr=product(po.product_id);if(window.AVHProductIdentity.conflicts(ext,{...pr,description:po.description||pr.name},D.products).length)return 0;const code=norm(pr.sku||''),extCode=norm(ext.product_code||'');if(code&&extCode&&code===extCode)return 1.2;let s=similarity(po.description,ext.description);if(pr.name)s=Math.max(s,similarity(pr.name,ext.description));if(unit(po.unit)&&unit(po.unit)===unit(ext.unit))s+=.08;return s}
  function matchLines(poRows,extRows){const used=new Set(),out=[];for(const po of poRows){let best=-1,score=0;extRows.forEach((x,i)=>{if(used.has(i))return;const s=lineScore(po,x);if(s>score){score=s;best=i}});if(best>=0&&score>=.36){used.add(best);out.push({po,ext:extRows[best],score})}else out.push({po,ext:null,score})}return{rows:out,extra:extRows.filter((_,i)=>!used.has(i))}}
  function comparable(po,ext){if(!ext)return null;const pr=product(po.product_id);return window.AVHReceiving.comparable(po,ext,pr.id?pr:{base_unit:po.unit},D.presentations||[])}
  function compareExternal(p,docData,label){if(!docData)return{issues:[],matched:{rows:[],extra:[]}};const issues=[],sev=label==='Factura'?'review':'pending',sup=supplier(p.supplier_id),dc=String(docData.currency||'').toUpperCase(),pc=String(p.currency||'').toUpperCase();if(dc&&pc&&dc!==pc)issues.push({level:'review',text:`${label}: moneda ${dc} ≠ OC ${pc}`});const taxA=digits(sup.tax_id),taxB=digits(docData.supplier_tax_id);if(taxA&&taxB&&taxA!==taxB)issues.push({level:'review',text:`${label}: RUC del proveedor no coincide`});else if(!taxA&&!taxB&&sup.name&&docData.supplier_name&&similarity(sup.name,docData.supplier_name)<.45)issues.push({level:'review',text:`${label}: proveedor parece diferente`});const poT=totalPo(p),docT=totalDoc(docData);if(poT>0&&docT>0&&!same(poT,docT))issues.push({level:sev,text:`${label}: total ${cash(docT,dc||pc)} vs OC ${cash(poT,pc)} (${pctText(poT,docT)})`});if(label==='Factura'){issues.push(...window.AVHReceiving.financial(docData).issues.map(x=>({...x,text:'Factura: '+x.text})));if(docData.validation?.reviewed===false)issues.push({level:'pending',text:'Factura: falta completar la segunda lectura.'});const buyer=(D.purchaseCompanies||[]).find(x=>x.id===p.company_id),expected=digits(buyer?.tax_id),actual=digits(docData.customer_tax_id);if(expected&&actual&&expected!==actual)issues.push({level:'review',text:'Factura: el RUC de la empresa compradora no coincide con la OC.'});}if(Array.isArray(docData.validation?.issues))issues.push(...docData.validation.issues.map(text=>({level:'pending',text:`${label}: ${text}`})));const matched=matchLines(items(p.id),Array.isArray(docData.items)?docData.items:[]);matched.rows.forEach(m=>{if(!m.ext){issues.push({level:'review',text:`${label}: no pude vincular “${m.po.description}”`});return}const identity=window.AVHProductIdentity.conflicts(m.ext,{...product(m.po.product_id),description:m.po.description},D.products);if(identity.length){issues.push({level:'review',text:`${label}: ${identity.join(' ')} (${m.po.description})`});return}const c=comparable(m.po,m.ext);if(!c){issues.push({level:'pending',text:`${label}: unidad diferente en “${m.po.description}”; revisar`});return}if(!same(c.poQty,c.extQty))issues.push({level:sev,text:`${label}: cantidad de “${m.po.description}” ${fmtN(c.extQty)} ${c.unit} vs OC ${fmtN(c.poQty)}`});if(c.poPrice!==null&&c.extPrice!==null&&!same(c.poPrice,c.extPrice))issues.push({level:sev,text:`${label}: precio de “${m.po.description}” ${pctText(c.poPrice,c.extPrice)} vs OC`})});if(matched.extra.length)issues.push({level:'review',text:`${label}: ${matched.extra.length} línea(s) adicional(es) no vinculadas a la OC`});return{issues,matched}}
  function receiptInfo(p){const rows=items(p.id),issues=[];let ordered=0,received=0;rows.forEach(x=>{const q=n(x.quantity),r=n(x.received_qty);ordered+=q;received+=Math.min(r,q);if(r>q&&!same(r,q))issues.push({level:'review',text:`Recibido excede OC en “${x.description}”: ${fmtN(r)} / ${fmtN(q)} ${x.unit}`})});return{issues,cancelled:rows.reduce((a,x)=>a+n(x.cancelled_qty),0),complete:rows.length>0&&rows.every(x=>same(n(x.received_qty)+n(x.cancelled_qty),x.quantity)),any:rows.some(x=>n(x.received_qty)>0),ordered,received,ratio:ordered?Math.min(100,received/ordered*100):0}}
  const validDate=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\d$/.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
  function effectiveInvoice(doc){
    const raw=data(doc);if(!raw)return null;
    if(!validDate(doc.document_date))return raw;
    // A saved document date is explicit business data. Keep the OCR source intact.
    const issues=(Array.isArray(raw.validation?.issues)?raw.validation.issues:[]).filter(text=>!/^Revisar la fecha (?:date|document_date): no es una fecha válida\.$/.test(String(text)));
    return {...raw,date:doc.document_date,validation:{...raw.validation,issues}};
  }
  function invoiceNumber(doc){return String(doc.document_number||data(doc)?.document_number||'').trim()}
  const invoiceKey=doc=>norm(invoiceNumber(doc)).replace(/\s/g,'');
  function invoiceSignature(doc){
    const d=data(doc);if(!d)return null;
    return JSON.stringify({currency:d.currency,total:d.total,subtotal:d.subtotal,tax:d.tax,tax_mode:d.tax_mode,supplier:digits(d.supplier_tax_id),buyer:digits(d.customer_tax_id),items:(d.items||[]).map(x=>({description:norm(x.description),quantity:x.quantity,unit:window.AVHReceiving.unit(x.unit),price:x.unit_price,total:x.line_total,factor:x.factor_to_base,base:x.base_unit,brand:norm(x.brand),model:norm(x.manufacturer_code)})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))});
  }
  function invoiceGroups(p){
    const receipts=new Map((D.purchaseReceipts||[]).map(r=>[r.id,r])),groups=[];
    const invoices=docs(p.id).filter(d=>d.kind==='invoice'&&!(d.receipt_id&&receipts.get(d.receipt_id)?.voided_at)).sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
    for(const doc of invoices){
      const number=invoiceKey(doc),path=String(doc.file_path||'').trim();
      const related=groups.filter(g=>g.docs.some(d=>(number&&invoiceKey(d)===number)||(path&&d.file_path===path)));
      const group=related[0]||{docs:[]};if(!related.length)groups.push(group);
      for(const other of related.slice(1)){group.docs.push(...other.docs);groups.splice(groups.indexOf(other),1);}
      group.docs.push(doc);
    }
    return groups.map(g=>({...g,doc:g.docs.find(d=>data(d))||g.docs[0]}));
  }
  function matchInvoiceRows(poRows,external){
    const matched=[],extra=[];
    for(const ext of external){
      const candidates=poRows.map(po=>({po,score:lineScore(po,ext)})).filter(x=>x.score>=.36).sort((a,b)=>b.score-a.score);
      let best=candidates[0];
      if(best&&candidates[1]&&Math.abs(best.score-candidates[1].score)<.02){
        const prices=candidates.filter(x=>Math.abs(x.score-best.score)<.02).filter(x=>{const c=comparable(x.po,ext);return c&&c.poPrice!==null&&c.extPrice!==null&&same(c.poPrice,c.extPrice)});
        best=prices.length===1?prices[0]:null;
      }
      if(best)matched.push({...best,ext});else extra.push(ext);
    }
    return{matched,extra};
  }
  function billingInfo(p){
    const poRows=items(p.id),groups=invoiceGroups(p),issues=[],entries=[],totals={};
    const rows=poRows.map(po=>({po,baseQty:0,count:0,unitsPending:false,pricePending:false,priceVariance:false,prices:[],sources:[]}));
    const rowById=new Map(rows.map(r=>[r.po.id,r]));
    let unread=0;
    const add=(level,text)=>issues.push({level,text});
    for(const group of groups){
      const doc=group.doc,d=effectiveInvoice(doc),label='Factura '+(invoiceNumber(doc)||doc.file_name||'sin número'),entry={...group,data:d,issues:[]};
      const issue=(level,text)=>{const x={level,text:label+': '+text};entry.issues.push(x);issues.push(x);};
      entries.push(entry);
      if(group.docs.length>1){
        const signatures=new Set(group.docs.map(invoiceSignature).filter(Boolean));
        if(signatures.size>1)issue('review','el mismo documento tiene lecturas diferentes; revisar sus archivos antes de aprobar.');
        const numbers=new Set(group.docs.map(invoiceNumber).filter(Boolean).map(v=>norm(v).replace(/\s/g,'')));
        if(numbers.size>1)issue('review','el mismo archivo está asociado a números de factura distintos.');
        if(group.docs.some(x=>!data(x)))issue('pending','hay un archivo repetido pendiente de lectura.');
      }
      if(!d){unread++;issue('pending',doc.analysis_status==='error'?'la lectura falló; reintentar el análisis.':'falta analizar este documento.');continue;}
      const currency=String(d.currency||'').toUpperCase(),poCurrency=String(p.currency||'').toUpperCase(),sup=supplier(p.supplier_id);
      if(!currency)issue('pending','falta confirmar la moneda.');
      else if(currency!==poCurrency)issue('review','moneda '+currency+' distinta de la OC '+poCurrency+'.');
      const taxA=digits(sup.tax_id),taxB=digits(d.supplier_tax_id);
      if(taxA&&taxB&&taxA!==taxB)issue('review','el RUC del proveedor no coincide.');
      else if(!taxA&&!taxB&&sup.name&&d.supplier_name&&similarity(sup.name,d.supplier_name)<.45)issue('review','el proveedor parece diferente.');
      const buyer=(D.purchaseCompanies||[]).find(x=>x.id===p.company_id),expected=digits(buyer?.tax_id),actual=digits(d.customer_tax_id);
      if(expected&&actual&&expected!==actual)issue('review','el RUC de la empresa compradora no coincide con la OC.');
      const financial=window.AVHReceiving.financial(d);
      if(financial.total!==null&&currency)totals[currency]=(totals[currency]||0)+financial.total;
      for(const x of financial.issues)issue(x.level,x.text);
      if(d.complete===false)issue('pending','la lectura del documento está incompleta.');
      if(d.validation?.reviewed===false)issue('pending','falta completar la segunda lectura.');
      for(const text of Array.isArray(d.validation?.issues)?d.validation.issues:[])issue('pending',String(text));
      const raw=data(doc);
      if(validDate(doc.document_date)&&validDate(raw?.date)&&doc.document_date!==raw.date)issue('pending','la fecha leída difiere de la fecha registrada; revisar el original.');
      const matches=matchInvoiceRows(poRows,Array.isArray(d.items)?d.items:[]);
      entry.matched=matches.matched;
      for(const {po,ext} of matches.matched){
        const row=rowById.get(po.id);row.count++;row.sources.push(doc.id);
        const c=comparable(po,ext);
        if(!c){row.unitsPending=true;issue('pending','revisar la unidad o conversión de “'+po.description+'”.');continue;}
        row.baseQty+=c.extQty;
        if(c.poPrice===null||c.extPrice===null){row.pricePending=true;issue('pending','falta un precio legible en “'+po.description+'”.');}
        else{
          row.prices.push(c.extPrice);
          if(!same(c.poPrice,c.extPrice)){row.priceVariance=true;issue('review','precio de “'+po.description+'” '+pctText(c.poPrice,c.extPrice)+' frente a la OC.');}
        }
      }
      if(matches.extra.length)issue('review',matches.extra.length+' línea(s) no vinculadas de forma segura a la OC.');
    }
    for(const row of rows){
      const factor=n(row.po.factor_to_base),ordered=n(row.po.quantity)-n(row.po.cancelled_qty),received=n(row.po.received_qty);
      row.quantity=row.unitsPending?null:factor>0?row.baseQty/factor:null;
      row.price=row.prices.length&&row.prices.every(x=>same(x,row.prices[0]))?row.prices[0]*factor:null;
      row.over=false;
      if(groups.length&&row.quantity!==null){
        if(row.quantity>ordered&&!same(row.quantity,ordered)){row.over=true;add('review','Facturado acumulado excede la OC en “'+row.po.description+'”: '+fmtN(row.quantity)+' / '+fmtN(ordered)+' '+row.po.unit+'.');}
        if(received>row.quantity&&!same(received,row.quantity))add('pending','“'+row.po.description+'”: '+fmtN(received-row.quantity)+' '+row.po.unit+' recibidos todavía sin factura conciliada.');
        else if(row.quantity>received&&!same(row.quantity,received))add(n(row.po.cancelled_qty)>0?'review':'pending','“'+row.po.description+'”: '+fmtN(row.quantity-received)+' '+row.po.unit+(n(row.po.cancelled_qty)>0?' facturados sobre un saldo cancelado; revisar la devolución o nota de crédito.':' facturados pendientes de recibir.'));
      }
      row.complete=row.quantity!==null&&same(row.quantity,ordered)&&!row.unitsPending&&!row.pricePending&&(row.count>0||ordered===0);
    }
    return{entries,rows,issues,totals,unread,count:entries.length,complete:entries.length>0&&unread===0&&rows.length>0&&rows.every(r=>r.complete)};
  }
  function controlState(p){
    const quote=latest(p.id,'quotation'),quoteData=data(quote),q=compareExternal(p,quoteData,'Presupuesto'),billing=billingInfo(p),rec=receiptInfo(p);
    const invoice=billing.entries[0]?.doc||null,invoiceData=invoice?effectiveInvoice(invoice):null;
    const inv={issues:billing.issues,matched:{rows:billing.rows.map(r=>({po:r.po,ext:r.count?{description:r.po.description,quantity:r.quantity,unit:r.po.unit,unit_price:r.price,factor_to_base:r.po.factor_to_base,base_unit:product(r.po.product_id).base_unit}:null})),extra:[]}};
    const issues=[...q.issues,...billing.issues,...rec.issues,...items(p.id).filter(x=>x.affects_inventory).map(x=>({x,error:window.AVHReceiving.stockProblem(x,product(x.product_id))})).filter(x=>x.error).map(x=>({level:'review',text:x.x.description+': '+x.error}))];
    const review=issues.some(x=>x.level==='review'),pending=!review&&(!billing.complete||!rec.complete||issues.some(x=>x.level==='pending'));
    return{quote,invoice,quoteData,invoiceData,q,inv,rec,billing,issues,state:review?'review':pending?'pending':'ok'};
  }
  function financialHtml(doc){if(!doc)return '';const f=window.AVHReceiving.financial(doc),mode={included:'IVA incluido en el total',excluded:'IVA agregado al subtotal',none:'Sin IVA',unknown:'IVA por confirmar'}[f.mode];return `<div class="pc-issues"><div class="pc-issue info">${safe(mode)} · Total factura: <b>${cash(f.total,doc.currency)}</b>${f.tax!==null?' · IVA: '+cash(f.tax,doc.currency):''}${f.net!==null?' · Neto: '+cash(f.net,doc.currency):''}</div></div>`;}
  function stage(cls,title,text){return`<div class="pc-stage"><b>${safe(title)}</b><span class="${cls?'pc-line-'+cls:''}">${safe(text)}</span></div>`}
  function statusLabel(s){return s==='review'?'REVISAR':s==='pending'?'PENDIENTE':'OK'}
  function controlHtml(p){
    const c=controlState(p),quoteText=!c.quote?'Sin presupuesto analizado':!c.quoteData?'Presupuesto sin análisis guardado':c.q.issues.length?c.q.issues.length+' diferencia(s) vs OC':'Coincide con la OC';
    const recText=c.rec.complete&&c.rec.cancelled>0?'Recepción cerrada · saldo no entregado cancelado':!c.rec.any?'Sin recepción todavía':c.rec.complete?'Recepción completa':c.rec.ratio.toFixed(0)+'% recibido · saldo pendiente';
    const invoiceText=!c.billing.count?'Factura todavía no adjunta':c.billing.unread?c.billing.count+' factura(s) · '+c.billing.unread+' por analizar':c.billing.issues.some(x=>x.level==='review')?'Hay diferencias por revisar':c.billing.complete?c.billing.count+' factura(s) · cantidades y precios conciliados':c.billing.count+' factura(s) · facturación parcial o por confirmar';
    const billed=Object.entries(c.billing.totals).map(([currency,total])=>cash(total,currency)).join(' + ');
    const invoices=c.billing.entries.map(entry=>{
      const doc=entry.doc,date=doc.document_date||entry.data?.date,number=invoiceNumber(doc)||'Sin número';
      return '<div class="pc-invoice-record" data-pc-invoice="'+safe(doc.id)+'"><div class="title">Factura '+safe(number)+'</div><div class="subtext">'+safe(date?'Fecha registrada: '+date:'Fecha pendiente')+(entry.docs.length>1?' · '+entry.docs.length+' archivos del mismo documento':'')+'</div>'+financialHtml(entry.data)+entry.docs.map(d=>'<button type="button" class="btn sm soft" style="margin-top:8px" data-pc-analyze-invoice="'+safe(d.id)+'">'+safe(!data(d)?'Analizar factura':entry.docs.length>1?'Revisar lectura · '+(d.file_name||'archivo'):'Revisar lectura')+'</button>'+(d.analysis_error?'<div class="hint">'+safe(d.analysis_error)+'</div>':'')).join('')+'</div>';
    }).join('');
    const body=c.billing.rows.map(r=>{
      const x=r.po,review=r.over||r.priceVariance,ok=!review&&r.complete&&same(x.received_qty,x.quantity),partial=!review&&!r.unitsPending&&r.count>0&&same(r.quantity,x.received_qty);
      const status=review?'REVISAR':n(x.cancelled_qty)>0&&c.rec.complete?'CERRADO CON SALDO CANCELADO':ok?'OK':partial?'PARCIAL CONFORME':'PENDIENTE';
      const quantity=r.quantity===null?'Por confirmar':fmtN(r.quantity)+' '+safe(x.unit),price=r.price!==null?cash(r.price,p.currency):r.prices.length?'Varios precios':'—';
      return '<tr><td>'+safe(x.description)+(n(x.cancelled_qty)>0?'<div class="subtext">Cancelado sin entrega: '+fmtN(x.cancelled_qty)+' '+safe(x.unit)+'</div>':'')+'</td><td>'+fmtN(x.quantity)+' '+safe(x.unit)+'</td><td>'+fmtN(x.received_qty)+' '+safe(x.unit)+'</td><td>'+quantity+'</td><td>'+cash(x.unit_price,p.currency)+'</td><td>'+price+'</td><td class="'+(review?'pc-line-review':ok?'pc-line-ok':'pc-line-pending')+'">'+status+'</td></tr>';
    }).join('');
    return '<div class="pc-control" id="purchaseControlCard"><div class="pc-control-head"><div><h3>🔎 Control de compra</h3><div class="subtext">Presupuesto ↔ OC ↔ Facturas ↔ Recibido</div></div><span class="pc-control-badge '+c.state+'">'+statusLabel(c.state)+'</span></div><div class="pc-grid">'+stage(c.q.issues.length?'review':c.quoteData?'ok':'pending','Presupuesto → OC',quoteText)+stage(c.rec.complete?'ok':'pending','OC → Recibido',recText)+stage(c.billing.issues.some(x=>x.level==='review')?'review':c.billing.complete?'ok':'pending','OC → Facturas',invoiceText)+'</div><div class="pc-issue info pc-billing-summary" style="margin-top:10px">'+c.billing.count+' factura(s) distintas'+(billed?' · Total leído: <b>'+safe(billed)+'</b>':'')+(c.billing.unread?' · Importe pendiente de los documentos sin analizar':'')+'</div>'+(c.issues.length?'<div class="pc-issues">'+c.issues.slice(0,20).map(x=>'<div class="pc-issue '+x.level+'">'+(x.level==='review'?'⚠':'•')+' '+safe(x.text)+'</div>').join('')+'</div>':c.state==='ok'?'<div class="pc-issues"><div class="pc-issue info">✓ No se detectaron diferencias.</div></div>':'')+'<div class="pc-table-wrap"><table class="pc-table"><thead><tr><th>Ítem</th><th>OC</th><th>Recibido</th><th>Facturado acumulado</th><th>Precio OC</th><th>Precio factura</th><th>Control</th></tr></thead><tbody>'+body+'</tbody></table></div><div class="pc-invoices" style="display:grid;gap:12px;margin-top:12px">'+invoices+'</div></div>';
  }
  async function analyzeInvoice(purchaseId,documentId,opts={}){const r=await edge(CONTROL_EDGE,{purchase_id:purchaseId,document_id:documentId});if(r.error)throw Error(r.error);if(opts.reload!==false)await loadAll(true);return r.data}
  function bindControl(p){
    document.querySelectorAll('[data-pc-analyze-invoice]').forEach(b=>{b.onclick=async()=>{
      const id=b.dataset.pcAnalyzeInvoice;if(!docs(p.id).some(d=>d.id===id&&d.kind==='invoice'))return;
      b.disabled=true;const old=b.textContent;b.textContent='Analizando factura…';
      try{await analyzeInvoice(p.id,id,{reload:true});await window.openPurchaseDetail(p.id);}
      catch(e){alert(e.message||String(e));b.disabled=false;b.textContent=old;}
    }});
  }
  const oldDetail=window.openPurchaseDetail;window.openPurchaseDetail=async function(id){await oldDetail?.apply(this,arguments);if(profile?.role!=='admin')return;const p=(D.purchases||[]).find(x=>x.id===id),body=document.querySelector('#purchaseRecordEnhancements')||document.querySelector('#modalBody');if(!p||!body)return;document.querySelector('#purchaseControlCard')?.remove();const wrap=document.createElement('div');wrap.innerHTML=controlHtml(p);body.prepend(wrap.firstElementChild);bindControl(p)};
  window.AVHPurchaseControl={analyzeInvoice,controlState};
})();
