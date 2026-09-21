import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'
import { hoyLocal } from '../../utils/fecha'
import { puedeEscribir } from '../../store/authStore'
import { MONTO_OCULTO, esMontoOculto } from '../../utils/montoOculto'

const ESTADOS_P = {
  Activo:     'success',
  'En espera':'warning',
  Completado: 'primary',
  Cancelado:  'danger',
}

const fmtN = n => esMontoOculto(n) ? MONTO_OCULTO : new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0)
// Mano de obra, materiales y costo total se calculan siempre en pesos (el
// backend convierte cualquier material cargado en dólares/euros antes de
// sumar) — el precio de costo de cada material se muestra en su moneda de
// origen para que quede claro qué se está convirtiendo.
const fmtEnMoneda = (n, moneda) => {
  if (esMontoOculto(n)) return MONTO_OCULTO
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: moneda === 'DÓLAR' ? 'USD' : moneda === 'EURO' ? 'EUR' : 'ARS',
    maximumFractionDigits: 2,
  }).format(n || 0)
}

// Todo total se calcula en pesos — acá se muestra además su equivalente en
// dólares al tipo de cambio del sistema (null si no hay tasa cargada, se
// avisa en vez de inventar un número).
function MontoDual({ pesos, dolares, align = 'end', className = '' }) {
  return (
    <div className={`d-flex flex-column align-items-${align} ${className}`} style={{ lineHeight: 1.25 }}>
      <span>{fmtEnMoneda(pesos, 'PESOS')}</span>
      <span className="text-muted" style={{ fontSize: '0.76em' }}>
        {dolares != null ? fmtEnMoneda(dolares, 'DÓLAR') : '—'}
      </span>
    </div>
  )
}

export default function AnalisisProyectos() {
  const [proyectos, setProyectos] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [buscar,    setBuscar]    = useState('')
  const [orden,     setOrden]     = useState('nombre')

  const [detalle,      setDetalle]      = useState(null)
  const [loadingDet,   setLoadingDet]   = useState(false)
  const [exportando,   setExportando]   = useState(false)
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

  const exportarExcel = async () => {
    if (!detalle?.id) return
    setExportando(true)
    try {
      const r = await api.get(`/analisis-proyectos/${detalle.id}/exportar`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([r.data]))
      const a = document.createElement('a')
      a.href = url; a.download = `analisis_${detalle.codigo}_${hoyLocal()}.xlsx`; a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert('No se pudo exportar')
    } finally { setExportando(false) }
  }

  const abrirDetalle = proyecto => {
    setDetalle({ id: proyecto.id, codigo: proyecto.codigo })
    setLoadingDet(true)
    api.get(`/analisis-proyectos/${proyecto.id}`)
      .then(r => setDetalle(r.data))
      .catch(e => { console.error(e); alert('No se pudo cargar el detalle') })
      .finally(() => setLoadingDet(false))
  }

  // Mismo criterio que el listado de Proyectos: alfabético por nombre,
  // "Completado" al final y "Cancelado" después de eso — acá se respeta
  // incluso si se elige ordenar por un costo, para no mezclar proyectos ya
  // cerrados entre los activos.
  const rangoEstado = e => e === 'Cancelado' ? 2 : e === 'Completado' ? 1 : 0
  const filtrados = proyectos
    .filter(p => !buscar.trim() || `${p.codigo} ${p.nombre} ${p.cliente_nombre || ''}`.toLowerCase().includes(buscar.toLowerCase()))
    .sort((a, b) => {
      const comp = rangoEstado(a.estado) - rangoEstado(b.estado)
      if (comp !== 0) return comp
      if (orden === 'nombre') return (a.nombre || '').localeCompare(b.nombre || '', 'es', { sensitivity: 'base' })
      return (esMontoOculto(b[orden]) ? 0 : b[orden] || 0) - (esMontoOculto(a[orden]) ? 0 : a[orden] || 0)
    })

  // Si el backend enmascaró los montos (usuario con "oculta_montos"), todas
  // las filas vienen ocultas por igual — no tiene sentido sumar el sentinel,
  // el total también queda oculto.
  const totales = filtrados.some(p => esMontoOculto(p.costo_total))
    ? { horas: filtrados.reduce((s, p) => s + (p.horas_totales || 0), 0),
        manoObra: MONTO_OCULTO, materiales: MONTO_OCULTO, total: MONTO_OCULTO,
        manoObraUsd: null, materialesUsd: null, totalUsd: null }
    : filtrados.reduce((s, p) => ({
        horas: s.horas + (p.horas_totales || 0),
        manoObra: s.manoObra + (p.costo_mano_obra || 0),
        materiales: s.materiales + (p.costo_materiales || 0),
        total: s.total + (p.costo_total || 0),
        manoObraUsd:   (s.manoObraUsd == null || p.costo_mano_obra_usd == null)  ? null : s.manoObraUsd + p.costo_mano_obra_usd,
        materialesUsd: (s.materialesUsd == null || p.costo_materiales_usd == null) ? null : s.materialesUsd + p.costo_materiales_usd,
        totalUsd:      (s.totalUsd == null || p.costo_total_usd == null) ? null : s.totalUsd + p.costo_total_usd,
      }), { horas: 0, manoObra: 0, materiales: 0, total: 0, manoObraUsd: 0, materialesUsd: 0, totalUsd: 0 })

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
          <option value="nombre">Ordenar alfabéticamente</option>
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
                    <td className="text-end"><MontoDual pesos={p.costo_mano_obra} dolares={p.costo_mano_obra_usd} /></td>
                    <td className="text-end"><MontoDual pesos={p.costo_materiales} dolares={p.costo_materiales_usd} /></td>
                    <td className="text-end fw-semibold"><MontoDual pesos={p.costo_total} dolares={p.costo_total_usd} /></td>
                  </tr>
                ))}
              </tbody>
              {filtrados.length > 0 && (
                <tfoot className="table-light">
                  <tr className="fw-semibold">
                    <td colSpan={4} className="text-end">Totales:</td>
                    <td className="text-end">{fmtN(totales.horas)}</td>
                    <td className="text-end"><MontoDual pesos={totales.manoObra} dolares={totales.manoObraUsd} /></td>
                    <td className="text-end"><MontoDual pesos={totales.materiales} dolares={totales.materialesUsd} /></td>
                    <td className="text-end"><MontoDual pesos={totales.total} dolares={totales.totalUsd} /></td>
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
                {!loadingDet && puedeEscribir('analisis_proyectos') && (
                  <button className="btn btn-sm btn-outline-success ms-2" disabled={exportando} onClick={exportarExcel}>
                    {exportando
                      ? <span className="spinner-border spinner-border-sm me-1" />
                      : <i className="bi bi-file-earmark-excel me-1" />}
                    Exportar a Excel
                  </button>
                )}
                <button className="btn-close ms-2" onClick={() => setDetalle(null)} />
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
                          <div className="fw-bold"><MontoDual align="center" pesos={detalle.costo_mano_obra} dolares={detalle.costo_mano_obra_usd} /></div>
                        </div>
                      </div>
                      <div className="col-4">
                        <div className="border rounded p-2 text-center">
                          <div className="text-muted small">Materiales</div>
                          <div className="fw-bold"><MontoDual align="center" pesos={detalle.costo_materiales} dolares={detalle.costo_materiales_usd} /></div>
                        </div>
                      </div>
                      <div className="col-4">
                        <div className="border rounded p-2 text-center bg-light">
                          <div className="text-muted small">Costo total</div>
                          <div className="fw-bold"><MontoDual align="center" pesos={detalle.costo_total} dolares={detalle.costo_total_usd} /></div>
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
                              <td className="text-end text-muted">{fmtEnMoneda(e.costo_hora, 'PESOS')}</td>
                              <td className="text-end fw-semibold"><MontoDual pesos={e.subtotal} dolares={e.subtotal_usd} /></td>
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
                              <td className="text-end text-muted">{fmtEnMoneda(m.precio_costo, m.precio_moneda)}</td>
                              <td className="text-end fw-semibold"><MontoDual pesos={m.subtotal} dolares={m.subtotal_usd} /></td>
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
