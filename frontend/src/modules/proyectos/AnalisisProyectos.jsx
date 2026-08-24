import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'

const ESTADOS_P = {
  Activo:     'success',
  'En espera':'warning',
  Completado: 'primary',
  Cancelado:  'danger',
}

const fmtN = n => new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0)

export default function AnalisisProyectos() {
  const [proyectos, setProyectos] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [buscar,    setBuscar]    = useState('')
  const [orden,     setOrden]     = useState('costo_total')

  const [detalle,      setDetalle]      = useState(null)
  const [loadingDet,   setLoadingDet]   = useState(false)
  // Materiales con un "pedido de precio" pendiente hacia Administración.
  const [pedidosPrecioIds, setPedidosPrecioIds] = useState(new Set())
  const [pidiendoPrecio,   setPidiendoPrecio]   = useState(null)

  const cargar = useCallback(() => {
    setLoading(true)
    api.get('/analisis-proyectos')
      .then(r => setProyectos(r.data))
      .catch(e => console.error(e))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { cargar() }, [cargar])

  useEffect(() => {
    api.get('/pedidos-precio/pendientes-ids')
      .then(r => setPedidosPrecioIds(new Set(r.data.map(p => p.producto_id))))
      .catch(e => console.error(e))
  }, [])

  const pedirPrecio = async producto_id => {
    setPidiendoPrecio(producto_id)
    try {
      await api.post('/pedidos-precio', { producto_id })
      setPedidosPrecioIds(prev => new Set(prev).add(producto_id))
    } catch (e) {
      alert(e.response?.data?.error || 'No se pudo enviar el pedido de precio')
    } finally { setPidiendoPrecio(null) }
  }

  const abrirDetalle = proyecto => {
    setDetalle({ id: proyecto.id, codigo: proyecto.codigo })
    setLoadingDet(true)
    api.get(`/analisis-proyectos/${proyecto.id}`)
      .then(r => setDetalle(r.data))
      .catch(e => { console.error(e); alert('No se pudo cargar el detalle') })
      .finally(() => setLoadingDet(false))
  }

  const filtrados = proyectos
    .filter(p => !buscar.trim() || `${p.codigo} ${p.nombre} ${p.cliente_nombre || ''}`.toLowerCase().includes(buscar.toLowerCase()))
    .sort((a, b) => (b[orden] || 0) - (a[orden] || 0))

  const totales = filtrados.reduce((s, p) => ({
    horas: s.horas + (p.horas_totales || 0),
    manoObra: s.manoObra + (p.costo_mano_obra || 0),
    materiales: s.materiales + (p.costo_materiales || 0),
    total: s.total + (p.costo_total || 0),
  }), { horas: 0, manoObra: 0, materiales: 0, total: 0 })

  return (
    <div>
      <h4 className="mb-0 fw-bold">
        <i className="bi bi-graph-up-arrow me-2 text-primary" />
        Análisis de Proyectos
      </h4>
      <p className="text-muted small mb-3">
        Costo de mano de obra (horas cargadas en Mi Parte × costo por hora) y de materiales (retirados de stock × precio de costo del catálogo) de cada proyecto.
      </p>

      <div className="d-flex gap-2 flex-wrap mb-3">
        <input className="form-control form-control-sm" style={{ width: 260 }} placeholder="Buscar código, nombre o cliente..."
          value={buscar} onChange={e => setBuscar(e.target.value)} />
        <select className="form-select form-select-sm" style={{ width: 200 }} value={orden} onChange={e => setOrden(e.target.value)}>
          <option value="costo_total">Ordenar por costo total</option>
          <option value="costo_mano_obra">Ordenar por mano de obra</option>
          <option value="costo_materiales">Ordenar por materiales</option>
          <option value="horas_totales">Ordenar por horas</option>
        </select>
      </div>

      {loading ? (
        <div className="d-flex justify-content-center py-5"><span className="spinner-border text-secondary" /></div>
      ) : (
        <div className="card border-0 shadow-sm">
          <div className="table-responsive" style={{ maxHeight: 'calc(100vh - 320px)', overflowY: 'auto' }}>
            <table className="table table-hover table-sm mb-0" style={{ fontSize: '0.83rem' }}>
              <thead className="table-dark sticky-top">
                <tr>
                  <th>Código</th>
                  <th>Proyecto</th>
                  <th>Cliente</th>
                  <th>Estado</th>
                  <th className="text-end">Horas</th>
                  <th className="text-end">Mano de obra</th>
                  <th className="text-end">Materiales</th>
                  <th className="text-end">Costo total</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.length === 0 ? (
                  <tr><td colSpan={8} className="text-center text-muted py-4">Sin resultados</td></tr>
                ) : filtrados.map(p => (
                  <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => abrirDetalle(p)}>
                    <td className="font-monospace fw-semibold text-primary">{p.codigo}</td>
                    <td>{p.nombre}</td>
                    <td className="text-muted">{p.cliente_nombre || '—'}</td>
                    <td><span className={`badge bg-${ESTADOS_P[p.estado] || 'secondary'}`} style={{ fontSize: '0.7rem' }}>{p.estado}</span></td>
                    <td className="text-end">{fmtN(p.horas_totales)}</td>
                    <td className="text-end">{fmtN(p.costo_mano_obra)}</td>
                    <td className="text-end">{fmtN(p.costo_materiales)}</td>
                    <td className="text-end fw-semibold">{fmtN(p.costo_total)}</td>
                  </tr>
                ))}
              </tbody>
              {filtrados.length > 0 && (
                <tfoot className="table-light">
                  <tr className="fw-semibold">
                    <td colSpan={4} className="text-end">Totales:</td>
                    <td className="text-end">{fmtN(totales.horas)}</td>
                    <td className="text-end">{fmtN(totales.manoObra)}</td>
                    <td className="text-end">{fmtN(totales.materiales)}</td>
                    <td className="text-end">{fmtN(totales.total)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* ══ MODAL: DETALLE POR EMPLEADO Y MATERIAL ══════════════════════ */}
      {detalle && (
        <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.5)' }}>
          <div className="modal-dialog modal-lg modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h5 className="modal-title">
                  <i className="bi bi-graph-up-arrow me-2 text-primary" />
                  {detalle.codigo} {detalle.nombre ? `— ${detalle.nombre}` : ''}
                </h5>
                <button className="btn-close" onClick={() => setDetalle(null)} />
              </div>
              <div className="modal-body">
                {loadingDet ? (
                  <div className="text-center py-4"><span className="spinner-border spinner-border-sm" /></div>
                ) : (
                  <>
                    <div className="row g-2 mb-3">
                      <div className="col-4">
                        <div className="border rounded p-2 text-center">
                          <div className="text-muted small">Mano de obra</div>
                          <div className="fw-bold">{fmtN(detalle.costo_mano_obra)}</div>
                        </div>
                      </div>
                      <div className="col-4">
                        <div className="border rounded p-2 text-center">
                          <div className="text-muted small">Materiales</div>
                          <div className="fw-bold">{fmtN(detalle.costo_materiales)}</div>
                        </div>
                      </div>
                      <div className="col-4">
                        <div className="border rounded p-2 text-center bg-light">
                          <div className="text-muted small">Costo total</div>
                          <div className="fw-bold">{fmtN(detalle.costo_total)}</div>
                        </div>
                      </div>
                    </div>

                    <h6 className="fw-semibold small text-uppercase text-muted">Por empleado ({fmtN(detalle.horas_totales)} hs)</h6>
                    {detalle.porEmpleado?.length ? (
                      <table className="table table-sm mb-4" style={{ fontSize: '0.8rem' }}>
                        <thead className="table-light">
                          <tr><th>Empleado</th><th className="text-end">Horas</th><th className="text-end">Costo/hora</th><th className="text-end">Subtotal</th></tr>
                        </thead>
                        <tbody>
                          {detalle.porEmpleado.map(e => (
                            <tr key={e.empleado_id}>
                              <td>{e.nombre}</td>
                              <td className="text-end">{fmtN(e.horas)}</td>
                              <td className="text-end text-muted">{fmtN(e.costo_hora)}</td>
                              <td className="text-end fw-semibold">{fmtN(e.subtotal)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="text-muted small mb-4">Sin horas cargadas para este proyecto todavía.</p>
                    )}

                    <h6 className="fw-semibold small text-uppercase text-muted">Por material</h6>
                    {detalle.porMaterial?.length ? (
                      <table className="table table-sm mb-0" style={{ fontSize: '0.8rem' }}>
                        <thead className="table-light">
                          <tr><th>Material</th><th className="text-end">Cant.</th><th className="text-end">Precio costo</th><th className="text-end">Subtotal</th><th></th></tr>
                        </thead>
                        <tbody>
                          {detalle.porMaterial.map(m => (
                            <tr key={m.id}>
                              <td>{m.descripcion}{m.codigo ? <span className="text-muted"> ({m.codigo})</span> : ''}</td>
                              <td className="text-end">{fmtN(m.cantidad)} {m.unidad}</td>
                              <td className="text-end text-muted">{fmtN(m.precio_costo)}</td>
                              <td className="text-end fw-semibold">{fmtN(m.subtotal)}</td>
                              <td className="text-end" style={{ width: 110 }}>
                                {pedidosPrecioIds.has(m.id) ? (
                                  <span className="text-warning" style={{ fontSize: '0.72rem' }}>
                                    <i className="bi bi-clock-history me-1" />Pedido
                                  </span>
                                ) : (
                                  <button type="button" className="btn btn-link btn-sm p-0 text-decoration-none"
                                    style={{ fontSize: '0.72rem' }} disabled={pidiendoPrecio === m.id}
                                    onClick={() => pedirPrecio(m.id)}>
                                    <i className="bi bi-cash-coin me-1" />Pedir precio
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="text-muted small mb-0">Sin materiales retirados de stock para este proyecto todavía.</p>
                    )}
                  </>
                )}
              </div>
              <div className="modal-footer">
                <button className="btn btn-secondary btn-sm" onClick={() => setDetalle(null)}>Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
