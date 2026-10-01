import { Link } from 'react-router-dom'
import { getUser, puedeLeer, puedeEscribir } from '../store/authStore'

// Evita que alguien entre a un módulo escribiendo la URL directamente cuando no
// tiene permiso — antes solo se ocultaba el link del menú, pero la ruta seguía
// siendo accesible (se veía la pantalla vacía, sin datos, en vez de bloquearse).
export default function RutaConPermiso({ modulo, extraModuloEscribir, children }) {
  const esAdmin = getUser()?.rol === 'admin'
  // extraModuloEscribir habilita el acceso por permiso de ESCRITURA de otro
  // módulo — ej. Proyectos, donde alguien con el permiso liviano de Entrega
  // Documentación (sin proyectos.leer) también tiene que poder entrar, aunque
  // vea muchísimo menos que alguien con acceso completo. Se evalúa acá adentro
  // (no como prop ya resuelta) para que sea fresco en cada navegación —
  // RutaConPermiso vive dentro de <Routes>, así que solo se vuelve a
  // renderizar al entrar a esta ruta, a diferencia de App.jsx que renderiza
  // una sola vez.
  const tieneAcceso = !modulo || esAdmin || (modulo !== '__admin__' && puedeLeer(modulo))
    || (!!extraModuloEscribir && puedeEscribir(extraModuloEscribir))

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
