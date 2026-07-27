import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'
import { puedeEscribir } from '../../store/authStore'
import DateInput from '../../components/DateInput'
import EmpleadoSelect from '../../components/EmpleadoSelect'
import { fmtHorasDecimal } from '../../utils/horas'

const ESTADOS     = ['Pendiente', 'En proceso', 'Pausada', 'Completada', 'Cancelada']
const PRIORIDADES = ['Normal', 'Alta', 'Urgente']

const badgeEstado     = e => ({ Pendiente: 'secondary', 'En proceso': 'primary', Pausada: 'warning', Completada: 'success', Cancelada: 'danger' }[e] || 'secondary')
const badgePrioridad  = p => ({ Normal: 'secondary', Alta: 'warning', Urgente: 'danger' }[p] || 'secondary')
const hoy = () => new Date().toISOString().slice(0, 10)
const fmtF = f => f ? f.slice(0, 10).split('-').reverse().join('/') : '—'

const FORM_VACIO = {
  descripcion: '', proyecto_id: '', responsable: '',
  fecha_apertura: hoy(), fecha_inicio: '', fecha_fin_est: '',
  estado: 'Pendiente', prioridad: 'Normal', observaciones: '',
}
const PARTE_VACIA = { fecha: hoy(), operario: '', horas: '', descripcion: '', observaciones: '' }

export default function Produccion() {
  const canWrite = puedeEscribir('produccion')
  const limit = 50

  const [ots, setOts]         = useState([])
  const [total, setTotal]     = useState(0)
  const [page, setPage]       = useState(1)
  const [loading, setLoading] = useState(true)
  const [proyectos, setProyectos] = useState([])

  const [fEstado, setFEstado]       = useState('')
  const [fPrioridad, setFPrioridad] = useState('')
  const [fProyecto, setFProyecto]   = useState('')
  const [buscar, setBuscar]         = useState('')

  const [modalNueva, setModalNueva] = useState(false)
  const [formNueva, setFormNueva]   = useState(FORM_VACIO)
  const [savingNueva, setSavingNueva] = useState(false)
  const [errNueva, setErrNueva]     = useState('')

  const [detalle, setDetalle]       = useState(null)
  const [loadingDet, setLoadingDet] = useState(false)
  const [editando, setEditando]     = useState(false)
  const [formEdit, setFormEdit]     = useState({})
  const [savingEdit, setSavingEdit] = useState(false)

  const [nuevaTarea, setNuevaTarea] = useState({ descripcion: '', responsable: '' })
  const [modalParte, setModalParte] = useState(null) // null | 'nueva' | parte-obj
  const [formParte, setFormParte]   = useState(PARTE_VACIA)
  const [savingParte, setSavingParte] = useState(false)

  const cargar = useCallback(() => {
    setLoading(true)
    const params = { page, limit }
    if (fEstado)    params.estado = fEstado
    if (fPrioridad) params.prioridad = fPrioridad
    if (fProyecto)  params.proyecto_id = fProyecto
    if (buscar)     params.buscar = buscar
    api.get('/produccion', { params })
      .then(r => { setOts(r.data.datos); setTotal(r.data.total) })
      .finally(() => setLoading(false))
  }, [page, fEstado, fPrioridad, fProyecto, buscar])

  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { api.get('/proyectos').then(r => setProyectos(r.data)).catch(() => {}) }, [])

  const totalPags = Math.max(1, Math.ceil(total / limit))

  const crearOT = async e => {
    e.preventDefault()
    setSavingNueva(true); setErrNueva('')
    try {
      const proy = proyectos.find(p => String(p.id) === String(formNueva.proyecto_id))
      await api.post('/produccion', { ...formNueva, proyecto_id: formNueva.proyecto_id || null, proyecto_nombre: proy?.nombre || '' })
      setModalNueva(false); setFormNueva(FORM_VACIO); cargar()
    } catch (err) {
      setErrNueva(err.response?.data?.error ?? 'Error al crear la OT')
    } finally { setSavingNueva(false) }
  }

  const abrirDetalle = async ot => {
    setDetalle(null); setEditando(false); setLoadingDet(true)
    try {
      const r = await api.get(`/produccion/${ot.id}`)
      setDetalle(r.data)
    } finally { setLoadingDet(false) }
  }

  const empezarEdicion = () => { setFormEdit({ ...detalle }); setEditando(true) }

  const guardarEdicion = async () => {
    setSavingEdit(true)
    try {
      const proy = proyectos.find(p => String(p.id) === String(formEdit.proyecto_id))
      const r = await api.put(`/produccion/${detalle.id}`, { ...formEdit, proyecto_nombre: proy?.nombre ?? formEdit.proyecto_nombre })
      setDetalle(d => ({ ...d, ...r.data }))
      setEditando(false)
      cargar()
    } catch { alert('Error al guardar los cambios') }
    finally { setSavingEdit(false) }
  }

  const eliminarOT = async ot => {
    if (!window.confirm(`¿Eliminar la OT ${ot.numero}? También se borran sus tareas y partes diarios.`)) return
    try { await api.delete(`/produccion/${ot.id}`); cargar() }
    catch { alert('Error al eliminar') }
  }

  // ── Tareas ─────────────────────────────────────────────────────────────────
  const agregarTarea = async () => {
    if (!nuevaTarea.descripcion.trim()) return
    try {
      const r = await api.post(`/produccion/${detalle.id}/tareas`, nuevaTarea)
      setDetalle(d => ({ ...d, tareas: [...d.tareas, r.data] }))
      setNuevaTarea({ descripcion: '', responsable: '' })
    } catch (err) { alert(err.response?.data?.error ?? 'Error al agregar la tarea') }
  }
  const toggleTarea = async t => {
    try {
      const r = await api.put(`/produccion/${detalle.id}/tareas/${t.id}/toggle`)
      setDetalle(d => ({ ...d, tareas: d.tareas.map(x => x.id === t.id ? r.data : x) }))
    } catch { alert('Error al actualizar la tarea') }
  }
  const eliminarTarea = async t => {
    try {
      await api.delete(`/produccion/${detalle.id}/tareas/${t.id}`)
      setDetalle(d => ({ ...d, tareas: d.tareas.filter(x => x.id !== t.id) }))
    } catch { alert('Error al eliminar la tarea') }
  }

  // ── Partes diarios ───────────────────────────────────────────────────────────
  const abrirModalParte = (parte = null) => { setFormParte(parte ? { ...parte } : PARTE_VACIA); setModalParte(parte || 'nueva') }

  const sumarHoras = partes => partes.reduce((s, p) => s + (parseFloat(p.horas) || 0), 0)

  const guardarParte = async () => {
    setSavingParte(true)
    try {
      let partes
      if (modalParte !== 'nueva') {
        const r = await api.put(`/produccion/${detalle.id}/partes/${modalParte.id}`, formParte)
        partes = detalle.partes.map(p => p.id === modalParte.id ? r.data : p)
      } else {
        const r = await api.post(`/produccion/${detalle.id}/partes`, formParte)
        partes = [r.data, ...detalle.partes]
      }
      setDetalle(d => ({ ...d, partes, total_horas: sumarHoras(partes) }))
      setModalParte(null)
    } catch (err) {
      alert(err.response?.data?.error ?? 'Error al guardar el parte')
    } finally { setSavingParte(false) }
  }

  const eliminarParte = async p => {
    if (!window.confirm('¿Eliminar este parte diario?')) return
    try {
      await api.delete(`/produccion/${detalle.id}/partes/${p.id}`)
      const partes = detalle.partes.filter(x => x.id !== p.id)
      setDetalle(d => ({ ...d, partes, total_horas: sumarHoras(partes) }))
    } catch { alert('Error al eliminar') }
  }

  if (loading && ots.length === 0) return (
    <div className="d-flex align-items-center justify-content-center" style={{ minHeight: '50vh' }}>
      <div className="spinner-border text-secondary" />
    </div>
  )

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h5 className="mb-0 fw-bold">Producción</h5>
          <small className="text-muted">Órdenes de trabajo</small>
        </div>
        {canWrite && (
          <button className="btn btn-primary btn-sm" onClick={() => { setFormNueva(FORM_VACIO); setErrNueva(''); setModalNueva(true) }}>
            <i className="bi bi-plus-lg me-2" />Nueva OT
          </button>
        )}
      </div>

      <div className="d-flex flex-wrap gap-2 mb-3">
        <select className="form-select form-select-sm" style={{ width: 160 }} value={fEstado} onChange={e => { setFEstado(e.target.value); setPage(1) }}>
          <option value="">Todos los estados</option>
          {ESTADOS.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        <select className="form-select form-select-sm" style={{ width: 140 }} value={fPrioridad} onChange={e => { setFPrioridad(e.target.value); setPage(1) }}>
          <option value="">Toda prioridad</option>
          {PRIORIDADES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className="form-select form-select-sm" style={{ width: 200 }} value={fProyecto} onChange={e => { setFProyecto(e.target.value); setPage(1) }}>
          <option value="">Todos los proyectos</option>
          {proyectos.map(p => <option key={p.id} value={p.id}>{p.codigo} — {p.nombre}</option>)}
        </select>
        <input className="form-control form-control-sm" style={{ width: 220 }} placeholder="Buscar por número o descripción…"
          value={buscar} onChange={e => { setBuscar(e.target.value); setPage(1) }} />
      </div>

      <div className="card border-0 shadow-sm">
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light">
              <tr>
                <th>N°</th><th>Descripción</th><th>Proyecto</th><th>Responsable</th>
                <th>Estado</th><th>Prioridad</th><th>Tareas</th><th>Horas</th><th>Vence</th>
                <th className="text-end">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {ots.length === 0 ? (
                <tr><td colSpan={10} className="text-center text-muted py-4">Sin órdenes de trabajo</td></tr>
              ) : ots.map(ot => (
                <tr key={ot.id} style={{ cursor: 'pointer' }} onClick={() => abrirDetalle(ot)}>
                  <td className="fw-semibold">{ot.numero}</td>
                  <td>{ot.descripcion}</td>
                  <td className="text-muted small">{ot.proyecto_nombre || '—'}</td>
                  <td className="text-muted small">{ot.responsable || '—'}</td>
                  <td><span className={`badge bg-${badgeEstado(ot.estado)}`}>{ot.estado}</span></td>
                  <td><span className={`badge bg-${badgePrioridad(ot.prioridad)}`}>{ot.prioridad}</span></td>
                  <td className="text-muted small">{ot.tareas_ok || 0} / {ot.total_tareas || 0}</td>
                  <td className="text-muted small">{fmtHorasDecimal(ot.total_horas)}</td>
                  <td className="text-muted small">{fmtF(ot.fecha_fin_est)}</td>
                  <td className="text-end" onClick={e => e.stopPropagation()}>
                    {canWrite && (
                      <button className="btn btn-sm btn-outline-danger" title="Eliminar" onClick={() => eliminarOT(ot)}>
                        <i className="bi bi-trash" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {totalPags > 1 && (
          <div className="d-flex justify-content-center gap-2 py-2 border-top">
            <button className="btn btn-sm btn-outline-secondary" disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
            <span className="text-muted small align-self-center">{page} / {totalPags}</span>
            <button className="btn btn-sm btn-outline-secondary" disabled={page >= totalPags} onClick={() => setPage(p => p + 1)}>›</button>
          </div>
        )}
      </div>

      {/* ── Modal: Nueva OT ─────────────────────────────────────────────── */}
      {modalNueva && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.4)' }}>
          <div className="modal-dialog modal-lg">
            <form className="modal-content" onSubmit={crearOT}>
              <div className="modal-header">
                <h5 className="modal-title">Nueva orden de trabajo</h5>
                <button type="button" className="btn-close" onClick={() => setModalNueva(false)} />
              </div>
              <div className="modal-body">
                {errNueva && <div className="alert alert-danger py-2 small">{errNueva}</div>}
                <div className="row g-3">
                  <div className="col-12">
                    <label className="form-label small fw-medium">Descripción *</label>
                    <input className="form-control" required value={formNueva.descripcion}
                      onChange={e => setFormNueva(p => ({ ...p, descripcion: e.target.value }))} />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small fw-medium">Proyecto</label>
                    <select className="form-select" value={formNueva.proyecto_id}
                      onChange={e => setFormNueva(p => ({ ...p, proyecto_id: e.target.value }))}>
                      <option value="">— Sin proyecto —</option>
                      {proyectos.map(p => <option key={p.id} value={p.id}>{p.codigo} — {p.nombre}</option>)}
                    </select>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small fw-medium">Responsable</label>
                    <EmpleadoSelect value={formNueva.responsable} onChange={v => setFormNueva(p => ({ ...p, responsable: v }))} />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label small fw-medium">Fecha de apertura</label>
                    <DateInput className="form-control" value={formNueva.fecha_apertura} onChange={v => setFormNueva(p => ({ ...p, fecha_apertura: v }))} />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label small fw-medium">Fecha de inicio</label>
                    <DateInput className="form-control" value={formNueva.fecha_inicio} onChange={v => setFormNueva(p => ({ ...p, fecha_inicio: v }))} />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label small fw-medium">Fin estimado</label>
                    <DateInput className="form-control" value={formNueva.fecha_fin_est} onChange={v => setFormNueva(p => ({ ...p, fecha_fin_est: v }))} />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small fw-medium">Prioridad</label>
                    <select className="form-select" value={formNueva.prioridad}
                      onChange={e => setFormNueva(p => ({ ...p, prioridad: e.target.value }))}>
                      {PRIORIDADES.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small fw-medium">Estado</label>
                    <select className="form-select" value={formNueva.estado}
                      onChange={e => setFormNueva(p => ({ ...p, estado: e.target.value }))}>
                      {ESTADOS.map(e => <option key={e} value={e}>{e}</option>)}
                    </select>
                  </div>
                  <div className="col-12">
                    <label className="form-label small fw-medium">Observaciones</label>
                    <textarea className="form-control" rows={2} value={formNueva.observaciones}
                      onChange={e => setFormNueva(p => ({ ...p, observaciones: e.target.value }))} />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setModalNueva(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={savingNueva}>
                  {savingNueva && <span className="spinner-border spinner-border-sm me-2" />}Crear
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Detalle de OT ────────────────────────────────────────── */}
      {(loadingDet || detalle) && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.4)' }}>
          <div className="modal-dialog modal-xl">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  {detalle ? <>OT <strong>{detalle.numero}</strong></> : 'Cargando…'}
                </h5>
                <button type="button" className="btn-close" onClick={() => { setDetalle(null); setEditando(false) }} />
              </div>
              <div className="modal-body">
                {loadingDet || !detalle ? (
                  <div className="text-center py-5"><div className="spinner-border text-secondary" /></div>
                ) : (
                  <>
                    {!editando ? (
                      <div className="row g-2 mb-3">
                        <div className="col-12 d-flex justify-content-between align-items-start">
                          <div>
                            <div className="fw-semibold">{detalle.descripcion}</div>
                            <div className="text-muted small">
                              {detalle.proyecto_nombre || 'Sin proyecto'} · Responsable: {detalle.responsable || '—'}
                            </div>
                          </div>
                          {canWrite && (
                            <button className="btn btn-sm btn-outline-secondary" onClick={empezarEdicion}>
                              <i className="bi bi-pencil me-1" />Editar
                            </button>
                          )}
                        </div>
                        <div className="col-auto"><span className={`badge bg-${badgeEstado(detalle.estado)}`}>{detalle.estado}</span></div>
                        <div className="col-auto"><span className={`badge bg-${badgePrioridad(detalle.prioridad)}`}>{detalle.prioridad}</span></div>
                        <div className="col-auto text-muted small align-self-center">Apertura: {fmtF(detalle.fecha_apertura)}</div>
                        <div className="col-auto text-muted small align-self-center">Inicio: {fmtF(detalle.fecha_inicio)}</div>
                        <div className="col-auto text-muted small align-self-center">Fin est.: {fmtF(detalle.fecha_fin_est)}</div>
                        {detalle.fecha_cierre && <div className="col-auto text-muted small align-self-center">Cierre: {fmtF(detalle.fecha_cierre)}</div>}
                        {detalle.observaciones && <div className="col-12 text-muted small">{detalle.observaciones}</div>}
                      </div>
                    ) : (
                      <div className="row g-2 mb-3 border rounded p-2">
                        <div className="col-12">
                          <label className="form-label small fw-medium">Descripción</label>
                          <input className="form-control form-control-sm" value={formEdit.descripcion || ''}
                            onChange={e => setFormEdit(p => ({ ...p, descripcion: e.target.value }))} />
                        </div>
                        <div className="col-md-6">
                          <label className="form-label small fw-medium">Proyecto</label>
                          <select className="form-select form-select-sm" value={formEdit.proyecto_id || ''}
                            onChange={e => setFormEdit(p => ({ ...p, proyecto_id: e.target.value }))}>
                            <option value="">— Sin proyecto —</option>
                            {proyectos.map(p => <option key={p.id} value={p.id}>{p.codigo} — {p.nombre}</option>)}
                          </select>
                        </div>
                        <div className="col-md-6">
                          <label className="form-label small fw-medium">Responsable</label>
                          <EmpleadoSelect size="sm" value={formEdit.responsable} onChange={v => setFormEdit(p => ({ ...p, responsable: v }))} />
                        </div>
                        <div className="col-md-3">
                          <label className="form-label small fw-medium">Apertura</label>
                          <DateInput value={formEdit.fecha_apertura} onChange={v => setFormEdit(p => ({ ...p, fecha_apertura: v }))} />
                        </div>
                        <div className="col-md-3">
                          <label className="form-label small fw-medium">Inicio</label>
                          <DateInput value={formEdit.fecha_inicio} onChange={v => setFormEdit(p => ({ ...p, fecha_inicio: v }))} />
                        </div>
                        <div className="col-md-3">
                          <label className="form-label small fw-medium">Fin estimado</label>
                          <DateInput value={formEdit.fecha_fin_est} onChange={v => setFormEdit(p => ({ ...p, fecha_fin_est: v }))} />
                        </div>
                        <div className="col-md-3">
                          <label className="form-label small fw-medium">Cierre</label>
                          <DateInput value={formEdit.fecha_cierre} onChange={v => setFormEdit(p => ({ ...p, fecha_cierre: v }))} />
                        </div>
                        <div className="col-md-6">
                          <label className="form-label small fw-medium">Estado</label>
                          <select className="form-select form-select-sm" value={formEdit.estado || 'Pendiente'}
                            onChange={e => setFormEdit(p => ({ ...p, estado: e.target.value }))}>
                            {ESTADOS.map(e => <option key={e} value={e}>{e}</option>)}
                          </select>
                        </div>
                        <div className="col-md-6">
                          <label className="form-label small fw-medium">Prioridad</label>
                          <select className="form-select form-select-sm" value={formEdit.prioridad || 'Normal'}
                            onChange={e => setFormEdit(p => ({ ...p, prioridad: e.target.value }))}>
                            {PRIORIDADES.map(p => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </div>
                        <div className="col-12">
                          <label className="form-label small fw-medium">Observaciones</label>
                          <textarea className="form-control form-control-sm" rows={2} value={formEdit.observaciones || ''}
                            onChange={e => setFormEdit(p => ({ ...p, observaciones: e.target.value }))} />
                        </div>
                        <div className="col-12 d-flex gap-2 justify-content-end">
                          <button className="btn btn-secondary btn-sm" onClick={() => setEditando(false)}>Cancelar</button>
                          <button className="btn btn-primary btn-sm" disabled={savingEdit} onClick={guardarEdicion}>
                            {savingEdit && <span className="spinner-border spinner-border-sm me-2" />}Guardar
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="row g-3">
                      {/* Tareas */}
                      <div className="col-md-5">
                        <h6 className="fw-bold small text-uppercase text-muted">Tareas</h6>
                        {canWrite && (
                          <div className="d-flex gap-2 mb-2">
                            <input className="form-control form-control-sm" placeholder="Nueva tarea…"
                              value={nuevaTarea.descripcion} onChange={e => setNuevaTarea(p => ({ ...p, descripcion: e.target.value }))}
                              onKeyDown={e => e.key === 'Enter' && agregarTarea()} />
                            <button className="btn btn-sm btn-outline-primary" onClick={agregarTarea}><i className="bi bi-plus-lg" /></button>
                          </div>
                        )}
                        {detalle.tareas.length === 0 ? (
                          <p className="text-muted small">Sin tareas cargadas.</p>
                        ) : (
                          <ul className="list-group list-group-flush">
                            {detalle.tareas.map(t => (
                              <li key={t.id} className="list-group-item px-0 d-flex align-items-start gap-2">
                                <input type="checkbox" className="form-check-input mt-1" checked={t.estado === 'Completada'}
                                  disabled={!canWrite} onChange={() => toggleTarea(t)} />
                                <div className="flex-grow-1">
                                  <div className={t.estado === 'Completada' ? 'text-decoration-line-through text-muted' : ''}>{t.descripcion}</div>
                                  {t.responsable && <div className="text-muted" style={{ fontSize: '0.75rem' }}>{t.responsable}</div>}
                                </div>
                                {canWrite && (
                                  <button className="btn btn-sm btn-outline-danger py-0 px-1" onClick={() => eliminarTarea(t)}>
                                    <i className="bi bi-x" style={{ fontSize: '0.8rem' }} />
                                  </button>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      {/* Partes diarios */}
                      <div className="col-md-7">
                        <div className="d-flex justify-content-between align-items-center">
                          <h6 className="fw-bold small text-uppercase text-muted mb-0">
                            Partes diarios <span className="text-muted fw-normal">({fmtHorasDecimal(detalle.total_horas)} totales)</span>
                          </h6>
                          {canWrite && (
                            <button className="btn btn-sm btn-outline-primary" onClick={() => abrirModalParte()}>
                              <i className="bi bi-plus-lg me-1" />Agregar
                            </button>
                          )}
                        </div>
                        {detalle.partes.length === 0 ? (
                          <p className="text-muted small mt-2">Sin partes cargados.</p>
                        ) : (
                          <div className="table-responsive mt-2" style={{ maxHeight: 260, overflowY: 'auto' }}>
                            <table className="table table-sm align-middle mb-0">
                              <thead className="table-light">
                                <tr><th>Fecha</th><th>Operario</th><th>Horas</th><th>Descripción</th><th /></tr>
                              </thead>
                              <tbody>
                                {detalle.partes.map(p => (
                                  <tr key={p.id}>
                                    <td className="text-muted small">{fmtF(p.fecha)}</td>
                                    <td className="small">{p.operario || '—'}</td>
                                    <td className="small">{fmtHorasDecimal(p.horas)}</td>
                                    <td className="small">{p.descripcion || '—'}</td>
                                    <td className="text-end">
                                      {canWrite && (
                                        <div className="d-flex gap-1 justify-content-end">
                                          <button className="btn btn-xs btn-outline-secondary py-0 px-1" onClick={() => abrirModalParte(p)}>
                                            <i className="bi bi-pencil" style={{ fontSize: '0.7rem' }} />
                                          </button>
                                          <button className="btn btn-xs btn-outline-danger py-0 px-1" onClick={() => eliminarParte(p)}>
                                            <i className="bi bi-trash" style={{ fontSize: '0.7rem' }} />
                                          </button>
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Agregar/editar parte diario ─────────────────────────── */}
      {modalParte && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.5)' }}>
          <div className="modal-dialog modal-sm">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">{modalParte === 'nueva' ? 'Nuevo parte diario' : 'Editar parte'}</h5>
                <button className="btn-close" onClick={() => setModalParte(null)} />
              </div>
              <div className="modal-body">
                <div className="row g-2">
                  <div className="col-6">
                    <label className="form-label small fw-medium">Fecha</label>
                    <DateInput value={formParte.fecha} onChange={v => setFormParte(p => ({ ...p, fecha: v }))} />
                  </div>
                  <div className="col-6">
                    <label className="form-label small fw-medium">Horas</label>
                    <input type="number" step="0.5" min="0" className="form-control form-control-sm" value={formParte.horas}
                      onChange={e => setFormParte(p => ({ ...p, horas: e.target.value }))} />
                  </div>
                  <div className="col-12">
                    <label className="form-label small fw-medium">Operario</label>
                    <EmpleadoSelect size="sm" value={formParte.operario} onChange={v => setFormParte(p => ({ ...p, operario: v }))} />
                  </div>
                  <div className="col-12">
                    <label className="form-label small fw-medium">Descripción</label>
                    <input className="form-control form-control-sm" value={formParte.descripcion}
                      onChange={e => setFormParte(p => ({ ...p, descripcion: e.target.value }))} />
                  </div>
                  <div className="col-12">
                    <label className="form-label small fw-medium">Observaciones</label>
                    <textarea className="form-control form-control-sm" rows={2} value={formParte.observaciones}
                      onChange={e => setFormParte(p => ({ ...p, observaciones: e.target.value }))} />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary btn-sm" onClick={() => setModalParte(null)}>Cancelar</button>
                <button className="btn btn-primary btn-sm" disabled={savingParte} onClick={guardarParte}>
                  {savingParte && <span className="spinner-border spinner-border-sm me-2" />}Guardar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
