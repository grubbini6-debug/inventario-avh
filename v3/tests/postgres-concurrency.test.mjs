import test from 'node:test';
import assert from 'node:assert/strict';
import {Client} from 'pg';
import {operationalDb,seed,asUser,id} from './helpers/operational-db.mjs';
const url=process.env.AVH_TEST_DATABASE_URL;
// Never use a production database: dedicated disposable CI service only.
if(url){const u=new URL(url);if(!['127.0.0.1','localhost'].includes(u.hostname)||u.pathname!=='/avh_test')throw new Error('Only local disposable avh_test database is allowed')}
async function connection(){const c=new Client({connectionString:url});await c.connect();c.exec=c.query.bind(c);c.close=c.end.bind(c);await c.query("SET statement_timeout='8s'");return c}
async function blocked(observer,pid){
  const deadline=Date.now()+4000;
  while(Date.now()<deadline){
    const {rows}=await observer.query('SELECT cardinality(pg_blocking_pids($1)) n',[pid]);
    if(rows[0].n>0)return;
    await new Promise(r=>setTimeout(r,25));
  }
  throw new Error('Expected operation did not wait on the competing transaction');
}
const settle=p=>p.then(value=>({value}),error=>({error}));
test('PostgreSQL 17: independent connections serialize item editing/receipt and count/closure', {skip:!url,timeout:30000},async t=>{
  const db=await connection();t.after(()=>db.close());await operationalDb(db);await seed(db);
  const editor=await connection(),receiver=await connection();
  t.after(async()=>{await Promise.all([editor.query('ROLLBACK'),receiver.query('ROLLBACK')]);await Promise.all([editor.close(),receiver.close()])});
  await asUser(editor,id(1));await asUser(receiver,id(2));
  // Force the old deadlock interleaving: editor holds item, receiver starts, then editor needs purchase.
  await editor.query('BEGIN');
  await editor.query('SELECT id FROM purchase_items WHERE id=$1 FOR UPDATE',[id(60)]);
  const receiving=settle(receiver.query('SELECT receive_purchase($1,$2::jsonb)',[id(50),JSON.stringify([{purchase_item_id:id(60),quantity:4,request_id:id(100)}])]));
  await blocked(db,receiver.processID);
  await editor.query('SELECT admin_update_purchase_item($1,$2::jsonb)',[id(60),JSON.stringify({quantity:12})]);
  await editor.query('COMMIT');
  const receipt=await receiving;if(receipt.error)throw receipt.error;
  const {rows}=await db.query('SELECT quantity,received_qty FROM purchase_items WHERE id=$1',[id(60)]);
  assert.equal(Number(rows[0].quantity),12);assert.equal(Number(rows[0].received_qty),4);

  await editor.query('SELECT admin_open_initial_inventory($1)',[id(10)]);
  const countArgs=[id(10),JSON.stringify([{product_id:id(20),quantity:2,unit:'kg'}])];
  await receiver.query('SELECT record_initial_inventory($1,$2::jsonb)',countArgs);
  const {rows:lines}=await db.query("SELECT ml.id FROM movement_lines ml JOIN movements m ON m.id=ml.movement_id WHERE m.type='initial'");
  await editor.query("SELECT admin_price_initial_inventory($1,2,'USD',7500)",[lines[0].id]);
  await editor.query('BEGIN');
  await editor.query('SELECT admin_close_initial_inventory($1)',[id(10)]);
  const counting=settle(receiver.query('SELECT record_initial_inventory($1,$2::jsonb)',countArgs));
  await blocked(db,receiver.processID);
  await editor.query('COMMIT');
  const count=await counting;assert.match(count.error?.message||'',/no está abierto/);
  assert.equal(Number((await db.query("SELECT count(*) FROM movements WHERE type='initial'")).rows[0].count),1);
});
