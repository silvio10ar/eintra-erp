import { useState, useEffect } from 'react'
import api from '../api/client'

// Sin caché entre pantallas a propósito: una lista compartida por toda la app
// que solo se pide una vez por sesión queda desactualizada en cuanto alguien
// da de alta, edita o da de baja un empleado en RRHH. El endpoint es liviano
// (solo id + nombre), así que pedirlo de nuevo en cada pantalla no pesa.
export function useEmpleados() {
  const [empleados, setEmpleados] = useState([])

  useEffect(() => {
    api.get('/rrhh/empleados-basico')
      .then(r => {
        const lista = (Array.isArray(r.data) ? r.data : [])
          .filter(e => e.activo !== 0)
          .sort((a, b) => a.nombre.localeCompare(b.nombre))
        setEmpleados(lista)
      })
      .catch(e => console.error(e))
  }, [])

  return { empleados }
}
