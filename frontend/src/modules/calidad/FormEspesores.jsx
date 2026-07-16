import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'

const hoy = () => new Date().toISOString().slice(0, 10)
const fmtF = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—'
const CARAS = ['cara3', 'cara4', 'cara5', 'cara6', 'cara7', 'cara8', 'piso']
const CARAS_LABEL = { cara3: 'Cara 3', cara4: 'Cara 4', cara5: 'Cara 5', cara6: 'Cara 6', cara7: 'Cara 7', cara8: 'Cara 8', piso: 'Piso' }
const PUNTOS_POR_CARA = { cara3: 8, cara4: 8, cara5: 8, cara6: 8, cara7: 8, cara8: 8, piso: 15 }
const medVacio = () => Object.fromEntries(CARAS.map(c => [c, Array(PUNTOS_POR_CARA[c]).fill('')]))
const HDR0 = { hoja_ruta_id: '', fecha: hoy(), id_proyecto: '', pintor: '', controlo: '', aparato: '', observaciones: '' }

function parseMed(v) {
  try { return JSON.parse(v || '{}') } catch { return {} }
}

export default function FormEspesores({ hojasList = [], canWrite }) {
  const [rows, setRows]     = useState([])
  const [load, setLoad]     = useState(false)
  const [buscar, setBuscar] = useState('')
  const [modal, setModal]   = useState(null)
  const [form, setForm]     = useState(HDR0)
  const [med, setMed]       = useState(medVacio())
  const [sav, setSav]       = useState(false)
  const [err, setErr]       = useState('')

  const cargar = useCallback(() => {
    setLoad(true)
    const p = buscar ? `?buscar=${encodeURIComponent(buscar)}` : ''
    api.get('/formularios/form26' + p).then(r => setRows(r.data)).finally(() => setLoad(false))
  }, [buscar])

  useEffect(() => { cargar() }, [cargar])

  const abrirNuevo = () => { setForm(HDR0); setMed(medVacio()); setModal('new'); setErr('') }
  const abrirEditar = async (row) => {
    const r = await api.get(`/formularios/form26/${row.id}`)
    const d = r.data
    setForm({ hoja_ruta_id: d.hoja_ruta_id||'', fecha: d.fecha, id_proyecto: d.id_proyecto, pintor: d.pintor, controlo: d.controlo, aparato: d.aparato, observaciones: d.observaciones })
    const parsed = parseMed(d.mediciones)
    const m = medVacio()
    CARAS.forEach(c => { if (Array.isArray(parsed[c])) m[c] = parsed[c] })
    setMed(m)
    setModal({ id: row.id }); setErr('')
  }

  const setMedPoint = (cara, i, v) => setMed(prev => ({ ...prev, [cara]: prev[cara].map((x, idx) => idx === i ? v : x) }))

  const guardar = async () => {
    setSav(true); setErr('')
    try {
      if (modal === 'new') await api.post('/formularios/form26', { ...form, mediciones: med })
      else await api.put(`/formularios/form26/${modal.id}`, { ...form, mediciones: med })
      setModal(null); cargar()
    } catch(e) { setErr(e.response?.data?.error || 'Error al guardar') }
    finally { setSav(false) }
  }
  const eliminar = async (id) => {
    if (!confirm('¿Eliminar este registro?')) return
    await api.delete(`/formularios/form26/${id}`); cargar()
  }

  return (
    <div>
      <div className="d-flex flex-wrap gap-2 mb-3">
        <input className="form-control form-control-sm" style={{ width: 260 }} placeholder="Buscar número, proyecto, pintor..." value={buscar} onChange={e => setBuscar(e.target.value)} onKeyDown={e => e.key === 'Enter' && cargar()} />
        <button className="btn btn-sm btn-outline-secondary" onClick={cargar}><i className="bi bi-arrow-clockwise" /></button>
        <div className="ms-auto">
          {canWrite && <button className="btn btn-sm btn-primary" onClick={abrirNuevo}><i className="bi bi-plus-lg me-1" />Nuevo F26</button>}
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
              <tr><th>Número</th><th>HR</th><th>Fecha</th><th>ID Proyecto</th><th>Pintor</th><th>Controló</th><th>Aparato</th><th style={{ width: 80 }} /></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td><span className="badge bg-light text-dark border">{r.numero}</span></td>
                  <td className="text-muted">{r.hr_numero||'—'}</td>
                  <td>{fmtF(r.fecha)}</td>
                  <td>{r.id_proyecto||'—'}</td>
                  <td>{r.pintor||'—'}</td>
                  <td>{r.controlo||'—'}</td>
                  <td>{r.aparato||'—'}</td>
                  <td>
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
                <h5 className="modal-title"><i className="bi bi-layers me-2 text-primary" />Control de Espesores Pintura Final (F26)</h5>
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
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>ID Proyecto</label>
                    <input className="form-control form-control-sm" value={form.id_proyecto} onChange={e => setForm(p => ({ ...p, id_proyecto: e.target.value }))} />
                  </div>
                  <div className="col-md-2">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Pintor</label>
                    <input className="form-control form-control-sm" value={form.pintor} onChange={e => setForm(p => ({ ...p, pintor: e.target.value }))} />
                  </div>
                  <div className="col-md-2">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Controló</label>
                    <input className="form-control form-control-sm" value={form.controlo} onChange={e => setForm(p => ({ ...p, controlo: e.target.value }))} />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Aparato</label>
                    <input className="form-control form-control-sm" value={form.aparato} onChange={e => setForm(p => ({ ...p, aparato: e.target.value }))} placeholder="Ej: G9888 (EQ-200)" />
                  </div>
                </div>
                <hr />
                <div className="fw-semibold mb-2" style={{ fontSize: '0.82rem' }}>Mediciones por zona (μm)</div>
                <div className="row g-3">
                  {CARAS.map(cara => (
                    <div key={cara} className="col-md-6 col-lg-4">
                      <div className="border rounded p-2">
                        <div className="fw-semibold mb-2" style={{ fontSize: '0.78rem' }}>{CARAS_LABEL[cara]}</div>
                        <div className="d-flex flex-wrap gap-1">
                          {med[cara].map((v, i) => (
                            <div key={i} style={{ width: 70 }}>
                              <label className="form-label mb-0 text-muted" style={{ fontSize: '0.7rem' }}>Pt. {i+1}</label>
                              <input type="number" className="form-control form-control-sm text-center p-1" style={{ fontSize: '0.78rem' }} value={v} onChange={e => setMedPoint(cara, i, e.target.value)} />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-3">
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
    </div>
  )
}
