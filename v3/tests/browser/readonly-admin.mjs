import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),out=process.env.AVH_QA_OUTPUT||'/tmp/avh-readonly-qa';
const user={id:'11111111-1111-4111-8111-111111111111',username:'administracion.consulta',full_name:'Administración',role:'admin_viewer',active:true,must_change_password:false};
const purchase={id:'22222222-2222-4222-8222-222222222222',po_number:'OC-AVH-2026-0123',company_id:'company',company_name:'Astillero Villa Hayes S.A.',supplier_id:'supplier',supplier_name:'Proveedor naval',warehouse_id:'wh',warehouse_name:'Villa Hayes',invoice_number:'001-001-0000123',status:'partially_received',currency:'USD',total_amount:3150,ordered_date:'2026-10-27',created_at:'2026-10-27T11:00:00Z'};
const data={profiles:[user],warehouses:[{id:'wh',name:'Villa Hayes'}],products:[{id:'p',name:'Alambre tubular E71T-1C',base_unit:'kg'}],suppliers:[{id:'supplier',name:'Proveedor naval'}],purchase_companies:[{id:'company',name:'AVH'}],v_purchase_overview:[purchase],purchases:[purchase],purchase_items:[{id:'item',purchase_id:purchase.id,description:'Alambre tubular E71T-1C',quantity:1000,received_qty:500,unit:'kg',unit_price:3.15}],purchase_documents:[{id:'doc',purchase_id:purchase.id,kind:'invoice',document_number:purchase.invoice_number,file_name:'Factura.pdf',file_path:purchase.id+'/factura.pdf'}],v_stock_by_warehouse:[{warehouse_id:'wh',warehouse_name:'Villa Hayes',product_id:'p',product_name:'Alambre tubular E71T-1C',stock_qty:500,base_unit:'kg'}]};
const requests=[],errors=[];fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{const name=(req.url==='/'?'index.html':req.url.slice(1)).split('?')[0],full=path.join(root,'dist',name);if(name.includes('..')||!fs.existsSync(full))return res.writeHead(404).end();const ext=path.extname(name);res.writeHead(200,{'Content-Type':ext==='.js'?'text/javascript':ext==='.css'?'text/css':ext==='.html'?'text/html':'application/octet-stream'});res.end(fs.readFileSync(full));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.AVH_CHROME_BIN?{executablePath:process.env.AVH_CHROME_BIN}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
 for(const [device,viewport] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]){
  const context=await browser.newContext({viewport}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*supabase.co/**',async route=>{
   const req=route.request(),url=new URL(req.url()),headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
   if(req.method()==='OPTIONS')return route.fulfill({headers,body:''});requests.push({method:req.method(),path:url.pathname});
   const table=url.pathname.split('/').at(-1);let rows=data[table]||[];
   if(url.searchParams.has('id'))rows=rows.filter(r=>r.id===url.searchParams.get('id').slice(3));
   const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||1000);
   return route.fulfill({headers,json:rows.slice(offset,offset+limit)});
  });
  await page.routeWebSocket('**/*supabase.co/**',socket=>socket.onMessage(()=>{}));
  await page.addInitScript(id=>localStorage.setItem('avh_v2_session',JSON.stringify({user:{id},access_token:'isolated-viewer',expires_at:Date.now()+3600000})),user.id);
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('html[data-avh-boot="ok"]');await page.waitForSelector('#readonlyRows [data-readonly-open]');
  assert.equal(await page.locator('#newPurchase:visible,#fabExit:visible,input[type=file]:visible').count(),0);
  assert.ok((await page.locator('#readonlyRows').textContent()).includes(purchase.po_number));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await page.screenshot({path:path.join(out,'consulta-compras-'+device+'.png'),fullPage:true});
  await page.locator('#readonlySearch').fill('E71T');await page.locator('[data-readonly-open]').click();await page.waitForSelector('[data-readonly-file]');
  assert.equal(await page.locator('#modalBody input,#modalBody select,#modalBody textarea,#modalBody form').count(),0);
  assert.ok((await page.locator('#modalBody').textContent()).includes('Factura.pdf'));
  await page.screenshot({path:path.join(out,'expediente-'+device+'.png'),fullPage:true});
  await page.locator('#modalClose').click();await page.evaluate(()=>AVHReadonly.open('inventory'));await page.waitForSelector('#readonlyRows [data-readonly-open]');
  assert.ok((await page.locator('#readonlyRows').textContent()).includes('500 kg'));
  const before=requests.length,result=await page.evaluate(()=>rpc('admin_create_purchase',{}));assert.equal(result.status,403);assert.equal(requests.length,before);
  await context.close();
 }
 assert.deepEqual(errors,[]);assert.ok(requests.every(r=>r.method==='GET'));console.log('Administrador de solo lectura: escritorio y celular OK; consultas sin mutaciones.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
