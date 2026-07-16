const express = require('express');
const XLSX    = require('xlsx');
const { body, validationResult } = require('express-validator');
const { db }  = require('../db/database');
const { verificarToken, ESCRITURA_COMPRAS, ESCRITURA_STOCK } = require('../middleware/auth');
const { buscarCondicion } = require('../helpers/buscar');

const router = express.Router();

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

router.get('/proveedores', verificarToken, (req, res) => {
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
      .run(nombre, cuit||'', contacto||'', telefono||'', email||'', direccion||'', localidad||'', cp||'', vendedor||'', condicion_pago||'TRANSF. BANCARIA', critico?1:0,
           categoria_provision||'', fecha_seleccion||'', frecuencia_evaluacion||'Anual', responsable_seleccion||'', responsable_evaluacion||'');
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
  if (!puedeEscribirAdmin(req)) return res.status(403).json({ error: 'Sin permisos' });
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
  if (!puedeEscribirAdmin(req)) return res.status(403).json({ error: 'Sin permisos' });
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
  if (!puedeEscribirAdmin(req)) return res.status(403).json({ error: 'Sin permisos' });

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
  if (!puedeEscribirAdmin(req)) return res.status(403).json({ error: 'Sin permisos' });
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
    .run(nombre??p.nombre, cuit??p.cuit, contacto??p.contacto, telefono??p.telefono,
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
  if (!puedeEscribirAdmin(req)) return res.status(403).json({ error: 'Sin permisos' });

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

router.get('/oc', verificarToken, (req, res) => {
  const { estado, proveedor_id, desde, hasta, buscar, page=1, limit=50 } = req.query;
  const conds=[], params=[];
  if (estado)       { conds.push('o.estado=?');          params.push(estado); }
  if (proveedor_id) { conds.push('o.proveedor_id=?');    params.push(proveedor_id); }
  if (desde)        { conds.push('o.fecha>=?');           params.push(desde); }
  if (hasta)        { conds.push('o.fecha<=?');           params.push(hasta); }
  if (buscar)       { const b = buscarCondicion(buscar, ['o.numero','o.proveedor_nombre']); conds.push(b.cond); params.push(...b.params); }
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

router.get('/ultimo-precio', verificarToken, (req, res) => {
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

router.get('/oc/:id', verificarToken, (req, res) => {
  const oc = db.prepare('SELECT * FROM ordenes_compra WHERE id=?').get(req.params.id);
  if (!oc) return res.status(404).json({ error: 'OC no encontrada' });
  const items = db.prepare(`
    SELECT i.*, p.codigo as producto_codigo
    FROM oc_items i LEFT JOIN productos p ON p.id = i.producto_id
    WHERE i.oc_id=? ORDER BY i.item_num
  `).all(oc.id);
  res.json({ ...oc, items });
});

// Items sin codificar — para revisión del admin
router.get('/oc/items-sin-codificar', verificarToken, (req, res) => {
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

function actualizarCatalogoDesdeOC(items, moneda, fecha, proveedor_id) {
  for (const it of (items || [])) {
    const precio = parseFloat(it.precio_final) || 0;
    if (it.producto_id && precio > 0) {
      db.prepare('UPDATE productos SET precio_costo=?, precio_moneda=?, precio_fecha=? WHERE id=?')
        .run(precio, moneda || 'DÓLAR', fecha || '', it.producto_id);
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

router.post('/oc', verificarToken, body('proveedor_nombre').trim().notEmpty(), (req, res) => {
  if (!req.permisos?.compras?.escribir) return res.status(403).json({ error: 'Sin permisos' });
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() });

  const { proveedor_id, proveedor_nombre, proveedor_cuit, fecha, moneda, tasa_cambio,
          autorizado_por, elaborado_por, condicion_pago, lugar_entrega, presupuesto_n,
          observaciones, fecha_entrega_est, estado_doc, modo_plazo, dias_plazo, items } = req.body;

  const numero = nextNumeroOC();
  const fechaOC = fecha||new Date().toISOString().slice(0,10);
  const modoPlazoOC = modo_plazo === 'ITEM' ? 'ITEM' : 'OC';
  const fechaEntregaCalc = calcularFechaEntregaOC(fechaOC, modoPlazoOC, dias_plazo, items, fecha_entrega_est);
  const trx = db.transaction(() => {
    const r = db.prepare(`INSERT INTO ordenes_compra (numero,fecha,proveedor_id,proveedor_nombre,proveedor_cuit,moneda,tasa_cambio,autorizado_por,elaborado_por,condicion_pago,lugar_entrega,presupuesto_n,observaciones,fecha_entrega_est,estado_doc,modo_plazo,dias_plazo,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(numero, fechaOC, proveedor_id||null, proveedor_nombre,
           proveedor_cuit||'', moneda||'DÓLAR', tasa_cambio||0, autorizado_por||'', elaborado_por||'',
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
    return oc_id;
  });
  const oc_id = trx();
  actualizarCatalogoDesdeOC(items, moneda, fecha, proveedor_id);
  const oc = db.prepare('SELECT * FROM ordenes_compra WHERE id=?').get(oc_id);
  res.status(201).json({ ...oc, items: db.prepare('SELECT * FROM oc_items WHERE oc_id=? ORDER BY item_num').all(oc_id) });
});

router.put('/oc/:id', verificarToken, (req, res) => {
  if (!req.permisos?.compras?.escribir) return res.status(403).json({ error: 'Sin permisos' });
  const oc = db.prepare('SELECT * FROM ordenes_compra WHERE id=?').get(req.params.id);
  if (!oc) return res.status(404).json({ error: 'OC no encontrada' });

  const { proveedor_id, proveedor_nombre, proveedor_cuit, fecha, moneda, tasa_cambio,
          autorizado_por, elaborado_por, condicion_pago, lugar_entrega, presupuesto_n,
          observaciones, estado, fecha_entrega_est, numero_remito, fecha_recepcion,
          estado_doc, nro_factura, importe_facturado, fecha_vencimiento, pago_confirmado,
          modo_plazo, dias_plazo, items } = req.body;

  const fechaOC = fecha??oc.fecha;
  const modoPlazoOC = (modo_plazo ?? oc.modo_plazo) === 'ITEM' ? 'ITEM' : 'OC';
  const diasPlazoOC = dias_plazo !== undefined ? dias_plazo : oc.dias_plazo;
  const itemsParaCalculo = items ?? db.prepare('SELECT * FROM oc_items WHERE oc_id=?').all(req.params.id);
  const fechaEntregaCalc = calcularFechaEntregaOC(fechaOC, modoPlazoOC, diasPlazoOC, itemsParaCalculo, fecha_entrega_est??oc.fecha_entrega_est??'');

  const trx = db.transaction(() => {
    db.prepare(`UPDATE ordenes_compra SET proveedor_id=?,proveedor_nombre=?,proveedor_cuit=?,fecha=?,moneda=?,tasa_cambio=?,autorizado_por=?,elaborado_por=?,condicion_pago=?,lugar_entrega=?,presupuesto_n=?,observaciones=?,estado=?,fecha_entrega_est=?,numero_remito=?,fecha_recepcion=?,estado_doc=?,nro_factura=?,importe_facturado=?,fecha_vencimiento=?,pago_confirmado=?,modo_plazo=?,dias_plazo=?,updated_at=datetime('now','localtime') WHERE id=?`)
      .run(proveedor_id??oc.proveedor_id, proveedor_nombre??oc.proveedor_nombre, proveedor_cuit??oc.proveedor_cuit,
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
  });
  trx();
  const updated = db.prepare('SELECT * FROM ordenes_compra WHERE id=?').get(req.params.id);
  res.json({ ...updated, items: db.prepare('SELECT * FROM oc_items WHERE oc_id=? ORDER BY item_num').all(req.params.id) });
});

// Recibir OC → crea ingresos pendientes (stock se confirma desde el módulo Stock)
router.post('/oc/:id/recibir', verificarToken, (req, res) => {
  if (!(req.permisos?.compras?.escribir || req.permisos?.stock?.escribir))
    return res.status(403).json({ error: 'Sin permisos' });

  const oc    = db.prepare('SELECT * FROM ordenes_compra WHERE id=?').get(req.params.id);
  if (!oc) return res.status(404).json({ error: 'OC no encontrada' });
  if (oc.estado === 'Cancelada') return res.status(400).json({ error: 'OC cancelada' });

  const { recepciones, fecha, numero_remito, producto_ids } = req.body;
  const fechaRec = fecha || new Date().toISOString().slice(0,10);

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
      if (real < pendiente) todosRecibidos = false;
    }
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

// ── Form 49 — Ingreso sin OC/remito ──────────────────────────────────────────

function nextNumeroF49() {
  const r = db.prepare("SELECT numero FROM form49_ingresos ORDER BY id DESC LIMIT 1").get();
  if (r) { try { const n = parseInt(r.numero.replace('F49-','')); return `F49-${String(n+1).padStart(6,'0')}`; } catch(_){} }
  return 'F49-000001';
}

router.get('/form49', verificarToken, (req, res) => {
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

router.get('/form49/stock-por-proveedor', verificarToken, (req, res) => {
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
  const numero = nextNumeroOC();
  const hoy = new Date().toISOString().slice(0, 10);
  const obs = observaciones?.trim() ||
    `Generada desde ingresos sin OC${fuente_numeros?.length ? ': ' + fuente_numeros.join(', ') : ''}`;
  const oc_id = db.transaction(() => {
    const r = db.prepare(`INSERT INTO ordenes_compra
      (numero,fecha,proveedor_id,proveedor_nombre,proveedor_cuit,moneda,tasa_cambio,
       condicion_pago,lugar_entrega,observaciones,estado,fecha_recepcion,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(numero, fecha||hoy, proveedor_id||null, proveedor_nombre, proveedor_cuit||'',
           moneda||'PESOS', parseFloat(tasa_cambio)||0,
           condicion_pago||'', 'e-intra', obs, 'Recibida', fecha||hoy, req.usuario.id);
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

router.get('/form49/:id', verificarToken, (req, res) => {
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
  const numero = nextNumeroF49();
  const trx = db.transaction(() => {
    const r = db.prepare(`INSERT INTO form49_ingresos
      (numero,fecha,proveedor_id,proveedor_nombre,proveedor_cuit,proyecto,autorizado_por,recibido_por,
       elaborado_por,observaciones,moneda,tasa_cambio,condicion_pago,lugar_entrega,presupuesto_n,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(numero, fecha||new Date().toISOString().slice(0,10),
           proveedor_id||null, proveedor_nombre, proveedor_cuit||'',
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
  db.transaction(() => {
    db.prepare(`UPDATE form49_ingresos SET
      proveedor_id=?,proveedor_nombre=?,proveedor_cuit=?,fecha=?,proyecto=?,
      autorizado_por=?,recibido_por=?,elaborado_por=?,observaciones=?,
      moneda=?,tasa_cambio=?,condicion_pago=?,lugar_entrega=?,presupuesto_n=?
      WHERE id=?`)
      .run(proveedor_id??f.proveedor_id, proveedor_nombre??f.proveedor_nombre, proveedor_cuit??f.proveedor_cuit??'',
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

  const numero = nextNumeroOC();
  const hoy = new Date().toISOString().slice(0, 10);

  const oc_id = db.transaction(() => {
    const r = db.prepare(`INSERT INTO ordenes_compra
      (numero,fecha,proveedor_id,proveedor_nombre,proveedor_cuit,moneda,tasa_cambio,
       autorizado_por,elaborado_por,condicion_pago,lugar_entrega,presupuesto_n,
       observaciones,estado,nro_factura,fecha_recepcion,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(numero, fecha||f.fecha, f.proveedor_id||null, f.proveedor_nombre, f.proveedor_cuit||'',
           moneda||f.moneda||'PESOS', parseFloat(tasa_cambio)||f.tasa_cambio||0,
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
