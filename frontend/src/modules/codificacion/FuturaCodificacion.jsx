import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'
import { Asistente } from './AsistenteCore'

const ESTADOS = [
  { key: '',          label: 'Todos',     color: 'secondary' },
  { key: 'pendiente', label: 'Pendiente', color: 'warning'   },
  { key: 'asignado',  label: 'Asignado',  color: 'primary'   },
  { key: 'validado',  label: 'Validado',  color: 'success'   },
]

export default function FuturaCodificacion() {
  const [config,    setConfig]    = useState(null)
  const [stats,     setStats]     = useState({ total:0, pendiente:0, asignado:0, validado:0 })
  const [items,     setItems]     = useState([])
  const [loading,   setLoading]   = useState(true)
  const [filtroEst, setFiltroEst] = useState('')
  const [buscar,    setBuscar]    = useState('')
  const [modal,     setModal]     = useState(null)   // producto seleccionado
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')

  const cargarConfig = useCallback(async () => {
    const r = await api.get('/codificacion/config')
    setConfig(r.data)
  }, [])

  const cargarStats = useCallback(async () => {
    const r = await api.get('/codificacion-futura/stats')
    setStats(r.data)
  }, [])

  const cargarItems = useCallback(async () => {
    const params = {}
    if (filtroEst) params.estado = filtroEst
    if (buscar)    params.buscar = buscar
    setLoading(true)
    try {
      const r = await api.get('/codificacion-futura', { params })
      setItems(r.data)
    } finally {
      setLoading(false)
    }
  }, [filtroEst, buscar])

  useEffect(() => { cargarConfig() }, [cargarConfig])
  useEffect(() => { cargarStats(); cargarItems() }, [cargarStats, cargarItems])

  async function asignarCodigo(codigoFuturo) {
    if (!modal) return
    setSaving(true); setError('')
    try {
      await api.put(`/materiales/${modal.id}/codigo-futuro`, {
        codigo_futuro: codigoFuturo,
        codigo_futuro_estado: 'asignado',
      })
      setModal(null)
      cargarStats(); cargarItems()
    } catch(e) {
      setError(e.response?.data?.error || 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function validar(id) {
    try {
      await api.put(`/codificacion-futura/${id}/validar`)
      cargarStats(); cargarItems()
    } catch(e) { console.error(e) }
  }

  async function desasignar(id) {
    if (!confirm('¿Quitar el código futuro de este producto?')) return
    try {
      await api.put(`/codificacion-futura/${id}/desasignar`)
      cargarStats(); cargarItems()
    } catch(e) { console.error(e) }
  }

  const pct = stats.total > 0 ? Math.round((stats.validado / stats.total) * 100) : 0

  return (
    <div className="container-fluid py-3">
      <div className="d-flex align-items-center gap-2 mb-3">
        <i className="bi bi-arrow-left-right fs-4 text-primary"/>
        <h4 className="mb-0">Futura Codificación</h4>
        <span className="badge bg-info text-dark ms-1">Experimental</span>
      </div>

      {/* Stats */}
      <div className="row g-3 mb-4">
        {[
          { label: 'Total productos', value: stats.total,     color: 'secondary', icon: 'boxes'               },
          { label: 'Pendientes',      value: stats.pendiente, color: 'warning',   icon: 'hourglass-split'     },
          { label: 'Asignados',       value: stats.asignado,  color: 'primary',   icon: 'tag'                 },
          { label: 'Validados',       value: stats.validado,  color: 'success',   icon: 'check-circle-fill'   },
        ].map(s => (
          <div key={s.label} className="col-6 col-md-3">
            <div className={`card border-${s.color} h-100`}>
              <div className="card-body py-3">
                <div className="d-flex align-items-center gap-2">
                  <i className={`bi bi-${s.icon} text-${s.color} fs-4`}/>
                  <div>
                    <div className={`fw-bold fs-4 text-${s.color}`}>{s.value}</div>
                    <div className="text-muted small">{s.label}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Progreso */}
      <div className="mb-4">
        <div className="d-flex justify-content-between small text-muted mb-1">
          <span>Progreso de migración</span>
          <span>{stats.validado} / {stats.total} validados ({pct}%)</span>
        </div>
        <div className="progress" style={{height:10}}>
          <div
            className="progress-bar bg-success"
            style={{width:`${pct}%`}}
            role="progressbar"
          />
          {stats.asignado > 0 && (
            <div
              className="progress-bar bg-primary"
              style={{width:`${stats.total > 0 ? Math.round(stats.asignado/stats.total*100) : 0}%`}}
              role="progressbar"
            />
          )}
        </div>
        <div className="small text-muted mt-1">
          <span className="me-3"><span className="badge bg-success me-1">&nbsp;</span>Validado</span>
          <span className="me-3"><span className="badge bg-primary me-1">&nbsp;</span>Asignado (pendiente validar)</span>
          <span><span className="badge bg-warning text-dark me-1">&nbsp;</span>Sin asignar</span>
        </div>
      </div>

      {/* Filtros */}
      <div className="d-flex flex-wrap gap-2 mb-3 align-items-center">
        <div className="btn-group btn-group-sm">
          {ESTADOS.map(e => (
            <button
              key={e.key}
              className={`btn btn-outline-${e.color} ${filtroEst === e.key ? 'active' : ''}`}
              onClick={() => setFiltroEst(e.key)}
            >
              {e.label}
            </button>
          ))}
        </div>
        <input
          className="form-control form-control-sm"
          style={{maxWidth:260}}
          placeholder="Buscar código, descripción..."
          value={buscar}
          onChange={e => setBuscar(e.target.value)}
        />
      </div>

      {/* Tabla */}
      {loading ? (
        <div className="text-center py-5 text-muted">
          <div className="spinner-border spinner-border-sm me-2"/>Cargando...
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-5 text-muted">
          <i className="bi bi-inbox fs-2 d-block mb-2"/>
          Sin resultados
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table table-sm table-hover align-middle mb-0">
            <thead className="table-light">
              <tr>
                <th style={{width:120}}>Código actual</th>
                <th>Descripción</th>
                <th style={{width:90}}>Categoría</th>
                <th style={{width:130}}>Código futuro</th>
                <th style={{width:90}}>Estado</th>
                <th style={{width:110}}></th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id}>
                  <td>
                    <code className="fw-semibold text-dark" style={{letterSpacing:1, fontSize:'0.8rem'}}>
                      {item.codigo}
                    </code>
                  </td>
                  <td>
                    <div className="text-truncate" style={{maxWidth:300}} title={item.descripcion}>
                      {item.descripcion}
                    </div>
                  </td>
                  <td><span className="text-muted small">{item.categoria || '—'}</span></td>
                  <td>
                    {item.codigo_futuro ? (
                      <code className="fw-semibold" style={{letterSpacing:1, fontSize:'0.8rem'}}>
                        {item.codigo_futuro}
                      </code>
                    ) : (
                      <span className="text-muted small">—</span>
                    )}
                  </td>
                  <td>
                    <EstadoBadge estado={item.codigo_futuro_estado} tieneCodigo={!!item.codigo_futuro} />
                  </td>
                  <td>
                    <div className="d-flex gap-1 justify-content-end">
                      <button
                        className="btn btn-xs btn-outline-primary py-0 px-2"
                        style={{fontSize:'0.72rem'}}
                        title="Asignar / cambiar código futuro"
                        onClick={() => setModal(item)}
                      >
                        <i className="bi bi-tag me-1"/>Asignar
                      </button>
                      {item.codigo_futuro && item.codigo_futuro_estado !== 'validado' && (
                        <button
                          className="btn btn-xs btn-outline-success py-0 px-2"
                          style={{fontSize:'0.72rem'}}
                          title="Marcar como validado"
                          onClick={() => validar(item.id)}
                        >
                          <i className="bi bi-check"/>
                        </button>
                      )}
                      {item.codigo_futuro && (
                        <button
                          className="btn btn-xs btn-outline-danger py-0 px-2"
                          style={{fontSize:'0.72rem'}}
                          title="Quitar código futuro"
                          onClick={() => desasignar(item.id)}
                        >
                          <i className="bi bi-x"/>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-muted small px-1 pt-2">{items.length} producto{items.length !== 1 ? 's' : ''}</div>
        </div>
      )}

      {/* Modal asistente */}
      {modal && config && (
        <ModalAsistente
          producto={modal}
          config={config}
          saving={saving}
          error={error}
          onAsignar={asignarCodigo}
          onCerrar={() => { setModal(null); setError('') }}
        />
      )}
    </div>
  )
}

function EstadoBadge({ estado, tieneCodigo }) {
  if (!tieneCodigo || estado === 'pendiente') return <span className="badge bg-warning text-dark" style={{fontSize:'0.7rem'}}>Pendiente</span>
  if (estado === 'validado')  return <span className="badge bg-success" style={{fontSize:'0.7rem'}}>Validado</span>
  return <span className="badge bg-primary" style={{fontSize:'0.7rem'}}>Asignado</span>
}

function ModalAsistente({ producto, config, saving, error, onAsignar, onCerrar }) {
  return (
    <div className="modal d-block" tabIndex="-1" style={{background:'rgba(0,0,0,0.5)'}}>
      <div className="modal-dialog modal-lg modal-dialog-scrollable">
        <div className="modal-content">
          <div className="modal-header py-2">
            <div>
              <h6 className="modal-title mb-0">Asignar código futuro</h6>
              <div className="small text-muted text-truncate" style={{maxWidth:420}}>
                <code className="me-2">{producto.codigo}</code>{producto.descripcion}
              </div>
            </div>
            <button type="button" className="btn-close" onClick={onCerrar}/>
          </div>
          <div className="modal-body p-3">
            {error && <div className="alert alert-danger py-2 small mb-3">{error}</div>}
            <div className="alert alert-info py-2 small mb-3">
              <i className="bi bi-info-circle me-1"/>
              Usá el asistente para generar el nuevo código. Cuando estés conforme, hacé clic en <strong>Usar este código</strong>.
            </div>
            <Asistente
              config={config}
              onUsar={codigo => onAsignar(codigo)}
            />
            {saving && (
              <div className="text-center mt-2 text-muted small">
                <span className="spinner-border spinner-border-sm me-1"/>Guardando...
              </div>
            )}
          </div>
          <div className="modal-footer py-2">
            <button className="btn btn-sm btn-secondary" onClick={onCerrar}>Cancelar</button>
          </div>
        </div>
      </div>
    </div>
  )
}
