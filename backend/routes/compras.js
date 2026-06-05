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
  if (!req.permisos?.compras?.escribir) return res.status(403).json({ error: 'Sin permisos' });
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

// Buscar proveedor por ID (incluyendo inactivos, para impresión de OC)
router.get('/proveedores/buscar', verificarToken, (req, res) => {
  const { id, nombre } = req.query;
  if (id) {
    const p = db.prepare('SELECT * FROM proveedores WHERE id=?').get(id);
    return res.json(p || null);
  }
  if (nombre) {
    const p = db.prepare('SELECT * FROM proveedores WHERE nombre=? LIMIT 1').get(nombre);
    return res.json(p || null);
  }
  res.json(null);
});

router.post('/proveedores/fusionar', verificarToken, (req, res) => {
  if (!req.permisos?.compras?.escribir && req.usuario?.rol !== 'admin')
    return res.status(403).json({ error: 'Sin permisos' });
  const { master_id, duplicados, datos } = req.body;
  if (!master_id || !Array.isArray(duplicados) || !duplicados.length)
    return res.status(400).json({ error: 'Parámetros incompletos' });
  const master = db.prepare('SELECT * FROM proveedores WHERE id=?').get(master_id);
  if (!master) return res.status(404).json({ error: 'Proveedor master no encontrado' });

  db.transaction(() => {
    // Actualizar datos del master con los valores elegidos
    const { nombre, cuit, contacto, telefono, email, direccion, localidad, cp, vendedor, condicion_pago } = datos || {};
    db.prepare('UPDATE proveedores SET nombre=?,cuit=?,contacto=?,telefono=?,email=?,direccion=?,localidad=?,cp=?,vendedor=?,condicion_pago=? WHERE id=?')
      .run(nombre??master.nombre, cuit??master.cuit, contacto??master.contacto, telefono??master.telefono,
           email??master.email, direccion??master.direccion, localidad??master.localidad, cp??master.cp,
           vendedor??master.vendedor, condicion_pago??master.condicion_pago, master_id);
    const masterNombre = db.prepare('SELECT nombre FROM proveedores WHERE id=?').get(master_id).nombre;

    // Reasignar OC por proveedor_id
    for (const dup_id of duplicados) {
      db.prepare('UPDATE ordenes_compra SET proveedor_id=?,proveedor_nombre=? WHERE proveedor_id=?')
        .run(master_id, masterNombre, dup_id);
    }
    // Reasignar OC que solo tienen nombre (proveedor_id nulo)
    for (const dup_id of duplicados) {
      const dup = db.prepare('SELECT nombre FROM proveedores WHERE id=?').get(dup_id);
      if (dup) {
        db.prepare('UPDATE ordenes_compra SET proveedor_id=?,proveedor_nombre=? WHERE proveedor_nombre=? AND (proveedor_id IS NULL OR proveedor_id!=?)')
          .run(master_id, masterNombre, dup.nombre, master_id);
      }
    }
    // Desactivar duplicados
    for (const dup_id of duplicados) {
      db.prepare('UPDATE proveedores SET activo=0 WHERE id=?').run(dup_id);
    }
  })();

  const oc_reasignadas = db.prepare('SELECT COUNT(*) as c FROM ordenes_compra WHERE proveedor_id=?').get(master_id).c;
  res.json({ ok: true, oc_reasignadas });
});

router.put('/proveedores/:id', verificarToken, (req, res) => {
  if (!req.permisos?.compras?.escribir) return res.status(403).json({ error: 'Sin permisos' });
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
  if (!req.permisos?.compras?.escribir) return res.status(403).json({ error: 'Sin permisos' });
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
  if (!req.permisos?.compras?.escribir) return res.status(403).json({ error: 'Sin permisos' });
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
  if (!(req.permisos?.compras?.escribir || req.permisos?.stock?.escribir))
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
  if (!req.permisos?.compras?.escribir) return res.status(403).json({ error: 'Sin permisos' });
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

// ── Exportar OC individual a Excel ────────────────────────────────────────────
router.get('/oc/:id/exportar', verificarToken, (req, res) => {
  const oc    = db.prepare('SELECT * FROM ordenes_compra WHERE id=?').get(req.params.id);
  if (!oc) return res.status(404).json({ error: 'OC no encontrada' });
  const items = db.prepare('SELECT * FROM oc_items WHERE oc_id=? ORDER BY item_num').all(oc.id);
  const prov  = oc.proveedor_id ? db.prepare('SELECT * FROM proveedores WHERE id=?').get(oc.proveedor_id) : null;

  const esUSD  = !oc.moneda || oc.moneda.toUpperCase().includes('D');
  const esEUR  = oc.moneda?.toUpperCase().includes('EUR');
  const simb   = esEUR ? '€' : esUSD ? 'U$S' : '$ARS';
  const conTC  = oc.tasa_cambio > 1;  // Solo mostrar $ARS cuando hay tasa de cambio real (>1)
  const fmtF   = iso => iso ? iso.slice(0,10).split('-').reverse().join('/') : '';
  const fmtN   = n => n != null ? parseFloat(n) : '';

  const TOTAL_FILAS = 40;
  const wb = XLSX.utils.book_new();

  // ── Construir hoja como array de arrays ────────────────────────────
  const aoa = [];

  // Encabezado empresa + datos OC
  aoa.push(['E-INTRA, S.R.L.', '', '', '', '', '', `OC: ${oc.numero}`]);
  aoa.push(['PABLO POGGIO 961, VILLA BOSCH', '', '', '', '', '', `Fecha: ${fmtF(oc.fecha)}`]);
  aoa.push(['CP-1682, PROVINCIA DE BUENOS AIRES', '', '', '', '', '', `Autorizado por: ${oc.autorizado_por||''}`]);
  aoa.push(['CUIT 30-71454338-1  |  RESPONSABLE INSCRIPTO', '', '', '', '', '', `Elaborado por: ${oc.elaborado_por||''}`]);
  aoa.push(['Tel +54 11 - 4844-5666', '', '', '', '', '', oc.presupuesto_n ? `Presupuesto N°: ${oc.presupuesto_n}` : '']);
  aoa.push([]);

  // Proveedor
  aoa.push([`EMITIDA PARA: ${oc.proveedor_nombre}`]);
  aoa.push([`CUIT: ${oc.proveedor_cuit||prov?.cuit||''}`, '', `Localidad: ${prov?.localidad||''}`, '', `Cód. Postal: ${prov?.cp||''}`, '', `Moneda: ${oc.moneda||'DÓLAR'}`]);
  aoa.push([`Teléfono: ${prov?.telefono||''}`, '', `Dirección: ${prov?.direccion||''}`]);
  aoa.push([`Vendedor: ${prov?.vendedor||''}`, '', `E-Mail: ${prov?.email||''}`]);
  aoa.push([`Condición de Compra: ${oc.condicion_pago||''}`, '', '', '', `Tasa Cambio: ${conTC ? oc.tasa_cambio : '—'}`]);
  aoa.push([]);
  aoa.push(['IMPORTANTE: EL NÚMERO DE LA ORDEN DE COMPRA DEBE APARECER EN TODAS LAS FACTURAS, REMITOS Y CORRESPONDENCIA.']);
  aoa.push([]);

  // Cabecera de tabla
  const cabecera = ['ÍTEM', 'CANT.', 'UNID.', 'DESCRIPCIÓN', `PRECIO UNIT. ${simb}`, 'BONIF 1', 'BONIF 2', 'BONIF 3', 'BONIF 4', `PRECIO UNIT. ${simb}`];
  if (conTC) cabecera.push('EQUIV. $ARS');
  cabecera.push('PLAZO DE ENTREGA');
  aoa.push(cabecera);

  // Ítems (siempre 40 filas)
  for (let i = 1; i <= TOTAL_FILAS; i++) {
    const it = items.find(x => x.item_num === i);
    if (it) {
      const fila = [i, fmtN(it.cantidad), it.unidad, it.descripcion, fmtN(it.precio_unitario), fmtN(it.bonif1)||'', fmtN(it.bonif2)||'', fmtN(it.bonif3)||'', fmtN(it.bonif4)||'', fmtN(it.precio_final)];
      if (conTC) fila.push(fmtN(it.precio_final * oc.tasa_cambio));
      fila.push(it.plazo);
      aoa.push(fila);
    } else {
      const fila = [i, '', '', '', '', '', '', '', '', ''];
      if (conTC) fila.push('');
      fila.push('');
      aoa.push(fila);
    }
  }

  // Subtotal
  const subtotal = items.reduce((s, it) => s + (it.cantidad||0) * (it.precio_final||0), 0);
  const filaTotal = ['', '', '', 'SUB-TOTAL SIN I.V.A.', '', '', '', '', '', subtotal];
  if (conTC) filaTotal.push(subtotal * oc.tasa_cambio);
  filaTotal.push('');
  aoa.push(filaTotal);
  aoa.push([]);

  // Pie
  aoa.push([`LUGAR DE ENTREGA: ${oc.lugar_entrega||'E-INTRA'}`]);
  aoa.push(['MARTIN MIGUENS 6363, VILLA BOSCH, TRES DE FEBRERO, PROV. BS.AS.']);
  aoa.push(['LUNES A VIERNES DE: 8:00 A 12:30 Y DE: 14:00 A 17:30']);
  if (oc.observaciones) aoa.push([`Observaciones: ${oc.observaciones}`]);
  aoa.push([]);
  aoa.push(['IMPORTANTE: AL INGRESO A NUESTRAS INSTALACIONES, ES OBLIGATORIO EL USO DE ELEMENTOS DE SEGURIDAD PERSONAL (EPP)']);

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // Anchos de columna
  ws['!cols'] = [
    {wch:6},{wch:10},{wch:7},{wch:40},{wch:14},{wch:8},{wch:8},{wch:8},{wch:8},{wch:14},
    ...(conTC ? [{wch:14}] : []),
    {wch:14},
  ];

  XLSX.utils.book_append_sheet(wb, ws, `OC ${oc.numero}`);
  const buf = XLSX.write(wb, { type:'buffer', bookType:'xlsx' });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=OC_${oc.numero}.xlsx`);
  res.send(buf);
});

// ── Migración desde sistema anterior ──────────────────────────────────────────
// Body: { proveedores: [...], ordenes_compra: [{...oc, items:[...]}] }
router.post('/migrar', verificarToken, (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
  const { proveedores = [], ordenes_compra = [] } = req.body;

  const insProv = db.prepare(`
    INSERT OR IGNORE INTO proveedores (nombre,cuit,telefono,email,direccion,localidad,cp,vendedor,condicion_pago)
    VALUES (?,?,?,?,?,?,?,?,?)
  `);
  const getProv  = db.prepare('SELECT id FROM proveedores WHERE nombre=?');
  const insOC    = db.prepare(`
    INSERT OR IGNORE INTO ordenes_compra
      (numero,fecha,proveedor_id,proveedor_nombre,proveedor_cuit,estado,moneda,tasa_cambio,
       condicion_pago,lugar_entrega,autorizado_por,elaborado_por,presupuesto_n,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const getOC   = db.prepare('SELECT id FROM ordenes_compra WHERE numero=?');
  const insItem = db.prepare(`
    INSERT OR IGNORE INTO oc_items (oc_id,item_num,cantidad,unidad,descripcion,precio_unitario,bonif1,bonif2,bonif3,bonif4,precio_final,plazo)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  let provCreados = 0, ocCreadas = 0, itemsCreados = 0;

  db.transaction(() => {
    for (const p of proveedores) {
      const r = insProv.run(p.nombre||'Sin nombre', p.cuit||'', p.telefono||'', p.email||'',
        p.direccion||'', p.localidad||'', p.cp||'', p.vendedor||'', p.cond_compra||'');
      if (r.changes) provCreados++;
    }
    for (const oc of ordenes_compra) {
      const prov = getProv.get(oc.prov_nombre || '');
      const r = insOC.run(
        oc.numero, oc.fecha?.slice(0,10)||'', prov?.id||null,
        oc.prov_nombre||'', oc.prov_cuit||'', 'Recibida',
        oc.moneda||'DÓLAR', oc.tasa_cambio||0,
        oc.cond_compra||'', oc.lugar_entrega||'',
        oc.autorizado_por||'', oc.elaborado_por||'',
        oc.presupuesto_n||'', req.usuario.id
      );
      if (r.changes) {
        ocCreadas++;
        const ocId = getOC.get(oc.numero)?.id;
        if (ocId && Array.isArray(oc.items)) {
          for (const it of oc.items) {
            const ri = insItem.run(ocId, it.item_num, it.cantidad, it.unidad||'UND.',
              it.descripcion||'', it.precio_usd||0, it.bonif1||0, it.bonif2||0,
              it.bonif3||0, it.bonif4||0, it.precio_final||0, it.plazo||'INMEDIATO');
            if (ri.changes) itemsCreados++;
          }
        }
      }
    }
  })();

  res.json({ ok: true, provCreados, ocCreadas, itemsCreados });
});

module.exports = router;
