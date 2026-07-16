import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'

const hoy = () => new Date().toISOString().slice(0, 10)
const fmtF = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—'
const itemVacio = () => ({ descripcion: '', codigo: '', cantidad: '' })
const HDR0 = { hoja_ruta_id: '', cliente: '', obra_oc: '', ubicacion: '', preparo: '', revisado: '', pallet: '', bulto: '', lista_nro: '', fecha: hoy(), observaciones: '' }

export default function FormPackingList({ hojasList = [], canWrite }) {
  const [rows, setRows]     = useState([])
  const [load, setLoad]     = useState(false)
  const [buscar, setBuscar] = useState('')
  const [modal, setModal]   = useState(null)
  const [form, setForm]     = useState(HDR0)
  const [items, setItems]   = useState([itemVacio()])
  const [sav, setSav]       = useState(false)
  const [err, setErr]       = useState('')
  const [detalle, setDetalle] = useState(null)

  const cargar = useCallback(() => {
    setLoad(true)
    const p = buscar ? `?buscar=${encodeURIComponent(buscar)}` : ''
    api.get('/formularios/packing' + p).then(r => setRows(r.data)).finally(() => setLoad(false))
  }, [buscar])

  useEffect(() => { cargar() }, [cargar])

  const abrirNuevo = () => { setForm(HDR0); setItems([itemVacio()]); setModal('new'); setErr('') }
  const abrirEditar = async (row) => {
    const r = await api.get(`/formularios/packing/${row.id}`)
    const d = r.data
    setForm({ hoja_ruta_id: d.hoja_ruta_id||'', cliente: d.cliente, obra_oc: d.obra_oc, ubicacion: d.ubicacion, preparo: d.preparo, revisado: d.revisado, pallet: d.pallet, bulto: d.bulto, lista_nro: d.lista_nro, fecha: d.fecha, observaciones: d.observaciones })
    setItems(d.items.length ? d.items : [itemVacio()])
    setModal({ id: row.id }); setErr('')
  }
  const verDetalle = async (row) => {
    const r = await api.get(`/formularios/packing/${row.id}`)
    setDetalle(r.data)
  }

  const setItem = (i, k, v) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [k]: v } : it))
  const addItem = () => setItems(prev => [...prev, itemVacio()])
  const delItem = (i) => setItems(prev => prev.filter((_, idx) => idx !== i))

  const guardar = async () => {
    setSav(true); setErr('')
    try {
      const body = { ...form, items: items.filter(it => it.descripcion.trim()) }
      if (modal === 'new') await api.post('/formularios/packing', body)
      else await api.put(`/formularios/packing/${modal.id}`, body)
      setModal(null); cargar()
    } catch(e) { setErr(e.response?.data?.error || 'Error al guardar') }
    finally { setSav(false) }
  }
  const eliminar = async (id) => {
    if (!confirm('¿Eliminar este Packing List?')) return
    await api.delete(`/formularios/packing/${id}`); cargar()
  }

  return (
    <div>
      <div className="d-flex flex-wrap gap-2 mb-3">
        <input className="form-control form-control-sm" style={{ width: 260 }} placeholder="Buscar número, cliente, OC..." value={buscar} onChange={e => setBuscar(e.target.value)} onKeyDown={e => e.key === 'Enter' && cargar()} />
        <button className="btn btn-sm btn-outline-secondary" onClick={cargar}><i className="bi bi-arrow-clockwise" /></button>
        <div className="ms-auto">
          {canWrite && <button className="btn btn-sm btn-primary" onClick={abrirNuevo}><i className="bi bi-plus-lg me-1" />Nuevo Packing List</button>}
        </div>
      </div>

      {load ? (
        <div className="text-center py-4 text-muted"><div className="spinner-border spinner-border-sm me-2" />Cargando...</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-5 text-muted"><i className="bi bi-inbox fs-1 d-block mb-2 opacity-25" />Sin registros</div>
      ) : (
        <div className="table-responsive">
          <table className="table table-hover table-sm align-middle mb-0" style={{ fontSize: '0.83rem' }}>
            <thead className="table-light">
              <tr><th>Número</th><th>HR</th><th>Cliente</th><th>Obra / OC</th><th>Fecha</th><th>Preparó</th><th style={{ width: 80 }}>Items</th><th style={{ width: 80 }} /></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => verDetalle(r)}>
                  <td><span className="badge bg-light text-dark border">{r.numero}</span></td>
                  <td className="text-muted">{r.hr_numero||'—'}</td>
                  <td>{r.cliente||'—'}</td>
                  <td>{r.obra_oc||'—'}</td>
                  <td>{fmtF(r.fecha)}</td>
                  <td>{r.preparo||'—'}</td>
                  <td className="text-center"><span className="badge bg-secondary">{r.total_items}</span></td>
                  <td onClick={e => e.stopPropagation()}>
                    <div className="d-flex gap-1 justify-content-end">
                      {canWrite && <button className="btn btn-xs btn-outline-primary py-0 px-1" style={{ fontSize: '0.75rem' }} onClick={() => abrirEditar(r)}><i className="bi bi-pencil" /></button>}
                      {canWrite && <button className="btn btn-xs btn-outline-danger py-0 px-1" style={{ fontSize: '0.75rem' }} onClick={() => eliminar(r.id)}><i className="bi bi-trash" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.5)' }}>
          <div className="modal-dialog modal-xl modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title"><i className="bi bi-box-seam me-2 text-primary" />Lista de Empaque — Packing List</h5>
                <button className="btn-close" onClick={() => setModal(null)} />
              </div>
              <div className="modal-body">
                {err && <div className="alert alert-danger py-2">{err}</div>}
                <div className="row g-2 mb-3">
                  <div className="col-md-3">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Hoja de Ruta</label>
                    <select className="form-select form-select-sm" value={form.hoja_ruta_id} onChange={e => setForm(p => ({ ...p, hoja_ruta_id: e.target.value }))}>
                      <option value="">Sin HR</option>
                      {hojasList.map(h => <option key={h.id} value={h.id}>{h.numero}</option>)}
                    </select>
                  </div>
                  <div className="col-md-3">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Cliente</label>
                    <input className="form-control form-control-sm" value={form.cliente} onChange={e => setForm(p => ({ ...p, cliente: e.target.value }))} />
                  </div>
                  <div className="col-md-2">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Obra / OC</label>
                    <input className="form-control form-control-sm" value={form.obra_oc} onChange={e => setForm(p => ({ ...p, obra_oc: e.target.value }))} />
                  </div>
                  <div className="col-md-2">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Ubicación</label>
                    <input className="form-control form-control-sm" value={form.ubicacion} onChange={e => setForm(p => ({ ...p, ubicacion: e.target.value }))} />
                  </div>
                  <div className="col-md-2">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Fecha</label>
                    <input type="date" className="form-control form-control-sm" value={form.fecha} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Preparó</label>
                    <input className="form-control form-control-sm" value={form.preparo} onChange={e => setForm(p => ({ ...p, preparo: e.target.value }))} />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Revisado</label>
                    <input className="form-control form-control-sm" value={form.revisado} onChange={e => setForm(p => ({ ...p, revisado: e.target.value }))} />
                  </div>
                  <div className="col-md-2">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Pallet</label>
                    <input className="form-control form-control-sm" value={form.pallet} onChange={e => setForm(p => ({ ...p, pallet: e.target.value }))} />
                  </div>
                  <div className="col-md-2">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Bulto</label>
                    <input className="form-control form-control-sm" value={form.bulto} onChange={e => setForm(p => ({ ...p, bulto: e.target.value }))} />
                  </div>
                  <div className="col-md-2">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Lista N°</label>
                    <input className="form-control form-control-sm" value={form.lista_nro} onChange={e => setForm(p => ({ ...p, lista_nro: e.target.value }))} />
                  </div>
                </div>

                <div className="d-flex align-items-center justify-content-between mb-2">
                  <span className="fw-semibold" style={{ fontSize: '0.82rem' }}>Componentes</span>
                  <button className="btn btn-sm btn-outline-secondary py-0" onClick={addItem}><i className="bi bi-plus-lg me-1" />Agregar</button>
                </div>
                <div className="table-responsive">
                  <table className="table table-sm table-bordered align-middle" style={{ fontSize: '0.8rem' }}>
                    <thead className="table-light">
                      <tr><th style={{ width: 30 }}>#</th><th>Descripción de los componentes</th><th style={{ width: 130 }}>Código</th><th style={{ width: 100 }}>Cantidad</th><th style={{ width: 30 }} /></tr>
                    </thead>
                    <tbody>
                      {items.map((it, i) => (
                        <tr key={i}>
                          <td className="text-center text-muted">{i + 1}</td>
                          <td><input className="form-control form-control-sm border-0" value={it.descripcion} onChange={e => setItem(i, 'descripcion', e.target.value)} /></td>
                          <td><input className="form-control form-control-sm border-0" value={it.codigo} onChange={e => setItem(i, 'codigo', e.target.value)} /></td>
                          <td><input className="form-control form-control-sm border-0 text-center" value={it.cantidad} onChange={e => setItem(i, 'cantidad', e.target.value)} /></td>
                          <td><button className="btn btn-xs text-danger border-0" onClick={() => delItem(i)}><i className="bi bi-x" /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2">
                  <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Observaciones</label>
                  <textarea className="form-control form-control-sm" rows={2} value={form.observaciones} onChange={e => setForm(p => ({ ...p, observaciones: e.target.value }))} />
                </div>
              </div>
              <div className="modal-footer">
                <button className="btn btn-sm btn-secondary" onClick={() => setModal(null)}>Cancelar</button>
                <button className="btn btn-sm btn-primary" onClick={guardar} disabled={sav}>
                  {sav ? <span className="spinner-border spinner-border-sm me-1" /> : null}Guardar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {detalle && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.5)' }}>
          <div className="modal-dialog modal-lg modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title"><i className="bi bi-box-seam me-2" />{detalle.numero}</h5>
                <button className="btn-close" onClick={() => setDetalle(null)} />
              </div>
              <div className="modal-body">
                <div className="row g-2 mb-3" style={{ fontSize: '0.83rem' }}>
                  <div className="col-auto"><span className="text-muted">Cliente:</span> <strong>{detalle.cliente||'—'}</strong></div>
                  <div className="col-auto"><span className="text-muted">Obra/OC:</span> <strong>{detalle.obra_oc||'—'}</strong></div>
                  <div className="col-auto"><span className="text-muted">Fecha:</span> <strong>{fmtF(detalle.fecha)}</strong></div>
                  {detalle.preparo && <div className="col-auto"><span className="text-muted">Preparó:</span> <strong>{detalle.preparo}</strong></div>}
                  {detalle.revisado && <div className="col-auto"><span className="text-muted">Revisó:</span> <strong>{detalle.revisado}</strong></div>}
                  {detalle.pallet && <div className="col-auto"><span className="text-muted">Pallet:</span> <strong>{detalle.pallet}</strong></div>}
                  {detalle.bulto && <div className="col-auto"><span className="text-muted">Bulto:</span> <strong>{detalle.bulto}</strong></div>}
                </div>
                <table className="table table-sm table-bordered mb-0" style={{ fontSize: '0.82rem' }}>
                  <thead className="table-light"><tr><th>#</th><th>Descripción</th><th>Código</th><th>Cantidad</th></tr></thead>
                  <tbody>
                    {detalle.items.map((it, i) => (
                      <tr key={it.id}><td className="text-center text-muted">{i+1}</td><td>{it.descripcion}</td><td>{it.codigo||'—'}</td><td className="text-center">{it.cantidad}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="modal-footer">
                {canWrite && <button className="btn btn-sm btn-outline-primary" onClick={() => { setDetalle(null); abrirEditar(detalle) }}>Editar</button>}
                <button className="btn btn-sm btn-secondary" onClick={() => setDetalle(null)}>Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
