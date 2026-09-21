import { useState, useEffect, useCallback, Fragment } from 'react'
import api from '../../api/client'
import DateInput from '../../components/DateInput'
import { estadoFila, ESTADO_LABEL, ROW_BG, cuotaCobrada, fechaCobroCuota } from './estadoOCClientes'
import { manejarPegadoNumero } from '../../utils/numero'
import { MONTO_OCULTO, esMontoOculto } from '../../utils/montoOculto'

const fmtF = s => {
  if (!s) return '—'
  const d = new Date(s + 'T00:00:00')
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// Para los campos propios de la OC (monto_oc, anticipo/final en USD) — están
// siempre en dólares por definición del formulario.
const fmtUSD = n => {
  if (esMontoOculto(n)) return MONTO_OCULTO
  const v = parseFloat(n)
  if (!v || isNaN(v)) return '—'
  return 'USD ' + v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Para el importe de una FACTURA o PAGO real vinculado — esos sí pueden estar
// en pesos, no siempre en dólares como los campos propios de la OC.
const fmtMoneda = (n, mon) => {
  if (esMontoOculto(n)) return MONTO_OCULTO
  const v = parseFloat(n)
  if (!v || isNaN(v)) return '—'
  const sym = mon === 'DÓLAR' ? 'USD ' : mon === 'EURO' ? '€ ' : '$ '
  return sym + v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const CUOTA_VACIA = { tipo: 'unico', pct: 100, monto_planeado: '', fecha_estimada: '', factura_id: null, fecha_cobro: '', pagos: [] }

const TIPO_CUOTA_LABEL = { anticipo: 'Anticipo', avance: 'Avance', saldo_final: 'Saldo final', unico: 'Pago único' }

// Atajos para armar las cuotas rápido según cómo venga la OC — quedan 100%
// editables después (agregar/quitar filas, cambiar %, etc.).
const PRESETS_CUOTAS = {
  anticipo_resto: () => [
    { ...CUOTA_VACIA, tipo: 'anticipo',    pct: 30 },
    { ...CUOTA_VACIA, tipo: 'saldo_final', pct: 70 },
  ],
  anticipo_avances: () => [
    { ...CUOTA_VACIA, tipo: 'anticipo',    pct: 20 },
    { ...CUOTA_VACIA, tipo: 'avance',      pct: 40 },
    { ...CUOTA_VACIA, tipo: 'saldo_final', pct: 40 },
  ],
  porcentajes: () => [
    { ...CUOTA_VACIA, tipo: 'avance', pct: 50 },
    { ...CUOTA_VACIA, tipo: 'avance', pct: 50 },
  ],
  unico: () => [{ ...CUOTA_VACIA }],
}

const FORM_VACIO = {
  cliente_id: null, cliente: '', cli_nombre_cat: '', cli_cuit_cat: '',
  proyecto_id: null, proyecto: '',
  numero_oc: '', monto_oc: '', fecha_oc: '', fecha_recepcion_oc: '',
  cuotas: [{ ...CUOTA_VACIA }],
  numero_poliza: '', fecha_pedido_poliza: '', fecha_poliza: '', vigencia_poliza: '', fecha_entrega_doc: '',
  observaciones: '', cierre_tipo: '', fecha_cierre_admin: '', comentarios: '',
}

function ClienteSelector({ value, onChange }) {
  const [query,   setQuery]   = useState(value || '')
  const [opciones, setOpc]    = useState([])
  const [abierto, setAbierto] = useState(false)

  useEffect(() => { setQuery(value || '') }, [value])

  const buscar = async q => {
    setQuery(q)
    if (q.length < 1) { setOpc([]); setAbierto(false); return }
    try {
      const r = await api.get('/ventas/clientes', { params: { buscar: q } })
      setOpc(r.data.slice(0, 10))
      setAbierto(true)
    } catch { setOpc([]) }
  }

  const seleccionar = c => {
    setQuery(c.nombre)
    setAbierto(false)
    onChange(c)
  }

  return (
    <div className="position-relative">
      <input className="form-control form-control-sm" value={query}
        placeholder="Buscar por nombre o código (ej: NIKIT)..."
        onChange={e => buscar(e.target.value)}
        onBlur={() => setTimeout(() => setAbierto(false), 180)}
        autoComplete="off" />
      {abierto && opciones.length > 0 && (
        <div className="border rounded bg-white shadow-sm position-absolute w-100" style={{ zIndex: 1080, top: '100%', maxHeight: 220, overflowY: 'auto' }}>
          {opciones.map(c => (
            <div key={c.id} className="px-2 py-1 border-bottom" style={{ cursor: 'pointer', fontSize: '0.83rem' }}
              onMouseDown={() => seleccionar(c)}>
              {c.codigo && (
                <span className="badge bg-secondary me-1" style={{ fontSize: '0.7rem', fontFamily: 'monospace' }}>{c.codigo}</span>
              )}
              <span className="fw-semibold">{c.nombre}</span>
              {c.cuit && (
                <span className="text-muted ms-2" style={{ fontSize: '0.75rem', fontFamily: 'monospace' }}>{c.cuit}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ProyectoSelector({ value, onChange }) {
  const [query,   setQuery]   = useState(value || '')
  const [opciones, setOpc]    = useState([])
  const [abierto, setAbierto] = useState(false)

  useEffect(() => { setQuery(value || '') }, [value])

  const buscar = async q => {
    setQuery(q)
    if (q.length < 1) { setOpc([]); setAbierto(false); return }
    try {
      const r = await api.get('/proyectos', { params: { buscar: q } })
      setOpc(r.data.slice(0, 10))
      setAbierto(true)
    } catch { setOpc([]) }
  }

  const seleccionar = p => {
    setQuery(`${p.codigo} — ${p.nombre}`)
    setAbierto(false)
    onChange(p)
  }

  // No toda OC corresponde a un proyecto cargado — hace falta poder sacarlo,
  // no solo cambiarlo por otro.
  const quitar = () => {
    setQuery('')
    setAbierto(false)
    onChange(null)
  }

  // Si se tipeó algo sin elegir una opción de la lista, se descarta al salir
  // del campo — para vaciarlo de verdad está el botón "Quitar".
  const cancelarTexto = () => setTimeout(() => { setAbierto(false); setQuery(value || '') }, 180)

  return (
    <div className="position-relative d-flex gap-1">
      <input className="form-control form-control-sm" value={query}
        placeholder="Buscar por código o nombre de proyecto..."
        onChange={e => buscar(e.target.value)}
        onBlur={cancelarTexto}
        autoComplete="off" />
      {value && (
        <button type="button" className="btn btn-sm btn-outline-secondary flex-shrink-0" title="Quitar proyecto"
          onMouseDown={e => e.preventDefault()} onClick={quitar}>
          <i className="bi bi-x" />
        </button>
      )}
      {abierto && opciones.length > 0 && (
        <div className="border rounded bg-white shadow-sm position-absolute w-100" style={{ zIndex: 1080, top: '100%', maxHeight: 220, overflowY: 'auto' }}>
          {opciones.map(p => (
            <div key={p.id} className="px-2 py-1 border-bottom" style={{ cursor: 'pointer', fontSize: '0.83rem' }}
              onMouseDown={() => seleccionar(p)}>
              <span className="badge bg-secondary me-1" style={{ fontSize: '0.7rem', fontFamily: 'monospace' }}>{p.codigo}</span>
              <span className="fw-semibold">{p.nombre}</span>
              {p.cliente_nombre && (
                <span className="text-muted ms-2" style={{ fontSize: '0.75rem' }}>{p.cliente_nombre}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function FinanzasOCClientes({ canWrite, abrirOcId, onAbierto }) {
  const [expandidas, setExpandidas] = useState(new Set())
  const toggleExpand = id => setExpandidas(p => {
    const s = new Set(p)
    s.has(id) ? s.delete(id) : s.add(id)
    return s
  })

  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(false)
  const [buscar,  setBuscar]  = useState('')
  const [filtEst, setFiltEst] = useState('')
  const [modal,   setModal]   = useState(null)  // null | 'new' | objeto
  const [form,    setForm]    = useState(FORM_VACIO)
  const [saving,  setSaving]  = useState(false)
  const [facturasProyecto,   setFacturasProyecto]   = useState([])
  const [facturasLoading,    setFacturasLoading]    = useState(false)

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const p = {}
      if (buscar) p.buscar = buscar
      const r = await api.get('/finanzas/oc-clientes', { params: p })
      setRows(r.data)
    } finally { setLoading(false) }
  }, [buscar])

  useEffect(() => {
    const t = setTimeout(() => cargar(), 300)
    return () => clearTimeout(t)
  }, [cargar])

  // Deep-link desde "Seguimiento OC Ventas": abre directamente el modal de
  // edición de la OC indicada, una vez que las filas terminaron de cargar.
  useEffect(() => {
    if (!abrirOcId || !rows.length) return
    const row = rows.find(r => r.id === abrirOcId)
    if (row) abrirEditar(row)
    onAbierto?.()
  }, [abrirOcId, rows])

  // Reseteado explícitamente en cada apertura/cierre del modal: si quedaba con el
  // índice de una búsqueda de factura/pago abierta de una OC anterior, elegir un
  // resultado terminaba vinculándolo a la cuota equivocada de la OC actual.
  const abrirNuevo = () => { setForm(FORM_VACIO); setModal('new'); setVinculando(null); setVinculandoPago(null) }
  const abrirEditar = r => {
    setForm({
      ...FORM_VACIO, ...r,
      cliente_id: r.cliente_id || null,
      proyecto_id: r.proyecto_id || null,
      proyecto: r.proyecto_id ? `${r.proy_codigo} — ${r.proy_nombre}` : '',
      cuotas: r.cuotas?.length ? r.cuotas.map(c => ({ ...c, pagos: c.pagos || [] })) : [{ ...CUOTA_VACIA }],
    })
    setModal(r)
    setVinculando(null); setVinculandoPago(null)
  }

  useEffect(() => {
    if (!modal || !form.proyecto_id) { setFacturasProyecto([]); return }
    setFacturasLoading(true)
    api.get('/finanzas/facturas-venta', { params: { proyecto_id: form.proyecto_id } })
      .then(r => setFacturasProyecto(r.data.filter(f => !(f.tipo_factura || '').startsWith('NC'))))
      .catch(() => setFacturasProyecto([]))
      .finally(() => setFacturasLoading(false))
  }, [modal, form.proyecto_id])

  // ── Cuotas de facturación (cantidad variable) ───────────────────────────────
  const [vinculando, setVinculando] = useState(null) // idx de la cuota que está eligiendo factura
  const [vinculandoPago, setVinculandoPago] = useState(null) // idx de la cuota que está eligiendo pago
  const [pagosPorFactura, setPagosPorFactura] = useState({}) // { [facturaId]: pago[] }, cache
  const [cargandoPagosDe, setCargandoPagosDe] = useState(null) // facturaId en carga

  const setCuota = (idx, campo, val) => setForm(p => ({
    ...p, cuotas: p.cuotas.map((c, i) => i === idx ? { ...c, [campo]: val } : c),
  }))
  const agregarCuota = () => setForm(p => ({ ...p, cuotas: [...p.cuotas, { ...CUOTA_VACIA, tipo: 'avance', pct: '' }] }))
  const quitarCuota = idx => {
    setForm(p => ({ ...p, cuotas: p.cuotas.filter((_, i) => i !== idx) }))
    // Borrar una cuota corre el índice de las siguientes una posición hacia
    // arriba — si había una búsqueda de factura/pago abierta en una fila
    // posterior, hay que correrle el índice (o cerrarla si era la borrada).
    setVinculando(v => v == null ? v : v === idx ? null : v > idx ? v - 1 : v)
    setVinculandoPago(v => v == null ? v : v === idx ? null : v > idx ? v - 1 : v)
  }
  const aplicarPreset = key => setForm(p => {
    const hayVinculadas = p.cuotas.some(c => c.factura_id || (c.pagos || []).length)
    if (hayVinculadas && !confirm('Esto reemplaza las cuotas actuales, incluyendo las que ya tienen una factura o un pago vinculado. ¿Continuar?')) return p
    return { ...p, cuotas: PRESETS_CUOTAS[key]() }
  })

  const vincularFactura = (idx, facturaId) => {
    setCuota(idx, 'factura_id', facturaId)
    setVinculando(null)
  }
  const desvincularFactura = idx => setForm(p => ({
    ...p, cuotas: p.cuotas.map((c, i) => i === idx ? { ...c, factura_id: null, fecha_cobro: '', pagos: [] } : c),
  }))

  // Datos de la factura vinculada a una cuota: si ya se guardó, vienen en la
  // propia cuota (factura_numero/fecha/importe/...); si se acaba de vincular
  // en esta misma edición (todavía sin guardar), se busca en vivo en la lista
  // de facturas del proyecto.
  const facturaDeCuota = c => {
    if (!c.factura_id) return null
    if (c.factura_numero) return { numero: c.factura_numero, fecha: c.factura_fecha, importe: c.factura_importe, moneda: c.factura_moneda, pago_confirmado: c.factura_pago_confirmado }
    const f = facturasProyecto.find(x => x.id === c.factura_id)
    return f ? { numero: f.numero, fecha: f.fecha, importe: f.importe, moneda: f.moneda, pago_confirmado: f.pago_confirmado } : null
  }

  // Pagos ya registrados de una factura (modal "Pagos" de Facturas de Venta) —
  // se traen bajo demanda, cacheados por factura, para elegir a cuál de esos
  // pagos reales corresponde el cobro de esta cuota.
  const cargarPagosFactura = async facturaId => {
    if (pagosPorFactura[facturaId]) return
    setCargandoPagosDe(facturaId)
    try {
      const r = await api.get(`/finanzas/facturas-venta/${facturaId}/pagos`)
      setPagosPorFactura(p => ({ ...p, [facturaId]: r.data }))
    } catch { setPagosPorFactura(p => ({ ...p, [facturaId]: [] })) }
    finally { setCargandoPagosDe(null) }
  }
  const abrirVincularPago = (idx, facturaId) => { setVinculandoPago(idx); cargarPagosFactura(facturaId) }
  // Agrega un pago más a la lista de la cuota (no reemplaza) — una cuota puede
  // cobrarse con varios pagos combinados. El picker queda abierto para poder
  // agregar el siguiente sin tener que reabrirlo.
  const agregarPagoCuota = (idx, pago) => setForm(p => ({
    ...p, cuotas: p.cuotas.map((c, i) => i === idx ? { ...c, pagos: [...(c.pagos || []), pago] } : c),
  }))
  const quitarPagoCuota = (idx, pagoId) => setForm(p => ({
    ...p, cuotas: p.cuotas.map((c, i) => i === idx ? { ...c, pagos: (c.pagos || []).filter(pg => pg.id !== pagoId) } : c),
  }))

  const totalPct = form.cuotas.reduce((s, c) => s + (parseFloat(c.pct) || 0), 0)

  const guardar = async () => {
    if (!form.cliente.trim() || !form.numero_oc.trim()) return alert('Cliente y N° OC son requeridos')
    setSaving(true)
    // El backend guarda los vínculos a pagos por id (pago_ids); "pagos" acá es
    // solo para mostrar el detalle en pantalla, no hace falta mandarlo entero.
    const body = { ...form, cuotas: form.cuotas.map(c => ({ ...c, pago_ids: (c.pagos || []).map(p => p.id) })) }
    try {
      if (modal === 'new') {
        const r = await api.post('/finanzas/oc-clientes', body)
        setRows(p => [r.data, ...p])
      } else {
        const r = await api.put(`/finanzas/oc-clientes/${modal.id}`, body)
        setRows(p => p.map(x => x.id === modal.id ? r.data : x))
      }
      setModal(null); setVinculando(null); setVinculandoPago(null)
    } catch (e) { alert(e.response?.data?.error || 'Error al guardar') }
    finally { setSaving(false) }
  }

  const eliminar = async r => {
    if (!confirm(`¿Eliminar la OC "${r.numero_oc}" de ${r.cliente}?`)) return
    try {
      await api.delete(`/finanzas/oc-clientes/${r.id}`)
      setRows(p => p.filter(x => x.id !== r.id))
    } catch (e) { alert(e.response?.data?.error || 'Error al eliminar') }
  }

  const sf = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const rowsFiltradas = rows.filter(r => {
    if (filtEst && estadoFila(r) !== filtEst) return false
    return true
  })

  return (
    <div className="flex-grow-1 d-flex flex-column overflow-hidden">
      {/* Barra superior */}
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <div className="d-flex gap-2 align-items-center flex-wrap">
          <input className="form-control form-control-sm" style={{ width: 220 }}
            placeholder="Buscar cliente, N° OC..."
            value={buscar} onChange={e => setBuscar(e.target.value)} />
          <select className="form-select form-select-sm" style={{ width: 170 }}
            value={filtEst} onChange={e => setFiltEst(e.target.value)}>
            <option value="">Todos los estados</option>
            {Object.entries(ESTADO_LABEL).map(([k, v]) =>
              <option key={k} value={k}>{v.txt}</option>
            )}
          </select>
          {(buscar || filtEst) && (
            <button className="btn btn-sm btn-outline-secondary py-0 px-2"
              onClick={() => { setBuscar(''); setFiltEst('') }}>
              <i className="bi bi-x" />
            </button>
          )}
          <span className="text-muted small">{rowsFiltradas.length} registros</span>
        </div>
        {canWrite && (
          <button className="btn btn-sm btn-primary" onClick={abrirNuevo}>
            <i className="bi bi-plus-lg me-1" />Nueva OC
          </button>
        )}
      </div>

      {/* Tabla */}
      <div className="flex-grow-1 overflow-auto">
        {loading ? (
          <div className="text-center py-5 text-muted"><span className="spinner-border spinner-border-sm me-2" />Cargando...</div>
        ) : rowsFiltradas.length === 0 ? (
          <div className="text-center py-5 text-muted">
            <i className="bi bi-file-earmark-text display-6 d-block mb-2" />Sin registros
          </div>
        ) : (
          <table className="table table-sm table-bordered align-middle mb-0" style={{ fontSize: '0.8rem' }}>
            <thead className="table-dark sticky-top" style={{ fontSize: '0.72rem' }}>
              <tr>
                <th style={{ width: 34 }} />
                <th style={{ minWidth: 140 }}>CLIENTE</th>
                <th style={{ minWidth: 130 }}>PROYECTO</th>
                <th style={{ minWidth: 120 }}>N° OC</th>
                <th style={{ minWidth: 110 }} className="text-end">MONTO OC</th>
                <th style={{ minWidth: 90 }}>F. OC</th>
                <th style={{ minWidth: 240 }}>CUOTAS</th>
                <th style={{ minWidth: 100 }}>ESTADO</th>
                {canWrite && <th style={{ width: 60 }} />}
              </tr>
            </thead>
            <tbody>
              {rowsFiltradas.map(r => {
                const est = estadoFila(r)
                const { txt, cls } = ESTADO_LABEL[est]
                const abierta = expandidas.has(r.id)
                return (
                  <Fragment key={r.id}>
                    <tr key={r.id} style={{ background: ROW_BG[est] }}>
                      <td className="text-center">
                        <button className="btn btn-sm btn-link p-0" onClick={() => toggleExpand(r.id)} title="Ver más detalle">
                          <i className={`bi bi-chevron-${abierta ? 'down' : 'right'}`} />
                        </button>
                      </td>
                      <td className="fw-semibold">
                        {r.cliente || '—'}
                        {!r.cli_nombre_cat && <span className="text-danger ms-1" title="Sin vincular a un cliente real">●</span>}
                      </td>
                      <td>
                        {r.proy_codigo
                          ? <span className="badge bg-secondary" style={{ fontSize: '0.7rem', fontFamily: 'monospace' }} title={r.proy_nombre}>{r.proy_codigo}</span>
                          : <span className="text-muted">—</span>}
                      </td>
                      <td className="fw-semibold text-primary">{r.numero_oc || '—'}</td>
                      <td className="text-end">{fmtUSD(r.monto_oc)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtF(r.fecha_oc)}</td>
                      <td>
                        <div className="d-flex flex-wrap gap-1">
                          {(r.cuotas || []).length === 0 ? <span className="text-muted">—</span> : r.cuotas.map(c => (
                            <span key={c.id}
                              className={`badge ${cuotaCobrada(c) ? 'bg-success' : c.factura_id ? 'bg-info text-dark' : 'bg-secondary'}`}
                              style={{ fontSize: '0.65rem' }}
                              title={c.factura_numero ? `Factura ${c.factura_numero} — ${fmtF(c.factura_fecha)}${cuotaCobrada(c) ? ` · Cobrada ${fmtF(fechaCobroCuota(c))}` : ''}` : 'Sin facturar todavía'}>
                              {TIPO_CUOTA_LABEL[c.tipo] || c.tipo} {c.pct !== null && c.pct !== '' && c.pct !== undefined ? `${c.pct}%` : ''}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td><span className={`badge ${cls}`} style={{ fontSize: '0.68rem' }}>{txt}</span></td>
                      {canWrite && (
                        <td>
                          <div className="d-flex gap-1">
                            <button className="btn btn-sm btn-outline-primary py-0 px-1" title="Editar" onClick={() => abrirEditar(r)}>
                              <i className="bi bi-pencil" />
                            </button>
                            <button className="btn btn-sm btn-outline-danger py-0 px-1" title="Eliminar" onClick={() => eliminar(r)}>
                              <i className="bi bi-trash" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                    {abierta && (
                      <tr>
                        <td colSpan={canWrite ? 9 : 8} className="bg-light">
                          <div className="row g-3 py-2 px-2" style={{ fontSize: '0.78rem' }}>
                            <div className="col-md-3">
                              <div className="text-muted" style={{ fontSize: '0.7rem' }}>RAZÓN SOCIAL / CUIT</div>
                              <div>{r.cli_nombre_cat || <span className="text-danger fst-italic">Sin vincular</span>} {r.cli_cuit_cat && <span className="font-monospace text-muted">({r.cli_cuit_cat})</span>}</div>
                            </div>
                            <div className="col-md-2">
                              <div className="text-muted" style={{ fontSize: '0.7rem' }}>F. RECEPCIÓN OC</div>
                              <div>{fmtF(r.fecha_recepcion_oc)}</div>
                            </div>
                            <div className="col-md-3">
                              <div className="text-muted" style={{ fontSize: '0.7rem' }}>PÓLIZA DE CAUCIÓN</div>
                              <div>
                                {r.numero_poliza || '—'}
                                {r.vigencia_poliza && <span className="text-muted"> · {r.vigencia_poliza}</span>}
                                {(r.fecha_pedido_poliza || r.fecha_poliza) && (
                                  <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                                    Pedida: {fmtF(r.fecha_pedido_poliza)} · Emitida: {fmtF(r.fecha_poliza)}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="col-md-2">
                              <div className="text-muted" style={{ fontSize: '0.7rem' }}>F. ENTREGA DOC.</div>
                              <div>{fmtF(r.fecha_entrega_doc)}</div>
                            </div>
                            <div className="col-md-2">
                              <div className="text-muted" style={{ fontSize: '0.7rem' }}>CIERRE ADMINISTRATIVO</div>
                              <div>{r.cierre_tipo || '—'} {r.fecha_cierre_admin && <span className="text-muted">({fmtF(r.fecha_cierre_admin)})</span>}</div>
                            </div>
                            {r.observaciones && (
                              <div className="col-md-6">
                                <div className="text-muted" style={{ fontSize: '0.7rem' }}>OBSERVACIONES</div>
                                <div>{r.observaciones}</div>
                              </div>
                            )}
                            {r.comentarios && (
                              <div className="col-md-6">
                                <div className="text-muted" style={{ fontSize: '0.7rem' }}>COMENTARIOS</div>
                                <div>{r.comentarios}</div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {modal && (
        <div className="modal d-block" style={{ background: 'rgba(0,0,0,.45)', zIndex: 1055 }}>
          <div className="modal-dialog modal-xl modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h6 className="modal-title fw-bold">
                  <i className="bi bi-file-earmark-text me-2" />
                  {modal === 'new' ? 'Nueva OC de Cliente' : `Editar OC — ${modal.numero_oc}`}
                </h6>
                <button className="btn-close btn-sm" onClick={() => { setModal(null); setVinculando(null); setVinculandoPago(null) }} />
              </div>
              <div className="modal-body" style={{ fontSize: '0.87rem' }}>

                {/* Datos generales */}
                <p className="small fw-semibold text-muted mb-2" style={{ letterSpacing: '0.05em' }}>DATOS DE LA OC</p>
                <div className="row g-2 mb-3">
                  <div className="col-md-4">
                    <label className="form-label small fw-semibold">Cliente (referencia) *</label>
                    <input className="form-control form-control-sm" value={form.cliente}
                      onChange={e => sf('cliente', e.target.value)} placeholder="Ej: ECOLAB TRANSPORTADORA" />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label small fw-semibold">
                      Cliente real (razón social)
                      {!form.cliente_id && <span className="text-danger ms-1" title="Sin vincular a un cliente real todavía">●</span>}
                    </label>
                    <ClienteSelector
                      value={form.cli_nombre_cat || ''}
                      onChange={c => setForm(p => ({ ...p, cliente_id: c.id, cli_nombre_cat: c.nombre, cli_cuit_cat: c.cuit }))}
                    />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label small fw-semibold">Proyecto</label>
                    <ProyectoSelector
                      value={form.proyecto}
                      onChange={p => setForm(f => ({ ...f, proyecto_id: p?.id || null, proyecto: p ? `${p.codigo} — ${p.nombre}` : '' }))}
                    />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-semibold">N° OC / Presupuesto *</label>
                    <input className="form-control form-control-sm" value={form.numero_oc}
                      onChange={e => sf('numero_oc', e.target.value)} placeholder="Ej: 4100010934" />
                  </div>
                  <div className="col-md-2">
                    <label className="form-label small fw-semibold">Monto OC (USD, neto sin IVA)</label>
                    <input type="number" onPaste={manejarPegadoNumero} className="form-control form-control-sm" value={form.monto_oc}
                      onChange={e => sf('monto_oc', e.target.value)} min="0" step="0.01" placeholder="0.00" />
                  </div>
                  <div className="col-md-2">
                    <label className="form-label small fw-semibold">Fecha OC</label>
                    <DateInput className="form-control form-control-sm" value={form.fecha_oc}
                      onChange={v => sf('fecha_oc', v)} />
                  </div>
                  <div className="col-md-2">
                    <label className="form-label small fw-semibold">F. Recepción OC</label>
                    <DateInput className="form-control form-control-sm" value={form.fecha_recepcion_oc}
                      onChange={v => sf('fecha_recepcion_oc', v)} />
                  </div>
                </div>

                <hr className="my-2" />
                <div className="d-flex align-items-center justify-content-between mb-2 flex-wrap gap-2">
                  <p className="small fw-semibold text-muted mb-0" style={{ letterSpacing: '0.05em' }}>CUOTAS DE FACTURACIÓN</p>
                  <div className="d-flex gap-1 flex-wrap">
                    <button type="button" className="btn btn-outline-secondary btn-sm py-0 px-2" style={{ fontSize: '0.7rem' }}
                      onClick={() => aplicarPreset('anticipo_resto')}>Anticipo + Resto</button>
                    <button type="button" className="btn btn-outline-secondary btn-sm py-0 px-2" style={{ fontSize: '0.7rem' }}
                      onClick={() => aplicarPreset('anticipo_avances')}>Anticipo + Avances</button>
                    <button type="button" className="btn btn-outline-secondary btn-sm py-0 px-2" style={{ fontSize: '0.7rem' }}
                      onClick={() => aplicarPreset('porcentajes')}>Todo en %</button>
                    <button type="button" className="btn btn-outline-secondary btn-sm py-0 px-2" style={{ fontSize: '0.7rem' }}
                      onClick={() => aplicarPreset('unico')}>Pago único</button>
                  </div>
                </div>

                <table className="table table-sm table-bordered align-middle mb-1" style={{ fontSize: '0.78rem' }}>
                  <thead className="table-light">
                    <tr>
                      <th style={{ width: 130 }}>Tipo</th>
                      <th style={{ width: 80 }} className="text-center">%</th>
                      <th style={{ width: 130 }} className="text-end">Monto planeado</th>
                      <th style={{ width: 120 }}>Fecha estimada</th>
                      <th>Factura vinculada</th>
                      <th style={{ width: 40 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {form.cuotas.map((c, idx) => {
                      const fi = facturaDeCuota(c)
                      return (
                        <tr key={idx}>
                          <td>
                            <select className="form-select form-select-sm" value={c.tipo} onChange={e => setCuota(idx, 'tipo', e.target.value)}>
                              {Object.entries(TIPO_CUOTA_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </select>
                          </td>
                          <td>
                            <input type="number" onPaste={manejarPegadoNumero} className="form-control form-control-sm text-center" value={c.pct}
                              onChange={e => setCuota(idx, 'pct', e.target.value)} min="0" max="100" step="1" />
                          </td>
                          <td>
                            <input type="number" onPaste={manejarPegadoNumero} className="form-control form-control-sm text-end" value={c.monto_planeado}
                              onChange={e => setCuota(idx, 'monto_planeado', e.target.value)} min="0" step="0.01" placeholder="0.00" />
                          </td>
                          <td>
                            <DateInput className="form-control form-control-sm" value={c.fecha_estimada}
                              onChange={v => setCuota(idx, 'fecha_estimada', v)} />
                          </td>
                          <td>
                            {fi ? (() => {
                              const pagosVinculados = c.pagos || []
                              // Un pago no puede quedar vinculado a más de una cuota — se excluyen acá
                              // los que ya están tomados por CUALQUIER cuota de esta misma OC.
                              const pagoIdsEnUso = form.cuotas.flatMap(cc => (cc.pagos || []).map(p => p.id))
                              const candidatos = (pagosPorFactura[c.factura_id] || []).filter(p => !pagoIdsEnUso.includes(p.id))
                              return (
                              <div className="d-flex flex-column gap-1" style={{ fontSize: '0.75rem' }}>
                                <div className="d-flex align-items-center gap-2 flex-wrap">
                                  <span className="fw-semibold text-primary">{fi.numero}</span>
                                  <span className="text-muted">{fmtF(fi.fecha)}</span>
                                  <span className="fw-semibold">{fmtMoneda(fi.importe, fi.moneda)}</span>
                                  <button type="button" className="btn btn-sm btn-outline-danger py-0 px-1" title="Desvincular la factura"
                                    onClick={() => desvincularFactura(idx)}>
                                    <i className="bi bi-x" />
                                  </button>
                                </div>
                                <div className="d-flex align-items-center gap-2 flex-wrap">
                                  {/* Una cuota puede cobrarse con VARIOS pagos combinados (ej. dos
                                      e-cheques + una transferencia por el total) — cada uno con su
                                      propia baja individual. */}
                                  {pagosVinculados.map(pg => (
                                    <span key={pg.id} className={`badge d-flex align-items-center gap-1 ${pg.estado === 'confirmado' ? 'bg-success' : 'bg-warning text-dark'}`} style={{ fontSize: '0.65rem' }}>
                                      {pg.estado === 'confirmado' ? 'Cobrado' : 'Pendiente'} {fmtF(pg.fecha_acreditacion || pg.fecha)} · {pg.forma_pago}{pg.entidad ? ` (${pg.entidad})` : ''} · {fmtMoneda(pg.importe, pg.moneda)}
                                      <i className="bi bi-x-circle" role="button" title="Quitar este pago"
                                        onClick={() => quitarPagoCuota(idx, pg.id)} />
                                    </span>
                                  ))}
                                  {vinculandoPago === idx ? (
                                    <div className="position-relative">
                                      {cargandoPagosDe === c.factura_id ? (
                                        <span className="spinner-border spinner-border-sm" />
                                      ) : candidatos.length === 0 ? (
                                        <span className="text-muted fst-italic" style={{ fontSize: '0.7rem' }}>
                                          {(pagosPorFactura[c.factura_id] || []).length === 0 ? 'Esta factura no tiene pagos registrados todavía' : 'No quedan más pagos sin vincular'}
                                        </span>
                                      ) : (
                                        <div className="border rounded bg-white shadow-sm" style={{ maxHeight: 140, overflowY: 'auto' }}>
                                          {candidatos.map(p => (
                                            <div key={p.id} className="d-flex align-items-center gap-2 px-2 py-1 border-bottom"
                                              style={{ cursor: 'pointer', fontSize: '0.72rem' }}
                                              onClick={() => agregarPagoCuota(idx, p)}>
                                              <span className={`badge ${p.estado === 'confirmado' ? 'bg-success' : 'bg-warning text-dark'}`} style={{ fontSize: '0.62rem' }}>{p.estado}</span>
                                              <span>{p.forma_pago}{p.entidad ? ` · ${p.entidad}` : ''}</span>
                                              <span className="fw-semibold">{fmtMoneda(p.importe, p.moneda)}</span>
                                              <span className="text-muted">{fmtF(p.fecha_acreditacion || p.fecha)}</span>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                      <button type="button" className="btn btn-sm btn-link py-0 px-1" onClick={() => setVinculandoPago(null)}>Listo</button>
                                    </div>
                                  ) : (
                                    <button type="button" className="btn btn-outline-primary btn-sm py-0 px-2" style={{ fontSize: '0.7rem' }}
                                      onClick={() => abrirVincularPago(idx, c.factura_id)}>
                                      {pagosVinculados.length ? '+ Agregar otro pago' : 'Vincular pago'}
                                    </button>
                                  )}
                                  {pagosVinculados.length === 0 && vinculandoPago !== idx && (
                                    c.fecha_cobro ? (
                                      <span className="badge bg-secondary d-flex align-items-center gap-1" style={{ fontSize: '0.65rem' }}>
                                        Cobro manual {fmtF(c.fecha_cobro)}
                                        <i className="bi bi-x-circle" role="button" onClick={() => setCuota(idx, 'fecha_cobro', '')} />
                                      </span>
                                    ) : (
                                      <DateInput className="form-control form-control-sm" style={{ width: 110 }}
                                        value={c.fecha_cobro} onChange={v => setCuota(idx, 'fecha_cobro', v)} placeholder="Cobro manual" />
                                    )
                                  )}
                                </div>
                              </div>
                              )
                            })() : vinculando === idx ? (
                              <div className="position-relative">
                                {!form.proyecto_id ? (
                                  <span className="text-muted fst-italic" style={{ fontSize: '0.72rem' }}>Elegí un proyecto arriba primero</span>
                                ) : facturasLoading ? (
                                  <span className="spinner-border spinner-border-sm" />
                                ) : facturasProyecto.length === 0 ? (
                                  <span className="text-muted fst-italic" style={{ fontSize: '0.72rem' }}>Sin facturas cargadas para este proyecto</span>
                                ) : (
                                  <div className="border rounded bg-white shadow-sm" style={{ maxHeight: 160, overflowY: 'auto' }}>
                                    {facturasProyecto.map(f => (
                                      <div key={f.id} className="d-flex align-items-center gap-2 px-2 py-1 border-bottom"
                                        style={{ cursor: 'pointer', fontSize: '0.75rem' }}
                                        onClick={() => vincularFactura(idx, f.id)}>
                                        <span className="fw-semibold text-primary">{f.numero}</span>
                                        <span className="text-muted">{fmtF(f.fecha)}</span>
                                        <span className="fw-semibold">{fmtMoneda(f.importe, f.moneda)}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                <button type="button" className="btn btn-sm btn-link py-0 px-1" onClick={() => setVinculando(null)}>Cancelar</button>
                              </div>
                            ) : (
                              <button type="button" className="btn btn-outline-primary btn-sm py-0 px-2" style={{ fontSize: '0.72rem' }}
                                onClick={() => setVinculando(idx)}>Vincular factura</button>
                            )}
                          </td>
                          <td>
                            <button type="button" className="btn btn-sm btn-outline-danger py-0 px-1" disabled={form.cuotas.length === 1}
                              onClick={() => quitarCuota(idx)}>
                              <i className="bi bi-trash" />
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <button type="button" className="btn btn-sm btn-outline-primary py-0 px-2" onClick={agregarCuota}>
                    <i className="bi bi-plus-lg me-1" />Agregar cuota
                  </button>
                  <span className={totalPct === 100 ? 'text-muted small' : 'text-danger small fw-semibold'}>
                    Total: {totalPct}% {totalPct !== 100 && <i className="bi bi-exclamation-triangle-fill ms-1" title="No suma 100%" />}
                  </span>
                </div>

                <hr className="my-2" />
                <p className="small fw-semibold text-muted mb-2" style={{ letterSpacing: '0.05em' }}>PÓLIZA DE CAUCIÓN</p>
                <div className="row g-2 mb-3">
                  <div className="col-md-3">
                    <label className="form-label small fw-semibold">N° Póliza</label>
                    <input className="form-control form-control-sm" value={form.numero_poliza}
                      onChange={e => sf('numero_poliza', e.target.value)} placeholder="Ej: 1585835" />
                  </div>
                  <div className="col-md-2">
                    <label className="form-label small fw-semibold">F. Pedido Póliza</label>
                    <DateInput className="form-control form-control-sm" value={form.fecha_pedido_poliza}
                      onChange={v => sf('fecha_pedido_poliza', v)} />
                  </div>
                  <div className="col-md-2">
                    <label className="form-label small fw-semibold">F. Póliza</label>
                    <DateInput className="form-control form-control-sm" value={form.fecha_poliza}
                      onChange={v => sf('fecha_poliza', v)} />
                  </div>
                  <div className="col-md-2">
                    <label className="form-label small fw-semibold">Vigencia</label>
                    <input className="form-control form-control-sm" value={form.vigencia_poliza}
                      onChange={e => sf('vigencia_poliza', e.target.value)} placeholder="Ej: 2 períodos" />
                  </div>
                  <div className="col-md-2">
                    <label className="form-label small fw-semibold">F. Entrega Doc.</label>
                    <DateInput className="form-control form-control-sm" value={form.fecha_entrega_doc}
                      onChange={v => sf('fecha_entrega_doc', v)} />
                  </div>
                </div>

                <hr className="my-2" />
                <p className="small fw-semibold text-muted mb-2" style={{ letterSpacing: '0.05em' }}>CIERRE ADMINISTRATIVO</p>
                <div className="row g-2 mb-3">
                  <div className="col-md-3">
                    <label className="form-label small fw-semibold">Cierre (remito, HES...)</label>
                    <input className="form-control form-control-sm" value={form.cierre_tipo}
                      onChange={e => sf('cierre_tipo', e.target.value)} placeholder="Ej: remito" />
                  </div>
                  <div className="col-md-2">
                    <label className="form-label small fw-semibold">F. Cierre Administrativo</label>
                    <DateInput className="form-control form-control-sm" value={form.fecha_cierre_admin}
                      onChange={v => sf('fecha_cierre_admin', v)} />
                  </div>
                </div>

                <hr className="my-2" />
                <div className="row g-2">
                  <div className="col-md-6">
                    <label className="form-label small fw-semibold">Observaciones</label>
                    <textarea className="form-control form-control-sm" rows={2} value={form.observaciones}
                      onChange={e => sf('observaciones', e.target.value)} />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small fw-semibold">Comentarios</label>
                    <textarea className="form-control form-control-sm" rows={2} value={form.comentarios}
                      onChange={e => sf('comentarios', e.target.value)} />
                  </div>
                </div>

              </div>
              <div className="modal-footer py-2">
                <button className="btn btn-sm btn-secondary" onClick={() => { setModal(null); setVinculando(null); setVinculandoPago(null) }}>Cancelar</button>
                <button className="btn btn-sm btn-primary" onClick={guardar} disabled={saving}>
                  {saving ? <><span className="spinner-border spinner-border-sm me-1" />Guardando...</> : 'Guardar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
