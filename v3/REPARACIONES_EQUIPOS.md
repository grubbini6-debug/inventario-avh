# Reparaciones de máquinas

Disponible desde **Reparaciones**, para Compras / Administración. Producción y Depósito conservan sus permisos actuales y no pueden leer ni autorizar estos presupuestos.

Registrar primero los equipos con código único, depósito y número de serie cuando se conozca. La ficha identifica una máquina física; registrarla no aumenta ni descuenta el stock de materiales.

Cada reparación admite un presupuesto de un taller, una empresa, un depósito de origen y varias máquinas. Cada partida de mano de obra, repuesto instalado u otro servicio debe estar asignada a una máquina. Las máquinas pueden entregarse, regresar y probarse en fechas distintas.

1. Crear el borrador y cargar presupuesto manualmente o desde Excel/CSV, PDF y fotos. La lectura utiliza las funciones de presupuestos existentes, conserva datos desconocidos para revisión y no autoriza trabajos. Los originales se archivan en el bucket privado `repair-documents` al guardar.
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
