import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import * as pdfLib from 'pdf-lib';
import {makeCommercialPdf} from '../edge-functions/_shared/commercial-pdf.mjs';
import {logoDataUrl,workbookWithLogos} from './fixtures/quote-workbook.mjs';
const L=globalThis.AVHCompanyLogo,read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
test('Logos are bounded local PNG/JPEG images; remote URLs, SVG, corruption and excessive pixels are rejected',()=>{
 const good=L.read(logoDataUrl());assert.equal(good.width,192);assert.equal(good.height,64);assert.equal(good.mime,'image/png');
 for(const value of ['https://example.test/logo.png','data:image/svg+xml;base64,PHN2Zy8+','data:image/png;base64,YmFk'])assert.throws(()=>L.read(value),/logo/i);
 const huge=Buffer.from(logoDataUrl().split(',')[1],'base64');huge.writeUInt32BE(100000,16);assert.throws(()=>L.read('data:image/png;base64,'+huge.toString('base64')),/píxeles/);
 assert.throws(()=>L.read('data:image/png;base64,'+Buffer.alloc(310000).toString('base64')),/300 KB/);
});
test('Only images linked to the selected XLSX sheet are offered; multiple logos stay distinguishable',()=>{
 const dom=new JSDOM('',{runScripts:'outside-only'}),w=dom.window;w.TextDecoder=TextDecoder;
 try{
  w.eval(read('../src/assets/xlsx-0.20.3.min.js'));w.eval(read('../edge-functions/_shared/company-logo.js'));
  const X=w.XLSX,book=X.utils.book_new();for(const name of ['Otra empresa','Presupuesto'])X.utils.book_append_sheet(book,X.utils.aoa_to_sheet([['Trabajo','Precio'],['Servicio',100]]),name);
  const bytes=workbookWithLogos(X,X.write(book,{bookType:'xlsx',type:'array'}),[{sheet:1,name:'otra.png',data_url:logoDataUrl(10,10)},{sheet:2,name:'emisor.png',data_url:logoDataUrl()},{sheet:2,name:'cliente.png',data_url:logoDataUrl(40,40)}]),parsed=X.read(bytes,{type:'array',bookFiles:true});
  const a=w.AVHCompanyLogo.fromWorkbook(parsed,'Presupuesto');assert.deepEqual(Array.from(a.images,l=>l.name),['emisor.png','cliente.png']);assert.equal(a.images[0].data_url,logoDataUrl());assert.equal(a.images[1].data_url,logoDataUrl(40,40));assert.equal(w.AVHCompanyLogo.fromWorkbook(parsed,'No existe').images.length,0);
 }finally{w.close();}
});
test('A custom issuer uses its own logo on every page, or no logo at all, and never inherits the institutional author',async()=>{
 const p={title:'Trabajos del presupuesto',document_date:'2026-10-16',currency:'PYG',tax_mode:'none',tax_rate:0,recipient_name:'Cliente naval',items:[{description:'Trabajo '.repeat(1700),quantity:1,unit:'trabajo',unit_price:100,amount:100}],subtotal:100,total:100,company:{brand_avh:false,legal_name:'Talleres del Puerto S.A.',tax_id:'80123456-7',logo_data_url:logoDataUrl()}};
 const doc=await pdfLib.PDFDocument.load(await makeCommercialPdf({kind:'quote',status:'issued',number:'PRE-2026-00001',issued_payload:p},pdfLib));assert.ok(doc.getPageCount()>1);assert.equal(doc.getAuthor(),p.company.legal_name);
 for(const page of doc.getPages()){const objects=page.node.Resources().lookup(pdfLib.PDFName.of('XObject'));assert.equal(objects.keys().length,1);assert.equal(objects.lookup(objects.keys()[0]).dict.get(pdfLib.PDFName.of('Width')).asNumber(),192);}
 const noLogo=await pdfLib.PDFDocument.load(await makeCommercialPdf({kind:'quote',payload:{...p,items:p.items.slice(0,1).map(i=>({...i,description:'Trabajo'})),company:{brand_avh:false,legal_name:'Emisor sin logo',tax_id:'123-4'}}},pdfLib));assert.equal(noLogo.getAuthor(),'Emisor sin logo');const objects=noLogo.getPages()[0].node.Resources().lookupMaybe(pdfLib.PDFName.of('XObject'),pdfLib.PDFDict);assert.equal(objects?.keys().length||0,0);
 await assert.rejects(makeCommercialPdf({kind:'quote',payload:{...p,company:{...p.company,logo_data_url:'https://example.test/logo.png'}}},pdfLib),/logo/i);
});
