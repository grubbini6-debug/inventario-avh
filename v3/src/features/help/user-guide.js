// Read-only onboarding. Routes reuse existing pages; reading a guide never records stock.
(function(){
  const VERSION='1',seen=new Set();
  const normal=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const eligible=()=>!!profile?.active&&!profile.must_change_password&&['admin','depositor'].includes(profile.role);
  function access(){
    const admin=profile?.role==='admin',f=window.AVHManufacturing?.state;
    const workshop=f?.context?.workshops?.find(w=>w.warehouse_id===f.warehouse&&w.enabled&&w.access_level);
    const assigned=admin||workshop?.warehouse_id===profile?.warehouse_id;
    const operator=!!(workshop&&assigned&&window.AVHManufacturing?.writable());
    const supervisor=!!(admin&&workshop&&workshop.access_level==='supervisor');
    const warehouse=admin?(workshop?whName(workshop.warehouse_id):''):whName(profile?.warehouse_id);
    return{admin,operator,supervisor,warehouse,role:operator?'Depósito y Fabricación Naval':admin?'Compras y administración':'Depósito'};
  }
  const key=()=>`avh_user_guide_v${VERSION}:${profile.id}`;
  function hasSeen(){try{return seen.has(profile.id)||localStorage.getItem(key())==='seen'}catch{return seen.has(profile.id)}}
  function acknowledge(){
    if(!eligible())return;seen.add(profile.id);try{localStorage.setItem(key(),'seen')}catch{}
    $('#guideWelcome')?.remove();
    const b=$('#guideAcknowledge');if(b){b.textContent='Guía revisada';b.disabled=true}
    const ack=$('#guideAck');if(ack)ack.textContent='Podés volver a esta guía desde Cómo usar en el menú.';
  }
  const step=(title,text)=>({title,text});
  const topic=(id,category,title,summary,steps,note='',action=null)=>({id,category,title,summary,steps,note,action});
  function topics(a){
    const common=[
      topic('first-login','Primeros pasos','Primer ingreso y navegación','Conocé tu cuenta y encontrá las tareas que tenés habilitadas.',[
        step('Ingresá con tu usuario','Usá la cuenta y contraseña que te entregó administración. Si el sistema pide cambiar la contraseña, completá ese paso antes de trabajar.'),
        step('Revisá tu contexto',a.admin?'Tu cuenta permite gestionar compras y administración. Fabricación muestra los talleres para los que tengas autorización.':'En Inicio figura tu depósito asignado. Las cantidades y operaciones que cargues pertenecen a ese depósito.'),
        step('Consultá esta guía','Cómo usar queda siempre en el menú. Buscá una tarea o elegí una categoría y abrí su explicación.'),
        step('Volvé a tu trabajo','Los botones de esta guía abren las pantallas existentes. Completar y confirmar cada formulario es lo que guarda una operación.')
      ],'La bienvenida se puede cerrar. Se recuerda por cuenta en este navegador; en otro dispositivo puede aparecer de nuevo.'),
      topic('stock','Depósito','Consultar inventario y entender las unidades','Existencias, presentaciones, lotes y alertas.',[
        step('Abrí Inventario',a.admin?'Elegí el depósito que querés consultar y buscá el producto.':'Abrí Inventario y buscá el producto de tu depósito.'),
        step('Revisá la unidad base','El stock se controla en la unidad base del producto. Una presentación, como un rollo, puede equivaler a varios kg; revisá la conversión que muestra el formulario.'),
        step('Consultá el detalle','Abrí el producto para revisar la información disponible de lotes y movimientos. Revisá las alertas de stock bajo para anticipar faltantes.')
      ],'Contá unidades y cantidades reales. Si falta una conversión correcta, consultá a Compras antes de confirmar.','stock'),
      topic('save-and-sync','Primeros pasos','Guardar, sincronizar y resolver un error','Qué queda guardado y cómo cuidar una carga en curso.',[
        step('Completá y confirmá','Revisá material, cantidad, unidad, depósito o destino y documentación. Esperá el mensaje de confirmación del sistema.'),
        step('Si falla la conexión','Conservá el formulario y reintentá la misma operación. Si tenés dudas sobre el resultado, revisá el historial antes de iniciar otra carga.'),
        step('Terminá antes de salir','La actualización automática conserva los formularios abiertos. Lo que todavía no confirmaste es un borrador en pantalla: recargar la página, cerrar la pestaña o salir puede perderlo.'),
        step('Si una opción no aparece','Puede depender de tu rol, del depósito asignado, de una sesión inicial abierta o del estado de una orden. Pedí a Compras que revise la habilitación necesaria.')
      ],'Ante un dato equivocado ya confirmado, usá el circuito de corrección; contá qué pasó y qué debería quedar registrado.')
    ];
    const depot=[
      topic('initial','Depósito','Cargar el inventario inicial','Contar lo que ya existe físicamente en el depósito.',[
        step('Esperá la apertura','Administración debe abrir el inventario inicial. Cuando esté habilitado, en Inicio aparece Continuar inventario inicial.'),
        step('Identificá el material',a.operator?'Elegí una sugerencia del catálogo o escribí un material nuevo. Para un material nuevo, indicá su unidad base.':'Elegí el material del catálogo y su unidad o presentación. Si falta un producto, pedí a Compras que lo incorpore.'),
        step('Cargá el conteo físico','Ingresá cantidad y, si corresponde, lote y observación. Guardar y cargar otro permite seguir con el próximo material. Administración completa los precios después.'),
        step('Revisá lo cargado','Consultá Último cargado y el stock. Contá una misma existencia una sola vez; cada guardado agrega cantidad al inventario.')
      ],'Después de registrar la existencia inicial, los materiales que llegan se cargan como recepción de compra o entrada, según corresponda.','home'),
      topic('receive','Depósito','Recibir una compra y sus documentos','Registrar una entrega completa o parcial de una OC.',[
        step('Abrí Recibir compra','Desde Inicio elegí la compra pendiente destinada a tu depósito.'),
        step('Contá lo recibido','Completá únicamente la cantidad que llegó de cada ítem. Si la entrega es parcial, el resto queda pendiente para una próxima recepción.'),
        step('Adjuntá respaldo','Cargá el remito o factura y sus datos cuando estén disponibles. Revisá los productos y cantidades propuestos si usás la asistencia por foto.'),
        step('Confirmá y revisá','Confirmá la recepción y verificá el stock y la compra. Si quedó un documento pendiente, completalo desde el aviso o registro correspondiente.')
      ],'Una compra pedida todavía no es stock recibido. La recepción registra lo que realmente llegó.','home'),
      topic('exit','Depósito','Dar salida a un material','Dejar registrado qué se entregó, a quién y para qué.',[
        step('Abrí Dar salida','Desde Inicio seleccioná el producto, cantidad y unidad o presentación.'),
        step('Identificá el retiro','Completá la persona que retira y el destino o barcaza cuando corresponda. Agregá una observación útil para el seguimiento.'),
        step('Confirmá la entrega','Revisá el resumen, confirmá y comprobá el movimiento en Mis últimos movimientos.')
      ],a.operator?'Para materiales usados en una orden de fabricación, registrá Consumir dentro de esa orden: así el uso queda vinculado a la orden y al stock.':'La cantidad confirmada descuenta stock del depósito.','home'),
      topic('transfer','Depósito','Transferir entre depósitos','Enviar materiales y confirmar su recepción en el destino.',[
        step('Registrá el envío','En Inicio → Transferir elegí depósito de destino, materiales, cantidades y unidades.'),
        step('Confirmá lo que salió','Revisá los datos del traslado y confirmá. La transferencia queda en tránsito hasta que el responsable del destino la reciba.'),
        step('Recibí un traslado','Si llega una transferencia a tu depósito, revisá el aviso de transferencia pendiente, verificá materiales y cantidades y confirmá la recepción.')
      ],'El destino incorpora stock al confirmar la recepción. Si las cantidades no coinciden con el envío registrado, informá la diferencia a Compras antes de confirmar.','home'),
      topic('returns-and-entry','Depósito','Devoluciones y entradas manuales','Material que vuelve o ingresa sin una compra vinculada.',[
        step('Material devuelto','En Inicio → Devolución indicá producto, cantidad, unidad y quién devuelve. Agregá la referencia del trabajo o destino correspondiente.'),
        step('Ingreso sin OC','En Inicio → Más opciones → Entrada manual registrá el material que llega sin una compra vinculada y adjuntá su respaldo cuando corresponda.'),
        step('Revisá la confirmación','Comprobá el stock y el registro en el historial luego de guardar.')
      ],a.operator?'Los sobrantes de fabricación se devuelven desde el consumo de su orden, con Devolver sobrante.':'Si el ingreso corresponde a una compra registrada, utilizá su recepción para mantener relacionados la compra, el stock y los documentos.','home'),
      topic('supply','Depósito','Pedir materiales a Compras','Solicitar reposición o un material que todavía no está en catálogo.',[
        step('Abrí Solicitar material','Encontrás el botón en Inicio → Más opciones.'),
        step('Describí la necesidad','Elegí un material o escribí su nombre. Indicá cantidad, unidad, urgencia, motivo y una observación que explique para qué se necesita.'),
        step('Seguí la solicitud','Cada envío queda registrado para que Compras revise la necesidad y actualice su estado. Consultá el seguimiento disponible en tu cuenta o pedí a Compras la respuesta.')
      ],'La solicitud informa una necesidad. El stock aumenta cuando se registra la recepción del material.','home'),
      topic('correction','Depósito','Revisar movimientos y pedir una corrección','Qué hacer si cargaste un producto o una cantidad equivocada.',[
        step('Encontrá el registro','En Inicio consultá Mis últimos movimientos y ubicá el movimiento que cargaste.'),
        step('Solicitá la corrección','Usá Solicitar corrección cuando esté disponible. Explicá el error y detallá producto, cantidad o destino correctos.'),
        step('Esperá la revisión','Compras o administración revisa la solicitud y aplica la operación que corresponda, conservando la trazabilidad.')
      ],'Para corregir un registro confirmado, informá el error antes de cargar otra entrada o salida que altere las cantidades.','home')
    ];
    const manufacturing=[
      topic('factory-start','Fabricación','Preparar el taller, el personal y los componentes','Primeros pasos antes de crear una orden.',[
        step('Comprobá los materiales','Cargá las existencias reales mediante el inventario inicial habilitado y las recepciones del depósito.'),
        step('Registrá al personal','En Fabricación Naval → Personal → + Operario ingresá nombres reales, especialidad y estado. La tarifa por hora es opcional.'),
        step('Elegí los componentes','El catálogo incluye bularcamas, brasolas de los costados, tambuchos y escaleras. En Personal → + Componente podés agregar otros tipos.'),
        step('Prepará el producto terminado','Para incorporar las piezas fabricadas al stock, la orden necesita un Producto terminado del catálogo existente con unidad base unidad. Si falta, pedí a Compras que lo cree en Productos.')
      ],'Los productos terminados se ingresan desde su orden después del control interno. El inventario inicial se utiliza para existencias que ya están físicamente en el depósito.','fabrication-workers'),
      topic('factory-order','Fabricación','Crear y actualizar una orden de fabricación','Definir qué hay que fabricar, para cuándo y quién lo hará.',[
        step('Abrí + Orden','En Fabricación Naval → Órdenes cargá barcaza o proyecto, componente, código de pieza, plano y revisión, cantidad, prioridad y fecha prevista.'),
        step('Asigná personal','Seleccioná los operarios que van a trabajar. Los costos estimados son opcionales; completalos cuando tengas datos.'),
        step('Guardá la orden','El servidor asigna el número OF. Abrí la orden guardada para ver avances, materiales, archivos y trazabilidad.'),
        step('Iniciá el trabajo','Usá Cambiar estado para pasar de Pendiente a Preparación y luego a En fabricación. Editar orden permite actualizar los datos cuando el estado lo admite.')
      ],'El plano y la revisión deben identificar el documento que realmente se está usando.','fabrication-orders'),
      topic('factory-materials','Fabricación','Requerir, reservar y consumir materiales','Usar las existencias del depósito dentro de una orden.',[
        step('Agregá el requerimiento','Dentro de la orden usá + Requerimiento. Elegí el material e indicá la cantidad total requerida en su unidad base.'),
        step('Reservá para la orden','Reservar / liberar establece la nueva reserva pendiente total. Revisá stock disponible, otras reservas y faltantes.'),
        step('Registrá el uso efectivo','Con la orden en Preparación o En fabricación, usá Consumir para registrar la cantidad realmente utilizada de la reserva. Ese paso descuenta stock y vincula el movimiento a la orden.'),
        step('Registrá sobrantes','Desde el consumo vinculado usá Devolver sobrante para lo que vuelve físicamente al depósito. Para liberar una reserva que no usarás, cambiá la reserva pendiente a 0.')
      ],'Reservar aparta disponibilidad; Consumir registra el uso real. Cada consumo de fabricación debe cargarse una vez dentro de su orden.','fabrication-orders'),
      topic('factory-production','Fabricación','Registrar avances, horas y problemas','Cargar el trabajo realizado cada día.',[
        step('Abrí Registrar producción','El botón aparece cuando la orden está en Preparación o En fabricación.'),
        step('Describí la actividad','Indicá fecha, trabajo realizado, observaciones e incidentes. Registrá las horas reales de cada operario asignado que participó.'),
        step('Contá las piezas nuevas','Cargá únicamente las piezas nuevas fabricadas en ese registro. El sistema suma los registros para calcular el acumulado y lo pendiente.'),
        step('Informá bloqueos','Usá Registrar bloqueo para explicar un problema que impide trabajar y Resolver bloqueo cuando se solucione.')
      ],'En un retrabajo registrá la actividad y las horas con 0 piezas nuevas, para conservar la cantidad fabricada.','fabrication-orders'),
      topic('factory-quality','Fabricación','Control interno, ingreso de piezas y entrega','Completar la orden con trazabilidad de calidad y stock.',[
        step('Pasá a Control de calidad','En Cambiar estado seleccioná Control de calidad cuando corresponda. Abrí Control interno y registrá plano/revisión, medidas, soldaduras, cantidad, responsable, resultado y defectos.'),
        step('Adjuntá respaldo','Usá Adjuntar foto / plano para agregar fotos o documentos. Podés vincular el archivo a una inspección.'),
        step('Ingresá las piezas aprobadas','Con el Producto terminado asignado en la orden, usá Ingresar piezas al inventario para las piezas aprobadas internamente. El costo unitario es opcional.'),
        step('Terminá y entregá','Una vez completos los registros y liberadas las reservas pendientes, pasá a Terminado. Entregar piezas registra cantidad, persona que recibe y destino.'),
        step('Si hay retrabajo','Registrá el resultado y los defectos. Para volver de Control de calidad a En fabricación, indicá el motivo. La cancelación también requiere una explicación y cumplir los controles que muestra el sistema.')
      ],'El control interno del taller conserva sus evidencias y es distinto de una aprobación formal de Ingeniería, Calidad o Bureau Veritas.','fabrication-orders'),
      topic('factory-report','Fabricación','Cierre del día y reportes diarios','Dejar a Compras lo realizado, los problemas y el plan de mañana.',[
        step('Cargá las operaciones del día','Registrá los movimientos del depósito, consumos de órdenes, producción, horas y controles internos que se realizaron.'),
        step('Completá el cierre','En Fabricación Naval → Reportes diarios → Observaciones de cierre detallá observaciones, problemas de equipos, necesidades de compras y actividades previstas para mañana.'),
        step('Consultá el reporte','Generar / actualizar permite guardar una revisión del día seleccionado. El reporte automático recoge el día completo una vez que finaliza; el historial conserva sus revisiones.'),
        step('Descargá el PDF','En el historial elegí la fecha y usá PDF. Compras puede consultar ese mismo reporte desde su supervisión.')
      ],'El reporte usa lo registrado. Completá los datos faltantes en su pantalla de origen. El correo automático depende de la configuración de Compras.','fabrication-reports')
    ];
    const administration=[
      topic('purchase','Compras','Crear una compra y seguir sus entregas','Proveedor, destino, cantidades, precios y documentación.',[
        step('Abrí Compras','Usá + Nueva compra y completá empresa que compra, proveedor, tipo, urgencia y destino. Para entrega a depósito, elegí quién debe recibir.'),
        step('Revisá los ítems','Cargá productos, cantidades, unidades, precios y moneda. Revisá el resumen antes de confirmar; las sugerencias de documentos o IA se verifican con el respaldo original.'),
        step('Seguí el estado','Abrí la compra para revisar cantidades recibidas, saldo pendiente y documentos. Cada entrega parcial se registra contra esa misma compra.'),
        step('Completá documentos','Relacioná facturas y remitos con la compra o recepción correspondiente. Revisá avisos de documentación pendiente.')
      ],'Una compra y su recepción representan pasos distintos: la recepción es la que incorpora los materiales efectivamente recibidos.','purchases'),
      topic('opening-admin','Administración','Habilitar y cerrar un inventario inicial','Autorizar el conteo del depositario y completar su valoración.',[
        step('Elegí el depósito','En Administración → Inventario inicial seleccioná el depósito existente y usá Abrir inventario inicial.'),
        step('Revisá el conteo','El depositario carga existencias físicas. Revisá productos, cantidades y lotes que registró.'),
        step('Completá la valoración','Cargá precios y monedas con datos reales. El cierre se habilita cuando se cumplen las validaciones de las líneas.'),
        step('Cerrá la sesión','Usá Cerrar inventario al finalizar. Para corregir después, utilizá la reapertura explícita y el circuito de control correspondiente.')
      ],'La apertura permite cargar stock físico; revisá el conteo antes de cerrarlo.','admin-opening'),
      topic('catalogs','Administración','Productos, presentaciones y stock mínimo','Mantener el catálogo que utilizan todos los depósitos.',[
        step('Definí el producto','En Administración → Productos cargá nombre técnico, unidad base y código cuando corresponda.'),
        step('Revisá las presentaciones','En Presentaciones registrá equivalencias reales, por ejemplo cuántos kg contiene una presentación. Verificá la unidad base antes de definir la conversión.'),
        step('Configurá mínimos','En Mínimos asigná el nivel necesario para cada producto y depósito; las alertas se calculan con esos valores.'),
        step('Producto fabricado','Para ingresar piezas terminadas de una orden, creá su producto en el catálogo con unidad base unidad y pedí al operador que lo vincule a la orden.')
      ],'Crear un producto en el catálogo no carga cantidades de stock. Los movimientos y la fabricación registran las existencias.','admin-products'),
      topic('users','Administración','Crear usuarios y asignar sus permisos','Preparar una cuenta nueva con el acceso que le corresponde.',[
        step('Creá el depositario','En Administración → Usuarios completá usuario, nombre, depósito asignado y contraseña temporal. Usá Crear depositario.'),
        step('Entregá el acceso','Indicá al usuario que ingrese y cambie su contraseña si el sistema lo solicita. En su Inicio verá la bienvenida y Cómo usar quedará disponible en el menú.'),
        step('Habilitá fabricación si corresponde','En Fabricación Naval → Configuración seleccioná el depósito existente. En Autorizar usuario asigná Operación al depositario correspondiente o Supervisión a una cuenta administrativa autorizada.'),
        step('Revisá cambios de personal','Actualizá la asignación o desactivá cuentas cuando corresponda. El rol de la cuenta y la autorización de fabricación deben coincidir con sus responsabilidades.')
      ],'La guía se adapta a la cuenta. Leerla o cerrarla conserva los permisos existentes.','admin-users'),
      topic('suppliers','Compras','Proveedores e historial de compras','Consultar contactos y la información comercial registrada.',[
        step('Abrí Proveedores','Consultá o completá los datos del proveedor desde su sección.'),
        step('Revisá su ficha','Abrí la ficha disponible para consultar compras, entregas, documentos y precios registrados.'),
        step('Usá el historial','Revisá fechas, moneda, unidad y cantidades antes de comparar compras o tomar un precio como referencia.')
      ],'Un precio histórico sirve como referencia para su unidad, presentación y fecha.','suppliers'),
      topic('admin-reports','Compras','Alertas, reportes, barcazas y auditoría','Controlar la operación y atender los pendientes.',[
        step('Revisá Alertas','Consultá stock crítico, transferencias, solicitudes de materiales y correcciones pendientes. Registrá la respuesta que corresponda.'),
        step('Consultá Reportes y Barcazas','Revisá los indicadores de movimientos, consumo y valorización. En Barcazas consultá consumos asociados a cada proyecto.'),
        step('Revisá la trazabilidad','En Más → Auditoría consultá quién registró cada operación y cuándo. Calidad de datos ayuda a encontrar registros que necesitan revisión.')
      ],'Cuando faltan precios o registros, los indicadores pueden estar incompletos. Completá la información de origen para mejorar el reporte.','alerts'),
      topic('factory-settings','Administración','Configurar Fabricación Naval','Habilitar el taller y la supervisión en el depósito existente.',[
        step('Elegí el depósito actual','En Fabricación Naval → Configuración habilitá fabricación en el depósito que ya está asignado al responsable.'),
        step('Asigná las autorizaciones','En Autorizar usuario seleccioná cuenta, depósito y permiso. Operación registra el trabajo; Supervisión consulta órdenes y reportes.'),
        step('Revisá la vista de supervisión','Si tu cuenta tiene autorización, la sección Supervisión muestra producción, horas, órdenes activas o atrasadas, faltantes y costos disponibles.'),
        step('Definí el correo cuando corresponda','Configurá destinatarios y correo automático cuando el servicio de envío esté disponible. Los PDF y el historial se consultan desde Reportes diarios.')
      ],'Fabricación utiliza el stock del depósito seleccionado. La habilitación del taller mantiene las operaciones de los demás depósitos.','fabrication-settings')
    ];
    const supervision=a.supervisor?[topic('factory-supervision','Fabricación','Supervisar la producción y consultar reportes','Seguir el trabajo del taller autorizado desde Compras.',[
      step('Abrí Supervisión','En Fabricación Naval revisá la fecha de actividad, piezas del día y acumuladas, horas, órdenes activas, atrasadas y pendientes de calidad.'),
      step('Abrí una orden','Consultá requerimientos y consumos, avances por operario, bloqueos, inspecciones, archivos, movimientos vinculados y trazabilidad.'),
      step('Revisá faltantes y costos','Las necesidades se calculan a partir de los requerimientos registrados. Los costos muestran los datos disponibles y señalan los registros sin precio.'),
      step('Consultá los reportes','En Reportes diarios seleccioná la fecha, generá una revisión si necesitás actualizarla y descargá el PDF del historial.')
    ],'El operador registra las actividades de fabricación; tu vista reúne la información para seguimiento y abastecimiento.','fabrication-orders')]:[];
    return[...common,...(!a.admin?depot:[]),...(a.operator?manufacturing:supervision),...(a.admin?administration:[])];
  }
  function firstSteps(a){
    if(a.operator)return[
      {title:'Contá las existencias',text:'Cargá los materiales físicos del depósito y revisá las unidades.',action:'home',label:'Ir a Inicio'},
      {title:'Registrá al personal',text:'Agregá los operarios reales del taller antes de asignarlos.',action:'fabrication-workers',label:'Ver Personal'},
      {title:'Creá la primera orden',text:'Definí pieza, plano, cantidad, plazo y personal.',action:'fabrication-orders',label:'Ver Órdenes'}
    ];
    if(a.admin)return[
      {title:'Revisá los pendientes',text:'Consultá alertas, solicitudes y faltantes de los depósitos.',action:'alerts',label:'Ver Alertas'},
      {title:'Registrá y seguí compras',text:'Definí proveedor y destino; controlá entregas y documentos.',action:'purchases',label:'Ir a Compras'},
      a.supervisor?{title:'Seguí el taller',text:'Consultá órdenes, producción y reportes del taller autorizado.',action:'fabrication-orders',label:'Ver Supervisión'}:{title:'Prepará las cuentas',text:'Revisá roles y depósitos asignados a cada usuario.',action:'admin-users',label:'Ver Usuarios'}
    ];
    return[
      {title:'Conocé tu stock',text:'Revisá tu depósito y las unidades de los materiales.',action:'stock',label:'Ver Inventario'},
      {title:'Recibí lo que llegó',text:'Registrá la cantidad física recibida y su documentación.',action:'home',label:'Ir a Inicio'},
      {title:'Registrá cada entrega',text:'Cargá material, cantidad, persona y destino al dar salida.',action:'home',label:'Ir a Inicio'}
    ];
  }
  function navigate(action){
    if(!eligible())return;
    const a=access();
    if(['home','stock'].includes(action))return goPage(action);
    if(action==='purchases'&&a.admin){goPage('purchases');return window.renderPurchases?.()}
    if(action==='alerts'&&a.admin){goPage('more');return renderModule('alerts')}
    const adminTabs={'admin-users':'users','admin-products':'products','admin-opening':'opening',suppliers:'suppliers'};
    if(adminTabs[action]&&a.admin){goPage('more');activeModule='admin';return renderAdmin(adminTabs[action])}
    const fabTabs={'fabrication-orders':'orders','fabrication-workers':'workers','fabrication-reports':'reports','fabrication-settings':'settings'};
    if(fabTabs[action]&&((action==='fabrication-settings'&&a.admin)||a.operator||a.supervisor)){
      const f=window.AVHManufacturing?.state;if(!f)return;
      f.tab=fabTabs[action];f.detail=null;return goPage('fabrication');
    }
  }
  function bindActions(root){root.querySelectorAll('[data-guide-action]').forEach(b=>b.onclick=()=>navigate(b.dataset.guideAction))}
  function renderGuide(){
    if(!eligible())return;
    const root=$('#userGuideContent'),a=access(),scope=JSON.stringify([profile.id,a.admin,a.operator,a.supervisor,a.warehouse]);
    if(root.dataset.scope===scope)return;root.dataset.scope=scope;
    const rows=topics(a),categories=['Todo',...new Set(rows.map(t=>t.category))];
    root.innerHTML=`<div class="guide-hero"><div class="eyebrow">GUÍA DE USO</div><h2 id="guideTitle" tabindex="-1">Cómo usar Inventario AVH</h2><p>${a.operator?'Desde el conteo inicial hasta las piezas terminadas: registrá el depósito y la fabricación en el mismo sistema.':a.admin?'Gestioná compras, seguí entregas y consultá la operación. Esta guía reúne las tareas disponibles para tu cuenta.':'Recibí materiales, registrá entregas y mantené al día el inventario de tu depósito.'}</p><div class="guide-meta"><span>${esc(a.role)}</span>${a.warehouse?`<span>${esc(a.warehouse)}</span>`:''}</div></div>
      <div class="section-head"><div><h2>Empezá por acá</h2><p>Tres pasos para tu primera jornada.</p></div></div>
      <div class="guide-start">${firstSteps(a).map((x,i)=>`<article class="card"><span class="guide-step-number" aria-hidden="true">${i+1}</span><h3>${esc(x.title)}</h3><p>${esc(x.text)}</p><button type="button" class="btn soft" data-guide-action="${x.action}">${esc(x.label)}</button></article>`).join('')}</div>
      <div class="section-head"><div><h2>Paso a paso</h2><p>Elegí una tarea para ver cómo se realiza.</p></div></div>
      <div class="card guide-filter"><div class="field"><label for="guideSearch">Buscar en la guía</label><input type="search" id="guideSearch" placeholder="Ej.: recibir, unidades, orden, reporte…" autocomplete="off"></div><div class="guide-categories" aria-label="Categorías de la guía">${categories.map(c=>`<button type="button" class="btn ${c==='Todo'?'on':''}" data-guide-category="${esc(c)}" aria-pressed="${c==='Todo'}">${esc(c)}</button>`).join('')}</div><p id="guideResultCount" role="status"></p></div>
      <div class="list" id="guideTopics" style="margin-top:12px">${rows.map(t=>`<details class="row guide-topic" data-guide-topic="${t.id}" data-guide-kind="${esc(t.category)}"><summary><span><strong>${esc(t.title)}</strong><small>${esc(t.summary)}</small></span></summary><div class="guide-topic-content"><ol>${t.steps.map(x=>`<li><strong>${esc(x.title)}</strong>${esc(x.text)}</li>`).join('')}</ol>${t.note?`<div class="hint">${esc(t.note)}</div>`:''}${t.action?`<button type="button" class="btn soft" data-guide-action="${t.action}">Abrir la sección</button>`:''}</div></details>`).join('')}</div>
      <div id="guideEmpty" class="empty hide" style="margin-top:12px">No encontramos esa tarea. Probá otra palabra o elegí Todo.</div>
      <div class="guide-footer"><div><p>Podés consultar esta guía cuando lo necesites.</p><p id="guideAck" role="status"></p></div><div class="guide-actions"><button type="button" id="guideAcknowledge" class="btn soft" ${hasSeen()?'disabled':''}>${hasSeen()?'Guía revisada':'Entendido'}</button><button type="button" class="btn primary" data-guide-action="home">Volver a Inicio</button></div></div>`;
    let category='Todo';
    const documents=new Map(rows.map(t=>[t.id,normal([t.title,t.summary,t.note,...t.steps.map(s=>s.title+' '+s.text)].join(' '))]));
    function filter(){
      const terms=normal($('#guideSearch').value.trim()).split(/\s+/).filter(Boolean);let count=0;
      root.querySelectorAll('[data-guide-topic]').forEach(el=>{const matches=(category==='Todo'||el.dataset.guideKind===category)&&terms.every(term=>documents.get(el.dataset.guideTopic).includes(term));el.hidden=!matches;if(matches){count++;if(terms.length)el.open=true}});
      $('#guideResultCount').textContent=`${count} ${count===1?'guía disponible':'guías disponibles'}`;$('#guideEmpty').classList.toggle('hide',count>0);
    }
    $('#guideSearch').oninput=filter;
    root.querySelectorAll('[data-guide-category]').forEach(b=>b.onclick=()=>{category=b.dataset.guideCategory;root.querySelectorAll('[data-guide-category]').forEach(x=>{const selected=x===b;x.classList.toggle('on',selected);x.setAttribute('aria-pressed',String(selected))});filter()});
    $('#guideAcknowledge').onclick=acknowledge;bindActions(root);filter();
  }
  function syncWelcome(){
    const previous=$('#guideWelcome');
    if(!eligible()||hasSeen()){previous?.remove();return}
    const root=$('#page-home');if(!root||!canRefreshView(root))return;
    const a=access(),scope=JSON.stringify([profile.id,a.role,a.warehouse]);if(previous?.dataset.scope===scope)return;
    previous?.remove();const card=document.createElement('aside');card.id='guideWelcome';card.className='card guide-welcome';card.dataset.scope=scope;card.setAttribute('aria-labelledby','guideWelcomeTitle');
    card.innerHTML=`<div><div class="eyebrow">PRIMEROS PASOS</div><h2 id="guideWelcomeTitle">Bienvenido a Inventario AVH</h2><p>${esc(profile.username)} · ${esc(a.role)}${a.warehouse?' · '+esc(a.warehouse):''}. ${a.operator?'Empezá por las existencias, el personal y tu primera orden.':a.admin?'Encontrá cómo gestionar compras, usuarios y el seguimiento de la operación.':'Conocé cómo recibir materiales, registrar entregas y consultar tu stock.'}</p></div><div class="guide-actions"><button type="button" class="btn primary" id="guideWelcomeOpen">Ver cómo usar</button><button type="button" class="btn soft" id="guideWelcomeDismiss">Entendido</button></div>`;
    root.prepend(card);$('#guideWelcomeOpen').onclick=()=>goPage('help');$('#guideWelcomeDismiss').onclick=acknowledge;
  }
  function sync(){syncWelcome();if($('#page-help')?.classList.contains('on'))renderGuide()}
  const baseGo=window.goPage;
  window.goPage=function(page){
    if(page==='help'&&!eligible())return;
    const r=baseGo.apply(this,arguments);
    if(page==='help'){renderGuide();$('#guideTitle')?.focus({preventScroll:true});$('#page-help')?.scrollIntoView({block:'start'})}
    if(page==='home')syncWelcome();return r;
  };
  const baseHome=window.renderHome;
  window.renderHome=function(){const r=baseHome.apply(this,arguments);syncWelcome();return r};
  const baseLoad=window.loadAll;
  window.loadAll=async function(){const r=await baseLoad.apply(this,arguments);sync();return r};
  // Existing depot views can repaint their own home after a save. Restore only the welcome card.
  let scheduled=false;
  const observer=new MutationObserver(()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;syncWelcome()})});
  const home=$('#page-home');if(home)observer.observe(home,{childList:true,subtree:true});
  window.AVHGuide={open:()=>goPage('help')};
})();
