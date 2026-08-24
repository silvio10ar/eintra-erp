import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'
import { puedeEscribir } from '../../store/authStore'
import { manejarPegadoNumero } from '../../utils/numero'

const ESTADO_CLS = {
  Pendiente: 'bg-warning text-dark',
  Parcial:   'bg-info text-dark',
  Entregado: 'bg-success',
  Cancelado: 'bg-secondary',
}

const fmtF = s => {
  if (!s) return '—'
  const d = new Date(s.replace(' ', 'T'))
  return isNaN(d) ? s : d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function PedidoStock() {
  const canWrite = puedeEscribir('pedidos_stock')

  const [productos,      setProductos]      = useState([])
  const [proyectosLista, setProyectosLista] = useState([])
  const [actividadesLista, setActividadesLista] = useState([])
  const [autorizantes,  setAutorizantes]    = useState([])
  const [pedidos,   setPedidos]   = useState([])
  const [retirosDirectos, setRetirosDirectos] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [errorCarga, setErrorCarga] = useState('')

  const [items,         setItems]         = useState([])
  const [busqueda,      setBusqueda]      = useState('')
  const [sugerencias,   setSugerencias]   = useState([])
  const [observaciones, setObservaciones] = useState('')
  const [asignacion,    setAsignacion]    = useState('') // 'p:<id>' | 'a:<id>' | ''
  const [autorizadoPorId, setAutorizadoPorId] = useState('')
  const [guardando,     setGuardando]     = useState(false)
  const [error,         setError]         = useState('')

  const cargar = useCallback(() => {
    setLoading(true)
    setErrorCarga('')
    Promise.allSettled([
      api.get('/stock/productos-para-pedido'),
      api.get('/stock/pedidos/mios'),
      api.get('/rrhh/proyectos'),
      api.get('/rrhh/actividades'),
      api.get('/stock/movimientos/mios-directos'),
      api.get('/stock/autorizantes'),
    ]).then(([rp, rped, rproy, ract, rdir, raut]) => {
      if (rp.status === 'fulfilled') setProductos(rp.value.data)
      if (rped.status === 'fulfilled') setPedidos(rped.value.data)
      if (rproy.status === 'fulfilled') setProyectosLista(rproy.value.data.filter(p => p.estado === 'Activo'))
      if (ract.status === 'fulfilled') setActividadesLista(ract.value.data.filter(a => a.activo))
      if (rdir.status === 'fulfilled') setRetirosDirectos(rdir.value.data)
      if (raut.status === 'fulfilled') setAutorizantes(raut.value.data)
      const fallidos = [
        rp.status === 'rejected' && 'materiales',
        rped.status === 'rejected' && 'mis pedidos',
        rproy.status === 'rejected' && 'proyectos',
        ract.status === 'rejected' && 'actividades',
        rdir.status === 'rejected' && 'retiros directos',
        raut.status === 'rejected' && 'autorizantes',
      ].filter(Boolean)
      if (fallidos.length) {
        console.error('Error cargando Pedido de Stock:', [rp, rped, rproy, ract, rdir, raut].filter(r => r.status === 'rejected').map(r => r.reason))
        setErrorCarga(`No se pudo cargar: ${fallidos.join(', ')}. Probá recargar la página.`)
      }
    }).finally(() => setLoading(false))
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const buscar = txt => {
    setBusqueda(txt)
    if (!txt.trim()) { setSugerencias([]); return }
    const words = txt.toLowerCase().split(/\s+/).filter(Boolean)
    const yaAgregados = new Set(items.map(i => i.producto_id))
    setSugerencias(
      productos
        .filter(p => !yaAgregados.has(p.id))
        .filter(p => { const h = (p.codigo + ' ' + p.descripcion).toLowerCase(); return words.every(w => h.includes(w)) })
        .slice(0, 8)
    )
  }

  const agregarProducto = p => {
    setItems(prev => [...prev, { producto_id: p.id, codigo: p.codigo, descripcion: p.descripcion, unidad: p.unidad, stock_actual: p.stock_actual, cantidad: 1 }])
    setBusqueda(''); setSugerencias([])
  }

  const quitarItem = idx => setItems(prev => prev.filter((_, i) => i !== idx))
  const setCantidad = (idx, val) => setItems(prev => prev.map((it, i) => i === idx ? { ...it, cantidad: val } : it))

  const enviarPedido = async () => {
    setError('')
    if (items.length === 0) return setError('Agregá al menos un ítem')
    for (const it of items) {
      if (!parseFloat(it.cantidad) || parseFloat(it.cantidad) <= 0) return setError(`Cargá una cantidad válida para "${it.descripcion}"`)
    }
    if (!asignacion) return setError('Elegí un proyecto o actividad — la salida de stock tiene que quedar atribuida a uno de los dos')
    if (!autorizadoPorId) return setError('Elegí quién autoriza este pedido')
    const esActividad = asignacion.startsWith('a:')
    const asigId = Number(asignacion.slice(2))
    setGuardando(true)
    try {
      await api.post('/stock/pedidos', {
        items: items.map(it => ({ producto_id: it.producto_id, cantidad: it.cantidad })),
        observaciones,
        proyecto_id: esActividad ? null : asigId,
        actividad_id: esActividad ? asigId : null,
        autorizado_por_id: autorizadoPorId,
      })
      setItems([]); setObservaciones(''); setAsignacion(''); setAutorizadoPorId('')
      cargar()
    } catch (e) {
      setError(e.response?.data?.error || 'Error al enviar el pedido')
    } finally { setGuardando(false) }
  }

  const cancelarPedido = async ped => {
    if (!confirm(`¿Cancelar el pedido #${ped.id}?`)) return
    try {
      await api.delete(`/stock/pedidos/${ped.id}`)
      cargar()
    } catch (e) {
      alert(e.response?.data?.error || 'Error al cancelar')
    }
  }

  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '50vh' }}>
        <span className="spinner-border text-secondary" />
      </div>
    )
  }

  return (
    <div>
      <div className="d-flex align-items-center mb-3">
        <h4 className="mb-0 fw-bold">
          <i className="bi bi-clipboard-check me-2 text-primary" />
          Pedido de Stock
        </h4>
      </div>
      <p className="text-muted small mb-4">
        Pedí los materiales que necesitás — le va a aparecer a Depósito para que confirme la entrega.
      </p>

      {errorCarga && <div className="alert alert-warning py-2 small">{errorCarga}</div>}

      {canWrite && (
        <div className="card border-0 shadow-sm mb-4">
          <div className="card-body">
            <h6 className="fw-semibold mb-3">Nuevo pedido</h6>

            <div className="mb-2 position-relative">
              <label className="form-label small fw-semibold">Buscar material</label>
              <input className="form-control form-control-sm" placeholder="Código o descripción..."
                value={busqueda} onChange={e => buscar(e.target.value)} autoComplete="off" />
              {sugerencias.length > 0 && (
                <div className="list-group position-absolute w-100 shadow-sm" style={{ zIndex: 10, maxHeight: 240, overflowY: 'auto' }}>
                  {sugerencias.map(p => (
                    <button type="button" key={p.id} className="list-group-item list-group-item-action py-2"
                      onClick={() => agregarProducto(p)}>
                      <span className="fw-semibold">{p.codigo}</span> — {p.descripcion}
                      <span className="text-muted small ms-2">(disponible: {p.stock_actual} {p.unidad})</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {items.length > 0 && (
              <table className="table table-sm align-middle mt-3">
                <thead className="table-light">
                  <tr>
                    <th>Código</th><th>Descripción</th><th style={{ width: 130 }}>Cantidad</th><th style={{ width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={idx}>
                      <td className="font-monospace">{it.codigo}</td>
                      <td>{it.descripcion}</td>
                      <td>
                        <div className="input-group input-group-sm">
                          <input type="number" onPaste={manejarPegadoNumero} min="0.01" step="any" className="form-control"
                            value={it.cantidad} onChange={e => setCantidad(idx, e.target.value)} />
                          <span className="input-group-text">{it.unidad}</span>
                        </div>
                      </td>
                      <td>
                        <button className="btn btn-sm btn-outline-danger" onClick={() => quitarItem(idx)}>
                          <i className="bi bi-trash" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="row g-2 mt-2">
              <div className="col-md-6">
                <label className="form-label small fw-semibold">Proyecto o Actividad <span className="text-danger">*</span></label>
                <select className="form-select form-select-sm" value={asignacion} onChange={e => setAsignacion(e.target.value)}>
                  <option value="">— Elegir —</option>
                  {proyectosLista.length > 0 && (
                    <optgroup label="Proyectos">
                      {proyectosLista.map(p => <option key={`p:${p.id}`} value={`p:${p.id}`}>{p.codigo} — {p.nombre}</option>)}
                    </optgroup>
                  )}
                  {actividadesLista.length > 0 && (
                    <optgroup label="Actividades">
                      {actividadesLista.map(a => <option key={`a:${a.id}`} value={`a:${a.id}`}>{a.nombre}</option>)}
                    </optgroup>
                  )}
                </select>
              </div>
              <div className="col-md-6">
                <label className="form-label small fw-semibold">Observaciones <span className="fw-normal text-muted">(opcional)</span></label>
                <input className="form-control form-control-sm" value={observaciones} onChange={e => setObservaciones(e.target.value)} />
              </div>
              <div className="col-md-6">
                <label className="form-label small fw-semibold">Autorizado por <span className="text-danger">*</span></label>
                <select className="form-select form-select-sm" value={autorizadoPorId} onChange={e => setAutorizadoPorId(e.target.value)}>
                  <option value="">— Elegir —</option>
                  {autorizantes.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
                </select>
                <div className="form-text">Le llega una notificación cuando Depósito entregue el pedido</div>
              </div>
            </div>

            {error && <div className="alert alert-danger py-2 small mt-3 mb-0">{error}</div>}

            <button className="btn btn-primary btn-sm mt-3" onClick={enviarPedido} disabled={guardando || items.length === 0}>
              {guardando ? <><span className="spinner-border spinner-border-sm me-1" />Enviando...</> : <><i className="bi bi-send me-1" />Enviar pedido</>}
            </button>
          </div>
        </div>
      )}

      <h6 className="fw-semibold mb-2">Mis pedidos</h6>
      {pedidos.length === 0 ? (
        <div className="text-center text-muted py-5">
          <i className="bi bi-inbox display-6 d-block mb-2" />Todavía no hiciste ningún pedido
        </div>
      ) : (
        <div className="d-flex flex-column gap-2">
          {pedidos.map(ped => (
            <div key={ped.id} className="card border-0 shadow-sm">
              <div className="card-body py-2">
                <div className="d-flex justify-content-between align-items-center mb-2">
                  <div>
                    <span className="fw-semibold me-2">Pedido #{ped.id}</span>
                    <span className="text-muted small">{fmtF(ped.fecha)}</span>
                    <span className="badge bg-light text-dark border ms-2">
                      {ped.actividad_nombre || `${ped.proyecto_codigo} — ${ped.proyecto_nombre}`}
                    </span>
                  </div>
                  <div className="d-flex align-items-center gap-2">
                    <span className={`badge ${ESTADO_CLS[ped.estado] || 'bg-secondary'}`}>{ped.estado}</span>
                    {ped.estado === 'Pendiente' && canWrite && (
                      <button className="btn btn-sm btn-outline-danger py-0 px-2" onClick={() => cancelarPedido(ped)}>
                        <i className="bi bi-x-lg" />
                      </button>
                    )}
                  </div>
                </div>
                <table className="table table-sm mb-0">
                  <tbody>
                    {ped.items.map(it => (
                      <tr key={it.id}>
                        <td className="font-monospace" style={{ width: 120 }}>{it.codigo}</td>
                        <td>{it.descripcion}</td>
                        <td className="text-end" style={{ width: 140 }}>
                          {it.cantidad_entregada > 0 && it.cantidad_entregada < it.cantidad
                            ? <span className="text-info fw-semibold">{it.cantidad_entregada} / {it.cantidad} {it.unidad}</span>
                            : it.cantidad_entregada >= it.cantidad
                              ? <span className="text-success fw-semibold">{it.cantidad} {it.unidad} ✓</span>
                              : <span className="text-muted">{it.cantidad} {it.unidad}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {ped.autorizado_por_nombre && (
                  <p className="text-muted small mt-2 mb-0">Autorizado por: {ped.autorizado_por_nombre}</p>
                )}
                {ped.observaciones && <p className="text-muted small mt-1 mb-0">{ped.observaciones}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      <h6 className="fw-semibold mb-2 mt-4">Retiros directos del stock (último mes)</h6>
      <p className="text-muted small mb-2">
        Materiales que retiraste directamente del depósito, sin pasar por un pedido.
      </p>
      {retirosDirectos.length === 0 ? (
        <div className="text-center text-muted py-4">
          <i className="bi bi-box-seam display-6 d-block mb-2" />No tenés retiros directos en el último mes
        </div>
      ) : (
        <div className="card border-0 shadow-sm">
          <div className="card-body py-2">
            <table className="table table-sm mb-0">
              <thead className="table-light">
                <tr>
                  <th style={{ width: 100 }}>Fecha</th>
                  <th className="font-monospace" style={{ width: 120 }}>Código</th>
                  <th>Descripción</th>
                  <th className="text-end" style={{ width: 100 }}>Cantidad</th>
                  <th>Proyecto / referencia</th>
                </tr>
              </thead>
              <tbody>
                {retirosDirectos.map(r => (
                  <tr key={r.id}>
                    <td className="text-muted">{fmtF(r.fecha)}</td>
                    <td className="font-monospace">{r.codigo}</td>
                    <td>{r.descripcion}</td>
                    <td className="text-end">{r.cantidad} {r.unidad}</td>
                    <td className="text-muted small">{r.proyecto || r.cliente_interno || r.referencia || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
