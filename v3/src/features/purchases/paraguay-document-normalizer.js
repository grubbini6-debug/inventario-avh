// AVH — Normalización de documentos comerciales paraguayos antes del detector de Compras.
// Corrige filas PDF donde cantidad+unidad vienen unidas y resuelve cantidades decimales como 16,000 usando el total de la línea.
(function(){
  const digits=s=>String(s||'').replace(/\D/g,'');
  const norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const UNIT_RE=/^(?:un|und|uni|u|pz|pza|kg|kgs|g|tn|ton|m|mt|mts|cm|mm|m2|m3|lt|lts|l|rollo|bobina|caja|paq|bolsa|juego|kit|par|servicio)$/i;

  function parseMoney(v){
    let s=String(v??'').trim().replace(/(?:usd|pyg|gs\.?|u\$s|us\$|\$)/gi,'').replace(/\s/g,'').replace(/[^0-9,.-]/g,'');
    if(!s)return 0;
    const comma=s.lastIndexOf(','),dot=s.lastIndexOf('.');
    if(comma>=0&&dot>=0){const dec=comma>dot?',':'.',th=dec===','?'.':',';s=s.split(th).join('').replace(dec,'.')}
    else if(comma>=0){const p=s.length-comma-1;s=p===3&&comma>0?s.replace(/,/g,''):s.replace(',','.')}
    else if(dot>=0){const p=s.length-dot-1;s=p===3&&dot>0?s.replace(/\./g,''):s}
    const n=Number(s);return Number.isFinite(n)?n:0;
  }

  function qtyFromContext(raw,priceRaw,totalRaw){
    const s=String(raw||'').trim().replace(/\s/g,'').replace(/[^0-9,.-]/g,'');
    if(!s)return raw;
    const price=parseMoney(priceRaw),total=parseMoney(totalRaw);
    if(/^\d+,\d{3}$/.test(s)){
      const decimal=Number(s.replace(',','.')),thousands=Number(s.replace(/,/g,''));
      if(price>0&&total>0){
        const eDec=Math.abs(decimal*price-total),eTh=Math.abs(thousands*price-total);
        const chosen=eDec<=eTh?decimal:thousands;
        return String(Number(chosen.toFixed(6)));
      }
      return String(Number(decimal.toFixed(6)));
    }
    return raw;
  }

  function normalizeHeaderCell(cell){
    const n=norm(cell);
    if(/^(?:prec|precio|preco)\s*(?:unit|unitario)?$/.test(n)||n==='p unit'||n==='p unitario')return 'Precio unitario';
    if(n==='cant'||n==='cantidad')return 'Cantidad';
    if(n==='uni'||n==='unid'||n==='um')return 'Unidad';
    if(n==='descripcion del producto'||n==='descripcion producto')return 'Descripción';
    return cell;
  }

  function normalizeLine(line){
    let cells=String(line||'').split('\t').map(x=>x.trim());
    cells=cells.map(normalizeHeaderCell);

    if(cells.length>=4){
      const m=cells[0].match(/^([0-9.,-]+)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9²³]+)$/);
      if(m&&UNIT_RE.test(m[2])&&parseMoney(cells[cells.length-2])>0&&parseMoney(cells[cells.length-1])>0){
        const price=cells[cells.length-2],total=cells[cells.length-1];
        const qty=qtyFromContext(m[1],price,total);
        cells=[qty,m[2],...cells.slice(1)];
      }
    }

    if(cells.length>=5&&UNIT_RE.test(cells[1])&&parseMoney(cells[cells.length-2])>0&&parseMoney(cells[cells.length-1])>0){
      cells[0]=qtyFromContext(cells[0],cells[cells.length-2],cells[cells.length-1]);
    }
    return cells.join('\t');
  }

  function normalizeDocument(raw){
    let s=String(raw||'').replace(/\r/g,'');
    s=s.replace(/N\s*[º°o.]?\s*del\s*presupuesto\s*:\s*([A-Z0-9._\/-]+)/gi,'Presupuesto N°: $1');
    s=s.replace(/N\s*[º°o.]?\s*de\s*(?:la\s*)?factura\s*:\s*([A-Z0-9._\/-]+)/gi,'Factura N°: $1');
    return s.split('\n').map(normalizeLine).join('\n');
  }

  function supplierByPhone(raw){
    const lines=String(raw||'').split(/\n/).map(digits).filter(x=>x.length>=6);
    const matches=(D.suppliers||[]).filter(s=>{
      const p=digits(s.phone);if(p.length<6)return false;const sig=p.slice(-7);
      return lines.some(l=>l.includes(sig)||sig.includes(l.slice(-7)));
    });
    return matches.length===1?matches[0]:null;
  }

  document.addEventListener('click',e=>{
    const b=e.target?.closest?.('#pcImportAnalyze');if(!b)return;
    const ta=document.querySelector('#pcImportText');if(!ta?.value)return;
    ta.value=normalizeDocument(ta.value);
    const normalized=ta.value;
    queueMicrotask(()=>{
      const sel=document.querySelector('#pcDetectedSupplier');if(!sel||sel.value)return;
      const supplier=supplierByPhone(normalized);if(!supplier)return;
      sel.value=supplier.id;
      const meta=document.querySelector('#pcImportResult .pc-import-meta');
      if(meta&&!meta.querySelector('[data-phone-supplier]')){
        const tag=document.createElement('span');tag.dataset.phoneSupplier='1';tag.innerHTML=`Proveedor sugerido por teléfono: <b>${typeof esc==='function'?esc(supplier.name):supplier.name}</b>`;meta.prepend(tag);
      }
    });
  },true);
})();
