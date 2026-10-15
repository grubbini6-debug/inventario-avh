import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {JSDOM} from 'jsdom';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const migration='../migrations/20261015105130_perfil_produccion_ordenes_trabajo.sql';
test('Production provisioning is atomic, service-only and grants orders without warehouse authority',async()=>{
 const db=new PGlite(),admin=randomUUID(),galo=randomUUID(),other=randomUUID(),failed=randomUUID(),wh=randomUUID();
 const q=(sql,args=[])=>db.query(sql,args);
 const login=async(id,role='authenticated')=>{await db.exec('reset role');await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,role})]);await db.exec('set role '+role);};
 try{
  await db.exec(read('./fixtures/fabrication-inventory.sql'));
  await db.exec(read('../migrations/20261014194409_ordenes_trabajo_galo.sql'));
  await db.exec(read(migration));
  await q('insert into auth.users(id) select unnest($1::uuid[])',[[admin,galo,other,failed]]);
  await q("insert into warehouses(id,code,name) values($1,'VH','Villa Hayes')",[wh]);
  await q("insert into profiles(id,username,role,warehouse_id) values($1,'admin.prueba','admin',null),($2,'deposito.prueba','depositor',$3)",[admin,other,wh]);
  await login(admin);
  await assert.rejects(q('select provision_work_order_user($1,$2,$3,$4)',[galo,'galo.produccion','Galo',admin]),/permission/);
  await login(admin,'service_role');
  const result=(await q('select provision_work_order_user($1,$2,$3,$4) value',[galo,'galo.produccion','Galo',admin])).rows[0].value;
  assert.equal(result.user.role,'production');assert.equal(result.user.warehouse_id,null);assert.equal(result.user.must_change_password,true);
  await login(galo);
  assert.equal((await q('select work_order_context() value')).rows[0].value.access_level,'editor');
  assert.equal((await q('select can_access_warehouse($1) allowed',[wh])).rows[0].allowed,false);
  assert.equal((await q('select * from v_stock_by_warehouse')).rows.length,0);
  await assert.rejects(q('select assert_can_access_warehouse($1)',[wh]),/permis|autoriz|acceso/i);
  await assert.rejects(q('select admin_update_work_order_user($1,false,null)',[other]),/administrador/);
  await assert.rejects(q("insert into work_order_access(user_id,access_level) values($1,'quality')",[galo]),/permission/);
  await login(admin);await q('select admin_update_work_order_user($1,false,$2)',[galo,'Galo técnico']);
  await login(galo);assert.equal((await q('select work_order_context() value')).rows[0].value.access_level,null);
  await login(admin);await q('select admin_update_work_order_user($1,true,null)',[galo]);
  await assert.rejects(q('select admin_update_work_order_user($1,false,null)',[admin]),/inválido/);
  await db.exec('reset role');
  await assert.rejects(q("update profiles set warehouse_id=$1 where id=$2",[wh,galo]),/production_without_warehouse/);
  await assert.rejects(q("insert into profiles(id,username,role) values($1,'sin.deposito','depositor')",[failed]),/depositor_needs_warehouse/);
  await db.exec("create function reject_test_access() returns trigger language plpgsql as $$begin raise exception 'Prueba de reversión';end$$; create trigger reject_test_access before insert on work_order_access for each row execute function reject_test_access();");
  await login(admin,'service_role');
  await assert.rejects(q('select provision_work_order_user($1,$2,$3,$4)',[failed,'alta.fallida','Prueba',admin]),/reversión/);
  await db.exec('reset role');assert.equal((await q('select * from profiles where id=$1',[failed])).rows.length,0);
  assert.equal((await q('select * from work_order_access where user_id=$1',[failed])).rows.length,0);
 }finally{await db.close();}
});
test('A Production session boots into its orders panel, loads technical catalogs and uses its own guide',async()=>{
 const dom=new JSDOM(read('../src/index.template.html'),{url:'https://grubbini6-debug.github.io/inventario-avh/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window,calls=[],errors=[];
 const user={id:newId,username:'galo.produccion',full_name:'Galo',role:'production',warehouse_id:null,active:true,must_change_password:false};
 w.CSS={escape:s=>s};w.HTMLElement.prototype.scrollIntoView=function(){};
 w.console={...console,error:(...args)=>errors.push(args.join(' '))};
 w.fetch=async(url)=>{
  const u=new URL(url),path=u.pathname;calls.push(path);
  if(path==='/rest/v1/profiles')return Response.json([user]);
  if(path==='/rest/v1/rpc/work_order_context')return Response.json({access_level:'editor',access:[]});
  if(path==='/rest/v1/rpc/work_order_inventory')return Response.json({work_location:'Astillero Villa Hayes',warehouse:{id:whId,name:'Villa Hayes'},items:[{product_id:'test-product',product_name:'Alambre',stock_qty:20,base_unit:'kg',minimum_qty:10}],next_cursor:null,updated_at:'2026-10-15T11:00:00Z'});
  if(path==='/rest/v1/rpc/fabrication_context')return Response.json({workshops:[]});
  return Response.json([]);
 };
 w.localStorage.setItem('avh_v2_session',JSON.stringify({access_token:'test-production',expires_at:Date.now()+3600000,user:{id:newId}}));
 const wait=async check=>{for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,10));}throw Error('Boot timeout: '+errors.join('; '));};
 try{
  const manifest=JSON.parse(read('../build-manifest.json'));
  w.eval([...manifest.core,...manifest.features,manifest.bootstrap].map(p=>read('../'+p)).join('\n;\n'));
  await wait(()=>w.document.documentElement.dataset.avhBoot==='ok');
  assert.deepEqual(errors,[]);assert.equal(w.document.querySelector('.page.on').id,'page-work-orders');assert.ok(w.document.body.classList.contains('production-mode'));
  assert.match(w.document.querySelector('#sidebarRole').textContent,/Producción/);assert.ok(w.document.querySelector('#woAnalyze'));
  assert.equal(calls.filter(p=>!p.endsWith('/rpc/work_order_inventory')).some(p=>/purchase|inventory|movements|supply_requests|stock/.test(p)),false);
  w.crypto.randomUUID=randomUUID;w.document.querySelector('#woNew').click();
  assert.equal(w.AVHWorkOrders.state.current.payload.location,'Astillero Villa Hayes');assert.equal(w.AVHWorkOrders.state.current.payload.warehouse_id,whId);
  w.goPage('production-inventory');assert.equal(w.document.querySelector('.page.on').id,'page-production-inventory');assert.match(w.document.querySelector('#productionStockRows').textContent,/Alambre/);
  w.goPage('stock');assert.equal(w.document.querySelector('.page.on').id,'page-work-orders');
  w.goPage('help');assert.equal(w.document.querySelector('.page.on').id,'page-help');assert.match(w.document.querySelector('#page-help').textContent,/Preparar una orden desde Excel/);
  assert.equal(w.document.querySelector('[data-guide-topic="receive"]'),null);
  w.document.querySelector('[data-guide-action="work-orders"]').click();assert.equal(w.document.querySelector('.page.on').id,'page-work-orders');
 }finally{w.close();}
});

const adminId='11111111-1111-4111-8111-111111111111',newId='22222222-2222-4222-8222-222222222222',whId='33333333-3333-4333-8333-333333333333';
function handler(name,fetch){
 let run;
 const shared=read('../edge-functions/_shared/admin-users.mjs').replace(/^export /gm,'');
 const code=stripTypeScriptTypes(read('../edge-functions/'+name+'/index.ts').replace(/^import .*;\n/gm,''),{mode:'strip'});
 const env={SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'public-test',SUPABASE_SERVICE_ROLE_KEY:'service-test'};
 vm.runInNewContext(shared+'\n'+code,{Deno:{env:{get:n=>env[n]},serve:f=>run=f},fetch,Request,Response,console});return run;
}
const request=body=>new Request('https://test/functions',{method:'POST',headers:{Authorization:'Bearer caller-test','Content-Type':'application/json'},body:JSON.stringify(body)});
test('Admin endpoints validate caller and profile, auto-enable Production, preserve depositors and roll back failed provisioning',async()=>{
 let callerRole='admin',active=true,role='production',fail=false;const calls=[];
 const fetch=async(url,opt)=>{
  const path=new URL(url).pathname,body=opt.body?JSON.parse(opt.body):null;calls.push({path,method:opt.method,body});
  if(path==='/auth/v1/user'){assert.equal(opt.headers.Authorization,'Bearer caller-test');return Response.json({id:adminId,user_metadata:{role:'admin'}});}
  assert.equal(opt.headers.Authorization,'Bearer service-test');
  if(path==='/rest/v1/profiles'&&url.includes('id=eq.'+adminId))return Response.json([{id:adminId,username:'admin.prueba',role:callerRole,active}]);
  if(path==='/rest/v1/profiles'&&url.includes('username='))return Response.json([]);
  if(path==='/rest/v1/warehouses')return Response.json([{id:whId,name:'Villa Hayes',active:true}]);
  if(path==='/auth/v1/admin/users'){assert.deepEqual(body.user_metadata,{username:'galo.produccion'});return Response.json({id:newId});}
  if(path==='/rest/v1/rpc/provision_work_order_user')return fail?Response.json({error:'test'},{status:400}):Response.json({ok:true,user:{id:newId,role:'production',warehouse_id:null,active:true,must_change_password:true,work_location:body.p_work_location,inventory_warehouse_id:body.p_inventory_warehouse_id}});
  if(path==='/auth/v1/admin/users/'+newId&&opt.method==='DELETE')return Response.json({});
  if(path==='/rest/v1/profiles'&&opt.method==='POST')return new Response(null,{status:201});
  if(path==='/rest/v1/profiles')return Response.json([{id:newId,username:'galo.produccion',role,warehouse_id:role==='production'?null:whId,active:true,must_change_password:true}]);
  throw Error('Unexpected '+path);
 };
 const create=handler('admin-create-user',fetch),body={username:'galo.produccion',role:'production',password:'ClaveDePrueba123',full_name:'Galo',work_location:'Astillero Villa Hayes',inventory_warehouse_id:whId};
 let r=await create(request(body));assert.equal(r.status,200);assert.equal((await r.json()).user.role,'production');
 assert.ok(calls.some(c=>c.path.endsWith('provision_work_order_user')&&c.body.p_actor_id===adminId));
 for(const denied of [{...body,role:'admin'},{...body,warehouse_id:whId},{...body,role:'depositor'}])assert.equal((await create(request(denied))).status,400);
 for(const [r,a] of [['production',true],['admin',false]]){callerRole=r;active=a;const start=calls.length;assert.equal((await create(request(body))).status,403);assert.equal(calls.slice(start).some(c=>c.path==='/auth/v1/admin/users'),false);}
 callerRole='admin';active=true;fail=true;assert.equal((await create(request(body))).status,500);assert.ok(calls.some(c=>c.path.endsWith(newId)&&c.method==='DELETE'));
 fail=false;role='depositor';const legacy={...body,warehouse_id:whId};delete legacy.role;delete legacy.work_location;delete legacy.inventory_warehouse_id;assert.equal((await create(request(legacy))).status,200);
 assert.equal(calls.filter(c=>c.path==='/rest/v1/profiles'&&c.method==='POST').at(-1).body.role,'depositor');
 assert.equal((await create(new Request('https://test',{method:'POST'}))).status,401);
});
test('Password reset covers Production, keeps mandatory change and refuses administrator targets',async()=>{
 let targetRole='production';const mutations=[];
 const reset=handler('admin-reset-user-password',async(url,opt)=>{
  const path=new URL(url).pathname;
  if(path==='/auth/v1/user')return Response.json({id:adminId});
  if(path==='/rest/v1/profiles'&&url.includes(adminId))return Response.json([{id:adminId,role:'admin',active:true}]);
  if(path==='/rest/v1/profiles'&&opt.method==='GET')return Response.json([{id:newId,username:'galo',role:targetRole,active:true}]);
  mutations.push({path,method:opt.method,body:JSON.parse(opt.body)});return Response.json({});
 });
 const body={user_id:newId,password:'NuevaClave123'};
 assert.equal((await reset(request(body))).status,200);assert.equal(mutations[1].body.must_change_password,true);
 targetRole='admin';assert.equal((await reset(request(body))).status,400);assert.equal(mutations.length,2);
 assert.equal((await reset(request({...body,user_id:adminId}))).status,400);
});
test('User creation offers a distinct Production profile and manages it without a warehouse',async()=>{
 const dom=new JSDOM('<div id="adminBox"></div><div id="modal" class="hide"><div id="modalBody"></div></div>',{url:'https://avh.test',runScripts:'outside-only'}),w=dom.window,calls=[];
 const admin={id:adminId,role:'admin',username:'admin.prueba'},created={id:newId,username:'galo.produccion',role:'production',warehouse_id:null,full_name:'Galo',active:true,must_change_password:true};
 Object.assign(w,{$:s=>w.document.querySelector(s),$$:s=>[...w.document.querySelectorAll(s)],D:{profiles:[admin],warehouses:[{id:whId,name:'Villa Hayes',active:true}]},profile:admin,esc:s=>String(s??''),whName:()=> 'Villa Hayes',activeWhOptions:()=>'<option value="'+whId+'">Villa Hayes</option>',msg:(e,t)=>e.textContent=t,
  openModal:(t,s,html)=>{w.document.querySelector('#modalBody').innerHTML=html;},closeModal:()=>{},loadAll:async()=>{},renderAdmin:()=>w.adminUsers(),rpc:async(name,args)=>{calls.push({name,args});return{};},edge:async(name,args)=>{calls.push({name,args});created.work_location=args.work_location;created.inventory_warehouse_id=args.inventory_warehouse_id;w.D.profiles.push(created);return{data:{user:created}};}});
 try{
  w.eval(read('../src/features/admin/password-ux.js'));w.adminUsers();
  assert.equal(w.$('#newUserWh').disabled,false);w.$('#newUserRole').value='production';w.$('#newUserRole').onchange();
  assert.equal(w.$('#newUserWh').disabled,true);assert.equal(w.$('#newUserWarehouseField').hidden,true);
  w.$('#newProductionInventoryWh').value=whId;w.$('#newProductionInventoryWh').onchange();assert.equal(w.$('#newProductionLocation').value,'Villa Hayes');
  w.$('#newUser').value='galo.produccion';w.$('#newUserName').value='Galo';w.$('#continueCreateUser').onclick();w.$('#tempAccessKey').value='ClaveTemporal123';await w.$('#confirmCreateDepositor').onclick();
  assert.equal(calls[0].args.role,'production');assert.equal(calls[0].args.warehouse_id,null);assert.equal(calls[0].args.work_location,'Villa Hayes');assert.equal(calls[0].args.inventory_warehouse_id,whId);
  w.manageUser(newId);assert.equal(w.$('#manageWh'),null);w.$('#manageFullName').value='Galo Técnico';await w.$('#saveUserProfile').onclick();
  assert.equal(calls[1].name,'admin_update_work_order_user');assert.equal(calls[1].args.p_full_name,'Galo Técnico');assert.equal(calls[1].args.p_inventory_warehouse_id,whId);await w.$('#toggleUser').onclick();assert.equal(calls[2].args.p_active,false);
 }finally{w.close();}
});
