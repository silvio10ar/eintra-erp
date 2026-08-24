const express = require('express');
const XLSX    = require('xlsx');
const { body, validationResult } = require('express-validator');
const { db }  = require('../db/database');
const { verificarToken, puede: permisoModulo } = require('../middleware/auth');
const { buscarCondicion } = require('../helpers/buscar');
const { hoyArgentina } = require('../helpers/fecha');
const { encontrarRaiz } = require('../helpers/organigrama');
const { enviarMensajeSistema } = require('../helpers/mensajes');

const router = express.Router();
const puede = req => !!(req.permisos?.stock?.escribir);
const leerStock = permisoModulo.leer('stock');
const leerPedidosStock = permisoModulo.leer('pedidos_stock');
const puedePedir = req => !!(req.permisos?.pedidos_stock?.escribir);

// Quién puede figurar como "autorizante" de un retiro de stock: el rol admin,
// o quien ocupe un puesto de gerencia (la raíz del organigrama, o alguno de
// sus "Gerente de X" directos) — mismo criterio de "gerencia" que ya usa
// /auth/gerencias para agrupar el menú y asignar módulos por rama.
// El nombre a mostrar/guardar es siempre el de RRHH (rrhh_empleados.nombre),
// no el "nombre" de la cuenta de usuario — pueden ser distintos (cuentas
// genéricas tipo "Administrador"), y lo que tiene que quedar identificable
// para el resto del equipo es la persona real, no el login.
function obtenerAutorizantes() {
  const admins = db.prepare(`
    SELECT u.id, COALESCE(e.nombre, u.nombre) AS nombre
    FROM usuarios u LEFT JOIN rrhh_empleados e ON e.id = u.rrhh_empleado_id
    WHERE u.activo=1 AND u.rol='admin'
  `).all();
  const puestos = db.prepare('SELECT id, nombre, area, reporta_a_id FROM puestos').all();
  const raiz = encontrarRaiz(puestos);
  const porId = new Map(admins.map(u => [u.id, u]));
  if (raiz) {
    const puestosGerencia = [raiz.id, ...puestos.filter(p => p.reporta_a_id === raiz.id).map(p => p.id)];
    const ph = puestosGerencia.map(() => '?').join(',');
    const gerentes = db.prepare(`
      SELECT DISTINCT u.id, COALESCE(e.nombre, u.nombre) AS nombre
      FROM usuarios u
      JOIN usuario_puestos up ON up.usuario_id = u.id
      LEFT JOIN rrhh_empleados e ON e.id = u.rrhh_empleado_id
      WHERE u.activo=1 AND up.puesto_id IN (${ph})
    `).all(...puestosGerencia);
    for (const u of gerentes) porId.set(u.id, u);
  }
  return [...porId.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
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
  const rows = db.prepare(`SELECT * FROM productos p WHERE ${conds.join(' AND ')} ORDER BY p.descripcion`).all(...params);
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

router.get('/movimientos/valores', verificarToken, leerStock, (req, res) => {
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

router.get('/productos/:id', verificarToken, leerStock, (req, res) => {
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
    const { codigo, descripcion, categoria, unidad, stock_actual, stock_minimo, ubicacion, precio_costo, precio_venta, proveedor, codigo_proveedor } = req.body;
    const precio_fecha = (precio_costo || precio_venta) ? hoyArgentina() : '';
    try {
      const r = db.prepare(`INSERT INTO productos (codigo,descripcion,categoria,unidad,stock_actual,stock_minimo,ubicacion,precio_costo,precio_venta,proveedor,codigo_proveedor,precio_fecha) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(codigo, descripcion, categoria||'', unidad||'UND.', stock_actual||0, stock_minimo||0, ubicacion||'', precio_costo||0, precio_venta||0, proveedor||'', codigo_proveedor||'', precio_fecha);
      res.status(201).json(db.prepare('SELECT * FROM productos WHERE id=?').get(r.lastInsertRowid));
    } catch(e) {
      if (e.message.includes('UNIQUE')) {
        // Si existe pero está inactivo, reactivarlo con los nuevos datos
        const inactivo = db.prepare('SELECT id FROM productos WHERE codigo=? AND activo=0').get(codigo);
        if (inactivo) {
          db.prepare(`UPDATE productos SET descripcion=?,categoria=?,unidad=?,stock_actual=?,stock_minimo=?,ubicacion=?,precio_costo=?,precio_venta=?,proveedor=?,codigo_proveedor=?,activo=1,precio_fecha=?,updated_at=datetime('now','localtime') WHERE id=?`)
            .run(descripcion, categoria||'', unidad||'UND.', stock_actual||0, stock_minimo||0, ubicacion||'', precio_costo||0, precio_venta||0, proveedor||'', codigo_proveedor||'', precio_fecha, inactivo.id);
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
  const { codigo, descripcion, categoria, unidad, stock_minimo, ubicacion, precio_costo, precio_venta, proveedor, codigo_proveedor } = req.body;
  const nuevoCosto = precio_costo ?? p.precio_costo;
  const nuevaVenta = precio_venta ?? p.precio_venta;
  // La fecha solo se actualiza si el precio realmente cambió (ej. al tocar solo la ubicación no debe pisarse).
  const cambioPrecio = Number(nuevoCosto) !== Number(p.precio_costo) || Number(nuevaVenta) !== Number(p.precio_venta);
  const precio_fecha = cambioPrecio ? hoyArgentina() : p.precio_fecha;
  try {
    db.prepare(`UPDATE productos SET codigo=?,descripcion=?,categoria=?,unidad=?,stock_minimo=?,ubicacion=?,precio_costo=?,precio_venta=?,proveedor=?,codigo_proveedor=?,precio_fecha=?,updated_at=datetime('now','localtime') WHERE id=?`)
      .run(codigo??p.codigo, descripcion??p.descripcion, categoria??p.categoria, unidad??p.unidad,
           stock_minimo??p.stock_minimo, ubicacion??p.ubicacion, nuevoCosto,
           nuevaVenta, proveedor??p.proveedor??'', codigo_proveedor??p.codigo_proveedor??'', precio_fecha, req.params.id);
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

router.get('/movimientos', verificarToken, leerStock, (req, res) => {
  const { producto_id, tipo, desde, hasta, campo, valor, page=1, limit=200 } = req.query;
  const conds = [], params = [];
  if (producto_id) { conds.push('m.producto_id=?');  params.push(producto_id); }
  if (tipo)        { conds.push('m.tipo=?');           params.push(tipo); }
  if (desde)       { conds.push('m.fecha>=?');          params.push(desde); }
  if (hasta)       { conds.push('m.fecha<=?');          params.push(hasta); }
  if (campo && valor) {
    const mapaCols = {
      codigo:          'm_p.codigo',
      descripcion:     'm_p.descripcion',
      proveedor:       'm.proveedor',
      proyecto:        'm.proyecto',
      cliente_interno: 'm.cliente_interno',
      observaciones:   'm.observaciones',
    };
    const col = mapaCols[campo];
    const bc = buscarCondicion(valor, col ? [col] : ['m_p.codigo','m_p.descripcion','m.proveedor','m.proyecto','m.cliente_interno']);
    conds.push(bc.cond); params.push(...bc.params);
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
  (req, res) => {
    if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' });
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() });
    const { producto_id, tipo, cantidad, fecha, referencia, precio_unit, observaciones, proveedor, proyecto, cliente_interno, autorizado_por_id } = req.body;
    const p = db.prepare('SELECT * FROM productos WHERE id=? AND activo=1').get(producto_id);
    if (!p) return res.status(404).json({ error: 'Producto no encontrado' });
    const delta = (tipo === 'salida') ? -cantidad : cantidad;
    if (tipo === 'salida' && p.stock_actual + delta < 0)
      return res.status(400).json({ error: `Stock insuficiente. Disponible: ${p.stock_actual}` });
    // Todo retiro (salida) tiene que quedar con quién lo autoriza — se valida
    // contra la misma lista que se ofrece en el selector (admin o gerentes de
    // gerencia), no alcanza con mandar cualquier id de usuario.
    let autorizante = null;
    if (tipo === 'salida') {
      autorizante = obtenerAutorizantes().find(u => u.id === parseInt(autorizado_por_id));
      if (!autorizante) return res.status(400).json({ error: 'Elegí quién autoriza este retiro' });
    }
    db.transaction(() => {
      db.prepare(`INSERT INTO movimientos_stock (producto_id,tipo,cantidad,fecha,referencia,precio_unit,observaciones,proveedor,proyecto,cliente_interno,created_by,autorizado_por_id,autorizado_por_nombre)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(producto_id, tipo, cantidad, fecha, referencia||'', precio_unit||0, observaciones||'', proveedor||'', proyecto||'', cliente_interno||'', req.usuario.id,
             autorizante?.id || null, autorizante?.nombre || '');
      db.prepare("UPDATE productos SET stock_actual=stock_actual+?, updated_at=datetime('now','localtime') WHERE id=?").run(delta, producto_id);
    })();
    if (autorizante) {
      enviarMensajeSistema({
        de_id: req.usuario.id, de_nombre: req.usuario.nombre, para_id: autorizante.id,
        asunto: `Retiro de stock autorizado: ${p.codigo} — ${p.descripcion}`,
        cuerpo: `Se retiró del stock:\n\n${p.codigo} — ${p.descripcion}\nCantidad: ${cantidad} ${p.unidad}\n`
          + `Retirado por: ${cliente_interno || '—'}\nProyecto/Actividad: ${proyecto || '—'}\nFecha: ${fecha}\n`
          + `Cargado por: ${req.usuario.nombre}${observaciones ? `\nObservaciones: ${observaciones}` : ''}`,
      });
    }
    res.status(201).json({ stock_nuevo: p.stock_actual + delta, mensaje: `Stock actualizado: ${p.stock_actual + delta}` });
  }
);

// ── Exportar productos ─────────────────────────────────────────────────────────
router.get('/exportar', verificarToken, leerStock, (req, res) => {
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
router.get('/exportar-historial', verificarToken, leerStock, (req, res) => {
  const { tipo, desde, hasta, campo, valor } = req.query;
  const conds = [], params = [];
  if (tipo)  { conds.push('m.tipo=?');  params.push(tipo); }
  if (desde) { conds.push('m.fecha>=?'); params.push(desde); }
  if (hasta) { conds.push('m.fecha<=?'); params.push(hasta); }
  if (campo && valor) {
    const mapaCols = { codigo:'m_p.codigo', descripcion:'m_p.descripcion',
      proveedor:'m.proveedor', proyecto:'m.proyecto', cliente_interno:'m.cliente_interno' };
    const col = mapaCols[campo];
    const bc = buscarCondicion(valor, col ? [col] : ['m_p.codigo','m_p.descripcion','m.proveedor','m.proyecto','m.cliente_interno']);
    conds.push(bc.cond); params.push(...bc.params);
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
  const hoy = hoyArgentina();
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
    const { producto_id, tipo, cantidad, fecha, referencia, precio_unit, observaciones, proveedor, proyecto, cliente_interno, autorizado_por_id } = req.body;
    const prodDestino = db.prepare('SELECT * FROM productos WHERE id=?').get(producto_id);
    if (!prodDestino) return res.status(404).json({ error: 'Producto no encontrado' });
    let autorizante = null;
    if (tipo === 'salida') {
      autorizante = obtenerAutorizantes().find(u => u.id === parseInt(autorizado_por_id));
      if (!autorizante) return res.status(400).json({ error: 'Elegí quién autoriza este retiro' });
    }
    try {
      db.transaction(() => {
        // Revertir el efecto del movimiento tal como estaba antes de editarlo.
        const deltaReversa = (mov.tipo === 'salida') ? mov.cantidad : -mov.cantidad;
        db.prepare("UPDATE productos SET stock_actual=stock_actual+? WHERE id=?").run(deltaReversa, mov.producto_id);
        // Aplicar el movimiento con los datos nuevos (puede ser el mismo producto u otro).
        const stockPrevioDestino = db.prepare('SELECT stock_actual FROM productos WHERE id=?').get(producto_id).stock_actual;
        const deltaNuevo = (tipo === 'salida') ? -cantidad : cantidad;
        if (tipo === 'salida' && stockPrevioDestino + deltaNuevo < 0)
          throw new Error(`Stock insuficiente en destino. Disponible: ${stockPrevioDestino}`);
        db.prepare("UPDATE productos SET stock_actual=stock_actual+?, updated_at=datetime('now','localtime') WHERE id=?").run(deltaNuevo, producto_id);
        db.prepare(`UPDATE movimientos_stock SET producto_id=?,tipo=?,cantidad=?,fecha=?,referencia=?,precio_unit=?,observaciones=?,proveedor=?,proyecto=?,cliente_interno=?,autorizado_por_id=?,autorizado_por_nombre=? WHERE id=?`)
          .run(producto_id, tipo, cantidad, fecha, referencia||'', precio_unit||0, observaciones||'', proveedor||'', proyecto||'', cliente_interno||'',
               autorizante?.id || null, autorizante?.nombre || '', mov.id);
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
  const delta = (mov.tipo === 'salida') ? mov.cantidad : -mov.cantidad;
  db.transaction(() => {
    db.prepare("UPDATE productos SET stock_actual=stock_actual+?, updated_at=datetime('now','localtime') WHERE id=?")
      .run(delta, mov.producto_id);
    db.prepare('DELETE FROM movimientos_stock WHERE id=?').run(mov.id);
  })();
  res.json({ ok: true });
});

// ── Ingresos pendientes ────────────────────────────────────────────────────────

router.get('/ingresos-pendientes', verificarToken, leerStock, (req, res) => {
  const rows = db.prepare(`
    SELECT ip.*, p.stock_actual
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
  const hoyStr = hoyArgentina();
  db.transaction(() => {
    db.prepare("UPDATE productos SET stock_actual=stock_actual+?, updated_at=datetime('now','localtime') WHERE id=?")
      .run(row.cantidad, row.producto_id);
    db.prepare(`INSERT INTO movimientos_stock
      (producto_id,tipo,cantidad,fecha,referencia,tipo_doc,doc_id,precio_unit,observaciones,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(row.producto_id, 'entrada', row.cantidad, row.fecha_recepcion||hoyStr,
        row.oc_numero, 'oc', row.oc_id, row.precio_costo||0,
        `Ingreso OC ${row.oc_numero}${row.numero_remito ? ' — Remito '+row.numero_remito : ''}`,
        req.usuario.id);
    db.prepare('DELETE FROM ingresos_pendientes WHERE id=?').run(row.id);
  })();
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
    SELECT ip.*, p.stock_actual, p.codigo as producto_codigo_actual, p.descripcion as producto_desc_actual
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
  db.transaction(() => {
    db.prepare("UPDATE productos SET stock_actual=stock_actual+?, updated_at=datetime('now','localtime') WHERE id=?")
      .run(row.cantidad, pid);
    db.prepare(`INSERT INTO movimientos_stock
      (producto_id,tipo,cantidad,fecha,referencia,tipo_doc,doc_id,precio_unit,observaciones,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(pid, 'entrada', row.cantidad, hoyStr,
           row.form49_numero, 'form49', row.form49_id, row.precio_costo||0,
           `Ingreso sin OC ${row.form49_numero} — ${row.descripcion}`,
           req.usuario.id);
    db.prepare('DELETE FROM ingresos_sin_oc_pendientes WHERE id=?').run(row.id);
  })();
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
    SELECT psi.*, p.codigo, p.descripcion, p.unidad, p.stock_actual
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
        const aEntregar = parseFloat(entregas[item.id]) || 0;
        if (aEntregar <= 0) { if (pendiente > 0.0001) todosCompletos = false; continue; }
        if (aEntregar > pendiente + 0.0001) throw new Error(`No se puede entregar más de lo pedido (pendiente: ${pendiente})`);

        const prod = db.prepare('SELECT * FROM productos WHERE id=?').get(item.producto_id);
        if (!prod) throw new Error('Producto no encontrado');
        if (prod.stock_actual - aEntregar < 0) throw new Error(`Stock insuficiente de ${prod.codigo} — ${prod.descripcion}. Disponible: ${prod.stock_actual}`);

        db.prepare("UPDATE productos SET stock_actual=stock_actual-?, updated_at=datetime('now','localtime') WHERE id=?").run(aEntregar, item.producto_id);
        db.prepare("UPDATE pedido_stock_items SET cantidad_entregada=cantidad_entregada+? WHERE id=?").run(aEntregar, item.id);
        db.prepare(`INSERT INTO movimientos_stock (producto_id,tipo,cantidad,fecha,referencia,tipo_doc,doc_id,observaciones,proyecto,cliente_interno,created_by,autorizado_por_id,autorizado_por_nombre)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(item.producto_id, 'salida', aEntregar, hoyStr, `Pedido #${ped.id}`, 'pedido_stock', ped.id,
               `Entrega a ${ped.solicitante_nombre}`, asignacionTexto, ped.solicitante_nombre || '', req.usuario.id,
               ped.autorizado_por_id || null, ped.autorizado_por_nombre || '');
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
