'use strict'
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') })
const path = require('path')
const XLSX = require('xlsx')
const { db, inicializar } = require('../db/database')

inicializar()

const EXCEL = path.resolve(__dirname, '../../Form 30 rev_1 Control de info documentada de proyecto 2.xlsx')
const wb    = XLSX.readFile(EXCEL)
const HOJAS = wb.SheetNames.filter(s => s !== 'Proyecto' && s !== 'Selecciones')

const toDate = n => {
  if (typeof n !== 'number' || n < 40000) return ''
  const d = XLSX.SSF.parse_date_code(n)
  return d ? `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}` : ''
}

// ── Extraer datos de cada hoja ────────────────────────────────────────────────
const proyMap = new Map() // codigo_base → { nombre, cliente, fecha_inicio, fecha_fin_est }
const docsMap = new Map() // codigo_base → [ docItem, ... ]

for (const hoja of HOJAS) {
  const ws   = wb.Sheets[hoja]
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

  // Código base e item_num (NIKIT005C1 → base=NIKIT005C, num=1)
  let codigo = hoja, item_num = 1
  const m = hoja.match(/^(.+[A-Za-z])(\d)$/)
  if (m) { codigo = m[1]; item_num = parseInt(m[2]) }

  // El nombre del proyecto ES el nombre de la hoja; el texto largo va a descripcion
  const nombre      = codigo   // nombre = código base (ej: MIRGO001C)
  const descripcion = (data[3]?.[1] || '').replace(/\n/g, ' ').trim()
  const r3c2        = data[3]?.[2]
  const item_nombre = item_num === 1
    ? descripcion
    : (typeof r3c2 === 'string' && r3c2.includes('\n') ? r3c2.replace(/\n/g, ' ').trim() : descripcion)

  // Cliente: row3_col2 solo si es string corto sin salto de línea, sino row5_col2
  let cliente = ''
  if (typeof r3c2 === 'string' && !r3c2.includes('\n') && r3c2.trim()) {
    cliente = r3c2.trim()
  }
  if (!cliente) {
    const f5c2 = data[5]?.[2]
    if (f5c2 && typeof f5c2 === 'string' && !f5c2.includes('\n')) cliente = f5c2.trim()
  }

  // Ítems del Form 30
  const fechas = []
  let cat = '', item = ''
  const docs = []
  for (let i = 4; i < data.length; i++) {
    const r = data[i]
    if (r[0]) cat  = String(r[0]).trim()
    if (r[1]) item = String(r[1]).trim()
    const subitem = r[2] ? String(r[2]).trim() : ''
    const resp    = String(r[3] || '').trim()
    const aplica  = String(r[4] || '').trim()
    const estado  = String(r[5] || '').trim()
    const fSol    = toDate(r[6])
    const fEnt    = toDate(r[7])
    if (typeof r[6] === 'number' && r[6] > 40000) fechas.push(r[6])
    if (typeof r[7] === 'number' && r[7] > 40000) fechas.push(r[7])
    if (resp || aplica) {
      docs.push({ item_num, item_nombre, categoria: cat, item, subitem, responsable: resp, aplica, estado, fecha_solicitado: fSol, fecha_entregado: fEnt })
    }
  }

  const fMin = fechas.length ? toDate(Math.min(...fechas)) : ''
  const fMax = fechas.length ? toDate(Math.max(...fechas)) : ''

  if (!proyMap.has(codigo)) {
    proyMap.set(codigo, { nombre, descripcion, cliente, fecha_inicio: fMin, fecha_fin_est: fMax })
  } else {
    const ex = proyMap.get(codigo)
    if (!ex.cliente && cliente) ex.cliente = cliente
    if (fMin && (!ex.fecha_inicio  || fMin < ex.fecha_inicio))    ex.fecha_inicio  = fMin
    if (fMax && (!ex.fecha_fin_est || fMax > ex.fecha_fin_est))   ex.fecha_fin_est = fMax
  }
  if (!docsMap.has(codigo)) docsMap.set(codigo, [])
  docsMap.get(codigo).push(...docs)
}

const inferirEstado = docs => {
  const aplican = docs.filter(d => d.aplica.toLowerCase() === 'aplica')
  const hechos  = aplican.filter(d => d.estado.toLowerCase().includes('realizado'))
  if (aplican.length === 0) return 'Activo'
  return hechos.length === aplican.length ? 'Completado' : 'Activo'
}

// ── Insertar en DB ────────────────────────────────────────────────────────────
const insP = db.prepare(`
  INSERT OR IGNORE INTO proyectos (codigo, nombre, descripcion, cliente_nombre, fecha_inicio, fecha_fin_est, estado, created_by)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1)
`)
const insD = db.prepare(`
  INSERT INTO proyecto_documentos
    (proyecto_id, item_num, item_nombre, categoria, item, subitem, responsable, aplica, estado, fecha_solicitado, fecha_entregado)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`)

let creados = 0, docs_importados = 0

db.transaction(() => {
  for (const [codigo, info] of proyMap) {
    const docs   = docsMap.get(codigo) || []
    const estado = inferirEstado(docs)
    const r = insP.run(codigo, info.nombre, info.descripcion, info.cliente, info.fecha_inicio, info.fecha_fin_est, estado)
    if (r.changes) {
      creados++
      const pid = r.lastInsertRowid
      for (const d of docs) {
        insD.run(pid, d.item_num, d.item_nombre, d.categoria, d.item, d.subitem, d.responsable, d.aplica, d.estado, d.fecha_solicitado, d.fecha_entregado)
        docs_importados++
      }
    }
  }
})()

console.log(`✔ Proyectos creados: ${creados}`)
console.log(`✔ Documentos Form 30 importados: ${docs_importados}`)
proyMap.forEach((v,k) => console.log(`  ${k} → ${v.nombre.slice(0,45).padEnd(46)} | ${v.cliente}`))
