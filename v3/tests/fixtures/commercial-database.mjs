import fs from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
export async function database(){
 const db=new PGlite();await db.exec(read('./fixtures/fabrication-inventory.sql'));await db.exec(read('../migrations/20261014194409_ordenes_trabajo_galo.sql'));await db.exec(read('../migrations/20261015105130_perfil_produccion_ordenes_trabajo.sql'));
 const functions=read('../migrations/20260926130000_null_safe_rpc_authorization.sql');
 for(const name of ['admin_create_purchase','admin_prepare_purchase_order','admin_update_purchase','admin_update_purchase_item'])await db.exec(functions.match(new RegExp('CREATE OR REPLACE FUNCTION public\\.'+name+'\\([\\s\\S]*?\\$function\\$;'))[0]);
 await db.exec('create sequence public.purchase_order_seq;');await db.exec(read('../migrations/20261015130314_documentos_comerciales_produccion.sql'));await db.exec(read('../migrations/20261015151920_editable_purchase_order_review.sql'));await db.exec(read('../migrations/20261015155246_allow_purchase_order_company_drafts.sql'));await db.exec(read('../migrations/20261016133719_quote_issuer_branding.sql'));await db.exec(read('../migrations/20261016145734_quote_logo_colors.sql'));return db;
}
