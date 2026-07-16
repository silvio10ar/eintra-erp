'use strict'
const express = require('express')
const { db } = require('../db/database')
const { verificarToken } = require('../middleware/auth')

const router = express.Router()
router.use(verificarToken)

const puedeL = req => !!(req.permisos?.materiales?.leer || req.permisos?.materiales?.escribir || req.permisos?.codificacion?.leer || req.permisos?.codificacion?.escribir)
const puedeE = req => !!(req.permisos?.materiales?.escribir || req.permisos?.codificacion?.escribir)

// GET /stats — totales por estado
router.get('/stats', (req, res) => {
  if (!puedeL(req)) return res.status(403).json({ error: 'Sin permisos' })
  const total     = db.prepare('SELECT COUNT(*) AS n FROM productos WHERE activo=1').get().n
  const asignado  = db.prepare("SELECT COUNT(*) AS n FROM productos WHERE activo=1 AND codigo_futuro != '' AND codigo_futuro_estado='asignado'").get().n
  const validado  = db.prepare("SELECT COUNT(*) AS n FROM productos WHERE activo=1 AND codigo_futuro != '' AND codigo_futuro_estado='validado'").get().n
  const pendiente = total - asignado - validado
  res.json({ total, pendiente, asignado, validado })
})

// GET / — listado con filtro de estado
router.get('/', (req, res) => {
  if (!puedeL(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { estado, buscar } = req.query
  const conds = ['activo=1'], params = []

  if (estado === 'pendiente') {
    conds.push("(codigo_futuro = '' OR codigo_futuro IS NULL OR codigo_futuro_estado = 'pendiente')")
  } else if (estado === 'asignado') {
    conds.push("codigo_futuro != '' AND codigo_futuro_estado = 'asignado'")
  } else if (estado === 'validado') {
    conds.push("codigo_futuro != '' AND codigo_futuro_estado = 'validado'")
  }

  if (buscar) {
    const q = `%${buscar}%`
    conds.push('(codigo LIKE ? OR descripcion LIKE ? OR codigo_futuro LIKE ?)')
    params.push(q, q, q)
  }

  const rows = db.prepare(
    `SELECT id, codigo, descripcion, categoria, unidad, codigo_futuro, codigo_futuro_estado
     FROM productos WHERE ${conds.join(' AND ')} ORDER BY descripcion`
  ).all(...params)
  res.json(rows)
})

// PUT /:id/validar — marcar como validado
router.put('/:id/validar', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const p = db.prepare("SELECT id, codigo_futuro FROM productos WHERE id=? AND activo=1").get(req.params.id)
  if (!p) return res.status(404).json({ error: 'Producto no encontrado' })
  if (!p.codigo_futuro) return res.status(400).json({ error: 'El producto no tiene código futuro asignado' })
  db.prepare("UPDATE productos SET codigo_futuro_estado='validado', updated_at=datetime('now','localtime') WHERE id=?").run(req.params.id)
  res.json({ ok: true })
})

// PUT /:id/desasignar — volver a pendiente
router.put('/:id/desasignar', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const p = db.prepare('SELECT id FROM productos WHERE id=? AND activo=1').get(req.params.id)
  if (!p) return res.status(404).json({ error: 'Producto no encontrado' })
  db.prepare("UPDATE productos SET codigo_futuro='', codigo_futuro_estado='pendiente', updated_at=datetime('now','localtime') WHERE id=?").run(req.params.id)
  res.json({ ok: true })
})

module.exports = router
