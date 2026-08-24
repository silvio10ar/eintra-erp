import { useState, useEffect, useCallback, useMemo } from 'react'
import api from '../../api/client'

const ESTADO_CLS = {
  Pendiente:   'bg-warning text-dark',
  'En proceso': 'bg-info text-dark',
  Completado:  'bg-success',
  Cancelado:   'bg-secondary',
  Bloqueado:   'bg-danger',
}

const SIN_GERENCIA = '__sin_gerencia__'
const SIN_RESPONSABLE = '__sin_responsable__'

const fmtF = s => {
  if (!s) return '—'
  const d = new Date(s + 'T00:00:00')
  return isNaN(d) ? s : d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function MisTareas() {
  const [tareas,    setTareas]    = useState([])
  const [loading,   setLoading]   = useState(true)
  const [guardando, setGuardando] = useState(null) // id de la tarea en curso de guardado

  const [filtroProyecto,    setFiltroProyecto]    = useState('')
  const [filtroEstado,      setFiltroEstado]      = useState('pendientes')
  const [filtroGerencia,    setFiltroGerencia]    = useState('')
  const [filtroResponsable, setFiltroResponsable] = useState('')

  const cargar = useCallback(() => {
    setLoading(true)
    api.get('/tareas-gerencia/mis-tareas')
      .then(({ data }) => setTareas(data))
      .catch(e => console.error(e))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const marcar = async (tarea, completada) => {
    setGuardando(tarea.id)
    try {
      const { data } = await api.patch(`/tareas-gerencia/tareas/${tarea.id}/completar`, { completada })
      setTareas(prev => prev.map(t => t.id === tarea.id ? { ...t, ...data } : t))
    } catch (e) {
      alert(e.response?.data?.error || 'Error al guardar')
    } finally {
      setGuardando(null)
    }
  }

  const proyectosDisponibles = useMemo(() => {
    const mapa = new Map()
    for (const t of tareas) if (!mapa.has(t.proyecto_id)) mapa.set(t.proyecto_id, { id: t.proyecto_id, codigo: t.proyecto_codigo, nombre: t.proyecto_nombre })
    return [...mapa.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }, [tareas])

  const gerenciasDisponibles = useMemo(() => {
    const set = new Set(tareas.map(t => t.area_responsable || SIN_GERENCIA))
    return [...set].sort((a, b) => a === SIN_GERENCIA ? 1 : b === SIN_GERENCIA ? -1 : a.localeCompare(b, 'es'))
  }, [tareas])

  // Un gerente ve tareas de varias personas a la vez — este filtro es el que
  // le permite acotar a una sola sin tener que buscarla a ojo en la lista.
  const responsablesDisponibles = useMemo(() => {
    const set = new Set(tareas.map(t => t.responsable || SIN_RESPONSABLE))
    return [...set].sort((a, b) => a === SIN_RESPONSABLE ? 1 : b === SIN_RESPONSABLE ? -1 : a.localeCompare(b, 'es'))
  }, [tareas])

  const tareasFiltradas = tareas.filter(t => {
    if (filtroProyecto && String(t.proyecto_id) !== filtroProyecto) return false
    if (filtroEstado === 'pendientes' && t.estado === 'Completado') return false
    if (filtroEstado === 'completadas' && t.estado !== 'Completado') return false
    if (filtroGerencia && (t.area_responsable || SIN_GERENCIA) !== filtroGerencia) return false
    if (filtroResponsable && (t.responsable || SIN_RESPONSABLE) !== filtroResponsable) return false
    return true
  })

  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '50vh' }}>
        <span className="spinner-border text-secondary" />
      </div>
    )
  }

  const porProyecto = {}
  for (const t of tareasFiltradas) (porProyecto[t.proyecto_id] ??= { info: t, items: [] }).items.push(t)

  return (
    <div>
      <h4 className="mb-0 fw-bold">
        <i className="bi bi-check2-square me-2 text-primary" />
        Mis Tareas
      </h4>
      <p className="text-muted small mb-3">
        Tareas del Plan de cada proyecto que tenés asignadas, o de la gente que te reporta en el organigrama.
      </p>

      {tareas.length > 0 && (
        <div className="d-flex gap-2 flex-wrap mb-3">
          <select className="form-select form-select-sm" style={{ width: 220 }}
            value={filtroProyecto} onChange={e => setFiltroProyecto(e.target.value)}>
            <option value="">Todos los proyectos</option>
            {proyectosDisponibles.map(p => (
              <option key={p.id} value={p.id}>{p.codigo} — {p.nombre}</option>
            ))}
          </select>
          <select className="form-select form-select-sm" style={{ width: 160 }}
            value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
            <option value="todas">Todos los estados</option>
            <option value="pendientes">Pendientes</option>
            <option value="completadas">Completadas</option>
          </select>
          <select className="form-select form-select-sm" style={{ width: 200 }}
            value={filtroGerencia} onChange={e => setFiltroGerencia(e.target.value)}>
            <option value="">Todas las gerencias</option>
            {gerenciasDisponibles.map(g => (
              <option key={g} value={g}>{g === SIN_GERENCIA ? 'Sin gerencia asignada' : g}</option>
            ))}
          </select>
          {responsablesDisponibles.length > 1 && (
            <select className="form-select form-select-sm" style={{ width: 200 }}
              value={filtroResponsable} onChange={e => setFiltroResponsable(e.target.value)}>
              <option value="">Todos los empleados</option>
              {responsablesDisponibles.map(r => (
                <option key={r} value={r}>{r === SIN_RESPONSABLE ? 'Sin responsable asignado' : r}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {tareas.length === 0 ? (
        <div className="text-center text-muted py-5">
          <i className="bi bi-inbox display-6 d-block mb-2" />No tenés tareas asignadas por ahora.
        </div>
      ) : tareasFiltradas.length === 0 ? (
        <div className="text-center text-muted py-5">
          <i className="bi bi-funnel display-6 d-block mb-2" />Ninguna tarea coincide con el filtro elegido.
        </div>
      ) : (
        <div className="d-flex flex-column gap-3">
          {Object.values(porProyecto).map(({ info, items }) => (
            <div key={info.proyecto_id} className="card border-0 shadow-sm">
              <div className="card-header bg-white py-2">
                <span className="badge bg-dark me-2" style={{ fontFamily: 'monospace' }}>{info.proyecto_codigo}</span>
                <span className="fw-semibold small">{info.proyecto_nombre}</span>
              </div>
              <div className="table-responsive">
                <table className="table table-sm align-middle mb-0">
                  <thead className="table-light">
                    <tr>
                      <th style={{ width: 36 }} />
                      <th>Tarea</th>
                      <th>Responsable</th>
                      <th>Gerencia</th>
                      <th>Fechas</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(t => (
                      <tr key={t.id} style={t.estado === 'Completado' ? { opacity: 0.6 } : {}}>
                        <td className="text-center">
                          {guardando === t.id ? (
                            <span className="spinner-border spinner-border-sm" />
                          ) : (
                            <input type="checkbox" className="form-check-input" checked={t.estado === 'Completado'}
                              onChange={e => marcar(t, e.target.checked)} />
                          )}
                        </td>
                        <td style={t.estado === 'Completado' ? { textDecoration: 'line-through' } : {}}>{t.nombre}</td>
                        <td className="text-muted small">{t.responsable || '—'}</td>
                        <td className="text-muted small">{t.area_responsable || '—'}</td>
                        <td className="text-muted small" style={{ whiteSpace: 'nowrap' }}>
                          {fmtF(t.fecha_inicio_calc)} → {fmtF(t.fecha_fin_calc)}
                        </td>
                        <td><span className={`badge ${ESTADO_CLS[t.estado] || 'bg-secondary'}`}>{t.estado}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
