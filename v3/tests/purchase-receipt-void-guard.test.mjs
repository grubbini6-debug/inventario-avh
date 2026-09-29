import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const migration=fs.readFileSync(
  new URL('../migrations/20260929130000_purchase_receipt_void_guard.sql',import.meta.url),
  'utf8'
);

test('purchase receipt movement cannot be cancelled generically',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`
      create table public.movements(
        id uuid primary key,
        status text not null
      );
      create table public.purchase_receipts(
        id uuid primary key,
        movement_id uuid references public.movements(id)
      );
    `);
    await db.exec(migration);

    await db.exec(`
      insert into public.movements(id,status) values
        ('00000000-0000-0000-0000-000000000001','confirmed'),
        ('00000000-0000-0000-0000-000000000002','confirmed');
      insert into public.purchase_receipts(id,movement_id)
      values('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001');
    `);

    await assert.rejects(
      db.exec("update public.movements set status='cancelled' where id='00000000-0000-0000-0000-000000000001'"),
      /recepción de compra/
    );

    const linked=await db.query("select status from public.movements where id='00000000-0000-0000-0000-000000000001'");
    assert.equal(linked.rows[0].status,'confirmed');

    await db.exec("update public.movements set status='cancelled' where id='00000000-0000-0000-0000-000000000002'");
    const ordinary=await db.query("select status from public.movements where id='00000000-0000-0000-0000-000000000002'");
    assert.equal(ordinary.rows[0].status,'cancelled');
  }finally{
    await db.close();
  }
});
