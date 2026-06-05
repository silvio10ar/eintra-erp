import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'
import { puedeEscribir } from '../../store/authStore'

const TIPOS_ACTIVO  = ['Maquinaria','Infraestructura','Herramienta','Vehículo']
const ESTADOS_ACTIVO = ['Activo','En mantenimiento','Dado de baja']
const TIPOS_OT      = ['Correctivo','Preventivo']
const PRIORIDADES   = [{ v:'Normal', c:'secondary' },{ v:'Alta', c:'warning' },{ v:'Urgente', c:'danger' }]
const ESTADOS_OT    = [{ v:'Pendiente', c:'secondary' },{ v:'En proceso', c:'primary' },{ v:'Completada', c:'success' },{ v:'Cancelada', c:'danger' }]
const FRECUENCIAS   = ['Diario','Semanal','Mensual','Trimestral','Semestral','Anual']
const TIPOS_COSTO   = ['Repuesto','Mano de Obra','Servicio','Otro']

const fmtN = n => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(n ?? 0)
const fmtF = iso => iso ? iso.slice(0,10).split('-').reverse().join('/') : '—'
const hoy  = () => new Date().toISOString().slice(0,10)
const diasHasta = iso => { if (!iso) return null; const d = Math.round((new Date(iso)-new Date())/(1000*60*60*24)); return d }

const FORM_ACTIVO = { codigo:'', nombre:'', tipo:'Maquinaria', marca:'', modelo:'', n_serie:'', ubicacion:'', fecha_adq:'', estado:'Activo', observaciones:'' }
const FORM_OT = { activo_id:'', activo_nombre:'', tipo:'Correctivo', prioridad:'Normal', fecha_apertura:hoy(), fecha_prog:'', descripcion:'', ejecutor_tipo:'interno', ejecutor_nombre:'', observaciones:'', tareas:[] }
const FORM_PLAN = { activo_id:'', activo_nombre:'', descripcion:'', frecuencia:'Mensual', proxima_fecha:'' }
const FORM_COSTO = { tipo:'Repuesto', descripcion:'', cantidad:1, precio_unit:0 }

export default function Mantenimiento() {
  const canWrite = puedeEscribir('mantenimiento')
  const [tab, setTab] = useState('ot')

  /* ── Activos ────────────────────────────────────────────────────── */
  const [activos, setActivos]     = useState([])
  const [buscarA, setBuscarA]     = useState('')
  const [filTipoA, setFilTipoA]   = useState('')
  const [filEstA, setFilEstA]     = useState('')
  const [loadA, setLoadA]         = useState(false)
  const [modalA, setModalA]       = useState(null)
  const [formA, setFormA]         = useState(FORM_ACTIVO)
  const [savA, setSavA]           = useState(false)
  const [errA, setErrA]           = useState('')

  /* ── OT ─────────────────────────────────────────────────────────── */
  const [ots, setOts]             = useState([])
  const [totalOT, setTotalOT]     = useState(0)
  const [pageOT, setPageOT]       = useState(1)
  const [loadOT, setLoadOT]       = useState(true)
  const [filtOT, setFiltOT]       = useState({ estado:'', tipo:'', prioridad:'', desde:'', hasta:'' })
  const [modalDetOT, setModalDetOT] = useState(null)
  const [loadDet, setLoadDet]     = useState(false)
  const [modalFormOT, setModalFormOT] = useState(null)
  const [formOT, setFormOT]       = useState(FORM_OT)
  const [savOT, setSavOT]         = useState(false)
  const [errOT, setErrOT]         = useState('')
  const [nuevaTarea, setNuevaTarea] = useState('')
  const [formCosto, setFormCosto] = useState(FORM_COSTO)
  const [savCosto, setSavCosto]   = useState(false)
  const [sugsA, setSugsA]         = useState([])

  /* ── Plan ───────────────────────────────────────────────────────── */
  const [planes, setPlanes]       = useState([])
  const [loadPlan, setLoadPlan]   = useState(false)
  const [modalPlan, setModalPlan] = useState(null)
  const [formPlan, setFormPlan]   = useState(FORM_PLAN)
  const [savPlan, setSavPlan]     = useState(false)
  const [errPlan, setErrPlan]     = useState('')
  const [sugsAP, setSugsAP]       = useState([])

  /* ── Cargar activos ─────────────────────────────────────────────── */
  const cargarActivos = useCallback(() => {
    setLoadA(true)
    api.get('/mantenimiento/activos', { params: { buscar: buscarA||undefined, tipo: filTipoA||undefined, estado: filEstA||undefined } })
      .then(r => setActivos(r.data)).finally(() => setLoadA(false))
  }, [buscarA, filTipoA, filEstA])

  useEffect(() => { if (tab === 'activos') cargarActivos() }, [cargarActivos, tab])

  useEffect(() => {
    api.get('/mantenimiento/activos').then(r => setActivos(r.data)).catch(() => {})
  }, [])

  /* ── Cargar OT ──────────────────────────────────────────────────── */
  const cargarOT = useCallback(() => {
    setLoadOT(true)
    const p = { page: pageOT, limit: 50 }
    if (filtOT.estado)    p.estado    = filtOT.estado
    if (filtOT.tipo)      p.tipo      = filtOT.tipo
    if (filtOT.prioridad) p.prioridad = filtOT.prioridad
    if (filtOT.desde)     p.desde     = filtOT.desde
    if (filtOT.hasta)     p.hasta     = filtOT.hasta
    api.get('/mantenimiento/ot', { params: p })
      .then(r => { setOts(r.data.datos); setTotalOT(r.data.total) })
      .finally(() => setLoadOT(false))
  }, [pageOT, filtOT])

  useEffect(() => { if (tab === 'ot') cargarOT() }, [cargarOT, tab])

  /* ── Cargar Plan ────────────────────────────────────────────────── */
  const cargarPlan = useCallback(() => {
    setLoadPlan(true)
    api.get('/mantenimiento/plan').then(r => setPlanes(r.data)).finally(() => setLoadPlan(false))
  }, [])

  useEffect(() => { if (tab === 'plan') cargarPlan() }, [cargarPlan, tab])

  /* ── Detalle OT ─────────────────────────────────────────────────── */
  const verOT = id => {
    setLoadDet(true); setModalDetOT(null)
    api.get(`/mantenimiento/ot/${id}`).then(r => setModalDetOT(r.data)).finally(() => setLoadDet(false))
  }

  /* ── Completar tarea ────────────────────────────────────────────── */
  const toggleTarea = async (tarea) => {
    const nuevoEstado = tarea.estado === 'Completada' ? 'Pendiente' : 'Completada'
    await api.patch(`/mantenimiento/ot/${modalDetOT.id}/tareas/${tarea.id}`, { estado: nuevoEstado })
    const r = await api.get(`/mantenimiento/ot/${modalDetOT.id}`)
    setModalDetOT(r.data)
  }

  /* ── Agregar costo ──────────────────────────────────────────────── */
  const agregarCosto = async e => {
    e.preventDefault(); setSavCosto(true)
    try {
      await api.post(`/mantenimiento/ot/${modalDetOT.id}/costos`, formCosto)
      const r = await api.get(`/mantenimiento/ot/${modalDetOT.id}`)
      setModalDetOT(r.data); setFormCosto(FORM_COSTO)
    } finally { setSavCosto(false) }
  }

  const eliminarCosto = async cid => {
    await api.delete(`/mantenimiento/ot/${modalDetOT.id}/costos/${cid}`)
    const r = await api.get(`/mantenimiento/ot/${modalDetOT.id}`)
    setModalDetOT(r.data)
  }

  /* ── Cambiar estado OT ──────────────────────────────────────────── */
  const cambiarEstado = async (ot, nuevoEstado) => {
    const body = { estado: nuevoEstado }
    if (nuevoEstado === 'Completada') body.fecha_cierre = hoy()
    await api.put(`/mantenimiento/ot/${ot.id}`, body)
    verOT(ot.id); cargarOT()
  }

  /* ── Form OT ────────────────────────────────────────────────────── */
  const abrirNuevaOT = () => {
    setFormOT({ ...FORM_OT, fecha_apertura: hoy(), tareas: [] })
    setErrOT(''); setSugsA([]); setNuevaTarea(''); setModalFormOT('nuevo')
  }

  const abrirEditarOT = ot => {
    setFormOT({
      activo_id: ot.activo_id||'', activo_nombre: ot.activo_nombre||'',
      tipo: ot.tipo, prioridad: ot.prioridad, fecha_apertura: ot.fecha_apertura,
      fecha_prog: ot.fecha_prog||'', descripcion: ot.descripcion,
      ejecutor_tipo: ot.ejecutor_tipo||'interno', ejecutor_nombre: ot.ejecutor_nombre||'',
      observaciones: ot.observaciones||'',
      tareas: (ot.tareas||[]).map(t => ({ ...t })),
    })
    setErrOT(''); setSugsA([]); setNuevaTarea(''); setModalFormOT(ot)
  }

  const guardarOT = async e => {
    e.preventDefault(); setSavOT(true); setErrOT('')
    try {
      const body = { ...formOT, activo_id: formOT.activo_id||null }
      if (modalFormOT === 'nuevo') await api.post('/mantenimiento/ot', body)
      else await api.put(`/mantenimiento/ot/${modalFormOT.id}`, body)
      setModalFormOT(null); cargarOT()
    } catch(err) { setErrOT(err.response?.data?.error ?? 'Error al guardar') }
    finally { setSavOT(false) }
  }

  const eliminarOT = async id => {
    if (!confirm('¿Eliminar esta OT?')) return
    await api.delete(`/mantenimiento/ot/${id}`)
    setModalDetOT(null); cargarOT()
  }

  /* ── Autocomplete activo en form OT ─────────────────────────────── */
  const buscarActivo = (txt, setSugs) => {
    const q = txt.toLowerCase()
    setSugs(activos.filter(a => a.nombre.toLowerCase().includes(q) || a.codigo.toLowerCase().includes(q)).slice(0,6))
  }

  /* ── Form Plan ──────────────────────────────────────────────────── */
  const guardarPlan = async e => {
    e.preventDefault(); setSavPlan(true); setErrPlan('')
    try {
      if (modalPlan === 'nuevo') await api.post('/mantenimiento/plan', formPlan)
      else await api.put(`/mantenimiento/plan/${modalPlan.id}`, formPlan)
      setModalPlan(null); cargarPlan()
    } catch(err) { setErrPlan(err.response?.data?.error ?? 'Error al guardar') }
    finally { setSavPlan(false) }
  }

  const ejecutarPlan = async plan => {
    if (!confirm(`¿Generar OT para: "${plan.descripcion}"?`)) return
    const r = await api.post(`/mantenimiento/plan/${plan.id}/ejecutar`)
    cargarPlan()
    alert(`OT generada: ${r.data.numero}\nPróxima fecha: ${fmtF(r.data.proxima_fecha)}`)
  }

  const eliminarPlan = async id => {
    if (!confirm('¿Eliminar este plan preventivo?')) return
    await api.delete(`/mantenimiento/plan/${id}`)
    cargarPlan()
  }

  /* ── Form Activo ────────────────────────────────────────────────── */
  const guardarActivo = async e => {
    e.preventDefault(); setSavA(true); setErrA('')
    try {
      if (modalA === 'nuevo') await api.post('/mantenimiento/activos', formA)
      else await api.put(`/mantenimiento/activos/${modalA.id}`, formA)
      setModalA(null); cargarActivos()
      api.get('/mantenimiento/activos').then(r => setActivos(r.data))
    } catch(err) { setErrA(err.response?.data?.error ?? 'Error al guardar') }
    finally { setSavA(false) }
  }

  const darDeBaja = async id => {
    if (!confirm('¿Dar de baja este activo?')) return
    await api.delete(`/mantenimiento/activos/${id}`)
    cargarActivos()
  }

  /* ── Helpers ────────────────────────────────────────────────────── */
  const totalPagsOT  = Math.ceil(totalOT / 50)
  const totalCostos  = (modalDetOT?.costos||[]).reduce((s,c) => s+c.total, 0)
  const tareasComp   = (modalDetOT?.tareas||[]).filter(t => t.estado === 'Completada').length
  const tareasTotal  = (modalDetOT?.tareas||[]).length

  const alertaPlan = p => {
    const d = diasHasta(p.proxima_fecha)
    if (d === null) return null
    if (d < 0) return 'danger'
    if (d <= 7) return 'warning'
    return null
  }

  return (
    <>
      <h5 className="fw-bold mb-3">Mantenimiento</h5>

      <ul className="nav nav-tabs mb-3">
        {[['ot','wrench','Órdenes de Trabajo'],['plan','calendar-check','Plan Preventivo'],['activos','gear','Activos']].map(([v,ic,l]) => (
          <li key={v} className="nav-item">
            <button className={`nav-link ${tab===v?'active':''}`} onClick={() => setTab(v)}>
              <i className={`bi bi-${ic} me-1`}/>{l}
            </button>
          </li>
        ))}
      </ul>

      {/* ─── TAB: ÓRDENES DE TRABAJO ────────────────────────────────── */}
      {tab === 'ot' && <>
        <div className="d-flex flex-wrap gap-2 mb-3">
          {canWrite && (
            <button className="btn btn-sm btn-success" onClick={abrirNuevaOT}>
              <i className="bi bi-plus-lg me-1"/>Nueva OT
            </button>
          )}
          <a href="/api/v1/mantenimiento/exportar" className="btn btn-sm btn-outline-secondary" target="_blank" rel="noreferrer">
            <i className="bi bi-file-excel me-1"/>Exportar
          </a>
        </div>

        <div className="d-flex flex-wrap gap-2 mb-2">
          <select className="form-select form-select-sm" style={{width:140}}
            value={filtOT.estado} onChange={e => { setFiltOT(p=>({...p,estado:e.target.value})); setPageOT(1) }}>
            <option value="">Todos los estados</option>
            {ESTADOS_OT.map(s => <option key={s.v} value={s.v}>{s.v}</option>)}
          </select>
          <select className="form-select form-select-sm" style={{width:130}}
            value={filtOT.tipo} onChange={e => { setFiltOT(p=>({...p,tipo:e.target.value})); setPageOT(1) }}>
            <option value="">Todos los tipos</option>
            {TIPOS_OT.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="form-select form-select-sm" style={{width:120}}
            value={filtOT.prioridad} onChange={e => { setFiltOT(p=>({...p,prioridad:e.target.value})); setPageOT(1) }}>
            <option value="">Toda prioridad</option>
            {PRIORIDADES.map(p => <option key={p.v} value={p.v}>{p.v}</option>)}
          </select>
          <input type="date" className="form-control form-control-sm" style={{width:135}}
            value={filtOT.desde} onChange={e => { setFiltOT(p=>({...p,desde:e.target.value})); setPageOT(1) }}/>
          <input type="date" className="form-control form-control-sm" style={{width:135}}
            value={filtOT.hasta} onChange={e => { setFiltOT(p=>({...p,hasta:e.target.value})); setPageOT(1) }}/>
          {(filtOT.estado||filtOT.tipo||filtOT.prioridad||filtOT.desde||filtOT.hasta) &&
            <button className="btn btn-sm btn-outline-secondary" onClick={() => { setFiltOT({estado:'',tipo:'',prioridad:'',desde:'',hasta:''}); setPageOT(1) }}>Limpiar</button>}
        </div>

        <div className="card border-0 shadow-sm">
          {loadOT
            ? <div className="text-center py-5"><div className="spinner-border text-secondary"/></div>
            : <div className="table-responsive" style={{maxHeight:'calc(100vh - 320px)', overflowY:'auto'}}>
                <table className="table table-hover table-sm mb-0" style={{fontSize:'0.83rem'}}>
                  <thead className="table-dark sticky-top">
                    <tr>
                      <th>N° OT</th><th>ACTIVO</th><th className="text-center">TIPO</th>
                      <th className="text-center">PRIOR.</th><th className="text-center">ESTADO</th>
                      <th>DESCRIPCIÓN</th><th>APERTURA</th><th>EJECUTOR</th><th/>
                    </tr>
                  </thead>
                  <tbody>
                    {ots.length === 0
                      ? <tr><td colSpan={9} className="text-center text-muted py-4">Sin resultados</td></tr>
                      : ots.map(o => {
                          const est  = ESTADOS_OT.find(s=>s.v===o.estado)
                          const prio = PRIORIDADES.find(p=>p.v===o.prioridad)
                          return (
                            <tr key={o.id} style={{cursor:'pointer'}} onClick={() => verOT(o.id)}>
                              <td className="fw-semibold">{o.numero}</td>
                              <td><div className="text-truncate" style={{maxWidth:160}} title={o.activo_nombre}>{o.activo_nombre||<span className="text-muted">—</span>}</div></td>
                              <td className="text-center"><span className={`badge bg-${o.tipo==='Preventivo'?'info':'secondary'}`}>{o.tipo}</span></td>
                              <td className="text-center"><span className={`badge bg-${prio?.c??'secondary'}`}>{o.prioridad}</span></td>
                              <td className="text-center"><span className={`badge bg-${est?.c??'secondary'}`}>{o.estado}</span></td>
                              <td><div className="text-truncate" style={{maxWidth:260}} title={o.descripcion}>{o.descripcion}</div></td>
                              <td className="text-nowrap text-muted">{fmtF(o.fecha_apertura)}</td>
                              <td><div className="text-truncate" style={{maxWidth:130}} title={o.ejecutor_nombre}>{o.ejecutor_nombre||<span className="text-muted">—</span>}</div></td>
                              <td className="text-end">
                                <button className="btn btn-xs btn-outline-primary py-0 px-2" style={{fontSize:'0.75rem'}}
                                  onClick={e=>{e.stopPropagation(); verOT(o.id)}}>Ver</button>
                              </td>
                            </tr>
                          )
                        })
                    }
                  </tbody>
                </table>
              </div>
          }
          <div className="border-top px-3 py-1 d-flex justify-content-between align-items-center" style={{fontSize:'0.78rem', background:'#f8f9fa'}}>
            <span className="text-muted">Total: <strong>{totalOT}</strong> órdenes</span>
            {totalPagsOT > 1 && (
              <div className="d-flex gap-1 align-items-center">
                <button className="btn btn-xs btn-outline-secondary py-0 px-2" disabled={pageOT===1} onClick={()=>setPageOT(p=>p-1)}>‹</button>
                <span className="text-muted small">{pageOT}/{totalPagsOT}</span>
                <button className="btn btn-xs btn-outline-secondary py-0 px-2" disabled={pageOT>=totalPagsOT} onClick={()=>setPageOT(p=>p+1)}>›</button>
              </div>
            )}
          </div>
        </div>
      </>}

      {/* ─── TAB: PLAN PREVENTIVO ───────────────────────────────────── */}
      {tab === 'plan' && <>
        <div className="d-flex gap-2 mb-3">
          {canWrite && (
            <button className="btn btn-sm btn-success" onClick={() => { setFormPlan(FORM_PLAN); setErrPlan(''); setSugsAP([]); setModalPlan('nuevo') }}>
              <i className="bi bi-plus-lg me-1"/>Nuevo Plan
            </button>
          )}
        </div>

        <div className="card border-0 shadow-sm">
          {loadPlan
            ? <div className="text-center py-5"><div className="spinner-border text-secondary"/></div>
            : <div className="table-responsive" style={{maxHeight:'calc(100vh - 260px)', overflowY:'auto'}}>
                <table className="table table-hover table-sm mb-0" style={{fontSize:'0.83rem'}}>
                  <thead className="table-dark sticky-top">
                    <tr>
                      <th>ACTIVO</th><th>DESCRIPCIÓN</th><th className="text-center">FRECUENCIA</th>
                      <th className="text-center">PRÓXIMA FECHA</th><th className="text-center">ÚLTIMA EJEC.</th>
                      {canWrite && <th/>}
                    </tr>
                  </thead>
                  <tbody>
                    {planes.length === 0
                      ? <tr><td colSpan={canWrite?6:5} className="text-center text-muted py-4">Sin planes definidos</td></tr>
                      : planes.map(p => {
                          const alerta = alertaPlan(p)
                          const d = diasHasta(p.proxima_fecha)
                          return (
                            <tr key={p.id} className={alerta==='danger'?'table-danger':alerta==='warning'?'table-warning':''}>
                              <td className="fw-semibold">{p.activo_nombre||<span className="text-muted">General</span>}</td>
                              <td><div className="text-truncate" style={{maxWidth:300}} title={p.descripcion}>{p.descripcion}</div></td>
                              <td className="text-center"><span className="badge bg-info text-dark">{p.frecuencia}</span></td>
                              <td className="text-center">
                                {p.proxima_fecha ? <>
                                  {fmtF(p.proxima_fecha)}
                                  {d !== null && <span className={`ms-1 small ${d<0?'text-danger':d<=7?'text-warning':'text-muted'}`}>
                                    ({d<0?`vencido hace ${Math.abs(d)}d`:d===0?'hoy':`en ${d}d`})
                                  </span>}
                                </> : '—'}
                              </td>
                              <td className="text-center text-muted">{fmtF(p.ultima_fecha)}</td>
                              {canWrite && (
                                <td className="text-end">
                                  <div className="d-flex gap-1 justify-content-end">
                                    <button className="btn btn-xs btn-success py-0 px-2" style={{fontSize:'0.75rem'}} onClick={() => ejecutarPlan(p)}>
                                      <i className="bi bi-play-fill"/>
                                    </button>
                                    <button className="btn btn-xs btn-outline-secondary py-0 px-2" style={{fontSize:'0.75rem'}}
                                      onClick={() => { setFormPlan({...p}); setErrPlan(''); setSugsAP([]); setModalPlan(p) }}>
                                      <i className="bi bi-pencil"/>
                                    </button>
                                    <button className="btn btn-xs btn-outline-danger py-0 px-2" style={{fontSize:'0.75rem'}} onClick={() => eliminarPlan(p.id)}>
                                      <i className="bi bi-x"/>
                                    </button>
                                  </div>
                                </td>
                              )}
                            </tr>
                          )
                        })
                    }
                  </tbody>
                </table>
              </div>
          }
        </div>
      </>}

      {/* ─── TAB: ACTIVOS ───────────────────────────────────────────── */}
      {tab === 'activos' && <>
        <div className="d-flex flex-wrap gap-2 mb-3">
          {canWrite && (
            <button className="btn btn-sm btn-success" onClick={() => { setFormA(FORM_ACTIVO); setErrA(''); setModalA('nuevo') }}>
              <i className="bi bi-plus-lg me-1"/>Nuevo Activo
            </button>
          )}
          <input className="form-control form-control-sm" style={{width:220}} placeholder="Buscar activo…"
            value={buscarA} onChange={e => setBuscarA(e.target.value)}/>
          <select className="form-select form-select-sm" style={{width:150}} value={filTipoA} onChange={e => setFilTipoA(e.target.value)}>
            <option value="">Todos los tipos</option>
            {TIPOS_ACTIVO.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="form-select form-select-sm" style={{width:160}} value={filEstA} onChange={e => setFilEstA(e.target.value)}>
            <option value="">Todos los estados</option>
            {ESTADOS_ACTIVO.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </div>

        <div className="card border-0 shadow-sm">
          {loadA
            ? <div className="text-center py-5"><div className="spinner-border text-secondary"/></div>
            : <div className="table-responsive" style={{maxHeight:'calc(100vh - 280px)', overflowY:'auto'}}>
                <table className="table table-hover table-sm mb-0" style={{fontSize:'0.83rem'}}>
                  <thead className="table-dark sticky-top">
                    <tr>
                      <th>CÓDIGO</th><th>NOMBRE</th><th className="text-center">TIPO</th>
                      <th className="text-center">ESTADO</th><th>UBICACIÓN</th>
                      <th>MARCA / MODELO</th><th>N° SERIE</th>
                      {canWrite && <th/>}
                    </tr>
                  </thead>
                  <tbody>
                    {activos.length === 0
                      ? <tr><td colSpan={canWrite?8:7} className="text-center text-muted py-4">Sin activos</td></tr>
                      : activos.map(a => (
                          <tr key={a.id}>
                            <td className="fw-semibold">{a.codigo}</td>
                            <td><div className="text-truncate" style={{maxWidth:220}} title={a.nombre}>{a.nombre}</div></td>
                            <td className="text-center"><span className="badge bg-secondary">{a.tipo}</span></td>
                            <td className="text-center">
                              <span className={`badge bg-${a.estado==='Activo'?'success':a.estado==='En mantenimiento'?'warning':'danger'}`}>{a.estado}</span>
                            </td>
                            <td className="text-muted">{a.ubicacion||'—'}</td>
                            <td className="text-muted">{[a.marca,a.modelo].filter(Boolean).join(' ')||'—'}</td>
                            <td className="text-muted">{a.n_serie||'—'}</td>
                            {canWrite && (
                              <td>
                                <div className="d-flex gap-1 justify-content-end">
                                  <button className="btn btn-xs btn-outline-secondary py-0 px-2" style={{fontSize:'0.75rem'}}
                                    onClick={() => { setFormA({...a}); setErrA(''); setModalA(a) }}>Editar</button>
                                  <button className="btn btn-xs btn-outline-danger py-0 px-2" style={{fontSize:'0.75rem'}}
                                    onClick={() => darDeBaja(a.id)}>Baja</button>
                                </div>
                              </td>
                            )}
                          </tr>
                        ))
                    }
                  </tbody>
                </table>
              </div>
          }
        </div>
      </>}

      {/* ══ MODAL: DETALLE OT ═══════════════════════════════════════════ */}
      {(modalDetOT || loadDet) && (
        <div className="modal show d-block" style={{background:'rgba(0,0,0,.5)'}}>
          <div className="modal-dialog modal-xl modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h5 className="modal-title">
                  {loadDet ? 'Cargando…' : `${modalDetOT?.numero} — ${modalDetOT?.descripcion}`}
                </h5>
                <button className="btn-close" onClick={() => { setModalDetOT(null); setLoadDet(false) }}/>
              </div>
              {loadDet && <div className="modal-body text-center py-5"><div className="spinner-border text-secondary"/></div>}
              {!loadDet && modalDetOT && (
                <>
                  <div className="modal-body">
                    {/* Header */}
                    <div className="row g-2 mb-3 small">
                      <div className="col-auto"><strong>Activo:</strong> {modalDetOT.activo_nombre||'—'}</div>
                      <div className="col-auto"><strong>Tipo:</strong> <span className={`badge bg-${modalDetOT.tipo==='Preventivo'?'info':'secondary'}`}>{modalDetOT.tipo}</span></div>
                      <div className="col-auto"><strong>Prioridad:</strong> <span className={`badge bg-${PRIORIDADES.find(p=>p.v===modalDetOT.prioridad)?.c??'secondary'}`}>{modalDetOT.prioridad}</span></div>
                      <div className="col-auto"><strong>Estado:</strong> <span className={`badge bg-${ESTADOS_OT.find(s=>s.v===modalDetOT.estado)?.c??'secondary'}`}>{modalDetOT.estado}</span></div>
                      <div className="col-auto"><strong>Apertura:</strong> {fmtF(modalDetOT.fecha_apertura)}</div>
                      {modalDetOT.fecha_prog   && <div className="col-auto"><strong>Programado:</strong> {fmtF(modalDetOT.fecha_prog)}</div>}
                      {modalDetOT.fecha_cierre && <div className="col-auto"><strong>Cierre:</strong> {fmtF(modalDetOT.fecha_cierre)}</div>}
                      <div className="col-auto"><strong>Ejecutor:</strong> {modalDetOT.ejecutor_tipo==='externo'?'Externo':'Interno'}{modalDetOT.ejecutor_nombre?` — ${modalDetOT.ejecutor_nombre}`:''}</div>
                      {modalDetOT.observaciones && <div className="col-12 text-muted"><i>{modalDetOT.observaciones}</i></div>}
                    </div>

                    <div className="row g-3">
                      {/* Tareas */}
                      <div className="col-md-5">
                        <div className="d-flex justify-content-between align-items-center mb-2">
                          <strong className="small">Tareas {tareasTotal>0 && <span className="text-muted">({tareasComp}/{tareasTotal})</span>}</strong>
                        </div>
                        {(modalDetOT.tareas||[]).length === 0
                          ? <p className="text-muted small mb-0">Sin tareas definidas</p>
                          : <ul className="list-group list-group-flush">
                              {modalDetOT.tareas.map(t => (
                                <li key={t.id} className="list-group-item px-0 py-1 d-flex align-items-center gap-2" style={{fontSize:'0.83rem'}}>
                                  {canWrite
                                    ? <input type="checkbox" className="form-check-input mt-0" checked={t.estado==='Completada'} onChange={() => toggleTarea(t)}/>
                                    : <i className={`bi bi-${t.estado==='Completada'?'check-circle-fill text-success':'circle text-muted'}`}/>
                                  }
                                  <span className={t.estado==='Completada'?'text-decoration-line-through text-muted':''}>{t.descripcion}</span>
                                  {t.estado==='Completada' && t.fecha_comp && <span className="ms-auto text-muted" style={{fontSize:'0.75rem'}}>{fmtF(t.fecha_comp)}</span>}
                                </li>
                              ))}
                            </ul>
                        }
                      </div>

                      {/* Costos */}
                      <div className="col-md-7">
                        <strong className="small d-block mb-2">Costos</strong>
                        <table className="table table-sm table-bordered mb-2" style={{fontSize:'0.8rem'}}>
                          <thead className="table-light">
                            <tr><th>TIPO</th><th>DESCRIPCIÓN</th><th className="text-end">CANT.</th><th className="text-end">PRECIO U.</th><th className="text-end">TOTAL</th>{canWrite&&<th/>}</tr>
                          </thead>
                          <tbody>
                            {(modalDetOT.costos||[]).length === 0
                              ? <tr><td colSpan={canWrite?6:5} className="text-center text-muted py-2">Sin costos</td></tr>
                              : (modalDetOT.costos||[]).map(c => (
                                  <tr key={c.id}>
                                    <td>{c.tipo}</td>
                                    <td>{c.descripcion}</td>
                                    <td className="text-end">{fmtN(c.cantidad)}</td>
                                    <td className="text-end">{fmtN(c.precio_unit)}</td>
                                    <td className="text-end fw-semibold">{fmtN(c.total)}</td>
                                    {canWrite && <td className="text-center"><button className="btn btn-xs text-danger py-0 px-1" onClick={() => eliminarCosto(c.id)}><i className="bi bi-x"/></button></td>}
                                  </tr>
                                ))
                            }
                          </tbody>
                          {(modalDetOT.costos||[]).length > 0 && (
                            <tfoot><tr><td colSpan={canWrite?4:4} className="text-end fw-bold">TOTAL</td><td className="text-end fw-bold">{fmtN(totalCostos)}</td>{canWrite&&<td/>}</tr></tfoot>
                          )}
                        </table>
                        {canWrite && (
                          <form className="d-flex gap-1 flex-wrap" onSubmit={agregarCosto}>
                            <select className="form-select form-select-sm" style={{width:110}} value={formCosto.tipo} onChange={e=>setFormCosto(p=>({...p,tipo:e.target.value}))}>
                              {TIPOS_COSTO.map(t=><option key={t} value={t}>{t}</option>)}
                            </select>
                            <input className="form-control form-control-sm" style={{flex:1,minWidth:120}} placeholder="Descripción" value={formCosto.descripcion} onChange={e=>setFormCosto(p=>({...p,descripcion:e.target.value}))} required/>
                            <input type="number" className="form-control form-control-sm" style={{width:70}} placeholder="Cant." value={formCosto.cantidad} min="0.001" step="any" onChange={e=>setFormCosto(p=>({...p,cantidad:e.target.value}))}/>
                            <input type="number" className="form-control form-control-sm" style={{width:90}} placeholder="Precio" value={formCosto.precio_unit} min="0" step="any" onChange={e=>setFormCosto(p=>({...p,precio_unit:e.target.value}))}/>
                            <button type="submit" className="btn btn-sm btn-outline-primary" disabled={savCosto}><i className="bi bi-plus-lg"/></button>
                          </form>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="modal-footer py-2 justify-content-between">
                    <div className="d-flex gap-2 flex-wrap">
                      {canWrite && modalDetOT.estado === 'Pendiente' && (
                        <button className="btn btn-sm btn-primary" onClick={() => cambiarEstado(modalDetOT,'En proceso')}>
                          <i className="bi bi-play-fill me-1"/>Iniciar
                        </button>
                      )}
                      {canWrite && modalDetOT.estado === 'En proceso' && (
                        <button className="btn btn-sm btn-success" onClick={() => cambiarEstado(modalDetOT,'Completada')}>
                          <i className="bi bi-check-lg me-1"/>Completar
                        </button>
                      )}
                      {canWrite && (modalDetOT.estado==='Pendiente'||modalDetOT.estado==='En proceso') && (
                        <button className="btn btn-sm btn-outline-danger" onClick={() => cambiarEstado(modalDetOT,'Cancelada')}>Cancelar OT</button>
                      )}
                      {canWrite && <button className="btn btn-sm btn-outline-secondary" onClick={() => { setModalDetOT(null); abrirEditarOT(modalDetOT) }}><i className="bi bi-pencil me-1"/>Editar</button>}
                      {canWrite && <button className="btn btn-sm btn-outline-danger" onClick={() => eliminarOT(modalDetOT.id)}><i className="bi bi-trash me-1"/>Eliminar</button>}
                    </div>
                    <button className="btn btn-sm btn-secondary" onClick={() => setModalDetOT(null)}>Cerrar</button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL: CREAR / EDITAR OT ════════════════════════════════════ */}
      {modalFormOT !== null && (
        <div className="modal show d-block" style={{background:'rgba(0,0,0,.5)', zIndex:1060}}>
          <div className="modal-dialog modal-lg modal-dialog-scrollable">
            <form className="modal-content" onSubmit={guardarOT}>
              <div className="modal-header py-2">
                <h5 className="modal-title">{modalFormOT==='nuevo' ? 'Nueva OT' : `Editar OT #${modalFormOT.numero}`}</h5>
                <button type="button" className="btn-close" onClick={()=>setModalFormOT(null)}/>
              </div>
              <div className="modal-body">
                {errOT && <div className="alert alert-danger py-2 small">{errOT}</div>}
                <div className="row g-2">
                  {/* Activo */}
                  <div className="col-md-6 position-relative">
                    <label className="form-label small fw-medium mb-1">Activo</label>
                    <input className="form-control form-control-sm" value={formOT.activo_nombre} placeholder="Buscar activo…"
                      onChange={e => { setFormOT(p=>({...p,activo_nombre:e.target.value,activo_id:''})); buscarActivo(e.target.value, setSugsA) }}/>
                    {sugsA.length > 0 && (
                      <div className="border rounded shadow-sm position-absolute bg-white" style={{zIndex:9999,top:'100%',width:'100%',maxHeight:180,overflowY:'auto'}}>
                        {sugsA.map(a => (
                          <div key={a.id} className="px-3 py-2 border-bottom" style={{cursor:'pointer',fontSize:'0.83rem'}}
                            onMouseEnter={e=>e.currentTarget.classList.add('bg-light')}
                            onMouseLeave={e=>e.currentTarget.classList.remove('bg-light')}
                            onClick={() => { setFormOT(p=>({...p,activo_id:a.id,activo_nombre:a.nombre})); setSugsA([]) }}>
                            <strong>{a.codigo}</strong> — {a.nombre} <span className="text-muted ms-1">({a.tipo})</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-medium mb-1">Tipo</label>
                    <select className="form-select form-select-sm" value={formOT.tipo} onChange={e=>setFormOT(p=>({...p,tipo:e.target.value}))}>
                      {TIPOS_OT.map(t=><option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-medium mb-1">Prioridad</label>
                    <select className="form-select form-select-sm" value={formOT.prioridad} onChange={e=>setFormOT(p=>({...p,prioridad:e.target.value}))}>
                      {PRIORIDADES.map(p=><option key={p.v} value={p.v}>{p.v}</option>)}
                    </select>
                  </div>
                  <div className="col-12">
                    <label className="form-label small fw-medium mb-1">Descripción *</label>
                    <input className="form-control form-control-sm" value={formOT.descripcion} required onChange={e=>setFormOT(p=>({...p,descripcion:e.target.value}))}/>
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-medium mb-1">Fecha apertura</label>
                    <input type="date" className="form-control form-control-sm" value={formOT.fecha_apertura} onChange={e=>setFormOT(p=>({...p,fecha_apertura:e.target.value}))}/>
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-medium mb-1">Fecha programada</label>
                    <input type="date" className="form-control form-control-sm" value={formOT.fecha_prog} onChange={e=>setFormOT(p=>({...p,fecha_prog:e.target.value}))}/>
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-medium mb-1">Ejecutor</label>
                    <select className="form-select form-select-sm" value={formOT.ejecutor_tipo} onChange={e=>setFormOT(p=>({...p,ejecutor_tipo:e.target.value}))}>
                      <option value="interno">Interno</option>
                      <option value="externo">Externo</option>
                    </select>
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-medium mb-1">Nombre ejecutor</label>
                    <input className="form-control form-control-sm" value={formOT.ejecutor_nombre} onChange={e=>setFormOT(p=>({...p,ejecutor_nombre:e.target.value}))}/>
                  </div>
                  <div className="col-12">
                    <label className="form-label small fw-medium mb-1">Observaciones</label>
                    <input className="form-control form-control-sm" value={formOT.observaciones} onChange={e=>setFormOT(p=>({...p,observaciones:e.target.value}))}/>
                  </div>

                  {/* Tareas */}
                  <div className="col-12">
                    <label className="form-label small fw-medium mb-1">Tareas</label>
                    {formOT.tareas.map((t, i) => (
                      <div key={i} className="d-flex gap-1 mb-1">
                        <input className="form-control form-control-sm" value={t.descripcion}
                          onChange={e => setFormOT(p => ({ ...p, tareas: p.tareas.map((x,j)=>j===i?{...x,descripcion:e.target.value}:x) }))}/>
                        <button type="button" className="btn btn-sm btn-outline-danger py-0 px-2"
                          onClick={() => setFormOT(p=>({...p,tareas:p.tareas.filter((_,j)=>j!==i)}))}>
                          <i className="bi bi-x"/>
                        </button>
                      </div>
                    ))}
                    <div className="d-flex gap-1 mt-1">
                      <input className="form-control form-control-sm" placeholder="Nueva tarea…" value={nuevaTarea} onChange={e=>setNuevaTarea(e.target.value)}
                        onKeyDown={e=>{ if(e.key==='Enter'){ e.preventDefault(); if(nuevaTarea.trim()){setFormOT(p=>({...p,tareas:[...p.tareas,{descripcion:nuevaTarea.trim(),estado:'Pendiente'}]})); setNuevaTarea('')}}}}/>
                      <button type="button" className="btn btn-sm btn-outline-secondary py-0 px-2"
                        onClick={() => { if(nuevaTarea.trim()){setFormOT(p=>({...p,tareas:[...p.tareas,{descripcion:nuevaTarea.trim(),estado:'Pendiente'}]})); setNuevaTarea('') }}}>
                        <i className="bi bi-plus"/>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <div className="modal-footer py-2">
                <button type="button" className="btn btn-secondary btn-sm" onClick={()=>setModalFormOT(null)}>Cancelar</button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={savOT}>
                  {savOT && <span className="spinner-border spinner-border-sm me-2"/>}Guardar OT
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══ MODAL: PLAN PREVENTIVO ══════════════════════════════════════ */}
      {modalPlan !== null && (
        <div className="modal show d-block" style={{background:'rgba(0,0,0,.4)', zIndex:1060}}>
          <div className="modal-dialog">
            <form className="modal-content" onSubmit={guardarPlan}>
              <div className="modal-header py-2">
                <h5 className="modal-title">{modalPlan==='nuevo' ? 'Nuevo Plan Preventivo' : 'Editar Plan'}</h5>
                <button type="button" className="btn-close" onClick={()=>setModalPlan(null)}/>
              </div>
              <div className="modal-body">
                {errPlan && <div className="alert alert-danger py-2 small">{errPlan}</div>}
                <div className="row g-3">
                  <div className="col-12 position-relative">
                    <label className="form-label small fw-medium">Activo</label>
                    <input className="form-control" value={formPlan.activo_nombre} placeholder="Buscar activo o dejar vacío para general…"
                      onChange={e => { setFormPlan(p=>({...p,activo_nombre:e.target.value,activo_id:''})); buscarActivo(e.target.value, setSugsAP) }}/>
                    {sugsAP.length > 0 && (
                      <div className="border rounded shadow-sm position-absolute bg-white" style={{zIndex:9999,top:'100%',width:'100%',maxHeight:180,overflowY:'auto'}}>
                        {sugsAP.map(a => (
                          <div key={a.id} className="px-3 py-2 border-bottom" style={{cursor:'pointer',fontSize:'0.83rem'}}
                            onMouseEnter={e=>e.currentTarget.classList.add('bg-light')}
                            onMouseLeave={e=>e.currentTarget.classList.remove('bg-light')}
                            onClick={() => { setFormPlan(p=>({...p,activo_id:a.id,activo_nombre:a.nombre})); setSugsAP([]) }}>
                            <strong>{a.codigo}</strong> — {a.nombre}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="col-12">
                    <label className="form-label small fw-medium">Descripción *</label>
                    <input className="form-control" value={formPlan.descripcion} required onChange={e=>setFormPlan(p=>({...p,descripcion:e.target.value}))}/>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small fw-medium">Frecuencia</label>
                    <select className="form-select" value={formPlan.frecuencia} onChange={e=>setFormPlan(p=>({...p,frecuencia:e.target.value}))}>
                      {FRECUENCIAS.map(f=><option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small fw-medium">Próxima fecha</label>
                    <input type="date" className="form-control" value={formPlan.proxima_fecha} onChange={e=>setFormPlan(p=>({...p,proxima_fecha:e.target.value}))}/>
                  </div>
                </div>
              </div>
              <div className="modal-footer py-2">
                <button type="button" className="btn btn-secondary" onClick={()=>setModalPlan(null)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={savPlan}>
                  {savPlan && <span className="spinner-border spinner-border-sm me-2"/>}Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══ MODAL: ACTIVO ═══════════════════════════════════════════════ */}
      {modalA !== null && (
        <div className="modal show d-block" style={{background:'rgba(0,0,0,.4)', zIndex:1060}}>
          <div className="modal-dialog modal-lg">
            <form className="modal-content" onSubmit={guardarActivo}>
              <div className="modal-header py-2">
                <h5 className="modal-title">{modalA==='nuevo' ? 'Nuevo Activo' : 'Editar Activo'}</h5>
                <button type="button" className="btn-close" onClick={()=>setModalA(null)}/>
              </div>
              <div className="modal-body">
                {errA && <div className="alert alert-danger py-2 small">{errA}</div>}
                <div className="row g-3">
                  <div className="col-md-3">
                    <label className="form-label small fw-medium">Código *</label>
                    <input className="form-control" value={formA.codigo} required onChange={e=>setFormA(p=>({...p,codigo:e.target.value}))}/>
                  </div>
                  <div className="col-md-5">
                    <label className="form-label small fw-medium">Nombre *</label>
                    <input className="form-control" value={formA.nombre} required onChange={e=>setFormA(p=>({...p,nombre:e.target.value}))}/>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label small fw-medium">Tipo</label>
                    <select className="form-select" value={formA.tipo} onChange={e=>setFormA(p=>({...p,tipo:e.target.value}))}>
                      {TIPOS_ACTIVO.map(t=><option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-medium">Marca</label>
                    <input className="form-control" value={formA.marca} onChange={e=>setFormA(p=>({...p,marca:e.target.value}))}/>
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-medium">Modelo</label>
                    <input className="form-control" value={formA.modelo} onChange={e=>setFormA(p=>({...p,modelo:e.target.value}))}/>
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-medium">N° de Serie</label>
                    <input className="form-control" value={formA.n_serie} onChange={e=>setFormA(p=>({...p,n_serie:e.target.value}))}/>
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-medium">Estado</label>
                    <select className="form-select" value={formA.estado} onChange={e=>setFormA(p=>({...p,estado:e.target.value}))}>
                      {ESTADOS_ACTIVO.map(e=><option key={e} value={e}>{e}</option>)}
                    </select>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label small fw-medium">Ubicación</label>
                    <input className="form-control" value={formA.ubicacion} onChange={e=>setFormA(p=>({...p,ubicacion:e.target.value}))}/>
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-medium">Fecha adquisición</label>
                    <input type="date" className="form-control" value={formA.fecha_adq} onChange={e=>setFormA(p=>({...p,fecha_adq:e.target.value}))}/>
                  </div>
                  <div className="col-12">
                    <label className="form-label small fw-medium">Observaciones</label>
                    <input className="form-control" value={formA.observaciones} onChange={e=>setFormA(p=>({...p,observaciones:e.target.value}))}/>
                  </div>
                </div>
              </div>
              <div className="modal-footer py-2">
                <button type="button" className="btn btn-secondary" onClick={()=>setModalA(null)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={savA}>
                  {savA && <span className="spinner-border spinner-border-sm me-2"/>}Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
