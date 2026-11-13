import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {setupRecount} from './helpers/recount-fixture.mjs';

test('Physical recount: exact current balance, original history, FIFO costs and depositor authorization',async t=>{
  const db=new PGlite(),id=Object.fromEntries(['admin','dep','peer','other','inactive','viewer','w','w2','product','empty'].map(k=>[k,randomUUID()]));
  const q=(sql,args=[])=>db.query(sql,args);
  const as=(actor,sql,args=[])=>db.transaction(async tx=>{await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:actor,role:'authenticated'})]);await tx.exec('set local role authenticated');return tx.query(sql,args)});
  const context=async(p=id.product,w=id.w,actor=id.dep)=>(await as(actor,'select inventory_recount_context($1,$2) r',[w,p])).rows[0].r;
  const args=(c,qty,changes={})=>({p_warehouse_id:c.warehouse_id,p_product_id:c.product_id,p_counted_qty:qty,p_expected_version:c.version,p_reason:'Corrección de carga inicial según conteo físico',p_request_id:randomUUID(),...changes});
  const save=async(a,actor=id.dep)=>(await as(actor,'select record_inventory_recount($1,$2,$3,$4,$5,$6) r',Object.values(a))).rows[0].r;
  const stock=async(p=id.product)=>(await q('select coalesce(sum(quantity_remaining),0)::float n from inventory_batches where warehouse_id=$1 and product_id=$2',[id.w,p])).rows[0].n;
  const snapshot=async()=>(await q("select jsonb_build_object('movements',(select count(*) from movements),'lines',(select count(*) from movement_lines),'batches',(select count(*) from inventory_batches),'audit',(select count(*) from audit_events),'notifications',(select count(*) from notifications)) r")).rows[0].r;
  const entry=async(qty,cost=null,currency=null)=>(await as(id.admin,'select record_entry($1,null,null,$2::jsonb,$3) r',[id.w,JSON.stringify([{product_id:id.product,quantity:qty,unit:'kg',factor_to_base:1,unit_cost:cost,currency,request_id:randomUUID()}]),'Carga original'])).rows[0].r;
  try{
    await setupRecount(db);
    await db.exec("alter table profiles drop constraint profiles_role_check; alter table profiles add constraint profiles_role_check check(role in ('admin','depositor','admin_viewer'));");
    await q('insert into auth.users(id) select unnest($1::uuid[])',[[id.admin,id.dep,id.peer,id.other,id.inactive,id.viewer]]);
    await q("insert into warehouses(id,code,name) values($1,'VH','Villa Hayes'),($2,'AC','ACOMAR')",[id.w,id.w2]);
    await q("insert into profiles(id,username,role,warehouse_id,active) values($1,'compras','admin',null,true),($2,'deposito','depositor',$7,true),($3,'companero','depositor',$7,true),($4,'otro','depositor',$8,true),($5,'inactivo','depositor',$7,false),($6,'lectura','admin_viewer',null,true)",[id.admin,id.dep,id.peer,id.other,id.inactive,id.viewer,id.w,id.w2]);
    await q("insert into products(id,name,base_unit) values($1,'Alambre de prueba','kg'),($2,'Material sin saldo','unidad')",[id.product,id.empty]);
    const original=await entry(10,2,'USD');await entry(20,100,'PYG');
    await q("update inventory_batches set received_at=received_at-interval '1 day' where source_line_id in(select id from movement_lines where movement_id=$1)",[original]);
    await as(id.dep,'select record_exit($1,null,null,null,null,$2::jsonb,null)',[id.w,JSON.stringify([{product_id:id.product,quantity:3,unit:'kg',factor_to_base:1}])]);
    const historical=(await q('select to_jsonb(m) m,(select jsonb_agg(to_jsonb(l)) from movement_lines l where l.movement_id=m.id) lines from movements m where m.id=$1',[original])).rows[0];
    await t.test('context scopes the assigned depot, excludes costs, and forbids admins, viewers, inactive and anonymous',async()=>{
      const c=await context();assert.equal(Number(c.stock_qty),27);assert.doesNotMatch(JSON.stringify(c),/unit_cost|currency|batches/);
      assert.equal(Number((await context(id.product,id.w,id.peer)).stock_qty),27,'same-depot peer may correct the physical stock regardless of original author');
      for(const actor of [id.admin,id.other,id.inactive,id.viewer,null])await assert.rejects(context(id.product,id.w,actor),/depositario activo/);
      await assert.rejects(context(id.product,id.w2),/depositario activo/);
      await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon');return tx.query('select inventory_recount_context($1,$2)',[id.w,id.product])}),/permission denied/);
      await assert.rejects(as(id.dep,'select avh_inventory_private.recount_snapshot($1,$2)',[id.w,id.product]),/permission denied/);
      await assert.rejects(as(id.dep,'update inventory_batches set quantity_remaining=0'),/permission denied/);
    });
    let successful;
    await t.test('a used load can be recounted down; only the difference consumes FIFO and retains original prices',async()=>{
      const c=await context(),request=args(c,18);successful={request,result:await save(request)};
      assert.equal(await stock(),18);assert.equal(successful.result.difference,-9);
      const m=(await q('select * from movements where id=$1',[successful.result.movement_id])).rows[0];assert.equal(m.type,'adjustment');assert.equal(m.created_by,id.dep);assert.equal(m.warehouse_from_id,id.w);assert.equal(m.barge_id,null);
      const allocations=(await q('select quantity::float q,unit_cost::float cost,currency from batch_allocations where movement_line_id in(select id from movement_lines where movement_id=$1) order by unit_cost',[m.id])).rows;
      assert.deepEqual(allocations,[{q:7,cost:2,currency:'USD'},{q:2,cost:100,currency:'PYG'}]);
      assert.deepEqual((await q('select to_jsonb(m) m,(select jsonb_agg(to_jsonb(l)) from movement_lines l where l.movement_id=m.id) lines from movements m where m.id=$1',[original])).rows[0],historical);
      const audit=(await q("select * from audit_events where action='inventory_recounted' and movement_id=$1",[m.id])).rows[0];
      assert.equal(audit.detail.stock_before,27);assert.equal(audit.detail.stock_after,18);assert.equal(audit.actor_id,id.dep);assert.match(audit.detail.reason,/conteo físico/);
      assert.equal((await q("select count(*)::int n from notifications where kind='inventory_recount' and user_id=$1",[id.admin])).rows[0].n,1);
    });
    await t.test('an exact transport retry does not apply another adjustment or notification; changed requests and old versions fail',async()=>{
      const before=await snapshot();assert.deepEqual(await save(successful.request),successful.result);assert.deepEqual(await snapshot(),before);
      await assert.rejects(save({...successful.request,p_counted_qty:10}),/identificador ya se usó/);
      await assert.rejects(save({...successful.request,p_request_id:randomUUID()}),/stock cambió/);assert.deepEqual(await snapshot(),before);
    });
    await t.test('a surplus adds only the missing amount with unknown valuation; zero clears remaining balances without deleting batches',async()=>{
      const r=await save(args(await context(),30));assert.equal(r.difference,12);assert.equal(await stock(),30);
      const batch=(await q('select b.* from inventory_batches b join movement_lines l on l.id=b.source_line_id where l.movement_id=$1',[r.movement_id])).rows[0];
      assert.equal(Number(batch.quantity_received),12);assert.equal(batch.unit_cost,null);assert.equal(batch.currency,null);
      const before=await snapshot(),zero=await save(args(await context(),0));assert.equal(zero.stock_after,0);assert.equal(await stock(),0);
      assert.equal((await snapshot()).batches,before.batches);assert.equal((await q('select status from movements where id=$1',[original])).rows[0].status,'confirmed');
      assert.equal((await q('select count(*)::int n from v_barge_consumption')).rows[0].n,0,'stock recounts are not barge consumption');
    });
    await t.test('zero-stock catalog materials can be counted; unchanged confirmations add audit but no duplicate stock',async()=>{
      const c=await context(id.empty);assert.equal(c.stock_qty,0);
      await save(args(c,3.5));assert.equal(await stock(id.empty),3.5);
      const before=await snapshot(),r=await save(args(await context(id.empty),3.5));assert.equal(r.movement_id,null);assert.equal(r.difference,0);
      const after=await snapshot();assert.equal(after.movements,before.movements);assert.equal(after.batches,before.batches);assert.equal(Number(after.audit),Number(before.audit)+1);
    });
    await t.test('stock or valuation changes during a count reject stale forms atomically',async()=>{
      const c=await context();await entry(4,1,'USD');const before=await snapshot();await assert.rejects(save(args(c,5)),/stock cambió/);assert.deepEqual(await snapshot(),before);assert.equal(await stock(),4);
      const fresh=await context();await q('update inventory_batches set unit_cost=2 where product_id=$1 and quantity_remaining>0',[id.product]);await assert.rejects(save(args(fresh,5)),/stock cambió/);
    });
    await t.test('invalid quantities, missing reasons or request IDs and switched/inactive depots never change data',async()=>{
      const c=await context(),before=await snapshot();
      for(const qty of [null,-1,'NaN','Infinity','-Infinity',0.0000001,1e12])await assert.rejects(save(args(c,qty)),/cantidad debe/);
      for(const changes of [{p_reason:''},{p_reason:'x'.repeat(1001)},{p_request_id:null},{p_expected_version:null}])await assert.rejects(save(args(c,2,changes)),/motivo|identificador|stock cambió/);
      await q('update profiles set warehouse_id=$1 where id=$2',[id.w2,id.dep]);await assert.rejects(save(args(c,2)),/depositario activo/);await q('update profiles set warehouse_id=$1 where id=$2',[id.w,id.dep]);
      await q('update products set active=false where id=$1',[id.product]);await assert.rejects(save(args(c,2)),/producto activo/);await q('update products set active=true where id=$1',[id.product]);
      await q('update warehouses set active=false where id=$1',[id.w]);await assert.rejects(save(args(c,2)),/inactivo/);await q('update warehouses set active=true where id=$1',[id.w]);assert.deepEqual(await snapshot(),before);
    });
    await t.test('gas cylinders use their existing full/empty count, never the generic recount RPC',async()=>{
      const gas=(await q("select product_id from gas_products where gas_kind='co2' limit 1")).rows[0].product_id;
      const c=await context(gas);assert.equal(c.gas_managed,true);const before=await snapshot();await assert.rejects(save(args(c,4)),/Gases → Nuevo conteo/);assert.deepEqual(await snapshot(),before);
    });
    await t.test('fabrication reservations block an invalid decrease and roll back the entire attempted recount',async()=>{
      await q('insert into fabrication_settings(warehouse_id,updated_by) values($1,$2)',[id.w,id.admin]);
      const component=(await q('select id from fabrication_components limit 1')).rows[0].id;
      const order=(await q("insert into fabrication_orders(warehouse_id,project,component_id,piece_code,drawing,drawing_revision,requested_qty,due_date,created_by) values($1,'DPW10',$2,'BU1','PLANO','R1',1,current_date,$3) returning id",[id.w,component,id.admin])).rows[0].id;
      await q('insert into fabrication_materials(order_id,product_id,required_qty,reserved_qty) values($1,$2,3,3)',[order,id.product]);
      const before=await snapshot();await assert.rejects(save(args(await context(),2)),/reservado para fabricación/);assert.deepEqual(await snapshot(),before);assert.equal(await stock(),4);
      await save(args(await context(),3));assert.equal(await stock(),3);
    });
  }finally{await db.close()}
});
