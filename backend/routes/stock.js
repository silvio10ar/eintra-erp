const express = require('express');
const XLSX    = require('xlsx');
const { body, validationResult } = require('express-validator');
const { db }  = require('../db/database');
const { verificarToken, ESCRITURA_STOCK } = require('../middleware/auth');

const router = express.Router();

function puedeEscribir(rol) { return ESCRITURA_STOCK.includes(rol); }

// ── Productos ──────────────────────────────────────────────────────────────────

router.get('/productos', verificarToken, (req, res) => {
  const { buscar, categoria, alerta } = req.query;
  const conds = ['p.activo=1'], params = [];
  if (buscar) { conds.push('(p.codigo LIKE ? OR p.descripcion LIKE ?)'); params.push(`%${buscar}%`,`%${buscar}%`); }
  if (categoria) { conds.push('p.categoria=?'); params.push(categoria); }
  if (alerta === '1') conds.push('p.stock_actual <= p.stock_minimo AND p.stock_minimo > 0');
  const where = 'WHERE ' + conds.join(' AND ');
  const rows = db.prepare(`SELECT * FROM productos ${where} ORDER BY p.descripcion`).all(...params);
  res.json(rows);
});

router.get('/productos/categorias', verificarToken, (req, res) => {
  const rows = db.prepare("SELECT DISTINCT categoria FROM productos WHERE categoria!='' ORDER BY categoria").all();
  res.json(rows.map(r => r.categoria));
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
    if (!puedeEscribir(req.usuario.rol)) return res.status(403).json({ error: 'Sin permisos' });
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() });
    const { codigo, descripcion, categoria, unidad, stock_actual, stock_minimo, ubicacion, precio_costo, precio_venta } = req.body;
    try {
      const r = db.prepare(`
        INSERT INTO productos (codigo,descripcion,categoria,unidad,stock_actual,stock_minimo,ubicacion,precio_costo,precio_venta)
        VALUES (?,?,?,?,?,?,?,?,?)
      `).run(codigo, descripcion, categoria||'', unidad||'UND.', stock_actual||0, stock_minimo||0, ubicacion||'', precio_costo||0, precio_venta||0);
      res.status(201).json(db.prepare('SELECT * FROM productos WHERE id=?').get(r.lastInsertRowid));
    } catch(e) {
      if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'El código ya existe' });
      throw e;
    }
  }
);

router.put('/productos/:id', verificarToken, (req, res) => {
  if (!puedeEscribir(req.usuario.rol)) return res.status(403).json({ error: 'Sin permisos' });
  const p = db.prepare('SELECT * FROM productos WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  const { codigo, descripcion, categoria, unidad, stock_minimo, ubicacion, precio_costo, precio_venta } = req.body;
  db.prepare(`UPDATE productos SET codigo=?,descripcion=?,categoria=?,unidad=?,stock_minimo=?,ubicacion=?,precio_costo=?,precio_venta=?,updated_at=datetime('now','localtime') WHERE id=?`)
    .run(codigo??p.codigo, descripcion??p.descripcion, categoria??p.categoria, unidad??p.unidad,
         stock_minimo??p.stock_minimo, ubicacion??p.ubicacion, precio_costo??p.precio_costo,
         precio_venta??p.precio_venta, req.params.id);
  res.json(db.prepare('SELECT * FROM productos WHERE id=?').get(req.params.id));
});

router.delete('/productos/:id', verificarToken, (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  db.prepare('UPDATE productos SET activo=0 WHERE id=?').run(req.params.id);
  res.json({ mensaje: 'Producto desactivado' });
});

// ── Movimientos ────────────────────────────────────────────────────────────────

router.get('/movimientos', verificarToken, (req, res) => {
  const { producto_id, tipo, desde, hasta, buscar, page=1, limit=100 } = req.query;
  const conds = [], params = [];
  if (producto_id) { conds.push('m.producto_id=?'); params.push(producto_id); }
  if (tipo)        { conds.push('m.tipo=?');         params.push(tipo); }
  if (desde)       { conds.push('m.fecha>=?');        params.push(desde); }
  if (hasta)       { conds.push('m.fecha<=?');        params.push(hasta); }
  if (buscar)      { conds.push('(p.descripcion LIKE ? OR p.codigo LIKE ?)'); params.push(`%${buscar}%`,`%${buscar}%`); }
  const where = conds.length ? 'WHERE '+conds.join(' AND ') : '';
  const offset = (parseInt(page)-1)*parseInt(limit);
  const total = db.prepare(`SELECT COUNT(*) as c FROM movimientos_stock m LEFT JOIN productos p ON m.producto_id=p.id ${where}`).get(...params).c;
  const rows  = db.prepare(`
    SELECT m.*, p.codigo, p.descripcion, p.unidad
    FROM movimientos_stock m LEFT JOIN productos p ON m.producto_id=p.id
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
    if (!puedeEscribir(req.usuario.rol)) return res.status(403).json({ error: 'Sin permisos' });
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() });

    const { producto_id, tipo, cantidad, fecha, referencia, tipo_doc, doc_id, precio_unit, observaciones } = req.body;
    const p = db.prepare('SELECT * FROM productos WHERE id=? AND activo=1').get(producto_id);
    if (!p) return res.status(404).json({ error: 'Producto no encontrado' });

    const delta = (tipo === 'salida') ? -cantidad : cantidad;
    const nuevoStock = p.stock_actual + delta;
    if (tipo === 'salida' && nuevoStock < 0)
      return res.status(400).json({ error: `Stock insuficiente. Disponible: ${p.stock_actual}` });

    const trx = db.transaction(() => {
      db.prepare(`INSERT INTO movimientos_stock (producto_id,tipo,cantidad,fecha,referencia,tipo_doc,doc_id,precio_unit,observaciones,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(producto_id, tipo, cantidad, fecha, referencia||'', tipo_doc||'', doc_id||null, precio_unit||0, observaciones||'', req.usuario.id);
      db.prepare("UPDATE productos SET stock_actual=stock_actual+?, updated_at=datetime('now','localtime') WHERE id=?")
        .run(delta, producto_id);
    });
    trx();

    res.status(201).json({
      stock_nuevo: nuevoStock,
      mensaje: `Movimiento registrado. Stock actualizado: ${nuevoStock}`
    });
  }
);

// ── Exportar ───────────────────────────────────────────────────────────────────

router.get('/exportar', verificarToken, (req, res) => {
  const productos = db.prepare('SELECT * FROM productos WHERE activo=1 ORDER BY descripcion').all();
  const datos = productos.map(p => ({
    'Código': p.codigo, 'Descripción': p.descripcion, 'Categoría': p.categoria,
    'Unidad': p.unidad, 'Stock actual': p.stock_actual, 'Stock mínimo': p.stock_minimo,
    'Ubicación': p.ubicacion, 'Precio costo': p.precio_costo, 'Precio venta': p.precio_venta,
  }));
  const ws = XLSX.utils.json_to_sheet(datos);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Stock');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=stock_${new Date().toISOString().slice(0,10)}.xlsx`);
  res.send(buf);
});

module.exports = router;
