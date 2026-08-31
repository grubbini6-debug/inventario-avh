# AVH V3 — Reporte de pruebas funcionales

Fecha: 2026-08-29

Todas las pruebas de base de datos se ejecutaron contra el proyecto productivo usando perfiles reales y transacciones con `ROLLBACK`. No se dejaron compras, movimientos, lotes ni recepciones de prueba.

## Resultado

### 1. Compra → recepción parcial → stock FIFO
- Compra temporal: 2 rollos.
- Conversión: 1 rollo = 15 kg.
- Precio: USD 30/rollo.
- Recepción: 1 rollo.
- Resultado: compra `partially_received`, 1 recibido, 1 pendiente.
- Entrada automática: 15 kg.
- Costo FIFO resultante: USD 2/kg.
- Estado: PASÓ.

### 2. Inventario → salida FIFO → anulación admin → transferencia → recepción
- Inventario inicial temporal: 10 kg a USD 4/kg.
- Salida: 3 kg → stock 7 kg.
- Costo FIFO de salida: USD 4/kg.
- Anulación admin: stock restaurado a 10 kg; movimiento original `cancelled`.
- Transferencia Villa Hayes → ACOMAR: 4 kg.
- Al despachar: Villa Hayes 6 kg; ACOMAR 0 kg.
- Al recibir ACOMAR: ACOMAR 4 kg.
- Costo transferido: USD 4/kg.
- Estado transferencia: `received`.
- Estado: PASÓ.

### 3. Aislamiento por depósito
- Compra temporal destinada a Villa Hayes.
- Usuario de ACOMAR: 0 filas visibles.
- Usuario de Villa Hayes: 1 fila visible.
- Intento de recepción desde ACOMAR: bloqueado con `No autorizado para operar este depósito`.
- Estado: PASÓ.

### 4. Edición segura de ítem de compra
- Compra temporal original: 10 unidades a USD 100.
- Antes de recibir: corregida a 12 unidades a USD 90 → misma línea actualizada.
- Recepción parcial: 5 unidades a USD 90.
- Después de recibir: precio del saldo cambiado a USD 110.
- Resultado: línea histórica preservada en 5 recibidas a USD 90; nueva línea pendiente de 7 a USD 110.
- FIFO ya recibido mantuvo USD 90.
- Auditoría: 2 eventos de edición/split.
- Estado: PASÓ.

### 5. Compra libre sin producto de Inventario
- Concepto: `Servicio de grúa urgente`.
- `product_id = null`.
- `affects_inventory = false`.
- No se generó movimiento de stock.
- Estado: PASÓ.

### 6. Recepción física sin ingreso a stock
- Compra destinada físicamente a Villa Hayes.
- Ítem libre de consumo directo, sin producto de inventario.
- Depositario confirmó recepción de 3 unidades.
- Compra quedó `received`.
- Recepción registrada.
- `movement_id = null`: no se creó Entrada de inventario.
- Estado: PASÓ.

## Higiene de pruebas
Comprobación posterior:
- Compras de prueba restantes: 0.
- Lotes de prueba restantes: 0.
- Movimientos de prueba restantes: 0.
- Recepciones de prueba restantes: 0.

## Validaciones de frontend ya completadas
- V3 construye desde HTML/CSS/JS legibles, sin `part*.b64`.
- Cero bloques JavaScript legacy en el build.
- Cero colisiones globales detectadas por CI.
- Chrome headless abre la aplicación y llega al login sin errores de runtime.
- El usuario confirmó manualmente que la preview autocontenida abre correctamente y que todos los módulos principales cargan con sesión admin.

## Pendiente antes del merge
- Prueba manual con sesión real de depositario en V3.
- Verificar desde navegador una recepción real/intencionada.
- Verificar documentos, Excel y realtime desde sesiones reales.
- Recién después cambiar el workflow de GitHub Pages y mergear a `main`.
