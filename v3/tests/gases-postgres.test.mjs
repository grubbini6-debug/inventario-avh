import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
test('Gases: FIFO existente, envases, conteos, autorización y ciclos completos en PostgreSQL aislado',async t=>{
 const db=new PGlite(),ids={admin:randomUUID(),dep:randomUUID(),other:randomUUID(),inactive:randomUUID(),w:randomUUID(),w2:randomUUID(),co2:randomUUID(),oxygen:randomUUID(),glp:randomUUID(),otherProduct:randomUUID()};
 const q=(sql,args=[])=>db.query(sql,args);
 const owner=()=>db.exec('reset role');
 const login=async(user,role='authenticated')=>{await owner();await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user,role})]);await db.exec('set role '+role);};
 const cmd=async(action,data,key=randomUUID())=>(await q('select public.gas_command($1,$2::jsonb,$3::uuid) result',[action,JSON.stringify({warehouse_id:ids.w,...data}),key])).rows[0].result;
 const context=async()=>(await q('select * from public.v_gas_stock_status order by warehouse_id,sort_order')).rows;
 const row=async(product)=> (await context()).find(x=>x.warehouse_id===ids.w&&x.product_id===product);
 const holder=async(product,person,location='production')=>Number((await q('select quantity from public.gas_custody where warehouse_id=$1 and product_id=$2 and person_key=lower($3) and location=$4',[ids.w,product,person,location])).rows[0]?.quantity||0);
 const countData=async(full={co2:10,oxygen:5,glp:4},empty={co2:3,oxygen:4,glp:0},hold={})=>{
  const current=await context();return{notes:'Conteo físico de prueba',items:['co2','oxygen','glp'].map(key=>({product_id:ids[key],expected_version:Number(current.find(r=>r.warehouse_id===ids.w&&r.product_id===ids[key]).version),full_qty:full[key],empty_qty:empty[key],holders:hold[key]||[]}))};
 };
 const record=async(name,product,qty,person='Persona',destination='Trabajo')=>{
  const items=JSON.stringify([{product_id:product,quantity:qty,unit:'cilindro',factor_to_base:1,request_id:randomUUID()}]);
  if(name==='entry')return q('select public.record_entry($1,null,null,$2::jsonb,null)',[ids.w,items]);
  if(name==='exit')return q('select public.record_exit($1,null,null,$2,$3,$4::jsonb,null)',[ids.w,person,destination,items]);
  return q('select public.record_return($1,null,null,$2,$3::jsonb,null)',[ids.w,person,items]);
 };
 try{
  await db.exec(read('./fixtures/fabrication-inventory.sql'));
  await q('insert into auth.users(id) select unnest($1::uuid[])',[[ids.admin,ids.dep,ids.other,ids.inactive]]);
  await q("insert into warehouses(id,code,name) values($1,'ACOMAR','ACOMAR'),($2,'OTHER','Otro depósito')",[ids.w,ids.w2]);
  await q("insert into profiles(id,username,full_name,role,warehouse_id,active) values($1,'admin','Compras','admin',null,true),($2,'nuevo','Depositario nuevo','depositor',$5,true),($3,'otro','Otro','depositor',$6,true),($4,'inactivo','Inactivo','depositor',$5,false)",[ids.admin,ids.dep,ids.other,ids.inactive,ids.w,ids.w2]);
  await q("insert into products(id,sku,name,base_unit) values($1,'CO2','CO₂','cilindro'),($2,'OXIGENO','Oxígeno','cilindro'),($3,'GLP-10KG','GLP 10 kg','cilindro'),($4,'OTRO','Otro producto','unidad')",[ids.co2,ids.oxygen,ids.glp,ids.otherProduct]);
  await login(ids.admin);await record('entry',ids.co2,10);await record('entry',ids.oxygen,5);await record('entry',ids.glp,4);await record('entry',ids.otherProduct,25);
  await owner();try{await db.exec(read('../migrations/20261014121312_control_gases.sql'));await db.exec(read('../migrations/20261020133036_gas_presentations_kg.sql'));await db.exec(read('../migrations/20261020133040_gas_presentation_commands.sql'));}catch(e){throw Error(e.message+' (SQL position '+e.position+')');}
  await t.test('instalar conserva productos, depósitos, perfiles y todos los saldos; los ceros no se presentan como conteo',async()=>{
   await login(ids.dep);const r=await row(ids.co2);assert.equal(Number(r.full_qty),10);assert.equal(r.counted_at,null);assert.equal((await context()).length,3);
   await assert.rejects(cmd('exit',{product_id:ids.co2,quantity:1,person:'Juan',destination:'Soldadura'}),/primero.*conteo/);
   await assert.rejects(record('exit',ids.co2,1),/primero.*conteo/);
   await owner();assert.equal((await q('select count(*)::int n from warehouses')).rows[0].n,2);assert.equal((await q('select count(*)::int n from profiles')).rows[0].n,4);
   assert.equal(Number((await q('select sum(quantity_remaining) n from inventory_batches where product_id=$1',[ids.otherProduct])).rows[0].n),25);
   assert.equal((await q("select count(*)::int n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname='gas_command' and p.prosecdef")).rows[0].n,0);
  });
  await t.test('el conteo absoluto no agrega el saldo otra vez; registra fuera del depósito y audit trail',async()=>{
   await login(ids.dep);const data=await countData(undefined,undefined,{co2:[{person:'Juan',location:'production',quantity:2},{person:'Gas Metal',location:'supplier',quantity:1}]});const key=randomUUID(),a=await cmd('count',data,key),b=await cmd('count',data,key);assert.deepEqual(a,b);
   const r=await row(ids.co2);assert.equal(Number(r.full_qty),10);assert.equal(r.empty_qty,3);assert.equal(Number(r.outside_qty),2);assert.equal(Number(r.supplier_qty),1);assert.ok(r.counted_at);
   assert.equal((await q("select count(*)::int n from gas_events where action='count'")).rows[0].n,3);
   await owner();assert.equal((await q("select count(*)::int n from audit_events where action='gas_count'")).rows[0].n,3);
  });
  await t.test('entrega y retorno de vacíos: el envase devuelto no suma gas disponible',async()=>{
   await login(ids.dep);const data={product_id:ids.co2,quantity:3,empty_quantity:1,person:'  JUAN  ',destination:'Soldadura fondo',reference:'VALE-1'},key=randomUUID();const a=await cmd('exit',data,key);assert.deepEqual(await cmd('exit',data,key),a);
   let r=await row(ids.co2);assert.equal(Number(r.full_qty),7);assert.equal(r.empty_qty,4);assert.equal(await holder(ids.co2,'Juan'),4);
   await cmd('return_empty',{product_id:ids.co2,quantity:2,person:'Juan'});r=await row(ids.co2);assert.equal(Number(r.full_qty),7);assert.equal(r.empty_qty,6);assert.equal(await holder(ids.co2,'Juan'),2);
   await assert.rejects(cmd('return_empty',{product_id:ids.co2,quantity:3,person:'Juan'}),/supera/);
   await assert.rejects(cmd('exit',{...data,empty_quantity:3}),/superan/);
   const e=(await q("select * from gas_events where action='exit'")).rows[0];assert.equal(Number(e.full_before),10);assert.equal(Number(e.full_after),7);assert.equal(e.actor_name,'Depositario nuevo');assert.equal(e.reference,'VALE-1');
  });
  await t.test('proveedor, entregas parciales y canje inmediato conservan el total de envases',async()=>{
   const before=await row(ids.co2),total=r=>Number(r.full_qty)+r.empty_qty+Number(r.outside_qty)+Number(r.supplier_qty);
   await cmd('send_refill',{product_id:ids.co2,quantity:4,person:'Gas Metal'});assert.equal(await holder(ids.co2,'Gas Metal','supplier'),5);
   await cmd('refill',{product_id:ids.co2,quantity:3,empty_quantity:0,person:'Gas Metal'});
   let r=await row(ids.co2);assert.equal(Number(r.full_qty),10);assert.equal(r.empty_qty,2);assert.equal(Number(r.supplier_qty),2);assert.equal(total(r),total(before));
   await cmd('refill',{product_id:ids.co2,quantity:2,empty_quantity:1,person:'Gas Metal'});r=await row(ids.co2);assert.equal(Number(r.full_qty),12);assert.equal(r.empty_qty,1);assert.equal(Number(r.supplier_qty),1);assert.equal(total(r),total(before));
   await assert.rejects(cmd('refill',{product_id:ids.co2,quantity:3,person:'Gas Metal'}),/supera/);
   await assert.rejects(cmd('send_refill',{product_id:ids.co2,quantity:2,person:'Otro proveedor'}),/insuficientes/);
   await cmd('new_full',{product_id:ids.glp,quantity:2,person:'Metalux'});assert.equal(Number((await row(ids.glp)).full_qty),6);assert.equal(await holder(ids.glp,'Metalux','supplier'),0);
  });
  await t.test('los circuitos normales se integran al historial de gas sin duplicar stock',async()=>{
   await record('exit',ids.oxygen,2,'Pedro','Corte');let r=await row(ids.oxygen);assert.equal(Number(r.full_qty),3);assert.equal(Number(r.outside_qty),2);
   await assert.rejects(record('return',ids.oxygen,3,'Pedro'),/supera/);
   await record('return',ids.oxygen,1,'Pedro');r=await row(ids.oxygen);assert.equal(Number(r.full_qty),4);assert.equal(r.empty_qty,4);assert.equal(Number(r.outside_qty),1);
   await record('entry',ids.co2,3);assert.equal(Number((await row(ids.co2)).full_qty),15);assert.equal(await holder(ids.co2,'Gas Metal','supplier'),1);
   await assert.rejects(record('exit',ids.oxygen,1,'',''),/persona y destino/);
  });
  await t.test('cantidades, pedidos alterados, existencias y precios se validan en el servidor',async()=>{
   const data={product_id:ids.co2,quantity:1,person:'Juan',destination:'Soldadura'},key=randomUUID();await cmd('exit',data,key);await assert.rejects(cmd('exit',{...data,quantity:2},key),/otros datos/);
   for(const quantity of ['NaN','Infinity',-1,0,1.5,null])await assert.rejects(cmd('exit',{...data,quantity}),/Cantidad/);
   const before=await row(ids.co2);await assert.rejects(cmd('exit',{...data,quantity:999999}),/insuficiente/);assert.deepEqual(await row(ids.co2),before);
   await assert.rejects(cmd('new_full',{product_id:ids.glp,quantity:1,person:'Metalux',unit_cost:100,currency:'PYG'}),/Solo administración/);
   await login(ids.admin);await assert.rejects(cmd('new_full',{product_id:ids.glp,quantity:1,person:'Metalux',unit_cost:100}),/precio y moneda/);
  });
  await t.test('el conteo exige los tres gases, evita omisiones y detecta un saldo cambiado mientras se contaba',async()=>{
   const stale=await countData();await record('entry',ids.co2,1);await assert.rejects(cmd('count',stale),/saldo cambió/);
   const data=await countData();await assert.rejects(cmd('count',{...data,items:data.items.slice(1)}),/una sola fila/);
   await assert.rejects(cmd('count',{...data,items:[data.items[0],data.items[0],data.items[2]]}),/una sola fila/);
   await assert.rejects(cmd('count',{...data,items:data.items.map((i,k)=>k===0?{...i,full_qty:null}:i)}),/Cantidad/);
   await assert.rejects(cmd('count',{...data,items:data.items.map((i,k)=>k===0?{...i,holders:[{person:'Juan',location:'production',quantity:1},{person:' JUAN ',location:'production',quantity:1}]}:i)}),/duplicate key/);
  });
  await t.test('transferencia entre depósitos: salida y recepción se registran una vez y quedan visibles solo para sus roles',async()=>{
   const before=Number((await row(ids.co2)).full_qty);
   const move=(await q('select public.record_transfer($1,$2,$3::jsonb,null) id',[ids.w,ids.w2,JSON.stringify([{product_id:ids.co2,quantity:2,unit:'cilindro',factor_to_base:1,request_id:randomUUID()}])])).rows[0].id;
   assert.equal(Number((await row(ids.co2)).full_qty),before-2);
   await login(ids.other);await q('select public.receive_transfer($1)',[move]);
   const r=(await context()).find(x=>x.warehouse_id===ids.w2&&x.product_id===ids.co2);assert.equal(Number(r.full_qty),2);
   assert.equal((await q("select count(*)::int n from gas_events where action='transfer_in' and movement_id=$1",[move])).rows[0].n,1);
   await login(ids.admin);
  });
  await t.test('nuevo conteo reemplaza exactamente y deja diferencias, referencias e historial intactos',async()=>{
   const before=await row(ids.co2),events=(await q('select count(*)::int n from gas_events')).rows[0].n;
   const data=await countData({co2:4,oxygen:0,glp:3},{co2:7,oxygen:2,glp:1},{co2:[{person:'Pendientes del conteo',location:'production',quantity:5}]});await cmd('count',data);
   let r=await row(ids.co2);assert.equal(Number(r.full_qty),4);assert.equal(r.empty_qty,7);assert.equal(Number(r.outside_qty),5);assert.equal(Number(r.supplier_qty),0);assert.equal((await q('select count(*)::int n from gas_events')).rows[0].n,events+3);
   const e=(await q("select * from gas_events where product_id=$1 and action='count' order by event_no desc limit 1",[ids.co2])).rows[0];assert.equal(Number(e.full_delta),4-Number(before.full_qty));assert.equal(e.detail.holders_before.length>0,true);
   const m=(await q('select type from movements where id=$1',[e.movement_id])).rows[0];assert.equal(m.type,'adjustment');
   await owner();await assert.rejects(q("update movements set status='cancelled' where id=$1",[e.movement_id]),/control de gases/);
   assert.equal(Number((await q('select sum(quantity_remaining) n from inventory_batches where product_id=$1',[ids.otherProduct])).rows[0].n),25);
   await login(ids.dep);await cmd('return_empty',{product_id:ids.co2,quantity:2,person:'Pendientes del conteo'});r=await row(ids.co2);assert.equal(r.empty_qty,9);assert.equal(Number(r.full_qty),4);assert.equal(Number(r.outside_qty),3);
  });
  await t.test('presentaciones libres en kg: altas idempotentes, conteo, FIFO y envases separados por tamaño',async()=>{
   await login(ids.dep);
   const ensure=async(kind,kg,warehouse=ids.w)=>(await q('select public.gas_ensure_presentation($1,$2,$3::numeric) result',[warehouse,kind,kg])).rows[0].result;
   const eventsBefore=(await q('select count(*)::int n from gas_events')).rows[0].n;
   const p25=await ensure('co2',25),p50=await ensure('co2',50),pCustom=await ensure('co2',22.5);
   assert.equal(p25.created,true);assert.equal(p25.counted_at,null);assert.equal(Number(p25.full_qty),0);
   assert.equal((await ensure('co2','25.000')).product_id,p25.product_id);assert.equal((await ensure('co2',25)).created,false);
   await ensure('co2',20);await ensure('co2',30);const glp50=await ensure('glp',50),o30=await ensure('oxygen',30);
   assert.equal((await q('select count(*)::int n from gas_events')).rows[0].n,eventsBefore,'el catálogo no inventa conteos ni movimientos');
   assert.equal(Number((await row(ids.co2)).full_qty),4);assert.equal((await row(ids.co2)).full_kg,null,'el peso anterior desconocido sigue sin inventarse');
   assert.equal(Number((await row(ids.glp)).kg_per_cylinder),10);
   for(const kg of [null,0,-1,'NaN','Infinity','-Infinity','0.0001',1000.001])await assert.rejects(ensure('co2',kg),/kg por cilindro/);
   await assert.rejects(ensure(null,25),/Gas inválido/);await assert.rejects(ensure('aire',25),/Gas inválido/);await assert.rejects(ensure('co2',25,ids.w2),/No autorizado/);
   await assert.rejects(cmd('new_full',{product_id:p25.product_id,quantity:1,person:'Gases'}),/primero.*conteo/);
   const current=await context(),balances=new Map([[p25.product_id,[2,1]],[p50.product_id,[3,2]],[pCustom.product_id,[2,0]],[glp50.product_id,[1,1]],[o30.product_id,[1,1]]]);
   const items=[];
   for(const r of current){const h=(await q('select person,location,quantity from gas_custody where warehouse_id=$1 and product_id=$2 and quantity>0',[ids.w,r.product_id])).rows;const v=balances.get(r.product_id)||[Number(r.full_qty),r.empty_qty];items.push({product_id:r.product_id,expected_version:r.version,full_qty:v[0],empty_qty:v[1],holders:h});}
   await assert.rejects(cmd('count',{notes:'Conteo de todas las presentaciones',items:items.slice(1)}),/una sola fila/);
   const count={notes:'Conteo por peso real del cilindro',items},key=randomUUID(),result=await cmd('count',count,key);assert.deepEqual(await cmd('count',count,key),result);
   assert.equal(Number((await row(p25.product_id)).full_kg),50);assert.equal(Number((await row(p50.product_id)).full_kg),150);assert.equal(Number((await row(pCustom.product_id)).full_kg),45);
   const p50Before=await row(p50.product_id);
   await cmd('exit',{product_id:p25.product_id,quantity:1,person:'Juan 25',destination:'Soldadura'});
   assert.equal(Number((await row(p25.product_id)).full_kg),25);assert.deepEqual(await row(p50.product_id),p50Before);
   await assert.rejects(cmd('return_empty',{product_id:p50.product_id,quantity:1,person:'Juan 25'}),/supera/);
   await cmd('return_empty',{product_id:p25.product_id,quantity:1,person:'Juan 25'});
   assert.equal(Number((await row(p25.product_id)).full_kg),25);assert.equal((await row(p25.product_id)).empty_qty,2);
   const emptyEvent=(await q("select detail from gas_events where product_id=$1 and action='return_empty' order by event_no desc limit 1",[p25.product_id])).rows[0];assert.equal(emptyEvent.detail.gas_kg_delta,0);assert.equal(emptyEvent.detail.kg_per_cylinder,25);
   await cmd('send_refill',{product_id:p25.product_id,quantity:1,person:'Proveedor 25'});await cmd('refill',{product_id:p25.product_id,quantity:1,person:'Proveedor 25'});
   assert.equal(Number((await row(p25.product_id)).full_kg),50);assert.deepEqual(await row(p50.product_id),p50Before);
   await record('entry',p25.product_id,1);assert.equal(Number((await row(p25.product_id)).full_kg),75);
   const event=(await q("select detail from gas_events where product_id=$1 and action='entry' order by event_no desc limit 1",[p25.product_id])).rows[0];assert.equal(event.detail.gas_kg_delta,25);
   await login(ids.admin);
   const transfer=(await q('select public.record_transfer($1,$2,$3::jsonb,null) id',[ids.w,ids.w2,JSON.stringify([{product_id:p50.product_id,quantity:1,unit:'cilindro',factor_to_base:1,request_id:randomUUID()}])])).rows[0].id;
   await login(ids.other);await q('select public.receive_transfer($1)',[transfer]);
   const transferred=(await context()).find(r=>r.product_id===p50.product_id);assert.equal(Number(transferred.full_kg),50);assert.equal((await context()).every(r=>r.warehouse_id===ids.w2),true);
   await login(ids.inactive);await assert.rejects(ensure('co2',23),/no autorizado/);
   await login(null,'anon');await assert.rejects(ensure('co2',23),/permission denied/);
   await login(ids.dep);await assert.rejects(q('update gas_products set kg_per_cylinder=50 where product_id=$1',[p25.product_id]),/permission denied/);
  });
  await t.test('RLS, usuarios inactivos, depósito ajeno y acceso directo no permiten modificar saldos',async()=>{
   for(const who of [ids.other,ids.inactive]){await login(who);await assert.rejects(cmd('return_empty',{product_id:ids.co2,quantity:1,person:'Pendientes del conteo'}),/no autorizado|No autorizado/);assert.equal((await q('select * from gas_events where warehouse_id=$1',[ids.w])).rows.length,0);}
   await login(ids.dep);await assert.rejects(q('update gas_controls set empty_qty=99'),/permission denied/);await assert.rejects(q('delete from gas_events'),/permission denied/);await assert.rejects(q('select * from avh_gas_private.requests'),/permission denied/);
   await login(null,'anon');await assert.rejects(cmd('exit',{product_id:ids.co2,quantity:1,person:'Juan',destination:'Corte'}),/permission denied/);
   await owner();assert.equal((await q('select count(*)::int n from profiles where active')).rows[0].n,3);
  });
 }finally{await db.close();}
});
