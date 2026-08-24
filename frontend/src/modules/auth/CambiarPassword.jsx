import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api/client'
import { setAuth, getUser, clearAuth } from '../../store/authStore'
import logo from '../../assets/logo.avif'

// Pantalla de cambio obligatorio — a diferencia del modal de Usuarios.jsx (solo
// para admins), esta es alcanzable por cualquier rol, y bloquea el resto del
// sistema hasta que se complete (ver ProtectedRoute.jsx y verificarToken en el
// backend, que rechaza cualquier otra ruta mientras debe_cambiar_password=true).
export default function CambiarPassword() {
  const navigate = useNavigate()
  const usuario = getUser()
  const [form, setForm]       = useState({ password: '', confirmar: '' })
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)

  const handleChange = e => setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))

  const handleSubmit = async e => {
    e.preventDefault()
    setError('')
    if (form.password.length < 6) return setError('La contraseña debe tener al menos 6 caracteres')
    if (form.password !== form.confirmar) return setError('Las contraseñas no coinciden')
    setLoading(true)
    try {
      const { data } = await api.put(`/auth/usuarios/${usuario.id}/password`, { password: form.password })
      setAuth(data.token, data.usuario)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err.response?.data?.error ?? 'Error al cambiar la contraseña')
    } finally {
      setLoading(false)
    }
  }

  const cerrarSesion = () => {
    clearAuth()
    navigate('/login', { replace: true })
  }

  return (
    <div className="login-page">
      <div className="login-card card shadow-lg p-4">
        <div className="text-center mb-4">
          <img src={logo} alt="E-INTRA" className="mb-2" style={{ height: 72 }} />
          <h4 className="fw-bold mb-0" style={{ color: '#1a3a5c', letterSpacing: '-0.3px', fontSize: '1.1rem' }}>
            Cambio de contraseña obligatorio
          </h4>
        </div>

        <div className="alert alert-warning py-2 small" role="alert">
          <i className="bi bi-shield-lock-fill me-2" />
          Un administrador pidió que elijas una contraseña nueva antes de seguir usando el sistema.
        </div>

        {error && (
          <div className="alert alert-danger py-2 small" role="alert">
            <i className="bi bi-exclamation-triangle-fill me-2" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate autoComplete="off">
          <div className="mb-3">
            <label className="form-label fw-medium small">Nueva contraseña</label>
            <div className="input-group">
              <span className="input-group-text">
                <i className="bi bi-lock" />
              </span>
              <input
                type="password"
                name="password"
                className="form-control"
                placeholder="••••••••"
                value={form.password}
                onChange={handleChange}
                required
                minLength={6}
                autoFocus
                autoComplete="new-password"
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="form-label fw-medium small">Repetir nueva contraseña</label>
            <div className="input-group">
              <span className="input-group-text">
                <i className="bi bi-lock" />
              </span>
              <input
                type="password"
                name="confirmar"
                className="form-control"
                placeholder="••••••••"
                value={form.confirmar}
                onChange={handleChange}
                required
                minLength={6}
                autoComplete="new-password"
              />
            </div>
          </div>

          <button type="submit" className="btn btn-primary w-100 fw-semibold mb-2" disabled={loading}>
            {loading
              ? <><span className="spinner-border spinner-border-sm me-2" />Guardando...</>
              : <><i className="bi bi-check-lg me-2" />Cambiar contraseña</>
            }
          </button>
          <button type="button" className="btn btn-link w-100 text-muted small" onClick={cerrarSesion}>
            Cerrar sesión
          </button>
        </form>
      </div>
    </div>
  )
}
