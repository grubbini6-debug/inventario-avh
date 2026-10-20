// Browser → HTTP adapter → real isolated PostgreSQL RPC. No production credentials/data.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {PGlite} from '@electric-sql/pglite';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const ids={admin:randomUUID(),dep:randomUUID(),w:randomUUID(),other:randomUUID(),co2:randomUUID(),oxygen:randomUUID(),glp:randomUUID()};
const db=new PGlite(),errors=[];let server,browser,loseNextExit=false,loseNextCount=false,queue=Promise.resolve();
const q=(sql,args=[])=>db.query(sql,args);
function asUser(user,fn){const job=queue.then(async()=>{await db.exec('reset role');await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user,role:'authenticated'})]);await db.exec('set role authenticated');return fn();});queue=job.catch(()=>{});return job;}
try{
 await db.exec(fs.readFileSync(path.join(root,'tests/fixtures/fabrication-inventory.sql'),'utf8'));
 await q('insert into auth.users(id) values($1),($2)',[ids.admin,ids.dep]);
 await q("insert into warehouses(id,code,name) values($1,'ACOMAR','ACOMAR'),($2,'OTHER','Otro depósito')",[ids.w,ids.other]);
 await q("insert into profiles(id,username,full_name,role,warehouse_id,active) values($1,'admin','Compras AVH','admin',null,true),($2,'nuevo','Depositario nuevo','depositor',$3,true)",[ids.admin,ids.dep,ids.w]);
 await q("insert into products(id,sku,name,base_unit) values($1,'CO2','CO₂','cilindro'),($2,'OXIGENO','Oxígeno','cilindro'),($3,'GLP-10KG','GLP 10 kg','cilindro')",[ids.co2,ids.oxygen,ids.glp]);
 for(const file of ['20261014121312_control_gases.sql','20261020133036_gas_presentations_kg.sql','20261020133040_gas_presentation_commands.sql'])await db.exec(fs.readFileSync(path.join(root,'migrations',file),'utf8'));
 server=http.createServer((req,res)=>{const name=req.url==='/'?'index.html':req.url.slice(1).split('?')[0],full=path.join(root,'dist',name);if(name.includes('..')||!fs.existsSync(full))return res.writeHead(404).end();res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html':'image/jpeg'});res.end(fs.readFileSync(full));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({headless:true,...(process.env.AVH_CHROME_BIN?{executablePath:process.env.AVH_CHROME_BIN}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
 async function open(user,viewport){
  const context=await browser.newContext({viewport}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.clock.install();
  await page.route('**/*supabase.co/**',async route=>{
   const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').at(-1),headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,PATCH,OPTIONS'};
   if(req.method()==='OPTIONS')return route.fulfill({headers,body:''});
   if(url.pathname.endsWith('/rpc/fabrication_context'))return route.fulfill({headers,json:{workshops:[],active_orders:0,produced_qty:0}});
   try{
    if(table==='gas_ensure_presentation'){
     const args=req.postDataJSON(),result=await asUser(user,async()=>(await q('select public.gas_ensure_presentation($1,$2,$3::numeric) result',[args.p_warehouse_id,args.p_gas_kind,args.p_kg_per_cylinder])).rows[0].result);
     return route.fulfill({headers,json:result});
    }
    if(table==='gas_command'){
     const args=req.postDataJSON(),result=await asUser(user,async()=>(await q('select public.gas_command($1,$2::jsonb,$3::uuid) result',[args.p_action,JSON.stringify(args.p_data),args.p_request_id])).rows[0].result);
     if(args.p_action==='exit'&&loseNextExit){loseNextExit=false;return route.fulfill({headers,status:503,json:{message:'Respuesta perdida de prueba. Volvé a intentar.'}});}
     if(args.p_action==='count'&&loseNextCount){loseNextCount=false;return route.fulfill({headers,status:503,json:{message:'Respuesta de conteo perdida. Volvé a intentar.'}});}
     return route.fulfill({headers,json:result});
    }
    if(url.pathname.includes('/rpc/'))return route.fulfill({headers,json:[]});
    let rows=[];
    if(['profiles','products','warehouses','suppliers','barges','v_stock_by_warehouse','v_stock_status','v_stock_value_by_warehouse','gas_custody','gas_events','v_gas_stock_status'].includes(table))rows=await asUser(user,async()=>(await q('select * from public.'+table)).rows);
    const id=url.searchParams.get('id');if(id?.startsWith('eq.'))rows=rows.filter(x=>x.id===id.slice(3));
    const wh=url.searchParams.get('warehouse_id');if(wh?.startsWith('eq.'))rows=rows.filter(x=>x.warehouse_id===wh.slice(3));
    if(table==='gas_events'){rows=rows.map(x=>({...x,work_date:x.work_date instanceof Date?x.work_date.toISOString().slice(0,10):x.work_date}));for(const filter of url.searchParams.getAll('work_date'))rows=rows.filter(x=>filter.startsWith('gte.')?String(x.work_date)>=filter.slice(4):String(x.work_date)<=filter.slice(4));rows.sort((a,b)=>Number(b.event_no)-Number(a.event_no));}
    return route.fulfill({headers,json:rows});
   }catch(e){return route.fulfill({headers,status:400,json:{message:e.message}});}
  });
  await page.routeWebSocket('**/*supabase.co/**',socket=>socket.onMessage(raw=>{const m=JSON.parse(String(raw));if(m.event==='phx_join')socket.send(JSON.stringify({topic:m.topic,event:'phx_reply',ref:m.ref,payload:{status:'ok'}}));}));
  await page.addInitScript(({user})=>localStorage.setItem('avh_v2_session',JSON.stringify({user:{id:user},access_token:'isolated-test',refresh_token:'isolated-test',expires_at:Date.now()+3600000})),{user});
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForSelector('html[data-avh-boot="ok"]');await page.waitForSelector('#main:not(.hide)');
  return {page,context};
 }
 const admin=await open(ids.admin,{width:1440,height:1000}),p=admin.page;
 assert.match(await p.locator('#page-home>.hero').textContent(),/Operación general/);assert.equal(await p.locator('#warehouseCards [data-home-wh]').count(),2);
 await p.locator('.nav [data-page="gases"]').click();await p.waitForSelector('#gasCards .gas-card');assert.equal(await p.locator('#gasCards .gas-card').count(),3);
 assert.match(await p.locator('#gasCards').textContent(),/SIN CONTEO/);await p.locator('#gasCount').click();
 for(const [id,full,empty] of [[ids.co2,20,2],[ids.oxygen,8,3],[ids.glp,5,0]]){
  assert.equal(await p.locator(`[name="full_${id}"]`).inputValue(),'');await p.locator(`[name="full_${id}"]`).fill(String(full));await p.locator(`[name="empty_${id}"]`).fill(String(empty));
 }
 const group=p.locator(`[data-gas-count="${ids.co2}"]`);await group.locator('[data-add-holder]').click();await group.locator('[data-person]').fill('Pedro');await group.locator('[data-quantity]').fill('3');
 await p.locator('#gas-notes').fill('Conteo físico del nuevo depositario');await p.locator('#gasForm input[type="checkbox"]').check();
 await p.evaluate(()=>{window.__gasDraft=document.querySelector('#gas-notes');});await p.evaluate(()=>loadAll(false));
 assert.equal(await p.evaluate(()=>window.__gasDraft===document.querySelector('#gas-notes')),true);assert.equal(await p.locator('#gas-notes').inputValue(),'Conteo físico del nuevo depositario');
 await p.locator('#gasForm button[type="submit"]').click();await p.waitForSelector('#modal.hide',{state:'attached'});await p.waitForFunction(()=>document.querySelector('#gasCards')?.textContent.includes('CONTADO'));
 assert.equal(await asUser(ids.admin,async()=>Number((await q('select full_qty from v_gas_stock_status where warehouse_id=$1 and product_id=$2',[ids.w,ids.co2])).rows[0].full_qty)),20);
 await p.locator(`[data-gas-exit="${ids.co2}"]`).click();await p.locator('#gas-quantity').fill('3');await p.locator('#gas-person').fill('Piero');await p.locator('#gas-destination').fill('Soldadura B5');await p.locator('#gas-reference').fill('VALE-TEST');
 loseNextExit=true;await p.locator('#gasForm button[type="submit"]').click();await p.waitForSelector('#gasFormError .error');await p.locator('#gasForm button[type="submit"]').click();await p.waitForSelector('#modal.hide',{state:'attached'});
 assert.equal(await asUser(ids.admin,async()=>Number((await q('select full_qty from v_gas_stock_status where warehouse_id=$1 and product_id=$2',[ids.w,ids.co2])).rows[0].full_qty)),17);
 assert.equal(await asUser(ids.admin,async()=>(await q("select count(*)::int n from gas_events where action='exit'")).rows[0].n),1);
 await p.locator('#gasApply').click();await p.waitForFunction(()=>/Salieron llenos\s*3/.test(document.querySelector('#gasPeriod')?.textContent||''));assert.match(await p.locator('#gasPeriod').textContent(),/Salieron llenos\s*3/);assert.match(await p.locator('#gasHistory').textContent(),/VALE-TEST/);
 const downloadPromise=p.waitForEvent('download');await p.locator('#gasExport').click();const download=await downloadPromise;assert.match(download.suggestedFilename(),/Gases_ACOMAR/);
 if(process.env.AVH_QA_OUTPUT){fs.mkdirSync(process.env.AVH_QA_OUTPUT,{recursive:true});await p.evaluate(()=>window.scrollTo(0,0));await p.screenshot({path:path.join(process.env.AVH_QA_OUTPUT,'gases-desktop.png'),fullPage:true});}
 const dep=await open(ids.dep,{width:390,height:844}),m=dep.page;
 await m.locator('.nav [data-page="gases"]').click();await m.waitForSelector('#gasCards .gas-card');assert.equal(await m.locator('#gas-warehouse').count(),0);assert.equal(await m.locator('#gasCards .gas-card').count(),3);
 await m.evaluate(()=>loadAll(false));assert.equal(await m.locator('#page-gases.on').count(),1,'el refresco del depositario conserva la página Gases');
 assert.ok(await m.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),'sin desborde horizontal móvil');
 const pending=m.locator('#gasPending .row').filter({hasText:'Piero'});await pending.locator('button').click();await m.locator('#gas-quantity').fill('2');await m.locator('#gasForm button[type="submit"]').click();await m.waitForSelector('#modal.hide',{state:'attached'});
 const r=await asUser(ids.dep,async()=>(await q('select full_qty,empty_qty,outside_qty from v_gas_stock_status where warehouse_id=$1 and product_id=$2',[ids.w,ids.co2])).rows[0]);assert.equal(Number(r.full_qty),17);assert.equal(r.empty_qty,4);assert.equal(Number(r.outside_qty),4);
 if(process.env.AVH_QA_OUTPUT){await m.evaluate(()=>window.scrollTo(0,0));await m.screenshot({path:path.join(process.env.AVH_QA_OUTPUT,'gases-mobile.png'),fullPage:true});}
 await m.locator('#gasCount').click();await m.locator(`[name="full_${ids.co2}"]`).fill('17');await m.locator('#gas-notes').fill('Conteo aún sin guardar');await m.evaluate(()=>loadAll(false));assert.equal(await m.locator('#gas-notes').inputValue(),'Conteo aún sin guardar');
 if(process.env.AVH_QA_OUTPUT)await m.screenshot({path:path.join(process.env.AVH_QA_OUTPUT,'gases-conteo-mobile.png'),fullPage:true});
 await m.evaluate(()=>closeModal());await m.locator('#gasCount').click();
 const current=await asUser(ids.dep,async()=>(await q('select * from v_gas_stock_status where warehouse_id=$1',[ids.w])).rows);
 for(const r of current){await m.locator(`[name="full_${r.product_id}"]`).fill(String(r.full_qty));await m.locator(`[name="empty_${r.product_id}"]`).fill(String(r.empty_qty));}
 for(const [kg,full,empty] of [[25,2,1],[50,3,2],[22.5,2,0]]){
  await m.locator('#gas-new_kind').selectOption('co2');
  if(kg===22.5)await m.locator('#gas-new_kg').fill('22.5');else await m.locator(`[data-gas-size="${kg}"]`).click();
  await m.locator('#gasAddCountSize').click();const draft=m.locator('[data-gas-count^="draft-"]').last();await draft.locator('[name^="full_"]').fill(String(full));await draft.locator('[name^="empty_"]').fill(String(empty));
 }
 await m.locator('#gas-new_kg').fill('25');await m.locator('#gasAddCountSize').click();assert.match(await m.locator('#gasSizeError').textContent(),/ya está/);assert.equal(await m.locator('[data-gas-count^="draft-"]').count(),3);await m.locator('#gas-new_kg').fill('');
 await m.locator('#gas-notes').fill('Conteo de cilindros por presentación en kg');await m.locator('#gasForm input[type="checkbox"]').check();
 loseNextCount=true;await m.locator('#gasForm button[type="submit"]').click();await m.waitForSelector('#gasFormError .error');assert.match(await m.locator('#gasFormError').textContent(),/conteo perdida/);await m.locator('#gasForm button[type="submit"]').click();await m.waitForSelector('#modal.hide',{state:'attached'});
 const weighted=await asUser(ids.dep,async()=>(await q('select * from v_gas_stock_status where warehouse_id=$1 and kg_per_cylinder in (25,50,22.5)',[ids.w])).rows),p25=weighted.find(r=>Number(r.kg_per_cylinder)===25),p50=weighted.find(r=>Number(r.kg_per_cylinder)===50);
 assert.equal(Number(p25.full_kg),50);assert.equal(Number(p50.full_kg),150);assert.equal(await m.locator('#gasCards .gas-card').count(),6);assert.ok(await m.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));
 const countEvents=await asUser(ids.dep,async()=>(await q("select count(*)::int n from gas_events where action='count' and product_id=$1",[p25.product_id])).rows[0].n);assert.equal(countEvents,1,'respuesta perdida no duplica conteo ni cambia versiones del reintento');
 await m.locator(`[data-gas-exit="${p25.product_id}"]`).click();await m.locator('#gas-quantity').fill('1');assert.match(await m.locator('#gasWeightPreview').textContent(),/1 cilindros.*25 kg = 25 kg/);await m.locator('#gas-person').fill('Soldador kg');await m.locator('#gas-destination').fill('Barcaza 5');await m.locator('#gasForm button[type="submit"]').click();await m.waitForSelector('#modal.hide',{state:'attached'});
 let balance=await asUser(ids.dep,async()=>(await q('select * from v_gas_stock_status where warehouse_id=$1 and product_id=$2',[ids.w,p25.product_id])).rows[0]);assert.equal(Number(balance.full_kg),25);
 await m.locator('#gasPending .row').filter({hasText:'Soldador kg'}).locator('button').click();await m.locator('#gas-quantity').fill('1');assert.match(await m.locator('#gasWeightPreview').textContent(),/no suma kg/);await m.locator('#gasForm button[type="submit"]').click();await m.waitForSelector('#modal.hide',{state:'attached'});
 await m.locator('#gasRefill').click();await m.locator('#gas-product_id').selectOption(p25.product_id);await m.locator('#gas-quantity').fill('1');await m.locator('#gas-empty_quantity').fill('1');await m.locator('#gas-person').fill('Proveedor kg');await m.locator('#gasForm button[type="submit"]').click();await m.waitForSelector('#modal.hide',{state:'attached'});
 balance=await asUser(ids.dep,async()=>(await q('select * from v_gas_stock_status where warehouse_id=$1 and product_id=$2',[ids.w,p25.product_id])).rows[0]);assert.equal(Number(balance.full_kg),50);assert.equal(balance.empty_qty,1);
 assert.equal(await asUser(ids.dep,async()=>Number((await q('select full_kg from v_gas_stock_status where warehouse_id=$1 and product_id=$2',[ids.w,p50.product_id])).rows[0].full_kg)),150,'la presentación de 50 kg conserva su saldo');
 if(process.env.AVH_QA_OUTPUT)await m.screenshot({path:path.join(process.env.AVH_QA_OUTPUT,'gases-presentaciones-mobile.png'),fullPage:true});
 await dep.context.close();await admin.context.close();assert.deepEqual(errors,[]);console.log('Gases browser OK: conteo real, salidas, respuesta perdida sin duplicación, devolución vacía, diferencial, CSV, roles y borradores.');
}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await db.close();}
