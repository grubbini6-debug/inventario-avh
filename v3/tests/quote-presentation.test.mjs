import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteDescription,quoteUnit} from '../edge-functions/_shared/quote-presentation.mjs';

test('Imported work specifications become Spanish detail lines with every technical value retained',()=>{
 const source='Cambio de chapa de popa. - Length 4300 mm; Width 3000 mm; M2 12,90; Thk 12,70 mm; Quantity 1; Total Weight 1286 Kg; Unit. Price 4,20 USD; total visible in table. - Cantidad física: 1 unit';
 assert.equal(quoteDescription(source),'Cambio de chapa de popa.\nLargo: 4300 mm · Ancho: 3000 mm · Superficie: 12,90 m² · Espesor: 12,70 mm · Peso: 1286 kg · Cantidad física: 1 unidad');
 for(const value of ['4300','3000','12,90','12,70','1286'])assert.ok(quoteDescription(source).includes(value));
});
test('Source price commentary is removed only from recognized import metadata; original free text is preserved',()=>{
 const note='Precio unitario sujeto a revisión. Largo 4.000 mm. Alcance sin pintura.';assert.equal(quoteDescription(note),note);
 const input='Arenado a Sa 2.5 - Tarea/Actividad; m2 1800; Unit. Price 2,50 USD; total visible in table. - Cantidad física: 1800 m2';assert.equal(quoteDescription(input),'Arenado a Sa 2.5\nSuperficie: 1800 m² · Cantidad física: 1800 m²');
 assert.match(quoteDescription('Trabajo - Length 2 mm; Quantity 2 - Cantidad física: 1 unit'),/Cantidad indicada: 2 · Cantidad física: 1 unidad/);
 for(const [input,expected] of [['Kg','kg'],['m2','m²'],['m3','m³'],['unit','unidad'],['servicio','servicio']])assert.equal(quoteUnit(input),expected);
});
