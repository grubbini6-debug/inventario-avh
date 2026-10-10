# Inventario AVH V3

Aplicación modular publicada en GitHub Pages. Los cambios se revisan por Pull Request antes de integrarse a `main`.

Validar y construir:

```bash
node scripts/check.mjs
npm ci --ignore-scripts
npm test
# Chromium instalado o npx playwright install chromium
AVH_CHROME_BIN=/ruta/a/chrome npm run test:browser:manufacturing
AVH_CHROME_BIN=/ruta/a/chrome npm run test:browser:refresh
```

El resultado queda en `dist/`. [Fabricación Naval: auditoría, seguridad, pruebas y activación](FABRICACION_NAVAL.md). [Bienvenida y guía de uso por rol](GUIA_DE_USO.md).

La sincronización conserva formularios abiertos, cambios sin guardar y filtros. [Comportamiento y prueba de regresión](REFRESH_FORMS.md).
