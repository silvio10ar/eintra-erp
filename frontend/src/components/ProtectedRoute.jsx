import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { isAuthenticated, getUser } from '../store/authStore'

export default function ProtectedRoute() {
  const location = useLocation()
  if (!isAuthenticated()) return <Navigate to="/login" replace />
  // Contraseña marcada para cambiar (recién creada, reseteada, o un admin
  // pidió el cambio): no puede usar nada del sistema hasta cambiarla — el
  // backend ya bloquea el resto de la API, esto solo evita que se vea
  // cualquier otra pantalla mientras tanto.
  if (getUser()?.debe_cambiar_password && location.pathname !== '/cambiar-password') {
    return <Navigate to="/cambiar-password" replace />
  }
  return <Outlet />
}
