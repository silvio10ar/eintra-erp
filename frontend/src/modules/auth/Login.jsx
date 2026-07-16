import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api/client'
import { setAuth, isAuthenticated } from '../../store/authStore'
import logo from '../../assets/logo.avif'

const LAST_USER_KEY = 'erp_last_username'

export default function Login() {
  const navigate  = useNavigate()
  const lastUser  = localStorage.getItem(LAST_USER_KEY) || ''
  const [form, setForm]     = useState({ username: lastUser, password: '' })
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
      localStorage.setItem(LAST_USER_KEY, form.username)
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
          <img src={logo} alt="E-INTRA" className="mb-2" style={{ height: 72 }} />
          <h4 className="fw-bold mb-0" style={{ color: '#1a3a5c', letterSpacing: '-0.3px', fontSize: '1.1rem' }}>Sistema ERP</h4>
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
                autoFocus={!lastUser}
                autoComplete="username"
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
                autoFocus={!!lastUser}
                autoComplete="new-password"
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
