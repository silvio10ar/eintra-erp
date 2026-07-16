import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'

const FUENTE_COLOR = {
  'Maestro':      'primary',
  'Compras/OC':   'success',
  'Ingr.s/OC':    'info',
  'Facturas':     'warning',
  'Stock':        'secondary',
  'Movim.':       'secondary',
  'Mantenimiento':'danger',
  'Ing.Pend.':    'light',
  'Ing.Sin OC':   'light',
}

export default function FusionProveedores({ canWrite }) {
  const [lista,      setLista]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [buscar,     setBuscar]     = useState('')
  const [seleccionados, setSeleccionados] = useState(new Set())
  const [modal,      setModal]      = useState(null)
  const [canonNombre, setCanonNombre] = useState('')
  const [canonCuit,   setCanonCuit]   = useState('')
  const [canonIdx,    setCanonIdx]    = useState(0)
  const [guardando,  setGuardando]  = useState(false)
  const [resultado,  setResultado]  = useState(null)
  const [soloCandidatos, setSoloCandidatos] = useState(false)
  const [detalle,    setDetalle]    = useState(null)   // { nombre, data }
  const [loadingDet, setLoadingDet] = useState(false)

  const cargar = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/compras/proveedores/fusiones/todos')
      setLista(data)
      setSeleccionados(new Set())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { cargar() }, [cargar])

  // ── Filtros ────────────────────────────────────────────────────────────────
  const filtrada = lista.filter(p => {
    if (buscar && !p.nombre.toLowerCase().includes(buscar.toLowerCase())) return false
    if (soloCandidatos) {
      // Mostrar solo filas sin maestro O con fuentes extra además del maestro
      const sinMaestro = !p.proveedor_id
      const conExtra   = p.proveedor_id && p.fuentes.some(f => f !== 'Maestro')
      return sinMaestro || conExtra
    }
    return true
  })

  // ── Toggle selección ───────────────────────────────────────────────────────
  const toggleSel = (nombre_upper) => {
    setSeleccionados(prev => {
      const n = new Set(prev)
      if (n.has(nombre_upper)) n.delete(nombre_upper)
      else n.add(nombre_upper)
      return n
    })
  }

  const selAll = (e) => {
    if (e.target.checked) setSeleccionados(new Set(filtrada.map(p => p.nombre_upper)))
    else setSeleccionados(new Set())
  }

  // ── Abrir modal de fusión ──────────────────────────────────────────────────
  const abrirFusion = () => {
    const selRows = lista.filter(p => seleccionados.has(p.nombre_upper))
    setCanonIdx(0)
    setCanonNombre(selRows[0]?.nombre || '')
    setCanonCuit(selRows.find(p => p.cuit)?.cuit || '')
    setResultado(null)
    setModal({ rows: selRows })
  }

  // Cuando cambia la opción de canónico, pre-rellena nombre y cuit
  const elegirCanon = (idx) => {
    const row = modal.rows[idx]
    setCanonIdx(idx)
    setCanonNombre(row.nombre)
    setCanonCuit(row.cuit || canonCuit)
  }

  // ── Aplicar fusión ─────────────────────────────────────────────────────────
  const aplicar = async () => {
    if (!canWrite) return
    const rows = modal.rows
    const canonRow = rows[canonIdx]

    // master_id: el id del canónico si tiene entrada en maestro, si no null (se crea)
    const master_id = canonRow.proveedor_id || null

    // duplicados_ids: todos los que tienen proveedor_id EXCEPTO el canónico
    const duplicados_ids = rows
      .filter((r, i) => i !== canonIdx && r.proveedor_id)
      .map(r => r.proveedor_id)

    // nombres_texto: todos los que NO tienen proveedor_id (texto libre) + el canonRow si cambió el nombre
    const nombres_texto = rows
      .filter((r, i) => i !== canonIdx && !r.proveedor_id)
      .map(r => r.nombre)
    // Si el canónico tenía nombre diferente al elegido, también reasignar el nombre viejo
    if (canonRow.nombre !== canonNombre) nombres_texto.push(canonRow.nombre)

    setGuardando(true)
    try {
      const { data } = await api.post('/compras/proveedores/fusiones/aplicar', {
        master_id,
        nombre_canon: canonNombre,
        cuit: canonCuit,
        duplicados_ids,
        nombres_texto,
      })
      setResultado(data.stats)
      await cargar()
      setModal(null)
    } catch (e) {
      alert('Error: ' + (e.response?.data?.error || e.message))
    } finally {
      setGuardando(false)
    }
  }

  const verDetalle = async (nombre) => {
    setLoadingDet(true)
    setDetalle({ nombre, data: null })
    try {
      const { data } = await api.get('/compras/proveedores/fusiones/detalle', { params: { nombre } })
      setDetalle({ nombre, data })
    } catch { setDetalle({ nombre, data: {} }) }
    finally { setLoadingDet(false) }
  }

  const selRows = lista.filter(p => seleccionados.has(p.nombre_upper))
  const totalMaestro = lista.filter(p => p.proveedor_id && p.activo === 1).length
  const totalSinMaestro = lista.filter(p => !p.proveedor_id).length

  return (
    <div>
      {/* ── Cabecera ── */}
      <div className="d-flex align-items-start justify-content-between flex-wrap gap-2 mb-3">
        <div>
          <h5 className="mb-0 fw-bold">
            <i className="bi bi-shuffle me-2 text-primary"/>Fusión de Proveedores
          </h5>
          <div className="text-muted mt-1" style={{ fontSize: '0.82rem' }}>
            Muestra todos los nombres de proveedor de todos los módulos. Seleccioná duplicados y fusionalos en un único registro maestro.
          </div>
        </div>
        <div className="d-flex gap-2">
          {canWrite && (
            <button className="btn btn-sm btn-outline-warning" title="Eliminar proveedores inactivos que quedaron de fusiones anteriores"
              onClick={async () => {
                if (!confirm('¿Eliminar los proveedores inactivos sin datos asociados?')) return
                try {
                  const { data } = await api.post('/compras/proveedores/fusiones/limpiar-inactivos')
                  alert(`Eliminados: ${data.eliminados}${data.noEliminados.length ? `\nCon datos (no eliminados): ${data.noEliminados.join(', ')}` : ''}`)
                  cargar()
                } catch { alert('Error al limpiar') }
              }}>
              <i className="bi bi-trash me-1"/>Limpiar inactivos
            </button>
          )}
          <button className="btn btn-sm btn-outline-secondary" onClick={cargar} disabled={loading}>
            <i className="bi bi-arrow-clockwise me-1"/>Actualizar
          </button>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="d-flex flex-wrap gap-3 mb-3">
        {[
          { label: 'Total únicos',     val: lista.length,          color: 'primary' },
          { label: 'En maestro',       val: totalMaestro,          color: 'success' },
          { label: 'Solo texto libre', val: totalSinMaestro,       color: 'warning' },
          { label: 'Seleccionados',    val: seleccionados.size,    color: 'info'    },
        ].map(s => (
          <div key={s.label} className={`border rounded px-3 py-2 text-center border-${s.color}`}
            style={{ minWidth: 100 }}>
            <div className={`fw-bold fs-5 text-${s.color}`}>{s.val}</div>
            <div className="text-muted" style={{ fontSize: '0.72rem' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {resultado && (
        <div className="alert alert-success alert-dismissible py-2 small mb-3">
          <i className="bi bi-check-circle me-1"/>
          Fusión aplicada — OC: {resultado.oc} | Form49: {resultado.form49} | Facturas: {resultado.facturas} | Stock: {resultado.productos} | Movim.: {resultado.movimientos} | Mant.: {resultado.mant} | Ing.Pend: {resultado.ing_pend}
          <button className="btn-close py-2" onClick={() => setResultado(null)}/>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="d-flex gap-2 flex-wrap align-items-center mb-2">
        <input className="form-control form-control-sm" style={{ maxWidth: 260 }}
          placeholder="Buscar..." value={buscar}
          onChange={e => { setBuscar(e.target.value); setSeleccionados(new Set()) }} />

        <div className="form-check form-switch mb-0 ms-2">
          <input className="form-check-input" type="checkbox" id="soloCand"
            checked={soloCandidatos} onChange={e => setSoloCandidatos(e.target.checked)} />
          <label className="form-check-label small" htmlFor="soloCand">
            Solo candidatos a fusionar
          </label>
        </div>

        {seleccionados.size >= 2 && canWrite && (
          <button className="btn btn-sm btn-primary ms-auto" onClick={abrirFusion}>
            <i className="bi bi-shuffle me-1"/>Fusionar seleccionados ({seleccionados.size})
          </button>
        )}
        {seleccionados.size === 1 && canWrite && (
          <button className="btn btn-sm btn-outline-success ms-auto" onClick={abrirFusion}>
            <i className="bi bi-plus-circle me-1"/>Incorporar al maestro
          </button>
        )}
      </div>

      {/* ── Tabla ── */}
      {loading ? (
        <div className="text-center py-5"><span className="spinner-border text-primary"/></div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="table table-sm table-hover align-middle mb-0" style={{ fontSize: '0.78rem' }}>
            <thead className="table-light sticky-top">
              <tr>
                <th style={{ width: 36 }}>
                  <input type="checkbox"
                    checked={filtrada.length > 0 && filtrada.every(p => seleccionados.has(p.nombre_upper))}
                    onChange={selAll} />
                </th>
                <th>Nombre</th>
                <th style={{ width: 140 }}>CUIT</th>
                <th style={{ width: 80 }}>Estado</th>
                <th>Módulos / Fuentes</th>
              </tr>
            </thead>
            <tbody>
              {filtrada.map(p => {
                const sel = seleccionados.has(p.nombre_upper)
                return (
                  <tr key={p.nombre_upper}
                    style={{ background: sel ? '#fffbf0' : undefined, cursor: 'pointer' }}
                    onClick={() => toggleSel(p.nombre_upper)}>
                    <td onClick={e => e.stopPropagation()}>
                      <input type="checkbox" checked={sel}
                        onChange={() => toggleSel(p.nombre_upper)} />
                    </td>
                    <td>
                      <strong style={{ letterSpacing: 0.2 }}>{p.nombre}</strong>
                      {p.activo === 0 && (
                        <span className="badge bg-secondary ms-2" style={{ fontSize: '0.6rem' }}>inactivo</span>
                      )}
                    </td>
                    <td className="text-muted">{p.cuit || '—'}</td>
                    <td>
                      {p.proveedor_id
                        ? <span className="badge bg-success">En maestro</span>
                        : <span className="badge bg-warning text-dark">Solo texto</span>
                      }
                    </td>
                    <td>
                      <div className="d-flex flex-wrap gap-1 align-items-center">
                        {p.fuentes.map(f => (
                          <span key={f}
                            className={`badge bg-${FUENTE_COLOR[f] || 'secondary'} text-${['light','warning'].includes(FUENTE_COLOR[f]) ? 'dark' : 'white'}`}
                            style={{ fontSize: '0.65rem' }}>
                            {f}
                          </span>
                        ))}
                        <button className="btn btn-link btn-sm p-0 ms-1 text-muted" title="Ver documentos"
                          style={{ fontSize: '0.75rem' }}
                          onClick={e => { e.stopPropagation(); verDetalle(p.nombre) }}>
                          <i className="bi bi-search"/>
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {filtrada.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-muted py-4">
                    {buscar ? 'Sin resultados para esa búsqueda' : 'Sin proveedores'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Modal de fusión ── */}
      {modal && (
        <div className="modal fade show d-block" style={{ background: 'rgba(0,0,0,.5)', zIndex: 1060 }}>
          <div className="modal-dialog modal-dialog-centered modal-lg">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h6 className="modal-title">
                  <i className="bi bi-shuffle me-2"/>
                  {modal.rows.length === 1 ? 'Incorporar al maestro' : `Fusionar ${modal.rows.length} proveedores`}
                </h6>
                <button className="btn-close" onClick={() => setModal(null)}/>
              </div>
              <div className="modal-body">

                {/* Paso 1: elegir canónico */}
                {modal.rows.length > 1 && (
                  <div className="mb-3">
                    <label className="form-label small fw-semibold">
                      1. ¿Cuál es el nombre base? (el que se va a conservar)
                    </label>
                    <div className="d-flex flex-column gap-1">
                      {modal.rows.map((r, i) => (
                        <div key={r.nombre_upper}
                          className={`p-2 rounded border d-flex align-items-center gap-2 ${i === canonIdx ? 'border-primary bg-primary bg-opacity-10' : ''}`}
                          style={{ cursor: 'pointer' }}
                          onClick={() => elegirCanon(i)}>
                          <input type="radio" checked={i === canonIdx} onChange={() => elegirCanon(i)} />
                          <strong>{r.nombre}</strong>
                          {r.cuit && <span className="text-muted small">{r.cuit}</span>}
                          {r.proveedor_id && <span className="badge bg-success ms-auto" style={{ fontSize: '0.65rem' }}>ID {r.proveedor_id}</span>}
                          {!r.proveedor_id && <span className="badge bg-warning text-dark ms-auto" style={{ fontSize: '0.65rem' }}>Solo texto</span>}
                          <div className="d-flex gap-1">
                            {r.fuentes.map(f => (
                              <span key={f} className={`badge bg-${FUENTE_COLOR[f] || 'secondary'}`}
                                style={{ fontSize: '0.6rem' }}>{f}</span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Paso 2: confirmar / editar nombre final */}
                <div className="mb-3">
                  <label className="form-label small fw-semibold">
                    {modal.rows.length === 1 ? 'Nombre en el maestro' : '2. Nombre final (editalo si es necesario)'}
                  </label>
                  <input className="form-control form-control-sm" value={canonNombre}
                    onChange={e => setCanonNombre(e.target.value)} />
                </div>
                <div className="mb-3">
                  <label className="form-label small fw-semibold">CUIT</label>
                  <input className="form-control form-control-sm" placeholder="Sin CUIT"
                    value={canonCuit} onChange={e => setCanonCuit(e.target.value)} />
                </div>

                {/* Resumen de qué se va a hacer */}
                <div className="alert alert-info py-2 small mb-0">
                  <i className="bi bi-info-circle me-1"/>
                  <strong>Resumen:</strong> El nombre <strong>{canonNombre || '—'}</strong> quedará en el maestro.
                  {modal.rows.length > 1 && (
                    <> Los otros {modal.rows.length - 1} nombre(s) se redirigirán a este y se actualizarán en todos los módulos (OC, Stock, Mantenimiento, etc.).</>
                  )}
                </div>
              </div>
              <div className="modal-footer py-2">
                <button className="btn btn-sm btn-secondary" onClick={() => setModal(null)}>Cancelar</button>
                <button className="btn btn-sm btn-primary" onClick={aplicar}
                  disabled={guardando || !canonNombre.trim()}>
                  {guardando
                    ? <><span className="spinner-border spinner-border-sm me-1"/>Aplicando...</>
                    : <><i className="bi bi-check-lg me-1"/>Aplicar fusión</>
                  }
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal detalle documentos ── */}
      {detalle && (
        <div className="modal fade show d-block" style={{ background: 'rgba(0,0,0,.5)', zIndex: 1070 }}>
          <div className="modal-dialog modal-dialog-centered modal-lg">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h6 className="modal-title">
                  <i className="bi bi-search me-2"/>Documentos de <strong>{detalle.nombre}</strong>
                </h6>
                <button className="btn-close" onClick={() => setDetalle(null)}/>
              </div>
              <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
                {loadingDet ? (
                  <div className="text-center py-4"><span className="spinner-border text-primary"/></div>
                ) : detalle.data ? (
                  <>
                    {detalle.data.oc?.length > 0 && (
                      <div className="mb-3">
                        <div className="fw-semibold small mb-1"><i className="bi bi-cart me-1 text-success"/>Órdenes de Compra ({detalle.data.oc.length})</div>
                        <table className="table table-sm table-bordered mb-0" style={{ fontSize: '0.78rem' }}>
                          <thead className="table-light"><tr><th>N° OC</th><th>Fecha</th><th>Estado</th></tr></thead>
                          <tbody>{detalle.data.oc.map(r => <tr key={r.numero}><td>{r.numero}</td><td>{r.fecha}</td><td>{r.estado}</td></tr>)}</tbody>
                        </table>
                      </div>
                    )}
                    {detalle.data.f49?.length > 0 && (
                      <div className="mb-3">
                        <div className="fw-semibold small mb-1"><i className="bi bi-box-arrow-in-down me-1 text-info"/>Form 49 Ingresos ({detalle.data.f49.length})</div>
                        <table className="table table-sm table-bordered mb-0" style={{ fontSize: '0.78rem' }}>
                          <thead className="table-light"><tr><th>N°</th><th>Fecha</th></tr></thead>
                          <tbody>{detalle.data.f49.map(r => <tr key={r.numero}><td>{r.numero}</td><td>{r.fecha}</td></tr>)}</tbody>
                        </table>
                      </div>
                    )}
                    {detalle.data.fact?.length > 0 && (
                      <div className="mb-3">
                        <div className="fw-semibold small mb-1"><i className="bi bi-receipt me-1 text-warning"/>Facturas ({detalle.data.fact.length})</div>
                        <table className="table table-sm table-bordered mb-0" style={{ fontSize: '0.78rem' }}>
                          <thead className="table-light"><tr><th>N° Factura</th><th>Fecha</th><th>Total</th></tr></thead>
                          <tbody>{detalle.data.fact.map((r,i) => <tr key={i}><td>{r.nro_factura}</td><td>{r.fecha}</td><td>{r.total}</td></tr>)}</tbody>
                        </table>
                      </div>
                    )}
                    {detalle.data.prod?.length > 0 && (
                      <div className="mb-3">
                        <div className="fw-semibold small mb-1"><i className="bi bi-box me-1 text-secondary"/>Productos ({detalle.data.prod.length})</div>
                        <table className="table table-sm table-bordered mb-0" style={{ fontSize: '0.78rem' }}>
                          <thead className="table-light"><tr><th>Código</th><th>Descripción</th></tr></thead>
                          <tbody>{detalle.data.prod.map(r => <tr key={r.codigo}><td>{r.codigo}</td><td>{r.descripcion}</td></tr>)}</tbody>
                        </table>
                      </div>
                    )}
                    {detalle.data.mov?.length > 0 && (
                      <div className="mb-3">
                        <div className="fw-semibold small mb-1"><i className="bi bi-arrow-left-right me-1"/>Movimientos stock ({detalle.data.mov.length})</div>
                        <table className="table table-sm table-bordered mb-0" style={{ fontSize: '0.78rem' }}>
                          <thead className="table-light"><tr><th>ID</th><th>Fecha</th><th>Tipo</th></tr></thead>
                          <tbody>{detalle.data.mov.map(r => <tr key={r.id}><td>{r.id}</td><td>{r.fecha}</td><td>{r.tipo}</td></tr>)}</tbody>
                        </table>
                      </div>
                    )}
                    {!detalle.data.oc?.length && !detalle.data.f49?.length && !detalle.data.fact?.length && !detalle.data.prod?.length && !detalle.data.mov?.length && (
                      <div className="text-muted text-center py-3">Sin documentos asociados</div>
                    )}
                  </>
                ) : <div className="text-muted text-center py-3">Sin datos</div>}
              </div>
              <div className="modal-footer py-2">
                <button className="btn btn-sm btn-secondary" onClick={() => setDetalle(null)}>Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
