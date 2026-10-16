import * as pdfLib from 'pdf-lib';
export function printedText(doc){
 return doc.getPages().flatMap(page=>{
  const fonts=page.node.Resources().lookup(pdfLib.PDFName.of('Font')),maps=new Map();
  for(const key of fonts.keys()){
   const font=fonts.lookup(key),ref=font.get(pdfLib.PDFName.of('ToUnicode'));if(!ref)continue;
   const cmap=new TextDecoder().decode(pdfLib.decodePDFRawStream(doc.context.lookup(ref)).decode()),map=new Map();
   for(const section of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))for(const pair of section[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)){const words=pair[2].match(/.{4}/g)||[];map.set(pair[1].toUpperCase(),String.fromCharCode(...words.map(w=>parseInt(w,16))));}maps.set(key.decodeText(),map);
  }
  let active='';return page.node.Contents().asArray().flatMap(ref=>{
   const result=[],stream=new TextDecoder().decode(pdfLib.decodePDFRawStream(doc.context.lookup(ref)).decode());
   for(const token of stream.matchAll(/\/([^\s]+)\s+[0-9.]+\s+Tf|<([0-9A-F]+)>\s*Tj/g)){if(token[1])active=token[1];else{const map=maps.get(active);result.push(map?(token[2].match(/.{4}/g)||[]).map(code=>map.get(code)||'').join(''):Buffer.from(token[2],'hex').toString('latin1'));}}return result;
  });
 }).join(' ');
}
