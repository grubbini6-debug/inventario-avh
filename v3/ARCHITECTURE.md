# Inventario AVH V3 — Arquitectura productiva

## Estado actual

V3 es la única versión publicada en GitHub Pages. La arquitectura anterior basada en HTML comprimido y `patch1..patch11` queda como referencia histórica y no forma parte del build productivo.

## Alcance funcional

El núcleo de V3 es **Compras + Proveedores + Depósito + Inventario**. Barcazas se usa como dimensión de proyecto/consumo de materiales.

Quedan fuera del producto: contratistas, módulos de fabricación, liquidaciones, descuentos, adelantos y pagos a contratistas. Ese circuito se mantiene en Excel. No se deben agregar features nuevas de ese dominio a V3.

## Capas

### Frontend
- `src/core/`: configuración, estado, API, autenticación, carga de datos y router.
- `src/ui/`: navegación y vistas compartidas.
- `src/features/inventory/`: entradas, salidas, transferencias, FIFO, presentaciones y experiencia depositario.
- `src/features/admin/`: usuarios, catálogos, mínimos e inventario inicial.
- `src/features/purchases/`: compras, OC, recepción, documentos, precios, IA y control factura/OC.
- `src/features/management/`: alertas, solicitudes, auditoría y reportes.

### Backend
- PostgreSQL es la autoridad para reglas de negocio.
- RLS limita datos por rol y depósito.
- RPC controla operaciones sensibles y evita que la seguridad dependa de botones o rutas.
- Las vistas expuestas usan `security_invoker=true`.
- Storage de inventario y compras es privado y utiliza policies.
- Edge Functions se reservan para operaciones que requieren privilegios o integraciones externas.

## Build y despliegue

`build-manifest.json` define el orden de compatibilidad de módulos.

`scripts/check.mjs` valida:
1. archivos fuente;
2. sintaxis;
3. contrato frontend/backend;
4. ausencia de arquitectura legacy en el artefacto;
5. controles mínimos de hardening;
6. construcción de `dist`.

GitHub Actions ejecuta además un smoke test real con Chrome antes de publicar.

## Principios de mantenimiento

1. No agregar nuevas capas de patches.
2. No mover reglas de stock, permisos o recepción al frontend.
3. No borrar historial para corregir una operación; utilizar corrección/anulación trazable.
4. Toda carga parcial debe ser visible al usuario.
5. Auditoría administrativa debe salir de `audit_events`, no de una reconstrucción visual.
6. Los datos institucionales deben venir de tablas/configuración, no quedar hardcodeados.
7. Cambios de esquema deben existir como migraciones reproducibles.
8. Contratistas y módulos no deben volver al flujo activo de V3; solo se conserva compatibilidad histórica de datos cuando sea necesaria.

## Deuda técnica controlada

V3 todavía utiliza algunas funciones globales y wrappers `window.*` para compatibilidad. Se pueden reducir gradualmente, pero no se debe hacer una reescritura masiva junto con cambios de negocio críticos.
