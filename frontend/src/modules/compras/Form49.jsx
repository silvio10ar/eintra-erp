import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'

const hoy  = () => new Date().toISOString().slice(0,10)
const fmtF = iso => iso ? iso.slice(0,10).split('-').reverse().join('/') : '—'

const ITEM_VACIO = { descripcion:'', cantidad:1, unidad:'UND.', n_parte:'', n_serie:'', n_lote:'' }
const FORM_VACIO = { proveedor_id:'', proveedor_nombre:'', fecha:hoy(), proyecto:'', autorizado_por:'', recibido_por:'', observaciones:'', items:[{ ...ITEM_VACIO }] }

export default function Form49({ canWrite, proveedores = [] }) {
  const [lista,     setLista]     = useState([])
  const [total,     setTotal]     = useState(0)
  const [page,      setPage]      = useState(1)
  const [cargando,  setCargando]  = useState(false)
  const [buscar,    setBuscar]    = useState('')
  const [modal,     setModal]     = useState(null)   // null | 'nuevo' | objeto
  const [form,      setForm]      = useState(FORM_VACIO)
  const [error,     setError]     = useState('')
  const [guardando, setGuardando] = useState(false)
  const [detalle,   setDetalle]   = useState(null)
  const [sugsP,     setSugsP]     = useState([])

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const params = { page, limit: 50 }
      if (buscar) params.buscar = buscar
      const { data } = await api.get('/compras/form49', { params })
      setLista(data.datos); setTotal(data.total)
    } catch (e) { console.error(e) }
    finally { setCargando(false) }
  }, [page, buscar])

  useEffect(() => { cargar() }, [cargar])

  const abrirNuevo = () => {
    setForm(FORM_VACIO)
    setError('')
    setSugsP([])
    setModal('nuevo')
  }

  const abrirEditar = async (f49) => {
    setCargando(true)
    try {
      const { data } = await api.get(`/compras/form49/${f49.id}`)
      setForm({
        proveedor_id:    data.proveedor_id || '',
        proveedor_nombre: data.proveedor_nombre || '',
        fecha:           data.fecha || hoy(),
        proyecto:        data.proyecto || '',
        autorizado_por:  data.autorizado_por || '',
        recibido_por:    data.recibido_por || '',
        observaciones:   data.observaciones || '',
        items: data.items?.length ? data.items.map(i => ({
          descripcion: i.descripcion, cantidad: i.cantidad, unidad: i.unidad,
          n_parte: i.n_parte, n_serie: i.n_serie, n_lote: i.n_lote,
        })) : [{ ...ITEM_VACIO }],
      })
      setError('')
      setSugsP([])
      setModal(data)
    } catch (e) { console.error(e) }
    finally { setCargando(false) }
  }

  const verDetalle = async (f49) => {
    try {
      const { data } = await api.get(`/compras/form49/${f49.id}`)
      setDetalle(data)
    } catch (e) { console.error(e) }
  }

  const guardar = async (e) => {
    e.preventDefault()
    if (!form.proveedor_nombre.trim()) { setError('Proveedor es obligatorio'); return }
    const itemsValidos = form.items.filter(i => i.descripcion.trim())
    if (!itemsValidos.length) { setError('Ingresá al menos un ítem con descripción'); return }
    setGuardando(true); setError('')
    try {
      const payload = { ...form, items: itemsValidos }
      if (modal === 'nuevo') {
        await api.post('/compras/form49', payload)
      } else {
        await api.put(`/compras/form49/${modal.id}`, payload)
      }
      setModal(null)
      cargar()
    } catch (e) {
      setError(e.response?.data?.error || 'Error al guardar')
    } finally { setGuardando(false) }
  }

  const eliminar = async (f49) => {
    if (!window.confirm(`¿Eliminar el Form 49 ${f49.numero}?`)) return
    try {
      await api.delete(`/compras/form49/${f49.id}`)
      cargar()
    } catch (e) { alert(e.response?.data?.error || 'Error') }
  }

  // ── Ítems helpers ──────────────────────────────────────────────────────
  const setItem = (idx, campo, valor) =>
    setForm(f => ({ ...f, items: f.items.map((it, i) => i === idx ? { ...it, [campo]: valor } : it) }))

  const addItem  = () => setForm(f => ({ ...f, items: [...f.items, { ...ITEM_VACIO }] }))
  const delItem  = (idx) => setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))

  // ── Autocomplete proveedor ─────────────────────────────────────────────
  const onProvChange = (val) => {
    setForm(f => ({ ...f, proveedor_nombre: val, proveedor_id: '' }))
    setSugsP(val.length > 1
      ? proveedores.filter(p => p.nombre.toLowerCase().includes(val.toLowerCase())).slice(0,8)
      : []
    )
  }
  const selProv = (p) => {
    setForm(f => ({ ...f, proveedor_id: p.id, proveedor_nombre: p.nombre }))
    setSugsP([])
  }

  const totalPages = Math.ceil(total / 50)

  return (
    <div>
      {/* ── Toolbar ── */}
      <div className="d-flex gap-2 mb-3 align-items-center flex-wrap">
        <h6 className="mb-0 fw-bold text-secondary">
          <i className="bi bi-box-arrow-in-down me-1" />
          Ingreso sin OC / Remito (Form 49)
        </h6>
        <input
          className="form-control form-control-sm ms-2"
          style={{ maxWidth: 260 }}
          placeholder="Buscar por N°, proveedor, proyecto..."
          value={buscar}
          onChange={e => { setBuscar(e.target.value); setPage(1) }}
        />
        <div className="ms-auto">
          {canWrite && (
            <button className="btn btn-sm btn-success" onClick={abrirNuevo}>
              <i className="bi bi-plus-lg me-1" />Nuevo Form 49
            </button>
          )}
        </div>
      </div>

      {/* ── Tabla ── */}
      <div className="table-responsive">
        <table className="table table-sm table-hover align-middle">
          <thead className="table-dark">
            <tr>
              <th>N°</th>
              <th>Fecha</th>
              <th>Proveedor</th>
              <th>Proyecto</th>
              <th>Ítems</th>
              <th>Autorizado por</th>
              <th>Recibido por</th>
              <th style={{ width: 90 }}></th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={8} className="text-center py-4 text-muted">
                <span className="spinner-border spinner-border-sm me-2" />Cargando...
              </td></tr>
            ) : lista.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-4 text-muted">Sin registros</td></tr>
            ) : lista.map(f => (
              <tr key={f.id} style={{ cursor: 'pointer' }} onClick={() => verDetalle(f)}>
                <td className="fw-semibold text-primary">{f.numero}</td>
                <td>{fmtF(f.fecha)}</td>
                <td>{f.proveedor_nombre || '—'}</td>
                <td>{f.proyecto || '—'}</td>
                <td className="text-center">{f.n_items || 0}</td>
                <td>{f.autorizado_por || '—'}</td>
                <td>{f.recibido_por || '—'}</td>
                <td onClick={e => e.stopPropagation()}>
                  {canWrite && (
                    <div className="d-flex gap-1 justify-content-end">
                      <button className="btn btn-outline-secondary btn-sm" title="Editar" onClick={() => abrirEditar(f)}>
                        <i className="bi bi-pencil" />
                      </button>
                      <button className="btn btn-outline-danger btn-sm" title="Eliminar" onClick={() => eliminar(f)}>
                        <i className="bi bi-trash" />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Paginación */}
      {totalPages > 1 && (
        <div className="d-flex gap-2 align-items-center mt-2">
          <button className="btn btn-sm btn-outline-secondary" disabled={page <= 1} onClick={() => setPage(p => p-1)}>
            <i className="bi bi-chevron-left" />
          </button>
          <span className="small">Pág {page} / {totalPages}</span>
          <button className="btn btn-sm btn-outline-secondary" disabled={page >= totalPages} onClick={() => setPage(p => p+1)}>
            <i className="bi bi-chevron-right" />
          </button>
          <span className="small text-muted ms-2">{total} registros</span>
        </div>
      )}

      {/* ══ MODAL DETALLE ════════════════════════════════════════════════ */}
      {detalle && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h5 className="modal-title">
                  <i className="bi bi-box-arrow-in-down me-2" />
                  {detalle.numero} — {detalle.proveedor_nombre}
                </h5>
                <button className="btn-close" onClick={() => setDetalle(null)} />
              </div>
              <div className="modal-body">
                <div className="row g-2 mb-3 small">
                  <div className="col-auto"><strong>Fecha:</strong> {fmtF(detalle.fecha)}</div>
                  {detalle.proyecto        && <div className="col-auto"><strong>Proyecto:</strong> {detalle.proyecto}</div>}
                  {detalle.autorizado_por  && <div className="col-auto"><strong>Autoriza:</strong> {detalle.autorizado_por}</div>}
                  {detalle.recibido_por    && <div className="col-auto"><strong>Recibe:</strong> {detalle.recibido_por}</div>}
                  {detalle.observaciones   && <div className="col-12 text-muted"><i>{detalle.observaciones}</i></div>}
                </div>
                <table className="table table-sm table-bordered" style={{ fontSize: '0.83rem' }}>
                  <thead className="table-light">
                    <tr>
                      <th>Descripción</th>
                      <th className="text-end">Cantidad</th>
                      <th>Unidad</th>
                      <th>N° Parte</th>
                      <th>N° Serie</th>
                      <th>N° Lote</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detalle.items || []).map((it, i) => (
                      <tr key={i}>
                        <td>{it.descripcion}</td>
                        <td className="text-end">{it.cantidad}</td>
                        <td>{it.unidad}</td>
                        <td>{it.n_parte || '—'}</td>
                        <td>{it.n_serie || '—'}</td>
                        <td>{it.n_lote  || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="modal-footer py-2">
                {canWrite && (
                  <button className="btn btn-outline-secondary btn-sm" onClick={() => { setDetalle(null); abrirEditar(detalle) }}>
                    <i className="bi bi-pencil me-1" />Editar
                  </button>
                )}
                <button className="btn btn-secondary btn-sm" onClick={() => setDetalle(null)}>Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ MODAL CREAR / EDITAR ══════════════════════════════════════════ */}
      {modal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-xl">
            <div className="modal-content">
              <form onSubmit={guardar}>
                <div className="modal-header py-2">
                  <h5 className="modal-title">
                    <i className="bi bi-box-arrow-in-down me-2" />
                    {modal === 'nuevo' ? 'Nuevo Ingreso (Form 49)' : `Editar ${modal.numero}`}
                  </h5>
                  <button type="button" className="btn-close" onClick={() => setModal(null)} />
                </div>
                <div className="modal-body">
                  {error && <div className="alert alert-danger py-2 small">{error}</div>}

                  {/* Cabecera */}
                  <div className="row g-2 mb-3">
                    <div className="col-md-4 position-relative">
                      <label className="form-label small fw-medium">Proveedor <span className="text-danger">*</span></label>
                      <input
                        className="form-control form-control-sm"
                        value={form.proveedor_nombre}
                        onChange={e => onProvChange(e.target.value)}
                        placeholder="Buscar proveedor..."
                        autoComplete="off"
                      />
                      {sugsP.length > 0 && (
                        <div className="border rounded shadow-sm position-absolute bg-white" style={{ zIndex: 9999, top: '100%', left: 0, right: 0, maxHeight: 180, overflowY: 'auto' }}>
                          {sugsP.map(p => (
                            <div key={p.id} className="px-2 py-1 small" style={{ cursor: 'pointer' }}
                              onMouseDown={() => selProv(p)}>
                              {p.nombre} {p.critico ? <span className="badge bg-danger ms-1">Crítico</span> : null}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="col-md-2">
                      <label className="form-label small fw-medium">Fecha</label>
                      <input type="date" className="form-control form-control-sm" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
                    </div>
                    <div className="col-md-3">
                      <label className="form-label small fw-medium">Proyecto</label>
                      <input className="form-control form-control-sm" value={form.proyecto} onChange={e => setForm(f => ({ ...f, proyecto: e.target.value }))} />
                    </div>
                    <div className="col-md-3">
                      <label className="form-label small fw-medium">Observaciones</label>
                      <input className="form-control form-control-sm" value={form.observaciones} onChange={e => setForm(f => ({ ...f, observaciones: e.target.value }))} />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label small fw-medium">Autorizado por</label>
                      <input className="form-control form-control-sm" value={form.autorizado_por} onChange={e => setForm(f => ({ ...f, autorizado_por: e.target.value }))} />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label small fw-medium">Recibido por</label>
                      <input className="form-control form-control-sm" value={form.recibido_por} onChange={e => setForm(f => ({ ...f, recibido_por: e.target.value }))} />
                    </div>
                  </div>

                  {/* Ítems */}
                  <div className="d-flex align-items-center mb-2">
                    <span className="fw-semibold small">Detalle de materiales</span>
                    <button type="button" className="btn btn-sm btn-outline-secondary ms-2" onClick={addItem}>
                      <i className="bi bi-plus" /> Agregar ítem
                    </button>
                  </div>
                  <div className="table-responsive">
                    <table className="table table-sm table-bordered" style={{ fontSize: '0.82rem' }}>
                      <thead className="table-light">
                        <tr>
                          <th style={{ minWidth: 220 }}>Descripción <span className="text-danger">*</span></th>
                          <th style={{ width: 80 }}>Cant.</th>
                          <th style={{ width: 80 }}>Unidad</th>
                          <th style={{ width: 120 }}>N° Parte</th>
                          <th style={{ width: 120 }}>N° Serie</th>
                          <th style={{ width: 120 }}>N° Lote</th>
                          <th style={{ width: 40 }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {form.items.map((it, idx) => (
                          <tr key={idx}>
                            <td>
                              <input className="form-control form-control-sm border-0" value={it.descripcion}
                                onChange={e => setItem(idx, 'descripcion', e.target.value)} />
                            </td>
                            <td>
                              <input type="number" className="form-control form-control-sm border-0 text-end" value={it.cantidad}
                                onChange={e => setItem(idx, 'cantidad', e.target.value)} min="0" step="any" />
                            </td>
                            <td>
                              <input className="form-control form-control-sm border-0" value={it.unidad}
                                onChange={e => setItem(idx, 'unidad', e.target.value)} />
                            </td>
                            <td>
                              <input className="form-control form-control-sm border-0" value={it.n_parte}
                                onChange={e => setItem(idx, 'n_parte', e.target.value)} />
                            </td>
                            <td>
                              <input className="form-control form-control-sm border-0" value={it.n_serie}
                                onChange={e => setItem(idx, 'n_serie', e.target.value)} />
                            </td>
                            <td>
                              <input className="form-control form-control-sm border-0" value={it.n_lote}
                                onChange={e => setItem(idx, 'n_lote', e.target.value)} />
                            </td>
                            <td className="text-center">
                              {form.items.length > 1 && (
                                <button type="button" className="btn btn-sm btn-link text-danger p-0" onClick={() => delItem(idx)}>
                                  <i className="bi bi-x-lg" />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="modal-footer py-2">
                  <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setModal(null)}>Cancelar</button>
                  <button type="submit" className="btn btn-success btn-sm" disabled={guardando}>
                    {guardando ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="bi bi-check-lg me-1" />}
                    Guardar
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
