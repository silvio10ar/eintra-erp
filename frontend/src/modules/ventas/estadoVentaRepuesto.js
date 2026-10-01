// Estado de un ítem de un pedido de venta de repuestos — se calcula acá (no
// se persiste) a partir de lo que ya trae el backend por ítem: cuánto se
// retiró de stock, si se entregó, y si tiene una factura real vinculada con
// su pago confirmado. Mismo patrón que estadoOCClientes.js (fuente única de
// verdad compartida entre pantallas, sin duplicar el cálculo).
export function estadoItem(it) {
  const retirado = parseFloat(it.cantidad_retirada) || 0
  const pedido = parseFloat(it.cantidad) || 0
  if (retirado <= 0) return 'pendiente'
  if (retirado < pedido - 0.0001) return 'parcial'
  if (!it.entregado) return 'retirado'
  if (!it.factura_venta_id) return 'entregado'
  if (!it.factura_pago_confirmado) return 'facturado'
  return 'cobrado'
}

export const ESTADO_LABEL = {
  pendiente: { txt: 'Pendiente',  cls: 'bg-secondary' },
  parcial:   { txt: 'Parcial',    cls: 'bg-warning text-dark' },
  retirado:  { txt: 'Retirado',   cls: 'bg-info text-dark' },
  entregado: { txt: 'Entregado',  cls: 'bg-primary' },
  facturado: { txt: 'Facturado',  cls: 'bg-warning text-dark' },
  cobrado:   { txt: 'Cobrado',    cls: 'bg-success' },
  cancelado: { txt: 'Cancelado',  cls: 'bg-dark' },
}

// Orden de avance, para poder tomar "el peor" (más atrasado) entre varios ítems.
const ORDEN = ['pendiente', 'parcial', 'retirado', 'entregado', 'facturado', 'cobrado']

// Estado resumen del pedido: el más atrasado de sus ítems — un pedido no
// está "cobrado" hasta que TODOS sus ítems lo están. Un pedido cancelado
// muestra ese estado siempre, sin importar en qué quedaron sus ítems (nunca
// se llega a cancelar uno con algo ya retirado, así que no hay ambigüedad).
export function estadoPedido(pedido) {
  if (pedido.estado === 'Cancelado') return 'cancelado'
  const items = (pedido.items || [])
  if (!items.length) return 'pendiente'
  return items.reduce((peor, it) => {
    const e = estadoItem(it)
    return ORDEN.indexOf(e) < ORDEN.indexOf(peor) ? e : peor
  }, 'cobrado')
}

// "2/3 facturados, 1/3 cobrado" — conteo por etapa alcanzada (cada ítem
// cuenta en la etapa más alta que ya logró, no en cada una de las anteriores).
export function resumenItems(items) {
  const total = items.length
  const contar = estado => items.filter(it => estadoItem(it) === estado).length
  return ORDEN.map(estado => ({ estado, label: ESTADO_LABEL[estado].txt, n: contar(estado), total }))
    .filter(r => r.n > 0)
}
