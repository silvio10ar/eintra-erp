const express = require('express');
const XLSX    = require('xlsx');
const { body, validationResult } = require('express-validator');
const { db }  = require('../db/database');
const { verificarToken } = require('../middleware/auth');

const router = express.Router();
const puede  = req => req.usuario?.rol === 'admin' || !!(req.permisos?.mantenimiento?.escribir);

function nextNumero() {
  const r = db.prepare("SELECT numero FROM mant_ot ORDER BY id DESC LIMIT 1").get();
  if (r) { try { return 'MNT-' + String(parseInt(r.numero.replace('MNT-',''))+1).padStart(6,'0') } catch(_) {} }
  return 'MNT-000001';
}

function calcProxima(desde, frecuencia) {
  const d = new Date(desde);
  switch(frecuencia) {
    case 'Diario':     d.setDate(d.getDate()+1);         break;
    case 'Semanal':    d.setDate(d.getDate()+7);         break;
    case 'Mensual':    d.setMonth(d.getMonth()+1);       break;
    case 'Trimestral': d.setMonth(d.getMonth()+3);       break;
    case 'Semestral':  d.setMonth(d.getMonth()+6);       break;
    case 'Anual':      d.setFullYear(d.getFullYear()+1); break;
    default:           d.setMonth(d.getMonth()+1);
  }
  return d.toISOString().slice(0,10);
}

// ── ACTIVOS ────────────────────────────────────────────────────────────────────

router.get('/activos', verificarToken, (req, res) => {
  const { buscar, tipo, estado } = req.query;
  const conds = ['activo=1'], params = [];
  if (buscar) { conds.push('(codigo LIKE ? OR nombre LIKE ?)'); params.push(`%${buscar}%`,`%${buscar}%`); }
  if (tipo)   { conds.push('tipo=?');   params.push(tipo); }
  if (estado) { conds.push('estado=?'); params.push(estado); }
  res.json(db.prepare(`SELECT * FROM activos_mant WHERE ${conds.join(' AND ')} ORDER BY nombre`).all(...params));
});

router.post('/activos', verificarToken,
  body('codigo').trim().notEmpty(),
  body('nombre').trim().notEmpty(),
  (req, res) => {
    if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() });
    const { codigo, nombre, tipo, marca, modelo, n_serie, ubicacion, fecha_adq, estado, observaciones } = req.body;
    try {
      const r = db.prepare('INSERT INTO activos_mant (codigo,nombre,tipo,marca,modelo,n_serie,ubicacion,fecha_adq,estado,observaciones) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(codigo, nombre, tipo||'Maquinaria', marca||'', modelo||'', n_serie||'', ubicacion||'', fecha_adq||'', estado||'Activo', observaciones||'');
      res.status(201).json(db.prepare('SELECT * FROM activos_mant WHERE id=?').get(r.lastInsertRowid));
    } catch(e) {
      if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'El código ya existe' });
      throw e;
    }
  }
);

router.put('/activos/:id', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
  const a = db.prepare('SELECT * FROM activos_mant WHERE id=?').get(req.params.id);
  if (!a) return res.status(404).json({ error: 'No encontrado' });
  const { codigo, nombre, tipo, marca, modelo, n_serie, ubicacion, fecha_adq, estado, observaciones } = req.body;
  db.prepare(`UPDATE activos_mant SET codigo=?,nombre=?,tipo=?,marca=?,modelo=?,n_serie=?,ubicacion=?,fecha_adq=?,estado=?,observaciones=?,updated_at=datetime('now','localtime') WHERE id=?`)
    .run(codigo??a.codigo, nombre??a.nombre, tipo??a.tipo, marca??a.marca, modelo??a.modelo,
         n_serie??a.n_serie, ubicacion??a.ubicacion, fecha_adq??a.fecha_adq, estado??a.estado,
         observaciones??a.observaciones, req.params.id);
  res.json(db.prepare('SELECT * FROM activos_mant WHERE id=?').get(req.params.id));
});

router.delete('/activos/:id', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
  db.prepare('UPDATE activos_mant SET activo=0 WHERE id=?').run(req.params.id);
  res.json({ mensaje: 'Activo dado de baja' });
});

// ── ÓRDENES DE TRABAJO ────────────────────────────────────────────────────────

router.get('/ot', verificarToken, (req, res) => {
  const { estado, tipo, prioridad, activo_id, desde, hasta, page=1, limit=50 } = req.query;
  const conds = [], params = [];
  if (estado)    { conds.push('estado=?');         params.push(estado); }
  if (tipo)      { conds.push('tipo=?');            params.push(tipo); }
  if (prioridad) { conds.push('prioridad=?');       params.push(prioridad); }
  if (activo_id) { conds.push('activo_id=?');       params.push(activo_id); }
  if (desde)     { conds.push('fecha_apertura>=?'); params.push(desde); }
  if (hasta)     { conds.push('fecha_apertura<=?'); params.push(hasta); }
  const where  = conds.length ? 'WHERE '+conds.join(' AND ') : '';
  const offset = (parseInt(page)-1)*parseInt(limit);
  const total  = db.prepare(`SELECT COUNT(*) as c FROM mant_ot ${where}`).get(...params).c;
  const datos  = db.prepare(`SELECT * FROM mant_ot ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, parseInt(limit), offset);
  res.json({ total, datos });
});

router.get('/ot/:id', verificarToken, (req, res) => {
  const ot = db.prepare('SELECT * FROM mant_ot WHERE id=?').get(req.params.id);
  if (!ot) return res.status(404).json({ error: 'OT no encontrada' });
  const tareas = db.prepare('SELECT * FROM mant_ot_tareas WHERE ot_id=? ORDER BY orden').all(ot.id);
  const costos = db.prepare('SELECT * FROM mant_ot_costos WHERE ot_id=? ORDER BY id').all(ot.id);
  res.json({ ...ot, tareas, costos });
});

router.post('/ot', verificarToken,
  body('descripcion').trim().notEmpty(),
  (req, res) => {
    if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() });
    const { activo_id, activo_nombre, tipo, prioridad, fecha_apertura, fecha_prog, descripcion, ejecutor_tipo, ejecutor_nombre, observaciones, tareas } = req.body;
    const numero = nextNumero();
    const ot_id = db.transaction(() => {
      const r = db.prepare('INSERT INTO mant_ot (numero,activo_id,activo_nombre,tipo,prioridad,fecha_apertura,fecha_prog,descripcion,ejecutor_tipo,ejecutor_nombre,observaciones,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(numero, activo_id||null, activo_nombre||'', tipo||'Correctivo', prioridad||'Normal',
             fecha_apertura||new Date().toISOString().slice(0,10), fecha_prog||'', descripcion,
             ejecutor_tipo||'interno', ejecutor_nombre||'', observaciones||'', req.usuario.id);
      if (tareas?.length) {
        for (const [i,t] of tareas.entries()) {
          if (!t.descripcion?.trim()) continue;
          db.prepare('INSERT INTO mant_ot_tareas (ot_id,orden,descripcion) VALUES (?,?,?)').run(r.lastInsertRowid, i+1, t.descripcion);
        }
      }
      return r.lastInsertRowid;
    })();
    const ot = db.prepare('SELECT * FROM mant_ot WHERE id=?').get(ot_id);
    res.status(201).json({ ...ot, tareas: db.prepare('SELECT * FROM mant_ot_tareas WHERE ot_id=? ORDER BY orden').all(ot_id), costos: [] });
  }
);

router.put('/ot/:id', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
  const ot = db.prepare('SELECT * FROM mant_ot WHERE id=?').get(req.params.id);
  if (!ot) return res.status(404).json({ error: 'OT no encontrada' });
  const { activo_id, activo_nombre, tipo, prioridad, estado, fecha_apertura, fecha_prog, fecha_cierre, descripcion, ejecutor_tipo, ejecutor_nombre, observaciones, tareas } = req.body;
  db.transaction(() => {
    db.prepare(`UPDATE mant_ot SET activo_id=?,activo_nombre=?,tipo=?,prioridad=?,estado=?,fecha_apertura=?,fecha_prog=?,fecha_cierre=?,descripcion=?,ejecutor_tipo=?,ejecutor_nombre=?,observaciones=?,updated_at=datetime('now','localtime') WHERE id=?`)
      .run(activo_id??ot.activo_id, activo_nombre??ot.activo_nombre, tipo??ot.tipo, prioridad??ot.prioridad,
           estado??ot.estado, fecha_apertura??ot.fecha_apertura, fecha_prog??ot.fecha_prog,
           fecha_cierre??ot.fecha_cierre, descripcion??ot.descripcion,
           ejecutor_tipo??ot.ejecutor_tipo, ejecutor_nombre??ot.ejecutor_nombre,
           observaciones??ot.observaciones, req.params.id);
    if (tareas) {
      db.prepare('DELETE FROM mant_ot_tareas WHERE ot_id=?').run(req.params.id);
      for (const [i,t] of tareas.entries()) {
        if (!t.descripcion?.trim()) continue;
        db.prepare('INSERT INTO mant_ot_tareas (ot_id,orden,descripcion,estado,completado_por,fecha_comp) VALUES (?,?,?,?,?,?)')
          .run(req.params.id, i+1, t.descripcion, t.estado||'Pendiente', t.completado_por||'', t.fecha_comp||'');
      }
    }
  })();
  const upd = db.prepare('SELECT * FROM mant_ot WHERE id=?').get(req.params.id);
  res.json({ ...upd, tareas: db.prepare('SELECT * FROM mant_ot_tareas WHERE ot_id=? ORDER BY orden').all(req.params.id), costos: db.prepare('SELECT * FROM mant_ot_costos WHERE ot_id=? ORDER BY id').all(req.params.id) });
});

router.patch('/ot/:id/tareas/:tid', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
  const { estado, completado_por } = req.body;
  const fc = estado === 'Completada' ? new Date().toISOString().slice(0,10) : '';
  db.prepare('UPDATE mant_ot_tareas SET estado=?,completado_por=?,fecha_comp=? WHERE id=? AND ot_id=?')
    .run(estado||'Pendiente', completado_por||'', fc, req.params.tid, req.params.id);
  res.json(db.prepare('SELECT * FROM mant_ot_tareas WHERE id=?').get(req.params.tid));
});

router.post('/ot/:id/costos', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
  const { tipo, descripcion, cantidad, precio_unit } = req.body;
  const total = (parseFloat(cantidad)||1) * (parseFloat(precio_unit)||0);
  const r = db.prepare('INSERT INTO mant_ot_costos (ot_id,tipo,descripcion,cantidad,precio_unit,total) VALUES (?,?,?,?,?,?)')
    .run(req.params.id, tipo||'Repuesto', descripcion||'', parseFloat(cantidad)||1, parseFloat(precio_unit)||0, total);
  res.status(201).json(db.prepare('SELECT * FROM mant_ot_costos WHERE id=?').get(r.lastInsertRowid));
});

router.delete('/ot/:id/costos/:cid', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
  db.prepare('DELETE FROM mant_ot_costos WHERE id=? AND ot_id=?').run(req.params.cid, req.params.id);
  res.json({ ok: true });
});

router.delete('/ot/:id', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
  db.prepare('DELETE FROM mant_ot_tareas WHERE ot_id=?').run(req.params.id);
  db.prepare('DELETE FROM mant_ot_costos WHERE ot_id=?').run(req.params.id);
  db.prepare('DELETE FROM mant_ot WHERE id=?').run(req.params.id);
  res.json({ mensaje: 'OT eliminada' });
});

// ── PLAN PREVENTIVO ────────────────────────────────────────────────────────────

router.get('/plan', verificarToken, (req, res) => {
  const { activo_id } = req.query;
  const where = activo_id ? 'WHERE activo=1 AND activo_id=?' : 'WHERE activo=1';
  res.json(db.prepare(`SELECT * FROM mant_plan ${where} ORDER BY proxima_fecha`).all(...(activo_id?[activo_id]:[])));
});

router.post('/plan', verificarToken,
  body('descripcion').trim().notEmpty(),
  (req, res) => {
    if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() });
    const { activo_id, activo_nombre, descripcion, frecuencia, proxima_fecha } = req.body;
    const r = db.prepare('INSERT INTO mant_plan (activo_id,activo_nombre,descripcion,frecuencia,proxima_fecha) VALUES (?,?,?,?,?)')
      .run(activo_id||null, activo_nombre||'', descripcion, frecuencia||'Mensual', proxima_fecha||'');
    res.status(201).json(db.prepare('SELECT * FROM mant_plan WHERE id=?').get(r.lastInsertRowid));
  }
);

router.put('/plan/:id', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
  const p = db.prepare('SELECT * FROM mant_plan WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  const { activo_id, activo_nombre, descripcion, frecuencia, proxima_fecha } = req.body;
  db.prepare('UPDATE mant_plan SET activo_id=?,activo_nombre=?,descripcion=?,frecuencia=?,proxima_fecha=? WHERE id=?')
    .run(activo_id??p.activo_id, activo_nombre??p.activo_nombre, descripcion??p.descripcion,
         frecuencia??p.frecuencia, proxima_fecha??p.proxima_fecha, req.params.id);
  res.json(db.prepare('SELECT * FROM mant_plan WHERE id=?').get(req.params.id));
});

router.delete('/plan/:id', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
  db.prepare('UPDATE mant_plan SET activo=0 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/plan/:id/ejecutar', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
  const plan = db.prepare('SELECT * FROM mant_plan WHERE id=?').get(req.params.id);
  if (!plan) return res.status(404).json({ error: 'Plan no encontrado' });
  const hoy    = new Date().toISOString().slice(0,10);
  const proxima = calcProxima(hoy, plan.frecuencia);
  const numero = nextNumero();
  const ot_id = db.transaction(() => {
    const r = db.prepare('INSERT INTO mant_ot (numero,activo_id,activo_nombre,tipo,prioridad,estado,fecha_apertura,descripcion,ejecutor_tipo,plan_id,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(numero, plan.activo_id, plan.activo_nombre, 'Preventivo', 'Normal', 'Pendiente', hoy, plan.descripcion, 'interno', plan.id, req.usuario.id);
    db.prepare('UPDATE mant_plan SET ultima_fecha=?,proxima_fecha=? WHERE id=?').run(hoy, proxima, plan.id);
    return r.lastInsertRowid;
  })();
  res.status(201).json({ ot_id, numero, proxima_fecha: proxima });
});

// ── EXPORTAR ───────────────────────────────────────────────────────────────────

router.get('/exportar', verificarToken, (req, res) => {
  const ots = db.prepare('SELECT * FROM mant_ot ORDER BY id DESC').all();
  const datos = ots.map(o => ({
    'N° OT': o.numero, 'Activo': o.activo_nombre, 'Tipo': o.tipo, 'Prioridad': o.prioridad,
    'Estado': o.estado, 'Descripción': o.descripcion, 'Apertura': o.fecha_apertura,
    'Programado': o.fecha_prog, 'Cierre': o.fecha_cierre,
    'Ejecutor': o.ejecutor_nombre, 'Tipo Ejecutor': o.ejecutor_tipo,
  }));
  const ws = XLSX.utils.json_to_sheet(datos);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Mantenimiento');
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition',`attachment; filename=mantenimiento_${new Date().toISOString().slice(0,10)}.xlsx`);
  res.send(XLSX.write(wb, { type:'buffer', bookType:'xlsx' }));
});

module.exports = router;
