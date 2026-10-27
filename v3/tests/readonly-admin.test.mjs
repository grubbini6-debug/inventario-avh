import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {JSDOM} from 'jsdom';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const migration=read('../migrations/20261027150734_admin_readonly_profile.sql');

test('Viewer reads every warehouse and registered files but cannot write through RLS, privileged functions or Storage; revocation is immediate',async()=>{
 const db=new PGlite(),id=Object.fromEntries(['admin','viewer','deposit','vh','ac','product','company','purchase','doc','file','unknown'].map(k=>[k,randomUUID()]));
 const q=(sql,args=[])=>db.query(sql,args);
 const login=async user=>{await db.exec('reset role');await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user,role:'authenticated'})]);await db.exec('set role authenticated');};
 try{
  await db.exec(read('./fixtures/fabrication-inventory.sql'));
  for(const file of ['20261014194409_ordenes_trabajo_galo.sql','20261015105130_perfil_produccion_ordenes_trabajo.sql','20261015113424_lugar_produccion_inventario_consulta.sql'])await db.exec(read('../migrations/'+file));
  await db.exec(`alter table movement_lines add column naval_section text,add column naval_module text;
   create table fabrication_attachments(id uuid primary key default gen_random_uuid(),file_path text);
   create function public.complete_password_change() returns void language plpgsql security definer set search_path='' as $$begin
    if auth.uid() is null then raise exception 'No autenticado';end if;
    update public.profiles set must_change_password=false,password_changed_at=now() where id=auth.uid() and active;
   end$$;
   create function public.viewer_write_probe() returns void language plpgsql security definer set search_path='' as $$begin insert into public.suppliers(name) values('No autorizado');end$$;
   grant insert,update,delete on products,suppliers,profiles,storage.objects to authenticated;
   create policy test_broad_products on products for all to authenticated using(true) with check(true);
   alter table suppliers enable row level security;create policy test_broad_suppliers on suppliers for all to authenticated using(true) with check(true);
   create policy test_broad_profiles on profiles for all to authenticated using(true) with check(true);
   create policy test_broad_storage_write on storage.objects for insert to authenticated with check(true);
  `);
  await db.exec(migration);
  await q('insert into auth.users(id) select unnest($1::uuid[])',[[id.admin,id.viewer,id.deposit]]);
  await q("insert into warehouses(id,code,name) values($1,'VH','Villa Hayes'),($2,'AC','ACOMAR')",[id.vh,id.ac]);
  await q("insert into profiles(id,username,role,warehouse_id) values($1,'admin.prueba','admin',null),($2,'admin.consulta','admin_viewer',null),($3,'deposito.prueba','depositor',$4)",[id.admin,id.viewer,id.deposit,id.vh]);
  await q("insert into products(id,name,base_unit) values($1,'Alambre','kg')",[id.product]);
  await q("insert into purchase_companies(id,name) values($1,'AVH')",[id.company]);
  await q('insert into purchases(id,company_id,warehouse_id,created_by) values($1,$2,$3,$4)',[id.purchase,id.company,id.ac,id.admin]);
  await q("insert into purchase_documents(id,purchase_id,kind,file_path,file_name,uploaded_by) values($1,$2,'invoice',$3,'Factura.pdf',$4)",[id.doc,id.purchase,id.purchase+'/factura.pdf',id.admin]);
  await q("insert into storage.objects(id,bucket_id,name) values($1,'purchase-documents',$2),($3,'purchase-documents','no-registrado.pdf')",[id.file,id.purchase+'/factura.pdf',id.unknown]);
  await login(id.admin);
  for(const warehouse of [id.vh,id.ac])await q('select record_entry($1,null,null,$2::jsonb,null)',[warehouse,JSON.stringify([{product_id:id.product,quantity:10,unit:'kg',factor_to_base:1,unit_cost:7,currency:'USD',request_id:randomUUID()}])]);
  await login(id.viewer);
  assert.equal((await q('select current_profile_role() role')).rows[0].role,'admin_viewer');
  assert.equal((await q('select can_access_warehouse($1) allowed',[id.ac])).rows[0].allowed,false);
  assert.equal((await q('select * from purchases')).rows.length,1);
  assert.equal((await q('select * from inventory_batches')).rows.length,2);
  assert.equal((await q('select * from v_stock_by_warehouse')).rows.length,2);
  assert.equal((await q('select * from storage.objects')).rows.length,1);
  for(const sql of ["insert into products(name,base_unit) values('Alta','kg')","insert into suppliers(name) values('Alta')","select viewer_write_probe()","insert into storage.objects(bucket_id,name) values('purchase-documents','nuevo.pdf')"])
   await assert.rejects(q(sql),/solo lectura|policy|permission/i);
  assert.equal((await q("update products set name='Editado' returning id")).rows.length,0);
  assert.equal((await q('delete from products returning id')).rows.length,0);
  assert.equal((await q("update profiles set role='admin' where id=$1 returning id",[id.viewer])).rows.length,0);
  await assert.rejects(q('select record_entry($1,null,null,$2::jsonb,null)',[id.vh,'[]']),/autoriz|permiso/i);
  await assert.rejects(q('select admin_update_readonly_user($1,false,null)',[id.viewer]),/administrador/i);
  await q('select complete_password_change()');assert.equal((await q('select must_change_password from profiles where id=$1',[id.viewer])).rows[0].must_change_password,false);
  await login(id.admin);await q('select admin_update_readonly_user($1,false,$2)',[id.viewer,'Administración']);
  await login(id.viewer);assert.equal((await q('select * from purchases')).rows.length,0);
  assert.equal((await q('select * from storage.objects')).rows.length,0);
  await assert.rejects(q('select viewer_write_probe()'),/solo lectura/);
  await login(id.admin);await q('select admin_update_readonly_user($1,true,null)',[id.viewer]);
  await q("insert into suppliers(name) values('Proveedor autorizado')");
  await login(id.deposit);assert.equal((await q('select * from inventory_batches')).rows.length,1);
  await db.exec('reset role');
  await q('update profiles set must_change_password=true where id=$1',[id.viewer]);
  await login(id.viewer);assert.equal((await q('select * from purchases')).rows.length,0);await q('select complete_password_change()');assert.equal((await q('select * from purchases')).rows.length,1);
  await db.exec('reset role');assert.equal((await q("select name from products where id=$1",[id.product])).rows[0].name,'Alambre');
  assert.equal((await q("select has_function_privilege('anon','admin_update_readonly_user(uuid,boolean,text)','execute') allowed")).rows[0].allowed,false);
 }finally{await db.close();}
});

const wait=async check=>{for(let i=0;i<200;i++){if(check())return;await new Promise(r=>setTimeout(r,10));}throw Error('Tiempo agotado esperando la interfaz');};
test('Administration can select, create, rename and deactivate a read-only administrator without assigning a warehouse',async()=>{
 const dom=new JSDOM('<div id="adminBox"></div><div id="modalBody"></div>',{url:'https://avh.test',runScripts:'outside-only'}),w=dom.window,calls=[];
 const admin={id:randomUUID(),role:'admin',username:'admin.prueba'},created={id:randomUUID(),username:'administracion.consulta',role:'admin_viewer',warehouse_id:null,full_name:'Administración',active:true,must_change_password:true};
 Object.assign(w,{$:s=>w.document.querySelector(s),$$:s=>[...w.document.querySelectorAll(s)],D:{profiles:[admin],warehouses:[{id:randomUUID(),name:'Villa Hayes',active:true}]},profile:admin,esc:s=>String(s??''),whName:()=> 'Villa Hayes',activeWhOptions:()=>'<option value="wh">Villa Hayes</option>',msg:(e,t)=>e.textContent=t,
  openModal:(t,s,html)=>w.document.querySelector('#modalBody').innerHTML=html,closeModal:()=>{},loadAll:async()=>{},renderAdmin:()=>w.adminUsers(),rpc:async(name,args)=>{calls.push({name,args});return{};},edge:async(name,args)=>{calls.push({name,args});w.D.profiles.push(created);return{data:{user:created}};}});
 try{
  w.eval(read('../src/features/admin/password-ux.js'));w.adminUsers();w.$('#newUserRole').value='admin_viewer';w.$('#newUserRole').onchange();
  assert.equal(w.$('#newUserWh').disabled,true);assert.equal(w.$('#newUserWarehouseField').hidden,true);assert.equal(w.$('#newProductionFields').hidden,true);
  w.$('#newUser').value=created.username;w.$('#newUserName').value=created.full_name;w.$('#continueCreateUser').onclick();w.$('#tempAccessKey').value='ClaveTemporal123';await w.$('#confirmCreateDepositor').onclick();
  assert.equal(calls[0].args.role,'admin_viewer');assert.equal(calls[0].args.warehouse_id,null);assert.equal(calls[0].args.inventory_warehouse_id,undefined);
  w.manageUser(created.id);assert.equal(w.$('#manageWh'),null);w.$('#manageFullName').value='Consulta Dirección';await w.$('#saveUserProfile').onclick();
  assert.equal(calls[1].name,'admin_update_readonly_user');assert.equal(calls[1].args.p_full_name,'Consulta Dirección');await w.$('#toggleUser').onclick();assert.equal(calls[2].args.p_active,false);
 }finally{w.close();}
});
test('Viewer boots into a query-only workspace, filters purchases, opens files, preserves search during refresh and blocks every command',async()=>{
 const dom=new JSDOM(read('../src/index.template.html'),{url:'https://grubbini6-debug.github.io/inventario-avh/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,calls=[],errors=[];
 const $=s=>w.document.querySelector(s);
 const user={id:randomUUID(),username:'admin.consulta',full_name:'Administración',role:'admin_viewer',warehouse_id:null,active:true,must_change_password:false};
 const purchase={id:randomUUID(),po_number:'OC-0123',company_id:'company',company_name:'AVH',supplier_id:'supplier',supplier_name:'Proveedor <naval>',status:'ordered',currency:'USD',total_amount:900,invoice_number:'001-001-0000123',ordered_date:'2026-10-27',created_at:'2026-10-27T10:00:00Z'};
 const doc={id:randomUUID(),purchase_id:purchase.id,kind:'invoice',file_name:'Factura.pdf',file_path:purchase.id+'/factura.pdf'};
 const tables={warehouses:[{id:'wh',name:'Villa Hayes'}],products:[{id:'p',name:'Alambre',base_unit:'kg'}],purchase_companies:[{id:'company',name:'AVH'}],suppliers:[{id:'supplier',name:'Proveedor <naval>'}],profiles:[user],v_purchase_overview:[purchase],purchases:[purchase],purchase_items:[{id:'item',purchase_id:purchase.id,description:'Alambre tubular',quantity:100,received_qty:10,unit_price:9,unit:'kg'}],purchase_documents:[doc],v_stock_by_warehouse:[{warehouse_id:'wh',product_id:'p',product_name:'Alambre',warehouse_name:'Villa Hayes',stock_qty:100,base_unit:'kg'}]};
 w.CSS={escape:s=>s};w.HTMLElement.prototype.scrollIntoView=function(){};
 w.console={...console,error:(...args)=>errors.push(args.join(' '))};
 w.WebSocket=class{static OPEN=1;static CONNECTING=0;constructor(){this.readyState=1;}send(){}close(){}};
 let opened;w.open=()=>opened={location:{href:''},close(){}};
 w.fetch=async(url,opt={})=>{
  const u=new URL(url),method=opt.method||'GET';calls.push({path:u.pathname,method,body:opt.body});
  if(u.pathname.startsWith('/storage/v1/object/sign/'))return Response.json({signedURL:'/object/sign/purchase-documents/'+doc.file_path+'?token=test'});
  if(u.pathname.startsWith('/rest/v1/rpc/'))return Response.json({workshops:[],access_level:null});
  const table=u.pathname.split('/').at(-1);return Response.json(tables[table]||[]);
 };
 w.localStorage.setItem('avh_v2_session',JSON.stringify({access_token:'viewer-test',expires_at:Date.now()+3600000,user:{id:user.id}}));
 try{
  const manifest=JSON.parse(read('../build-manifest.json'));
  w.eval([...manifest.core,...manifest.features,manifest.bootstrap].map(p=>read('../'+p)).join('\n;\n'));
  await wait(()=>w.document.documentElement.dataset.avhBoot==='ok');
  assert.deepEqual(errors,[]);assert.equal(w.document.querySelector('.page.on').id,'page-readonly');
  assert.match($('#sidebarRole').textContent,/Solo lectura/);assert.match($('#readonlyRows').textContent,/OC-0123/);
  assert.equal($('#readonlyRows').querySelector('naval'),null);
  assert.equal($('#page-readonly').querySelector('input[type=file],button[type=submit],textarea'),null);
  const search=$('#readonlySearch');search.value='tubular';search.oninput({target:search});assert.match($('#readonlyRows').textContent,/OC-0123/);
  await w.loadAll(true);assert.equal($('#readonlySearch'),search);assert.equal(search.value,'tubular');
  $('[data-readonly-open]').click();await wait(()=>$('[data-readonly-file]'));
  assert.match($('#modalBody').textContent,/Factura.pdf/);assert.match($('#modalBody').textContent,/Alambre tubular/);
  assert.equal($('#modalBody').querySelector('input,select,textarea,form'),null);
  $('[data-readonly-file]').click();await wait(()=>opened?.location.href.includes('token=test'));
  w.closeModal();await w.AVHReadonly.open('inventory');assert.match($('#readonlyRows').textContent,/100 kg/);
  await w.AVHReadonly.open('catalogs','profiles');assert.match($('#readonlyRows').textContent,/admin.consulta/);
  const start=calls.length;
  for(const code of ["insert('suppliers',{name:'X'})","patch('products','id=eq.p',{name:'X'})","rpc('admin_create_purchase',{})","rpc('work_order_command',{})","edge('admin-create-user',{})","request('/storage/v1/object/purchase-documents/x',{method:'POST',body:{}})"]){
   const result=await w.eval(code);assert.equal(result.status,403);assert.match(result.error,/solo lectura/);
  }
  assert.equal(calls.length,start);
  assert.ok(calls.filter(c=>c.method!=='GET').every(c=>c.path.startsWith('/storage/v1/object/sign/')));
 }finally{w.close();}
});

function handler(name,fetch){
 let run;const shared=read('../edge-functions/_shared/admin-users.mjs').replace(/^export /gm,'');
 const code=stripTypeScriptTypes(read('../edge-functions/'+name+'/index.ts').replace(/^import .*;\n/gm,''),{mode:'strip'});
 const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'public-test',SUPABASE_SERVICE_ROLE_KEY:'service-test'};
 vm.runInNewContext(shared+'\n'+code,{Deno:{env:{get:n=>env[n]},serve:f=>run=f},fetch,Request,Response,console});return run;
}
test('Only a full administrator can create and reset a viewer; creation persists a distinct role without warehouse or operational access',async()=>{
 const admin=randomUUID(),viewerId=randomUUID(),calls=[];let callerRole='admin',stored;
 const fetch=async(url,opt)=>{
  const u=new URL(url),path=u.pathname,body=opt.body?JSON.parse(opt.body):null;calls.push({path,method:opt.method,body});
  if(path==='/auth/v1/user')return Response.json({id:admin,user_metadata:{role:'admin'}});
  if(path==='/rest/v1/profiles'&&u.searchParams.get('id')==='eq.'+admin)return Response.json([{id:admin,username:'admin.avh',role:callerRole,active:true}]);
  if(path==='/rest/v1/profiles'&&u.searchParams.has('username'))return Response.json([]);
  if(path==='/auth/v1/admin/users')return Response.json({id:viewerId});
  if(path==='/rest/v1/profiles'&&opt.method==='POST'){stored=body;return new Response(null,{status:201});}
  if(path==='/rest/v1/profiles')return opt.method==='PATCH'?Response.json({}):Response.json([stored]);
  if(path==='/auth/v1/admin/users/'+viewerId)return Response.json({});
  throw Error('Unexpected '+path);
 };
 const req=body=>new Request('https://test',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify(body)});
 const create=handler('admin-create-user',fetch),reset=handler('admin-reset-user-password',fetch);
 const body={username:'administracion.consulta',role:'admin_viewer',warehouse_id:null,password:'TemporalPrueba123',full_name:'Administración'};
 let response=await create(req(body));assert.equal(response.status,200);assert.equal((await response.json()).user.role,'admin_viewer');
 assert.equal(stored.warehouse_id,null);assert.equal(stored.must_change_password,true);
 assert.equal(calls.some(c=>c.path.includes('work_order')||c.path.includes('fabrication')),false);
 assert.equal((await create(req({...body,warehouse_id:randomUUID()}))).status,400);
 assert.equal((await create(req({...body,role:'admin'}))).status,400);
 response=await reset(req({user_id:viewerId,password:'OtraTemporal123'}));assert.equal(response.status,200);
 callerRole='admin_viewer';const start=calls.length;
 assert.equal((await create(req(body))).status,403);assert.equal((await reset(req({user_id:viewerId,password:'OtraTemporal123'}))).status,403);
 assert.equal(calls.slice(start).some(c=>c.path.includes('/admin/users')),false);
});
