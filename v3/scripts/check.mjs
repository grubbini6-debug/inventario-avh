import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'build-manifest.json'),'utf8'));
let failed=false;
const sourceModules=[...(manifest.core||[]),...(manifest.features||[])];
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
if(fs.existsSync(distJs)){
  const syntax=spawnSync(process.execPath,['--check',distJs],{encoding:'utf8'});
  if(syntax.status!==0){console.error(syntax.stderr);failed=true;}
  const js=fs.readFileSync(distJs,'utf8');
  for(const symbol of ['record_entry','record_exit','record_transfer','receive_purchase','renderPurchases','startRealtime','openMovementDetail','openModal','renderAlerts']){
    if(!js.includes(symbol)){console.error('Missing critical symbol:',symbol);failed=true;}
  }
  for(const legacy of ['legacy core block 0','legacy core block 1','legacy core block 2']) if(js.includes(legacy)){console.error(`${legacy} must not be present`);failed=true;}
  for(const p of manifest.core||[]){if(!js.includes(`===== ${p} =====`)){console.error('Missing modular core block:',p);failed=true;}}
  const seen=new Map();
  for(const m of js.matchAll(/\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) seen.set(m[1],(seen.get(m[1])||0)+1);
  const duplicates=[...seen].filter(([,n])=>n>1).sort((a,b)=>a[0].localeCompare(b[0]));
  fs.writeFileSync(path.join(root,'DUPLICATE_FUNCTIONS.md'),'# Overrides pendientes de consolidar\n\n'+duplicates.map(([n,c])=>`- **${n}**: ${c} implementaciones`).join('\n')+'\n');
  console.log(`Tracked ${duplicates.length} named overrides for phase 2.`);
}
if(failed)process.exit(1);
console.log(`AVH V3 static checks OK · ${manifest.core?.length||0} módulos core/UI activos`);
