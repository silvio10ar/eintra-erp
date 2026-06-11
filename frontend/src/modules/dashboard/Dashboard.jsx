import { useState, useEffect } from 'react'
import api from '../../api/client'
import { getUser, getPermisos } from '../../store/authStore'

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
function KpiCard({ valor, label, icon, colorClass, bgClass, sub }) {
  return (
    <div className="col-6 col-sm-4 col-lg-3">
      <div className="card kpi-card h-100">
        <div className="card-body d-flex align-items-center gap-3 py-3">
          <div className={`kpi-icon ${bgClass}`}>
            <i className={`bi bi-${icon} ${colorClass}`} />
          </div>
          <div>
            <div className="kpi-value">{valor}</div>
            <div className="kpi-label">{label}</div>
            {sub && <div className="text-muted" style={{ fontSize: '0.72rem' }}>{sub}</div>}
          </div>
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
  const [error, setError]             = useState('')
  const [miAyer, setMiAyer]           = useState(undefined)
  const [resumenAyer, setResumenAyer] = useState(null)
  const [tabFichadas, setTabFichadas] = useState('hoy')
  const user     = getUser()
  const rol      = user?.rol ?? 'solo_lectura'
  const permisos = getPermisos()

  const tieneAcceso = modulo =>
    rol === 'admin' || !!(permisos[modulo]?.leer || permisos[modulo]?.escribir)

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
  }, [])

  const handleActualizar = async () => {
    setSyncing(true)
    try { await api.post('/rrhh/dispositivos/sync-todos') } catch (_) {}
    await cargar()
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

  const { stock, compras, ventas, proyectos, produccion, finanzas, alertas, fichadas_hoy = [] } = data

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
    const sinParte   = !miAyer.tiene_parte
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
      {/* ── Encabezado ───────────────────────────────── */}
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h5 className="mb-0 fw-bold">Dashboard</h5>
          <small className="text-muted">Resumen operativo en tiempo real</small>
        </div>
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
      </div>

      {/* ── Mi ayer ──────────────────────────────────── */}
      {ayerWidget}

      {/* ── KPIs ─────────────────────────────────────── */}
      <div className="row g-3 mb-4">
        {verKpi('stock') && (
          <KpiCard
            valor={fmt(stock.total)}
            label="Productos"
            icon="box-seam"
            colorClass="text-info"
            bgClass="bg-info bg-opacity-10"
            sub={stock.alertas > 0 ? `⚠ ${stock.alertas} con stock bajo` : 'Sin alertas'}
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
          />
        )}
      </div>

      {/* ── Fichadas hoy / ayer ──────────────────────── */}
      {(tieneAcceso('rrhh') || resumenAyer) && (
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
                        <i className="bi bi-calendar-check me-1" />Hoy ({fichadas_hoy.length})
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
                            ({resumenAyer.empleados.filter(e => !e.tiene_parte).length > 0
                              ? <span className="text-danger fw-bold">
                                  {resumenAyer.empleados.filter(e => !e.tiene_parte).length} sin parte
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
                  fichadas_hoy.length === 0 ? (
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
                        {resumenAyer.empleados.filter(e => !e.tiene_parte).length > 0 && (
                          <span className="badge bg-danger">
                            {resumenAyer.empleados.filter(e => !e.tiene_parte).length} sin parte
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
                              <span className={`badge ${oc.estado === 'Parcial' ? 'bg-warning text-dark' : 'bg-secondary'}`}>
                                {oc.estado}
                              </span>
                              <div className="text-muted mt-1" style={{ fontSize: '0.72rem' }}>
                                {fmtFecha(oc.fecha)}
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
