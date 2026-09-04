import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'build-manifest.json'),'utf8'));
const backendContract=JSON.parse(fs.readFileSync(path.join(root,'backend-contract.json'),'utf8'));
let failed=false;
const sourceModules=[...(manifest.core||[]),...(manifest.features||[]),manifest.bootstrap].filter(Boolean);
const styleModules=(manifest.styles||[]).filter(Boolean);

const stateSource=fs.readFileSync(path.join(root,'src/core/state.js'),'utf8');
const adminSource=fs.readFileSync(path.join(root,'src/features/admin/base.js'),'utf8');
const routerSource=fs.readFileSync(path.join(root,'src/core/router.js'),'utf8');
const dataViewsSource=fs.readFileSync(path.join(root,'src/core/data-views.js'),'utf8');
const templateSource=fs.readFileSync(path.join(root,'src/index.template.html'),'utf8');
const poPolishSource=fs.readFileSync(path.join(root,'src/features/purchases/po-polish.js'),'utf8');

const depositorMobileSource=fs.readFileSync(path.join(root,'src/features/inventory/depositor-mobile-ai.js'),'utf8');
if(!depositorMobileSource.includes("querySelectorAll('button:not(.nav-user-exit)')")){
  console.error('Depositor navigation must preserve the logout control.');failed=true;
}
if(!/\blet\s+activeAdminTab\s*=\s*['"]users['"]/.test(stateSource)||
   !/function\s+renderAdmin\(tab=activeAdminTab\)/.test(adminSource)||
   !/activeAdminTab=tab\|\|['"]users['"]/.test(adminSource)||
   !/renderAdmin\(activeAdminTab\)/.test(routerSource)){
  console.error('Admin tab persistence contract is missing.');failed=true;
}
if(!templateSource.includes('Content-Security-Policy')||!templateSource.includes('id="syncState"')){
  console.error('Frontend hardening contract is missing CSP or sync state.');failed=true;
}
if(!dataViewsSource.includes("query('audit_events'")||!routerSource.includes('D.auditEvents')){
  console.error('Audit UI must use backend audit_events.');failed=true;
}
const purchaseBaseSource=fs.readFileSync(path.join(root,'src/features/purchases/base.js'),'utf8');
for(const token of ['purchase-record-hero','data-purchase-tab="summary"','data-purchase-tab="items"','data-purchase-tab="receipts"','data-purchase-tab="documents"','data-purchase-tab="history"','activePurchaseRecordId']){
  if(!purchaseBaseSource.includes(token)){console.error('Purchase record contract missing:',token);failed=true;}
}
if(purchaseBaseSource.includes("openModal(p.supplier_name||supplierName(p.supplier_id)||'Compra'")){
  console.error('Purchase detail must remain a dedicated page, not revert to the legacy modal.');failed=true;
}

if(/0971\s*800\s*829|gortega@astillerovh\.com/i.test(poPolishSource)){
  console.error('Purchase order contact data must come from company configuration, not hardcoded fallback.');failed=true;
}

for(const p of [...sourceModules,...styleModules,manifest.template,'backend-contract.json'].filter(Boolean)){
  const full=path.join(root,p);
  if(!fs.existsSync(full)||fs.statSync(full).size===0){console.error('Missing source:',p);failed=true;}
}
for(const p of sourceModules){
  const r=spawnSync(process.execPath,['--check',path.join(root,p)],{encoding:'utf8'});
  if(r.status!==0){console.error(`Syntax error: ${p}\n${r.stderr}`);failed=true;}
}

const buildSource=fs.readFileSync(path.join(root,'scripts/build.mjs'),'utf8');
const manifestSource=fs.readFileSync(path.join(root,'build-manifest.json'),'utf8');
const allSourceText=sourceModules.map(p=>fs.readFileSync(path.join(root,p),'utf8')).join('\n');
const retiredContractorUi=[
  'data-module="contractors"',
  'id="moveContractor"',
  'id="moveContractorSel"',
  'id="pcContractor"',
  'data-mgmt-contractor',
  'Contratistas — consumo real',
  'src/features/purchases/contractor-link.js'
];
for(const token of retiredContractorUi){
  if((allSourceText+manifestSource).includes(token)){
    console.error('Contractor management UI must stay outside V3:',token);failed=true;
  }
}
const activeScopeText=(allSourceText+templateSource).replaceAll('p_contractor_id:null','');
if(/contractor|contratista/i.test(activeScopeText)){
  console.error('Active V3 source still contains contractor-domain logic outside the nullable RPC compatibility argument.');failed=true;
}

for(const retired of ['avh-publish-static','avh-bootstrap','inventario-avh-v2-app','inventario-avh-v2-web']){
  if(allSourceText.includes(retired)){console.error('Retired endpoint referenced by V3:',retired);failed=true;}
}

if(/legacy\/part\d+\.b64|part\$?\{?\w*\}?\.b64|zlib|gunzipSync/.test(buildSource+manifestSource)){
  console.error('Build still references compressed legacy assets.');failed=true;
}

const build=spawnSync(process.execPath,[path.join(root,'scripts/build.mjs')],{encoding:'utf8'});
process.stdout.write(build.stdout);process.stderr.write(build.stderr);if(build.status!==0)failed=true;
const distJs=path.join(root,'dist/app.js');
const distHtml=path.join(root,'dist/index.html');
const distCss=path.join(root,'dist/app.css');
for(const p of [distJs,distHtml,distCss]) if(!fs.existsSync(p)||fs.statSync(p).size===0){console.error('Missing build artifact:',p);failed=true;}

function globalFunctionNames(code){
  const names=[];
  let depth=0,state='code',quote='',escape=false,lineComment=false,blockComment=false;
  const matches=[...code.matchAll(/\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)];
  let mi=0;
  for(let i=0;i<code.length;i++){
    if(mi<matches.length && i===matches[mi].index){
      const m=matches[mi];
      let j=i-1;while(j>=0&&/\s/.test(code[j]))j--;
      const prev=j>=0?code[j]:'';
      if(state==='code'&&!lineComment&&!blockComment&&depth===0&&!['(','=',':',',','.'].includes(prev)) names.push(m[1]);
      mi++;
    }
    const ch=code[i],next=code[i+1];
    if(lineComment){if(ch==='\n')lineComment=false;continue}
    if(blockComment){if(ch==='*'&&next==='/'){blockComment=false;i++}continue}
    if(state==='string'){
      if(escape){escape=false;continue}
      if(ch==='\\'){escape=true;continue}
      if(ch===quote){state='code';quote=''}
      continue;
    }
    if(state==='template'){
      if(escape){escape=false;continue}
      if(ch==='\\'){escape=true;continue}
      if(ch==='`'){state='code'}
      continue;
    }
    if(ch==='/'&&next==='/'){lineComment=true;i++;continue}
    if(ch==='/'&&next==='*'){blockComment=true;i++;continue}
    if(ch==='"'||ch==="'"){state='string';quote=ch;continue}
    if(ch==='`'){state='template';continue}
    if(ch==='{')depth++;
    else if(ch==='}')depth=Math.max(0,depth-1);
  }
  return names;
}

function uniqueMatches(code,re){return [...new Set([...code.matchAll(re)].map(m=>m[1]))].sort()}
function compareContract(type,actual){
  const expected=[...(backendContract[type]||[])].sort();
  const missing=expected.filter(x=>!actual.includes(x));
  const extra=actual.filter(x=>!expected.includes(x));
  if(missing.length||extra.length){
    console.error(`Backend contract mismatch [${type}]`,{missing,extra});failed=true;
  }else console.log(`Backend contract ${type}: ${actual.length}/${expected.length} OK`);
}

if(fs.existsSync(distJs)){
  const syntax=spawnSync(process.execPath,['--check',distJs],{encoding:'utf8'});
  if(syntax.status!==0){console.error(syntax.stderr);failed=true;}
  const js=fs.readFileSync(distJs,'utf8');
  for(const symbol of ['record_entry','record_exit','record_transfer','receive_purchase','renderPurchases','startRealtime','openMovementDetail','openModal','renderAlerts','renderAdmin','adminPresentations','boot()']){
    if(!js.includes(symbol)){console.error('Missing critical symbol:',symbol);failed=true;}
  }
  if(/legacy core block \d+/.test(js)){console.error('No legacy JavaScript block may remain in dist/app.js');failed=true;}
  for(const p of manifest.core||[]){if(!js.includes(`===== ${p} =====`)){console.error('Missing modular base block:',p);failed=true;}}
  if(manifest.bootstrap&&!js.includes(`===== ${manifest.bootstrap} =====`)){console.error('Missing bootstrap block');failed=true;}

  const seen=new Map();
  for(const p of sourceModules){
    const code=fs.readFileSync(path.join(root,p),'utf8');
    for(const name of globalFunctionNames(code)){
      const arr=seen.get(name)||[];arr.push(p);seen.set(name,arr);
    }
  }
  const duplicates=[...seen].filter(([,files])=>files.length>1).sort((a,b)=>a[0].localeCompare(b[0]));
  fs.writeFileSync(path.join(root,'DUPLICATE_FUNCTIONS.md'),'# Colisiones globales detectadas\n\n'+(duplicates.length?duplicates.map(([n,files])=>`- **${n}**: ${files.join(' → ')}`).join('\n'):'Ninguna función global está declarada más de una vez.')+'\n');
  if(duplicates.length){console.error('Duplicate GLOBAL function declarations:',duplicates);failed=true;}
  else console.log('Global function collisions: 0');

  compareContract('rpc',uniqueMatches(js,/\brpc\(\s*['"]([^'"]+)/g));
  compareContract('query',uniqueMatches(js,/\bquery\(\s*['"]([^'"]+)/g));
  compareContract('edge',uniqueMatches(js,/\bedge\(\s*['"]([^'"]+)/g));
  compareContract('insert',uniqueMatches(js,/\binsert\(\s*['"]([^'"]+)/g));
  compareContract('upsert',uniqueMatches(js,/\bupsert\(\s*['"]([^'"]+)/g));
}

if(fs.existsSync(distHtml)){
  const html=fs.readFileSync(distHtml,'utf8');
  for(const token of ['<title>Inventario AVH</title>','Content-Security-Policy','id="syncState"','id="loginForm"','id="main"','id="page-stock"','id="page-moves"','id="page-barges"','id="page-more"','href="app.css"','src="app.js"']){
    if(!html.includes(token)){console.error('Missing HTML contract:',token);failed=true;}
  }
  if(/<style\b|<script(?![^>]*src=)/i.test(html)){console.error('Inline CSS/JS must not return to V3 template.');failed=true;}
}

if(fs.existsSync(distCss)){
  const css=fs.readFileSync(distCss,'utf8');
  for(const token of [':root{','.nav{','.modal{','.login{','.hero{']) if(!css.includes(token)){console.error('Missing CSS contract:',token);failed=true;}
  const responsiveShellChecks=[
    ['desktop-only hidden by default','.desktop-nav-only{display:none!important}'],
    ['desktop breakpoint','@media(min-width:1024px)'],
    ['desktop sidebar fixed','position:fixed!important;z-index:60;left:0;top:0;bottom:0;right:auto'],
    ['mobile bottom navigation','position:fixed;z-index:40;bottom:0;left:0;right:0'],
    ['mobile compact header','@media(max-width:759px)'],
    ['mobile logout visible','.top-logout{display:inline-flex'],
    ['desktop logout visible','  .top-logout{display:inline-flex}']
  ];
  for(const [label,token] of responsiveShellChecks){
    if(!css.includes(token)){console.error('Responsive shell contract missing:',label);failed=true;}
  }
}

if(failed)process.exit(1);
console.log(`AVH V3 checks OK · legacy build: 0 · JS modules: ${sourceModules.length} · CSS: ${styleModules.length} · backend contract: OK`);
