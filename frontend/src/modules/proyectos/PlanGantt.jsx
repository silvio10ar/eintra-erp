import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api/client'
import { useGerencias } from '../../hooks/useGerencias'
import { manejarPegadoNumero } from '../../utils/numero'
import { puedeLeer } from '../../store/authStore'
import DateInput from '../../components/DateInput'
import GanttSVG from '../../components/GanttSVG'

const ESTADOS = ['Pendiente', 'En proceso', 'Completado', 'Cancelado', 'Bloqueado']
const COLORES  = ['', '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f']

const fmtD = iso => iso ? iso.slice(5).split('-').reverse().join('/') : ''  // DD/MM → display (Argentina)

// ── Componente interno: celda de estado con badge ─────────────────────────────
function EstadoBadge({ estado }) {
  const map = { Pendiente: 'secondary', 'En proceso': 'primary', Completado: 'success', Cancelado: 'danger', Bloqueado: 'warning' }
  return <span className={`badge bg-${map[estado] || 'secondary'}`} style={{ fontSize: '0.65rem' }}>{estado}</span>
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function PlanGantt({ proyecto, canWrite }) {
  const navigate = useNavigate()
  const canReadCalidad = puedeLeer('calidad')
  const { gerencias } = useGerencias()
  const [tareas,     setTareas]     = useState([])
  const [loading,    setLoading]    = useState(true)
  const [zoom,       setZoom]       = useState(10)
  const [editId,     setEditId]     = useState(null)
  const [editData,   setEditData]   = useState({})
  const [saving,     setSaving]     = useState(false)
  const [err,        setErr]        = useState('')
  const [pendingEditId, setPendingEditId] = useState(null)
  const [modalPlant,      setModalPlant]      = useState(false)
  const [plantSets,       setPlantSets]       = useState([])
  const [plantSelSet,     setPlantSelSet]     = useState(null)   // null = global legacy
  const [plantReemplazar, setPlantReemplazar] = useState(false)
  const [plantLoading,    setPlantLoading]    = useState(false)
  const [empleados,      setEmpleados]      = useState([])
  const [predBuscar,     setPredBuscar]     = useState('')
  const [predOrden,      setPredOrden]      = useState('ejecucion')
  const [modalGuardar,   setModalGuardar]   = useState(false)
  const [guardarNombre,  setGuardarNombre]  = useState('')
  const [guardarLoading, setGuardarLoading] = useState(false)
  const [modalAgregar,   setModalAgregar]   = useState(null)   // null | { despuesDeIdx }
  const [masterTareas,   setMasterTareas]   = useState([])
  const [masterLoading,  setMasterLoading]  = useState(false)
  const [agregarBuscar,  setAgregarBuscar]  = useState('')
  const [nuevaDuracion,  setNuevaDuracion]  = useState(5)
  const [agregando,      setAgregando]      = useState(false)
  // Filtro de áreas visibles: null = todas. Solo afecta tareas CON área
  // asignada — las que no tienen área siempre se muestran (no pertenecen a
  // ningún grupo que filtrar).
  const [filtroAreas, setFiltroAreas] = useState(null)
  const inputRef     = useRef()
  const leftScrollRef  = useRef()
  const rightScrollRef = useRef()
  const isSyncing      = useRef(false)

  const handleLeftScroll = useCallback(() => {
    if (isSyncing.current) return
    isSyncing.current = true
    if (rightScrollRef.current) rightScrollRef.current.scrollTop = leftScrollRef.current.scrollTop
    requestAnimationFrame(() => { isSyncing.current = false })
  }, [])

  const handleRightScroll = useCallback(() => {
    if (isSyncing.current) return
    isSyncing.current = true
    if (leftScrollRef.current) leftScrollRef.current.scrollTop = rightScrollRef.current.scrollTop
    requestAnimationFrame(() => { isSyncing.current = false })
  }, [])

  const cargar = useCallback(async () => {
    if (!proyecto?.id) return
    setLoading(true)
    try {
      const { data } = await api.get(`/gantt/proyecto/${proyecto.id}/tareas`)
      setTareas(data)
    } catch { setErr('Error al cargar tareas') }
    finally   { setLoading(false) }
  }, [proyecto?.id])

  useEffect(() => { cargar() }, [cargar])

  // Si el filtro de áreas quedara aplicado al cambiar de proyecto (hoy no
  // pasa: Proyectos.jsx siempre desmonta este componente al elegir otro
  // proyecto, pero es un solo `key`/flujo de distancia de que deje de ser
  // así), un área que no existe en el proyecto nuevo escondería TODAS las
  // tareas sin ningún aviso. Reiniciarlo acá lo hace a prueba de eso.
  useEffect(() => { setFiltroAreas(null) }, [proyecto?.id])

  // Áreas distintas presentes en el plan, para el filtro.
  const areasDisponibles = useMemo(() => (
    [...new Set(tareas.map(t => t.area_responsable || '').filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'))
  ), [tareas])

  // Filas visibles del panel izquierdo: se aplica el filtro de áreas (una
  // tarea sin área asignada siempre queda, el filtro solo esconde tareas de
  // áreas puntuales) — cada tarea conserva su índice real dentro de `tareas`
  // (realIdx) para que mover/insertar sigan operando sobre la lista
  // completa, no sobre la vista filtrada.
  const filasVisibles = useMemo(() => (
    tareas
      .map((t, i) => ({ t, realIdx: i }))
      .filter(({ t }) => {
        const area = t.area_responsable || ''
        return !area || !filtroAreas || filtroAreas.has(area)
      })
      .map(x => ({ tipo: 'tarea', key: x.t.id, ...x }))
  ), [tareas, filtroAreas])

  // Mismas filas, traducidas a lo que necesita GanttSVG para dibujar.
  const filasSvg = useMemo(() => filasVisibles.map(f => ({
    id: f.t.id, fecha_inicio_calc: f.t.fecha_inicio_calc, fecha_fin_calc: f.t.fecha_fin_calc,
    color: f.t.color, avance: f.t.avance, predecesoras: f.t.predecesoras, esGeneral: !!f.t.es_general,
  })), [filasVisibles])

  useEffect(() => {
    api.get('/rrhh/empleados-basico').then(({ data }) => {
      setEmpleados(data.filter(e => e.activo !== 0).map(e => e.nombre).sort((a, b) => a.localeCompare(b, 'es')))
    }).catch(e => console.error(e))
  }, [])

  // Abrir edición después de que tareas se recarga con la nueva tarea
  useEffect(() => {
    if (pendingEditId) {
      const t = tareas.find(x => x.id === pendingEditId)
      if (t) { iniciarEdicion(pendingEditId); setPendingEditId(null) }
    }
  }, [tareas, pendingEditId])

  // ── Crear tarea en el proyecto (al final o después de una posición) ───────
  const crearTareaEnProyecto = async (nombre, duracion_dias, despuesDeIdx) => {
    setSaving(true)
    try {
      // insertarEnPosicion = orden de la tarea que va DESPUÉS (tareas[despuesDeIdx].orden + 1)
      const body = { nombre, duracion_dias, estado: 'Pendiente' }
      if (despuesDeIdx !== undefined && despuesDeIdx !== null) {
        body.insertarEnPosicion = (tareas[despuesDeIdx]?.orden ?? despuesDeIdx) + 1
      }
      const { data } = await api.post(`/gantt/proyecto/${proyecto.id}/tareas`, body)
      setPendingEditId(data.id)
      await cargar()
    } catch { setErr('Error al crear tarea') }
    finally   { setSaving(false) }
  }

  // ── Abrir selector: elegir tarea existente del Master Plan o crear una nueva ──
  const abrirAgregar = async (despuesDeIdx) => {
    if (!canWrite) return
    setModalAgregar({ despuesDeIdx })
    setAgregarBuscar('')
    setNuevaDuracion(5)
    setMasterLoading(true)
    try {
      const { data } = await api.get('/gantt/plantilla')
      setMasterTareas(data.filter(t => !t.es_grupo))
    } catch { setMasterTareas([]) }
    finally { setMasterLoading(false) }
  }

  // ── Elegir una tarea existente del Master Plan ────────────────────────────
  const elegirExistente = async (t) => {
    const despuesDeIdx = modalAgregar?.despuesDeIdx
    setModalAgregar(null)
    await crearTareaEnProyecto(t.nombre, t.duracion_dias || 1, despuesDeIdx)
  }

  // ── Crear tarea nueva: se agrega al proyecto Y se guarda en el Master Plan ──
  const crearNueva = async () => {
    const nombre = agregarBuscar.trim()
    if (!nombre) return
    setAgregando(true)
    try {
      const yaExiste = masterTareas.some(t => t.nombre.trim().toLowerCase() === nombre.toLowerCase())
      if (!yaExiste) {
        await api.post('/gantt/plantilla', { nombre, duracion_dias: nuevaDuracion, es_grupo: false, origen: 'proyecto' })
      }
      const despuesDeIdx = modalAgregar?.despuesDeIdx
      setModalAgregar(null)
      await crearTareaEnProyecto(nombre, nuevaDuracion, despuesDeIdx)
    } catch { setErr('Error al crear tarea nueva') }
    finally { setAgregando(false) }
  }

  // ── Iniciar edición inline ─────────────────────────────────────────────────
  const iniciarEdicion = (id) => {
    const t = tareas.find(x => x.id === id)
    if (!t) return
    setEditId(id)
    setEditData({
      nombre:       t.nombre,
      duracion_dias: t.duracion_dias,
      responsable:  t.responsable,
      area_responsable: t.area_responsable,
      modulo:       t.modulo || 0,
      estado:       t.estado,
      avance:       t.avance,
      color:        t.color,
      observaciones: t.observaciones,
      predecesoras: t.predecesoras || [],
      fecha_inicio_manual: t.fecha_inicio_manual || '',
      es_general: !!t.es_general,
      termina_con_tarea_id: t.termina_con_tarea_id || '',
    })
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  // ── Guardar edición ────────────────────────────────────────────────────────
  const guardar = async (id) => {
    if (!canWrite) return
    setSaving(true)
    try {
      const { data } = await api.put(`/gantt/proyecto/${proyecto.id}/tareas/${id}`, editData)
      setEditId(null)
      await cargar()
      const avisos = []
      if (data?.ciclosEvitados) {
        avisos.push(`Se ignoró ${data.ciclosEvitados === 1 ? 'una predecesora' : `${data.ciclosEvitados} predecesoras`} porque generaba una dependencia circular.`)
      }
      if (data?.terminaConDescartado) {
        avisos.push('Se ignoró "Termina cuando termina" porque generaba una dependencia circular.')
      }
      if (avisos.length) setErr(avisos.join(' '))
    } catch { setErr('Error al guardar') }
    finally   { setSaving(false) }
  }

  // ── Eliminar ───────────────────────────────────────────────────────────────
  const eliminar = async (id) => {
    if (!canWrite || !confirm('¿Eliminar esta tarea?')) return
    try {
      await api.delete(`/gantt/proyecto/${proyecto.id}/tareas/${id}`)
      await cargar()
    } catch { setErr('Error al eliminar') }
  }

  // ── Mover arriba / abajo ───────────────────────────────────────────────────
  // Intercambia con la próxima tarea VISIBLE en esa dirección (según el
  // filtro de áreas activo), no con la siguiente del array completo — si no,
  // mover una tarea "más allá" de otra oculta por el filtro no cambiaba nada
  // en la vista filtrada (el botón parecía no hacer nada, o saltaba de más
  // al clickear de nuevo).
  const mover = async (idx, dir) => {
    if (!canWrite) return
    const visibles = filasVisibles.map(f => f.realIdx)
    const pos = visibles.indexOf(idx)
    const swapPos = pos + dir
    if (pos === -1 || swapPos < 0 || swapPos >= visibles.length) return
    const swap = visibles[swapPos]
    const arr = [...tareas]
    ;[arr[idx], arr[swap]] = [arr[swap], arr[idx]]
    setTareas(arr)
    try {
      await api.put(`/gantt/proyecto/${proyecto.id}/reordenar`, { ids: arr.map(t => t.id) })
      await cargar()
    } catch { setErr('Error al reordenar') }
  }

  // ── Abrir modal cargar plantilla ─────────────────────────────────────────
  const abrirPlantilla = async () => {
    setPlantLoading(true); setModalPlant(true); setPlantSelSet(null); setPlantReemplazar(false)
    try {
      const { data } = await api.get('/gantt/plantilla-sets')
      setPlantSets(data)
    } catch { setPlantSets([]) }
    finally  { setPlantLoading(false) }
  }

  // ── Aplicar plantilla ─────────────────────────────────────────────────────
  const aplicarPlantilla = async () => {
    if (!canWrite) return
    const msg = plantReemplazar
      ? '¿Eliminar todas las tareas existentes y cargar la plantilla?'
      : '¿Agregar las tareas de la plantilla al plan actual?'
    if (!confirm(msg)) return
    setPlantLoading(true)
    try {
      await api.post(`/gantt/proyecto/${proyecto.id}/cargar-plantilla`, {
        reemplazar: plantReemplazar,
        set_id: plantSelSet,
      })
      setModalPlant(false)
      await cargar()
      setErr('')
    } catch { setErr('Error al cargar plantilla') }
    finally  { setPlantLoading(false) }
  }

  // ── Guardar plan como plantilla nueva ─────────────────────────────────────
  const guardarComoPlantilla = async () => {
    if (!canWrite) return
    if (!guardarNombre.trim()) return
    setGuardarLoading(true)
    try {
      await api.post(`/gantt/proyecto/${proyecto.id}/guardar-plantilla`, {
        set_nombre: guardarNombre.trim(),
      })
      setModalGuardar(false)
      setGuardarNombre('')
      setErr('')
    } catch { setErr('Error al guardar plantilla') }
    finally  { setGuardarLoading(false) }
  }

  if (!proyecto?.id) return null

  return (
    <>
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 400 }}>

      {/* ── Toolbar compartida: misma altura para ambos lados ──────────── */}
      <div style={{ display: 'flex', flexShrink: 0, background: '#f8f9fa', borderBottom: '1px solid #dee2e6' }}>
        <div style={{ width: 564, minWidth: 464, flexShrink: 0, borderRight: '1px solid #dee2e6',
                      padding: '4px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="small fw-semibold text-secondary">
            <i className="bi bi-list-task me-1"/>Tareas ({tareas.length})
          </span>
          <div className="d-flex gap-1">
            {areasDisponibles.length > 0 && (
              <div className="dropdown">
                <button className="btn btn-sm btn-outline-secondary py-0 px-2 dropdown-toggle" style={{ fontSize: '0.75rem' }}
                  data-bs-toggle="dropdown" data-bs-auto-close="outside" title="Elegir qué áreas mostrar">
                  <i className="bi bi-funnel me-1"/>Áreas
                  {filtroAreas && <span className="badge bg-primary ms-1" style={{ fontSize: '0.62rem' }}>{filtroAreas.size}</span>}
                </button>
                <div className="dropdown-menu p-2" style={{ maxHeight: 260, overflowY: 'auto', minWidth: 200 }}>
                  <div className="px-1 py-1 d-flex align-items-center gap-2" style={{ cursor: 'pointer', fontSize: '0.78rem' }}
                    onClick={() => setFiltroAreas(prev => prev === null ? new Set() : null)}>
                    <input type="checkbox" readOnly checked={!filtroAreas} style={{ pointerEvents: 'none' }}/>
                    <span className="fw-semibold">Todas</span>
                  </div>
                  <hr className="my-1"/>
                  {areasDisponibles.map(a => {
                    const marcada = !filtroAreas || filtroAreas.has(a)
                    return (
                      <div key={a} className="px-1 py-1 d-flex align-items-center gap-2" style={{ cursor: 'pointer', fontSize: '0.78rem' }}
                        onClick={() => setFiltroAreas(prev => {
                          const base = new Set(prev || areasDisponibles)
                          if (base.has(a)) base.delete(a); else base.add(a)
                          return base
                        })}>
                        <input type="checkbox" readOnly checked={marcada} style={{ pointerEvents: 'none' }}/>
                        <span>{a}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            {canReadCalidad && (
              <button className="btn btn-sm btn-outline-info py-0 px-2" style={{ fontSize: '0.75rem' }}
                onClick={() => navigate(`/calidad?proyecto=${proyecto.id}`)}
                title="Ver (o crear) la Hoja de Ruta de este proyecto en Calidad">
                <i className="bi bi-signpost-split me-1"/>Hoja de Ruta
              </button>
            )}
            {canWrite && (
              <>
                <button className="btn btn-sm btn-outline-success py-0 px-2" style={{ fontSize: '0.75rem' }}
                  onClick={() => { setGuardarNombre(''); setModalGuardar(true) }}
                  title="Guardar este plan como plantilla" disabled={tareas.length === 0}>
                  <i className="bi bi-cloud-upload me-1"/>Guardar plantilla
                </button>
                <button className="btn btn-sm btn-outline-primary py-0 px-2" style={{ fontSize: '0.75rem' }}
                  onClick={abrirPlantilla} title="Cargar plantilla">
                  <i className="bi bi-file-earmark-arrow-down me-1"/>Cargar plantilla
                </button>
                <button className="btn btn-sm btn-primary py-0 px-2" style={{ fontSize: '0.75rem' }}
                  onClick={() => abrirAgregar()} disabled={saving}>
                  <i className="bi bi-plus-lg me-1"/>Tarea
                </button>
              </>
            )}
          </div>
        </div>
        <div style={{ flex: 1, padding: '4px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="small fw-semibold text-secondary">
            <i className="bi bi-bar-chart-steps me-1"/>Diagrama de Gantt
            {proyecto?.fecha_inicio && (
              <span className="fw-normal text-muted ms-2">Inicio: {proyecto.fecha_inicio.slice(0, 10).split('-').reverse().join('/')}</span>
            )}
          </span>
          <div className="d-flex gap-1">
            {[{label:'Día', v:22},{label:'Sem',v:10},{label:'Mes',v:4},{label:'Trim',v:2}].map(z => (
              <button key={z.v}
                className={`btn btn-xs py-0 px-2 ${zoom===z.v ? 'btn-primary' : 'btn-outline-secondary'}`}
                style={{fontSize:'0.7rem'}}
                onClick={() => setZoom(z.v)}>
                {z.label}
              </button>
            ))}
            <button className="btn btn-xs btn-outline-secondary py-0 px-2 ms-1" style={{fontSize:'0.7rem'}}
              disabled={tareas.length === 0}
              onClick={() => window.open(`/proyectos/${proyecto.id}/imprimir-gantt`, '_blank')}
              title="Exportar el plan a PDF, para una presentación">
              <i className="bi bi-file-pdf me-1"/>Exportar PDF
            </button>
          </div>
        </div>
      </div>

      {err && (
        <div className="alert alert-warning py-1 small mx-3 mt-2 mb-0">{err}
          <button className="btn-close ms-2" style={{ fontSize: '0.65rem' }} onClick={() => setErr('')}/>
        </div>
      )}

      {/* ── Paneles sincronizados ──────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>

      {/* ── Panel izquierdo: filas como divs de altura fija ──────────── */}
      <div ref={leftScrollRef} onScroll={handleLeftScroll}
        style={{ width: 564, minWidth: 464, flexShrink: 0, overflowY: 'auto', borderRight: '1px solid #dee2e6' }}>

        {loading ? (
          <div className="text-center py-4"><span className="spinner-border spinner-border-sm"/></div>
        ) : tareas.length === 0 ? (
          <div className="text-center text-muted py-5" style={{ fontSize: '0.82rem' }}>
            <i className="bi bi-calendar-x d-block fs-4 mb-2"/>
            Sin tareas — agregá la primera
          </div>
        ) : (
          <>
            {/* Encabezado columnas: height 44 = HDR_H del SVG */}
            <div style={{ display: 'flex', height: 44, alignItems: 'center', background: '#f8f9fa',
                          borderBottom: '2px solid #dee2e6', fontSize: '0.72rem', fontWeight: 600, color: '#495057', flexShrink: 0 }}>
              <div style={{ width: 24, flexShrink: 0 }}/>
              <div style={{ flex: 1, minWidth: 0, paddingLeft: 4 }}>Tarea</div>
              <div style={{ width: 22, flexShrink: 0, textAlign: 'center' }} title="Módulo">M</div>
              <div style={{ width: 50, flexShrink: 0, textAlign: 'center' }}>Días</div>
              <div style={{ width: 90, flexShrink: 0, paddingLeft: 4 }}>Fechas</div>
              <div style={{ width: 60, flexShrink: 0, paddingLeft: 4 }}>Estado</div>
              <div style={{ width: 40, flexShrink: 0, textAlign: 'center' }}>Av.</div>
              {canWrite && <div style={{ width: 108, flexShrink: 0 }}/>}
            </div>

            {filasVisibles.map((f, i) => (() => { const t = f.t, idx = f.realIdx; return editId === t.id ? (
              /* ── Fila en edición ── */
              <div key={t.id} style={{ background: '#fffbf0', borderBottom: '1px solid #dee2e6' }}>
                <div style={{ padding: '6px 8px' }}>
                  <div className="d-flex flex-column gap-2">
                      {/* Nombre */}
                      <input ref={inputRef} className="form-control form-control-sm"
                        placeholder="Nombre de la tarea"
                        value={editData.nombre}
                        onChange={e => setEditData(d => ({ ...d, nombre: e.target.value }))} />

                      {/* Duración + responsable */}
                      <div className="d-flex gap-2">
                        <div className="flex-grow-1">
                          <label className="form-label mb-0" style={{ fontSize: '0.7rem' }}>Días duración</label>
                          <input type="number" onPaste={manejarPegadoNumero} className="form-control form-control-sm" min={1}
                            value={editData.duracion_dias}
                            onChange={e => setEditData(d => ({ ...d, duracion_dias: parseInt(e.target.value) || 1 }))} />
                        </div>
                        <div className="flex-grow-1">
                          <label className="form-label mb-0" style={{ fontSize: '0.7rem' }}>Responsable</label>
                          <select className="form-select form-select-sm"
                            value={editData.responsable}
                            onChange={e => setEditData(d => ({ ...d, responsable: e.target.value }))}>
                            <option value="">— Sin asignar —</option>
                            {empleados.map(n => <option key={n} value={n}>{n}</option>)}
                            {/* Si ya tiene un valor que no está en la lista lo preservamos */}
                            {editData.responsable && !empleados.includes(editData.responsable) && (
                              <option value={editData.responsable}>{editData.responsable}</option>
                            )}
                          </select>
                        </div>
                        <div className="flex-grow-1">
                          <label className="form-label mb-0" style={{ fontSize: '0.7rem' }}>Área responsable</label>
                          <select className="form-select form-select-sm"
                            value={editData.area_responsable || ''}
                            onChange={e => setEditData(d => ({ ...d, area_responsable: e.target.value }))}>
                            <option value="">— Sin asignar —</option>
                            {gerencias.map(g => <option key={g} value={g}>{g}</option>)}
                          </select>
                        </div>
                        <div style={{ width: 90 }}>
                          <label className="form-label mb-0" style={{ fontSize: '0.7rem' }} title="Para proyectos con varios equipos iguales/similares armándose en paralelo — 0 son las tareas generales del proyecto, o alcanza con eso si el proyecto es de un solo módulo.">
                            Módulo
                          </label>
                          <input type="number" onPaste={manejarPegadoNumero} className="form-control form-control-sm" min={0}
                            value={editData.modulo ?? 0}
                            onChange={e => setEditData(d => ({ ...d, modulo: parseInt(e.target.value) || 0 }))} />
                        </div>
                      </div>

                      {/* Fecha de inicio fija (corrige lo que daría el cálculo automático) */}
                      <div className="d-flex align-items-end gap-2">
                        <div>
                          <label className="form-label mb-0" style={{ fontSize: '0.7rem' }}>
                            Fecha de inicio fija
                          </label>
                          <DateInput style={{ width: 130 }}
                            value={editData.fecha_inicio_manual}
                            onChange={v => setEditData(d => ({ ...d, fecha_inicio_manual: v }))} />
                        </div>
                        {editData.fecha_inicio_manual && (
                          <button type="button" className="btn btn-sm btn-outline-secondary py-0 px-2" style={{ fontSize: '0.7rem' }}
                            onClick={() => setEditData(d => ({ ...d, fecha_inicio_manual: '' }))}>
                            Quitar (volver a automático)
                          </button>
                        )}
                        <span className="text-muted" style={{ fontSize: '0.68rem' }}>
                          {editData.fecha_inicio_manual
                            ? 'Corrige el inicio de esta tarea puntual — las que dependen de ella siguen encadenándose desde acá.'
                            : t.fecha_inicio_calc ? `Automático: ${fmtD(t.fecha_inicio_calc)} – ${fmtD(t.fecha_fin_calc)}` : ''}
                        </span>
                      </div>

                      {/* Estado + avance + color */}
                      <div className="d-flex gap-2 align-items-end">
                        <div>
                          <label className="form-label mb-0" style={{ fontSize: '0.7rem' }}>Estado</label>
                          <select className="form-select form-select-sm" value={editData.estado}
                            onChange={e => setEditData(d => ({ ...d, estado: e.target.value }))}>
                            {ESTADOS.map(e => <option key={e}>{e}</option>)}
                          </select>
                        </div>
                        <div style={{ width: 64 }}>
                          <label className="form-label mb-0" style={{ fontSize: '0.7rem' }}>Avance %</label>
                          <input type="number" onPaste={manejarPegadoNumero} className="form-control form-control-sm" min={0} max={100}
                            value={editData.avance}
                            onChange={e => setEditData(d => ({ ...d, avance: parseInt(e.target.value) || 0 }))} />
                        </div>
                        <div>
                          <label className="form-label mb-0" style={{ fontSize: '0.7rem' }}>Color</label>
                          <div className="d-flex flex-wrap gap-1">
                            {COLORES.map(c => (
                              <button key={c} title={c || 'default'}
                                style={{ width: 16, height: 16, borderRadius: 3, background: c || '#4e79a7',
                                  border: editData.color === c ? '2px solid #000' : '1px solid #aaa', padding: 0 }}
                                onClick={() => setEditData(d => ({ ...d, color: c }))} />
                            ))}
                          </div>
                        </div>
                        <div className="form-check ms-2 mb-1">
                          <input type="checkbox" className="form-check-input" id={`esGeneral-${t.id}`}
                            checked={!!editData.es_general}
                            onChange={e => setEditData(d => ({ ...d, es_general: e.target.checked, termina_con_tarea_id: e.target.checked ? d.termina_con_tarea_id : '' }))} />
                          <label className="form-check-label" htmlFor={`esGeneral-${t.id}`} style={{ fontSize: '0.7rem' }}
                            title="Marca un tramo del plan (ej. 'Fabricación'), no es trabajo real — se dibuja distinto en el gráfico, sin barra de avance.">
                            Tarea general (resumen)
                          </label>
                        </div>
                      </div>

                      {/* Tarea general: con qué tarea termina (en vez de inicio+duración) */}
                      {editData.es_general && (
                        <div>
                          <label className="form-label mb-0" style={{ fontSize: '0.7rem' }}>
                            Termina cuando termina
                          </label>
                          <select className="form-select form-select-sm"
                            value={editData.termina_con_tarea_id}
                            onChange={e => setEditData(d => ({ ...d, termina_con_tarea_id: e.target.value }))}>
                            <option value="">— Usar duración (días) —</option>
                            {tareas.filter(x => x.id !== t.id).map(x => (
                              <option key={x.id} value={x.id}>{x.nombre}</option>
                            ))}
                          </select>
                          <div className="text-muted" style={{ fontSize: '0.68rem' }}>
                            Si se elige una tarea, el fin de esta tarea general queda atado al fin de esa tarea (se mueve solo si esa tarea se corre), en vez de calcularse con los días de duración.
                          </div>
                        </div>
                      )}

                      {/* Predecesoras */}
                      <div>
                        <div className="d-flex align-items-center justify-content-between mb-1">
                          <label className="form-label mb-0" style={{ fontSize: '0.7rem' }}>
                            Predecesoras (deben terminar antes)
                          </label>
                          <div className="btn-group btn-group-sm">
                            <button type="button"
                              className={`btn py-0 px-2 ${predOrden === 'ejecucion' ? 'btn-secondary' : 'btn-outline-secondary'}`}
                              style={{ fontSize: '0.65rem' }}
                              onClick={() => setPredOrden('ejecucion')} title="Orden de ejecución">
                              <i className="bi bi-sort-numeric-down me-1"/>Orden
                            </button>
                            <button type="button"
                              className={`btn py-0 px-2 ${predOrden === 'alfa' ? 'btn-secondary' : 'btn-outline-secondary'}`}
                              style={{ fontSize: '0.65rem' }}
                              onClick={() => setPredOrden('alfa')} title="Orden alfabético">
                              <i className="bi bi-sort-alpha-down me-1"/>A-Z
                            </button>
                          </div>
                        </div>

                        {/* Chips de seleccionadas */}
                        {editData.predecesoras.length > 0 && (
                          <div className="d-flex flex-wrap gap-1 mb-1">
                            {editData.predecesoras.map(pid => {
                              const tx = tareas.find(x => x.id === pid)
                              return tx ? (
                                <span key={pid} className="badge bg-primary d-flex align-items-center gap-1"
                                  style={{ fontSize: '0.65rem', cursor: 'pointer' }}
                                  onClick={() => setEditData(d => ({ ...d, predecesoras: d.predecesoras.filter(p => p !== pid) }))}>
                                  {tx.nombre.length > 22 ? tx.nombre.slice(0, 21) + '…' : tx.nombre}
                                  <i className="bi bi-x"/>
                                </span>
                              ) : null
                            })}
                          </div>
                        )}

                        {/* Buscador */}
                        <input className="form-control form-control-sm mb-1" placeholder="Buscar tarea..."
                          style={{ fontSize: '0.72rem' }}
                          value={predBuscar}
                          onChange={e => setPredBuscar(e.target.value)} />

                        {/* Lista desplegable */}
                        <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid #dee2e6', borderRadius: 4 }}>
                          {(() => {
                            let candidatas = tareas.filter(x => x.id !== t.id)
                            if (predBuscar.trim()) {
                              const bq = predBuscar.toLowerCase()
                              candidatas = candidatas.filter(x => x.nombre.toLowerCase().includes(bq))
                            }
                            if (predOrden === 'alfa') {
                              candidatas = [...candidatas].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
                            }
                            if (candidatas.length === 0) return (
                              <div className="text-muted text-center py-2" style={{ fontSize: '0.7rem' }}>Sin resultados</div>
                            )
                            return candidatas.map(x => {
                              const sel = editData.predecesoras.includes(x.id)
                              return (
                                <div key={x.id}
                                  className={`px-2 py-1 d-flex align-items-center gap-2 ${sel ? 'bg-primary bg-opacity-10' : ''}`}
                                  style={{ cursor: 'pointer', fontSize: '0.72rem', borderBottom: '1px solid #f0f0f0' }}
                                  onClick={() => setEditData(d => ({
                                    ...d,
                                    predecesoras: sel
                                      ? d.predecesoras.filter(p => p !== x.id)
                                      : [...d.predecesoras, x.id]
                                  }))}>
                                  <input type="checkbox" readOnly checked={sel} style={{ pointerEvents: 'none' }}/>
                                  <span className={sel ? 'fw-semibold' : ''}>{x.nombre}</span>
                                </div>
                              )
                            })
                          })()}
                        </div>
                      </div>

                      {/* Observaciones */}
                      <textarea className="form-control form-control-sm" rows={2} placeholder="Observaciones"
                        value={editData.observaciones}
                        onChange={e => setEditData(d => ({ ...d, observaciones: e.target.value }))} />

                      {/* Botones */}
                      <div className="d-flex gap-2">
                        <button className="btn btn-sm btn-success py-0 px-3" style={{ fontSize: '0.75rem' }}
                          onClick={() => guardar(t.id)} disabled={saving}>
                          {saving ? <span className="spinner-border spinner-border-sm"/> : <><i className="bi bi-check-lg me-1"/>Guardar</>}
                        </button>
                        <button className="btn btn-sm btn-outline-secondary py-0 px-2" style={{ fontSize: '0.75rem' }}
                          onClick={() => setEditId(null)}>Cancelar</button>
                        <button type="button" className="btn btn-sm btn-outline-danger py-0 px-2 ms-auto" style={{ fontSize: '0.75rem' }}
                          onClick={() => { setEditId(null); eliminar(t.id) }}>
                          <i className="bi bi-trash me-1"/>Eliminar
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                /* ── Fila normal: div con height FIJA 28px ── */
                <div key={t.id} style={{ display: 'flex', height: 28, alignItems: 'center',
                                         overflow: 'hidden', borderBottom: '1px solid #f0f0f0' }}>
                  <div style={{ width: 24, padding: '0 4px', flexShrink: 0 }}>
                    {t.es_general
                      ? <i className="bi bi-bookmark-fill" style={{ color: '#495057', fontSize: '0.7rem' }} title="Tarea general (resumen)"/>
                      : <div style={{ width: 8, height: 20, borderRadius: 2, background: t.color || '#4e79a7' }} />}
                  </div>
                  <div style={{ flex: 1, overflow: 'hidden', minWidth: 0, paddingLeft: 4 }}>
                    <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}
                      title={[t.nombre, t.responsable, t.area_responsable, t.modulo > 0 ? `Módulo ${t.modulo}` : '', (t.predecesoras||[]).length ? `pred: ${t.predecesoras.join(', ')}` : ''].filter(Boolean).join(' · ')}>
                      <span style={{ fontSize: '0.78rem', fontWeight: (t.color === '#495057' || t.es_general) ? '600' : 'normal' }}>{t.nombre}</span>
                      {t.responsable && <span className="text-muted ms-1" style={{ fontSize: '0.68rem' }}>· {t.responsable}</span>}
                      {t.area_responsable && <span className="text-muted ms-1" style={{ fontSize: '0.68rem' }}>· {t.area_responsable}</span>}
                    </div>
                  </div>
                  {/* 0 = tareas generales del proyecto o proyecto de un solo módulo — columna en blanco */}
                  <div style={{ width: 22, textAlign: 'center', flexShrink: 0, fontSize: '0.72rem', color: '#6c757d' }}>{t.modulo > 0 ? t.modulo : ''}</div>
                  <div style={{ width: 50, textAlign: 'center', flexShrink: 0, fontSize: '0.75rem' }}>{t.duracion_dias}d</div>
                  <div style={{ width: 90, fontSize: '0.68rem', color: '#6c757d', flexShrink: 0, lineHeight: 1.2, paddingLeft: 4 }}>
                    {t.fecha_inicio_calc ? (
                      <>
                        {fmtD(t.fecha_inicio_calc)}
                        {t.fecha_inicio_manual && <i className="bi bi-pin-angle-fill ms-1 text-warning" title="Fecha de inicio fijada a mano"/>}
                        <br/>{fmtD(t.fecha_fin_calc)}
                      </>
                    ) : <span className="text-muted">—</span>}
                  </div>
                  <div style={{ width: 60, flexShrink: 0, paddingLeft: 4 }}><EstadoBadge estado={t.estado} /></div>
                  <div style={{ width: 40, flexShrink: 0 }}>
                    <div className="d-flex align-items-center gap-1">
                      <div style={{ width: 28, height: 5, background: '#dee2e6', borderRadius: 2, overflow: 'hidden' }}>
                        <div style={{ width: `${t.avance}%`, height: '100%', background: '#0d6efd' }} />
                      </div>
                      <span style={{ fontSize: '0.65rem', color: '#6c757d' }}>{t.avance}%</span>
                    </div>
                  </div>
                  {canWrite && (
                    <div style={{ width: 108, flexShrink: 0 }}>
                      <div className="d-flex gap-0">
                        <button className="btn btn-xs p-0 px-1 text-secondary" title="Editar"
                          onClick={() => iniciarEdicion(t.id)} style={{ fontSize: '0.75rem' }}>
                          <i className="bi bi-pencil"/>
                        </button>
                        <button className="btn btn-xs p-0 px-1 text-secondary" title="Subir"
                          onClick={() => mover(idx, -1)} disabled={i === 0} style={{ fontSize: '0.65rem' }}>
                          <i className="bi bi-chevron-up"/>
                        </button>
                        <button className="btn btn-xs p-0 px-1 text-secondary" title="Bajar"
                          onClick={() => mover(idx, 1)} disabled={i === filasVisibles.length - 1} style={{ fontSize: '0.65rem' }}>
                          <i className="bi bi-chevron-down"/>
                        </button>
                        <button className="btn btn-xs p-0 px-1 text-success" title="Insertar tarea debajo"
                          onClick={() => abrirAgregar(idx)} style={{ fontSize: '0.75rem' }}>
                          <i className="bi bi-plus-circle"/>
                        </button>
                        <button className="btn btn-xs p-0 px-1 text-danger" title="Eliminar"
                          onClick={() => eliminar(t.id)} style={{ fontSize: '0.75rem' }}>
                          <i className="bi bi-trash"/>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )})())}
          </>
        )}
      </div>

      {/* ── Panel derecho: SVG Gantt ─────────────────────────────────────── */}
      <div ref={rightScrollRef} onScroll={handleRightScroll}
        style={{ flex: 1, overflowX: 'auto', overflowY: 'auto' }}>
        {!loading && (
          <GanttSVG filas={filasSvg} dayW={zoom} />
        )}
        {!loading && tareas.length > 0 && (
          <div className="d-flex flex-wrap gap-3 mt-2 px-2" style={{ fontSize: '0.7rem', color: '#6c757d' }}>
            <span><span style={{ display: 'inline-block', width: 12, height: 8, background: 'rgba(78,121,167,0.3)', border: '1px solid #4e79a7', borderRadius: 2, marginRight: 4 }}/>Planificado</span>
            <span><span style={{ display: 'inline-block', width: 12, height: 8, background: '#4e79a7', borderRadius: 2, marginRight: 4 }}/>Avance real</span>
            <span><span style={{ display: 'inline-block', width: 1, height: 10, background: '#dc3545', marginRight: 4 }}/>Hoy</span>
          </div>
        )}
      </div>

      </div>
    </div>

    {/* ── Modal: guardar como plantilla ──────────────────────────────────── */}
    {modalGuardar && (
      <div className="modal fade show d-block" style={{ background: 'rgba(0,0,0,.5)', zIndex: 1055 }}>
        <div className="modal-dialog modal-dialog-centered">
          <div className="modal-content">
            <div className="modal-header py-2">
              <h6 className="modal-title">
                <i className="bi bi-cloud-upload me-2"/>Guardar plan como plantilla
              </h6>
              <button className="btn-close" onClick={() => setModalGuardar(false)}/>
            </div>
            <div className="modal-body">
              <div className="alert alert-info py-2 small mb-3">
                <i className="bi bi-info-circle me-1"/>
                Se guardarán <strong>{tareas.length} tareas</strong> del proyecto actual como una nueva plantilla reutilizable.
              </div>
              <div className="mb-2">
                <label className="form-label small fw-semibold">Nombre de la plantilla <span className="text-danger">*</span></label>
                <input className="form-control form-control-sm" placeholder="Ej: Fabricación equipo DAF"
                  value={guardarNombre} onChange={e => setGuardarNombre(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && guardarComoPlantilla()}
                  autoFocus />
                <div className="form-text" style={{ fontSize: '0.7rem' }}>
                  La plantilla quedará disponible en Proyectos → Plantilla para ser aplicada a otros proyectos.
                </div>
              </div>
            </div>
            <div className="modal-footer py-2">
              <button className="btn btn-sm btn-secondary" onClick={() => setModalGuardar(false)}>Cancelar</button>
              <button className="btn btn-sm btn-success" onClick={guardarComoPlantilla}
                disabled={guardarLoading || !guardarNombre.trim()}>
                {guardarLoading
                  ? <><span className="spinner-border spinner-border-sm me-1"/>Guardando...</>
                  : <><i className="bi bi-check-lg me-1"/>Guardar como plantilla</>
                }
              </button>
            </div>
          </div>
        </div>
      </div>
    )}

    {/* ── Modal: cargar plantilla ─────────────────────────────────────────── */}
    {modalPlant && (
      <div className="modal fade show d-block" style={{ background: 'rgba(0,0,0,.5)', zIndex: 1055 }}>
        <div className="modal-dialog modal-dialog-centered">
          <div className="modal-content">
            <div className="modal-header py-2">
              <h6 className="modal-title">
                <i className="bi bi-file-earmark-arrow-down me-2"/>Cargar plantilla de tareas
              </h6>
              <button className="btn-close" onClick={() => setModalPlant(false)}/>
            </div>
            <div className="modal-body">
              {plantLoading ? (
                <div className="text-center py-3"><span className="spinner-border spinner-border-sm"/></div>
              ) : (
                <>
                  <div className="mb-3">
                    <label className="form-label small fw-semibold">Seleccioná una plantilla</label>

                    {/* Opción: Master Plan / HR global */}
                    <div className={`border rounded px-3 py-2 mb-2 ${plantSelSet === null ? 'border-primary bg-primary bg-opacity-10' : ''}`}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setPlantSelSet(null)}>
                      <div className="d-flex align-items-center gap-2">
                        <input type="radio" readOnly checked={plantSelSet === null} />
                        <div>
                          <div className="fw-semibold small">Master Plan / Hojas de Ruta</div>
                          <div className="text-muted" style={{ fontSize: '0.72rem' }}>Plantilla global del sistema</div>
                        </div>
                      </div>
                    </div>

                    {plantSets.length === 0 && (
                      <div className="text-muted small fst-italic px-1">
                        No hay plantillas nombradas aún — podés crear una desde el panel Plantilla o guardando este plan.
                      </div>
                    )}
                    {plantSets.map(s => (
                      <div key={s.id}
                        className={`border rounded px-3 py-2 mb-2 ${plantSelSet === s.id ? 'border-primary bg-primary bg-opacity-10' : ''}`}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setPlantSelSet(s.id)}>
                        <div className="d-flex align-items-center gap-2">
                          <input type="radio" readOnly checked={plantSelSet === s.id} />
                          <div>
                            <div className="fw-semibold small">{s.nombre}</div>
                            <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                              {s.tareas_reales} tareas{s.descripcion ? ` · ${s.descripcion}` : ''}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mb-2">
                    <label className="form-label small fw-semibold">¿Qué hacer con las tareas existentes?</label>
                    <div className="form-check">
                      <input className="form-check-input" type="radio" id="modo_agregar"
                        checked={!plantReemplazar} onChange={() => setPlantReemplazar(false)} />
                      <label className="form-check-label small" htmlFor="modo_agregar">
                        Agregar a las tareas ya existentes
                      </label>
                    </div>
                    <div className="form-check">
                      <input className="form-check-input" type="radio" id="modo_reemplazar"
                        checked={plantReemplazar} onChange={() => setPlantReemplazar(true)} />
                      <label className="form-check-label small text-danger" htmlFor="modo_reemplazar">
                        <i className="bi bi-exclamation-triangle me-1"/>
                        Reemplazar (borra las tareas actuales)
                      </label>
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="modal-footer py-2">
              <button className="btn btn-sm btn-secondary" onClick={() => setModalPlant(false)}>Cancelar</button>
              <button className="btn btn-sm btn-primary" onClick={aplicarPlantilla}
                disabled={plantLoading}>
                {plantLoading
                  ? <><span className="spinner-border spinner-border-sm me-1"/>Cargando...</>
                  : <><i className="bi bi-check-lg me-1"/>Aplicar plantilla</>
                }
              </button>
            </div>
          </div>
        </div>
      </div>
    )}

    {/* ── Modal: agregar tarea (existente del Master Plan o nueva) ─────────── */}
    {modalAgregar && (() => {
      const busq = agregarBuscar.trim().toLowerCase()
      const filtradas = busq ? masterTareas.filter(t => t.nombre.toLowerCase().includes(busq)) : masterTareas
      const hayExacta = busq && masterTareas.some(t => t.nombre.trim().toLowerCase() === busq)
      return (
        <div className="modal fade show d-block" style={{ background: 'rgba(0,0,0,.5)', zIndex: 1060 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h6 className="modal-title"><i className="bi bi-plus-circle me-2"/>Agregar tarea</h6>
                <button className="btn-close" onClick={() => setModalAgregar(null)} />
              </div>
              <div className="modal-body">
                <label className="form-label small fw-semibold">Buscar tarea existente o escribir una nueva</label>
                <input className="form-control form-control-sm mb-2" autoFocus
                  placeholder="Ej: Diseño de estructura"
                  value={agregarBuscar}
                  onChange={e => setAgregarBuscar(e.target.value)} />

                {masterLoading ? (
                  <div className="text-center py-3"><span className="spinner-border spinner-border-sm"/></div>
                ) : (
                  <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #dee2e6', borderRadius: 4 }}>
                    {filtradas.length === 0 ? (
                      <div className="text-muted text-center py-3" style={{ fontSize: '0.8rem' }}>
                        Sin coincidencias en el Master Plan
                      </div>
                    ) : filtradas.map(t => (
                      <div key={t.id}
                        className="px-2 py-1 d-flex justify-content-between align-items-center border-bottom"
                        style={{ cursor: 'pointer', fontSize: '0.82rem' }}
                        onClick={() => elegirExistente(t)}>
                        <span>{t.nombre}</span>
                        <span className="text-muted" style={{ fontSize: '0.7rem' }}>{t.duracion_dias}d</span>
                      </div>
                    ))}
                  </div>
                )}

                {busq && !hayExacta && (
                  <div className="mt-3 p-2 border rounded" style={{ background: '#fffbf0' }}>
                    <div className="small mb-2">
                      <i className="bi bi-stars me-1 text-warning"/>
                      No existe en el Master Plan. Se va a crear como tarea nueva y va a quedar disponible para futuros proyectos.
                    </div>
                    <div className="d-flex gap-2 align-items-end">
                      <div style={{ width: 90 }}>
                        <label className="form-label mb-0" style={{ fontSize: '0.7rem' }}>Días</label>
                        <input type="number" onPaste={manejarPegadoNumero} min={1} className="form-control form-control-sm"
                          value={nuevaDuracion} onChange={e => setNuevaDuracion(parseInt(e.target.value) || 1)} />
                      </div>
                      <button type="button" className="btn btn-sm btn-success" onClick={crearNueva} disabled={agregando}>
                        {agregando ? <span className="spinner-border spinner-border-sm me-1"/> : <i className="bi bi-plus-lg me-1"/>}
                        Crear "{agregarBuscar.trim()}"
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <div className="modal-footer py-2">
                <button className="btn btn-sm btn-secondary" onClick={() => setModalAgregar(null)}>Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )
    })()}
    </>
  )
}
