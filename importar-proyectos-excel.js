/**
 * Leer el Form 30 y enviar los proyectos al servidor ERP via HTTP.
 * Ejecutar con: node importar-proyectos-excel.js
 * No requiere better-sqlite3 ni acceso SSH al servidor.
 */
'use strict'
const http = require('http')
const XLSX = require('./backend/node_modules/xlsx')
const path = require('path')

const SERVIDOR  = '10.1.1.10'
const PUERTO    = 3002
const USUARIO   = 'admin'
const PASSWORD  = 'eintra2026'
const EXCEL     = path.resolve(__dirname, 'Form 30 rev_1 Control de info documentada de proyecto 2.xlsx')

// ── Parsear Excel ─────────────────────────────────────────────────────────────
const wb    = XLSX.readFile(EXCEL)
const HOJAS = wb.SheetNames.filter(s => s !== 'Proyecto' && s !== 'Selecciones')

const toDate = n => {
  if (typeof n !== 'number' || n < 40000) return ''
  const d = XLSX.SSF.parse_date_code(n)
  return d ? `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}` : ''
}

const proyMap = new Map()
const docsMap = new Map()

for (const hoja of HOJAS) {
  const ws   = wb.Sheets[hoja]
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

  let codigo = hoja, item_num = 1
  const m = hoja.match(/^(.+[A-Za-z])(\d)$/)
  if (m) { codigo = m[1]; item_num = parseInt(m[2]) }

  const descripcion = (data[3]?.[1] || '').replace(/\n/g, ' ').trim()
  const r3c2        = data[3]?.[2]
  const item_nombre = item_num === 1
    ? descripcion
    : (typeof r3c2 === 'string' && r3c2.includes('\n') ? r3c2.replace(/\n/g, ' ').trim() : descripcion)

  let cliente = ''
  if (typeof r3c2 === 'string' && !r3c2.includes('\n') && r3c2.trim()) cliente = r3c2.trim()
  if (!cliente) {
    const f5c2 = data[5]?.[2]
    if (f5c2 && typeof f5c2 === 'string' && !f5c2.includes('\n')) cliente = f5c2.trim()
  }

  const fechas = []; let cat = '', item = ''; const docs = []
  for (let i = 4; i < data.length; i++) {
    const r = data[i]
    if (r[0]) cat  = String(r[0]).trim()
    if (r[1]) item = String(r[1]).trim()
    const subitem = r[2] ? String(r[2]).trim() : ''
    const resp    = String(r[3] || '').trim()
    const aplica  = String(r[4] || '').trim()
    const estado  = String(r[5] || '').trim()
    if (typeof r[6] === 'number' && r[6] > 40000) fechas.push(r[6])
    if (typeof r[7] === 'number' && r[7] > 40000) fechas.push(r[7])
    if (resp || aplica)
      docs.push({ item_num, item_nombre, categoria: cat, item, subitem, responsable: resp,
                  aplica, estado, fecha_solicitado: toDate(r[6]), fecha_entregado: toDate(r[7]) })
  }

  const fMin = fechas.length ? toDate(Math.min(...fechas)) : ''
  const fMax = fechas.length ? toDate(Math.max(...fechas)) : ''

  if (!proyMap.has(codigo)) proyMap.set(codigo, { nombre: codigo, descripcion, cliente, fecha_inicio: fMin, fecha_fin_est: fMax })
  else {
    const ex = proyMap.get(codigo)
    if (!ex.cliente && cliente) ex.cliente = cliente
    if (fMin && (!ex.fecha_inicio  || fMin < ex.fecha_inicio))  ex.fecha_inicio  = fMin
    if (fMax && (!ex.fecha_fin_est || fMax > ex.fecha_fin_est)) ex.fecha_fin_est = fMax
  }
  if (!docsMap.has(codigo)) docsMap.set(codigo, [])
  docsMap.get(codigo).push(...docs)
}

const inferirEstado = docs => {
  const aplican = docs.filter(d => d.aplica.toLowerCase() === 'aplica')
  const hechos  = aplican.filter(d => d.estado.toLowerCase().includes('realizado'))
  return (aplican.length && hechos.length === aplican.length) ? 'Completado' : 'Activo'
}

const proyectos = []
proyMap.forEach((info, codigo) => {
  const docs = docsMap.get(codigo) || []
  proyectos.push({ ...info, codigo, estado: inferirEstado(docs), docs })
})

console.log(`\n📋 Proyectos a importar: ${proyectos.length}`)
proyectos.forEach(p => console.log(`  ${p.codigo.padEnd(12)} ${p.cliente || '(sin cliente)'}`))

// ── Helpers HTTP ──────────────────────────────────────────────────────────────
const postJSON = (path, body, token) => new Promise((resolve, reject) => {
  const data = JSON.stringify(body)
  const opts = {
    hostname: SERVIDOR, port: PUERTO, path, method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  }
  const req = http.request(opts, res => {
    let buf = ''
    res.on('data', c => buf += c)
    res.on('end', () => {
      try { resolve({ status: res.statusCode, body: JSON.parse(buf) }) }
      catch(e) { resolve({ status: res.statusCode, body: buf }) }
    })
  })
  req.on('error', reject)
  req.write(data); req.end()
})

// ── Login y envío ─────────────────────────────────────────────────────────────
;(async () => {
  console.log(`\n🔐 Conectando a ${SERVIDOR}:${PUERTO}...`)
  const login = await postJSON('/api/v1/auth/login', { username: USUARIO, password: PASSWORD })
  if (login.status !== 200 || !login.body.token) {
    console.error('✗ Login fallido:', login.body)
    process.exit(1)
  }
  const token = login.body.token
  console.log('✔ Login OK')

  console.log('\n📤 Enviando proyectos al servidor...')
  const result = await postJSON('/api/v1/proyectos/importar', { proyectos }, token)
  if (result.status !== 200) {
    console.error('✗ Error en importación:', result.body)
    process.exit(1)
  }
  const r = result.body
  console.log(`\n✔ Importación completada:`)
  console.log(`  Proyectos creados : ${r.creados}`)
  console.log(`  Ya existían       : ${r.omitidos}`)
  console.log(`  Documentos Form30 : ${r.docs_total}`)
})()
