# Control de gases

CO₂, oxígeno y GLP tienen una página propia, para Compras y los depositarios activos. Cada depositario utiliza su depósito asignado; Compras puede seleccionar cualquiera.

## Comenzar

1. Abrir **Gases → Nuevo conteo**.
2. Contar llenos y vacíos reales de los tres gases. Los campos comienzan vacíos: escribir `0` cuando no hay unidades.
3. Anotar los cilindros fuera del depósito por persona o proveedor. Si falta identificar al responsable, registrar **Pendientes del conteo**.
4. Revisar la diferencia con el sistema, completar la observación y guardar.

El conteo reemplaza cantidades y registra el ajuste. La instalación de la mejora no carga cantidades físicas ni borra movimientos anteriores. Los registros anteriores no permiten reconstruir responsable, estado del envase ni cantidad de vacíos; esos datos deben salir del conteo real.

## Movimientos

| Acción | Llenos disponibles | Vacíos en depósito | Pendientes |
| --- | --- | --- | --- |
| Entregar lleno | Disminuyen | Aumentan solo si devuelve vacíos en esa entrega | Aumentan por los llenos entregados, disminuyen por los vacíos recibidos |
| Recibir vacío | Sin cambio | Aumentan | Disminuyen para esa persona |
| Devolver lleno sin usar | Aumentan | Sin cambio | Disminuyen para esa persona |
| Enviar vacíos al proveedor | Sin cambio | Disminuyen | Aumentan con ese proveedor |
| Recarga o canje | Aumentan | Disminuyen si se entregan vacíos en el mismo canje | Se descuentan los llenos recibidos de los vacíos entregados o pendientes |
| Llenos nuevos o prestados | Aumentan | Sin cambio | No descuentan vacíos pendientes |

Cada salida requiere persona y destino. Referencia de vale/remito y observación permiten identificar el respaldo. Las devoluciones utilizan el mismo responsable registrado. Cantidades enteras, stock suficiente y pendientes se validan en PostgreSQL.

El historial muestra saldo de llenos antes/después, diferencial y cantidades de vacíos. Se puede filtrar por fecha/gas y exportar CSV. Los ajustes por conteo se muestran en el historial y se excluyen del total de entradas/salidas operativas del período.

## Integración y controles

- Los llenos usan `inventory_batches` y las RPC existentes; no hay un segundo stock de gas.
- Los vacíos y envases en poder de terceros se almacenan en `gas_controls` y `gas_custody`.
- Las entradas normales, recepciones de compras, salidas, devoluciones de llenos y transferencias quedan también en `gas_events`.
- Las salidas o devoluciones requieren conteo previo. Un inventario inicial general no puede duplicar gases ya contados.
- Un ingreso desde el circuito normal de compras suma llenos, pero no interpreta automáticamente que hubo un canje de envases. Registrar las entregas de vacíos en Gases; para el ciclo completo sin OC, utilizar Recarga/canje.
- Las correcciones de movimientos relacionados se realizan mediante nuevo conteo; la anulación genérica no puede desajustar el control de envases.
- Las cantidades nuevas por conteo y las devoluciones de llenos quedan sin costo cuando no hay un precio verificable; no se inventan costos ni se modifica el precio de lotes anteriores. Compras puede cargar precio/moneda al registrar nuevas recargas.
- Conteos con una versión anterior al último movimiento se rechazan. Los comandos son atómicos y mantienen un identificador para reintentar respuestas inciertas sin duplicar la operación.
- RLS restringe controles, responsables e historial al depósito asignado. Solo las funciones privadas verificadas escriben estas tablas; la RPC pública es `SECURITY INVOKER`.

## Validación

`npm test` incluye pruebas con las RPC reales en PostgreSQL aislado. `npm run test:browser:gases` verifica el flujo de escritorio/celular hasta PostgreSQL, incluyendo la pérdida de una respuesta posterior al guardado, CSV y conservación de formularios durante sincronización.

## Publicación

Aplicar `migrations/20261014121312_control_gases.sql` después de validar la rama/PR y antes de publicar la interfaz. Se reutilizan los productos existentes identificados por SKU y las asignaciones actuales de depósitos. La mejora queda lista para el primer conteo real; no habilita usuarios ni completa cantidades supuestas.
