import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';

const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const depositor={id:'depositor',role:'depositor',warehouse_id:'warehouse'};
const move=(id,changes={})=>({id,movement_no:id,type:'exit',status:'confirmed',created_by:'depositor',warehouse_from_id:'warehouse',created_at:'2026-11-10T12:00:00Z',movement_lines:[],...changes});
function ui(queryAll){
  const dom=new JSDOM(read('../src/index.template.html'),{runScripts:'outside-only'}),w=dom.window;
  Object.assign(w,{
    profile:{...depositor},D:{moves:[],moveHistory:null,moveHistoryLoaded:false,suppliers:[]},
    $:s=>w.document.querySelector(s),$$:s=>[...w.document.querySelectorAll(s)],
    queryAll,query:async()=>({data:[]}),lastSyncErrors:[],updateSyncState:()=>{},msg:(el,text)=>{el.textContent=text},
    whName:id=>id,bargeNo:id=>id,esc:v=>String(v??'').replaceAll('<','&lt;'),dt:v=>v,fmt:v=>String(v),
    TYPE_LABEL:{exit:'Salida',entry:'Entrada',transfer:'Transferencia',return:'Devolución',initial:'Inventario inicial'},
    movementRows:rows=>rows.map(m=>`<div data-movement="${m.id}">${m.id}</div>`).join(''),
    openModal:()=>{},
  });
  w.eval(read('../src/features/inventory/views.js'));
  w.movementRows=rows=>rows.map(m=>`<div data-movement="${m.id}">${m.id}</div>`).join('');
  w.bindMovementRows=()=>{};
  w.$('#moveWarehouse').innerHTML='<option value="all">Todos</option><option value="warehouse">Depósito</option>';
  return {w,close:()=>dom.window.close()};
}

test('full history requests only the depositor and assigned warehouse, preserving every operation and status',async()=>{
  const requests=[],rows=[move('old',{type:'entry',warehouse_from_id:null,warehouse_to_id:'warehouse'}),move('cancelled',{status:'cancelled'}),move('transfer',{type:'transfer',warehouse_to_id:'other'}),move('return',{type:'return'}),move('initial',{type:'initial'}),move('peer',{created_by:'peer'}),move('other',{warehouse_from_id:'other'})];
  const {w,close}=ui(async(...args)=>{requests.push(args);return{data:rows}});
  try{
    w.D.moves=[move('recent')];
    await w.ensureMoveHistory();
    assert.match(requests[0][2],/created_by=eq.depositor/);
    assert.match(requests[0][2],/or=\(warehouse_from_id.eq.warehouse,warehouse_to_id.eq.warehouse\)/);
    assert.match(requests[0][2],/order=created_at.desc,id.desc$/);
    assert.doesNotMatch(requests[0][2],/status=|type=|limit=/);
    assert.deepEqual(Array.from(w.movementDataset(),m=>m.id),['old','cancelled','transfer','return','initial']);
    w.renderMoves();
    assert.equal(w.$('#page-moves h2').textContent,'Mis movimientos');
    assert.equal(w.$('#moveWarehouse').hidden,true);
    assert.equal(w.$('#moveHistoryState').textContent,'5 movimientos registrados por vos.');
    w.$('#moveType').value='exit';w.renderMoves();
    assert.deepEqual(Array.from(w.$$('#moveList [data-movement]'),el=>el.dataset.movement),['cancelled']);
    w.$('#moveType').value='all';w.$('#moveFrom').value='2026-11-11';w.renderMoves();
    assert.equal(w.$$('#moveList [data-movement]').length,0);
  }finally{close()}
});

test('switching accounts cannot reuse privileged history or accept its pending response',async()=>{
  let resolveOld;const requests=[];
  const {w,close}=ui((...args)=>{requests.push(args);return requests.length===1?new Promise(resolve=>{resolveOld=resolve}):Promise.resolve({data:[move('mine')]})});
  try{
    w.profile={id:'admin',role:'admin'};
    const old=w.ensureMoveHistory();
    w.profile={...depositor};
    await w.ensureMoveHistory();
    resolveOld({data:[move('privileged',{warehouse_from_id:'other'})]});
    assert.equal((await old).stale,true);
    assert.deepEqual(Array.from(w.movementDataset(),m=>m.id),['mine']);
    w.profile={id:'next',role:'depositor',warehouse_id:'other'};
    w.D.moves=[move('mine'),move('next',{created_by:'next',warehouse_from_id:'other'})];
    assert.deepEqual(Array.from(w.movementDataset(),m=>m.id),['next']);
    w.profile={...depositor,warehouse_id:null};
    assert.match((await w.ensureMoveHistory()).error,/depósito asignado/);
    assert.equal(requests.length,2);
  }finally{close()}
});

test('admins retain full history and changing role restores the warehouse filter',async()=>{
  const requests=[];
  const {w,close}=ui(async(...args)=>{requests.push(args);return{data:[move('mine'),move('peer',{created_by:'peer'}),move('other',{warehouse_from_id:'other'})]}});
  try{
    w.renderMoves();
    w.profile={id:'admin',role:'admin'};await w.ensureMoveHistory();w.renderMoves();
    assert.equal(requests[0][2],'order=created_at.desc,id.desc');
    assert.equal(w.$('#page-moves h2').textContent,'Movimientos');
    assert.equal(w.$('#moveWarehouse').hidden,false);
    assert.equal(w.movementDataset().length,3);
  }finally{close()}
});
