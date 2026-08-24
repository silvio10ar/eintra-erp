import axios from 'axios'
import { getToken, clearAuth } from '../store/authStore'

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 15000,
})

api.interceptors.request.use(config => {
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      clearAuth()
      window.location.href = '/login'
    }
    if (err.response?.status === 403) {
      if (err.response?.data?.code === 'DEBE_CAMBIAR_PASSWORD' && window.location.pathname !== '/cambiar-password') {
        window.location.href = '/cambiar-password'
        return Promise.reject(err)
      }
      if (err.response?.data?.code === 'SESION_INVALIDADA') {
        clearAuth()
        window.location.href = '/login'
        return Promise.reject(err)
      }
      // No se corta el flujo (cada pantalla ya muestra su propio mensaje de "sin permisos"),
      // pero queda visible en consola para diagnosticar rápido un reclamo de acceso.
      console.warn(`[403] ${err.config?.method?.toUpperCase()} ${err.config?.url}`, err.response?.data)
    }
    return Promise.reject(err)
  }
)

export default api
