import { useState, useRef } from 'react'
import api from '../../api/client'
import DateInput from '../../components/DateInput'

const hoy   = () => new Date().toISOString().slice(0, 10)
const fmtN  = n => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(n ?? 0)
const MONEDAS = ['PESOS', 'DÓLAR', 'EURO']
const DESTINOS = [{ v: 'stock', l: 'Al stock' }, { v: 'uso_inmediato', l: 'Uso inm.' }]

const ITEM_VACIO = { descripcion: '', cantidad: 1, unidad: 'UND.', precio_unitario: 0, precio_final: 0, destino: 'stock' }

export default function FacturaIA({ tipo = 'compra', onClose, onGuardado }) {
  const [paso,       setPaso]       = useState('upload')   // upload | procesando | revisar
  const [file,       setFile]       = useState(null)
  const [drag,       setDrag]       = useState(false)
  const [datos,      setDatos]      = useState(null)
  const [ocBusq,     setOcBusq]     = useState('')
  const [ocInfo,     setOcInfo]     = useState(null)       // null | false | { id, numero, proveedor_nombre }
  const [buscandoOC, setBuscandoOC] = useState(false)
  const [guardando,  setGuardando]  = useState(false)
  const [error,      setError]      = useState('')
  const inputRef = useRef()

  // ── Helpers ────────────────────────────────────────────────────────────────
  const setItem = (idx, k, v) =>
    setDatos(d => ({ ...d, items: d.items.map((it, i) => i === idx ? { ...it, [k]: v } : it) }))
  const addItem = () => setDatos(d => ({ ...d, items: [...(d.items || []), { ...ITEM_VACIO }] }))
  const delItem = idx => setDatos(d => ({ ...d, items: d.items.filter((_, i) => i !== idx) }))

  // ── Upload drag & drop ─────────────────────────────────────────────────────
  const onDrop = e => {
    e.preventDefault(); setDrag(false)
    const f = e.dataTransfer.files[0]
    if (f) setFile(f)
  }
  const onFileChange = e => { if (e.target.files[0]) setFile(e.target.files[0]) }

  // ── Procesar con IA ────────────────────────────────────────────────────────
  const procesar = async () => {
    if (!file) return
    setError('Próximamente — la integración con IA estará disponible en una próxima versión.')
    return
    try {
      const fd = new FormData()
      fd.append('factura', file)
      const { data } = await api.post('/facturas/procesar', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 90000,
      })
      // Normalizar items
      const items = (data.items || []).map(it => ({
        descripcion:     it.descripcion || '',
        cantidad:        parseFloat(it.cantidad) || 1,
        unidad:          it.unidad || 'UND.',
        precio_unitario: parseFloat(it.precio_unitario) || 0,
        precio_final:    parseFloat(it.precio_final) || 0,
        destino:         'stock',
      }))
      setDatos({
        numero_factura: data.numero_factura || '',
        tipo_factura:   data.tipo_factura || 'A',
        fecha:          data.fecha || hoy(),
        emisor_nombre:  data.emisor_nombre || '',
        emisor_cuit:    data.emisor_cuit || '',
        receptor_nombre: data.receptor_nombre || '',
        receptor_cuit:  data.receptor_cuit || '',
        moneda:         data.moneda || 'PESOS',
        condicion_pago: data.condicion_pago || '',
        items,
        neto_gravado:   parseFloat(data.neto_gravado) || 0,
        iva_21:         parseFloat(data.iva_21) || 0,
        total:          parseFloat(data.total) || 0,
        observaciones:  data.observaciones || '',
      })
      setPaso('revisar')
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Error al procesar')
      setPaso('upload')
    }
  }

  // ── Buscar OC ──────────────────────────────────────────────────────────────
  const buscarOC = async () => {
    if (!ocBusq.trim()) return
    setBuscandoOC(true); setOcInfo(null)
    try {
      const { data } = await api.get('/facturas/buscar-oc', { params: { numero: ocBusq.trim() } })
      setOcInfo(data || false)
    } catch { setOcInfo(false) }
    finally { setBuscandoOC(false) }
  }

  // ── Guardar ────────────────────────────────────────────────────────────────
  const guardar = async () => {
    if (!datos?.numero_factura?.trim()) { setError('El número de factura es obligatorio'); return }
    setGuardando(true); setError('')
    try {
      if (tipo === 'compra') {
        const tieneOC = ocInfo && ocInfo.id
        const payload = {
          tipo_factura:    datos.tipo_factura,
          numero:          datos.numero_factura,
          fecha:           datos.fecha,
          proveedor_nombre: datos.emisor_nombre,
          cuit:            datos.emisor_cuit,
          oc_id:           tieneOC ? ocInfo.id   : null,
          oc_numero:       tieneOC ? ocInfo.numero : '',
          importe:         datos.total,
          neto_gravado:    datos.neto_gravado,
          iva_21:          datos.iva_21,
          moneda:          datos.moneda,
          condicion_pago:  datos.condicion_pago,
          observaciones:   datos.observaciones,
          crear_f49:       !tieneOC,
          f49_items:       !tieneOC ? datos.items : [],
        }
        const { data } = await api.post('/facturas/guardar-compra', payload)
        onGuardado?.({ tipo: 'compra', tieneOC, f49_numero: data.f49_numero, numero: datos.numero_factura })
      } else {
        const payload = {
          tipo_factura:   datos.tipo_factura,
          numero:         datos.numero_factura,
          fecha:          datos.fecha,
          cliente_nombre: datos.receptor_nombre,
          oc:             ocBusq.trim(),
          importe:        datos.total,
          moneda:         datos.moneda,
          observaciones:  datos.observaciones,
        }
        const { data } = await api.post('/facturas/guardar-venta', payload)
        onGuardado?.({ tipo: 'venta', id: data.id, numero: datos.numero_factura })
      }
      onClose()
    } catch (e) {
      setError(e.response?.data?.error || 'Error al guardar')
    } finally { setGuardando(false) }
  }

  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.55)', zIndex: 1080 }}>
      <div className="modal-dialog modal-xl modal-dialog-scrollable">
        <div className="modal-content">

          {/* Header */}
          <div className="modal-header py-2">
            <h5 className="modal-title">
              <i className="bi bi-robot me-2 text-primary" />
              Cargar factura de {tipo === 'compra' ? 'compra' : 'venta'} con IA
            </h5>
            <button type="button" className="btn-close" onClick={onClose} />
          </div>

          <div className="modal-body">
            {error && <div className="alert alert-danger py-2 small mb-3">{error}</div>}

            {/* ── PASO 1: UPLOAD ── */}
            {paso === 'upload' && (
              <div className="text-center py-4">
                <div
                  className={`border-2 border-dashed rounded p-5 mb-3 ${drag ? 'border-primary bg-primary bg-opacity-10' : 'border-secondary'}`}
                  style={{ borderStyle: 'dashed', cursor: 'pointer' }}
                  onDragOver={e => { e.preventDefault(); setDrag(true) }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={onDrop}
                  onClick={() => inputRef.current?.click()}>
                  <i className="bi bi-file-earmark-arrow-up display-4 text-secondary" />
                  <p className="mt-2 mb-1 fw-semibold">
                    {file ? file.name : 'Arrastrá la factura acá o hacé click para seleccionar'}
                  </p>
                  <p className="text-muted small mb-0">JPG · PNG · PDF — máx. 15 MB</p>
                  <input ref={inputRef} type="file" className="d-none"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={onFileChange} />
                </div>
                {file && (
                  <div className="d-flex align-items-center justify-content-center gap-3">
                    <span className="badge bg-secondary">{(file.size / 1024).toFixed(0)} KB — {file.type}</span>
                    <button className="btn btn-primary" onClick={procesar}>
                      <i className="bi bi-robot me-1" />Procesar con IA
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── PASO 2: PROCESANDO ── */}
            {paso === 'procesando' && (
              <div className="text-center py-5">
                <div className="spinner-border text-primary mb-3" style={{ width: '3rem', height: '3rem' }} />
                <p className="fw-semibold">Analizando factura con IA…</p>
                <p className="text-muted small">Puede tardar hasta 30 segundos</p>
              </div>
            )}

            {/* ── PASO 3: REVISAR ── */}
            {paso === 'revisar' && datos && (
              <>
                {/* Cabecera */}
                <div className="border rounded px-3 pt-2 pb-2 mb-3" style={{ background: '#f8f9fa' }}>
                  <div className="row g-2">
                    {/* Tipo + Número */}
                    <div className="col-md-1">
                      <label className="form-label small fw-medium mb-1">Tipo</label>
                      <select className="form-select form-select-sm" value={datos.tipo_factura}
                        onChange={e => setDatos(d => ({ ...d, tipo_factura: e.target.value }))}>
                        {['A','B','C','E'].map(t => <option key={t}>{t}</option>)}
                      </select>
                    </div>
                    <div className="col-md-3">
                      <label className="form-label small fw-medium mb-1">N° Factura <span className="text-danger">*</span></label>
                      <input className="form-control form-control-sm" value={datos.numero_factura}
                        onChange={e => setDatos(d => ({ ...d, numero_factura: e.target.value }))} />
                    </div>
                    <div className="col-md-2">
                      <label className="form-label small fw-medium mb-1">Fecha</label>
                      <DateInput className="form-control form-control-sm" value={datos.fecha}
                        onChange={v => setDatos(d => ({ ...d, fecha: v }))} />
                    </div>
                    <div className="col-md-2">
                      <label className="form-label small fw-medium mb-1">Moneda</label>
                      <select className="form-select form-select-sm" value={datos.moneda}
                        onChange={e => setDatos(d => ({ ...d, moneda: e.target.value }))}>
                        {MONEDAS.map(m => <option key={m}>{m}</option>)}
                      </select>
                    </div>
                    <div className="col-md-4">
                      <label className="form-label small fw-medium mb-1">Cond. Pago</label>
                      <input className="form-control form-control-sm" value={datos.condicion_pago}
                        onChange={e => setDatos(d => ({ ...d, condicion_pago: e.target.value }))} />
                    </div>
                    {/* Emisor */}
                    <div className="col-md-5">
                      <label className="form-label small fw-medium mb-1">
                        {tipo === 'compra' ? 'Proveedor (emisor)' : 'Cliente (receptor)'}
                      </label>
                      <input className="form-control form-control-sm" value={datos.emisor_nombre}
                        onChange={e => setDatos(d => ({ ...d, emisor_nombre: e.target.value }))} />
                    </div>
                    <div className="col-md-3">
                      <label className="form-label small fw-medium mb-1">CUIT emisor</label>
                      <input className="form-control form-control-sm" value={datos.emisor_cuit}
                        onChange={e => setDatos(d => ({ ...d, emisor_cuit: e.target.value }))} />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label small fw-medium mb-1">
                        {tipo === 'compra' ? 'Receptor' : 'Proveedor (emisor)'}
                      </label>
                      <input className="form-control form-control-sm" value={datos.receptor_nombre}
                        onChange={e => setDatos(d => ({ ...d, receptor_nombre: e.target.value }))} />
                    </div>
                    {/* Observaciones */}
                    <div className="col-12">
                      <label className="form-label small fw-medium mb-1">Observaciones</label>
                      <input className="form-control form-control-sm" value={datos.observaciones}
                        onChange={e => setDatos(d => ({ ...d, observaciones: e.target.value }))} />
                    </div>
                  </div>
                </div>

                {/* OC / referencia */}
                <div className="border rounded px-3 pt-2 pb-2 mb-3"
                  style={{ background: tipo === 'compra' ? '#f0f4ff' : '#f0fff4' }}>
                  <div className="row g-2 align-items-end">
                    <div className="col-md-4">
                      <label className="form-label small fw-medium mb-1">
                        {tipo === 'compra'
                          ? <><i className="bi bi-link-45deg" /> ¿Tiene OC? Ingresá el número</>
                          : <><i className="bi bi-link-45deg" /> Referencia OC de venta (opcional)</>
                        }
                      </label>
                      <div className="input-group input-group-sm">
                        <input className="form-control" placeholder="ej. OC-2026-0042"
                          value={ocBusq}
                          onChange={e => { setOcBusq(e.target.value); setOcInfo(null) }}
                          onKeyDown={e => e.key === 'Enter' && buscarOC()} />
                        <button className="btn btn-outline-primary" onClick={buscarOC} disabled={buscandoOC}>
                          {buscandoOC ? <span className="spinner-border spinner-border-sm" /> : <i className="bi bi-search" />}
                        </button>
                      </div>
                    </div>
                    <div className="col-md-8 d-flex align-items-center" style={{ minHeight: 38 }}>
                      {ocInfo === null && !ocBusq && tipo === 'compra' && (
                        <span className="text-muted small">
                          <i className="bi bi-info-circle me-1" />
                          Sin OC: se creará un Form49 con los ítems
                        </span>
                      )}
                      {ocInfo === false && (
                        <span className="text-warning small fw-semibold">
                          <i className="bi bi-exclamation-triangle me-1" />
                          OC no encontrada{tipo === 'compra' ? ' — se creará un Form49' : ''}
                        </span>
                      )}
                      {ocInfo && (
                        <span className="text-success small fw-semibold">
                          <i className="bi bi-check-circle-fill me-1" />
                          {ocInfo.numero} — {ocInfo.proveedor_nombre}
                          <span className="badge bg-success ms-2" style={{ fontSize: '0.65rem' }}>{ocInfo.estado}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Items */}
                <div className="d-flex align-items-center mb-2">
                  <span className="fw-semibold small">Ítems ({datos.items?.length || 0})</span>
                  <button type="button" className="btn btn-sm btn-outline-secondary ms-2" onClick={addItem}>
                    <i className="bi bi-plus" /> Agregar
                  </button>
                </div>
                <div className="table-responsive mb-3">
                  <table className="table table-sm table-bordered" style={{ fontSize: '0.81rem' }}>
                    <thead className="table-light">
                      <tr>
                        <th style={{ width: 28 }}>#</th>
                        <th>Descripción</th>
                        <th style={{ width: 68 }}>Unidad</th>
                        <th style={{ width: 80 }}>Cant.</th>
                        <th style={{ width: 110 }}>Precio U.</th>
                        <th style={{ width: 110 }}>Precio F.</th>
                        <th style={{ width: 110 }}>Subtotal</th>
                        {tipo === 'compra' && <th style={{ width: 105 }}>Destino</th>}
                        <th style={{ width: 32 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {(datos.items || []).map((it, idx) => (
                        <tr key={idx}>
                          <td className="text-center align-middle text-muted">{idx + 1}</td>
                          <td>
                            <input className="form-control form-control-sm border-0 p-0 px-1"
                              value={it.descripcion}
                              onChange={e => setItem(idx, 'descripcion', e.target.value)} />
                          </td>
                          <td>
                            <input className="form-control form-control-sm border-0 text-center"
                              value={it.unidad}
                              onChange={e => setItem(idx, 'unidad', e.target.value)} />
                          </td>
                          <td>
                            <input type="number" className="form-control form-control-sm border-0 text-end"
                              value={it.cantidad} min="0" step="any"
                              onChange={e => setItem(idx, 'cantidad', e.target.value)} />
                          </td>
                          <td>
                            <input type="number" className="form-control form-control-sm border-0 text-end"
                              value={it.precio_unitario} min="0" step="any"
                              onChange={e => {
                                const v = parseFloat(e.target.value) || 0
                                setItem(idx, 'precio_unitario', v)
                                setItem(idx, 'precio_final', v)
                              }} />
                          </td>
                          <td>
                            <input type="number" className="form-control form-control-sm border-0 text-end fw-semibold"
                              value={it.precio_final} min="0" step="any"
                              onChange={e => setItem(idx, 'precio_final', parseFloat(e.target.value) || 0)} />
                          </td>
                          <td className="text-end align-middle pe-2 text-muted">
                            {fmtN((parseFloat(it.cantidad) || 0) * (parseFloat(it.precio_final) || 0))}
                          </td>
                          {tipo === 'compra' && (
                            <td>
                              <select className="form-select form-select-sm border-0"
                                value={it.destino}
                                onChange={e => setItem(idx, 'destino', e.target.value)}>
                                {DESTINOS.map(d => <option key={d.v} value={d.v}>{d.l}</option>)}
                              </select>
                            </td>
                          )}
                          <td className="text-center align-middle">
                            <button type="button" className="btn btn-sm btn-link text-danger p-0"
                              onClick={() => delItem(idx)}>
                              <i className="bi bi-x-lg" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Totales */}
                <div className="border rounded px-3 pt-2 pb-2" style={{ background: '#f8f9fa' }}>
                  <div className="row g-2 justify-content-end">
                    <div className="col-md-3">
                      <label className="form-label small fw-medium mb-1">Neto gravado</label>
                      <input type="number" className="form-control form-control-sm text-end"
                        value={datos.neto_gravado} min="0" step="any"
                        onChange={e => setDatos(d => ({ ...d, neto_gravado: parseFloat(e.target.value) || 0 }))} />
                    </div>
                    <div className="col-md-3">
                      <label className="form-label small fw-medium mb-1">IVA 21%</label>
                      <input type="number" className="form-control form-control-sm text-end"
                        value={datos.iva_21} min="0" step="any"
                        onChange={e => setDatos(d => ({ ...d, iva_21: parseFloat(e.target.value) || 0 }))} />
                    </div>
                    <div className="col-md-3">
                      <label className="form-label small fw-medium mb-1 fw-bold">TOTAL {datos.moneda}</label>
                      <input type="number" className="form-control form-control-sm text-end fw-bold"
                        value={datos.total} min="0" step="any"
                        onChange={e => setDatos(d => ({ ...d, total: parseFloat(e.target.value) || 0 }))} />
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          <div className="modal-footer py-2 justify-content-between">
            <div>
              {paso === 'revisar' && (
                <button type="button" className="btn btn-sm btn-outline-secondary"
                  onClick={() => { setPaso('upload'); setError('') }}>
                  <i className="bi bi-arrow-left me-1" />Volver a subir
                </button>
              )}
            </div>
            <div className="d-flex gap-2">
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClose}>
                Cancelar
              </button>
              {paso === 'revisar' && (
                <button className="btn btn-sm btn-success" onClick={guardar} disabled={guardando}>
                  {guardando
                    ? <span className="spinner-border spinner-border-sm me-1" />
                    : <i className="bi bi-check-lg me-1" />}
                  {tipo === 'compra'
                    ? (ocInfo?.id ? 'Guardar y asociar OC' : 'Guardar y crear Form49')
                    : 'Guardar factura de venta'
                  }
                </button>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
