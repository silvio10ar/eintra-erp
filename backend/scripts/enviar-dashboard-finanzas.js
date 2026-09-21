'use strict'
// Cron: corre cada 5 minutos (ver deploy.ps1) y decide si corresponde mandar
// el reporte diario del Dashboard de Finanzas — mismo patrón que
// backup-email.js, pero acá el "cuándo" es configurable desde Configuración
// del sistema (no una hora fija en el propio script), así que en vez de un
// único crontab a una hora fija, el script corre seguido y se fija si YA es
// la hora configurada y si TODAVÍA no se mandó hoy.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') })
const { getConfig, setConfig } = require('../helpers/config')
const { hoyArgentina, horaArgentina } = require('../helpers/fecha')
const { enviarReporteDashboardFinanzas } = require('../helpers/reporteDashboardFinanzas')

const aMinutos = hhmm => {
  const [h, m] = String(hhmm || '').split(':').map(Number)
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0)
}

async function main() {
  if (getConfig('dashboard_finanzas_activo') !== 'true') {
    console.log('[dashboard-finanzas] Envío diario desactivado, nada para hacer')
    return
  }

  const hoy = hoyArgentina()
  if (getConfig('dashboard_finanzas_ultimo_envio') === hoy) {
    console.log('[dashboard-finanzas] Ya se envió hoy, nada para hacer')
    return
  }

  const minConfigurado = aMinutos(getConfig('dashboard_finanzas_hora', '08:00'))
  const minAhora        = aMinutos(horaArgentina())
  // Ventana de 5 minutos: el cron corre cada 5' y no siempre cae justo en el
  // minuto exacto configurado.
  if (minAhora < minConfigurado || minAhora >= minConfigurado + 5) {
    return
  }

  const r = await enviarReporteDashboardFinanzas({ forzar: true })
  if (r.enviado) {
    setConfig('dashboard_finanzas_ultimo_envio', hoy)
    console.log(`[dashboard-finanzas] OK — ${r.mensaje}`)
  } else {
    console.error(`[dashboard-finanzas] No se pudo enviar: ${r.motivo}`)
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error(`[dashboard-finanzas] Error: ${err.message}`); process.exit(1) })
