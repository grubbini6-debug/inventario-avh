import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const mobile=fs.readFileSync(new URL('../src/features/inventory/depositor-mobile-ai.js',import.meta.url),'utf8');
const complete=fs.readFileSync(new URL('../src/features/inventory/depositor-complete-mobile.js',import.meta.url),'utf8');

test('depositor mobile home exposes the four primary warehouse actions',()=>{
  assert.match(mobile,/id="depPhotoReceipt"/);
  assert.match(mobile,/id="depManualExit"/);
  assert.match(mobile,/id="depQuickTransfer"/);
  assert.match(mobile,/id="depQuickReturn"/);
  assert.match(mobile,/openMovement\('transfer'\)/);
  assert.match(mobile,/openMovement\('return'\)/);
});

test('opening inventory is prominent and uses a price-free mobile counting flow',()=>{
  assert.match(mobile,/id="depInitialPriority"/);
  assert.match(mobile,/function openInitialMobile/);
  assert.match(mobile,/record_initial_inventory/);
  assert.match(mobile,/Guardar y cargar otro/);
  assert.match(mobile,/No cargues precios/);
  const block=mobile.slice(mobile.indexOf('function openInitialMobile'),mobile.indexOf('function renderDepositorHome'));
  assert.doesNotMatch(block,/unit_cost[^:]*:\s*Number/);
  assert.doesNotMatch(block,/data-f="cost"/);
});

test('secondary depositor enhancer no longer duplicates transfer return or opening inventory buttons',()=>{
  const decorate=complete.slice(complete.indexOf('function decorate'),complete.indexOf('let scheduled'));
  assert.match(decorate,/Entrada manual/);
  assert.match(decorate,/Solicitar material/);
  assert.doesNotMatch(decorate,/id="depTransfer"/);
  assert.doesNotMatch(decorate,/id="depReturn"/);
  assert.doesNotMatch(decorate,/initialButtonHtml\(\)/);
});
