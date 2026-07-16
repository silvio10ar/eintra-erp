'use strict'
const express = require('express')
const { db }  = require('../db/database')
const { verificarToken } = require('../middleware/auth')
const { buscarCondicion } = require('../helpers/buscar')

const router = express.Router()
router.use(verificarToken)

const puedeE = req => !!req.permisos?.calidad?.escribir

const hoy = () => new Date().toISOString().slice(0,10)

function nextId(tabla, prefijo, ancho = 4) {
  const anio = new Date().getFullYear()
  const like = `${prefijo}-${anio}-%`
  const last = db.prepare(`SELECT numero FROM ${tabla} WHERE numero LIKE ? ORDER BY id DESC LIMIT 1`).get(like)
  if (!last) return `${prefijo}-${anio}-${'1'.padStart(ancho, '0')}`
  const n = parseInt(last.numero.split('-').pop() || '0') + 1
  return `${prefijo}-${anio}-${String(n).padStart(ancho, '0')}`
}

// ═══════════════════════════════════════════════════════════════════════════════
// FORM 21 — Control de Granallado
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/form21', (req, res) => {
  const { hoja_ruta_id, buscar } = req.query
  const conds = [], params = []
  if (hoja_ruta_id) { conds.push('f.hoja_ruta_id=?'); params.push(hoja_ruta_id) }
  if (buscar) {
    const bc = buscarCondicion(buscar, ['f.numero', 'f.pintor', 'f.operador_granalla'])
    conds.push(bc.cond); params.push(...bc.params)
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const rows = db.prepare(`
    SELECT f.*, h.numero AS hr_numero,
      (SELECT COUNT(*) FROM form21_item WHERE form21_id=f.id) AS total_items
    FROM form21 f
    LEFT JOIN hoja_ruta h ON h.id=f.hoja_ruta_id
    ${where} ORDER BY f.created_at DESC LIMIT 200
  `).all(...params)
  res.json(rows)
})

router.get('/form21/:id', (req, res) => {
  const f = db.prepare('SELECT f.*, h.numero AS hr_numero FROM form21 f LEFT JOIN hoja_ruta h ON h.id=f.hoja_ruta_id WHERE f.id=?').get(req.params.id)
  if (!f) return res.status(404).json({ error: 'No encontrado' })
  f.items = db.prepare('SELECT * FROM form21_item WHERE form21_id=? ORDER BY item').all(f.id)
  res.json(f)
})

router.post('/form21', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { hoja_ruta_id, fecha, pintor, operador_granalla, observaciones, items = [] } = req.body
  const numero = nextId('form21', 'F21')
  const r = db.prepare(`INSERT INTO form21 (numero,hoja_ruta_id,fecha,pintor,operador_granalla,observaciones) VALUES (?,?,?,?,?,?)`)
    .run(numero, hoja_ruta_id||null, fecha||hoy(), pintor||'', operador_granalla||'', observaciones||'')
  const id = r.lastInsertRowid
  const ins = db.prepare(`INSERT INTO form21_item (form21_id,item,partida,nro_chapa,espesor,conf_a,noconf_a,conf_b,noconf_b,observacion,verificacion) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
  items.forEach((it, i) => ins.run(id, i+1, it.partida||'', it.nro_chapa||'', it.espesor||'', it.conf_a||0, it.noconf_a||0, it.conf_b||0, it.noconf_b||0, it.observacion||'', it.verificacion||'Pendiente'))
  res.status(201).json({ id, numero })
})

router.put('/form21/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { hoja_ruta_id, fecha, pintor, operador_granalla, observaciones, items = [] } = req.body
  db.prepare(`UPDATE form21 SET hoja_ruta_id=?,fecha=?,pintor=?,operador_granalla=?,observaciones=? WHERE id=?`)
    .run(hoja_ruta_id||null, fecha||hoy(), pintor||'', operador_granalla||'', observaciones||'', req.params.id)
  db.prepare('DELETE FROM form21_item WHERE form21_id=?').run(req.params.id)
  const ins = db.prepare(`INSERT INTO form21_item (form21_id,item,partida,nro_chapa,espesor,conf_a,noconf_a,conf_b,noconf_b,observacion,verificacion) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
  items.forEach((it, i) => ins.run(req.params.id, i+1, it.partida||'', it.nro_chapa||'', it.espesor||'', it.conf_a||0, it.noconf_a||0, it.conf_b||0, it.noconf_b||0, it.observacion||'', it.verificacion||'Pendiente'))
  res.json({ ok: true })
})

router.delete('/form21/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  db.prepare('DELETE FROM form21 WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

// ═══════════════════════════════════════════════════════════════════════════════
// FORM 22 — Control de Pintura Base
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/form22', (req, res) => {
  const { hoja_ruta_id, buscar } = req.query
  const conds = [], params = []
  if (hoja_ruta_id) { conds.push('f.hoja_ruta_id=?'); params.push(hoja_ruta_id) }
  if (buscar) {
    const bc = buscarCondicion(buscar, ['f.numero', 'f.controlo', 'f.chapa_nro'])
    conds.push(bc.cond); params.push(...bc.params)
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const rows = db.prepare(`
    SELECT f.*, h.numero AS hr_numero FROM form22 f
    LEFT JOIN hoja_ruta h ON h.id=f.hoja_ruta_id
    ${where} ORDER BY f.created_at DESC LIMIT 200
  `).all(...params)
  res.json(rows)
})

router.get('/form22/:id', (req, res) => {
  const f = db.prepare('SELECT f.*, h.numero AS hr_numero FROM form22 f LEFT JOIN hoja_ruta h ON h.id=f.hoja_ruta_id WHERE f.id=?').get(req.params.id)
  if (!f) return res.status(404).json({ error: 'No encontrado' })
  res.json(f)
})

router.post('/form22', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { hoja_ruta_id, form21_numero, controlo, fecha, pintura_tipo, partida_nro, chapa_nro, cano_nro, perfil_nro, med_a, med_b, med_cano, observaciones } = req.body
  const numero = nextId('form22', 'F22')
  const r = db.prepare(`INSERT INTO form22 (numero,hoja_ruta_id,form21_numero,controlo,fecha,pintura_tipo,partida_nro,chapa_nro,cano_nro,perfil_nro,med_a,med_b,med_cano,observaciones) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(numero, hoja_ruta_id||null, form21_numero||'', controlo||'', fecha||hoy(), pintura_tipo||'', partida_nro||'', chapa_nro||'', cano_nro||'', perfil_nro||'',
      JSON.stringify(med_a||[]), JSON.stringify(med_b||[]), JSON.stringify(med_cano||[]), observaciones||'')
  res.status(201).json({ id: r.lastInsertRowid, numero })
})

router.put('/form22/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { hoja_ruta_id, form21_numero, controlo, fecha, pintura_tipo, partida_nro, chapa_nro, cano_nro, perfil_nro, med_a, med_b, med_cano, observaciones } = req.body
  db.prepare(`UPDATE form22 SET hoja_ruta_id=?,form21_numero=?,controlo=?,fecha=?,pintura_tipo=?,partida_nro=?,chapa_nro=?,cano_nro=?,perfil_nro=?,med_a=?,med_b=?,med_cano=?,observaciones=? WHERE id=?`)
    .run(hoja_ruta_id||null, form21_numero||'', controlo||'', fecha||hoy(), pintura_tipo||'', partida_nro||'', chapa_nro||'', cano_nro||'', perfil_nro||'',
      JSON.stringify(med_a||[]), JSON.stringify(med_b||[]), JSON.stringify(med_cano||[]), observaciones||'', req.params.id)
  res.json({ ok: true })
})

router.delete('/form22/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  db.prepare('DELETE FROM form22 WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

// ═══════════════════════════════════════════════════════════════════════════════
// FORM 26 — Control de Espesores de Pintura Final
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/form26', (req, res) => {
  const { hoja_ruta_id, buscar } = req.query
  const conds = [], params = []
  if (hoja_ruta_id) { conds.push('f.hoja_ruta_id=?'); params.push(hoja_ruta_id) }
  if (buscar) {
    const bc = buscarCondicion(buscar, ['f.numero', 'f.id_proyecto', 'f.pintor'])
    conds.push(bc.cond); params.push(...bc.params)
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const rows = db.prepare(`
    SELECT f.*, h.numero AS hr_numero FROM form26 f
    LEFT JOIN hoja_ruta h ON h.id=f.hoja_ruta_id
    ${where} ORDER BY f.created_at DESC LIMIT 200
  `).all(...params)
  res.json(rows)
})

router.get('/form26/:id', (req, res) => {
  const f = db.prepare('SELECT f.*, h.numero AS hr_numero FROM form26 f LEFT JOIN hoja_ruta h ON h.id=f.hoja_ruta_id WHERE f.id=?').get(req.params.id)
  if (!f) return res.status(404).json({ error: 'No encontrado' })
  res.json(f)
})

router.post('/form26', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { hoja_ruta_id, fecha, id_proyecto, pintor, controlo, aparato, mediciones, observaciones } = req.body
  const numero = nextId('form26', 'F26')
  const r = db.prepare(`INSERT INTO form26 (numero,hoja_ruta_id,fecha,id_proyecto,pintor,controlo,aparato,mediciones,observaciones) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(numero, hoja_ruta_id||null, fecha||hoy(), id_proyecto||'', pintor||'', controlo||'', aparato||'', JSON.stringify(mediciones||{}), observaciones||'')
  res.status(201).json({ id: r.lastInsertRowid, numero })
})

router.put('/form26/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { hoja_ruta_id, fecha, id_proyecto, pintor, controlo, aparato, mediciones, observaciones } = req.body
  db.prepare(`UPDATE form26 SET hoja_ruta_id=?,fecha=?,id_proyecto=?,pintor=?,controlo=?,aparato=?,mediciones=?,observaciones=? WHERE id=?`)
    .run(hoja_ruta_id||null, fecha||hoy(), id_proyecto||'', pintor||'', controlo||'', aparato||'', JSON.stringify(mediciones||{}), observaciones||'', req.params.id)
  res.json({ ok: true })
})

router.delete('/form26/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  db.prepare('DELETE FROM form26 WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

// ═══════════════════════════════════════════════════════════════════════════════
// FORM 34 — Verificación de Soldadura
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/form34', (req, res) => {
  const { hoja_ruta_id, buscar } = req.query
  const conds = [], params = []
  if (hoja_ruta_id) { conds.push('f.hoja_ruta_id=?'); params.push(hoja_ruta_id) }
  if (buscar) {
    const bc = buscarCondicion(buscar, ['f.numero', 'f.proyecto', 'f.oc'])
    conds.push(bc.cond); params.push(...bc.params)
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const rows = db.prepare(`
    SELECT f.*, h.numero AS hr_numero,
      (SELECT COUNT(*) FROM form34_item WHERE form34_id=f.id) AS total_items
    FROM form34 f
    LEFT JOIN hoja_ruta h ON h.id=f.hoja_ruta_id
    ${where} ORDER BY f.created_at DESC LIMIT 200
  `).all(...params)
  res.json(rows)
})

router.get('/form34/:id', (req, res) => {
  const f = db.prepare('SELECT f.*, h.numero AS hr_numero FROM form34 f LEFT JOIN hoja_ruta h ON h.id=f.hoja_ruta_id WHERE f.id=?').get(req.params.id)
  if (!f) return res.status(404).json({ error: 'No encontrado' })
  f.items = db.prepare('SELECT * FROM form34_item WHERE form34_id=? ORDER BY item').all(f.id)
  res.json(f)
})

router.post('/form34', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { hoja_ruta_id, proyecto, oc, fecha, soldador, observaciones, items = [] } = req.body
  const numero = nextId('form34', 'F34')
  const r = db.prepare(`INSERT INTO form34 (numero,hoja_ruta_id,proyecto,oc,fecha,soldador,observaciones) VALUES (?,?,?,?,?,?,?)`)
    .run(numero, hoja_ruta_id||null, proyecto||'', oc||'', fecha||hoy(), soldador||'', observaciones||'')
  const id = r.lastInsertRowid
  const ins = db.prepare(`INSERT INTO form34_item (form34_id,item,nro_chapa,codigo,lado,u_long_der,u_long_izq,u_trans_der,u_trans_izq,observacion) VALUES (?,?,?,?,?,?,?,?,?,?)`)
  items.forEach((it, i) => ins.run(id, i+1, it.nro_chapa||'', it.codigo||'', it.lado||'Externo', it.u_long_der||'', it.u_long_izq||'', it.u_trans_der||'', it.u_trans_izq||'', it.observacion||''))
  res.status(201).json({ id, numero })
})

router.put('/form34/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { hoja_ruta_id, proyecto, oc, fecha, soldador, observaciones, items = [] } = req.body
  db.prepare(`UPDATE form34 SET hoja_ruta_id=?,proyecto=?,oc=?,fecha=?,soldador=?,observaciones=? WHERE id=?`)
    .run(hoja_ruta_id||null, proyecto||'', oc||'', fecha||hoy(), soldador||'', observaciones||'', req.params.id)
  db.prepare('DELETE FROM form34_item WHERE form34_id=?').run(req.params.id)
  const ins = db.prepare(`INSERT INTO form34_item (form34_id,item,nro_chapa,codigo,lado,u_long_der,u_long_izq,u_trans_der,u_trans_izq,observacion) VALUES (?,?,?,?,?,?,?,?,?,?)`)
  items.forEach((it, i) => ins.run(req.params.id, i+1, it.nro_chapa||'', it.codigo||'', it.lado||'Externo', it.u_long_der||'', it.u_long_izq||'', it.u_trans_der||'', it.u_trans_izq||'', it.observacion||''))
  res.json({ ok: true })
})

router.delete('/form34/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  db.prepare('DELETE FROM form34 WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

// ═══════════════════════════════════════════════════════════════════════════════
// FORM 10 — Registro de Capacitación
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/form10', (req, res) => {
  const { buscar } = req.query
  const conds = [], params = []
  if (buscar) {
    const bc = buscarCondicion(buscar, ['f.numero', 'f.tema', 'f.expositor'])
    conds.push(bc.cond); params.push(...bc.params)
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const rows = db.prepare(`
    SELECT f.*,
      (SELECT COUNT(*) FROM form10_asistente WHERE form10_id=f.id) AS total_asistentes
    FROM form10 f ${where} ORDER BY f.created_at DESC LIMIT 200
  `).all(...params)
  res.json(rows)
})

router.get('/form10/:id', (req, res) => {
  const f = db.prepare('SELECT * FROM form10 WHERE id=?').get(req.params.id)
  if (!f) return res.status(404).json({ error: 'No encontrado' })
  f.asistentes = db.prepare('SELECT * FROM form10_asistente WHERE form10_id=? ORDER BY id').all(f.id)
  res.json(f)
})

router.post('/form10', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { tema, fecha, expositor, duracion, observaciones, asistentes = [] } = req.body
  if (!tema?.trim()) return res.status(400).json({ error: 'Tema requerido' })
  const numero = nextId('form10', 'F10')
  const r = db.prepare(`INSERT INTO form10 (numero,tema,fecha,expositor,duracion,observaciones) VALUES (?,?,?,?,?,?)`)
    .run(numero, tema.trim(), fecha||hoy(), expositor||'', duracion||'', observaciones||'')
  const id = r.lastInsertRowid
  const ins = db.prepare(`INSERT INTO form10_asistente (form10_id,nro_leg,apellido_nombre,area) VALUES (?,?,?,?)`)
  asistentes.forEach(a => ins.run(id, a.nro_leg||'', a.apellido_nombre||'', a.area||''))
  res.status(201).json({ id, numero })
})

router.put('/form10/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { tema, fecha, expositor, duracion, observaciones, asistentes = [] } = req.body
  db.prepare(`UPDATE form10 SET tema=?,fecha=?,expositor=?,duracion=?,observaciones=? WHERE id=?`)
    .run(tema||'', fecha||hoy(), expositor||'', duracion||'', observaciones||'', req.params.id)
  db.prepare('DELETE FROM form10_asistente WHERE form10_id=?').run(req.params.id)
  const ins = db.prepare(`INSERT INTO form10_asistente (form10_id,nro_leg,apellido_nombre,area) VALUES (?,?,?,?)`)
  asistentes.forEach(a => ins.run(req.params.id, a.nro_leg||'', a.apellido_nombre||'', a.area||''))
  res.json({ ok: true })
})

router.delete('/form10/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  db.prepare('DELETE FROM form10 WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

// ═══════════════════════════════════════════════════════════════════════════════
// FORM 37 — Chapa de Identificación de Equipos
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/form37', (req, res) => {
  const { hoja_ruta_id, buscar } = req.query
  const conds = [], params = []
  if (hoja_ruta_id) { conds.push('f.hoja_ruta_id=?'); params.push(hoja_ruta_id) }
  if (buscar) {
    const bc = buscarCondicion(buscar, ['f.numero', 'f.equipo_tipo', 'f.cliente', 'f.codigo'])
    conds.push(bc.cond); params.push(...bc.params)
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const rows = db.prepare(`
    SELECT f.*, h.numero AS hr_numero FROM form37 f
    LEFT JOIN hoja_ruta h ON h.id=f.hoja_ruta_id
    ${where} ORDER BY f.created_at DESC LIMIT 200
  `).all(...params)
  res.json(rows)
})

router.post('/form37', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { hoja_ruta_id, anio, equipo_tipo, codigo, cliente, proyecto, descripcion, fecha_fabricacion, observaciones } = req.body
  const numero = nextId('form37', 'F37')
  const r = db.prepare(`INSERT INTO form37 (numero,hoja_ruta_id,anio,equipo_tipo,codigo,cliente,proyecto,descripcion,fecha_fabricacion,observaciones) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(numero, hoja_ruta_id||null, anio||new Date().getFullYear(), equipo_tipo||'', codigo||'', cliente||'', proyecto||'', descripcion||'', fecha_fabricacion||'', observaciones||'')
  res.status(201).json({ id: r.lastInsertRowid, numero })
})

router.put('/form37/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { hoja_ruta_id, anio, equipo_tipo, codigo, cliente, proyecto, descripcion, fecha_fabricacion, observaciones } = req.body
  db.prepare(`UPDATE form37 SET hoja_ruta_id=?,anio=?,equipo_tipo=?,codigo=?,cliente=?,proyecto=?,descripcion=?,fecha_fabricacion=?,observaciones=? WHERE id=?`)
    .run(hoja_ruta_id||null, anio||new Date().getFullYear(), equipo_tipo||'', codigo||'', cliente||'', proyecto||'', descripcion||'', fecha_fabricacion||'', observaciones||'', req.params.id)
  res.json({ ok: true })
})

router.delete('/form37/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  db.prepare('DELETE FROM form37 WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

// ═══════════════════════════════════════════════════════════════════════════════
// EPP — Entrega de Elementos de Protección Personal
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/epp', (req, res) => {
  const { buscar } = req.query
  const conds = [], params = []
  if (buscar) {
    const bc = buscarCondicion(buscar, ['f.numero', 'f.empleado', 'f.dni'])
    conds.push(bc.cond); params.push(...bc.params)
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const rows = db.prepare(`
    SELECT f.*,
      (SELECT COUNT(*) FROM form_epp_item WHERE epp_id=f.id) AS total_items
    FROM form_epp f ${where} ORDER BY f.created_at DESC LIMIT 200
  `).all(...params)
  res.json(rows)
})

router.get('/epp/:id', (req, res) => {
  const f = db.prepare('SELECT * FROM form_epp WHERE id=?').get(req.params.id)
  if (!f) return res.status(404).json({ error: 'No encontrado' })
  f.items = db.prepare('SELECT * FROM form_epp_item WHERE epp_id=? ORDER BY id').all(f.id)
  res.json(f)
})

router.post('/epp', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { empleado, dni, puesto, fecha, observaciones, items = [] } = req.body
  if (!empleado?.trim()) return res.status(400).json({ error: 'Empleado requerido' })
  const numero = nextId('form_epp', 'EPP')
  const r = db.prepare(`INSERT INTO form_epp (numero,empleado,dni,puesto,fecha,observaciones) VALUES (?,?,?,?,?,?)`)
    .run(numero, empleado.trim(), dni||'', puesto||'', fecha||hoy(), observaciones||'')
  const id = r.lastInsertRowid
  const ins = db.prepare(`INSERT INTO form_epp_item (epp_id,producto,tipo_modelo,marca,certificacion,cantidad,fecha_entrega) VALUES (?,?,?,?,?,?,?)`)
  items.forEach(it => ins.run(id, it.producto||'', it.tipo_modelo||'', it.marca||'', it.certificacion?1:0, it.cantidad||1, it.fecha_entrega||''))
  res.status(201).json({ id, numero })
})

router.put('/epp/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { empleado, dni, puesto, fecha, observaciones, items = [] } = req.body
  db.prepare(`UPDATE form_epp SET empleado=?,dni=?,puesto=?,fecha=?,observaciones=? WHERE id=?`)
    .run(empleado||'', dni||'', puesto||'', fecha||hoy(), observaciones||'', req.params.id)
  db.prepare('DELETE FROM form_epp_item WHERE epp_id=?').run(req.params.id)
  const ins = db.prepare(`INSERT INTO form_epp_item (epp_id,producto,tipo_modelo,marca,certificacion,cantidad,fecha_entrega) VALUES (?,?,?,?,?,?,?)`)
  items.forEach(it => ins.run(req.params.id, it.producto||'', it.tipo_modelo||'', it.marca||'', it.certificacion?1:0, it.cantidad||1, it.fecha_entrega||''))
  res.json({ ok: true })
})

router.delete('/epp/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  db.prepare('DELETE FROM form_epp WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

// ═══════════════════════════════════════════════════════════════════════════════
// PACKING LIST
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/packing', (req, res) => {
  const { hoja_ruta_id, buscar } = req.query
  const conds = [], params = []
  if (hoja_ruta_id) { conds.push('f.hoja_ruta_id=?'); params.push(hoja_ruta_id) }
  if (buscar) {
    const bc = buscarCondicion(buscar, ['f.numero', 'f.cliente', 'f.obra_oc'])
    conds.push(bc.cond); params.push(...bc.params)
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const rows = db.prepare(`
    SELECT f.*, h.numero AS hr_numero,
      (SELECT COUNT(*) FROM form_packing_item WHERE packing_id=f.id) AS total_items
    FROM form_packing f
    LEFT JOIN hoja_ruta h ON h.id=f.hoja_ruta_id
    ${where} ORDER BY f.created_at DESC LIMIT 200
  `).all(...params)
  res.json(rows)
})

router.get('/packing/:id', (req, res) => {
  const f = db.prepare('SELECT f.*, h.numero AS hr_numero FROM form_packing f LEFT JOIN hoja_ruta h ON h.id=f.hoja_ruta_id WHERE f.id=?').get(req.params.id)
  if (!f) return res.status(404).json({ error: 'No encontrado' })
  f.items = db.prepare('SELECT * FROM form_packing_item WHERE packing_id=? ORDER BY item').all(f.id)
  res.json(f)
})

router.post('/packing', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { hoja_ruta_id, cliente, obra_oc, ubicacion, preparo, revisado, pallet, bulto, lista_nro, fecha, observaciones, items = [] } = req.body
  const numero = nextId('form_packing', 'PL')
  const r = db.prepare(`INSERT INTO form_packing (numero,hoja_ruta_id,cliente,obra_oc,ubicacion,preparo,revisado,pallet,bulto,lista_nro,fecha,observaciones) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(numero, hoja_ruta_id||null, cliente||'', obra_oc||'', ubicacion||'', preparo||'', revisado||'', pallet||'', bulto||'', lista_nro||'', fecha||hoy(), observaciones||'')
  const id = r.lastInsertRowid
  const ins = db.prepare(`INSERT INTO form_packing_item (packing_id,item,descripcion,codigo,cantidad) VALUES (?,?,?,?,?)`)
  items.forEach((it, i) => ins.run(id, i+1, it.descripcion||'', it.codigo||'', it.cantidad||''))
  res.status(201).json({ id, numero })
})

router.put('/packing/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { hoja_ruta_id, cliente, obra_oc, ubicacion, preparo, revisado, pallet, bulto, lista_nro, fecha, observaciones, items = [] } = req.body
  db.prepare(`UPDATE form_packing SET hoja_ruta_id=?,cliente=?,obra_oc=?,ubicacion=?,preparo=?,revisado=?,pallet=?,bulto=?,lista_nro=?,fecha=?,observaciones=? WHERE id=?`)
    .run(hoja_ruta_id||null, cliente||'', obra_oc||'', ubicacion||'', preparo||'', revisado||'', pallet||'', bulto||'', lista_nro||'', fecha||hoy(), observaciones||'', req.params.id)
  db.prepare('DELETE FROM form_packing_item WHERE packing_id=?').run(req.params.id)
  const ins = db.prepare(`INSERT INTO form_packing_item (packing_id,item,descripcion,codigo,cantidad) VALUES (?,?,?,?,?)`)
  items.forEach((it, i) => ins.run(req.params.id, i+1, it.descripcion||'', it.codigo||'', it.cantidad||''))
  res.json({ ok: true })
})

router.delete('/packing/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  db.prepare('DELETE FROM form_packing WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

module.exports = router
