import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api/client'
import { getUser, getPermisos } from '../../store/authStore'
import logo from '../../assets/logo.avif'

/* ── Helpers ────────────────────────────────────────────────────── */
const fmt = n =>
  new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0 }).format(n ?? 0)

const fmtMoney = n =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n ?? 0)

const fmtFecha = iso =>
  iso ? new Date(iso + 'T00:00:00').toLocaleDateString('es-AR') : '—'

/* ── Visibilidad por rol ─────────────────────────────────────────── */
const VIS = {
  admin:       { kpis: 'all', alertas: 'all' },
  gerencia:    { kpis: 'all', alertas: 'all' },
  solo_lectura:{ kpis: 'all', alertas: 'all' },
  compras:     { kpis: ['stock','compras'],             alertas: ['stock_bajo','oc_pendientes'] },
  deposito:    { kpis: ['stock','compras'],             alertas: ['stock_bajo','oc_pendientes'] },
  ventas:      { kpis: ['ventas','proyectos'],          alertas: [] },
  produccion:  { kpis: ['produccion','stock'],          alertas: ['ots_urgentes','stock_bajo'] },
  finanzas:    { kpis: ['finanzas','compras','ventas'], alertas: [] },
}

function puedeVer(rol, seccion, tipo) {
  const v = VIS[rol] ?? VIS.solo_lectura
  if (v[tipo] === 'all') return true
  return v[tipo].includes(seccion)
}

/* ── KPI Card ───────────────────────────────────────────────────── */
const KPI_BORDER = {
  'text-info':    '#0dcaf0',
  'text-warning': '#ffc107',
  'text-primary': '#0d6efd',
  'text-success': '#198754',
  'text-danger':  '#dc3545',
}

function KpiCard({ valor, label, icon, colorClass, bgClass, sub, onClick }) {
  return (
    <div className="col-6 col-sm-4 col-lg-3">
      <div
        className="card kpi-card h-100"
        style={{ borderTop: `3px solid ${KPI_BORDER[colorClass] || '#dee2e6'}`, cursor: onClick ? 'pointer' : 'default' }}
        onClick={onClick}
        title={onClick ? 'Ver detalle' : undefined}
      >
        <div className="card-body d-flex align-items-center gap-3 py-3">
          <div className={`kpi-icon ${bgClass}`} style={{ width: 52, height: 52, fontSize: '1.5rem' }}>
            <i className={`bi bi-${icon} ${colorClass}`} />
          </div>
          <div>
            <div className="kpi-value">{valor}</div>
            <div className="kpi-label">{label}</div>
            {sub && <div className="text-muted" style={{ fontSize: '0.72rem' }}>{sub}</div>}
          </div>
          {onClick && <i className="bi bi-arrow-right-short ms-auto text-muted" style={{ fontSize: '1.1rem', opacity: 0.5 }} />}
        </div>
      </div>
    </div>
  )
}

/* ── Section header ─────────────────────────────────────────────── */
function SectionHeader({ icon, title }) {
  return (
    <div className="d-flex align-items-center gap-2 mb-3">
      <i className={`bi bi-${icon} text-primary`} style={{ fontSize: '1.1rem' }} />
      <h6 className="mb-0 fw-semibold text-secondary text-uppercase" style={{ fontSize: '0.78rem', letterSpacing: '0.8px' }}>
        {title}
      </h6>
    </div>
  )
}

const OT_ESTADO_COLOR = {
  Pendiente: 'secondary', 'En proceso': 'primary', Pausada: 'warning',
  Completada: 'success', Cancelada: 'danger',
}

/* ── Component ──────────────────────────────────────────────────── */
export default function Dashboard() {
  const [data, setData]               = useState(null)
  const [loading, setLoading]         = useState(true)
  const [syncing, setSyncing]         = useState(false)
  const [errSync, setErrSync]         = useState('')
  const [error, setError]             = useState('')
  const [miAyer, setMiAyer]           = useState(undefined)
  const [resumenAyer, setResumenAyer] = useState(null)
  const [tabFichadas, setTabFichadas] = useState('hoy')
  const [noLeidosMsgs, setNoLeidosMsgs] = useState(0)
  const navigate = useNavigate()
  const user     = getUser()
  const rol      = user?.rol ?? 'solo_lectura'
  const permisos = getPermisos()

  const tieneAcceso = modulo =>
    rol === 'admin' || !!(permisos[modulo]?.leer || permisos[modulo]?.escribir)
  const puedeSincronizar = rol === 'admin' || !!permisos.rrhh?.escribir

  const verKpi = s => tieneAcceso(s)
  const verAlerta = s => {
    const mapa = { ots_urgentes: 'produccion', stock_bajo: 'stock', oc_pendientes: 'compras' }
    return tieneAcceso(mapa[s] ?? s)
  }

  const cargar = () =>
    api.get('/dashboard/resumen')
      .then(r => { setData(r.data); setError('') })
      .catch(() => setError('No se pudo cargar el dashboard. Verificá la conexión con el servidor.'))
      .finally(() => setLoading(false))

  useEffect(() => {
    cargar()
    api.get('/rrhh/mi-ayer').then(r => setMiAyer(r.data)).catch(() => setMiAyer(null))
    api.get('/rrhh/resumen-ayer').then(r => setResumenAyer(r.data)).catch(() => {})
    api.get('/mensajes/no-leidos').then(r => setNoLeidosMsgs(r.data?.count || 0)).catch(() => {})
  }, [])

  const handleActualizar = async () => {
    setSyncing(true); setErrSync('')
    try {
      await api.post('/rrhh/dispositivos/sync-todos')
      await cargar()
    } catch (err) {
      setErrSync(err.response?.data?.error ?? 'Error al sincronizar')
    }
    setSyncing(false)
  }

  if (loading) return (
    <div className="d-flex align-items-center justify-content-center" style={{ minHeight: '60vh' }}>
      <div className="text-center text-muted">
        <div className="spinner-border mb-3" />
        <div>Cargando dashboard…</div>
      </div>
    </div>
  )

  if (error) return (
    <div className="alert alert-danger"><i className="bi bi-exclamation-triangle-fill me-2" />{error}</div>
  )

  const { stock, compras, ventas, proyectos, produccion, finanzas, alertas, fichadas_hoy = [], sin_fichar_hoy = [] } = data

  const esEmpleado  = !tieneAcceso('rrhh')
  const nombreCorto = (user?.nombre || '').split(' ')[0]
  const hoyLabel    = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  const visAlertas = [verAlerta('ots_urgentes'), verAlerta('stock_bajo'), verAlerta('oc_pendientes')]
  const hayAlertas = visAlertas.some(Boolean)
  const numAlertas = visAlertas.filter(Boolean).length

  // Columnas dinámicas según cuántas alertas son visibles
  const colOT    = numAlertas === 1 ? 'col-12' : numAlertas === 2 ? 'col-12 col-xl-6' : 'col-12 col-xl-5'
  const colStock = numAlertas === 1 ? 'col-12' : numAlertas === 2 ? 'col-12 col-xl-6' : 'col-12 col-md-6 col-xl-4'
  const colOC    = numAlertas === 1 ? 'col-12' : numAlertas === 2 ? 'col-12 col-xl-6' : 'col-12 col-md-6 col-xl-3'

  // ── Widget "mi ayer" ─────────────────────────────────────────────
  let ayerWidget = null
  if (miAyer) {
    const d         = new Date(miAyer.fecha + 'T12:00:00')
    const dLabel    = d.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })
    const sinFichada = !miAyer.entrada
    const sinParte   = (miAyer.requiere_parte ?? true) && !miAyer.tiene_parte
    const diff       = miAyer.horas_fichada != null && miAyer.tiene_parte
      ? Math.abs(miAyer.horas_parte - miAyer.horas_fichada) : null
    const color = sinParte
      ? (sinFichada ? 'secondary' : 'warning')
      : (diff != null && diff > 1 ? 'warning' : 'success')
    const iconColor = color === 'success' ? 'text-success' : color === 'warning' ? 'text-warning' : 'text-secondary'

    ayerWidget = (
      <div className={`alert alert-${color} d-flex align-items-center gap-3 mb-4 py-2 px-3`}
        style={{ fontSize: '0.85rem' }}>
        <i className={`bi bi-calendar2-check fs-5 flex-shrink-0 ${iconColor}`} />
        <div className="flex-grow-1">
          <span className="fw-semibold text-capitalize">{dLabel}:</span>
          {sinFichada ? (
            <span className="ms-2 text-muted">Sin fichada registrada</span>
          ) : (
            <span className="ms-2">
              Entrada <strong>{miAyer.entrada}</strong>
              {' · '}
              Salida <strong>{miAyer.salida}</strong>
              {miAyer.horas_fichada != null &&
                <span className="ms-1 text-muted">({miAyer.horas_fichada}h)</span>}
            </span>
          )}
          {!sinFichada && (
            <span className="ms-3">
              {sinParte
                ? <span className="badge bg-danger ms-1"><i className="bi bi-exclamation-triangle me-1" />Sin parte</span>
                : <span className="badge bg-success ms-1"><i className="bi bi-check-lg me-1" />{miAyer.horas_parte}h parte cargado</span>}
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      {/* ── Banner empresa ───────────────────────────── */}
      <div className="d-flex align-items-center gap-3 mb-4 px-4 py-3 rounded-3"
        style={{ background: 'linear-gradient(135deg, #0f3b7a 0%, #1a5cb0 60%, #2175c8 100%)', boxShadow: '0 4px 18px rgba(15,59,122,0.18)' }}>
        <div style={{ background: 'rgba(255,255,255,0.96)', borderRadius: 8, padding: '4px 10px', flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          <img src={logo} alt="E-INTRA" style={{ height: 38 }} />
        </div>
        <div className="ms-auto text-end d-none d-sm-block">
          <div style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.85)', textTransform: 'capitalize' }}>{hoyLabel}</div>
          <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>Sistema ERP</div>
        </div>
      </div>

      {/* ── Encabezado ───────────────────────────────── */}
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h5 className="mb-0 fw-bold">Dashboard</h5>
          <small className="text-muted">Resumen operativo en tiempo real</small>
        </div>
        {puedeSincronizar && (
          <div className="text-end">
            <button
              className="btn btn-sm btn-outline-secondary"
              onClick={handleActualizar}
              disabled={syncing}
            >
              {syncing
                ? <><span className="spinner-border spinner-border-sm me-1" />Sincronizando…</>
                : <><i className="bi bi-arrow-clockwise me-1" />Actualizar</>
              }
            </button>
            {errSync && <div className="text-danger small mt-1">{errSync}</div>}
          </div>
        )}
      </div>

      {/* ── Mi ayer ──────────────────────────────────── */}
      {tieneAcceso('rrhh') && ayerWidget}

      {/* ── Dashboard empleado ───────────────────────── */}
      {esEmpleado ? (
        <>
          {/* Saludo */}
          <div className="card border-0 shadow-sm mb-4" style={{ borderLeft: '4px solid #0d6efd', background: 'linear-gradient(135deg,#f0f5ff,#fff)' }}>
            <div className="card-body d-flex align-items-center justify-content-between py-3 px-4">
              <div>
                <h5 className="fw-bold mb-1 text-capitalize">Hola, {nombreCorto.toLowerCase()}</h5>
                <span className="text-muted small text-capitalize">{hoyLabel}</span>
              </div>
              <div className="rounded-circle bg-primary bg-opacity-10 d-flex align-items-center justify-content-center flex-shrink-0"
                style={{ width: 48, height: 48 }}>
                <i className="bi bi-person-circle text-primary" style={{ fontSize: '1.5rem' }} />
              </div>
            </div>
          </div>

          {/* Accesos rápidos */}
          <p className="fw-semibold text-muted text-uppercase mb-3" style={{ fontSize: '0.75rem', letterSpacing: '0.8px' }}>
            <i className="bi bi-grid me-1" />Accesos rápidos
          </p>
          <div className="row g-3 mb-4">
            {/* Mi Parte */}
            <div className="col-6 col-md-4">
              <div className="card border-0 shadow-sm h-100"
                style={{ cursor: 'pointer' }}
                onClick={() => navigate('/partes')}
                onMouseEnter={e => e.currentTarget.classList.add('shadow')}
                onMouseLeave={e => e.currentTarget.classList.remove('shadow')}>
                <div className="card-body text-center py-4 px-3">
                  <div className="rounded-circle bg-primary bg-opacity-10 d-inline-flex align-items-center justify-content-center mb-3"
                    style={{ width: 56, height: 56 }}>
                    <i className="bi bi-clipboard2-check text-primary" style={{ fontSize: '1.5rem' }} />
                  </div>
                  <div className="fw-semibold mb-1">Mi Parte</div>
                  <div className="text-muted" style={{ fontSize: '0.82rem' }}>Cargar horas del día</div>
                </div>
              </div>
            </div>

            {/* Proyectos */}
            {tieneAcceso('proyectos') && (
              <div className="col-6 col-md-4">
                <div className="card border-0 shadow-sm h-100"
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate('/proyectos')}
                  onMouseEnter={e => e.currentTarget.classList.add('shadow')}
                  onMouseLeave={e => e.currentTarget.classList.remove('shadow')}>
                  <div className="card-body text-center py-4 px-3">
                    <div className="rounded-circle bg-success bg-opacity-10 d-inline-flex align-items-center justify-content-center mb-3"
                      style={{ width: 56, height: 56 }}>
                      <i className="bi bi-kanban text-success" style={{ fontSize: '1.5rem' }} />
                    </div>
                    <div className="fw-semibold mb-1">Proyectos</div>
                    <div className="text-muted" style={{ fontSize: '0.82rem' }}>{proyectos.activos} activos</div>
                  </div>
                </div>
              </div>
            )}

            {/* Mensajes */}
            <div className="col-6 col-md-4">
              <div className="card border-0 shadow-sm h-100"
                style={{ cursor: 'pointer' }}
                onClick={() => navigate('/mensajes')}
                onMouseEnter={e => e.currentTarget.classList.add('shadow')}
                onMouseLeave={e => e.currentTarget.classList.remove('shadow')}>
                <div className="card-body text-center py-4 px-3">
                  <div className="position-relative d-inline-block mb-3">
                    <div className="rounded-circle bg-warning bg-opacity-10 d-flex align-items-center justify-content-center"
                      style={{ width: 56, height: 56 }}>
                      <i className="bi bi-envelope text-warning" style={{ fontSize: '1.5rem' }} />
                    </div>
                    {noLeidosMsgs > 0 && (
                      <span className="badge bg-danger rounded-pill position-absolute"
                        style={{ top: -4, right: -6, fontSize: '0.65rem', minWidth: 20 }}>
                        {noLeidosMsgs}
                      </span>
                    )}
                  </div>
                  <div className="fw-semibold mb-1">Mensajes</div>
                  <div className="text-muted" style={{ fontSize: '0.82rem' }}>
                    {noLeidosMsgs > 0 ? `${noLeidosMsgs} sin leer` : 'Sin mensajes nuevos'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        /* ── KPIs (admin / managers) ─────────────────── */
        <div className="row g-3 mb-4">
          {verKpi('stock') && (
            <KpiCard
              valor={fmt(stock.total)}
              label="Productos"
              icon="box-seam"
              colorClass="text-info"
              bgClass="bg-info bg-opacity-10"
              sub={stock.alertas > 0 ? `⚠ ${stock.alertas} con stock bajo` : 'Sin alertas'}
              onClick={() => navigate('/stock', { state: stock.alertas > 0 ? { filAlerta: 'bajo' } : {} })}
            />
          )}
          {verKpi('compras') && (
            <KpiCard
              valor={fmt(compras.abiertas)}
              label="OC abiertas"
              icon="cart3"
              colorClass="text-warning"
              bgClass="bg-warning bg-opacity-10"
              sub={`${compras.mes} este mes`}
              onClick={() => navigate('/compras', { state: { filtroEstado: 'Emitida' } })}
            />
          )}
          {verKpi('ventas') && (
            <KpiCard
              valor={fmt(ventas.borrador + ventas.aprobado)}
              label="Presupuestos"
              icon="briefcase"
              colorClass="text-primary"
              bgClass="bg-primary bg-opacity-10"
              sub={`${ventas.aprobado} aprobados · ${ventas.mes} este mes`}
              onClick={() => navigate('/ventas')}
            />
          )}
          {verKpi('proyectos') && (
            <KpiCard
              valor={fmt(proyectos.activos)}
              label="Proyectos activos"
              icon="kanban"
              colorClass="text-success"
              bgClass="bg-success bg-opacity-10"
              sub={proyectos.en_espera > 0 ? `${proyectos.en_espera} en espera` : 'Sin espera'}
              onClick={() => navigate('/proyectos', { state: { filtEst: 'Activo' } })}
            />
          )}
          {verKpi('produccion') && (
            <KpiCard
              valor={fmt(produccion.abiertas)}
              label="OT abiertas"
              icon="tools"
              colorClass="text-danger"
              bgClass="bg-danger bg-opacity-10"
              sub={produccion.urgentes > 0 ? `🔴 ${produccion.urgentes} urgentes` : `${produccion.vencidas} vencidas`}
              onClick={() => navigate('/produccion')}
            />
          )}
          {verKpi('finanzas') && (
            <KpiCard
              valor={fmtMoney(finanzas.saldo_total)}
              label="Saldo ARS"
              icon="cash-stack"
              colorClass="text-success"
              bgClass="bg-success bg-opacity-10"
              sub={`Ing: ${fmtMoney(finanzas.ingresos_mes)} · Egr: ${fmtMoney(finanzas.egresos_mes)}`}
              onClick={() => navigate('/finanzas')}
            />
          )}
        </div>
      )}

      {/* ── Fichadas hoy / ayer ──────────────────────── */}
      {tieneAcceso('rrhh') && (
        <div className="row g-3 mb-4">
          <div className="col-12">
            <div className="card border-0 shadow-sm">
              <div className="card-body">
                <div className="d-flex align-items-center justify-content-between mb-3">
                  <div className="d-flex align-items-center gap-2">
                    <i className="bi bi-person-badge text-primary" style={{ fontSize: '1.1rem' }} />
                    <h6 className="mb-0 fw-semibold text-secondary text-uppercase"
                      style={{ fontSize: '0.78rem', letterSpacing: '0.8px' }}>
                      Fichadas de personal
                    </h6>
                  </div>
                  <ul className="nav nav-pills nav-sm" style={{ '--bs-nav-pills-border-radius': '0.4rem' }}>
                    <li className="nav-item">
                      <button
                        className={`nav-link py-0 px-2 ${tabFichadas === 'hoy' ? 'active' : 'text-secondary'}`}
                        style={{ fontSize: '0.78rem' }}
                        onClick={() => setTabFichadas('hoy')}>
                        <i className="bi bi-calendar-check me-1" />Hoy ({fichadas_hoy.length}
                        {sin_fichar_hoy.length > 0 && (
                          <span className="ms-1 text-danger fw-bold">{sin_fichar_hoy.length} sin fichar</span>
                        )})
                      </button>
                    </li>
                    <li className="nav-item">
                      <button
                        className={`nav-link py-0 px-2 ${tabFichadas === 'ayer' ? 'active' : 'text-secondary'}`}
                        style={{ fontSize: '0.78rem' }}
                        onClick={() => setTabFichadas('ayer')}>
                        <i className="bi bi-calendar2-day me-1" />Ayer
                        {resumenAyer && (
                          <span className="ms-1">
                            ({resumenAyer.empleados.filter(e => (e.requiere_parte ?? true) && !e.tiene_parte).length > 0
                              ? <span className="text-danger fw-bold">
                                  {resumenAyer.empleados.filter(e => (e.requiere_parte ?? true) && !e.tiene_parte).length} sin parte
                                </span>
                              : <span className="text-success">OK</span>})
                          </span>
                        )}
                      </button>
                    </li>
                  </ul>
                </div>

                {/* Tab Hoy */}
                {tabFichadas === 'hoy' && (
                  fichadas_hoy.length === 0 && sin_fichar_hoy.length === 0 ? (
                    <div className="text-muted text-center py-3 small">
                      <i className="bi bi-clock me-1" />Sin fichadas registradas hoy
                      {syncing && <span className="ms-2">— sincronizando…</span>}
                    </div>
                  ) : (
                    <div className="table-responsive">
                      <table className="table table-sm table-hover mb-0" style={{ fontSize: '0.83rem' }}>
                        <thead className="table-light">
                          <tr>
                            <th style={{ width: '2rem' }}>#</th>
                            <th>Empleado</th>
                            <th style={{ width: '6rem' }}>Entrada</th>
                            <th style={{ width: '8rem' }}>Tipo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {fichadas_hoy.map((f, i) => {
                            const tarde = f.horario_entrada && f.hora_entrada > f.horario_entrada
                            return (
                              <tr key={i} className={tarde ? 'table-danger' : ''}>
                                <td className="text-muted">{i + 1}</td>
                                <td className="fw-semibold">{f.nombre}</td>
                                <td className="text-nowrap fw-semibold">
                                  <span className={tarde ? 'text-danger' : 'text-success'}>
                                    {f.hora_entrada}
                                  </span>
                                  {tarde && (
                                    <span className="ms-1 text-danger" style={{ fontSize: '0.72rem' }}
                                      title={`Horario: ${f.horario_entrada}`}>
                                      <i className="bi bi-clock-history" />
                                    </span>
                                  )}
                                </td>
                                <td className="text-muted text-nowrap">{f.tipo_acceso || '—'}</td>
                              </tr>
                            )
                          })}
                          {sin_fichar_hoy.length > 0 && (
                            <>
                              <tr>
                                <td colSpan={4} className="py-1 px-2"
                                  style={{ background: '#fff3cd', fontSize: '0.75rem', color: '#856404', fontWeight: 600 }}>
                                  <i className="bi bi-person-x me-1" />No ficharon hoy — {sin_fichar_hoy.length} empleado{sin_fichar_hoy.length !== 1 ? 's' : ''}
                                </td>
                              </tr>
                              {sin_fichar_hoy.map(e => (
                                <tr key={e.id} style={{ opacity: 0.7 }}>
                                  <td className="text-muted">—</td>
                                  <td className="text-muted fst-italic">{e.nombre}</td>
                                  <td><span className="badge bg-secondary" style={{ fontSize: '0.68rem' }}>Sin fichar</span></td>
                                  <td></td>
                                </tr>
                              ))}
                            </>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )
                )}

                {/* Tab Ayer */}
                {tabFichadas === 'ayer' && (
                  !resumenAyer || resumenAyer.empleados.length === 0 ? (
                    <div className="text-muted text-center py-3 small">
                      <i className="bi bi-calendar2 me-1" />Sin fichadas registradas ayer
                    </div>
                  ) : (
                    <>
                      <div className="d-flex gap-2 mb-2">
                        <span className="badge bg-success">
                          {resumenAyer.empleados.filter(e => e.tiene_parte).length} con parte
                        </span>
                        {resumenAyer.empleados.filter(e => (e.requiere_parte ?? true) && !e.tiene_parte).length > 0 && (
                          <span className="badge bg-danger">
                            {resumenAyer.empleados.filter(e => (e.requiere_parte ?? true) && !e.tiene_parte).length} sin parte
                          </span>
                        )}
                      </div>
                      <div className="table-responsive">
                        <table className="table table-sm table-hover mb-0" style={{ fontSize: '0.83rem' }}>
                          <thead className="table-light">
                            <tr>
                              <th style={{ width: '2rem' }}>#</th>
                              <th>Empleado</th>
                              <th style={{ width: '6rem' }}>Entrada</th>
                              <th style={{ width: '6rem' }}>Salida</th>
                              <th style={{ width: '5rem' }}>Horas</th>
                              <th style={{ width: '9rem' }}>Parte</th>
                            </tr>
                          </thead>
                          <tbody>
                            {resumenAyer.empleados.map((e, i) => {
                              const diff     = e.horas_fichada != null && e.tiene_parte
                                ? Math.abs(e.horas_parte - e.horas_fichada) : null
                              const rowClass = !e.tiene_parte ? 'table-warning'
                                : (diff != null && diff > 1 ? 'table-warning' : '')
                              return (
                                <tr key={e.id} className={rowClass}>
                                  <td className="text-muted">{i + 1}</td>
                                  <td className="fw-semibold">{e.nombre}</td>
                                  <td className="text-success fw-semibold">{e.entrada || '—'}</td>
                                  <td className="text-muted">{e.salida || '—'}</td>
                                  <td className="text-muted">{e.horas_fichada != null ? `${e.horas_fichada}h` : '—'}</td>
                                  <td>
                                    {e.tiene_parte
                                      ? <span className="badge bg-success"><i className="bi bi-check-lg me-1" />{e.horas_parte}h</span>
                                      : <span className="badge bg-danger"><i className="bi bi-exclamation-triangle me-1" />Sin parte</span>}
                                  </td>
                                </tr>
                              )
                            })}
                            {resumenAyer.sin_fichar?.length > 0 && (
                              <>
                                <tr>
                                  <td colSpan={6} className="py-1 px-2"
                                    style={{ background: '#f8d7da', fontSize: '0.75rem', color: '#842029', fontWeight: 600 }}>
                                    <i className="bi bi-person-x me-1" />No ficharon ayer — {resumenAyer.sin_fichar.length} empleado{resumenAyer.sin_fichar.length !== 1 ? 's' : ''}
                                  </td>
                                </tr>
                                {resumenAyer.sin_fichar.map(e => (
                                  <tr key={e.id} style={{ opacity: 0.65 }}>
                                    <td className="text-muted">—</td>
                                    <td className="text-muted fst-italic">{e.nombre}</td>
                                    <td colSpan={3} className="text-muted">—</td>
                                    <td><span className="badge bg-danger" style={{ fontSize: '0.68rem' }}>No fichó</span></td>
                                  </tr>
                                ))}
                              </>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Alertas ──────────────────────────────────── */}
      {hayAlertas && (
        <div className="row g-3">

          {/* OTs urgentes */}
          {verAlerta('ots_urgentes') && (
            <div className={colOT}>
              <div className="card border-0 shadow-sm h-100">
                <div className="card-body">
                  <SectionHeader icon="exclamation-triangle" title="Órdenes de trabajo urgentes" />
                  {alertas.ots_urgentes.length === 0 ? (
                    <div className="text-muted text-center py-3 small">
                      <i className="bi bi-check-circle text-success me-1" />Sin órdenes urgentes
                    </div>
                  ) : (
                    <div className="table-responsive">
                      <table className="table table-sm table-hover mb-0" style={{ fontSize: '0.83rem' }}>
                        <thead className="table-light">
                          <tr><th>N°</th><th>Descripción</th><th>Estado</th><th>Vence</th></tr>
                        </thead>
                        <tbody>
                          {alertas.ots_urgentes.map(ot => (
                            <tr key={ot.id} className="alert-row-urgente">
                              <td className="fw-semibold text-nowrap">{ot.numero}</td>
                              <td>
                                <div className="text-truncate" style={{ maxWidth: 160 }} title={ot.descripcion}>
                                  {ot.descripcion}
                                </div>
                                {ot.proyecto_nombre && (
                                  <div className="text-muted" style={{ fontSize: '0.72rem' }}>{ot.proyecto_nombre}</div>
                                )}
                              </td>
                              <td>
                                <span className={`badge bg-${OT_ESTADO_COLOR[ot.estado] ?? 'secondary'}`}>
                                  {ot.estado}
                                </span>
                              </td>
                              <td className="text-nowrap">{fmtFecha(ot.fecha_fin_est)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Stock bajo */}
          {verAlerta('stock_bajo') && (
            <div className={colStock}>
              <div className="card border-0 shadow-sm h-100">
                <div className="card-body">
                  <SectionHeader icon="box-seam" title="Stock bajo mínimo" />
                  {alertas.stock_bajo.length === 0 ? (
                    <div className="text-muted text-center py-3 small">
                      <i className="bi bi-check-circle text-success me-1" />Todos los productos OK
                    </div>
                  ) : (
                    <div className="table-responsive">
                      <table className="table table-sm table-hover mb-0" style={{ fontSize: '0.83rem' }}>
                        <thead className="table-light">
                          <tr><th>Código</th><th>Descripción</th><th className="text-end">Stock</th><th className="text-end">Mín.</th></tr>
                        </thead>
                        <tbody>
                          {alertas.stock_bajo.map(p => (
                            <tr key={p.id}>
                              <td className="text-nowrap fw-semibold">{p.codigo}</td>
                              <td>
                                <div className="text-truncate" style={{ maxWidth: 140 }} title={p.descripcion}>
                                  {p.descripcion}
                                </div>
                              </td>
                              <td className="text-end text-danger fw-semibold">{fmt(p.stock_actual)}</td>
                              <td className="text-end text-muted">{fmt(p.stock_minimo)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* OC pendientes */}
          {verAlerta('oc_pendientes') && (
            <div className={colOC}>
              <div className="card border-0 shadow-sm h-100">
                <div className="card-body">
                  <SectionHeader icon="cart3" title="OC pendientes de recepción" />
                  {alertas.oc_pendientes.length === 0 ? (
                    <div className="text-muted text-center py-3 small">
                      <i className="bi bi-check-circle text-success me-1" />Sin OC pendientes
                    </div>
                  ) : (
                    <ul className="list-group list-group-flush">
                      {alertas.oc_pendientes.map(oc => (
                        <li key={oc.id} className="list-group-item px-0 py-2" style={{ fontSize: '0.83rem' }}>
                          <div className="d-flex justify-content-between align-items-start">
                            <div>
                              <span className="fw-semibold">{oc.numero}</span>
                              <div className="text-muted text-truncate" style={{ maxWidth: 160, fontSize: '0.76rem' }}>
                                {oc.proveedor_nombre}
                              </div>
                            </div>
                            <div className="text-end">
                              <span className={`badge ${oc.vencida ? 'bg-danger' : oc.estado === 'Parcial' ? 'bg-warning text-dark' : 'bg-secondary'}`}>
                                {oc.vencida ? 'Vencida' : oc.estado}
                              </span>
                              <div className={`mt-1 ${oc.vencida ? 'text-danger fw-semibold' : 'text-muted'}`} style={{ fontSize: '0.72rem' }}>
                                {oc.fecha_entrega_est ? `Entrega: ${fmtFecha(oc.fecha_entrega_est)}` : fmtFecha(oc.fecha)}
                              </div>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}

        </div>
      )}
    </>
  )
}
