// Normal Compras → real purchase RPCs → source attachment → the existing OC editor and PDF.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import * as pdfLib from 'pdf-lib';
import {database} from '../fixtures/commercial-database.mjs';
import {makeCommercialPdf} from '../../edge-functions/_shared/commercial-pdf.mjs';
import {printedText} from '../fixtures/pdf-text.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),out=process.env.AVH_QA_OUTPUT||'/tmp/avh-purchases-browser-qa';
const db=await database(),q=(sql,args=[])=>db.query(sql,args),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const ids=Object.fromEntries(['admin','production','depositor','company','supplier','warehouse'].map(k=>[k,randomUUID()]));
const errors=[],requests=[],files=new Map();let server,browser,queue=Promise.resolve(),mode='service';
async function login(user){await db.exec('reset role');await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:ids[user],role:'authenticated'})]);await db.exec('set role authenticated');}
function as(user,fn){const job=queue.then(async()=>{await login(user);return fn();});queue=job.catch(()=>{});return job;}
function owner(sql,args=[]){return as('admin',async()=>{await db.exec('reset role');return q(sql,args);});}
async function rpc(user,name,args){return as(user,async()=>{
 const definitions={admin_create_purchase_from_quote:['p_data','p_items'],admin_purchase_order_document:['p_purchase_id'],admin_confirm_purchase:['p_purchase_id'],commercial_context:[]},keys=definitions[name];
 if(!keys)throw Error('Unexpected RPC '+name);return(await q('select public.'+name+'('+keys.map((_,n)=>'$'+(n+1)).join(',')+') result',keys.map(k=>args[k]))).rows[0].result;
});}
const quote=()=>({document_type:'quotation',document_number:mode==='service'?'TALLER-101':'MAT-102',date:'2026-10-22',supplier_name:'Proveedor de prueba',supplier_tax_id:'80000000-0',customer_name:'Astillero Villa Hayes S.A.',customer_tax_id:'80000000-1',currency:'PYG',total:mode==='service'?150000:10000,payment_terms:'Contado',confidence:.99,validation:{issues:[]},items:[mode==='service'?{description:'Reparación de alimentador',quantity:1,unit:'servicio',unit_price:150000}:{description:'Chapa de prueba',quantity:10,unit:'kg',unit_price:1000}]});
try{
 await db.exec(read('migrations/20261019203337_purchase_receiving_unit_integrity.sql'));
 for(const file of ['20261020121555_ai_product_identity_metadata.sql','20261020121638_ai_product_identity_functions.sql','20261020121651_ai_product_identity_guards.sql','20261020121702_ai_quote_identity_validation.sql','20261020121938_ai_fractional_measure_aliases.sql'])await db.exec(read('migrations/'+file));
 const functions=read('migrations/20260926130000_null_safe_rpc_authorization.sql');await db.exec(functions.match(/CREATE OR REPLACE FUNCTION public\.admin_confirm_purchase\([\s\S]*?\$function\$;/)[0]);
 for(const user of ['admin','production','depositor'])await q('insert into auth.users(id) values($1)',[ids[user]]);
 await q("insert into warehouses(id,code,name) values($1,'QA','Depósito de prueba')",[ids.warehouse]);
 for(const user of ['admin','production','depositor'])await q('insert into profiles(id,username,full_name,role,warehouse_id,active) values($1,$2,$2,$3,$4,true)',[ids[user],user,user,user==='depositor'?ids.warehouse:null]);
 await q("insert into purchase_companies(id,name,legal_name,tax_id,po_prefix) values($1,'AVH','Astillero Villa Hayes S.A.','80000000-1','OC-AVH')",[ids.company]);
 await q("insert into suppliers(id,name,tax_id) values($1,'Proveedor de prueba','80000000-0')",[ids.supplier]);
 await db.exec("grant select,insert on public.purchase_documents to authenticated;alter table public.purchase_documents enable row level security;create policy purchase_browser_documents on public.purchase_documents for all to authenticated using(public.current_profile_role()='admin') with check(public.current_profile_role()='admin');");
 fs.mkdirSync(out,{recursive:true});
 server=http.createServer((req,res)=>{const name=req.url==='/'?'index.html':req.url.slice(1).split('?')[0],full=path.join(root,'dist',name);if(name.includes('..')||!fs.existsSync(full))return res.writeHead(404).end();const ext=path.extname(name);res.writeHead(200,{'Content-Type':['.js','.mjs'].includes(ext)?'text/javascript':ext==='.css'?'text/css':ext==='.html'?'text/html':'application/octet-stream'});res.end(fs.readFileSync(full));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({headless:true,...(process.env.AVH_CHROME_BIN?{executablePath:process.env.AVH_CHROME_BIN}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote']});
 async function open(user,viewport){
  const context=await browser.newContext({viewport}),page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));await page.clock.install();
  await page.route('**/*supabase.co/**',async route=>{
   const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').at(-1),headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET,POST,PATCH,OPTIONS'};requests.push(url.pathname);
   if(req.method()==='OPTIONS')return route.fulfill({headers,body:''});
   try{
    if(url.pathname.includes('/functions/v1/purchase-document-ai'))return route.fulfill({headers,json:{document:quote(),reviewed:true}});
    if(url.pathname.includes('/functions/v1/purchase-order-pdf')){const d=await rpc(user,'admin_purchase_order_document',{p_purchase_id:req.postDataJSON().purchase_id}),bytes=await makeCommercialPdf(d,pdfLib);return route.fulfill({headers,json:{filename:d.number+'.pdf',pdf_base64:Buffer.from(bytes).toString('base64')}});}
    if(['admin_create_purchase_from_quote','admin_purchase_order_document','admin_confirm_purchase','commercial_context'].includes(table))return route.fulfill({headers,json:await rpc(user,table,req.postDataJSON())});
    if(table==='purchase_documents'&&req.method()==='POST'){const d=req.postDataJSON();await as(user,()=>q('insert into purchase_documents(purchase_id,kind,file_path,file_name,document_number,document_date,analysis_status,analysis_data,uploaded_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[d.purchase_id,d.kind,d.file_path,d.file_name,d.document_number,d.document_date,d.analysis_status,d.analysis_data,d.uploaded_by]));return route.fulfill({headers,json:null});}
    if(url.pathname.includes('/storage/v1/object/purchase-documents/')){const name=url.pathname.split('/purchase-documents/')[1];files.set(name,req.postDataBuffer());return route.fulfill({headers,json:{Key:name}});}
    if(url.pathname.includes('/rpc/'))return route.fulfill({headers,json:table==='fabrication_context'?{workshops:[],active_orders:0,produced_qty:0}:[]});
    let rows=[];
    if(['profiles','warehouses','products','product_presentations','suppliers','purchase_companies'].includes(table))rows=(await owner('select * from public.'+table)).rows;
    if(user==='admin'&&table==='v_purchase_overview')rows=(await owner('select p.*,s.name supplier_name,c.name company_name from purchases p left join suppliers s on s.id=p.supplier_id left join purchase_companies c on c.id=p.company_id')).rows;
    if(user==='admin'&&['purchase_items','purchase_receipts','purchase_documents'].includes(table))rows=(await owner('select * from public.'+table)).rows;
    const id=url.searchParams.get('id');if(id?.startsWith('eq.'))rows=rows.filter(x=>x.id===id.slice(3));const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||1000);return route.fulfill({headers,json:rows.slice(offset,offset+limit)});
   }catch(e){return route.fulfill({headers,status:400,json:{message:e.message}});}
  });
  await page.routeWebSocket('**/*supabase.co/**',socket=>socket.onMessage(raw=>{const m=JSON.parse(String(raw));if(m.event==='phx_join')socket.send(JSON.stringify({topic:m.topic,event:'phx_reply',ref:m.ref,payload:{status:'ok'}}));}));
  await page.addInitScript(id=>localStorage.setItem('avh_v2_session',JSON.stringify({user:{id},access_token:'isolated-test',refresh_token:'isolated-test',expires_at:Date.now()+3600000})),ids[user]);await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('html[data-avh-boot="ok"]');await page.waitForSelector('#main:not(.hide)');
  assert.equal(await page.locator('[data-page="repairs"],#repairModule,#page-repairs').count(),0);assert.equal(await page.evaluate(()=>typeof window.AVHRepairs),'undefined');return{page,context};
 }
 const pdf=await pdfLib.PDFDocument.create();pdf.addPage();const source=Buffer.from(await pdf.save());
 const desktop=await open('admin',{width:1440,height:1000}),p=desktop.page;await p.locator('.nav [data-page="purchases"]').click();await p.waitForSelector('#newPurchase');await p.locator('#newPurchase').click();await p.locator('#smartFile').setInputFiles({name:'Presupuesto_taller.pdf',mimeType:'application/pdf',buffer:source});await p.waitForSelector('#smartGenerate');await p.locator('#smartDest').selectOption('service');assert.equal(await p.locator('#smartWhWrap').isVisible(),false);assert.match(await p.locator('[data-smart-stock-preview]').textContent(),/sin ingreso a stock/);assert.equal(await p.locator('input[name="serial_number"],#repair-equipment').count(),0);await p.screenshot({path:path.join(out,'servicio-en-compras-desktop.png'),fullPage:true});
 await p.locator('#smartGenerate').click();await p.waitForSelector('#poDownload');const service=(await owner("select * from purchases where purchase_type='service'")).rows[0];assert.ok(service);assert.equal(service.destination_type,'service');assert.equal(service.warehouse_id,null);assert.equal(service.status,'approved');assert.equal(service.purchase_confirmed_at,null);assert.equal((await owner('select bool_or(affects_inventory) stock from purchase_items where purchase_id=$1',[service.id])).rows[0].stock,false);assert.equal((await owner("select count(*)::int n from purchase_documents where purchase_id=$1 and kind='quotation'",[service.id])).rows[0].n,1);assert.ok([...files.keys()].some(k=>k.startsWith(service.id+'/')));
 await p.locator('#poConfirm').click();await p.waitForFunction(()=>document.querySelector('.po-status')?.textContent==='COMPRADO / PEDIDO');assert.equal((await owner('select status from purchases where id=$1',[service.id])).rows[0].status,'ordered');
 await p.locator('#poDownload').click();await p.waitForSelector('#cdPdf');assert.match(await p.locator('#cdTotals').textContent(),/150.000/);const downloading=p.waitForEvent('download');await p.locator('#cdPdf').click();const downloaded=await downloading;await downloaded.saveAs(path.join(out,'oc-servicio-compras.pdf'));const printed=printedText(await pdfLib.PDFDocument.load(fs.readFileSync(path.join(out,'oc-servicio-compras.pdf'))));assert.match(printed,/Reparación de alimentador/);assert.ok(printed.includes(service.po_number));
 await p.waitForFunction(()=>!AVHCommercial.state.busy);await desktop.context.close();
 mode='material';const mobile=await open('admin',{width:390,height:844}),m=mobile.page;await m.locator('.nav [data-page="purchases"]').click();await m.waitForSelector('#newPurchase');await m.locator('#newPurchase').click();await m.locator('#smartFile').setInputFiles({name:'Presupuesto_materiales.pdf',mimeType:'application/pdf',buffer:source});await m.waitForSelector('#smartGenerate');assert.equal(await m.locator('#smartDest').inputValue(),'warehouse');assert.ok(await m.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1));await m.screenshot({path:path.join(out,'compra-habitual-mobile.png'),fullPage:true});await m.locator('#smartGenerate').click();await m.waitForSelector('#poDownload');const material=(await owner("select * from purchases where purchase_type='stock'")).rows[0];assert.equal(material.warehouse_id,ids.warehouse);assert.equal((await owner('select bool_and(affects_inventory) stock from purchase_items where purchase_id=$1',[material.id])).rows[0].stock,true);
 for(const table of ['movements','inventory_batches','purchase_receipts'])assert.equal((await owner('select count(*)::int n from '+table)).rows[0].n,0,'creating an OC does not register a receipt');await mobile.context.close();
 for(const user of ['production','depositor']){const {page,context}=await open(user,{width:390,height:844});await page.evaluate(()=>AVHSmartPurchase.open());assert.equal(await page.locator('#smartFile').count(),0);await assert.rejects(rpc(user,'admin_create_purchase_from_quote',{p_data:{},p_items:[]}),/Solo el administrador/);await context.close();}
 assert.ok(!requests.some(s=>/repair_|equipment_assets/.test(s)),'no retired module requests');assert.deepEqual(errors,[]);console.log('Compras: presupuesto de servicio sin máquina/serie → OC normal → original adjunto → PDF → confirmación. Compra de materiales y roles intactos; Reparaciones ausente en escritorio y celular.');
}catch(e){console.error(e);if(browser)for(const c of browser.contexts())for(const p of c.pages()){console.error(await p.evaluate(()=>({page:document.querySelector('.page.on')?.id,modal:document.querySelector('#modalBody')?.textContent?.slice(-1500),error:document.querySelector('#commercialError')?.textContent})));await p.screenshot({path:path.join(out,'failure.png'),fullPage:true});}throw e;}finally{if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));await db.close();}
