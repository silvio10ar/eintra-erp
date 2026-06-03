const express = require('express');
const XLSX    = require('xlsx');
const { body, validationResult } = require('express-validator');
const { db }  = require('../db/database');
const { verificarToken, ESCRITURA_PROYECTOS } = require('../middleware/auth');

const router = express.Router();

router.get('/', verificarToken, (req, res) => {
  const { estado, cliente_id, buscar } = req.query;
  const conds=[], params=[];
  if (estado)     { conds.push('estado=?');     params.push(estado); }
  if (cliente_id) { conds.push('cliente_id=?'); params.push(cliente_id); }
  if (buscar)     { conds.push('(codigo LIKE ? OR nombre LIKE ? OR cliente_nombre LIKE ?)'); params.push(`%${buscar}%`,`%${buscar}%`,`%${buscar}%`); }
  const where = conds.length ? 'WHERE '+conds.join(' AND ') : '';
  const proyectos = db.prepare(`
    SELECT p.*, COALESCE(SUM(c.total),0) as costo_total
    FROM proyectos p LEFT JOIN proyecto_costos c ON p.id=c.proyecto_id
    ${where} GROUP BY p.id ORDER BY p.created_at DESC
  `).all(...params);
  res.json(proyectos);
});

router.get('/:id', verificarToken, (req, res) => {
  const p = db.prepare('SELECT * FROM proyectos WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  const costos = db.prepare('SELECT * FROM proyecto_costos WHERE proyecto_id=? ORDER BY fecha DESC, id DESC').all(p.id);
  const ots    = db.prepare('SELECT id,numero,descripcion,estado,responsable FROM ordenes_trabajo WHERE proyecto_id=? ORDER BY id DESC').all(p.id);
  const total  = costos.reduce((s,c)=>s+c.total,0);
  res.json({ ...p, costos, ordenes_trabajo: ots, costo_total: total });
});

router.post('/', verificarToken,
  body('codigo').trim().notEmpty(),
  body('nombre').trim().notEmpty(),
  (req, res) => {
    if (!ESCRITURA_PROYECTOS.includes(req.usuario.rol)) return res.status(403).json({ error: 'Sin permisos' });
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() });
    const { codigo, nombre, cliente_id, cliente_nombre, descripcion, fecha_inicio, fecha_fin_est, estado, presupuesto_venta, responsable, presupuesto_id } = req.body;
    try {
      const r = db.prepare('INSERT INTO proyectos (codigo,nombre,cliente_id,cliente_nombre,descripcion,fecha_inicio,fecha_fin_est,estado,presupuesto_venta,responsable,presupuesto_id,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(codigo, nombre, cliente_id||null, cliente_nombre||'', descripcion||'',
             fecha_inicio||'', fecha_fin_est||'', estado||'Activo', presupuesto_venta||0,
             responsable||'', presupuesto_id||null, req.usuario.id);
      res.status(201).json(db.prepare('SELECT * FROM proyectos WHERE id=?').get(r.lastInsertRowid));
    } catch(e) {
      if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'El código ya existe' });
      throw e;
    }
  }
);

router.put('/:id', verificarToken, (req, res) => {
  if (!ESCRITURA_PROYECTOS.includes(req.usuario.rol)) return res.status(403).json({ error: 'Sin permisos' });
  const p = db.prepare('SELECT * FROM proyectos WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  const { codigo, nombre, cliente_id, cliente_nombre, descripcion, fecha_inicio, fecha_fin_est, fecha_cierre, estado, presupuesto_venta, responsable } = req.body;
  db.prepare(`UPDATE proyectos SET codigo=?,nombre=?,cliente_id=?,cliente_nombre=?,descripcion=?,fecha_inicio=?,fecha_fin_est=?,fecha_cierre=?,estado=?,presupuesto_venta=?,responsable=?,updated_at=datetime('now','localtime') WHERE id=?`)
    .run(codigo??p.codigo, nombre??p.nombre, cliente_id??p.cliente_id, cliente_nombre??p.cliente_nombre,
         descripcion??p.descripcion, fecha_inicio??p.fecha_inicio, fecha_fin_est??p.fecha_fin_est,
         fecha_cierre??p.fecha_cierre, estado??p.estado, presupuesto_venta??p.presupuesto_venta,
         responsable??p.responsable, req.params.id);
  res.json(db.prepare('SELECT * FROM proyectos WHERE id=?').get(req.params.id));
});

// Costos
router.post('/:id/costos', verificarToken, (req, res) => {
  if (!ESCRITURA_PROYECTOS.includes(req.usuario.rol)) return res.status(403).json({ error: 'Sin permisos' });
  const { tipo, descripcion, cantidad, precio_unit, fecha, observaciones } = req.body;
  const cant  = parseFloat(cantidad)   || 1;
  const precio = parseFloat(precio_unit) || 0;
  const r = db.prepare('INSERT INTO proyecto_costos (proyecto_id,tipo,descripcion,cantidad,precio_unit,total,fecha,origen,created_by) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(req.params.id, tipo||'Material', descripcion||'', cant, precio, cant*precio,
         fecha||new Date().toISOString().slice(0,10), 'manual', req.usuario.id);
  res.status(201).json(db.prepare('SELECT * FROM proyecto_costos WHERE id=?').get(r.lastInsertRowid));
});

router.delete('/:id/costos/:costo_id', verificarToken, (req, res) => {
  if (!ESCRITURA_PROYECTOS.includes(req.usuario.rol)) return res.status(403).json({ error: 'Sin permisos' });
  db.prepare('DELETE FROM proyecto_costos WHERE id=? AND proyecto_id=?').run(req.params.costo_id, req.params.id);
  res.json({ mensaje: 'Costo eliminado' });
});

router.get('/exportar', verificarToken, (req, res) => {
  const proyectos = db.prepare(`
    SELECT p.*, COALESCE(SUM(c.total),0) as costo_total
    FROM proyectos p LEFT JOIN proyecto_costos c ON p.id=c.proyecto_id
    GROUP BY p.id ORDER BY p.created_at DESC
  `).all();
  const ws = XLSX.utils.json_to_sheet(proyectos.map(p => ({
    'Código': p.codigo, 'Nombre': p.nombre, 'Cliente': p.cliente_nombre,
    'Estado': p.estado, 'Ppto. venta': p.presupuesto_venta,
    'Costo total': p.costo_total, 'Resultado': p.presupuesto_venta - p.costo_total,
    'F. Inicio': p.fecha_inicio, 'F. Fin Est.': p.fecha_fin_est,
  })));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Proyectos');
  const buf = XLSX.write(wb, { type:'buffer', bookType:'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=proyectos_${new Date().toISOString().slice(0,10)}.xlsx`);
  res.send(buf);
});

module.exports = router;
