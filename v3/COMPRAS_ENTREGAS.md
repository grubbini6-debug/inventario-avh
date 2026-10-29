# Entregas parciales y cierre de saldos

Una OC conserva la cantidad aprobada, la cantidad efectivamente recibida y el saldo cancelado por falta de entrega. Compras puede usar **Cerrar saldo no entregado** en el expediente, seleccionar las líneas e indicar el motivo. La operación se audita y no crea entradas de stock ni modifica facturas o recepciones anteriores. Si ya no queda nada por recibir, la compra queda cerrada; un importe facturado sobre el saldo cancelado sigue requiriendo revisión.

Compras puede habilitar varios depósitos desde **Depósitos habilitados para recibir** en la misma OC. El depósito principal permanece incluido. Todos comparten el saldo pendiente; no se asigna anticipadamente una cantidad a cada ubicación. Compras indica dónde mandar cada entrega y cada depositario confirma solamente lo que llega a su depósito, con su remito o factura. La entrada y su costo FIFO quedan en el depósito que recibió la mercadería. Las entregas parciales requieren ingresar una cantidad real y no se precargan con todo el pedido.

Una recepción anulada vuelve a abrir solamente la cantidad que se había recibido; conserva los saldos ya cancelados. Un depósito ajeno a los destinos habilitados no puede consultar ni recibir la OC, y los perfiles de producción o de solo lectura no pueden configurar destinos ni cancelar saldos.

Validación: pruebas PostgreSQL aisladas de recepción entre depósitos, límite global, repetición de una recepción, cierre parcial y total sin alterar stock, anulación posterior, permisos y archivos; pruebas de interfaz de selección de OC, cantidades pendientes y cierre con motivo obligatorio.
