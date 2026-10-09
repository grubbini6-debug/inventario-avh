import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const ids={admin:randomUUID(),isaac:randomUUID(),other:randomUUID(),same:randomUUID(),w:randomUUID(),w2:randomUUID(),raw:randomUUID(),finished:randomUUID()};
test('Fabricación Naval: real inventory RPCs, RLS, reports and full lifecycle in isolated PostgreSQL',async t=>{
  const db=new PGlite();let date,worker,order,order2,consume,report;
  const q=async(sql,args=[])=>{try{return await db.query(sql,args);}catch(e){throw new Error(e.message,{cause:e});}};
  const login=async(user,role='authenticated')=>{await db.exec('reset role');await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user,role})]);await db.exec('set role '+role);};
  const owner=async()=>db.exec('reset role');
  const cmd=async(action,data,id=randomUUID())=>(await q('select public.fabrication_command($1,$2::jsonb,$3::uuid) result',[action,JSON.stringify(data),id])).rows[0].result;
  const stock=async()=>{await owner();const r=await q('select warehouse_id,product_id,sum(quantity_remaining)::float qty from inventory_batches group by warehouse_id,product_id');return r.rows;};
  const originalExit=async(quantity,w=ids.w,id=randomUUID())=>q('select public.record_exit($1,null,null,null,null,$2::jsonb,null)',[w,JSON.stringify([{product_id:ids.raw,quantity,unit:'kg',factor_to_base:1,request_id:id}])]);
  try{
    await db.exec(read('./fixtures/fabrication-inventory.sql'));
    await db.exec(read('../migrations/20261008232715_fabricacion_naval.sql'));
    await q('insert into auth.users(id) select unnest($1::uuid[])',[Object.values(ids).slice(0,4)]);
    await q("insert into warehouses(id,code,name) values($1,'W','Taller existente'),($2,'W2','Otro depósito')",[ids.w,ids.w2]);
    await q("insert into profiles(id,username,role,warehouse_id) values($1,'compras','admin',null),($2,'isaac','depositor',$5),($3,'otro','depositor',$6),($4,'mismo-deposito','depositor',$5)",[ids.admin,ids.isaac,ids.other,ids.same,ids.w,ids.w2]);
    await q("insert into products(id,name,base_unit) values($1,'Acero','kg'),($2,'Bularcama A','unidad')",[ids.raw,ids.finished]);
    date=(await q("select (now() at time zone 'America/Asuncion')::date::text d")).rows[0].d;
    const previous=(await q("select ((now() at time zone 'America/Asuncion')::date-2)::text d")).rows[0].d;
    await t.test('only additive data; existing warehouses/profiles are untouched; public definer RPCs absent',async()=>{
      assert.equal((await q('select count(*)::int n from fabrication_access')).rows[0].n,0);
      assert.equal((await q('select count(*)::int n from warehouses')).rows[0].n,2);
      const r=await q("select count(*)::int n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname like 'fabrication_%' and p.prosecdef");assert.equal(r.rows[0].n,0);
      await login(ids.isaac);await assert.rejects(cmd('worker',{warehouse_id:ids.w,name:'Sin permiso'}),/No autorizado/);
    });
    await t.test('explicit workshop permissions reuse the existing depot assignment',async()=>{
      await login(ids.admin);
      await cmd('configure',{warehouse_id:ids.w,enabled:true,email_enabled:true,email_recipients:['compras@example.test']});
      await assert.rejects(cmd('access',{warehouse_id:ids.w,user_id:ids.other,access_level:'operator'}),/permiso en este depósito/);
      await cmd('access',{warehouse_id:ids.w,user_id:ids.isaac,access_level:'operator'});
      await cmd('access',{warehouse_id:ids.w,user_id:ids.admin,access_level:'supervisor'});
      await assert.rejects(cmd('worker',{warehouse_id:ids.w2,name:'Ajeno'}),/No autorizado/);
      await login(ids.isaac);
      await assert.rejects(q('insert into fabrication_access(warehouse_id,user_id,access_level,granted_by) values($1,$2,\'operator\',$2)',[ids.w,ids.isaac]),/permission denied/);
      await assert.rejects(q('select avh_fabrication_private.generate_due_reports()'),/permission denied/);
      worker=(await cmd('worker',{warehouse_id:ids.w,name:'Operario real',specialty:'Polivalente',hourly_rate:10,currency:'USD'})).id;
    });
    await t.test('orders are numbered; unknown projects and workers cannot be assigned',async()=>{
      const component=(await q("select id from fabrication_components where name='Bularcamas'")).rows[0].id;
      const data={warehouse_id:ids.w,order_date:previous,due_date:date,project:'Proyecto de prueba',component_id:component,piece_code:'BU-A',drawing:'AVH-01',drawing_revision:'A',requested_qty:4,worker_ids:[worker],output_product_id:ids.finished,priority:'high'};
      await assert.rejects(cmd('order',{...data,worker_ids:[randomUUID()]}),/personal asignado/);
      const request=randomUUID();order=(await cmd('order',data,request)).id;
      assert.equal((await cmd('order',data,request)).id,order);
      await assert.rejects(cmd('order',{...data,piece_code:'otro'},request),/otros datos/);
      order2=(await cmd('order',{...data,piece_code:'BU-B'})).id;
      assert.equal((await q('select count(distinct order_no)::int n from fabrication_orders')).rows[0].n,2);
      await assert.rejects(cmd('log',{order_id:order,work_date:date,activity:'Todavía pendiente',completed_qty:1,personnel:[{worker_id:worker,hours:1}]}),/estado actual/);
    });
    await t.test('the original entry/exit/transfer RPCs respect reservations; another depot works normally',async()=>{
      await login(ids.admin);
      for(const [warehouse,quantity,cost] of [[ids.w,40,1],[ids.w,60,2],[ids.w2,12,3]])await q('select record_entry($1,null,null,$2::jsonb,null)',[warehouse,JSON.stringify([{product_id:ids.raw,quantity,unit:'kg',factor_to_base:1,unit_cost:cost,currency:'USD',request_id:randomUUID()}])]);
      await login(ids.isaac);
      await cmd('material',{order_id:order,product_id:ids.raw,quantity:80});
      await cmd('material',{order_id:order2,product_id:ids.raw,quantity:80});
      await cmd('reserve',{order_id:order,product_id:ids.raw,quantity:70});
      await assert.rejects(cmd('reserve',{order_id:order2,product_id:ids.raw,quantity:31}),/insuficiente/);
      await cmd('reserve',{order_id:order2,product_id:ids.raw,quantity:10});
      await assert.rejects(originalExit(21),/reservado/);
      await assert.rejects(q('select record_transfer($1,$2,$3::jsonb,null)',[ids.w,ids.w2,JSON.stringify([{product_id:ids.raw,quantity:21,unit:'kg',factor_to_base:1}])]),/reservado/);
      await originalExit(20);
      await login(ids.other);await originalExit(2,ids.w2);
      const rows=await stock();assert.equal(rows.find(x=>x.warehouse_id===ids.w).qty,80);assert.equal(rows.find(x=>x.warehouse_id===ids.w2).qty,10);
      await login(ids.isaac);
    });
    await t.test('consumption is atomic and idempotent, preserves FIFO, and cannot reuse a normal movement',async()=>{
      await cmd('state',{order_id:order,state:'preparation'});
      await assert.rejects(cmd('consume',{order_id:order,product_id:ids.raw,quantity:71}),/Reservá/);
      const request=randomUUID(),data={order_id:order,product_id:ids.raw,quantity:30};consume=await cmd('consume',data,request);
      assert.equal((await cmd('consume',data,request)).movement_id,consume.movement_id);
      await owner();const a=(await q('select a.quantity::float qty,a.unit_cost::float cost from batch_allocations a join movement_lines l on l.id=a.movement_line_id where l.movement_id=$1 order by cost',[consume.movement_id])).rows;
      assert.deepEqual(a,[{qty:20,cost:1},{qty:10,cost:2}]);
      await login(ids.isaac);
      await assert.rejects(cmd('consume',{...data,quantity:'NaN'}),/Cantidad inválida/);
      const reserved=(await q('select reserved_qty::float qty from fabrication_materials where order_id=$1',[order])).rows[0].qty;assert.equal(reserved,40);
      const reused=randomUUID();await originalExit(0.1,ids.w,reused).catch(()=>{});
      // Existing movements are checked independently from the manufacturing request ledger.
      await owner();await q("insert into movements(type,warehouse_from_id,created_by,client_request_id) values('exit',$1,$2,$3)",[ids.w,ids.isaac,reused]);await login(ids.isaac);
      await assert.rejects(cmd('consume',{...data,quantity:1},reused),/ya.*movimiento|Movimiento.*utiliz/i);
    });
    await t.test('returns are capped by the source consumption and keep its original costs',async()=>{
      await assert.rejects(cmd('return',{order_id:order,product_id:ids.raw,source_link_id:consume.id,quantity:31}),/supera/);
      const data={order_id:order,product_id:ids.raw,source_link_id:consume.id,quantity:25},request=randomUUID();const r=await cmd('return',data,request);
      assert.equal((await cmd('return',data,request)).id,r.id);
      await owner();const rows=(await q('select quantity_received::float qty,unit_cost::float cost from inventory_batches b join movement_lines l on l.id=b.source_line_id where l.movement_id=$1 order by cost',[r.movement_id])).rows;
      assert.deepEqual(rows,[{qty:20,cost:1},{qty:5,cost:2}]);await login(ids.isaac);
      await assert.rejects(cmd('return',{...data,quantity:6}),/supera/);
      assert.equal((await q('select net_consumed_qty::float qty from v_fabrication_material_status where order_id=$1',[order])).rows[0].qty,5);
    });
    await t.test('production, blocks and internal quality cannot overcount pieces or hours',async()=>{
      await cmd('state',{order_id:order,state:'manufacturing'});
      await cmd('block',{order_id:order,notes:'Equipo en reparación'});
      await assert.rejects(cmd('log',{order_id:order,work_date:date,activity:'Corte',completed_qty:4,personnel:[{worker_id:worker,hours:2}]}),/estado actual/);
      await cmd('unblock',{order_id:order,notes:'Equipo reparado'});
      const data={order_id:order,work_date:date,activity:'Corte y armado',completed_qty:4,personnel:[{worker_id:worker,hours:2}],incident:'Ajuste de equipo'},request=randomUUID();
      await cmd('log',data,request);await cmd('log',data,request);
      await assert.rejects(cmd('log',{...data,completed_qty:1}),/check constraint/);
      await assert.rejects(cmd('log',{...data,completed_qty:0,personnel:[{worker_id:worker,hours:23}]}),/24 horas/);
      await cmd('state',{order_id:order,state:'quality'});
      const quality={order_id:order,result:'approved',quantity:2,measurements:'100 mm esperado / 100 mm medido',weld_finish:'Terminación conforme'},key=randomUUID();
      await cmd('quality',quality,key);await cmd('quality',quality,key);
      assert.equal((await q('select internal_quality from fabrication_orders where id=$1',[order])).rows[0].internal_quality,'partial');
      assert.equal((await q('select responsible_name from fabrication_quality_checks where order_id=$1',[order])).rows[0].responsible_name,'isaac');
      await assert.rejects(cmd('quality',{...quality,quantity:3}),/Cantidad de inspección/);
      await assert.rejects(cmd('output',{order_id:order,product_id:ids.finished,quantity:3}),/aprobadas/);
      await cmd('output',{order_id:order,product_id:ids.finished,quantity:2});
      await cmd('quality',{...quality,result:'rework',defects:'Corregir soldadura de dos piezas'});
      await assert.rejects(cmd('state',{order_id:order,state:'manufacturing'}),/retrabajo/);
      await cmd('state',{order_id:order,state:'manufacturing',notes:'Retrabajo de soldaduras'});
      await cmd('log',{...data,completed_qty:0,activity:'Retrabajo',personnel:[{worker_id:worker,hours:1}]});
      await cmd('state',{order_id:order,state:'quality'});await cmd('quality',quality);
      await assert.rejects(cmd('state',{order_id:order,state:'completed'}),/reservas/);
      await cmd('reserve',{order_id:order,product_id:ids.raw,quantity:0});await cmd('state',{order_id:order,state:'completed'});
      await cmd('output',{order_id:order,product_id:ids.finished,quantity:2});
      await cmd('delivery',{order_id:order,product_id:ids.finished,quantity:4,person_receiving:'Responsable real',destination:'Montaje naval'});
      assert.equal((await q('select state from fabrication_orders where id=$1',[order])).rows[0].state,'delivered');
      await owner();assert.equal((await q('select sum(quantity_remaining)::float qty from inventory_batches where product_id=$1',[ids.finished])).rows[0].qty,0);await login(ids.isaac);
    });
    await t.test('linked stock movements and their reservations cannot be bypassed by inventory correction',async()=>{
      await owner();await assert.rejects(q("update movements set status='cancelled' where id=$1",[consume.movement_id]),/Movimiento vinculado/);
      const batch=(await q('select id from inventory_batches where warehouse_id=$1 and product_id=$2 and quantity_remaining>=10 order by received_at,created_at,id limit 1',[ids.w,ids.raw])).rows[0];
      await assert.rejects(q('update inventory_batches set quantity_remaining=0 where warehouse_id=$1 and product_id=$2',[ids.w,ids.raw]),/Material reservado/);
      assert.ok(batch);await login(ids.isaac);
      const before=(await q('select count(*)::int n from fabrication_orders')).rows[0].n;
      await cmd('state',{order_id:order2,state:'cancelled',notes:'Trabajo cancelado de prueba'});
      assert.equal((await q('select reserved_qty::float qty from fabrication_materials where order_id=$1',[order2])).rows[0].qty,0);
      assert.equal((await q('select count(*)::int n from fabrication_orders')).rows[0].n,before);
    });
    await t.test('supervision is read-only; same and other depot depositors see no fabrication data; inactive users lose access',async()=>{
      await login(ids.admin);await assert.rejects(cmd('log',{order_id:order2,work_date:date,activity:'Supervisor',personnel:[]}),/No autorizado/);
      for(const who of [ids.same,ids.other]){await login(who);assert.equal((await q('select count(*)::int n from fabrication_orders')).rows[0].n,0);await assert.rejects(q('select fabrication_day($1,$2::date)',[ids.w,date]),/No autorizado/);}
      await owner();await q('update profiles set active=false where id=$1',[ids.isaac]);await login(ids.isaac);
      assert.equal((await q('select count(*)::int n from fabrication_orders')).rows[0].n,0);await assert.rejects(cmd('reserve',{order_id:order2,product_id:ids.raw,quantity:0}),/no autorizado/);
      await owner();await q('update profiles set active=true where id=$1',[ids.isaac]);await login(ids.isaac);
    });
    await t.test('private attachment paths are authorized by both order and existing warehouse',async()=>{
      const path=`${ids.w}/${order}/image.jpg`;
      await q("insert into storage.objects(bucket_id,name) values('fabrication-documents',$1)",[path]);
      await assert.rejects(q("insert into storage.objects(bucket_id,name) values('fabrication-documents',$1)",[`${ids.w2}/${order}/image.jpg`]),/row-level security/);
      await cmd('attachment',{order_id:order,kind:'photo',file_path:path,file_name:'image.jpg'});
      await login(ids.same);assert.equal((await q('select count(*)::int n from storage.objects')).rows[0].n,0);await login(ids.isaac);
    });
    await t.test('reports include the full depot history beyond 400 rows; old revisions preserve closure snapshots',async()=>{
      await owner();await q("insert into movements(type,warehouse_to_id,created_by,notes) select 'entry',$1,$2,'Historial de prueba '||g from generate_series(1,505) g",[ids.w,ids.isaac]);await login(ids.isaac);
      const data={warehouse_id:ids.w,report_date:date},result=await cmd('report',data);report=result.id;
      const row=(await q('select * from fabrication_reports where id=$1',[report])).rows[0];
      assert.ok(row.payload.movements.length>505);assert.equal(row.payload.work_logs.length,2);assert.equal(row.payload.work_logs.reduce((a,l)=>a+l.completed_qty,0),4);
      assert.equal(row.payload.closure,null);assert.equal(row.payload.quality.every(x=>x.scope==='internal'),true);
      await cmd('closure',{...data,notes:'Cierre real',equipment_problems:'Equipo revisado',purchase_needs:'Acero según requerimiento',next_day_plan:'Trabajar en OF siguiente'});
      const newer=(await q('select * from fabrication_reports where warehouse_id=$1 and report_date=$2 order by revision desc',[ids.w,date])).rows;
      assert.equal(newer.length,2);assert.equal(newer[0].payload.closure.next_day_plan,'Trabajar en OF siguiente');assert.equal(newer[1].payload.closure,null);
      await owner();const r=(await q('select avh_fabrication_private.generate_due_reports() n')).rows[0];assert.equal(r.n,1);
      assert.equal((await q('select avh_fabrication_private.generate_due_reports() n')).rows[0].n,0);
      const automatic=(await q("select * from fabrication_reports where source='automatic'")).rows[0];assert.deepEqual(automatic.payload.work_logs,[]);assert.equal(automatic.payload.closure,null);
    });
    await t.test('mail jobs require the service role and a claim token; reports retry without untracked sends',async()=>{
      await login(ids.admin);await assert.rejects(q('select fabrication_email_claim()'),/permission denied/);
      await login(null,'service_role');const item=(await q('select fabrication_email_claim() r')).rows[0].r;assert.ok(item?.claim_token);
      assert.equal((await q('select fabrication_email_claim() r')).rows[0].r,null);
      assert.equal((await q('select fabrication_email_finish($1,$2,null) ok',[item.report.id,randomUUID()])).rows[0].ok,false);
      assert.equal((await q('select fabrication_email_finish($1,$2,$3) ok',[item.report.id,item.claim_token,'Proveedor no disponible'])).rows[0].ok,true);
      assert.equal((await q('select fabrication_email_claim() r')).rows[0].r,null);
      await owner();await q("update fabrication_reports set email_claimed_at=now()-interval '16 minutes' where id=$1",[item.report.id]);await login(null,'service_role');
      const retry=(await q('select fabrication_email_claim() r')).rows[0].r;assert.equal(retry.report.id,item.report.id);
      assert.equal((await q('select fabrication_email_finish($1,$2,null) ok',[retry.report.id,retry.claim_token])).rows[0].ok,true);
      assert.equal((await q('select fabrication_email_claim() r')).rows[0].r,null);
      await login(null,'anon');await assert.rejects(q('select fabrication_context()'),/permission denied/);
    });
  }finally{await db.close();}
});
