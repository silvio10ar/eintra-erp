// Un objeto Date formateado como YYYY-MM-DD usando sus componentes LOCALES
// (no UTC) — a diferencia de d.toISOString().slice(0,10), que siempre da la
// fecha en UTC y en Argentina (UTC-3) ya es "mañana" desde las ~21:00,
// rompiendo cualquier chequeo de "hoy"/"vencido" comparado contra fechas
// guardadas en el servidor (fecha local real).
export const fechaLocalStr = d =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// "Hoy" en fecha local. Formato YYYY-MM-DD.
export const hoyLocal = () => fechaLocalStr(new Date())

// N días antes de hoy, en fecha local. Formato YYYY-MM-DD.
export const fechaLocalHace = dias => {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return fechaLocalStr(d)
}
