import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {setupHullBase,setupHullGases,applyHull} from './helpers/hull-fixture.mjs';
test('Barge costing: destination per line, real FIFO, permissions and reversals',async t=>{
 const db=new PGlite(),id={admin:randomUUID(),dep:randomUUID(),other:randomUUID(),inactive:randomUUID(),w:randomUUID(),w2:randomUUID(),barge:randomUUID(),inactiveBarge:randomUUID(),wire:randomUUID(),plate:randomUUID()};
 const q=(sql,args=[])=>db.query(sql,args),owner=()=>db.exec('reset role');
 const login=async(user,role='authenticated')=>{await owner();await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user,role})]);await db.exec('set role '+role);};
 const entry=async(product,quantity,price,currency)=>q('select public.record_entry($1,null,null,$2::jsonb,null)',[id.w,JSON.stringify([{product_id:product,quantity,unit:product===id.plate?'kg':'unidad',factor_to_base:1,unit_cost:price??'',currency:currency??'',request_id:randomUUID()}])]);
 const exit=async(items,request=randomUUID(),barge=id.barge,warehouse=id.w)=>(await q('select public.record_exit($1,$2,null,$3,$4,$5::jsonb,null) id',[warehouse,barge,'Persona de prueba','Trabajo de prueba',JSON.stringify(items.map((item,i)=>({product_id:id.wire,unit:'unidad',factor_to_base:1,...item,...(i===0?{request_id:request}:{})})))])).rows[0].id;
 const stock=async(product=id.wire)=>Number((await q('select coalesce(sum(quantity_remaining),0)::float n from public.inventory_batches where warehouse_id=$1 and product_id=$2',[id.w,product])).rows[0].n);
 const report=async()=>(await q('select * from public.v_barge_module_consumption where barge_id=$1 order by naval_section,naval_module,currency',[id.barge])).rows;
 let legacy,split,request=randomUUID();
 try{
  await setupHullBase(db);
  await q('insert into auth.users(id) select unnest($1::uuid[])',[[id.admin,id.dep,id.other,id.inactive]]);
  await q("insert into warehouses(id,code,name) values($1,'ACOMAR','Depósito de prueba'),($2,'OTHER','Otro depósito')",[id.w,id.w2]);
  await q("insert into profiles(id,username,role,warehouse_id,active) values($1,'admin','admin',null,true),($2,'depositor','depositor',$5,true),($3,'other','depositor',$6,true),($4,'inactive','depositor',$5,false)",[id.admin,id.dep,id.other,id.inactive,id.w,id.w2]);
  await q("insert into barges(id,number,active) values($1,7,true),($2,8,false)",[id.barge,id.inactiveBarge]);
  await q("insert into products(id,name,base_unit) values($1,'Material unitario de prueba','unidad'),($2,'Material por peso de prueba','kg')",[id.wire,id.plate]);
  await setupHullGases(db);
  await login(id.admin);await entry(id.wire,5,10,'PYG');await entry(id.wire,7,20,'PYG');await entry(id.wire,4,2,'USD');await entry(id.wire,3,null,null);await entry(id.plate,100,3,'PYG');
  legacy=await exit([{quantity:1}]);
  const before=(await q('select id,quantity_remaining from public.inventory_batches order by id')).rows;
  await owner();await applyHull(db);await login(id.admin);
  await t.test('installation preserves stock and leaves historical destinations unclassified',async()=>{
   assert.deepEqual((await q('select id,quantity_remaining from public.inventory_batches order by id')).rows,before);
   const line=(await q('select naval_section,naval_module from public.movement_lines where movement_id=$1',[legacy])).rows[0];assert.equal(line.naval_section,null);assert.equal(line.naval_module,null);
   assert.equal(Number((await report()).find(r=>r.naval_section===null).base_quantity),1);
  });
  await t.test('one delivery splits the same product between modules without repeating FIFO quantities',async()=>{
   await login(id.dep);split=await exit([{quantity:6,naval_section:'fondo',naval_module:' f12 '},{quantity:3,naval_section:'costado',naval_module:'co3'}],request);
   assert.equal(await stock(),9);
   const lines=(await q('select naval_section,naval_module from public.movement_lines where movement_id=$1 order by naval_section',[split])).rows;assert.deepEqual(lines,[{naval_section:'costado',naval_module:'CO3'},{naval_section:'fondo',naval_module:'F12'}]);
   await login(id.admin);const rows=await report(),f=rows.find(r=>r.naval_module==='F12'),c=rows.find(r=>r.naval_module==='CO3');
   assert.equal(Number(f.base_quantity),6);assert.equal(Number(f.real_cost),80);assert.equal(Number(c.base_quantity),3);assert.equal(Number(c.real_cost),60);
   assert.equal(Number((await q('select count(*) n from public.batch_allocations ba join public.movement_lines l on l.id=ba.movement_line_id where l.movement_id=$1',[split])).rows[0].n),3,'one module consumed two lots but its quantity remains six');
  });
  await t.test('a lost-response retry returns the original delivery without another stock discount',async()=>{
   await login(id.dep);const again=await exit([{quantity:6,naval_section:'fondo',naval_module:'F12'},{quantity:3,naval_section:'costado',naval_module:'CO3'}],request);
   assert.equal(again,split);assert.equal(await stock(),9);
  });
  await t.test('invalid parts and modules roll back the entire operation and respect warehouse access',async()=>{
   const invalid=[
    {naval_section:'casco'},{naval_module:'F12'},{naval_section:'general',naval_module:'F12'},
    {naval_section:'fondo',naval_module:'X'.repeat(41)},{naval_section:'fondo',naval_module:'F\n12'}
   ];
   for(const fields of invalid)await assert.rejects(exit([{quantity:1,naval_section:'fondo',naval_module:'F1'},{quantity:1,...fields}]),/Parte|módulo|código/i);
   await assert.rejects(exit([{quantity:1,naval_section:'fondo'}],randomUUID(),null),/barcaza activa/i);
   await assert.rejects(exit([{quantity:1,naval_section:'fondo'}],randomUUID(),id.inactiveBarge),/barcaza activa/i);
   await assert.rejects(exit([{quantity:1,naval_section:'fondo'}],randomUUID(),id.barge,id.w2),/No autorizado/i);
   assert.equal(await stock(),9);
   await assert.rejects(q("update public.movement_lines set naval_module='F99' where movement_id=$1",[split]),/permission denied|policy/i);
  });
  await t.test('mixed currencies and unpriced lots stay separate and reconcile to the original cost ledger',async()=>{
   await exit([{quantity:3,naval_section:'popa',naval_module:'P01'},{quantity:6,naval_section:'proa',naval_module:'P02'}]);
   await exit([{product_id:id.plate,quantity:5,unit:'kg',naval_section:'fondo',naval_module:'F12'}]);
   assert.equal(await stock(),0);assert.equal(await stock(id.plate),95);
   await login(id.admin);const rows=await report(),unknown=rows.find(r=>r.naval_section==='proa'&&r.currency===null);
   assert.equal(Number(unknown.base_quantity),3);assert.equal(Number(unknown.unpriced_quantity),3);assert.equal(Number(unknown.priced_quantity),0);
   assert.equal(rows.filter(r=>r.naval_section==='popa').length,2);
   const expected=(await q("select l.product_id,ba.currency,sum(ba.quantity)::float qty,sum(ba.quantity*coalesce(ba.unit_cost,0))::float cost from public.movements m join public.movement_lines l on l.movement_id=m.id join public.batch_allocations ba on ba.movement_line_id=l.id where m.barge_id=$1 and m.type='exit' and m.status='confirmed' group by l.product_id,ba.currency",[id.barge])).rows;
   for(const e of expected){const group=rows.filter(r=>r.product_id===e.product_id&&r.currency===e.currency);assert.equal(group.reduce((s,r)=>s+Number(r.base_quantity),0),e.qty);assert.equal(group.reduce((s,r)=>s+Number(r.real_cost),0),e.cost);}
  });
  await t.test('gas delivery carries the same part and module into its actual FIFO stock movement',async()=>{
   const gas=(await q("select product_id from public.gas_products where gas_kind='co2' order by kg_per_cylinder nulls first limit 1")).rows[0].product_id;
   await owner();await q('update public.gas_controls set counted_at=now(),counted_by=$1 where warehouse_id=$2',[id.admin,id.w]);await login(id.admin);
   const command=async(action,data)=>(await q('select public.gas_command($1,$2::jsonb,$3::uuid) result',[action,JSON.stringify({warehouse_id:id.w,product_id:gas,...data}),randomUUID()])).rows[0].result;
   await command('new_full',{quantity:2,person:'Proveedor de prueba',unit_cost:12,currency:'USD'});
   await login(id.dep);await command('exit',{quantity:1,empty_quantity:0,person:'Persona de prueba',destination:'Trabajo de prueba',barge_id:id.barge,naval_section:'popa',naval_module:' pp1 '});
   const line=(await q("select l.naval_section,l.naval_module from public.movement_lines l join public.movements m on m.id=l.movement_id where l.product_id=$1 and m.type='exit' order by m.created_at desc limit 1",[gas])).rows[0];assert.equal(line.naval_section,'popa');assert.equal(line.naval_module,'PP1');
   await login(id.admin);const r=(await report()).find(r=>r.product_id===gas);assert.equal(Number(r.real_cost),12);assert.equal(r.currency,'USD');
  });
  await t.test('cost view is admin-only while depositors retain their own classified movement lines',async()=>{
   for(const user of [id.dep,id.other,id.inactive]){await login(user);assert.equal((await report()).length,0);}
   await login(id.dep);assert.equal((await q('select naval_module from public.movement_lines where movement_id=$1',[split])).rows.length,2);
   await login(id.other);assert.equal((await q('select naval_module from public.movement_lines where movement_id=$1',[split])).rows.length,0);
   await login(id.inactive);await assert.rejects(exit([{quantity:1,product_id:id.plate,unit:'kg',naval_section:'fondo'}]),/No autorizado/i);
   await login(id.dep,'anon');await assert.rejects(report(),/permission denied/i);
  });
  await t.test('annulling an exit restores the original lots and removes its module costs',async()=>{
   await login(id.admin);await q('select public.admin_void_movement($1,$2)',[split,'Corrección de salida de prueba']);
   assert.equal(await stock(),9);
   const rows=(await report()).filter(r=>r.product_id===id.wire);
   assert.equal(rows.some(r=>r.naval_section==='costado'),false);assert.equal(rows.some(r=>r.naval_section==='fondo'),false);
   assert.equal(rows.reduce((s,r)=>s+Number(r.base_quantity),0),10);
   assert.equal((await q('select status from public.movements where id=$1',[split])).rows[0].status,'cancelled');
   assert.equal((await q('select naval_module from public.movement_lines where movement_id=$1 and naval_section=$2',[split,'fondo'])).rows[0].naval_module,'F12','the original destination remains in the canceled movement history');
  });
 }finally{await db.close();}
});
