'use strict'
const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const jwt = require('jsonwebtoken')
const Database = require('better-sqlite3')
const XLSX = require('xlsx')
const { hoyArgentina, fechaArgentinaHace } = require('../helpers/fecha')

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

test('Stock: los contadores de la barra de estado reflejan el catálogo completo sin traer las filas', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const antes = await fetch(`${BASE}/stock/productos/contadores`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())

  await fetch(`${BASE}/stock/productos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'CONTADOR-DISP', descripcion: 'Contador disponible', stock_actual: 5 }),
  })
  await fetch(`${BASE}/stock/productos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'CONTADOR-AGOT', descripcion: 'Contador agotado', stock_actual: 0 }),
  })
  await fetch(`${BASE}/stock/productos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'CONTADOR-BAJO', descripcion: 'Contador stock bajo', stock_actual: 2, stock_minimo: 5 }),
  })

  const despues = await fetch(`${BASE}/stock/productos/contadores`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.equal(despues.total, antes.total + 3)
  assert.equal(despues.disponibles, antes.disponibles + 2, 'CONTADOR-DISP y CONTADOR-BAJO tienen stock > 0')
  assert.equal(despues.agotados, antes.agotados + 1)
  assert.equal(despues.stockBajo, antes.stockBajo + 1)
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

test('selector de OC en facturas de compra: excluye las que ya completaron su ciclo (facturadas por el total)', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })
  const crearOC = async () => fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proveedor_nombre: 'Proveedor OC Test', fecha: '2026-01-01', moneda: 'PESOS',
      items: [{ descripcion: 'item de prueba', cantidad: 1, precio_unitario: 1000, precio_final: 1000 }],
    }),
  }).then(r => r.json())

  const ocCompleta = await crearOC()
  const ocParcial   = await crearOC()

  // Factura por el total del neto → esa OC completó su ciclo
  await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'OC-TEST-0001', fecha: '2026-01-02', proveedor_nombre: 'Proveedor OC Test', oc_id: ocCompleta.id, oc_numero: ocCompleta.numero, neto_gravado: 1000, importe: 1000, moneda: 'PESO' }),
  })
  // Factura parcial → esa OC sigue con saldo para facturar
  await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'OC-TEST-0002', fecha: '2026-01-02', proveedor_nombre: 'Proveedor OC Test', oc_id: ocParcial.id, oc_numero: ocParcial.numero, neto_gravado: 400, importe: 400, moneda: 'PESO' }),
  })

  const r = await fetch(`${BASE}/compras/oc?excluirFacturadas=1&limit=5000`, { headers: { Authorization: `Bearer ${t}` } })
  assert.equal(r.status, 200)
  const { datos } = await r.json()
  const numeros = datos.map(o => o.numero)
  assert.ok(numeros.includes(ocParcial.numero), 'la OC parcialmente facturada debe seguir apareciendo')
  assert.ok(!numeros.includes(ocCompleta.numero), 'la OC ya facturada por el total no debe aparecer para elegir en una factura nueva')
})

test('seguimiento OC compras: trae todas las OC (recibidas o no) con su estado de facturación y de pago', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })
  const crearOC = async () => fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proveedor_nombre: 'Proveedor Seguimiento Test', fecha: '2026-01-01', moneda: 'PESOS',
      items: [{ descripcion: 'item de prueba', cantidad: 1, precio_unitario: 1000, precio_final: 1000 }],
    }),
  }).then(r => r.json())
  const crearFactura = async (oc, neto) => fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: `SEG-${oc.numero}`, fecha: '2026-01-02', proveedor_nombre: 'Proveedor Seguimiento Test', oc_id: oc.id, oc_numero: oc.numero, neto_gravado: neto, importe: neto, moneda: 'PESO' }),
  }).then(r => r.json())

  const ocSinFacturar = await crearOC()
  const ocPendientePago = await crearOC()
  const ocPagada = await crearOC()

  await crearFactura(ocPendientePago, 400)
  const facturaPagada = await crearFactura(ocPagada, 1000)
  await fetch(`${BASE}/finanzas/facturas-compra/pago`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fuente: 'manual', id: facturaPagada.id, pago_confirmado: true }),
  })

  const r = await fetch(`${BASE}/finanzas/seguimiento-oc-compras?buscar=${encodeURIComponent('Proveedor Seguimiento Test')}`, { headers: { Authorization: `Bearer ${t}` } })
  assert.equal(r.status, 200)
  const datos = await r.json()
  const porId = id => datos.find(d => d.oc_id === id)

  const filaSinFacturar = porId(ocSinFacturar.id)
  assert.equal(filaSinFacturar.estado_facturacion, 'sin_facturar')
  assert.equal(filaSinFacturar.estado_pago, 'sin_facturar')
  assert.equal(filaSinFacturar.pct_facturado, 0)
  assert.equal(filaSinFacturar.pct_pagado, 0)

  const filaPendiente = porId(ocPendientePago.id)
  assert.equal(filaPendiente.estado_facturacion, 'parcial')
  assert.equal(filaPendiente.estado_pago, 'pendiente')
  assert.equal(filaPendiente.pct_facturado, 40, 'se facturaron 400 de 1000 -> 40%')
  assert.equal(filaPendiente.pct_pagado, 0, 'todavía no se pagó nada')

  const filaPagada = porId(ocPagada.id)
  assert.equal(filaPagada.estado_facturacion, 'completo')
  assert.equal(filaPagada.estado_pago, 'pagado')
  assert.equal(filaPagada.pct_facturado, 100)
  assert.equal(filaPagada.pct_pagado, 100, 'la única factura ya está pagada -> 100%')

  const rSinPermiso = await fetch(`${BASE}/finanzas/seguimiento-oc-compras`, { headers: { Authorization: `Bearer ${tok({ id: 999995, username: 'sin_finanzas', nombre: 'Sin Finanzas', rol: 'solo_lectura' })}` } })
  assert.equal(rSinPermiso.status, 403, 'el seguimiento gerencial es exclusivo de finanzas, no de administracion')
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
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })
  const nuevo = await fetch(`${BASE}/auth/usuarios`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'sin_rrhh', nombre: 'Sin RRHH', password: 'test1234', rol: 'solo_lectura' }),
  }).then(r => r.json())
  const t = tok({ id: nuevo.id, username: 'sin_rrhh', nombre: 'Sin RRHH', rol: 'solo_lectura' })
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
  const nuevoSinCalidad = await fetch(`${BASE}/auth/usuarios`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'sin_calidad', nombre: 'Sin Calidad', password: 'test1234', rol: 'solo_lectura' }),
  }).then(r => r.json())
  const sinPermiso = tok({ id: nuevoSinCalidad.id, username: 'sin_calidad', nombre: 'Sin Calidad', rol: 'solo_lectura' })
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

test('objetivos de calidad: fuente automática calcula el % en vivo, manual no admite carga en fuente automática', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })
  const hoy = hoyArgentina()

  // Una NC cerrada en plazo, otra cerrada fuera de plazo. El PUT reenvía el
  // objeto completo (fecha incluida) porque la ruta real no mergea con la fila
  // existente — igual que hace siempre el formulario real de Calidad.jsx.
  for (const [limite, cierre] of [[hoy, hoy], ['2000-01-01', '2099-01-01']]) {
    const nc = await fetch(`${BASE}/calidad/no-conformidades`, {
      method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fecha: hoy, descripcion: 'NC test objetivos', fecha_limite: limite }),
    }).then(r => r.json())
    await fetch(`${BASE}/calidad/no-conformidades/${nc.id}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fecha: hoy, descripcion: 'NC test objetivos', fecha_limite: limite, fecha_cierre: cierre, estado: 'Cerrada' }),
    })
  }

  const obj = await fetch(`${BASE}/calidad/objetivos`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'NC en plazo (test suite)', fuente: 'nc_cerradas_plazo', meta: 80, periodicidad: 'mensual' }),
  }).then(r => r.json())

  const lista = await fetch(`${BASE}/calidad/objetivos`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  const encontrado = lista.find(o => o.id === obj.id)
  assert.equal(encontrado.valor_actual, 50, 'debería calcular 1 de 2 NC cerradas en plazo = 50%')

  const medicionRechazada = await fetch(`${BASE}/calidad/objetivos/${obj.id}/medicion`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ periodo: '2026-07', valor: 100 }),
  })
  assert.equal(medicionRechazada.status, 400, 'un objetivo de fuente automática no debe aceptar carga manual')

  // Objetivo manual: la misma medición cargada dos veces no debe duplicar (upsert)
  const objManual = await fetch(`${BASE}/calidad/objetivos`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Manual (test suite)', fuente: 'manual', meta: 5, periodicidad: 'anual' }),
  }).then(r => r.json())
  await fetch(`${BASE}/calidad/objetivos/${objManual.id}/medicion`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ periodo: '2026', valor: 3 }),
  })
  await fetch(`${BASE}/calidad/objetivos/${objManual.id}/medicion`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ periodo: '2026', valor: 7 }),
  })
  const serieManual = await fetch(`${BASE}/calidad/objetivos/${objManual.id}/serie`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  assert.equal(serieManual.length, 1, 'cargar el mismo período dos veces debe actualizar, no duplicar')
  assert.equal(serieManual[0].valor, 7)
})

test('fusión de proveedores es exclusiva de admin; evaluación de proveedores pasó a depender de "calidad"', async () => {
  // Un usuario no-admin no debe poder fusionar proveedores aunque su rol/puesto
  // fuera "Gerente de Compras" — antes bastaba con el permiso compras_fusion o
  // administracion.escribir, ahora la ruta solo mira req.usuario.rol === 'admin'.
  const gerenteCompras = tok({ id: 999995, username: 'gerente_test', nombre: 'Gerente Test', rol: 'compras' })
  const rFusion = await fetch(`${BASE}/compras/proveedores/fusiones/todos`, { headers: { Authorization: `Bearer ${gerenteCompras}` } })
  assert.equal(rFusion.status, 403, 'un no-admin no debe poder listar candidatos a fusión')

  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })
  const rFusionAdmin = await fetch(`${BASE}/compras/proveedores/fusiones/todos`, { headers: { Authorization: `Bearer ${admin}` } })
  assert.equal(rFusionAdmin.status, 200, 'admin sí debe poder listar candidatos a fusión')

  // Evaluación de proveedores: un usuario con "compras" ya no alcanza, necesita "calidad"
  const soloCompras = tok({ id: 999994, username: 'compras_test', nombre: 'Compras Test', rol: 'compras' })
  const rEvalCompras = await fetch(`${BASE}/evaluaciones/proveedor/1`, { headers: { Authorization: `Bearer ${soloCompras}` } })
  assert.equal(rEvalCompras.status, 403, 'compras ya no debe dar acceso a evaluación de proveedores')
})

test('Administración: la secretaria (permiso solo "administracion") puede leer facturas/saldos/tipo de cambio/servicios/control OC/clientes, pero no el dashboard gerencial', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })
  const nuevo = await fetch(`${BASE}/auth/usuarios`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'secretaria_test', nombre: 'Secretaria Test', password: 'test1234', rol: 'solo_lectura' }),
  }).then(r => r.json())
  await fetch(`${BASE}/auth/usuarios/${nuevo.id}/permisos`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ administracion: { leer: true, escribir: true } }),
  })

  const secretaria = tok({ id: nuevo.id, username: 'secretaria_test', nombre: 'Secretaria Test', rol: 'solo_lectura' })
  for (const ruta of ['facturas-compra', 'facturas-venta', 'saldo-bancario', 'tipo-cambio', 'servicios', 'control-oc']) {
    const r = await fetch(`${BASE}/finanzas/${ruta}`, { headers: { Authorization: `Bearer ${secretaria}` } })
    assert.equal(r.status, 200, `GET /finanzas/${ruta} debería ser 200 con solo permiso de administracion`)
  }
  const rDash = await fetch(`${BASE}/finanzas/dashboard`, { headers: { Authorization: `Bearer ${secretaria}` } })
  assert.equal(rDash.status, 403, 'el dashboard gerencial no debe abrirse solo con permiso de administracion')

  const rClientes = await fetch(`${BASE}/ventas/clientes`, { headers: { Authorization: `Bearer ${secretaria}` } })
  assert.equal(rClientes.status, 200, 'la pestaña Clientes de Administración exigía solo el permiso "ventas" para leer, mismo bug que finanzas')

  const rOC = await fetch(`${BASE}/compras/oc?limit=500`, { headers: { Authorization: `Bearer ${secretaria}` } })
  assert.equal(rOC.status, 200, 'el selector de OC en Facturas de Compra exigía permiso de "compras", la secretaria solo tiene "administracion"')
})

test('OC Clientes: cuotas variables, vincular factura calcula estado, y permite compartir una factura entre cuotas de la MISMA OC pero no de otra', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const oc = await fetch(`${BASE}/finanzas/oc-clientes`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cliente: 'Cliente Cuotas Test', numero_oc: 'OCV-CUOTAS-1', monto_oc: 10000, fecha_oc: '2026-01-01',
      cuotas: [
        { tipo: 'anticipo', pct: 30, monto_planeado: 3000 },
        { tipo: 'saldo_final', pct: 70, monto_planeado: 7000 },
      ],
    }),
  }).then(r => r.json())
  assert.equal(oc.cuotas.length, 2, 'la OC debe guardar las 2 cuotas enviadas')

  const facturaA = await fetch(`${BASE}/finanzas/facturas-venta`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'CUOTA-TEST-A', fecha: '2026-01-05', cliente_nombre: 'Cliente Cuotas Test', importe: 10000, moneda: 'DÓLAR' }),
  }).then(r => r.json())

  const cuotaAnticipo = oc.cuotas.find(c => c.tipo === 'anticipo')
  const cuotaFinal = oc.cuotas.find(c => c.tipo === 'saldo_final')

  // Caso real: se factura el 100% en una sola factura, pero el cliente la
  // paga en cuotas — ambas cuotas de ESTA OC comparten la misma factura.
  const rVinc1 = await fetch(`${BASE}/finanzas/oc-clientes/${oc.id}/cuotas/${cuotaAnticipo.id}/vincular-factura`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ factura_id: facturaA.id }),
  })
  assert.equal(rVinc1.status, 200)

  const rVinc2 = await fetch(`${BASE}/finanzas/oc-clientes/${oc.id}/cuotas/${cuotaFinal.id}/vincular-factura`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ factura_id: facturaA.id }),
  })
  assert.equal(rVinc2.status, 200, 'dos cuotas de la MISMA OC deben poder compartir la misma factura')

  // Marcar cobrada solo la cuota del anticipo — cada cuota se cobra en un
  // momento distinto aunque compartan factura.
  const rCobro = await fetch(`${BASE}/finanzas/oc-clientes/${oc.id}/cuotas/${cuotaAnticipo.id}/cobro`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fecha_cobro: '2026-01-20' }),
  })
  assert.equal(rCobro.status, 200)

  const listaTrasVincular = await fetch(`${BASE}/finanzas/oc-clientes?buscar=OCV-CUOTAS-1`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  const ocCargada = listaTrasVincular.find(o => o.id === oc.id)
  const cuotaAnticipoCargada = ocCargada.cuotas.find(c => c.tipo === 'anticipo')
  const cuotaFinalCargada = ocCargada.cuotas.find(c => c.tipo === 'saldo_final')
  assert.equal(cuotaAnticipoCargada.factura_numero, 'CUOTA-TEST-A', 'la cuota debe traer los datos de la factura vinculada, no una copia')
  assert.equal(cuotaFinalCargada.factura_numero, 'CUOTA-TEST-A', 'ambas cuotas deben compartir la misma factura vinculada')
  assert.equal(cuotaAnticipoCargada.fecha_cobro, '2026-01-20', 'la cuota del anticipo debe quedar marcada como cobrada')
  assert.equal(cuotaFinalCargada.fecha_cobro, '', 'la cuota del saldo final no debe quedar cobrada solo porque comparte factura')

  // Otra OC (de otro cliente) no puede tomar la misma factura para una cuota propia.
  const oc2 = await fetch(`${BASE}/finanzas/oc-clientes`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cliente: 'Otro Cliente', numero_oc: 'OCV-CUOTAS-2', monto_oc: 5000, fecha_oc: '2026-01-01',
      cuotas: [{ tipo: 'unico', pct: 100, monto_planeado: 5000 }],
    }),
  }).then(r => r.json())
  const rConflictoCrossOC = await fetch(`${BASE}/finanzas/oc-clientes/${oc2.id}/cuotas/${oc2.cuotas[0].id}/vincular-factura`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ factura_id: facturaA.id }),
  })
  assert.equal(rConflictoCrossOC.status, 409, 'una factura ya usada por otra OC no debe poder vincularse')

  const ocFinal = listaTrasVincular.find(o => o.id === oc.id)
  assert.equal(ocFinal.cuotas.filter(c => c.factura_id).length, 2, 'ambas cuotas deben quedar facturadas, aunque compartan la misma factura')
})

test('OC Clientes: vincular una cuota a un pago real de la factura refleja su estado en vivo, y rechaza pagos de otra factura o ya usados por otra OC', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const oc = await fetch(`${BASE}/finanzas/oc-clientes`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cliente: 'Cliente Pagos Test', numero_oc: 'OCV-PAGOS-1', monto_oc: 17720, fecha_oc: '2026-06-08',
      cuotas: [
        { tipo: 'anticipo', pct: 50 },
        { tipo: 'avance', pct: 25 },
        { tipo: 'saldo_final', pct: 25 },
      ],
    }),
  }).then(r => r.json())

  const factura = await fetch(`${BASE}/finanzas/facturas-venta`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: '3-131', fecha: '2026-06-08', cliente_nombre: 'Cliente Pagos Test', importe: 17720, moneda: 'PESO' }),
  }).then(r => r.json())

  // Vincular las 3 cuotas a la misma factura (el 100% se facturó de una vez)
  for (const cuota of oc.cuotas) {
    await fetch(`${BASE}/finanzas/oc-clientes/${oc.id}/cuotas/${cuota.id}/vincular-factura`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ factura_id: factura.id }),
    })
  }

  // Registrar 2 pagos reales de esa factura: uno confirmado, uno pendiente
  const pagoConfirmado = await fetch(`${BASE}/finanzas/facturas-venta/${factura.id}/pagos`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo: 'parcial', forma_pago: 'transferencia', importe: 8860, moneda: 'PESO', fecha: '2026-06-10', estado: 'confirmado' }),
  }).then(r => r.json())
  const pagoPendiente = await fetch(`${BASE}/finanzas/facturas-venta/${factura.id}/pagos`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo: 'parcial', forma_pago: 'e-cheq', entidad: 'Banco Santander Río', importe: 4430, moneda: 'PESO', fecha: '2026-07-29', estado: 'pendiente' }),
  }).then(r => r.json())

  const cuotaAnticipo = oc.cuotas.find(c => c.tipo === 'anticipo')
  const cuotaAvance = oc.cuotas.find(c => c.tipo === 'avance')

  const rVincConfirmado = await fetch(`${BASE}/finanzas/oc-clientes/${oc.id}/cuotas/${cuotaAnticipo.id}/pagos`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pago_id: pagoConfirmado.id }),
  })
  assert.equal(rVincConfirmado.status, 201)

  const rVincPendiente = await fetch(`${BASE}/finanzas/oc-clientes/${oc.id}/cuotas/${cuotaAvance.id}/pagos`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pago_id: pagoPendiente.id }),
  })
  assert.equal(rVincPendiente.status, 201)

  const lista = await fetch(`${BASE}/finanzas/oc-clientes?buscar=OCV-PAGOS-1`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  const ocCargada = lista.find(o => o.id === oc.id)
  const cAnticipo = ocCargada.cuotas.find(c => c.tipo === 'anticipo')
  const cAvance = ocCargada.cuotas.find(c => c.tipo === 'avance')
  const cFinal = ocCargada.cuotas.find(c => c.tipo === 'saldo_final')
  assert.equal(cAnticipo.pagos.length, 1)
  assert.equal(cAnticipo.pagos[0].estado, 'confirmado', 'la cuota vinculada al pago confirmado debe reflejarlo en vivo')
  assert.equal(cAvance.pagos.length, 1)
  assert.equal(cAvance.pagos[0].estado, 'pendiente', 'la cuota vinculada al pago pendiente debe reflejarlo en vivo, no marcarse como cobrada')
  assert.equal(cFinal.pagos.length, 0, 'la cuota sin pago vinculado no debe tener ninguno')

  // Una cuota puede cobrarse con VARIOS pagos combinados (ej. dos e-cheques +
  // una transferencia por el total) — se agrega un segundo pago a la MISMA
  // cuota que ya tenía uno, sin reemplazarlo.
  const pagoExtra = await fetch(`${BASE}/finanzas/facturas-venta/${factura.id}/pagos`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo: 'parcial', forma_pago: 'e-cheq', entidad: 'Banco Galicia', importe: 4430, moneda: 'PESO', fecha: '2026-06-11', estado: 'confirmado' }),
  }).then(r => r.json())
  const rVincExtra = await fetch(`${BASE}/finanzas/oc-clientes/${oc.id}/cuotas/${cuotaAnticipo.id}/pagos`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pago_id: pagoExtra.id }),
  })
  assert.equal(rVincExtra.status, 201, 'una cuota debe poder tener más de un pago vinculado')
  const listaConExtra = await fetch(`${BASE}/finanzas/oc-clientes?buscar=OCV-PAGOS-1`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  const cAnticipoConExtra = listaConExtra.find(o => o.id === oc.id).cuotas.find(c => c.tipo === 'anticipo')
  assert.equal(cAnticipoConExtra.pagos.length, 2, 'la cuota ahora debe tener los dos pagos vinculados')

  // Quitar uno de los dos pagos deja solo el otro.
  const rQuitar = await fetch(`${BASE}/finanzas/oc-clientes/${oc.id}/cuotas/${cuotaAnticipo.id}/pagos/${pagoExtra.id}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${t}` },
  })
  assert.equal(rQuitar.status, 200)
  const listaSinExtra = await fetch(`${BASE}/finanzas/oc-clientes?buscar=OCV-PAGOS-1`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  assert.equal(listaSinExtra.find(o => o.id === oc.id).cuotas.find(c => c.tipo === 'anticipo').pagos.length, 1)

  // Un pago que pertenece a OTRA factura no puede vincularse a esta cuota
  const otraFactura = await fetch(`${BASE}/finanzas/facturas-venta`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'OTRA-FACTURA', fecha: '2026-01-01', cliente_nombre: 'Otro Cliente', importe: 100, moneda: 'PESO' }),
  }).then(r => r.json())
  const pagoDeOtraFactura = await fetch(`${BASE}/finanzas/facturas-venta/${otraFactura.id}/pagos`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo: 'total', forma_pago: 'transferencia', importe: 100, moneda: 'PESO', fecha: '2026-01-05', estado: 'confirmado' }),
  }).then(r => r.json())
  const rPagoAjeno = await fetch(`${BASE}/finanzas/oc-clientes/${oc.id}/cuotas/${cuotaAnticipo.id}/pagos`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pago_id: pagoDeOtraFactura.id }),
  })
  assert.equal(rPagoAjeno.status, 400, 'un pago de otra factura no puede vincularse a esta cuota')

  // A diferencia de la factura, un pago puntual NO se comparte ni siquiera
  // entre cuotas de la MISMA OC — sería contar el mismo cobro dos veces.
  const cuotaFinal = oc.cuotas.find(c => c.tipo === 'saldo_final')
  const rPagoDuplicado = await fetch(`${BASE}/finanzas/oc-clientes/${oc.id}/cuotas/${cuotaFinal.id}/pagos`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pago_id: pagoConfirmado.id }),
  })
  assert.equal(rPagoDuplicado.status, 409, 'un pago ya vinculado a una cuota no debe poder tomarlo otra cuota, ni de la misma OC')
})

test('facturas en PESO con una tasa_cambio de referencia (ej. vinculadas a una OC en USD) no duplican la conversión: saldo, cobro y KPIs usan el importe tal cual', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  // Simula una factura de venta 40% ANTICIPO: se factura en PESO por el neto ya
  // convertido, pero se guarda la tasa_cambio de la OC (en USD) como referencia.
  const facturaV = await fetch(`${BASE}/finanzas/facturas-venta`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FCEA-TC-1', fecha: '2026-06-18', cliente_nombre: 'Cliente TC Test', importe: 1000, moneda: 'PESO', tasa_cambio: 1744.2 }),
  }).then(r => r.json())

  const listaV = await fetch(`${BASE}/finanzas/facturas-venta`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  const filaV = listaV.find(f => f.id === facturaV.id)
  assert.equal(filaV.saldo_pendiente, 1000, 'el saldo pendiente no debe reconvertir un importe que ya está en pesos')

  // Un pago por el total exacto (en pesos, sin reconvertir) debe saldarla.
  await fetch(`${BASE}/finanzas/facturas-venta/${facturaV.id}/pagos`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo: 'total', forma_pago: 'transferencia', importe: 1000, moneda: 'PESO', fecha: '2026-06-20', estado: 'confirmado' }),
  })
  const facturaVFinal = await fetch(`${BASE}/finanzas/facturas-venta`, { headers: { Authorization: `Bearer ${t}` } })
    .then(r => r.json()).then(rows => rows.find(f => f.id === facturaV.id))
  assert.equal(facturaVFinal.pago_confirmado, 1, 'un pago por el importe real (sin reconvertir) debe marcar la factura como cobrada')

  // Mismo caso del lado de compras.
  const facturaC = await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FC-TC-1', fecha: '2026-06-18', proveedor_nombre: 'Proveedor TC Test', neto_gravado: 1000, importe: 1000, moneda: 'PESO', tasa_cambio: 1744.2 }),
  }).then(r => r.json())
  const listaC = await fetch(`${BASE}/finanzas/facturas-compra`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  const filaC = listaC.find(f => f.id === facturaC.id)
  assert.equal(filaC.saldo_pendiente, 1000, 'el saldo pendiente de compras tampoco debe reconvertir un importe ya en pesos')

  // El dashboard gerencial no debe inflar el total sumando esta factura reconvertida.
  const dash = await fetch(`${BASE}/finanzas/dashboard?desde=2026-06-01&hasta=2026-06-30`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  assert.ok(dash.kpiV.total < 100000, `el total del dashboard no debe inflarse por la tasa_cambio de referencia (dio ${dash.kpiV.total})`)
  assert.ok(dash.kpiC.total < 100000, `el total de compras del dashboard no debe inflarse por la tasa_cambio de referencia (dio ${dash.kpiC.total})`)
})

test('facturas de venta: el filtro "Pendiente" no debe mezclar notas de crédito (NC), que nunca quedan pagadas', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const original = await fetch(`${BASE}/finanzas/facturas-venta`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FV-PEND-1', tipo_factura: 'A', fecha: '2026-01-01', cliente_nombre: 'Cliente Pendiente Test', importe: 500, moneda: 'PESO' }),
  }).then(r => r.json())
  await fetch(`${BASE}/finanzas/facturas-venta`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'NC-ANULA-1', tipo_factura: 'NC', fecha: '2026-01-02', cliente_nombre: 'Cliente Pendiente Test', importe: -500, moneda: 'PESO', nc_factura_id: original.id }),
  })

  const rTodas = await fetch(`${BASE}/finanzas/facturas-venta?buscar=Cliente Pendiente Test`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  assert.equal(rTodas.length, 2, 'sin filtro de estado, deben verse ambas (factura y NC)')

  const rPendientes = await fetch(`${BASE}/finanzas/facturas-venta?buscar=Cliente Pendiente Test&pago=0`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  assert.equal(rPendientes.length, 1, 'el filtro "Pendiente" no debe incluir la nota de crédito')
  assert.equal(rPendientes[0].numero, 'FV-PEND-1', 'debe quedar solo la factura real pendiente, no la NC')
})

test('editar un pago ya registrado (Ventas y Compras): corrige sus datos sin duplicar filas y recalcula el saldo', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const facturaV = await fetch(`${BASE}/finanzas/facturas-venta`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FV-EDITPAGO-1', fecha: '2026-01-01', cliente_nombre: 'Cliente Editar Pago', importe: 1000, moneda: 'PESO' }),
  }).then(r => r.json())
  const pagoV = await fetch(`${BASE}/finanzas/facturas-venta/${facturaV.id}/pagos`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo: 'parcial', forma_pago: 'transferencia', importe: 400, moneda: 'PESO', fecha: '2026-01-05', estado: 'confirmado' }),
  }).then(r => r.json())

  const rEditV = await fetch(`${BASE}/finanzas/facturas-venta/${facturaV.id}/pagos/${pagoV.id}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ importe: 1000, observaciones: 'corregido' }),
  })
  assert.equal(rEditV.status, 200)

  const pagosV = await fetch(`${BASE}/finanzas/facturas-venta/${facturaV.id}/pagos`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  assert.equal(pagosV.length, 1, 'editar un pago no debe crear una fila nueva')
  assert.equal(pagosV[0].importe, 1000, 'el importe editado debe quedar guardado')
  assert.equal(pagosV[0].observaciones, 'corregido')

  const facturaVFinal = await fetch(`${BASE}/finanzas/facturas-venta`, { headers: { Authorization: `Bearer ${t}` } })
    .then(r => r.json()).then(rows => rows.find(f => f.id === facturaV.id))
  assert.equal(facturaVFinal.pago_confirmado, 1, 'tras corregir el importe al total de la factura, debe quedar marcada como cobrada')

  // Mismo caso del lado de compras.
  const facturaC = await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FC-EDITPAGO-1', fecha: '2026-01-01', proveedor_nombre: 'Proveedor Editar Pago', neto_gravado: 1000, importe: 1000, moneda: 'PESO' }),
  }).then(r => r.json())
  const pagoC = await fetch(`${BASE}/finanzas/facturas-compra/${facturaC.id}/pagos`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo: 'parcial', forma_pago: 'transferencia', importe: 400, moneda: 'PESO', fecha: '2026-01-05', estado: 'confirmado' }),
  }).then(r => r.json())

  const rEditC = await fetch(`${BASE}/finanzas/facturas-compra/${facturaC.id}/pagos/${pagoC.id}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ importe: 1000 }),
  })
  assert.equal(rEditC.status, 200)

  const pagosC = await fetch(`${BASE}/finanzas/facturas-compra/${facturaC.id}/pagos`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  assert.equal(pagosC.length, 1, 'editar un pago de compras tampoco debe crear una fila nueva')
  assert.equal(pagosC[0].importe, 1000)

  const facturaCFinal = await fetch(`${BASE}/finanzas/facturas-compra`, { headers: { Authorization: `Bearer ${t}` } })
    .then(r => r.json()).then(rows => rows.find(f => f.id === facturaC.id))
  assert.equal(facturaCFinal.pago_confirmado, 1, 'tras corregir el importe al total de la factura de compra, debe quedar marcada como pagada')
})

test('generador de códigos de materiales: familia de Válvulas (401..411, por material) genera correlativos igual que cualquier otra familia', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const r1 = await fetch(`${BASE}/materiales/next-codigo/406`, { headers: { Authorization: `Bearer ${t}` } })
  assert.equal(r1.status, 200)
  const codigo1 = (await r1.json()).codigo
  assert.match(codigo1, /^406\d{7}$/, 'el correlativo de una válvula (familia 4 + material 06=PVC) debe tener 3 + 7 = 10 caracteres')

  await fetch(`${BASE}/materiales`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: codigo1, descripcion: 'Válvula PVC test', unidad: 'UND.' }),
  })
  const r2 = await fetch(`${BASE}/materiales/next-codigo/406`, { headers: { Authorization: `Bearer ${t}` } })
  const codigo2 = (await r2.json()).codigo
  assert.notEqual(codigo2, codigo1, 'una vez tomada una válvula, el siguiente correlativo debe avanzar')
})

test('OC de compras en moneda extranjera sin tasa_cambio cargada a mano toma la del sistema (tipo_cambio) vigente a esa fecha', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  await fetch(`${BASE}/finanzas/tipo-cambio`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ moneda: 'DÓLAR', valor: 1234.5, fuente: 'BNA', fecha: '2026-02-01' }),
  })

  // Sin tasa_cambio en el body: debe resolver la del sistema vigente a la fecha de la OC.
  const rSinTC = await fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proveedor_nombre: 'Proveedor TC Sistema Test', fecha: '2026-02-05', moneda: 'DÓLAR',
      items: [{ descripcion: 'item TC test', cantidad: 1, precio_unitario: 100, precio_final: 100 }],
    }),
  }).then(r => r.json())
  assert.equal(rSinTC.tasa_cambio, 1234.5, 'sin TC manual, debe tomar la más reciente del sistema a esa fecha')

  // Con tasa_cambio explícita: no se debe pisar con la del sistema.
  const rConTC = await fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proveedor_nombre: 'Proveedor TC Manual Test', fecha: '2026-02-05', moneda: 'DÓLAR', tasa_cambio: 999,
      items: [{ descripcion: 'item TC test', cantidad: 1, precio_unitario: 100, precio_final: 100 }],
    }),
  }).then(r => r.json())
  assert.equal(rConTC.tasa_cambio, 999, 'si se cargó una tasa_cambio a mano, esa es la que debe quedar guardada')

  // En pesos no corresponde ninguna tasa_cambio.
  const rPesos = await fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proveedor_nombre: 'Proveedor Pesos Test', fecha: '2026-02-05', moneda: 'PESOS',
      items: [{ descripcion: 'item TC test', cantidad: 1, precio_unitario: 100, precio_final: 100 }],
    }),
  }).then(r => r.json())
  assert.equal(rPesos.tasa_cambio, 0, 'una OC en pesos no debe resolver ninguna tasa de cambio')
})

test('selector de OC en facturas de compra: una OC en USD con una factura ya cargada en PESOS no debe desaparecer si le queda saldo', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  // OC en USD por 1000 (neto de sus items, en dólares).
  const oc = await fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proveedor_nombre: 'Proveedor USD Mixto Test', fecha: '2026-03-01', moneda: 'DÓLAR', tasa_cambio: 1000,
      items: [{ descripcion: 'item USD test', cantidad: 1, precio_unitario: 1000, precio_final: 1000 }],
    }),
  }).then(r => r.json())

  // Factura parcial cargada en PESOS (convención habitual: el proveedor factura en
  // pesos al TC del día) por el 40% del neto de la OC ya convertido: 1000 USD * 1000 = 1.000.000,
  // factura parcial de 400.000 pesos (40%).
  await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      numero: 'OC-USD-MIXTO-1', fecha: '2026-03-02', proveedor_nombre: 'Proveedor USD Mixto Test',
      oc_id: oc.id, oc_numero: oc.numero, neto_gravado: 400000, importe: 400000, moneda: 'PESO', tasa_cambio: 1000,
    }),
  })

  const r = await fetch(`${BASE}/compras/oc?excluirFacturadas=1&limit=5000`, { headers: { Authorization: `Bearer ${t}` } })
  const { datos } = await r.json()
  const numeros = datos.map(o => o.numero)
  assert.ok(numeros.includes(oc.numero), 'la OC en USD con solo el 40% facturado (en pesos) debe seguir disponible para cargar el resto')

  // Ahora se factura el 60% restante (600.000 pesos) → el ciclo queda completo.
  await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      numero: 'OC-USD-MIXTO-2', fecha: '2026-03-03', proveedor_nombre: 'Proveedor USD Mixto Test',
      oc_id: oc.id, oc_numero: oc.numero, neto_gravado: 600000, importe: 600000, moneda: 'PESO', tasa_cambio: 1000,
    }),
  })
  const r2 = await fetch(`${BASE}/compras/oc?excluirFacturadas=1&limit=5000`, { headers: { Authorization: `Bearer ${t}` } })
  const { datos: datos2 } = await r2.json()
  assert.ok(!datos2.map(o => o.numero).includes(oc.numero), 'tras facturar el 100% (aunque en pesos), la OC ya no debe ofrecerse para una factura nueva')
})

test('listados de facturas: el filtro "Con OC / Sin OC" funciona en Compras y en Ventas', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const oc = await fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proveedor_nombre: 'Proveedor Filtro OC Test', fecha: '2026-04-01', moneda: 'PESOS',
      items: [{ descripcion: 'item filtro OC', cantidad: 1, precio_unitario: 500, precio_final: 500 }],
    }),
  }).then(r => r.json())

  await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FC-CONOC-1', fecha: '2026-04-02', proveedor_nombre: 'Proveedor Filtro OC Test', oc_id: oc.id, oc_numero: oc.numero, neto_gravado: 500, importe: 500, moneda: 'PESO' }),
  })
  await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FC-SINOC-1', fecha: '2026-04-02', proveedor_nombre: 'Proveedor Filtro OC Test', importe: 300, neto_gravado: 300, moneda: 'PESO' }),
  })

  const con = await fetch(`${BASE}/finanzas/facturas-compra?buscar=Proveedor Filtro OC Test&conOc=con`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  assert.deepEqual(con.map(f => f.numero), ['FC-CONOC-1'], 'conOc=con debe traer solo la factura vinculada a una OC')

  const sin = await fetch(`${BASE}/finanzas/facturas-compra?buscar=Proveedor Filtro OC Test&conOc=sin`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  assert.deepEqual(sin.map(f => f.numero), ['FC-SINOC-1'], 'conOc=sin debe traer solo la factura sin OC')

  await fetch(`${BASE}/finanzas/facturas-venta`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FV-CONOC-1', fecha: '2026-04-02', cliente_nombre: 'Cliente Filtro OC Test', importe: 500, moneda: 'PESO', oc: '8800111' }),
  })
  await fetch(`${BASE}/finanzas/facturas-venta`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FV-SINOC-1', fecha: '2026-04-02', cliente_nombre: 'Cliente Filtro OC Test', importe: 300, moneda: 'PESO' }),
  })

  const conV = await fetch(`${BASE}/finanzas/facturas-venta?buscar=Cliente Filtro OC Test&conOc=con`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  assert.deepEqual(conV.map(f => f.numero), ['FV-CONOC-1'], 'conOc=con (ventas) debe traer solo la factura con OC cargada')

  const sinV = await fetch(`${BASE}/finanzas/facturas-venta?buscar=Cliente Filtro OC Test&conOc=sin`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  assert.deepEqual(sinV.map(f => f.numero), ['FV-SINOC-1'], 'conOc=sin (ventas) debe traer solo la factura sin OC')
})

test('Control OC: "Autocorregir" calcula el TC implícito (facturado / neto OC) y lo guarda como TC manual', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const oc = await fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proveedor_nombre: 'Proveedor Autocorregir Test', fecha: '2026-07-05', moneda: 'DÓLAR', tasa_cambio: 900,
      items: [{ descripcion: 'item autocorregir', cantidad: 1, precio_unitario: 1000, precio_final: 1000 }],
    }),
  }).then(r => r.json())

  // Factura por el total, pero al TC real del día (1050, no el 900 cargado en la OC)
  await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      numero: 'FC-AUTOTC-1', fecha: '2026-07-06', proveedor_nombre: 'Proveedor Autocorregir Test',
      oc_id: oc.id, oc_numero: oc.numero, neto_gravado: 1050000, importe: 1050000, moneda: 'PESO',
    }),
  })

  const antes = await fetch(`${BASE}/finanzas/control-oc`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  const filaAntes = antes.find(r => r.oc_id === oc.id)
  assert.ok(filaAntes, 'la OC debe aparecer en Control OC por la diferencia de TC (900 cargado vs 1050 real)')
  assert.ok(Math.abs(filaAntes.facturas_neto_total - filaAntes.oc_neto_pesos) > 1)

  const tcImplicito = filaAntes.facturas_neto_total / filaAntes.oc_neto_orig
  assert.equal(tcImplicito, 1050, 'el TC implícito debe ser el que hace coincidir lo facturado con el neto de la OC')

  const rPut = await fetch(`${BASE}/finanzas/control-oc/${oc.id}/tc-manual`, {
    method: 'PUT', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ valor: tcImplicito }),
  })
  assert.equal(rPut.status, 200)

  const despues = await fetch(`${BASE}/finanzas/control-oc`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  assert.ok(!despues.some(r => r.oc_id === oc.id), 'tras aplicar el TC implícito como manual, la OC ya no debe aparecer en Control OC (diferencia 0)')
})

test('selector de OC en facturas de compra: una OC vieja con tasa_cambio=0 resuelve el TC del sistema a su fecha, en vez de mostrarse como si no tuviera conversión', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  await fetch(`${BASE}/finanzas/tipo-cambio`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ moneda: 'DÓLAR', valor: 800, fuente: 'BNA', fecha: '2026-06-01' }),
  })

  const oc = await fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proveedor_nombre: 'Proveedor OC Vieja Test', fecha: '2026-06-15', moneda: 'DÓLAR',
      items: [{ descripcion: 'item oc vieja', cantidad: 1, precio_unitario: 100, precio_final: 100 }],
    }),
  }).then(r => r.json())

  // Simula una OC vieja (de antes de resolver el TC automáticamente al crearla): tasa_cambio=0.
  await fetch(`${BASE}/compras/oc/${oc.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tasa_cambio: 0 }),
  })

  const r = await fetch(`${BASE}/compras/oc?buscar=Proveedor OC Vieja Test`, { headers: { Authorization: `Bearer ${t}` } })
  const { datos } = await r.json()
  const fila = datos.find(o => o.id === oc.id)
  assert.ok(fila, 'la OC debe aparecer en el listado')
  assert.equal(fila.tasa_cambio, 0, 'la tasa_cambio propia de la OC sigue en 0 (dato histórico, no se reescribe)')
  assert.equal(fila.tc_resuelto, 800, 'tc_resuelto debe tomar el tipo_cambio del sistema vigente a la fecha de la OC como fallback')
})

test('vincular una factura ya cargada (sin OC) a una OC existente, desde el propio detalle de la OC', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const oc = await fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proveedor_nombre: 'Proveedor Vincular Test', fecha: '2026-08-01', moneda: 'PESOS',
      items: [{ descripcion: 'item vincular', cantidad: 1, precio_unitario: 500, precio_final: 500 }],
    }),
  }).then(r => r.json())

  const factura = await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FC-VINC-1', fecha: '2026-08-02', proveedor_nombre: 'Proveedor Vincular Test', neto_gravado: 500, importe: 500, moneda: 'PESO' }),
  }).then(r => r.json())

  // Aparece entre las candidatas (sin OC) mientras no esté vinculada
  const candidatas = await fetch(`${BASE}/compras/facturas-sin-oc?buscar=Proveedor Vincular Test`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  assert.ok(candidatas.some(f => f.id === factura.id), 'la factura sin OC debe aparecer como candidata')

  const rVinc = await fetch(`${BASE}/compras/oc/${oc.id}/vincular-factura`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ factura_id: factura.id }),
  })
  assert.equal(rVinc.status, 200)

  const ocConFactura = await fetch(`${BASE}/compras/oc/${oc.id}`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  assert.equal(ocConFactura.facturas.length, 1, 'la OC debe mostrar la factura recién vinculada')
  assert.equal(ocConFactura.facturas[0].numero, 'FC-VINC-1')

  // Ya no debe aparecer como candidata sin OC
  const candidatasDespues = await fetch(`${BASE}/compras/facturas-sin-oc?buscar=Proveedor Vincular Test`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  assert.ok(!candidatasDespues.some(f => f.id === factura.id), 'una vez vinculada, ya no debe aparecer como candidata')

  // No se puede vincular a OTRA OC mientras ya está tomada
  const oc2 = await fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proveedor_nombre: 'Proveedor Vincular Test', fecha: '2026-08-01', moneda: 'PESOS',
      items: [{ descripcion: 'item vincular 2', cantidad: 1, precio_unitario: 500, precio_final: 500 }],
    }),
  }).then(r => r.json())
  const rConflicto = await fetch(`${BASE}/compras/oc/${oc2.id}/vincular-factura`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ factura_id: factura.id }),
  })
  assert.equal(rConflicto.status, 409, 'una factura ya vinculada a una OC no debe poder tomarla otra OC')
})

test('Control OC: solo alerta si la diferencia supera el 3% del neto de la OC, no cualquier diferencia', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const crearOcConFactura = async (netoOC, netoFactura, sufijo) => {
    const oc = await fetch(`${BASE}/compras/oc`, {
      method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proveedor_nombre: `Proveedor Umbral ${sufijo}`, fecha: '2026-09-01', moneda: 'PESOS',
        items: [{ descripcion: 'item umbral', cantidad: 1, precio_unitario: netoOC, precio_final: netoOC }],
      }),
    }).then(r => r.json())
    await fetch(`${BASE}/finanzas/facturas-compra`, {
      method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ numero: `FC-UMBRAL-${sufijo}`, fecha: '2026-09-02', proveedor_nombre: `Proveedor Umbral ${sufijo}`, oc_id: oc.id, oc_numero: oc.numero, neto_gravado: netoFactura, importe: netoFactura, moneda: 'PESO' }),
    })
    return oc
  }

  // 2% de diferencia: no debería alertar
  const ocChica = await crearOcConFactura(100000, 102000, 'CHICA')
  // 5% de diferencia: sí debería alertar
  const ocGrande = await crearOcConFactura(100000, 105000, 'GRANDE')

  const filas = await fetch(`${BASE}/finanzas/control-oc`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  assert.ok(!filas.some(r => r.oc_id === ocChica.id), 'una diferencia del 2% no debe aparecer en Control OC')
  assert.ok(filas.some(r => r.oc_id === ocGrande.id), 'una diferencia del 5% sí debe aparecer en Control OC')
})

test('Control OC: no evalúa OC de antes del 01/07/2026 (datos importados de planillas viejas, no confiables para detectar diferencias)', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const crearOcConFactura = async (fechaOC, fechaFactura, sufijo) => {
    const oc = await fetch(`${BASE}/compras/oc`, {
      method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proveedor_nombre: `Proveedor Fecha Corte ${sufijo}`, fecha: fechaOC, moneda: 'PESOS',
        items: [{ descripcion: 'item fecha corte', cantidad: 1, precio_unitario: 100000, precio_final: 100000 }],
      }),
    }).then(r => r.json())
    // 50% de diferencia — sería una alerta enorme si la fecha no la filtrara.
    await fetch(`${BASE}/finanzas/facturas-compra`, {
      method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ numero: `FC-CORTE-${sufijo}`, fecha: fechaFactura, proveedor_nombre: `Proveedor Fecha Corte ${sufijo}`, oc_id: oc.id, oc_numero: oc.numero, neto_gravado: 50000, importe: 50000, moneda: 'PESO' }),
    })
    return oc
  }

  const ocVieja   = await crearOcConFactura('2026-06-30', '2026-07-01', 'VIEJA')
  const ocLimite  = await crearOcConFactura('2026-07-01', '2026-07-02', 'LIMITE')

  const filas = await fetch(`${BASE}/finanzas/control-oc`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  assert.ok(!filas.some(r => r.oc_id === ocVieja.id), 'una OC de antes del 01/07/2026 no debe evaluarse aunque tenga una diferencia enorme')
  assert.ok(filas.some(r => r.oc_id === ocLimite.id), 'una OC del 01/07/2026 (fecha límite, inclusive) sí debe evaluarse normalmente')

  // Datos importados de planillas viejas a veces quedaron con la fecha en
  // formato DD/MM/YYYY en vez de ISO — comparar como texto plano ("27/05/2025"
  // >= "2026-07-01") da true por orden alfabético, así que sin normalizar la
  // fecha antes de comparar esta OC vieja se hubiera colado igual.
  const db = new Database(DB_PATH)
  const ocFormatoViejo = await crearOcConFactura('2026-07-10', '2026-07-11', 'FORMATOVIEJO')
  db.prepare("UPDATE ordenes_compra SET fecha='27/05/2025' WHERE id=?").run(ocFormatoViejo.id)
  db.close()

  const filas2 = await fetch(`${BASE}/finanzas/control-oc`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  assert.ok(!filas2.some(r => r.oc_id === ocFormatoViejo.id), 'una OC vieja con fecha en formato DD/MM/YYYY tampoco debe evaluarse')
})

test('E-CHEQ: la factura queda pagada apenas se registra el pago, pero el cheque en sí sigue pendiente hasta confirmarse', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  // Lado compras
  const facturaC = await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FC-ECHEQ-1', fecha: '2026-10-01', proveedor_nombre: 'Proveedor E-CHEQ Test', importe: 1000, moneda: 'PESO' }),
  }).then(r => r.json())
  const pagoC = await fetch(`${BASE}/finanzas/facturas-compra/${facturaC.id}/pagos`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo: 'total', forma_pago: 'e-cheq', entidad: 'Banco Galicia', importe: 1000, moneda: 'PESO', fecha: '2026-10-01', fecha_acreditacion: '2026-10-30' }),
  }).then(r => r.json())
  assert.equal(pagoC.estado, 'pendiente', 'el E-CHEQ en sí arranca pendiente (todavía no se acreditó/debitó)')

  const facturaCFinal = await fetch(`${BASE}/finanzas/facturas-compra`, { headers: { Authorization: `Bearer ${t}` } })
    .then(r => r.json()).then(rows => rows.find(f => f.id === facturaC.id))
  assert.equal(facturaCFinal.pago_confirmado, 1, 'la factura de compra debe quedar pagada apenas se carga el E-CHEQ, sin esperar la confirmación')

  const dash = await fetch(`${BASE}/finanzas/dashboard-diario`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  assert.ok(!dash.facturasPorPagar.some(f => f.id === facturaC.id), 'una factura pagada con E-CHEQ no debe listarse entre las facturas por pagar')
  assert.ok(dash.echeqsEmitidos.some(e => e.id === pagoC.id), 'el E-CHEQ debe seguir apareciendo aparte, en su propia lista de pendientes de débito')

  // Lado ventas
  const facturaV = await fetch(`${BASE}/finanzas/facturas-venta`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FV-ECHEQ-1', fecha: '2026-10-01', cliente_nombre: 'Cliente E-CHEQ Test', importe: 1000, moneda: 'PESO' }),
  }).then(r => r.json())
  const pagoV = await fetch(`${BASE}/finanzas/facturas-venta/${facturaV.id}/pagos`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo: 'total', forma_pago: 'e-cheq', entidad: 'Banco ICBC', importe: 1000, moneda: 'PESO', fecha: '2026-10-01', fecha_acreditacion: '2026-10-30' }),
  }).then(r => r.json())
  assert.equal(pagoV.estado, 'pendiente', 'el E-CHEQ recibido también arranca pendiente')

  const facturaVFinal = await fetch(`${BASE}/finanzas/facturas-venta`, { headers: { Authorization: `Bearer ${t}` } })
    .then(r => r.json()).then(rows => rows.find(f => f.id === facturaV.id))
  assert.equal(facturaVFinal.pago_confirmado, 1, 'la factura de venta debe quedar cobrada apenas se carga el E-CHEQ recibido')

  const dashFinal = await fetch(`${BASE}/finanzas/dashboard-diario`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  assert.ok(dashFinal.echeqsRecibidos.some(e => e.id === pagoV.id), 'el E-CHEQ recibido de un cliente también debe aparecer en el dashboard, en su propia lista de pendientes de acreditación')
  assert.ok(dashFinal.ventasPendientes.echeq_pendiente >= 1000, 'el monto del E-CHEQ recibido sin acreditar debe sumarse aparte en "por cobrar", ya que la factura que lo cobró desaparece de ahí al quedar pagada')
})

test('Confirmar un E-CHEQ es una función exclusiva de Finanzas: ni Administración ni Compras pueden hacerlo, ni siquiera colándose por la edición genérica del pago', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const crearUsuario = async (username, permisos) => {
    const u = await fetch(`${BASE}/auth/usuarios`, {
      method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, nombre: username, password: 'inicial123', rol: 'solo_lectura' }),
    }).then(r => r.json())
    await fetch(`${BASE}/auth/usuarios/${u.id}/permisos`, {
      method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(permisos),
    })
    return tok({ id: u.id, username, nombre: username, rol: 'solo_lectura' })
  }
  const secretaria = await crearUsuario('secretaria_confirmar_echeq', { administracion: { leer: true, escribir: true } })
  const comprador = await crearUsuario('comprador_confirmar_echeq', { compras: { leer: true, escribir: true } })
  const finanzas = await crearUsuario('finanzas_confirmar_echeq', { finanzas: { leer: true, escribir: true } })

  const facturaC = await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FC-ECHEQ-PERM-1', fecha: '2026-10-01', proveedor_nombre: 'Proveedor E-CHEQ Permisos Test', importe: 1000, moneda: 'PESO' }),
  }).then(r => r.json())
  const pagoC = await fetch(`${BASE}/finanzas/facturas-compra/${facturaC.id}/pagos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo: 'total', forma_pago: 'e-cheq', entidad: 'Banco Galicia', importe: 1000, moneda: 'PESO', fecha: '2026-10-01', fecha_acreditacion: '2026-10-30' }),
  }).then(r => r.json())

  // Administración (que sí puede editar/vincular otras cosas de Finanzas) no puede confirmar el E-CHEQ.
  const secretariaViaRutaDedicada = await fetch(`${BASE}/finanzas/facturas-compra/${facturaC.id}/pagos/${pagoC.id}/confirmar`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${secretaria}` },
  })
  assert.equal(secretariaViaRutaDedicada.status, 403, 'Administración no puede confirmar un E-CHEQ por la ruta dedicada')

  const secretariaViaGenerica = await fetch(`${BASE}/finanzas/facturas-compra/${facturaC.id}/pagos/${pagoC.id}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${secretaria}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado: 'confirmado' }),
  })
  assert.equal(secretariaViaGenerica.status, 403, 'Administración tampoco puede colarse confirmándolo por la edición genérica del pago')

  // Compras tampoco.
  const compradorViaGenerica = await fetch(`${BASE}/finanzas/facturas-compra/${facturaC.id}/pagos/${pagoC.id}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${comprador}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado: 'confirmado' }),
  })
  assert.equal(compradorViaGenerica.status, 403, 'Compras no puede confirmar un E-CHEQ')

  const pagoTrasIntentos = await fetch(`${BASE}/finanzas/facturas-compra/${facturaC.id}/pagos`, { headers: { Authorization: `Bearer ${admin}` } })
    .then(r => r.json()).then(rows => rows.find(p => p.id === pagoC.id))
  assert.equal(pagoTrasIntentos.estado, 'pendiente', 'ninguno de los intentos bloqueados debe haber cambiado el estado')

  // Editar otros campos del pago (no el estado) sigue permitido para Administración — no se restringió de más.
  const secretariaEditaOtroCampo = await fetch(`${BASE}/finanzas/facturas-compra/${facturaC.id}/pagos/${pagoC.id}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${secretaria}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ observaciones: 'nota de administración' }),
  })
  assert.equal(secretariaEditaOtroCampo.status, 200, 'Administración debe poder seguir editando otros campos del pago, solo se restringió confirmar el estado')

  // Finanzas sí puede confirmarlo.
  const finanzasConfirma = await fetch(`${BASE}/finanzas/facturas-compra/${facturaC.id}/pagos/${pagoC.id}/confirmar`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${finanzas}` },
  })
  assert.equal(finanzasConfirma.status, 200, 'Finanzas sí puede confirmar el E-CHEQ')
  const pagoFinal = await finanzasConfirma.json()
  assert.equal(pagoFinal.estado, 'confirmado')

  // Mismo criterio del lado de Facturas de Venta.
  const facturaV = await fetch(`${BASE}/finanzas/facturas-venta`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FV-ECHEQ-PERM-1', fecha: '2026-10-01', cliente_nombre: 'Cliente E-CHEQ Permisos Test', importe: 1000, moneda: 'PESO' }),
  }).then(r => r.json())
  const pagoV = await fetch(`${BASE}/finanzas/facturas-venta/${facturaV.id}/pagos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo: 'total', forma_pago: 'e-cheq', entidad: 'Banco ICBC', importe: 1000, moneda: 'PESO', fecha: '2026-10-01', fecha_acreditacion: '2026-10-30' }),
  }).then(r => r.json())

  const secretariaViaGenericaV = await fetch(`${BASE}/finanzas/facturas-venta/${facturaV.id}/pagos/${pagoV.id}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${secretaria}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado: 'confirmado' }),
  })
  assert.equal(secretariaViaGenericaV.status, 403, 'Administración no puede confirmar un E-CHEQ recibido tampoco')

  const finanzasConfirmaV = await fetch(`${BASE}/finanzas/facturas-venta/${facturaV.id}/pagos/${pagoV.id}/confirmar`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${finanzas}` },
  })
  assert.equal(finanzasConfirmaV.status, 200, 'Finanzas sí puede confirmar el E-CHEQ recibido')
})

test('pagos en moneda extranjera se convierten a pesos antes de sumarlos contra el total de la factura', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  // Factura de compra en USD 1000, tasa 1000 -> $1.000.000. Se paga con un único
  // pago cargado también en USD 1000 (el caso natural: pagar el mismo monto que
  // dice la factura, en la misma moneda), con su propia tasa_cambio de 1000.
  const facturaC = await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FC-PAGOUSD-1', fecha: '2026-11-01', proveedor_nombre: 'Proveedor Pago USD Test', importe: 1000, moneda: 'DÓLAR', tasa_cambio: 1000 }),
  }).then(r => r.json())
  await fetch(`${BASE}/finanzas/facturas-compra/${facturaC.id}/pagos`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo: 'total', forma_pago: 'transferencia', importe: 1000, moneda: 'DÓLAR', tasa_cambio: 1000, fecha: '2026-11-02' }),
  })
  const facturaCFinal = await fetch(`${BASE}/finanzas/facturas-compra`, { headers: { Authorization: `Bearer ${t}` } })
    .then(r => r.json()).then(rows => rows.find(f => f.id === facturaC.id))
  assert.equal(facturaCFinal.pago_confirmado, 1, 'un pago de USD 1000 sobre una factura de USD 1000 debe saldarla, sin importar que ambos estén en dólares')
  assert.equal(facturaCFinal.saldo_pendiente, 0, 'el saldo pendiente no debe quedar en ~$999.000 por sumar el pago como si fuera pesos')

  // Mismo caso del lado de ventas, con retenciones incluidas.
  const facturaV = await fetch(`${BASE}/finanzas/facturas-venta`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FV-PAGOUSD-1', fecha: '2026-11-01', cliente_nombre: 'Cliente Pago USD Test', importe: 1000, moneda: 'DÓLAR', tasa_cambio: 1000 }),
  }).then(r => r.json())
  await fetch(`${BASE}/finanzas/facturas-venta/${facturaV.id}/pagos`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo: 'total', forma_pago: 'transferencia', importe: 1000, moneda: 'DÓLAR', tasa_cambio: 1000, fecha: '2026-11-02' }),
  })
  const facturaVFinal = await fetch(`${BASE}/finanzas/facturas-venta`, { headers: { Authorization: `Bearer ${t}` } })
    .then(r => r.json()).then(rows => rows.find(f => f.id === facturaV.id))
  assert.equal(facturaVFinal.pago_confirmado, 1, 'un cobro de USD 1000 sobre una factura de USD 1000 debe saldarla del lado de ventas también')
})

test('el anticipo de una factura de compra se registra como un pago real y reduce el saldo pendiente', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const factura = await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FC-ANTICIPO-1', fecha: '2026-11-01', proveedor_nombre: 'Proveedor Anticipo Test', importe: 1000, moneda: 'PESO' }),
  }).then(r => r.json())

  await fetch(`${BASE}/finanzas/facturas-compra/${factura.id}/anticipo`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ anticipo: 300, fecha_anticipo: '2026-11-02' }),
  })
  const trasAnticipo = await fetch(`${BASE}/finanzas/facturas-compra`, { headers: { Authorization: `Bearer ${t}` } })
    .then(r => r.json()).then(rows => rows.find(f => f.id === factura.id))
  assert.equal(trasAnticipo.saldo_pendiente, 700, 'el anticipo debe descontarse del saldo pendiente (no quedar en el total completo)')
  assert.equal(trasAnticipo.pago_confirmado, 0, 'con solo el anticipo, la factura sigue parcialmente impaga')

  // Pagar el resto (700) debe terminar de saldarla — sin quedar trabada por el anticipo.
  await fetch(`${BASE}/finanzas/facturas-compra/${factura.id}/pagos`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo: 'parcial', forma_pago: 'transferencia', importe: 700, moneda: 'PESO', fecha: '2026-11-05' }),
  })
  const final = await fetch(`${BASE}/finanzas/facturas-compra`, { headers: { Authorization: `Bearer ${t}` } })
    .then(r => r.json()).then(rows => rows.find(f => f.id === factura.id))
  assert.equal(final.pago_confirmado, 1, 'anticipo + resto debe saldar la factura, sin quedar trabada como impaga')
})

test('Facturas de Compra: exportar a Excel mensual trae las facturas del período con los campos para el estudio contable', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })
  const XLSX = require('xlsx')

  await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      numero: 'FC-EXPORT-1', tipo_factura: 'A', fecha: '2026-12-05', proveedor_nombre: 'Proveedor Export Test',
      cuit: '30-12345678-9', neto_gravado: 1000, iva_21: 210, importe: 1210, moneda: 'PESO',
    }),
  })
  // Fuera del rango pedido: no debe aparecer en el Excel.
  await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FC-EXPORT-FUERA', fecha: '2026-11-05', proveedor_nombre: 'Proveedor Export Test', importe: 500, moneda: 'PESO' }),
  })

  const resp = await fetch(`${BASE}/finanzas/facturas-compra/exportar?desde=2026-12-01&hasta=2026-12-31&buscar=Proveedor Export Test`, {
    headers: { Authorization: `Bearer ${t}` },
  })
  assert.equal(resp.status, 200)
  assert.match(resp.headers.get('content-type') || '', /spreadsheetml/)

  const buf = Buffer.from(await resp.arrayBuffer())
  const wb = XLSX.read(buf, { type: 'buffer' })
  const hoja = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]])
  assert.equal(hoja.length, 1, 'solo debe traer la factura dentro del período pedido')
  assert.equal(hoja[0]['N° Factura'], 'FC-EXPORT-1')
  assert.equal(hoja[0]['CUIT'], '30-12345678-9')
  assert.equal(hoja[0]['Neto Gravado'], 1000)
  assert.equal(hoja[0]['IVA 21%'], 210)
  assert.equal(hoja[0]['Estado de Pago'], 'Pendiente')
})

test('Comparar con ARCA: detecta faltantes, diferencias de importe y sobrantes, ignorando comprobantes de antes del 01/07/2026', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  // Ya cargada en el sistema, coincide exacto con ARCA — no debe figurar en ningún listado.
  await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: '0004-00000100', tipo_factura: 'A', fecha: '2026-07-10', proveedor_nombre: 'Proveedor ARCA Test', cuit: '30-11112222-3', importe: 1210, moneda: 'PESO' }),
  })
  // Cargada con un importe distinto al de ARCA — debe figurar como diferencia.
  await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: '0004-00000101', tipo_factura: 'A', fecha: '2026-07-11', proveedor_nombre: 'Proveedor ARCA Test', cuit: '30-11112222-3', importe: 900, moneda: 'PESO' }),
  })
  // Está en el sistema pero NO está en el archivo de ARCA — debe figurar como sobrante.
  await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: '0004-00000999', tipo_factura: 'A', fecha: '2026-07-12', proveedor_nombre: 'Proveedor ARCA Test', cuit: '30-11112222-3', importe: 500, moneda: 'PESO' }),
  })

  const HEADERS = ['Fecha', 'Tipo', 'Punto de Venta', 'Número Desde', 'Número Hasta', 'Cód. Autorización',
    'Tipo Doc. Emisor', 'Nro. Doc. Emisor', 'Denominación Emisor', 'Tipo Doc. Receptor', 'Nro. Doc. Receptor',
    'Tipo Cambio', 'Moneda', 'Neto Grav. IVA 21%', 'IVA 21%', 'Neto Gravado Total', 'Neto No Gravado',
    'Op. Exentas', 'Otros Tributos', 'Total IVA', 'Imp. Total']
  const filaArca = (fecha, puntoVenta, numero, cuit, proveedor, impTotal) => {
    const row = new Array(HEADERS.length).fill('')
    row[0] = fecha; row[1] = '1 - Factura A'; row[2] = puntoVenta; row[3] = numero; row[4] = numero
    row[7] = cuit; row[8] = proveedor; row[11] = 1; row[12] = '$'; row[20] = impTotal
    return row
  }
  const aoa = [
    ['Mis Comprobantes Recibidos - CUIT 30714543381'],
    HEADERS,
    filaArca('10/07/2026', 4, 100, '30-11112222-3', 'Proveedor ARCA Test', 1210),   // coincide exacto
    filaArca('11/07/2026', 4, 101, '30-11112222-3', 'Proveedor ARCA Test', 1500),   // difiere del importe cargado (900)
    filaArca('13/07/2026', 4, 102, '30-11112222-3', 'Proveedor ARCA Test', 2000),   // falta cargar
    filaArca('20/05/2025', 4, 50,  '30-11112222-3', 'Proveedor ARCA Test', 300),    // antes del 01/07/2026: se excluye
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Hoja1')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  const fd = new FormData()
  fd.append('archivo', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'comprobantes.xlsx')
  const r = await fetch(`${BASE}/finanzas/facturas-compra/comparar-arca`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}` }, body: fd,
  })
  assert.equal(r.status, 200)
  const resultado = await r.json()

  assert.equal(resultado.excluidasViejas, 1, 'el comprobante de 2025 debe quedar excluido, no contar como faltante')
  assert.equal(resultado.totalArca, 3, 'solo los 3 comprobantes desde el 01/07/2026 entran en la comparación')

  assert.equal(resultado.faltantes.length, 1)
  assert.equal(resultado.faltantes[0].numero, '4-102')

  assert.equal(resultado.diferencias.length, 1)
  assert.equal(resultado.diferencias[0].numero, '0004-00000101')
  assert.ok(Math.abs(resultado.diferencias[0].diferencia - 600) < 0.01, 'ARCA 1500 vs sistema 900 = diferencia de 600')

  // No se asume una cantidad exacta de sobrantes: al no filtrar por proveedor
  // (a propósito, el archivo de ARCA es de toda la empresa), otras facturas de
  // compra creadas por OTROS tests dentro de este mismo rango de fechas también
  // cuentan como sobrantes legítimos — solo se verifica que la nuestra aparezca.
  assert.ok(resultado.sobrantes.some(s => s.numero === '0004-00000999'), 'la factura sin correlato en ARCA debe listarse como sobrante')

  assert.equal(resultado.coinciden, 1, 'la factura 0004-00000100 coincide exacto y no debe figurar en ningún listado')
})

test('Comparar con ARCA: una factura cargada con fecha en formato DD/MM/YYYY no debe figurar como faltante', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const factura = await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: '0004-00000200', tipo_factura: 'A', fecha: '2026-07-15', proveedor_nombre: 'Proveedor Formato Viejo Test', cuit: '30-99998888-7', importe: 1000, moneda: 'PESO' }),
  }).then(r => r.json())
  // Simula el dato tal como quedó de una migración vieja: fecha en DD/MM/YYYY.
  const db = new Database(DB_PATH)
  db.prepare("UPDATE facturas_compra SET fecha='15/07/2026' WHERE id=?").run(factura.id)
  db.close()

  const HEADERS = ['Fecha', 'Tipo', 'Punto de Venta', 'Número Desde', 'Número Hasta', 'Cód. Autorización',
    'Tipo Doc. Emisor', 'Nro. Doc. Emisor', 'Denominación Emisor', 'Tipo Doc. Receptor', 'Nro. Doc. Receptor',
    'Tipo Cambio', 'Moneda', 'Neto Grav. IVA 21%', 'IVA 21%', 'Neto Gravado Total', 'Neto No Gravado',
    'Op. Exentas', 'Otros Tributos', 'Total IVA', 'Imp. Total']
  const row = new Array(HEADERS.length).fill('')
  row[0] = '15/07/2026'; row[1] = '1 - Factura A'; row[2] = 4; row[3] = 200; row[4] = 200
  row[7] = '30-99998888-7'; row[8] = 'Proveedor Formato Viejo Test'; row[11] = 1; row[12] = '$'; row[20] = 1000
  const aoa = [['Mis Comprobantes Recibidos - CUIT 30714543381'], HEADERS, row]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Hoja1')
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  const fd = new FormData()
  fd.append('archivo', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'comprobantes.xlsx')
  const r = await fetch(`${BASE}/finanzas/facturas-compra/comparar-arca`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}` }, body: fd,
  })
  const resultado = await r.json()

  assert.ok(!resultado.faltantes.some(f => f.numero === '4-200'), 'con la fecha normalizada, la factura sí se encuentra en el sistema')
})

test('Facturas de Venta: acepta IVA 10.5% además de IVA 21%, y lo actualiza por PUT', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })
  const factura = await fetch(`${BASE}/finanzas/facturas-venta`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      numero: 'FV-IVA105-1', tipo_factura: 'A', fecha: '2026-12-10', cliente_nombre: 'Cliente IVA 10.5 Test',
      neto_gravado: 1000, iva_21: 0, iva_10_5: 105, importe: 1105, moneda: 'PESO',
    }),
  }).then(r => r.json())
  assert.equal(factura.iva_10_5, 105, 'debe guardar el IVA 10.5% al crear la factura')

  const editada = await fetch(`${BASE}/finanzas/facturas-venta/${factura.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ iva_10_5: 210 }),
  }).then(r => r.json())
  assert.equal(editada.iva_10_5, 210, 'debe poder actualizarse el IVA 10.5% por separado')
})

test('Notas de Crédito (Venta): anulan una factura total o parcialmente, y quedan vinculadas entre sí', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const original = await fetch(`${BASE}/finanzas/facturas-venta`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FV-NC-ORIG-1', tipo_factura: 'A', fecha: '2026-12-15', cliente_nombre: 'Cliente NC Test', importe: 1000, moneda: 'PESO' }),
  }).then(r => r.json())

  // Sin nc_factura_id: debe rechazarse.
  const sinVinculo = await fetch(`${BASE}/finanzas/facturas-venta`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FV-NC-SINVINCULO', tipo_factura: 'NC A', fecha: '2026-12-16', cliente_nombre: 'Cliente NC Test', importe: 300, moneda: 'PESO' }),
  })
  assert.equal(sinVinculo.status, 400, 'una NC sin factura a anular debe rechazarse')

  // NC parcial (300 de 1000).
  await fetch(`${BASE}/finanzas/facturas-venta`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FV-NC-PARCIAL', tipo_factura: 'NC A', fecha: '2026-12-16', cliente_nombre: 'Cliente NC Test', importe: 300, moneda: 'PESO', nc_factura_id: original.id }),
  })

  let lista = await fetch(`${BASE}/finanzas/facturas-venta?buscar=Cliente NC Test`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  let orig = lista.find(f => f.id === original.id)
  let ncParcial = lista.find(f => f.numero === 'FV-NC-PARCIAL')
  assert.equal(orig.anulada, false, 'una NC parcial no debe marcar la factura como anulada del todo')
  assert.equal(orig.saldo_pendiente, 700, 'el saldo pendiente debe descontar el importe de la NC parcial')
  assert.equal(ncParcial.nc_factura_numero, 'FV-NC-ORIG-1', 'la NC debe mostrar qué factura anula')

  // Otra NC más, que termina de cubrir el total (700 restante).
  await fetch(`${BASE}/finanzas/facturas-venta`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FV-NC-RESTO', tipo_factura: 'NC A', fecha: '2026-12-17', cliente_nombre: 'Cliente NC Test', importe: 700, moneda: 'PESO', nc_factura_id: original.id }),
  })
  lista = await fetch(`${BASE}/finanzas/facturas-venta?buscar=Cliente NC Test`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  orig = lista.find(f => f.id === original.id)
  assert.equal(orig.anulada, true, 'la suma de las NC debe terminar de anular la factura')
  assert.equal(orig.saldo_pendiente, 0, 'una factura anulada no debe seguir figurando con saldo pendiente')

  // Una NC no puede anular a otra NC.
  const ncSobreNc = await fetch(`${BASE}/finanzas/facturas-venta`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FV-NC-INVALIDA', tipo_factura: 'NC A', fecha: '2026-12-18', cliente_nombre: 'Cliente NC Test', importe: 100, moneda: 'PESO', nc_factura_id: ncParcial.id }),
  })
  assert.equal(ncSobreNc.status, 400, 'una NC no puede anular a otra NC')

  // No se puede borrar una factura que tiene una NC vinculada.
  const borrado = await fetch(`${BASE}/finanzas/facturas-venta/${original.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${t}` } })
  assert.equal(borrado.status, 400, 'no debe poder eliminarse una factura anulada por una NC sin antes desvincularla')
})

test('Notas de Crédito (Compra): mismo mecanismo de anulación total/parcial que en Venta', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const original = await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FC-NC-ORIG-1', tipo_factura: 'A', fecha: '2026-12-15', proveedor_nombre: 'Proveedor NC Test', importe: 500, moneda: 'PESO' }),
  }).then(r => r.json())

  await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FC-NC-TOTAL', tipo_factura: 'NC A', fecha: '2026-12-16', proveedor_nombre: 'Proveedor NC Test', importe: 500, moneda: 'PESO', nc_factura_id: original.id }),
  })

  const lista = await fetch(`${BASE}/finanzas/facturas-compra?buscar=Proveedor NC Test`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  const orig = lista.find(f => f.id === original.id)
  const nc = lista.find(f => f.numero === 'FC-NC-TOTAL')
  assert.equal(orig.anulada, true, 'la NC por el total debe dejar la factura de compra anulada')
  assert.equal(orig.saldo_pendiente, 0)
  assert.equal(nc.nc_factura_numero, 'FC-NC-ORIG-1', 'la NC de compra debe mostrar qué factura anula')
})

test('NC + pago parcial que juntos saldan una factura deben marcarla como cobrada/pagada', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  // Venta: factura de 1000, pago de 700 y NC de 300 — entre los dos cubren el total.
  const facturaV = await fetch(`${BASE}/finanzas/facturas-venta`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FV-NC-MASPAGO-1', tipo_factura: 'A', fecha: '2026-12-15', cliente_nombre: 'Cliente NC+Pago Test', importe: 1000, moneda: 'PESO' }),
  }).then(r => r.json())
  await fetch(`${BASE}/finanzas/facturas-venta/${facturaV.id}/pagos`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo: 'parcial', forma_pago: 'transferencia', importe: 700, moneda: 'PESO', fecha: '2026-12-16' }),
  })
  let facturaVFinal = await fetch(`${BASE}/finanzas/facturas-venta`, { headers: { Authorization: `Bearer ${t}` } })
    .then(r => r.json()).then(rows => rows.find(f => f.id === facturaV.id))
  assert.equal(facturaVFinal.pago_confirmado, 0, 'con solo 700 de 1000 pagados, todavía no debe figurar como cobrada')

  // La NC se carga DESPUÉS del pago — debe recalcular igual, sin necesitar tocar el pago.
  await fetch(`${BASE}/finanzas/facturas-venta`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FV-NC-MASPAGO-NC', tipo_factura: 'NC A', fecha: '2026-12-17', cliente_nombre: 'Cliente NC+Pago Test', importe: 300, moneda: 'PESO', nc_factura_id: facturaV.id }),
  })
  facturaVFinal = await fetch(`${BASE}/finanzas/facturas-venta`, { headers: { Authorization: `Bearer ${t}` } })
    .then(r => r.json()).then(rows => rows.find(f => f.id === facturaV.id))
  assert.equal(facturaVFinal.saldo_pendiente, 0, 'el pago de 700 + la NC de 300 deben dejar el saldo en 0')
  assert.equal(facturaVFinal.pago_confirmado, 1, 'pago parcial + NC que juntos cubren el total deben marcar la factura como cobrada')

  // Compra: mismo mecanismo, del lado de proveedores.
  const facturaC = await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FC-NC-MASPAGO-1', tipo_factura: 'A', fecha: '2026-12-15', proveedor_nombre: 'Proveedor NC+Pago Test', importe: 500, moneda: 'PESO' }),
  }).then(r => r.json())
  await fetch(`${BASE}/finanzas/facturas-compra/${facturaC.id}/pagos`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo: 'parcial', forma_pago: 'transferencia', importe: 350, moneda: 'PESO', fecha: '2026-12-16' }),
  })
  await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FC-NC-MASPAGO-NC', tipo_factura: 'NC A', fecha: '2026-12-17', proveedor_nombre: 'Proveedor NC+Pago Test', importe: 150, moneda: 'PESO', nc_factura_id: facturaC.id }),
  })
  const facturaCFinal = await fetch(`${BASE}/finanzas/facturas-compra`, { headers: { Authorization: `Bearer ${t}` } })
    .then(r => r.json()).then(rows => rows.find(f => f.id === facturaC.id))
  assert.equal(facturaCFinal.saldo_pendiente, 0, 'el pago de 350 + la NC de 150 deben dejar el saldo en 0 (compra)')
  assert.equal(facturaCFinal.pago_confirmado, 1, 'pago parcial + NC que juntos cubren el total deben marcar la factura de compra como pagada')

  // Desvincular la NC (editarla para que anule otra factura) debe recalcular la original y dejarla impaga de nuevo.
  const otraFacturaC = await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FC-NC-MASPAGO-OTRA', tipo_factura: 'A', fecha: '2026-12-15', proveedor_nombre: 'Proveedor NC+Pago Test', importe: 150, moneda: 'PESO' }),
  }).then(r => r.json())
  const ncC = await fetch(`${BASE}/finanzas/facturas-compra?buscar=FC-NC-MASPAGO-NC`, { headers: { Authorization: `Bearer ${t}` } })
    .then(r => r.json()).then(rows => rows.find(f => f.numero === 'FC-NC-MASPAGO-NC'))
  await fetch(`${BASE}/finanzas/facturas-compra/${ncC.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nc_factura_id: otraFacturaC.id }),
  })
  const facturaCTrasDesvincular = await fetch(`${BASE}/finanzas/facturas-compra`, { headers: { Authorization: `Bearer ${t}` } })
    .then(r => r.json()).then(rows => rows.find(f => f.id === facturaC.id))
  assert.equal(facturaCTrasDesvincular.pago_confirmado, 0, 'al desvincular la NC de la factura original, debe volver a quedar impaga (solo tiene 350 de 500)')
})

test('Dashboard: una factura anulada del todo por una NC (sin ningún pago) no debe figurar como pendiente de cobrar/pagar', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  // Vencimiento dentro de los próximos 30 días desde "ahora", para que también
  // se pueda probar contra el listado de "Próximos vencimientos" del dashboard.
  const fechaVto = fechaArgentinaHace(-10)

  // Venta: factura anulada 100% por una NC, como el caso de Deltacar (factura
  // + NC por el mismo importe, sin ningún cobro real de por medio).
  const facturaV = await fetch(`${BASE}/finanzas/facturas-venta`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FV-DASH-ANULADA-1', tipo_factura: 'A', fecha: '2026-05-14', cliente_nombre: 'Deltacar Dash Test', importe: 1000, moneda: 'PESO', fecha_vencimiento: fechaVto }),
  }).then(r => r.json())
  await fetch(`${BASE}/finanzas/facturas-venta`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'NC-DASH-ANULA-1', tipo_factura: 'NC', fecha: '2026-05-15', cliente_nombre: 'Deltacar Dash Test', importe: 1000, moneda: 'PESO', nc_factura_id: facturaV.id }),
  })

  // Compra: mismo caso, del lado de proveedores.
  const facturaC = await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FC-DASH-ANULADA-1', tipo_factura: 'A', fecha: '2026-05-14', proveedor_nombre: 'Proveedor Dash Test', importe: 500, moneda: 'PESO', fecha_vencimiento: fechaVto }),
  }).then(r => r.json())
  await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'NC-DASH-ANULA-1', tipo_factura: 'NC', fecha: '2026-05-15', proveedor_nombre: 'Proveedor Dash Test', importe: 500, moneda: 'PESO', nc_factura_id: facturaC.id }),
  })

  const dash = await fetch(`${BASE}/finanzas/dashboard-diario`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  assert.ok(!dash.facturasPorCobrar.some(f => f.id === facturaV.id), 'una factura de venta anulada del todo por NC no debe listarse como pendiente de cobrar')
  assert.ok(!dash.facturasPorPagar.some(f => f.id === facturaC.id), 'una factura de compra anulada del todo por NC no debe listarse como pendiente de pagar')

  const dashboard = await fetch(`${BASE}/finanzas/dashboard`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  assert.ok(!dashboard.vencimientos.some(v => v.id === facturaV.id && v.tipo === 'venta'), 'tampoco debe listarse entre los próximos vencimientos (venta)')
  assert.ok(!dashboard.vencimientos.some(v => v.id === facturaC.id && v.tipo === 'compra'), 'tampoco debe listarse entre los próximos vencimientos (compra)')
})

test('Recibir OC: actualiza el precio de costo del material en stock con el precio pagado en la OC', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const producto = await fetch(`${BASE}/stock/productos`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'REC-PRECIO-1', descripcion: 'Material para recepcion', precio_costo: 10 }),
  }).then(r => r.json())

  // La OC se crea con el item SIN codificar (como cuando se carga a mano sin
  // saber todavía qué código de stock corresponde) — se codifica recién al
  // recibir, que es justo el caso que antes no actualizaba el precio.
  const oc = await fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proveedor_nombre: 'Proveedor Recepcion Test', fecha: '2026-01-01', moneda: 'PESOS',
      items: [{ descripcion: 'Material para recepcion', cantidad: 5, precio_unitario: 250, precio_final: 250, sin_codificar: true }],
    }),
  }).then(r => r.json())
  const item = oc.items[0]
  assert.equal(item.producto_id, null, 'el item arranca sin codificar')

  await fetch(`${BASE}/compras/oc/${oc.id}/recibir`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fecha: '2026-01-10',
      producto_ids: { [item.id]: producto.id },
      recepciones: { [item.id]: 5 },
    }),
  })

  const productoTrasRecibir = await fetch(`${BASE}/stock/productos`, { headers: { Authorization: `Bearer ${t}` } })
    .then(r => r.json()).then(rows => rows.find(p => p.id === producto.id))
  assert.equal(productoTrasRecibir.precio_costo, 250, 'el precio de costo del material debe actualizarse con el precio de la OC al recibirlo')
  assert.equal(productoTrasRecibir.precio_fecha, '2026-01-10', 'la fecha del último precio debe quedar en la fecha de recepción de la OC')
  assert.equal(productoTrasRecibir.proveedor, 'Proveedor Recepcion Test', 'el proveedor de la OC recibida también debe quedar en el catálogo, no solo el precio')
})

test('OC de compras: al crearla con un ítem ya codificado, el proveedor de la OC queda en el catálogo del material (no solo el precio)', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const producto = await fetch(`${BASE}/stock/productos`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'REC-PROV-1', descripcion: 'Material con item ya codificado' }),
  }).then(r => r.json())
  assert.equal(producto.proveedor, '', 'arranca sin proveedor')

  await fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proveedor_nombre: 'Proveedor Alta OC Test', fecha: '2026-01-01', moneda: 'PESOS',
      items: [{ producto_id: producto.id, descripcion: 'Material con item ya codificado', cantidad: 2, precio_unitario: 300, precio_final: 300 }],
    }),
  })

  const trasAlta = await fetch(`${BASE}/stock/productos`, { headers: { Authorization: `Bearer ${t}` } })
    .then(r => r.json()).then(rows => rows.find(p => p.id === producto.id))
  assert.equal(trasAlta.precio_costo, 300)
  assert.equal(trasAlta.proveedor, 'Proveedor Alta OC Test', 'ya al crear la OC (sin esperar a recibirla) debe quedar el proveedor en el catálogo')

  // Una segunda OC de OTRO proveedor refresca el proveedor del catálogo (mismo criterio que el precio: siempre el más reciente).
  await fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proveedor_nombre: 'Proveedor Alta OC Test 2', fecha: '2026-01-05', moneda: 'PESOS',
      items: [{ producto_id: producto.id, descripcion: 'Material con item ya codificado', cantidad: 1, precio_unitario: 320, precio_final: 320 }],
    }),
  })
  const trasSegundaOC = await fetch(`${BASE}/stock/productos`, { headers: { Authorization: `Bearer ${t}` } })
    .then(r => r.json()).then(rows => rows.find(p => p.id === producto.id))
  assert.equal(trasSegundaOC.proveedor, 'Proveedor Alta OC Test 2', 'el proveedor del catálogo debe reflejar la OC más reciente, igual que el precio')
})

test('Materiales: el precio guarda la fecha de la última vez que cambió, no se pisa si se edita sin tocar el precio', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })
  const hoy = hoyArgentina()

  // Crear sin precio: no debe quedar ninguna fecha.
  const sinPrecio = await fetch(`${BASE}/materiales`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'PRECIOFECHA-1', descripcion: 'Material sin precio inicial' }),
  }).then(r => r.json())
  assert.equal(sinPrecio.precio_fecha, '', 'sin precio cargado no debe quedar fecha')

  // Crear CON precio: debe quedar fechado hoy.
  const conPrecio = await fetch(`${BASE}/materiales`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'PRECIOFECHA-2', descripcion: 'Material con precio inicial', precio_costo: 100 }),
  }).then(r => r.json())
  assert.equal(conPrecio.precio_fecha, hoy, 'al crear con precio, la fecha debe quedar en el día de alta')

  // Dejar una fecha vieja de verdad (vía recepción de OC, que permite fechar el precio a mano)
  // para poder distinguir "se preservó" de "se volvió a fechar hoy por casualidad".
  const ocVieja = await fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proveedor_nombre: 'Proveedor PrecioFecha Test', fecha: '2026-01-01', moneda: 'PESOS',
      items: [{ producto_id: conPrecio.id, descripcion: 'Material con precio inicial', cantidad: 1, precio_unitario: 120, precio_final: 120 }],
    }),
  }).then(r => r.json())
  await fetch(`${BASE}/compras/oc/${ocVieja.id}/recibir`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fecha: '2026-01-05', recepciones: { [ocVieja.items[0].id]: 1 } }),
  })
  const conFechaVieja = await fetch(`${BASE}/materiales`, { headers: { Authorization: `Bearer ${admin}` } })
    .then(r => r.json()).then(rows => rows.find(p => p.id === conPrecio.id))
  assert.equal(conFechaVieja.precio_costo, 120)
  assert.equal(conFechaVieja.precio_fecha, '2026-01-05', 'la recepción de OC debe fechar el precio con la fecha de recepción, no con la de hoy')

  // Editar SIN cambiar el precio (solo la descripción): la fecha vieja no debe pisarse con la de hoy.
  const editSinCambioPrecio = await fetch(`${BASE}/materiales/${conPrecio.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...conFechaVieja, descripcion: 'Material con precio inicial (renombrado)' }),
  }).then(r => r.json())
  assert.equal(editSinCambioPrecio.precio_costo, 120, 'no tocar el precio en el PUT debe conservar el valor vigente')
  assert.equal(editSinCambioPrecio.precio_fecha, '2026-01-05', 'editar otro campo sin tocar el precio no debe pisar la fecha vieja con la de hoy')

  // Ahora sí cambiar el precio: recién ahí la fecha debe refrescarse a hoy.
  await fetch(`${BASE}/materiales/${conPrecio.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...conPrecio, precio_costo: 150 }),
  })
  const editConCambioPrecio = await fetch(`${BASE}/materiales`, { headers: { Authorization: `Bearer ${admin}` } })
    .then(r => r.json()).then(rows => rows.find(p => p.id === conPrecio.id))
  assert.equal(editConCambioPrecio.precio_costo, 150)
  assert.equal(editConCambioPrecio.precio_fecha, hoy, 'cambiar el precio de costo debe refrescar la fecha')

  // Lo mismo por el lado de Stock (alta de material desde Compras, POST /stock/productos).
  const desdeStock = await fetch(`${BASE}/stock/productos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'PRECIOFECHA-3', descripcion: 'Material alta desde Stock', precio_costo: 80 }),
  }).then(r => r.json())
  assert.equal(desdeStock.precio_fecha, hoy)
  await fetch(`${BASE}/stock/productos/${desdeStock.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...desdeStock, ubicacion: 'Estante Z9' }),
  })
  const trasEditarUbicacion = await fetch(`${BASE}/stock/productos`, { headers: { Authorization: `Bearer ${admin}` } })
    .then(r => r.json()).then(rows => rows.find(p => p.id === desdeStock.id))
  assert.equal(trasEditarUbicacion.precio_fecha, hoy, 'editar solo la ubicación no debe alterar la fecha del precio (sigue siendo hoy, no se rompe)')
})

test('Materiales: filtros por familia, alerta de stock y precio vencido se resuelven en el backend (no hace falta traer todo el catálogo)', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })
  const hoy = hoyArgentina()

  const prod = await fetch(`${BASE}/materiales`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'ZFILTRO001', descripcion: 'Material filtro familia Z' }),
  }).then(r => r.json())

  // Familia: por el primer caracter del código.
  const porFamilia = await fetch(`${BASE}/materiales?familia=Z`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.ok(porFamilia.some(p => p.id === prod.id), 'debe aparecer filtrando por familia Z')
  const otraFamilia = await fetch(`${BASE}/materiales?familia=Q`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.ok(!otraFamilia.some(p => p.id === prod.id), 'no debe aparecer en una familia que no le corresponde')

  // Alerta de stock: agotado (0), bajo (stock<=mínimo) y ok (>0).
  await fetch(`${BASE}/stock/movimientos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ producto_id: prod.id, tipo: 'entrada', cantidad: 5, fecha: hoy }),
  })
  await fetch(`${BASE}/materiales/${prod.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...prod, stock_minimo: 10 }),
  })
  const bajo = await fetch(`${BASE}/materiales?alerta=bajo`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.ok(bajo.some(p => p.id === prod.id), 'con 5 de stock y mínimo 10 debe salir en "Stock bajo"')
  const ok = await fetch(`${BASE}/materiales?alerta=ok`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.ok(ok.some(p => p.id === prod.id), 'con stock > 0 también debe salir en "Disponibles"')
  const agotado = await fetch(`${BASE}/materiales?alerta=agotado`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.ok(!agotado.some(p => p.id === prod.id), 'con stock > 0 no debe salir en "Agotados"')

  // Precio vencido.
  const critico = await fetch(`${BASE}/materiales`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'ZFILTRO002', descripcion: 'Material filtro vencido', precio_costo: 10, precio_critico: 1, precio_frecuencia_dias: 30 }),
  }).then(r => r.json())
  const sinVencidosTodavia = await fetch(`${BASE}/materiales?soloVencidos=1`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.ok(!sinVencidosTodavia.some(p => p.id === critico.id), 'recién actualizado, todavía no debe salir como vencido')
  const db = new Database(DB_PATH)
  db.prepare('UPDATE productos SET precio_fecha=? WHERE id=?').run(fechaArgentinaHace(40), critico.id)
  db.close()
  const vencidos = await fetch(`${BASE}/materiales?soloVencidos=1`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.ok(vencidos.some(p => p.id === critico.id), 'con el precio retrasado 40 días (frecuencia 30) debe salir como vencido')
  assert.ok(!vencidos.some(p => p.id === prod.id), 'un material no crítico no debe aparecer nunca en "soloVencidos"')

  // Limpieza: sacarle "crítico" para que este material vencido no le genere un
  // pedido automático de fondo a los tests que corren después (generarPedidosVencidos
  // no tiene throttle en NODE_ENV=test, así que corre en cualquier /pedidos-precio posterior).
  const dbCleanup = new Database(DB_PATH)
  dbCleanup.prepare('UPDATE productos SET precio_critico=0 WHERE id=?').run(critico.id)
  dbCleanup.close()
})

test('Costeo de Equipos: arma un costeo con materiales del sistema (convertidos a USD) y mano de obra manual, y calcula costo/venta', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })
  const hoy = hoyArgentina()

  // Tipo de cambio del sistema para convertir un material cargado en pesos a USD.
  await fetch(`${BASE}/finanzas/tipo-cambio`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ moneda: 'DÓLAR', valor: 1000, fuente: 'BNA', fecha: hoy }),
  })

  // Material en pesos (sin precio_moneda='DÓLAR'): 50000 ARS / 1000 = 50 USD.
  const matPesos = await fetch(`${BASE}/materiales`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'COSTEO-MAT-1', descripcion: 'Chapa de acero para costeo', unidad: 'UNIDAD', precio_costo: 50000 }),
  }).then(r => r.json())

  // Sin permiso de costeo_equipos, no puede ni ver el buscador de materiales.
  const sinPermiso = tok({ id: 999991, username: 'sin_costeo_test', nombre: 'Sin Costeo', rol: 'solo_lectura' })
  const rechazado = await fetch(`${BASE}/costeo-equipos/materiales?buscar=chapa`, { headers: { Authorization: `Bearer ${sinPermiso}` } })
  assert.equal(rechazado.status, 403)

  const busqueda = await fetch(`${BASE}/costeo-equipos/materiales?buscar=chapa+costeo`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  const encontrado = busqueda.find(p => p.id === matPesos.id)
  assert.ok(encontrado, 'debe encontrar el material por búsqueda')
  assert.equal(encontrado.precio_usd, 50, 'debe convertir 50.000 ARS a 50 USD usando el tipo de cambio del sistema')

  // Crear el costeo y guardarlo con un módulo: 2 unidades del material (100 USD) + 3 días de herrería a 200 USD/día (600 USD).
  const creado = await fetch(`${BASE}/costeo-equipos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Planta Test Costeo', cliente: 'Cliente Test' }),
  }).then(r => r.json())

  const guardado = await fetch(`${BASE}/costeo-equipos/${creado.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nombre: 'Planta Test Costeo', cliente: 'Cliente Test', fecha: hoy,
      utilidad_material: 1.8, utilidad_mano_obra: 1.5, utilidad_extra: 1.1, tipo_cambio: 1000,
      modulos: [{
        nombre: 'Módulo de prueba',
        items: [
          { tipo: 'material', producto_id: matPesos.id, descripcion: encontrado.descripcion, unidad: 'UNIDAD', cantidad: 2, precio_unitario: encontrado.precio_usd },
          { tipo: 'mano_obra', descripcion: 'Mano de obra Herrería', unidad: 'DIAS', cantidad: 3, precio_unitario: 200 },
        ],
      }],
    }),
  })
  assert.equal(guardado.status, 200)

  const detalle = await fetch(`${BASE}/costeo-equipos/${creado.id}`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.equal(detalle.modulos.length, 1)
  assert.equal(detalle.modulos[0].items.length, 2)
  assert.equal(detalle.costo_material, 100, '2 x 50 USD')
  assert.equal(detalle.costo_mano_obra, 600, '3 x 200 USD')
  assert.equal(detalle.costo_total, 700)
  assert.equal(detalle.venta_material, 180, '100 x 1.8')
  assert.equal(detalle.venta_mano_obra, 900, '600 x 1.5')
  assert.equal(detalle.venta_total, Math.round((180 + 900) * 1.1 * 100) / 100, '(180+900) x 1.1 de utilidad extra')
  assert.equal(Math.round(detalle.venta_total_pesos), Math.round(detalle.venta_total * 1000))

  // El listado también debe traer los totales ya calculados.
  const lista = await fetch(`${BASE}/costeo-equipos`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  const filaLista = lista.find(c => c.id === creado.id)
  assert.equal(filaLista.costo_total, 700)

  // Guardar de nuevo con un módulo distinto reemplaza el anterior por completo (no lo acumula).
  await fetch(`${BASE}/costeo-equipos/${creado.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nombre: 'Planta Test Costeo', cliente: 'Cliente Test', fecha: hoy,
      utilidad_material: 1, utilidad_mano_obra: 1, utilidad_extra: 1,
      modulos: [{ nombre: 'Módulo único', items: [{ tipo: 'material', descripcion: 'Otro item', unidad: 'UNIDAD', cantidad: 1, precio_unitario: 10 }] }],
    }),
  })
  const trasReemplazo = await fetch(`${BASE}/costeo-equipos/${creado.id}`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.equal(trasReemplazo.modulos.length, 1, 'debe reemplazar el módulo anterior, no acumularlo')
  assert.equal(trasReemplazo.costo_total, 10)

  // Solo quien tiene permiso de escritura puede guardar o borrar.
  const soloLectura = await fetch(`${BASE}/auth/usuarios`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'costeo_lector_test', nombre: 'Costeo Lector Test', password: 'inicial123', rol: 'solo_lectura' }),
  }).then(r => r.json())
  await fetch(`${BASE}/auth/usuarios/${soloLectura.id}/permisos`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ costeo_equipos: { leer: true, escribir: false } }),
  })
  const loginLector = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'costeo_lector_test', password: 'inicial123' }),
  }).then(r => r.json())
  const cambioLector = await fetch(`${BASE}/auth/usuarios/${soloLectura.id}/password`, {
    method: 'PUT', headers: { Authorization: `Bearer ${loginLector.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'nuevaClaveLector1' }),
  }).then(r => r.json())
  const puedeVer = await fetch(`${BASE}/costeo-equipos/${creado.id}`, { headers: { Authorization: `Bearer ${cambioLector.token}` } })
  assert.equal(puedeVer.status, 200, 'con permiso de lectura debe poder ver el detalle')
  const noPuedeGuardar = await fetch(`${BASE}/costeo-equipos/${creado.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${cambioLector.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Hackeo', modulos: [] }),
  })
  assert.equal(noPuedeGuardar.status, 403)
  const noPuedeBorrar = await fetch(`${BASE}/costeo-equipos/${creado.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${cambioLector.token}` } })
  assert.equal(noPuedeBorrar.status, 403)

  const borrado = await fetch(`${BASE}/costeo-equipos/${creado.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${admin}` } })
  assert.equal(borrado.status, 200)
  const yaNoExiste = await fetch(`${BASE}/costeo-equipos/${creado.id}`, { headers: { Authorization: `Bearer ${admin}` } })
  assert.equal(yaNoExiste.status, 404)
})

test('Costeo de Equipos: un material cargado en euros se convierte a USD pasando por pesos, no se trata como si fuera pesos', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })
  const hoy = hoyArgentina()

  await fetch(`${BASE}/finanzas/tipo-cambio`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ moneda: 'DÓLAR', valor: 1000, fuente: 'BNA', fecha: hoy }),
  })
  await fetch(`${BASE}/finanzas/tipo-cambio`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ moneda: 'EURO', valor: 1200, fuente: 'BNA', fecha: hoy }),
  })

  const matEuro = await fetch(`${BASE}/materiales`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'COSTEO-MAT-EUR', descripcion: 'Electroválvula EFFAST costeo', unidad: 'UNIDAD', precio_costo: 100, precio_moneda: 'EURO' }),
  }).then(r => r.json())

  const busqueda = await fetch(`${BASE}/costeo-equipos/materiales?buscar=EFFAST+costeo`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  const encontrado = busqueda.find(p => p.id === matEuro.id)
  assert.ok(encontrado, 'debe encontrar el material por búsqueda')
  // 100 EUR x 1200 (EUR->ARS) / 1000 (ARS->USD) = 120 USD — antes daba 0.1 (100/1000), tratando el euro como si fuera peso.
  assert.equal(encontrado.precio_usd, 120, 'debe convertir euros a USD pasando por pesos, no tratarlo como si ya fuera pesos')
})

test('Costeo de Equipos: el precio guardado queda congelado al momento de guardar — si el catálogo cambia después, solo se informa, no se actualiza solo', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })
  const hoy = hoyArgentina()

  await fetch(`${BASE}/finanzas/tipo-cambio`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ moneda: 'DÓLAR', valor: 1000, fuente: 'BNA', fecha: hoy }),
  })
  const mat = await fetch(`${BASE}/materiales`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'COSTEO-FROZEN-1', descripcion: 'Material precio congelado', unidad: 'UNIDAD', precio_costo: 100 }),
  }).then(r => r.json())

  const creado = await fetch(`${BASE}/costeo-equipos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Costeo Precio Congelado' }),
  }).then(r => r.json())
  await fetch(`${BASE}/costeo-equipos/${creado.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nombre: 'Costeo Precio Congelado', utilidad_material: 1, utilidad_mano_obra: 1, utilidad_extra: 1,
      modulos: [{ nombre: 'Módulo', items: [{ tipo: 'material', producto_id: mat.id, descripcion: 'Material precio congelado', unidad: 'UNIDAD', cantidad: 1, precio_unitario: 0.1 }] }],
    }),
  })

  const antesDeSubir = await fetch(`${BASE}/costeo-equipos/${creado.id}`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  const itemAntes = antesDeSubir.modulos[0].items[0]
  assert.equal(itemAntes.precio_unitario, 0.1, '100 ARS / 1000 TC = 0.1 USD al momento de guardar')
  assert.equal(itemAntes.precio_actual_usd, 0.1, 'el precio actual todavía coincide con el guardado')

  // Sube el precio del material en el catálogo — el costeo NO se toca.
  await fetch(`${BASE}/materiales/${mat.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...mat, precio_costo: 500 }),
  })

  const despuesDeSubir = await fetch(`${BASE}/costeo-equipos/${creado.id}`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  const itemDespues = despuesDeSubir.modulos[0].items[0]
  assert.equal(itemDespues.precio_unitario, 0.1, 'el precio guardado en el costeo no cambia solo aunque el catálogo haya cambiado')
  assert.equal(itemDespues.precio_actual_usd, 0.5, '500 ARS / 1000 TC = 0.5 USD — se informa el precio de hoy del catálogo, sin pisar el guardado')
  assert.equal(despuesDeSubir.costo_material, 0.1, 'el costo del costeo sigue calculado con el precio congelado, no con el actual')

  // Un ítem cargado a mano (sin producto_id) nunca tiene "precio actual" para comparar.
  await fetch(`${BASE}/costeo-equipos/${creado.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nombre: 'Costeo Precio Congelado', utilidad_material: 1, utilidad_mano_obra: 1, utilidad_extra: 1,
      modulos: [{ nombre: 'Módulo', items: [{ tipo: 'mano_obra', descripcion: 'Mano de obra suelta', unidad: 'DIAS', cantidad: 1, precio_unitario: 200 }] }],
    }),
  })
  const conManoDeObra = await fetch(`${BASE}/costeo-equipos/${creado.id}`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.equal(conManoDeObra.modulos[0].items[0].precio_actual_usd, null)
})

test('Costeo de Equipos: un ítem tipo "otro" (material que todavía no está en el catálogo) cuenta como costo de material', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const creado = await fetch(`${BASE}/costeo-equipos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Costeo Item Otro' }),
  }).then(r => r.json())

  await fetch(`${BASE}/costeo-equipos/${creado.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nombre: 'Costeo Item Otro', utilidad_material: 2, utilidad_mano_obra: 1, utilidad_extra: 1,
      modulos: [{
        nombre: 'Módulo',
        items: [
          { tipo: 'otro', descripcion: 'Bomba importada todavía sin codificar', unidad: 'UNIDAD', cantidad: 2, precio_unitario: 300 },
          { tipo: 'mano_obra', descripcion: 'Instalación', unidad: 'DIAS', cantidad: 1, precio_unitario: 100 },
        ],
      }],
    }),
  })

  const detalle = await fetch(`${BASE}/costeo-equipos/${creado.id}`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  const itemOtro = detalle.modulos[0].items.find(i => i.tipo === 'otro')
  assert.ok(itemOtro, 'debe guardar el tipo "otro" tal cual')
  assert.equal(itemOtro.producto_id, null, 'un ítem "otro" no está vinculado a ningún material del catálogo')
  assert.equal(itemOtro.precio_actual_usd, null, 'sin producto_id no hay precio actual con qué comparar')
  assert.equal(detalle.costo_material, 600, '2 x 300 del ítem "otro" cuenta como material, no como mano de obra')
  assert.equal(detalle.costo_mano_obra, 100)
  assert.equal(detalle.venta_material, 1200, '600 x utilidad_material 2')
})

test('Pedido de precio: cualquiera lo pide desde Materiales/Análisis de Proyectos, y solo Administración ve la cola y la resuelve', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const prod = await fetch(`${BASE}/materiales`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'PEDPRECIO-1', descripcion: 'Material sin precio para pedir' }),
  }).then(r => r.json())

  // Un usuario con acceso a Materiales pero SIN acceso a Administración puede pedir el precio.
  const solicitante = await fetch(`${BASE}/auth/usuarios`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'solicitante_pedprecio_test', nombre: 'Solicitante Pedprecio Test', password: 'inicial123', rol: 'solo_lectura' }),
  }).then(r => r.json())
  await fetch(`${BASE}/auth/usuarios/${solicitante.id}/permisos`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ materiales: { leer: true, escribir: false } }),
  })
  const loginSol = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'solicitante_pedprecio_test', password: 'inicial123' }),
  }).then(r => r.json())
  const cambioSol = await fetch(`${BASE}/auth/usuarios/${solicitante.id}/password`, {
    method: 'PUT', headers: { Authorization: `Bearer ${loginSol.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'nuevaClaveSol1' }),
  }).then(r => r.json())
  const solTok = cambioSol.token

  const pedido = await fetch(`${BASE}/pedidos-precio`, {
    method: 'POST', headers: { Authorization: `Bearer ${solTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ producto_id: prod.id }),
  })
  assert.equal(pedido.status, 201)
  const pedidoData = await pedido.json()
  assert.equal(pedidoData.solicitante_nombre, 'Solicitante Pedprecio Test')

  // Pedirlo de nuevo (ej. desde Análisis de Proyectos) no duplica: devuelve el mismo pendiente.
  const pedidoDup = await fetch(`${BASE}/pedidos-precio`, {
    method: 'POST', headers: { Authorization: `Bearer ${solTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ producto_id: prod.id }),
  }).then(r => r.json())
  assert.equal(pedidoDup.id, pedidoData.id, 'un segundo pedido para el mismo material no debe duplicar la fila')

  // Cualquier usuario logueado puede ver qué materiales tienen pedido pendiente (para pintar el botón).
  const pendientesIds = await fetch(`${BASE}/pedidos-precio/pendientes-ids`, { headers: { Authorization: `Bearer ${solTok}` } }).then(r => r.json())
  assert.ok(pendientesIds.some(p => p.producto_id === prod.id))

  // El solicitante NO tiene permiso de Administración: no puede ver la cola completa ni resolverla.
  const listadoRechazado = await fetch(`${BASE}/pedidos-precio`, { headers: { Authorization: `Bearer ${solTok}` } })
  assert.equal(listadoRechazado.status, 403)
  const resolverRechazado = await fetch(`${BASE}/pedidos-precio/${pedidoData.id}/resolver`, {
    method: 'POST', headers: { Authorization: `Bearer ${solTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ precio_costo: 500 }),
  })
  assert.equal(resolverRechazado.status, 403)

  // Alguien de Administración (sin necesitar permiso de Materiales) ve la cola y la resuelve.
  const deAdmin = await fetch(`${BASE}/auth/usuarios`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'administracion_pedprecio_test', nombre: 'Administracion Pedprecio Test', password: 'inicial123', rol: 'solo_lectura' }),
  }).then(r => r.json())
  await fetch(`${BASE}/auth/usuarios/${deAdmin.id}/permisos`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ administracion: { leer: true, escribir: true } }),
  })
  const loginDeAdmin = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'administracion_pedprecio_test', password: 'inicial123' }),
  }).then(r => r.json())
  const cambioDeAdmin = await fetch(`${BASE}/auth/usuarios/${deAdmin.id}/password`, {
    method: 'PUT', headers: { Authorization: `Bearer ${loginDeAdmin.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'nuevaClaveAdmin1' }),
  }).then(r => r.json())
  const adminTok2 = cambioDeAdmin.token

  const cola = await fetch(`${BASE}/pedidos-precio`, { headers: { Authorization: `Bearer ${adminTok2}` } }).then(r => r.json())
  assert.equal(cola.length, 1, 'la cola debe mostrar SOLO el material pedido, no todo el catálogo')
  assert.equal(cola[0].codigo, 'PEDPRECIO-1')
  assert.equal(cola[0].proveedor, '', 'el material se creó sin proveedor, la cola debe mostrarlo vacío para poder completarlo')

  // Rechaza un precio inválido.
  const invalido = await fetch(`${BASE}/pedidos-precio/${pedidoData.id}/resolver`, {
    method: 'POST', headers: { Authorization: `Bearer ${adminTok2}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ precio_costo: 0 }),
  })
  assert.equal(invalido.status, 400)

  // Carga el precio Y el proveedor que faltaba, en el mismo paso.
  const resolver = await fetch(`${BASE}/pedidos-precio/${pedidoData.id}/resolver`, {
    method: 'POST', headers: { Authorization: `Bearer ${adminTok2}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ precio_costo: 456.78, proveedor: 'Proveedor Cargado Desde Pedido Precio' }),
  })
  assert.equal(resolver.status, 200)

  const materialActualizado = await fetch(`${BASE}/materiales`, { headers: { Authorization: `Bearer ${admin}` } })
    .then(r => r.json()).then(rows => rows.find(p => p.id === prod.id))
  assert.equal(materialActualizado.precio_costo, 456.78)
  assert.equal(materialActualizado.precio_fecha, hoyArgentina())
  assert.equal(materialActualizado.proveedor, 'Proveedor Cargado Desde Pedido Precio', 'el proveedor cargado junto con el precio debe quedar guardado en el material')

  // Resuelto: desaparece de la cola y de "pendientes-ids", y no se puede resolver dos veces.
  const colaVacia = await fetch(`${BASE}/pedidos-precio`, { headers: { Authorization: `Bearer ${adminTok2}` } }).then(r => r.json())
  assert.equal(colaVacia.length, 0)
  const pendientesIdsFinal = await fetch(`${BASE}/pedidos-precio/pendientes-ids`, { headers: { Authorization: `Bearer ${solTok}` } }).then(r => r.json())
  assert.ok(!pendientesIdsFinal.some(p => p.producto_id === prod.id))
  const yaResuelto = await fetch(`${BASE}/pedidos-precio/${pedidoData.id}/resolver`, {
    method: 'POST', headers: { Authorization: `Bearer ${adminTok2}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ precio_costo: 999 }),
  })
  assert.equal(yaResuelto.status, 400)

  // Si el material YA tenía proveedor y se resuelve sin mandar "proveedor" en el body, no se pisa.
  const prod3 = await fetch(`${BASE}/materiales`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'PEDPRECIO-3', descripcion: 'Material con proveedor ya cargado', proveedor: 'Proveedor Preexistente' }),
  }).then(r => r.json())
  const pedido3 = await fetch(`${BASE}/pedidos-precio`, {
    method: 'POST', headers: { Authorization: `Bearer ${solTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ producto_id: prod3.id }),
  }).then(r => r.json())
  const cola3 = await fetch(`${BASE}/pedidos-precio`, { headers: { Authorization: `Bearer ${adminTok2}` } }).then(r => r.json())
  assert.equal(cola3.find(p => p.id === pedido3.id).proveedor, 'Proveedor Preexistente', 'la cola debe mostrar el proveedor que ya tenía el material')
  await fetch(`${BASE}/pedidos-precio/${pedido3.id}/resolver`, {
    method: 'POST', headers: { Authorization: `Bearer ${adminTok2}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ precio_costo: 10 }),
  })
  const prod3Final = await fetch(`${BASE}/materiales`, { headers: { Authorization: `Bearer ${admin}` } })
    .then(r => r.json()).then(rows => rows.find(p => p.id === prod3.id))
  assert.equal(prod3Final.proveedor, 'Proveedor Preexistente', 'no mandar "proveedor" al resolver no debe borrar el que ya tenía')

  // Cancelar: el solicitante original puede cancelar su propio pedido; alguien
  // de Administración (sin permiso de Compras) NO puede cancelar uno ajeno —
  // ese botón se sacó de Administración a propósito y solo vive en Materiales
  // (Compras); un tercero sin ninguna de las dos cosas tampoco puede.
  const prod2 = await fetch(`${BASE}/materiales`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'PEDPRECIO-2', descripcion: 'Otro material para cancelar pedido' }),
  }).then(r => r.json())
  const bystander = await fetch(`${BASE}/auth/usuarios`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'bystander_pedprecio_test', nombre: 'Bystander Pedprecio Test', password: 'inicial123', rol: 'solo_lectura' }),
  }).then(r => r.json())
  const loginBystander = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'bystander_pedprecio_test', password: 'inicial123' }),
  }).then(r => r.json())
  const cambioBystander = await fetch(`${BASE}/auth/usuarios/${bystander.id}/password`, {
    method: 'PUT', headers: { Authorization: `Bearer ${loginBystander.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'nuevaClaveBystander1' }),
  }).then(r => r.json())
  const bystanderTok = cambioBystander.token

  const pedido2 = await fetch(`${BASE}/pedidos-precio`, {
    method: 'POST', headers: { Authorization: `Bearer ${solTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ producto_id: prod2.id }),
  }).then(r => r.json())
  const cancelacionSinPermiso = await fetch(`${BASE}/pedidos-precio/${pedido2.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${bystanderTok}` } })
  assert.equal(cancelacionSinPermiso.status, 403, 'quien no pidió el precio ni tiene permiso de Compras no puede cancelarlo')
  const cancelacionDesdeAdministracion = await fetch(`${BASE}/pedidos-precio/${pedido2.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${adminTok2}` } })
  assert.equal(cancelacionDesdeAdministracion.status, 403, 'permiso de Administración (sin Compras) ya no alcanza para cancelar uno ajeno — ese botón se sacó de esa pantalla')

  // El propio solicitante sí puede cancelar el suyo, sin necesitar ningún permiso de módulo.
  const cancelacionPropia = await fetch(`${BASE}/pedidos-precio/${pedido2.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${solTok}` } })
  assert.equal(cancelacionPropia.status, 200)
  const pendientesTrasCancelar = await fetch(`${BASE}/pedidos-precio/pendientes-ids`, { headers: { Authorization: `Bearer ${solTok}` } }).then(r => r.json())
  assert.ok(!pendientesTrasCancelar.some(p => p.producto_id === prod2.id))
})

test('Pedido de precio: con escritura de Compras (sin nada de Administración) se puede resolver y cancelar un pedido ajeno', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const prod = await fetch(`${BASE}/materiales`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'PEDPRECIO-COMPRAS', descripcion: 'Material para permiso de Compras' }),
  }).then(r => r.json())
  const pedido = await fetch(`${BASE}/pedidos-precio`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ producto_id: prod.id }),
  }).then(r => r.json())

  // Usuario con escritura de Compras pero SIN nada de Administración — así es
  // como Administración → Pedidos de precio igual le habilita "Cargar precio"
  // (canWrite mira compras.escribir además de administracion.escribir), y
  // "Cancelar" (que solo vive en Materiales) depende únicamente de Compras.
  const deCompras = await fetch(`${BASE}/auth/usuarios`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'compras_pedprecio_test', nombre: 'Compras Pedprecio Test', password: 'inicial123', rol: 'solo_lectura' }),
  }).then(r => r.json())
  await fetch(`${BASE}/auth/usuarios/${deCompras.id}/permisos`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ compras: { leer: true, escribir: true } }),
  })
  const loginDeCompras = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'compras_pedprecio_test', password: 'inicial123' }),
  }).then(r => r.json())
  const cambioDeCompras = await fetch(`${BASE}/auth/usuarios/${deCompras.id}/password`, {
    method: 'PUT', headers: { Authorization: `Bearer ${loginDeCompras.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'nuevaClaveCompras1' }),
  }).then(r => r.json())
  const comprasTok = cambioDeCompras.token

  const resolver = await fetch(`${BASE}/pedidos-precio/${pedido.id}/resolver`, {
    method: 'POST', headers: { Authorization: `Bearer ${comprasTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ precio_costo: 123.45 }),
  })
  assert.equal(resolver.status, 200, 'con escritura de Compras (aunque no de Administración) debe poder resolver el pedido')

  const pedido2 = await fetch(`${BASE}/pedidos-precio`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ producto_id: prod.id }),
  }).then(r => r.json())
  const cancelacion = await fetch(`${BASE}/pedidos-precio/${pedido2.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${comprasTok}` } })
  assert.equal(cancelacion.status, 200, 'con escritura de Compras también debe poder cancelar un pedido ajeno')
})

test('Precios críticos: un material marcado como crítico genera SOLO un pedido de precio cuando pasa la frecuencia configurada', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  // Crítico, revisión mensual (30 días).
  const critico = await fetch(`${BASE}/materiales`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'CRITICO-1', descripcion: 'Material con precio crítico', precio_costo: 100, precio_critico: 1, precio_frecuencia_dias: 30 }),
  }).then(r => r.json())
  assert.equal(critico.precio_critico, 1)
  assert.equal(critico.precio_frecuencia_dias, 30)

  // No crítico, mismo precio viejo — no debe generar nada.
  const noCritico = await fetch(`${BASE}/materiales`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'CRITICO-2', descripcion: 'Material sin marcar como crítico', precio_costo: 50 }),
  }).then(r => r.json())

  // Crítico pero el precio es reciente (recién cargado, no pasaron los 30 días) — todavía no debe generar nada.
  const criticoReciente = await fetch(`${BASE}/materiales`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'CRITICO-3', descripcion: 'Material crítico recién actualizado', precio_costo: 70, precio_critico: 1, precio_frecuencia_dias: 30 }),
  }).then(r => r.json())

  // Retrasar a mano la fecha del precio del primero, simulando que pasaron 40 días desde la última actualización.
  const db = new Database(DB_PATH)
  const fechaVieja = fechaArgentinaHace(40)
  db.prepare('UPDATE productos SET precio_fecha=? WHERE id=?').run(fechaVieja, critico.id)
  db.close()

  const pendientesIds = await fetch(`${BASE}/pedidos-precio/pendientes-ids`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.ok(pendientesIds.some(p => p.producto_id === critico.id), 'el material crítico con precio vencido debe generar su pedido solo')
  assert.ok(!pendientesIds.some(p => p.producto_id === noCritico.id), 'un material no marcado como crítico no debe generar nada aunque su precio sea viejo')
  assert.ok(!pendientesIds.some(p => p.producto_id === criticoReciente.id), 'un material crítico con precio reciente todavía no debe generar nada')

  const cola = await fetch(`${BASE}/pedidos-precio`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  const pedidoAuto = cola.find(p => p.producto_id === critico.id)
  assert.ok(pedidoAuto, 'debe aparecer en la cola de Administración')
  assert.equal(pedidoAuto.solicitante_nombre, 'Sistema (precio vencido)', 'debe distinguirse de un pedido hecho a mano por una persona')

  // Volver a consultar no debe duplicar el pedido automático ya generado.
  await fetch(`${BASE}/pedidos-precio/pendientes-ids`, { headers: { Authorization: `Bearer ${admin}` } })
  const colaFinal = await fetch(`${BASE}/pedidos-precio`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.equal(colaFinal.filter(p => p.producto_id === critico.id).length, 1, 'no debe duplicar el pedido automático en consultas sucesivas')
})

test('Cuotas de OC de compra: una OC facturada de a partes (anticipo) no aparece en Control OC mientras espera la próxima cuota', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const oc = await fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proveedor_nombre: 'Proveedor Cuotas OC Test', fecha: '2026-07-01', moneda: 'PESOS',
      items: [{ descripcion: 'item de prueba', cantidad: 1, precio_unitario: 1000, precio_final: 1000 }],
      cuotas: [
        { tipo: 'anticipo', pct: 50, monto_planeado: 500 },
        { tipo: 'saldo_final', pct: 50, monto_planeado: 500 },
      ],
    }),
  }).then(r => r.json())
  assert.equal(oc.cuotas.length, 2, 'la OC debe guardar las 2 cuotas cargadas')

  // Llega la factura del anticipo (50%, coincide con lo planeado).
  const facturaAnticipo = await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FC-ANTICIPO-1', fecha: '2026-07-05', proveedor_nombre: 'Proveedor Cuotas OC Test', neto_gravado: 500, importe: 500, moneda: 'PESOS' }),
  }).then(r => r.json())

  await fetch(`${BASE}/compras/oc/${oc.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cuotas: [
      { ...oc.cuotas[0], factura_id: facturaAnticipo.id },
      oc.cuotas[1],
    ] }),
  })

  const controlOC = await fetch(`${BASE}/finanzas/control-oc`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  assert.ok(!controlOC.some(r => r.oc_id === oc.id), 'no debe alertar: el anticipo coincide con lo planeado y falta la cuota del saldo')

  // La factura del anticipo debe haber quedado vinculada a la OC (mismo
  // mecanismo que el botón "Vincular factura").
  const ocDetalle = await fetch(`${BASE}/compras/oc/${oc.id}`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  assert.equal(ocDetalle.facturas.length, 1)
  assert.equal(ocDetalle.facturas[0].id, facturaAnticipo.id)

  // Si en cambio la factura del anticipo viene por mucho menos de lo
  // planeado, sí debe seguir marcando error (las cuotas no tapan errores reales).
  const oc2 = await fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proveedor_nombre: 'Proveedor Cuotas OC Test 2', fecha: '2026-07-01', moneda: 'PESOS',
      items: [{ descripcion: 'item de prueba', cantidad: 1, precio_unitario: 1000, precio_final: 1000 }],
      cuotas: [
        { tipo: 'anticipo', pct: 50, monto_planeado: 500 },
        { tipo: 'saldo_final', pct: 50, monto_planeado: 500 },
      ],
    }),
  }).then(r => r.json())
  const facturaChica = await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FC-ANTICIPO-CHICO', fecha: '2026-07-05', proveedor_nombre: 'Proveedor Cuotas OC Test 2', neto_gravado: 200, importe: 200, moneda: 'PESOS' }),
  }).then(r => r.json())
  await fetch(`${BASE}/compras/oc/${oc2.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cuotas: [{ ...oc2.cuotas[0], factura_id: facturaChica.id }, oc2.cuotas[1]] }),
  })
  const controlOC2 = await fetch(`${BASE}/finanzas/control-oc`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  assert.ok(controlOC2.some(r => r.oc_id === oc2.id), 'debe alertar: la factura del anticipo está muy por debajo de lo planeado para esa cuota')
})

test('Cuotas de OC de compra: rechaza vincular una factura ya usada por una cuota de otra OC', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const ocA = await fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proveedor_nombre: 'Proveedor Cuotas Conflicto', fecha: '2026-01-01', moneda: 'PESOS',
      items: [{ descripcion: 'item', cantidad: 1, precio_unitario: 500, precio_final: 500 }],
      cuotas: [{ tipo: 'unico', pct: 100, monto_planeado: 500 }],
    }),
  }).then(r => r.json())
  const factura = await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FC-CONFLICTO-1', fecha: '2026-01-05', proveedor_nombre: 'Proveedor Cuotas Conflicto', neto_gravado: 500, importe: 500, moneda: 'PESOS' }),
  }).then(r => r.json())
  await fetch(`${BASE}/compras/oc/${ocA.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cuotas: [{ ...ocA.cuotas[0], factura_id: factura.id }] }),
  })

  const ocB = await fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proveedor_nombre: 'Proveedor Cuotas Conflicto', fecha: '2026-01-01', moneda: 'PESOS',
      items: [{ descripcion: 'item', cantidad: 1, precio_unitario: 500, precio_final: 500 }],
      cuotas: [{ tipo: 'unico', pct: 100, monto_planeado: 500 }],
    }),
  }).then(r => r.json())
  const intento = await fetch(`${BASE}/compras/oc/${ocB.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cuotas: [{ ...ocB.cuotas[0], factura_id: factura.id }] }),
  })
  assert.equal(intento.status, 409, 'una factura ya usada por la cuota de otra OC no puede volver a vincularse')
})

test('Desvincular factura de una OC: la saca de "Facturas vinculadas" y limpia la cuota que la tuviera', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const oc = await fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proveedor_nombre: 'Proveedor Desvincular Test', fecha: '2026-01-01', moneda: 'PESOS',
      items: [{ descripcion: 'item', cantidad: 1, precio_unitario: 500, precio_final: 500 }],
      cuotas: [{ tipo: 'unico', pct: 100, monto_planeado: 500 }],
    }),
  }).then(r => r.json())
  const factura = await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FC-DESVINC-1', fecha: '2026-01-05', proveedor_nombre: 'Proveedor Desvincular Test', neto_gravado: 500, importe: 500, moneda: 'PESOS' }),
  }).then(r => r.json())
  await fetch(`${BASE}/compras/oc/${oc.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cuotas: [{ ...oc.cuotas[0], factura_id: factura.id }] }),
  })

  let detalle = await fetch(`${BASE}/compras/oc/${oc.id}`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  assert.equal(detalle.facturas.length, 1, 'la factura debe quedar vinculada tras guardar la cuota')
  assert.equal(detalle.cuotas[0].factura_id, factura.id)

  const resp = await fetch(`${BASE}/compras/oc/${oc.id}/desvincular-factura`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ factura_id: factura.id }),
  })
  assert.equal(resp.status, 200)

  detalle = await fetch(`${BASE}/compras/oc/${oc.id}`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  assert.equal(detalle.facturas.length, 0, 'la factura ya no debe figurar vinculada a la OC')
  assert.equal(detalle.cuotas[0].factura_id, null, 'la cuota que la tenía vinculada debe quedar limpia, no colgada de una factura que ya no pertenece a la OC')
})

test('Cuotas de OC de compra: si solo se carga el % (monto planeado vacío), Control OC lo estima solo con el %', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  // Caso real: el frontend manda monto_planeado como STRING VACÍO ("", no el
  // número 0) cuando el usuario nunca tocó ese campo — es la representación
  // real que rompía la comparación (un texto vacío guardado tal cual nunca
  // es "igual a 0" para SQLite, así que el fallback al % nunca se activaba).
  const oc = await fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proveedor_nombre: 'CASIBA SA TEST 2', fecha: '2026-07-24', moneda: 'PESOS',
      items: [{ descripcion: 'item', cantidad: 1, precio_unitario: 44962500, precio_final: 44962500 }],
      cuotas: [
        { tipo: 'anticipo', pct: 50, monto_planeado: '' },
        { tipo: 'saldo_final', pct: 50, monto_planeado: '' },
      ],
    }),
  }).then(r => r.json())

  const facturaAnticipo = await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: '0051-00044772', fecha: '2026-07-27', proveedor_nombre: 'CASIBA SA TEST 2', neto_gravado: 22436287.5, importe: 27372285.72, moneda: 'PESOS' }),
  }).then(r => r.json())

  await fetch(`${BASE}/compras/oc/${oc.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cuotas: [{ ...oc.cuotas[0], factura_id: facturaAnticipo.id }, oc.cuotas[1]] }),
  })

  const controlOC = await fetch(`${BASE}/finanzas/control-oc`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  assert.ok(!controlOC.some(r => r.oc_id === oc.id), 'con solo el % cargado (sin monto planeado) igual debe reconocer que el anticipo coincide con el 50%')
})

test('Administración: "OC sin factura" lista solo las Recibidas sin ninguna factura, y la secretaria puede vincular una factura suelta', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })
  const nuevo = await fetch(`${BASE}/auth/usuarios`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'secretaria_ocsf', nombre: 'Secretaria OCSF', password: 'test1234', rol: 'solo_lectura' }),
  }).then(r => r.json())
  await fetch(`${BASE}/auth/usuarios/${nuevo.id}/permisos`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ administracion: { leer: true, escribir: true } }),
  })
  const secretaria = tok({ id: nuevo.id, username: 'secretaria_ocsf', nombre: 'Secretaria OCSF', rol: 'solo_lectura' })

  const ocRecibidaSinFactura = await fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proveedor_nombre: 'Proveedor OC Sin Factura Test', fecha: '2026-07-01', moneda: 'PESOS',
      items: [{ descripcion: 'item', cantidad: 1, precio_unitario: 1000, precio_final: 1000 }],
    }),
  }).then(r => r.json())
  await fetch(`${BASE}/compras/oc/${ocRecibidaSinFactura.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado: 'Recibida' }),
  })

  const ocRecibidaConFactura = await fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proveedor_nombre: 'Proveedor OC Sin Factura Test', fecha: '2026-07-01', moneda: 'PESOS',
      items: [{ descripcion: 'item', cantidad: 1, precio_unitario: 1000, precio_final: 1000 }],
    }),
  }).then(r => r.json())
  await fetch(`${BASE}/compras/oc/${ocRecibidaConFactura.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado: 'Recibida' }),
  })
  await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FC-OCSF-YATIENE', fecha: '2026-01-02', proveedor_nombre: 'Proveedor OC Sin Factura Test', oc_id: ocRecibidaConFactura.id, oc_numero: ocRecibidaConFactura.numero, neto_gravado: 1000, importe: 1210, moneda: 'PESO' }),
  })

  const listaAdmin = await fetch(`${BASE}/compras/oc?estado=Recibida&sinFactura=1&buscar=${encodeURIComponent('Proveedor OC Sin Factura Test')}`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  const ids = listaAdmin.datos.map(o => o.id)
  assert.ok(ids.includes(ocRecibidaSinFactura.id), 'la OC recibida sin ninguna factura debe aparecer')
  assert.ok(!ids.includes(ocRecibidaConFactura.id), 'la OC recibida que ya tiene una factura vinculada NO debe aparecer')

  // La factura ya estaba cargada suelta (sin elegir la OC) — la secretaria la
  // vincula directo desde "OC sin factura", con permiso solo de administracion.
  const facturaSuelta = await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FC-OCSF-SUELTA', fecha: '2026-01-03', proveedor_nombre: 'Proveedor OC Sin Factura Test', neto_gravado: 1000, importe: 1210, moneda: 'PESO' }),
  }).then(r => r.json())

  const rSinPermisoCompras = await fetch(`${BASE}/compras/oc/${ocRecibidaSinFactura.id}/vincular-factura`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${secretaria}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ factura_id: facturaSuelta.id }),
  })
  assert.equal(rSinPermisoCompras.status, 200, 'con solo permiso de administracion.escribir debe poder vincular la factura desde esta pantalla')

  const listaTrasVincular = await fetch(`${BASE}/compras/oc?estado=Recibida&sinFactura=1&buscar=${encodeURIComponent('Proveedor OC Sin Factura Test')}`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.ok(!listaTrasVincular.datos.some(o => o.id === ocRecibidaSinFactura.id), 'tras vincular la factura, la OC debe salir de la lista de "sin factura"')
})

test('"OC sin factura" sin filtro de estado trae OC de cualquier estado, y la secretaria puede ver el detalle de solo lectura', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })
  const nuevo = await fetch(`${BASE}/auth/usuarios`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'secretaria_ocsf2', nombre: 'Secretaria OCSF2', password: 'test1234', rol: 'solo_lectura' }),
  }).then(r => r.json())
  await fetch(`${BASE}/auth/usuarios/${nuevo.id}/permisos`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ administracion: { leer: true, escribir: true } }),
  })
  const secretaria = tok({ id: nuevo.id, username: 'secretaria_ocsf2', nombre: 'Secretaria OCSF2', rol: 'solo_lectura' })

  // Queda en 'Emitida' (nunca se marca Recibida) — antes no aparecía en "OC sin factura".
  const ocEmitida = await fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proveedor_nombre: 'Proveedor OC Sin Factura Estados Test', fecha: '2026-07-05', moneda: 'PESOS',
      items: [{ descripcion: 'item emitida', cantidad: 1, precio_unitario: 500, precio_final: 500 }],
    }),
  }).then(r => r.json())

  const sinFiltro = await fetch(`${BASE}/compras/oc?sinFactura=1&buscar=${encodeURIComponent('Proveedor OC Sin Factura Estados Test')}`, { headers: { Authorization: `Bearer ${secretaria}` } }).then(r => r.json())
  assert.ok(sinFiltro.datos.some(o => o.id === ocEmitida.id), 'sin filtro de estado, una OC Emitida sin factura también debe listarse')

  const conFiltroRecibida = await fetch(`${BASE}/compras/oc?sinFactura=1&estado=Recibida&buscar=${encodeURIComponent('Proveedor OC Sin Factura Estados Test')}`, { headers: { Authorization: `Bearer ${secretaria}` } }).then(r => r.json())
  assert.ok(!conFiltroRecibida.datos.some(o => o.id === ocEmitida.id), 'filtrando por estado=Recibida, la OC Emitida no debe aparecer')

  // La secretaria (solo permiso de administracion, sin compras/finanzas) puede ver el detalle de solo lectura.
  const detalle = await fetch(`${BASE}/compras/oc/${ocEmitida.id}`, { headers: { Authorization: `Bearer ${secretaria}` } })
  assert.equal(detalle.status, 200, 'con permiso de administracion debe poder ver el detalle de la OC')
  const detalleJson = await detalle.json()
  assert.equal(detalleJson.items[0].descripcion, 'item emitida')
})

test('"OC sin factura" no lista OC de antes del 01/07/2026 (datos importados que nunca se van a completar)', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const crearOcRecibida = async (fecha, sufijo) => {
    const oc = await fetch(`${BASE}/compras/oc`, {
      method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proveedor_nombre: `Proveedor OCSF Fecha Corte ${sufijo}`, fecha, moneda: 'PESOS',
        items: [{ descripcion: 'item', cantidad: 1, precio_unitario: 1000, precio_final: 1000 }],
      }),
    }).then(r => r.json())
    await fetch(`${BASE}/compras/oc/${oc.id}`, {
      method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: 'Recibida' }),
    })
    return oc
  }

  const ocVieja  = await crearOcRecibida('2026-06-30', 'VIEJA')
  const ocLimite = await crearOcRecibida('2026-07-01', 'LIMITE')

  const lista = await fetch(`${BASE}/compras/oc?estado=Recibida&sinFactura=1&limit=500`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  const ids = lista.datos.map(o => o.id)
  assert.ok(!ids.includes(ocVieja.id), 'una OC recibida sin factura de antes del 01/07/2026 no debe aparecer')
  assert.ok(ids.includes(ocLimite.id), 'una OC recibida sin factura del 01/07/2026 (fecha límite, inclusive) sí debe aparecer')

  // Mismo caso que en Control OC: una OC importada con la fecha en formato
  // DD/MM/YYYY no debe colarse por una comparación de texto plano mal hecha.
  const db = new Database(DB_PATH)
  const ocFormatoViejo = await crearOcRecibida('2026-07-10', 'FORMATOVIEJO')
  db.prepare("UPDATE ordenes_compra SET fecha='27/05/2025' WHERE id=?").run(ocFormatoViejo.id)
  db.close()

  const lista2 = await fetch(`${BASE}/compras/oc?estado=Recibida&sinFactura=1&limit=500`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.ok(!lista2.datos.some(o => o.id === ocFormatoViejo.id), 'una OC vieja con fecha en formato DD/MM/YYYY tampoco debe aparecer')
})

test('Servicios: cargar un servicio nuevo no genera ninguna cuota fantasma, y pagar una cuota no fabrica la siguiente', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const serv = await fetch(`${BASE}/finanzas/servicios`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ descripcion: 'EDENOR Test Servicio', periodicidad: 'mensual', usuario: 'test@e-intrasrl.com' }),
  }).then(r => r.json())

  const cuotasIniciales = await fetch(`${BASE}/finanzas/servicios-cuotas?buscar=${encodeURIComponent('EDENOR Test Servicio')}`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  assert.equal(cuotasIniciales.length, 0, 'crear el servicio no debe generar ninguna cuota en blanco')

  // Sin monto: se rechaza.
  const sinMonto = await fetch(`${BASE}/finanzas/servicios/${serv.id}/cuotas`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ vencimiento: '2026-02-10' }),
  })
  assert.equal(sinMonto.status, 400, 'cargar un pago sin monto debe rechazarse')

  const cuota = await fetch(`${BASE}/finanzas/servicios/${serv.id}/cuotas`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ monto: 15000, vencimiento: '2026-02-10' }),
  }).then(r => r.json())
  assert.equal(cuota.estado, 'pendiente')
  assert.equal(cuota.monto, 15000)

  let lista = await fetch(`${BASE}/finanzas/servicios-cuotas?buscar=${encodeURIComponent('EDENOR Test Servicio')}`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  assert.equal(lista.length, 1, 'debe aparecer la cuota recién cargada')
  assert.equal(lista[0].monto, 15000, 'la cuota real siempre tiene un monto — nunca queda "sin importe"')

  // Pagar esa cuota: NO debe fabricar una próxima cuota en blanco.
  await fetch(`${BASE}/finanzas/servicios-cuotas/${cuota.id}/pagar`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fecha_pagada: '2026-02-11' }),
  })
  lista = await fetch(`${BASE}/finanzas/servicios-cuotas?buscar=${encodeURIComponent('EDENOR Test Servicio')}`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  assert.equal(lista.length, 1, 'pagar una cuota no debe crear ninguna cuota nueva')
  assert.equal(lista[0].estado, 'pagado')

  // Un segundo pago se carga como "ya pagado" directamente, sin pasar por pendiente.
  const cuotaPagadaDirecto = await fetch(`${BASE}/finanzas/servicios/${serv.id}/cuotas`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ monto: 15500, vencimiento: '2026-03-10', pagado: true, fecha_pagada: '2026-03-05' }),
  }).then(r => r.json())
  assert.equal(cuotaPagadaDirecto.estado, 'pagado')
  assert.equal(cuotaPagadaDirecto.fecha_pagada, '2026-03-05')

  lista = await fetch(`${BASE}/finanzas/servicios-cuotas?buscar=${encodeURIComponent('EDENOR Test Servicio')}&estado=pagado`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  assert.equal(lista.length, 2, 'ahora hay 2 pagos reales cargados, ambos pagados')

  // Eliminar un pago cargado por error.
  const borrado = await fetch(`${BASE}/finanzas/servicios-cuotas/${cuota.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${t}` } })
  assert.equal(borrado.status, 200)
  lista = await fetch(`${BASE}/finanzas/servicios-cuotas?buscar=${encodeURIComponent('EDENOR Test Servicio')}`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  assert.equal(lista.length, 1, 'el pago eliminado no debe seguir apareciendo')
})

test('Dashboard: "Servicios del mes" suma lo pagado y lo pendiente de las cuotas que vencen este mes, no las de otros meses', async () => {
  const t = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const mesActual = hoyArgentina().slice(0, 7)
  const [y, m] = mesActual.split('-').map(Number)
  const mesQueViene = new Date(y, m, 1).toISOString().slice(0, 7) // JS Date con mes 0-indexado: 'm' ya es el mes siguiente

  const serv = await fetch(`${BASE}/finanzas/servicios`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ descripcion: 'Servicio Mes Test', periodicidad: 'mensual' }),
  }).then(r => r.json())

  // Pagada, vence este mes.
  await fetch(`${BASE}/finanzas/servicios/${serv.id}/cuotas`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ monto: 12345, vencimiento: `${mesActual}-15`, pagado: true, fecha_pagada: `${mesActual}-15` }),
  })
  // Pendiente, vence este mes.
  await fetch(`${BASE}/finanzas/servicios/${serv.id}/cuotas`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ monto: 6789, vencimiento: `${mesActual}-20` }),
  })
  // Vence el mes que viene: no debe entrar en el resumen de este mes.
  await fetch(`${BASE}/finanzas/servicios/${serv.id}/cuotas`, {
    method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ monto: 99999, vencimiento: `${mesQueViene}-05` }),
  })

  const dash = await fetch(`${BASE}/finanzas/dashboard-diario`, { headers: { Authorization: `Bearer ${t}` } }).then(r => r.json())
  // No se asume un total exacto (otros tests pueden haber cargado cuotas cuyo
  // vencimiento también caiga dentro del mes real en que corre la suite) —
  // solo que lo nuestro esté incluido, y que la cuota del mes que viene (99999,
  // muy por encima de cualquier otro monto de prueba) no se haya sumado.
  assert.ok(dash.serviciosMes.pagado >= 12345, 'debe incluir el pago con vencimiento este mes')
  assert.ok(dash.serviciosMes.pendiente >= 6789, 'debe incluir el pendiente con vencimiento este mes')
  assert.ok(dash.serviciosMes.pendiente < 99999, 'la cuota que vence el mes que viene no debe sumarse en el resumen de este mes')
})

test('Cambio de contraseña obligatorio: un usuario nuevo (o reseteado) tiene que cambiarla en su próximo login antes de poder usar el resto del sistema', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const nuevo = await fetch(`${BASE}/auth/usuarios`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'pass_vencida_test', nombre: 'Usuario Pass Test', password: 'inicial123', rol: 'solo_lectura' }),
  }).then(r => r.json())

  // Login real (no el atajo tok()) — un usuario recién creado nunca cambió su
  // propia contraseña, así que tiene que quedar marcado para cambiarla ya.
  const loginInicial = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'pass_vencida_test', password: 'inicial123' }),
  }).then(r => r.json())
  assert.equal(loginInicial.usuario.debe_cambiar_password, true, 'un usuario recién creado debe quedar marcado para cambiar la contraseña')

  // Con ese token, cualquier otra ruta debe rechazarse — no alcanza con
  // esconder la pantalla en el frontend, el backend tiene que cortarlo.
  // Se usa /auth/me (solo exige estar logueado, sin permiso de módulo alguno)
  // para no mezclar este chequeo con el de permisos de "solo_lectura".
  const bloqueado = await fetch(`${BASE}/auth/me`, { headers: { Authorization: `Bearer ${loginInicial.token}` } })
  assert.equal(bloqueado.status, 403)
  const bloqueadoBody = await bloqueado.json()
  assert.equal(bloqueadoBody.code, 'DEBE_CAMBIAR_PASSWORD')

  // La única ruta permitida con ese token es la de cambiar la propia contraseña.
  const cambio = await fetch(`${BASE}/auth/usuarios/${nuevo.id}/password`, {
    method: 'PUT', headers: { Authorization: `Bearer ${loginInicial.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'nueva456' }),
  })
  assert.equal(cambio.status, 200)
  const cambioBody = await cambio.json()
  assert.equal(cambioBody.usuario.debe_cambiar_password, false, 'apenas cambia su propia contraseña, deja de estar marcado')
  assert.ok(cambioBody.token, 'debe devolver un token nuevo, ya sin la marca (el viejo no se puede editar)')

  // Con el token nuevo, ya puede usar el resto del sistema con normalidad.
  const desbloqueado = await fetch(`${BASE}/auth/me`, { headers: { Authorization: `Bearer ${cambioBody.token}` } })
  assert.equal(desbloqueado.status, 200)

  // Un login posterior con la contraseña ya cambiada por el propio usuario no
  // debe volver a exigir el cambio — no caduca sola, solo si un admin lo pide.
  const loginPosterior = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'pass_vencida_test', password: 'nueva456' }),
  }).then(r => r.json())
  assert.equal(loginPosterior.usuario.debe_cambiar_password, false)

  // Si en cambio un ADMIN le resetea la contraseña a este usuario (no el
  // propio usuario), vuelve a quedar pendiente de cambio en su próximo login
  // — no hay forma de saber si esa contraseña se la pasaron de forma segura.
  const reset = await fetch(`${BASE}/auth/usuarios/${nuevo.id}/password`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'temporal789' }),
  })
  assert.equal(reset.status, 200)
  const resetBody = await reset.json()
  assert.equal(resetBody.token, undefined, 'un reset hecho por otro usuario (admin) no devuelve un token de la cuenta ajena')

  const loginTrasReset = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'pass_vencida_test', password: 'temporal789' }),
  }).then(r => r.json())
  assert.equal(loginTrasReset.usuario.debe_cambiar_password, true, 'una contraseña reseteada por un admin también obliga a cambiarla en el próximo login')
})

test('Un admin puede pedirle a un usuario que cambie su contraseña en el próximo login, sin fijarle ninguna', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const nuevo = await fetch(`${BASE}/auth/usuarios`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'forzar_cambio_test', nombre: 'Usuario Forzar Test', password: 'inicial123', rol: 'solo_lectura' }),
  }).then(r => r.json())

  // El propio usuario cambia su contraseña una vez (con su propio token, no el
  // del admin) — queda al día, sin deuda pendiente.
  const loginNuevo = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'forzar_cambio_test', password: 'inicial123' }),
  }).then(r => r.json())
  const cambioPropio = await fetch(`${BASE}/auth/usuarios/${nuevo.id}/password`, {
    method: 'PUT', headers: { Authorization: `Bearer ${loginNuevo.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'yaesmia456' }),
  }).then(r => r.json())
  assert.equal(cambioPropio.usuario.debe_cambiar_password, false, 'al elegir su propia contraseña, queda al día')

  // Un usuario sin permisos ni siendo admin no puede pedir el cambio de otro.
  const otroUsuario = tok({ id: 999995, username: 'otro_sin_admin', nombre: 'Otro', rol: 'solo_lectura' })
  const rechazado = await fetch(`${BASE}/auth/usuarios/${nuevo.id}/forzar-cambio-password`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${otroUsuario}` },
  })
  assert.equal(rechazado.status, 403, 'solo un admin puede pedir el cambio de contraseña de otro usuario')

  // El admin pide el cambio — sin pasar ninguna contraseña nueva.
  const pedido = await fetch(`${BASE}/auth/usuarios/${nuevo.id}/forzar-cambio-password`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${admin}` },
  })
  assert.equal(pedido.status, 200)

  const loginTrasPedido = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'forzar_cambio_test', password: 'yaesmia456' }),
  }).then(r => r.json())
  assert.equal(loginTrasPedido.usuario.debe_cambiar_password, true, 'tras el pedido del admin, el próximo login debe exigir el cambio, con la MISMA contraseña que ya tenía')
})

test('Organigrama hacia abajo: un puesto ve (solo lectura) los módulos de los puestos que le reportan, nunca al revés', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const jefe = await fetch(`${BASE}/auth/puestos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Jefe Herencia Test', area: 'Dirección', modulos: { proyectos: { leer: true, escribir: true } } }),
  }).then(r => r.json())

  const gerente = await fetch(`${BASE}/auth/puestos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Gerente Herencia Test', area: 'Ingeniería', reporta_a_id: jefe.id, modulos: { produccion: { leer: true, escribir: true } } }),
  }).then(r => r.json())

  const dibujante = await fetch(`${BASE}/auth/puestos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Dibujante Herencia Test', area: 'Ingeniería', reporta_a_id: gerente.id, modulos: { mantenimiento: { leer: true, escribir: true } } }),
  }).then(r => r.json())

  async function crearUsuarioConPuesto(username, puestoId) {
    const u = await fetch(`${BASE}/auth/usuarios`, {
      method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, nombre: username, password: 'inicial123', rol: 'solo_lectura' }),
    }).then(r => r.json())
    await fetch(`${BASE}/auth/usuarios/${u.id}/puestos`, {
      method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ puesto_ids: [puestoId] }),
    })
  }

  await crearUsuarioConPuesto('jefe_herencia_test', jefe.id)
  await crearUsuarioConPuesto('gerente_herencia_test', gerente.id)
  await crearUsuarioConPuesto('dibujante_herencia_test', dibujante.id)

  const loginJefe = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'jefe_herencia_test', password: 'inicial123' }),
  }).then(r => r.json())
  assert.equal(loginJefe.usuario.permisos.proyectos.escribir, true, 'el jefe tiene su propio módulo completo')
  assert.equal(loginJefe.usuario.permisos.produccion?.leer, true, 'el jefe ve (lectura) el módulo del gerente que le reporta')
  assert.equal(loginJefe.usuario.permisos.produccion?.escribir, false, 'pero no puede escribir ahí, no es su módulo')
  assert.equal(loginJefe.usuario.permisos.mantenimiento?.leer, true, 'el jefe también ve el módulo del dibujante, dos niveles por debajo')
  assert.equal(loginJefe.usuario.permisos.mantenimiento?.escribir, false)

  const loginGerente = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'gerente_herencia_test', password: 'inicial123' }),
  }).then(r => r.json())
  assert.equal(loginGerente.usuario.permisos.produccion.escribir, true, 'el gerente tiene su propio módulo completo')
  assert.equal(loginGerente.usuario.permisos.mantenimiento?.leer, true, 'el gerente ve el módulo del dibujante que le reporta')
  assert.equal(loginGerente.usuario.permisos.mantenimiento?.escribir, false)
  assert.equal(loginGerente.usuario.permisos.proyectos, undefined, 'el gerente NO debe ver el módulo del jefe (nunca hacia arriba)')

  const loginDibujante = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'dibujante_herencia_test', password: 'inicial123' }),
  }).then(r => r.json())
  assert.equal(loginDibujante.usuario.permisos.mantenimiento.escribir, true, 'el dibujante tiene su propio módulo completo')
  assert.equal(loginDibujante.usuario.permisos.produccion, undefined, 'el dibujante no debe ver el módulo del gerente (hacia arriba)')
  assert.equal(loginDibujante.usuario.permisos.proyectos, undefined, 'el dibujante no debe ver el módulo del jefe (hacia arriba)')
})

test('Gerencias por organigrama: el menú se agrupa por la rama del organigrama dueña de cada módulo, y se puede fijar a mano la gerencia de un módulo', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  // Reutiliza la raíz del organigrama si otro test ya la creó — hay que
  // resolverla con el MISMO criterio que usa el endpoint bajo prueba (el
  // puesto sin padre con más descendientes, no "el primero sin padre"; los
  // puestos de demostración de la base de test también quedan sin padre, y
  // sin este criterio se le crearía el árbol de prueba a uno de esos).
  const puestosPrevios = await fetch(`${BASE}/auth/puestos`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  function contarDescendientesTest(id) {
    let total = 0
    const pila = [id]
    while (pila.length) {
      const actual = pila.pop()
      for (const p of puestosPrevios) if (p.reporta_a_id === actual) { total++; pila.push(p.id) }
    }
    return total
  }
  let raizId = puestosPrevios.filter(p => !p.reporta_a_id)
    .map(p => ({ id: p.id, desc: contarDescendientesTest(p.id) }))
    .sort((a, b) => b.desc - a.desc || a.id - b.id)[0]?.id
  if (!raizId) {
    const raiz = await fetch(`${BASE}/auth/puestos`, {
      method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'CEO Gerencias Test', area: 'Gerencia General' }),
    }).then(r => r.json())
    raizId = raiz.id
  }

  const gerCompras = await fetch(`${BASE}/auth/puestos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nombre: 'Gerente Compras Gerencias Test', area: 'Compras', reporta_a_id: raizId,
      modulos: { compras: { leer: true, escribir: true }, finanzas: { leer: true } },
    }),
  }).then(r => r.json())

  await fetch(`${BASE}/auth/puestos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nombre: 'Comprador Gerencias Test', area: 'Compras', reporta_a_id: gerCompras.id,
      modulos: { materiales: { leer: true } },
    }),
  })

  await fetch(`${BASE}/auth/puestos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nombre: 'Gerente Ingenieria Gerencias Test', area: 'Ingeniería', reporta_a_id: raizId,
      modulos: { proyectos: { leer: true, escribir: true } },
    }),
  })

  const primero = await fetch(`${BASE}/auth/gerencias-modulos`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  const { raizArea, modulos } = primero

  assert.equal(modulos.compras, 'Compras', 'compras queda bajo la gerencia de su propio gerente')
  assert.equal(modulos.proyectos, 'Ingeniería', 'proyectos queda bajo la gerencia de Ingeniería')
  assert.equal(modulos.materiales, 'Compras', 'un módulo asignado dos niveles abajo (al Comprador) hereda la gerencia de esa rama')
  assert.equal(modulos.codificacion, 'Compras', 'codificacion no se asigna nunca directo a un puesto (viaja con compras vía JERARQUIA) y también debe heredar la gerencia de Compras')
  assert.equal(modulos.finanzas, 'Compras', 'sin ninguna asignación manual, Finanzas sigue la deducción automática (el Gerente de Compras tiene permiso de leerla)')

  // La misma lista plana de gerencias la usa cualquier pantalla del sistema
  // (ej. "Área responsable" en Proyectos) para no tener una lista fija en el código.
  assert.ok(primero.gerencias.includes(raizArea), 'la lista de gerencias debe incluir la gerencia general')
  assert.ok(primero.gerencias.includes('Compras'), 'debe incluir Compras')
  assert.ok(primero.gerencias.includes('Ingeniería'), 'debe incluir Ingeniería')
  assert.equal(new Set(primero.gerencias).size, primero.gerencias.length, 'no debe haber gerencias repetidas')

  // Configuración manual: la pantalla "Módulos por gerencia" lista la raíz + sus gerentes directos.
  const listado = await fetch(`${BASE}/auth/gerencias`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.ok(listado.gerencias.some(g => g.id === raizId), 'la raíz debe estar entre las gerencias asignables')
  assert.ok(listado.gerencias.some(g => g.area === 'Ingeniería'), 'el Gerente de Ingeniería (hijo directo de la raíz) debe estar entre las asignables')

  // Fijar Finanzas a mano en la gerencia general gana por sobre lo automático.
  const fijar = await fetch(`${BASE}/auth/modulo-gerencia/finanzas`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ puesto_id: raizId }),
  })
  assert.equal(fijar.status, 200)
  const conOverride = await fetch(`${BASE}/auth/gerencias-modulos`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.equal(conOverride.modulos.finanzas, raizArea, 'con la asignación manual, Finanzas pasa a la gerencia general aunque el Gerente de Compras siga teniendo permiso de leerla')
  const overridesGuardados = await fetch(`${BASE}/auth/gerencias`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.equal(overridesGuardados.overrides.finanzas, raizId, 'la asignación manual queda guardada para mostrarla en la pantalla de configuración')

  // Sacar la asignación manual vuelve a la deducción automática.
  const limpiar = await fetch(`${BASE}/auth/modulo-gerencia/finanzas`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ puesto_id: null }),
  })
  assert.equal(limpiar.status, 200)
  const sinOverride = await fetch(`${BASE}/auth/gerencias-modulos`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.equal(sinOverride.modulos.finanzas, 'Compras', 'al sacar la asignación manual, Finanzas vuelve a seguir al Gerente de Compras')
})

test('Stock: editar un movimiento del historial (admin) recalcula el stock revirtiendo el valor viejo y aplicando el nuevo', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const prod = await fetch(`${BASE}/stock/productos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'EDITMOV-TEST-1', descripcion: 'Perfil de aluminio 6m', unidad: 'UND.', stock_actual: 20 }),
  }).then(r => r.json())

  const mov = await fetch(`${BASE}/stock/movimientos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ producto_id: prod.id, tipo: 'salida', cantidad: 5, fecha: '2026-08-01', observaciones: 'Original', autorizado_por_id: 1 }),
  })
  assert.equal(mov.status, 201)
  const prodTrasSalida = await fetch(`${BASE}/stock/productos/${prod.id}`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.equal(prodTrasSalida.stock_actual, 15, '20 - 5 = 15')
  const movId = prodTrasSalida.movimientos[0].id

  // Un usuario sin rol admin no puede editar, aunque tenga permiso completo de escritura de Stock.
  const noAdminUser = await fetch(`${BASE}/auth/usuarios`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'no_admin_editmov_test', nombre: 'No Admin EditMov Test', password: 'inicial123', rol: 'solo_lectura' }),
  }).then(r => r.json())
  await fetch(`${BASE}/auth/usuarios/${noAdminUser.id}/permisos`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ stock: { leer: true, escribir: true } }),
  })
  const loginNoAdmin = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'no_admin_editmov_test', password: 'inicial123' }),
  }).then(r => r.json())
  const cambioNoAdmin = await fetch(`${BASE}/auth/usuarios/${noAdminUser.id}/password`, {
    method: 'PUT', headers: { Authorization: `Bearer ${loginNoAdmin.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'nuevaClaveNoAdmin1' }),
  }).then(r => r.json())
  const rechazado = await fetch(`${BASE}/stock/movimientos/${movId}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${cambioNoAdmin.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ producto_id: prod.id, tipo: 'salida', cantidad: 9, fecha: '2026-08-01' }),
  })
  assert.equal(rechazado.status, 403, 'editar el historial es exclusivo de admin, no alcanza con permiso de Stock')
  const prodSinCambiosPorNoAdmin = await fetch(`${BASE}/stock/productos/${prod.id}`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.equal(prodSinCambiosPorNoAdmin.stock_actual, 15, 'el intento rechazado no debe haber tocado el stock')

  // Admin corrige la cantidad de 5 a 8 — el stock debe pasar de 15 a 12 (20 - 8), no arrastrar el delta viejo.
  const editar = await fetch(`${BASE}/stock/movimientos/${movId}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ producto_id: prod.id, tipo: 'salida', cantidad: 8, fecha: '2026-08-02', observaciones: 'Corregido', autorizado_por_id: 1 }),
  })
  assert.equal(editar.status, 200)
  const prodTrasEditar = await fetch(`${BASE}/stock/productos/${prod.id}`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.equal(prodTrasEditar.stock_actual, 12, '20 - 8 = 12, no 20 - 5 - 8')
  const movEditado = prodTrasEditar.movimientos.find(m => m.id === movId)
  assert.equal(movEditado.cantidad, 8)
  assert.equal(movEditado.fecha, '2026-08-02')
  assert.equal(movEditado.observaciones, 'Corregido')

  // Editar a una cantidad que dejaría el stock en negativo se rechaza sin tocar nada.
  const imposible = await fetch(`${BASE}/stock/movimientos/${movId}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ producto_id: prod.id, tipo: 'salida', cantidad: 999, fecha: '2026-08-02', autorizado_por_id: 1 }),
  })
  assert.equal(imposible.status, 400)
  const prodSinCambios = await fetch(`${BASE}/stock/productos/${prod.id}`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.equal(prodSinCambios.stock_actual, 12, 'el stock no debe cambiar si la edición se rechaza')

  // Cambiar el movimiento a OTRO producto revierte el stock del original y lo aplica al nuevo.
  const prod2 = await fetch(`${BASE}/stock/productos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'EDITMOV-TEST-2', descripcion: 'Perfil de aluminio 3m', unidad: 'UND.', stock_actual: 10 }),
  }).then(r => r.json())
  const cambiarProducto = await fetch(`${BASE}/stock/movimientos/${movId}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ producto_id: prod2.id, tipo: 'salida', cantidad: 3, fecha: '2026-08-02', autorizado_por_id: 1 }),
  })
  assert.equal(cambiarProducto.status, 200)
  const prod1Final = await fetch(`${BASE}/stock/productos/${prod.id}`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  const prod2Final = await fetch(`${BASE}/stock/productos/${prod2.id}`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.equal(prod1Final.stock_actual, 20, 'al mover el movimiento a otro producto, el original vuelve a su stock previo (sin el -8)')
  assert.equal(prod2Final.stock_actual, 7, '10 - 3 = 7 en el producto nuevo')
})

test('Pedido de Stock: un solicitante sin acceso a Stock puede pedir materiales, y Depósito confirma la entrega (total o parcial)', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const prod = await fetch(`${BASE}/stock/productos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'PEDSTK-TEST-1', descripcion: 'Caño PVC 110mm', unidad: 'MTS', stock_actual: 10 }),
  }).then(r => r.json())

  const actividad = await fetch(`${BASE}/rrhh/actividades`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Mantenimiento Planta Pedstk Test' }),
  }).then(r => r.json())

  // Solicitante: SOLO permiso de pedidos_stock, nada de stock.
  const solicitante = await fetch(`${BASE}/auth/usuarios`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'solicitante_pedstk_test', nombre: 'Solicitante Test', password: 'inicial123', rol: 'solo_lectura' }),
  }).then(r => r.json())
  await fetch(`${BASE}/auth/usuarios/${solicitante.id}/permisos`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pedidos_stock: { leer: true, escribir: true } }),
  })
  const loginSol = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'solicitante_pedstk_test', password: 'inicial123' }),
  }).then(r => r.json())
  assert.equal(loginSol.usuario.permisos.stock, undefined, 'el solicitante no debe tener permiso de Stock')

  // Usuario recién creado: tiene que elegir su propia contraseña antes de poder
  // usar cualquier otra ruta (política de cambio obligatorio) — se la cambia
  // acá para poder seguir probando el resto del flujo con un token ya habilitado.
  const cambioSol = await fetch(`${BASE}/auth/usuarios/${solicitante.id}/password`, {
    method: 'PUT', headers: { Authorization: `Bearer ${loginSol.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'nuevaClaveSol1' }),
  }).then(r => r.json())
  const solTok = cambioSol.token

  // Puede ver el catálogo liviano para armar el pedido, aunque no tenga permiso de "stock".
  const catalogo = await fetch(`${BASE}/stock/productos-para-pedido`, { headers: { Authorization: `Bearer ${solTok}` } })
  assert.equal(catalogo.status, 200, 'el solicitante debe poder ver el catálogo liviano para armar su pedido')

  // Pero NO puede ver el listado completo de pedidos pendientes (eso es de Depósito).
  const listadoTodos = await fetch(`${BASE}/stock/pedidos`, { headers: { Authorization: `Bearer ${solTok}` } })
  assert.equal(listadoTodos.status, 403, 'ver todos los pedidos pendientes requiere permiso de Stock, no solo de pedidos_stock')

  // Sin proyecto ni actividad, el pedido se rechaza — es obligatorio uno de los dos.
  const sinAsignacion = await fetch(`${BASE}/stock/pedidos`, {
    method: 'POST', headers: { Authorization: `Bearer ${solTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ producto_id: prod.id, cantidad: 5 }] }),
  })
  assert.equal(sinAsignacion.status, 400, 'un pedido sin proyecto ni actividad debe rechazarse')

  // Con los dos a la vez, también se rechaza (uno u otro, no ambos).
  const ambos = await fetch(`${BASE}/stock/pedidos`, {
    method: 'POST', headers: { Authorization: `Bearer ${solTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ producto_id: prod.id, cantidad: 5 }], actividad_id: actividad.id, proyecto_id: 999999 }),
  })
  assert.equal(ambos.status, 400, 'no se puede cargar proyecto Y actividad a la vez')

  // Sin elegir quién autoriza, también se rechaza — es obligatorio en todo pedido.
  const sinAutorizante = await fetch(`${BASE}/stock/pedidos`, {
    method: 'POST', headers: { Authorization: `Bearer ${solTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ producto_id: prod.id, cantidad: 5 }], actividad_id: actividad.id }),
  })
  assert.equal(sinAutorizante.status, 400, 'un pedido sin autorizante debe rechazarse')

  // El solicitante puede ver la lista de autorizantes válidos (admin/gerentes) para elegir uno.
  const autorizantes = await fetch(`${BASE}/stock/autorizantes`, { headers: { Authorization: `Bearer ${solTok}` } }).then(r => r.json())
  assert.ok(autorizantes.some(u => u.id === 1), 'el admin siempre debe figurar como autorizante posible')

  // Crea un pedido de 5 (de 10 disponibles), atribuido a una Actividad, autorizado por el admin.
  const pedido = await fetch(`${BASE}/stock/pedidos`, {
    method: 'POST', headers: { Authorization: `Bearer ${solTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ producto_id: prod.id, cantidad: 5 }], observaciones: 'Para obra X', actividad_id: actividad.id, autorizado_por_id: 1 }),
  }).then(r => r.json())

  const misPedidos = await fetch(`${BASE}/stock/pedidos/mios`, { headers: { Authorization: `Bearer ${solTok}` } }).then(r => r.json())
  const propio = misPedidos.find(p => p.id === pedido.id)
  assert.equal(propio.estado, 'Pendiente')
  assert.equal(propio.items[0].cantidad, 5)
  assert.equal(propio.items[0].cantidad_entregada, 0)
  assert.equal(propio.actividad_nombre, 'MANTENIMIENTO PLANTA PEDSTK TEST', 'debe traer el nombre de la actividad resuelto, no solo el id')
  assert.equal(propio.solicitante_nombre, 'Solicitante Test', 'el pedido debe quedar registrado a nombre del solicitante')
  // El nombre viene de la tabla usuarios (el admin seed real, "Administrador"),
  // no del claim "nombre" del JWT usado en el resto de este test ("Admin") —
  // obtenerAutorizantes() siempre lee el nombre real de la base.
  assert.equal(propio.autorizado_por_nombre, 'Administrador', 'el pedido debe quedar con el nombre real de quien lo autorizó')

  // Depósito (admin) ve el pedido y entrega solo 3 de los 5 (parcial).
  const itemId = propio.items[0].id
  const entrega1 = await fetch(`${BASE}/stock/pedidos/${pedido.id}/entregar`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ entregas: { [itemId]: 3 } }),
  })
  assert.equal(entrega1.status, 200)

  let prodTrasParcial = await fetch(`${BASE}/stock/productos/${prod.id}`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.equal(prodTrasParcial.stock_actual, 7, 'el stock debe bajar de 10 a 7 tras entregar 3')

  let pedidosPendAdmin = await fetch(`${BASE}/stock/pedidos`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  let pedTrasParcial = pedidosPendAdmin.find(p => p.id === pedido.id)
  assert.equal(pedTrasParcial.estado, 'Parcial')
  assert.equal(pedTrasParcial.items[0].cantidad_entregada, 3)

  // Entregar más de lo pedido debe rechazarse (quedan 2 pendientes, no 4).
  const entregaDeMas = await fetch(`${BASE}/stock/pedidos/${pedido.id}/entregar`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ entregas: { [itemId]: 4 } }),
  })
  assert.equal(entregaDeMas.status, 400, 'no se puede entregar más de lo que queda pendiente')

  // Entrega el resto (2) — ahora sí queda completo.
  const entrega2 = await fetch(`${BASE}/stock/pedidos/${pedido.id}/entregar`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ entregas: { [itemId]: 2 } }),
  })
  assert.equal(entrega2.status, 200)

  const prodFinal = await fetch(`${BASE}/stock/productos/${prod.id}`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.equal(prodFinal.stock_actual, 5, 'el stock debe terminar en 5 (10 - 3 - 2)')
  const movs = prodFinal.movimientos.filter(m => m.tipo_doc === 'pedido_stock' && m.doc_id === pedido.id)
  assert.equal(movs.length, 2, 'debe haber quedado un movimiento de salida por cada entrega parcial')
  assert.ok(movs.every(m => m.autorizado_por_nombre === 'Administrador'), 'el movimiento de stock tiene que heredar quién autorizó el pedido original')

  // El autorizante recibió un mensaje interno avisándole lo que se entregó.
  const mensajesAdmin = await fetch(`${BASE}/mensajes`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.ok(mensajesAdmin.some(m => m.asunto.includes(`Pedido #${pedido.id}`)), 'el autorizante debe recibir un mensaje por cada entrega confirmada')

  pedidosPendAdmin = await fetch(`${BASE}/stock/pedidos`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.ok(!pedidosPendAdmin.some(p => p.id === pedido.id), 'un pedido ya entregado por completo no debe seguir en la lista de pendientes')

  // Un pedido nuevo, todavía sin entregar nada, se puede cancelar.
  const pedido2 = await fetch(`${BASE}/stock/pedidos`, {
    method: 'POST', headers: { Authorization: `Bearer ${solTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ producto_id: prod.id, cantidad: 1 }], actividad_id: actividad.id, autorizado_por_id: 1 }),
  }).then(r => r.json())
  const cancelado = await fetch(`${BASE}/stock/pedidos/${pedido2.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${solTok}` } })
  assert.equal(cancelado.status, 200)
  const misPedidosFinal = await fetch(`${BASE}/stock/pedidos/mios`, { headers: { Authorization: `Bearer ${solTok}` } }).then(r => r.json())
  assert.equal(misPedidosFinal.find(p => p.id === pedido2.id).estado, 'Cancelado')

  // No se puede pedir más de lo que hay: si se intenta entregar de más que el stock real, se rechaza sin tocar el stock.
  const pedidoGrande = await fetch(`${BASE}/stock/pedidos`, {
    method: 'POST', headers: { Authorization: `Bearer ${solTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ producto_id: prod.id, cantidad: 999 }], actividad_id: actividad.id, autorizado_por_id: 1 }),
  }).then(r => r.json())
  const itemGrandeId = (await fetch(`${BASE}/stock/pedidos/mios`, { headers: { Authorization: `Bearer ${solTok}` } }).then(r => r.json()))
    .find(p => p.id === pedidoGrande.id).items[0].id
  const entregaImposible = await fetch(`${BASE}/stock/pedidos/${pedidoGrande.id}/entregar`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ entregas: { [itemGrandeId]: 999 } }),
  })
  assert.equal(entregaImposible.status, 400, 'no hay stock suficiente para 999 unidades')
  const prodSinCambios = await fetch(`${BASE}/stock/productos/${prod.id}`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.equal(prodSinCambios.stock_actual, 5, 'el stock no debe cambiar si la entrega se rechaza por falta de stock')

  // Un usuario sin ningún permiso no puede pedir ni entregar.
  const sinPermiso = tok({ id: 999994, username: 'sin_pedstk', nombre: 'Sin Permiso', rol: 'solo_lectura' })
  const pedidoRechazado = await fetch(`${BASE}/stock/pedidos`, {
    method: 'POST', headers: { Authorization: `Bearer ${sinPermiso}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ producto_id: prod.id, cantidad: 1 }] }),
  })
  assert.equal(pedidoRechazado.status, 403)
})

test('Pedido de Stock: "mis retiros directos" identifica al usuario por "Cliente interno" (a quién se le entregó), no por quién cargó el movimiento', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const prod = await fetch(`${BASE}/stock/productos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'RETDIR-TEST-1', descripcion: 'Cable 2x1.5mm', unidad: 'MTS', stock_actual: 50 }),
  }).then(r => r.json())

  const actividad = await fetch(`${BASE}/rrhh/actividades`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Actividad Retiro Directo Test' }),
  }).then(r => r.json())

  // Depósito: permiso completo de Stock (carga salidas manuales y entrega pedidos) — es quien
  // registra los movimientos, pero casi nunca es el destinatario del material.
  const deposito = await fetch(`${BASE}/auth/usuarios`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'deposito_retdir_test', nombre: 'Depósito Test', password: 'inicial123', rol: 'solo_lectura' }),
  }).then(r => r.json())
  await fetch(`${BASE}/auth/usuarios/${deposito.id}/permisos`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ stock: { leer: true, escribir: true }, pedidos_stock: { leer: true, escribir: true } }),
  })
  const loginDep = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'deposito_retdir_test', password: 'inicial123' }),
  }).then(r => r.json())
  const cambioDep = await fetch(`${BASE}/auth/usuarios/${deposito.id}/password`, {
    method: 'PUT', headers: { Authorization: `Bearer ${loginDep.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'nuevaClaveDep1' }),
  }).then(r => r.json())
  const depTok = cambioDep.token

  // Solicitante: solo permiso liviano de pedidos_stock, nunca cargó un movimiento él mismo.
  const solicitante = await fetch(`${BASE}/auth/usuarios`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'solicitante_retdir_test', nombre: 'Solicitante Retdir Test', password: 'inicial123', rol: 'solo_lectura' }),
  }).then(r => r.json())
  await fetch(`${BASE}/auth/usuarios/${solicitante.id}/permisos`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ pedidos_stock: { leer: true, escribir: true } }),
  })
  const loginSol = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'solicitante_retdir_test', password: 'inicial123' }),
  }).then(r => r.json())
  const cambioSol = await fetch(`${BASE}/auth/usuarios/${solicitante.id}/password`, {
    method: 'PUT', headers: { Authorization: `Bearer ${loginSol.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'nuevaClaveSol1' }),
  }).then(r => r.json())
  const solTok = cambioSol.token

  // Retiro directo: Depósito carga la salida manual y elige al Solicitante como "Cliente interno"
  // (a quién se le entrega) — Depósito NUNCA aparece como destinatario de esto, solo como quien lo cargó.
  const salidaDirecta = await fetch(`${BASE}/stock/movimientos`, {
    method: 'POST', headers: { Authorization: `Bearer ${depTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ producto_id: prod.id, tipo: 'salida', cantidad: 4, fecha: hoyArgentina(), proyecto: 'Obra Retiro Directo', cliente_interno: '  solicitante retdir test  ', autorizado_por_id: 1 }),
  })
  assert.equal(salidaDirecta.status, 201)

  // Pedido normal del Solicitante, que Depósito entrega — la entrega también deja "cliente_interno"
  // igual al nombre del solicitante (así se muestra hoy en "Mis pedidos"), pero por tener
  // tipo_doc='pedido_stock' NO debe contarse como retiro directo.
  const pedido = await fetch(`${BASE}/stock/pedidos`, {
    method: 'POST', headers: { Authorization: `Bearer ${solTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ producto_id: prod.id, cantidad: 2 }], actividad_id: actividad.id, autorizado_por_id: 1 }),
  }).then(r => r.json())
  const itemId = (await fetch(`${BASE}/stock/pedidos/mios`, { headers: { Authorization: `Bearer ${solTok}` } }).then(r => r.json()))
    .find(p => p.id === pedido.id).items[0].id
  const entrega = await fetch(`${BASE}/stock/pedidos/${pedido.id}/entregar`, {
    method: 'POST', headers: { Authorization: `Bearer ${depTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ entregas: { [itemId]: 2 } }),
  })
  assert.equal(entrega.status, 200)

  // El Solicitante ve su retiro directo (match de nombre sin importar mayúsculas/espacios), no la entrega del pedido.
  const misDirectosSol = await fetch(`${BASE}/stock/movimientos/mios-directos`, { headers: { Authorization: `Bearer ${solTok}` } }).then(r => r.json())
  assert.equal(misDirectosSol.length, 1, 'debe aparecer el retiro manual asignado a su nombre, no la entrega del pedido')
  assert.equal(misDirectosSol[0].codigo, 'RETDIR-TEST-1')
  assert.equal(misDirectosSol[0].cantidad, 4)
  assert.equal(misDirectosSol[0].proyecto, 'Obra Retiro Directo')

  // Depósito, en cambio, no tiene ningún retiro directo a su propio nombre (él solo cargó los movimientos, no los recibió).
  const misDirectosDep = await fetch(`${BASE}/stock/movimientos/mios-directos`, { headers: { Authorization: `Bearer ${depTok}` } }).then(r => r.json())
  assert.deepEqual(misDirectosDep, [])

  // Sin ningún permiso, ni siquiera pedidos_stock, se rechaza.
  const sinPermiso = tok({ id: 999993, username: 'sin_pedstk_retdir', nombre: 'Sin Permiso', rol: 'solo_lectura' })
  const rechazado = await fetch(`${BASE}/stock/movimientos/mios-directos`, { headers: { Authorization: `Bearer ${sinPermiso}` } })
  assert.equal(rechazado.status, 403)
})

test('Autorizantes de retiro de stock: solo admin y gerentes de gerencia (raíz + "Gerente de X" directos), nadie más', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  // Misma resolución de raíz que ya usa /auth/gerencias-modulos — reutiliza la
  // que haya dejado otro test en vez de crear una nueva (sería otro árbol
  // huérfano, y encontrarRaiz() se queda con el de más descendientes).
  const puestosPrevios = await fetch(`${BASE}/auth/puestos`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  function contarDescendientesTest(id) {
    let total = 0
    const pila = [id]
    while (pila.length) {
      const actual = pila.pop()
      for (const p of puestosPrevios) if (p.reporta_a_id === actual) { total++; pila.push(p.id) }
    }
    return total
  }
  let raizId = puestosPrevios.filter(p => !p.reporta_a_id)
    .map(p => ({ id: p.id, desc: contarDescendientesTest(p.id) }))
    .sort((a, b) => b.desc - a.desc || a.id - b.id)[0]?.id
  if (!raizId) {
    raizId = (await fetch(`${BASE}/auth/puestos`, {
      method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'CEO Autorizantes Test', area: 'Gerencia General' }),
    }).then(r => r.json())).id
  }

  const gerente = await fetch(`${BASE}/auth/puestos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Gerente Autorizantes Test', area: 'Producción', reporta_a_id: raizId }),
  }).then(r => r.json())
  const subordinado = await fetch(`${BASE}/auth/puestos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Operario Autorizantes Test', area: 'Producción', reporta_a_id: gerente.id }),
  }).then(r => r.json())

  async function crearUsuarioConPuesto(username, puestoId) {
    const u = await fetch(`${BASE}/auth/usuarios`, {
      method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, nombre: username, password: 'inicial123', rol: 'solo_lectura' }),
    }).then(r => r.json())
    await fetch(`${BASE}/auth/usuarios/${u.id}/puestos`, {
      method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ puesto_ids: [puestoId] }),
    })
    return u.id
  }
  const idGerente = await crearUsuarioConPuesto('gerente_autorizantes_test', gerente.id)
  const idSubordinado = await crearUsuarioConPuesto('operario_autorizantes_test', subordinado.id)

  const autorizantes = await fetch(`${BASE}/stock/autorizantes`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.ok(autorizantes.some(u => u.id === 1), 'el rol admin siempre debe poder autorizar')
  assert.ok(autorizantes.some(u => u.id === idGerente), 'quien ocupa un puesto de gerencia (hijo directo de la raíz) debe poder autorizar')
  assert.ok(!autorizantes.some(u => u.id === idSubordinado), 'un subordinado del gerente (dos niveles de la raíz) NO debe poder autorizar')

  // Ese gerente puede efectivamente autorizar un retiro real.
  const prod = await fetch(`${BASE}/stock/productos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'AUTORIZANTE-TEST-1', descripcion: 'Material para gerente autorizante', unidad: 'UND.', stock_actual: 10 }),
  }).then(r => r.json())
  const salida = await fetch(`${BASE}/stock/movimientos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ producto_id: prod.id, tipo: 'salida', cantidad: 2, fecha: '2026-08-02', autorizado_por_id: idGerente }),
  })
  assert.equal(salida.status, 201, 'un gerente de gerencia debe ser aceptado como autorizante de una salida real')

  // Pero un subordinado (aunque exista como usuario) no es un autorizante válido.
  const salidaConSubordinado = await fetch(`${BASE}/stock/movimientos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ producto_id: prod.id, tipo: 'salida', cantidad: 1, fecha: '2026-08-02', autorizado_por_id: idSubordinado }),
  })
  assert.equal(salidaConSubordinado.status, 400, 'un subordinado no gerente no debe poder figurar como autorizante')
})

test('Autorizantes de retiro de stock: se muestra y guarda el nombre de RRHH, no el nombre de la cuenta de usuario', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const puestosPrevios = await fetch(`${BASE}/auth/puestos`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  function contarDescendientesTest(id) {
    let total = 0
    const pila = [id]
    while (pila.length) {
      const actual = pila.pop()
      for (const p of puestosPrevios) if (p.reporta_a_id === actual) { total++; pila.push(p.id) }
    }
    return total
  }
  let raizId = puestosPrevios.filter(p => !p.reporta_a_id)
    .map(p => ({ id: p.id, desc: contarDescendientesTest(p.id) }))
    .sort((a, b) => b.desc - a.desc || a.id - b.id)[0]?.id
  if (!raizId) {
    raizId = (await fetch(`${BASE}/auth/puestos`, {
      method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'CEO Nombre RRHH Test', area: 'Gerencia General' }),
    }).then(r => r.json())).id
  }
  const gerente = await fetch(`${BASE}/auth/puestos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Gerente Nombre RRHH Test', area: 'Producción', reporta_a_id: raizId }),
  }).then(r => r.json())

  // El empleado de RRHH tiene un nombre "real"; la cuenta de usuario que se le
  // crea, uno bien distinto (típico: cuentas genéricas o de login) — lo que
  // tiene que aparecer como autorizante es el de RRHH.
  const empleado = await fetch(`${BASE}/rrhh/empleados`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Roberto Gomez Gerente RRHH' }),
  }).then(r => r.json())
  const usuarioGerente = await fetch(`${BASE}/auth/usuarios`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'cuenta_generica_gerente_test', nombre: 'Cuenta Login Gerente', password: 'inicial123', rol: 'solo_lectura', rrhh_empleado_id: empleado.id }),
  }).then(r => r.json())
  await fetch(`${BASE}/auth/usuarios/${usuarioGerente.id}/puestos`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ puesto_ids: [gerente.id] }),
  })

  const autorizantes = await fetch(`${BASE}/stock/autorizantes`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  const fila = autorizantes.find(u => u.id === usuarioGerente.id)
  assert.ok(fila, 'el gerente debe figurar en la lista de autorizantes')
  assert.equal(fila.nombre, 'ROBERTO GOMEZ GERENTE RRHH', 'debe mostrar el nombre de RRHH (en mayúsculas, como lo guarda ese módulo), no "Cuenta Login Gerente"')

  // Y ese mismo nombre queda guardado al usarlo como autorizante de un pedido real.
  const prod = await fetch(`${BASE}/stock/productos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'NOMBRERRHH-TEST-1', descripcion: 'Material nombre RRHH', unidad: 'UND.', stock_actual: 5 }),
  }).then(r => r.json())
  const actividad = await fetch(`${BASE}/rrhh/actividades`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Actividad Nombre RRHH Test' }),
  }).then(r => r.json())
  const pedido = await fetch(`${BASE}/stock/pedidos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ producto_id: prod.id, cantidad: 1 }], actividad_id: actividad.id, autorizado_por_id: usuarioGerente.id }),
  }).then(r => r.json())
  const misPedidos = await fetch(`${BASE}/stock/pedidos/mios`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  const propio = misPedidos.find(p => p.id === pedido.id)
  assert.equal(propio.autorizado_por_nombre, 'ROBERTO GOMEZ GERENTE RRHH', 'el pedido debe quedar guardado con el nombre de RRHH del autorizante')
})

test('CUIT: se normaliza a formato XX-XXXXXXXX-X al guardar, venga como venga, en todos los módulos que lo usan', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  // Proveedor: CUIT sin guiones al crear, y con guiones distintos al editar.
  const prov = await fetch(`${BASE}/compras/proveedores`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Proveedor CUIT Test', cuit: '30712345678' }),
  }).then(r => r.json())
  assert.equal(prov.cuit, '30-71234567-8')

  const provEditado = await fetch(`${BASE}/compras/proveedores/${prov.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cuit: '30 71234567 8' }),
  }).then(r => r.json())
  assert.equal(provEditado.cuit, '30-71234567-8', 'espacios en vez de guiones también se normalizan')

  // Cliente: mismo criterio.
  const cli = await fetch(`${BASE}/ventas/clientes`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Cliente CUIT Test', cuit: '20-11223344-5' }),
  }).then(r => r.json())
  assert.equal(cli.cuit, '20-11223344-5', 'un CUIT que ya viene bien formateado no se altera')

  // Orden de Compra: proveedor_cuit denormalizado, cargado a mano sin guiones.
  const oc = await fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ proveedor_id: prov.id, proveedor_nombre: prov.nombre, proveedor_cuit: '30712345678', items: [] }),
  }).then(r => r.json())
  assert.equal(oc.proveedor_cuit, '30-71234567-8')

  // Presupuesto: cli_cuit denormalizado.
  const ppto = await fetch(`${BASE}/ventas/presupuestos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cliente_id: cli.id, cli_nombre: cli.nombre, cli_cuit: '20112233445', items: [] }),
  }).then(r => r.json())
  assert.equal(ppto.cli_cuit, '20-11223344-5')

  // Factura de compra (IA/manual): cuit denormalizado.
  await fetch(`${BASE}/facturas/guardar-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'A-0001-00000001', proveedor_nombre: prov.nombre, proveedor_id: prov.id, cuit: '30712345678', importe: 100 }),
  }).then(r => r.json())
  const facturasListado = await fetch(`${BASE}/finanzas/facturas-compra?buscar=A-0001-00000001`, {
    headers: { Authorization: `Bearer ${admin}` },
  }).then(r => r.json())
  const facturaGuardada = facturasListado.find(f => f.numero === 'A-0001-00000001')
  assert.equal(facturaGuardada.cuit, '30-71234567-8')

  // Un CUIT incompleto (no son 11 dígitos) no se fuerza a ningún formato: se guarda tal cual vino.
  const provIncompleto = await fetch(`${BASE}/compras/proveedores`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Proveedor CUIT Incompleto', cuit: '12345' }),
  }).then(r => r.json())
  assert.equal(provIncompleto.cuit, '12345', 'un dato incompleto no se reformatea a la fuerza')
})

test('Mis Tareas: la tarea la ve la persona responsable y el gerente de esa gerencia, nadie más, y solo ellos pueden marcarla realizada', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  // Reutiliza la raíz real del organigrama (con el mismo criterio — más
  // descendientes, no "el primero sin padre" — que usa el propio endpoint)
  // en vez de crear un CEO nuevo: si otro test ya armó un árbol más grande,
  // ese sigue siendo la raíz real y un CEO nuevo quedaría huérfano, sin que
  // "Gerente de Ingeniería" cuelgue de la raíz que el sistema realmente usa.
  const puestosPrevios = await fetch(`${BASE}/auth/puestos`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  function contarDescendientesMisTareas(id) {
    let total = 0
    const pila = [id]
    while (pila.length) {
      const actual = pila.pop()
      for (const p of puestosPrevios) if (p.reporta_a_id === actual) { total++; pila.push(p.id) }
    }
    return total
  }
  let raizId = puestosPrevios.filter(p => !p.reporta_a_id)
    .map(p => ({ id: p.id, desc: contarDescendientesMisTareas(p.id) }))
    .sort((a, b) => b.desc - a.desc || a.id - b.id)[0]?.id
  if (!raizId) {
    const ceo = await fetch(`${BASE}/auth/puestos`, {
      method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ nombre: 'CEO Mis Tareas Test', area: 'Gerencia General' }),
    }).then(r => r.json())
    raizId = ceo.id
  }
  const gerIng = await fetch(`${BASE}/auth/puestos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Gerente Ingenieria Mis Tareas Test', area: 'Ingeniería Mis Tareas', reporta_a_id: raizId }),
  }).then(r => r.json())

  // Proyecto con una tarea asignada a un empleado puntual, en esa gerencia.
  const proyecto = await fetch(`${BASE}/proyectos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'MISTAREAS01', nombre: 'Proyecto Mis Tareas Test', cliente_nombre: 'Cliente Mis Tareas' }),
  }).then(r => r.json())

  const empleado = await fetch(`${BASE}/rrhh/empleados`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Juan Perez Mis Tareas' }),
  }).then(r => r.json())
  const empleadoNombre = 'JUAN PEREZ MIS TAREAS' // POST /rrhh/empleados guarda el nombre en mayúsculas

  const tarea = await fetch(`${BASE}/gantt/proyecto/${proyecto.id}/tareas`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Tarea de Juan', responsable: empleadoNombre, area_responsable: 'Ingeniería Mis Tareas' }),
  }).then(r => r.json())

  // Usuario de Juan (el responsable de la tarea) — sin acceso a Proyectos ni
  // ningún permiso especial: "Mis Tareas" tiene que andarle igual, sin que un
  // admin se lo tenga que asignar aparte.
  const juan = await fetch(`${BASE}/auth/usuarios`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'juan_mistareas', nombre: 'Juan Perez Mis Tareas', password: 'inicial123', rol: 'solo_lectura', rrhh_empleado_id: empleado.id }),
  }).then(r => r.json())
  const juanTok = tok({ id: juan.id, username: 'juan_mistareas', nombre: 'Juan Perez Mis Tareas', rol: 'solo_lectura' })

  // Usuario del Gerente de Ingeniería (el jefe de esa gerencia) — tampoco tiene Proyectos ni permiso especial.
  const gerente = await fetch(`${BASE}/auth/usuarios`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'gerente_mistareas', nombre: 'Gerente Mis Tareas', password: 'inicial123', rol: 'solo_lectura' }),
  }).then(r => r.json())
  await fetch(`${BASE}/auth/usuarios/${gerente.id}/puestos`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ puesto_ids: [gerIng.id] }),
  })
  const gerenteTok = tok({ id: gerente.id, username: 'gerente_mistareas', nombre: 'Gerente Mis Tareas', rol: 'solo_lectura' })

  // Un tercero sin relación con la tarea (ni responsable, ni gerente de esa gerencia), tampoco con permiso especial.
  const otro = await fetch(`${BASE}/auth/usuarios`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'otro_mistareas', nombre: 'Otro Mis Tareas', password: 'inicial123', rol: 'solo_lectura' }),
  }).then(r => r.json())
  const otroTok = tok({ id: otro.id, username: 'otro_mistareas', nombre: 'Otro Mis Tareas', rol: 'solo_lectura' })

  const misTareasJuan = await fetch(`${BASE}/tareas-gerencia/mis-tareas`, { headers: { Authorization: `Bearer ${juanTok}` } }).then(r => r.json())
  assert.ok(misTareasJuan.some(t => t.id === tarea.id), 'Juan (el responsable) debe ver su propia tarea')

  const misTareasGerente = await fetch(`${BASE}/tareas-gerencia/mis-tareas`, { headers: { Authorization: `Bearer ${gerenteTok}` } }).then(r => r.json())
  assert.ok(misTareasGerente.some(t => t.id === tarea.id), 'el gerente de esa gerencia debe ver la tarea de su gente')

  const misTareasOtro = await fetch(`${BASE}/tareas-gerencia/mis-tareas`, { headers: { Authorization: `Bearer ${otroTok}` } }).then(r => r.json())
  assert.equal(misTareasOtro.length, 0, 'un tercero sin relación con la tarea no debe ver nada')

  // Solo el responsable o su gerente pueden marcarla — un tercero, no.
  const rechazado = await fetch(`${BASE}/tareas-gerencia/tareas/${tarea.id}/completar`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${otroTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ completada: true }),
  })
  assert.equal(rechazado.status, 403, 'un tercero no puede marcar una tarea que no es suya ni de su gente')

  const marcada = await fetch(`${BASE}/tareas-gerencia/tareas/${tarea.id}/completar`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${juanTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ completada: true }),
  }).then(r => r.json())
  assert.equal(marcada.estado, 'Completado')
  assert.equal(marcada.avance, 100)

  // El gerente también puede des-marcarla.
  const desmarcada = await fetch(`${BASE}/tareas-gerencia/tareas/${tarea.id}/completar`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${gerenteTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ completada: false }),
  }).then(r => r.json())
  assert.equal(desmarcada.estado, 'Pendiente')
  assert.equal(desmarcada.avance, 0)

  // Admin ve todo, sin importar responsable ni gerencia.
  const misTareasAdmin = await fetch(`${BASE}/tareas-gerencia/mis-tareas`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.ok(misTareasAdmin.some(t => t.id === tarea.id), 'el admin ve todas las tareas')
})

test('Mis Tareas: los niveles superiores del organigrama ven las tareas de quien les reporta, en cualquier cantidad de niveles, y pueden filtrar por empleado', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  // Reutiliza la raíz real (mismo criterio robusto que el resto de los tests de organigrama).
  const puestosPrevios = await fetch(`${BASE}/auth/puestos`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  function contarDescendientesNiveles(id) {
    let total = 0
    const pila = [id]
    while (pila.length) {
      const actual = pila.pop()
      for (const p of puestosPrevios) if (p.reporta_a_id === actual) { total++; pila.push(p.id) }
    }
    return total
  }
  const raizId = puestosPrevios.filter(p => !p.reporta_a_id)
    .map(p => ({ id: p.id, desc: contarDescendientesNiveles(p.id) }))
    .sort((a, b) => b.desc - a.desc || a.id - b.id)[0]?.id

  // Cadena de 3 niveles: raíz → Gerente de Producción → Jefe de Taller → Operario (tarea).
  const gerProd = await fetch(`${BASE}/auth/puestos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Gerente Produccion Niveles Test', area: 'Producción Niveles Test', reporta_a_id: raizId }),
  }).then(r => r.json())
  const jefeTaller = await fetch(`${BASE}/auth/puestos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Jefe de Taller Niveles Test', area: 'Producción Niveles Test', reporta_a_id: gerProd.id }),
  }).then(r => r.json())
  // Otro jefe, hermano del anterior — para probar que NO ve tareas de un equipo que no es el suyo.
  const otroJefe = await fetch(`${BASE}/auth/puestos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Otro Jefe Niveles Test', area: 'Producción Niveles Test', reporta_a_id: gerProd.id }),
  }).then(r => r.json())

  const proyecto = await fetch(`${BASE}/proyectos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'NIVELESTEST01', nombre: 'Proyecto Niveles Test', cliente_nombre: 'Cliente Niveles' }),
  }).then(r => r.json())

  const empOperario = await fetch(`${BASE}/rrhh/empleados`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Operario Niveles Test' }),
  }).then(r => r.json())
  const operarioNombre = 'OPERARIO NIVELES TEST'

  // La tarea del operario NO lleva area_responsable — la visibilidad tiene que
  // salir pura y exclusivamente de la cadena de reporta_a_id de su puesto.
  const tarea = await fetch(`${BASE}/gantt/proyecto/${proyecto.id}/tareas`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Soldar bastidor', responsable: operarioNombre }),
  }).then(r => r.json())

  const crearUsuarioConPuesto = async (username, puestoId, rrhh_empleado_id) => {
    const u = await fetch(`${BASE}/auth/usuarios`, {
      method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, nombre: username, password: 'inicial123', rol: 'solo_lectura', rrhh_empleado_id: rrhh_empleado_id || null }),
    }).then(r => r.json())
    if (puestoId) {
      await fetch(`${BASE}/auth/usuarios/${u.id}/puestos`, {
        method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ puesto_ids: [puestoId] }),
      })
    }
    return { id: u.id, tok: tok({ id: u.id, username, nombre: username, rol: 'solo_lectura' }) }
  }

  const operario = await crearUsuarioConPuesto('operario_niveles', null, empOperario.id)
  // El operario también tiene que estar ubicado en el organigrama para que la
  // cadena hacia arriba funcione — reporta directo al Jefe de Taller.
  await fetch(`${BASE}/auth/usuarios/${operario.id}/puestos`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ puesto_ids: [jefeTaller.id] }),
  })
  const jefe    = await crearUsuarioConPuesto('jefe_niveles', jefeTaller.id)
  const gerente = await crearUsuarioConPuesto('gerente_niveles', gerProd.id)
  const otro    = await crearUsuarioConPuesto('otro_jefe_niveles', otroJefe.id)

  const misTareasJefe = await fetch(`${BASE}/tareas-gerencia/mis-tareas`, { headers: { Authorization: `Bearer ${jefe.tok}` } }).then(r => r.json())
  assert.ok(misTareasJefe.some(t => t.id === tarea.id), 'el jefe directo del operario debe ver su tarea')

  const misTareasGerente = await fetch(`${BASE}/tareas-gerencia/mis-tareas`, { headers: { Authorization: `Bearer ${gerente.tok}` } }).then(r => r.json())
  assert.ok(misTareasGerente.some(t => t.id === tarea.id), 'el gerente, dos niveles arriba del operario, también debe ver la tarea')

  const misTareasOtroJefe = await fetch(`${BASE}/tareas-gerencia/mis-tareas`, { headers: { Authorization: `Bearer ${otro.tok}` } }).then(r => r.json())
  assert.ok(!misTareasOtroJefe.some(t => t.id === tarea.id), 'un jefe de otro equipo (mismo nivel, no es ancestro) no debe ver la tarea')

  // El jefe puede marcarla, aunque no sea él el responsable.
  const marcada = await fetch(`${BASE}/tareas-gerencia/tareas/${tarea.id}/completar`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${jefe.tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ completada: true }),
  })
  assert.equal(marcada.status, 200)

  const rechazado = await fetch(`${BASE}/tareas-gerencia/tareas/${tarea.id}/completar`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${otro.tok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ completada: false }),
  })
  assert.equal(rechazado.status, 403, 'un jefe de otro equipo no puede marcarla')
})

test('Clientes: "desactivar" es reversible, no borra el registro', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const cli = await fetch(`${BASE}/ventas/clientes`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Cliente Toggle Test' }),
  }).then(r => r.json())
  assert.equal(cli.activo, 1, 'nace activo')

  const desactivado = await fetch(`${BASE}/ventas/clientes/${cli.id}/activo`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${admin}` },
  }).then(r => r.json())
  assert.equal(desactivado.activo, 0)

  // Sigue existiendo, no se borró.
  const listado1 = await fetch(`${BASE}/ventas/clientes`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.ok(listado1.some(c => c.id === cli.id), 'el cliente desactivado sigue en el listado')

  const reactivado = await fetch(`${BASE}/ventas/clientes/${cli.id}/activo`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${admin}` },
  }).then(r => r.json())
  assert.equal(reactivado.activo, 1, 'se puede reactivar')

  const inexistente = await fetch(`${BASE}/ventas/clientes/999999/activo`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${admin}` },
  })
  assert.equal(inexistente.status, 404)
})

test('Dashboard: un usuario sin permiso de Finanzas ni RRHH no recibe esos datos en /dashboard/resumen', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })
  const nuevo = await fetch(`${BASE}/auth/usuarios`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'produccion_dash_test', nombre: 'Produccion Dash Test', password: 'test1234', rol: 'solo_lectura' }),
  }).then(r => r.json())
  await fetch(`${BASE}/auth/usuarios/${nuevo.id}/permisos`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ produccion: { leer: true, escribir: false } }),
  })
  const usuario = tok({ id: nuevo.id, username: 'produccion_dash_test', nombre: 'Produccion Dash Test', rol: 'solo_lectura' })

  const resumen = await fetch(`${BASE}/dashboard/resumen`, { headers: { Authorization: `Bearer ${usuario}` } }).then(r => r.json())
  assert.equal(resumen.finanzas, null, 'sin permiso de finanzas no debe ver saldo de caja')
  assert.deepEqual(resumen.fichadas_hoy, [], 'sin permiso de RRHH no debe ver quién fichó')
  assert.deepEqual(resumen.sin_fichar_hoy, [], 'sin permiso de RRHH no debe ver quién no fichó')

  const resumenAdmin = await fetch(`${BASE}/dashboard/resumen`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.ok(resumenAdmin.finanzas, 'admin sigue viendo finanzas')
})

test('RRHH: debug-acs (historial biométrico crudo) exige permiso de lectura de RRHH', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })
  const nuevo = await fetch(`${BASE}/auth/usuarios`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'sin_rrhh_test', nombre: 'Sin RRHH Test', password: 'test1234', rol: 'solo_lectura' }),
  }).then(r => r.json())
  await fetch(`${BASE}/auth/usuarios/${nuevo.id}/permisos`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ produccion: { leer: true, escribir: false } }),
  })
  const sinRrhh = tok({ id: nuevo.id, username: 'sin_rrhh_test', nombre: 'Sin RRHH Test', rol: 'solo_lectura' })

  const rechazado = await fetch(`${BASE}/rrhh/dispositivos/1/debug-acs`, {
    method: 'POST', headers: { Authorization: `Bearer ${sinRrhh}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.equal(rechazado.status, 403, 'sin permiso de RRHH no debe poder consultar el historial biométrico crudo')
})

test('Compras: el padrón de proveedores exige permiso de lectura de alguno de los módulos que lo usan', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })
  const nuevo = await fetch(`${BASE}/auth/usuarios`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'sin_prov_test', nombre: 'Sin Proveedores Test', password: 'test1234', rol: 'solo_lectura' }),
  }).then(r => r.json())
  await fetch(`${BASE}/auth/usuarios/${nuevo.id}/permisos`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ produccion: { leer: true, escribir: false } }),
  })
  const sinPermiso = tok({ id: nuevo.id, username: 'sin_prov_test', nombre: 'Sin Proveedores Test', rol: 'solo_lectura' })

  const rechazado1 = await fetch(`${BASE}/compras/proveedores`, { headers: { Authorization: `Bearer ${sinPermiso}` } })
  assert.equal(rechazado1.status, 403, 'sin permiso de ningún módulo relevante no debe listar proveedores')
  const rechazado2 = await fetch(`${BASE}/compras/proveedores/buscar?id=1`, { headers: { Authorization: `Bearer ${sinPermiso}` } })
  assert.equal(rechazado2.status, 403)

  // Cada módulo que lo consume desde el frontend debe seguir teniendo acceso.
  for (const modulo of ['compras', 'finanzas', 'administracion', 'materiales', 'calidad', 'stock']) {
    const u = await fetch(`${BASE}/auth/usuarios`, {
      method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `prov_${modulo}_test`, nombre: `Prov ${modulo} Test`, password: 'test1234', rol: 'solo_lectura' }),
    }).then(r => r.json())
    await fetch(`${BASE}/auth/usuarios/${u.id}/permisos`, {
      method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ [modulo]: { leer: true, escribir: false } }),
    })
    const t = tok({ id: u.id, username: `prov_${modulo}_test`, nombre: `Prov ${modulo} Test`, rol: 'solo_lectura' })
    const r = await fetch(`${BASE}/compras/proveedores`, { headers: { Authorization: `Bearer ${t}` } })
    assert.equal(r.status, 200, `con permiso de ${modulo} debería poder listar proveedores`)
  }
})

test('Calidad: subir un documento sin permiso de escritura se rechaza antes de escribir el archivo a disco', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })
  const nuevo = await fetch(`${BASE}/auth/usuarios`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'sin_calidad_test', nombre: 'Sin Calidad Test', password: 'test1234', rol: 'solo_lectura' }),
  }).then(r => r.json())
  const sinPermiso = tok({ id: nuevo.id, username: 'sin_calidad_test', nombre: 'Sin Calidad Test', rol: 'solo_lectura' })

  const form = new FormData()
  form.append('codigo', 'DOC-RECHAZO-TEST')
  form.append('titulo', 'Documento que no debería subirse')
  form.append('archivo', new Blob(['contenido de prueba'], { type: 'application/pdf' }), 'test.pdf')

  const rechazado = await fetch(`${BASE}/calidad/documentos`, {
    method: 'POST', headers: { Authorization: `Bearer ${sinPermiso}` }, body: form,
  })
  assert.equal(rechazado.status, 403)

  const documentos = await fetch(`${BASE}/calidad/documentos`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.ok(!documentos.some(d => d.codigo === 'DOC-RECHAZO-TEST'), 'no debe haber quedado ningún registro del intento rechazado')
})

test('Calidad: los documentos no se pueden descargar sin login por la ruta estática /uploads', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const form = new FormData()
  form.append('codigo', 'DOC-ESTATICO-TEST')
  form.append('titulo', 'Documento de prueba de ruta estática')
  form.append('archivo', new Blob(['contenido de prueba'], { type: 'application/pdf' }), 'test.pdf')
  const subido = await fetch(`${BASE}/calidad/documentos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}` }, body: form,
  }).then(r => r.json())

  const documentos = await fetch(`${BASE}/calidad/documentos`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  const doc = documentos.find(d => d.id === subido.id)
  assert.ok(doc?.archivo_path, 'debe conocerse el nombre de archivo guardado')

  const rutaEstatica = await fetch(`${BASE.replace('/api/v1','')}/uploads/documentos_calidad/${doc.archivo_path}`)
  assert.equal(rutaEstatica.status, 403, 'la ruta estática no debe servir el archivo, ni siquiera sin token')

  const rutaAutenticada = await fetch(`${BASE}/calidad/documentos/${doc.id}/archivo`, { headers: { Authorization: `Bearer ${admin}` } })
  assert.equal(rutaAutenticada.status, 200, 'la ruta autenticada sí debe servirlo')
})

test('Impersonar a un usuario queda registrado en su historial de conexiones', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })
  const nuevo = await fetch(`${BASE}/auth/usuarios`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'impersonado_test', nombre: 'Impersonado Test', password: 'test1234', rol: 'solo_lectura' }),
  }).then(r => r.json())

  const resp = await fetch(`${BASE}/auth/impersonate/${nuevo.id}`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}` },
  })
  assert.equal(resp.status, 200)

  const historial = await fetch(`${BASE}/auth/usuarios/${nuevo.id}/login-log`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.equal(historial.length, 1)
  assert.equal(historial[0].admin_nombre, 'Administrador', 'debe quedar registrado qué admin impersonó')

  // Un login normal (no impersonado) no debe traer admin_nombre.
  const loginNormal = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'impersonado_test', password: 'test1234' }),
  })
  assert.equal(loginNormal.status, 200)
  const historial2 = await fetch(`${BASE}/auth/usuarios/${nuevo.id}/login-log`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.equal(historial2.length, 2)
  assert.ok(historial2.some(h => h.admin_nombre === null), 'el login normal no debe figurar como impersonación')
})

test('Un token sigue firmado pero deja de servir si desactivan al usuario o le cambian el rol', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })
  const nuevo = await fetch(`${BASE}/auth/usuarios`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'revalidar_test', nombre: 'Revalidar Test', password: 'test1234', rol: 'solo_lectura' }),
  }).then(r => r.json())
  const t = tok({ id: nuevo.id, username: 'revalidar_test', nombre: 'Revalidar Test', rol: 'solo_lectura' })

  const antes = await fetch(`${BASE}/auth/me`, { headers: { Authorization: `Bearer ${t}` } })
  assert.equal(antes.status, 200, 'con el usuario activo, el token funciona normalmente')

  await fetch(`${BASE}/auth/usuarios/${nuevo.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ activo: false }),
  })
  const desactivado = await fetch(`${BASE}/auth/me`, { headers: { Authorization: `Bearer ${t}` } })
  assert.equal(desactivado.status, 403)
  assert.equal((await desactivado.json()).code, 'SESION_INVALIDADA')

  // Reactivarlo pero con un rol distinto al que tenía el token también corta el acceso.
  await fetch(`${BASE}/auth/usuarios/${nuevo.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ activo: true, rol: 'gerencia' }),
  })
  const rolCambiado = await fetch(`${BASE}/auth/me`, { headers: { Authorization: `Bearer ${t}` } })
  assert.equal(rolCambiado.status, 403, 'el token vieja lleva el rol viejo, no debe seguir funcionando')

  // Con un token nuevo (rol actualizado) sí funciona.
  const tNuevo = tok({ id: nuevo.id, username: 'revalidar_test', nombre: 'Revalidar Test', rol: 'gerencia' })
  const conRolNuevo = await fetch(`${BASE}/auth/me`, { headers: { Authorization: `Bearer ${tNuevo}` } })
  assert.equal(conRolNuevo.status, 200)
})

test('Montos y cantidades negativas se rechazan al cargar facturas y OC', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const facturaNegativa = await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'NEG-001', importe: -1000 }),
  })
  assert.equal(facturaNegativa.status, 400)

  const facturaIvaNegativo = await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'NEG-002', importe: 1000, iva_21: -50 }),
  })
  assert.equal(facturaIvaNegativo.status, 400)

  const facturaVentaNegativa = await fetch(`${BASE}/finanzas/facturas-venta`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'NEGV-001', importe: -500 }),
  })
  assert.equal(facturaVentaNegativa.status, 400)

  const ocCantidadNegativa = await fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ proveedor_nombre: 'Proveedor Neg Test', items: [{ descripcion: 'Item', cantidad: -5, precio_unitario: 10 }] }),
  })
  assert.equal(ocCantidadNegativa.status, 400)

  const ocPrecioNegativo = await fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ proveedor_nombre: 'Proveedor Neg Test', items: [{ descripcion: 'Item', cantidad: 5, precio_unitario: -10 }] }),
  })
  assert.equal(ocPrecioNegativo.status, 400)

  // Una OC con valores válidos se sigue pudiendo cargar sin problema.
  const ocValida = await fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ proveedor_nombre: 'Proveedor Neg Test', items: [{ descripcion: 'Item', cantidad: 5, precio_unitario: 10, precio_final: 50 }] }),
  })
  assert.equal(ocValida.status, 201)

  // Una Nota de Crédito sí guarda su importe en negativo a propósito (anula
  // el de la factura original) — no debe quedar bloqueada por esta validación.
  const original = await fetch(`${BASE}/finanzas/facturas-venta`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'NEGV-ORIG', fecha: '2026-01-01', cliente_nombre: 'Cliente Neg Test', importe: 500 }),
  }).then(r => r.json())
  const nc = await fetch(`${BASE}/finanzas/facturas-venta`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'NEGV-NC', tipo_factura: 'NC', fecha: '2026-01-02', cliente_nombre: 'Cliente Neg Test', importe: -500, nc_factura_id: original.id }),
  })
  assert.equal(nc.status, 201, 'una NC con importe negativo debe poder cargarse')

  // Editarla sin reenviar tipo_factura en el body también debe seguir permitido.
  const ncId = (await nc.json()).id
  const editNc = await fetch(`${BASE}/finanzas/facturas-venta/${ncId}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ importe: -500, observaciones: 'editada' }),
  })
  assert.equal(editNc.status, 200)
})

test('OC Clientes: sin permiso de Finanzas tampoco se ven observaciones/comentarios ni datos de la cuota vinculada', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const oc = await fetch(`${BASE}/finanzas/oc-clientes`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cliente: 'Cliente Redaccion Test', numero_oc: 'OCV-REDAC-1', monto_oc: 5000, fecha_oc: '2026-01-01',
      observaciones: 'Condición de pago confidencial', comentarios: 'Otro dato sensible',
      cuotas: [{ tipo: 'unico', pct: 100, monto_planeado: 5000 }],
    }),
  }).then(r => r.json())

  const nuevo = await fetch(`${BASE}/auth/usuarios`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'sin_finanzas_redac_test', nombre: 'Sin Finanzas Redac Test', password: 'test1234', rol: 'solo_lectura' }),
  }).then(r => r.json())
  await fetch(`${BASE}/auth/usuarios/${nuevo.id}/permisos`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ proyectos: { leer: true, escribir: false } }),
  })
  const sinFinanzas = tok({ id: nuevo.id, username: 'sin_finanzas_redac_test', nombre: 'Sin Finanzas Redac Test', rol: 'solo_lectura' })

  const lista = await fetch(`${BASE}/finanzas/oc-clientes?buscar=OCV-REDAC-1`, { headers: { Authorization: `Bearer ${sinFinanzas}` } }).then(r => r.json())
  const fila = lista.find(r => r.id === oc.id)
  assert.ok(fila, 'la fila se sigue viendo (número de OC visible desde Proyectos)')
  assert.equal(fila.observaciones, undefined, 'sin permiso de finanzas no debe ver observaciones')
  assert.equal(fila.comentarios, undefined, 'sin permiso de finanzas no debe ver comentarios')
  assert.equal(fila.monto_oc, undefined, 'el monto ya estaba redactado, sigue estándolo')

  const listaAdmin = await fetch(`${BASE}/finanzas/oc-clientes?buscar=OCV-REDAC-1`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  const filaAdmin = listaAdmin.find(r => r.id === oc.id)
  assert.equal(filaAdmin.observaciones, 'Condición de pago confidencial', 'con permiso de finanzas sí se ve')
})

test('Organigrama: no se puede armar un ciclo de reporte en dos ediciones separadas', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const puestoA = await fetch(`${BASE}/auth/puestos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Puesto Ciclo A' }),
  }).then(r => r.json())
  const puestoB = await fetch(`${BASE}/auth/puestos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Puesto Ciclo B', reporta_a_id: puestoA.id }),
  }).then(r => r.json())
  const puestoC = await fetch(`${BASE}/auth/puestos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Puesto Ciclo C', reporta_a_id: puestoB.id }),
  }).then(r => r.json())

  // A pasa a reportar a C — cerraría el ciclo A→C→B→A (varios niveles, no autoreferencia directa).
  const rCiclo = await fetch(`${BASE}/auth/puestos/${puestoA.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Puesto Ciclo A', reporta_a_id: puestoC.id }),
  })
  assert.equal(rCiclo.status, 400)

  // Una edición legítima (sin ciclo) sigue funcionando.
  const puestoD = await fetch(`${BASE}/auth/puestos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Puesto Ciclo D' }),
  }).then(r => r.json())
  const rValida = await fetch(`${BASE}/auth/puestos/${puestoD.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Puesto Ciclo D', reporta_a_id: puestoC.id }),
  })
  assert.equal(rValida.status, 200)
})

test('Facturas con IA: sin tasa de cambio explícita, se usa la del sistema en vez de un default fijo de 1', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  await fetch(`${BASE}/finanzas/tipo-cambio`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ moneda: 'DÓLAR', valor: 1350, fuente: 'BNA', fecha: '2026-01-01' }),
  })

  const compra = await fetch(`${BASE}/facturas/guardar-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'IA-TC-COMPRA-1', fecha: '2026-01-05', proveedor_nombre: 'Proveedor IA TC Test', importe: 1000, moneda: 'DÓLAR' }),
  }).then(r => r.json())
  const listaCompra = await fetch(`${BASE}/finanzas/facturas-compra?buscar=IA-TC-COMPRA-1`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.equal(listaCompra[0].tasa_cambio, 1350, 'debe tomar la tasa del sistema a esa fecha, no 1')

  const venta = await fetch(`${BASE}/facturas/guardar-venta`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'IA-TC-VENTA-1', fecha: '2026-01-05', cliente_nombre: 'Cliente IA TC Test', importe: 1000, moneda: 'DÓLAR' }),
  }).then(r => r.json())
  const listaVenta = await fetch(`${BASE}/finanzas/facturas-venta?buscar=IA-TC-VENTA-1`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.equal(listaVenta[0].tasa_cambio, 1350, 'debe tomar la tasa del sistema a esa fecha, no 1')

  // Si sí viene explícita, esa gana por sobre la del sistema.
  const compraConTC = await fetch(`${BASE}/facturas/guardar-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'IA-TC-COMPRA-2', fecha: '2026-01-05', proveedor_nombre: 'Proveedor IA TC Test', importe: 1000, moneda: 'DÓLAR', tasa_cambio: 1500 }),
  }).then(r => r.json())
  const listaCompra2 = await fetch(`${BASE}/finanzas/facturas-compra?buscar=IA-TC-COMPRA-2`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.equal(listaCompra2[0].tasa_cambio, 1500)

  // En pesos, sigue sin aplicar ninguna tasa (0 o 1, nunca la de dólar).
  const compraPesos = await fetch(`${BASE}/facturas/guardar-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'IA-TC-PESOS-1', fecha: '2026-01-05', proveedor_nombre: 'Proveedor IA TC Test', importe: 1000, moneda: 'PESO' }),
  }).then(r => r.json())
  const listaPesos = await fetch(`${BASE}/finanzas/facturas-compra?buscar=IA-TC-PESOS-1`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.equal(listaPesos[0].tasa_cambio, 1)
})

test('Borrar un registro con dependencias da un 409 claro, no un 500 genérico', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  // OC con una factura vinculada.
  const oc = await fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ proveedor_nombre: 'Proveedor Delete Test', items: [{ descripcion: 'Item', cantidad: 1, precio_unitario: 10, precio_final: 10 }] }),
  }).then(r => r.json())
  await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'OC-DELETE-DEP-1', fecha: '2026-01-01', proveedor_nombre: 'Proveedor Delete Test', oc_id: oc.id, importe: 10 }),
  })
  const rOcConDependencia = await fetch(`${BASE}/compras/oc/${oc.id}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${admin}` },
  })
  assert.equal(rOcConDependencia.status, 409)
  assert.ok((await rOcConDependencia.json()).error, 'debe traer un mensaje explicativo')

  // Puesto con otro puesto reportándole.
  const puestoPadre = await fetch(`${BASE}/auth/puestos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Puesto Delete Padre' }),
  }).then(r => r.json())
  await fetch(`${BASE}/auth/puestos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Puesto Delete Hijo', reporta_a_id: puestoPadre.id }),
  })
  const rPuestoConDependencia = await fetch(`${BASE}/auth/puestos/${puestoPadre.id}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${admin}` },
  })
  assert.equal(rPuestoConDependencia.status, 409)

  // Usuario que ya generó registros en el sistema (created_by).
  const nuevo = await fetch(`${BASE}/auth/usuarios`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'delete_dep_test', nombre: 'Delete Dep Test', password: 'test1234', rol: 'admin' }),
  }).then(r => r.json())
  const tUsuario = tok({ id: nuevo.id, username: 'delete_dep_test', nombre: 'Delete Dep Test', rol: 'admin' })
  await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${tUsuario}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'USER-DELETE-DEP-1', fecha: '2026-01-01', proveedor_nombre: 'Proveedor X', importe: 10 }),
  })
  const rUsuarioConDependencia = await fetch(`${BASE}/auth/usuarios/${nuevo.id}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${admin}` },
  })
  assert.equal(rUsuarioConDependencia.status, 409)

  // Sin dependencias, el borrado sigue funcionando normal.
  const puestoSuelto = await fetch(`${BASE}/auth/puestos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Puesto Delete Suelto' }),
  }).then(r => r.json())
  const rBorradoOk = await fetch(`${BASE}/auth/puestos/${puestoSuelto.id}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${admin}` },
  })
  assert.equal(rBorradoOk.status, 200)
})

test('Una misma OC muestra la misma tasa de cambio resuelta en "Compras › OC" y en "Seguimiento OC Compras"', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  // Tasa del sistema deliberadamente distinta a la cargada en la OC, para que
  // el viejo criterio opuesto entre pantallas se notara si volviera a romperse.
  await fetch(`${BASE}/finanzas/tipo-cambio`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ moneda: 'DÓLAR', valor: 1200, fuente: 'BNA', fecha: '2026-08-01' }),
  })
  const oc = await fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proveedor_nombre: 'Proveedor TC Unificado Test', fecha: '2026-08-05', moneda: 'DÓLAR', tasa_cambio: 1000,
      items: [{ descripcion: 'Item', cantidad: 1, precio_unitario: 100, precio_final: 100 }],
    }),
  }).then(r => r.json())

  const listaCompras = await fetch(`${BASE}/compras/oc?buscar=TC Unificado`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  const filaCompras = listaCompras.datos.find(r => r.id === oc.id)
  assert.equal(filaCompras.tc_resuelto, 1000, '"Compras › OC" usa la tasa cargada en la OC')

  const listaSeguimiento = await fetch(`${BASE}/finanzas/seguimiento-oc-compras?buscar=TC Unificado`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  const filaSeguimiento = listaSeguimiento.find(r => r.oc_id === oc.id)
  assert.equal(filaSeguimiento.oc_tc_usado, 1000, 'Seguimiento OC Compras debe resolver la misma tasa que "Compras › OC", no la del sistema (1200)')
})

test('Cuotas de OC (compras y clientes): si el % no suma 100, se rechaza el guardado', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const ocCompraInvalida = await fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proveedor_nombre: 'Proveedor Cuotas Pct Test', items: [{ descripcion: 'Item', cantidad: 1, precio_unitario: 100, precio_final: 100 }],
      cuotas: [{ tipo: 'anticipo', pct: 30 }, { tipo: 'saldo_final', pct: 50 }],
    }),
  })
  assert.equal(ocCompraInvalida.status, 400)
  assert.match((await ocCompraInvalida.json()).error, /80%/)

  const ocCompraValida = await fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      proveedor_nombre: 'Proveedor Cuotas Pct Test', items: [{ descripcion: 'Item', cantidad: 1, precio_unitario: 100, precio_final: 100 }],
      cuotas: [{ tipo: 'anticipo', pct: 30 }, { tipo: 'saldo_final', pct: 70 }],
    }),
  })
  assert.equal(ocCompraValida.status, 201)

  // Editarla y romper la suma también se rechaza.
  const ocEditada = await ocCompraValida.json()
  const rEditarRompe = await fetch(`${BASE}/compras/oc/${ocEditada.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cuotas: [{ tipo: 'anticipo', pct: 30 }, { tipo: 'saldo_final', pct: 60 }] }),
  })
  assert.equal(rEditarRompe.status, 400)

  const ocClienteInvalida = await fetch(`${BASE}/finanzas/oc-clientes`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cliente: 'Cliente Cuotas Pct Test', numero_oc: 'OCV-PCT-1', monto_oc: 1000, fecha_oc: '2026-01-01',
      cuotas: [{ tipo: 'anticipo', pct: 40 }, { tipo: 'saldo_final', pct: 40 }],
    }),
  })
  assert.equal(ocClienteInvalida.status, 400)

  // Una cuota sin % (solo monto fijo) no participa de la suma exigida.
  const ocClienteMixta = await fetch(`${BASE}/finanzas/oc-clientes`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cliente: 'Cliente Cuotas Pct Test', numero_oc: 'OCV-PCT-2', monto_oc: 1000, fecha_oc: '2026-01-01',
      cuotas: [{ tipo: 'anticipo', pct: 100 }, { tipo: 'avance', monto_planeado: 500 }],
    }),
  })
  assert.equal(ocClienteMixta.status, 201)
})

test('Detalle de OC: el estado de pago se lee de la factura real vinculada, no de una columna desconectada', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const oc = await fetch(`${BASE}/compras/oc`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ proveedor_nombre: 'Proveedor Pago OC Test', items: [{ descripcion: 'Item', cantidad: 1, precio_unitario: 100, precio_final: 100 }] }),
  }).then(r => r.json())
  const factura = await fetch(`${BASE}/finanzas/facturas-compra`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FC-PAGO-OC-1', fecha: '2026-01-01', proveedor_nombre: 'Proveedor Pago OC Test', oc_id: oc.id, importe: 100 }),
  }).then(r => r.json())

  const detalleAntes = await fetch(`${BASE}/compras/oc/${oc.id}`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.equal(detalleAntes.facturas[0].pago_confirmado, 0)

  await fetch(`${BASE}/finanzas/facturas-compra/${factura.id}/pagos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo: 'total', forma_pago: 'transferencia', importe: 100, moneda: 'PESO', fecha: '2026-01-05' }),
  })

  const detalleDespues = await fetch(`${BASE}/compras/oc/${oc.id}`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.equal(detalleDespues.facturas[0].pago_confirmado, 1, 'el estado de pago debe reflejar el pago real recién cargado')
})

test('rrhh_registros.actividad_id y pedidos_stock.actividad_id ahora tienen su FK declarada contra rrhh_actividades', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })
  const actividad = await fetch(`${BASE}/rrhh/actividades`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Actividad FK Test' }),
  }).then(r => r.json())

  const db = new Database(DB_PATH)
  db.pragma('foreign_keys = ON')
  db.prepare("INSERT INTO rrhh_registros (fecha, horas, actividad_id) VALUES ('2026-01-01', 1, ?)").run(actividad.id)
  assert.throws(
    () => db.prepare("INSERT INTO rrhh_registros (fecha, horas, actividad_id) VALUES ('2026-01-01', 1, 999999)").run(),
    /FOREIGN KEY/,
    'un actividad_id inexistente debe rechazarse'
  )
  db.close()
})

test('Producción: el listado no duplica el conteo de tareas ni la suma de horas cuando una OT tiene varias de cada', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const ot = await fetch(`${BASE}/produccion`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ descripcion: 'OT Fan-Out Test' }),
  }).then(r => r.json())

  const t1 = await fetch(`${BASE}/produccion/${ot.id}/tareas`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ descripcion: 'Tarea 1' }),
  }).then(r => r.json())
  await fetch(`${BASE}/produccion/${ot.id}/tareas`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ descripcion: 'Tarea 2' }),
  })
  await fetch(`${BASE}/produccion/${ot.id}/tareas/${t1.id}/toggle`, { method: 'PUT', headers: { Authorization: `Bearer ${admin}` } })

  await fetch(`${BASE}/produccion/${ot.id}/partes`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operario: 'Juan', horas: 3 }),
  })
  await fetch(`${BASE}/produccion/${ot.id}/partes`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operario: 'Pedro', horas: 5 }),
  })

  const lista = await fetch(`${BASE}/produccion?buscar=Fan-Out`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  const fila = lista.datos.find(r => r.id === ot.id)
  assert.equal(fila.total_tareas, 2, 'no debe duplicarse por el cruce con partes (2 tareas × 2 partes = 4 si estuviera roto)')
  assert.equal(fila.tareas_ok, 1)
  assert.equal(fila.total_horas, 8, '3 + 5, no un múltiplo inflado por el cruce con tareas')
})

test('CRM: el listado de empresas no infla presupuestado/ganado cuando una empresa tiene varios contactos', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const empresa = await fetch(`${BASE}/crm/empresas`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Empresa Fan-Out Test' }),
  }).then(r => r.json())

  for (const nombre of ['Contacto 1', 'Contacto 2', 'Contacto 3']) {
    await fetch(`${BASE}/crm/contactos`, {
      method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ empresa_id: empresa.id, nombre }),
    })
  }
  await fetch(`${BASE}/crm/cotizaciones`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ empresa_id: empresa.id, presupuestado: 1000, ganado: 0 }),
  })
  await fetch(`${BASE}/crm/cotizaciones`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ empresa_id: empresa.id, presupuestado: 2000, ganado: 2000 }),
  })

  const lista = await fetch(`${BASE}/crm/empresas?buscar=Fan-Out`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  const fila = lista.datos.find(r => r.id === empresa.id)
  assert.equal(fila.contactos_count, 3)
  assert.equal(fila.cotizaciones_count, 2)
  assert.equal(fila.total_presupuestado, 3000, '1000 + 2000, no multiplicado por los 3 contactos (9000 si estuviera roto)')
  assert.equal(fila.total_ganado, 2000)
})

test('Producción: editar un parte de una OT ajena da 404, no los datos de otra OT', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const otA = await fetch(`${BASE}/produccion`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ descripcion: 'OT A Parte Ajeno Test' }),
  }).then(r => r.json())
  const otB = await fetch(`${BASE}/produccion`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ descripcion: 'OT B Parte Ajeno Test' }),
  }).then(r => r.json())
  const parteA = await fetch(`${BASE}/produccion/${otA.id}/partes`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operario: 'Juan', horas: 4 }),
  }).then(r => r.json())

  const rEditarDesdeOtraOt = await fetch(`${BASE}/produccion/${otB.id}/partes/${parteA.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ operario: 'Intruso', horas: 999 }),
  })
  assert.equal(rEditarDesdeOtraOt.status, 404, 'no debe poder editar un parte que no es de esa OT')

  const parteSinTocar = await fetch(`${BASE}/produccion/${otA.id}`, { headers: { Authorization: `Bearer ${admin}` } })
    .then(r => r.json()).then(d => d.partes.find(p => p.id === parteA.id))
  assert.equal(parteSinTocar.operario, 'Juan', 'el parte real no debe haberse alterado')
  assert.equal(parteSinTocar.horas, 4)
})

test('Gantt: predecesoras acepta ids como string (típico de un <select>) tanto al crear como al editar una tarea', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const proyecto = await fetch(`${BASE}/proyectos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'GANTTPRED01', nombre: 'Proyecto Predecesoras Test', cliente_nombre: 'Cliente Test' }),
  }).then(r => r.json())

  const tarea1 = await fetch(`${BASE}/gantt/proyecto/${proyecto.id}/tareas`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Tarea 1' }),
  }).then(r => r.json())

  // predecesoras con el id como string, tal como llega de un <select> del formulario.
  const tarea2 = await fetch(`${BASE}/gantt/proyecto/${proyecto.id}/tareas`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Tarea 2', predecesoras: [String(tarea1.id)] }),
  }).then(r => r.json())

  const tareas = await fetch(`${BASE}/gantt/proyecto/${proyecto.id}/tareas`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  const t2 = tareas.find(t => t.id === tarea2.id)
  assert.ok(t2.predecesoras?.some(p => String(p) === String(tarea1.id)), 'la predecesora en string debe quedar vinculada igual que si fuera número')

  // Editarla con su propio id como string (autoreferencia) no debe agregarse.
  await fetch(`${BASE}/gantt/proyecto/${proyecto.id}/tareas/${tarea2.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Tarea 2', predecesoras: [String(tarea1.id), String(tarea2.id)] }),
  })
  const tareasDespues = await fetch(`${BASE}/gantt/proyecto/${proyecto.id}/tareas`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  const t2Despues = tareasDespues.find(t => t.id === tarea2.id)
  assert.ok(!t2Despues.predecesoras?.some(p => String(p) === String(tarea2.id)), 'no debe poder quedar como predecesora de sí misma')
  assert.ok(t2Despues.predecesoras?.some(p => String(p) === String(tarea1.id)), 'la predecesora real debe seguir ahí')
})

test('Editar un registro inexistente da 404 en vez de responder éxito sin haber cambiado nada', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const rUsuario = await fetch(`${BASE}/auth/usuarios/999999`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'No debería aplicarse' }),
  })
  assert.equal(rUsuario.status, 404)

  const rCuenta = await fetch(`${BASE}/finanzas/cuentas/999999`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'No debería aplicarse' }),
  })
  assert.equal(rCuenta.status, 404)

  // Edición legítima de una cuenta real sigue funcionando, con defaults como el POST.
  const cuenta = await fetch(`${BASE}/finanzas/cuentas`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Cuenta 404 Test', tipo: 'Banco', moneda: 'ARS', saldo_inicial: 100 }),
  }).then(r => r.json())
  const rCuentaOk = await fetch(`${BASE}/finanzas/cuentas/${cuenta.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ saldo_inicial: 500 }),
  }).then(r => r.json())
  assert.equal(rCuentaOk.status, undefined)
  assert.equal(rCuentaOk.nombre, 'Cuenta 404 Test', 'los campos no enviados deben conservar su valor, no quedar vacíos')
  assert.equal(rCuentaOk.saldo_inicial, 500)

  for (const ruta of ['form21', 'form22', 'form26', 'form34', 'form10', 'form37', 'epp', 'packing']) {
    const r = await fetch(`${BASE}/formularios/${ruta}/999999`, {
      method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    assert.equal(r.status, 404, `PUT /formularios/${ruta}/999999 debería dar 404`)
  }
})

test('Editar un código a uno ya existente da 409 claro (Stock, Mantenimiento, Proyectos), igual que al crear', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const prod1 = await fetch(`${BASE}/stock/productos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'DUP-STOCK-1', descripcion: 'Producto 1' }),
  }).then(r => r.json())
  await fetch(`${BASE}/stock/productos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'DUP-STOCK-2', descripcion: 'Producto 2' }),
  })
  const rStock = await fetch(`${BASE}/stock/productos/${prod1.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'DUP-STOCK-2' }),
  })
  assert.equal(rStock.status, 409)

  const eq1 = await fetch(`${BASE}/mantenimiento/equipos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'DUP-EQ-1', nombre: 'Equipo 1', categoria: 'General' }),
  }).then(r => r.json())
  await fetch(`${BASE}/mantenimiento/equipos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'DUP-EQ-2', nombre: 'Equipo 2', categoria: 'General' }),
  })
  const rEquipo = await fetch(`${BASE}/mantenimiento/equipos/${eq1.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'DUP-EQ-2' }),
  })
  assert.equal(rEquipo.status, 409)

  const proy1 = await fetch(`${BASE}/proyectos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'DUP-PROY-1', nombre: 'Proyecto 1' }),
  }).then(r => r.json())
  await fetch(`${BASE}/proyectos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'DUP-PROY-2', nombre: 'Proyecto 2' }),
  })
  const rProyecto = await fetch(`${BASE}/proyectos/${proy1.id}`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'DUP-PROY-2' }),
  })
  assert.equal(rProyecto.status, 409)
})

test('Saldo por cuenta financiera se calcula independiente entre cuentas, sin cruzarse (consulta agregada, no N+1)', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const cA = await fetch(`${BASE}/finanzas/cuentas`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Cuenta Saldo A Test', tipo: 'Banco', moneda: 'ARS', saldo_inicial: 1000 }),
  }).then(r => r.json())
  const cB = await fetch(`${BASE}/finanzas/cuentas`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Cuenta Saldo B Test', tipo: 'Banco', moneda: 'ARS', saldo_inicial: 500 }),
  }).then(r => r.json())
  // Cuenta C queda sin ningún movimiento — caso borde de la consulta agregada.
  const cC = await fetch(`${BASE}/finanzas/cuentas`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Cuenta Saldo C Test', tipo: 'Banco', moneda: 'ARS', saldo_inicial: 200 }),
  }).then(r => r.json())

  await fetch(`${BASE}/finanzas/movimientos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fecha: '2026-01-01', tipo: 'Ingreso', descripcion: 'Ingreso A', monto: 300, cuenta_id: cA.id }),
  })
  await fetch(`${BASE}/finanzas/movimientos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fecha: '2026-01-02', tipo: 'Egreso', descripcion: 'Egreso A', monto: 100, cuenta_id: cA.id }),
  })
  await fetch(`${BASE}/finanzas/movimientos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fecha: '2026-01-01', tipo: 'Egreso', descripcion: 'Egreso B', monto: 50, cuenta_id: cB.id }),
  })

  const cuentas = await fetch(`${BASE}/finanzas/cuentas`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  const filaA = cuentas.find(c => c.id === cA.id)
  const filaB = cuentas.find(c => c.id === cB.id)
  const filaC = cuentas.find(c => c.id === cC.id)

  assert.equal(filaA.saldo_actual, 1200, '1000 + 300 - 100, sin verse afectada por los movimientos de B')
  assert.equal(filaB.saldo_actual, 450, '500 - 50, sin verse afectada por los movimientos de A')
  assert.equal(filaC.saldo_actual, 200, 'sin movimientos, el saldo es directamente el inicial')
})

test('Un resto de hasta $10 por redondeo de tipo de cambio se considera cobrado/pagado del todo', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  // Factura en pesos de $1000: un pago de $991 deja un resto de $9 (dentro de
  // tolerancia) y otro de $985 deja un resto de $15 (fuera de tolerancia).
  const fvChica = await fetch(`${BASE}/finanzas/facturas-venta`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FV-TOL-CHICA', fecha: '2026-01-01', cliente_nombre: 'Cliente Tolerancia Chica', importe: 1000, moneda: 'PESO' }),
  }).then(r => r.json())
  await fetch(`${BASE}/finanzas/facturas-venta/${fvChica.id}/pagos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo: 'total', forma_pago: 'transferencia', importe: 991, moneda: 'PESO', fecha: '2026-01-01', estado: 'confirmado' }),
  })
  const fvChicaLista = await fetch(`${BASE}/finanzas/facturas-venta?buscar=FV-TOL-CHICA`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.equal(fvChicaLista[0].pago_confirmado, 1, 'un resto de $9 debe considerarse cobrado del todo')
  assert.equal(fvChicaLista[0].saldo_pendiente, 0)

  const fvGrande = await fetch(`${BASE}/finanzas/facturas-venta`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ numero: 'FV-TOL-GRANDE', fecha: '2026-01-01', cliente_nombre: 'Cliente Tolerancia Grande', importe: 1000, moneda: 'PESO' }),
  }).then(r => r.json())
  await fetch(`${BASE}/finanzas/facturas-venta/${fvGrande.id}/pagos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tipo: 'total', forma_pago: 'transferencia', importe: 985, moneda: 'PESO', fecha: '2026-01-01', estado: 'confirmado' }),
  })
  const fvGrandeLista = await fetch(`${BASE}/finanzas/facturas-venta?buscar=FV-TOL-GRANDE`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.equal(fvGrandeLista[0].pago_confirmado, 0, 'un resto de $15 no debe considerarse cobrado del todo')
  assert.equal(fvGrandeLista[0].saldo_pendiente, 15)
})

test('Análisis de Proyectos: calcula costo de mano de obra (horas × costo_hora) y de materiales por lo RETIRADO de stock, no por lo previsto', async () => {
  const admin = tok({ id: 1, username: 'admin', nombre: 'Admin', rol: 'admin' })

  const empleado = await fetch(`${BASE}/rrhh/empleados`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Empleado Analisis Test', costo_hora: 1500 }),
  }).then(r => r.json())

  const proyecto = await fetch(`${BASE}/proyectos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'ANALISIS01', nombre: 'Proyecto Analisis Test', cliente_nombre: 'Cliente Test' }),
  }).then(r => r.json())

  await fetch(`${BASE}/rrhh/registros`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fecha: '2026-08-01', empleado_id: empleado.id, proyecto_id: proyecto.id, horas: 10 }),
  })

  const producto = await fetch(`${BASE}/stock/productos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'MAT-ANALISIS-1', descripcion: 'Chapa de prueba', precio_costo: 200, stock_actual: 100 }),
  }).then(r => r.json())

  // Cantidad PREVISTA en la pestaña Materiales de Proyectos: NO debe influir en el costo.
  await fetch(`${BASE}/proyectos/${proyecto.id}/materiales`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ producto_id: producto.id, descripcion: 'Chapa de prueba', cantidad: 999 }),
  })

  // Retiro manual desde Stock: "proyecto" guarda solo el código (ver Stock.jsx).
  await fetch(`${BASE}/stock/movimientos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ producto_id: producto.id, tipo: 'salida', cantidad: 5, fecha: '2026-08-01', proyecto: 'ANALISIS01', autorizado_por_id: 1 }),
  })
  // Entrega vía Pedido de Stock: "proyecto" guarda "CODIGO — Nombre" (ver textoAsignacion en stock.js) — debe contarse igual.
  await fetch(`${BASE}/stock/movimientos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ producto_id: producto.id, tipo: 'salida', cantidad: 2, fecha: '2026-08-02', proyecto: 'ANALISIS01 — Proyecto Analisis Test', autorizado_por_id: 1 }),
  })
  // Una devolución al proyecto resta del consumo neto.
  await fetch(`${BASE}/stock/movimientos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ producto_id: producto.id, tipo: 'devolucion', cantidad: 1, fecha: '2026-08-03', proyecto: 'ANALISIS01' }),
  })
  // Una entrada (reposición de stock, no consumo) con el mismo proyecto no debe sumar nada.
  await fetch(`${BASE}/stock/movimientos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ producto_id: producto.id, tipo: 'entrada', cantidad: 50, fecha: '2026-08-03', proyecto: 'ANALISIS01' }),
  })
  // Una salida de OTRO proyecto no debe mezclarse.
  const otroProyecto = await fetch(`${BASE}/proyectos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ codigo: 'ANALISIS02', nombre: 'Otro Proyecto Test' }),
  }).then(r => r.json())
  await fetch(`${BASE}/stock/movimientos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ producto_id: producto.id, tipo: 'salida', cantidad: 40, fecha: '2026-08-03', proyecto: 'ANALISIS02', autorizado_por_id: 1 }),
  })

  // Neto para ANALISIS01: 5 + 2 - 1 = 6 unidades × 200 = 1200 (los 999 previstos y los 40 de otro proyecto no cuentan).
  const lista = await fetch(`${BASE}/analisis-proyectos`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  const fila = lista.find(p => p.id === proyecto.id)
  assert.equal(fila.horas_totales, 10)
  assert.equal(fila.costo_mano_obra, 15000, '10 horas × 1500 el costo/hora')
  assert.equal(fila.costo_materiales, 1200, '(5 + 2 - 1) unidades retiradas × 200 de precio de costo, no los 999 previstos')
  assert.equal(fila.costo_total, 16200)

  const filaOtro = lista.find(p => p.id === otroProyecto.id)
  assert.equal(filaOtro.costo_materiales, 8000, '40 unidades × 200, sin mezclarse con ANALISIS01')

  const detalle = await fetch(`${BASE}/analisis-proyectos/${proyecto.id}`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.equal(detalle.porEmpleado.length, 1)
  assert.equal(detalle.porEmpleado[0].nombre, 'EMPLEADO ANALISIS TEST')
  assert.equal(detalle.porEmpleado[0].subtotal, 15000)
  assert.equal(detalle.porMaterial.length, 1)
  assert.equal(detalle.porMaterial[0].cantidad, 6)
  assert.equal(detalle.porMaterial[0].subtotal, 1200)

  // Sin el permiso del módulo nuevo, ni el listado ni el costo_hora del empleado deben verse.
  const sinPermiso = await fetch(`${BASE}/auth/usuarios`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'sin_analisis_test', nombre: 'Sin Analisis Test', password: 'test1234', rol: 'solo_lectura' }),
  }).then(r => r.json())
  await fetch(`${BASE}/auth/usuarios/${sinPermiso.id}/permisos`, {
    method: 'PUT', headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ rrhh: { leer: true, escribir: false } }),
  })
  const tSinPermiso = tok({ id: sinPermiso.id, username: 'sin_analisis_test', nombre: 'Sin Analisis Test', rol: 'solo_lectura' })

  const rListado = await fetch(`${BASE}/analisis-proyectos`, { headers: { Authorization: `Bearer ${tSinPermiso}` } })
  assert.equal(rListado.status, 403)

  const empleados = await fetch(`${BASE}/rrhh/empleados`, { headers: { Authorization: `Bearer ${tSinPermiso}` } }).then(r => r.json())
  const empSinPermiso = empleados.find(e => e.id === empleado.id)
  assert.equal(empSinPermiso.costo_hora, undefined, 'sin permiso de Análisis de Proyectos no debe verse el costo por hora')

  const empleadosAdmin = await fetch(`${BASE}/rrhh/empleados`, { headers: { Authorization: `Bearer ${admin}` } }).then(r => r.json())
  assert.equal(empleadosAdmin.find(e => e.id === empleado.id).costo_hora, 1500, 'el admin sí debe ver el costo por hora')
})
