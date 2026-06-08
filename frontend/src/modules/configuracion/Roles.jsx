import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'

const MODULOS = [
  { key: 'stock',         label: 'Stock'         },
  { key: 'compras',       label: 'Compras'       },
  { key: 'ventas',        label: 'Ventas'        },
  { key: 'proyectos',     label: 'Proyectos'     },
  { key: 'produccion',    label: 'Producción'    },
  { key: 'finanzas',      label: 'Finanzas'      },
  { key: 'mantenimiento',  label: 'Mantenimiento'  },
  { key: 'administracion', label: 'Administración' },
  { key: 'usuarios',       label: 'Usuarios'       },
]

const PERM_VACIO = () => Object.fromEntries(MODULOS.map(m => [m.key, { leer: false, escribir: false }]))

export default function Roles() {
  const [roles, setRoles]           = useState([])
  const [seleccionado, setSeleccionado] = useState(null)
  const [permisos, setPermisos]     = useState(PERM_VACIO())
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(false)
  const [msg, setMsg]               = useState(null) // { tipo, texto }

  // Modal nuevo rol
  const [showNuevo, setShowNuevo]   = useState(false)
  const [nombreNuevo, setNombreNuevo] = useState('')
  const [descNuevo, setDescNuevo]   = useState('')
  const [creando, setCreando]       = useState(false)

  const cargar = useCallback(() => {
    setLoading(true)
    api.get('/roles').then(r => {
      setRoles(r.data)
      if (seleccionado) {
        const actual = r.data.find(x => x.id === seleccionado.id)
        if (actual) aplicarRol(actual)
      }
    }).finally(() => setLoading(false))
  }, [seleccionado?.id])

  useEffect(() => {
    api.get('/roles').then(r => {
      setRoles(r.data)
      setLoading(false)
    })
  }, [])

  const aplicarRol = rol => {
    setSeleccionado(rol)
    const p = PERM_VACIO()
    for (const [mod, v] of Object.entries(rol.permisos ?? {})) {
      if (p[mod]) p[mod] = { leer: !!v.leer, escribir: !!v.escribir }
    }
    setPermisos(p)
  }

  const togglePerm = (modulo, tipo) => {
    setPermisos(prev => {
      const next = { ...prev, [modulo]: { ...prev[modulo] } }
      if (tipo === 'leer') {
        next[modulo].leer = !next[modulo].leer
        if (!next[modulo].leer) next[modulo].escribir = false // escribir requiere leer
      } else {
        next[modulo].escribir = !next[modulo].escribir
        if (next[modulo].escribir) next[modulo].leer = true // habilitar leer automáticamente
      }
      return next
    })
  }

  const guardarPermisos = async () => {
    if (!seleccionado) return
    setSaving(true); setMsg(null)
    try {
      await api.put(`/roles/${seleccionado.id}/permisos`, permisos)
      setMsg({ tipo: 'success', texto: 'Permisos guardados correctamente' })
      cargar()
    } catch {
      setMsg({ tipo: 'danger', texto: 'Error al guardar permisos' })
    } finally { setSaving(false) }
  }

  const crearRol = async e => {
    e.preventDefault()
    setCreando(true)
    try {
      await api.post('/roles', { nombre: nombreNuevo, descripcion: descNuevo })
      setShowNuevo(false); setNombreNuevo(''); setDescNuevo('')
      const r = await api.get('/roles')
      setRoles(r.data)
    } catch (err) {
      alert(err.response?.data?.error ?? 'Error al crear rol')
    } finally { setCreando(false) }
  }

  const eliminarRol = async rol => {
    if (!confirm(`¿Eliminar el rol "${rol.nombre}"? Se quitará de todos los usuarios asignados.`)) return
    await api.delete(`/roles/${rol.id}`)
    if (seleccionado?.id === rol.id) { setSeleccionado(null); setPermisos(PERM_VACIO()) }
    const r = await api.get('/roles')
    setRoles(r.data)
  }

  return (
    <>
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h5 className="mb-0 fw-bold">Roles y permisos</h5>
          <small className="text-muted">Definí qué puede hacer cada rol en cada módulo</small>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowNuevo(true)}>
          <i className="bi bi-plus-circle me-2" />Nuevo rol
        </button>
      </div>

      <div className="row g-3">
        {/* ── Lista de roles ────────────────────────────────────── */}
        <div className="col-12 col-md-4 col-lg-3">
          <div className="card border-0 shadow-sm">
            <div className="card-header bg-white fw-semibold small text-secondary text-uppercase" style={{ letterSpacing: '0.5px' }}>
              Roles definidos
            </div>
            {loading ? (
              <div className="text-center py-4"><div className="spinner-border spinner-border-sm" /></div>
            ) : roles.length === 0 ? (
              <div className="text-muted text-center py-4 small">Sin roles. Creá el primero.</div>
            ) : (
              <ul className="list-group list-group-flush">
                {roles.map(r => (
                  <li
                    key={r.id}
                    className={`list-group-item list-group-item-action d-flex justify-content-between align-items-center py-2 px-3 ${seleccionado?.id === r.id ? 'active' : ''}`}
                    style={{ cursor: 'pointer', fontSize: '0.88rem' }}
                    onClick={() => aplicarRol(r)}
                  >
                    <span className="fw-medium">{r.nombre}</span>
                    <button
                      className={`btn btn-sm btn-link p-0 ${seleccionado?.id === r.id ? 'text-white' : 'text-danger'}`}
                      onClick={e => { e.stopPropagation(); eliminarRol(r) }}
                      title="Eliminar rol"
                    >
                      <i className="bi bi-trash" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* ── Matriz de permisos ────────────────────────────────── */}
        <div className="col-12 col-md-8 col-lg-9">
          {!seleccionado ? (
            <div className="card border-0 shadow-sm d-flex align-items-center justify-content-center" style={{ minHeight: 300 }}>
              <div className="text-center text-muted">
                <i className="bi bi-shield-lock" style={{ fontSize: '2.5rem' }} />
                <p className="mt-2 mb-0">Seleccioná un rol para editar sus permisos</p>
              </div>
            </div>
          ) : (
            <div className="card border-0 shadow-sm">
              <div className="card-header bg-white d-flex justify-content-between align-items-center">
                <span className="fw-semibold">{seleccionado.nombre}</span>
                {msg && (
                  <span className={`badge bg-${msg.tipo} ms-2`}>{msg.texto}</span>
                )}
              </div>
              <div className="card-body p-0">
                <table className="table table-hover mb-0" style={{ fontSize: '0.88rem' }}>
                  <thead className="table-light">
                    <tr>
                      <th style={{ width: '50%' }}>Módulo</th>
                      <th className="text-center">
                        <i className="bi bi-eye me-1" />Leer
                      </th>
                      <th className="text-center">
                        <i className="bi bi-pencil me-1" />Modificar
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {MODULOS.map(m => (
                      <tr key={m.key}>
                        <td className="fw-medium">{m.label}</td>
                        <td className="text-center">
                          <div className="form-check d-flex justify-content-center m-0">
                            <input
                              className="form-check-input"
                              type="checkbox"
                              checked={permisos[m.key]?.leer ?? false}
                              onChange={() => togglePerm(m.key, 'leer')}
                            />
                          </div>
                        </td>
                        <td className="text-center">
                          <div className="form-check d-flex justify-content-center m-0">
                            <input
                              className="form-check-input"
                              type="checkbox"
                              checked={permisos[m.key]?.escribir ?? false}
                              onChange={() => togglePerm(m.key, 'escribir')}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="card-footer bg-white text-end">
                <small className="text-muted me-3">
                  <i className="bi bi-info-circle me-1" />
                  Modificar incluye crear, editar y eliminar
                </small>
                <button className="btn btn-primary btn-sm" onClick={guardarPermisos} disabled={saving}>
                  {saving ? <span className="spinner-border spinner-border-sm me-2" /> : null}
                  Guardar permisos
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Modal: nuevo rol ──────────────────────────────────────── */}
      {showNuevo && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.4)' }}>
          <div className="modal-dialog modal-sm">
            <form className="modal-content" onSubmit={crearRol}>
              <div className="modal-header">
                <h5 className="modal-title">Nuevo rol</h5>
                <button type="button" className="btn-close" onClick={() => setShowNuevo(false)} />
              </div>
              <div className="modal-body">
                <div className="mb-3">
                  <label className="form-label small fw-medium">Nombre *</label>
                  <input className="form-control" value={nombreNuevo} required autoFocus
                    onChange={e => setNombreNuevo(e.target.value)} placeholder="ej: Supervisor" />
                </div>
                <div>
                  <label className="form-label small fw-medium">Descripción</label>
                  <input className="form-control" value={descNuevo}
                    onChange={e => setDescNuevo(e.target.value)} placeholder="Opcional" />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowNuevo(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={creando}>Crear</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
