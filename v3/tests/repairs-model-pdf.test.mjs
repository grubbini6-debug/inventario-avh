import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import * as lib from 'pdf-lib';import fontkit from '@pdf-lib/fontkit';
import '../src/features/repairs/model.js';import '../src/features/repairs/pdf.js';import {printedText} from './fixtures/pdf-text.mjs';
const M=globalThis.AVHRepairModel;
test('missing values stay pending; tax and currency are explicit and allocations sum to the document',()=>{
 const p={...M.blank(),currency:'USD',tax_mode:'add',tax_rate:10,items:[{equipment_id:'a',description:'Servicio',quantity:1,unit_price:0.05},{equipment_id:'b',description:'Otro servicio',quantity:1,unit_price:0.05}]};
 const r=M.totals(p);assert.equal(r.total,.11);assert.equal(r.allocations.reduce((s,a)=>s+a.amount,0),.11);assert.equal(r.pending,false);
 assert.equal(M.totals({...p,items:[{...p.items[0],unit_price:null}]}).pending,true);assert.equal(M.totals({...p,tax_mode:''}).pending,true);assert.equal(M.totals({...p,currency:''}).pending,true);
 assert.equal(M.totals({...p,currency:'PYG',source_total:1}).source_difference,-1);assert.throws(()=>M.totals({...p,tax_rate:Infinity}),/importes/);
});
test('import matches only explicit unique code/serial and exact supplier identity; it never approves OCR',()=>{
 const assets=[{id:'a',code:'MIG-07',serial_number:'ABC123'},{id:'b',code:'MIG-08',serial_number:'ABC124'}],suppliers=[{id:'s',name:'Taller',tax_id:'80000000-0'}];
 const p=M.imported({currency:null,company:{tax_id:'80000000-0'},items:[{description:'MIG-07 cambiar torcha',quantity:1,unit_price:100},{description:'Equipo con serie ABC124',quantity:null,unit_price:null},{description:'Soldadora',quantity:1,unit_price:20}]},assets,suppliers);
 assert.equal(p.currency,'');assert.equal(p.tax_mode,'');assert.equal(p.supplier_id,'s');assert.equal(p.reviewed,false);assert.equal(p.items[0].equipment_id,'a');assert.equal(p.items[1].equipment_id,'b');assert.equal(p.items[1].quantity,null);assert.equal(p.items[2].equipment_id,'');
 const ambiguous=M.imported({items:[{description:'MIG-07 / MIG-08',quantity:1,unit_price:10}]},assets,[]);assert.equal(ambiguous.items[0].equipment_id,'');
});
test('order PDF uses only approved scope; machine remito keeps identity, state and accessories without prices',async()=>{
 const p={company:{legal_name:'Astillero Villa Hayes S.A.',tax_id:'80000000-1',address:'Dirección de prueba'},supplier:{name:'Taller de prueba'},warehouse_name:'ACOMAR',currency:'PYG',tax_mode:'included',quote_number:'PRES-123',quote_date:'2026-10-21',problem:'Falla de alimentación',warranty_days:30,items:[],assets:[{id:'a',code:'MIG-07',name:'Soldadora MIG',serial_number:'SERIE-123',brand:'Marca',model:'400'}],allocations:[{equipment_id:'a',amount:5000}],subtotal:5000,tax_amount:0,total:5000};
 p.items=Array.from({length:35},(_,n)=>({equipment_id:'a',description:'Trabajo '+(n+1)+': reparación y verificación de alimentador con especificaciones completas y un texto suficientemente largo para revisar los saltos de página.',quantity:1,unit_price:100,line_total:100,kind:'labor'}));
 const order={number:'REP-2026-00001',payload:{items:[{description:'CAMBIO NO AUTORIZADO'}]},approved_payload:p,approval:{authorized_by:'Dirección',reference:'Correo aprobado',recorded_at:'2026-10-21T12:00:00Z'},assets:[{equipment_id:'a',snapshot:p.assets[0],dispatch:{reference:'REM-REP-001',date:'2026-10-21',mode:'workshop',condition:'No alimenta alambre',accessories:'Torcha, masa y cabezal',carrier:'Transportista QA',plate:'TEST-123'}}]};
 const deps={lib,fontkit,regular:fs.readFileSync(new URL('../node_modules/@fontsource/inter/files/inter-latin-400-normal.woff',import.meta.url)),bold:fs.readFileSync(new URL('../node_modules/@fontsource/inter/files/inter-latin-700-normal.woff',import.meta.url))};
 const bytes=await globalThis.AVHRepairPDF.create(order,'order',null,deps),doc=await lib.PDFDocument.load(bytes),text=printedText(doc);assert.ok(doc.getPageCount()>1);assert.match(text,/Trabajo 35/);assert.doesNotMatch(text,/CAMBIO NO AUTORIZADO/);assert.match(text,/TOTAL AUTORIZADO/);assert.match(text,/REP-2026-00001/);
 const remito=await globalThis.AVHRepairPDF.create(order,'dispatch','a',deps),rtext=printedText(await lib.PDFDocument.load(remito));for(const value of ['SERIE-123','Torcha, masa y cabezal','No alimenta alambre','Transportista QA','TEST-123'])assert.ok(rtext.includes(value));assert.doesNotMatch(rtext,/5\.000|PYG|Precio|TOTAL AUTORIZADO/);
 const out=process.env.AVH_QA_OUTPUT;if(out){fs.mkdirSync(out,{recursive:true});fs.writeFileSync(out+'/repair-order.pdf',bytes);fs.writeFileSync(out+'/repair-remito.pdf',remito);}
 await assert.rejects(globalThis.AVHRepairPDF.create({...order,approved_payload:null},'order',null,deps),/autorizada/);
});
