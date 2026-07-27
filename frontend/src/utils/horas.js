// Formato decimal simple: "1.5h" — usado en Parte Diario / Mi Parte.
export function fmtHorasDecimal(h) {
  if (!h && h !== 0) return '—'
  return `${parseFloat((+h).toFixed(1))}h`
}

// Formato "Xh Ym", con signo opcional (+/-) — usado en el informe de análisis de horas.
export function fmtHorasMinutos(h, signo = false) {
  if (h === '' || h == null || Number.isNaN(+h)) return '—'
  const n = +h
  const neg = n < 0
  const abs = Math.abs(n)
  let hh = Math.floor(abs), mm = Math.round((abs - hh) * 60)
  if (mm === 60) { hh++; mm = 0 }
  const base = mm > 0 ? `${hh}h ${mm}m` : `${hh}h`
  return `${neg ? '-' : (signo ? '+' : '')}${base}`
}
