const express = require('express');
const XLSX    = require('xlsx');
const { body, validationResult } = require('express-validator');
const { db }  = require('../db/database');
const { verificarToken, puede } = require('../middleware/auth');
const { buscarCondicion } = require('../helpers/buscar');
const { sqlFechaIso, hoyArgentina } = require('../helpers/fecha');
const { formatCuit } = require('../helpers/cuit');
const { tasaCambioSistema } = require('../helpers/tipoCambio');
const { validarPctCuotas } = require('../helpers/cuotas');

const router = express.Router();

// Datos de precios/OC: alcanza con permiso de lectura en Compras o Finanzas
const leerCompras = (req, res, next) => {
  if (req.usuario?.rol === 'admin' || req.permisos?.compras?.leer || req.permisos?.finanzas?.leer) return next();
  return res.status(403).json({ error: 'Sin permisos de lectura' });
};
// El listado de OC también lo necesita Administración: para elegir la OC de
// referencia al cargar una factura de compra (selector con opción PENDIENTE).
// No se amplía leerCompras en general porque cubre datos más sensibles
// (último precio, exportación de OC, Form49) que Administración no necesita ver.
const leerOCListado = (req, res, next) => {
  if (req.usuario?.rol === 'admin' || req.permisos?.compras?.leer || req.permisos?.finanzas?.leer || req.permisos?.administracion?.leer || req.permisos?.administracion?.escribir) return next();
  return res.status(403).json({ error: 'Sin permisos de lectura' });
};
// Igual que leerCompras, pero también permite a Codificación (necesita ver items de OC sin código)
const leerComprasOCodif = (req, res, next) => {
  if (req.usuario?.rol === 'admin' || req.permisos?.compras?.leer || req.permisos?.codificacion?.leer || req.permisos?.finanzas?.leer) return next();
  return res.status(403).json({ error: 'Sin permisos de lectura' });
};
// Padrón de proveedores (nombre/CUIT/contacto): lo usan Compras, Finanzas,
// Administración (fusión de duplicados), Materiales (selector), Calidad
// (evaluación de proveedores) y Stock (selector al cargar productos).
const leerProveedores = (req, res, next) => {
  if (req.usuario?.rol === 'admin' || req.permisos?.compras?.leer || req.permisos?.finanzas?.leer
      || req.permisos?.administracion?.leer || req.permisos?.administracion?.escribir || req.permisos?.materiales?.leer
      || req.permisos?.calidad?.leer || req.permisos?.stock?.leer) return next();
  return res.status(403).json({ error: 'Sin permisos de lectura' });
};
// Ninguna pantalla deja cargar cantidad/precio negativo (son inputs numéricos
// con min="0") — si llega uno así es un valor mal enviado, no un caso real.
function validarItemsOC(items) {
  if (!items?.length) return null;
  for (const it of items) {
    if (it.cantidad != null && parseFloat(it.cantidad) < 0) return 'La cantidad de un ítem no puede ser negativa';
    if (it.precio_unitario != null && parseFloat(it.precio_unitario) < 0) return 'El precio unitario de un ítem no puede ser negativo';
    if (it.precio_final != null && parseFloat(it.precio_final) < 0) return 'El precio final de un ítem no puede ser negativo';
  }
  return null;
}

// Fusión de proveedores duplicados: reasigna datos de otros módulos (OC, stock,
// mantenimiento, facturas...) de forma irreversible — reservada solo a Admin.
const puedeFusion = (req) => req.usuario?.rol === 'admin';
// Informes/exportaciones consolidadas de Compras: reservado a puestos con el módulo "ampliado"
const leerInformesCompras = (req, res, next) => {
  if (req.usuario?.rol === 'admin' || req.permisos?.compras_informes?.leer || req.permisos?.finanzas?.leer) return next();
  return res.status(403).json({ error: 'Sin permisos de lectura' });
};

// ── Plazo de entrega: OC única o por ítem, calculado en días desde la fecha de OC ──
function sumarDias(fechaISO, dias) {
  if (!fechaISO || dias == null || dias === '') return '';
  const [y, m, d] = fechaISO.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + parseInt(dias, 10));
  return dt.toISOString().slice(0, 10);
}

function calcularFechaEntregaOC(fecha, modo_plazo, dias_plazo, items, fallback) {
  if (modo_plazo === 'ITEM') {
    const conPlazo = (items || []).filter(it => it.dias_plazo != null && it.dias_plazo !== '');
    const pendientes = conPlazo.filter(it => (Number(it.cant_recibida) || 0) < (Number(it.cantidad) || 0));
    const base = pendientes.length ? pendientes : conPlazo;
    if (!base.length) return fallback || '';
    const fechas = base.map(it => sumarDias(fecha, it.dias_plazo)).sort();
    return pendientes.length ? fechas[0] : fechas[fechas.length - 1];
  }
  if (dias_plazo != null && dias_plazo !== '') return sumarDias(fecha, dias_plazo);
  return fallback || '';
}

// ── Proveedores ────────────────────────────────────────────────────────────────

router.get('/proveedores', verificarToken, leerProveedores, (req, res) => {
  const { buscar, todos } = req.query;
  const soloActivos = todos !== '1';
  let where = soloActivos ? 'WHERE activo=1' : '';
  const params = [];
  if (buscar) {
    const b = buscarCondicion(buscar, ['nombre', 'cuit']);
    where = soloActivos ? `WHERE (${b.cond}) AND activo=1` : `WHERE (${b.cond})`;
    params.push(...b.params);
  }
  res.json(db.prepare(`SELECT * FROM proveedores ${where} ORDER BY nombre COLLATE NOCASE`).all(...params));
});

const puedeEscribirAdmin = (req) => req.usuario?.rol === 'admin' || req.permisos?.compras?.escribir || req.permisos?.administracion?.escribir;

router.post('/proveedores', verificarToken, body('nombre').trim().notEmpty(), (req, res) => {
  if (!puedeEscribirAdmin(req)) return res.status(403).json({ error: 'Sin permisos' });
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() });
  const { nombre, cuit, contacto, telefono, email, direccion, localidad, cp, vendedor, condicion_pago, critico,
          categoria_provision, fecha_seleccion, frecuencia_evaluacion, responsable_seleccion, responsable_evaluacion } = req.body;
  try {
    const r = db.prepare('INSERT INTO proveedores (nombre,cuit,contacto,telefono,email,direccion,localidad,cp,vendedor,condicion_pago,critico,categoria_provision,fecha_seleccion,frecuencia_evaluacion,responsable_seleccion,responsable_evaluacion) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(nombre, formatCuit(cuit), contacto||'', telefono||'', email||'', direccion||'', localidad||'', cp||'', vendedor||'', condicion_pago||'TRANSF. BANCARIA', critico?1:0,
           categoria_provision||'', fecha_seleccion||'', frecuencia_evaluacion||'Anual', responsable_seleccion||'', responsable_evaluacion||'');
    res.status(201).json(db.prepare('SELECT * FROM proveedores WHERE id=?').get(r.lastInsertRowid));
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'El proveedor ya existe' });
    throw e;
  }
});

// Buscar proveedor por ID (incluyendo inactivos, para impresión de OC)
router.get('/proveedores/buscar', verificarToken, leerProveedores, (req, res) => {
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
  if (!puedeFusion(req)) return res.status(403).json({ error: 'Sin permisos' });
  const { master_id, duplicados, datos } = req.body;
  if (!master_id || !Array.isArray(duplicados) || !duplicados.length)
    return res.status(400).json({ error: 'Parámetros incompletos' });
  const master = db.prepare('SELECT * FROM proveedores WHERE id=?').get(master_id);
  if (!master) return res.status(404).json({ error: 'Proveedor master no encontrado' });

  db.transaction(() => {
    // Actualizar datos del master con los valores elegidos
    const { nombre, cuit, contacto, telefono, email, direccion, localidad, cp, vendedor, condicion_pago } = datos || {};
    db.prepare('UPDATE proveedores SET nombre=?,cuit=?,contacto=?,telefono=?,email=?,direccion=?,localidad=?,cp=?,vendedor=?,condicion_pago=? WHERE id=?')
      .run(nombre??master.nombre, cuit!=null ? formatCuit(cuit) : master.cuit, contacto??master.contacto, telefono??master.telefono,
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
    // Eliminar duplicados — sus datos ya fueron reasignados al maestro
    for (const dup_id of duplicados) {
      db.prepare('DELETE FROM proveedores WHERE id=?').run(dup_id);
    }
  })();

  const oc_reasignadas = db.prepare('SELECT COUNT(*) as c FROM ordenes_compra WHERE proveedor_id=?').get(master_id).c;
  res.json({ ok: true, oc_reasignadas });
});

// ── GET: todos los nombres de proveedores de todos los módulos ────────────────
// ── GET: detalle de documentos que referencian un nombre de proveedor ─────────
router.get('/proveedores/fusiones/detalle', verificarToken, (req, res) => {
  if (!puedeFusion(req)) return res.status(403).json({ error: 'Sin permisos' });
  const { nombre } = req.query
  if (!nombre) return res.status(400).json({ error: 'nombre requerido' })
  const n = nombre.trim()

  const oc = db.prepare(`SELECT numero, fecha, estado FROM ordenes_compra WHERE trim(proveedor_nombre)=? ORDER BY id DESC LIMIT 20`).all(n)
  const f49 = db.prepare(`SELECT numero, fecha FROM form49_ingresos WHERE trim(proveedor_nombre)=? ORDER BY id DESC LIMIT 20`).all(n)
  let fact = []
  try { fact = db.prepare(`SELECT nro_factura, fecha, total FROM facturas_compra WHERE trim(proveedor_nombre)=? ORDER BY id DESC LIMIT 20`).all(n) } catch(_) {}
  let prod = []
  try { prod = db.prepare(`SELECT codigo, descripcion FROM productos WHERE trim(proveedor)=? LIMIT 20`).all(n) } catch(_) {}
  let mov = []
  try { mov = db.prepare(`SELECT id, fecha, tipo FROM movimientos_stock WHERE trim(proveedor)=? ORDER BY id DESC LIMIT 10`).all(n) } catch(_) {}

  res.json({ oc, f49, fact, prod, mov })
})

router.get('/proveedores/fusiones/todos', verificarToken, (req, res) => {
  if (!puedeFusion(req)) return res.status(403).json({ error: 'Sin permisos' });

  // 1. Maestro (solo activos — los inactivos son duplicados ya procesados)
  const maestro = db.prepare('SELECT id, nombre, cuit, activo FROM proveedores WHERE activo=1').all()
  const mapaId  = {}   // nombre_norm -> { id, cuit, activo }
  for (const p of maestro) {
    const k = p.nombre.trim().toUpperCase()
    mapaId[k] = { id: p.id, cuit: p.cuit, activo: p.activo, nombre_real: p.nombre }
  }

  // 2. Fuentes de texto libre (col_cuit = columna con el CUIT si la tabla lo guarda)
  const FUENTES = [
    { tabla: 'ordenes_compra',                    col: 'proveedor_nombre',  etiqueta: 'Compras/OC',    col_cuit: 'proveedor_cuit' },
    { tabla: 'form49_ingresos',                   col: 'proveedor_nombre',  etiqueta: 'Ingr.s/OC',     col_cuit: 'proveedor_cuit' },
    { tabla: 'facturas_compra',                   col: 'proveedor_nombre',  etiqueta: 'Facturas',      col_cuit: 'proveedor_cuit' },
    { tabla: 'productos',                         col: 'proveedor',         etiqueta: 'Stock',         col_cuit: null },
    { tabla: 'movimientos_stock',                 col: 'proveedor',         etiqueta: 'Movim.',        col_cuit: null },
    { tabla: 'mant_intervenciones_correctivas',   col: 'proveedor',         etiqueta: 'Mantenimiento', col_cuit: null },
    { tabla: 'ingresos_pendientes',               col: 'proveedor_nombre',  etiqueta: 'Ing.Pend.',     col_cuit: null },
    { tabla: 'ingresos_sin_oc_pendientes',        col: 'proveedor_nombre',  etiqueta: 'Ing.Sin OC',    col_cuit: null },
  ]

  // mapa nombre_upper → fuentes[]
  const fuentesPor = {}
  // mapa nombre_upper → cuit encontrado en tablas de texto
  const cuitsPor   = {}

  // Del maestro
  for (const p of maestro) {
    const k = p.nombre.trim().toUpperCase()
    if (!fuentesPor[k]) fuentesPor[k] = new Set()
    fuentesPor[k].add('Maestro')
  }

  // De cada tabla
  for (const { tabla, col, etiqueta, col_cuit } of FUENTES) {
    let rows
    try {
      const selectCuit = col_cuit ? `, "${col_cuit}" as cuit` : ''
      rows = db.prepare(`SELECT "${col}" as n${selectCuit} FROM "${tabla}" WHERE "${col}" IS NOT NULL AND trim("${col}") != ''`).all()
    } catch (_) { continue }
    for (const row of rows) {
      const k = (row.n || '').trim().toUpperCase()
      if (!k) continue
      if (!fuentesPor[k]) fuentesPor[k] = new Set()
      fuentesPor[k].add(etiqueta)
      // Guardar el primer CUIT no vacío que encontremos para este proveedor
      if (row.cuit && row.cuit.trim() && !cuitsPor[k]) {
        cuitsPor[k] = row.cuit.trim()
      }
    }
  }

  // Armar lista de todos los nombres únicos (usando el nombre real del maestro si existe)
  const nombresReales = {}  // nombre_upper -> nombre como figura en el maestro o como texto
  for (const p of maestro) nombresReales[p.nombre.trim().toUpperCase()] = p.nombre.trim()

  for (const { tabla, col } of FUENTES) {
    let rows
    try { rows = db.prepare(`SELECT DISTINCT "${col}" as n FROM "${tabla}" WHERE "${col}" IS NOT NULL AND trim("${col}") != ''`).all() }
    catch (_) { continue }
    for (const { n } of rows) {
      const k = n.trim().toUpperCase()
      if (k && !nombresReales[k]) nombresReales[k] = n.trim()
    }
  }

  const resultado = Object.keys(fuentesPor)
    .sort((a, b) => a.localeCompare(b, 'es'))
    .map(k => {
      const m = mapaId[k]
      // CUIT: del maestro primero, sino de las tablas de texto
      const cuit = m?.cuit || cuitsPor[k] || ''
      return {
        nombre:       nombresReales[k] || k,
        nombre_upper: k,
        proveedor_id: m?.id    ?? null,
        cuit,
        activo:       m?.activo ?? null,
        fuentes:      [...fuentesPor[k]].sort(),
      }
    })

  res.json(resultado)
})

// ── POST: fusión completa (maestro + texto libre) ─────────────────────────────
// body: { master_id, nombre_canon, cuit, duplicados_ids, nombres_texto }
//   master_id: id canónico en proveedores (null → se crea nuevo)
//   nombre_canon: nombre final del canónico
//   duplicados_ids: [ids de proveedores a desactivar y reasignar]
//   nombres_texto: [nombres de texto libre a reasignar al canónico]
router.post('/proveedores/fusiones/aplicar', verificarToken, (req, res) => {
  if (!puedeFusion(req)) return res.status(403).json({ error: 'Sin permisos' });
  let { master_id, nombre_canon, cuit, duplicados_ids = [], nombres_texto = [] } = req.body
  if (!nombre_canon?.trim()) return res.status(400).json({ error: 'nombre_canon requerido' })
  nombre_canon = nombre_canon.trim()

  const stats = { creado: false, oc: 0, form49: 0, facturas: 0, evaluaciones: 0, productos: 0, movimientos: 0, mant: 0, ing_pend: 0 }

  db.transaction(() => {
    // 1. Crear o actualizar el canónico
    if (!master_id) {
      const existe = db.prepare('SELECT id FROM proveedores WHERE nombre=?').get(nombre_canon)
      if (existe) {
        master_id = existe.id
      } else {
        const r = db.prepare('INSERT INTO proveedores (nombre, cuit, activo) VALUES (?,?,1)')
          .run(nombre_canon, cuit || '')
        master_id = r.lastInsertRowid
        stats.creado = true
      }
    } else {
      db.prepare('UPDATE proveedores SET nombre=?, cuit=COALESCE(NULLIF(?,\'\'), cuit), activo=1 WHERE id=?')
        .run(nombre_canon, cuit || '', master_id)
    }

    // 2. Reasignar FK de duplicados_ids → master_id en todas las tablas, luego ELIMINAR el duplicado
    for (const dup_id of duplicados_ids) {
      stats.oc        += db.prepare('UPDATE ordenes_compra SET proveedor_id=?, proveedor_nombre=? WHERE proveedor_id=?').run(master_id, nombre_canon, dup_id).changes
      stats.form49    += db.prepare('UPDATE form49_ingresos SET proveedor_id=?, proveedor_nombre=? WHERE proveedor_id=?').run(master_id, nombre_canon, dup_id).changes
      stats.facturas  += db.prepare('UPDATE facturas_compra SET proveedor_id=?, proveedor_nombre=? WHERE proveedor_id=?').run(master_id, nombre_canon, dup_id).changes
      stats.evaluaciones += db.prepare('UPDATE evaluaciones_proveedor SET proveedor_id=? WHERE proveedor_id=?').run(master_id, dup_id).changes
      // Eliminar el duplicado — ya no tiene datos asociados
      db.prepare('DELETE FROM proveedores WHERE id=?').run(dup_id)
    }

    // 3. Actualizar campos de texto libre con los nombres a fusionar
    const todosNombres = [
      ...nombres_texto,
      ...duplicados_ids.map(id => {
        const p = db.prepare('SELECT nombre FROM proveedores WHERE id=?').get(id)
        return p?.nombre
      }).filter(Boolean)
    ]

    for (const nom of todosNombres) {
      if (!nom) continue
      stats.oc        += db.prepare('UPDATE ordenes_compra SET proveedor_nombre=? WHERE lower(trim(proveedor_nombre))=lower(?)').run(nombre_canon, nom).changes
      stats.form49    += db.prepare('UPDATE form49_ingresos SET proveedor_nombre=? WHERE lower(trim(proveedor_nombre))=lower(?)').run(nombre_canon, nom).changes
      stats.facturas  += db.prepare('UPDATE facturas_compra SET proveedor_nombre=? WHERE lower(trim(proveedor_nombre))=lower(?)').run(nombre_canon, nom).changes
      stats.productos  += db.prepare('UPDATE productos SET proveedor=? WHERE lower(trim(proveedor))=lower(?)').run(nombre_canon, nom).changes
      stats.movimientos += db.prepare('UPDATE movimientos_stock SET proveedor=? WHERE lower(trim(proveedor))=lower(?)').run(nombre_canon, nom).changes
      stats.mant       += db.prepare('UPDATE mant_intervenciones_correctivas SET proveedor=? WHERE lower(trim(proveedor))=lower(?)').run(nombre_canon, nom).changes
      stats.ing_pend   += db.prepare('UPDATE ingresos_pendientes SET proveedor_nombre=? WHERE lower(trim(proveedor_nombre))=lower(?)').run(nombre_canon, nom).changes
      try { db.prepare('UPDATE ingresos_sin_oc_pendientes SET proveedor_nombre=? WHERE lower(trim(proveedor_nombre))=lower(?)').run(nombre_canon, nom) } catch (_) {}
    }

    // 4. Actualizar también campos de texto del maestro por su nombre anterior
    // (por si el nombre_canon cambió respecto al master_id original)
    const anteriorMaestro = db.prepare('SELECT nombre FROM proveedores WHERE id=?').get(master_id)
    if (anteriorMaestro && anteriorMaestro.nombre !== nombre_canon) {
      const viejoNombre = anteriorMaestro.nombre
      db.prepare('UPDATE ordenes_compra SET proveedor_nombre=? WHERE lower(trim(proveedor_nombre))=lower(?)').run(nombre_canon, viejoNombre)
      db.prepare('UPDATE form49_ingresos SET proveedor_nombre=? WHERE lower(trim(proveedor_nombre))=lower(?)').run(nombre_canon, viejoNombre)
      db.prepare('UPDATE facturas_compra SET proveedor_nombre=? WHERE lower(trim(proveedor_nombre))=lower(?)').run(nombre_canon, viejoNombre)
      db.prepare('UPDATE productos SET proveedor=? WHERE lower(trim(proveedor))=lower(?)').run(nombre_canon, viejoNombre)
      db.prepare('UPDATE movimientos_stock SET proveedor=? WHERE lower(trim(proveedor))=lower(?)').run(nombre_canon, viejoNombre)
    }
  })()

  res.json({ ok: true, master_id, stats })
})

router.put('/proveedores/:id', verificarToken, (req, res) => {
  if (!puedeEscribirAdmin(req)) return res.status(403).json({ error: 'Sin permisos' });
  const p = db.prepare('SELECT * FROM proveedores WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  const { nombre, cuit, contacto, telefono, email, direccion, localidad, cp, vendedor, condicion_pago, critico,
          categoria_provision, fecha_seleccion, frecuencia_evaluacion, responsable_seleccion, responsable_evaluacion } = req.body;
  db.prepare('UPDATE proveedores SET nombre=?,cuit=?,contacto=?,telefono=?,email=?,direccion=?,localidad=?,cp=?,vendedor=?,condicion_pago=?,critico=?,categoria_provision=?,fecha_seleccion=?,frecuencia_evaluacion=?,responsable_seleccion=?,responsable_evaluacion=? WHERE id=?')
    .run(nombre??p.nombre, cuit!=null ? formatCuit(cuit) : p.cuit, contacto??p.contacto, telefono??p.telefono,
         email??p.email, direccion??p.direccion, localidad??p.localidad, cp??p.cp,
         vendedor??p.vendedor, condicion_pago??p.condicion_pago, critico!=null?critico:p.critico,
         categoria_provision??p.categoria_provision??'', fecha_seleccion??p.fecha_seleccion??'',
         frecuencia_evaluacion??p.frecuencia_evaluacion??'Anual',
         responsable_seleccion??p.responsable_seleccion??'', responsable_evaluacion??p.responsable_evaluacion??'',
         req.params.id);
  res.json(db.prepare('SELECT * FROM proveedores WHERE id=?').get(req.params.id));
});

// ── POST: limpiar inactivos huérfanos (sin datos asociados) ──────────────────
router.post('/proveedores/fusiones/limpiar-inactivos', verificarToken, (req, res) => {
  if (!puedeFusion(req)) return res.status(403).json({ error: 'Sin permisos' });

  const inactivos = db.prepare('SELECT id, nombre, cuit FROM proveedores WHERE activo=0').all()
  let eliminados = 0
  const noEliminados = []

  db.transaction(() => {
    for (const p of inactivos) {
      const tieneOC   = db.prepare('SELECT 1 FROM ordenes_compra WHERE proveedor_id=? LIMIT 1').get(p.id)
      const tieneF49  = db.prepare('SELECT 1 FROM form49_ingresos WHERE proveedor_id=? LIMIT 1').get(p.id)
      const tieneFact = db.prepare('SELECT 1 FROM facturas_compra WHERE proveedor_id=? LIMIT 1').get(p.id)
      const tieneEval = db.prepare('SELECT 1 FROM evaluaciones_proveedor WHERE proveedor_id=? LIMIT 1').get(p.id)
      const tieneDatos = tieneOC || tieneF49 || tieneFact || tieneEval

      if (!tieneDatos) {
        db.prepare('DELETE FROM proveedores WHERE id=?').run(p.id)
        eliminados++
        continue
      }

      // Tiene datos: buscar contraparte activa por CUIT
      let activo = null
      if (p.cuit && p.cuit.trim()) {
        activo = db.prepare('SELECT id, nombre FROM proveedores WHERE activo=1 AND cuit=? AND id!=? LIMIT 1').get(p.cuit.trim(), p.id)
      }

      if (!activo) {
        noEliminados.push(p.nombre)
        continue
      }

      // Reasignar todos los FK al activo
      db.prepare('UPDATE ordenes_compra SET proveedor_id=?, proveedor_nombre=? WHERE proveedor_id=?').run(activo.id, activo.nombre, p.id)
      db.prepare('UPDATE form49_ingresos SET proveedor_id=?, proveedor_nombre=? WHERE proveedor_id=?').run(activo.id, activo.nombre, p.id)
      db.prepare('UPDATE facturas_compra SET proveedor_id=?, proveedor_nombre=? WHERE proveedor_id=?').run(activo.id, activo.nombre, p.id)
      db.prepare('UPDATE evaluaciones_proveedor SET proveedor_id=? WHERE proveedor_id=?').run(activo.id, p.id)
      // Reasignar también los nombres en texto libre que aún apunten al nombre inactivo
      db.prepare('UPDATE ordenes_compra SET proveedor_nombre=? WHERE lower(trim(proveedor_nombre))=lower(?)').run(activo.nombre, p.nombre.trim())
      db.prepare('UPDATE form49_ingresos SET proveedor_nombre=? WHERE lower(trim(proveedor_nombre))=lower(?)').run(activo.nombre, p.nombre.trim())
      db.prepare('UPDATE facturas_compra SET proveedor_nombre=? WHERE lower(trim(proveedor_nombre))=lower(?)').run(activo.nombre, p.nombre.trim())
      db.prepare('UPDATE productos SET proveedor=? WHERE lower(trim(proveedor))=lower(?)').run(activo.nombre, p.nombre.trim())
      db.prepare('UPDATE movimientos_stock SET proveedor=? WHERE lower(trim(proveedor))=lower(?)').run(activo.nombre, p.nombre.trim())
      db.prepare('UPDATE mant_intervenciones_correctivas SET proveedor=? WHERE lower(trim(proveedor))=lower(?)').run(activo.nombre, p.nombre.trim())
      try { db.prepare('UPDATE ingresos_pendientes SET proveedor_nombre=? WHERE lower(trim(proveedor_nombre))=lower(?)').run(activo.nombre, p.nombre.trim()) } catch (_) {}
      try { db.prepare('UPDATE ingresos_sin_oc_pendientes SET proveedor_nombre=? WHERE lower(trim(proveedor_nombre))=lower(?)').run(activo.nombre, p.nombre.trim()) } catch (_) {}

      db.prepare('DELETE FROM proveedores WHERE id=?').run(p.id)
      eliminados++
    }
  })()

  res.json({ eliminados, noEliminados })
})

router.delete('/proveedores/:id', verificarToken, (req, res) => {
  if (!puedeEscribirAdmin(req)) return res.status(403).json({ error: 'Sin permisos' });
  const p = db.prepare('SELECT * FROM proveedores WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  const nuevoActivo = p.activo ? 0 : 1;
  db.prepare('UPDATE proveedores SET activo=? WHERE id=?').run(nuevoActivo, req.params.id);
  res.json({ ok: true, activo: nuevoActivo });
});

// Borrado definitivo — solo si no tiene datos asociados
router.delete('/proveedores/:id/borrar', verificarToken, (req, res) => {
  if (!puedeEscribirAdmin(req)) return res.status(403).json({ error: 'Sin permisos' });
  const p = db.prepare('SELECT * FROM proveedores WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });

  const tieneOC   = db.prepare('SELECT 1 FROM ordenes_compra WHERE proveedor_id=? LIMIT 1').get(p.id)
  const tieneF49  = db.prepare('SELECT 1 FROM form49_ingresos WHERE proveedor_id=? LIMIT 1').get(p.id)
  const tieneFact = db.prepare('SELECT 1 FROM facturas_compra WHERE proveedor_id=? LIMIT 1').get(p.id)
  const tieneEval = db.prepare('SELECT 1 FROM evaluaciones_proveedor WHERE proveedor_id=? LIMIT 1').get(p.id)

  if (tieneOC || tieneF49 || tieneFact || tieneEval) {
    return res.status(409).json({ error: 'El proveedor tiene documentos asociados (OC, facturas o evaluaciones). Usá Fusión de proveedores para reasignarlos antes de eliminar.' })
  }

  db.prepare('DELETE FROM proveedores WHERE id=?').run(p.id)
  res.json({ ok: true })
});

// ── Órdenes de Compra ─────────────────────────────────────────────────────────

function nextNumeroOC() {
  const r = db.prepare("SELECT numero FROM ordenes_compra ORDER BY CAST(numero AS INTEGER) DESC LIMIT 1").get();
  if (r) { try { return String(parseInt(r.numero)+1).padStart(6,'0'); } catch(_) {} }
  return '000001';
}

router.get('/oc', verificarToken, leerOCListado, (req, res) => {
  const { estado, proveedor_id, desde, hasta, buscar, excluirFacturadas, sinFactura, page=1, limit=50 } = req.query;
  const conds=[], params=[];
  if (estado)       { conds.push('o.estado=?');          params.push(estado); }
  if (proveedor_id) { conds.push('o.proveedor_id=?');    params.push(proveedor_id); }
  if (desde)        { conds.push('o.fecha>=?');           params.push(desde); }
  if (hasta)        { conds.push('o.fecha<=?');           params.push(hasta); }
  if (buscar)       { const b = buscarCondicion(buscar, ['o.numero','o.proveedor_nombre']); conds.push(b.cond); params.push(...b.params); }
  // "OC sin factura" es un listado de seguimiento para reclamar/vincular — las OC
  // de antes del 01/07/2026 son datos importados de planillas viejas que nunca
  // van a completarse con una factura real (ver CLAUDE.md, "Datos confiables").
  if (sinFactura)   { conds.push(`${sqlFechaIso('o.fecha')} >= '2026-07-01'`); }
  const where  = conds.length ? 'WHERE '+conds.join(' AND ') : '';
  const offset = (parseInt(page)-1)*parseInt(limit);
  // El "ciclo" de una OC está completo cuando ya se facturó (neto_gravado) al
  // menos lo mismo que su neto original (oc_items) — a esas no tiene sentido
  // ofrecerlas para elegir en una factura nueva. Tolerancia de $1 por redondeos.
  //
  // Ambos lados hay que compararlos en la MISMA moneda (pesos): el neto de
  // oc_items está en la moneda propia de la OC (o.moneda/o.tasa_cambio), y
  // cada factura puede haberse cargado en pesos o en la moneda original del
  // comprobante (su propia moneda/tasa_cambio) — sin esta conversión, una OC
  // en USD con facturas ya cargadas en pesos comparaba montos de unidades
  // distintas y la OC desaparecía del selector aunque le quedara saldo.
  //
  // Muchas OC viejas quedaron con tasa_cambio=0 (se cargaban sin TC antes de
  // resolverlo automáticamente al crearlas) — para esas, en vez de mostrar la
  // OC como si no tuviera forma de convertirse, se busca el tipo_cambio del
  // sistema más cercano (a la fecha de la OC), como último recurso: la tasa
  // propia de la OC ya es la que se usó para facturarla, y no debe pisarse con
  // una entrada de tipo_cambio posterior que ni siquiera existía cuando se
  // cargó la OC. Mismo orden de prioridad que Control OC y Seguimiento OC
  // Compras — antes eran opuestos y una misma OC podía mostrar dos totales
  // distintos según la pantalla.
  const tcDia = `(
    SELECT tc.valor FROM tipo_cambio tc
    WHERE tc.moneda = o.moneda AND tc.fecha <= o.fecha AND tc.fecha != ''
    ORDER BY tc.fecha DESC, tc.id DESC LIMIT 1
  )`;
  const tcResuelto = `COALESCE(o.tc_control_manual, NULLIF(o.tasa_cambio,0), ${tcDia})`;
  const havingPartes = [];
  if (excluirFacturadas) {
    havingPartes.push(`(
         (CASE WHEN o.moneda IN ('PESO','PESOS') OR o.moneda IS NULL OR o.moneda=''
               THEN COALESCE(SUM(i.cantidad*i.precio_final),0)
               ELSE COALESCE(SUM(i.cantidad*i.precio_final),0) * COALESCE(${tcResuelto}, 1) END)
         - COALESCE(MAX(fc.facturado_pesos),0)
       ) > 1`);
  }
  // Para "OC recibidas sin factura" (Administración: a quién reclamarle o
  // vincular una factura que ya está cargada) — ninguna fila en facturas_compra
  // apunta todavía a esta OC (fc.facturado_pesos queda NULL tras el LEFT JOIN).
  if (sinFactura) havingPartes.push('MAX(fc.facturado_pesos) IS NULL');
  const having = havingPartes.length ? `HAVING ${havingPartes.join(' AND ')}` : '';
  const fromJoins = `
    FROM ordenes_compra o
    LEFT JOIN oc_items i ON o.id=i.oc_id
    LEFT JOIN (
      SELECT oc_id,
        SUM(CASE WHEN moneda IN ('PESO','PESOS') OR moneda IS NULL OR moneda=''
                 THEN neto_gravado
                 ELSE neto_gravado * COALESCE(NULLIF(tasa_cambio,0), 1) END) AS facturado_pesos
      FROM facturas_compra WHERE oc_id IS NOT NULL GROUP BY oc_id
    ) fc ON fc.oc_id = o.id
  `;
  const total  = db.prepare(`
    SELECT COUNT(*) as c FROM (
      SELECT o.id ${fromJoins} ${where} GROUP BY o.id ${having}
    )
  `).get(...params).c;
  const datos  = db.prepare(`
    SELECT o.*, COUNT(CASE WHEN i.descripcion!='' THEN 1 END) as n_items,
           SUM(i.cantidad * i.precio_final) as total_usd,
           ${tcResuelto} AS tc_resuelto
    ${fromJoins}
    ${where} GROUP BY o.id ${having} ORDER BY o.id DESC LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);
  res.json({ total, pagina: parseInt(page), datos });
});

router.get('/ultimo-precio', verificarToken, leerCompras, (req, res) => {
  const { producto_id, descripcion, proveedor_id } = req.query;
  if (!producto_id && !descripcion) return res.json(null);

  const provCond  = proveedor_id ? 'AND o.proveedor_id = ?' : '';
  const provParam = proveedor_id ? [proveedor_id] : [];

  // Keywords: palabras > 2 chars, no numeros, no unidades comunes
  const SKIP = new Set(['und', 'und.', 'por', 'con', 'para', 'los', 'las', 'del']);
  const keywords = (descripcion || '')
    .trim().split(/\s+/)
    .filter(w => w.length > 2 && !/^\d/.test(w) && !SKIP.has(w.toLowerCase()))
    .slice(0, 4);

  const kwConds  = keywords.map(() => 'LOWER(i.descripcion) LIKE ?');
  const kwParams = keywords.map(w => `%${w.toLowerCase()}%`);
  const descCond = kwConds.length ? `OR (${kwConds.join(' AND ')})` : '';

  const row = db.prepare(`
    SELECT i.precio_unitario, i.bonif1, i.bonif2, i.bonif3, i.bonif4, i.precio_final,
           o.fecha, o.numero, o.proveedor_nombre,
           CASE WHEN i.producto_id = ? THEN 1 ELSE 2 END AS _prio
    FROM oc_items i
    JOIN ordenes_compra o ON o.id = i.oc_id
    WHERE o.estado != 'Cancelada'
      AND i.precio_final > 0
      AND (i.producto_id = ? ${descCond})
      ${provCond}
    ORDER BY _prio ASC, o.fecha DESC, o.id DESC
    LIMIT 1
  `).get(producto_id || 0, producto_id || 0, ...kwParams, ...provParam);

  res.json(row ? {
    precio_unitario:  row.precio_unitario,
    bonif1: row.bonif1, bonif2: row.bonif2, bonif3: row.bonif3, bonif4: row.bonif4,
    precio_final:     row.precio_final,
    fecha:            row.fecha,
    numero:           row.numero,
    proveedor_nombre: row.proveedor_nombre,
  } : null);
});

router.get('/oc/:id', verificarToken, leerOCListado, (req, res) => {
  const oc = db.prepare('SELECT * FROM ordenes_compra WHERE id=?').get(req.params.id);
  if (!oc) return res.status(404).json({ error: 'OC no encontrada' });
  const items = db.prepare(`
    SELECT i.*, p.codigo as producto_codigo
    FROM oc_items i LEFT JOIN productos p ON p.id = i.producto_id
    WHERE i.oc_id=? ORDER BY i.item_num
  `).all(oc.id);
  const facturas = db.prepare(`
    SELECT id, tipo_factura, numero, fecha, neto_gravado, importe, moneda, pago_confirmado
    FROM facturas_compra WHERE oc_id=? ORDER BY fecha DESC, id DESC
  `).all(oc.id);
  const cuotas = cargarCuotasCompra([oc.id])[oc.id] || [];
  res.json({ ...oc, items, facturas, cuotas });
});

// Items sin codificar — para revisión del admin
router.get('/oc/items-sin-codificar', verificarToken, leerComprasOCodif, (req, res) => {
  const rows = db.prepare(`
    SELECT i.id, i.oc_id, i.item_num, i.descripcion, i.unidad, i.cantidad, i.precio_final,
           o.numero as oc_numero, o.fecha as oc_fecha, o.proveedor_nombre, o.moneda
    FROM oc_items i
    JOIN ordenes_compra o ON o.id = i.oc_id
    WHERE i.sin_codificar = 1
    ORDER BY o.fecha DESC, o.id DESC, i.item_num
  `).all()
  res.json(rows)
});

router.patch('/oc/items/:itemId/codificar', verificarToken, (req, res) => {
  if (req.usuario?.rol !== 'admin') return res.status(403).json({ error: 'Solo admin' });
  const { producto_id } = req.body;
  if (!producto_id) return res.status(400).json({ error: 'Falta producto_id' });
  const prod = db.prepare('SELECT id, codigo, descripcion, unidad FROM productos WHERE id=?').get(producto_id);
  if (!prod) return res.status(404).json({ error: 'Producto no encontrado' });
  db.prepare('UPDATE oc_items SET producto_id=?, sin_codificar=0 WHERE id=?')
    .run(producto_id, req.params.itemId);
  res.json({ ok: true, codigo: prod.codigo });
});

// Si al crear una OC en moneda extranjera no se cargó tasa_cambio a mano,
function actualizarCatalogoDesdeOC(items, moneda, fecha, proveedor_id, proveedor_nombre) {
  for (const it of (items || [])) {
    const precio = parseFloat(it.precio_final) || 0;
    if (it.producto_id && precio > 0) {
      db.prepare('UPDATE productos SET precio_costo=?, precio_moneda=?, precio_fecha=?, proveedor=COALESCE(NULLIF(?,\'\'), proveedor) WHERE id=?')
        .run(precio, moneda || 'DÓLAR', fecha || '', proveedor_nombre || '', it.producto_id);
    }
  }
  if (proveedor_id) {
    const conBonif = (items || []).find(it => it.bonif1 > 0 || it.bonif2 > 0 || it.bonif3 > 0 || it.bonif4 > 0);
    if (conBonif) {
      db.prepare('UPDATE proveedores SET bonif1=?, bonif2=?, bonif3=?, bonif4=? WHERE id=?')
        .run(conBonif.bonif1||0, conBonif.bonif2||0, conBonif.bonif3||0, conBonif.bonif4||0, proveedor_id);
    }
  }
}

function cargarCuotasCompra(ocIds) {
  if (!ocIds.length) return {};
  const placeholders = ocIds.map(() => '?').join(',');
  const filas = db.prepare(`
    SELECT c.*, fc.numero AS factura_numero, fc.fecha AS factura_fecha,
           fc.neto_gravado AS factura_neto, fc.importe AS factura_importe,
           fc.moneda AS factura_moneda, fc.pago_confirmado AS factura_pago_confirmado
    FROM oc_compra_cuotas c
    LEFT JOIN facturas_compra fc ON fc.id = c.factura_id
    WHERE c.oc_id IN (${placeholders})
    ORDER BY c.oc_id, c.orden
  `).all(...ocIds);
  const porOC = {};
  for (const f of filas) (porOC[f.oc_id] ??= []).push(f);
  return porOC;
}

// Una misma factura puede repartirse en varias cuotas de ESTA OC (ej: un solo
// comprobante que cubre anticipo + saldo) — lo que no puede pasar es que quede
// vinculada a cuotas de OTRA OC, eso sí sería un error de carga.
function guardarCuotasCompra(ocId, cuotas) {
  validarPctCuotas(cuotas);
  const facturasUsadas = [...new Set((cuotas || []).map(c => c.factura_id).filter(Boolean))];
  if (facturasUsadas.length) {
    const placeholders = facturasUsadas.map(() => '?').join(',');
    const conflictoCuota = db.prepare(`
      SELECT 1 FROM oc_compra_cuotas WHERE factura_id IN (${placeholders}) AND oc_id != ? LIMIT 1
    `).get(...facturasUsadas, ocId);
    if (conflictoCuota) { const err = new Error('Factura ya vinculada a otra OC'); err.codigo = 'FACTURA_EN_USO'; throw err; }
    // La factura también puede estar vinculada por afuera de las cuotas (vía el
    // botón "Vincular factura" clásico, que solo setea facturas_compra.oc_id) —
    // ese caso no lo agarra el chequeo de arriba, hay que mirar oc_id también.
    const conflictoOcId = db.prepare(`
      SELECT 1 FROM facturas_compra WHERE id IN (${placeholders}) AND oc_id IS NOT NULL AND oc_id != ? LIMIT 1
    `).get(...facturasUsadas, ocId);
    if (conflictoOcId) { const err = new Error('Factura ya vinculada a otra OC'); err.codigo = 'FACTURA_EN_USO'; throw err; }
  }
  db.prepare('DELETE FROM oc_compra_cuotas WHERE oc_id=?').run(ocId);
  const ins = db.prepare(`
    INSERT INTO oc_compra_cuotas (oc_id, orden, tipo, pct, monto_planeado, fecha_estimada, factura_id)
    VALUES (?,?,?,?,?,?,?)
  `);
  // "" (campo vacío, lo más común — casi nunca se completa "Monto planeado" a
  // mano) NO es lo mismo que null para `??`, y guardar el string vacío tal
  // cual rompía la comparación NULLIF(monto_planeado, 0) de Control OC (un
  // texto vacío nunca es igual a 0 en SQLite, así que nunca caía al cálculo
  // por %). Acá se normaliza a un número real o null antes de guardar.
  const numOrNull = v => (v === '' || v == null) ? null : parseFloat(v);
  (cuotas || []).forEach((c, i) => {
    ins.run(ocId, i + 1, c.tipo || 'avance', numOrNull(c.pct), numOrNull(c.monto_planeado), c.fecha_estimada || '', c.factura_id || null);
  });
  // Si una cuota vino con factura_id, esa factura queda vinculada a la OC
  // igual que con el botón "Vincular factura" — para que Control OC (que
  // agrupa por facturas_compra.oc_id) la vea sin necesidad de hacerlo dos veces.
  if (facturasUsadas.length) {
    const oc = db.prepare('SELECT numero FROM ordenes_compra WHERE id=?').get(ocId);
    const placeholders = facturasUsadas.map(() => '?').join(',');
    db.prepare(`UPDATE facturas_compra SET oc_id=?, oc_numero=? WHERE id IN (${placeholders})`)
      .run(ocId, oc?.numero || '', ...facturasUsadas);
  }
}

router.post('/oc', verificarToken, body('proveedor_nombre').trim().notEmpty(), (req, res) => {
  if (!req.permisos?.compras?.escribir) return res.status(403).json({ error: 'Sin permisos' });
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() });

  const { proveedor_id, proveedor_nombre, proveedor_cuit, fecha, moneda, tasa_cambio,
          autorizado_por, elaborado_por, condicion_pago, lugar_entrega, presupuesto_n,
          observaciones, fecha_entrega_est, estado_doc, modo_plazo, dias_plazo, items, cuotas } = req.body;

  const errItems = validarItemsOC(items);
  if (errItems) return res.status(400).json({ error: errItems });

  const numero = nextNumeroOC();
  const fechaOC = fecha||hoyArgentina();
  const modoPlazoOC = modo_plazo === 'ITEM' ? 'ITEM' : 'OC';
  const fechaEntregaCalc = calcularFechaEntregaOC(fechaOC, modoPlazoOC, dias_plazo, items, fecha_entrega_est);
  const tasaCambioOC = tasa_cambio ? parseFloat(tasa_cambio) : tasaCambioSistema(moneda||'DÓLAR', fechaOC);
  const trx = db.transaction(() => {
    const r = db.prepare(`INSERT INTO ordenes_compra (numero,fecha,proveedor_id,proveedor_nombre,proveedor_cuit,moneda,tasa_cambio,autorizado_por,elaborado_por,condicion_pago,lugar_entrega,presupuesto_n,observaciones,fecha_entrega_est,estado_doc,modo_plazo,dias_plazo,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(numero, fechaOC, proveedor_id||null, proveedor_nombre,
           formatCuit(proveedor_cuit), moneda||'DÓLAR', tasaCambioOC, autorizado_por||'', elaborado_por||'',
           condicion_pago||'TRANSF. BANCARIA', lugar_entrega||'e-intra', presupuesto_n||'', observaciones||'',
           fechaEntregaCalc, estado_doc||'', modoPlazoOC, dias_plazo!=null && dias_plazo!=='' ? parseInt(dias_plazo,10) : null, req.usuario.id);
    const oc_id = r.lastInsertRowid;
    if (items?.length) {
      for (const [i, it] of items.entries()) {
        db.prepare('INSERT INTO oc_items (oc_id,item_num,producto_id,cantidad,unidad,descripcion,precio_unitario,bonif1,bonif2,bonif3,bonif4,precio_final,plazo,dias_plazo,sin_codificar) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(oc_id, i+1, it.producto_id||null, it.cantidad||0, it.unidad||'UND.', it.descripcion||'',
               it.precio_unitario||0, it.bonif1||0, it.bonif2||0, it.bonif3||0, it.bonif4||0, it.precio_final||0, it.plazo||'INMEDIATO',
               it.dias_plazo!=null && it.dias_plazo!=='' ? parseInt(it.dias_plazo,10) : null, it.sin_codificar ? 1 : 0);
      }
    }
    if (cuotas?.length) guardarCuotasCompra(oc_id, cuotas);
    return oc_id;
  });
  let oc_id;
  try { oc_id = trx(); }
  catch (e) {
    if (e.codigo === 'FACTURA_EN_USO') return res.status(409).json({ error: 'Una de las facturas ya está vinculada a otra OC' });
    if (e.codigo === 'CUOTAS_PCT_INVALIDO') return res.status(400).json({ error: e.message });
    throw e;
  }
  actualizarCatalogoDesdeOC(items, moneda, fecha, proveedor_id, proveedor_nombre);
  const oc = db.prepare('SELECT * FROM ordenes_compra WHERE id=?').get(oc_id);
  res.status(201).json({
    ...oc,
    items: db.prepare('SELECT * FROM oc_items WHERE oc_id=? ORDER BY item_num').all(oc_id),
    cuotas: cargarCuotasCompra([oc_id])[oc_id] || [],
  });
});

router.put('/oc/:id', verificarToken, (req, res) => {
  if (!req.permisos?.compras?.escribir) return res.status(403).json({ error: 'Sin permisos' });
  const oc = db.prepare('SELECT * FROM ordenes_compra WHERE id=?').get(req.params.id);
  if (!oc) return res.status(404).json({ error: 'OC no encontrada' });

  const { proveedor_id, proveedor_nombre, proveedor_cuit, fecha, moneda, tasa_cambio,
          autorizado_por, elaborado_por, condicion_pago, lugar_entrega, presupuesto_n,
          observaciones, estado, fecha_entrega_est, numero_remito, fecha_recepcion,
          estado_doc, nro_factura, importe_facturado, fecha_vencimiento, pago_confirmado,
          modo_plazo, dias_plazo, items, cuotas } = req.body;

  const errItems = validarItemsOC(items);
  if (errItems) return res.status(400).json({ error: errItems });

  const fechaOC = fecha??oc.fecha;
  const modoPlazoOC = (modo_plazo ?? oc.modo_plazo) === 'ITEM' ? 'ITEM' : 'OC';
  const diasPlazoOC = dias_plazo !== undefined ? dias_plazo : oc.dias_plazo;
  const itemsParaCalculo = items ?? db.prepare('SELECT * FROM oc_items WHERE oc_id=?').all(req.params.id);
  const fechaEntregaCalc = calcularFechaEntregaOC(fechaOC, modoPlazoOC, diasPlazoOC, itemsParaCalculo, fecha_entrega_est??oc.fecha_entrega_est??'');

  const trx = db.transaction(() => {
    db.prepare(`UPDATE ordenes_compra SET proveedor_id=?,proveedor_nombre=?,proveedor_cuit=?,fecha=?,moneda=?,tasa_cambio=?,autorizado_por=?,elaborado_por=?,condicion_pago=?,lugar_entrega=?,presupuesto_n=?,observaciones=?,estado=?,fecha_entrega_est=?,numero_remito=?,fecha_recepcion=?,estado_doc=?,nro_factura=?,importe_facturado=?,fecha_vencimiento=?,pago_confirmado=?,modo_plazo=?,dias_plazo=?,updated_at=datetime('now','localtime') WHERE id=?`)
      .run(proveedor_id??oc.proveedor_id, proveedor_nombre??oc.proveedor_nombre, proveedor_cuit!=null ? formatCuit(proveedor_cuit) : oc.proveedor_cuit,
           fechaOC, moneda??oc.moneda, tasa_cambio??oc.tasa_cambio, autorizado_por??oc.autorizado_por,
           elaborado_por??oc.elaborado_por, condicion_pago??oc.condicion_pago, lugar_entrega??oc.lugar_entrega,
           presupuesto_n??oc.presupuesto_n, observaciones??oc.observaciones, estado??oc.estado,
           fechaEntregaCalc, numero_remito??oc.numero_remito??'',
           fecha_recepcion??oc.fecha_recepcion??'', estado_doc??oc.estado_doc??'',
           nro_factura??oc.nro_factura??'', importe_facturado??oc.importe_facturado??0,
           fecha_vencimiento??oc.fecha_vencimiento??'', pago_confirmado!=null?pago_confirmado:(oc.pago_confirmado??0),
           modoPlazoOC, diasPlazoOC!=null && diasPlazoOC!=='' ? parseInt(diasPlazoOC,10) : null,
           req.params.id);
    if (items) {
      db.prepare('DELETE FROM oc_items WHERE oc_id=?').run(req.params.id);
      for (const [i, it] of items.entries()) {
        db.prepare('INSERT INTO oc_items (oc_id,item_num,producto_id,cantidad,unidad,descripcion,precio_unitario,bonif1,bonif2,bonif3,bonif4,precio_final,plazo,dias_plazo,cant_recibida,sin_codificar) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(req.params.id, i+1, it.producto_id||null, it.cantidad||0, it.unidad||'UND.', it.descripcion||'',
               it.precio_unitario||0, it.bonif1||0, it.bonif2||0, it.bonif3||0, it.bonif4||0, it.precio_final||0, it.plazo||'INMEDIATO',
               it.dias_plazo!=null && it.dias_plazo!=='' ? parseInt(it.dias_plazo,10) : null, it.cant_recibida||0, it.sin_codificar ? 1 : 0);
      }
    }
    if (cuotas !== undefined) guardarCuotasCompra(req.params.id, cuotas);
  });
  try { trx(); }
  catch (e) {
    if (e.codigo === 'FACTURA_EN_USO') return res.status(409).json({ error: 'Una de las facturas ya está vinculada a otra OC' });
    if (e.codigo === 'CUOTAS_PCT_INVALIDO') return res.status(400).json({ error: e.message });
    throw e;
  }
  const updated = db.prepare('SELECT * FROM ordenes_compra WHERE id=?').get(req.params.id);
  res.json({
    ...updated,
    items: db.prepare('SELECT * FROM oc_items WHERE oc_id=? ORDER BY item_num').all(req.params.id),
    cuotas: cargarCuotasCompra([Number(req.params.id)])[req.params.id] || [],
  });
});

// Recibir OC → crea ingresos pendientes (stock se confirma desde el módulo Stock)
router.post('/oc/:id/recibir', verificarToken, (req, res) => {
  if (!(req.permisos?.compras?.escribir || req.permisos?.stock?.escribir))
    return res.status(403).json({ error: 'Sin permisos' });

  const oc    = db.prepare('SELECT * FROM ordenes_compra WHERE id=?').get(req.params.id);
  if (!oc) return res.status(404).json({ error: 'OC no encontrada' });
  if (oc.estado === 'Cancelada') return res.status(400).json({ error: 'OC cancelada' });

  const { recepciones, fecha, numero_remito, producto_ids } = req.body;
  const fechaRec = fecha || hoyArgentina();

  const insIngreso = db.prepare(`
    INSERT INTO ingresos_pendientes
      (oc_id,oc_numero,proveedor_nombre,oc_item_id,producto_id,producto_codigo,producto_desc,unidad,cantidad,precio_costo,numero_remito,fecha_recepcion)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  const trx = db.transaction(() => {
    // Persiste asignaciones de producto hechas inline en el frontend
    if (producto_ids && typeof producto_ids === 'object') {
      const updProd = db.prepare('UPDATE oc_items SET producto_id=? WHERE id=? AND oc_id=?');
      for (const [itemId, productId] of Object.entries(producto_ids)) {
        updProd.run(productId, Number(itemId), oc.id);
      }
    }
    // Se consideran TODOS los items (no solo los que ya tienen producto asignado):
    // uno sin producto_id, o dejado explícitamente en 0 para recibir después, sigue pendiente
    // y no debe dejar que la OC se marque como "Recibida" por completo.
    const items = db.prepare('SELECT * FROM oc_items WHERE oc_id=?').all(oc.id);
    let todosRecibidos = true;
    const itemsRecibidos = [];
    for (const item of items) {
      const pendiente = item.cantidad - item.cant_recibida;
      if (pendiente <= 0) continue; // ya estaba completo, no afecta el estado

      if (item.producto_id == null) {
        todosRecibidos = false; // sin producto asignado, no se puede ingresar a stock todavía
        continue;
      }
      const cantRecibir = recepciones?.[item.id] ?? pendiente;
      if (cantRecibir <= 0) { todosRecibidos = false; continue; }
      const real = Math.min(cantRecibir, pendiente);
      db.prepare("UPDATE oc_items SET cant_recibida=cant_recibida+? WHERE id=?").run(real, item.id);
      const prod = db.prepare('SELECT codigo, descripcion, unidad FROM productos WHERE id=?').get(item.producto_id);
      insIngreso.run(oc.id, oc.numero, oc.proveedor_nombre, item.id, item.producto_id,
        prod?.codigo||'', prod?.descripcion||item.descripcion||'', prod?.unidad||item.unidad||'UND.',
        real, item.precio_final||0, numero_remito||'', fechaRec);
      itemsRecibidos.push(item);
      if (real < pendiente) todosRecibidos = false;
    }
    // Igual que al crear la OC: el precio de costo del material en stock se
    // actualiza con lo pagado en la OC — antes solo pasaba al crearla, así que
    // un item codificado recién al recibir (o editado después) nunca actualizaba
    // el precio en el catálogo.
    actualizarCatalogoDesdeOC(itemsRecibidos, oc.moneda, fechaRec, oc.proveedor_id, oc.proveedor_nombre);
    const nuevoEstado = todosRecibidos ? 'Recibida' : 'Parcial';
    const itemsActualizados = db.prepare('SELECT * FROM oc_items WHERE oc_id=?').all(oc.id);
    const fechaEntregaCalc = calcularFechaEntregaOC(oc.fecha, oc.modo_plazo, oc.dias_plazo, itemsActualizados, oc.fecha_entrega_est);
    db.prepare(`UPDATE ordenes_compra SET estado=?,fecha_recepcion=?,fecha_entrega_est=?,${numero_remito ? 'numero_remito=?,' : ''}updated_at=datetime('now','localtime') WHERE id=?`)
      .run(nuevoEstado, fechaRec, fechaEntregaCalc, ...(numero_remito ? [numero_remito] : []), oc.id);
  });
  trx();
  res.json({ mensaje: 'Recepción registrada. Los materiales quedaron pendientes de ingreso al stock.' });
});

// Resetear recepción de OC — vuelve a Emitida, limpia cant_recibida e ingresos_pendientes
router.post('/oc/:id/resetear-recepcion', verificarToken, (req, res) => {
  if (!req.permisos?.compras?.escribir) return res.status(403).json({ error: 'Sin permisos' });
  const oc = db.prepare('SELECT * FROM ordenes_compra WHERE id=?').get(req.params.id);
  if (!oc) return res.status(404).json({ error: 'OC no encontrada' });
  db.transaction(() => {
    db.prepare("UPDATE oc_items SET cant_recibida=0 WHERE oc_id=?").run(oc.id);
    db.prepare("DELETE FROM ingresos_pendientes WHERE oc_id=?").run(oc.id);
    db.prepare("UPDATE ordenes_compra SET estado='Emitida',fecha_recepcion='',numero_remito='',updated_at=datetime('now','localtime') WHERE id=?").run(oc.id);
  })();
  res.json({ ok: true });
});

router.delete('/oc/:id', verificarToken, (req, res) => {
  if (!req.permisos?.compras?.escribir) return res.status(403).json({ error: 'Sin permisos' });
  const oc = db.prepare('SELECT id FROM ordenes_compra WHERE id=?').get(req.params.id);
  if (!oc) return res.status(404).json({ error: 'OC no encontrada' });
  try {
    db.transaction(() => {
      db.prepare('DELETE FROM oc_items WHERE oc_id=?').run(req.params.id);
      db.prepare('DELETE FROM ordenes_compra WHERE id=?').run(req.params.id);
    })();
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      return res.status(409).json({ error: 'No se puede eliminar: la OC ya tiene facturas, ingresos o cuotas de facturación vinculadas.' });
    }
    throw e;
  }
  res.json({ mensaje: 'OC eliminada' });
});

// Facturas de compra SIN OC vinculada — candidatas para asociar a una OC
// desde el propio detalle de la OC (complementa el selector de OC que ya
// existe del lado de la factura).
router.get('/facturas-sin-oc', verificarToken, leerOCListado, (req, res) => {
  const { buscar, proveedor_id } = req.query;
  const conds = ['f.oc_id IS NULL'];
  const params = [];
  if (proveedor_id) { conds.push('f.proveedor_id=?'); params.push(proveedor_id); }
  if (buscar) { const b = buscarCondicion(buscar, ['f.numero', 'f.proveedor_nombre']); conds.push(b.cond); params.push(...b.params); }
  const rows = db.prepare(`
    SELECT f.id, f.tipo_factura, f.numero, f.fecha, f.proveedor_nombre, f.proveedor_id,
           f.neto_gravado, f.importe, f.moneda
    FROM facturas_compra f
    WHERE ${conds.join(' AND ')}
    ORDER BY f.fecha DESC, f.id DESC
    LIMIT 50
  `).all(...params);
  res.json(rows);
});

// Vincula una factura de compra ya cargada (sin OC) a esta OC — para cuando
// la factura se cargó antes de elegir la OC en su propio formulario, o se
// cargó sin ninguna. Para desvincular, se edita la factura y se le quita la
// OC desde su propio formulario (ya soportado).
router.patch('/oc/:id/vincular-factura', verificarToken, (req, res) => {
  // Administración también carga/vincula facturas de compra (mismo criterio
  // que leerOCListado para la lectura) — sin esto, alguien con permiso solo de
  // administracion.escribir no podía usar "OC recibidas sin factura".
  if (!req.permisos?.compras?.escribir && !req.permisos?.administracion?.escribir) return res.status(403).json({ error: 'Sin permisos' });
  const oc = db.prepare('SELECT id, numero FROM ordenes_compra WHERE id=?').get(req.params.id);
  if (!oc) return res.status(404).json({ error: 'OC no encontrada' });
  const { factura_id } = req.body;
  if (!factura_id) return res.status(400).json({ error: 'Falta factura_id' });
  const factura = db.prepare('SELECT id, oc_id FROM facturas_compra WHERE id=?').get(factura_id);
  if (!factura) return res.status(404).json({ error: 'Factura no encontrada' });
  if (factura.oc_id && factura.oc_id !== oc.id) return res.status(409).json({ error: 'Esa factura ya está vinculada a otra OC' });
  db.prepare('UPDATE facturas_compra SET oc_id=?, oc_numero=? WHERE id=?').run(oc.id, oc.numero, factura_id);
  res.json({ ok: true });
});

// Vincula (o desvincula, factura_id=null) una cuota de facturación puntual a
// una factura de compra real — a diferencia del botón de arriba (que vincula
// la factura a la OC entera), esto además vincula la factura a la OC si hace
// falta. Varias cuotas de la MISMA OC pueden compartir la misma factura (un
// solo comprobante que cubre anticipo + saldo); se rechaza si la usa una
// cuota de OTRA OC.
router.patch('/oc/:ocId/cuotas/:cuotaId/vincular-factura', verificarToken, (req, res) => {
  if (!req.permisos?.compras?.escribir) return res.status(403).json({ error: 'Sin permisos' });
  const cuota = db.prepare('SELECT id FROM oc_compra_cuotas WHERE id=? AND oc_id=?').get(req.params.cuotaId, req.params.ocId);
  if (!cuota) return res.status(404).json({ error: 'Cuota no encontrada' });
  const { factura_id } = req.body;
  if (factura_id) {
    const enOtraCuota = db.prepare('SELECT id FROM oc_compra_cuotas WHERE factura_id=? AND oc_id!=?').get(factura_id, req.params.ocId);
    if (enOtraCuota) return res.status(409).json({ error: 'Esa factura ya está vinculada a otra OC' });
    const oc = db.prepare('SELECT id, numero FROM ordenes_compra WHERE id=?').get(req.params.ocId);
    const factura = db.prepare('SELECT id, oc_id FROM facturas_compra WHERE id=?').get(factura_id);
    if (!factura) return res.status(404).json({ error: 'Factura no encontrada' });
    if (factura.oc_id && factura.oc_id !== oc.id) return res.status(409).json({ error: 'Esa factura ya está vinculada a otra OC' });
    db.prepare('UPDATE facturas_compra SET oc_id=?, oc_numero=? WHERE id=?').run(oc.id, oc.numero, factura_id);
  }
  db.prepare('UPDATE oc_compra_cuotas SET factura_id=? WHERE id=?').run(factura_id || null, req.params.cuotaId);
  res.json({ ok: true });
});

// Desvincula una factura de esta OC (botón directo en "Facturas vinculadas" —
// hasta ahora solo se podía sacar editando la factura y eligiendo "PENDIENTE"
// en su propio formulario, una interacción poco clara). También limpia
// cualquier cuota de ESTA OC que la tuviera vinculada, para no dejar una
// cuota apuntando a una factura que ya no forma parte de la OC.
router.patch('/oc/:id/desvincular-factura', verificarToken, (req, res) => {
  if (!req.permisos?.compras?.escribir && !req.permisos?.administracion?.escribir) return res.status(403).json({ error: 'Sin permisos' });
  const { factura_id } = req.body;
  if (!factura_id) return res.status(400).json({ error: 'Falta factura_id' });
  const factura = db.prepare('SELECT id, oc_id FROM facturas_compra WHERE id=?').get(factura_id);
  if (!factura) return res.status(404).json({ error: 'Factura no encontrada' });
  if (String(factura.oc_id) !== String(req.params.id)) return res.status(400).json({ error: 'Esa factura no está vinculada a esta OC' });
  db.prepare("UPDATE facturas_compra SET oc_id=NULL, oc_numero='' WHERE id=?").run(factura_id);
  db.prepare('UPDATE oc_compra_cuotas SET factura_id=NULL WHERE oc_id=? AND factura_id=?').run(req.params.id, factura_id);
  res.json({ ok: true });
});

router.get('/exportar/oc', verificarToken, leerInformesCompras, (req, res) => {
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
router.get('/oc/:id/exportar', verificarToken, leerCompras, (req, res) => {
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
  aoa.push([`CUIT: ${formatCuit(oc.proveedor_cuit||prov?.cuit||'')}`, '', `Localidad: ${prov?.localidad||''}`, '', `Cód. Postal: ${prov?.cp||''}`, '', `Moneda: ${oc.moneda||'DÓLAR'}`]);
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
      const r = insProv.run(p.nombre||'Sin nombre', formatCuit(p.cuit), p.telefono||'', p.email||'',
        p.direccion||'', p.localidad||'', p.cp||'', p.vendedor||'', p.cond_compra||'');
      if (r.changes) provCreados++;
    }
    for (const oc of ordenes_compra) {
      const prov = getProv.get(oc.prov_nombre || '');
      const r = insOC.run(
        oc.numero, oc.fecha?.slice(0,10)||'', prov?.id||null,
        oc.prov_nombre||'', formatCuit(oc.prov_cuit), 'Recibida',
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

// ── Form 49 — Ingreso sin OC/remito ──────────────────────────────────────────

function nextNumeroF49() {
  const r = db.prepare("SELECT numero FROM form49_ingresos ORDER BY id DESC LIMIT 1").get();
  if (r) { try { const n = parseInt(r.numero.replace('F49-','')); return `F49-${String(n+1).padStart(6,'0')}`; } catch(_){} }
  return 'F49-000001';
}

router.get('/form49', verificarToken, leerCompras, (req, res) => {
  const { buscar, desde, hasta, page=1, limit=50 } = req.query;
  const conds=[], params=[];
  if (buscar) { const b = buscarCondicion(buscar, ['f.numero','f.proveedor_nombre','f.proyecto']); conds.push(b.cond); params.push(...b.params); }
  if (desde)  { conds.push('f.fecha>=?'); params.push(desde); }
  if (hasta)  { conds.push('f.fecha<=?'); params.push(hasta); }
  const where  = conds.length ? 'WHERE '+conds.join(' AND ') : '';
  const offset = (parseInt(page)-1)*parseInt(limit);
  const total  = db.prepare(`SELECT COUNT(*) as c FROM form49_ingresos f ${where}`).get(...params).c;
  const datos  = db.prepare(`SELECT f.*, COUNT(i.id) as n_items,
    EXISTS(SELECT 1 FROM ingresos_sin_oc_pendientes p WHERE p.form49_id=f.id) as enviado_stock
    FROM form49_ingresos f LEFT JOIN form49_items i ON f.id=i.form49_id ${where} GROUP BY f.id ORDER BY f.id DESC LIMIT ? OFFSET ?`).all(...params, parseInt(limit), offset);
  res.json({ total, datos });
});

router.get('/form49/stock-por-proveedor', verificarToken, leerCompras, (req, res) => {
  const { proveedor_id, proveedor_nombre } = req.query;
  if (!proveedor_id && !proveedor_nombre?.trim())
    return res.status(400).json({ error: 'Falta proveedor' });
  const conds = [], params = [];
  if (proveedor_id) { conds.push('f.proveedor_id=?'); params.push(proveedor_id); }
  if (proveedor_nombre?.trim()) { conds.push("lower(trim(f.proveedor_nombre)) LIKE lower(?)"); params.push(`%${proveedor_nombre.trim()}%`); }
  const cond = conds.length ? conds.join(' OR ') : '1=1';
  const ingresos = db.prepare(`
    SELECT f.id, f.numero, f.fecha, f.proveedor_id, f.proveedor_nombre, f.proveedor_cuit,
           f.moneda, f.tasa_cambio, f.condicion_pago
    FROM form49_ingresos f
    WHERE ${cond}
    ORDER BY f.fecha DESC, f.id DESC
  `).all(...params);
  const result = [];
  for (const f of ingresos) {
    const items = db.prepare(`
      SELECT id, descripcion, cantidad, unidad, precio_unitario, precio_final, producto_id, producto_codigo, plazo, destino
      FROM form49_items
      WHERE form49_id=?
      ORDER BY id
    `).all(f.id);
    if (items.length) result.push({ ...f, items });
  }
  res.json(result);
});

router.post('/form49/generar-oc-proveedor', verificarToken, (req, res) => {
  if (!req.permisos?.compras?.escribir) return res.status(403).json({ error: 'Sin permisos' });
  const { proveedor_id, proveedor_nombre, proveedor_cuit, fecha, moneda, tasa_cambio,
          condicion_pago, observaciones, items, fuente_numeros } = req.body;
  if (!proveedor_nombre?.trim()) return res.status(400).json({ error: 'Falta proveedor' });
  if (!items?.length) return res.status(400).json({ error: 'Sin ítems seleccionados' });
  const errItems = validarItemsOC(items);
  if (errItems) return res.status(400).json({ error: errItems });
  const numero = nextNumeroOC();
  const hoy = hoyArgentina();
  const fechaOC = fecha||hoy;
  const tasaCambioOC = tasa_cambio ? parseFloat(tasa_cambio) : tasaCambioSistema(moneda||'PESOS', fechaOC);
  const obs = observaciones?.trim() ||
    `Generada desde ingresos sin OC${fuente_numeros?.length ? ': ' + fuente_numeros.join(', ') : ''}`;
  const oc_id = db.transaction(() => {
    const r = db.prepare(`INSERT INTO ordenes_compra
      (numero,fecha,proveedor_id,proveedor_nombre,proveedor_cuit,moneda,tasa_cambio,
       condicion_pago,lugar_entrega,observaciones,estado,fecha_recepcion,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(numero, fechaOC, proveedor_id||null, proveedor_nombre, formatCuit(proveedor_cuit),
           moneda||'PESOS', tasaCambioOC,
           condicion_pago||'', 'e-intra', obs, 'Recibida', fechaOC, req.usuario.id);
    const oc_id = r.lastInsertRowid;
    for (const [i, it] of items.entries()) {
      db.prepare(`INSERT INTO oc_items
        (oc_id,item_num,producto_id,cantidad,unidad,descripcion,precio_unitario,
         bonif1,bonif2,bonif3,bonif4,precio_final,plazo,cant_recibida)
        VALUES (?,?,?,?,?,?,?,0,0,0,0,?,?,?)`)
        .run(oc_id, i+1, it.producto_id||null, it.cantidad||0, it.unidad||'UND.',
             it.descripcion||'', parseFloat(it.precio_unitario)||0,
             parseFloat(it.precio_final)||0, it.plazo||'INMEDIATO', it.cantidad||0);
    }
    return oc_id;
  })();
  res.status(201).json({ oc_numero: numero, oc_id });
});

router.get('/form49/:id', verificarToken, leerCompras, (req, res) => {
  const f = db.prepare('SELECT * FROM form49_ingresos WHERE id=?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'No encontrado' });
  const items = db.prepare('SELECT * FROM form49_items WHERE form49_id=? ORDER BY id').all(f.id);
  const enviado_stock = !!db.prepare('SELECT 1 FROM ingresos_sin_oc_pendientes WHERE form49_id=? LIMIT 1').get(f.id);
  res.json({ ...f, enviado_stock, items });
});

function insertarItemsF49(fid, numero, proveedor_nombre, items) {
  for (const it of items) {
    db.prepare(`INSERT INTO form49_items
      (form49_id,descripcion,cantidad,unidad,n_parte,n_serie,n_lote,destino,precio_unitario,precio_final,plazo,producto_id,producto_codigo)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(fid, it.descripcion||'', it.cantidad||0, it.unidad||'UND.',
           it.n_parte||'', it.n_serie||'', it.n_lote||'',
           'stock',
           parseFloat(it.precio_unitario)||0, parseFloat(it.precio_final)||0, it.plazo||'INMEDIATO',
           it.producto_id||null, it.producto_codigo||'');
    if (it.producto_id) {
      db.prepare(`INSERT INTO ingresos_sin_oc_pendientes
        (form49_id,form49_numero,proveedor_nombre,descripcion,unidad,cantidad,n_parte,precio_costo,producto_id,producto_codigo)
        VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(fid, numero, proveedor_nombre, it.descripcion||'', it.unidad||'UND.',
             it.cantidad||0, it.n_parte||'',
             parseFloat(it.precio_final)||0,
             it.producto_id, it.producto_codigo||'');
    }
  }
}

router.post('/form49', verificarToken, (req, res) => {
  if (!req.permisos?.compras?.escribir) return res.status(403).json({ error: 'Sin permisos' });
  const { proveedor_id, proveedor_nombre, proveedor_cuit, fecha, proyecto,
          autorizado_por, recibido_por, elaborado_por, observaciones,
          moneda, tasa_cambio, condicion_pago, lugar_entrega, presupuesto_n, items } = req.body;
  if (!proveedor_nombre?.trim()) return res.status(400).json({ error: 'Proveedor es obligatorio' });
  const errItems = validarItemsOC(items);
  if (errItems) return res.status(400).json({ error: errItems });
  const numero = nextNumeroF49();
  const trx = db.transaction(() => {
    const r = db.prepare(`INSERT INTO form49_ingresos
      (numero,fecha,proveedor_id,proveedor_nombre,proveedor_cuit,proyecto,autorizado_por,recibido_por,
       elaborado_por,observaciones,moneda,tasa_cambio,condicion_pago,lugar_entrega,presupuesto_n,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(numero, fecha||hoyArgentina(),
           proveedor_id||null, proveedor_nombre, formatCuit(proveedor_cuit),
           proyecto||'', autorizado_por||'', recibido_por||'', elaborado_por||'', observaciones||'',
           moneda||'PESOS', parseFloat(tasa_cambio)||0, condicion_pago||'', lugar_entrega||'', presupuesto_n||'',
           req.usuario.id);
    const fid = r.lastInsertRowid;
    if (items?.length) insertarItemsF49(fid, numero, proveedor_nombre, items);
    return fid;
  });
  const fid = trx();
  const f = db.prepare('SELECT * FROM form49_ingresos WHERE id=?').get(fid);
  res.status(201).json({ ...f, items: db.prepare('SELECT * FROM form49_items WHERE form49_id=? ORDER BY id').all(fid) });
});

router.put('/form49/:id', verificarToken, (req, res) => {
  if (!req.permisos?.compras?.escribir) return res.status(403).json({ error: 'Sin permisos' });
  const f = db.prepare('SELECT * FROM form49_ingresos WHERE id=?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'No encontrado' });
  const { proveedor_id, proveedor_nombre, proveedor_cuit, fecha, proyecto,
          autorizado_por, recibido_por, elaborado_por, observaciones,
          moneda, tasa_cambio, condicion_pago, lugar_entrega, presupuesto_n, items } = req.body;
  const errItems = validarItemsOC(items);
  if (errItems) return res.status(400).json({ error: errItems });
  db.transaction(() => {
    db.prepare(`UPDATE form49_ingresos SET
      proveedor_id=?,proveedor_nombre=?,proveedor_cuit=?,fecha=?,proyecto=?,
      autorizado_por=?,recibido_por=?,elaborado_por=?,observaciones=?,
      moneda=?,tasa_cambio=?,condicion_pago=?,lugar_entrega=?,presupuesto_n=?
      WHERE id=?`)
      .run(proveedor_id??f.proveedor_id, proveedor_nombre??f.proveedor_nombre, proveedor_cuit!=null ? formatCuit(proveedor_cuit) : (f.proveedor_cuit??''),
           fecha??f.fecha, proyecto??f.proyecto,
           autorizado_por??f.autorizado_por, recibido_por??f.recibido_por, elaborado_por??f.elaborado_por??'',
           observaciones??f.observaciones,
           moneda??f.moneda??'PESOS', parseFloat(tasa_cambio??f.tasa_cambio)||0,
           condicion_pago??f.condicion_pago??'', lugar_entrega??f.lugar_entrega??'', presupuesto_n??f.presupuesto_n??'',
           req.params.id);
    if (items) {
      db.prepare('DELETE FROM form49_items WHERE form49_id=?').run(req.params.id);
      db.prepare('DELETE FROM ingresos_sin_oc_pendientes WHERE form49_id=?').run(req.params.id);
      insertarItemsF49(req.params.id, f.numero, proveedor_nombre||f.proveedor_nombre, items);
    }
  })();
  const updated = db.prepare('SELECT * FROM form49_ingresos WHERE id=?').get(req.params.id);
  res.json({ ...updated, items: db.prepare('SELECT * FROM form49_items WHERE form49_id=? ORDER BY id').all(req.params.id) });
});

router.delete('/form49/:id', verificarToken, (req, res) => {
  if (!req.permisos?.compras?.escribir) return res.status(403).json({ error: 'Sin permisos' });
  db.prepare('DELETE FROM form49_items WHERE form49_id=?').run(req.params.id);
  db.prepare('DELETE FROM form49_ingresos WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/form49/:id/generar-oc', verificarToken, (req, res) => {
  if (!req.permisos?.compras?.escribir) return res.status(403).json({ error: 'Sin permisos' });
  const f = db.prepare('SELECT * FROM form49_ingresos WHERE id=?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'No encontrado' });
  if (f.oc_id) return res.status(400).json({ error: `Ya tiene OC generada: ${f.oc_numero}` });

  const { fecha, moneda, tasa_cambio, condicion_pago, nro_factura, observaciones, items } = req.body;
  if (!items?.length) return res.status(400).json({ error: 'Se requieren ítems con precios' });
  const errItems = validarItemsOC(items);
  if (errItems) return res.status(400).json({ error: errItems });

  const numero = nextNumeroOC();
  const hoy = hoyArgentina();
  const fechaOC = fecha||f.fecha||hoy;
  const monedaOC = moneda||f.moneda||'PESOS';
  const tasaCambioOC = parseFloat(tasa_cambio) || f.tasa_cambio || tasaCambioSistema(monedaOC, fechaOC);

  const oc_id = db.transaction(() => {
    const r = db.prepare(`INSERT INTO ordenes_compra
      (numero,fecha,proveedor_id,proveedor_nombre,proveedor_cuit,moneda,tasa_cambio,
       autorizado_por,elaborado_por,condicion_pago,lugar_entrega,presupuesto_n,
       observaciones,estado,nro_factura,fecha_recepcion,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(numero, fechaOC, f.proveedor_id||null, f.proveedor_nombre, formatCuit(f.proveedor_cuit),
           monedaOC, tasaCambioOC,
           f.autorizado_por||'', f.elaborado_por||'',
           condicion_pago||f.condicion_pago||'CTA. CTE.', f.lugar_entrega||'e-intra',
           f.presupuesto_n||'',
           observaciones||f.observaciones||`Generada desde ingreso ${f.numero}`,
           'Recibida', nro_factura||'', f.fecha||hoy,
           req.usuario.id);
    const oc_id = r.lastInsertRowid;
    for (const [i, it] of items.entries()) {
      db.prepare(`INSERT INTO oc_items
        (oc_id,item_num,producto_id,cantidad,unidad,descripcion,precio_unitario,bonif1,bonif2,bonif3,bonif4,precio_final,plazo,cant_recibida)
        VALUES (?,?,?,?,?,?,?,0,0,0,0,?,?,?)`)
        .run(oc_id, i+1, it.producto_id||null, it.cantidad||0, it.unidad||'UND.', it.descripcion||'',
             parseFloat(it.precio_unitario)||0, parseFloat(it.precio_final)||0,
             it.plazo||'INMEDIATO', it.cantidad||0);
    }
    db.prepare('UPDATE form49_ingresos SET oc_id=?, oc_numero=? WHERE id=?')
      .run(oc_id, numero, f.id);
    return oc_id;
  })();

  const oc = db.prepare('SELECT * FROM ordenes_compra WHERE id=?').get(oc_id);
  res.status(201).json({ oc_numero: numero, oc_id, oc });
});

module.exports = router;
