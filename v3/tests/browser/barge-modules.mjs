// Browser -> authenticated HTTP adapter -> real isolated PostgreSQL FIFO.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {PGlite} from '@electric-sql/pglite';
import {setupHullBase,setupHullGases,applyHull} from '../helpers/hull-fixture.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),db=new PGlite(),id={admin:randomUUID(),dep:randomUUID(),w:randomUUID(),barge:randomUUID(),wire:randomUUID(),old:randomUUID()};
const q=(sql,args=[])=>db.query(sql,args),errors=[];
let queue=Promise.resolve(),server,browser,loseExit=true;
function asUser(user,fn){const result=queue.then(async()=>{await db.exec('reset role');await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user,role:'authenticated'})]);await db.exec('set role authenticated');return fn();});queue=result.catch(()=>{});return result;}
try{
 await setupHullBase(db);await q('insert into auth.users(id) values($1),($2)',[id.admin,id.dep]);
 await q("insert into warehouses(id,code,name) values($1,'ACOMAR','Depósito de prueba')",[id.w]);
 await q("insert into profiles(id,username,full_name,role,warehouse_id,active) values($1,'admin','Compras de prueba','admin',null,true),($2,'depositor','Depositario de prueba','depositor',$3,true)",[id.admin,id.dep,id.w]);
 await q("insert into barges(id,number,active) values($1,7,true)",[id.barge]);
 await q("insert into products(id,name,base_unit) values($1,'Material de prueba','unidad'),($2,'Material histórico de prueba','kg')",[id.wire,id.old]);
 await setupHullGases(db);
 const entry=async(product,quantity,cost,currency)=>asUser(id.admin,()=>q('select public.record_entry($1,null,null,$2::jsonb,null)',[id.w,JSON.stringify([{product_id:product,quantity,unit:product===id.old?'kg':'unidad',factor_to_base:1,unit_cost:cost??'',currency:currency??'',request_id:randomUUID()}])]));
 await entry(id.wire,10,10,'PYG');await entry(id.wire,6,2,'USD');await entry(id.wire,2,null,null);await entry(id.old,5,null,null);
 await asUser(id.admin,()=>q('select public.record_exit($1,$2,null,$3,$4,$5::jsonb,null)',[id.w,id.barge,'Persona histórica','Trabajo anterior',JSON.stringify([{product_id:id.old,quantity:1,unit:'kg',factor_to_base:1,request_id:randomUUID()}])]));
 await queue;await db.exec('reset role');await applyHull(db);
 const gas=(await q("select product_id from public.gas_products where gas_kind='co2' order by kg_per_cylinder nulls first limit 1")).rows[0].product_id;
 await q('update public.gas_controls set counted_at=now(),counted_by=$1 where warehouse_id=$2',[id.admin,id.w]);
 await asUser(id.admin,()=>q("select public.gas_command('new_full',$1::jsonb,$2::uuid)",[JSON.stringify({warehouse_id:id.w,product_id:gas,quantity:2,person:'Proveedor de prueba',unit_cost:12,currency:'USD'}),randomUUID()]));
 server=http.createServer((req,res)=>{const name=req.url==='/'?'index.html':req.url.slice(1).split('?')[0],file=path.join(root,'dist',name);if(name.includes('..')||!fs.existsSync(file))return res.writeHead(404).end();res.writeHead(200,{'Content-Type':name.endsWith('.js')||name.endsWith('.mjs')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html':'image/jpeg'});res.end(fs.readFileSync(file));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({headless:true,...(process.env.AVH_CHROME_BIN?{executablePath:process.env.AVH_CHROME_BIN}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 async function open(user,viewport){
  const context=await browser.newContext({viewport}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.clock.install();
  await page.route('**/*supabase.co/**',async route=>{
   const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').at(-1),headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
   if(req.method()==='OPTIONS')return route.fulfill({headers,body:''});
   if(url.pathname.startsWith('/auth/'))return route.fulfill({headers,json:{user:{id:user}}});
   try{
    if(table==='record_exit'){
     const a=req.postDataJSON(),result=await asUser(user,async()=>(await q('select public.record_exit($1,$2,$3,$4,$5,$6::jsonb,$7) result',[a.p_warehouse_id,a.p_barge_id,a.p_contractor_id,a.p_person_receiving,a.p_destination,JSON.stringify(a.p_items),a.p_notes])).rows[0].result);
     if(loseExit){loseExit=false;return route.fulfill({headers,status:503,json:{message:'Respuesta perdida de prueba: volvé a intentar.'}});}
     return route.fulfill({headers,json:result});
    }
    if(table==='gas_command'){const a=req.postDataJSON(),result=await asUser(user,async()=>(await q('select public.gas_command($1,$2::jsonb,$3::uuid) result',[a.p_action,JSON.stringify(a.p_data),a.p_request_id])).rows[0].result);return route.fulfill({headers,json:result});}
    if(table==='fabrication_context')return route.fulfill({headers,json:{workshops:[],active_orders:0,produced_qty:0}});
    if(url.pathname.includes('/rpc/'))return route.fulfill({headers,json:[]});
    let rows=[];
    if(table==='movements')rows=await asUser(user,async()=>(await q("select m.*,coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('products',jsonb_build_object('name',p.name,'base_unit',p.base_unit))) from public.movement_lines l join public.products p on p.id=l.product_id where l.movement_id=m.id),'[]'::jsonb) movement_lines from public.movements m order by m.created_at desc")).rows);
    else if(['profiles','products','warehouses','suppliers','barges','product_presentations','v_stock_by_warehouse','v_stock_status','v_stock_value_by_warehouse','v_barge_consumption','v_barge_module_consumption','gas_custody','gas_events','v_gas_stock_status'].includes(table))rows=await asUser(user,async()=>(await q('select * from public.'+table)).rows);
    for(const key of ['id','warehouse_id','barge_id','product_id']){const filter=url.searchParams.get(key);if(filter?.startsWith('eq.'))rows=rows.filter(x=>x[key]===filter.slice(3));}
    return route.fulfill({headers,json:rows});
   }catch(e){return route.fulfill({headers,status:400,json:{message:e.message}});}
  });
  await page.routeWebSocket('**/*supabase.co/**',socket=>socket.onMessage(raw=>{const m=JSON.parse(String(raw));if(m.event==='phx_join')socket.send(JSON.stringify({topic:m.topic,event:'phx_reply',ref:m.ref,payload:{status:'ok'}}));}));
  await page.addInitScript(({user})=>localStorage.setItem('avh_v2_session',JSON.stringify({user:{id:user},access_token:'isolated-test',refresh_token:'isolated-test',expires_at:Date.now()+3600000})),{user});
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('html[data-avh-boot="ok"]');await page.waitForSelector('#main:not(.hide)');return{page,context};
 }
 const dep=await open(id.dep,{width:390,height:844}),p=dep.page;
 await p.locator('#depManualExit').click();await p.locator('#depExitBarge').selectOption(id.barge);await p.locator('#depExitProduct').selectOption(id.wire);
 await p.locator('#depExitQty').fill('6');await p.locator('#depAddManualExit').click();await p.locator('[data-dep-hull-row="0"] [data-hull-section]').selectOption('fondo');await p.locator('[data-dep-hull-row="0"] [data-hull-module]').fill('f12');
 await p.locator('#depExitQty').fill('6');await p.locator('#depAddManualExit').click();assert.equal(await p.locator('[data-dep-hull-row="0"] [data-hull-module]').inputValue(),'f12');
 await p.locator('#depExitPerson').fill('Persona de prueba');await p.locator('#depExitDestination').fill('Soldadura de prueba');
 await p.locator('#depConfirmManualExit').click();assert.match(await p.locator('#depExitMsg').textContent(),/parte/);
 await p.locator('[data-dep-hull-row="1"] [data-hull-section]').selectOption('costado');await p.locator('[data-dep-hull-row="1"] [data-hull-module]').fill('co3');
 assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await p.locator('#depConfirmManualExit').click();await p.waitForSelector('#depExitMsg .error');assert.match(await p.locator('#depExitMsg').textContent(),/Respuesta perdida/);
 await p.locator('#depConfirmManualExit').click();await p.waitForSelector('#modal.hide',{state:'attached'});
 assert.equal(await asUser(id.admin,async()=>Number((await q('select sum(quantity_remaining) n from public.inventory_batches where warehouse_id=$1 and product_id=$2',[id.w,id.wire])).rows[0].n)),6);
 assert.equal(await asUser(id.admin,async()=>Number((await q("select count(*) n from public.movements m join public.movement_lines l on l.movement_id=m.id where m.type='exit' and l.product_id=$1",[id.wire])).rows[0].n)),2);
 await p.locator('.nav [data-page="gases"]').click();await p.waitForSelector('[data-gas-exit="'+gas+'"]');await p.locator('[data-gas-exit="'+gas+'"]').click();
 await p.locator('#gas-quantity').fill('1');await p.locator('#gas-person').fill('Persona de gases');await p.locator('#gas-destination').fill('Trabajo de proa');await p.locator('#gas-barge_id').selectOption(id.barge);
 await p.locator('[data-hull-section]').selectOption('proa');await p.locator('[data-hull-module]').fill('P1');await p.locator('#gasForm button[type="submit"]').click();await p.waitForSelector('#modal.hide',{state:'attached'});
 assert.equal((await asUser(id.dep,async()=>(await q('select * from public.v_barge_module_consumption')).rows)).length,0);
 await dep.context.close();
 const admin=await open(id.admin,{width:1440,height:1000}),a=admin.page;
 await a.locator('.nav [data-page="barges"]').click();await a.locator('[data-barge="'+id.barge+'"]').click();await a.waitForSelector('.hull-cost-section');
 const report=await a.locator('#hullCostReport').textContent();assert.match(report,/F12/);assert.match(report,/CO3/);assert.match(report,/P1/);assert.match(report,/Sin clasificar/);assert.match(report,/total valorizado es parcial/);
 const totals=await asUser(id.admin,async()=>(await q('select currency,sum(real_cost) cost from public.v_barge_module_consumption where barge_id=$1 group by currency',[id.barge])).rows);
 assert.equal(Number(totals.find(x=>x.currency==='PYG').cost),100);assert.equal(Number(totals.find(x=>x.currency==='USD').cost),16);
 await a.locator('#hullCostSection').selectOption('fondo');assert.match(await a.locator('#hullCostRows').textContent(),/F12/);assert.doesNotMatch(await a.locator('#hullCostRows').textContent(),/CO3/);
 const download=a.waitForEvent('download');await a.locator('#hullCostExport').click();const csv=await download;const content=fs.readFileSync(await csv.path(),'utf8');assert.match(content,/Parte.*Módulo/);assert.match(content,/F12/);assert.doesNotMatch(content,/CO3/);
 await admin.context.close();assert.deepEqual(errors,[]);
 console.log('Browser OK: mobile per-line destinations, split product FIFO, lost-response retry, classified gas exit, admin module costs, currencies, unpriced history, filters and CSV.');
}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await db.close();}
