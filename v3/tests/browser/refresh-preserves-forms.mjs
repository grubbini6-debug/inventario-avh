// Exercise the real polling timer and realtime handlers. All backend traffic is local test data.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {chromium} from 'playwright';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const ids={admin:randomUUID(),depositor:randomUUID(),warehouse:randomUUID(),warehouse2:randomUUID(),product:randomUUID(),company:randomUUID(),supplier:randomUUID(),purchase:randomUUID(),item:randomUUID()};
const warehouse={id:ids.warehouse,name:'Depósito de prueba',code:'PRUEBA',active:true};
const profiles=[{id:ids.admin,username:'admin.prueba',full_name:'Administración de prueba',role:'admin',active:true,must_change_password:false},{id:ids.depositor,username:'depositario.prueba',role:'depositor',warehouse_id:ids.warehouse,active:true,must_change_password:false}];
const purchase={id:ids.purchase,company_id:ids.company,supplier_id:ids.supplier,supplier_name:'Proveedor de prueba',company_name:'AVH de prueba',status:'ordered',purchase_type:'material',destination_type:'warehouse',warehouse_id:ids.warehouse,warehouse_name:warehouse.name,urgency:'normal',currency:'PYG',total_amount:100,ordered_date:'2026-10-09',created_at:'2026-10-09T10:00:00Z',delivery_mode:'single',invoice_number:null,notes:null};
let stock=20,blockedProducts=null,enteredProducts=null;
let server,browser;const errors=[];
const data={
  warehouses:[warehouse,{id:ids.warehouse2,name:'Otro depósito de prueba',code:'OTRO',active:true}],
  products:[{id:ids.product,name:'Acero de prueba',base_unit:'kg',active:true}],
  profiles,
  suppliers:[{id:ids.supplier,name:'Proveedor de prueba',active:true}],
  purchase_companies:[{id:ids.company,name:'AVH de prueba',active:true}],
  purchases:[purchase],
  v_purchase_overview:[purchase],
  purchase_items:[{id:ids.item,purchase_id:ids.purchase,product_id:ids.product,description:'Acero de prueba',quantity:10,unit:'kg',factor_to_base:1,unit_price:10,received_qty:0,total_amount:100}],
};

try{
  server=http.createServer((req,res)=>{
    const name=req.url==='/'?'index.html':req.url.slice(1).split('?')[0];
    if(name.includes('..'))return res.writeHead(403).end();
    const full=path.join(root,'dist',name);if(!fs.existsSync(full))return res.writeHead(404).end();
    res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.html')?'text/html':'image/jpeg'});res.end(fs.readFileSync(full));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser=await chromium.launch({headless:true,...(process.env.AVH_CHROME_BIN?{executablePath:process.env.AVH_CHROME_BIN}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});

  async function open(user,viewport){
    const context=await browser.newContext({viewport}),page=await context.newPage(),sockets=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.clock.install();
    await page.route('**/*supabase.co/**',async route=>{
      const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').at(-1);
      const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,PATCH,OPTIONS'};
      if(req.method()==='OPTIONS')return route.fulfill({headers,body:''});
      if(url.pathname.startsWith('/auth/'))return route.fulfill({headers,json:{user:{id:user}}});
      if(url.pathname.endsWith('/rpc/fabrication_context'))return route.fulfill({headers,json:{workshops:[],active_orders:0,produced_qty:0}});
      if(url.pathname.includes('/rpc/'))return route.fulfill({headers,json:[]});
      if(table==='products'&&blockedProducts){enteredProducts?.();await blockedProducts;}
      let rows=data[table]||[];
      if(table==='v_stock_by_warehouse')rows=[{warehouse_id:ids.warehouse,warehouse_name:warehouse.name,product_id:ids.product,product_name:'Acero de prueba',base_unit:'kg',stock_qty:stock}];
      const id=url.searchParams.get('id');if(id?.startsWith('eq.'))rows=rows.filter(x=>x.id===id.slice(3));
      return route.fulfill({headers,json:rows});
    });
    await page.routeWebSocket('**/*supabase.co/**',socket=>{
      sockets.push(socket);socket.onMessage(raw=>{const message=JSON.parse(String(raw));if(message.event==='phx_join')socket.send(JSON.stringify({topic:message.topic,event:'phx_reply',ref:message.ref,payload:{status:'ok'}}));});
    });
    await page.addInitScript(({user})=>localStorage.setItem('avh_v2_session',JSON.stringify({user:{id:user},access_token:'isolated-test',refresh_token:'isolated-test',expires_at:Date.now()+3600000})),{user});
    await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForSelector('html[data-avh-boot="ok"]');await page.waitForSelector('#main:not(.hide)');
    // Track completion without replacing either the timer or the refresh implementation.
    await page.evaluate(()=>{const original=window.loadAll;window.loadAll=function(){window.__lastRefresh=original.apply(this,arguments);return window.__lastRefresh;};});
    const settle=async()=>page.evaluate(()=>window.__lastRefresh);
    const tick=async()=>{await page.clock.runFor(20100);await settle();};
    const live=async()=>{assert.equal(sockets.length,2,'both real realtime channels must be connected');for(const socket of sockets)socket.send(JSON.stringify({event:'postgres_changes',payload:{data:{table:'inventory_batches',type:'UPDATE',record:{}}}}));await page.clock.runFor(1200);await settle();};
    return {page,context,tick,live,sockets,settle};
  }

  const admin=await open(ids.admin,{width:1440,height:1000}),p=admin.page;
  await p.locator('.nav [data-shell-module="admin"]').click();await p.locator('#newUser').fill('isaac.de.prueba');await p.locator('#newUserName').fill('Texto sin guardar');await p.locator('#newUserWh').selectOption(ids.warehouse2);await p.locator('#newUserName').blur();
  await p.evaluate(()=>{window.__usernameNode=document.querySelector('#newUser');});
  await admin.tick();
  assert.equal(await p.locator('#newUser').inputValue(),'isaac.de.prueba','20-second polling must not clear an inline form');
  assert.equal(await p.locator('#newUserName').inputValue(),'Texto sin guardar');assert.equal(await p.locator('#newUserWh').inputValue(),ids.warehouse2);
  assert.equal(await p.evaluate(()=>window.__usernameNode===document.querySelector('#newUser')),true,'preserve the real input node, not a copied value');
  await admin.live();assert.equal(await p.locator('#newUser').inputValue(),'isaac.de.prueba','realtime must also preserve drafts');
  await p.locator('#refreshBtn').click();await admin.settle();assert.equal(await p.locator('#newUserName').inputValue(),'Texto sin guardar','manual refresh must also preserve drafts');

  // No edit yet: a focused control and its cursor still must survive.
  await p.locator('[data-admin="products"]').click();await p.locator('#prodName').focus();await admin.tick();assert.equal(await p.locator('#prodName').evaluate(e=>e===document.activeElement),true);

  // Start typing while a refresh is already in flight: check at render time, not request time.
  await p.locator('[data-admin="warehouses"]').click();await p.locator('#whNew').blur();
  let release;blockedProducts=new Promise(resolve=>release=resolve);const entered=new Promise(resolve=>enteredProducts=resolve);
  await p.evaluate(()=>{loadAll(false);});await entered;await p.locator('#whNew').fill('Texto escrito durante la consulta');await p.locator('#whNew').blur();release();await admin.settle();blockedProducts=null;enteredProducts=null;
  assert.equal(await p.locator('#whNew').inputValue(),'Texto escrito durante la consulta');

  // The actual inline purchase editor used to reopen itself on every refresh.
  await p.locator('.nav [data-page="purchases"]').click();await p.locator('[data-purchase-open]').first().click();await p.locator('#pdInvoice').fill('001-001-1234567');await p.locator('#pdReference').fill('Condiciones todavía sin guardar');await p.locator('#pdReference').blur();await admin.tick();assert.equal(await p.locator('#pdInvoice').inputValue(),'001-001-1234567');assert.equal(await p.locator('#pdReference').inputValue(),'Condiciones todavía sin guardar');await admin.live();assert.equal(await p.locator('#pdInvoice').inputValue(),'001-001-1234567');

  await p.locator('#purchaseBack').click();await p.locator('#purchaseSearch').fill('Acero');await p.locator('#purchaseSearch').blur();await admin.tick();assert.equal(await p.locator('#purchaseSearch').inputValue(),'Acero');

  // Open dialogs, including files, must keep the original nodes and selected files.
  await p.evaluate(()=>openMovement('entry'));await p.locator('#moveNotes').fill('Ingreso en preparación');await p.locator('#docFile').setInputFiles({name:'remito-prueba.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4 test')});await p.evaluate(()=>{window.__fileNode=document.querySelector('#docFile');});await admin.tick();await admin.live();assert.equal(await p.locator('#moveNotes').inputValue(),'Ingreso en preparación');assert.equal(await p.locator('#docFile').evaluate(e=>e.files[0]?.name),'remito-prueba.pdf');assert.equal(await p.evaluate(()=>window.__fileNode===document.querySelector('#docFile')),true);await p.locator('#modalClose').click();

  // Data must still load during editing, then display after leaving the form.
  stock=37;await p.evaluate(()=>loadAll(false));assert.equal(await p.evaluate(()=>D.stocks[0].stock_qty),37);
  await p.locator('.nav [data-page="stock"]').click();await admin.tick();assert.match(await p.locator('#stockList').innerText(),/37/);assert.equal(await p.locator('#page-stock').evaluate(e=>e.classList.contains('on')),true);assert.equal(await p.locator('#sectionTitle').innerText(),'Inventario');await admin.context.close();

  const dep=await open(ids.depositor,{width:390,height:844});
  await dep.page.locator('.nav [data-page="help"]').click();await dep.page.locator('#guideSearch').fill('remito');await dep.page.locator('#guideSearch').blur();
  await dep.tick();await dep.live();
  assert.equal(await dep.page.locator('#guideSearch').inputValue(),'remito');assert.ok(await dep.page.locator('#page-help').evaluate(e=>e.classList.contains('on')));assert.equal(await dep.page.locator('#sectionTitle').innerText(),'Cómo usar el sistema');assert.ok(await dep.page.locator('[data-guide-topic="receive"]').evaluate(e=>e.open));
  await dep.page.locator('.guide-footer [data-guide-action="home"]').click();
  await dep.page.locator('[data-dep-receive]').first().click();await dep.page.waitForSelector('[data-dep-receipt-qty]');await dep.page.locator('[data-dep-receipt-qty]').first().fill('3');await dep.page.locator('#depReceiptNotes').fill('Recepción móvil sin guardar');await dep.page.locator('#depReceiptNotes').blur();await dep.tick();await dep.live();assert.equal(await dep.page.locator('[data-dep-receipt-qty]').first().inputValue(),'3');assert.equal(await dep.page.locator('#depReceiptNotes').inputValue(),'Recepción móvil sin guardar');await dep.context.close();
  assert.deepEqual(errors,[]);console.log('Browser OK: 20-second timer, realtime, manual refresh, in-flight edits, focus, inline purchases, filters, selected files, mobile receipts, guide search/expansion/navigation and stock sync preserve the current work.');
}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));}
