#!/usr/bin/env node
'use strict';
/**
 * importar_form14.js — Importa historial de inspecciones del Form 14
 * Uso: node importar_form14.js <archivo.xlsx> [archivo2.xlsx ...]
 *
 * Operación atómica: recolecta todo en memoria, deduplica por (equipo, fecha),
 * y solo reemplaza la tabla si encontró registros válidos.
 */

const path = require('path');
let Database, XLSX;
try { Database = require('better-sqlite3'); } catch { console.error('ERROR: better-sqlite3 no instalado.'); process.exit(1); }
try { XLSX     = require('xlsx');           } catch { console.error('ERROR: xlsx no instalado.'); process.exit(1); }

require('dotenv').config({ path: path.join(__dirname, '.env') });
const rawPath = process.env.DB_PATH || './db/eintra_erp.db';
const DB_PATH = path.isAbsolute(rawPath) ? rawPath : path.resolve(__dirname, rawPath);

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

// ── MESES ESPAÑOL ───────────────────────────────────────────────────────────
const MESES_ABREV = { ene:1,feb:2,mar:3,abr:4,may:5,jun:6,jul:7,ago:8,sep:9,oct:10,nov:11,dic:12 };
const MESES_FULL  = {
  enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,
  julio:7,agosto:8,septiembre:9,octubre:10,noviembre:11,diciembre:12
};

function quitar_acentos(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function parsearFecha(celda, anio) {
  if (celda == null || celda === '') return null;

  // Número de serie Excel
  if (typeof celda === 'number' && celda > 1000) {
    try {
      const d = XLSX.SSF.parse_date_code(celda);
      if (d && d.y > 2000) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;
    } catch(_) {}
  }

  // Objeto Date de xlsx con cellDates:true
  if (celda instanceof Date) {
    const y = celda.getFullYear(), m = celda.getMonth()+1, d = celda.getDate();
    if (y > 2000) return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }

  const s = quitar_acentos(String(celda)).trim().toLowerCase();
  if (!s) return null;

  // "25-jun" / "3-abr" / "12 ene"
  const m1 = s.match(/^(\d{1,2})[\s\-\/]([a-z]{3,})/);
  if (m1) {
    const dia = parseInt(m1[1]);
    const mesStr = m1[2].substring(0,3);
    const mes = MESES_ABREV[mesStr];
    if (mes && dia >= 1 && dia <= 31) return `${anio}-${String(mes).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
  }

  // "25/06" o "25/06/2025"
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (m2) {
    const dia = parseInt(m2[1]), mes = parseInt(m2[2]);
    const yr  = m2[3] ? (m2[3].length === 2 ? 2000+parseInt(m2[3]) : parseInt(m2[3])) : anio;
    if (mes >= 1 && mes <= 12 && dia >= 1 && dia <= 31) return `${yr}-${String(mes).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
  }

  return null;
}

// Extrae la fecha del nombre de la hoja como fallback de último recurso
// "2025 JUNIO-JULIO-AGOSTO" → "2025-06-01"
function fechaDesdHoja(nombreHoja) {
  const anio = extraerAnio(nombreHoja);
  const lower = quitar_acentos(nombreHoja).toLowerCase();
  for (const [nombre, num] of Object.entries(MESES_FULL)) {
    if (lower.includes(nombre)) return `${anio}-${String(num).padStart(2,'0')}-01`;
  }
  return `${anio}-01-01`;
}

function mapearEstado(celda) {
  if (!celda && celda !== 0) return null;
  const s = String(celda).trim();
  if (!s) return null;

  const u = quitar_acentos(s).toUpperCase();

  let estado = 'OK';
  if (/\bNOK\b/.test(u))                           estado = 'NOK';
  else if (/BAJA|QUEMAD|DESTRUID|INUTILIZ/.test(u)) estado = 'NOK';
  else if (/REQUIERE|PIERDE|REVISAR|ATENCI/.test(u)) estado = 'requiere_atencion';
  else if (/FALTA/.test(u) && !/OK/.test(u))        estado = 'requiere_atencion';
  else if (/EN REPARACI|REPARANDO/.test(u))          estado = 'en_reparacion';
  else if (/NO FUNCIONA|NO ENCIENDE/.test(u))        estado = 'NOK';

  // Observaciones: eliminar prefijos redundantes
  let obs = s
    .replace(/^LIMPIO\s*[-–]\s*/i, '')
    .replace(/^LIMPIA\s*[-–]\s*/i, '')
    .replace(/^FUNCIONA\s*[-–]?\s*/i, '')
    .replace(/^CK\s*/i, '')
    .trim();
  if (/^OK$/i.test(obs)) obs = '';

  return { estado_general: estado, observaciones: obs || null };
}

function extraerAnio(nombreHoja) {
  const m = nombreHoja.match(/\b(20\d{2})\b/);
  return m ? parseInt(m[1]) : new Date().getFullYear();
}

function esPlanSheet(nombreHoja) {
  return /^plan/i.test(quitar_acentos(nombreHoja).trim());
}

// ── AUTO-DETECCIÓN DE COLUMNAS POR VALORES (más robusto que por cabecera) ──
const PAT_ESTADO = /^(OK|NOK|LIMPI[AO]|FUNCIONA|REQUIERE|EN REPARA|BAJA|NO FUNCIONA|HERRAMIENTA|CK)/i;

function detectarColumnaFecha(rows, headerIdx, anio, excluir) {
  const datos = rows.slice(headerIdx + 1, Math.min(rows.length, headerIdx + 15));
  for (let col = 0; col < (rows[headerIdx] || []).length; col++) {
    if (excluir.includes(col)) continue;
    let hits = 0;
    for (const row of datos) {
      if (parsearFecha(row[col], anio)) hits++;
    }
    if (hits >= 2) return col;
  }
  return -1;
}

function detectarColumnaEstado(rows, headerIdx, excluir) {
  const datos = rows.slice(headerIdx + 1, Math.min(rows.length, headerIdx + 15));
  for (let col = 0; col < (rows[headerIdx] || []).length; col++) {
    if (excluir.includes(col)) continue;
    let hits = 0;
    for (const row of datos) {
      if (PAT_ESTADO.test(String(row[col] || '').trim())) hits++;
    }
    if (hits >= 2) return col;
  }
  return -1;
}

// ── CARGAR MAPA DE EQUIPOS (codigo → id) ───────────────────────────────────
const equipoMap = {};
db.prepare('SELECT id, codigo FROM mant_equipos').all().forEach(e => {
  equipoMap[e.codigo.trim().toUpperCase()] = e.id;
});
console.log(`Equipos en DB: ${Object.keys(equipoMap).length}`);

const archivos = process.argv.slice(2);
if (!archivos.length) {
  console.error('\nUSO: node importar_form14.js <archivo.xlsx> [archivo2.xlsx ...]\n');
  process.exit(1);
}

// Normaliza el nombre de hoja para usarlo como clave de período
function normalizarPeriodo(s) {
  return quitar_acentos(s).toUpperCase().replace(/\s+/g, ' ').trim();
}

// ── FASE 1: RECOLECTAR TODOS LOS REGISTROS EN MEMORIA ──────────────────────
// Mapa para deduplicar: key = "equipoId_PERIODO" (período = nombre de hoja normalizado)
// Esto garantiza que 2026 nunca colisiona con 2025, aunque compartan equipo.
// En colisión se guarda el registro con fecha real (no fallback).
const mapaRegistros = new Map();
let totalSaltados = 0;

for (const archivo of archivos) {
  const rutaAbs = path.isAbsolute(archivo) ? archivo : path.resolve(process.cwd(), archivo);
  console.log(`\n══ Procesando: ${path.basename(rutaAbs)}`);

  let wb;
  try { wb = XLSX.readFile(rutaAbs, { cellDates: true }); }
  catch(e) { console.error(`  ERROR al leer archivo: ${e.message}`); continue; }

  for (const nombreHoja of wb.SheetNames) {
    if (esPlanSheet(nombreHoja)) { console.log(`  [SKIP] ${nombreHoja} (es hoja de plan)`); continue; }

    const anio = extraerAnio(nombreHoja);
    const ws   = wb.Sheets[nombreHoja];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false }); // raw:false para que xlsx convierta fechas

    // ── Detectar fila de cabecera buscando columna con códigos EQ-XXX ────────
    // Límite 100 filas: hojas 2026 del Form 14 tienen ~35 filas de encabezado del formulario
    const LIMITE_BUSQUEDA = Math.min(rows.length, 100);
    let headerIdx = -1, colCodigo = -1;
    outer:
    for (let i = 0; i < LIMITE_BUSQUEDA; i++) {
      for (let c = 0; c < rows[i].length; c++) {
        const cell = quitar_acentos(String(rows[i][c] || '')).toUpperCase().trim();
        if (!/^C[OÓ]DIGO/.test(cell) && cell !== 'CODIGO' && !/^COD\.?$/.test(cell)) continue;
        // Verificar que las filas siguientes tienen EQ-XXX en esa columna
        let tieneEq = false;
        for (let r2 = i+1; r2 < Math.min(rows.length, i+20); r2++) {
          if (/^EQ-\d+/.test(String(rows[r2][c]||'').trim().toUpperCase())) { tieneEq = true; break; }
        }
        if (!tieneEq) continue;
        headerIdx = i; colCodigo = c;
        break outer;
      }
    }

    // Si no encontró por cabecera, buscar la primera fila que tiene EQ-XXX en sus datos
    if (headerIdx === -1) {
      for (let i = 0; i < LIMITE_BUSQUEDA; i++) {
        for (let c = 0; c < rows[i].length; c++) {
          if (/^EQ-\d+/.test(String(rows[i][c]||'').trim().toUpperCase())) {
            headerIdx = i - 1 >= 0 ? i - 1 : 0;
            colCodigo = c;
            break;
          }
        }
        if (headerIdx !== -1) break;
      }
      if (headerIdx === 0 && /^EQ-\d+/.test(String(rows[0][colCodigo]||'').trim().toUpperCase())) {
        headerIdx = -1;
      }
    }

    if (colCodigo === -1) { console.log(`  [SKIP] ${nombreHoja} (columna código no encontrada)`); continue; }

    // ── Auto-detectar FECHA y ESTADO por valores ─────────────────────────────
    const excluirDeFecha  = [colCodigo];
    const colFecha        = detectarColumnaFecha(rows, Math.max(headerIdx,0), anio, excluirDeFecha);
    const excluirDeEstado = [colCodigo, colFecha].filter(x => x >= 0);
    const colEstado       = detectarColumnaEstado(rows, Math.max(headerIdx,0), excluirDeEstado);

    // Detección de UBICACIÓN por cabecera (más difícil por valores)
    let colUbicacion = -1, colEtiqueta = -1;
    if (headerIdx >= 0) {
      const hdr = rows[headerIdx].map(c => quitar_acentos(String(c)).toUpperCase().trim());
      colUbicacion = hdr.findIndex(c => /^UBICAC/.test(c) || /^PLANTA/.test(c) || /^SEDE/.test(c));
      colEtiqueta  = hdr.findIndex(c => /ETIQUETA/.test(c) || /IDENTIFIC/.test(c));
    }
    // Fallback ubicación por valores: columna que tiene MIGUENS/POGGIO
    if (colUbicacion === -1) {
      const datos = rows.slice(Math.max(headerIdx,0)+1, Math.min(rows.length, Math.max(headerIdx,0)+15));
      for (let col = 0; col < (rows[Math.max(headerIdx,0)] || []).length; col++) {
        if ([colCodigo, colFecha, colEstado].includes(col)) continue;
        let hits = 0;
        for (const row of datos) {
          if (/^(MIGUENS|POGGIO|DTO)/i.test(String(row[col]||'').trim())) hits++;
        }
        if (hits >= 2) { colUbicacion = col; break; }
      }
    }

    const fechaFallback = fechaDesdHoja(nombreHoja);
    console.log(`  [${nombreHoja}] año=${anio} cód:${colCodigo} estado:${colEstado} fecha:${colFecha} ubic:${colUbicacion}`);

    let insHoja = 0, saltHoja = 0;
    const dataStart = headerIdx >= 0 ? headerIdx + 1 : 0;

    for (let r = dataStart; r < rows.length; r++) {
      const row = rows[r];

      const codigoRaw = String(row[colCodigo] || '').trim().toUpperCase();
      const codigoMatch = codigoRaw.match(/^(EQ-\d+)/);
      if (!codigoMatch) { saltHoja++; continue; }

      const equipoId = equipoMap[codigoMatch[1]];
      if (!equipoId) { saltHoja++; continue; }

      // Fecha: columna detectada, o fallback al nombre de hoja
      const fechaReal = colFecha >= 0 ? parsearFecha(row[colFecha], anio) : null;
      const fecha     = fechaReal || fechaFallback;
      const esFallback = !fechaReal;

      // Estado
      let estadoData;
      if (colEstado >= 0 && String(row[colEstado]||'').trim()) {
        estadoData = mapearEstado(row[colEstado]);
      }
      if (!estadoData) estadoData = { estado_general: 'OK', observaciones: null };

      const ubicacion  = colUbicacion >= 0 ? (String(row[colUbicacion]||'').trim() || null) : null;
      const etiqueta   = colEtiqueta  >= 0 ? (String(row[colEtiqueta]||'').trim()  || null) : null;
      const etiquetaOk = etiqueta ? (/^(OK|SI|S[IÍ]|1|TRUE)/i.test(etiqueta) ? 1 : 0) : 1;

      // Deduplicar por equipo + período (nombre de hoja).
      // Si el mismo equipo ya fue registrado para este período pero con fecha fallback,
      // se reemplaza si ahora tenemos una fecha real.
      const clave = `${equipoId}_${normalizarPeriodo(nombreHoja)}`;
      const reg   = [equipoId, fecha, estadoData.estado_general, ubicacion, etiquetaOk, estadoData.observaciones, null];
      if (!mapaRegistros.has(clave)) {
        mapaRegistros.set(clave, reg);
        insHoja++;
      } else {
        const existente = mapaRegistros.get(clave);
        const existesFallback = existente[7]; // flag guardado en posición 7
        if (existesFallback && !esFallback) {
          // Reemplazar: el existente era fallback y tenemos fecha real
          mapaRegistros.set(clave, reg);
        }
        saltHoja++;
      }
      // Guardar flag de fallback en posición 7 (se elimina al construir registros finales)
      mapaRegistros.get(clave)[7] = esFallback;
    }

    totalSaltados += saltHoja;
    console.log(`  [${nombreHoja}] → ${insHoja} válidos, ${saltHoja} saltados/dup`);
  }
}

// ── FASE 2: REEMPLAZAR ATÓMICAMENTE (solo si hay datos) ─────────────────────
// Eliminar el flag de fallback (posición 7) antes de insertar
const registros = [...mapaRegistros.values()].map(r => r.slice(0, 7));

if (!registros.length) {
  console.error('\nERROR: No se encontraron registros válidos en los archivos.');
  console.error('La base de datos NO fue modificada.');
  process.exit(1);
}

console.log(`\nRegistros únicos recolectados: ${registros.length}`);
console.log('Reemplazando tabla mant_inspecciones...');

const ins = db.prepare(`
  INSERT INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones, responsable)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

db.transaction(() => {
  db.prepare('DELETE FROM mant_inspecciones').run();
  for (const r of registros) ins.run(...r);
})();

const final = db.prepare('SELECT COUNT(*) as c FROM mant_inspecciones').get().c;
console.log(`\n══════════════════════════════════════════`);
console.log(`Total insertados: ${registros.length}`);
console.log(`Total saltados/dup: ${totalSaltados}`);
console.log(`mant_inspecciones: ${final} registros`);
