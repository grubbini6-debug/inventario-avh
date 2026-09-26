import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
function client(fetch){
  const ctx=vm.createContext({fetch,API:'https://example.invalid',KEY:'test',SESSION_KEY:'session',session:{refresh_token:'old',access_token:'old',expires_at:1},localStorage:{setItem(){},removeItem(){}},Date,JSON,crypto});
  vm.runInContext(read('src/core/api.js'),ctx);return ctx;
}
const response=(status,data)=>({ok:status>=200&&status<300,status,json:async()=>data,text:async()=>JSON.stringify(data),headers:{}});
test('20 simultaneous expired-session requests share one token refresh',async()=>{
  let refreshes=0,queries=0;
  const c=client(async(url,opt)=>{if(url.includes('/auth/')){refreshes++;await new Promise(r=>setImmediate(r));return response(200,{access_token:'new',refresh_token:'new',expires_in:3600});}queries++;assert.equal(opt.headers.Authorization,'Bearer new');return response(200,[]);});
  await vm.runInContext("Promise.all(Array.from({length:20},()=>query('products')))",c);
  assert.equal(refreshes,1);assert.equal(queries,20);
});
test('refresh finishing after logout cannot restore the session',async()=>{
  let release;const c=client(()=>new Promise(r=>release=r));const pending=vm.runInContext('refreshSession()',c);
  vm.runInContext('saveSession(null)',c);release(response(200,{access_token:'new'}));
  assert.equal(await pending,false);assert.equal(c.session,null);
});
test('temporary auth outage preserves session, invalid refresh clears it',async()=>{
  for(const status of [429,503,400,401]){const c=client(async()=>response(status,{}));assert.equal(await vm.runInContext('refreshSession()',c),false);assert.equal(c.session===null,status===400||status===401);}
});
test('purchase loading retains previous data and reports failures',async()=>{
  const source=read('src/features/purchases/base.js');const start=source.indexOf('  async function loadPurchaseData()');const end=source.indexOf('\n  function ensurePurchasePage',start);
  let errors;
  const c=vm.createContext({profile:{role:'admin'},D:{purchases:[{id:'existing'}]},lastSyncErrors:[],query:async table=>table==='v_purchase_overview'?{error:'offline'}:{data:[]},updateSyncState:x=>errors=x,Set});
  vm.runInContext(source.slice(start,end),c);await vm.runInContext('loadPurchaseData()',c);
  assert.equal(c.D.purchases[0].id,'existing');assert.equal(errors[0].key,'purchases');
});
for(const slug of ['avh-admin-recover','avh-admin-temp-reset']){
  test(`${slug}: concurrent token submissions perform exactly one password reset`,async()=>{
    let handler,consumed=false,resets=0;
    const admin={from(table){const q={update(){q.claim=table==='admin_recovery_tokens';return q},eq(){return q},is(){return q},gt(){return q},select(){return q},async maybeSingle(){
      if(table==='profiles')return {data:{id:'admin-id',role:'admin',active:true}};
      if(q.claim){if(consumed)return {data:null};consumed=true;return {data:{id:'token-id'}};}
      return {data:{id:'token-id',username:'admin',expires_at:'2099-01-01',used_at:null}};
    }};return q},auth:{admin:{async updateUserById(){resets++;return {error:null}}}}};
    const source=read(`edge-functions/${slug}/index.ts`).replace(/^import .*;\n/m,'');
    const c=vm.createContext({Deno:{env:{get:()=> 'test'},serve:fn=>handler=fn},createClient:()=>admin,Response,URL,crypto,TextEncoder,Uint8Array,Uint32Array,Date});
    vm.runInContext(stripTypeScriptTypes(source),c);
    const request=()=>slug==='avh-admin-recover'?new Request('https://example.invalid',{method:'POST',body:new URLSearchParams({token:'test-token',password:'StrongPass123',confirm:'StrongPass123'})}):new Request('https://example.invalid',{method:'POST',body:new URLSearchParams({token:'test-token'})});
    const results=await Promise.all([handler(request()),handler(request())]);
    assert.equal(resets,1);assert.deepEqual(results.map(x=>x.status).sort(),[200,403]);
  });
}


test('temp reset GET only renders confirmation and performs no password reset',async()=>{
  let handler,resets=0;
  const admin={from(){throw new Error('GET must not touch database')},auth:{admin:{async updateUserById(){resets++;return {error:null}}}}};
  const source=read('edge-functions/avh-admin-temp-reset/index.ts').replace(/^import .*;\n/m,'');
  const c=vm.createContext({Deno:{env:{get:()=> 'test'},serve:fn=>handler=fn},createClient:()=>admin,Response,Request,URL,URLSearchParams,crypto,TextEncoder,Uint8Array,Uint32Array,Date});
  vm.runInContext(stripTypeScriptTypes(source),c);
  const r=await handler(new Request('https://example.invalid?token=test-token'));
  assert.equal(r.status,200);assert.equal(resets,0);assert.match(await r.text(),/Confirmar restablecimiento/);
});

test('hardening migration guards inactive profiles and aligns locks',()=>{
  const sql=read('migrations/20260926170000_active_profile_rls_and_lock_order.sql');
  assert.match(sql,/pr\.active=true/);
  assert.match(sql,/order by pi\.id\s+for update;[\s\S]*select \* into v_p from public\.purchases/);
  assert.match(sql,/warehouse_id=p_warehouse_id and status='open'\s+for update;/);
});
