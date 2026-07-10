import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'
import DateInput from '../../components/DateInput'

const fmtF = s => {
  if (!s) return '—'
  const d = new Date(s + 'T00:00:00')
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const fmtUSD = n => {
  const v = parseFloat(n)
  if (!v || isNaN(v)) return '—'
  return 'USD ' + v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const FORM_VACIO = {
  cliente_id: null, cliente: '',
  numero_oc: '', monto_oc: '', fecha_oc: '', fecha_recepcion_oc: '',
  anticipo_pct: '', monto_anticipo_usd: '', fecha_fact_anticipo: '', fecha_pago_anticipo: '',
  numero_poliza: '', fecha_pedido_poliza: '', fecha_poliza: '', vigencia_poliza: '', fecha_entrega_doc: '',
  observaciones: '', final_pct: '', monto_final_usd: '', fecha_fact_final: '',
  cierre_tipo: '', fecha_cierre_admin: '', comentarios: '',
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

function estadoFila(r) {
  if (r.fecha_cierre_admin) return 'cerrada'
  if (r.fecha_fact_final)   return 'final_facturado'
  if (r.fecha_pago_anticipo) return 'anticipo_cobrado'
  if (r.fecha_fact_anticipo) return 'anticipo_facturado'
  return 'pendiente'
}

const ESTADO_LABEL = {
  cerrada:           { txt: 'Cerrada',           cls: 'bg-success' },
  final_facturado:   { txt: 'Final fact.',        cls: 'bg-primary' },
  anticipo_cobrado:  { txt: 'Anticipo cobrado',   cls: 'bg-info text-dark' },
  anticipo_facturado:{ txt: 'Anticipo fact.',     cls: 'bg-warning text-dark' },
  pendiente:         { txt: 'Pendiente',          cls: 'bg-secondary' },
}

const ROW_BG = {
  cerrada:            '#f0fff4',
  final_facturado:    '#eef4ff',
  anticipo_cobrado:   '#f0fbff',
  anticipo_facturado: '#fffbea',
  pendiente:          '',
}

export default function FinanzasOCClientes({ canWrite }) {
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(false)
  const [buscar,  setBuscar]  = useState('')
  const [filtEst, setFiltEst] = useState('')
  const [modal,   setModal]   = useState(null)  // null | 'new' | objeto
  const [form,    setForm]    = useState(FORM_VACIO)
  const [saving,  setSaving]  = useState(false)

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const p = {}
      if (buscar) p.buscar = buscar
      const r = await api.get('/finanzas/oc-clientes', { params: p })
      setRows(r.data)
    } finally { setLoading(false) }
  }, [buscar])

  useEffect(() => { cargar() }, [cargar])

  const abrirNuevo = () => { setForm(FORM_VACIO); setModal('new') }
  const abrirEditar = r => { setForm({ ...FORM_VACIO, ...r, cliente_id: r.cliente_id || null }); setModal(r) }

  const guardar = async () => {
    if ((!form.cliente_id && !form.cliente.trim()) || !form.numero_oc.trim()) return alert('Cliente y N° OC son requeridos')
    setSaving(true)
    try {
      if (modal === 'new') {
        const r = await api.post('/finanzas/oc-clientes', form)
        setRows(p => [r.data, ...p])
      } else {
        const r = await api.put(`/finanzas/oc-clientes/${modal.id}`, form)
        setRows(p => p.map(x => x.id === modal.id ? r.data : x))
      }
      setModal(null)
    } catch (e) { alert(e.response?.data?.error || 'Error al guardar') }
    finally { setSaving(false) }
  }

  const eliminar = async r => {
    if (!confirm(`¿Eliminar la OC "${r.numero_oc}" de ${r.cliente}?`)) return
    await api.delete(`/finanzas/oc-clientes/${r.id}`)
    setRows(p => p.filter(x => x.id !== r.id))
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
          <table className="table table-sm table-bordered align-middle" style={{ fontSize: '0.78rem', minWidth: 1600 }}>
            <thead className="table-dark sticky-top" style={{ fontSize: '0.72rem' }}>
              <tr>
                <th style={{ minWidth: 130 }}>CLIENTE</th>
                <th style={{ minWidth: 120 }}>N° OC</th>
                <th style={{ minWidth: 110 }} className="text-end">MONTO OC</th>
                <th style={{ minWidth: 90 }}>F. OC</th>
                <th style={{ minWidth: 90 }}>F. RECEP.</th>
                <th className="text-center" style={{ minWidth: 55 }}>ANT %</th>
                <th style={{ minWidth: 100 }} className="text-end">MONTO ANT.</th>
                <th style={{ minWidth: 90 }}>F. FACT ANT.</th>
                <th style={{ minWidth: 90 }}>F. PAGO ANT.</th>
                <th style={{ minWidth: 100 }}>N° PÓLIZA</th>
                <th style={{ minWidth: 90 }}>F. PED. PÓL.</th>
                <th style={{ minWidth: 90 }}>F. PÓLIZA</th>
                <th style={{ minWidth: 80 }}>VIGENCIA</th>
                <th style={{ minWidth: 90 }}>F. ENTREGA DOC.</th>
                <th style={{ minWidth: 160 }}>OBSERVACIONES</th>
                <th className="text-center" style={{ minWidth: 55 }}>FIN %</th>
                <th style={{ minWidth: 100 }} className="text-end">MONTO FIN.</th>
                <th style={{ minWidth: 90 }}>F. FACT FIN.</th>
                <th style={{ minWidth: 100 }}>CIERRE</th>
                <th style={{ minWidth: 90 }}>F. CIERRE ADM.</th>
                <th style={{ minWidth: 160 }}>COMENTARIOS</th>
                <th style={{ minWidth: 90 }}>ESTADO</th>
                {canWrite && <th style={{ width: 60 }} />}
              </tr>
            </thead>
            <tbody>
              {rowsFiltradas.map(r => {
                const est = estadoFila(r)
                const { txt, cls } = ESTADO_LABEL[est]
                return (
                  <tr key={r.id} style={{ background: ROW_BG[est] }}>
                    <td className="fw-semibold">{r.cliente || '—'}</td>
                    <td className="fw-semibold text-primary">{r.numero_oc || '—'}</td>
                    <td className="text-end">{fmtUSD(r.monto_oc)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtF(r.fecha_oc)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtF(r.fecha_recepcion_oc)}</td>
                    <td className="text-center">{r.anticipo_pct != null ? `${r.anticipo_pct}%` : '—'}</td>
                    <td className="text-end">{fmtUSD(r.monto_anticipo_usd)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtF(r.fecha_fact_anticipo)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtF(r.fecha_pago_anticipo)}</td>
                    <td>{r.numero_poliza || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtF(r.fecha_pedido_poliza)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtF(r.fecha_poliza)}</td>
                    <td>{r.vigencia_poliza || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtF(r.fecha_entrega_doc)}</td>
                    <td style={{ maxWidth: 200 }} title={r.observaciones}>{r.observaciones || '—'}</td>
                    <td className="text-center">{r.final_pct != null ? `${r.final_pct}%` : '—'}</td>
                    <td className="text-end">{fmtUSD(r.monto_final_usd)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtF(r.fecha_fact_final)}</td>
                    <td>{r.cierre_tipo || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtF(r.fecha_cierre_admin)}</td>
                    <td style={{ maxWidth: 200 }} title={r.comentarios}>{r.comentarios || '—'}</td>
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
                <button className="btn-close btn-sm" onClick={() => setModal(null)} />
              </div>
              <div className="modal-body" style={{ fontSize: '0.87rem' }}>

                {/* Datos generales */}
                <p className="small fw-semibold text-muted mb-2" style={{ letterSpacing: '0.05em' }}>DATOS DE LA OC</p>
                <div className="row g-2 mb-3">
                  <div className="col-md-4">
                    <label className="form-label small fw-semibold">Cliente *</label>
                    <ClienteSelector
                      value={form.cliente}
                      onChange={c => setForm(p => ({ ...p, cliente_id: c.id, cliente: c.nombre }))}
                    />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-semibold">N° OC / Presupuesto *</label>
                    <input className="form-control form-control-sm" value={form.numero_oc}
                      onChange={e => sf('numero_oc', e.target.value)} placeholder="Ej: 4100010934" />
                  </div>
                  <div className="col-md-2">
                    <label className="form-label small fw-semibold">Monto OC (USD + IVA)</label>
                    <input type="number" className="form-control form-control-sm" value={form.monto_oc}
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
                <p className="small fw-semibold text-muted mb-2" style={{ letterSpacing: '0.05em' }}>ANTICIPO</p>
                <div className="row g-2 mb-3">
                  <div className="col-md-2">
                    <label className="form-label small fw-semibold">Anticipo %</label>
                    <input type="number" className="form-control form-control-sm" value={form.anticipo_pct}
                      onChange={e => sf('anticipo_pct', e.target.value)} min="0" max="100" step="1" placeholder="Ej: 30" />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-semibold">Monto Anticipo USD</label>
                    <input type="number" className="form-control form-control-sm" value={form.monto_anticipo_usd}
                      onChange={e => sf('monto_anticipo_usd', e.target.value)} min="0" step="0.01" placeholder="0.00" />
                  </div>
                  <div className="col-md-2">
                    <label className="form-label small fw-semibold">F. Fact. Anticipo</label>
                    <DateInput className="form-control form-control-sm" value={form.fecha_fact_anticipo}
                      onChange={v => sf('fecha_fact_anticipo', v)} />
                  </div>
                  <div className="col-md-2">
                    <label className="form-label small fw-semibold">F. Pago Anticipo</label>
                    <DateInput className="form-control form-control-sm" value={form.fecha_pago_anticipo}
                      onChange={v => sf('fecha_pago_anticipo', v)} />
                  </div>
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
                <p className="small fw-semibold text-muted mb-2" style={{ letterSpacing: '0.05em' }}>FACTURACIÓN FINAL Y CIERRE</p>
                <div className="row g-2 mb-3">
                  <div className="col-md-2">
                    <label className="form-label small fw-semibold">Final %</label>
                    <input type="number" className="form-control form-control-sm" value={form.final_pct}
                      onChange={e => sf('final_pct', e.target.value)} min="0" max="100" step="1" placeholder="Ej: 70" />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-semibold">Monto Final USD</label>
                    <input type="number" className="form-control form-control-sm" value={form.monto_final_usd}
                      onChange={e => sf('monto_final_usd', e.target.value)} min="0" step="0.01" placeholder="0.00" />
                  </div>
                  <div className="col-md-2">
                    <label className="form-label small fw-semibold">F. Fact. Final</label>
                    <DateInput className="form-control form-control-sm" value={form.fecha_fact_final}
                      onChange={v => sf('fecha_fact_final', v)} />
                  </div>
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
                <button className="btn btn-sm btn-secondary" onClick={() => setModal(null)}>Cancelar</button>
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
