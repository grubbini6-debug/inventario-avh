// AVH — Importador automático sin IA para Compras: pegar tabla o subir CSV/TXT.
// Detecta tipo de documento, metadatos e ítems. Nada se guarda hasta confirmación del usuario.
(function(){
  const FIELD_LABELS={ignore:'Ignorar',description:'Descripción',quantity:'Cantidad',unit:'Unidad',unit_price:'Precio unitario',total:'Total'};
  const HEADER_HINTS={
    description:['descripcion','descripción','detalle','producto','material','item','ítem','articulo','artículo','concepto','denominacion','denominación'],
    quantity:['cantidad','cant','qty','quantity','qtd','qtde'],
    unit:['unidad','unid','u.m.','um','unit','und','uni'],
    unit_price:['precio unitario','precio unit','p unit','p.unit','unit price','precio','valor unitario','valor unit'],
    total:['total','importe','subtotal','valor total','monto']
  };
  const UNIT_MAP={un:'unidad',und:'unidad',uni:'unidad',unidad:'unidad',unidades:'unidad',u:'unidad',pz:'pieza',pza:'pieza',pieza:'pieza',piezas:'pieza',kg:'kg',kgs:'kg',kilo:'kg',kilos:'kg',ton:'tonelada',tn:'tonelada',tonelada:'tonelada',toneladas:'tonelada',rollo:'rollo',rollos:'rollo',bobina:'bobina',bobinas:'bobina',caja:'caja',cajas:'caja',paq:'paquete',paquete:'paquete',paquetes:'paquete',bolsa:'bolsa',bolsas:'bolsa',m:'metro',mt:'metro',mts:'metro',metro:'metro',metros:'metro',l:'litro',lt:'litro',lts:'litro',litro:'litro',litros:'litro',cil:'cilindro',cilindro:'cilindro',cilindros:'cilindro',tambor:'tambor',pallet:'pallet',pallets:'pallet',plancha:'plancha',planchas:'plancha',barra:'barra',barras:'barra',tubo:'tubo',tubos:'tubo',perfil:'perfil',perfiles:'perfil',bidon:'bidón','bidón':'bidón',servicio:'servicio',servicios:'servicio',viaje:'viaje',viajes:'viaje',hora:'hora',horas:'hora',dia:'día','día':'día',dias:'día','días':'día'};
  const DOC_LABEL={quote:'Presupuesto / cotización',po:'Orden de compra (OC)',invoice:'Factura',unknown:'Documento de compra'};

  const css=document.createElement('style');
  css.textContent=`
    .pc-import-box{margin:8px 0 10px;background:#f8fbf8;border:1px dashed #b8cbbd;border-radius:12px;padding:10px}
    .pc-import-panel{display:none;margin-top:9px}.pc-import-panel.on{display:block}
    .pc-import-grid{display:grid;grid-template-columns:1.35fr 1fr;gap:10px}
    .pc-import-preview{overflow:auto;max-height:350px;border:1px solid #dfe9e2;border-radius:10px;background:#fff}
    .pc-import-preview table{width:100%;border-collapse:collapse;font-size:12px}.pc-import-preview th,.pc-import-preview td{padding:7px;border-bottom:1px solid #edf2ee;white-space:nowrap;text-align:left}.pc-import-preview th{position:sticky;top:0;background:#f5f8f5;z-index:1}
    .pc-import-meta{display:flex;gap:7px;flex-wrap:wrap;margin:8px 0}.pc-import-meta span{font-size:11px;background:#eef4ef;border-radius:99px;padding:5px 8px}
    .pc-import-detected{border:1px solid #dfe9e2;border-radius:12px;padding:10px;background:#fff;margin-top:10px}.pc-import-detected.good{border-color:#7db58d;background:#f7fcf8}.pc-import-detected.warn{border-color:#d7b15c;background:#fffaf0}
    .pc-import-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.pc-import-fields .field{margin:0}
    .pc-import-manual{margin-top:10px;padding-top:10px;border-top:1px solid #e6ece7}.pc-import-manual summary{cursor:pointer;font-weight:800}
    @media(max-width:800px){.pc-import-grid,.pc-import-fields{grid-template-columns:1fr}}
  `;
  document.head.appendChild(css);

  const norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9%]+/g,' ').trim();
  const cleanCell=s=>String(s??'').replace(/^\s+|\s+$/g,'');
  const yyyyMmDd=(d,m,y)=>{const yy=Number(y),mm=Number(m),dd=Number(d);if(!yy||!mm||!dd||mm>12||dd>31)return null;return `${String(yy).padStart(4,'0')}-${String(mm).padStart(2,'0')}-${String(dd).padStart(2,'0')}`};

  function detectDelimiter(text){
    const lines=String(text||'').replace(/\r/g,'').split('\n').filter(x=>x.trim()).slice(0,12);if(!lines.length)return '\t';
    const score=d=>lines.reduce((a,l)=>a+(l.split(d).length-1),0);return ['\t',';',','].sort((a,b)=>score(b)-score(a))[0];
  }

  function parseDelimited(text,delimiter){
    const rows=[];let row=[],cell='',quoted=false;const src=String(text||'').replace(/\r\n/g,'\n').replace(/\r/g,'\n');
    for(let i=0;i<src.length;i++){
      const ch=src[i];if(ch==='"'){if(quoted&&src[i+1]==='"'){cell+='"';i++;continue}quoted=!quoted;continue}
      if(ch===delimiter&&!quoted){row.push(cleanCell(cell));cell='';continue}
      if(ch==='\n'&&!quoted){row.push(cleanCell(cell));cell='';if(row.some(x=>x!==''))rows.push(row);row=[];continue}cell+=ch;
    }
    row.push(cleanCell(cell));if(row.some(x=>x!==''))rows.push(row);const max=Math.max(0,...rows.map(r=>r.length));return rows.map(r=>[...r,...Array(Math.max(0,max-r.length)).fill('')]);
  }

  function mapHeader(v){const n=norm(v);for(const [field,hints] of Object.entries(HEADER_HINTS))if(hints.some(h=>n===norm(h)||n.includes(norm(h))))return field;return 'ignore'}
  function headerScore(row){return row.reduce((a,x)=>a+(mapHeader(x)!=='ignore'?1:0),0)}

  function parseNumber(v){
    let s=String(v??'').trim();if(!s)return 0;s=s.replace(/(?:usd|pyg|gs\.?|u\$s|\$)/gi,'').replace(/\s/g,'').replace(/[^0-9,.-]/g,'');if(!s)return 0;
    const comma=s.lastIndexOf(','),dot=s.lastIndexOf('.');
    if(comma>=0&&dot>=0){const dec=comma>dot?',':'.',th=dec===','?'.':',';s=s.split(th).join('').replace(dec,'.')}
    else if(comma>=0){const p=s.length-comma-1;s=p===3&&comma>0?s.replace(/,/g,''):s.replace(',','.')}
    else if(dot>=0){const p=s.length-dot-1;s=p===3&&dot>0?s.replace(/\./g,''):s}
    const n=Number(s);return Number.isFinite(n)?n:0;
  }

  function normalizeUnit(v){const n=norm(v).replace(/\s/g,'');return UNIT_MAP[n]||UNIT_MAP[n.replace(/s$/,'')]||'unidad'}

  function inferNoHeader(rows){
    const cols=Math.max(0,...rows.map(r=>r.length)),sample=rows.slice(0,8),map=Array(cols).fill('ignore');let desc=-1,unit=-1;const numeric=[];
    for(let c=0;c<cols;c++){
      const vals=sample.map(r=>r[c]).filter(Boolean),nums=vals.filter(x=>parseNumber(x)!==0).length,units=vals.filter(x=>UNIT_MAP[norm(x).replace(/\s/g,'')]).length;
      if(units>=Math.max(1,Math.ceil(vals.length*.5))&&unit<0){unit=c;continue}if(nums>=Math.max(1,Math.ceil(vals.length*.6)))numeric.push(c);else if(desc<0&&vals.some(x=>/[a-záéíóúñ]/i.test(x)))desc=c;
    }
    if(desc<0)desc=0;map[desc]='description';if(unit>=0)map[unit]='unit';const after=numeric.filter(c=>c!==desc&&c!==unit);if(after[0]!=null)map[after[0]]='quantity';if(after.length>=2)map[after[after.length-1]]='unit_price';return map;
  }

  function detectDocumentType(text){const n=norm(text);if(/\b(factura|timbrado|invoice)\b/.test(n))return'invoice';if(/\b(orden de compra|purchase order)\b/.test(n)||/(^|\s)oc(\s|$)/.test(n))return'po';if(/\b(presupuesto|cotizacion|quotation|oferta|proforma)\b/.test(n))return'quote';return'unknown'}

  function detectDate(text){
    const candidates=String(text).split(/\n/).filter(x=>/fecha|date/i.test(x)).concat(String(text).split(/\n/).slice(0,10));
    for(const line of candidates){let m=line.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);if(m)return yyyyMmDd(m[1],m[2],m[3]);m=line.match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);if(m)return yyyyMmDd(m[3],m[2],m[1])}return null;
  }

  function detectMeta(text){
    const raw=String(text||''),n=norm(raw),document_type=detectDocumentType(raw);let currency=null;
    if(/\b(?:usd|u s|dolar|dolares)\b/.test(n)||/\bUS\$|U\$S|USD\b/i.test(raw))currency='USD';
    if(/\b(?:pyg|guarani|guaranies|gs)\b/.test(n)||/\bGs\.?\b/i.test(raw))currency='PYG';
    const rucMatch=raw.match(/(?:ruc|tax\s*id)\s*[:#-]?\s*([0-9.-]{5,20})/i),ruc=cleanCell(rucMatch?.[1]||'');
    const suppliers=(D.suppliers||[]).filter(s=>s.name).map(s=>({s,n:norm(s.name),r:String(s.tax_id||'').replace(/\D/g,'')})).filter(x=>(x.n.length>=4&&n.includes(x.n))||(ruc&&x.r&&x.r===ruc.replace(/\D/g,''))).sort((a,b)=>b.n.length-a.n.length);const supplier=suppliers[0]?.s||null;
    const refPatterns={invoice:/(?:factura|invoice)\s*(?:n(?:ro|º|°)?\.?|no\.?|#)?\s*[:#-]?\s*([A-Z0-9._\/-]{2,35})/i,po:/(?:orden\s+de\s+compra|purchase\s+order|\boc\b)\s*(?:n(?:ro|º|°)?\.?|no\.?|#)?\s*[:#-]?\s*([A-Z0-9._\/-]{2,35})/i,quote:/(?:presupuesto|cotizaci[oó]n|quotation|oferta|proforma)\s*(?:n(?:ro|º|°)?\.?|no\.?|#)?\s*[:#-]?\s*([A-Z0-9._\/-]{2,35})/i};
    const reference=cleanCell(raw.match(refPatterns[document_type]||/(?:nro|no\.|#)\s*[:#-]?\s*([A-Z0-9._\/-]{2,35})/i)?.[1]||'')||null;
    const paymentLine=raw.split(/\n/).find(x=>/(condici[oó]n.*pago|forma.*pago|payment terms|plazo.*pago)/i.test(x));
    const deliveryLine=raw.split(/\n/).find(x=>/(entrega|delivery|plazo.*entrega)/i.test(x));
    const totalMatches=[...raw.matchAll(/(?:total\s*(?:general)?|importe\s*total|grand\s*total)\s*[:\-]?\s*(?:USD|PYG|Gs\.?|US\$|\$)?\s*([0-9.,]+)/gi)],total=totalMatches.length?parseNumber(totalMatches[totalMatches.length-1][1]):0;
    return{document_type,currency,supplier,ruc,reference,date:detectDate(raw),payment_terms:paymentLine?paymentLine.replace(/^.*?(?:pago|terms)\s*[:\-]?/i,'').trim():null,delivery:deliveryLine?.trim()||null,total};
  }

  function findProduct(description){const d=norm(description);if(!d)return null;const ps=(D.products||[]).filter(x=>x.active);return ps.find(p=>norm(p.name)===d||norm(p.code||'')===d)||ps.find(p=>{const pn=norm(p.name);return pn.length>=8&&d.includes(pn)})||null}

  function extractItems(data){
    const body=data.rows.slice(data.headerIndex+1).filter(r=>r.some(Boolean)),map=data.mapping,items=[];
    for(const r of body){let description='',quantity=0,unit='unidad',unitPrice=0,total=0;map.forEach((field,i)=>{const v=r[i];if(field==='description')description=cleanCell(v);else if(field==='quantity')quantity=parseNumber(v);else if(field==='unit')unit=normalizeUnit(v);else if(field==='unit_price')unitPrice=parseNumber(v);else if(field==='total')total=parseNumber(v)});if(!description&&!quantity&&!unitPrice&&!total)continue;if(!description||quantity<=0)continue;if(!unitPrice&&total&&quantity)unitPrice=total/quantity;const p=findProduct(description);items.push({product_id:p?.id||null,description,quantity,unit:p?.base_unit&&unit==='unidad'?p.base_unit:unit,unit_price:unitPrice,factor_to_base:1,affects_inventory:!!p&&document.querySelector('#pcDest')?.value==='warehouse'})}return items;
  }

  function confidence(data,items){const m=data.mapping;let score=0;if(m.includes('description'))score+=30;if(m.includes('quantity'))score+=25;if(m.includes('unit_price')||m.includes('total'))score+=25;if(data.headerIndex>=0)score+=10;if(items.length)score+=10;return Math.min(100,score)}

  function enhance(){
    const tabs=document.querySelector('#pcEntryModes'),bulk=document.querySelector('#pcBulkPanel');if(!tabs||!bulk||document.querySelector('#pcImportBox'))return;
    const box=document.createElement('div');box.id='pcImportBox';box.className='pc-import-box';
    box.innerHTML=`<div class="line"><div><b>📄 Importar documento de compra</b><div class="hint">Pegá el contenido de un presupuesto, OC o factura, o subí CSV/TXT. AVH intenta detectar todo y vos confirmás.</div></div><button type="button" id="pcImportToggle" class="btn sm soft">Importar</button></div><div id="pcImportPanel" class="pc-import-panel"><div class="pc-import-grid"><div><div class="field"><label>Pegar tabla / contenido</label><textarea id="pcImportText" rows="8" placeholder="Copiá desde Excel o pegá el contenido estructurado del documento"></textarea></div></div><div><div class="field"><label>O subir CSV / TXT</label><input id="pcImportFile" type="file" accept=".csv,.txt,text/csv,text/plain"></div><div class="hint">XLSX y PDF directo se agregan en la siguiente etapa. Desde Excel ya podés copiar y pegar.</div><div class="pc-bulk-actions"><button type="button" id="pcImportAnalyze" class="btn sm primary">Detectar automáticamente</button><button type="button" id="pcImportClear" class="btn sm soft">Limpiar</button></div><div id="pcImportMsg"></div></div></div><div id="pcImportResult"></div></div>`;tabs.insertAdjacentElement('beforebegin',box);
    const panel=box.querySelector('#pcImportPanel'),text=box.querySelector('#pcImportText'),file=box.querySelector('#pcImportFile'),result=box.querySelector('#pcImportResult');let parsed=null;
    box.querySelector('#pcImportToggle').onclick=()=>{panel.classList.toggle('on');box.querySelector('#pcImportToggle').textContent=panel.classList.contains('on')?'Cerrar':'Importar'};
    box.querySelector('#pcImportClear').onclick=()=>{text.value='';file.value='';result.innerHTML='';parsed=null};
    file.onchange=async()=>{const f=file.files?.[0];if(!f)return;if(!/\.(csv|txt)$/i.test(f.name)){file.value='';return alert('En esta etapa aceptamos CSV/TXT. Para Excel, copiá la tabla y pegala.')}text.value=await f.text();analyze()};

    function renderPreview(data){
      const items=extractItems(data),score=confidence(data,items),meta=data.meta,good=score>=75,headers=data.headers,body=data.rows.slice(data.headerIndex+1).filter(r=>r.some(Boolean));
      const opts=selected=>Object.entries(FIELD_LABELS).map(([k,v])=>`<option value="${k}" ${k===selected?'selected':''}>${v}</option>`).join('');
      result.innerHTML=`<div class="pc-import-detected ${good?'good':'warn'}"><div class="line"><div><b>${good?'✅':'⚠️'} ${esc(DOC_LABEL[meta.document_type]||DOC_LABEL.unknown)} detectado</b><div class="hint">Confianza estructural: ${score}%. ${good?'AVH encontró suficiente información para preparar la compra.':'Revisá los datos y, si hace falta, ajustá las columnas.'}</div></div><span class="badge ${good?'green':'amber'}">${items.length} ítem${items.length===1?'':'s'}</span></div><div class="pc-import-fields" style="margin-top:10px"><div class="field"><label>Proveedor detectado</label><select id="pcDetectedSupplier"><option value="">No detectado / elegir después</option>${(D.suppliers||[]).map(s=>`<option value="${s.id}" ${meta.supplier?.id===s.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select></div><div class="field"><label>Moneda detectada</label><select id="pcDetectedCurrency"><option value="">No detectada</option><option value="PYG" ${meta.currency==='PYG'?'selected':''}>PYG</option><option value="USD" ${meta.currency==='USD'?'selected':''}>USD</option></select></div><div class="field"><label>Número / referencia</label><input id="pcDetectedReference" value="${esc(meta.reference||'')}"></div><div class="field"><label>Fecha detectada</label><input id="pcDetectedDate" type="date" value="${esc(meta.date||'')}"></div><div class="field"><label>Condición de pago</label><input id="pcDetectedTerms" value="${esc(meta.payment_terms||'')}"></div><div class="field"><label>Total detectado</label><input id="pcDetectedTotal" value="${meta.total||''}" readonly></div></div>${meta.delivery?`<div class="hint" style="margin-top:8px">Entrega/plazo detectado: ${esc(meta.delivery)}</div>`:''}<div class="pc-import-meta"><span>Tipo: <b>${esc(DOC_LABEL[meta.document_type]||DOC_LABEL.unknown)}</b></span>${meta.ruc?`<span>RUC leído: <b>${esc(meta.ruc)}</b></span>`:''}<span>Las filas quedan editables antes de guardar</span></div></div><div class="section-head"><div><h2>Ítems detectados</h2><p>Vista previa de las primeras filas.</p></div></div><div class="pc-import-preview"><table><thead><tr><th>Descripción</th><th>Cantidad</th><th>Unidad</th><th>Precio unit.</th><th>Producto AVH</th></tr></thead><tbody>${items.slice(0,15).map(x=>`<tr><td>${esc(x.description)}</td><td>${fmt(x.quantity)}</td><td>${esc(x.unit)}</td><td>${x.unit_price?fmt(x.unit_price):'—'}</td><td>${x.product_id?'Vinculado':'Revisar'}</td></tr>`).join('')||'<tr><td colspan="5">No se pudieron armar ítems todavía.</td></tr>'}</tbody></table></div><div class="pc-bulk-actions"><button type="button" id="pcImportConfirm" class="btn primary" ${items.length?'':'disabled'}>Confirmar y preparar compra</button></div><details class="pc-import-manual" ${good?'':'open'}><summary>Ajustar detección de columnas</summary><div class="hint" style="margin:6px 0">Usalo solo si AVH interpretó mal una columna.</div><div class="pc-import-preview"><table><thead><tr>${headers.map((h,i)=>`<th><div>${esc(h||`Columna ${i+1}`)}</div><select data-import-map="${i}">${opts(data.mapping[i])}</select></th>`).join('')}</tr></thead><tbody>${body.slice(0,8).map(r=>`<tr>${headers.map((_,i)=>`<td>${esc(r[i]||'')}</td>`).join('')}</tr>`).join('')}</tbody></table></div><button type="button" id="pcImportRefresh" class="btn sm soft" style="margin-top:8px">Volver a detectar con este mapeo</button></details><div id="pcImportResultMsg"></div>`;
      result.querySelectorAll('[data-import-map]').forEach(s=>s.onchange=()=>{data.mapping[Number(s.dataset.importMap)]=s.value});
      result.querySelector('#pcImportRefresh').onclick=()=>renderPreview(data);result.querySelector('#pcImportConfirm').onclick=()=>confirmImport(data);
    }

    function analyze(){
      const raw=text.value.trim(),msgEl=box.querySelector('#pcImportMsg');if(!raw){if(typeof msg==='function')return msg(msgEl,'Pegá una tabla o subí un CSV/TXT.');return}
      const delimiter=detectDelimiter(raw),rows=parseDelimited(raw,delimiter);if(!rows.length){if(typeof msg==='function')return msg(msgEl,'No pude detectar filas.');return}
      let headerIndex=-1,best=0;rows.forEach((r,i)=>{const s=headerScore(r);if(s>best){best=s;headerIndex=i}});if(best<2)headerIndex=-1;
      const headers=headerIndex>=0?rows[headerIndex].map((x,i)=>x||`Columna ${i+1}`):rows[0].map((_,i)=>`Columna ${i+1}`),mapping=headerIndex>=0?headers.map(mapHeader):inferNoHeader(rows);
      parsed={raw,rows,headerIndex,headers,mapping,meta:detectMeta(raw)};renderPreview(parsed);
    }
    box.querySelector('#pcImportAnalyze').onclick=analyze;

    function confirmImport(data){
      const items=extractItems(data),out=result.querySelector('#pcImportResultMsg');if(!items.length){if(typeof msg==='function')return msg(out,'No encontré filas válidas con descripción y cantidad. Revisá el mapeo.');return}
      const supplier=document.querySelector('#pcDetectedSupplier')?.value||'',currency=document.querySelector('#pcDetectedCurrency')?.value||'',reference=document.querySelector('#pcDetectedReference')?.value.trim()||'',date=document.querySelector('#pcDetectedDate')?.value||'',terms=document.querySelector('#pcDetectedTerms')?.value.trim()||'';
      if(supplier&&document.querySelector('#pcSupplier'))document.querySelector('#pcSupplier').value=supplier;if(currency&&document.querySelector('#pcCurrency'))document.querySelector('#pcCurrency').value=currency;if(reference&&document.querySelector('#pcReference'))document.querySelector('#pcReference').value=reference;if(date&&document.querySelector('#pcDate'))document.querySelector('#pcDate').value=date;if(terms&&document.querySelector('#pcTerms'))document.querySelector('#pcTerms').value=terms;
      if(data.meta.document_type==='invoice'){if(document.querySelector('#pcInvoice'))document.querySelector('#pcInvoice').value=reference;if(document.querySelector('#pcStatus'))document.querySelector('#pcStatus').value='ordered'}else if(data.meta.document_type==='po'){if(document.querySelector('#pcStatus'))document.querySelector('#pcStatus').value='ordered'}else if(data.meta.document_type==='quote'){if(document.querySelector('#pcStatus'))document.querySelector('#pcStatus').value='quoted'}
      document.querySelector('#pcModeBulk')?.click();const host=document.querySelector('#pcBulkRows'),add=document.querySelector('#pcBulkAddRow');if(!host||!add)return alert('No encontré la carga múltiple. Cerrá y abrí Nueva compra e intentá de nuevo.');host.innerHTML='';
      items.forEach(x=>{add.click();const row=host.lastElementChild,ps=row.querySelector('[data-bulk-product]');ps.value=x.product_id||'';if(x.product_id)ps.dispatchEvent(new Event('change',{bubbles:true}));row.querySelector('[data-bulk-desc]').value=x.description;row.querySelector('[data-bulk-qty]').value=String(x.quantity);const unitSel=row.querySelector('[data-bulk-unit]');if([...unitSel.options].some(o=>o.value===x.unit))unitSel.value=x.unit;row.querySelector('[data-bulk-price]').value=x.unit_price?String(x.unit_price):'';row.querySelector('[data-bulk-factor]').value=String(x.factor_to_base||1);row.querySelector('[data-bulk-stock]').checked=!!x.affects_inventory;row.querySelector('[data-bulk-price]').dispatchEvent(new Event('input',{bubbles:true}))});
      panel.classList.remove('on');box.querySelector('#pcImportToggle').textContent='Importar';bulk.scrollIntoView({behavior:'smooth',block:'start'});
    }
  }

  let queued=false;const observer=new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;enhance()})});observer.observe(document.body,{childList:true,subtree:true});enhance();
})();
