# Reparaciones de máquinas

Disponible desde **Reparaciones**, para Compras / Administración. Producción y Depósito conservan sus permisos actuales y no pueden leer ni autorizar estos presupuestos.

Empezar desde **Cargar presupuesto con IA** y subir PDF, fotos o Excel sin completar campos previamente. Se prepara un borrador con las partidas, importes, taller, cliente, referencia, falla o alcance, garantía y condiciones visibles. Los datos faltantes quedan marcados para corregir. La lectura es una propuesta: **Confirmar revisión y enviar** guarda el original y solicita autorización; no emite la OC ni autoriza el trabajo.

Las máquinas existentes se vinculan por código o serie inequívocos. También se puede escribir en **Máquina que se repara** para buscar por nombre, código, modelo o serie y elegir una coincidencia. La lista muestra los equipos activos y su depósito; al elegir uno se completa el contexto de esa máquina. Con el catálogo vacío se escribe el nombre y se pulsa **Registrar y usar**; el formulario conserva ese nombre y propone un código interno si no se conoce uno. Se confirma el depósito y los datos disponibles antes de guardar. Si hace falta registrar un taller, también se hace dentro del borrador. Para una sola máquina, se elige una vez y se aplica a todas las partidas. La ficha identifica una máquina física; registrarla no aumenta ni descuenta el stock de materiales.

Cada reparación admite un presupuesto de un taller, una empresa, un depósito de origen y varias máquinas. Cada partida de mano de obra, repuesto instalado u otro servicio debe estar asignada a una máquina. Las máquinas pueden entregarse, regresar y probarse en fechas distintas.

1. Subir el presupuesto desde la entrada principal con IA o elegir **Cargar manualmente**. La lectura utiliza las funciones existentes con contexto de reparación, conserva los importes de origen y deja lo desconocido pendiente. Los originales se archivan en el bucket privado `repair-documents` al guardar.
2. Completar referencia y fecha, falla, empresa, taller, moneda e impuestos. Revisar cantidades, precios, asignación y total del original. Enviar para autorización.
3. Registrar quién autorizó y la referencia de su respaldo. Se emite una OC real de tipo servicio, vinculada a la reparación, sin ingreso automático a stock. Esto registra la autorización informada a Compras; no pretende suplantar una aprobación de Dirección dentro de una cuenta que no existe en el sistema.
4. Registrar entrega por equipo, en taller o en el depósito, con fecha, estado y accesorios. Para taller externo, identificar quién transporta. El remito PDF utiliza el equipo y la entrega guardados. Adjuntar su ejemplar firmado.
5. Registrar regreso y recepción, y el vencimiento de garantía confirmado si está disponible. El plazo ofrecido en el presupuesto se conserva; no se inventa una fecha de vencimiento. Registrar prueba, responsable técnico y observaciones. Una prueba fallida habilita el nuevo envío para retrabajo.
6. Solicitar y autorizar adicionales antes de cerrar con mayor costo. Se conservan los importes autorizados y su historial; el adicional genera su propia OC de servicio. No se pueden cambiar las partidas de una OC vinculada desde otra pantalla.
7. Con todos los equipos recibidos y conformes, registrar factura y distribución real por máquina. La suma debe coincidir con la factura y respetar los importes autorizados. Una misma factura del taller no se registra dos veces en reparaciones. Las OC vinculadas quedan facturadas y Tesorería conserva el circuito de pago.

Antes de cualquier entrega, una reparación autorizada puede anularse con motivo y respaldo de la autorización de anulación, siempre que todavía no tenga factura ni recepción registrada. El número, la aprobación y los eventos se conservan; las OC se anulan y se libera la custodia de las máquinas.

La ficha del equipo muestra por separado costos facturados en PYG y USD y cada reparación previa. No suma monedas distintas ni presenta el presupuesto pendiente como un costo facturado.

## Reglas técnicas

- Solo V3. Las funciones públicas son wrappers `SECURITY INVOKER`; la escritura y las lecturas documentales pasan por funciones privadas con usuario activo, rol administrativo y contraseña inicial completada.
- Tablas con RLS y lectura administrativa. Sin DML directo para el cliente. Los respaldos son privados y se valida que cada objeto corresponda a su reparación.
- Los cambios usan versión esperada e identificador estable de operación. Los reintentos con respuesta perdida no duplican órdenes, entregas ni OC.
- Presupuestos y distribución se normalizan y calculan en PostgreSQL. Las instantáneas aprobadas se conservan en los eventos; PDF de ejecución y remito usan datos guardados.
- Los repuestos **instalados por el taller** son parte del servicio. La compra de repuestos para guardar en depósito sigue el circuito normal de Compras y recepción.
- La instalación no carga máquinas de ejemplo ni modifica existencias, compras o movimientos históricos.

## Validación

```bash
node scripts/check.mjs
npm test
AVH_CHROME_BIN=/ruta/a/chrome npm run test:browser:repairs
```

Las pruebas de reparación usan PostgreSQL aislado, los RPC de compra reales y un adaptador HTTP de prueba para verificar el flujo completo en escritorio y celular. La lectura de IA se sustituye por una respuesta controlada en el navegador; sus funciones existentes conservan sus propias pruebas. Los PDF se generan y se verifica su texto y paginación.
