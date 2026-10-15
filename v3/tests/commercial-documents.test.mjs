import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {randomUUID,webcrypto} from 'node:crypto';
import {database} from './fixtures/commercial-database.mjs';
import * as pdfLib from 'pdf-lib';
import {makeCommercialPdf} from '../edge-functions/_shared/commercial-pdf.mjs';
import {makeWorkOrderPdf} from '../edge-functions/_shared/work-order-pdf.mjs';
import {wrapText} from '../edge-functions/_shared/document-layout.mjs';
import {validateCommercialCopy} from '../edge-functions/_shared/commercial-copy.mjs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const ctx={Intl,Date,crypto:webcrypto};ctx.window=ctx;vm.runInNewContext(read('../src/features/work-orders/commercial-model.js'),ctx);const M=ctx.AVHCommercialModel;
const company={legal_name:'Astillero Villa Hayes S.A.',tax_id:'80091371-0',name:'AVH',address:'Villa Hayes',phone:'Contacto',email:'compras@example.test'};
const payload=()=>({...M.draft('quote',null,{username:'Galo'}),recipient_name:'Cliente naval',title:'Reparación de estructura',document_date:'2026-10-15',valid_until:'2026-11-15',currency:'USD',tax_mode:'add',tax_rate:10,payment_terms:'Contado',delivery_terms:'Según alcance acordado',items:[{id:'item-1',description:'Chapa naval 12.7 mm',quantity:3,unit:'unidad',unit_price:.335}]});
test('Commercial authority, exact totals, immutable snapshots and central purchase-order numbering',async t=>{
 const db=await database(),ids={admin:randomUUID(),galo:randomUUID(),other:randomUUID(),depositor:randomUUID(),wh:randomUUID(),supplier:randomUUID(),company:randomUUID()};
 const q=(sql,args=[])=>db.query(sql,args),login=async id=>{await db.exec('reset role');await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,role:'authenticated'})]);await db.exec('set role authenticated');};
 const cmd=async(action,data,requestId=randomUUID())=>(await q('select commercial_command($1,$2::jsonb,$3::uuid) result',[action,JSON.stringify(data),requestId])).rows[0].result;
 const get=async id=>(await q('select commercial_document($1) d',[id])).rows[0].d;
 let quote=randomUUID(),oc=randomUUID();
 try{
  await q('insert into auth.users(id) select unnest($1::uuid[])',[[ids.admin,ids.galo,ids.other,ids.depositor]]);await q("insert into warehouses(id,code,name) values($1,'VH','Villa Hayes')",[ids.wh]);
  await q("insert into profiles(id,username,role,warehouse_id,active) values($1,'compras','admin',null,true),($2,'galo','production',null,true),($3,'otra.produccion','production',null,true),($4,'deposito','depositor',$5,true)",[ids.admin,ids.galo,ids.other,ids.depositor,ids.wh]);
  await q("insert into work_order_access(user_id,access_level,granted_by) values($1,'editor',$3),($2,'editor',$3)",[ids.galo,ids.other,ids.admin]);
  await q('insert into purchase_companies(id,name,legal_name,tax_id,po_prefix) values($1,$2,$3,$4,$5)',[ids.company,'AVH',company.legal_name,company.tax_id,'OC']);await q('insert into suppliers(id,name,tax_id) values($1,$2,$3)',[ids.supplier,'Proveedor de prueba','123-4']);
  await t.test('drafts preserve pending prices; access is scoped and financial values are recomputed',async()=>{
   await login(ids.galo);const p=payload();p.items[0].unit_price=null;const data={document_id:quote,kind:'quote',payload:{...p,total:999,company:{legal_name:'Empresa falsa'}}},req=randomUUID();const saved=await cmd('save',data,req);assert.deepEqual(await cmd('save',data,req),saved);
   assert.equal((await get(quote)).payload.items[0].unit_price,null);assert.equal((await get(quote)).payload.company,undefined);await assert.rejects(cmd('issue',{document_id:quote,expected_version:1}),/cantidad y precio/);
   await login(ids.other);assert.equal((await q('select * from commercial_documents')).rows.length,0);await assert.rejects(get(quote),/sin acceso/);await assert.rejects(cmd('save',{...data,expected_version:1}),/sin acceso/);
   await login(ids.depositor);await assert.rejects(q('select commercial_context()'),/No autorizado/);await assert.rejects(cmd('save',data),/No autorizado/);
  });
  await t.test('quotes are numbered once, server and client agree on decimal rounding and issued scope is frozen',async()=>{
   await login(ids.galo);const p=payload();await cmd('save',{document_id:quote,kind:'quote',expected_version:1,payload:p});const req=randomUUID(),data={document_id:quote,expected_version:2},result=await cmd('issue',data,req);assert.equal(result.number,'PRE-AVH-2026-00001');assert.deepEqual(await cmd('issue',data,req),result);
   const d=await get(quote),total=M.totals(p);assert.equal(Number(d.issued_payload.total),total.total);assert.equal(Number(d.issued_payload.total),1.11);assert.equal(d.issued_payload.company.tax_id,company.tax_id);
   await assert.rejects(cmd('save',{document_id:quote,kind:'quote',expected_version:3,payload:p}),/borrador/);await assert.rejects(q('update commercial_documents set number=$1 where id=$2',['FAKE',quote]),/permission/);
   const round=payload();round.items=[{...round.items[0],unit_price:.005,quantity:1},{...round.items[0],id:'item-2',unit_price:.005,quantity:1}];round.tax_mode='none';const id=randomUUID();await cmd('save',{document_id:id,kind:'quote',payload:round});const canonical=(await get(id)).payload;assert.equal(canonical.rounding_adjustment,-.01);assert.equal(canonical.total,.01);assert.equal(M.totals(round).total,.01);
  });
  await t.test('Only Administration can create, view and issue OC into the central purchase flow',async()=>{
   const p=payload();p.supplier_id=ids.supplier;p.recipient_name='Proveedor de prueba';p.items[0].unit_price=12.5;
   assert.equal((await q('select commercial_context() c')).rows[0].c.suppliers.length,0);
   await assert.rejects(cmd('save',{document_id:oc,kind:'purchase_order',payload:p}),/Solo Administración/);
   await login(ids.admin);await cmd('save',{document_id:oc,kind:'purchase_order',payload:p});
   await login(ids.galo);assert.equal((await q("select * from commercial_documents where kind='purchase_order'")).rows.length,0);await assert.rejects(get(oc),/sin acceso/);await assert.rejects(cmd('issue',{document_id:oc,expected_version:1}),/sin acceso/);
   await login(ids.admin);const req=randomUUID(),data={document_id:oc,expected_version:1};const issued=await cmd('issue',data,req);assert.equal(issued.number,'OC-2026-00001');assert.ok(issued.purchase_id);assert.deepEqual(await cmd('issue',data,req),issued);
   await db.exec('reset role');const purchase=(await q('select * from purchases where id=$1',[issued.purchase_id])).rows[0];assert.equal(purchase.po_number,issued.number);assert.equal(purchase.status,'approved');const rows=(await q('select * from purchase_items where purchase_id=$1',[issued.purchase_id])).rows;assert.equal(rows.length,2);assert.ok(rows.every(i=>i.affects_inventory===false));assert.equal(rows.reduce((s,i)=>s+Number(i.quantity)*Number(i.unit_price),0),41.25);assert.equal((await q('select count(*)::int n from inventory_batches')).rows[0].n,0);
   await login(ids.admin);await assert.rejects(cmd('cancel',{document_id:oc,expected_version:2,reason:'Cancelar prueba'}),/Compras/);await login(ids.galo);
  });
  await t.test('invalid values, concurrent edits, inactive users and revocation fail closed',async()=>{
   const id=randomUUID(),p=payload();await cmd('save',{document_id:id,kind:'quote',payload:p});await assert.rejects(cmd('save',{document_id:id,kind:'quote',expected_version:99,payload:p}),/cambió/);
   await assert.rejects(cmd('save',{document_id:randomUUID(),kind:'quote',payload:{...p,items:[{...p.items[0],quantity:-1}]}}),/Cantidad/);
   await db.exec('reset role');await q('update profiles set active=false where id=$1',[ids.galo]);await login(ids.galo);assert.equal((await q('select * from commercial_documents')).rows.length,0);await assert.rejects(get(quote),/No autorizado/);
   await db.exec('reset role');assert.equal((await q("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'commercial_%' and p.prosecdef")).rows[0].n,0);
  });
 }finally{await db.close();}
});
function printedText(doc){return doc.getPages().flatMap(p=>p.node.Contents().asArray().flatMap(ref=>[...new TextDecoder().decode(pdfLib.decodePDFRawStream(doc.context.lookup(ref)).decode()).matchAll(/<([0-9A-F]+)>\s*Tj/g)].map(m=>Buffer.from(m[1],'hex').toString('latin1')))).join(' ');}
test('All document fields wrap, overlong words split, long rows paginate, and every PDF embeds the institutional logo',async()=>{
 const p=payload();p.company=company;p.title='TÍTULO '.repeat(60);p.recipient_name='CLIENTE '.repeat(50);p.location='LUGAR '.repeat(60);p.items=[{...p.items[0],description:'DESCRIPCIÓN '.repeat(600)+'ULTIMO-MARCADOR'}];Object.assign(p,M.totals(p));
 const document=await pdfLib.PDFDocument.load(await makeCommercialPdf({kind:'quote',status:'issued',number:'PRE-AVH-2026-00001',issued_payload:p},pdfLib));assert.ok(document.getPageCount()>1);assert.match(printedText(document),/ULTIMO-MARCADOR/);assert.match(printedText(document),/TOTAL USD/);assert.ok(document.getPages().every(page=>page.node.Resources().lookup(pdfLib.PDFName.of('XObject')).keys().length>0));
 const font=await document.embedFont(pdfLib.StandardFonts.HelveticaBold);for(const line of wrapText('EXTREMADAMENTE'.repeat(200),font,10,40))assert.ok(font.widthOfTextAtSize(line,10)<=40);
 const ot=await pdfLib.PDFDocument.load(await makeWorkOrderPdf({status:'draft',payload:{title:'OT '.repeat(100),vessel:'NAVAL '.repeat(100),client:'Cliente',responsible:'Responsable '.repeat(25),location:'Lugar '.repeat(100),tasks:[{sector:'SECTOR'.repeat(100),description:'TAREA '.repeat(500)+'FIN-TRABAJO',quantity:1,unit:'unidad'}]}},pdfLib));assert.match(printedText(ot),/FIN-TRABAJO/);assert.ok(ot.getPageCount()<10);
});
test('AI only proposes wording; numeric references, complete item coverage and all commercial values remain controlled',()=>{
 const p=payload(),s={title:'Presupuesto de reparación',introduction:'Presentamos el alcance indicado.',items:[{id:'item-1',description:'Suministro de chapa naval de 12.7 mm'}]};assert.equal(validateCommercialCopy(p,s).items[0].id,'item-1');assert.throws(()=>validateCommercialCopy(p,{...s,items:[{id:'item-1',description:'Chapa de 20 mm'}]}),/numérica/);assert.throws(()=>validateCommercialCopy(p,{...s,items:[]}),/incompleta/);
 const source={id:randomUUID(),number:'OT-AVH-2026-00001',payload:{vessel:'TEST',client:'Cliente',tasks:[{sector:'Popa',description:'Chapa',quantity:2,unit:'unidad',thickness_mm:12.7,materials:[{description:'Insumo',unit:'kg',quantity:3,confirmed:true},{description:'Insumo',unit:'kg',quantity:null,confirmed:false}]}]}};
 assert.equal(M.draft('quote',source,{username:'Galo'}).items[0].unit_price,null);assert.equal(M.draft('purchase_order',source,{username:'Galo'}).items[0].quantity,null);
});
