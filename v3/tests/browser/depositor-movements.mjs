// Browser -> authenticated read adapter -> real isolated PostgreSQL RLS.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {PGlite} from '@electric-sql/pglite';
import {setupRecount} from '../helpers/recount-fixture.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const db=new PGlite(),id={admin:randomUUID(),dep:randomUUID(),peer:randomUUID(),other:randomUUID(),w:randomUUID(),w2:randomUUID(),product:randomUUID()},errors=[],historyRequests=[],recountRequests=[];
let loseFirstRecountResponse=true;
const q=(sql,args=[])=>db.query(sql,args);
let server,browser,queue=Promise.resolve();
function asUser(user,fn){
  const result=queue.then(()=>db.transaction(async tx=>{
    await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:user,role:'authenticated'})]);
    await tx.exec('set local role authenticated');return fn(tx);
  }));queue=result.catch(()=>{});return result;
}
try{
  await setupRecount(db);
  await q('insert into auth.users(id) select unnest($1::uuid[])',[[id.admin,id.dep,id.peer,id.other]]);
  await q("insert into warehouses(id,code,name) values($1,'VH','Villa Hayes'),($2,'AC','ACOMAR')",[id.w,id.w2]);
  await q("insert into profiles(id,username,role,warehouse_id,active) values($1,'admin','admin',null,true),($2,'deposito','depositor',$5,true),($3,'companero','depositor',$5,true),($4,'otro','depositor',$6,true)",[id.admin,id.dep,id.peer,id.other,id.w,id.w2]);
  await q("insert into products(id,name,base_unit) values($1,'Alambre de prueba','kg')",[id.product]);
  await q(`insert into movements(type,status,warehouse_from_id,warehouse_to_id,created_by,created_at,person_receiving,destination,notes)
    select (array['initial','entry','exit','transfer','return'])[1+(g-1)%5],case when g=1005 then 'cancelled' else 'confirmed' end,
      case when (g-1)%5 in (2,3) then $1::uuid end,
      case when (g-1)%5=3 then $2::uuid when (g-1)%5<>2 then $1::uuid end,
      $3::uuid,'2026-11-01 12:00Z'::timestamptz+g*interval '1 minute','Operario de prueba','Soldadura DPW10',
      case when g=1 then 'Registro histórico anterior al caché de inicio' else 'Carga de prueba' end
    from generate_series(1,1005) g`,[id.w,id.w2,id.dep]);
  await q("insert into movement_lines(movement_id,product_id,quantity,unit,factor_to_base,presentation_label) select id,$1,2,'caja',15,'Caja de 15 kg' from movements",[id.product]);
  await q('insert into inventory_batches(warehouse_id,product_id,source_line_id,quantity_received,quantity_remaining) select $1,$2,l.id,30,30 from movement_lines l join movements m on m.id=l.movement_id where m.movement_no=1',[id.w,id.product]);
  await q("insert into movements(type,warehouse_to_id,created_by,notes) values('entry',$1,$3,'Registro del compañero'),('entry',$2,$4,'Otro depósito'),('entry',$2,$5,'Depósito anterior')",[id.w,id.w2,id.peer,id.other,id.dep]);
  const visible=await asUser(id.dep,tx=>tx.query('select count(*)::int n from movements'));
  assert.equal(visible.rows[0].n,1006,'RLS excludes both unrelated-warehouse records before UI filters');

  server=http.createServer((req,res)=>{
    const name=req.url==='/'?'index.html':req.url.slice(1).split('?')[0],file=path.join(root,'dist',name);
    if(name.includes('..')||!fs.existsSync(file))return res.writeHead(404).end();
    res.writeHead(200,{'Content-Type':name.endsWith('.js')||name.endsWith('.mjs')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html':'image/jpeg'});res.end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,executablePath:process.env.AVH_CHROME_BIN||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
  async function open(user,viewport){
    const context=await browser.newContext({viewport}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.clock.install();
    await page.route('**/*supabase.co/**',async route=>{
      const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').at(-1),headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
      if(req.method()==='OPTIONS')return route.fulfill({headers,body:''});
      if(url.pathname.startsWith('/auth/'))return route.fulfill({headers,json:{user:{id:user}}});
      if(table==='fabrication_context')return route.fulfill({headers,json:{workshops:[],active_orders:0,produced_qty:0}});
      if(['inventory_recount_context','record_inventory_recount'].includes(table)){
        const a=req.postDataJSON();
        try{
          const args=table==='inventory_recount_context'?[a.p_warehouse_id,a.p_product_id]:[a.p_warehouse_id,a.p_product_id,a.p_counted_qty,a.p_expected_version,a.p_reason,a.p_request_id];
          const sql=table==='inventory_recount_context'?'select inventory_recount_context($1,$2) r':'select record_inventory_recount($1,$2,$3,$4,$5,$6) r';
          const result=await asUser(user,async tx=>(await tx.query(sql,args)).rows[0].r);
          if(table==='record_inventory_recount'){
            recountRequests.push(a);
            if(loseFirstRecountResponse){loseFirstRecountResponse=false;return route.fulfill({headers,status:503,json:{message:'Respuesta perdida después del commit'}});}
          }
          return route.fulfill({headers,json:result});
        }catch(e){return route.fulfill({headers,status:400,json:{message:e.message}});}
      }
      if(url.pathname.includes('/rpc/'))return route.fulfill({headers,json:[]});
      try{
        let rows=[];
        if(table==='movements'){
          historyRequests.push({user,params:Object.fromEntries(url.searchParams)});
          rows=await asUser(user,async tx=>(await tx.query("select m.*,coalesce((select jsonb_agg(to_jsonb(l)||jsonb_build_object('products',jsonb_build_object('name',p.name,'base_unit',p.base_unit))) from movement_lines l join products p on p.id=l.product_id where l.movement_id=m.id),'[]'::jsonb) movement_lines from movements m order by m.created_at desc,m.id desc")).rows);
        }else if(['profiles','products','warehouses','suppliers','barges','product_presentations','v_stock_by_warehouse','v_stock_status'].includes(table))rows=await asUser(user,async tx=>(await tx.query('select * from public.'+table)).rows);
        for(const key of ['id','warehouse_id','created_by']){const f=url.searchParams.get(key);if(f?.startsWith('eq.'))rows=rows.filter(x=>x[key]===f.slice(3));}
        const or=url.searchParams.get('or');if(or){assert.equal(or,`(warehouse_from_id.eq.${id.w},warehouse_to_id.eq.${id.w})`);rows=rows.filter(x=>x.warehouse_from_id===id.w||x.warehouse_to_id===id.w);}
        const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||1000);
        return route.fulfill({headers,json:rows.slice(offset,offset+limit)});
      }catch(e){return route.fulfill({headers,status:400,json:{message:e.message}});}
    });
    await page.routeWebSocket('**/*supabase.co/**',socket=>socket.onMessage(raw=>{const m=JSON.parse(String(raw));if(m.event==='phx_join')socket.send(JSON.stringify({topic:m.topic,event:'phx_reply',ref:m.ref,payload:{status:'ok'}}));}));
    await page.addInitScript(({user})=>{
      localStorage.setItem('avh_v2_session',JSON.stringify({user:{id:user},access_token:'isolated-test',refresh_token:'isolated-test',expires_at:Date.now()+3600000}));
      localStorage.setItem('avh_user_guide_v1:'+user,'seen');
    },{user});
    await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('html[data-avh-boot="ok"]');await page.waitForSelector('#main:not(.hide)');return{page,context};
  }
  for(const viewport of [{width:390,height:844},{width:1440,height:1000}]){
    const {page:p,context}=await open(id.dep,viewport);
    assert.equal(await p.locator('.nav [data-page="moves"]').isVisible(),true);
    await p.locator('#depMovementHistory').click();await p.waitForFunction(()=>document.querySelector('#moveHistoryState')?.textContent==='1005 movimientos registrados por vos.');
    assert.equal(await p.locator('#page-moves.on').count(),1);
    assert.equal(await p.locator('#moveList [data-movement]').count(),1005);
    assert.equal(await p.locator('#moveWarehouse').isVisible(),false);
    assert.doesNotMatch(await p.locator('#moveList').textContent(),/Registro del compañero|Otro depósito|Depósito anterior/);
    assert.equal(await p.locator('[data-void-movement]').count(),0);
    await p.locator('#moveType').selectOption('exit');assert.equal(await p.locator('#moveList [data-movement]').count(),201);
    await p.locator('#moveType').selectOption('all');await p.locator('#moveSearch').fill('1');
    await p.locator('#moveList .movement-row .title').filter({hasText:/^Inventario inicial #1$/}).click();
    assert.match(await p.locator('#modalBody').textContent(),/Total: 30 kg/);
    assert.match(await p.locator('#modalBody').textContent(),/Registro histórico anterior al caché de inicio/);
    await p.locator('#modalClose').click();await p.locator('#moveSearch').fill('');
    await p.locator('#moveToDate').fill('2026-10-31');assert.equal(await p.locator('#moveList [data-movement]').count(),0);
    await p.locator('#moveToDate').fill('');
    assert.match(await p.locator('#moveList').textContent(),/ANULADO/);
    await p.locator('#moveList [data-correct]').first().click();assert.equal(await p.locator('#corrReason').isVisible(),true);await p.locator('#modalClose').click();
    // A normal synchronization must preserve the current page and search controls.
    await p.locator('#moveSearch').fill('Operario');await p.evaluate(()=>loadAll(true));
    assert.equal(await p.locator('#page-moves.on').count(),1);assert.equal(await p.locator('#moveSearch').inputValue(),'Operario');
    await p.waitForFunction(()=>document.querySelector('#moveHistoryState')?.textContent==='1005 movimientos registrados por vos.');
    assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await context.close();
  }
  const {page:a,context}=await open(id.admin,{width:1440,height:1000});
  await a.locator('.nav [data-page="moves"]').click();await a.waitForFunction(()=>document.querySelector('#moveHistoryState')?.textContent==='1008 movimientos.');
  assert.equal(await a.locator('#moveWarehouse').isVisible(),true);assert.ok(await a.locator('[data-void-movement]').count()>0);
  assert.equal(await a.locator('#inventoryRecountNew').count(),0);await context.close();
  assert.ok(historyRequests.some(r=>r.user===id.dep&&r.params.created_by==='eq.'+id.dep&&r.params.offset==='1000'));
  assert.ok(historyRequests.some(r=>r.user===id.admin&&!r.params.created_by&&r.params.offset==='1000'));
  for(const viewport of [{width:390,height:844},{width:1440,height:1000}]){
    const {page:p,context}=await open(id.dep,viewport);
    await p.locator('#depGoStock').click();await p.locator('[data-recount-stock]').click();
    await p.waitForSelector('#inventoryRecountQty');
    assert.equal(await p.locator('#inventoryRecountQty').inputValue(),viewport.width===390?'30':'7');
    await p.locator('#inventoryRecountQty').fill('0');await p.locator('#inventoryRecountReason').fill('Corrección de cantidad al contar el depósito');
    assert.match(await p.locator('#inventoryRecountPreview').textContent(),/stock quedará en 0 kg/);
    if(process.env.AVH_QA_OUTPUT){fs.mkdirSync(process.env.AVH_QA_OUTPUT,{recursive:true});await p.screenshot({path:path.join(process.env.AVH_QA_OUTPUT,`conteo-${viewport.width}.png`),fullPage:true});}
    await p.locator('#inventoryRecountSave').click();
    if(viewport.width===390){
      await p.waitForFunction(()=>document.querySelector('#inventoryRecountSave')?.textContent==='Reintentar guardado');
      assert.equal(await p.locator('#inventoryRecountQty').isDisabled(),true);
      await p.locator('#inventoryRecountSave').click();
    }
    await p.waitForSelector('#inventoryRecountDone');
    if(viewport.width===390)assert.equal(recountRequests[0].p_request_id,recountRequests[1].p_request_id,'uncertain response retries the exact same request');
    assert.match(await p.locator('#inventoryRecount').textContent(),/quedó en 0 kg/);
    assert.equal(Number((await q('select sum(quantity_remaining) n from inventory_batches where warehouse_id=$1 and product_id=$2',[id.w,id.product])).rows[0].n),0);
    await p.locator('#inventoryRecountDone').click();await p.locator('#inventoryRecountNew').click();
    await p.locator('#inventoryRecountProduct').selectOption(id.product);await p.locator('#inventoryRecountChoose').click();
    await p.waitForSelector('#inventoryRecountQty');assert.equal(await p.locator('#inventoryRecountQty').inputValue(),'0');
    await p.locator('#inventoryRecountQty').fill('7');await p.locator('#inventoryRecountReason').fill('Recuento físico verificado');
    // Background updates must not replace the count being edited.
    await p.evaluate(()=>loadAll(true));assert.equal(await p.locator('#inventoryRecountQty').inputValue(),'7');
    await p.locator('#inventoryRecountSave').click();await p.waitForSelector('#inventoryRecountDone');await p.locator('#inventoryRecountDone').click();
    assert.match(await p.locator('#stockList').textContent(),/7 kg/);
    assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await context.close();
  }
  assert.equal((await q("select count(*)::int n from audit_events where action='inventory_recounted'")).rows[0].n,4,'four counts, including a lost-response retry, create four audit records');
  assert.deepEqual(errors,[]);
  console.log('Browser OK: own history beyond 1000 rows; real PostgreSQL recounts on mobile/desktop, zero balances, absolute totals, lost-response retry, audit, form preservation and scoped admin/depositor controls.');
}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await db.close();}
