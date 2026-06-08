#!/usr/bin/env node
'use strict';

/**
 * importar_historico.js
 * Importa datos históricos de 3 formularios Excel → SQLite (eintra_erp.db)
 * Uso: node importar_historico.js   (desde la carpeta backend/)
 * Idempotente: puede correrse múltiples veces sin duplicar datos.
 */

const path = require('path');
const fs   = require('fs');

let Database, XLSX;
try { Database = require('better-sqlite3'); } catch { console.error('ERROR: better-sqlite3 no encontrado.'); process.exit(1); }
try { XLSX = require('xlsx'); } catch { console.error('ERROR: xlsx no encontrado.'); process.exit(1); }

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
// Ajustar nombres de archivo si son distintos
const ROOT_DIR = path.resolve(__dirname, '..');
const DB_PATH  = path.resolve(__dirname, 'db', 'eintra_erp.db');

const FILES = {
  form49: path.join(ROOT_DIR, 'Form 49 rev 0 Entrada de material Sin Remito.xlsx'),
  form11: path.join(ROOT_DIR, 'Form 11 rev 0 Sel y Eval continua de Prov Criticos.xlsx'),
  form17: path.join(ROOT_DIR, 'Form 17 Rev 2 - Seguimientos Compras.xlsx'),
};

// Columna en ordenes_compra que tiene el número de OC (ej: "000001")
const OC_KEY_COLUMN = 'numero';

// Índices de columna del Form 17 (0-based, desde fila de datos)
const F17_COLS = {
  oc:               1,
  nro_factura:      25,
  importe_facturado:12,
  fecha_vencimiento:18,
  pago_confirmado:  26,
  estado_doc:       21,
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function fmt(val) {
  if (val == null) return null;
  if (typeof val === 'string') return val.trim() || null;
  if (val instanceof Date)     return dateStr(val);
  if (typeof val === 'number') return isFinite(val) ? String(val) : null;
  return String(val).trim() || null;
}

function dateStr(val) {
  if (val == null) return null;
  if (val instanceof Date) {
    if (isNaN(val.getTime())) return null;
    return val.toISOString().slice(0, 10);
  }
  if (typeof val === 'number') {
    try {
      const d = XLSX.SSF.parse_date_code(val);
      if (!d) return null;
      return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
    } catch { return null; }
  }
  const s = String(val).trim();
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function toNum(val) {
  if (val == null) return null;
  if (typeof val === 'number') return isFinite(val) ? val : null;
  const n = parseFloat(String(val));
  return isNaN(n) ? null : n;
}

function toInt(val) {
  const n = toNum(val);
  return n != null ? Math.round(n) : null;
}

const C = { R:'\x1b[0m', G:'\x1b[32m', Y:'\x1b[33m', B:'\x1b[36m', D:'\x1b[31m', DIM:'\x1b[2m' };
function section(msg) { console.log(`\n${C.B}▶ ${msg}${C.R}`); }
function ok(msg)      { console.log(`  ${C.G}✓${C.R} ${msg}`); }
function warn(msg)    { console.log(`  ${C.Y}⚠${C.R}  ${msg}`); }
function info(msg)    { console.log(`  ${C.DIM}${msg}${C.R}`); }
function er(msg)      { console.log(`  ${C.D}✗${C.R} ${msg}`); }

// ─── VALIDAR DB ───────────────────────────────────────────────────────────────
console.log('\n────────────────────────────────────────────');
console.log(' importar_historico.js — E-INTRA ERP');
console.log('────────────────────────────────────────────');

if (!fs.existsSync(DB_PATH)) {
  er(`Base de datos no encontrada: ${DB_PATH}`);
  process.exit(1);
}
info(`DB  : ${DB_PATH}`);
info(`Root: ${ROOT_DIR}`);

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = OFF'); // OFF para evitar FK errors en datos huérfanos del Excel

// ─── VERIFICAR TABLAS ─────────────────────────────────────────────────────────
section('Verificando schema...');

const tablas = ['form49_ingresos','form49_items','evaluaciones_proveedor','evaluacion_criterios','ordenes_compra'];
for (const t of tablas) {
  const ex = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(t);
  ex ? ok(`Tabla '${t}' existe`) : warn(`Tabla '${t}' NO encontrada — puede que el servidor no haya iniciado todavía`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FORM 49
// ═══════════════════════════════════════════════════════════════════════════════
section('Form 49 — Entrada de material sin remito');

if (!fs.existsSync(FILES.form49)) {
  warn(`Archivo no encontrado: ${FILES.form49}`);
  warn('Colocar el archivo en la raíz del proyecto y volver a correr.');
} else {
  info(`Leyendo: ${path.basename(FILES.form49)}`);

  const wb49  = XLSX.readFile(FILES.form49, { cellDates: true, cellNF: false });
  const ws49  = wb49.Sheets[wb49.SheetNames[0]];
  const rows49 = XLSX.utils.sheet_to_json(ws49, { header: 1, defval: null });

  const stmtInsIngreso = db.prepare(`
    INSERT OR IGNORE INTO form49_ingresos
      (numero, fecha, proveedor_nombre, proyecto, autorizado_por, recibido_por, observaciones)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const stmtInsItem = db.prepare(`
    INSERT INTO form49_items (form49_id, descripcion, cantidad, unidad, n_parte, n_serie, n_lote)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const stmtLastId = db.prepare(`SELECT last_insert_rowid() AS id`);

  let f49Imp = 0, f49Skip = 0;

  const importF49Block = db.transaction((numero, fecha, proveedor, autorizado, recibido, itemRows) => {
    const res = stmtInsIngreso.run(numero, fecha, proveedor, null, autorizado, recibido, null);
    if (res.changes === 0) return false;
    const ingresoId = stmtLastId.get().id;
    for (const ir of itemRows) {
      const desc = fmt(ir[1]);
      const cant = toNum(ir[6]);
      if (!desc && cant == null) continue;
      stmtInsItem.run(ingresoId, desc, cant, fmt(ir[2]), fmt(ir[3]), fmt(ir[4]), fmt(ir[5]));
    }
    return true;
  });

  let autoCounter = 0;
  for (let i = 0; i < rows49.length; i++) {
    const row = rows49[i];
    if (!row) continue;
    const cell0 = String(row[0] || '').toUpperCase();
    if (!cell0.includes('PROVEEDOR')) continue;

    const proveedor = fmt(row[1]);
    const fecha     = dateStr(row[5]) || dateStr(row[6]);
    if (!proveedor && !fecha) continue;

    const prevRow    = rows49[i - 1] || [];
    const numero     = fmt(prevRow[6]) || fmt(prevRow[0]) || `F49-AUTO-${++autoCounter}`;
    const footerRow  = rows49[i + 13] || [];
    const autorizado = fmt(footerRow[1]);
    const recibido   = fmt(footerRow[4]) || fmt(footerRow[5]);

    const itemRows = [];
    for (let j = 2; j <= 11; j++) itemRows.push(rows49[i + j] || []);

    const imported = importF49Block(numero, fecha, proveedor, autorizado, recibido, itemRows);
    if (imported) f49Imp++; else f49Skip++;
    i += 13;
  }

  if (f49Imp === 0 && f49Skip === 0)
    warn('Sin datos en Form 49 (archivo puede estar en blanco — OK si no hay histórico)');
  else
    ok(`Form 49: ${f49Imp} ingresos importados, ${f49Skip} ya existían (sin cambios)`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FORM 11
// ═══════════════════════════════════════════════════════════════════════════════
section('Form 11 — Selección y Evaluación continua de Proveedores');

if (!fs.existsSync(FILES.form11)) {
  warn(`Archivo no encontrado: ${FILES.form11}`);
} else {
  info(`Leyendo: ${path.basename(FILES.form11)}...`);

  const wb11 = XLSX.readFile(FILES.form11, { cellDates: true, cellNF: false });

  info(`Hojas encontradas: ${wb11.SheetNames.join(', ')}`);

  // Mapa año → índices de columna en "Listado de proveedores"
  const YEAR_MAP = [
    { anio: 2025, ri: 12, pi: 13, fi: 14 },
    { anio: 2024, ri: 15, pi: 16, fi: 17 },
    { anio: 2023, ri: 18, pi: 19, fi: 20 },
    { anio: 2022, ri: 21, pi: 22, fi: 23 },
    { anio: 2021, ri: 24, pi: 25, fi: 26 },
    { anio: 2020, ri: 27, pi: 28, fi: 29 },
    { anio: 2019, ri: 30, pi: 31, fi: 32 },
  ];

  // ── Buscar proveedor en DB por nombre (exacto primero, luego LIKE) ──────────
  const stmtFindProvExact = db.prepare(`SELECT id FROM proveedores WHERE UPPER(nombre) = UPPER(?) LIMIT 1`);
  const stmtFindProvLike  = db.prepare(`SELECT id FROM proveedores WHERE UPPER(nombre) LIKE UPPER(?) LIMIT 1`);

  function findProveedor(nombre) {
    if (!nombre) return null;
    const r = stmtFindProvExact.get(nombre.trim()) || stmtFindProvLike.get(`%${nombre.trim()}%`);
    return r ? r.id : null;
  }

  // ── Statements idempotentes (check + insert, sin UNIQUE) ──────────────────
  const stmtCheckEval = db.prepare(`
    SELECT id FROM evaluaciones_proveedor WHERE proveedor_id=? AND tipo=? AND anio=?
  `);
  const stmtInsertEval = db.prepare(`
    INSERT INTO evaluaciones_proveedor (proveedor_id, tipo, anio, resultado, puntaje, fecha, observaciones)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const stmtCheckCrit = db.prepare(`
    SELECT id FROM evaluacion_criterios WHERE evaluacion_id=? AND criterio=?
  `);
  const stmtInsertCrit = db.prepare(`
    INSERT INTO evaluacion_criterios (evaluacion_id, criterio, puntaje) VALUES (?, ?, ?)
  `);

  function insertarCriterios(evalId, criteriosObj) {
    let n = 0;
    for (const [criterio, puntaje] of Object.entries(criteriosObj)) {
      if (!puntaje) continue;
      const ex = stmtCheckCrit.get(evalId, criterio);
      if (!ex) { stmtInsertCrit.run(evalId, criterio, puntaje); n++; }
    }
    return n;
  }

  function upsertEval(provId, tipo, anio, resultado, puntaje, fecha, criteriosObj) {
    if (!provId || !anio) return false;
    const ex = stmtCheckEval.get(provId, tipo, anio);
    if (ex) {
      // Ya existe — solo insertar criterios faltantes
      insertarCriterios(ex.id, criteriosObj || {});
      return false; // no es nuevo
    }
    stmtInsertEval.run(provId, tipo, anio, resultado, puntaje, fecha, null);
    const newId = db.prepare(`SELECT last_insert_rowid() AS id`).get().id;
    insertarCriterios(newId, criteriosObj || {});
    return true;
  }

  // ── 1. Leer criterios de Selección por nombre ──────────────────────────────
  const selCriterios = new Map(); // Map<nombre, { criterio: valor }>
  const sheetSelNombre = wb11.SheetNames.find(n => n.toLowerCase().includes('selecci'));
  if (sheetSelNombre) {
    info(`Hoja selección: "${sheetSelNombre}"`);
    const rows = XLSX.utils.sheet_to_json(wb11.Sheets[sheetSelNombre], { header: 1, defval: null });
    for (let i = 3; i < rows.length; i++) {
      const r = rows[i]; if (!r) continue;
      const nombre = fmt(r[1]); // col B = nombre del proveedor
      if (!nombre) continue;
      selCriterios.set(nombre.toUpperCase(), {
        'Calidad final': fmt(r[8]),
        'Precio':        fmt(r[9]),
        'Experiencia laboral':  fmt(r[10]),
        'Experiencia en mercado': fmt(r[11]),
      });
    }
    info(`Criterios de selección leídos: ${selCriterios.size} proveedores`);
  } else {
    warn('Hoja de Selección no encontrada');
  }

  // ── 2. Leer criterios de Evaluación por año ────────────────────────────────
  const evalCriterios = new Map(); // Map<nombreUpper, Map<año, {criterio: valor}>>
  for (const { anio } of YEAR_MAP) {
    const sheetName = wb11.SheetNames.find(n => n.includes(String(anio)) && n.toLowerCase().includes('eval'));
    if (!sheetName) { info(`Sin hoja para año ${anio}`); continue; }
    const rows = XLSX.utils.sheet_to_json(wb11.Sheets[sheetName], { header: 1, defval: null });
    let cnt = 0;
    for (let i = 3; i < rows.length; i++) {
      const r = rows[i]; if (!r) continue;
      const nombre = fmt(r[1]); // col B = nombre proveedor
      if (!nombre) continue;
      const key = nombre.toUpperCase();
      if (!evalCriterios.has(key)) evalCriterios.set(key, new Map());
      evalCriterios.get(key).set(anio, {
        'Cumplimiento de plazos':        fmt(r[7]),
        'Capacidad de respuesta':        fmt(r[8]),
        'Flexibilidad ante cambios':     fmt(r[9]),
        'Calidad final':                 fmt(r[10]),
      });
      cnt++;
    }
    info(`Año ${anio} (hoja "${sheetName}"): ${cnt} filas de criterios`);
  }

  // ── 3. Iterar Listado de proveedores ───────────────────────────────────────
  const sheetListado = wb11.SheetNames.find(n => n.toLowerCase().includes('listado'));
  if (!sheetListado) {
    er('Hoja "Listado de proveedores" no encontrada en Form 11');
  } else {
    info(`Hoja listado: "${sheetListado}"`);
    const listadoRows = XLSX.utils.sheet_to_json(wb11.Sheets[sheetListado], { header: 1, defval: null });

    let f11Imp = 0, f11Skip = 0, f11NoMatch = 0, f11CritImp = 0;

    const runF11 = db.transaction(() => {
      for (let i = 2; i < listadoRows.length; i++) {
        const r = listadoRows[i]; if (!r) continue;
        const nombre = fmt(r[1]); // col B = nombre proveedor
        if (!nombre) continue;

        const provId = findProveedor(nombre);
        if (!provId) {
          warn(`Proveedor no encontrado en DB: "${nombre}" — omitido`);
          f11NoMatch++;
          continue;
        }

        // Selección
        const fechaSel = dateStr(r[7]);
        const resSel   = fmt(r[8]);
        const ptjSel   = toNum(r[9]);
        const anioSel  = fechaSel ? parseInt(fechaSel.slice(0, 4)) : (new Date().getFullYear());
        const critSel  = selCriterios.get(nombre.toUpperCase()) || {};

        if (resSel || ptjSel) {
          const nuevo = upsertEval(provId, 'seleccion', anioSel, resSel, ptjSel, fechaSel, critSel);
          if (nuevo) f11Imp++; else f11Skip++;
        }

        // Evaluaciones anuales
        for (const { anio, ri, pi, fi } of YEAR_MAP) {
          const resultado = fmt(r[ri]);
          if (!resultado) continue;
          const puntaje = toNum(r[pi]);
          const fecha   = dateStr(r[fi]);
          const critEv  = evalCriterios.get(nombre.toUpperCase())?.get(anio) || {};
          const nuevo   = upsertEval(provId, 'evaluacion', anio, resultado, puntaje, fecha, critEv);
          if (nuevo) f11Imp++; else f11Skip++;
        }
      }
    });

    runF11();
    ok(`Form 11: ${f11Imp} evaluaciones importadas, ${f11Skip} ya existían`);
    if (f11NoMatch > 0) warn(`${f11NoMatch} proveedores del Excel no encontrados en la DB`);
    info('TIP: Si hay muchos sin match, verificar que los proveedores ya estén cargados en el ERP antes de importar.');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// FORM 17
// ═══════════════════════════════════════════════════════════════════════════════
section('Form 17 — Seguimiento Compras → columnas extra en ordenes_compra');

const ocTableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='ordenes_compra'`).get();

if (!ocTableExists) {
  warn('Tabla ordenes_compra no encontrada — Form 17 saltado');
} else if (!fs.existsSync(FILES.form17)) {
  warn(`Archivo no encontrado: ${FILES.form17}`);
} else {
  info(`Leyendo: ${path.basename(FILES.form17)} (puede tardar varios segundos)...`);

  const wb17    = XLSX.readFile(FILES.form17, { cellDates: true, cellNF: false });
  const ws17Name = wb17.SheetNames.find(n => n.toLowerCase().includes('seguimiento'));

  if (!ws17Name) {
    er(`Hoja de Seguimiento no encontrada. Hojas disponibles: ${wb17.SheetNames.join(', ')}`);
  } else {
    info(`Hoja: "${ws17Name}"`);
    const rows17 = XLSX.utils.sheet_to_json(wb17.Sheets[ws17Name], { header: 1, defval: null });

    const { oc: COC, nro_factura: CNF, importe_facturado: CIF,
            fecha_vencimiento: CFV, pago_confirmado: CPC, estado_doc: CED } = F17_COLS;

    // Agrupar por número de OC (primer valor no nulo de cada campo)
    info('Agrupando filas por número de OC...');
    const ocMap = new Map();
    for (let i = 6; i < rows17.length; i++) {
      const r = rows17[i]; if (!r) continue;
      const ocRaw = r[COC]; if (ocRaw == null) continue;
      const ocStr = String(ocRaw).trim();
      // Intentamos tanto con ceros como sin ceros iniciales
      const variantes = new Set([
        ocStr,
        ocStr.replace(/^0+/, '') || ocStr,
        ocStr.padStart(6, '0'),
      ]);
      for (const key of variantes) {
        if (!key) continue;
        if (!ocMap.has(key)) ocMap.set(key, { nro_factura:null, importe:null, fecha_vcto:null, pagado:null, estado:null });
        const e = ocMap.get(key);
        if (e.nro_factura == null && r[CNF] != null) e.nro_factura = fmt(r[CNF]);
        if (e.importe     == null && r[CIF] != null) e.importe     = toNum(r[CIF]);
        if (e.fecha_vcto  == null && r[CFV] != null) e.fecha_vcto  = dateStr(r[CFV]);
        if (e.pagado      == null && r[CPC] != null) e.pagado      = fmt(r[CPC]);
        if (e.estado      == null && r[CED] != null) e.estado      = fmt(r[CED]);
      }
    }
    info(`OCs únicas en Excel: ${ocMap.size}`);

    const stmtGetOC = db.prepare(`SELECT ${OC_KEY_COLUMN} AS oc FROM ordenes_compra WHERE ${OC_KEY_COLUMN} = ?`);
    const stmtUpdate = db.prepare(`
      UPDATE ordenes_compra
      SET nro_factura       = CASE WHEN nro_factura       IS NULL OR nro_factura=''       THEN ? ELSE nro_factura       END,
          importe_facturado = CASE WHEN importe_facturado IS NULL OR importe_facturado=0  THEN ? ELSE importe_facturado END,
          fecha_vencimiento = CASE WHEN fecha_vencimiento IS NULL OR fecha_vencimiento='' THEN ? ELSE fecha_vencimiento END,
          pago_confirmado   = CASE WHEN pago_confirmado   IS NULL OR pago_confirmado=0    THEN ? ELSE pago_confirmado   END,
          estado_doc        = CASE WHEN estado_doc        IS NULL OR estado_doc=''        THEN ? ELSE estado_doc        END
      WHERE ${OC_KEY_COLUMN} = ?
    `);

    let f17Updated = 0, f17NoMatch = 0, f17Unchanged = 0;

    const runF17 = db.transaction(() => {
      const seen = new Set(); // evitar procesar la misma OC dos veces (por variantes de clave)
      for (const [oc, data] of ocMap) {
        const exists = stmtGetOC.get(oc);
        if (!exists) { f17NoMatch++; continue; }
        const ocNorm = exists.oc;
        if (seen.has(ocNorm)) continue;
        seen.add(ocNorm);
        const res = stmtUpdate.run(
          data.nro_factura, data.importe, data.fecha_vcto,
          data.pagado ? 1 : 0, data.estado, ocNorm
        );
        if (res.changes > 0) f17Updated++; else f17Unchanged++;
      }
    });
    runF17();

    ok(`Form 17: ${f17Updated} OCs actualizadas`);
    if (f17Unchanged > 0) info(`${f17Unchanged} OCs ya tenían datos (sin cambios)`);
    if (f17NoMatch > 0)   info(`${f17NoMatch} OCs del Excel sin match en ordenes_compra`);
    if (f17NoMatch > 100) warn(`Muchas OCs sin match — verificar que OC_KEY_COLUMN='${OC_KEY_COLUMN}' es correcto`);
  }
}

// ─── RESUMEN ──────────────────────────────────────────────────────────────────
section('Importación completada ✓');
console.log('');
db.close();
