const express = require('express');
const { body, validationResult } = require('express-validator');
const { db }  = require('../db/database');
const { verificarToken, puede } = require('../middleware/auth');
const { buscarCondicion } = require('../helpers/buscar');
const { hoyArgentina } = require('../helpers/fecha');

const router = express.Router();
const leerProduccion = puede.leer('produccion');

function nextNumeroOT() {
  const r = db.prepare("SELECT numero FROM ordenes_trabajo ORDER BY CAST(numero AS INTEGER) DESC LIMIT 1").get();
  if (r) { try { return String(parseInt(r.numero)+1).padStart(6,'0'); } catch(_) {} }
  return '000001';
}

// ── Órdenes de Trabajo ────────────────────────────────────────────────────────

router.get('/', verificarToken, leerProduccion, (req, res) => {
  const { estado, prioridad, proyecto_id, buscar, page=1, limit=50 } = req.query;
  const conds=[], params=[];
  if (estado)      { conds.push('ot.estado=?');       params.push(estado); }
  if (prioridad)   { conds.push('ot.prioridad=?');    params.push(prioridad); }
  if (proyecto_id) { conds.push('ot.proyecto_id=?');  params.push(proyecto_id); }
  if (buscar)      { const b = buscarCondicion(buscar, ['ot.numero','ot.descripcion']); conds.push(b.cond); params.push(...b.params); }
  const where  = conds.length ? 'WHERE '+conds.join(' AND ') : '';
  const offset = (parseInt(page)-1)*parseInt(limit);
  const total  = db.prepare(`SELECT COUNT(*) as c FROM ordenes_trabajo ot ${where}`).get(...params).c;
  // Subqueries en vez de LEFT JOIN a ot_tareas + ot_partes a la vez: unir ambas
  // tablas directamente generaba un producto cruzado (fan-out) que multiplicaba
  // los conteos y la suma de horas cuando una OT tenía más de una fila en cada.
  const datos  = db.prepare(`
    SELECT ot.*,
           (SELECT COUNT(*) FROM ot_tareas WHERE ot_id=ot.id) as total_tareas,
           (SELECT COUNT(*) FROM ot_tareas WHERE ot_id=ot.id AND estado='Completada') as tareas_ok,
           (SELECT COALESCE(SUM(horas),0) FROM ot_partes WHERE ot_id=ot.id) as total_horas
    FROM ordenes_trabajo ot
    ${where} ORDER BY ot.id DESC LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);
  res.json({ total, datos });
});

router.get('/:id', verificarToken, leerProduccion, (req, res) => {
  const ot = db.prepare('SELECT * FROM ordenes_trabajo WHERE id=?').get(req.params.id);
  if (!ot) return res.status(404).json({ error: 'OT no encontrada' });
  const tareas = db.prepare('SELECT * FROM ot_tareas WHERE ot_id=? ORDER BY orden,id').all(ot.id);
  const partes = db.prepare('SELECT * FROM ot_partes WHERE ot_id=? ORDER BY fecha DESC,id DESC').all(ot.id);
  const totalHoras = partes.reduce((s,p)=>s+p.horas,0);
  res.json({ ...ot, tareas, partes, total_horas: totalHoras });
});

router.post('/', verificarToken,
  body('descripcion').trim().notEmpty(),
  (req, res) => {
    if (!req.permisos?.produccion?.escribir) return res.status(403).json({ error: 'Sin permisos' });
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() });
    const { descripcion, proyecto_id, proyecto_nombre, responsable, fecha_apertura, fecha_inicio, fecha_fin_est, estado, prioridad, observaciones } = req.body;
    // Leer el próximo número y usarlo en el INSERT como una sola transacción —
    // sin esto, dos altas casi simultáneas podrían leer el mismo máximo y
    // terminar con el mismo número (no pasa hoy con un solo proceso Node
    // síncrono, pero deja la garantía puesta para cualquier cambio futuro).
    const r = db.transaction(() =>
      db.prepare('INSERT INTO ordenes_trabajo (numero,descripcion,proyecto_id,proyecto_nombre,responsable,fecha_apertura,fecha_inicio,fecha_fin_est,estado,prioridad,observaciones,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(nextNumeroOT(), descripcion, proyecto_id||null, proyecto_nombre||'', responsable||'',
             fecha_apertura||hoyArgentina(), fecha_inicio||'', fecha_fin_est||'',
             estado||'Pendiente', prioridad||'Normal', observaciones||'', req.usuario.id)
    )();
    res.status(201).json(db.prepare('SELECT * FROM ordenes_trabajo WHERE id=?').get(r.lastInsertRowid));
  }
);

router.put('/:id', verificarToken, (req, res) => {
  if (!req.permisos?.produccion?.escribir) return res.status(403).json({ error: 'Sin permisos' });
  const ot = db.prepare('SELECT * FROM ordenes_trabajo WHERE id=?').get(req.params.id);
  if (!ot) return res.status(404).json({ error: 'No encontrada' });
  const { descripcion, proyecto_id, proyecto_nombre, responsable, fecha_apertura, fecha_inicio, fecha_fin_est, fecha_cierre, estado, prioridad, observaciones } = req.body;
  const fechaCierre = estado === 'Completada' && !ot.fecha_cierre ? hoyArgentina() : fecha_cierre ?? ot.fecha_cierre;
  db.prepare(`UPDATE ordenes_trabajo SET descripcion=?,proyecto_id=?,proyecto_nombre=?,responsable=?,fecha_apertura=?,fecha_inicio=?,fecha_fin_est=?,fecha_cierre=?,estado=?,prioridad=?,observaciones=?,updated_at=datetime('now','localtime') WHERE id=?`)
    .run(descripcion??ot.descripcion, proyecto_id??ot.proyecto_id, proyecto_nombre??ot.proyecto_nombre,
         responsable??ot.responsable, fecha_apertura??ot.fecha_apertura, fecha_inicio??ot.fecha_inicio,
         fecha_fin_est??ot.fecha_fin_est, fechaCierre, estado??ot.estado, prioridad??ot.prioridad,
         observaciones??ot.observaciones, req.params.id);
  res.json(db.prepare('SELECT * FROM ordenes_trabajo WHERE id=?').get(req.params.id));
});

router.delete('/:id', verificarToken, (req, res) => {
  if (!req.permisos?.produccion?.escribir) return res.status(403).json({ error: 'Sin permisos' });
  db.prepare('DELETE FROM ot_tareas WHERE ot_id=?').run(req.params.id);
  db.prepare('DELETE FROM ot_partes WHERE ot_id=?').run(req.params.id);
  db.prepare('DELETE FROM ordenes_trabajo WHERE id=?').run(req.params.id);
  res.json({ mensaje: 'OT eliminada' });
});

// ── Tareas ─────────────────────────────────────────────────────────────────────

router.post('/:id/tareas', verificarToken, (req, res) => {
  if (!req.permisos?.produccion?.escribir) return res.status(403).json({ error: 'Sin permisos' });
  const { descripcion, responsable } = req.body;
  if (!descripcion?.trim()) return res.status(400).json({ error: 'Descripción requerida' });
  const maxOrden = db.prepare('SELECT COALESCE(MAX(orden),0) as m FROM ot_tareas WHERE ot_id=?').get(req.params.id).m;
  const r = db.prepare('INSERT INTO ot_tareas (ot_id,orden,descripcion,responsable) VALUES (?,?,?,?)')
    .run(req.params.id, maxOrden+1, descripcion.trim(), responsable||'');
  res.status(201).json(db.prepare('SELECT * FROM ot_tareas WHERE id=?').get(r.lastInsertRowid));
});

router.put('/:id/tareas/:tarea_id/toggle', verificarToken, (req, res) => {
  if (!req.permisos?.produccion?.escribir) return res.status(403).json({ error: 'Sin permisos' });
  const t = db.prepare('SELECT * FROM ot_tareas WHERE id=? AND ot_id=?').get(req.params.tarea_id, req.params.id);
  if (!t) return res.status(404).json({ error: 'No encontrada' });
  const nuevo = t.estado === 'Completada' ? 'Pendiente' : 'Completada';
  const fecha = nuevo === 'Completada' ? hoyArgentina() : '';
  db.prepare('UPDATE ot_tareas SET estado=?,fecha_completado=? WHERE id=?').run(nuevo, fecha, t.id);
  res.json(db.prepare('SELECT * FROM ot_tareas WHERE id=?').get(t.id));
});

router.delete('/:id/tareas/:tarea_id', verificarToken, (req, res) => {
  if (!req.permisos?.produccion?.escribir) return res.status(403).json({ error: 'Sin permisos' });
  db.prepare('DELETE FROM ot_tareas WHERE id=? AND ot_id=?').run(req.params.tarea_id, req.params.id);
  res.json({ mensaje: 'Tarea eliminada' });
});

// ── Partes diarios ─────────────────────────────────────────────────────────────

router.post('/:id/partes', verificarToken, (req, res) => {
  if (!req.permisos?.produccion?.escribir) return res.status(403).json({ error: 'Sin permisos' });
  const { fecha, operario, horas, descripcion, observaciones } = req.body;
  const r = db.prepare('INSERT INTO ot_partes (ot_id,fecha,operario,horas,descripcion,observaciones) VALUES (?,?,?,?,?,?)')
    .run(req.params.id, fecha||hoyArgentina(), operario||'', parseFloat(horas)||0, descripcion||'', observaciones||'');
  res.status(201).json(db.prepare('SELECT * FROM ot_partes WHERE id=?').get(r.lastInsertRowid));
});

router.put('/:id/partes/:parte_id', verificarToken, (req, res) => {
  if (!req.permisos?.produccion?.escribir) return res.status(403).json({ error: 'Sin permisos' });
  const parte = db.prepare('SELECT id FROM ot_partes WHERE id=? AND ot_id=?').get(req.params.parte_id, req.params.id);
  if (!parte) return res.status(404).json({ error: 'Parte no encontrado en esta OT' });
  const { fecha, operario, horas, descripcion, observaciones } = req.body;
  db.prepare('UPDATE ot_partes SET fecha=?,operario=?,horas=?,descripcion=?,observaciones=? WHERE id=?')
    .run(fecha, operario, parseFloat(horas)||0, descripcion||'', observaciones||'', parte.id);
  res.json(db.prepare('SELECT * FROM ot_partes WHERE id=?').get(parte.id));
});

router.delete('/:id/partes/:parte_id', verificarToken, (req, res) => {
  if (!req.permisos?.produccion?.escribir) return res.status(403).json({ error: 'Sin permisos' });
  db.prepare('DELETE FROM ot_partes WHERE id=? AND ot_id=?').run(req.params.parte_id, req.params.id);
  res.json({ mensaje: 'Parte eliminado' });
});

module.exports = router;
