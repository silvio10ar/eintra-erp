import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'
import { puedeEscribir } from '../../store/authStore'
import { useEmpleados } from '../../hooks/useEmpleados'

const ESTADOS_P = [
  { v: 'Activo',     c: 'success' },
  { v: 'En espera',  c: 'warning' },
  { v: 'Completado', c: 'primary' },
  { v: 'Cancelado',  c: 'danger'  },
]
const ESTADOS_DOC = ['Realizado', 'En proceso', 'Pendiente', 'No Aplica']
const FORM_VACIO  = { codigo:'', nombre:'', cliente_nombre:'', responsable:'', descripcion:'', fecha_inicio:'', fecha_fin_est:'', estado:'Activo', presupuesto_venta:0 }

const fmtF  = iso => iso ? iso.slice(0,10).split('-').reverse().join('/') : '—'
const fmtN  = n   => new Intl.NumberFormat('es-AR', { maximumFractionDigits:2 }).format(n ?? 0)

const colorDoc = e => {
  if (!e) return 'secondary'
  const l = e.toLowerCase()
  if (l.includes('realizado')) return 'success'
  if (l.includes('proceso'))   return 'info'
  if (l.includes('pendiente')) return 'warning'
  return 'secondary'
}

export default function Proyectos() {
  const canWrite = puedeEscribir('proyectos')
  const { empleados } = useEmpleados()

  const [proyectos, setProyectos] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [buscar,    setBuscar]    = useState('')
  const [filtEst,   setFiltEst]   = useState('')

  /* Detalle lateral */
  const [selP,     setSelP]     = useState(null)
  const [detalle,  setDetalle]  = useState(null)
  const [docs,     setDocs]     = useState([])
  const [loadDet,  setLoadDet]  = useState(false)
  const [tab,      setTab]      = useState('form30')
  const [savDoc,   setSavDoc]   = useState(null)  // id del doc en edición

  /* Modal nuevo / editar proyecto */
  const [modalP,  setModalP]  = useState(null)   // null | 'nuevo' | objeto
  const [formP,   setFormP]   = useState(FORM_VACIO)
  const [savP,    setSavP]    = useState(false)
  const [errP,    setErrP]    = useState('')

  const cargar = useCallback(() => {
    setLoading(true)
    const p = {}
    if (buscar)  p.buscar = buscar
    if (filtEst) p.estado = filtEst
    api.get('/proyectos', { params: p })
      .then(r => setProyectos(r.data))
      .finally(() => setLoading(false))
  }, [buscar, filtEst])

  useEffect(() => { cargar() }, [cargar])

  const verDetalle = p => {
    setSelP(p); setLoadDet(true); setDetalle(null); setDocs([]); setTab('form30')
    Promise.all([
      api.get(`/proyectos/${p.id}`),
      api.get(`/proyectos/${p.id}/documentos`),
    ]).then(([r1, r2]) => { setDetalle(r1.data); setDocs(r2.data) })
      .finally(() => setLoadDet(false))
  }

  const actualizarDoc = async (docId, campo, valor) => {
    setSavDoc(docId)
    try {
      const r = await api.put(`/proyectos/${selP.id}/documentos/${docId}`, { [campo]: valor })
      setDocs(prev => prev.map(d => d.id === docId ? r.data : d))
    } finally { setSavDoc(null) }
  }

  const guardarProyecto = async e => {
    e.preventDefault(); setSavP(true); setErrP('')
    try {
      if (modalP === 'nuevo') {
        const r = await api.post('/proyectos', formP)
        cargar()
        setModalP(null)
        verDetalle(r.data)
      } else {
        await api.put(`/proyectos/${modalP.id}`, formP)
        cargar()
        if (selP?.id === modalP.id) {
          const updated = { ...selP, ...formP }
          setSelP(updated)
          setDetalle(prev => prev ? { ...prev, ...formP } : prev)
        }
        setModalP(null)
      }
    } catch(err) { setErrP(err.response?.data?.error ?? 'Error al guardar') }
    finally { setSavP(false) }
  }

  /* Agrupar docs por item_num → categoria */
  const docsAgrupados = (() => {
    const nums = [...new Set(docs.map(d => d.item_num))].sort((a,b)=>a-b)
    return nums.map(num => ({
      num,
      grupos: [...new Set(docs.filter(d=>d.item_num===num).map(d=>d.categoria))]
        .map(cat => ({ cat, items: docs.filter(d=>d.item_num===num && d.categoria===cat) }))
    }))
  })()

  const estBadge = v => ESTADOS_P.find(e=>e.v===v)?.c || 'secondary'

  return (
    <div style={{ display:'flex', gap:'1rem', height:'calc(100vh - 120px)', minHeight:0 }}>

      {/* ── Lista ──────────────────────────────────────────────────────── */}
      <div style={{ width: selP ? 360 : '100%', flexShrink:0, display:'flex', flexDirection:'column', minWidth:0, transition:'width .2s' }}>

        <div className="d-flex align-items-center justify-content-between mb-3">
          <h5 className="fw-bold mb-0">Proyectos</h5>
          {canWrite && (
            <button className="btn btn-sm btn-primary"
              onClick={() => { setFormP(FORM_VACIO); setErrP(''); setModalP('nuevo') }}>
              <i className="bi bi-plus-lg me-1"/>Nuevo
            </button>
          )}
        </div>

        <div className="d-flex gap-2 mb-3">
          <input className="form-control form-control-sm" placeholder="Buscar..."
            value={buscar} onChange={e=>setBuscar(e.target.value)}/>
          <select className="form-select form-select-sm" style={{width:130}}
            value={filtEst} onChange={e=>setFiltEst(e.target.value)}>
            <option value="">Todos</option>
            {ESTADOS_P.map(e=><option key={e.v} value={e.v}>{e.v}</option>)}
          </select>
        </div>

        {loading ? (
          <div className="text-center py-4"><span className="spinner-border text-primary"/></div>
        ) : (
          <div style={{ overflowY:'auto', flex:1 }}>
            {proyectos.length === 0 && <div className="text-center text-muted py-4">Sin proyectos</div>}
            {proyectos.map(p => {
              const pct = p.docs_aplican > 0 ? Math.round(p.docs_realizados / p.docs_aplican * 100) : null
              const activo = selP?.id === p.id
              return (
                <div key={p.id}
                  className={`card mb-2 ${activo ? 'border-primary' : ''}`}
                  style={{ cursor:'pointer' }}
                  onClick={() => verDetalle(p)}>
                  <div className="card-body py-2 px-3">
                    <div className="d-flex align-items-start justify-content-between gap-2">
                      <div style={{ minWidth:0, flex:1 }}>
                        <div className="d-flex align-items-center gap-2 mb-1 flex-wrap">
                          <span className="badge bg-dark" style={{fontFamily:'monospace',fontSize:'0.7rem'}}>{p.codigo}</span>
                          <span className={`badge bg-${estBadge(p.estado)}`} style={{fontSize:'0.68rem'}}>{p.estado}</span>
                        </div>
                        <div className="fw-medium small" style={{lineHeight:1.3}}>{p.nombre}</div>
                        {p.cliente_nombre && (
                          <div className="text-muted" style={{fontSize:'0.72rem'}}>
                            <i className="bi bi-building me-1"/>{p.cliente_nombre}
                          </div>
                        )}
                      </div>
                      <div className="text-end flex-shrink-0" style={{fontSize:'0.7rem',color:'#777'}}>
                        {p.fecha_inicio   && <div>{fmtF(p.fecha_inicio)}</div>}
                        {p.fecha_fin_est  && <div className="text-muted">→ {fmtF(p.fecha_fin_est)}</div>}
                      </div>
                    </div>
                    {pct !== null && (
                      <div className="mt-1">
                        <div className="d-flex justify-content-between" style={{fontSize:'0.67rem',color:'#aaa'}}>
                          <span>Form 30</span>
                          <span>{p.docs_realizados}/{p.docs_aplican} ({pct}%)</span>
                        </div>
                        <div className="progress" style={{height:3}}>
                          <div className={`progress-bar bg-${pct===100?'success':'primary'}`} style={{width:`${pct}%`}}/>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Panel detalle ──────────────────────────────────────────────── */}
      {selP && (
        <div style={{ flex:1, minWidth:0, display:'flex', flexDirection:'column', overflow:'hidden', border:'1px solid #dee2e6', borderRadius:8, background:'#fff' }}>

          {/* Header */}
          <div className="px-3 py-2 border-bottom d-flex align-items-center gap-2 flex-wrap">
            <span className="badge bg-dark" style={{fontFamily:'monospace'}}>{selP.codigo}</span>
            <strong className="flex-grow-1" style={{fontSize:'0.88rem',lineHeight:1.3}}>{selP.nombre}</strong>
            <span className={`badge bg-${estBadge(selP.estado)}`}>{selP.estado}</span>
            {canWrite && (
              <button className="btn btn-xs btn-outline-secondary py-0 px-2" style={{fontSize:'0.75rem'}}
                onClick={() => { setFormP({codigo:selP.codigo,nombre:selP.nombre,cliente_nombre:selP.cliente_nombre||'',responsable:selP.responsable||'',descripcion:selP.descripcion||'',fecha_inicio:selP.fecha_inicio||'',fecha_fin_est:selP.fecha_fin_est||'',estado:selP.estado,presupuesto_venta:selP.presupuesto_venta||0}); setErrP(''); setModalP(selP) }}>
                <i className="bi bi-pencil me-1"/>Editar
              </button>
            )}
            <button className="btn-close" style={{fontSize:'0.7rem'}} onClick={()=>setSelP(null)}/>
          </div>

          {/* Info rápida */}
          <div className="px-3 py-1 border-bottom d-flex flex-wrap gap-3" style={{fontSize:'0.75rem',background:'#f8f9fa'}}>
            {selP.descripcion    && <span className="text-truncate" style={{maxWidth:320}}><i className="bi bi-card-text me-1 text-muted"/>{selP.descripcion}</span>}
            {selP.cliente_nombre && <span><i className="bi bi-building me-1 text-muted"/>{selP.cliente_nombre}</span>}
            {selP.fecha_inicio   && <span><i className="bi bi-calendar me-1 text-muted"/>Inicio: {fmtF(selP.fecha_inicio)}</span>}
            {selP.fecha_fin_est  && <span><i className="bi bi-flag me-1 text-muted"/>Est.: {fmtF(selP.fecha_fin_est)}</span>}
            {selP.responsable    && <span><i className="bi bi-person me-1 text-muted"/>{selP.responsable}</span>}
            {selP.docs_aplican > 0 && (
              <span className={`fw-semibold ${selP.docs_realizados===selP.docs_aplican?'text-success':'text-primary'}`}>
                <i className="bi bi-file-earmark-check me-1"/>
                {selP.docs_realizados}/{selP.docs_aplican} docs
              </span>
            )}
          </div>

          {/* Tabs */}
          <ul className="nav nav-tabs px-3 pt-1" style={{fontSize:'0.82rem'}}>
            <li className="nav-item">
              <button className={`nav-link py-1 ${tab==='form30'?'active':''}`} onClick={()=>setTab('form30')}>
                <i className="bi bi-file-earmark-check me-1"/>Form 30
              </button>
            </li>
            <li className="nav-item">
              <button className={`nav-link py-1 ${tab==='costos'?'active':''}`} onClick={()=>setTab('costos')}>
                <i className="bi bi-cash me-1"/>Costos
              </button>
            </li>
          </ul>

          {loadDet ? (
            <div className="text-center py-5"><span className="spinner-border text-primary"/></div>
          ) : (
            <div style={{ flex:1, overflowY:'auto', padding:'0.75rem 1rem' }}>

              {/* ── Form 30 ── */}
              {tab === 'form30' && (
                docs.length === 0
                  ? <div className="text-muted text-center py-4">Sin documentos registrados</div>
                  : docsAgrupados.map(({ num, grupos }) => (
                    <div key={num}>
                      {docsAgrupados.length > 1 && (() => {
                        const nombre = grupos[0]?.items[0]?.item_nombre || `Ítem ${num}`
                        return (
                          <div className="d-flex align-items-center gap-2 mb-2 mt-1">
                            <span className="badge bg-secondary">Ítem {num}</span>
                            <span className="small text-muted fw-medium">{nombre}</span>
                          </div>
                        )
                      })()}
                      {grupos.map(({ cat, items }) => (
                        <div key={cat} className="mb-3">
                          <div className="small fw-semibold text-muted border-bottom pb-1 mb-1">{cat}</div>
                          <table className="table table-sm table-hover mb-0" style={{fontSize:'0.76rem'}}>
                            <tbody>
                              {items.map(doc => {
                                const noAplica = doc.aplica?.toLowerCase().includes('no aplica')
                                const label = doc.subitem
                                  ? (doc.item !== doc.categoria ? `${doc.item} / ${doc.subitem}` : doc.subitem)
                                  : doc.item
                                return (
                                  <tr key={doc.id} style={{opacity: noAplica ? 0.4 : 1}}>
                                    <td style={{maxWidth:240}}>
                                      <div style={{lineHeight:1.2}}>{label || '—'}</div>
                                      {canWrite && !noAplica ? (
                                        <select
                                          className="form-select form-select-sm border-0 py-0 px-0 mt-1"
                                          style={{fontSize:'0.67rem',color:'#999',background:'transparent',cursor:'pointer',width:'auto',maxWidth:220}}
                                          value={doc.responsable || ''}
                                          disabled={savDoc === doc.id}
                                          onChange={e => actualizarDoc(doc.id, 'responsable', e.target.value)}>
                                          <option value="">— sin responsable —</option>
                                          {empleados.map(e=><option key={e.id} value={e.nombre}>{e.nombre}</option>)}
                                        </select>
                                      ) : (
                                        doc.responsable && (
                                          <div style={{fontSize:'0.67rem',color:'#999'}}>
                                            <i className="bi bi-person me-1"/>{doc.responsable}
                                          </div>
                                        )
                                      )}
                                    </td>
                                    <td style={{width:118}}>
                                      {canWrite && !noAplica ? (
                                        <select
                                          className="form-select form-select-sm border-0 py-0 px-1"
                                          style={{fontSize:'0.72rem',background:'transparent',cursor:'pointer'}}
                                          value={doc.estado || ''}
                                          disabled={savDoc === doc.id}
                                          onChange={e => actualizarDoc(doc.id, 'estado', e.target.value)}>
                                          <option value="">— estado —</option>
                                          {ESTADOS_DOC.map(s=><option key={s} value={s}>{s}</option>)}
                                        </select>
                                      ) : (
                                        <span className={`badge bg-${colorDoc(doc.estado)}`} style={{fontSize:'0.65rem'}}>
                                          {doc.estado || (noAplica ? 'No aplica' : '—')}
                                        </span>
                                      )}
                                    </td>
                                    <td style={{width:90,fontSize:'0.67rem',color:'#999'}}>
                                      {doc.fecha_solicitado && <div>Sol: {fmtF(doc.fecha_solicitado)}</div>}
                                      {doc.fecha_entregado  && <div>Ent: {fmtF(doc.fecha_entregado)}</div>}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </div>
                  ))
              )}

              {/* ── Costos ── */}
              {tab === 'costos' && (
                !detalle ? (
                  <div className="text-center py-3"><span className="spinner-border spinner-border-sm"/></div>
                ) : detalle.costos?.length === 0 ? (
                  <div className="text-muted text-center py-4">Sin costos registrados</div>
                ) : (
                  <>
                    <table className="table table-sm table-hover" style={{fontSize:'0.8rem'}}>
                      <thead className="table-light">
                        <tr><th>Tipo</th><th>Descripción</th><th>Cant.</th><th>P.Unit</th><th>Total</th><th>Fecha</th></tr>
                      </thead>
                      <tbody>
                        {detalle.costos.map(c=>(
                          <tr key={c.id}>
                            <td><span className="badge bg-secondary">{c.tipo}</span></td>
                            <td>{c.descripcion}</td>
                            <td>{c.cantidad}</td>
                            <td>{fmtN(c.precio_unit)}</td>
                            <td className="fw-semibold">{fmtN(c.total)}</td>
                            <td>{fmtF(c.fecha)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="text-end small fw-semibold">
                      Total: {fmtN(detalle.costo_total)}
                    </div>
                  </>
                )
              )}

            </div>
          )}
        </div>
      )}

      {/* ── Modal nuevo / editar proyecto ──────────────────────────────── */}
      {modalP !== null && (
        <div className="modal fade show d-block" style={{background:'rgba(0,0,0,.45)'}}>
          <div className="modal-dialog modal-dialog-centered">
            <form className="modal-content" onSubmit={guardarProyecto}>
              <div className="modal-header py-2">
                <h6 className="modal-title">{modalP==='nuevo' ? 'Nuevo proyecto' : 'Editar proyecto'}</h6>
                <button type="button" className="btn-close" onClick={()=>setModalP(null)}/>
              </div>
              <div className="modal-body">
                <div className="row g-2">
                  <div className="col-md-4">
                    <label className="form-label small fw-medium">Código *</label>
                    <input className="form-control form-control-sm" required
                      style={{fontFamily:'monospace',letterSpacing:1}}
                      value={formP.codigo}
                      onChange={e=>setFormP(p=>({...p,codigo:e.target.value.toUpperCase()}))}/>
                  </div>
                  <div className="col-md-8">
                    <label className="form-label small fw-medium">Nombre *</label>
                    <input className="form-control form-control-sm" required
                      value={formP.nombre} onChange={e=>setFormP(p=>({...p,nombre:e.target.value}))}/>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small fw-medium">Cliente</label>
                    <input className="form-control form-control-sm"
                      value={formP.cliente_nombre} onChange={e=>setFormP(p=>({...p,cliente_nombre:e.target.value}))}/>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small fw-medium">Responsable</label>
                    <select className="form-select form-select-sm"
                      value={formP.responsable} onChange={e=>setFormP(p=>({...p,responsable:e.target.value}))}>
                      <option value="">— Seleccionar —</option>
                      {empleados.map(e=><option key={e.id} value={e.nombre}>{e.nombre}</option>)}
                    </select>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label small fw-medium">Estado</label>
                    <select className="form-select form-select-sm"
                      value={formP.estado} onChange={e=>setFormP(p=>({...p,estado:e.target.value}))}>
                      {ESTADOS_P.map(e=><option key={e.v} value={e.v}>{e.v}</option>)}
                    </select>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label small fw-medium">F. Inicio</label>
                    <input type="date" className="form-control form-control-sm"
                      value={formP.fecha_inicio} onChange={e=>setFormP(p=>({...p,fecha_inicio:e.target.value}))}/>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label small fw-medium">F. Fin Est.</label>
                    <input type="date" className="form-control form-control-sm"
                      value={formP.fecha_fin_est} onChange={e=>setFormP(p=>({...p,fecha_fin_est:e.target.value}))}/>
                  </div>
                </div>
                {errP && <div className="alert alert-danger mt-2 py-1 small mb-0">{errP}</div>}
              </div>
              <div className="modal-footer py-2">
                <button type="button" className="btn btn-sm btn-secondary" onClick={()=>setModalP(null)}>Cancelar</button>
                <button type="submit" className="btn btn-sm btn-primary" disabled={savP}>
                  {savP ? <><span className="spinner-border spinner-border-sm me-1"/>Guardando...</> : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
