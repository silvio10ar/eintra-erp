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
  const [savingPermisos, setSavingPermisos]   = useState(false)

  const cargar = useCallback(() => {
    setLoading(true)
    Promise.all([
      api.get('/auth/usuarios'),
      api.get('/rrhh/empleados'),
      api.get('/auth/modulos'),
    ])
      .then(([ru, re, rm]) => {
        setUsuarios(ru.data)
        setEmpleados(re.data.filter(e => e.activo))
        setModulos(rm.data)
      })
      .catch(() => setError('No se pudieron cargar los usuarios'))
      .finally(() => setLoading(false))
  }, [])

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

  /* ── Activar / desactivar ──────────────────────────────────────── */
  const handleActivo = async u => {
    try {
      await api.put(`/auth/usuarios/${u.id}`, { activo: !u.activo })
      setUsuarios(prev => prev.map(x => x.id === u.id ? { ...x, activo: x.activo ? 0 : 1 } : x))
    } catch { alert('Error al cambiar estado') }
  }

  /* ── Abrir modal de permisos ───────────────────────────────────── */
  const abrirPermisos = async u => {
    const resp = await api.get(`/auth/usuarios/${u.id}/permisos`)
    const directos = resp.data
    setPermisosForm(Object.fromEntries(modulos.map(({ id: m }) => [m, {
      activo:   m in directos,
      leer:     directos[m]?.leer     ?? false,
      escribir: directos[m]?.escribir ?? false,
    }])))
    setUserPermisos(u)
  }

  /* ── Guardar permisos ──────────────────────────────────────────── */
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
      await api.put(`/auth/usuarios/${userPermisos.id}/permisos`, body)
      setUserPermisos(null)
    } catch { alert('Error al guardar permisos') }
    finally { setSavingPermisos(false) }
  }

  const setPerm = (m, field, val) =>
    setPermisosForm(p => ({ ...p, [m]: { ...p[m], [field]: val } }))

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
                <th className="text-end">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {usuarios.map(u => (
                <tr key={u.id} className={!u.activo ? 'text-muted' : ''}>
                  <td className="fw-semibold">
                    {u.username}
                    {u.rol === 'admin' && <span className="badge bg-danger ms-2" style={{fontSize:'0.65rem'}}>ADMIN</span>}
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
                  <td className="text-end">
                    <div className="d-flex gap-2 justify-content-end">
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
                    {modulos.map(({ id: m, label, padre: padreId }) => {
                      const v = permisosForm[m] ?? { activo: false, leer: false, escribir: false }
                      const padreActivo = padreId ? (permisosForm[padreId]?.activo ?? false) : false
                      const pV = padreActivo ? (permisosForm[padreId] ?? {}) : null

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
                    })}
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
