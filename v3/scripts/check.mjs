import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'build-manifest.json'),'utf8'));
let failed=false;
const sourceModules=[...(manifest.core||[]),...(manifest.features||[]),manifest.bootstrap].filter(Boolean);

for(const p of sourceModules){
  const r=spawnSync(process.execPath,['--check',path.join(root,p)],{encoding:'utf8'});
  if(r.status!==0){console.error(`Syntax error: ${p}\n${r.stderr}`);failed=true;}
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
      // Solo declaraciones globales. Expresiones como (function boot(){}) o x=function y() no cuentan.
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
}

if(failed)process.exit(1);
console.log(`AVH V3 static checks OK · JS legacy: 0 · módulos: ${sourceModules.length}`);
