const express = require('express');
const XLSX    = require('xlsx');
const { body, validationResult } = require('express-validator');
const { db }  = require('../db/database');
const { verificarToken, ESCRITURA_COMPRAS, ESCRITURA_STOCK } = require('../middleware/auth');

const router = express.Router();

// ── Proveedores ────────────────────────────────────────────────────────────────

router.get('/proveedores', verificarToken, (req, res) => {
  const { buscar } = req.query;
  const where = buscar ? "WHERE (nombre LIKE ? OR cuit LIKE ?) AND activo=1" : "WHERE activo=1";
  const params = buscar ? [`%${buscar}%`, `%${buscar}%`] : [];
  res.json(db.prepare(`SELECT * FROM proveedores ${where} ORDER BY nombre`).all(...params));
});

router.post('/proveedores', verificarToken, body('nombre').trim().notEmpty(), (req, res) => {
  if (!ESCRITURA_COMPRAS.includes(req.usuario.rol)) return res.status(403).json({ error: 'Sin permisos' });
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() });
  const { nombre, cuit, contacto, telefono, email, direccion, localidad, cp, vendedor, condicion_pago } = req.body;
  try {
    const r = db.prepare('INSERT INTO proveedores (nombre,cuit,contacto,telefono,email,direccion,localidad,cp,vendedor,condicion_pago) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(nombre, cuit||'', contacto||'', telefono||'', email||'', direccion||'', localidad||'', cp||'', vendedor||'', condicion_pago||'TRANSF. BANCARIA');
    res.status(201).json(db.prepare('SELECT * FROM proveedores WHERE id=?').get(r.lastInsertRowid));
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'El proveedor ya existe' });
    throw e;
  }
});

router.put('/proveedores/:id', verificarToken, (req, res) => {
  if (!ESCRITURA_COMPRAS.includes(req.usuario.rol)) return res.status(403).json({ error: 'Sin permisos' });
  const p = db.prepare('SELECT * FROM proveedores WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  const { nombre, cuit, contacto, telefono, email, direccion, localidad, cp, vendedor, condicion_pago } = req.body;
  db.prepare('UPDATE proveedores SET nombre=?,cuit=?,contacto=?,telefono=?,email=?,direccion=?,localidad=?,cp=?,vendedor=?,condicion_pago=? WHERE id=?')
    .run(nombre??p.nombre, cuit??p.cuit, contacto??p.contacto, telefono??p.telefono,
         email??p.email, direccion??p.direccion, localidad??p.localidad, cp??p.cp,
         vendedor??p.vendedor, condicion_pago??p.condicion_pago, req.params.id);
  res.json(db.prepare('SELECT * FROM proveedores WHERE id=?').get(req.params.id));
});

// ── Órdenes de Compra ─────────────────────────────────────────────────────────

function nextNumeroOC() {
  const r = db.prepare("SELECT numero FROM ordenes_compra ORDER BY CAST(numero AS INTEGER) DESC LIMIT 1").get();
  if (r) { try { return String(parseInt(r.numero)+1).padStart(6,'0'); } catch(_) {} }
  return '000001';
}

router.get('/oc', verificarToken, (req, res) => {
  const { estado, proveedor_id, desde, hasta, buscar, page=1, limit=50 } = req.query;
  const conds=[], params=[];
  if (estado)       { conds.push('o.estado=?');          params.push(estado); }
  if (proveedor_id) { conds.push('o.proveedor_id=?');    params.push(proveedor_id); }
  if (desde)        { conds.push('o.fecha>=?');           params.push(desde); }
  if (hasta)        { conds.push('o.fecha<=?');           params.push(hasta); }
  if (buscar)       { conds.push('(o.numero LIKE ? OR o.proveedor_nombre LIKE ?)'); params.push(`%${buscar}%`,`%${buscar}%`); }
  const where  = conds.length ? 'WHERE '+conds.join(' AND ') : '';
  const offset = (parseInt(page)-1)*parseInt(limit);
  const total  = db.prepare(`SELECT COUNT(*) as c FROM ordenes_compra o ${where}`).get(...params).c;
  const datos  = db.prepare(`
    SELECT o.*, COUNT(CASE WHEN i.descripcion!='' THEN 1 END) as n_items,
           SUM(i.cantidad * i.precio_final) as total_usd
    FROM ordenes_compra o LEFT JOIN oc_items i ON o.id=i.oc_id
    ${where} GROUP BY o.id ORDER BY o.id DESC LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);
  res.json({ total, pagina: parseInt(page), datos });
});

router.get('/oc/:id', verificarToken, (req, res) => {
  const oc = db.prepare('SELECT * FROM ordenes_compra WHERE id=?').get(req.params.id);
  if (!oc) return res.status(404).json({ error: 'OC no encontrada' });
  const items = db.prepare('SELECT * FROM oc_items WHERE oc_id=? ORDER BY item_num').all(oc.id);
  res.json({ ...oc, items });
});

router.post('/oc', verificarToken, body('proveedor_nombre').trim().notEmpty(), (req, res) => {
  if (!ESCRITURA_COMPRAS.includes(req.usuario.rol)) return res.status(403).json({ error: 'Sin permisos' });
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() });

  const { proveedor_id, proveedor_nombre, proveedor_cuit, fecha, moneda, tasa_cambio,
          autorizado_por, elaborado_por, condicion_pago, lugar_entrega, presupuesto_n, observaciones, items } = req.body;

  const numero = nextNumeroOC();
  const trx = db.transaction(() => {
    const r = db.prepare(`INSERT INTO ordenes_compra (numero,fecha,proveedor_id,proveedor_nombre,proveedor_cuit,moneda,tasa_cambio,autorizado_por,elaborado_por,condicion_pago,lugar_entrega,presupuesto_n,observaciones,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(numero, fecha||new Date().toISOString().slice(0,10), proveedor_id||null, proveedor_nombre,
           proveedor_cuit||'', moneda||'DÓLAR', tasa_cambio||0, autorizado_por||'', elaborado_por||'',
           condicion_pago||'TRANSF. BANCARIA', lugar_entrega||'e-intra', presupuesto_n||'', observaciones||'', req.usuario.id);
    const oc_id = r.lastInsertRowid;
    if (items?.length) {
      for (const [i, it] of items.entries()) {
        db.prepare('INSERT INTO oc_items (oc_id,item_num,producto_id,cantidad,unidad,descripcion,precio_unitario,bonif1,bonif2,bonif3,bonif4,precio_final,plazo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(oc_id, i+1, it.producto_id||null, it.cantidad||0, it.unidad||'UND.', it.descripcion||'',
               it.precio_unitario||0, it.bonif1||0, it.bonif2||0, it.bonif3||0, it.bonif4||0, it.precio_final||0, it.plazo||'INMEDIATO');
      }
    }
    return oc_id;
  });
  const oc_id = trx();
  const oc = db.prepare('SELECT * FROM ordenes_compra WHERE id=?').get(oc_id);
  res.status(201).json({ ...oc, items: db.prepare('SELECT * FROM oc_items WHERE oc_id=? ORDER BY item_num').all(oc_id) });
});

router.put('/oc/:id', verificarToken, (req, res) => {
  if (!ESCRITURA_COMPRAS.includes(req.usuario.rol)) return res.status(403).json({ error: 'Sin permisos' });
  const oc = db.prepare('SELECT * FROM ordenes_compra WHERE id=?').get(req.params.id);
  if (!oc) return res.status(404).json({ error: 'OC no encontrada' });

  const { proveedor_id, proveedor_nombre, proveedor_cuit, fecha, moneda, tasa_cambio,
          autorizado_por, elaborado_por, condicion_pago, lugar_entrega, presupuesto_n,
          observaciones, estado, items } = req.body;

  const trx = db.transaction(() => {
    db.prepare(`UPDATE ordenes_compra SET proveedor_id=?,proveedor_nombre=?,proveedor_cuit=?,fecha=?,moneda=?,tasa_cambio=?,autorizado_por=?,elaborado_por=?,condicion_pago=?,lugar_entrega=?,presupuesto_n=?,observaciones=?,estado=?,updated_at=datetime('now','localtime') WHERE id=?`)
      .run(proveedor_id??oc.proveedor_id, proveedor_nombre??oc.proveedor_nombre, proveedor_cuit??oc.proveedor_cuit,
           fecha??oc.fecha, moneda??oc.moneda, tasa_cambio??oc.tasa_cambio, autorizado_por??oc.autorizado_por,
           elaborado_por??oc.elaborado_por, condicion_pago??oc.condicion_pago, lugar_entrega??oc.lugar_entrega,
           presupuesto_n??oc.presupuesto_n, observaciones??oc.observaciones, estado??oc.estado, req.params.id);
    if (items) {
      db.prepare('DELETE FROM oc_items WHERE oc_id=?').run(req.params.id);
      for (const [i, it] of items.entries()) {
        db.prepare('INSERT INTO oc_items (oc_id,item_num,producto_id,cantidad,unidad,descripcion,precio_unitario,bonif1,bonif2,bonif3,bonif4,precio_final,plazo,cant_recibida) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(req.params.id, i+1, it.producto_id||null, it.cantidad||0, it.unidad||'UND.', it.descripcion||'',
               it.precio_unitario||0, it.bonif1||0, it.bonif2||0, it.bonif3||0, it.bonif4||0, it.precio_final||0, it.plazo||'INMEDIATO', it.cant_recibida||0);
      }
    }
  });
  trx();
  const updated = db.prepare('SELECT * FROM ordenes_compra WHERE id=?').get(req.params.id);
  res.json({ ...updated, items: db.prepare('SELECT * FROM oc_items WHERE oc_id=? ORDER BY item_num').all(req.params.id) });
});

// Recibir OC → actualiza stock automáticamente
router.post('/oc/:id/recibir', verificarToken, (req, res) => {
  if (![...ESCRITURA_COMPRAS, ...ESCRITURA_STOCK].some(r => r === req.usuario.rol))
    return res.status(403).json({ error: 'Sin permisos' });

  const oc    = db.prepare('SELECT * FROM ordenes_compra WHERE id=?').get(req.params.id);
  if (!oc) return res.status(404).json({ error: 'OC no encontrada' });
  if (oc.estado === 'Cancelada') return res.status(400).json({ error: 'OC cancelada' });

  const items = db.prepare('SELECT * FROM oc_items WHERE oc_id=? AND producto_id IS NOT NULL').all(oc.id);
  const { recepciones, fecha } = req.body;
  const fechaRec = fecha || new Date().toISOString().slice(0,10);

  const trx = db.transaction(() => {
    let todosRecibidos = true;
    for (const item of items) {
      const cantRecibir = recepciones?.[item.id] ?? (item.cantidad - item.cant_recibida);
      if (cantRecibir <= 0) continue;
      const pendiente = item.cantidad - item.cant_recibida;
      if (pendiente <= 0) continue;
      const real = Math.min(cantRecibir, pendiente);
      db.prepare("UPDATE oc_items SET cant_recibida=cant_recibida+? WHERE id=?").run(real, item.id);
      db.prepare("UPDATE productos SET stock_actual=stock_actual+?, updated_at=datetime('now','localtime') WHERE id=?").run(real, item.producto_id);
      db.prepare("INSERT INTO movimientos_stock (producto_id,tipo,cantidad,fecha,referencia,tipo_doc,doc_id,precio_unit,observaciones,created_by) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run(item.producto_id, 'entrada', real, fechaRec, oc.numero, 'oc', oc.id, item.precio_final||0, `Recepción OC ${oc.numero}`, req.usuario.id);
      const itemActual = db.prepare('SELECT * FROM oc_items WHERE id=?').get(item.id);
      if (itemActual.cant_recibida < item.cantidad) todosRecibidos = false;
    }
    const nuevoEstado = todosRecibidos ? 'Recibida' : 'Parcial';
    db.prepare("UPDATE ordenes_compra SET estado=?,updated_at=datetime('now','localtime') WHERE id=?").run(nuevoEstado, oc.id);
  });
  trx();
  res.json({ mensaje: 'Recepción registrada. Stock actualizado.' });
});

router.delete('/oc/:id', verificarToken, (req, res) => {
  if (!ESCRITURA_COMPRAS.includes(req.usuario.rol)) return res.status(403).json({ error: 'Sin permisos' });
  db.prepare('DELETE FROM oc_items WHERE oc_id=?').run(req.params.id);
  db.prepare('DELETE FROM ordenes_compra WHERE id=?').run(req.params.id);
  res.json({ mensaje: 'OC eliminada' });
});

router.get('/exportar/oc', verificarToken, (req, res) => {
  const { estado } = req.query;
  const where = estado ? 'WHERE o.estado=?' : '';
  const ocs = db.prepare(`SELECT o.*, COUNT(i.id) as n_items FROM ordenes_compra o LEFT JOIN oc_items i ON o.id=i.oc_id ${where} GROUP BY o.id ORDER BY o.id DESC`).all(...(estado?[estado]:[]));
  const datos = ocs.map(o => ({ 'N° OC': o.numero, 'Fecha': o.fecha, 'Proveedor': o.proveedor_nombre, 'Estado': o.estado, 'Moneda': o.moneda, 'Ítems': o.n_items }));
  const ws = XLSX.utils.json_to_sheet(datos);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Compras');
  const buf = XLSX.write(wb, { type:'buffer', bookType:'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=compras_${new Date().toISOString().slice(0,10)}.xlsx`);
  res.send(buf);
});

module.exports = router;
