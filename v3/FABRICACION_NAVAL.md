# Fabricación Naval integrada a Inventario AVH

## Entrega y límite de activación

La rama `feat/fabricacion-naval` incorpora fabricación interna en V3. No reemplaza Inventario AVH, no crea depósitos y no mantiene existencias paralelas. Incluye una migración aditiva, interfaces operativas y de supervisión, reportes automáticos, PDF, servicio opcional de correo y pruebas aisladas.

**No se aplicó la migración, no se desplegaron funciones ni se enviaron correos en producción.** No se modificaron cuentas, asignaciones de depósitos, stock ni datos operativos del astillero. La activación requiere revisar este PR, validar en un Supabase de ensayo y autorizar el despliegue.

## Auditoría realizada antes de implementar

Se revisaron el repositorio, el build publicado y el esquema real de Supabase en modo de lectura. El sistema publicado utiliza `v3/dist`, generado por `v3/build-manifest.json` y `.github/workflows/pages.yml`; el HTML y `patch*.js` de la raíz son históricos. Se conservó la arquitectura modular y sus wrappers, sin reescritura del inventario.

| Función existente | Fuente reutilizada | Integración de fabricación |
| --- | --- | --- |
| Depósitos y asignaciones | `warehouses`, `profiles.warehouse_id` | Un taller habilitado referencia un depósito existente; la asignación sigue perteneciendo al sistema actual. |
| Roles y permisos | `profiles.role`, `active`, `current_profile_role`, `can_access_warehouse`, `assert_can_access_warehouse` | Concesión explícita adicional para operar o supervisar fabricación. |
| Existencias y valoración | `inventory_batches`, `v_stock_by_warehouse`, `batch_allocations` | Consultar el stock real, proteger reservas y conservar costos FIFO. |
| Entradas y productos fabricados | `record_entry`, `movements`, `movement_lines` | Ingresos normales con referencia de lote `OF-<número>` y vínculo a la orden. |
| Salidas y consumos | `record_exit` | Consumir material reservado y entregar piezas usando la operación actual. |
| Devoluciones | `record_return` | Devolver contra un consumo concreto, hasta su saldo, a costos originales. |
| Transferencias y correcciones | `record_transfer`, `receive_transfer`, correcciones existentes | Continúan funcionando; el guard de lotes impide retirar cantidades reservadas. |
| Compras y abastecimiento | `supply_requests`, formulario `openNewSupplyRequest` | El operador abre el formulario existente; los reportes incluyen solicitudes pendientes. |
| Alertas | `v_stock_status` | Reportar mínimos existentes sin inventar umbrales. |
| Auditoría de inventario | `audit_events` y trigger de movimientos actual | Se conserva; fabricación agrega su propia trazabilidad de comandos. |

Los roles reales disponibles son `admin` y `depositor`; no se inventó un rol de Compras incompatible con el esquema. Las cuentas de Compras/administración reciben `supervisor` explícitamente. Un depositario operador conserva acceso exclusivamente a su depósito actual. No se pudo identificar inequívocamente una cuenta existente de Isaac: no se eligió otra persona ni se creó una cuenta o depósito por suposición.

La auditoría detectó advertencias preexistentes en otras funciones y configuración de Auth. No se modificaron otros dominios para resolverlas. Las nuevas RPC públicas son `SECURITY INVOKER`; el código privilegiado tiene `search_path=''` y vive en un esquema privado no expuesto.

## Tablas nuevas y responsabilidades

La migración es `migrations/20261008232715_fabricacion_naval.sql`. No contiene `DROP`, reemplazos de funciones existentes ni cargas de stock o usuarios. Los únicos registros iniciales son los cuatro tipos de componentes solicitados.

| Tabla | Responsabilidad |
| --- | --- |
| `fabrication_settings` | Habilitación, zona horaria y correo por depósito existente. |
| `fabrication_access` | Concesiones explícitas de operación/supervisión. |
| `fabrication_components` | Bularcamas, brasolas, tambuchos, escaleras y tipos futuros. |
| `fabrication_workers` | Personal real, especialidad, estado y tarifa opcional. |
| `fabrication_orders` | Número del servidor, proyecto, identificación/plano, cantidades, fechas, estado, personal y presupuesto opcional. |
| `fabrication_materials` | Requerimientos y reservas pendientes; **no representa existencias**. |
| `fabrication_logs` | Actividades, piezas nuevas y horas por operario; guarda nombres/tarifas de ese momento. |
| `fabrication_quality_checks` | Inspección interna, medidas, soldaduras, defectos, responsable y cantidad. |
| `fabrication_stock_links` | Relación orden ↔ movimiento existente; origen y asignaciones de las devoluciones. |
| `fabrication_events` | Actor, solicitud, datos y resultado; registro idempotente y trazabilidad. |
| `fabrication_attachments` | Metadatos de fotos/planos privados y vínculo opcional a una inspección. |
| `fabrication_closures` | Cierre de Isaac, equipos, compras y plan del día siguiente. |
| `fabrication_reports` | Revisiones persistidas y estado/errores de la cola de correo. |

Las vistas `v_fabrication_material_status` y `v_fabrication_costs` usan `security_invoker=true`. Incluyen el depósito para facilitar filtros/indexación y no conceden escritura.

## Seguridad y permisos

- Todas las tablas nuevas tienen RLS y ACL explícitas. El navegador solo tiene `SELECT` autorizado; no puede escribir directamente órdenes, reservas, partes ni concederse acceso.
- `fabrication_command(action, data, request_id)` verifica sesión, perfil activo, depósito actual y concesión antes de cada acción. Una cuenta desactivada o reasignada pierde acceso aunque conserve una concesión antigua.
- Un `operator` opera únicamente el depósito autorizado. Otros depositarios, incluso del mismo depósito sin concesión, no ven fabricación. La seguridad también se prueba llamando directamente las RPC y consultando tablas, sin depender del menú.
- Un `supervisor` consulta producción y reportes; no registra consumos, partes, calidad ni entregas. Los administradores mantienen su autoridad para configurar permisos y catálogos/personal. Para operar fabricación también necesitan una concesión `operator` explícita.
- Administradores sin concesión pueden acceder a Configuración, pero no reciben automáticamente datos de órdenes del taller.
- Storage `fabrication-documents` es privado: máximo 10 MB, JPEG/PNG/WebP/PDF; ruta `<warehouse_uuid>/<order_uuid>/<archivo>`. La lectura y carga verifican la orden y sus permisos. No se permite sobrescribir ni borrar desde el cliente.
- El PDF valida la sesión en Auth y lee con el JWT del usuario para respetar RLS. El correo utiliza un secreto de cron y una RPC reservada a `service_role`; ninguna clave privilegiada se incorpora al frontend.

## Stock y ciclo de una orden

1. Registrar proyecto/barcaza, componente, código, plano/revisión, cantidad, prioridad, fecha prevista y personal. El número `OF-000001` proviene de una identidad PostgreSQL.
2. Agregar materiales del catálogo actual, en su unidad base. Reservar establece la **reserva pendiente total**; cero la libera. Requerimiento, consumo neto y reserva deben ser coherentes.
3. En Preparación o En fabricación, consumir una cantidad reservada. En una sola transacción se bloquean los lotes FIFO, se reduce la reserva, se invoca `record_exit` y se vincula el movimiento. Un fallo revierte todo.
4. Devolver sobrantes desde el consumo de origen. La suma de devoluciones no puede superar ese consumo; se preservan las cantidades y monedas/costos de sus asignaciones FIFO mediante `record_return`.
5. Registrar actividad y horas de operarios asignados. Las piezas nuevas se cuentan una vez por parte, aunque participen varios operarios. El retrabajo admite cero piezas nuevas. El servidor evita superar la cantidad solicitada o 24 horas por persona/día entre órdenes.
6. Pasar a Control de calidad y registrar inspección interna. Una aprobación parcial no aprueba toda la orden. Defectos/retrabajos y el retorno a fabricación necesitan motivo. Este control **no sustituye** aprobación de Ingeniería, Calidad o Bureau Veritas.
7. Ingresar piezas aprobadas mediante `record_entry`, seleccionando previamente un producto existente con unidad base `unidad`. Costos y moneda son opcionales pero coherentes; si faltan, quedan sin valorar.
8. Marcar Terminado solo con todas las piezas fabricadas/aprobadas y sin reservas pendientes. Entregar con destino y receptor mediante `record_exit`; la entrega total cambia a Entregado.

Bloqueos y resoluciones llevan motivo. Cancelar conserva el historial y libera reservas; no permite cancelar una orden con productos ya ingresados/entregados. Los movimientos ligados a fabricación no admiten anulación genérica: se usa la devolución trazable de material.

El guard `fabrication_reserved_stock_guard` protege también salidas, transferencias y correcciones por las herramientas actuales. Sin reservas, los otros depósitos siguen el comportamiento anterior. Los lotes se bloquean en el mismo orden `(product_id, received_at, created_at, id)` que el FIFO existente. Las reservas son por producto/depósito, no otro stock ni una selección nueva de lotes.

El frontend conserva el UUID de una operación ante una respuesta incierta; el servidor impide reutilizarlo con otros datos o con un movimiento normal previo. Repetir la misma solicitud confirmada devuelve su resultado sin duplicar stock o producción. Registrar deliberadamente otra operación correcta genera otra solicitud.

Los ingresos conservan orden de origen y lote; las entregas siguen el FIFO actual. Piezas distintas deben usar productos distintos del catálogo por código/plano/revisión. Si dos órdenes producen el mismo producto fungible, la entrega puede asignar lotes de ambas según FIFO; las asignaciones existentes conservan la procedencia real. No se incorporó un selector de lotes paralelo. La salida de piezas no carga otra vez el costo a la barcaza: los materiales ya lo hicieron durante el consumo.

## Reportes diarios, supervisión y costos

La tarea `avh-fabrication-daily` ejecuta `generate_due_reports()` al minuto 10 de cada hora, si `pg_cron` está instalado. Genera una única revisión automática del último **día calendario completo** en la zona del taller (por defecto `America/Asuncion`). Recupera hasta 30 días pendientes por ejecución tras una interrupción. No depende de que Isaac tenga el navegador abierto. Sin `pg_cron`, debe habilitarse ese scheduler en el entorno aprobado; los reportes manuales siguen disponibles.

El contenido se consulta en PostgreSQL, sin el límite visual de los 400 movimientos recientes: entradas/salidas, transferencias creadas y recibidas ese día, correcciones/ajustes registrados, alertas de stock, órdenes, piezas, consumos, personal/horas, incidentes, inspecciones/retrabajos, faltantes, solicitudes de compras y cierre/plan de mañana. No completa datos ausentes con supuestos. Una sección vacía dice “Sin registros”; un costo desconocido no se presenta como cero.

Cada generación manual o cierre guarda una revisión adicional sin sobrescribir anteriores. El correo automático se encola únicamente para la revisión automática si está habilitado; las actualizaciones manuales no envían otra copia sin aviso. El historial muestra estado y error de envío y permite descargar cada revisión en PDF.

Los movimientos y partes están filtrados por fecha. **Stock, estados de órdenes y costos acumulados son la fotografía al generar la revisión**, y el reporte lo aclara; no se pretende reconstruir saldos históricos después de modificaciones posteriores. Para un reporte de fecha anterior se preservan los registros de ese día y se etiquetan esos datos acumulados. El plan de mañana sale del cierre de Isaac, sin inventar programación.

La supervisión separa producción diaria/acumulada, órdenes activas/atrasadas, calidad pendiente, faltantes, partes y costos disponibles. Los costos reales registrados son materiales FIFO menos devoluciones a costo original, más horas con tarifas capturadas. USD y PYG se muestran separados; no hay conversión implícita, costos indirectos ni liquidaciones. Se marca costo parcial si falta precio/tarifa/moneda. Los presupuestos son opcionales por orden. La productividad piezas/hora-persona se advierte como mezcla de componentes y no como rendimiento comparable entre diseños diferentes.

## Activación en un entorno aprobado

La siguiente secuencia es documentación para el responsable del despliegue. **No ejecutar contra producción antes de su autorización.** No utilizar `db reset` ni aplicar en bloque migraciones históricas cuyo estado remoto no se haya conciliado.

1. Preparar un Supabase de ensayo con el esquema actual de AVH, sin datos personales reales. Hacer copia de seguridad y comprobar el historial real de migraciones. Aplicar únicamente la nueva migración mediante el procedimiento aprobado. Validar RLS/grants de `public` y Storage, y confirmar `cron.job` para `avh-fabrication-daily`.
2. Para ensayar el frontend, cambiar **solo en la copia de ensayo** URL/clave pública de `src/core/config.js` y el origen permitido de CSP en `src/index.template.html`; el PR conserva los valores públicos actuales del sistema. Construir y servir `dist` en un origen de ensayo. No reemplazar credenciales productivas ni añadir claves de servicio.
3. Desplegar las funciones `fabrication-report-pdf` y, si se usará correo, `fabrication-report-mail`, incluyendo `_shared/fabrication-pdf.mjs`. El repositorio usa `edge-functions`; copiar esas carpetas a `supabase/functions` de un workspace de despliegue aprobado. Ambas funciones necesitan `verify_jwt=false` en el gateway: PDF comprueba el usuario explícitamente; correo comprueba el secreto dedicado. Ejemplo de configuración para ese workspace:

   ```toml
   [functions.fabrication-report-pdf]
   verify_jwt = false
   [functions.fabrication-report-mail]
   verify_jwt = false
   ```

   Desplegar solo esas funciones con Supabase CLI al `project-ref` aprobado. No desplegar ni reemplazar las otras Edge Functions del sistema.

4. Configurar secretos **en el servidor**, no en Git: PDF necesita `SUPABASE_URL`, clave pública/anon y `AVH_ALLOWED_ORIGIN` (solo el origen, sin ruta). Supabase provee sus variables estándar; una clave publishable puede usar `SUPABASE_PUBLISHABLE_KEY` si está disponible. Correo necesita `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `FABRICATION_REPORT_FROM` con remitente/dominio verificado y `FABRICATION_CRON_SECRET` aleatorio. El envío utiliza Resend y PDF adjunto; el PR no configura un proveedor ni dominio reales.
5. En Configuración de Fabricación Naval, elegir **el depósito ya asignado a la cuenta correcta de Isaac**, habilitar fabricación y conceder `operator`. Si no tiene cuenta/asignación, utilizar Administración existente para resolverlo con los datos confirmados; no crear otro depósito desde fabricación. Conceder `supervisor` a la cuenta de Compras y administradores autorizados. Registrar los tres operarios con nombres reales; agregar el soldador cuando corresponda. Crear, si faltan, los productos terminados mediante el catálogo existente.
6. Ensayar una orden completa y reservas simultáneas desde dos sesiones de PostgreSQL en staging; verificar otros depósitos, recepción/transferencia, salidas normales, devoluciones, calidad, ingreso/entrega y cierre. Verificar que una sesión desactivada/reasignada no pueda leer archivos ni PDF.
7. Para correo, probar con destinatarios de ensayo. Crear los tres secretos de Vault descritos en `ops/fabrication-mail-schedule.sql` y aplicar ese script opcional solo al proyecto aprobado. Usa `pg_cron` + `pg_net`, cada cinco minutos. Confirmar respuesta en `net._http_response` y ejecución en `cron.job_run_details`. Luego habilitar los destinatarios reales por Configuración únicamente tras autorización.
8. Tras aceptación y autorización, coordinar migración/funciones, concesiones y merge del PR. GitHub Pages publica al integrar en `main`; este PR no modifica ese flujo ni publica su rama. Mantener correo deshabilitado hasta completar su configuración.

El mail worker reclama una fila con `SKIP LOCKED`, token y reintentos acotados; registra errores y nunca declara enviado un rechazo del proveedor. Reintenta hasta cinco veces, con 15 minutos entre errores y recuperación de trabajos detenidos después de 10 minutos. Usa una clave idempotente estable por reporte. Resend conserva su deduplicación 24 horas: ante una caída prolongada tras un envío exitoso sin confirmación local, revisar el proveedor antes de reintentar manualmente. No se promete entrega exactamente una vez fuera de esa ventana. Un reporte agotado permanece visible con su error para revisión; no se borra ni se reinicia automáticamente.

Para suspender fabricación, primero liberar reservas activas y deshabilitar el taller en Configuración; no borrar tablas ni historial. Para suspender solo correo, deshabilitarlo y retirar el job `avh-fabrication-mail` por el procedimiento operativo aprobado. Revocar la concesión de una persona no cambia su asignación o permisos de inventario normales.

## Verificación reproducible

Requiere Node >= 22.18.0 (CI usa 24), `npm ci --ignore-scripts` en `v3` y Chromium instalado. Las pruebas no se conectan a producción ni envían correo real.

```bash
cd v3
node scripts/check.mjs
npm test
AVH_CHROME_BIN=/ruta/a/chrome npm run test:browser:manufacturing
# Con Deno instalado
deno check edge-functions/fabrication-report-pdf/index.ts edge-functions/fabrication-report-mail/index.ts
```

- `tests/fixtures/fabrication-inventory.sql`: copia **solo de esquema** y funciones reales de inventario/RLS auditadas; Auth/Storage mínimos simulados, sin registros productivos. PGlite aplica la nueva migración sobre PostgreSQL aislado.
- `tests/fabrication-postgres.test.mjs`: ciclo completo, permisos directos/RLS, otro depósito, reservas con RPC existentes, FIFO, idempotencia, devoluciones/costos, bloqueos, retrabajo, cantidades/horas, inspección, productos terminados/entrega, archivos, más de 505 movimientos, historial y cola de correo.
- `tests/fabrication-report.test.mjs`: PDF real de más de diez páginas conserva el último registro; sesión y acceso de PDF, descarga binaria, destinatarios, clave idempotente, rechazos del proveedor y autenticación de cron. Mocks de red comprueban las solicitudes; no sustituyen el ensayo posterior con el proveedor real.
- `tests/browser/fabrication.mjs`: Chromium real en viewport de celular y desktop; todas las llamadas HTTP/WebSocket de Supabase se interceptan hacia PostgreSQL aislado. Crear orden → reservar → consumir → registrar producción → cierre → PDF → inspección → ingreso → entrega; refrescar no pierde formulario; Compras consulta sin botones operativos; otro depositario no ve el menú ni puede abrir la ruta. Comprueba errores JS y desbordamiento horizontal. `AVH_QA_DIR` opcional guarda capturas temporales.
- CI conserva el smoke test general y agrega el recorrido de fabricación. Continúan las pruebas existentes de sesión, compras, reversión de recepción, permisos RPC, inventario inicial, paginación e idempotencia.

Resultado local: **38 pruebas pasaron**, build/contrato backend válido, typecheck de ambas Edge Functions con Deno y recorrido Chromium completo correcto. Se inspeccionaron visualmente móvil, supervisión y una página PDF. PGlite no ejecuta los servicios de Supabase, la planificación real de `pg_cron`/`pg_net` ni sesiones de base de datos paralelas: esos puntos, despliegue Deno/Storage real y entrega real de correo son criterios de aceptación de staging antes de producción.
