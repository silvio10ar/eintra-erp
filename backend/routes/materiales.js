'use strict'
const express = require('express')
const { body, validationResult } = require('express-validator')
const { db } = require('../db/database')
const { verificarToken } = require('../middleware/auth')
const { buscarCondicion } = require('../helpers/buscar')

const router = express.Router()
router.use(verificarToken)

const puedeL = req => !!(req.permisos?.materiales?.leer || req.permisos?.materiales?.escribir)
const puedeE = req => !!req.permisos?.materiales?.escribir

// GET / — listado completo (con búsqueda opcional)
router.get('/', (req, res) => {
  if (!puedeL(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { buscar } = req.query
  const conds = ['activo=1'], params = []
  if (buscar) {
    const b = buscarCondicion(buscar, ['codigo', 'descripcion', 'proveedor'])
    conds.push(b.cond); params.push(...b.params)
  }
  res.json(db.prepare(`SELECT * FROM productos WHERE ${conds.join(' AND ')} ORDER BY descripcion`).all(...params))
})

// POST / — crear producto (stock_actual siempre 0, no se expone)
router.post('/',
  body('codigo').trim().notEmpty(),
  body('descripcion').trim().notEmpty(),
  (req, res) => {
    if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
    const errs = validationResult(req)
    if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() })
    const { codigo, descripcion, categoria, unidad, stock_minimo, ubicacion, precio_costo, precio_venta, proveedor } = req.body
    try {
      const r = db.prepare(`
        INSERT INTO productos (codigo, descripcion, categoria, unidad, stock_actual, stock_minimo, ubicacion, precio_costo, precio_venta, proveedor)
        VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
      `).run(codigo, descripcion, categoria||'', unidad||'UND.', stock_minimo||0, ubicacion||'', precio_costo||0, precio_venta||0, proveedor||'')
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
  const { codigo, descripcion, categoria, unidad, stock_minimo, ubicacion, precio_costo, precio_venta, proveedor } = req.body
  if (!codigo?.trim() || !descripcion?.trim()) return res.status(400).json({ error: 'Código y descripción requeridos' })
  try {
    db.prepare(`
      UPDATE productos
      SET codigo=?, descripcion=?, categoria=?, unidad=?, stock_minimo=?, ubicacion=?,
          precio_costo=?, precio_venta=?, proveedor=?, updated_at=datetime('now','localtime')
      WHERE id=?
    `).run(codigo, descripcion, categoria??p.categoria, unidad??p.unidad,
           stock_minimo??p.stock_minimo, ubicacion??p.ubicacion,
           precio_costo??p.precio_costo, precio_venta??p.precio_venta,
           proveedor??p.proveedor, req.params.id)
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
  if (p.stock_actual !== 0)
    return res.status(409).json({ error: `No se puede eliminar: tiene ${p.stock_actual} unidades en stock` })
  db.prepare('UPDATE productos SET activo=0 WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

module.exports = router
