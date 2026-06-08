const express = require('express');
const XLSX    = require('xlsx');
const { body, validationResult } = require('express-validator');
const { db }  = require('../db/database');
const { verificarToken } = require('../middleware/auth');

const router = express.Router();
const puede = req => !!(req.permisos?.stock?.escribir);

// ── Productos ──────────────────────────────────────────────────────────────────

router.get('/productos', verificarToken, (req, res) => {
  const { buscar, categoria, ubicacion, alerta } = req.query;
  const conds = ['p.activo=1'], params = [];
  if (buscar)   { conds.push('(p.codigo LIKE ? OR p.descripcion LIKE ? OR p.proveedor LIKE ?)'); params.push(`%${buscar}%`,`%${buscar}%`,`%${buscar}%`); }
  if (categoria){ conds.push('p.categoria=?');  params.push(categoria); }
  if (ubicacion){ conds.push('p.ubicacion=?');  params.push(ubicacion); }
  if (alerta === 'bajo')     conds.push('p.stock_actual > 0 AND p.stock_minimo > 0 AND p.stock_actual <= p.stock_minimo');
  if (alerta === 'agotado')  conds.push('p.stock_actual <= 0');
  if (alerta === 'ok')       conds.push('p.stock_actual > 0');
  const rows = db.prepare(`SELECT * FROM productos p WHERE ${conds.join(' AND ')} ORDER BY p.descripcion`).all(...params);
  res.json(rows);
});

router.get('/productos/categorias', verificarToken, (req, res) => {
  res.json(db.prepare("SELECT DISTINCT categoria FROM productos WHERE categoria!='' AND activo=1 ORDER BY categoria").all().map(r=>r.categoria));
});

router.get('/productos/ubicaciones', verificarToken, (req, res) => {
  res.json(db.prepare("SELECT DISTINCT ubicacion FROM productos WHERE ubicacion!='' AND activo=1 ORDER BY ubicacion").all().map(r=>r.ubicacion));
});

router.get('/movimientos/valores', verificarToken, (req, res) => {
  const { campo } = req.query;
  const cols = { proveedor:'proveedor', proyecto:'proyecto', cliente_interno:'cliente_interno', codigo:'codigo', descripcion:'descripcion' };
  if (!cols[campo]) return res.json([]);
  let sql;
  if (campo === 'codigo' || campo === 'descripcion') {
    sql = `SELECT DISTINCT p.${campo} as v FROM productos p WHERE p.${campo}!='' ORDER BY p.${campo} LIMIT 100`;
    return res.json(db.prepare(sql).all().map(r=>r.v));
  }
  sql = `SELECT DISTINCT ${campo} as v FROM movimientos_stock WHERE ${campo}!='' ORDER BY ${campo} LIMIT 100`;
  res.json(db.prepare(sql).all().map(r=>r.v));
});

router.get('/productos/:id', verificarToken, (req, res) => {
  const p = db.prepare('SELECT * FROM productos WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
  const movs = db.prepare('SELECT * FROM movimientos_stock WHERE producto_id=? ORDER BY created_at DESC LIMIT 50').all(p.id);
  res.json({ ...p, movimientos: movs });
});

router.post('/productos', verificarToken,
  body('codigo').trim().notEmpty(),
  body('descripcion').trim().notEmpty(),
  (req, res) => {
    if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() });
    const { codigo, descripcion, categoria, unidad, stock_actual, stock_minimo, ubicacion, precio_costo, precio_venta, proveedor } = req.body;
    try {
      const r = db.prepare(`INSERT INTO productos (codigo,descripcion,categoria,unidad,stock_actual,stock_minimo,ubicacion,precio_costo,precio_venta,proveedor) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(codigo, descripcion, categoria||'', unidad||'UND.', stock_actual||0, stock_minimo||0, ubicacion||'', precio_costo||0, precio_venta||0, proveedor||'');
      res.status(201).json(db.prepare('SELECT * FROM productos WHERE id=?').get(r.lastInsertRowid));
    } catch(e) {
      if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'El código ya existe' });
      throw e;
    }
  }
);

router.put('/productos/:id', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
  const p = db.prepare('SELECT * FROM productos WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  const { codigo, descripcion, categoria, unidad, stock_minimo, ubicacion, precio_costo, precio_venta, proveedor } = req.body;
  db.prepare(`UPDATE productos SET codigo=?,descripcion=?,categoria=?,unidad=?,stock_minimo=?,ubicacion=?,precio_costo=?,precio_venta=?,proveedor=?,updated_at=datetime('now','localtime') WHERE id=?`)
    .run(codigo??p.codigo, descripcion??p.descripcion, categoria??p.categoria, unidad??p.unidad,
         stock_minimo??p.stock_minimo, ubicacion??p.ubicacion, precio_costo??p.precio_costo,
         precio_venta??p.precio_venta, proveedor??p.proveedor??'', req.params.id);
  res.json(db.prepare('SELECT * FROM productos WHERE id=?').get(req.params.id));
});

router.delete('/productos/:id', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
  db.prepare('UPDATE productos SET activo=0 WHERE id=?').run(req.params.id);
  res.json({ mensaje: 'Producto desactivado' });
});

// ── Movimientos ────────────────────────────────────────────────────────────────

router.get('/movimientos', verificarToken, (req, res) => {
  const { producto_id, tipo, desde, hasta, campo, valor, page=1, limit=200 } = req.query;
  const conds = [], params = [];
  if (producto_id) { conds.push('m.producto_id=?');  params.push(producto_id); }
  if (tipo)        { conds.push('m.tipo=?');           params.push(tipo); }
  if (desde)       { conds.push('m.fecha>=?');          params.push(desde); }
  if (hasta)       { conds.push('m.fecha<=?');          params.push(hasta); }
  if (campo && valor) {
    const v = `%${valor}%`;
    const mapa = {
      codigo:          'm_p.codigo LIKE ?',
      descripcion:     'm_p.descripcion LIKE ?',
      proveedor:       'm.proveedor LIKE ?',
      proyecto:        'm.proyecto LIKE ?',
      cliente_interno: 'm.cliente_interno LIKE ?',
      observaciones:   'm.observaciones LIKE ?',
    };
    if (mapa[campo]) { conds.push(mapa[campo]); params.push(v); }
    else {
      conds.push('(m_p.codigo LIKE ? OR m_p.descripcion LIKE ? OR m.proveedor LIKE ? OR m.proyecto LIKE ? OR m.cliente_interno LIKE ?)');
      params.push(v,v,v,v,v);
    }
  }
  const where  = conds.length ? 'WHERE '+conds.join(' AND ') : '';
  const offset = (parseInt(page)-1)*parseInt(limit);
  const total  = db.prepare(`SELECT COUNT(*) as c FROM movimientos_stock m LEFT JOIN productos m_p ON m.producto_id=m_p.id ${where}`).get(...params).c;
  const rows   = db.prepare(`
    SELECT m.*, m_p.codigo, m_p.descripcion, m_p.unidad
    FROM movimientos_stock m LEFT JOIN productos m_p ON m.producto_id=m_p.id
    ${where} ORDER BY m.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);
  res.json({ total, datos: rows });
});

router.post('/movimientos', verificarToken,
  body('producto_id').isInt(),
  body('tipo').isIn(['entrada','salida','devolucion','ajuste']),
  body('cantidad').isFloat({ gt: 0 }),
  body('fecha').notEmpty(),
  (req, res) => {
    if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() });
    const { producto_id, tipo, cantidad, fecha, referencia, precio_unit, observaciones, proveedor, proyecto, cliente_interno } = req.body;
    const p = db.prepare('SELECT * FROM productos WHERE id=? AND activo=1').get(producto_id);
    if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
    const delta = (tipo === 'salida') ? -cantidad : cantidad;
    if (tipo === 'salida' && p.stock_actual + delta < 0)
      return res.status(400).json({ error: `Stock insuficiente. Disponible: ${p.stock_actual}` });
    db.transaction(() => {
      db.prepare(`INSERT INTO movimientos_stock (producto_id,tipo,cantidad,fecha,referencia,precio_unit,observaciones,proveedor,proyecto,cliente_interno,created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(producto_id, tipo, cantidad, fecha, referencia||'', precio_unit||0, observaciones||'', proveedor||'', proyecto||'', cliente_interno||'', req.usuario.id);
      db.prepare("UPDATE productos SET stock_actual=stock_actual+?, updated_at=datetime('now','localtime') WHERE id=?").run(delta, producto_id);
    })();
    res.status(201).json({ stock_nuevo: p.stock_actual + delta, mensaje: `Stock actualizado: ${p.stock_actual + delta}` });
  }
);

// ── Exportar productos ─────────────────────────────────────────────────────────
router.get('/exportar', verificarToken, (req, res) => {
  const { buscar, categoria, ubicacion, alerta, tipo_export } = req.query;

  if (tipo_export === 'entradas' || tipo_export === 'salidas') {
    const tipoMov = tipo_export === 'entradas' ? 'entrada' : 'salida';
    const movs = db.prepare(`
      SELECT m.fecha, p.codigo, p.descripcion, m.tipo, m.cantidad, p.unidad,
             m.proveedor, m.precio_unit, m.proyecto, m.cliente_interno, m.observaciones
      FROM movimientos_stock m JOIN productos p ON m.producto_id=p.id
      WHERE m.tipo=? ORDER BY m.fecha DESC
    `).all(tipoMov);
    const datos = movs.map(m => ({
      'Fecha': m.fecha, 'Código': m.codigo, 'Descripción': m.descripcion,
      'Tipo': m.tipo, 'Cantidad': m.cantidad, 'Unidad': m.unidad,
      'Proveedor': m.proveedor, 'Precio Unit.': m.precio_unit,
      'Proyecto': m.proyecto, 'Cliente Int.': m.cliente_interno, 'Observaciones': m.observaciones,
    }));
    const ws = XLSX.utils.json_to_sheet(datos);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, tipo_export === 'entradas' ? 'Entradas' : 'Salidas');
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',`attachment; filename=${tipo_export}_${new Date().toISOString().slice(0,10)}.xlsx`);
    return res.send(XLSX.write(wb, { type:'buffer', bookType:'xlsx' }));
  }

  const conds = ['p.activo=1'], params = [];
  if (buscar)   { conds.push('(p.codigo LIKE ? OR p.descripcion LIKE ? OR p.proveedor LIKE ?)'); params.push(`%${buscar}%`,`%${buscar}%`,`%${buscar}%`); }
  if (categoria){ conds.push('p.categoria=?'); params.push(categoria); }
  if (ubicacion){ conds.push('p.ubicacion=?'); params.push(ubicacion); }
  if (alerta === 'bajo')    conds.push('p.stock_actual > 0 AND p.stock_minimo > 0 AND p.stock_actual <= p.stock_minimo');
  if (alerta === 'agotado') conds.push('p.stock_actual <= 0');
  const productos = db.prepare(`SELECT * FROM productos p WHERE ${conds.join(' AND ')} ORDER BY p.descripcion`).all(...params);
  const datos = productos.map(p => ({
    'Código': p.codigo, 'Descripción': p.descripcion, 'Categoría': p.categoria,
    'Unidad': p.unidad, 'Stock': p.stock_actual, 'Disponible': p.stock_actual > 0 ? 'Sí' : 'No',
    'Mínimo': p.stock_minimo, 'Ubicación': p.ubicacion,
    'Precio costo': p.precio_costo, 'Precio venta': p.precio_venta,
  }));
  const ws = XLSX.utils.json_to_sheet(datos);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Stock');
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition',`attachment; filename=stock_${new Date().toISOString().slice(0,10)}.xlsx`);
  res.send(XLSX.write(wb, { type:'buffer', bookType:'xlsx' }));
});

// ── Exportar historial filtrado ────────────────────────────────────────────────
router.get('/exportar-historial', verificarToken, (req, res) => {
  const { tipo, desde, hasta, campo, valor } = req.query;
  const conds = [], params = [];
  if (tipo)  { conds.push('m.tipo=?');  params.push(tipo); }
  if (desde) { conds.push('m.fecha>=?'); params.push(desde); }
  if (hasta) { conds.push('m.fecha<=?'); params.push(hasta); }
  if (campo && valor) {
    const v = `%${valor}%`;
    const mapa = { codigo:'m_p.codigo LIKE ?', descripcion:'m_p.descripcion LIKE ?',
      proveedor:'m.proveedor LIKE ?', proyecto:'m.proyecto LIKE ?',
      cliente_interno:'m.cliente_interno LIKE ?' };
    if (mapa[campo]) { conds.push(mapa[campo]); params.push(v); }
    else { conds.push('(m_p.codigo LIKE ? OR m_p.descripcion LIKE ? OR m.proveedor LIKE ? OR m.proyecto LIKE ? OR m.cliente_interno LIKE ?)'); params.push(v,v,v,v,v); }
  }
  const where = conds.length ? 'WHERE '+conds.join(' AND ') : '';
  const movs = db.prepare(`
    SELECT m.fecha, m_p.codigo, m_p.descripcion, m.tipo, m.cantidad, m_p.unidad,
           m.proveedor, m.precio_unit, m.proyecto, m.cliente_interno, m.observaciones
    FROM movimientos_stock m LEFT JOIN productos m_p ON m.producto_id=m_p.id
    ${where} ORDER BY m.fecha DESC, m.created_at DESC
  `).all(...params);
  const datos = movs.map(m => ({
    'Fecha': m.fecha, 'Código': m.codigo, 'Descripción': m.descripcion,
    'Tipo': m.tipo, 'Cantidad': m.cantidad, 'Unidad': m.unidad,
    'Proveedor': m.proveedor, 'Precio Unit.': m.precio_unit,
    'Proyecto': m.proyecto, 'Cliente Int.': m.cliente_interno, 'Observaciones': m.observaciones,
  }));
  const ws = XLSX.utils.json_to_sheet(datos);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Historial');
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition',`attachment; filename=historial_${new Date().toISOString().slice(0,10)}.xlsx`);
  res.send(XLSX.write(wb, { type:'buffer', bookType:'xlsx' }));
});

// ── Migración masiva de productos ──────────────────────────────────────────────
router.post('/migrar', verificarToken, (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
  const { productos } = req.body;
  if (!Array.isArray(productos) || !productos.length) return res.status(400).json({ error: 'Se requiere array de productos' });
  const hoy = new Date().toISOString().slice(0,10);
  let creados = 0, actualizados = 0;
  const insP = db.prepare(`INSERT INTO productos (codigo,descripcion,categoria,unidad,stock_actual,stock_minimo,ubicacion) VALUES (?,?,?,?,?,?,?)`);
  const updP = db.prepare(`UPDATE productos SET descripcion=?,categoria=?,stock_actual=?,stock_minimo=?,ubicacion=?,activo=1,updated_at=datetime('now','localtime') WHERE codigo=?`);
  const insM = db.prepare(`INSERT INTO movimientos_stock (producto_id,tipo,cantidad,fecha,observaciones,created_by) VALUES (?,?,?,?,?,?)`);
  db.transaction(() => {
    for (const p of productos) {
      const existe = db.prepare('SELECT id FROM productos WHERE codigo=?').get(p.codigo);
      if (existe) { updP.run(p.descripcion, p.categoria||'', p.stock_actual||0, p.stock_minimo||0, p.ubicacion||'', p.codigo); actualizados++; }
      else {
        const r = insP.run(p.codigo, p.descripcion, p.categoria||'', 'UND.', p.stock_actual||0, p.stock_minimo||0, p.ubicacion||'');
        if ((p.stock_actual||0) !== 0) insM.run(r.lastInsertRowid, 'ajuste', p.stock_actual, hoy, 'Saldo inicial - migración desde sistema anterior', req.usuario.id);
        creados++;
      }
    }
  })();
  res.json({ ok:true, creados, actualizados });
});

// ── Migración de movimientos históricos ────────────────────────────────────────
router.post('/migrar-movimientos', verificarToken, (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
  const { movimientos } = req.body;
  if (!Array.isArray(movimientos) || !movimientos.length) return res.status(400).json({ error: 'Se requiere array' });
  const getProd = db.prepare('SELECT id FROM productos WHERE codigo=?');
  const ins = db.prepare(`INSERT OR IGNORE INTO movimientos_stock (producto_id,tipo,cantidad,fecha,referencia,observaciones,precio_unit,proveedor,proyecto,cliente_interno,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  let importados = 0, sinProducto = 0;
  db.transaction(() => {
    for (const m of movimientos) {
      const prod = getProd.get(m.codigo_producto);
      if (!prod) { sinProducto++; continue; }
      ins.run(prod.id, m.tipo, m.cantidad, m.fecha?.slice(0,10)||'', m.referencia||'', m.observaciones||'', m.precio_unit||0, m.proveedor||'', m.proyecto||'', m.cliente_interno||'', req.usuario.id);
      importados++;
    }
  })();
  res.json({ ok:true, importados, sinProducto });
});

module.exports = router;
