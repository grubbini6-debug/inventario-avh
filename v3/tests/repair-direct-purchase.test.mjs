import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {repairFixture} from './helpers/repair-fixture.mjs';

test('repair quote issues a normal editable service OC without machines, series, warehouse or repair authorization',async t=>{
 const f=await repairFixture();t.after(()=>f.db.close());
 const data={company_id:f.ids.company,supplier_id:f.ids.supplier,currency:'PYG',tax_mode:'add',tax_rate:10,source_total:1650,payment_terms:'Crédito 30 días'},items=[{description:'Reparación del alimentador',quantity:1,unit:'servicio',unit_price:1000},{description:'Rodillo instalado',quantity:1,unit:'unidad',unit_price:500}],request=randomUUID();
 const call=async(d=data,i=items,id=randomUUID())=>(await f.q('select public.admin_create_service_purchase_from_quote($1,$2,$3) result',[JSON.stringify(d),JSON.stringify(i),id])).rows[0].result;
 const first=await call(data,items,request);assert.match(first.po_number,/^OC-AVH-/);assert.equal(first.total,1650);
 assert.deepEqual(await call(data,items,request),first,'same request recovers the existing numbered OC');
 const p=(await f.owner('select * from purchases where id=$1',[first.purchase_id])).rows[0];
 assert.equal(p.purchase_type,'service');assert.equal(p.status,'approved');assert.equal(p.destination_type,'direct');assert.equal(p.warehouse_id,null);assert.equal(p.purchase_confirmed_at,null);assert.equal(p.source_document_kind,'quotation');
 for(const table of ['equipment_assets','repair_orders','repair_assets','products','movements','purchase_receipts'])assert.equal((await f.owner('select count(*)::int n from '+table)).rows[0].n,0,table+' remains empty');
 const lines=(await f.owner('select * from purchase_items where purchase_id=$1',[p.id])).rows;assert.equal(lines.length,3);assert.ok(lines.every(i=>!i.affects_inventory&&i.product_id===null));
 let document=(await f.q('select public.admin_purchase_order_document($1) result',[p.id])).rows[0].result;
 assert.equal(document.payload.total,1650);assert.equal(document.payload.subtotal,1500);assert.equal(document.payload.tax_amount,150);assert.equal(document.payload.items.length,2,'IVA is not counted twice in the normal editor');
 document.payload.items.find(i=>i.description===items[0].description).unit_price=2000;
 document=(await f.q('select public.admin_save_purchase_order_document($1,$2,$3,$4) result',[p.id,JSON.stringify(document.payload),document.version,randomUUID()])).rows[0].result;
 assert.equal(document.payload.total,2750);assert.equal(document.payload.tax_amount,250);assert.equal(document.payload.items.length,2);assert.equal((await f.owner('select count(*)::int n from purchases')).rows[0].n,1);
 await assert.rejects(call({...data,source_total:999},items,request),/datos distintos/);
 for(const role of ['dep','production','inactive']){await f.as(role);await assert.rejects(call(),/Solo Compras/);}await f.as();
 for(const patch of [{company_id:null},{supplier_id:null},{currency:''},{tax_mode:''},{tax_rate:null},{source_total:1600}])await assert.rejects(call({...data,...patch}));
 await assert.rejects(call(data,[{...items[0],unit_price:null}]));assert.equal((await f.owner('select count(*)::int n from purchases')).rows[0].n,1,'invalid budgets create nothing');
 const usd=await call({...data,currency:'USD',tax_mode:'included',tax_rate:null,source_total:0.68,machine_name:'Soldadora sin identificar',serial_number:''},[{description:'Diagnóstico',quantity:2,unit:'hora',unit_price:0.335},{description:'Insumo instalado',quantity:1,unit:'unidad',unit_price:0.01,affects_inventory:true}]);
 const usdDoc=(await f.q('select public.admin_purchase_order_document($1) result',[usd.purchase_id])).rows[0].result;assert.equal(usdDoc.payload.total,0.68);assert.equal(usdDoc.payload.tax_mode,'included');assert.match(usdDoc.payload.notes,/Máquina: Soldadora sin identificar/);assert.doesNotMatch(usdDoc.payload.notes,/Serie:/);
 assert.equal((await f.owner('select count(*)::int n from purchase_items where affects_inventory')).rows[0].n,0);
});

test('accidental repair drafts can be deleted with their files, stale edits and approved OCs remain protected',async t=>{
 const f=await repairFixture();t.after(()=>f.db.close());
 const draft=await f.order(f.payload([])),request=randomUUID(),path=draft.id+'/quote/test/accidental.pdf';
 await f.owner('grant delete on storage.objects to authenticated');
 await f.owner("insert into storage.objects(bucket_id,name) values('repair-documents',$1)",[path]);await f.command('attachment',{order_id:draft.id,kind:'quote',path,file_name:'accidental.pdf'});
 const remove=async(o=draft,id=request)=>(await f.q('select public.admin_delete_repair_draft($1,$2,$3) result',[o.id,o.version,id])).rows[0].result;
 for(const role of ['dep','production','inactive']){await f.as(role);await assert.rejects(remove(),/Solo Compras/);}await f.as();
 await assert.rejects(remove({...draft,version:999},randomUUID()),/cambió/);
 // Existing evidence is protected until the unissued draft has been explicitly removed.
 assert.equal((await f.q("delete from storage.objects where bucket_id='repair-documents' and name=$1 returning name",[path])).rows.length,0);
 const deleted=await remove();assert.deepEqual(deleted.file_paths,[path]);assert.deepEqual(await remove(),deleted,'retry recovers the same deletion');await assert.rejects(f.document(draft.id),/inexistente/);
 assert.equal((await f.owner('select count(*)::int n from repair_attachments where order_id=$1',[draft.id])).rows[0].n,0);
 assert.equal((await f.q("delete from storage.objects where bucket_id='repair-documents' and name=$1 returning name",[path])).rows.length,1);
 const audit=(await f.owner("select detail from audit_events where entity_id=$1 and action='repair_draft_deleted'",[draft.id])).rows[0].detail;assert.equal(audit.order.number,draft.number);assert.equal(audit.attachments[0].file_name,'accidental.pdf');
 await assert.rejects(f.command('save',{order_id:draft.id,expected_version:draft.version,payload:draft.payload}),/fue eliminado/);
 let cancelled=await f.order(f.payload([]));cancelled=await f.action(cancelled,'cancel',{reason:'Presupuesto subido por error'});assert.equal((await remove(cancelled,randomUUID())).order_id,cancelled.id);
 const asset=await f.asset(),approved=await f.approved(f.payload([asset]));await assert.rejects(remove(approved,randomUUID()),/sin OC/);assert.equal((await f.document(approved.id)).purchase_id,approved.purchase_id);
});
