'use strict'
const http = require('http')

const SERVIDOR = '10.1.1.10'
const PUERTO   = 3002
const USUARIO  = 'admin'
const PASSWORD = 'eintra2026'

const NUEVOS_EMPLEADOS = [
  { nombre: 'GUSTAVO VISNOVSKY',   tipo: 'interno' },
  { nombre: 'CLAUDIO ACOSTA',      tipo: 'interno' },
  { nombre: 'ANTONIO PALLADINO',   tipo: 'interno' },
  { nombre: 'MARCELO LUSSENHOFF',  tipo: 'interno' },
  { nombre: 'SILVIO LICENZIATO',   tipo: 'interno' },
]

const MAPPING = {
  'Andreina V.': 'VELAZQUEZ FERNANDEZ MAYRELIS ANDREINA',
  'Daniel R.'  : 'DANIEL RODRIGUEZ',
  'Fabian G.'  : 'FABIAN GARELLI',
  'Jose L.'    : 'JOSE LOPEZ',
  'Nicolas S.' : 'NICOLAS SAAVEDRA',
  'Gustavo V.' : 'GUSTAVO VISNOVSKY',
  'Claudio A.' : 'CLAUDIO ACOSTA',
  'Antonio P.' : 'ANTONIO PALLADINO',
  'Marcelo L.' : 'MARCELO LUSSENHOFF',
  'Silvio L.'  : 'SILVIO LICENZIATO',
}

const request = (method, path, body, token) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : ''
  const opts = {
    hostname: SERVIDOR, port: PUERTO, path, method,
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
      catch { resolve({ status: res.statusCode, body: buf }) }
    })
  })
  req.on('error', reject)
  if (data) req.write(data)
  req.end()
})

;(async () => {
  // Login
  console.log(`\n🔐 Conectando a ${SERVIDOR}:${PUERTO}...`)
  const login = await request('POST', '/api/v1/auth/login', { username: USUARIO, password: PASSWORD })
  if (login.status !== 200 || !login.body.token) {
    console.error('✗ Login fallido:', login.body); process.exit(1)
  }
  const token = login.body.token
  console.log('✔ Login OK')

  // Traer empleados existentes
  const empRes = await request('GET', '/api/v1/rrhh/empleados', null, token)
  const existentes = new Set((empRes.body || []).map(e => e.nombre?.toUpperCase()))

  // Agregar empleados faltantes
  console.log('\n👥 Verificando empleados...')
  for (const emp of NUEVOS_EMPLEADOS) {
    if (existentes.has(emp.nombre)) {
      console.log(`  ↷ Ya existe: ${emp.nombre}`)
      continue
    }
    const r = await request('POST', '/api/v1/rrhh/empleados', emp, token)
    if (r.status === 200 || r.status === 201) {
      console.log(`  ✔ Agregado: ${emp.nombre} (id ${r.body.id})`)
    } else {
      console.error(`  ✗ Error al agregar ${emp.nombre}:`, r.body)
    }
  }

  // Normalizar responsables en proyecto_documentos
  console.log('\n📝 Normalizando responsables en Form 30...')
  const norm = await request('POST', '/api/v1/proyectos/normalizar-responsables', { mapping: MAPPING }, token)
  if (norm.status !== 200) {
    console.error('✗ Error en normalización:', norm.body); process.exit(1)
  }
  console.log(`✔ Registros actualizados: ${norm.body.actualizados}`)
  console.log('\n✅ Listo.')
})()
