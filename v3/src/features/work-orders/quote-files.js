// Local previews and exact logo crops. Original files go only to the authenticated quote reader.
(function(){
 const limit=12*1024*1024,version='6.4.299';let pdfModule;
 const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 function kind(file){const name=String(file?.name||'');if(/\.(xlsx|xls|csv|tsv)$/i.test(name))return 'excel';if(/\.pdf$/i.test(name))return 'pdf';if(/\.(png|jpe?g|webp)$/i.test(name)||/^image\/(png|jpeg|webp)$/.test(file?.type||''))return 'image';throw Error('Usá Excel/CSV, PDF o fotos JPG, PNG o WebP.');}
 function release(source){for(const file of source?.files||[])if(file.pdfTask)void file.pdfTask.destroy().catch(()=>{});}
 async function pdfjs(){
  if(!pdfModule)pdfModule=import(new URL('assets/pdf.min.mjs?v='+version,document.baseURI).href).then(m=>{m.GlobalWorkerOptions.workerSrc=new URL('assets/pdf.worker.min.mjs?v='+version,document.baseURI).href;return m;}).catch(e=>{pdfModule=null;throw e;});return pdfModule;
 }
 async function pdf(file){
  if(file.pdf)return file.pdf;const lib=await pdfjs(),asset=name=>new URL('assets/'+name+'/',document.baseURI).href,task=lib.getDocument({data:new Uint8Array(file.bytes),isEvalSupported:false,useWasm:false,standardFontDataUrl:asset('standard_fonts'),cMapUrl:asset('cmaps'),cMapPacked:true});file.pdfTask=task;
  try{file.pdf=await task.promise;return file.pdf;}catch{await task.destroy().catch(()=>{});throw Error('No se pudo abrir '+file.name+'. Revisá que el PDF no esté dañado ni protegido con contraseña.');}
 }
 async function readDocuments(selected){
  const list=Array.from(selected||[]);if(!list.length||list.length>6)throw Error('Seleccioná de 1 a 6 PDF o fotos del mismo presupuesto.');if(list.some(f=>kind(f)==='excel'))throw Error('Subí un Excel por vez, o varias fotos/PDF del mismo presupuesto.');
  if(list.reduce((n,f)=>n+f.size,0)>limit)throw Error('Los archivos superan 12 MB en total.');const source={mode:'documents',files:[]};let total=0,pages=0;const hashes=new Set();
  try{for(const original of list){
   if(original.name.length>180)throw Error('El nombre de un archivo es demasiado largo. Renombralo antes de subirlo.');const bytes=new Uint8Array(await original.arrayBuffer());total+=bytes.length;if(total>limit)throw Error('Los archivos superan 12 MB en total.');
   const type=kind(original),mime_type=type==='pdf'?'application/pdf':bytes[0]===137?'image/png':bytes[0]===255&&bytes[1]===216?'image/jpeg':new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP'?'image/webp':null;
   if(!mime_type||type==='pdf'&&!new TextDecoder().decode(bytes.slice(0,1024)).includes('%PDF-'))throw Error('El archivo '+original.name+' no coincide con su formato.');
   const sha256=await hash(bytes);if(hashes.has(sha256))throw Error('Hay un archivo repetido. Seleccioná cada página una sola vez.');hashes.add(sha256);
   const file={name:original.name,mime_type,bytes,size:bytes.length,sha256,data_url:AVHCompanyLogo.encode(bytes,mime_type),pages:1,original};source.files.push(file);if(type==='pdf')file.pages=(await pdf(file)).numPages;pages+=file.pages;if(file.pages<1||file.pages>20||pages>20)throw Error('La carga admite hasta 20 páginas en total. Dividí el presupuesto.');
  }return source;}catch(e){release(source);throw e;}
 }
 async function image(file){if(file.image)return file.image;const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('No se pudo abrir la foto. Guardala en JPG, PNG o WebP.'));img.src=file.data_url;});if(!img.naturalWidth||!img.naturalHeight||img.naturalWidth*img.naturalHeight>80000000)throw Error('La foto es demasiado grande para recortarla. Usá una versión más pequeña.');file.image=img;return img;}
 async function pageCanvas(file,number,max=2000){
  const canvas=document.createElement('canvas');let width,height,original;
  if(file.mime_type==='application/pdf'){const doc=await pdf(file);if(!Number.isInteger(number)||number<1||number>doc.numPages)throw Error('Página inválida.');original=await doc.getPage(number);const base=original.getViewport({scale:1}),viewport=original.getViewport({scale:Math.min(2,max/Math.max(base.width,base.height))});width=viewport.width;height=viewport.height;canvas.width=Math.ceil(width);canvas.height=Math.ceil(height);await original.render({canvas,canvasContext:canvas.getContext('2d'),viewport}).promise;original.cleanup();}
  else{original=await image(file);const scale=Math.min(1,max/Math.max(original.naturalWidth,original.naturalHeight));width=original.naturalWidth*scale;height=original.naturalHeight*scale;canvas.width=Math.max(1,Math.round(width));canvas.height=Math.max(1,Math.round(height));canvas.getContext('2d').drawImage(original,0,0,canvas.width,canvas.height);}
  return canvas;
 }
 async function crop(source,region){
  const file=source?.files?.[region?.source_file-1];if(!file||!Number.isInteger(region.source_page)||region.source_page<1||region.source_page>file.pages||['x','y','width','height'].some(k=>!Number.isFinite(region[k]))||region.x<0||region.y<0||region.width<=0||region.height<=0||region.x+region.width>1.001||region.y+region.height>1.001)throw Error('Seleccioná un recorte dentro de la página.');
  const original=await pageCanvas(file,region.source_page,3000),sx=region.x*original.width,sy=region.y*original.height,sw=Math.min(region.width*original.width,original.width-sx),sh=Math.min(region.height*original.height,original.height-sy),scale=Math.min(1,1024/sw,512/sh),out=document.createElement('canvas');out.width=Math.max(1,Math.round(sw*scale));out.height=Math.max(1,Math.round(sh*scale));out.getContext('2d').drawImage(original,sx,sy,sw,sh,0,0,out.width,out.height);
  let url=out.toDataURL('image/png');if(url.length>409630){const ctx=out.getContext('2d');ctx.globalCompositeOperation='destination-over';ctx.fillStyle='#fff';ctx.fillRect(0,0,out.width,out.height);url=out.toDataURL('image/jpeg',.88);}AVHCompanyLogo.read(url);return url;
 }
 async function showPicker(source,{openModal,closeModal,valid,onApply}){
  const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  openModal('Recortar logo del original','Marcá solo el logo de la empresa emisora. También podés ajustar el recorte con los porcentajes.',`<div class="wo-grid"><div class="field"><label for="cdCropFile">Archivo</label><select id="cdCropFile">${source.files.map((f,i)=>`<option value="${i}">${esc(f.name)}</option>`).join('')}</select></div><div class="field"><label for="cdCropPage">Página</label><select id="cdCropPage"></select></div></div><div class="cd-crop-stage"><canvas id="cdCropCanvas" aria-label="Página original: arrastrá para seleccionar el logo"></canvas></div><div class="wo-grid">${[['x','Desde la izquierda',5],['y','Desde arriba',5],['width','Ancho',25],['height','Alto',15]].map(([k,label,value])=>`<div class="field"><label for="cdCrop-${k}">${label} (%)</label><input id="cdCrop-${k}" type="number" min="0" max="100" step="0.1" value="${value}"></div>`).join('')}</div><p id="cdCropMessage" class="hint" role="status">Abriendo página…</p><button class="btn primary" id="cdCropApply" type="button" disabled>Usar este logo</button>`);
  const find=id=>document.getElementById(id),canvas=find('cdCropCanvas'),fileSelect=find('cdCropFile'),pageSelect=find('cdCropPage'),button=find('cdCropApply'),message=find('cdCropMessage');let base=null,start=null,epoch=0;
  const region=()=>({source_file:Number(fileSelect.value)+1,source_page:Number(pageSelect.value),...Object.fromEntries(['x','y','width','height'].map(k=>[k,Number(find('cdCrop-'+k).value)/100]))});
  const draw=()=>{if(!base)return;const r=region(),ctx=canvas.getContext('2d');ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(base,0,0);ctx.strokeStyle='#b5361f';ctx.lineWidth=3;ctx.strokeRect(r.x*canvas.width,r.y*canvas.height,r.width*canvas.width,r.height*canvas.height);};
  async function loadPage(reset){const current=++epoch;button.disabled=true;base=null;if(reset){pageSelect.innerHTML=Array.from({length:source.files[Number(fileSelect.value)].pages},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('');}try{const result=await pageCanvas(source.files[Number(fileSelect.value)],Number(pageSelect.value),1600);if(current!==epoch||!canvas.isConnected||!valid())return;base=result;canvas.width=base.width;canvas.height=base.height;draw();message.textContent='Arrastrá sobre la página para encuadrar el logo.';button.disabled=false;}catch(e){if(canvas.isConnected)message.textContent=e.message;}}
  fileSelect.onchange=()=>void loadPage(true);pageSelect.onchange=()=>void loadPage(false);for(const key of ['x','y','width','height'])find('cdCrop-'+key).oninput=draw;
  const point=event=>{const b=canvas.getBoundingClientRect();return{x:Math.max(0,Math.min(1,(event.clientX-b.left)/b.width)),y:Math.max(0,Math.min(1,(event.clientY-b.top)/b.height))};};
  canvas.onpointerdown=event=>{if(!base)return;start=point(event);canvas.setPointerCapture(event.pointerId);};canvas.onpointermove=event=>{if(!start)return;const p=point(event),values={x:Math.min(p.x,start.x),y:Math.min(p.y,start.y),width:Math.abs(p.x-start.x),height:Math.abs(p.y-start.y)};for(const [key,value] of Object.entries(values))find('cdCrop-'+key).value=String(Math.round(value*1000)/10);draw();};canvas.onpointerup=canvas.onpointercancel=()=>{start=null;};
  button.onclick=async()=>{if(!valid())return closeModal();button.disabled=true;const chosen=region();try{const logo=await crop(source,chosen);if(valid()){onApply(logo,chosen);closeModal();}}catch(e){message.textContent=e.message;}finally{if(button.isConnected)button.disabled=false;}};
  await loadPage(true);
 }
 window.AVHQuoteFiles={kind,hash,readDocuments,release,crop,showPicker};
})();
