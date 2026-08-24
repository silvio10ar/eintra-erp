import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api/client'
import { puedeEscribir, getToken } from '../../store/authStore'
import DateInput from '../../components/DateInput'
import SelectorColumnas from '../../components/SelectorColumnas'
import { useColumnasOcultas } from '../../hooks/useColumnasOcultas'
import FinanzasDashboard from './FinanzasDashboard'
import FinanzasOCClientes from './FinanzasOCClientes'
import { estadoFila, ESTADO_LABEL, pctFacturado, pctCobrado, diasAtrasoOC } from './estadoOCClientes'
import { hoyLocal } from '../../utils/fecha'
import { formatCuit } from '../../utils/cuit'
import { manejarPegadoNumero } from '../../utils/numero'

// Columnas ocultables de las tablas más anchas — en pantallas chicas obligaban
// a scrollear mucho para llegar a las últimas. El usuario elige cuáles ver;
// queda guardado por navegador (useColumnasOcultas).
const COLS_FACT_COMPRA = [
  { key: 'fecha', label: 'Fecha' }, { key: 'tipo', label: 'Tipo' },
  { key: 'numero', label: 'N° Factura' }, { key: 'proveedor', label: 'Proveedor' },
  { key: 'cuit', label: 'CUIT' }, { key: 'neto', label: 'Neto Grav.' },
  { key: 'no_grav', label: 'No Grav/Exento' }, { key: 'iva21', label: 'IVA 21%' },
  { key: 'iva105', label: 'IVA 10.5%' }, { key: 'iva27', label: 'IVA 27%' },
  { key: 'otros_imp', label: 'Otros Imp.' }, { key: 'perc_iva', label: 'Perc. IVA' },
  { key: 'perc_iibb', label: 'Perc. IIBB' }, { key: 'total', label: 'Total' },
  { key: 'observaciones', label: 'Observaciones' }, { key: 'pago', label: 'Pago' },
]

const COLS_FACT_VENTA = [
  { key: 'fecha', label: 'Fecha' }, { key: 'tipo', label: 'Tipo' },
  { key: 'numero', label: 'N° Factura' }, { key: 'cliente', label: 'Cliente' },
  { key: 'cuit', label: 'CUIT' }, { key: 'concepto', label: 'Concepto' },
  { key: 'oc', label: 'OC' }, { key: 'neto', label: 'Neto Grav.' },
  { key: 'iva', label: 'IVA' }, { key: 'total', label: 'Total Fact.' },
  { key: 'total_cobrado', label: 'Total Cobrado' }, { key: 'f_pago', label: 'F. Pago' },
  { key: 'cobro', label: 'Cobro' },
]

const COLS_SEG_COMPRAS = [
  { key: 'oc', label: 'OC' }, { key: 'proveedor', label: 'Proveedor' },
  { key: 'fecha', label: 'Fecha' }, { key: 'entrega', label: 'Entrega est.' },
  { key: 'recepcion', label: 'Recepción' }, { key: 'neto', label: 'Neto OC' },
  { key: 'facturacion', label: 'Facturación' }, { key: 'pct_facturado', label: '% Facturado' },
  { key: 'pago', label: 'Pago' }, { key: 'pct_pagado', label: '% Pagado' },
  { key: 'ultima_factura', label: 'Última factura' },
]

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

// Si la moneda de la factura ya es PESO, `importe` YA está en pesos (ej. una
// factura vinculada a una OC en dólares guarda el neto convertido, pero
// conserva la tasa_cambio de la OC como referencia) — multiplicar de nuevo
// por esa tasa duplica la conversión. Solo corresponde convertir cuando la
// factura está realmente en moneda extranjera.
const totalEnPesos = f => {
  const esPeso = f.moneda === 'PESO' || f.moneda === 'PESOS' || !f.moneda
  return esPeso ? (parseFloat(f.importe) || 0) : (parseFloat(f.importe) || 0) * (parseFloat(f.tasa_cambio) || 1)
}

// Mismo criterio que totalEnPesos, pero para una OC de compras (el monto
// viene en `total_usd`, que pese al nombre está en la moneda propia de la OC).
// `tc_resuelto` (calculado en el backend) ya resuelve el TC con el mismo
// fallback que usa Control OC (manual → tipo_cambio del sistema a la fecha
// de la OC → tasa_cambio propia) — muchas OC viejas quedaron con
// tasa_cambio=0 y sin ese fallback no había forma de convertirlas.
const ocTcValido    = oc => oc.moneda === 'PESO' || oc.moneda === 'PESOS' || !oc.moneda || (parseFloat(oc.tc_resuelto) || 0) > 0
const ocTotalPesos  = oc => {
  const esPeso = oc.moneda === 'PESO' || oc.moneda === 'PESOS' || !oc.moneda
  const total = parseFloat(oc.total_usd) || 0
  return esPeso ? total : total * (parseFloat(oc.tc_resuelto) || 0)
}

const MONEDAS = ['PESO', 'DÓLAR', 'EURO']
// Renderizar miles de filas de una sola vez en el DOM es lo que hacía lenta
// la pantalla (medido: ~4s solo de render con listas históricas grandes) —
// se sigue trayendo todo el listado filtrado del servidor (los conteos/badges
// no cambian), pero en pantalla se pagina de a PAGE_SIZE filas por vez.
const PAGE_SIZE = 50

const esNC = tipo => typeof tipo === 'string' && tipo.startsWith('NC')

const FORM_PAGO = { tipo: 'parcial', forma_pago: 'transferencia', entidad: '', importe: '', moneda: 'PESO', tasa_cambio: 1, fecha: hoyLocal(), fecha_acreditacion: '', observaciones: '', ret_iibb: '', ret_iva: '', ret_gcia: '', ret_contratista: '', ret_ss: '' }

const FORMAS_PAGO = ['transferencia','cheque','cheque_diferido','e-cheq','efectivo','deposito']
const TIPOS_PAGO  = ['anticipo','parcial','final']

const FORM_C = { tipo_factura: 'A', numero: '', fecha: '', proveedor_id: '', proveedor_nombre: '', cuit: '', oc_id: '', oc_numero: '', neto_gravado: '', no_grav_exento: '', iva_21: '', iva_10_5: '', iva_27: '', otros_imp: '', perc_iva: '', perc_iibb: '', importe: '', moneda: 'PESO', tasa_cambio: 1, fecha_vencimiento: '', observaciones: '', nc_factura_id: '' }
const FORM_V = { tipo_factura: 'A', numero: '', fecha: '', cliente_id: '', cliente_nombre: '', presupuesto_id: '', presupuesto_ref: '', concepto: '', oc: '', oc_pct: '', proyecto_id: '', proyecto: '', neto_gravado: '', iva_21: '', iva_10_5: '', ret_iibb: '', ret_iva: '', ret_gcia: '', ret_contratista: '', ret_ss: '', dif_cambio: '', total_cobrado: '', importe: '', moneda: 'PESO', tasa_cambio: 1, fecha_vencimiento: '', fecha_pago: '', observaciones: '', nc_factura_id: '' }

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

  // No toda factura corresponde a un proyecto (abonos mensuales, ventas
  // generales) — hace falta poder sacarlo, no solo cambiarlo por otro.
  const quitar = () => {
    setQuery('')
    setAbierto(false)
    onChange(null)
  }

  // Si se tipeó algo sin elegir una opción de la lista, se descarta al salir
  // del campo (evita que un texto de búsqueda a medio escribir borre el
  // proyecto ya guardado) — para vaciarlo de verdad está el botón "Quitar".
  const cancelarTexto = () => setTimeout(() => { setAbierto(false); setQuery(value || '') }, 180)

  return (
    <div className="position-relative d-flex gap-1">
      <input className="form-control form-control-sm" value={query}
        placeholder="Buscar por código o nombre de proyecto..."
        onChange={e => buscar(e.target.value)}
        onBlur={cancelarTexto}
        autoComplete="off" />
      {value && (
        <button type="button" className="btn btn-sm btn-outline-secondary flex-shrink-0" title="Quitar proyecto"
          onMouseDown={e => e.preventDefault()} onClick={quitar}>
          <i className="bi bi-x" />
        </button>
      )}
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

const OC_PENDIENTE_COMPRA = { id: '', numero: 'PENDIENTE' }

// Mismo patrón que OcClienteSelector (buscar + opción PENDIENTE), pero contra
// la lista de Órdenes de Compra a proveedores ya cargada en `ocs` (filtro en
// el cliente, no hace falta pedirle al server en cada tecla como con OC Clientes).
function OcCompraSelector({ value, ocs, onChange, disabled }) {
  const [query,   setQuery]   = useState(value || '')
  const [abierto, setAbierto] = useState(false)

  useEffect(() => { setQuery(value || '') }, [value])

  const q = query.trim().toLowerCase()
  const opciones = (q
    ? ocs.filter(o => o.numero.toLowerCase().includes(q) || (o.proveedor_nombre || '').toLowerCase().includes(q))
    : ocs
  ).slice(0, 12)

  const seleccionar = oc => { setQuery(oc.numero); setAbierto(false); onChange(oc) }
  const cancelarTexto = () => setTimeout(() => { setAbierto(false); setQuery(value || '') }, 180)

  return (
    <div className="position-relative">
      <input className="form-control form-control-sm" value={query} disabled={disabled}
        placeholder={disabled ? 'Elegí un proveedor primero...' : 'Buscar OC por número o proveedor...'}
        onChange={e => { setQuery(e.target.value); setAbierto(true) }}
        onFocus={() => !disabled && setAbierto(true)}
        onBlur={cancelarTexto}
        autoComplete="off" />
      {abierto && !disabled && (
        <div className="border rounded bg-white shadow-sm position-absolute w-100" style={{ zIndex: 1080, top: '100%', maxHeight: 260, overflowY: 'auto' }}>
          <div className="px-2 py-1 border-bottom" style={{ cursor: 'pointer', fontSize: '0.83rem', background: '#fff8e6' }}
            onMouseDown={() => seleccionar(OC_PENDIENTE_COMPRA)}>
            <i className="bi bi-exclamation-circle me-1 text-warning" />
            <span className="fw-semibold">PENDIENTE</span>
            <span className="text-muted ms-2" style={{ fontSize: '0.72rem' }}>— completar después</span>
          </div>
          {opciones.length === 0 ? (
            <div className="text-muted text-center py-2" style={{ fontSize: '0.75rem' }}>Sin OC que coincidan</div>
          ) : opciones.map(o => {
            const esPesoOC = o.moneda === 'PESO' || o.moneda === 'PESOS' || !o.moneda
            return (
              <div key={o.id} className="px-2 py-1 border-bottom" style={{ cursor: 'pointer', fontSize: '0.83rem' }}
                onMouseDown={() => seleccionar(o)}>
                <div>
                  <span className="fw-semibold text-primary">{o.numero}</span>
                  <span className="text-muted ms-2" style={{ fontSize: '0.75rem' }}>{o.proveedor_nombre}</span>
                  <span className="text-muted ms-2" style={{ fontSize: '0.72rem' }}>{fmtF(o.fecha)}</span>
                </div>
                <div style={{ fontSize: '0.72rem' }}>
                  {esPesoOC ? (
                    <span className="text-muted">{fmtM(o.total_usd, 'PESO')}</span>
                  ) : ocTcValido(o) ? (
                    <span className="text-muted">{fmtM(o.total_usd, o.moneda)} · {fmtM(ocTotalPesos(o), 'PESO')}</span>
                  ) : (
                    <span className="text-danger" title="Sin tasa de cambio cargada en la OC">
                      <i className="bi bi-exclamation-triangle-fill me-1" />{fmtM(o.total_usd, o.moneda)} (sin TC)
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Buscador de la factura que una Nota de Crédito anula (total o parcial) —
// misma tabla (compra o venta), excluye otras NC y a la factura en edición.
function FacturaAnulaSelector({ tabla, value, valueLabel, excludeId, onChange }) {
  const [query,    setQuery]    = useState('')
  const [opciones, setOpc]      = useState([])
  const [abierto,  setAbierto]  = useState(false)
  const [buscando, setBuscando] = useState(false)
  const debRef = useRef(null)

  const buscar = q => {
    setQuery(q)
    if (debRef.current) clearTimeout(debRef.current)
    debRef.current = setTimeout(async () => {
      setBuscando(true)
      try {
        const r = await api.get(`/finanzas/facturas-${tabla}`, { params: q ? { buscar: q } : {} })
        const rows = r.data
          .filter(f => !esNC(f.tipo_factura) && f.id !== excludeId)
          .slice(0, 10)
        setOpc(rows)
      } catch { setOpc([]) }
      setBuscando(false)
    }, 300)
  }

  const seleccionar = f => { setAbierto(false); setQuery(''); onChange(f) }
  const cancelarTexto = () => setTimeout(() => setAbierto(false), 180)
  const nombreDe = f => tabla === 'venta' ? f.cliente_nombre : f.proveedor_nombre

  return (
    <div className="position-relative">
      {value ? (
        <div className="input-group input-group-sm">
          <span className="form-control form-control-sm bg-light">{valueLabel || value}</span>
          <button type="button" className="btn btn-outline-danger" title="Quitar vínculo" onClick={() => onChange(null)}>
            <i className="bi bi-x-lg" />
          </button>
        </div>
      ) : (
        <>
          <input className="form-control form-control-sm" value={query}
            placeholder="Buscar factura por número o nombre..."
            onChange={e => buscar(e.target.value)}
            onFocus={() => { setAbierto(true); if (!opciones.length) buscar('') }}
            onBlur={cancelarTexto}
            autoComplete="off" />
          {abierto && (
            <div className="border rounded bg-white shadow-sm position-absolute w-100" style={{ zIndex: 1080, top: '100%', maxHeight: 240, overflowY: 'auto' }}>
              {buscando ? (
                <div className="text-muted text-center py-2" style={{ fontSize: '0.75rem' }}>Buscando...</div>
              ) : opciones.length === 0 ? (
                <div className="text-muted text-center py-2" style={{ fontSize: '0.75rem' }}>Sin facturas que coincidan</div>
              ) : opciones.map(f => (
                <div key={f.id} className="px-2 py-1 border-bottom" style={{ cursor: 'pointer', fontSize: '0.83rem' }}
                  onMouseDown={() => seleccionar(f)}>
                  <span className="fw-semibold text-primary">{f.numero}</span>
                  <span className="text-muted ms-2" style={{ fontSize: '0.75rem' }}>{nombreDe(f)}</span>
                  <span className="text-muted ms-2" style={{ fontSize: '0.72rem' }}>{fmtM(f.importe, f.moneda)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Paginador({ pagina, setPagina, total, porPagina = PAGE_SIZE }) {
  const totalPaginas = Math.max(1, Math.ceil(total / porPagina))
  if (totalPaginas <= 1) return null
  const desde = (pagina - 1) * porPagina + 1
  const hasta = Math.min(total, pagina * porPagina)
  return (
    <div className="d-flex align-items-center justify-content-between border-top pt-2 mt-2 flex-shrink-0">
      <span className="text-muted small">Mostrando {desde}–{hasta} de {total}</span>
      <div className="d-flex align-items-center gap-2">
        <button className="btn btn-sm btn-outline-secondary" disabled={pagina <= 1}
          onClick={() => setPagina(p => Math.max(1, p - 1))}>
          <i className="bi bi-chevron-left" />
        </button>
        <span className="small text-muted">Página {pagina} de {totalPaginas}</span>
        <button className="btn btn-sm btn-outline-secondary" disabled={pagina >= totalPaginas}
          onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))}>
          <i className="bi bi-chevron-right" />
        </button>
      </div>
    </div>
  )
}

function FiltroBarra({ filt, setFilt }) {
  const activo = filt.buscar || filt.desde || filt.hasta || filt.moneda || filt.pago !== '' || filt.conOc
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
      <select className="form-select form-select-sm" style={{ width: 110 }}
        value={filt.conOc || ''} onChange={e => setFilt(p => ({ ...p, conOc: e.target.value }))}>
        <option value="">Con/Sin OC</option>
        <option value="con">Con OC</option>
        <option value="sin">Sin OC</option>
      </select>
      {activo && (
        <button className="btn btn-sm btn-outline-secondary py-0 px-2"
          onClick={() => setFilt({ buscar: '', desde: '', hasta: '', moneda: '', pago: '', conOc: '' })}>
          <i className="bi bi-x" />
        </button>
      )}
    </div>
  )
}

export default function Finanzas({ canWrite: canWriteProp, noDashboard, embedded, activeTab, onCounts } = {}) {
  const canWrite = canWriteProp !== undefined ? canWriteProp : puedeEscribir('finanzas')
  // Confirmar un pago (e-cheq/cheque diferido) es una función de tesorería
  // más restrictiva que el resto: no alcanza con el canWrite "amplio" que
  // llega embebido desde Administración (compras/administracion.escribir),
  // solo Finanzas puede hacerlo — igual que ya lo exige el backend.
  const canConfirmarPago = puedeEscribir('finanzas')
  const navigate = useNavigate()
  const [tab, setTab] = useState(activeTab || (noDashboard ? 'compras' : 'dashboard'))
  const [abrirOcClienteId, setAbrirOcClienteId] = useState(null)

  const colsFactC   = useColumnasOcultas('finanzas_facturas_compra')
  const colsFactV   = useColumnasOcultas('finanzas_facturas_venta')
  const colsSegComp = useColumnasOcultas('finanzas_seguimiento_compras')

  // Cuando se embebe en otro módulo, la solapa activa la controla el padre
  // (su propia barra de tabs plana), no la barra de tabs interna de Finanzas.
  useEffect(() => {
    if (activeTab && activeTab !== tab) setTab(activeTab)
  }, [activeTab])

  const [factC, setFactC] = useState([])
  const [filtC, setFiltC] = useState({ buscar: '', desde: '', hasta: '', moneda: '', pago: '', conOc: '' })
  const [loadC, setLoadC] = useState(false)
  const [pagC, setPagC] = useState(1)
  useEffect(() => { setPagC(1) }, [filtC])
  const factCPagina = useMemo(() => factC.slice((pagC - 1) * PAGE_SIZE, pagC * PAGE_SIZE), [factC, pagC])
  const [modalC, setModalC] = useState(null)
  const [formC, setFormC] = useState(FORM_C)
  const [savC, setSavC] = useState(false)
  const [addProvC, setAddProvC] = useState(false)
  const [newProvForm, setNewProvForm] = useState({ nombre: '', cuit: '' })
  const [anticipoModal, setAnticipoModal] = useState(null) // solo compras
  const [anticipoForm, setAnticipoForm] = useState({ anticipo: '', fecha_anticipo: '' })

  const pagosReqIdV = useRef(0)
  const pagosReqIdC = useRef(0)
  const [pagosModal,   setPagosModal]   = useState(null)
  const [pagos,        setPagos]        = useState([])
  const [pagosLoad,    setPagosLoad]    = useState(false)
  const [pagoForm,     setPagoForm]     = useState(FORM_PAGO)
  const [pagoSaving,   setPagoSaving]   = useState(false)
  const [mostrarForm,  setMostrarForm]  = useState(false)
  const [editandoPago, setEditandoPago] = useState(null)

  const [pagosModalC,  setPagosModalC]  = useState(null)
  const [pagosC,       setPagosC]       = useState([])
  const [pagosLoadC,   setPagosLoadC]   = useState(false)
  const [pagoFormC,    setPagoFormC]    = useState(FORM_PAGO)
  const [pagoSavingC,  setPagoSavingC]  = useState(false)
  const [mostrarFormC, setMostrarFormC] = useState(false)
  const [editandoPagoC, setEditandoPagoC] = useState(null)

  const [factV, setFactV] = useState([])
  const [filtV, setFiltV] = useState({ buscar: '', desde: '', hasta: '', moneda: '', pago: '', conOc: '' })
  const [loadV, setLoadV] = useState(false)
  const [pagV, setPagV] = useState(1)
  useEffect(() => { setPagV(1) }, [filtV])
  const factVPagina = useMemo(() => factV.slice((pagV - 1) * PAGE_SIZE, pagV * PAGE_SIZE), [factV, pagV])
  const [modalV, setModalV] = useState(null)
  const [formV, setFormV] = useState(FORM_V)
  const [ocSel, setOcSel] = useState(null)  // fila completa de la OC elegida (null si es PENDIENTE o no hay OC)
  const [savV, setSavV] = useState(false)

  // ── Saldo bancario ───────────────────────────────────────────────────────────
  const BANCOS = ['Banco ICBC', 'Banco Galicia']
  const FORM_SALDO = { entidad: 'Banco ICBC', monto: '', moneda: 'PESO' }
  const [saldos,     setSaldos]     = useState([])
  const [loadSaldos, setLoadSaldos] = useState(false)
  const [formSaldo,  setFormSaldo]  = useState(FORM_SALDO)
  const [savSaldo,   setSavSaldo]   = useState(false)

  const [tcBNA,     setTcBNA]     = useState([])
  const [formTC,    setFormTC]    = useState({ moneda: 'DÓLAR', valor: '', fecha: hoyLocal() })
  const [savTC,     setSavTC]     = useState(false)
  const [actualizandoBNA, setActualizandoBNA] = useState(false)

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
      const r = await api.post('/finanzas/tipo-cambio', { moneda: formTC.moneda, valor: formTC.valor, fuente: 'BNA', fecha: formTC.fecha })
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

  // Trae del BNA (cotización Divisas) dólar y euro de hoy en un solo clic —
  // reemplaza tener que ir a mirar la web del banco y tipear el número a mano.
  const actualizarBNA = async () => {
    setActualizandoBNA(true)
    try {
      const { data } = await api.post('/finanzas/tipo-cambio/bna-hoy')
      setTcBNA(prev => [data.dolar, data.euro, ...prev])
    } catch (e) {
      alert(e.response?.data?.error || 'No se pudo traer la cotización del BNA')
    } finally { setActualizandoBNA(false) }
  }

  // ── Servicios ────────────────────────────────────────────────────────────────
  // "servicios" = catálogo de servicios recurrentes (EDENOR, METROGAS...), para
  // el selector de "Cargar pago". "servCuotas" = la lista real de pagos (cada
  // fila es un pago pendiente o pagado que alguien cargó a mano) — nunca hay
  // filas fabricadas en blanco, así que no hace falta grisar nada.
  const PERIODICIDADES = ['mensual','bimestral','trimestral','semestral','anual']
  const FORM_SERV = { descripcion: '', usuario: '', info_pago: '', periodicidad: 'mensual' }
  const FORM_PAGO_SERVICIO = { servicio_id: '', monto: '', vencimiento: '', pagado: false, fecha_pagada: '' }
  const [servicios,     setServicios]     = useState([])   // catálogo
  const [servCuotas,    setServCuotas]    = useState([])   // pagos reales (pendientes + pagados)
  const [loadServ,      setLoadServ]      = useState(false)
  const [modalServ,     setModalServ]     = useState(null)  // null | obj — editar datos del servicio (catálogo)
  const [formServ,      setFormServ]      = useState(FORM_SERV)
  const [savServ,       setSavServ]       = useState(false)
  const [modalPago,     setModalPago]     = useState(false) // "Cargar pago"
  const [formPago,      setFormPago]      = useState(FORM_PAGO_SERVICIO)
  const [savPago,       setSavPago]       = useState(false)
  const [nuevoServ,     setNuevoServ]     = useState(false) // dentro del modal de pago: mostrar mini-form de alta
  const [nuevoServForm, setNuevoServForm] = useState(FORM_SERV)
  const [pagandoId,     setPagandoId]     = useState(null)
  const [filtServ,      setFiltServ]      = useState({ estado: 'todos', periodicidad: '', buscar: '' })
  const [modalCuota,    setModalCuota]    = useState(null)  // null | cuota — editar monto/vencimiento de ESE pago puntual (el precio puede variar de un período a otro)
  const [formCuota,     setFormCuota]     = useState({ monto: '', vencimiento: '' })
  const [savCuota,      setSavCuota]      = useState(false)

  const [ctrlOC,    setCtrlOC]    = useState([])
  const [loadCtrlOC, setLoadCtrlOC] = useState(false)
  const [editTC,    setEditTC]    = useState(null) // { oc_id, oc_numero, valor }
  const [savingTC,  setSavingTC]  = useState(false)

  // Cuando se embebe, expone los mismos conteos que hoy muestra en su propia
  // barra de tabs, para que el padre los replique en la suya.
  useEffect(() => {
    if (!onCounts) return
    onCounts({
      compras:   factC.length,
      ventas:    factV.length,
      servicios: servCuotas.filter(c => c.estado === 'pendiente').length,
      control:   ctrlOC.length,
    })
  }, [factC, factV, servCuotas, ctrlOC, onCounts])

  const cargarCtrlOC = useCallback(async () => {
    setLoadCtrlOC(true)
    try { const r = await api.get('/finanzas/control-oc'); setCtrlOC(r.data) }
    catch (e) { console.error(e) }
    finally { setLoadCtrlOC(false) }
  }, [])

  useEffect(() => { if (tab === 'control') cargarCtrlOC() }, [tab, cargarCtrlOC])

  async function guardarTCManual() {
    setSavingTC(true)
    try {
      await api.put(`/finanzas/control-oc/${editTC.oc_id}/tc-manual`, { valor: editTC.valor || null })
      setEditTC(null)
      cargarCtrlOC()
    } catch (e) {
      alert(e.response?.data?.error || 'Error al guardar')
    } finally { setSavingTC(false) }
  }

  // Autocorregir: si la diferencia es solo por tipo de cambio, calcula el TC
  // que hace coincidir exactamente lo facturado con el neto de la OC (en vez
  // de tener que tipearlo a mano) y lo guarda como TC manual de esa OC.
  async function autocorregirTC(r) {
    if (!r.oc_neto_orig) return
    const tcImplicito = r.facturas_neto_total / r.oc_neto_orig
    setSavingTC(true)
    try {
      await api.put(`/finanzas/control-oc/${r.oc_id}/tc-manual`, { valor: tcImplicito })
      cargarCtrlOC()
    } catch (e) {
      alert(e.response?.data?.error || 'Error al guardar')
    } finally { setSavingTC(false) }
  }

  // ── Seguimiento OC Compras (solo lectura) ───────────────────────────────────
  const [segCompras,     setSegCompras]     = useState([])
  const [loadSegCompras, setLoadSegCompras] = useState(false)
  const [pagSegCompras,  setPagSegCompras]  = useState(1)
  const [filtSegCompras, setFiltSegCompras] = useState({ estado: '', estado_facturacion: '', estado_pago: '', buscar: '' })

  const cargarSegCompras = useCallback(async () => {
    setLoadSegCompras(true)
    try {
      const p = {}
      if (filtSegCompras.estado)             p.estado = filtSegCompras.estado
      if (filtSegCompras.estado_facturacion) p.estado_facturacion = filtSegCompras.estado_facturacion
      if (filtSegCompras.estado_pago)        p.estado_pago = filtSegCompras.estado_pago
      if (filtSegCompras.buscar)              p.buscar = filtSegCompras.buscar
      const r = await api.get('/finanzas/seguimiento-oc-compras', { params: p })
      setSegCompras(r.data)
    } catch (e) { console.error(e) }
    finally { setLoadSegCompras(false) }
  }, [filtSegCompras])

  useEffect(() => {
    if (tab !== 'seguimiento-compras') return
    const t = setTimeout(() => cargarSegCompras(), 300)
    return () => clearTimeout(t)
  }, [tab, cargarSegCompras])
  useEffect(() => { setPagSegCompras(1) }, [filtSegCompras])
  const segComprasPagina = useMemo(() => segCompras.slice((pagSegCompras - 1) * PAGE_SIZE, pagSegCompras * PAGE_SIZE), [segCompras, pagSegCompras])

  // ── Seguimiento OC Ventas (solo lectura) ────────────────────────────────────
  const [segVentas,     setSegVentas]     = useState([])
  const [loadSegVentas, setLoadSegVentas] = useState(false)
  const [pagSegVentas,  setPagSegVentas]  = useState(1)
  const [filtSegVentas, setFiltSegVentas] = useState('')

  const cargarSegVentas = useCallback(async () => {
    setLoadSegVentas(true)
    try { const r = await api.get('/finanzas/oc-clientes'); setSegVentas(r.data) }
    catch (e) { console.error(e) }
    finally { setLoadSegVentas(false) }
  }, [])

  useEffect(() => { if (tab === 'seguimiento-ventas') cargarSegVentas() }, [tab, cargarSegVentas])
  useEffect(() => { setPagSegVentas(1) }, [filtSegVentas])
  const segVentasFiltradas = useMemo(() => {
    if (!filtSegVentas) return segVentas
    return segVentas.filter(r => estadoFila(r) === filtSegVentas)
  }, [segVentas, filtSegVentas])
  const segVentasPagina = useMemo(() => segVentasFiltradas.slice((pagSegVentas - 1) * PAGE_SIZE, pagSegVentas * PAGE_SIZE), [segVentasFiltradas, pagSegVentas])

  const cargarServiciosCatalogo = useCallback(async () => {
    try { const r = await api.get('/finanzas/servicios'); setServicios(r.data) }
    catch (e) { console.error(e) }
  }, [])

  const cargarServCuotas = useCallback(async () => {
    setLoadServ(true)
    try { const r = await api.get('/finanzas/servicios-cuotas'); setServCuotas(r.data) }
    catch (e) { console.error(e) }
    finally { setLoadServ(false) }
  }, [])

  useEffect(() => {
    if (tab !== 'servicios') return
    cargarServiciosCatalogo()
    cargarServCuotas()
  }, [tab, cargarServiciosCatalogo, cargarServCuotas])

  // Editar los datos del servicio en el catálogo (descripción, periodicidad,
  // usuario, datos de pago) — ya no crea ni toca ninguna cuota.
  const guardarServ = async () => {
    if (!formServ.descripcion.trim()) return alert('La descripción es requerida')
    setSavServ(true)
    try {
      await api.put(`/finanzas/servicios/${modalServ.id}`, formServ)
      setModalServ(null)
      cargarServiciosCatalogo()
      cargarServCuotas()
    } catch(e) { alert(e.response?.data?.error || 'Error') }
    finally { setSavServ(false) }
  }

  const desactivarServ = async s => {
    if (!confirm(`¿Desactivar "${s.descripcion}"? Ya no va a aparecer para elegir en "Cargar pago" (los pagos ya cargados se mantienen).`)) return
    await api.delete(`/finanzas/servicios/${s.id}`)
    cargarServiciosCatalogo()
  }

  const pagarCuota = async c => {
    setPagandoId(c.id)
    try {
      const fecha = hoyLocal()
      await api.post(`/finanzas/servicios-cuotas/${c.id}/pagar`, { fecha_pagada: fecha })
      cargarServCuotas()
    } catch(e) { alert(e.response?.data?.error || 'Error') }
    finally { setPagandoId(null) }
  }

  const eliminarCuota = async c => {
    if (!confirm(`¿Eliminar este pago de "${c.descripcion}"?`)) return
    await api.delete(`/finanzas/servicios-cuotas/${c.id}`)
    cargarServCuotas()
  }

  // Editar monto/vencimiento de ESTE pago puntual — a diferencia de "Editar
  // servicio" (que solo toca el catálogo), esto corrige el precio real de un
  // período, que suele variar de una factura a la siguiente (luz, gas, etc.).
  const abrirEditarCuota = c => {
    setFormCuota({ monto: c.monto, vencimiento: c.vencimiento || '' })
    setModalCuota(c)
  }

  const guardarCuota = async () => {
    if (!formCuota.monto || isNaN(parseFloat(formCuota.monto))) return alert('Cargá el monto')
    setSavCuota(true)
    try {
      await api.put(`/finanzas/servicios-cuotas/${modalCuota.id}`, formCuota)
      setModalCuota(null)
      cargarServCuotas()
    } catch(e) { alert(e.response?.data?.error || 'Error al guardar') }
    finally { setSavCuota(false) }
  }

  // ── Cargar pago (elegir servicio existente o cargar uno nuevo al vuelo) ─────
  const abrirCargarPago = () => {
    setFormPago(FORM_PAGO_SERVICIO)
    setNuevoServ(false)
    setNuevoServForm(FORM_SERV)
    setModalPago(true)
  }

  const crearServicioYUsarlo = async () => {
    if (!nuevoServForm.descripcion.trim()) return alert('La descripción es requerida')
    setSavServ(true)
    try {
      const r = await api.post('/finanzas/servicios', nuevoServForm)
      setServicios(p => [...p, r.data].sort((a, b) => a.descripcion.localeCompare(b.descripcion)))
      setFormPago(p => ({ ...p, servicio_id: String(r.data.id) }))
      setNuevoServ(false)
    } catch(e) { alert(e.response?.data?.error || 'Error al crear el servicio') }
    finally { setSavServ(false) }
  }

  const guardarPago = async () => {
    if (!formPago.servicio_id) return alert('Elegí un servicio (o cargá uno nuevo)')
    if (!formPago.monto || isNaN(parseFloat(formPago.monto))) return alert('Cargá el monto')
    setSavPago(true)
    try {
      await api.post(`/finanzas/servicios/${formPago.servicio_id}/cuotas`, {
        monto: formPago.monto, vencimiento: formPago.vencimiento,
        pagado: formPago.pagado, fecha_pagada: formPago.fecha_pagada,
      })
      setModalPago(false)
      cargarServCuotas()
    } catch(e) { alert(e.response?.data?.error || 'Error al guardar') }
    finally { setSavPago(false) }
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
      if (filtC.conOc) p.conOc = filtC.conOc
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
      if (filtV.conOc) p.conOc = filtV.conOc
      const r = await api.get('/finanzas/facturas-venta', { params: p })
      setFactV(r.data)
    } finally { setLoadV(false) }
  }, [filtV])

  useEffect(() => { const t = setTimeout(() => cargarC(), 300); return () => clearTimeout(t) }, [cargarC])
  useEffect(() => { const t = setTimeout(() => cargarV(), 300); return () => clearTimeout(t) }, [cargarV])

  useEffect(() => {
    api.get('/compras/proveedores').then(r => setProveedores(r.data || [])).catch(e => console.error(e))
    // Para elegir OC en una factura: todas las que todavía no completaron su
    // ciclo (ya facturadas por el total de su neto no aportan nada para elegir).
    api.get('/compras/oc', { params: { excluirFacturadas: 1, limit: 5000 } }).then(r => setOcs(r.data?.datos || [])).catch(e => console.error(e))
    api.get('/ventas/clientes').then(r => setClientes(r.data || [])).catch(e => console.error(e))
    api.get('/ventas/presupuestos', { params: { limit: 500 } }).then(r => setPresupuestos(r.data?.datos || [])).catch(e => console.error(e))
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

  // Mismo criterio que ocElegida (ventas): el gate solo aplica a facturas NUEVAS,
  // para no dejar sin editar una factura ya guardada sin OC (anteriores a esta
  // función, o cargadas a propósito sin OC).
  const ocElegidaC = modalC === 'new' ? !!formC.oc_numero : true

  const onNetoGravadoC = val => setFormC(p => ({ ...p, neto_gravado: val }))

  const abrirNuevaC = () => {
    setFormC(FORM_C); setAddProvC(false); setModalC('new')
  }

  const [mesExportarC, setMesExportarC] = useState(hoyLocal().slice(0, 7))
  const [exportandoC,  setExportandoC]  = useState(false)
  const exportarFacturasCompraMes = async () => {
    const [y, m] = mesExportarC.split('-').map(Number)
    const desde = `${mesExportarC}-01`
    const hasta = `${mesExportarC}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
    setExportandoC(true)
    try {
      const resp = await fetch(`/api/v1/finanzas/facturas-compra/exportar?desde=${desde}&hasta=${hasta}`,
        { headers: { Authorization: `Bearer ${getToken()}` } })
      if (!resp.ok) throw new Error('No se pudo generar el Excel')
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `facturas_compra_${mesExportarC}.xlsx`; a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert(e.message || 'Error al exportar')
    } finally { setExportandoC(false) }
  }

  // ── Comparar contra ARCA ("Mis Comprobantes Recibidos") ─────────────────────
  // Solo compara y lista diferencias — no carga nada automáticamente, cada
  // factura faltante se sigue cargando a mano con "Nueva Factura".
  const [modalArca, setModalArca] = useState(false)
  const [archivoArca, setArchivoArca] = useState(null)
  const [comparandoArca, setComparandoArca] = useState(false)
  const [resultadoArca, setResultadoArca] = useState(null)
  const [errorArca, setErrorArca] = useState('')

  const abrirCompararArca = () => {
    setArchivoArca(null); setResultadoArca(null); setErrorArca(''); setModalArca(true)
  }

  const compararArca = async () => {
    if (!archivoArca) return setErrorArca('Elegí el archivo .xlsx de ARCA')
    setComparandoArca(true); setErrorArca('')
    try {
      const fd = new FormData()
      fd.append('archivo', archivoArca)
      const r = await api.post('/finanzas/facturas-compra/comparar-arca', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setResultadoArca(r.data)
    } catch (e) {
      setErrorArca(e.response?.data?.error || 'Error al comparar el archivo')
    } finally { setComparandoArca(false) }
  }

  const abrirEditC = f => {
    setFormC({ ...FORM_C, ...f, oc_numero: f.oc_numero || f.ref_doc || '', importe: f.importe ?? '', tasa_cambio: f.tasa_cambio ?? 1 })
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
    const reqId = ++pagosReqIdC.current
    setPagosModalC(f); setMostrarFormC(false); setEditandoPagoC(null)
    setPagoFormC({ ...FORM_PAGO, moneda: f.moneda || 'PESO', tasa_cambio: f.tasa_cambio || 1 })
    setPagosLoadC(true)
    try {
      const r = await api.get(`/finanzas/facturas-compra/${f.id}/pagos`)
      // Si mientras tanto se abrió otra factura, esta respuesta ya está vieja —
      // sin este chequeo, podía pisar la lista de pagos con la de la factura anterior.
      if (reqId !== pagosReqIdC.current) return
      setPagosC(r.data)
    } finally { if (reqId === pagosReqIdC.current) setPagosLoadC(false) }
  }

  const abrirEditarPagoC = pago => {
    setPagoFormC({
      tipo: pago.tipo, forma_pago: pago.forma_pago, entidad: pago.entidad || '',
      importe: pago.importe, moneda: pago.moneda || 'PESO', tasa_cambio: pago.tasa_cambio || 1, fecha: pago.fecha || '',
      fecha_acreditacion: pago.fecha_acreditacion || '', observaciones: pago.observaciones || '',
      ret_iibb: pago.ret_iibb || '', ret_iva: pago.ret_iva || '', ret_gcia: pago.ret_gcia || '',
      ret_contratista: pago.ret_contratista || '', ret_ss: pago.ret_ss || '',
    })
    setEditandoPagoC(pago)
    setMostrarFormC(true)
  }

  const agregarPagoC = async () => {
    if (!pagoFormC.importe || parseFloat(pagoFormC.importe) <= 0) return alert('Importe requerido')
    if (!pagoFormC.fecha) return alert('Fecha requerida')
    setPagoSavingC(true)
    try {
      let nuevos
      if (editandoPagoC) {
        const r = await api.patch(`/finanzas/facturas-compra/${pagosModalC.id}/pagos/${editandoPagoC.id}`, pagoFormC)
        nuevos = pagosC.map(p => p.id === editandoPagoC.id ? r.data : p)
      } else {
        const r = await api.post(`/finanzas/facturas-compra/${pagosModalC.id}/pagos`, pagoFormC)
        nuevos = [...pagosC, r.data]
      }
      setPagosC(nuevos)
      setPagoFormC({ ...FORM_PAGO, moneda: pagosModalC.moneda || 'PESO', tasa_cambio: pagosModalC.tasa_cambio || 1 })
      setMostrarFormC(false)
      setEditandoPagoC(null)
      const totalPagado = nuevos.filter(p => p.estado === 'confirmado' || p.forma_pago === 'e-cheq').reduce((s, p) => s + totalEnPesos(p), 0)
      const saldo = Math.max(0, totalEnPesos(pagosModalC) - totalPagado)
      const cobrada = saldo <= 0.01 ? 1 : 0
      setFactC(prev => prev.map(x => x.id === pagosModalC.id
        ? { ...x, total_pagado: totalPagado, count_pagos: nuevos.length, saldo_pendiente: saldo, pago_confirmado: cobrada }
        : x))
      setPagosModalC(p => ({ ...p, saldo_pendiente: saldo, pago_confirmado: cobrada }))
    } catch(e) { alert(e.response?.data?.error || 'Error al guardar') }
    finally { setPagoSavingC(false) }
  }

  const confirmarPagoC = async pago => {
    let r
    try {
      r = await api.patch(`/finanzas/facturas-compra/${pagosModalC.id}/pagos/${pago.id}/confirmar`)
    } catch (e) { return alert(e.response?.data?.error || 'Error al confirmar') }
    const nuevos = pagosC.map(p => p.id === pago.id ? r.data : p)
    setPagosC(nuevos)
    const totalPagado = nuevos.filter(p => p.estado === 'confirmado' || p.forma_pago === 'e-cheq').reduce((s, p) => s + totalEnPesos(p), 0)
    const saldo = Math.max(0, totalEnPesos(pagosModalC) - totalPagado)
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
    const totalPagado = nuevos.filter(p => p.estado === 'confirmado' || p.forma_pago === 'e-cheq').reduce((s, p) => s + totalEnPesos(p), 0)
    const saldo = Math.max(0, totalEnPesos(pagosModalC) - totalPagado)
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

  // El gate de "elegí una OC antes de habilitar el resto" es para disciplinar
  // la carga de facturas NUEVAS — no debe bloquear la edición de una factura ya
  // guardada que no tiene OC (anteriores a esta función, o cargadas a propósito
  // sin OC): si no, un error de tipeo en cualquier campo -incluido Proyecto-
  // quedaba imposible de corregir sin antes forzar una OC que no corresponde.
  const ocElegida = modalV === 'new' ? !!formV.oc : true

  // Muestra el equivalente en la otra moneda cuando se factura distinto a como está la OC (siempre en USD)
  const otraMoneda = valor => {
    const v = parseFloat(valor) || 0
    const tc = parseFloat(formV.tasa_cambio) || 0
    if (!ocSel || !tc || !v || formV.moneda === 'DÓLAR') return null
    return `USD ${(v / tc).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  // Autocompletar concepto, neto, IVA y total a partir del % de la OC elegido.
  // Si el usuario ya corrigió el neto a mano (redondeo, descuento, etc.) desde el
  // último autocompletado, no se lo pisa aunque después toque moneda/TC — solo
  // una OC nueva o un % distinto disparan un recálculo desde cero.
  const lastOcIdRef = useRef(null)
  const lastAutoNetoRef = useRef(null)
  useEffect(() => {
    if (!ocSel) return
    if (ocSel.id !== lastOcIdRef.current) { lastOcIdRef.current = ocSel.id; lastAutoNetoRef.current = null }
    const pct = parseFloat(formV.oc_pct) || 0
    const montoUSD = (parseFloat(ocSel.monto_oc) || 0) * pct / 100
    const facturadoPrevio = (parseFloat(ocSel.monto_anticipo_usd) || 0) + (parseFloat(ocSel.monto_final_usd) || 0)
    const tipoConcepto = facturadoPrevio > 0 ? 'SALDO FINAL' : 'ANTICIPO'
    // monto_oc es NETO (sin IVA) — el IVA se suma arriba, no se descuenta de un total
    const neto  = formV.moneda === 'DÓLAR' ? montoUSD : montoUSD * (parseFloat(formV.tasa_cambio) || 0)
    const iva   = neto * 0.21
    const total = neto + iva
    const netoRedondeado = montoUSD > 0 ? Math.round(neto * 100) / 100 : null
    if (netoRedondeado != null && lastAutoNetoRef.current != null
        && Math.abs((parseFloat(formV.neto_gravado) || 0) - lastAutoNetoRef.current) > 0.01) {
      return
    }
    setFormV(p => ({
      ...p,
      concepto: pct > 0 ? `${pct}% ${tipoConcepto}` : p.concepto,
      importe: montoUSD > 0 ? Math.round(total * 100) / 100 : p.importe,
      neto_gravado: montoUSD > 0 ? Math.round(neto * 100) / 100 : p.neto_gravado,
      iva_21: montoUSD > 0 ? Math.round(iva * 100) / 100 : p.iva_21,
    }))
    lastAutoNetoRef.current = netoRedondeado
  }, [ocSel, formV.oc_pct, formV.moneda, formV.tasa_cambio])

  const guardarV = async () => {
    if (!formV.numero.trim()) return alert('El número de factura es requerido')
    // La OC de cliente siempre está en USD (no tiene su propia tasa de cambio para
    // copiar) — si se factura un % de una OC en pesos sin cargar un TC real, el
    // autofill de arriba calcula el neto multiplicando por 1, dando un importe
    // absurdamente bajo. Se bloquea el guardado en vez de dejarlo pasar silencioso.
    if (ocSel && formV.moneda !== 'DÓLAR' && (parseFloat(formV.oc_pct) || 0) > 0 && (parseFloat(formV.tasa_cambio) || 0) <= 1) {
      return alert('Falta cargar la Tasa de cambio real para convertir el % de la OC (en USD) a pesos.')
    }
    setSavV(true)
    try {
      const importe = parseFloat(formV.importe) ||
                      ((parseFloat(formV.neto_gravado)||0) + (parseFloat(formV.iva_21)||0) + (parseFloat(formV.iva_10_5)||0))
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
    const fecha_pago = nuevoPago ? hoyLocal() : ''
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
    const reqId = ++pagosReqIdV.current
    setPagosModal(f); setMostrarForm(false); setEditandoPago(null)
    setPagoForm({ ...FORM_PAGO, moneda: f.moneda || 'PESO', tasa_cambio: f.tasa_cambio || 1 })
    setPagosLoad(true)
    try {
      const r = await api.get(`/finanzas/facturas-venta/${f.id}/pagos`)
      if (reqId !== pagosReqIdV.current) return
      setPagos(r.data)
    } finally { if (reqId === pagosReqIdV.current) setPagosLoad(false) }
  }

  const abrirEditarPago = pago => {
    setPagoForm({
      tipo: pago.tipo, forma_pago: pago.forma_pago, entidad: pago.entidad || '',
      importe: pago.importe, moneda: pago.moneda || 'PESO', tasa_cambio: pago.tasa_cambio || 1, fecha: pago.fecha || '',
      fecha_acreditacion: pago.fecha_acreditacion || '', observaciones: pago.observaciones || '',
      ret_iibb: pago.ret_iibb || '', ret_iva: pago.ret_iva || '', ret_gcia: pago.ret_gcia || '',
      ret_contratista: pago.ret_contratista || '', ret_ss: pago.ret_ss || '',
    })
    setEditandoPago(pago)
    setMostrarForm(true)
  }

  // Importe + retenciones que el cliente aplicó al pagar (cuentan como saldado)
  const totalPago = p => totalEnPesos(p) + (p.ret_iibb||0) + (p.ret_iva||0) + (p.ret_gcia||0) + (p.ret_contratista||0) + (p.ret_ss||0)

  const agregarPago = async () => {
    if (!pagoForm.importe || parseFloat(pagoForm.importe) <= 0) return alert('Importe requerido')
    if (!pagoForm.fecha) return alert('Fecha requerida')
    setPagoSaving(true)
    try {
      let nuevos
      if (editandoPago) {
        const r = await api.patch(`/finanzas/facturas-venta/${pagosModal.id}/pagos/${editandoPago.id}`, pagoForm)
        nuevos = pagos.map(p => p.id === editandoPago.id ? r.data : p)
      } else {
        const r = await api.post(`/finanzas/facturas-venta/${pagosModal.id}/pagos`, pagoForm)
        nuevos = [...pagos, r.data]
      }
      setPagos(nuevos)
      setPagoForm({ ...FORM_PAGO, moneda: pagosModal.moneda || 'PESO', tasa_cambio: pagosModal.tasa_cambio || 1 })
      setMostrarForm(false)
      setEditandoPago(null)
      // Actualizar saldo en la lista
      const totalPagado = nuevos.filter(p => p.estado === 'confirmado' || p.forma_pago === 'e-cheq').reduce((s, p) => s + totalPago(p), 0)
      const saldo = Math.max(0, totalEnPesos(pagosModal) - totalPagado)
      const cobrada = saldo <= 0.01 ? 1 : 0
      setFactV(prev => prev.map(x => x.id === pagosModal.id
        ? { ...x, total_pagado: totalPagado, count_pagos: nuevos.length, saldo_pendiente: saldo, pago_confirmado: cobrada }
        : x))
      setPagosModal(p => ({ ...p, saldo_pendiente: saldo, pago_confirmado: cobrada }))
    } catch(e) { alert(e.response?.data?.error || 'Error al guardar') }
    finally { setPagoSaving(false) }
  }

  const confirmarPago = async pago => {
    let r
    try {
      r = await api.patch(`/finanzas/facturas-venta/${pagosModal.id}/pagos/${pago.id}/confirmar`)
    } catch (e) { return alert(e.response?.data?.error || 'Error al confirmar') }
    const nuevos = pagos.map(p => p.id === pago.id ? r.data : p)
    setPagos(nuevos)
    const totalPagado = nuevos.filter(p => p.estado === 'confirmado' || p.forma_pago === 'e-cheq').reduce((s, p) => s + totalPago(p), 0)
    const saldo = Math.max(0, totalEnPesos(pagosModal) - totalPagado)
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
    const totalPagado = nuevos.filter(p => p.estado === 'confirmado' || p.forma_pago === 'e-cheq').reduce((s, p) => s + totalPago(p), 0)
    const saldo = Math.max(0, totalEnPesos(pagosModal) - totalPagado)
    setFactV(prev => prev.map(x => x.id === pagosModal.id
      ? { ...x, total_pagado: totalPagado, count_pagos: nuevos.length, saldo_pendiente: saldo, pago_confirmado: saldo <= 0.01 ? 1 : 0 }
      : x))
    setPagosModal(p => ({ ...p, saldo_pendiente: saldo, pago_confirmado: saldo <= 0.01 ? 1 : 0 }))
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={embedded ? 'd-flex flex-column flex-grow-1' : 'container-fluid d-flex flex-column'} style={embedded ? { minHeight: 0, flex: '1 1 auto' } : { height: '100%', padding: '1rem 1.5rem' }}>
      {!embedded && (
        <>
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
                <i className="bi bi-cart3 me-1" />Facturas de Compra
                {factC.length > 0 && <span className="badge bg-secondary ms-1" style={{ fontSize: '0.65rem' }}>{factC.length}</span>}
              </button>
            </li>
            <li className="nav-item">
              <button className={`nav-link py-1 px-3 ${tab === 'ventas' ? 'active' : ''}`} onClick={() => setTab('ventas')}>
                <i className="bi bi-shop me-1" />Facturas de Venta
                {factV.length > 0 && <span className="badge bg-secondary ms-1" style={{ fontSize: '0.65rem' }}>{factV.length}</span>}
              </button>
            </li>
            <li className="nav-item">
              <button className={`nav-link py-1 px-3 ${tab === 'saldos' ? 'active' : ''}`} onClick={() => setTab('saldos')}>
                <i className="bi bi-bank me-1" />Tesorería
              </button>
            </li>
            <li className="nav-item">
              <button className={`nav-link py-1 px-3 ${tab === 'servicios' ? 'active' : ''}`} onClick={() => setTab('servicios')}>
                <i className="bi bi-lightning-charge me-1" />Servicios
                {servCuotas.filter(c => c.estado === 'pendiente').length > 0 && (
                  <span className="badge bg-warning text-dark ms-1" style={{ fontSize: '0.65rem' }}>
                    {servCuotas.filter(c => c.estado === 'pendiente').length}
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
              <button className={`nav-link py-1 px-3 ${tab === 'seguimiento-compras' ? 'active' : ''}`} onClick={() => setTab('seguimiento-compras')}>
                <i className="bi bi-truck me-1" />Seguimiento OC Compras
              </button>
            </li>
            <li className="nav-item">
              <button className={`nav-link py-1 px-3 ${tab === 'oc-clientes' ? 'active' : ''}`} onClick={() => setTab('oc-clientes')}>
                <i className="bi bi-file-earmark-text me-1" />OC Clientes
              </button>
            </li>
            <li className="nav-item">
              <button className={`nav-link py-1 px-3 ${tab === 'seguimiento-ventas' ? 'active' : ''}`} onClick={() => setTab('seguimiento-ventas')}>
                <i className="bi bi-graph-up-arrow me-1" />Seguimiento OC Ventas
              </button>
            </li>
          </ul>
        </>
      )}

      {/* ── TAB DASHBOARD ── */}
      {tab === 'dashboard' && <FinanzasDashboard />}

      {/* ── TAB COMPRAS ── */}
      {tab === 'compras' && (
        <div className="flex-grow-1 d-flex flex-column overflow-hidden">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <FiltroBarra filt={filtC} setFilt={setFiltC} />
            <div className="d-flex align-items-center gap-2 ms-3 flex-shrink-0">
              <SelectorColumnas columnas={COLS_FACT_COMPRA} visible={colsFactC.visible} onToggle={colsFactC.toggle} />
              <input type="month" className="form-control form-control-sm" style={{ width: 145 }}
                value={mesExportarC} onChange={e => setMesExportarC(e.target.value)} />
              <button className="btn btn-sm btn-outline-success" onClick={() => exportarFacturasCompraMes()} disabled={exportandoC}>
                {exportandoC ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="bi bi-file-excel me-1" />}
                Exportar mes
              </button>
              <button className="btn btn-sm btn-outline-secondary" onClick={abrirCompararArca}>
                <i className="bi bi-file-earmark-diff me-1" />Comparar con ARCA
              </button>
              {canWrite && (
                <button className="btn btn-sm btn-primary" onClick={abrirNuevaC}>
                  <i className="bi bi-plus-lg me-1" />Nueva Factura
                </button>
              )}
            </div>
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
                    {colsFactC.visible('fecha') && <th>Fecha</th>}
                    {colsFactC.visible('tipo') && <th style={{ width: 55 }}>Tipo</th>}
                    {colsFactC.visible('numero') && <th>N° Factura</th>}
                    {colsFactC.visible('proveedor') && <th>Proveedor</th>}
                    {colsFactC.visible('cuit') && <th>CUIT</th>}
                    {colsFactC.visible('neto') && <th className="text-end">Neto Grav.</th>}
                    {colsFactC.visible('no_grav') && <th className="text-end">No Grav/Exento</th>}
                    {colsFactC.visible('iva21') && <th className="text-end">IVA 21%</th>}
                    {colsFactC.visible('iva105') && <th className="text-end">IVA 10.5%</th>}
                    {colsFactC.visible('iva27') && <th className="text-end">IVA 27%</th>}
                    {colsFactC.visible('otros_imp') && <th className="text-end">Otros Imp.</th>}
                    {colsFactC.visible('perc_iva') && <th className="text-end">Perc. IVA</th>}
                    {colsFactC.visible('perc_iibb') && <th className="text-end">Perc. IIBB</th>}
                    {colsFactC.visible('total') && <th className="text-end">Total</th>}
                    {colsFactC.visible('observaciones') && <th>Observaciones</th>}
                    {colsFactC.visible('pago') && <th>Pago</th>}
                    {canWrite && <th style={{ width: 70 }} />}
                  </tr>
                </thead>
                <tbody>
                  {factCPagina.map(f => (
                    <tr key={`${f.fuente}-${f.id}`} style={esNC(f.tipo_factura) ? { background: '#fff1f1', opacity: 0.85 } : {}}>
                      {colsFactC.visible('fecha') && <td style={{ whiteSpace: 'nowrap' }}>{fmtF(f.fecha)}</td>}
                      {colsFactC.visible('tipo') && <td><span className={`badge bg-${esNC(f.tipo_factura) ? 'danger' : 'secondary'}`}>{f.tipo_factura || 'A'}</span></td>}
                      {colsFactC.visible('numero') && <td className="fw-semibold" style={{ whiteSpace: 'nowrap' }}>{f.numero}</td>}
                      {colsFactC.visible('proveedor') && <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.proveedor_nombre}>{f.proveedor_nombre || '—'}</td>}
                      {colsFactC.visible('cuit') && <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{f.cuit || '—'}</td>}
                      {colsFactC.visible('neto') && <td className="text-end">{f.neto_gravado ? fmtM(f.neto_gravado, f.moneda) : '—'}</td>}
                      {colsFactC.visible('no_grav') && <td className="text-end">{f.no_grav_exento ? fmtM(f.no_grav_exento, f.moneda) : '—'}</td>}
                      {colsFactC.visible('iva21') && <td className="text-end">{f.iva_21 ? fmtM(f.iva_21, f.moneda) : '—'}</td>}
                      {colsFactC.visible('iva105') && <td className="text-end">{f.iva_10_5 ? fmtM(f.iva_10_5, f.moneda) : '—'}</td>}
                      {colsFactC.visible('iva27') && <td className="text-end">{f.iva_27 ? fmtM(f.iva_27, f.moneda) : '—'}</td>}
                      {colsFactC.visible('otros_imp') && <td className="text-end">{f.otros_imp ? fmtM(f.otros_imp, f.moneda) : '—'}</td>}
                      {colsFactC.visible('perc_iva') && <td className="text-end">{f.perc_iva ? fmtM(f.perc_iva, f.moneda) : '—'}</td>}
                      {colsFactC.visible('perc_iibb') && <td className="text-end">{f.perc_iibb ? fmtM(f.perc_iibb, f.moneda) : '—'}</td>}
                      {colsFactC.visible('total') && <td className="text-end fw-semibold">{fmtM(f.importe, f.moneda)}</td>}
                      {colsFactC.visible('observaciones') && <td className="text-muted" style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.observaciones}>{f.observaciones || '—'}</td>}
                      {colsFactC.visible('pago') && <td style={{ whiteSpace: 'nowrap', minWidth: 130 }}>
                        {esNC(f.tipo_factura) ? (
                          <span className="text-muted" style={{ fontSize: '0.72rem' }}>
                            Anula: {f.nc_factura_numero || '—'}
                          </span>
                        ) : (
                          <>
                            {f.anulada ? (
                              <span className="badge bg-danger" style={{ fontSize: '0.68rem' }} title={`NC: ${f.nc_numeros || ''}`}>
                                <i className="bi bi-x-circle-fill me-1" />Anulada
                              </span>
                            ) : f.pago_confirmado ? (
                              <div className="d-flex align-items-center gap-1">
                                <span className="badge bg-success"><i className="bi bi-check2-circle me-1" />Pagada</span>
                                {canWrite && (
                                  <button className="btn btn-sm btn-outline-warning py-0 px-1" style={{ fontSize: '0.65rem' }}
                                    title="Reabrir para corregir pagos" onClick={() => reabrirC(f)}>
                                    <i className="bi bi-arrow-counterclockwise" />
                                  </button>
                                )}
                              </div>
                            ) : f.count_pagos > 0 || f.total_nc > 0 ? (
                              <div style={{ fontSize: '0.72rem', lineHeight: 1.4 }}>
                                {f.count_pagos > 0 && (
                                  <div className="text-success fw-semibold">
                                    <i className="bi bi-check2 me-1" />Pag: {fmtM(f.total_pagado, 'PESO')}
                                  </div>
                                )}
                                {f.total_nc > 0 && (
                                  <div className="text-danger fw-semibold" title={`NC: ${f.nc_numeros || ''}`}>
                                    <i className="bi bi-file-earmark-minus me-1" />NC parcial: -{fmtM(f.total_nc, 'PESO')}
                                  </div>
                                )}
                                <div className="text-danger fw-semibold">
                                  <i className="bi bi-hourglass-split me-1" />Rest: {fmtM(f.saldo_pendiente, 'PESO')}
                                </div>
                              </div>
                            ) : (
                              <span className="badge bg-secondary"><i className="bi bi-clock me-1" />Pendiente</span>
                            )}
                            {canWrite && !f.anulada && (
                              <button className="btn btn-sm btn-outline-primary py-0 px-1 ms-1" style={{ fontSize: '0.72rem' }}
                                title="Ver/registrar pagos" onClick={() => abrirPagosC(f)}>
                                <i className="bi bi-cash-coin" />
                              </button>
                            )}
                          </>
                        )}
                      </td>}
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
          <Paginador pagina={pagC} setPagina={setPagC} total={factC.length} />
        </div>
      )}

      {/* ── TAB VENTAS ── */}
      {tab === 'ventas' && (
        <div className="flex-grow-1 d-flex flex-column overflow-hidden">
          <div className="d-flex justify-content-between align-items-center mb-3">
            <FiltroBarra filt={filtV} setFilt={setFiltV} />
            <div className="d-flex align-items-center gap-2 ms-3 flex-shrink-0">
              <SelectorColumnas columnas={COLS_FACT_VENTA} visible={colsFactV.visible} onToggle={colsFactV.toggle} />
              {canWrite && (
                <button className="btn btn-sm btn-primary" onClick={abrirNuevaV}>
                  <i className="bi bi-plus-lg me-1" />Nueva Factura
                </button>
              )}
            </div>
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
                    {colsFactV.visible('fecha') && <th>Fecha</th>}
                    {colsFactV.visible('tipo') && <th style={{ width: 55 }}>Tipo</th>}
                    {colsFactV.visible('numero') && <th>N° Factura</th>}
                    {colsFactV.visible('cliente') && <th>Cliente</th>}
                    {colsFactV.visible('cuit') && <th>CUIT</th>}
                    {colsFactV.visible('concepto') && <th>Concepto</th>}
                    {colsFactV.visible('oc') && <th>OC</th>}
                    {colsFactV.visible('neto') && <th className="text-end">Neto Grav.</th>}
                    {colsFactV.visible('iva') && <th className="text-end">IVA</th>}
                    {colsFactV.visible('total') && <th className="text-end">Total Fact.</th>}
                    {colsFactV.visible('total_cobrado') && <th className="text-end">Total Cobrado</th>}
                    {colsFactV.visible('f_pago') && <th>F. Pago</th>}
                    {colsFactV.visible('cobro') && <th>Cobro</th>}
                    {canWrite && <th style={{ width: 70 }} />}
                  </tr>
                </thead>
                <tbody>
                  {factVPagina.map(f => (
                    <tr key={f.id} style={esNC(f.tipo_factura) ? { background: '#fff1f1', opacity: 0.85 } : {}}>
                      {colsFactV.visible('fecha') && <td style={{ whiteSpace: 'nowrap' }}>{fmtF(f.fecha)}</td>}
                      {colsFactV.visible('tipo') && <td><span className={`badge bg-${esNC(f.tipo_factura) ? 'danger' : 'secondary'}`} style={{ fontSize: '0.65rem' }}>{f.tipo_factura || 'A'}</span></td>}
                      {colsFactV.visible('numero') && <td className="fw-semibold" style={{ whiteSpace: 'nowrap' }}>{f.numero}</td>}
                      {colsFactV.visible('cliente') && <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.cliente_nombre}>{f.cliente_nombre || '—'}</td>}
                      {colsFactV.visible('cuit') && <td className="text-muted font-monospace" style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}>{f.cliente_cuit || '—'}</td>}
                      {colsFactV.visible('concepto') && <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.concepto}>{f.concepto || '—'}</td>}
                      {colsFactV.visible('oc') && <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>
                        {f.oc || '—'}
                        {f.proy_codigo && (
                          <span className="badge bg-secondary ms-1" style={{ fontSize: '0.62rem', fontFamily: 'monospace' }} title={f.proy_nombre}>
                            {f.proy_codigo}
                          </span>
                        )}
                      </td>}
                      {colsFactV.visible('neto') && <td className="text-end">{f.neto_gravado ? fmtM(f.neto_gravado, f.moneda) : '—'}</td>}
                      {colsFactV.visible('iva') && <td className="text-end">{(f.iva_21 || f.iva_10_5) ? fmtM((f.iva_21||0) + (f.iva_10_5||0), f.moneda) : '—'}</td>}
                      {colsFactV.visible('total') && <td className="text-end fw-semibold">{fmtM(f.importe, f.moneda)}</td>}
                      {/* total_pagado siempre viene convertido a pesos (así se puede sumar entre pagos de
                          distinta moneda) — mostrarlo con la etiqueta de la factura (ej. USD) sin volver a
                          convertir hacía aparecer montos absurdos en facturas en moneda extranjera. */}
                      {colsFactV.visible('total_cobrado') && <td className="text-end fw-semibold text-success">{f.total_pagado > 0 ? fmtM(f.total_pagado, 'PESO') : '—'}</td>}
                      {colsFactV.visible('f_pago') && <td style={{ whiteSpace: 'nowrap' }}>{fmtF(f.fecha_pago)}</td>}
                      {colsFactV.visible('cobro') && <td style={{ whiteSpace: 'nowrap' }}>
                        {esNC(f.tipo_factura) ? (
                          <span className="text-muted" style={{ fontSize: '0.72rem' }}>
                            Anula: {f.nc_factura_numero || '—'}
                          </span>
                        ) : f.anulada ? (
                          <span className="badge bg-danger" style={{ fontSize: '0.68rem' }} title={`NC: ${f.nc_numeros || ''}`}>
                            <i className="bi bi-x-circle-fill me-1" />Anulada
                          </span>
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
                            ) : f.count_pagos > 0 || f.total_nc > 0 ? (
                              <div style={{ fontSize: '0.72rem', lineHeight: 1.4 }}>
                                {f.count_pagos > 0 && (
                                  <div className="text-success fw-semibold">
                                    <i className="bi bi-check2 me-1" />Cob: {fmtM(f.total_pagado, 'PESO')}
                                  </div>
                                )}
                                {f.total_nc > 0 && (
                                  <div className="text-danger fw-semibold" title={`NC: ${f.nc_numeros || ''}`}>
                                    <i className="bi bi-file-earmark-minus me-1" />NC parcial: -{fmtM(f.total_nc, 'PESO')}
                                  </div>
                                )}
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
                      </td>}
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
          <Paginador pagina={pagV} setPagina={setPagV} total={factV.length} />
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

                {/* ── Proveedor (primero: define qué OC se pueden elegir) ── */}
                <div className="row g-2 mb-3">
                  <div className="col-md-7">
                    <label className="form-label small fw-semibold">Proveedor *</label>
                    <div className="d-flex gap-1">
                      <select className="form-select form-select-sm" value={formC.proveedor_id}
                        onChange={e => {
                          const pv = proveedores.find(p => String(p.id) === e.target.value)
                          setFormC(prev => ({ ...prev, proveedor_id: e.target.value, proveedor_nombre: pv?.nombre || '', cuit: pv?.cuit || prev.cuit, oc_id: '', oc_numero: '' }))
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
                            <input className="form-control form-control-sm" value={newProvForm.cuit} autoComplete="off"
                              onChange={e => setNewProvForm(p => ({ ...p, cuit: e.target.value }))}
                              onBlur={e => setNewProvForm(p => ({ ...p, cuit: formatCuit(e.target.value) }))} placeholder="20-12345678-9" />
                          </div>
                          <button className="btn btn-sm btn-primary" onClick={addProvC === 'new' ? guardarNuevoProv : guardarEditProv}>Guardar</button>
                          <button className="btn btn-sm btn-secondary" onClick={() => setAddProvC(false)}>Cancelar</button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="col-md-5">
                    <label className="form-label small fw-semibold">CUIT</label>
                    <input className="form-control form-control-sm" value={formC.cuit} autoComplete="off"
                      onChange={e => setFormC(p => ({ ...p, cuit: e.target.value }))}
                      onBlur={e => setFormC(p => ({ ...p, cuit: formatCuit(e.target.value) }))} placeholder="Ej: 30-12345678-9" />
                  </div>
                </div>

                {/* ── OC (habilita el resto del formulario; filtrada por el proveedor elegido) ── */}
                <div className="row g-2 mb-2">
                  <div className="col-md-5">
                    <label className="form-label small fw-semibold">OC / Referencia *</label>
                    <OcCompraSelector
                      value={formC.oc_numero}
                      ocs={formC.proveedor_id ? ocs.filter(o => String(o.proveedor_id) === String(formC.proveedor_id)) : ocs}
                      onChange={oc => setFormC(p => ({
                        ...p, oc_id: oc.id || '', oc_numero: oc.numero,
                        // Precarga la moneda/TC de la OC elegida — el usuario todavía puede
                        // corregirlo, pero evita dejar la factura en PESO/1 por olvido cuando
                        // la OC es en moneda extranjera.
                        ...(oc.id ? { moneda: oc.moneda || 'PESO', tasa_cambio: oc.tc_resuelto || oc.tasa_cambio || 1 } : {}),
                      }))}
                      disabled={!formC.proveedor_id}
                    />
                  </div>
                </div>
                {!formC.proveedor_id ? (
                  <div className="alert alert-warning py-2 small mb-2">
                    <i className="bi bi-lock-fill me-1" />
                    Elegí un proveedor para ver sus OC.
                  </div>
                ) : !ocElegidaC && (
                  <div className="alert alert-warning py-2 small mb-2">
                    <i className="bi bi-lock-fill me-1" />
                    Elegí una OC (o marcá "PENDIENTE") para habilitar el resto de la factura.
                  </div>
                )}

                <fieldset disabled={!ocElegidaC} style={{ border: 0, padding: 0, margin: 0 }}>

                {/* ── Comprobante ── */}
                <div className="row g-2 mb-3">
                  <div className="col-md-2">
                    <label className="form-label small fw-semibold">Tipo</label>
                    <select className="form-select form-select-sm" value={formC.tipo_factura}
                      onChange={e => setFormC(p => ({ ...p, tipo_factura: e.target.value, nc_factura_id: '' }))}>
                      <option value="A">A</option>
                      <option value="B">B</option>
                      <option value="C">C</option>
                      <option value="E">E</option>
                      <option value="M">M</option>
                      <option value="NC A">NC A</option>
                      <option value="NC B">NC B</option>
                      <option value="NC C">NC C</option>
                    </select>
                  </div>
                  <div className="col-md-4">
                    <label className="form-label small fw-semibold">N° Factura *</label>
                    <input className="form-control form-control-sm" value={formC.numero} autoComplete="off"
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
                  {esNC(formC.tipo_factura) && (
                    <div className="col-md-12">
                      <label className="form-label small fw-semibold">Factura que anula *</label>
                      <FacturaAnulaSelector tabla="compra" excludeId={modalC !== 'new' ? modalC.id : null}
                        value={formC.nc_factura_id} valueLabel={formC.nc_factura_numero}
                        onChange={f => setFormC(p => ({ ...p, nc_factura_id: f ? f.id : '', nc_factura_numero: f ? f.numero : '' }))} />
                    </div>
                  )}
                </div>

                <hr className="my-2" />
                <p className="small fw-semibold text-muted mb-2" style={{ letterSpacing: '0.05em' }}>IMPORTES</p>

                {/* Neto */}
                <div className="row g-2 mb-2">
                  <div className="col-md-4">
                    <label className="form-label small fw-semibold">Neto Gravado</label>
                    <input type="number" onPaste={manejarPegadoNumero} className="form-control form-control-sm" value={formC.neto_gravado}
                      onChange={e => onNetoGravadoC(e.target.value)} min="0" step="0.01" placeholder="0.00" />
                  </div>
                  <div className="col-md-4">
                    <label className="form-label small fw-semibold">No Grav. / Exento</label>
                    <input type="number" onPaste={manejarPegadoNumero} className="form-control form-control-sm" value={formC.no_grav_exento}
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
                        <input type="number" onPaste={manejarPegadoNumero} className="form-control form-control-sm" value={formC[key]}
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
                    <input type="number" onPaste={manejarPegadoNumero} className="form-control form-control-sm" value={formC.perc_iva}
                      onChange={e => setFormC(p => ({ ...p, perc_iva: e.target.value }))} min="0" step="0.01" placeholder="0.00" />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-semibold">Perc. IIBB</label>
                    <input type="number" onPaste={manejarPegadoNumero} className="form-control form-control-sm" value={formC.perc_iibb}
                      onChange={e => setFormC(p => ({ ...p, perc_iibb: e.target.value }))} min="0" step="0.01" placeholder="0.00" />
                  </div>
                  <div className="col-md-3">
                    <label className="form-label small fw-semibold">Otros Impuestos</label>
                    <input type="number" onPaste={manejarPegadoNumero} className="form-control form-control-sm" value={formC.otros_imp}
                      onChange={e => setFormC(p => ({ ...p, otros_imp: e.target.value }))} min="0" step="0.01" placeholder="0.00" />
                  </div>
                  {formC.moneda !== 'PESO' && (
                    <div className="col-md-3">
                      <label className="form-label small fw-semibold">Tasa de cambio</label>
                      <input type="number" onPaste={manejarPegadoNumero} className="form-control form-control-sm" value={formC.tasa_cambio}
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

                {/* Observaciones */}
                <div className="row g-2">
                  <div className="col-md-12">
                    <label className="form-label small fw-semibold">Observaciones</label>
                    <input className="form-control form-control-sm" value={formC.observaciones}
                      onChange={e => setFormC(p => ({ ...p, observaciones: e.target.value }))} />
                  </div>
                </div>

                </fieldset>

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
                  <small className="text-muted">{pagosModalC.proveedor_nombre} · Total: {fmtM(totalEnPesos(pagosModalC), 'PESO')}</small>
                </div>
                <button className="btn-close btn-sm" onClick={() => setPagosModalC(null)} />
              </div>
              <div className="modal-body" style={{ fontSize: '0.85rem' }}>
                {/* Resumen saldo */}
                {!pagosModalC.pago_confirmado && (
                  <div className="alert alert-warning py-1 px-2 mb-3 small">
                    <i className="bi bi-hourglass-split me-1" />
                    Saldo pendiente: <strong>{fmtM(pagosModalC.saldo_pendiente ?? totalEnPesos(pagosModalC), 'PESO')}</strong>
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
                              : canConfirmarPago
                                ? <button className="btn btn-xs btn-warning py-0 px-1" style={{ fontSize: '0.72rem' }} onClick={() => confirmarPagoC(p)}>Confirmar</button>
                                : <span className="badge bg-warning text-dark">Pendiente</span>}
                          </td>
                          {canWrite && (
                            <td>
                              <div className="d-flex gap-1">
                                <button className="btn btn-sm btn-outline-primary py-0 px-1" title="Editar pago" onClick={() => abrirEditarPagoC(p)}>
                                  <i className="bi bi-pencil" />
                                </button>
                                <button className="btn btn-sm btn-outline-danger py-0 px-1" onClick={() => eliminarPagoC(p)}>
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

                {canWrite && !mostrarFormC && (
                  <button className="btn btn-sm btn-outline-primary" onClick={() => { setPagoFormC({ ...FORM_PAGO, moneda: pagosModalC.moneda || 'PESO', tasa_cambio: pagosModalC.tasa_cambio || 1 }); setEditandoPagoC(null); setMostrarFormC(true) }}>
                    <i className="bi bi-plus-lg me-1" />Registrar pago
                  </button>
                )}
                {canWrite && mostrarFormC && (
                  <div className="border rounded p-3" style={{ background: '#f8f9ff' }}>
                    <p className="small fw-semibold mb-2">{editandoPagoC ? 'Editar pago' : 'Nuevo pago'}</p>
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
                        <input type="number" onPaste={manejarPegadoNumero} className="form-control form-control-sm" value={pagoFormC.importe}
                          onChange={e => setPagoFormC(p => ({ ...p, importe: e.target.value }))}
                          min="0" step="0.01" placeholder="0.00" />
                      </div>
                      {pagoFormC.moneda !== 'PESO' && pagoFormC.moneda !== 'PESOS' && (
                        <div className="col-md-3">
                          <label className="form-label small">Tasa de cambio</label>
                          <input type="number" onPaste={manejarPegadoNumero} className="form-control form-control-sm" value={pagoFormC.tasa_cambio}
                            onChange={e => setPagoFormC(p => ({ ...p, tasa_cambio: e.target.value }))}
                            min="0" step="0.01" placeholder="1" />
                        </div>
                      )}
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
                    {pagoFormC.forma_pago === 'cheque_diferido' && (
                      <p className="small text-warning mb-2">
                        <i className="bi bi-info-circle me-1" />
                        Se registra como <strong>pendiente</strong> hasta que confirmes la acreditación.
                      </p>
                    )}
                    {pagoFormC.forma_pago === 'e-cheq' && (
                      <p className="small text-info mb-2">
                        <i className="bi bi-info-circle me-1" />
                        La factura queda marcada como <strong>pagada</strong>. El E-CHEQ se sigue viendo aparte, como pendiente de débito, hasta que lo confirmes.
                      </p>
                    )}
                    <div className="d-flex gap-2">
                      <button className="btn btn-sm btn-primary" onClick={agregarPagoC} disabled={pagoSavingC}>
                        {pagoSavingC ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="bi bi-check-lg me-1" />}
                        Guardar pago
                      </button>
                      <button className="btn btn-sm btn-outline-secondary" onClick={() => { setMostrarFormC(false); setEditandoPagoC(null) }}>Cancelar</button>
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
                  <input type="number" onPaste={manejarPegadoNumero} className="form-control form-control-sm" value={anticipoForm.anticipo}
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

      {/* ── MODAL COMPARAR CON ARCA ── */}
      {modalArca && (
        <div className="modal d-block" style={{ background: 'rgba(0,0,0,.45)', zIndex: 1060 }}>
          <div className="modal-dialog modal-dialog-centered modal-lg">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h6 className="modal-title fw-bold"><i className="bi bi-file-earmark-diff me-2" />Comparar con ARCA</h6>
                <button className="btn-close btn-sm" onClick={() => setModalArca(false)} />
              </div>
              <div className="modal-body" style={{ fontSize: '0.87rem' }}>
                {!resultadoArca ? (
                  <>
                    <p className="text-muted small">
                      Subí el Excel de <strong>"Mis Comprobantes Recibidos"</strong> que se descarga del portal de ARCA
                      (Facturación electrónica → Mis Comprobantes Recibidos → Exportar) para comparar contra las facturas
                      de compra cargadas en el sistema y ver qué falta o no coincide.
                    </p>
                    <input type="file" className="form-control form-control-sm" accept=".xlsx,.xls"
                      onChange={e => setArchivoArca(e.target.files[0] || null)} />
                    {errorArca && <div className="alert alert-danger py-2 small mt-2 mb-0">{errorArca}</div>}
                  </>
                ) : (
                  <>
                    <div className="d-flex flex-wrap gap-3 mb-3">
                      <div className="p-2 rounded border flex-grow-1" style={{ minWidth: 140 }}>
                        <div className="text-muted small">Período comparado</div>
                        <div className="fw-semibold">{fmtF(resultadoArca.desde)} – {fmtF(resultadoArca.hasta)}</div>
                      </div>
                      <div className="p-2 rounded border" style={{ minWidth: 110 }}>
                        <div className="text-muted small">En ARCA</div>
                        <div className="fw-bold fs-5">{resultadoArca.totalArca}</div>
                      </div>
                      <div className="p-2 rounded border" style={{ minWidth: 110 }}>
                        <div className="text-muted small">Coinciden</div>
                        <div className="fw-bold fs-5 text-success">{resultadoArca.coinciden}</div>
                      </div>
                      <div className="p-2 rounded border" style={{ minWidth: 110 }}>
                        <div className="text-muted small">Faltan cargar</div>
                        <div className="fw-bold fs-5 text-danger">{resultadoArca.faltantes.length}</div>
                      </div>
                      <div className="p-2 rounded border" style={{ minWidth: 110 }}>
                        <div className="text-muted small">Diferencias</div>
                        <div className="fw-bold fs-5 text-warning">{resultadoArca.diferencias.length}</div>
                      </div>
                      <div className="p-2 rounded border" style={{ minWidth: 110 }}>
                        <div className="text-muted small">Sobran en sistema</div>
                        <div className="fw-bold fs-5 text-secondary">{resultadoArca.sobrantes.length}</div>
                      </div>
                    </div>
                    {resultadoArca.excluidasViejas > 0 && (
                      <p className="text-muted small">
                        <i className="bi bi-info-circle me-1" />
                        Se excluyeron {resultadoArca.excluidasViejas} comprobante{resultadoArca.excluidasViejas !== 1 ? 's' : ''} de
                        antes del 01/07/2026 (datos importados, no confiables para comparar).
                      </p>
                    )}

                    {resultadoArca.faltantes.length > 0 && (
                      <div className="mb-3">
                        <p className="fw-semibold text-danger mb-1"><i className="bi bi-exclamation-triangle-fill me-1" />Faltan cargar en el sistema</p>
                        <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                          <table className="table table-sm table-hover mb-0" style={{ fontSize: '0.78rem' }}>
                            <thead className="table-light sticky-top"><tr><th>Fecha</th><th>Tipo</th><th>N° Comprobante</th><th>Proveedor</th><th className="text-end">Importe</th></tr></thead>
                            <tbody>
                              {resultadoArca.faltantes.map((f, i) => (
                                <tr key={i}>
                                  <td style={{ whiteSpace: 'nowrap' }}>{fmtF(f.fecha)}</td>
                                  <td>{f.tipo}</td>
                                  <td className="font-monospace">{f.numero}</td>
                                  <td>{f.proveedor}</td>
                                  <td className="text-end">{fmtM(f.importe, f.moneda)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {resultadoArca.diferencias.length > 0 && (
                      <div className="mb-3">
                        <p className="fw-semibold text-warning mb-1"><i className="bi bi-exclamation-circle-fill me-1" />Diferencia de importe</p>
                        <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                          <table className="table table-sm table-hover mb-0" style={{ fontSize: '0.78rem' }}>
                            <thead className="table-light sticky-top"><tr><th>N° Factura</th><th>Proveedor</th><th className="text-end">ARCA</th><th className="text-end">Sistema</th><th className="text-end">Diferencia</th></tr></thead>
                            <tbody>
                              {resultadoArca.diferencias.map((d, i) => (
                                <tr key={i}>
                                  <td className="font-monospace">{d.numero}</td>
                                  <td>{d.proveedor}</td>
                                  <td className="text-end">{fmtM(d.importe_arca, 'PESO')}</td>
                                  <td className="text-end">{fmtM(d.importe_sistema, 'PESO')}</td>
                                  <td className={`text-end fw-semibold ${d.diferencia > 0 ? 'text-danger' : 'text-primary'}`}>{d.diferencia > 0 ? '+' : ''}{fmtM(d.diferencia, 'PESO')}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {resultadoArca.sobrantes.length > 0 && (
                      <div className="mb-2">
                        <p className="fw-semibold text-secondary mb-1"><i className="bi bi-question-circle-fill me-1" />En el sistema pero no en ARCA</p>
                        <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                          <table className="table table-sm table-hover mb-0" style={{ fontSize: '0.78rem' }}>
                            <thead className="table-light sticky-top"><tr><th>Fecha</th><th>N° Factura</th><th>Proveedor</th><th className="text-end">Importe</th></tr></thead>
                            <tbody>
                              {resultadoArca.sobrantes.map((s, i) => (
                                <tr key={i}>
                                  <td style={{ whiteSpace: 'nowrap' }}>{fmtF(s.fecha)}</td>
                                  <td className="font-monospace">{s.numero}</td>
                                  <td>{s.proveedor}</td>
                                  <td className="text-end">{fmtM(s.importe, 'PESO')}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {resultadoArca.faltantes.length === 0 && resultadoArca.diferencias.length === 0 && resultadoArca.sobrantes.length === 0 && (
                      <div className="text-center text-success py-4">
                        <i className="bi bi-check-circle display-6 d-block mb-2" />
                        No hay diferencias — todo lo de ARCA está cargado y coincide.
                      </div>
                    )}
                  </>
                )}
              </div>
              <div className="modal-footer py-2">
                {resultadoArca && (
                  <button className="btn btn-sm btn-outline-secondary me-auto" onClick={() => { setResultadoArca(null); setArchivoArca(null) }}>
                    <i className="bi bi-arrow-left me-1" />Comparar otro archivo
                  </button>
                )}
                <button className="btn btn-sm btn-secondary" onClick={() => setModalArca(false)}>Cerrar</button>
                {!resultadoArca && (
                  <button className="btn btn-sm btn-primary" onClick={compararArca} disabled={comparandoArca || !archivoArca}>
                    {comparandoArca ? <><span className="spinner-border spinner-border-sm me-1" />Comparando...</> : <><i className="bi bi-search me-1" />Comparar</>}
                  </button>
                )}
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
                      <input type="number" onPaste={manejarPegadoNumero} className="form-control form-control-sm" value={formV.oc_pct}
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
                      <input className="form-control form-control-sm" value={formV.numero} autoComplete="off"
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
                    {esNC(formV.tipo_factura) && (
                      <div className="col-md-12">
                        <label className="form-label small fw-semibold">Factura que anula *</label>
                        <FacturaAnulaSelector tabla="venta" excludeId={modalV !== 'new' ? modalV.id : null}
                          value={formV.nc_factura_id} valueLabel={formV.nc_factura_numero}
                          onChange={f => setFormV(p => ({ ...p, nc_factura_id: f ? f.id : '', nc_factura_numero: f ? f.numero : '' }))} />
                      </div>
                    )}
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
                        onChange={p => setFormV(prev => ({ ...prev, proyecto_id: p?.id || null, proyecto: p ? `${p.codigo} — ${p.nombre}` : '' }))}
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
                        <input type="number" onPaste={manejarPegadoNumero} className="form-control form-control-sm" value={formV.tasa_cambio}
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
                    <div className="col-md-3">
                      <label className="form-label small fw-semibold">Neto Gravado</label>
                      <input type="number" onPaste={manejarPegadoNumero} className="form-control form-control-sm" value={formV.neto_gravado}
                        onChange={e => setFormV(p => ({ ...p, neto_gravado: e.target.value }))} min="0" step="0.01" placeholder="0.00" />
                      {otraMoneda(formV.neto_gravado) && (
                        <div className="form-text" style={{ fontSize: '0.68rem' }}>≈ {otraMoneda(formV.neto_gravado)}</div>
                      )}
                    </div>
                    <div className="col-md-3">
                      <label className="form-label small fw-semibold">IVA 21%</label>
                      <div className="input-group input-group-sm">
                        <input type="number" onPaste={manejarPegadoNumero} className="form-control form-control-sm" value={formV.iva_21}
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
                    <div className="col-md-3">
                      <label className="form-label small fw-semibold">IVA 10.5%</label>
                      <div className="input-group input-group-sm">
                        <input type="number" onPaste={manejarPegadoNumero} className="form-control form-control-sm" value={formV.iva_10_5}
                          onChange={e => setFormV(p => ({ ...p, iva_10_5: e.target.value }))} min="0" step="0.01" placeholder="0.00" />
                        <button type="button" className="btn btn-outline-secondary px-2"
                          title="Calcular IVA 10.5% desde Neto"
                          onClick={() => setFormV(p => ({ ...p, iva_10_5: Math.round((parseFloat(p.neto_gravado)||0) * 0.105 * 100) / 100 }))}>
                          <i className="bi bi-calculator" style={{ fontSize: '0.72rem' }} />
                        </button>
                      </div>
                      {otraMoneda(formV.iva_10_5) && (
                        <div className="form-text" style={{ fontSize: '0.68rem' }}>≈ {otraMoneda(formV.iva_10_5)}</div>
                      )}
                    </div>
                    <div className="col-md-3">
                      <label className="form-label small fw-semibold">Total Factura</label>
                      <input type="number" onPaste={manejarPegadoNumero} className="form-control form-control-sm" value={formV.importe}
                        onChange={e => setFormV(p => ({ ...p, importe: e.target.value }))} min="0" step="0.01" placeholder="0.00" />
                      {otraMoneda(formV.importe) && (
                        <div className="form-text" style={{ fontSize: '0.68rem' }}>≈ {otraMoneda(formV.importe)}</div>
                      )}
                    </div>
                  </div>

                  <div className="row g-2 mb-3">
                    <div className="col-md-4">
                      <label className="form-label small fw-semibold">Total Cobrado</label>
                      <input type="number" onPaste={manejarPegadoNumero} className="form-control form-control-sm" value={formV.total_cobrado}
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
                  // Un E-CHEQ cuenta como cobrado apenas se registra (la factura queda saldada);
                  // el cheque en sí se sigue rastreando aparte como pendiente de acreditación
                  // hasta confirmarlo, pero ya no resta del saldo de la factura.
                  const confirmados = pagos.filter(p => p.estado === 'confirmado' || p.forma_pago === 'e-cheq')
                  const cobrado  = confirmados.reduce((s, p) => s + (p.importe||0), 0)
                  const retenido = confirmados.reduce((s, p) => s + totalPago(p) - totalEnPesos(p), 0)
                  const cheques  = pagos.filter(p => p.estado === 'pendiente' && p.forma_pago !== 'e-cheq').reduce((s, p) => s + totalEnPesos(p), 0)
                  const total    = totalEnPesos(pagosModal)
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
                        const ret = totalPago(p) - totalEnPesos(p)
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
                                {p.estado === 'pendiente' && canConfirmarPago && (
                                  <button className="btn btn-sm btn-outline-success py-0 px-1" title="Confirmar acreditación" onClick={() => confirmarPago(p)}>
                                    <i className="bi bi-check-lg" />
                                  </button>
                                )}
                                <button className="btn btn-sm btn-outline-primary py-0 px-1" title="Editar pago" onClick={() => abrirEditarPago(p)}>
                                  <i className="bi bi-pencil" />
                                </button>
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
                  <button className="btn btn-sm btn-outline-primary" onClick={() => { setPagoForm({ ...FORM_PAGO, moneda: pagosModal.moneda || 'PESO', tasa_cambio: pagosModal.tasa_cambio || 1 }); setEditandoPago(null); setMostrarForm(true) }}>
                    <i className="bi bi-plus-lg me-1" />Registrar pago
                  </button>
                )}
                {canWrite && mostrarForm && (
                  <div className="border rounded p-3" style={{ background: '#f8f9ff' }}>
                    <p className="small fw-semibold mb-2">{editandoPago ? 'Editar pago' : 'Nuevo pago'}</p>
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
                        <input type="number" onPaste={manejarPegadoNumero} className="form-control form-control-sm" value={pagoForm.importe}
                          onChange={e => setPagoForm(p => ({ ...p, importe: e.target.value }))}
                          min="0" step="0.01" placeholder="0.00" />
                      </div>
                      {pagoForm.moneda !== 'PESO' && pagoForm.moneda !== 'PESOS' && (
                        <div className="col-md-3">
                          <label className="form-label small">Tasa de cambio</label>
                          <input type="number" onPaste={manejarPegadoNumero} className="form-control form-control-sm" value={pagoForm.tasa_cambio}
                            onChange={e => setPagoForm(p => ({ ...p, tasa_cambio: e.target.value }))}
                            min="0" step="0.01" placeholder="1" />
                        </div>
                      )}
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
                          <input type="number" onPaste={manejarPegadoNumero} className="form-control form-control-sm" value={pagoForm[key]}
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
                    {pagoForm.forma_pago === 'e-cheq' && (
                      <p className="small text-info mb-2">
                        <i className="bi bi-info-circle me-1" />
                        La factura queda marcada como <strong>cobrada</strong>. El E-CHEQ se sigue viendo aparte, como pendiente de acreditación, hasta que lo confirmes.
                      </p>
                    )}
                    <div className="d-flex gap-2">
                      <button className="btn btn-sm btn-primary" onClick={agregarPago} disabled={pagoSaving}>
                        {pagoSaving ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="bi bi-check-lg me-1" />}
                        Guardar pago
                      </button>
                      <button className="btn btn-sm btn-outline-secondary" onClick={() => { setMostrarForm(false); setEditandoPago(null) }}>Cancelar</button>
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
                    <input type="number" onPaste={manejarPegadoNumero} className="form-control form-control-sm" value={formSaldo.monto}
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
            <div className="card mb-3" style={{ maxWidth: 560 }}>
              <div className="card-body py-3">
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h6 className="fw-bold mb-0"><i className="bi bi-currency-exchange me-2 text-success" />Tipo de Cambio BNA (Dólar y Euro)</h6>
                  <button className="btn btn-sm btn-outline-success" onClick={actualizarBNA} disabled={actualizandoBNA}
                    title="Trae del sitio del BNA la cotización Billetes (venta) de hoy para dólar y euro">
                    {actualizandoBNA ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="bi bi-cloud-download me-1" />}
                    Traer cotización de hoy
                  </button>
                </div>
                <div className="form-text mb-2">O cargala a mano si el sitio del BNA no responde:</div>
                <div className="row g-2 align-items-end">
                  <div className="col-sm-3">
                    <label className="form-label small fw-semibold mb-1">Moneda</label>
                    <select className="form-select form-select-sm" value={formTC.moneda}
                      onChange={e => setFormTC(p => ({ ...p, moneda: e.target.value }))}>
                      <option value="DÓLAR">Dólar</option>
                      <option value="EURO">Euro</option>
                    </select>
                  </div>
                  <div className="col-sm-3">
                    <label className="form-label small fw-semibold mb-1">Valor $</label>
                    <input type="number" onPaste={manejarPegadoNumero} className="form-control form-control-sm" value={formTC.valor}
                      onChange={e => setFormTC(p => ({ ...p, valor: e.target.value }))}
                      onKeyDown={e => e.key === 'Enter' && guardarTC()}
                      min="0" step="0.01" placeholder="Ej: 1250.00" />
                  </div>
                  <div className="col-sm-3">
                    <label className="form-label small fw-semibold mb-1">Fecha</label>
                    <DateInput className="form-control form-control-sm" value={formTC.fecha}
                      onChange={v => setFormTC(p => ({ ...p, fecha: v }))} />
                  </div>
                  <div className="col-sm-3">
                    <button className="btn btn-sm btn-success w-100" onClick={guardarTC} disabled={savTC}>
                      {savTC ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="bi bi-save me-1" />}
                      Registrar
                    </button>
                  </div>
                </div>
                {tcBNA.length > 0 && (
                  <div className="mt-3" style={{ fontSize: '0.82rem' }}>
                    <div className="fw-semibold text-muted mb-2" style={{ fontSize: '0.72rem', letterSpacing: '0.04em' }}>HISTORIAL</div>
                    {tcBNA.slice(0, 6).map(t => (
                      <div key={t.id} className="d-flex justify-content-between align-items-center py-1 border-bottom">
                        <span className="text-muted">{t.fecha || t.created_at?.slice(0,10)}</span>
                        <span className="badge bg-secondary-subtle text-secondary-emphasis">{t.moneda === 'EURO' ? 'EUR' : 'USD'}</span>
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
            <span className="text-muted small">Servicios recurrentes — pagos pendientes y pagados</span>
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
                <button className="btn btn-sm btn-primary" onClick={abrirCargarPago}>
                  <i className="bi bi-plus-lg me-1" />Cargar pago
                </button>
              )}
            </div>
          </div>

          {loadServ ? (
            <div className="text-center py-4 text-muted"><span className="spinner-border spinner-border-sm me-2" />Cargando...</div>
          ) : servCuotas.length === 0 ? (
            <div className="text-center py-5 text-muted">
              <i className="bi bi-lightning-charge display-6 d-block mb-2" />
              No hay pagos de servicios cargados todavía
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
                  {servCuotas.filter(c => {
                    const hoy = hoyLocal()
                    const pendiente = c.estado === 'pendiente'
                    const vencido   = pendiente && c.vencimiento && c.vencimiento < hoy
                    if (filtServ.estado === 'pendiente' && !pendiente) return false
                    if (filtServ.estado === 'vencido'   && !vencido)   return false
                    if (filtServ.estado === 'pagado'    && pendiente)  return false
                    if (filtServ.periodicidad && c.periodicidad !== filtServ.periodicidad) return false
                    if (filtServ.buscar) {
                      const q = filtServ.buscar.toLowerCase()
                      if (!c.descripcion?.toLowerCase().includes(q) && !c.usuario?.toLowerCase().includes(q)) return false
                    }
                    return true
                  }).map(c => {
                    const pendiente = c.estado === 'pendiente'
                    return (
                      <tr key={c.id}>
                        <td className="fw-semibold">
                          {c.descripcion}
                          {!c.servicio_activo && <span className="badge bg-light text-muted border ms-2" style={{ fontSize: '0.65rem' }}>Inactivo</span>}
                        </td>
                        <td><span className="badge bg-light text-dark border">{c.periodicidad}</span></td>
                        <td>
                          <div>{c.usuario || '—'}</div>
                          {c.info_pago && <div className="text-muted" style={{ fontSize: '0.75rem' }}>{c.info_pago}</div>}
                        </td>
                        <td className="text-end fw-semibold">{fmtM(c.monto, 'PESO')}</td>
                        <td className={vctoColor(c.vencimiento, !pendiente)}>{fmtF(c.vencimiento)}</td>
                        <td>
                          {!pendiente ? (
                            <span className="badge bg-success">
                              <i className="bi bi-check2 me-1" />Pagado {fmtF(c.fecha_pagada)}
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
                              {pendiente && (
                                <button className="btn btn-sm btn-outline-success py-0 px-2"
                                  style={{ fontSize: '0.72rem' }}
                                  disabled={pagandoId === c.id}
                                  onClick={() => pagarCuota(c)}>
                                  {pagandoId === c.id
                                    ? <span className="spinner-border spinner-border-sm" />
                                    : <><i className="bi bi-check2-circle me-1" />Pagar</>}
                                </button>
                              )}
                              <button className="btn btn-sm btn-outline-secondary py-0 px-1" title="Editar monto/vencimiento de este pago"
                                onClick={() => abrirEditarCuota(c)}>
                                <i className="bi bi-cash-coin" />
                              </button>
                              <button className="btn btn-sm btn-outline-primary py-0 px-1" title="Editar servicio"
                                onClick={() => { setFormServ({ descripcion: c.descripcion, usuario: c.usuario||'', info_pago: c.info_pago||'', periodicidad: c.periodicidad }); setModalServ({ id: c.servicio_id, descripcion: c.descripcion }) }}>
                                <i className="bi bi-pencil" />
                              </button>
                              <button className="btn btn-sm btn-outline-danger py-0 px-1" title="Eliminar este pago"
                                onClick={() => eliminarCuota(c)}>
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

      {/* ── MODAL CARGAR PAGO ── */}
      {modalPago && (
        <div className="modal d-block" style={{ background: 'rgba(0,0,0,.45)', zIndex: 1060 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h6 className="modal-title fw-bold"><i className="bi bi-lightning-charge me-2" />Cargar pago de servicio</h6>
                <button className="btn-close btn-sm" onClick={() => setModalPago(false)} />
              </div>
              <div className="modal-body" style={{ fontSize: '0.87rem' }}>
                <div className="mb-2">
                  <label className="form-label small fw-semibold">Servicio *</label>
                  {!nuevoServ ? (
                    <div className="d-flex gap-1">
                      <select className="form-select form-select-sm" value={formPago.servicio_id}
                        onChange={e => setFormPago(p => ({ ...p, servicio_id: e.target.value }))} autoFocus>
                        <option value="">— Seleccionar servicio —</option>
                        {servicios.map(s => <option key={s.id} value={s.id}>{s.descripcion}</option>)}
                      </select>
                      <button className="btn btn-sm btn-outline-success flex-shrink-0" title="Nuevo servicio"
                        onClick={() => setNuevoServ(true)}>
                        <i className="bi bi-plus-lg" />
                      </button>
                    </div>
                  ) : (
                    <div className="border rounded p-2" style={{ background: '#f8f9ff' }}>
                      <div className="d-flex justify-content-between align-items-center mb-2">
                        <span className="small fw-semibold text-muted">Nuevo servicio</span>
                        <button className="btn btn-sm btn-outline-secondary py-0 px-2" onClick={() => setNuevoServ(false)}>Cancelar</button>
                      </div>
                      <div className="mb-2">
                        <input className="form-control form-control-sm" value={nuevoServForm.descripcion}
                          onChange={e => setNuevoServForm(p => ({ ...p, descripcion: e.target.value }))}
                          placeholder="Ej: EDENOR Burzaco 6363" autoFocus />
                      </div>
                      <div className="row g-2 mb-2">
                        <div className="col-md-6">
                          <select className="form-select form-select-sm" value={nuevoServForm.periodicidad}
                            onChange={e => setNuevoServForm(p => ({ ...p, periodicidad: e.target.value }))}>
                            {PERIODICIDADES.map(p => <option key={p} value={p}>{p}</option>)}
                          </select>
                        </div>
                        <div className="col-md-6">
                          <input className="form-control form-control-sm" value={nuevoServForm.usuario}
                            onChange={e => setNuevoServForm(p => ({ ...p, usuario: e.target.value }))}
                            placeholder="Usuario / email" />
                        </div>
                      </div>
                      <div className="d-flex gap-2 align-items-center">
                        <input className="form-control form-control-sm" value={nuevoServForm.info_pago}
                          onChange={e => setNuevoServForm(p => ({ ...p, info_pago: e.target.value }))}
                          placeholder="Datos de pago (código, CBU...)" />
                        <button className="btn btn-sm btn-primary flex-shrink-0" disabled={savServ} onClick={crearServicioYUsarlo}>
                          {savServ ? <span className="spinner-border spinner-border-sm" /> : 'Crear'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="row g-2 mb-2">
                  <div className="col-md-6">
                    <label className="form-label small fw-semibold">Monto *</label>
                    <input type="number" onPaste={manejarPegadoNumero} min="0" step="0.01" className="form-control form-control-sm" value={formPago.monto}
                      onChange={e => setFormPago(p => ({ ...p, monto: e.target.value }))} placeholder="0.00" />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small fw-semibold">Vencimiento</label>
                    <DateInput className="form-control form-control-sm" value={formPago.vencimiento}
                      onChange={v => setFormPago(p => ({ ...p, vencimiento: v }))} />
                  </div>
                </div>
                <div className="form-check mb-2">
                  <input className="form-check-input" type="checkbox" id="pagoYaPagado"
                    checked={formPago.pagado}
                    onChange={e => setFormPago(p => ({ ...p, pagado: e.target.checked, fecha_pagada: e.target.checked ? (p.fecha_pagada || hoyLocal()) : '' }))} />
                  <label className="form-check-label small" htmlFor="pagoYaPagado">Ya está pagado</label>
                </div>
                {formPago.pagado && (
                  <div className="mb-0">
                    <label className="form-label small fw-semibold">Fecha de pago</label>
                    <DateInput className="form-control form-control-sm" value={formPago.fecha_pagada}
                      onChange={v => setFormPago(p => ({ ...p, fecha_pagada: v }))} />
                  </div>
                )}
              </div>
              <div className="modal-footer py-2">
                <button className="btn btn-sm btn-secondary" onClick={() => setModalPago(false)}>Cancelar</button>
                <button className="btn btn-sm btn-primary" onClick={guardarPago} disabled={savPago}>
                  {savPago ? <><span className="spinner-border spinner-border-sm me-1" />Guardando...</> : 'Guardar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL EDITAR SERVICIO ── */}
      {modalServ && (
        <div className="modal d-block" style={{ background: 'rgba(0,0,0,.45)', zIndex: 1060 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h6 className="modal-title fw-bold"><i className="bi bi-lightning-charge me-2" />Editar servicio</h6>
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
              </div>
              <div className="modal-footer py-2 justify-content-between">
                <button className="btn btn-sm btn-outline-danger" onClick={() => { desactivarServ(modalServ); setModalServ(null) }}>
                  <i className="bi bi-slash-circle me-1" />Desactivar servicio
                </button>
                <div className="d-flex gap-2">
                  <button className="btn btn-sm btn-secondary" onClick={() => setModalServ(null)}>Cancelar</button>
                  <button className="btn btn-sm btn-primary" onClick={guardarServ} disabled={savServ}>
                    {savServ ? <><span className="spinner-border spinner-border-sm me-1" />Guardando...</> : 'Guardar'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL EDITAR MONTO/VENCIMIENTO DE UN PAGO DE SERVICIO ── */}
      {modalCuota && (
        <div className="modal d-block" style={{ background: 'rgba(0,0,0,.45)', zIndex: 1060 }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header py-2">
                <h6 className="modal-title fw-bold"><i className="bi bi-cash-coin me-2" />Editar pago — {modalCuota.descripcion}</h6>
                <button className="btn-close btn-sm" onClick={() => setModalCuota(null)} />
              </div>
              <div className="modal-body" style={{ fontSize: '0.87rem' }}>
                <div className="row g-2">
                  <div className="col-md-6">
                    <label className="form-label small fw-semibold">Monto *</label>
                    <input type="number" onPaste={manejarPegadoNumero} min="0" step="0.01" className="form-control form-control-sm" value={formCuota.monto}
                      onChange={e => setFormCuota(p => ({ ...p, monto: e.target.value }))} autoFocus />
                  </div>
                  <div className="col-md-6">
                    <label className="form-label small fw-semibold">Vencimiento</label>
                    <input type="date" className="form-control form-control-sm" value={formCuota.vencimiento}
                      onChange={e => setFormCuota(p => ({ ...p, vencimiento: e.target.value }))} />
                  </div>
                </div>
              </div>
              <div className="modal-footer py-2">
                <button className="btn btn-sm btn-secondary" onClick={() => setModalCuota(null)}>Cancelar</button>
                <button className="btn btn-sm btn-primary" onClick={guardarCuota} disabled={savCuota}>
                  {savCuota ? <><span className="spinner-border spinner-border-sm me-1" />Guardando...</> : 'Guardar'}
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
              <span className="text-muted small ms-2">(diferencia &gt; 3% del neto de la OC, valor sin impuestos)</span>
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
                    <th className="text-end">Diferencia ($ / %)</th>
                    <th className="text-center">Moneda OC</th>
                  </tr>
                </thead>
                <tbody>
                  {ctrlOC.map(r => {
                    const diff = (r.facturas_neto_total || 0) - (r.oc_neto_pesos || 0)
                    const esPeso = r.oc_moneda === 'PESOS' || r.oc_moneda === 'PESO'
                    const tcValido = !!r.oc_tc_valido
                    const origenTC = r.oc_tc_manual ? 'manual'
                      : r.oc_tc_dia ? 'dia'
                      : r.oc_tc_original > 0 ? 'oc' : null
                    const pctDiff = r.oc_neto_pesos > 0 ? Math.abs(diff) / r.oc_neto_pesos * 100 : null
                    return (
                      <tr key={r.oc_id} className={!tcValido ? 'table-info' : pctDiff > 10 ? 'table-danger' : 'table-warning'}>
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
                          {tcValido
                            ? fmtM(r.oc_neto_pesos, 'PESO')
                            : <span className="text-muted">—</span>}
                          {!esPeso && (
                            <div className={tcValido ? 'text-muted' : 'text-danger fw-semibold'} style={{ fontSize: '0.72rem' }}>
                              {tcValido
                                ? `${r.oc_moneda === 'DÓLAR' ? 'USD' : r.oc_moneda} ${fmtM(r.oc_neto_orig, r.oc_moneda)} × ${(r.oc_tc_usado||1).toLocaleString('es-AR')}`
                                : `⚠️ Sin TC cargado (${r.oc_moneda === 'DÓLAR' ? 'USD' : r.oc_moneda} ${fmtM(r.oc_neto_orig, r.oc_moneda)})`}
                            </div>
                          )}
                          {!esPeso && tcValido && (
                            <div className="text-muted fst-italic" style={{ fontSize: '0.68rem' }}>
                              {origenTC === 'manual' ? 'TC manual' : origenTC === 'dia' ? `TC del día (${fmtF(r.fecha_ultima)})` : 'TC cargado en la OC'}
                            </div>
                          )}
                        </td>
                        <td className="text-end">{fmtM(r.facturas_neto_total, 'PESO')}</td>
                        <td className={`text-end fw-bold ${!tcValido ? 'text-muted' : diff > 0 ? 'text-danger' : 'text-success'}`}>
                          <span
                            style={!esPeso ? { cursor: 'pointer' } : undefined}
                            title={!esPeso ? 'Click para ajustar el tipo de cambio usado en esta OC' : undefined}
                            onClick={() => { if (!esPeso) setEditTC({ oc_id: r.oc_id, oc_numero: r.oc_numero, valor: r.oc_tc_manual || '' }) }}>
                            {tcValido
                              ? <>{diff > 0 ? '+' : ''}{fmtM(diff, 'PESO')} {pctDiff != null && <span className="fw-normal" style={{ fontSize: '0.72rem' }}>({pctDiff.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%)</span>}</>
                              : 'TC no cargado en la OC'}
                            {!esPeso && <i className="bi bi-pencil-square ms-1 text-muted" style={{ fontSize: '0.7rem' }} />}
                          </span>
                          {!esPeso && r.oc_neto_orig > 0 && diff !== 0 && (
                            <button className="btn btn-sm btn-outline-primary py-0 px-1 ms-2" style={{ fontSize: '0.68rem' }}
                              disabled={savingTC}
                              title="Ajustar el TC de esta OC para que coincida exactamente con lo facturado"
                              onClick={() => autocorregirTC(r)}>
                              <i className="bi bi-magic me-1" />Autocorregir
                            </button>
                          )}
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
                    <td colSpan={3}>
                      {ctrlOC.filter(r => r.oc_tc_valido).length} OC{ctrlOC.filter(r => r.oc_tc_valido).length !== 1 ? 's' : ''} con diferencia
                      {ctrlOC.some(r => !r.oc_tc_valido) && (
                        <span className="text-muted fw-normal ms-2">
                          ({ctrlOC.filter(r => !r.oc_tc_valido).length} sin TC cargado, excluida{ctrlOC.filter(r => !r.oc_tc_valido).length !== 1 ? 's' : ''} del total)
                        </span>
                      )}
                    </td>
                    <td className="text-end">{fmtM(ctrlOC.filter(r => r.oc_tc_valido).reduce((s, r) => s + (r.oc_neto_pesos || 0), 0), 'PESO')}</td>
                    <td className="text-end">{fmtM(ctrlOC.filter(r => r.oc_tc_valido).reduce((s, r) => s + (r.facturas_neto_total || 0), 0), 'PESO')}</td>
                    <td className="text-end">{fmtM(ctrlOC.filter(r => r.oc_tc_valido).reduce((s, r) => s + ((r.facturas_neto_total||0) - (r.oc_neto_pesos||0)), 0), 'PESO')}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            )}
          </div>

          {editTC && (
            <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
              <div className="modal-dialog modal-sm">
                <div className="modal-content">
                  <div className="modal-header py-2">
                    <h6 className="modal-title">Ajustar TC — OC #{editTC.oc_numero}</h6>
                    <button className="btn-close" onClick={() => setEditTC(null)} />
                  </div>
                  <div className="modal-body">
                    <label className="form-label small fw-semibold">Tipo de cambio a usar para esta OC</label>
                    <input type="number" onPaste={manejarPegadoNumero} min="0" step="0.01" className="form-control form-control-sm"
                      placeholder="Ej: 1510"
                      value={editTC.valor}
                      onChange={e => setEditTC(x => ({ ...x, valor: e.target.value }))} />
                    <div className="text-muted mt-2" style={{ fontSize: '0.75rem' }}>
                      Dejalo vacío y guardá para volver a usar el TC del día / el cargado en la OC.
                    </div>
                  </div>
                  <div className="modal-footer py-2">
                    <button className="btn btn-secondary btn-sm" onClick={() => setEditTC(null)}>Cancelar</button>
                    <button className="btn btn-primary btn-sm" disabled={savingTC} onClick={guardarTCManual}>
                      {savingTC ? <><span className="spinner-border spinner-border-sm me-1" />Guardando...</> : 'Guardar'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB SEGUIMIENTO OC COMPRAS (solo lectura) ── */}
      {tab === 'seguimiento-compras' && (() => {
        const abiertas = segCompras.filter(r => r.estado !== 'Cancelada' && !(r.estado_facturacion === 'completo' && r.estado_pago === 'pagado'))
        const montoPendienteFacturar = abiertas.reduce((s, r) => s + Math.max(0, (r.oc_neto_pesos || 0) - (r.facturas_neto_total || 0)), 0)
        const montoPendientePago = abiertas.filter(r => r.estado_pago === 'pendiente' || r.estado_pago === 'parcial')
          .reduce((s, r) => s + (r.facturas_neto_total || 0), 0)
        const atrasadas = segCompras.filter(r => r.atrasada)
        const FACT_LABEL = { sin_facturar: { txt: 'Sin facturar', cls: 'bg-secondary' }, parcial: { txt: 'Parcial', cls: 'bg-warning text-dark' }, completo: { txt: 'Completo', cls: 'bg-success' } }
        const PAGO_LABEL = { sin_facturar: { txt: '—', cls: 'bg-secondary' }, pendiente: { txt: 'Pendiente', cls: 'bg-danger' }, parcial: { txt: 'Parcial', cls: 'bg-warning text-dark' }, pagado: { txt: 'Pagado', cls: 'bg-success' } }
        const RECEPCION_CLS = { Emitida: 'bg-secondary', Parcial: 'bg-warning text-dark', Recibida: 'bg-success', Cancelada: 'bg-dark' }
        return (
        <div className="flex-grow-1 d-flex flex-column overflow-hidden">
          <p className="text-muted small mb-2">
            Panorama de todas las OC de compras — no importa si ya fueron recibidas o no, sino cómo viene su ciclo de facturación y pago.
          </p>

          {/* KPIs */}
          <div className="row g-2 mb-3">
            {[
              { label: 'OC abiertas',                valor: abiertas.length,                       icon: 'truck',              color: '#0d6efd' },
              { label: 'Atrasadas (entrega vencida)', valor: atrasadas.length,                       icon: 'exclamation-triangle', color: '#dc3545' },
              { label: 'Pendiente de facturar',        valor: fmtM(montoPendienteFacturar, 'PESO'),  icon: 'receipt',            color: '#fd7e14' },
              { label: 'Facturado pendiente de pago',  valor: fmtM(montoPendientePago, 'PESO'),      icon: 'cash-coin',          color: '#6f42c1' },
            ].map(k => (
              <div className="col-md-3" key={k.label}>
                <div className="p-2 rounded border h-100" style={{ borderLeft: `4px solid ${k.color}` }}>
                  <div className="text-muted small"><i className={`bi bi-${k.icon} me-1`} />{k.label}</div>
                  <div className="fs-5 fw-bold">{k.valor}</div>
                </div>
              </div>
            ))}
          </div>

          {/* Filtros */}
          <div className="d-flex gap-2 mb-3 flex-wrap align-items-center">
            <input className="form-control form-control-sm" style={{ width: 220 }} placeholder="Buscar N° OC o proveedor..."
              value={filtSegCompras.buscar} onChange={e => setFiltSegCompras(p => ({ ...p, buscar: e.target.value }))} />
            <select className="form-select form-select-sm" style={{ width: 150 }}
              value={filtSegCompras.estado} onChange={e => setFiltSegCompras(p => ({ ...p, estado: e.target.value }))}>
              <option value="">Recepción: todas</option>
              <option value="Emitida">Emitida</option>
              <option value="Parcial">Parcial</option>
              <option value="Recibida">Recibida</option>
              <option value="Cancelada">Cancelada</option>
            </select>
            <select className="form-select form-select-sm" style={{ width: 170 }}
              value={filtSegCompras.estado_facturacion} onChange={e => setFiltSegCompras(p => ({ ...p, estado_facturacion: e.target.value }))}>
              <option value="">Facturación: todas</option>
              <option value="sin_facturar">Sin facturar</option>
              <option value="parcial">Parcial</option>
              <option value="completo">Completo</option>
            </select>
            <select className="form-select form-select-sm" style={{ width: 150 }}
              value={filtSegCompras.estado_pago} onChange={e => setFiltSegCompras(p => ({ ...p, estado_pago: e.target.value }))}>
              <option value="">Pago: todos</option>
              <option value="pendiente">Pendiente</option>
              <option value="parcial">Parcial</option>
              <option value="pagado">Pagado</option>
            </select>
            {(filtSegCompras.buscar || filtSegCompras.estado || filtSegCompras.estado_facturacion || filtSegCompras.estado_pago) && (
              <button className="btn btn-sm btn-outline-secondary" onClick={() => setFiltSegCompras({ estado: '', estado_facturacion: '', estado_pago: '', buscar: '' })}>
                <i className="bi bi-x" />
              </button>
            )}
            <SelectorColumnas columnas={COLS_SEG_COMPRAS} visible={colsSegComp.visible} onToggle={colsSegComp.toggle} />
          </div>

          <div className="flex-grow-1 overflow-auto">
            {loadSegCompras ? (
              <div className="text-center text-muted py-5"><span className="spinner-border spinner-border-sm me-2" />Cargando...</div>
            ) : segCompras.length === 0 ? (
              <div className="text-center text-muted py-5"><i className="bi bi-inbox display-6 d-block mb-2" />Sin OC que coincidan</div>
            ) : (
              <table className="table table-sm table-hover align-middle mb-0" style={{ fontSize: '0.8rem' }}>
                <thead className="table-light">
                  <tr>
                    {colsSegComp.visible('oc') && <th>OC</th>}
                    {colsSegComp.visible('proveedor') && <th>Proveedor</th>}
                    {colsSegComp.visible('fecha') && <th>Fecha</th>}
                    {colsSegComp.visible('entrega') && <th>Entrega est.</th>}
                    {colsSegComp.visible('recepcion') && <th>Recepción</th>}
                    {colsSegComp.visible('neto') && <th className="text-end">Neto OC</th>}
                    {colsSegComp.visible('facturacion') && <th>Facturación</th>}
                    {colsSegComp.visible('pct_facturado') && <th className="text-end">% Facturado</th>}
                    {colsSegComp.visible('pago') && <th>Pago</th>}
                    {colsSegComp.visible('pct_pagado') && <th className="text-end">% Pagado</th>}
                    {colsSegComp.visible('ultima_factura') && <th>Última factura</th>}
                  </tr>
                </thead>
                <tbody>
                  {segComprasPagina.map(r => (
                    <tr key={r.oc_id} style={{ cursor: 'pointer' }} title="Abrir OC"
                      onClick={() => navigate('/compras', { state: { abrirOcId: r.oc_id } })}>
                      {colsSegComp.visible('oc') && <td className="fw-semibold text-primary">{r.oc_numero}</td>}
                      {colsSegComp.visible('proveedor') && <td style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.proveedor_nombre}>{r.proveedor_nombre || '—'}</td>}
                      {colsSegComp.visible('fecha') && <td style={{ whiteSpace: 'nowrap' }}>{fmtF(r.fecha)}</td>}
                      {colsSegComp.visible('entrega') && <td style={{ whiteSpace: 'nowrap' }} className={r.atrasada ? 'text-danger fw-semibold' : ''}>
                        {fmtF(r.fecha_entrega_est)}{r.atrasada && <i className="bi bi-exclamation-triangle-fill ms-1" title="Entrega vencida" />}
                      </td>}
                      {colsSegComp.visible('recepcion') && <td><span className={`badge ${RECEPCION_CLS[r.estado] || 'bg-secondary'}`} style={{ fontSize: '0.68rem' }}>{r.estado}</span></td>}
                      {colsSegComp.visible('neto') && <td className="text-end">{fmtM(r.oc_neto_pesos, 'PESO')}</td>}
                      {colsSegComp.visible('facturacion') && <td><span className={`badge ${FACT_LABEL[r.estado_facturacion].cls}`} style={{ fontSize: '0.68rem' }}>{FACT_LABEL[r.estado_facturacion].txt}</span></td>}
                      {colsSegComp.visible('pct_facturado') && <td className="text-end">{r.pct_facturado}%</td>}
                      {colsSegComp.visible('pago') && <td><span className={`badge ${PAGO_LABEL[r.estado_pago].cls}`} style={{ fontSize: '0.68rem' }}>{PAGO_LABEL[r.estado_pago].txt}</span></td>}
                      {colsSegComp.visible('pct_pagado') && <td className="text-end">{r.pct_pagado}%</td>}
                      {colsSegComp.visible('ultima_factura') && <td style={{ whiteSpace: 'nowrap' }}>{fmtF(r.fecha_ultima)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <Paginador pagina={pagSegCompras} setPagina={setPagSegCompras} total={segCompras.length} />
        </div>
        )
      })()}

      {/* ── TAB OC CLIENTES ── */}
      {tab === 'oc-clientes' && (
        <FinanzasOCClientes canWrite={canWrite} abrirOcId={abrirOcClienteId} onAbierto={() => setAbrirOcClienteId(null)} />
      )}

      {/* ── TAB SEGUIMIENTO OC VENTAS (solo lectura) ── */}
      {tab === 'seguimiento-ventas' && (() => {
        const hoyISO = hoyLocal()
        const resumen = Object.keys(ESTADO_LABEL).map(k => {
          const filas = segVentas.filter(r => estadoFila(r) === k)
          return { estado: k, cantidad: filas.length, monto: filas.reduce((s, r) => s + (parseFloat(r.monto_oc) || 0), 0) }
        })
        return (
        <div className="flex-grow-1 d-flex flex-column overflow-hidden">
          <p className="text-muted small mb-2">
            Seguimiento gerencial de las OC de clientes — para cargar o editar los datos de una OC, usar la solapa "OC Clientes".
          </p>

          {/* KPIs por estado */}
          <div className="row g-2 mb-3">
            {resumen.map(r => (
              <div className="col-md-2" key={r.estado} style={{ minWidth: 150 }}>
                <div className="p-2 rounded border h-100">
                  <div><span className={`badge ${ESTADO_LABEL[r.estado].cls}`} style={{ fontSize: '0.68rem' }}>{ESTADO_LABEL[r.estado].txt}</span></div>
                  <div className="fs-5 fw-bold mt-1">{r.cantidad}</div>
                  <div className="text-muted" style={{ fontSize: '0.72rem' }}>{fmtM(r.monto, 'DÓLAR')}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="d-flex gap-2 mb-3 flex-wrap align-items-center">
            <select className="form-select form-select-sm" style={{ width: 190 }}
              value={filtSegVentas} onChange={e => setFiltSegVentas(e.target.value)}>
              <option value="">Todos los estados</option>
              {Object.entries(ESTADO_LABEL).map(([k, v]) => <option key={k} value={k}>{v.txt}</option>)}
            </select>
            {filtSegVentas && (
              <button className="btn btn-sm btn-outline-secondary" onClick={() => setFiltSegVentas('')}><i className="bi bi-x" /></button>
            )}
            <span className="text-muted small">{segVentasFiltradas.length} registros</span>
          </div>

          <div className="flex-grow-1 overflow-auto">
            {loadSegVentas ? (
              <div className="text-center text-muted py-5"><span className="spinner-border spinner-border-sm me-2" />Cargando...</div>
            ) : segVentasFiltradas.length === 0 ? (
              <div className="text-center text-muted py-5"><i className="bi bi-inbox display-6 d-block mb-2" />Sin registros</div>
            ) : (
              <table className="table table-sm table-hover align-middle mb-0" style={{ fontSize: '0.8rem' }}>
                <thead className="table-light">
                  <tr>
                    <th>Cliente</th><th>Proyecto</th><th>N° OC</th><th className="text-end">Monto OC</th>
                    <th>Estado</th><th className="text-end">% Facturado</th><th className="text-end">% Cobrado</th>
                    <th>Fecha OC</th><th className="text-end">Atraso</th>
                  </tr>
                </thead>
                <tbody>
                  {segVentasPagina.map(r => {
                    const est = estadoFila(r)
                    const atraso = diasAtrasoOC(r, hoyISO)
                    const atrasada = atraso != null
                    return (
                      <tr key={r.id} className={atrasada ? 'table-danger' : ''} style={{ cursor: 'pointer' }} title="Abrir OC"
                        onClick={() => { setAbrirOcClienteId(r.id); setTab('oc-clientes') }}>
                        <td className="fw-semibold">{r.cliente || '—'}</td>
                        <td>{r.proy_codigo
                          ? <span className="badge bg-secondary" style={{ fontSize: '0.7rem', fontFamily: 'monospace' }} title={r.proy_nombre}>{r.proy_codigo}</span>
                          : <span className="text-muted">—</span>}</td>
                        <td className="fw-semibold text-primary">{r.numero_oc || '—'}</td>
                        <td className="text-end">{fmtM(r.monto_oc, 'DÓLAR')}</td>
                        <td><span className={`badge ${ESTADO_LABEL[est].cls}`} style={{ fontSize: '0.68rem' }}>{ESTADO_LABEL[est].txt}</span></td>
                        <td className="text-end">{pctFacturado(r)}%</td>
                        <td className="text-end">{pctCobrado(r)}%</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtF(r.fecha_oc)}</td>
                        <td className={`text-end ${atrasada ? 'fw-semibold text-danger' : 'text-muted'}`}>
                          {atrasada ? `${atraso} día${atraso !== 1 ? 's' : ''}` : '—'}
                          {atrasada && <i className="bi bi-exclamation-triangle-fill ms-1" title="Tiene una cuota vencida sin cobrar según su plazo pactado" />}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
          <Paginador pagina={pagSegVentas} setPagina={setPagSegVentas} total={segVentasFiltradas.length} />
        </div>
        )
      })()}

    </div>
  )
}
