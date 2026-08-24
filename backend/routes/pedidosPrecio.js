'use strict'
const express = require('express')
const { db } = require('../db/database')
const { verificarToken, puede } = require('../middleware/auth')
const { hoyArgentina } = require('../helpers/fecha')

const router = express.Router()
router.use(verificarToken)

// "Cargar precio" vive en Administración → Pedidos de precio, que habilita el
// botón con escritura de Administración O de Compras — son materiales del
// catálogo de Compras, y esa pantalla vive dentro del módulo Administración,
// así que cualquiera de los dos permisos alcanza.
const puedeResolver = req => !!(req.permisos.administracion?.escribir || req.permisos.compras?.escribir)
// "Cancelar" en cambio solo se ofrece desde Materiales (módulo Compras) — se
// saca de Administración a propósito para no depender de dos permisos
// distintos gateando la misma acción.
const puedeCancelarAjeno = req => !!req.permisos.compras?.escribir

// Materiales marcados como "precio crítico" (precio_critico=1) necesitan que
// alguien revise su precio cada precio_frecuencia_dias, aunque nadie lo edite
// ni entre una OC nueva en el medio. No hay un cron en este proyecto — en vez
// de eso, se generan al vuelo los pedidos que correspondan, sin duplicar los
// que ya están pendientes.
//
// OJO: esto es un INSERT (escritura) con un full scan de "productos" — y
// better-sqlite3/SQLite es de un solo escritor a la vez, así que ejecutarlo en
// cada GET (esta función se llama desde /pendientes-ids, que Materiales y
// Análisis de Proyectos piden en cada montaje) competiría por el lock de
// escritura con cualquier otra escritura del sistema en cada apertura de esas
// pantallas, sean pocas o cientos las veces por día. Por eso se throttlea: el
// scan real corre como máximo una vez cada INTERVALO_MS, sin importar cuántas
// veces se llame — sigue sin hacer falta un cron, pero deja de pagar el costo
// en cada request.
// En test corre sin throttle: la suite necesita que cada corrida sea determinística,
// no depender de cuánto tardó el test anterior en ejecutarse.
const INTERVALO_GENERACION_MS = process.env.NODE_ENV === 'test' ? 0 : 10 * 60 * 1000;
let ultimaGeneracion = 0;
function generarPedidosVencidos() {
  const ahora = Date.now();
  if (ahora - ultimaGeneracion < INTERVALO_GENERACION_MS) return;
  ultimaGeneracion = ahora;
  db.prepare(`
    INSERT INTO materiales_pedidos_precio (producto_id, solicitante_id, solicitante_nombre, observaciones)
    SELECT p.id, NULL, 'Sistema (precio vencido)', 'Generado automáticamente: pasó la frecuencia de revisión configurada'
    FROM productos p
    WHERE p.activo = 1
      AND p.precio_critico = 1
      AND p.precio_frecuencia_dias > 0
      AND p.precio_fecha != ''
      AND julianday('now','localtime') - julianday(p.precio_fecha) >= p.precio_frecuencia_dias
      AND NOT EXISTS (
        SELECT 1 FROM materiales_pedidos_precio pp
        WHERE pp.producto_id = p.id AND pp.estado = 'Pendiente'
      )
  `).run();
}

// Pedir el precio de un material: abierto a cualquier usuario logueado (el
// botón solo aparece en pantallas ya gateadas por su propio módulo, Materiales
// o Análisis de Proyectos) — no hace falta un permiso de módulo aparte.
// Idempotente: si ya hay un pedido pendiente para ese material, no duplica.
router.post('/', (req, res) => {
  const { producto_id, observaciones } = req.body
  const prod = db.prepare('SELECT id FROM productos WHERE id=? AND activo=1').get(producto_id)
  if (!prod) return res.status(404).json({ error: 'Material no encontrado' })
  const existente = db.prepare(`SELECT * FROM materiales_pedidos_precio WHERE producto_id=? AND estado='Pendiente'`).get(producto_id)
  if (existente) return res.json(existente)
  const r = db.prepare(`
    INSERT INTO materiales_pedidos_precio (producto_id, solicitante_id, solicitante_nombre, observaciones)
    VALUES (?,?,?,?)
  `).run(producto_id, req.usuario.id, req.usuario.nombre || '', observaciones || '')
  res.status(201).json(db.prepare('SELECT * FROM materiales_pedidos_precio WHERE id=?').get(r.lastInsertRowid))
})

// Pedidos pendientes (id + material) — para pintar "Ya pedido" en Materiales,
// Análisis de Proyectos y Costeo de Equipos sin necesitar permiso de
// administración, y para poder cancelar el propio desde Materiales (el id
// del pedido hace falta para eso, no solo saber que existe).
router.get('/pendientes-ids', (req, res) => {
  generarPedidosVencidos()
  const rows = db.prepare(`SELECT id, producto_id, solicitante_id FROM materiales_pedidos_precio WHERE estado='Pendiente'`).all()
  res.json(rows)
})

// Listado para Administración: solo lo pendiente, nunca el catálogo completo.
router.get('/', puede.leer('administracion'), (req, res) => {
  generarPedidosVencidos()
  const rows = db.prepare(`
    SELECT pp.id, pp.producto_id, pp.solicitante_nombre, pp.observaciones, pp.created_at,
           p.codigo, p.descripcion, p.unidad, p.precio_costo, p.precio_moneda, p.precio_fecha, p.proveedor
    FROM materiales_pedidos_precio pp
    JOIN productos p ON p.id = pp.producto_id
    WHERE pp.estado = 'Pendiente'
    ORDER BY pp.created_at ASC
  `).all()
  res.json(rows)
})

// Cargar el precio de costo (y, si hace falta, el proveedor) y resolver el pedido en un solo paso.
router.post('/:id/resolver', (req, res) => {
  if (!puedeResolver(req)) return res.status(403).json({ error: 'Sin permisos' })
  const pedido = db.prepare('SELECT * FROM materiales_pedidos_precio WHERE id=?').get(req.params.id)
  if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' })
  if (pedido.estado !== 'Pendiente') return res.status(400).json({ error: 'Este pedido ya fue resuelto' })
  const precio_costo = parseFloat(req.body.precio_costo)
  if (!(precio_costo > 0)) return res.status(400).json({ error: 'Cargá un precio válido' })
  const prod = db.prepare('SELECT proveedor, precio_moneda FROM productos WHERE id=?').get(pedido.producto_id)
  const proveedor = req.body.proveedor != null ? String(req.body.proveedor).trim() : prod.proveedor
  const precio_moneda = req.body.precio_moneda || prod.precio_moneda || 'PESOS'
  const hoy = hoyArgentina()
  db.transaction(() => {
    db.prepare(`UPDATE productos SET precio_costo=?, precio_moneda=?, precio_fecha=?, proveedor=?, updated_at=datetime('now','localtime') WHERE id=?`)
      .run(precio_costo, precio_moneda, hoy, proveedor, pedido.producto_id)
    db.prepare(`UPDATE materiales_pedidos_precio SET estado='Resuelto', resuelto_at=datetime('now','localtime') WHERE id=?`)
      .run(pedido.id)
  })()
  res.json({ ok: true })
})

// Cancelar un pedido propio, o cualquiera si se tiene permiso de escritura de
// Compras — el botón de cancelar solo se ofrece desde Materiales, nunca desde
// Administración (ahí solo se puede cargar el precio).
router.delete('/:id', (req, res) => {
  const pedido = db.prepare('SELECT * FROM materiales_pedidos_precio WHERE id=?').get(req.params.id)
  if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' })
  const esPropio = pedido.solicitante_id === req.usuario.id
  if (!esPropio && !puedeCancelarAjeno(req)) return res.status(403).json({ error: 'Sin permisos' })
  db.prepare(`UPDATE materiales_pedidos_precio SET estado='Cancelado' WHERE id=?`).run(pedido.id)
  res.json({ ok: true })
})

module.exports = router
