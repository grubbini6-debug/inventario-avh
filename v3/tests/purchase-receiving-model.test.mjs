import '../edge-functions/_shared/product-identity.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import '../edge-functions/_shared/purchase-receiving-model.js';
const M=globalThis.AVHReceiving;
const wire={id:'wst',sku:'CHT711120P',name:'TUBULAR WST E71T1C 1,2MM 15KG PREMIUM',base_unit:'unidad',active:true};
const presentations=[{product_id:'wst',unit:'rollo',label:'Rollo 15 kg',factor_to_base:1}];
const invoice={currency:'USD',subtotal:1836,tax:166.91,total:1836,tax_mode:'included',items:[{quantity:72,unit:'UN',base_unit:'kg',factor_to_base:15,unit_price:25.5,line_total:1836,confidence:.96}]};

test('72 rolls stay 72 stock units while the physical package weighs 1080 kg',()=>{
  assert.deepEqual(M.quantity(invoice.items[0],wire,presentations),{quantity:72,unit:'unidad',factor:1,kg:1080,package_kg:15});
  assert.equal(M.stockProblem({...invoice.items[0],factor_to_base:15},wire)?.includes('conversión debe ser 1'),true);
  assert.equal(M.stockProblem({...invoice.items[0],factor_to_base:1},wire),null);
  assert.equal(M.factor({unit:'kg',base_unit:'kg',factor_to_base:15},{base_unit:'unidad'}),null);
});
test('a kg-based product still receives the real roll-to-kg conversion',()=>{
  const product={id:'kg',base_unit:'kg'},pres=[{product_id:'kg',unit:'rollo',label:'Rollo 15 kg',factor_to_base:15}];
  assert.equal(M.factor({unit:'rollo',base_unit:'kg',factor_to_base:15},product,pres),15);
  assert.equal(M.quantity({quantity:72,unit:'rollo',base_unit:'kg',factor_to_base:15},product,pres).quantity,1080);
  assert.equal(M.factor({unit:'kg',factor_to_base:15},product,pres),1);
});
test('invoice comparison reconciles kg billing against roll quantities and prices',()=>{
  const po={quantity:72,unit:'unidad',factor_to_base:1,unit_price:25.5};
  const compared=M.comparable(po,{quantity:1080,unit:'kg',base_unit:'kg',factor_to_base:1,unit_price:1.7},wire,presentations);
  assert.equal(compared.poQty,72);assert.equal(compared.extQty,72);
  assert.equal(compared.poPrice,25.5);assert.equal(compared.extPrice,25.5);
  assert.equal(M.comparable({...po,factor_to_base:15},invoice.items[0],wire,presentations),null);
});
test('reuse requires the same wire brand, classification, diameter and package size',()=>{
  const other=[{...wire,id:'18',sku:'18',name:'TUBULAR WST E71T1C 1,2MM 18KG PREMIUM'},{...wire,id:'thor',sku:'t',name:'TUBULAR THOR E71T1C 1,2MM 15KG'},{...wire,id:'diameter',sku:'d',name:'TUBULAR WST E71T1C 1,6MM 15KG'}];
  assert.deepEqual(M.matches({description:'Alambre tubular WST E71T-1C 1.2 mm 15 kg'},[wire,...other],presentations).map(x=>x.id),['wst']);
  assert.deepEqual(M.matches({product_code:'CHT711120P'},[wire,...other],presentations).map(x=>x.id),['wst']);
  assert.equal(M.matches({description:'Alambre tubular WST E71T-1C 1.2 mm'},[wire,...other],presentations).length,2);
  assert.equal(M.matches({product_code:'CHT711120P'},[{...wire,active:false}],presentations).length,0);
});
test('included IVA is not added to the invoice total a second time',()=>{
  const f=M.financial(invoice);assert.equal(f.total,1836);assert.equal(f.net,1669.09);assert.equal(f.tax,166.91);assert.deepEqual(f.issues,[]);
  const legacy=M.financial({...invoice,tax_mode:undefined});assert.equal(legacy.net,null);assert.ok(legacy.issues.some(x=>x.level==='pending'&&/incluido/.test(x.text)));
  const added=M.financial({...invoice,tax_mode:'excluded'});assert.ok(added.issues.some(x=>x.level==='review'&&/subtotal más IVA/.test(x.text)));
});
test('unknown financial values stay missing and arithmetic differences cannot pass as OK',()=>{
  assert.equal(M.number(null),null);assert.equal(M.number(''),null);
  assert.ok(M.financial({...invoice,items:[{...invoice.items[0],quantity:null}]}).issues.some(x=>x.level==='pending'));
  assert.ok(M.financial({...invoice,items:[{...invoice.items[0],line_total:1835}]}).issues.some(x=>x.level==='review'));
  assert.ok(M.financial({...invoice,tax:2000}).issues.some(x=>x.level==='review'));
});
