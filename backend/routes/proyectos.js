'use strict'
const express = require('express')
const { body, validationResult } = require('express-validator')
const { db }  = require('../db/database')
const { verificarToken } = require('../middleware/auth')
const { buscarCondicion } = require('../helpers/buscar')

const router = express.Router()

const puedeL = req => !!(req.permisos?.proyectos?.leer || req.permisos?.proyectos?.escribir)
const puedeE = req => !!req.permisos?.proyectos?.escribir

// ── Listado ───────────────────────────────────────────────────────────────────
router.get('/', verificarToken, (req, res) => {
  if (!puedeL(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { estado, cliente_id, buscar } = req.query
  const conds = [], params = []
  if (estado)     { conds.push('p.estado=?');               params.push(estado) }
  if (cliente_id) { conds.push('p.cliente_id=?');           params.push(cliente_id) }
  if (buscar)     { const b = buscarCondicion(buscar, ['p.codigo','p.nombre','p.cliente_nombre']); conds.push(b.cond); params.push(...b.params) }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const rows = db.prepare(`
    SELECT p.*,
      COALESCE((SELECT SUM(total) FROM proyecto_costos WHERE proyecto_id=p.id), 0) AS costo_total,
      COALESCE((SELECT COUNT(*) FROM proyecto_documentos WHERE proyecto_id=p.id AND lower(aplica)='aplica'), 0) AS docs_aplican,
      COALESCE((SELECT COUNT(*) FROM proyecto_documentos WHERE proyecto_id=p.id AND lower(aplica)='aplica' AND lower(estado)='realizado'), 0) AS docs_realizados
    FROM proyectos p
    ${where}
    ORDER BY p.created_at DESC
  `).all(...params)
  res.json(rows)
})

// ── Detalle ───────────────────────────────────────────────────────────────────
router.get('/:id', verificarToken, (req, res) => {
  if (!puedeL(req)) return res.status(403).json({ error: 'Sin permisos' })
  const p = db.prepare('SELECT * FROM proyectos WHERE id=?').get(req.params.id)
  if (!p) return res.status(404).json({ error: 'No encontrado' })
  const costos = db.prepare('SELECT * FROM proyecto_costos WHERE proyecto_id=? ORDER BY fecha DESC, id DESC').all(p.id)
  const ots    = db.prepare('SELECT id,numero,descripcion,estado,responsable FROM ordenes_trabajo WHERE proyecto_id=? ORDER BY id DESC').all(p.id)
  const total  = costos.reduce((s, c) => s + c.total, 0)
  res.json({ ...p, costos, ordenes_trabajo: ots, costo_total: total })
})

// ── Documentos Form 30 ────────────────────────────────────────────────────────
router.get('/:id/documentos', verificarToken, (req, res) => {
  if (!puedeL(req)) return res.status(403).json({ error: 'Sin permisos' })
  const docs = db.prepare('SELECT * FROM proyecto_documentos WHERE proyecto_id=? ORDER BY item_num, id').all(req.params.id)
  res.json(docs)
})

router.put('/:id/documentos/:doc_id', verificarToken, (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const doc = db.prepare('SELECT * FROM proyecto_documentos WHERE id=? AND proyecto_id=?').get(req.params.doc_id, req.params.id)
  if (!doc) return res.status(404).json({ error: 'No encontrado' })
  const { aplica, estado, fecha_solicitado, fecha_entregado, responsable } = req.body
  db.prepare('UPDATE proyecto_documentos SET aplica=?,estado=?,fecha_solicitado=?,fecha_entregado=?,responsable=? WHERE id=?')
    .run(aplica         ?? doc.aplica,
         estado         ?? doc.estado,
         fecha_solicitado ?? doc.fecha_solicitado,
         fecha_entregado  ?? doc.fecha_entregado,
         responsable      ?? doc.responsable,
         req.params.doc_id)
  res.json(db.prepare('SELECT * FROM proyecto_documentos WHERE id=?').get(req.params.doc_id))
})

// ── Crear ─────────────────────────────────────────────────────────────────────
router.post('/', verificarToken,
  body('codigo').trim().notEmpty(),
  body('nombre').trim().notEmpty(),
  (req, res) => {
    if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
    const errs = validationResult(req)
    if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() })
    const { codigo, nombre, cliente_id, cliente_nombre, descripcion, fecha_inicio, fecha_fin_est, estado, presupuesto_venta, responsable, presupuesto_id } = req.body
    try {
      const r = db.prepare('INSERT INTO proyectos (codigo,nombre,cliente_id,cliente_nombre,descripcion,fecha_inicio,fecha_fin_est,estado,presupuesto_venta,responsable,presupuesto_id,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(codigo, nombre, cliente_id || null, cliente_nombre || '', descripcion || '',
             fecha_inicio || '', fecha_fin_est || '', estado || 'Activo', presupuesto_venta || 0,
             responsable || '', presupuesto_id || null, req.usuario.id)
      res.status(201).json(db.prepare('SELECT * FROM proyectos WHERE id=?').get(r.lastInsertRowid))
    } catch(e) {
      if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'El código ya existe' })
      throw e
    }
  }
)

// ── Editar ────────────────────────────────────────────────────────────────────
router.put('/:id', verificarToken, (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const p = db.prepare('SELECT * FROM proyectos WHERE id=?').get(req.params.id)
  if (!p) return res.status(404).json({ error: 'No encontrado' })
  const { codigo, nombre, cliente_id, cliente_nombre, descripcion, fecha_inicio, fecha_fin_est, fecha_cierre, estado, presupuesto_venta, responsable } = req.body
  db.prepare(`UPDATE proyectos SET codigo=?,nombre=?,cliente_id=?,cliente_nombre=?,descripcion=?,fecha_inicio=?,fecha_fin_est=?,fecha_cierre=?,estado=?,presupuesto_venta=?,responsable=?,updated_at=datetime('now','localtime') WHERE id=?`)
    .run(codigo ?? p.codigo, nombre ?? p.nombre, cliente_id ?? p.cliente_id, cliente_nombre ?? p.cliente_nombre,
         descripcion ?? p.descripcion, fecha_inicio ?? p.fecha_inicio, fecha_fin_est ?? p.fecha_fin_est,
         fecha_cierre ?? p.fecha_cierre, estado ?? p.estado, presupuesto_venta ?? p.presupuesto_venta,
         responsable ?? p.responsable, req.params.id)
  res.json(db.prepare('SELECT * FROM proyectos WHERE id=?').get(req.params.id))
})

// ── Costos ────────────────────────────────────────────────────────────────────
router.post('/:id/costos', verificarToken, (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { tipo, descripcion, cantidad, precio_unit, fecha } = req.body
  const cant  = parseFloat(cantidad)    || 1
  const precio = parseFloat(precio_unit) || 0
  const r = db.prepare('INSERT INTO proyecto_costos (proyecto_id,tipo,descripcion,cantidad,precio_unit,total,fecha,origen,created_by) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(req.params.id, tipo || 'Material', descripcion || '', cant, precio, cant * precio,
         fecha || new Date().toISOString().slice(0, 10), 'manual', req.usuario.id)
  res.status(201).json(db.prepare('SELECT * FROM proyecto_costos WHERE id=?').get(r.lastInsertRowid))
})

router.delete('/:id/costos/:costo_id', verificarToken, (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  db.prepare('DELETE FROM proyecto_costos WHERE id=? AND proyecto_id=?').run(req.params.costo_id, req.params.id)
  res.json({ ok: true })
})

// ── Normalizar responsables (admin only) ─────────────────────────────────────
router.post('/normalizar-responsables', verificarToken, (req, res) => {
  if (req.usuario?.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' })
  const { mapping } = req.body
  if (!mapping || typeof mapping !== 'object') return res.status(400).json({ error: 'mapping requerido' })
  const upd = db.prepare('UPDATE proyecto_documentos SET responsable=? WHERE responsable=?')
  let actualizados = 0
  db.transaction(() => {
    for (const [desde, hasta] of Object.entries(mapping)) {
      actualizados += upd.run(hasta, desde).changes
    }
  })()
  res.json({ ok: true, actualizados })
})

// ── Importación bulk desde Excel (admin only) ─────────────────────────────────
router.post('/importar', verificarToken, (req, res) => {
  if (req.usuario?.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' })
  const { proyectos = [] } = req.body
  if (!Array.isArray(proyectos) || proyectos.length === 0)
    return res.status(400).json({ error: 'Se esperaba un array "proyectos"' })

  const insP = db.prepare(`
    INSERT OR IGNORE INTO proyectos
      (codigo, nombre, descripcion, cliente_nombre, fecha_inicio, fecha_fin_est, estado, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insD = db.prepare(`
    INSERT INTO proyecto_documentos
      (proyecto_id, item_num, item_nombre, categoria, item, subitem, responsable, aplica, estado, fecha_solicitado, fecha_entregado)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  let creados = 0, omitidos = 0, docs_total = 0

  db.transaction(() => {
    for (const p of proyectos) {
      const r = insP.run(
        p.codigo, p.nombre, p.descripcion || '', p.cliente || '',
        p.fecha_inicio || '', p.fecha_fin_est || '', p.estado || 'Activo',
        req.usuario.id
      )
      if (!r.changes) { omitidos++; continue }
      creados++
      const pid = r.lastInsertRowid
      for (const d of (p.docs || [])) {
        insD.run(pid, d.item_num, d.item_nombre || '', d.categoria, d.item, d.subitem,
                 d.responsable, d.aplica, d.estado, d.fecha_solicitado, d.fecha_entregado)
        docs_total++
      }
    }
  })()

  res.json({ ok: true, creados, omitidos, docs_total })
})

module.exports = router
