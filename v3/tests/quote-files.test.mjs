import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {logoDataUrl} from './fixtures/quote-workbook.mjs';
test('The file picker accepts common budget formats, hashes original photos and blocks duplicates or oversized/mixed loads',async()=>{
 const dom=new JSDOM('',{runScripts:'outside-only',url:'https://avh.test/'}),w=dom.window;Object.defineProperty(w,'crypto',{value:webcrypto});w.TextDecoder=TextDecoder;
 for(const file of ['../edge-functions/_shared/company-logo.js','../src/features/work-orders/quote-files.js'])w.eval(fs.readFileSync(new URL(file,import.meta.url),'utf8'));
 const F=w.AVHQuoteFiles,photo=(name,url)=>{const bytes=Buffer.from(url.split(',')[1],'base64');return{name,type:'image/png',size:bytes.length,arrayBuffer:async()=>bytes};},a=photo('Pagina-1.png',logoDataUrl()),b=photo('Pagina-2.png',logoDataUrl(40,40));
 try{
  for(const name of ['trabajo.xlsx','trabajo.xls','trabajo.csv','trabajo.tsv'])assert.equal(F.kind({name}),'excel');for(const name of ['foto.jpg','foto.jpeg','foto.png','foto.webp'])assert.equal(F.kind({name}),'image');assert.equal(F.kind({name:'presupuesto.pdf'}),'pdf');assert.throws(()=>F.kind({name:'archivo.exe'}),/Usá/);
  const source=await F.readDocuments([a,b]);assert.equal(source.files.length,2);assert.equal(source.files[0].data_url,logoDataUrl());assert.equal(source.files[0].sha256.length,64);assert.notEqual(source.files[0].sha256,source.files[1].sha256);F.release(source);
  await assert.rejects(F.readDocuments([a,{...a,name:'Duplicada.png'}]),/repetido/);await assert.rejects(F.readDocuments(Array.from({length:7},()=>a)),/1 a 6/);await assert.rejects(F.readDocuments([{...a,size:13*1024*1024}]),/12 MB/);await assert.rejects(F.readDocuments([a,{name:'precios.xlsx'}]),/Excel por vez/);
 }finally{w.close();}
});
