import { useState, useEffect } from 'react'
import api from '../../api/client'
import { getUser, puedeEscribir } from '../../store/authStore'
import DateInput from '../../components/DateInput'

function fmtCod(c) {
  if (!c) return ''
  if (c.includes('/')) return c.replace('/', '')
  if (!/\d$/.test(c))  return c + '0'
  return c
}

function fmtH(h) {
  if (!h && h !== 0) return '—'
  return `${parseFloat((+h).toFixed(1))}h`
}

function fmtDia(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'numeric' })
}

function calcHoras(ini, fin) {
  if (!ini || !fin) return null
  const [hI, mI] = ini.split(':').map(Number)
  const [hF, mF] = fin.split(':').map(Number)
  const mins = hF * 60 + mF - (hI * 60 + mI)
  return mins > 0 ? +(mins / 60).toFixed(2) : null
}

const GRUPOS = [
  { grupo: 'Granallado',             color: '#6c757d' },
  { grupo: 'Mano de obra Herreria',  color: '#795548' },
  { grupo: 'Terminaciones y Montaje',color: '#dc3545' },
  { grupo: 'Electrico',              color: '#0d6efd' },
  { grupo: 'Infraestructura',        color: '#198754' },
  { grupo: 'Ingenieria',             color: '#6f42c1' },
  { grupo: 'General',                color: '#20c997' },
]

const COLOR_GRUPO = Object.fromEntries(GRUPOS.map(g => [g.grupo, g.color]))

export default function Partes() {
  const user         = getUser()
  const canManageAll = user?.rol === 'admin' || puedeEscribir('rrhh') || puedeEscribir('partes')

  const [tab, setTab] = useState('cargar')

  const [categorias,       setCategorias]       = useState([])
  const [empleados,        setEmpleados]        = useState([])
  const [proyectosLista,   setProyectosLista]   = useState([])
  const [actividadesLista, setActividadesLista] = useState([])
  const [parteEmp,    setParteEmp]    = useState(canManageAll ? '' : (user?.rrhh_empleado_id ? String(user.rrhh_empleado_id) : ''))
  const [parteDate,   setParteDate]   = useState(new Date().toISOString().split('T')[0])
  const [parteFilas,  setParteFilas]  = useState([])
  const [savingParte, setSavingParte] = useState(false)

  const [semana,        setSemana]        = useState(null)
  const [loadingSemana, setLoadingSemana] = useState(false)
  const [diasVer,       setDiasVer]       = useState(7)

  const [regs7,     setRegs7]     = useState([])
  const [loading7,  setLoading7]  = useState(false)
  const [modalReg7, setModalReg7] = useState(null)
  const [saving7,   setSaving7]   = useState(false)

  const [proyData,     setProyData]     = useState([])
  const [loadingProy,  setLoadingProy]  = useState(false)
  const [diasProy,     setDiasProy]     = useState(7)
  const [proyExpanded, setProyExpanded] = useState({})

  useEffect(() => {
    Promise.allSettled([
      api.get('/rrhh/categorias'),
      api.get('/rrhh/empleados'),
      api.get('/proyectos?estado=Activo'),
      api.get('/rrhh/actividades'),
    ]).then(([c, e, p, a]) => {
      if (c.status === 'fulfilled') setCategorias(c.value.data)
      if (e.status === 'fulfilled') setEmpleados(e.value.data.filter(x => x.activo))
      if (p.status === 'fulfilled') setProyectosLista(p.value.data)
      if (a.status === 'fulfilled') setActividadesLista(a.value.data.filter(x => x.activo))
    })
  }, [])

  function cargarSemana() {
    setLoadingSemana(true)
    api.get(`/rrhh/partes/semana?dias=${diasVer}`)
      .then(r => setSemana(r.data))
      .catch(() => {})
      .finally(() => setLoadingSemana(false))
  }

  useEffect(() => {
    if (tab !== 'semana') return
    setSemana(null)
    cargarSemana()
  }, [tab, diasVer])

  // ── Tab: Últimos 7 días (listado plano para detectar/corregir partes mal hechos) ──
  function cargarUltimos7() {
    setLoading7(true)
    const hasta = new Date().toISOString().slice(0, 10)
    const d = new Date(); d.setDate(d.getDate() - (diasVer - 1))
    const desde = d.toISOString().slice(0, 10)
    api.get('/rrhh/registros', { params: { desde, hasta } })
      .then(r => setRegs7(r.data))
      .catch(() => setRegs7([]))
      .finally(() => setLoading7(false))
  }

  useEffect(() => {
    if (tab !== 'ultimos7') return
    cargarUltimos7()
  }, [tab, diasVer])

  async function guardarReg7() {
    const m = modalReg7
    if (!m.fecha || !m.empleado_id || !m.hora_inicio || !m.hora_fin || !m.asignacion) {
      alert('Completá fecha, empleado, horario y proyecto/actividad'); return
    }
    setSaving7(true)
    try {
      const esActividad = m.asignacion.startsWith('a:')
      const asigId = Number(m.asignacion.slice(2))
      await api.put(`/rrhh/registros/${m.id}`, {
        fecha: m.fecha,
        empleado_id: Number(m.empleado_id),
        categoria_id: m.categoria_id ? Number(m.categoria_id) : null,
        proyecto_id: esActividad ? null : asigId,
        actividad_id: esActividad ? asigId : null,
        hora_inicio: m.hora_inicio, hora_fin: m.hora_fin,
        horas: parseFloat(m.horas),
        descripcion: m.descripcion || '',
      })
      setModalReg7(null)
      cargarUltimos7()
      if (tab === 'semana') cargarSemana()
    } catch (e) {
      alert(e.response?.data?.error || 'Error al guardar')
    } finally { setSaving7(false) }
  }

  async function eliminarReg7(id) {
    if (!window.confirm('¿Eliminar esta fila del parte?')) return
    try {
      await api.delete(`/rrhh/registros/${id}`)
      setRegs7(rs => rs.filter(r => r.id !== id))
    } catch (e) {
      alert(e.response?.data?.error || 'Error al eliminar')
    }
  }

  useEffect(() => {
    if (tab !== 'proyectos') return
    setLoadingProy(true)
    setProyData([])
    api.get(`/rrhh/partes/proyectos?dias=${diasProy}`)
      .then(r => {
        setProyData(r.data)
        const exp = {}
        r.data.forEach(p => { exp[p.id] = true })
        setProyExpanded(exp)
      })
      .catch(() => {})
      .finally(() => setLoadingProy(false))
  }, [tab, diasProy])

  const addFila = (cat) => setParteFilas(fs => [...fs, {
    _key: Date.now() + Math.random(),
    cat_id: cat?.id || '',
    ini: '', fin: '', horas: '',
    asignacion: '', descripcion: '',
  }])

  const updFila = (key, field, val) => setParteFilas(fs => fs.map(f => {
    if (f._key !== key) return f
    const u = { ...f, [field]: val }
    if (field === 'ini' || field === 'fin') {
      const h = calcHoras(field === 'ini' ? val : f.ini, field === 'fin' ? val : f.fin)
      if (h !== null) u.horas = h
    }
    return u
  }))

  const delFila = (key) => setParteFilas(fs => fs.filter(f => f._key !== key))

  const totalHoras = parteFilas.reduce((s, f) => s + (parseFloat(f.horas) || 0), 0)

  const gruposCats = categorias.reduce((acc, c) => {
    if (!acc[c.grupo]) acc[c.grupo] = []
    acc[c.grupo].push(c)
    return acc
  }, {})

  const filasMostradas = []
  for (let i = 0; i < parteFilas.length; i++) {
    if (i > 0) {
      const prev = parteFilas[i - 1], curr = parteFilas[i]
      if (prev.fin && prev.fin <= '13:01' && curr.ini && curr.ini >= '13:59')
        filasMostradas.push({ _almuerzo: true, _key: 'alm' })
    }
    filasMostradas.push(parteFilas[i])
  }

  async function guardarParte() {
    if (!parteEmp)  { alert('Seleccioná un empleado'); return }
    if (!parteDate) { alert('Seleccioná una fecha');   return }
    const hoy = new Date().toISOString().slice(0, 10)
    if (parteDate > hoy) { alert('La fecha no puede ser posterior a hoy'); return }
    const validas = parteFilas.filter(f => f.cat_id && f.ini && f.fin && parseFloat(f.horas) > 0)
    if (validas.length === 0) {
      alert('Completá al menos una fila con código, INI y FIN')
      return
    }
    if (validas.some(f => !f.asignacion)) {
      alert('Completá el proyecto o actividad en todas las filas antes de guardar')
      return
    }
    setSavingParte(true)
    try {
      const registros = validas.map(f => {
        const esActividad = f.asignacion.startsWith('a:')
        const asigId = Number(f.asignacion.slice(2))
        return {
          fecha:        parteDate,
          empleado_id:  Number(parteEmp),
          categoria_id: f.cat_id || null,
          proyecto_id:  esActividad ? null : asigId,
          actividad_id: esActividad ? asigId : null,
          hora_inicio:  f.ini,
          hora_fin:     f.fin,
          horas:        parseFloat(f.horas),
          modulo:       '',
          descripcion:  f.descripcion || '',
        }
      })
      const r = await api.post('/rrhh/registros/batch', { registros })
      alert(`${r.data.insertados} registros guardados correctamente`)
      setParteFilas([])
    } catch (e) {
      alert(e.response?.data?.error || 'Error al guardar')
    } finally {
      setSavingParte(false)
    }
  }

  // ── Tab: Cargar Parte ────────────────────────────────────────────────────────
  function TabCargar() {
    return (
      <div>
        <div className="card mb-3">
          <div className="card-body py-2">
            <div className="d-flex gap-3 align-items-end flex-wrap">
              <div style={{ minWidth: 240 }}>
                <label className="form-label small mb-1 fw-semibold">Empleado</label>
                {canManageAll ? (
                  <select className="form-select form-select-sm" value={parteEmp}
                    onChange={e => setParteEmp(e.target.value)}>
                    <option value="">— seleccionar —</option>
                    <optgroup label="E-INTRA">
                      {empleados.filter(x => x.tipo === 'interno').map(x =>
                        <option key={x.id} value={x.id}>{x.nombre}</option>)}
                    </optgroup>
                    <optgroup label="Contratistas">
                      {empleados.filter(x => x.tipo === 'contratista').map(x =>
                        <option key={x.id} value={x.id}>{x.nombre}</option>)}
                    </optgroup>
                  </select>
                ) : (
                  <input className="form-control form-control-sm" readOnly
                    value={empleados.find(x => String(x.id) === String(parteEmp))?.nombre || user?.nombre || '—'} />
                )}
              </div>
              <div>
                <label className="form-label small mb-1 fw-semibold">Fecha</label>
                <DateInput className="form-control form-control-sm" style={{ width: 150 }}
                  value={parteDate} onChange={v => setParteDate(v)} />
              </div>
            </div>
          </div>
        </div>

        <div className="card mb-3">
          <div className="card-header py-2 small fw-semibold">
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

        <div className="card">
          <div className="card-header py-2 d-flex align-items-center justify-content-between">
            <span className="fw-semibold small">
              Filas
              {parteFilas.length > 0 &&
                <span className="badge bg-secondary ms-2">{parteFilas.length}</span>}
            </span>
            <button className="btn btn-sm btn-outline-primary" onClick={() => addFila(null)}>
              <i className="bi bi-plus-lg me-1" />Fila
            </button>
          </div>
          <div className="table-responsive">
            <table className="table table-sm mb-0 align-middle">
              <thead className="table-light">
                <tr>
                  <th style={{ minWidth: 160 }}>Código</th>
                  <th style={{ width: 90 }}>INI</th>
                  <th style={{ width: 90 }}>FIN</th>
                  <th style={{ width: 62 }} className="text-center">Horas</th>
                  <th style={{ minWidth: 140 }}>Proyecto</th>
                  <th>Descripción</th>
                  <th style={{ width: 34 }} />
                </tr>
              </thead>
              <tbody>
                {parteFilas.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center text-muted py-5">
                      <i className="bi bi-file-earmark-plus d-block fs-2 mb-2 opacity-25" />
                      Seleccioná un código arriba o usá el botón Fila
                    </td>
                  </tr>
                ) : filasMostradas.map(item => {
                  if (item._almuerzo) return (
                    <tr key="alm" className="table-warning">
                      <td colSpan={7} className="text-center py-1 small fw-semibold">
                        <i className="bi bi-cup-hot me-1" />ALMUERZO · 13:00 – 14:00
                      </td>
                    </tr>
                  )
                  const f = item
                  return (
                    <tr key={f._key}>
                      <td>
                        <select className="form-select form-select-sm" style={{ fontSize: '0.78rem' }}
                          value={f.cat_id}
                          onChange={e => {
                            const val = e.target.value
                            setParteFilas(fs => fs.map(x =>
                              x._key !== f._key ? x : { ...x, cat_id: val ? Number(val) : '' }
                            ))
                          }}>
                          <option value="">—</option>
                          {Object.entries(gruposCats).map(([g, cats]) => (
                            <optgroup key={g} label={g}>
                              {cats.map(c => (
                                <option key={c.id} value={c.id}>
                                  {c.codigo} – {c.descripcion}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input type="time" className="form-control form-control-sm"
                          value={f.ini} onChange={e => updFila(f._key, 'ini', e.target.value)} />
                      </td>
                      <td>
                        <input type="time" className="form-control form-control-sm"
                          value={f.fin} onChange={e => updFila(f._key, 'fin', e.target.value)} />
                      </td>
                      <td className="text-center fw-semibold text-primary">
                        {f.horas ? `${parseFloat(f.horas).toFixed(1)}h` : '—'}
                      </td>
                      <td>
                        <select className="form-select form-select-sm" style={{ fontSize: '0.78rem' }}
                          value={f.asignacion}
                          onChange={e => updFila(f._key, 'asignacion', e.target.value)}>
                          <option value="">—</option>
                          {proyectosLista.length > 0 && (
                            <optgroup label="Proyectos">
                              {proyectosLista.map(p =>
                                <option key={p.id} value={`p:${p.id}`}>{fmtCod(p.codigo)} — {p.nombre}</option>)}
                            </optgroup>
                          )}
                          {actividadesLista.length > 0 && (
                            <optgroup label="Actividades">
                              {actividadesLista.map(a =>
                                <option key={a.id} value={`a:${a.id}`}>{a.nombre}</option>)}
                            </optgroup>
                          )}
                        </select>
                      </td>
                      <td>
                        <input type="text" className="form-control form-control-sm"
                          placeholder="descripción"
                          value={f.descripcion}
                          onChange={e => updFila(f._key, 'descripcion', e.target.value)} />
                      </td>
                      <td>
                        <button className="btn btn-sm btn-outline-danger py-0"
                          onClick={() => delFila(f._key)}>
                          <i className="bi bi-x-lg" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              {parteFilas.length > 0 && (
                <tfoot className="table-light">
                  <tr>
                    <td colSpan={3} className="text-end text-muted small fw-semibold">Total:</td>
                    <td className="text-center fw-bold text-primary">{fmtH(totalHoras)}</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {parteFilas.length > 0 && (
            <div className="card-footer d-flex justify-content-between">
              <button className="btn btn-sm btn-outline-secondary"
                onClick={() => { if (window.confirm('¿Limpiar filas?')) setParteFilas([]) }}>
                <i className="bi bi-trash me-1" />Limpiar
              </button>
              <button className="btn btn-primary"
                disabled={savingParte || !parteEmp} onClick={guardarParte}>
                {savingParte
                  ? <><span className="spinner-border spinner-border-sm me-1" />Guardando...</>
                  : <><i className="bi bi-check-lg me-1" />Guardar parte</>}
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Tab: Estado 7 días ───────────────────────────────────────────────────────
  function TabSemana() {
    if (loadingSemana) return (
      <div className="text-center py-5"><span className="spinner-border text-primary" /></div>
    )

    const conParte = semana ? semana.empleados.reduce((s, e) =>
      s + semana.fechas.filter(f => e.dias[f]?.tiene_parte).length, 0) : 0
    const sinParte = semana ? semana.empleados.reduce((s, e) =>
      s + semana.fechas.filter(f => !e.dias[f]?.tiene_parte && e.dias[f]?.horas_fichada).length, 0) : 0

    return (
      <div>
        <div className="row g-3 mb-3">
          <div className="col-6 col-md-3">
            <div className="card text-center border-success">
              <div className="card-body py-2">
                <div className="fs-3 fw-bold text-success">{conParte}</div>
                <div className="text-muted small">Partes cargados</div>
              </div>
            </div>
          </div>
          <div className="col-6 col-md-3">
            <div className="card text-center border-danger">
              <div className="card-body py-2">
                <div className="fs-3 fw-bold text-danger">{sinParte}</div>
                <div className="text-muted small">Sin parte (con fichada)</div>
              </div>
            </div>
          </div>
          <div className="col-6 col-md-3">
            <div className="card text-center">
              <div className="card-body py-2">
                <div className="fs-3 fw-bold">{semana?.empleados.length ?? 0}</div>
                <div className="text-muted small">Empleados activos</div>
              </div>
            </div>
          </div>
          <div className="col-6 col-md-3 d-flex align-items-center justify-content-center gap-2">
            <span className="text-muted small">Días:</span>
            {[7, 14, 30].map(n => (
              <button key={n}
                className={`btn btn-sm ${diasVer === n ? 'btn-primary' : 'btn-outline-secondary'}`}
                onClick={() => setDiasVer(n)}>
                {n}d
              </button>
            ))}
          </div>
        </div>

        {!semana ? (
          <div className="text-center text-muted py-4">Sin datos</div>
        ) : (
          <div className="card">
            <div className="table-responsive">
              <table className="table table-bordered table-sm mb-0" style={{ fontSize: '0.82rem' }}>
                <thead className="table-dark">
                  <tr>
                    <th style={{ minWidth: 155 }}>Empleado</th>
                    {semana.fechas.map(f => (
                      <th key={f} className="text-center" style={{ minWidth: 78 }}>{fmtDia(f)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {semana.empleados.map(emp => (
                    <tr key={emp.id}>
                      <td style={{ fontSize: '0.78rem' }}>
                        <span className="d-inline-block text-truncate" style={{ maxWidth: 120 }}
                          title={emp.nombre}>{emp.nombre}</span>
                        <span className={`badge ms-1 ${emp.tipo === 'interno' ? 'bg-primary' : 'bg-secondary'}`}
                          style={{ fontSize: '0.58rem' }}>
                          {emp.tipo === 'interno' ? 'E' : 'C'}
                        </span>
                      </td>
                      {semana.fechas.map(fecha => {
                        const d = emp.dias[fecha] || {}
                        const tieneP = d.tiene_parte
                        const tienF  = d.horas_fichada != null
                        const diff   = tieneP && tienF
                          ? Math.abs((d.horas_parte || 0) - d.horas_fichada) : null

                        if (!tieneP && !tienF) {
                          return <td key={fecha} className="text-center text-muted">—</td>
                        }
                        if (!tieneP && tienF) {
                          return (
                            <td key={fecha} className="text-center" style={{ background: '#fff3cd' }}>
                              <div className="text-danger fw-bold" style={{ fontSize: '0.75rem' }}>
                                <i className="bi bi-exclamation-triangle me-1" />Sin parte
                              </div>
                              <div className="text-muted" style={{ fontSize: '0.68rem' }}>
                                {d.entrada}→{d.salida}
                              </div>
                            </td>
                          )
                        }
                        const bg = diff == null ? '#d1e7dd'
                          : diff <= 1 ? '#d1e7dd'
                          : diff <= 2 ? '#fff3cd'
                          : '#f8d7da'
                        return (
                          <td key={fecha} className="text-center" style={{ background: bg }}>
                            <div className="fw-semibold" style={{ fontSize: '0.88rem' }}>
                              {fmtH(d.horas_parte)}
                            </div>
                            {tienF ? (
                              <div style={{ fontSize: '0.68rem' }}
                                className={diff && diff > 1 ? 'text-warning fw-semibold' : 'text-muted'}>
                                ↕{fmtH(d.horas_fichada)}
                              </div>
                            ) : (
                              <div style={{ fontSize: '0.65rem' }} className="text-muted">sin fich.</div>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card-footer d-flex flex-wrap gap-3" style={{ fontSize: '0.75rem' }}>
              <span>
                <span className="badge border" style={{ background: '#d1e7dd', color: '#0a3622' }}>8h</span>
                {' '}Parte OK
              </span>
              <span>
                <span className="badge border" style={{ background: '#fff3cd', color: '#664d03' }}>8h</span>
                {' '}Diff &gt;1h con fichada
              </span>
              <span>
                <span className="badge border" style={{ background: '#fff3cd', color: '#856404' }}>Sin parte</span>
                {' '}Fichada sin parte cargado
              </span>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Tab: Últimos días (listado plano, para detectar/corregir partes mal hechos) ──
  function TabUltimos7() {
    return (
      <div>
        <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
          <div className="d-flex gap-2 align-items-center">
            <span className="text-muted small">Período:</span>
            {[7, 14, 30].map(n => (
              <button key={n}
                className={`btn btn-sm ${diasVer === n ? 'btn-primary' : 'btn-outline-secondary'}`}
                onClick={() => setDiasVer(n)}>
                {n}d
              </button>
            ))}
            <span className="badge bg-secondary ms-2">{regs7.length} registros</span>
          </div>
        </div>

        {loading7 && <div className="text-center py-5"><span className="spinner-border text-primary" /></div>}

        {!loading7 && (
          <div className="table-responsive">
            <table className="table table-sm table-hover align-middle">
              <thead className="table-dark">
                <tr>
                  <th>Fecha</th><th>Empleado</th><th>T</th><th>Código</th>
                  <th>Inicio</th><th>Fin</th><th className="text-end">Horas</th>
                  <th>Proyecto</th><th style={{ minWidth: 140 }}>Descripción</th><th />
                </tr>
              </thead>
              <tbody>
                {regs7.map(r => (
                  <tr key={r.id}>
                    <td className="text-nowrap">{fmtDia(r.fecha)}</td>
                    <td>{r.empleado_nombre}</td>
                    <td>
                      <span className={`badge bg-${r.empleado_tipo === 'interno' ? 'primary' : 'secondary'}`}>
                        {r.empleado_tipo === 'interno' ? 'E' : 'C'}
                      </span>
                    </td>
                    <td>
                      {r.cat_codigo
                        ? <span className="badge bg-light text-dark border" title={r.cat_descripcion}>{r.cat_codigo}</span>
                        : '—'}
                    </td>
                    <td>{r.hora_inicio || '—'}</td>
                    <td>{r.hora_fin || '—'}</td>
                    <td className="text-end fw-semibold text-nowrap">{fmtH(r.horas)}</td>
                    <td className="text-truncate" style={{ maxWidth: 160 }} title={r.proyecto_nombre}>{r.proyecto_nombre || '—'}</td>
                    <td className="text-truncate" style={{ maxWidth: 160 }} title={r.descripcion}>{r.descripcion || '—'}</td>
                    <td className="text-nowrap">
                      <button className="btn btn-sm btn-outline-primary py-0 me-1" onClick={() => setModalReg7({
                        ...r,
                        asignacion: r.actividad_id ? `a:${r.actividad_id}` : r.proyecto_id ? `p:${r.proyecto_id}` : '',
                      })}>
                        <i className="bi bi-pencil" />
                      </button>
                      <button className="btn btn-sm btn-outline-danger py-0" onClick={() => eliminarReg7(r.id)}>
                        <i className="bi bi-trash" />
                      </button>
                    </td>
                  </tr>
                ))}
                {regs7.length === 0 && (
                  <tr><td colSpan={10} className="text-center text-muted py-4">Sin registros en el período seleccionado</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {modalReg7 && (
          <div className="modal d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
            <div className="modal-dialog modal-lg">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Editar registro</h5>
                  <button className="btn-close" onClick={() => setModalReg7(null)} />
                </div>
                <div className="modal-body">
                  <div className="row g-3">
                    <div className="col-md-4">
                      <label className="form-label fw-semibold">Fecha *</label>
                      <DateInput className="form-control form-control-sm"
                        value={modalReg7.fecha || ''} onChange={v => setModalReg7(x => ({ ...x, fecha: v }))} />
                    </div>
                    <div className="col-md-8">
                      <label className="form-label fw-semibold">Empleado *</label>
                      <select className="form-select form-select-sm"
                        value={modalReg7.empleado_id || ''} onChange={e => setModalReg7(x => ({ ...x, empleado_id: e.target.value }))}>
                        <option value="">— seleccionar —</option>
                        <optgroup label="E-INTRA">
                          {empleados.filter(x => x.tipo === 'interno').map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                        </optgroup>
                        <optgroup label="Contratistas">
                          {empleados.filter(x => x.tipo === 'contratista').map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                        </optgroup>
                      </select>
                    </div>
                    <div className="col-md-6">
                      <label className="form-label fw-semibold">Código</label>
                      <select className="form-select form-select-sm"
                        value={modalReg7.categoria_id || ''} onChange={e => setModalReg7(x => ({ ...x, categoria_id: e.target.value }))}>
                        <option value="">— sin categoría —</option>
                        {Object.entries(gruposCats).map(([g, cats]) => (
                          <optgroup key={g} label={g}>
                            {cats.map(c => <option key={c.id} value={c.id}>{c.codigo} – {c.descripcion}</option>)}
                          </optgroup>
                        ))}
                      </select>
                    </div>
                    <div className="col-md-6">
                      <label className="form-label fw-semibold">Proyecto / Actividad *</label>
                      <select className="form-select form-select-sm"
                        value={modalReg7.asignacion || ''} onChange={e => setModalReg7(x => ({ ...x, asignacion: e.target.value }))}>
                        <option value="">— sin asignar —</option>
                        {modalReg7.proyecto_id && !modalReg7.asignacion?.startsWith('a:') && !proyectosLista.some(p => String(p.id) === String(modalReg7.proyecto_id)) && modalReg7.proyecto_nombre && (
                          <optgroup label="Proyecto actual (no activo)">
                            <option value={`p:${modalReg7.proyecto_id}`}>{modalReg7.proyecto_nombre}</option>
                          </optgroup>
                        )}
                        {proyectosLista.length > 0 && (
                          <optgroup label="Proyectos">
                            {proyectosLista.map(p => <option key={p.id} value={`p:${p.id}`}>{fmtCod(p.codigo)} — {p.nombre}</option>)}
                          </optgroup>
                        )}
                        {actividadesLista.length > 0 && (
                          <optgroup label="Actividades">
                            {actividadesLista.map(a => <option key={a.id} value={`a:${a.id}`}>{a.nombre}</option>)}
                          </optgroup>
                        )}
                      </select>
                    </div>
                    <div className="col-md-4">
                      <label className="form-label fw-semibold">Hora inicio</label>
                      <input type="time" className="form-control form-control-sm"
                        value={modalReg7.hora_inicio || ''} onChange={e => {
                          const v = e.target.value
                          const h = calcHoras(v, modalReg7.hora_fin)
                          setModalReg7(x => ({ ...x, hora_inicio: v, ...(h !== null && { horas: h }) }))
                        }} />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label fw-semibold">Hora fin</label>
                      <input type="time" className="form-control form-control-sm"
                        value={modalReg7.hora_fin || ''} onChange={e => {
                          const v = e.target.value
                          const h = calcHoras(modalReg7.hora_inicio, v)
                          setModalReg7(x => ({ ...x, hora_fin: v, ...(h !== null && { horas: h }) }))
                        }} />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label fw-semibold">Horas *</label>
                      <input type="number" className="form-control form-control-sm" step="0.01" min="0" max="24"
                        value={modalReg7.horas || ''} onChange={e => setModalReg7(x => ({ ...x, horas: e.target.value }))} />
                    </div>
                    <div className="col-12">
                      <label className="form-label fw-semibold">Descripción</label>
                      <input type="text" className="form-control form-control-sm"
                        value={modalReg7.descripcion || ''} onChange={e => setModalReg7(x => ({ ...x, descripcion: e.target.value }))} />
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button className="btn btn-secondary btn-sm" onClick={() => setModalReg7(null)}>Cancelar</button>
                  <button className="btn btn-primary btn-sm" disabled={saving7} onClick={guardarReg7}>
                    {saving7 ? <><span className="spinner-border spinner-border-sm me-1" />Guardando...</> : 'Guardar'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── Tab: Proyectos ───────────────────────────────────────────────────────────
  function TabProyectos() {
    if (loadingProy) return (
      <div className="text-center py-5"><span className="spinner-border text-primary" /></div>
    )

    const maxH = proyData.length ? Math.max(...proyData.map(p => p.total_horas)) : 1

    return (
      <div>
        <div className="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
          <div className="d-flex gap-2 align-items-center">
            <span className="text-muted small">Período:</span>
            {[7, 14, 30].map(n => (
              <button key={n}
                className={`btn btn-sm ${diasProy === n ? 'btn-primary' : 'btn-outline-secondary'}`}
                onClick={() => setDiasProy(n)}>
                {n === 7 ? '7 días' : n === 14 ? '14 días' : '30 días'}
              </button>
            ))}
          </div>
          {proyData.length > 0 && (
            <span className="badge bg-secondary">
              {proyData.length} proyecto{proyData.length !== 1 ? 's' : ''}
              {' · '}
              {fmtH(proyData.reduce((s, p) => s + p.total_horas, 0))} totales
            </span>
          )}
        </div>

        {proyData.length === 0 ? (
          <div className="text-center py-5 text-muted">
            <i className="bi bi-kanban d-block fs-2 mb-2 opacity-25" />
            Sin horas registradas en proyectos activos para el período
          </div>
        ) : (
          <div className="row g-3">
            {proyData.map(proy => {
              const exp = proyExpanded[proy.id] !== false
              const pctProy = maxH > 0 ? (proy.total_horas / maxH * 100) : 0
              return (
                <div key={proy.id} className="col-12 col-xl-6">
                  <div className="card h-100">
                    <div className="card-header py-2 d-flex align-items-center justify-content-between"
                      style={{ cursor: 'pointer' }}
                      onClick={() => setProyExpanded(e => ({ ...e, [proy.id]: !exp }))}>
                      <div>
                        <span className="fw-semibold">{proy.nombre}</span>
                        <span className="badge bg-primary ms-2">{fmtH(proy.total_horas)}</span>
                      </div>
                      <i className={`bi bi-chevron-${exp ? 'up' : 'down'} text-muted`} />
                    </div>
                    <div style={{ height: 4, background: '#e9ecef' }}>
                      <div style={{
                        width: `${pctProy}%`, height: 4,
                        background: '#0d6efd', transition: 'width 0.3s',
                      }} />
                    </div>
                    {exp && (
                      <div className="card-body p-0">
                        <table className="table table-sm mb-0">
                          <thead className="table-light">
                            <tr>
                              <th>Código</th>
                              <th>Tarea</th>
                              <th className="text-end" style={{ width: 60 }}>Horas</th>
                              <th style={{ width: '38%' }}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {proy.tareas.map((t, i) => {
                              const pct = proy.total_horas > 0
                                ? (t.horas / proy.total_horas * 100) : 0
                              const barColor = COLOR_GRUPO[t.cat_grupo] || '#0d6efd'
                              return (
                                <tr key={i}>
                                  <td>
                                    <span className="badge text-white"
                                      style={{ background: barColor, fontSize: '0.68rem' }}>
                                      {t.cat_codigo}
                                    </span>
                                  </td>
                                  <td className="text-truncate"
                                    style={{ maxWidth: 140, fontSize: '0.78rem' }}
                                    title={t.cat_descripcion}>
                                    {t.cat_descripcion}
                                  </td>
                                  <td className="text-end fw-semibold" style={{ fontSize: '0.82rem' }}>
                                    {fmtH(t.horas)}
                                  </td>
                                  <td>
                                    <div className="d-flex align-items-center gap-1">
                                      <div style={{
                                        flex: 1, height: 8,
                                        background: '#e9ecef', borderRadius: 4,
                                      }}>
                                        <div style={{
                                          width: `${pct}%`, height: 8,
                                          background: barColor, borderRadius: 4,
                                        }} />
                                      </div>
                                      <small className="text-muted"
                                        style={{ minWidth: 28, fontSize: '0.65rem' }}>
                                        {Math.round(pct)}%
                                      </small>
                                    </div>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="mb-3">
        <h4 className="mb-0 fw-bold">Partes Diarios</h4>
        <small className="text-muted">Form 42 · Carga y seguimiento de horas</small>
      </div>

      <ul className="nav nav-tabs mb-3">
        {[
          { id: 'cargar',    icon: 'file-earmark-plus', label: 'Cargar Parte' },
          { id: 'semana',    icon: 'calendar3',          label: 'Estado 7 días' },
          { id: 'ultimos7',  icon: 'list-check',         label: 'Corregir partes' },
          { id: 'proyectos', icon: 'kanban',              label: 'Proyectos' },
        ].map(t => (
          <li key={t.id} className="nav-item">
            <button className={`nav-link ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}>
              <i className={`bi bi-${t.icon} me-1`} />{t.label}
            </button>
          </li>
        ))}
      </ul>

      {tab === 'cargar'    && TabCargar()}
      {tab === 'semana'    && TabSemana()}
      {tab === 'ultimos7'  && TabUltimos7()}
      {tab === 'proyectos' && TabProyectos()}
    </div>
  )
}
