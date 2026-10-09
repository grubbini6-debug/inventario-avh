import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {setupInitialInventory} from './helpers/initial-inventory-fixture.mjs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
test('Initial inventory by name: original stock, atomic catalog creation and scoped authorization',async t=>{
  const db=new PGlite(),ids={admin:randomUUID(),isaac:randomUUID(),other:randomUUID(),same:randomUUID(),w:randomUUID(),w2:randomUUID(),raw:randomUUID()};
  const q=(sql,args=[])=>db.query(sql,args);
  const owner=()=>db.exec('reset role');
  const login=async(user,role='authenticated')=>{await owner();await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user,role})]);await db.exec('set role '+role);};
  const item=(name='Perfil U 80 mm',overrides={})=>({product_name:name,quantity:3.5,unit:'metro',factor_to_base:1,lot_reference:'L-1',request_id:randomUUID(),...overrides});
  const count=async(data,warehouse=ids.w,notes='Conteo físico')=>(await q('select public.record_initial_inventory_named($1,$2::jsonb,$3) id',[warehouse,JSON.stringify([data]),notes])).rows[0].id;
  const snapshot=async()=>{await owner();return (await q("select jsonb_build_object('products',(select count(*) from products),'movements',(select count(*) from movements),'batches',(select count(*) from inventory_batches),'audit',(select count(*) from audit_events)) s")).rows[0].s;};
  try{
    await db.exec(read('./fixtures/fabrication-inventory.sql'));
    await db.exec(read('../migrations/20261008232715_fabricacion_naval.sql'));
    await setupInitialInventory(db);
    await db.exec(read('../migrations/20261009123306_initial_inventory_named_material.sql'));
    await q('insert into auth.users(id) select unnest($1::uuid[])',[[ids.admin,ids.isaac,ids.other,ids.same]]);
    await q("insert into warehouses(id,code,name) values($1,'W','Taller existente'),($2,'W2','Otro depósito')",[ids.w,ids.w2]);
    await q("insert into profiles(id,username,role,warehouse_id) values($1,'compras','admin',null),($2,'isaac','depositor',$5),($3,'otro','depositor',$6),($4,'mismo','depositor',$5)",[ids.admin,ids.isaac,ids.other,ids.same,ids.w,ids.w2]);
    await q("insert into products(id,name,base_unit) values($1,'Acero A36 3 mm','kg')",[ids.raw]);
    await q("insert into warehouse_opening_inventory(warehouse_id,opened_by) values($1,$3),($2,$3)",[ids.w,ids.w2,ids.admin]);
    await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:ids.admin,role:'authenticated'})]);
    for(const [action,data] of [['configure',{warehouse_id:ids.w,enabled:true}],['access',{warehouse_id:ids.w,user_id:ids.isaac,access_level:'operator'}],['access',{warehouse_id:ids.w,user_id:ids.admin,access_level:'supervisor'}]])
      await q('select fabrication_command($1,$2::jsonb,$3)',[action,JSON.stringify(data),randomUUID()]);
    let request,movement,product;
    await t.test('one physical count creates one existing catalog product, movement and batch with unknown costs',async()=>{
      await login(ids.isaac);request=item('  Perfil   U 80 mm  ');movement=await count(request);
      await owner();product=(await q("select * from products where name='Perfil U 80 mm'")).rows[0];
      assert.equal(product.created_by,ids.isaac);assert.equal(product.base_unit,'metro');
      const rows=(await q('select b.*,m.opening_session_id,l.quantity,l.unit,l.factor_to_base from inventory_batches b join movement_lines l on l.id=b.source_line_id join movements m on m.id=l.movement_id where m.id=$1',[movement])).rows;
      assert.equal(rows.length,1);assert.equal(rows[0].warehouse_id,ids.w);assert.equal(rows[0].product_id,product.id);assert.equal(Number(rows[0].quantity_remaining),3.5);assert.equal(Number(rows[0].factor_to_base),1);assert.equal(rows[0].lot_reference,'L-1');assert.equal(rows[0].unit_cost,null);assert.equal(rows[0].currency,null);assert.ok(rows[0].opening_session_id);
      const audit=(await q("select * from audit_events where movement_id=$1 and action='opening_inventory_named_count_added'",[movement])).rows;
      assert.equal(audit.length,1);assert.equal(audit[0].detail.created_product,true);
    });
    await t.test('an exact retry returns the original movement; reusing its identifier for changed data is rejected',async()=>{
      const before=await snapshot();await login(ids.isaac);assert.equal(await count({...request,product_name:'perfil u 80 mm'}),movement);
      for(const [data,w,notes] of [[{...request,quantity:9},ids.w,'Conteo físico'],[{...request,unit:'kg'},ids.w,'Conteo físico'],[{...request,lot_reference:'L-2'},ids.w,'Conteo físico'],[request,ids.w,'Otro cierre']])
        await assert.rejects(count(data,w,notes),/identificador ya se usó/);
      assert.deepEqual(await snapshot(),before);
    });
    await t.test('another count of the same normalized name reuses the product and preserves technical dimensions',async()=>{
      await login(ids.isaac);await count(item(' PERFIL U   80 mm '));await count(item('Perfil U 800 mm'));
      await owner();assert.equal((await q("select count(*)::int n from products where lower(name)='perfil u 80 mm'")).rows[0].n,1);
      assert.equal((await q('select sum(quantity_remaining)::float n from inventory_batches where product_id=$1',[product.id])).rows[0].n,7);
      assert.equal((await q("select detail->>'created_product' created from audit_events where action='opening_inventory_named_count_added' order by created_at desc limit 1")).rows[0].created,'true');
    });
    await t.test('inactive, ambiguous or differently measured existing products cannot be recreated',async()=>{
      await owner();await q("insert into products(name,base_unit,active) values('Material inactivo','metro',false),('Duplicado','metro',true),('DUPLICADO','metro',true)");
      const before=await snapshot();await login(ids.isaac);
      await assert.rejects(count(item('material INACTIVO')),/inactivo/);
      await assert.rejects(count(item('duplicado')),/varias coincidencias/);
      await assert.rejects(count(item('Acero A36 3 mm')),/otra unidad/);
      assert.deepEqual(await snapshot(),before);
    });
    await t.test('invalid input leaves no orphan products, counts or audit records',async()=>{
      const before=await snapshot();await login(ids.isaac);
      for(const invalid of [{product_name:''},{product_name:'x'.repeat(301)},{quantity:0},{quantity:-1},{quantity:null},{quantity:'NaN'},{quantity:'Infinity'},{quantity:'-Infinity'},{unit:'kit'},{unit:null},{factor_to_base:2},{request_id:null}])await assert.rejects(count(item('Material inválido',invalid)));
      // Numeric overflow occurs inside the original stock RPC, after catalog insertion.
      await assert.rejects(count(item('Producto que debe revertirse',{quantity:'1e50'})),/overflow/);
      await assert.rejects(q('select record_initial_inventory_named($1,$2::jsonb,null)',[ids.w,JSON.stringify([item(),item()])]),/por vez/);
      assert.deepEqual(await snapshot(),before);
    });
    await t.test('only the assigned fabrication operator with an open initial session may use the new privilege',async()=>{
      const before=await snapshot();
      for(const user of [ids.same,ids.other,ids.admin]){await login(user);await assert.rejects(count(item('Sin permiso')),/operador autorizado|No autorizado/);}
      await login(ids.isaac);await assert.rejects(count(item('Depósito ajeno'),ids.w2),/No autorizado/);
      await owner();await q("update warehouse_opening_inventory set status='closed' where warehouse_id=$1",[ids.w]);await login(ids.isaac);await assert.rejects(count(item('Cerrado')),/no está abierto/);
      await owner();await q("update warehouse_opening_inventory set status='open' where warehouse_id=$1",[ids.w]);await q('update profiles set active=false where id=$1',[ids.isaac]);await login(ids.isaac);await assert.rejects(count(item('Inactivo')),/No autorizado|operador autorizado/);
      await owner();await q('update profiles set active=true where id=$1',[ids.isaac]);await q('update fabrication_settings set enabled=false where warehouse_id=$1',[ids.w]);await login(ids.isaac);await assert.rejects(count(item('Taller cerrado')),/operador autorizado/);
      await owner();await q('update fabrication_settings set enabled=true where warehouse_id=$1',[ids.w]);assert.deepEqual(await snapshot(),before);
    });
    await t.test('anonymous calls and direct catalog insertion stay forbidden; other depot stock stays empty',async()=>{
      await login(ids.isaac);await assert.rejects(q("insert into products(name,base_unit) values('Directo','metro')"),/row-level security/);
      assert.equal((await q('select * from warehouse_opening_inventory')).rows.length,1);
      await login(null,'anon');await assert.rejects(count(item('Anónimo')),/permission denied/);
      await owner();assert.equal((await q('select count(*)::int n from inventory_batches where warehouse_id=$1',[ids.w2])).rows[0].n,0);
      assert.equal((await q("select prosecdef from pg_proc where oid='public.record_initial_inventory_named(uuid,jsonb,text)'::regprocedure")).rows[0].prosecdef,false);
    });
    await t.test('a request identifier used by the original stock RPC cannot be reused by the named RPC',async()=>{
      const reused=randomUUID();await login(ids.isaac);await q('select record_initial_inventory($1,$2::jsonb,null)',[ids.w,JSON.stringify([{product_id:ids.raw,quantity:1,unit:'kg',factor_to_base:1,request_id:reused}])]);
      const before=await snapshot();await login(ids.isaac);await assert.rejects(count(item('Otra cosa',{request_id:reused})),/identificador ya se usó/);assert.deepEqual(await snapshot(),before);
    });
  }finally{await db.close();}
});
