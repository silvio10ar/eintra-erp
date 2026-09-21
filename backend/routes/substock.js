'use strict'
const express = require('express')
const { db } = require('../db/database')
const { verificarToken } = require('../middleware/auth')
const { hoyArgentina } = require('../helpers/fecha')
const { obtenerAutorizantes } = require('../helpers/organigrama')
const { enviarMensajeSistema } = require('../helpers/mensajes')
const { aplicarMovimiento } = require('../helpers/stockLotes')
const { restarDeSubstock } = require('../helpers/substock')

const router = express.Router()
router.use(verificarToken)

// El permiso acá depende de un parámetro de ruta (:substock), no de un módulo
// fijo como en el resto del código — cada substock vive en su propio módulo
// de permisos (calidad/produccion), separado del permiso de stock.
const puedeSubstock = nivel => (req, res, next) => {
  const s = req.params.substock
  if (!['calidad', 'produccion', 'electrico'].includes(s)) return res.status(400).json({ error: 'Substock inválido' })
  return req.permisos?.[s]?.[nivel] ? next() : res.status(403).json({ error: `Sin permisos de ${nivel}` })
}

// Saldo pendiente de entregar de este substock — no filtra por productos.activo:
// si un producto se desactiva después de que ya hay material en el substock,
// igual se lo tiene que poder ver y entregar desde acá.
router.get('/:substock/saldo', puedeSubstock('leer'), (req, res) => {
  const rows = db.prepare(`
    SELECT ss.id, ss.producto_id, ss.lote_id, ss.cantidad_actual, ss.updated_at,
      p.codigo, p.descripcion, p.unidad, p.trazabilidad_stock, p.ubicacion, sl.partida
    FROM substock_saldo ss
    JOIN productos p ON p.id = ss.producto_id
    JOIN stock_lotes sl ON sl.id = ss.lote_id
    WHERE ss.substock = ? AND ss.cantidad_actual > 0.0001
    ORDER BY p.descripcion
  `).all(req.params.substock)
  res.json(rows)
})

// Cambia dónde está físicamente guardado un material dentro de este
// substock — es un dato del producto (productos.ubicacion), no del
// substock en sí, así que el cambio se ve también desde Stock/Materiales
// y en cualquier otro substock que tenga el mismo producto. Se valida que
// el producto tenga saldo en ESTE substock para no abrir, con el permiso
// liviano de un substock, una vía para editar cualquier producto del
// catálogo general.
router.patch('/:substock/productos/:productoId/ubicacion', puedeSubstock('escribir'), (req, res) => {
  const tieneSaldo = db.prepare('SELECT 1 FROM substock_saldo WHERE substock=? AND producto_id=? AND cantidad_actual > 0.0001')
    .get(req.params.substock, req.params.productoId)
  if (!tieneSaldo) return res.status(404).json({ error: 'Ese producto no tiene saldo en este substock' })
  db.prepare("UPDATE productos SET ubicacion=?, updated_at=datetime('now','localtime') WHERE id=?")
    .run((req.body.ubicacion || '').trim(), req.params.productoId)
  res.json({ ok: true })
})

// Entrega de este substock a una persona, con proyecto asignado — la
// contraparte de la transferencia que carga Stock (POST /stock/movimientos
// con substock_destino). No pasa por aplicarMovimiento: el stock principal ya
// se descontó cuando el material entró a este substock, acá solo se mueve el
// saldo propio del substock.
router.post('/:substock/entregas', puedeSubstock('escribir'), (req, res) => {
  const substock = req.params.substock
  const { lote_id, cantidad, cliente_interno, proyecto, observaciones, fecha, autorizado_por_id } = req.body
  const cant = parseFloat(cantidad)
  if (!lote_id) return res.status(400).json({ error: 'Elegí de qué partida/serie entregar' })
  if (!cant || cant <= 0) return res.status(400).json({ error: 'Cantidad inválida' })
  if (!cliente_interno?.trim()) return res.status(400).json({ error: 'Elegí quién recibe este material' })
  // Misma exigencia que un retiro real desde Stock: toda entrega a una
  // persona tiene que quedar con quién la autoriza.
  const autorizante = obtenerAutorizantes().find(u => u.id === parseInt(autorizado_por_id))
  if (!autorizante) return res.status(400).json({ error: 'Elegí quién autoriza esta entrega' })
  const saldo = db.prepare('SELECT * FROM substock_saldo WHERE substock=? AND lote_id=?').get(substock, lote_id)
  if (!saldo) return res.status(404).json({ error: 'Ese substock no tiene esa partida/serie' })
  const lote = db.prepare('SELECT partida FROM stock_lotes WHERE id=?').get(lote_id)
  const producto = db.prepare('SELECT * FROM productos WHERE id=?').get(saldo.producto_id)
  const fechaFinal = fecha || hoyArgentina()
  try {
    db.transaction(() => {
      restarDeSubstock(substock, lote_id, cant)
      db.prepare(`
        INSERT INTO movimientos_stock
          (producto_id, tipo, cantidad, fecha, observaciones, proyecto, cliente_interno, created_by,
           autorizado_por_id, autorizado_por_nombre, lote_id, partida, substock_origen)
        VALUES (?, 'salida', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(saldo.producto_id, cant, fechaFinal, observaciones || '', proyecto || '',
             cliente_interno.trim(), req.usuario.id, autorizante.id, autorizante.nombre, lote_id, lote?.partida || '', substock)
    })()
  } catch (e) {
    return res.status(400).json({ error: e.message })
  }
  enviarMensajeSistema({
    de_id: req.usuario.id, de_nombre: req.usuario.nombre, para_id: autorizante.id,
    asunto: `Entrega de substock autorizada: ${producto?.codigo} — ${producto?.descripcion}`,
    cuerpo: `Se entregó desde el substock de ${substock}:\n\n${producto?.codigo} — ${producto?.descripcion}\n`
      + `Cantidad: ${cant} ${producto?.unidad}\nEntregado a: ${cliente_interno.trim()}\n`
      + `Proyecto/Actividad: ${proyecto || '—'}\nFecha: ${fechaFinal}\nCargado por: ${req.usuario.nombre}`
      + `${observaciones ? `\nObservaciones: ${observaciones}` : ''}${lote?.partida ? `\nPartida/Serie: ${lote.partida}` : ''}`,
  })
  res.status(201).json({ ok: true })
})

// Devuelve material de este substock al Stock principal — la operación
// inversa del traspaso, para cuando se recibió de más o ya no hace falta.
// Es una reubicación interna igual que el traspaso (no "sale" de la empresa),
// así que tampoco exige autorización de gerente. Vuelve a la MISMA
// partida/serie de la que salió (no una nueva genérica) para no perder la
// trazabilidad.
router.post('/:substock/devoluciones', puedeSubstock('escribir'), (req, res) => {
  const substock = req.params.substock
  const { lote_id, cantidad, observaciones, fecha } = req.body
  const cant = parseFloat(cantidad)
  if (!lote_id) return res.status(400).json({ error: 'Elegí de qué partida/serie devolver' })
  if (!cant || cant <= 0) return res.status(400).json({ error: 'Cantidad inválida' })
  const saldo = db.prepare('SELECT * FROM substock_saldo WHERE substock=? AND lote_id=?').get(substock, lote_id)
  if (!saldo) return res.status(404).json({ error: 'Ese substock no tiene esa partida/serie' })
  const lote = db.prepare('SELECT * FROM stock_lotes WHERE id=?').get(lote_id)
  const producto = db.prepare('SELECT * FROM productos WHERE id=?').get(saldo.producto_id)
  if (!producto) return res.status(404).json({ error: 'Producto no encontrado' })
  const fechaFinal = fecha || hoyArgentina()
  try {
    db.transaction(() => {
      restarDeSubstock(substock, lote_id, cant)
      const ef = aplicarMovimiento(producto, 'devolucion', cant, {
        partida: lote?.partida, precio_costo: lote?.precio_costo,
        proveedor: lote?.proveedor, referencia: lote?.referencia, remito: lote?.remito, fecha: fechaFinal,
      })
      db.prepare(`
        INSERT INTO movimientos_stock
          (producto_id, tipo, cantidad, fecha, observaciones, created_by, lote_id, partida, substock_origen)
        VALUES (?, 'devolucion', ?, ?, ?, ?, ?, ?, ?)
      `).run(saldo.producto_id, cant, fechaFinal, observaciones || '', req.usuario.id, ef.lote_id, ef.partida, substock)
    })()
  } catch (e) {
    return res.status(400).json({ error: e.message })
  }
  res.status(201).json({ ok: true })
})

// Historial de este substock (traspasos recibidos + entregas hechas) — es la
// única forma de verlo para alguien sin permiso de Stock, ya que el historial
// general (GET /stock/movimientos) exige ser gerente.
router.get('/:substock/movimientos', puedeSubstock('leer'), (req, res) => {
  const s = req.params.substock
  const rows = db.prepare(`
    SELECT m.*, p.codigo, p.descripcion, p.unidad
    FROM movimientos_stock m LEFT JOIN productos p ON m.producto_id = p.id
    WHERE m.substock_destino = ? OR m.substock_origen = ?
    ORDER BY m.created_at DESC LIMIT 200
  `).all(s, s)
  res.json(rows)
})

module.exports = router
