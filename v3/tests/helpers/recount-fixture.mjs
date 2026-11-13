import fs from 'node:fs';
import {setupHullBase,setupHullGases} from './hull-fixture.mjs';
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
export async function setupRecount(db){
  await setupHullBase(db);
  await db.exec(read('../../migrations/20261008232715_fabricacion_naval.sql'));
  await setupHullGases(db);
  await db.exec(read('../../migrations/20261113121137_depositor_physical_recounts.sql'));
}
