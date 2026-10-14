# Órdenes de Trabajo

El espacio técnico de Galo convierte un Excel de alcance naval en un borrador revisable, un plan de insumos por trabajo y una OT formal en PDF.

## Uso

1. Entrar a **Órdenes de Trabajo**, seleccionar un Excel `.xlsx` o `.xls` y elegir la hoja correspondiente.
2. **Analizar con IA**. Revisar cliente, embarcación, medidas, trabajos, operaciones y controles propuestos.
3. Vincular insumos al catálogo existente. Definir cantidades y marcar las que el responsable haya confirmado.
4. **Guardar borrador** archiva el Excel original en Storage privado. **Vista previa PDF** permite revisar la presentación.
5. **Emitir OT numerada** asigna un número anual `OT-AVH-AAAA-NNNNN` en PostgreSQL y conserva una copia del alcance emitido. Descargar el PDF para enviarlo o imprimirlo.
6. Registrar avance por trabajo. Calidad registra sus inspecciones con acceso propio. El cierre requiere avance completo y aprobación de Calidad.

**Insumos y stock** acumula las cantidades del mismo producto entre todos los trabajos. Las cantidades sin definir permanecen pendientes. Un depositario habilitado puede preparar solicitudes para su depósito; los retiros mantienen el circuito existente de Depósito.

## Accesos

Los administradores ven el módulo. En **Órdenes de Trabajo → Accesos**, habilitar el usuario existente de Galo como **Preparar, emitir y seguir órdenes**. Para Calidad elegir **Inspeccionar trabajos**. Los usuarios sin autorización explícita carecen de acceso a órdenes y archivos. Crear usuarios nuevos desde Administración → Usuarios cuando corresponda.

## Despliegue

- Migración: `migrations/20261014194409_ordenes_trabajo_galo.sql`.
- Edge Functions: `work-order-ai` y `work-order-pdf`, con validación de JWT y autorización desde perfiles/roles guardados en PostgreSQL.
- IA: usa `OPENAI_API_KEY` del proyecto. `OPENAI_WORK_ORDER_MODEL` permite definir el modelo de este módulo; su valor predeterminado es `gpt-5.4-mini`.
- Excel: SheetJS CE `0.20.3`, copiado desde la distribución oficial a un asset local. Se carga cuando se importa un archivo y mantiene la CSP del sitio.
- Límites: 10 MB por archivo, 1.200 filas, 60 columnas, 300 trabajos por orden. Una hoja que supera el límite se rechaza de forma visible.
- Las operaciones de escritura usan solicitudes idempotentes. Los borradores detectan ediciones concurrentes. El alcance emitido es inmutable; los trabajos adicionales se preparan en otra orden.
- Las acciones quedan en `work_order_events` y en la auditoría administrativa existente.

## Verificación

`npm test` incluye PostgreSQL aislado para permisos, numeración, emisión y cierre; pruebas de la interfaz con DOM; y las funciones de IA/PDF con proveedores simulados. `node scripts/check.mjs` construye y valida el contrato de V3. El PDF se verifica visualmente con un alcance extenso. La cuenta de Galo y el proveedor de IA se verifican en una sesión autorizada del sistema.
