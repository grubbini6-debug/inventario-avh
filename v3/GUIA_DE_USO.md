# Bienvenida y guía de uso de Inventario AVH

La opción **Cómo usar** está disponible para cuentas activas de administración y depósito, desde celular y escritorio. Incluye tres primeros pasos, un buscador, categorías y explicaciones desplegables. Los botones de la guía abren las pantallas existentes; no crean órdenes, compras ni movimientos.

El contenido depende de la cuenta y su autorización actual:

- **Depositario:** primer ingreso, inventario inicial, unidades, recepciones y documentos, salidas, transferencias, devoluciones, entradas, abastecimiento y correcciones.
- **Operador de fabricación autorizado:** agrega preparación del taller, personal/componentes, órdenes, requerimientos, reservas, consumos, producción/horas, calidad, ingreso y entrega de piezas, bloqueos, retrabajos y reportes/cierre diario.
- **Compras/administración:** compras y entregas, apertura/valoración inicial, catálogos/presentaciones/mínimos, proveedores, usuarios, alertas/reportes/auditoría y configuración de fabricación. La supervisión de un taller aparece para las cuentas autorizadas; los operadores administrativos conservan su guía operativa cuando corresponde.

La bienvenida aparece en Inicio después de completar el cambio obligatorio de contraseña. Es un aviso que el usuario puede cerrar; la guía permanece en el menú. Se recuerda por UUID de usuario en `localStorage` (`avh_user_guide_v1:<id>`), con respaldo en memoria si el navegador bloquea el almacenamiento. Otra cuenta en el mismo navegador tiene su propia bienvenida; un dispositivo nuevo puede mostrarla otra vez. No agrega tablas, permisos, RPC ni migraciones.

La búsqueda y las explicaciones abiertas se conservan durante la sincronización automática. El contenido se reconstruye cuando cambia el contexto de la cuenta o sus autorizaciones, y la bienvenida solo se restaura en su propio elemento, respetando los formularios abiertos. El cambio mantiene la navegación de depósito restringida a sus opciones actuales más Cómo usar.

Validación con `node scripts/check.mjs`, `npm test`, `npm run test:browser:manufacturing` y `npm run test:browser:refresh`. Las pruebas de navegador usan datos aislados e interceptan todas las llamadas a Supabase. Cubren bienvenida por cuenta y persistencia tras recarga, contenido y rutas por rol, búsqueda/resultado vacío, regreso a Inicio, cambio obligatorio de contraseña, reloj de 20 segundos y eventos de tiempo real. Además recorren las operaciones existentes de inventario, fabricación y supervisión para verificar la integración.
