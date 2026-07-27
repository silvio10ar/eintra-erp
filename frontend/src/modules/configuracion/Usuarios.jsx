import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'

const FORM_NUEVO = { username:'', nombre:'', email:'', password:'', rol:'solo_lectura', rrhh_empleado_id:'' }

export default function Usuarios() {
  const [usuarios, setUsuarios]   = useState([])
  const [empleados, setEmpleados] = useState([])
  const [modulos, setModulos]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')

  // Modal nuevo usuario
  const [showNuevo, setShowNuevo]     = useState(false)
  const [formNuevo, setFormNuevo]     = useState(FORM_NUEVO)
  const [savingNuevo, setSavingNuevo] = useState(false)
  const [errNuevo, setErrNuevo]       = useState('')

  // Modal contraseña
  const [userPass, setUserPass]     = useState(null)
  const [nuevaPass, setNuevaPass]   = useState('')
  const [savingPass, setSavingPass] = useState(false)
  const [errPass, setErrPass]       = useState('')

  // Modal editar
  const [userEdit, setUserEdit]       = useState(null)
  const [formEdit, setFormEdit]       = useState({})
  const [savingEdit, setSavingEdit]   = useState(false)
  const [errEdit, setErrEdit]         = useState('')

  // Modal permisos
  const [userPermisos, setUserPermisos]       = useState(null)
  const [permisosForm, setPermisosForm]       = useState({})
  const [puestosAsignados, setPuestosAsignados] = useState(new Set())
  const [savingPermisos, setSavingPermisos]   = useState(false)

  // Catálogo de puestos (plantillas de acceso, asignables 1 o más por usuario)
  const [puestos, setPuestos]             = useState([])
  const [showPuestosAdmin, setShowPuestosAdmin] = useState(false)
  const [puestoForm, setPuestoForm]       = useState(null) // null=cerrado, { id, nombre, modulos }
  const [savingPuesto, setSavingPuesto]   = useState(false)
  const [errPuesto, setErrPuesto]         = useState('')

  // Modal historial de conexiones
  const [userHistorial, setUserHistorial]     = useState(null)
  const [historial, setHistorial]             = useState([])
  const [loadingHistorial, setLoadingHistorial] = useState(false)

  const cargar = useCallback(() => {
    setLoading(true)
    Promise.all([
      api.get('/auth/usuarios'),
      api.get('/rrhh/empleados'),
      api.get('/auth/modulos'),
      api.get('/auth/puestos'),
    ])
      .then(([ru, re, rm, rp]) => {
        setUsuarios(ru.data)
        setEmpleados(re.data.filter(e => e.activo))
        setModulos(rm.data)
        setPuestos(rp.data)
      })
      .catch(() => setError('No se pudieron cargar los usuarios'))
      .finally(() => setLoading(false))
  }, [])

  const recargarPuestos = () => api.get('/auth/puestos').then(r => setPuestos(r.data))

  useEffect(() => { cargar() }, [cargar])

  /* ── Crear usuario ─────────────────────────────────────────────── */
  const handleCrear = async e => {
    e.preventDefault()
    setSavingNuevo(true); setErrNuevo('')
    try {
      await api.post('/auth/usuarios', formNuevo)
      setShowNuevo(false); setFormNuevo(FORM_NUEVO); cargar()
    } catch (err) {
      setErrNuevo(err.response?.data?.error ?? 'Error al crear usuario')
    } finally { setSavingNuevo(false) }
  }

  /* ── Cambiar contraseña ────────────────────────────────────────── */
  const handleCambiarPass = async e => {
    e.preventDefault()
    setSavingPass(true); setErrPass('')
    try {
      await api.put(`/auth/usuarios/${userPass.id}/password`, { password: nuevaPass })
      setUserPass(null); setNuevaPass('')
    } catch (err) {
      setErrPass(err.response?.data?.error ?? 'Error al cambiar contraseña')
    } finally { setSavingPass(false) }
  }

  /* ── Editar usuario ───────────────────────────────────────────── */
  const abrirEdit = u => {
    setFormEdit({ nombre: u.nombre, email: u.email || '', rol: u.rol, rrhh_empleado_id: u.rrhh_empleado_id || '' })
    setErrEdit('')
    setUserEdit(u)
  }

  const handleEditar = async e => {
    e.preventDefault()
    setSavingEdit(true); setErrEdit('')
    try {
      await api.put(`/auth/usuarios/${userEdit.id}`, formEdit)
      setUserEdit(null)
      cargar()
    } catch (err) {
      setErrEdit(err.response?.data?.error ?? 'Error al guardar')
    } finally { setSavingEdit(false) }
  }

  /* ── Eliminar usuario ──────────────────────────────────────────── */
  const handleEliminar = async u => {
    if (!window.confirm(`¿Eliminar al usuario "${u.username}"? Esta acción no se puede deshacer.`)) return
    try {
      await api.delete(`/auth/usuarios/${u.id}`)
      cargar()
    } catch (err) {
      alert(err.response?.data?.error ?? 'Error al eliminar')
    }
  }

  /* ── Impersonar usuario ─────────────────────────────────────────── */
  const impersonar = async u => {
    try {
      const r = await api.post(`/auth/impersonate/${u.id}`)
      const key = `_imp_${Date.now()}`
      localStorage.setItem(key, JSON.stringify(r.data))
      window.open(`${window.location.origin}/?_imp=${key}`, '_blank')
    } catch (err) {
      alert(err.response?.data?.error ?? 'Error al impersonar')
    }
  }

  /* ── Activar / desactivar ──────────────────────────────────────── */
  const handleActivo = async u => {
    try {
      await api.put(`/auth/usuarios/${u.id}`, { activo: !u.activo })
      setUsuarios(prev => prev.map(x => x.id === u.id ? { ...x, activo: x.activo ? 0 : 1 } : x))
    } catch { alert('Error al cambiar estado') }
  }

  /* ── Abrir modal de permisos ───────────────────────────────────── */
  const abrirPermisos = async u => {
    const [resp, respPuestos] = await Promise.all([
      api.get(`/auth/usuarios/${u.id}/permisos`),
      api.get(`/auth/usuarios/${u.id}/puestos`),
    ])
    const directos = resp.data
    setPermisosForm(Object.fromEntries(modulos.map(({ id: m }) => [m, {
      activo:   m in directos,
      leer:     directos[m]?.leer     ?? false,
      escribir: directos[m]?.escribir ?? false,
    }])))
    setPuestosAsignados(new Set(respPuestos.data))
    setUserPermisos(u)
  }

  /* ── Puestos asignados al usuario (uno o más, se suman) ─────────── */
  const togglePuesto = id => {
    setPuestosAsignados(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // Módulos que el usuario ya recibe por los puestos tildados (para mostrarlo junto a los permisos individuales)
  const modulosDesdePuestos = () => {
    const map = {}
    for (const pid of puestosAsignados) {
      const p = puestos.find(x => x.id === pid)
      if (!p) continue
      for (const [m, v] of Object.entries(p.modulos)) {
        const cur = map[m] || { leer:false, escribir:false, nombres:[] }
        map[m] = { leer: cur.leer||v.leer, escribir: cur.escribir||v.escribir, nombres: [...cur.nombres, p.nombre] }
      }
    }
    return map
  }

  /* ── Guardar permisos (puestos asignados + permisos individuales) ── */
  const guardarPermisos = async () => {
    setSavingPermisos(true)
    try {
      const body = {}
      for (const [m, v] of Object.entries(permisosForm)) {
        if (!v.activo) continue
        // No guardar submodulo si su padre ya está activo (la herencia lo cubre)
        const padreId = modulos.find(mod => mod.id === m)?.padre
        if (padreId && permisosForm[padreId]?.activo) continue
        body[m] = { leer: v.leer, escribir: v.escribir }
      }
      await Promise.all([
        api.put(`/auth/usuarios/${userPermisos.id}/permisos`, body),
        api.put(`/auth/usuarios/${userPermisos.id}/puestos`, { puesto_ids: [...puestosAsignados] }),
      ])
      setUserPermisos(null)
    } catch { alert('Error al guardar permisos') }
    finally { setSavingPermisos(false) }
  }

  const setPerm = (m, field, val) =>
    setPermisosForm(p => ({ ...p, [m]: { ...p[m], [field]: val } }))

  /* ── Catálogo de puestos: crear / editar / eliminar ──────────────── */
  const nuevoPuestoForm = () => { setErrPuesto(''); setPuestoForm({ id: null, nombre: '', modulos: {} }) }
  const editarPuestoForm = p => { setErrPuesto(''); setPuestoForm({ id: p.id, nombre: p.nombre, modulos: { ...p.modulos } }) }

  const setPuestoModulo = (m, field, val) =>
    setPuestoForm(p => ({
      ...p,
      modulos: { ...p.modulos, [m]: { leer: false, escribir: false, ...p.modulos[m], [field]: val } },
    }))

  const guardarPuesto = async () => {
    setSavingPuesto(true); setErrPuesto('')
    try {
      const body = { nombre: puestoForm.nombre, modulos: puestoForm.modulos }
      if (puestoForm.id) await api.put(`/auth/puestos/${puestoForm.id}`, body)
      else await api.post('/auth/puestos', body)
      setPuestoForm(null)
      recargarPuestos()
    } catch (err) {
      setErrPuesto(err.response?.data?.error ?? 'Error al guardar el puesto')
    } finally { setSavingPuesto(false) }
  }

  const eliminarPuesto = async p => {
    if (!window.confirm(`¿Eliminar el puesto "${p.nombre}"? Se quitará de los empleados que lo tengan asignado.`)) return
    try {
      await api.delete(`/auth/puestos/${p.id}`)
      recargarPuestos()
    } catch { alert('Error al eliminar el puesto') }
  }

  /* ── Historial de conexiones ─────────────────────────────────────── */
  const abrirHistorial = async u => {
    setUserHistorial(u)
    setLoadingHistorial(true)
    try {
      const { data } = await api.get(`/auth/usuarios/${u.id}/login-log`)
      setHistorial(data)
    } catch {
      setHistorial([])
    } finally {
      setLoadingHistorial(false)
    }
  }

  const formatFecha = f => f ? new Date(f.replace(' ', 'T')).toLocaleString('es-AR') : '—'

  if (loading) return (
    <div className="d-flex align-items-center justify-content-center" style={{ minHeight: '50vh' }}>
      <div className="spinner-border text-secondary" />
    </div>
  )
  if (error) return <div className="alert alert-danger">{error}</div>

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h5 className="mb-0 fw-bold">Usuarios</h5>
          <small className="text-muted">Gestión de acceso al sistema</small>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => { setShowNuevo(true); setErrNuevo('') }}>
          <i className="bi bi-person-plus me-2" />Nuevo usuario
        </button>
      </div>

      <div className="card border-0 shadow-sm">
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0">
            <thead className="table-light">
              <tr>
                <th>Usuario</th>
                <th>Nombre</th>
                <th>Empleado RRHH</th>
                <th>Email</th>
                <th>Estado</th>
                <th>Última conexión</th>
                <th className="text-end">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map(u => (
                <tr key={u.id} className={!u.activo ? 'text-muted' : ''}>
                  <td className="fw-semibold">
                    {u.username}
                    {u.rol === 'admin' && <span className="badge bg-danger ms-2" style={{fontSize:'0.65rem'}}>ADMIN</span>}
                    {u.rol === 'gerencia' && <span className="badge bg-primary ms-2" style={{fontSize:'0.65rem'}}>GERENCIA</span>}
                  </td>
                  <td>{u.nombre}</td>
                  <td className="text-muted small">
                    {u.empleado_nombre
                      ? <><i className="bi bi-person-badge me-1 text-primary" />{u.empleado_nombre}</>
                      : <span className="text-muted fst-italic">—</span>}
                  </td>
                  <td className="text-muted small">{u.email || '—'}</td>
                  <td>
                    <span className={`badge bg-${u.activo ? 'success' : 'secondary'}`}>
                      {u.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="text-muted small">{formatFecha(u.ultimo_login)}</td>
                  <td className="text-end">
                    <div className="d-flex gap-2 justify-content-end">
                      <button className="btn btn-sm btn-outline-secondary" title="Historial de conexiones"
                        onClick={() => abrirHistorial(u)}>
                        <i className="bi bi-clock-history" />
                      </button>
                      {u.activo && (
                        <button className="btn btn-sm btn-outline-info" title={`Operar como ${u.username}`}
                          onClick={() => impersonar(u)}>
                          <i className="bi bi-box-arrow-in-right" />
                        </button>
                      )}
                      {u.rol !== 'admin' && (
                        <button className="btn btn-sm btn-outline-primary" title="Permisos"
                          onClick={() => abrirPermisos(u)}>
                          <i className="bi bi-shield-check" />
                        </button>
                      )}
                      <button className="btn btn-sm btn-outline-secondary" title="Editar"
                        onClick={() => abrirEdit(u)}>
                        <i className="bi bi-pencil" />
                      </button>
                      <button className="btn btn-sm btn-outline-secondary" title="Cambiar contraseña"
                        onClick={() => { setUserPass(u); setNuevaPass(''); setErrPass('') }}>
                        <i className="bi bi-key" />
                      </button>
                      <button
                        className={`btn btn-sm btn-outline-${u.activo ? 'warning' : 'success'}`}
                        title={u.activo ? 'Desactivar' : 'Activar'}
                        onClick={() => handleActivo(u)}>
                        <i className={`bi bi-${u.activo ? 'person-dash' : 'person-check'}`} />
                      </button>
                      <button className="btn btn-sm btn-outline-danger" title="Eliminar"
                        onClick={() => handleEliminar(u)}>
                        <i className="bi bi-trash" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Modal: Permisos de usuario ────────────────────────────────── */}
      {userPermisos && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.4)' }}>
          <div className="modal-dialog modal-md">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className="bi bi-shield-check me-2 text-primary" />
                  Permisos de <strong>{userPermisos.username}</strong>
                </h5>
                <button type="button" className="btn-close" onClick={() => setUserPermisos(null)} />
              </div>
              <div className="px-3 pt-3">
                <div className="d-flex justify-content-between align-items-center mb-1">
                  <label className="form-label small fw-medium mb-0">Puestos asignados</label>
                  <button type="button" className="btn btn-link btn-sm p-0" onClick={() => setShowPuestosAdmin(true)}>
                    <i className="bi bi-gear me-1" />Gestionar puestos
                  </button>
                </div>
                {puestos.length === 0
                  ? <p className="text-muted small fst-italic">No hay puestos definidos todavía — creá uno con "Gestionar puestos".</p>
                  : (
                    <div className="d-flex flex-wrap gap-2 mb-1">
                      {puestos.map(p => (
                        <div key={p.id} className="form-check form-check-inline border rounded px-2 py-1 m-0"
                          style={{ background: puestosAsignados.has(p.id) ? '#e7f1ff' : 'transparent' }}>
                          <input className="form-check-input" type="checkbox" id={`puesto-${p.id}`}
                            checked={puestosAsignados.has(p.id)} onChange={() => togglePuesto(p.id)} />
                          <label className="form-check-label small" htmlFor={`puesto-${p.id}`}>{p.nombre}</label>
                        </div>
                      ))}
                    </div>
                  )}
                <div className="form-text">Un empleado puede tener uno o más puestos a la vez — sus accesos se suman. Además podés ajustar permisos individuales módulo por módulo abajo.</div>
              </div>
              <div className="modal-body p-0">
                <table className="table table-sm align-middle mb-0">
                  <thead className="table-light">
                    <tr>
                      <th className="ps-3">Módulo</th>
                      <th className="text-center" style={{width:80}}>Acceso</th>
                      <th className="text-center" style={{width:80}}>Leer</th>
                      <th className="text-center" style={{width:80}}>Escribir</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => { const desdePuestos = modulosDesdePuestos(); return modulos.map(({ id: m, label, padre: padreId }) => {
                      const v = permisosForm[m] ?? { activo: false, leer: false, escribir: false }
                      const padreActivo = padreId ? (permisosForm[padreId]?.activo ?? false) : false
                      const pV = padreActivo ? (permisosForm[padreId] ?? {}) : null
                      const viaPuesto = desdePuestos[m]

                      if (padreActivo) {
                        // Submodulo cuyo padre está activo → mostrar como "incluido"
                        return (
                          <tr key={m} style={{ background: '#f8f9fa' }}>
                            <td className="ps-3 text-muted" style={{ paddingLeft: '2.25rem' }}>
                              <span className="me-1 text-muted">└</span>
                              <i className="bi bi-diagram-2 me-1 text-muted" style={{ fontSize: '0.72rem' }} />
                              {label}
                              <span className="ms-2 badge bg-secondary fw-normal" style={{ fontSize: '0.65rem' }}>
                                incluido
                              </span>
                            </td>
                            <td className="text-center text-muted" style={{ fontSize: '0.72rem' }}>auto</td>
                            <td className="text-center">
                              <input type="checkbox" className="form-check-input" checked={pV?.leer ?? false} disabled />
                            </td>
                            <td className="text-center">
                              <input type="checkbox" className="form-check-input" checked={pV?.escribir ?? false} disabled />
                            </td>
                          </tr>
                        )
                      }

                      // Módulo normal (padre o submodulo independiente)
                      return (
                        <tr key={m} className={v.activo ? '' : 'text-muted'}>
                          <td className="ps-3 fw-medium">
                            {padreId && (
                              <span className="me-1 text-muted" style={{ fontSize: '0.75rem' }}>└</span>
                            )}
                            {label}
                            {padreId && (
                              <span className="ms-1 text-muted" style={{ fontSize: '0.7rem' }}>
                                (submódulo de {modulos.find(mod => mod.id === padreId)?.label})
                              </span>
                            )}
                            {viaPuesto && (
                              <span className="ms-2 badge bg-info-subtle text-info-emphasis fw-normal" style={{ fontSize: '0.65rem' }}
                                title={`Ya incluido vía puesto: ${viaPuesto.nombres.join(', ')}`}>
                                <i className="bi bi-briefcase me-1" />{viaPuesto.nombres.join(', ')}
                              </span>
                            )}
                          </td>
                          <td className="text-center">
                            <div className="form-check form-switch d-flex justify-content-center m-0">
                              <input type="checkbox" className="form-check-input" role="switch"
                                checked={v.activo}
                                onChange={e => {
                                  const on = e.target.checked
                                  setPermisosForm(p => ({ ...p, [m]: { activo: on, leer: on, escribir: false } }))
                                }} />
                            </div>
                          </td>
                          <td className="text-center">
                            <input type="checkbox" className="form-check-input"
                              checked={v.leer}
                              disabled={!v.activo}
                              onChange={e => setPerm(m, 'leer', e.target.checked)} />
                          </td>
                          <td className="text-center">
                            <input type="checkbox" className="form-check-input"
                              checked={v.escribir}
                              disabled={!v.activo}
                              onChange={e => setPerm(m, 'escribir', e.target.checked)} />
                          </td>
                        </tr>
                      )
                    }) })()}
                  </tbody>
                </table>
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary btn-sm" onClick={() => setUserPermisos(null)}>Cancelar</button>
                <button className="btn btn-primary btn-sm" onClick={guardarPermisos} disabled={savingPermisos}>
                  {savingPermisos && <span className="spinner-border spinner-border-sm me-2" />}
                  Guardar permisos
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Gestionar puestos (catálogo) ─────────────────────── */}
      {showPuestosAdmin && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.4)' }}>
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className="bi bi-briefcase me-2 text-primary" />
                  Puestos (catálogo de accesos)
                </h5>
                <button type="button" className="btn-close" onClick={() => { setShowPuestosAdmin(false); setPuestoForm(null) }} />
              </div>
              <div className="modal-body">
                {!puestoForm ? (
                  <>
                    <div className="d-flex justify-content-end mb-2">
                      <button className="btn btn-primary btn-sm" onClick={nuevoPuestoForm}>
                        <i className="bi bi-plus-lg me-1" />Nuevo puesto
                      </button>
                    </div>
                    <table className="table table-sm align-middle mb-0">
                      <thead className="table-light">
                        <tr>
                          <th>Puesto</th>
                          <th>Módulos</th>
                          <th className="text-end">Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {puestos.length === 0 && (
                          <tr><td colSpan={3} className="text-center text-muted py-3">Sin puestos definidos</td></tr>
                        )}
                        {puestos.map(p => (
                          <tr key={p.id}>
                            <td className="fw-medium">{p.nombre}</td>
                            <td>
                              {Object.keys(p.modulos).length === 0
                                ? <span className="text-muted fst-italic small">sin módulos</span>
                                : Object.entries(p.modulos).map(([m, v]) => (
                                    <span key={m} className="badge bg-light text-dark border me-1 mb-1 fw-normal">
                                      {modulos.find(mod => mod.id === m)?.label ?? m}
                                      <span className="text-muted"> ({v.leer ? 'L' : ''}{v.escribir ? 'E' : ''})</span>
                                    </span>
                                  ))}
                            </td>
                            <td className="text-end">
                              <button className="btn btn-sm btn-outline-secondary me-1" title="Editar"
                                onClick={() => editarPuestoForm(p)}>
                                <i className="bi bi-pencil" />
                              </button>
                              <button className="btn btn-sm btn-outline-danger" title="Eliminar"
                                onClick={() => eliminarPuesto(p)}>
                                <i className="bi bi-trash" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                ) : (
                  <>
                    {errPuesto && <div className="alert alert-danger py-2 small">{errPuesto}</div>}
                    <label className="form-label small fw-medium">Nombre del puesto *</label>
                    <input className="form-control form-control-sm mb-3" value={puestoForm.nombre}
                      onChange={e => setPuestoForm(p => ({ ...p, nombre: e.target.value }))} />
                    <table className="table table-sm align-middle mb-0">
                      <thead className="table-light">
                        <tr>
                          <th>Módulo</th>
                          <th className="text-center" style={{width:80}}>Leer</th>
                          <th className="text-center" style={{width:80}}>Escribir</th>
                        </tr>
                      </thead>
                      <tbody>
                        {modulos.map(({ id: m, label }) => {
                          const v = puestoForm.modulos[m] ?? { leer: false, escribir: false }
                          return (
                            <tr key={m}>
                              <td>{label}</td>
                              <td className="text-center">
                                <input type="checkbox" className="form-check-input" checked={v.leer}
                                  onChange={e => setPuestoModulo(m, 'leer', e.target.checked)} />
                              </td>
                              <td className="text-center">
                                <input type="checkbox" className="form-check-input" checked={v.escribir}
                                  onChange={e => setPuestoModulo(m, 'escribir', e.target.checked)} />
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
              <div className="modal-footer">
                {puestoForm ? (
                  <>
                    <button className="btn btn-secondary btn-sm" onClick={() => setPuestoForm(null)}>Volver</button>
                    <button className="btn btn-primary btn-sm" onClick={guardarPuesto} disabled={savingPuesto || !puestoForm.nombre.trim()}>
                      {savingPuesto && <span className="spinner-border spinner-border-sm me-2" />}
                      Guardar puesto
                    </button>
                  </>
                ) : (
                  <button className="btn btn-secondary btn-sm" onClick={() => setShowPuestosAdmin(false)}>Cerrar</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Historial de conexiones ─────────────────────────── */}
      {userHistorial && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.4)' }}>
          <div className="modal-dialog modal-md">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className="bi bi-clock-history me-2 text-primary" />
                  Conexiones de <strong>{userHistorial.username}</strong>
                </h5>
                <button type="button" className="btn-close" onClick={() => setUserHistorial(null)} />
              </div>
              <div className="modal-body p-0" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
                {loadingHistorial ? (
                  <div className="d-flex justify-content-center py-4">
                    <span className="spinner-border spinner-border-sm" />
                  </div>
                ) : historial.length === 0 ? (
                  <p className="text-muted text-center py-4 mb-0">Sin conexiones registradas</p>
                ) : (
                  <table className="table table-sm align-middle mb-0">
                    <thead className="table-light">
                      <tr>
                        <th className="ps-3">Fecha y hora</th>
                        <th>IP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historial.map(h => (
                        <tr key={h.id}>
                          <td className="ps-3">{formatFecha(h.fecha)}</td>
                          <td className="text-muted small">{h.ip || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary btn-sm" onClick={() => setUserHistorial(null)}>Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Editar usuario ─────────────────────────────────── */}
      {userEdit && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.4)' }}>
          <div className="modal-dialog">
            <form className="modal-content" onSubmit={handleEditar}>
              <div className="modal-header">
                <h5 className="modal-title">Editar — <strong>{userEdit.username}</strong></h5>
                <button type="button" className="btn-close" onClick={() => setUserEdit(null)} />
              </div>
              <div className="modal-body">
                {errEdit && <div className="alert alert-danger py-2 small">{errEdit}</div>}
                <div className="row g-3">
                  <div className="col-12">
                    <label className="form-label small fw-medium">Nombre completo *</label>
                    <input className="form-control" value={formEdit.nombre} required
                      onChange={e => setFormEdit(p => ({ ...p, nombre: e.target.value }))} />
                  </div>
                  <div className="col-6">
                    <label className="form-label small fw-medium">Email</label>
                    <input type="email" className="form-control" value={formEdit.email}
                      onChange={e => setFormEdit(p => ({ ...p, email: e.target.value }))} />
                  </div>
                  <div className="col-6">
                    <label className="form-label small fw-medium">Tipo</label>
                    <select className="form-select" value={formEdit.rol}
                      onChange={e => setFormEdit(p => ({ ...p, rol: e.target.value }))}>
                      <option value="solo_lectura">Usuario normal</option>
                      <option value="gerencia">Gerencia</option>
                      <option value="admin">Administrador</option>
                    </select>
                  </div>
                  <div className="col-12">
                    <label className="form-label small fw-medium">Empleado RRHH asociado</label>
                    <select className="form-select" value={formEdit.rrhh_empleado_id}
                      onChange={e => setFormEdit(p => ({ ...p, rrhh_empleado_id: e.target.value }))}>
                      <option value="">— Sin asociar —</option>
                      {empleados.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                    </select>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setUserEdit(null)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={savingEdit}>
                  {savingEdit && <span className="spinner-border spinner-border-sm me-2" />}
                  Guardar cambios
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Nuevo usuario ───────────────────────────────────── */}
      {showNuevo && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.4)' }}>
          <div className="modal-dialog">
            <form className="modal-content" onSubmit={handleCrear}>
              <div className="modal-header">
                <h5 className="modal-title">Nuevo usuario</h5>
                <button type="button" className="btn-close" onClick={() => setShowNuevo(false)} />
              </div>
              <div className="modal-body">
                {errNuevo && <div className="alert alert-danger py-2 small">{errNuevo}</div>}
                <div className="row g-3">
                  <div className="col-6">
                    <label className="form-label small fw-medium">Usuario *</label>
                    <input className="form-control" value={formNuevo.username} required
                      onChange={e => setFormNuevo(p => ({ ...p, username: e.target.value }))} />
                  </div>
                  <div className="col-6">
                    <label className="form-label small fw-medium">Contraseña *</label>
                    <input type="password" className="form-control" value={formNuevo.password} required minLength={6}
                      onChange={e => setFormNuevo(p => ({ ...p, password: e.target.value }))} />
                  </div>
                  <div className="col-12">
                    <label className="form-label small fw-medium">Nombre completo *</label>
                    <input className="form-control" value={formNuevo.nombre} required
                      onChange={e => setFormNuevo(p => ({ ...p, nombre: e.target.value }))} />
                  </div>
                  <div className="col-6">
                    <label className="form-label small fw-medium">Email</label>
                    <input type="email" className="form-control" value={formNuevo.email}
                      onChange={e => setFormNuevo(p => ({ ...p, email: e.target.value }))} />
                  </div>
                  <div className="col-6">
                    <label className="form-label small fw-medium">Tipo</label>
                    <select className="form-select" value={formNuevo.rol}
                      onChange={e => setFormNuevo(p => ({ ...p, rol: e.target.value }))}>
                      <option value="solo_lectura">Usuario normal</option>
                      <option value="gerencia">Gerencia</option>
                      <option value="admin">Administrador</option>
                    </select>
                    <div className="form-text">Admin accede a todo</div>
                  </div>
                  <div className="col-12">
                    <label className="form-label small fw-medium">Empleado RRHH asociado</label>
                    <select className="form-select" value={formNuevo.rrhh_empleado_id}
                      onChange={e => setFormNuevo(p => ({ ...p, rrhh_empleado_id: e.target.value }))}>
                      <option value="">— Sin asociar —</option>
                      {empleados.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                    </select>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowNuevo(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={savingNuevo}>
                  {savingNuevo && <span className="spinner-border spinner-border-sm me-2" />}
                  Crear usuario
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Cambiar contraseña ──────────────────────────────── */}
      {userPass && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.4)' }}>
          <div className="modal-dialog modal-sm">
            <form className="modal-content" onSubmit={handleCambiarPass}>
              <div className="modal-header">
                <h5 className="modal-title">Cambiar contraseña</h5>
                <button type="button" className="btn-close" onClick={() => setUserPass(null)} />
              </div>
              <div className="modal-body">
                <p className="text-muted small mb-3">Usuario: <strong>{userPass.username}</strong></p>
                {errPass && <div className="alert alert-danger py-2 small">{errPass}</div>}
                <label className="form-label small fw-medium">Nueva contraseña *</label>
                <input type="password" className="form-control" value={nuevaPass} required minLength={6}
                  autoFocus onChange={e => setNuevaPass(e.target.value)} />
                <div className="form-text">Mínimo 6 caracteres</div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setUserPass(null)}>Cancelar</button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={savingPass}>
                  {savingPass && <span className="spinner-border spinner-border-sm me-2" />}
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
