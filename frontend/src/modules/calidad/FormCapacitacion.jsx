import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'

const hoy = () => new Date().toISOString().slice(0, 10)
const fmtF = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—'
const asistVacio = () => ({ nro_leg: '', apellido_nombre: '', area: '' })
const HDR0 = { tema: '', fecha: hoy(), expositor: '', duracion: '', observaciones: '' }

export default function FormCapacitacion({ canWrite }) {
  const [rows, setRows]     = useState([])
  const [load, setLoad]     = useState(false)
  const [buscar, setBuscar] = useState('')
  const [modal, setModal]   = useState(null)
  const [form, setForm]     = useState(HDR0)
  const [asist, setAsist]   = useState([asistVacio()])
  const [sav, setSav]       = useState(false)
  const [err, setErr]       = useState('')
  const [detalle, setDetalle] = useState(null)

  const cargar = useCallback(() => {
    setLoad(true)
    const p = buscar ? `?buscar=${encodeURIComponent(buscar)}` : ''
    api.get('/formularios/form10' + p).then(r => setRows(r.data)).finally(() => setLoad(false))
  }, [buscar])

  useEffect(() => { cargar() }, [cargar])

  const abrirNuevo = () => { setForm(HDR0); setAsist([asistVacio()]); setModal('new'); setErr('') }
  const abrirEditar = async (row) => {
    const r = await api.get(`/formularios/form10/${row.id}`)
    setForm({ tema: r.data.tema, fecha: r.data.fecha, expositor: r.data.expositor, duracion: r.data.duracion, observaciones: r.data.observaciones })
    setAsist(r.data.asistentes.length ? r.data.asistentes : [asistVacio()])
    setModal({ id: row.id }); setErr('')
  }
  const verDetalle = async (row) => {
    const r = await api.get(`/formularios/form10/${row.id}`)
    setDetalle(r.data)
  }

  const setA = (i, k, v) => setAsist(prev => prev.map((a, idx) => idx === i ? { ...a, [k]: v } : a))
  const addAsist = () => setAsist(prev => [...prev, asistVacio()])
  const delAsist = (i) => setAsist(prev => prev.filter((_, idx) => idx !== i))

  const guardar = async () => {
    if (!form.tema.trim()) { setErr('El tema es requerido'); return }
    setSav(true); setErr('')
    try {
      const body = { ...form, asistentes: asist.filter(a => a.apellido_nombre.trim()) }
      if (modal === 'new') await api.post('/formularios/form10', body)
      else await api.put(`/formularios/form10/${modal.id}`, body)
      setModal(null); cargar()
    } catch(e) { setErr(e.response?.data?.error || 'Error al guardar') }
    finally { setSav(false) }
  }
  const eliminar = async (id) => {
    if (!confirm('¿Eliminar este registro?')) return
    await api.delete(`/formularios/form10/${id}`); cargar()
  }

  return (
    <div>
      <div className="d-flex flex-wrap gap-2 mb-3">
        <input className="form-control form-control-sm" style={{ width: 260 }} placeholder="Buscar número, tema, expositor..." value={buscar} onChange={e => setBuscar(e.target.value)} onKeyDown={e => e.key === 'Enter' && cargar()} />
        <button className="btn btn-sm btn-outline-secondary" onClick={cargar}><i className="bi bi-arrow-clockwise" /></button>
        <div className="ms-auto">
          {canWrite && <button className="btn btn-sm btn-primary" onClick={abrirNuevo}><i className="bi bi-plus-lg me-1" />Nueva Capacitación</button>}
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
              <tr><th>Número</th><th>Tema</th><th>Fecha</th><th>Expositor</th><th>Duración</th><th style={{ width: 80 }}>Asistentes</th><th style={{ width: 80 }} /></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => verDetalle(r)}>
                  <td><span className="badge bg-light text-dark border">{r.numero}</span></td>
                  <td>{r.tema}</td>
                  <td>{fmtF(r.fecha)}</td>
                  <td>{r.expositor||'—'}</td>
                  <td>{r.duracion||'—'}</td>
                  <td className="text-center"><span className="badge bg-info text-dark">{r.total_asistentes}</span></td>
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
          <div className="modal-dialog modal-lg modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title"><i className="bi bi-mortarboard me-2 text-primary" />Registro de Capacitación (F10)</h5>
                <button className="btn-close" onClick={() => setModal(null)} />
              </div>
              <div className="modal-body">
                {err && <div className="alert alert-danger py-2">{err}</div>}
                <div className="row g-2 mb-3">
                  <div className="col-md-6">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Tema / Curso <span className="text-danger">*</span></label>
                    <input className="form-control form-control-sm" value={form.tema} onChange={e => setForm(p => ({ ...p, tema: e.target.value }))} />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Fecha</label>
                    <input type="date" className="form-control form-control-sm" value={form.fecha} onChange={e => setForm(p => ({ ...p, fecha: e.target.value }))} />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Duración</label>
                    <input className="form-control form-control-sm" value={form.duracion} onChange={e => setForm(p => ({ ...p, duracion: e.target.value }))} placeholder="Ej: 2 hs" />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label fw-semibold" style={{ fontSize: '0.8rem' }}>Expositor</label>
                    <input className="form-control form-control-sm" value={form.expositor} onChange={e => setForm(p => ({ ...p, expositor: e.target.value }))} />
                  </div>
                </div>

                <div className="d-flex align-items-center justify-content-between mb-2">
                  <span className="fw-semibold" style={{ fontSize: '0.82rem' }}>Listado de asistentes</span>
                  <button className="btn btn-sm btn-outline-secondary py-0" onClick={addAsist}><i className="bi bi-plus-lg me-1" />Agregar</button>
                </div>
                <div className="table-responsive">
                  <table className="table table-sm table-bordered align-middle" style={{ fontSize: '0.8rem' }}>
                    <thead className="table-light">
                      <tr><th style={{ width: 30 }}>#</th><th style={{ width: 90 }}>N° Legajo</th><th>Apellido y Nombre</th><th style={{ width: 150 }}>Área</th><th style={{ width: 30 }} /></tr>
                    </thead>
                    <tbody>
                      {asist.map((a, i) => (
                        <tr key={i}>
                          <td className="text-center text-muted">{i + 1}</td>
                          <td><input className="form-control form-control-sm border-0" value={a.nro_leg} onChange={e => setA(i, 'nro_leg', e.target.value)} /></td>
                          <td><input className="form-control form-control-sm border-0" value={a.apellido_nombre} onChange={e => setA(i, 'apellido_nombre', e.target.value)} /></td>
                          <td><input className="form-control form-control-sm border-0" value={a.area} onChange={e => setA(i, 'area', e.target.value)} /></td>
                          <td><button className="btn btn-xs text-danger border-0" onClick={() => delAsist(i)}><i className="bi bi-x" /></button></td>
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
                <h5 className="modal-title"><i className="bi bi-mortarboard me-2" />{detalle.numero}</h5>
                <button className="btn-close" onClick={() => setDetalle(null)} />
              </div>
              <div className="modal-body">
                <h6 className="mb-1">{detalle.tema}</h6>
                <div className="d-flex gap-3 mb-3 text-muted" style={{ fontSize: '0.83rem' }}>
                  <span><i className="bi bi-calendar me-1" />{fmtF(detalle.fecha)}</span>
                  {detalle.expositor && <span><i className="bi bi-person me-1" />{detalle.expositor}</span>}
                  {detalle.duracion && <span><i className="bi bi-clock me-1" />{detalle.duracion}</span>}
                </div>
                <table className="table table-sm table-bordered mb-0" style={{ fontSize: '0.82rem' }}>
                  <thead className="table-light"><tr><th>#</th><th>N° Legajo</th><th>Apellido y Nombre</th><th>Área</th></tr></thead>
                  <tbody>
                    {detalle.asistentes.map((a, i) => (
                      <tr key={a.id}><td className="text-center text-muted">{i+1}</td><td>{a.nro_leg||'—'}</td><td>{a.apellido_nombre}</td><td>{a.area||'—'}</td></tr>
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
