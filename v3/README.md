# Inventario AVH V3

Aplicación modular publicada en GitHub Pages. Los cambios se revisan por Pull Request antes de integrarse a `main`.

Validar y construir:

```bash
npm ci --ignore-scripts
node scripts/check.mjs
npm test
# Chromium instalado o npx playwright install chromium
AVH_CHROME_BIN=/ruta/a/chrome npm run test:browser:manufacturing
AVH_CHROME_BIN=/ruta/a/chrome npm run test:browser:refresh
AVH_CHROME_BIN=/ruta/a/chrome npm run test:browser:quotes
```

El resultado queda en `dist/`. [Fabricación Naval: auditoría, seguridad, pruebas y activación](FABRICACION_NAVAL.md). [Bienvenida y guía de uso por rol](GUIA_DE_USO.md).

Presupuestos admite Excel/CSV (un archivo, 10 MB) y PDF o fotos JPG/PNG/WebP (hasta 6 archivos, 12 MB y 20 páginas por carga). `quote-document-ai` autentica al usuario y usa el acceso existente a Presupuestos; devuelve una lectura para revisar y no crea documentos. Los importes dudosos quedan pendientes. La empresa emisora, el cliente y el logo se revisan antes de emitir. PDF.js se construye desde la versión fijada en npm y se sirve desde el propio sitio, junto con su worker, recursos y licencia.

La sincronización conserva formularios abiertos, cambios sin guardar y filtros. [Comportamiento y prueba de regresión](REFRESH_FORMS.md).

[Reparaciones de máquinas](REPARACIONES_EQUIPOS.md): registro por código/serie, presupuestos de taller con varias máquinas, revisión de Excel/CSV/PDF/fotos, autorización respaldada, OC de servicio, remito de entrega, recepción y prueba por equipo, adicionales y conciliación de factura. Disponible para Compras / Administración; las existencias de materiales conservan su circuito actual.
