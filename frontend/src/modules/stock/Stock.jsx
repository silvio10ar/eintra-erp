import { useState, useEffect, useCallback, useRef } from 'react'
import api from '../../api/client'
import { puedeEscribir } from '../../store/authStore'

const TIPOS = [
  { v:'entrada',    l:'Entrada',    c:'success' },
  { v:'salida',     l:'Salida',     c:'danger'  },
  { v:'devolucion', l:'Devolución', c:'warning' },
  { v:'ajuste',     l:'Ajuste',     c:'info'    },
]
const fmt  = n => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(n ?? 0)
const hoy  = () => new Date().toISOString().slice(0,10)
const fmtF = iso => iso ? iso.slice(0,10).split('-').reverse().join('/') : '—'

const FORM_M ={ producto_id:'', tipo:'entrada', cantidad:'', fecha:hoy(), referencia:'', precio_unit:0, proveedor:'', proyecto:'', cliente_interno:'', observaciones:'' }
const FORM_H = { desde:'', hasta:'', tipo:'', campo:'todos', valor:'' }

export default function Stock() {
  const canWrite = puedeEscribir('stock')

  /* ── Estado productos ───────────────────────────────────────────── */
  const [prods, setProds]     = useState([])
  const [ubics, setUbics]     = useState([])
  const [loading, setLoading] = useState(true)
  const [selId, setSelId]     = useState(null)
  const [buscar, setBuscar]   = useState('')
  const [filUbic, setFilUbic] = useState('')
  const [filAlerta, setFilAlerta] = useState('')   // ''|'ok'|'bajo'|'agotado'

  /* ── Estado modales ─────────────────────────────────────────────── */
  const [modalUbic, setModalUbic] = useState(null)  // null | prod
  const [ubicVal,   setUbicVal]   = useState('')
  const [savUbic,   setSavUbic]   = useState(false)

  const [modalM, setModalM]   = useState(null)    // null | { tipo }
  const [formM, setFormM]     = useState(FORM_M)
  const [savM, setSavM]       = useState(false)
  const [errM, setErrM]       = useState('')
  const [buscarP, setBuscarP] = useState('')
  const [sugs, setSugs]       = useState([])

  const [modalH, setModalH]   = useState(false)
  const [filtH, setFiltH]     = useState(FORM_H)
  const [movs, setMovs]       = useState([])
  const [totalMovs, setTotalMovs] = useState(0)
  const [pageH, setPageH]     = useState(1)
  const [loadH, setLoadH]     = useState(false)
  const [valoresH, setValoresH] = useState([])  // autocomplete del campo Valor
  const [provsList, setProvsList] = useState([])

  /* ── Ingresos pendientes ─────────────────────────────────────────── */
  const [ingPend, setIngPend]         = useState([])
  const [modalIngPend, setModalIngPend] = useState(false)
  const [savIng, setSavIng]           = useState(null)   // id del item en proceso

  const cargarIngPend = useCallback(() => {
    api.get('/stock/ingresos-pendientes').then(r => setIngPend(r.data)).catch(() => {})
  }, [])

  useEffect(() => { cargarIngPend() }, [cargarIngPend])

  const confirmarIngreso = async id => {
    setSavIng(id)
    try {
      await api.post(`/stock/ingresos-pendientes/${id}/confirmar`)
      cargarIngPend(); cargar()
    } catch(err) { alert(err.response?.data?.error ?? 'Error al confirmar') }
    finally { setSavIng(null) }
  }

  const rechazarIngreso = async (id, desc) => {
    if (!confirm(`¿Rechazar ingreso de "${desc}"? El material NO entrará al stock.`)) return
    setSavIng(id)
    try {
      await api.delete(`/stock/ingresos-pendientes/${id}`)
      cargarIngPend()
    } catch(err) { alert(err.response?.data?.error ?? 'Error') }
    finally { setSavIng(null) }
  }

  /* ── Cargar productos ───────────────────────────────────────────── */
  const cargar = useCallback(() => {
    setLoading(true)
    api.get('/stock/productos', { params: { buscar: buscar||undefined, ubicacion: filUbic||undefined, alerta: filAlerta||undefined } })
      .then(r => setProds(r.data))
      .finally(() => setLoading(false))
  }, [buscar, filUbic, filAlerta])

  useEffect(() => { cargar() }, [cargar])

  useEffect(() => {
    api.get('/stock/productos/ubicaciones').then(r => setUbics(r.data))
    api.get('/compras/proveedores').then(r => setProvsList(r.data)).catch(() => {})
  }, [])

  /* ── Cargar historial ───────────────────────────────────────────── */
  const cargarHistorial = useCallback(() => {
    if (!modalH) return
    setLoadH(true)
    const params = { page: pageH, limit: 200,
      tipo: filtH.tipo||undefined, desde: filtH.desde||undefined, hasta: filtH.hasta||undefined,
      campo: filtH.campo !== 'todos' ? filtH.campo : undefined, valor: filtH.valor||undefined }
    api.get('/stock/movimientos', { params })
      .then(r => { setMovs(r.data.datos); setTotalMovs(r.data.total) })
      .finally(() => setLoadH(false))
  }, [modalH, filtH, pageH])

  useEffect(() => { cargarHistorial() }, [cargarHistorial])

  // Autocompletado Valor según campo seleccionado
  useEffect(() => {
    if (filtH.campo === 'todos') { setValoresH([]); return }
    api.get('/stock/movimientos/valores', { params: { campo: filtH.campo } })
      .then(r => setValoresH(r.data))
      .catch(() => setValoresH([]))
  }, [filtH.campo])

  /* ── Sugerencias búsqueda de producto en modal movimiento ────────── */
  useEffect(() => {
    if (!buscarP) { setSugs([]); return }
    const q = buscarP.toLowerCase()
    setSugs(prods.filter(p => p.codigo.toLowerCase().includes(q) || p.descripcion.toLowerCase().includes(q)).slice(0, 8))
  }, [buscarP, prods])

  /* ── Producto seleccionado ──────────────────────────────────────── */
  const sel = prods.find(p => p.id === selId)

  /* ── Abrir modales ──────────────────────────────────────────────── */
  const abrirEditarUbic = p => { if (!p) return; setUbicVal(p.ubicacion || ''); setModalUbic(p) }

  const abrirMov = (tipo) => {
    const p = sel
    setFormM({ ...FORM_M, tipo, fecha: hoy(), producto_id: p?.id??'' })
    setBuscarP(p ? `${p.codigo} — ${p.descripcion}` : '')
    setSugs([]); setErrM(''); setModalM({ tipo })
  }

  /* ── Guardar ubicación ──────────────────────────────────────────── */
  const guardarUbic = async e => {
    e.preventDefault(); setSavUbic(true)
    try {
      await api.put(`/stock/productos/${modalUbic.id}`, { ...modalUbic, ubicacion: ubicVal })
      setModalUbic(null); cargar()
    } catch { alert('Error al guardar') }
    finally { setSavUbic(false) }
  }

  /* ── Guardar movimiento ─────────────────────────────────────────── */
  const guardarM = async e => {
    e.preventDefault(); setSavM(true); setErrM('')
    try {
      const { data } = await api.post('/stock/movimientos', formM)
      setModalM(null); cargar()
      alert(data.mensaje)
    } catch(err) { setErrM(err.response?.data?.error ?? 'Error al registrar') }
    finally { setSavM(false) }
  }

  /* ── Exportar ───────────────────────────────────────────────────── */
  const exportar = tipo => {
    const params = new URLSearchParams()
    if (tipo === 'filtrado') { if (buscar) params.set('buscar',buscar); if (filUbic) params.set('ubicacion',filUbic); if (filAlerta) params.set('alerta',filAlerta) }
    if (tipo === 'entradas') params.set('tipo_export','entradas')
    if (tipo === 'salidas')  params.set('tipo_export','salidas')
    window.open(`/api/v1/stock/exportar?${params}`, '_blank')
  }

  const exportarHistorial = () => {
    const params = new URLSearchParams()
    if (filtH.tipo)  params.set('tipo', filtH.tipo)
    if (filtH.desde) params.set('desde', filtH.desde)
    if (filtH.hasta) params.set('hasta', filtH.hasta)
    if (filtH.campo !== 'todos' && filtH.valor) { params.set('campo',filtH.campo); params.set('valor',filtH.valor) }
    window.open(`/api/v1/stock/exportar-historial?${params}`, '_blank')
  }

  /* ── Contadores barra estado ────────────────────────────────────── */
  const total     = prods.length
  const disponibles = prods.filter(p => p.stock_actual > 0).length
  const stockBajo   = prods.filter(p => p.stock_actual > 0 && p.stock_minimo > 0 && p.stock_actual <= p.stock_minimo).length
  const agotados    = prods.filter(p => p.stock_actual <= 0).length
  const totalPags   = Math.ceil(totalMovs / 200)

  return (
    <>
      {/* ── Título ────────────────────────────────────────────────── */}
      <h5 className="fw-bold mb-3">Stock</h5>

      {/* ── Toolbar ───────────────────────────────────────────────── */}
      <div className="d-flex flex-wrap gap-2 mb-3">
        {canWrite && <>
          <button className="btn btn-sm btn-outline-primary" onClick={() => abrirEditarUbic(sel)} disabled={!sel}><i className="bi bi-geo-alt me-1"/>Editar ubicación</button>
          <div className="vr mx-1"/>
          <button className="btn btn-sm btn-outline-success" onClick={() => abrirMov('entrada')}   disabled={!sel}><i className="bi bi-arrow-up me-1"/>Entrada</button>
          <button className="btn btn-sm btn-outline-danger"  onClick={() => abrirMov('salida')}    disabled={!sel}><i className="bi bi-arrow-down me-1"/>Salida</button>
          <button className="btn btn-sm btn-outline-warning" onClick={() => abrirMov('devolucion')} disabled={!sel}><i className="bi bi-arrow-return-left me-1"/>Devolución</button>
          <div className="vr mx-1"/>
        </>}
        <button className="btn btn-sm btn-outline-secondary" onClick={() => { setModalH(true); setPageH(1) }}>
          <i className="bi bi-clock-history me-1"/>Historial
        </button>
        <button className={`btn btn-sm position-relative ${ingPend.length > 0 ? 'btn-warning' : 'btn-outline-secondary'}`}
          onClick={() => setModalIngPend(true)}>
          <i className="bi bi-box-arrow-in-down me-1"/>Ingresos pendientes
          {ingPend.length > 0 && (
            <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger"
              style={{fontSize:'0.68rem'}}>{ingPend.length}</span>
          )}
        </button>
        <div className="dropdown">
          <button className="btn btn-sm btn-outline-secondary dropdown-toggle" data-bs-toggle="dropdown">
            <i className="bi bi-file-excel me-1"/>Exportar
          </button>
          <ul className="dropdown-menu">
            <li><button className="dropdown-item" onClick={() => exportar('filtrado')}>Stock filtrado</button></li>
            <li><button className="dropdown-item" onClick={() => exportar('completo')}>Stock completo</button></li>
          </ul>
        </div>
      </div>

      {/* ── Filtros ───────────────────────────────────────────────── */}
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

      {/* ── Tabla ─────────────────────────────────────────────────── */}
      <div className="card border-0 shadow-sm">
        {loading
          ? <div className="text-center py-5"><div className="spinner-border text-secondary"/></div>
          : <div className="table-responsive" style={{maxHeight:'calc(100vh - 300px)', overflowY:'auto'}}>
              <table className="table table-hover table-sm mb-0" style={{fontSize:'0.83rem'}}>
                <thead className="table-dark sticky-top">
                  <tr>
                    <th>CÓDIGO</th>
                    <th>DESCRIPCIÓN</th>
                    <th className="text-end">STOCK</th>
                    <th className="text-center">DISPONIB</th>
                    <th>UBICACIÓN</th>
                    <th className="text-end">MÍNIMO</th>
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
                            style={{ cursor:'pointer', color: agot ? '#dc3545' : bajo ? '#d97706' : undefined }}
                            onClick={() => setSelId(p.id === selId ? null : p.id)}
                            onDoubleClick={() => canWrite && abrirEditarUbic(p)}>
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
        {/* Barra estado */}
        <div className="border-top px-3 py-1 d-flex gap-3 text-muted" style={{fontSize:'0.78rem', background:'#f8f9fa'}}>
          <span>Total: <strong>{total}</strong></span>
          <span className="text-success">✓ Disponibles: <strong>{disponibles}</strong></span>
          <span className="text-warning">⚠ Stock bajo: <strong>{stockBajo}</strong></span>
          <span className="text-danger">✗ Agotados: <strong>{agotados}</strong></span>
          {sel && <span className="ms-auto text-primary">Seleccionado: <strong>{sel.codigo}</strong> — {sel.descripcion}</span>}
        </div>
      </div>

      {/* ══ MODAL: HISTORIAL ════════════════════════════════════════ */}
      {modalH && (
        <div className="modal show d-block" style={{background:'rgba(0,0,0,.5)'}}>
          <div className="modal-dialog modal-xl modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h5 className="modal-title">Historial de Movimientos</h5>
                <button className="btn-close" onClick={() => setModalH(false)}/>
              </div>
              <div className="modal-body p-0">
                {/* Filtros historial */}
                <div className="border-bottom p-2 bg-light d-flex flex-wrap gap-2 align-items-end">
                  <div>
                    <label className="form-label mb-1" style={{fontSize:'0.75rem'}}>Desde</label>
                    <input type="date" className="form-control form-control-sm" style={{width:130}}
                      value={filtH.desde} onChange={e => { setFiltH(p=>({...p,desde:e.target.value})); setPageH(1) }}/>
                  </div>
                  <div>
                    <label className="form-label mb-1" style={{fontSize:'0.75rem'}}>Hasta</label>
                    <input type="date" className="form-control form-control-sm" style={{width:130}}
                      value={filtH.hasta} onChange={e => { setFiltH(p=>({...p,hasta:e.target.value})); setPageH(1) }}/>
                  </div>
                  <div>
                    <label className="form-label mb-1" style={{fontSize:'0.75rem'}}>Tipo</label>
                    <select className="form-select form-select-sm" style={{width:120}}
                      value={filtH.tipo} onChange={e => { setFiltH(p=>({...p,tipo:e.target.value})); setPageH(1) }}>
                      <option value="">Todos</option>
                      {TIPOS.map(t=><option key={t.v} value={t.v}>{t.l}</option>)}
                    </select>
                  </div>
                  <div className="vr mx-1"/>
                  <div>
                    <label className="form-label mb-1" style={{fontSize:'0.75rem'}}>Campo</label>
                    <select className="form-select form-select-sm" style={{width:150}}
                      value={filtH.campo} onChange={e => setFiltH(p=>({...p,campo:e.target.value}))}>
                      <option value="todos">Todos los campos</option>
                      <option value="codigo">Código</option>
                      <option value="descripcion">Descripción</option>
                      <option value="proveedor">Proveedor</option>
                      <option value="proyecto">Proyecto</option>
                      <option value="cliente_interno">Cliente Int.</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label mb-1" style={{fontSize:'0.75rem'}}>Valor</label>
                    <input className="form-control form-control-sm" style={{width:180}} placeholder="Buscar…"
                      list="hist-valores-list" disabled={filtH.campo==='todos'}
                      value={filtH.valor} onChange={e => { setFiltH(p=>({...p,valor:e.target.value})); setPageH(1) }}/>
                    <datalist id="hist-valores-list">
                      {valoresH.map(v => <option key={v} value={v}/>)}
                    </datalist>
                  </div>
                  <button className="btn btn-sm btn-outline-secondary" onClick={() => { setFiltH(FORM_H); setPageH(1) }}>Limpiar</button>
                </div>

                {/* Tabla historial */}
                {loadH
                  ? <div className="text-center py-4"><div className="spinner-border text-secondary"/></div>
                  : <div className="table-responsive">
                      <table className="table table-sm table-hover mb-0" style={{fontSize:'0.8rem'}}>
                        <thead className="table-light">
                          <tr>
                            <th>FECHA</th><th>CÓDIGO</th><th>DESCRIPCIÓN</th><th>TIPO</th>
                            <th className="text-end">CANT.</th><th>PROVEEDOR</th>
                            <th className="text-end">PRECIO U.</th><th>PROYECTO</th>
                            <th>CLIENTE INT.</th><th>OBS.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {movs.length === 0
                            ? <tr><td colSpan={10} className="text-center text-muted py-3">Sin resultados</td></tr>
                            : movs.map(m => (
                              <tr key={m.id} style={{color: m.tipo==='salida'?'#dc3545': m.tipo==='entrada'?'#198754':undefined}}>
                                <td className="text-nowrap">{fmtF(m.fecha)}</td>
                                <td className="fw-semibold">{m.codigo}</td>
                                <td><div className="text-truncate" style={{maxWidth:200}} title={m.descripcion}>{m.descripcion}</div></td>
                                <td><span className={`badge bg-${TIPOS.find(t=>t.v===m.tipo)?.c??'secondary'}`}>{m.tipo}</span></td>
                                <td className="text-end fw-semibold">{fmt(m.cantidad)}</td>
                                <td className="text-muted">{m.proveedor||'—'}</td>
                                <td className="text-end">{m.precio_unit > 0 ? fmt(m.precio_unit) : '—'}</td>
                                <td className="text-muted">{m.proyecto||'—'}</td>
                                <td className="text-muted">{m.cliente_interno||'—'}</td>
                                <td><div className="text-truncate" style={{maxWidth:150}} title={m.observaciones}>{m.observaciones||'—'}</div></td>
                              </tr>
                            ))
                          }
                        </tbody>
                      </table>
                    </div>
                }
              </div>
              <div className="modal-footer py-2 justify-content-between">
                <div className="d-flex align-items-center gap-3">
                  <small className="text-muted">Mostrando {movs.length} de {totalMovs} movimientos</small>
                  {totalPags > 1 && (
                    <div className="d-flex gap-1">
                      <button className="btn btn-xs btn-outline-secondary py-0 px-2" disabled={pageH===1} onClick={()=>setPageH(p=>p-1)}>‹</button>
                      <span className="btn btn-xs btn-light py-0 px-2 disabled">{pageH}/{totalPags}</span>
                      <button className="btn btn-xs btn-outline-secondary py-0 px-2" disabled={pageH>=totalPags} onClick={()=>setPageH(p=>p+1)}>›</button>
                    </div>
                  )}
                </div>
                <div className="d-flex gap-2">
                  <button className="btn btn-sm btn-outline-success" onClick={exportarHistorial}>
                    <i className="bi bi-file-excel me-1"/>Exportar filtrado
                  </button>
                  <button className="btn btn-sm btn-secondary" onClick={() => setModalH(false)}>Cerrar</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL: EDITAR UBICACIÓN ══════════════════════════════════ */}
      {modalUbic && (
        <div className="modal show d-block" style={{background:'rgba(0,0,0,.4)'}}>
          <div className="modal-dialog modal-sm">
            <form className="modal-content" onSubmit={guardarUbic}>
              <div className="modal-header py-2">
                <h6 className="modal-title">Editar ubicación</h6>
                <button type="button" className="btn-close" onClick={() => setModalUbic(null)}/>
              </div>
              <div className="modal-body">
                <p className="small text-muted mb-2">
                  <strong>{modalUbic.codigo}</strong> — {modalUbic.descripcion}
                </p>
                <input className="form-control" autoFocus
                  placeholder="Ej: Estante A3"
                  list="ubics-stock-list"
                  value={ubicVal}
                  onChange={e => setUbicVal(e.target.value)} />
                <datalist id="ubics-stock-list">
                  {ubics.map(u => <option key={u} value={u}/>)}
                </datalist>
              </div>
              <div className="modal-footer py-2">
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setModalUbic(null)}>Cancelar</button>
                <button type="submit" className="btn btn-sm btn-primary" disabled={savUbic}>
                  {savUbic && <span className="spinner-border spinner-border-sm me-1"/>}Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══ MODAL: MOVIMIENTO ═══════════════════════════════════════ */}
      {modalM && (
        <div className="modal show d-block" style={{background:'rgba(0,0,0,.4)'}}>
          <div className="modal-dialog modal-lg">
            <form className="modal-content" onSubmit={guardarM}>
              <div className="modal-header">
                <h5 className="modal-title">
                  Registrar {TIPOS.find(t=>t.v===formM.tipo)?.l}
                </h5>
                <button type="button" className="btn-close" onClick={()=>setModalM(null)}/>
              </div>
              <div className="modal-body">
                {errM && <div className="alert alert-danger py-2 small">{errM}</div>}
                <div className="row g-3">
                  {/* Tipo */}
                  <div className="col-md-4">
                    <label className="form-label small fw-medium">Tipo *</label>
                    <select className="form-select" value={formM.tipo} onChange={e=>setFormM(p=>({...p,tipo:e.target.value}))}>
                      {TIPOS.map(t=><option key={t.v} value={t.v}>{t.l}</option>)}
                    </select>
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-medium">Cantidad *</label>
                    <input type="number" className="form-control" value={formM.cantidad} required min="0.001" step="any" onChange={e=>setFormM(p=>({...p,cantidad:e.target.value}))}/>
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-medium">Fecha *</label>
                    <input type="date" className="form-control" value={formM.fecha} required onChange={e=>setFormM(p=>({...p,fecha:e.target.value}))}/>
                  </div>
                  {/* Búsqueda producto */}
                  <div className="col-12 position-relative">
                    <label className="form-label small fw-medium">Producto *</label>
                    <input className="form-control" placeholder="Buscar por código o descripción…"
                      value={buscarP} onChange={e=>{setBuscarP(e.target.value); setFormM(p=>({...p,producto_id:''}))}}/>
                    {sugs.length > 0 && (
                      <div className="border rounded shadow-sm position-absolute w-100 bg-white" style={{zIndex:9999,top:'100%',maxHeight:220,overflowY:'auto'}}>
                        {sugs.map(p=>(
                          <div key={p.id} className="px-3 py-2 border-bottom d-flex justify-content-between"
                            style={{cursor:'pointer',fontSize:'0.84rem'}}
                            onMouseEnter={e=>e.currentTarget.classList.add('bg-light')}
                            onMouseLeave={e=>e.currentTarget.classList.remove('bg-light')}
                            onClick={()=>{setFormM(prev=>({...prev,producto_id:p.id})); setBuscarP(`${p.codigo} — ${p.descripcion}`); setSugs([])}}>
                            <span><strong>{p.codigo}</strong> — {p.descripcion}</span>
                            <span className={`badge ${p.stock_actual>0?'bg-success':'bg-danger'}`}>Stock: {fmt(p.stock_actual)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Campos extras */}
                  <div className="col-md-4">
                    <label className="form-label small fw-medium">Proveedor</label>
                    <input className="form-control" value={formM.proveedor} placeholder="Nombre del proveedor"
                      list="stock-provs-list"
                      onChange={e=>setFormM(p=>({...p,proveedor:e.target.value}))}/>
                    <datalist id="stock-provs-list">
                      {provsList.map(p => <option key={p.id} value={p.nombre}/>)}
                    </datalist>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label small fw-medium">Proyecto</label>
                    <input className="form-control" value={formM.proyecto} placeholder="Nombre del proyecto" onChange={e=>setFormM(p=>({...p,proyecto:e.target.value}))}/>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label small fw-medium">Cliente interno</label>
                    <input className="form-control" value={formM.cliente_interno} placeholder="Responsable" onChange={e=>setFormM(p=>({...p,cliente_interno:e.target.value}))}/>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label small fw-medium">Precio unitario</label>
                    <input type="number" className="form-control" value={formM.precio_unit} min="0" step="any" onChange={e=>setFormM(p=>({...p,precio_unit:parseFloat(e.target.value)||0}))}/>
                  </div>
                  <div className="col-md-8">
                    <label className="form-label small fw-medium">Observaciones</label>
                    <input className="form-control" value={formM.observaciones} onChange={e=>setFormM(p=>({...p,observaciones:e.target.value}))}/>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={()=>setModalM(null)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={savM || !formM.producto_id}>
                  {savM && <span className="spinner-border spinner-border-sm me-2"/>}Registrar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══ MODAL: INGRESOS PENDIENTES ═══════════════════════════════════ */}
      {modalIngPend && (
        <div className="modal show d-block" style={{background:'rgba(0,0,0,.5)', zIndex:1060}}>
          <div className="modal-dialog modal-xl modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h5 className="modal-title">
                  <i className="bi bi-box-arrow-in-down me-2"/>
                  Ingresos pendientes de confirmación
                  {ingPend.length > 0 && <span className="badge bg-warning text-dark ms-2">{ingPend.length}</span>}
                </h5>
                <button className="btn-close" onClick={()=>setModalIngPend(false)}/>
              </div>
              <div className="modal-body p-0">
                {ingPend.length === 0
                  ? <p className="text-center text-muted py-5">No hay materiales pendientes de ingreso.</p>
                  : <table className="table table-sm table-hover mb-0" style={{fontSize:'0.83rem'}}>
                      <thead className="table-dark sticky-top">
                        <tr>
                          <th>OC N°</th>
                          <th>PROVEEDOR</th>
                          <th>CÓDIGO</th>
                          <th>DESCRIPCIÓN</th>
                          <th className="text-end">CANTIDAD</th>
                          <th>UNIDAD</th>
                          <th>REMITO</th>
                          <th>FECHA RECEP.</th>
                          <th>STOCK ACTUAL</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {ingPend.map(row => (
                          <tr key={row.id}>
                            <td className="fw-semibold">{row.oc_numero}</td>
                            <td className="text-truncate" style={{maxWidth:140}} title={row.proveedor_nombre}>{row.proveedor_nombre}</td>
                            <td><code style={{fontSize:'0.78rem'}}>{row.producto_codigo}</code></td>
                            <td className="text-truncate" style={{maxWidth:220}} title={row.producto_desc}>{row.producto_desc}</td>
                            <td className="text-end fw-semibold">{fmt(row.cantidad)}</td>
                            <td>{row.unidad}</td>
                            <td>{row.numero_remito || <span className="text-muted">—</span>}</td>
                            <td>{fmtF(row.fecha_recepcion)}</td>
                            <td className="text-end">{fmt(row.stock_actual)}</td>
                            <td className="text-end" style={{whiteSpace:'nowrap'}}>
                              <button className="btn btn-sm btn-success me-1"
                                disabled={savIng === row.id}
                                onClick={() => confirmarIngreso(row.id)}>
                                {savIng === row.id
                                  ? <span className="spinner-border spinner-border-sm"/>
                                  : <><i className="bi bi-check-lg me-1"/>Confirmar</>}
                              </button>
                              {canWrite && (
                                <button className="btn btn-sm btn-outline-danger"
                                  disabled={savIng === row.id}
                                  onClick={() => rechazarIngreso(row.id, row.producto_desc)}>
                                  <i className="bi bi-x-lg"/>
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                }
              </div>
              <div className="modal-footer py-2">
                <small className="text-muted me-auto">Confirmá cada material para que ingrese al stock.</small>
                <button className="btn btn-secondary btn-sm" onClick={()=>setModalIngPend(false)}>Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
