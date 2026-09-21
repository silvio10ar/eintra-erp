'use strict'
const express = require('express')
const { db } = require('../db/database')
const { verificarToken, puede } = require('../middleware/auth')
const { tasaCambioSistema } = require('../helpers/tipoCambio')
const { buscarCondicion } = require('../helpers/buscar')
const { hoyArgentina } = require('../helpers/fecha')
const { SENTINEL: MONTO_OCULTO } = require('../helpers/masking')

const router = express.Router()
router.use(verificarToken)
router.use(puede.leer('costeo_equipos'))
const soloEscritura = puede.escribir('costeo_equipos')

// El catálogo de Materiales guarda el precio en pesos, dólares o euros según
// de dónde haya salido (ver precio_moneda) — el costeo, igual que la planilla
// que reemplaza, trabaja siempre en USD, así que se convierte acá una sola
// vez. Un precio en euros se pasa a pesos y de ahí a dólares (mismo criterio
// que la lista de Materiales) — antes esto se trataba como si fuera pesos,
// dando un valor casi cero.
function precioUsd(producto) {
  if (!producto) return 0
  const costo = producto.precio_costo || 0
  if (producto.precio_moneda === 'DÓLAR') return costo
  const hoy = hoyArgentina()
  const tcDolar = tasaCambioSistema('DÓLAR', hoy)
  if (!tcDolar) return 0
  if (producto.precio_moneda === 'EURO') {
    const tcEuro = tasaCambioSistema('EURO', hoy)
    return tcEuro ? (costo * tcEuro) / tcDolar : 0
  }
  return costo / tcDolar
}

// Buscar materiales del catálogo para agregarlos a un ítem — ya devuelve el
// precio convertido a USD, así el frontend no tiene que saber nada de tipos
// de cambio ni monedas.
router.get('/materiales', (req, res) => {
  const { buscar } = req.query
  if (!buscar || buscar.trim().length < 2) return res.json([])
  const b = buscarCondicion(buscar, ['codigo', 'descripcion', 'proveedor'])
  const rows = db.prepare(`SELECT * FROM productos WHERE activo=1 AND ${b.cond} ORDER BY descripcion LIMIT 20`).all(...b.params)
  res.json(rows.map(p => ({ id: p.id, codigo: p.codigo, descripcion: p.descripcion, unidad: p.unidad, precio_usd: Math.round(precioUsd(p) * 100) / 100 })))
})

function conSubtotales(costeo, modulos, items) {
  const modulosConItems = modulos.map(m => {
    const propios = items.filter(i => i.modulo_id === m.id)
    // "otro" (material que todavía no está en el catálogo, cargado a mano) cuenta como material a
    // efectos de costo/margen — solo se distingue visualmente de "material" para saber que no viene del sistema.
    const subtotal_material = propios.filter(i => i.tipo === 'material' || i.tipo === 'otro').reduce((s, i) => s + i.cantidad * i.precio_unitario, 0)
    const subtotal_mano_obra = propios.filter(i => i.tipo === 'mano_obra').reduce((s, i) => s + i.cantidad * i.precio_unitario, 0)
    return { ...m, items: propios, subtotal_material, subtotal_mano_obra, subtotal: subtotal_material + subtotal_mano_obra }
  })
  const costo_material = modulosConItems.reduce((s, m) => s + m.subtotal_material, 0)
  const costo_mano_obra = modulosConItems.reduce((s, m) => s + m.subtotal_mano_obra, 0)
  const venta_material = costo_material * (costeo.utilidad_material || 1)
  const venta_mano_obra = costo_mano_obra * (costeo.utilidad_mano_obra || 1)
  const venta_total = (venta_material + venta_mano_obra) * (costeo.utilidad_extra || 1)
  return {
    ...costeo,
    modulos: modulosConItems,
    costo_material, costo_mano_obra, costo_total: costo_material + costo_mano_obra,
    venta_material, venta_mano_obra, venta_total,
    venta_total_pesos: costeo.tipo_cambio > 0 ? venta_total * costeo.tipo_cambio : null,
  }
}

// Listado — solo lo necesario para elegir uno, con el total ya calculado.
router.get('/', (req, res) => {
  const costeos = db.prepare('SELECT * FROM costeos_equipos ORDER BY updated_at DESC').all()
  const modulos = db.prepare('SELECT * FROM costeo_modulos').all()
  const items = db.prepare('SELECT * FROM costeo_items').all()
  const modulosPorCosteo = {}
  for (const m of modulos) (modulosPorCosteo[m.costeo_id] ??= []).push(m)
  res.json(costeos.map(c => {
    const { costo_total, venta_total } = conSubtotales(c, modulosPorCosteo[c.id] || [], items)
    return { id: c.id, nombre: c.nombre, cliente: c.cliente, fecha: c.fecha, updated_at: c.updated_at, costo_total, venta_total }
  }))
})

router.post('/', soloEscritura, (req, res) => {
  const { nombre, cliente, fecha } = req.body
  const r = db.prepare(`INSERT INTO costeos_equipos (nombre, cliente, fecha, creado_por) VALUES (?,?,?,?)`)
    .run(nombre || 'Nuevo costeo', cliente || '', fecha || hoyArgentina(), req.usuario.id)
  res.status(201).json({ id: r.lastInsertRowid })
})

router.get('/:id', (req, res) => {
  const costeo = db.prepare('SELECT * FROM costeos_equipos WHERE id=?').get(req.params.id)
  if (!costeo) return res.status(404).json({ error: 'Costeo no encontrado' })
  const modulos = db.prepare('SELECT * FROM costeo_modulos WHERE costeo_id=? ORDER BY orden').all(costeo.id)
  const modIds = modulos.map(m => m.id)
  const items = modIds.length
    ? db.prepare(`SELECT * FROM costeo_items WHERE modulo_id IN (${modIds.map(() => '?').join(',')}) ORDER BY orden`).all(...modIds)
    : []

  // El precio guardado en el ítem es una FOTO del momento en que se cargó —
  // nunca se recalcula solo. Para que se note si el catálogo cambió desde
  // entonces (sin tocar el costeo), se informa aparte el precio ACTUAL del
  // material, si sigue existiendo — el frontend lo muestra solo a título
  // informativo, nunca reemplaza el precio guardado.
  const idsProducto = [...new Set(items.map(i => i.producto_id).filter(Boolean))]
  const productosActuales = idsProducto.length
    ? db.prepare(`SELECT * FROM productos WHERE id IN (${idsProducto.map(() => '?').join(',')})`).all(...idsProducto)
    : []
  const precioActualPorProducto = Object.fromEntries(productosActuales.map(p => [p.id, Math.round(precioUsd(p) * 100) / 100]))
  const itemsConPrecioActual = items.map(i => ({
    ...i,
    precio_actual_usd: i.producto_id != null ? (precioActualPorProducto[i.producto_id] ?? null) : null,
  }))

  res.json(conSubtotales(costeo, modulos, itemsConPrecioActual))
})

// Guarda el documento entero: datos generales + reemplazo completo de
// módulos/ítems — mismo criterio que ya se usa para oc_items/cuotas: es más
// simple (y acá, con una sola pantalla editando todo junto, más natural) que
// ir sincronizando altas/bajas de a un ítem por vez.
router.put('/:id', soloEscritura, (req, res) => {
  const costeo = db.prepare('SELECT * FROM costeos_equipos WHERE id=?').get(req.params.id)
  if (!costeo) return res.status(404).json({ error: 'Costeo no encontrado' })
  const { nombre, cliente, fecha, utilidad_material, utilidad_mano_obra, utilidad_extra, tipo_cambio, observaciones, modulos } = req.body
  if (!nombre?.trim()) return res.status(400).json({ error: 'Falta el nombre del costeo' })
  // Un usuario con "oculta_montos" recibe precio_unitario ya enmascarado
  // (backend/helpers/masking.js) — si guardara sin darse cuenta, el
  // precio real de ese ítem se pisaría con 0 para siempre (el guardado acá
  // es reemplazo total, no hay forma de "dejar como estaba" un campo que
  // nunca llegó de verdad). Mejor rechazar el guardado con un error claro
  // que perder el dato en silencio.
  if ((modulos || []).some(m => (m.items || []).some(it => it.precio_unitario === MONTO_OCULTO)))
    return res.status(403).json({ error: 'No podés guardar cambios en un costeo con montos ocultos.' })
  try {
    db.transaction(() => {
      db.prepare(`
        UPDATE costeos_equipos SET nombre=?, cliente=?, fecha=?, utilidad_material=?, utilidad_mano_obra=?,
          utilidad_extra=?, tipo_cambio=?, observaciones=?, updated_at=datetime('now','localtime')
        WHERE id=?
      `).run(nombre, cliente || '', fecha || costeo.fecha,
        parseFloat(utilidad_material) || 1, parseFloat(utilidad_mano_obra) || 1, parseFloat(utilidad_extra) || 1,
        parseFloat(tipo_cambio) || 0, observaciones || '', costeo.id)

      // Reemplazo total en vez de sincronizar altas/bajas — más simple y evita
      // que items borrados en pantalla queden huérfanos en la base.
      db.prepare('DELETE FROM costeo_modulos WHERE costeo_id=?').run(costeo.id)
      const insMod = db.prepare('INSERT INTO costeo_modulos (costeo_id, orden, nombre) VALUES (?,?,?)')
      const insItem = db.prepare(`
        INSERT INTO costeo_items (modulo_id, orden, tipo, producto_id, codigo, descripcion, unidad, cantidad, precio_unitario)
        VALUES (?,?,?,?,?,?,?,?,?)
      `)
      for (const [mi, mod] of (modulos || []).entries()) {
        const moduloId = insMod.run(costeo.id, mi + 1, mod.nombre || '').lastInsertRowid
        for (const [ii, it] of (mod.items || []).entries()) {
          insItem.run(moduloId, ii + 1, ['mano_obra', 'otro'].includes(it.tipo) ? it.tipo : 'material',
            it.producto_id || null, it.codigo || '', it.descripcion || '', it.unidad || '',
            parseFloat(it.cantidad) || 0, parseFloat(it.precio_unitario) || 0)
        }
      }
    })()
  } catch (e) {
    // Un producto_id que ya no existe (material borrado) rompería la FK — se
    // avisa con claridad en vez de un 500 genérico.
    if (e.message.includes('FOREIGN KEY')) return res.status(400).json({ error: 'Uno de los materiales de este costeo ya no existe en el catálogo' })
    throw e
  }
  res.json({ ok: true })
})

router.delete('/:id', soloEscritura, (req, res) => {
  const costeo = db.prepare('SELECT id FROM costeos_equipos WHERE id=?').get(req.params.id)
  if (!costeo) return res.status(404).json({ error: 'Costeo no encontrado' })
  db.prepare('DELETE FROM costeos_equipos WHERE id=?').run(costeo.id)
  res.json({ ok: true })
})

module.exports = router
