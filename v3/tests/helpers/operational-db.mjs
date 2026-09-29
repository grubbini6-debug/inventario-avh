import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
export const auditMigrations=[
  '20260921172000_receipt_document_path_guard.sql',
  '20260921174500_manual_entry_cost_admin_only.sql',
  '20260921181500_inventory_purchase_invariants.sql',
  '20260921183000_opening_inventory_concurrency.sql',
  '20260926130000_null_safe_rpc_authorization.sql',
  '20260926170000_active_profile_rls_and_lock_order.sql'
];
// Production schema metadata only. Auth/Storage infrastructure is simulated;
// all business rows are synthetic and roles run without BYPASSRLS.
export async function operationalDb(db=new PGlite()){
  try{
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated;
      CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE SCHEMA storage; CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);
      GRANT USAGE ON SCHEMA public,auth TO anon,authenticated;
      SET check_function_bodies=false;`);
    const schema=JSON.parse(read('../fixtures/operational-schema.json'));
    for(const key of ['sequences','tables','constraints','indexes','functions']){
      for(const sql of schema[key])await db.exec(sql);
    }
    let views=[...schema.views];
    while(views.length){
      const pending=[];
      for(const sql of views){try{await db.exec(sql)}catch(error){pending.push(sql);if(views.length===1)throw error}}
      if(pending.length===views.length)throw new Error('Unresolved view dependencies');
      views=pending;
    }
    for(const key of ['triggers','policies'])for(const sql of schema[key])await db.exec(sql);
    for(const sql of JSON.parse(read('../fixtures/operational-grants.json')))await db.exec(sql);
    for(const sql of JSON.parse(read('../fixtures/operational-function-grants.json')))await db.exec(sql);
    for(const name of auditMigrations)await db.exec(read('../../migrations/'+name));
    await db.exec('SET check_function_bodies=true');
    return db;
  }catch(error){await db.close();throw error}
}
export const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
export async function asUser(db,user){
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[user||'']);
  await db.exec('SET ROLE '+(user?'authenticated':'anon'));
}
export async function seed(db){
  await db.exec(`
    INSERT INTO auth.users(id) VALUES ('${id(1)}'),('${id(2)}'),('${id(3)}'),('${id(4)}'),('${id(5)}');
    INSERT INTO warehouses(id,code,name) VALUES ('${id(10)}','TEST_A','Test A'),('${id(11)}','TEST_B','Test B');
    INSERT INTO profiles(id,username,full_name,role,warehouse_id,active) VALUES
      ('${id(1)}','test_admin','Test Admin','admin',null,true),
      ('${id(2)}','test_a','Test A','depositor','${id(10)}',true),
      ('${id(3)}','test_b','Test B','depositor','${id(11)}',true),
      ('${id(4)}','test_inactive','Test inactive','depositor','${id(10)}',false);
    INSERT INTO products(id,sku,name,base_unit) VALUES ('${id(20)}','TEST','Synthetic product','kg');
    INSERT INTO suppliers(id,name) VALUES ('${id(30)}','Synthetic supplier');
    INSERT INTO purchase_companies(id,name) VALUES ('${id(40)}','Synthetic company');
    INSERT INTO purchases(id,company_id,supplier_id,purchase_type,status,destination_type,warehouse_id,currency,exchange_rate,created_by)
      VALUES ('${id(50)}','${id(40)}','${id(30)}','stock','ordered','warehouse','${id(10)}','USD',7500,'${id(1)}');
    INSERT INTO purchase_items(id,purchase_id,product_id,description,quantity,unit,factor_to_base,unit_price,affects_inventory)
      VALUES ('${id(60)}','${id(50)}','${id(20)}','Synthetic product',10,'kg',1,2,true);
  `);
}
