import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'
import { puedeEscribir } from '../../store/authStore'
import DateInput from '../../components/DateInput'
import FinanzasDashboard from './FinanzasDashboard'

const fmtF = s => {
  if (!s) return '—'
  const d = new Date(s + 'T00:00:00')
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const fmtM = (n, mon) => {
  const v = parseFloat(n)
  if (!v || isNaN(v)) return '—'
  const sym = mon === 'DÓLAR' ? 'USD ' : mon === 'EURO' ? '€ ' : '$ '
  return sym + v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const MONEDAS = ['PESO', 'DÓLAR', 'EURO']

const esNC = tipo => typeof tipo === 'string' && tipo.startsWith('NC')

const FORM_PAGO = { tipo: 'parcial', forma_pago: 'transferencia', entidad: '', importe: '', moneda: 'PESO', fecha: new Date().toISOString().slice(0,10), fecha_acreditacion: '', observaciones: '' }

const FORMAS_PAGO = ['transferencia','cheque','cheque_diferido','efectivo','deposito']
const TIPOS_PAGO  = ['anticipo','parcial','final']

const FORM_C = { tipo_factura: 'A', numero: '', fecha: '', proveedor_id: '', proveedor_nombre: '', cuit: '', oc_id: '', oc_numero: '', neto_gravado: '', no_grav_exento: '', iva_21: '', iva_10_5: '', iva_27: '', otros_imp: '', perc_iva: '', perc_iibb: '', importe: '', moneda: 'PESO', tasa_cambio: 1, fecha_vencimiento: '', observaciones: '' }
const FORM_V = { tipo_factura: 'A', numero: '', fecha: '', cliente_id: '', cliente_nombre: '', presupuesto_id: '', presupuesto_ref: '', concepto: '', oc: '', neto_gravado: '', iva_21: '', ret_iibb: '', ret_iva: '', ret_gcia: '', ret_contratista: '', ret_ss: '', dif_cambio: '', total_cobrado: '', importe: '', moneda: 'PESO', tasa_cambio: 1, fecha_vencimiento: '', fecha_pago: '', observaciones: '' }

function FiltroBarra({ filt, setFilt }) {
  const activo = filt.buscar || filt.desde || filt.hasta || filt.moneda || filt.pago !== ''
  return (
    <div className="d-flex flex-wrap gap-2 align-items-center">
      <input className="form-control form-control-sm" style={{ width: 210 }}
        placeholder="Buscar número, nombre..."
        value={filt.buscar} onChange={e => setFilt(p => ({ ...p, buscar: e.target.value }))} />
      <DateInput className="form-control form-control-sm" style={{ width: 145 }}
        value={filt.desde} onChange={v => setFilt(p => ({ ...p, desde: v }))} />
      <span className="text-muted small">→</span>
      <DateInput className="form-control form-control-sm" style={{ width: 145 }}
        value={filt.hasta} onChange={v => setFilt(p => ({ ...p, hasta: v }))} />
      <select className="form-select form-select-sm" style={{ width: 110 }}
        value={filt.moneda} onChange={e => setFilt(p => ({ ...p, moneda: e.target.value }))}>
        <option value="">Moneda</option>
        {MONEDAS.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
      <select className="form-select form-select-sm" style={{ width: 125 }}
        value={filt.pago} onChange={e => setFilt(p => ({ ...p, pago: e.target.value }))}>
        <option value="">Estado pago</option>
        <option value="1">Pagada/Cobrada</option>
        <option value="0">Pendiente</option>
      </select>
      {activo && (
        <button className="btn btn-sm btn-outline-secondary py-0 px-2"
          onClick={() => setFilt({ buscar: '', desde: '', hasta: '', moneda: '', pago: '' })}>
          <i className="bi bi-x" />
        </button>
      )}
    </div>
  )
}

export default function Finanzas({ canWrite: canWriteProp } = {}) {
  const canWrite = canWriteProp !== undefined ? canWriteProp : puedeEscribir('finanzas')
  const [tab, setTab] = useState('compras')

  const [factC, setFactC] = useState([])
  const [filtC, setFiltC] = useState({ buscar: '', desde: '', hasta: '', moneda: '', pago: '' })
  const [loadC, setLoadC] = useState(false)
  const [modalC, setModalC] = useState(null)
  const [formC, setFormC] = useState(FORM_C)
  const [savC, setSavC] = useState(false)
  const [addProvC, setAddProvC] = useState(false)
  const [newProvForm, setNewProvForm] = useState({ nombre: '', cuit: '' })
  const [anticipoModal, setAnticipoModal] = useState(null) // solo compras
  const [anticipoForm, setAnticipoForm] = useState({ anticipo: '', fecha_anticipo: '' })

  const [pagosModal,   setPagosModal]   = useState(null)  // factura activa
  const [pagos,        setPagos]        = useState([])
  const [pagosLoad,    setPagosLoad]    = useState(false)
  const [pagoForm,     setPagoForm]     = useState(FORM_PAGO)
  const [pagoSaving,   setPagoSaving]   = useState(false)
  const [mostrarForm,  setMostrarForm]  = useState(false)

  const [factV, setFactV] = useState([])
  const [filtV, setFiltV] = useState({ buscar: '', desde: '', hasta: '', moneda: '', pago: '' })
  const [loadV, setLoadV] = useState(false)
  const [modalV, setModalV] = useState(null)
  const [formV, setFormV] = useState(FORM_V)
  const [savV, setSavV] = useState(false)

  const [proveedores, setProveedores] = useState([])
  const [ocs,         setOcs]         = useState([])
  const [clientes,    setClientes]    = useState([])
  const [presupuestos, setPresupuestos] = useState([])

  const cargarC = useCallback(async () => {
    setLoadC(true)
    try {
      const p = {}
      if (filtC.buscar) p.buscar = filtC.buscar
      if (filtC.desde)  p.desde  = filtC.desde
      if (filtC.hasta)  p.hasta  = filtC.hasta
      if (filtC.moneda) p.moneda = filtC.moneda
      if (filtC.pago !== '') p.pago = filtC.pago
      const r = await api.get('/finanzas/facturas-compra', { params: p })
      setFactC(r.data)
    } finally { setLoadC(false) }
  }, [filtC])

  const cargarV = useCallback(async () => {
    setLoadV(true)
    try {
      const p = {}
      if (filtV.buscar) p.buscar = filtV.buscar
      if (filtV.desde)  p.desde  = filtV.desde
      if (filtV.hasta)  p.hasta  = filtV.hasta
      if (filtV.moneda) p.moneda = filtV.moneda
      if (filtV.pago !== '') p.pago = filtV.pago
      const r = await api.get('/finanzas/facturas-venta', { params: p })
      setFactV(r.data)
    } finally { setLoadV(false) }
  }, [filtV])

  useEffect(() => { cargarC() }, [cargarC])
  useEffect(() => { cargarV() }, [cargarV])

  useEffect(() => {
    api.get('/compras/proveedores').then(r => setProveedores(r.data || [])).catch(() => {})
    api.get('/compras/oc', { params: { limit: 500 } }).then(r => setOcs(r.data?.datos || [])).catch(() => {})
    api.get('/ventas/clientes').then(r => setClientes(r.data || [])).catch(() => {})
    api.get('/ventas/presupuestos', { params: { limit: 500 } }).then(r => setPresupuestos(r.data?.datos || [])).catch(() => {})
  }, [])

  const vctoColor = (fecha, pagado) => {
    if (pagado || !fecha) return 'text-muted'
    const d = new Date(fecha + 'T00:00:00')
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0)
    const diff = (d - hoy) / 86400000
    if (diff < 0)  return 'text-danger fw-semibold'
    if (diff <= 7) return 'text-warning fw-semibold'
    return 'text-muted'
  }

  // ── Compras ────────────────────────────────────────────────────────────────
  const calcTotalC = fc => (
    (parseFloat(fc.neto_gravado)||0) + (parseFloat(fc.no_grav_exento)||0) +
    (parseFloat(fc.iva_21)||0) + (parseFloat(fc.iva_10_5)||0) + (parseFloat(fc.iva_27)||0) +
    (parseFloat(fc.otros_imp)||0) + (parseFloat(fc.perc_iva)||0) + (parseFloat(fc.perc_iibb)||0)
  )

  const calcIvaC = (neto, rate) => Math.round((parseFloat(neto) || 0) * rate * 100) / 100

  const onNetoGravadoC = val => setFormC(p => ({ ...p, neto_gravado: val }))

  const abrirNuevaC = () => {
    setFormC(FORM_C); setAddProvC(false); setModalC('new')
  }
  const abrirEditC = f => {
    setFormC({ ...FORM_C, ...f, importe: f.importe ?? '', tasa_cambio: f.tasa_cambio ?? 1 })
    setAddProvC(false); setModalC(f)
  }

  const guardarNuevoProv = async () => {
    if (!newProvForm.nombre.trim()) return alert('El nombre es requerido')
    try {
      const r = await api.post('/compras/proveedores', { nombre: newProvForm.nombre.trim(), cuit: newProvForm.cuit.trim() })
      const np = r.data
      setProveedores(p => [...p, np].sort((a, b) => a.nombre.localeCompare(b.nombre)))
      setFormC(prev => ({ ...prev, proveedor_id: String(np.id), proveedor_nombre: np.nombre, cuit: np.cuit || '' }))
      setAddProvC(false)
      setNewProvForm({ nombre: '', cuit: '' })
    } catch (e) { alert(e.response?.data?.error || 'Error al guardar proveedor') }
  }

  const guardarEditProv = async () => {
    if (!newProvForm.nombre.trim()) return alert('El nombre es requerido')
    try {
      const r = await api.put(`/compras/proveedores/${formC.proveedor_id}`, { nombre: newProvForm.nombre.trim(), cuit: newProvForm.cuit.trim() })
      const np = r.data
      setProveedores(p => p.map(x => x.id === np.id ? np : x))
      setFormC(prev => ({ ...prev, proveedor_nombre: np.nombre, cuit: np.cuit || '' }))
      setAddProvC(false)
    } catch (e) { alert(e.response?.data?.error || 'Error al guardar proveedor') }
  }

  const guardarC = async () => {
    if (!formC.numero.trim()) return alert('El número de factura es requerido')
    setSavC(true)
    try {
      const total = calcTotalC(formC)
      const payload = { ...formC, importe: total || parseFloat(formC.importe) || 0 }
      if (modalC === 'new') await api.post('/finanzas/facturas-compra', payload)
      else await api.put(`/finanzas/facturas-compra/${modalC.id}`, payload)
      setModalC(null)
      cargarC()
    } catch (e) {
      alert(e.response?.data?.error || 'Error al guardar')
    } finally { setSavC(false) }
  }

  const eliminarC = async f => {
    if (!confirm(`¿Eliminar factura ${f.numero}?`)) return
    await api.delete(`/finanzas/facturas-compra/${f.id}`)
    cargarC()
  }



  const togglePagoC = async f => {
    await api.patch('/finanzas/facturas-compra/pago', { fuente: f.fuente, id: f.id, pago_confirmado: !f.pago_confirmado })
    setFactC(prev => prev.map(x => (x.fuente === f.fuente && x.id === f.id) ? { ...x, pago_confirmado: x.pago_confirmado ? 0 : 1, anticipo: 0, fecha_anticipo: '' } : x))
  }

  const abrirAnticipoC = f => { setAnticipoForm({ anticipo: f.anticipo || '', fecha_anticipo: f.fecha_anticipo || '' }); setAnticipoModal({ f, tipo: 'compra' }) }

  const guardarAnticipo = async () => {
    const { f, tipo } = anticipoModal
    const url = tipo === 'compra' ? `/finanzas/facturas-compra/${f.id}/anticipo` : `/finanzas/facturas-venta/${f.id}/anticipo`
    const r = await api.patch(url, anticipoForm)
    if (tipo === 'compra') setFactC(prev => prev.map(x => x.id === f.id ? { ...x, ...r.data } : x))
    else setFactV(prev => prev.map(x => x.id === f.id ? { ...x, ...r.data } : x))
    setAnticipoModal(null)
  }

  // ── Ventas ─────────────────────────────────────────────────────────────────
  const abrirNuevaV = () => { setFormV(FORM_V); setModalV('new') }
  const abrirEditV  = f => { setFormV({ ...FORM_V, ...f, importe: f.importe ?? '', tasa_cambio: f.tasa_cambio ?? 1 }); setModalV(f) }

  const guardarV = async () => {
    if (!formV.numero.trim()) return alert('El número de factura es requerido')
    setSavV(true)
    try {
      const importe = parseFloat(formV.importe) ||
                      ((parseFloat(formV.neto_gravado)||0) + (parseFloat(formV.iva_21)||0))
      const payload = { ...formV, importe }
      if (modalV === 'new') await api.post('/finanzas/facturas-venta', payload)
      else await api.put(`/finanzas/facturas-venta/${modalV.id}`, payload)
      setModalV(null)
      cargarV()
    } catch (e) {
      alert(e.response?.data?.error || 'Error al guardar')
    } finally { setSavV(false) }
  }

  const eliminarV = async f => {
    if (!confirm(`¿Eliminar factura ${f.numero}?`)) return
    await api.delete(`/finanzas/facturas-venta/${f.id}`)
    cargarV()
  }

  const togglePagoV = async f => {
    const nuevoPago = !f.pago_confirmado
    const fecha_pago = nuevoPago ? new Date().toISOString().slice(0, 10) : ''
    await api.patch(`/finanzas/facturas-venta/${f.id}/pago`, { pago_confirmado: nuevoPago, fecha_pago })
    setFactV(prev => prev.map(x => x.id === f.id ? { ...x, pago_confirmado: nuevoPago ? 1 : 0, anticipo: 0, fecha_anticipo: '', fecha_pago } : x))
  }

  // ── Pagos de ventas ────────────────────────────────────────────────────────
  const abrirPagosV = async f => {
    setPagosModal(f); setMostrarForm(false)
    setPagoForm({ ...FORM_PAGO, moneda: f.moneda || 'PESO' })
    setPagosLoad(true)
    try { const r = await api.get(`/finanzas/facturas-venta/${f.id}/pagos`); setPagos(r.data) }
    finally { setPagosLoad(false) }
  }

  const agregarPago = async () => {
    if (!pagoForm.importe || parseFloat(pagoForm.importe) <= 0) return alert('Importe requerido')
    if (!pagoForm.fecha) return alert('Fecha requerida')
    setPagoSaving(true)
    try {
      const r = await api.post(`/finanzas/facturas-venta/${pagosModal.id}/pagos`, pagoForm)
      setPagos(p => [...p, r.data])
      setPagoForm({ ...FORM_PAGO, moneda: pagosModal.moneda || 'PESO' })
      setMostrarForm(false)
      // Actualizar saldo en la lista
      const totalPagado = [...pagos, r.data].filter(p => p.estado === 'confirmado').reduce((s, p) => s + p.importe, 0)
      const saldo = Math.max(0, (pagosModal.importe * (pagosModal.tasa_cambio || 1)) - totalPagado)
      const cobrada = saldo <= 0.01 ? 1 : 0
      setFactV(prev => prev.map(x => x.id === pagosModal.id
        ? { ...x, total_pagado: totalPagado, count_pagos: (x.count_pagos||0)+1, saldo_pendiente: saldo, pago_confirmado: cobrada }
        : x))
      setPagosModal(p => ({ ...p, saldo_pendiente: saldo, pago_confirmado: cobrada }))
    } catch(e) { alert(e.response?.data?.error || 'Error al guardar') }
    finally { setPagoSaving(false) }
  }

  const confirmarPago = async pago => {
    const r = await api.patch(`/finanzas/facturas-venta/${pagosModal.id}/pagos/${pago.id}`, { estado: 'confirmado' })
    const nuevos = pagos.map(p => p.id === pago.id ? r.data : p)
    setPagos(nuevos)
    const totalPagado = nuevos.filter(p => p.estado === 'confirmado').reduce((s, p) => s + p.importe, 0)
    const saldo = Math.max(0, (pagosModal.importe * (pagosModal.tasa_cambio || 1)) - totalPagado)
    const cobrada = saldo <= 0.01 ? 1 : 0
    setFactV(prev => prev.map(x => x.id === pagosModal.id
      ? { ...x, total_pagado: totalPagado, saldo_pendiente: saldo, pago_confirmado: cobrada }
      : x))
    setPagosModal(p => ({ ...p, saldo_pendiente: saldo, pago_confirmado: cobrada }))
  }

  const eliminarPago = async pago => {
    if (!confirm('¿Eliminar este pago?')) return
    await api.delete(`/finanzas/facturas-venta/${pagosModal.id}/pagos/${pago.id}`)
    const nuevos = pagos.filter(p => p.id !== pago.id)
    setPagos(nuevos)
    const totalPagado = nuevos.filter(p => p.estado === 'confirmado').reduce((s, p) => s + p.importe, 0)
    const saldo = Math.max(0, (pagosModal.importe * (pagosModal.tasa_cambio || 1)) - totalPagado)
    setFactV(prev => prev.map(x => x.id === pagosModal.id
      ? { ...x, total_pagado: totalPagado, count_pagos: nuevos.length, saldo_pendiente: saldo, pago_confirmado: saldo <= 0.01 ? 1 : 0 }
      : x))
    setPagosModal(p => ({ ...p, saldo_pendiente: saldo, pago_confirmado: saldo <= 0.01 ? 1 : 0 }))
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="container-fluid d-flex flex-column" style={{ height: '100%', padding: '1rem 1.5rem' }}>
      <div className="d-flex align-items-center mb-3">
        <h5 className="fw-bold mb-0"><i className="bi bi-receipt me-2 text-primary" />Facturas</h5>
      </div>

      <ul className="nav nav-tabs mb-3">
        <li className="nav-item">
          <button className={`nav-link py-1 px-3 ${tab === 'dashboard' ? 'active' : ''}`} onClick={() => setTab('dashboard')}>
            <i className="bi bi-speedometer2 me-1" />Dashboard
          </button>
        </li>
        <li className="nav-item">
          <button className={`nav-link py-1 px-3 ${tab === 'compras' ? 'active' : ''}`} onClick={() => setTab('compras')}>
            <i className="bi bi-cart3 me-1" />Compras
            {factC.length > 0 && <span className="badge bg-secondary ms-1" style={{ fontSize: '0.65rem' }}>{factC.length}</span>}
          </button>
        </li>
        <li className="nav-item">
          <button className={`nav-link py-1 px-3 ${tab === 'ventas' ? 'active' : ''}`} onClick={() => setTab('ventas')}>
            <i className="bi bi-shop me-1" />Ventas
            {factV.length > 0 && <span className="badge bg-secondary ms-1" style={{ fontSize: '0.65rem' }}>{factV.length}</span>}
          </button>
        </li>
      </ul>

      {/* ── TAB DASHBOARD ── */}
      {tab === 'dashboard' && <FinanzasDashboard />}

      {/* ── TAB COMPRAS ── */}
      {tab === 'compras' && (
        <div className="flex-grow-1 d-flex flex-column overflow-hidden">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <FiltroBarra filt={filtC} setFilt={setFiltC} />
            {canWrite && (
              <button className="btn btn-sm btn-primary ms-3 flex-shrink-0" onClick={abrirNuevaC}>
                <i className="bi bi-plus-lg me-1" />Nueva Factura
              </button>
            )}
          </div>
          <div className="flex-grow-1 overflow-auto">
            {loadC ? (
              <div className="text-center text-muted py-5"><span className="spinner-border spinner-border-sm me-2" />Cargando...</div>
            ) : factC.length === 0 ? (
              <div className="text-center text-muted py-5">
                <i className="bi bi-inbox display-6 d-block mb-2" />Sin facturas de compra
              </div>
            ) : (
              <table className="table table-sm table-hover align-middle mb-0" style={{ fontSize: '0.8rem' }}>
                <thead className="table-light">
                  <tr>
                    <th>Fecha</th>
                    <th style={{ width: 55 }}>Tipo</th>
                    <th>N° Factura</th>
                    <th>Proveedor</th>
                    <th>CUIT</th>
                    <th className="text-end">Neto Grav.</th>
                    <th className="text-end">No Grav/Exento</th>
                    <th className="text-end">IVA 21%</th>
                    <th className="text-end">IVA 10.5%</th>
                    <th className="text-end">IVA 27%</th>
                    <th className="text-end">Otros Imp.</th>
                    <th className="text-end">Perc. IVA</th>
                    <th className="text-end">Perc. IIBB</th>
                    <th className="text-end">Total</th>
                    <th>Período</th>
                    <th>Pago</th>
                    {canWrite && <th style={{ width: 70 }} />}
                  </tr>
                </thead>
                <tbody>
                  {factC.map(f => (
                    <tr key={`${f.fuente}-${f.id}`}>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtF(f.fecha)}</td>
                      <td><span className="badge bg-secondary">{f.tipo_factura || 'A'}</span></td>
                      <td className="fw-semibold" style={{ whiteSpace: 'nowrap' }}>{f.numero}</td>
                      <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.proveedor_nombre}>{f.proveedor_nombre || '—'}</td>
                      <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{f.cuit || '—'}</td>
                      <td className="text-end">{f.neto_gravado ? fmtM(f.neto_gravado, f.moneda) : '—'}</td>
                      <td className="text-end">{f.no_grav_exento ? fmtM(f.no_grav_exento, f.moneda) : '—'}</td>
                      <td className="text-end">{f.iva_21 ? fmtM(f.iva_21, f.moneda) : '—'}</td>
                      <td className="text-end">{f.iva_10_5 ? fmtM(f.iva_10_5, f.moneda) : '—'}</td>
                      <td className="text-end">{f.iva_27 ? fmtM(f.iva_27, f.moneda) : '—'}</td>
                      <td className="text-end">{f.otros_imp ? fmtM(f.otros_imp, f.moneda) : '—'}</td>
                      <td className="text-end">{f.perc_iva ? fmtM(f.perc_iva, f.moneda) : '—'}</td>
                      <td className="text-end">{f.perc_iibb ? fmtM(f.perc_iibb, f.moneda) : '—'}</td>
                      <td className="text-end fw-semibold">{fmtM(f.importe, f.moneda)}</td>
                      <td className="text-muted" style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.observaciones}>{f.observaciones || '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {canWrite ? (
                          <div className="d-flex gap-1 align-items-center">
                            {f.pago_confirmado ? (
                              <button className="btn py-0 px-2 btn-sm btn-success" style={{ fontSize: '0.72rem' }} onClick={() => togglePagoC(f)}>
                                <i className="bi bi-check-circle-fill me-1" />Pagada
                              </button>
                            ) : f.anticipo > 0 ? (
                              <>
                                <button className="btn py-0 px-2 btn-sm btn-warning" style={{ fontSize: '0.72rem' }} onClick={() => abrirAnticipoC(f)}
                                  title={`Anticipo: ${fmtM(f.anticipo, f.moneda)} — Saldo: ${fmtM(f.importe - f.anticipo, f.moneda)}`}>
                                  <i className="bi bi-clock-history me-1" />Anticipo
                                </button>
                                <button className="btn py-0 px-1 btn-sm btn-outline-success" style={{ fontSize: '0.7rem' }} title="Marcar pagada" onClick={() => togglePagoC(f)}>
                                  <i className="bi bi-check-lg" />
                                </button>
                              </>
                            ) : (
                              <>
                                <button className="btn py-0 px-2 btn-sm btn-outline-secondary" style={{ fontSize: '0.72rem' }} onClick={() => togglePagoC(f)}>
                                  <i className="bi bi-circle me-1" />Pendiente
                                </button>
                                <button className="btn py-0 px-1 btn-sm btn-outline-warning" style={{ fontSize: '0.7rem' }} title="Registrar anticipo" onClick={() => abrirAnticipoC(f)}>
                                  <i className="bi bi-clock-history" />
                                </button>
                              </>
                            )}
                          </div>
                        ) : (
                          <span className={`badge bg-${f.pago_confirmado ? 'success' : f.anticipo > 0 ? 'warning' : 'secondary'}`}>
                            {f.pago_confirmado ? 'Pagada' : f.anticipo > 0 ? 'Anticipo' : 'Pendiente'}
                          </span>
                        )}
                      </td>
                      {canWrite && (
                        <td>
                          <div className="d-flex gap-1">
                            <button className="btn btn-sm btn-outline-primary py-0 px-1" title="Editar" onClick={() => abrirEditC(f)}>
                              <i className="bi bi-pencil" />
                            </button>
                            <button className="btn btn-sm btn-outline-danger py-0 px-1" title="Eliminar" onClick={() => eliminarC(f)}>
                              <i className="bi bi-trash" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── TAB VENTAS ── */}
      {tab === 'ventas' && (
        <div className="flex-grow-1 d-flex flex-column overflow-hidden">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <FiltroBarra filt={filtV} setFilt={setFiltV} />
            {canWrite && (
              <button className="btn btn-sm btn-primary ms-3 flex-shrink-0" onClick={abrirNuevaV}>
                <i className="bi bi-plus-lg me-1" />Nueva Factura
              </button>
            )}
          </div>
          <div className="flex-grow-1 overflow-auto">
            {loadV ? (
              <div className="text-center text-muted py-5"><span className="spinner-border spinner-border-sm me-2" />Cargando...</div>
            ) : factV.length === 0 ? (
              <div className="text-center text-muted py-5">
                <i className="bi bi-inbox display-6 d-block mb-2" />Sin facturas de venta
              </div>
            ) : (
              <table className="table table-sm table-hover align-middle mb-0" style={{ fontSize: '0.8rem' }}>
                <thead className="table-light">
                  <tr>
                    <th>Fecha</th>
                    <th style={{ width: 55 }}>Tipo</th>
                    <th>N° Factura</th>
                    <th>Cliente</th>
                    <th>Concepto</th>
                    <th>OC</th>
                    <th className="text-end">Neto Grav.</th>
                    <th className="text-end">IVA 21%</th>
                    <th className="text-end">Total Fact.</th>
                    <th className="text-end">Ret. IIBB</th>
                    <th className="text-end">Ret. IVA</th>
                    <th className="text-end">Ret. Gcía.</th>
                    <th className="text-end">Total Cobrado</th>
                    <th>F. Pago</th>
                    <th>Cobro</th>
                    {canWrite && <th style={{ width: 70 }} />}
                  </tr>
                </thead>
                <tbody>
                  {factV.map(f => (
                    <tr key={f.id} style={esNC(f.tipo_factura) ? { background: '#fff1f1', opacity: 0.85 } : {}}>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtF(f.fecha)}</td>
                      <td><span className={`badge bg-${esNC(f.tipo_factura) ? 'danger' : 'secondary'}`} style={{ fontSize: '0.65rem' }}>{f.tipo_factura || 'A'}</span></td>
                      <td className="fw-semibold" style={{ whiteSpace: 'nowrap' }}>{f.numero}</td>
                      <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.cliente_nombre}>{f.cliente_nombre || '—'}</td>
                      <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.concepto}>{f.concepto || '—'}</td>
                      <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{f.oc || '—'}</td>
                      <td className="text-end">{f.neto_gravado ? fmtM(f.neto_gravado, f.moneda) : '—'}</td>
                      <td className="text-end">{f.iva_21 ? fmtM(f.iva_21, f.moneda) : '—'}</td>
                      <td className="text-end fw-semibold">{fmtM(f.importe, f.moneda)}</td>
                      <td className="text-end">{f.ret_iibb ? fmtM(f.ret_iibb, f.moneda) : '—'}</td>
                      <td className="text-end">{f.ret_iva ? fmtM(f.ret_iva, f.moneda) : '—'}</td>
                      <td className="text-end">{f.ret_gcia ? fmtM(f.ret_gcia, f.moneda) : '—'}</td>
                      <td className="text-end fw-semibold text-success">{f.total_pagado > 0 ? fmtM(f.total_pagado, f.moneda) : '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtF(f.fecha_pago)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {esNC(f.tipo_factura) ? (
                          <span className="badge bg-danger" style={{ fontSize: '0.68rem' }}>Anulada</span>
                        ) : (
                          <div className="d-flex gap-1 align-items-center">
                            {f.pago_confirmado ? (
                              <span className="badge bg-success" style={{ fontSize: '0.68rem' }}>
                                <i className="bi bi-check-circle-fill me-1" />Cobrada
                              </span>
                            ) : f.count_pagos > 0 ? (
                              <div style={{ fontSize: '0.72rem', lineHeight: 1.4 }}>
                                <div className="text-success fw-semibold">
                                  <i className="bi bi-check2 me-1" />Cob: {fmtM(f.total_pagado, f.moneda)}
                                </div>
                                <div className="text-danger fw-semibold">
                                  <i className="bi bi-hourglass-split me-1" />Rest: {fmtM(f.saldo_pendiente, f.moneda)}
                                </div>
                              </div>
                            ) : (
                              <span className="badge bg-secondary" style={{ fontSize: '0.68rem' }}>Pendiente</span>
                            )}
                            {canWrite && (
                              <button className="btn btn-sm btn-outline-primary py-0 px-1" style={{ fontSize: '0.7rem' }}
                                onClick={() => abrirPagosV(f)} title="Gestionar pagos">
                                <i className="bi bi-cash-coin" />
                                {f.count_pagos > 0 && <span className="ms-1">{f.count_pagos}</span>}
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      {canWrite && (
                        <td>
                          <div className="d-flex gap-1">
                            <button className="btn btn-sm btn-outline-primary py-0 px-1" title="Editar" onClick={() => abrirEditV(f)}>
                              <i className="bi bi-pencil" />
                            </button>
                            <button className="btn btn-sm btn-outline-danger py-0 px-1" title="Eliminar" onClick={() => eliminarV(f)}>
                              <i className="bi bi-trash" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── MODAL FACTURA COMPRA ── */}
      {modalC && (() => {
        const totalC = calcTotalC(formC)
        return (
        <div className="modal d-block" style={{ background: 'rgba(0,0,0,.45)' }}>
          <div className="modal-dialog modal-xl">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h6 className="modal-title fw-bold">
                  <i className="bi bi-receipt me-2" />{modalC === 'new' ? 'Nueva' : 'Editar'} Factura de Compra
                </h6>
                <button className="btn-close btn-sm" onClick={() => setModalC(null)} />
              </div>
              <div className="modal-body" style={{ fontSize: '0.87rem' }}>

                {/* ── Proveedor ── */}
                <div className="row g-2 mb-3">
                  <div className="col-md-7">
                    <label className="form-label small fw-semibold">Proveedor *</label>
                    <div className="d-flex gap-1">
                      <select className="form-select form-select-sm" value={formC.proveedor_id}
                        onChange={e => {
                          const pv = proveedores.find(p => String(p.id) === e.target.value)
                          setFormC(prev => ({ ...prev, proveedor_id: e.target.value, proveedor_nombre: pv?.nombre || '', cuit: pv?.cuit || prev.cuit }))
                        }}>
                        <option value="">— Seleccionar proveedor —</option>
                        {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                      </select>
                      <button className="btn btn-sm btn-outline-success flex-shrink-0" title="Nuevo proveedor"
                        onClick={() => { setAddProvC('new'); setNewProvForm({ nombre: '', cuit: '' }) }}>
                        <i className="bi bi-plus-lg" />
                      </button>
                      {formC.proveedor_id && (
                        <button className="btn btn-sm btn-outline-secondary flex-shrink-0" title="Editar proveedor"
                          onClick={() => {
                            const pv = proveedores.find(p => String(p.id) === formC.proveedor_id)
                            setAddProvC('edit'); setNewProvForm({ nombre: pv?.nombre || '', cuit: pv?.cuit || '' })
                          }}>
                          <i className="bi bi-pencil" />
                        </button>
                      )}
                    </div>
                    {addProvC && (
                      <div className="border rounded p-2 mt-2 bg-light">
                        <p className="small fw-semibold mb-2 text-muted">{addProvC === 'new' ? 'Nuevo proveedor' : 'Editar proveedor'}</p>
                        <div className="d-flex gap-2 align-items-end flex-wrap">
                          <div className="flex-grow-1">
                            <label className="form-label small mb-1">Nombre *</label>
                            <input className="form-control form-control-sm" value={newProvForm.nombre}
                              onChange={e => setNewProvForm(p => ({ ...p, nombre: e.target.value }))} placeholder="Razón social" />
                          </div>
                          <div style={{ width: 170 }}>
                            <label className="form-label small mb-1">CUIT</label>
                            <input className="form-control form-control-sm" value={newProvForm.cuit}
                              onChange={e => setNewProvForm(p => ({ ...p, cuit: e.target.value }))} placeholder="20-12345678-9" />
                          </div>
                          <button className="btn btn-sm btn-primary" onClick={addProvC === 'new' ? guardarNuevoProv : guardarEditProv}>Guardar</button>
                          <button className="btn btn-sm btn-secondary" onClick={() => setAddProvC(false)}>Cancelar</button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="col-md-5">
                    <label className="form-label small fw-semibold">CUIT</label>
                    <input className="form-control form-control-sm" value={formC.cuit}
                      onChange={e => setFormC(p => ({ ...p, cuit: e.target.value }))} placeholder="Ej: 30-12345678-9" />
                  </div>
                </div>

                {/* ── Comprobante ── */}
                <div className="row g-2 mb-3">
                  <div className="col-md-2">
                    <label className="form-label small fw-semibold">Tipo</label>
                    <select className="form-select form-select-sm" value={formC.tipo_factura}
                      onChange={e => setFormC(p => ({ ...p, tipo_factura: e.target.value }))}>
                      <option value="A">A</option>
                      <option value="B">B</option>
                      <option value="C">C</option>
                      <option value="E">E</option>
                      <option value="M">M</option>
                    </select>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label small fw-semibold">N° Factura *</label>
                    <input className="form-control form-control-sm" value={formC.numero}
                      onChange={e => setFormC(p => ({ ...p, numero: e.target.value }))} placeholder="Ej: 00004-00012345" />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-semibold">Fecha</label>
                    <DateInput className="form-control form-control-sm" value={formC.fecha}
                      onChange={v => setFormC(p => ({ ...p, fecha: v }))} />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-semibold">Fecha vencimiento</label>
                    <DateInput className="form-control form-control-sm" value={formC.fecha_vencimiento}
                      onChange={v => setFormC(p => ({ ...p, fecha_vencimiento: v }))} />
                  </div>
                </div>

                <hr className="my-2" />
                <p className="small fw-semibold text-muted mb-2" style={{ letterSpacing: '0.05em' }}>IMPORTES</p>

                {/* Neto */}
                <div className="row g-2 mb-2">
                  <div className="col-md-4">
                    <label className="form-label small fw-semibold">Neto Gravado</label>
                    <input type="number" className="form-control form-control-sm" value={formC.neto_gravado}
                      onChange={e => onNetoGravadoC(e.target.value)} min="0" step="0.01" placeholder="0.00" />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label small fw-semibold">No Grav. / Exento</label>
                    <input type="number" className="form-control form-control-sm" value={formC.no_grav_exento}
                      onChange={e => setFormC(p => ({ ...p, no_grav_exento: e.target.value }))} min="0" step="0.01" placeholder="0.00" />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label small fw-semibold">Moneda</label>
                    <select className="form-select form-select-sm" value={formC.moneda}
                      onChange={e => setFormC(p => ({ ...p, moneda: e.target.value }))}>
                      {MONEDAS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                </div>

                {/* IVA */}
                <div className="row g-2 mb-2">
                  {[
                    { key: 'iva_21',   label: 'IVA 21%',   rate: 0.21  },
                    { key: 'iva_10_5', label: 'IVA 10.5%', rate: 0.105 },
                    { key: 'iva_27',   label: 'IVA 27%',   rate: 0.27  },
                  ].map(({ key, label, rate }) => (
                    <div key={key} className="col-md-3">
                      <label className="form-label small fw-semibold">{label}</label>
                      <div className="input-group input-group-sm">
                        <input type="number" className="form-control form-control-sm" value={formC[key]}
                          onChange={e => setFormC(p => ({ ...p, [key]: e.target.value }))} min="0" step="0.01" placeholder="0.00" />
                        <button type="button" className="btn btn-outline-secondary px-2"
                          title={`Calcular ${label} desde Neto Gravado`}
                          onClick={() => setFormC(p => ({ ...p, [key]: calcIvaC(p.neto_gravado, rate) }))}>
                          <i className="bi bi-calculator" style={{ fontSize: '0.72rem' }} />
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="col-md-3 d-flex align-items-end">
                    <span className="text-primary fw-semibold small pb-1">
                      Total IVA: {fmtM((parseFloat(formC.iva_21)||0)+(parseFloat(formC.iva_10_5)||0)+(parseFloat(formC.iva_27)||0), formC.moneda)}
                    </span>
                  </div>
                </div>

                {/* Percepciones y otros */}
                <div className="row g-2 mb-3">
                  <div className="col-md-3">
                    <label className="form-label small fw-semibold">Perc. IVA</label>
                    <input type="number" className="form-control form-control-sm" value={formC.perc_iva}
                      onChange={e => setFormC(p => ({ ...p, perc_iva: e.target.value }))} min="0" step="0.01" placeholder="0.00" />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-semibold">Perc. IIBB</label>
                    <input type="number" className="form-control form-control-sm" value={formC.perc_iibb}
                      onChange={e => setFormC(p => ({ ...p, perc_iibb: e.target.value }))} min="0" step="0.01" placeholder="0.00" />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-semibold">Otros Impuestos</label>
                    <input type="number" className="form-control form-control-sm" value={formC.otros_imp}
                      onChange={e => setFormC(p => ({ ...p, otros_imp: e.target.value }))} min="0" step="0.01" placeholder="0.00" />
                  </div>
                  {formC.moneda !== 'PESO' && (
                    <div className="col-md-3">
                      <label className="form-label small fw-semibold">Tasa de cambio</label>
                      <input type="number" className="form-control form-control-sm" value={formC.tasa_cambio}
                        onChange={e => setFormC(p => ({ ...p, tasa_cambio: e.target.value }))} min="0" step="0.01" />
                    </div>
                  )}
                </div>

                {/* Total */}
                <div className="d-flex align-items-center gap-3 p-2 rounded mb-3" style={{ background: '#f0f4ff', border: '1px solid #c7d4f0' }}>
                  <span className="small fw-semibold text-muted">TOTAL FACTURA</span>
                  <span className="fs-4 fw-bold text-primary ms-2">{fmtM(totalC, formC.moneda)}</span>
                </div>

                <hr className="my-2" />

                {/* OC + Observaciones */}
                <div className="row g-2">
                  <div className="col-md-6">
                    <label className="form-label small fw-semibold">Ref. OC <span className="text-muted fw-normal">(opcional)</span></label>
                    <select className="form-select form-select-sm" value={formC.oc_id}
                      onChange={e => {
                        const oc = ocs.find(o => String(o.id) === e.target.value)
                        setFormC(prev => ({ ...prev, oc_id: e.target.value, oc_numero: oc?.numero || '' }))
                      }}>
                      <option value="">— Sin OC —</option>
                      {ocs.map(o => <option key={o.id} value={o.id}>{o.numero} — {o.proveedor_nombre}</option>)}
                    </select>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small fw-semibold">Observaciones</label>
                    <input className="form-control form-control-sm" value={formC.observaciones}
                      onChange={e => setFormC(p => ({ ...p, observaciones: e.target.value }))} />
                  </div>
                </div>

              </div>
              <div className="modal-footer py-2">
                <button className="btn btn-sm btn-secondary" onClick={() => setModalC(null)}>Cancelar</button>
                <button className="btn btn-sm btn-primary" onClick={guardarC} disabled={savC}>
                  {savC ? <><span className="spinner-border spinner-border-sm me-1" />Guardando...</> : 'Guardar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )})()}

      {/* ── MODAL ANTICIPO ── */}
      {anticipoModal && (
        <div className="modal d-block" style={{ background: 'rgba(0,0,0,.45)', zIndex: 1060 }}>
          <div className="modal-dialog modal-sm modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h6 className="modal-title fw-bold"><i className="bi bi-clock-history me-2" />Registrar Anticipo</h6>
                <button className="btn-close btn-sm" onClick={() => setAnticipoModal(null)} />
              </div>
              <div className="modal-body">
                <p className="small text-muted mb-2">{anticipoModal.f.numero}</p>
                <p className="small mb-3">Total: <strong>{fmtM(anticipoModal.f.importe, anticipoModal.f.moneda)}</strong></p>
                <div className="mb-2">
                  <label className="form-label small fw-semibold">Monto anticipo</label>
                  <input type="number" className="form-control form-control-sm" value={anticipoForm.anticipo}
                    onChange={e => setAnticipoForm(p => ({ ...p, anticipo: e.target.value }))}
                    min="0" step="0.01" placeholder="0.00" autoFocus />
                  {anticipoForm.anticipo > 0 && (
                    <small className="text-muted">Saldo: {fmtM(anticipoModal.f.importe - parseFloat(anticipoForm.anticipo), anticipoModal.f.moneda)}</small>
                  )}
                </div>
                <div className="mb-0">
                  <label className="form-label small fw-semibold">Fecha anticipo</label>
                  <DateInput className="form-control form-control-sm" value={anticipoForm.fecha_anticipo}
                    onChange={v => setAnticipoForm(p => ({ ...p, fecha_anticipo: v }))} />
                </div>
              </div>
              <div className="modal-footer py-2">
                <button className="btn btn-sm btn-secondary" onClick={() => setAnticipoModal(null)}>Cancelar</button>
                <button className="btn btn-sm btn-warning" onClick={guardarAnticipo} disabled={!anticipoForm.anticipo}>
                  <i className="bi bi-clock-history me-1" />Guardar anticipo
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL FACTURA VENTA ── */}
      {modalV && (
        <div className="modal d-block" style={{ background: 'rgba(0,0,0,.45)' }}>
          <div className="modal-dialog modal-xl">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h6 className="modal-title fw-bold">
                  <i className="bi bi-receipt me-2" />{modalV === 'new' ? 'Nueva' : 'Editar'} Factura de Venta
                </h6>
                <button className="btn-close btn-sm" onClick={() => setModalV(null)} />
              </div>
              <div className="modal-body" style={{ fontSize: '0.87rem' }}>

                {/* ── Comprobante ── */}
                <div className="row g-2 mb-3">
                  <div className="col-md-2">
                    <label className="form-label small fw-semibold">Tipo</label>
                    <input className="form-control form-control-sm" value={formV.tipo_factura}
                      onChange={e => setFormV(p => ({ ...p, tipo_factura: e.target.value }))}
                      placeholder="FA, NC, FCEA..." />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-semibold">N° Factura *</label>
                    <input className="form-control form-control-sm" value={formV.numero}
                      onChange={e => setFormV(p => ({ ...p, numero: e.target.value }))}
                      placeholder="Ej: 3-926" />
                  </div>
                  <div className="col-md-2">
                    <label className="form-label small fw-semibold">Fecha *</label>
                    <DateInput className="form-control form-control-sm" value={formV.fecha}
                      onChange={v => setFormV(p => ({ ...p, fecha: v }))} />
                  </div>
                  <div className="col-md-2">
                    <label className="form-label small fw-semibold">F. Vencimiento</label>
                    <DateInput className="form-control form-control-sm" value={formV.fecha_vencimiento}
                      onChange={v => setFormV(p => ({ ...p, fecha_vencimiento: v }))} />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-semibold">F. Pago / Cobro</label>
                    <DateInput className="form-control form-control-sm" value={formV.fecha_pago}
                      onChange={v => setFormV(p => ({ ...p, fecha_pago: v }))} />
                  </div>
                </div>

                {/* ── Cliente + OC ── */}
                <div className="row g-2 mb-3">
                  <div className="col-md-4">
                    <label className="form-label small fw-semibold">Cliente</label>
                    <select className="form-select form-select-sm" value={formV.cliente_id}
                      onChange={e => {
                        const cl = clientes.find(c => String(c.id) === e.target.value)
                        setFormV(prev => ({ ...prev, cliente_id: e.target.value, cliente_nombre: cl?.nombre || '' }))
                      }}>
                      <option value="">— Seleccionar —</option>
                      {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                    </select>
                    {!formV.cliente_id && (
                      <input className="form-control form-control-sm mt-1"
                        placeholder="O escribir nombre manualmente"
                        value={formV.cliente_nombre}
                        onChange={e => setFormV(p => ({ ...p, cliente_nombre: e.target.value }))} />
                    )}
                  </div>
                  <div className="col-md-5">
                    <label className="form-label small fw-semibold">Concepto</label>
                    <input className="form-control form-control-sm" value={formV.concepto}
                      onChange={e => setFormV(p => ({ ...p, concepto: e.target.value }))}
                      placeholder="Descripción del servicio / producto" />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-semibold">OC / Referencia</label>
                    <input className="form-control form-control-sm" value={formV.oc}
                      onChange={e => setFormV(p => ({ ...p, oc: e.target.value }))}
                      placeholder="Nro. orden de compra" />
                  </div>
                </div>

                <hr className="my-2" />
                <p className="small fw-semibold text-muted mb-2" style={{ letterSpacing: '0.05em' }}>IMPORTES</p>

                {/* Neto + IVA + Moneda */}
                <div className="row g-2 mb-2">
                  <div className="col-md-3">
                    <label className="form-label small fw-semibold">Neto Gravado</label>
                    <input type="number" className="form-control form-control-sm" value={formV.neto_gravado}
                      onChange={e => setFormV(p => ({ ...p, neto_gravado: e.target.value }))} min="0" step="0.01" placeholder="0.00" />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-semibold">IVA 21%</label>
                    <div className="input-group input-group-sm">
                      <input type="number" className="form-control form-control-sm" value={formV.iva_21}
                        onChange={e => setFormV(p => ({ ...p, iva_21: e.target.value }))} min="0" step="0.01" placeholder="0.00" />
                      <button type="button" className="btn btn-outline-secondary px-2"
                        title="Calcular IVA 21% desde Neto"
                        onClick={() => setFormV(p => ({ ...p, iva_21: Math.round((parseFloat(p.neto_gravado)||0) * 0.21 * 100) / 100 }))}>
                        <i className="bi bi-calculator" style={{ fontSize: '0.72rem' }} />
                      </button>
                    </div>
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-semibold">Total Factura</label>
                    <input type="number" className="form-control form-control-sm" value={formV.importe}
                      onChange={e => setFormV(p => ({ ...p, importe: e.target.value }))} min="0" step="0.01" placeholder="0.00" />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-semibold">Moneda</label>
                    <select className="form-select form-select-sm" value={formV.moneda}
                      onChange={e => setFormV(p => ({ ...p, moneda: e.target.value }))}>
                      {MONEDAS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    {formV.moneda !== 'PESO' && (
                      <input type="number" className="form-control form-control-sm mt-1" value={formV.tasa_cambio}
                        onChange={e => setFormV(p => ({ ...p, tasa_cambio: e.target.value }))}
                        min="0" step="0.01" placeholder="Tasa de cambio" />
                    )}
                  </div>
                </div>

                <hr className="my-2" />
                <p className="small fw-semibold text-muted mb-2" style={{ letterSpacing: '0.05em' }}>RETENCIONES</p>

                <div className="row g-2 mb-2">
                  {[
                    { key: 'ret_iibb',       label: 'Ret. IIBB'       },
                    { key: 'ret_iva',        label: 'Ret. IVA'        },
                    { key: 'ret_gcia',       label: 'Ret. Gcía.'      },
                    { key: 'ret_contratista',label: 'Ret. Contratista'},
                    { key: 'ret_ss',         label: 'Ret. SS'         },
                    { key: 'dif_cambio',     label: 'Dif. Cambio'     },
                  ].map(({ key, label }) => (
                    <div key={key} className="col-md-2">
                      <label className="form-label small fw-semibold">{label}</label>
                      <input type="number" className="form-control form-control-sm" value={formV[key]}
                        onChange={e => setFormV(p => ({ ...p, [key]: e.target.value }))} min="0" step="0.01" placeholder="0.00" />
                    </div>
                  ))}
                </div>
                <div className="row g-2 mb-3">
                  <div className="col-md-3">
                    <label className="form-label small fw-semibold">Total Cobrado</label>
                    <input type="number" className="form-control form-control-sm" value={formV.total_cobrado}
                      onChange={e => setFormV(p => ({ ...p, total_cobrado: e.target.value }))} min="0" step="0.01" placeholder="0.00" />
                  </div>
                  <div className="col-md-9 d-flex align-items-end pb-1">
                    {(() => {
                      const rets = ['ret_iibb','ret_iva','ret_gcia','ret_contratista','ret_ss'].reduce((s, k) => s + (parseFloat(formV[k])||0), 0)
                      const dif  = parseFloat(formV.dif_cambio) || 0
                      const imp  = parseFloat(formV.importe) || 0
                      if (rets || dif) return (
                        <span className="small text-muted">
                          Total retenciones: <strong>{fmtM(rets, formV.moneda)}</strong>
                          {dif ? <> · Dif. cambio: <strong>{fmtM(dif, formV.moneda)}</strong></> : null}
                          {imp ? <> · Neto estimado: <strong className="text-success">{fmtM(imp - rets - dif, formV.moneda)}</strong></> : null}
                        </span>
                      )
                      return null
                    })()}
                  </div>
                </div>

                <hr className="my-2" />
                <div className="row g-2">
                  <div className="col-md-6">
                    <label className="form-label small fw-semibold">Presupuesto <span className="text-muted fw-normal">(opcional)</span></label>
                    <select className="form-select form-select-sm" value={formV.presupuesto_id}
                      onChange={e => {
                        const pp = presupuestos.find(p => String(p.id) === e.target.value)
                        setFormV(prev => ({ ...prev, presupuesto_id: e.target.value, presupuesto_ref: pp?.numero || '' }))
                      }}>
                      <option value="">— Sin presupuesto —</option>
                      {presupuestos.map(p => <option key={p.id} value={p.id}>{p.numero} — {p.cli_nombre}</option>)}
                    </select>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small fw-semibold">Observaciones</label>
                    <input className="form-control form-control-sm" value={formV.observaciones}
                      onChange={e => setFormV(p => ({ ...p, observaciones: e.target.value }))} />
                  </div>
                </div>

              </div>
              <div className="modal-footer py-2">
                <button className="btn btn-sm btn-secondary" onClick={() => setModalV(null)}>Cancelar</button>
                <button className="btn btn-sm btn-primary" onClick={guardarV} disabled={savV}>
                  {savV ? <><span className="spinner-border spinner-border-sm me-1" />Guardando...</> : 'Guardar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL PAGOS VENTA ── */}
      {pagosModal && (
        <div className="modal d-block" style={{ background: 'rgba(0,0,0,.45)', zIndex: 1060 }}>
          <div className="modal-dialog modal-lg modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header py-2">
                <div>
                  <h6 className="modal-title mb-0 fw-bold">
                    Pagos — {pagosModal.tipo_factura} {pagosModal.numero}
                  </h6>
                  <small className="text-muted">{pagosModal.cliente_nombre}</small>
                </div>
                <button className="btn-close" onClick={() => setPagosModal(null)} />
              </div>
              <div className="modal-body">

                {/* Resumen financiero */}
                {(() => {
                  const cobrado = pagos.filter(p => p.estado === 'confirmado').reduce((s, p) => s + p.importe, 0)
                  const cheques = pagos.filter(p => p.estado === 'pendiente').reduce((s, p) => s + p.importe, 0)
                  const total   = pagosModal.importe * (pagosModal.tasa_cambio || 1)
                  const saldo   = Math.max(0, total - cobrado)
                  return (
                    <div className="d-flex gap-4 mb-3 p-2 rounded" style={{ background: '#f8f9fa' }}>
                      <div><div className="small text-muted">Total factura</div><div className="fw-bold">{fmtM(total,'PESO')}</div></div>
                      <div><div className="small text-muted">Cobrado</div><div className="fw-bold text-success">{fmtM(cobrado,'PESO')}</div></div>
                      <div><div className="small text-muted">Saldo pendiente</div>
                        <div className={`fw-bold ${saldo > 0 ? 'text-danger' : 'text-success'}`}>{fmtM(saldo,'PESO')}</div></div>
                      {cheques > 0 && (
                        <div><div className="small text-muted">Cheques a acreditar</div><div className="fw-bold text-warning">{fmtM(cheques,'PESO')}</div></div>
                      )}
                    </div>
                  )
                })()}

                {/* Lista de pagos */}
                {pagosLoad ? (
                  <div className="text-center py-3"><span className="spinner-border spinner-border-sm" /></div>
                ) : pagos.length === 0 ? (
                  <p className="text-muted small text-center py-2">Sin pagos registrados</p>
                ) : (
                  <table className="table table-sm align-middle mb-3" style={{ fontSize: '0.8rem' }}>
                    <thead className="table-light">
                      <tr>
                        <th>Tipo</th><th>Forma</th><th>Entidad</th>
                        <th className="text-end">Importe</th><th>Fecha</th>
                        <th>F. Acred.</th><th>Estado</th>
                        {canWrite && <th style={{ width: 70 }} />}
                      </tr>
                    </thead>
                    <tbody>
                      {pagos.map(p => (
                        <tr key={p.id} style={p.estado === 'pendiente' ? { background: '#fffbea' } : {}}>
                          <td><span className="badge bg-secondary" style={{ fontSize: '0.65rem' }}>{p.tipo}</span></td>
                          <td>{p.forma_pago}</td>
                          <td className="text-muted">{p.entidad || '—'}</td>
                          <td className="text-end fw-semibold">{fmtM(p.importe, p.moneda)}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>{fmtF(p.fecha)}</td>
                          <td style={{ whiteSpace: 'nowrap' }} className="text-muted">{p.fecha_acreditacion ? fmtF(p.fecha_acreditacion) : '—'}</td>
                          <td>
                            {p.estado === 'pendiente'
                              ? <span className="badge bg-warning text-dark" style={{ fontSize: '0.65rem' }}>Pendiente</span>
                              : <span className="badge bg-success" style={{ fontSize: '0.65rem' }}>Confirmado</span>}
                          </td>
                          {canWrite && (
                            <td>
                              <div className="d-flex gap-1">
                                {p.estado === 'pendiente' && (
                                  <button className="btn btn-sm btn-outline-success py-0 px-1" title="Confirmar acreditación" onClick={() => confirmarPago(p)}>
                                    <i className="bi bi-check-lg" />
                                  </button>
                                )}
                                <button className="btn btn-sm btn-outline-danger py-0 px-1" onClick={() => eliminarPago(p)}>
                                  <i className="bi bi-trash" />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* Formulario nuevo pago */}
                {canWrite && !mostrarForm && (
                  <button className="btn btn-sm btn-outline-primary" onClick={() => setMostrarForm(true)}>
                    <i className="bi bi-plus-lg me-1" />Registrar pago
                  </button>
                )}
                {canWrite && mostrarForm && (
                  <div className="border rounded p-3" style={{ background: '#f8f9ff' }}>
                    <p className="small fw-semibold mb-2">Nuevo pago</p>
                    <div className="row g-2 mb-2">
                      <div className="col-md-3">
                        <label className="form-label small">Tipo</label>
                        <select className="form-select form-select-sm" value={pagoForm.tipo}
                          onChange={e => setPagoForm(p => ({ ...p, tipo: e.target.value }))}>
                          {TIPOS_PAGO.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div className="col-md-3">
                        <label className="form-label small">Forma de pago</label>
                        <select className="form-select form-select-sm" value={pagoForm.forma_pago}
                          onChange={e => setPagoForm(p => ({ ...p, forma_pago: e.target.value }))}>
                          {FORMAS_PAGO.map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                      </div>
                      <div className="col-md-3">
                        <label className="form-label small">Entidad / Banco</label>
                        <input className="form-control form-control-sm" value={pagoForm.entidad}
                          onChange={e => setPagoForm(p => ({ ...p, entidad: e.target.value }))}
                          placeholder="Banco Galicia..." />
                      </div>
                      <div className="col-md-3">
                        <label className="form-label small">Moneda</label>
                        <select className="form-select form-select-sm" value={pagoForm.moneda}
                          onChange={e => setPagoForm(p => ({ ...p, moneda: e.target.value }))}>
                          {MONEDAS.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="row g-2 mb-2">
                      <div className="col-md-3">
                        <label className="form-label small">Importe *</label>
                        <input type="number" className="form-control form-control-sm" value={pagoForm.importe}
                          onChange={e => setPagoForm(p => ({ ...p, importe: e.target.value }))}
                          min="0" step="0.01" placeholder="0.00" />
                      </div>
                      <div className="col-md-3">
                        <label className="form-label small">Fecha *</label>
                        <DateInput className="form-control form-control-sm" value={pagoForm.fecha}
                          onChange={v => setPagoForm(p => ({ ...p, fecha: v }))} />
                      </div>
                      {pagoForm.forma_pago === 'cheque_diferido' && (
                        <div className="col-md-3">
                          <label className="form-label small">Fecha acreditación</label>
                          <DateInput className="form-control form-control-sm" value={pagoForm.fecha_acreditacion}
                            onChange={v => setPagoForm(p => ({ ...p, fecha_acreditacion: v }))} />
                        </div>
                      )}
                      <div className={pagoForm.forma_pago === 'cheque_diferido' ? 'col-md-3' : 'col-md-6'}>
                        <label className="form-label small">Observaciones</label>
                        <input className="form-control form-control-sm" value={pagoForm.observaciones}
                          onChange={e => setPagoForm(p => ({ ...p, observaciones: e.target.value }))} />
                      </div>
                    </div>
                    {pagoForm.forma_pago === 'cheque_diferido' && (
                      <p className="small text-warning mb-2">
                        <i className="bi bi-info-circle me-1" />
                        Se registra como <strong>pendiente</strong> hasta que confirmes la acreditación.
                      </p>
                    )}
                    <div className="d-flex gap-2">
                      <button className="btn btn-sm btn-primary" onClick={agregarPago} disabled={pagoSaving}>
                        {pagoSaving ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="bi bi-check-lg me-1" />}
                        Guardar pago
                      </button>
                      <button className="btn btn-sm btn-outline-secondary" onClick={() => setMostrarForm(false)}>Cancelar</button>
                    </div>
                  </div>
                )}

              </div>
              <div className="modal-footer py-2">
                <button className="btn btn-sm btn-secondary" onClick={() => setPagosModal(null)}>Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
