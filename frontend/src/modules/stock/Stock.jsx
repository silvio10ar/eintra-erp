import { useState, useEffect, useCallback, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import api from '../../api/client'
import { puedeEscribir, getUser } from '../../store/authStore'
import EmpleadoSelect from '../../components/EmpleadoSelect'
import DateInput from '../../components/DateInput'
import { manejarPegadoNumero } from '../../utils/numero'

const TIPOS = [
  { v:'entrada',    l:'Entrada',    c:'success' },
  { v:'salida',     l:'Salida',     c:'danger'  },
  { v:'devolucion', l:'Devolución', c:'warning' },
  { v:'ajuste',     l:'Ajuste',     c:'info'    },
]
const fmt    = n => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(n ?? 0)
const hoy    = () => new Date().toISOString().slice(0,10)
const fmtF   = iso => iso ? iso.slice(0,10).split('-').reverse().join('/') : '—'
const fmtCod = c => {
  if (!c) return ''
  if (c.includes('/')) return c.replace('/', '')
  if (!/\d$/.test(c))  return c + '0'
  return c
}

const FORM_M ={ producto_id:'', tipo:'entrada', cantidad:'', fecha:hoy(), referencia:'', precio_unit:0, proveedor:'', proyecto:'', cliente_interno:'', observaciones:'', autorizado_por_id:'' }
const FORM_H = { desde:'', hasta:'', tipo:'', campo:'todos', valor:'' }

export default function Stock() {
  const canWrite = puedeEscribir('stock')
  const esAdmin   = getUser()?.rol === 'admin'
  const location  = useLocation()

  /* ── Estado productos ───────────────────────────────────────────── */
  const [prods, setProds]     = useState([])
  const [ubics, setUbics]     = useState([])
  const [loading, setLoading] = useState(false)
  const [selId, setSelId]     = useState(null)
  const [buscar, setBuscar]   = useState('')
  const [buscarQuery, setBuscarQuery] = useState('')
  const [paginaProds, setPaginaProds] = useState(1)
  const PRODS_POR_PAGINA = 100
  const [filUbic, setFilUbic] = useState('')
  const [filAlerta, setFilAlerta] = useState(location.state?.filAlerta || '')   // ''|'ok'|'bajo'|'agotado'

  /* ── Estado modales ─────────────────────────────────────────────── */
  const [modalUbic, setModalUbic] = useState(null)  // null | prod
  const [ubicVal,   setUbicVal]   = useState('')
  const [savUbic,   setSavUbic]   = useState(false)

  const [modalM, setModalM]   = useState(null)    // null | { tipo }
  const [formM, setFormM]     = useState(FORM_M)
  const [savM, setSavM]       = useState(false)
  const [errM, setErrM]       = useState('')
  const [editandoMovId, setEditandoMovId] = useState(null) // id del movimiento en edición (admin), o null si es alta nueva
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
  const [proyActivos, setProyActivos] = useState([])
  const [actividadesActivas, setActividadesActivas] = useState([])
  const [autorizantes, setAutorizantes] = useState([])

  /* ── Ingresos pendientes ─────────────────────────────────────────── */
  const [ingPend,      setIngPend]      = useState([])
  const [ingPendSinOC, setIngPendSinOC] = useState([])
  const [modalIngPend, setModalIngPend] = useState(false)
  const [savIng,       setSavIng]       = useState(null)
  // confirmar sin-OC: { id, prodBuscar, prodSugs, prodSel }
  const [confirmSinOC, setConfirmSinOC] = useState(null)

  const cargarIngPend = useCallback(() => {
    api.get('/stock/ingresos-pendientes').then(r => setIngPend(r.data)).catch(e => console.error(e))
    api.get('/stock/ingresos-sin-oc-pendientes').then(r => setIngPendSinOC(r.data)).catch(e => console.error(e))
  }, [])

  useEffect(() => { cargarIngPend() }, [cargarIngPend])

  /* ── Pedidos de stock (solicitudes internas) ────────────────────────── */
  const [pedidosPend, setPedidosPend] = useState([])
  const [modalPedidos, setModalPedidos] = useState(false)
  const [entregaCant, setEntregaCant] = useState({}) // { [item_id]: cantidad }
  const [savPedido, setSavPedido] = useState(null)

  const cargarPedidosPend = useCallback(() => {
    api.get('/stock/pedidos').then(r => {
      setPedidosPend(r.data)
      setEntregaCant(prev => {
        const next = { ...prev }
        for (const ped of r.data) {
          for (const it of ped.items) {
            if (!(it.id in next)) next[it.id] = it.cantidad - it.cantidad_entregada
          }
        }
        return next
      })
    }).catch(e => console.error(e))
  }, [])

  useEffect(() => { cargarPedidosPend() }, [cargarPedidosPend])

  const entregarPedido = async ped => {
    setSavPedido(ped.id)
    try {
      const entregas = {}
      for (const it of ped.items) entregas[it.id] = entregaCant[it.id] ?? 0
      await api.post(`/stock/pedidos/${ped.id}/entregar`, { entregas })
      // Se borran los valores tipeados para este pedido: si queda algo pendiente
      // (entrega parcial), que se recalcule de nuevo contra el saldo real, en
      // vez de arrastrar la cantidad vieja que ya se entregó.
      setEntregaCant(prev => { const next = { ...prev }; for (const it of ped.items) delete next[it.id]; return next })
      cargarPedidosPend(); cargar()
    } catch (err) {
      alert(err.response?.data?.error ?? 'Error al confirmar la entrega')
    } finally { setSavPedido(null) }
  }

  useEffect(() => {
    // /rrhh/proyectos: listado liviano sin costos, abierto a cualquier usuario
    // autenticado — evita que este selector quede vacío para quien no tiene
    // el permiso completo del módulo Proyectos (ver Partes.jsx, mismo caso).
    api.get('/rrhh/proyectos')
      .then(r => setProyActivos(r.data.filter(p => p.estado === 'Activo')))
      .catch(e => console.error(e))
    // Mismo motivo: /rrhh/actividades tampoco tiene gate de módulo, así que
    // este selector se completa para cualquier usuario que registre un movimiento.
    api.get('/rrhh/actividades')
      .then(r => setActividadesActivas(r.data.filter(a => a.activo)))
      .catch(e => console.error(e))
    // Para el selector obligatorio de "Autorizado por" en un retiro (salida).
    api.get('/stock/autorizantes')
      .then(r => setAutorizantes(r.data))
      .catch(e => console.error(e))
  }, [])

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

  const confirmarSinOC = async (id, producto_id) => {
    setSavIng(id)
    try {
      await api.post(`/stock/ingresos-sin-oc-pendientes/${id}/confirmar`, { producto_id })
      setConfirmSinOC(null); cargarIngPend(); cargar()
    } catch(err) { alert(err.response?.data?.error ?? 'Error') }
    finally { setSavIng(null) }
  }

  const rechazarSinOC = async (id, desc) => {
    if (!confirm(`¿Rechazar ingreso de "${desc}"? El material NO entrará al stock.`)) return
    setSavIng(id)
    try {
      await api.delete(`/stock/ingresos-sin-oc-pendientes/${id}`)
      cargarIngPend()
    } catch(err) { alert(err.response?.data?.error ?? 'Error') }
    finally { setSavIng(null) }
  }

  /* ── Cargar productos ───────────────────────────────────────────── */
  // Con miles de productos en el catálogo real, traer todo de entrada es lo
  // que hacía sentir lenta la pantalla — igual que en Materiales, ahora no se
  // pide nada hasta que haya al menos un criterio activo.
  const hayFiltro = !!(buscarQuery || filUbic || filAlerta)

  const cargar = useCallback(() => {
    if (!hayFiltro) { setProds([]); return }
    setLoading(true)
    api.get('/stock/productos', { params: { buscar: buscarQuery||undefined, ubicacion: filUbic||undefined, alerta: filAlerta||undefined } })
      .then(r => setProds(r.data))
      .finally(() => setLoading(false))
  }, [buscarQuery, filUbic, filAlerta, hayFiltro])

  useEffect(() => { cargar() }, [cargar])

  /* ── Contadores de la barra de estado ──────────────────────────────
     Siempre reflejan el catálogo completo, no lo que esté filtrado/cargado
     en pantalla — por eso se piden aparte, con un solo número por categoría
     en vez de traer todas las filas. */
  const [contadores, setContadores] = useState({ total: 0, disponibles: 0, stockBajo: 0, agotados: 0 })
  useEffect(() => {
    api.get('/stock/productos/contadores').then(r => setContadores(r.data)).catch(e => console.error(e))
  }, [])

  // Debounce: esperar una pausa antes de consultar, en vez de un pedido por
  // cada letra tipeada (mismo patrón que ya usan Compras/Materiales/Finanzas).
  useEffect(() => {
    const t = setTimeout(() => setBuscarQuery(buscar), 300)
    return () => clearTimeout(t)
  }, [buscar])

  useEffect(() => {
    api.get('/stock/productos/ubicaciones').then(r => setUbics(r.data))
    api.get('/compras/proveedores').then(r => setProvsList(r.data)).catch(e => console.error(e))
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

  /* ── Sugerencias búsqueda de producto en modal movimiento ──────────
     Independiente de "prods" (que ahora puede estar vacío si no hay ningún
     filtro activo en la pantalla principal) — busca directo contra el backend. */
  useEffect(() => {
    if (!buscarP || buscarP.length < 2) { setSugs([]); return }
    const t = setTimeout(() => {
      api.get('/stock/productos', { params: { buscar: buscarP } })
        .then(r => setSugs(r.data.slice(0, 8)))
        .catch(() => setSugs([]))
    }, 250)
    return () => clearTimeout(t)
  }, [buscarP])

  /* ── Sugerencias búsqueda de producto en "Confirmar ingreso sin OC" ──
     Mismo motivo que arriba: no depende de "prods". */
  useEffect(() => {
    const q = confirmSinOC?.prodBuscar || ''
    if (q.length < 2) return
    const t = setTimeout(() => {
      api.get('/stock/productos', { params: { buscar: q } })
        .then(r => setConfirmSinOC(prev => prev ? { ...prev, prodSugs: r.data.slice(0, 8) } : prev))
        .catch(() => {})
    }, 250)
    return () => clearTimeout(t)
  }, [confirmSinOC?.prodBuscar])

  /* ── Producto seleccionado ──────────────────────────────────────── */
  const sel = prods.find(p => p.id === selId)

  /* ── Abrir modales ──────────────────────────────────────────────── */
  const abrirEditarUbic = p => { if (!p) return; setUbicVal(p.ubicacion || ''); setModalUbic(p) }

  const abrirMov = (tipo) => {
    const p = sel
    setFormM({ ...FORM_M, tipo, fecha: hoy(), producto_id: p?.id??'' })
    setBuscarP(p ? `${p.codigo} — ${p.descripcion}` : '')
    setSugs([]); setErrM(''); setEditandoMovId(null); setModalM({ tipo })
  }

  // Editar un movimiento ya cargado (admin, doble click en la fila del historial).
  const abrirEditarMov = m => {
    if (!esAdmin) return
    setFormM({
      producto_id: m.producto_id, tipo: m.tipo, cantidad: m.cantidad,
      fecha: m.fecha?.slice(0, 10) || hoy(), referencia: m.referencia || '',
      precio_unit: m.precio_unit || 0, proveedor: m.proveedor || '',
      proyecto: m.proyecto || '', cliente_interno: m.cliente_interno || '',
      observaciones: m.observaciones || '', autorizado_por_id: m.autorizado_por_id || '',
    })
    setBuscarP(`${m.codigo} — ${m.descripcion}`)
    setSugs([]); setErrM(''); setEditandoMovId(m.id); setModalM({ tipo: m.tipo })
  }

  const cerrarModalM = () => { setModalM(null); setEditandoMovId(null) }

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
    e.preventDefault()
    if (formM.tipo === 'salida' && !formM.autorizado_por_id) {
      setErrM('Elegí quién autoriza este retiro'); return
    }
    setSavM(true); setErrM('')
    try {
      if (editandoMovId) {
        await api.put(`/stock/movimientos/${editandoMovId}`, formM)
        cerrarModalM(); cargar(); cargarHistorial()
      } else {
        const { data } = await api.post('/stock/movimientos', formM)
        setModalM(null); cargar()
        alert(data.mensaje)
      }
    } catch(err) { setErrM(err.response?.data?.error ?? 'Error al guardar') }
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

  /* ── Contadores barra estado (siempre del catálogo completo, ver arriba) ── */
  const { total, disponibles, stockBajo, agotados } = contadores
  const totalPags   = Math.ceil(totalMovs / 200)

  // Paginar solo la RENDERIZACIÓN: la lista completa ya llegó filtrada del
  // servidor (para los contadores de arriba), pero dibujar de una miles de
  // filas en el DOM es lo que hacía lento cada re-render.
  useEffect(() => { setPaginaProds(1) }, [prods])
  const totalPagsProds = Math.max(1, Math.ceil(prods.length / PRODS_POR_PAGINA))
  const prodsPagina = prods.slice((paginaProds - 1) * PRODS_POR_PAGINA, paginaProds * PRODS_POR_PAGINA)

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
        <button className={`btn btn-sm position-relative ${(ingPend.length + ingPendSinOC.length) > 0 ? 'btn-warning' : 'btn-outline-secondary'}`}
          onClick={() => setModalIngPend(true)}>
          <i className="bi bi-box-arrow-in-down me-1"/>Ingresos pendientes
          {(ingPend.length + ingPendSinOC.length) > 0 && (
            <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger"
              style={{fontSize:'0.68rem'}}>{ingPend.length + ingPendSinOC.length}</span>
          )}
        </button>
        <button className={`btn btn-sm position-relative ${pedidosPend.length > 0 ? 'btn-warning' : 'btn-outline-secondary'}`}
          onClick={() => setModalPedidos(true)}>
          <i className="bi bi-clipboard-check me-1"/>Pedidos de stock
          {pedidosPend.length > 0 && (
            <span className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger"
              style={{fontSize:'0.68rem'}}>{pedidosPend.length}</span>
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
        {!hayFiltro
          ? (
            <div className="text-center text-muted py-5">
              <i className="bi bi-search fs-3 d-block mb-2"/>
              Escribí para buscar, o elegí una ubicación / alerta de stock
            </div>
          )
          : loading
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
                    : prodsPagina.map(p => {
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
                            <td><div>{p.descripcion}</div></td>
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
        {totalPagsProds > 1 && (
          <div className="border-top px-3 py-1 d-flex align-items-center justify-content-center gap-2" style={{fontSize:'0.78rem'}}>
            <button className="btn btn-sm btn-outline-secondary py-0 px-2" disabled={paginaProds <= 1}
              onClick={() => setPaginaProds(p => p - 1)}>‹ Anterior</button>
            <span className="text-muted">Página {paginaProds} de {totalPagsProds}</span>
            <button className="btn btn-sm btn-outline-secondary py-0 px-2" disabled={paginaProds >= totalPagsProds}
              onClick={() => setPaginaProds(p => p + 1)}>Siguiente ›</button>
          </div>
        )}
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
                    <DateInput className="form-control form-control-sm" style={{width:130}}
                      value={filtH.desde} onChange={v => { setFiltH(p=>({...p,desde:v})); setPageH(1) }}/>
                  </div>
                  <div>
                    <label className="form-label mb-1" style={{fontSize:'0.75rem'}}>Hasta</label>
                    <DateInput className="form-control form-control-sm" style={{width:130}}
                      value={filtH.hasta} onChange={v => { setFiltH(p=>({...p,hasta:v})); setPageH(1) }}/>
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
                            <th>CLIENTE INT.</th><th>AUTORIZÓ</th><th>OBS.</th>
                          </tr>
                        </thead>
                        <tbody>
                          {movs.length === 0
                            ? <tr><td colSpan={11} className="text-center text-muted py-3">Sin resultados</td></tr>
                            : movs.map(m => (
                              <tr key={m.id}
                                style={{color: m.tipo==='salida'?'#dc3545': m.tipo==='entrada'?'#198754':undefined, cursor: esAdmin?'pointer':undefined}}
                                title={esAdmin ? 'Doble click para editar' : undefined}
                                onDoubleClick={() => abrirEditarMov(m)}>
                                <td className="text-nowrap">{fmtF(m.fecha)}</td>
                                <td className="fw-semibold">{m.codigo}</td>
                                <td><div className="text-truncate" style={{maxWidth:200}} title={m.descripcion}>{m.descripcion}</div></td>
                                <td><span className={`badge bg-${TIPOS.find(t=>t.v===m.tipo)?.c??'secondary'}`}>{m.tipo}</span></td>
                                <td className="text-end fw-semibold">{fmt(m.cantidad)}</td>
                                <td className="text-muted">{m.proveedor||'—'}</td>
                                <td className="text-end">{m.precio_unit > 0 ? fmt(m.precio_unit) : '—'}</td>
                                <td className="text-muted">{m.proyecto||'—'}</td>
                                <td className="text-muted">{m.cliente_interno||'—'}</td>
                                <td className="text-muted">{m.autorizado_por_nombre||'—'}</td>
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
                  {editandoMovId ? 'Editar movimiento' : `Registrar ${TIPOS.find(t=>t.v===formM.tipo)?.l}`}
                </h5>
                <button type="button" className="btn-close" onClick={cerrarModalM}/>
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
                    <input type="number" onPaste={manejarPegadoNumero} className="form-control" value={formM.cantidad} required min="0.001" step="any" onChange={e=>setFormM(p=>({...p,cantidad:e.target.value}))}/>
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-medium">Fecha *</label>
                    <DateInput className="form-control" value={formM.fecha} required onChange={v=>setFormM(p=>({...p,fecha:v}))}/>
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
                    <select className="form-select" value={formM.proveedor} onChange={e=>setFormM(p=>({...p,proveedor:e.target.value}))}>
                      <option value="">— Sin proveedor —</option>
                      {provsList.map(p => <option key={p.id} value={p.nombre}>{p.nombre}</option>)}
                    </select>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label small fw-medium">Proyecto o Actividad</label>
                    <select className="form-select" value={formM.proyecto} onChange={e=>setFormM(p=>({...p,proyecto:e.target.value}))}>
                      <option value="">— Sin asignar —</option>
                      {proyActivos.length > 0 && (
                        <optgroup label="Proyectos">
                          {proyActivos.map(p=>(
                            <option key={`p-${p.id}`} value={p.codigo}>{fmtCod(p.codigo)} — {p.nombre}</option>
                          ))}
                        </optgroup>
                      )}
                      {actividadesActivas.length > 0 && (
                        <optgroup label="Actividades">
                          {actividadesActivas.map(a=>(
                            <option key={`a-${a.id}`} value={a.nombre}>{a.nombre}</option>
                          ))}
                        </optgroup>
                      )}
                    </select>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label small fw-medium">Cliente interno</label>
                    <EmpleadoSelect
                      value={formM.cliente_interno}
                      onChange={v => setFormM(p => ({...p, cliente_interno: v}))}
                      placeholder="— Sin asignar —"
                    />
                  </div>
                  {formM.tipo === 'salida' && (
                    <div className="col-md-4">
                      <label className="form-label small fw-medium">Autorizado por *</label>
                      <select className="form-select" value={formM.autorizado_por_id}
                        onChange={e => setFormM(p => ({...p, autorizado_por_id: e.target.value}))}>
                        <option value="">— Elegir —</option>
                        {autorizantes.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                      </select>
                      <div className="form-text">Le llega una notificación con lo retirado</div>
                    </div>
                  )}
                  <div className="col-md-4">
                    <label className="form-label small fw-medium">Precio unitario</label>
                    <input type="number" onPaste={manejarPegadoNumero} className="form-control" value={formM.precio_unit} min="0" step="any" onChange={e=>setFormM(p=>({...p,precio_unit:parseFloat(e.target.value)||0}))}/>
                  </div>
                  <div className="col-md-8">
                    <label className="form-label small fw-medium">Observaciones</label>
                    <input className="form-control" value={formM.observaciones} onChange={e=>setFormM(p=>({...p,observaciones:e.target.value}))}/>
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={cerrarModalM}>Cancelar</button>
                <button type="submit" className="btn btn-primary" disabled={savM || !formM.producto_id || (formM.tipo === 'salida' && !formM.autorizado_por_id)}>
                  {savM && <span className="spinner-border spinner-border-sm me-2"/>}{editandoMovId ? 'Guardar cambios' : 'Registrar'}
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
                {ingPend.length === 0 && ingPendSinOC.length === 0
                  ? <p className="text-center text-muted py-5">No hay materiales pendientes de ingreso.</p>
                  : <>
                    {/* ── Desde OC ── */}
                    {ingPend.length > 0 && <>
                      <div className="px-3 py-2 bg-light border-bottom small fw-semibold text-secondary">
                        <i className="bi bi-cart me-1"/>Desde Órdenes de Compra ({ingPend.length})
                      </div>
                      <table className="table table-sm table-hover mb-0" style={{fontSize:'0.83rem'}}>
                        <thead className="table-dark sticky-top">
                          <tr>
                            <th>OC N°</th><th>PROVEEDOR</th><th>CÓDIGO</th><th>DESCRIPCIÓN</th>
                            <th className="text-end">CANTIDAD</th><th>UNIDAD</th>
                            <th>REMITO</th><th>FECHA RECEP.</th><th>STOCK ACTUAL</th><th></th>
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
                                {canWrite && (
                                  <button className="btn btn-sm btn-success me-1" disabled={savIng === row.id}
                                    onClick={() => confirmarIngreso(row.id)}>
                                    {savIng === row.id ? <span className="spinner-border spinner-border-sm"/> : <><i className="bi bi-check-lg me-1"/>Confirmar</>}
                                  </button>
                                )}
                                {canWrite && (
                                  <button className="btn btn-sm btn-outline-danger" disabled={savIng === row.id}
                                    onClick={() => rechazarIngreso(row.id, row.producto_desc)}>
                                    <i className="bi bi-x-lg"/>
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>}

                    {/* ── Sin OC ── */}
                    {ingPendSinOC.length > 0 && <>
                      <div className="px-3 py-2 bg-light border-bottom border-top small fw-semibold text-secondary mt-2">
                        <i className="bi bi-box-arrow-in-down me-1"/>Sin Orden de Compra ({ingPendSinOC.length})
                      </div>
                      <table className="table table-sm table-hover mb-0" style={{fontSize:'0.83rem'}}>
                        <thead className="table-dark sticky-top">
                          <tr>
                            <th>N° Ingreso</th><th>PROVEEDOR</th><th>DESCRIPCIÓN</th>
                            <th className="text-end">CANTIDAD</th><th>UNIDAD</th>
                            <th>PRODUCTO CATÁLOGO</th><th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {ingPendSinOC.map(row => {
                            const isConfirming = confirmSinOC?.id === row.id
                            return (
                              <tr key={row.id} style={isConfirming ? {background:'#f0f7ff'} : {}}>
                                <td className="fw-semibold">{row.form49_numero}</td>
                                <td className="text-truncate" style={{maxWidth:140}} title={row.proveedor_nombre}>{row.proveedor_nombre}</td>
                                <td>
                                  <div>{row.descripcion}</div>
                                  {row.n_parte && <div className="text-muted" style={{fontSize:'0.75rem'}}>P/N: {row.n_parte}</div>}
                                </td>
                                <td className="text-end fw-semibold">{fmt(row.cantidad)}</td>
                                <td>{row.unidad}</td>
                                <td style={{minWidth:200}}>
                                  {isConfirming ? (
                                    <div className="d-flex gap-1 align-items-center">
                                      <div className="position-relative flex-grow-1">
                                        <input className="form-control form-control-sm" style={{fontSize:'0.78rem'}}
                                          placeholder="Buscar producto en catálogo..."
                                          value={confirmSinOC.prodBuscar}
                                          onChange={e => {
                                            setConfirmSinOC(p => ({ ...p, prodBuscar: e.target.value, prodSel: null, prodSugs: [] }))
                                          }} />
                                        {confirmSinOC.prodSugs?.length > 0 && (
                                          <div className="border rounded shadow bg-white position-absolute"
                                            style={{zIndex:9999, top:'100%', left:0, right:0, maxHeight:160, overflowY:'auto'}}>
                                            {confirmSinOC.prodSugs.map(p => (
                                              <div key={p.id} className="px-2 py-1 border-bottom"
                                                style={{cursor:'pointer', fontSize:'0.75rem'}}
                                                onMouseDown={() => setConfirmSinOC(prev => ({
                                                  ...prev, prodBuscar: `${p.codigo} — ${p.descripcion}`,
                                                  prodSel: p, prodSugs: []
                                                }))}>
                                                <code style={{marginRight:6}}>{p.codigo}</code>{p.descripcion}
                                              </div>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                      <button className="btn btn-sm btn-success" style={{whiteSpace:'nowrap'}}
                                        disabled={!confirmSinOC.prodSel || savIng === row.id}
                                        onClick={() => confirmarSinOC(row.id, confirmSinOC.prodSel?.id)}>
                                        {savIng === row.id ? <span className="spinner-border spinner-border-sm"/> : 'OK'}
                                      </button>
                                      <button className="btn btn-sm btn-outline-secondary"
                                        onClick={() => setConfirmSinOC(null)}>×</button>
                                    </div>
                                  ) : (
                                    row.producto_id
                                      ? <span className="text-success small"><i className="bi bi-check-circle me-1"/>{row.producto_codigo_actual || row.producto_codigo}</span>
                                      : <span className="text-muted small fst-italic">— sin vincular —</span>
                                  )}
                                </td>
                                <td className="text-end" style={{whiteSpace:'nowrap'}}>
                                  {canWrite && !isConfirming && (
                                    <button className="btn btn-sm btn-success me-1" disabled={savIng === row.id}
                                      onClick={() => setConfirmSinOC({ id: row.id, prodBuscar: row.producto_codigo || '', prodSugs: [], prodSel: row.producto_id ? { id: row.producto_id } : null })}>
                                      <i className="bi bi-check-lg me-1"/>Confirmar
                                    </button>
                                  )}
                                  {canWrite && !isConfirming && (
                                    <button className="btn btn-sm btn-outline-danger" disabled={savIng === row.id}
                                      onClick={() => rechazarSinOC(row.id, row.descripcion)}>
                                      <i className="bi bi-x-lg"/>
                                    </button>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </>}
                  </>
                }
              </div>
              <div className="modal-footer py-2">
                <small className="text-muted me-auto">Confirmá cada material para que ingrese al stock. Los ingresos sin OC requieren vincular un producto del catálogo.</small>
                <button className="btn btn-secondary btn-sm" onClick={()=>setModalIngPend(false)}>Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {modalPedidos && (
        <div className="modal show d-block" style={{background:'rgba(0,0,0,.5)', zIndex:1060}}>
          <div className="modal-dialog modal-lg modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h5 className="modal-title">
                  <i className="bi bi-clipboard-check me-2"/>
                  Pedidos de stock pendientes
                  {pedidosPend.length > 0 && <span className="badge bg-warning text-dark ms-2">{pedidosPend.length}</span>}
                </h5>
                <button className="btn-close" onClick={()=>setModalPedidos(false)}/>
              </div>
              <div className="modal-body p-0">
                {pedidosPend.length === 0
                  ? <p className="text-center text-muted py-5">No hay pedidos de materiales pendientes.</p>
                  : pedidosPend.map(ped => (
                    <div key={ped.id} className="border-bottom p-3">
                      <div className="d-flex justify-content-between align-items-center mb-2">
                        <div>
                          <span className="fw-semibold me-2">Pedido #{ped.id}</span>
                          <span className="text-muted small">{ped.solicitante_nombre}</span>
                          <span className="badge bg-light text-dark border ms-2">
                            {ped.actividad_nombre || `${ped.proyecto_codigo} — ${ped.proyecto_nombre}`}
                          </span>
                          {ped.estado === 'Parcial' && <span className="badge bg-info text-dark ms-2">Parcial</span>}
                          {ped.autorizado_por_nombre && (
                            <span className="text-muted small ms-2">Autorizó: {ped.autorizado_por_nombre}</span>
                          )}
                        </div>
                        {canWrite && (
                          <button className="btn btn-sm btn-success" disabled={savPedido === ped.id}
                            onClick={() => entregarPedido(ped)}>
                            {savPedido === ped.id ? <span className="spinner-border spinner-border-sm"/> : <><i className="bi bi-check-lg me-1"/>Confirmar entrega</>}
                          </button>
                        )}
                      </div>
                      <table className="table table-sm mb-0" style={{fontSize:'0.83rem'}}>
                        <thead className="table-light">
                          <tr>
                            <th>Código</th><th>Descripción</th><th className="text-end">Pedido</th>
                            <th className="text-end">Stock</th><th style={{width:130}}>Entregar ahora</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ped.items.map(it => {
                            const pendiente = it.cantidad - it.cantidad_entregada
                            return (
                              <tr key={it.id}>
                                <td><code style={{fontSize:'0.78rem'}}>{it.codigo}</code></td>
                                <td>{it.descripcion}</td>
                                <td className="text-end">{fmt(pendiente)} / {fmt(it.cantidad)} {it.unidad}</td>
                                <td className={`text-end ${it.stock_actual < pendiente ? 'text-danger fw-semibold' : ''}`}>{fmt(it.stock_actual)}</td>
                                <td>
                                  {canWrite && pendiente > 0 && (
                                    <input type="number" onPaste={manejarPegadoNumero} min="0" max={pendiente} step="any" className="form-control form-control-sm"
                                      value={entregaCant[it.id] ?? pendiente}
                                      onChange={e => setEntregaCant(prev => ({ ...prev, [it.id]: e.target.value }))} />
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                      {ped.observaciones && <p className="text-muted small mt-2 mb-0">{ped.observaciones}</p>}
                    </div>
                  ))
                }
              </div>
              <div className="modal-footer py-2">
                <small className="text-muted me-auto">Se puede entregar de a parte — lo que falte queda pendiente para la próxima vez.</small>
                <button className="btn btn-secondary btn-sm" onClick={()=>setModalPedidos(false)}>Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
