import { useState, useEffect, useCallback, Fragment } from 'react'
import api from '../../api/client'
import { manejarPegadoNumero } from '../../utils/numero'

const FUENTES = [
  { value: 'nc_cerradas_plazo',        label: 'No conformidades cerradas en plazo',  auto: true  },
  { value: 'ot_entregas_tiempo',       label: 'Órdenes de trabajo entregadas a tiempo', auto: true },
  { value: 'eval_proveedores_puntaje', label: 'Evaluación de proveedores (puntaje promedio)', auto: true },
  { value: 'inspecciones_aprobadas',   label: 'Inspecciones de calidad aprobadas',   auto: true  },
  { value: 'manual',                   label: 'Carga manual (sin fuente automática)', auto: false },
]
const PERIODICIDADES = [
  { value: 'mensual',    label: 'Mensual'    },
  { value: 'trimestral', label: 'Trimestral' },
  { value: 'anual',      label: 'Anual'      },
]
const fuenteLabel = f => FUENTES.find(x => x.value === f)?.label || f
const esAuto      = f => !!FUENTES.find(x => x.value === f)?.auto

const NUEVO_VACIO = {
  nombre: '', descripcion: '', fuente: 'manual', meta: '', unidad: '%',
  periodicidad: 'anual', responsable_puesto_id: '', responsable_nombre: '',
}
const MEDICION_VACIA = { periodo: '', valor: '', observaciones: '' }

export default function FormObjetivos({ canWrite }) {
  const [objetivos, setObjetivos] = useState([])
  const [loading, setLoading]     = useState(true)
  const [puestos, setPuestos]     = useState([])

  const [modal, setModal]     = useState(null) // null | 'nuevo' | objetivo
  const [form, setForm]       = useState(NUEVO_VACIO)
  const [saving, setSaving]   = useState(false)
  const [err, setErr]         = useState('')

  const [serieDe, setSerieDe]     = useState(null) // objetivo seleccionado para ver histórico
  const [serie, setSerie]         = useState([])
  const [loadingSerie, setLoadingSerie] = useState(false)

  const [modalMed, setModalMed]   = useState(null) // objetivo para cargar medición manual
  const [formMed, setFormMed]     = useState(MEDICION_VACIA)
  const [savingMed, setSavingMed] = useState(false)
  const [errMed, setErrMed]       = useState('')

  const cargar = useCallback(() => {
    setLoading(true)
    api.get('/calidad/objetivos').then(r => setObjetivos(r.data)).finally(() => setLoading(false))
  }, [])

  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { api.get('/calidad/objetivos/puestos').then(r => setPuestos(r.data)).catch(e => console.error(e)) }, [])

  const abrirNuevo = () => { setForm(NUEVO_VACIO); setErr(''); setModal('nuevo') }
  const abrirEditar = o => {
    setForm({
      nombre: o.nombre, descripcion: o.descripcion, fuente: o.fuente, meta: o.meta, unidad: o.unidad,
      periodicidad: o.periodicidad, responsable_puesto_id: o.responsable_puesto_id || '', responsable_nombre: o.responsable_nombre || '',
    })
    setErr(''); setModal(o)
  }

  const guardar = async e => {
    e.preventDefault()
    setSaving(true); setErr('')
    try {
      const body = { ...form, meta: +form.meta, responsable_puesto_id: form.responsable_puesto_id || null }
      if (modal === 'nuevo') await api.post('/calidad/objetivos', body)
      else await api.put(`/calidad/objetivos/${modal.id}`, body)
      setModal(null); cargar()
    } catch (e2) {
      setErr(e2.response?.data?.error || 'Error al guardar')
    } finally { setSaving(false) }
  }

  const eliminar = async o => {
    if (!confirm(`¿Eliminar el objetivo "${o.nombre}"? Si tiene mediciones cargadas, se cierra en vez de borrarse.`)) return
    await api.delete(`/calidad/objetivos/${o.id}`)
    cargar()
  }

  const verSerie = async o => {
    if (serieDe?.id === o.id) { setSerieDe(null); return }
    setSerieDe(o); setLoadingSerie(true)
    try {
      const r = await api.get(`/calidad/objetivos/${o.id}/serie`)
      setSerie(r.data)
    } finally { setLoadingSerie(false) }
  }

  const abrirMedicion = o => { setFormMed(MEDICION_VACIA); setErrMed(''); setModalMed(o) }
  const cargarMedicion = async e => {
    e.preventDefault()
    setSavingMed(true); setErrMed('')
    try {
      await api.post(`/calidad/objetivos/${modalMed.id}/medicion`, { ...formMed, valor: +formMed.valor })
      setModalMed(null); cargar()
      if (serieDe?.id === modalMed.id) verSerie(modalMed).then(() => verSerie(modalMed))
    } catch (e2) {
      setErrMed(e2.response?.data?.error || 'Error al guardar')
    } finally { setSavingMed(false) }
  }

  if (loading) return (
    <div className="d-flex justify-content-center py-5"><div className="spinner-border text-secondary" /></div>
  )

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <p className="text-muted small mb-0">
          Objetivos de calidad medibles, monitoreados por período (ISO 9001:2015, cláusula 6.2).
        </p>
        {canWrite && (
          <button className="btn btn-primary btn-sm" onClick={abrirNuevo}>
            <i className="bi bi-plus-lg me-1" />Nuevo objetivo
          </button>
        )}
      </div>

      {objetivos.length === 0 ? (
        <p className="text-muted text-center py-4">Sin objetivos de calidad cargados todavía.</p>
      ) : (
        <div className="card border-0 shadow-sm">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light">
              <tr>
                <th>Objetivo</th><th>Fuente</th><th>Período</th>
                <th style={{ width: 200 }}>Meta vs. actual</th><th>Responsable</th><th className="text-end">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {objetivos.map(o => {
                const cumple = o.valor_actual != null && o.valor_actual >= o.meta
                const pct = o.valor_actual != null ? Math.min(100, Math.round((o.valor_actual / o.meta) * 100)) : 0
                return (
                  <Fragment key={o.id}>
                  <tr>
                    <td>
                      <div className="fw-semibold">{o.nombre}</div>
                      {o.descripcion && <div className="text-muted small">{o.descripcion}</div>}
                    </td>
                    <td className="text-muted small">{fuenteLabel(o.fuente)}</td>
                    <td className="text-muted small">{o.periodo_actual}</td>
                    <td>
                      {o.valor_actual == null ? (
                        <span className="text-muted small fst-italic">Sin datos en el período</span>
                      ) : (
                        <>
                          <div className="d-flex justify-content-between small mb-1">
                            <span className={`fw-semibold ${cumple ? 'text-success' : 'text-danger'}`}>
                              {o.valor_actual}{o.unidad}
                            </span>
                            <span className="text-muted">meta {o.meta}{o.unidad}</span>
                          </div>
                          <div className="progress" style={{ height: 6 }}>
                            <div className={`progress-bar ${cumple ? 'bg-success' : 'bg-danger'}`} style={{ width: `${pct}%` }} />
                          </div>
                        </>
                      )}
                    </td>
                    <td className="text-muted small">{o.puesto_nombre || o.responsable_nombre || '—'}</td>
                    <td className="text-end">
                      <div className="d-flex gap-2 justify-content-end">
                        <button className="btn btn-sm btn-outline-secondary" onClick={() => verSerie(o)}>
                          <i className={`bi bi-chevron-${serieDe?.id === o.id ? 'up' : 'down'} me-1`} />Histórico
                        </button>
                        {canWrite && o.fuente === 'manual' && (
                          <button className="btn btn-sm btn-outline-primary" onClick={() => abrirMedicion(o)}>
                            <i className="bi bi-upload me-1" />Cargar valor
                          </button>
                        )}
                        {canWrite && (
                          <button className="btn btn-sm btn-outline-secondary" onClick={() => abrirEditar(o)}>
                            <i className="bi bi-pencil" />
                          </button>
                        )}
                        {canWrite && (
                          <button className="btn btn-sm btn-outline-danger" onClick={() => eliminar(o)}>
                            <i className="bi bi-trash" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {serieDe?.id === o.id && (
                    <tr key={`${o.id}-serie`}>
                      <td colSpan={6} className="bg-light p-0">
                        {loadingSerie ? (
                          <div className="text-center py-2"><span className="spinner-border spinner-border-sm" /></div>
                        ) : serie.length === 0 ? (
                          <div className="text-muted small text-center py-2">Sin histórico disponible.</div>
                        ) : (
                          <table className="table table-sm mb-0">
                            <tbody>
                              {serie.map((s, i) => (
                                <tr key={i}>
                                  <td style={{ width: 120 }}>{s.periodo}</td>
                                  <td>{s.valor == null ? <span className="text-muted fst-italic">sin datos</span> : `${s.valor}${o.unidad}`}</td>
                                  {s.observaciones !== undefined && <td className="text-muted small">{s.observaciones || '—'}</td>}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Modal: alta/edición de objetivo ─────────────────────────────── */}
      {modal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.4)' }}>
          <div className="modal-dialog">
            <form className="modal-content" onSubmit={guardar}>
              <div className="modal-header">
                <h5 className="modal-title">{modal === 'nuevo' ? 'Nuevo objetivo de calidad' : 'Editar objetivo'}</h5>
                <button type="button" className="btn-close" onClick={() => setModal(null)} />
              </div>
              <div className="modal-body">
                {err && <div className="alert alert-danger py-2 small">{err}</div>}
                <div className="row g-3">
                  <div className="col-12">
                    <label className="form-label small fw-medium">Nombre *</label>
                    <input className="form-control" required value={form.nombre}
                      onChange={e => setForm(p => ({ ...p, nombre: e.target.value }))} />
                  </div>
                  <div className="col-12">
                    <label className="form-label small fw-medium">Descripción</label>
                    <textarea className="form-control" rows={2} value={form.descripcion}
                      onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))} />
                  </div>
                  <div className="col-12">
                    <label className="form-label small fw-medium">Fuente del valor</label>
                    <select className="form-select" value={form.fuente}
                      onChange={e => setForm(p => ({ ...p, fuente: e.target.value }))}>
                      {FUENTES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                    {esAuto(form.fuente) && (
                      <div className="form-text">El valor se calcula solo, en base a datos ya cargados en el sistema.</div>
                    )}
                  </div>
                  <div className="col-md-4">
                    <label className="form-label small fw-medium">Meta *</label>
                    <input type="number" onPaste={manejarPegadoNumero} step="any" className="form-control" required value={form.meta}
                      onChange={e => setForm(p => ({ ...p, meta: e.target.value }))} />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label small fw-medium">Unidad</label>
                    <input className="form-control" value={form.unidad}
                      onChange={e => setForm(p => ({ ...p, unidad: e.target.value }))} />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label small fw-medium">Periodicidad</label>
                    <select className="form-select" value={form.periodicidad}
                      onChange={e => setForm(p => ({ ...p, periodicidad: e.target.value }))}>
                      {PERIODICIDADES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small fw-medium">Puesto responsable</label>
                    <select className="form-select" value={form.responsable_puesto_id}
                      onChange={e => setForm(p => ({ ...p, responsable_puesto_id: e.target.value }))}>
                      <option value="">— Sin asignar —</option>
                      {puestos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    </select>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small fw-medium">Responsable (nombre libre)</label>
                    <input className="form-control" placeholder="Si no corresponde a un puesto del organigrama"
                      value={form.responsable_nombre}
                      onChange={e => setForm(p => ({ ...p, responsable_nombre: e.target.value }))} />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving && <span className="spinner-border spinner-border-sm me-2" />}Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: cargar valor manual de un período ────────────────────── */}
      {modalMed && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.4)' }}>
          <div className="modal-dialog">
            <form className="modal-content" onSubmit={cargarMedicion}>
              <div className="modal-header">
                <h5 className="modal-title">Cargar valor — <strong>{modalMed.nombre}</strong></h5>
                <button type="button" className="btn-close" onClick={() => setModalMed(null)} />
              </div>
              <div className="modal-body">
                {errMed && <div className="alert alert-danger py-2 small">{errMed}</div>}
                <div className="row g-3">
                  <div className="col-md-6">
                    <label className="form-label small fw-medium">Período *</label>
                    <input className="form-control" required placeholder="Ej: 2026, 2026-Q3 o 2026-07"
                      value={formMed.periodo}
                      onChange={e => setFormMed(p => ({ ...p, periodo: e.target.value }))} />
                    <div className="form-text">Formato según la periodicidad del objetivo (año, año-trimestre o año-mes).</div>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small fw-medium">Valor ({modalMed.unidad}) *</label>
                    <input type="number" onPaste={manejarPegadoNumero} step="any" className="form-control" required value={formMed.valor}
                      onChange={e => setFormMed(p => ({ ...p, valor: e.target.value }))} />
                  </div>
                  <div className="col-12">
                    <label className="form-label small fw-medium">Observaciones</label>
                    <textarea className="form-control" rows={2} value={formMed.observaciones}
                      onChange={e => setFormMed(p => ({ ...p, observaciones: e.target.value }))} />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setModalMed(null)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={savingMed}>
                  {savingMed && <span className="spinner-border spinner-border-sm me-2" />}Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
