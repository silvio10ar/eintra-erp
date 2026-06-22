import { useState, useEffect, useCallback, useRef } from 'react'
import api from '../../api/client'

const fmtN = n => n ? new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(n) : '—'
const fmtF = s => s ? s.slice(0, 10).split('-').reverse().join('/') : '—'

const BADGE = {
  Activo:      'badge bg-primary',
  Ganado:      'badge bg-success',
  Perdido:     'badge bg-danger',
  Desestimado: 'badge bg-secondary',
}

const FORM0 = {
  empresa_id: '', contacto_id: '', fecha: '', equipo: '', indirecto: '',
  moneda: 'USD', presupuestado: '', ganado: '', perdido: '',
  estado: 'Activo', observaciones: '', seguimiento: '', actualizado: '',
}

const ANIOS = ['2026','2025','2024','2023','2022','2021','2020','2019','2018']

export default function CRM() {
  const [tab,       setTab]       = useState('pipeline')
  const [stats,     setStats]     = useState(null)
  const [cots,      setCots]      = useState([])
  const [totalCots, setTotalCots] = useState(0)
  const [loadCots,  setLoadCots]  = useState(false)
  const [page,      setPage]      = useState(1)
  const LIMIT = 50
  const [filtros, setFiltros] = useState({ estado: '', anio: '', buscar: '', moneda: '' })

  const [empresas,     setEmpresas]     = useState([])
  const [totalEmps,    setTotalEmps]    = useState(0)
  const [empDetalle,   setEmpDetalle]   = useState(null)
  const [buscarEmpTab, setBuscarEmpTab] = useState('')

  const [modal,       setModal]       = useState(null)
  const [form,        setForm]        = useState(FORM0)
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')
  const [modalCliente, setModalCliente] = useState(null)
  const [formCliente,  setFormCliente]  = useState({})

  // autocomplete empresa en el formulario
  const [empQ,    setEmpQ]    = useState('')
  const [empSugs, setEmpSugs] = useState([])
  const [conts,   setConts]   = useState([])
  const empRef = useRef(null)

  // ── Loaders ─────────────────────────────────────────────────────────────
  const cargarStats = useCallback(() => {
    api.get('/crm/stats').then(r => setStats(r.data)).catch(() => {})
  }, [])

  const cargarCots = useCallback(() => {
    setLoadCots(true)
    api.get('/crm/cotizaciones', { params: { ...filtros, page, limit: LIMIT } })
      .then(r => { setCots(r.data.datos); setTotalCots(r.data.total) })
      .finally(() => setLoadCots(false))
  }, [filtros, page])

  const cargarEmpresas = useCallback(() => {
    api.get('/crm/empresas', { params: { buscar: buscarEmpTab, limit: 100 } })
      .then(r => { setEmpresas(r.data.datos); setTotalEmps(r.data.total) })
  }, [buscarEmpTab])

  useEffect(() => { cargarStats() }, [cargarStats])
  useEffect(() => {
    if (tab === 'pipeline' || tab === 'cotizaciones') cargarCots()
  }, [cargarCots, tab])
  useEffect(() => {
    if (tab === 'empresas') cargarEmpresas()
  }, [cargarEmpresas, tab])

  // ── Autocomplete empresa ─────────────────────────────────────────────────
  const onEmpQ = v => {
    setEmpQ(v)
    setForm(f => ({ ...f, empresa_id: '', contacto_id: '' }))
    setConts([])
    if (v.length < 1) { setEmpSugs([]); return }
    api.get('/crm/empresas', { params: { buscar: v, limit: 20 } })
      .then(r => setEmpSugs(r.data.datos))
  }

  const selEmpresa = emp => {
    setEmpQ(emp.nombre)
    setForm(f => ({ ...f, empresa_id: emp.id, contacto_id: '' }))
    setEmpSugs([])
    api.get('/crm/contactos', { params: { empresa_id: emp.id } })
      .then(r => setConts(r.data.datos))
  }

  useEffect(() => {
    const cerrar = e => { if (empRef.current && !empRef.current.contains(e.target)) setEmpSugs([]) }
    document.addEventListener('mousedown', cerrar)
    return () => document.removeEventListener('mousedown', cerrar)
  }, [])

  // ── Abrir modales ────────────────────────────────────────────────────────
  const abrirNuevaCot = () => {
    setForm(FORM0); setEmpQ(''); setEmpSugs([]); setConts([])
    setError(''); setModal('nuevaCot')
  }

  const abrirEditarCot = cot => {
    setForm({
      empresa_id: cot.empresa_id || '', contacto_id: cot.contacto_id || '',
      fecha: cot.fecha || '', equipo: cot.equipo || '', indirecto: cot.indirecto || '',
      moneda: cot.moneda || 'USD', presupuestado: cot.presupuestado || '',
      ganado: cot.ganado || '', perdido: cot.perdido || '',
      estado: cot.estado || 'Activo', observaciones: cot.observaciones || '',
      seguimiento: cot.seguimiento || '', actualizado: cot.actualizado || '',
    })
    setEmpQ(cot.empresa_nombre || '')
    if (cot.empresa_id)
      api.get('/crm/contactos', { params: { empresa_id: cot.empresa_id } })
        .then(r => setConts(r.data.datos))
    setError(''); setModal({ editCot: cot })
  }

  const abrirVerEmpresa = id => {
    api.get(`/crm/empresas/${id}`).then(r => setEmpDetalle(r.data))
  }

  // ── Guardar ──────────────────────────────────────────────────────────────
  const guardarCot = async e => {
    e.preventDefault(); setSaving(true); setError('')
    try {
      const empresaId = form.empresa_id
      const esGanado  = form.estado === 'Ganado'
      if (modal === 'nuevaCot') await api.post('/crm/cotizaciones', form)
      else                      await api.put(`/crm/cotizaciones/${modal.editCot.id}`, form)
      setModal(null); cargarCots(); cargarStats()
      if (esGanado && empresaId) {
        const r = await api.get(`/crm/empresas/${empresaId}/cliente`)
        if (!r.data.existe) {
          setModalCliente({ empresa_id: empresaId, empresa: r.data.empresa })
          setFormCliente({ cuit: '', direccion: '', localidad: '', cp: '', condicion_pago: '' })
        }
      }
    } catch(err) { setError(err.response?.data?.error ?? 'Error al guardar') }
    finally { setSaving(false) }
  }

  const crearClienteDesdeModal = async e => {
    e.preventDefault(); setSaving(true)
    try {
      await api.post(`/crm/empresas/${modalCliente.empresa_id}/crear-cliente`, formCliente)
      setModalCliente(null)
    } catch(err) { alert(err.response?.data?.error ?? 'Error al crear cliente') }
    finally { setSaving(false) }
  }

  const eliminarCot = async id => {
    if (!confirm('¿Eliminar esta cotización?')) return
    await api.delete(`/crm/cotizaciones/${id}`)
    cargarCots(); cargarStats()
  }

  const guardarEmpresa = async e => {
    e.preventDefault(); setSaving(true); setError('')
    try {
      if (modal === 'nuevaEmpresa') await api.post('/crm/empresas', { nombre: form.nombre })
      else                          await api.put(`/crm/empresas/${modal.editEmp.id}`, { nombre: form.nombre })
      setModal(null); cargarEmpresas()
    } catch(err) { setError(err.response?.data?.error ?? 'Error') }
    finally { setSaving(false) }
  }

  const guardarContacto = async e => {
    e.preventDefault(); setSaving(true); setError('')
    try {
      if (modal?.tipo === 'nuevoContacto')
        await api.post('/crm/contactos', { ...form, empresa_id: modal.empresa_id })
      else
        await api.put(`/crm/contactos/${modal.cont.id}`, form)
      setModal(null)
      if (empDetalle) abrirVerEmpresa(empDetalle.id)
    } catch(err) { setError(err.response?.data?.error ?? 'Error') }
    finally { setSaving(false) }
  }

  const eliminarContacto = async id => {
    if (!confirm('¿Eliminar contacto?')) return
    await api.delete(`/crm/contactos/${id}`)
    if (empDetalle) abrirVerEmpresa(empDetalle.id)
  }

  // ── UI helpers ────────────────────────────────────────────────────────────
  const totalPages = Math.ceil(totalCots / LIMIT)

  const FiltroBar = () => (
    <div className="d-flex flex-wrap gap-2 mb-3 align-items-center">
      <input
        className="form-control form-control-sm" placeholder="Buscar empresa / equipo..."
        style={{ maxWidth: 220 }} value={filtros.buscar}
        onChange={e => { setFiltros(f => ({ ...f, buscar: e.target.value })); setPage(1) }}
      />
      <select className="form-select form-select-sm" style={{ maxWidth: 140 }}
        value={filtros.estado}
        onChange={e => { setFiltros(f => ({ ...f, estado: e.target.value })); setPage(1) }}>
        <option value="">Todos los estados</option>
        <option>Activo</option><option>Ganado</option>
        <option>Perdido</option><option>Desestimado</option>
      </select>
      <select className="form-select form-select-sm" style={{ maxWidth: 100 }}
        value={filtros.anio}
        onChange={e => { setFiltros(f => ({ ...f, anio: e.target.value })); setPage(1) }}>
        <option value="">Todos los años</option>
        {ANIOS.map(a => <option key={a}>{a}</option>)}
      </select>
      <select className="form-select form-select-sm" style={{ maxWidth: 100 }}
        value={filtros.moneda}
        onChange={e => { setFiltros(f => ({ ...f, moneda: e.target.value })); setPage(1) }}>
        <option value="">ARS + USD</option>
        <option>USD</option><option>ARS</option>
      </select>
      <span className="text-muted ms-1" style={{ fontSize: '0.8rem' }}>{totalCots} registros</span>
    </div>
  )

  const TablaCots = ({ rows }) => (
    <div className="table-responsive" style={{ maxHeight: 'calc(100vh - 340px)', overflowY: 'auto' }}>
      <table className="table table-hover table-sm mb-0" style={{ fontSize: '0.82rem' }}>
        <thead className="table-dark sticky-top">
          <tr>
            <th>Fecha</th><th>Empresa</th><th>Contacto</th><th>Equipo</th>
            <th>Canal</th><th className="text-end">Presuup.</th>
            <th className="text-end">Ganado</th><th>Estado</th><th></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={9} className="text-center text-muted py-4">Sin resultados</td></tr>
          )}
          {rows.map(c => (
            <tr key={c.id}>
              <td className="text-nowrap">{fmtF(c.fecha)}</td>
              <td>
                <span className="fw-semibold" style={{ cursor: 'pointer', color: '#0d6efd' }}
                  onClick={() => abrirVerEmpresa(c.empresa_id)}>
                  {c.empresa_nombre || '—'}
                </span>
              </td>
              <td>
                <div>{c.contacto_nombre || '—'}</div>
                {c.contacto_posicion && (
                  <div className="text-muted" style={{ fontSize: '0.75rem' }}>{c.contacto_posicion}</div>
                )}
              </td>
              <td style={{ maxWidth: 200 }}>{c.equipo}</td>
              <td className="text-muted">{c.indirecto || '—'}</td>
              <td className="text-end text-nowrap">
                <span className="me-1 badge bg-light text-dark" style={{ fontSize: '0.7rem' }}>{c.moneda}</span>
                {fmtN(c.presupuestado)}
              </td>
              <td className="text-end text-success text-nowrap">
                {c.ganado > 0 ? fmtN(c.ganado) : '—'}
              </td>
              <td><span className={BADGE[c.estado] ?? 'badge bg-secondary'} style={{ fontSize: '0.72rem' }}>{c.estado}</span></td>
              <td className="text-nowrap">
                <button className="btn btn-outline-secondary btn-sm py-0 px-1 me-1"
                  onClick={() => abrirEditarCot(c)} title="Editar">
                  <i className="bi bi-pencil" style={{ fontSize: '0.75rem' }} />
                </button>
                <button className="btn btn-outline-danger btn-sm py-0 px-1"
                  onClick={() => eliminarCot(c.id)} title="Eliminar">
                  <i className="bi bi-trash" style={{ fontSize: '0.75rem' }} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  const Paginacion = () => totalPages > 1 ? (
    <div className="d-flex align-items-center gap-2 mt-2">
      <button className="btn btn-sm btn-outline-secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>‹</button>
      <span style={{ fontSize: '0.82rem' }}>Pág. {page} / {totalPages}</span>
      <button className="btn btn-sm btn-outline-secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>›</button>
    </div>
  ) : null

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: '1.5rem' }}>

      {/* Header */}
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h4 className="mb-0" style={{ fontWeight: 700 }}>
          <i className="bi bi-people me-2 text-primary" />CRM — Ventas
        </h4>
        <div className="d-flex gap-2">
          {tab !== 'empresas' && (
            <button className="btn btn-primary btn-sm" onClick={abrirNuevaCot}>
              <i className="bi bi-plus-lg me-1" />Nueva Cotización
            </button>
          )}
          {tab === 'empresas' && (
            <button className="btn btn-outline-primary btn-sm"
              onClick={() => { setForm({ nombre: '' }); setError(''); setModal('nuevaEmpresa') }}>
              <i className="bi bi-plus-lg me-1" />Nueva Empresa
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <ul className="nav nav-tabs mb-3">
        {[
          { key: 'pipeline',     icon: 'graph-up',           label: 'Pipeline'      },
          { key: 'cotizaciones', icon: 'file-earmark-text',  label: 'Cotizaciones'  },
          { key: 'empresas',     icon: 'building',           label: 'Empresas'      },
        ].map(t => (
          <li key={t.key} className="nav-item">
            <button className={`nav-link ${tab === t.key ? 'active' : ''}`}
              onClick={() => { setTab(t.key); setEmpDetalle(null) }}>
              <i className={`bi bi-${t.icon} me-1`} />{t.label}
            </button>
          </li>
        ))}
      </ul>

      {/* ═══════════════ PIPELINE ═══════════════ */}
      {tab === 'pipeline' && (
        <div>
          {stats && (
            <>
              <div className="row g-3 mb-4">
                {[
                  { label: 'Total cotizaciones', val: stats.total,              color: '#6c757d', icon: 'file-earmark-text' },
                  { label: 'Activas',            val: stats.activas.count,      color: '#0d6efd', icon: 'hourglass-split'   },
                  { label: 'Ganadas',            val: stats.ganadas.count,      color: '#198754', icon: 'trophy'            },
                  { label: 'Tasa conversión',    val: `${stats.conversion}%`,   color: '#198754', icon: 'percent'           },
                ].map((c, i) => (
                  <div key={i} className="col-6 col-md-3">
                    <div className="card border-0 shadow-sm h-100 p-3 text-center">
                      <i className={`bi bi-${c.icon} mb-1`} style={{ fontSize: '1.4rem', color: c.color }} />
                      <div style={{ fontSize: '1.8rem', fontWeight: 700, color: c.color, lineHeight: 1.1 }}>{c.val}</div>
                      <div className="text-muted mt-1" style={{ fontSize: '0.78rem' }}>{c.label}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="card border-0 shadow-sm mb-4">
                <div className="card-header bg-white py-2 fw-semibold" style={{ fontSize: '0.88rem' }}>
                  Evolución por año
                </div>
                <div className="table-responsive">
                  <table className="table table-sm table-hover mb-0" style={{ fontSize: '0.83rem' }}>
                    <thead className="table-dark">
                      <tr>
                        <th>Año</th>
                        <th className="text-end">Cotizaciones</th>
                        <th className="text-end">Presupuestado</th>
                        <th className="text-end">Ganado</th>
                        <th className="text-end">Perdido</th>
                        <th className="text-end">% Conv.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.porAnio.map(r => (
                        <tr key={r.anio}>
                          <td><strong>{r.anio || '—'}</strong></td>
                          <td className="text-end">{r.cotizaciones}</td>
                          <td className="text-end">{fmtN(r.presupuestado)}</td>
                          <td className="text-end text-success">{fmtN(r.ganado)}</td>
                          <td className="text-end text-danger">{fmtN(r.perdido)}</td>
                          <td className="text-end">
                            {r.cotizaciones > 0
                              ? `${Math.round(r.ganadas_count / r.cotizaciones * 100)}%`
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <h6 className="fw-semibold mb-2">Cotizaciones activas</h6>
              {loadCots
                ? <div className="text-center py-3"><div className="spinner-border spinner-border-sm text-secondary" /></div>
                : <TablaCots rows={cots.filter(c => c.estado === 'Activo')} />
              }
            </>
          )}
        </div>
      )}

      {/* ═══════════════ COTIZACIONES ═══════════════ */}
      {tab === 'cotizaciones' && (
        <div>
          <FiltroBar />
          <div className="card border-0 shadow-sm">
            {loadCots
              ? <div className="text-center py-4"><div className="spinner-border spinner-border-sm text-secondary" /></div>
              : <TablaCots rows={cots} />
            }
          </div>
          <Paginacion />
        </div>
      )}

      {/* ═══════════════ EMPRESAS ═══════════════ */}
      {tab === 'empresas' && !empDetalle && (
        <div>
          <div className="mb-3">
            <input className="form-control form-control-sm" style={{ maxWidth: 260 }}
              placeholder="Buscar empresa..." value={buscarEmpTab}
              onChange={e => setBuscarEmpTab(e.target.value)} />
          </div>
          <div className="card border-0 shadow-sm">
            <div className="table-responsive" style={{ maxHeight: 'calc(100vh - 300px)', overflowY: 'auto' }}>
              <table className="table table-hover table-sm mb-0" style={{ fontSize: '0.83rem' }}>
                <thead className="table-dark sticky-top">
                  <tr>
                    <th>Empresa</th>
                    <th className="text-center">Contactos</th>
                    <th className="text-center">Cotizaciones</th>
                    <th className="text-end">Total pres.</th>
                    <th className="text-end">Total ganado</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {empresas.map(e => (
                    <tr key={e.id} style={{ cursor: 'pointer' }} onClick={() => abrirVerEmpresa(e.id)}>
                      <td className="fw-semibold">{e.nombre}</td>
                      <td className="text-center">{e.contactos_count}</td>
                      <td className="text-center">{e.cotizaciones_count}</td>
                      <td className="text-end">{fmtN(e.total_presupuestado)}</td>
                      <td className="text-end text-success">{fmtN(e.total_ganado)}</td>
                      <td>
                        <button className="btn btn-outline-secondary btn-sm py-0 px-1"
                          onClick={ev => { ev.stopPropagation(); setForm({ nombre: e.nombre }); setError(''); setModal({ editEmp: e }) }}>
                          <i className="bi bi-pencil" style={{ fontSize: '0.75rem' }} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="text-muted mt-2" style={{ fontSize: '0.8rem' }}>{totalEmps} empresas</div>
        </div>
      )}

      {/* ═══════════════ DETALLE EMPRESA ═══════════════ */}
      {tab === 'empresas' && empDetalle && (
        <div>
          <button className="btn btn-sm btn-outline-secondary mb-3"
            onClick={() => setEmpDetalle(null)}>
            <i className="bi bi-arrow-left me-1" />Volver
          </button>
          <div className="card border-0 shadow-sm mb-3 p-3">
            <div className="d-flex align-items-center justify-content-between">
              <h5 className="mb-0 fw-bold">{empDetalle.nombre}</h5>
              <button className="btn btn-outline-primary btn-sm"
                onClick={() => { setForm({ nombre: empDetalle.nombre }); setError(''); setModal({ editEmp: empDetalle }) }}>
                <i className="bi bi-pencil me-1" />Editar
              </button>
            </div>
          </div>

          {/* Contactos */}
          <div className="card border-0 shadow-sm mb-3">
            <div className="card-header bg-white py-2 d-flex justify-content-between align-items-center">
              <span className="fw-semibold" style={{ fontSize: '0.88rem' }}>
                <i className="bi bi-person me-1" />Contactos ({empDetalle.contactos?.length || 0})
              </span>
              <button className="btn btn-outline-primary btn-sm py-0"
                onClick={() => { setForm({ nombre: '', posicion: '', telefono: '', mail: '' }); setError(''); setModal({ tipo: 'nuevoContacto', empresa_id: empDetalle.id }) }}>
                <i className="bi bi-plus me-1" />Agregar
              </button>
            </div>
            {empDetalle.contactos?.length > 0 ? (
              <table className="table table-sm mb-0" style={{ fontSize: '0.82rem' }}>
                <thead className="table-light">
                  <tr><th>Nombre</th><th>Cargo</th><th>Teléfono</th><th>Mail</th><th></th></tr>
                </thead>
                <tbody>
                  {empDetalle.contactos.map(ct => (
                    <tr key={ct.id}>
                      <td className="fw-semibold">{ct.nombre}</td>
                      <td className="text-muted">{ct.posicion}</td>
                      <td>{ct.telefono}</td>
                      <td>
                        {ct.mail
                          ? <a href={`mailto:${ct.mail}`} onClick={e => e.stopPropagation()}>{ct.mail}</a>
                          : '—'}
                      </td>
                      <td className="text-nowrap">
                        <button className="btn btn-outline-secondary btn-sm py-0 px-1 me-1"
                          onClick={() => { setForm({ nombre: ct.nombre, posicion: ct.posicion, telefono: ct.telefono, mail: ct.mail }); setError(''); setModal({ tipo: 'editContacto', cont: ct }) }}>
                          <i className="bi bi-pencil" style={{ fontSize: '0.72rem' }} />
                        </button>
                        <button className="btn btn-outline-danger btn-sm py-0 px-1"
                          onClick={() => eliminarContacto(ct.id)}>
                          <i className="bi bi-trash" style={{ fontSize: '0.72rem' }} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-center text-muted py-3" style={{ fontSize: '0.83rem' }}>Sin contactos cargados</div>
            )}
          </div>

          {/* Cotizaciones de la empresa */}
          <div className="card border-0 shadow-sm">
            <div className="card-header bg-white py-2 d-flex justify-content-between align-items-center">
              <span className="fw-semibold" style={{ fontSize: '0.88rem' }}>
                <i className="bi bi-file-earmark-text me-1" />Cotizaciones ({empDetalle.cotizaciones?.length || 0})
              </span>
              <button className="btn btn-primary btn-sm py-0"
                onClick={() => {
                  setForm({ ...FORM0, empresa_id: empDetalle.id })
                  setEmpQ(empDetalle.nombre)
                  setConts(empDetalle.contactos || [])
                  setError(''); setModal('nuevaCot')
                }}>
                <i className="bi bi-plus me-1" />Nueva
              </button>
            </div>
            <div className="table-responsive">
              <table className="table table-sm table-hover mb-0" style={{ fontSize: '0.82rem' }}>
                <thead className="table-light">
                  <tr>
                    <th>Fecha</th><th>Equipo</th><th>Canal</th>
                    <th className="text-end">Presup.</th><th className="text-end">Ganado</th>
                    <th>Estado</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {(empDetalle.cotizaciones || []).map(c => (
                    <tr key={c.id}>
                      <td className="text-nowrap">{fmtF(c.fecha)}</td>
                      <td>{c.equipo}</td>
                      <td className="text-muted">{c.indirecto || '—'}</td>
                      <td className="text-end text-nowrap">
                        <span className="me-1 badge bg-light text-dark" style={{ fontSize: '0.68rem' }}>{c.moneda}</span>
                        {fmtN(c.presupuestado)}
                      </td>
                      <td className="text-end text-success">{c.ganado > 0 ? fmtN(c.ganado) : '—'}</td>
                      <td><span className={BADGE[c.estado] ?? 'badge bg-secondary'} style={{ fontSize: '0.72rem' }}>{c.estado}</span></td>
                      <td>
                        <button className="btn btn-outline-secondary btn-sm py-0 px-1"
                          onClick={() => abrirEditarCot({ ...c, empresa_nombre: empDetalle.nombre })}>
                          <i className="bi bi-pencil" style={{ fontSize: '0.72rem' }} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ MODAL COTIZACIÓN ═══════════════ */}
      {(modal === 'nuevaCot' || modal?.editCot) && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.5)' }}>
          <div className="modal-dialog modal-lg modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h5 className="modal-title" style={{ fontSize: '1rem' }}>
                  {modal === 'nuevaCot' ? 'Nueva Cotización' : 'Editar Cotización'}
                </h5>
                <button className="btn-close" onClick={() => setModal(null)} />
              </div>
              <form onSubmit={guardarCot}>
                <div className="modal-body" style={{ fontSize: '0.85rem' }}>
                  {error && <div className="alert alert-danger py-1">{error}</div>}

                  {/* Empresa */}
                  <div className="row g-2 mb-2">
                    <div className="col-8">
                      <label className="form-label mb-1">Empresa</label>
                      <div ref={empRef} style={{ position: 'relative' }}>
                        <input className="form-control form-control-sm"
                          placeholder="Buscar o crear empresa..."
                          value={empQ} onChange={e => onEmpQ(e.target.value)} />
                        {empSugs.length > 0 && (
                          <div style={{
                            position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000,
                            background: '#fff', border: '1px solid #dee2e6',
                            borderRadius: 4, boxShadow: '0 4px 12px rgba(0,0,0,.12)',
                            maxHeight: 200, overflowY: 'auto',
                          }}>
                            {empSugs.map(e => (
                              <div key={e.id} onClick={() => selEmpresa(e)}
                                style={{ padding: '6px 10px', cursor: 'pointer', fontSize: '0.83rem' }}
                                onMouseEnter={ev => ev.currentTarget.style.background = '#f0f4ff'}
                                onMouseLeave={ev => ev.currentTarget.style.background = 'transparent'}>
                                {e.nombre}
                              </div>
                            ))}
                            {empQ.trim() && (
                              <div onClick={async () => {
                                const r = await api.post('/crm/empresas', { nombre: empQ.trim() })
                                selEmpresa({ id: r.data.id, nombre: empQ.trim() })
                              }}
                                style={{ padding: '6px 10px', cursor: 'pointer', color: '#0d6efd', fontSize: '0.83rem', borderTop: '1px solid #eee' }}
                                onMouseEnter={ev => ev.currentTarget.style.background = '#f0f4ff'}
                                onMouseLeave={ev => ev.currentTarget.style.background = 'transparent'}>
                                <i className="bi bi-plus me-1" />Crear "{empQ.trim()}"
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="col-4">
                      <label className="form-label mb-1">Contacto</label>
                      <select className="form-select form-select-sm"
                        value={form.contacto_id}
                        onChange={e => setForm(f => ({ ...f, contacto_id: e.target.value }))}>
                        <option value="">Sin contacto</option>
                        {conts.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="row g-2 mb-2">
                    <div className="col-4">
                      <label className="form-label mb-1">Fecha</label>
                      <input type="date" className="form-control form-control-sm"
                        value={form.fecha}
                        onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
                    </div>
                    <div className="col-4">
                      <label className="form-label mb-1">Estado</label>
                      <select className="form-select form-select-sm"
                        value={form.estado}
                        onChange={e => setForm(f => ({ ...f, estado: e.target.value }))}>
                        <option>Activo</option><option>Ganado</option>
                        <option>Perdido</option><option>Desestimado</option>
                      </select>
                    </div>
                    <div className="col-4">
                      <label className="form-label mb-1">Moneda</label>
                      <select className="form-select form-select-sm"
                        value={form.moneda}
                        onChange={e => setForm(f => ({ ...f, moneda: e.target.value }))}>
                        <option>USD</option><option>ARS</option>
                      </select>
                    </div>
                  </div>

                  <div className="mb-2">
                    <label className="form-label mb-1">Equipo cotizado</label>
                    <input className="form-control form-control-sm" value={form.equipo}
                      onChange={e => setForm(f => ({ ...f, equipo: e.target.value }))} />
                  </div>

                  <div className="mb-2">
                    <label className="form-label mb-1">Canal indirecto / Partner</label>
                    <input className="form-control form-control-sm" value={form.indirecto}
                      placeholder="Nombre del partner o consultor"
                      onChange={e => setForm(f => ({ ...f, indirecto: e.target.value }))} />
                  </div>

                  <div className="row g-2 mb-2">
                    <div className="col-4">
                      <label className="form-label mb-1">Presupuestado</label>
                      <input type="number" className="form-control form-control-sm"
                        value={form.presupuestado}
                        onChange={e => setForm(f => ({ ...f, presupuestado: e.target.value }))} />
                    </div>
                    <div className="col-4">
                      <label className="form-label mb-1">Ganado</label>
                      <input type="number" className="form-control form-control-sm"
                        value={form.ganado}
                        onChange={e => setForm(f => ({ ...f, ganado: e.target.value }))} />
                    </div>
                    <div className="col-4">
                      <label className="form-label mb-1">Perdido</label>
                      <input type="number" className="form-control form-control-sm"
                        value={form.perdido}
                        onChange={e => setForm(f => ({ ...f, perdido: e.target.value }))} />
                    </div>
                  </div>

                  <div className="mb-2">
                    <label className="form-label mb-1">Observaciones</label>
                    <textarea className="form-control form-control-sm" rows={2}
                      value={form.observaciones}
                      onChange={e => setForm(f => ({ ...f, observaciones: e.target.value }))} />
                  </div>

                  <div className="row g-2">
                    <div className="col-8">
                      <label className="form-label mb-1">Seguimiento</label>
                      <textarea className="form-control form-control-sm" rows={2}
                        value={form.seguimiento}
                        onChange={e => setForm(f => ({ ...f, seguimiento: e.target.value }))} />
                    </div>
                    <div className="col-4">
                      <label className="form-label mb-1">Últ. actualización</label>
                      <input type="date" className="form-control form-control-sm"
                        value={form.actualizado}
                        onChange={e => setForm(f => ({ ...f, actualizado: e.target.value }))} />
                    </div>
                  </div>
                </div>
                <div className="modal-footer py-2">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setModal(null)}>Cancelar</button>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                    {saving ? <span className="spinner-border spinner-border-sm me-1" /> : null}
                    Guardar
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ MODAL EMPRESA ═══════════════ */}
      {(modal === 'nuevaEmpresa' || modal?.editEmp) && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.5)' }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h5 className="modal-title" style={{ fontSize: '1rem' }}>
                  {modal === 'nuevaEmpresa' ? 'Nueva Empresa' : 'Editar Empresa'}
                </h5>
                <button className="btn-close" onClick={() => setModal(null)} />
              </div>
              <form onSubmit={guardarEmpresa}>
                <div className="modal-body">
                  {error && <div className="alert alert-danger py-1">{error}</div>}
                  <label className="form-label">Nombre de la empresa</label>
                  <input className="form-control" value={form.nombre || ''}
                    onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                    required autoFocus />
                </div>
                <div className="modal-footer py-2">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setModal(null)}>Cancelar</button>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>Guardar</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ MODAL AGREGAR CLIENTE ═══════════════ */}
      {modalCliente && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.6)' }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header py-2" style={{ background: '#198754', color: '#fff' }}>
                <h5 className="modal-title" style={{ fontSize: '1rem' }}>
                  <i className="bi bi-person-plus-fill me-2" />Nuevo Cliente
                </h5>
                <button className="btn-close btn-close-white" onClick={() => setModalCliente(null)} />
              </div>
              <form onSubmit={crearClienteDesdeModal}>
                <div className="modal-body" style={{ fontSize: '0.85rem' }}>
                  <div className="alert alert-success py-2 mb-3" style={{ fontSize: '0.82rem' }}>
                    <i className="bi bi-trophy-fill me-1" />
                    <strong>{modalCliente.empresa?.nombre}</strong> no está en el listado de clientes.
                    Completá los datos para agregarlo.
                  </div>

                  <div className="mb-2">
                    <label className="form-label mb-1">Empresa</label>
                    <input className="form-control form-control-sm" value={modalCliente.empresa?.nombre || ''} readOnly disabled />
                  </div>

                  <div className="row g-2 mb-2">
                    <div className="col-6">
                      <label className="form-label mb-1">CUIT</label>
                      <input className="form-control form-control-sm" value={formCliente.cuit}
                        onChange={e => setFormCliente(f => ({ ...f, cuit: e.target.value }))}
                        placeholder="20-12345678-1" />
                    </div>
                    <div className="col-6">
                      <label className="form-label mb-1">Condición de pago</label>
                      <input className="form-control form-control-sm" value={formCliente.condicion_pago}
                        onChange={e => setFormCliente(f => ({ ...f, condicion_pago: e.target.value }))}
                        placeholder="Ej: 30 días" />
                    </div>
                  </div>

                  <div className="mb-2">
                    <label className="form-label mb-1">Dirección</label>
                    <input className="form-control form-control-sm" value={formCliente.direccion}
                      onChange={e => setFormCliente(f => ({ ...f, direccion: e.target.value }))} />
                  </div>

                  <div className="row g-2">
                    <div className="col-8">
                      <label className="form-label mb-1">Localidad</label>
                      <input className="form-control form-control-sm" value={formCliente.localidad}
                        onChange={e => setFormCliente(f => ({ ...f, localidad: e.target.value }))} />
                    </div>
                    <div className="col-4">
                      <label className="form-label mb-1">CP</label>
                      <input className="form-control form-control-sm" value={formCliente.cp}
                        onChange={e => setFormCliente(f => ({ ...f, cp: e.target.value }))} />
                    </div>
                  </div>
                </div>
                <div className="modal-footer py-2">
                  <button type="button" className="btn btn-secondary btn-sm"
                    onClick={() => setModalCliente(null)}>Omitir por ahora</button>
                  <button type="submit" className="btn btn-success btn-sm" disabled={saving}>
                    {saving ? <span className="spinner-border spinner-border-sm me-1" /> : null}
                    <i className="bi bi-person-plus me-1" />Agregar cliente
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════ MODAL CONTACTO ═══════════════ */}
      {(modal?.tipo === 'nuevoContacto' || modal?.tipo === 'editContacto') && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.5)' }}>
          <div className="modal-dialog">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h5 className="modal-title" style={{ fontSize: '1rem' }}>
                  {modal.tipo === 'nuevoContacto' ? 'Nuevo Contacto' : 'Editar Contacto'}
                </h5>
                <button className="btn-close" onClick={() => setModal(null)} />
              </div>
              <form onSubmit={guardarContacto}>
                <div className="modal-body" style={{ fontSize: '0.85rem' }}>
                  {error && <div className="alert alert-danger py-1">{error}</div>}
                  <div className="mb-2">
                    <label className="form-label mb-1">Nombre</label>
                    <input className="form-control form-control-sm" value={form.nombre || ''}
                      onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} autoFocus />
                  </div>
                  <div className="mb-2">
                    <label className="form-label mb-1">Cargo / Posición</label>
                    <input className="form-control form-control-sm" value={form.posicion || ''}
                      onChange={e => setForm(f => ({ ...f, posicion: e.target.value }))} />
                  </div>
                  <div className="mb-2">
                    <label className="form-label mb-1">Teléfono</label>
                    <input className="form-control form-control-sm" value={form.telefono || ''}
                      onChange={e => setForm(f => ({ ...f, telefono: e.target.value }))} />
                  </div>
                  <div className="mb-2">
                    <label className="form-label mb-1">Mail</label>
                    <input type="email" className="form-control form-control-sm" value={form.mail || ''}
                      onChange={e => setForm(f => ({ ...f, mail: e.target.value }))} />
                  </div>
                </div>
                <div className="modal-footer py-2">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setModal(null)}>Cancelar</button>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>Guardar</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
