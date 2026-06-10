import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'

const ANOS  = Array.from({ length: 9 }, (_, i) => 2020 + i)
const MESES = [
  { v: '', l: 'Todos los meses' },
  { v: '01', l: 'Enero'      }, { v: '02', l: 'Febrero'   }, { v: '03', l: 'Marzo'      },
  { v: '04', l: 'Abril'      }, { v: '05', l: 'Mayo'       }, { v: '06', l: 'Junio'      },
  { v: '07', l: 'Julio'      }, { v: '08', l: 'Agosto'     }, { v: '09', l: 'Septiembre' },
  { v: '10', l: 'Octubre'    }, { v: '11', l: 'Noviembre'  }, { v: '12', l: 'Diciembre'  },
]

function fmtH(h) {
  if (!h && h !== 0) return '—'
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60)
  return mm > 0 ? `${hh}h ${mm}m` : `${hh}h`
}
function fmtF(f) {
  if (!f) return '—'
  const [y, m, d] = f.split('-')
  return `${d}/${m}/${y}`
}

export default function RRHH() {
  const [tab,       setTab]       = useState('dashboard')
  const [dash,      setDash]      = useState(null)
  const [registros, setRegistros] = useState([])
  const [empleados, setEmpleados] = useState([])
  const [proyectos, setProyectos] = useState([])
  const [categorias,setCategorias]= useState([])
  const [loading,   setLoading]   = useState(false)
  const [saving,    setSaving]    = useState(false)

  // filtros período
  const [year,  setYear]  = useState(new Date().getFullYear())
  const [month, setMonth] = useState('')
  const [fEmp,  setFEmp]  = useState('')
  const [fProy, setFProy] = useState('')

  // modales — el objeto ES el form
  const [modalReg,   setModalReg]   = useState(null)
  const [modalEmp,   setModalEmp]   = useState(null)
  const [modalProy,  setModalProy]  = useState(null)
  const [modalDisp,  setModalDisp]  = useState(null)
  const [verInactivos, setVerInactivos] = useState(false)

  // asistencia
  const [asistencia,   setAsistencia]   = useState([])
  const [dispositivos, setDispositivos] = useState([])
  const [syncDesde,    setSyncDesde]    = useState(new Date().toISOString().split('T')[0])
  const [syncHasta,    setSyncHasta]    = useState(new Date().toISOString().split('T')[0])
  const [syncLoading,  setSyncLoading]  = useState(false)
  const [syncResult,   setSyncResult]   = useState(null)
  const [fAsistFecha,  setFAsistFecha]  = useState(new Date().toISOString().split('T')[0])
  const [fAsistEmp,    setFAsistEmp]    = useState('')
  const [empDispositivo, setEmpDispositivo] = useState([])

  // ── datos maestros ─────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      api.get('/rrhh/categorias'),
      api.get('/rrhh/empleados'),
      api.get('/rrhh/proyectos'),
      api.get('/rrhh/dispositivos'),
      api.get('/rrhh/asistencia/empleados-dispositivo'),
    ]).then(([c, e, p, d, ed]) => {
      setCategorias(c.data)
      setEmpleados(e.data)
      setProyectos(p.data)
      setDispositivos(d.data)
      setEmpDispositivo(ed.data)
    }).catch(() => {})
  }, [])

  const [verLecturas, setVerLecturas] = useState(false)

  const cargarAsistencia = useCallback(() => {
    const q = new URLSearchParams({
      desde: fAsistFecha,
      hasta: fAsistFecha,
      ...(fAsistEmp && { empleado_id: fAsistEmp }),
    }).toString()
    const endpoint = verLecturas ? `/rrhh/asistencia?${q}` : `/rrhh/asistencia/resumen?${q}`
    api.get(endpoint).then(r => setAsistencia(r.data)).catch(() => {})
  }, [fAsistFecha, fAsistEmp, verLecturas])

  // ── dashboard ──────────────────────────────────────────────────────────────
  const cargarDash = useCallback(() => {
    setLoading(true)
    const q = new URLSearchParams({ year, ...(month && { month }) }).toString()
    api.get(`/rrhh/dashboard?${q}`)
      .then(r => setDash(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [year, month])

  // ── registros ──────────────────────────────────────────────────────────────
  const cargarReg = useCallback(() => {
    setLoading(true)
    const q = new URLSearchParams({
      year,
      ...(month && { month }),
      ...(fEmp  && { empleado_id: fEmp  }),
      ...(fProy && { proyecto_id: fProy }),
    }).toString()
    api.get(`/rrhh/registros?${q}`)
      .then(r => setRegistros(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [year, month, fEmp, fProy])

  useEffect(() => { if (tab === 'dashboard')   cargarDash()      }, [tab, cargarDash])
  useEffect(() => { if (tab === 'registros')   cargarReg()       }, [tab, cargarReg])
  useEffect(() => { if (tab === 'asistencia')  cargarAsistencia() }, [tab, cargarAsistencia])

  const reloadEmpleados = () => api.get('/rrhh/empleados').then(r => setEmpleados(r.data))
  const reloadProyectos = () => api.get('/rrhh/proyectos').then(r => setProyectos(r.data))

  // ── acciones dispositivo ──────────────────────────────────────────────────
  function guardarDispositivo() {
    const m = modalDisp
    if (!m.ip?.trim()) { alert('La IP es obligatoria'); return }
    setSaving(true)
    const req = m.id ? api.put(`/rrhh/dispositivos/${m.id}`, m) : api.post('/rrhh/dispositivos', m)
    req.then(() => {
      setModalDisp(null)
      api.get('/rrhh/dispositivos').then(r => setDispositivos(r.data))
    }).catch(e => alert(e.response?.data?.error || 'Error al guardar'))
      .finally(() => setSaving(false))
  }

  function testDispositivo() {
    const m = modalDisp
    if (!m.id) { alert('Guardá el dispositivo primero'); return }
    api.post(`/rrhh/dispositivos/${m.id}/test`)
      .then(r => alert(`Conexión exitosa\nDispositivo: ${r.data.nombre || 'OK'}`))
      .catch(e => alert(`Error: ${e.response?.data?.error || e.message}`))
  }

  function cargarEmpDispositivo() {
    api.get('/rrhh/asistencia/empleados-dispositivo').then(r => setEmpDispositivo(r.data)).catch(() => {})
  }

  function sincronizar() {
    const disp = dispositivos[0]
    if (!disp) { alert('Configurá el dispositivo primero'); return }
    setSyncLoading(true)
    setSyncResult(null)
    api.post(`/rrhh/dispositivos/${disp.id}/sync`, { desde: syncDesde, hasta: syncHasta })
      .then(r => {
        setSyncResult(r.data)
        api.get('/rrhh/dispositivos').then(d => setDispositivos(d.data))
        cargarAsistencia()
        cargarEmpDispositivo()
      })
      .catch(e => {
        const msg = e.response?.data?.error || e.response?.data || e.message || 'Error al sincronizar'
        alert('Error al sincronizar:\n' + (typeof msg === 'object' ? JSON.stringify(msg) : msg))
      })
      .finally(() => setSyncLoading(false))
  }

  // ── acciones ───────────────────────────────────────────────────────────────
  function guardarRegistro() {
    const m = modalReg
    if (!m.fecha || !m.empleado_id || !m.horas) {
      alert('Fecha, empleado y horas son obligatorios')
      return
    }
    setSaving(true)
    const req = m.id ? api.put(`/rrhh/registros/${m.id}`, m) : api.post('/rrhh/registros', m)
    req.then(() => {
      setModalReg(null)
      cargarReg()
      if (tab === 'dashboard') cargarDash()
    }).catch(e => alert(e.response?.data?.error || 'Error al guardar'))
      .finally(() => setSaving(false))
  }

  function eliminarRegistro(id) {
    if (!confirm('¿Eliminar este registro?')) return
    api.delete(`/rrhh/registros/${id}`).then(() => cargarReg()).catch(() => alert('Error al eliminar'))
  }

  function eliminarEmpleado(emp) {
    const msg = `¿Eliminar a ${emp.nombre}?` +
      (emp.total_registros > 0
        ? `\n\nTiene ${emp.total_registros} registros de horas. Se ocultará de la lista pero se conservarán los datos históricos.`
        : '\n\nNo tiene registros. Se eliminará definitivamente.')
    if (!confirm(msg)) return
    api.delete(`/rrhh/empleados/${emp.id}`)
      .then(r => {
        if (r.data.accion === 'desactivado') {
          alert(`${emp.nombre} fue ocultado de la lista. Sus ${r.data.registros} registros de horas se conservan.`)
        }
        reloadEmpleados()
      })
      .catch(() => alert('Error al eliminar'))
  }

  function guardarEmpleado() {
    const m = modalEmp
    if (!m.nombre?.trim()) { alert('El nombre es obligatorio'); return }
    setSaving(true)
    const req = m.id ? api.put(`/rrhh/empleados/${m.id}`, m) : api.post('/rrhh/empleados', m)
    req.then(() => { setModalEmp(null); reloadEmpleados() })
       .catch(e => alert(e.response?.data?.error || 'Error al guardar'))
       .finally(() => setSaving(false))
  }

  function guardarProyecto() {
    const m = modalProy
    if (!m.nombre?.trim()) { alert('El nombre es obligatorio'); return }
    setSaving(true)
    const req = m.id ? api.put(`/rrhh/proyectos/${m.id}`, m) : api.post('/rrhh/proyectos', m)
    req.then(() => { setModalProy(null); reloadProyectos() })
       .catch(e => alert(e.response?.data?.error || 'Error al guardar'))
       .finally(() => setSaving(false))
  }

  function calcHoras(inicio, fin) {
    if (!inicio || !fin) return null
    try {
      const [hI, mI] = inicio.split(':').map(Number)
      const [hF, mF] = fin.split(':').map(Number)
      const mins = hF * 60 + mF - (hI * 60 + mI)
      return mins > 0 ? +(mins / 60).toFixed(2) : null
    } catch { return null }
  }

  // ── tabs ───────────────────────────────────────────────────────────────────
  function TabDashboard() {
    if (!dash) return <div className="text-center text-muted py-5">{loading ? 'Cargando...' : 'Sin datos'}</div>

    const total   = dash.totalHoras || 0
    const interno = dash.porTipo?.find(t => t.tipo === 'interno')?.horas    || 0
    const contra  = dash.porTipo?.find(t => t.tipo === 'contratista')?.horas || 0
    const pctI    = total > 0 ? Math.round(interno / total * 100) : 0
    const nomMes  = month ? (MESES.find(m => m.v === month)?.l + ' ') : ''

    return (
      <div>
        {/* KPIs */}
        <div className="row g-3 mb-4">
          <div className="col-6 col-md-3">
            <div className="card text-center h-100 border-primary">
              <div className="card-body">
                <div className="fs-2 fw-bold text-primary">{fmtH(total)}</div>
                <div className="text-muted small">Total horas · {nomMes}{year}</div>
              </div>
            </div>
          </div>
          <div className="col-6 col-md-3">
            <div className="card text-center h-100 border-success">
              <div className="card-body">
                <div className="fs-2 fw-bold text-success">{fmtH(interno)}</div>
                <div className="text-muted small">E-INTRA · {pctI}%</div>
              </div>
            </div>
          </div>
          <div className="col-6 col-md-3">
            <div className="card text-center h-100 border-warning">
              <div className="card-body">
                <div className="fs-2 fw-bold text-warning">{fmtH(contra)}</div>
                <div className="text-muted small">Contratistas · {100-pctI}%</div>
              </div>
            </div>
          </div>
          <div className="col-6 col-md-3">
            <div className="card text-center h-100">
              <div className="card-body">
                <div className="fs-2 fw-bold text-info">
                  {empleados.filter(e=>e.activo).length} / {proyectos.filter(p=>p.activo).length}
                </div>
                <div className="text-muted small">Empleados / Proyectos activos</div>
              </div>
            </div>
          </div>
        </div>

        <div className="row g-3 mb-3">
          {/* Horas por empleado */}
          <div className="col-md-6">
            <div className="card h-100">
              <div className="card-header fw-semibold">
                Horas por empleado &nbsp;<small className="text-muted fw-normal">{nomMes}{year}</small>
              </div>
              <div className="card-body p-0" style={{ maxHeight: 380, overflowY: 'auto' }}>
                <table className="table table-sm table-hover mb-0">
                  <thead className="table-light sticky-top">
                    <tr><th>Empleado</th><th>Tipo</th><th className="text-end">Horas</th></tr>
                  </thead>
                  <tbody>
                    {(dash.porEmpleado||[]).filter(e=>e.horas>0).map(e=>(
                      <tr key={e.id}>
                        <td>{e.nombre}</td>
                        <td><span className={`badge bg-${e.tipo==='interno'?'primary':'secondary'}`}>
                          {e.tipo==='interno'?'E-INTRA':'C'}
                        </span></td>
                        <td className="text-end fw-semibold">{fmtH(e.horas)}</td>
                      </tr>
                    ))}
                    {(dash.porEmpleado||[]).filter(e=>e.horas>0).length===0 && (
                      <tr><td colSpan={3} className="text-center text-muted py-3">Sin datos</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Horas por proyecto */}
          <div className="col-md-6">
            <div className="card h-100">
              <div className="card-header fw-semibold">
                Top proyectos &nbsp;<small className="text-muted fw-normal">{nomMes}{year}</small>
              </div>
              <div className="card-body p-0" style={{ maxHeight: 380, overflowY: 'auto' }}>
                <table className="table table-sm table-hover mb-0">
                  <thead className="table-light sticky-top">
                    <tr><th>Proyecto</th><th className="text-end">Horas</th></tr>
                  </thead>
                  <tbody>
                    {(dash.porProyecto||[]).filter(p=>p.horas>0).map(p=>(
                      <tr key={p.id}><td>{p.nombre}</td><td className="text-end fw-semibold">{fmtH(p.horas)}</td></tr>
                    ))}
                    {(dash.porProyecto||[]).filter(p=>p.horas>0).length===0 && (
                      <tr><td colSpan={2} className="text-center text-muted py-3">Sin datos</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* Horas por grupo de actividad */}
        <div className="card">
          <div className="card-header fw-semibold">Distribución por grupo de actividad</div>
          <div className="card-body p-0">
            <table className="table table-sm mb-0">
              <thead className="table-light">
                <tr><th>Grupo</th><th className="text-end">Horas</th><th style={{width:'35%'}}>Distribución</th></tr>
              </thead>
              <tbody>
                {(dash.porCategoria||[]).filter(c=>c.horas>0).map(c => {
                  const pct = total > 0 ? Math.round(c.horas / total * 100) : 0
                  return (
                    <tr key={c.grupo}>
                      <td>{c.grupo || '—'}</td>
                      <td className="text-end fw-semibold">{fmtH(c.horas)}</td>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <div className="flex-grow-1 rounded" style={{ height:8, background:'#e9ecef' }}>
                            <div className="rounded bg-primary" style={{ width:`${pct}%`, height:8 }} />
                          </div>
                          <small className="text-muted" style={{minWidth:32}}>{pct}%</small>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {(dash.porCategoria||[]).filter(c=>c.horas>0).length===0 && (
                  <tr><td colSpan={3} className="text-center text-muted py-3">Sin datos</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }

  function TabRegistros() {
    const totalH = registros.reduce((s,r) => s + (r.horas||0), 0)
    return (
      <div>
        <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
          <div className="d-flex gap-2 flex-wrap align-items-center">
            <select className="form-select form-select-sm" style={{width:170}} value={fEmp} onChange={e=>setFEmp(e.target.value)}>
              <option value="">Todos los empleados</option>
              <optgroup label="E-INTRA">
                {empleados.filter(e=>e.activo&&e.tipo==='interno').map(e=><option key={e.id} value={e.id}>{e.nombre}</option>)}
              </optgroup>
              <optgroup label="Contratistas">
                {empleados.filter(e=>e.activo&&e.tipo==='contratista').map(e=><option key={e.id} value={e.id}>{e.nombre}</option>)}
              </optgroup>
            </select>
            <select className="form-select form-select-sm" style={{width:180}} value={fProy} onChange={e=>setFProy(e.target.value)}>
              <option value="">Todos los proyectos</option>
              {proyectos.filter(p=>p.activo).map(p=><option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
            <span className="badge bg-secondary align-self-center">
              {registros.length} registros · {fmtH(totalH)}
            </span>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setModalReg({
            fecha: new Date().toISOString().split('T')[0],
            empleado_id:'', proyecto_id:'', categoria_id:'',
            hora_inicio:'', hora_fin:'', horas:'', modulo:'', descripcion:''
          })}>
            <i className="bi bi-plus-lg me-1"/>Nuevo registro
          </button>
        </div>

        <div className="table-responsive">
          <table className="table table-sm table-hover">
            <thead className="table-dark">
              <tr>
                <th>Fecha</th><th>Empleado</th><th>T</th><th>Proyecto</th>
                <th>Cat</th><th>Inicio</th><th>Fin</th>
                <th className="text-end">Horas</th><th>Módulo</th>
                <th style={{minWidth:160}}>Descripción</th><th></th>
              </tr>
            </thead>
            <tbody>
              {registros.map(r => (
                <tr key={r.id}>
                  <td className="text-nowrap">{fmtF(r.fecha)}</td>
                  <td>{r.empleado_nombre}</td>
                  <td>
                    <span className={`badge bg-${r.empleado_tipo==='interno'?'primary':'secondary'}`}>
                      {r.empleado_tipo==='interno'?'E':'C'}
                    </span>
                  </td>
                  <td style={{maxWidth:140}} className="text-truncate">{r.proyecto_nombre||'—'}</td>
                  <td>
                    {r.cat_codigo
                      ? <span className="badge bg-light text-dark border" title={r.cat_descripcion}>{r.cat_codigo}</span>
                      : '—'}
                  </td>
                  <td>{r.hora_inicio||'—'}</td>
                  <td>{r.hora_fin||'—'}</td>
                  <td className="text-end fw-semibold text-nowrap">{fmtH(r.horas)}</td>
                  <td>{r.modulo||'—'}</td>
                  <td style={{maxWidth:160}} className="text-truncate" title={r.descripcion}>{r.descripcion||'—'}</td>
                  <td className="text-nowrap">
                    <button className="btn btn-sm btn-outline-secondary py-0 me-1" onClick={() => setModalReg({...r})}>
                      <i className="bi bi-pencil"/>
                    </button>
                    <button className="btn btn-sm btn-outline-danger py-0" onClick={() => eliminarRegistro(r.id)}>
                      <i className="bi bi-trash"/>
                    </button>
                  </td>
                </tr>
              ))}
              {registros.length===0 && (
                <tr><td colSpan={11} className="text-center text-muted py-4">Sin registros para el período seleccionado</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  function TabEmpleados() {
    const lista      = empleados.filter(e => verInactivos ? true : e.activo)
    const internos   = lista.filter(e => e.tipo === 'interno')
    const contratistas = lista.filter(e => e.tipo === 'contratista')
    const nInactivos = empleados.filter(e => !e.activo).length

    function FilaEmp({ e }) {
      return (
        <tr className={!e.activo ? 'table-secondary text-muted' : ''}>
          <td>
            {e.nombre}
            {!e.activo && <span className="badge bg-secondary ms-2" style={{fontSize:'0.65rem'}}>inactivo</span>}
          </td>
          <td>{e.empresa||'—'}</td>
          <td className="text-end">{fmtH(e.horas_anio)}</td>
          <td className="text-end text-muted small">{e.total_registros||0}</td>
          <td className="text-nowrap">
            <button className="btn btn-sm btn-outline-secondary py-0 me-1"
              onClick={() => setModalEmp({ ...e })}>
              <i className="bi bi-pencil"/>
            </button>
            <button className="btn btn-sm btn-outline-danger py-0"
              onClick={() => eliminarEmpleado(e)}
              title={e.activo ? (e.total_registros > 0 ? 'Ocultar de la lista (conserva historial)' : 'Eliminar definitivamente') : 'Reactivar en edición'}>
              <i className={`bi bi-${e.activo ? 'trash' : 'eye-slash'}`}/>
            </button>
          </td>
        </tr>
      )
    }

    function PanelEmpleados({ titulo, color, lista }) {
      return (
        <div className="card">
          <div className="card-header fw-semibold text-white" style={{background: color}}>
            {titulo}
            <span className="badge bg-white text-dark ms-2" style={{fontSize:'0.75rem'}}>{lista.length}</span>
          </div>
          <div className="card-body p-0" style={{maxHeight:420, overflowY:'auto'}}>
            <table className="table table-sm table-hover mb-0">
              <thead className="table-light sticky-top">
                <tr>
                  <th>Nombre</th><th>Empresa</th>
                  <th className="text-end">Horas {year}</th>
                  <th className="text-end">Registros</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lista.map(e => <FilaEmp key={e.id} e={e}/>)}
                {lista.length===0 && <tr><td colSpan={5} className="text-center text-muted py-3">Sin empleados</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )
    }

    return (
      <div>
        <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
          <div className="d-flex gap-2 align-items-center">
            <span className="badge bg-primary">{internos.filter(e=>e.activo).length} E-INTRA activos</span>
            <span className="badge bg-secondary">{contratistas.filter(e=>e.activo).length} Contratistas activos</span>
            {nInactivos > 0 && (
              <button className={`btn btn-sm ${verInactivos ? 'btn-warning' : 'btn-outline-secondary'}`}
                onClick={() => setVerInactivos(v => !v)}>
                <i className={`bi bi-eye${verInactivos?'-slash':''} me-1`}/>
                {verInactivos ? 'Ocultar inactivos' : `Ver inactivos (${nInactivos})`}
              </button>
            )}
          </div>
          <button className="btn btn-primary btn-sm"
            onClick={() => setModalEmp({ nombre:'', tipo:'interno', empresa:'', activo:1 })}>
            <i className="bi bi-plus-lg me-1"/>Nuevo empleado
          </button>
        </div>

        <div className="row g-3">
          <div className="col-lg-6">
            <PanelEmpleados titulo="Personal E-INTRA" color="#0d6efd" lista={internos}/>
          </div>
          <div className="col-lg-6">
            <PanelEmpleados titulo="Contratistas" color="#6c757d" lista={contratistas}/>
          </div>
        </div>

        {/* Panel fichador */}
        <div className="card mt-3">
          <div className="card-header fw-semibold d-flex align-items-center gap-2"
               style={{background:'#198754', color:'#fff'}}>
            <i className="bi bi-person-badge"/>
            Empleados detectados en el fichador
            <span className="badge bg-white text-dark ms-1">{empDispositivo.length}</span>
            <button className="btn btn-sm btn-outline-light ms-auto py-0"
              onClick={cargarEmpDispositivo} title="Actualizar">
              <i className="bi bi-arrow-repeat"/>
            </button>
          </div>
          {empDispositivo.length === 0 ? (
            <div className="card-body text-muted text-center py-4">
              <i className="bi bi-person-x d-block fs-3 mb-2 opacity-25"/>
              Sin datos del fichador — sincronizá desde la pestaña Asistencia
            </div>
          ) : (
            <div className="card-body p-0" style={{maxHeight:340, overflowY:'auto'}}>
              <table className="table table-sm table-hover mb-0">
                <thead className="table-light sticky-top">
                  <tr>
                    <th>ID fichador</th>
                    <th>Nombre en el dispositivo</th>
                    <th className="text-center">Días</th>
                    <th className="text-center">Lecturas</th>
                    <th style={{minWidth:220}}>Vincular a empleado ERP</th>
                  </tr>
                </thead>
                <tbody>
                  {empDispositivo.map(ed => (
                    <tr key={ed.empleado_ext}>
                      <td><code>{ed.empleado_ext}</code></td>
                      <td>{ed.nombre_dispositivo || '—'}</td>
                      <td className="text-center">{ed.dias}</td>
                      <td className="text-center">{ed.lecturas}</td>
                      <td>
                        <select
                          className="form-select form-select-sm"
                          value={ed.empleado_id || ''}
                          onChange={ev => {
                            const emp_id = ev.target.value ? Number(ev.target.value) : null
                            api.post('/rrhh/asistencia/vincular', { emp_id, empleado_ext: ed.empleado_ext })
                              .then(() => {
                                cargarEmpDispositivo()
                                api.get('/rrhh/empleados').then(r => setEmpleados(r.data))
                              })
                              .catch(e => alert(e.response?.data?.error || 'Error al vincular'))
                          }}
                        >
                          <option value="">— sin vincular —</option>
                          {empleados.filter(e => e.activo).map(e => (
                            <option key={e.id} value={e.id}>{e.nombre}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    )
  }

  function TabProyectos() {
    return (
      <div>
        <div className="d-flex justify-content-between align-items-center mb-3">
          <div className="d-flex gap-2">
            <span className="badge bg-success">{proyectos.filter(p=>p.activo).length} activos</span>
            <span className="badge bg-secondary">{proyectos.filter(p=>!p.activo).length} inactivos</span>
          </div>
          <button className="btn btn-primary btn-sm"
            onClick={() => setModalProy({ nombre:'', activo:1 })}>
            <i className="bi bi-plus-lg me-1"/>Nuevo proyecto
          </button>
        </div>

        <div className="table-responsive">
          <table className="table table-sm table-hover">
            <thead className="table-dark">
              <tr><th>Proyecto</th><th className="text-end">Total horas</th><th>Estado</th><th></th></tr>
            </thead>
            <tbody>
              {proyectos.map(p => (
                <tr key={p.id}>
                  <td>{p.nombre}</td>
                  <td className="text-end fw-semibold">{fmtH(p.total_horas)}</td>
                  <td>
                    <span className={`badge bg-${p.activo?'success':'secondary'}`}>
                      {p.activo?'Activo':'Inactivo'}
                    </span>
                  </td>
                  <td>
                    <button className="btn btn-sm btn-outline-secondary py-0"
                      onClick={() => setModalProy({...p})}>
                      <i className="bi bi-pencil"/>
                    </button>
                  </td>
                </tr>
              ))}
              {proyectos.length===0 && (
                <tr><td colSpan={4} className="text-center text-muted py-4">Sin proyectos</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // ── tab asistencia ────────────────────────────────────────────────────────
  function TabAsistencia() {
    const disp = dispositivos[0]

    const TIPO_BADGE = {
      'Facial':         'primary',
      'Tarjeta':        'secondary',
      'Tarjeta+PIN':    'info',
      'Facial+Tarjeta': 'success',
    }

    return (
      <div>
        {/* Dispositivo + estado */}
        <div className="card mb-3">
          <div className="card-body py-2">
            <div className="d-flex gap-3 align-items-center flex-wrap">
              <div className="d-flex align-items-center gap-2">
                <i className="bi bi-hdd-network text-primary fs-5"/>
                {disp ? (
                  <>
                    <div>
                      <span className="fw-semibold">{disp.nombre}</span>
                      <span className="text-muted ms-2 small">{disp.modelo} · {disp.ip}:{disp.puerto}</span>
                    </div>
                    <span className="badge bg-success">Configurado</span>
                    {disp.ultima_sync && (
                      <span className="text-muted small">Última sync: {disp.ultima_sync.substring(0,16)}</span>
                    )}
                  </>
                ) : (
                  <span className="text-muted">Sin dispositivo configurado</span>
                )}
              </div>
              <button className="btn btn-sm btn-outline-secondary ms-auto"
                onClick={() => setModalDisp(disp || {
                  nombre:'Terminal entrada', modelo:'DS-K1T320MFWX',
                  ip:'', puerto:80, usuario:'admin', password:'', activo:1
                })}>
                <i className="bi bi-gear me-1"/>Configurar dispositivo
              </button>
            </div>
          </div>
        </div>

        {/* Sincronizar */}
        <div className="card mb-3">
          <div className="card-body py-2">
            <div className="d-flex gap-2 align-items-center flex-wrap">
              <span className="text-muted small fw-semibold">Sincronizar registros:</span>
              <input type="date" className="form-control form-control-sm" style={{width:145}}
                value={syncDesde} onChange={e => setSyncDesde(e.target.value)}/>
              <span className="text-muted small">al</span>
              <input type="date" className="form-control form-control-sm" style={{width:145}}
                value={syncHasta} onChange={e => setSyncHasta(e.target.value)}/>
              <button className="btn btn-sm btn-success" disabled={syncLoading || !disp}
                onClick={sincronizar}>
                {syncLoading
                  ? <><span className="spinner-border spinner-border-sm me-1"/>Sincronizando...</>
                  : <><i className="bi bi-arrow-repeat me-1"/>Sincronizar</>}
              </button>
              {syncResult && (
                <span className="badge bg-info text-dark">
                  {syncResult.insertados} nuevos · {syncResult.duplicados} ya existían
                  {syncResult.totalDisp > 0 && ` · ${syncResult.totalDisp} en dispositivo`}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Filtros */}
        <div className="d-flex gap-2 align-items-center mb-3 flex-wrap">
          <span className="text-muted small">Ver día:</span>
          <input type="date" className="form-control form-control-sm" style={{width:145}}
            value={fAsistFecha} onChange={e => setFAsistFecha(e.target.value)}/>
          <select className="form-select form-select-sm" style={{width:200}}
            value={fAsistEmp} onChange={e => setFAsistEmp(e.target.value)}>
            <option value="">Todos los empleados</option>
            {empleados.filter(e => e.activo).map(e => (
              <option key={e.id} value={e.id}>{e.nombre}</option>
            ))}
          </select>
          <span className="badge bg-secondary">{asistencia.length} {verLecturas ? 'lecturas' : 'empleados'}</span>
          <button className={`btn btn-sm ms-auto ${verLecturas ? 'btn-warning' : 'btn-outline-secondary'}`}
            onClick={() => setVerLecturas(v => !v)}>
            <i className={`bi bi-${verLecturas ? 'grid-3x3' : 'list-ul'} me-1`}/>
            {verLecturas ? 'Ver resumen' : 'Ver lecturas individuales'}
          </button>
        </div>

        {/* Tabla resumen (entrada / salida / horas) */}
        {!verLecturas && (
          <div className="table-responsive">
            <table className="table table-sm table-hover">
              <thead className="table-dark">
                <tr>
                  <th>Empleado</th>
                  <th>Tipo</th>
                  <th className="text-center">Entrada</th>
                  <th className="text-center">Salida</th>
                  <th className="text-center">Horas</th>
                  <th className="text-center" title="Cantidad de lecturas del día">Lecturas</th>
                </tr>
              </thead>
              <tbody>
                {asistencia.map((a, i) => {
                  const soloUna = a.n_lecturas === 1
                  return (
                    <tr key={i}>
                      <td>
                        <span className={a.empleado_id ? 'fw-semibold' : 'text-muted'}>
                          {a.nombre || a.empleado_ext || '—'}
                        </span>
                        {!a.empleado_id && (
                          <span className="badge bg-warning text-dark ms-1" style={{fontSize:'0.65rem'}}>
                            sin vincular
                          </span>
                        )}
                      </td>
                      <td>
                        {a.emp_tipo === 'interno'
                          ? <span className="badge bg-primary">E-INTRA</span>
                          : a.emp_tipo === 'contratista'
                          ? <span className="badge bg-secondary">Contratista</span>
                          : '—'}
                      </td>
                      <td className="text-center">
                        <span className="fw-semibold text-success">{a.entrada || '—'}</span>
                      </td>
                      <td className="text-center">
                        {soloUna
                          ? <span className="text-muted small">sin salida</span>
                          : <span className="fw-semibold text-danger">{a.salida}</span>}
                      </td>
                      <td className="text-center">
                        {a.horas != null
                          ? <span className={`fw-bold ${a.horas < 6 ? 'text-warning' : 'text-dark'}`}>
                              {fmtH(a.horas)}
                            </span>
                          : <span className="text-muted">—</span>}
                      </td>
                      <td className="text-center">
                        <span className="badge bg-light text-muted border">
                          {a.n_lecturas}
                        </span>
                      </td>
                    </tr>
                  )
                })}
                {asistencia.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center text-muted py-5">
                      <i className="bi bi-calendar-x d-block fs-3 mb-2 opacity-25"/>
                      Sin registros para esta fecha
                      {!disp && <div className="mt-1 small">Configurá el dispositivo y sincronizá</div>}
                    </td>
                  </tr>
                )}
              </tbody>
              {asistencia.length > 0 && (
                <tfoot className="table-light">
                  <tr>
                    <td colSpan={4} className="text-end text-muted small fw-semibold">Total horas del día:</td>
                    <td className="text-center fw-bold">
                      {fmtH(asistencia.reduce((s, a) => s + (a.horas || 0), 0))}
                    </td>
                    <td/>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        {/* Tabla lecturas individuales */}
        {verLecturas && (
          <div className="table-responsive">
            <table className="table table-sm table-hover">
              <thead className="table-dark">
                <tr><th>Hora</th><th>Empleado</th><th>Tipo verificación</th><th>Temp.</th></tr>
              </thead>
              <tbody>
                {asistencia.map(a => (
                  <tr key={a.id}>
                    <td className="fw-semibold">{a.hora}</td>
                    <td>
                      <span className={a.empleado_id ? '' : 'text-muted'}>
                        {a.emp_nombre_rrhh || a.empleado_nombre || a.empleado_ext || '—'}
                      </span>
                      {!a.empleado_id && (
                        <span className="badge bg-warning text-dark ms-1" style={{fontSize:'0.65rem'}}>sin vincular</span>
                      )}
                    </td>
                    <td>
                      {a.tipo_acceso
                        ? <span className={`badge bg-${TIPO_BADGE[a.tipo_acceso] || 'light text-dark border'}`}>
                            {a.tipo_acceso === 'Facial' && <i className="bi bi-person-fill me-1"/>}
                            {a.tipo_acceso === 'Tarjeta' && <i className="bi bi-credit-card me-1"/>}
                            {a.tipo_acceso}
                          </span>
                        : '—'}
                    </td>
                    <td>{a.temperatura != null ? `${a.temperatura} °C` : '—'}</td>
                  </tr>
                ))}
                {asistencia.length === 0 && (
                  <tr><td colSpan={4} className="text-center text-muted py-4">Sin lecturas</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  // ── modales ────────────────────────────────────────────────────────────────
  function ModalRegistro() {
    if (!modalReg) return null
    const m   = modalReg
    const upd = (k, v) => setModalReg(x => ({ ...x, [k]: v }))
    const gruposCats = categorias.reduce((acc, c) => {
      if (!acc[c.grupo]) acc[c.grupo] = []
      acc[c.grupo].push(c)
      return acc
    }, {})

    return (
      <div className="modal fade show d-block" style={{ background:'rgba(0,0,0,.5)' }}>
        <div className="modal-dialog modal-lg modal-dialog-scrollable">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">{m.id ? 'Editar registro' : 'Nuevo registro'}</h5>
              <button className="btn-close" onClick={() => setModalReg(null)}/>
            </div>
            <div className="modal-body">
              <div className="row g-3">
                <div className="col-md-4">
                  <label className="form-label fw-semibold">Fecha *</label>
                  <input type="date" className="form-control form-control-sm"
                    value={m.fecha||''} onChange={e => upd('fecha', e.target.value)}/>
                </div>
                <div className="col-md-8">
                  <label className="form-label fw-semibold">Empleado *</label>
                  <select className="form-select form-select-sm"
                    value={m.empleado_id||''} onChange={e => upd('empleado_id', e.target.value)}>
                    <option value="">— seleccionar —</option>
                    <optgroup label="E-INTRA">
                      {empleados.filter(e=>e.activo&&e.tipo==='interno').map(e=>(
                        <option key={e.id} value={e.id}>{e.nombre}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Contratistas">
                      {empleados.filter(e=>e.activo&&e.tipo==='contratista').map(e=>(
                        <option key={e.id} value={e.id}>{e.nombre}</option>
                      ))}
                    </optgroup>
                  </select>
                </div>

                <div className="col-md-6">
                  <label className="form-label fw-semibold">Proyecto</label>
                  <select className="form-select form-select-sm"
                    value={m.proyecto_id||''} onChange={e => upd('proyecto_id', e.target.value)}>
                    <option value="">— sin proyecto —</option>
                    {proyectos.filter(p=>p.activo).map(p=>(
                      <option key={p.id} value={p.id}>{p.nombre}</option>
                    ))}
                  </select>
                </div>
                <div className="col-md-6">
                  <label className="form-label fw-semibold">Categoría</label>
                  <select className="form-select form-select-sm"
                    value={m.categoria_id||''} onChange={e => upd('categoria_id', e.target.value)}>
                    <option value="">— sin categoría —</option>
                    {Object.entries(gruposCats).map(([grupo, cats]) => (
                      <optgroup key={grupo} label={grupo}>
                        {cats.map(c => (
                          <option key={c.id} value={c.id}>{c.codigo} – {c.descripcion}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                <div className="col-md-4">
                  <label className="form-label fw-semibold">Hora inicio</label>
                  <input type="time" className="form-control form-control-sm"
                    value={m.hora_inicio||''} onChange={e => {
                      const v = e.target.value
                      const h = calcHoras(v, m.hora_fin)
                      setModalReg(x => ({ ...x, hora_inicio: v, ...(h !== null && { horas: h }) }))
                    }}/>
                </div>
                <div className="col-md-4">
                  <label className="form-label fw-semibold">Hora fin</label>
                  <input type="time" className="form-control form-control-sm"
                    value={m.hora_fin||''} onChange={e => {
                      const v = e.target.value
                      const h = calcHoras(m.hora_inicio, v)
                      setModalReg(x => ({ ...x, hora_fin: v, ...(h !== null && { horas: h }) }))
                    }}/>
                </div>
                <div className="col-md-4">
                  <label className="form-label fw-semibold">Horas *</label>
                  <input type="number" className="form-control form-control-sm"
                    step="0.01" min="0" max="24"
                    value={m.horas||''} onChange={e => upd('horas', e.target.value)}/>
                </div>

                <div className="col-md-4">
                  <label className="form-label fw-semibold">Módulo</label>
                  <input type="text" className="form-control form-control-sm"
                    value={m.modulo||''} onChange={e => upd('modulo', e.target.value)}/>
                </div>
                <div className="col-md-8">
                  <label className="form-label fw-semibold">Descripción de la tarea</label>
                  <input type="text" className="form-control form-control-sm"
                    value={m.descripcion||''} onChange={e => upd('descripcion', e.target.value)}/>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary btn-sm" onClick={() => setModalReg(null)}>Cancelar</button>
              <button className="btn btn-primary btn-sm" disabled={saving} onClick={guardarRegistro}>
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  function ModalEmpleado() {
    if (!modalEmp) return null
    const m   = modalEmp
    const upd = (k, v) => setModalEmp(x => ({ ...x, [k]: v }))
    return (
      <div className="modal fade show d-block" style={{ background:'rgba(0,0,0,.5)' }}>
        <div className="modal-dialog">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">{m.id ? 'Editar empleado' : 'Nuevo empleado'}</h5>
              <button className="btn-close" onClick={() => setModalEmp(null)}/>
            </div>
            <div className="modal-body">
              <div className="row g-3">
                <div className="col-12">
                  <label className="form-label fw-semibold">Nombre *</label>
                  <input type="text" className="form-control form-control-sm"
                    value={m.nombre||''} onChange={e => upd('nombre', e.target.value)}
                    placeholder="Ej: GARCIA PABLO"/>
                </div>
                <div className="col-md-6">
                  <label className="form-label fw-semibold">Tipo *</label>
                  <select className="form-select form-select-sm"
                    value={m.tipo||'interno'} onChange={e => upd('tipo', e.target.value)}>
                    <option value="interno">E-INTRA (Interno)</option>
                    <option value="contratista">Contratista</option>
                  </select>
                </div>
                <div className="col-md-6">
                  <label className="form-label fw-semibold">Empresa (contratista)</label>
                  <input type="text" className="form-control form-control-sm"
                    value={m.empresa||''} onChange={e => upd('empresa', e.target.value)}/>
                </div>
                {m.id && (
                  <div className="col-md-6">
                    <label className="form-label fw-semibold">Estado</label>
                    <select className="form-select form-select-sm"
                      value={m.activo} onChange={e => upd('activo', Number(e.target.value))}>
                      <option value={1}>Activo</option>
                      <option value={0}>Inactivo</option>
                    </select>
                  </div>
                )}
                <div className={m.id ? 'col-md-6' : 'col-12'}>
                  <label className="form-label fw-semibold">ID en terminal biométrico</label>
                  <input type="text" className="form-control form-control-sm"
                    value={m.id_dispositivo||''} onChange={e => upd('id_dispositivo', e.target.value)}
                    placeholder="Nº de empleado en el dispositivo (ej: 1, 5, 123)"/>
                  <div className="form-text">Para vincular registros de asistencia automáticamente.</div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary btn-sm" onClick={() => setModalEmp(null)}>Cancelar</button>
              <button className="btn btn-primary btn-sm" disabled={saving} onClick={guardarEmpleado}>
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  function ModalDispositivo() {
    if (!modalDisp) return null
    const m   = modalDisp
    const upd = (k, v) => setModalDisp(x => ({ ...x, [k]: v }))
    return (
      <div className="modal fade show d-block" style={{ background:'rgba(0,0,0,.5)' }}>
        <div className="modal-dialog">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">
                <i className="bi bi-hdd-network me-2"/>Configurar terminal de acceso
              </h5>
              <button className="btn-close" onClick={() => setModalDisp(null)}/>
            </div>
            <div className="modal-body">
              <div className="row g-3">
                <div className="col-md-6">
                  <label className="form-label fw-semibold">Nombre</label>
                  <input type="text" className="form-control form-control-sm"
                    value={m.nombre||''} onChange={e => upd('nombre', e.target.value)}
                    placeholder="Terminal entrada"/>
                </div>
                <div className="col-md-6">
                  <label className="form-label fw-semibold">Modelo</label>
                  <input type="text" className="form-control form-control-sm"
                    value={m.modelo||''} onChange={e => upd('modelo', e.target.value)}/>
                </div>
                <div className="col-md-8">
                  <label className="form-label fw-semibold">IP del dispositivo *</label>
                  <input type="text" className="form-control form-control-sm"
                    value={m.ip||''} onChange={e => upd('ip', e.target.value)}
                    placeholder="10.1.1.XXX"/>
                </div>
                <div className="col-md-4">
                  <label className="form-label fw-semibold">Puerto</label>
                  <input type="number" className="form-control form-control-sm"
                    value={m.puerto||80} onChange={e => upd('puerto', Number(e.target.value))}/>
                </div>
                <div className="col-md-6">
                  <label className="form-label fw-semibold">Usuario</label>
                  <input type="text" className="form-control form-control-sm"
                    value={m.usuario||''} onChange={e => upd('usuario', e.target.value)}/>
                </div>
                <div className="col-md-6">
                  <label className="form-label fw-semibold">Contraseña</label>
                  <input type="password" className="form-control form-control-sm"
                    value={m.password||''} onChange={e => upd('password', e.target.value)}/>
                </div>
                <div className="col-12">
                  <div className="alert alert-info py-2 mb-0" style={{fontSize:'0.82rem'}}>
                    <i className="bi bi-info-circle me-1"/>
                    Guardá el dispositivo y luego usá <strong>Probar conexión</strong> para verificar antes de sincronizar.
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              {m.id && (
                <button className="btn btn-outline-info btn-sm me-auto" onClick={testDispositivo}>
                  <i className="bi bi-wifi me-1"/>Probar conexión
                </button>
              )}
              <button className="btn btn-secondary btn-sm" onClick={() => setModalDisp(null)}>Cancelar</button>
              <button className="btn btn-primary btn-sm" disabled={saving} onClick={guardarDispositivo}>
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  function ModalProyecto() {
    if (!modalProy) return null
    const m   = modalProy
    const upd = (k, v) => setModalProy(x => ({ ...x, [k]: v }))
    return (
      <div className="modal fade show d-block" style={{ background:'rgba(0,0,0,.5)' }}>
        <div className="modal-dialog">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">{m.id ? 'Editar proyecto' : 'Nuevo proyecto'}</h5>
              <button className="btn-close" onClick={() => setModalProy(null)}/>
            </div>
            <div className="modal-body">
              <div className="row g-3">
                <div className="col-12">
                  <label className="form-label fw-semibold">Nombre *</label>
                  <input type="text" className="form-control"
                    value={m.nombre||''} onChange={e => upd('nombre', e.target.value)}/>
                </div>
                {m.id && (
                  <div className="col-md-6">
                    <label className="form-label fw-semibold">Estado</label>
                    <select className="form-select"
                      value={m.activo} onChange={e => upd('activo', Number(e.target.value))}>
                      <option value={1}>Activo</option>
                      <option value={0}>Inactivo</option>
                    </select>
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary btn-sm" onClick={() => setModalProy(null)}>Cancelar</button>
              <button className="btn btn-primary btn-sm" disabled={saving} onClick={guardarProyecto}>
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="d-flex align-items-center justify-content-between mb-3">
        <div>
          <h4 className="mb-0 fw-bold">RRHH — Análisis de horas</h4>
          <small className="text-muted">Form 43 · Gestión de horas utilizadas</small>
        </div>
      </div>

      {/* Filtro período */}
      <div className="card mb-3">
        <div className="card-body py-2">
          <div className="d-flex gap-2 align-items-center flex-wrap">
            <span className="text-muted small me-1">Período:</span>
            <select className="form-select form-select-sm" style={{width:90}}
              value={year} onChange={e => setYear(Number(e.target.value))}>
              {ANOS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <select className="form-select form-select-sm" style={{width:165}}
              value={month} onChange={e => setMonth(e.target.value)}>
              {MESES.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
            </select>
            {loading && <span className="spinner-border spinner-border-sm text-primary ms-1"/>}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <ul className="nav nav-tabs mb-3">
        {[
          { id:'dashboard',  icon:'speedometer2',   label:'Dashboard'   },
          { id:'asistencia', icon:'person-check',   label:'Asistencia'  },
          { id:'registros',  icon:'clock-history',  label:'Horas'       },
          { id:'empleados',  icon:'people',          label:'Empleados'   },
          { id:'proyectos',  icon:'kanban',           label:'Proyectos'  },
        ].map(t => (
          <li key={t.id} className="nav-item">
            <button className={`nav-link ${tab===t.id?'active':''}`} onClick={() => setTab(t.id)}>
              <i className={`bi bi-${t.icon} me-1`}/>{t.label}
            </button>
          </li>
        ))}
      </ul>

      {/* Contenido */}
      {tab==='dashboard'  && TabDashboard()}
      {tab==='asistencia' && TabAsistencia()}
      {tab==='registros'  && TabRegistros()}
      {tab==='empleados'  && TabEmpleados()}
      {tab==='proyectos'  && TabProyectos()}

      {/* Modales */}
      {ModalRegistro()}
      {ModalEmpleado()}
      {ModalProyecto()}
      {ModalDispositivo()}
    </div>
  )
}
