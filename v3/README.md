# Inventario AVH V3

Aplicación modular publicada en GitHub Pages. Los cambios se revisan por Pull Request antes de integrarse a `main`.

Validar y construir:

```bash
node scripts/check.mjs
npm ci --ignore-scripts
npm test
# Chromium instalado o npx playwright install chromium
AVH_CHROME_BIN=/ruta/a/chrome npm run test:browser:manufacturing
```

El resultado queda en `dist/`. La rama `feat/fabricacion-naval` no despliega sobre la aplicación del astillero. [Fabricación Naval: auditoría, seguridad, pruebas y activación](FABRICACION_NAVAL.md).
