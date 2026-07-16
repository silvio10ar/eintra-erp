import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'

const hoy = () => new Date().toISOString().slice(0, 10)
const fmtF = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—'
const VERIF = ['Pendiente', 'Conforme', 'No Conforme']
const itemVacio = () => ({ partida: '', nro_chapa: '', espesor: '', conf_a: 0, noconf_a: 0, conf_b: 0, noconf_b: 0, observacion: '', verificacion: 'Pendiente' })
const HDR0 = { hoja_ruta_id: '', fecha: hoy(), pintor: '', operador_granalla: '', observaciones: '' }

export default function FormGranallado({ hojasList = [], canWrite }) {
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
    api.get('/formularios/form21' + p).then(r => setRows(r.data)).finally(() => setLoad(false))
  }, [buscar])

  useEffect(() => { cargar() }, [cargar])

  const abrirNuevo = () => { setForm(HDR0); setItems([itemVacio()]); setModal('new'); setErr('') }
  const abrirEditar = async (row) => {
    const r = await api.get(`/formularios/form21/${row.id}`)
    setForm({ hoja_ruta_id: r.data.hoja_ruta_id||'', fecha: r.data.fecha, pintor: r.data.pintor, operador_granalla: r.data.operador_granalla, observaciones: r.data.observaciones })
    setItems(r.data.items.length ? r.data.items : [itemVacio()])
    setModal({ id: row.id }); setErr('')
  }
  const verDetalle = async (row) => {
    const r = await api.get(`/formularios/form21/${row.id}`)
    setDetalle(r.data)
  }

  const setItem = (i, k, v) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [k]: v } : it))
  const addItem = () => setItems(prev => [...prev, itemVacio()])
  const delItem = (i) => setItems(prev => prev.filter((_, idx) => idx !== i))

  const guardar = async () => {
    setSav(true); setErr('')
    try {
      const body = { ...form, items }
      if (modal === 'new') await api.post('/formularios/form21', body)
      else await api.put(`/formularios/form21/${modal.id}`, body)
      setModal(null); cargar()
    } catch(e) { setErr(e.response?.data?.error || 'Error al guardar') }
    finally { setSav(false) }
  }
  const eliminar = async (id) => {
    if (!confirm('¿Eliminar este registro?')) return
    await api.delete(`/formularios/form21/${id}`)
    cargar()
  }

  return (
    <div>
      <div className="d-flex flex-wrap gap-2 mb-3">
        <input className="form-control form-control-sm" style={{ width: 260 }} placeholder="Buscar número, pintor..." value={buscar} onChange={e => setBuscar(e.target.value)} onKeyDown={e => e.key === 'Enter' && cargar()} />
        <button className="btn btn-sm btn-outline-secondary" onClick={cargar}><i className="bi bi-arrow-clockwise" /></button>
        <div className="ms-auto">
          {canWrite && <button className="btn btn-sm btn-primary" onClick={abrirNuevo}><i className="bi bi-plus-lg me-1" />Nuevo F21</button>}
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
              <tr><th>Número</th><th>HR</th><th>Fecha</th><th>Pintor</th><th>Operador Granalla</th><th style={{ width: 80 }}>Items</th><th style={{ width: 80 }} /></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => verDetalle(r)}>
                  <td><span className="badge bg-light text-dark border">{r.numero}</span></td>
                  <td className="text-muted">{r.hr_numero || '—'}</td>
                  <td>{fmtF(r.fecha)}</td>
                  <td>{r.pintor || '—'}</td>
                  <td>{r.operador_granalla || '—'}</td>
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

      {/* Modal crear/editar */}
      {modal && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.5)' }}>
          <div className="modal-dialog modal-xl modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title"><i className="bi bi-droplet me-2 text-primary" />Control de Granallado (F21)</h5>
                <button className="btn-close" onClick={() => setModal(null)} />
              </div>
              <div className="modal-body">
                {err && <div className="alert alert-danger py-2">{err}</div>}
                <div className="row g-3 mb-3">
                  <div className="col-md-3">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Hoja de Ruta</label>
                    <select className="form-select form-select-sm" value={form.hoja_ruta_id} onChange={e => setForm(p => ({ ...p, hoja_ruta_id: e.target.value }))}>
                      <option value="">Sin HR</option>
                      {hojasList.map(h => <option key={h.id} value={h.id}>{h.numero}</option>)}
                    </select>
                  </div>
                  <div className="col-md-2">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Fecha</label>
                    <input type="date" className="form-control form-control-sm" value={form.fecha} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Pintor</label>
                    <input className="form-control form-control-sm" value={form.pintor} onChange={e => setForm(p => ({ ...p, pintor: e.target.value }))} />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Operador de Granalla</label>
                    <input className="form-control form-control-sm" value={form.operador_granalla} onChange={e => setForm(p => ({ ...p, operador_granalla: e.target.value }))} />
                  </div>
                </div>

                <div className="d-flex align-items-center justify-content-between mb-2">
                  <span className="fw-semibold" style={{ fontSize: '0.82rem' }}>Items de control</span>
                  <button className="btn btn-sm btn-outline-secondary py-0" onClick={addItem}><i className="bi bi-plus-lg me-1" />Agregar fila</button>
                </div>
                <div className="table-responsive">
                  <table className="table table-sm table-bordered align-middle" style={{ fontSize: '0.78rem' }}>
                    <thead className="table-light">
                      <tr>
                        <th style={{ width: 30 }}>#</th>
                        <th>Partida</th>
                        <th>N° Chapa/Caño</th>
                        <th style={{ width: 80 }}>Espesor</th>
                        <th style={{ width: 55 }}>C-A</th>
                        <th style={{ width: 55 }}>NC-A</th>
                        <th style={{ width: 55 }}>C-B</th>
                        <th style={{ width: 55 }}>NC-B</th>
                        <th>Observación</th>
                        <th style={{ width: 120 }}>Verificación</th>
                        <th style={{ width: 30 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it, i) => (
                        <tr key={i}>
                          <td className="text-center text-muted">{i + 1}</td>
                          <td><input className="form-control form-control-sm border-0" value={it.partida} onChange={e => setItem(i, 'partida', e.target.value)} /></td>
                          <td><input className="form-control form-control-sm border-0" value={it.nro_chapa} onChange={e => setItem(i, 'nro_chapa', e.target.value)} /></td>
                          <td><input className="form-control form-control-sm border-0" value={it.espesor} onChange={e => setItem(i, 'espesor', e.target.value)} /></td>
                          <td><input type="number" min="0" className="form-control form-control-sm border-0 text-center" value={it.conf_a} onChange={e => setItem(i, 'conf_a', +e.target.value)} /></td>
                          <td><input type="number" min="0" className="form-control form-control-sm border-0 text-center" value={it.noconf_a} onChange={e => setItem(i, 'noconf_a', +e.target.value)} /></td>
                          <td><input type="number" min="0" className="form-control form-control-sm border-0 text-center" value={it.conf_b} onChange={e => setItem(i, 'conf_b', +e.target.value)} /></td>
                          <td><input type="number" min="0" className="form-control form-control-sm border-0 text-center" value={it.noconf_b} onChange={e => setItem(i, 'noconf_b', +e.target.value)} /></td>
                          <td><input className="form-control form-control-sm border-0" value={it.observacion} onChange={e => setItem(i, 'observacion', e.target.value)} /></td>
                          <td>
                            <select className="form-select form-select-sm border-0" value={it.verificacion} onChange={e => setItem(i, 'verificacion', e.target.value)}>
                              {VERIF.map(v => <option key={v}>{v}</option>)}
                            </select>
                          </td>
                          <td><button className="btn btn-xs text-danger border-0" onClick={() => delItem(i)}><i className="bi bi-x" /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-2">
                  <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Observaciones generales</label>
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

      {/* Modal detalle */}
      {detalle && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.5)' }}>
          <div className="modal-dialog modal-xl modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title"><i className="bi bi-droplet me-2" />{detalle.numero} — Control de Granallado</h5>
                <button className="btn-close" onClick={() => setDetalle(null)} />
              </div>
              <div className="modal-body">
                <div className="row g-2 mb-3" style={{ fontSize: '0.83rem' }}>
                  <div className="col-auto"><span className="text-muted">Fecha:</span> <strong>{fmtF(detalle.fecha)}</strong></div>
                  <div className="col-auto"><span className="text-muted">Pintor:</span> <strong>{detalle.pintor||'—'}</strong></div>
                  <div className="col-auto"><span className="text-muted">Operador:</span> <strong>{detalle.operador_granalla||'—'}</strong></div>
                  {detalle.hr_numero && <div className="col-auto"><span className="text-muted">HR:</span> <strong>{detalle.hr_numero}</strong></div>}
                </div>
                <div className="table-responsive">
                  <table className="table table-sm table-bordered align-middle mb-0" style={{ fontSize: '0.8rem' }}>
                    <thead className="table-light">
                      <tr><th>#</th><th>Partida</th><th>N° Chapa/Caño</th><th>Espesor</th><th>C-A</th><th>NC-A</th><th>C-B</th><th>NC-B</th><th>Observación</th><th>Verificación</th></tr>
                    </thead>
                    <tbody>
                      {detalle.items.map(it => (
                        <tr key={it.id}>
                          <td className="text-center">{it.item}</td>
                          <td>{it.partida}</td><td>{it.nro_chapa}</td><td>{it.espesor}</td>
                          <td className="text-center">{it.conf_a}</td><td className="text-center text-danger">{it.noconf_a||''}</td>
                          <td className="text-center">{it.conf_b}</td><td className="text-center text-danger">{it.noconf_b||''}</td>
                          <td>{it.observacion}</td>
                          <td><span className={`badge bg-${it.verificacion==='Conforme'?'success':it.verificacion==='No Conforme'?'danger':'secondary'}`}>{it.verificacion}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {detalle.observaciones && <div className="mt-2 text-muted" style={{ fontSize: '0.82rem' }}><strong>Obs:</strong> {detalle.observaciones}</div>}
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
