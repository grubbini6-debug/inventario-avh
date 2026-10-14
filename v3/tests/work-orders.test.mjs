import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import * as pdfLib from 'pdf-lib';
import {enrichWorkOrder} from '../edge-functions/_shared/work-order-analysis.mjs';
import {makeWorkOrderPdf} from '../edge-functions/_shared/work-order-pdf.mjs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const ctx={Intl,Date};vm.runInNewContext(read('../src/features/work-orders/model.js'),ctx);const M=ctx.AVHWorkOrderModel;
const source=[['','DD TEST 716'],['','DESCRIPTION','Length','Width','M2','Thk','Quantity','Total Weight'],['','TRBAJOS','mm','mm','mts','mm','Unit','Kg'],['PIQUE DE POPA','Cambio chapa',4300,3000,12.9,12.7,1,1286],['','Cambio refuerzo',1800,267,.4806,7.94,7,210],['','Sub-Total',null,null,null,null,null,1496],['','Tarea /Actividad',null,null,'m2'],['','Mano de obra arenado x m2',null,null,1800],['','Prueba neumática en tanque',null,null,6]];
test('Excel source preserves sectors, all tasks, measures, and mixed service units without subtotals',()=>{
 const p=M.parseRows(source,'Alcance');assert.equal(p.tasks.length,4);assert.equal(p.tasks[1].sector,'PIQUE DE POPA');assert.equal(p.tasks[0].weight_kg,1286);assert.equal(p.tasks[2].quantity,1800);assert.equal(p.tasks[2].unit,'m²');assert.equal(p.tasks[3].quantity,6);assert.equal(p.tasks[3].unit,'unidad');assert.equal(p.tasks[3].area_m2,null);
 const raw=M.parseRows([['Hoja sin encabezado'],['otra estructura']], 'Otra');assert.equal(raw.needs_ai_extraction,true);
 assert.equal(M.parseRows([['Descripción','Cantidad','Unidad'],['Trabajos de soldadura',1,'unidad'],['Actividad de montaje',1,'unidad']],'Otra').tasks.length,2);
 const plan={title:'Trabajo',vessel:'TEST 716',client:null,groups:[{rows:p.tasks.map(t=>t.source_row),operations:['Preparación'],acceptance:['Medir según plano'],materials:[{description:'Consumible',unit:'kg',basis:'Cantidad según proceso'}]}]};
 const analysis=enrichWorkOrder(p.tasks,plan);assert.equal(analysis.tasks[0].weight_kg,1286);assert.equal(analysis.tasks[0].materials[1].quantity,null);assert.equal(analysis.tasks[0].materials[0].confirmed,false);
 assert.throws(()=>enrichWorkOrder(p.tasks,{...plan,groups:[{...plan.groups[0],rows:[4]}]}),/todos/);
 assert.throws(()=>enrichWorkOrder(p.tasks,{...plan,groups:[plan.groups[0],plan.groups[0]]}),/duplicó/);
});
test('real PostgreSQL: work-order authority, numbered emission, immutable scope and traceable progress',async t=>{
 const db=new PGlite(),ids={admin:randomUUID(),galo:randomUUID(),quality:randomUUID(),other:randomUUID(),w:randomUUID()};
 const q=(sql,args=[])=>db.query(sql,args);
 const login=async id=>{await db.exec('reset role');await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,role:'authenticated'})]);await db.exec('set role authenticated');};
 const cmd=async(action,data,requestId=randomUUID())=>(await q('select work_order_command($1,$2::jsonb,$3::uuid) result',[action,JSON.stringify(data),requestId])).rows[0].result;
 const orderId=randomUUID(),payload={title:'Reparación',vessel:'TEST 716',client:'Cliente prueba',responsible:'Galo',order_date:'2026-10-14',tasks:[{id:'fila-4',description:'Reparar chapa',quantity:1,weight_kg:1286,materials:[{description:'Alambre',quantity:null,unit:'kg',confirmed:false}]}]};
 try{
  await db.exec(read('./fixtures/fabrication-inventory.sql'));
  await db.exec(read('../migrations/20261014194409_ordenes_trabajo_galo.sql'));
  await q('insert into auth.users(id) select unnest($1::uuid[])',[[ids.admin,ids.galo,ids.quality,ids.other]]);
  await q("insert into warehouses(id,code,name) values($1,'VH','Villa Hayes')",[ids.w]);
  await q("insert into profiles(id,username,role,warehouse_id,active) values($1,'compras','admin',null,true),($2,'galo','depositor',$5,true),($3,'calidad','depositor',$5,true),($4,'otro','depositor',$5,true)",[ids.admin,ids.galo,ids.quality,ids.other,ids.w]);
  await t.test('other depositors have neither read nor mutation access and cannot self-grant',async()=>{
   await login(ids.other);assert.equal((await q('select * from work_orders')).rows.length,0);await assert.rejects(cmd('save',{order_id:orderId,payload}),/No autorizado/);
   await assert.rejects(q("insert into work_order_access values($1,'editor',$1,now())",[ids.other]),/permission/);
   await login(ids.admin);await cmd('access',{user_id:ids.galo,access_level:'editor'});await cmd('access',{user_id:ids.quality,access_level:'quality'});
  });
  await t.test('draft save is idempotent and detects concurrent edits',async()=>{
   await login(ids.galo);const req=randomUUID(),data={order_id:orderId,payload};const a=await cmd('save',data,req);assert.equal(a.status,'draft');assert.equal(a.number,null);assert.deepEqual(await cmd('save',data,req),a);
   await assert.rejects(cmd('save',{...data,expected_version:99}),/cambió/);
   await assert.rejects(cmd('save',{order_id:randomUUID(),payload:{...payload,tasks:[{...payload.tasks[0],materials:[{description:'Gas',unit:'kg',quantity:null,confirmed:true}]}]}}),/confirmado/);
  });
  await t.test('emission assigns one annual number and conserves exact source payload',async()=>{
   const req=randomUUID(),data={order_id:orderId,expected_version:1},a=await cmd('issue',data,req);assert.equal(a.number,'OT-AVH-2026-00001');assert.equal((await cmd('issue',data,req)).number,a.number);
   const o=(await q('select * from work_orders where id=$1',[orderId])).rows[0];assert.equal(o.issued_payload.tasks[0].weight_kg,1286);
   await assert.rejects(cmd('save',{order_id:orderId,expected_version:2,payload}),/emitida/);
   await assert.rejects(q("update work_orders set number='OT-OTRA' where id=$1",[orderId]),/permission/);
   const next=randomUUID();await cmd('save',{order_id:next,payload});assert.equal((await cmd('issue',{order_id:next,expected_version:1})).number,'OT-AVH-2026-00002');
  });
  await t.test('Galo reports execution and only Quality can certify; closure enforces both',async()=>{
   await assert.rejects(cmd('close',{order_id:orderId}),/avance/);
   await assert.rejects(cmd('quality',{order_id:orderId,task_id:'fila-4',result:'approved',observations:'Inspección'}),/Calidad/);
   await cmd('progress',{order_id:orderId,task_id:'fila-4',percent:100,notes:'Cambio completado'});
   await assert.rejects(cmd('close',{order_id:orderId}),/Calidad/);
   await login(ids.quality);await assert.rejects(cmd('save',{order_id:randomUUID(),payload}),/editor/);await cmd('quality',{order_id:orderId,task_id:'fila-4',result:'approved',observations:'Medidas y terminación verificadas'});
   await login(ids.galo);assert.equal((await cmd('close',{order_id:orderId})).status,'closed');
   await assert.rejects(cmd('progress',{order_id:orderId,task_id:'fila-4',percent:101,notes:'Fuera de rango'}),/estado/);
  });
  await t.test('inactive and revoked users lose access; public RPCs never bypass RLS',async()=>{
   await login(ids.admin);await cmd('access',{user_id:ids.galo,access_level:'none'});await login(ids.galo);assert.equal((await q('select * from work_orders')).rows.length,0);await assert.rejects(cmd('progress',{order_id:orderId,task_id:'fila-4',percent:10,notes:'Intento'}),/No autorizado/);
   await db.exec('reset role');assert.equal((await q("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'work_order_%' and p.prosecdef")).rows[0].n,0);
   assert.equal((await q('select count(*)::int n from inventory_batches')).rows[0].n,0);
  });
 }finally{await db.close();}
});
test('PDF renderer keeps multi-page work scope and pending inputs legible',async()=>{
 const tasks=Array.from({length:75},(_,i)=>({id:'i'+i,sector:'Sector '+i,description:'Trabajo '+i+' - reparación y medición de chapa naval con descripción extensa para validar saltos de página.',quantity:1,unit:'unidad',length_mm:4300,width_mm:3000,thickness_mm:12.7,weight_kg:1286,operations:['Corte y montaje'],acceptance:['Revisar medidas'],materials:[{description:'Consumible',quantity:null,unit:'kg',confirmed:false,basis:'Cantidad pendiente de validar'}]}));
 const bytes=await makeWorkOrderPdf({number:'OT-AVH-2026-00001',status:'issued',issued_payload:{title:'Reparación naval',vessel:'TEST 716',client:'Cliente',responsible:'Galo',order_date:'2026-10-14',tasks}},pdfLib);
 const doc=await pdfLib.PDFDocument.load(bytes);assert.ok(doc.getPageCount()>3);assert.match(doc.getTitle(),/OT-AVH/);assert.ok(bytes.length>20000);
});
