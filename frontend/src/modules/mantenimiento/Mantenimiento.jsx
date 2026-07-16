import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import api from '../../api/client'
import { puedeEscribir, getUser } from '../../store/authStore'
import EmpleadoSelect from '../../components/EmpleadoSelect'
import DateInput from '../../components/DateInput'

const hoy = () => new Date().toISOString().slice(0, 10)
const fmtF = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—'
const fmtN = n => n != null ? new Intl.NumberFormat('es-AR').format(n) : '—'

const BADGE_ALERTA  = { vencida: 'danger', proxima: 'warning', al_dia: 'success', nunca_ejecutada: 'secondary', manual: 'info' }
const LABEL_ALERTA  = { vencida: 'Vencida', proxima: 'Próxima', al_dia: 'Al día', nunca_ejecutada: 'Sin ejecutar', manual: 'Luego de c/uso' }
const BADGE_ESTADO  = { activo: 'success', en_reparacion: 'warning', baja: 'secondary' }
const BADGE_RESULTADO = { resuelto: 'success', pendiente: 'warning', derivado_baja: 'secondary' }

const FRECUENCIAS = ['Semanal','Mensual','Bimestral','Trimestral','Semestral','Anual','Luego de c/uso']
const FREC_DIAS   = { Semanal: 7, Mensual: 30, Bimestral: 60, Trimestral: 90, Semestral: 180, Anual: 365, 'Luego de c/uso': 0 }
const FORM_TAREA  = { componente: '', accion: '', tipo: '', frecuencia: 'Mensual', frecuencia_dias: 30, activa: 1 }

const FORM_EQUIPO = { codigo: '', nombre: '', categoria: '', marca: '', modelo: '', nro_serie: '', ubicacion: '', observaciones: '' }
const FORM_EJEC   = { fecha: hoy(), resultado: 'OK', observaciones: '', responsable: '' }
const FORM_CORREC = { equipo_id: '', equipo_texto: '', fecha_deteccion: hoy(), fecha_inicio: '', descripcion_falla: '', tipo_servicio: 'interno', proveedor: '', responsable: '', observaciones: '' }
const FORM_CIERRE = { fecha_fin: hoy(), accion_realizada: '', tipo_servicio: 'interno', proveedor: '', costo: '', repuestos_usados: '', resultado: 'resuelto', responsable: '', observaciones: '' }

export default function Mantenimiento() {
  const canWrite = puedeEscribir('mantenimiento')
  const userResponsable = (() => { const u = getUser(); return u?.empleado_nombre || u?.nombre || '' })()
  const [tab, setTab]   = useState('dashboard')
  const [meta, setMeta] = useState({ categorias: [], ubicaciones: ['MIGUENS', 'POGGIO'] })

  // ── Dashboard ──────────────────────────────────────────────────────────────
  const [kpis, setKpis]       = useState(null)
  const [loadDash, setLoadDash] = useState(false)

  // ── Equipos ────────────────────────────────────────────────────────────────
  const [equipos, setEquipos]   = useState([])
  const [loadEq, setLoadEq]     = useState(false)
  const [filtEq, setFiltEq]     = useState({ buscar: '', categoria: '', ubicacion: '', estado: '' })
  const [modalEq, setModalEq]   = useState(null)
  const [equipoSel, setEquipoSel] = useState(null)
  const [formEq, setFormEq]     = useState(FORM_EQUIPO)
  const [motivoBaja, setMotivoBaja] = useState('')
  const [savEq, setSavEq]       = useState(false)
  const [errEq, setErrEq]       = useState('')

  // ── Plan preventivo ────────────────────────────────────────────────────────
  const [alertas, setAlertas]   = useState([])
  const [loadAl, setLoadAl]     = useState(false)
  const [filtAl, setFiltAl]     = useState({ estado: '', ubicacion: '', categoria: '' })
  const [modalEjec, setModalEjec] = useState(null)
  const [formEjec, setFormEjec] = useState(FORM_EJEC)
  const [savEjec, setSavEjec]   = useState(false)
  const [errEjec, setErrEjec]   = useState('')
  const [nokCorrec, setNokCorrec] = useState(false)
  const [expandedEquipos, setExpandedEquipos] = useState(new Set())
  const toggleEquipo = id => setExpandedEquipos(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  const [selectedEquipos, setSelectedEquipos] = useState(new Set())

  // ── Correctivas ────────────────────────────────────────────────────────────
  const [correctivas, setCorrectivas] = useState([])
  const [loadCo, setLoadCo]           = useState(false)
  const [filtCo, setFiltCo]           = useState({ resultado: '' })
  const [modalCo, setModalCo]         = useState(null)
  const [correctivaSel, setCorrectivaSel] = useState(null)
  const [formCo, setFormCo]           = useState(FORM_CORREC)
  const [formCierre, setFormCierre]   = useState(FORM_CIERRE)
  const [sugsEq, setSugsEq]           = useState([])
  const [savCo, setSavCo]             = useState(false)
  const [errCo, setErrCo]             = useState('')
  const [perfilEquipo, setPerfilEquipo] = useState(null)

  // ── Gestión de tareas por equipo ──────────────────────────────────────────
  const [modalTareas, setModalTareas]   = useState(null)   // equipo seleccionado
  const [tareas, setTareas]             = useState([])
  const [loadTareas, setLoadTareas]     = useState(false)
  const [formTarea, setFormTarea]       = useState(null)   // null=oculto | {}=nuevo | {id}=editar
  const [savTarea, setSavTarea]         = useState(false)
  const [errTarea, setErrTarea]         = useState('')

  // ── Historial F14 ──────────────────────────────────────────────────────────
  const [histInsp, setHistInsp]       = useState([])
  const [loadHistInsp, setLoadHistInsp] = useState(false)
  const [filtHistInsp, setFiltHistInsp] = useState({ desde: '', hasta: '', tipo: '', estado_equipo: '', buscar: '' })
  const [detalleHistorial, setDetalleHistorial] = useState(null)

  // ── Historial equipo ───────────────────────────────────────────────────────
  const [loadHist, setLoadHist]       = useState(false)

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
    api.get('/mantenimiento/alertas', { params: p }).then(r => {
      setAlertas(r.data)
      setSelectedEquipos(new Set())
    }).finally(() => setLoadAl(false))
  }, [filtAl])

  const cargarCorrectivas = useCallback(() => {
    setLoadCo(true)
    const p = {}
    if (filtCo.resultado) p.resultado = filtCo.resultado
    api.get('/mantenimiento/correctivas', { params: p }).then(r => setCorrectivas(r.data)).finally(() => setLoadCo(false))
  }, [filtCo])

  const cargarHistorialInspecciones = useCallback(() => {
    setLoadHistInsp(true)
    const p = {}
    if (filtHistInsp.desde)         p.desde         = filtHistInsp.desde
    if (filtHistInsp.hasta)         p.hasta         = filtHistInsp.hasta
    if (filtHistInsp.tipo)          p.tipo          = filtHistInsp.tipo
    if (filtHistInsp.estado_equipo) p.estado_equipo = filtHistInsp.estado_equipo
    api.get('/mantenimiento/historial', { params: p })
      .then(r => setHistInsp(r.data))
      .finally(() => setLoadHistInsp(false))
  }, [filtHistInsp])

  useEffect(() => { if (tab === 'dashboard')   cargarDashboard() },           [cargarDashboard, tab])
  useEffect(() => { if (tab === 'equipos')     cargarEquipos() },             [cargarEquipos, tab])
  useEffect(() => { if (tab === 'plan')        cargarAlertas() },             [cargarAlertas, tab])
  useEffect(() => { if (tab === 'correctivas') cargarCorrectivas() },         [cargarCorrectivas, tab])
  useEffect(() => { if (tab === 'historial')   cargarHistorialInspecciones() }, [cargarHistorialInspecciones, tab])

  // ══════════════════════════════════════════════════════════════════════════
  // ACCIONES — EQUIPOS
  // ══════════════════════════════════════════════════════════════════════════

  function abrirNuevoEquipo() { setFormEq(FORM_EQUIPO); setErrEq(''); setModalEq('nuevo') }

  function abrirEditarEquipo(eq) {
    setFormEq({ codigo: eq.codigo, nombre: eq.nombre, categoria: eq.categoria, marca: eq.marca||'', modelo: eq.modelo||'', nro_serie: eq.nro_serie||'', ubicacion: eq.ubicacion||'', observaciones: eq.observaciones||'' })
    setEquipoSel(eq); setErrEq(''); setModalEq('editar')
  }

  function verDetalleEquipo(eq) {
    api.get(`/mantenimiento/equipos/${eq.id}/perfil`).then(r => setPerfilEquipo(r.data)).catch(() => {})
  }

  async function guardarEquipo() {
    setSavEq(true); setErrEq('')
    try {
      if (modalEq === 'nuevo') await api.post('/mantenimiento/equipos', formEq)
      else await api.put(`/mantenimiento/equipos/${equipoSel.id}`, formEq)
      setModalEq(null); cargarEquipos()
    } catch(e) { setErrEq(e.response?.data?.error || 'Error al guardar') }
    finally { setSavEq(false) }
  }

  async function darBaja() {
    if (!motivoBaja.trim()) { setErrEq('Ingresá el motivo de baja'); return }
    setSavEq(true)
    try {
      await api.post(`/mantenimiento/equipos/${equipoSel.id}/baja`, { motivo_baja: motivoBaja })
      setModalEq(null); setMotivoBaja(''); cargarEquipos()
      if (tab === 'dashboard') cargarDashboard()
    } catch(e) { setErrEq(e.response?.data?.error || 'Error') }
    finally { setSavEq(false) }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ACCIONES — PLAN PREVENTIVO
  // ══════════════════════════════════════════════════════════════════════════

  function abrirRegistrarEjecucion(tarea) {
    setModalEjec(tarea); setFormEjec({ ...FORM_EJEC, responsable: userResponsable }); setNokCorrec(false); setErrEjec('')
  }

  async function guardarEjecucion() {
    setSavEjec(true); setErrEjec('')
    try {
      await api.post('/mantenimiento/ejecuciones', { tarea_id: modalEjec.tarea_id, equipo_id: modalEjec.equipo_id, ...formEjec })
      if (formEjec.resultado === 'NOK') {
        setNokCorrec(true)
      } else {
        setModalEjec(null); cargarAlertas()
        if (tab === 'dashboard') cargarDashboard()
      }
    } catch(e) { setErrEjec(e.response?.data?.error || 'Error al registrar') }
    finally { setSavEjec(false) }
  }

  function crearCorrectivaDesdeNOK() {
    const t = modalEjec
    setModalEjec(null); setNokCorrec(false)
    setFormCo({ ...FORM_CORREC, equipo_id: t.equipo_id, equipo_texto: `${t.codigo} — ${t.nombre}`, fecha_deteccion: formEjec.fecha, descripcion_falla: `Tarea NOK: ${t.componente} — ${t.accion}`, responsable: formEjec.responsable })
    setErrCo(''); setTab('correctivas'); setModalCo('nueva')
  }

  function toggleSelectEquipo(id, e) {
    e.stopPropagation()
    setSelectedEquipos(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }

  function exportarExcel() {
    const fechaHoy = new Date().toLocaleDateString('es-AR')
    const selAlerts = alertas.filter(a => selectedEquipos.has(a.equipo_id))

    // Agrupar por equipo para formato de planilla por secciones
    const PRIO = { vencida: 4, proxima: 3, nunca_ejecutada: 2, manual: 1, al_dia: 0 }
    const mapaEq = {}
    selAlerts.forEach(a => {
      if (!mapaEq[a.equipo_id]) mapaEq[a.equipo_id] = { ...a, tareas: [] }
      mapaEq[a.equipo_id].tareas.push(a)
    })

    const aoa = []
    aoa.push([`PLAN PREVENTIVO — E-INTRA SRL — ${fechaHoy}`])
    aoa.push([])

    for (const eq of Object.values(mapaEq)) {
      aoa.push([`${eq.codigo}  ${eq.nombre}`, '', eq.ubicacion || '', '', '', '', '', '', '', ''])
      aoa.push(['Componente', 'Acción', 'Tipo', 'Frecuencia', 'Última ejec.', 'Días', 'Estado', 'Resultado', 'Observaciones', 'Firma'])
      for (const t of eq.tareas) {
        aoa.push([
          t.componente,
          t.accion,
          t.tipo,
          t.frecuencia,
          t.ultima_ejecucion ? t.ultima_ejecucion.slice(0, 10) : 'Sin ejecución',
          t.dias_desde_ultima != null ? t.dias_desde_ultima : '',
          LABEL_ALERTA[t.estado_alerta] || t.estado_alerta,
          '',  // Resultado — para completar
          '',  // Observaciones
          '',  // Firma
        ])
      }
      aoa.push([])
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!cols'] = [
      { wch: 20 }, { wch: 30 }, { wch: 10 }, { wch: 12 },
      { wch: 14 }, { wch: 6  }, { wch: 12 }, { wch: 12 },
      { wch: 25 }, { wch: 12 },
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Plan Preventivo')
    XLSX.writeFile(wb, `plan_preventivo_${new Date().toISOString().slice(0,10)}.xlsx`)
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
      await api.post('/mantenimiento/correctivas', { equipo_id: formCo.equipo_id, fecha_deteccion: formCo.fecha_deteccion, fecha_inicio: formCo.fecha_inicio || null, descripcion_falla: formCo.descripcion_falla, tipo_servicio: formCo.tipo_servicio, proveedor: formCo.proveedor || null, responsable: formCo.responsable || null, observaciones: formCo.observaciones || null })
      setModalCo(null); cargarCorrectivas()
    } catch(e) { setErrCo(e.response?.data?.error || 'Error al guardar') }
    finally { setSavCo(false) }
  }

  async function cerrarCorrectiva() {
    setSavCo(true); setErrCo('')
    try {
      await api.put(`/mantenimiento/correctivas/${correctivaSel.id}`, { ...formCierre, costo: formCierre.costo ? parseFloat(formCierre.costo) : null })
      setModalCo(null); cargarCorrectivas()
      if (formCierre.resultado === 'derivado_baja') cargarEquipos()
    } catch(e) { setErrCo(e.response?.data?.error || 'Error al cerrar') }
    finally { setSavCo(false) }
  }

  async function reabrirCorrectiva(c) {
    if (!window.confirm(`¿Reabrir la correctiva de "${c.equipo_nombre}"? Volverá al estado Pendiente.`)) return
    try {
      await api.put(`/mantenimiento/correctivas/${c.id}`, { resultado: 'pendiente', fecha_fin: null })
      cargarCorrectivas()
      cargarEquipos()
    } catch(e) { alert(e.response?.data?.error || 'Error al reabrir') }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ACCIONES — TAREAS PREVENTIVAS
  // ══════════════════════════════════════════════════════════════════════════

  async function abrirTareas(eq) {
    setModalTareas(eq); setFormTarea(null); setErrTarea(''); setLoadTareas(true)
    try {
      const r = await api.get('/mantenimiento/tareas', { params: { equipo_id: eq.id } })
      setTareas(r.data)
    } finally { setLoadTareas(false) }
  }

  async function recargarTareas() {
    const r = await api.get('/mantenimiento/tareas', { params: { equipo_id: modalTareas.id } })
    setTareas(r.data)
  }

  async function guardarTarea() {
    setSavTarea(true); setErrTarea('')
    try {
      if (formTarea.id) {
        await api.put(`/mantenimiento/tareas/${formTarea.id}`, formTarea)
      } else {
        await api.post('/mantenimiento/tareas', { ...formTarea, equipo_id: modalTareas.id })
      }
      setFormTarea(null); await recargarTareas()
    } catch(e) { setErrTarea(e.response?.data?.error || 'Error al guardar') }
    finally { setSavTarea(false) }
  }

  async function eliminarTarea(id) {
    if (!window.confirm('¿Eliminar esta tarea?')) return
    try {
      await api.delete(`/mantenimiento/tareas/${id}`)
      setTareas(prev => prev.filter(t => t.id !== id))
    } catch { alert('Error al eliminar') }
  }

  function cambiarFrecuencia(frec) {
    setFormTarea(f => ({ ...f, frecuencia: frec, frecuencia_dias: FREC_DIAS[frec] ?? f.frecuencia_dias }))
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
                { label: 'Tareas vencidas',   val: kpis.vencidas,   color: 'danger',    icon: 'bi-exclamation-triangle' },
                { label: 'Próximas a vencer', val: kpis.proximas,   color: 'warning',   icon: 'bi-clock' },
                { label: 'En reparación',     val: kpis.en_rep,     color: 'info',      icon: 'bi-tools' },
                { label: 'Bajas este año',    val: kpis.bajas_anio, color: 'secondary', icon: 'bi-archive' },
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
                      <tr><th>Equipo</th><th>Categoría</th><th>Tarea</th><th>Frecuencia</th><th>Última ejec.</th><th>Estado</th></tr>
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
              )}
          </>
        )}
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER — EQUIPOS
  // ══════════════════════════════════════════════════════════════════════════

  function ModalPerfilEquipo() {
    if (!perfilEquipo) return null
    return (
      <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.5)', zIndex: 1060 }} onClick={() => setPerfilEquipo(null)}>
        <div className="modal-dialog modal-xl modal-dialog-scrollable" onClick={e => e.stopPropagation()}>
          <div className="modal-content">
            <div className="modal-header">
              <div>
                <h5 className="modal-title mb-0">{perfilEquipo.equipo.codigo} — {perfilEquipo.equipo.nombre}</h5>
                <span className={`badge bg-${BADGE_ESTADO[perfilEquipo.equipo.estado]||'secondary'} mt-1`}>
                  {perfilEquipo.equipo.estado === 'en_reparacion' ? 'En reparación' : perfilEquipo.equipo.estado === 'baja' ? 'Baja' : 'Activo'}
                </span>
              </div>
              <button className="btn-close ms-3" onClick={() => setPerfilEquipo(null)} />
            </div>
            <div className="modal-body">
              <div className="row g-3 mb-4">
                <div className="col-md-3"><div className="text-muted small">Categoría</div><strong>{perfilEquipo.equipo.categoria||'—'}</strong></div>
                <div className="col-md-3"><div className="text-muted small">Marca / Modelo</div><strong>{[perfilEquipo.equipo.marca,perfilEquipo.equipo.modelo].filter(Boolean).join(' / ')||'—'}</strong></div>
                <div className="col-md-3"><div className="text-muted small">N° de serie</div><strong>{perfilEquipo.equipo.nro_serie||'—'}</strong></div>
                <div className="col-md-3"><div className="text-muted small">Ubicación</div><strong>{perfilEquipo.equipo.ubicacion||'—'}</strong></div>
                {perfilEquipo.equipo.observaciones && <div className="col-12"><div className="text-muted small">Observaciones</div>{perfilEquipo.equipo.observaciones}</div>}
              </div>

              <h6 className="border-bottom pb-1 mb-2">Historial de estados</h6>
              {perfilEquipo.historial.length === 0
                ? <p className="text-muted small mb-3">Sin registros</p>
                : <div className="table-responsive mb-4">
                    <table className="table table-sm">
                      <thead className="table-light"><tr><th>Fecha</th><th>Cambio</th><th>Motivo</th></tr></thead>
                      <tbody>
                        {perfilEquipo.historial.map(h => (
                          <tr key={h.id}>
                            <td>{fmtF(h.fecha)}</td>
                            <td>
                              <span className={`badge bg-${BADGE_ESTADO[h.estado_anterior]||'secondary'} me-1`}>
                                {h.estado_anterior === 'en_reparacion' ? 'En reparación' : h.estado_anterior||'—'}
                              </span>
                              <span className="text-muted mx-1">→</span>
                              <span className={`badge bg-${BADGE_ESTADO[h.estado_nuevo]||'secondary'}`}>
                                {h.estado_nuevo === 'en_reparacion' ? 'En reparación' : h.estado_nuevo}
                              </span>
                            </td>
                            <td><small>{h.motivo||'—'}</small></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
              }

              <h6 className="border-bottom pb-1 mb-2">Intervenciones correctivas ({perfilEquipo.correctivas.length})</h6>
              {perfilEquipo.correctivas.length === 0
                ? <p className="text-muted small mb-3">Sin intervenciones</p>
                : <div className="table-responsive mb-4">
                    <table className="table table-sm">
                      <thead className="table-light">
                        <tr><th>Detección</th><th>Falla</th><th>Acción realizada</th><th>Tipo</th><th>Proveedor</th><th>Costo</th><th>Repuestos</th><th>Cierre</th><th>Resultado</th></tr>
                      </thead>
                      <tbody>
                        {perfilEquipo.correctivas.map(c => (
                          <tr key={c.id}>
                            <td>{fmtF(c.fecha_deteccion)}</td>
                            <td><small>{c.descripcion_falla}</small></td>
                            <td><small>{c.accion_realizada||'—'}</small></td>
                            <td><span className="badge bg-secondary">{c.tipo_servicio}</span></td>
                            <td><small>{c.proveedor||'—'}</small></td>
                            <td>{c.costo ? fmtN(c.costo) : '—'}</td>
                            <td><small>{c.repuestos_usados||'—'}</small></td>
                            <td>{fmtF(c.fecha_fin)}</td>
                            <td><span className={`badge bg-${BADGE_RESULTADO[c.resultado]||'secondary'}`}>{c.resultado}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
              }

              <h6 className="border-bottom pb-1 mb-2">Inspecciones ({perfilEquipo.inspecciones.length})</h6>
              {perfilEquipo.inspecciones.length === 0
                ? <p className="text-muted small">Sin inspecciones</p>
                : <div className="table-responsive">
                    <table className="table table-sm">
                      <thead className="table-light">
                        <tr><th>Fecha</th><th>Resultado</th><th>Ubicación verif.</th><th>Etiqueta</th><th>Observaciones</th><th>Responsable</th></tr>
                      </thead>
                      <tbody>
                        {perfilEquipo.inspecciones.map(i => (
                          <tr key={i.id}>
                            <td>{fmtF(i.fecha)}</td>
                            <td><span className={`badge bg-${{OK:'success',NOK:'danger',requiere_atencion:'warning'}[i.estado_general]||'secondary'}`}>{i.estado_general}</span></td>
                            <td>{i.ubicacion_verificada||'—'}</td>
                            <td className="text-center">{i.etiqueta_ok ? <i className="bi bi-check-circle text-success"/> : <i className="bi bi-x-circle text-danger"/>}</td>
                            <td><small>{i.observaciones||'—'}</small></td>
                            <td><small>{i.responsable||'—'}</small></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
              }
            </div>
          </div>
        </div>
      </div>
    )
  }

  function TabEquipos() {
    return (
      <div>
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
                      <button className="btn btn-outline-info" onClick={() => abrirTareas(eq)} title="Tareas preventivas"><i className="bi bi-list-check" /></button>
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
                  <textarea className="form-control" rows={3} value={motivoBaja} onChange={e => setMotivoBaja(e.target.value)} />
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
                                  <tr key={i}><td>{t.componente}</td><td>{t.accion}</td><td>{t.frecuencia}</td><td>{fmtF(t.ultima_ejecucion)}</td><td><BadgeAlerta v={t.estado_alerta} /></td></tr>
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
                                  <tr key={c.id}><td>{fmtF(c.fecha_deteccion)}</td><td>{c.descripcion_falla}</td><td><span className={`badge bg-${BADGE_RESULTADO[c.resultado]||'secondary'}`}>{c.resultado}</span></td><td>{c.responsable||'—'}</td></tr>
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

    const PRIO  = { vencida: 4, proxima: 3, nunca_ejecutada: 2, manual: 1, al_dia: 0 }
    const mapaEq = {}
    alertas.forEach(a => {
      if (!mapaEq[a.equipo_id]) mapaEq[a.equipo_id] = { equipo_id: a.equipo_id, codigo: a.codigo, nombre: a.nombre, categoria: a.categoria, ubicacion: a.ubicacion, tareas: [] }
      mapaEq[a.equipo_id].tareas.push(a)
    })
    const grupos = Object.values(mapaEq)
    const peor   = tareas => tareas.reduce((b, t) => PRIO[t.estado_alerta] > PRIO[b] ? t.estado_alerta : b, 'al_dia')

    const todosIds    = grupos.map(g => g.equipo_id)
    const todosSelect = todosIds.length > 0 && todosIds.every(id => selectedEquipos.has(id))

    function toggleTodos() {
      if (todosSelect) setSelectedEquipos(new Set())
      else setSelectedEquipos(new Set(todosIds))
    }

    return (
      <div>
        {/* Resumen estado */}
        <div className="d-flex gap-3 mb-3 flex-wrap">
          {[['vencida','danger'],['proxima','warning'],['nunca_ejecutada','secondary'],['al_dia','success']].map(([e,c]) => (
            <span key={e} className={`badge bg-${c} fs-6`}>{LABEL_ALERTA[e]}: {conteo[e]}</span>
          ))}
        </div>

        {/* Filtros */}
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
          {selectedEquipos.size > 0 && (
            <div className="col-md-2">
              <button className="btn btn-success w-100" onClick={exportarExcel}>
                <i className="bi bi-file-earmark-excel me-1" />
                Excel ({selectedEquipos.size})
              </button>
            </div>
          )}
        </div>

        {loadAl && <div className="text-center py-3"><div className="spinner-border text-primary" /></div>}

        {!loadAl && grupos.length === 0 && <p className="text-muted text-center py-3">Sin resultados</p>}

        {!loadAl && grupos.length > 0 && (
          <div>
            {/* Toolbar accordion */}
            <div className="d-flex gap-2 mb-2 align-items-center">
              <div className="form-check mb-0 me-1">
                <input type="checkbox" className="form-check-input" id="chkTodos"
                  checked={todosSelect}
                  onChange={toggleTodos} />
                <label className="form-check-label small text-muted" htmlFor="chkTodos">
                  {todosSelect ? 'Deseleccionar todos' : 'Seleccionar todos'}
                </label>
              </div>
              <div className="ms-auto d-flex gap-2">
                <button className="btn btn-sm btn-outline-secondary" onClick={() => setExpandedEquipos(new Set(grupos.map(g => g.equipo_id)))}>
                  <i className="bi bi-chevron-expand me-1" />Expandir todo
                </button>
                <button className="btn btn-sm btn-outline-secondary" onClick={() => setExpandedEquipos(new Set())}>
                  <i className="bi bi-chevron-contract me-1" />Colapsar todo
                </button>
              </div>
            </div>

            {grupos.map(eq => {
              const p       = peor(eq.tareas)
              const abierto = expandedEquipos.has(eq.equipo_id)
              const selec   = selectedEquipos.has(eq.equipo_id)
              const bgCls   = p === 'vencida' ? 'border-danger bg-danger bg-opacity-10'
                            : p === 'proxima' ? 'border-warning bg-warning bg-opacity-10'
                            : 'border-secondary bg-light'
              return (
                <div key={eq.equipo_id} className={`mb-1 border rounded overflow-hidden ${selec ? 'border-primary' : ''}`}>
                  <div
                    className={`d-flex align-items-center justify-content-between px-3 py-2 ${bgCls}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => toggleEquipo(eq.equipo_id)}
                  >
                    <div className="d-flex align-items-center gap-2">
                      <input type="checkbox" className="form-check-input"
                        checked={selec}
                        onClick={e => toggleSelectEquipo(eq.equipo_id, e)}
                        onChange={() => {}}
                      />
                      <strong>{eq.codigo}</strong>
                      <span className="ms-1">{eq.nombre}</span>
                      <small className="text-muted">{eq.categoria}</small>
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
                                  <button className="btn btn-sm btn-outline-primary"
                                    onClick={e => { e.stopPropagation(); abrirRegistrarEjecucion(a) }}>
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
        )}

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
                        <DateInput className="form-control" value={formEjec.fecha} onChange={v => setFormEjec(f => ({ ...f, fecha: v }))} />
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
                        <EmpleadoSelect value={formEjec.responsable} onChange={v => setFormEjec(f => ({ ...f, responsable: v }))} />
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
            <button className="btn btn-primary ms-auto" onClick={() => { setFormCo({ ...FORM_CORREC, responsable: userResponsable }); setErrCo(''); setSugsEq([]); setModalCo('nueva') }}>
              <i className="bi bi-plus me-1" />Nueva correctiva
            </button>
          )}
        </div>

        {loadCo && <div className="text-center py-3"><div className="spinner-border text-primary" /></div>}

        <div className="table-responsive">
          <table className="table table-sm table-hover">
            <thead className="table-dark">
              <tr><th>Equipo</th><th>Detección</th><th>Falla</th><th>Acción realizada</th><th>Tipo</th><th>Responsable</th><th>Estado</th><th style={{width:42}}></th>{canWrite && <th style={{width:110}}></th>}</tr>
            </thead>
            <tbody>
              {correctivas.length === 0 && !loadCo && (
                <tr><td colSpan={8} className="text-center text-muted py-3">Sin resultados</td></tr>
              )}
              {correctivas.map(c => (
                <tr key={c.id}>
                  <td><strong>{c.codigo}</strong><br/><small>{c.equipo_nombre}</small></td>
                  <td>{fmtF(c.fecha_deteccion)}</td>
                  <td>{c.descripcion_falla}</td>
                  <td className="text-muted small" style={{maxWidth:160}}>
                    {c.accion_realizada
                      ? <span title={c.accion_realizada}>{c.accion_realizada.length > 50 ? c.accion_realizada.slice(0,50)+'…' : c.accion_realizada}</span>
                      : <span className="fst-italic">—</span>}
                  </td>
                  <td><span className="badge bg-secondary">{c.tipo_servicio}</span></td>
                  <td>{c.responsable||'—'}</td>
                  <td><span className={`badge bg-${BADGE_RESULTADO[c.resultado]||'secondary'}`}>{c.resultado}</span></td>
                  <td className="text-center">
                    <button className="btn btn-sm btn-outline-info py-0" title="Ver ficha del equipo"
                      onClick={() => api.get(`/mantenimiento/equipos/${c.equipo_id}/perfil`).then(r => setPerfilEquipo(r.data)).catch(() => {})}>
                      <i className="bi bi-info-circle" />
                    </button>
                  </td>
                  {canWrite && (
                    <td>
                      <div className="d-flex gap-1">
                        {c.resultado === 'pendiente' && (
                          <button className="btn btn-sm btn-outline-success" title="Cerrar" onClick={() => { setCorrectivaSel(c); setFormCierre({ ...FORM_CIERRE, tipo_servicio: c.tipo_servicio, responsable: userResponsable }); setErrCo(''); setModalCo('cierre') }}>
                            <i className="bi bi-check-circle me-1" />Cerrar
                          </button>
                        )}
                        {c.resultado === 'resuelto' && (
                          <button className="btn btn-sm btn-outline-warning" title="Reabrir" onClick={() => reabrirCorrectiva(c)}>
                            <i className="bi bi-arrow-counterclockwise me-1" />Reabrir
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

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
                          value={formCo.equipo_texto} onChange={e => buscarEquipoCorrectiva(e.target.value)} />
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
                      <DateInput className="form-control" value={formCo.fecha_deteccion} onChange={v => setFormCo(f => ({ ...f, fecha_deteccion: v }))} />
                    </div>
                    <div className="col-md-6">
                      <label className="form-label">Fecha inicio reparación</label>
                      <DateInput className="form-control" value={formCo.fecha_inicio} onChange={v => setFormCo(f => ({ ...f, fecha_inicio: v }))} />
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
                      <EmpleadoSelect value={formCo.responsable} onChange={v => setFormCo(f => ({ ...f, responsable: v }))} />
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

        {modalCo === 'cierre' && correctivaSel && (
          <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
            <div className="modal-dialog modal-lg">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Cerrar correctiva — {correctivaSel.codigo}</h5>
                  <button className="btn-close" onClick={() => setModalCo(null)} />
                </div>
                <div className="modal-body">
                  <div className="alert alert-light py-2 mb-3"><strong>Falla:</strong> {correctivaSel.descripcion_falla}</div>
                  {errCo && <div className="alert alert-danger">{errCo}</div>}
                  <div className="row g-3">
                    <div className="col-md-6">
                      <label className="form-label">Fecha fin</label>
                      <DateInput className="form-control" value={formCierre.fecha_fin} onChange={v => setFormCierre(f => ({ ...f, fecha_fin: v }))} />
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
                      <EmpleadoSelect value={formCierre.responsable} onChange={v => setFormCierre(f => ({ ...f, responsable: v }))} />
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
  // RENDER — HISTORIAL F14
  // ══════════════════════════════════════════════════════════════════════════

  function TabHistorial() {
    const BADGE_ESTADO_GEN = { OK: 'success', NOK: 'danger', Cuarentena: 'warning', requiere_atencion: 'warning', en_reparacion: 'warning', activo: 'success', baja: 'dark', pendiente: 'warning', resuelto: 'success', derivado_baja: 'secondary' }
    const LABEL_ESTADO_GEN = { OK: 'OK', NOK: 'NOK', Cuarentena: 'Cuarentena', requiere_atencion: 'Requiere atención', en_reparacion: 'En reparación', activo: 'Activo', baja: 'Baja definitiva', pendiente: 'Pendiente', resuelto: 'Resuelto', derivado_baja: 'Derivado a baja' }
    const TIPO_LABEL = { inspeccion: 'Inspección', preventiva: 'Preventiva', correctiva: 'Correctiva', estado: 'Cambio estado' }
    const TIPO_BADGE = { inspeccion: 'info', preventiva: 'success', correctiva: 'danger', estado: 'secondary' }
    const TIPO_TEXT  = { inspeccion: 'dark', preventiva: 'white', correctiva: 'white', estado: 'white' }

    const histFiltrado = filtHistInsp.buscar
      ? histInsp.filter(r =>
          r.codigo?.toLowerCase().includes(filtHistInsp.buscar.toLowerCase()) ||
          r.equipo_nombre?.toLowerCase().includes(filtHistInsp.buscar.toLowerCase()))
      : histInsp

    return (
      <div>
        {/* Filtros */}
        <div className="row g-2 mb-3">
          <div className="col-md-3">
            <input className="form-control" placeholder="Buscar equipo..."
              value={filtHistInsp.buscar}
              onChange={e => setFiltHistInsp(f => ({ ...f, buscar: e.target.value }))} />
          </div>
          <div className="col-md-2">
            <select className="form-select" value={filtHistInsp.tipo}
              onChange={e => setFiltHistInsp(f => ({ ...f, tipo: e.target.value }))}>
              <option value="">Todos los tipos</option>
              <option value="inspeccion">Inspección</option>
              <option value="preventiva">Preventiva</option>
              <option value="correctiva">Correctiva</option>
              <option value="estado">Cambio de estado</option>
            </select>
          </div>
          <div className="col-md-2">
            <select className="form-select" value={filtHistInsp.estado_equipo}
              onChange={e => setFiltHistInsp(f => ({ ...f, estado_equipo: e.target.value }))}>
              <option value="">Estado equipo</option>
              <option value="activo">Activo</option>
              <option value="en_reparacion">En reparación</option>
              <option value="baja">Baja</option>
            </select>
          </div>
          <div className="col-md-2">
            <DateInput className="form-control" title="Desde"
              value={filtHistInsp.desde}
              onChange={v => setFiltHistInsp(f => ({ ...f, desde: v }))} />
          </div>
          <div className="col-md-2">
            <DateInput className="form-control" title="Hasta"
              value={filtHistInsp.hasta}
              onChange={v => setFiltHistInsp(f => ({ ...f, hasta: v }))} />
          </div>
          <div className="col-md-1">
            <button className="btn btn-outline-secondary w-100" onClick={cargarHistorialInspecciones}>
              <i className="bi bi-search" />
            </button>
          </div>
        </div>

        {loadHistInsp && <div className="text-center py-3"><div className="spinner-border text-primary" /></div>}

        {detalleHistorial && (
          <div className="modal d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={() => setDetalleHistorial(null)}>
            <div className="modal-dialog" onClick={e => e.stopPropagation()}>
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">
                    <span className={`badge bg-${TIPO_BADGE[detalleHistorial.tipo] || 'secondary'} me-2 text-${TIPO_TEXT[detalleHistorial.tipo] || 'white'}`}>{TIPO_LABEL[detalleHistorial.tipo] || detalleHistorial.tipo}</span>
                    {detalleHistorial.codigo} — {detalleHistorial.equipo_nombre}
                  </h5>
                  <button className="btn-close" onClick={() => setDetalleHistorial(null)} />
                </div>
                <div className="modal-body">
                  <p className="mb-1"><strong>Fecha:</strong> {fmtF(detalleHistorial.fecha)}</p>
                  {detalleHistorial.tipo === 'inspeccion' && (<>
                    <p className="mb-1"><strong>Resultado:</strong>{' '}
                      <span className={`badge bg-${BADGE_ESTADO_GEN[detalleHistorial.estado_general] || 'secondary'}`}>{LABEL_ESTADO_GEN[detalleHistorial.estado_general] || detalleHistorial.estado_general}</span>
                    </p>
                    <p className="mb-1"><strong>Observaciones:</strong> {detalleHistorial.observaciones || '—'}</p>
                    <p className="mb-0"><strong>Responsable:</strong> {detalleHistorial.responsable || '—'}</p>
                  </>)}
                  {detalleHistorial.tipo === 'preventiva' && (<>
                    <p className="mb-1"><strong>Tarea:</strong> {detalleHistorial.tarea_info || '—'}</p>
                    <p className="mb-1"><strong>Resultado:</strong>{' '}
                      <span className={`badge bg-${BADGE_ESTADO_GEN[detalleHistorial.estado_general] || 'secondary'}`}>{LABEL_ESTADO_GEN[detalleHistorial.estado_general] || detalleHistorial.estado_general}</span>
                    </p>
                    <p className="mb-1"><strong>Observaciones:</strong> {detalleHistorial.observaciones || '—'}</p>
                    <p className="mb-0"><strong>Responsable:</strong> {detalleHistorial.responsable || '—'}</p>
                  </>)}
                  {detalleHistorial.tipo === 'estado' && (<>
                    <p className="mb-1"><strong>Cambio de estado:</strong>{' '}
                      <span className={`badge bg-${BADGE_ESTADO_GEN[detalleHistorial.estado_anterior] || 'secondary'} me-1`}>{LABEL_ESTADO_GEN[detalleHistorial.estado_anterior] || detalleHistorial.estado_anterior || '—'}</span>
                      → <span className={`badge bg-${BADGE_ESTADO_GEN[detalleHistorial.estado_general] || 'secondary'}`}>{LABEL_ESTADO_GEN[detalleHistorial.estado_general] || detalleHistorial.estado_general}</span>
                    </p>
                    <p className="mb-0"><strong>Motivo:</strong> {detalleHistorial.observaciones || '—'}</p>
                  </>)}
                  {detalleHistorial.tipo === 'correctiva' && (<>
                    <p className="mb-1"><strong>Resultado:</strong>{' '}
                      <span className={`badge bg-${BADGE_ESTADO_GEN[detalleHistorial.estado_general] || 'secondary'}`}>{LABEL_ESTADO_GEN[detalleHistorial.estado_general] || detalleHistorial.estado_general}</span>
                    </p>
                    <p className="mb-1"><strong>Descripción de falla:</strong> {detalleHistorial.observaciones || '—'}</p>
                    <p className="mb-1"><strong>Acción realizada:</strong> {detalleHistorial.accion_realizada || '—'}</p>
                    {detalleHistorial.fecha_fin && <p className="mb-1"><strong>Fecha de cierre:</strong> {fmtF(detalleHistorial.fecha_fin)}</p>}
                    <p className="mb-0"><strong>Responsable:</strong> {detalleHistorial.responsable || '—'}</p>
                  </>)}
                </div>
              </div>
            </div>
          </div>
        )}

        {!loadHistInsp && (
          <>
            <p className="text-muted small mb-2">{histFiltrado.length} registros</p>
            <div className="table-responsive">
              <table className="table table-sm table-hover">
                <thead className="table-dark">
                  <tr>
                    <th>Fecha</th>
                    <th>Código</th>
                    <th>Equipo</th>
                    <th>Tipo</th>
                    <th>Resultado</th>
                    <th>Estado equipo</th>
                    <th>Detalle</th>
                    <th>Responsable</th>
                  </tr>
                </thead>
                <tbody>
                  {histFiltrado.length === 0 && (
                    <tr><td colSpan={8} className="text-center text-muted py-3">Sin registros</td></tr>
                  )}
                  {histFiltrado.map(r => {
                    const rowClass =
                      r.tipo === 'estado'     ? 'table-secondary'
                      : r.estado_general === 'NOK' || r.estado_general === 'pendiente' ? 'table-warning'
                      : r.estado_general === 'Cuarentena' || r.estado_general === 'requiere_atencion' ? 'table-warning'
                      : r.estado_general === 'derivado_baja' || r.estado_general === 'baja' ? 'table-secondary'
                      : ''
                    const detalle = r.tipo === 'preventiva'
                      ? (r.tarea_info || r.observaciones || '—')
                      : (r.observaciones || '—')
                    return (
                      <tr key={`${r.tipo}-${r.id}`} className={`${rowClass} cursor-pointer`} style={{cursor:'pointer'}} onClick={() => setDetalleHistorial(r)}>
                        <td>{fmtF(r.fecha)}</td>
                        <td><strong>{r.codigo}</strong></td>
                        <td><small>{r.equipo_nombre}</small></td>
                        <td><span className={`badge bg-${TIPO_BADGE[r.tipo] || 'secondary'} text-${TIPO_TEXT[r.tipo] || 'white'}`}>{TIPO_LABEL[r.tipo] || r.tipo}</span></td>
                        <td><span className={`badge bg-${BADGE_ESTADO_GEN[r.estado_general] || 'secondary'}`}>{LABEL_ESTADO_GEN[r.estado_general] || r.estado_general}</span></td>
                        <td>
                          {r.equipo_estado === 'baja'
                            ? <span className="badge bg-secondary">Baja</span>
                            : r.equipo_estado === 'en_reparacion'
                              ? <span className="badge bg-warning text-dark">En reparación</span>
                              : <span className="badge bg-success">Activo</span>}
                        </td>
                        <td><small>{detalle.length > 60 ? detalle.slice(0,60)+'…' : detalle}</small></td>
                        <td><small>{r.responsable || '—'}</small></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
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
    { id: 'historial',   label: 'Historial',         icon: 'bi-clipboard-check' },
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

      {tab === 'dashboard'   && TabDashboard()}
      {tab === 'equipos'     && TabEquipos()}
      {tab === 'plan'        && TabPlan()}
      {tab === 'correctivas' && TabCorrectivas()}
      {tab === 'historial'   && TabHistorial()}

      {/* ── Modal: Tareas preventivas por equipo ────────────────────── */}
      {ModalPerfilEquipo()}

      {modalTareas && (
        <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className="bi bi-list-check me-2" />
                  Tareas preventivas — <strong>{modalTareas.codigo}</strong> {modalTareas.nombre}
                </h5>
                <button className="btn-close" onClick={() => { setModalTareas(null); setFormTarea(null) }} />
              </div>

              <div className="modal-body">
                {loadTareas && <div className="text-center py-3"><div className="spinner-border text-primary" /></div>}

                {!loadTareas && (
                  <>
                    {/* Lista de tareas */}
                    {tareas.length === 0 && !formTarea && (
                      <p className="text-muted text-center py-2">Sin tareas registradas</p>
                    )}
                    {tareas.length > 0 && (
                      <div className="table-responsive mb-3">
                        <table className="table table-sm align-middle">
                          <thead className="table-light">
                            <tr>
                              <th>Componente</th><th>Acción</th><th>Tipo</th>
                              <th>Frecuencia</th><th>Días</th><th>Activa</th>
                              {canWrite && <th></th>}
                            </tr>
                          </thead>
                          <tbody>
                            {tareas.map(t => (
                              <tr key={t.id} className={!t.activa ? 'text-muted' : ''}>
                                <td>{t.componente}</td>
                                <td>{t.accion}</td>
                                <td><small className="text-muted">{t.tipo}</small></td>
                                <td>{t.frecuencia}</td>
                                <td>{t.frecuencia_dias > 0 ? `${t.frecuencia_dias}d` : '—'}</td>
                                <td>
                                  {t.activa
                                    ? <span className="badge bg-success">Sí</span>
                                    : <span className="badge bg-secondary">No</span>}
                                </td>
                                {canWrite && (
                                  <td>
                                    <div className="btn-group btn-group-sm">
                                      <button className="btn btn-outline-primary"
                                        onClick={() => setFormTarea({ ...t })}>
                                        <i className="bi bi-pencil" />
                                      </button>
                                      <button className="btn btn-outline-danger"
                                        onClick={() => eliminarTarea(t.id)}>
                                        <i className="bi bi-trash" />
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

                    {/* Formulario nueva / editar tarea */}
                    {formTarea && (
                      <div className="card border-primary mb-2">
                        <div className="card-header bg-primary bg-opacity-10 py-2">
                          <strong className="small">{formTarea.id ? 'Editar tarea' : 'Nueva tarea'}</strong>
                        </div>
                        <div className="card-body pb-2">
                          {errTarea && <div className="alert alert-danger py-2 small">{errTarea}</div>}
                          <div className="row g-2">
                            <div className="col-md-4">
                              <label className="form-label small fw-medium">Componente *</label>
                              <input className="form-control form-control-sm"
                                value={formTarea.componente}
                                onChange={e => setFormTarea(f => ({ ...f, componente: e.target.value }))}
                                placeholder="Ej: Equipo, Motor, Cadena..." />
                            </div>
                            <div className="col-md-5">
                              <label className="form-label small fw-medium">Acción *</label>
                              <input className="form-control form-control-sm"
                                value={formTarea.accion}
                                onChange={e => setFormTarea(f => ({ ...f, accion: e.target.value }))}
                                placeholder="Ej: Limpieza y sopleteado..." />
                            </div>
                            <div className="col-md-3">
                              <label className="form-label small fw-medium">Tipo</label>
                              <input className="form-control form-control-sm"
                                value={formTarea.tipo}
                                onChange={e => setFormTarea(f => ({ ...f, tipo: e.target.value }))}
                                placeholder="L, I, S..." />
                            </div>
                            <div className="col-md-4">
                              <label className="form-label small fw-medium">Frecuencia</label>
                              <select className="form-select form-select-sm"
                                value={formTarea.frecuencia}
                                onChange={e => cambiarFrecuencia(e.target.value)}>
                                {FRECUENCIAS.map(f => <option key={f} value={f}>{f}</option>)}
                              </select>
                            </div>
                            <div className="col-md-3">
                              <label className="form-label small fw-medium">Días</label>
                              <input type="number" className="form-control form-control-sm"
                                value={formTarea.frecuencia_dias}
                                min={0}
                                onChange={e => setFormTarea(f => ({ ...f, frecuencia_dias: parseInt(e.target.value) || 0 }))} />
                            </div>
                            <div className="col-md-3 d-flex align-items-end">
                              <div className="form-check mb-1">
                                <input type="checkbox" className="form-check-input" id="chkActiva"
                                  checked={!!formTarea.activa}
                                  onChange={e => setFormTarea(f => ({ ...f, activa: e.target.checked ? 1 : 0 }))} />
                                <label className="form-check-label small" htmlFor="chkActiva">Activa</label>
                              </div>
                            </div>
                            <div className="col-12 d-flex gap-2 justify-content-end">
                              <button className="btn btn-sm btn-secondary"
                                onClick={() => { setFormTarea(null); setErrTarea('') }}>
                                Cancelar
                              </button>
                              <button className="btn btn-sm btn-primary"
                                onClick={guardarTarea} disabled={savTarea}>
                                {savTarea ? <span className="spinner-border spinner-border-sm me-1" /> : null}
                                Guardar tarea
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Botón agregar */}
                    {canWrite && !formTarea && (
                      <button className="btn btn-sm btn-outline-primary"
                        onClick={() => { setFormTarea({ ...FORM_TAREA }); setErrTarea('') }}>
                        <i className="bi bi-plus-circle me-1" />Agregar tarea
                      </button>
                    )}
                  </>
                )}
              </div>

              <div className="modal-footer">
                <button className="btn btn-secondary btn-sm"
                  onClick={() => { setModalTareas(null); setFormTarea(null) }}>
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
