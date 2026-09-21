'use strict'

// "Hoy" en Argentina, calculado de forma explícita — a diferencia de
// new Date().toISOString() (siempre UTC, se adelanta un día desde las
// ~21:00 hora argentina) o de confiar en que el SO del servidor tenga bien
// configurada su zona horaria (de lo que depende "localtime" de SQLite).
// Formato YYYY-MM-DD.
function hoyArgentina() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
}

// Hora actual en Argentina, formato HH:MM — mismo criterio que hoyArgentina
// (zona horaria explícita, no depende de cómo esté configurado el SO del
// servidor), para comparar contra una hora de envío programada (ver
// scripts/enviar-dashboard-finanzas.js).
function horaArgentina() {
  return new Date().toLocaleTimeString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires', hour: '2-digit', minute: '2-digit' })
}

// N días antes de hoy en Argentina. La resta se hace en UTC puro (Date.UTC +
// setUTCDate) sobre los componentes Y-M-D ya resueltos en Argentina, así el
// resultado no depende de la zona horaria del proceso que corre este código.
function fechaArgentinaHace(dias) {
  const [y, m, d] = hoyArgentina().split('-').map(Number)
  const utc = new Date(Date.UTC(y, m - 1, d))
  utc.setUTCDate(utc.getUTCDate() - dias)
  return utc.toISOString().slice(0, 10)
}

// Primer día del mes en curso, en Argentina — para filtros "del mes" (mismo
// riesgo que hoyArgentina: con new Date().setDate(1) + toISOString() el mes
// también podía cambiar un día antes de tiempo cerca de medianoche).
function primerDiaMesArgentina() {
  const [y, m] = hoyArgentina().split('-')
  return `${y}-${m}-01`
}

// Expresión SQL que normaliza una columna de fecha a texto ISO YYYY-MM-DD
// comparable, para cuando la columna puede tener datos importados de
// planillas viejas en formato DD/MM/YYYY en vez de ISO (ver CLAUDE.md,
// "Datos confiables: solo a partir del 01/07/2026") — comparar como texto
// plano ("27/05/2025" >= "2026-07-01") da true por orden alfabético, así que
// sin esto una OC/factura vieja se cuela en los filtros por fecha de corte.
// Si el valor ya es ISO (o está vacío/NULL), queda igual.
function sqlFechaIso(col) {
  return `(CASE WHEN ${col} LIKE '__/__/____' THEN substr(${col},7,4)||'-'||substr(${col},4,2)||'-'||substr(${col},1,2) ELSE ${col} END)`
}

module.exports = { hoyArgentina, horaArgentina, fechaArgentinaHace, primerDiaMesArgentina, sqlFechaIso }
