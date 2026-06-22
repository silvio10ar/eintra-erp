import { useState, useEffect } from 'react'
import api from '../api/client'

let _cache = null

export function useEmpleados() {
  const [empleados, setEmpleados] = useState(_cache || [])

  useEffect(() => {
    if (_cache) return
    api.get('/rrhh/empleados')
      .then(r => {
        _cache = (Array.isArray(r.data) ? r.data : [])
          .filter(e => e.activo !== 0)
          .sort((a, b) => a.nombre.localeCompare(b.nombre))
        setEmpleados(_cache)
      })
      .catch(() => {})
  }, [])

  return { empleados }
}
