import test from 'node:test';
import assert from 'node:assert/strict';
import * as pdfLib from 'pdf-lib';
import '../edge-functions/_shared/quote-theme.js';
import {makeCommercialPdf} from '../edge-functions/_shared/commercial-pdf.mjs';
import {quoteBranding} from '../edge-functions/_shared/quote-branding.mjs';
import {logoWithTableStrip} from './fixtures/quote-workbook.mjs';
import jpeg from 'jpeg-js';
const T=globalThis.AVHQuoteTheme;
const pixels=(...groups)=>Uint8Array.from(groups.flatMap(([rgba,count])=>Array.from({length:count},()=>rgba).flat()));
test('Logo palettes ignore white paper, transparent margins and black lettering, and keep the dominant brand color',()=>{
 const rgba=pixels([[255,255,255,255],900],[[255,0,0,0],400],[[20,20,20,255],120],[[240,154,40,255],30],[[24,66,128,255],90]);assert.equal(T.fromPixels(rgba),'#184280');
 assert.equal(T.fromPixels(pixels([[255,255,255,255],900],[[32,32,32,255],100])),'#202020');
 assert.equal(T.fromPixels(pixels([[255,255,255,255],100])),null);
 assert.equal(T.fromPixels(pixels([[0,200,0,0],100])),null);
 assert.equal(T.fromPixels(pixels([[255,238,90,255],100])),'#ffee5a');
});
test('Every palette keeps at least 4.5:1 contrast for table labels and headings, including very light logos',()=>{
 for(let r=0;r<256;r+=17)for(let g=0;g<256;g+=17)for(let b=0;b<256;b+=17){const hex='#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join(''),t=T.colors(hex);assert.ok(T.contrast(t.primary,t.headerText)>=4.5);assert.ok(T.contrast(t.heading,'#ffffff')>=4.5);assert.equal(t.primary,hex);}
 assert.equal(T.colors('#ffee5a').headerText,'#000000');assert.equal(T.colors('#184280').headerText,'#ffffff');
 for(const invalid of ['red','#123','url(https://example.test)',"#000000;display:none",{},null])assert.equal(T.normalize(invalid),null);
 assert.equal(T.normalize('#AB12EF'),'#ab12ef');
});
test('A detached table strip and white margins do not become the logo or its palette; PNG and JPEG use the same repair',()=>{
 const source=logoWithTableStrip(),a=T.analyze(source.rgba,source.width,source.height);assert.equal(a.removedRules,1);assert.equal(a.color,'#26384a');assert.ok(a.bounds.height<90);
 for(const url of [source.data_url,'data:image/jpeg;base64,'+Buffer.from(jpeg.encode({data:source.rgba,width:source.width,height:source.height},95).data).toString('base64')]){
  const company={brand_avh:false,logo_data_url:url,brand_color:'#124e19',brand_color_mode:'auto'},copy=structuredClone(company),result=quoteBranding(company),logo=globalThis.AVHCompanyLogo.read(result.company.logo_data_url);assert.ok(logo.height<100);assert.ok(logo.width>280);assert.equal(result.theme.primary.slice(1,3),'26');assert.deepEqual(company,copy);
  assert.equal(quoteBranding({...company,brand_color:'#bb2244',brand_color_mode:'manual'}).theme.primary,'#bb2244');
 }
 const solid=new Uint8Array(300*20*4);for(let i=0;i<solid.length;i+=4)solid.set([24,66,128,255],i);const lone=T.analyze(solid,300,20);assert.equal(lone.removedRules,0);assert.equal(lone.bounds.height,20);
});
test('The issued PDF uses its saved palette on every page and ignores later draft changes',async()=>{
 const company={brand_avh:false,legal_name:'Empresa Azul S.A.',tax_id:'123-4',brand_color:'#184280',brand_color_mode:'auto'},p={title:'Reparación de embarcación',document_date:'2026-10-16',recipient_name:'Cliente',currency:'USD',tax_mode:'none',tax_rate:0,items:[{description:'Trabajo '.repeat(1600),quantity:1,unit:'servicio',unit_price:100,amount:100}],subtotal:100,total:100,company};
 const seen=[],lib={...pdfLib,rgb:(...values)=>{seen.push(values);return pdfLib.rgb(...values);}};
 const doc=await pdfLib.PDFDocument.load(await makeCommercialPdf({kind:'quote',status:'issued',number:'PRE-2026-00001',issued_payload:p,payload:{...p,company:{...company,brand_color:'#ff0000'}}},lib));
 assert.ok(doc.getPageCount()>1);assert.ok(seen.some(c=>c.every((v,i)=>v===[24,66,128][i]/255)));assert.ok(!seen.some(c=>c[0]===1&&c[1]===0&&c[2]===0));
 for(const page of doc.getPages()){const contents=page.node.Contents(),stream=contents.lookup(0);const raw=new TextDecoder().decode(pdfLib.decodePDFRawStream(stream).decode());assert.match(raw,/0\.09411764705882353 0\.25882352941176473 0\.5019607843137255 rg/);}
});
