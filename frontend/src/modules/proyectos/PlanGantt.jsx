import { useState, useEffect, useRef, useCallback } from 'react'
import api from '../../api/client'

const ESTADOS = ['Pendiente', 'En proceso', 'Completado', 'Cancelado', 'Bloqueado']
const COLORES  = ['', '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f']

const fmtD = iso => iso ? iso.slice(5).replace('-', '/') : ''  // MM/DD → display
const diasEntre = (a, b) => {
  if (!a || !b) return 0
  return Math.round((new Date(b) - new Date(a)) / 86400000)
}

// ── Componente interno: celda de estado con badge ─────────────────────────────
function EstadoBadge({ estado }) {
  const map = { Pendiente: 'secondary', 'En proceso': 'primary', Completado: 'success', Cancelado: 'danger', Bloqueado: 'warning' }
  return <span className={`badge bg-${map[estado] || 'secondary'}`} style={{ fontSize: '0.65rem' }}>{estado}</span>
}

// ── SVG del Gantt ─────────────────────────────────────────────────────────────
function GanttSVG({ tareas, dayW = 22 }) {
  if (!tareas.length) {
    return <div className="text-center text-muted py-5 small">Sin tareas para mostrar</div>
  }

  const ROW_H  = 28
  const HDR_H  = 44
  const PAD_L  = 0
  const DAY_W  = dayW

  // Rango total de fechas
  const fechas = tareas.flatMap(t => [t.fecha_inicio_calc, t.fecha_fin_calc]).filter(Boolean)
  if (!fechas.length) return (
    <div className="text-center text-muted py-5 small">
      <i className="bi bi-calendar-x d-block fs-4 mb-2"/>
      Las fechas se calculan al guardar cada tarea.<br/>
      Si el proyecto no tiene fecha de inicio se usa la fecha actual.
    </div>
  )

  const minDate = new Date(fechas.reduce((a, b) => a < b ? a : b) + 'T00:00:00')
  const maxDate = new Date(fechas.reduce((a, b) => a > b ? a : b) + 'T00:00:00')
  const totalDias = diasEntre(minDate.toISOString().slice(0, 10), maxDate.toISOString().slice(0, 10)) + 2

  const svgW = PAD_L + totalDias * DAY_W + 20
  const svgH = HDR_H + tareas.length * ROW_H + 10

  const xOf = iso => {
    if (!iso) return PAD_L
    return PAD_L + diasEntre(minDate.toISOString().slice(0, 10), iso) * DAY_W
  }

  // Meses en el header
  const meses = []
  const cur = new Date(minDate)
  while (cur <= maxDate) {
    const y = cur.getFullYear(), m = cur.getMonth()
    const label = cur.toLocaleString('es-AR', { month: 'short', year: '2-digit' })
    const x1 = xOf(cur.toISOString().slice(0, 10))
    // avanzar hasta fin de mes o fin de rango
    const nextM = new Date(y, m + 1, 1)
    const x2 = xOf((nextM <= maxDate ? nextM : new Date(maxDate.getTime() + 86400000)).toISOString().slice(0, 10))
    meses.push({ label, x1, x2 })
    cur.setMonth(cur.getMonth() + 1)
    cur.setDate(1)
  }

  // Hoy
  const hoy = new Date().toISOString().slice(0, 10)
  const xHoy = xOf(hoy)

  // Mapa id → orden para flechas
  const idxMap = {}
  tareas.forEach((t, i) => idxMap[t.id] = i)

  return (
    <div style={{ overflowX: 'auto', overflowY: 'visible' }}>
      <svg width={svgW} height={svgH} style={{ display: 'block', fontFamily: 'inherit' }}>
        {/* ── fondo alternado ── */}
        {tareas.map((_, i) => (
          <rect key={i} x={0} y={HDR_H + i * ROW_H} width={svgW} height={ROW_H}
            fill={i % 2 === 0 ? '#f8f9fa' : '#ffffff'} />
        ))}

        {/* ── líneas verticales de días ── */}
        {Array.from({ length: totalDias }, (_, d) => (
          <line key={d} x1={PAD_L + d * DAY_W} y1={HDR_H} x2={PAD_L + d * DAY_W} y2={svgH}
            stroke="#dee2e6" strokeWidth={0.5} />
        ))}

        {/* ── Header: meses ── */}
        <rect x={0} y={0} width={svgW} height={HDR_H} fill="#e9ecef" />
        {meses.map((m, i) => (
          <g key={i}>
            <line x1={m.x1} y1={0} x2={m.x1} y2={HDR_H} stroke="#adb5bd" strokeWidth={1} />
            <text x={(m.x1 + m.x2) / 2} y={14} textAnchor="middle" fontSize={10} fill="#495057" fontWeight="600">
              {m.label}
            </text>
          </g>
        ))}

        {/* ── Números de día ── */}
        {Array.from({ length: totalDias }, (_, d) => {
          const dd = new Date(minDate); dd.setDate(dd.getDate() + d)
          const dn = dd.getDate()
          return dn % 5 === 0 || dn === 1 ? (
            <text key={d} x={PAD_L + d * DAY_W + DAY_W / 2} y={32} textAnchor="middle" fontSize={8} fill="#6c757d">
              {dn}
            </text>
          ) : null
        })}

        {/* ── Línea de hoy ── */}
        {hoy >= minDate.toISOString().slice(0, 10) && hoy <= maxDate.toISOString().slice(0, 10) && (
          <>
            <line x1={xHoy} y1={HDR_H} x2={xHoy} y2={svgH} stroke="#dc3545" strokeWidth={1.5} strokeDasharray="4 3" />
            <text x={xHoy + 3} y={HDR_H + 10} fontSize={8} fill="#dc3545">Hoy</text>
          </>
        )}

        {/* ── Flechas de dependencia ── */}
        {tareas.map(t =>
          (t.predecesoras || []).map(pid => {
            const pi = idxMap[pid]
            if (pi === undefined) return null
            const pred = tareas[pi]
            if (!pred.fecha_fin_calc || !t.fecha_inicio_calc) return null
            const x1 = xOf(pred.fecha_fin_calc) + DAY_W
            const y1 = HDR_H + pi * ROW_H + ROW_H / 2
            const x2 = xOf(t.fecha_inicio_calc)
            const y2 = HDR_H + idxMap[t.id] * ROW_H + ROW_H / 2
            const mx = (x1 + x2) / 2
            return (
              <g key={`${pid}-${t.id}`}>
                <path d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                  fill="none" stroke="#6c757d" strokeWidth={1.2} markerEnd="url(#arr)" />
              </g>
            )
          })
        )}

        {/* ── Barras ── */}
        {tareas.map((t, i) => {
          const x = xOf(t.fecha_inicio_calc)
          const w = Math.max(diasEntre(t.fecha_inicio_calc, t.fecha_fin_calc) + 1, 1) * DAY_W
          const y = HDR_H + i * ROW_H + 4
          const h = ROW_H - 8
          const color = t.color || '#4e79a7'
          const pct   = Math.min(Math.max(t.avance || 0, 0), 100)
          return (
            <g key={t.id}>
              {/* barra fondo */}
              <rect x={x} y={y} width={w} height={h} rx={3} fill={color} opacity={0.3} />
              {/* avance */}
              {pct > 0 && (
                <rect x={x} y={y} width={w * pct / 100} height={h} rx={3} fill={color} opacity={0.85} />
              )}
              {/* borde */}
              <rect x={x} y={y} width={w} height={h} rx={3} fill="none" stroke={color} strokeWidth={1.2} />
              {/* texto si hay espacio */}
              {w > 30 && (
                <text x={x + w / 2} y={y + h / 2 + 3.5} textAnchor="middle" fontSize={9} fill="#fff"
                  style={{ pointerEvents: 'none' }}>
                  {pct > 0 ? `${pct}%` : ''}
                </text>
              )}
            </g>
          )
        })}

        {/* ── Marcador de flecha ── */}
        <defs>
          <marker id="arr" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#6c757d" />
          </marker>
        </defs>
      </svg>
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function PlanGantt({ proyecto, canWrite }) {
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
  const [recalculando,   setRecalculando]   = useState(false)
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

  const recalcularFechas = async () => {
    if (!canWrite) return
    setRecalculando(true)
    try {
      await api.post(`/gantt/proyecto/${proyecto.id}/recalcular`)
      await cargar()
    } catch { setErr('Error al recalcular fechas') }
    finally { setRecalculando(false) }
  }

  useEffect(() => {
    api.get('/rrhh/empleados').then(({ data }) => {
      setEmpleados(data.filter(e => e.activo !== 0).map(e => e.nombre).sort((a, b) => a.localeCompare(b, 'es')))
    }).catch(() => {})
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
      estado:       t.estado,
      avance:       t.avance,
      color:        t.color,
      observaciones: t.observaciones,
      predecesoras: t.predecesoras || [],
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
      if (data?.ciclosEvitados) {
        setErr(`Se ignoró ${data.ciclosEvitados === 1 ? 'una predecesora' : `${data.ciclosEvitados} predecesoras`} porque generaba una dependencia circular.`)
      }
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
  const mover = async (idx, dir) => {
    if (!canWrite) return
    const arr = [...tareas]
    const swap = idx + dir
    if (swap < 0 || swap >= arr.length) return
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
          {canWrite && (
            <div className="d-flex gap-1">
              <button className="btn btn-sm btn-outline-success py-0 px-2" style={{ fontSize: '0.75rem' }}
                onClick={() => { setGuardarNombre(''); setModalGuardar(true) }}
                title="Guardar este plan como plantilla" disabled={tareas.length === 0}>
                <i className="bi bi-cloud-upload me-1"/>Guardar plantilla
              </button>
              <button className="btn btn-sm btn-outline-primary py-0 px-2" style={{ fontSize: '0.75rem' }}
                onClick={abrirPlantilla} title="Cargar plantilla">
                <i className="bi bi-file-earmark-arrow-down me-1"/>Cargar plantilla
              </button>
              <button className="btn btn-sm btn-outline-secondary py-0 px-2" style={{ fontSize: '0.75rem' }}
                onClick={recalcularFechas} disabled={recalculando}
                title="Recalcular fechas de todas las tareas según sus predecesoras">
                {recalculando ? <span className="spinner-border spinner-border-sm me-1"/> : <i className="bi bi-arrow-repeat me-1"/>}
                Recalcular fechas
              </button>
              <button className="btn btn-sm btn-primary py-0 px-2" style={{ fontSize: '0.75rem' }}
                onClick={() => abrirAgregar()} disabled={saving}>
                <i className="bi bi-plus-lg me-1"/>Tarea
              </button>
            </div>
          )}
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
              <div style={{ width: 50, flexShrink: 0, textAlign: 'center' }}>Días</div>
              <div style={{ width: 90, flexShrink: 0, paddingLeft: 4 }}>Fechas</div>
              <div style={{ width: 60, flexShrink: 0, paddingLeft: 4 }}>Estado</div>
              <div style={{ width: 40, flexShrink: 0, textAlign: 'center' }}>Av.</div>
              {canWrite && <div style={{ width: 108, flexShrink: 0 }}/>}
            </div>

            {tareas.map((t, idx) => editId === t.id ? (
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
                          <input type="number" className="form-control form-control-sm" min={1}
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
                          <input type="number" className="form-control form-control-sm" min={0} max={100}
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
                      </div>

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
                    <div style={{ width: 8, height: 20, borderRadius: 2, background: t.color || '#4e79a7' }} />
                  </div>
                  <div style={{ flex: 1, overflow: 'hidden', minWidth: 0, paddingLeft: 4 }}>
                    <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}
                      title={[t.nombre, t.responsable, (t.predecesoras||[]).length ? `pred: ${t.predecesoras.join(', ')}` : ''].filter(Boolean).join(' · ')}>
                      <span style={{ fontSize: '0.78rem', fontWeight: t.color === '#495057' ? '600' : 'normal' }}>{t.nombre}</span>
                      {t.responsable && <span className="text-muted ms-1" style={{ fontSize: '0.68rem' }}>· {t.responsable}</span>}
                    </div>
                  </div>
                  <div style={{ width: 50, textAlign: 'center', flexShrink: 0, fontSize: '0.75rem' }}>{t.duracion_dias}d</div>
                  <div style={{ width: 90, fontSize: '0.68rem', color: '#6c757d', flexShrink: 0, lineHeight: 1.2, paddingLeft: 4 }}>
                    {t.fecha_inicio_calc ? (
                      <>{fmtD(t.fecha_inicio_calc)}<br/>{fmtD(t.fecha_fin_calc)}</>
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
                          onClick={() => mover(idx, -1)} disabled={idx === 0} style={{ fontSize: '0.65rem' }}>
                          <i className="bi bi-chevron-up"/>
                        </button>
                        <button className="btn btn-xs p-0 px-1 text-secondary" title="Bajar"
                          onClick={() => mover(idx, 1)} disabled={idx === tareas.length - 1} style={{ fontSize: '0.65rem' }}>
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
              ))}
          </>
        )}
      </div>

      {/* ── Panel derecho: SVG Gantt ─────────────────────────────────────── */}
      <div ref={rightScrollRef} onScroll={handleRightScroll}
        style={{ flex: 1, overflowX: 'auto', overflowY: 'auto' }}>
        {!loading && (
          <GanttSVG tareas={tareas} dayW={zoom} />
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
                        <input type="number" min={1} className="form-control form-control-sm"
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
