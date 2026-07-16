import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'

const fmtF = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—'
const HDR0 = { hoja_ruta_id: '', anio: new Date().getFullYear(), equipo_tipo: '', codigo: '', cliente: '', proyecto: '', descripcion: '', fecha_fabricacion: '', observaciones: '' }

export default function FormChapaID({ hojasList = [], canWrite }) {
  const [rows, setRows]     = useState([])
  const [load, setLoad]     = useState(false)
  const [buscar, setBuscar] = useState('')
  const [modal, setModal]   = useState(null)
  const [form, setForm]     = useState(HDR0)
  const [sav, setSav]       = useState(false)
  const [err, setErr]       = useState('')

  const cargar = useCallback(() => {
    setLoad(true)
    const p = buscar ? `?buscar=${encodeURIComponent(buscar)}` : ''
    api.get('/formularios/form37' + p).then(r => setRows(r.data)).finally(() => setLoad(false))
  }, [buscar])

  useEffect(() => { cargar() }, [cargar])

  const abrirNuevo = () => { setForm(HDR0); setModal('new'); setErr('') }
  const abrirEditar = (row) => {
    setForm({ hoja_ruta_id: row.hoja_ruta_id||'', anio: row.anio, equipo_tipo: row.equipo_tipo, codigo: row.codigo, cliente: row.cliente, proyecto: row.proyecto, descripcion: row.descripcion, fecha_fabricacion: row.fecha_fabricacion, observaciones: row.observaciones })
    setModal({ id: row.id }); setErr('')
  }

  const guardar = async () => {
    setSav(true); setErr('')
    try {
      if (modal === 'new') await api.post('/formularios/form37', form)
      else await api.put(`/formularios/form37/${modal.id}`, form)
      setModal(null); cargar()
    } catch(e) { setErr(e.response?.data?.error || 'Error al guardar') }
    finally { setSav(false) }
  }
  const eliminar = async (id) => {
    if (!confirm('¿Eliminar esta chapa ID?')) return
    await api.delete(`/formularios/form37/${id}`); cargar()
  }

  return (
    <div>
      <div className="d-flex flex-wrap gap-2 mb-3">
        <input className="form-control form-control-sm" style={{ width: 260 }} placeholder="Buscar número, equipo, cliente..." value={buscar} onChange={e => setBuscar(e.target.value)} onKeyDown={e => e.key === 'Enter' && cargar()} />
        <button className="btn btn-sm btn-outline-secondary" onClick={cargar}><i className="bi bi-arrow-clockwise" /></button>
        <div className="ms-auto">
          {canWrite && <button className="btn btn-sm btn-primary" onClick={abrirNuevo}><i className="bi bi-plus-lg me-1" />Nueva Chapa ID</button>}
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
              <tr><th>Número</th><th>HR</th><th>Año</th><th>Tipo de equipo</th><th>Código</th><th>Cliente</th><th>F. Fabricación</th><th style={{ width: 80 }} /></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td><span className="badge bg-light text-dark border">{r.numero}</span></td>
                  <td className="text-muted">{r.hr_numero||'—'}</td>
                  <td>{r.anio}</td>
                  <td>{r.equipo_tipo||'—'}</td>
                  <td className="font-monospace">{r.codigo||'—'}</td>
                  <td>{r.cliente||'—'}</td>
                  <td>{fmtF(r.fecha_fabricacion)}</td>
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
                <h5 className="modal-title"><i className="bi bi-tag me-2 text-primary" />Chapa de Identificación de Equipos (F37)</h5>
                <button className="btn-close" onClick={() => setModal(null)} />
              </div>
              <div className="modal-body">
                {err && <div className="alert alert-danger py-2">{err}</div>}
                <div className="row g-2">
                  <div className="col-md-4">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Hoja de Ruta</label>
                    <select className="form-select form-select-sm" value={form.hoja_ruta_id} onChange={e => setForm(p => ({ ...p, hoja_ruta_id: e.target.value }))}>
                      <option value="">Sin HR</option>
                      {hojasList.map(h => <option key={h.id} value={h.id}>{h.numero}</option>)}
                    </select>
                  </div>
                  <div className="col-md-2">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Año</label>
                    <input type="number" className="form-control form-control-sm" value={form.anio} onChange={e => setForm(p => ({ ...p, anio: +e.target.value }))} />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Tipo de equipo</label>
                    <input className="form-control form-control-sm" value={form.equipo_tipo} onChange={e => setForm(p => ({ ...p, equipo_tipo: e.target.value }))} placeholder="Ej: Planta de Tratamiento Biológico" />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Código</label>
                    <input className="form-control form-control-sm font-monospace" value={form.codigo} onChange={e => setForm(p => ({ ...p, codigo: e.target.value }))} />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Cliente</label>
                    <input className="form-control form-control-sm" value={form.cliente} onChange={e => setForm(p => ({ ...p, cliente: e.target.value }))} />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Proyecto</label>
                    <input className="form-control form-control-sm" value={form.proyecto} onChange={e => setForm(p => ({ ...p, proyecto: e.target.value }))} />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Fecha fabricación</label>
                    <input type="date" className="form-control form-control-sm" value={form.fecha_fabricacion} onChange={e => setForm(p => ({ ...p, fecha_fabricacion: e.target.value }))} />
                  </div>
                  <div className="col-12">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Descripción</label>
                    <input className="form-control form-control-sm" value={form.descripcion} onChange={e => setForm(p => ({ ...p, descripcion: e.target.value }))} />
                  </div>
                  <div className="col-12">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Observaciones</label>
                    <textarea className="form-control form-control-sm" rows={2} value={form.observaciones} onChange={e => setForm(p => ({ ...p, observaciones: e.target.value }))} />
                  </div>
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
