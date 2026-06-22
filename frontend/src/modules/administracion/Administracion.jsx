import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'
import { getPermisos, getUser } from '../../store/authStore'
import Form11 from '../compras/Form11'
import EmpleadoSelect from '../../components/EmpleadoSelect'

const CONDICIONES_PAGO = [
  'TRANSF. BANCARIA', 'CHEQUE', 'EFECTIVO', 'CUENTA CORRIENTE',
  '30 DÍAS', '60 DÍAS', '90 DÍAS', 'CONTADO',
]

const CATEGORIAS_PROVISION = ['Insumos', 'Equipos', 'Servicios', 'Materia Prima', 'Herramientas', 'Logística', 'Otros']
const FRECUENCIAS_EVAL     = ['Anual', 'Semestral', 'Trimestral', 'Por proyecto']

const PROV_VACIO = {
  nombre: '', cuit: '', contacto: '', telefono: '', email: '',
  direccion: '', localidad: '', cp: '', vendedor: '', condicion_pago: 'TRANSF. BANCARIA',
  critico: 0,
  categoria_provision: '', fecha_seleccion: '', frecuencia_evaluacion: 'Anual',
  responsable_seleccion: '', responsable_evaluacion: '',
}

const CLI_VACIO = {
  nombre: '', cuit: '', contacto: '', telefono: '', email: '',
  direccion: '', localidad: '', cp: '', condicion_pago: '',
}

export default function Administracion() {
  const user      = getUser()
  const permisos  = getPermisos()
  const canWrite  = user?.rol === 'admin' || !!permisos?.compras?.escribir || !!permisos?.administracion?.escribir

  const [tab, setTab]         = useState('proveedores')
  const [provsList, setProvsList] = useState([])

  // Proveedores para Form11 (cargados al entrar en esa pestaña)
  useEffect(() => {
    if (tab === 'form11') {
      api.get('/compras/proveedores').then(r => setProvsList(r.data)).catch(() => {})
    }
  }, [tab])

  return (
    <div>
      <div className="d-flex align-items-center mb-3">
        <h4 className="mb-0 fw-bold">
          <i className="bi bi-building-gear me-2 text-primary" />
          Administración
        </h4>
      </div>

      <ul className="nav nav-tabs mb-3">
        <li className="nav-item">
          <button className={`nav-link ${tab === 'proveedores' ? 'active' : ''}`} onClick={() => setTab('proveedores')}>
            <i className="bi bi-truck me-1" /> Proveedores
          </button>
        </li>
        <li className="nav-item">
          <button className={`nav-link ${tab === 'clientes' ? 'active' : ''}`} onClick={() => setTab('clientes')}>
            <i className="bi bi-person-lines-fill me-1" /> Clientes
          </button>
        </li>
        <li className="nav-item">
          <button className={`nav-link ${tab === 'form11' ? 'active' : ''}`} onClick={() => setTab('form11')}>
            <i className="bi bi-clipboard-check me-1" /> Evaluaciones (Form 11)
          </button>
        </li>
      </ul>

      {tab === 'proveedores' && <TabProveedores />}
      {tab === 'clientes'    && <TabClientes />}
      {tab === 'form11'      && <Form11 canWrite={canWrite} proveedores={provsList} />}
    </div>
  )
}

// ── Tab Proveedores ────────────────────────────────────────────────────────────

function TabProveedores() {
  const user          = getUser()
  const permisos      = getPermisos()
  const puedeEscribir = user?.rol === 'admin' || !!permisos?.compras?.escribir || !!permisos?.administracion?.escribir

  const [lista,        setLista]        = useState([])
  const [cargando,     setCargando]     = useState(false)
  const [buscar,       setBuscar]       = useState('')
  const [verInactivos, setVerInactivos] = useState(false)
  const [modal,        setModal]        = useState(null)
  const [form,         setForm]         = useState(PROV_VACIO)
  const [error,        setError]        = useState('')
  const [guardando,    setGuardando]    = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const params = {}
      if (buscar)       params.buscar = buscar
      if (verInactivos) params.todos  = '1'
      const { data } = await api.get('/compras/proveedores', { params })
      setLista(data)
    } catch (e) {
      console.error(e)
    } finally {
      setCargando(false)
    }
  }, [buscar, verInactivos])

  useEffect(() => { cargar() }, [cargar])

  const abrirNuevo = () => {
    setForm(PROV_VACIO)
    setError('')
    setModal({ modo: 'nuevo' })
  }

  const abrirEditar = (p) => {
    setForm({ ...PROV_VACIO, ...p })
    setError('')
    setModal({ modo: 'editar', id: p.id })
  }

  const guardar = async (e) => {
    e.preventDefault()
    if (!form.nombre.trim()) { setError('El nombre es obligatorio'); return }
    setGuardando(true)
    setError('')
    try {
      if (modal.modo === 'nuevo') {
        await api.post('/compras/proveedores', form)
      } else {
        await api.put(`/compras/proveedores/${modal.id}`, form)
      }
      setModal(null)
      cargar()
    } catch (e) {
      setError(e.response?.data?.error || 'Error al guardar')
    } finally {
      setGuardando(false)
    }
  }

  const toggleActivo = async (p) => {
    const accion = p.activo ? 'Desactivar' : 'Activar'
    if (!window.confirm(`¿${accion} el proveedor "${p.nombre}"?`)) return
    try {
      await api.delete(`/compras/proveedores/${p.id}`)
      cargar()
    } catch (e) {
      alert(e.response?.data?.error || 'Error')
    }
  }

  return (
    <>
      <div className="d-flex flex-wrap gap-2 mb-3 align-items-center">
        <input
          className="form-control form-control-sm"
          style={{ maxWidth: 280 }}
          placeholder="Buscar por nombre o CUIT..."
          value={buscar}
          onChange={e => setBuscar(e.target.value)}
        />
        <div className="form-check form-switch mb-0 ms-1">
          <input className="form-check-input" type="checkbox" id="chkInactProv"
            checked={verInactivos} onChange={e => setVerInactivos(e.target.checked)}/>
          <label className="form-check-label small" htmlFor="chkInactProv">Ver inactivos</label>
        </div>
        <div className="ms-auto">
          {puedeEscribir && (
            <button className="btn btn-primary btn-sm" onClick={abrirNuevo}>
              <i className="bi bi-plus-lg me-1" />Nuevo Proveedor
            </button>
          )}
        </div>
      </div>

      <div className="table-responsive">
        <table className="table table-sm table-hover align-middle">
          <thead className="table-dark">
            <tr>
              <th>Nombre</th>
              <th>CUIT</th>
              <th>Contacto</th>
              <th>Teléfono</th>
              <th>Email</th>
              <th>Cond. Pago</th>
              <th>Localidad</th>
              <th>Categoría</th>
              <th className="text-center">Crítico</th>
              <th className="text-center">Estado</th>
              <th style={{ width: 90 }}></th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={11} className="text-center py-4 text-muted">
                <span className="spinner-border spinner-border-sm me-2" />Cargando...
              </td></tr>
            ) : lista.length === 0 ? (
              <tr><td colSpan={11} className="text-center py-4 text-muted">Sin resultados</td></tr>
            ) : lista.map(p => (
              <tr key={p.id} className={!p.activo ? 'opacity-50' : ''}>
                <td className="fw-semibold">{p.nombre}</td>
                <td className="font-monospace small">{p.cuit || '—'}</td>
                <td>{p.contacto || '—'}</td>
                <td>{p.telefono || '—'}</td>
                <td className="small">{p.email || '—'}</td>
                <td className="small">{p.condicion_pago || '—'}</td>
                <td>{p.localidad || '—'}</td>
                <td className="small text-muted">{p.categoria_provision || '—'}</td>
                <td className="text-center">
                  {p.critico ? <span className="badge bg-danger">Crítico</span> : <span className="text-muted small">—</span>}
                </td>
                <td className="text-center">
                  <span className={`badge ${p.activo ? 'bg-success' : 'bg-secondary'}`}>
                    {p.activo ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td>
                  {puedeEscribir && (
                    <div className="d-flex gap-1 justify-content-end">
                      <button className="btn btn-outline-secondary btn-sm" title="Editar" onClick={() => abrirEditar(p)}>
                        <i className="bi bi-pencil" />
                      </button>
                      <button className={`btn btn-sm ${p.activo ? 'btn-outline-danger' : 'btn-outline-success'}`}
                        title={p.activo ? 'Desactivar' : 'Activar'} onClick={() => toggleActivo(p)}>
                        <i className={`bi bi-${p.activo ? 'slash-circle' : 'check-circle'}`} />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-muted small">{lista.length} registro{lista.length !== 1 ? 's' : ''}</div>

      {modal && (
        <ModalProveedor
          modal={modal} form={form} setForm={setForm} error={error}
          guardando={guardando} onClose={() => setModal(null)} onSubmit={guardar}
        />
      )}
    </>
  )
}

function ModalProveedor({ modal, form, setForm, error, guardando, onClose, onSubmit }) {
  const set = campo => e => setForm(f => ({ ...f, [campo]: e.target.value }))

  return (
    <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-dialog modal-xl modal-dialog-scrollable">
        <div className="modal-content">
          <form onSubmit={onSubmit}>
            <div className="modal-header">
              <h5 className="modal-title">
                <i className="bi bi-truck me-2" />
                {modal.modo === 'nuevo' ? 'Nuevo Proveedor' : 'Editar Proveedor'}
              </h5>
              <button type="button" className="btn-close" onClick={onClose} />
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-danger py-2 small">{error}</div>}

              {/* Datos generales */}
              <h6 className="fw-semibold text-muted border-bottom pb-1 mb-3 small text-uppercase">Datos generales</h6>
              <div className="row g-3 mb-3">
                <div className="col-md-7">
                  <label className="form-label fw-semibold">Nombre <span className="text-danger">*</span></label>
                  <input className="form-control" value={form.nombre} onChange={set('nombre')} autoFocus />
                </div>
                <div className="col-md-3">
                  <label className="form-label">CUIT</label>
                  <input className="form-control" value={form.cuit} onChange={set('cuit')} placeholder="XX-XXXXXXXX-X" />
                </div>
                <div className="col-md-2 d-flex align-items-end pb-1">
                  <div className="form-check form-switch mb-0">
                    <input className="form-check-input" type="checkbox" id="chkCritico"
                      checked={!!form.critico} onChange={e => setForm(f => ({ ...f, critico: e.target.checked ? 1 : 0 }))}/>
                    <label className="form-check-label fw-semibold text-danger" htmlFor="chkCritico">Crítico</label>
                  </div>
                </div>
                <div className="col-md-4">
                  <label className="form-label">Contacto</label>
                  <input className="form-control" value={form.contacto} onChange={set('contacto')} />
                </div>
                <div className="col-md-4">
                  <label className="form-label">Teléfono</label>
                  <input className="form-control" value={form.telefono} onChange={set('telefono')} />
                </div>
                <div className="col-md-4">
                  <label className="form-label">Email</label>
                  <input className="form-control" type="email" value={form.email} onChange={set('email')} />
                </div>
                <div className="col-md-4">
                  <label className="form-label">Vendedor</label>
                  <input className="form-control" value={form.vendedor} onChange={set('vendedor')} />
                </div>
                <div className="col-md-4">
                  <label className="form-label">Condición de Pago</label>
                  <input className="form-control" value={form.condicion_pago} onChange={set('condicion_pago')}
                    placeholder="ej: TRANSF. BANCARIA, CONTADO..." list="condpago-prov-list"/>
                  <datalist id="condpago-prov-list">
                    {CONDICIONES_PAGO.map(c => <option key={c} value={c} />)}
                  </datalist>
                </div>
                <div className="col-12">
                  <label className="form-label">Dirección</label>
                  <input className="form-control" value={form.direccion} onChange={set('direccion')} />
                </div>
                <div className="col-md-5">
                  <label className="form-label">Localidad</label>
                  <input className="form-control" value={form.localidad} onChange={set('localidad')} />
                </div>
                <div className="col-md-3">
                  <label className="form-label">CP</label>
                  <input className="form-control" value={form.cp} onChange={set('cp')} />
                </div>
              </div>

              {/* Datos SGC (Form 11) */}
              <h6 className="fw-semibold text-muted border-bottom pb-1 mb-3 small text-uppercase">
                <i className="bi bi-clipboard-check me-1"/>Datos SGC (Form 11)
              </h6>
              <div className="row g-3">
                <div className="col-md-4">
                  <label className="form-label">Categoría de Provisión</label>
                  <input className="form-control" value={form.categoria_provision} onChange={set('categoria_provision')}
                    list="cat-prov-list" placeholder="Ej: Insumos, Servicios…"/>
                  <datalist id="cat-prov-list">
                    {CATEGORIAS_PROVISION.map(c => <option key={c} value={c} />)}
                  </datalist>
                </div>
                <div className="col-md-3">
                  <label className="form-label">Fecha de Selección</label>
                  <input type="date" className="form-control" value={form.fecha_seleccion} onChange={set('fecha_seleccion')} />
                </div>
                <div className="col-md-3">
                  <label className="form-label">Frecuencia de Evaluación</label>
                  <select className="form-select" value={form.frecuencia_evaluacion} onChange={set('frecuencia_evaluacion')}>
                    {FRECUENCIAS_EVAL.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div className="col-md-4">
                  <label className="form-label">Responsable de Selección</label>
                  <EmpleadoSelect value={form.responsable_seleccion}
                    onChange={v => setForm(f => ({ ...f, responsable_seleccion: v }))} />
                </div>
                <div className="col-md-4">
                  <label className="form-label">Responsable de Evaluación</label>
                  <EmpleadoSelect value={form.responsable_evaluacion}
                    onChange={v => setForm(f => ({ ...f, responsable_evaluacion: v }))} />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline-secondary" onClick={onClose}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={guardando}>
                {guardando ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="bi bi-check-lg me-1" />}
                Guardar
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

// ── Tab Clientes ───────────────────────────────────────────────────────────────

function TabClientes() {
  const user          = getUser()
  const permisos      = getPermisos()
  const puedeEscribir = user?.rol === 'admin' || !!permisos?.ventas?.escribir || !!permisos?.administracion?.escribir

  const [lista,        setLista]        = useState([])
  const [cargando,     setCargando]     = useState(false)
  const [buscar,       setBuscar]       = useState('')
  const [verInactivos, setVerInactivos] = useState(false)
  const [modal,        setModal]        = useState(null)
  const [form,         setForm]         = useState(CLI_VACIO)
  const [error,        setError]        = useState('')
  const [guardando,    setGuardando]    = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const params = {}
      if (buscar)       params.buscar = buscar
      if (verInactivos) params.todos  = '1'
      const { data } = await api.get('/ventas/clientes', { params })
      setLista(data)
    } catch (e) {
      console.error(e)
    } finally {
      setCargando(false)
    }
  }, [buscar, verInactivos])

  useEffect(() => { cargar() }, [cargar])

  const abrirNuevo = () => { setForm(CLI_VACIO); setError(''); setModal({ modo: 'nuevo' }) }
  const abrirEditar = c => { setForm({ ...CLI_VACIO, ...c }); setError(''); setModal({ modo: 'editar', id: c.id }) }

  const guardar = async (e) => {
    e.preventDefault()
    if (!form.nombre.trim()) { setError('El nombre es obligatorio'); return }
    setGuardando(true); setError('')
    try {
      if (modal.modo === 'nuevo') await api.post('/ventas/clientes', form)
      else await api.put(`/ventas/clientes/${modal.id}`, form)
      setModal(null); cargar()
    } catch (e) {
      setError(e.response?.data?.error || 'Error al guardar')
    } finally {
      setGuardando(false)
    }
  }

  const toggleActivo = async c => {
    if (!window.confirm(`¿${c.activo ? 'Desactivar' : 'Activar'} el cliente "${c.nombre}"?`)) return
    try { await api.delete(`/ventas/clientes/${c.id}`); cargar() }
    catch (e) { alert(e.response?.data?.error || 'Error') }
  }

  return (
    <>
      <div className="d-flex flex-wrap gap-2 mb-3 align-items-center">
        <input className="form-control form-control-sm" style={{ maxWidth: 280 }}
          placeholder="Buscar por nombre o CUIT..." value={buscar} onChange={e => setBuscar(e.target.value)}/>
        <div className="form-check form-switch mb-0 ms-1">
          <input className="form-check-input" type="checkbox" id="chkInactCli"
            checked={verInactivos} onChange={e => setVerInactivos(e.target.checked)}/>
          <label className="form-check-label small" htmlFor="chkInactCli">Ver inactivos</label>
        </div>
        <div className="ms-auto">
          {puedeEscribir && (
            <button className="btn btn-primary btn-sm" onClick={abrirNuevo}>
              <i className="bi bi-plus-lg me-1" />Nuevo Cliente
            </button>
          )}
        </div>
      </div>

      <div className="table-responsive">
        <table className="table table-sm table-hover align-middle">
          <thead className="table-dark">
            <tr>
              <th>Nombre</th><th>CUIT</th><th>Contacto</th><th>Teléfono</th>
              <th>Email</th><th>Cond. Pago</th><th>Localidad</th>
              <th className="text-center">Estado</th><th style={{ width: 90 }}></th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={9} className="text-center py-4 text-muted">
                <span className="spinner-border spinner-border-sm me-2" />Cargando...
              </td></tr>
            ) : lista.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-4 text-muted">Sin resultados</td></tr>
            ) : lista.map(c => (
              <tr key={c.id} className={!c.activo ? 'opacity-50' : ''}>
                <td className="fw-semibold">{c.nombre}</td>
                <td className="font-monospace small">{c.cuit || '—'}</td>
                <td>{c.contacto || '—'}</td>
                <td>{c.telefono || '—'}</td>
                <td className="small">{c.email || '—'}</td>
                <td className="small">{c.condicion_pago || '—'}</td>
                <td>{c.localidad || '—'}</td>
                <td className="text-center">
                  <span className={`badge ${c.activo ? 'bg-success' : 'bg-secondary'}`}>
                    {c.activo ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td>
                  {puedeEscribir && (
                    <div className="d-flex gap-1 justify-content-end">
                      <button className="btn btn-outline-secondary btn-sm" title="Editar" onClick={() => abrirEditar(c)}>
                        <i className="bi bi-pencil" />
                      </button>
                      <button className={`btn btn-sm ${c.activo ? 'btn-outline-danger' : 'btn-outline-success'}`}
                        title={c.activo ? 'Desactivar' : 'Activar'} onClick={() => toggleActivo(c)}>
                        <i className={`bi bi-${c.activo ? 'slash-circle' : 'check-circle'}`} />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-muted small">{lista.length} registro{lista.length !== 1 ? 's' : ''}</div>

      {modal && (
        <ModalCliente modal={modal} form={form} setForm={setForm} error={error}
          guardando={guardando} onClose={() => setModal(null)} onSubmit={guardar}/>
      )}
    </>
  )
}

function ModalCliente({ modal, form, setForm, error, guardando, onClose, onSubmit }) {
  const set = campo => e => setForm(f => ({ ...f, [campo]: e.target.value }))

  return (
    <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-dialog modal-lg">
        <div className="modal-content">
          <form onSubmit={onSubmit}>
            <div className="modal-header">
              <h5 className="modal-title">
                <i className="bi bi-person-lines-fill me-2" />
                {modal.modo === 'nuevo' ? 'Nuevo Cliente' : 'Editar Cliente'}
              </h5>
              <button type="button" className="btn-close" onClick={onClose} />
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-danger py-2 small">{error}</div>}
              <div className="row g-3">
                <div className="col-md-8">
                  <label className="form-label fw-semibold">Nombre <span className="text-danger">*</span></label>
                  <input className="form-control" value={form.nombre} onChange={set('nombre')} autoFocus />
                </div>
                <div className="col-md-4">
                  <label className="form-label">CUIT</label>
                  <input className="form-control" value={form.cuit} onChange={set('cuit')} placeholder="XX-XXXXXXXX-X" />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Contacto</label>
                  <input className="form-control" value={form.contacto} onChange={set('contacto')} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Teléfono</label>
                  <input className="form-control" value={form.telefono} onChange={set('telefono')} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Email</label>
                  <input className="form-control" type="email" value={form.email} onChange={set('email')} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Condición de Pago</label>
                  <input className="form-control" value={form.condicion_pago} onChange={set('condicion_pago')}
                    placeholder="ej: 30 días, Contado..." list="condpago-cli-list"/>
                  <datalist id="condpago-cli-list">
                    {CONDICIONES_PAGO.map(c => <option key={c} value={c} />)}
                  </datalist>
                </div>
                <div className="col-12">
                  <label className="form-label">Dirección</label>
                  <input className="form-control" value={form.direccion} onChange={set('direccion')} />
                </div>
                <div className="col-md-5">
                  <label className="form-label">Localidad</label>
                  <input className="form-control" value={form.localidad} onChange={set('localidad')} />
                </div>
                <div className="col-md-3">
                  <label className="form-label">CP</label>
                  <input className="form-control" value={form.cp} onChange={set('cp')} />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline-secondary" onClick={onClose}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={guardando}>
                {guardando ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="bi bi-check-lg me-1" />}
                Guardar
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
