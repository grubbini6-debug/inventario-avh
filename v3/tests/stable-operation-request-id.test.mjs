import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../src/core/api.js',import.meta.url),'utf8');

function storage(){
  const values=new Map();
  return{
    getItem:key=>values.has(key)?values.get(key):null,
    setItem:(key,value)=>values.set(key,String(value)),
    removeItem:key=>values.delete(key)
  };
}

function response(status,data={}){
  return{ok:status>=200&&status<300,status,text:async()=>JSON.stringify(data),headers:{}};
}

function context(fetch){
  const c=vm.createContext({
    fetch,API:'https://example.invalid',KEY:'test',SESSION_KEY:'session',
    session:null,localStorage:storage(),Date,JSON,crypto,Object,Array,Number
  });
  vm.runInContext(source,c);
  return c;
}

test('stock mutation reuses request id after uncertain 5xx and rotates after success',async()=>{
  const bodies=[];let call=0;
  const c=context(async(_url,opt)=>{
    bodies.push(JSON.parse(opt.body));
    call++;
    return call===1?response(503,{message:'temporary'}):response(200,{ok:true});
  });
  const args={p_warehouse_id:'warehouse',p_items:[{product_id:'product',quantity:1}]};

  const first=await vm.runInContext('rpc("record_entry",'+JSON.stringify(args)+')',c);
  assert.equal(first.status,503);
  const second=await vm.runInContext('rpc("record_entry",'+JSON.stringify(args)+')',c);
  assert.equal(second.status,200);
  assert.equal(bodies[0].p_items[0].request_id,bodies[1].p_items[0].request_id);

  const third=await vm.runInContext('rpc("record_entry",'+JSON.stringify(args)+')',c);
  assert.equal(third.status,200);
  assert.notEqual(bodies[2].p_items[0].request_id,bodies[1].p_items[0].request_id);
});

test('stock mutation reuses request id after lost network response',async()=>{
  const bodies=[];let call=0;
  const c=context(async(_url,opt)=>{
    bodies.push(JSON.parse(opt.body));
    call++;
    if(call===1)throw new Error('connection lost');
    return response(200,{ok:true});
  });
  const args={p_from_warehouse_id:'a',p_to_warehouse_id:'b',p_items:[{product_id:'product',quantity:2}]};

  const first=await vm.runInContext('rpc("record_transfer",'+JSON.stringify(args)+')',c);
  assert.equal(first.network,true);
  const second=await vm.runInContext('rpc("record_transfer",'+JSON.stringify(args)+')',c);
  assert.equal(second.status,200);
  assert.equal(bodies[0].p_items[0].request_id,bodies[1].p_items[0].request_id);
});
