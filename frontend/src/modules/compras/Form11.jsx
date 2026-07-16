import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'
import DateInput from '../../components/DateInput'

const CRITERIOS_SEL  = ['Calidad final', 'Precio', 'Experiencia laboral', 'Experiencia en mercado']
const CRITERIOS_EVAL = ['Cumplimiento de plazos', 'Capacidad de respuesta', 'Flexibilidad ante cambios', 'Calidad final']
const OPCIONES_PUNTAJE = ['MUY BUENO', 'BUENO', 'REGULAR', 'MALO', 'NO APLICA']
const PUNTAJES = { 'MUY BUENO': 4, 'BUENO': 3, 'REGULAR': 2, 'MALO': 1 }

const anioActual = new Date().getFullYear()
const hoy = () => new Date().toISOString().slice(0, 10)
const fmtF = iso => iso ? iso.slice(0,10).split('-').reverse().join('/') : '—'

function colorResultado(r) {
  if (r === 'APROBADO') return 'bg-success'
  if (r === 'APROBADO CONDICIONAL') return 'bg-warning text-dark'
  if (r === 'INHABILITADO') return 'bg-danger'
  return 'bg-secondary'
}

function calcularResultado(criterios) {
  const validos = criterios.filter(c => c.puntaje && c.puntaje !== 'NO APLICA' && PUNTAJES[c.puntaje] != null)
  if (!validos.length) return { puntaje: null, resultado: '' }
  const avg = validos.reduce((s, c) => s + PUNTAJES[c.puntaje], 0) / validos.length
  return {
    puntaje: Math.round(avg * 100) / 100,
    resultado: avg < 1.8 ? 'INHABILITADO' : avg < 2.74 ? 'APROBADO CONDICIONAL' : 'APROBADO'
  }
}

function FormEvaluacion({ proveedor, onClose, onGuardado, evalEdit }) {
  const tipo = evalEdit?.tipo || 'evaluacion'
  const criteriosBase = tipo === 'seleccion' ? CRITERIOS_SEL : CRITERIOS_EVAL
  const [form, setForm] = useState({
    tipo: evalEdit?.tipo || 'evaluacion',
    anio: evalEdit?.anio || anioActual,
    fecha: evalEdit?.fecha || hoy(),
    observaciones: evalEdit?.observaciones || '',
    criterios: criteriosBase.map(c => ({
      criterio: c,
      puntaje: evalEdit?.criterios?.find(x => x.criterio === c)?.puntaje || ''
    }))
  })
  const [sav, setSav] = useState(false)
  const [err, setErr] = useState('')

  const setCriterio = (criterio, puntaje) => setForm(p => ({
    ...p,
    criterios: p.criterios.map(c => c.criterio === criterio ? { ...c, puntaje } : c)
  }))

  const { puntaje, resultado } = calcularResultado(form.criterios)

  const guardar = async e => {
    e.preventDefault(); setSav(true); setErr('')
    try {
      const body = { ...form, proveedor_id: proveedor.id }
      if (evalEdit?.id) await api.put(`/evaluaciones/${evalEdit.id}`, body)
      else await api.post('/evaluaciones', body)
      onGuardado()
    } catch(ex) { setErr(ex.response?.data?.error ?? 'Error al guardar') }
    finally { setSav(false) }
  }

  return (
    <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.5)', zIndex: 1090 }}>
      <div className="modal-dialog modal-lg modal-dialog-scrollable">
        <form className="modal-content" onSubmit={guardar}>
          <div className="modal-header py-2">
            <h5 className="modal-title">
              {evalEdit ? 'Editar' : 'Nueva'} {form.tipo === 'seleccion' ? 'Selección' : 'Evaluación'} — {proveedor.nombre}
            </h5>
            <button type="button" className="btn-close" onClick={onClose}/>
          </div>
          <div className="modal-body">
            {err && <div className="alert alert-danger py-2 small">{err}</div>}

            <div className="row g-2 mb-3">
              {!evalEdit && (
                <div className="col-md-4">
                  <label className="form-label small fw-medium">Tipo *</label>
                  <select className="form-select form-select-sm" value={form.tipo}
                    onChange={e => {
                      const t = e.target.value
                      const base = t === 'seleccion' ? CRITERIOS_SEL : CRITERIOS_EVAL
                      setForm(p => ({ ...p, tipo: t, criterios: base.map(c => ({ criterio: c, puntaje: '' })) }))
                    }}>
                    <option value="evaluacion">Evaluación periódica</option>
                    <option value="seleccion">Selección de proveedor</option>
                  </select>
                </div>
              )}
              <div className="col-md-2">
                <label className="form-label small fw-medium">Año *</label>
                <input type="number" className="form-control form-control-sm" value={form.anio} min={2020} max={2099} required
                  onChange={e => setForm(p => ({ ...p, anio: parseInt(e.target.value) || anioActual }))}/>
              </div>
              <div className="col-md-3">
                <label className="form-label small fw-medium">Fecha</label>
                <DateInput className="form-control form-control-sm" value={form.fecha}
                  onChange={v => setForm(p => ({ ...p, fecha: v }))}/>
              </div>
              <div className="col-12">
                <label className="form-label small fw-medium">Observaciones</label>
                <input className="form-control form-control-sm" value={form.observaciones}
                  onChange={e => setForm(p => ({ ...p, observaciones: e.target.value }))}/>
              </div>
            </div>

            <table className="table table-sm table-bordered" style={{ fontSize: '0.85rem' }}>
              <thead className="table-dark">
                <tr>
                  <th>CRITERIO</th>
                  {OPCIONES_PUNTAJE.map(o => (
                    <th key={o} className="text-center" style={{ width: 100 }}>{o}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {form.criterios.map(c => (
                  <tr key={c.criterio}>
                    <td className="fw-medium">{c.criterio}</td>
                    {OPCIONES_PUNTAJE.map(o => (
                      <td key={o} className="text-center">
                        <input type="radio" className="form-check-input"
                          name={`crit_${c.criterio}`} value={o} checked={c.puntaje === o}
                          onChange={() => setCriterio(c.criterio, o)}/>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>

            {resultado && (
              <div className={`alert ${resultado === 'APROBADO' ? 'alert-success' : resultado === 'INHABILITADO' ? 'alert-danger' : 'alert-warning'} py-2 d-flex align-items-center gap-3`}>
                <div>
                  <strong>Puntaje:</strong> {puntaje}
                  {' | '}
                  <strong>Resultado:</strong>{' '}
                  <span className={`badge ${colorResultado(resultado)}`}>{resultado}</span>
                </div>
                <div className="small text-muted">
                  MUY BUENO=4, BUENO=3, REGULAR=2, MALO=1, NO APLICA=excluido del promedio
                </div>
              </div>
            )}
          </div>
          <div className="modal-footer py-2">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Cancelar</button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={sav}>
              {sav && <span className="spinner-border spinner-border-sm me-2"/>}Guardar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Form11({ canWrite, proveedores }) {
  const [buscar, setBuscar]       = useState('')
  const [selProv, setSelProv]     = useState(null)
  const [evals, setEvals]         = useState([])
  const [loadEvals, setLoadEvals] = useState(false)
  const [modalForm, setModalForm] = useState(null)  // null | 'nuevo' | {eval obj}
  const [filtTipo, setFiltTipo]   = useState('')

  const provsFiltrados = proveedores.filter(p => {
    if (!buscar) return true
    const q = buscar.toLowerCase()
    return p.nombre.toLowerCase().includes(q) || (p.cuit||'').includes(q)
  })

  const cargarEvals = useCallback(() => {
    if (!selProv) return
    setLoadEvals(true)
    api.get(`/evaluaciones/proveedor/${selProv.id}`)
      .then(r => setEvals(r.data))
      .finally(() => setLoadEvals(false))
  }, [selProv])

  useEffect(() => { cargarEvals() }, [cargarEvals])

  const eliminar = async ev => {
    if (!confirm(`¿Eliminar esta ${ev.tipo === 'seleccion' ? 'selección' : 'evaluación'} de ${ev.anio}?`)) return
    await api.delete(`/evaluaciones/${ev.id}`)
    cargarEvals()
  }

  const evalsFiltradas = filtTipo ? evals.filter(e => e.tipo === filtTipo) : evals

  const ultimaEval = evals.filter(e => e.tipo === 'evaluacion').sort((a, b) => b.anio - a.anio)[0]
  const ultimaSel  = evals.filter(e => e.tipo === 'seleccion').sort((a, b) => b.anio - a.anio)[0]

  return (
    <div className="row g-3">
      {/* Panel izquierdo: lista de proveedores */}
      <div className="col-md-4">
        <div className="card border-0 shadow-sm h-100">
          <div className="card-header py-2 bg-dark text-white small fw-bold">
            <i className="bi bi-building me-1"/>Proveedores
          </div>
          <div className="card-body p-2">
            <input className="form-control form-control-sm mb-2" placeholder="Buscar proveedor…"
              value={buscar} onChange={e => setBuscar(e.target.value)}/>
            <div style={{ maxHeight: 'calc(100vh - 320px)', overflowY: 'auto' }}>
              {provsFiltrados.length === 0
                ? <p className="text-muted small text-center py-3">Sin resultados</p>
                : provsFiltrados.map(p => (
                    <button key={p.id} type="button"
                      className={`w-100 text-start btn btn-sm mb-1 ${selProv?.id === p.id ? 'btn-primary' : 'btn-outline-secondary'}`}
                      style={{ fontSize: '0.82rem' }}
                      onClick={() => { setSelProv(p); setFiltTipo('') }}>
                      <div className="fw-semibold text-truncate">{p.nombre}</div>
                      {p.cuit && <div className="small opacity-75">{p.cuit}</div>}
                      {p.critico === 1 && <span className="badge bg-danger ms-1" style={{ fontSize: '0.65rem' }}>CRÍTICO</span>}
                    </button>
                  ))
              }
            </div>
          </div>
        </div>
      </div>

      {/* Panel derecho: evaluaciones del proveedor */}
      <div className="col-md-8">
        {!selProv
          ? (
            <div className="card border-0 shadow-sm h-100 d-flex align-items-center justify-content-center" style={{ minHeight: 300 }}>
              <div className="text-muted text-center">
                <i className="bi bi-arrow-left-circle fs-2 d-block mb-2"/>
                Seleccioná un proveedor para ver sus evaluaciones
              </div>
            </div>
          )
          : (
            <div className="card border-0 shadow-sm">
              <div className="card-header py-2 d-flex justify-content-between align-items-center">
                <div>
                  <strong>{selProv.nombre}</strong>
                  {selProv.critico === 1 && <span className="badge bg-danger ms-2">CRÍTICO</span>}
                  <div className="small text-muted">{selProv.cuit || 'Sin CUIT'}</div>
                </div>
                <div className="d-flex gap-2 align-items-center">
                  {/* Últimos resultados */}
                  {ultimaEval?.resultado && (
                    <span className="small">
                      Eval. {ultimaEval.anio}: <span className={`badge ${colorResultado(ultimaEval.resultado)}`}>{ultimaEval.resultado}</span>
                    </span>
                  )}
                  {ultimaSel?.resultado && (
                    <span className="small">
                      Sel. {ultimaSel.anio}: <span className={`badge ${colorResultado(ultimaSel.resultado)}`}>{ultimaSel.resultado}</span>
                    </span>
                  )}
                  {canWrite && (
                    <button className="btn btn-sm btn-success" onClick={() => setModalForm('nuevo')}>
                      <i className="bi bi-plus-lg me-1"/>Nueva
                    </button>
                  )}
                </div>
              </div>

              <div className="card-body p-2">
                <div className="d-flex gap-2 mb-2">
                  <button className={`btn btn-xs ${filtTipo===''?'btn-secondary':'btn-outline-secondary'}`} onClick={() => setFiltTipo('')}>Todas</button>
                  <button className={`btn btn-xs ${filtTipo==='evaluacion'?'btn-secondary':'btn-outline-secondary'}`} onClick={() => setFiltTipo('evaluacion')}>Evaluaciones</button>
                  <button className={`btn btn-xs ${filtTipo==='seleccion'?'btn-secondary':'btn-outline-secondary'}`} onClick={() => setFiltTipo('seleccion')}>Selecciones</button>
                </div>

                {loadEvals
                  ? <div className="text-center py-4"><div className="spinner-border spinner-border-sm text-secondary"/></div>
                  : evalsFiltradas.length === 0
                    ? <p className="text-muted small text-center py-4">Sin evaluaciones registradas</p>
                    : (
                      <div className="table-responsive">
                        <table className="table table-sm table-hover mb-0" style={{ fontSize: '0.83rem' }}>
                          <thead className="table-light">
                            <tr>
                              <th>TIPO</th>
                              <th className="text-center">AÑO</th>
                              <th className="text-center">FECHA</th>
                              <th className="text-end">PUNTAJE</th>
                              <th>RESULTADO</th>
                              <th>OBSERVACIONES</th>
                              {canWrite && <th/>}
                            </tr>
                          </thead>
                          <tbody>
                            {evalsFiltradas.map(ev => (
                              <tr key={ev.id}>
                                <td className="text-capitalize">{ev.tipo === 'seleccion' ? 'Selección' : 'Evaluación'}</td>
                                <td className="text-center fw-semibold">{ev.anio}</td>
                                <td className="text-center">{fmtF(ev.fecha)}</td>
                                <td className="text-end">{ev.puntaje > 0 ? ev.puntaje : '—'}</td>
                                <td>
                                  {ev.resultado
                                    ? <span className={`badge ${colorResultado(ev.resultado)}`}>{ev.resultado}</span>
                                    : <span className="text-muted">—</span>
                                  }
                                </td>
                                <td className="text-muted small text-truncate" style={{ maxWidth: 180 }}
                                  title={ev.observaciones}>{ev.observaciones || '—'}</td>
                                {canWrite && (
                                  <td>
                                    <div className="d-flex gap-1">
                                      <button className="btn btn-xs btn-outline-primary py-0 px-2"
                                        style={{ fontSize: '0.75rem' }}
                                        onClick={() => setModalForm(ev)}>
                                        <i className="bi bi-pencil"/>
                                      </button>
                                      <button className="btn btn-xs btn-outline-danger py-0 px-2"
                                        style={{ fontSize: '0.75rem' }}
                                        onClick={() => eliminar(ev)}>
                                        <i className="bi bi-trash"/>
                                      </button>
                                    </div>
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )
                }

                {/* Detalle de criterios de la evaluación más reciente */}
                {evalsFiltradas.length > 0 && evalsFiltradas[0]?.criterios?.length > 0 && (
                  <details className="mt-3">
                    <summary className="small fw-medium" style={{ cursor: 'pointer' }}>
                      Detalle criterios: {evalsFiltradas[0].tipo === 'seleccion' ? 'Selección' : 'Evaluación'} {evalsFiltradas[0].anio}
                    </summary>
                    <table className="table table-sm table-bordered mt-2" style={{ fontSize: '0.8rem' }}>
                      <thead className="table-light">
                        <tr><th>CRITERIO</th><th className="text-center">PUNTAJE</th><th className="text-center">VALOR</th></tr>
                      </thead>
                      <tbody>
                        {evalsFiltradas[0].criterios.map(c => (
                          <tr key={c.criterio}>
                            <td>{c.criterio}</td>
                            <td className="text-center">
                              <span className={`badge ${c.puntaje === 'MUY BUENO' ? 'bg-success' : c.puntaje === 'BUENO' ? 'bg-primary' : c.puntaje === 'REGULAR' ? 'bg-warning text-dark' : c.puntaje === 'MALO' ? 'bg-danger' : 'bg-secondary'}`}>
                                {c.puntaje || '—'}
                              </span>
                            </td>
                            <td className="text-center text-muted">
                              {c.puntaje && c.puntaje !== 'NO APLICA' ? PUNTAJES[c.puntaje] : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </details>
                )}
              </div>
            </div>
          )
        }
      </div>

      {/* Modal formulario */}
      {modalForm !== null && selProv && (
        <FormEvaluacion
          proveedor={selProv}
          evalEdit={modalForm === 'nuevo' ? null : modalForm}
          onClose={() => setModalForm(null)}
          onGuardado={() => { setModalForm(null); cargarEvals() }}
        />
      )}
    </div>
  )
}
