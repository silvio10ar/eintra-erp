import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'

const hoy = () => new Date().toISOString().slice(0, 10)
const fmtF = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—'
const PINTURAS = ['Revesta 73', 'Revesta 340', 'Revesta 400', 'Revesta 290', 'Otra']
const arr8 = () => Array(8).fill('')
const arr6 = () => Array(6).fill('')
const HDR0 = { hoja_ruta_id: '', form21_numero: '', controlo: '', fecha: hoy(), pintura_tipo: 'Revesta 73', partida_nro: '', chapa_nro: '', cano_nro: '', perfil_nro: '', observaciones: '' }

function parseArr(v, len) {
  try { const a = JSON.parse(v||'[]'); return Array.isArray(a) ? a : []; } catch { return Array(len).fill('') }
}

export default function FormPinturaBase({ hojasList = [], canWrite }) {
  const [rows, setRows]     = useState([])
  const [load, setLoad]     = useState(false)
  const [buscar, setBuscar] = useState('')
  const [modal, setModal]   = useState(null)
  const [form, setForm]     = useState(HDR0)
  const [medA, setMedA]     = useState(arr8())
  const [medB, setMedB]     = useState(arr8())
  const [medC, setMedC]     = useState(arr6())
  const [sav, setSav]       = useState(false)
  const [err, setErr]       = useState('')

  const cargar = useCallback(() => {
    setLoad(true)
    const p = buscar ? `?buscar=${encodeURIComponent(buscar)}` : ''
    api.get('/formularios/form22' + p).then(r => setRows(r.data)).finally(() => setLoad(false))
  }, [buscar])

  useEffect(() => { cargar() }, [cargar])

  const abrirNuevo = () => {
    setForm(HDR0); setMedA(arr8()); setMedB(arr8()); setMedC(arr6())
    setModal('new'); setErr('')
  }
  const abrirEditar = async (row) => {
    const r = await api.get(`/formularios/form22/${row.id}`)
    const d = r.data
    setForm({ hoja_ruta_id: d.hoja_ruta_id||'', form21_numero: d.form21_numero, controlo: d.controlo, fecha: d.fecha, pintura_tipo: d.pintura_tipo, partida_nro: d.partida_nro, chapa_nro: d.chapa_nro, cano_nro: d.cano_nro, perfil_nro: d.perfil_nro, observaciones: d.observaciones })
    setMedA(parseArr(d.med_a, 8))
    setMedB(parseArr(d.med_b, 8))
    setMedC(parseArr(d.med_cano, 6))
    setModal({ id: row.id }); setErr('')
  }

  const guardar = async () => {
    setSav(true); setErr('')
    try {
      const body = { ...form, med_a: medA, med_b: medB, med_cano: medC }
      if (modal === 'new') await api.post('/formularios/form22', body)
      else await api.put(`/formularios/form22/${modal.id}`, body)
      setModal(null); cargar()
    } catch(e) { setErr(e.response?.data?.error || 'Error al guardar') }
    finally { setSav(false) }
  }
  const eliminar = async (id) => {
    if (!confirm('¿Eliminar este registro?')) return
    await api.delete(`/formularios/form22/${id}`); cargar()
  }

  const setMedicion = (setter, i, v) => setter(prev => prev.map((x, idx) => idx === i ? v : x))

  const MedGrid = ({ label, vals, setter, cols }) => (
    <div className="mb-3">
      <div className="fw-semibold mb-1" style={{ fontSize: '0.78rem' }}>{label}</div>
      <div className="d-flex flex-wrap gap-2">
        {vals.map((v, i) => (
          <div key={i} style={{ width: 90 }}>
            <label className="form-label mb-0 text-muted" style={{ fontSize: '0.72rem' }}>Punto {i+1}</label>
            <input type="number" className="form-control form-control-sm text-center" value={v} onChange={e => setMedicion(setter, i, e.target.value)} placeholder="μm" />
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div>
      <div className="d-flex flex-wrap gap-2 mb-3">
        <input className="form-control form-control-sm" style={{ width: 260 }} placeholder="Buscar número, controló, chapa..." value={buscar} onChange={e => setBuscar(e.target.value)} onKeyDown={e => e.key === 'Enter' && cargar()} />
        <button className="btn btn-sm btn-outline-secondary" onClick={cargar}><i className="bi bi-arrow-clockwise" /></button>
        <div className="ms-auto">
          {canWrite && <button className="btn btn-sm btn-primary" onClick={abrirNuevo}><i className="bi bi-plus-lg me-1" />Nuevo F22</button>}
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
              <tr><th>Número</th><th>HR</th><th>Fecha</th><th>Controló</th><th>Pintura</th><th>Partida</th><th>Chapa</th><th style={{ width: 80 }} /></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td><span className="badge bg-light text-dark border">{r.numero}</span></td>
                  <td className="text-muted">{r.hr_numero||'—'}</td>
                  <td>{fmtF(r.fecha)}</td>
                  <td>{r.controlo||'—'}</td>
                  <td>{r.pintura_tipo||'—'}</td>
                  <td>{r.partida_nro||'—'}</td>
                  <td>{r.chapa_nro||'—'}</td>
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
          <div className="modal-dialog modal-lg modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title"><i className="bi bi-brush me-2 text-primary" />Control de Pintura Base (F22)</h5>
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
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Controló</label>
                    <input className="form-control form-control-sm" value={form.controlo} onChange={e => setForm(p => ({ ...p, controlo: e.target.value }))} />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Pintura utilizada</label>
                    <select className="form-select form-select-sm" value={form.pintura_tipo} onChange={e => setForm(p => ({ ...p, pintura_tipo: e.target.value }))}>
                      {PINTURAS.map(p => <option key={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="col-md-2">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Form 21 N°</label>
                    <input className="form-control form-control-sm" value={form.form21_numero} onChange={e => setForm(p => ({ ...p, form21_numero: e.target.value }))} />
                  </div>
                  <div className="col-md-2">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Partida N°</label>
                    <input className="form-control form-control-sm" value={form.partida_nro} onChange={e => setForm(p => ({ ...p, partida_nro: e.target.value }))} />
                  </div>
                  <div className="col-md-2">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Chapa N°</label>
                    <input className="form-control form-control-sm" value={form.chapa_nro} onChange={e => setForm(p => ({ ...p, chapa_nro: e.target.value }))} />
                  </div>
                  <div className="col-md-2">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Caño N°</label>
                    <input className="form-control form-control-sm" value={form.cano_nro} onChange={e => setForm(p => ({ ...p, cano_nro: e.target.value }))} />
                  </div>
                  <div className="col-md-2">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Perfil N°</label>
                    <input className="form-control form-control-sm" value={form.perfil_nro} onChange={e => setForm(p => ({ ...p, perfil_nro: e.target.value }))} />
                  </div>
                </div>
                <hr />
                <MedGrid label="Chapa — Lado A (μm)" vals={medA} setter={setMedA} />
                <MedGrid label="Chapa — Lado B (μm)" vals={medB} setter={setMedB} />
                <MedGrid label="Caño / Perfil (μm)" vals={medC} setter={setMedC} />
                <div>
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
