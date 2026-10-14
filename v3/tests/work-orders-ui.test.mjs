import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {webcrypto,randomUUID} from 'node:crypto';
import {JSDOM} from 'jsdom';
import * as pdfLib from 'pdf-lib';
import {makeWorkOrderPdf} from '../edge-functions/_shared/work-order-pdf.mjs';
import {enrichWorkOrder} from '../edge-functions/_shared/work-order-analysis.mjs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const copy=x=>JSON.parse(JSON.stringify(x));
test('Galo workspace: select a sheet, review inputs, preserve unsaved forms, aggregate stock and recover a lost emission response',async()=>{
 const dom=new JSDOM('<nav class="nav"><button class="work-orders-nav hide" data-page="work-orders"></button></nav><section class="page on" id="page-work-orders"><div id="workOrderPanel"></div></section><div id="modal" class="hide"><div id="modalTitle"></div><div id="modalSubtitle"></div><div id="modalBody"></div></div>',{url:'https://avh.test/',runScripts:'outside-only'});
 const w=dom.window,orders=new Map(),downloads=[],calls=[],product=randomUUID(),warehouse=randomUUID();let access='editor',numbers=0,loseIssue=true;
 const wait=async check=>{for(let i=0;i<200;i++){if(check())return;await new Promise(r=>setTimeout(r,5));}throw Error('UI did not reach expected state: '+w.document.querySelector('#woError')?.textContent);};
 const click=id=>w.document.querySelector(id).click();
 const input=(id,value)=>{const el=w.document.querySelector(id);if(el.type==='checkbox')el.checked=value;else el.value=String(value);el.dispatchEvent(new w.Event('input',{bubbles:true}));};
 Object.defineProperty(w,'crypto',{value:webcrypto});w.URL.createObjectURL=blob=>{downloads.push({blob});return 'blob:test';};w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){downloads.at(-1).filename=this.download;};
 Object.assign(w,{
  profile:{id:randomUUID(),role:'depositor',active:true,username:'galo',warehouse_id:warehouse},
  D:{products:[{id:product,name:'Alambre',base_unit:'kg',active:true}],warehouses:[{id:warehouse,name:'Villa Hayes',active:true}],stocks:[{product_id:product,warehouse_id:warehouse,stock_qty:5}],profiles:[]},
  $:s=>w.document.querySelector(s),$$:s=>Array.from(w.document.querySelectorAll(s)),esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),fmt:v=>Number(v).toLocaleString('es-PY'),dt:v=>String(v),canonicalOperationValue:v=>v,
  goPage:()=>{},loadAll:async()=>{},canRefreshView:()=>true,
  openModal:(title,sub,html)=>{w.document.querySelector('#modalBody').innerHTML=html;w.document.querySelector('#modal').classList.remove('hide');},closeModal:()=>w.document.querySelector('#modal').classList.add('hide'),
 });
 w.rpc=async(name,args={})=>{
  if(name==='work_order_context')return {data:{access_level:access,access:[]}};
  calls.push({name,args:copy(args)});
  if(name==='create_supply_request')return {data:randomUUID()};
  const d=args.p_data,o=orders.get(d.order_id);
  if(args.p_action==='save'){const next={id:d.order_id,status:'draft',version:(o?.version||0)+1,payload:copy(d.payload)};orders.set(d.order_id,next);return{data:copy(next)};}
  if(args.p_action==='attachment'){o.source_file_path=d.path;return{data:copy(o)};}
  if(args.p_action==='issue'){o.number='OT-AVH-2026-'+String(++numbers).padStart(5,'0');o.status='issued';o.issued_payload=copy(o.payload);o.version++;if(loseIssue){loseIssue=false;return{error:'Respuesta de emisión perdida',status:503};}return{data:copy(o)};}
  throw Error('Unexpected command: '+args.p_action);
 };
 w.queryAll=async()=>({data:[...orders.values()].map(o=>({...copy(o),title:o.payload.title,vessel:o.payload.vessel,client:o.payload.client}))});
 w.query=async(table,select,extra)=>({data:table==='work_orders'?[copy(orders.get(extra.slice(6)))].filter(Boolean):[]});
 w.request=async()=>({data:{Key:'archive'}});
 w.edge=async(name,body)=>{
  if(name==='work-order-ai'){
   calls.push({name,body:copy(body)});const tasks=body.tasks;
   return{data:{analysis:enrichWorkOrder(tasks,{title:'Trabajo naval',vessel:'TEST 716',client:null,groups:[{rows:tasks.map(t=>t.source_row),operations:['Preparar y ejecutar'],acceptance:['Revisar dimensiones'],materials:[{description:'Alambre',unit:'kg',basis:'Definir longitud de soldadura'}]}]})}};
  }
  if(name==='work-order-pdf'){const o=orders.get(body.order_id),bytes=await makeWorkOrderPdf(o,pdfLib);return{data:{pdf_base64:Buffer.from(bytes).toString('base64'),filename:(o.number||'BORRADOR_OT')+'.pdf'}};}
  throw Error('Unexpected Edge Function');
 };
 const rows=[['Trabajo'],['Sector','Descripción','Cantidad','Unidad'],['Popa','Soldadura del primer elemento',1,'unidad'],['Proa','Soldadura del segundo elemento',1,'unidad']];
 w.XLSX={read:()=>({SheetNames:['Hoja A','Hoja B'],Sheets:{'Hoja A':{'!ref':'A1:D2',rows:[['No usar']]},'Hoja B':{'!ref':'A1:D4',rows}}}),utils:{decode_range:()=>({e:{r:3,c:3}}),sheet_to_json:ws=>ws.rows}};
 try{
  w.eval(read('../src/features/work-orders/model.js'));w.eval(read('../src/features/work-orders/workspace.js'));await w.AVHWorkOrders.refresh();
  assert.equal(w.document.querySelector('.work-orders-nav').classList.contains('hide'),false);
  const file={name:'Ejemplo.xlsx',size:100,type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer};
  const fileInput=w.document.querySelector('#woFile');Object.defineProperty(fileInput,'files',{value:[file]});fileInput.dispatchEvent(new w.Event('change'));await wait(()=>w.AVHWorkOrders.state.book&&!w.AVHWorkOrders.state.busy);
  const sheet=w.document.querySelector('#woSheet');sheet.value='Hoja B';sheet.dispatchEvent(new w.Event('change'));click('#woAnalyze');await wait(()=>w.document.querySelectorAll('.wo-task').length===2&&!w.AVHWorkOrders.state.busy);
  assert.equal(calls.find(c=>c.name==='work-order-ai').body.sheet,'Hoja B');
  input('#wo-client','Cliente & naval');input('#wo-responsible','Galo');input('#wo-order_date','2026-10-14');
  const clientElement=w.document.querySelector('#wo-client');await w.loadAll(false);assert.equal(w.document.querySelector('#wo-client'),clientElement);assert.equal(clientElement.value,'Cliente & naval');
  for(const [index,quantity] of [[0,2],[1,4]]){
   const selector=`.wo-task:nth-child(${index+1})`;
   input(selector+' [data-material-key="product_id"]',product);input(selector+' [data-material-key="quantity"]',quantity);input(selector+' [data-material-key="confirmed"]',true);
  }
  click('[data-wo-tab="materials"]');const cells=[...w.document.querySelectorAll('.wo-table tbody tr:first-child td')].map(x=>x.textContent);assert.equal(cells[1],'6 kg');assert.equal(cells[2],'6 kg');assert.equal(cells[3],'5 kg');assert.equal(cells[4],'1 kg');
  click('[data-group-supply]');assert.equal(w.document.querySelector('#woSupplyQty').value,'1');click('#woSupplySend');await wait(()=>!w.AVHWorkOrders.state.busy);assert.equal(calls.find(c=>c.name==='create_supply_request').args.p_quantity,1);
  click('[data-wo-tab="scope"]');click('#woSave');await wait(()=>w.AVHWorkOrders.state.current.version===1&&!w.AVHWorkOrders.state.busy);assert.equal(w.AVHWorkOrders.state.current.source_file_path.startsWith(w.AVHWorkOrders.state.current.id),true);
  click('#woPreview');await wait(()=>downloads.length===1&&!w.AVHWorkOrders.state.busy);assert.match(downloads[0].filename,/BORRADOR/);assert.ok(downloads[0].blob.size>1000);
  click('#woIssue');await wait(()=>!w.AVHWorkOrders.state.busy&&w.document.querySelector('#woError').textContent.includes('perdida'));assert.equal(numbers,1);
  click('#woIssue');await wait(()=>w.document.querySelector('#woPdf')&&!w.AVHWorkOrders.state.busy);assert.equal(numbers,1);assert.equal(w.AVHWorkOrders.state.current.number,'OT-AVH-2026-00001');assert.equal(w.document.querySelector('#wo-client').disabled,true);
  assert.equal(w.document.querySelectorAll('[data-save-quality]').length,0);click('#woPdf');await wait(()=>downloads.length===2&&!w.AVHWorkOrders.state.busy);assert.equal(downloads[1].filename,'OT-AVH-2026-00001.pdf');
  access=null;await w.loadAll(false);assert.match(w.document.querySelector('#workOrderPanel').textContent,/requiere/);assert.equal(w.document.querySelector('.work-orders-nav').classList.contains('hide'),true);
 }finally{dom.window.close();}
});
