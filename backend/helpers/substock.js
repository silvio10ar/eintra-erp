'use strict'
const { db } = require('../db/database')

// Saldo pendiente de entregar de un substock (Calidad/Producción), guardado
// por lote (no solo por producto) — así un producto con trazabilidad_stock
// 'serie' no pierde la identidad de qué unidad puntual quedó en cada substock.
// Un producto sin trazabilidad simplemente tiene un único lote genérico
// (partida=''), así que esto no le agrega ninguna complejidad de más.

// Acredita cantidad al substock para un lote dado — llamar dentro de la misma
// transacción que descontó ese lote del stock principal (POST /movimientos).
function sumarASubstock(producto_id, substock, lote_id, cantidad) {
  db.prepare(`
    INSERT INTO substock_saldo (producto_id, substock, lote_id, cantidad_actual, updated_at)
    VALUES (?, ?, ?, ?, datetime('now','localtime'))
    ON CONFLICT(substock, lote_id) DO UPDATE SET
      cantidad_actual = cantidad_actual + excluded.cantidad_actual,
      updated_at = datetime('now','localtime')
  `).run(producto_id, substock, lote_id, cantidad)
}

// Descuenta del saldo de un substock al entregarlo a una persona — nunca deja
// que se entregue más de lo que ese substock puntual tiene de ese lote.
function restarDeSubstock(substock, lote_id, cantidad) {
  const saldo = db.prepare('SELECT * FROM substock_saldo WHERE substock=? AND lote_id=?').get(substock, lote_id)
  if (!saldo) throw new Error('Ese substock no tiene saldo de esa partida/serie')
  if (saldo.cantidad_actual - cantidad < -0.0001)
    throw new Error(`Ese substock solo tiene ${saldo.cantidad_actual} disponibles`)
  db.prepare(`UPDATE substock_saldo SET cantidad_actual=cantidad_actual-?, updated_at=datetime('now','localtime') WHERE id=?`)
    .run(cantidad, saldo.id)
}

module.exports = { sumarASubstock, restarDeSubstock }
