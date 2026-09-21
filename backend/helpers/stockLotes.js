'use strict'
const { db } = require('../db/database')

// Trazabilidad por partida/lote — productos.trazabilidad_stock puede ser:
//  'ninguna' — cae siempre en un único lote genérico por producto (partida=''),
//              así el modelo de datos es uniforme (todo stock pertenece a
//              algún lote) sin agregar fricción donde no hace falta.
//  'partida' — lote por lote, texto libre, acumula cantidad si se repite.
//  'serie'   — unidad única (ej. motores/bombas/sopladores): 1 unidad por
//              ingreso, nunca acumula una serie repetida en un alta nueva.

// Busca (o crea) el lote de un producto para una partida dada. Acumula en el
// mismo lote si ya existía (misma partida recibida en más de un ingreso) y lo
// "reabre" si se había agotado — nunca duplica filas para la misma partida
// (UNIQUE(producto_id, partida) en el esquema).
function resolverLote(producto_id, partida, { precio_costo, proveedor, referencia, remito, fecha } = {}) {
  const p = (partida || '').trim()
  const existente = db.prepare('SELECT * FROM stock_lotes WHERE producto_id=? AND partida=?').get(producto_id, p)
  if (existente) {
    db.prepare(`UPDATE stock_lotes SET activo=1 WHERE id=?`).run(existente.id)
    return existente.id
  }
  const r = db.prepare(`
    INSERT INTO stock_lotes (producto_id, partida, cantidad_actual, precio_costo, proveedor, referencia, remito, fecha_ingreso)
    VALUES (?, ?, 0, ?, ?, ?, ?, ?)
  `).run(producto_id, p, precio_costo || 0, proveedor || '', referencia || '', remito || '', fecha || '')
  return r.lastInsertRowid
}

function sumarALote(lote_id, cantidad) {
  db.prepare('UPDATE stock_lotes SET cantidad_actual=cantidad_actual+?, activo=1 WHERE id=?').run(cantidad, lote_id)
}

// Descuenta de un lote puntual — nunca del total del producto en general, así
// una salida no puede "inventar" stock de una partida que no lo tiene aunque
// el producto en conjunto tenga saldo de sobra en otro lote.
function descontarDeLote(lote_id, cantidad) {
  const lote = db.prepare('SELECT * FROM stock_lotes WHERE id=?').get(lote_id)
  if (!lote) throw new Error('Partida no encontrada')
  if (lote.cantidad_actual - cantidad < -0.0001)
    throw new Error(`Esa partida${lote.partida ? ` (${lote.partida})` : ''} solo tiene ${lote.cantidad_actual} disponibles`)
  db.prepare('UPDATE stock_lotes SET cantidad_actual=cantidad_actual-? WHERE id=?').run(cantidad, lote_id)
}

// Aplica el efecto de un movimiento NUEVO sobre productos.stock_actual y el
// lote correspondiente. Tira si no hay stock suficiente (total, o de la
// partida puntual elegida en una salida). Devuelve {lote_id, partida} para
// guardar en el movimiento.
function aplicarMovimiento(producto, tipo, cantidad, { lote_id, partida, precio_costo, proveedor, referencia, remito, fecha } = {}) {
  // El formulario manda la cantidad como string (viene de un <input>, y el
  // body no la sanitiza a número) — sin este cast, "1" !== 1 y el chequeo de
  // "una sola unidad" de abajo rechaza siempre, aunque la cantidad sea 1.
  cantidad = Number(cantidad)
  const esSalida = tipo === 'salida'
  const traza = producto.trazabilidad_stock || 'ninguna'
  if (esSalida && producto.stock_actual - cantidad < -0.0001)
    throw new Error(`Stock insuficiente. Disponible: ${producto.stock_actual}`)
  let loteIdFinal, partidaFinal
  if (esSalida) {
    if (traza !== 'ninguna') {
      if (!lote_id) throw new Error(traza === 'serie' ? 'Elegí de qué número de serie sale' : 'Elegí de qué partida sale')
      const lote = db.prepare('SELECT * FROM stock_lotes WHERE id=? AND producto_id=?').get(lote_id, producto.id)
      if (!lote) throw new Error(traza === 'serie' ? 'Número de serie no encontrado' : 'Partida no encontrada')
      descontarDeLote(lote.id, cantidad)
      loteIdFinal = lote.id; partidaFinal = lote.partida
    } else {
      loteIdFinal = resolverLote(producto.id, '', {})
      descontarDeLote(loteIdFinal, cantidad)
      partidaFinal = ''
    }
  } else {
    // entrada / devolucion / ajuste — todas suman al lote, mismo signo que ya
    // usa el resto del código para stock_actual.
    partidaFinal = traza !== 'ninguna' ? (partida || '').trim() : ''
    if (traza !== 'ninguna' && !partidaFinal)
      throw new Error(traza === 'serie' ? 'Este material requiere número de serie' : 'Este material requiere partida')
    if (traza === 'serie') {
      if (cantidad !== 1)
        throw new Error('Cada ingreso de un material con número de serie es una sola unidad')
      // Una entrada nueva no puede reusar una serie ya cargada (a diferencia
      // de una partida, que sí acumula) — devolución/ajuste sí pueden: es la
      // misma unidad física volviendo o corrigiéndose.
      if (tipo === 'entrada') {
        const existente = db.prepare('SELECT id FROM stock_lotes WHERE producto_id=? AND partida=?').get(producto.id, partidaFinal)
        if (existente) throw new Error('Ese número de serie ya está cargado')
      }
    }
    loteIdFinal = resolverLote(producto.id, partidaFinal, { precio_costo, proveedor, referencia, remito, fecha })
    sumarALote(loteIdFinal, cantidad)
  }
  const delta = esSalida ? -cantidad : cantidad
  db.prepare("UPDATE productos SET stock_actual=stock_actual+?, updated_at=datetime('now','localtime') WHERE id=?").run(delta, producto.id)
  return { lote_id: loteIdFinal, partida: partidaFinal }
}

// Reasigna una cantidad de un lote a una partida/serie real — para el stock
// que ya estaba cargado antes de activar la trazabilidad de este material
// (quedó en el lote genérico "sin partida") o para corregir un dato mal
// cargado. No cambia productos.stock_actual (no entró ni salió nada del
// depósito, solo se le pone nombre real a lo que ya estaba) ni genera un
// movimiento en el historial — por eso no pasa por aplicarMovimiento.
function reasignarLote(producto, lote_origen_id, cantidad, partidaNueva) {
  cantidad = Number(cantidad)
  const traza = producto.trazabilidad_stock || 'ninguna'
  if (traza === 'ninguna') throw new Error('Este material no tiene trazabilidad de stock')
  const origen = db.prepare('SELECT * FROM stock_lotes WHERE id=? AND producto_id=?').get(lote_origen_id, producto.id)
  if (!origen) throw new Error('Lote de origen no encontrado')
  const nueva = (partidaNueva || '').trim()
  if (!nueva) throw new Error(traza === 'serie' ? 'Falta el número de serie' : 'Falta la partida')
  if (nueva === origen.partida) throw new Error('Elegí una partida distinta a la actual')
  if (traza === 'serie') {
    if (cantidad !== 1) throw new Error('Una unidad con número de serie se asigna de a una')
    const existente = db.prepare('SELECT id FROM stock_lotes WHERE producto_id=? AND partida=?').get(producto.id, nueva)
    if (existente) throw new Error('Ese número de serie ya está cargado')
  }
  descontarDeLote(origen.id, cantidad)
  const loteId = resolverLote(producto.id, nueva, {
    precio_costo: origen.precio_costo, proveedor: origen.proveedor,
    referencia: origen.referencia, remito: origen.remito, fecha: origen.fecha_ingreso,
  })
  sumarALote(loteId, cantidad)
  return { lote_id: loteId, partida: nueva }
}

// Revierte el efecto de un movimiento ya guardado (editar/eliminar). Un
// movimiento de antes de que existiera esta funcionalidad no tiene lote_id —
// ahí solo se toca el total del producto, igual que antes.
function revertirMovimiento(mov) {
  const delta = (mov.tipo === 'salida') ? mov.cantidad : -mov.cantidad
  db.prepare("UPDATE productos SET stock_actual=stock_actual+?, updated_at=datetime('now','localtime') WHERE id=?").run(delta, mov.producto_id)
  if (mov.lote_id) {
    if (mov.tipo === 'salida') sumarALote(mov.lote_id, mov.cantidad)
    else db.prepare('UPDATE stock_lotes SET cantidad_actual=cantidad_actual-? WHERE id=?').run(mov.cantidad, mov.lote_id)
  }
}

module.exports = { resolverLote, sumarALote, descontarDeLote, aplicarMovimiento, revertirMovimiento, reasignarLote }
