import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {JSDOM} from 'jsdom';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
test('Production reads only its assigned warehouse, without costs or mutation authority; assignment and revocation are audited',async()=>{
 const db=new PGlite(),id={admin:randomUUID(),galo:randomUUID(),other:randomUUID(),failed:randomUUID(),vh:randomUUID(),ac:randomUUID(),inactive:randomUUID(),steel:randomUUID(),missing:randomUUID(),otherMaterial:randomUUID()};
 const q=(sql,args=[])=>db.query(sql,args);
 const login=async(user,role='authenticated')=>{await db.exec('reset role');await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user,role})]);await db.exec('set role '+role);};
 const inventory=async(after=null)=>(await q('select work_order_inventory($1) data',[after])).rows[0].data;
 try{
  await db.exec(read('./fixtures/fabrication-inventory.sql'));
  for(const file of ['20261014194409_ordenes_trabajo_galo.sql','20261015105130_perfil_produccion_ordenes_trabajo.sql','20261015113424_lugar_produccion_inventario_consulta.sql'])await db.exec(read('../migrations/'+file));
  await db.exec('grant update on public.profiles to authenticated');
  await q('insert into auth.users(id) select unnest($1::uuid[])',[[id.admin,id.galo,id.other,id.failed]]);
  await q("insert into warehouses(id,code,name,active) values($1,'VH','Villa Hayes',true),($2,'AC','ACOMAR',true),($3,'OLD','Inactivo',false)",[id.vh,id.ac,id.inactive]);
  await q("insert into profiles(id,username,role,warehouse_id) values($1,'admin.prueba','admin',null),($2,'otro.deposito','depositor',$3)",[id.admin,id.other,id.ac]);
  await q("insert into products(id,name,base_unit) values($1,'Chapa','kg'),($2,'Alambre','kg'),($3,'Material ACOMAR','unidad')",[id.steel,id.missing,id.otherMaterial]);
  await q('insert into stock_minimums(warehouse_id,product_id,minimum_qty) values($1,$2,15),($1,$3,4)',[id.vh,id.steel,id.missing]);
  await login(id.admin);
  for(const [warehouse,product,quantity,cost] of [[id.vh,id.steel,4,100],[id.vh,id.steel,6,200],[id.ac,id.steel,99,300],[id.ac,id.otherMaterial,70,500]])await q('select record_entry($1,null,null,$2::jsonb,null)',[warehouse,JSON.stringify([{product_id:product,quantity,unit:product===id.otherMaterial?'unidad':'kg',factor_to_base:1,unit_cost:cost,currency:'USD',request_id:randomUUID()}])]);
  await assert.rejects(q('select provision_work_order_user($1,$2,$3,$4,$5,$6)',[id.galo,'galo','Galo',id.admin,'Villa Hayes',id.vh]),/permission/);
  await login(id.admin,'service_role');
  const provisioned=(await q('select provision_work_order_user($1,$2,$3,$4,$5,$6) data',[id.galo,'galo','Galo',id.admin,'Astillero Villa Hayes',id.vh])).rows[0].data;
  assert.equal(provisioned.user.work_location,'Astillero Villa Hayes');assert.equal(provisioned.user.inventory_warehouse_id,id.vh);assert.equal(provisioned.user.warehouse_id,null);
  await assert.rejects(q('select provision_work_order_user($1,$2,$3,$4,$5,$6)',[id.failed,'alta.fallida','Prueba',id.admin,'Lugar',id.inactive]),/inactivo/);
  await login(id.galo);let data=await inventory();assert.equal(data.warehouse.id,id.vh);assert.equal(data.items.length,2);
  const steel=data.items.find(x=>x.product_id===id.steel),missing=data.items.find(x=>x.product_id===id.missing);
  assert.equal(steel.stock_qty,10);assert.equal(steel.minimum_qty,15);assert.equal(missing.stock_qty,0);assert.equal(data.items.some(x=>x.product_id===id.otherMaterial),false);
  assert.deepEqual(Object.keys(steel).sort(),['base_unit','minimum_qty','product_id','product_name','stock_qty']);
  assert.equal((await q('select can_access_warehouse($1) allowed',[id.vh])).rows[0].allowed,false);
  assert.equal((await q('select * from v_stock_by_warehouse')).rows.length,0);
  await assert.rejects(q('select record_entry($1,null,null,$2::jsonb,null)',[id.vh,'[]']),/permiso|autoriz|acceso/i);
  await assert.rejects(q('select admin_update_work_order_user($1,null,null,$2,$3)',[id.galo,'ACOMAR',id.ac]),/administrador/);
  assert.equal((await q('update profiles set inventory_warehouse_id=$1 where id=$2 returning id',[id.ac,id.galo])).rows.length,0);
  assert.equal((await inventory()).warehouse.id,id.vh);
  await login(id.other);await assert.rejects(inventory(),/Producción/);
  await db.exec('reset role');assert.equal((await q('select * from profiles where id=$1',[id.failed])).rows.length,0);
  await q("insert into products(name,base_unit) select 'Material '||n,'unidad' from generate_series(1,501) n");
  await q("insert into stock_minimums(warehouse_id,product_id,minimum_qty) select $1,id,1 from products where name like 'Material %' and id<>$2",[id.vh,id.otherMaterial]);
  await login(id.galo);data=await inventory();assert.equal(data.items.length,500);assert.ok(data.next_cursor);const next=await inventory(data.next_cursor);assert.equal(next.items.length,3);assert.equal(next.next_cursor,null);assert.equal(new Set([...data.items,...next.items].map(x=>x.product_id)).size,503);
  await login(id.admin);
  await assert.rejects(q('select admin_update_work_order_user($1,null,$2,$3,$4)',[id.galo,'Nombre rechazado','Lugar',id.inactive]),/inactivo/);
  assert.equal((await q('select full_name from profiles where id=$1',[id.galo])).rows[0].full_name,'Galo');
  await q('select admin_update_work_order_user($1,null,null,$2,$3)',[id.galo,'ACOMAR',id.ac]);await login(id.galo);data=await inventory();assert.equal(data.warehouse.id,id.ac);assert.equal(data.items.find(x=>x.product_id===id.steel).stock_qty,99);
  await login(id.admin);await q('select admin_update_work_order_user($1,null,null,$2,null)',[id.galo,'Villa Hayes']);await login(id.galo);data=await inventory();assert.equal(data.warehouse,null);assert.deepEqual(data.items,[]);
  await login(id.admin);await q('select admin_update_work_order_user($1,false,null)',[id.galo]);await login(id.galo);await assert.rejects(inventory(),/activo/);
  await db.exec('reset role');assert.ok((await q("select count(*)::int n from audit_events where entity_id=$1 and action='production_location_updated'",[id.galo])).rows[0].n>=2);
  assert.equal((await q("select has_function_privilege('anon','work_order_inventory(uuid)','execute') allowed")).rows[0].allowed,false);
 }finally{await db.close();}
});
test('Inventory UI loads all pages, keeps search while refreshing, exposes no stock actions and clears revoked data',async()=>{
 const dom=new JSDOM('<nav class="nav"><button class="production-inventory-nav hide" data-page="production-inventory">Inventario</button></nav><section class="page on" id="page-work-orders"></section><section class="page" id="page-production-inventory"></section>',{url:'https://avh.test',runScripts:'outside-only'}),w=dom.window,calls=[];
 let visible=true,quantity=10;
 const warehouse={id:randomUUID(),name:'Villa Hayes'},product=randomUUID(),second=randomUUID();
 Object.assign(w,{$:s=>w.document.querySelector(s),$$:s=>[...w.document.querySelectorAll(s)],profile:{id:randomUUID(),role:'production'},esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),fmt:v=>String(v),dt:v=>String(v),loadAll:async()=>{},goPage:name=>{w.document.querySelectorAll('.page').forEach(p=>p.classList.toggle('on',p.id==='page-'+name));},rpc:async(name,args)=>{calls.push({name,args});return{data:{work_location:'Astillero Villa Hayes',warehouse:visible?warehouse:null,items:!visible?[]:args.p_after?[{product_id:second,product_name:'Disco',base_unit:'unidad',stock_qty:3,minimum_qty:null}]:[{product_id:product,product_name:'Chapa <naval>',base_unit:'kg',stock_qty:quantity,minimum_qty:15}],next_cursor:visible&&!args.p_after?product:null,updated_at:'2026-10-15T11:00:00Z'}};}});
 try{
  w.eval(read('../src/features/work-orders/inventory-view.js'));await w.loadAll();assert.equal(w.AVHProductionInventory.allowed(),true);assert.equal(w.AVHProductionInventory.state.data.items.length,2);
  w.goPage('production-inventory');await w.AVHProductionInventory.refresh();assert.match(w.$('#productionStockTitle').textContent,/Villa Hayes/);assert.equal(w.$('#productionStockRows').querySelector('naval'),null);
  assert.equal(w.document.querySelectorAll('#page-production-inventory button').length,1);
  const search=w.$('#productionStockSearch');search.value='chapa';search.oninput();quantity=7;await w.AVHProductionInventory.refresh();assert.equal(w.$('#productionStockSearch'),search);assert.equal(search.value,'chapa');assert.match(w.$('#productionStockRows').textContent,/7/);
  assert.equal(w.AVHProductionInventory.stock(product,warehouse.id),7);assert.equal(w.AVHProductionInventory.stock(product,randomUUID()),null);
  assert.ok(calls.every(c=>c.name==='work_order_inventory'&&Object.keys(c.args).join()==='p_after'));
  visible=false;await w.AVHProductionInventory.refresh();assert.equal(w.AVHProductionInventory.allowed(),false);assert.equal(w.AVHProductionInventory.stock(product,warehouse.id),null);assert.equal(w.$('.page.on').id,'page-work-orders');assert.equal(w.$('#productionStockSearch'),null);
 }finally{w.close();}
});
