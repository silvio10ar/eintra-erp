'use strict'
const express = require('express')
const { db } = require('../db/database')
const { verificarToken, puede: permisoModulo } = require('../middleware/auth')
const { hoyArgentina } = require('../helpers/fecha')
const { obtenerAutorizantes } = require('../helpers/organigrama')
const { enviarMensajeSistema } = require('../helpers/mensajes')
const { aplicarMovimiento } = require('../helpers/stockLotes')

const router = express.Router()
router.use(verificarToken)

const leerVR = permisoModulo.leer('venta_repuestos')
const escribirVR = permisoModulo.escribir('venta_repuestos')
// Retirar de stock es la excepción: exige permiso real de Stock (el depósito),
// no el permiso liviano de Venta de Repuestos — mismo criterio que Pedido de
// Stock, donde pedir y entregar son permisos distintos a propósito.
const puedeStock = req => !!(req.permisos?.stock?.escribir)

const PEDIDO_SELECT = `
  SELECT pv.*, fc.numero_oc AS oc_cliente_numero
  FROM pedidos_venta_repuesto pv
  LEFT JOIN fin_oc_clientes fc ON fc.id = pv.oc_cliente_id
`

function itemsDe(pedidoIds) {
  if (!pedidoIds.length) return []
  return db.prepare(`
    SELECT pvi.*, p.codigo, p.descripcion, p.unidad, p.stock_actual, p.trazabilidad_stock,
           fv.numero AS factura_numero, fv.pago_confirmado AS factura_pago_confirmado
    FROM pedido_venta_repuesto_items pvi
    JOIN productos p ON p.id = pvi.producto_id
    LEFT JOIN facturas_venta fv ON fv.id = pvi.factura_venta_id
    WHERE pvi.pedido_id IN (${pedidoIds.map(() => '?').join(',')})
  `).all(...pedidoIds)
}

function validarCabeceraYItems(body) {
  const { cliente_id, oc_cliente_id, autorizado_por_id, items } = body
  const cliente = cliente_id ? db.prepare('SELECT id, nombre FROM clientes WHERE id=?').get(cliente_id) : null
  if (!cliente) return { error: 'Elegí un cliente' }
  if (!Array.isArray(items) || items.length === 0) return { error: 'Agregá al menos un ítem' }
  for (const it of items) {
    if (!it.producto_id || !parseFloat(it.cantidad) || parseFloat(it.cantidad) <= 0)
      return { error: 'Cada ítem necesita un producto y una cantidad mayor a 0' }
  }
  const autorizante = obtenerAutorizantes().find(u => u.id === parseInt(autorizado_por_id))
  if (!autorizante) return { error: 'Elegí quién autoriza este pedido' }
  let ocCliente = null
  if (oc_cliente_id) {
    ocCliente = db.prepare('SELECT id FROM fin_oc_clientes WHERE id=? AND cliente_id=?').get(oc_cliente_id, cliente.id)
    if (!ocCliente) return { error: 'La OC elegida no corresponde a este cliente' }
  }
  return { cliente, autorizante, ocCliente }
}

// ── Listado ────────────────────────────────────────────────────────────────
router.get('/', leerVR, (req, res) => {
  const { cliente_id, estado, desde, hasta, buscar } = req.query
  const conds = [], params = []
  if (cliente_id) { conds.push('pv.cliente_id=?'); params.push(cliente_id) }
  if (estado)     { conds.push('pv.estado=?'); params.push(estado) }
  if (desde)      { conds.push('pv.fecha>=?'); params.push(desde) }
  if (hasta)      { conds.push('pv.fecha<=?'); params.push(hasta) }
  if (buscar)     { conds.push('(pv.cliente_nombre LIKE ? OR pv.numero_oc_cliente LIKE ?)'); params.push(`%${buscar}%`, `%${buscar}%`) }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const pedidos = db.prepare(`${PEDIDO_SELECT} ${where} ORDER BY pv.created_at DESC`).all(...params)
  const items = itemsDe(pedidos.map(p => p.id))
  res.json(pedidos.map(p => ({ ...p, items: items.filter(i => i.pedido_id === p.id) })))
})

// Búsqueda liviana de facturas del cliente para vincular — propia (no la de
// Finanzas) para no exigir permiso de finanzas/administración solo por esto.
router.get('/facturas-disponibles', leerVR, (req, res) => {
  const { cliente_id, buscar } = req.query
  if (!cliente_id) return res.status(400).json({ error: 'Falta cliente_id' })
  const conds = ['cliente_id=?'], params = [cliente_id]
  if (buscar) { conds.push('numero LIKE ?'); params.push(`%${buscar}%`) }
  const rows = db.prepare(`
    SELECT id, numero, fecha, importe, pago_confirmado
    FROM facturas_venta WHERE ${conds.join(' AND ')} ORDER BY fecha DESC LIMIT 30
  `).all(...params)
  res.json(rows)
})

router.get('/:id', leerVR, (req, res) => {
  const p = db.prepare(`${PEDIDO_SELECT} WHERE pv.id=?`).get(req.params.id)
  if (!p) return res.status(404).json({ error: 'No encontrado' })
  res.json({ ...p, items: itemsDe([p.id]) })
})

// ── Crear ──────────────────────────────────────────────────────────────────
router.post('/', escribirVR, (req, res) => {
  const v = validarCabeceraYItems(req.body)
  if (v.error) return res.status(400).json({ error: v.error })
  const { cliente, autorizante, ocCliente } = v
  const { numero_oc_cliente, observaciones, items } = req.body
  const pedidoId = db.transaction(() => {
    const r = db.prepare(`
      INSERT INTO pedidos_venta_repuesto
        (cliente_id, cliente_nombre, oc_cliente_id, numero_oc_cliente, vendedor_id, vendedor_nombre,
         autorizado_por_id, autorizado_por_nombre, observaciones, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(cliente.id, cliente.nombre, ocCliente?.id || null, numero_oc_cliente || '', req.usuario.id, req.usuario.nombre || '',
           autorizante.id, autorizante.nombre, observaciones || '', req.usuario.id)
    const insItem = db.prepare(`INSERT INTO pedido_venta_repuesto_items (pedido_id, producto_id, cantidad, precio_unit) VALUES (?,?,?,?)`)
    for (const it of items) insItem.run(r.lastInsertRowid, it.producto_id, parseFloat(it.cantidad), parseFloat(it.precio_unit) || 0)
    return r.lastInsertRowid
  })()
  res.status(201).json({ id: pedidoId })
})

// ── Editar (solo si nada se retiró todavía) ─────────────────────────────────
router.put('/:id', escribirVR, (req, res) => {
  const ped = db.prepare('SELECT * FROM pedidos_venta_repuesto WHERE id=?').get(req.params.id)
  if (!ped) return res.status(404).json({ error: 'No encontrado' })
  const yaRetirado = db.prepare('SELECT COUNT(*) AS c FROM pedido_venta_repuesto_items WHERE pedido_id=? AND cantidad_retirada>0').get(ped.id).c
  if (yaRetirado) return res.status(400).json({ error: 'Ya se retiró stock de este pedido, no se puede editar' })
  const v = validarCabeceraYItems(req.body)
  if (v.error) return res.status(400).json({ error: v.error })
  const { cliente, autorizante, ocCliente } = v
  const { numero_oc_cliente, observaciones, items } = req.body
  db.transaction(() => {
    db.prepare(`
      UPDATE pedidos_venta_repuesto SET cliente_id=?, cliente_nombre=?, oc_cliente_id=?, numero_oc_cliente=?,
        autorizado_por_id=?, autorizado_por_nombre=?, observaciones=? WHERE id=?
    `).run(cliente.id, cliente.nombre, ocCliente?.id || null, numero_oc_cliente || '', autorizante.id, autorizante.nombre, observaciones || '', ped.id)
    db.prepare('DELETE FROM pedido_venta_repuesto_items WHERE pedido_id=?').run(ped.id)
    const insItem = db.prepare(`INSERT INTO pedido_venta_repuesto_items (pedido_id, producto_id, cantidad, precio_unit) VALUES (?,?,?,?)`)
    for (const it of items) insItem.run(ped.id, it.producto_id, parseFloat(it.cantidad), parseFloat(it.precio_unit) || 0)
  })()
  res.json({ ok: true })
})

// ── Cancelar (solo si nada se retiró todavía) ───────────────────────────────
router.delete('/:id', escribirVR, (req, res) => {
  const ped = db.prepare('SELECT * FROM pedidos_venta_repuesto WHERE id=?').get(req.params.id)
  if (!ped) return res.status(404).json({ error: 'No encontrado' })
  const yaRetirado = db.prepare('SELECT COUNT(*) AS c FROM pedido_venta_repuesto_items WHERE pedido_id=? AND cantidad_retirada>0').get(ped.id).c
  if (yaRetirado) return res.status(400).json({ error: 'Ya se retiró stock de este pedido, no se puede cancelar' })
  db.prepare(`UPDATE pedidos_venta_repuesto SET estado='Cancelado' WHERE id=?`).run(ped.id)
  res.json({ ok: true })
})

// ── Retirar de stock (total o parcial) — mismo mecanismo que Pedido de Stock ─
router.post('/:id/retirar', (req, res) => {
  if (!puedeStock(req)) return res.status(403).json({ error: 'Sin permisos' })
  const ped = db.prepare('SELECT * FROM pedidos_venta_repuesto WHERE id=?').get(req.params.id)
  if (!ped) return res.status(404).json({ error: 'No encontrado' })
  if (ped.estado === 'Cancelado') return res.status(400).json({ error: 'Este pedido está cancelado' })

  const { retiros } = req.body // { [item_id]: cantidadARetirarAhora }
  if (!retiros || typeof retiros !== 'object') return res.status(400).json({ error: 'Falta el detalle de retiro' })

  const items = db.prepare('SELECT * FROM pedido_venta_repuesto_items WHERE pedido_id=?').all(ped.id)
  const hoyStr = hoyArgentina()
  const detalleRetirado = []

  try {
    db.transaction(() => {
      let todosCompletos = true
      for (const item of items) {
        const pendiente = item.cantidad - item.cantidad_retirada
        // retiros[item.id] es un número simple (materiales sin partida) o
        // {cantidad, lote_id} cuando el producto requiere elegir de qué
        // partida sale.
        const retiroRaw = retiros[item.id]
        const esObjeto = retiroRaw != null && typeof retiroRaw === 'object'
        const aRetirar = parseFloat(esObjeto ? retiroRaw.cantidad : retiroRaw) || 0
        const loteIdItem = esObjeto ? retiroRaw.lote_id : null
        if (aRetirar <= 0) { if (pendiente > 0.0001) todosCompletos = false; continue }
        if (aRetirar > pendiente + 0.0001) throw new Error(`No se puede retirar más de lo pedido (pendiente: ${pendiente})`)

        const prod = db.prepare('SELECT * FROM productos WHERE id=?').get(item.producto_id)
        if (!prod) throw new Error('Producto no encontrado')

        let ef
        try {
          ef = aplicarMovimiento(prod, 'salida', aRetirar, { lote_id: loteIdItem })
        } catch (e) {
          throw new Error(`${prod.codigo} — ${prod.descripcion}: ${e.message}`)
        }

        db.prepare("UPDATE pedido_venta_repuesto_items SET cantidad_retirada=cantidad_retirada+? WHERE id=?").run(aRetirar, item.id)
        db.prepare(`INSERT INTO movimientos_stock (producto_id,tipo,cantidad,fecha,referencia,tipo_doc,doc_id,observaciones,created_by,autorizado_por_id,autorizado_por_nombre,lote_id,partida)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(item.producto_id, 'salida', aRetirar, hoyStr, `Venta repuesto #${ped.id}`, 'venta_repuesto', ped.id,
               `Venta a ${ped.cliente_nombre}`, req.usuario.id, ped.autorizado_por_id || null, ped.autorizado_por_nombre || '', ef.lote_id, ef.partida)
        detalleRetirado.push(`${prod.codigo} — ${prod.descripcion}: ${aRetirar} ${prod.unidad}`)

        if (aRetirar < pendiente - 0.0001) todosCompletos = false
      }
      db.prepare(`UPDATE pedidos_venta_repuesto SET estado=? WHERE id=?`).run(todosCompletos ? 'Retirado' : 'Parcial', ped.id)
    })()
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
  // Notificar recién con lo que realmente se retiró (puede ser parcial).
  if (ped.autorizado_por_id && detalleRetirado.length) {
    enviarMensajeSistema({
      de_id: req.usuario.id, de_nombre: req.usuario.nombre, para_id: ped.autorizado_por_id,
      asunto: `Retiro de stock autorizado — Venta de repuestos #${ped.id}`,
      cuerpo: `Se retiró para la venta de repuestos #${ped.id}:\n\n${detalleRetirado.join('\n')}\n\n`
        + `Cliente: ${ped.cliente_nombre}\nFecha: ${hoyStr}\nRetirado por: ${req.usuario.nombre}`,
    })
  }
  res.json({ ok: true })
})

// ── Marcar entregado (por ítem) ──────────────────────────────────────────────
router.post('/:id/items/:itemId/entregar', escribirVR, (req, res) => {
  const item = db.prepare('SELECT * FROM pedido_venta_repuesto_items WHERE id=? AND pedido_id=?').get(req.params.itemId, req.params.id)
  if (!item) return res.status(404).json({ error: 'Ítem no encontrado' })
  if (item.cantidad_retirada < item.cantidad - 0.0001) return res.status(400).json({ error: 'Todavía falta retirar stock de este ítem' })
  const hoyStr = hoyArgentina()
  db.transaction(() => {
    db.prepare(`UPDATE pedido_venta_repuesto_items SET entregado=1, fecha_entrega=? WHERE id=?`).run(hoyStr, item.id)
    const pendientes = db.prepare('SELECT COUNT(*) AS c FROM pedido_venta_repuesto_items WHERE pedido_id=? AND entregado=0').get(req.params.id).c
    if (pendientes === 0) db.prepare(`UPDATE pedidos_venta_repuesto SET estado='Entregado' WHERE id=?`).run(req.params.id)
  })()
  res.json({ ok: true })
})

// ── Vincular / desvincular factura real (por ítem) ───────────────────────────
router.post('/:id/items/:itemId/vincular-factura', escribirVR, (req, res) => {
  const item = db.prepare('SELECT * FROM pedido_venta_repuesto_items WHERE id=? AND pedido_id=?').get(req.params.itemId, req.params.id)
  if (!item) return res.status(404).json({ error: 'Ítem no encontrado' })
  const ped = db.prepare('SELECT * FROM pedidos_venta_repuesto WHERE id=?').get(req.params.id)
  const factura = db.prepare('SELECT * FROM facturas_venta WHERE id=? AND cliente_id=?').get(req.body.factura_venta_id, ped.cliente_id)
  if (!factura) return res.status(400).json({ error: 'La factura elegida no corresponde a este cliente' })
  db.prepare(`UPDATE pedido_venta_repuesto_items SET factura_venta_id=? WHERE id=?`).run(factura.id, item.id)
  res.json({ ok: true })
})

router.delete('/:id/items/:itemId/vincular-factura', escribirVR, (req, res) => {
  const item = db.prepare('SELECT * FROM pedido_venta_repuesto_items WHERE id=? AND pedido_id=?').get(req.params.itemId, req.params.id)
  if (!item) return res.status(404).json({ error: 'Ítem no encontrado' })
  db.prepare(`UPDATE pedido_venta_repuesto_items SET factura_venta_id=NULL WHERE id=?`).run(item.id)
  res.json({ ok: true })
})

module.exports = router
