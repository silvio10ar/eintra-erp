'use strict'
// Cron: corre cada 5 minutos (ver deploy.ps1) y revisa si el CEO mandó el
// mail disparador ("Como está todo") sin contestar todavía — mismo patrón
// que enviar-dashboard-finanzas.js, pero acá no hay una hora fija: cada
// corrida simplemente chequea la bandeja de entrada.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') })
const { revisarYResponderCEO } = require('../helpers/respuestaCEO')

async function main() {
  const r = await revisarYResponderCEO()
  if (r.motivo) {
    console.log(`[respuesta-ceo] ${r.motivo}`)
    return
  }
  console.log(`[respuesta-ceo] Revisados: ${r.revisados} — Respondidos: ${r.respondidos}`)
  if (r.errores) console.error(`[respuesta-ceo] Errores: ${r.errores.join(' | ')}`)
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error(`[respuesta-ceo] Error: ${err.message}`); process.exit(1) })
