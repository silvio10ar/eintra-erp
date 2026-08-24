import { Link } from 'react-router-dom'
import { getUser, puedeLeer } from '../store/authStore'

// Evita que alguien entre a un módulo escribiendo la URL directamente cuando no
// tiene permiso — antes solo se ocultaba el link del menú, pero la ruta seguía
// siendo accesible (se veía la pantalla vacía, sin datos, en vez de bloquearse).
export default function RutaConPermiso({ modulo, children }) {
  const esAdmin = getUser()?.rol === 'admin'
  const tieneAcceso = !modulo || esAdmin || (modulo !== '__admin__' && puedeLeer(modulo))

  if (!tieneAcceso) {
    return (
      <div className="d-flex flex-column align-items-center justify-content-center text-center"
        style={{ minHeight: '60vh' }}>
        <i className="bi bi-shield-lock text-danger" style={{ fontSize: '3rem' }} />
        <h4 className="mt-3">Acceso denegado</h4>
        <p className="text-muted">No tenés permiso para ver este módulo.</p>
        <Link to="/dashboard" className="btn btn-primary btn-sm">
          <i className="bi bi-house-door me-1" />Volver al inicio
        </Link>
      </div>
    )
  }

  return children
}
