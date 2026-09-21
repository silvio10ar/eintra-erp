'use strict'
const express = require('express')
const XLSX = require('xlsx')
const { body, validationResult } = require('express-validator')
const { db } = require('../db/database')
const { verificarToken } = require('../middleware/auth')
const { buscarCondicion } = require('../helpers/buscar')
const { tasaCambioSistema } = require('../helpers/tipoCambio')
const { hoyArgentina } = require('../helpers/fecha')
const { obtenerAutorizantes } = require('../helpers/organigrama')

const router = express.Router()
router.use(verificarToken)

// Mismo criterio que ya usa Stock para exportar (admin ∪ gerentes de
// gerencia, la misma lista que autoriza retiros/pagos) — no alcanza con el
// permiso general de lectura de Materiales.
function soloGerentes(req, res, next) {
  if (!obtenerAutorizantes().some(u => u.id === req.usuario.id))
    return res.status(403).json({ error: 'Solo gerentes y administradores' })
  next()
}

// El precio de cada material se carga en la moneda que vino en la OC/factura
// (precio_moneda) — para la lista se muestra también convertido a las otras
// dos, usando pesos como moneda puente (mismo criterio que el resto del
// sistema: tasaCambioSistema, tabla tipo_cambio). Si no hay tasa cargada para
// alguna moneda, esa conversión queda en null (el frontend la muestra como "—").
function conPreciosConvertidos(p, tcDolar, tcEuro) {
  const costo = p.precio_costo || 0
  let pesos = null, dolares = null, euros = null
  if (p.precio_moneda === 'DÓLAR') {
    dolares = costo
    pesos = tcDolar ? costo * tcDolar : null
  } else if (p.precio_moneda === 'EURO') {
    euros = costo
    pesos = tcEuro ? costo * tcEuro : null
  } else {
    pesos = costo
  }
  if (pesos != null) {
    if (dolares == null) dolares = tcDolar ? pesos / tcDolar : null
    if (euros == null) euros = tcEuro ? pesos / tcEuro : null
  }
  return { ...p, precio_pesos: pesos, precio_dolares: dolares, precio_euros: euros }
}

const puedeL = req => !!(req.permisos?.materiales?.leer || req.permisos?.materiales?.escribir)
const puedeE = req => !!req.permisos?.materiales?.escribir

// GET /next-codigo/:prefix — siguiente código disponible para un prefijo FAM+TIPO (3 chars)
router.get('/next-codigo/:prefix', (req, res) => {
  if (!puedeL(req)) return res.status(403).json({ error: 'Sin permisos' })
  const prefix = req.params.prefix.toUpperCase()
  if (!/^[A-Z0-9]{3}$/.test(prefix)) return res.status(400).json({ error: 'Prefijo inválido' })
  const existing = new Set(
    db.prepare("SELECT codigo FROM productos WHERE activo=1 AND codigo LIKE ? AND length(codigo)=10")
      .all(prefix + '%').map(r => r.codigo)
  )
  let n = 1, candidate
  do { candidate = prefix + String(n++).padStart(7, '0') } while (existing.has(candidate))
  res.json({ codigo: candidate })
})

// Compartido entre el listado y la exportación — mismos filtros, mismo orden.
function buscarMateriales({ buscar, familia, alerta, soloVencidos }) {
  const conds = ['activo=1'], params = []
  if (buscar) {
    const b = buscarCondicion(buscar, ['codigo', 'descripcion', 'proveedor'])
    conds.push(b.cond); params.push(...b.params)
  }
  if (familia) { conds.push('substr(codigo,1,1)=?'); params.push(familia) }
  if (alerta === 'bajo')    conds.push('stock_actual > 0 AND stock_minimo > 0 AND stock_actual <= stock_minimo')
  if (alerta === 'agotado') conds.push('stock_actual <= 0')
  if (alerta === 'ok')      conds.push('stock_actual > 0')
  if (soloVencidos === '1') {
    conds.push(`precio_critico=1 AND precio_frecuencia_dias>0 AND precio_fecha!='' AND julianday('now','localtime')-julianday(precio_fecha) >= precio_frecuencia_dias`)
  }
  const rows = db.prepare(`SELECT * FROM productos WHERE ${conds.join(' AND ')} ORDER BY descripcion`).all(...params)
  const hoy = hoyArgentina()
  const tcDolar = tasaCambioSistema('DÓLAR', hoy)
  const tcEuro = tasaCambioSistema('EURO', hoy)
  return rows.map(p => conPreciosConvertidos(p, tcDolar, tcEuro))
}

// GET / — listado filtrado. El frontend no pide nada sin al menos un filtro
// activo (buscar/familia/alerta/soloVencidos) — mostrar de entrada el catálogo
// completo (miles de materiales) es lo que hacía sentir lenta la pantalla.
router.get('/', (req, res) => {
  if (!puedeL(req)) return res.status(403).json({ error: 'Sin permisos' })
  res.json(buscarMateriales(req.query))
})

// Exportar a Excel el material filtrado (mismos filtros que el listado) —
// solo gerentes y admin, igual criterio que ya usa Stock para exportar.
router.get('/exportar', soloGerentes, (req, res) => {
  if (!puedeL(req)) return res.status(403).json({ error: 'Sin permisos' })
  const rows = buscarMateriales(req.query)
  const datos = rows.map(p => ({
    'Código': p.codigo,
    'Descripción': p.descripcion,
    'Categoría': p.categoria,
    'Unidad': p.unidad,
    'Stock actual': p.stock_actual,
    'Stock mínimo': p.stock_minimo,
    'Ubicación': p.ubicacion,
    'Proveedor': p.proveedor,
    'Precio costo': p.precio_costo,
    'Moneda': p.precio_moneda,
    // Precio venta: sacado por ahora — sin definir todavía de dónde debería salir.
    'Precio $': p.precio_pesos ?? '',
    'Precio USD': p.precio_dolares ?? '',
    'Precio EUR': p.precio_euros ?? '',
    'Fecha precio': p.precio_fecha,
    'Precio crítico': p.precio_critico ? 'Sí' : 'No',
  }))
  const ws = XLSX.utils.json_to_sheet(datos)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Materiales')
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename=materiales_${hoyArgentina()}.xlsx`)
  res.send(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
})

// POST / — crear producto (stock_actual siempre 0, no se expone)
router.post('/',
  body('codigo').trim().notEmpty(),
  body('descripcion').trim().notEmpty(),
  (req, res) => {
    if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
    const errs = validationResult(req)
    if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() })
    const { codigo, descripcion, categoria, unidad, unidad_compra, stock_minimo, ubicacion, precio_costo, precio_moneda, precio_venta, proveedor, codigo_generado, precio_critico, precio_frecuencia_dias, trazabilidad_stock } = req.body
    // Un material sin proveedor queda huérfano para trazabilidad de compras
    // (no se puede saber a quién reclamarle, ni comparar precios) — se detectó
    // que se estaban creando materiales nuevos sin este dato al vincularlos
    // "al vuelo" desde la recepción de una OC o un Form49.
    if (!proveedor?.trim()) return res.status(400).json({ error: 'Elegí el proveedor de este material' })
    const precio_fecha = (precio_costo || precio_venta) ? hoyArgentina() : ''
    try {
      const r = db.prepare(`
        INSERT INTO productos (codigo, descripcion, categoria, unidad, unidad_compra, stock_actual, stock_minimo, ubicacion, precio_costo, precio_moneda, precio_venta, proveedor, codigo_generado, precio_fecha, precio_critico, precio_frecuencia_dias, trazabilidad_stock)
        VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(codigo, descripcion, categoria||'', unidad||'UND.', (unidad_compra||'').trim(), stock_minimo||0, ubicacion||'', precio_costo||0, precio_moneda||'PESOS', precio_venta||0, proveedor||'', codigo_generado||0, precio_fecha, precio_critico ? 1 : 0, precio_frecuencia_dias||0, trazabilidad_stock || 'ninguna')
      res.status(201).json(db.prepare('SELECT * FROM productos WHERE id=?').get(r.lastInsertRowid))
    } catch(e) {
      if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'El código ya existe' })
      throw e
    }
  }
)

// PUT /:id — modificar (nunca toca stock_actual)
router.put('/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const p = db.prepare('SELECT * FROM productos WHERE id=? AND activo=1').get(req.params.id)
  if (!p) return res.status(404).json({ error: 'Producto no encontrado' })
  const { codigo, descripcion, categoria, unidad, unidad_compra, stock_minimo, ubicacion, precio_costo, precio_moneda, precio_venta, proveedor, codigo_generado, precio_critico, precio_frecuencia_dias, trazabilidad_stock } = req.body
  if (!codigo?.trim() || !descripcion?.trim()) return res.status(400).json({ error: 'Código y descripción requeridos' })
  const nuevoCosto = precio_costo ?? p.precio_costo
  const nuevaVenta = precio_venta ?? p.precio_venta
  const nuevaMoneda = precio_moneda || p.precio_moneda
  // La fecha solo se actualiza si el precio realmente cambió, no en cada edición del material.
  const cambioPrecio = Number(nuevoCosto) !== Number(p.precio_costo) || Number(nuevaVenta) !== Number(p.precio_venta) || nuevaMoneda !== p.precio_moneda
  const precio_fecha = cambioPrecio ? hoyArgentina() : p.precio_fecha
  try {
    db.prepare(`
      UPDATE productos
      SET codigo=?, descripcion=?, categoria=?, unidad=?, unidad_compra=?, stock_minimo=?, ubicacion=?,
          precio_costo=?, precio_moneda=?, precio_venta=?, proveedor=?,
          codigo_generado=COALESCE(?, codigo_generado),
          precio_fecha=?, precio_critico=?, precio_frecuencia_dias=?, trazabilidad_stock=?,
          updated_at=datetime('now','localtime')
      WHERE id=?
    `).run(codigo, descripcion, categoria??p.categoria, unidad??p.unidad, (unidad_compra??p.unidad_compra)||'',
           stock_minimo??p.stock_minimo, ubicacion??p.ubicacion,
           nuevoCosto, nuevaMoneda, nuevaVenta,
           proveedor??p.proveedor,
           codigo_generado != null ? codigo_generado : null,
           precio_fecha,
           precio_critico != null ? (precio_critico ? 1 : 0) : p.precio_critico,
           precio_frecuencia_dias ?? p.precio_frecuencia_dias,
           trazabilidad_stock ?? p.trazabilidad_stock,
           req.params.id)
    res.json(db.prepare('SELECT * FROM productos WHERE id=?').get(req.params.id))
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'El código ya existe' })
    throw e
  }
})

// DELETE /:id — solo si stock_actual = 0
router.delete('/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const p = db.prepare('SELECT stock_actual, descripcion FROM productos WHERE id=? AND activo=1').get(req.params.id)
  if (!p) return res.status(404).json({ error: 'Producto no encontrado' })
  // Mismo margen de tolerancia que ya usa stockLotes.js para comparar contra
  // 0 — con muchos movimientos parciales, stock_actual puede quedar en algo
  // como 0.00000000001 por arrastre de coma flotante en vez de exactamente 0.
  if (Math.abs(p.stock_actual) > 0.0001)
    return res.status(409).json({ error: `No se puede eliminar: tiene ${p.stock_actual} unidades en stock` })
  db.prepare('UPDATE productos SET activo=0 WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

module.exports = router
