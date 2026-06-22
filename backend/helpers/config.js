'use strict'
const { db } = require('../db/database')

function getConfig(clave, fallback = '') {
  try {
    const row = db.prepare('SELECT valor FROM configuracion WHERE clave=?').get(clave)
    if (row && row.valor) return row.valor
  } catch(e) {}
  return process.env[clave.toUpperCase()] || fallback
}

module.exports = { getConfig }
