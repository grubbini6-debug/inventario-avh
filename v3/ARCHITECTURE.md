# Inventario AVH V3 — Refactor técnico

## Objetivo
Mantener exactamente los flujos ya validados de AVH, pero reemplazar la estructura de HTML comprimido + archivos `patch1..patch11` por una fuente ordenada y construible.

## Seguridad de la transición
- `main` sigue siendo producción.
- `refactor-v3` es una rama aislada.
- Esta refactorización no modifica Supabase ni datos productivos.
- Las reglas críticas siguen en backend: permisos por depósito, FIFO, recepción, correcciones, auditoría y compras.

## Estructura
- `legacy/`: copia inmutable del núcleo productivo actual durante la fase de compatibilidad.
- `src/features/inventory/`: movimientos, presentaciones y gobierno de inventario.
- `src/features/admin/`: catálogos, solicitudes, depositarios y contraseñas.
- `src/features/management/`: realtime, auditoría, documentos, alertas y panel gerencial.
- `src/features/purchases/`: compras, recepción, contratistas, edición parcial y producto/concepto libre.
- `build-manifest.json`: único lugar donde se define el orden compatible de las funciones.
- `scripts/build.mjs`: genera un artefacto limpio `dist/index.html + app.css + app.js`.
- `scripts/check.mjs`: valida sintaxis, artefactos y contratos críticos.

## Fases
1. **Consolidación segura:** quitar nombres `patchN` del nuevo árbol y generar un único bundle reproducible conservando semántica.
2. **Refactor profundo:** extraer el núcleo comprimido a `core/`, `ui/` y módulos de dominio; eliminar overrides detectados.
3. **Pruebas de comportamiento:** entrada, FIFO, salida, transferencia, recepción, compra parcial, edición de saldo y permisos por depósito.
4. **Sustitución:** recién después de paridad funcional y prueba real admin/depositario se reemplaza el root productivo.
