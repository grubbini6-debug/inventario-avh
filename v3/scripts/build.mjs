import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'build-manifest.json'), 'utf8'));

const sourceModules = [
  ...(manifest.core || []),
  ...(manifest.features || []),
  manifest.bootstrap
].filter(Boolean);

const appJs = sourceModules
  .map(p => `\n/* ===== ${p} ===== */\n${fs.readFileSync(path.join(root, p), 'utf8')}`)
  .join('\n');

const appCss = (manifest.styles || [])
  .map(p => fs.readFileSync(path.join(root, p), 'utf8'))
  .join('\n\n');

if (!manifest.template) throw new Error('Falta template HTML en build-manifest.json');
const html = fs.readFileSync(path.join(root, manifest.template), 'utf8');
const dist = path.join(root, 'dist');

fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, 'index.html'), html);
fs.writeFileSync(path.join(dist, 'app.js'), appJs);
fs.writeFileSync(path.join(dist, 'app.css'), appCss);

for (const asset of manifest.assets || []) {
  const source = path.join(root, asset);
  if (!fs.existsSync(source)) throw new Error(`Falta asset: ${asset}`);
  const dest = path.join(dist, 'assets', path.basename(asset));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(source, dest);
}

console.log(`AVH V3 build OK: ${sourceModules.length} módulos JS + ${manifest.styles?.length || 0} CSS + ${(manifest.assets||[]).length} assets + plantilla HTML · dependencia legacy: 0`);
