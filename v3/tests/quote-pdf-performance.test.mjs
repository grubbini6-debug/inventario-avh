import test from 'node:test';
import assert from 'node:assert/strict';
import * as lib from 'pdf-lib';
import {makeCommercialPdf} from '../edge-functions/_shared/commercial-pdf.mjs';
import {quoteFonts} from '../edge-functions/_shared/quote-branding.mjs';
import {printedText} from './fixtures/pdf-text.mjs';
import {logoDataUrl} from './fixtures/quote-workbook.mjs';

test('Embedded Inter retains Latin-1 text and uses the same glyph metrics to measure and draw',async()=>{
 const pdf=await lib.PDFDocument.create(),fonts=await quoteFonts(pdf),sample='Aceptación · ejecución, cañerías y chapas de 7,9 mm / m². Oficina final: 1.250,50 USD';
 const p=pdf.addPage();p.drawText(sample,{font:fonts.regular,size:10});p.drawText('PRESUPUESTO N.º PRE-2026-00001',{font:fonts.bold,size:12,y:750});
 assert.ok(Math.abs(fonts.regular.widthOfTextAtSize(sample,10)-Array.from(sample).reduce((sum,c)=>sum+fonts.regular.widthOfTextAtSize(c,10),0))<1e-9);
 const saved=await lib.PDFDocument.load(await pdf.save());assert.match(printedText(saved),/Aceptación · ejecución, cañerías/);assert.match(printedText(saved),/Oficina final: 1.250,50 USD/);assert.match(printedText(saved),/PRE-2026-00001/);
});

test('A detailed 70-job numbered quote fits the hosted 2-second CPU budget without removing scope or branding',async t=>{
 const items=Array.from({length:70},(_,n)=>({id:String(n),description:`TRABAJO-${n+1}: Cambio de chapa plana y perfil de refuerzo, sector costado estribor. Largo 4.000 mm, ancho 2.000 mm, espesor 7,9 mm. Preparación, corte, ajuste, soldadura y control según alcance aprobado.`,quantity:1,unit:'trabajo',unit_price:1050.25,amount:1050.25})),company={brand_avh:false,legal_name:'Taller de Reparaciones S.A.',tax_id:'80123456-7',logo_data_url:logoDataUrl(),brand_color:'#26384a',brand_color_mode:'manual'},p={title:'Presupuesto de reparación naval',document_date:'2026-10-16',valid_until:'2026-11-15',recipient_name:'Cliente naval',reference:'Barcaza de prueba',issuer_name:'Responsable',currency:'USD',tax_mode:'included',tax_rate:10,items,subtotal:73517.5,total:73517.5,tax_amount:6683.41,payment_terms:'A 30 días de la factura.',delivery_terms:'Según cronograma acordado.',notes:'Alcance completo de los 70 trabajos.',company};
 const start=process.cpuUsage(),bytes=await makeCommercialPdf({kind:'quote',status:'issued',number:'PRE-2026-00001',issued_payload:p},lib),usage=process.cpuUsage(start),cpu=(usage.user+usage.system)/1000;t.diagnostic(`CPU: ${Math.round(cpu)} ms; PDF: ${bytes.length} bytes`);assert.ok(cpu<1800,`La generación consumió ${Math.round(cpu)} ms de CPU; debe dejar margen bajo el límite de 2.000 ms.`);
 const pdf=await lib.PDFDocument.load(bytes),text=printedText(pdf);assert.ok(pdf.getPageCount()>3);for(let n=1;n<=70;n++)assert.match(text,new RegExp(`TRABAJO-${n}:`));assert.match(text,/PRE-2026-00001/);assert.match(text,/73.517,50/);assert.equal(pdf.getAuthor(),company.legal_name);assert.ok(pdf.getPages().every(p=>p.node.Resources().lookup(lib.PDFName.of('XObject')).keys().length>0));
});
