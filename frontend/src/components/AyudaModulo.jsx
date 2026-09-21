import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { getUser } from '../store/authStore'
import { AYUDA_MODULOS } from './ayudaModulos'

// Botón de ayuda contextual del header — un solo lugar para mantener en vez
// de un botón por pantalla: muestra el texto de AYUDA_MODULOS según la ruta
// actual. Por ahora solo lo ve el rol admin, mientras se prueba el
// contenido antes de abrirlo a todos.
export default function AyudaModulo() {
  const [abierto, setAbierto] = useState(false)
  const location = useLocation()
  const user = getUser()
  if (user?.rol !== 'admin') return null

  const ruta = Object.keys(AYUDA_MODULOS).find(r => location.pathname === r || location.pathname.startsWith(r + '/'))
  const ayuda = ruta ? AYUDA_MODULOS[ruta] : null

  return (
    <>
      <button className="btn btn-sm btn-outline-secondary" title="Ayuda de esta pantalla (solo admin, en prueba)"
        onClick={() => setAbierto(true)}>
        <i className="bi bi-question-circle" />
      </button>
      {abierto && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.5)', zIndex: 1080 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h6 className="modal-title mb-0"><i className="bi bi-question-circle me-2" />{ayuda?.titulo || 'Ayuda'}</h6>
                <button className="btn-close" onClick={() => setAbierto(false)} />
              </div>
              <div className="modal-body">
                {ayuda
                  ? <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: '0.88rem' }}>{ayuda.texto}</div>
                  : <p className="text-muted mb-0">Todavía no hay ayuda cargada para esta pantalla.</p>}
              </div>
              <div className="modal-footer py-2">
                <button className="btn btn-sm btn-secondary" onClick={() => setAbierto(false)}>Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
