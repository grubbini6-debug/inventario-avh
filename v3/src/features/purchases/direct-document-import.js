// AVH — Lectura directa de documentos para el importador de Compras.
// XLS/XLSX: SheetJS oficial. PDF con texto: PDF.js. Reutiliza el detector existente.
(function(){
  const SHEETJS_URL='https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';
  const PDFJS_URL='https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.mjs';
  const PDF_WORKER='https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.worker.mjs';
  let sheetPromise=null,pdfPromise=null;

  async function sheetjs(){return sheetPromise||(sheetPromise=import(SHEETJS_URL))}
  async function pdfjs(){return pdfPromise||(pdfPromise=import(PDFJS_URL).then(m=>{m.GlobalWorkerOptions.workerSrc=PDF_WORKER;return m}))}

  function pageItemsToTSV(items){
    const tokens=(items||[]).filter(x=>String(x.str||'').trim()).map(x=>({text:String(x.str).trim(),x:Number(x.transform?.[4]||0),y:Number(x.transform?.[5]||0),w:Number(x.width||0)}));
    tokens.sort((a,b)=>Math.abs(b.y-a.y)>2?b.y-a.y:a.x-b.x);
    const lines=[];
    for(const t of tokens){let line=lines.find(l=>Math.abs(l.y-t.y)<=2);if(!line){line={y:t.y,items:[]};lines.push(line)}line.items.push(t)}
    lines.sort((a,b)=>b.y-a.y);
    return lines.map(line=>{
      const xs=line.items.sort((a,b)=>a.x-b.x);const cells=[];let current='',end=null;
      for(const t of xs){const gap=end==null?0:t.x-end;if(current&&gap>14){cells.push(current.trim());current=t.text}else current+=(current&&gap>2?' ':'')+t.text;end=t.x+Math.max(t.w,1)}
      if(current)cells.push(current.trim());return cells.join('\t');
    }).filter(Boolean).join('\n');
  }

  async function readSpreadsheet(file){
    const XLSX=await sheetjs(),data=await file.arrayBuffer(),wb=XLSX.read(data,{type:'array',cellDates:false});
    const sheets=wb.SheetNames||[];if(!sheets.length)throw Error('El Excel no tiene hojas legibles.');
    const parts=[];for(const name of sheets.slice(0,3)){const ws=wb.Sheets[name];if(!ws)continue;const t=XLSX.utils.sheet_to_csv(ws,{FS:'\t',RS:'\n',blankrows:false});if(t.trim())parts.push(t.trim())}
    if(!parts.length)throw Error('No encontré datos en el Excel.');return parts.join('\n');
  }

  async function readPdf(file){
    const pdfjsLib=await pdfjs(),data=new Uint8Array(await file.arrayBuffer()),pdf=await pdfjsLib.getDocument({data}).promise;const pages=[];
    const max=Math.min(pdf.numPages,30);for(let n=1;n<=max;n++){const page=await pdf.getPage(n),content=await page.getTextContent();pages.push(pageItemsToTSV(content.items))}
    const out=pages.filter(Boolean).join('\n');if(out.replace(/\s/g,'').length<30)throw Error('Este PDF parece ser escaneado o una imagen. Sin OCR/IA no puedo leer su contenido automáticamente.');return out;
  }

  function setBusy(on,text){const b=document.querySelector('#pcImportAnalyze'),m=document.querySelector('#pcImportMsg');if(b){b.disabled=on;b.textContent=on?(text||'Leyendo documento…'):'Detectar automáticamente'}if(m&&on)m.textContent=''}

  function enhance(){
    const file=document.querySelector('#pcImportFile'),text=document.querySelector('#pcImportText'),analyze=document.querySelector('#pcImportAnalyze');if(!file||!text||!analyze||file.dataset.directDoc==='1')return;
    file.dataset.directDoc='1';file.accept='.xlsx,.xls,.csv,.txt,.pdf,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain';
    const hint=file.closest('.field')?.nextElementSibling;if(hint?.classList.contains('hint'))hint.textContent='Podés subir Excel, CSV, TXT o PDF con texto. Si el PDF es una foto/escaneo, AVH te avisará.';
    file.onchange=async()=>{
      const f=file.files?.[0];if(!f)return;const name=String(f.name||'').toLowerCase();setBusy(true,'Leyendo documento…');
      try{
        if(/\.(xlsx|xls)$/.test(name))text.value=await readSpreadsheet(f);
        else if(/\.pdf$/.test(name)||f.type==='application/pdf')text.value=await readPdf(f);
        else if(/\.(csv|txt)$/.test(name)||/^text\//.test(f.type))text.value=await f.text();
        else throw Error('Formato no soportado. Usá Excel, CSV, TXT o PDF.');
        setBusy(false);analyze.click();
      }catch(e){setBusy(false);file.value='';alert(e?.message||String(e))}
    };
  }

  let queued=false;const obs=new MutationObserver(()=>{if(queued)return;queued=true;queueMicrotask(()=>{queued=false;enhance()})});obs.observe(document.body,{childList:true,subtree:true});enhance();
})();
