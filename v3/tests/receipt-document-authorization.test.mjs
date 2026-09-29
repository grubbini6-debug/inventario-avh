import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql=fs.readFileSync(
  new URL('../migrations/20260929131500_receipt_document_null_role_guard.sql',import.meta.url),
  'utf8'
);

test('receipt document RPC rejects NULL or unauthorized roles',()=>{
  assert.match(sql,/coalesce\(v_role in \('admin','depositor'\),false\) is not true/i);
  assert.doesNotMatch(sql,/if\s+v_role\s+not\s+in\s*\(/i);
  assert.match(sql,/SECURITY DEFINER/i);
  assert.match(sql,/SET search_path TO 'public'/i);
});
