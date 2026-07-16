'use strict'
const express = require('express')
const { db }  = require('../db/database')
const { verificarToken } = require('../middleware/auth')
const { buscarCondicion } = require('../helpers/buscar')

const router = express.Router()
router.use(verificarToken)

const puedeE = req => !!req.permisos?.calidad?.escribir

const ETAPAS_DEFAULT = [
  'Corte de materiales',
  'Armado y soldadura',
  'Granallado',
  'Pintura base',
  'Pintura final',
  'Montaje',
  'Prueba funcional',
  'Control final',
  'Despacho',
]

function nextNumHR() {
  const anio = new Date().getFullYear()
  const last = db.prepare(`SELECT numero FROM hoja_ruta WHERE numero LIKE ? ORDER BY id DESC LIMIT 1`).get(`HR-${anio}-%`)
  if (!last) return `HR-${anio}-0001`
  const parts = last.numero.split('-')
  const n = parseInt(parts[parts.length - 1] || '0') + 1
  return `HR-${anio}-${String(n).padStart(4,'0')}`
}

function nextNumNC() {
  const anio = new Date().getFullYear()
  const last = db.prepare(`SELECT numero FROM no_conformidad WHERE numero LIKE ? ORDER BY id DESC LIMIT 1`).get(`NC-${anio}-%`)
  if (!last) return `NC-${anio}-001`
  const parts = last.numero.split('-')
  const n = parseInt(parts[parts.length - 1] || '0') + 1
  return `NC-${anio}-${String(n).padStart(3,'0')}`
}

// ── Resumen dashboard ─────────────────────────────────────────────────────────
router.get('/resumen', (req, res) => {
  const hrTotal     = db.prepare("SELECT COUNT(*) as c FROM hoja_ruta").get().c
  const hrEnProceso = db.prepare("SELECT COUNT(*) as c FROM hoja_ruta WHERE estado='En proceso'").get().c
  const hrTerminado = db.prepare("SELECT COUNT(*) as c FROM hoja_ruta WHERE estado='Terminado'").get().c
  const hrDespachado= db.prepare("SELECT COUNT(*) as c FROM hoja_ruta WHERE estado='Despachado'").get().c
  const ncAbiertas  = db.prepare("SELECT COUNT(*) as c FROM no_conformidad WHERE estado='Abierta'").get().c
  const ncEnProceso = db.prepare("SELECT COUNT(*) as c FROM no_conformidad WHERE estado='En proceso'").get().c
  const ncCerradas  = db.prepare("SELECT COUNT(*) as c FROM no_conformidad WHERE estado='Cerrada'").get().c
  const inspecciones= db.prepare("SELECT COUNT(*) as c FROM calidad_inspeccion").get().c
  res.json({ hrTotal, hrEnProceso, hrTerminado, hrDespachado, ncAbiertas, ncEnProceso, ncCerradas, inspecciones })
})

// ── Proyectos activos (combo) ──────────────────────────────────────────────────
router.get('/proyectos-activos', (req, res) => {
  const rows = db.prepare(
    `SELECT id, codigo, nombre, cliente_nombre FROM proyectos WHERE estado IN ('Activo','En espera') ORDER BY codigo`
  ).all()
  res.json(rows)
})

// ── Hojas de Ruta ─────────────────────────────────────────────────────────────
router.get('/hojas-ruta', (req, res) => {
  const { estado, buscar, proyecto_id } = req.query
  const conds = [], params = []
  if (estado)     { conds.push('h.estado=?'); params.push(estado) }
  if (proyecto_id){ conds.push('h.proyecto_id=?'); params.push(proyecto_id) }
  if (buscar) {
    const bc = buscarCondicion(buscar, ['h.numero', 'h.descripcion', 'h.cliente_nombre'])
    conds.push(bc.cond); params.push(...bc.params)
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const rows = db.prepare(`
    SELECT h.*,
      p.codigo AS proyecto_codigo,
      (SELECT COUNT(*) FROM hoja_ruta_etapa WHERE hoja_ruta_id=h.id) AS etapas_total,
      (SELECT COUNT(*) FROM hoja_ruta_etapa WHERE hoja_ruta_id=h.id AND estado='Completada') AS etapas_comp,
      (SELECT COUNT(*) FROM no_conformidad WHERE hoja_ruta_id=h.id AND estado!='Cerrada') AS nc_abiertas
    FROM hoja_ruta h
    LEFT JOIN proyectos p ON p.id=h.proyecto_id
    ${where}
    ORDER BY h.created_at DESC
  `).all(...params)
  res.json(rows)
})

router.get('/hojas-ruta/:id', (req, res) => {
  const hr = db.prepare(`
    SELECT h.*, p.codigo AS proyecto_codigo
    FROM hoja_ruta h LEFT JOIN proyectos p ON p.id=h.proyecto_id
    WHERE h.id=?
  `).get(req.params.id)
  if (!hr) return res.status(404).json({ error: 'No encontrada' })
  hr.etapas = db.prepare('SELECT * FROM hoja_ruta_etapa WHERE hoja_ruta_id=? ORDER BY orden').all(hr.id)
  hr.nc = db.prepare('SELECT * FROM no_conformidad WHERE hoja_ruta_id=? ORDER BY created_at DESC').all(hr.id)
  hr.inspecciones = db.prepare('SELECT * FROM calidad_inspeccion WHERE hoja_ruta_id=? ORDER BY created_at DESC').all(hr.id)
  res.json(hr)
})

router.post('/hojas-ruta', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { proyecto_id, descripcion, cliente_nombre, responsable, fecha_inicio, fecha_fin_est, observaciones } = req.body
  if (!descripcion?.trim()) return res.status(400).json({ error: 'Descripción requerida' })
  const numero = nextNumHR()
  const r = db.prepare(`
    INSERT INTO hoja_ruta (numero, proyecto_id, descripcion, cliente_nombre, responsable, fecha_inicio, fecha_fin_est, observaciones)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(numero, proyecto_id || null, descripcion.trim(), cliente_nombre || '', responsable || '', fecha_inicio || '', fecha_fin_est || '', observaciones || '')
  const hrId = r.lastInsertRowid
  const insEtapa = db.prepare('INSERT INTO hoja_ruta_etapa (hoja_ruta_id, nombre, orden) VALUES (?,?,?)')
  ETAPAS_DEFAULT.forEach((nombre, i) => insEtapa.run(hrId, nombre, i + 1))
  res.status(201).json({ id: hrId, numero })
})

router.put('/hojas-ruta/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { descripcion, cliente_nombre, responsable, fecha_inicio, fecha_fin_est, fecha_despacho, estado, observaciones, proyecto_id } = req.body
  db.prepare(`
    UPDATE hoja_ruta SET
      descripcion=?, cliente_nombre=?, responsable=?, fecha_inicio=?,
      fecha_fin_est=?, fecha_despacho=?, estado=?, observaciones=?, proyecto_id=?,
      updated_at=datetime('now','localtime')
    WHERE id=?
  `).run(
    descripcion || '', cliente_nombre || '', responsable || '', fecha_inicio || '',
    fecha_fin_est || '', fecha_despacho || '', estado || 'En proceso', observaciones || '',
    proyecto_id || null, req.params.id
  )
  res.json({ ok: true })
})

router.delete('/hojas-ruta/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  db.prepare('DELETE FROM hoja_ruta WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

// ── Etapas ─────────────────────────────────────────────────────────────────────
router.put('/hojas-ruta/:id/etapas/:etapaId', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { estado, responsable, fecha_prog, fecha_real, observaciones, criterios, medicion } = req.body
  db.prepare(`
    UPDATE hoja_ruta_etapa SET estado=?, responsable=?, fecha_prog=?, fecha_real=?,
      observaciones=?, criterios=?, medicion=?
    WHERE id=? AND hoja_ruta_id=?
  `).run(
    estado || 'Pendiente', responsable || '', fecha_prog || '', fecha_real || '',
    observaciones || '', criterios || '', medicion || '',
    req.params.etapaId, req.params.id
  )
  res.json({ ok: true })
})

// ── No Conformidades ──────────────────────────────────────────────────────────
router.get('/no-conformidades', (req, res) => {
  const { estado, tipo, buscar } = req.query
  const conds = [], params = []
  if (estado) { conds.push('n.estado=?'); params.push(estado) }
  if (tipo)   { conds.push('n.tipo=?');   params.push(tipo)   }
  if (buscar) {
    const bc = buscarCondicion(buscar, ['n.numero', 'n.descripcion', 'n.detectado_por'])
    conds.push(bc.cond); params.push(...bc.params)
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const rows = db.prepare(`
    SELECT n.*, h.numero AS hr_numero, h.descripcion AS hr_descripcion, p.codigo AS proyecto_codigo
    FROM no_conformidad n
    LEFT JOIN hoja_ruta h  ON h.id=n.hoja_ruta_id
    LEFT JOIN proyectos p  ON p.id=n.proyecto_id
    ${where}
    ORDER BY n.created_at DESC
  `).all(...params)
  res.json(rows)
})

router.post('/no-conformidades', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { hoja_ruta_id, proyecto_id, fecha, tipo, descripcion, causa, detectado_por, accion_correctiva, responsable, fecha_limite } = req.body
  if (!descripcion?.trim()) return res.status(400).json({ error: 'Descripción requerida' })
  const numero = nextNumNC()
  const r = db.prepare(`
    INSERT INTO no_conformidad (numero, hoja_ruta_id, proyecto_id, fecha, tipo, descripcion, causa, detectado_por, accion_correctiva, responsable, fecha_limite)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(numero, hoja_ruta_id || null, proyecto_id || null, fecha || '', tipo || 'Producto', descripcion.trim(), causa || '', detectado_por || '', accion_correctiva || '', responsable || '', fecha_limite || '')
  res.status(201).json({ id: r.lastInsertRowid, numero })
})

router.put('/no-conformidades/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { fecha, tipo, descripcion, causa, detectado_por, accion_correctiva, responsable, fecha_limite, fecha_cierre, estado, hoja_ruta_id, proyecto_id } = req.body
  db.prepare(`
    UPDATE no_conformidad SET
      fecha=?, tipo=?, descripcion=?, causa=?, detectado_por=?,
      accion_correctiva=?, responsable=?, fecha_limite=?, fecha_cierre=?, estado=?,
      hoja_ruta_id=?, proyecto_id=?
    WHERE id=?
  `).run(
    fecha || '', tipo || 'Producto', descripcion || '', causa || '', detectado_por || '',
    accion_correctiva || '', responsable || '', fecha_limite || '', fecha_cierre || '', estado || 'Abierta',
    hoja_ruta_id || null, proyecto_id || null,
    req.params.id
  )
  res.json({ ok: true })
})

router.delete('/no-conformidades/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  db.prepare('DELETE FROM no_conformidad WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

// ── Inspecciones ──────────────────────────────────────────────────────────────
router.get('/inspecciones', (req, res) => {
  const { hoja_ruta_id, tipo } = req.query
  const conds = [], params = []
  if (hoja_ruta_id) { conds.push('i.hoja_ruta_id=?'); params.push(hoja_ruta_id) }
  if (tipo)         { conds.push('i.tipo=?');          params.push(tipo)         }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const rows = db.prepare(`
    SELECT i.*, h.numero AS hr_numero, h.descripcion AS hr_descripcion
    FROM calidad_inspeccion i
    LEFT JOIN hoja_ruta h ON h.id=i.hoja_ruta_id
    ${where}
    ORDER BY i.created_at DESC
    LIMIT 200
  `).all(...params)
  res.json(rows)
})

router.post('/inspecciones', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { hoja_ruta_id, tipo, fecha, inspector, resultado, observaciones } = req.body
  if (!tipo) return res.status(400).json({ error: 'Tipo requerido' })
  const r = db.prepare(`
    INSERT INTO calidad_inspeccion (hoja_ruta_id, tipo, fecha, inspector, resultado, observaciones)
    VALUES (?,?,?,?,?,?)
  `).run(hoja_ruta_id || null, tipo, fecha || '', inspector || '', resultado || 'Aprobado', observaciones || '')
  res.status(201).json({ id: r.lastInsertRowid })
})

router.delete('/inspecciones/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  db.prepare('DELETE FROM calidad_inspeccion WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

module.exports = router
