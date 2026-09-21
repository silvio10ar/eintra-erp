'use strict'
const { db } = require('../db/database')

function getConfig(clave, fallback = '') {
  try {
    const row = db.prepare('SELECT valor FROM configuracion WHERE clave=?').get(clave)
    if (row && row.valor) return row.valor
  } catch(e) {}
  return process.env[clave.toUpperCase()] || fallback
}

// Usado desde scripts standalone (ej. el cron del reporte diario de
// Finanzas) para guardar una marca propia sin pasar por la ruta HTTP de
// Configuración — mismo upsert que ya hace routes/configuracion.js.
function setConfig(clave, valor) {
  db.prepare(`
    INSERT INTO configuracion (clave, valor, updated_at) VALUES (?, ?, datetime('now','localtime'))
    ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor, updated_at=excluded.updated_at
  `).run(clave, valor)
}

module.exports = { getConfig, setConfig }
