import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'
import { puedeEscribir } from '../../store/authStore'
import DateInput from '../../components/DateInput'
import FinanzasDashboard from './FinanzasDashboard'
import FinanzasOCClientes from './FinanzasOCClientes'

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

const FORM_PAGO = { tipo: 'parcial', forma_pago: 'transferencia', entidad: '', importe: '', moneda: 'PESO', fecha: new Date().toISOString().slice(0,10), fecha_acreditacion: '', observaciones: '', ret_iibb: '', ret_iva: '', ret_gcia: '', ret_contratista: '', ret_ss: '' }

const FORMAS_PAGO = ['transferencia','cheque','cheque_diferido','e-cheq','efectivo','deposito']
const TIPOS_PAGO  = ['anticipo','parcial','final']

const FORM_C = { tipo_factura: 'A', numero: '', fecha: '', proveedor_id: '', proveedor_nombre: '', cuit: '', oc_id: '', oc_numero: '', neto_gravado: '', no_grav_exento: '', iva_21: '', iva_10_5: '', iva_27: '', otros_imp: '', perc_iva: '', perc_iibb: '', importe: '', moneda: 'PESO', tasa_cambio: 1, fecha_vencimiento: '', observaciones: '' }
const FORM_V = { tipo_factura: 'A', numero: '', fecha: '', cliente_id: '', cliente_nombre: '', presupuesto_id: '', presupuesto_ref: '', concepto: '', oc: '', oc_pct: '', proyecto_id: '', proyecto: '', neto_gravado: '', iva_21: '', ret_iibb: '', ret_iva: '', ret_gcia: '', ret_contratista: '', ret_ss: '', dif_cambio: '', total_cobrado: '', importe: '', moneda: 'PESO', tasa_cambio: 1, fecha_vencimiento: '', fecha_pago: '', observaciones: '' }

function ProyectoSelector({ value, onChange }) {
  const [query,   setQuery]   = useState(value || '')
  const [opciones, setOpc]    = useState([])
  const [abierto, setAbierto] = useState(false)

  useEffect(() => { setQuery(value || '') }, [value])

  const buscar = async q => {
    setQuery(q)
    if (q.length < 1) { setOpc([]); setAbierto(false); return }
    try {
      const r = await api.get('/proyectos', { params: { buscar: q } })
      setOpc(r.data.slice(0, 10))
      setAbierto(true)
    } catch { setOpc([]) }
  }

  const seleccionar = p => {
    setQuery(`${p.codigo} — ${p.nombre}`)
    setAbierto(false)
    onChange(p)
  }

  return (
    <div className="position-relative">
      <input className="form-control form-control-sm" value={query}
        placeholder="Buscar por código o nombre de proyecto..."
        onChange={e => buscar(e.target.value)}
        onBlur={() => setTimeout(() => setAbierto(false), 180)}
        autoComplete="off" />
      {abierto && opciones.length > 0 && (
        <div className="border rounded bg-white shadow-sm position-absolute w-100" style={{ zIndex: 1080, top: '100%', maxHeight: 220, overflowY: 'auto' }}>
          {opciones.map(p => (
            <div key={p.id} className="px-2 py-1 border-bottom" style={{ cursor: 'pointer', fontSize: '0.83rem' }}
              onMouseDown={() => seleccionar(p)}>
              <span className="badge bg-secondary me-1" style={{ fontSize: '0.7rem', fontFamily: 'monospace' }}>{p.codigo}</span>
              <span className="fw-semibold">{p.nombre}</span>
              {p.cliente_nombre && (
                <span className="text-muted ms-2" style={{ fontSize: '0.75rem' }}>{p.cliente_nombre}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const OC_PENDIENTE = { id: null, numero_oc: 'PENDIENTE' }

function OcClienteSelector({ value, onChange }) {
  const [query,   setQuery]   = useState(value || '')
  const [opciones, setOpc]    = useState([])
  const [abierto, setAbierto] = useState(false)

  useEffect(() => { setQuery(value || '') }, [value])

  const buscar = async q => {
    setQuery(q)
    try {
      const r = await api.get('/finanzas/oc-clientes', { params: q ? { buscar: q } : {} })
      // Abierta = todavía falta facturar un % del monto de la OC (independiente del cierre administrativo)
      const abiertas = r.data.filter(oc => {
        const monto     = parseFloat(oc.monto_oc) || 0
        const facturado = (parseFloat(oc.monto_anticipo_usd) || 0) + (parseFloat(oc.monto_final_usd) || 0)
        return monto <= 0 || facturado < monto
      })
      setOpc(abiertas.slice(0, 12))
      setAbierto(true)
    } catch { setOpc([]) }
  }

  const seleccionar = oc => {
    setQuery(oc.numero_oc)
    setAbierto(false)
    onChange(oc)
  }

  // Si se tipeó algo sin elegir una opción de la lista, se descarta al salir del campo
  const cancelarTexto = () => setTimeout(() => { setAbierto(false); setQuery(value || '') }, 180)

  return (
    <div className="position-relative">
      <input className="form-control form-control-sm" value={query}
        placeholder="Buscar OC abierta por número o cliente..."
        onChange={e => buscar(e.target.value)}
        onFocus={() => buscar(query)}
        onBlur={cancelarTexto}
        autoComplete="off" />
      {abierto && (
        <div className="border rounded bg-white shadow-sm position-absolute w-100" style={{ zIndex: 1080, top: '100%', maxHeight: 260, overflowY: 'auto' }}>
          <div className="px-2 py-1 border-bottom" style={{ cursor: 'pointer', fontSize: '0.83rem', background: '#fff8e6' }}
            onMouseDown={() => seleccionar(OC_PENDIENTE)}>
            <i className="bi bi-exclamation-circle me-1 text-warning" />
            <span className="fw-semibold">PENDIENTE</span>
            <span className="text-muted ms-2" style={{ fontSize: '0.72rem' }}>— completar después</span>
          </div>
          {opciones.length === 0 ? (
            <div className="text-muted text-center py-2" style={{ fontSize: '0.75rem' }}>Sin OC abiertas que coincidan</div>
          ) : opciones.map(oc => {
            const monto     = parseFloat(oc.monto_oc) || 0
            const facturado = (parseFloat(oc.monto_anticipo_usd) || 0) + (parseFloat(oc.monto_final_usd) || 0)
            const pct       = monto > 0 ? Math.round(facturado / monto * 100) : null
            return (
              <div key={oc.id} className="px-2 py-1 border-bottom" style={{ cursor: 'pointer', fontSize: '0.83rem' }}
                onMouseDown={() => seleccionar(oc)}>
                <span className="fw-semibold text-primary">{oc.numero_oc}</span>
                <span className="text-muted ms-2" style={{ fontSize: '0.75rem' }}>{oc.cliente}</span>
                {oc.proy_codigo && (
                  <span className="badge bg-secondary ms-2" style={{ fontSize: '0.65rem', fontFamily: 'monospace' }}>{oc.proy_codigo}</span>
                )}
                {pct !== null && (
                  <span className="text-muted ms-2" style={{ fontSize: '0.68rem' }}>{pct}% facturado</span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

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

export default function Finanzas({ canWrite: canWriteProp, noDashboard } = {}) {
  const canWrite = canWriteProp !== undefined ? canWriteProp : puedeEscribir('finanzas')
  const [tab, setTab] = useState(noDashboard ? 'compras' : 'dashboard')

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

  const [pagosModal,   setPagosModal]   = useState(null)
  const [pagos,        setPagos]        = useState([])
  const [pagosLoad,    setPagosLoad]    = useState(false)
  const [pagoForm,     setPagoForm]     = useState(FORM_PAGO)
  const [pagoSaving,   setPagoSaving]   = useState(false)
  const [mostrarForm,  setMostrarForm]  = useState(false)

  const [pagosModalC,  setPagosModalC]  = useState(null)
  const [pagosC,       setPagosC]       = useState([])
  const [pagosLoadC,   setPagosLoadC]   = useState(false)
  const [pagoFormC,    setPagoFormC]    = useState(FORM_PAGO)
  const [pagoSavingC,  setPagoSavingC]  = useState(false)
  const [mostrarFormC, setMostrarFormC] = useState(false)

  const [factV, setFactV] = useState([])
  const [filtV, setFiltV] = useState({ buscar: '', desde: '', hasta: '', moneda: '', pago: '' })
  const [loadV, setLoadV] = useState(false)
  const [modalV, setModalV] = useState(null)
  const [formV, setFormV] = useState(FORM_V)
  const [ocSel, setOcSel] = useState(null)  // fila completa de la OC elegida (null si es PENDIENTE o no hay OC)
  const [savV, setSavV] = useState(false)

  // ── Saldo bancario ───────────────────────────────────────────────────────────
  const BANCOS = ['Banco ICBC', 'Banco Galicia', 'Banco Santander Río']
  const FORM_SALDO = { entidad: 'Banco ICBC', monto: '', moneda: 'PESO' }
  const [saldos,     setSaldos]     = useState([])
  const [loadSaldos, setLoadSaldos] = useState(false)
  const [formSaldo,  setFormSaldo]  = useState(FORM_SALDO)
  const [savSaldo,   setSavSaldo]   = useState(false)

  const [tcBNA,     setTcBNA]     = useState([])
  const [formTC,    setFormTC]    = useState({ valor: '', fecha: new Date().toISOString().slice(0,10) })
  const [savTC,     setSavTC]     = useState(false)

  const cargarSaldos = useCallback(async () => {
    setLoadSaldos(true)
    try {
      const [rs, rt] = await Promise.all([
        api.get('/finanzas/saldo-bancario'),
        api.get('/finanzas/tipo-cambio'),
      ])
      setSaldos(rs.data)
      setTcBNA(rt.data)
    } finally { setLoadSaldos(false) }
  }, [])

  useEffect(() => { if (tab === 'saldos') cargarSaldos() }, [tab, cargarSaldos])

  const guardarSaldo = async () => {
    if (!formSaldo.monto || isNaN(parseFloat(formSaldo.monto))) return alert('Ingresá el monto')
    setSavSaldo(true)
    try {
      const r = await api.post('/finanzas/saldo-bancario', formSaldo)
      setSaldos(prev => [r.data, ...prev])
      setFormSaldo(p => ({ ...p, monto: '' }))
    } catch(e) { alert(e.response?.data?.error || 'Error') }
    finally { setSavSaldo(false) }
  }

  const eliminarSaldo = async s => {
    if (!confirm('¿Eliminar este registro?')) return
    await api.delete(`/finanzas/saldo-bancario/${s.id}`)
    setSaldos(prev => prev.filter(x => x.id !== s.id))
  }

  const guardarTC = async () => {
    if (!formTC.valor || isNaN(parseFloat(formTC.valor))) return alert('Ingresá el valor')
    setSavTC(true)
    try {
      const r = await api.post('/finanzas/tipo-cambio', { moneda: 'DÓLAR', valor: formTC.valor, fuente: 'BNA', fecha: formTC.fecha })
      setTcBNA(prev => [r.data, ...prev])
      setFormTC(p => ({ ...p, valor: '' }))
    } catch(e) { alert(e.response?.data?.error || 'Error') }
    finally { setSavTC(false) }
  }

  const eliminarTC = async t => {
    if (!confirm('¿Eliminar este registro?')) return
    await api.delete(`/finanzas/tipo-cambio/${t.id}`)
    setTcBNA(prev => prev.filter(x => x.id !== t.id))
  }

  // ── Servicios ────────────────────────────────────────────────────────────────
  const PERIODICIDADES = ['mensual','bimestral','trimestral','semestral','anual']
  const FORM_SERV = { descripcion: '', usuario: '', info_pago: '', periodicidad: 'mensual', vencimiento_inicial: '' }
  const [servicios,     setServicios]     = useState([])
  const [loadServ,      setLoadServ]      = useState(false)
  const [modalServ,     setModalServ]     = useState(null)  // null | 'new' | obj
  const [formServ,      setFormServ]      = useState(FORM_SERV)
  const [savServ,       setSavServ]       = useState(false)
  const [montoEdit,     setMontoEdit]     = useState({})    // { cuota_id: valor_string }
  const [pagandoId,     setPagandoId]     = useState(null)
  const [filtServ,      setFiltServ]      = useState({ estado: 'todos', periodicidad: '', buscar: '' })

  const [ctrlOC,    setCtrlOC]    = useState([])
  const [loadCtrlOC, setLoadCtrlOC] = useState(false)

  const cargarCtrlOC = useCallback(async () => {
    setLoadCtrlOC(true)
    try { const r = await api.get('/finanzas/control-oc'); setCtrlOC(r.data) }
    catch (e) { console.error(e) }
    finally { setLoadCtrlOC(false) }
  }, [])

  useEffect(() => { if (tab === 'control') cargarCtrlOC() }, [tab, cargarCtrlOC])

  const cargarServicios = useCallback(async () => {
    setLoadServ(true)
    try { const r = await api.get('/finanzas/servicios'); setServicios(r.data) }
    finally { setLoadServ(false) }
  }, [])

  useEffect(() => { if (tab === 'servicios') cargarServicios() }, [tab, cargarServicios])

  const guardarServ = async () => {
    if (!formServ.descripcion.trim()) return alert('La descripción es requerida')
    setSavServ(true)
    try {
      if (modalServ === 'new') await api.post('/finanzas/servicios', formServ)
      else await api.put(`/finanzas/servicios/${modalServ.id}`, formServ)
      setModalServ(null)
      cargarServicios()
    } catch(e) { alert(e.response?.data?.error || 'Error') }
    finally { setSavServ(false) }
  }

  const eliminarServ = async s => {
    if (!confirm(`¿Desactivar "${s.descripcion}"?`)) return
    await api.delete(`/finanzas/servicios/${s.id}`)
    cargarServicios()
  }

  const pagarCuota = async s => {
    if (!s.cuota_id) return
    setPagandoId(s.cuota_id)
    try {
      const fecha = new Date().toISOString().slice(0, 10)
      await api.post(`/finanzas/servicios-cuotas/${s.cuota_id}/pagar`, { fecha_pagada: fecha })
      cargarServicios()
    } catch(e) { alert(e.response?.data?.error || 'Error') }
    finally { setPagandoId(null) }
  }

  const guardarMonto = async (cuotaId, monto) => {
    if (!monto || isNaN(parseFloat(monto))) return
    await api.put(`/finanzas/servicios-cuotas/${cuotaId}`, { monto: parseFloat(monto) })
    setMontoEdit(p => { const n = {...p}; delete n[cuotaId]; return n })
    cargarServicios()
  }

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

  const reabrirC = async f => {
    if (!confirm('¿Marcar esta factura como pendiente de pago? Podrás corregir los pagos desde el modal.')) return
    await api.patch('/finanzas/facturas-compra/reabrir', { fuente: f.fuente, id: f.id })
    setFactC(prev => prev.map(x => (x.fuente === f.fuente && x.id === f.id) ? { ...x, pago_confirmado: 0 } : x))
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

  // ── Pagos de compras ───────────────────────────────────────────────────────
  const abrirPagosC = async f => {
    setPagosModalC(f); setMostrarFormC(false)
    setPagoFormC({ ...FORM_PAGO, moneda: f.moneda || 'PESO' })
    setPagosLoadC(true)
    try { const r = await api.get(`/finanzas/facturas-compra/${f.id}/pagos`); setPagosC(r.data) }
    finally { setPagosLoadC(false) }
  }

  const agregarPagoC = async () => {
    if (!pagoFormC.importe || parseFloat(pagoFormC.importe) <= 0) return alert('Importe requerido')
    if (!pagoFormC.fecha) return alert('Fecha requerida')
    setPagoSavingC(true)
    try {
      const r = await api.post(`/finanzas/facturas-compra/${pagosModalC.id}/pagos`, pagoFormC)
      setPagosC(p => [...p, r.data])
      setPagoFormC({ ...FORM_PAGO, moneda: pagosModalC.moneda || 'PESO' })
      setMostrarFormC(false)
      const totalPagado = [...pagosC, r.data].filter(p => p.estado === 'confirmado').reduce((s, p) => s + p.importe, 0)
      const saldo = Math.max(0, (pagosModalC.importe * (pagosModalC.tasa_cambio || 1)) - totalPagado)
      const cobrada = saldo <= 0.01 ? 1 : 0
      setFactC(prev => prev.map(x => x.id === pagosModalC.id
        ? { ...x, total_pagado: totalPagado, count_pagos: (x.count_pagos||0)+1, saldo_pendiente: saldo, pago_confirmado: cobrada }
        : x))
      setPagosModalC(p => ({ ...p, saldo_pendiente: saldo, pago_confirmado: cobrada }))
    } catch(e) { alert(e.response?.data?.error || 'Error al guardar') }
    finally { setPagoSavingC(false) }
  }

  const confirmarPagoC = async pago => {
    const r = await api.patch(`/finanzas/facturas-compra/${pagosModalC.id}/pagos/${pago.id}`, { estado: 'confirmado' })
    const nuevos = pagosC.map(p => p.id === pago.id ? r.data : p)
    setPagosC(nuevos)
    const totalPagado = nuevos.filter(p => p.estado === 'confirmado').reduce((s, p) => s + p.importe, 0)
    const saldo = Math.max(0, (pagosModalC.importe * (pagosModalC.tasa_cambio || 1)) - totalPagado)
    setFactC(prev => prev.map(x => x.id === pagosModalC.id
      ? { ...x, total_pagado: totalPagado, saldo_pendiente: saldo, pago_confirmado: saldo <= 0.01 ? 1 : 0 }
      : x))
    setPagosModalC(p => ({ ...p, saldo_pendiente: saldo, pago_confirmado: saldo <= 0.01 ? 1 : 0 }))
  }

  const eliminarPagoC = async pago => {
    if (!confirm('¿Eliminar este pago?')) return
    await api.delete(`/finanzas/facturas-compra/${pagosModalC.id}/pagos/${pago.id}`)
    const nuevos = pagosC.filter(p => p.id !== pago.id)
    setPagosC(nuevos)
    const totalPagado = nuevos.filter(p => p.estado === 'confirmado').reduce((s, p) => s + p.importe, 0)
    const saldo = Math.max(0, (pagosModalC.importe * (pagosModalC.tasa_cambio || 1)) - totalPagado)
    setFactC(prev => prev.map(x => x.id === pagosModalC.id
      ? { ...x, total_pagado: totalPagado, count_pagos: nuevos.length, saldo_pendiente: saldo, pago_confirmado: saldo <= 0.01 ? 1 : 0 }
      : x))
    setPagosModalC(p => ({ ...p, saldo_pendiente: saldo, pago_confirmado: saldo <= 0.01 ? 1 : 0 }))
  }

  // ── Ventas ─────────────────────────────────────────────────────────────────
  const abrirNuevaV = () => { setFormV(FORM_V); setOcSel(null); setModalV('new') }
  const abrirEditV  = f => {
    setFormV({
      ...FORM_V, ...f, importe: f.importe ?? '', tasa_cambio: f.tasa_cambio ?? 1,
      proyecto: f.proyecto_id ? `${f.proy_codigo} — ${f.proy_nombre}` : '',
    })
    setOcSel(null)
    setModalV(f)
  }

  const ocElegida = !!formV.oc

  // Muestra el equivalente en la otra moneda cuando se factura distinto a como está la OC (siempre en USD)
  const otraMoneda = valor => {
    const v = parseFloat(valor) || 0
    const tc = parseFloat(formV.tasa_cambio) || 0
    if (!ocSel || !tc || !v || formV.moneda === 'DÓLAR') return null
    return `USD ${(v / tc).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  // Autocompletar concepto, neto, IVA y total a partir del % de la OC elegido
  useEffect(() => {
    if (!ocSel) return
    const pct = parseFloat(formV.oc_pct) || 0
    const montoUSD = (parseFloat(ocSel.monto_oc) || 0) * pct / 100
    const facturadoPrevio = (parseFloat(ocSel.monto_anticipo_usd) || 0) + (parseFloat(ocSel.monto_final_usd) || 0)
    const tipoConcepto = facturadoPrevio > 0 ? 'SALDO FINAL' : 'ANTICIPO'
    // monto_oc es NETO (sin IVA) — el IVA se suma arriba, no se descuenta de un total
    const neto  = formV.moneda === 'DÓLAR' ? montoUSD : montoUSD * (parseFloat(formV.tasa_cambio) || 0)
    const iva   = neto * 0.21
    const total = neto + iva
    setFormV(p => ({
      ...p,
      concepto: pct > 0 ? `${pct}% ${tipoConcepto}` : p.concepto,
      importe: montoUSD > 0 ? Math.round(total * 100) / 100 : p.importe,
      neto_gravado: montoUSD > 0 ? Math.round(neto * 100) / 100 : p.neto_gravado,
      iva_21: montoUSD > 0 ? Math.round(iva * 100) / 100 : p.iva_21,
    }))
  }, [ocSel, formV.oc_pct, formV.moneda, formV.tasa_cambio])

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

  const reabrirV = async f => {
    if (!confirm('¿Marcar esta factura como pendiente de cobro? Podrás corregir los pagos desde el modal.')) return
    await api.patch(`/finanzas/facturas-venta/${f.id}/reabrir`)
    setFactV(prev => prev.map(x => x.id === f.id ? { ...x, pago_confirmado: 0, fecha_pago: '' } : x))
  }

  // ── Pagos de ventas ────────────────────────────────────────────────────────
  const abrirPagosV = async f => {
    setPagosModal(f); setMostrarForm(false)
    setPagoForm({ ...FORM_PAGO, moneda: f.moneda || 'PESO' })
    setPagosLoad(true)
    try { const r = await api.get(`/finanzas/facturas-venta/${f.id}/pagos`); setPagos(r.data) }
    finally { setPagosLoad(false) }
  }

  // Importe + retenciones que el cliente aplicó al pagar (cuentan como saldado)
  const totalPago = p => (p.importe||0) + (p.ret_iibb||0) + (p.ret_iva||0) + (p.ret_gcia||0) + (p.ret_contratista||0) + (p.ret_ss||0)

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
      const totalPagado = [...pagos, r.data].filter(p => p.estado === 'confirmado').reduce((s, p) => s + totalPago(p), 0)
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
    const totalPagado = nuevos.filter(p => p.estado === 'confirmado').reduce((s, p) => s + totalPago(p), 0)
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
    const totalPagado = nuevos.filter(p => p.estado === 'confirmado').reduce((s, p) => s + totalPago(p), 0)
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
        {!noDashboard && (
          <li className="nav-item">
            <button className={`nav-link py-1 px-3 ${tab === 'dashboard' ? 'active' : ''}`} onClick={() => setTab('dashboard')}>
              <i className="bi bi-speedometer2 me-1" />Dashboard
            </button>
          </li>
        )}
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
        <li className="nav-item">
          <button className={`nav-link py-1 px-3 ${tab === 'saldos' ? 'active' : ''}`} onClick={() => setTab('saldos')}>
            <i className="bi bi-bank me-1" />Saldos
          </button>
        </li>
        <li className="nav-item">
          <button className={`nav-link py-1 px-3 ${tab === 'servicios' ? 'active' : ''}`} onClick={() => setTab('servicios')}>
            <i className="bi bi-lightning-charge me-1" />Servicios
            {servicios.filter(s => s.cuota_estado === 'pendiente').length > 0 && (
              <span className="badge bg-warning text-dark ms-1" style={{ fontSize: '0.65rem' }}>
                {servicios.filter(s => s.cuota_estado === 'pendiente').length}
              </span>
            )}
          </button>
        </li>
        <li className="nav-item">
          <button className={`nav-link py-1 px-3 ${tab === 'control' ? 'active' : ''}`} onClick={() => setTab('control')}>
            <i className="bi bi-exclamation-triangle me-1" />Control OC
            {ctrlOC.length > 0 && (
              <span className="badge bg-danger ms-1" style={{ fontSize: '0.65rem' }}>{ctrlOC.length}</span>
            )}
          </button>
        </li>
        <li className="nav-item">
          <button className={`nav-link py-1 px-3 ${tab === 'oc-clientes' ? 'active' : ''}`} onClick={() => setTab('oc-clientes')}>
            <i className="bi bi-file-earmark-text me-1" />OC Clientes
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
                      <td style={{ whiteSpace: 'nowrap', minWidth: 130 }}>
                        {f.pago_confirmado ? (
                          <div className="d-flex align-items-center gap-1">
                            <span className="badge bg-success"><i className="bi bi-check2-circle me-1" />Pagada</span>
                            {canWrite && (
                              <button className="btn btn-sm btn-outline-warning py-0 px-1" style={{ fontSize: '0.65rem' }}
                                title="Reabrir para corregir pagos" onClick={() => reabrirC(f)}>
                                <i className="bi bi-arrow-counterclockwise" />
                              </button>
                            )}
                          </div>
                        ) : f.count_pagos > 0 ? (
                          <div style={{ fontSize: '0.72rem', lineHeight: 1.4 }}>
                            <div className="text-success fw-semibold">
                              <i className="bi bi-check2 me-1" />Pag: {fmtM(f.total_pagado, 'PESO')}
                            </div>
                            <div className="text-danger fw-semibold">
                              <i className="bi bi-hourglass-split me-1" />Rest: {fmtM(f.saldo_pendiente, 'PESO')}
                            </div>
                          </div>
                        ) : (
                          <span className="badge bg-secondary"><i className="bi bi-clock me-1" />Pendiente</span>
                        )}
                        {canWrite && (
                          <button className="btn btn-sm btn-outline-primary py-0 px-1 ms-1" style={{ fontSize: '0.72rem' }}
                            title="Ver/registrar pagos" onClick={() => abrirPagosC(f)}>
                            <i className="bi bi-cash-coin" />
                          </button>
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
                    <th>CUIT</th>
                    <th>Concepto</th>
                    <th>OC</th>
                    <th className="text-end">Neto Grav.</th>
                    <th className="text-end">IVA 21%</th>
                    <th className="text-end">Total Fact.</th>
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
                      <td className="text-muted font-monospace" style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{f.cliente_cuit || '—'}</td>
                      <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.concepto}>{f.concepto || '—'}</td>
                      <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>
                        {f.oc || '—'}
                        {f.proy_codigo && (
                          <span className="badge bg-secondary ms-1" style={{ fontSize: '0.62rem', fontFamily: 'monospace' }} title={f.proy_nombre}>
                            {f.proy_codigo}
                          </span>
                        )}
                      </td>
                      <td className="text-end">{f.neto_gravado ? fmtM(f.neto_gravado, f.moneda) : '—'}</td>
                      <td className="text-end">{f.iva_21 ? fmtM(f.iva_21, f.moneda) : '—'}</td>
                      <td className="text-end fw-semibold">{fmtM(f.importe, f.moneda)}</td>
                      <td className="text-end fw-semibold text-success">{f.total_pagado > 0 ? fmtM(f.total_pagado, f.moneda) : '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtF(f.fecha_pago)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {esNC(f.tipo_factura) ? (
                          <span className="badge bg-danger" style={{ fontSize: '0.68rem' }}>Anulada</span>
                        ) : (
                          <div className="d-flex gap-1 align-items-center">
                            {f.pago_confirmado ? (
                              <>
                                <span className="badge bg-success" style={{ fontSize: '0.68rem' }}>
                                  <i className="bi bi-check-circle-fill me-1" />Cobrada
                                </span>
                                {canWrite && (
                                  <button className="btn btn-sm btn-outline-warning py-0 px-1" style={{ fontSize: '0.65rem' }}
                                    title="Reabrir para corregir pagos" onClick={() => reabrirV(f)}>
                                    <i className="bi bi-arrow-counterclockwise" />
                                  </button>
                                )}
                              </>
                            ) : f.count_pagos > 0 ? (
                              <div style={{ fontSize: '0.72rem', lineHeight: 1.4 }}>
                                <div className="text-success fw-semibold">
                                  <i className="bi bi-check2 me-1" />Cob: {fmtM(f.total_pagado, 'PESO')}
                                </div>
                                <div className="text-danger fw-semibold">
                                  <i className="bi bi-hourglass-split me-1" />Rest: {fmtM(f.saldo_pendiente, 'PESO')}
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

      {/* ── MODAL PAGOS COMPRAS ── */}
      {pagosModalC && (
        <div className="modal d-block" style={{ background: 'rgba(0,0,0,.45)', zIndex: 1055 }}>
          <div className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header py-2">
                <div>
                  <h6 className="modal-title fw-bold mb-0">
                    <i className="bi bi-cash-coin me-2" />Pagos — {pagosModalC.numero}
                  </h6>
                  <small className="text-muted">{pagosModalC.proveedor_nombre} · Total: {fmtM(pagosModalC.importe * (pagosModalC.tasa_cambio||1), 'PESO')}</small>
                </div>
                <button className="btn-close btn-sm" onClick={() => setPagosModalC(null)} />
              </div>
              <div className="modal-body" style={{ fontSize: '0.85rem' }}>
                {/* Resumen saldo */}
                {!pagosModalC.pago_confirmado && (
                  <div className="alert alert-warning py-1 px-2 mb-3 small">
                    <i className="bi bi-hourglass-split me-1" />
                    Saldo pendiente: <strong>{fmtM(pagosModalC.saldo_pendiente ?? (pagosModalC.importe * (pagosModalC.tasa_cambio||1)), 'PESO')}</strong>
                  </div>
                )}
                {pagosLoadC ? (
                  <div className="text-center py-3"><span className="spinner-border spinner-border-sm" /></div>
                ) : pagosC.length === 0 ? (
                  <p className="text-muted text-center py-2">Sin pagos registrados</p>
                ) : (
                  <table className="table table-sm mb-3">
                    <thead className="table-light"><tr>
                      <th>Fecha</th><th>Tipo</th><th>Forma</th><th>Entidad</th>
                      <th className="text-end">Importe</th><th>Estado</th>{canWrite && <th />}
                    </tr></thead>
                    <tbody>
                      {pagosC.map(p => (
                        <tr key={p.id}>
                          <td>{fmtF(p.fecha)}</td>
                          <td>{p.tipo}</td>
                          <td>{p.forma_pago}</td>
                          <td>{p.entidad || '—'}</td>
                          <td className="text-end fw-semibold">{fmtM(p.importe, p.moneda)}</td>
                          <td>
                            {p.estado === 'confirmado'
                              ? <span className="badge bg-success">Confirmado</span>
                              : <button className="btn btn-xs btn-warning py-0 px-1" style={{ fontSize: '0.72rem' }} onClick={() => confirmarPagoC(p)}>Confirmar</button>}
                          </td>
                          {canWrite && (
                            <td>
                              <button className="btn btn-sm btn-outline-danger py-0 px-1" onClick={() => eliminarPagoC(p)}>
                                <i className="bi bi-trash" />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {canWrite && !mostrarFormC && (
                  <button className="btn btn-sm btn-outline-primary" onClick={() => setMostrarFormC(true)}>
                    <i className="bi bi-plus-lg me-1" />Registrar pago
                  </button>
                )}
                {canWrite && mostrarFormC && (
                  <div className="border rounded p-3" style={{ background: '#f8f9ff' }}>
                    <p className="small fw-semibold mb-2">Nuevo pago</p>
                    <div className="row g-2 mb-2">
                      <div className="col-md-3">
                        <label className="form-label small">Tipo</label>
                        <select className="form-select form-select-sm" value={pagoFormC.tipo}
                          onChange={e => setPagoFormC(p => ({ ...p, tipo: e.target.value }))}>
                          {TIPOS_PAGO.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </div>
                      <div className="col-md-3">
                        <label className="form-label small">Forma de pago</label>
                        <select className="form-select form-select-sm" value={pagoFormC.forma_pago}
                          onChange={e => setPagoFormC(p => ({ ...p, forma_pago: e.target.value }))}>
                          {FORMAS_PAGO.map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                      </div>
                      <div className="col-md-3">
                        <label className="form-label small">
                          {pagoFormC.forma_pago === 'e-cheq' ? 'Banco a debitar' : 'Entidad / Banco'}
                        </label>
                        {pagoFormC.forma_pago === 'e-cheq' ? (
                          <select className="form-select form-select-sm" value={pagoFormC.entidad}
                            onChange={e => setPagoFormC(p => ({ ...p, entidad: e.target.value }))}>
                            <option value="">— Seleccionar banco —</option>
                            {BANCOS.map(b => <option key={b} value={b}>{b}</option>)}
                          </select>
                        ) : (
                          <input className="form-control form-control-sm" value={pagoFormC.entidad}
                            onChange={e => setPagoFormC(p => ({ ...p, entidad: e.target.value }))} placeholder="Banco..." />
                        )}
                      </div>
                      <div className="col-md-3">
                        <label className="form-label small">Moneda</label>
                        <select className="form-select form-select-sm" value={pagoFormC.moneda}
                          onChange={e => setPagoFormC(p => ({ ...p, moneda: e.target.value }))}>
                          {MONEDAS.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="row g-2 mb-2">
                      <div className="col-md-3">
                        <label className="form-label small">Importe *</label>
                        <input type="number" className="form-control form-control-sm" value={pagoFormC.importe}
                          onChange={e => setPagoFormC(p => ({ ...p, importe: e.target.value }))}
                          min="0" step="0.01" placeholder="0.00" />
                      </div>
                      <div className="col-md-3">
                        <label className="form-label small">Fecha *</label>
                        <DateInput className="form-control form-control-sm" value={pagoFormC.fecha}
                          onChange={v => setPagoFormC(p => ({ ...p, fecha: v }))} />
                      </div>
                      {(pagoFormC.forma_pago === 'cheque_diferido' || pagoFormC.forma_pago === 'e-cheq') && (
                        <div className="col-md-3">
                          <label className="form-label small">Fecha acreditación / débito</label>
                          <DateInput className="form-control form-control-sm" value={pagoFormC.fecha_acreditacion}
                            onChange={v => setPagoFormC(p => ({ ...p, fecha_acreditacion: v }))} />
                        </div>
                      )}
                      <div className={(pagoFormC.forma_pago === 'cheque_diferido' || pagoFormC.forma_pago === 'e-cheq') ? 'col-md-3' : 'col-md-6'}>
                        <label className="form-label small">Observaciones</label>
                        <input className="form-control form-control-sm" value={pagoFormC.observaciones}
                          onChange={e => setPagoFormC(p => ({ ...p, observaciones: e.target.value }))} />
                      </div>
                    </div>
                    <div className="d-flex gap-2">
                      <button className="btn btn-sm btn-primary" onClick={agregarPagoC} disabled={pagoSavingC}>
                        {pagoSavingC ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="bi bi-check-lg me-1" />}
                        Guardar pago
                      </button>
                      <button className="btn btn-sm btn-outline-secondary" onClick={() => setMostrarFormC(false)}>Cancelar</button>
                    </div>
                  </div>
                )}
              </div>
              <div className="modal-footer py-2">
                <button className="btn btn-sm btn-secondary" onClick={() => setPagosModalC(null)}>Cerrar</button>
              </div>
            </div>
          </div>
        </div>
      )}

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

                {/* ── OC (habilita el resto del formulario) ── */}
                <div className="row g-2 mb-2">
                  <div className="col-md-3">
                    <label className="form-label small fw-semibold">OC / Referencia *</label>
                    <OcClienteSelector
                      value={formV.oc}
                      onChange={oc => {
                        setOcSel(oc.id ? oc : null)
                        setFormV(p => ({
                          ...p,
                          oc: oc.numero_oc,
                          oc_pct: '',
                          ...(oc.id ? { cliente_id: oc.cliente_id || '', cliente_nombre: oc.cli_nombre_cat || oc.cliente || '' } : {}),
                          ...(oc.proyecto_id ? { proyecto_id: oc.proyecto_id, proyecto: `${oc.proy_codigo} — ${oc.proy_nombre}` } : {}),
                        }))
                      }}
                    />
                  </div>
                  {ocSel && (
                    <div className="col-md-2">
                      <label className="form-label small fw-semibold">% de la OC a facturar</label>
                      <input type="number" className="form-control form-control-sm" value={formV.oc_pct}
                        onChange={e => setFormV(p => ({ ...p, oc_pct: e.target.value }))}
                        min="0" max="100" step="1" placeholder="Ej: 50" />
                    </div>
                  )}
                  {ocSel && (() => {
                    const monto      = parseFloat(ocSel.monto_oc) || 0
                    const facturado  = (parseFloat(ocSel.monto_anticipo_usd) || 0) + (parseFloat(ocSel.monto_final_usd) || 0)
                    return (
                      <div className="col-md-4">
                        <label className="form-label small fw-semibold">Total de la OC</label>
                        <div className="form-control form-control-sm bg-light text-muted" style={{ fontSize: '0.76rem' }}>
                          USD {monto.toLocaleString('es-AR',{minimumFractionDigits:2})}
                          {' · Facturado: '}USD {facturado.toLocaleString('es-AR',{minimumFractionDigits:2})}
                          {' · Resta: '}USD {(monto-facturado).toLocaleString('es-AR',{minimumFractionDigits:2})}
                        </div>
                      </div>
                    )
                  })()}
                </div>
                {!ocElegida && (
                  <div className="alert alert-warning py-2 small mb-2">
                    <i className="bi bi-lock-fill me-1" />
                    Elegí una OC (o marcá "PENDIENTE") para habilitar el resto de la factura.
                  </div>
                )}

                <fieldset disabled={!ocElegida} style={{ border: 0, padding: 0, margin: 0 }}>

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

                  <div className="row g-2 mb-3">
                    <div className={ocSel ? 'col-md-5' : 'col-md-7'}>
                      <label className="form-label small fw-semibold">
                        Cliente {ocSel && <span className="text-muted fw-normal">(desde la OC)</span>}
                      </label>
                      {ocSel ? (
                        <input className="form-control form-control-sm" value={formV.cliente_nombre} disabled />
                      ) : (
                        <>
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
                        </>
                      )}
                    </div>
                    <div className={ocSel ? 'col-md-7' : 'col-md-5'}>
                      <label className="form-label small fw-semibold">
                        Concepto {ocSel && <span className="text-muted fw-normal">(desde % de OC)</span>}
                      </label>
                      <input className="form-control form-control-sm" value={formV.concepto} disabled={!!ocSel}
                        onChange={e => setFormV(p => ({ ...p, concepto: e.target.value }))}
                        placeholder="Descripción del servicio / producto" />
                    </div>
                  </div>
                  <div className="row g-2 mb-3">
                    <div className="col-md-4">
                      <label className="form-label small fw-semibold">
                        Proyecto <span className="text-muted fw-normal">(para cruzar con OC Clientes)</span>
                      </label>
                      <ProyectoSelector
                        value={formV.proyecto}
                        onChange={p => setFormV(prev => ({ ...prev, proyecto_id: p.id, proyecto: `${p.codigo} — ${p.nombre}` }))}
                      />
                    </div>
                  </div>

                  <hr className="my-2" />
                  <p className="small fw-semibold text-muted mb-2" style={{ letterSpacing: '0.05em' }}>IMPORTES</p>

                  {/* Moneda primero: define cómo se calculan Neto/IVA/Total */}
                  <div className="row g-2 mb-2">
                    <div className="col-md-3">
                      <label className="form-label small fw-semibold">¿Se factura en pesos o en dólares?</label>
                      <select className="form-select form-select-sm" value={formV.moneda}
                        onChange={e => setFormV(p => ({ ...p, moneda: e.target.value }))}>
                        <option value="PESO">Pesos</option>
                        <option value="DÓLAR">Dólares</option>
                      </select>
                    </div>
                    {(formV.moneda !== 'PESO' || ocSel) && (
                      <div className="col-md-3">
                        <label className="form-label small fw-semibold">Tipo de cambio</label>
                        <input type="number" className="form-control form-control-sm" value={formV.tasa_cambio}
                          onChange={e => setFormV(p => ({ ...p, tasa_cambio: e.target.value }))}
                          min="0" step="0.01" placeholder="Tipo de cambio" />
                        {ocSel && formV.moneda === 'PESO' && (
                          <div className="form-text" style={{ fontSize: '0.68rem' }}>
                            La OC está en USD — hace falta para convertir a pesos.
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="row g-2 mb-2">
                    <div className="col-md-4">
                      <label className="form-label small fw-semibold">Neto Gravado</label>
                      <input type="number" className="form-control form-control-sm" value={formV.neto_gravado}
                        onChange={e => setFormV(p => ({ ...p, neto_gravado: e.target.value }))} min="0" step="0.01" placeholder="0.00" />
                      {otraMoneda(formV.neto_gravado) && (
                        <div className="form-text" style={{ fontSize: '0.68rem' }}>≈ {otraMoneda(formV.neto_gravado)}</div>
                      )}
                    </div>
                    <div className="col-md-4">
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
                      {otraMoneda(formV.iva_21) && (
                        <div className="form-text" style={{ fontSize: '0.68rem' }}>≈ {otraMoneda(formV.iva_21)}</div>
                      )}
                    </div>
                    <div className="col-md-4">
                      <label className="form-label small fw-semibold">Total Factura</label>
                      <input type="number" className="form-control form-control-sm" value={formV.importe}
                        onChange={e => setFormV(p => ({ ...p, importe: e.target.value }))} min="0" step="0.01" placeholder="0.00" />
                      {otraMoneda(formV.importe) && (
                        <div className="form-text" style={{ fontSize: '0.68rem' }}>≈ {otraMoneda(formV.importe)}</div>
                      )}
                    </div>
                  </div>

                  <div className="row g-2 mb-3">
                    <div className="col-md-4">
                      <label className="form-label small fw-semibold">Total Cobrado</label>
                      <input type="number" className="form-control form-control-sm" value={formV.total_cobrado}
                        onChange={e => setFormV(p => ({ ...p, total_cobrado: e.target.value }))} min="0" step="0.01" placeholder="0.00" />
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

                </fieldset>
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
                  const confirmados = pagos.filter(p => p.estado === 'confirmado')
                  const cobrado  = confirmados.reduce((s, p) => s + (p.importe||0), 0)
                  const retenido = confirmados.reduce((s, p) => s + totalPago(p) - (p.importe||0), 0)
                  const cheques  = pagos.filter(p => p.estado === 'pendiente').reduce((s, p) => s + p.importe, 0)
                  const total    = pagosModal.importe * (pagosModal.tasa_cambio || 1)
                  const saldo    = Math.max(0, total - cobrado - retenido)
                  return (
                    <div className="d-flex gap-4 mb-3 p-2 rounded flex-wrap" style={{ background: '#f8f9fa' }}>
                      <div><div className="small text-muted">Total factura</div><div className="fw-bold">{fmtM(total,'PESO')}</div></div>
                      <div><div className="small text-muted">Cobrado</div><div className="fw-bold text-success">{fmtM(cobrado,'PESO')}</div></div>
                      {retenido > 0 && (
                        <div><div className="small text-muted">Retenido por el cliente</div><div className="fw-bold text-info">{fmtM(retenido,'PESO')}</div></div>
                      )}
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
                        <th className="text-end">Importe</th><th className="text-end">Retenido</th><th>Fecha</th>
                        <th>F. Acred.</th><th>Estado</th>
                        {canWrite && <th style={{ width: 70 }} />}
                      </tr>
                    </thead>
                    <tbody>
                      {pagos.map(p => {
                        const ret = totalPago(p) - (p.importe||0)
                        return (
                        <tr key={p.id} style={p.estado === 'pendiente' ? { background: '#fffbea' } : {}}>
                          <td><span className="badge bg-secondary" style={{ fontSize: '0.65rem' }}>{p.tipo}</span></td>
                          <td>{p.forma_pago}</td>
                          <td className="text-muted">{p.entidad || '—'}</td>
                          <td className="text-end fw-semibold">{fmtM(p.importe, p.moneda)}</td>
                          <td className="text-end text-info" title={`IIBB ${p.ret_iibb||0} · IVA ${p.ret_iva||0} · Gcía ${p.ret_gcia||0} · Contratista ${p.ret_contratista||0} · SS ${p.ret_ss||0}`}>
                            {ret > 0 ? fmtM(ret, p.moneda) : '—'}
                          </td>
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
                      )})}
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
                        <label className="form-label small">
                          {pagoForm.forma_pago === 'e-cheq' ? 'Banco a acreditar' : 'Entidad / Banco'}
                        </label>
                        {pagoForm.forma_pago === 'e-cheq' ? (
                          <select className="form-select form-select-sm" value={pagoForm.entidad}
                            onChange={e => setPagoForm(p => ({ ...p, entidad: e.target.value }))}>
                            <option value="">— Seleccionar banco —</option>
                            {BANCOS.map(b => <option key={b} value={b}>{b}</option>)}
                          </select>
                        ) : (
                          <input className="form-control form-control-sm" value={pagoForm.entidad}
                            onChange={e => setPagoForm(p => ({ ...p, entidad: e.target.value }))}
                            placeholder="Banco Galicia..." />
                        )}
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
                      {(pagoForm.forma_pago === 'cheque_diferido' || pagoForm.forma_pago === 'e-cheq') && (
                        <div className="col-md-3">
                          <label className="form-label small">Fecha acreditación / débito</label>
                          <DateInput className="form-control form-control-sm" value={pagoForm.fecha_acreditacion}
                            onChange={v => setPagoForm(p => ({ ...p, fecha_acreditacion: v }))} />
                        </div>
                      )}
                      <div className={(pagoForm.forma_pago === 'cheque_diferido' || pagoForm.forma_pago === 'e-cheq') ? 'col-md-3' : 'col-md-6'}>
                        <label className="form-label small">Observaciones</label>
                        <input className="form-control form-control-sm" value={pagoForm.observaciones}
                          onChange={e => setPagoForm(p => ({ ...p, observaciones: e.target.value }))} />
                      </div>
                    </div>

                    <p className="small fw-semibold text-muted mb-1">
                      Retenciones que aplicó el cliente al pagar <span className="fw-normal">(opcional)</span>
                    </p>
                    <div className="row g-2 mb-2">
                      {[
                        { key: 'ret_iibb',        label: 'Ret. IIBB' },
                        { key: 'ret_iva',         label: 'Ret. IVA' },
                        { key: 'ret_gcia',        label: 'Ret. Gcía.' },
                        { key: 'ret_contratista', label: 'Ret. Contratista' },
                        { key: 'ret_ss',          label: 'Ret. SS' },
                      ].map(({ key, label }) => (
                        <div key={key} className="col-md-2">
                          <label className="form-label small">{label}</label>
                          <input type="number" className="form-control form-control-sm" value={pagoForm[key]}
                            onChange={e => setPagoForm(p => ({ ...p, [key]: e.target.value }))} min="0" step="0.01" placeholder="0.00" />
                        </div>
                      ))}
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

      {/* ── TAB SALDOS ── */}
      {tab === 'saldos' && (
        <div className="flex-grow-1 d-flex flex-column overflow-hidden">
          {/* Formulario de carga */}
          {canWrite && (
            <div className="card mb-3" style={{ maxWidth: 520 }}>
              <div className="card-body py-3">
                <h6 className="fw-bold mb-3"><i className="bi bi-bank me-2 text-primary" />Registrar saldo bancario</h6>
                <div className="row g-2 align-items-end">
                  <div className="col-sm-5">
                    <label className="form-label small fw-semibold mb-1">Entidad</label>
                    <select className="form-select form-select-sm" value={formSaldo.entidad}
                      onChange={e => setFormSaldo(p => ({ ...p, entidad: e.target.value }))}>
                      {BANCOS.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                  <div className="col-sm-4">
                    <label className="form-label small fw-semibold mb-1">Monto</label>
                    <input type="number" className="form-control form-control-sm" value={formSaldo.monto}
                      onChange={e => setFormSaldo(p => ({ ...p, monto: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && guardarSaldo()}
                      min="0" step="0.01" placeholder="0.00" autoFocus />
                  </div>
                  <div className="col-sm-3">
                    <label className="form-label small fw-semibold mb-1">Moneda</label>
                    <select className="form-select form-select-sm" value={formSaldo.moneda}
                      onChange={e => setFormSaldo(p => ({ ...p, moneda: e.target.value }))}>
                      {MONEDAS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                </div>
                <div className="mt-2 d-flex align-items-center gap-2">
                  <button className="btn btn-sm btn-primary" onClick={guardarSaldo} disabled={savSaldo}>
                    {savSaldo ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="bi bi-save me-1" />}
                    Registrar
                  </button>
                  <small className="text-muted"><i className="bi bi-clock me-1" />La fecha y hora se guardan automáticamente</small>
                </div>
              </div>
            </div>
          )}

          {/* Tipo de cambio BNA */}
          {canWrite && (
            <div className="card mb-3" style={{ maxWidth: 520 }}>
              <div className="card-body py-3">
                <h6 className="fw-bold mb-3"><i className="bi bi-currency-exchange me-2 text-success" />Tipo de Cambio BNA (Dólar)</h6>
                <div className="row g-2 align-items-end">
                  <div className="col-sm-4">
                    <label className="form-label small fw-semibold mb-1">Valor $ por USD</label>
                    <input type="number" className="form-control form-control-sm" value={formTC.valor}
                      onChange={e => setFormTC(p => ({ ...p, valor: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && guardarTC()}
                      min="0" step="0.01" placeholder="Ej: 1250.00" />
                  </div>
                  <div className="col-sm-4">
                    <label className="form-label small fw-semibold mb-1">Fecha</label>
                    <DateInput className="form-control form-control-sm" value={formTC.fecha}
                      onChange={v => setFormTC(p => ({ ...p, fecha: v }))} />
                  </div>
                  <div className="col-sm-4">
                    <button className="btn btn-sm btn-success w-100" onClick={guardarTC} disabled={savTC}>
                      {savTC ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="bi bi-save me-1" />}
                      Registrar
                    </button>
                  </div>
                </div>
                {tcBNA.length > 0 && (
                  <div className="mt-3" style={{ fontSize: '0.82rem' }}>
                    <div className="fw-semibold text-muted mb-2" style={{ fontSize: '0.72rem', letterSpacing: '0.04em' }}>HISTORIAL</div>
                    {tcBNA.slice(0, 5).map(t => (
                      <div key={t.id} className="d-flex justify-content-between align-items-center py-1 border-bottom">
                        <span className="text-muted">{t.fecha || t.created_at?.slice(0,10)}</span>
                        <span className="fw-semibold">$ {parseFloat(t.valor).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</span>
                        <span className="text-muted small">{t.usuario_nombre || '—'}</span>
                        <button className="btn btn-sm btn-outline-danger py-0 px-1" onClick={() => eliminarTC(t)}>
                          <i className="bi bi-trash" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Historial */}
          {loadSaldos ? (
            <div className="text-center py-4 text-muted"><span className="spinner-border spinner-border-sm me-2" />Cargando...</div>
          ) : saldos.length === 0 ? (
            <div className="text-center py-5 text-muted">
              <i className="bi bi-bank display-6 d-block mb-2" />Sin registros de saldo
            </div>
          ) : (
            <div className="overflow-auto flex-grow-1">
              <table className="table table-sm table-hover align-middle" style={{ fontSize: '0.85rem', maxWidth: 700 }}>
                <thead className="table-light sticky-top">
                  <tr>
                    <th>Fecha y hora</th>
                    <th>Entidad</th>
                    <th className="text-end">Monto</th>
                    <th>Cargado por</th>
                    {canWrite && <th />}
                  </tr>
                </thead>
                <tbody>
                  {saldos.map(s => (
                    <tr key={s.id}>
                      <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>
                        {s.created_at ? s.created_at.replace('T', ' ').slice(0, 16) : '—'}
                      </td>
                      <td className="fw-semibold">
                        <i className="bi bi-bank me-1 text-primary" />{s.entidad}
                      </td>
                      <td className="text-end fw-semibold fs-6">{fmtM(s.monto, s.moneda)}</td>
                      <td className="text-muted small">{s.usuario_nombre || '—'}</td>
                      {canWrite && (
                        <td>
                          <button className="btn btn-sm btn-outline-danger py-0 px-1" onClick={() => eliminarSaldo(s)}>
                            <i className="bi bi-trash" />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── TAB SERVICIOS ── */}
      {tab === 'servicios' && (
        <div className="flex-grow-1 d-flex flex-column overflow-hidden">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <span className="text-muted small">Servicios recurrentes — vencimientos y pagos</span>
            <div className="d-flex gap-2 align-items-center flex-wrap">
              <input className="form-control form-control-sm" style={{ width: 180 }}
                placeholder="Buscar descripción, usuario..."
                value={filtServ.buscar}
                onChange={e => setFiltServ(p => ({ ...p, buscar: e.target.value }))} />
              <select className="form-select form-select-sm" style={{ width: 150 }}
                value={filtServ.estado}
                onChange={e => setFiltServ(p => ({ ...p, estado: e.target.value }))}>
                <option value="todos">Todos los estados</option>
                <option value="pendiente">Pendientes</option>
                <option value="sin_importe">Sin importe</option>
                <option value="vencido">Vencidos</option>
                <option value="pagado">Pagados</option>
              </select>
              <select className="form-select form-select-sm" style={{ width: 140 }}
                value={filtServ.periodicidad}
                onChange={e => setFiltServ(p => ({ ...p, periodicidad: e.target.value }))}>
                <option value="">Periodicidad</option>
                {PERIODICIDADES.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
              </select>
              {(filtServ.estado !== 'todos' || filtServ.periodicidad || filtServ.buscar) && (
                <button className="btn btn-sm btn-outline-secondary py-0 px-2"
                  onClick={() => setFiltServ({ estado: 'todos', periodicidad: '', buscar: '' })}>
                  <i className="bi bi-x" />
                </button>
              )}
              {canWrite && (
                <button className="btn btn-sm btn-primary" onClick={() => { setFormServ(FORM_SERV); setModalServ('new') }}>
                  <i className="bi bi-plus-lg me-1" />Nuevo servicio
                </button>
              )}
            </div>
          </div>

          {loadServ ? (
            <div className="text-center py-4 text-muted"><span className="spinner-border spinner-border-sm me-2" />Cargando...</div>
          ) : servicios.length === 0 ? (
            <div className="text-center py-5 text-muted">
              <i className="bi bi-lightning-charge display-6 d-block mb-2" />
              No hay servicios registrados
            </div>
          ) : (
            <div className="overflow-auto flex-grow-1">
              <table className="table table-sm table-hover align-middle" style={{ fontSize: '0.85rem' }}>
                <thead className="table-light sticky-top">
                  <tr>
                    <th>Descripción</th>
                    <th>Periodicidad</th>
                    <th>Usuario / Datos de pago</th>
                    <th className="text-end">Monto</th>
                    <th>Vencimiento</th>
                    <th>Estado</th>
                    {canWrite && <th />}
                  </tr>
                </thead>
                <tbody>
                  {servicios.filter(s => {
                    const hoy = new Date().toISOString().slice(0, 10)
                    const sinMonto = s.cuota_estado === 'pendiente' && (s.cuota_monto == null || s.cuota_monto === '')
                    const pendiente = s.cuota_estado === 'pendiente' && !sinMonto
                    const vencido   = pendiente && s.cuota_vencimiento && s.cuota_vencimiento < hoy
                    if (filtServ.estado === 'pendiente'   && !pendiente)               return false
                    if (filtServ.estado === 'sin_importe' && !sinMonto)               return false
                    if (filtServ.estado === 'vencido'     && !vencido)                return false
                    if (filtServ.estado === 'pagado'      && s.cuota_estado === 'pendiente') return false
                    if (filtServ.periodicidad && s.periodicidad !== filtServ.periodicidad) return false
                    if (filtServ.buscar) {
                      const q = filtServ.buscar.toLowerCase()
                      if (!s.descripcion?.toLowerCase().includes(q) && !s.usuario?.toLowerCase().includes(q)) return false
                    }
                    return true
                  }).map(s => {
                    const pendiente = s.cuota_estado === 'pendiente'
                    const sinMonto  = pendiente && (s.cuota_monto == null || s.cuota_monto === '')
                    const editando  = montoEdit[s.cuota_id] !== undefined

                    return (
                      <tr key={s.id} style={sinMonto ? { opacity: 0.65, fontSize: '0.78rem' } : {}}>
                        <td className="fw-semibold">{s.descripcion}</td>
                        <td><span className="badge bg-light text-dark border">{s.periodicidad}</span></td>
                        <td>
                          <div>{s.usuario || '—'}</div>
                          {s.info_pago && <div className="text-muted" style={{ fontSize: '0.75rem' }}>{s.info_pago}</div>}
                        </td>
                        <td className="text-end" style={{ minWidth: 130 }}>
                          {sinMonto ? (
                            <div className="d-flex align-items-center gap-1 justify-content-end">
                              <input
                                type="number" min="0" step="0.01" placeholder="$ importe"
                                className="form-control form-control-sm text-end"
                                style={{ width: 110, fontSize: '0.78rem' }}
                                value={editando ? montoEdit[s.cuota_id] : ''}
                                onChange={e => setMontoEdit(p => ({ ...p, [s.cuota_id]: e.target.value }))}
                                onKeyDown={e => e.key === 'Enter' && guardarMonto(s.cuota_id, montoEdit[s.cuota_id])}
                              />
                              {editando && (
                                <button className="btn btn-sm btn-success py-0 px-1"
                                  onClick={() => guardarMonto(s.cuota_id, montoEdit[s.cuota_id])}>
                                  <i className="bi bi-check-lg" />
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="fw-semibold">{fmtM(s.cuota_monto, 'PESO')}</span>
                          )}
                        </td>
                        <td className={vctoColor(s.cuota_vencimiento, !pendiente)}>
                          {fmtF(s.cuota_vencimiento)}
                        </td>
                        <td>
                          {!pendiente ? (
                            <span className="badge bg-success">
                              <i className="bi bi-check2 me-1" />Pagado {fmtF(s.cuota_fecha_pagada)}
                            </span>
                          ) : sinMonto ? (
                            <span className="badge bg-light text-muted border" style={{ fontSize: '0.72rem' }}>
                              <i className="bi bi-hourglass me-1" />Sin importe
                            </span>
                          ) : (
                            <span className="badge bg-warning text-dark">
                              <i className="bi bi-clock me-1" />Pendiente
                            </span>
                          )}
                        </td>
                        {canWrite && (
                          <td>
                            <div className="d-flex gap-1 align-items-center">
                              {pendiente && !sinMonto && (
                                <button className="btn btn-sm btn-outline-success py-0 px-2"
                                  style={{ fontSize: '0.72rem' }}
                                  disabled={pagandoId === s.cuota_id}
                                  onClick={() => pagarCuota(s)}>
                                  {pagandoId === s.cuota_id
                                    ? <span className="spinner-border spinner-border-sm" />
                                    : <><i className="bi bi-check2-circle me-1" />Pagar</>}
                                </button>
                              )}
                              <button className="btn btn-sm btn-outline-primary py-0 px-1" title="Editar"
                                onClick={() => { setFormServ({ descripcion: s.descripcion, usuario: s.usuario||'', info_pago: s.info_pago||'', periodicidad: s.periodicidad, vencimiento_inicial: '' }); setModalServ(s) }}>
                                <i className="bi bi-pencil" />
                              </button>
                              <button className="btn btn-sm btn-outline-danger py-0 px-1" title="Desactivar"
                                onClick={() => eliminarServ(s)}>
                                <i className="bi bi-trash" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── MODAL SERVICIO ── */}
      {modalServ && (
        <div className="modal d-block" style={{ background: 'rgba(0,0,0,.45)', zIndex: 1060 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h6 className="modal-title fw-bold">
                  <i className="bi bi-lightning-charge me-2" />
                  {modalServ === 'new' ? 'Nuevo servicio' : 'Editar servicio'}
                </h6>
                <button className="btn-close btn-sm" onClick={() => setModalServ(null)} />
              </div>
              <div className="modal-body" style={{ fontSize: '0.87rem' }}>
                <div className="mb-2">
                  <label className="form-label small fw-semibold">Descripción *</label>
                  <input className="form-control form-control-sm" value={formServ.descripcion}
                    onChange={e => setFormServ(p => ({ ...p, descripcion: e.target.value }))}
                    placeholder="Ej: EDENOR Burzaco 6363" autoFocus />
                </div>
                <div className="row g-2 mb-2">
                  <div className="col-md-6">
                    <label className="form-label small fw-semibold">Periodicidad</label>
                    <select className="form-select form-select-sm" value={formServ.periodicidad}
                      onChange={e => setFormServ(p => ({ ...p, periodicidad: e.target.value }))}>
                      {PERIODICIDADES.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small fw-semibold">Usuario / Email</label>
                    <input className="form-control form-control-sm" value={formServ.usuario}
                      onChange={e => setFormServ(p => ({ ...p, usuario: e.target.value }))}
                      placeholder="silvio@e-intrasrl.com" />
                  </div>
                </div>
                <div className="mb-2">
                  <label className="form-label small fw-semibold">Datos de pago <span className="fw-normal text-muted">(código, CBU, instrucciones)</span></label>
                  <input className="form-control form-control-sm" value={formServ.info_pago}
                    onChange={e => setFormServ(p => ({ ...p, info_pago: e.target.value }))}
                    placeholder="Ej: código de pago 6554969-608" />
                </div>
                {modalServ === 'new' && (
                  <div className="mb-0">
                    <label className="form-label small fw-semibold">Próximo vencimiento</label>
                    <DateInput className="form-control form-control-sm" value={formServ.vencimiento_inicial}
                      onChange={v => setFormServ(p => ({ ...p, vencimiento_inicial: v }))} />
                  </div>
                )}
              </div>
              <div className="modal-footer py-2">
                <button className="btn btn-sm btn-secondary" onClick={() => setModalServ(null)}>Cancelar</button>
                <button className="btn btn-sm btn-primary" onClick={guardarServ} disabled={savServ}>
                  {savServ ? <><span className="spinner-border spinner-border-sm me-1" />Guardando...</> : 'Guardar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB CONTROL OC ── */}
      {tab === 'control' && (
        <div className="flex-grow-1 d-flex flex-column overflow-hidden">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <div>
              <span className="fw-semibold">Facturas con diferencia de neto respecto a la OC</span>
              <span className="text-muted small ms-2">(diferencia &gt; $1, valor sin impuestos)</span>
            </div>
            <button className="btn btn-sm btn-outline-secondary" onClick={cargarCtrlOC} disabled={loadCtrlOC}>
              <i className="bi bi-arrow-clockwise me-1" />Actualizar
            </button>
          </div>
          <div className="flex-grow-1 overflow-auto">
            {loadCtrlOC ? (
              <div className="text-center text-muted py-5">
                <span className="spinner-border spinner-border-sm me-2" />Cargando...
              </div>
            ) : ctrlOC.length === 0 ? (
              <div className="text-center text-muted py-5">
                <i className="bi bi-check-circle display-6 d-block mb-2 text-success" />
                <div>Todas las facturas con OC coinciden en su neto</div>
              </div>
            ) : (
              <table className="table table-sm table-hover table-bordered" style={{ fontSize: '0.82rem' }}>
                <thead className="table-light sticky-top">
                  <tr>
                    <th>OC</th>
                    <th>Proveedor</th>
                    <th>Facturas</th>
                    <th className="text-end">Neto OC (en $)</th>
                    <th className="text-end">Total neto facturas ($)</th>
                    <th className="text-end">Diferencia ($)</th>
                    <th className="text-center">Moneda OC</th>
                  </tr>
                </thead>
                <tbody>
                  {ctrlOC.map(r => {
                    const diff = (r.facturas_neto_total || 0) - (r.oc_neto_pesos || 0)
                    const esPeso = r.oc_moneda === 'PESOS' || r.oc_moneda === 'PESO'
                    return (
                      <tr key={r.oc_id} className={Math.abs(diff) > 1000 ? 'table-danger' : 'table-warning'}>
                        <td className="fw-semibold text-primary">{r.oc_numero}</td>
                        <td>{r.proveedor_nombre}</td>
                        <td>
                          <div>{r.facturas_lista}</div>
                          {r.cant_facturas > 1 && (
                            <div className="text-muted" style={{ fontSize: '0.72rem' }}>{r.cant_facturas} facturas · última {fmtF(r.fecha_ultima)}</div>
                          )}
                          {r.cant_facturas === 1 && (
                            <div className="text-muted" style={{ fontSize: '0.72rem' }}>{fmtF(r.fecha_ultima)}</div>
                          )}
                        </td>
                        <td className="text-end">
                          {fmtM(r.oc_neto_pesos, 'PESO')}
                          {!esPeso && (
                            <div className="text-muted" style={{ fontSize: '0.72rem' }}>
                              {r.oc_moneda === 'DÓLAR' ? 'USD' : r.oc_moneda} {fmtM(r.oc_neto_orig, r.oc_moneda)} × {(r.oc_tc||1).toLocaleString('es-AR')}
                            </div>
                          )}
                        </td>
                        <td className="text-end">{fmtM(r.facturas_neto_total, 'PESO')}</td>
                        <td className={`text-end fw-bold ${diff > 0 ? 'text-danger' : 'text-success'}`}>
                          {diff > 0 ? '+' : ''}{fmtM(diff, 'PESO')}
                        </td>
                        <td className="text-center">
                          <span className={`badge ${esPeso ? 'bg-secondary' : 'bg-info text-dark'}`}>{r.oc_moneda}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="table-light fw-semibold">
                  <tr>
                    <td colSpan={3}>{ctrlOC.length} OC{ctrlOC.length !== 1 ? 's' : ''} con diferencia</td>
                    <td className="text-end">{fmtM(ctrlOC.reduce((s, r) => s + (r.oc_neto_pesos || 0), 0), 'PESO')}</td>
                    <td className="text-end">{fmtM(ctrlOC.reduce((s, r) => s + (r.facturas_neto_total || 0), 0), 'PESO')}</td>
                    <td className="text-end">{fmtM(ctrlOC.reduce((s, r) => s + ((r.facturas_neto_total||0) - (r.oc_neto_pesos||0)), 0), 'PESO')}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── TAB OC CLIENTES ── */}
      {tab === 'oc-clientes' && (
        <FinanzasOCClientes canWrite={canWrite} />
      )}

    </div>
  )
}
