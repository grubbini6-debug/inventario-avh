import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {repairFixture} from './helpers/repair-fixture.mjs';

test('presupuestos, autorización, custodia y costos reales de reparación en PostgreSQL',async t=>{
 const f=await repairFixture();t.after(()=>f.db.close());let a,b,o;
 await t.test('registra identidad única por código y serie sin generar stock',async()=>{
  a=await f.asset();b=await f.asset();
  const r=(await f.q('select * from equipment_assets where id=$1',[a])).rows[0];assert.equal(r.status,'available');
  await assert.rejects(f.asset({code:r.code.toLowerCase()}),/equipment_assets_code_key/);
  await assert.rejects(f.asset({serial_number:r.serial_number.toLowerCase()}),/equipment_assets_serial_unique/);
  assert.equal((await f.q('select count(*)::int n from inventory_batches')).rows[0].n,0);
 });
 await t.test('datos incompletos, total diferente y máquina de otro depósito bloquean el envío',async()=>{
  for(const patch of [{currency:null},{tax_mode:null},{reviewed:false},{source_total:1},{items:[{equipment_id:a,description:'Trabajo',quantity:1,unit_price:null}]}]){
   const x=await f.order(f.payload([a],patch));await assert.rejects(f.action(x,'submit'),/Completá|Asigná|coincide/);assert.equal((await f.document(x.id)).status,'draft');
  }
  const foreign=await f.asset({warehouse_id:f.ids.other});await assert.rejects(f.order(f.payload([foreign])),/depósito/);
  await assert.rejects(f.order(f.payload([a],{items:[{equipment_id:a,description:'Trabajo',quantity:1,unit_price:'NaN'}]})),/rango/);
 });
 await t.test('versiones y autorización explícita; el reintento emite exactamente una OC de servicio',async()=>{
  o=await f.order(f.payload([a,b]));o=await f.action(o,'submit');
  await assert.rejects(f.command('approve',{order_id:o.id,expected_version:o.version-1,authorized_by:'Dirección',authorization_reference:'QA',authorization_received:true}),/cambió/);
  await assert.rejects(f.action(o,'approve',{authorized_by:'Dirección',authorization_reference:'QA'}),/autoriz/);
  const request=randomUUID(),data={order_id:o.id,expected_version:o.version,authorized_by:'Dirección',authorization_reference:'Correo QA',authorization_received:true};
  const first=await f.command('approve',data,request),second=await f.command('approve',data,request);assert.deepEqual(second,first);o=await f.document(o.id);
  assert.equal(o.status,'approved');assert.equal(Number(o.approved_total),1650);assert.equal(o.assets.length,2);assert.equal(o.assets.reduce((s,c)=>s+Number(c.approved_amount),0),1650);
  const purchases=(await f.owner('select * from purchases')).rows;assert.equal(purchases.length,1);assert.equal(purchases[0].purchase_type,'service');assert.equal(purchases[0].destination_type,'direct');assert.ok(purchases[0].po_number);
  assert.equal((await f.owner('select count(*)::int n from purchase_items where affects_inventory')).rows[0].n,0);
  await assert.rejects(f.command('approve',{...data,authorization_reference:'Diferente'},request),/otros datos/);
 });
 await t.test('protege la misma máquina frente a otra reparación y frente a cambios de OC por Compras',async()=>{
  const x=await f.action(await f.order(f.payload([a])),'submit');await assert.rejects(f.approve(x),/otra reparación/);
  await assert.rejects(f.command('asset_save',{equipment_id:a,expected_version:2,asset:{code:'MODIFICADA'}}),/reparación abierta/);
  await assert.rejects(f.owner('update purchase_items set unit_price=1 where purchase_id=$1',[o.purchase_id]),/adicionales desde Reparaciones/);
  await assert.rejects(f.owner('update purchases set currency=\'USD\' where id=$1',[o.purchase_id]),/alcance autorizado/);
 });
 await t.test('impide cerrar sin recibir y probar; cada envío y regreso queda auditado sin movimientos FIFO',async()=>{
  await assert.rejects(f.action(o,'close',{invoice:f.invoice(o)}),/prueba conforme/);
  const request=randomUUID(),data={order_id:o.id,expected_version:o.version,equipment_id:a,date:f.day,mode:'workshop',condition:'Falla original',accessories:'Torcha',carrier:'Conductor QA'};
  await f.command('dispatch',data,request);await f.command('dispatch',data,request);o=await f.document(o.id);
  assert.equal(o.assets.find(c=>c.equipment_id===a).status,'service');assert.equal(o.events.filter(e=>e.action==='dispatch').length,1);
  assert.equal((await f.q('select status from equipment_assets where id=$1',[a])).rows[0].status,'in_repair');
  o=await f.receive(o,a);await assert.rejects(f.action(o,'close',{invoice:f.invoice(o)}),/prueba conforme/);
  o=await f.test(o,a,'failed');assert.equal(o.assets.find(c=>c.equipment_id===a).status,'rework');
  o=await f.dispatch(o,a);o=await f.receive(o,a);o=await f.test(o,a);
  o=await f.dispatch(o,b);o=await f.receive(o,b);o=await f.test(o,b);
  assert.equal(o.assets.every(c=>c.status==='ready'),true);assert.equal(o.status,'testing');
  assert.equal((await f.q('select count(*)::int n from movements')).rows[0].n,0);assert.ok(o.assets[0].warranty_until);
 });
 await t.test('los adicionales conservan lo aprobado y requieren una nueva autorización antes de facturar',async()=>{
  const initial=o.approved_total;
  o=await f.action(o,'propose_extra',{reason:'Repuesto adicional detectado en el taller',items:[{equipment_id:a,kind:'part',description:'Rodillo de arrastre',quantity:1,unit_price:200}]});
  assert.equal(o.approved_total,initial);assert.ok(o.proposed_payload);await assert.rejects(f.action(o,'close',{invoice:f.invoice(o)}),/adicionales/);
  o=await f.action(o,'approve_extra',{authorized_by:'Dirección',authorization_reference:'Correo del adicional',authorization_received:true});
  assert.equal(Number(o.approved_total),1870);assert.equal(o.additional_purchase_ids.length,1);assert.equal(o.proposed_payload,null);assert.equal(o.approved_payload.items.length,3);
  const events=o.events.filter(e=>e.action==='approve'||e.action==='approve_extra');assert.equal(events.length,2);assert.equal(Number(events[0].detail.approved_payload.total),1650);
 });
 await t.test('concilia factura por equipo y cierra las OC como servicios, sin registrar pagos ficticios',async()=>{
  await assert.rejects(f.action(o,'close',{invoice:f.invoice(o,{total:1900})}),/supera/);
  await assert.rejects(f.action(o,'close',{invoice:f.invoice(o,{total:1869})}),/no coincide/);
  await assert.rejects(f.action(o,'close',{invoice:f.invoice(o,{allocations:[o.assets[0],o.assets[0]].map(c=>({equipment_id:c.equipment_id,amount:c.approved_amount}))})}),/cada máquina/);
  o=await f.action(o,'close',{invoice:f.invoice(o)});assert.equal(o.status,'completed');
  assert.equal(o.assets.reduce((s,c)=>s+Number(c.actual_amount),0),1870);
  const purchases=(await f.owner('select status,invoice_number from purchases')).rows;assert.equal(purchases.every(p=>p.status==='invoiced'&&p.invoice_number==='FACT-001'),true);
  assert.equal((await f.q('select count(*)::int n from inventory_batches')).rows[0].n,0);
  const history=(await f.q('select public.repair_asset_history($1) result',[a])).rows[0].result;assert.equal(history.repairs.length,1);assert.equal(history.repairs[0].actual_amount,o.assets.find(c=>c.equipment_id===a).actual_amount);
 });
 await t.test('adjuntos privados: comprueba que el objeto existe dentro de la misma reparación',async()=>{
  await assert.rejects(f.command('attachment',{order_id:o.id,path:o.id+'/quote/no-existe.pdf',kind:'quote',file_name:'presupuesto.pdf'}),/Adjunto/);
  const path=o.id+'/quote/'+randomUUID()+'/presupuesto.pdf';await f.q('insert into storage.objects(bucket_id,name) values(\'repair-documents\',$1)',[path]);
  await f.command('attachment',{order_id:o.id,path,kind:'quote',file_name:'presupuesto.pdf'});
  assert.equal((await f.document(o.id)).attachments.length,1);
  const other=await f.order(f.payload([a]));await assert.rejects(f.command('attachment',{order_id:other.id,path,kind:'quote',file_name:'presupuesto.pdf'}),/Adjunto/);
  await f.db.exec('reset role');assert.equal((await f.q("select public from storage.buckets where id='repair-documents'")).rows[0].public,false);await f.as();
 });
 await t.test('anula antes del envío con respaldo y bloquea la duplicación de una factura del taller',async()=>{
  const machine=await f.asset();let x=await f.approved(f.payload([machine]));
  await assert.rejects(f.action(x,'cancel',{reason:'No se realizará el trabajo'}),/autorización/);
  x=await f.action(x,'cancel',{reason:'Se deja sin efecto antes de entregar',authorized_by:'Dirección',authorization_reference:'Correo de anulación QA',authorization_received:true});assert.equal(x.status,'cancelled');assert.equal(x.assets[0].status,'cancelled');
  assert.equal((await f.owner('select status from purchases where id=$1',[x.purchase_id])).rows[0].status,'cancelled');
  x=await f.ready(await f.approved(f.payload([machine])));
  await assert.rejects(f.action(x,'close',{invoice:f.invoice(x,{number:' fact-001 '})}),/ya está registrada/);assert.equal((await f.document(x.id)).assets[0].actual_amount,null);
  await assert.rejects(f.action(x,'cancel',{reason:'Intento después de la entrega',authorized_by:'Dirección',authorization_reference:'QA',authorization_received:true}),/entregas/);
 });
 await t.test('redondea USD y distribuye el IVA sin perder centavos entre máquinas',async()=>{
  const a=await f.asset(),b=await f.asset();const x=await f.approved(f.payload([a,b],{currency:'USD',tax_mode:'add',tax_rate:10,source_total:0.11,items:[{equipment_id:a,description:'Ajuste',quantity:1,unit_price:.05},{equipment_id:b,description:'Prueba',quantity:1,unit_price:.05}]}));
  assert.equal(x.approved_total,.11);assert.equal(x.assets.reduce((sum,c)=>sum+Number(c.approved_amount),0),.11);assert.equal(x.approved_payload.tax_amount,.01);
 });
 await t.test('deniega RPC y datos a Producción, Depósito, administrador inactivo y anónimo',async()=>{
  for(const role of ['dep','production','inactive']){await f.as(role);assert.equal((await f.q('select * from repair_orders')).rows.length,0);assert.equal((await f.q('select * from equipment_assets')).rows.length,0);await assert.rejects(f.document(o.id),/Solo Compras/);await assert.rejects(f.command('save',{order_id:randomUUID(),payload:{items:[]}}),/Solo Compras/);}
  await f.db.exec('reset role;set role anon');await assert.rejects(f.q('select public.repair_document($1)',[o.id]),/permission denied/);
  await f.as();await assert.rejects(f.q('update repair_orders set approved_total=999999 where id=$1',[o.id]),/permission denied/);
 });
});
