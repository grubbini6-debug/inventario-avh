// Local PNG/JPEG only. Never fetch a logo URL supplied by a workbook or document.
(function(root){
 const limit=300*1024;
 function read(url){
  if(!url)return null;
  if(typeof url!=='string'||url.length>409630||!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(url))throw Error('El logo debe ser una imagen PNG o JPG de hasta 300 KB.');
  const mime=url.slice(5,url.indexOf(';')),raw=atob(url.slice(url.indexOf(',')+1)),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
  if(bytes.length>limit)throw Error('El logo supera 300 KB.');let width=0,height=0;
  if(mime==='image/png'){
   if(bytes.length<45||[137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82].some((v,i)=>bytes[i]!==v)||[0,0,0,0,73,69,78,68,174,66,96,130].some((v,i)=>bytes[bytes.length-12+i]!==v))throw Error('El logo PNG no es válido.');
   const v=new DataView(bytes.buffer);width=v.getUint32(16);height=v.getUint32(20);
  }else{
   if(bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)throw Error('El logo JPG no es válido.');
   for(let pos=2;pos+3<bytes.length;){
    if(bytes[pos++]!==255)throw Error('El logo JPG no es válido.');while(bytes[pos]===255)pos++;const marker=bytes[pos++];if(marker===217||marker===218)break;
    if(marker===1||marker>=208&&marker<=215)continue;
    const size=bytes[pos]*256+bytes[pos+1];if(size<2||pos+size>bytes.length)throw Error('El logo JPG está incompleto.');
    if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){if(size<8)break;height=bytes[pos+3]*256+bytes[pos+4];width=bytes[pos+5]*256+bytes[pos+6];break;}pos+=size;
   }
  }
  if(!width||!height||width>2048||height>2048||width*height>2097152)throw Error('El logo admite hasta 2.048 píxeles por lado y 2 megapíxeles.');
  return{bytes,mime,width,height};
 }
 const encode=(bytes,mime)=>{let raw='';for(let p=0;p<bytes.length;p+=8192)raw+=String.fromCharCode(...bytes.slice(p,p+8192));return 'data:'+mime+';base64,'+btoa(raw);};
 function fromWorkbook(book,sheet){
  const images=[],warnings=[],files=book.files;if(!files)return{images,warnings};
  const xml=path=>{const value=files[path]?.content;if(!value)return null;const doc=new DOMParser().parseFromString(new TextDecoder().decode(value),'application/xml');return doc.getElementsByTagName('parsererror').length?null:doc;};
  const elements=(doc,name)=>doc?[...doc.getElementsByTagName('*')].filter(n=>n.localName===name):[];
  const resolve=(base,target)=>{if(!target||/^[a-z]+:|^\/\//i.test(target))return null;const result=target.startsWith('/')?[]:base.split('/').slice(0,-1);for(const part of target.split('/')){if(part==='..'){if(!result.length)return null;result.pop();}else if(part&&part!=='.')result.push(part);}return result.join('/');};
  const rels=path=>new Map(elements(xml(path.replace(/([^/]+)$/,'_rels/$1.rels')),'Relationship').filter(n=>n.getAttribute('TargetMode')!=='External').map(n=>[n.getAttribute('Id'),resolve(path,n.getAttribute('Target'))]));
  const relationship=n=>[...n.attributes].find(a=>a.localName==='id'&&a.namespaceURI?.includes('relationships'))?.value;
  const selected=elements(xml('xl/workbook.xml'),'sheet').find(n=>n.getAttribute('name')===sheet),path=selected&&rels('xl/workbook.xml').get(relationship(selected));if(!path)return{images,warnings};
  const sheetDoc=xml(path),sheetRels=rels(path),targets=[];
  for(const drawing of [...elements(sheetDoc,'drawing'),...elements(sheetDoc,'legacyDrawingHF')]){
   const drawingPath=sheetRels.get(relationship(drawing));if(!drawingPath)continue;const drawingRels=rels(drawingPath),drawingDoc=xml(drawingPath);
   for(const node of [...elements(drawingDoc,'blip'),...elements(drawingDoc,'imagedata')]){
    const attr=[...node.attributes].find(a=>a.localName==='relid'||['embed','id'].includes(a.localName)&&a.namespaceURI?.includes('relationships')),target=drawingRels.get(attr?.value);if(target&&!targets.includes(target))targets.push(target);
   }
  }
  for(const target of targets.slice(0,12)){
   const content=files[target]?.content;if(!content)continue;const mime=/\.png$/i.test(target)?'image/png':/\.jpe?g$/i.test(target)?'image/jpeg':null;
   if(!mime){warnings.push('La hoja contiene una imagen de formato no compatible. Podés adjuntar el logo en PNG o JPG.');continue;}
   try{if(content.length>limit)throw Error('El logo del Excel supera 300 KB.');const data_url=encode(content,mime);read(data_url);images.push({name:target.split('/').at(-1),data_url});}catch(e){warnings.push(e.message+' Adjuntá el logo por separado si corresponde.');}
  }
  if(targets.length>12)warnings.push('La hoja contiene muchas imágenes. Adjuntá el logo correcto por separado si no aparece.');
  return{images,warnings:[...new Set(warnings)]};
 }
 root.AVHCompanyLogo={read,encode,fromWorkbook};
})(globalThis);
