const express = require('express');
const XLSX    = require('xlsx');
const { body, validationResult } = require('express-validator');
const { db }  = require('../db/database');
const { verificarToken, puede: permisoModulo } = require('../middleware/auth');
const { buscarCondicion } = require('../helpers/buscar');
const { hoyArgentina } = require('../helpers/fecha');
const { obtenerAutorizantes } = require('../helpers/organigrama');
const { enviarMensajeSistema } = require('../helpers/mensajes');
const { aplicarMovimiento, revertirMovimiento, reasignarLote, resolverLote, sumarALote } = require('../helpers/stockLotes');
const { sumarASubstock } = require('../helpers/substock');

const router = express.Router();
const puede = req => !!(req.permisos?.stock?.escribir);
const leerStock = permisoModulo.leer('stock');
const leerPedidosStock = permisoModulo.leer('pedidos_stock');
const puedePedir = req => !!(req.permisos?.pedidos_stock?.escribir);

// El historial completo de movimientos y su exportación muestran todo lo
// que se retiró/ingresó en toda la empresa (no solo lo propio) — se
// restringe al mismo universo de "gerente" que ya se usa para autorizar
// retiros (admin ∪ gerentes de gerencia), en vez de alcanzar con el permiso
// general de lectura de Stock.
function soloGerentes(req, res, next) {
  if (!obtenerAutorizantes().some(u => u.id === req.usuario.id))
    return res.status(403).json({ error: 'Solo gerentes y administradores' });
  next();
}

// Filtros del historial de movimientos, compartidos entre la consulta en
// pantalla y la exportación a Excel — cada campo de texto es independiente
// (se pueden combinar todos los que hagan falta a la vez, en vez de tener
// que elegir uno solo de una lista como antes) y "substock" distingue los
// traspasos hacia/desde un substock (Calidad/Producción) de los movimientos
// normales de depósito.
const CAMPOS_TEXTO_MOVIMIENTOS = {
  codigo:          'm_p.codigo',
  descripcion:     'm_p.descripcion',
  proveedor:       'm.proveedor',
  proyecto:        'm.proyecto',
  cliente_interno: 'm.cliente_interno',
  remito:          'm.remito',
  observaciones:   'm.observaciones',
};
function condsHistorialMovimientos(q) {
  const conds = [], params = [];
  if (q.producto_id) { conds.push('m.producto_id=?'); params.push(q.producto_id); }
  if (q.tipo)         { conds.push('m.tipo=?');         params.push(q.tipo); }
  if (q.desde)        { conds.push('m.fecha>=?');        params.push(q.desde); }
  if (q.hasta)        { conds.push('m.fecha<=?');        params.push(q.hasta); }
  for (const [campo, col] of Object.entries(CAMPOS_TEXTO_MOVIMIENTOS)) {
    if (q[campo]) { const bc = buscarCondicion(q[campo], [col]); conds.push(bc.cond); params.push(...bc.params); }
  }
  // "ninguno" = solo movimientos de depósito normal, sin ningún traspaso de
  // substock de por medio — el resto de los valores es el nombre del
  // substock puntual (calidad/produccion), sin distinguir si el movimiento
  // fue "hacia" (substock_destino) o "desde" (substock_origen) ese substock.
  if (q.substock === 'ninguno') {
    conds.push(`(m.substock_destino='' AND m.substock_origen='')`);
  } else if (q.substock) {
    conds.push(`(m.substock_destino=? OR m.substock_origen=?)`);
    params.push(q.substock, q.substock);
  }
  return { conds, params };
}

// ── Productos ──────────────────────────────────────────────────────────────────

router.get('/productos', verificarToken, leerStock, (req, res) => {
  const { buscar, categoria, ubicacion, alerta } = req.query;
  const conds = ['p.activo=1'], params = [];
  if (buscar)   { const b = buscarCondicion(buscar, ['p.codigo','p.descripcion','p.proveedor','p.codigo_proveedor']); conds.push(b.cond); params.push(...b.params); }
  if (categoria){ conds.push('p.categoria=?');  params.push(categoria); }
  if (ubicacion){ conds.push('p.ubicacion=?');  params.push(ubicacion); }
  if (alerta === 'bajo')     conds.push('p.stock_actual > 0 AND p.stock_minimo > 0 AND p.stock_actual <= p.stock_minimo');
  if (alerta === 'agotado')  conds.push('p.stock_actual <= 0');
  if (alerta === 'ok')       conds.push('p.stock_actual > 0');
  // Cantidad del material que ya salió del depósito principal pero sigue
  // "en la empresa", repartida en un substock (Producción/Calidad/Eléctrico)
  // sin consumirse todavía — se suma acá para que la consulta de Stock no
  // muestre solo lo que hay en el depósito, sino también dónde está el
  // resto. No se cuenta como "disponible" (stock_actual no la incluye):
  // es material ya afectado a un área puntual, no algo listo para retirar
  // del depósito.
  const rows = db.prepare(`
    SELECT p.*,
      COALESCE((SELECT SUM(cantidad_actual) FROM substock_saldo WHERE producto_id=p.id AND substock='produccion'), 0) AS substock_produccion,
      COALESCE((SELECT SUM(cantidad_actual) FROM substock_saldo WHERE producto_id=p.id AND substock='calidad'), 0) AS substock_calidad,
      COALESCE((SELECT SUM(cantidad_actual) FROM substock_saldo WHERE producto_id=p.id AND substock='electrico'), 0) AS substock_electrico
    FROM productos p WHERE ${conds.join(' AND ')} ORDER BY p.descripcion
  `).all(...params);
  res.json(rows);
});

// Catálogo liviano para armar un Pedido de Stock — no expone precios ni
// requiere el permiso completo de Stock, alcanza con poder pedir materiales.
router.get('/productos-para-pedido', verificarToken, (req, res) => {
  if (!(req.permisos?.stock?.leer || req.permisos?.pedidos_stock?.leer))
    return res.status(403).json({ error: 'Sin permisos de lectura' });
  const rows = db.prepare(`SELECT id, codigo, descripcion, categoria, unidad, stock_actual FROM productos WHERE activo=1 ORDER BY descripcion`).all();
  res.json(rows);
});

router.get('/productos/categorias', verificarToken, leerStock, (req, res) => {
  res.json(db.prepare("SELECT DISTINCT categoria FROM productos WHERE categoria!='' AND activo=1 ORDER BY categoria").all().map(r=>r.categoria));
});

// Contadores de la barra de estado (total/disponibles/stock bajo/agotados) sin
// traer las filas — la pantalla de Stock ya no carga todo el catálogo de
// entrada, pero estos números siempre reflejan el catálogo completo.
router.get('/productos/contadores', verificarToken, leerStock, (req, res) => {
  const r = db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN stock_actual > 0 THEN 1 ELSE 0 END) AS disponibles,
      SUM(CASE WHEN stock_actual > 0 AND stock_minimo > 0 AND stock_actual <= stock_minimo THEN 1 ELSE 0 END) AS stock_bajo,
      SUM(CASE WHEN stock_actual <= 0 THEN 1 ELSE 0 END) AS agotados
    FROM productos WHERE activo=1
  `).get();
  res.json({ total: r.total||0, disponibles: r.disponibles||0, stockBajo: r.stock_bajo||0, agotados: r.agotados||0 });
});

router.get('/productos/ubicaciones', verificarToken, leerStock, (req, res) => {
  res.json(db.prepare("SELECT DISTINCT ubicacion FROM productos WHERE ubicacion!='' AND activo=1 ORDER BY ubicacion").all().map(r=>r.ubicacion));
});

router.get('/movimientos/valores', verificarToken, leerStock, soloGerentes, (req, res) => {
  const { campo } = req.query;
  const cols = { proveedor:'proveedor', proyecto:'proyecto', cliente_interno:'cliente_interno', codigo:'codigo', descripcion:'descripcion', remito:'remito' };
  if (!cols[campo]) return res.json([]);
  let sql;
  if (campo === 'codigo' || campo === 'descripcion') {
    sql = `SELECT DISTINCT p.${campo} as v FROM productos p WHERE p.${campo}!='' ORDER BY p.${campo} LIMIT 100`;
    return res.json(db.prepare(sql).all().map(r=>r.v));
  }
  sql = `SELECT DISTINCT ${campo} as v FROM movimientos_stock WHERE ${campo}!='' ORDER BY ${campo} LIMIT 100`;
  res.json(db.prepare(sql).all().map(r=>r.v));
});

router.get('/productos/:id', verificarToken, leerStock, (req, res) => {
  const p = db.prepare('SELECT * FROM productos WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
  const movs = db.prepare('SELECT * FROM movimientos_stock WHERE producto_id=? ORDER BY created_at DESC LIMIT 50').all(p.id);
  const lotes = db.prepare('SELECT * FROM stock_lotes WHERE producto_id=? ORDER BY fecha_ingreso DESC, id DESC').all(p.id);
  res.json({ ...p, movimientos: movs, lotes });
});

// Lotes con saldo disponible de un producto — para el selector de "de qué
// partida sale" al cargar una salida.
router.get('/productos/:id/lotes', verificarToken, leerStock, (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM stock_lotes WHERE producto_id=? AND cantidad_actual > 0.0001
    ORDER BY fecha_ingreso ASC, id ASC
  `).all(req.params.id);
  res.json(rows);
});

// Lotes/series de un producto que están "afuera" (dados de salida y todavía
// sin volver) — para el selector de "qué unidad se devuelve" al cargar una
// devolución de un material con trazabilidad, con quién lo tiene según el
// último movimiento de salida de ese lote puntual.
router.get('/productos/:id/lotes-afuera', verificarToken, leerStock, (req, res) => {
  const rows = db.prepare(`
    SELECT sl.id, sl.partida, sl.cantidad_actual,
      (SELECT m.cliente_interno FROM movimientos_stock m WHERE m.lote_id=sl.id AND m.tipo='salida' ORDER BY m.created_at DESC LIMIT 1) AS cliente_interno,
      (SELECT m.proyecto       FROM movimientos_stock m WHERE m.lote_id=sl.id AND m.tipo='salida' ORDER BY m.created_at DESC LIMIT 1) AS proyecto,
      (SELECT m.fecha          FROM movimientos_stock m WHERE m.lote_id=sl.id AND m.tipo='salida' ORDER BY m.created_at DESC LIMIT 1) AS fecha_salida
    FROM stock_lotes sl
    WHERE sl.producto_id=? AND sl.partida != '' AND sl.cantidad_actual <= 0.0001
    ORDER BY fecha_salida DESC
  `).all(req.params.id);
  res.json(rows);
});

// Todos los lotes "sin dato" con saldo, de todos los materiales con
// trazabilidad activa — para poder asignarles partida/serie real desde una
// sola pantalla, sin tener que buscar y abrir cada material por separado
// (mismo espíritu que el fusionador de "Proyectos legado").
router.get('/lotes-pendientes', verificarToken, leerStock, (req, res) => {
  const rows = db.prepare(`
    SELECT sl.id, sl.producto_id, sl.cantidad_actual, sl.fecha_ingreso, sl.proveedor, sl.referencia,
           p.codigo, p.descripcion, p.unidad, p.trazabilidad_stock
    FROM stock_lotes sl
    JOIN productos p ON p.id = sl.producto_id
    WHERE sl.partida = '' AND sl.cantidad_actual > 0.0001
      AND p.trazabilidad_stock != 'ninguna' AND p.activo = 1
    ORDER BY p.descripcion
  `).all();
  res.json(rows);
});

// Reasigna una cantidad de un lote a una partida/serie real — pensado para
// el lote genérico "sin partida" (stock que ya estaba antes de activar la
// trazabilidad de este material). No es un movimiento físico: no cambia
// stock_actual ni queda en el historial de movimientos.
router.post('/productos/:id/lotes/:loteId/reasignar', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
  const p = db.prepare('SELECT * FROM productos WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
  const { cantidad, partida_nueva } = req.body;
  const cant = parseFloat(cantidad);
  if (!cant || cant <= 0) return res.status(400).json({ error: 'Cantidad inválida' });
  try {
    const ef = db.transaction(() => reasignarLote(p, req.params.loteId, cant, partida_nueva))();
    res.json({ ok: true, ...ef });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post('/productos', verificarToken,
  body('codigo').trim().notEmpty(),
  body('descripcion').trim().notEmpty(),
  (req, res) => {
    if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() });
    const { codigo, descripcion, categoria, unidad, stock_minimo, ubicacion, precio_costo, precio_venta, proveedor, codigo_proveedor, trazabilidad_stock } = req.body;
    const precio_fecha = (precio_costo || precio_venta) ? hoyArgentina() : '';
    // stock_actual NUNCA se toma del body: igual que materiales.js, el stock
    // solo se carga después vía un movimiento de "entrada" (que sí crea el
    // lote correspondiente en stock_lotes) — si se aceptara acá, quedaría un
    // producto con stock_actual>0 pero sin ningún lote real detrás, y la
    // primera salida fallaría con "0 disponibles" pese a que el catálogo
    // muestra stock.
    try {
      const r = db.prepare(`INSERT INTO productos (codigo,descripcion,categoria,unidad,stock_actual,stock_minimo,ubicacion,precio_costo,precio_venta,proveedor,codigo_proveedor,precio_fecha,trazabilidad_stock) VALUES (?,?,?,?,0,?,?,?,?,?,?,?,?)`)
        .run(codigo, descripcion, categoria||'', unidad||'UND.', stock_minimo||0, ubicacion||'', precio_costo||0, precio_venta||0, proveedor||'', codigo_proveedor||'', precio_fecha, trazabilidad_stock || 'ninguna');
      res.status(201).json(db.prepare('SELECT * FROM productos WHERE id=?').get(r.lastInsertRowid));
    } catch(e) {
      if (e.message.includes('UNIQUE')) {
        // Si existe pero está inactivo, reactivarlo con los nuevos datos —
        // tampoco toca stock_actual (sigue siendo el que ya tenía, con sus
        // lotes intactos, no se resetea a lo que mande este request).
        const inactivo = db.prepare('SELECT id FROM productos WHERE codigo=? AND activo=0').get(codigo);
        if (inactivo) {
          db.prepare(`UPDATE productos SET descripcion=?,categoria=?,unidad=?,stock_minimo=?,ubicacion=?,precio_costo=?,precio_venta=?,proveedor=?,codigo_proveedor=?,activo=1,precio_fecha=?,trazabilidad_stock=?,updated_at=datetime('now','localtime') WHERE id=?`)
            .run(descripcion, categoria||'', unidad||'UND.', stock_minimo||0, ubicacion||'', precio_costo||0, precio_venta||0, proveedor||'', codigo_proveedor||'', precio_fecha, trazabilidad_stock || 'ninguna', inactivo.id);
          return res.status(201).json(db.prepare('SELECT * FROM productos WHERE id=?').get(inactivo.id));
        }
        return res.status(409).json({ error: 'El código ya existe' });
      }
      throw e;
    }
  }
);

router.put('/productos/:id', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
  const p = db.prepare('SELECT * FROM productos WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  const { codigo, descripcion, categoria, unidad, stock_minimo, ubicacion, precio_costo, precio_venta, proveedor, codigo_proveedor, trazabilidad_stock } = req.body;
  const nuevoCosto = precio_costo ?? p.precio_costo;
  const nuevaVenta = precio_venta ?? p.precio_venta;
  // La fecha solo se actualiza si el precio realmente cambió (ej. al tocar solo la ubicación no debe pisarse).
  const cambioPrecio = Number(nuevoCosto) !== Number(p.precio_costo) || Number(nuevaVenta) !== Number(p.precio_venta);
  const precio_fecha = cambioPrecio ? hoyArgentina() : p.precio_fecha;
  try {
    db.prepare(`UPDATE productos SET codigo=?,descripcion=?,categoria=?,unidad=?,stock_minimo=?,ubicacion=?,precio_costo=?,precio_venta=?,proveedor=?,codigo_proveedor=?,precio_fecha=?,trazabilidad_stock=?,updated_at=datetime('now','localtime') WHERE id=?`)
      .run(codigo??p.codigo, descripcion??p.descripcion, categoria??p.categoria, unidad??p.unidad,
           stock_minimo??p.stock_minimo, ubicacion??p.ubicacion, nuevoCosto,
           nuevaVenta, proveedor??p.proveedor??'', codigo_proveedor??p.codigo_proveedor??'',
           precio_fecha, trazabilidad_stock ?? p.trazabilidad_stock, req.params.id);
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: `Ya existe otro producto con el código "${codigo}"` });
    throw e;
  }
  res.json(db.prepare('SELECT * FROM productos WHERE id=?').get(req.params.id));
});

router.delete('/productos/:id', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
  db.prepare('UPDATE productos SET activo=0 WHERE id=?').run(req.params.id);
  res.json({ mensaje: 'Producto desactivado' });
});

// ── Movimientos ────────────────────────────────────────────────────────────────

router.get('/movimientos', verificarToken, leerStock, soloGerentes, (req, res) => {
  const { page=1, limit=200 } = req.query;
  const { conds, params } = condsHistorialMovimientos(req.query);
  const where  = conds.length ? 'WHERE '+conds.join(' AND ') : '';
  const offset = (parseInt(page)-1)*parseInt(limit);
  const total  = db.prepare(`SELECT COUNT(*) as c FROM movimientos_stock m LEFT JOIN productos m_p ON m.producto_id=m_p.id ${where}`).get(...params).c;
  const rows   = db.prepare(`
    SELECT m.*, m_p.codigo, m_p.descripcion, m_p.unidad, m_p.proveedor AS producto_proveedor,
      m_p.trazabilidad_stock AS producto_trazabilidad_stock, hr.numero AS hoja_ruta_numero
    FROM movimientos_stock m LEFT JOIN productos m_p ON m.producto_id=m_p.id
      LEFT JOIN hoja_ruta hr ON hr.id=m.hoja_ruta_id
    ${where} ORDER BY m.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);
  res.json({ total, datos: rows });
});

// Lista para el selector de "Autorizado por" — abierto a cualquier usuario
// logueado, ya que lo necesita tanto quien arma un Pedido de Stock (permiso
// liviano de pedidos_stock) como quien carga una salida directa (permiso de
// stock completo).
router.get('/autorizantes', verificarToken, (req, res) => {
  res.json(obtenerAutorizantes());
});

router.post('/movimientos', verificarToken,
  body('producto_id').isInt(),
  body('tipo').isIn(['entrada','salida','devolucion','ajuste']),
  body('cantidad').isFloat({ gt: 0 }),
  body('fecha').notEmpty(),
  body('substock_destino').optional({ checkFalsy: true }).isIn(['calidad','produccion','electrico']),
  (req, res) => {
    if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() });
    const { producto_id, tipo, cantidad, fecha, referencia, precio_unit, observaciones, proveedor, proyecto, cliente_interno, autorizado_por_id, partida, lote_id, hoja_ruta_id, remito, substock_destino } = req.body;
    const p = db.prepare('SELECT * FROM productos WHERE id=? AND activo=1').get(producto_id);
    if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
    // Un traspaso a un substock (Calidad/Producción) es una reubicación
    // interna, no un retiro real hacia afuera — no tiene sentido exigirle a
    // un gerente que autorice cada uno, y proyecto/cliente interno todavía no
    // aplican: esos datos se cargan recién cuando el substock lo entrega.
    const esTransferenciaSubstock = tipo === 'salida' && !!substock_destino;
    // Todo retiro (salida) real tiene que quedar con quién lo autoriza — se
    // valida contra la misma lista que se ofrece en el selector (admin o
    // gerentes de gerencia), no alcanza con mandar cualquier id de usuario.
    let autorizante = null;
    if (tipo === 'salida' && !esTransferenciaSubstock) {
      autorizante = obtenerAutorizantes().find(u => u.id === parseInt(autorizado_por_id));
      if (!autorizante) return res.status(400).json({ error: 'Elegí quién autoriza este retiro' });
    }
    // Todo retiro directo a una persona tiene que quedar cargado a un
    // proyecto o actividad — si no, el costeo real de materiales por
    // proyecto (Análisis de Proyectos) subcuenta lo que salió sin etiquetar.
    // Un traspaso a substock no lo pide todavía (se carga recién cuando el
    // substock lo entrega, ver comentario de arriba).
    if (tipo === 'salida' && !esTransferenciaSubstock && !proyecto?.trim())
      return res.status(400).json({ error: 'Elegí un proyecto o actividad' });
    // Todo lo que entra a stock tiene que quedar con un proveedor real (el de
    // la OC, o E-INTRA SRL si es fabricado propio) — nunca queda "—" en el
    // historial, que es como llegaban los ingresos cargados a mano hasta ahora.
    if (tipo === 'entrada' && !proveedor?.trim())
      return res.status(400).json({ error: 'Elegí el proveedor de este ingreso' });
    const proyectoFinal       = esTransferenciaSubstock ? '' : (proyecto || '');
    const clienteInternoFinal = esTransferenciaSubstock ? '' : (cliente_interno || '');
    let efecto;
    try {
      efecto = db.transaction(() => {
        const ef = aplicarMovimiento(p, tipo, cantidad, { lote_id, partida, precio_costo: precio_unit, proveedor, referencia, remito, fecha });
        if (esTransferenciaSubstock) sumarASubstock(producto_id, substock_destino, ef.lote_id, cantidad);
        db.prepare(`INSERT INTO movimientos_stock (producto_id,tipo,cantidad,fecha,referencia,precio_unit,observaciones,proveedor,proyecto,cliente_interno,created_by,autorizado_por_id,autorizado_por_nombre,lote_id,partida,hoja_ruta_id,remito,substock_destino)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(producto_id, tipo, cantidad, fecha, referencia||'', precio_unit||0, observaciones||'', proveedor||'', proyectoFinal, clienteInternoFinal, req.usuario.id,
               autorizante?.id || null, autorizante?.nombre || '', ef.lote_id, ef.partida, (tipo === 'salida' && hoja_ruta_id) || null, remito||'', esTransferenciaSubstock ? substock_destino : '');
        return ef;
      })();
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    if (autorizante) {
      enviarMensajeSistema({
        de_id: req.usuario.id, de_nombre: req.usuario.nombre, para_id: autorizante.id,
        asunto: `Retiro de stock autorizado: ${p.codigo} — ${p.descripcion}`,
        cuerpo: `Se retiró del stock:\n\n${p.codigo} — ${p.descripcion}\nCantidad: ${cantidad} ${p.unidad}\n`
          + `Retirado por: ${cliente_interno || '—'}\nProyecto/Actividad: ${proyecto || '—'}\nFecha: ${fecha}\n`
          + `Cargado por: ${req.usuario.nombre}${observaciones ? `\nObservaciones: ${observaciones}` : ''}${efecto.partida ? `\nPartida: ${efecto.partida}` : ''}`,
      });
    }
    const stockNuevo = db.prepare('SELECT stock_actual FROM productos WHERE id=?').get(producto_id).stock_actual;
    res.status(201).json({ stock_nuevo: stockNuevo, mensaje: `Stock actualizado: ${stockNuevo}` });
  }
);

// ── Exportar productos ─────────────────────────────────────────────────────────
router.get('/exportar', verificarToken, leerStock, soloGerentes, (req, res) => {
  const { buscar, categoria, ubicacion, alerta, tipo_export } = req.query;

  if (tipo_export === 'entradas' || tipo_export === 'salidas') {
    const tipoMov = tipo_export === 'entradas' ? 'entrada' : 'salida';
    const movs = db.prepare(`
      SELECT m.fecha, p.codigo, p.descripcion, m.tipo, m.cantidad, p.unidad,
             m.proveedor, m.precio_unit, m.proyecto, m.cliente_interno, m.observaciones, m.remito, m.partida
      FROM movimientos_stock m JOIN productos p ON m.producto_id=p.id
      WHERE m.tipo=? ORDER BY m.fecha DESC
    `).all(tipoMov);
    const datos = movs.map(m => ({
      'Fecha': m.fecha, 'Código': m.codigo, 'Descripción': m.descripcion,
      'Tipo': m.tipo, 'Cantidad': m.cantidad, 'Unidad': m.unidad,
      'Proveedor': m.proveedor, 'Precio Unit.': m.precio_unit,
      'Proyecto': m.proyecto, 'Cliente Int.': m.cliente_interno, 'Remito': m.remito, 'Partida': m.partida, 'Observaciones': m.observaciones,
    }));
    const ws = XLSX.utils.json_to_sheet(datos);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, tipo_export === 'entradas' ? 'Entradas' : 'Salidas');
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',`attachment; filename=${tipo_export}_${new Date().toISOString().slice(0,10)}.xlsx`);
    return res.send(XLSX.write(wb, { type:'buffer', bookType:'xlsx' }));
  }

  const conds = ['p.activo=1'], params = [];
  if (buscar)   { const b = buscarCondicion(buscar, ['p.codigo','p.descripcion','p.proveedor','p.codigo_proveedor']); conds.push(b.cond); params.push(...b.params); }
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
router.get('/exportar-historial', verificarToken, leerStock, soloGerentes, (req, res) => {
  const { conds, params } = condsHistorialMovimientos(req.query);
  const where = conds.length ? 'WHERE '+conds.join(' AND ') : '';
  const movs = db.prepare(`
    SELECT m.fecha, m_p.codigo, m_p.descripcion, m.tipo, m.cantidad, m_p.unidad,
           m.proveedor, m.precio_unit, m.proyecto, m.cliente_interno, m.observaciones, m.remito, m.partida,
           m.substock_destino, m.substock_origen
    FROM movimientos_stock m LEFT JOIN productos m_p ON m.producto_id=m_p.id
    ${where} ORDER BY m.fecha DESC, m.created_at DESC
  `).all(...params);
  const datos = movs.map(m => ({
    'Fecha': m.fecha, 'Código': m.codigo, 'Descripción': m.descripcion,
    'Tipo': m.tipo, 'Cantidad': m.cantidad, 'Unidad': m.unidad,
    'Proveedor': m.proveedor, 'Precio Unit.': m.precio_unit,
    'Proyecto': m.proyecto, 'Cliente Int.': m.cliente_interno, 'Remito': m.remito, 'Partida': m.partida,
    'Substock': m.substock_destino ? `→ ${m.substock_destino}` : m.substock_origen ? `← ${m.substock_origen}` : '',
    'Observaciones': m.observaciones,
  }));
  const ws = XLSX.utils.json_to_sheet(datos);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Historial');
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition',`attachment; filename=historial_${new Date().toISOString().slice(0,10)}.xlsx`);
  res.send(XLSX.write(wb, { type:'buffer', bookType:'xlsx' }));
});

// ── Fusionador de proyectos legado (historial de Stock) ───────────────────────
// Mismo problema y misma UX que el Fusionador de RRHH (rrhh.js /proyectos-legado)
// pero para movimientos_stock.proyecto: nombres de proyecto tipiados de varias
// formas distintas en la carga previa al sistema, sin corresponder a ningún
// código real de "proyectos". "CODIGO — Nombre" (formato que guarda la entrega
// de un Pedido de Stock) no cuenta como legado — se normaliza al código antes
// de comparar, mismo criterio que ya usa Análisis de Proyectos para agrupar.
const CODIGO_PROYECTO_DESDE_MOVIMIENTO = `
  CASE WHEN INSTR(proyecto, ' — ') > 0
    THEN SUBSTR(proyecto, 1, INSTR(proyecto, ' — ') - 1)
    ELSE proyecto
  END
`;

router.get('/proyectos-legado', verificarToken, leerStock, soloGerentes, (req, res) => {
  const rows = db.prepare(`
    SELECT x.clave AS nombre, COUNT(*) AS total_movimientos,
           MIN(x.fecha) AS fecha_desde, MAX(x.fecha) AS fecha_hasta
    FROM (
      SELECT fecha, ${CODIGO_PROYECTO_DESDE_MOVIMIENTO} AS clave
      FROM movimientos_stock
      WHERE proyecto IS NOT NULL AND TRIM(proyecto) != ''
    ) x
    -- Ya asignado a un proyecto o actividad real (el mismo criterio que usa el
    -- selector "Proyecto o Actividad" al cargar una salida) — no es legado.
    WHERE NOT EXISTS (SELECT 1 FROM proyectos p WHERE UPPER(TRIM(p.codigo)) = UPPER(TRIM(x.clave)))
      AND NOT EXISTS (SELECT 1 FROM rrhh_actividades a WHERE UPPER(TRIM(a.nombre)) = UPPER(TRIM(x.clave)))
      AND NOT EXISTS (SELECT 1 FROM stock_legado_resueltos r WHERE UPPER(TRIM(r.texto)) = UPPER(TRIM(x.clave)))
    GROUP BY x.clave
    ORDER BY MAX(x.fecha) DESC
  `).all();
  res.json(rows);
});

// Hay nombres legado (materiales retirados antes del sistema) que no
// corresponden a ningún proyecto real cargado — ni van a aparecer nunca en
// "proyectos" porque nadie los tipeó ahí. En vez de forzar a elegir un
// destino existente, se puede crear un proyecto "provisorio" (código
// PROV-####) para agruparlos, y regularizarlo después desde el módulo de
// Proyectos (cambiarle el código definitivo, cliente, fechas, etc). Mismo
// código PROV-#### se excluye de Gantt, del contador de activos del
// Dashboard y del selector de horas de RRHH — igual criterio que ya se usa
// con los códigos HIST- — pero sigue viéndose en el listado de Proyectos y
// en Análisis de Proyectos para poder encontrarlo y regularizarlo.
function siguienteCodigoProvisorio() {
  const rows = db.prepare(`SELECT codigo FROM proyectos WHERE codigo LIKE 'PROV-%'`).all();
  let max = 0;
  for (const r of rows) {
    const n = parseInt(r.codigo.slice(5), 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return `PROV-${String(max + 1).padStart(4, '0')}`;
}

router.post('/proyectos-legado/crear-provisorio', verificarToken, soloGerentes, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
  const nombre = (req.body.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'Falta el nombre del proyecto provisorio' });
  const codigo = siguienteCodigoProvisorio();
  const r = db.prepare(`INSERT INTO proyectos (codigo, nombre, estado) VALUES (?, ?, 'Activo')`).run(codigo, nombre);
  res.status(201).json(db.prepare('SELECT * FROM proyectos WHERE id=?').get(r.lastInsertRowid));
});

// destino_tipo: 'proyecto' | 'actividad' — mismas dos opciones que ya ofrece
// el selector "Proyecto o Actividad" al cargar una salida a mano.
router.post('/proyectos-legado/fusionar', verificarToken, soloGerentes, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
  const { nombre, destino_tipo, destino_id } = req.body;
  if (!nombre || !destino_tipo || !destino_id) return res.status(400).json({ error: 'Falta el nombre legado o el destino' });
  let valorNuevo;
  if (destino_tipo === 'proyecto') {
    const proyecto = db.prepare('SELECT codigo FROM proyectos WHERE id=?').get(destino_id);
    if (!proyecto) return res.status(404).json({ error: 'Proyecto de destino no encontrado' });
    valorNuevo = proyecto.codigo;
  } else if (destino_tipo === 'actividad') {
    const actividad = db.prepare('SELECT nombre FROM rrhh_actividades WHERE id=?').get(destino_id);
    if (!actividad) return res.status(404).json({ error: 'Actividad de destino no encontrada' });
    valorNuevo = actividad.nombre;
  } else {
    return res.status(400).json({ error: 'Tipo de destino inválido' });
  }
  const cambios = db.prepare(
    `UPDATE movimientos_stock SET proyecto=? WHERE ${CODIGO_PROYECTO_DESDE_MOVIMIENTO} = ?`
  ).run(valorNuevo, nombre).changes;
  res.json({ ok: true, movimientos_actualizados: cambios });
});

router.post('/proyectos-legado/conservar', verificarToken, soloGerentes, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
  const { nombre } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Falta el nombre legado' });
  db.prepare('INSERT OR IGNORE INTO stock_legado_resueltos (texto) VALUES (?)').run(nombre);
  res.json({ ok: true });
});

// ── Migración masiva de productos ──────────────────────────────────────────────
router.post('/migrar', verificarToken, (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
  const { productos } = req.body;
  if (!Array.isArray(productos) || !productos.length) return res.status(400).json({ error: 'Se requiere array de productos' });
  const hoy = hoyArgentina();
  let creados = 0, actualizados = 0;
  const insP = db.prepare(`INSERT INTO productos (codigo,descripcion,categoria,unidad,stock_actual,stock_minimo,ubicacion) VALUES (?,?,?,?,?,?,?)`);
  const updP = db.prepare(`UPDATE productos SET descripcion=?,categoria=?,stock_actual=?,stock_minimo=?,ubicacion=?,activo=1,updated_at=datetime('now','localtime') WHERE codigo=?`);
  const insM = db.prepare(`INSERT INTO movimientos_stock (producto_id,tipo,cantidad,fecha,observaciones,created_by) VALUES (?,?,?,?,?,?)`);
  db.transaction(() => {
    for (const p of productos) {
      const existe = db.prepare('SELECT id, stock_actual FROM productos WHERE codigo=?').get(p.codigo);
      const nuevoStock = p.stock_actual || 0;
      if (existe) {
        // Ajusta el lote genérico (partida='') por la diferencia, para que
        // SUM(stock_lotes) siga valiendo lo mismo que stock_actual también
        // en una re-migración — no solo en el alta nueva de abajo.
        const delta = nuevoStock - (existe.stock_actual || 0);
        updP.run(p.descripcion, p.categoria||'', nuevoStock, p.stock_minimo||0, p.ubicacion||'', p.codigo);
        if (delta !== 0) sumarALote(resolverLote(existe.id, '', {}), delta);
        actualizados++;
      } else {
        const r = insP.run(p.codigo, p.descripcion, p.categoria||'', 'UND.', nuevoStock, p.stock_minimo||0, p.ubicacion||'');
        if (nuevoStock !== 0) {
          insM.run(r.lastInsertRowid, 'ajuste', p.stock_actual, hoy, 'Saldo inicial - migración desde sistema anterior', req.usuario.id);
          // Mismo criterio que migrar_stock_a_lotes: el stock_actual recién
          // creado necesita su lote genérico detrás, si no la primera salida
          // de este producto falla con "0 disponibles" aunque el catálogo
          // muestre stock.
          sumarALote(resolverLote(r.lastInsertRowid, '', {}), nuevoStock);
        }
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

// ── Importación bulk de productos (admin only) ────────────────────────────────
router.post('/importar', verificarToken, (req, res) => {
  if (req.usuario?.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' })
  const { productos = [] } = req.body
  if (!Array.isArray(productos) || productos.length === 0)
    return res.status(400).json({ error: 'Se esperaba un array "productos"' })
  const ins = db.prepare(`
    INSERT OR IGNORE INTO productos (codigo, descripcion, categoria, unidad, precio_costo, precio_venta, proveedor, codigo_proveedor, precio_fecha)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const reactivar = db.prepare(`
    UPDATE productos SET descripcion=?,categoria=?,unidad=?,precio_costo=?,precio_venta=?,proveedor=?,codigo_proveedor=?,activo=1,precio_fecha=?,updated_at=datetime('now','localtime')
    WHERE codigo=? AND activo=0
  `)
  const actualizarPrecio = db.prepare(`
    UPDATE productos SET precio_costo=?,precio_venta=?,codigo_proveedor=?,precio_fecha=?,updated_at=datetime('now','localtime')
    WHERE codigo=? AND activo=1
  `)
  let creados = 0, actualizados = 0, omitidos = 0
  const hoy = hoyArgentina()
  db.transaction(() => {
    for (const p of productos) {
      const r = ins.run(p.codigo, p.descripcion, p.categoria || '', p.unidad || 'UND.', p.precio_costo || 0, p.precio_venta || 0, p.proveedor || '', p.codigo_proveedor || '', hoy)
      if (r.changes) { creados++ } else {
        const rv = reactivar.run(p.descripcion, p.categoria || '', p.unidad || 'UND.', p.precio_costo || 0, p.precio_venta || 0, p.proveedor || '', p.codigo_proveedor || '', hoy, p.codigo)
        if (rv.changes) { creados++ } else {
          const ra = actualizarPrecio.run(p.precio_costo || 0, p.precio_venta || 0, p.codigo_proveedor || '', hoy, p.codigo)
          ra.changes ? actualizados++ : omitidos++
        }
      }
    }
  })()
  res.json({ ok: true, creados, actualizados, omitidos })
})

// ── Editar movimiento (admin) — revierte el stock viejo y aplica el nuevo ─────
router.put('/movimientos/:id', verificarToken,
  body('producto_id').isInt(),
  body('tipo').isIn(['entrada','salida','devolucion','ajuste']),
  body('cantidad').isFloat({ gt: 0 }),
  body('fecha').notEmpty(),
  (req, res) => {
    if (req.usuario?.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() });
    const mov = db.prepare('SELECT * FROM movimientos_stock WHERE id=?').get(req.params.id);
    if (!mov) return res.status(404).json({ error: 'Movimiento no encontrado' });
    // revertirMovimiento da por hecho que todo 'salida' descontó stock_actual/
    // stock_lotes — una entrega de substock (substock_origen) nunca tocó eso
    // (ya había salido del depósito principal al transferirse), así que
    // revertirla desde acá inflaría el stock principal con material que en
    // realidad sigue (o ya no está) en el substock. Se corrige desde el
    // substock, no desde Stock.
    if (mov.substock_destino || mov.substock_origen)
      return res.status(400).json({ error: 'Este movimiento es de Substock — no se puede editar/eliminar desde Stock' });
    // Mismo motivo que el de Substock arriba: este movimiento viene de
    // entregar un Pedido de Stock o retirar una Venta de Repuestos, que
    // además de mover stock actualiza `cantidad_entregada`/`cantidad_retirada`
    // en el ítem de origen. Editarlo/borrarlo desde acá revierte el stock
    // pero deja ese contador desactualizado — el pedido/venta queda marcado
    // como entregado aunque el material haya vuelto, y nadie puede
    // reentregarlo. Se corrige desde la pantalla de origen (Pedido de
    // Stock / Venta de Repuestos), no desde acá.
    if (mov.tipo_doc === 'pedido_stock' || mov.tipo_doc === 'venta_repuesto')
      return res.status(400).json({ error: 'Este movimiento viene de un pedido/venta — no se puede editar/eliminar desde Stock' });
    const { producto_id, tipo, cantidad, fecha, referencia, precio_unit, observaciones, proveedor, proyecto, cliente_interno, autorizado_por_id, partida, lote_id, hoja_ruta_id, remito } = req.body;
    const prodDestino = db.prepare('SELECT * FROM productos WHERE id=?').get(producto_id);
    if (!prodDestino) return res.status(404).json({ error: 'Producto no encontrado' });
    let autorizante = null;
    if (tipo === 'salida') {
      autorizante = obtenerAutorizantes().find(u => u.id === parseInt(autorizado_por_id));
      if (!autorizante) return res.status(400).json({ error: 'Elegí quién autoriza este retiro' });
      // Un movimiento de substock nunca llega hasta acá (se corta más arriba),
      // así que toda 'salida' editable desde Stock es directa a una persona.
      if (!proyecto?.trim()) return res.status(400).json({ error: 'Elegí un proyecto o actividad' });
    }
    if (tipo === 'entrada' && !proveedor?.trim())
      return res.status(400).json({ error: 'Elegí el proveedor de este ingreso' });
    try {
      db.transaction(() => {
        // Revertir el efecto del movimiento tal como estaba antes de editarlo
        // (stock_actual del producto viejo y, si tenía, su lote de origen).
        revertirMovimiento(mov);
        // Aplicar el movimiento con los datos nuevos (puede ser el mismo
        // producto u otro) — releer el producto destino por si es el mismo
        // que se acaba de revertir arriba (su stock_actual ya cambió).
        const prodActualizado = db.prepare('SELECT * FROM productos WHERE id=?').get(producto_id);
        const ef = aplicarMovimiento(prodActualizado, tipo, cantidad, { lote_id, partida, precio_costo: precio_unit, proveedor, referencia, remito, fecha });
        db.prepare(`UPDATE movimientos_stock SET producto_id=?,tipo=?,cantidad=?,fecha=?,referencia=?,precio_unit=?,observaciones=?,proveedor=?,proyecto=?,cliente_interno=?,autorizado_por_id=?,autorizado_por_nombre=?,lote_id=?,partida=?,hoja_ruta_id=?,remito=? WHERE id=?`)
          .run(producto_id, tipo, cantidad, fecha, referencia||'', precio_unit||0, observaciones||'', proveedor||'', proyecto||'', cliente_interno||'',
               autorizante?.id || null, autorizante?.nombre || '', ef.lote_id, ef.partida, (tipo === 'salida' && hoja_ruta_id) || null, remito||'', mov.id);
      })();
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    res.json(db.prepare(`
      SELECT m.*, p.codigo, p.descripcion, p.unidad
      FROM movimientos_stock m LEFT JOIN productos p ON m.producto_id=p.id
      WHERE m.id=?
    `).get(mov.id));
  }
);

// ── Eliminar movimiento (admin) — revierte el stock ───────────────────────────
router.delete('/movimientos/:id', verificarToken, (req, res) => {
  if (req.usuario?.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
  const mov = db.prepare('SELECT * FROM movimientos_stock WHERE id=?').get(req.params.id);
  if (!mov) return res.status(404).json({ error: 'Movimiento no encontrado' });
  if (mov.substock_destino || mov.substock_origen)
    return res.status(400).json({ error: 'Este movimiento es de Substock — no se puede editar/eliminar desde Stock' });
  if (mov.tipo_doc === 'pedido_stock' || mov.tipo_doc === 'venta_repuesto')
    return res.status(400).json({ error: 'Este movimiento viene de un pedido/venta — no se puede editar/eliminar desde Stock' });
  db.transaction(() => {
    revertirMovimiento(mov);
    db.prepare('DELETE FROM movimientos_stock WHERE id=?').run(mov.id);
  })();
  res.json({ ok: true });
});

// ── Ingresos pendientes ────────────────────────────────────────────────────────

router.get('/ingresos-pendientes', verificarToken, leerStock, (req, res) => {
  const rows = db.prepare(`
    SELECT ip.*, p.stock_actual, p.trazabilidad_stock, p.unidad AS producto_unidad, p.unidad_compra
    FROM ingresos_pendientes ip
    LEFT JOIN productos p ON p.id = ip.producto_id
    ORDER BY ip.created_at ASC
  `).all();
  res.json(rows);
});

router.post('/ingresos-pendientes/:id/confirmar', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
  const row = db.prepare('SELECT * FROM ingresos_pendientes WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrado' });
  const p = db.prepare('SELECT * FROM productos WHERE id=?').get(row.producto_id);
  if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
  const hoyStr = hoyArgentina();
  // La partida se pudo cargar al recibir la OC (Compras) — si ese material la
  // requiere y no se cargó ahí, se puede completar recién acá, al confirmar.
  const partida = req.body.partida ?? row.partida;
  // Cuando el material se compra en una unidad distinta a la de stock (ej.
  // chapas: OC en kg, depósito en unidades — productos.unidad_compra), no hay
  // conversión automática: quien confirma el ingreso carga a mano cuánto
  // entró realmente al depósito, en la unidad de stock. Si no se manda nada,
  // se asume que son la misma cantidad (comportamiento de siempre).
  const cantidadStock = (req.body.cantidad_stock !== undefined && req.body.cantidad_stock !== null && req.body.cantidad_stock !== '')
    ? parseFloat(req.body.cantidad_stock) : row.cantidad;
  if (!(cantidadStock > 0)) return res.status(400).json({ error: 'Cantidad a stock inválida' });
  try {
    db.transaction(() => {
      const ef = aplicarMovimiento(p, 'entrada', cantidadStock, {
        partida, precio_costo: row.precio_costo, proveedor: row.proveedor_nombre,
        referencia: row.oc_numero, remito: row.numero_remito, fecha: row.fecha_recepcion || hoyStr,
      });
      db.prepare(`INSERT INTO movimientos_stock
        (producto_id,tipo,cantidad,fecha,referencia,tipo_doc,doc_id,precio_unit,observaciones,proveedor,created_by,lote_id,partida,remito)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(row.producto_id, 'entrada', cantidadStock, row.fecha_recepcion||hoyStr,
          row.oc_numero, 'oc', row.oc_id, row.precio_costo||0,
          `Ingreso OC ${row.oc_numero}${row.numero_remito ? ' — Remito '+row.numero_remito : ''}`
            + (cantidadStock !== row.cantidad ? ` (OC: ${row.cantidad} ${row.unidad||''})` : ''),
          row.proveedor_nombre||'', req.usuario.id, ef.lote_id, ef.partida, row.numero_remito||'');
      db.prepare('DELETE FROM ingresos_pendientes WHERE id=?').run(row.id);
    })();
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  res.json({ ok: true });
});

router.delete('/ingresos-pendientes/:id', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
  const row = db.prepare('SELECT * FROM ingresos_pendientes WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrado' });
  db.prepare('DELETE FROM ingresos_pendientes WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── Ingresos pendientes SIN OC ────────────────────────────────────────────────

router.get('/ingresos-sin-oc-pendientes', verificarToken, leerStock, (req, res) => {
  const rows = db.prepare(`
    SELECT ip.*, p.stock_actual, p.codigo as producto_codigo_actual, p.descripcion as producto_desc_actual,
      p.trazabilidad_stock, p.unidad AS producto_unidad, p.unidad_compra
    FROM ingresos_sin_oc_pendientes ip
    LEFT JOIN productos p ON p.id = ip.producto_id
    ORDER BY ip.created_at ASC
  `).all();
  res.json(rows);
});

router.post('/ingresos-sin-oc-pendientes/:id/confirmar', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
  const row = db.prepare('SELECT * FROM ingresos_sin_oc_pendientes WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrado' });
  const { producto_id } = req.body;
  const pid = producto_id || row.producto_id;
  if (!pid) return res.status(400).json({ error: 'Se requiere seleccionar un producto del catálogo' });
  const prod = db.prepare('SELECT * FROM productos WHERE id=?').get(pid);
  if (!prod) return res.status(404).json({ error: 'Producto no encontrado' });
  const hoyStr = hoyArgentina();
  const partida = req.body.partida ?? row.partida;
  // Mismo criterio que en /ingresos-pendientes/:id/confirmar: si el material
  // se compra en una unidad distinta a la de stock, la cantidad que entra al
  // depósito se carga a mano acá, sin conversión automática.
  const cantidadStock = (req.body.cantidad_stock !== undefined && req.body.cantidad_stock !== null && req.body.cantidad_stock !== '')
    ? parseFloat(req.body.cantidad_stock) : row.cantidad;
  if (!(cantidadStock > 0)) return res.status(400).json({ error: 'Cantidad a stock inválida' });
  try {
    db.transaction(() => {
      const ef = aplicarMovimiento(prod, 'entrada', cantidadStock, {
        partida, precio_costo: row.precio_costo, proveedor: row.proveedor_nombre, referencia: row.form49_numero, fecha: hoyStr,
      });
      db.prepare(`INSERT INTO movimientos_stock
        (producto_id,tipo,cantidad,fecha,referencia,tipo_doc,doc_id,precio_unit,observaciones,proveedor,created_by,lote_id,partida)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(pid, 'entrada', cantidadStock, hoyStr,
             row.form49_numero, 'form49', row.form49_id, row.precio_costo||0,
             `Ingreso sin OC ${row.form49_numero} — ${row.descripcion}`
               + (cantidadStock !== row.cantidad ? ` (cargado: ${row.cantidad} ${row.unidad||''})` : ''),
             row.proveedor_nombre||'', req.usuario.id, ef.lote_id, ef.partida);
      db.prepare('DELETE FROM ingresos_sin_oc_pendientes WHERE id=?').run(row.id);
    })();
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  res.json({ ok: true });
});

router.delete('/ingresos-sin-oc-pendientes/:id', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
  db.prepare('DELETE FROM ingresos_sin_oc_pendientes WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── Pedido de Stock (solicitud interna de materiales) ─────────────────────────
// El permiso "pedidos_stock" es independiente del de "stock": puede darse a
// alguien que necesita pedir materiales sin darle acceso a ver/editar todo el
// inventario — quien confirma la entrega es siempre alguien con permiso de
// escritura sobre "stock" (el depósito), nunca el propio solicitante.
// El proyecto o actividad es obligatorio (uno de los dos, nunca ambos) — así
// la salida de stock queda siempre atribuible a un centro de costo real, con
// el solicitante como responsable (solicitante_id/solicitante_nombre).
const PEDIDOS_SELECT_ASIGNACION = `
  SELECT ps.*, pr.codigo AS proyecto_codigo, pr.nombre AS proyecto_nombre, act.nombre AS actividad_nombre
  FROM pedidos_stock ps
  LEFT JOIN proyectos pr ON pr.id = ps.proyecto_id
  LEFT JOIN rrhh_actividades act ON act.id = ps.actividad_id
`;
function textoAsignacion(proyecto_codigo, proyecto_nombre, actividad_nombre) {
  if (actividad_nombre) return actividad_nombre;
  if (proyecto_codigo || proyecto_nombre) return [proyecto_codigo, proyecto_nombre].filter(Boolean).join(' — ');
  return '';
}

router.post('/pedidos', verificarToken, leerPedidosStock, (req, res) => {
  if (!puedePedir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const { items, observaciones, proyecto_id, actividad_id, autorizado_por_id } = req.body;
  if (!proyecto_id && !actividad_id) return res.status(400).json({ error: 'Elegí un proyecto o actividad' });
  if (proyecto_id && actividad_id) return res.status(400).json({ error: 'Elegí un proyecto o una actividad, no los dos' });
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Agregá al menos un ítem' });
  for (const it of items) {
    if (!it.producto_id || !parseFloat(it.cantidad) || parseFloat(it.cantidad) <= 0)
      return res.status(400).json({ error: 'Cada ítem necesita un producto y una cantidad mayor a 0' });
  }
  // Todo pedido tiene que quedar con quién lo autoriza, elegido en el momento
  // de pedir (no al entregar) — se valida contra la lista real de admin/gerentes.
  const autorizante = obtenerAutorizantes().find(u => u.id === parseInt(autorizado_por_id));
  if (!autorizante) return res.status(400).json({ error: 'Elegí quién autoriza este pedido' });
  const pedidoId = db.transaction(() => {
    const rp = db.prepare(`INSERT INTO pedidos_stock (solicitante_id, solicitante_nombre, observaciones, proyecto_id, actividad_id, autorizado_por_id, autorizado_por_nombre) VALUES (?,?,?,?,?,?,?)`)
      .run(req.usuario.id, req.usuario.nombre || '', observaciones || '', proyecto_id || null, actividad_id || null, autorizante.id, autorizante.nombre);
    const insItem = db.prepare(`INSERT INTO pedido_stock_items (pedido_id, producto_id, cantidad) VALUES (?,?,?)`);
    for (const it of items) insItem.run(rp.lastInsertRowid, it.producto_id, parseFloat(it.cantidad));
    return rp.lastInsertRowid;
  })();
  res.status(201).json({ id: pedidoId });
});

// Mis pedidos (el solicitante ve solo los propios, sin importar si tiene acceso a Stock)
router.get('/pedidos/mios', verificarToken, leerPedidosStock, (req, res) => {
  const pedidos = db.prepare(`${PEDIDOS_SELECT_ASIGNACION} WHERE ps.solicitante_id=? ORDER BY ps.created_at DESC`).all(req.usuario.id);
  const ids = pedidos.map(p => p.id);
  const items = ids.length ? db.prepare(`
    SELECT psi.*, p.codigo, p.descripcion, p.unidad
    FROM pedido_stock_items psi JOIN productos p ON p.id = psi.producto_id
    WHERE psi.pedido_id IN (${ids.map(() => '?').join(',')})
  `).all(...ids) : [];
  res.json(pedidos.map(p => ({ ...p, items: items.filter(i => i.pedido_id === p.id) })));
});

// Materiales que YO retiré directamente del stock (no vía un pedido), último mes.
// "created_by" es siempre quien CARGA el movimiento (típicamente Depósito), no
// a quién se le entregó — el destinatario real queda en "cliente_interno" (un
// nombre de empleado elegido a mano al registrar la salida, ver Stock.jsx). Por
// eso se identifica al usuario por ese campo, no por created_by. Mismo criterio
// de acceso que "mis pedidos": alcanza con el permiso liviano de pedidos_stock,
// sin necesitar acceso completo a Stock.
router.get('/movimientos/mios-directos', verificarToken, leerPedidosStock, (req, res) => {
  const rows = db.prepare(`
    SELECT m.id, m.fecha, m.cantidad, m.referencia, m.proyecto, m.cliente_interno, m.observaciones,
           p.codigo, p.descripcion, p.unidad
    FROM movimientos_stock m JOIN productos p ON p.id = m.producto_id
    WHERE UPPER(TRIM(m.cliente_interno)) = UPPER(TRIM(?)) AND m.cliente_interno != ''
      AND m.tipo = 'salida' AND m.tipo_doc != 'pedido_stock'
      AND m.fecha >= date('now', '-1 month')
    ORDER BY m.fecha DESC, m.id DESC
  `).all(req.usuario.nombre || '');
  res.json(rows);
});

// Cancelar mi propio pedido — solo si todavía no se entregó nada
router.delete('/pedidos/:id', verificarToken, leerPedidosStock, (req, res) => {
  const ped = db.prepare('SELECT * FROM pedidos_stock WHERE id=?').get(req.params.id);
  if (!ped) return res.status(404).json({ error: 'No encontrado' });
  if (ped.solicitante_id !== req.usuario.id && req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  if (ped.estado !== 'Pendiente') return res.status(400).json({ error: 'Ya se empezó a entregar este pedido, no se puede cancelar' });
  db.prepare(`UPDATE pedidos_stock SET estado='Cancelado' WHERE id=?`).run(req.params.id);
  res.json({ ok: true });
});

// Todos los pedidos pendientes/parciales — para quien tiene acceso de lectura a Stock
router.get('/pedidos', verificarToken, leerStock, (req, res) => {
  const pedidos = db.prepare(`${PEDIDOS_SELECT_ASIGNACION} WHERE ps.estado IN ('Pendiente','Parcial') ORDER BY ps.created_at ASC`).all();
  const ids = pedidos.map(p => p.id);
  const items = ids.length ? db.prepare(`
    SELECT psi.*, p.codigo, p.descripcion, p.unidad, p.stock_actual, p.trazabilidad_stock
    FROM pedido_stock_items psi JOIN productos p ON p.id = psi.producto_id
    WHERE psi.pedido_id IN (${ids.map(() => '?').join(',')})
  `).all(...ids) : [];
  res.json(pedidos.map(p => ({ ...p, items: items.filter(i => i.pedido_id === p.id) })));
});

// Confirmar entrega (total o parcial) de un pedido — descuenta stock recién acá
router.post('/pedidos/:id/entregar', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
  const ped = db.prepare(`${PEDIDOS_SELECT_ASIGNACION} WHERE ps.id=?`).get(req.params.id);
  if (!ped) return res.status(404).json({ error: 'No encontrado' });
  if (ped.estado === 'Cancelado') return res.status(400).json({ error: 'Este pedido está cancelado' });

  const { entregas } = req.body; // { [item_id]: cantidadAEntregarAhora }
  if (!entregas || typeof entregas !== 'object') return res.status(400).json({ error: 'Falta el detalle de entrega' });

  const items = db.prepare('SELECT * FROM pedido_stock_items WHERE pedido_id=?').all(ped.id);
  const hoyStr = hoyArgentina();
  const asignacionTexto = textoAsignacion(ped.proyecto_codigo, ped.proyecto_nombre, ped.actividad_nombre);
  const detalleEntregado = [];

  try {
    db.transaction(() => {
      let todosCompletos = true;
      for (const item of items) {
        const pendiente = item.cantidad - item.cantidad_entregada;
        // entregas[item.id] es un número simple (materiales sin partida) o
        // {cantidad, lote_id} cuando el producto requiere elegir de qué
        // partida sale.
        const entregaRaw = entregas[item.id];
        const esObjeto = entregaRaw != null && typeof entregaRaw === 'object';
        const aEntregar = parseFloat(esObjeto ? entregaRaw.cantidad : entregaRaw) || 0;
        const loteIdItem = esObjeto ? entregaRaw.lote_id : null;
        if (aEntregar <= 0) { if (pendiente > 0.0001) todosCompletos = false; continue; }
        if (aEntregar > pendiente + 0.0001) throw new Error(`No se puede entregar más de lo pedido (pendiente: ${pendiente})`);

        const prod = db.prepare('SELECT * FROM productos WHERE id=?').get(item.producto_id);
        if (!prod) throw new Error('Producto no encontrado');

        let ef;
        try {
          ef = aplicarMovimiento(prod, 'salida', aEntregar, { lote_id: loteIdItem });
        } catch (e) {
          throw new Error(`${prod.codigo} — ${prod.descripcion}: ${e.message}`);
        }

        db.prepare("UPDATE pedido_stock_items SET cantidad_entregada=cantidad_entregada+? WHERE id=?").run(aEntregar, item.id);
        db.prepare(`INSERT INTO movimientos_stock (producto_id,tipo,cantidad,fecha,referencia,tipo_doc,doc_id,observaciones,proyecto,cliente_interno,created_by,autorizado_por_id,autorizado_por_nombre,lote_id,partida)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(item.producto_id, 'salida', aEntregar, hoyStr, `Pedido #${ped.id}`, 'pedido_stock', ped.id,
               `Entrega a ${ped.solicitante_nombre}`, asignacionTexto, ped.solicitante_nombre || '', req.usuario.id,
               ped.autorizado_por_id || null, ped.autorizado_por_nombre || '', ef.lote_id, ef.partida);
        detalleEntregado.push(`${prod.codigo} — ${prod.descripcion}: ${aEntregar} ${prod.unidad}`);

        if (aEntregar < pendiente - 0.0001) todosCompletos = false;
      }
      db.prepare(`UPDATE pedidos_stock SET estado=? WHERE id=?`).run(todosCompletos ? 'Entregado' : 'Parcial', ped.id);
    })();
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  // Notificar al autorizante recién con lo que realmente se entregó — puede
  // ser distinto de lo pedido (entrega parcial), por eso no se avisa antes.
  if (ped.autorizado_por_id && detalleEntregado.length) {
    enviarMensajeSistema({
      de_id: req.usuario.id, de_nombre: req.usuario.nombre, para_id: ped.autorizado_por_id,
      asunto: `Retiro de stock autorizado — Pedido #${ped.id}`,
      cuerpo: `Se entregó del pedido de stock #${ped.id}:\n\n${detalleEntregado.join('\n')}\n\n`
        + `Pedido por: ${ped.solicitante_nombre}\nProyecto/Actividad: ${asignacionTexto || '—'}\nFecha: ${hoyStr}\n`
        + `Entregado por: ${req.usuario.nombre}`,
    });
  }
  res.json({ ok: true });
});

module.exports = router;
