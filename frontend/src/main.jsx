import React from 'react'
import ReactDOM from 'react-dom/client'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap-icons/font/bootstrap-icons.css'

// El JS de Bootstrap (dropdowns, modales, tooltips vía Popper) no lo usa
// /login — se carga en paralelo sin bloquear el primer render, en vez de ir
// atado al bundle inicial que baja cualquiera que solo entra a loguearse.
import('bootstrap/dist/js/bootstrap.bundle.min.js')
import App from './App'
import './index.css'
import { setAuthImpersonated } from './store/authStore'

// Impersonación: ?_imp=KEY → leer token+user de localStorage, guardar en sessionStorage
;(function () {
  const p = new URLSearchParams(window.location.search)
  const key = p.get('_imp')
  if (key) {
    try {
      const data = JSON.parse(localStorage.getItem(key) || 'null')
      if (data?.token && data?.usuario) {
        setAuthImpersonated(data.token, data.usuario)
      }
    } catch {}
    localStorage.removeItem(key)
    window.history.replaceState({}, '', window.location.pathname)
  }
})()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
