# Auditoría Operativa AVH V3 — Fase 2 — 2026-09-21

## Alcance

Revisión de integridad y concurrencia sobre Inventario, Compras, Recepciones, Transferencias, Inventario Inicial, RLS/RPC y trazabilidad.

Producción fue consultada únicamente en lectura. Las correcciones están en la rama `audit/avh-v3-hardening-20260921`.

## Estado observado de producción

La fotografía actual es consistente:

- 0 lotes negativos;
- 0 lotes con saldo mayor a la cantidad recibida;
- 0 lotes abiertos sin valorizar;
- 0 movimientos activos sin líneas;
- 0 productos activos duplicados;
- 0 proveedores duplicados;
- 0 documentos de compra huérfanos;
- 0 ítems de compra sobre-recibidos;
- las tablas operativas de stock no exponen INSERT/UPDATE directo al depositario por RLS; las mutaciones pasan por RPC privilegiados.

Se observó un lote con `quantity_received=34`, `quantity_remaining=0` y sin allocations. No es corrupción: su movimiento de entrada está `cancelled` y existe la corrección administrativa vinculada. Es el resultado esperado del modelo de anulación auditable.

Actualmente no hay compras ni transferencias registradas en las tablas productivas, por lo que esos flujos se auditaron por implementación, constraints, locks y políticas; no existe todavía volumen real suficiente para inferir comportamiento estadístico.

## Concurrencia

### Salidas

`record_exit` bloquea previamente los lotes FIFO de los productos involucrados mediante `FOR UPDATE`, con orden determinista por producto/fecha/id. Después vuelve a comprobar stock y consume los lotes bloqueados.

Resultado: dos usuarios no deberían poder consumir simultáneamente el mismo saldo y producir stock negativo.

### Transferencias

`record_transfer` usa el mismo patrón de locks FIFO. El stock sale del origen al confirmar y queda `in_transit`.

`receive_transfer` bloquea la fila del movimiento. Una segunda recepción concurrente espera y, al encontrar el estado ya cambiado de `in_transit` a `received`, no vuelve a crear lotes.

### Compras / recepciones parciales

`receive_purchase` bloquea primero la compra completa y luego sus ítems. Esto serializa recepciones concurrentes de la misma OC y evita superar la cantidad comprada.

Existe además idempotencia mediante `client_request_id`.

### Inventario inicial

Se encontró una carrera real: `record_initial_inventory` leía la sesión abierta sin bloquearla. Administración podía cerrar la sesión mientras un depositario que ya había leído `open` seguía creando stock.

**Corregido en esta rama:** la sesión de inventario inicial se toma con `FOR UPDATE`, serializando carga y cierre.

## Integridad estructural agregada

Se agregó una migración de defensa en profundidad para que PostgreSQL rechace estados imposibles aunque una futura RPC tenga un bug:

- `inventory_batches.quantity_remaining <= quantity_received`;
- `purchase_items.received_qty <= quantity`;
- ubicación coherente por tipo de movimiento:
  - salida = depósito origen;
  - entrada/inicial/devolución = depósito destino;
  - transferencia = origen y destino distintos;
  - corrección/ajuste = al menos una ubicación.

Los datos actuales cumplen estas reglas.

## Regla de costo de entrada manual

La regla definida es: el depositario puede registrar la operación manual, pero solo Administración puede asignar costo/moneda/tipo de cambio.

Durante esta Fase 2 se detectó una interacción importante con Compras: una recepción de OC realizada por un depositario necesita crear stock con el precio aprobado de la compra.

La migración fue corregida para diferenciar ambos casos:

- **entrada manual del depositario:** no puede enviar valorización;
- **recepción de compra:** `receive_purchase` puede pasar el precio aprobado de la OC mediante un contexto de recepción recién creado, del mismo usuario/depósito y todavía sin movimiento;
- un usuario no puede reutilizar una recepción ya completada para saltarse la restricción.

Esto conserva el costo FIFO de compras sin darle al depositario capacidad de inventar precios.

## RLS / bypass de RPC

Para las tablas críticas de inventario:

- `movements`, `movement_lines`, `inventory_batches` y `batch_allocations` tienen policies de lectura, no escritura directa del depositario;
- las operaciones pasan por RPC;
- Compras es escritura administrativa y lectura limitada del depositario;
- Recepciones se crean mediante `receive_purchase`.

Esto reduce el riesgo de saltarse las reglas desde DevTools o llamando directamente a PostgREST.

## Riesgo pendiente: devoluciones

`record_return` crea stock nuevo y actualmente no exige vincular la devolución a una salida previa. Por lo tanto, un usuario autorizado del depósito podría registrar una devolución superior a lo que previamente salió para esa barcaza/contratista/producto.

No se cambió todavía porque requiere definir exactamente qué constituye una devolución válida: contra una salida concreta, contra el saldo neto entregado a una barcaza/contratista, o mediante aprobación administrativa.

**Prioridad recomendada: P1**, antes de aumentar el uso operativo.

## Riesgo pendiente: endpoints legacy

Supabase mantiene Edge Functions V2/administrativas antiguas activas además de V3. Varias están protegidas por JWT o autorización manual, pero cada endpoint activo amplía superficie de ataque y mantenimiento.

Conviene inventariar qué funciones consume realmente V3 y retirar únicamente las que se demuestre que ya no tienen consumidores.

## Riesgo pendiente: recuperación y reproducibilidad

Sigue existiendo deriva entre algunas migraciones/Edge Functions desplegadas y las fuentes versionadas en GitHub. Antes de considerar AVH “crítico de negocio”, GitHub debe poder reconstruir el backend desplegado sin depender de código histórico que solo exista en Supabase.

## Monitor de salud

Se agregó `v3/scripts/audit-health.sql`, exclusivamente de lectura, para detectar periódicamente:

- saldos negativos/imposibles;
- diferencias lote vs allocations;
- stock sin valorizar;
- movimientos sin líneas;
- sobre-recepciones;
- estados de compra inconsistentes;
- transferencias en tránsito;
- documentos huérfanos;
- productos duplicados;
- volumen de anulaciones/correcciones.

## Conclusión técnica

El núcleo de stock está mejor protegido de lo que parecía al inicio: las salidas y transferencias usan locks FIFO, las recepciones serializan por compra, existe idempotencia y las escrituras críticas no están abiertas directamente por RLS.

Los cambios de mayor valor de esta fase son:

1. impedir cierre concurrente del inventario inicial mientras entra stock;
2. agregar constraints estructurales de stock/compra;
3. preservar valorización automática de OC sin permitir costos manuales al depositario;
4. dejar un monitor SQL repetible de salud operativa.

El siguiente endurecimiento debería centrarse en devoluciones y luego en reproducibilidad/retirada de endpoints legacy.
