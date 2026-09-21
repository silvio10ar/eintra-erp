'use strict'
const express = require('express')
const { db } = require('../db/database')
const { verificarToken } = require('../middleware/auth')
const { encontrarRaiz } = require('../helpers/organigrama')

const router = express.Router()
router.use(verificarToken)
// El cache de abajo (cachePuestosPorEmpleado) está pensado como "memoizado
// por request" según su propio comentario, pero al vivir a nivel de módulo
// persiste entre requests salvo que algo lo limpie — antes solo GET
// /mis-tareas lo hacía, así que PATCH /tareas/:id podía autorizar con datos
// de organigrama de un request anterior (ej. un gerente reasignado que
// todavía figuraba como jefe de alguien hasta el próximo GET /mis-tareas).
// Limpiarlo acá, una vez por request para TODAS las rutas del archivo, es lo
// que hace que sea de verdad "por request" y no dependa de qué ruta se pegue primero.
router.use((req, res, next) => { cachePuestosPorEmpleado.clear(); next() })
// Sin gate de módulo, a propósito: cualquier usuario autenticado tiene que
// poder ver y marcar las tareas de las que es responsable (o que gestiona
// como superior), sin que un admin tenga que asignarle un permiso aparte —
// mismo criterio que /rrhh/proyectos y /rrhh/actividades para "Mi Parte".
// La autorización real es por dato (puedeVerTarea, más abajo), no por módulo.

// Una tarea la ve: la persona responsable asignada (por nombre, igual que se
// carga en el Plan del proyecto), y cualquier puesto por ARRIBA de ella en el
// organigrama — su jefe directo, el jefe de su jefe, etc., cuántos niveles
// haga falta — mismo criterio "hacia abajo, nunca hacia arriba" que ya usa el
// resto del sistema para heredar permisos de módulo (ver getPermisosEfectivos
// en middleware/auth.js). Si la persona responsable no tiene un usuario
// propio en el sistema (no se la puede ubicar en el organigrama), se cae al
// criterio más simple: el gerente de la gerencia (área_responsable) cargada
// a mano en la tarea.

// ¿"ancestroId" es el propio puesto "puestoId", o alguno de los que están
// arriba en su cadena de reporta_a_id?
function esAncestroOMismo(ancestroId, puestoId, porId) {
  let actual = porId.get(puestoId)
  const visitados = new Set()
  while (actual) {
    if (actual.id === ancestroId) return true
    if (visitados.has(actual.id)) break
    visitados.add(actual.id)
    actual = actual.reporta_a_id != null ? porId.get(actual.reporta_a_id) : null
  }
  return false
}

const cachePuestosPorEmpleado = new Map() // nombre → puesto_ids, memoizado por request
function puestosDeEmpleadoPorNombre(nombre) {
  if (!nombre) return []
  if (cachePuestosPorEmpleado.has(nombre)) return cachePuestosPorEmpleado.get(nombre)
  const ids = db.prepare(`
    SELECT up.puesto_id FROM usuario_puestos up
    JOIN usuarios u ON u.id = up.usuario_id
    JOIN rrhh_empleados e ON e.id = u.rrhh_empleado_id
    WHERE e.nombre = ?
  `).all(nombre).map(r => r.puesto_id)
  cachePuestosPorEmpleado.set(nombre, ids)
  return ids
}

function resolverContexto(usuarioId) {
  const empleado = db.prepare(`
    SELECT e.nombre FROM usuarios u JOIN rrhh_empleados e ON e.id = u.rrhh_empleado_id WHERE u.id = ?
  `).get(usuarioId)
  const empleadoNombre = empleado?.nombre || null

  const puestoIds = db.prepare('SELECT puesto_id FROM usuario_puestos WHERE usuario_id=?').all(usuarioId).map(r => r.puesto_id)

  const puestos = db.prepare('SELECT id, nombre, area, reporta_a_id FROM puestos ORDER BY id').all()
  const porId = new Map(puestos.map(p => [p.id, p]))
  const raiz = encontrarRaiz(puestos)
  const gerencias = raiz
    ? [raiz, ...puestos.filter(p => p.reporta_a_id === raiz.id)].map(g => ({ id: g.id, area: g.area?.trim() || g.nombre }))
    : []
  const gerenciasQueGestiona = gerencias.filter(g => puestoIds.includes(g.id)).map(g => g.area)

  return { empleadoNombre, puestoIds, gerenciasQueGestiona, porId }
}

function puedeVerTareaConContexto(ctx, tarea) {
  if (ctx.empleadoNombre && tarea.responsable === ctx.empleadoNombre) return true
  if (tarea.area_responsable && ctx.gerenciasQueGestiona.includes(tarea.area_responsable)) return true
  if (tarea.responsable && ctx.puestoIds.length) {
    const puestosResponsable = puestosDeEmpleadoPorNombre(tarea.responsable)
    for (const pr of puestosResponsable) {
      for (const mio of ctx.puestoIds) {
        if (esAncestroOMismo(mio, pr, ctx.porId)) return true
      }
    }
  }
  return false
}

function puedeVerTarea(req, tarea) {
  if (req.usuario.rol === 'admin') return true
  return puedeVerTareaConContexto(resolverContexto(req.usuario.id), tarea)
}

// ── GET mis tareas: las mías + las de la gente que reporta hacia mí ───────────
router.get('/mis-tareas', (req, res) => {
  let tareas = db.prepare(`
    SELECT t.*, p.codigo AS proyecto_codigo, p.nombre AS proyecto_nombre
    FROM proyecto_tarea t JOIN proyectos p ON p.id = t.proyecto_id
    WHERE p.codigo NOT LIKE 'HIST-%' AND p.codigo NOT LIKE 'PROV-%'
    ORDER BY t.fecha_inicio_calc, t.id
  `).all()

  if (req.usuario.rol !== 'admin') {
    // El cache ya se limpia una vez por request en el middleware de arriba.
    const ctx = resolverContexto(req.usuario.id)
    tareas = tareas.filter(t => puedeVerTareaConContexto(ctx, t))
  }
  res.json(tareas)
})

// Mismos 5 estados que ya usa el Plan/Gantt del proyecto (PlanGantt.jsx) —
// para no inventar una semántica de estado paralela entre las dos pantallas
// que tocan la misma tabla.
const ESTADOS_VALIDOS = ['Pendiente', 'En proceso', 'Completado', 'Cancelado', 'Bloqueado']

// ── PATCH actualizar estado y observaciones de una tarea ─────────────────────
// Desde "Mis Tareas" no se expone el % de avance como número editable (eso
// queda para el gerente en Plan/Gantt) — acá solo se auto-ajusta a los
// extremos cuando el estado pasa a Completado o vuelve a Pendiente, mismo
// comportamiento que tenía el checkbox que reemplaza este endpoint.
router.patch('/tareas/:id', (req, res) => {
  const tarea = db.prepare('SELECT * FROM proyecto_tarea WHERE id=?').get(req.params.id)
  if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' })
  if (!puedeVerTarea(req, tarea)) return res.status(403).json({ error: 'Sin permisos sobre esta tarea' })

  const { estado, observaciones } = req.body
  if (!ESTADOS_VALIDOS.includes(estado)) return res.status(400).json({ error: 'Estado inválido' })

  let avance = tarea.avance
  if (estado === 'Completado') avance = 100
  else if (estado === 'Pendiente') avance = 0

  db.prepare(`UPDATE proyecto_tarea SET estado=?, avance=?, observaciones=? WHERE id=?`)
    .run(estado, avance, observaciones ?? tarea.observaciones ?? '', tarea.id)
  res.json(db.prepare('SELECT * FROM proyecto_tarea WHERE id=?').get(tarea.id))
})

module.exports = router
