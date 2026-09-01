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
if(!/\blet\s+activeAdminTab\s*=\s*['"]users['"]/.test(stateSource)||
   !/function\s+renderAdmin\(tab=activeAdminTab\)/.test(adminSource)||
   !/activeAdminTab=tab\|\|['"]users['"]/.test(adminSource)||
   !/renderAdmin\(activeAdminTab\)/.test(routerSource)){
  console.error('Admin tab persistence contract is missing.');failed=true;
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
  for(const token of ['<title>Inventario AVH</title>','id="loginForm"','id="main"','id="page-stock"','id="page-moves"','id="page-barges"','id="page-more"','href="app.css"','src="app.js"']){
    if(!html.includes(token)){console.error('Missing HTML contract:',token);failed=true;}
  }
  if(/<style\b|<script(?![^>]*src=)/i.test(html)){console.error('Inline CSS/JS must not return to V3 template.');failed=true;}
}

if(fs.existsSync(distCss)){
  const css=fs.readFileSync(distCss,'utf8');
  for(const token of [':root{','.nav{','.modal{','.login{','.hero{']) if(!css.includes(token)){console.error('Missing CSS contract:',token);failed=true;}
}

if(failed)process.exit(1);
console.log(`AVH V3 checks OK · legacy build: 0 · JS modules: ${sourceModules.length} · CSS: ${styleModules.length} · backend contract: OK`);
