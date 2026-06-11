const express = require('express');
const { body, validationResult } = require('express-validator');
const { db } = require('../db/database');
const { verificarToken } = require('../middleware/auth');

const router = express.Router();
const puede = req => req.usuario?.rol === 'admin' || !!(req.permisos?.mantenimiento?.escribir);

function logEstado(equipo_id, estado_anterior, estado_nuevo, motivo = '') {
  try {
    db.prepare('INSERT INTO mant_historial_estados (equipo_id,estado_anterior,estado_nuevo,motivo) VALUES (?,?,?,?)')
      .run(equipo_id, estado_anterior, estado_nuevo, motivo);
  } catch(e) {}
}

const ALERTAS_SQL = `
  SELECT
    tp.id              AS tarea_id,
    e.id               AS equipo_id,
    e.codigo,
    e.nombre,
    e.categoria,
    e.ubicacion,
    tp.componente,
    tp.accion,
    tp.tipo,
    tp.frecuencia,
    tp.frecuencia_dias,
    COALESCE(MAX(ep.fecha), ins_max.ultima_inspeccion) AS ultima_ejecucion,
    CASE
      WHEN tp.frecuencia = 'Luego de c/uso' THEN 'manual'
      WHEN COALESCE(MAX(ep.fecha), ins_max.ultima_inspeccion) IS NULL THEN 'nunca_ejecutada'
      WHEN julianday('now') - julianday(COALESCE(MAX(ep.fecha), ins_max.ultima_inspeccion)) > tp.frecuencia_dias THEN 'vencida'
      WHEN julianday('now') - julianday(COALESCE(MAX(ep.fecha), ins_max.ultima_inspeccion)) > tp.frecuencia_dias * 0.8 THEN 'proxima'
      ELSE 'al_dia'
    END AS estado_alerta,
    CAST(julianday('now') - julianday(COALESCE(MAX(ep.fecha), ins_max.ultima_inspeccion)) AS INTEGER) AS dias_desde_ultima
  FROM mant_tareas_preventivas tp
  JOIN mant_equipos e ON e.id = tp.equipo_id
  LEFT JOIN mant_ejecuciones_preventivas ep ON ep.tarea_id = tp.id
  LEFT JOIN (
    SELECT equipo_id, MAX(fecha) AS ultima_inspeccion
    FROM mant_inspecciones
    GROUP BY equipo_id
  ) ins_max ON ins_max.equipo_id = e.id
  WHERE e.estado = 'activo' AND tp.activa = 1
  GROUP BY tp.id
`;

// ── DASHBOARD ─────────────────────────────────────────────────────────────────

router.get('/dashboard', verificarToken, (req, res) => {
  const vencidas   = db.prepare(`SELECT COUNT(*) as c FROM (${ALERTAS_SQL}) WHERE estado_alerta='vencida'`).get().c;
  const proximas   = db.prepare(`SELECT COUNT(*) as c FROM (${ALERTAS_SQL}) WHERE estado_alerta='proxima'`).get().c;
  const en_rep     = db.prepare("SELECT COUNT(*) as c FROM mant_equipos WHERE estado='en_reparacion'").get().c;
  const bajas_anio = db.prepare("SELECT COUNT(*) as c FROM mant_equipos WHERE estado='baja' AND strftime('%Y',fecha_baja)=strftime('%Y','now')").get().c;
  const urgentes   = db.prepare(`${ALERTAS_SQL} ORDER BY CASE estado_alerta WHEN 'vencida' THEN 1 WHEN 'nunca_ejecutada' THEN 2 ELSE 3 END, dias_desde_ultima DESC LIMIT 10`).all();
  res.json({ vencidas, proximas, en_rep, bajas_anio, urgentes });
});

// ── META (categorías / ubicaciones para filtros) ──────────────────────────────

router.get('/meta', verificarToken, (req, res) => {
  const categorias = db.prepare('SELECT DISTINCT categoria FROM mant_equipos WHERE categoria IS NOT NULL ORDER BY categoria').all().map(r => r.categoria);
  res.json({ categorias, ubicaciones: ['MIGUENS', 'POGGIO'] });
});

// ── EQUIPOS ───────────────────────────────────────────────────────────────────

router.get('/equipos', verificarToken, (req, res) => {
  const { buscar, categoria, ubicacion, estado } = req.query;
  const conds = [], params = [];
  if (buscar)    { conds.push('(codigo LIKE ? OR nombre LIKE ? OR marca LIKE ?)'); params.push(`%${buscar}%`, `%${buscar}%`, `%${buscar}%`); }
  if (categoria) { conds.push('categoria=?'); params.push(categoria); }
  if (ubicacion) { conds.push('ubicacion=?'); params.push(ubicacion); }
  if (estado)    { conds.push('estado=?');    params.push(estado); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  res.json(db.prepare(`SELECT * FROM mant_equipos ${where} ORDER BY codigo`).all(...params));
});

router.get('/equipos/:id', verificarToken, (req, res) => {
  const eq = db.prepare('SELECT * FROM mant_equipos WHERE id=?').get(req.params.id);
  if (!eq) return res.status(404).json({ error: 'Equipo no encontrado' });
  const tareas = db.prepare(`SELECT * FROM (${ALERTAS_SQL}) WHERE equipo_id=? ORDER BY estado_alerta`).all(eq.id);
  const correctivas = db.prepare('SELECT * FROM mant_intervenciones_correctivas WHERE equipo_id=? ORDER BY fecha_deteccion DESC LIMIT 10').all(eq.id);
  const inspecciones = db.prepare('SELECT * FROM mant_inspecciones WHERE equipo_id=? ORDER BY fecha DESC LIMIT 5').all(eq.id);
  res.json({ ...eq, tareas, correctivas, inspecciones });
});

router.get('/equipos/:id/perfil', verificarToken, (req, res) => {
  const eq = db.prepare('SELECT * FROM mant_equipos WHERE id=?').get(req.params.id);
  if (!eq) return res.status(404).json({ error: 'Equipo no encontrado' });
  const correctivas = db.prepare('SELECT * FROM mant_intervenciones_correctivas WHERE equipo_id=? ORDER BY fecha_deteccion DESC').all(eq.id);
  const inspecciones = db.prepare('SELECT * FROM mant_inspecciones WHERE equipo_id=? ORDER BY fecha DESC LIMIT 20').all(eq.id);
  const historial    = db.prepare('SELECT * FROM mant_historial_estados WHERE equipo_id=? ORDER BY fecha DESC, id DESC').all(eq.id);
  res.json({ equipo: eq, correctivas, inspecciones, historial });
});

router.post('/equipos', verificarToken,
  body('codigo').trim().notEmpty(),
  body('nombre').trim().notEmpty(),
  body('categoria').trim().notEmpty(),
  (req, res) => {
    if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() });
    const { codigo, nombre, categoria, marca, modelo, nro_serie, ubicacion, observaciones } = req.body;
    try {
      const r = db.prepare('INSERT INTO mant_equipos (codigo,nombre,categoria,marca,modelo,nro_serie,ubicacion,observaciones) VALUES (?,?,?,?,?,?,?,?)')
        .run(codigo, nombre, categoria, marca||null, modelo||null, nro_serie||null, ubicacion||null, observaciones||null);
      res.status(201).json(db.prepare('SELECT * FROM mant_equipos WHERE id=?').get(r.lastInsertRowid));
    } catch(e) {
      if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'El código ya existe' });
      throw e;
    }
  }
);

router.put('/equipos/:id', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
  const eq = db.prepare('SELECT * FROM mant_equipos WHERE id=?').get(req.params.id);
  if (!eq) return res.status(404).json({ error: 'No encontrado' });
  const { codigo, nombre, categoria, marca, modelo, nro_serie, ubicacion, estado, observaciones } = req.body;
  db.prepare('UPDATE mant_equipos SET codigo=?,nombre=?,categoria=?,marca=?,modelo=?,nro_serie=?,ubicacion=?,estado=?,observaciones=? WHERE id=?')
    .run(codigo??eq.codigo, nombre??eq.nombre, categoria??eq.categoria,
         marca??eq.marca, modelo??eq.modelo, nro_serie??eq.nro_serie,
         ubicacion??eq.ubicacion, estado??eq.estado, observaciones??eq.observaciones,
         req.params.id);
  res.json(db.prepare('SELECT * FROM mant_equipos WHERE id=?').get(req.params.id));
});

router.post('/equipos/:id/baja', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
  const { motivo_baja } = req.body;
  if (!motivo_baja?.trim()) return res.status(400).json({ error: 'Motivo de baja requerido' });
  const eqAntes = db.prepare('SELECT estado FROM mant_equipos WHERE id=?').get(req.params.id);
  db.transaction(() => {
    db.prepare("UPDATE mant_equipos SET estado='baja', fecha_baja=date('now'), motivo_baja=? WHERE id=?")
      .run(motivo_baja, req.params.id);
    db.prepare(`INSERT INTO mant_intervenciones_correctivas
      (equipo_id, fecha_deteccion, descripcion_falla, resultado, tipo_servicio)
      VALUES (?, date('now'), ?, 'baja_definitiva', 'interno')`)
      .run(req.params.id, motivo_baja);
    logEstado(req.params.id, eqAntes?.estado || 'activo', 'baja', motivo_baja);
  })();
  res.json(db.prepare('SELECT * FROM mant_equipos WHERE id=?').get(req.params.id));
});

// ── ALERTAS / PLAN PREVENTIVO ─────────────────────────────────────────────────

router.get('/alertas', verificarToken, (req, res) => {
  const { estado, ubicacion, categoria } = req.query;
  const conds = ["estado_alerta != 'manual'"], params = [];
  if (estado)    { conds.push('estado_alerta=?'); params.push(estado); }
  if (ubicacion) { conds.push('ubicacion=?');     params.push(ubicacion); }
  if (categoria) { conds.push('categoria=?');     params.push(categoria); }
  const order = `ORDER BY CASE estado_alerta WHEN 'vencida' THEN 1 WHEN 'nunca_ejecutada' THEN 2 WHEN 'proxima' THEN 3 ELSE 4 END, dias_desde_ultima DESC NULLS LAST`;
  res.json(db.prepare(`SELECT * FROM (${ALERTAS_SQL}) WHERE ${conds.join(' AND ')} ${order}`).all(...params));
});

// ── TAREAS PREVENTIVAS (CRUD) ─────────────────────────────────────────────────

router.get('/tareas', verificarToken, (req, res) => {
  const { equipo_id } = req.query;
  if (!equipo_id) return res.status(400).json({ error: 'equipo_id requerido' });
  res.json(db.prepare('SELECT * FROM mant_tareas_preventivas WHERE equipo_id=? ORDER BY id').all(equipo_id));
});

router.post('/tareas', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
  const { equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias } = req.body;
  if (!equipo_id || !componente?.trim() || !accion?.trim())
    return res.status(400).json({ error: 'equipo_id, componente y accion son requeridos' });
  const r = db.prepare(
    'INSERT INTO mant_tareas_preventivas (equipo_id,componente,accion,tipo,frecuencia,frecuencia_dias,activa) VALUES (?,?,?,?,?,?,1)'
  ).run(equipo_id, componente.trim(), accion.trim(), tipo||'', frecuencia||'Mensual', frecuencia_dias||30);
  res.status(201).json(db.prepare('SELECT * FROM mant_tareas_preventivas WHERE id=?').get(r.lastInsertRowid));
});

router.put('/tareas/:id', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
  const t = db.prepare('SELECT * FROM mant_tareas_preventivas WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'No encontrada' });
  const { componente, accion, tipo, frecuencia, frecuencia_dias, activa } = req.body;
  db.prepare(
    'UPDATE mant_tareas_preventivas SET componente=?,accion=?,tipo=?,frecuencia=?,frecuencia_dias=?,activa=? WHERE id=?'
  ).run(
    componente ?? t.componente,
    accion      ?? t.accion,
    tipo        ?? t.tipo,
    frecuencia  ?? t.frecuencia,
    frecuencia_dias ?? t.frecuencia_dias,
    activa !== undefined ? (activa ? 1 : 0) : t.activa,
    req.params.id
  );
  res.json(db.prepare('SELECT * FROM mant_tareas_preventivas WHERE id=?').get(req.params.id));
});

router.delete('/tareas/:id', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
  db.prepare('DELETE FROM mant_tareas_preventivas WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── EJECUCIONES PREVENTIVAS ───────────────────────────────────────────────────

router.post('/ejecuciones', verificarToken,
  body('tarea_id').isInt(),
  body('equipo_id').isInt(),
  body('fecha').notEmpty(),
  body('resultado').isIn(['OK', 'NOK', 'Cuarentena']),
  (req, res) => {
    if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() });
    const { tarea_id, equipo_id, fecha, resultado, observaciones, responsable } = req.body;
    const r = db.prepare('INSERT INTO mant_ejecuciones_preventivas (tarea_id,equipo_id,fecha,resultado,observaciones,responsable) VALUES (?,?,?,?,?,?)')
      .run(tarea_id, equipo_id, fecha, resultado, observaciones||null, responsable||null);
    res.status(201).json({ id: r.lastInsertRowid, tarea_id, equipo_id, fecha, resultado, observaciones, responsable });
  }
);

// ── INTERVENCIONES CORRECTIVAS ────────────────────────────────────────────────

router.get('/correctivas', verificarToken, (req, res) => {
  const { resultado, equipo_id } = req.query;
  const conds = [], params = [];
  if (resultado) { conds.push('ic.resultado=?');  params.push(resultado); }
  if (equipo_id) { conds.push('ic.equipo_id=?');  params.push(equipo_id); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  res.json(db.prepare(`
    SELECT ic.*, e.codigo, e.nombre AS equipo_nombre, e.categoria
    FROM mant_intervenciones_correctivas ic
    JOIN mant_equipos e ON e.id = ic.equipo_id
    ${where}
    ORDER BY ic.id DESC
  `).all(...params));
});

router.post('/correctivas', verificarToken,
  body('equipo_id').isInt(),
  body('fecha_deteccion').notEmpty(),
  body('descripcion_falla').trim().notEmpty(),
  (req, res) => {
    if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() });
    const { equipo_id, fecha_deteccion, fecha_inicio, descripcion_falla, tipo_servicio, proveedor, responsable, observaciones } = req.body;
    const eqAntes = db.prepare('SELECT estado FROM mant_equipos WHERE id=?').get(equipo_id);
    const r = db.prepare('INSERT INTO mant_intervenciones_correctivas (equipo_id,fecha_deteccion,fecha_inicio,descripcion_falla,tipo_servicio,proveedor,resultado,responsable,observaciones) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(equipo_id, fecha_deteccion, fecha_inicio||null, descripcion_falla, tipo_servicio||'interno', proveedor||null, 'pendiente', responsable||null, observaciones||null);
    db.prepare("UPDATE mant_equipos SET estado='en_reparacion' WHERE id=? AND estado='activo'").run(equipo_id);
    if (eqAntes?.estado === 'activo') logEstado(equipo_id, 'activo', 'en_reparacion', descripcion_falla);
    res.status(201).json(db.prepare('SELECT * FROM mant_intervenciones_correctivas WHERE id=?').get(r.lastInsertRowid));
  }
);

router.put('/correctivas/:id', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
  const ic = db.prepare('SELECT * FROM mant_intervenciones_correctivas WHERE id=?').get(req.params.id);
  if (!ic) return res.status(404).json({ error: 'No encontrada' });
  const eqAntes = db.prepare('SELECT estado FROM mant_equipos WHERE id=?').get(ic.equipo_id);
  const { fecha_inicio, fecha_fin, accion_realizada, tipo_servicio, proveedor, costo, repuestos_usados, resultado, responsable, observaciones } = req.body;
  const nuevoResultado = resultado ?? ic.resultado;
  db.transaction(() => {
    db.prepare('UPDATE mant_intervenciones_correctivas SET fecha_inicio=?,fecha_fin=?,accion_realizada=?,tipo_servicio=?,proveedor=?,costo=?,repuestos_usados=?,resultado=?,responsable=?,observaciones=? WHERE id=?')
      .run(fecha_inicio??ic.fecha_inicio, fecha_fin??ic.fecha_fin, accion_realizada??ic.accion_realizada,
           tipo_servicio??ic.tipo_servicio, proveedor??ic.proveedor, costo??ic.costo,
           repuestos_usados??ic.repuestos_usados, nuevoResultado,
           responsable??ic.responsable, observaciones??ic.observaciones, req.params.id);
    if (nuevoResultado === 'derivado_baja') {
      const motivo = `Correctiva #${req.params.id}: ${accion_realizada || ic.descripcion_falla}`;
      db.prepare("UPDATE mant_equipos SET estado='baja', fecha_baja=date('now'), motivo_baja=? WHERE id=?")
        .run(motivo, ic.equipo_id);
      logEstado(ic.equipo_id, eqAntes?.estado || 'activo', 'baja', motivo);
    } else if (nuevoResultado === 'pendiente' && ic.resultado !== 'pendiente') {
      // Reabrir: volver el equipo a en_reparacion
      db.prepare("UPDATE mant_equipos SET estado='en_reparacion' WHERE id=? AND estado='activo'").run(ic.equipo_id);
      if (eqAntes?.estado === 'activo') logEstado(ic.equipo_id, 'activo', 'en_reparacion', `Correctiva #${req.params.id} reabierta`);
    } else if (nuevoResultado !== 'pendiente' && ic.resultado === 'pendiente') {
      const pendientes = db.prepare(
        "SELECT COUNT(*) as c FROM mant_intervenciones_correctivas WHERE equipo_id=? AND resultado='pendiente' AND id!=?"
      ).get(ic.equipo_id, req.params.id).c;
      if (pendientes === 0) {
        db.prepare("UPDATE mant_equipos SET estado='activo' WHERE id=? AND estado='en_reparacion'")
          .run(ic.equipo_id);
        if (eqAntes?.estado === 'en_reparacion') logEstado(ic.equipo_id, 'en_reparacion', 'activo', `Correctiva #${req.params.id} cerrada`);
      }
    }
  })();
  res.json(db.prepare('SELECT * FROM mant_intervenciones_correctivas WHERE id=?').get(req.params.id));
});

// ── HISTORIAL COMPLETO DE MANTENIMIENTO ──────────────────────────────────────

router.get('/historial', verificarToken, (req, res) => {
  const { equipo_id, desde, hasta, tipo, estado_equipo } = req.query;

  const mkWhere = conds => conds.length ? 'WHERE ' + conds.join(' AND ') : '';

  const baseInsp = [], baseCorr = [], basePrev = [], baseHist = [];
  const pInsp = [], pCorr = [], pPrev = [], pHist = [];

  if (equipo_id) {
    baseInsp.push('i.equipo_id=?');   pInsp.push(equipo_id);
    baseCorr.push('ic.equipo_id=?');  pCorr.push(equipo_id);
    basePrev.push('ep.equipo_id=?');  pPrev.push(equipo_id);
    baseHist.push('hs.equipo_id=?');  pHist.push(equipo_id);
  }
  if (desde) {
    baseInsp.push('i.fecha>=?');              pInsp.push(desde);
    baseCorr.push('ic.fecha_deteccion>=?');   pCorr.push(desde);
    basePrev.push('ep.fecha>=?');             pPrev.push(desde);
    baseHist.push('hs.fecha>=?');             pHist.push(desde);
  }
  if (hasta) {
    baseInsp.push('i.fecha<=?');              pInsp.push(hasta);
    baseCorr.push('ic.fecha_deteccion<=?');   pCorr.push(hasta);
    basePrev.push('ep.fecha<=?');             pPrev.push(hasta);
    baseHist.push('hs.fecha<=?');             pHist.push(hasta);
  }
  if (estado_equipo) {
    baseInsp.push('e.estado=?');  pInsp.push(estado_equipo);
    baseCorr.push('e.estado=?');  pCorr.push(estado_equipo);
    basePrev.push('e.estado=?');  pPrev.push(estado_equipo);
    baseHist.push('e.estado=?');  pHist.push(estado_equipo);
  }

  const cols = `id, equipo_id, fecha, estado_general, observaciones, responsable,
                created_at, tipo, codigo, equipo_nombre, categoria, equipo_estado,
                estado_anterior, accion_realizada, fecha_fin, tarea_info`;

  const inspSql = `
    SELECT i.id, i.equipo_id, i.fecha, i.estado_general,
           i.observaciones, i.responsable, i.created_at,
           'inspeccion' AS tipo,
           e.codigo, e.nombre AS equipo_nombre, e.categoria, e.estado AS equipo_estado,
           NULL AS estado_anterior, NULL AS accion_realizada, NULL AS fecha_fin,
           NULL AS tarea_info
    FROM mant_inspecciones i
    JOIN mant_equipos e ON e.id = i.equipo_id
    ${mkWhere(baseInsp)}`;

  const corrSql = `
    SELECT ic.id, ic.equipo_id, ic.fecha_deteccion AS fecha,
           ic.resultado AS estado_general,
           ic.descripcion_falla AS observaciones, ic.responsable, ic.created_at,
           'correctiva' AS tipo,
           e.codigo, e.nombre AS equipo_nombre, e.categoria, e.estado AS equipo_estado,
           NULL AS estado_anterior, ic.accion_realizada, ic.fecha_fin,
           NULL AS tarea_info
    FROM mant_intervenciones_correctivas ic
    JOIN mant_equipos e ON e.id = ic.equipo_id
    ${mkWhere(baseCorr)}`;

  const prevSql = `
    SELECT ep.id, ep.equipo_id, ep.fecha,
           ep.resultado AS estado_general,
           ep.observaciones, ep.responsable, ep.created_at,
           'preventiva' AS tipo,
           e.codigo, e.nombre AS equipo_nombre, e.categoria, e.estado AS equipo_estado,
           NULL AS estado_anterior, NULL AS accion_realizada, NULL AS fecha_fin,
           (COALESCE(tp.componente,'') || ' — ' || COALESCE(tp.accion,'')) AS tarea_info
    FROM mant_ejecuciones_preventivas ep
    JOIN mant_equipos e ON e.id = ep.equipo_id
    LEFT JOIN mant_tareas_preventivas tp ON tp.id = ep.tarea_id
    ${mkWhere(basePrev)}`;

  const histSql = `
    SELECT hs.id, hs.equipo_id, hs.fecha,
           hs.estado_nuevo AS estado_general,
           hs.motivo AS observaciones, NULL AS responsable, hs.created_at,
           'estado' AS tipo,
           e.codigo, e.nombre AS equipo_nombre, e.categoria, e.estado AS equipo_estado,
           hs.estado_anterior, NULL AS accion_realizada, NULL AS fecha_fin,
           NULL AS tarea_info
    FROM mant_historial_estados hs
    JOIN mant_equipos e ON e.id = hs.equipo_id
    ${mkWhere(baseHist)}`;

  const PARTES = { inspeccion: [inspSql, pInsp], correctiva: [corrSql, pCorr], preventiva: [prevSql, pPrev], estado: [histSql, pHist] };
  const seleccionados = tipo && PARTES[tipo] ? [tipo] : ['inspeccion','correctiva','preventiva','estado'];

  const sqls   = seleccionados.map(t => PARTES[t][0]);
  const params = seleccionados.flatMap(t => PARTES[t][1]);

  res.json(db.prepare(
    `SELECT ${cols} FROM (${sqls.join(' UNION ALL ')}) ORDER BY fecha DESC, id DESC`
  ).all(...params));
});

// ── INSPECCIONES ──────────────────────────────────────────────────────────────

router.get('/inspecciones', verificarToken, (req, res) => {
  const { equipo_id, desde, hasta, estado, ubicacion, estado_alerta, estado_equipo } = req.query;
  const conds = [], params = [];
  if (equipo_id)     { conds.push('i.equipo_id=?');            params.push(equipo_id); }
  if (desde)         { conds.push('i.fecha>=?');               params.push(desde); }
  if (hasta)         { conds.push('i.fecha<=?');               params.push(hasta); }
  if (estado)        {
    conds.push(`i.id IN (
      SELECT m.id FROM mant_inspecciones m
      WHERE m.id = (
        SELECT m2.id FROM mant_inspecciones m2
        WHERE m2.equipo_id = m.equipo_id
        ORDER BY m2.fecha DESC, m2.id DESC
        LIMIT 1
      )
      AND m.estado_general = ?
    )`);
    params.push(estado);
  }
  if (ubicacion)     { conds.push('i.ubicacion_verificada=?'); params.push(ubicacion); }
  if (estado_alerta) { conds.push(`i.equipo_id IN (SELECT equipo_id FROM (${ALERTAS_SQL}) WHERE estado_alerta=?)`); params.push(estado_alerta); }
  if (estado_equipo) { conds.push('e.estado=?');               params.push(estado_equipo); }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

  const inspSql = `
    SELECT i.id, i.equipo_id, i.fecha, i.estado_general, i.ubicacion_verificada,
           i.etiqueta_ok, i.observaciones, i.responsable, i.created_at,
           'inspeccion' AS tipo,
           e.codigo, e.nombre AS equipo_nombre, e.categoria, e.estado AS equipo_estado,
           NULL AS estado_anterior, NULL AS accion_realizada, NULL AS fecha_fin
    FROM mant_inspecciones i
    JOIN mant_equipos e ON e.id = i.equipo_id ${where}
  `;

  // No incluir cambios de estado cuando hay filtros que solo aplican a inspecciones
  if (estado || estado_alerta || ubicacion) {
    res.json(db.prepare(`${inspSql} ORDER BY i.fecha DESC, i.id DESC`).all(...params));
    return;
  }

  // Incluir todos los cambios de estado desde mant_historial_estados
  const histConds = [], histParams = [];
  if (equipo_id)     { histConds.push('hs.equipo_id=?'); histParams.push(equipo_id); }
  if (desde)         { histConds.push('hs.fecha>=?');    histParams.push(desde); }
  if (hasta)         { histConds.push('hs.fecha<=?');    histParams.push(hasta); }
  if (estado_equipo) { histConds.push('e.estado=?');     histParams.push(estado_equipo); }
  const histWhere = histConds.length ? 'WHERE ' + histConds.join(' AND ') : '';

  const histSql = `
    SELECT hs.id, hs.equipo_id, hs.fecha,
           hs.estado_nuevo AS estado_general, NULL AS ubicacion_verificada,
           NULL AS etiqueta_ok, hs.motivo AS observaciones,
           NULL AS responsable, hs.created_at,
           'estado' AS tipo,
           e.codigo, e.nombre AS equipo_nombre, e.categoria, e.estado AS equipo_estado,
           hs.estado_anterior, NULL AS accion_realizada, NULL AS fecha_fin
    FROM mant_historial_estados hs
    JOIN mant_equipos e ON e.id = hs.equipo_id
    ${histWhere}
  `;

  res.json(db.prepare(
    `SELECT * FROM (${inspSql} UNION ALL ${histSql}) ORDER BY fecha DESC, id DESC`
  ).all(...params, ...histParams));
});

router.post('/inspecciones', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
  const { registros } = req.body;
  if (!Array.isArray(registros) || !registros.length) return res.status(400).json({ error: 'Sin registros' });
  const ins = db.prepare('INSERT INTO mant_inspecciones (equipo_id,fecha,estado_general,ubicacion_verificada,etiqueta_ok,observaciones,responsable) VALUES (?,?,?,?,?,?,?)');
  db.transaction(rows => {
    for (const r of rows)
      ins.run(r.equipo_id, r.fecha, r.estado_general, r.ubicacion_verificada||null, r.etiqueta_ok??1, r.observaciones||null, r.responsable||null);
  })(registros);
  res.status(201).json({ insertados: registros.length });
});

// ── HISTORIAL POR EQUIPO ──────────────────────────────────────────────────────

router.get('/equipos/:codigo/historial', verificarToken, (req, res) => {
  const equipo = db.prepare('SELECT * FROM mant_equipos WHERE codigo=?').get(req.params.codigo);
  if (!equipo) return res.status(404).json({ error: 'Equipo no encontrado' });
  const historial = db.prepare('SELECT * FROM v_mant_historial_equipo WHERE codigo=? ORDER BY fecha DESC').all(req.params.codigo);
  res.json({ equipo, historial });
});

module.exports = router;
