import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {PDFDocument} from 'pdf-lib';
const read=p=>fs.readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export function endpoint(fetch,env={}){
 const ctx={fetch,PDFDocument,Request,Response,AbortSignal,TextDecoder,Uint8Array,atob,console,Deno:{env:{get:name=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'public',OPENAI_API_KEY:'isolated-test-key',...env}[name])},serve:handler=>ctx.handler=handler}};
 for(const name of ['quote-excel-model.js','quote-document-model.js'])vm.runInNewContext(read('edge-functions/_shared/'+name),ctx);
 vm.runInNewContext(stripTypeScriptTypes(read('edge-functions/quote-document-ai/index.ts').replace(/^import .*;\n/gm,''),{mode:'strip'}),ctx);return ctx.handler;
}
