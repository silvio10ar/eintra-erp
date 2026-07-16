import { useState, useEffect, useCallback, Fragment } from 'react'
import api from '../../api/client'
import { puedeEscribir, getUser } from '../../store/authStore'
import FormGranallado   from './FormGranallado'
import FormPinturaBase  from './FormPinturaBase'
import FormEspesores    from './FormEspesores'
import FormSoldadura    from './FormSoldadura'
import FormCapacitacion from './FormCapacitacion'
import FormEPP          from './FormEPP'
import FormPackingList  from './FormPackingList'
import FormChapaID      from './FormChapaID'

const hoy = () => new Date().toISOString().slice(0, 10)
const fmtF = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—'

const BADGE_HR    = { 'En proceso': 'primary', 'Terminado': 'success', 'Despachado': 'info', 'Cancelado': 'secondary' }
const BADGE_ETAPA = { 'Pendiente': 'secondary', 'En proceso': 'primary', 'Completada': 'success', 'No aplica': 'light' }
const BADGE_NC    = { 'Abierta': 'danger', 'En proceso': 'warning', 'Cerrada': 'success' }
const ICON_ETAPA  = { 'Pendiente': 'circle', 'En proceso': 'hourglass-split', 'Completada': 'check-circle-fill', 'No aplica': 'dash-circle' }
const BORDER_ETAPA= { 'Pendiente': '#adb5bd', 'En proceso': '#0d6efd', 'Completada': '#198754', 'No aplica': '#dee2e6' }

const ESTADOS_HR   = ['En proceso', 'Terminado', 'Despachado', 'Cancelado']
const ESTADOS_ETAPA= ['Pendiente', 'En proceso', 'Completada', 'No aplica']
const ESTADOS_NC   = ['Abierta', 'En proceso', 'Cerrada']
const TIPOS_NC     = ['Producto', 'Proceso', 'Material', 'Proveedor', 'Documentación']
const TIPOS_INSP   = [
  { value: 'granallado',    label: 'Control Granallado (F21)'    },
  { value: 'pintura_base',  label: 'Control Pintura Base (F22)'  },
  { value: 'espesores',     label: 'Espesores de Pintura (F26)'  },
  { value: 'soldadura',     label: 'Verificación Soldadura (F34)' },
  { value: 'prueba_final',  label: 'Prueba Final (F27)'          },
  { value: 'control_final', label: 'Control Final (F44)'         },
  { value: 'otro',          label: 'Otro'                        },
]

const FORM_HR0   = { proyecto_id: '', descripcion: '', cliente_nombre: '', responsable: '', fecha_inicio: hoy(), fecha_fin_est: '', fecha_despacho: '', estado: 'En proceso', observaciones: '' }
const FORM_NC0   = { hoja_ruta_id: '', proyecto_id: '', fecha: hoy(), tipo: 'Producto', descripcion: '', causa: '', detectado_por: '', accion_correctiva: '', responsable: '', fecha_limite: '', fecha_cierre: '', estado: 'Abierta' }
const FORM_INS0  = { hoja_ruta_id: '', tipo: 'granallado', fecha: hoy(), inspector: '', resultado: 'Aprobado', observaciones: '' }

export default function Calidad() {
  const canWrite   = puedeEscribir('calidad')
  const user       = getUser()
  const userName   = user?.empleado_nombre || user?.nombre || ''

  const [tab, setTab]       = useState('hojas_ruta')
  const [subForm, setSubForm] = useState('form21')
  const [resumen, setRes] = useState({ hrEnProceso: 0, hrTerminado: 0, hrDespachado: 0, ncAbiertas: 0, ncEnProceso: 0, inspecciones: 0 })
  const [proyectos, setProy] = useState([])
  const [hojasList, setHojasList] = useState([])   // para combos en modales

  // ── Hojas de Ruta ──────────────────────────────────────────────────────────
  const [hojas, setHojas]       = useState([])
  const [loadH, setLoadH]       = useState(false)
  const [filtH, setFiltH]       = useState({ estado: '', buscar: '' })
  const [expanded, setExpanded] = useState(new Set())
  const [detalle, setDetalle]   = useState({})    // id → { etapas, nc, inspecciones }
  const [modalH, setModalH]     = useState(null)  // null | 'new' | { id, ...row }
  const [formH, setFormH]       = useState(FORM_HR0)
  const [savH, setSavH]         = useState(false)
  const [errH, setErrH]         = useState('')

  // ── No Conformidades ───────────────────────────────────────────────────────
  const [ncs, setNcs]       = useState([])
  const [loadN, setLoadN]   = useState(false)
  const [filtN, setFiltN]   = useState({ estado: '', tipo: '', buscar: '' })
  const [modalN, setModalN] = useState(null)  // null | 'new' | { id, ...row }
  const [formN, setFormN]   = useState(FORM_NC0)
  const [savN, setSavN]     = useState(false)
  const [errN, setErrN]     = useState('')

  // ── Inspecciones ──────────────────────────────────────────────────────────
  const [insps, setInsps]   = useState([])
  const [loadI, setLoadI]   = useState(false)
  const [modalI, setModalI] = useState(false)
  const [formI, setFormI]   = useState(FORM_INS0)
  const [savI, setSavI]     = useState(false)
  const [errI, setErrI]     = useState('')

  const cargarResumen = useCallback(() => {
    api.get('/calidad/resumen').then(r => setRes(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    cargarResumen()
    api.get('/calidad/proyectos-activos').then(r => setProy(r.data)).catch(() => {})
    api.get('/calidad/hojas-ruta').then(r => setHojasList(r.data)).catch(() => {})
  }, [cargarResumen])

  // ── Carga Hojas ────────────────────────────────────────────────────────────
  const cargarHojas = useCallback(() => {
    setLoadH(true)
    const p = new URLSearchParams()
    if (filtH.estado) p.set('estado', filtH.estado)
    if (filtH.buscar) p.set('buscar', filtH.buscar)
    api.get('/calidad/hojas-ruta?' + p).then(r => {
      setHojas(r.data)
      setHojasList(r.data)
    }).finally(() => setLoadH(false))
  }, [filtH])
  useEffect(() => { if (tab === 'hojas_ruta') cargarHojas() }, [tab, cargarHojas])

  // ── Carga NC ───────────────────────────────────────────────────────────────
  const cargarNC = useCallback(() => {
    setLoadN(true)
    const p = new URLSearchParams()
    if (filtN.estado) p.set('estado', filtN.estado)
    if (filtN.tipo)   p.set('tipo',   filtN.tipo)
    if (filtN.buscar) p.set('buscar', filtN.buscar)
    api.get('/calidad/no-conformidades?' + p).then(r => setNcs(r.data)).finally(() => setLoadN(false))
  }, [filtN])
  useEffect(() => { if (tab === 'no_conformidades') cargarNC() }, [tab, cargarNC])

  // ── Carga Inspecciones ─────────────────────────────────────────────────────
  const cargarInsps = useCallback(() => {
    setLoadI(true)
    api.get('/calidad/inspecciones').then(r => setInsps(r.data)).finally(() => setLoadI(false))
  }, [])
  useEffect(() => { if (tab === 'inspecciones') cargarInsps() }, [tab, cargarInsps])

  // ── Expand HR ─────────────────────────────────────────────────────────────
  const toggleExpand = (id) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
        if (!detalle[id]) {
          api.get(`/calidad/hojas-ruta/${id}`)
            .then(r => setDetalle(p => ({ ...p, [id]: r.data })))
            .catch(() => setDetalle(p => ({ ...p, [id]: { etapas: [], nc: [], inspecciones: [] } })))
        }
      }
      return next
    })
  }

  // ── Update etapa ──────────────────────────────────────────────────────────
  const updateEtapa = async (hrId, etapaId, campos) => {
    try {
      await api.put(`/calidad/hojas-ruta/${hrId}/etapas/${etapaId}`, campos)
      const r = await api.get(`/calidad/hojas-ruta/${hrId}`)
      setDetalle(prev => ({ ...prev, [hrId]: r.data }))
      cargarHojas()
      cargarResumen()
    } catch {}
  }

  // ── CRUD HR ────────────────────────────────────────────────────────────────
  const abrirNuevaHR = () => {
    setFormH({ ...FORM_HR0, responsable: userName })
    setModalH('new'); setErrH('')
  }
  const abrirEditHR = (h, e) => {
    e.stopPropagation()
    setFormH({ ...h })
    setModalH({ id: h.id }); setErrH('')
  }
  const saveHR = async () => {
    if (!formH.descripcion?.trim()) { setErrH('La descripción es requerida'); return }
    setSavH(true); setErrH('')
    try {
      if (modalH === 'new') {
        await api.post('/calidad/hojas-ruta', formH)
      } else {
        await api.put(`/calidad/hojas-ruta/${modalH.id}`, formH)
      }
      setModalH(null)
      cargarHojas()
      cargarResumen()
    } catch(e) {
      setErrH(e.response?.data?.error || 'Error al guardar')
    } finally { setSavH(false) }
  }
  const deleteHR = async (id, e) => {
    e.stopPropagation()
    if (!confirm('¿Eliminar esta Hoja de Ruta y todas sus etapas?')) return
    await api.delete(`/calidad/hojas-ruta/${id}`)
    cargarHojas()
    cargarResumen()
  }

  // ── CRUD NC ────────────────────────────────────────────────────────────────
  const abrirNuevaNc = () => {
    setFormN({ ...FORM_NC0, detectado_por: userName })
    setModalN('new'); setErrN('')
  }
  const abrirEditNc = (n) => {
    setFormN({ ...n })
    setModalN({ id: n.id }); setErrN('')
  }
  const saveNC = async () => {
    if (!formN.descripcion?.trim()) { setErrN('La descripción es requerida'); return }
    setSavN(true); setErrN('')
    try {
      if (modalN === 'new') {
        await api.post('/calidad/no-conformidades', formN)
      } else {
        await api.put(`/calidad/no-conformidades/${modalN.id}`, formN)
      }
      setModalN(null)
      cargarNC()
      cargarResumen()
    } catch(e) {
      setErrN(e.response?.data?.error || 'Error al guardar')
    } finally { setSavN(false) }
  }
  const deleteNC = async (id) => {
    if (!confirm('¿Eliminar esta No Conformidad?')) return
    await api.delete(`/calidad/no-conformidades/${id}`)
    cargarNC()
    cargarResumen()
  }

  // ── CRUD Inspecciones ──────────────────────────────────────────────────────
  const abrirNuevaInsp = () => {
    setFormI({ ...FORM_INS0, inspector: userName })
    setModalI(true); setErrI('')
  }
  const saveInsp = async () => {
    setSavI(true); setErrI('')
    try {
      await api.post('/calidad/inspecciones', formI)
      setModalI(false)
      cargarInsps()
    } catch(e) {
      setErrI(e.response?.data?.error || 'Error al guardar')
    } finally { setSavI(false) }
  }
  const deleteInsp = async (id) => {
    if (!confirm('¿Eliminar esta inspección?')) return
    await api.delete(`/calidad/inspecciones/${id}`)
    cargarInsps()
  }

  // ── KPI cards ──────────────────────────────────────────────────────────────
  const kpis = [
    { val: resumen.hrEnProceso, label: 'HR en proceso',    icon: 'file-earmark-text',   color: '#0d6efd', bg: 'bg-primary'  },
    { val: resumen.hrTerminado, label: 'HR terminadas',    icon: 'check2-circle',        color: '#198754', bg: 'bg-success'  },
    { val: resumen.ncAbiertas,  label: 'NC abiertas',      icon: 'exclamation-triangle', color: '#dc3545', bg: 'bg-danger'   },
    { val: resumen.ncEnProceso, label: 'NC en proceso',    icon: 'hourglass-split',      color: '#ffc107', bg: 'bg-warning'  },
  ]

  return (
    <div className="container-fluid py-3">
      {/* Header */}
      <div className="d-flex align-items-center mb-3 gap-2">
        <i className="bi bi-clipboard2-check fs-4 text-primary" />
        <h4 className="mb-0 fw-bold">Control de Calidad</h4>
      </div>

      {/* KPIs */}
      <div className="row g-3 mb-4">
        {kpis.map((k, i) => (
          <div key={i} className="col-6 col-md-3">
            <div className="card border-0 shadow-sm h-100" style={{ borderTop: `3px solid ${k.color}` }}>
              <div className="card-body d-flex align-items-center gap-3 py-3">
                <div className={`rounded-3 d-flex align-items-center justify-content-center ${k.bg} bg-opacity-10`} style={{ width: 48, height: 48 }}>
                  <i className={`bi bi-${k.icon} fs-5`} style={{ color: k.color }} />
                </div>
                <div>
                  <div className="fw-bold fs-3 lh-1">{k.val}</div>
                  <div className="text-muted" style={{ fontSize: '0.78rem', marginTop: 2 }}>{k.label}</div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Card con tabs */}
      <div className="card border-0 shadow-sm">
        <div className="card-header bg-white border-bottom px-3 pt-3 pb-0">
          <ul className="nav nav-tabs card-header-tabs">
            {[
              { key: 'hojas_ruta',        icon: 'file-earmark-text',  label: 'Hojas de Ruta'     },
              { key: 'no_conformidades',  icon: 'exclamation-diamond', label: 'No Conformidades'  },
              { key: 'inspecciones',      icon: 'clipboard2-check',   label: 'Inspecciones'      },
              { key: 'formularios',       icon: 'journal-text',        label: 'Formularios'       },
            ].map(t => (
              <li key={t.key} className="nav-item">
                <button className={`nav-link${tab === t.key ? ' active' : ''}`} onClick={() => setTab(t.key)}>
                  <i className={`bi bi-${t.icon} me-1`} />{t.label}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="card-body p-0">

          {/* ════ HOJAS DE RUTA ════════════════════════════════════════════════ */}
          {tab === 'hojas_ruta' && (
            <div className="p-3">
              <div className="d-flex flex-wrap gap-2 mb-3">
                <select className="form-select form-select-sm" style={{ width: 165 }} value={filtH.estado} onChange={e => setFiltH(p => ({ ...p, estado: e.target.value }))}>
                  <option value="">Todos los estados</option>
                  {ESTADOS_HR.map(e => <option key={e}>{e}</option>)}
                </select>
                <input className="form-control form-control-sm" style={{ width: 220 }} placeholder="Buscar número, descripción..." value={filtH.buscar} onChange={e => setFiltH(p => ({ ...p, buscar: e.target.value }))} onKeyDown={e => e.key === 'Enter' && cargarHojas()} />
                <button className="btn btn-sm btn-outline-secondary" onClick={cargarHojas}><i className="bi bi-arrow-clockwise" /></button>
                <div className="ms-auto">
                  {canWrite && (
                    <button className="btn btn-sm btn-primary" onClick={abrirNuevaHR}>
                      <i className="bi bi-plus-lg me-1" />Nueva Hoja de Ruta
                    </button>
                  )}
                </div>
              </div>

              {loadH ? (
                <div className="text-center py-5 text-muted"><div className="spinner-border spinner-border-sm me-2" />Cargando...</div>
              ) : hojas.length === 0 ? (
                <div className="text-center py-5 text-muted">
                  <i className="bi bi-inbox fs-1 d-block mb-2 opacity-25" />Sin hojas de ruta
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-hover table-sm align-middle mb-0">
                    <thead className="table-light">
                      <tr>
                        <th style={{ width: 28 }} />
                        <th>Número</th>
                        <th>Descripción</th>
                        <th>Cliente</th>
                        <th>Inicio</th>
                        <th>Fin est.</th>
                        <th style={{ minWidth: 130 }}>Progreso etapas</th>
                        <th>Estado</th>
                        <th style={{ width: 70 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {hojas.map(h => (
                        <Fragment key={h.id}>
                          <tr style={{ cursor: 'pointer' }} onClick={() => toggleExpand(h.id)}>
                            <td className="ps-2">
                              <i className={`bi bi-chevron-${expanded.has(h.id) ? 'down' : 'right'} text-muted`} style={{ fontSize: '0.8rem' }} />
                            </td>
                            <td className="fw-semibold text-primary" style={{ whiteSpace: 'nowrap' }}>{h.numero}</td>
                            <td>{h.descripcion}</td>
                            <td>{h.cliente_nombre || '—'}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>{fmtF(h.fecha_inicio)}</td>
                            <td style={{ whiteSpace: 'nowrap' }}>{fmtF(h.fecha_fin_est)}</td>
                            <td>
                              <div className="d-flex align-items-center gap-2">
                                <div className="progress flex-grow-1" style={{ height: 6 }}>
                                  <div className="progress-bar bg-success" style={{ width: `${h.etapas_total ? Math.round(h.etapas_comp / h.etapas_total * 100) : 0}%` }} />
                                </div>
                                <small className="text-muted" style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{h.etapas_comp}/{h.etapas_total}</small>
                              </div>
                              {h.nc_abiertas > 0 && (
                                <div><small className="text-danger"><i className="bi bi-exclamation-circle me-1" />{h.nc_abiertas} NC abierta{h.nc_abiertas > 1 ? 's' : ''}</small></div>
                              )}
                            </td>
                            <td>
                              <span className={`badge bg-${BADGE_HR[h.estado] || 'secondary'}`}>{h.estado}</span>
                            </td>
                            <td onClick={e => e.stopPropagation()}>
                              {canWrite && (
                                <div className="d-flex gap-1">
                                  <button className="btn btn-link btn-sm p-0 text-primary" title="Editar" onClick={e => abrirEditHR(h, e)}><i className="bi bi-pencil" /></button>
                                  <button className="btn btn-link btn-sm p-0 text-danger" title="Eliminar" onClick={e => deleteHR(h.id, e)}><i className="bi bi-trash" /></button>
                                </div>
                              )}
                            </td>
                          </tr>
                          {expanded.has(h.id) && (
                            <tr className="table-light">
                              <td colSpan={9} className="px-3 py-3">
                                {!detalle[h.id] ? (
                                  <span className="text-muted"><div className="spinner-border spinner-border-sm me-2" />Cargando etapas...</span>
                                ) : (
                                  <EtapasGrid
                                    etapas={detalle[h.id].etapas || []}
                                    canWrite={canWrite}
                                    onGuardar={(etapaId, campos) => updateEtapa(h.id, etapaId, campos)}
                                  />
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
            </div>
          )}

          {/* ════ NO CONFORMIDADES ════════════════════════════════════════════ */}
          {tab === 'no_conformidades' && (
            <div className="p-3">
              <div className="d-flex flex-wrap gap-2 mb-3">
                <select className="form-select form-select-sm" style={{ width: 140 }} value={filtN.estado} onChange={e => setFiltN(p => ({ ...p, estado: e.target.value }))}>
                  <option value="">Todos los estados</option>
                  {ESTADOS_NC.map(e => <option key={e}>{e}</option>)}
                </select>
                <select className="form-select form-select-sm" style={{ width: 145 }} value={filtN.tipo} onChange={e => setFiltN(p => ({ ...p, tipo: e.target.value }))}>
                  <option value="">Todos los tipos</option>
                  {TIPOS_NC.map(t => <option key={t}>{t}</option>)}
                </select>
                <input className="form-control form-control-sm" style={{ width: 210 }} placeholder="Buscar..." value={filtN.buscar} onChange={e => setFiltN(p => ({ ...p, buscar: e.target.value }))} onKeyDown={e => e.key === 'Enter' && cargarNC()} />
                <button className="btn btn-sm btn-outline-secondary" onClick={cargarNC}><i className="bi bi-arrow-clockwise" /></button>
                <div className="ms-auto">
                  {canWrite && (
                    <button className="btn btn-sm btn-danger" onClick={abrirNuevaNc}>
                      <i className="bi bi-plus-lg me-1" />Nueva NC
                    </button>
                  )}
                </div>
              </div>

              {loadN ? (
                <div className="text-center py-5 text-muted"><div className="spinner-border spinner-border-sm me-2" />Cargando...</div>
              ) : ncs.length === 0 ? (
                <div className="text-center py-5 text-muted">
                  <i className="bi bi-inbox fs-1 d-block mb-2 opacity-25" />Sin no conformidades
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-hover table-sm align-middle mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>Número</th>
                        <th>Fecha</th>
                        <th>HR vinculada</th>
                        <th>Tipo</th>
                        <th>Descripción</th>
                        <th>Detectado por</th>
                        <th>Responsable</th>
                        <th>Vence</th>
                        <th>Estado</th>
                        <th style={{ width: 70 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {ncs.map(n => (
                        <tr key={n.id}>
                          <td className="fw-semibold text-danger" style={{ whiteSpace: 'nowrap' }}>{n.numero}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>{fmtF(n.fecha)}</td>
                          <td>{n.hr_numero || '—'}</td>
                          <td><span className="badge bg-secondary">{n.tipo}</span></td>
                          <td style={{ maxWidth: 250 }}>{n.descripcion}</td>
                          <td>{n.detectado_por || '—'}</td>
                          <td>{n.responsable || '—'}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>{fmtF(n.fecha_limite)}</td>
                          <td><span className={`badge bg-${BADGE_NC[n.estado] || 'secondary'}`}>{n.estado}</span></td>
                          <td>
                            {canWrite && (
                              <div className="d-flex gap-1">
                                <button className="btn btn-link btn-sm p-0 text-primary" onClick={() => abrirEditNc(n)}><i className="bi bi-pencil" /></button>
                                <button className="btn btn-link btn-sm p-0 text-danger" onClick={() => deleteNC(n.id)}><i className="bi bi-trash" /></button>
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
          )}

          {/* ════ INSPECCIONES ════════════════════════════════════════════════ */}
          {tab === 'inspecciones' && (
            <div className="p-3">
              <div className="d-flex gap-2 mb-3">
                <button className="btn btn-sm btn-outline-secondary" onClick={cargarInsps}><i className="bi bi-arrow-clockwise" /></button>
                <div className="ms-auto">
                  {canWrite && (
                    <button className="btn btn-sm btn-success" onClick={abrirNuevaInsp}>
                      <i className="bi bi-plus-lg me-1" />Nueva Inspección
                    </button>
                  )}
                </div>
              </div>

              {loadI ? (
                <div className="text-center py-5 text-muted"><div className="spinner-border spinner-border-sm me-2" />Cargando...</div>
              ) : insps.length === 0 ? (
                <div className="text-center py-5 text-muted">
                  <i className="bi bi-inbox fs-1 d-block mb-2 opacity-25" />Sin inspecciones registradas
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table table-hover table-sm align-middle mb-0">
                    <thead className="table-light">
                      <tr>
                        <th>Hoja de Ruta</th>
                        <th>Tipo</th>
                        <th>Fecha</th>
                        <th>Inspector</th>
                        <th>Resultado</th>
                        <th>Observaciones</th>
                        <th style={{ width: 50 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {insps.map(i => (
                        <tr key={i.id}>
                          <td>
                            <div className="fw-semibold">{i.hr_numero || '—'}</div>
                            {i.hr_descripcion && <small className="text-muted">{i.hr_descripcion}</small>}
                          </td>
                          <td><span className="badge bg-secondary">{TIPOS_INSP.find(t => t.value === i.tipo)?.label || i.tipo}</span></td>
                          <td style={{ whiteSpace: 'nowrap' }}>{fmtF(i.fecha)}</td>
                          <td>{i.inspector || '—'}</td>
                          <td>
                            <span className={`badge bg-${i.resultado === 'Aprobado' ? 'success' : i.resultado === 'Rechazado' ? 'danger' : 'warning'}`}>
                              {i.resultado}
                            </span>
                          </td>
                          <td style={{ maxWidth: 250 }}><small>{i.observaciones || '—'}</small></td>
                          <td>
                            {canWrite && (
                              <button className="btn btn-link btn-sm p-0 text-danger" onClick={() => deleteInsp(i.id)}><i className="bi bi-trash" /></button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ════ FORMULARIOS ════════════════════════════════════════════════ */}
          {tab === 'formularios' && (
            <div>
              <div className="border-bottom px-3 pt-2 pb-0 bg-light">
                <div className="d-flex flex-wrap gap-1">
                  {[
                    { key: 'form21',   label: 'F21 Granallado',   icon: 'droplet'      },
                    { key: 'form22',   label: 'F22 Pintura Base', icon: 'brush'        },
                    { key: 'form26',   label: 'F26 Espesores',    icon: 'layers'       },
                    { key: 'form34',   label: 'F34 Soldadura',    icon: 'wrench'       },
                    { key: 'form10',   label: 'F10 Capacitación', icon: 'mortarboard'  },
                    { key: 'epp',      label: 'EPP',              icon: 'shield-check' },
                    { key: 'packing',  label: 'Packing List',     icon: 'box-seam'     },
                    { key: 'form37',   label: 'F37 Chapa ID',     icon: 'tag'          },
                  ].map(f => (
                    <button key={f.key}
                      className={`btn btn-sm mb-2 ${subForm === f.key ? 'btn-primary' : 'btn-outline-secondary'}`}
                      style={{ fontSize: '0.78rem', whiteSpace: 'nowrap' }}
                      onClick={() => setSubForm(f.key)}>
                      <i className={`bi bi-${f.icon} me-1`} />{f.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="p-3">
                {subForm === 'form21'  && <FormGranallado  hojasList={hojasList} canWrite={canWrite} />}
                {subForm === 'form22'  && <FormPinturaBase hojasList={hojasList} canWrite={canWrite} />}
                {subForm === 'form26'  && <FormEspesores   hojasList={hojasList} canWrite={canWrite} />}
                {subForm === 'form34'  && <FormSoldadura   hojasList={hojasList} canWrite={canWrite} />}
                {subForm === 'form10'  && <FormCapacitacion canWrite={canWrite} />}
                {subForm === 'epp'     && <FormEPP         canWrite={canWrite} />}
                {subForm === 'packing' && <FormPackingList hojasList={hojasList} canWrite={canWrite} />}
                {subForm === 'form37'  && <FormChapaID     hojasList={hojasList} canWrite={canWrite} />}
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ═══ MODAL: Hoja de Ruta ══════════════════════════════════════════════ */}
      {modalH !== null && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className="bi bi-file-earmark-text text-primary me-2" />
                  {modalH === 'new' ? 'Nueva Hoja de Ruta' : 'Editar Hoja de Ruta'}
                </h5>
                <button className="btn-close" onClick={() => setModalH(null)} />
              </div>
              <div className="modal-body">
                {errH && <div className="alert alert-danger py-2">{errH}</div>}
                <div className="row g-3">
                  <div className="col-12">
                    <label className="form-label fw-semibold">Descripción del trabajo <span className="text-danger">*</span></label>
                    <input className="form-control" placeholder="Ej: Tanque 5000L acero inox, Ecualizador GRABYA..." value={formH.descripcion} onChange={e => setFormH(p => ({ ...p, descripcion: e.target.value }))} />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label fw-semibold">Proyecto</label>
                    <select className="form-select" value={formH.proyecto_id || ''} onChange={e => {
                      const pr = proyectos.find(x => String(x.id) === e.target.value)
                      setFormH(prev => ({ ...prev, proyecto_id: e.target.value, cliente_nombre: pr?.cliente_nombre || prev.cliente_nombre }))
                    }}>
                      <option value="">Sin proyecto</option>
                      {proyectos.map(p => <option key={p.id} value={p.id}>{p.codigo} – {p.nombre}</option>)}
                    </select>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label fw-semibold">Cliente</label>
                    <input className="form-control" value={formH.cliente_nombre || ''} onChange={e => setFormH(p => ({ ...p, cliente_nombre: e.target.value }))} />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label fw-semibold">Responsable</label>
                    <input className="form-control" value={formH.responsable || ''} onChange={e => setFormH(p => ({ ...p, responsable: e.target.value }))} />
                  </div>
                  {modalH !== 'new' && (
                    <div className="col-md-6">
                      <label className="form-label fw-semibold">Estado</label>
                      <select className="form-select" value={formH.estado || 'En proceso'} onChange={e => setFormH(p => ({ ...p, estado: e.target.value }))}>
                        {ESTADOS_HR.map(e => <option key={e}>{e}</option>)}
                      </select>
                    </div>
                  )}
                  <div className="col-md-4">
                    <label className="form-label fw-semibold">Fecha inicio</label>
                    <input type="date" className="form-control" value={formH.fecha_inicio || ''} onChange={e => setFormH(p => ({ ...p, fecha_inicio: e.target.value }))} />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label fw-semibold">Fecha fin estimada</label>
                    <input type="date" className="form-control" value={formH.fecha_fin_est || ''} onChange={e => setFormH(p => ({ ...p, fecha_fin_est: e.target.value }))} />
                  </div>
                  {modalH !== 'new' && (
                    <div className="col-md-4">
                      <label className="form-label fw-semibold">Fecha despacho</label>
                      <input type="date" className="form-control" value={formH.fecha_despacho || ''} onChange={e => setFormH(p => ({ ...p, fecha_despacho: e.target.value }))} />
                    </div>
                  )}
                  <div className="col-12">
                    <label className="form-label fw-semibold">Observaciones</label>
                    <textarea className="form-control" rows={2} value={formH.observaciones || ''} onChange={e => setFormH(p => ({ ...p, observaciones: e.target.value }))} />
                  </div>
                  {modalH === 'new' && (
                    <div className="col-12">
                      <div className="alert alert-info py-2 mb-0" style={{ fontSize: '0.85rem' }}>
                        <i className="bi bi-info-circle me-1" />
                        Se crearán automáticamente <strong>9 etapas estándar</strong>: Corte, Armado y soldadura, Granallado, Pintura base, Pintura final, Montaje, Prueba funcional, Control final, Despacho.
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setModalH(null)}>Cancelar</button>
                <button className="btn btn-primary" onClick={saveHR} disabled={savH}>
                  {savH ? <><div className="spinner-border spinner-border-sm me-1" />Guardando...</> : <><i className="bi bi-check-lg me-1" />Guardar</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MODAL: No Conformidad ════════════════════════════════════════════ */}
      {modalN !== null && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className="bi bi-exclamation-diamond text-danger me-2" />
                  {modalN === 'new' ? 'Nueva No Conformidad' : 'Editar No Conformidad'}
                </h5>
                <button className="btn-close" onClick={() => setModalN(null)} />
              </div>
              <div className="modal-body">
                {errN && <div className="alert alert-danger py-2">{errN}</div>}
                <div className="row g-3">
                  <div className="col-md-4">
                    <label className="form-label fw-semibold">Fecha</label>
                    <input type="date" className="form-control" value={formN.fecha || ''} onChange={e => setFormN(p => ({ ...p, fecha: e.target.value }))} />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label fw-semibold">Tipo</label>
                    <select className="form-select" value={formN.tipo || 'Producto'} onChange={e => setFormN(p => ({ ...p, tipo: e.target.value }))}>
                      {TIPOS_NC.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label fw-semibold">Estado</label>
                    <select className="form-select" value={formN.estado || 'Abierta'} onChange={e => setFormN(p => ({ ...p, estado: e.target.value }))}>
                      {ESTADOS_NC.map(e => <option key={e}>{e}</option>)}
                    </select>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label fw-semibold">Hoja de Ruta asociada</label>
                    <select className="form-select" value={formN.hoja_ruta_id || ''} onChange={e => setFormN(p => ({ ...p, hoja_ruta_id: e.target.value }))}>
                      <option value="">Sin HR asociada</option>
                      {hojasList.map(h => <option key={h.id} value={h.id}>{h.numero} – {h.descripcion}</option>)}
                    </select>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label fw-semibold">Proyecto</label>
                    <select className="form-select" value={formN.proyecto_id || ''} onChange={e => setFormN(p => ({ ...p, proyecto_id: e.target.value }))}>
                      <option value="">Sin proyecto</option>
                      {proyectos.map(p => <option key={p.id} value={p.id}>{p.codigo} – {p.nombre}</option>)}
                    </select>
                  </div>
                  <div className="col-12">
                    <label className="form-label fw-semibold">Descripción del hallazgo <span className="text-danger">*</span></label>
                    <textarea className="form-control" rows={3} placeholder="Describir detalladamente el defecto o incumplimiento detectado..." value={formN.descripcion || ''} onChange={e => setFormN(p => ({ ...p, descripcion: e.target.value }))} />
                  </div>
                  <div className="col-12">
                    <label className="form-label fw-semibold">Causa raíz</label>
                    <textarea className="form-control" rows={2} placeholder="¿Por qué ocurrió?" value={formN.causa || ''} onChange={e => setFormN(p => ({ ...p, causa: e.target.value }))} />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label fw-semibold">Detectado por</label>
                    <input className="form-control" value={formN.detectado_por || ''} onChange={e => setFormN(p => ({ ...p, detectado_por: e.target.value }))} />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label fw-semibold">Responsable corrección</label>
                    <input className="form-control" value={formN.responsable || ''} onChange={e => setFormN(p => ({ ...p, responsable: e.target.value }))} />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label fw-semibold">Fecha límite</label>
                    <input type="date" className="form-control" value={formN.fecha_limite || ''} onChange={e => setFormN(p => ({ ...p, fecha_limite: e.target.value }))} />
                  </div>
                  <div className="col-12">
                    <label className="form-label fw-semibold">Acción correctiva</label>
                    <textarea className="form-control" rows={2} placeholder="Qué se hará para corregir y prevenir la recurrencia..." value={formN.accion_correctiva || ''} onChange={e => setFormN(p => ({ ...p, accion_correctiva: e.target.value }))} />
                  </div>
                  {formN.estado === 'Cerrada' && (
                    <div className="col-md-4">
                      <label className="form-label fw-semibold">Fecha de cierre</label>
                      <input type="date" className="form-control" value={formN.fecha_cierre || ''} onChange={e => setFormN(p => ({ ...p, fecha_cierre: e.target.value }))} />
                    </div>
                  )}
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setModalN(null)}>Cancelar</button>
                <button className="btn btn-danger" onClick={saveNC} disabled={savN}>
                  {savN ? <><div className="spinner-border spinner-border-sm me-1" />Guardando...</> : <><i className="bi bi-check-lg me-1" />Guardar</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MODAL: Inspección ════════════════════════════════════════════════ */}
      {modalI && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className="bi bi-clipboard2-check text-success me-2" />
                  Nueva Inspección
                </h5>
                <button className="btn-close" onClick={() => setModalI(false)} />
              </div>
              <div className="modal-body">
                {errI && <div className="alert alert-danger py-2">{errI}</div>}
                <div className="row g-3">
                  <div className="col-md-6">
                    <label className="form-label fw-semibold">Hoja de Ruta</label>
                    <select className="form-select" value={formI.hoja_ruta_id || ''} onChange={e => setFormI(p => ({ ...p, hoja_ruta_id: e.target.value }))}>
                      <option value="">Sin HR asociada</option>
                      {hojasList.map(h => <option key={h.id} value={h.id}>{h.numero} – {h.descripcion}</option>)}
                    </select>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label fw-semibold">Tipo de inspección <span className="text-danger">*</span></label>
                    <select className="form-select" value={formI.tipo} onChange={e => setFormI(p => ({ ...p, tipo: e.target.value }))}>
                      {TIPOS_INSP.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label fw-semibold">Fecha</label>
                    <input type="date" className="form-control" value={formI.fecha} onChange={e => setFormI(p => ({ ...p, fecha: e.target.value }))} />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label fw-semibold">Inspector</label>
                    <input className="form-control" value={formI.inspector || ''} onChange={e => setFormI(p => ({ ...p, inspector: e.target.value }))} />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label fw-semibold">Resultado</label>
                    <select className="form-select" value={formI.resultado} onChange={e => setFormI(p => ({ ...p, resultado: e.target.value }))}>
                      {['Aprobado', 'Rechazado', 'Observado'].map(r => <option key={r}>{r}</option>)}
                    </select>
                  </div>
                  <div className="col-12">
                    <label className="form-label fw-semibold">Observaciones / Datos registrados</label>
                    <textarea className="form-control" rows={5} placeholder="Registrar mediciones, valores obtenidos, normas aplicadas, condiciones ambientales, puntos inspeccionados..." value={formI.observaciones || ''} onChange={e => setFormI(p => ({ ...p, observaciones: e.target.value }))} />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary" onClick={() => setModalI(false)}>Cancelar</button>
                <button className="btn btn-success" onClick={saveInsp} disabled={savI}>
                  {savI ? <><div className="spinner-border spinner-border-sm me-1" />Guardando...</> : <><i className="bi bi-check-lg me-1" />Guardar</>}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const EST_DOT = { 'Pendiente': '#adb5bd', 'En proceso': '#0d6efd', 'Completada': '#198754', 'No aplica': '#ced4da' }

function EtapasGrid({ etapas, canWrite, onGuardar }) {
  const [local, setLocal] = useState({})

  if (!etapas?.length) return (
    <div className="text-muted py-2" style={{ fontSize: '0.85rem' }}>
      <i className="bi bi-info-circle me-1" />Sin etapas registradas
    </div>
  )

  const get = (e, k) => local[e.id]?.[k] ?? e[k] ?? ''
  const set = (id, k, v) => setLocal(p => ({ ...p, [id]: { ...p[id], [k]: v } }))

  const guardar = (e, patch = {}) => onGuardar(e.id, {
    estado:        (patch.estado        ?? get(e, 'estado'))       || 'Pendiente',
    responsable:   patch.responsable   ?? get(e, 'responsable'),
    fecha_prog:    patch.fecha_prog    ?? get(e, 'fecha_prog'),
    fecha_real:    patch.fecha_real    ?? get(e, 'fecha_real'),
    observaciones: patch.observaciones ?? get(e, 'observaciones'),
  })

  return (
    <div>
      <div className="fw-semibold text-muted mb-2" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        <i className="bi bi-list-check me-1" />Etapas de producción · {etapas.length} pasos
      </div>
      <div className="table-responsive">
        <table className="table table-sm table-bordered align-middle mb-0" style={{ fontSize: '0.82rem' }}>
          <thead className="table-light">
            <tr>
              <th style={{ width: 36, textAlign: 'center' }}>#</th>
              <th>Descripción</th>
              <th style={{ width: 150 }}>Responsable</th>
              <th style={{ width: 130 }}>F. Programada</th>
              <th style={{ width: 130 }}>F. Real</th>
              <th style={{ width: 150 }}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {etapas.map(e => {
              const est = get(e, 'estado') || 'Pendiente'
              return (
                <tr key={e.id}>
                  <td className="text-center text-muted fw-semibold">{e.orden}</td>
                  <td style={{ lineHeight: 1.35 }}>
                    <div>{e.nombre}</div>
                    {e.criterios && <div className="text-muted" style={{ fontSize: '0.74rem', marginTop: 2 }}><i className="bi bi-check2-circle me-1" />{e.criterios}</div>}
                    {e.medicion  && <div className="text-muted" style={{ fontSize: '0.72rem' }}><i className="bi bi-file-earmark-text me-1" />{e.medicion}</div>}
                  </td>
                  <td>
                    {canWrite ? (
                      <input className="form-control form-control-sm border-0 px-1"
                        style={{ background: 'transparent' }}
                        value={get(e, 'responsable')}
                        onChange={ev => set(e.id, 'responsable', ev.target.value)}
                        onBlur={() => guardar(e)}
                        placeholder="—" />
                    ) : (get(e, 'responsable') || '—')}
                  </td>
                  <td>
                    {canWrite ? (
                      <input type="date" className="form-control form-control-sm border-0 px-1"
                        style={{ background: 'transparent', fontSize: '0.78rem' }}
                        value={get(e, 'fecha_prog')}
                        onChange={ev => { set(e.id, 'fecha_prog', ev.target.value); guardar(e, { fecha_prog: ev.target.value }) }} />
                    ) : fmtF(get(e, 'fecha_prog'))}
                  </td>
                  <td>
                    {canWrite ? (
                      <input type="date" className="form-control form-control-sm border-0 px-1"
                        style={{ background: 'transparent', fontSize: '0.78rem' }}
                        value={get(e, 'fecha_real')}
                        onChange={ev => { set(e.id, 'fecha_real', ev.target.value); guardar(e, { fecha_real: ev.target.value }) }} />
                    ) : fmtF(get(e, 'fecha_real'))}
                  </td>
                  <td>
                    {canWrite ? (
                      <div className="d-flex align-items-center gap-1">
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: EST_DOT[est], flexShrink: 0 }} />
                        <select className="form-select form-select-sm border-0 px-1 flex-grow-1"
                          style={{ background: 'transparent', fontSize: '0.8rem' }}
                          value={est}
                          onChange={ev => { set(e.id, 'estado', ev.target.value); guardar(e, { estado: ev.target.value }) }}>
                          {ESTADOS_ETAPA.map(s => <option key={s}>{s}</option>)}
                        </select>
                      </div>
                    ) : (
                      <span className={`badge bg-${BADGE_ETAPA[est] || 'secondary'}`} style={{ fontSize: '0.72rem' }}>{est}</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
