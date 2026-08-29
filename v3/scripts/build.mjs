import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'build-manifest.json'), 'utf8'));
const parts = [0,1,2,3].map(n => fs.readFileSync(path.join(root, `legacy/part${n}.b64`), 'utf8').replace(/\s+/g,''));
const base = zlib.gunzipSync(Buffer.from(parts.join(''), 'base64')).toString('utf8');

const styles = [...base.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/gi)].map(m => m[1]);
const inlineScripts = [...base.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
if (inlineScripts.length !== 5) throw new Error(`Se esperaban 5 bloques JS legacy y se encontraron ${inlineScripts.length}.`);

let html = base.replace(/<style(?:\s[^>]*)?>[\s\S]*?<\/style>/gi, '').replace(/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/gi, '');
html = html.replace('</head>', '<link rel="stylesheet" href="app.css"></head>');
html = html.replace('</body>', '<script src="app.js"></script></body>');

const coreCode = manifest.core.map(p => `\n/* ===== ${p} ===== */\n${fs.readFileSync(path.join(root,p),'utf8')}`).join('\n');
const featureCode = manifest.features.map(p => `\n/* ===== ${p} ===== */\n${fs.readFileSync(path.join(root,p),'utf8')}`).join('\n');
const bootstrapCode = `\n/* ===== ${manifest.bootstrap} ===== */\n${fs.readFileSync(path.join(root,manifest.bootstrap),'utf8')}`;
const appJs = coreCode + featureCode + bootstrapCode;
const appCss = styles.join('\n\n');

fs.mkdirSync(path.join(root,'dist'), { recursive:true });
fs.writeFileSync(path.join(root,'dist/index.html'), html);
fs.writeFileSync(path.join(root,'dist/app.js'), appJs);
fs.writeFileSync(path.join(root,'dist/app.css'), appCss);
console.log(`AVH V3 build OK: ${manifest.core.length} módulos base + ${manifest.features.length} extensiones + bootstrap · 0 bloques JS legacy`);
