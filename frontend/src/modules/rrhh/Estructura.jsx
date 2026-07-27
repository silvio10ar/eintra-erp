import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'

const hoy = () => new Date().toISOString().slice(0, 10)
const fmtF = f => f ? f.slice(0, 10).split('-').reverse().join('/') : '—'

function NodoOrganigrama({ puesto, hijos, porPadre }) {
  const propios = hijos[puesto.id] || []
  return (
    <div className="d-flex flex-column align-items-center">
      <div className="card border-primary-subtle shadow-sm mb-2" style={{ minWidth: 190, maxWidth: 220 }}>
        <div className="card-body py-2 px-3 text-center">
          <div className="fw-semibold small">{puesto.nombre}</div>
          {puesto.area && <div className="text-muted" style={{ fontSize: '0.72rem' }}>{puesto.area}</div>}
        </div>
      </div>
      {propios.length > 0 && (
        <div className="d-flex gap-3 flex-wrap justify-content-center border-top pt-2">
          {propios.map(h => (
            <NodoOrganigrama key={h.id} puesto={h} hijos={hijos} porPadre={porPadre} />
          ))}
        </div>
      )}
    </div>
  )
}

export default function Estructura() {
  const [puestos, setPuestos]   = useState([])
  const [empleados, setEmpleados] = useState([])
  const [sub, setSub]           = useState('organigrama')
  const [loading, setLoading]   = useState(true)

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

  if (loading) return (
    <div className="d-flex align-items-center justify-content-center" style={{ minHeight: '40vh' }}>
      <div className="spinner-border text-secondary" />
    </div>
  )

  // Armar árbol: raíces = puestos sin reporta_a_id (o que apuntan a un id inexistente)
  const idsValidos = new Set(puestos.map(p => p.id))
  const hijos = {}
  puestos.forEach(p => {
    const padre = p.reporta_a_id && idsValidos.has(p.reporta_a_id) ? p.reporta_a_id : null
    if (padre) { hijos[padre] = hijos[padre] || []; hijos[padre].push(p) }
  })
  const raices = puestos.filter(p => !p.reporta_a_id || !idsValidos.has(p.reporta_a_id))

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
        <div className="card border-0 shadow-sm">
          <div className="card-body" style={{ overflowX: 'auto' }}>
            {puestos.length === 0 ? (
              <p className="text-muted text-center py-4 mb-0">No hay puestos definidos. Creá puestos desde Usuarios → Permisos → Gestionar puestos.</p>
            ) : (
              <div className="d-flex gap-4 flex-wrap justify-content-center">
                {raices.map(p => <NodoOrganigrama key={p.id} puesto={p} hijos={hijos} />)}
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
