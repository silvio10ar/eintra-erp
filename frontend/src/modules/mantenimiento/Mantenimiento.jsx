import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'
import { puedeEscribir } from '../../store/authStore'

const hoy = () => new Date().toISOString().slice(0, 10)
const fmtF = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—'
const fmtN = n => n != null ? new Intl.NumberFormat('es-AR').format(n) : '—'

const BADGE_ALERTA = { vencida: 'danger', proxima: 'warning', al_dia: 'success', nunca_ejecutada: 'secondary', manual: 'info' }
const LABEL_ALERTA = { vencida: 'Vencida', proxima: 'Próxima', al_dia: 'Al día', nunca_ejecutada: 'Sin ejecutar', manual: 'Luego de c/uso' }
const BADGE_ESTADO = { activo: 'success', en_reparacion: 'warning', baja: 'secondary' }
const BADGE_RESULTADO = { resuelto: 'success', pendiente: 'warning', derivado_baja: 'secondary' }

const FORM_EQUIPO = { codigo: '', nombre: '', categoria: '', marca: '', modelo: '', nro_serie: '', ubicacion: '', observaciones: '' }
const FORM_EJEC = { fecha: hoy(), resultado: 'OK', observaciones: '', responsable: '' }
const FORM_CORREC = { equipo_id: '', equipo_texto: '', fecha_deteccion: hoy(), fecha_inicio: '', descripcion_falla: '', tipo_servicio: 'interno', proveedor: '', responsable: '', observaciones: '' }
const FORM_CIERRE = { fecha_fin: hoy(), accion_realizada: '', tipo_servicio: 'interno', proveedor: '', costo: '', repuestos_usados: '', resultado: 'resuelto', responsable: '', observaciones: '' }

export default function Mantenimiento() {
  const canWrite = puedeEscribir('mantenimiento')
  const [tab, setTab] = useState('dashboard')
  const [meta, setMeta] = useState({ categorias: [], ubicaciones: ['MIGUENS', 'POGGIO'] })

  // ── Dashboard ──────────────────────────────────────────────────────────────
  const [kpis, setKpis] = useState(null)
  const [loadDash, setLoadDash] = useState(false)

  // ── Equipos ────────────────────────────────────────────────────────────────
  const [equipos, setEquipos] = useState([])
  const [loadEq, setLoadEq] = useState(false)
  const [filtEq, setFiltEq] = useState({ buscar: '', categoria: '', ubicacion: '', estado: '' })
  const [modalEq, setModalEq] = useState(null)       // 'nuevo' | 'editar' | 'detalle' | 'baja'
  const [equipoSel, setEquipoSel] = useState(null)
  const [formEq, setFormEq] = useState(FORM_EQUIPO)
  const [motivoBaja, setMotivoBaja] = useState('')
  const [savEq, setSavEq] = useState(false)
  const [errEq, setErrEq] = useState('')

  // ── Plan preventivo / Alertas ──────────────────────────────────────────────
  const [alertas, setAlertas] = useState([])
  const [loadAl, setLoadAl] = useState(false)
  const [filtAl, setFiltAl] = useState({ estado: '', ubicacion: '', categoria: '' })
  const [modalEjec, setModalEjec] = useState(null)   // tarea seleccionada
  const [formEjec, setFormEjec] = useState(FORM_EJEC)
  const [savEjec, setSavEjec] = useState(false)
  const [errEjec, setErrEjec] = useState('')
  const [nokCorrec, setNokCorrec] = useState(false)  // mostrar opción correctiva post-NOK

  // ── Correctivas ────────────────────────────────────────────────────────────
  const [correctivas, setCorrectivas] = useState([])
  const [loadCo, setLoadCo] = useState(false)
  const [filtCo, setFiltCo] = useState({ resultado: '' })
  const [modalCo, setModalCo] = useState(null)       // 'nueva' | 'cierre'
  const [correctivaSel, setCorrectivaSel] = useState(null)
  const [formCo, setFormCo] = useState(FORM_CORREC)
  const [formCierre, setFormCierre] = useState(FORM_CIERRE)
  const [sugsEq, setSugsEq] = useState([])
  const [savCo, setSavCo] = useState(false)
  const [errCo, setErrCo] = useState('')

  // ── Inspección ─────────────────────────────────────────────────────────────
  const [equiposActivos, setEquiposActivos] = useState([])
  const [loadInsp, setLoadInsp] = useState(false)
  const [fechaInsp, setFechaInsp] = useState(hoy())
  const [responsableInsp, setResponsableInsp] = useState('')
  const [filaInsp, setFilaInsp] = useState({})
  const [savInsp, setSavInsp] = useState(false)
  const [msgInsp, setMsgInsp] = useState('')
  const [expandedEquipos, setExpandedEquipos] = useState(new Set())
  const toggleEquipo = id => setExpandedEquipos(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })

  const [modoInsp, setModoInsp] = useState('historial') // 'nueva' | 'historial'
  const [histInsp, setHistInsp] = useState([])
  const [loadHistInsp, setLoadHistInsp] = useState(false)
  const [filtHistInsp, setFiltHistInsp] = useState({ desde: '', hasta: '' })
  const [buscarInsp, setBuscarInsp] = useState('')

  // ── Historial ──────────────────────────────────────────────────────────────
  const [historialEq, setHistorialEq] = useState(null)
  const [loadHist, setLoadHist] = useState(false)

  // ══════════════════════════════════════════════════════════════════════════
  // CARGA DE DATOS
  // ══════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    api.get('/mantenimiento/meta').then(r => setMeta(r.data)).catch(() => {})
  }, [])

  const cargarDashboard = useCallback(() => {
    setLoadDash(true)
    api.get('/mantenimiento/dashboard').then(r => setKpis(r.data)).finally(() => setLoadDash(false))
  }, [])

  const cargarEquipos = useCallback(() => {
    setLoadEq(true)
    const p = {}
    if (filtEq.buscar)    p.buscar    = filtEq.buscar
    if (filtEq.categoria) p.categoria = filtEq.categoria
    if (filtEq.ubicacion) p.ubicacion = filtEq.ubicacion
    if (filtEq.estado)    p.estado    = filtEq.estado
    api.get('/mantenimiento/equipos', { params: p }).then(r => setEquipos(r.data)).finally(() => setLoadEq(false))
  }, [filtEq])

  const cargarAlertas = useCallback(() => {
    setLoadAl(true)
    const p = {}
    if (filtAl.estado)    p.estado    = filtAl.estado
    if (filtAl.ubicacion) p.ubicacion = filtAl.ubicacion
    if (filtAl.categoria) p.categoria = filtAl.categoria
    api.get('/mantenimiento/alertas', { params: p }).then(r => setAlertas(r.data)).finally(() => setLoadAl(false))
  }, [filtAl])

  const cargarCorrectivas = useCallback(() => {
    setLoadCo(true)
    const p = {}
    if (filtCo.resultado) p.resultado = filtCo.resultado
    api.get('/mantenimiento/correctivas', { params: p }).then(r => setCorrectivas(r.data)).finally(() => setLoadCo(false))
  }, [filtCo])

  const cargarEquiposActivos = useCallback(() => {
    setLoadInsp(true)
    api.get('/mantenimiento/equipos', { params: { estado: 'activo' } })
      .then(r => {
        setEquiposActivos(r.data)
        const init = {}
        r.data.forEach(e => { init[e.id] = { estado_general: 'OK', ubicacion_verificada: e.ubicacion || '', etiqueta_ok: 1, observaciones: '' } })
        setFilaInsp(init)
      }).finally(() => setLoadInsp(false))
  }, [])

  useEffect(() => { if (tab === 'dashboard')  cargarDashboard() },  [cargarDashboard, tab])
  useEffect(() => { if (tab === 'equipos')    cargarEquipos() },    [cargarEquipos, tab])
  useEffect(() => { if (tab === 'plan')       cargarAlertas() },    [cargarAlertas, tab])
  useEffect(() => { if (tab === 'correctivas') cargarCorrectivas() }, [cargarCorrectivas, tab])
  const cargarHistorialInspecciones = useCallback(() => {
    setLoadHistInsp(true)
    const p = {}
    if (filtHistInsp.desde) p.desde = filtHistInsp.desde
    if (filtHistInsp.hasta) p.hasta = filtHistInsp.hasta
    api.get('/mantenimiento/inspecciones', { params: p })
      .then(r => setHistInsp(r.data))
      .finally(() => setLoadHistInsp(false))
  }, [filtHistInsp])

  useEffect(() => {
    if (tab === 'inspeccion') {
      if (modoInsp === 'historial') cargarHistorialInspecciones()
      else cargarEquiposActivos()
    }
  }, [tab, modoInsp, cargarEquiposActivos, cargarHistorialInspecciones])

  // ══════════════════════════════════════════════════════════════════════════
  // ACCIONES — EQUIPOS
  // ══════════════════════════════════════════════════════════════════════════

  function abrirNuevoEquipo() {
    setFormEq(FORM_EQUIPO); setErrEq(''); setModalEq('nuevo')
  }

  function abrirEditarEquipo(eq) {
    setFormEq({ codigo: eq.codigo, nombre: eq.nombre, categoria: eq.categoria, marca: eq.marca||'', modelo: eq.modelo||'', nro_serie: eq.nro_serie||'', ubicacion: eq.ubicacion||'', observaciones: eq.observaciones||'' })
    setEquipoSel(eq); setErrEq(''); setModalEq('editar')
  }

  async function verDetalleEquipo(eq) {
    setEquipoSel(eq); setModalEq('detalle'); setLoadHist(true)
    try {
      const r = await api.get(`/mantenimiento/equipos/${eq.id}`)
      setEquipoSel(r.data)
    } finally { setLoadHist(false) }
  }

  async function guardarEquipo() {
    setSavEq(true); setErrEq('')
    try {
      if (modalEq === 'nuevo') {
        await api.post('/mantenimiento/equipos', formEq)
      } else {
        await api.put(`/mantenimiento/equipos/${equipoSel.id}`, formEq)
      }
      setModalEq(null); cargarEquipos()
    } catch(e) {
      setErrEq(e.response?.data?.error || 'Error al guardar')
    } finally { setSavEq(false) }
  }

  async function darBaja() {
    if (!motivoBaja.trim()) { setErrEq('Ingresá el motivo de baja'); return }
    setSavEq(true)
    try {
      await api.post(`/mantenimiento/equipos/${equipoSel.id}/baja`, { motivo_baja: motivoBaja })
      setModalEq(null); setMotivoBaja(''); cargarEquipos()
      if (tab === 'dashboard') cargarDashboard()
    } catch(e) {
      setErrEq(e.response?.data?.error || 'Error')
    } finally { setSavEq(false) }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ACCIONES — EJECUCIONES PREVENTIVAS
  // ══════════════════════════════════════════════════════════════════════════

  function abrirRegistrarEjecucion(tarea) {
    setModalEjec(tarea)
    setFormEjec(FORM_EJEC)
    setNokCorrec(false)
    setErrEjec('')
  }

  async function guardarEjecucion() {
    setSavEjec(true); setErrEjec('')
    try {
      await api.post('/mantenimiento/ejecuciones', {
        tarea_id:  modalEjec.tarea_id,
        equipo_id: modalEjec.equipo_id,
        ...formEjec
      })
      if (formEjec.resultado === 'NOK') {
        setNokCorrec(true)
      } else {
        setModalEjec(null)
        cargarAlertas()
        if (tab === 'dashboard') cargarDashboard()
      }
    } catch(e) {
      setErrEjec(e.response?.data?.error || 'Error al registrar')
    } finally { setSavEjec(false) }
  }

  function crearCorrectivaDesdeNOK() {
    const t = modalEjec
    setModalEjec(null)
    setNokCorrec(false)
    setFormCo({
      ...FORM_CORREC,
      equipo_id:       t.equipo_id,
      equipo_texto:    `${t.codigo} — ${t.nombre}`,
      fecha_deteccion: formEjec.fecha,
      descripcion_falla: `Tarea NOK: ${t.componente} — ${t.accion}`,
      responsable:     formEjec.responsable,
    })
    setErrCo('')
    setTab('correctivas')
    setModalCo('nueva')
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ACCIONES — CORRECTIVAS
  // ══════════════════════════════════════════════════════════════════════════

  function buscarEquipoCorrectiva(txt) {
    setFormCo(f => ({ ...f, equipo_texto: txt, equipo_id: '' }))
    if (txt.length < 2) { setSugsEq([]); return }
    api.get('/mantenimiento/equipos', { params: { buscar: txt } })
      .then(r => setSugsEq(r.data.filter(e => e.estado !== 'baja').slice(0, 6)))
      .catch(() => {})
  }

  async function guardarCorrectiva() {
    if (!formCo.equipo_id) { setErrCo('Seleccioná un equipo'); return }
    setSavCo(true); setErrCo('')
    try {
      await api.post('/mantenimiento/correctivas', {
        equipo_id:       formCo.equipo_id,
        fecha_deteccion: formCo.fecha_deteccion,
        fecha_inicio:    formCo.fecha_inicio || null,
        descripcion_falla: formCo.descripcion_falla,
        tipo_servicio:   formCo.tipo_servicio,
        proveedor:       formCo.proveedor || null,
        responsable:     formCo.responsable || null,
        observaciones:   formCo.observaciones || null,
      })
      setModalCo(null); cargarCorrectivas()
    } catch(e) {
      setErrCo(e.response?.data?.error || 'Error al guardar')
    } finally { setSavCo(false) }
  }

  async function cerrarCorrectiva() {
    setSavCo(true); setErrCo('')
    try {
      await api.put(`/mantenimiento/correctivas/${correctivaSel.id}`, {
        ...formCierre,
        costo: formCierre.costo ? parseFloat(formCierre.costo) : null,
      })
      setModalCo(null); cargarCorrectivas()
      if (formCierre.resultado === 'derivado_baja') cargarEquipos()
    } catch(e) {
      setErrCo(e.response?.data?.error || 'Error al cerrar')
    } finally { setSavCo(false) }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ACCIONES — INSPECCIÓN
  // ══════════════════════════════════════════════════════════════════════════

  function actualizarFilaInsp(equipo_id, campo, valor) {
    setFilaInsp(f => ({ ...f, [equipo_id]: { ...f[equipo_id], [campo]: valor } }))
  }

  async function guardarInspeccion() {
    if (!responsableInsp.trim()) { setMsgInsp('Ingresá el responsable'); return }
    setSavInsp(true); setMsgInsp('')
    const registros = equiposActivos.map(e => ({
      equipo_id:           e.id,
      fecha:               fechaInsp,
      responsable:         responsableInsp,
      estado_general:      filaInsp[e.id]?.estado_general      || 'OK',
      ubicacion_verificada: filaInsp[e.id]?.ubicacion_verificada || e.ubicacion || '',
      etiqueta_ok:         filaInsp[e.id]?.etiqueta_ok ?? 1,
      observaciones:       filaInsp[e.id]?.observaciones       || null,
    }))
    try {
      await api.post('/mantenimiento/inspecciones', { registros })
      setMsgInsp(`✓ Inspección guardada: ${registros.length} equipos registrados`)
    } catch(e) {
      setMsgInsp(e.response?.data?.error || 'Error al guardar')
    } finally { setSavInsp(false) }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER HELPERS
  // ══════════════════════════════════════════════════════════════════════════

  function BadgeAlerta({ v }) {
    return <span className={`badge bg-${BADGE_ALERTA[v] || 'secondary'}`}>{LABEL_ALERTA[v] || v}</span>
  }

  function BadgeEstado({ v }) {
    const labels = { activo: 'Activo', en_reparacion: 'En reparación', baja: 'Baja' }
    return <span className={`badge bg-${BADGE_ESTADO[v] || 'secondary'}`}>{labels[v] || v}</span>
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER — DASHBOARD
  // ══════════════════════════════════════════════════════════════════════════

  function TabDashboard() {
    return (
      <div>
        {loadDash && <div className="text-center py-4"><div className="spinner-border text-primary" /></div>}
        {kpis && (
          <>
            <div className="row g-3 mb-4">
              {[
                { label: 'Tareas vencidas',    val: kpis.vencidas,   color: 'danger',  icon: 'bi-exclamation-triangle' },
                { label: 'Próximas a vencer',  val: kpis.proximas,   color: 'warning', icon: 'bi-clock' },
                { label: 'En reparación',       val: kpis.en_rep,     color: 'info',    icon: 'bi-tools' },
                { label: 'Bajas este año',      val: kpis.bajas_anio, color: 'secondary',icon:'bi-archive' },
              ].map(({ label, val, color, icon }) => (
                <div className="col-6 col-md-3" key={label}>
                  <div className={`card border-${color} h-100`}>
                    <div className="card-body d-flex align-items-center gap-3">
                      <i className={`bi ${icon} fs-2 text-${color}`} />
                      <div>
                        <div className={`fs-2 fw-bold text-${color}`}>{val}</div>
                        <div className="text-muted small">{label}</div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <h6 className="fw-bold mb-2">Alertas más urgentes</h6>
            {kpis.urgentes.length === 0
              ? <div className="alert alert-success">No hay tareas vencidas</div>
              : (
                <div className="table-responsive">
                  <table className="table table-sm table-hover">
                    <thead className="table-dark">
                      <tr>
                        <th>Equipo</th><th>Categoría</th><th>Tarea</th><th>Frecuencia</th><th>Última ejec.</th><th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kpis.urgentes.map((a, i) => (
                        <tr key={i}>
                          <td><strong>{a.codigo}</strong><br/><small>{a.nombre}</small></td>
                          <td>{a.categoria}</td>
                          <td>{a.componente} — {a.accion}</td>
                          <td>{a.frecuencia}</td>
                          <td>{fmtF(a.ultima_ejecucion)}{a.dias_desde_ultima != null && <span className="text-muted ms-1">({a.dias_desde_ultima}d)</span>}</td>
                          <td><BadgeAlerta v={a.estado_alerta} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
          </>
        )}
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER — EQUIPOS
  // ══════════════════════════════════════════════════════════════════════════

  function TabEquipos() {
    return (
      <div>
        {/* Filtros */}
        <div className="row g-2 mb-3">
          <div className="col-md-4">
            <input className="form-control" placeholder="Buscar código, nombre, marca..." value={filtEq.buscar}
              onChange={e => setFiltEq(f => ({ ...f, buscar: e.target.value }))} />
          </div>
          <div className="col-md-2">
            <select className="form-select" value={filtEq.categoria} onChange={e => setFiltEq(f => ({ ...f, categoria: e.target.value }))}>
              <option value="">Categoría</option>
              {meta.categorias.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="col-md-2">
            <select className="form-select" value={filtEq.ubicacion} onChange={e => setFiltEq(f => ({ ...f, ubicacion: e.target.value }))}>
              <option value="">Ubicación</option>
              {meta.ubicaciones.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div className="col-md-2">
            <select className="form-select" value={filtEq.estado} onChange={e => setFiltEq(f => ({ ...f, estado: e.target.value }))}>
              <option value="">Estado</option>
              <option value="activo">Activo</option>
              <option value="en_reparacion">En reparación</option>
              <option value="baja">Baja</option>
            </select>
          </div>
          <div className="col-md-2 d-flex gap-2">
            <button className="btn btn-outline-secondary flex-fill" onClick={cargarEquipos}>Buscar</button>
            {canWrite && <button className="btn btn-primary" onClick={abrirNuevoEquipo}><i className="bi bi-plus" /></button>}
          </div>
        </div>

        {loadEq && <div className="text-center py-3"><div className="spinner-border text-primary" /></div>}

        <div className="table-responsive">
          <table className="table table-sm table-hover">
            <thead className="table-dark">
              <tr><th>Código</th><th>Nombre</th><th>Categoría</th><th>Ubicación</th><th>N° Serie</th><th>Estado</th><th></th></tr>
            </thead>
            <tbody>
              {equipos.length === 0 && !loadEq && (
                <tr><td colSpan={7} className="text-center text-muted py-3">Sin resultados</td></tr>
              )}
              {equipos.map(eq => (
                <tr key={eq.id} className={eq.estado === 'baja' ? 'text-muted' : ''}>
                  <td><strong>{eq.codigo}</strong></td>
                  <td>{eq.nombre}</td>
                  <td>{eq.categoria}</td>
                  <td>{eq.ubicacion || '—'}</td>
                  <td><small>{eq.nro_serie || '—'}</small></td>
                  <td><BadgeEstado v={eq.estado} /></td>
                  <td>
                    <div className="btn-group btn-group-sm">
                      <button className="btn btn-outline-secondary" onClick={() => verDetalleEquipo(eq)} title="Ver detalle"><i className="bi bi-eye" /></button>
                      {canWrite && eq.estado !== 'baja' && <>
                        <button className="btn btn-outline-primary" onClick={() => abrirEditarEquipo(eq)} title="Editar"><i className="bi bi-pencil" /></button>
                        <button className="btn btn-outline-danger" onClick={() => { setEquipoSel(eq); setMotivoBaja(''); setErrEq(''); setModalEq('baja') }} title="Dar de baja"><i className="bi bi-archive" /></button>
                      </>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Modal equipo nuevo/editar */}
        {(modalEq === 'nuevo' || modalEq === 'editar') && (
          <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
            <div className="modal-dialog modal-lg">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">{modalEq === 'nuevo' ? 'Nuevo equipo' : 'Editar equipo'}</h5>
                  <button className="btn-close" onClick={() => setModalEq(null)} />
                </div>
                <div className="modal-body">
                  {errEq && <div className="alert alert-danger">{errEq}</div>}
                  <div className="row g-3">
                    <div className="col-md-3">
                      <label className="form-label fw-semibold">Código *</label>
                      <input className="form-control" value={formEq.codigo} onChange={e => setFormEq(f => ({ ...f, codigo: e.target.value }))} placeholder="EQ-001" />
                    </div>
                    <div className="col-md-9">
                      <label className="form-label fw-semibold">Nombre *</label>
                      <input className="form-control" value={formEq.nombre} onChange={e => setFormEq(f => ({ ...f, nombre: e.target.value }))} />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label fw-semibold">Categoría *</label>
                      <input className="form-control" list="cats" value={formEq.categoria} onChange={e => setFormEq(f => ({ ...f, categoria: e.target.value }))} />
                      <datalist id="cats">{meta.categorias.map(c => <option key={c} value={c} />)}</datalist>
                    </div>
                    <div className="col-md-4">
                      <label className="form-label">Marca</label>
                      <input className="form-control" value={formEq.marca} onChange={e => setFormEq(f => ({ ...f, marca: e.target.value }))} />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label">Modelo</label>
                      <input className="form-control" value={formEq.modelo} onChange={e => setFormEq(f => ({ ...f, modelo: e.target.value }))} />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label">N° Serie</label>
                      <input className="form-control" value={formEq.nro_serie} onChange={e => setFormEq(f => ({ ...f, nro_serie: e.target.value }))} />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label">Ubicación</label>
                      <select className="form-select" value={formEq.ubicacion} onChange={e => setFormEq(f => ({ ...f, ubicacion: e.target.value }))}>
                        <option value="">Sin asignar</option>
                        {meta.ubicaciones.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                    <div className="col-12">
                      <label className="form-label">Observaciones</label>
                      <textarea className="form-control" rows={2} value={formEq.observaciones} onChange={e => setFormEq(f => ({ ...f, observaciones: e.target.value }))} />
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={() => setModalEq(null)}>Cancelar</button>
                  <button className="btn btn-primary" onClick={guardarEquipo} disabled={savEq}>
                    {savEq ? <span className="spinner-border spinner-border-sm me-1" /> : null}Guardar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal baja */}
        {modalEq === 'baja' && equipoSel && (
          <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
            <div className="modal-dialog">
              <div className="modal-content">
                <div className="modal-header bg-danger text-white">
                  <h5 className="modal-title">Dar de baja: {equipoSel.codigo}</h5>
                  <button className="btn-close btn-close-white" onClick={() => setModalEq(null)} />
                </div>
                <div className="modal-body">
                  {errEq && <div className="alert alert-danger">{errEq}</div>}
                  <p>{equipoSel.nombre}</p>
                  <label className="form-label fw-semibold">Motivo de baja *</label>
                  <textarea className="form-control" rows={3} value={motivoBaja} onChange={e => setMotivoBaja(e.target.value)} placeholder="Descripción del motivo de baja..." />
                </div>
                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={() => setModalEq(null)}>Cancelar</button>
                  <button className="btn btn-danger" onClick={darBaja} disabled={savEq}>
                    {savEq ? <span className="spinner-border spinner-border-sm me-1" /> : null}Confirmar baja
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal detalle equipo */}
        {modalEq === 'detalle' && equipoSel && (
          <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
            <div className="modal-dialog modal-xl">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">{equipoSel.codigo} — {equipoSel.nombre}</h5>
                  <button className="btn-close" onClick={() => setModalEq(null)} />
                </div>
                <div className="modal-body">
                  {loadHist && <div className="text-center py-3"><div className="spinner-border text-primary" /></div>}
                  {!loadHist && (
                    <>
                      <div className="row g-2 mb-3">
                        {[['Categoría', equipoSel.categoria],['Marca', equipoSel.marca||'—'],['Modelo', equipoSel.modelo||'—'],['N° Serie', equipoSel.nro_serie||'—'],['Ubicación', equipoSel.ubicacion||'—'],['Estado', '']].map(([k,v]) => (
                          <div className="col-6 col-md-2" key={k}>
                            <small className="text-muted d-block">{k}</small>
                            {k === 'Estado' ? <BadgeEstado v={equipoSel.estado} /> : <strong>{v}</strong>}
                          </div>
                        ))}
                        {equipoSel.estado === 'baja' && (
                          <div className="col-12">
                            <div className="alert alert-secondary py-1 mb-0">Baja: {fmtF(equipoSel.fecha_baja)} — {equipoSel.motivo_baja}</div>
                          </div>
                        )}
                      </div>

                      {equipoSel.tareas?.length > 0 && (
                        <>
                          <h6 className="fw-bold">Plan preventivo</h6>
                          <div className="table-responsive mb-3">
                            <table className="table table-sm">
                              <thead className="table-light"><tr><th>Componente</th><th>Acción</th><th>Frecuencia</th><th>Última ejec.</th><th>Estado</th></tr></thead>
                              <tbody>
                                {equipoSel.tareas.map((t, i) => (
                                  <tr key={i}>
                                    <td>{t.componente}</td><td>{t.accion}</td><td>{t.frecuencia}</td>
                                    <td>{fmtF(t.ultima_ejecucion)}</td>
                                    <td><BadgeAlerta v={t.estado_alerta} /></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </>
                      )}

                      {equipoSel.correctivas?.length > 0 && (
                        <>
                          <h6 className="fw-bold">Últimas correctivas</h6>
                          <div className="table-responsive">
                            <table className="table table-sm">
                              <thead className="table-light"><tr><th>Detección</th><th>Falla</th><th>Resultado</th><th>Responsable</th></tr></thead>
                              <tbody>
                                {equipoSel.correctivas.map(c => (
                                  <tr key={c.id}>
                                    <td>{fmtF(c.fecha_deteccion)}</td>
                                    <td>{c.descripcion_falla}</td>
                                    <td><span className={`badge bg-${BADGE_RESULTADO[c.resultado]||'secondary'}`}>{c.resultado}</span></td>
                                    <td>{c.responsable||'—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={() => setModalEq(null)}>Cerrar</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER — PLAN PREVENTIVO
  // ══════════════════════════════════════════════════════════════════════════

  function TabPlan() {
    const conteo = { vencida: 0, proxima: 0, nunca_ejecutada: 0, al_dia: 0 }
    alertas.forEach(a => { if (conteo[a.estado_alerta] !== undefined) conteo[a.estado_alerta]++ })

    return (
      <div>
        <div className="d-flex gap-3 mb-3 flex-wrap">
          {[['vencida','danger'],['proxima','warning'],['nunca_ejecutada','secondary'],['al_dia','success']].map(([e,c]) => (
            <span key={e} className={`badge bg-${c} fs-6`}>{LABEL_ALERTA[e]}: {conteo[e]}</span>
          ))}
        </div>

        <div className="row g-2 mb-3">
          <div className="col-md-3">
            <select className="form-select" value={filtAl.estado} onChange={e => setFiltAl(f => ({ ...f, estado: e.target.value }))}>
              <option value="">Todos los estados</option>
              <option value="vencida">Vencida</option>
              <option value="proxima">Próxima</option>
              <option value="nunca_ejecutada">Sin ejecutar</option>
              <option value="al_dia">Al día</option>
            </select>
          </div>
          <div className="col-md-2">
            <select className="form-select" value={filtAl.ubicacion} onChange={e => setFiltAl(f => ({ ...f, ubicacion: e.target.value }))}>
              <option value="">Ubicación</option>
              {meta.ubicaciones.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div className="col-md-3">
            <select className="form-select" value={filtAl.categoria} onChange={e => setFiltAl(f => ({ ...f, categoria: e.target.value }))}>
              <option value="">Categoría</option>
              {meta.categorias.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="col-md-2">
            <button className="btn btn-outline-secondary w-100" onClick={cargarAlertas}>Filtrar</button>
          </div>
        </div>

        {loadAl && <div className="text-center py-3"><div className="spinner-border text-primary" /></div>}

        {!loadAl && (() => {
          // Agrupar por equipo
          const PRIO = { vencida: 4, proxima: 3, nunca_ejecutada: 2, manual: 1, al_dia: 0 }
          const mapaEq = {}
          alertas.forEach(a => {
            if (!mapaEq[a.equipo_id]) mapaEq[a.equipo_id] = { equipo_id: a.equipo_id, codigo: a.codigo, nombre: a.nombre, categoria: a.categoria, ubicacion: a.ubicacion, tareas: [] }
            mapaEq[a.equipo_id].tareas.push(a)
          })
          const grupos = Object.values(mapaEq)
          const peor = tareas => tareas.reduce((b, t) => PRIO[t.estado_alerta] > PRIO[b] ? t.estado_alerta : b, 'al_dia')

          if (!grupos.length) return <p className="text-muted text-center py-3">Sin resultados</p>

          return (
            <div>
              <div className="d-flex gap-2 mb-2 justify-content-end">
                <button className="btn btn-sm btn-outline-secondary" onClick={() => setExpandedEquipos(new Set(grupos.map(g => g.equipo_id)))}>
                  <i className="bi bi-chevron-expand me-1" />Expandir todo
                </button>
                <button className="btn btn-sm btn-outline-secondary" onClick={() => setExpandedEquipos(new Set())}>
                  <i className="bi bi-chevron-contract me-1" />Colapsar todo
                </button>
              </div>

              {grupos.map(eq => {
                const p = peor(eq.tareas)
                const abierto = expandedEquipos.has(eq.equipo_id)
                const bgCls = p === 'vencida' ? 'border-danger bg-danger bg-opacity-10'
                            : p === 'proxima' ? 'border-warning bg-warning bg-opacity-10'
                            : 'border-secondary bg-light'
                return (
                  <div key={eq.equipo_id} className="mb-1 border rounded overflow-hidden">
                    <div
                      className={`d-flex align-items-center justify-content-between px-3 py-2 ${bgCls}`}
                      style={{ cursor: 'pointer' }}
                      onClick={() => toggleEquipo(eq.equipo_id)}
                    >
                      <div>
                        <strong>{eq.codigo}</strong>
                        <span className="ms-2">{eq.nombre}</span>
                        <small className="ms-2 text-muted">{eq.categoria}</small>
                      </div>
                      <div className="d-flex align-items-center gap-3">
                        <small className="text-muted">{eq.ubicacion}</small>
                        <BadgeAlerta v={p} />
                        <small className="text-muted">{eq.tareas.length} tarea{eq.tareas.length !== 1 ? 's' : ''}</small>
                        <i className={`bi bi-chevron-${abierto ? 'up' : 'down'} text-muted`} />
                      </div>
                    </div>

                    {abierto && (
                      <div className="table-responsive">
                        <table className="table table-sm table-hover mb-0">
                          <thead className="table-light">
                            <tr>
                              <th>Componente</th><th>Acción</th><th>Tipo</th><th>Frecuencia</th>
                              <th>Última ejec.</th><th>Días</th><th>Estado</th>
                              {canWrite && <th></th>}
                            </tr>
                          </thead>
                          <tbody>
                            {eq.tareas.map((a, i) => (
                              <tr key={i} className={a.estado_alerta === 'vencida' ? 'table-danger' : a.estado_alerta === 'proxima' ? 'table-warning' : ''}>
                                <td>{a.componente}</td>
                                <td>{a.accion}</td>
                                <td><small className="text-muted">{a.tipo}</small></td>
                                <td>{a.frecuencia}</td>
                                <td>{fmtF(a.ultima_ejecucion)}</td>
                                <td>{a.dias_desde_ultima != null ? `${a.dias_desde_ultima}d` : '—'}</td>
                                <td><BadgeAlerta v={a.estado_alerta} /></td>
                                {canWrite && (
                                  <td>
                                    <button className="btn btn-sm btn-outline-primary" onClick={e => { e.stopPropagation(); abrirRegistrarEjecucion(a) }}>
                                      <i className="bi bi-check2-circle me-1" />Registrar
                                    </button>
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        })()}

        {/* Modal registrar ejecución */}
        {modalEjec && (
          <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
            <div className="modal-dialog">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Registrar ejecución</h5>
                  <button className="btn-close" onClick={() => { setModalEjec(null); setNokCorrec(false) }} />
                </div>
                <div className="modal-body">
                  <div className="alert alert-light py-2">
                    <strong>{modalEjec.codigo}</strong> — {modalEjec.nombre}<br/>
                    <small>{modalEjec.componente} · {modalEjec.accion}</small>
                  </div>
                  {errEjec && <div className="alert alert-danger">{errEjec}</div>}

                  {nokCorrec ? (
                    <div className="alert alert-warning">
                      <strong>Resultado NOK registrado.</strong><br/>
                      ¿Querés crear una intervención correctiva?
                      <div className="mt-2 d-flex gap-2">
                        <button className="btn btn-warning btn-sm" onClick={crearCorrectivaDesdeNOK}>Sí, crear correctiva</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => { setModalEjec(null); setNokCorrec(false); cargarAlertas() }}>No, cerrar</button>
                      </div>
                    </div>
                  ) : (
                    <div className="row g-3">
                      <div className="col-md-6">
                        <label className="form-label fw-semibold">Fecha *</label>
                        <input type="date" className="form-control" value={formEjec.fecha} onChange={e => setFormEjec(f => ({ ...f, fecha: e.target.value }))} />
                      </div>
                      <div className="col-md-6">
                        <label className="form-label fw-semibold">Resultado *</label>
                        <select className="form-select" value={formEjec.resultado} onChange={e => setFormEjec(f => ({ ...f, resultado: e.target.value }))}>
                          <option value="OK">OK</option>
                          <option value="NOK">NOK</option>
                          <option value="Cuarentena">Cuarentena</option>
                        </select>
                      </div>
                      <div className="col-12">
                        <label className="form-label">Responsable</label>
                        <input className="form-control" value={formEjec.responsable} onChange={e => setFormEjec(f => ({ ...f, responsable: e.target.value }))} />
                      </div>
                      <div className="col-12">
                        <label className="form-label">Observaciones</label>
                        <textarea className="form-control" rows={2} value={formEjec.observaciones} onChange={e => setFormEjec(f => ({ ...f, observaciones: e.target.value }))} />
                      </div>
                    </div>
                  )}
                </div>
                {!nokCorrec && (
                  <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={() => setModalEjec(null)}>Cancelar</button>
                    <button className="btn btn-primary" onClick={guardarEjecucion} disabled={savEjec}>
                      {savEjec ? <span className="spinner-border spinner-border-sm me-1" /> : null}Guardar
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER — CORRECTIVAS
  // ══════════════════════════════════════════════════════════════════════════

  function TabCorrectivas() {
    return (
      <div>
        <div className="d-flex gap-2 mb-3">
          <select className="form-select w-auto" value={filtCo.resultado} onChange={e => setFiltCo(f => ({ ...f, resultado: e.target.value }))}>
            <option value="">Todos</option>
            <option value="pendiente">Pendiente</option>
            <option value="resuelto">Resuelto</option>
            <option value="derivado_baja">Derivado a baja</option>
          </select>
          <button className="btn btn-outline-secondary" onClick={cargarCorrectivas}>Filtrar</button>
          {canWrite && (
            <button className="btn btn-primary ms-auto" onClick={() => { setFormCo(FORM_CORREC); setErrCo(''); setSugsEq([]); setModalCo('nueva') }}>
              <i className="bi bi-plus me-1" />Nueva correctiva
            </button>
          )}
        </div>

        {loadCo && <div className="text-center py-3"><div className="spinner-border text-primary" /></div>}

        <div className="table-responsive">
          <table className="table table-sm table-hover">
            <thead className="table-dark">
              <tr><th>Equipo</th><th>Detección</th><th>Falla</th><th>Tipo</th><th>Responsable</th><th>Estado</th>{canWrite && <th></th>}</tr>
            </thead>
            <tbody>
              {correctivas.length === 0 && !loadCo && (
                <tr><td colSpan={7} className="text-center text-muted py-3">Sin resultados</td></tr>
              )}
              {correctivas.map(c => (
                <tr key={c.id}>
                  <td><strong>{c.codigo}</strong><br/><small>{c.equipo_nombre}</small></td>
                  <td>{fmtF(c.fecha_deteccion)}</td>
                  <td>{c.descripcion_falla}</td>
                  <td><span className="badge bg-secondary">{c.tipo_servicio}</span></td>
                  <td>{c.responsable||'—'}</td>
                  <td><span className={`badge bg-${BADGE_RESULTADO[c.resultado]||'secondary'}`}>{c.resultado}</span></td>
                  {canWrite && (
                    <td>
                      {c.resultado === 'pendiente' && (
                        <button className="btn btn-sm btn-outline-success" onClick={() => {
                          setCorrectivaSel(c)
                          setFormCierre({ ...FORM_CIERRE, tipo_servicio: c.tipo_servicio })
                          setErrCo('')
                          setModalCo('cierre')
                        }}>
                          <i className="bi bi-check-circle me-1" />Cerrar
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Modal nueva correctiva */}
        {modalCo === 'nueva' && (
          <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
            <div className="modal-dialog modal-lg">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Nueva intervención correctiva</h5>
                  <button className="btn-close" onClick={() => setModalCo(null)} />
                </div>
                <div className="modal-body">
                  {errCo && <div className="alert alert-danger">{errCo}</div>}
                  <div className="row g-3">
                    <div className="col-12">
                      <label className="form-label fw-semibold">Equipo *</label>
                      <div className="position-relative">
                        <input className="form-control" placeholder="Buscar por código o nombre..."
                          value={formCo.equipo_texto}
                          onChange={e => buscarEquipoCorrectiva(e.target.value)} />
                        {sugsEq.length > 0 && (
                          <div className="list-group position-absolute w-100" style={{ zIndex: 1000 }}>
                            {sugsEq.map(e => (
                              <button key={e.id} type="button" className="list-group-item list-group-item-action py-1"
                                onClick={() => { setFormCo(f => ({ ...f, equipo_id: e.id, equipo_texto: `${e.codigo} — ${e.nombre}` })); setSugsEq([]) }}>
                                <strong>{e.codigo}</strong> — {e.nombre} <small className="text-muted">({e.categoria})</small>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="col-md-6">
                      <label className="form-label fw-semibold">Fecha detección *</label>
                      <input type="date" className="form-control" value={formCo.fecha_deteccion} onChange={e => setFormCo(f => ({ ...f, fecha_deteccion: e.target.value }))} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">Fecha inicio reparación</label>
                      <input type="date" className="form-control" value={formCo.fecha_inicio} onChange={e => setFormCo(f => ({ ...f, fecha_inicio: e.target.value }))} />
                    </div>
                    <div className="col-12">
                      <label className="form-label fw-semibold">Descripción de la falla *</label>
                      <textarea className="form-control" rows={2} value={formCo.descripcion_falla} onChange={e => setFormCo(f => ({ ...f, descripcion_falla: e.target.value }))} />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label">Tipo de servicio</label>
                      <select className="form-select" value={formCo.tipo_servicio} onChange={e => setFormCo(f => ({ ...f, tipo_servicio: e.target.value }))}>
                        <option value="interno">Interno</option>
                        <option value="externo">Externo</option>
                      </select>
                    </div>
                    {formCo.tipo_servicio === 'externo' && (
                      <div className="col-md-8">
                        <label className="form-label">Proveedor</label>
                        <input className="form-control" value={formCo.proveedor} onChange={e => setFormCo(f => ({ ...f, proveedor: e.target.value }))} />
                      </div>
                    )}
                    <div className="col-md-6">
                      <label className="form-label">Responsable</label>
                      <input className="form-control" value={formCo.responsable} onChange={e => setFormCo(f => ({ ...f, responsable: e.target.value }))} />
                    </div>
                    <div className="col-12">
                      <label className="form-label">Observaciones</label>
                      <textarea className="form-control" rows={2} value={formCo.observaciones} onChange={e => setFormCo(f => ({ ...f, observaciones: e.target.value }))} />
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={() => setModalCo(null)}>Cancelar</button>
                  <button className="btn btn-primary" onClick={guardarCorrectiva} disabled={savCo}>
                    {savCo ? <span className="spinner-border spinner-border-sm me-1" /> : null}Guardar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Modal cierre correctiva */}
        {modalCo === 'cierre' && correctivaSel && (
          <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
            <div className="modal-dialog modal-lg">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Cerrar correctiva — {correctivaSel.codigo}</h5>
                  <button className="btn-close" onClick={() => setModalCo(null)} />
                </div>
                <div className="modal-body">
                  <div className="alert alert-light py-2 mb-3">
                    <strong>Falla:</strong> {correctivaSel.descripcion_falla}
                  </div>
                  {errCo && <div className="alert alert-danger">{errCo}</div>}
                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="form-label">Fecha fin</label>
                      <input type="date" className="form-control" value={formCierre.fecha_fin} onChange={e => setFormCierre(f => ({ ...f, fecha_fin: e.target.value }))} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label fw-semibold">Resultado *</label>
                      <select className="form-select" value={formCierre.resultado} onChange={e => setFormCierre(f => ({ ...f, resultado: e.target.value }))}>
                        <option value="resuelto">Resuelto</option>
                        <option value="derivado_baja">Derivado a baja del equipo</option>
                        <option value="pendiente">Pendiente</option>
                      </select>
                    </div>
                    {formCierre.resultado === 'derivado_baja' && (
                      <div className="col-12">
                        <div className="alert alert-warning py-2">El equipo pasará a estado <strong>Baja</strong> al guardar.</div>
                      </div>
                    )}
                    <div className="col-12">
                      <label className="form-label">Acción realizada</label>
                      <textarea className="form-control" rows={2} value={formCierre.accion_realizada} onChange={e => setFormCierre(f => ({ ...f, accion_realizada: e.target.value }))} />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label">Tipo de servicio</label>
                      <select className="form-select" value={formCierre.tipo_servicio} onChange={e => setFormCierre(f => ({ ...f, tipo_servicio: e.target.value }))}>
                        <option value="interno">Interno</option>
                        <option value="externo">Externo</option>
                      </select>
                    </div>
                    {formCierre.tipo_servicio === 'externo' && (
                      <div className="col-md-8">
                        <label className="form-label">Proveedor</label>
                        <input className="form-control" value={formCierre.proveedor} onChange={e => setFormCierre(f => ({ ...f, proveedor: e.target.value }))} />
                      </div>
                    )}
                    <div className="col-md-4">
                      <label className="form-label">Costo (ARS)</label>
                      <input type="number" className="form-control" value={formCierre.costo} onChange={e => setFormCierre(f => ({ ...f, costo: e.target.value }))} />
                    </div>
                    <div className="col-md-8">
                      <label className="form-label">Repuestos usados</label>
                      <input className="form-control" value={formCierre.repuestos_usados} onChange={e => setFormCierre(f => ({ ...f, repuestos_usados: e.target.value }))} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">Responsable</label>
                      <input className="form-control" value={formCierre.responsable} onChange={e => setFormCierre(f => ({ ...f, responsable: e.target.value }))} />
                    </div>
                    <div className="col-12">
                      <label className="form-label">Observaciones</label>
                      <textarea className="form-control" rows={2} value={formCierre.observaciones} onChange={e => setFormCierre(f => ({ ...f, observaciones: e.target.value }))} />
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={() => setModalCo(null)}>Cancelar</button>
                  <button className="btn btn-success" onClick={cerrarCorrectiva} disabled={savCo}>
                    {savCo ? <span className="spinner-border spinner-border-sm me-1" /> : null}Cerrar correctiva
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER — INSPECCIÓN
  // ══════════════════════════════════════════════════════════════════════════

  function TabInspeccion() {
    const BADGE_INSP = { OK: 'success', NOK: 'danger', requiere_atencion: 'warning', en_reparacion: 'info' }
    const LABEL_INSP = { OK: 'OK', NOK: 'NOK', requiere_atencion: 'Requiere atención', en_reparacion: 'En reparación' }

    // filtro local del historial por búsqueda de equipo
    const histFiltrado = buscarInsp
      ? histInsp.filter(r => r.codigo?.toLowerCase().includes(buscarInsp.toLowerCase()) || r.equipo_nombre?.toLowerCase().includes(buscarInsp.toLowerCase()))
      : histInsp

    return (
      <div>
        {/* Toggle modo */}
        <div className="btn-group mb-4">
          <button className={`btn ${modoInsp === 'historial' ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => setModoInsp('historial')}>
            <i className="bi bi-clock-history me-1" />Historial F14
          </button>
          {canWrite && (
            <button className={`btn ${modoInsp === 'nueva' ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => setModoInsp('nueva')}>
              <i className="bi bi-clipboard-plus me-1" />Nueva ronda
            </button>
          )}
        </div>

        {/* ── HISTORIAL ─────────────────────────────────────────────────────── */}
        {modoInsp === 'historial' && (
          <div>
            <div className="row g-2 mb-3">
              <div className="col-md-3">
                <input className="form-control" placeholder="Buscar equipo..." value={buscarInsp}
                  onChange={e => setBuscarInsp(e.target.value)} />
              </div>
              <div className="col-md-2">
                <label className="form-label small mb-1">Desde</label>
                <input type="date" className="form-control" value={filtHistInsp.desde}
                  onChange={e => setFiltHistInsp(f => ({ ...f, desde: e.target.value }))} />
              </div>
              <div className="col-md-2">
                <label className="form-label small mb-1">Hasta</label>
                <input type="date" className="form-control" value={filtHistInsp.hasta}
                  onChange={e => setFiltHistInsp(f => ({ ...f, hasta: e.target.value }))} />
              </div>
              <div className="col-md-2 d-flex align-items-end">
                <button className="btn btn-outline-secondary w-100" onClick={cargarHistorialInspecciones}>Filtrar</button>
              </div>
            </div>

            {loadHistInsp && <div className="text-center py-3"><div className="spinner-border text-primary" /></div>}

            {!loadHistInsp && (
              <>
                <p className="text-muted small">{histFiltrado.length} registros</p>
                <div className="table-responsive">
                  <table className="table table-sm table-hover">
                    <thead className="table-dark">
                      <tr>
                        <th>Fecha</th>
                        <th>Código</th>
                        <th>Equipo</th>
                        <th>Estado</th>
                        <th>Ubicación verif.</th>
                        <th style={{ width: 80 }}>Etiqueta</th>
                        <th>Observaciones</th>
                        <th>Responsable</th>
                      </tr>
                    </thead>
                    <tbody>
                      {histFiltrado.length === 0 && (
                        <tr><td colSpan={8} className="text-center text-muted py-3">Sin registros</td></tr>
                      )}
                      {histFiltrado.map(r => (
                        <tr key={r.id} className={r.estado_general === 'NOK' ? 'table-danger' : r.estado_general === 'requiere_atencion' ? 'table-warning' : ''}>
                          <td>{fmtF(r.fecha)}</td>
                          <td><strong>{r.codigo}</strong></td>
                          <td><small>{r.equipo_nombre}</small></td>
                          <td>
                            <span className={`badge bg-${BADGE_INSP[r.estado_general] || 'secondary'}`}>
                              {LABEL_INSP[r.estado_general] || r.estado_general}
                            </span>
                          </td>
                          <td>{r.ubicacion_verificada || '—'}</td>
                          <td className="text-center">
                            {r.etiqueta_ok ? <i className="bi bi-check-circle text-success" /> : <i className="bi bi-x-circle text-danger" />}
                          </td>
                          <td><small>{r.observaciones || '—'}</small></td>
                          <td><small>{r.responsable || '—'}</small></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── NUEVA RONDA ───────────────────────────────────────────────────── */}
        {modoInsp === 'nueva' && (
          <div>
            <div className="row g-3 mb-3 align-items-end">
              <div className="col-md-3">
                <label className="form-label fw-semibold">Fecha de inspección</label>
                <input type="date" className="form-control" value={fechaInsp} onChange={e => setFechaInsp(e.target.value)} />
              </div>
              <div className="col-md-4">
                <label className="form-label fw-semibold">Responsable</label>
                <input className="form-control" placeholder="Nombre del inspector" value={responsableInsp} onChange={e => setResponsableInsp(e.target.value)} />
              </div>
              <div className="col-md-3">
                <button className="btn btn-outline-secondary w-100" onClick={cargarEquiposActivos}>
                  <i className="bi bi-arrow-clockwise me-1" />Recargar equipos
                </button>
              </div>
            </div>

            {msgInsp && <div className={`alert ${msgInsp.startsWith('✓') ? 'alert-success' : 'alert-danger'} py-2`}>{msgInsp}</div>}
            {loadInsp && <div className="text-center py-3"><div className="spinner-border text-primary" /></div>}

            {!loadInsp && equiposActivos.length > 0 && (
              <>
                <p className="text-muted"><i className="bi bi-info-circle me-1" />{equiposActivos.length} equipos activos. Completá el estado de cada uno.</p>
                <div className="table-responsive">
                  <table className="table table-sm table-bordered">
                    <thead className="table-dark">
                      <tr>
                        <th style={{ width: 90 }}>Código</th>
                        <th>Nombre</th>
                        <th style={{ width: 120 }}>Planta</th>
                        <th style={{ width: 160 }}>Estado general</th>
                        <th style={{ width: 140 }}>Ubicación verif.</th>
                        <th style={{ width: 80 }}>Etiqueta</th>
                        <th>Observaciones</th>
                      </tr>
                    </thead>
                    <tbody>
                      {equiposActivos.map(eq => {
                        const fila = filaInsp[eq.id] || {}
                        return (
                          <tr key={eq.id} className={fila.estado_general === 'NOK' ? 'table-danger' : fila.estado_general === 'requiere_atencion' ? 'table-warning' : ''}>
                            <td><strong>{eq.codigo}</strong></td>
                            <td><small>{eq.nombre}</small></td>
                            <td><small>{eq.ubicacion || '—'}</small></td>
                            <td>
                              <select className="form-select form-select-sm" value={fila.estado_general || 'OK'}
                                onChange={e => actualizarFilaInsp(eq.id, 'estado_general', e.target.value)}>
                                <option value="OK">OK</option>
                                <option value="requiere_atencion">Requiere atención</option>
                                <option value="NOK">NOK</option>
                                <option value="en_reparacion">En reparación</option>
                              </select>
                            </td>
                            <td>
                              <select className="form-select form-select-sm" value={fila.ubicacion_verificada || ''}
                                onChange={e => actualizarFilaInsp(eq.id, 'ubicacion_verificada', e.target.value)}>
                                <option value="">—</option>
                                <option value="MIGUENS">MIGUENS</option>
                                <option value="POGGIO">POGGIO</option>
                              </select>
                            </td>
                            <td className="text-center">
                              <div className="form-check form-check-inline m-0">
                                <input type="checkbox" className="form-check-input" checked={fila.etiqueta_ok === 1 || fila.etiqueta_ok === true}
                                  onChange={e => actualizarFilaInsp(eq.id, 'etiqueta_ok', e.target.checked ? 1 : 0)} />
                              </div>
                            </td>
                            <td>
                              <input className="form-control form-control-sm" value={fila.observaciones || ''}
                                onChange={e => actualizarFilaInsp(eq.id, 'observaciones', e.target.value)}
                                placeholder="Observaciones..." />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="d-flex justify-content-end mt-3">
                  <button className="btn btn-success px-4" onClick={guardarInspeccion} disabled={savInsp}>
                    {savInsp ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="bi bi-check2-all me-1" />}
                    Guardar inspección ({equiposActivos.length} equipos)
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER PRINCIPAL
  // ══════════════════════════════════════════════════════════════════════════

  const tabs = [
    { id: 'dashboard',   label: 'Dashboard',       icon: 'bi-speedometer2' },
    { id: 'equipos',     label: 'Equipos',          icon: 'bi-tools' },
    { id: 'plan',        label: 'Plan preventivo',  icon: 'bi-calendar-check' },
    { id: 'correctivas', label: 'Correctivas',      icon: 'bi-wrench' },
    { id: 'inspeccion',  label: 'Inspección',       icon: 'bi-clipboard-check' },
  ]

  return (
    <div className="container-fluid py-3">
      <h4 className="fw-bold mb-3"><i className="bi bi-tools me-2" />Mantenimiento</h4>

      <ul className="nav nav-tabs mb-4">
        {tabs.map(t => (
          <li className="nav-item" key={t.id}>
            <button className={`nav-link ${tab === t.id ? 'active fw-semibold' : ''}`} onClick={() => setTab(t.id)}>
              <i className={`bi ${t.icon} me-1`} />{t.label}
              {t.id === 'plan' && kpis?.vencidas > 0 && (
                <span className="badge bg-danger ms-1">{kpis.vencidas}</span>
              )}
            </button>
          </li>
        ))}
      </ul>

      {tab === 'dashboard'   && <TabDashboard />}
      {tab === 'equipos'     && <TabEquipos />}
      {tab === 'plan'        && <TabPlan />}
      {tab === 'correctivas' && <TabCorrectivas />}
      {tab === 'inspeccion'  && TabInspeccion()}
    </div>
  )
}
