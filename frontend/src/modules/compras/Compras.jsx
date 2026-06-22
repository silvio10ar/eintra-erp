import { useState, useEffect, useCallback, useRef } from 'react'
import api from '../../api/client'
import { puedeEscribir } from '../../store/authStore'
import Form49 from './Form49'
import { Asistente } from '../codificacion/AsistenteCore'
import EmpleadoSelect from '../../components/EmpleadoSelect'

const ESTADOS = [
  { v:'Emitida',   c:'warning' },
  { v:'Parcial',   c:'info'    },
  { v:'Recibida',  c:'success' },
  { v:'Cancelada', c:'danger'  },
]

const fmtN = n => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(n ?? 0)
const fmtF = iso => iso ? iso.slice(0,10).split('-').reverse().join('/') : '—'
const hoy  = () => new Date().toISOString().slice(0,10)

const FORM_PROV = { nombre:'', cuit:'', contacto:'', telefono:'', email:'', direccion:'', localidad:'', cp:'', vendedor:'', condicion_pago:'TRANSF. BANCARIA' }
const CAMPOS_PROV = [
  { k:'nombre',         l:'Nombre'         },
  { k:'cuit',           l:'CUIT'           },
  { k:'contacto',       l:'Contacto'       },
  { k:'telefono',       l:'Teléfono'       },
  { k:'email',          l:'Email'          },
  { k:'direccion',      l:'Dirección'      },
  { k:'localidad',      l:'Localidad'      },
  { k:'cp',             l:'C.P.'           },
  { k:'vendedor',       l:'Vendedor'       },
  { k:'condicion_pago', l:'Cond. de Pago'  },
]
const ITEM_VACIO = { producto_id:'', descripcion:'', unidad:'UND.', cantidad:1, precio_unitario:0, bonif1:0, bonif2:0, bonif3:0, bonif4:0, precio_final:0, plazo:'INMEDIATO', cant_recibida:0 }
const FORM_OC = { proveedor_id:'', proveedor_nombre:'', proveedor_cuit:'', fecha:hoy(), moneda:'DÓLAR', tasa_cambio:0, autorizado_por:'', elaborado_por:'', condicion_pago:'TRANSF. BANCARIA', lugar_entrega:'e-intra', presupuesto_n:'', observaciones:'', fecha_entrega_est:'', estado_doc:'', items:[{ ...ITEM_VACIO }] }

const ESTADOS_DOC = ['', 'PENDIENTE', 'RECIBIDA', 'CONFORME', 'NO CONFORME', 'OBSERVADA']

function calcFinal(p, b1, b2, b3, b4) {
  let v = parseFloat(p) || 0
  for (const b of [b1, b2, b3, b4]) { const pct = parseFloat(b)||0; if (pct > 0) v = v * (1 - pct/100) }
  return Math.round(v * 10000) / 10000
}

export default function Compras() {
  const canWrite = puedeEscribir('compras')
  const [tab, setTab] = useState('oc')

  /* ── OC ─────────────────────────────────────────────────────────── */
  const [ocs, setOcs]         = useState([])
  const [totalOC, setTotalOC] = useState(0)
  const [pageOC, setPageOC]   = useState(1)
  const [loadOC, setLoadOC]   = useState(true)
  const [filtOC, setFiltOC]   = useState({ estado:'', buscar:'', desde:'', hasta:'' })
  const [selOC, setSelOC]     = useState(null)

  /* ── Proveedores ────────────────────────────────────────────────── */
  const [provs, setProvs]           = useState([])
  const [buscarProv, setBuscarProv] = useState('')
  const [loadProv, setLoadProv]     = useState(false)
  const [selProvs, setSelProvs]     = useState(new Set())
  const [modalFusion, setModalFusion] = useState(null)  // { provs, masterId, datos }
  const [savFusion, setSavFusion]   = useState(false)

  /* ── Modal detalle OC ───────────────────────────────────────────── */
  const [modalOC, setModalOC] = useState(null)
  const [loadDet, setLoadDet] = useState(false)

  /* ── Modal crear / editar OC ────────────────────────────────────── */
  const [modalForm, setModalForm]   = useState(null)
  const [formOC, setFormOC]         = useState(FORM_OC)
  const [savOC, setSavOC]           = useState(false)
  const [errOC, setErrOC]           = useState('')
  const [sugsP, setSugsP]           = useState([])
  const [provInfoOC, setProvInfoOC] = useState(null)  // datos completos del proveedor seleccionado
  const [sugsItem, setSugsItem]     = useState({ idx: null, list: [], pos: null })
  const itemDescRefs = useRef({})
  const [productos, setProductos]   = useState([])

  /* ── Modal recibir ──────────────────────────────────────────────── */
  const [modalRec, setModalRec]     = useState(null)
  const [recCants, setRecCants]     = useState({})
  const [fechaRec, setFechaRec]     = useState(hoy())
  const [nroRemito, setNroRemito]   = useState('')
  const [savRec, setSavRec]         = useState(false)

  /* ── Modal nuevo material ───────────────────────────────────────── */
  const [codConfig,      setCodConfig]     = useState(null)
  const [modalNuevoMat,  setModalNuevoMat] = useState(null)  // null | { idx }
  const [pasoNuevoMat,   setPasoNuevoMat]  = useState('codigo')  // 'codigo' | 'datos'
  const [codNuevoMat,    setCodNuevoMat]   = useState('')
  const [formNuevoMat,   setFormNuevoMat]  = useState({ descripcion:'', categoria:'', unidad:'UND.', precio_costo:0, ubicacion:'', stock_minimo:0 })
  const [savNuevoMat,    setSavNuevoMat]   = useState(false)
  const [errNuevoMat,    setErrNuevoMat]   = useState('')

  /* ── Modal proveedor ────────────────────────────────────────────── */
  const [modalProv, setModalProv] = useState(null)
  const [formProv, setFormProv]   = useState(FORM_PROV)
  const [savProv, setSavProv]     = useState(false)
  const [errProv, setErrProv]     = useState('')

  /* ── Cargar OC ──────────────────────────────────────────────────── */
  const cargarOC = useCallback(() => {
    setLoadOC(true)
    const p = { page: pageOC, limit: 50 }
    if (filtOC.estado) p.estado = filtOC.estado
    if (filtOC.buscar) p.buscar = filtOC.buscar
    if (filtOC.desde)  p.desde  = filtOC.desde
    if (filtOC.hasta)  p.hasta  = filtOC.hasta
    api.get('/compras/oc', { params: p })
      .then(r => { setOcs(r.data.datos); setTotalOC(r.data.total) })
      .finally(() => setLoadOC(false))
  }, [pageOC, filtOC])

  useEffect(() => { if (tab === 'oc') cargarOC() }, [cargarOC, tab])

  /* ── Cargar Proveedores ─────────────────────────────────────────── */
  const cargarProveedores = useCallback(() => {
    setLoadProv(true)
    api.get('/compras/proveedores', { params: buscarProv ? { buscar: buscarProv } : {} })
      .then(r => setProvs(r.data))
      .finally(() => setLoadProv(false))
  }, [buscarProv])

  useEffect(() => { if (tab === 'proveedores') cargarProveedores() }, [cargarProveedores, tab])

  useEffect(() => {
    api.get('/compras/proveedores').then(r => setProvs(r.data)).catch(() => {})
    api.get('/stock/productos').then(r => setProductos(r.data)).catch(() => {})
    api.get('/codificacion/config').then(r => setCodConfig(r.data)).catch(() => {})
  }, [])

  /* ── Detalle OC ─────────────────────────────────────────────────── */
  const verOC = id => {
    setLoadDet(true); setModalOC(null)
    api.get(`/compras/oc/${id}`).then(r => setModalOC(r.data)).finally(() => setLoadDet(false))
  }

  /* ── Form OC ────────────────────────────────────────────────────── */
  const abrirNuevaOC = () => {
    setFormOC({ ...FORM_OC, fecha: hoy(), items: [{ ...ITEM_VACIO }] })
    setErrOC(''); setSugsP([]); setSugsItem({ idx: null, list: [] }); setProvInfoOC(null); setModalForm('nuevo')
  }

  const abrirEditarOC = oc => {
    setFormOC({
      proveedor_id: oc.proveedor_id || '', proveedor_nombre: oc.proveedor_nombre, proveedor_cuit: oc.proveedor_cuit || '',
      fecha: oc.fecha, moneda: oc.moneda, tasa_cambio: oc.tasa_cambio || 0,
      autorizado_por: oc.autorizado_por || '', elaborado_por: oc.elaborado_por || '',
      condicion_pago: oc.condicion_pago || 'TRANSF. BANCARIA', lugar_entrega: oc.lugar_entrega || 'e-intra',
      presupuesto_n: oc.presupuesto_n || '', observaciones: oc.observaciones || '',
      fecha_entrega_est: oc.fecha_entrega_est || '',
      estado_doc: oc.estado_doc || '',
      items: oc.items?.length
        ? oc.items.map(it => ({ id: it.id, producto_id: it.producto_id||'', descripcion: it.descripcion||'', unidad: it.unidad||'UND.', cantidad: it.cantidad, precio_unitario: it.precio_unitario, bonif1: it.bonif1||0, bonif2: it.bonif2||0, bonif3: it.bonif3||0, bonif4: it.bonif4||0, precio_final: it.precio_final, plazo: it.plazo||'INMEDIATO', cant_recibida: it.cant_recibida||0 }))
        : [{ ...ITEM_VACIO }],
    })
    setErrOC(''); setSugsP([]); setSugsItem({ idx: null, list: [] }); setModalForm(oc)
    // Cargar datos de contacto del proveedor
    if (oc.proveedor_id) {
      api.get('/compras/proveedores/buscar', { params: { id: oc.proveedor_id } })
        .then(r => setProvInfoOC(r.data)).catch(() => {})
    } else if (oc.proveedor_nombre) {
      api.get('/compras/proveedores/buscar', { params: { nombre: oc.proveedor_nombre } })
        .then(r => setProvInfoOC(r.data)).catch(() => {})
    } else {
      setProvInfoOC(null)
    }
  }

  const guardarOC = async e => {
    e.preventDefault(); setSavOC(true); setErrOC('')
    try {
      const body = { ...formOC, proveedor_id: formOC.proveedor_id || null, tasa_cambio: parseFloat(formOC.tasa_cambio)||0, items: formOC.items.filter(it => it.descripcion.trim()) }
      if (modalForm === 'nuevo') await api.post('/compras/oc', body)
      else await api.put(`/compras/oc/${modalForm.id}`, body)
      setModalForm(null); cargarOC()
    } catch(err) { setErrOC(err.response?.data?.error ?? 'Error al guardar') }
    finally { setSavOC(false) }
  }

  const eliminarOC = async id => {
    if (!confirm('¿Eliminar esta OC? La acción no se puede deshacer.')) return
    await api.delete(`/compras/oc/${id}`)
    setModalOC(null); cargarOC()
  }

  /* ── Recibir OC ─────────────────────────────────────────────────── */
  const abrirRecibir = oc => {
    const cants = {}
    for (const it of oc.items || []) {
      if (it.producto_id) { const pend = it.cantidad - (it.cant_recibida||0); cants[it.id] = pend > 0 ? pend : 0 }
    }
    setRecCants(cants); setFechaRec(hoy()); setNroRemito(''); setSavRec(false); setModalRec(oc)
  }

  const confirmarRecibir = async () => {
    setSavRec(true)
    try {
      await api.post(`/compras/oc/${modalRec.id}/recibir`, { recepciones: recCants, fecha: fechaRec, numero_remito: nroRemito||undefined })
      setModalRec(null); setModalOC(null); cargarOC()
      alert('Recepción registrada. Los materiales quedaron pendientes de ingreso al stock.')
    } catch(err) { alert(err.response?.data?.error ?? 'Error al recibir') }
    finally { setSavRec(false) }
  }

  /* ── Items OC ───────────────────────────────────────────────────── */
  const setItem = (idx, campo, val) => setFormOC(prev => ({
    ...prev, items: prev.items.map((it, i) => {
      if (i !== idx) return it
      const next = { ...it, [campo]: val }
      next.precio_final = calcFinal(next.precio_unitario, next.bonif1, next.bonif2, next.bonif3, next.bonif4)
      return next
    })
  }))

  const agregarItem = () => setFormOC(p => ({ ...p, items: [...p.items, { ...ITEM_VACIO }] }))
  const quitarItem  = idx => setFormOC(p => ({ ...p, items: p.items.filter((_,i)=>i!==idx) }))

  const buscarProductoItem = (idx, txt) => {
    setItem(idx, 'descripcion', txt)
    if (!txt) { setSugsItem({ idx: null, list: [], pos: null }); return }
    const words = txt.toLowerCase().split(/\s+/).filter(Boolean)
    const list = productos.filter(p => {
      const hay = (p.codigo + ' ' + p.descripcion).toLowerCase()
      return words.every(w => hay.includes(w))
    }).slice(0, 20)
    const el = itemDescRefs.current[idx]
    const pos = el ? (() => { const r = el.getBoundingClientRect(); return { top: r.bottom + window.scrollY, left: r.left + window.scrollX, width: Math.max(r.width, 480) } })() : null
    setSugsItem({ idx, list, pos })
  }

  const selProductoItem = (idx, prod) => {
    setFormOC(prev => ({
      ...prev, items: prev.items.map((it, i) => i !== idx ? it : { ...it, producto_id: prod.id, descripcion: prod.descripcion, unidad: prod.unidad||'UND.', precio_unitario: prod.precio_costo||0, precio_final: calcFinal(prod.precio_costo||0, it.bonif1, it.bonif2, it.bonif3, it.bonif4) })
    }))
    setSugsItem({ idx: null, list: [] })
  }

  const abrirNuevoMat = idx => {
    setSugsItem({ idx: null, list: [] })
    setModalNuevoMat({ idx })
    setPasoNuevoMat('codigo')
    setCodNuevoMat('')
    setFormNuevoMat({ descripcion:'', categoria:'', unidad:'UND.', precio_costo:0, ubicacion:'', stock_minimo:0 })
    setErrNuevoMat('')
  }

  const usarCodigoNuevoMat = (codigo, descripcion) => {
    setCodNuevoMat(codigo)
    if (descripcion) setFormNuevoMat(p => ({ ...p, descripcion }))
    setPasoNuevoMat('datos')
  }

  const guardarNuevoMat = async () => {
    setSavNuevoMat(true); setErrNuevoMat('')
    try {
      const r = await api.post('/stock/productos', { codigo: codNuevoMat, ...formNuevoMat, stock_actual: 0 })
      const nuevo = r.data
      const lista = await api.get('/stock/productos')
      setProductos(lista.data)
      selProductoItem(modalNuevoMat.idx, nuevo)
      setModalNuevoMat(null)
    } catch(err) {
      setErrNuevoMat(err.response?.data?.error ?? 'Error al guardar')
    } finally {
      setSavNuevoMat(false)
    }
  }

  const buscarProvOC = txt => {
    setFormOC(p => ({ ...p, proveedor_nombre: txt, proveedor_id: '' }))
    setProvInfoOC(null)
    if (!txt) { setSugsP([]); return }
    const q = txt.toLowerCase()
    setSugsP(provs.filter(p => p.nombre.toLowerCase().includes(q) || (p.cuit||'').includes(q)).slice(0,10))
  }

  /* ── Proveedor ──────────────────────────────────────────────────── */
  const guardarProv = async e => {
    e.preventDefault(); setSavProv(true); setErrProv('')
    try {
      if (modalProv === 'nuevo') await api.post('/compras/proveedores', formProv)
      else await api.put(`/compras/proveedores/${modalProv.id}`, formProv)
      // si el proveedor editado es el que está cargado en la OC activa, sincronizar la tira
      if (provInfoOC && modalProv !== 'nuevo' && provInfoOC.id === modalProv.id)
        setProvInfoOC(prev => ({ ...prev, ...formProv }))
      setModalProv(null); cargarProveedores()
      api.get('/compras/proveedores').then(r => setProvs(r.data))
    } catch(err) { setErrProv(err.response?.data?.error ?? 'Error al guardar') }
    finally { setSavProv(false) }
  }

  /* ── Fusión de proveedores ──────────────────────────────────────── */
  const toggleSelProv = id => setSelProvs(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const abrirFusion = () => {
    const seleccionados = provs.filter(p => selProvs.has(p.id))
    const datos = {}
    for (const c of CAMPOS_PROV) {
      const primero = seleccionados.find(p => p[c.k]?.toString().trim())
      datos[c.k] = primero ? primero[c.k] : ''
    }
    setModalFusion({ provs: seleccionados, masterId: seleccionados[0].id, datos })
  }

  const confirmarFusion = async () => {
    setSavFusion(true)
    try {
      const duplicados = modalFusion.provs.filter(p => p.id !== modalFusion.masterId).map(p => p.id)
      const r = await api.post('/compras/proveedores/fusionar', { master_id: modalFusion.masterId, duplicados, datos: modalFusion.datos })
      setModalFusion(null); setSelProvs(new Set()); cargarProveedores()
      api.get('/compras/proveedores').then(res => setProvs(res.data))
      alert(`Fusión completada. OC reasignadas: ${r.data.oc_reasignadas}`)
    } catch(err) { alert(err.response?.data?.error ?? 'Error al fusionar') }
    finally { setSavFusion(false) }
  }

  const totalPagsOC   = Math.ceil(totalOC / 50)
  const totalItemsOC  = formOC.items.reduce((s, it) => s + (parseFloat(it.cantidad)||0) * (parseFloat(it.precio_final)||0), 0)

  return (
    <>
      <h5 className="fw-bold mb-3">Compras</h5>

      <ul className="nav nav-tabs mb-3">
        <li className="nav-item">
          <button className={`nav-link ${tab==='oc'?'active':''}`} onClick={() => setTab('oc')}>
            <i className="bi bi-cart3 me-1"/>Órdenes de Compra
          </button>
        </li>
        <li className="nav-item">
          <button className={`nav-link ${tab==='proveedores'?'active':''}`} onClick={() => setTab('proveedores')}>
            <i className="bi bi-building me-1"/>Proveedores
          </button>
        </li>
        <li className="nav-item">
          <button className={`nav-link ${tab==='form49'?'active':''}`} onClick={() => setTab('form49')}>
            <i className="bi bi-box-arrow-in-down me-1"/>Form 49
          </button>
        </li>
      </ul>

      {/* ─── TAB: FORM 49 ───────────────────────────────────────────── */}
      {tab === 'form49' && <Form49 canWrite={canWrite} proveedores={provs} />}

      {/* ─── TAB: ÓRDENES DE COMPRA ─────────────────────────────────── */}
      {tab === 'oc' && <>
        <div className="d-flex flex-wrap gap-2 mb-3">
          {canWrite && (
            <button className="btn btn-sm btn-success" onClick={abrirNuevaOC}>
              <i className="bi bi-plus-lg me-1"/>Nueva OC
            </button>
          )}
        </div>

        <div className="d-flex flex-wrap gap-2 mb-2">
          <input className="form-control form-control-sm" style={{width:220}} placeholder="Buscar N° OC o proveedor…"
            value={filtOC.buscar} onChange={e => { setFiltOC(p=>({...p,buscar:e.target.value})); setPageOC(1) }}/>
          <select className="form-select form-select-sm" style={{width:150}}
            value={filtOC.estado} onChange={e => { setFiltOC(p=>({...p,estado:e.target.value})); setPageOC(1) }}>
            <option value="">Todos los estados</option>
            {ESTADOS.map(s => <option key={s.v} value={s.v}>{s.v}</option>)}
          </select>
          <input type="date" className="form-control form-control-sm" style={{width:135}}
            value={filtOC.desde} onChange={e => { setFiltOC(p=>({...p,desde:e.target.value})); setPageOC(1) }}/>
          <input type="date" className="form-control form-control-sm" style={{width:135}}
            value={filtOC.hasta} onChange={e => { setFiltOC(p=>({...p,hasta:e.target.value})); setPageOC(1) }}/>
          {(filtOC.buscar || filtOC.estado || filtOC.desde || filtOC.hasta) &&
            <button className="btn btn-sm btn-outline-secondary" onClick={() => { setFiltOC({estado:'',buscar:'',desde:'',hasta:''}); setPageOC(1) }}>Limpiar</button>}
        </div>

        <div className="card border-0 shadow-sm">
          {loadOC
            ? <div className="text-center py-5"><div className="spinner-border text-secondary"/></div>
            : <div className="table-responsive" style={{maxHeight:'calc(100vh - 320px)', overflowY:'auto'}}>
                <table className="table table-hover table-sm mb-0" style={{fontSize:'0.83rem'}}>
                  <thead className="table-dark sticky-top">
                    <tr>
                      <th>N° OC</th>
                      <th>FECHA</th>
                      <th>PROVEEDOR</th>
                      <th className="text-center">ESTADO</th>
                      <th className="text-center">MONEDA</th>
                      <th className="text-center">ÍTEMS</th>
                      <th className="text-end">TOTAL</th>
                      <th/>
                    </tr>
                  </thead>
                  <tbody>
                    {ocs.length === 0
                      ? <tr><td colSpan={8} className="text-center text-muted py-4">Sin resultados</td></tr>
                      : ocs.map(o => {
                          const est = ESTADOS.find(s=>s.v===o.estado)
                          return (
                            <tr key={o.id} className={selOC===o.id?'table-primary':''} style={{cursor:'pointer'}}
                              onClick={() => setSelOC(o.id===selOC?null:o.id)}>
                              <td className="fw-semibold">{o.numero}</td>
                              <td className="text-nowrap">{fmtF(o.fecha)}</td>
                              <td><div className="text-truncate" style={{maxWidth:220}} title={o.proveedor_nombre}>{o.proveedor_nombre}</div></td>
                              <td className="text-center"><span className={`badge bg-${est?.c??'secondary'}`}>{o.estado}</span></td>
                              <td className="text-center text-muted">{o.moneda}</td>
                              <td className="text-center">{o.n_items??0}</td>
                              <td className="text-end fw-semibold">{o.total_usd != null ? fmtN(o.total_usd) : '—'}</td>
                              <td className="text-end">
                                <button className="btn btn-xs btn-outline-primary py-0 px-2" style={{fontSize:'0.75rem'}}
                                  onClick={e=>{e.stopPropagation(); verOC(o.id)}}>Ver</button>
                              </td>
                            </tr>
                          )
                        })
                    }
                  </tbody>
                </table>
              </div>
          }
          <div className="border-top px-3 py-1 d-flex justify-content-between align-items-center" style={{fontSize:'0.78rem', background:'#f8f9fa'}}>
            <span className="text-muted">Total: <strong>{totalOC}</strong> órdenes</span>
            {totalPagsOC > 1 && (
              <div className="d-flex gap-1 align-items-center">
                <button className="btn btn-xs btn-outline-secondary py-0 px-2" disabled={pageOC===1} onClick={()=>setPageOC(p=>p-1)}>‹</button>
                <span className="text-muted small">{pageOC}/{totalPagsOC}</span>
                <button className="btn btn-xs btn-outline-secondary py-0 px-2" disabled={pageOC>=totalPagsOC} onClick={()=>setPageOC(p=>p+1)}>›</button>
              </div>
            )}
          </div>
        </div>
      </>}

      {/* ─── TAB: PROVEEDORES ───────────────────────────────────────── */}
      {tab === 'proveedores' && <>
        <div className="d-flex flex-wrap gap-2 mb-3 align-items-center">
          {canWrite && (
            <button className="btn btn-sm btn-success" onClick={() => { setFormProv(FORM_PROV); setErrProv(''); setModalProv('nuevo') }}>
              <i className="bi bi-plus-lg me-1"/>Nuevo Proveedor
            </button>
          )}
          <input className="form-control form-control-sm" style={{width:240}} placeholder="Buscar proveedor…"
            value={buscarProv} onChange={e => setBuscarProv(e.target.value)}/>
          {selProvs.size >= 2 && (
            <button className="btn btn-sm btn-warning ms-auto" onClick={abrirFusion}>
              <i className="bi bi-intersect me-1"/>Fusionar {selProvs.size} proveedores
            </button>
          )}
          {selProvs.size > 0 && (
            <button className="btn btn-sm btn-outline-secondary" onClick={() => setSelProvs(new Set())}>
              Limpiar selección
            </button>
          )}
        </div>

        {selProvs.size > 0 && selProvs.size < 2 && (
          <div className="alert alert-info py-2 small mb-2">
            <i className="bi bi-info-circle me-1"/>Seleccioná al menos 2 proveedores para fusionarlos.
          </div>
        )}

        <div className="card border-0 shadow-sm">
          {loadProv
            ? <div className="text-center py-5"><div className="spinner-border text-secondary"/></div>
            : <div className="table-responsive" style={{maxHeight:'calc(100vh - 300px)', overflowY:'auto'}}>
                <table className="table table-hover table-sm mb-0" style={{fontSize:'0.83rem'}}>
                  <thead className="table-dark sticky-top">
                    <tr>
                      <th style={{width:32}}/>
                      <th>NOMBRE</th><th>CUIT</th><th>CONTACTO</th><th>TELÉFONO</th>
                      <th>EMAIL</th><th>LOCALIDAD</th><th>COND. PAGO</th>
                      {canWrite && <th/>}
                    </tr>
                  </thead>
                  <tbody>
                    {provs.length === 0
                      ? <tr><td colSpan={canWrite?9:8} className="text-center text-muted py-4">Sin proveedores</td></tr>
                      : provs.map(p => (
                          <tr key={p.id} className={selProvs.has(p.id)?'table-warning':''}>
                            <td className="text-center">
                              <input type="checkbox" className="form-check-input mt-0"
                                checked={selProvs.has(p.id)} onChange={() => toggleSelProv(p.id)}/>
                            </td>
                            <td className="fw-semibold">{p.nombre}</td>
                            <td className="text-muted">{p.cuit||'—'}</td>
                            <td>{p.contacto||'—'}</td>
                            <td>{p.telefono||'—'}</td>
                            <td>{p.email||'—'}</td>
                            <td>{p.localidad||'—'}</td>
                            <td className="text-muted">{p.condicion_pago||'—'}</td>
                            {canWrite && (
                              <td>
                                <button className="btn btn-xs btn-outline-secondary py-0 px-2" style={{fontSize:'0.75rem'}}
                                  onClick={() => { setFormProv({...p}); setErrProv(''); setModalProv(p) }}>Editar</button>
                              </td>
                            )}
                          </tr>
                        ))
                    }
                  </tbody>
                </table>
              </div>
          }
        </div>
      </>}

      {/* ══ MODAL: DETALLE OC ═══════════════════════════════════════════ */}
      {(modalOC || loadDet) && (
        <div className="modal show d-block" style={{background:'rgba(0,0,0,.5)'}}>
          <div className="modal-dialog modal-xl modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h5 className="modal-title">
                  {loadDet ? 'Cargando…' : `OC #${modalOC?.numero} — ${modalOC?.proveedor_nombre}`}
                </h5>
                <button className="btn-close" onClick={() => { setModalOC(null); setLoadDet(false) }}/>
              </div>
              {loadDet && <div className="modal-body text-center py-5"><div className="spinner-border text-secondary"/></div>}
              {!loadDet && modalOC && (
                <>
                  <div className="modal-body">
                    <div className="row g-2 mb-3 small">
                      <div className="col-auto"><strong>Fecha:</strong> {fmtF(modalOC.fecha)}</div>
                      <div className="col-auto"><strong>Moneda:</strong> {modalOC.moneda}{modalOC.tasa_cambio > 0 ? ` / TC: ${fmtN(modalOC.tasa_cambio)}` : ''}</div>
                      <div className="col-auto"><strong>Estado:</strong> <span className={`badge bg-${ESTADOS.find(s=>s.v===modalOC.estado)?.c??'secondary'}`}>{modalOC.estado}</span></div>
                      <div className="col-auto"><strong>Cond. Pago:</strong> {modalOC.condicion_pago}</div>
                      <div className="col-auto"><strong>Entrega:</strong> {modalOC.lugar_entrega}</div>
                      {modalOC.autorizado_por && <div className="col-auto"><strong>Autoriza:</strong> {modalOC.autorizado_por}</div>}
                      {modalOC.elaborado_por  && <div className="col-auto"><strong>Elabora:</strong> {modalOC.elaborado_por}</div>}
                      {modalOC.presupuesto_n      && <div className="col-auto"><strong>Ppto N°:</strong> {modalOC.presupuesto_n}</div>}
                      {modalOC.fecha_entrega_est  && <div className="col-auto"><strong>Entrega Est.:</strong> {fmtF(modalOC.fecha_entrega_est)}</div>}
                      {modalOC.numero_remito      && <div className="col-auto"><strong>Remito:</strong> {modalOC.numero_remito}</div>}
                      {modalOC.fecha_recepcion    && <div className="col-auto"><strong>Recibido:</strong> {fmtF(modalOC.fecha_recepcion)}</div>}
                      {modalOC.observaciones      && <div className="col-12 text-muted"><i>{modalOC.observaciones}</i></div>}
                    </div>

                    {/* Seguimiento Form 17 */}
                    {(modalOC.estado_doc || modalOC.nro_factura || modalOC.importe_facturado > 0 || modalOC.fecha_vencimiento) && (
                      <div className="card border-primary mb-3">
                        <div className="card-header py-1 bg-primary text-white small fw-bold">
                          <i className="bi bi-file-earmark-text me-1"/>Seguimiento (Form 17)
                        </div>
                        <div className="card-body py-2 px-3">
                          <div className="row g-2 small">
                            {modalOC.estado_doc && (
                              <div className="col-auto">
                                <strong>Estado Doc.:</strong>{' '}
                                <span className={`badge ${modalOC.estado_doc==='CONFORME'?'bg-success':modalOC.estado_doc==='NO CONFORME'?'bg-danger':modalOC.estado_doc==='OBSERVADA'?'bg-warning text-dark':'bg-secondary'}`}>
                                  {modalOC.estado_doc}
                                </span>
                              </div>
                            )}
                            {modalOC.nro_factura && <div className="col-auto"><strong>N° Factura:</strong> {modalOC.nro_factura}</div>}
                            {modalOC.importe_facturado > 0 && <div className="col-auto"><strong>Importe Facturado:</strong> {fmtN(modalOC.importe_facturado)}</div>}
                            {modalOC.fecha_vencimiento && <div className="col-auto"><strong>Vencimiento:</strong> {fmtF(modalOC.fecha_vencimiento)}</div>}
                            {modalOC.pago_confirmado != null && (
                              <div className="col-auto">
                                <strong>Pago:</strong>{' '}
                                <span className={`badge ${modalOC.pago_confirmado ? 'bg-success' : 'bg-secondary'}`}>
                                  {modalOC.pago_confirmado ? 'CONFIRMADO' : 'PENDIENTE'}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    <table className="table table-sm table-bordered mb-0" style={{fontSize:'0.8rem'}}>
                      <thead className="table-light">
                        <tr>
                          <th>#</th><th>DESCRIPCIÓN</th><th className="text-center">UNID.</th>
                          <th className="text-end">CANT.</th><th className="text-end">PRECIO U.</th>
                          <th className="text-center">BON.</th><th className="text-end">PRECIO F.</th>
                          <th className="text-end">SUBTOTAL</th><th className="text-center">PLAZO</th>
                          <th className="text-end">RECIBIDO</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(modalOC.items||[]).map(it => {
                          const sub  = (it.cantidad||0) * (it.precio_final||0)
                          const pend = (it.cantidad||0) - (it.cant_recibida||0)
                          const bons = [it.bonif1,it.bonif2,it.bonif3,it.bonif4].filter(b=>b>0).map(b=>`${b}%`).join('+')
                          return (
                            <tr key={it.id}>
                              <td className="text-muted">{it.item_num}</td>
                              <td>{it.descripcion}</td>
                              <td className="text-center">{it.unidad}</td>
                              <td className="text-end">{fmtN(it.cantidad)}</td>
                              <td className="text-end">{fmtN(it.precio_unitario)}</td>
                              <td className="text-center text-muted">{bons||'—'}</td>
                              <td className="text-end fw-semibold">{fmtN(it.precio_final)}</td>
                              <td className="text-end">{fmtN(sub)}</td>
                              <td className="text-center text-muted">{it.plazo}</td>
                              <td className="text-end">
                                {it.producto_id
                                  ? <span className={pend > 0 ? 'text-warning' : 'text-success'}>{fmtN(it.cant_recibida||0)}/{fmtN(it.cantidad)}</span>
                                  : <span className="text-muted">—</span>
                                }
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="fw-bold">
                          <td colSpan={7} className="text-end">TOTAL {modalOC.moneda}</td>
                          <td className="text-end">{fmtN((modalOC.items||[]).reduce((s,it)=>s+(it.cantidad||0)*(it.precio_final||0),0))}</td>
                          <td colSpan={2}/>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <div className="modal-footer py-2 justify-content-between">
                    <div className="d-flex gap-2">
                      {canWrite && modalOC.estado !== 'Cancelada' && modalOC.estado !== 'Recibida' && (
                        <button className="btn btn-sm btn-success" onClick={() => { setModalOC(null); abrirRecibir(modalOC) }}>
                          <i className="bi bi-box-arrow-in-down me-1"/>Recibir mercadería
                        </button>
                      )}
                      {canWrite && <>
                        <button className="btn btn-sm btn-outline-primary" onClick={() => { setModalOC(null); abrirEditarOC(modalOC) }}>
                          <i className="bi bi-pencil me-1"/>Editar
                        </button>
                        <button className="btn btn-sm btn-outline-danger" onClick={() => eliminarOC(modalOC.id)}>
                          <i className="bi bi-trash me-1"/>Eliminar
                        </button>
                      </>}
                    </div>
                    <div className="d-flex gap-2">
                      <button className="btn btn-sm btn-outline-success"
                        onClick={async () => {
                          const resp = await fetch(`/api/v1/compras/oc/${modalOC.id}/exportar`, { headers: { Authorization: `Bearer ${localStorage.getItem('erp_token')}` } })
                          const blob = await resp.blob()
                          const url  = URL.createObjectURL(blob)
                          const a    = document.createElement('a')
                          a.href = url; a.download = `OC_${modalOC.numero}.xlsx`; a.click()
                          URL.revokeObjectURL(url)
                        }}>
                        <i className="bi bi-file-excel me-1"/>Excel
                      </button>
                      <button className="btn btn-sm btn-outline-secondary"
                        onClick={() => window.open(`/imprimir/oc/${modalOC.id}`, '_blank')}>
                        <i className="bi bi-printer me-1"/>Imprimir
                      </button>
                      <button className="btn btn-sm btn-secondary" onClick={() => setModalOC(null)}>Cerrar</button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL: CREAR / EDITAR OC ════════════════════════════════════ */}
      {modalForm !== null && (
        <div className="modal show d-block" style={{background:'rgba(0,0,0,.5)', zIndex:1060}}>
          <div className="modal-dialog modal-xl modal-dialog-scrollable">
            <form className="modal-content" onSubmit={guardarOC}>
              <div className="modal-header py-2">
                <h5 className="modal-title">{modalForm==='nuevo' ? 'Nueva Orden de Compra' : `Editar OC #${modalForm.numero}`}</h5>
                <button type="button" className="btn-close" onClick={()=>setModalForm(null)}/>
              </div>
              <div className="modal-body">
                {errOC && <div className="alert alert-danger py-2 small">{errOC}</div>}

                {/* ── Cabecera compacta en 2 filas ───────────────────── */}
                <div className="border rounded px-3 pt-2 pb-2 mb-2" style={{background:'#f8f9fa'}}>

                  {/* Fila 1: Proveedor + datos principales */}
                  <div className="row g-2 mb-2">
                    <div className="col-md-4 position-relative">
                      <label className="form-label small fw-medium mb-1">Proveedor *</label>
                      <input className="form-control form-control-sm" value={formOC.proveedor_nombre} required
                        placeholder="Buscar o escribir proveedor…" onChange={e => buscarProvOC(e.target.value)}/>
                      {sugsP.length > 0 && (
                        <div className="border rounded shadow-sm position-absolute bg-white" style={{zIndex:9999,top:'100%',left:0,width:'100%',maxHeight:360,overflowY:'auto'}}>
                          {sugsP.map(p => (
                            <div key={p.id} className="px-3 py-2 border-bottom" style={{cursor:'pointer',fontSize:'0.83rem'}}
                              onMouseEnter={e=>e.currentTarget.classList.add('bg-light')}
                              onMouseLeave={e=>e.currentTarget.classList.remove('bg-light')}
                              onClick={() => { setFormOC(prev=>({...prev,proveedor_id:p.id,proveedor_nombre:p.nombre,proveedor_cuit:p.cuit||''})); setSugsP([]); setProvInfoOC(p) }}>
                              <strong>{p.nombre}</strong>{p.cuit && <span className="text-muted ms-2 small">{p.cuit}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="col-md-2">
                      <label className="form-label small fw-medium mb-1">CUIT</label>
                      <input className="form-control form-control-sm" value={formOC.proveedor_cuit}
                        onChange={e=>setFormOC(p=>({...p,proveedor_cuit:e.target.value}))}/>
                    </div>
                    <div className="col-md-2">
                      <label className="form-label small fw-medium mb-1">Fecha *</label>
                      <input type="date" className="form-control form-control-sm" value={formOC.fecha} required
                        onChange={e=>setFormOC(p=>({...p,fecha:e.target.value}))}/>
                    </div>
                    <div className="col-md-2">
                      <label className="form-label small fw-medium mb-1">Moneda</label>
                      <select className="form-select form-select-sm" value={formOC.moneda}
                        onChange={e=>setFormOC(p=>({...p,moneda:e.target.value}))}>
                        <option>DÓLAR</option><option>PESOS</option><option>EURO</option>
                      </select>
                    </div>
                    <div className="col-md-1">
                      <label className="form-label small fw-medium mb-1">TC</label>
                      <input type="number" className="form-control form-control-sm" value={formOC.tasa_cambio}
                        min="0" step="any" onChange={e=>setFormOC(p=>({...p,tasa_cambio:e.target.value}))}/>
                    </div>
                    <div className="col-md-1">
                      <label className="form-label small fw-medium mb-1">Cond. Pago</label>
                      <input className="form-control form-control-sm" value={formOC.condicion_pago}
                        onChange={e=>setFormOC(p=>({...p,condicion_pago:e.target.value}))}/>
                    </div>
                  </div>

                  {/* Fila 2: campos secundarios */}
                  <div className="row g-2">
                    <div className="col-md-2">
                      <label className="form-label small fw-medium mb-1">Lugar Entrega</label>
                      <input className="form-control form-control-sm" value={formOC.lugar_entrega}
                        onChange={e=>setFormOC(p=>({...p,lugar_entrega:e.target.value}))}/>
                    </div>
                    <div className="col-md-2">
                      <label className="form-label small fw-medium mb-1">Presupuesto N°</label>
                      <input className="form-control form-control-sm" value={formOC.presupuesto_n}
                        onChange={e=>setFormOC(p=>({...p,presupuesto_n:e.target.value}))}/>
                    </div>
                    <div className="col-md-2">
                      <label className="form-label small fw-medium mb-1">Fecha Entrega Est.</label>
                      <input type="date" className="form-control form-control-sm" value={formOC.fecha_entrega_est}
                        onChange={e=>setFormOC(p=>({...p,fecha_entrega_est:e.target.value}))}/>
                    </div>
                    <div className="col-md-2">
                      <label className="form-label small fw-medium mb-1">Estado Doc.</label>
                      <select className="form-select form-select-sm" value={formOC.estado_doc}
                        onChange={e=>setFormOC(p=>({...p,estado_doc:e.target.value}))}>
                        {ESTADOS_DOC.map(s => <option key={s} value={s}>{s||'— Sin estado —'}</option>)}
                      </select>
                    </div>
                    <div className="col-md-2">
                      <label className="form-label small fw-medium mb-1">Elaborado por</label>
                      <EmpleadoSelect size="sm" value={formOC.elaborado_por}
                        onChange={v=>setFormOC(p=>({...p,elaborado_por:v}))}/>
                    </div>
                    <div className="col-md-1">
                      <label className="form-label small fw-medium mb-1">Autorizado</label>
                      <EmpleadoSelect size="sm" value={formOC.autorizado_por}
                        onChange={v=>setFormOC(p=>({...p,autorizado_por:v}))}/>
                    </div>
                    <div className="col-md-1">
                      <label className="form-label small fw-medium mb-1">Observaciones</label>
                      <input className="form-control form-control-sm" value={formOC.observaciones}
                        onChange={e=>setFormOC(p=>({...p,observaciones:e.target.value}))}/>
                    </div>
                  </div>

                  {/* Info del proveedor — tira de texto cuando hay uno seleccionado */}
                  {provInfoOC && (
                    <div className="mt-2 pt-1 border-top d-flex align-items-center gap-3 flex-wrap" style={{fontSize:'0.73rem'}}>
                      <span style={{color: provInfoOC.localidad ? '#555' : '#c0392b'}}>
                        <i className="bi bi-geo-alt me-1 text-muted"/>
                        {provInfoOC.localidad
                          ? provInfoOC.localidad + (provInfoOC.cp ? ` (CP ${provInfoOC.cp})` : '')
                          : 'Sin localidad'}
                      </span>
                      <span style={{color: provInfoOC.direccion ? '#555' : '#c0392b'}}>
                        <i className="bi bi-house me-1 text-muted"/>
                        {provInfoOC.direccion || 'Sin dirección'}
                      </span>
                      <span style={{color: provInfoOC.telefono ? '#555' : '#c0392b'}}>
                        <i className="bi bi-telephone me-1 text-muted"/>
                        {provInfoOC.telefono || 'Sin teléfono'}
                      </span>
                      <span style={{color: provInfoOC.email ? '#555' : '#c0392b'}}>
                        <i className="bi bi-envelope me-1 text-muted"/>
                        {provInfoOC.email || 'Sin email'}
                      </span>
                      <span style={{color: provInfoOC.vendedor ? '#555' : '#c0392b'}}>
                        <i className="bi bi-person me-1 text-muted"/>
                        {provInfoOC.vendedor ? `Vendedor: ${provInfoOC.vendedor}` : 'Sin vendedor'}
                      </span>
                      <button type="button" className="btn btn-xs btn-outline-secondary py-0 px-2 ms-auto"
                        style={{fontSize:'0.7rem'}}
                        onClick={() => {
                          setFormProv(Object.fromEntries(CAMPOS_PROV.map(c => [c.k, provInfoOC[c.k] ?? ''])))
                          setErrProv('')
                          setModalProv(provInfoOC)
                        }}>
                        <i className="bi bi-pencil me-1"/>Editar proveedor
                      </button>
                    </div>
                  )}
                </div>

                {/* Ítems */}
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <strong className="small">Ítems</strong>
                  <button type="button" className="btn btn-xs btn-outline-success py-0 px-2" onClick={agregarItem}>
                    <i className="bi bi-plus"/> Agregar ítem
                  </button>
                </div>
                <div className="table-responsive">
                  <table className="table table-sm table-bordered mb-1" style={{fontSize:'0.78rem'}}>
                    <thead className="table-light">
                      <tr>
                        <th style={{width:28}}>#</th>
                        <th>DESCRIPCIÓN</th>
                        <th style={{width:68}}>UNID.</th>
                        <th style={{width:76}}>CANT.</th>
                        <th style={{width:96}}>PRECIO U.</th>
                        <th style={{width:56}}>B1%</th>
                        <th style={{width:56}}>B2%</th>
                        <th style={{width:56}}>B3%</th>
                        <th style={{width:56}}>B4%</th>
                        <th style={{width:96}}>PRECIO F.</th>
                        <th style={{width:96}}>PLAZO</th>
                        <th style={{width:28}}/>
                      </tr>
                    </thead>
                    <tbody>
                      {formOC.items.map((it, idx) => (
                        <tr key={idx}>
                          <td className="text-muted text-center align-middle">{idx+1}</td>
                          <td>
                            <input className="form-control form-control-sm border-0 p-0 px-1" value={it.descripcion}
                              ref={el => { itemDescRefs.current[idx] = el }}
                              onChange={e => buscarProductoItem(idx, e.target.value)}
                              onBlur={() => setTimeout(() => setSugsItem({ idx: null, list: [], pos: null }), 150)}/>
                            {sugsItem.idx === idx && sugsItem.pos && (
                              <div className="border rounded shadow bg-white"
                                style={{position:'fixed', zIndex:9999, top: sugsItem.pos.top, left: sugsItem.pos.left, width: sugsItem.pos.width, maxWidth:620}}
                                onMouseDown={e => e.preventDefault()}>
                                {/* lista scrollable — 6 filas visibles (~38px c/u), scroll para el resto */}
                                <div style={{maxHeight:228, overflowY:'auto'}}>
                                  {sugsItem.list.length === 0
                                    ? <div className="px-3 py-2 text-muted small fst-italic">Sin coincidencias</div>
                                    : sugsItem.list.map(p => (
                                        <div key={p.id}
                                          className="d-flex align-items-center gap-2 px-2 py-2 border-bottom"
                                          style={{cursor:'pointer'}}
                                          onMouseEnter={e=>e.currentTarget.classList.add('bg-light')}
                                          onMouseLeave={e=>e.currentTarget.classList.remove('bg-light')}
                                          onClick={() => selProductoItem(idx, p)}>
                                          <span className="badge bg-dark text-white flex-shrink-0"
                                            style={{fontFamily:'monospace', fontSize:'0.72rem', minWidth:72, letterSpacing:0.5}}>
                                            {p.codigo}
                                          </span>
                                          <span className="flex-grow-1 text-truncate" style={{fontSize:'0.82rem'}}>
                                            {p.descripcion}
                                          </span>
                                          <span className="d-flex flex-column align-items-end flex-shrink-0 gap-0"
                                            style={{fontSize:'0.7rem', lineHeight:'1.2'}}>
                                            <span className="text-muted">{p.unidad || 'UND.'}</span>
                                            <span className={p.stock_actual > 0 ? 'text-success fw-semibold' : 'text-danger'}>
                                              stock: {fmtN(p.stock_actual)}
                                            </span>
                                          </span>
                                        </div>
                                      ))
                                  }
                                </div>
                                {/* botón siempre visible, fuera del scroll */}
                                {codConfig && (
                                  <div className="px-2 py-2 border-top d-flex align-items-center gap-2"
                                    style={{background:'#eef2ff', cursor:'pointer'}}
                                    onMouseDown={e => { e.preventDefault(); abrirNuevoMat(idx) }}>
                                    <i className="bi bi-plus-circle-fill text-primary"/>
                                    <span className="small text-primary fw-semibold">Crear nuevo material en stock</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                          <td><input className="form-control form-control-sm border-0 p-0 px-1" value={it.unidad} onChange={e=>setItem(idx,'unidad',e.target.value)}/></td>
                          <td><input type="number" className="form-control form-control-sm border-0 p-0 px-1 text-end" value={it.cantidad} min="0" step="any" onChange={e=>setItem(idx,'cantidad',e.target.value)}/></td>
                          <td><input type="number" className="form-control form-control-sm border-0 p-0 px-1 text-end" value={it.precio_unitario} min="0" step="any" onChange={e=>setItem(idx,'precio_unitario',e.target.value)}/></td>
                          <td><input type="number" className="form-control form-control-sm border-0 p-0 px-1 text-end" value={it.bonif1} min="0" max="100" step="any" onChange={e=>setItem(idx,'bonif1',e.target.value)}/></td>
                          <td><input type="number" className="form-control form-control-sm border-0 p-0 px-1 text-end" value={it.bonif2} min="0" max="100" step="any" onChange={e=>setItem(idx,'bonif2',e.target.value)}/></td>
                          <td><input type="number" className="form-control form-control-sm border-0 p-0 px-1 text-end" value={it.bonif3} min="0" max="100" step="any" onChange={e=>setItem(idx,'bonif3',e.target.value)}/></td>
                          <td><input type="number" className="form-control form-control-sm border-0 p-0 px-1 text-end" value={it.bonif4} min="0" max="100" step="any" onChange={e=>setItem(idx,'bonif4',e.target.value)}/></td>
                          <td className="text-end fw-semibold align-middle" style={{background:'#f8f9fa'}}>{fmtN(it.precio_final)}</td>
                          <td><input className="form-control form-control-sm border-0 p-0 px-1" value={it.plazo} onChange={e=>setItem(idx,'plazo',e.target.value)}/></td>
                          <td className="text-center align-middle">
                            <button type="button" className="btn btn-xs text-danger py-0 px-1" disabled={formOC.items.length===1} onClick={()=>quitarItem(idx)}>
                              <i className="bi bi-x"/>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={9} className="text-end fw-bold small">TOTAL {formOC.moneda}</td>
                        <td className="text-end fw-bold">{fmtN(totalItemsOC)}</td>
                        <td colSpan={2}/>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
              <div className="modal-footer py-2">
                <button type="button" className="btn btn-secondary btn-sm" onClick={()=>setModalForm(null)}>Cancelar</button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={savOC}>
                  {savOC && <span className="spinner-border spinner-border-sm me-2"/>}Guardar OC
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══ MODAL: RECIBIR MERCADERÍA ════════════════════════════════════ */}
      {modalRec && (
        <div className="modal show d-block" style={{background:'rgba(0,0,0,.5)', zIndex:1070}}>
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h5 className="modal-title">Recibir OC #{modalRec.numero} — {modalRec.proveedor_nombre}</h5>
                <button className="btn-close" onClick={()=>setModalRec(null)}/>
              </div>
              <div className="modal-body">
                <div className="row g-2 mb-3">
                  <div className="col-auto">
                    <label className="form-label small fw-medium">Fecha de recepción</label>
                    <input type="date" className="form-control form-control-sm" style={{width:160}} value={fechaRec} onChange={e=>setFechaRec(e.target.value)}/>
                  </div>
                  <div className="col">
                    <label className="form-label small fw-medium">N° Remito</label>
                    <input className="form-control form-control-sm" placeholder="Ej: 0001-00012345" value={nroRemito} onChange={e=>setNroRemito(e.target.value)}/>
                  </div>
                </div>
                <table className="table table-sm table-bordered" style={{fontSize:'0.83rem'}}>
                  <thead className="table-light">
                    <tr>
                      <th>DESCRIPCIÓN</th>
                      <th className="text-end">PEDIDO</th>
                      <th className="text-end">YA RECIBIDO</th>
                      <th className="text-end">PENDIENTE</th>
                      <th className="text-end" style={{width:120}}>A RECIBIR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(modalRec.items||[]).filter(it=>it.producto_id).length === 0
                      ? <tr><td colSpan={5} className="text-center text-muted py-3">Sin ítems con producto asociado</td></tr>
                      : (modalRec.items||[]).filter(it=>it.producto_id).map(it => {
                          const pend = it.cantidad - (it.cant_recibida||0)
                          return (
                            <tr key={it.id}>
                              <td>{it.descripcion}</td>
                              <td className="text-end">{fmtN(it.cantidad)}</td>
                              <td className="text-end text-success">{fmtN(it.cant_recibida||0)}</td>
                              <td className={`text-end ${pend>0?'text-warning':''}`}>{fmtN(pend)}</td>
                              <td>
                                <input type="number" className="form-control form-control-sm text-end" value={recCants[it.id]??0}
                                  min="0" max={pend} step="any" disabled={pend<=0}
                                  style={{marginLeft:'auto'}}
                                  onChange={e=>setRecCants(p=>({...p,[it.id]:parseFloat(e.target.value)||0}))}/>
                              </td>
                            </tr>
                          )
                        })
                    }
                  </tbody>
                </table>
              </div>
              <div className="modal-footer py-2">
                <button className="btn btn-secondary btn-sm" onClick={()=>setModalRec(null)}>Cancelar</button>
                <button className="btn btn-success btn-sm" onClick={confirmarRecibir} disabled={savRec}>
                  {savRec && <span className="spinner-border spinner-border-sm me-2"/>}
                  <i className="bi bi-box-arrow-in-down me-1"/>Confirmar recepción
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL: PROVEEDOR ════════════════════════════════════════════ */}
      {modalProv !== null && (
        <div className="modal show d-block" style={{background:'rgba(0,0,0,.4)', zIndex:1080}}>
          <div className="modal-dialog modal-lg">
            <form className="modal-content" onSubmit={guardarProv}>
              <div className="modal-header py-2">
                <h5 className="modal-title">{modalProv==='nuevo' ? 'Nuevo Proveedor' : 'Editar Proveedor'}</h5>
                <button type="button" className="btn-close" onClick={()=>setModalProv(null)}/>
              </div>
              <div className="modal-body">
                {errProv && <div className="alert alert-danger py-2 small">{errProv}</div>}
                <div className="row g-3">
                  <div className="col-md-6">
                    <label className="form-label small fw-medium">Nombre / Razón Social *</label>
                    <input className="form-control" value={formProv.nombre} required onChange={e=>setFormProv(p=>({...p,nombre:e.target.value}))}/>
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-medium">CUIT</label>
                    <input className="form-control" value={formProv.cuit} onChange={e=>setFormProv(p=>({...p,cuit:e.target.value}))}/>
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-medium">Teléfono</label>
                    <input className="form-control" value={formProv.telefono} onChange={e=>setFormProv(p=>({...p,telefono:e.target.value}))}/>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label small fw-medium">Contacto</label>
                    <input className="form-control" value={formProv.contacto} onChange={e=>setFormProv(p=>({...p,contacto:e.target.value}))}/>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label small fw-medium">Email</label>
                    <input type="email" className="form-control" value={formProv.email} onChange={e=>setFormProv(p=>({...p,email:e.target.value}))}/>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label small fw-medium">Vendedor</label>
                    <input className="form-control" value={formProv.vendedor} onChange={e=>setFormProv(p=>({...p,vendedor:e.target.value}))}/>
                  </div>
                  <div className="col-md-5">
                    <label className="form-label small fw-medium">Dirección</label>
                    <input className="form-control" value={formProv.direccion} onChange={e=>setFormProv(p=>({...p,direccion:e.target.value}))}/>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label small fw-medium">Localidad</label>
                    <input className="form-control" value={formProv.localidad} onChange={e=>setFormProv(p=>({...p,localidad:e.target.value}))}/>
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-medium">C.P.</label>
                    <input className="form-control" value={formProv.cp} onChange={e=>setFormProv(p=>({...p,cp:e.target.value}))}/>
                  </div>
                  <div className="col-md-5">
                    <label className="form-label small fw-medium">Condición de Pago</label>
                    <input className="form-control" value={formProv.condicion_pago} onChange={e=>setFormProv(p=>({...p,condicion_pago:e.target.value}))}/>
                  </div>
                </div>
              </div>
              <div className="modal-footer py-2">
                <button type="button" className="btn btn-secondary" onClick={()=>setModalProv(null)}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={savProv}>
                  {savProv && <span className="spinner-border spinner-border-sm me-2"/>}Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══ MODAL: NUEVO MATERIAL ═══════════════════════════════════════ */}
      {modalNuevoMat && codConfig && (
        <div className="modal show d-block" style={{background:'rgba(0,0,0,.6)', zIndex:1100}}>
          <div className="modal-dialog modal-xl modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header py-2 bg-dark text-white">
                <h5 className="modal-title small fw-bold">
                  <i className="bi bi-plus-circle me-2"/>
                  Nuevo material en stock
                  {pasoNuevoMat === 'datos' && (
                    <span className="badge bg-success ms-2" style={{fontFamily:'monospace', fontSize:'0.78rem'}}>{codNuevoMat}</span>
                  )}
                </h5>
                <button className="btn-close btn-close-white" onClick={() => setModalNuevoMat(null)}/>
              </div>

              {/* Indicador de pasos */}
              <div className="px-3 pt-2 pb-0 d-flex gap-3 border-bottom" style={{fontSize:'0.8rem'}}>
                <span className={`pb-2 border-bottom border-2 ${pasoNuevoMat==='codigo' ? 'border-primary text-primary fw-semibold' : 'border-transparent text-muted'}`}
                  style={{borderColor: pasoNuevoMat==='codigo' ? undefined : 'transparent!important'}}>
                  1. Generar código
                </span>
                <span className={`pb-2 border-bottom border-2 ${pasoNuevoMat==='datos' ? 'border-primary text-primary fw-semibold' : 'text-muted'}`}>
                  2. Completar datos
                </span>
              </div>

              <div className="modal-body">
                {pasoNuevoMat === 'codigo' && (
                  <Asistente config={codConfig} onUsar={usarCodigoNuevoMat} />
                )}

                {pasoNuevoMat === 'datos' && (
                  <div>
                    <div className="alert alert-success py-2 d-flex align-items-center gap-3 mb-3">
                      <span className="fw-semibold small">Código generado:</span>
                      <span className="badge bg-dark fs-6" style={{fontFamily:'monospace', letterSpacing:2}}>{codNuevoMat}</span>
                      <button className="btn btn-sm btn-outline-secondary ms-auto" onClick={() => setPasoNuevoMat('codigo')}>
                        <i className="bi bi-arrow-left me-1"/>Volver a generar
                      </button>
                    </div>
                    <div className="row g-3">
                      <div className="col-md-12">
                        <label className="form-label small fw-medium">Descripción *</label>
                        <input className="form-control" required value={formNuevoMat.descripcion}
                          placeholder="Descripción completa del material"
                          onChange={e => setFormNuevoMat(p => ({...p, descripcion: e.target.value}))}/>
                      </div>
                      <div className="col-md-3">
                        <label className="form-label small fw-medium">Unidad</label>
                        <input className="form-control" value={formNuevoMat.unidad}
                          onChange={e => setFormNuevoMat(p => ({...p, unidad: e.target.value}))}/>
                      </div>
                      <div className="col-md-3">
                        <label className="form-label small fw-medium">Categoría</label>
                        <input className="form-control" value={formNuevoMat.categoria}
                          onChange={e => setFormNuevoMat(p => ({...p, categoria: e.target.value}))}/>
                      </div>
                      <div className="col-md-2">
                        <label className="form-label small fw-medium">Precio costo</label>
                        <input type="number" className="form-control" min="0" step="any" value={formNuevoMat.precio_costo}
                          onChange={e => setFormNuevoMat(p => ({...p, precio_costo: parseFloat(e.target.value)||0}))}/>
                      </div>
                      <div className="col-md-2">
                        <label className="form-label small fw-medium">Stock mínimo</label>
                        <input type="number" className="form-control" min="0" step="any" value={formNuevoMat.stock_minimo}
                          onChange={e => setFormNuevoMat(p => ({...p, stock_minimo: parseFloat(e.target.value)||0}))}/>
                      </div>
                      <div className="col-md-2">
                        <label className="form-label small fw-medium">Ubicación</label>
                        <input className="form-control" value={formNuevoMat.ubicacion}
                          onChange={e => setFormNuevoMat(p => ({...p, ubicacion: e.target.value}))}/>
                      </div>
                    </div>
                    {errNuevoMat && <div className="alert alert-danger py-2 mt-3 small">{errNuevoMat}</div>}
                  </div>
                )}
              </div>

              {pasoNuevoMat === 'datos' && (
                <div className="modal-footer py-2">
                  <button className="btn btn-secondary btn-sm" onClick={() => setModalNuevoMat(null)}>Cancelar</button>
                  <button className="btn btn-success btn-sm" disabled={savNuevoMat || !formNuevoMat.descripcion.trim()}
                    onClick={guardarNuevoMat}>
                    {savNuevoMat ? <span className="spinner-border spinner-border-sm me-1"/> : <i className="bi bi-check-circle me-1"/>}
                    Guardar material y agregar a OC
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL: FUSIÓN DE PROVEEDORES ════════════════════════════════ */}
      {modalFusion && (
        <div className="modal show d-block" style={{background:'rgba(0,0,0,.5)', zIndex:1090}}>
          <div className="modal-dialog modal-xl modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h5 className="modal-title">
                  <i className="bi bi-intersect me-2"/>Fusionar {modalFusion.provs.length} proveedores
                </h5>
                <button className="btn-close" onClick={() => setModalFusion(null)}/>
              </div>
              <div className="modal-body">

                {/* Selector de master */}
                <div className="alert alert-warning py-2 small mb-3">
                  <strong>ID que se conserva (master):</strong> el resto se desactivará y sus OC quedarán asignadas al master.
                  <div className="d-flex gap-3 mt-1 flex-wrap">
                    {modalFusion.provs.map(p => (
                      <label key={p.id} className="d-flex align-items-center gap-1" style={{cursor:'pointer'}}>
                        <input type="radio" name="master" checked={modalFusion.masterId===p.id}
                          onChange={() => setModalFusion(prev => ({...prev, masterId: p.id}))}/>
                        <strong>{p.nombre}</strong> <span className="text-muted">(ID {p.id})</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Tabla de campos */}
                <p className="small text-muted mb-2">
                  Para los campos con valores distintos, seleccioná cuál conservar. Los campos iguales se muestran sin opción.
                </p>
                <table className="table table-sm table-bordered" style={{fontSize:'0.83rem'}}>
                  <thead className="table-light">
                    <tr>
                      <th style={{width:130}}>CAMPO</th>
                      {modalFusion.provs.map(p => (
                        <th key={p.id} className={modalFusion.masterId===p.id?'table-warning':''}>{p.nombre}</th>
                      ))}
                      <th style={{width:180}} className="table-success">VALOR A CONSERVAR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {CAMPOS_PROV.map(({ k, l }) => {
                      const valores = modalFusion.provs.map(p => (p[k]||'').trim())
                      const todosIguales = valores.every(v => v === valores[0])
                      return (
                        <tr key={k}>
                          <td className="fw-medium text-muted">{l}</td>
                          {modalFusion.provs.map((p, i) => (
                            <td key={p.id} className={modalFusion.masterId===p.id?'table-warning':''}>
                              {todosIguales
                                ? <span className="text-muted">{valores[i]||<em>vacío</em>}</span>
                                : (
                                  <label className="d-flex align-items-center gap-2 mb-0" style={{cursor:'pointer'}}>
                                    <input type="radio" name={`campo_${k}`}
                                      checked={modalFusion.datos[k] === (p[k]||'')}
                                      onChange={() => setModalFusion(prev => ({ ...prev, datos: { ...prev.datos, [k]: p[k]||'' } }))}/>
                                    <span className={!valores[i]?'text-muted fst-italic':''}>{valores[i]||'vacío'}</span>
                                  </label>
                                )
                              }
                            </td>
                          ))}
                          <td className="table-success fw-semibold">
                            {modalFusion.datos[k] || <span className="text-muted fst-italic">vacío</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>

                <div className="alert alert-danger py-2 small mt-2 mb-0">
                  <i className="bi bi-exclamation-triangle me-1"/>
                  Esta acción es irreversible. Los proveedores no seleccionados como master quedarán desactivados
                  y todas sus OC se reasignarán al master.
                </div>
              </div>
              <div className="modal-footer py-2 justify-content-between">
                <span className="text-muted small">
                  Master: <strong>{modalFusion.provs.find(p=>p.id===modalFusion.masterId)?.nombre}</strong>
                  {' · '}Desactivar: {modalFusion.provs.filter(p=>p.id!==modalFusion.masterId).map(p=>p.nombre).join(', ')}
                </span>
                <div className="d-flex gap-2">
                  <button className="btn btn-secondary btn-sm" onClick={() => setModalFusion(null)}>Cancelar</button>
                  <button className="btn btn-danger btn-sm" onClick={confirmarFusion} disabled={savFusion}>
                    {savFusion && <span className="spinner-border spinner-border-sm me-2"/>}
                    <i className="bi bi-intersect me-1"/>Confirmar fusión
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
