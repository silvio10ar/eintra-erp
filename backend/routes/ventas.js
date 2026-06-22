const express = require('express');
const XLSX    = require('xlsx');
const { body, validationResult } = require('express-validator');
const { db }  = require('../db/database');
const { verificarToken, ESCRITURA_VENTAS } = require('../middleware/auth');
const { buscarCondicion } = require('../helpers/buscar');

const router = express.Router();

const puedeEscribirAdmin = (req) => req.usuario?.rol === 'admin' || req.permisos?.ventas?.escribir || req.permisos?.administracion?.escribir;

// ── Stats ─────────────────────────────────────────────────────────────────────
router.get('/stats', verificarToken, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) c FROM presupuestos').get().c
  const porEstado = db.prepare(`
    SELECT estado, COUNT(*) c,
      SUM(COALESCE((SELECT SUM(cantidad*precio_final) FROM presupuesto_items WHERE presupuesto_id=presupuestos.id),0)) monto
    FROM presupuestos GROUP BY estado
  `).all()
  const porMes = db.prepare(`
    SELECT SUBSTR(fecha,1,7) mes, COUNT(*) c,
      SUM(COALESCE((SELECT SUM(cantidad*precio_final) FROM presupuesto_items WHERE presupuesto_id=presupuestos.id),0)) monto
    FROM presupuestos WHERE fecha >= date('now','-12 months') AND fecha != ''
    GROUP BY mes ORDER BY mes DESC
  `).all()
  res.json({ total, porEstado, porMes })
})

// ── Clientes ──────────────────────────────────────────────────────────────────

router.get('/clientes', verificarToken, (req, res) => {
  const { buscar, todos } = req.query;
  const soloActivos = todos !== '1';
  let where = soloActivos ? 'WHERE activo=1' : '';
  const params = [];
  if (buscar) {
    const b = buscarCondicion(buscar, ['nombre', 'cuit']);
    where = soloActivos ? `WHERE (${b.cond}) AND activo=1` : `WHERE (${b.cond})`;
    params.push(...b.params);
  }
  res.json(db.prepare(`SELECT * FROM clientes ${where} ORDER BY nombre`).all(...params));
});

router.post('/clientes', verificarToken, body('nombre').trim().notEmpty(), (req, res) => {
  if (!puedeEscribirAdmin(req)) return res.status(403).json({ error: 'Sin permisos' });
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() });
  const { nombre, cuit, contacto, telefono, email, direccion, localidad, cp, condicion_pago } = req.body;
  try {
    const r = db.prepare('INSERT INTO clientes (nombre,cuit,contacto,telefono,email,direccion,localidad,cp,condicion_pago) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(nombre, cuit||'', contacto||'', telefono||'', email||'', direccion||'', localidad||'', cp||'', condicion_pago||'');
    res.status(201).json(db.prepare('SELECT * FROM clientes WHERE id=?').get(r.lastInsertRowid));
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'El cliente ya existe' });
    throw e;
  }
});

router.put('/clientes/:id', verificarToken, (req, res) => {
  if (!puedeEscribirAdmin(req)) return res.status(403).json({ error: 'Sin permisos' });
  const c = db.prepare('SELECT * FROM clientes WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'No encontrado' });
  const { nombre, cuit, contacto, telefono, email, direccion, localidad, cp, condicion_pago } = req.body;
  db.prepare('UPDATE clientes SET nombre=?,cuit=?,contacto=?,telefono=?,email=?,direccion=?,localidad=?,cp=?,condicion_pago=? WHERE id=?')
    .run(nombre??c.nombre, cuit??c.cuit, contacto??c.contacto, telefono??c.telefono,
         email??c.email, direccion??c.direccion, localidad??c.localidad, cp??c.cp,
         condicion_pago??c.condicion_pago, req.params.id);
  res.json(db.prepare('SELECT * FROM clientes WHERE id=?').get(req.params.id));
});

router.delete('/clientes/:id', verificarToken, (req, res) => {
  if (!puedeEscribirAdmin(req)) return res.status(403).json({ error: 'Sin permisos' });
  const c = db.prepare('SELECT * FROM clientes WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'No encontrado' });
  const nuevoActivo = c.activo ? 0 : 1;
  db.prepare('UPDATE clientes SET activo=? WHERE id=?').run(nuevoActivo, req.params.id);
  res.json({ ok: true, activo: nuevoActivo });
});

// ── Presupuestos ──────────────────────────────────────────────────────────────

function nextNumeroPpto() {
  const r = db.prepare("SELECT numero FROM presupuestos ORDER BY CAST(numero AS INTEGER) DESC LIMIT 1").get();
  if (r) { try { return String(parseInt(r.numero)+1).padStart(6,'0'); } catch(_) {} }
  return '000001';
}

router.get('/presupuestos', verificarToken, (req, res) => {
  const { estado, cliente_id, desde, hasta, buscar, page=1, limit=50 } = req.query;
  const conds=[], params=[];
  if (estado)     { conds.push('p.estado=?');         params.push(estado); }
  if (cliente_id) { conds.push('p.cliente_id=?');     params.push(cliente_id); }
  if (desde)      { conds.push('p.fecha>=?');          params.push(desde); }
  if (hasta)      { conds.push('p.fecha<=?');          params.push(hasta); }
  if (buscar)     { const b = buscarCondicion(buscar, ['p.numero','p.cli_nombre']); conds.push(b.cond); params.push(...b.params); }
  const where  = conds.length ? 'WHERE '+conds.join(' AND ') : '';
  const offset = (parseInt(page)-1)*parseInt(limit);
  const total  = db.prepare(`SELECT COUNT(*) as c FROM presupuestos p ${where}`).get(...params).c;
  const datos  = db.prepare(`
    SELECT p.*, COUNT(i.id) as n_items, SUM(i.cantidad*i.precio_final) as total_usd
    FROM presupuestos p LEFT JOIN presupuesto_items i ON p.id=i.presupuesto_id
    ${where} GROUP BY p.id ORDER BY p.id DESC LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);
  res.json({ total, datos });
});

router.get('/presupuestos/:id', verificarToken, (req, res) => {
  const p = db.prepare('SELECT * FROM presupuestos WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  const items = db.prepare('SELECT * FROM presupuesto_items WHERE presupuesto_id=? ORDER BY item_num').all(p.id);
  res.json({ ...p, items });
});

router.post('/presupuestos', verificarToken, body('cli_nombre').trim().notEmpty(), (req, res) => {
  if (!puedeEscribirAdmin(req)) return res.status(403).json({ error: 'Sin permisos' });
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() });

  const { cliente_id, cli_nombre, cli_cuit, cli_contacto, cli_telefono, cli_email,
          cli_direccion, cli_localidad, fecha, validez, estado, moneda, tasa_cambio,
          condicion_pago, lugar_entrega, elaborado_por, observaciones, items } = req.body;

  const numero = nextNumeroPpto();
  const trx = db.transaction(() => {
    const r = db.prepare(`INSERT INTO presupuestos (numero,fecha,validez,cliente_id,cli_nombre,cli_cuit,cli_contacto,cli_telefono,cli_email,cli_direccion,cli_localidad,estado,moneda,tasa_cambio,condicion_pago,lugar_entrega,elaborado_por,observaciones,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(numero, fecha||new Date().toISOString().slice(0,10), validez||'30 días',
           cliente_id||null, cli_nombre, cli_cuit||'', cli_contacto||'', cli_telefono||'',
           cli_email||'', cli_direccion||'', cli_localidad||'', estado||'Borrador',
           moneda||'DÓLAR', tasa_cambio||0, condicion_pago||'TRANSFERENCIA BANCARIA',
           lugar_entrega||'E-INTRA', elaborado_por||'', observaciones||'', req.usuario.id);
    const ppto_id = r.lastInsertRowid;
    if (items?.length) {
      for (const [i, it] of items.entries()) {
        db.prepare('INSERT INTO presupuesto_items (presupuesto_id,item_num,cantidad,unidad,descripcion,precio_unitario,bonif1,bonif2,bonif3,bonif4,precio_final,plazo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(ppto_id, i+1, it.cantidad||0, it.unidad||'UND.', it.descripcion||'',
               it.precio_unitario||0, it.bonif1||0, it.bonif2||0, it.bonif3||0, it.bonif4||0, it.precio_final||0, it.plazo||'A CONVENIR');
      }
    }
    return ppto_id;
  });
  const ppto_id = trx();
  const ppto = db.prepare('SELECT * FROM presupuestos WHERE id=?').get(ppto_id);
  res.status(201).json({ ...ppto, items: db.prepare('SELECT * FROM presupuesto_items WHERE presupuesto_id=? ORDER BY item_num').all(ppto_id) });
});

router.put('/presupuestos/:id', verificarToken, (req, res) => {
  if (!puedeEscribirAdmin(req)) return res.status(403).json({ error: 'Sin permisos' });
  const p = db.prepare('SELECT * FROM presupuestos WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });

  const { cliente_id, cli_nombre, cli_cuit, cli_contacto, cli_telefono, cli_email,
          cli_direccion, cli_localidad, fecha, validez, estado, moneda, tasa_cambio,
          condicion_pago, lugar_entrega, elaborado_por, observaciones, items } = req.body;

  const trx = db.transaction(() => {
    db.prepare(`UPDATE presupuestos SET cliente_id=?,cli_nombre=?,cli_cuit=?,cli_contacto=?,cli_telefono=?,cli_email=?,cli_direccion=?,cli_localidad=?,fecha=?,validez=?,estado=?,moneda=?,tasa_cambio=?,condicion_pago=?,lugar_entrega=?,elaborado_por=?,observaciones=?,updated_at=datetime('now','localtime') WHERE id=?`)
      .run(cliente_id??p.cliente_id, cli_nombre??p.cli_nombre, cli_cuit??p.cli_cuit,
           cli_contacto??p.cli_contacto, cli_telefono??p.cli_telefono, cli_email??p.cli_email,
           cli_direccion??p.cli_direccion, cli_localidad??p.cli_localidad,
           fecha??p.fecha, validez??p.validez, estado??p.estado,
           moneda??p.moneda, tasa_cambio??p.tasa_cambio, condicion_pago??p.condicion_pago,
           lugar_entrega??p.lugar_entrega, elaborado_por??p.elaborado_por,
           observaciones??p.observaciones, req.params.id);
    if (items) {
      db.prepare('DELETE FROM presupuesto_items WHERE presupuesto_id=?').run(req.params.id);
      for (const [i, it] of items.entries()) {
        db.prepare('INSERT INTO presupuesto_items (presupuesto_id,item_num,cantidad,unidad,descripcion,precio_unitario,bonif1,bonif2,bonif3,bonif4,precio_final,plazo) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(req.params.id, i+1, it.cantidad||0, it.unidad||'UND.', it.descripcion||'',
               it.precio_unitario||0, it.bonif1||0, it.bonif2||0, it.bonif3||0, it.bonif4||0, it.precio_final||0, it.plazo||'A CONVENIR');
      }
    }
  });
  trx();
  const updated = db.prepare('SELECT * FROM presupuestos WHERE id=?').get(req.params.id);
  res.json({ ...updated, items: db.prepare('SELECT * FROM presupuesto_items WHERE presupuesto_id=? ORDER BY item_num').all(req.params.id) });
});

router.delete('/presupuestos/:id', verificarToken, (req, res) => {
  if (!puedeEscribirAdmin(req)) return res.status(403).json({ error: 'Sin permisos' });
  db.prepare('DELETE FROM presupuesto_items WHERE presupuesto_id=?').run(req.params.id);
  db.prepare('DELETE FROM presupuestos WHERE id=?').run(req.params.id);
  res.json({ mensaje: 'Presupuesto eliminado' });
});

// ── Ofertas Técnicas ─────────────────────────────────────────────────────────

router.get('/ofertas-tecnicas/:presupuesto_id', verificarToken, (req, res) => {
  const ot = db.prepare('SELECT * FROM ofertas_tecnicas WHERE presupuesto_id=?').get(req.params.presupuesto_id);
  if (!ot) return res.status(404).json({ error: 'No encontrada' });
  res.json(ot);
});

router.post('/ofertas-tecnicas', verificarToken, (req, res) => {
  if (!puedeEscribirAdmin(req)) return res.status(403).json({ error: 'Sin permisos' });
  const { presupuesto_id, ref_codigo, tipo_equipo, modelo, introduccion,
          principio_funcionamiento, seleccion_equipo, componentes, alcance,
          exclusiones, plazo_ejecucion, garantias, antecedentes, elaborado_por } = req.body;
  if (!presupuesto_id) return res.status(400).json({ error: 'presupuesto_id requerido' });
  try {
    const r = db.prepare(`INSERT INTO ofertas_tecnicas
      (presupuesto_id,ref_codigo,tipo_equipo,modelo,introduccion,principio_funcionamiento,
       seleccion_equipo,componentes,alcance,exclusiones,plazo_ejecucion,garantias,antecedentes,elaborado_por)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(presupuesto_id, ref_codigo||'', tipo_equipo||'', modelo||'',
           introduccion||'', principio_funcionamiento||'', seleccion_equipo||'',
           componentes||'', alcance||'', exclusiones||'', plazo_ejecucion||'',
           garantias||'', antecedentes||'', elaborado_por||'');
    res.status(201).json(db.prepare('SELECT * FROM ofertas_tecnicas WHERE id=?').get(r.lastInsertRowid));
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe OT para este presupuesto' });
    throw e;
  }
});

router.put('/ofertas-tecnicas/:presupuesto_id', verificarToken, (req, res) => {
  if (!puedeEscribirAdmin(req)) return res.status(403).json({ error: 'Sin permisos' });
  const ot = db.prepare('SELECT * FROM ofertas_tecnicas WHERE presupuesto_id=?').get(req.params.presupuesto_id);
  if (!ot) return res.status(404).json({ error: 'No encontrada' });
  const { ref_codigo, tipo_equipo, modelo, introduccion, principio_funcionamiento,
          seleccion_equipo, componentes, alcance, exclusiones, plazo_ejecucion,
          garantias, antecedentes, elaborado_por } = req.body;
  db.prepare(`UPDATE ofertas_tecnicas SET
    ref_codigo=?,tipo_equipo=?,modelo=?,introduccion=?,principio_funcionamiento=?,
    seleccion_equipo=?,componentes=?,alcance=?,exclusiones=?,plazo_ejecucion=?,
    garantias=?,antecedentes=?,elaborado_por=?,updated_at=datetime('now','localtime')
    WHERE presupuesto_id=?`)
    .run(ref_codigo??ot.ref_codigo, tipo_equipo??ot.tipo_equipo, modelo??ot.modelo,
         introduccion??ot.introduccion, principio_funcionamiento??ot.principio_funcionamiento,
         seleccion_equipo??ot.seleccion_equipo, componentes??ot.componentes,
         alcance??ot.alcance, exclusiones??ot.exclusiones, plazo_ejecucion??ot.plazo_ejecucion,
         garantias??ot.garantias, antecedentes??ot.antecedentes, elaborado_por??ot.elaborado_por,
         req.params.presupuesto_id);
  res.json(db.prepare('SELECT * FROM ofertas_tecnicas WHERE presupuesto_id=?').get(req.params.presupuesto_id));
});

router.get('/exportar/presupuestos', verificarToken, (req, res) => {
  const { estado } = req.query;
  const where = estado ? 'WHERE estado=?' : '';
  const pptos = db.prepare(`SELECT * FROM presupuestos ${where} ORDER BY id DESC`).all(...(estado?[estado]:[]));
  const ws = XLSX.utils.json_to_sheet(pptos.map(p => ({
    'N°': p.numero, 'Fecha': p.fecha, 'Cliente': p.cli_nombre,
    'Estado': p.estado, 'Validez': p.validez, 'Moneda': p.moneda,
  })));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Ventas');
  const buf = XLSX.write(wb, { type:'buffer', bookType:'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=ventas_${new Date().toISOString().slice(0,10)}.xlsx`);
  res.send(buf);
});

module.exports = router;
