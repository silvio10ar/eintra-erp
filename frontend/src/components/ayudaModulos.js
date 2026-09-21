// Contenido del botón de ayuda contextual (ver AyudaModulo.jsx), mostrado
// desde el header general — no hay un botón por pantalla, uno solo alcanza
// porque muestra el texto según la ruta actual. Clave = "to" del módulo tal
// cual está en TODOS_LOS_ITEMS (Layout.jsx).
//
// Son instrucciones de USO (qué botón tocar, en qué orden), no una
// descripción de qué es el módulo — los nombres de botones/campos citados
// entre comillas son literales, tal como aparecen en la pantalla.
export const AYUDA_MODULOS = {
  '/dashboard': {
    titulo: 'Dashboard',
    texto: `No hay nada para cargar acá, pero tiene accesos rápidos:

1. Cada tarjeta de KPI (Productos, OC abiertas, Presupuestos, Proyectos activos, Saldo) es un acceso directo — hacé clic y te lleva al módulo correspondiente, ya filtrado (ej. clic en "Productos" con stock bajo te lleva a Stock filtrado por eso).
2. El botón "Actualizar" sincroniza las fichadas del reloj biométrico con el sistema.
3. La tabla "Fichadas de personal" tiene dos pestañas, "Hoy" y "Ayer", para ver quién fichó.`,
  },
  '/ventas': {
    titulo: 'Ventas',
    texto: `Alta de Cliente:
1. Pestaña "Clientes" → botón "Nuevo Cliente".
2. Completá "Nombre" (obligatorio) y los datos de contacto/condición de pago → "Guardar".

Presupuesto nuevo:
1. Botón "Nuevo Presupuesto".
2. Cargá o buscá el cliente (autocompleta), y las condiciones: moneda, tipo de cambio, validez, condición de pago.
3. En "Ítems", tocá "Agregar ítem" por cada línea: cantidad, descripción, precio unitario y bonificaciones si corresponde.
4. "Guardar presupuesto".
5. Desde la fila del presupuesto podés generar la "Oferta Técnica" o "Imprimir Oferta Comercial".

CRM (pestaña aparte, dentro de Ventas: "Pipeline", "Cotizaciones", "Empresas"):
- "Nueva Cotización": elegís o creás la empresa, contacto, estado (Activo/Ganado/Perdido), moneda y montos. Si la marcás "Ganado" y la empresa todavía no es cliente, te ofrece darla de alta como Cliente ahí mismo.`,
  },
  '/venta-repuestos': {
    titulo: 'Venta de Repuestos',
    texto: `1. Botón "Nuevo pedido".
2. Buscá y elegí la "OC de Cliente" si ya está cargada en Finanzas → OC Clientes — el cliente se completa solo. Si no hay OC, buscalo directo en "Cliente".
3. Elegí quién autoriza en "Autorizado por (retiro de stock)".
4. Buscá cada material por código o descripción y agregalo con cantidad y precio.
5. "Guardar pedido".
6. Cuando el material esté listo, tocá "Retirar de stock" y confirmá las cantidades — recién ahí se descuenta el stock real.
7. Marcá "Entregado" en cada ítem cuando se lo diste al cliente.
8. Cuando tengas la factura real (ya cargada en Finanzas), usá "Vincular factura" en el ítem — el estado "Cobrado" no se carga a mano, sale solo cuando esa factura se pague.`,
  },
  '/proyectos': {
    titulo: 'Proyectos',
    texto: `1. Botón "Nuevo" → completá "Código" y "Nombre" (obligatorios), y opcionalmente cliente, responsable, estado y fechas → "Guardar".
2. Para editar, hacé clic en el proyecto (tarjeta o fila) para abrir el detalle, y tocá "Editar".
3. El detalle tiene 4 pestañas: "Form 30", "Materiales", "Entrega Doc." y "Plan".
4. Para vincular una OC de Cliente no se hace acá — se hace desde Finanzas → OC Clientes.
5. El costo real del proyecto (horas + materiales) tampoco se ve acá — se calcula en Análisis de Proyectos.`,
  },
  '/analisis-proyectos': {
    titulo: 'Análisis de Proyectos',
    texto: `1. La lista ya muestra el costo de cada proyecto (mano de obra + materiales) — reordenala con el select "Ordenar por...".
2. Hacé clic en una fila para ver el detalle: horas por empleado y materiales retirados de stock a nombre de ese proyecto.
3. Si un material no tiene precio de costo cargado, aparece "Pedir precio" — se lo manda a Administración para que lo cargue.
4. Dentro del detalle, tocá "Exportar a Excel" para bajar el informe ya formateado para imprimir.`,
  },
  '/costeo-equipos': {
    titulo: 'Costeo de Equipos',
    texto: `1. Botón "Nuevo costeo" — se abre directo el editor.
2. Completá "Nombre de la planta / equipo", "Cliente" y "Fecha".
3. Configurá los multiplicadores: "Utilidad Material", "Utilidad Mano de obra" y "Utilidad extra" (se aplica sobre el total final), y el "Tipo de cambio" si querés ver el total en pesos.
4. Botón "Agregar módulo" y ponele nombre.
5. Dentro del módulo: buscá en "Buscar material del catálogo..." para agregar un ítem existente, tocá "Mano de obra" para una fila de horas/días, o "Otros" para un material que todavía no está catalogado.
6. Tocá "Guardar" para persistir los cambios.
7. "Exportar a Excel" exporta lo último guardado — si hiciste cambios, guardá primero.`,
  },
  '/mis-tareas': {
    titulo: 'Mis Tareas',
    texto: `1. Las tareas ya aparecen agrupadas por proyecto al entrar.
2. Filtralas con los selects de proyecto, estado, gerencia o empleado.
3. Para marcar una tarea como completada, tildá el checkbox de la fila — se guarda solo, sin botón aparte.`,
  },
  '/produccion': {
    titulo: 'Producción',
    texto: `Solapa "Mi Substock" — material que retiraste del depósito principal y tenés asignado para usar en producción:
1. "Entregar": elegí el material y la cantidad, la partida/serie si corresponde, el proyecto o actividad al que se destina, y quién lo autoriza → "Entregar".
2. "Devolver": si sobró material sin usar, devolvelo al Stock principal desde el mismo listado.`,
  },
  '/mantenimiento': {
    titulo: 'Mantenimiento',
    texto: `Pestañas: Dashboard, Equipos, Plan preventivo, Correctivas, Historial.

1. Alta de equipo: pestaña "Equipos" → botón "+" → cargá código, nombre, categoría, marca, ubicación → "Guardar".
2. Plan preventivo: en la fila del equipo, ícono "Tareas preventivas" → "Agregar tarea" → componente, acción, tipo y frecuencia → "Guardar tarea".
3. Registrar que se hizo una tarea: pestaña "Plan preventivo", desplegá el equipo y tocá "Registrar" en la tarea → cargá fecha, resultado (OK/NOK/Cuarentena) y responsable. Si el resultado es NOK, te ofrece crear una correctiva ahí mismo.
4. Cargar un correctivo: pestaña "Correctivas" → "Nueva correctiva" → equipo, fecha, descripción de la falla, tipo de servicio → "Guardar". Para cerrarla, botón "Cerrar" en la fila.`,
  },
  '/calidad': {
    titulo: 'Calidad',
    texto: `Pestañas: Hojas de Ruta, No Conformidades, Inspecciones, Formularios, Documentos, Objetivos, Evaluación Proveedores.

1. Documentos con versión: "Nuevo documento" → código, título, categoría, aprobado por, y subís el archivo. Para una revisión nueva de uno existente: "Nueva revisión" en la fila, subís el archivo y el motivo del cambio — la versión anterior queda en el historial como obsoleta.
2. No Conformidad: "Nueva NC" → fecha, tipo, descripción del hallazgo (obligatoria), responsable y fecha límite → "Guardar".
3. Formularios (ej. F34 Soldadura): elegís el formulario en la pestaña "Formularios", "Nuevo F34", completás la cabecera y agregás filas por cada chapa verificada con sus controles OK/NO OK.`,
  },
  '/compras': {
    titulo: 'Compras',
    texto: `1. Botón "Nueva OC" → elegí proveedor y moneda, y agregá los ítems (material, cantidad, precio).
2. Cuando llega la mercadería: abrí la OC, tocá "Recibir mercadería", cargá las cantidades recibidas (puede ser parcial) y el número de remito → "Confirmar recepción". Ahí se genera el ingreso real a Stock.
3. Si un ítem todavía no tiene código, se puede crear ahí mismo al vincularlo.
4. Para lo que entra a depósito sin una OC formal, usá "Ingreso sin OC" (Formulario 49).`,
  },
  '/materiales': {
    titulo: 'Materiales',
    texto: `1. Para buscar, escribí en el buscador (código, descripción o proveedor) — no muestra nada hasta que escribís algo.
2. Para dar de alta un material nuevo: usá el asistente de código (elegís familia/tipo y te propone el código correlativo) o cargalo a mano.
3. Completá descripción, categoría, unidad, precio de costo/venta, y elegí "Proveedor" — es obligatorio, sin proveedor no te deja guardar.
4. Marcá "Precio crítico" si ese material necesita revisión periódica de precio, y elegí cada cuánto.`,
  },
  '/stock': {
    titulo: 'Stock',
    texto: `1. Para ver productos, usá el buscador o los filtros — no carga el catálogo completo de entrada.
2. Seleccioná un producto y usá los botones "Entrada" o "Salida" para registrar un movimiento.
3. En una entrada elegís el proveedor. En una salida el proveedor se completa solo (el de la ficha del producto); lo que sí elegís es quién "Autoriza" el retiro.
4. Los ingresos que vienen de una Orden de Compra aparecen en "Ingresos pendientes" — se confirman ahí uno por uno, o se rechazan.
5. Los Pedidos de Stock aparecen en la sección de pedidos pendientes — se entregan (total o parcial) desde acá, y recién ahí se descuenta el stock real.
6. Para el historial completo con filtros y exportación, usá el botón de historial.`,
  },
  '/pedido-stock': {
    titulo: 'Pedido de Stock',
    texto: `1. Buscá el material que necesitás y agregalo (clic en la sugerencia).
2. Cargá la cantidad de cada ítem.
3. Elegí a qué "Proyecto o Actividad" se imputa — uno de los dos, es obligatorio.
4. Elegí quién "Autoriza" el pedido.
5. Tocá "Enviar pedido". Lo vas a ver abajo con el progreso de entrega de cada ítem.
6. Mientras siga "Pendiente" (nada entregado todavía) lo podés cancelar.`,
  },
  '/rrhh': {
    titulo: 'RRHH',
    texto: `Pestañas: Dashboard, Parte Diario, Asistencia, Horas, Empleados, Estructura, Proyectos, Actividades, Fusionador, Informes.

1. Alta de empleado: pestaña "Empleados" → "Nuevo empleado" → "Nombre" y "Tipo" (obligatorios) → "Guardar".
2. Cargar horas de alguien: pestaña "Horas" → "Nuevo registro" → fecha, empleado, proyecto/actividad, hora inicio/fin (calcula las horas solo) → "Guardar". Para corregir, ícono lápiz en la fila.
3. Forma más rápida por día: pestaña "Parte Diario" — elegís empleado y fecha, agregás filas con horario y proyecto, "Guardar parte".
4. Alta de actividad: pestaña "Actividades" → "Nueva actividad" → nombre → "Guardar".`,
  },
  '/partes': {
    titulo: 'Partes',
    texto: `Un empleado sin permiso de RRHH/Partes solo ve "Estado 7 días" (de solo lectura, su propio parte).

Con permiso de RRHH o Partes tenés además:
1. "Cargar Parte": elegís empleado (o viene precargado el tuyo) y fecha, agregás filas con horario y proyecto/actividad → "Guardar parte".
2. "Corregir partes": filtrás por período (7d/14d/30d), ícono lápiz para editar un registro o tacho para eliminarlo.
3. "Proyectos": vista de horas acumuladas por proyecto.`,
  },
  '/administracion': {
    titulo: 'Administración',
    texto: `Pestañas: Proveedores, Clientes, Facturas de Compra, Facturas de Venta, Tesorería, Servicios, OC Clientes, OC sin factura, Pedidos de precio.

1. Alta de proveedor: pestaña "Proveedores" → "Nuevo Proveedor" → datos de contacto y condición de pago → "Guardar". Clientes funciona igual, en su propia pestaña.
2. "OC sin factura" es solo una alerta de lectura: órdenes de compra que todavía no tienen ninguna factura cargada.
3. "Pedidos de precio": son materiales que pidieron desde Materiales o Análisis de Proyectos para cotizar. Cargá el precio y la moneda en la fila y confirmá con el botón de check — así queda actualizado el costo del material.
4. Facturas de Compra/Venta y Tesorería: carga y seguimiento de pagos/cobros y saldos bancarios — mismo tipo de pantalla que en Finanzas, es la misma información vista desde acá.`,
  },
  '/finanzas': {
    titulo: 'Finanzas',
    texto: `1. Buscá la factura (de compra o de venta) y abrí sus pagos.
2. Para cargar un pago nuevo: "Registrar pago" → forma de pago, importe, fecha. Transferencia/efectivo queda confirmado al toque; cheque diferido o e-cheq queda "pendiente" hasta que se acredite.
3. Si el pago supera el umbral configurado en Configuración, te pide elegir quién autoriza antes de guardarlo.
4. Los e-cheques pendientes de acreditar/debitar aparecen en el Dashboard de Finanzas — se confirman con un clic cuando el banco los efectiviza.
5. Desde acá también se cargan las OC de Cliente (con sus cuotas de facturación) y se ve el saldo bancario y el tipo de cambio del día.`,
  },
  '/configuracion': {
    titulo: 'Configuración',
    texto: `Pestañas: "Sistema" y "Directivas del programa".

1. Configurar y probar el correo saliente: cargá los datos de "Correo saliente (SMTP)" y usá "Enviar email de prueba" (manda ya, sin guardar antes). Para que quede guardado, "Guardar configuración" al final.
2. Umbral de autorización de pagos: campo "Umbral de autorización de pagos (USD)" en "Control interno" — se guarda con el mismo botón "Guardar configuración".
3. Backup: "Descargar backup (.db)" lo baja directo; "Enviar backup ahora" lo manda por mail al destinatario configurado.
4. Directivas del programa: "Nueva directiva" → título y descripción → "Guardar". Se activan/desactivan con el ícono de cada fila.`,
  },
  '/usuarios': {
    titulo: 'Usuarios',
    texto: `1. Alta de usuario: "Nuevo usuario" → usuario, contraseña, nombre completo (obligatorios) → "Crear usuario".
2. Asignar permisos: en la fila del usuario, botón "Permisos" → tildá uno o más "Puestos asignados" (se pueden combinar varios) — el "Acceso efectivo" se arma solo. Si hace falta algo más puntual, desplegá "Ajustar permisos individuales" y tildá módulo por módulo → "Guardar permisos".
3. Crear un Puesto nuevo: desde el modal de Permisos, "Gestionar puestos" → "Nuevo puesto" → nombre, área, misión, responsabilidades, "Reporta a" (esto arma el organigrama) y los accesos por módulo → "Guardar puesto".
4. El organigrama no tiene pantalla de árbol — se define pura y exclusivamente con el "Reporta a" de cada puesto.`,
  },
}
