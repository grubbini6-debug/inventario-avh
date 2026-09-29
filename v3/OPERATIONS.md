# AVH V3 — Operación y despliegue

## Estado operativo

AVH mantiene una carga rápida de los últimos 400 movimientos para dashboard y actividad reciente. Al abrir **Movimientos**, el historial completo se carga paginado desde la API. Las exportaciones CSV de movimientos también fuerzan la carga completa antes de generar el archivo.

Compras, ítems, recepciones, documentos e Inteligencia de Compras usan paginación completa. El helper de paginación tiene un límite de seguridad de 100.000 filas y devuelve error explícito si se alcanza.

## Recepciones de compra

Una recepción aumenta `purchase_items.received_qty` y, para ítems de inventario, crea un movimiento de entrada con sus lotes.

La reversión administrativa se hace exclusivamente mediante `admin_void_purchase_receipt`.

La reversión:
- exige rol `admin` y motivo;
- bloquea la recepción, compra e ítems afectados;
- solo continúa si los lotes generados por esa recepción siguen completamente disponibles y sin asignaciones;
- crea una corrección de stock mediante el flujo auditado existente;
- resta las cantidades de `received_qty`;
- recalcula el estado de la compra;
- conserva la recepción como registro histórico, marcándola anulada;
- registra `purchase_receipt_voided` en auditoría.

Si el material ya fue utilizado o asignado, la reversión se rechaza. En ese caso corresponde una corrección auditada, no una eliminación silenciosa.

## Seguridad

- Los perfiles inactivos quedan fuera de las lecturas y operaciones protegidas.
- Las RPC privilegiadas validan el perfil activo/rol en backend.
- `admin_recovery_tokens` tiene RLS activo y no otorga acceso a `anon` ni `authenticated`; el acceso queda reservado al servicio.
- Las funciones `SECURITY DEFINER` se mantienen solo donde el modelo actual las necesita y deben revisarse caso por caso antes de revocar permisos.
- No exponer nunca claves `service_role` en frontend.

### Ajuste manual pendiente de plataforma

El asesor de Supabase reporta **Leaked Password Protection Disabled**. La integración actual no expone una acción segura para modificar esta configuración de Auth. Debe activarse desde la configuración de autenticación del proyecto cuando esté disponible para el propietario. Este ajuste no requiere cambios de esquema ni frontend.

## Validación antes de publicar

1. Ejecutar tests de Node.
2. Ejecutar `scripts/check.mjs`.
3. Verificar el artefacto construido.
4. Ejecutar smoke test de navegador.
5. Para migraciones: aplicar en Supabase, confirmar función/trigger esperado y revisar advisors.
6. Verificar integridad:
   - ningún lote con `quantity_remaining < 0` o mayor que `quantity_received`;
   - ningún `purchase_items.received_qty` negativo o mayor que `quantity`;
   - ninguna recepción activa ligada a un movimiento cancelado.

## Regla de despliegue

Los cambios de lógica se desarrollan en rama, pasan CI y recién después se fusionan a `main`. Las migraciones deben quedar versionadas en `v3/migrations` y aplicarse de forma controlada al proyecto Supabase.
