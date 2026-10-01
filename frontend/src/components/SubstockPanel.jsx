import { useState, useEffect, useCallback, useMemo } from 'react'
import api from '../api/client'
import EmpleadoSelect from './EmpleadoSelect'
import DateInput from './DateInput'

const hoy  = () => new Date().toISOString().slice(0, 10)
const fmtF = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—'
const fmt  = n => (parseFloat(n) || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })

const FORM_ENTREGA0 = { lote_id: '', cantidad: '', cliente_interno: '', proyecto: '', observaciones: '', fecha: hoy(), autorizado_por_id: '' }
const FORM_DEVOL0   = { lote_id: '', cantidad: '', observaciones: '', fecha: hoy() }

// Pantalla de "mi substock" — usada igual por Calidad y Producción, solo
// cambia el parámetro `substock`. Muestra lo que ese substock recibió del
// Stock principal (con saldo pendiente de entregar) y permite entregarlo a
// una persona con un proyecto asignado — es la contraparte del traspaso que
// se inicia desde la pantalla de Stock.
export default function SubstockPanel({ substock, canWrite }) {
  const [saldo, setSaldo]           = useState([])
  const [buscar, setBuscar]         = useState('')
  const [loadSaldo, setLoadSaldo]   = useState(false)
  const [historial, setHistorial]   = useState([])
  const [filtroProyecto, setFiltroProyecto] = useState('')
  const [proyectos, setProyectos]   = useState([])
  const [actividades, setActividades] = useState([])
  const [autorizantes, setAutorizantes] = useState([])
  const [modalEntrega, setModalEntrega] = useState(null) // fila del saldo elegida
  const [formE, setFormE]           = useState(FORM_ENTREGA0)
  const [savE, setSavE]             = useState(false)
  const [errE, setErrE]             = useState('')
  const [modalDevol, setModalDevol] = useState(null) // fila del saldo elegida
  const [formD, setFormD]           = useState(FORM_DEVOL0)
  const [savD, setSavD]             = useState(false)
  const [errD, setErrD]             = useState('')
  const [editUbicId, setEditUbicId] = useState(null) // producto_id en edición, o null
  const [editUbicVal, setEditUbicVal] = useState('')
  const [savUbic, setSavUbic]       = useState(false)

  // Búsqueda del lado del cliente (la lista de saldo de un substock es
  // chica) — mismo criterio que buscarCondicion() del backend: cada palabra
  // tiene que aparecer en ALGUNA columna, no todas en la misma.
  const saldoFiltrado = useMemo(() => {
    const palabras = buscar.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!palabras.length) return saldo
    return saldo.filter(s => {
      const campos = [s.codigo, s.descripcion, s.ubicacion, s.partida].map(v => (v || '').toLowerCase())
      return palabras.every(p => campos.some(c => c.includes(p)))
    })
  }, [saldo, buscar])

  const cargarSaldo = useCallback(() => {
    setLoadSaldo(true)
    api.get(`/substock/${substock}/saldo`).then(r => setSaldo(r.data)).catch(() => {}).finally(() => setLoadSaldo(false))
  }, [substock])

  const cargarHistorial = useCallback(() => {
    api.get(`/substock/${substock}/movimientos`).then(r => setHistorial(r.data)).catch(() => {})
  }, [substock])

  // Proyectos/actividades que efectivamente aparecen en el historial cargado
  // (no la lista completa de proyectos activos) — así el filtro solo ofrece
  // valores que realmente tienen algo para mostrar, incluyendo los de un
  // proyecto ya cerrado que en su momento sí tuvo entregas acá.
  const proyectosEnHistorial = useMemo(() => (
    [...new Set(historial.map(m => m.proyecto || '').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'))
  ), [historial])

  const historialFiltrado = useMemo(() => (
    filtroProyecto ? historial.filter(m => m.proyecto === filtroProyecto) : historial
  ), [historial, filtroProyecto])

  useEffect(() => {
    cargarSaldo()
    cargarHistorial()
    api.get('/rrhh/proyectos').then(r => setProyectos(r.data.filter(p => p.estado === 'Activo'))).catch(() => {})
    api.get('/rrhh/actividades').then(r => setActividades(r.data.filter(a => a.activo))).catch(() => {})
    api.get('/stock/autorizantes').then(r => setAutorizantes(r.data)).catch(() => {})
  }, [cargarSaldo, cargarHistorial])

  const abrirEntrega = fila => {
    // Un número de serie es siempre 1 unidad — no tiene sentido pedirle al
    // usuario que lo tipee si ya sabemos que es exactamente eso.
    const cantidadInicial = fila.trazabilidad_stock === 'serie' ? String(fila.cantidad_actual) : ''
    setFormE({ ...FORM_ENTREGA0, lote_id: fila.lote_id, cantidad: cantidadInicial, fecha: hoy() })
    setModalEntrega(fila)
    setErrE('')
  }

  const guardarEntrega = async e => {
    e.preventDefault()
    if (!formE.cantidad || parseFloat(formE.cantidad) <= 0) { setErrE('Cantidad inválida'); return }
    if (!formE.cliente_interno.trim()) { setErrE('Elegí quién recibe este material'); return }
    if (!formE.autorizado_por_id) { setErrE('Elegí quién autoriza esta entrega'); return }
    setSavE(true); setErrE('')
    try {
      await api.post(`/substock/${substock}/entregas`, formE)
      setModalEntrega(null)
      cargarSaldo(); cargarHistorial()
    } catch (err) {
      setErrE(err.response?.data?.error || 'Error al guardar')
    } finally { setSavE(false) }
  }

  const abrirDevolucion = fila => {
    const cantidadInicial = fila.trazabilidad_stock === 'serie' ? String(fila.cantidad_actual) : ''
    setFormD({ ...FORM_DEVOL0, lote_id: fila.lote_id, cantidad: cantidadInicial, fecha: hoy() })
    setModalDevol(fila)
    setErrD('')
  }

  const guardarDevolucion = async e => {
    e.preventDefault()
    if (!formD.cantidad || parseFloat(formD.cantidad) <= 0) { setErrD('Cantidad inválida'); return }
    setSavD(true); setErrD('')
    try {
      await api.post(`/substock/${substock}/devoluciones`, formD)
      setModalDevol(null)
      cargarSaldo(); cargarHistorial()
    } catch (err) {
      setErrD(err.response?.data?.error || 'Error al guardar')
    } finally { setSavD(false) }
  }

  const abrirEditarUbicacion = fila => {
    setEditUbicId(fila.producto_id)
    setEditUbicVal(fila.ubicacion || '')
  }

  const guardarUbicacion = async productoId => {
    setSavUbic(true)
    try {
      await api.patch(`/substock/${substock}/productos/${productoId}/ubicacion`, { ubicacion: editUbicVal })
      setSaldo(prev => prev.map(s => s.producto_id === productoId ? { ...s, ubicacion: editUbicVal.trim() } : s))
      setEditUbicId(null)
    } catch (err) {
      alert(err.response?.data?.error || 'Error al guardar la ubicación')
    } finally { setSavUbic(false) }
  }

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h6 className="fw-bold mb-0"><i className="bi bi-box-seam me-2" />Saldo pendiente de entregar</h6>
        <div className="d-flex align-items-center gap-2">
          {saldo.length > 0 && (
            <div className="input-group input-group-sm" style={{ width: 220 }}>
              <span className="input-group-text bg-white"><i className="bi bi-search" /></span>
              <input className="form-control" placeholder="Buscar..." value={buscar} onChange={e => setBuscar(e.target.value)} />
              {buscar && (
                <button className="btn btn-outline-secondary" type="button" onClick={() => setBuscar('')}>
                  <i className="bi bi-x" />
                </button>
              )}
            </div>
          )}
          <button className="btn btn-sm btn-outline-secondary" onClick={() => { cargarSaldo(); cargarHistorial() }}>
            <i className="bi bi-arrow-clockwise" />
          </button>
        </div>
      </div>

      {loadSaldo ? (
        <div className="text-center py-4 text-muted"><span className="spinner-border spinner-border-sm me-2" />Cargando...</div>
      ) : saldo.length === 0 ? (
        <div className="text-center py-4 text-muted">
          <i className="bi bi-inbox display-6 d-block mb-2" />
          Todavía no recibiste material de Stock.
        </div>
      ) : saldoFiltrado.length === 0 ? (
        <div className="text-center py-4 text-muted">
          <i className="bi bi-search display-6 d-block mb-2" />
          Sin resultados para "{buscar}".
        </div>
      ) : (
        <div className="table-responsive mb-4">
          <table className="table table-sm table-hover align-middle">
            <thead className="table-light">
              <tr>
                <th>Código</th><th>Descripción</th><th>Ubicación</th><th>Partida/Serie</th>
                <th className="text-end">Disponible</th>
                {canWrite && <th />}
              </tr>
            </thead>
            <tbody>
              {saldoFiltrado.map(s => (
                <tr key={s.id}>
                  <td className="fw-semibold">{s.codigo}</td>
                  <td>{s.descripcion}</td>
                  <td
                    onClick={canWrite && editUbicId !== s.producto_id ? () => abrirEditarUbicacion(s) : undefined}
                    style={canWrite ? { cursor: 'pointer' } : undefined}
                    title={canWrite ? 'Click para editar la ubicación' : undefined}>
                    {editUbicId === s.producto_id ? (
                      <div className="d-flex align-items-center gap-1" onClick={e => e.stopPropagation()}>
                        <input autoFocus className="form-control form-control-sm" style={{ width: 130 }}
                          value={editUbicVal} onChange={e => setEditUbicVal(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') guardarUbicacion(s.producto_id)
                            if (e.key === 'Escape') setEditUbicId(null)
                          }}
                          disabled={savUbic} />
                        <button type="button" className="btn btn-sm btn-outline-success py-0 px-1"
                          disabled={savUbic} onClick={() => guardarUbicacion(s.producto_id)}>
                          <i className="bi bi-check-lg" />
                        </button>
                        <button type="button" className="btn btn-sm btn-outline-secondary py-0 px-1"
                          disabled={savUbic} onClick={() => setEditUbicId(null)}>
                          <i className="bi bi-x" />
                        </button>
                      </div>
                    ) : (
                      <>
                        {s.ubicacion || <span className="text-muted">—</span>}
                        {canWrite && <i className="bi bi-pencil ms-2 text-muted" style={{ fontSize: '0.7rem' }} />}
                      </>
                    )}
                  </td>
                  <td>{s.partida ? <span className="badge bg-light text-dark border">{s.partida}</span> : <span className="text-muted">—</span>}</td>
                  <td className="text-end">{fmt(s.cantidad_actual)} {s.unidad}</td>
                  {canWrite && (
                    <td className="text-end">
                      <div className="d-flex gap-1 justify-content-end">
                        <button className="btn btn-sm btn-outline-success" onClick={() => abrirEntrega(s)}>
                          <i className="bi bi-box-arrow-right me-1" />Entregar
                        </button>
                        <button className="btn btn-sm btn-outline-secondary" title="Devolver a Stock principal" onClick={() => abrirDevolucion(s)}>
                          <i className="bi bi-arrow-return-left me-1" />Devolver
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="d-flex align-items-center justify-content-between mb-2 flex-wrap gap-2">
        <div className="fw-semibold text-muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          <i className="bi bi-clock-history me-1" />Historial
        </div>
        {proyectosEnHistorial.length > 0 && (
          <select className="form-select form-select-sm" style={{ width: 220, fontSize: '0.78rem' }}
            value={filtroProyecto} onChange={e => setFiltroProyecto(e.target.value)}>
            <option value="">Todos los proyectos/actividades</option>
            {proyectosEnHistorial.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
      </div>
      {historial.length === 0 ? (
        <div className="text-muted small">Sin movimientos todavía.</div>
      ) : historialFiltrado.length === 0 ? (
        <div className="text-muted small">Sin movimientos para "{filtroProyecto}".</div>
      ) : (
        <div className="table-responsive">
          <table className="table table-sm align-middle" style={{ fontSize: '0.82rem' }}>
            <thead className="table-light">
              <tr>
                <th>Fecha</th><th>Movimiento</th><th>Código</th><th>Descripción</th>
                <th className="text-end">Cantidad</th><th>Detalle</th>
              </tr>
            </thead>
            <tbody>
              {historialFiltrado.map(m => (
                <tr key={m.id}>
                  <td>{fmtF(m.fecha)}</td>
                  <td>
                    {m.substock_destino ? (
                      <span className="badge bg-info-subtle text-info-emphasis">Recibido de Stock</span>
                    ) : m.tipo === 'devolucion' ? (
                      <span className="badge bg-secondary-subtle text-secondary-emphasis">Devuelto a Stock</span>
                    ) : (
                      <span className="badge bg-success-subtle text-success-emphasis">Entregado</span>
                    )}
                  </td>
                  <td>{m.codigo}</td>
                  <td>{m.descripcion}</td>
                  <td className="text-end">{fmt(m.cantidad)} {m.unidad}</td>
                  <td className="text-muted">
                    {m.tipo === 'devolucion'
                      ? (m.partida ? `(${m.partida})` : '—')
                      : m.substock_origen
                        ? `${m.cliente_interno || '—'}${m.proyecto ? ' · ' + m.proyecto : ''}${m.partida ? ` (${m.partida})` : ''}`
                        : (m.partida || '—')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalEntrega && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.4)' }}>
          <div className="modal-dialog">
            <form className="modal-content" onSubmit={guardarEntrega}>
              <div className="modal-header">
                <h5 className="modal-title">
                  Entregar {modalEntrega.codigo} — {modalEntrega.descripcion}
                  {modalEntrega.partida && (
                    <span className="badge bg-light text-dark border ms-2" style={{ fontSize: '0.7rem', verticalAlign: 'middle' }}>
                      {modalEntrega.partida}
                    </span>
                  )}
                </h5>
                <button type="button" className="btn-close" onClick={() => setModalEntrega(null)} />
              </div>
              <div className="modal-body">
                {errE && <div className="alert alert-danger py-2 small">{errE}</div>}
                <div className="row g-3">
                  <div className="col-md-6">
                    <label className="form-label small fw-medium">
                      Cantidad * <span className="text-muted">(disponible: {fmt(modalEntrega.cantidad_actual)})</span>
                    </label>
                    <input type="number" className="form-control" min="0.001" max={modalEntrega.cantidad_actual} step="any"
                      value={formE.cantidad} onChange={e => setFormE(p => ({ ...p, cantidad: e.target.value }))} required
                      disabled={modalEntrega.trazabilidad_stock === 'serie'} />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small fw-medium">Fecha *</label>
                    <DateInput className="form-control" value={formE.fecha} onChange={v => setFormE(p => ({ ...p, fecha: v }))} />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small fw-medium">Entregado a *</label>
                    <EmpleadoSelect value={formE.cliente_interno} onChange={v => setFormE(p => ({ ...p, cliente_interno: v }))} placeholder="— Elegir —" />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small fw-medium">Proyecto o Actividad</label>
                    <select className="form-select" value={formE.proyecto} onChange={e => setFormE(p => ({ ...p, proyecto: e.target.value }))}>
                      <option value="">— Sin asignar —</option>
                      {proyectos.length > 0 && (
                        <optgroup label="Proyectos">
                          {proyectos.map(p => <option key={`p-${p.id}`} value={p.codigo}>{p.codigo} — {p.nombre}</option>)}
                        </optgroup>
                      )}
                      {actividades.length > 0 && (
                        <optgroup label="Actividades">
                          {actividades.map(a => <option key={`a-${a.id}`} value={a.nombre}>{a.nombre}</option>)}
                        </optgroup>
                      )}
                    </select>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small fw-medium">Autorizado por *</label>
                    <select className="form-select" value={formE.autorizado_por_id}
                      onChange={e => setFormE(p => ({ ...p, autorizado_por_id: e.target.value }))}>
                      <option value="">— Elegir —</option>
                      {autorizantes.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                    </select>
                    <div className="form-text">Le llega una notificación con lo entregado</div>
                  </div>
                  <div className="col-12">
                    <label className="form-label small fw-medium">Observaciones</label>
                    <input className="form-control" value={formE.observaciones} onChange={e => setFormE(p => ({ ...p, observaciones: e.target.value }))} />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setModalEntrega(null)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={savE || !formE.cliente_interno || !formE.autorizado_por_id}>
                  {savE && <span className="spinner-border spinner-border-sm me-2" />}Entregar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalDevol && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.4)' }}>
          <div className="modal-dialog">
            <form className="modal-content" onSubmit={guardarDevolucion}>
              <div className="modal-header">
                <h5 className="modal-title">
                  Devolver {modalDevol.codigo} — {modalDevol.descripcion}
                  {modalDevol.partida && (
                    <span className="badge bg-light text-dark border ms-2" style={{ fontSize: '0.7rem', verticalAlign: 'middle' }}>
                      {modalDevol.partida}
                    </span>
                  )}
                </h5>
                <button type="button" className="btn-close" onClick={() => setModalDevol(null)} />
              </div>
              <div className="modal-body">
                {errD && <div className="alert alert-danger py-2 small">{errD}</div>}
                <div className="text-muted small mb-3">Vuelve al Stock principal, a la misma partida/serie de la que salió.</div>
                <div className="row g-3">
                  <div className="col-md-6">
                    <label className="form-label small fw-medium">
                      Cantidad * <span className="text-muted">(disponible: {fmt(modalDevol.cantidad_actual)})</span>
                    </label>
                    <input type="number" className="form-control" min="0.001" max={modalDevol.cantidad_actual} step="any"
                      value={formD.cantidad} onChange={e => setFormD(p => ({ ...p, cantidad: e.target.value }))} required
                      disabled={modalDevol.trazabilidad_stock === 'serie'} />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small fw-medium">Fecha *</label>
                    <DateInput className="form-control" value={formD.fecha} onChange={v => setFormD(p => ({ ...p, fecha: v }))} />
                  </div>
                  <div className="col-12">
                    <label className="form-label small fw-medium">Observaciones</label>
                    <input className="form-control" value={formD.observaciones} onChange={e => setFormD(p => ({ ...p, observaciones: e.target.value }))} />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setModalDevol(null)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={savD}>
                  {savD && <span className="spinner-border spinner-border-sm me-2" />}Devolver
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
