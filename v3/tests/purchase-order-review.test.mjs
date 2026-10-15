import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {database} from './fixtures/commercial-database.mjs';

test('OC review saves every printed field, preserves stock history and rejects Production and stale edits',async t=>{
 const db=await database(),ids=Object.fromEntries(['admin','galo','depositor','company','supplier','warehouse','purchase','item','product'].map(k=>[k,randomUUID()]));
 const q=(sql,args=[])=>db.query(sql,args);
 const login=async id=>{await db.exec('reset role');await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,role:'authenticated'})]);await db.exec('set role authenticated');};
 const get=async()=>(await q('select admin_purchase_order_document($1) d',[ids.purchase])).rows[0].d;
 const save=async(d,payload,request=randomUUID())=>(await q('select admin_save_purchase_order_document($1,$2,$3,$4) d',[ids.purchase,JSON.stringify(payload),d.version,request])).rows[0].d;
 try{
  await q('insert into auth.users(id) select unnest($1::uuid[])',[[ids.admin,ids.galo,ids.depositor]]);
  await q("insert into warehouses(id,code,name) values($1,'VH','Villa Hayes')",[ids.warehouse]);
  await q("insert into profiles(id,username,full_name,role,active,warehouse_id) values($1,'compras','Gabriel','admin',true,null),($2,'galo','Galo','production',true,null),($3,'deposito','Depósito','depositor',true,$4)",[ids.admin,ids.galo,ids.depositor,ids.warehouse]);
  await q("insert into work_order_access(user_id,access_level,granted_by) values($1,'editor',$2)",[ids.galo,ids.admin]);
  await q("insert into purchase_companies(id,name,legal_name,tax_id,po_prefix) values($1,'AVH','Astillero Villa Hayes S.A.','80091371-0','OC')",[ids.company]);
  await q("insert into suppliers(id,name,tax_id) values($1,'Proveedor original','123-4')",[ids.supplier]);
  await q("insert into products(id,name,base_unit,active) values($1,'Chapa','kg',true)",[ids.product]);
  await q("insert into purchases(id,company_id,supplier_id,created_by,status,currency,destination_type,warehouse_id,po_number,payment_terms,requester) values($1,$2,$3,$4,'approved','USD','warehouse',$5,'OC-2026-10001','Contado','Gabriel')",[ids.purchase,ids.company,ids.supplier,ids.admin,ids.warehouse]);
  await q("insert into purchase_items(id,purchase_id,description,quantity,unit,unit_price,product_id,affects_inventory) values($1,$2,'Chapa original',10,'kg',2,$3,true)",[ids.item,ids.purchase,ids.product]);
  await login(ids.admin);let d=await get();
  await t.test('all header and recipient fields, items and taxes persist to the PDF source and the purchase',async()=>{
   const p={...d.payload,document_number:'OC-AVH-EDITADA-10001',title:'Compra técnica revisada',document_date:'2026-10-14',recipient_name:'Razón social corregida',recipient_tax_id:'999-1',recipient_address:'Calle proveedor 100',recipient_contact:'Contacto corregido',reference:'Referencia revisada',location:'Dirección de entrega revisada',delivery_date:'2026-11-01',issuer_name:'Gabriel Ortega',payment_terms:'Crédito 30 días',delivery_terms:'Entregas parciales coordinadas',introduction:'Alcance revisado',notes:'Observación revisada',tax_mode:'add',tax_rate:10,company:{...d.payload.company,legal_name:'Astillero Villa Hayes S.A. - Compras',tax_id:'80091371-0',address:'Dirección emisora corregida',phone:'021123456',email:'compras@example.test'},items:[{...d.payload.items[0],description:'Chapa naval 7.9 mm',quantity:5,unit_price:3}]};
   const request=randomUUID(),saved=await save(d,p,request);assert.equal(saved.number,p.document_number);assert.equal(saved.payload.recipient_name,p.recipient_name);assert.equal(saved.payload.company.address,p.company.address);assert.equal(saved.payload.document_date,p.document_date);assert.equal(saved.payload.delivery_terms,p.delivery_terms);assert.equal(saved.payload.total,16.5);assert.equal(saved.payload.items[0].amount,15);assert.equal(saved.payload.items.length,1);
   assert.deepEqual(await save(d,p,request),saved);await assert.rejects(save(d,p),/cambió/);
   await db.exec('reset role');const rows=(await q('select description,quantity,unit_price from purchase_items where purchase_id=$1',[ids.purchase])).rows;assert.equal(rows.length,2);assert.equal(rows.reduce((sum,x)=>sum+Number(x.quantity)*Number(x.unit_price),0),16.5);assert.equal((await q("select count(*)::int n from audit_events where action='purchase_order_review_saved'")).rows[0].n,1);assert.equal((await q('select name from suppliers where id=$1',[ids.supplier])).rows[0].name,'Proveedor original');await login(ids.admin);d=await get();
  });
  await t.test('adding and removing pending rows works; invalid values and foreign lines roll back the whole save',async()=>{
   const p=structuredClone(d.payload),newId=randomUUID();p.items.push({id:newId,description:'Servicio adicional',quantity:1,unit:'servicio',unit_price:7,affects_inventory:false,factor_to_base:1});d=await save(d,p);assert.equal(d.payload.items.length,2);assert.equal(d.payload.total,24.2);
   p.items=p.items.filter(x=>x.id!==newId);d=await save(d,p);assert.equal(d.payload.items.length,1);assert.equal(d.payload.total,16.5);
   const invalid=structuredClone(d.payload);invalid.items[0].unit_price=-1;await assert.rejects(save(d,invalid),/Precio inválido/);assert.equal((await get()).version,d.version);
   invalid.items[0].unit_price=1;invalid.company.id=randomUUID();await assert.rejects(save(d,invalid),/empresa emisora/);assert.equal((await get()).version,d.version);
  });
  await t.test('OC prepared in Documents retains editable issuer and recipient details and syncs later review edits',async()=>{
   const documentId=randomUUID(),p=structuredClone(d.payload);p.document_number='OC-AVH-DOCUMENTOS';p.recipient_name='Proveedor para imprimir';p.company.address='Dirección particular de esta OC';p.notes='Nota para proveedor';
   const command=async(action,data)=>(await q('select commercial_command($1,$2,$3) d',[action,JSON.stringify(data),randomUUID()])).rows[0].d;
   await command('save',{document_id:documentId,kind:'purchase_order',payload:p});const issued=await command('issue',{document_id:documentId,expected_version:1});assert.equal(issued.number,p.document_number);
   let review=(await q('select admin_purchase_order_document($1) d',[issued.purchase_id])).rows[0].d;assert.equal(review.payload.company.address,p.company.address);assert.equal(review.payload.recipient_name,p.recipient_name);assert.equal(review.payload.items.length,1);assert.equal(review.payload.total,16.5);assert.equal(review.payload.notes,p.notes);
   const changed={...review.payload,recipient_name:'Proveedor corregido otra vez',notes:'Observación definitiva'};
   review=(await q('select admin_save_purchase_order_document($1,$2,$3,$4) d',[issued.purchase_id,JSON.stringify(changed),review.version,randomUUID()])).rows[0].d;
   const snapshot=(await q('select commercial_document($1) d',[documentId])).rows[0].d;assert.equal(snapshot.issued_payload.recipient_name,changed.recipient_name);assert.equal(snapshot.issued_payload.notes,changed.notes);assert.equal(snapshot.issued_payload.total,16.5);
  });
  await t.test('receipts cannot be deleted or repriced; a changed pending balance splits safely and IVA follows actual prices',async()=>{
   await db.exec('reset role');await q('update purchase_items set received_qty=2 where id=$1',[ids.item]);await q("update purchases set status='partially_received' where id=$1",[ids.purchase]);await login(ids.admin);d=await get();
   const p=structuredClone(d.payload);p.items[0].quantity=1;await assert.rejects(save(d,p),/debajo/);assert.equal((await get()).version,d.version);
   p.items[0].quantity=5;p.items[0].unit_price=4;d=await save(d,p);assert.equal(d.payload.items.length,2);assert.equal(d.payload.subtotal,18);assert.equal(d.payload.tax_amount,1.8);assert.equal(d.payload.total,19.8);
   await db.exec('reset role');const original=(await q('select quantity,received_qty,unit_price from purchase_items where id=$1',[ids.item])).rows[0];assert.equal(Number(original.quantity),2);assert.equal(Number(original.received_qty),2);assert.equal(Number(original.unit_price),3);const total=(await q('select sum(quantity*unit_price) total from purchase_items where purchase_id=$1',[ids.purchase])).rows[0].total;assert.equal(Number(total),19.8);await login(ids.admin);
   const missing=structuredClone(d.payload);missing.items=missing.items.filter(i=>i.id!==ids.item);await assert.rejects(save(d,missing),/recepción/);assert.equal((await get()).version,d.version);
  });
  await t.test('an OC with incomplete company catalog details opens and can be completed inside the review',async()=>{
   await db.exec('reset role');const company=randomUUID(),purchase=randomUUID();await q("insert into purchase_companies(id,name) values($1,'EMPRESA SIN DATOS FISCALES')",[company]);await q("insert into purchases(id,company_id,supplier_id,created_by,status,currency,destination_type,po_number) values($1,$2,$3,$4,'approved','USD','direct','OC-INCOMPLETA')",[purchase,company,ids.supplier,ids.admin]);await q("insert into purchase_items(purchase_id,description,quantity,unit,unit_price) values($1,'Servicio',1,'servicio',10)",[purchase]);await login(ids.admin);
   const review=(await q('select admin_purchase_order_document($1) d',[purchase])).rows[0].d;assert.equal(review.payload.company.tax_id,'');
   const p={...review.payload,payment_terms:'Contado',delivery_terms:'A coordinar'};await assert.rejects(q('select admin_save_purchase_order_document($1,$2,$3,$4)',[purchase,JSON.stringify(p),review.version,randomUUID()]),/RUC/);
   p.company.legal_name='Empresa emisora corregida';p.company.tax_id='999-1';const saved=(await q('select admin_save_purchase_order_document($1,$2,$3,$4) d',[purchase,JSON.stringify(p),review.version,randomUUID()])).rows[0].d;assert.equal(saved.payload.company.legal_name,p.company.legal_name);assert.equal(saved.payload.company.tax_id,'999-1');
  });
  await t.test('Production, Deposit and inactive accounts cannot open, edit or issue an OC',async()=>{
   for(const id of [ids.galo,ids.depositor]){await login(id);await assert.rejects(get(),/Solo Administración/);await assert.rejects(save(d,d.payload),/Solo Administración/);await assert.rejects(q('select admin_prepare_purchase_order($1)',[ids.purchase]),/administrador/);}
   await db.exec('reset role');await q('update profiles set active=false where id=$1',[ids.admin]);await login(ids.admin);await assert.rejects(get(),/Solo Administración/);
  });
 }finally{await db.close();}
});
