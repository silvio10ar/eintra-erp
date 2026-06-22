import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'
import { Asistente } from '../codificacion/AsistenteCore'

const FORM_VACIO = {
  codigo:'', descripcion:'', categoria:'', unidad:'UND.',
  stock_minimo:0, ubicacion:'', precio_costo:0, precio_venta:0, proveedor:''
}

export default function Materiales() {
  const [items,     setItems]     = useState([])
  const [loading,   setLoading]   = useState(true)
  const [buscar,    setBuscar]    = useState('')
  const [modal,     setModal]     = useState(null)   // null | 'nuevo' | {item}
  const [paso,      setPaso]      = useState('codigo')
  const [form,      setForm]      = useState(FORM_VACIO)
  const [saving,    setSaving]    = useState(false)
  const [err,       setErr]       = useState('')
  const [codConfig, setCodConfig] = useState(null)

  const cargar = useCallback((q = buscar) => {
    setLoading(true)
    api.get('/materiales', { params: q ? { buscar: q } : {} })
      .then(r => setItems(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [buscar])

  useEffect(() => {
    cargar('')
    api.get('/codificacion/config').then(r => setCodConfig(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    const t = setTimeout(() => cargar(buscar), 300)
    return () => clearTimeout(t)
  }, [buscar])

  const abrirNuevo = () => {
    setForm(FORM_VACIO); setErr(''); setPaso('codigo'); setModal('nuevo')
  }
  const abrirEditar = item => {
    setForm({ ...item }); setErr(''); setPaso('datos'); setModal(item)
  }
  const cerrar = () => setModal(null)

  const usarCodigo = (codigo, descripcion) => {
    setForm(p => ({ ...p, codigo, descripcion: descripcion || p.descripcion }))
    setPaso('datos')
  }

  const guardar = async e => {
    e.preventDefault()
    setSaving(true); setErr('')
    try {
      if (modal === 'nuevo') {
        await api.post('/materiales', form)
      } else {
        await api.put(`/materiales/${modal.id}`, form)
      }
      cerrar()
      cargar(buscar)
    } catch(e) {
      setErr(e.response?.data?.error || 'Error al guardar')
    } finally { setSaving(false) }
  }

  const eliminar = async item => {
    if (item.stock_actual !== 0) return
    if (!confirm(`¿Eliminar "${item.descripcion}"?`)) return
    try {
      await api.delete(`/materiales/${item.id}`)
      cargar(buscar)
    } catch(e) {
      alert(e.response?.data?.error || 'No se pudo eliminar')
    }
  }

  const esNuevo = modal === 'nuevo'

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h4 className="mb-0">Catálogo de materiales</h4>
          <p className="text-muted small mb-0">Gestión del catálogo — sin modificación de cantidades</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={abrirNuevo}>
          <i className="bi bi-plus-circle me-1"/>Agregar material
        </button>
      </div>

      {/* Buscador */}
      <div className="card mb-3">
        <div className="card-body py-2 px-3">
          <div className="input-group input-group-sm">
            <span className="input-group-text"><i className="bi bi-search"/></span>
            <input className="form-control" placeholder="Buscar por código, descripción o proveedor..."
              value={buscar} onChange={e => setBuscar(e.target.value)}/>
            {buscar && (
              <button className="btn btn-outline-secondary" onClick={() => setBuscar('')}>
                <i className="bi bi-x"/>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tabla */}
      <div className="card">
        <div className="card-body p-0">
          {loading ? (
            <div className="text-center py-5 text-muted">
              <span className="spinner-border spinner-border-sm me-2"/>Cargando...
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-5 text-muted">
              <i className="bi bi-inbox fs-3 d-block mb-2"/>
              {buscar ? 'Sin resultados para la búsqueda' : 'No hay materiales en el catálogo'}
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-sm table-hover align-middle mb-0">
                <thead className="table-light">
                  <tr>
                    <th style={{width:130}}>Código</th>
                    <th>Descripción</th>
                    <th>Categoría</th>
                    <th style={{width:70}}>Unidad</th>
                    <th className="text-end" style={{width:70}}>Stock</th>
                    <th style={{width:60}}>S.Mín</th>
                    <th>Proveedor</th>
                    <th style={{width:80}}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map(item => (
                    <tr key={item.id}>
                      <td>
                        <code className="fw-semibold text-dark" style={{letterSpacing:1}}>
                          {item.codigo}
                        </code>
                      </td>
                      <td>
                        <div className="text-truncate" style={{maxWidth:320}} title={item.descripcion}>
                          {item.descripcion}
                        </div>
                      </td>
                      <td><span className="text-muted small">{item.categoria}</span></td>
                      <td className="text-muted small">{item.unidad}</td>
                      <td className="text-end">
                        <span className={`badge ${item.stock_actual > 0 ? 'bg-success' : item.stock_actual < 0 ? 'bg-danger' : 'bg-secondary'}`}>
                          {item.stock_actual}
                        </span>
                      </td>
                      <td className="text-muted small text-center">{item.stock_minimo || '—'}</td>
                      <td>
                        <span className="text-muted small text-truncate d-block" style={{maxWidth:180}}>
                          {item.proveedor || '—'}
                        </span>
                      </td>
                      <td>
                        <div className="d-flex gap-1 justify-content-end pe-1">
                          <button className="btn btn-xs btn-outline-secondary py-0 px-2"
                            style={{fontSize:'0.75rem'}}
                            title="Editar"
                            onClick={() => abrirEditar(item)}>
                            <i className="bi bi-pencil"/>
                          </button>
                          <button
                            className="btn btn-xs py-0 px-2"
                            style={{
                              fontSize:'0.75rem',
                              opacity: item.stock_actual !== 0 ? 0.35 : 1,
                              cursor:  item.stock_actual !== 0 ? 'not-allowed' : 'pointer',
                            }}
                            title={item.stock_actual !== 0
                              ? `No se puede eliminar: tiene ${item.stock_actual} unidades en stock`
                              : 'Eliminar'}
                            onClick={() => eliminar(item)}>
                            <i className="bi bi-trash text-danger"/>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-3 py-2 border-top text-muted" style={{fontSize:'0.75rem'}}>
                {items.length} material{items.length !== 1 ? 'es' : ''}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Modal ─────────────────────────────────────────────────── */}
      {modal && (
        <div className="modal fade show d-block" style={{background:'rgba(0,0,0,.5)'}}>
          <div className={`modal-dialog modal-dialog-centered modal-dialog-scrollable ${paso === 'codigo' ? 'modal-xl' : 'modal-lg'}`}>
            <div className="modal-content">

              <div className="modal-header py-2">
                <h6 className="modal-title mb-0 d-flex align-items-center gap-2">
                  {esNuevo ? (
                    paso === 'codigo'
                      ? <><span className="badge bg-primary">Paso 1</span>Generar código</>
                      : <><span className="badge bg-success">Paso 2</span>Datos del material</>
                  ) : paso === 'codigo' ? (
                    <><i className="bi bi-arrow-repeat me-1"/>Corregir código</>
                  ) : (
                    <><i className="bi bi-pencil-square me-1"/>Editar material</>
                  )}
                </h6>
                <button className="btn-close" onClick={cerrar}/>
              </div>

              <div className="modal-body">
                {paso === 'codigo' ? (
                  <>
                    {codConfig
                      ? <Asistente config={codConfig} onUsar={usarCodigo}/>
                      : <div className="text-center py-4 text-muted">
                          <span className="spinner-border spinner-border-sm me-2"/>Cargando asistente...
                        </div>}
                    {esNuevo && (
                      <>
                        <hr className="my-3"/>
                        <div className="text-center">
                          <button className="btn btn-sm btn-outline-secondary" onClick={() => setPaso('datos')}>
                            <i className="bi bi-keyboard me-1"/>Ingresar código manualmente
                          </button>
                        </div>
                      </>
                    )}
                  </>
                ) : (
                  <form id="form-mat" onSubmit={guardar}>
                    <div className="row g-2">
                      <div className="col-md-4">
                        <label className="form-label small fw-medium">Código *</label>
                        <div className="input-group">
                          <input className="form-control" required
                            style={{fontFamily:'monospace', letterSpacing:2}}
                            value={form.codigo}
                            onChange={e => setForm(p => ({...p, codigo: e.target.value.toUpperCase()}))}/>
                          <button type="button" className="btn btn-outline-secondary btn-sm"
                            title="Corregir código con el asistente"
                            onClick={() => setPaso('codigo')}>
                            <i className="bi bi-arrow-repeat"/>
                          </button>
                        </div>
                      </div>
                      <div className="col-md-8">
                        <label className="form-label small fw-medium">Descripción *</label>
                        <input className="form-control" required autoFocus
                          value={form.descripcion}
                          onChange={e => setForm(p => ({...p, descripcion: e.target.value}))}/>
                      </div>
                      <div className="col-md-5">
                        <label className="form-label small fw-medium">Categoría</label>
                        <input className="form-control" value={form.categoria}
                          onChange={e => setForm(p => ({...p, categoria: e.target.value}))}/>
                      </div>
                      <div className="col-md-3">
                        <label className="form-label small fw-medium">Unidad</label>
                        <input className="form-control" value={form.unidad}
                          onChange={e => setForm(p => ({...p, unidad: e.target.value}))}/>
                      </div>
                      <div className="col-md-2">
                        <label className="form-label small fw-medium">Stock mínimo</label>
                        <input className="form-control" type="number" min="0"
                          value={form.stock_minimo}
                          onChange={e => setForm(p => ({...p, stock_minimo: +e.target.value}))}/>
                      </div>
                      <div className="col-md-2">
                        <label className="form-label small fw-medium">Ubicación</label>
                        <input className="form-control" value={form.ubicacion}
                          onChange={e => setForm(p => ({...p, ubicacion: e.target.value}))}/>
                      </div>
                      <div className="col-md-4">
                        <label className="form-label small fw-medium">Precio costo</label>
                        <div className="input-group input-group-sm">
                          <span className="input-group-text">$</span>
                          <input className="form-control" type="number" min="0" step="0.01"
                            value={form.precio_costo}
                            onChange={e => setForm(p => ({...p, precio_costo: +e.target.value}))}/>
                        </div>
                      </div>
                      <div className="col-md-4">
                        <label className="form-label small fw-medium">Precio venta</label>
                        <div className="input-group input-group-sm">
                          <span className="input-group-text">$</span>
                          <input className="form-control" type="number" min="0" step="0.01"
                            value={form.precio_venta}
                            onChange={e => setForm(p => ({...p, precio_venta: +e.target.value}))}/>
                        </div>
                      </div>
                      <div className="col-md-4">
                        <label className="form-label small fw-medium">Proveedor</label>
                        <input className="form-control" value={form.proveedor}
                          onChange={e => setForm(p => ({...p, proveedor: e.target.value}))}/>
                      </div>
                    </div>
                    {err && <div className="alert alert-danger mt-3 py-2 small mb-0">{err}</div>}
                  </form>
                )}
              </div>

              <div className="modal-footer py-2">
                {paso === 'datos' && esNuevo && (
                  <button className="btn btn-sm btn-outline-secondary me-auto"
                    onClick={() => setPaso('codigo')}>
                    <i className="bi bi-arrow-left me-1"/>Volver al asistente
                  </button>
                )}
                {paso === 'codigo' && !esNuevo && (
                  <button className="btn btn-sm btn-outline-secondary me-auto"
                    onClick={() => setPaso('datos')}>
                    <i className="bi bi-arrow-left me-1"/>Volver al formulario
                  </button>
                )}
                <button className="btn btn-sm btn-secondary" onClick={cerrar}>Cancelar</button>
                {paso === 'datos' && (
                  <button className="btn btn-sm btn-primary" form="form-mat" type="submit" disabled={saving}>
                    {saving
                      ? <><span className="spinner-border spinner-border-sm me-1"/>Guardando...</>
                      : <><i className="bi bi-check-lg me-1"/>Guardar</>}
                  </button>
                )}
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  )
}
