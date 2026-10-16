import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ctx={};ctx.window=ctx;for(const path of ['edge-functions/_shared/quote-excel-model.js','src/features/work-orders/commercial-model.js'])vm.runInNewContext(fs.readFileSync(new URL('../'+path,import.meta.url),'utf8'),ctx);const M=ctx.AVHCommercialModel,Q=ctx.AVHQuoteExcelModel;
const complete=()=>({title:'Reparaciones',document_date:'2026-10-16',valid_until:'2026-11-15',currency:'USD',tax_mode:'included',tax_rate:10,recipient_name:'Astillero',issuer_name:'Galo',payment_terms:'Contado',delivery_terms:'Una semana',company:{legal_name:'Taller',tax_id:'80123456-7'},items:[{id:'1',description:'Chapa',quantity:2,unit:'piezas',unit_price:5}]});
test('Issuing guidance covers prices, issuer, validity, delivery and tax without inventing absent data',()=>{
 const p=complete();assert.equal(M.requirements(p).length,0);p.items[0].unit_price=null;p.valid_until='';p.delivery_terms='';p.company.tax_id='';p.tax_rate=0;const issues=M.requirements(p);for(const target of ['#cd-valid_until','#cd-delivery_terms','#cd-company-tax_id','#cd-tax_rate','[data-cd-item="0"] [data-cd-line="unit_price"]'])assert.ok(issues.some(i=>i.target===target));assert.equal(p.items[0].unit_price,null);
 p.valid_until='2026-10-15';assert.ok(M.requirements(p).some(i=>i.target==='#cd-valid_until'));p.valid_until='2026-02-31';assert.ok(M.requirements(p).some(i=>i.target==='#cd-valid_until'));
});
test('Recovering source amounts fills only missing prices and preserves manual prices, quantities and other fields',()=>{
 const a=Q.parse([['Moneda','USD'],['Descripción','Cantidad','Precio unitario','Importe'],['Chapa',2,4.2,5401.2],['Soldadura',2,7.5,15],['Corte',2,3,20]]),p=complete();p.items=[{id:'1',description:'Chapa',quantity:2,unit:'piezas',unit_price:null},{id:'2',description:'Soldadura',quantity:2,unit:'servicio',unit_price:9},{id:'3',description:'Corte',quantity:7,unit:'piezas',unit_price:null}];const before=p.valid_until;assert.equal(M.recover(p,a),1);assert.equal(p.items[0].unit_price,5401.2);assert.equal(p.items[0].quantity,1);assert.equal(p.items[0].unit,'trabajo');assert.match(p.items[0].description,/original: 2/);assert.equal(p.items[1].unit_price,9);assert.equal(p.items[2].unit_price,null);assert.equal(p.items[2].quantity,7);assert.equal(p.valid_until,before);assert.equal(M.sourceMatches(p,a)[0].unit_price,5401.2);
});
test('Repeated or edited descriptions cannot recover by row position; saved item links survive reordering',()=>{
 const a=Q.parse([['Moneda','USD'],['Descripción','Cantidad','Precio unitario'],['Chapa',2,5],['Chapa',3,8]]),p=complete();p.items[0].unit_price=null;assert.equal(M.recover(p,a),0);p.items[0].description='Descripción revisada';assert.equal(M.recover(p,a),0);assert.equal(M.recover(p,a,[{id:'1',index:0}]),1);assert.equal(p.items[0].unit_price,5);assert.equal(p.items[0].description,'Descripción revisada');
});
