# Inventario AVH

Sistema interno de control operativo de Astillero Villa Hayes para Compras, Proveedores, Depósito, Inventario, Barcazas como centro de consumo y trazabilidad relacionada.

## Alcance

V3 **no administra contratistas, módulos, liquidaciones, descuentos ni pagos a contratistas**. Ese circuito se gestiona externamente en Excel. Las barcazas permanecen únicamente como proyecto/centro de consumo de materiales y costo FIFO.

Las columnas o tablas históricas vinculadas a contratistas pueden permanecer en backend por compatibilidad, pero no forman parte del flujo activo de V3.

## Producción

La única fuente productiva es **V3**. GitHub Pages construye y publica exclusivamente `v3/dist` mediante `.github/workflows/pages.yml`.

Los archivos históricos del root y la arquitectura de patches son **legacy congelado**: no deben recibir nuevas funciones ni correcciones operativas.

## Arquitectura

- Frontend estático modular en `v3/src`.
- Supabase Auth para acceso.
- PostgreSQL + RLS para autorización y reglas de negocio.
- Storage privado para documentos de inventario y compras.
- Edge Functions para tareas privilegiadas, generación documental e IA.
- GitHub Actions valida, construye y hace smoke test antes del despliegue.

## Regla de cambios

Toda mejora nueva debe implementarse en V3, pasar `node v3/scripts/check.mjs` y entrar a producción mediante una rama/PR validada. No se deben volver a introducir archivos `patchN` en el build.

## Seguridad

El cliente solo contiene una publishable key. Los secretos y `service_role` permanecen del lado servidor. La seguridad de depósitos, compras y operaciones sensibles debe existir en PostgreSQL/RLS/RPC, no solamente en la interfaz.
