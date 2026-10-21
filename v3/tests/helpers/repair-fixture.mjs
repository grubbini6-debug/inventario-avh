import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {database} from '../fixtures/commercial-database.mjs';
export const migration='20261021135654_equipment_repairs.sql';
export async function repairFixture(){
 const db=await database(),q=(sql,args=[])=>db.query(sql,args),ids=Object.fromEntries(['admin','dep','production','inactive','warehouse','other','supplier','company'].map(k=>[k,randomUUID()]));
 await db.exec(fs.readFileSync(new URL('../../migrations/'+migration,import.meta.url),'utf8'));
 for(const table of ['suppliers','purchase_companies'])await db.exec(`alter table public.${table} enable row level security;grant select on public.${table} to authenticated;create policy repair_fixture_catalog_read on public.${table} for select to authenticated using(public.current_profile_role()='admin');`);
 for(const role of ['admin','dep','production','inactive'])await q('insert into auth.users(id) values($1)',[ids[role]]);
 await q("insert into warehouses(id,code,name) values($1,'TEST','Depósito de prueba'),($2,'OTHER','Otro depósito')",[ids.warehouse,ids.other]);
 for(const role of ['admin','dep','production','inactive'])await q('insert into profiles(id,username,full_name,role,warehouse_id,active) values($1,$2,$2,$3,$4,$5)',[ids[role],role,role==='dep'?'depositor':role==='inactive'?'admin':role,role==='dep'?ids.warehouse:null,role!=='inactive']);
 await q("insert into suppliers(id,name,tax_id) values($1,'Taller de prueba','80000000-0')",[ids.supplier]);
 await q("insert into purchase_companies(id,name,legal_name,tax_id,po_prefix) values($1,'AVH','Astillero Villa Hayes S.A.','80000000-1','OC-AVH')",[ids.company]);
 async function as(role='admin'){await db.exec('reset role');await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:ids[role]||role,role:'authenticated'})]);await db.exec('set role authenticated');}
 await as();
 async function owner(sql,args=[]){await db.exec('reset role');try{return await q(sql,args);}finally{await as();}}
 async function command(action,data,requestId=randomUUID()){return(await q('select public.repair_command($1,$2::jsonb,$3::uuid) as result',[action,JSON.stringify(data),requestId])).rows[0].result;}
 async function document(orderId){return(await q('select public.repair_document($1::uuid) as result',[orderId])).rows[0].result;}
 let sequence=0;
 async function asset(overrides={}){const id=randomUUID();await command('asset_save',{equipment_id:id,expected_version:null,asset:{code:'MIG-'+(++sequence),name:'Soldadora MIG',brand:'Marca de prueba',model:'400',serial_number:'SERIE-'+id,warehouse_id:ids.warehouse,company_id:ids.company,status:'available',...overrides}});return id;}
 function payload(equipment,overrides={}){const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Asuncion'}).format(new Date());return{warehouse_id:ids.warehouse,company_id:ids.company,supplier_id:ids.supplier,problem:'Falla en alimentación de alambre',quote_number:'PRES-21',quote_date:day,currency:'PYG',tax_mode:'add',tax_rate:10,source_total:null,warranty_days:30,reviewed:true,items:equipment.map((id,n)=>({equipment_id:id,kind:n?'part':'labor',description:n?'Repuesto instalado':'Reparación de alimentador',quantity:1,unit_price:n?500:1000})),...overrides};}
 async function order(p){const id=randomUUID();await command('save',{order_id:id,expected_version:null,payload:p});return document(id);}
 async function action(o,name,extra={},req){const r=await command(name,{order_id:o.id,expected_version:o.version,...extra},req);return document(r.order_id);}
 const approve=(o)=>action(o,'approve',{authorized_by:'Dirección de prueba',authorization_reference:'Correo de autorización QA',authorization_received:true});
 async function approved(p){let o=await order(p);o=await action(o,'submit');return approve(o);}
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Asuncion'}).format(new Date());
 async function dispatch(o,eid){return action(o,'dispatch',{equipment_id:eid,date:day,mode:'workshop',condition:'No alimenta alambre',accessories:'Torcha y cable de masa',carrier:'Transportista de prueba',plate:'TEST-001',expected_return:day});}
 async function receive(o,eid){return action(o,'receive',{equipment_id:eid,date:day,received_by:'Depositario de prueba',condition:'Recibido completo',warranty_until:day});}
 async function test(o,eid,result='passed'){return action(o,'test',{equipment_id:eid,date:day,responsible:'Técnico de prueba',result,observations:'Prueba de soldadura con carga'});}
 async function ready(o){for(const c of o.assets){o=await dispatch(o,c.equipment_id);o=await receive(o,c.equipment_id);o=await test(o,c.equipment_id);}return o;}
 function invoice(o,overrides={}){return{number:'FACT-001',date:day,currency:o.currency,total:o.approved_total,allocations:o.assets.map(c=>({equipment_id:c.equipment_id,amount:c.approved_amount})),...overrides};}
 return{db,q,owner,ids,as,command,document,asset,payload,order,action,approve,approved,dispatch,receive,test,ready,invoice,day};
}
