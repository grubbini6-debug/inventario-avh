# Entregas parciales y cierre de saldos

## Servicios y entregas directas confirmados por Compras

La cuenta de Compras puede registrar la compra y adjuntar presupuesto, factura, remito o comprobante de pago en su expediente. Cuando el destino es **Servicio**, **Entrega directa**, **Barcaza / proyecto** u **Otro** y ninguna partida ingresa al inventario, el Resumen muestra **Confirmar servicio realizado** o **Confirmar recepción directa**. Primero debe estar confirmada la compra al proveedor.

Quien confirma ingresa la fecha real, las cantidades realizadas o recibidas y una descripción de la conformidad. Las cantidades comienzan vacías y admiten confirmaciones parciales: por ejemplo, 3 de las 6 horas de una grúa. El sistema guarda el usuario responsable, el momento del registro y la fecha del trabajo o entrega. Estas conformidades no crean un depósito ni movimientos o lotes de stock.

La factura y el remito/parte de servicio son opcionales al confirmar. Después se completan desde **Adjuntar factura/remito**, dentro de la misma compra, sin confirmar otra vez las cantidades. Un fallo de adjunto se informa conservando la conformidad ya registrada. Los reintentos de una respuesta incierta reutilizan la misma solicitud para no duplicar cantidades.

La pestaña Recepciones e Historial conservan la conformidad, su responsable y su fecha; una corrección utiliza **Anular conformidad** con motivo y mantiene el historial. Los depositarios conservan el circuito de recepción física de su depósito. Producción, usuarios inactivos y administradores de solo lectura no pueden confirmar servicios.

## Recepciones de depósito

Una OC conserva la cantidad aprobada, la cantidad efectivamente recibida y el saldo cancelado por falta de entrega. Compras puede usar **Cerrar saldo no entregado** en el expediente, seleccionar las líneas e indicar el motivo. La operación se audita y no crea entradas de stock ni modifica facturas o recepciones anteriores. Si ya no queda nada por recibir, la compra queda cerrada; un importe facturado sobre el saldo cancelado sigue requiriendo revisión.

Compras puede habilitar varios depósitos desde **Depósitos habilitados para recibir** en la misma OC. El depósito principal permanece incluido. Todos comparten el saldo pendiente; no se asigna anticipadamente una cantidad a cada ubicación. Compras indica dónde mandar cada entrega y cada depositario confirma solamente lo que llega a su depósito, con su remito o factura. La entrada y su costo FIFO quedan en el depósito que recibió la mercadería. Las entregas parciales requieren ingresar una cantidad real y no se precargan con todo el pedido.

Una recepción anulada vuelve a abrir solamente la cantidad que se había recibido; conserva los saldos ya cancelados. Un depósito ajeno a los destinos habilitados no puede consultar ni recibir la OC, y los perfiles de producción o de solo lectura no pueden configurar destinos ni cancelar saldos.

Cada entrega puede llegar solamente con un **remito**, sin moneda, precios, IVA ni total. Se registra su número comercial, fecha y cantidades reales; los remitos se archivan en la misma OC y no suman cantidades facturadas. El control muestra por separado **Recibido**, **Pendiente de recibir** y **Facturado acumulado**. La factura puede adjuntarse después, sin repetir la recepción ni aumentar el stock. Un remito ya guardado se informa como respaldo de la entrega, con facturación pendiente.

La lectura de facturas comprueba también el tipo y el encabezado visible. Si dos lecturas confirman con alta confianza que el archivo subido como factura es una nota de remisión, se reclasifica como remito con auditoría. No se reclasifica una factura por tener precios ilegibles. El CDC de 44 dígitos no reemplaza al número comercial. La limpieza de una referencia errónea del encabezado usa el valor y la versión de compra originales para conservar cualquier factura adjuntada concurrentemente.

Validación: pruebas PostgreSQL aisladas de recepción entre depósitos, límite global, repetición de una recepción, cierre parcial y total sin alterar stock, anulación posterior, permisos y archivos; pruebas de interfaz de selección de OC, cantidades pendientes y cierre con motivo obligatorio.
