const express = require('express');
const XLSX    = require('xlsx');
const { db }  = require('../db/database');
const { verificarToken, ESCRITURA_FINANZAS } = require('../middleware/auth');
const { buscarCondicion } = require('../helpers/buscar');

const router = express.Router();

// ── Cuentas ────────────────────────────────────────────────────────────────────

router.get('/cuentas', verificarToken, (req, res) => {
  const cuentas = db.prepare('SELECT * FROM cuentas_financieras WHERE activa=1 ORDER BY nombre').all();
  const result = cuentas.map(c => {
    const mov = db.prepare(`SELECT COALESCE(SUM(CASE WHEN tipo='Ingreso' THEN monto ELSE 0 END),0) as ing, COALESCE(SUM(CASE WHEN tipo='Egreso' THEN monto ELSE 0 END),0) as egr FROM movimientos_caja WHERE cuenta_id=? AND estado='Confirmado'`).get(c.id);
    return { ...c, saldo_actual: c.saldo_inicial + mov.ing - mov.egr };
  });
  res.json(result);
});

router.post('/cuentas', verificarToken, (req, res) => {
  if (!req.permisos?.finanzas?.escribir) return res.status(403).json({ error: 'Sin permisos' });
  const { nombre, tipo, moneda, saldo_inicial } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    const r = db.prepare('INSERT INTO cuentas_financieras (nombre,tipo,moneda,saldo_inicial) VALUES (?,?,?,?)')
      .run(nombre.trim(), tipo||'Caja', moneda||'ARS', parseFloat(saldo_inicial)||0);
    res.status(201).json(db.prepare('SELECT * FROM cuentas_financieras WHERE id=?').get(r.lastInsertRowid));
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'La cuenta ya existe' });
    throw e;
  }
});

router.put('/cuentas/:id', verificarToken, (req, res) => {
  if (!req.permisos?.finanzas?.escribir) return res.status(403).json({ error: 'Sin permisos' });
  const { nombre, tipo, moneda, saldo_inicial } = req.body;
  db.prepare('UPDATE cuentas_financieras SET nombre=?,tipo=?,moneda=?,saldo_inicial=? WHERE id=?')
    .run(nombre, tipo, moneda, parseFloat(saldo_inicial)||0, req.params.id);
  res.json(db.prepare('SELECT * FROM cuentas_financieras WHERE id=?').get(req.params.id));
});

// ── Categorías ────────────────────────────────────────────────────────────────

router.get('/categorias', verificarToken, (req, res) => {
  const { tipo } = req.query;
  const where = tipo ? 'WHERE tipo=?' : '';
  res.json(db.prepare(`SELECT * FROM categorias_financieras ${where} ORDER BY tipo,nombre`).all(...(tipo?[tipo]:[])));
});

router.post('/categorias', verificarToken, (req, res) => {
  if (!req.permisos?.finanzas?.escribir) return res.status(403).json({ error: 'Sin permisos' });
  const { nombre, tipo, color } = req.body;
  try {
    const r = db.prepare('INSERT INTO categorias_financieras (nombre,tipo,color) VALUES (?,?,?)').run(nombre, tipo||'Egreso', color||'#6c7086');
    res.status(201).json(db.prepare('SELECT * FROM categorias_financieras WHERE id=?').get(r.lastInsertRowid));
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe' });
    throw e;
  }
});

router.delete('/categorias/:id', verificarToken, (req, res) => {
  if (!req.permisos?.finanzas?.escribir) return res.status(403).json({ error: 'Sin permisos' });
  db.prepare('DELETE FROM categorias_financieras WHERE id=?').run(req.params.id);
  res.json({ mensaje: 'Eliminada' });
});

// ── Movimientos ────────────────────────────────────────────────────────────────

router.get('/movimientos', verificarToken, (req, res) => {
  const { cuenta_id, tipo, categoria, estado, desde, hasta, buscar, page=1, limit=100 } = req.query;
  const conds=[], params=[];
  if (cuenta_id) { conds.push('cuenta_id=?');  params.push(cuenta_id); }
  if (tipo)      { conds.push('tipo=?');        params.push(tipo); }
  if (categoria) { conds.push('categoria=?');   params.push(categoria); }
  if (estado)    { conds.push('estado=?');      params.push(estado); }
  if (desde)     { conds.push('fecha>=?');       params.push(desde); }
  if (hasta)     { conds.push('fecha<=?');       params.push(hasta); }
  if (buscar)    { const b = buscarCondicion(buscar, ['descripcion','referencia']); conds.push(b.cond); params.push(...b.params); }
  const where  = conds.length ? 'WHERE '+conds.join(' AND ') : '';
  const offset = (parseInt(page)-1)*parseInt(limit);
  const total  = db.prepare(`SELECT COUNT(*) as c FROM movimientos_caja ${where}`).get(...params).c;
  const datos  = db.prepare(`SELECT * FROM movimientos_caja ${where} ORDER BY fecha DESC,id DESC LIMIT ? OFFSET ?`).all(...params, parseInt(limit), offset);
  res.json({ total, datos });
});

router.post('/movimientos', verificarToken, (req, res) => {
  if (!req.permisos?.finanzas?.escribir) return res.status(403).json({ error: 'Sin permisos' });
  const { fecha, tipo, categoria, descripcion, monto, moneda, tasa_cambio, cuenta_id, cuenta_nombre, referencia, forma_pago, estado, doc_tipo, doc_id, observaciones } = req.body;
  if (!fecha || !tipo || !descripcion?.trim()) return res.status(400).json({ error: 'Fecha, tipo y descripción son requeridos' });
  if (!parseFloat(monto) || parseFloat(monto) <= 0) return res.status(400).json({ error: 'Monto debe ser mayor a 0' });
  const r = db.prepare('INSERT INTO movimientos_caja (fecha,tipo,categoria,descripcion,monto,moneda,tasa_cambio,cuenta_id,cuenta_nombre,referencia,forma_pago,estado,doc_tipo,doc_id,observaciones,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(fecha, tipo, categoria||'', descripcion.trim(), parseFloat(monto), moneda||'ARS', parseFloat(tasa_cambio)||1,
         cuenta_id||null, cuenta_nombre||'', referencia||'', forma_pago||'Transferencia',
         estado||'Confirmado', doc_tipo||'', doc_id||null, observaciones||'', req.usuario.id);
  res.status(201).json(db.prepare('SELECT * FROM movimientos_caja WHERE id=?').get(r.lastInsertRowid));
});

router.put('/movimientos/:id', verificarToken, (req, res) => {
  if (!req.permisos?.finanzas?.escribir) return res.status(403).json({ error: 'Sin permisos' });
  const m = db.prepare('SELECT * FROM movimientos_caja WHERE id=?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'No encontrado' });
  if (m.estado === 'Anulado') return res.status(400).json({ error: 'No se puede editar un movimiento anulado' });
  const { fecha, tipo, categoria, descripcion, monto, moneda, tasa_cambio, cuenta_id, cuenta_nombre, referencia, forma_pago, estado, observaciones } = req.body;
  db.prepare('UPDATE movimientos_caja SET fecha=?,tipo=?,categoria=?,descripcion=?,monto=?,moneda=?,tasa_cambio=?,cuenta_id=?,cuenta_nombre=?,referencia=?,forma_pago=?,estado=?,observaciones=? WHERE id=?')
    .run(fecha??m.fecha, tipo??m.tipo, categoria??m.categoria, descripcion??m.descripcion,
         parseFloat(monto??m.monto), moneda??m.moneda, parseFloat(tasa_cambio??m.tasa_cambio),
         cuenta_id??m.cuenta_id, cuenta_nombre??m.cuenta_nombre, referencia??m.referencia,
         forma_pago??m.forma_pago, estado??m.estado, observaciones??m.observaciones, req.params.id);
  res.json(db.prepare('SELECT * FROM movimientos_caja WHERE id=?').get(req.params.id));
});

router.post('/movimientos/:id/anular', verificarToken, (req, res) => {
  if (!req.permisos?.finanzas?.escribir) return res.status(403).json({ error: 'Sin permisos' });
  db.prepare("UPDATE movimientos_caja SET estado='Anulado' WHERE id=?").run(req.params.id);
  res.json({ mensaje: 'Movimiento anulado' });
});

router.delete('/movimientos/:id', verificarToken, (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Solo admins pueden eliminar movimientos' });
  db.prepare('DELETE FROM movimientos_caja WHERE id=?').run(req.params.id);
  res.json({ mensaje: 'Eliminado' });
});

// ── Resumen / KPIs ────────────────────────────────────────────────────────────

router.get('/resumen/mes', verificarToken, (req, res) => {
  const hoy  = new Date();
  const año  = parseInt(req.query.año)  || hoy.getFullYear();
  const mes  = parseInt(req.query.mes)  || hoy.getMonth()+1;
  const desde = `${año}-${String(mes).padStart(2,'0')}-01`;
  const hasta = `${año}-${String(mes).padStart(2,'0')}-31`;
  const row = db.prepare(`SELECT COALESCE(SUM(CASE WHEN tipo='Ingreso' AND estado='Confirmado' THEN monto ELSE 0 END),0) as ingresos, COALESCE(SUM(CASE WHEN tipo='Egreso' AND estado='Confirmado' THEN monto ELSE 0 END),0) as egresos, COALESCE(SUM(CASE WHEN tipo='Ingreso' AND estado='Pendiente' THEN monto ELSE 0 END),0) as ing_pendiente, COALESCE(SUM(CASE WHEN tipo='Egreso' AND estado='Pendiente' THEN monto ELSE 0 END),0) as egr_pendiente FROM movimientos_caja WHERE fecha BETWEEN ? AND ? AND moneda='ARS'`).get(desde, hasta);
  res.json(row);
});

router.get('/exportar', verificarToken, (req, res) => {
  const { desde, hasta } = req.query;
  const conds=['1=1'], params=[];
  if (desde) { conds.push('fecha>=?'); params.push(desde); }
  if (hasta)  { conds.push('fecha<=?'); params.push(hasta); }
  const movs = db.prepare(`SELECT * FROM movimientos_caja WHERE ${conds.join(' AND ')} ORDER BY fecha DESC`).all(...params);
  const ws = XLSX.utils.json_to_sheet(movs.map(m => ({
    'Fecha': m.fecha, 'Tipo': m.tipo, 'Categoría': m.categoria,
    'Descripción': m.descripcion, 'Monto': m.monto, 'Moneda': m.moneda,
    'Cuenta': m.cuenta_nombre, 'Referencia': m.referencia,
    'Forma pago': m.forma_pago, 'Estado': m.estado,
  })));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Finanzas');
  const buf = XLSX.write(wb, { type:'buffer', bookType:'xlsx' });
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition',`attachment; filename=finanzas_${new Date().toISOString().slice(0,10)}.xlsx`);
  res.send(buf);
});

module.exports = router;
