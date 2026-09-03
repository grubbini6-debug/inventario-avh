// AVH — Importador sin IA para Compras: pegar tabla o subir CSV/TXT.
// Detecta columnas, proveedor/moneda simples y pasa los ítems a Carga múltiple para revisión.
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

  const css=document.createElement('style');
  css.textContent=`
    .pc-import-box{margin:8px 0 10px;background:#f8fbf8;border:1px dashed #b8cbbd;border-radius:12px;padding:10px}
    .pc-import-panel{display:none;margin-top:9px}.pc-import-panel.on{display:block}
    .pc-import-grid{display:grid;grid-template-columns:1.4fr 1fr;gap:10px}
    .pc-import-preview{overflow:auto;max-height:360px;border:1px solid #dfe9e2;border-radius:10px;background:#fff}
    .pc-import-preview table{width:100%;border-collapse:collapse;font-size:12px}.pc-import-preview th,.pc-import-preview td{padding:7px;border-bottom:1px solid #edf2ee;white-space:nowrap;text-align:left}.pc-import-preview th{position:sticky;top:0;background:#f5f8f5;z-index:1}
    .pc-import-meta{display:flex;gap:7px;flex-wrap:wrap;margin:8px 0}.pc-import-meta span{font-size:11px;background:#eef4ef;border-radius:99px;padding:5px 8px}
    @media(max-width:800px){.pc-import-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(css);

  const norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9%]+/g,' ').trim();
  const escAttr=s=>String(s??'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const cleanCell=s=>String(s??'').replace(/^\s+|\s+$/g,'');

  function detectDelimiter(text){
    const lines=text.replace(/\r/g,'').split('\n').filter(x=>x.trim()).slice(0,12);
    if(!lines.length)return '\t';
    const score=d=>lines.reduce((a,l)=>a+(l.split(d).length-1),0);
    const choices=['\t',';',','];
    return choices.sort((a,b)=>score(b)-score(a))[0];
  }

  function parseDelimited(text,delimiter){
    const rows=[];let row=[],cell='',quoted=false;
    const src=String(text||'').replace(/\r\n/g,'\n').replace(/\r/g,'\n');
    for(let i=0;i<src.length;i++){
      const ch=src[i];
      if(ch==='"'){
        if(quoted&&src[i+1]==='"'){cell+='"';i++;continue}
        quoted=!quoted;continue;
      }
      if(ch===delimiter&&!quoted){row.push(cleanCell(cell));cell='';continue}
      if(ch==='\n'&&!quoted){row.push(cleanCell(cell));cell='';if(row.some(x=>x!==''))rows.push(row);row=[];continue}
      cell+=ch;
    }
    row.push(cleanCell(cell));if(row.some(x=>x!==''))rows.push(row);
    const max=Math.max(0,...rows.map(r=>r.length));return rows.map(r=>[...r,...Array(Math.max(0,max-r.length)).fill('')]);
  }

  function mapHeader(v){
    const n=norm(v);
    for(const [field,hints] of Object.entries(HEADER_HINTS))if(hints.some(h=>n===norm(h)||n.includes(norm(h))))return field;
    return 'ignore';
  }

  function headerScore(row){return row.reduce((a,x)=>a+(mapHeader(x)!=='ignore'?1:0),0)}

  function parseNumber(v){
    let s=String(v??'').trim();if(!s)return 0;
    s=s.replace(/(?:usd|pyg|gs\.?|u\$s|\$)/gi,'').replace(/\s/g,'').replace(/[^0-9,.-]/g,'');
    if(!s)return 0;
    const comma=s.lastIndexOf(','),dot=s.lastIndexOf('.');
    if(comma>=0&&dot>=0){const dec=comma>dot?',':'.',th=dec===','?'.':',';s=s.split(th).join('').replace(dec,'.')}
    else if(comma>=0){const p=s.length-comma-1;s=p===3&&comma>0?s.replace(/,/g,''):s.replace(',','.')}
    else if(dot>=0){const p=s.length-dot-1;s=p===3&&dot>0?s.replace(/\./g,''):s}
    const n=Number(s);return Number.isFinite(n)?n:0;
  }

  function normalizeUnit(v){const n=norm(v).replace(/\s/g,'');return UNIT_MAP[n]||UNIT_MAP[n.replace(/s$/,'')]||'unidad'}

  function inferNoHeader(rows){
    const cols=Math.max(0,...rows.map(r=>r.length)),sample=rows.slice(0,8),map=Array(cols).fill('ignore');
    let desc=-1,unit=-1;const numeric=[];
    for(let c=0;c<cols;c++){
      const vals=sample.map(r=>r[c]).filter(Boolean),nums=vals.filter(x=>parseNumber(x)!==0).length,units=vals.filter(x=>UNIT_MAP[norm(x).replace(/\s/g,'')]).length;
      if(units>=Math.max(1,Math.ceil(vals.length*.5))&&unit<0){unit=c;continue}
      if(nums>=Math.max(1,Math.ceil(vals.length*.6)))numeric.push(c);
      else if(desc<0&&vals.some(x=>/[a-záéíóúñ]/i.test(x)))desc=c;
    }
    if(desc<0)desc=0;map[desc]='description';if(unit>=0)map[unit]='unit';
    const after=numeric.filter(c=>c!==desc&&c!==unit);if(after[0]!=null)map[after[0]]='quantity';if(after.length>=2)map[after[after.length-1]]='unit_price';
    return map;
  }

  function detectMeta(text){
    const n=norm(text);let currency=null;if(/\b(?:usd|u s|dolar|dolares)\b/.test(n)||/\$/.test(text))currency='USD';if(/\b(?:pyg|guarani|guaranies|gs)\b/.test(n))currency='PYG';
    const suppliers=(D.suppliers||[]).filter(s=>s.name).map(s=>({s,n:norm(s.name)})).filter(x=>x.n.length>=4&&n.includes(x.n)).sort((a,b)=>b.n.length-a.n.length);
    const supplier=suppliers[0]?.s||null;
    let reference=null;const m=String(text).match(/(?:presupuesto|cotizaci[oó]n|orden\s+de\s+compra|\boc\b)\s*(?:n(?:ro|º|°)?\.?|no\.?|#)?\s*[:#-]?\s*([A-Z0-9._\/-]{2,30})/i);if(m)reference=m[1];
    return{currency,supplier,reference};
  }

  function findProduct(description){
    const d=norm(description);if(!d)return null;const ps=(D.products||[]).filter(x=>x.active);
    return ps.find(p=>norm(p.name)===d||norm(p.code||'')===d)||ps.find(p=>{const pn=norm(p.name);return pn.length>=8&&d.includes(pn)})||null;
  }

  function enhance(){
    const tabs=document.querySelector('#pcEntryModes'),bulk=document.querySelector('#pcBulkPanel');
    if(!tabs||!bulk||document.querySelector('#pcImportBox'))return;
    const box=document.createElement('div');box.id='pcImportBox';box.className='pc-import-box';
    box.innerHTML=`<div class="line"><div><b>📄 Importar presupuesto / OC</b><div class="hint">Sin IA: pegá una tabla de Excel o subí un CSV/TXT. Nada se guarda hasta que vos revises.</div></div><button type="button" id="pcImportToggle" class="btn sm soft">Abrir importador</button></div><div id="pcImportPanel" class="pc-import-panel"><div class="pc-import-grid"><div><div class="field"><label>Pegar tabla</label><textarea id="pcImportText" rows="8" placeholder="Copiá filas desde Excel y pegá acá. Ej.: Descripción | Cantidad | Unidad | Precio"></textarea></div></div><div><div class="field"><label>O subir archivo CSV / TXT</label><input id="pcImportFile" type="file" accept=".csv,.txt,text/csv,text/plain"></div><div class="hint">XLSX y PDF los agregamos en la siguiente etapa. Por ahora, desde Excel podés copiar y pegar directamente.</div><div class="pc-bulk-actions"><button type="button" id="pcImportAnalyze" class="btn sm primary">Detectar datos</button><button type="button" id="pcImportClear" class="btn sm soft">Limpiar</button></div><div id="pcImportMsg"></div></div></div><div id="pcImportResult"></div></div>`;
    tabs.insertAdjacentElement('beforebegin',box);

    const panel=box.querySelector('#pcImportPanel'),text=box.querySelector('#pcImportText'),file=box.querySelector('#pcImportFile'),result=box.querySelector('#pcImportResult');let parsed=null;
    box.querySelector('#pcImportToggle').onclick=()=>{panel.classList.toggle('on');box.querySelector('#pcImportToggle').textContent=panel.classList.contains('on')?'Cerrar importador':'Abrir importador'};
    box.querySelector('#pcImportClear').onclick=()=>{text.value='';file.value='';result.innerHTML='';parsed=null};
    file.onchange=async()=>{const f=file.files?.[0];if(!f)return;if(!/\.(csv|txt)$/i.test(f.name)){file.value='';return alert('En esta primera etapa aceptamos CSV/TXT. Para Excel, copiá la tabla y pegala en el cuadro.')}text.value=await f.text()};

    function renderPreview(data){
      const {rows,headerIndex,headers,mapping,meta}=data,body=rows.slice(headerIndex+1).filter(r=>r.some(Boolean));
      const opts=selected=>Object.entries(FIELD_LABELS).map(([k,v])=>`<option value="${k}" ${k===selected?'selected':''}>${v}</option>`).join('');
      result.innerHTML=`<div class="pc-import-meta">${meta.supplier?`<span>Proveedor detectado: <b>${esc(meta.supplier.name)}</b></span>`:''}${meta.currency?`<span>Moneda: <b>${meta.currency}</b></span>`:''}${meta.reference?`<span>Referencia: <b>${esc(meta.reference)}</b></span>`:''}<span>${body.length} filas detectadas</span></div><div class="section-head"><div><h2>Vista previa</h2><p>Revisá qué significa cada columna antes de importar.</p></div></div><div class="pc-import-preview"><table><thead><tr>${headers.map((h,i)=>`<th><div>${esc(h||`Columna ${i+1}`)}</div><select data-import-map="${i}">${opts(mapping[i])}</select></th>`).join('')}</tr></thead><tbody>${body.slice(0,12).map(r=>`<tr>${headers.map((_,i)=>`<td>${esc(r[i]||'')}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="pc-bulk-actions"><button type="button" id="pcImportToBulk" class="btn primary">Pasar a carga múltiple</button></div><div id="pcImportResultMsg"></div>`;
      result.querySelectorAll('[data-import-map]').forEach(s=>s.onchange=()=>{data.mapping[Number(s.dataset.importMap)]=s.value});
      result.querySelector('#pcImportToBulk').onclick=()=>importToBulk(data);
    }

    function analyze(){
      const raw=text.value.trim(),msgEl=box.querySelector('#pcImportMsg');if(!raw){if(typeof msg==='function')return msg(msgEl,'Pegá una tabla o subí un CSV/TXT.');return}
      const delimiter=detectDelimiter(raw),rows=parseDelimited(raw,delimiter);if(!rows.length){if(typeof msg==='function')return msg(msgEl,'No pude detectar filas.');return}
      let headerIndex=-1,best=0;rows.forEach((r,i)=>{const s=headerScore(r);if(s>best){best=s;headerIndex=i}});if(best<2)headerIndex=-1;
      const headers=headerIndex>=0?rows[headerIndex].map((x,i)=>x||`Columna ${i+1}`):rows[0].map((_,i)=>`Columna ${i+1}`);
      const mapping=headerIndex>=0?headers.map(mapHeader):inferNoHeader(rows);
      parsed={raw,rows,headerIndex,headers,mapping,meta:detectMeta(raw)};renderPreview(parsed);
    }
    box.querySelector('#pcImportAnalyze').onclick=analyze;

    function importToBulk(data){
      const body=data.rows.slice(data.headerIndex+1).filter(r=>r.some(Boolean)),map=data.mapping,items=[];
      for(const r of body){let description='',quantity=0,unit='unidad',unitPrice=0,total=0;map.forEach((field,i)=>{const v=r[i];if(field==='description')description=cleanCell(v);else if(field==='quantity')quantity=parseNumber(v);else if(field==='unit')unit=normalizeUnit(v);else if(field==='unit_price')unitPrice=parseNumber(v);else if(field==='total')total=parseNumber(v)});if(!description&&!quantity&&!unitPrice&&!total)continue;if(!description||quantity<=0)continue;if(!unitPrice&&total&&quantity)unitPrice=total/quantity;const p=findProduct(description);items.push({product_id:p?.id||null,description,quantity,unit:p?.base_unit&&unit==='unidad'?p.base_unit:unit,unit_price:unitPrice,factor_to_base:1,affects_inventory:!!p&&document.querySelector('#pcDest')?.value==='warehouse'})}
      const out=result.querySelector('#pcImportResultMsg');if(!items.length){if(typeof msg==='function')return msg(out,'No encontré filas válidas con descripción y cantidad. Revisá el mapeo de columnas.');return}
      if(data.meta.currency&&document.querySelector('#pcCurrency'))document.querySelector('#pcCurrency').value=data.meta.currency;
      if(data.meta.supplier&&document.querySelector('#pcSupplier'))document.querySelector('#pcSupplier').value=data.meta.supplier.id;
      if(data.meta.reference&&document.querySelector('#pcReference')&&!document.querySelector('#pcReference').value)document.querySelector('#pcReference').value=data.meta.reference;
      document.querySelector('#pcModeBulk')?.click();const host=document.querySelector('#pcBulkRows'),add=document.querySelector('#pcBulkAddRow');if(!host||!add)return alert('No encontré la carga múltiple. Cerrá y abrí Nueva compra e intentá de nuevo.');host.innerHTML='';
      items.forEach(x=>{add.click();const row=host.lastElementChild,ps=row.querySelector('[data-bulk-product]');ps.value=x.product_id||'';if(x.product_id)ps.dispatchEvent(new Event('change',{bubbles:true}));row.querySelector('[data-bulk-desc]').value=x.description;row.querySelector('[data-bulk-qty]').value=String(x.quantity);row.querySelector('[data-bulk-unit]').value=UNIT_MAP[norm(x.unit).replace(/\s/g,'')]||x.unit||'unidad';row.querySelector('[data-bulk-price]').value=x.unit_price?String(x.unit_price):'';row.querySelector('[data-bulk-factor]').value=String(x.factor_to_base||1);row.querySelector('[data-bulk-stock]').checked=!!x.affects_inventory;row.querySelector('[data-bulk-price]').dispatchEvent(new Event('input',{bubbles:true}))});
      panel.classList.remove('on');box.querySelector('#pcImportToggle').textContent='Abrir importador';bulk.scrollIntoView({behavior:'smooth',block:'start'});
    }
  }

  let queued=false;const observer=new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;enhance()})});observer.observe(document.body,{childList:true,subtree:true});enhance();
})();
