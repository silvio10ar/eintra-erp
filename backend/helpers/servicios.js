'use strict'
const { db } = require('../db/database')
const { primerDiaMesArgentina } = require('./fecha')

// Meses que dura cada periodicidad, para saber cuándo "toca" la próxima cuota.
const MESES_POR_PERIODICIDAD = { mensual: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12 }

function mesesEntre(desdeAAAAMM, hastaAAAAMM) {
  const [ya, ma] = desdeAAAAMM.split('-').map(Number)
  const [yb, mb] = hastaAAAAMM.split('-').map(Number)
  return (yb * 12 + mb) - (ya * 12 + ma)
}

// Al empezar cada mes, los servicios recurrentes (luz, gas, internet...) traen
// un monto distinto al del mes anterior y hay que cargarlo a mano — sin un
// recordatorio quedaba librado a que alguien se acuerde de entrar a cargarlo.
// Genera una cuota "pendiente" con monto 0 para el día 01 del mes en curso,
// una por servicio activo, respetando la periodicidad de cada uno
// (bimestral/trimestral/semestral/anual no generan todos los meses, solo
// cuando corresponde según la última cuota cargada). Idempotente: si ya existe
// una cuota para ese servicio ese mes (cargada a mano o generada acá antes),
// no duplica — se puede llamar tantas veces como haga falta.
function generarCuotasDelMes() {
  const primerDia = primerDiaMesArgentina()
  const mesActual = primerDia.slice(0, 7)
  // Los servicios que son el espejo de una póliza (ver tabla polizas) nunca
  // generan acá una cuota en blanco — su pago de renovación se carga a mano
  // desde Pólizas, con la fecha real de vencimiento, no la del día en que
  // corrió esta generación automática.
  const servicios = db.prepare(`
    SELECT id, periodicidad FROM servicios
    WHERE activo=1 AND id NOT IN (SELECT servicio_id FROM polizas WHERE servicio_id IS NOT NULL)
  `).all()
  const yaEsteMes = db.prepare(`SELECT 1 FROM servicios_cuotas WHERE servicio_id=? AND substr(vencimiento,1,7)=?`)
  const ultimaCuota = db.prepare(`
    SELECT vencimiento, created_at FROM servicios_cuotas
    WHERE servicio_id=? ORDER BY vencimiento DESC, id DESC LIMIT 1
  `)
  const insertar = db.prepare(`INSERT INTO servicios_cuotas (servicio_id, monto, vencimiento, estado) VALUES (?, 0, ?, 'pendiente')`)
  let generadas = 0
  for (const s of servicios) {
    if (yaEsteMes.get(s.id, mesActual)) continue
    const intervalo = MESES_POR_PERIODICIDAD[s.periodicidad] || 1
    const ultima = ultimaCuota.get(s.id)
    if (ultima) {
      const anchor = (ultima.vencimiento || ultima.created_at || '').slice(0, 7)
      if (anchor && mesesEntre(anchor, mesActual) < intervalo) continue
    }
    insertar.run(s.id, primerDia)
    generadas++
  }
  return generadas
}

// Próxima fecha de renovación de una póliza: misma fecha del mes/día, N meses
// después, según su periodicidad — para no tener que recalcularla a mano
// cada vez que se carga el pago de una renovación.
function sumarMeses(fechaISO, meses) {
  const d = new Date(fechaISO + 'T00:00:00')
  d.setMonth(d.getMonth() + meses)
  return d.toISOString().slice(0, 10)
}

module.exports = { generarCuotasDelMes, MESES_POR_PERIODICIDAD, sumarMeses }
