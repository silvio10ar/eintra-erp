import React from 'react'
import ReactDOM from 'react-dom/client'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap/dist/js/bootstrap.bundle.min.js'
import 'bootstrap-icons/font/bootstrap-icons.css'
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
