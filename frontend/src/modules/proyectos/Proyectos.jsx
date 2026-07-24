import { useState, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import api from '../../api/client'
import { puedeEscribir, getUser } from '../../store/authStore'
import EmpleadoSelect from '../../components/EmpleadoSelect'
import DateInput from '../../components/DateInput'
import PlanGantt from './PlanGantt'
import PlantillaGantt from './PlantillaGantt'

const ESTADOS_P = [
  { v: 'Activo',     c: 'success' },
  { v: 'En espera',  c: 'warning' },
  { v: 'Completado', c: 'primary' },
  { v: 'Cancelado',  c: 'danger'  },
]
const ESTADOS_DOC = ['Realizado', 'En proceso', 'Pendiente', 'No Aplica']
const FORM_VACIO  = { codigo:'', nombre:'', cliente_nombre:'', responsable:'', descripcion:'', fecha_inicio:'', fecha_fin_est:'', estado:'Activo', presupuesto_venta:0 }

const FORMATOS_ENT   = ['CAD', 'PDF', 'PAPEL', 'WORD', 'EXCEL', 'PROJECT']
// B4 — Tipo de plano según PE-08
const NIVELES_ENT    = ['N1', 'N2', 'N3', 'N4', 'N5', 'PI', 'EL', 'PC']
// B3 — Destino del plano según PE-08
const DESTINOS_ENT   = ['CL', 'TA', 'EA', 'IN', 'VE', 'SE']
const DESTINOS_LABEL = { CL:'Cliente', TA:'Taller', EA:'Elem. Accesorios', IN:'Ingeniería', VE:'Ventas', SE:'Serv. Externos' }
const TIPOS_ENT      = [
  { v: 'S', label: 'Solicitud',   c: 'primary' },
  { v: 'E', label: 'Enviado a',   c: 'success'  },
  { v: 'D', label: 'Devolución',  c: 'warning'  },
]
const hoyStr = () => new Date().toISOString().slice(0, 10)
const FORM_ENT_VACIO = { fecha: '', nro_oc: '', formato: '', documento: '', plano_nivel: '', codigo_plano: '', tipo: 'S', individuo: '', comentarios: '' }
const COD_BUILDER_VACIO = { b1: '', b2: '', b3: '', b5: '' }

// Ensambla el código de plano: B1-B2-B3-B4-B5
const ensamblarCodigo = (b1, b2, b3, b4, b5) =>
  [b1, b2, b3, b4, b5].filter(Boolean).join('-')

// Intenta parsear un código existente en sus partes B1..B5
const parsearCodigo = (cod, nivel) => {
  if (!cod) return COD_BUILDER_VACIO
  const parts = cod.split('-')
  return {
    b1: parts[0] || '',
    b2: parts[1] || '',
    b3: parts[2] || '',
    b5: parts.slice(4).join('-') || '',
  }
}

// B2 = últimos 6 dígitos del N° OC
const ultimos6DeOC = v => (v.match(/\d/g) || []).join('').slice(-6)
const FORM_MAT_VACIO = { producto_id: '', codigo: '', descripcion: '', unidad: 'UND.', cantidad: 1, observaciones: '' }

const fmtF     = iso => iso ? iso.slice(0,10).split('-').reverse().join('/') : '—'
const fmtN     = n   => new Intl.NumberFormat('es-AR', { maximumFractionDigits:2 }).format(n ?? 0)
const fmtCod   = c   => {
  if (!c) return ''
  if (c.includes('/')) return c.replace('/', '')  // MIRG001C/1 → MIRG001C1
  if (!/\d$/.test(c))  return c + '0'             // MIRG001C   → MIRG001C0
  return c
}

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
  const isAdmin  = getUser()?.rol === 'admin'
  const location  = useLocation()

  const [proyectos, setProyectos] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [buscar,    setBuscar]    = useState('')
  const [filtEst,   setFiltEst]   = useState(location.state?.filtEst || '')
  const [vista,     setVista]     = useState('tarjetas') // 'tarjetas' | 'tabla'

  /* Detalle lateral */
  const [selP,     setSelP]     = useState(null)
  const [detalle,  setDetalle]  = useState(null)
  const [docs,     setDocs]     = useState([])
  const [loadDet,  setLoadDet]  = useState(false)
  const [tab,      setTab]      = useState('form30')
  const [savDoc,   setSavDoc]   = useState(null)  // id del doc en edición
  const [ocCliente, setOcCliente] = useState(null)

  /* Modal nuevo / editar proyecto */
  const [modalP,  setModalP]  = useState(null)   // null | 'nuevo' | objeto
  const [formP,   setFormP]   = useState(FORM_VACIO)
  const [savP,    setSavP]    = useState(false)
  const [errP,    setErrP]    = useState('')

  /* Entregas de documentación */
  const [entregas,    setEntregas]    = useState([])
  const [loadEnt,     setLoadEnt]     = useState(false)
  const [modalEnt,    setModalEnt]    = useState(null)  // null | 'nuevo' | objeto
  const [formEnt,     setFormEnt]     = useState(FORM_ENT_VACIO)
  const [codBuilder,  setCodBuilder]  = useState(COD_BUILDER_VACIO)
  const [savEnt,      setSavEnt]      = useState(false)
  const [errEnt,      setErrEnt]      = useState('')
  const [savPlantilla, setSavPlantilla] = useState(false)

  const updBuilder = (field, val) => {
    const nb = {...codBuilder, [field]: val}
    setCodBuilder(nb)
    setFormEnt(p => ({...p, codigo_plano: ensamblarCodigo(nb.b1, nb.b2, nb.b3, p.plano_nivel, nb.b5)}))
  }
  const updNivel = val => {
    setFormEnt(p => ({...p, plano_nivel: val, codigo_plano: ensamblarCodigo(codBuilder.b1, codBuilder.b2, codBuilder.b3, val, codBuilder.b5)}))
  }

  /* Materiales previstos */
  const [materiales, setMateriales] = useState([])
  const [modalMat,   setModalMat]   = useState(null)   // null | 'nuevo' | objeto
  const [formMat,    setFormMat]    = useState(FORM_MAT_VACIO)
  const [savMat,     setSavMat]     = useState(false)
  const [errMat,     setErrMat]     = useState('')
  const [sugsMat,    setSugsMat]    = useState([])
  const [buscarMat,  setBuscarMat]  = useState('')

  /* Importar Form 56 */
  const [modalF56,   setModalF56]   = useState(false)
  const [f56Preview, setF56Preview] = useState(null)   // { proyNames, yaImportados, total }
  const [f56Mapping, setF56Mapping] = useState({})     // { "GRABYA": "123", ... }
  const [f56Load,    setF56Load]    = useState(false)
  const [f56Sav,     setF56Sav]    = useState(false)
  const [f56Msg,     setF56Msg]    = useState('')

  /* Editor plantilla global */
  const [showPlantilla, setShowPlantilla] = useState(false)

  /* Modal normalizar responsables */
  const [modalNorm, setModalNorm] = useState(false)
  const [normData,  setNormData]  = useState([])
  const [normMap,   setNormMap]   = useState({})
  const [normLoad,  setNormLoad]  = useState(false)
  const [normSav,   setNormSav]   = useState(false)
  const [normMsg,   setNormMsg]   = useState('')

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
    setSelP(p); setLoadDet(true); setDetalle(null); setDocs([]); setEntregas([]); setMateriales([]); setTab('form30'); setOcCliente(null)
    Promise.all([
      api.get(`/proyectos/${p.id}`),
      api.get(`/proyectos/${p.id}/documentos`),
      api.get(`/proyectos/${p.id}/entregas-doc`),
      api.get(`/proyectos/${p.id}/materiales`),
    ]).then(([r1, r2, r3, r4]) => { setDetalle(r1.data); setDocs(r2.data); setEntregas(r3.data); setMateriales(r4.data) })
      .finally(() => setLoadDet(false))
    api.get('/finanzas/oc-clientes', { params: { proyecto_id: p.id } })
      .then(r => setOcCliente(r.data[0] || null))
      .catch(() => setOcCliente(null))
  }

  const cargarEntregas = p => {
    setLoadEnt(true)
    api.get(`/proyectos/${p.id}/entregas-doc`)
      .then(r => setEntregas(r.data))
      .finally(() => setLoadEnt(false))
  }

  const guardarEntrega = async e => {
    e.preventDefault(); setSavEnt(true); setErrEnt('')
    try {
      if (modalEnt === 'nuevo') {
        const r = await api.post(`/proyectos/${selP.id}/entregas-doc`, formEnt)
        setEntregas(prev => [r.data, ...prev])
      } else {
        const r = await api.put(`/proyectos/${selP.id}/entregas-doc/${modalEnt.id}`, formEnt)
        setEntregas(prev => prev.map(x => x.id === modalEnt.id ? r.data : x))
      }
      setModalEnt(null)
    } catch(err) { setErrEnt(err.response?.data?.error ?? 'Error al guardar') }
    finally { setSavEnt(false) }
  }

  const eliminarEntrega = async ent => {
    if (!confirm('¿Eliminar este registro?')) return
    await api.delete(`/proyectos/${selP.id}/entregas-doc/${ent.id}`)
    setEntregas(prev => prev.filter(x => x.id !== ent.id))
  }

  const aplicarPlantillaForm30 = async () => {
    if (docs.length > 0 && !confirm(`Este proyecto ya tiene ${docs.length} documentos en el Form 30.\n¿Reemplazar con la plantilla estándar (34 ítems)?`)) return
    setSavPlantilla(true)
    try {
      await api.post(`/proyectos/${selP.id}/aplicar-plantilla-form30`)
      const r = await api.get(`/proyectos/${selP.id}/documentos`)
      setDocs(r.data)
      cargar()
    } catch(e) {
      alert('Error: ' + (e.response?.data?.error || e.message))
    } finally { setSavPlantilla(false) }
  }

  const abrirImportF56 = () => {
    setModalF56(true); setF56Msg(''); setF56Preview(null); setF56Mapping({}); setF56Load(true)
    api.get('/proyectos/form56-preview')
      .then(r => {
        setF56Preview(r.data)
        const m = {}
        r.data.proyNames.forEach(n => { m[n] = '' })
        setF56Mapping(m)
      })
      .catch(e => setF56Msg('Error: ' + (e.response?.data?.error || e.message)))
      .finally(() => setF56Load(false))
  }

  const ejecutarImportF56 = async () => {
    setF56Sav(true); setF56Msg('')
    try {
      const r = await api.post('/proyectos/form56-importar', { mapping: f56Mapping })
      setF56Msg(`✓ ${r.data.insertados} registros importados correctamente.`)
      setF56Preview(prev => prev ? { ...prev, yaImportados: r.data.insertados } : prev)
      cargar()
    } catch(e) { setF56Msg('Error: ' + (e.response?.data?.error || e.message)) }
    finally { setF56Sav(false) }
  }

  const guardarMaterial = async e => {
    e.preventDefault(); setSavMat(true); setErrMat('')
    try {
      if (modalMat === 'nuevo') {
        const r = await api.post(`/proyectos/${selP.id}/materiales`, formMat)
        setMateriales(prev => [...prev, r.data])
      } else {
        const r = await api.put(`/proyectos/${selP.id}/materiales/${modalMat.id}`, formMat)
        setMateriales(prev => prev.map(x => x.id === modalMat.id ? r.data : x))
      }
      setModalMat(null)
    } catch(err) { setErrMat(err.response?.data?.error ?? 'Error al guardar') }
    finally { setSavMat(false) }
  }

  const eliminarMaterial = async mat => {
    if (!confirm(`¿Eliminar "${mat.descripcion}"?`)) return
    await api.delete(`/proyectos/${selP.id}/materiales/${mat.id}`)
    setMateriales(prev => prev.filter(x => x.id !== mat.id))
  }

  const buscarProductoMat = txt => {
    setBuscarMat(txt)
    setFormMat(p => ({ ...p, descripcion: txt, producto_id: '', codigo: '' }))
    if (!txt || txt.length < 2) { setSugsMat([]); return }
    api.get('/stock/productos', { params: { buscar: txt } })
      .then(r => setSugsMat(r.data.slice(0, 12)))
      .catch(() => setSugsMat([]))
  }

  const selProductoMat = prod => {
    setFormMat(p => ({ ...p, producto_id: prod.id, codigo: prod.codigo, descripcion: prod.descripcion, unidad: prod.unidad || 'UND.' }))
    setBuscarMat(prod.descripcion)
    setSugsMat([])
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

  const abrirNorm = () => {
    setModalNorm(true); setNormMsg(''); setNormLoad(true)
    api.get('/proyectos/responsables-distintos')
      .then(r => {
        setNormData(r.data)
        const m = {}
        r.data.forEach(d => { m[d.responsable] = '' })
        setNormMap(m)
      })
      .finally(() => setNormLoad(false))
  }

  const aplicarNorm = async () => {
    setNormSav(true)
    const mapping = {}
    for (const [desde, hasta] of Object.entries(normMap)) {
      if (hasta && hasta !== desde) mapping[desde] = hasta
    }
    if (Object.keys(mapping).length === 0) {
      setNormMsg('No hay cambios seleccionados.')
      setNormSav(false)
      return
    }
    try {
      const r = await api.post('/proyectos/normalizar-responsables', { mapping })
      setNormMsg(`✓ ${r.data.actualizados} registros actualizados.`)
      cargar()
      if (selP) verDetalle(selP)
    } catch(e) {
      setNormMsg('Error: ' + (e.response?.data?.error || e.message))
    } finally { setNormSav(false) }
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
    <div style={{ display:'flex', flexDirection:'column', height:'calc(100vh - 120px)', minHeight:0 }}>

      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      <div className="d-flex align-items-center gap-2 mb-3 flex-wrap">
        <h5 className="fw-bold mb-0">Proyectos</h5>
        <input className="form-control form-control-sm" style={{width:200}} placeholder="Buscar..."
          value={buscar} onChange={e=>setBuscar(e.target.value)}/>
        <select className="form-select form-select-sm" style={{width:140}}
          value={filtEst} onChange={e=>setFiltEst(e.target.value)}>
          <option value="">Todos los estados</option>
          {ESTADOS_P.map(e=><option key={e.v} value={e.v}>{e.v}</option>)}
        </select>
        <div className="btn-group btn-group-sm" role="group">
          <button type="button" className={`btn ${vista==='tarjetas'?'btn-secondary':'btn-outline-secondary'}`}
            title="Vista tarjetas" onClick={() => setVista('tarjetas')}>
            <i className="bi bi-grid"/>
          </button>
          <button type="button" className={`btn ${vista==='tabla'?'btn-secondary':'btn-outline-secondary'}`}
            title="Vista tabla" onClick={() => setVista('tabla')}>
            <i className="bi bi-table"/>
          </button>
        </div>
        <div className="ms-auto d-flex gap-2">
          {canWrite && (
            <button className="btn btn-sm btn-primary"
              onClick={() => { setFormP(FORM_VACIO); setErrP(''); setModalP('nuevo') }}>
              <i className="bi bi-plus-lg me-1"/>Nuevo
            </button>
          )}
        </div>
      </div>

      {/* ── Modo plantilla (pantalla completa) ──────────────────────────── */}
      {showPlantilla && (
        <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column', overflow:'auto', border:'1px solid #dee2e6', borderRadius:8, background:'#fff', padding:'1rem' }}>
          <div className="d-flex align-items-center mb-3 border-bottom pb-2">
            <button className="btn btn-sm btn-outline-secondary" onClick={() => setShowPlantilla(false)}>
              <i className="bi bi-arrow-left me-1"/>Volver a proyectos
            </button>
          </div>
          <PlantillaGantt canWrite={canWrite} />
        </div>
      )}

      {/* ── Modo proyectos: lista + detalle ─────────────────────────────── */}
      {!showPlantilla && (
      <div style={{ display:'flex', gap:'1rem', flex:1, minHeight:0 }}>

      {/* Lista */}
      <div style={{ width: selP ? 320 : '100%', flexShrink:0, display:'flex', flexDirection:'column', minWidth:0 }}>
        {loading ? (
          <div className="text-center py-4"><span className="spinner-border text-primary"/></div>
        ) : proyectos.length === 0 ? (
          <div className="text-center text-muted py-4">Sin proyectos</div>
        ) : vista === 'tabla' ? (
          <div style={{ overflow:'auto', flex:1 }}>
            <table className="table table-sm table-hover align-middle" style={{ fontSize:'0.8rem' }}>
              <thead className="table-light sticky-top">
                <tr>
                  <th>Código</th>
                  <th>Nombre</th>
                  {!selP && <th>Cliente</th>}
                  <th>Estado</th>
                  {!selP && <th>F. Inicio</th>}
                  {!selP && <th>F. Fin Est.</th>}
                  <th style={{ minWidth: 140 }}>Avance (Plan)</th>
                </tr>
              </thead>
              <tbody>
                {proyectos.map(p => {
                  const pct = p.plan_tareas > 0 ? p.plan_avance : null
                  const activo = selP?.id === p.id
                  return (
                    <tr key={p.id} className={activo ? 'table-primary' : ''}
                      style={{ cursor:'pointer' }} onClick={() => verDetalle(p)}>
                      <td style={{fontFamily:'monospace',fontSize:'0.75rem'}}>{fmtCod(p.codigo)}</td>
                      <td className="fw-medium">{p.nombre}</td>
                      {!selP && <td className="text-muted">{p.cliente_nombre || '—'}</td>}
                      <td><span className={`badge bg-${estBadge(p.estado)}`} style={{fontSize:'0.68rem'}}>{p.estado}</span></td>
                      {!selP && <td className="text-muted">{fmtF(p.fecha_inicio) || '—'}</td>}
                      {!selP && <td className="text-muted">{fmtF(p.fecha_fin_est) || '—'}</td>}
                      <td>
                        {pct !== null ? (
                          <div className="d-flex align-items-center gap-2">
                            <div className="progress flex-grow-1" style={{height:6,minWidth:60}}>
                              <div className={`progress-bar bg-${pct===100?'success':'primary'}`} style={{width:`${pct}%`}}/>
                            </div>
                            <span style={{fontSize:'0.72rem',color:'#777',whiteSpace:'nowrap'}}>{p.plan_tareas} tareas ({pct}%)</span>
                          </div>
                        ) : <span className="text-muted">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ overflowY:'auto', flex:1 }}>
            {proyectos.map(p => {
              const pct = p.plan_tareas > 0 ? p.plan_avance : null
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
                          <span className="badge bg-dark" style={{fontFamily:'monospace',fontSize:'0.7rem'}}>{fmtCod(p.codigo)}</span>
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
                          <span>Plan</span>
                          <span>{p.plan_tareas} tareas ({pct}%)</span>
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
            <span className="badge bg-dark" style={{fontFamily:'monospace'}}>{fmtCod(selP.codigo)}</span>
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
            {ocCliente ? (
              <span className="fw-semibold text-primary">
                <i className="bi bi-file-earmark-text me-1"/>
                OC {ocCliente.numero_oc || '—'}
              </span>
            ) : (
              <span className="text-muted fst-italic">
                <i className="bi bi-file-earmark-text me-1"/>Sin OC vinculada
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
              <button className={`nav-link py-1 ${tab==='materiales'?'active':''}`} onClick={()=>setTab('materiales')}>
                <i className="bi bi-boxes me-1"/>Materiales
                {materiales.length > 0 && <span className="badge bg-secondary ms-1" style={{fontSize:'0.65rem'}}>{materiales.length}</span>}
              </button>
            </li>
            <li className="nav-item">
              <button className={`nav-link py-1 ${tab==='costos'?'active':''}`} onClick={()=>setTab('costos')}>
                <i className="bi bi-cash me-1"/>Costos
              </button>
            </li>
            <li className="nav-item">
              <button className={`nav-link py-1 ${tab==='entregas'?'active':''}`} onClick={()=>setTab('entregas')}>
                <i className="bi bi-file-arrow-up me-1"/>Entrega Doc.
                {entregas.length > 0 && <span className="badge bg-secondary ms-1" style={{fontSize:'0.65rem'}}>{entregas.length}</span>}
              </button>
            </li>
            <li className="nav-item">
              <button className={`nav-link py-1 ${tab==='plan'?'active':''}`} onClick={()=>setTab('plan')}>
                <i className="bi bi-bar-chart-steps me-1"/>Plan
              </button>
            </li>
          </ul>

          {loadDet ? (
            <div className="text-center py-5"><span className="spinner-border text-primary"/></div>
          ) : (
            <div style={{ flex:1, overflowY:'auto', padding:'0.75rem 1rem' }}>

              {/* ── Form 30 ── */}
              {tab === 'form30' && (
                <>
                  {canWrite && docs.length === 0 && (
                    <div className="d-flex justify-content-end mb-2">
                      <button className="btn btn-sm btn-outline-secondary py-0 px-2" style={{fontSize:'0.78rem'}}
                        onClick={aplicarPlantillaForm30} disabled={savPlantilla}>
                        {savPlantilla
                          ? <><span className="spinner-border spinner-border-sm me-1"/>Aplicando...</>
                          : <><i className="bi bi-clipboard-check me-1"/>Aplicar plantilla Form 30</>
                        }
                      </button>
                    </div>
                  )}
                  {docs.length === 0
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
                                    {canWrite && (
                                      <td style={{width:22, textAlign:'center', verticalAlign:'middle', paddingRight:0}}>
                                        <input type="checkbox"
                                          className="form-check-input"
                                          checked={!noAplica}
                                          disabled={savDoc === doc.id}
                                          title={noAplica ? 'Habilitar' : 'Marcar No Aplica'}
                                          onChange={() => actualizarDoc(doc.id, 'aplica', noAplica ? '' : 'No Aplica')}
                                        />
                                      </td>
                                    )}
                                    <td style={{maxWidth:240}}>
                                      <div style={{lineHeight:1.2}}>{label || '—'}</div>
                                      {canWrite && !noAplica ? (
                                        <EmpleadoSelect
                                          className="form-select form-select-sm border-0 py-0 px-0 mt-1"
                                          style={{fontSize:'0.67rem',color:'#999',background:'transparent',cursor:'pointer',width:'auto',maxWidth:220}}
                                          value={doc.responsable || ''}
                                          disabled={savDoc === doc.id}
                                          onChange={v => actualizarDoc(doc.id, 'responsable', v)}
                                          placeholder="— sin responsable —"
                                        />
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
                                    <td style={{width:110}}>
                                      {canWrite && !noAplica ? (
                                        <div style={{display:'flex', flexDirection:'column', gap:2}}>
                                          <div style={{display:'flex', alignItems:'center', gap:3}}>
                                            <span style={{fontSize:'0.62rem', color:'#999', whiteSpace:'nowrap'}}>Sol:</span>
                                            <DateInput className="form-control form-control-sm border-0 py-0 px-1"
                                              style={{fontSize:'0.67rem', background:'transparent', cursor:'pointer', width:100}}
                                              value={doc.fecha_solicitado || ''}
                                              disabled={savDoc === doc.id}
                                              onChange={v => actualizarDoc(doc.id, 'fecha_solicitado', v)}/>
                                          </div>
                                          <div style={{display:'flex', alignItems:'center', gap:3}}>
                                            <span style={{fontSize:'0.62rem', color:'#999', whiteSpace:'nowrap'}}>Ent:</span>
                                            <DateInput className="form-control form-control-sm border-0 py-0 px-1"
                                              style={{fontSize:'0.67rem', background:'transparent', cursor:'pointer', width:100}}
                                              value={doc.fecha_entregado || ''}
                                              disabled={savDoc === doc.id}
                                              onChange={v => actualizarDoc(doc.id, 'fecha_entregado', v)}/>
                                          </div>
                                        </div>
                                      ) : (
                                        <div style={{fontSize:'0.67rem', color:'#999'}}>
                                          {doc.fecha_solicitado && <div>Sol: {fmtF(doc.fecha_solicitado)}</div>}
                                          {doc.fecha_entregado  && <div>Ent: {fmtF(doc.fecha_entregado)}</div>}
                                        </div>
                                      )}
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
                  }
                </>
              )}

              {/* ── Materiales previstos ── */}
              {tab === 'materiales' && (
                <>
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <span className="small text-muted fw-medium">
                      <i className="bi bi-boxes me-1"/>Materiales previstos para el proyecto
                    </span>
                    {canWrite && (
                      <button className="btn btn-sm btn-primary py-0 px-2" style={{fontSize:'0.78rem'}}
                        onClick={() => { setFormMat(FORM_MAT_VACIO); setBuscarMat(''); setSugsMat([]); setErrMat(''); setModalMat('nuevo') }}>
                        <i className="bi bi-plus-lg me-1"/>Agregar
                      </button>
                    )}
                  </div>
                  {materiales.length === 0
                    ? <div className="text-center text-muted py-4" style={{fontSize:'0.85rem'}}>
                        <i className="bi bi-boxes d-block fs-4 mb-1"/>Sin materiales previstos
                      </div>
                    : <div className="table-responsive">
                        <table className="table table-sm table-hover align-middle mb-0" style={{fontSize:'0.78rem'}}>
                          <thead className="table-light">
                            <tr>
                              <th style={{width:90}}>Código</th>
                              <th>Descripción</th>
                              <th style={{width:55}}>Unidad</th>
                              <th style={{width:70}} className="text-end">Cant. prev.</th>
                              <th style={{width:80}} className="text-end">Stock act.</th>
                              <th>Observaciones</th>
                              {canWrite && <th style={{width:50}}/>}
                            </tr>
                          </thead>
                          <tbody>
                            {materiales.map(m => {
                              const stock = m.stock_actual ?? null
                              const ok = stock !== null && stock >= m.cantidad
                              const bajo = stock !== null && stock > 0 && stock < m.cantidad
                              const sin = stock !== null && stock <= 0
                              return (
                                <tr key={m.id}>
                                  <td className="text-muted" style={{fontFamily:'monospace', fontSize:'0.72rem'}}>{m.codigo || '—'}</td>
                                  <td><div className="text-truncate" style={{maxWidth:200}} title={m.descripcion}>{m.descripcion}</div></td>
                                  <td className="text-muted">{m.unidad}</td>
                                  <td className="text-end fw-semibold">{fmtN(m.cantidad)}</td>
                                  <td className="text-end">
                                    {stock === null
                                      ? <span className="text-muted">—</span>
                                      : <span className={ok ? 'text-success fw-semibold' : bajo ? 'text-warning fw-semibold' : sin ? 'text-danger fw-semibold' : 'text-muted'}>
                                          {fmtN(stock)}
                                        </span>
                                    }
                                  </td>
                                  <td className="text-muted">
                                    <div className="text-truncate" style={{maxWidth:160}} title={m.observaciones}>{m.observaciones || ''}</div>
                                  </td>
                                  {canWrite && (
                                    <td>
                                      <div className="d-flex gap-1">
                                        <button className="btn btn-xs py-0 px-1" title="Editar"
                                          onClick={() => { setFormMat({producto_id:m.producto_id||'',codigo:m.codigo||'',descripcion:m.descripcion,unidad:m.unidad,cantidad:m.cantidad,observaciones:m.observaciones||''}); setBuscarMat(m.descripcion); setSugsMat([]); setErrMat(''); setModalMat(m) }}>
                                          <i className="bi bi-pencil text-secondary"/>
                                        </button>
                                        <button className="btn btn-xs py-0 px-1" title="Eliminar"
                                          onClick={() => eliminarMaterial(m)}>
                                          <i className="bi bi-trash text-danger"/>
                                        </button>
                                      </div>
                                    </td>
                                  )}
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                        <div className="px-2 py-1 border-top text-muted" style={{fontSize:'0.72rem'}}>
                          {materiales.length} material{materiales.length !== 1 ? 'es' : ''}
                        </div>
                      </div>
                  }
                </>
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

              {/* ── Entrega de documentación (Form 56) ── */}
              {tab === 'entregas' && (
                <>
                  <div className="d-flex justify-content-between align-items-center mb-2">
                    <span className="small text-muted fw-medium">
                      <i className="bi bi-file-arrow-up me-1"/>Entregas / solicitudes de documentación
                    </span>
                    {canWrite && (
                      <button className="btn btn-sm btn-primary py-0 px-2" style={{fontSize:'0.78rem'}}
                        onClick={() => {
                          const b1 = (selP?.codigo || '').slice(0, 5).toUpperCase()
                          const nroOc = ocCliente?.numero_oc || ''
                          const b2 = ultimos6DeOC(nroOc)
                          setFormEnt({...FORM_ENT_VACIO, fecha: hoyStr(), nro_oc: nroOc, codigo_plano: ensamblarCodigo(b1,b2,'','','')})
                          setCodBuilder({...COD_BUILDER_VACIO, b1, b2})
                          setErrEnt(''); setModalEnt('nuevo')
                        }}>
                        <i className="bi bi-plus-lg me-1"/>Agregar
                      </button>
                    )}
                  </div>
                  {loadEnt ? (
                    <div className="text-center py-4"><span className="spinner-border spinner-border-sm"/></div>
                  ) : entregas.length === 0 ? (
                    <div className="text-center text-muted py-4" style={{fontSize:'0.85rem'}}>
                      <i className="bi bi-inbox d-block fs-4 mb-1"/>Sin registros de entrega de documentación
                    </div>
                  ) : (
                    <div className="table-responsive">
                      <table className="table table-sm table-hover align-middle mb-0" style={{fontSize:'0.76rem'}}>
                        <thead className="table-light">
                          <tr>
                            <th style={{width:80}}>Fecha</th>
                            <th style={{width:90}}>Nº OC</th>
                            <th style={{width:60}}>Tipo</th>
                            <th style={{width:60}}>Formato</th>
                            <th>Documento</th>
                            <th style={{width:100}}>Cód. Plano</th>
                            <th style={{width:55}}>Nivel</th>
                            <th style={{width:110}}>Individuo</th>
                            <th>Comentarios</th>
                            <th style={{width:50}}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {entregas.map(ent => {
                            const tipo = TIPOS_ENT.find(t => t.v === ent.tipo)
                            return (
                              <tr key={ent.id}>
                                <td className="text-muted">{fmtF(ent.fecha)}</td>
                                <td className="text-muted" style={{fontFamily:'monospace',fontSize:'0.72rem'}}>{ent.nro_oc||'—'}</td>
                                <td>
                                  <span className={`badge bg-${tipo?.c||'secondary'}`} style={{fontSize:'0.65rem'}} title={tipo?.label}>
                                    {ent.tipo}
                                  </span>
                                </td>
                                <td><span className="badge bg-light text-dark border" style={{fontSize:'0.65rem'}}>{ent.formato||'—'}</span></td>
                                <td>
                                  <div className="text-truncate" style={{maxWidth:200}} title={ent.documento}>{ent.documento||'—'}</div>
                                </td>
                                <td className="text-muted" style={{fontFamily:'monospace',fontSize:'0.72rem'}}>{ent.codigo_plano||'—'}</td>
                                <td className="text-muted text-center">{ent.plano_nivel||'—'}</td>
                                <td className="text-muted">{ent.individuo||'—'}</td>
                                <td>
                                  <div className="text-truncate text-muted" style={{maxWidth:160}} title={ent.comentarios}>{ent.comentarios||''}</div>
                                </td>
                                <td>
                                  {canWrite && (
                                    <div className="d-flex gap-1">
                                      <button className="btn btn-xs py-0 px-1" style={{fontSize:'0.7rem'}} title="Editar"
                                        onClick={() => { const cp=ent.codigo_plano||''; const nv=ent.plano_nivel||''; setFormEnt({fecha:ent.fecha,nro_oc:ent.nro_oc||'',formato:ent.formato||'',documento:ent.documento||'',plano_nivel:nv,codigo_plano:cp,tipo:ent.tipo||'S',individuo:ent.individuo||'',comentarios:ent.comentarios||''}); setCodBuilder(parsearCodigo(cp,nv)); setErrEnt(''); setModalEnt(ent) }}>
                                        <i className="bi bi-pencil text-secondary"/>
                                      </button>
                                      <button className="btn btn-xs py-0 px-1" style={{fontSize:'0.7rem'}} title="Eliminar"
                                        onClick={() => eliminarEntrega(ent)}>
                                        <i className="bi bi-trash text-danger"/>
                                      </button>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                      <div className="px-2 py-1 border-top text-muted" style={{fontSize:'0.72rem'}}>
                        {entregas.length} registro{entregas.length !== 1 ? 's' : ''}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* ── Plan / Gantt ── */}
              {tab === 'plan' && (
                <>
                  {canWrite && (
                    <div className="d-flex justify-content-start mb-2">
                      <button className="btn btn-sm btn-outline-warning" onClick={() => setShowPlantilla(true)}>
                        <i className="bi bi-layout-text-sidebar-reverse me-1"/>Editor de plantillas
                      </button>
                    </div>
                  )}
                  <PlanGantt proyecto={detalle || selP} canWrite={canWrite} />
                </>
              )}

            </div>
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
                      onChange={e=>setFormP(p=>({...p,codigo:e.target.value.toUpperCase()}))}
                      onBlur={e=>{
                        let v = e.target.value.trim().toUpperCase()
                        if (!v) return
                        if (v.includes('/')) v = v.replace('/', '')
                        if (!/\d$/.test(v)) v = v + '0'
                        setFormP(p=>({...p,codigo:v}))
                      }}/>
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
                    <EmpleadoSelect
                      className="form-select form-select-sm"
                      value={formP.responsable}
                      onChange={v => setFormP(p => ({ ...p, responsable: v }))}
                    />
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
                    <DateInput className="form-control form-control-sm"
                      value={formP.fecha_inicio} onChange={v=>setFormP(p=>({...p,fecha_inicio:v}))}/>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label small fw-medium">F. Fin Est.</label>
                    <DateInput className="form-control form-control-sm"
                      value={formP.fecha_fin_est} onChange={v=>setFormP(p=>({...p,fecha_fin_est:v}))}/>
                  </div>
                </div>
                {modalP !== 'nuevo' && (
                  <div className="mt-3 p-2 rounded" style={{background:'#f8f9fa', fontSize:'0.8rem'}}>
                    <div className="fw-semibold text-muted mb-1">
                      <i className="bi bi-file-earmark-text me-1"/>OC de Cliente vinculada
                    </div>
                    {ocCliente ? (
                      <div className="d-flex flex-wrap gap-3">
                        <span><strong>N°:</strong> {ocCliente.numero_oc || '—'}</span>
                        <span><strong>Fecha:</strong> {fmtF(ocCliente.fecha_oc)}</span>
                      </div>
                    ) : (
                      <span className="text-muted fst-italic">Sin OC vinculada. Se vincula desde Finanzas → OC Clientes.</span>
                    )}
                  </div>
                )}
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

      {/* ── Modal importar Form 56 ─────────────────────────────────────── */}
      {modalF56 && (
        <div className="modal fade show d-block" style={{background:'rgba(0,0,0,.45)'}}>
          <div className="modal-dialog modal-dialog-centered modal-lg">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h6 className="modal-title">
                  <i className="bi bi-file-earmark-arrow-up me-2"/>
                  Importar Form 56 — Documentación entregada (2025-2026)
                </h6>
                <button type="button" className="btn-close" onClick={() => setModalF56(false)}/>
              </div>
              <div className="modal-body">
                {f56Load ? (
                  <div className="text-center py-4"><span className="spinner-border"/></div>
                ) : !f56Preview ? (
                  <div className="alert alert-danger">{f56Msg || 'No se pudo cargar la vista previa.'}</div>
                ) : (
                  <>
                    <div className="alert alert-info py-2 small mb-3">
                      <strong>{f56Preview.total} registros</strong> listos para importar (2025-2026).
                      {f56Preview.yaImportados > 0 && (
                        <span className="ms-2 text-warning fw-semibold">
                          ⚠ Ya hay {f56Preview.yaImportados} importados — al reimportar se reemplazan todos.
                        </span>
                      )}
                    </div>
                    <p className="small text-muted mb-2 fw-medium">
                      Asociá cada nombre del Excel con el proyecto correspondiente del ERP:
                    </p>
                    <table className="table table-sm mb-0" style={{fontSize:'0.85rem'}}>
                      <thead className="table-light">
                        <tr>
                          <th>Nombre en el Excel</th>
                          <th>→ Proyecto en el ERP</th>
                        </tr>
                      </thead>
                      <tbody>
                        {f56Preview.proyNames.map(nombre => (
                          <tr key={nombre}>
                            <td className="align-middle fw-medium">{nombre}</td>
                            <td>
                              <select className="form-select form-select-sm"
                                value={f56Mapping[nombre] || ''}
                                onChange={e => setF56Mapping(m => ({...m, [nombre]: e.target.value}))}>
                                <option value="">— Sin asociar (importar solo con nombre) —</option>
                                {proyectos.map(p => (
                                  <option key={p.id} value={String(p.id)}>
                                    {p.codigo} — {p.nombre} {p.cliente_nombre ? `(${p.cliente_nombre})` : ''}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {f56Msg && (
                      <div className={`alert py-2 small mt-3 mb-0 alert-${f56Msg.startsWith('✓') ? 'success' : 'danger'}`}>
                        {f56Msg}
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="modal-footer py-2">
                <button className="btn btn-sm btn-secondary" onClick={() => setModalF56(false)}>Cerrar</button>
                {f56Preview && (
                  <button className="btn btn-sm btn-primary" onClick={ejecutarImportF56} disabled={f56Sav}>
                    {f56Sav
                      ? <><span className="spinner-border spinner-border-sm me-1"/>Importando...</>
                      : <><i className="bi bi-cloud-upload me-1"/>Importar {f56Preview.total} registros</>
                    }
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal entrega de documentación ────────────────────────────── */}
      {modalEnt !== null && (
        <div className="modal fade show d-block" style={{background:'rgba(0,0,0,.45)'}}>
          <div className="modal-dialog modal-dialog-centered modal-lg">
            <form className="modal-content" onSubmit={guardarEntrega}>
              <div className="modal-header py-2">
                <h6 className="modal-title">
                  <i className="bi bi-file-arrow-up me-2"/>
                  {modalEnt === 'nuevo' ? 'Nueva entrega de documentación' : 'Editar entrega'}
                </h6>
                <button type="button" className="btn-close" onClick={() => setModalEnt(null)}/>
              </div>
              <div className="modal-body">
                <div className="row g-2">
                  <div className="col-md-3">
                    <label className="form-label small fw-medium">Fecha *</label>
                    <DateInput className="form-control form-control-sm" required
                      value={formEnt.fecha}
                      onChange={v => setFormEnt(p => ({...p, fecha: v}))}/>
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-medium">Nº OC</label>
                    <input className="form-control form-control-sm" placeholder="Ej: OC 4500000517"
                      value={formEnt.nro_oc}
                      onChange={e => {
                        const v = e.target.value
                        setFormEnt(p => ({...p, nro_oc: v}))
                        updBuilder('b2', ultimos6DeOC(v))
                      }}/>
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-medium">Tipo *</label>
                    <select className="form-select form-select-sm" required
                      value={formEnt.tipo}
                      onChange={e => setFormEnt(p => ({...p, tipo: e.target.value}))}>
                      {TIPOS_ENT.map(t => <option key={t.v} value={t.v}>{t.v} — {t.label}</option>)}
                    </select>
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-medium">Formato</label>
                    <select className="form-select form-select-sm"
                      value={formEnt.formato}
                      onChange={e => setFormEnt(p => ({...p, formato: e.target.value}))}>
                      <option value="">— Sin formato —</option>
                      {FORMATOS_ENT.map(f => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </div>
                  <div className="col-md-10">
                    <label className="form-label small fw-medium">Documento entregado <span className="text-muted fw-normal">(descripción)</span></label>
                    <input className="form-control form-control-sm" placeholder="Ej: Vistas generales estructura"
                      value={formEnt.documento}
                      onChange={e => setFormEnt(p => ({...p, documento: e.target.value}))}/>
                  </div>
                  <div className="col-md-2">
                    <label className="form-label small fw-medium">Individuo</label>
                    <input className="form-control form-control-sm" placeholder="Persona"
                      value={formEnt.individuo}
                      onChange={e => setFormEnt(p => ({...p, individuo: e.target.value}))}/>
                  </div>
                  <div className="col-12">
                    <label className="form-label small fw-medium">
                      Código de plano
                      <span className="text-muted fw-normal ms-2" style={{fontSize:'0.7rem'}}>
                        B1·Proyecto — B2·OC (6 díg.) — B3·Destino — B4·Nivel — B5·Hoja (PE-08)
                      </span>
                      {!isAdmin && (
                        <span className="text-muted fw-normal ms-2" style={{fontSize:'0.68rem'}}>
                          <i className="bi bi-lock-fill me-1"/>B1 y B2 se completan automáticamente
                        </span>
                      )}
                    </label>
                    <div className="d-flex gap-1 align-items-center mb-1 flex-wrap">
                      <input className="form-control form-control-sm" style={{width:72}} placeholder="B1 proyecto"
                        title="Código del proyecto — solo el administrador puede editarlo manualmente"
                        value={codBuilder.b1} onChange={e => updBuilder('b1', e.target.value.toUpperCase())}
                        disabled={!isAdmin} maxLength={6}/>
                      <span className="text-muted">-</span>
                      <input className="form-control form-control-sm" style={{width:90}} placeholder="B2 OC"
                        title="Últimos 6 dígitos del Nº OC — solo el administrador puede editarlo manualmente"
                        value={codBuilder.b2} onChange={e => updBuilder('b2', e.target.value.toUpperCase())}
                        disabled={!isAdmin} maxLength={10}/>
                      <span className="text-muted">-</span>
                      <select className="form-select form-select-sm" style={{width:82}}
                        value={codBuilder.b3} onChange={e => updBuilder('b3', e.target.value)}>
                        <option value="">B3</option>
                        {DESTINOS_ENT.map(d => <option key={d} value={d} title={DESTINOS_LABEL[d]}>{d} · {DESTINOS_LABEL[d]}</option>)}
                      </select>
                      <span className="text-muted">-</span>
                      <select className="form-select form-select-sm" style={{width:82}}
                        value={formEnt.plano_nivel} onChange={e => updNivel(e.target.value)}>
                        <option value="">B4</option>
                        {NIVELES_ENT.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                      <span className="text-muted">-</span>
                      <input className="form-control form-control-sm" style={{width:65}} placeholder="B5 hoja"
                        value={codBuilder.b5} onChange={e => updBuilder('b5', e.target.value.toUpperCase())} maxLength={6}/>
                    </div>
                    <input className="form-control form-control-sm font-monospace fw-semibold"
                      placeholder="Código ensamblado — editable manualmente"
                      value={formEnt.codigo_plano}
                      onChange={e => setFormEnt(p => ({...p, codigo_plano: e.target.value}))}/>
                    {(codBuilder.b1 || codBuilder.b2) && (
                      <div className="text-muted mt-1" style={{fontSize:'0.68rem'}}>
                        <i className="bi bi-file-earmark me-1"/>
                        Archivo (A): {[codBuilder.b1||'XXXXX', codBuilder.b2.slice(0,6)||'XXXXXX', (codBuilder.b3||'XX')+(formEnt.plano_nivel||'XX'), 'REVA', 'XX', formEnt.fecha?.replace(/-/g,'')||'XXXXXXXX'].join('-')}
                      </div>
                    )}
                  </div>
                  <div className="col-12">
                    <label className="form-label small fw-medium">Comentarios</label>
                    <input className="form-control form-control-sm"
                      value={formEnt.comentarios}
                      onChange={e => setFormEnt(p => ({...p, comentarios: e.target.value}))}/>
                  </div>
                </div>
                {errEnt && <div className="alert alert-danger mt-2 py-1 small mb-0">{errEnt}</div>}
              </div>
              <div className="modal-footer py-2">
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setModalEnt(null)}>Cancelar</button>
                <button type="submit" className="btn btn-sm btn-primary" disabled={savEnt}>
                  {savEnt ? <><span className="spinner-border spinner-border-sm me-1"/>Guardando...</> : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal material previsto ───────────────────────────────────── */}
      {modalMat !== null && (
        <div className="modal fade show d-block" style={{background:'rgba(0,0,0,.45)'}}>
          <div className="modal-dialog modal-dialog-centered">
            <form className="modal-content" onSubmit={guardarMaterial}>
              <div className="modal-header py-2">
                <h6 className="modal-title">
                  <i className="bi bi-boxes me-2"/>
                  {modalMat === 'nuevo' ? 'Agregar material' : 'Editar material'}
                </h6>
                <button type="button" className="btn-close" onClick={() => setModalMat(null)}/>
              </div>
              <div className="modal-body">
                <div className="row g-2">
                  <div className="col-12">
                    <label className="form-label small fw-medium">Material *</label>
                    <div className="position-relative">
                      <input className="form-control form-control-sm" required
                        placeholder="Buscar por código o descripción..."
                        value={buscarMat}
                        onChange={e => buscarProductoMat(e.target.value)}
                        onBlur={() => setTimeout(() => setSugsMat([]), 200)}
                        autoComplete="off"/>
                      {sugsMat.length > 0 && (
                        <div className="border rounded shadow bg-white position-absolute w-100" style={{zIndex:9999,top:'100%',maxHeight:220,overflowY:'auto'}}>
                          {sugsMat.map(p => (
                            <div key={p.id}
                              className="d-flex align-items-center gap-2 px-2 py-2 border-bottom"
                              style={{cursor:'pointer', fontSize:'0.82rem'}}
                              onMouseDown={() => selProductoMat(p)}>
                              <span className="badge bg-dark flex-shrink-0" style={{fontFamily:'monospace',fontSize:'0.7rem',minWidth:72}}>{p.codigo}</span>
                              <span className="flex-grow-1 text-truncate">{p.descripcion}</span>
                              <span className="text-muted flex-shrink-0" style={{fontSize:'0.72rem'}}>{p.unidad} · stock: {fmtN(p.stock_actual)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {formMat.codigo && (
                      <div className="mt-1 small text-muted">
                        <i className="bi bi-check-circle-fill text-success me-1"/>
                        Vinculado: <strong style={{fontFamily:'monospace'}}>{formMat.codigo}</strong>
                      </div>
                    )}
                  </div>
                  <div className="col-md-4">
                    <label className="form-label small fw-medium">Unidad</label>
                    <input className="form-control form-control-sm" value={formMat.unidad}
                      onChange={e => setFormMat(p => ({...p, unidad: e.target.value}))}/>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label small fw-medium">Cantidad prevista *</label>
                    <input type="number" className="form-control form-control-sm" required min="0" step="any"
                      value={formMat.cantidad}
                      onChange={e => setFormMat(p => ({...p, cantidad: e.target.value}))}/>
                  </div>
                  <div className="col-12">
                    <label className="form-label small fw-medium">Observaciones</label>
                    <input className="form-control form-control-sm" placeholder="Notas opcionales"
                      value={formMat.observaciones}
                      onChange={e => setFormMat(p => ({...p, observaciones: e.target.value}))}/>
                  </div>
                </div>
                {errMat && <div className="alert alert-danger mt-2 py-1 small mb-0">{errMat}</div>}
              </div>
              <div className="modal-footer py-2">
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => setModalMat(null)}>Cancelar</button>
                <button type="submit" className="btn btn-sm btn-primary" disabled={savMat}>
                  {savMat ? <><span className="spinner-border spinner-border-sm me-1"/>Guardando...</> : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal normalizar responsables ────────────────────────────── */}
      {modalNorm && (
        <div className="modal fade show d-block" style={{background:'rgba(0,0,0,.45)'}}>
          <div className="modal-dialog modal-dialog-centered modal-lg">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h6 className="modal-title"><i className="bi bi-people me-2"/>Normalizar responsables</h6>
                <button type="button" className="btn-close" onClick={() => setModalNorm(false)}/>
              </div>
              <div className="modal-body">
                <p className="small text-muted mb-2">
                  Mapeá cada nombre guardado en el Form 30 con el empleado correcto de RRHH.
                  Solo se actualizan las filas donde seleccionaste un cambio.
                </p>
                {normLoad ? (
                  <div className="text-center py-3"><span className="spinner-border spinner-border-sm"/></div>
                ) : normData.length === 0 ? (
                  <div className="text-muted text-center py-3">No hay responsables asignados en ningún documento.</div>
                ) : (
                  <table className="table table-sm mb-0" style={{fontSize:'0.82rem'}}>
                    <thead className="table-light">
                      <tr>
                        <th>Valor actual en DB</th>
                        <th className="text-center" style={{width:60}}>Docs</th>
                        <th>→ Reemplazar con</th>
                      </tr>
                    </thead>
                    <tbody>
                      {normData.map(d => (
                        <tr key={d.responsable} className={normMap[d.responsable] ? 'table-warning' : ''}>
                          <td className="font-monospace align-middle">{d.responsable}</td>
                          <td className="text-center text-muted align-middle">{d.total}</td>
                          <td>
                            <EmpleadoSelect
                              className="form-select form-select-sm"
                              value={normMap[d.responsable] || ''}
                              onChange={v => setNormMap(m => ({ ...m, [d.responsable]: v }))}
                              placeholder="— sin cambio —"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {normMsg && (
                  <div className={`alert py-1 small mt-2 mb-0 alert-${normMsg.startsWith('✓') ? 'success' : normMsg.startsWith('No') ? 'warning' : 'danger'}`}>
                    {normMsg}
                  </div>
                )}
              </div>
              <div className="modal-footer py-2">
                <button className="btn btn-sm btn-secondary" onClick={() => setModalNorm(false)}>Cerrar</button>
                <button className="btn btn-sm btn-primary" onClick={aplicarNorm} disabled={normSav || normLoad}>
                  {normSav
                    ? <><span className="spinner-border spinner-border-sm me-1"/>Aplicando...</>
                    : <><i className="bi bi-check2-all me-1"/>Aplicar cambios</>
                  }
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
