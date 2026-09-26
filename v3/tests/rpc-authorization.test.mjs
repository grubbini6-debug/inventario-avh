import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
test('22 privileged RPCs reject a NULL role in isolated PostgreSQL',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '00000000-0000-0000-0000-000000000001'::uuid $$;
      CREATE FUNCTION public.current_profile_role() RETURNS text LANGUAGE sql AS $$ SELECT null::text $$;
      CREATE FUNCTION public.can_access_warehouse(uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;`);
    await db.exec(read('./fixtures/authorization-schema.sql'));
    await db.exec(read('../migrations/20260926130000_null_safe_rpc_authorization.sql'));
    await db.exec(`INSERT INTO public.movements(id,warehouse_from_id) VALUES ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003');`);
    const {rows}=await db.query(`SELECT p.proname, oidvectortypes(p.proargtypes) types FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prosecdef ORDER BY 1`);
    assert.equal(rows.length,22);
    for(const row of rows){
      const args=row.types?row.types.split(', ').map((t,i)=>row.proname==='request_movement_correction'&&i===0?"'00000000-0000-0000-0000-000000000002'::uuid":`null::${t}`).join(','):'';
      await assert.rejects(db.query(`SELECT * FROM public.${row.proname}(${args})`),/Solo|Usuario no autorizado|No autorizado/,row.proname);
    }
    // Explicitly check the three-valued SQL semantics that caused the defect.
    const result=await db.query("SELECT null::text <> 'admin' old_guard, null::text IS DISTINCT FROM 'admin' fixed_guard");
    assert.equal(result.rows[0].old_guard,null);assert.equal(result.rows[0].fixed_guard,true);
  }finally{await db.close()}
});
