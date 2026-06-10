import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'

const FORM_NUEVO = { username:'', nombre:'', email:'', password:'', rol:'solo_lectura' }

const MODULOS = ['stock','compras','ventas','proyectos','produccion','finanzas','mantenimiento','administracion','usuarios']
const MOD_LABEL = {
  stock:'Stock', compras:'Compras', ventas:'Ventas', proyectos:'Proyectos',
  produccion:'Producción', finanzas:'Finanzas', mantenimiento:'Mantenimiento',
  administracion:'Administración', usuarios:'Usuarios',
}

export default function Usuarios() {
  const [usuarios, setUsuarios]           = useState([])
  const [todosLosRoles, setTodosLosRoles] = useState([])
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState('')

  // Modal nuevo usuario
  const [showNuevo, setShowNuevo]     = useState(false)
  const [formNuevo, setFormNuevo]     = useState(FORM_NUEVO)
  const [savingNuevo, setSavingNuevo] = useState(false)
  const [errNuevo, setErrNuevo]       = useState('')

  // Modal contraseña
  const [userPass, setUserPass]       = useState(null)
  const [nuevaPass, setNuevaPass]     = useState('')
  const [savingPass, setSavingPass]   = useState(false)
  const [errPass, setErrPass]         = useState('')

  // Modal acceso (roles + permisos directos)
  const [userAcceso, setUserAcceso]         = useState(null)
  const [tabAcceso, setTabAcceso]           = useState('roles')
  const [rolesAsignados, setRolesAsignados] = useState([])
  const [savingRoles, setSavingRoles]       = useState(false)
  const [permisosForm, setPermisosForm]     = useState({})
  const [savingPermisos, setSavingPermisos] = useState(false)

  const cargar = useCallback(() => {
    setLoading(true)
    Promise.all([
      api.get('/auth/usuarios'),
      api.get('/roles'),
    ]).then(([u, r]) => {
      setUsuarios(u.data)
      setTodosLosRoles(r.data)
    }).catch(() => setError('No se pudieron cargar los datos'))
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

  /* ── Activar / desactivar ──────────────────────────────────────── */
  const handleActivo = async u => {
    try {
      await api.put(`/auth/usuarios/${u.id}`, { activo: !u.activo })
      setUsuarios(prev => prev.map(x => x.id === u.id ? { ...x, activo: x.activo ? 0 : 1 } : x))
    } catch { alert('Error al cambiar estado') }
  }

  /* ── Abrir modal de acceso (roles + permisos) ──────────────────── */
  const abrirAcceso = async (u, tab = 'roles') => {
    const [rolesResp, permisosResp] = await Promise.all([
      api.get(`/roles/usuario/${u.id}`),
      api.get(`/roles/usuario/${u.id}/permisos`),
    ])
    setRolesAsignados(rolesResp.data.map(x => x.id))
    const directos = permisosResp.data
    setPermisosForm(Object.fromEntries(MODULOS.map(m => [m, {
      activo:   m in directos,
      leer:     directos[m]?.leer    ?? false,
      escribir: directos[m]?.escribir ?? false,
    }])))
    setTabAcceso(tab)
    setUserAcceso(u)
  }

  /* ── Guardar roles ─────────────────────────────────────────────── */
  const guardarRoles = async () => {
    setSavingRoles(true)
    try {
      await api.put(`/roles/usuario/${userAcceso.id}`, { roles: rolesAsignados })
      setUserAcceso(null)
    } catch { alert('Error al guardar roles') }
    finally { setSavingRoles(false) }
  }

  /* ── Guardar permisos directos ─────────────────────────────────── */
  const guardarPermisos = async () => {
    setSavingPermisos(true)
    try {
      const body = {}
      for (const [m, v] of Object.entries(permisosForm)) {
        if (v.activo) body[m] = { leer: v.leer, escribir: v.escribir }
      }
      await api.put(`/roles/usuario/${userAcceso.id}/permisos`, body)
      setUserAcceso(null)
    } catch { alert('Error al guardar permisos') }
    finally { setSavingPermisos(false) }
  }

  const toggleRol = id =>
    setRolesAsignados(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

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
                  <td className="text-muted small">{u.email || '—'}</td>
                  <td>
                    <span className={`badge bg-${u.activo ? 'success' : 'secondary'}`}>
                      {u.activo ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td className="text-end">
                    <div className="d-flex gap-2 justify-content-end">
                      {u.rol !== 'admin' && (
                        <button className="btn btn-sm btn-outline-primary" title="Roles y permisos"
                          onClick={() => abrirAcceso(u)}>
                          <i className="bi bi-shield-check" />
                        </button>
                      )}
                      <button className="btn btn-sm btn-outline-secondary" title="Cambiar contraseña"
                        onClick={() => { setUserPass(u); setNuevaPass(''); setErrPass('') }}>
                        <i className="bi bi-key" />
                      </button>
                      <button
                        className={`btn btn-sm btn-outline-${u.activo ? 'danger' : 'success'}`}
                        title={u.activo ? 'Desactivar' : 'Activar'}
                        onClick={() => handleActivo(u)}>
                        <i className={`bi bi-${u.activo ? 'person-x' : 'person-check'}`} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {todosLosRoles.length === 0 && (
        <div className="alert alert-info mt-3 small">
          <i className="bi bi-info-circle me-2" />
          Aún no hay roles definidos. Creá los roles primero en <strong>Configuración → Roles</strong>.
        </div>
      )}

      {/* ── Modal: Roles y permisos ───────────────────────────────────── */}
      {userAcceso && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.4)' }}>
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  <i className="bi bi-shield-check me-2 text-primary" />
                  Acceso de <strong>{userAcceso.username}</strong>
                </h5>
                <button type="button" className="btn-close" onClick={() => setUserAcceso(null)} />
              </div>
              <div className="modal-body">
                <ul className="nav nav-tabs mb-3">
                  <li className="nav-item">
                    <button className={`nav-link ${tabAcceso === 'roles' ? 'active' : ''}`}
                      onClick={() => setTabAcceso('roles')}>
                      <i className="bi bi-people me-2" />Roles
                    </button>
                  </li>
                  <li className="nav-item">
                    <button className={`nav-link ${tabAcceso === 'permisos' ? 'active' : ''}`}
                      onClick={() => setTabAcceso('permisos')}>
                      <i className="bi bi-toggles me-2" />Permisos directos
                    </button>
                  </li>
                </ul>

                {/* Tab: Roles */}
                {tabAcceso === 'roles' && (
                  todosLosRoles.length === 0 ? (
                    <p className="text-muted">No hay roles definidos. Creá roles en la sección <strong>Roles</strong> primero.</p>
                  ) : (
                    <>
                      <p className="text-muted small mb-3">
                        Seleccioná uno o más roles. Los permisos del usuario serán la unión de todos los roles asignados.
                      </p>
                      <div className="row g-2">
                        {todosLosRoles.map(r => {
                          const asignado = rolesAsignados.includes(r.id)
                          const modsCon  = Object.entries(r.permisos ?? {}).filter(([,v]) => v.leer || v.escribir)
                          return (
                            <div key={r.id} className="col-12 col-sm-6">
                              <div
                                className={`card border-2 h-100 ${asignado ? 'border-primary bg-primary bg-opacity-10' : 'border-light'}`}
                                style={{ cursor: 'pointer' }}
                                onClick={() => toggleRol(r.id)}>
                                <div className="card-body py-2 px-3">
                                  <div className="d-flex align-items-center gap-2">
                                    <input type="checkbox" className="form-check-input" readOnly checked={asignado} />
                                    <span className="fw-semibold small">{r.nombre}</span>
                                  </div>
                                  {modsCon.length > 0 && (
                                    <div className="mt-1" style={{ fontSize: '0.72rem', color: '#6c757d' }}>
                                      {modsCon.map(([mod, v]) => (
                                        <span key={mod} className="me-2">
                                          {MOD_LABEL[mod] ?? mod} {v.escribir ? '✏️' : '👁️'}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )
                )}

                {/* Tab: Permisos directos */}
                {tabAcceso === 'permisos' && (
                  <>
                    <p className="text-muted small mb-3">
                      Los permisos directos <strong>sobreescriben</strong> los que otorgan los roles.
                      Activá solo los módulos que necesiten una excepción específica para este usuario.
                    </p>
                    <div className="table-responsive">
                      <table className="table table-sm align-middle mb-0">
                        <thead className="table-light">
                          <tr>
                            <th>Módulo</th>
                            <th className="text-center" style={{width:120}}>Override</th>
                            <th className="text-center" style={{width:80}}>Leer</th>
                            <th className="text-center" style={{width:80}}>Escribir</th>
                          </tr>
                        </thead>
                        <tbody>
                          {MODULOS.map(m => {
                            const v = permisosForm[m] ?? { activo: false, leer: false, escribir: false }
                            return (
                              <tr key={m} className={v.activo ? '' : 'text-muted'}>
                                <td className="fw-medium">{MOD_LABEL[m]}</td>
                                <td className="text-center">
                                  <div className="form-check form-switch d-flex justify-content-center m-0">
                                    <input type="checkbox" className="form-check-input" role="switch"
                                      checked={v.activo}
                                      onChange={e => setPerm(m, 'activo', e.target.checked)} />
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
                  </>
                )}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary btn-sm" onClick={() => setUserAcceso(null)}>Cancelar</button>
                {tabAcceso === 'roles' && (
                  <button className="btn btn-primary btn-sm" onClick={guardarRoles} disabled={savingRoles}>
                    {savingRoles && <span className="spinner-border spinner-border-sm me-2" />}
                    Guardar roles
                  </button>
                )}
                {tabAcceso === 'permisos' && (
                  <button className="btn btn-primary btn-sm" onClick={guardarPermisos} disabled={savingPermisos}>
                    {savingPermisos && <span className="spinner-border spinner-border-sm me-2" />}
                    Guardar permisos
                  </button>
                )}
              </div>
            </div>
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
                    <label className="form-label small fw-medium">Rol base</label>
                    <select className="form-select" value={formNuevo.rol}
                      onChange={e => setFormNuevo(p => ({ ...p, rol: e.target.value }))}>
                      <option value="solo_lectura">Solo lectura</option>
                      <option value="admin">Administrador</option>
                    </select>
                    <div className="form-text">Los permisos se asignan vía roles</div>
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
