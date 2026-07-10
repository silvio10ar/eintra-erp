import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'
import { PREFIJOS, FAM_NOMBRES } from './prefijos'


const FORM_VACIO = {
  codigo:'', descripcion:'', categoria:'', unidad:'UND.',
  stock_minimo:0, ubicacion:'', precio_costo:0, precio_venta:0, proveedor:'',
  codigo_generado: 0,
}

export default function Materiales() {
  const [items,        setItems]        = useState([])
  const [loading,      setLoading]      = useState(true)
  const [buscar,       setBuscar]       = useState('')
  const [filFam,       setFilFam]       = useState('')
  const [filAlerta,    setFilAlerta]    = useState('')
  const [modal,        setModal]        = useState(null)
  const [paso,         setPaso]         = useState('codigo')
  const [form,         setForm]         = useState(FORM_VACIO)
  const [saving,       setSaving]       = useState(false)
  const [err,          setErr]          = useState('')
  const [provsList,    setProvsList]    = useState([])
  // Selector correlativo (compartido entre modal nuevo/editar y modal cambio código)
  const [prefijoCod,   setPrefijoCod]   = useState('')
  const [codPropuesto, setCodPropuesto] = useState('')
  const [loadingCod,   setLoadingCod]   = useState(false)
  // Modal cambio de código para producto existente
  const [modalCodigo,  setModalCodigo]  = useState(null)
  const [savingCodigo, setSavingCodigo] = useState(false)
  // Modal desglose de código
  const [desgloseItem, setDesgloseItem] = useState(null)
  const [desgloseData, setDesgloseData] = useState(null)
  const [desgloseLoad, setDesgloseLoad] = useState(false)

  const cargar = useCallback((q = buscar) => {
    setLoading(true)
    api.get('/materiales', { params: q ? { buscar: q } : {} })
      .then(r => setItems(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [buscar])

  useEffect(() => {
    cargar('')
    api.get('/compras/proveedores').then(r => setProvsList(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    const t = setTimeout(() => cargar(buscar), 300)
    return () => clearTimeout(t)
  }, [buscar])

  // Fetch siguiente código disponible al seleccionar prefijo
  useEffect(() => {
    if (!prefijoCod) { setCodPropuesto(''); return }
    setLoadingCod(true)
    api.get(`/materiales/next-codigo/${prefijoCod}`)
      .then(r => setCodPropuesto(r.data.codigo))
      .catch(() => setCodPropuesto(''))
      .finally(() => setLoadingCod(false))
  }, [prefijoCod])

  const resetSelector = () => { setPrefijoCod(''); setCodPropuesto('') }

  const abrirNuevo = () => {
    setForm(FORM_VACIO); setErr(''); setPaso('codigo'); resetSelector(); setModal('nuevo')
  }
  const abrirEditar = item => {
    setForm({ ...item, codigo_generado: item.codigo_generado || 0 })
    setErr(''); setPaso('datos'); setModal(item)
  }
  const cerrar = () => { setModal(null); resetSelector() }

  const usarCodigo = (codigo, descripcion) => {
    setForm(p => ({ ...p, codigo, descripcion: descripcion || p.descripcion, codigo_generado: 0 }))
    resetSelector(); setPaso('datos')
  }

  const usarCodigoCorrelativo = (codigo) => {
    setForm(p => ({ ...p, codigo, codigo_generado: 1 }))
    resetSelector(); setPaso('datos')
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
      cerrar(); cargar(buscar)
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

  const abrirCambiarCodigo = item => {
    resetSelector(); setModalCodigo(item)
  }

  const confirmarCodigo = async () => {
    if (!codPropuesto || !modalCodigo) return
    setSavingCodigo(true)
    try {
      await api.put(`/materiales/${modalCodigo.id}`, {
        ...modalCodigo,
        codigo: codPropuesto,
        codigo_generado: 1,
      })
      setModalCodigo(null); resetSelector(); cargar(buscar)
    } catch(e) {
      alert(e.response?.data?.error || 'Error al guardar')
    } finally { setSavingCodigo(false) }
  }

  const verDesglose = async item => {
    setDesgloseItem(item); setDesgloseData(null); setDesgloseLoad(true)
    try {
      const r = await api.get(`/codificacion/desglose/${item.codigo}`)
      setDesgloseData(r.data)
    } catch { setDesgloseData({ error: true }) }
    finally { setDesgloseLoad(false) }
  }

  const getFam      = cod => FAM_NOMBRES[cod?.[0]] || null
  const getTipoDesc = cod => PREFIJOS.find(p => p.p === cod?.slice(0,3))?.d || null
  const getFamKey   = cod => cod?.[0] || ''

  const esNuevo = modal === 'nuevo'
  const fams = [...new Set(items.map(i => getFamKey(i.codigo)).filter(k => FAM_NOMBRES[k]))].sort()
  const itemsFiltrados = items.filter(i => {
    if (filFam && getFamKey(i.codigo) !== filFam) return false
    if (filAlerta === 'ok')      return i.stock_actual > 0
    if (filAlerta === 'bajo')    return i.stock_actual > 0 && i.stock_minimo > 0 && i.stock_actual <= i.stock_minimo
    if (filAlerta === 'agotado') return i.stock_actual <= 0
    return true
  })

  return (
    <div>
      <div className="d-flex justify-content-between align-items-center mb-3">
        <div>
          <h4 className="mb-0">Catálogo de materiales</h4>
          <p className="text-muted small mb-0">Gestión del catálogo — sin modificación de cantidades</p>
        </div>
        <div className="d-flex align-items-center gap-3">
          <div className="d-flex align-items-center gap-2" style={{fontSize:'0.78rem', color:'#6c757d'}}>
            <span style={{display:'inline-block',width:10,height:10,borderRadius:2,
              background:'rgba(13,110,253,0.12)',border:'1px solid rgba(13,110,253,0.35)'}}/>
            Código nuevo
            <span style={{display:'inline-block',width:10,height:10,borderRadius:2,
              background:'#f8f9fa',border:'1px solid #dee2e6'}}/>
            Código original
          </div>
          <button className="btn btn-primary btn-sm" onClick={abrirNuevo}>
            <i className="bi bi-plus-circle me-1"/>Agregar material
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="d-flex flex-wrap gap-2 mb-3 align-items-center">
        <div className="position-relative">
          <input className="form-control form-control-sm" style={{width:280}}
            placeholder="Buscar por código, descripción o proveedor..."
            value={buscar} onChange={e => setBuscar(e.target.value)}/>
          {buscar && (
            <button className="btn btn-sm position-absolute top-0 end-0 py-0 px-1 text-muted"
              onClick={() => setBuscar('')}><i className="bi bi-x"/></button>
          )}
        </div>
        <select className="form-select form-select-sm" style={{width:220}}
          value={filFam} onChange={e => setFilFam(e.target.value)}>
          <option value="">Todas las familias</option>
          {fams.map(k => <option key={k} value={k}>{k} — {FAM_NOMBRES[k]}</option>)}
        </select>
        <div className="btn-group btn-group-sm">
          {[['','Todos'],['ok','Disponibles'],['bajo','Stock bajo'],['agotado','Agotados']].map(([v,l]) => (
            <button key={v} className={`btn btn-outline-secondary ${filAlerta===v?'active':''}`}
              onClick={() => setFilAlerta(v)}>{l}</button>
          ))}
        </div>
      </div>

      {/* Tabla */}
      <div className="card">
        <div className="card-body p-0">
          {loading ? (
            <div className="text-center py-5 text-muted">
              <span className="spinner-border spinner-border-sm me-2"/>Cargando...
            </div>
          ) : itemsFiltrados.length === 0 ? (
            <div className="text-center py-5 text-muted">
              <i className="bi bi-inbox fs-3 d-block mb-2"/>
              {buscar || filFam || filAlerta ? 'Sin resultados para los filtros aplicados' : 'No hay materiales en el catálogo'}
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-sm table-hover align-middle mb-0">
                <thead className="table-light">
                  <tr>
                    <th style={{width:130}}>Código</th>
                    <th>Descripción</th>
                    <th style={{width:140}}>Familia</th>
                    <th style={{width:160}}>Tipo</th>
                    <th style={{width:70}}>Unidad</th>
                    <th className="text-end" style={{width:70}}>Stock</th>
                    <th style={{width:60}}>S.Mín</th>
                    <th>Proveedor</th>
                    <th style={{width:95}}></th>
                  </tr>
                </thead>
                <tbody>
                  {itemsFiltrados.map(item => (
                    <tr key={item.id}
                      style={item.codigo_generado ? {background:'rgba(13,110,253,0.06)'} : {}}>
                      <td>
                        <code
                          className={`fw-semibold ${item.codigo_generado ? 'text-primary' : 'text-secondary'}`}
                          style={{letterSpacing:1, cursor:'pointer', textDecoration:'underline dotted'}}
                          title="Ver desglose del código"
                          onClick={() => verDesglose(item)}
                        >
                          {item.codigo}
                        </code>
                      </td>
                      <td>
                        <div>
                          {item.descripcion}
                        </div>
                      </td>
                      <td>
                        <span className="text-muted small">
                          {getFam(item.codigo) || item.categoria || '—'}
                        </span>
                      </td>
                      <td>
                        <span className="text-muted small">
                          {getTipoDesc(item.codigo) || '—'}
                        </span>
                      </td>
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
                          <button className="btn btn-xs btn-outline-primary py-0 px-2"
                            style={{fontSize:'0.75rem'}}
                            title="Asignar / cambiar código"
                            onClick={() => abrirCambiarCodigo(item)}>
                            <i className="bi bi-tag"/>
                          </button>
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
                {itemsFiltrados.length}{itemsFiltrados.length !== items.length ? ` de ${items.length}` : ''} material{itemsFiltrados.length !== 1 ? 'es' : ''}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Modal nuevo / editar ─────────────────────────────────────── */}
      {modal && (
        <div className="modal fade show d-block" style={{background:'rgba(0,0,0,.5)'}}>
          <div className={`modal-dialog modal-dialog-centered modal-dialog-scrollable ${paso === 'codigo' ? 'modal-xl' : 'modal-lg'}`}>
            <div className="modal-content">
              <div className="modal-header py-2">
                <h6 className="modal-title mb-0 d-flex align-items-center gap-2">
                  {esNuevo ? (
                    paso === 'codigo'
                      ? <><span className="badge bg-primary">Paso 1</span>Asignar código</>
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
                    {/* ── Sistema correlativo ── */}
                    <div className="mb-1">
                      <p className="fw-medium small mb-2 text-primary">
                        <i className="bi bi-hash me-1"/>Sistema correlativo
                      </p>
                      <SelectorCorrelativo
                        prefijo={prefijoCod}
                        codigo={codPropuesto}
                        loading={loadingCod}
                        onPrefijo={setPrefijoCod}
                        onUsar={usarCodigoCorrelativo}
                      />
                    </div>
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
                            title="Volver al asistente de código"
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
                        <select className="form-select" value={form.proveedor}
                          onChange={e => setForm(p => ({...p, proveedor: e.target.value}))}>
                          <option value="">— Sin proveedor —</option>
                          {provsList.map(p => <option key={p.id} value={p.nombre}>{p.nombre}</option>)}
                        </select>
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
                    <i className="bi bi-arrow-left me-1"/>Volver
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

      {/* ── Modal cambio de código ────────────────────────────────────── */}
      {modalCodigo && (
        <div className="modal fade show d-block" style={{background:'rgba(0,0,0,.5)'}}>
          <div className="modal-dialog modal-dialog-centered" style={{maxWidth:540}}>
            <div className="modal-content">
              <div className="modal-header py-2">
                <div>
                  <h6 className="modal-title mb-0">
                    <i className="bi bi-tag me-2 text-primary"/>Asignar código nuevo
                  </h6>
                  <div className="small text-muted text-truncate" style={{maxWidth:420}}>
                    <code className="me-2 text-secondary">{modalCodigo.codigo}</code>
                    {modalCodigo.descripcion}
                  </div>
                </div>
                <button className="btn-close" onClick={() => { setModalCodigo(null); resetSelector() }}/>
              </div>
              <div className="modal-body">
                <SelectorCorrelativo
                  prefijo={prefijoCod}
                  codigo={codPropuesto}
                  loading={loadingCod}
                  onPrefijo={setPrefijoCod}
                  onUsar={null}
                />
              </div>
              <div className="modal-footer py-2">
                <button className="btn btn-sm btn-secondary"
                  onClick={() => { setModalCodigo(null); resetSelector() }}>
                  Cancelar
                </button>
                <button className="btn btn-sm btn-primary"
                  disabled={!codPropuesto || savingCodigo}
                  onClick={confirmarCodigo}>
                  {savingCodigo
                    ? <><span className="spinner-border spinner-border-sm me-1"/>Guardando...</>
                    : <><i className="bi bi-check-lg me-1"/>Aplicar
                        {codPropuesto && <code className="ms-2" style={{fontSize:'0.8em'}}>{codPropuesto}</code>}
                      </>
                  }
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal desglose ────────────────────────────────────────────── */}
      {desgloseItem && (
        <div className="modal fade show d-block" style={{background:'rgba(0,0,0,.45)'}}
          onClick={e => { if (e.target === e.currentTarget) { setDesgloseItem(null); setDesgloseData(null) } }}>
          <div className="modal-dialog modal-dialog-centered" style={{maxWidth:560}}>
            <div className="modal-content">
              <div className="modal-header py-2">
                <div>
                  <h6 className="modal-title mb-0">
                    <i className="bi bi-grid-3x3-gap me-2 text-primary"/>Desglose del código
                  </h6>
                  <div className="small text-muted text-truncate" style={{maxWidth:420}}>
                    {desgloseItem.descripcion}
                  </div>
                </div>
                <button className="btn-close btn-sm"
                  onClick={() => { setDesgloseItem(null); setDesgloseData(null) }}/>
              </div>
              <div className="modal-body py-3">
                {desgloseLoad ? (
                  <div className="text-center py-4">
                    <span className="spinner-border spinner-border-sm text-primary"/>
                  </div>
                ) : desgloseData?.error ? (
                  <div className="alert alert-danger py-2 small mb-0">
                    No se pudo obtener el desglose de este código.
                  </div>
                ) : desgloseData ? (
                  <>
                    <DesgloseVisual codigo={desgloseItem.codigo} posiciones={desgloseData.posiciones}/>
                    <div className="text-center mb-3">
                      {desgloseData.familia
                        ? <span className="badge bg-dark">{desgloseData.familia}</span>
                        : <span className="badge bg-danger">Familia no reconocida</span>}
                    </div>
                    <table className="table table-sm table-bordered mb-0" style={{fontSize:'0.82rem'}}>
                      <thead className="table-light">
                        <tr>
                          <th style={{width:50}} className="text-center">Pos.</th>
                          <th style={{width:150}}>Campo</th>
                          <th style={{width:65}} className="text-center">Valor</th>
                          <th>Descripción</th>
                        </tr>
                      </thead>
                      <tbody>
                        {desgloseData.posiciones.map((p, i) => {
                          const COLS = ['primary','success','warning','info','secondary','dark']
                          const col  = COLS[i % COLS.length]
                          return (
                            <tr key={i}>
                              <td className="text-center">
                                <code className={`text-${col} fw-semibold`} style={{fontSize:'0.8rem'}}>{p.pos}</code>
                              </td>
                              <td className="text-muted small align-middle">{p.etiqueta}</td>
                              <td className="text-center align-middle">
                                <code className={`badge bg-${col} fw-normal font-monospace`}
                                  style={{letterSpacing:1, fontSize:'0.78rem'}}>
                                  {p.valor}
                                </code>
                              </td>
                              <td className={`align-middle small ${
                                p.estado === 'error' ? 'text-danger fw-semibold' :
                                p.estado === 'obs'   ? 'text-warning' :
                                p.estado === 'libre' ? 'text-muted fst-italic' : ''
                              }`}>
                                {p.descripcion}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Selector de familia + código correlativo ────────────────────────────────
function SelectorCorrelativo({ prefijo, codigo, loading, onPrefijo, onUsar }) {
  const grupos = {}
  PREFIJOS.forEach(({ p, d }) => {
    const f = p[0]
    if (!grupos[f]) grupos[f] = []
    grupos[f].push({ p, d })
  })

  return (
    <div className="row g-2 align-items-end">
      <div className="col">
        <label className="form-label small fw-medium mb-1">Familia / Tipo</label>
        <select className="form-select" value={prefijo} onChange={e => onPrefijo(e.target.value)}>
          <option value="">— Seleccionar —</option>
          {Object.entries(grupos).map(([fam, items]) => (
            <optgroup key={fam} label={`${fam}  ·  ${FAM_NOMBRES[fam] || ''}`}>
              {items.map(({ p, d }) => (
                <option key={p} value={p}>{p}  ·  {d}</option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="col-auto">
        <label className="form-label small fw-medium mb-1">Código</label>
        <div className="input-group">
          <span className="input-group-text bg-light px-2">
            {loading
              ? <span className="spinner-border" style={{width:'0.85em',height:'0.85em',borderWidth:'0.15em'}}/>
              : <i className="bi bi-hash text-muted"/>}
          </span>
          <input
            className="form-control font-monospace fw-semibold text-primary"
            style={{width:145, letterSpacing:2}}
            readOnly value={codigo} placeholder="———"
          />
          {onUsar && (
            <button className="btn btn-primary" disabled={!codigo || loading}
              onClick={() => onUsar(codigo)}>
              <i className="bi bi-check-lg me-1"/>Usar
            </button>
          )}
        </div>
        {codigo && !loading && (
          <div className="text-muted mt-1" style={{fontSize:'0.72rem'}}>
            <i className="bi bi-shield-check me-1 text-success"/>Disponible
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Visualización del código por segmentos ──────────────────────────────────
function DesgloseVisual({ codigo, posiciones }) {
  const COLS = ['primary','success','warning','info','secondary','dark']
  const charInfo = Array.from({ length: 10 }, (_, i) => {
    const idx = posiciones.findIndex(p => p.pos_desde <= i + 1 && i + 1 <= p.pos_hasta)
    return { col: COLS[idx % COLS.length] ?? 'muted', idx }
  })
  const grupos = []
  let g = null
  charInfo.forEach((ci, i) => {
    if (!g || g.idx !== ci.idx) { g = { col: ci.col, idx: ci.idx, chars: '' }; grupos.push(g) }
    g.chars += codigo[i] ?? '?'
  })
  return (
    <div className="text-center mb-2">
      <div className="d-inline-flex font-monospace" style={{gap:2}}>
        {grupos.map((g, i) => (
          <span key={i} className={`fw-bold text-${g.col}`}
            style={{fontSize:'1.25rem', borderBottom:`3px solid var(--bs-${g.col})`,
              paddingBottom:2, letterSpacing:2}}
            title={posiciones[g.idx]?.etiqueta}>
            {g.chars}
          </span>
        ))}
      </div>
    </div>
  )
}
