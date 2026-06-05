const express = require('express');
const { body, validationResult } = require('express-validator');
const { db }  = require('../db/database');
const { verificarToken, ESCRITURA_PRODUCCION } = require('../middleware/auth');

const router = express.Router();

function nextNumeroOT() {
  const r = db.prepare("SELECT numero FROM ordenes_trabajo ORDER BY CAST(numero AS INTEGER) DESC LIMIT 1").get();
  if (r) { try { return String(parseInt(r.numero)+1).padStart(6,'0'); } catch(_) {} }
  return '000001';
}

// ── Órdenes de Trabajo ────────────────────────────────────────────────────────

router.get('/', verificarToken, (req, res) => {
  const { estado, prioridad, proyecto_id, buscar, page=1, limit=50 } = req.query;
  const conds=[], params=[];
  if (estado)      { conds.push('ot.estado=?');       params.push(estado); }
  if (prioridad)   { conds.push('ot.prioridad=?');    params.push(prioridad); }
  if (proyecto_id) { conds.push('ot.proyecto_id=?');  params.push(proyecto_id); }
  if (buscar)      { conds.push('(ot.numero LIKE ? OR ot.descripcion LIKE ?)'); params.push(`%${buscar}%`,`%${buscar}%`); }
  const where  = conds.length ? 'WHERE '+conds.join(' AND ') : '';
  const offset = (parseInt(page)-1)*parseInt(limit);
  const total  = db.prepare(`SELECT COUNT(*) as c FROM ordenes_trabajo ot ${where}`).get(...params).c;
  const datos  = db.prepare(`
    SELECT ot.*,
           COUNT(t.id) as total_tareas,
           SUM(CASE WHEN t.estado='Completada' THEN 1 ELSE 0 END) as tareas_ok,
           COALESCE(SUM(p.horas),0) as total_horas
    FROM ordenes_trabajo ot
    LEFT JOIN ot_tareas t ON t.ot_id=ot.id
    LEFT JOIN ot_partes p ON p.ot_id=ot.id
    ${where} GROUP BY ot.id ORDER BY ot.id DESC LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);
  res.json({ total, datos });
});

router.get('/:id', verificarToken, (req, res) => {
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
    const r = db.prepare('INSERT INTO ordenes_trabajo (numero,descripcion,proyecto_id,proyecto_nombre,responsable,fecha_apertura,fecha_inicio,fecha_fin_est,estado,prioridad,observaciones,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(nextNumeroOT(), descripcion, proyecto_id||null, proyecto_nombre||'', responsable||'',
           fecha_apertura||new Date().toISOString().slice(0,10), fecha_inicio||'', fecha_fin_est||'',
           estado||'Pendiente', prioridad||'Normal', observaciones||'', req.usuario.id);
    res.status(201).json(db.prepare('SELECT * FROM ordenes_trabajo WHERE id=?').get(r.lastInsertRowid));
  }
);

router.put('/:id', verificarToken, (req, res) => {
  if (!req.permisos?.produccion?.escribir) return res.status(403).json({ error: 'Sin permisos' });
  const ot = db.prepare('SELECT * FROM ordenes_trabajo WHERE id=?').get(req.params.id);
  if (!ot) return res.status(404).json({ error: 'No encontrada' });
  const { descripcion, proyecto_id, proyecto_nombre, responsable, fecha_apertura, fecha_inicio, fecha_fin_est, fecha_cierre, estado, prioridad, observaciones } = req.body;
  const fechaCierre = estado === 'Completada' && !ot.fecha_cierre ? new Date().toISOString().slice(0,10) : fecha_cierre ?? ot.fecha_cierre;
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
  const fecha = nuevo === 'Completada' ? new Date().toISOString().slice(0,10) : '';
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
    .run(req.params.id, fecha||new Date().toISOString().slice(0,10), operario||'', parseFloat(horas)||0, descripcion||'', observaciones||'');
  res.status(201).json(db.prepare('SELECT * FROM ot_partes WHERE id=?').get(r.lastInsertRowid));
});

router.put('/:id/partes/:parte_id', verificarToken, (req, res) => {
  if (!req.permisos?.produccion?.escribir) return res.status(403).json({ error: 'Sin permisos' });
  const { fecha, operario, horas, descripcion, observaciones } = req.body;
  db.prepare('UPDATE ot_partes SET fecha=?,operario=?,horas=?,descripcion=?,observaciones=? WHERE id=? AND ot_id=?')
    .run(fecha, operario, parseFloat(horas)||0, descripcion||'', observaciones||'', req.params.parte_id, req.params.id);
  res.json(db.prepare('SELECT * FROM ot_partes WHERE id=?').get(req.params.parte_id));
});

router.delete('/:id/partes/:parte_id', verificarToken, (req, res) => {
  if (!req.permisos?.produccion?.escribir) return res.status(403).json({ error: 'Sin permisos' });
  db.prepare('DELETE FROM ot_partes WHERE id=? AND ot_id=?').run(req.params.parte_id, req.params.id);
  res.json({ mensaje: 'Parte eliminado' });
});

module.exports = router;
