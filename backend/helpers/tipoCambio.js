'use strict';
const { db } = require('../db/database');
const { hoyArgentina } = require('./fecha');

// Tasa de cambio del sistema (tabla tipo_cambio) más reciente a una fecha dada
// — mismo criterio de "TC del día" que usan Control OC y Seguimiento OC
// Compras (fecha <= la del comprobante, no exactamente "hoy", por si todavía
// no se cargó la de hoy).
function tasaCambioSistema(moneda, fecha) {
  if (!moneda || moneda === 'PESO' || moneda === 'PESOS') return 0;
  const row = db.prepare(`
    SELECT valor FROM tipo_cambio
    WHERE moneda = ? AND fecha <= ? AND fecha != ''
    ORDER BY fecha DESC, id DESC LIMIT 1
  `).get(moneda, fecha || hoyArgentina());
  return row ? row.valor : 0;
}

module.exports = { tasaCambioSistema };
