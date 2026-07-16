import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'

const hoy = () => new Date().toISOString().slice(0, 10)
const fmtF = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—'
const LADOS  = ['Externo', 'Interno']
const OK_OPT = ['', 'OK', 'NO OK']
const itemVacio = () => ({ nro_chapa: '', codigo: '', lado: 'Externo', u_long_der: '', u_long_izq: '', u_trans_der: '', u_trans_izq: '', observacion: '' })
const HDR0 = { hoja_ruta_id: '', proyecto: '', oc: '', fecha: hoy(), soldador: '', observaciones: '' }

export default function FormSoldadura({ hojasList = [], canWrite }) {
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
    api.get('/formularios/form34' + p).then(r => setRows(r.data)).finally(() => setLoad(false))
  }, [buscar])

  useEffect(() => { cargar() }, [cargar])

  const abrirNuevo = () => { setForm(HDR0); setItems([itemVacio()]); setModal('new'); setErr('') }
  const abrirEditar = async (row) => {
    const r = await api.get(`/formularios/form34/${row.id}`)
    const d = r.data
    setForm({ hoja_ruta_id: d.hoja_ruta_id||'', proyecto: d.proyecto, oc: d.oc, fecha: d.fecha, soldador: d.soldador, observaciones: d.observaciones })
    setItems(d.items.length ? d.items : [itemVacio()])
    setModal({ id: row.id }); setErr('')
  }
  const verDetalle = async (row) => {
    const r = await api.get(`/formularios/form34/${row.id}`)
    setDetalle(r.data)
  }

  const setItem = (i, k, v) => setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [k]: v } : it))
  const addItem = () => setItems(prev => [...prev, itemVacio()])
  const delItem = (i) => setItems(prev => prev.filter((_, idx) => idx !== i))

  const guardar = async () => {
    setSav(true); setErr('')
    try {
      const body = { ...form, items }
      if (modal === 'new') await api.post('/formularios/form34', body)
      else await api.put(`/formularios/form34/${modal.id}`, body)
      setModal(null); cargar()
    } catch(e) { setErr(e.response?.data?.error || 'Error al guardar') }
    finally { setSav(false) }
  }
  const eliminar = async (id) => {
    if (!confirm('¿Eliminar este registro?')) return
    await api.delete(`/formularios/form34/${id}`); cargar()
  }

  const OkCell = ({ val, onChange }) => (
    <select className="form-select form-select-sm border-0 text-center p-0" style={{ fontSize: '0.75rem', background: val==='OK'?'#d1e7dd':val==='NO OK'?'#f8d7da':'' }} value={val} onChange={e => onChange(e.target.value)}>
      {OK_OPT.map(o => <option key={o}>{o}</option>)}
    </select>
  )

  return (
    <div>
      <div className="d-flex flex-wrap gap-2 mb-3">
        <input className="form-control form-control-sm" style={{ width: 260 }} placeholder="Buscar número, proyecto, OC..." value={buscar} onChange={e => setBuscar(e.target.value)} onKeyDown={e => e.key === 'Enter' && cargar()} />
        <button className="btn btn-sm btn-outline-secondary" onClick={cargar}><i className="bi bi-arrow-clockwise" /></button>
        <div className="ms-auto">
          {canWrite && <button className="btn btn-sm btn-primary" onClick={abrirNuevo}><i className="bi bi-plus-lg me-1" />Nuevo F34</button>}
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
              <tr><th>Número</th><th>HR</th><th>Fecha</th><th>Proyecto</th><th>OC</th><th>Soldador</th><th style={{ width: 80 }}>Chapas</th><th style={{ width: 80 }} /></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => verDetalle(r)}>
                  <td><span className="badge bg-light text-dark border">{r.numero}</span></td>
                  <td className="text-muted">{r.hr_numero||'—'}</td>
                  <td>{fmtF(r.fecha)}</td>
                  <td>{r.proyecto||'—'}</td>
                  <td>{r.oc||'—'}</td>
                  <td>{r.soldador||'—'}</td>
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
                <h5 className="modal-title"><i className="bi bi-wrench me-2 text-primary" />Verificación de Soldadura (F34)</h5>
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
                  <div className="col-md-2">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Fecha</label>
                    <input type="date" className="form-control form-control-sm" value={form.fecha} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Proyecto</label>
                    <input className="form-control form-control-sm" value={form.proyecto} onChange={e => setForm(p => ({ ...p, proyecto: e.target.value }))} />
                  </div>
                  <div className="col-md-2">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>OC</label>
                    <input className="form-control form-control-sm" value={form.oc} onChange={e => setForm(p => ({ ...p, oc: e.target.value }))} />
                  </div>
                  <div className="col-md-2">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Soldador</label>
                    <input className="form-control form-control-sm" value={form.soldador} onChange={e => setForm(p => ({ ...p, soldador: e.target.value }))} />
                  </div>
                </div>

                <div className="d-flex align-items-center justify-content-between mb-2">
                  <span className="fw-semibold" style={{ fontSize: '0.82rem' }}>Chapas verificadas</span>
                  <button className="btn btn-sm btn-outline-secondary py-0" onClick={addItem}><i className="bi bi-plus-lg me-1" />Agregar</button>
                </div>
                <div className="table-responsive">
                  <table className="table table-sm table-bordered align-middle" style={{ fontSize: '0.77rem' }}>
                    <thead className="table-light">
                      <tr>
                        <th style={{ width: 30 }}>#</th>
                        <th style={{ width: 120 }}>N° Chapa</th>
                        <th style={{ width: 70 }}>Código</th>
                        <th style={{ width: 100 }}>Lado</th>
                        <th style={{ width: 90 }}>U. Long. Der.</th>
                        <th style={{ width: 90 }}>U. Long. Izq.</th>
                        <th style={{ width: 90 }}>U. Trans. Der.</th>
                        <th style={{ width: 90 }}>U. Trans. Izq.</th>
                        <th>Observación</th>
                        <th style={{ width: 30 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it, i) => (
                        <tr key={i}>
                          <td className="text-center text-muted">{i + 1}</td>
                          <td><input className="form-control form-control-sm border-0" value={it.nro_chapa} onChange={e => setItem(i, 'nro_chapa', e.target.value)} /></td>
                          <td><input className="form-control form-control-sm border-0" value={it.codigo} onChange={e => setItem(i, 'codigo', e.target.value)} placeholder="P1, L1..." /></td>
                          <td>
                            <select className="form-select form-select-sm border-0" value={it.lado} onChange={e => setItem(i, 'lado', e.target.value)}>
                              {LADOS.map(l => <option key={l}>{l}</option>)}
                            </select>
                          </td>
                          <td><OkCell val={it.u_long_der} onChange={v => setItem(i, 'u_long_der', v)} /></td>
                          <td><OkCell val={it.u_long_izq} onChange={v => setItem(i, 'u_long_izq', v)} /></td>
                          <td><OkCell val={it.u_trans_der} onChange={v => setItem(i, 'u_trans_der', v)} /></td>
                          <td><OkCell val={it.u_trans_izq} onChange={v => setItem(i, 'u_trans_izq', v)} /></td>
                          <td><input className="form-control form-control-sm border-0" value={it.observacion} onChange={e => setItem(i, 'observacion', e.target.value)} /></td>
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

      {detalle && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.5)' }}>
          <div className="modal-dialog modal-xl modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title"><i className="bi bi-wrench me-2" />{detalle.numero} — Verificación de Soldadura</h5>
                <button className="btn-close" onClick={() => setDetalle(null)} />
              </div>
              <div className="modal-body">
                <div className="row g-2 mb-3" style={{ fontSize: '0.83rem' }}>
                  <div className="col-auto"><span className="text-muted">Fecha:</span> <strong>{fmtF(detalle.fecha)}</strong></div>
                  <div className="col-auto"><span className="text-muted">Proyecto:</span> <strong>{detalle.proyecto||'—'}</strong></div>
                  <div className="col-auto"><span className="text-muted">OC:</span> <strong>{detalle.oc||'—'}</strong></div>
                  <div className="col-auto"><span className="text-muted">Soldador:</span> <strong>{detalle.soldador||'—'}</strong></div>
                </div>
                <div className="table-responsive">
                  <table className="table table-sm table-bordered align-middle mb-0" style={{ fontSize: '0.78rem' }}>
                    <thead className="table-light">
                      <tr><th>#</th><th>N° Chapa</th><th>Código</th><th>Lado</th><th>U.L.D.</th><th>U.L.I.</th><th>U.T.D.</th><th>U.T.I.</th><th>Observación</th></tr>
                    </thead>
                    <tbody>
                      {detalle.items.map(it => {
                        const color = v => v==='OK'?'text-success':v==='NO OK'?'text-danger fw-bold':''
                        return (
                          <tr key={it.id}>
                            <td className="text-center">{it.item}</td>
                            <td>{it.nro_chapa}</td><td>{it.codigo}</td><td>{it.lado}</td>
                            <td className={`text-center ${color(it.u_long_der)}`}>{it.u_long_der||'—'}</td>
                            <td className={`text-center ${color(it.u_long_izq)}`}>{it.u_long_izq||'—'}</td>
                            <td className={`text-center ${color(it.u_trans_der)}`}>{it.u_trans_der||'—'}</td>
                            <td className={`text-center ${color(it.u_trans_izq)}`}>{it.u_trans_izq||'—'}</td>
                            <td>{it.observacion}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
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
