import { useState, useEffect } from 'react'
import api from '../api/client'

// Gerencias reales del organigrama (la raíz/CEO + sus "Gerente de X" directos)
// — ver GET /auth/gerencias-modulos en el backend. Reemplaza listas fijas en
// el código (ej. "Área responsable" de una tarea de Proyectos): si el
// organigrama cambia, las opciones disponibles cambian solas.
const PALETA = ['#6c757d', '#795548', '#dc3545', '#0d6efd', '#198754', '#6f42c1', '#20c997', '#fd7e14', '#d63384', '#0dcaf0']
const COLOR_SIN_AREA = '#adb5bd'

export function useGerencias() {
  const [gerencias, setGerencias] = useState([])

  useEffect(() => {
    api.get('/auth/gerencias-modulos')
      .then(r => setGerencias(r.data.gerencias || []))
      .catch(e => console.error(e))
  }, [])

  const colorDe = nombre => {
    const i = gerencias.indexOf(nombre)
    return i >= 0 ? PALETA[i % PALETA.length] : COLOR_SIN_AREA
  }

  return { gerencias, colorDe, colorSinArea: COLOR_SIN_AREA }
}
