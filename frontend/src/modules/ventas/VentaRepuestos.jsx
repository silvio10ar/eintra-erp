import { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import api from '../../api/client'
import { puedeEscribir } from '../../store/authStore'
import { manejarPegadoNumero } from '../../utils/numero'
import DateInput from '../../components/DateInput'
import { estadoItem, estadoPedido, ESTADO_LABEL, resumenItems } from './estadoVentaRepuesto'
import { MONTO_OCULTO, esMontoOculto } from '../../utils/montoOculto'

const fmtF = s => {
  if (!s) return '—'
  const d = new Date((s || '').replace(' ', 'T'))
  return isNaN(d) ? s : d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
const fmtM = n => {
  if (esMontoOculto(n)) return '$ ' + MONTO_OCULTO
  const v = parseFloat(n)
  if (!v || isNaN(v)) return '—'
  return '$ ' + v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const FORM_VACIO = { ocCliente: null, cliente: null, autorizado_por_id: '', observaciones: '' }

// Buscador de OC de Cliente ya cargada en Finanzas → OC Clientes — es el punto
// de entrada normal del pedido (la OC de repuestos se carga ahí primero); el
// cliente sale de la OC, no al revés. Mismo patrón que ProyectoSelector de
// FinanzasOCClientes.jsx. GET /finanzas/oc-clientes no exige permiso de
// finanzas (mismo motivo por el que Proyectos ya lo usa para mostrar la OC
// vinculada), así que alcanza con el permiso de venta_repuestos.
function OcClienteSelector({ value, onChange }) {
  const etiqueta = oc => `${oc.numero_oc} — ${oc.cli_nombre_cat || oc.cliente}`
  const [query, setQuery] = useState(value ? etiqueta(value) : '')
  const [opciones, setOpc] = useState([])
  const [abierto, setAbierto] = useState(false)

  useEffect(() => { setQuery(value ? etiqueta(value) : '') }, [value])

  const buscar = async q => {
    setQuery(q)
    if (q.length < 1) { setOpc([]); setAbierto(false); return }
    try {
      const r = await api.get('/finanzas/oc-clientes', { params: { buscar: q, tipo: 'repuesto' } })
      setOpc(r.data.slice(0, 10))
      setAbierto(true)
    } catch { setOpc([]) }
  }

  const seleccionar = oc => {
    if (!oc.cliente_id) {
      alert('Esta OC no tiene un cliente del catálogo vinculado — completala primero en Finanzas → OC Clientes.')
      return
    }
    setQuery(etiqueta(oc))
    setAbierto(false)
    onChange(oc)
  }

  const quitar = () => { setQuery(''); setAbierto(false); onChange(null) }
  const cancelarTexto = () => setTimeout(() => { setAbierto(false); setQuery(value ? etiqueta(value) : '') }, 180)

  return (
    <div className="position-relative d-flex gap-1">
      <input className="form-control form-control-sm" value={query}
        placeholder="Buscar por N° de OC o cliente..."
        onChange={e => buscar(e.target.value)}
        onBlur={cancelarTexto}
        autoComplete="off" />
      {value && (
        <button type="button" className="btn btn-sm btn-outline-secondary flex-shrink-0" title="Quitar OC"
          onMouseDown={e => e.preventDefault()} onClick={quitar}>
          <i className="bi bi-x" />
        </button>
      )}
      {abierto && opciones.length > 0 && (
        <div className="border rounded bg-white shadow-sm position-absolute w-100" style={{ zIndex: 1080, top: '100%', maxHeight: 220, overflowY: 'auto' }}>
          {opciones.map(oc => (
            <div key={oc.id} className="px-2 py-1 border-bottom" style={{ cursor: 'pointer', fontSize: '0.83rem' }}
              onMouseDown={() => seleccionar(oc)}>
              <span className="badge bg-secondary me-1" style={{ fontSize: '0.7rem', fontFamily: 'monospace' }}>{oc.numero_oc}</span>
              <span className="fw-semibold">{oc.cli_nombre_cat || oc.cliente}</span>
              {!oc.cliente_id && <span className="text-danger small ms-2">(sin cliente vinculado)</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Buscador de cliente — mismo patrón que ClienteSelector de FinanzasOCClientes.jsx.
function ClienteSelector({ value, onChange }) {
  const [query, setQuery] = useState(value?.nombre || '')
  const [opciones, setOpc] = useState([])
  const [abierto, setAbierto] = useState(false)

  useEffect(() => { setQuery(value?.nombre || '') }, [value])

  const buscar = async q => {
    setQuery(q)
    if (q.length < 1) { setOpc([]); setAbierto(false); return }
    try {
      const r = await api.get('/ventas/clientes', { params: { buscar: q } })
      setOpc(r.data.slice(0, 10))
      setAbierto(true)
    } catch { setOpc([]) }
  }

  return (
    <div className="position-relative">
      <input className="form-control form-control-sm" value={query}
        placeholder="Buscar cliente por nombre..."
        onChange={e => { onChange(null); buscar(e.target.value) }}
        onBlur={() => setTimeout(() => setAbierto(false), 180)}
        autoComplete="off" />
      {abierto && opciones.length > 0 && (
        <div className="border rounded bg-white shadow-sm position-absolute w-100" style={{ zIndex: 1080, top: '100%', maxHeight: 220, overflowY: 'auto' }}>
          {opciones.map(c => (
            <div key={c.id} className="px-2 py-1 border-bottom" style={{ cursor: 'pointer', fontSize: '0.83rem' }}
              onMouseDown={() => { setQuery(c.nombre); setAbierto(false); onChange(c) }}>
              <span className="fw-semibold">{c.nombre}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Buscador de factura del cliente para vincular a un ítem ya entregado.
function FacturaSelector({ clienteId, onElegir, onCancelar }) {
  const [query, setQuery] = useState('')
  const [opciones, setOpc] = useState([])

  useEffect(() => {
    api.get('/venta-repuestos/facturas-disponibles', { params: { cliente_id: clienteId } })
      .then(r => setOpc(r.data)).catch(() => setOpc([]))
  }, [clienteId])

  const buscar = async q => {
    setQuery(q)
    try {
      const r = await api.get('/venta-repuestos/facturas-disponibles', { params: { cliente_id: clienteId, buscar: q } })
      setOpc(r.data)
    } catch { setOpc([]) }
  }

  return (
    <div className="d-flex align-items-center gap-1" style={{ minWidth: 220 }}>
      <select className="form-select form-select-sm" value=""
        onChange={e => { const f = opciones.find(o => o.id === +e.target.value); if (f) onElegir(f) }}>
        <option value="">— Elegir factura —</option>
        {opciones.map(f => (
          <option key={f.id} value={f.id}>{f.numero} — {fmtM(f.importe)}{f.pago_confirmado ? ' (cobrada)' : ''}</option>
        ))}
      </select>
      <input className="form-control form-control-sm" style={{ width: 100 }} placeholder="Buscar n°..."
        value={query} onChange={e => buscar(e.target.value)} />
      <button type="button" className="btn btn-sm btn-outline-secondary py-0 px-1" onClick={onCancelar}>
        <i className="bi bi-x" />
      </button>
    </div>
  )
}

export default function VentaRepuestos() {
  const canWrite = puedeEscribir('venta_repuestos')
  const canStock = puedeEscribir('stock')

  // Llegada desde "Crear pedido de repuesto" en Finanzas → OC Clientes
  // (?oc=<id>): abre el alta de pedido con esa OC (y su cliente) precargados.
  const [searchParams, setSearchParams] = useSearchParams()
  const deepLinkOc = useRef(searchParams.get('oc'))

  const [pedidos, setPedidos] = useState([])
  const [loading, setLoading] = useState(true)
  const [autorizantes, setAutorizantes] = useState([])
  const [filtroEstado, setFiltroEstado] = useState('')
  const [filtroDesde, setFiltroDesde] = useState('')
  const [filtroHasta, setFiltroHasta] = useState('')
  const [buscar, setBuscar] = useState('')

  const cargar = useCallback(() => {
    setLoading(true)
    api.get('/venta-repuestos', { params: {
      estado: filtroEstado || undefined, buscar: buscar || undefined,
      desde: filtroDesde || undefined, hasta: filtroHasta || undefined,
    } })
      .then(r => setPedidos(r.data))
      .catch(e => console.error(e))
      .finally(() => setLoading(false))
  }, [filtroEstado, buscar, filtroDesde, filtroHasta])

  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { api.get('/stock/autorizantes').then(r => setAutorizantes(r.data)).catch(e => console.error(e)) }, [])

  // OC de Cliente (tipo Repuesto) sin pedido armado todavía — punto de
  // partida visible para arrancar un pedido nuevo, sin tener que buscar a
  // mano el N° de OC.
  const [ocDisponibles, setOcDisponibles] = useState([])
  const cargarOcDisponibles = useCallback(() => {
    api.get('/venta-repuestos/oc-disponibles').then(r => setOcDisponibles(r.data)).catch(e => console.error(e))
  }, [])
  useEffect(() => { cargarOcDisponibles() }, [cargarOcDisponibles])

  /* ── Nuevo pedido / editar pedido pendiente ────────────────────── */
  const [abierto, setAbierto] = useState(false)
  const [editandoId, setEditandoId] = useState(null) // null = alta nueva; si no, id del pedido que se está editando
  const [form, setForm] = useState(FORM_VACIO)
  const [items, setItems] = useState([])
  const [busquedaProd, setBusquedaProd] = useState('')
  const [sugsProd, setSugsProd] = useState([])
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  const nuevoPedido = () => {
    setEditandoId(null)
    setForm(FORM_VACIO); setItems([]); setBusquedaProd(''); setSugsProd([]); setError(''); setAbierto(true)
  }

  // Editar un pedido que sigue en 'Pendiente' (nada retirado todavía) — el
  // backend acepta cambiar cliente/OC/ítems/observaciones mientras no haya
  // ningún retiro cargado; una vez que se retira algo, se bloquea allá y acá
  // ya no se ofrece el botón.
  const editarPedido = ped => {
    setEditandoId(ped.id)
    setForm({
      ocCliente: ped.oc_cliente_id ? { id: ped.oc_cliente_id, numero_oc: ped.oc_cliente_numero, cliente_id: ped.cliente_id, cli_nombre_cat: ped.cliente_nombre } : null,
      cliente: { id: ped.cliente_id, nombre: ped.cliente_nombre },
      autorizado_por_id: ped.autorizado_por_id || '',
      observaciones: ped.observaciones || '',
    })
    setItems(ped.items.map(it => ({
      producto_id: it.producto_id, codigo: it.codigo, descripcion: it.descripcion, unidad: it.unidad,
      stock_actual: it.stock_actual, cantidad: it.cantidad, precio_unit: it.precio_unit,
    })))
    setBusquedaProd(''); setSugsProd([]); setError(''); setAbierto(true)
  }

  const buscarProducto = txt => {
    setBusquedaProd(txt)
    if (!txt.trim()) { setSugsProd([]); return }
    api.get('/stock/productos', { params: { buscar: txt } })
      .then(r => setSugsProd(r.data.filter(p => !items.some(it => it.producto_id === p.id)).slice(0, 8)))
      .catch(() => setSugsProd([]))
  }

  const agregarItem = p => {
    setItems(prev => [...prev, {
      producto_id: p.id, codigo: p.codigo, descripcion: p.descripcion, unidad: p.unidad,
      stock_actual: p.stock_actual, cantidad: 1, precio_unit: p.precio_venta || 0,
    }])
    setBusquedaProd(''); setSugsProd([])
  }
  // Elegir una OC de Cliente deriva el cliente de ahí — no se elige por separado
  // mientras haya una OC seleccionada (evita que queden desincronizados).
  const elegirOc = oc => setForm(p => ({ ...p, ocCliente: oc, cliente: { id: oc.cliente_id, nombre: oc.cli_nombre_cat || oc.cliente } }))
  const quitarOc = () => setForm(p => ({ ...p, ocCliente: null, cliente: null }))

  useEffect(() => {
    const ocId = deepLinkOc.current
    if (!ocId) return
    deepLinkOc.current = null
    setSearchParams({}, { replace: true })
    api.get('/finanzas/oc-clientes', { params: { id: ocId } })
      .then(r => {
        const oc = r.data[0]
        if (!oc) return
        nuevoPedido()
        elegirOc(oc)
      })
      .catch(e => console.error(e))
  }, [])

  const quitarItem = idx => setItems(prev => prev.filter((_, i) => i !== idx))
  const setItemCampo = (idx, campo, val) => setItems(prev => prev.map((it, i) => i === idx ? { ...it, [campo]: val } : it))

  const guardarPedido = async () => {
    setError('')
    if (!form.cliente) return setError('Elegí un cliente')
    if (items.length === 0) return setError('Agregá al menos un ítem')
    for (const it of items) {
      if (!parseFloat(it.cantidad) || parseFloat(it.cantidad) <= 0) return setError(`Cargá una cantidad válida para "${it.descripcion}"`)
    }
    if (!form.autorizado_por_id) return setError('Elegí quién autoriza el retiro de stock')
    setGuardando(true)
    const body = {
      cliente_id: form.cliente.id,
      oc_cliente_id: form.ocCliente?.id || null,
      observaciones: form.observaciones,
      autorizado_por_id: form.autorizado_por_id,
      items: items.map(it => ({ producto_id: it.producto_id, cantidad: it.cantidad, precio_unit: it.precio_unit })),
    }
    try {
      if (editandoId) await api.put(`/venta-repuestos/${editandoId}`, body)
      else await api.post('/venta-repuestos', body)
      setAbierto(false); setEditandoId(null)
      cargar(); cargarOcDisponibles()
    } catch (e) {
      setError(e.response?.data?.error || 'Error al guardar')
    } finally { setGuardando(false) }
  }

  const cancelarPedido = async ped => {
    if (!confirm(`¿Cancelar el pedido #${ped.id}?`)) return
    try {
      await api.delete(`/venta-repuestos/${ped.id}`)
      cargar(); cargarOcDisponibles()
    } catch (e) { alert(e.response?.data?.error || 'Error al cancelar') }
  }

  /* ── Retirar de stock ──────────────────────────────────────────── */
  const [modalRetiro, setModalRetiro] = useState(null) // pedido
  const [retiroCant, setRetiroCant] = useState({}) // { [item_id]: cantidad }
  const [retiroLote, setRetiroLote] = useState({}) // { [item_id]: lote_id } — solo para materiales con partida
  const [lotesPorItem, setLotesPorItem] = useState({}) // { [item_id]: [...lotes] }
  const [savRetiro, setSavRetiro] = useState(false)

  const abrirRetiro = ped => {
    const cant = {}
    for (const it of ped.items) cant[it.id] = Math.max(0, it.cantidad - it.cantidad_retirada)
    setRetiroCant(cant)
    setRetiroLote({})
    setModalRetiro(ped)
    // Materiales con trazabilidad por partida: traer los lotes con saldo
    // para elegir de cuál sale, uno por ítem pendiente.
    const pendientes = ped.items.filter(it => it.trazabilidad_stock !== 'ninguna' && it.cantidad - it.cantidad_retirada > 0.0001)
    Promise.all(pendientes.map(it => api.get(`/stock/productos/${it.producto_id}/lotes`).then(r => [it.id, r.data])))
      .then(pares => setLotesPorItem(Object.fromEntries(pares)))
      .catch(() => setLotesPorItem({}))
  }

  const confirmarRetiro = async () => {
    setSavRetiro(true)
    try {
      const retiros = {}
      for (const it of modalRetiro.items) {
        const cant = retiroCant[it.id] ?? 0
        retiros[it.id] = it.trazabilidad_stock !== 'ninguna' ? { cantidad: cant, lote_id: retiroLote[it.id] || null } : cant
      }
      await api.post(`/venta-repuestos/${modalRetiro.id}/retirar`, { retiros })
      setModalRetiro(null)
      cargar()
    } catch (e) { alert(e.response?.data?.error || 'Error al confirmar el retiro') }
    finally { setSavRetiro(false) }
  }

  // Bloquea confirmar si algún ítem con cantidad a retirar > 0 requiere
  // partida y todavía no se eligió de cuál sale.
  const faltaElegirLote = modalRetiro?.items.some(it => {
    const cant = parseFloat(retiroCant[it.id]) || 0
    return it.trazabilidad_stock !== 'ninguna' && cant > 0 && !retiroLote[it.id]
  })

  /* ── Entregar / facturar ──────────────────────────────────────────── */
  const [savItem, setSavItem] = useState(null)
  const [vinculando, setVinculando] = useState(null) // item_id

  const marcarEntregado = async (ped, item) => {
    setSavItem(item.id)
    try {
      await api.post(`/venta-repuestos/${ped.id}/items/${item.id}/entregar`)
      cargar()
    } catch (e) { alert(e.response?.data?.error || 'Error al marcar entregado') }
    finally { setSavItem(null) }
  }

  const vincularFactura = async (ped, item, factura) => {
    setSavItem(item.id)
    try {
      await api.post(`/venta-repuestos/${ped.id}/items/${item.id}/vincular-factura`, { factura_venta_id: factura.id })
      setVinculando(null)
      cargar()
    } catch (e) { alert(e.response?.data?.error || 'Error al vincular la factura') }
    finally { setSavItem(null) }
  }

  const desvincularFactura = async (ped, item) => {
    setSavItem(item.id)
    try {
      await api.delete(`/venta-repuestos/${ped.id}/items/${item.id}/vincular-factura`)
      cargar()
    } catch (e) { alert(e.response?.data?.error || 'Error al quitar la factura') }
    finally { setSavItem(null) }
  }

  return (
    <div>
      <div className="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
        <h4 className="mb-0 fw-bold">
          <i className="bi bi-truck me-2 text-primary" />
          Venta de Repuestos
        </h4>
        {canWrite && !abierto && (
          <button className="btn btn-sm btn-primary" onClick={nuevoPedido}>
            <i className="bi bi-plus-lg me-1" />Nuevo pedido
          </button>
        )}
      </div>
      <p className="text-muted small mb-4">
        Seguimiento de venta de repuestos: retirado de stock → entregado al cliente → facturado → cobrado.
      </p>

      {!abierto && canWrite && ocDisponibles.length > 0 && (
        <div className="card border-0 shadow-sm mb-4">
          <div className="card-body py-2">
            <h6 className="fw-semibold mb-2" style={{ fontSize: '0.85rem' }}>
              <i className="bi bi-file-earmark-text me-1 text-primary" />
              OC de repuestos pendientes de armar pedido
            </h6>
            <div className="d-flex flex-column gap-1">
              {ocDisponibles.map(oc => (
                <button key={oc.id} type="button"
                  className="btn btn-outline-primary btn-sm d-flex justify-content-between align-items-center text-start"
                  onClick={() => { nuevoPedido(); elegirOc(oc) }}>
                  <span>
                    <span className="badge bg-secondary me-2" style={{ fontFamily: 'monospace' }}>{oc.numero_oc}</span>
                    {oc.cli_nombre_cat || oc.cliente}
                  </span>
                  <span className="text-muted small">{fmtF(oc.fecha_oc)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {abierto && (
        <div className="card border-0 shadow-sm mb-4">
          <div className="card-body">
            <h6 className="fw-semibold mb-3">{editandoId ? `Editar pedido #${editandoId}` : 'Nuevo pedido'}</h6>
            <div className="row g-2 mb-2">
              <div className="col-md-5">
                <label className="form-label small fw-semibold">OC de Cliente <span className="fw-normal text-muted">(si ya está cargada en Finanzas)</span></label>
                <OcClienteSelector value={form.ocCliente} onChange={oc => oc ? elegirOc(oc) : quitarOc()} />
              </div>
              <div className="col-md-3">
                <label className="form-label small fw-semibold">Cliente <span className="text-danger">*</span></label>
                {form.ocCliente ? (
                  <input className="form-control form-control-sm" value={form.cliente?.nombre || ''} disabled />
                ) : (
                  <ClienteSelector value={form.cliente} onChange={c => setForm(p => ({ ...p, cliente: c }))} />
                )}
              </div>
              <div className="col-md-4">
                <label className="form-label small fw-semibold">Autorizado por (retiro de stock) <span className="text-danger">*</span></label>
                <select className="form-select form-select-sm" value={form.autorizado_por_id}
                  onChange={e => setForm(p => ({ ...p, autorizado_por_id: e.target.value }))}>
                  <option value="">— Elegir —</option>
                  {autorizantes.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                </select>
              </div>
            </div>

            <div className="mb-2 position-relative">
              <label className="form-label small fw-semibold">Buscar material</label>
              <input className="form-control form-control-sm" placeholder="Código o descripción..."
                value={busquedaProd} onChange={e => buscarProducto(e.target.value)} autoComplete="off" />
              {sugsProd.length > 0 && (
                <div className="list-group position-absolute w-100 shadow-sm" style={{ zIndex: 10, maxHeight: 240, overflowY: 'auto' }}>
                  {sugsProd.map(p => (
                    <button type="button" key={p.id} className="list-group-item list-group-item-action py-2"
                      onClick={() => agregarItem(p)}>
                      <span className="fw-semibold">{p.codigo}</span> — {p.descripcion}
                      <span className="text-muted small ms-2">(disponible: {p.stock_actual} {p.unidad})</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {items.length > 0 && (
              <table className="table table-sm align-middle mt-3">
                <thead className="table-light">
                  <tr>
                    <th>Código</th><th>Descripción</th>
                    <th style={{ width: 120 }}>Cantidad</th>
                    <th style={{ width: 140 }}>Precio unit.</th>
                    <th style={{ width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={idx}>
                      <td className="font-monospace">{it.codigo}</td>
                      <td>{it.descripcion}</td>
                      <td>
                        <div className="input-group input-group-sm">
                          <input type="number" onPaste={manejarPegadoNumero} min="0.01" step="any" className="form-control"
                            value={it.cantidad} onChange={e => setItemCampo(idx, 'cantidad', e.target.value)} />
                          <span className="input-group-text">{it.unidad}</span>
                        </div>
                      </td>
                      <td>
                        <input type="number" onPaste={manejarPegadoNumero} min="0" step="0.01" className="form-control form-control-sm"
                          value={it.precio_unit} onChange={e => setItemCampo(idx, 'precio_unit', e.target.value)} />
                      </td>
                      <td>
                        <button className="btn btn-sm btn-outline-danger" onClick={() => quitarItem(idx)}>
                          <i className="bi bi-trash" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="mt-2">
              <label className="form-label small fw-semibold">Observaciones <span className="fw-normal text-muted">(opcional)</span></label>
              <input className="form-control form-control-sm" value={form.observaciones}
                onChange={e => setForm(p => ({ ...p, observaciones: e.target.value }))} />
            </div>

            {error && <div className="alert alert-danger py-2 small mt-3 mb-0">{error}</div>}

            <div className="d-flex gap-2 mt-3">
              <button className="btn btn-primary btn-sm" onClick={guardarPedido} disabled={guardando}>
                {guardando ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="bi bi-check-lg me-1" />}
                {editandoId ? 'Guardar cambios' : 'Guardar pedido'}
              </button>
              <button className="btn btn-outline-secondary btn-sm" onClick={() => { setAbierto(false); setEditandoId(null) }}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      <div className="d-flex gap-2 flex-wrap align-items-center mb-3">
        <input className="form-control form-control-sm" style={{ width: 260 }} placeholder="Buscar cliente, N° OC o material..."
          value={buscar} onChange={e => setBuscar(e.target.value)} />
        <select className="form-select form-select-sm" style={{ width: 180 }} value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          <option value="Pendiente">Pendiente</option>
          <option value="Parcial">Parcial</option>
          <option value="Retirado">Retirado</option>
          <option value="Entregado">Entregado</option>
          <option value="Cancelado">Cancelado</option>
        </select>
        <span className="text-muted small">Desde</span>
        <DateInput style={{ width: 130 }} value={filtroDesde} onChange={setFiltroDesde} />
        <span className="text-muted small">Hasta</span>
        <DateInput style={{ width: 130 }} value={filtroHasta} onChange={setFiltroHasta} />
        {(buscar || filtroEstado || filtroDesde || filtroHasta) && (
          <button className="btn btn-sm btn-outline-secondary py-0 px-2"
            onClick={() => { setBuscar(''); setFiltroEstado(''); setFiltroDesde(''); setFiltroHasta('') }}>
            <i className="bi bi-x" />
          </button>
        )}
      </div>

      {loading ? (
        <div className="d-flex justify-content-center py-5"><span className="spinner-border text-secondary" /></div>
      ) : pedidos.length === 0 ? (
        <div className="text-center text-muted py-5">
          <i className="bi bi-inbox display-6 d-block mb-2" />Sin pedidos de venta de repuestos todavía
        </div>
      ) : (
        <div className="d-flex flex-column gap-2">
          {pedidos.map(ped => {
            const est = estadoPedido(ped)
            const resumen = resumenItems(ped.items)
            const hayPendienteRetiro = ped.items.some(it => it.cantidad_retirada < it.cantidad - 0.0001)
            return (
              <div key={ped.id} className="card border-0 shadow-sm">
                <div className="card-body py-2">
                  <div className="d-flex justify-content-between align-items-start mb-2 flex-wrap gap-2">
                    <div>
                      <span className="fw-semibold me-2">Pedido #{ped.id}</span>
                      <span className="text-muted small me-2">{fmtF(ped.fecha)}</span>
                      <span className="fw-semibold">{ped.cliente_nombre}</span>
                      {ped.oc_cliente_numero && (
                        <span className="badge bg-light text-dark border ms-2">OC {ped.oc_cliente_numero}</span>
                      )}
                    </div>
                    <div className="d-flex align-items-center gap-2">
                      <span className={`badge ${ESTADO_LABEL[est]?.cls || 'bg-secondary'}`}>{ESTADO_LABEL[est]?.txt || est}</span>
                      {ped.estado === 'Pendiente' && canWrite && (
                        <>
                          <button className="btn btn-sm btn-outline-primary py-0 px-2" title="Editar pedido" onClick={() => editarPedido(ped)}>
                            <i className="bi bi-pencil" />
                          </button>
                          <button className="btn btn-sm btn-outline-danger py-0 px-2" title="Cancelar pedido" onClick={() => cancelarPedido(ped)}>
                            <i className="bi bi-x-lg" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {resumen.length > 1 && (
                    <p className="text-muted small mb-2">
                      {resumen.map(r => `${r.n}/${r.total} ${r.label.toLowerCase()}`).join(' · ')}
                    </p>
                  )}

                  <table className="table table-sm mb-2">
                    <thead className="table-light">
                      <tr>
                        <th>Material</th>
                        <th className="text-end" style={{ width: 130 }}>Cantidad</th>
                        <th style={{ width: 110 }}>Estado</th>
                        <th style={{ width: 260 }}>Factura</th>
                        <th style={{ width: 120 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {ped.items.map(it => {
                        const eIt = estadoItem(it)
                        return (
                          <tr key={it.id}>
                            <td className="font-monospace" style={{ fontSize: '0.82rem' }}>
                              {it.codigo} <span className="font-sans">— {it.descripcion}</span>
                            </td>
                            <td className="text-end">
                              {it.cantidad_retirada > 0 && it.cantidad_retirada < it.cantidad
                                ? <span className="text-info fw-semibold">{it.cantidad_retirada} / {it.cantidad} {it.unidad}</span>
                                : it.cantidad_retirada >= it.cantidad
                                  ? <span className="text-success fw-semibold">{it.cantidad} {it.unidad} ✓</span>
                                  : <span className="text-muted">{it.cantidad} {it.unidad}</span>}
                            </td>
                            <td><span className={`badge ${ESTADO_LABEL[eIt].cls}`} style={{ fontSize: '0.7rem' }}>{ESTADO_LABEL[eIt].txt}</span></td>
                            <td>
                              {it.factura_venta_id ? (
                                <span className="d-flex align-items-center gap-1">
                                  <span className={it.factura_pago_confirmado ? 'text-success fw-semibold' : ''}>{it.factura_numero}</span>
                                  {canWrite && (
                                    <button className="btn btn-sm btn-outline-secondary py-0 px-1" title="Quitar factura"
                                      disabled={savItem === it.id}
                                      onClick={() => desvincularFactura(ped, it)}>
                                      <i className="bi bi-x" />
                                    </button>
                                  )}
                                </span>
                              ) : eIt === 'entregado' && canWrite ? (
                                vinculando === it.id ? (
                                  <FacturaSelector clienteId={ped.cliente_id}
                                    onElegir={f => vincularFactura(ped, it, f)}
                                    onCancelar={() => setVinculando(null)} />
                                ) : (
                                  <button className="btn btn-sm btn-outline-primary py-0 px-2" style={{ fontSize: '0.72rem' }}
                                    onClick={() => setVinculando(it.id)}>
                                    <i className="bi bi-link-45deg me-1" />Vincular factura
                                  </button>
                                )
                              ) : <span className="text-muted">—</span>}
                            </td>
                            <td>
                              {it.cantidad_retirada >= it.cantidad - 0.0001 && !it.entregado && canWrite && (
                                <button className="btn btn-sm btn-outline-success py-0 px-2" style={{ fontSize: '0.72rem' }}
                                  disabled={savItem === it.id}
                                  onClick={() => marcarEntregado(ped, it)}>
                                  <i className="bi bi-check2 me-1" />Entregado
                                </button>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>

                  <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
                    <p className="text-muted small mb-0">
                      Autorizado por: {ped.autorizado_por_nombre}
                      {ped.observaciones && <> · {ped.observaciones}</>}
                    </p>
                    {hayPendienteRetiro && ped.estado !== 'Cancelado' && canStock && (
                      <button className="btn btn-sm btn-warning py-0 px-2" onClick={() => abrirRetiro(ped)}>
                        <i className="bi bi-box-arrow-up me-1" />Retirar de stock
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── MODAL: RETIRAR DE STOCK ── */}
      {modalRetiro && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h5 className="modal-title">Retirar de stock — Pedido #{modalRetiro.id}</h5>
                <button className="btn-close" onClick={() => setModalRetiro(null)} />
              </div>
              <div className="modal-body">
                <table className="table table-sm">
                  <thead className="table-light">
                    <tr><th>Material</th><th style={{ width: 130 }}>A retirar</th><th>Partida</th></tr>
                  </thead>
                  <tbody>
                    {modalRetiro.items.filter(it => it.cantidad - it.cantidad_retirada > 0.0001).map(it => {
                      const pendiente = it.cantidad - it.cantidad_retirada
                      return (
                        <tr key={it.id}>
                          <td>
                            {it.descripcion}
                            <div className="text-muted small">pendiente: {pendiente} {it.unidad} · stock: {it.stock_actual}</div>
                          </td>
                          <td>
                            <input type="number" onPaste={manejarPegadoNumero} min="0" max={pendiente} step="any"
                              className="form-control form-control-sm"
                              value={retiroCant[it.id] ?? pendiente}
                              onChange={e => setRetiroCant(p => ({ ...p, [it.id]: e.target.value }))} />
                          </td>
                          <td style={{ minWidth: 180 }}>
                            {it.trazabilidad_stock !== 'ninguna' ? (
                              <select className="form-select form-select-sm" value={retiroLote[it.id] || ''}
                                onChange={e => setRetiroLote(p => ({ ...p, [it.id]: e.target.value }))}>
                                <option value="">— Elegir —</option>
                                {(lotesPorItem[it.id] || []).map(l => (
                                  <option key={l.id} value={l.id}>
                                    {it.trazabilidad_stock === 'serie' ? `Serie: ${l.partida || '(sin serie)'}` : `${l.partida || '(sin partida)'} — ${l.cantidad_actual} disp.`}
                                  </option>
                                ))}
                              </select>
                            ) : <span className="text-muted">—</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div className="modal-footer py-2">
                <button className="btn btn-sm btn-secondary" onClick={() => setModalRetiro(null)}>Cancelar</button>
                <button className="btn btn-sm btn-primary" onClick={confirmarRetiro} disabled={savRetiro || faltaElegirLote}
                  title={faltaElegirLote ? 'Elegí de qué partida sale cada material que la requiere' : ''}>
                  {savRetiro ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="bi bi-check-lg me-1" />}
                  Confirmar retiro
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
