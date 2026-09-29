import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const apiSource=fs.readFileSync(new URL('../src/core/api.js',import.meta.url),'utf8');
const purchaseSource=fs.readFileSync(new URL('../src/features/purchases/base.js',import.meta.url),'utf8');
const intelligenceSource=fs.readFileSync(new URL('../src/features/purchases/intelligence.js',import.meta.url),'utf8');

function response(status,data){
  return{ok:status>=200&&status<300,status,text:async()=>JSON.stringify(data),headers:{}};
}

test('queryAll walks REST pages until the final short page',async()=>{
  const urls=[];let call=0;
  const c=vm.createContext({
    fetch:async(url)=>{urls.push(url);call++;return response(200,call===1?[{id:1},{id:2}]:[{id:3}])},
    API:'https://example.invalid',KEY:'test',SESSION_KEY:'session',session:null,
    localStorage:{getItem(){return null},setItem(){},removeItem(){}},Date,JSON,crypto,Object,Array,Number
  });
  vm.runInContext(apiSource,c);
  const r=await vm.runInContext("queryAll('things','*','order=id.asc',2,20)",c);
  assert.equal(r.data.length,3);
  assert.equal(r.complete,true);
  assert.match(urls[0],/limit=2&offset=0/);
  assert.match(urls[1],/limit=2&offset=2/);
});

test('purchase and intelligence loaders use paginated queries',()=>{
  assert.match(purchaseSource,/queryAll\('v_purchase_overview'/);
  assert.match(purchaseSource,/queryAll\('purchase_items'/);
  assert.match(intelligenceSource,/queryAll\('bi_purchase_facts'/);
  assert.match(intelligenceSource,/queryAll\('bi_purchase_item_facts'/);
  assert.doesNotMatch(intelligenceSource,/limit=1000/);
});
