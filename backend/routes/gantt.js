'use strict'
const express = require('express')
const { db }  = require('../db/database')
const { verificarToken } = require('../middleware/auth')

const router = express.Router()
router.use(verificarToken)

const puedeE = req => !!req.permisos?.proyectos?.escribir

// ── Algoritmo: calcular fechas de todas las tareas de un proyecto ─────────────
function recalcularFechas(proyectoId) {
  const proyecto = db.prepare('SELECT fecha_inicio FROM proyectos WHERE id=?').get(proyectoId)
  const fechaBase = proyecto?.fecha_inicio || new Date().toISOString().slice(0, 10)

  const tareas = db.prepare('SELECT * FROM proyecto_tarea WHERE proyecto_id=? ORDER BY orden').all(proyectoId)
  if (!tareas.length) return

  const preds = db.prepare(`
    SELECT p.tarea_id, p.predecesora_id
    FROM proyecto_tarea_predecesora p
    JOIN proyecto_tarea t ON t.id=p.tarea_id
    WHERE t.proyecto_id=?
  `).all(proyectoId)

  const depsMap = {}
  tareas.forEach(t => depsMap[t.id] = [])
  preds.forEach(p => { if (depsMap[p.tarea_id]) depsMap[p.tarea_id].push(p.predecesora_id) })

  const inDegree = {}
  const adjList  = {}
  tareas.forEach(t => { inDegree[t.id] = 0; adjList[t.id] = [] })
  preds.forEach(p => {
    inDegree[p.tarea_id] = (inDegree[p.tarea_id] || 0) + 1
    if (adjList[p.predecesora_id]) adjList[p.predecesora_id].push(p.tarea_id)
  })

  const queue = tareas.filter(t => inDegree[t.id] === 0).map(t => t.id)
  const order = []
  while (queue.length) {
    const id = queue.shift()
    order.push(id)
    ;(adjList[id] || []).forEach(next => {
      inDegree[next]--
      if (inDegree[next] === 0) queue.push(next)
    })
  }
  tareas.forEach(t => { if (!order.includes(t.id)) order.push(t.id) })

  const tareaMap = {}
  tareas.forEach(t => tareaMap[t.id] = t)

  const finCalc = {}
  const iniCalc = {}

  function addDias(date, dias) {
    const d = new Date(date)
    d.setDate(d.getDate() + dias)
    return d
  }

  const startProyecto = new Date(fechaBase + 'T00:00:00')

  for (const id of order) {
    const t = tareaMap[id]
    const pList = depsMap[id] || []
    let inicio
    if (pList.length === 0) {
      inicio = new Date(startProyecto)
    } else {
      const maxFin = pList.reduce((mx, pid) => {
        const f = finCalc[pid]
        return f && f > mx ? f : mx
      }, startProyecto)
      inicio = addDias(maxFin, 1)
    }
    const fin = addDias(inicio, (t.duracion_dias || 1) - 1)
    iniCalc[id] = inicio
    finCalc[id] = fin
  }

  const upd = db.prepare('UPDATE proyecto_tarea SET fecha_inicio_calc=?, fecha_fin_calc=? WHERE id=?')
  const toISO = d => d.toISOString().slice(0, 10)
  for (const id of order) {
    upd.run(toISO(iniCalc[id]), toISO(finCalc[id]), id)
  }
}

// ── GET todas las tareas de un proyecto ───────────────────────────────────────
router.get('/proyecto/:proyectoId/tareas', (req, res) => {
  const { proyectoId } = req.params
  const tareas = db.prepare('SELECT * FROM proyecto_tarea WHERE proyecto_id=? ORDER BY orden, id').all(proyectoId)

  const preds = db.prepare(`
    SELECT tarea_id, predecesora_id FROM proyecto_tarea_predecesora
    WHERE tarea_id IN (SELECT id FROM proyecto_tarea WHERE proyecto_id=?)
  `).all(proyectoId)

  const predMap = {}
  preds.forEach(p => {
    if (!predMap[p.tarea_id]) predMap[p.tarea_id] = []
    predMap[p.tarea_id].push(p.predecesora_id)
  })

  tareas.forEach(t => { t.predecesoras = predMap[t.id] || [] })
  res.json(tareas)
})

// ── POST nueva tarea ──────────────────────────────────────────────────────────
router.post('/proyecto/:proyectoId/tareas', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { proyectoId } = req.params
  const { nombre, duracion_dias, responsable, estado, avance, color, observaciones, predecesoras = [], insertarEnPosicion } = req.body

  let orden
  if (insertarEnPosicion !== undefined && insertarEnPosicion !== null) {
    db.prepare('UPDATE proyecto_tarea SET orden = orden + 1 WHERE proyecto_id=? AND orden >= ?')
      .run(proyectoId, insertarEnPosicion)
    orden = insertarEnPosicion
  } else {
    const maxOrden = db.prepare('SELECT MAX(orden) as m FROM proyecto_tarea WHERE proyecto_id=?').get(proyectoId)
    orden = (maxOrden?.m || 0) + 1
  }

  const r = db.prepare(`
    INSERT INTO proyecto_tarea (proyecto_id, orden, nombre, duracion_dias, responsable, estado, avance, color, observaciones)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(proyectoId, orden, nombre || 'Nueva tarea', duracion_dias || 1, responsable || '', estado || 'Pendiente', avance || 0, color || '', observaciones || '')

  const id = r.lastInsertRowid
  const insPred = db.prepare('INSERT OR IGNORE INTO proyecto_tarea_predecesora (tarea_id, predecesora_id) VALUES (?,?)')
  predecesoras.forEach(pid => { if (pid !== id) insPred.run(id, pid) })

  recalcularFechas(proyectoId)
  res.status(201).json({ id, orden })
})

// ── Detecta si agregar "tareaId depende de candidatoPid" cerraría un ciclo ────
// (es decir, si candidatoPid ya depende, directa o transitivamente, de tareaId)
function creariaCiclo(tareaId, candidatoPid) {
  const visitado = new Set()
  const queue = [candidatoPid]
  while (queue.length) {
    const actual = queue.shift()
    if (String(actual) === String(tareaId)) return true
    if (visitado.has(String(actual))) continue
    visitado.add(String(actual))
    const preds = db.prepare('SELECT predecesora_id FROM proyecto_tarea_predecesora WHERE tarea_id=?').all(actual)
    preds.forEach(p => queue.push(p.predecesora_id))
  }
  return false
}

// ── PUT actualizar tarea ──────────────────────────────────────────────────────
router.put('/proyecto/:proyectoId/tareas/:tareaId', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { proyectoId, tareaId } = req.params
  const { nombre, duracion_dias, responsable, estado, avance, color, observaciones, predecesoras } = req.body

  db.prepare(`
    UPDATE proyecto_tarea SET nombre=?, duracion_dias=?, responsable=?, estado=?, avance=?, color=?, observaciones=?
    WHERE id=? AND proyecto_id=?
  `).run(nombre || '', duracion_dias || 1, responsable || '', estado || 'Pendiente', avance ?? 0, color || '', observaciones || '', tareaId, proyectoId)

  let ciclosEvitados = 0
  if (Array.isArray(predecesoras)) {
    db.prepare('DELETE FROM proyecto_tarea_predecesora WHERE tarea_id=?').run(tareaId)
    const ins = db.prepare('INSERT OR IGNORE INTO proyecto_tarea_predecesora (tarea_id, predecesora_id) VALUES (?,?)')
    predecesoras.forEach(pid => {
      if (String(pid) === String(tareaId)) return
      if (creariaCiclo(tareaId, pid)) { ciclosEvitados++; return }
      ins.run(tareaId, pid)
    })
  }

  recalcularFechas(proyectoId)
  res.json({ ok: true, ciclosEvitados })
})

// ── PUT reordenar tareas ──────────────────────────────────────────────────────
router.put('/proyecto/:proyectoId/reordenar', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { proyectoId } = req.params
  const { ids } = req.body
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids requerido' })

  const upd = db.prepare('UPDATE proyecto_tarea SET orden=? WHERE id=? AND proyecto_id=?')
  ids.forEach((id, i) => upd.run(i + 1, id, proyectoId))
  recalcularFechas(proyectoId)
  res.json({ ok: true })
})

// ── DELETE tarea ──────────────────────────────────────────────────────────────
router.delete('/proyecto/:proyectoId/tareas/:tareaId', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { proyectoId, tareaId } = req.params
  db.prepare('DELETE FROM proyecto_tarea WHERE id=? AND proyecto_id=?').run(tareaId, proyectoId)
  recalcularFechas(proyectoId)
  res.json({ ok: true })
})

// ── POST recalcular ───────────────────────────────────────────────────────────
router.post('/proyecto/:proyectoId/recalcular', (req, res) => {
  recalcularFechas(req.params.proyectoId)
  res.json({ ok: true })
})

// ══ PLANTILLA SETS (plantillas nombradas) ════════════════════════════════════

// GET /gantt/plantilla-sets — listar todos los sets con conteo de tareas
router.get('/plantilla-sets', (req, res) => {
  const sets = db.prepare(`
    SELECT s.id, s.nombre, s.descripcion, s.created_at,
           COUNT(t.id) AS total_tareas,
           SUM(CASE WHEN t.es_grupo=0 THEN 1 ELSE 0 END) AS tareas_reales
    FROM gantt_plantilla_set s
    LEFT JOIN gantt_plantilla_tarea t ON t.plantilla_set_id = s.id
    GROUP BY s.id
    ORDER BY s.nombre
  `).all()
  res.json(sets)
})

// POST /gantt/plantilla-sets — crear set vacío
router.post('/plantilla-sets', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { nombre, descripcion = '' } = req.body
  if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido' })
  const r = db.prepare('INSERT INTO gantt_plantilla_set (nombre, descripcion) VALUES (?,?)').run(nombre.trim(), descripcion)
  res.status(201).json({ id: r.lastInsertRowid })
})

// PUT /gantt/plantilla-sets/:id — renombrar/editar
router.put('/plantilla-sets/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { nombre, descripcion = '' } = req.body
  db.prepare('UPDATE gantt_plantilla_set SET nombre=?, descripcion=? WHERE id=?').run(nombre || '', descripcion, req.params.id)
  res.json({ ok: true })
})

// POST /gantt/plantilla-sets/:id/duplicar — copiar set con nuevo nombre
router.post('/plantilla-sets/:id/duplicar', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { nombre } = req.body
  if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido' })

  const orig = db.prepare('SELECT * FROM gantt_plantilla_set WHERE id=?').get(req.params.id)
  if (!orig) return res.status(404).json({ error: 'Plantilla no encontrada' })

  const nuevo = db.prepare('INSERT INTO gantt_plantilla_set (nombre, descripcion) VALUES (?,?)').run(nombre.trim(), orig.descripcion || '')
  const nuevoId = nuevo.lastInsertRowid

  const tareas = db.prepare('SELECT * FROM gantt_plantilla_tarea WHERE plantilla_set_id=? ORDER BY orden').all(req.params.id)
  const ins = db.prepare('INSERT INTO gantt_plantilla_tarea (nombre, duracion_dias, es_grupo, origen, color, grupo, orden, plantilla_set_id) VALUES (?,?,?,?,?,?,?,?)')
  for (const t of tareas) {
    ins.run(t.nombre, t.duracion_dias, t.es_grupo, 'custom', t.color || '', t.grupo || '', t.orden, nuevoId)
  }

  res.status(201).json({ id: nuevoId, copiadas: tareas.length })
})

// DELETE /gantt/plantilla-sets/:id — eliminar set + sus tareas
router.delete('/plantilla-sets/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  db.prepare('DELETE FROM gantt_plantilla_tarea WHERE plantilla_set_id=?').run(req.params.id)
  db.prepare('DELETE FROM gantt_plantilla_set WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

// ══ PLANTILLA TAREAS ═════════════════════════════════════════════════════════

// GET /gantt/plantilla?set_id=X — tareas de un set (null = legacy global)
router.get('/plantilla', (req, res) => {
  const { set_id } = req.query
  const tareas = set_id
    ? db.prepare('SELECT * FROM gantt_plantilla_tarea WHERE plantilla_set_id=? ORDER BY orden').all(set_id)
    : db.prepare('SELECT * FROM gantt_plantilla_tarea WHERE plantilla_set_id IS NULL ORDER BY orden').all()
  res.json(tareas)
})

// POST /gantt/plantilla — crear tarea de plantilla
router.post('/plantilla', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { nombre, duracion_dias, es_grupo, origen, color, grupo, set_id } = req.body
  const sid = set_id || null
  const maxOrden = sid
    ? db.prepare('SELECT MAX(orden) as m FROM gantt_plantilla_tarea WHERE plantilla_set_id=?').get(sid)
    : db.prepare('SELECT MAX(orden) as m FROM gantt_plantilla_tarea WHERE plantilla_set_id IS NULL').get()
  const orden = (maxOrden?.m || 0) + 1
  const r = db.prepare(
    'INSERT INTO gantt_plantilla_tarea (nombre, duracion_dias, es_grupo, origen, color, grupo, orden, plantilla_set_id) VALUES (?,?,?,?,?,?,?,?)'
  ).run(nombre || 'Nueva tarea', duracion_dias || 1, es_grupo ? 1 : 0, origen || 'custom', color || '', grupo || '', orden, sid)
  res.status(201).json({ id: r.lastInsertRowid, orden })
})

// PUT /gantt/plantilla/reordenar — ANTES del PUT /:id
router.put('/plantilla/reordenar', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { ids } = req.body
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids requerido' })
  const upd = db.prepare('UPDATE gantt_plantilla_tarea SET orden=? WHERE id=?')
  ids.forEach((id, i) => upd.run(i + 1, id))
  res.json({ ok: true })
})

// PUT /gantt/plantilla/:id
router.put('/plantilla/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { nombre, duracion_dias, es_grupo, origen, color, grupo } = req.body
  db.prepare(
    'UPDATE gantt_plantilla_tarea SET nombre=?, duracion_dias=?, es_grupo=?, origen=?, color=?, grupo=? WHERE id=?'
  ).run(nombre || '', duracion_dias || 1, es_grupo ? 1 : 0, origen || 'custom', color || '', grupo || '', req.params.id)
  res.json({ ok: true })
})

// DELETE /gantt/plantilla/:id
router.delete('/plantilla/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  db.prepare('DELETE FROM gantt_plantilla_tarea WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

// ── POST cargar plantilla en proyecto ─────────────────────────────────────────
// set_id → cargar desde plantilla nombrada; sin set_id → legacy global con filtro
router.post('/proyecto/:proyectoId/cargar-plantilla', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { proyectoId } = req.params
  const { reemplazar = false, filtro = 'todos', set_id } = req.body

  if (reemplazar) {
    db.prepare('DELETE FROM proyecto_tarea WHERE proyecto_id=?').run(proyectoId)
  }

  const maxOrden = db.prepare('SELECT MAX(orden) as m FROM proyecto_tarea WHERE proyecto_id=?').get(proyectoId)
  let nextOrden = (maxOrden?.m || 0) + 1

  let plantilla
  if (set_id) {
    plantilla = db.prepare('SELECT * FROM gantt_plantilla_tarea WHERE plantilla_set_id=? ORDER BY orden').all(set_id)
  } else {
    plantilla = db.prepare('SELECT * FROM gantt_plantilla_tarea WHERE plantilla_set_id IS NULL ORDER BY orden').all()
    if (filtro !== 'todos') plantilla = plantilla.filter(t => t.origen === filtro)
  }

  const ins = db.prepare(`
    INSERT INTO proyecto_tarea (proyecto_id, orden, nombre, duracion_dias, estado, color, observaciones)
    VALUES (?,?,?,?,?,?,?)
  `)
  for (const t of plantilla) {
    ins.run(proyectoId, nextOrden++, t.nombre, t.es_grupo ? 0 : t.duracion_dias, 'Pendiente', t.color || '', t.es_grupo ? '— sección —' : '')
  }

  recalcularFechas(proyectoId)
  res.json({ ok: true, insertadas: plantilla.length })
})

// ── POST guardar tareas de proyecto como plantilla ────────────────────────────
// set_nombre → crea nuevo set con ese nombre
// set_id     → agrega a set existente (con reemplazar=true limpia el set primero)
// sin ninguno → legacy global
router.post('/proyecto/:proyectoId/guardar-plantilla', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { proyectoId } = req.params
  const { set_nombre, set_id, descripcion = '', reemplazar = false, grupo = '' } = req.body

  let setId = set_id ? Number(set_id) : null

  if (set_nombre?.trim()) {
    const r = db.prepare('INSERT INTO gantt_plantilla_set (nombre, descripcion) VALUES (?,?)').run(set_nombre.trim(), descripcion)
    setId = r.lastInsertRowid
  } else if (reemplazar) {
    if (setId) {
      db.prepare('DELETE FROM gantt_plantilla_tarea WHERE plantilla_set_id=?').run(setId)
    } else {
      db.prepare("DELETE FROM gantt_plantilla_tarea WHERE origen='custom' OR origen='proyecto'").run()
    }
  }

  const tareas = db.prepare('SELECT * FROM proyecto_tarea WHERE proyecto_id=? ORDER BY orden').all(proyectoId)
  const maxOrden = setId
    ? db.prepare('SELECT MAX(orden) as m FROM gantt_plantilla_tarea WHERE plantilla_set_id=?').get(setId)
    : db.prepare('SELECT MAX(orden) as m FROM gantt_plantilla_tarea WHERE plantilla_set_id IS NULL').get()
  let nextOrden = (maxOrden?.m || 0) + 1

  const ins = db.prepare(
    'INSERT INTO gantt_plantilla_tarea (nombre, duracion_dias, es_grupo, origen, color, grupo, orden, plantilla_set_id) VALUES (?,?,?,?,?,?,?,?)'
  )
  for (const t of tareas) {
    const esGrupo = (!t.duracion_dias || t.duracion_dias === 0) ? 1 : 0
    ins.run(t.nombre, t.duracion_dias || 1, esGrupo, 'proyecto', t.color || '', grupo, nextOrden++, setId)
  }

  res.json({ ok: true, insertadas: tareas.length, set_id: setId })
})

module.exports = router
