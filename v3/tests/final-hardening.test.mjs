import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration=fs.readFileSync(new URL('../migrations/20260929133000_safe_purchase_receipt_reversal.sql',import.meta.url),'utf8');
const purchase=fs.readFileSync(new URL('../src/features/purchases/base.js',import.meta.url),'utf8');
const views=fs.readFileSync(new URL('../src/features/inventory/views.js',import.meta.url),'utf8');
const nav=fs.readFileSync(new URL('../src/ui/navigation.js',import.meta.url),'utf8');

test('purchase receipt reversal is admin-only, audited and refuses consumed stock',()=>{
  assert.match(migration,/current_profile_role\(\) IS DISTINCT FROM 'admin'/i);
  assert.match(migration,/quantity_remaining <> b\.quantity_received/i);
  assert.match(migration,/batch_allocations/i);
  assert.match(migration,/purchase_receipt_voided/i);
  assert.match(migration,/received_qty = pi\.received_qty - pri\.quantity/i);
  assert.match(migration,/voided_at IS NULL/i);
  assert.match(migration,/GRANT EXECUTE ON FUNCTION public\.admin_void_purchase_receipt/i);
  assert.match(migration,/REVOKE ALL ON FUNCTION public\.admin_void_purchase_receipt\(uuid,text\) FROM PUBLIC, anon/i);
});

test('purchase UI exposes reversal only for active receipts',()=>{
  assert.match(purchase,/data-void-receipt/);
  assert.match(purchase,/admin_void_purchase_receipt/);
  assert.match(purchase,/r\.voided_at\?'[^']*ANULADA|ANULADA/);
});

test('movement history stays recent on startup and loads complete data on demand',()=>{
  assert.match(views,/queryAll\('movements'/);
  assert.match(views,/function movementDataset\(\)/);
  assert.match(views,/page-moves/);
  assert.match(views,/D\.moveHistoryLoaded/);
  assert.match(nav,/page==='moves'.*renderMoves/);
});
