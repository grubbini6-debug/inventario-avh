import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {PGlite} from '@electric-sql/pglite';
import {setupInitialInventory} from './helpers/initial-inventory-fixture.mjs';
import {setupOwnLoadEditor} from './helpers/own-load-editor-fixture.mjs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');

test('Depositor edits only their own unused loads with versioning, exact stock and audit',async t=>{
  const db=new PGlite(),ids={admin:randomUUID(),user:randomUUID(),peer:randomUUID(),other:randomUUID(),inactive:randomUUID(),w:randomUUID(),w2:randomUUID(),a:randomUUID(),b:randomUUID()};
  const q=(s,a=[])=>db.query(s,a),as=(actor,s,a=[])=>db.transaction(async tx=>{await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:actor,role:'authenticated'})]);await tx.exec('set local role authenticated');return tx.query(s,a)});
  const item=(product,quantity,unit='kg',factor=1)=>({product_id:product,quantity,unit,factor_to_base:factor});
  const count=async(items,actor=ids.user,warehouse=ids.w)=>(await as(actor,'select record_initial_inventory($1,$2::jsonb,$3) r',[warehouse,JSON.stringify(items),'Conteo original'])).rows[0].r;
  const context=async(id,actor=ids.user)=>(await as(actor,'select inventory_load_edit_context($1) r',[id])).rows[0].r;
  const items=c=>c.lines.map(l=>({line_id:l.line_id,product_id:l.product_id,quantity:Number(l.quantity),unit:l.unit,factor_to_base:Number(l.factor_to_base),presentation_label:l.presentation_label,lot_reference:l.lot_reference}));
  const args=(c,changes={})=>({p_movement_id:c.id,p_expected_version:c.version,p_items:items(c),p_notes:c.notes,p_reason:'Cantidad ingresada por error',p_request_id:randomUUID(),...changes});
  const save=async(a,actor=ids.user)=>(await as(actor,'select edit_inventory_load($1,$2,$3::jsonb,$4,$5,$6) r',[a.p_movement_id,a.p_expected_version,JSON.stringify(a.p_items),a.p_notes,a.p_reason,a.p_request_id])).rows[0].r;
  const stock=async(product)=>(await q('select coalesce(sum(quantity_remaining),0)::float n from inventory_batches where product_id=$1',[product])).rows[0].n;
  try{
    await db.exec(read('./fixtures/fabrication-inventory.sql'));await setupInitialInventory(db);await setupOwnLoadEditor(db);
    await q('insert into auth.users(id) select unnest($1::uuid[])',[[ids.admin,ids.user,ids.peer,ids.other,ids.inactive]]);
    await q("insert into warehouses(id,code,name) values($1,'VH','Villa Hayes'),($2,'OTRO','Otro depósito')",[ids.w,ids.w2]);
    await q("insert into profiles(id,username,role,warehouse_id,active) values($1,'compras','admin',null,true),($2,'deposito','depositor',$6,true),($3,'companero','depositor',$6,true),($4,'otro','depositor',$7,true),($5,'inactivo','depositor',$6,false)",[ids.admin,ids.user,ids.peer,ids.other,ids.inactive,ids.w,ids.w2]);
    await q("insert into products(id,name,base_unit) values($1,'Alambre <prueba>','kg'),($2,'Equipo naval','unidad')",[ids.a,ids.b]);
    await q('insert into warehouse_opening_inventory(warehouse_id,opened_by) values($1,$3),($2,$3)',[ids.w,ids.w2,ids.admin]);
    const original=await count([item(ids.a,2,'caja',15),item(ids.b,4,'unidad')]),c=await context(original);
    await t.test('Scoped context has no prices; other users, admin, inactive and anon cannot edit',async()=>{
      assert.equal(c.lines.length,2);assert.doesNotMatch(JSON.stringify(c),/unit_cost|entry_currency|exchange_rate/);
      for(const actor of [ids.peer,ids.other,ids.admin,ids.inactive]){
        await assert.rejects(context(original,actor),/Solo el depositario|Solo podés/);
        await assert.rejects(save(args(c),actor),/Solo el depositario|Solo podés/);
      }
      await q('update profiles set warehouse_id=$1 where id=$2',[ids.w2,ids.user]);await assert.rejects(context(original),/Solo podés/);await q('update profiles set warehouse_id=$1 where id=$2',[ids.w,ids.user]);
      await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role anon');return tx.query('select inventory_load_edit_context($1)',[original])}),/permission denied/);
      await assert.rejects(as(ids.user,'select avh_inventory_private.load_snapshot($1)',[original]),/permission denied/);
      await assert.rejects(as(ids.user,'update inventory_batches set quantity_remaining=0'),/permission denied/);
      await assert.rejects(as(ids.user,'update movement_lines set quantity=1'),/permission denied/);
      assert.equal(await stock(ids.a),30);
    });
    const changed=args(c);changed.p_items.find(l=>l.product_id===ids.a).quantity=3;changed.p_notes='Conteo verificado';
    let result;
    await t.test('Edits stock once, preserves source IDs and retains before/after in the admin audit',async()=>{
      result=await save(changed);assert.equal(await stock(ids.a),45);assert.equal(await stock(ids.b),4);
      assert.equal((await q('select count(*)::int n from movements')).rows[0].n,1);
      assert.equal((await q('select count(*)::int n from movement_lines')).rows[0].n,2);
      assert.equal((await context(original)).version,result.version);
      const audit=(await q("select * from audit_events where action='inventory_load_edited'")).rows[0];
      assert.equal(audit.actor_id,ids.user);assert.equal(audit.warehouse_id,ids.w);assert.match(audit.detail.reason,/error/);
      assert.equal(Number(audit.detail.before.lines.find(l=>l.product_id===ids.a).quantity),2);
      assert.equal(Number(audit.detail.after.lines.find(l=>l.product_id===ids.a).quantity),3);
      assert.deepEqual(await save(changed),result);assert.equal((await q("select count(*)::int n from audit_events where action='inventory_load_edited'")).rows[0].n,1);
      const reused=structuredClone(changed);reused.p_items[0].quantity+=1;await assert.rejects(save(reused),/identificador/);
      await assert.rejects(save(args(c)),/cambió mientras/);assert.equal(await stock(ids.a),45);
    });
    await t.test('Malformed multi-line changes and forged price/ownership data roll back completely',async()=>{
      const fresh=await context(original),valid=items(fresh);
      for(const bad of [0,-1,'NaN','Infinity',0.0000001,1e12]){
        const changed=structuredClone(valid);changed[0].quantity=9;changed[1].quantity=bad;
        await assert.rejects(save(args(fresh,{p_items:changed})),/inválida|rango/);
      }
      await assert.rejects(save(args(fresh,{p_items:[]})),/conservar todos/);
      await assert.rejects(save(args(fresh,{p_items:[valid[0],valid[0]]})),/no corresponden/);
      const forged=structuredClone(valid);forged[0].entry_unit_cost=1;await assert.rejects(save(args(fresh,{p_items:forged})),/Solo podés editar/);
      const foreign=structuredClone(valid);foreign[0].line_id=randomUUID();await assert.rejects(save(args(fresh,{p_items:foreign})),/no corresponden/);
      const wrongBase=structuredClone(valid);wrongBase.find(l=>l.product_id===ids.b).factor_to_base=2;await assert.rejects(save(args(fresh,{p_items:wrongBase})),/unidad y su equivalencia/);
      assert.equal(await stock(ids.a),45);assert.equal(await stock(ids.b),4);
    });
    await t.test('Changing product and unit transfers only the corrected batch and invalidates its old price',async()=>{
      const line=c.lines.find(l=>l.product_id===ids.a).line_id;
      await q("update movement_lines set entry_unit_cost=30,entry_currency='PYG' where id=$1",[line]);await q("update inventory_batches set unit_cost=2,currency='PYG' where source_line_id=$1",[line]);
      await assert.rejects(save(args(await context(original),{p_expected_version:result.version})),/cambió mientras/);
      const fresh=await context(original),changed=items(fresh),l=changed.find(l=>l.line_id===line);l.product_id=ids.b;l.unit='unidad';l.factor_to_base=1;l.quantity=2;
      const r=await save(args(fresh,{p_items:changed}));assert.equal(r.price_review_required,true);assert.equal(await stock(ids.a),0);assert.equal(await stock(ids.b),6);
      assert.equal((await q('select entry_unit_cost from movement_lines where id=$1',[line])).rows[0].entry_unit_cost,null);
      assert.equal((await context(original)).version,r.version);
    });
    await t.test('Closing an opening count blocks fresh edits and preserves successful retry results',async()=>{
      await q("update warehouse_opening_inventory set status='closed' where warehouse_id=$1",[ids.w]);
      await assert.rejects(context(original),/está cerrado/);await assert.rejects(save(args(c)),/está cerrado/);
      assert.deepEqual(await save(changed),result);await q("update warehouse_opening_inventory set status='open' where warehouse_id=$1",[ids.w]);
    });
    await t.test('A consumed load remains blocked even after a later return restores its quantity',async()=>{
      const product=randomUUID();await q("insert into products(id,name,base_unit) values($1,'Material consumido','kg')",[product]);
      const mid=await count([item(product,10)]),fresh=await context(mid);
      await as(ids.user,'select record_exit($1,null,null,$2,$3,$4::jsonb,null)',[ids.w,'Operario','Taller',JSON.stringify([item(product,1)])]);
      await assert.rejects(context(mid),/ya fue utilizada/);await assert.rejects(save(args(fresh)),/ya fue utilizada/);assert.equal(await stock(product),9);
      await q('update inventory_batches set quantity_remaining=quantity_received where product_id=$1',[product]);await assert.rejects(context(mid),/ya fue utilizada/);
    });
    await t.test('Fabrication and gas movements stay in their own correction workflows',async()=>{
      const fab=await count([item(ids.a,2)]),gas=await count([item(ids.a,3)]);
      await q('insert into fabrication_stock_links(movement_id) values($1)',[fab]);await q('insert into gas_events(movement_id) values($1)',[gas]);
      await assert.rejects(context(fab),/Fabricación Naval/);await assert.rejects(context(gas),/control de gases/);
    });
    await t.test('A legacy batch in another warehouse cannot be edited through its parent load',async()=>{
      const mid=await count([item(ids.a,2)]);
      await q('update inventory_batches set warehouse_id=$1 where source_line_id in(select id from movement_lines where movement_id=$2)',[ids.w2,mid]);
      await assert.rejects(context(mid),/lote no coincide/);
      await q('update inventory_batches set warehouse_id=$1 where source_line_id in(select id from movement_lines where movement_id=$2)',[ids.w,mid]);
    });
    await t.test('A purchase receipt stays protected from an inventory-only edit',async()=>{
      const mid=await count([item(ids.a,2)]),company=randomUUID(),purchase=randomUUID();
      await q("insert into purchase_companies(id,name) values($1,'AVH de prueba')",[company]);
      await q('insert into purchases(id,company_id,created_by,warehouse_id) values($1,$2,$3,$4)',[purchase,company,ids.admin,ids.w]);
      await q('insert into purchase_receipts(purchase_id,warehouse_id,received_by,movement_id) values($1,$2,$3,$4)',[purchase,ids.w,ids.user,mid]);
      await assert.rejects(context(mid),/recepción de compra/);
    });
    await t.test('Valued manual entries preserve costs when quantity changes; returns use the same safe edit',async()=>{
      const entry=(await as(ids.user,'select record_entry($1,null,null,$2::jsonb,null) id',[ids.w,JSON.stringify([{...item(ids.a,2),unit_cost:10,currency:'PYG'}])])).rows[0].id;
      const fresh=await context(entry),updated=items(fresh);assert.equal(fresh.lines[0].conversion_locked,true);updated[0].quantity=4;
      assert.equal((await save(args(fresh,{p_items:updated}))).price_review_required,false);
      assert.equal(Number((await q('select unit_cost from inventory_batches where source_line_id=$1',[updated[0].line_id])).rows[0].unit_cost),10);
      const locked=await context(entry),bad=items(locked);bad[0].unit='caja';bad[0].factor_to_base=15;
      await assert.rejects(save(args(locked,{p_items:bad})),/ya está valorizada/);
      const returned=(await as(ids.user,'select record_return($1,null,null,$2,$3::jsonb,null) id',[ids.w,'Operario',JSON.stringify([item(ids.b,3,'unidad')])])).rows[0].id;
      const rc=await context(returned),ri=items(rc);ri[0].quantity=2;await save(args(rc,{p_items:ri}));
      assert.equal(Number((await q('select quantity_remaining from inventory_batches where source_line_id=$1',[ri[0].line_id])).rows[0].quantity_remaining),2);
    });
    await t.test('Mobile form offers all units and retries a lost response without duplicating the edit',async()=>{
      const mid=await count([item(ids.a,1)]),requests=[],products=[{id:ids.a,name:'Alambre <prueba>',base_unit:'kg',active:true},{id:ids.b,name:'Equipo naval',base_unit:'unidad',active:true}];
      const dom=new JSDOM('<div id="stockList"></div><div id="modal" class="hide"><div id="modalBody"></div></div>',{url:'https://avh.test/',runScripts:'outside-only'}),w=dom.window;let drop=true;
      try{
        Object.assign(w,{profile:{id:ids.user,role:'depositor',warehouse_id:ids.w},D:{products,presentations:[]},product:id=>products.find(p=>p.id===id),whName:()=> 'Villa Hayes',
          $:s=>w.document.querySelector(s),$$:s=>[...w.document.querySelectorAll(s)],esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),fmt:v=>String(Number(v)),dt:v=>String(v),
          msg:(el,message)=>{el.textContent=message},loadAll:async()=>{},renderHome:()=>{},renderStock:()=>{w.document.querySelector('#stockList').innerHTML=`<div data-stock="${ids.w}|${ids.a}"></div>`},
          openModal:(title,subtitle,html)=>{w.document.querySelector('#modalBody').innerHTML=html;w.document.querySelector('#modal').classList.remove('hide')},closeModal:()=>w.document.querySelector('#modal').classList.add('hide')});
        Object.assign(w,{session:null,API:'https://fixture',KEY:'public',SESSION_KEY:'test-session'});w.eval(read('../src/core/api.js'));
        w.fetch=async(url,options)=>{
          const body=JSON.parse(options.body),name=url.split('/').at(-1);let data;
          try{if(name==='inventory_load_edit_context')data=await context(body.p_movement_id);else{assert.equal(name,'edit_inventory_load');requests.push(body);data=await save(body)}}catch(e){return{ok:false,status:400,text:async()=>JSON.stringify({message:e.message})}}
          if(name==='edit_inventory_load'&&drop){drop=false;throw Error('Lost response')}
          return{ok:true,status:200,headers:{},text:async()=>JSON.stringify(data)};
        };
        w.eval(read('../src/features/inventory/own-load-editor.js'));w.renderStock();assert.ok(w.document.querySelector('[data-edit-own-stock]'));
        await w.AVHInventoryEditor.open(mid);assert.equal(w.document.querySelector('prueba'),null);
        const set=(s,value,event='input')=>{const el=w.document.querySelector(s);el.value=String(value);el.dispatchEvent(new w.Event(event,{bubbles:true}))};
        const unit=w.document.querySelector('[data-own-unit]');for(const u of ['caja','unidad','kg','metro','litro'])assert.ok([...unit.options].some(o=>o.textContent===u),u);
        set('[data-own-unit]',[...unit.options].find(o=>o.textContent==='caja').value,'change');set('[data-own-quantity]',2);set('#ownLoadReason','Se cargó la unidad equivocada');
        await w.document.querySelector('#ownLoadSave').onclick();assert.equal(requests.length,0);assert.match(w.document.querySelector('#ownLoadMsg').textContent,/equivalencia/);
        set('[data-own-factor]',15);assert.match(w.document.querySelector('[data-own-preview]').textContent,/30 kg/);
        const button=w.document.querySelector('#ownLoadSave');await button.onclick();assert.match(w.document.querySelector('#ownLoadMsg').textContent,/conectar/);
        assert.equal(w.document.querySelector('[data-own-quantity]').value,'2');assert.equal(w.document.querySelector('[data-own-factor]').value,'15');
        await button.onclick();assert.equal(requests.length,2);assert.equal(requests[0].p_request_id,requests[1].p_request_id);assert.equal(requests[0].p_items[0].request_id,undefined);
        assert.ok(w.document.querySelector('#ownLoadDone'));assert.equal(Number((await context(mid)).lines[0].quantity),2);
        assert.equal((await q("select count(*)::int n from audit_events where movement_id=$1 and action='inventory_load_edited'",[mid])).rows[0].n,1);
        w.profile.role='admin';w.renderStock();assert.equal(w.document.querySelector('[data-edit-own-stock]'),null);
      }finally{dom.window.close()}
    });
  }finally{await db.close()}
});
