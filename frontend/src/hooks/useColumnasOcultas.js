import { useState, useEffect } from 'react'

// Recuerda qué columnas ocultó el usuario en una tabla puntual (por
// localStorage, por browser/dispositivo) — pensado para tablas anchas que en
// pantallas chicas obligan a scrollear para llegar a las últimas columnas.
export function useColumnasOcultas(storageKey) {
  const key = `cols_ocultas_${storageKey}`
  const [ocultas, setOcultas] = useState(() => {
    try { return JSON.parse(localStorage.getItem(key)) || [] }
    catch { return [] }
  })

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(ocultas)) } catch {}
  }, [key, ocultas])

  const toggle = colKey => setOcultas(p => p.includes(colKey) ? p.filter(k => k !== colKey) : [...p, colKey])
  const visible = colKey => !ocultas.includes(colKey)

  return { ocultas, toggle, visible }
}
