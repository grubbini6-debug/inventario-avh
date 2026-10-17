import fs from 'node:fs';
export async function setupOwnLoadEditor(db){
  // Domain guards exist in production; minimal references suffice for this isolated stock fixture.
  await db.exec(`create table if not exists public.fabrication_stock_links(id uuid default gen_random_uuid(),movement_id uuid);
    create table if not exists public.gas_events(id uuid default gen_random_uuid(),movement_id uuid,movement_line_id uuid);`);
  await db.exec(fs.readFileSync(new URL('../../migrations/20261017145021_depositor_edit_inventory_load.sql',import.meta.url),'utf8'));
}
