// Una cuota puede cobrarse con varios pagos combinados (ej. dos e-cheques +
// una transferencia por el total) — se considera cobrada en cuanto AL MENOS
// UNO de esos pagos está confirmado (fuente de verdad: pagos_factura_venta),
// no hace falta esperar a que se acrediten todos. La fecha de cobro manual
// (fecha_cobro) es solo un respaldo para cuando no hay ningún pago puntual
// cargado en el sistema (ej. efectivo sin registrar).
export function cuotaCobrada(c) {
  const pagos = c.pagos || []
  if (pagos.length) return pagos.some(p => p.estado === 'confirmado')
  return !!c.fecha_cobro
}
export function fechaCobroCuota(c) {
  const pagos = c.pagos || []
  if (pagos.length) {
    const confirmados = pagos.filter(p => p.estado === 'confirmado')
    if (!confirmados.length) return ''
    // La más reciente de las confirmadas — la última plata real que entró.
    return confirmados.reduce((max, p) => {
      const f = p.fecha_acreditacion || p.fecha || ''
      return f > max ? f : max
    }, '')
  }
  return c.fecha_cobro || ''
}

// Estado calculado de una OC de cliente a partir de sus CUOTAS de facturación
// (cantidad variable: anticipo+resto, anticipo+avances, todo en %, o un solo
// pago) — compartido entre "OC Clientes" (carga/edición) y "Seguimiento OC
// Ventas" (lectura gerencial) para que ambas pantallas nunca diverjan.
export function estadoFila(r) {
  if (r.fecha_cierre_admin) return 'cerrada'
  const cuotas = r.cuotas || []
  const facturadas = cuotas.filter(c => c.factura_id)
  if (!cuotas.length || !facturadas.length) return 'pendiente'
  const cobradas = facturadas.filter(cuotaCobrada)
  if (cobradas.length === cuotas.length) return 'cobrado_completo'
  if (facturadas.length === cuotas.length) return 'facturado_completo'
  return 'parcial'
}

export const ESTADO_LABEL = {
  cerrada:            { txt: 'Cerrada',             cls: 'bg-success' },
  cobrado_completo:    { txt: 'Cobrado completo',    cls: 'bg-primary' },
  facturado_completo:  { txt: 'Facturado completo',  cls: 'bg-info text-dark' },
  parcial:             { txt: 'Parcial',             cls: 'bg-warning text-dark' },
  pendiente:           { txt: 'Pendiente',           cls: 'bg-secondary' },
}

export const ROW_BG = {
  cerrada:             '#f0fff4',
  cobrado_completo:    '#eef4ff',
  facturado_completo:  '#f0fbff',
  parcial:             '#fffbea',
  pendiente:           '',
}

// Una cuota está atrasada si todavía no se cobró y ya pasó su fecha
// estimada/plazo pactado — no alcanza con "hace mucho que no pasa nada",
// porque una cuota con vencimiento a futuro es normal que esté sin cobrar.
export function cuotaAtrasada(c, hoyISO) {
  if (cuotaCobrada(c)) return false
  if (!c.fecha_estimada) return false
  return c.fecha_estimada < hoyISO
}

// Días de atraso de la cuota más vencida (pendiente y con plazo pasado) de la
// OC; null si ninguna cuota está atrasada (incluye el caso de que todas ya
// se cobraron, o que las pendientes todavía no llegaron a su plazo).
export function diasAtrasoOC(r, hoyISO) {
  const atrasadas = (r.cuotas || []).filter(c => cuotaAtrasada(c, hoyISO))
  if (!atrasadas.length) return null
  const hoy = new Date(hoyISO + 'T00:00:00')
  return Math.max(...atrasadas.map(c => Math.floor((hoy - new Date(c.fecha_estimada + 'T00:00:00')) / 86400000)))
}

// % de la OC ya facturado / ya cobrado, sumando el % de cada cuota vinculada.
// Una misma factura puede estar detrás de varias cuotas (100% facturado de
// una vez, cobrado en cuotas) — cada cuota se cuenta por separado igual,
// porque lo que importa acá es el % del cliente ya cobrado, no la factura en sí.
export function pctFacturado(r) {
  return (r.cuotas || []).filter(c => c.factura_id).reduce((s, c) => s + (parseFloat(c.pct) || 0), 0)
}
export function pctCobrado(r) {
  return (r.cuotas || []).filter(c => c.factura_id && cuotaCobrada(c)).reduce((s, c) => s + (parseFloat(c.pct) || 0), 0)
}
