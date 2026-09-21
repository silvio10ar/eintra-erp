import { useState, useEffect, useCallback, useRef } from 'react'
import api from '../../api/client'
import { getPermisos, getUser } from '../../store/authStore'
import EmpleadoSelect from '../../components/EmpleadoSelect'
import DateInput from '../../components/DateInput'
import Finanzas from '../finanzas/Finanzas'
import FusionProveedores from './FusionProveedores'
import FacturaIA from '../compras/FacturaIA'
import { formatCuit } from '../../utils/cuit'
import { hoyLocal } from '../../utils/fecha'
import { manejarPegadoNumero } from '../../utils/numero'
import { MONTO_OCULTO, esMontoOculto } from '../../utils/montoOculto'

const CONDICIONES_PAGO = [
  'TRANSF. BANCARIA', 'CHEQUE', 'EFECTIVO', 'CUENTA CORRIENTE',
  '30 DÍAS', '60 DÍAS', '90 DÍAS', 'CONTADO',
]

const CATEGORIAS_PROVISION = ['Insumos', 'Equipos', 'Servicios', 'Materia Prima', 'Herramientas', 'Logística', 'Otros']
const FRECUENCIAS_EVAL     = ['Anual', 'Semestral', 'Trimestral', 'Por proyecto']

const PROV_VACIO = {
  nombre: '', cuit: '', contacto: '', telefono: '', email: '',
  direccion: '', localidad: '', cp: '', vendedor: '', condicion_pago: 'TRANSF. BANCARIA',
  critico: 0,
  categoria_provision: '', fecha_seleccion: '', frecuencia_evaluacion: 'Anual',
  responsable_seleccion: '', responsable_evaluacion: '',
}

const CLI_VACIO = {
  nombre: '', codigo: '', cuit: '', contacto: '', telefono: '', email: '',
  direccion: '', localidad: '', cp: '', condicion_pago: '',
}

// Solapas de primer nivel — sin anidar: lo que antes vivía escondido detrás de
// una segunda fila de tabs dentro de "Facturas" (Saldos, Servicios, Control OC,
// OC Clientes) ahora es un ítem más de esta misma barra.
// Bancos con cuenta real (la empresa no opera con Santander) — mismo criterio
// que BANCOS en finanzas/Finanzas.jsx, se exige su saldo del día antes de
// habilitar el resto del módulo.
const BANCOS_REQUERIDOS = ['Banco ICBC', 'Banco Galicia']
// El Control OC (conciliación de órdenes de compra vs. facturas recibidas) es
// tarea de Finanzas, no de Administración — Administración solo carga OCs
// (de clientes); por eso 'control' no forma parte de esta barra, y vive
// únicamente en el módulo Finanzas standalone.
const TABS_ORDEN = ['proveedores', 'clientes', 'compras', 'ventas', 'saldos', 'servicios', 'polizas', 'oc-clientes', 'oc-sin-factura', 'pedidos-precio']
const TABS_FINANZAS = ['compras', 'ventas', 'saldos', 'servicios', 'polizas', 'oc-clientes']
const TAB_INFO = {
  proveedores:   { icon: 'truck',              label: 'Proveedores',        subt: 'Altas, contactos y condiciones de pago' },
  clientes:      { icon: 'person-lines-fill',   label: 'Clientes',          subt: 'Datos comerciales y condiciones de pago' },
  compras:       { icon: 'cart3',               label: 'Facturas de Compra', subt: 'Carga y seguimiento de pagos a proveedores', badge: 'bg-secondary' },
  ventas:        { icon: 'shop',                label: 'Facturas de Venta', subt: 'Carga y seguimiento de cobros a clientes', badge: 'bg-secondary' },
  saldos:        { icon: 'bank',                label: 'Tesorería',         subt: 'Saldos bancarios y tipo de cambio' },
  servicios:     { icon: 'lightning-charge',    label: 'Servicios',        subt: 'Pagos recurrentes y sus vencimientos', badge: 'bg-warning text-dark' },
  polizas:       { icon: 'shield-check',        label: 'Pólizas',          subt: 'Pólizas de seguro y sus cuotas de renovación' },
  'oc-clientes': { icon: 'file-earmark-text',   label: 'OC Clientes',      subt: 'Anticipos y saldos finales por proyecto' },
  'oc-sin-factura': { icon: 'exclamation-triangle', label: 'OC sin factura', subt: 'Órdenes de compra a las que todavía no se les cargó ninguna factura', badge: 'bg-danger' },
  'pedidos-precio': { icon: 'cash-coin',        label: 'Pedidos de precio', subt: 'Materiales que pidieron desde Materiales o Análisis de Proyectos para cargarles el precio', badge: 'bg-warning text-dark' },
}

export default function Administracion() {
  const user      = getUser()
  const permisos  = getPermisos()
  const canWrite  = user?.rol === 'admin' || !!permisos?.compras?.escribir || !!permisos?.administracion?.escribir
  const esAdmin   = user?.rol === 'admin'
  // Quien también tiene acceso a Finanzas ya maneja el tipo de cambio y los
  // saldos por su cuenta (o sabe que otro los va a cargar) — a esos usuarios
  // no tiene sentido bloquearlos sin salida, por eso pueden omitir el control diario.
  const esFinanzas = user?.rol === 'admin' || !!permisos?.finanzas?.leer || !!permisos?.finanzas?.escribir

  const [tab, setTab]             = useState('proveedores')
  const [counts, setCounts]       = useState({})   // conteos que expone Finanzas embebido, por key de tab
  const [modalFacturaIA, setModalFacturaIA] = useState(null)  // null | 'compra' | 'venta'
  const [gateOmitido, setGateOmitido] = useState(false)

  // ── Control diario: tipo de cambio y saldos bancarios de hoy ────────────────
  // Solo bloquea a quien puede cargarlos — a un usuario de solo lectura no
  // tendría sentido pedirle algo que no puede completar.
  const [gate, setGate] = useState({ loading: canWrite, tcFalta: false, bancosFaltan: [] })

  const chequearGate = useCallback(async () => {
    if (!canWrite) { setGate({ loading: false, tcFalta: false, bancosFaltan: [] }); return }
    setGate(g => ({ ...g, loading: true }))
    const hoy = hoyLocal()
    try {
      const [tc, saldos] = await Promise.all([
        api.get('/finanzas/tipo-cambio'),
        api.get('/finanzas/saldo-bancario'),
      ])
      const tcHoy = tc.data.some(t => t.fecha === hoy && t.moneda === 'DÓLAR')
      const bancosFaltan = BANCOS_REQUERIDOS.filter(b =>
        !saldos.data.some(s => s.entidad === b && (s.created_at || '').slice(0, 10) === hoy)
      )
      setGate({ loading: false, tcFalta: !tcHoy, bancosFaltan })
    } catch {
      // si falla la consulta (ej. red), no dejamos a nadie trabado por un error ajeno
      setGate({ loading: false, tcFalta: false, bancosFaltan: [] })
    }
  }, [canWrite])

  useEffect(() => { chequearGate() }, [chequearGate])

  const gatePendiente = !gate.loading && !gateOmitido && (gate.tcFalta || gate.bancosFaltan.length > 0)

  if (gate.loading) {
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
          <i className="bi bi-building-gear me-2 text-primary" />
          Administración
        </h4>
      </div>

      {gatePendiente && (
        <ModalControlDiario tcFalta={gate.tcFalta} bancosFaltan={gate.bancosFaltan} onCompleto={chequearGate}
          permitirOmitir={esFinanzas} onOmitir={() => setGateOmitido(true)} />
      )}

      <ul className="nav nav-tabs mb-2">
        {TABS_ORDEN.map(key => {
          const info  = TAB_INFO[key]
          const badge = counts[key]
          return (
            <li className="nav-item" key={key}>
              <button className={`nav-link ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>
                <i className={`bi bi-${info.icon} me-1`} />{info.label}
                {!!badge && <span className={`badge ${info.badge} ms-1`} style={{ fontSize: '0.65rem' }}>{badge}</span>}
              </button>
            </li>
          )
        })}
      </ul>
      {TAB_INFO[tab] && <p className="text-muted small mb-3">{TAB_INFO[tab].subt}</p>}

      {tab === 'proveedores' && <TabProveedores esAdmin={esAdmin} onAbrirFusion={() => setTab('fusiones')} />}
      {tab === 'clientes'    && <TabClientes />}
      {tab === 'oc-sin-factura' && <TabOCSinFactura canWrite={canWrite} onCount={n => setCounts(p => ({ ...p, 'oc-sin-factura': n }))} />}
      {tab === 'pedidos-precio' && <TabPedidosPrecio canWrite={canWrite} onCount={n => setCounts(p => ({ ...p, 'pedidos-precio': n }))} />}

      {tab === 'compras' && canWrite && (
        <div className="d-flex gap-2 mb-3">
          <button className="btn btn-sm btn-outline-primary" onClick={() => setModalFacturaIA('compra')}>
            <i className="bi bi-robot me-1" />Cargar factura de compra IA
          </button>
        </div>
      )}
      {tab === 'ventas' && canWrite && (
        <div className="d-flex gap-2 mb-3">
          <button className="btn btn-sm btn-outline-success" onClick={() => setModalFacturaIA('venta')}>
            <i className="bi bi-robot me-1" />Cargar factura de venta IA
          </button>
        </div>
      )}
      {TABS_FINANZAS.includes(tab) && (
        <div className="d-flex flex-column" style={{ height: 'calc(100vh - 280px)', minHeight: 0 }}>
          <Finanzas canWrite={canWrite} noDashboard embedded activeTab={tab} onCounts={setCounts} />
        </div>
      )}

      {tab === 'fusiones' && <FusionProveedores canWrite={esAdmin} />}

      {modalFacturaIA && (
        <FacturaIA
          tipo={modalFacturaIA}
          onClose={() => setModalFacturaIA(null)}
          onGuardado={() => setModalFacturaIA(null)}
        />
      )}
    </div>
  )
}

// ── Control diario: pide tipo de cambio y saldos bancarios de hoy ──────────────
// Bloqueante para la mayoría — se cierra únicamente cuando queda todo cargado
// (chequearGate() vuelve a correr tras guardar). Quien también tiene acceso a
// Finanzas puede omitirlo (permitirOmitir), ya que maneja esos datos por su cuenta.
function ModalControlDiario({ tcFalta, bancosFaltan, onCompleto, permitirOmitir, onOmitir }) {
  const [valorTC,  setValorTC]  = useState('')
  const [saldos,   setSaldos]   = useState(() => Object.fromEntries(bancosFaltan.map(b => [b, ''])))
  const [guardando, setGuardando] = useState(false)
  const [error,    setError]    = useState('')

  const guardar = async e => {
    e.preventDefault()
    setError('')
    if (tcFalta && (!valorTC || isNaN(parseFloat(valorTC)) || parseFloat(valorTC) <= 0)) {
      setError('Ingresá el valor del dólar de hoy'); return
    }
    for (const b of bancosFaltan) {
      if (saldos[b] === '' || isNaN(parseFloat(saldos[b]))) {
        setError(`Ingresá el saldo de ${b}`); return
      }
    }
    setGuardando(true)
    try {
      const hoy = hoyLocal()
      const tareas = []
      if (tcFalta) tareas.push(api.post('/finanzas/tipo-cambio', { moneda: 'DÓLAR', valor: +valorTC, fuente: 'BNA', fecha: hoy }))
      for (const b of bancosFaltan) tareas.push(api.post('/finanzas/saldo-bancario', { entidad: b, monto: +saldos[b], moneda: 'PESO' }))
      await Promise.all(tareas)
      onCompleto()
    } catch (e2) {
      setError(e2.response?.data?.error || 'Error al guardar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="modal-dialog modal-dialog-centered">
        <form className="modal-content" onSubmit={guardar}>
          <div className="modal-header">
            <h5 className="modal-title">
              <i className="bi bi-calendar-check me-2 text-primary" />Antes de empezar
            </h5>
          </div>
          <div className="modal-body">
            <p className="text-muted small">
              Para trabajar en Administración hace falta cargar primero el tipo de cambio
              y los saldos bancarios de hoy.
            </p>
            {error && <div className="alert alert-danger py-2 small">{error}</div>}
            {tcFalta && (
              <div className="mb-3">
                <label className="form-label small fw-medium">
                  <i className="bi bi-currency-exchange me-1" />Tipo de Cambio BNA (Dólar) — valor $ por USD
                </label>
                <input type="number" onPaste={manejarPegadoNumero} step="0.01" min="0" className="form-control" autoFocus
                  value={valorTC} onChange={e => setValorTC(e.target.value)} placeholder="Ej: 1250.00" />
              </div>
            )}
            {bancosFaltan.map(b => (
              <div className="mb-3" key={b}>
                <label className="form-label small fw-medium"><i className="bi bi-bank me-1" />Saldo de {b} (hoy)</label>
                <input type="number" onPaste={manejarPegadoNumero} step="0.01" className="form-control"
                  value={saldos[b]} onChange={e => setSaldos(s => ({ ...s, [b]: e.target.value }))} placeholder="Monto en pesos" />
              </div>
            ))}
          </div>
          <div className="modal-footer">
            {permitirOmitir && (
              <button type="button" className="btn btn-outline-secondary" onClick={onOmitir} disabled={guardando}>
                Omitir por ahora
              </button>
            )}
            <button type="submit" className="btn btn-primary" disabled={guardando}>
              {guardando && <span className="spinner-border spinner-border-sm me-2" />}Guardar y continuar
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Tab Proveedores ────────────────────────────────────────────────────────────

function TabProveedores({ esAdmin, onAbrirFusion }) {
  const user          = getUser()
  const permisos      = getPermisos()
  const puedeEscribir = user?.rol === 'admin' || !!permisos?.compras?.escribir || !!permisos?.administracion?.escribir

  const [lista,        setLista]        = useState([])
  const [cargando,     setCargando]     = useState(false)
  const [buscar,       setBuscar]       = useState('')
  const [verInactivos, setVerInactivos] = useState(false)
  const [modal,        setModal]        = useState(null)
  const [form,         setForm]         = useState(PROV_VACIO)
  const [error,        setError]        = useState('')
  const [guardando,    setGuardando]    = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const params = {}
      if (buscar)       params.buscar = buscar
      if (verInactivos) params.todos  = '1'
      const { data } = await api.get('/compras/proveedores', { params })
      setLista(data)
    } catch (e) {
      console.error(e)
    } finally {
      setCargando(false)
    }
  }, [buscar, verInactivos])

  useEffect(() => { cargar() }, [cargar])

  const abrirNuevo = () => {
    setForm(PROV_VACIO)
    setError('')
    setModal({ modo: 'nuevo' })
  }

  const abrirEditar = (p) => {
    setForm({ ...PROV_VACIO, ...p })
    setError('')
    setModal({ modo: 'editar', id: p.id })
  }

  const guardar = async (e) => {
    e.preventDefault()
    if (!form.nombre.trim()) { setError('El nombre es obligatorio'); return }
    setGuardando(true)
    setError('')
    try {
      if (modal.modo === 'nuevo') {
        await api.post('/compras/proveedores', form)
      } else {
        await api.put(`/compras/proveedores/${modal.id}`, form)
      }
      setModal(null)
      cargar()
    } catch (e) {
      setError(e.response?.data?.error || 'Error al guardar')
    } finally {
      setGuardando(false)
    }
  }

  const toggleActivo = async (p) => {
    const accion = p.activo ? 'Desactivar' : 'Activar'
    if (!window.confirm(`¿${accion} el proveedor "${p.nombre}"?`)) return
    try {
      await api.delete(`/compras/proveedores/${p.id}`)
      cargar()
    } catch (e) {
      alert(e.response?.data?.error || 'Error')
    }
  }

  const eliminarProveedor = async (p) => {
    if (!window.confirm(`¿Eliminar DEFINITIVAMENTE el proveedor "${p.nombre}"?\nEsta acción no se puede deshacer.`)) return
    try {
      await api.delete(`/compras/proveedores/${p.id}/borrar`)
      cargar()
    } catch (e) {
      alert(e.response?.data?.error || 'Error al eliminar')
    }
  }

  // Detectar duplicados por nombre normalizado y por CUIT
  const nombresCount = {}, cuitsCount = {}
  for (const p of lista) {
    const n = p.nombre.trim().toLowerCase()
    nombresCount[n] = (nombresCount[n] || 0) + 1
    if (p.cuit?.trim()) {
      const c = p.cuit.replace(/\D/g, '')
      if (c) cuitsCount[c] = (cuitsCount[c] || 0) + 1
    }
  }
  const dupNombre = new Set(lista.filter(p => nombresCount[p.nombre.trim().toLowerCase()] > 1).map(p => p.id))
  const dupCuit   = new Set(lista.filter(p => { const c = p.cuit?.replace(/\D/g,''); return c && cuitsCount[c] > 1 }).map(p => p.id))

  return (
    <>
      <div className="d-flex flex-wrap gap-2 mb-3 align-items-center">
        <input
          className="form-control form-control-sm"
          style={{ maxWidth: 280 }}
          placeholder="Buscar por nombre o CUIT..."
          value={buscar}
          onChange={e => setBuscar(e.target.value)}
        />
        <div className="form-check form-switch mb-0 ms-1">
          <input className="form-check-input" type="checkbox" id="chkInactProv"
            checked={verInactivos} onChange={e => setVerInactivos(e.target.checked)}/>
          <label className="form-check-label small" htmlFor="chkInactProv">Ver inactivos</label>
        </div>
        <div className="ms-auto d-flex gap-2">
          {esAdmin && (
            <button className="btn btn-outline-secondary btn-sm" title="Fusionar proveedores duplicados" onClick={onAbrirFusion}>
              <i className="bi bi-shuffle me-1" />Fusionar duplicados
            </button>
          )}
          {puedeEscribir && (
            <button className="btn btn-primary btn-sm" onClick={abrirNuevo}>
              <i className="bi bi-plus-lg me-1" />Nuevo Proveedor
            </button>
          )}
        </div>
      </div>

      <div className="table-responsive">
        <table className="table table-sm table-hover align-middle">
          <thead className="table-dark">
            <tr>
              <th>Nombre</th>
              <th>CUIT</th>
              <th>Contacto</th>
              <th>Teléfono</th>
              <th>Email</th>
              <th>Cond. Pago</th>
              <th>Localidad</th>
              <th>Categoría</th>
              <th className="text-center">Crítico</th>
              <th className="text-center">Estado</th>
              <th style={{ width: 90 }}></th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={11} className="text-center py-4 text-muted">
                <span className="spinner-border spinner-border-sm me-2" />Cargando...
              </td></tr>
            ) : lista.length === 0 ? (
              <tr><td colSpan={11} className="text-center py-4 text-muted">Sin resultados</td></tr>
            ) : lista.map(p => {
              const esDupNombre = dupNombre.has(p.id)
              const esDupCuit   = dupCuit.has(p.id)
              const rowClass    = esDupCuit ? 'table-danger' : esDupNombre ? 'table-warning' : (!p.activo ? 'opacity-50' : '')
              return (
              <tr key={p.id} className={rowClass}>
                <td className="fw-semibold">
                  {p.nombre}
                  {esDupNombre && <span className="badge bg-warning text-dark ms-2" style={{fontSize:'0.65rem'}}>Nombre dup.</span>}
                </td>
                <td className="font-monospace small">
                  {p.cuit || '—'}
                  {esDupCuit && <span className="badge bg-danger ms-2" style={{fontSize:'0.65rem'}}>CUIT dup.</span>}
                </td>
                <td>{p.contacto || '—'}</td>
                <td>{p.telefono || '—'}</td>
                <td className="small">{p.email || '—'}</td>
                <td className="small">{p.condicion_pago || '—'}</td>
                <td>{p.localidad || '—'}</td>
                <td className="small text-muted">{p.categoria_provision || '—'}</td>
                <td className="text-center">
                  {p.critico ? <span className="badge bg-danger">Crítico</span> : <span className="text-muted small">—</span>}
                </td>
                <td className="text-center">
                  <span className={`badge ${p.activo ? 'bg-success' : 'bg-secondary'}`}>
                    {p.activo ? 'Activo' : 'Inactivo'}
                  </span>
                </td>
                <td>
                  {puedeEscribir && (
                    <div className="d-flex gap-1 justify-content-end">
                      <button className="btn btn-outline-secondary btn-sm" title="Editar" onClick={() => abrirEditar(p)}>
                        <i className="bi bi-pencil" />
                      </button>
                      <button className={`btn btn-sm ${p.activo ? 'btn-outline-danger' : 'btn-outline-success'}`}
                        title={p.activo ? 'Desactivar' : 'Activar'} onClick={() => toggleActivo(p)}>
                        <i className={`bi bi-${p.activo ? 'slash-circle' : 'check-circle'}`} />
                      </button>
                      <button className="btn btn-sm btn-outline-danger" title="Eliminar definitivamente"
                        onClick={() => eliminarProveedor(p)}>
                        <i className="bi bi-trash" />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            )})}
          </tbody>
        </table>
      </div>
      {(dupNombre.size > 0 || dupCuit.size > 0) && (
        <div className="small mt-2">
          {dupNombre.size > 0 && <span className="badge bg-warning text-dark me-2">Nombre duplicado</span>}
          {dupCuit.size > 0   && <span className="badge bg-danger me-2">CUIT duplicado</span>}
          Revisá y fusioná o eliminá los registros marcados
        </div>
      )}
      <div className="text-muted small mt-1">{lista.length} registro{lista.length !== 1 ? 's' : ''}</div>

      {modal && (
        <ModalProveedor
          modal={modal} form={form} setForm={setForm} error={error}
          guardando={guardando} onClose={() => setModal(null)} onSubmit={guardar}
        />
      )}
    </>
  )
}

function ModalProveedor({ modal, form, setForm, error, guardando, onClose, onSubmit }) {
  const set = campo => e => setForm(f => ({ ...f, [campo]: e.target.value }))

  return (
    <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-dialog modal-xl modal-dialog-scrollable">
        <div className="modal-content">
          <form onSubmit={onSubmit}>
            <div className="modal-header">
              <h5 className="modal-title">
                <i className="bi bi-truck me-2" />
                {modal.modo === 'nuevo' ? 'Nuevo Proveedor' : 'Editar Proveedor'}
              </h5>
              <button type="button" className="btn-close" onClick={onClose} />
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-danger py-2 small">{error}</div>}

              {/* Datos generales */}
              <h6 className="fw-semibold text-muted border-bottom pb-1 mb-3 small text-uppercase">Datos generales</h6>
              <div className="row g-3 mb-3">
                <div className="col-md-7">
                  <label className="form-label fw-semibold">Nombre <span className="text-danger">*</span></label>
                  <input className="form-control" value={form.nombre} onChange={set('nombre')} autoFocus />
                </div>
                <div className="col-md-3">
                  <label className="form-label">CUIT</label>
                  <input className="form-control" value={form.cuit} onChange={set('cuit')}
                    onBlur={e => setForm(f => ({ ...f, cuit: formatCuit(e.target.value) }))} placeholder="XX-XXXXXXXX-X" />
                </div>
                <div className="col-md-2 d-flex align-items-end pb-1">
                  <div className="form-check form-switch mb-0">
                    <input className="form-check-input" type="checkbox" id="chkCritico"
                      checked={!!form.critico} onChange={e => setForm(f => ({ ...f, critico: e.target.checked ? 1 : 0 }))}/>
                    <label className="form-check-label fw-semibold text-danger" htmlFor="chkCritico">Crítico</label>
                  </div>
                </div>
                <div className="col-md-4">
                  <label className="form-label">Contacto</label>
                  <input className="form-control" value={form.contacto} onChange={set('contacto')} />
                </div>
                <div className="col-md-4">
                  <label className="form-label">Teléfono</label>
                  <input className="form-control" value={form.telefono} onChange={set('telefono')} />
                </div>
                <div className="col-md-4">
                  <label className="form-label">Email</label>
                  <input className="form-control" type="email" value={form.email} onChange={set('email')} />
                </div>
                <div className="col-md-4">
                  <label className="form-label">Vendedor</label>
                  <input className="form-control" value={form.vendedor} onChange={set('vendedor')} />
                </div>
                <div className="col-md-4">
                  <label className="form-label">Condición de Pago</label>
                  <input className="form-control" value={form.condicion_pago} onChange={set('condicion_pago')}
                    placeholder="ej: TRANSF. BANCARIA, CONTADO..." list="condpago-prov-list"/>
                  <datalist id="condpago-prov-list">
                    {CONDICIONES_PAGO.map(c => <option key={c} value={c} />)}
                  </datalist>
                </div>
                <div className="col-12">
                  <label className="form-label">Dirección</label>
                  <input className="form-control" value={form.direccion} onChange={set('direccion')} />
                </div>
                <div className="col-md-5">
                  <label className="form-label">Localidad</label>
                  <input className="form-control" value={form.localidad} onChange={set('localidad')} />
                </div>
                <div className="col-md-3">
                  <label className="form-label">CP</label>
                  <input className="form-control" value={form.cp} onChange={set('cp')} />
                </div>
              </div>

              {/* Datos SGC (Form 11) */}
              <h6 className="fw-semibold text-muted border-bottom pb-1 mb-3 small text-uppercase">
                <i className="bi bi-clipboard-check me-1"/>Datos SGC (Form 11)
              </h6>
              <div className="row g-3">
                <div className="col-md-4">
                  <label className="form-label">Categoría de Provisión</label>
                  <input className="form-control" value={form.categoria_provision} onChange={set('categoria_provision')}
                    list="cat-prov-list" placeholder="Ej: Insumos, Servicios…"/>
                  <datalist id="cat-prov-list">
                    {CATEGORIAS_PROVISION.map(c => <option key={c} value={c} />)}
                  </datalist>
                </div>
                <div className="col-md-3">
                  <label className="form-label">Fecha de Selección</label>
                  <DateInput className="form-control" value={form.fecha_seleccion} onChange={v => setForm(f => ({ ...f, fecha_seleccion: v }))} />
                </div>
                <div className="col-md-3">
                  <label className="form-label">Frecuencia de Evaluación</label>
                  <select className="form-select" value={form.frecuencia_evaluacion} onChange={set('frecuencia_evaluacion')}>
                    {FRECUENCIAS_EVAL.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div className="col-md-4">
                  <label className="form-label">Responsable de Selección</label>
                  <EmpleadoSelect value={form.responsable_seleccion}
                    onChange={v => setForm(f => ({ ...f, responsable_seleccion: v }))} />
                </div>
                <div className="col-md-4">
                  <label className="form-label">Responsable de Evaluación</label>
                  <EmpleadoSelect value={form.responsable_evaluacion}
                    onChange={v => setForm(f => ({ ...f, responsable_evaluacion: v }))} />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline-secondary" onClick={onClose}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={guardando}>
                {guardando ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="bi bi-check-lg me-1" />}
                Guardar
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

// ── Tab OC sin factura ───────────────────────────────────────────────────────────
// OC de compra ya recibidas (mercadería en planta) pero sin ninguna factura
// cargada todavía — para que Administración le reclame al proveedor o, si la
// factura ya se cargó suelta (sin elegir la OC en su propio formulario), la
// vincule directo desde acá sin tener que ir al módulo Compras.

const fmtFOC = iso => iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—'
const fmtNOC = n => esMontoOculto(n) ? MONTO_OCULTO : new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(n ?? 0)

function BuscadorFacturaSuelta({ proveedorId, onElegir }) {
  const [query,      setQuery]      = useState('')
  const [opciones,   setOpciones]   = useState([])
  const [buscando,   setBuscando]   = useState(false)
  const [abierto,    setAbierto]    = useState(false)
  const debRef = useRef(null)

  const buscar = q => {
    setQuery(q)
    if (debRef.current) clearTimeout(debRef.current)
    debRef.current = setTimeout(async () => {
      setBuscando(true)
      try {
        const params = { ...(q ? { buscar: q } : {}), ...(proveedorId ? { proveedor_id: proveedorId } : {}) }
        const { data } = await api.get('/compras/facturas-sin-oc', { params })
        setOpciones(data)
      } catch { setOpciones([]) }
      setBuscando(false)
    }, 300)
  }

  return (
    <div className="position-relative">
      <input className="form-control form-control-sm" value={query} autoComplete="off"
        placeholder="Buscar factura por número..."
        onChange={e => buscar(e.target.value)}
        onFocus={() => { setAbierto(true); if (!opciones.length) buscar('') }}
        onBlur={() => setTimeout(() => setAbierto(false), 180)} />
      {abierto && (
        <div className="border rounded bg-white shadow-sm position-absolute" style={{ zIndex: 1080, top: '100%', left: 0, minWidth: 320, maxHeight: 220, overflowY: 'auto' }}>
          {buscando ? (
            <div className="text-muted text-center py-2 small">Buscando...</div>
          ) : opciones.length === 0 ? (
            <div className="text-muted text-center py-2 small">Sin facturas sueltas del mismo proveedor que coincidan</div>
          ) : opciones.map(f => (
            <div key={f.id} className="px-2 py-1 border-bottom" style={{ cursor: 'pointer', fontSize: '0.8rem' }}
              onMouseDown={() => onElegir(f)}>
              <span className="fw-semibold text-primary">{f.numero}</span>
              <span className="text-muted ms-2" style={{ fontSize: '0.72rem' }}>{fmtFOC(f.fecha)}</span>
              <span className="ms-2 fw-semibold">{fmtNOC(f.importe)} {f.moneda}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const ESTADOS_OC_FILTRO = ['Emitida', 'Parcial', 'Recibida', 'Cancelada']
const ESTADO_BADGE_OC = { Emitida: 'bg-warning text-dark', Parcial: 'bg-info text-dark', Recibida: 'bg-success', Cancelada: 'bg-danger' }

// Vista de solo lectura de una OC — para revisar qué se pidió sin salir de
// "OC sin factura" ni poder tocar nada (a diferencia del formulario de edición
// de Compras, que sí permite modificarla).
function ModalVerOC({ ocId, onClose }) {
  const [oc,       setOc]       = useState(null)
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vivo = true
    setCargando(true)
    api.get(`/compras/oc/${ocId}`)
      .then(({ data }) => { if (vivo) setOc(data) })
      .catch(() => { if (vivo) setOc(null) })
      .finally(() => { if (vivo) setCargando(false) })
    return () => { vivo = false }
  }, [ocId])

  return (
    <div className="modal show d-block" style={{ background: 'rgba(0,0,0,.5)' }} onMouseDown={onClose}>
      <div className="modal-dialog modal-lg modal-dialog-scrollable" onMouseDown={e => e.stopPropagation()}>
        <div className="modal-content">
          <div className="modal-header py-2">
            <h6 className="modal-title fw-bold">
              <i className="bi bi-eye me-2" />OC {oc?.numero || ''}
            </h6>
            <button className="btn-close btn-sm" onClick={onClose} />
          </div>
          <div className="modal-body" style={{ fontSize: '0.85rem' }}>
            {cargando ? (
              <div className="text-center text-muted py-4"><span className="spinner-border spinner-border-sm me-2" />Cargando...</div>
            ) : !oc ? (
              <div className="text-center text-danger py-4">No se pudo cargar la OC.</div>
            ) : (
              <>
                <div className="row g-2 mb-3">
                  <div className="col-md-6"><strong>Proveedor:</strong> {oc.proveedor_nombre}</div>
                  <div className="col-md-3"><strong>CUIT:</strong> {oc.proveedor_cuit || '—'}</div>
                  <div className="col-md-3"><strong>Estado:</strong> {oc.estado}</div>
                  <div className="col-md-3"><strong>Fecha OC:</strong> {fmtFOC(oc.fecha)}</div>
                  <div className="col-md-3"><strong>Fecha recepción:</strong> {fmtFOC(oc.fecha_recepcion)}</div>
                  <div className="col-md-3"><strong>Moneda:</strong> {oc.moneda}</div>
                  <div className="col-md-3"><strong>Condición de pago:</strong> {oc.condicion_pago || '—'}</div>
                  {oc.observaciones && <div className="col-12"><strong>Observaciones:</strong> {oc.observaciones}</div>}
                </div>
                <table className="table table-sm">
                  <thead className="table-light">
                    <tr>
                      <th>Código</th><th>Descripción</th><th className="text-end">Cant.</th>
                      <th>Unidad</th><th className="text-end">Precio unit.</th><th className="text-end">Precio final</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(oc.items || []).filter(i => i.descripcion).map(i => (
                      <tr key={i.id}>
                        <td className="font-monospace">{i.producto_codigo || '—'}</td>
                        <td>{i.descripcion}</td>
                        <td className="text-end">{fmtNOC(i.cantidad)}</td>
                        <td>{i.unidad}</td>
                        <td className="text-end">{fmtNOC(i.precio_unitario)}</td>
                        <td className="text-end fw-semibold">{fmtNOC(i.precio_final)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
          <div className="modal-footer py-2">
            <button className="btn btn-sm btn-secondary" onClick={onClose}>Cerrar</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function TabOCSinFactura({ canWrite, onCount }) {
  const [lista,        setLista]        = useState([])
  const [cargando,     setCargando]     = useState(false)
  const [buscar,       setBuscar]       = useState('')
  const [filtroEstado, setFiltroEstado] = useState('')
  const [vinculando,   setVinculando]   = useState(null) // oc_id que está eligiendo factura
  const [verOC,        setVerOC]        = useState(null) // oc_id a visualizar (solo lectura)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const params = { sinFactura: '1', limit: 200 }
      if (filtroEstado) params.estado = filtroEstado
      if (buscar) params.buscar = buscar
      const { data } = await api.get('/compras/oc', { params })
      setLista(data.datos)
    } catch (e) {
      console.error(e)
    } finally {
      setCargando(false)
    }
  }, [buscar, filtroEstado])

  useEffect(() => { cargar() }, [cargar])

  // El total del badge de la pestaña siempre cuenta TODAS las OC sin factura
  // (sin el filtro de estado, que solo achica lo que se ve en pantalla) —
  // si dependiera de filtroEstado, filtrar por un estado achicaría el badge
  // como si hubiera menos OC pendientes de reclamo en total.
  useEffect(() => {
    const params = { sinFactura: '1', limit: 1 }
    if (buscar) params.buscar = buscar
    api.get('/compras/oc', { params }).then(({ data }) => onCount?.(data.total)).catch(e => console.error(e))
  }, [buscar])

  const vincular = async (oc, factura) => {
    try {
      await api.patch(`/compras/oc/${oc.id}/vincular-factura`, { factura_id: factura.id })
      setVinculando(null)
      cargar()
    } catch (e) {
      alert(e.response?.data?.error || 'Error al vincular')
    }
  }

  return (
    <div>
      <div className="d-flex gap-2 mb-3 align-items-center flex-wrap">
        <input className="form-control form-control-sm" style={{ width: 260 }}
          placeholder="Buscar N° OC o proveedor..."
          value={buscar} onChange={e => setBuscar(e.target.value)} />
        <select className="form-select form-select-sm" style={{ width: 160 }}
          value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
          <option value="">Todos los estados</option>
          {ESTADOS_OC_FILTRO.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        <span className="text-muted small">{lista.length} OC sin ninguna factura cargada</span>
      </div>

      {cargando ? (
        <div className="text-center text-muted py-4"><span className="spinner-border spinner-border-sm me-2" />Cargando...</div>
      ) : lista.length === 0 ? (
        <div className="text-center text-muted py-4">
          <i className="bi bi-check-circle display-6 d-block mb-2 text-success" />
          No hay OC sin factura{filtroEstado ? ` en estado "${filtroEstado}"` : ''} — todo al día.
        </div>
      ) : (
        <div className="table-responsive">
          <table className="table table-sm table-hover align-middle" style={{ fontSize: '0.82rem' }}>
            <thead className="table-light">
              <tr>
                <th>N° OC</th><th>Proveedor</th><th>Estado</th><th>Fecha OC</th><th>Recepción</th>
                <th className="text-center">Moneda</th><th className="text-end">Total</th>
                {canWrite && <th>Vincular factura ya cargada</th>}
              </tr>
            </thead>
            <tbody>
              {lista.map(o => (
                <tr key={o.id} role="button" style={{ cursor: 'pointer' }}
                  onClick={() => vinculando !== o.id && setVerOC(o.id)}
                  title="Ver la OC (solo lectura)">
                  <td className="fw-semibold text-primary">{o.numero}</td>
                  <td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.proveedor_nombre}>{o.proveedor_nombre}</td>
                  <td><span className={`badge ${ESTADO_BADGE_OC[o.estado] || 'bg-secondary'}`}>{o.estado}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtFOC(o.fecha)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtFOC(o.fecha_recepcion)}</td>
                  <td className="text-center text-muted">{o.moneda}</td>
                  <td className="text-end fw-semibold">{o.total_usd != null ? fmtNOC(o.total_usd) : '—'}</td>
                  {canWrite && (
                    <td onClick={e => e.stopPropagation()}>
                      {vinculando === o.id ? (
                        <div className="d-flex align-items-center gap-2">
                          <BuscadorFacturaSuelta proveedorId={o.proveedor_id} onElegir={f => vincular(o, f)} />
                          <button className="btn btn-sm btn-outline-secondary py-0 px-2" onClick={() => setVinculando(null)}>Cancelar</button>
                        </div>
                      ) : (
                        <button className="btn btn-sm btn-outline-primary py-0 px-2" onClick={() => setVinculando(o.id)}>
                          <i className="bi bi-link-45deg me-1" />Vincular factura
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {verOC != null && <ModalVerOC ocId={verOC} onClose={() => setVerOC(null)} />}
    </div>
  )
}

// ── Tab Pedidos de precio ────────────────────────────────────────────────────
// Solo lista lo pendiente (el backend ya filtra), nunca el catálogo completo
// de Materiales — quien pidió el precio no necesita permiso de Administración,
// y quien lo carga acá no necesita permiso de Materiales.
function TabPedidosPrecio({ canWrite, onCount }) {
  // Exportar exige escribir en Administración puntualmente (mismo permiso que
  // ya exige el backend en /pedidos-precio/exportar) — no alcanza con el
  // canWrite más amplio de esta pestaña (que también entra por compras).
  const canExportar = getUser()?.rol === 'admin' || !!getPermisos()?.administracion?.escribir
  const [lista,      setLista]      = useState([])
  const [cargando,   setCargando]   = useState(false)
  const [provsList,  setProvsList]  = useState([])
  const [precios,    setPrecios]    = useState({})   // { [pedido.id]: valor tipeado }
  const [proveedores,setProveedores]= useState({})   // { [pedido.id]: proveedor elegido }
  const [monedas,    setMonedas]    = useState({})   // { [pedido.id]: moneda elegida }
  const [guardando,  setGuardando]  = useState(null) // id del pedido en curso
  const [filtroProveedor, setFiltroProveedor] = useState('')
  const [exportando, setExportando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const { data } = await api.get('/pedidos-precio')
      setLista(data)
      onCount?.(data.length)
      // Precarga el proveedor y la moneda actuales de cada material — así si
      // ya los tiene se puede dejar tal cual, y si no, quedan para completar.
      setProveedores(prev => {
        const next = { ...prev }
        for (const p of data) if (!(p.id in next)) next[p.id] = p.proveedor || ''
        return next
      })
      setMonedas(prev => {
        const next = { ...prev }
        for (const p of data) if (!(p.id in next)) next[p.id] = p.precio_moneda || 'PESOS'
        return next
      })
    } catch (e) {
      console.error(e)
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => { cargar() }, [cargar])
  useEffect(() => {
    api.get('/compras/proveedores').then(r => setProvsList(r.data)).catch(e => console.error(e))
  }, [])

  const cargarPrecio = async pedido => {
    const valor = parseFloat(precios[pedido.id])
    if (!(valor > 0)) return alert('Cargá un precio válido')
    setGuardando(pedido.id)
    try {
      await api.post(`/pedidos-precio/${pedido.id}/resolver`, {
        precio_costo: valor, proveedor: proveedores[pedido.id] ?? '', precio_moneda: monedas[pedido.id] || 'PESOS',
      })
      cargar()
    } catch (e) {
      alert(e.response?.data?.error || 'Error al cargar el precio')
    } finally { setGuardando(null) }
  }

  // Solo proveedores con algo pendiente de verdad — no tiene sentido ofrecer
  // en el filtro uno de la lista completa que hoy no tiene nada por cotizar.
  const proveedoresPresentes = [...new Set(lista.map(p => p.proveedor).filter(Boolean))].sort((a, b) => a.localeCompare(b))
  const listaFiltrada = filtroProveedor ? lista.filter(p => p.proveedor === filtroProveedor) : lista

  const exportarExcel = async () => {
    setExportando(true)
    try {
      const r = await api.get('/pedidos-precio/exportar', {
        params: filtroProveedor ? { proveedor: filtroProveedor } : {},
        responseType: 'blob',
      })
      const url = URL.createObjectURL(new Blob([r.data]))
      const a = document.createElement('a')
      a.href = url; a.download = `pedidos_precio_${hoyLocal()}.xlsx`; a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert('No se pudo exportar')
    } finally { setExportando(false) }
  }

  return (
    <div>
      {cargando ? (
        <div className="text-center text-muted py-4"><span className="spinner-border spinner-border-sm me-2" />Cargando...</div>
      ) : lista.length === 0 ? (
        <div className="text-center text-muted py-4">
          <i className="bi bi-check-circle display-6 d-block mb-2 text-success" />
          No hay pedidos de precio pendientes.
        </div>
      ) : (
        <>
          <div className="d-flex align-items-center gap-2 mb-2">
            <select className="form-select form-select-sm" style={{ maxWidth: 260 }}
              value={filtroProveedor} onChange={e => setFiltroProveedor(e.target.value)}>
              <option value="">Todos los proveedores ({lista.length})</option>
              {proveedoresPresentes.map(nom => <option key={nom} value={nom}>{nom}</option>)}
            </select>
            {canExportar && (
              <button className="btn btn-sm btn-outline-success ms-auto" disabled={exportando || listaFiltrada.length === 0} onClick={exportarExcel}>
                {exportando ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="bi bi-file-excel me-1" />}
                Exportar Excel{filtroProveedor ? ` (${filtroProveedor})` : ''}
              </button>
            )}
          </div>
          {listaFiltrada.length === 0 ? (
            <div className="text-center text-muted py-4">Ese proveedor no tiene pedidos de precio pendientes.</div>
          ) : (
        <div className="table-responsive">
          <table className="table table-sm table-hover align-middle" style={{ fontSize: '0.82rem' }}>
            <thead className="table-light">
              <tr>
                <th>Código</th><th>Material</th><th className="text-end">Precio actual</th>
                <th style={{ width: 200 }}>Proveedor</th>
                <th>Pedido por</th><th>Fecha del pedido</th>
                {canWrite && <th style={{ width: 260 }}>Cargar precio</th>}
              </tr>
            </thead>
            <tbody>
              {listaFiltrada.map(p => (
                <tr key={p.id}>
                  <td className="font-monospace">{p.codigo}</td>
                  <td>{p.descripcion}</td>
                  <td className="text-end text-muted">
                    {esMontoOculto(p.precio_costo) ? MONTO_OCULTO : p.precio_costo > 0
                      ? `${p.precio_costo} ${p.precio_moneda === 'DÓLAR' ? 'US$' : p.precio_moneda === 'EURO' ? '€' : '$'}`
                      : '—'}
                    {p.precio_fecha && <div style={{ fontSize: '0.7rem' }}>({p.precio_fecha.slice(8,10)}/{p.precio_fecha.slice(5,7)}/{p.precio_fecha.slice(0,4)})</div>}
                  </td>
                  <td>
                    {canWrite ? (
                      <select className="form-select form-select-sm" value={proveedores[p.id] ?? ''}
                        onChange={e => setProveedores(prev => ({ ...prev, [p.id]: e.target.value }))}>
                        <option value="">— Sin proveedor —</option>
                        {provsList.map(pr => <option key={pr.id} value={pr.nombre}>{pr.nombre}</option>)}
                      </select>
                    ) : (
                      <span className="text-muted">{p.proveedor || '—'}</span>
                    )}
                  </td>
                  <td className="text-muted">{p.solicitante_nombre || '—'}</td>
                  <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>{(p.created_at || '').slice(0, 10).split('-').reverse().join('/')}</td>
                  {canWrite && (
                    <td>
                      <div className="input-group input-group-sm">
                        <input type="number" onPaste={manejarPegadoNumero} min="0.01" step="any" className="form-control"
                          placeholder={`${p.unidad || ''}`}
                          value={precios[p.id] ?? ''} onChange={e => setPrecios(prev => ({ ...prev, [p.id]: e.target.value }))} />
                        <select className="form-select" style={{ maxWidth: 78 }}
                          value={monedas[p.id] || 'PESOS'} onChange={e => setMonedas(prev => ({ ...prev, [p.id]: e.target.value }))}>
                          <option value="PESOS">$</option>
                          <option value="DÓLAR">US$</option>
                          <option value="EURO">€</option>
                        </select>
                        <button className="btn btn-outline-success" disabled={guardando === p.id} onClick={() => cargarPrecio(p)}>
                          {guardando === p.id ? <span className="spinner-border spinner-border-sm" /> : <i className="bi bi-check-lg" />}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Tab Clientes ───────────────────────────────────────────────────────────────

function TabClientes() {
  const user          = getUser()
  const permisos      = getPermisos()
  const puedeEscribir = user?.rol === 'admin' || !!permisos?.ventas?.escribir || !!permisos?.administracion?.escribir

  const [lista,        setLista]        = useState([])
  const [cargando,     setCargando]     = useState(false)
  const [buscar,       setBuscar]       = useState('')
  const [modal,        setModal]        = useState(null)
  const [form,         setForm]         = useState(CLI_VACIO)
  const [error,        setError]        = useState('')
  const [guardando,    setGuardando]    = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const params = {}
      if (buscar) params.buscar = buscar
      const { data } = await api.get('/ventas/clientes', { params })
      setLista(data)
    } catch (e) {
      console.error(e)
    } finally {
      setCargando(false)
    }
  }, [buscar])

  useEffect(() => { cargar() }, [cargar])

  const abrirNuevo = () => { setForm(CLI_VACIO); setError(''); setModal({ modo: 'nuevo' }) }
  const abrirEditar = c => { setForm({ ...CLI_VACIO, ...c }); setError(''); setModal({ modo: 'editar', id: c.id }) }

  const guardar = async (e) => {
    e.preventDefault()
    if (!form.nombre.trim()) { setError('El nombre es obligatorio'); return }
    setGuardando(true); setError('')
    try {
      if (modal.modo === 'nuevo') await api.post('/ventas/clientes', form)
      else await api.put(`/ventas/clientes/${modal.id}`, form)
      setModal(null); cargar()
    } catch (e) {
      setError(e.response?.data?.error || 'Error al guardar')
    } finally {
      setGuardando(false)
    }
  }

  const eliminarCliente = async c => {
    if (!window.confirm(`¿Eliminar DEFINITIVAMENTE el cliente "${c.nombre}"?\nEsta acción no se puede deshacer.`)) return
    try { await api.delete(`/ventas/clientes/${c.id}`); cargar() }
    catch (e) { alert(e.response?.data?.error || 'Error al eliminar') }
  }

  return (
    <>
      <div className="d-flex flex-wrap gap-2 mb-3 align-items-center">
        <input className="form-control form-control-sm" style={{ maxWidth: 280 }}
          placeholder="Buscar por nombre, código o CUIT..." value={buscar} onChange={e => setBuscar(e.target.value)}/>
        <div className="ms-auto">
          {puedeEscribir && (
            <button className="btn btn-primary btn-sm" onClick={abrirNuevo}>
              <i className="bi bi-plus-lg me-1" />Nuevo Cliente
            </button>
          )}
        </div>
      </div>

      <div className="table-responsive">
        <table className="table table-sm table-hover align-middle">
          <thead className="table-dark">
            <tr>
              <th>Código</th><th>Nombre</th><th>CUIT</th><th>Contacto</th><th>Teléfono</th>
              <th>Email</th><th>Cond. Pago</th><th>Localidad</th>
              <th style={{ width: 90 }}></th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={9} className="text-center py-4 text-muted">
                <span className="spinner-border spinner-border-sm me-2" />Cargando...
              </td></tr>
            ) : lista.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-4 text-muted">Sin resultados</td></tr>
            ) : lista.map(c => (
              <tr key={c.id}>
                <td className="font-monospace fw-semibold">{c.codigo || '—'}</td>
                <td className="fw-semibold">{c.nombre}</td>
                <td className="font-monospace small">{c.cuit || '—'}</td>
                <td>{c.contacto || '—'}</td>
                <td>{c.telefono || '—'}</td>
                <td className="small">{c.email || '—'}</td>
                <td className="small">{c.condicion_pago || '—'}</td>
                <td>{c.localidad || '—'}</td>
                <td>
                  {puedeEscribir && (
                    <div className="d-flex gap-1 justify-content-end">
                      <button className="btn btn-outline-secondary btn-sm" title="Editar" onClick={() => abrirEditar(c)}>
                        <i className="bi bi-pencil" />
                      </button>
                      <button className="btn btn-sm btn-outline-danger" title="Eliminar definitivamente"
                        onClick={() => eliminarCliente(c)}>
                        <i className="bi bi-trash" />
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-muted small">{lista.length} registro{lista.length !== 1 ? 's' : ''}</div>

      {modal && (
        <ModalCliente modal={modal} form={form} setForm={setForm} error={error}
          guardando={guardando} onClose={() => setModal(null)} onSubmit={guardar}/>
      )}
    </>
  )
}

function ModalCliente({ modal, form, setForm, error, guardando, onClose, onSubmit }) {
  const set = campo => e => setForm(f => ({ ...f, [campo]: e.target.value }))

  return (
    <div className="modal show d-block" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-dialog modal-lg">
        <div className="modal-content">
          <form onSubmit={onSubmit}>
            <div className="modal-header">
              <h5 className="modal-title">
                <i className="bi bi-person-lines-fill me-2" />
                {modal.modo === 'nuevo' ? 'Nuevo Cliente' : 'Editar Cliente'}
              </h5>
              <button type="button" className="btn-close" onClick={onClose} />
            </div>
            <div className="modal-body">
              {error && <div className="alert alert-danger py-2 small">{error}</div>}
              <div className="row g-3">
                <div className="col-md-6">
                  <label className="form-label fw-semibold">Nombre <span className="text-danger">*</span></label>
                  <input className="form-control" value={form.nombre} onChange={set('nombre')} autoFocus />
                </div>
                <div className="col-md-3">
                  <label className="form-label">Código</label>
                  <input className="form-control font-monospace" value={form.codigo} onChange={set('codigo')}
                    placeholder="ej: UNILE" maxLength={5} style={{ textTransform: 'uppercase' }} />
                </div>
                <div className="col-md-3">
                  <label className="form-label">CUIT</label>
                  <input className="form-control" value={form.cuit} onChange={set('cuit')}
                    onBlur={e => setForm(f => ({ ...f, cuit: formatCuit(e.target.value) }))} placeholder="XX-XXXXXXXX-X" />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Contacto</label>
                  <input className="form-control" value={form.contacto} onChange={set('contacto')} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Teléfono</label>
                  <input className="form-control" value={form.telefono} onChange={set('telefono')} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Email</label>
                  <input className="form-control" type="email" value={form.email} onChange={set('email')} />
                </div>
                <div className="col-md-6">
                  <label className="form-label">Condición de Pago</label>
                  <input className="form-control" value={form.condicion_pago} onChange={set('condicion_pago')}
                    placeholder="ej: 30 días, Contado..." list="condpago-cli-list"/>
                  <datalist id="condpago-cli-list">
                    {CONDICIONES_PAGO.map(c => <option key={c} value={c} />)}
                  </datalist>
                </div>
                <div className="col-12">
                  <label className="form-label">Dirección</label>
                  <input className="form-control" value={form.direccion} onChange={set('direccion')} />
                </div>
                <div className="col-md-5">
                  <label className="form-label">Localidad</label>
                  <input className="form-control" value={form.localidad} onChange={set('localidad')} />
                </div>
                <div className="col-md-3">
                  <label className="form-label">CP</label>
                  <input className="form-control" value={form.cp} onChange={set('cp')} />
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline-secondary" onClick={onClose}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={guardando}>
                {guardando ? <span className="spinner-border spinner-border-sm me-1" /> : <i className="bi bi-check-lg me-1" />}
                Guardar
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
