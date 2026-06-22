import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'
import { puedeEscribir } from '../../store/authStore'
import { Asistente } from '../codificacion/AsistenteCore'

const fmt  = n => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(n ?? 0)
const FORM_P = { codigo:'', descripcion:'', categoria:'', unidad:'UND.', stock_actual:0, stock_minimo:0, ubicacion:'', precio_costo:0, precio_venta:0, proveedor:'', codigo_proveedor:'' }

export default function StockConsulta() {
  const canWrite = puedeEscribir('stock')

  const [prods,    setProds]    = useState([])
  const [cats,     setCats]     = useState([])
  const [ubics,    setUbics]    = useState([])
  const [provsList,setProvsList]= useState([])
  const [loading,  setLoading]  = useState(true)
  const [selId,    setSelId]    = useState(null)
  const [buscar,   setBuscar]   = useState('')
  const [filUbic,  setFilUbic]  = useState('')
  const [filAlerta,setFilAlerta]= useState('')
  const [codConfig,setCodConfig]= useState(null)

  const [modalP,   setModalP]   = useState(null)   // null | 'nuevo' | prod
  const [formP,    setFormP]    = useState(FORM_P)
  const [savP,     setSavP]     = useState(false)
  const [errP,     setErrP]     = useState('')
  const [pasoModal,setPasoModal]= useState('codigo')

  const cargar = useCallback(() => {
    setLoading(true)
    api.get('/stock/productos', { params: { buscar: buscar||undefined, ubicacion: filUbic||undefined, alerta: filAlerta||undefined } })
      .then(r => setProds(r.data))
      .finally(() => setLoading(false))
  }, [buscar, filUbic, filAlerta])

  useEffect(() => { cargar() }, [cargar])
  useEffect(() => {
    api.get('/stock/productos/categorias').then(r => setCats(r.data))
    api.get('/stock/productos/ubicaciones').then(r => setUbics(r.data))
    api.get('/compras/proveedores').then(r => setProvsList(r.data)).catch(() => {})
    api.get('/codificacion/config').then(r => setCodConfig(r.data)).catch(() => {})
  }, [])

  const sel = prods.find(p => p.id === selId)

  const abrirNuevo  = () => { setFormP(FORM_P); setErrP(''); setPasoModal('codigo'); setModalP('nuevo') }
  const usarCodigo  = (codigo, descripcion) => { setFormP(p => ({ ...p, codigo, descripcion: descripcion || p.descripcion })); setPasoModal('datos') }
  const abrirEditar = p => { if (!p) return; setFormP({...p}); setErrP(''); setModalP(p) }

  const guardarP = async e => {
    e.preventDefault(); setSavP(true); setErrP('')
    try {
      if (modalP === 'nuevo') await api.post('/stock/productos', formP)
      else                    await api.put(`/stock/productos/${modalP.id}`, formP)
      setModalP(null); cargar()
    } catch(err) { setErrP(err.response?.data?.error ?? 'Error al guardar') }
    finally { setSavP(false) }
  }

  const eliminar = async () => {
    if (!sel || !confirm(`¿Desactivar "${sel.descripcion}"?`)) return
    await api.delete(`/stock/productos/${sel.id}`)
    setSelId(null); cargar()
  }

  const total       = prods.length
  const disponibles = prods.filter(p => p.stock_actual > 0).length
  const stockBajo   = prods.filter(p => p.stock_actual > 0 && p.stock_minimo > 0 && p.stock_actual <= p.stock_minimo).length
  const agotados    = prods.filter(p => p.stock_actual <= 0).length

  return (
    <>
      <h5 className="fw-bold mb-3">Stock — Materiales</h5>

      {canWrite && (
        <div className="d-flex flex-wrap gap-2 mb-3">
          <button className="btn btn-sm btn-success"  onClick={abrirNuevo}><i className="bi bi-plus-lg me-1"/>Agregar</button>
          <button className="btn btn-sm btn-primary"  onClick={() => abrirEditar(sel)} disabled={!sel}><i className="bi bi-pencil me-1"/>Editar</button>
          <button className="btn btn-sm btn-danger"   onClick={eliminar} disabled={!sel}><i className="bi bi-x-lg me-1"/>Eliminar</button>
        </div>
      )}

      <div className="d-flex flex-wrap gap-2 mb-2">
        <div className="position-relative">
          <input className="form-control form-control-sm" style={{width:260}} placeholder="Buscar…"
            value={buscar} onChange={e => setBuscar(e.target.value)} />
          {buscar && <button className="btn btn-sm position-absolute top-0 end-0 py-0 px-1 text-muted"
            onClick={() => setBuscar('')}><i className="bi bi-x"/></button>}
        </div>
        <select className="form-select form-select-sm" style={{width:160}} value={filUbic} onChange={e => setFilUbic(e.target.value)}>
          <option value="">Todas las ubicaciones</option>
          {ubics.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
        <div className="btn-group btn-group-sm">
          {[['','Todos'],['ok','Disponibles'],['bajo','Stock bajo'],['agotado','Agotados']].map(([v,l]) => (
            <button key={v} className={`btn btn-outline-secondary ${filAlerta===v?'active':''}`}
              onClick={() => setFilAlerta(v)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="card border-0 shadow-sm">
        {loading
          ? <div className="text-center py-5"><div className="spinner-border text-secondary"/></div>
          : <div className="table-responsive" style={{maxHeight:'calc(100vh - 280px)', overflowY:'auto'}}>
              <table className="table table-hover table-sm mb-0" style={{fontSize:'0.83rem'}}>
                <thead className="table-dark sticky-top">
                  <tr>
                    <th>CÓDIGO</th><th>DESCRIPCIÓN</th>
                    <th className="text-end">STOCK</th><th className="text-center">DISPONIB</th>
                    <th>UBICACIÓN</th><th className="text-end">MÍNIMO</th>
                  </tr>
                </thead>
                <tbody>
                  {prods.length === 0
                    ? <tr><td colSpan={6} className="text-center text-muted py-4">Sin resultados</td></tr>
                    : prods.map(p => {
                        const agot = p.stock_actual <= 0
                        const bajo = !agot && p.stock_minimo > 0 && p.stock_actual <= p.stock_minimo
                        return (
                          <tr key={p.id}
                            className={selId===p.id ? 'table-primary' : ''}
                            style={{ cursor:'pointer', color: agot?'#dc3545': bajo?'#d97706':undefined }}
                            onClick={() => setSelId(p.id === selId ? null : p.id)}
                            onDoubleClick={() => canWrite && abrirEditar(p)}>
                            <td className="fw-semibold">
                              {p.codigo}
                              {p.codigo_proveedor && <div className="text-muted fw-normal" style={{fontSize:'0.74rem'}}>{p.codigo_proveedor}</div>}
                            </td>
                            <td><div className="text-truncate" style={{maxWidth:320}} title={p.descripcion}>{p.descripcion}</div></td>
                            <td className="text-end fw-semibold">{fmt(p.stock_actual)}</td>
                            <td className="text-center">{agot ? '✗' : '✓'}</td>
                            <td>{p.ubicacion || ''}</td>
                            <td className="text-end text-muted">{p.stock_minimo > 0 ? fmt(p.stock_minimo) : 0}</td>
                          </tr>
                        )
                      })
                  }
                </tbody>
              </table>
            </div>
        }
        <div className="border-top px-3 py-1 d-flex gap-3 text-muted" style={{fontSize:'0.78rem', background:'#f8f9fa'}}>
          <span>Total: <strong>{total}</strong></span>
          <span className="text-success">✓ Disponibles: <strong>{disponibles}</strong></span>
          <span className="text-warning">⚠ Stock bajo: <strong>{stockBajo}</strong></span>
          <span className="text-danger">✗ Agotados: <strong>{agotados}</strong></span>
          {sel && <span className="ms-auto text-primary">Seleccionado: <strong>{sel.codigo}</strong> — {sel.descripcion}</span>}
        </div>
      </div>

      {/* ══ MODAL: PRODUCTO ══════════════════════════════════════════ */}
      {modalP !== null && (
        <div className="modal show d-block" style={{background:'rgba(0,0,0,.4)'}}>
          <div className="modal-dialog modal-lg modal-dialog-scrollable">
            <form className="modal-content" onSubmit={guardarP}>
              <div className="modal-header">
                <h5 className="modal-title d-flex align-items-center gap-2">
                  {modalP === 'nuevo' ? 'Nuevo producto' : 'Editar producto'}
                  {modalP === 'nuevo' && (
                    <span className={`badge fw-normal ${pasoModal==='codigo' ? 'bg-primary' : 'bg-success'}`}>
                      {pasoModal==='codigo' ? 'Paso 1 — Generar código' : 'Paso 2 — Datos'}
                    </span>
                  )}
                </h5>
                <button type="button" className="btn-close" onClick={() => setModalP(null)}/>
              </div>
              <div className="modal-body">
                {errP && <div className="alert alert-danger py-2 small">{errP}</div>}

                {modalP === 'nuevo' && pasoModal === 'codigo' && (
                  <>
                    {codConfig
                      ? <Asistente config={codConfig} onUsar={usarCodigo} />
                      : <div className="text-center py-4 text-muted">
                          <div className="spinner-border spinner-border-sm me-2"/>Cargando generador de códigos…
                        </div>
                    }
                    <div className="border-top mt-3 pt-3 text-center">
                      <button type="button" className="btn btn-sm btn-outline-secondary"
                        onClick={() => setPasoModal('datos')}>
                        <i className="bi bi-keyboard me-1"/>Ingresar código manualmente
                      </button>
                    </div>
                  </>
                )}

                {(modalP !== 'nuevo' || pasoModal === 'datos') && (
                  <div className="row g-3">
                    <div className={modalP === 'nuevo' ? 'col-12' : 'col-md-4'}>
                      {modalP === 'nuevo' ? (
                        <div className="d-flex align-items-center gap-2 p-2 bg-light border rounded">
                          <button type="button" className="btn btn-sm btn-outline-secondary py-0 px-2 flex-shrink-0"
                            onClick={() => setPasoModal('codigo')}>
                            <i className="bi bi-arrow-left me-1"/>Código
                          </button>
                          <input className="form-control form-control-sm"
                            style={{fontFamily:'monospace', fontWeight:'bold', fontSize:'1rem', maxWidth:240}}
                            value={formP.codigo} required placeholder="Código del producto"
                            onChange={e => setFormP(p => ({...p, codigo: e.target.value.toUpperCase()}))}/>
                          <span className="text-muted small flex-shrink-0">editable si necesitás corregirlo</span>
                        </div>
                      ) : (
                        <>
                          <label className="form-label small fw-medium">Código *</label>
                          <input className="form-control" value={formP.codigo} required
                            onChange={e => setFormP(p => ({...p, codigo: e.target.value}))}/>
                        </>
                      )}
                    </div>
                    <div className={modalP === 'nuevo' ? 'col-12' : 'col-md-8'}>
                      <label className="form-label small fw-medium">Descripción *</label>
                      <input className="form-control" value={formP.descripcion} required
                        onChange={e => setFormP(p => ({...p, descripcion: e.target.value}))}/>
                    </div>
                    <div className="col-md-4">
                      <label className="form-label small fw-medium">Categoría</label>
                      <input className="form-control" value={formP.categoria} list="cats-list-c"
                        onChange={e => setFormP(p => ({...p, categoria: e.target.value}))}/>
                      <datalist id="cats-list-c">{cats.map(c => <option key={c} value={c}/>)}</datalist>
                    </div>
                    <div className="col-md-2">
                      <label className="form-label small fw-medium">Unidad</label>
                      <input className="form-control" value={formP.unidad}
                        onChange={e => setFormP(p => ({...p, unidad: e.target.value}))}/>
                    </div>
                    <div className="col-md-3">
                      <label className="form-label small fw-medium">Ubicación</label>
                      <input className="form-control" value={formP.ubicacion} list="ubics-list-c"
                        onChange={e => setFormP(p => ({...p, ubicacion: e.target.value}))}/>
                      <datalist id="ubics-list-c">{ubics.map(u => <option key={u} value={u}/>)}</datalist>
                    </div>
                    <div className="col-md-3">
                      <label className="form-label small fw-medium">Stock mínimo</label>
                      <input type="number" className="form-control" value={formP.stock_minimo} min="0" step="any"
                        onChange={e => setFormP(p => ({...p, stock_minimo: parseFloat(e.target.value)||0}))}/>
                    </div>
                    {modalP === 'nuevo' && (
                      <div className="col-md-3">
                        <label className="form-label small fw-medium">Stock inicial</label>
                        <input type="number" className="form-control" value={formP.stock_actual} min="0" step="any"
                          onChange={e => setFormP(p => ({...p, stock_actual: parseFloat(e.target.value)||0}))}/>
                      </div>
                    )}
                    <div className="col-md-3">
                      <label className="form-label small fw-medium">Precio costo</label>
                      <input type="number" className="form-control" value={formP.precio_costo} min="0" step="any"
                        onChange={e => setFormP(p => ({...p, precio_costo: parseFloat(e.target.value)||0}))}/>
                    </div>
                    <div className="col-md-3">
                      <label className="form-label small fw-medium">Precio venta</label>
                      <input type="number" className="form-control" value={formP.precio_venta} min="0" step="any"
                        onChange={e => setFormP(p => ({...p, precio_venta: parseFloat(e.target.value)||0}))}/>
                    </div>
                    <div className="col-md-4">
                      <label className="form-label small fw-medium">Proveedor principal</label>
                      <input className="form-control" value={formP.proveedor} list="provs-list-c"
                        placeholder="Seleccionar o escribir…"
                        onChange={e => setFormP(p => ({...p, proveedor: e.target.value}))}/>
                      <datalist id="provs-list-c">
                        {provsList.map(p => <option key={p.id} value={p.nombre}/>)}
                      </datalist>
                    </div>
                    <div className="col-md-4">
                      <label className="form-label small fw-medium">Código del proveedor</label>
                      <input className="form-control" value={formP.codigo_proveedor}
                        onChange={e => setFormP(p => ({...p, codigo_proveedor: e.target.value}))}/>
                    </div>
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setModalP(null)}>Cancelar</button>
                {(modalP !== 'nuevo' || pasoModal === 'datos') && (
                  <button type="submit" className="btn btn-primary" disabled={savP}>
                    {savP && <span className="spinner-border spinner-border-sm me-2"/>}Guardar
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
