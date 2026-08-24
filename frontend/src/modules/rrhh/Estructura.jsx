import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react'
import api from '../../api/client'

const hoy = () => new Date().toISOString().slice(0, 10)
const fmtF = f => f ? f.slice(0, 10).split('-').reverse().join('/') : '—'

// Árbol anidado clásico: cada puesto se dibuja con sus propios subordinados
// justo debajo, en su propia rama — ramas de distinta profundidad no tienen
// problema (no fuerza alinear todo por nivel global). La conexión visual la
// dan las líneas de LineasConectoras, medidas por posición real de cada tarjeta.
function NodoOrganigrama({ puesto, hijos, registrarRef }) {
  const propios = hijos[puesto.id] || []
  return (
    <div className="d-flex flex-column align-items-center">
      <div ref={el => registrarRef(puesto.id, el)} className="card border-primary-subtle shadow-sm mb-2"
        style={{ minWidth: 190, maxWidth: 220 }}>
        <div className="card-body py-2 px-3 text-center">
          <div className="fw-semibold small">{puesto.nombre}</div>
          {puesto.area && <div className="text-muted" style={{ fontSize: '0.72rem' }}>{puesto.area}</div>}
        </div>
      </div>
      {propios.length > 0 && (
        <div className="d-flex gap-3" style={{ flexWrap: 'nowrap', paddingTop: 24 }}>
          {propios.map(h => (
            <NodoOrganigrama key={h.id} puesto={h} hijos={hijos} registrarRef={registrarRef} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Líneas conectoras (en escuadra, estilo organigrama clásico) ──────────────
// Puramente presentacional: recibe las líneas ya calculadas. El cálculo vive
// en Estructura (ver más abajo) porque el efecto de un componente PADRE se
// garantiza que corre después de los efectos de TODOS sus hijos (orden
// bottom-up de React) — a diferencia de depender del orden entre hermanos,
// que no es una garantía real y falló específicamente en el build de producción.
function LineasConectoras({ lineas, size }) {
  return (
    <svg width={size.w} height={size.h}
      style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}>
      {lineas.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="#adb5bd" strokeWidth={1.5} />
      ))}
    </svg>
  )
}

export default function Estructura() {
  const [puestos, setPuestos]   = useState([])
  const [empleados, setEmpleados] = useState([])
  const [sub, setSub]           = useState('organigrama')
  const [loading, setLoading]   = useState(true)
  const chartWrapRef = useRef(null)
  const cardRefs      = useRef({})
  const registrarRef  = (id, el) => { cardRefs.current[id] = el }
  const [lineas, setLineas] = useState([])
  const [svgSize, setSvgSize] = useState({ w: 0, h: 0 })

  // Legajo
  const [empSel, setEmpSel]         = useState(null)
  const [historial, setHistorial]   = useState([])
  const [loadingHist, setLoadingHist] = useState(false)
  const [nuevoPuestoId, setNuevoPuestoId] = useState('')
  const [nuevaFechaDesde, setNuevaFechaDesde] = useState(hoy())
  const [guardandoAsig, setGuardandoAsig] = useState(false)

  const cargar = useCallback(() => {
    setLoading(true)
    Promise.all([
      api.get('/rrhh/organigrama'),
      api.get('/rrhh/empleados'),
    ])
      .then(([rp, re]) => { setPuestos(rp.data); setEmpleados(re.data) })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const abrirLegajo = emp => {
    setEmpSel(emp)
    setNuevoPuestoId('')
    setNuevaFechaDesde(hoy())
    setLoadingHist(true)
    api.get(`/rrhh/empleados/${emp.id}/puestos`)
      .then(r => setHistorial(r.data))
      .finally(() => setLoadingHist(false))
  }

  const asignarPuesto = async () => {
    if (!nuevoPuestoId || !nuevaFechaDesde) return
    setGuardandoAsig(true)
    try {
      await api.post(`/rrhh/empleados/${empSel.id}/puestos`, { puesto_id: nuevoPuestoId, fecha_desde: nuevaFechaDesde })
      const r = await api.get(`/rrhh/empleados/${empSel.id}/puestos`)
      setHistorial(r.data)
      setNuevoPuestoId('')
    } catch (err) {
      alert(err.response?.data?.error ?? 'Error al asignar el puesto')
    } finally { setGuardandoAsig(false) }
  }

  const cerrarPuesto = async ep => {
    const fecha_hasta = window.prompt('Fecha hasta (vigente hasta):', hoy())
    if (!fecha_hasta) return
    try {
      await api.put(`/rrhh/empleado-puestos/${ep.id}`, { fecha_hasta })
      const r = await api.get(`/rrhh/empleados/${empSel.id}/puestos`)
      setHistorial(r.data)
    } catch { alert('Error al cerrar el puesto') }
  }

  const eliminarAsignacion = async ep => {
    if (!window.confirm(`¿Eliminar la asignación "${ep.puesto_nombre}"? Es para corregir un error de carga.`)) return
    try {
      await api.delete(`/rrhh/empleado-puestos/${ep.id}`)
      const r = await api.get(`/rrhh/empleados/${empSel.id}/puestos`)
      setHistorial(r.data)
    } catch { alert('Error al eliminar') }
  }

  // Armar árbol: raíces = puestos sin reporta_a_id (o que apuntan a un id inexistente)
  const idsValidos = new Set(puestos.map(p => p.id))
  const hijos = {}
  puestos.forEach(p => {
    const padre = p.reporta_a_id && idsValidos.has(p.reporta_a_id) ? p.reporta_a_id : null
    if (padre) { hijos[padre] = hijos[padre] || []; hijos[padre].push(p) }
  })
  const raices = puestos.filter(p => !p.reporta_a_id || !idsValidos.has(p.reporta_a_id))
  const relaciones = puestos
    .filter(p => p.reporta_a_id && idsValidos.has(p.reporta_a_id))
    .map(p => ({ hijoId: p.id, padreId: p.reporta_a_id }))

  // El efecto de un componente padre corre garantizado después de los efectos
  // de TODOS sus hijos (orden bottom-up de React) — a diferencia de depender
  // del orden entre hermanos, que resultó no ser confiable en el build de
  // producción. Por eso el cálculo de las líneas vive acá, no en un componente
  // hijo separado.
  useLayoutEffect(() => {
    const recalcular = () => {
      const wrap = chartWrapRef.current
      if (!wrap) return
      const wrapRect = wrap.getBoundingClientRect()
      const nuevas = []
      relaciones.forEach(({ hijoId, padreId }) => {
        const hijoEl  = cardRefs.current[hijoId]
        const padreEl = cardRefs.current[padreId]
        if (!hijoEl || !padreEl) return
        const hr = hijoEl.getBoundingClientRect()
        const pr = padreEl.getBoundingClientRect()
        const x1 = pr.left + pr.width / 2 - wrapRect.left
        const y1 = pr.bottom - wrapRect.top
        const x2 = hr.left + hr.width / 2 - wrapRect.left
        const y2 = hr.top - wrapRect.top
        const midY = y1 + (y2 - y1) / 2
        nuevas.push(`M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`)
      })
      setLineas(nuevas)
      setSvgSize({ w: wrap.scrollWidth, h: wrap.scrollHeight })
    }
    recalcular()
    window.addEventListener('resize', recalcular)
    return () => window.removeEventListener('resize', recalcular)
  }, [puestos, sub])

  if (loading) return (
    <div className="d-flex align-items-center justify-content-center" style={{ minHeight: '40vh' }}>
      <div className="spinner-border text-secondary" />
    </div>
  )

  return (
    <div>
      <ul className="nav nav-pills mb-3">
        <li className="nav-item">
          <button className={`nav-link ${sub==='organigrama'?'active':''}`} onClick={() => setSub('organigrama')}>
            <i className="bi bi-diagram-3 me-1"/>Organigrama
          </button>
        </li>
        <li className="nav-item">
          <button className={`nav-link ${sub==='legajo'?'active':''}`} onClick={() => setSub('legajo')}>
            <i className="bi bi-folder2-open me-1"/>Legajo de personal
          </button>
        </li>
      </ul>

      {sub === 'organigrama' && (
        <div className="card border-0 shadow-sm" style={{ minWidth: 0, maxWidth: '100%' }}>
          <div className="card-body" style={{ overflowX: 'auto', minWidth: 0, maxWidth: '100%' }}>
            {puestos.length === 0 ? (
              <p className="text-muted text-center py-4 mb-0">No hay puestos definidos. Creá puestos desde Usuarios → Permisos → Gestionar puestos.</p>
            ) : (
              <div ref={chartWrapRef} className="d-flex gap-4 align-items-start"
                style={{ width: 'max-content', margin: '0 auto', position: 'relative', flexWrap: 'nowrap' }}>
                {raices.map(p => (
                  <NodoOrganigrama key={p.id} puesto={p} hijos={hijos} registrarRef={registrarRef} />
                ))}
                <LineasConectoras lineas={lineas} size={svgSize} />
              </div>
            )}
            <div className="form-text mt-3">
              El organigrama se arma automáticamente según "Reporta a" de cada puesto (configurable en Usuarios → Permisos → Gestionar puestos).
            </div>
          </div>
        </div>
      )}

      {sub === 'legajo' && (
        <div className="row g-3">
          <div className="col-md-5">
            <div className="card border-0 shadow-sm">
              <div className="table-responsive">
                <table className="table table-hover table-sm mb-0">
                  <thead className="table-light">
                    <tr><th>Empleado</th><th>DNI</th><th>Ingreso</th></tr>
                  </thead>
                  <tbody>
                    {empleados.map(e => (
                      <tr key={e.id} className={empSel?.id===e.id?'table-active':''} style={{ cursor:'pointer' }}
                        onClick={() => abrirLegajo(e)}>
                        <td>{e.nombre}</td>
                        <td className="text-muted small">{e.dni || '—'}</td>
                        <td className="text-muted small">{fmtF(e.fecha_ingreso)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="col-md-7">
            {!empSel ? (
              <div className="text-muted text-center py-5">Seleccioná un empleado para ver su historial de puestos.</div>
            ) : (
              <div className="card border-0 shadow-sm">
                <div className="card-body">
                  <h6 className="fw-bold mb-3">{empSel.nombre}</h6>
                  <div className="d-flex gap-2 mb-3 align-items-end">
                    <div className="flex-grow-1">
                      <label className="form-label small fw-medium mb-1">Asignar puesto</label>
                      <select className="form-select form-select-sm" value={nuevoPuestoId} onChange={e => setNuevoPuestoId(e.target.value)}>
                        <option value="">— Seleccionar puesto —</option>
                        {puestos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="form-label small fw-medium mb-1">Desde</label>
                      <input type="date" className="form-control form-control-sm" value={nuevaFechaDesde}
                        onChange={e => setNuevaFechaDesde(e.target.value)} />
                    </div>
                    <button className="btn btn-primary btn-sm" disabled={!nuevoPuestoId || guardandoAsig} onClick={asignarPuesto}>
                      Asignar
                    </button>
                  </div>
                  <div className="form-text mb-2">Un empleado puede tener uno o más puestos vigentes a la vez.</div>
                  {loadingHist ? (
                    <div className="text-center py-3"><span className="spinner-border spinner-border-sm"/></div>
                  ) : historial.length === 0 ? (
                    <p className="text-muted small">Sin puestos asignados todavía.</p>
                  ) : (
                    <table className="table table-sm align-middle">
                      <thead className="table-light">
                        <tr><th>Puesto</th><th>Desde</th><th>Hasta</th><th className="text-end">Acciones</th></tr>
                      </thead>
                      <tbody>
                        {historial.map(ep => (
                          <tr key={ep.id} className={!ep.fecha_hasta ? '' : 'text-muted'}>
                            <td>{ep.puesto_nombre}</td>
                            <td>{fmtF(ep.fecha_desde)}</td>
                            <td>{ep.fecha_hasta ? fmtF(ep.fecha_hasta) : <span className="badge bg-success">vigente</span>}</td>
                            <td className="text-end">
                              {!ep.fecha_hasta && (
                                <button className="btn btn-xs btn-outline-secondary py-0 px-2 me-1" style={{fontSize:'0.75rem'}}
                                  onClick={() => cerrarPuesto(ep)}>Cerrar</button>
                              )}
                              <button className="btn btn-xs btn-outline-danger py-0 px-2" style={{fontSize:'0.75rem'}}
                                onClick={() => eliminarAsignacion(ep)}>Eliminar</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
