import { useState, useEffect, useCallback } from 'react'
import api from '../api/client'
import { getUser } from '../store/authStore'
import DateInput from './DateInput'

const GRUPOS = [
  { grupo: 'Granallado',              color: '#6c757d' },
  { grupo: 'Mano de obra Herreria',   color: '#795548' },
  { grupo: 'Terminaciones y Montaje', color: '#dc3545' },
  { grupo: 'Electrico',               color: '#0d6efd' },
  { grupo: 'Infraestructura',         color: '#198754' },
  { grupo: 'Ingenieria',              color: '#6f42c1' },
  { grupo: 'General',                 color: '#20c997' },
]

function calcHoras(ini, fin) {
  if (!ini || !fin) return null
  const [hI, mI] = ini.split(':').map(Number)
  const [hF, mF] = fin.split(':').map(Number)
  const mins = hF * 60 + mF - (hI * 60 + mI)
  return mins > 0 ? +(mins / 60).toFixed(2) : null
}

function fmtH(h) {
  return h ? `${parseFloat((+h).toFixed(1))}h` : '—'
}

export default function MiParte({ show, onClose }) {
  const user = getUser()
  const hoy  = new Date().toISOString().split('T')[0]

  const [fecha,       setFecha]       = useState(hoy)
  const [filas,       setFilas]       = useState([])
  const [cargados,    setCargados]    = useState([])
  const [categorias,    setCategorias]    = useState([])
  const [proyectos,     setProyectos]     = useState([])
  const [actividades,   setActividades]   = useState([])
  const [saving,        setSaving]        = useState(false)
  const [loadReg,     setLoadReg]     = useState(false)
  const [sinEmpleado, setSinEmpleado] = useState(false)

  useEffect(() => {
    if (!show) return
    Promise.all([
      api.get('/rrhh/categorias'),
      api.get('/rrhh/proyectos'),
      api.get('/rrhh/actividades'),
    ]).then(([c, p, a]) => {
      setCategorias(c.data)
      setProyectos(p.data.filter(x => x.estado === 'Activo'))
      setActividades(a.data.filter(x => x.activo))
    }).catch(() => {})
  }, [show])

  const cargarRegistros = useCallback(() => {
    setLoadReg(true)
    api.get('/rrhh/mi-parte', { params: { fecha } })
      .then(r => {
        if (r.data === null) { setSinEmpleado(true); setCargados([]) }
        else                 { setSinEmpleado(false); setCargados(r.data) }
      })
      .catch(() => {})
      .finally(() => setLoadReg(false))
  }, [fecha])

  useEffect(() => { if (show) cargarRegistros() }, [show, cargarRegistros])

  const gruposCats = categorias.reduce((acc, c) => {
    if (!acc[c.grupo]) acc[c.grupo] = []
    acc[c.grupo].push(c)
    return acc
  }, {})

  const addFila = (cat) => setFilas(fs => [...fs, {
    _key: Date.now() + Math.random(),
    cat_id: cat?.id || '', ini: '', fin: '', horas: '', asignacion: '', descripcion: '',
  }])

  const updFila = (key, field, val) => setFilas(fs => fs.map(f => {
    if (f._key !== key) return f
    const u = { ...f, [field]: val }
    if (field === 'ini' || field === 'fin') {
      const h = calcHoras(field === 'ini' ? val : f.ini, field === 'fin' ? val : f.fin)
      if (h !== null) u.horas = h
    }
    return u
  }))

  const delFila = (key) => setFilas(fs => fs.filter(f => f._key !== key))

  const totalNuevo  = filas.reduce((s, f) => s + (parseFloat(f.horas) || 0), 0)
  const totalCarg   = cargados.reduce((s, r) => s + (parseFloat(r.horas) || 0), 0)

  async function guardar() {
    const validas = filas.filter(f => f.cat_id && f.ini && f.fin && parseFloat(f.horas) > 0)
    if (!validas.length) { alert('Completá al menos una fila con código, INI y FIN'); return }
    setSaving(true)
    try {
      const registros = validas.map(f => {
        const esAct = f.asignacion?.startsWith('a:')
        const asigId = f.asignacion ? Number(f.asignacion.slice(2)) : null
        return {
          fecha, categoria_id: f.cat_id,
          proyecto_id:  esAct ? null : (asigId || null),
          actividad_id: esAct ? asigId : null,
          hora_inicio: f.ini, hora_fin: f.fin, horas: parseFloat(f.horas),
          descripcion: f.descripcion || '',
        }
      })
      const r = await api.post('/rrhh/mi-parte', { registros })
      alert(`${r.data.insertados} registros guardados`)
      setFilas([])
      cargarRegistros()
    } catch (e) {
      alert(e.response?.data?.error || 'Error al guardar')
    } finally { setSaving(false) }
  }

  function handleClose() { setFilas([]); onClose() }

  if (!show) return null

  return (
    <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)', zIndex: 1060 }}>
      <div className="modal-dialog modal-xl modal-dialog-scrollable">
        <div className="modal-content">

          {/* Header */}
          <div className="modal-header py-2 bg-primary text-white">
            <div>
              <h5 className="modal-title mb-0">
                <i className="bi bi-file-earmark-text me-2" />Mi Parte Diario
              </h5>
              {user?.empleado_nombre
                ? <small className="opacity-75">{user.empleado_nombre}</small>
                : <small className="opacity-75">{user?.nombre}</small>}
            </div>
            <button className="btn-close btn-close-white" onClick={handleClose} />
          </div>

          <div className="modal-body p-3">

            {/* Sin empleado asociado */}
            {sinEmpleado && (
              <div className="alert alert-warning">
                <i className="bi bi-exclamation-triangle me-2" />
                Tu usuario no está asociado a un empleado RRHH.
                Pedile al administrador que lo configure en <strong>Configuración → Usuarios</strong>.
              </div>
            )}

            {!sinEmpleado && (<>

              {/* Fecha */}
              <div className="d-flex align-items-center gap-3 mb-3">
                <label className="fw-semibold mb-0">Fecha:</label>
                <DateInput className="form-control form-control-sm" style={{ width: 160 }}
                  value={fecha} onChange={v => setFecha(v)} />
                {totalCarg > 0 && (
                  <span className="badge bg-success fs-6">
                    <i className="bi bi-check-circle me-1" />{fmtH(totalCarg)} ya cargadas
                  </span>
                )}
              </div>

              {/* Registros ya cargados */}
              {loadReg && <div className="text-center py-2"><span className="spinner-border spinner-border-sm" /></div>}
              {!loadReg && cargados.length > 0 && (
                <div className="mb-3">
                  <p className="small fw-semibold text-muted mb-1">Ya cargado este día:</p>
                  <table className="table table-sm table-bordered mb-0">
                    <thead className="table-light"><tr><th>Código</th><th>INI</th><th>FIN</th><th>Horas</th><th>Proyecto</th><th>Descripción</th></tr></thead>
                    <tbody>
                      {cargados.map(r => (
                        <tr key={r.id}>
                          <td><strong>{r.cat_codigo}</strong> <small className="text-muted">{r.cat_descripcion}</small></td>
                          <td>{r.hora_inicio || '—'}</td>
                          <td>{r.hora_fin || '—'}</td>
                          <td className="text-primary fw-bold">{fmtH(r.horas)}</td>
                          <td><small>{r.proyecto_nombre || '—'}</small></td>
                          <td><small>{r.descripcion || '—'}</small></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Códigos */}
              <div className="card mb-3">
                <div className="card-header py-1 small fw-semibold">
                  <i className="bi bi-grid-3x3 me-1" />Códigos — clic para agregar fila
                </div>
                <div className="card-body py-2">
                  <div className="row g-2">
                    {GRUPOS.map(({ grupo, color }) => {
                      const cats = categorias.filter(c => c.grupo === grupo)
                      if (!cats.length) return null
                      return (
                        <div key={grupo} className="col-12 col-xl-6">
                          <div className="d-flex align-items-center gap-1 flex-wrap">
                            <span className="badge text-white me-1"
                              style={{ background: color, minWidth: 120, fontSize: '0.65rem' }}>
                              {grupo}
                            </span>
                            {cats.map(c => (
                              <button key={c.id} className="btn btn-sm py-0 px-2 border"
                                style={{ fontSize: '0.75rem', background: '#f8f9fa' }}
                                title={c.descripcion} onClick={() => addFila(c)}>
                                <strong>{c.codigo}</strong>
                              </button>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Tabla de filas */}
              <div className="card">
                <div className="card-header py-1 d-flex align-items-center justify-content-between">
                  <span className="small fw-semibold">
                    Nuevas filas
                    {filas.length > 0 && <span className="badge bg-secondary ms-2">{filas.length}</span>}
                  </span>
                  <button className="btn btn-sm btn-outline-primary py-0" onClick={() => addFila(null)}>
                    <i className="bi bi-plus-lg me-1" />Fila
                  </button>
                </div>
                <div className="table-responsive">
                  <table className="table table-sm mb-0 align-middle">
                    <thead className="table-light">
                      <tr>
                        <th style={{ minWidth: 170 }}>Código</th>
                        <th style={{ width: 90 }}>INI</th>
                        <th style={{ width: 90 }}>FIN</th>
                        <th style={{ width: 62 }} className="text-center">Horas</th>
                        <th style={{ minWidth: 140 }}>Proyecto</th>
                        <th>Descripción</th>
                        <th style={{ width: 34 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {filas.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="text-center text-muted py-4">
                            <i className="bi bi-file-earmark-plus d-block fs-2 mb-1 opacity-25" />
                            Seleccioná un código arriba o usá el botón Fila
                          </td>
                        </tr>
                      ) : filas.map((f, idx) => {
                        const prev = filas[idx - 1]
                        const showAlmuerzo = prev && prev.fin && prev.fin <= '13:01' && f.ini && f.ini >= '13:59'
                        return [
                          showAlmuerzo && (
                            <tr key={`alm-${f._key}`} className="table-warning">
                              <td colSpan={7} className="text-center py-1 small fw-semibold">
                                <i className="bi bi-cup-hot me-1" />ALMUERZO · 13:00 – 14:00
                              </td>
                            </tr>
                          ),
                          <tr key={f._key}>
                            <td>
                              <select className="form-select form-select-sm" style={{ fontSize: '0.78rem' }}
                                value={f.cat_id}
                                onChange={e => {
                                  const val = e.target.value
                                  setFilas(fs => fs.map(x => x._key !== f._key ? x : { ...x, cat_id: val ? Number(val) : '' }))
                                }}>
                                <option value="">—</option>
                                {Object.entries(gruposCats).map(([g, cats]) => (
                                  <optgroup key={g} label={g}>
                                    {cats.map(c => <option key={c.id} value={c.id}>{c.codigo} – {c.descripcion}</option>)}
                                  </optgroup>
                                ))}
                              </select>
                            </td>
                            <td><input type="time" className="form-control form-control-sm" value={f.ini} onChange={e => updFila(f._key, 'ini', e.target.value)} /></td>
                            <td><input type="time" className="form-control form-control-sm" value={f.fin} onChange={e => updFila(f._key, 'fin', e.target.value)} /></td>
                            <td className="text-center fw-semibold text-primary">{f.horas ? `${parseFloat(f.horas).toFixed(1)}h` : '—'}</td>
                            <td>
                              <select className="form-select form-select-sm" style={{ fontSize: '0.78rem' }}
                                value={f.asignacion} onChange={e => updFila(f._key, 'asignacion', e.target.value)}>
                                <option value="">—</option>
                                {proyectos.length > 0 && (
                                  <optgroup label="Proyectos">
                                    {proyectos.map(p => <option key={p.id} value={`p:${p.id}`}>{p.nombre}</option>)}
                                  </optgroup>
                                )}
                                {actividades.length > 0 && (
                                  <optgroup label="Actividades">
                                    {actividades.map(a => <option key={a.id} value={`a:${a.id}`}>{a.nombre}</option>)}
                                  </optgroup>
                                )}
                              </select>
                            </td>
                            <td><input type="text" className="form-control form-control-sm" placeholder="descripción" value={f.descripcion} onChange={e => updFila(f._key, 'descripcion', e.target.value)} /></td>
                            <td><button className="btn btn-sm btn-outline-danger py-0" onClick={() => delFila(f._key)}><i className="bi bi-x-lg" /></button></td>
                          </tr>
                        ]
                      })}
                    </tbody>
                    {filas.length > 0 && (
                      <tfoot className="table-light">
                        <tr>
                          <td colSpan={3} className="text-end text-muted small fw-semibold">Total nuevo:</td>
                          <td className="text-center fw-bold text-primary">{fmtH(totalNuevo)}</td>
                          <td colSpan={3} />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>

            </>)}
          </div>

          {/* Footer */}
          <div className="modal-footer py-2">
            <button className="btn btn-secondary btn-sm" onClick={handleClose}>Cerrar</button>
            {!sinEmpleado && filas.length > 0 && (
              <>
                <button className="btn btn-sm btn-outline-secondary"
                  onClick={() => { if (window.confirm('¿Limpiar filas?')) setFilas([]) }}>
                  <i className="bi bi-trash me-1" />Limpiar
                </button>
                <button className="btn btn-primary btn-sm" onClick={guardar} disabled={saving}>
                  {saving
                    ? <><span className="spinner-border spinner-border-sm me-1" />Guardando...</>
                    : <><i className="bi bi-check-lg me-1" />Guardar parte</>}
                </button>
              </>
            )}
          </div>

        </div>
      </div>
    </div>
  )
}
