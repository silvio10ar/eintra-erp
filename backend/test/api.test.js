'use strict'
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const jwt = require('jsonwebtoken')

// Pruebas de integración de punta a punta: levantan el server real contra una
// base descartable (nunca la de desarrollo/producción) y lo apagan al terminar.
const DB_PATH      = path.join(__dirname, '_test_api.db')
const UPLOADS_PATH = path.join(__dirname, '_test_uploads')
const PORT       = 3199
const JWT_SECRET = 'test_secret_solo_para_pruebas'
const BASE       = `http://localhost:${PORT}/api/v1`

let proc

function tok(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' })
}

function limpiarDb() {
  for (const ext of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(DB_PATH + ext) } catch (_) {}
  }
  try { fs.rmSync(UPLOADS_PATH, { recursive: true, force: true }) } catch (_) {}
}

before(async () => {
  limpiarDb()
  proc = spawn(process.execPath, ['server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, DB_PATH, UPLOADS_PATH, JWT_SECRET, NODE_ENV: 'test', PORT: String(PORT) },
    stdio: 'pipe',
  })
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${BASE}/health`)
      if (r.ok) return
    } catch (_) {}
    await new Promise(res => setTimeout(res, 300))
  }
  throw new Error('El servidor de prueba no arrancó a tiempo')
})

after(async () => {
  await new Promise(res => { proc.once('exit', res); proc.kill() })
  limpiarDb()
})

test('health check responde ok', async () => {
  const r = await fetch(`${BASE}/health`)
  assert.equal(r.status, 200)
  const body = await r.json()
  assert.equal(body.ok, true)
})

test('login con usuario inexistente responde 401', async () => {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'no_existe_xyz', password: 'cualquiera' }),
  })
  assert.equal(r.status, 401)
})

test('login falla 8 veces seguidas: la 9na queda bloqueada por rate-limit', async () => {
  let ultimo
  for (let i = 0; i < 9; i++) {
    ultimo = await fetch(`${BASE}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'rate_limit_test_user', password: 'mal' }),
    })
  }
  assert.equal(ultimo.status, 429)
})

test('ruta protegida sin token responde 401', async () => {
  const r = await fetch(`${BASE}/stock/productos`)
  assert.equal(r.status, 401)
})

test('token valido sin permiso de modulo responde 403', async () => {
  const t = tok({ id: 999999, username: 'sinpermiso', nombre: 'Sin Permiso', rol: 'solo_lectura' })
  const r = await fetch(`${BASE}/stock/productos`, { headers: { Authorization: `Bearer ${t}` } })
  assert.equal(r.status, 403)
})

test('admin puede leer stock/productos', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })
  const r = await fetch(`${BASE}/stock/productos`, { headers: { Authorization: `Bearer ${t}` } })
  assert.equal(r.status, 200)
})

test('alta de OC de compras (admin) crea la orden con sus items', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })
  const r = await fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proveedor_nombre: 'Proveedor Test', fecha: '2026-01-01', moneda: 'PESOS',
      items: [{ descripcion: 'item de prueba', cantidad: 1, precio_unitario: 100, precio_final: 100 }],
    }),
  })
  assert.equal(r.status, 201)
  const body = await r.json()
  assert.ok(body.id)
  assert.equal(body.items.length, 1)
})

test('alta de factura de compra con Form49: queda todo o nada (transacción)', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })
  const r = await fetch(`${BASE}/facturas/guardar-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      numero: 'TEST-0001', fecha: '2026-01-01', proveedor_nombre: 'Proveedor Test', importe: 100,
      crear_f49: true, f49_items: [{ descripcion: 'item de prueba', cantidad: 1, precio_final: 100 }],
    }),
  })
  assert.equal(r.status, 201)
  const body = await r.json()
  assert.ok(body.id)
  assert.ok(body.f49_numero)
})

test('Mi Parte: un usuario sin permiso de rrhh/partes igual puede leer categorias/proyectos/actividades', async () => {
  // Regresión: estas rutas alimentan el autoservicio "Mi Parte" de cualquier
  // empleado y no deben depender del permiso de módulo rrhh/partes.
  const t = tok({ id: 999998, username: 'sin_rrhh', nombre: 'Sin RRHH', rol: 'solo_lectura' })
  for (const ruta of ['categorias', 'proyectos', 'actividades']) {
    const r = await fetch(`${BASE}/rrhh/${ruta}`, { headers: { Authorization: `Bearer ${t}` } })
    assert.equal(r.status, 200, `GET /rrhh/${ruta} debería ser 200 sin permiso de módulo`)
  }
})

test('control de documentos de calidad: crear, subir revision, historial y descarga', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })
  const contenidoV0 = '%PDF-1.4 contenido rev0 de prueba'
  const contenidoV1 = '%PDF-1.4 contenido rev1 corregido'

  const fd0 = new FormData()
  fd0.append('codigo', 'TEST-DOC')
  fd0.append('titulo', 'Documento de prueba')
  fd0.append('categoria', 'Procedimiento')
  fd0.append('archivo', new Blob([contenidoV0], { type: 'application/pdf' }), 'v0.pdf')
  const rCrear = await fetch(`${BASE}/calidad/documentos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}` }, body: fd0,
  })
  assert.equal(rCrear.status, 201)
  const { id: idV0 } = await rCrear.json()

  const fd1 = new FormData()
  fd1.append('observaciones', 'corrección de prueba')
  fd1.append('archivo', new Blob([contenidoV1], { type: 'application/pdf' }), 'v1.pdf')
  const rRevision = await fetch(`${BASE}/calidad/documentos/TEST-DOC/revision`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}` }, body: fd1,
  })
  assert.equal(rRevision.status, 201)
  const { id: idV1, revision } = await rRevision.json()
  assert.equal(revision, 1)

  const listado = await fetch(`${BASE}/calidad/documentos`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  const vigente = listado.find(d => d.codigo === 'TEST-DOC')
  assert.equal(vigente.revision, 1)
  assert.equal(vigente.revisiones_anteriores, 1)

  const historial = await fetch(`${BASE}/calidad/documentos/TEST-DOC/historial`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.equal(historial.find(h => h.id === idV0).estado, 'Obsoleto')
  assert.equal(historial.find(h => h.id === idV1).estado, 'Vigente')

  const archivo = await fetch(`${BASE}/calidad/documentos/${idV1}/archivo`, { headers: { Authorization: `Bearer ${admin}` } })
  assert.equal(await archivo.text(), contenidoV1)

  // Lectura abierta a cualquier autenticado, escritura sí requiere calidad.escribir
  const sinPermiso = tok({ id: 999996, username: 'sin_calidad', nombre: 'Sin Calidad', rol: 'solo_lectura' })
  const lecturaAbierta = await fetch(`${BASE}/calidad/documentos`, { headers: { Authorization: `Bearer ${sinPermiso}` } })
  assert.equal(lecturaAbierta.status, 200)
  const fdBloqueado = new FormData()
  fdBloqueado.append('codigo', 'OTRO')
  fdBloqueado.append('titulo', 'No debería crearse')
  fdBloqueado.append('archivo', new Blob(['x'], { type: 'application/pdf' }), 'x.pdf')
  const escrituraBloqueada = await fetch(`${BASE}/calidad/documentos`, {
    method: 'POST', headers: { Authorization: `Bearer ${sinPermiso}` }, body: fdBloqueado,
  })
  assert.equal(escrituraBloqueada.status, 403)
})

test('estructura organizacional: puesto con jerarquia y organigrama sin exponer permisos', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })
  const gerente = await fetch(`${BASE}/auth/puestos`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Gerente Test Suite', area: 'Dirección', modulos: {} }),
  }).then(r => r.json())

  const sub = await fetch(`${BASE}/auth/puestos`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nombre: 'Subordinado Test Suite', area: 'Ventas', reporta_a_id: gerente.id,
      modulos: { ventas: { leer: true, escribir: true } },
    }),
  }).then(r => r.json())

  const org = await fetch(`${BASE}/rrhh/organigrama`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  const nodoSub = org.find(p => p.id === sub.id)
  assert.equal(nodoSub.reporta_a_id, gerente.id)
  assert.equal('modulos' in nodoSub, false, 'el organigrama no debe exponer permisos de sistema')
})
