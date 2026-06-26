const express = require('express');
const XLSX    = require('xlsx');
const { db }  = require('../db/database');
const { verificarToken, ESCRITURA_FINANZAS } = require('../middleware/auth');
const { buscarCondicion } = require('../helpers/buscar');

const router = express.Router();

const puedeEscribir = req =>
  req.usuario?.rol === 'admin' ||
  req.permisos?.finanzas?.escribir ||
  req.permisos?.administracion?.escribir

// ── Dashboard ─────────────────────────────────────────────────────────────────

router.get('/dashboard', verificarToken, (req, res) => {
  const hoy = new Date().toISOString().slice(0, 10)
  const { desde = '', hasta = hoy } = req.query
  const filtC = desde ? 'fecha >= ? AND fecha <= ?' : 'fecha <= ?'
  const argsC = desde ? [desde, hasta] : [hasta]

  const kpiC = db.prepare(`
    SELECT COUNT(*) as count,
      COALESCE(SUM(importe * tasa_cambio),0) as total,
      COALESCE(SUM(CASE WHEN pago_confirmado=1 THEN importe * tasa_cambio ELSE 0 END),0) as pagado,
      COALESCE(SUM(CASE WHEN pago_confirmado=0 AND (anticipo IS NULL OR anticipo=0) THEN importe * tasa_cambio ELSE 0 END),0) as pendiente,
      COALESCE(SUM(CASE WHEN pago_confirmado=0 AND anticipo>0 THEN importe * tasa_cambio ELSE 0 END),0) as con_anticipo,
      COALESCE(SUM(CASE WHEN pago_confirmado=0 AND anticipo>0 THEN (importe-anticipo) * tasa_cambio ELSE 0 END),0) as saldo_anticipo
    FROM facturas_compra WHERE ${filtC}`).get(...argsC)

  const kpiV = db.prepare(`
    SELECT COUNT(*) as count,
      COALESCE(SUM(importe * tasa_cambio),0) as total,
      COALESCE(SUM(CASE WHEN pago_confirmado=1 THEN importe * tasa_cambio ELSE 0 END),0) as pagado,
      COALESCE(SUM(CASE WHEN pago_confirmado=0 AND (anticipo IS NULL OR anticipo=0) THEN importe * tasa_cambio ELSE 0 END),0) as pendiente,
      COALESCE(SUM(CASE WHEN pago_confirmado=0 AND anticipo>0 THEN importe * tasa_cambio ELSE 0 END),0) as con_anticipo,
      COALESCE(SUM(CASE WHEN pago_confirmado=0 AND anticipo>0 THEN (importe-anticipo) * tasa_cambio ELSE 0 END),0) as saldo_anticipo
    FROM facturas_venta WHERE ${filtC}`).get(...argsC)

  // Últimos 12 meses para el gráfico
  const porMesC = db.prepare(`
    SELECT strftime('%Y-%m', fecha) as mes, COALESCE(SUM(importe * tasa_cambio),0) as total, COUNT(*) as count
    FROM facturas_compra WHERE fecha >= date('now','-11 months','start of month') AND fecha <= ?
    GROUP BY mes ORDER BY mes`).all(hasta)

  const porMesV = db.prepare(`
    SELECT strftime('%Y-%m', fecha) as mes, COALESCE(SUM(importe * tasa_cambio),0) as total, COUNT(*) as count
    FROM facturas_venta WHERE fecha >= date('now','-11 months','start of month') AND fecha <= ?
    GROUP BY mes ORDER BY mes`).all(hasta)

  // Por cobrar total real (usando tabla de pagos, sin filtro de período)
  const kpiVTotal = db.prepare(`
    SELECT
      COALESCE(SUM(
        CASE WHEN fv.pago_confirmado=0
          THEN (fv.importe * fv.tasa_cambio) - COALESCE(pag.total_pagado, 0)
          ELSE 0 END
      ), 0) as pendiente,
      0 as saldo_anticipo
    FROM facturas_venta fv
    LEFT JOIN (
      SELECT factura_id, SUM(CASE WHEN estado='confirmado' THEN importe ELSE 0 END) AS total_pagado
      FROM pagos_factura_venta GROUP BY factura_id
    ) pag ON pag.factura_id = fv.id
    WHERE fv.tipo_factura NOT LIKE 'NC%'`).get()

  // Próximos vencimientos (30 días)
  const vencimientos = db.prepare(`
    SELECT 'compra' as tipo, id, numero, proveedor_nombre as nombre, importe, moneda, tasa_cambio, fecha_vencimiento, anticipo
    FROM facturas_compra WHERE pago_confirmado=0 AND fecha_vencimiento > '' AND fecha_vencimiento BETWEEN date('now') AND date('now','+30 days')
    UNION ALL
    SELECT 'venta', id, numero, cliente_nombre, importe, moneda, tasa_cambio, fecha_vencimiento, anticipo
    FROM facturas_venta WHERE pago_confirmado=0 AND fecha_vencimiento > '' AND fecha_vencimiento BETWEEN date('now') AND date('now','+30 days')
    ORDER BY fecha_vencimiento LIMIT 15`).all()

  // Facturas con anticipo (saldo pendiente)
  const conAnticipo = db.prepare(`
    SELECT 'compra' as tipo, id, numero, proveedor_nombre as nombre, importe, moneda, tasa_cambio, anticipo, fecha_anticipo
    FROM facturas_compra WHERE pago_confirmado=0 AND anticipo>0
    UNION ALL
    SELECT 'venta', id, numero, cliente_nombre, importe, moneda, tasa_cambio, anticipo, fecha_anticipo
    FROM facturas_venta WHERE pago_confirmado=0 AND anticipo>0
    ORDER BY fecha_anticipo DESC LIMIT 10`).all()

  // Top proveedores del período
  const topProv = db.prepare(`
    SELECT proveedor_nombre as nombre, COUNT(*) as count, COALESCE(SUM(importe * tasa_cambio),0) as total
    FROM facturas_compra WHERE ${filtC} AND proveedor_nombre != ''
    GROUP BY proveedor_nombre ORDER BY total DESC LIMIT 8`).all(...argsC)

  res.json({ kpiC, kpiV, kpiVTotal, porMesC, porMesV, vencimientos, conAnticipo, topProv })
})

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
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
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
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
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
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
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
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
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
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
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
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
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
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
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

// ── Facturas de Compra ────────────────────────────────────────────────────────

router.get('/facturas-compra', verificarToken, (req, res) => {
  const { buscar, desde, hasta, moneda, pago } = req.query;
  const conds = [], params = [];
  if (desde)  { conds.push('fecha >= ?');  params.push(desde); }
  if (hasta)  { conds.push('fecha <= ?');  params.push(hasta); }
  if (moneda) { conds.push('moneda = ?');  params.push(moneda); }
  if (pago === '1') { conds.push('pago_confirmado = 1'); }
  if (pago === '0') { conds.push('pago_confirmado = 0'); }
  if (buscar) {
    const b = buscar.trim().toLowerCase();
    conds.push("(LOWER(numero) LIKE ? OR LOWER(proveedor_nombre) LIKE ? OR LOWER(ref_doc) LIKE ?)");
    params.push(`%${b}%`, `%${b}%`, `%${b}%`);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT 'manual' AS fuente, f.id, f.tipo_factura, f.numero, f.fecha,
      f.proveedor_nombre, f.proveedor_id, f.cuit,
      f.oc_id, COALESCE(f.oc_numero,'') AS ref_doc,
      f.neto_gravado, f.no_grav_exento,
      f.iva_21, f.iva_10_5, f.iva_27, f.otros_imp, f.perc_iva, f.perc_iibb,
      f.importe, f.moneda, f.tasa_cambio, f.fecha_vencimiento, f.pago_confirmado,
      f.anticipo, f.fecha_anticipo, f.observaciones, f.updated_at
    FROM facturas_compra f
  `).all();

  // Filtrar en JS para evitar sub-select complejo con WHERE en UNION
  let result = rows;
  if (desde)  result = result.filter(r => r.fecha >= desde);
  if (hasta)  result = result.filter(r => r.fecha <= hasta);
  if (moneda) result = result.filter(r => r.moneda === moneda);
  if (pago === '1') result = result.filter(r => r.pago_confirmado === 1);
  if (pago === '0') result = result.filter(r => r.pago_confirmado === 0);
  if (buscar) {
    const b = buscar.trim().toLowerCase();
    result = result.filter(r =>
      (r.numero||'').toLowerCase().includes(b) ||
      (r.proveedor_nombre||'').toLowerCase().includes(b) ||
      (r.ref_doc||'').toLowerCase().includes(b)
    );
  }
  result.sort((a, b) => (b.fecha||'').localeCompare(a.fecha||'') || b.id - a.id);
  res.json(result);
});

router.post('/facturas-compra', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const { tipo_factura, numero, fecha, proveedor_id, proveedor_nombre, cuit, oc_id, oc_numero,
          neto_gravado, no_grav_exento, iva_21, iva_10_5, iva_27, otros_imp, perc_iva, perc_iibb,
          importe, moneda, tasa_cambio, fecha_vencimiento, observaciones } = req.body;
  if (!numero?.trim()) return res.status(400).json({ error: 'Número requerido' });
  const r = db.prepare(`INSERT INTO facturas_compra
    (tipo_factura,numero,fecha,proveedor_id,proveedor_nombre,cuit,oc_id,oc_numero,
     neto_gravado,no_grav_exento,iva_21,iva_10_5,iva_27,otros_imp,perc_iva,perc_iibb,
     importe,moneda,tasa_cambio,fecha_vencimiento,observaciones,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(tipo_factura||'A', numero.trim(), fecha||'', proveedor_id||null, proveedor_nombre||'', cuit||'',
         oc_id||null, oc_numero||'',
         parseFloat(neto_gravado)||0, parseFloat(no_grav_exento)||0,
         parseFloat(iva_21)||0, parseFloat(iva_10_5)||0, parseFloat(iva_27)||0,
         parseFloat(otros_imp)||0, parseFloat(perc_iva)||0, parseFloat(perc_iibb)||0,
         parseFloat(importe)||0, moneda||'PESO', parseFloat(tasa_cambio)||1,
         fecha_vencimiento||'', observaciones||'', req.usuario.id);
  res.status(201).json(db.prepare('SELECT * FROM facturas_compra WHERE id=?').get(r.lastInsertRowid));
});

router.put('/facturas-compra/:id', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const f = db.prepare('SELECT * FROM facturas_compra WHERE id=?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'No encontrada' });
  const { tipo_factura, numero, fecha, proveedor_id, proveedor_nombre, cuit, oc_id, oc_numero,
          neto_gravado, no_grav_exento, iva_21, iva_10_5, iva_27, otros_imp, perc_iva, perc_iibb,
          importe, moneda, tasa_cambio, fecha_vencimiento, observaciones } = req.body;
  db.prepare(`UPDATE facturas_compra SET
    tipo_factura=?,numero=?,fecha=?,proveedor_id=?,proveedor_nombre=?,cuit=?,oc_id=?,oc_numero=?,
    neto_gravado=?,no_grav_exento=?,iva_21=?,iva_10_5=?,iva_27=?,otros_imp=?,perc_iva=?,perc_iibb=?,
    importe=?,moneda=?,tasa_cambio=?,fecha_vencimiento=?,observaciones=?,updated_at=datetime('now','localtime')
    WHERE id=?`)
    .run(tipo_factura??f.tipo_factura??'A', numero??f.numero, fecha??f.fecha, proveedor_id||null, proveedor_nombre??f.proveedor_nombre,
         cuit??f.cuit, oc_id||null, oc_numero??f.oc_numero,
         parseFloat(neto_gravado??f.neto_gravado)||0, parseFloat(no_grav_exento??f.no_grav_exento)||0,
         parseFloat(iva_21??f.iva_21)||0, parseFloat(iva_10_5??f.iva_10_5)||0,
         parseFloat(iva_27??f.iva_27)||0,
         parseFloat(otros_imp??f.otros_imp)||0, parseFloat(perc_iva??f.perc_iva)||0,
         parseFloat(perc_iibb??f.perc_iibb)||0,
         parseFloat(importe??f.importe), moneda??f.moneda, parseFloat(tasa_cambio??f.tasa_cambio),
         fecha_vencimiento??f.fecha_vencimiento, observaciones??f.observaciones, req.params.id);
  res.json(db.prepare('SELECT * FROM facturas_compra WHERE id=?').get(req.params.id));
});

router.delete('/facturas-compra/:id', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  db.prepare('DELETE FROM facturas_compra WHERE id=?').run(req.params.id);
  res.json({ mensaje: 'Eliminada' });
});

router.patch('/facturas-compra/pago', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const { fuente, id, pago_confirmado } = req.body;
  const val = pago_confirmado ? 1 : 0;
  if (fuente === 'oc') {
    db.prepare('UPDATE ordenes_compra SET pago_confirmado=? WHERE id=?').run(val, id);
  } else {
    db.prepare("UPDATE facturas_compra SET pago_confirmado=?, anticipo=0, fecha_anticipo='', updated_at=datetime('now','localtime') WHERE id=?").run(val, id);
  }
  res.json({ ok: true });
});

router.patch('/facturas-compra/:id/anticipo', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const { anticipo, fecha_anticipo } = req.body;
  db.prepare("UPDATE facturas_compra SET anticipo=?, fecha_anticipo=?, pago_confirmado=0, updated_at=datetime('now','localtime') WHERE id=?")
    .run(parseFloat(anticipo)||0, fecha_anticipo||'', req.params.id);
  res.json(db.prepare('SELECT id,pago_confirmado,anticipo,fecha_anticipo FROM facturas_compra WHERE id=?').get(req.params.id));
});

// ── Facturas de Venta ─────────────────────────────────────────────────────────

router.get('/facturas-venta', verificarToken, (req, res) => {
  const { buscar, desde, hasta, moneda, pago } = req.query;
  let rows = db.prepare(`
    SELECT fv.*, p.numero AS ppto_numero,
      COALESCE(pag.total_pagado, 0)  AS total_pagado,
      COALESCE(pag.count_pagos,  0)  AS count_pagos
    FROM facturas_venta fv
    LEFT JOIN presupuestos p ON p.id = fv.presupuesto_id
    LEFT JOIN (
      SELECT factura_id,
        SUM(CASE WHEN estado='confirmado' THEN importe ELSE 0 END) AS total_pagado,
        COUNT(*) AS count_pagos
      FROM pagos_factura_venta GROUP BY factura_id
    ) pag ON pag.factura_id = fv.id
    ORDER BY fv.fecha DESC, fv.id DESC`).all();
  rows = rows.map(r => ({
    ...r,
    saldo_pendiente: r.pago_confirmado ? 0 : Math.max(0, (r.importe * (r.tasa_cambio || 1)) - (r.total_pagado || 0))
  }));
  if (desde)  rows = rows.filter(r => r.fecha >= desde);
  if (hasta)  rows = rows.filter(r => r.fecha <= hasta);
  if (moneda) rows = rows.filter(r => r.moneda === moneda);
  if (pago === '1') rows = rows.filter(r => r.pago_confirmado === 1);
  if (pago === '0') rows = rows.filter(r => r.pago_confirmado === 0);
  if (buscar) {
    const b = buscar.trim().toLowerCase();
    rows = rows.filter(r =>
      (r.numero||'').toLowerCase().includes(b) ||
      (r.cliente_nombre||'').toLowerCase().includes(b) ||
      (r.concepto||'').toLowerCase().includes(b) ||
      (r.oc||'').toLowerCase().includes(b) ||
      (r.presupuesto_ref||'').toLowerCase().includes(b) ||
      (r.ppto_numero||'').toLowerCase().includes(b)
    );
  }
  res.json(rows);
});

router.post('/facturas-venta', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const { tipo_factura, numero, fecha, cliente_id, cliente_nombre, presupuesto_id, presupuesto_ref,
          concepto, oc, neto_gravado, iva_21,
          ret_iibb, ret_iva, ret_gcia, ret_contratista, ret_ss, dif_cambio, total_cobrado,
          importe, moneda, tasa_cambio, fecha_vencimiento, fecha_pago, observaciones } = req.body;
  if (!numero?.trim()) return res.status(400).json({ error: 'Número requerido' });
  const r = db.prepare(`INSERT INTO facturas_venta
    (tipo_factura,numero,fecha,cliente_id,cliente_nombre,presupuesto_id,presupuesto_ref,
     concepto,oc,neto_gravado,iva_21,ret_iibb,ret_iva,ret_gcia,ret_contratista,ret_ss,dif_cambio,total_cobrado,
     importe,moneda,tasa_cambio,fecha_vencimiento,fecha_pago,observaciones,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(tipo_factura||'A', numero.trim(), fecha||'', cliente_id||null, cliente_nombre||'',
         presupuesto_id||null, presupuesto_ref||'',
         concepto||'', oc||'',
         parseFloat(neto_gravado)||0, parseFloat(iva_21)||0,
         parseFloat(ret_iibb)||0, parseFloat(ret_iva)||0, parseFloat(ret_gcia)||0,
         parseFloat(ret_contratista)||0, parseFloat(ret_ss)||0,
         parseFloat(dif_cambio)||0, parseFloat(total_cobrado)||0,
         parseFloat(importe)||0, moneda||'PESO', parseFloat(tasa_cambio)||1,
         fecha_vencimiento||'', fecha_pago||'', observaciones||'', req.usuario.id);
  res.status(201).json(db.prepare('SELECT * FROM facturas_venta WHERE id=?').get(r.lastInsertRowid));
});

router.put('/facturas-venta/:id', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const f = db.prepare('SELECT * FROM facturas_venta WHERE id=?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'No encontrada' });
  const { tipo_factura, numero, fecha, cliente_id, cliente_nombre, presupuesto_id, presupuesto_ref,
          concepto, oc, neto_gravado, iva_21,
          ret_iibb, ret_iva, ret_gcia, ret_contratista, ret_ss, dif_cambio, total_cobrado,
          importe, moneda, tasa_cambio, fecha_vencimiento, fecha_pago, observaciones } = req.body;
  db.prepare(`UPDATE facturas_venta SET
    tipo_factura=?,numero=?,fecha=?,cliente_id=?,cliente_nombre=?,presupuesto_id=?,presupuesto_ref=?,
    concepto=?,oc=?,neto_gravado=?,iva_21=?,ret_iibb=?,ret_iva=?,ret_gcia=?,ret_contratista=?,ret_ss=?,dif_cambio=?,total_cobrado=?,
    importe=?,moneda=?,tasa_cambio=?,fecha_vencimiento=?,fecha_pago=?,observaciones=?,updated_at=datetime('now','localtime')
    WHERE id=?`)
    .run(tipo_factura??f.tipo_factura??'A', numero??f.numero, fecha??f.fecha,
         cliente_id||null, cliente_nombre??f.cliente_nombre,
         presupuesto_id||null, presupuesto_ref??f.presupuesto_ref,
         concepto??f.concepto??'', oc??f.oc??'',
         parseFloat(neto_gravado??f.neto_gravado)||0, parseFloat(iva_21??f.iva_21)||0,
         parseFloat(ret_iibb??f.ret_iibb)||0, parseFloat(ret_iva??f.ret_iva)||0,
         parseFloat(ret_gcia??f.ret_gcia)||0, parseFloat(ret_contratista??f.ret_contratista)||0,
         parseFloat(ret_ss??f.ret_ss)||0, parseFloat(dif_cambio??f.dif_cambio)||0,
         parseFloat(total_cobrado??f.total_cobrado)||0,
         parseFloat(importe??f.importe), moneda??f.moneda, parseFloat(tasa_cambio??f.tasa_cambio),
         fecha_vencimiento??f.fecha_vencimiento, fecha_pago??f.fecha_pago??'',
         observaciones??f.observaciones, req.params.id);
  res.json(db.prepare('SELECT * FROM facturas_venta WHERE id=?').get(req.params.id));
});

router.delete('/facturas-venta/:id', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  db.prepare('DELETE FROM facturas_venta WHERE id=?').run(req.params.id);
  res.json({ mensaje: 'Eliminada' });
});

router.patch('/facturas-venta/:id/pago', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const { pago_confirmado, fecha_pago } = req.body;
  db.prepare("UPDATE facturas_venta SET pago_confirmado=?, fecha_pago=?, anticipo=0, fecha_anticipo='', updated_at=datetime('now','localtime') WHERE id=?")
    .run(pago_confirmado ? 1 : 0, fecha_pago||'', req.params.id);
  res.json({ ok: true });
});

// ── Pagos de Facturas de Venta ────────────────────────────────────────────────

function recalcPagoFV(factura_id) {
  const fv = db.prepare('SELECT importe, tasa_cambio FROM facturas_venta WHERE id=?').get(factura_id);
  if (!fv) return;
  const pagado = db.prepare(
    "SELECT COALESCE(SUM(importe),0) as s FROM pagos_factura_venta WHERE factura_id=? AND estado='confirmado'"
  ).get(factura_id).s;
  const saldo = (fv.importe * (fv.tasa_cambio || 1)) - pagado;
  db.prepare("UPDATE facturas_venta SET pago_confirmado=?, updated_at=datetime('now','localtime') WHERE id=?")
    .run(saldo <= 0.01 ? 1 : 0, factura_id);
}

router.get('/facturas-venta/:id/pagos', verificarToken, (req, res) => {
  res.json(db.prepare('SELECT * FROM pagos_factura_venta WHERE factura_id=? ORDER BY fecha ASC, id ASC').all(req.params.id));
});

router.post('/facturas-venta/:id/pagos', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const { tipo, forma_pago, entidad, importe, moneda, fecha, fecha_acreditacion, estado, observaciones } = req.body;
  if (!parseFloat(importe) || parseFloat(importe) <= 0) return res.status(400).json({ error: 'Importe debe ser mayor a 0' });
  if (!fecha) return res.status(400).json({ error: 'Fecha requerida' });
  const estadoFinal = (forma_pago === 'cheque_diferido' && estado !== 'confirmado') ? 'pendiente' : (estado || 'confirmado');
  const r = db.prepare(`
    INSERT INTO pagos_factura_venta
      (factura_id,tipo,forma_pago,entidad,importe,moneda,fecha,fecha_acreditacion,estado,observaciones,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(req.params.id, tipo||'parcial', forma_pago||'transferencia', entidad||'',
         parseFloat(importe), moneda||'PESO', fecha, fecha_acreditacion||'',
         estadoFinal, observaciones||'', req.usuario.id);
  recalcPagoFV(req.params.id);
  res.status(201).json(db.prepare('SELECT * FROM pagos_factura_venta WHERE id=?').get(r.lastInsertRowid));
});

router.patch('/facturas-venta/:id/pagos/:pid', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const p = db.prepare('SELECT * FROM pagos_factura_venta WHERE id=? AND factura_id=?').get(req.params.pid, req.params.id);
  if (!p) return res.status(404).json({ error: 'Pago no encontrado' });
  const { tipo, forma_pago, entidad, importe, moneda, fecha, fecha_acreditacion, estado, observaciones } = req.body;
  db.prepare(`UPDATE pagos_factura_venta SET
    tipo=?,forma_pago=?,entidad=?,importe=?,moneda=?,fecha=?,fecha_acreditacion=?,estado=?,observaciones=? WHERE id=?`)
    .run(tipo??p.tipo, forma_pago??p.forma_pago, entidad??p.entidad,
         parseFloat(importe??p.importe), moneda??p.moneda, fecha??p.fecha,
         fecha_acreditacion??p.fecha_acreditacion, estado??p.estado,
         observaciones??p.observaciones, req.params.pid);
  recalcPagoFV(req.params.id);
  res.json(db.prepare('SELECT * FROM pagos_factura_venta WHERE id=?').get(req.params.pid));
});

router.delete('/facturas-venta/:id/pagos/:pid', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  if (!db.prepare('SELECT id FROM pagos_factura_venta WHERE id=? AND factura_id=?').get(req.params.pid, req.params.id))
    return res.status(404).json({ error: 'Pago no encontrado' });
  db.prepare('DELETE FROM pagos_factura_venta WHERE id=?').run(req.params.pid);
  recalcPagoFV(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
