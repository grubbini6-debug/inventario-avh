# Órdenes de Trabajo

El espacio técnico de Galo convierte un Excel de alcance naval en un borrador revisable, un plan de insumos por trabajo y una OT formal en PDF.

## Uso

1. Entrar a **Órdenes de Trabajo**, seleccionar un Excel `.xlsx` o `.xls` y elegir la hoja correspondiente.
2. **Analizar con IA**. Revisar cliente, embarcación, lugar, trabajos, medidas y cantidades del alcance a ejecutar.
3. **Guardar borrador** archiva el Excel original en Storage privado. **Vista previa OT** permite revisar el documento de ejecución.
4. **Emitir OT numerada** asigna un número anual `OT-AVH-AAAA-NNNNN` en PostgreSQL y conserva una copia del alcance emitido. **Descargar OT** genera el PDF para enviarlo o imprimirlo.
5. **Insumos internos** conserva la planificación opcional de materiales y stock. Se puede revisar y completar cuando corresponda; preparar presupuestos, precios y OC pertenece al circuito posterior de Compras.
6. Registrar avance por trabajo. Calidad registra sus inspecciones con acceso propio. El cierre requiere avance completo y aprobación de Calidad.

El PDF comunica la orden de ejecución: encabezado, alcance, trabajos con medidas y cantidades, referencia del Excel y firmas. La impresión conserva el peso total indicado y omite los anexos de operaciones, controles e insumos por ítem. Los datos internos se mantienen guardados. Los pedidos de cotización entre paréntesis, como «cotizar por m2», y los comentarios de procesamiento de IA se excluyen de la impresión. El borrador de prueba de Touax 716 conserva sus 70 trabajos en 3 páginas, frente a las 32 anteriores.

**Insumos internos** acumula las cantidades del mismo producto entre todos los trabajos. Las cantidades sin definir permanecen pendientes. Un depositario habilitado puede preparar solicitudes para su depósito; los retiros mantienen el circuito existente de Depósito.

## Accesos

En **Administración → Usuarios**, elegir **Producción / Órdenes de Trabajo**, completar usuario, nombre, lugar de trabajo y clave temporal. **Inventario que puede consultar** permite elegir la sede autorizada; para Galo, Villa Hayes. La cuenta recibe permiso para preparar, emitir y seguir órdenes. Al ingresar abre directamente su panel; la primera sesión exige cambiar la clave. Administración puede actualizar estos datos, cambiar o quitar la consulta de inventario, desactivar la cuenta y restablecer su clave desde **Gestionar**.

La vista **Inventario** de Producción muestra cantidades y mínimos de la sede autorizada, con búsqueda y actualización. La autorización se valida en PostgreSQL. El servicio devuelve páginas de hasta 500 productos que la interfaz recorre por completo; el cliente no elige el depósito por parámetro. El permiso de consulta mantiene separados los registros de entradas, salidas, transferencias, lotes y precios. El lugar y la sede se usan como valores iniciales de las nuevas órdenes y para consultar stock en su plan de insumos.

Los administradores conservan supervisión del módulo. **Órdenes de Trabajo → Accesos** permite habilitar otras cuentas existentes o revocar permisos. Para Calidad elegir **Inspeccionar trabajos**. Producción prepara los requerimientos; Compras y el depositario coordinan el abastecimiento con los permisos de depósito existentes.

## Despliegue

- Migración: `migrations/20261014194409_ordenes_trabajo_galo.sql`.
- Perfil de Producción: `migrations/20261015105130_perfil_produccion_ordenes_trabajo.sql` y funciones `admin-create-user`, `admin-reset-user-password`. El alta del perfil y su acceso se guarda en una transacción; solo el servicio autorizado puede usar `provision_work_order_user`. La gestión de cuentas valida el rol administrador en PostgreSQL.
- Lugar e inventario de consulta: `migrations/20261015113424_lugar_produccion_inventario_consulta.sql`. Agrega `work_location` e `inventory_warehouse_id` al perfil; preserva `warehouse_id` para el rol depositario y conserva los contratos anteriores del alta y la gestión de usuarios.
- Edge Functions: `work-order-ai` y `work-order-pdf`, con validación de JWT y autorización desde perfiles/roles guardados en PostgreSQL.
- IA: usa `OPENAI_API_KEY` del proyecto. `OPENAI_WORK_ORDER_MODEL` permite definir el modelo de este módulo; su valor predeterminado es `gpt-5.4-mini`.
- Excel: SheetJS CE `0.20.3`, copiado desde la distribución oficial a un asset local. Se carga cuando se importa un archivo y mantiene la CSP del sitio.
- Límites: 10 MB por archivo, 1.200 filas, 60 columnas, 300 trabajos por orden. Una hoja que supera el límite se rechaza de forma visible.
- Las operaciones de escritura usan solicitudes idempotentes. Los borradores detectan ediciones concurrentes. El alcance emitido es inmutable; los trabajos adicionales se preparan en otra orden.
- Las acciones quedan en `work_order_events` y en la auditoría administrativa existente.

## Verificación

`npm test` incluye PostgreSQL aislado para permisos, numeración, emisión y cierre; pruebas de la interfaz con DOM; y las funciones de IA/PDF con proveedores simulados. `node scripts/check.mjs` construye y valida el contrato de V3. El PDF se verifica visualmente con un alcance extenso. La cuenta de Galo y el proveedor de IA se verifican en una sesión autorizada del sistema.
