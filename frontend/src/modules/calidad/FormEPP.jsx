import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'

const hoy = () => new Date().toISOString().slice(0, 10)
const fmtF = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—'
const itemVacio = () => ({ producto: '', tipo_modelo: '', marca: '', certificacion: false, cantidad: 1, fecha_entrega: hoy() })
const HDR0 = { empleado: '', dni: '', puesto: '', fecha: hoy(), observaciones: '' }

export default function FormEPP({ canWrite }) {
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
    api.get('/formularios/epp' + p).then(r => setRows(r.data)).finally(() => setLoad(false))
  }, [buscar])

  useEffect(() => { cargar() }, [cargar])

  const abrirNuevo = () => { setForm(HDR0); setItems([itemVacio()]); setModal('new'); setErr('') }
  const abrirEditar = async (row) => {
    const r = await api.get(`/formularios/epp/${row.id}`)
    const d = r.data
    setForm({ empleado: d.empleado, dni: d.dni, puesto: d.puesto, fecha: d.fecha, observaciones: d.observaciones })
    setItems(d.items.length ? d.items.map(it => ({ ...it, certificacion: !!it.certificacion })) : [itemVacio()])
    setModal({ id: row.id }); setErr('')
  }
  const verDetalle = async (row) => {
    const r = await api.get(`/formularios/epp/${row.id}`)
    setDetalle(r.data)
  }

  const setItem = (i, k, v) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [k]: v } : it))
  const addItem = () => setItems(prev => [...prev, itemVacio()])
  const delItem = (i) => setItems(prev => prev.filter((_, idx) => idx !== i))

  const guardar = async () => {
    if (!form.empleado.trim()) { setErr('El nombre del empleado es requerido'); return }
    setSav(true); setErr('')
    try {
      const body = { ...form, items: items.filter(it => it.producto.trim()) }
      if (modal === 'new') await api.post('/formularios/epp', body)
      else await api.put(`/formularios/epp/${modal.id}`, body)
      setModal(null); cargar()
    } catch(e) { setErr(e.response?.data?.error || 'Error al guardar') }
    finally { setSav(false) }
  }
  const eliminar = async (id) => {
    if (!confirm('¿Eliminar este registro?')) return
    await api.delete(`/formularios/epp/${id}`); cargar()
  }

  return (
    <div>
      <div className="d-flex flex-wrap gap-2 mb-3">
        <input className="form-control form-control-sm" style={{ width: 260 }} placeholder="Buscar número, empleado, DNI..." value={buscar} onChange={e => setBuscar(e.target.value)} onKeyDown={e => e.key === 'Enter' && cargar()} />
        <button className="btn btn-sm btn-outline-secondary" onClick={cargar}><i className="bi bi-arrow-clockwise" /></button>
        <div className="ms-auto">
          {canWrite && <button className="btn btn-sm btn-primary" onClick={abrirNuevo}><i className="bi bi-plus-lg me-1" />Nueva entrega EPP</button>}
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
              <tr><th>Número</th><th>Empleado</th><th>DNI</th><th>Puesto</th><th>Fecha</th><th style={{ width: 80 }}>Items</th><th style={{ width: 80 }} /></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => verDetalle(r)}>
                  <td><span className="badge bg-light text-dark border">{r.numero}</span></td>
                  <td className="fw-semibold">{r.empleado}</td>
                  <td className="text-muted">{r.dni||'—'}</td>
                  <td>{r.puesto||'—'}</td>
                  <td>{fmtF(r.fecha)}</td>
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
                <h5 className="modal-title"><i className="bi bi-shield-check me-2 text-primary" />Entrega de EPP</h5>
                <button className="btn-close" onClick={() => setModal(null)} />
              </div>
              <div className="modal-body">
                {err && <div className="alert alert-danger py-2">{err}</div>}
                <div className="row g-2 mb-3">
                  <div className="col-md-4">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Empleado <span className="text-danger">*</span></label>
                    <input className="form-control form-control-sm" value={form.empleado} onChange={e => setForm(p => ({ ...p, empleado: e.target.value }))} />
                  </div>
                  <div className="col-md-2">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>DNI</label>
                    <input className="form-control form-control-sm" value={form.dni} onChange={e => setForm(p => ({ ...p, dni: e.target.value }))} />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Puesto</label>
                    <input className="form-control form-control-sm" value={form.puesto} onChange={e => setForm(p => ({ ...p, puesto: e.target.value }))} />
                  </div>
                  <div className="col-md-2">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Fecha</label>
                    <input type="date" className="form-control form-control-sm" value={form.fecha} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} />
                  </div>
                </div>

                <div className="d-flex align-items-center justify-content-between mb-2">
                  <span className="fw-semibold" style={{ fontSize: '0.82rem' }}>Elementos entregados</span>
                  <button className="btn btn-sm btn-outline-secondary py-0" onClick={addItem}><i className="bi bi-plus-lg me-1" />Agregar</button>
                </div>
                <div className="table-responsive">
                  <table className="table table-sm table-bordered align-middle" style={{ fontSize: '0.78rem' }}>
                    <thead className="table-light">
                      <tr>
                        <th style={{ width: 30 }}>#</th>
                        <th>Producto</th>
                        <th style={{ width: 150 }}>Tipo / Modelo</th>
                        <th style={{ width: 120 }}>Marca</th>
                        <th style={{ width: 70 }}>Certif.</th>
                        <th style={{ width: 70 }}>Cant.</th>
                        <th style={{ width: 130 }}>Fecha entrega</th>
                        <th style={{ width: 30 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it, i) => (
                        <tr key={i}>
                          <td className="text-center text-muted">{i + 1}</td>
                          <td><input className="form-control form-control-sm border-0" value={it.producto} onChange={e => setItem(i, 'producto', e.target.value)} /></td>
                          <td><input className="form-control form-control-sm border-0" value={it.tipo_modelo} onChange={e => setItem(i, 'tipo_modelo', e.target.value)} /></td>
                          <td><input className="form-control form-control-sm border-0" value={it.marca} onChange={e => setItem(i, 'marca', e.target.value)} /></td>
                          <td className="text-center">
                            <div className="form-check d-flex justify-content-center mb-0">
                              <input type="checkbox" className="form-check-input" checked={!!it.certificacion} onChange={e => setItem(i, 'certificacion', e.target.checked)} />
                            </div>
                          </td>
                          <td><input type="number" min="1" className="form-control form-control-sm border-0 text-center" value={it.cantidad} onChange={e => setItem(i, 'cantidad', +e.target.value)} /></td>
                          <td><input type="date" className="form-control form-control-sm border-0" style={{ fontSize: '0.76rem' }} value={it.fecha_entrega} onChange={e => setItem(i, 'fecha_entrega', e.target.value)} /></td>
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
                <h5 className="modal-title"><i className="bi bi-shield-check me-2" />{detalle.numero}</h5>
                <button className="btn-close" onClick={() => setDetalle(null)} />
              </div>
              <div className="modal-body">
                <div className="mb-3" style={{ fontSize: '0.83rem' }}>
                  <strong>{detalle.empleado}</strong>
                  {detalle.dni && <span className="text-muted ms-2">DNI: {detalle.dni}</span>}
                  {detalle.puesto && <span className="text-muted ms-2">· {detalle.puesto}</span>}
                  <span className="text-muted ms-2">· {fmtF(detalle.fecha)}</span>
                </div>
                <table className="table table-sm table-bordered mb-0" style={{ fontSize: '0.82rem' }}>
                  <thead className="table-light"><tr><th>#</th><th>Producto</th><th>Tipo/Modelo</th><th>Marca</th><th>Cert.</th><th>Cant.</th><th>F. Entrega</th></tr></thead>
                  <tbody>
                    {detalle.items.map((it, i) => (
                      <tr key={it.id}>
                        <td className="text-center text-muted">{i+1}</td>
                        <td>{it.producto}</td><td>{it.tipo_modelo||'—'}</td><td>{it.marca||'—'}</td>
                        <td className="text-center">{it.certificacion ? <i className="bi bi-check-circle-fill text-success" /> : <i className="bi bi-x-circle text-muted" />}</td>
                        <td className="text-center">{it.cantidad}</td>
                        <td>{fmtF(it.fecha_entrega)}</td>
                      </tr>
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
