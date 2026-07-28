import { useState, useEffect, useCallback, Fragment } from 'react'
import api from '../../api/client'
import DateInput from '../../components/DateInput'

const CATEGORIAS = ['Manual', 'Política', 'Procedimiento', 'Instructivo', 'Registro']
const fmtF = f => f ? f.slice(0, 10).split('-').reverse().join('/') : '—'

const NUEVO_VACIO = { codigo: '', titulo: '', categoria: 'Procedimiento', aprobado_por: '', fecha_aprobacion: '', observaciones: '' }
const REVISION_VACIA = { aprobado_por: '', fecha_aprobacion: '', observaciones: '' }

export default function FormDocumentos({ canWrite }) {
  const [documentos, setDocumentos] = useState([])
  const [loading, setLoading]       = useState(true)

  const [historialCodigo, setHistorialCodigo] = useState(null)
  const [historial, setHistorial]             = useState([])
  const [loadingHist, setLoadingHist]         = useState(false)

  const [modalNuevo, setModalNuevo]       = useState(false)
  const [formNuevo, setFormNuevo]         = useState(NUEVO_VACIO)
  const [archivoNuevo, setArchivoNuevo]   = useState(null)
  const [savingNuevo, setSavingNuevo]     = useState(false)
  const [errNuevo, setErrNuevo]           = useState('')

  const [modalRevision, setModalRevision] = useState(null) // documento actual, o null
  const [formRevision, setFormRevision]   = useState(REVISION_VACIA)
  const [archivoRevision, setArchivoRevision] = useState(null)
  const [savingRevision, setSavingRevision]   = useState(false)
  const [errRevision, setErrRevision]         = useState('')

  const cargar = useCallback(() => {
    setLoading(true)
    api.get('/calidad/documentos').then(r => setDocumentos(r.data)).finally(() => setLoading(false))
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const toggleHistorial = async codigo => {
    if (historialCodigo === codigo) { setHistorialCodigo(null); return }
    setHistorialCodigo(codigo)
    setLoadingHist(true)
    try {
      const r = await api.get(`/calidad/documentos/${codigo}/historial`)
      setHistorial(r.data)
    } finally { setLoadingHist(false) }
  }

  const abrirNuevo = () => { setFormNuevo(NUEVO_VACIO); setArchivoNuevo(null); setErrNuevo(''); setModalNuevo(true) }

  const crearDocumento = async e => {
    e.preventDefault()
    if (!archivoNuevo) { setErrNuevo('Falta seleccionar el archivo'); return }
    setSavingNuevo(true); setErrNuevo('')
    try {
      const fd = new FormData()
      Object.entries(formNuevo).forEach(([k, v]) => fd.append(k, v))
      fd.append('archivo', archivoNuevo)
      await api.post('/calidad/documentos', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setModalNuevo(false)
      cargar()
    } catch (err) {
      setErrNuevo(err.response?.data?.error ?? 'Error al crear el documento')
    } finally { setSavingNuevo(false) }
  }

  const abrirRevision = doc => { setFormRevision(REVISION_VACIA); setArchivoRevision(null); setErrRevision(''); setModalRevision(doc) }

  const subirRevision = async e => {
    e.preventDefault()
    if (!archivoRevision) { setErrRevision('Falta seleccionar el archivo'); return }
    setSavingRevision(true); setErrRevision('')
    try {
      const fd = new FormData()
      Object.entries(formRevision).forEach(([k, v]) => fd.append(k, v))
      fd.append('archivo', archivoRevision)
      await api.post(`/calidad/documentos/${modalRevision.codigo}/revision`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setModalRevision(null)
      cargar()
      if (historialCodigo === modalRevision.codigo) toggleHistorial(modalRevision.codigo).then(() => toggleHistorial(modalRevision.codigo))
    } catch (err) {
      setErrRevision(err.response?.data?.error ?? 'Error al subir la nueva revisión')
    } finally { setSavingRevision(false) }
  }

  const verArchivo = id => window.open(`/api/v1/calidad/documentos/${id}/archivo`, '_blank')

  if (loading) return (
    <div className="d-flex justify-content-center py-5"><div className="spinner-border text-secondary" /></div>
  )

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <p className="text-muted small mb-0">
          Manual de Calidad, Política de Calidad y procedimientos, con control de revisiones (ISO 9001:2015, cláusula 7.5).
        </p>
        {canWrite && (
          <button className="btn btn-primary btn-sm" onClick={abrirNuevo}>
            <i className="bi bi-plus-lg me-1" />Nuevo documento
          </button>
        )}
      </div>

      {documentos.length === 0 ? (
        <p className="text-muted text-center py-4">Sin documentos cargados todavía.</p>
      ) : (
        <div className="card border-0 shadow-sm">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light">
              <tr>
                <th>Código</th><th>Título</th><th>Categoría</th><th>Rev.</th>
                <th>Aprobado</th><th>Fecha</th><th className="text-end">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {documentos.map(d => (
                <Fragment key={d.id}>
                  <tr>
                    <td className="fw-semibold">{d.codigo}</td>
                    <td>{d.titulo}</td>
                    <td><span className="badge bg-light text-dark border fw-normal">{d.categoria}</span></td>
                    <td><span className="badge bg-primary">Rev. {d.revision}</span></td>
                    <td className="text-muted small">{d.aprobado_por || '—'}</td>
                    <td className="text-muted small">{fmtF(d.fecha_aprobacion)}</td>
                    <td className="text-end">
                      <div className="d-flex gap-2 justify-content-end">
                        <button className="btn btn-sm btn-outline-secondary" onClick={() => verArchivo(d.id)}>
                          <i className="bi bi-eye me-1" />Ver
                        </button>
                        <button className="btn btn-sm btn-outline-secondary" onClick={() => toggleHistorial(d.codigo)}>
                          <i className={`bi bi-chevron-${historialCodigo === d.codigo ? 'up' : 'down'} me-1`} />
                          Historial{d.revisiones_anteriores > 0 ? ` (${d.revisiones_anteriores})` : ''}
                        </button>
                        {canWrite && (
                          <button className="btn btn-sm btn-outline-primary" onClick={() => abrirRevision(d)}>
                            <i className="bi bi-upload me-1" />Nueva revisión
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {historialCodigo === d.codigo && (
                    <tr key={`${d.id}-hist`}>
                      <td colSpan={7} className="bg-light p-0">
                        {loadingHist ? (
                          <div className="text-center py-2"><span className="spinner-border spinner-border-sm" /></div>
                        ) : (
                          <table className="table table-sm mb-0">
                            <tbody>
                              {historial.map(h => (
                                <tr key={h.id} className={h.estado === 'Obsoleto' ? 'text-muted' : ''}>
                                  <td style={{ width: 90 }}>Rev. {h.revision}</td>
                                  <td style={{ width: 100 }}>
                                    <span className={`badge ${h.estado === 'Vigente' ? 'bg-success' : 'bg-secondary'}`}>{h.estado}</span>
                                  </td>
                                  <td className="text-muted small">{fmtF(h.fecha_aprobacion)}</td>
                                  <td className="small">{h.observaciones || '—'}</td>
                                  <td className="text-end" style={{ width: 80 }}>
                                    <button className="btn btn-xs btn-outline-secondary py-0 px-2" style={{ fontSize: '0.75rem' }}
                                      onClick={() => verArchivo(h.id)}>Ver</button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Modal: Nuevo documento ─────────────────────────────────────── */}
      {modalNuevo && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.4)' }}>
          <div className="modal-dialog">
            <form className="modal-content" onSubmit={crearDocumento}>
              <div className="modal-header">
                <h5 className="modal-title">Nuevo documento de calidad</h5>
                <button type="button" className="btn-close" onClick={() => setModalNuevo(false)} />
              </div>
              <div className="modal-body">
                {errNuevo && <div className="alert alert-danger py-2 small">{errNuevo}</div>}
                <div className="row g-3">
                  <div className="col-md-4">
                    <label className="form-label small fw-medium">Código *</label>
                    <input className="form-control" required placeholder="Ej: MC, PC, PROC-01" value={formNuevo.codigo}
                      onChange={e => setFormNuevo(p => ({ ...p, codigo: e.target.value }))} />
                  </div>
                  <div className="col-md-8">
                    <label className="form-label small fw-medium">Título *</label>
                    <input className="form-control" required value={formNuevo.titulo}
                      onChange={e => setFormNuevo(p => ({ ...p, titulo: e.target.value }))} />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small fw-medium">Categoría</label>
                    <select className="form-select" value={formNuevo.categoria}
                      onChange={e => setFormNuevo(p => ({ ...p, categoria: e.target.value }))}>
                      {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small fw-medium">Aprobado por</label>
                    <input className="form-control" value={formNuevo.aprobado_por}
                      onChange={e => setFormNuevo(p => ({ ...p, aprobado_por: e.target.value }))} />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small fw-medium">Fecha de aprobación</label>
                    <DateInput value={formNuevo.fecha_aprobacion} onChange={v => setFormNuevo(p => ({ ...p, fecha_aprobacion: v }))} />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small fw-medium">Archivo (PDF, JPG o PNG) *</label>
                    <input type="file" className="form-control" accept=".pdf,.jpg,.jpeg,.png" required
                      onChange={e => setArchivoNuevo(e.target.files[0] || null)} />
                  </div>
                  <div className="col-12">
                    <label className="form-label small fw-medium">Observaciones</label>
                    <textarea className="form-control" rows={2} value={formNuevo.observaciones}
                      onChange={e => setFormNuevo(p => ({ ...p, observaciones: e.target.value }))} />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setModalNuevo(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={savingNuevo}>
                  {savingNuevo && <span className="spinner-border spinner-border-sm me-2" />}Crear
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Nueva revisión ──────────────────────────────────────── */}
      {modalRevision && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.4)' }}>
          <div className="modal-dialog">
            <form className="modal-content" onSubmit={subirRevision}>
              <div className="modal-header">
                <h5 className="modal-title">
                  Nueva revisión — <strong>{modalRevision.codigo}</strong> (actual: Rev. {modalRevision.revision})
                </h5>
                <button type="button" className="btn-close" onClick={() => setModalRevision(null)} />
              </div>
              <div className="modal-body">
                {errRevision && <div className="alert alert-danger py-2 small">{errRevision}</div>}
                <div className="row g-3">
                  <div className="col-md-6">
                    <label className="form-label small fw-medium">Aprobado por</label>
                    <input className="form-control" value={formRevision.aprobado_por}
                      onChange={e => setFormRevision(p => ({ ...p, aprobado_por: e.target.value }))} />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small fw-medium">Fecha de aprobación</label>
                    <DateInput value={formRevision.fecha_aprobacion} onChange={v => setFormRevision(p => ({ ...p, fecha_aprobacion: v }))} />
                  </div>
                  <div className="col-12">
                    <label className="form-label small fw-medium">Archivo nuevo (PDF, JPG o PNG) *</label>
                    <input type="file" className="form-control" accept=".pdf,.jpg,.jpeg,.png" required
                      onChange={e => setArchivoRevision(e.target.files[0] || null)} />
                  </div>
                  <div className="col-12">
                    <label className="form-label small fw-medium">Motivo del cambio</label>
                    <textarea className="form-control" rows={2} placeholder="Qué cambió respecto a la revisión anterior"
                      value={formRevision.observaciones}
                      onChange={e => setFormRevision(p => ({ ...p, observaciones: e.target.value }))} />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setModalRevision(null)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={savingRevision}>
                  {savingRevision && <span className="spinner-border spinner-border-sm me-2" />}Subir revisión
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
