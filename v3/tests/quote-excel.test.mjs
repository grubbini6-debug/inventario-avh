import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ctx={};vm.runInNewContext(fs.readFileSync(new URL('../edge-functions/_shared/quote-excel-model.js',import.meta.url),'utf8'),ctx);const Q=ctx.AVHQuoteExcelModel;
export const quoteRows=[['Presupuesto de trabajos 716'],['Cliente','Cliente naval'],['Moneda','USD'],['IVA incluido 10%'],['Válido hasta','15/11/2026'],['Condición de pago','Contado'],['Plazo de entrega','En una semana'],['Descripción','Cantidad','Unidad','Precio unitario USD','Importe USD'],['Reparación de chapa 7.9 mm',3,'unidad',.335,1.01],['Corte y plegado',2,'servicio',7.5,15],['Subtotal',null,null,null,16.01],['Total general',null,null,null,16.01]];
test('Excel prices, quantities, source rows and metadata survive without totals becoming work items',()=>{
 const a=Q.parse(quoteRows,'Presupuesto');assert.equal(a.items.length,2);assert.equal(a.items[0].source_row,9);assert.equal(a.items[0].unit_price,.335);assert.equal(a.items[0].quantity,3);assert.equal(a.currency,'USD');assert.equal(a.tax_mode,'included');assert.equal(a.tax_rate,10);assert.equal(a.fields.recipient_name,'Cliente naval');assert.equal(a.fields.valid_until,'2026-11-15');assert.equal(a.fields.payment_terms,'Contado');assert.equal(a.calculated_total,16.01);assert.equal(a.source_total,16.01);assert.equal(a.warnings.length,0);
});
test('Global work prices and price-per-kg or area columns remain explicit and reviewable',()=>{
 const global=Q.parse([['Moneda','PYG'],['Trabajo','Importe'],['Varado','₲ 1.500.000'],['Total','1.500.000']]);assert.equal(global.items[0].quantity,1);assert.equal(global.items[0].unit_price,1500000);assert.equal(global.items[0].unit,'trabajo');assert.match(global.warnings.join(' '),/1 trabajo/);
 const area=Q.parse([['Moneda','USD'],['Descripción','m²','Precio por m2','Importe'],['Pintura',25,2.5,62.5]]);assert.equal(area.items[0].unit,'m²');assert.equal(area.items[0].quantity,25);assert.equal(area.items[0].unit_price,2.5);
});
test('Missing unit prices may be derived only from a matching source total; conflicts remain pending',()=>{
 const a=Q.parse([['Moneda','USD'],['Descripción','Cantidad','Precio unitario','Importe'],['Soldadura',4,null,10],['Chapa',2,5,50],['Sin precio',3,null,null]]);assert.equal(a.items[0].unit_price,2.5);assert.equal(a.items[1].unit_price,null);assert.equal(a.items[2].unit_price,null);assert.match(a.warnings.join(' '),/no coincide/);assert.equal(a.calculated_total,null);
 const b=Q.parse([['Moneda','USD'],['Descripción','Cantidad','Precio unitario'],['Cero',0,5],['Negativo',1,-5]]);assert.equal(b.items[0].quantity,null);assert.equal(b.items[1].unit_price,null);
});
test('Totals use the same decimal rounding as the quote; different sheet totals are called out',()=>{
 const a=Q.parse([['Moneda','USD'],['Descripción','Cantidad','Precio unitario','Importe'],['Trabajo',1,2.675,2.68],['Total',null,null,2.68]]);assert.equal(a.items[0].unit_price,2.675);assert.equal(a.calculated_total,2.68);
 const b=Q.parse([['Moneda','USD'],['IVA 10%'],['Descripción','Cantidad','Precio unitario'],['Trabajo',2,5],['Total general',null,11]]);assert.equal(b.calculated_total,11);
 const c=Q.parse([['Descripción','Precio unitario'],['Trabajo',100],['Descuento',10],['Total general',90]]);assert.match(c.warnings.join(' '),/descuento/);assert.match(c.warnings.join(' '),/difiere/);
});
test('Mapping can only select real, distinct source columns and cannot hide the first work row as a header',()=>{
 const rows=[['Operación','Q de piezas','Valor pactado'],['Recambio',3,25]];assert.equal(Q.parse(rows).needs_mapping,true);const a=Q.parse(rows,'Hoja',{header_row:1,description:0,quantity:1,unit_price:2});assert.equal(a.items[0].unit_price,25);
 assert.throws(()=>Q.parse(rows,'',{header_row:1,description:0,unit_price:99}),/fuera/);assert.throws(()=>Q.parse(rows,'',{header_row:1,description:0,unit_price:0}),/diferentes/);
 assert.throws(()=>Q.parse([['Trabajo',3,25],['Trabajo 2',4,30]],'',{header_row:1,description:0,quantity:1,unit_price:2}),/encabezado/);
});
test('Localized money formats, missing formulas and bounded sheets never silently create prices',()=>{
 for(const [value,currency,expected] of [['Gs. 1.500.000','PYG',1500000],['USD 1,250.50','USD',1250.5],['1.250,50','USD',1250.5],['0.335','USD',.335]])assert.equal(Q.number(value,currency),expected);
 assert.equal(Q.number('=SUM(A1:A2)'),null);assert.equal(Q.number('#VALUE!'),null);assert.throws(()=>Q.parse(Array.from({length:1201},()=>[])),/1.200/);assert.throws(()=>Q.parse([[{formula:'bad'}]]),/datos/);
 const rows=[['Descripción','Precio'],...Array.from({length:301},(_,i)=>['Trabajo '+i,10])];assert.throws(()=>Q.parse(rows),/300 trabajos/);
});
test('The issuer is independent of the recipient; ambiguous names remain pending instead of becoming AVH',()=>{
 const rows=[['Empresa emisora: Talleres del Puerto S.A.'],['RUC','80123456-7'],['Dirección','Ruta 9'],['Correo','cotizaciones@example.test'],['Cliente','Astillero Villa Hayes S.A.'],['Razón social','Astillero Villa Hayes S.A.'],['RUC','80091371-0'],['Dirección','Villa Hayes'],['Descripción','Precio'],['Reparación',500]];
 const a=Q.parse(rows);assert.equal(a.company.brand_avh,false);assert.equal(a.company.legal_name,'Talleres del Puerto S.A.');assert.equal(a.company.tax_id,'80123456-7');assert.equal(a.company.address,'Ruta 9');assert.equal(a.company.email,'cotizaciones@example.test');assert.equal(a.fields.recipient_name,'Astillero Villa Hayes S.A.');
 const b=Q.parse([['Servicios Técnicos S.R.L.'],['RUC: 123456-7'],['Cliente','Cliente naval'],['Descripción','Precio'],['Reparación',10]]);assert.equal(b.company.legal_name,'Servicios Técnicos S.R.L.');assert.equal(b.company.tax_id,'123456-7');
 const c=Q.parse([['Un nombre sin identificar'],['Descripción','Precio'],['Trabajo',20]]);assert.equal(c.company.legal_name,'');assert.equal(c.company.brand_avh,false);
});
