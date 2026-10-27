# Bienvenida y guía de uso de Inventario AVH

La opción **Cómo usar** está disponible para cuentas activas de administración y depósito, desde celular y escritorio. Incluye tres primeros pasos, un buscador, categorías y explicaciones desplegables. Los botones de la guía abren las pantallas existentes; no crean órdenes, compras ni movimientos.

El contenido depende de la cuenta y su autorización actual:

- **Depositario:** primer ingreso, inventario inicial, unidades, recepciones y documentos, salidas, transferencias, devoluciones, entradas, abastecimiento y correcciones.
- **Operador de fabricación autorizado:** agrega preparación del taller, personal/componentes, órdenes, requerimientos, reservas, consumos, producción/horas, calidad, ingreso y entrega de piezas, bloqueos, retrabajos y reportes/cierre diario.
- **Compras/administración:** compras y entregas, apertura/valoración inicial, catálogos/presentaciones/mínimos, proveedores, usuarios, alertas/reportes/auditoría y configuración de fabricación. La supervisión de un taller aparece para las cuentas autorizadas; los operadores administrativos conservan su guía operativa cuando corresponde.

## Administrador de solo lectura

Desde **Administración → Usuarios → Agregar usuario**, elegir **Administrador · Solo lectura**, indicar usuario y nombre y definir una contraseña temporal. No se asigna depósito. En el primer ingreso se exige una contraseña propia. El administrador general puede cambiar el nombre, desactivar la cuenta o restablecer su clave desde **Gestionar**.

Esta cuenta abre **Consulta general**, con compras, archivos registrados, existencias y costos de todos los depósitos, movimientos, proveedores, barcazas, fabricación, gases, OT, presupuestos y OC, reportes, alertas, auditoría y catálogos/usuarios. Permite buscar, filtrar, abrir detalles, descargar listados y consultar archivos existentes. Los documentos todavía no emitidos o adjuntados se muestran como pendientes; consultar no genera documentos nuevos.

El rol `admin_viewer` no se convierte en `admin`. RLS limita este acceso a lectura; políticas restrictivas y triggers también rechazan escrituras mediante RPC privilegiadas. Los archivos se consultan mediante enlaces temporales y deben estar registrados. Las acciones de usuarios y las Edge Functions administrativas conservan su comprobación de administrador general. La única modificación propia permitida es completar el cambio de contraseña. La desactivación revoca la consulta sin esperar la renovación del JWT.

La bienvenida aparece en Inicio después de completar el cambio obligatorio de contraseña. Es un aviso que el usuario puede cerrar; la guía permanece en el menú. Se recuerda por UUID de usuario en `localStorage` (`avh_user_guide_v1:<id>`), con respaldo en memoria si el navegador bloquea el almacenamiento. Otra cuenta en el mismo navegador tiene su propia bienvenida; un dispositivo nuevo puede mostrarla otra vez. No agrega tablas, permisos, RPC ni migraciones.

Para Compras/administración, Inicio conserva primero su tablero general: indicadores, operaciones frecuentes y tarjetas de todos los depósitos activos. La bienvenida aparece después de esas tarjetas y utiliza el contexto **Todos los depósitos**. El taller seleccionado en Fabricación no limita ni identifica el alcance general de esa cuenta. Los depositarios conservan su contexto de depósito asignado.

La búsqueda y las explicaciones abiertas se conservan durante la sincronización automática. El contenido se reconstruye cuando cambia el contexto de la cuenta o sus autorizaciones, y la bienvenida solo se restaura en su propio elemento, respetando los formularios abiertos. El cambio mantiene la navegación de depósito restringida a sus opciones actuales más Cómo usar.

Validación con `node scripts/check.mjs`, `npm test`, `npm run test:browser:manufacturing` y `npm run test:browser:refresh`. Las pruebas de navegador usan datos aislados e interceptan todas las llamadas a Supabase. Cubren bienvenida por cuenta y persistencia tras recarga, contenido y rutas por rol, búsqueda/resultado vacío, regreso a Inicio, cambio obligatorio de contraseña, reloj de 20 segundos y eventos de tiempo real. Además recorren las operaciones existentes de inventario, fabricación y supervisión para verificar la integración.
