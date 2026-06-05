import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api/client'
import { setAuth, isAuthenticated } from '../../store/authStore'

export default function Login() {
  const navigate  = useNavigate()
  const [form, setForm]     = useState({ username: '', password: '' })
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (isAuthenticated()) navigate('/dashboard', { replace: true })
  }, [navigate])

  const handleChange = e =>
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))

  const handleSubmit = async e => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { data } = await api.post('/auth/login', form)
      setAuth(data.token, data.usuario)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      setError(err.response?.data?.error ?? 'Error de conexión con el servidor')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card card shadow-lg p-4">
        {/* Logo / título */}
        <div className="text-center mb-4">
          <div
            className="mx-auto mb-3 d-flex align-items-center justify-content-center rounded-3"
            style={{ width: 64, height: 64, background: '#1a2332' }}
          >
            <i className="bi bi-building text-white" style={{ fontSize: '1.8rem' }} />
          </div>
          <h4 className="fw-bold mb-0">E-INTRA ERP</h4>
          <p className="text-muted small mb-0">Sistema de gestión empresarial</p>
        </div>

        {error && (
          <div className="alert alert-danger py-2 small" role="alert">
            <i className="bi bi-exclamation-triangle-fill me-2" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <div className="mb-3">
            <label className="form-label fw-medium small">Usuario</label>
            <div className="input-group">
              <span className="input-group-text">
                <i className="bi bi-person" />
              </span>
              <input
                type="text"
                name="username"
                className="form-control"
                placeholder="admin"
                value={form.username}
                onChange={handleChange}
                required
                autoFocus
              />
            </div>
          </div>

          <div className="mb-4">
            <label className="form-label fw-medium small">Contraseña</label>
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
              />
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary w-100 fw-semibold"
            disabled={loading}
          >
            {loading
              ? <><span className="spinner-border spinner-border-sm me-2" />Ingresando...</>
              : <><i className="bi bi-box-arrow-in-right me-2" />Ingresar</>
            }
          </button>
        </form>
      </div>
    </div>
  )
}
