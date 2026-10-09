// Real browser + isolated PostgreSQL. Every Supabase URL is intercepted; production receives no traffic.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {PGlite} from '@electric-sql/pglite';
import * as pdfLib from 'pdf-lib';
import {makeFabricationPdf,base64} from '../../edge-functions/_shared/fabrication-pdf.mjs';
import {setupInitialInventory} from '../helpers/initial-inventory-fixture.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const db=new PGlite(),ids={admin:randomUUID(),isaac:randomUUID(),other:randomUUID(),w:randomUUID(),w2:randomUUID(),raw:randomUUID(),finished:randomUUID(),counted:randomUUID()};
let browser,server,date,dropNamedResponse=false;const errors=[],initialRequests=[];
const q=(sql,args=[])=>db.query(sql,args);
const command=async(action,data)=>{await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:ids.admin,role:'authenticated'})]);return (await q('select fabrication_command($1,$2::jsonb,$3) r',[action,JSON.stringify(data),randomUUID()])).rows[0].r;};
try{
  await db.exec(read('tests/fixtures/fabrication-inventory.sql'));await db.exec(read('migrations/20261008232715_fabricacion_naval.sql'));
  await setupInitialInventory(db);await db.exec(read('migrations/20261009130000_initial_inventory_named_material.sql'));
  await q('insert into auth.users(id) select unnest($1::uuid[])',[[ids.admin,ids.isaac,ids.other]]);
  await q("insert into warehouses(id,code,name) values($1,'TALLER','Taller naval existente'),($2,'OTRO','Otro depósito')",[ids.w,ids.w2]);
  await q("insert into profiles(id,username,full_name,role,warehouse_id) values($1,'compras','Encargado de Compras','admin',null),($2,'isaac','Isaac','depositor',$4),($3,'otro','Otro depositario','depositor',$5)",[ids.admin,ids.isaac,ids.other,ids.w,ids.w2]);
  await q("insert into products(id,name,base_unit) values($1,'Acero ASTM A36','kg'),($2,'Bularcama BU-001','unidad')",[ids.raw,ids.finished]);
  await q("insert into products(id,name,base_unit,sku) values($1,'Alambre 1 mm','kg','AL-1')",[ids.counted]);
  await q("insert into product_presentations(product_id,label,unit,factor_to_base) values($1,'Rollo 12 kg','rollo',12)",[ids.counted]);
  await q('insert into warehouse_opening_inventory(warehouse_id,opened_by) values($1,$3),($2,$3)',[ids.w,ids.w2,ids.admin]);
  await command('configure',{warehouse_id:ids.w,enabled:true,email_recipients:[]});
  await command('access',{warehouse_id:ids.w,user_id:ids.isaac,access_level:'operator'});await command('access',{warehouse_id:ids.w,user_id:ids.admin,access_level:'supervisor'});
  await command('worker',{warehouse_id:ids.w,name:'Operario de prueba',specialty:'Polivalente'});
  await q('select record_entry($1,null,null,$2::jsonb,null)',[ids.w,JSON.stringify([{product_id:ids.raw,quantity:100,unit:'kg',factor_to_base:1,unit_cost:5,currency:'PYG'}])]);
  date=(await q("select (now() at time zone 'America/Asuncion')::date::text d")).rows[0].d;
  const known=new Set((await q("select table_name from information_schema.tables where table_schema='public'")).rows.map(r=>r.table_name));
  async function adapter(url,method,body,user){
    return db.transaction(async tx=>{
      await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:user,role:'authenticated'})]);await tx.exec('set local role authenticated');
      const table=url.pathname.split('/').at(-1),params=url.searchParams;
      if(url.pathname.includes('/rpc/')){
        if(table==='fabrication_context')return (await tx.query('select fabrication_context() r')).rows[0].r;
        if(table==='fabrication_day')return (await tx.query('select fabrication_day($1,$2) r',[body.p_warehouse,body.p_date])).rows[0].r;
        if(table==='fabrication_command')return (await tx.query('select fabrication_command($1,$2::jsonb,$3) r',[body.p_action,JSON.stringify(body.p_data),body.p_request_id])).rows[0].r;
        if(table==='record_initial_inventory'||table==='record_initial_inventory_named'){
          initialRequests.push({table,body});
          return (await tx.query(`select public.${table}($1,$2::jsonb,$3) r`,[body.p_warehouse_id,JSON.stringify(body.p_items),body.p_notes])).rows[0].r;
        }
        return [];
      }
      if(!known.has(table))return [];
      const filters=[],args=[];
      for(const [k,v] of params){if(['select','order','limit','offset'].includes(k))continue;if(!/^[a-z_]+$/.test(k)||!v.startsWith('eq.'))continue;args.push(v.slice(3));filters.push(`t.${k}=$${args.length}`);}
      let order='';const orderParam=params.get('order');if(orderParam&&/^[a-z_. ,]+$/.test(orderParam))order=' order by '+orderParam.split(',').map(x=>{const [key,direction]=x.split('.');return `t.${key} ${direction==='desc'?'desc':'asc'}`;}).join(',');
      const limit=Math.min(Number(params.get('limit')||1000),1000),offset=Math.max(Number(params.get('offset')||0),0);
      let select='t.*';if(table==='movements')select=`t.*,(select coalesce(jsonb_agg(to_jsonb(l)||jsonb_build_object('products',jsonb_build_object('name',p.name,'base_unit',p.base_unit))),'[]') from movement_lines l join products p on p.id=l.product_id where l.movement_id=t.id) as movement_lines`;
      if(table==='fabrication_stock_links')select=`t.*,(select jsonb_build_object('movement_no',m.movement_no) from movements m where m.id=t.movement_id) as movements`;
      const result=await tx.query(`select ${select} from public.${table} t ${filters.length?'where '+filters.join(' and '):''}${order} limit ${limit} offset ${offset}`,args);
      // PostgREST serializes SQL date columns as YYYY-MM-DD; PGlite uses Date objects.
      for(const col of result.fields.filter(f=>f.dataTypeID===1082))for(const row of result.rows)if(row[col.name] instanceof Date)row[col.name]=row[col.name].toISOString().slice(0,10);
      return result.rows;
    });
  }
  server=http.createServer((req,res)=>{const name=req.url==='/'?'index.html':req.url.slice(1).split('?')[0];if(name.includes('..')){res.writeHead(403).end();return;}const full=path.join(root,'dist',name);if(!fs.existsSync(full)){res.writeHead(404).end();return;}const type=name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html':'image/jpeg';res.writeHead(200,{'Content-Type':type});res.end(fs.readFileSync(full));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,...(process.env.AVH_CHROME_BIN?{executablePath:process.env.AVH_CHROME_BIN}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  async function pageFor(user,viewport){
    const context=await browser.newContext({viewport}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*supabase.co/**',async route=>{
      const req=route.request(),url=new URL(req.url()),body=req.postDataJSON()||{},headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,PATCH,OPTIONS'};
      try{
        if(req.method()==='OPTIONS')return route.fulfill({status:200,headers,body:''});
        if(url.pathname.startsWith('/auth/'))return route.fulfill({headers,json:{user:{id:user}}});
        if(url.pathname.endsWith('/fabrication-report-pdf')){
          const reports=await adapter(new URL(`https://fixture/rest/v1/fabrication_reports?id=eq.${body.report_id}`),'GET',{},user);if(!reports[0])throw Error('No autorizado');
          const bytes=await makeFabricationPdf(reports[0],pdfLib);return route.fulfill({headers,json:{pdf_base64:base64(bytes),filename:'Reporte_prueba.pdf'}});
        }
        const result=await adapter(url,req.method(),body,user);
        if(dropNamedResponse&&url.pathname.endsWith('/record_initial_inventory_named')){dropNamedResponse=false;return route.abort('failed');}
        return route.fulfill({headers,json:result});
      }catch(e){return route.fulfill({status:400,headers,json:{message:e.message}});}
    });
    await page.routeWebSocket('**/*supabase.co/**',socket=>socket.close());
    await page.addInitScript(({user})=>localStorage.setItem('avh_v2_session',JSON.stringify({user:{id:user},access_token:'isolated-fixture',refresh_token:'fixture',expires_at:Date.now()+3600000})),{user});
    await page.goto(base);await page.waitForSelector('html[data-avh-boot="ok"]');await page.waitForSelector('#main:not(.hide)');return {page,context};
  }
  const {page,context}=await pageFor(ids.isaac,{width:390,height:844});
  await page.locator('#depInitialPriority').click();
  assert.equal(await page.locator('#depInitialProduct').evaluate(e=>e.tagName),'INPUT');
  assert.equal(await page.locator('#depInitialProduct').inputValue(),'');
  assert.ok(await page.locator('#depInitialCatalog option').count()>=3);
  await page.locator('#depInitialProduct').fill('al-1');assert.match(await page.locator('#depInitialPresentation').textContent(),/Rollo 12 kg/);await page.locator('#depInitialPresentation').selectOption('1');await page.locator('#depInitialQty').fill('2');
  await page.locator('#depInitialSaveNext').click();await page.waitForFunction(()=>document.querySelector('#depInitialProduct')?.value===''&&document.querySelector('.success'));
  assert.equal(initialRequests.at(-1).table,'record_initial_inventory');
  assert.equal((await q('select sum(quantity_remaining)::float n from inventory_batches where product_id=$1',[ids.counted])).rows[0].n,24);
  await page.locator('#depInitialProduct').fill('Perfil U 80 mm');await page.locator('#depInitialPresentation').selectOption('metro');await page.locator('#depInitialQty').fill('4');await page.locator('#depInitialLot').fill('L-INICIAL');await page.locator('#depInitialNotes').fill('Conteo físico del taller');
  await page.locator('#depInitialProduct').fill('Perfil U 80 mm galvanizado');
  assert.equal(await page.locator('#depInitialPresentation').inputValue(),'metro');
  await page.evaluate(()=>loadAll(true));
  assert.equal(await page.locator('#depInitialProduct').inputValue(),'Perfil U 80 mm galvanizado');assert.equal(await page.locator('#depInitialQty').inputValue(),'4');assert.equal(await page.locator('#depInitialNotes').inputValue(),'Conteo físico del taller');
  dropNamedResponse=true;await page.locator('#depInitialSaveNext').click();await page.locator('#depInitialMsg').getByText('No se pudo conectar con el servidor. Revisá tu conexión.').waitFor();
  assert.equal(await page.locator('#depInitialProduct').inputValue(),'Perfil U 80 mm galvanizado');assert.equal(await page.locator('#depInitialLot').inputValue(),'L-INICIAL');
  await page.locator('#depInitialSaveNext').click();await page.waitForFunction(()=>document.querySelector('#depInitialProduct')?.value===''&&document.querySelector('.success'));
  const namedRequests=initialRequests.filter(r=>r.table==='record_initial_inventory_named');assert.equal(namedRequests.length,2);assert.equal(namedRequests[0].body.p_items[0].request_id,namedRequests[1].body.p_items[0].request_id);
  const counted=(await q("select p.id,sum(b.quantity_remaining)::float n,count(b.id)::int batches from products p join inventory_batches b on b.product_id=p.id where p.name='Perfil U 80 mm galvanizado' group by p.id")).rows;
  assert.equal(counted.length,1);assert.equal(counted[0].n,4);assert.equal(counted[0].batches,1);
  assert.equal(await page.locator('#depInitialCatalog option[value="Perfil U 80 mm galvanizado"]').count(),1);
  // Blank and unit-less counts remain editable and never create an orphan catalog item.
  const requestCount=initialRequests.length;
  await page.locator('#depInitialProduct').fill('Material sin unidad');await page.locator('#depInitialQty').fill('1');await page.locator('#depInitialSaveNext').click();await page.locator('#depInitialMsg').getByText('Elegí la unidad del material.').waitFor();assert.equal(initialRequests.length,requestCount);
  const modalWidth=await page.evaluate(()=>({viewport:innerWidth,content:document.documentElement.scrollWidth}));assert.ok(modalWidth.content<=modalWidth.viewport+1,JSON.stringify(modalWidth));
  await page.locator('#modalClose').click();
  await page.locator('.nav [data-page="fabrication"]').click();await page.waitForSelector('#fnNewOrder');
  assert.ok((await page.locator('.nav [data-page="fabrication"]').isVisible()));
  await page.locator('#fnNewOrder').click();await page.locator('#fn-project').fill('Prefabricación de prueba');await page.locator('#fn-component_id').selectOption({label:'Bularcamas'});await page.locator('#fn-piece_code').fill('BU-001');await page.locator('#fn-drawing').fill('AVH-BU-01');await page.locator('#fn-drawing_revision').fill('A');await page.locator('#fn-requested_qty').fill('4');await page.locator('#fn-output_product_id').selectOption(ids.finished);await page.locator('[name="worker_ids"]').check();await page.locator('#fabricationForm button[type="submit"]').click();await page.waitForSelector('#modal',{state:'hidden'});await page.waitForSelector('[data-fn-order]');
  await page.locator('[data-fn-order]').click();await page.waitForSelector('#fnMaterial');
  await page.locator('#fnMaterial').click();await page.locator('#fn-product_id').selectOption(ids.raw);await page.locator('#fn-quantity').fill('20');await page.locator('#fabricationForm button[type="submit"]').click();await page.waitForSelector('#modal',{state:'hidden'});await page.waitForSelector('[data-fn-reserve]');
  await page.locator('[data-fn-reserve]').click();await page.locator('#fn-quantity').fill('20');await page.locator('#fabricationForm button[type="submit"]').click();await page.waitForSelector('#modal',{state:'hidden'});
  const advance=async state=>{await page.locator('#fnState').click();await page.locator('#fn-state').selectOption(state);await page.locator('#fabricationForm button[type="submit"]').click();await page.waitForSelector('#modal',{state:'hidden'});};
  await advance('preparation');await page.locator('[data-fn-consume]').click();await page.locator('#fn-quantity').fill('8');await page.locator('#fabricationForm button[type="submit"]').click();await page.waitForSelector('#modal',{state:'hidden'});
  await advance('manufacturing');await page.locator('#fnLog').click();await page.locator('#fn-activity').fill('Corte y armado');await page.locator('#fn-completed_qty').fill('2');await page.locator('input[name^="hours-"]').fill('4');await page.locator('#fabricationForm button[type="submit"]').click();await page.waitForSelector('#modal',{state:'hidden'});
  // A background refresh must preserve both the fabrication page and an in-progress form.
  await page.locator('#fnLog').click();await page.locator('#fn-activity').fill('Texto que no se debe perder');await page.evaluate(()=>loadAll(true));assert.equal(await page.locator('#fn-activity').inputValue(),'Texto que no se debe perder');assert.ok(await page.locator('#page-fabrication').evaluate(e=>e.classList.contains('on')));await page.locator('#modalClose').click();
  if(process.env.AVH_QA_DIR){fs.mkdirSync(process.env.AVH_QA_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.AVH_QA_DIR,'fabricacion-mobile.png'),fullPage:true});}
  const width=await page.evaluate(()=>({viewport:innerWidth,content:document.documentElement.scrollWidth}));assert.ok(width.content<=width.viewport+1,JSON.stringify(width));
  await page.locator('[data-fn-tab="reports"]').click();await page.locator('#fnClosure').click();await page.locator('#fn-notes').fill('Cierre de prueba');await page.locator('#fn-next_day_plan').fill('Terminar dos bularcamas');await page.locator('#fabricationForm button[type="submit"]').click();await page.waitForSelector('#modal',{state:'hidden'});await page.waitForSelector('[data-fn-pdf]');
  const download=page.waitForEvent('download');await page.locator('[data-fn-pdf]').first().click();assert.equal((await download).suggestedFilename(),'Reporte_prueba.pdf');
  // Complete the same order through the real quality, finished-stock and delivery forms.
  await page.locator('[data-fn-tab="orders"]').click();await page.locator('[data-fn-order]').click();await page.waitForSelector('#fnLog');
  await page.locator('#fnLog').click();await page.locator('#fn-activity').fill('Terminación del armado');await page.locator('#fn-completed_qty').fill('2');await page.locator('input[name^="hours-"]').fill('2');await page.locator('#fabricationForm button[type="submit"]').click();await page.waitForSelector('#modal',{state:'hidden'});
  await page.locator('[data-fn-reserve]').click();await page.locator('#fn-quantity').fill('0');await page.locator('#fabricationForm button[type="submit"]').click();await page.waitForSelector('#modal',{state:'hidden'});
  await advance('quality');await page.locator('#fnQuality').click();await page.locator('#fn-quantity').fill('4');await page.locator('#fn-measurements').fill('100 mm esperado / 100 mm verificado');await page.locator('#fn-weld_finish').fill('Terminación conforme al plano');await page.locator('#fabricationForm button[type="submit"]').click();await page.waitForSelector('#modal',{state:'hidden'});
  await page.locator('#fnOutput').click();await page.locator('#fn-quantity').fill('4');await page.locator('#fabricationForm button[type="submit"]').click();await page.waitForSelector('#modal',{state:'hidden'});await advance('completed');
  await page.locator('#fnDelivery').click();await page.locator('#fn-quantity').fill('4');await page.locator('#fn-person_receiving').fill('Responsable de montaje de prueba');await page.locator('#fn-destination').fill('Montaje de prueba');await page.locator('#fabricationForm button[type="submit"]').click();await page.waitForSelector('#modal',{state:'hidden'});
  await page.waitForSelector('#fnBack');assert.equal((await q('select state from fabrication_orders')).rows[0].state,'delivered');assert.equal((await q('select sum(quantity_remaining)::float qty from inventory_batches where product_id=$1',[ids.finished])).rows[0].qty,0);
  await context.close();
  const supervisor=await pageFor(ids.admin,{width:1440,height:1000});await supervisor.page.locator('.nav [data-page="fabrication"]').click();await supervisor.page.waitForSelector('[data-fn-order]');assert.equal(await supervisor.page.locator('#fnNewOrder').count(),0);await supervisor.page.locator('[data-fn-order]').click();await supervisor.page.waitForSelector('#fnBack');assert.equal(await supervisor.page.locator('#fnLog').count(),0);
  if(process.env.AVH_QA_DIR)await supervisor.page.screenshot({path:path.join(process.env.AVH_QA_DIR,'fabricacion-supervision.png'),fullPage:true});await supervisor.context.close();
  const other=await pageFor(ids.other,{width:390,height:844});assert.equal(await other.page.locator('.fabrication-nav').isVisible(),false);await other.page.evaluate(()=>goPage('fabrication'));assert.equal(await other.page.locator('#page-fabrication').evaluate(e=>e.classList.contains('on')),false);
  await other.page.locator('#depInitialPriority').click();assert.equal(await other.page.locator('#depInitialProduct').evaluate(e=>e.tagName),'SELECT');await other.page.locator('#depInitialProduct').selectOption(ids.counted);await other.page.locator('#depInitialQty').fill('1');await other.page.locator('#depInitialSaveNext').click();await other.page.locator('.success').waitFor();
  assert.equal(initialRequests.at(-1).table,'record_initial_inventory');assert.equal((await q('select sum(quantity_remaining)::float n from inventory_batches where warehouse_id=$1',[ids.w2])).rows[0].n,1);
  await other.context.close();
  assert.deepEqual(errors,[]);console.log('Browser OK: initial catalog selection and existing presentation; typed material → atomic count → lost-response retry without duplication; drafts survive refresh; other depositor unchanged; mobile fabrication lifecycle, PDF, quality, inventory, delivery and supervisor permissions.');
}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await db.close();}
