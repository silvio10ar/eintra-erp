'use strict'
const http = require('http')

const SERVIDOR = '10.1.1.10'
const PUERTO   = 3002
const USUARIO  = 'admin'
const PASSWORD = 'eintra2026'

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
  console.log(`Conectando a ${SERVIDOR}:${PUERTO}...`)
  const login = await request('POST', '/api/v1/auth/login', { username: USUARIO, password: PASSWORD })
  if (login.status !== 200 || !login.body.token) {
    console.error('Login fallido:', login.body); process.exit(1)
  }
  const token = login.body.token
  console.log('Login OK')

  // Obtener todos los productos de ROKER
  const res = await request('GET', '/api/v1/stock/productos?buscar=', null, token)
  if (res.status !== 200) { console.error('Error al obtener productos:', res.body); process.exit(1) }

  // Filtrar los que tienen codigo de Roker (no E-INTRA: no empieza con 9A0R4)
  const erroneos = res.body.filter(p =>
    p.proveedor === 'ROKER' && !p.codigo.startsWith('9A0R4')
  )

  if (erroneos.length === 0) {
    console.log('No se encontraron productos con codigo Roker erroneo. Nada que limpiar.')
    return
  }

  console.log(`\nEncontrados ${erroneos.length} productos a eliminar:`)
  erroneos.forEach(p => console.log(`  [${p.id}] ${p.codigo} — ${p.descripcion}`))

  console.log('\nEliminando...')
  let ok = 0, err = 0
  for (const prod of erroneos) {
    const r = await request('DELETE', `/api/v1/stock/productos/${prod.id}`, null, token)
    if (r.status === 200) { ok++; process.stdout.write('.') }
    else { err++; console.error(`\nError al eliminar ${prod.codigo}: ${JSON.stringify(r.body)}`) }
  }

  console.log(`\n\nEliminados: ${ok}  Errores: ${err}`)
  console.log('Listo. Ahora puede ejecutar node importar-roker-gabinetes.js para cargar con codigos E-INTRA correctos.')
})()
