import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {database} from './fixtures/commercial-database.mjs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
test('PostgreSQL separates brands, preserves purchase prices and rejects identity conflicts through both APIs',async()=>{
 const db=await database(),id=Object.fromEntries(['admin','wh','company','supplier'].map(x=>[x,randomUUID()]));
 try{
  await db.exec(read('../migrations/20261019203337_purchase_receiving_unit_integrity.sql'));
  for(const file of ['20261020121555_ai_product_identity_metadata.sql', '20261020121638_ai_product_identity_functions.sql', '20261020121651_ai_product_identity_guards.sql', '20261020121702_ai_quote_identity_validation.sql', '20261020121938_ai_fractional_measure_aliases.sql'] )await db.exec(read('../migrations/'+file));
  await db.exec(read('../migrations/20261026154318_normalize_single_item_purchase_unit.sql'));
  await db.query('insert into auth.users(id) values($1)',[id.admin]);await db.query("insert into profiles(id,username,role) values($1,'admin','admin')",[id.admin]);await db.query("insert into warehouses(id,code,name) values($1,'AC','ACOMAR')",[id.wh]);await db.query("insert into purchase_companies(id,name) values($1,'MAQMOVEIS')",[id.company]);await db.query("insert into suppliers(id,name) values($1,'Proveedor')",[id.supplier]);
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id.admin,role:'authenticated'})]);
  const data={company_id:id.company,supplier_id:id.supplier,warehouse_id:id.wh,destination_type:'warehouse',currency:'PYG'};
  const item={product_code:'MAX-1633',brand:'Maxflexx',manufacturer_code:'MCA-1633',description:'Disco de corte 4 1/2 pulgadas x 1,2 mm Maxflexx',quantity:50,unit:'UN',factor_to_base:1,unit_price:2550};
  const create=async(i,d=data)=>(await db.query('select admin_create_purchase_from_quote($1::jsonb,$2::jsonb) x',[JSON.stringify(d),JSON.stringify([i])])).rows[0].x;
  const first=await create(item),a=(await db.query('select * from purchase_items where purchase_id=$1',[first.purchase_id])).rows[0];
  const second=await create({...item,quantity:25,unit_price:2700}),b=(await db.query('select * from purchase_items where purchase_id=$1',[second.purchase_id])).rows[0];assert.equal(a.product_id,b.product_id);assert.equal(Number(a.unit_price),2550);assert.equal(Number(b.unit_price),2700);
  const other=await create({...item,brand:'Norton',manufacturer_code:'NOR-12',product_code:'NOR-12',description:'Disco de corte 4 1/2 pulgadas x 1,2 mm Norton'}),c=(await db.query('select * from purchase_items where purchase_id=$1',[other.purchase_id])).rows[0];assert.notEqual(a.product_id,c.product_id);
  assert.equal((await db.query('select count(*)::int n from products')).rows[0].n,2);
  assert.equal((await db.query("select avh_purchase_private.product_identity_problem($1,'Maxflexx','MCA-1633',$2) x",['DISCO DE CORTE PARA HIERRO 4.1/2\"X1,2MM MCA-1633 MAXFLEXX',a.product_id])).rows[0].x,null);
  const countBefore=(await db.query('select count(*)::int n from purchases')).rows[0].n;
  for(const conflicting of [{...item,brand:'Norton',description:'Disco de corte 4 1/2 pulgadas x 1,2 mm Norton'},{...item,description:'Disco de corte 4 1/2 pulgadas x 3,2 mm Maxflexx'},{...item,manufacturer_code:'OTHER'},{...item,unit_price:null},{...item,quantity:null}])await assert.rejects(create(conflicting),/marca|medida|modelo|cantidad|precio/i);
  await assert.rejects(create(item,{...data,currency:''}),/moneda/);
  assert.equal((await db.query('select count(*)::int n from purchases')).rows[0].n,countBefore);
  await assert.rejects(db.query("update purchase_items set description='Disco de corte 4 1/2 pulgadas x 1,2 mm Norton' where id=$1",[a.id]),/marca|especificaci/);
  await assert.rejects(db.query("update purchase_items set description='Disco de desbaste 4 1/2 pulgadas x 1,2 mm Maxflexx' where id=$1",[a.id]),/especificaci/);
  // Reproduce the production failure through the real quote-to-purchase RPC.
  const glove={product_code:'1086',description:'GUANTE DE CUERO VAQUETA CAÑO LARGO - G -',quantity:12,unit:'x1',factor_to_base:1,unit_price:18000,presentation:'x1'};
  for(const unit of ['x1',' X1 ','x 1','×1','× 1']){
    const saved=await create({...glove,unit}),line=(await db.query('select i.*,p.base_unit from purchase_items i join products p on p.id=i.product_id where purchase_id=$1',[saved.purchase_id])).rows[0];
    assert.equal(line.unit,'unidad');assert.equal(line.base_unit,'unidad');assert.equal(Number(line.quantity),12);assert.equal(Number(line.unit_price),18000);assert.equal(Number(line.factor_to_base),1);
    assert.equal((await db.query("select count(*)::int n from products where sku='1086'")).rows[0].n,1);
  }
  const unknown=(await db.query("select purchase_normalize_unit('x10') unit")).rows[0].unit;assert.equal(unknown,'x10');
  const units=['unidad','pieza','kg','tonelada','rollo','bobina','caja','paquete','bolsa','metro','m²','m³','litro','cilindro','tambor','pallet','plancha','barra','tubo','perfil','bidón','servicio','viaje','hora','día','otro'];
  for(const unit of units)assert.equal((await db.query('select purchase_normalize_unit($1) unit',[unit])).rows[0].unit,unit);
  await db.exec('set role anon');await assert.rejects(create(item),/permission denied/);await db.exec('reset role; set role authenticated');await assert.rejects(db.query("select avh_purchase_private.product_identity('test')"),/permission denied/);
 }finally{await db.close();}
});
