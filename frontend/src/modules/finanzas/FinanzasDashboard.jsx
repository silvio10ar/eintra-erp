import { useState, useEffect } from 'react'
import api from '../../api/client'

const fmtM = (n, mon = 'PESO') => {
  const v = parseFloat(n)
  if (!v || isNaN(v)) return '$ 0'
  const sym = mon === 'DÓLAR' ? 'USD ' : mon === 'EURO' ? '€ ' : '$ '
  return sym + v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const fmtImporte = (importe, moneda, tasa_cambio) => {
  const v = parseFloat(importe) || 0
  const tc = parseFloat(tasa_cambio) || 1
  const sym = moneda === 'DÓLAR' ? 'USD ' : moneda === 'EURO' ? '€ ' : '$ '
  const str = sym + v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (moneda === 'PESO' || tc <= 1) return str
  const pesos = v * tc
  return (
    <span>
      {str}
      <span className="text-muted" style={{ fontSize: '0.72em', display: 'block' }}>
        ($ {pesos.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })})
      </span>
    </span>
  )
}

const fmtK = n => {
  const v = Math.abs(parseFloat(n) || 0)
  if (v >= 1e9) return (v / 1e9).toFixed(1) + 'B'
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K'
  return v.toFixed(0)
}

const fmtF = s => {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

const fmtDT = s => {
  if (!s) return '—'
  const parts = s.split(' ')
  const [y, m, d] = parts[0].split('-')
  const hora = parts[1] ? parts[1].slice(0, 5) : ''
  return `${d}/${m} ${hora}`
}

const VISTAS = [
  { key: 'hoy',   label: 'Estado Hoy', icon: 'speedometer2' },
  { key: 'month', label: 'Este Mes',   icon: 'calendar-month' },
  { key: 'year',  label: 'Este Año',   icon: 'calendar3' },
  { key: 'all',   label: 'Histórico',  icon: 'archive' },
]

function getDesde(key) {
  const hoy = new Date()
  if (key === 'month') return `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-01`
  if (key === 'year')  return `${hoy.getFullYear()}-01-01`
  return ''
}

function Spinner() {
  return (
    <div className="d-flex justify-content-center align-items-center py-5">
      <span className="spinner-border spinner-border-sm me-2 text-primary" />
      <span className="text-muted">Cargando...</span>
    </div>
  )
}

function KpiCard({ label, value, sub, color = '#0d6efd', icon }) {
  return (
    <div className="card border-0 shadow-sm h-100" style={{ borderLeft: `4px solid ${color}` }}>
      <div className="card-body py-3 px-3">
        <div className="d-flex justify-content-between align-items-start">
          <div style={{ minWidth: 0 }}>
            <p className="small text-muted mb-1 fw-semibold" style={{ letterSpacing: '0.04em', fontSize: '0.72rem' }}>{label.toUpperCase()}</p>
            <p className="fw-bold mb-0" style={{ fontSize: '1.35rem', color, lineHeight: 1.1 }}>{value}</p>
            {sub && <p className="small text-muted mb-0 mt-1" style={{ fontSize: '0.73rem' }}>{sub}</p>}
          </div>
          <div className="rounded-circle d-flex align-items-center justify-content-center"
            style={{ width: 38, height: 38, background: color + '18', flexShrink: 0 }}>
            <i className={`bi bi-${icon}`} style={{ color, fontSize: '1rem' }} />
          </div>
        </div>
      </div>
    </div>
  )
}

function BarraEstado({ pagado, con_anticipo, pendiente }) {
  const total = (pagado||0) + (con_anticipo||0) + (pendiente||0)
  if (!total) return <div className="text-muted small">Sin datos</div>
  const pPag  = (pagado / total * 100).toFixed(1)
  const pAnt  = (con_anticipo / total * 100).toFixed(1)
  const pPend = (pendiente / total * 100).toFixed(1)
  return (
    <div>
      <div className="d-flex rounded overflow-hidden mb-2" style={{ height: 14 }}>
        {pagado > 0 && <div style={{ width: pPag + '%', background: '#198754' }} title={`Pagado: ${pPag}%`} />}
        {con_anticipo > 0 && <div style={{ width: pAnt + '%', background: '#ffc107' }} title={`Anticipo: ${pAnt}%`} />}
        {pendiente > 0 && <div style={{ width: pPend + '%', background: '#dee2e6' }} title={`Pendiente: ${pPend}%`} />}
      </div>
      <div className="d-flex gap-3" style={{ fontSize: '0.72rem' }}>
        <span><span style={{ display:'inline-block', width:8, height:8, borderRadius:2, background:'#198754', marginRight:4 }} />Pagado {pPag}%</span>
        <span><span style={{ display:'inline-block', width:8, height:8, borderRadius:2, background:'#ffc107', marginRight:4 }} />Anticipo {pAnt}%</span>
        <span><span style={{ display:'inline-block', width:8, height:8, borderRadius:2, background:'#dee2e6', border:'1px solid #adb5bd', marginRight:4 }} />Pendiente {pPend}%</span>
      </div>
    </div>
  )
}

function GraficoBarras({ porMesC, porMesV }) {
  const meses = []
  const hoy = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
    const lbl = d.toLocaleDateString('es-AR', { month: 'short' }).replace('.','')
    const c = porMesC.find(r => r.mes === key)?.total || 0
    const v = porMesV.find(r => r.mes === key)?.total || 0
    meses.push({ key, lbl, c, v })
  }
  const max = Math.max(...meses.flatMap(m => [m.c, m.v]), 1)
  const CH = 140
  const BW = 10
  const GW = 36
  const PAD = 8
  const svgW = meses.length * GW + PAD * 2
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width="100%" viewBox={`0 0 ${svgW} ${CH + 28}`} preserveAspectRatio="none" style={{ minWidth: 340 }}>
        {[0.25, 0.5, 0.75, 1].map(f => (
          <line key={f} x1={PAD} x2={svgW - PAD} y1={CH - f * CH} y2={CH - f * CH} stroke="#e9ecef" strokeWidth="0.5" />
        ))}
        {meses.map((m, i) => {
          const x = PAD + i * GW
          const hC = (m.c / max) * CH
          const hV = (m.v / max) * CH
          return (
            <g key={m.key}>
              {m.c > 0 && <rect x={x + 2} y={CH - hC} width={BW} height={hC} fill="#dc354580" rx="2">
                <title>Compras {m.lbl}: {fmtM(m.c)}</title>
              </rect>}
              {m.v > 0 && <rect x={x + BW + 5} y={CH - hV} width={BW} height={hV} fill="#19875480" rx="2">
                <title>Ventas {m.lbl}: {fmtM(m.v)}</title>
              </rect>}
              <text x={x + GW/2} y={CH + 14} textAnchor="middle" fontSize="8.5" fill="#6c757d">{m.lbl}</text>
            </g>
          )
        })}
        <line x1={PAD} x2={svgW - PAD} y1={CH} y2={CH} stroke="#dee2e6" strokeWidth="1" />
      </svg>
      <div className="d-flex gap-3 justify-content-center mt-1" style={{ fontSize: '0.75rem' }}>
        <span><span style={{ display:'inline-block', width:10, height:10, borderRadius:2, background:'#dc354580', marginRight:4 }} />Compras</span>
        <span><span style={{ display:'inline-block', width:10, height:10, borderRadius:2, background:'#19875480', marginRight:4 }} />Ventas</span>
      </div>
    </div>
  )
}

function TopProvBar({ nombre, total, max }) {
  const pct = Math.max(3, (total / max) * 100)
  return (
    <div className="mb-2">
      <div className="d-flex justify-content-between mb-1" style={{ fontSize: '0.78rem' }}>
        <span className="text-truncate" style={{ maxWidth: '65%' }} title={nombre}>{nombre}</span>
        <span className="text-muted fw-semibold">{fmtK(total)}</span>
      </div>
      <div className="rounded" style={{ height: 5, background: '#f1f3f5' }}>
        <div className="rounded" style={{ height: 5, width: pct + '%', background: '#0d6efd80' }} />
      </div>
    </div>
  )
}

function alertaVcto(fechaVcto, hoy) {
  if (!fechaVcto) return 'sinFecha'
  if (fechaVcto < hoy)  return 'vencida'
  if (fechaVcto === hoy) return 'hoy'
  const d7 = new Date(hoy); d7.setDate(d7.getDate() + 7)
  if (new Date(fechaVcto + 'T00:00:00') <= d7) return 'semana'
  return 'mes'
}

function FacturasListCard({ titulo, icono, color, facturas, hoy }) {
  const grupos = [
    { key: 'vencida',  label: 'Vencidas',     color: 'danger' },
    { key: 'hoy',      label: 'Vencen hoy',   color: 'danger' },
    { key: 'semana',   label: 'Esta semana',  color: 'warning' },
    { key: 'mes',      label: 'Próximas',     color: 'secondary' },
    { key: 'sinFecha', label: 'Sin fecha',    color: 'secondary' },
  ]
  const porGrupo = {}
  facturas.forEach(f => {
    const g = alertaVcto(f.fecha_vencimiento, hoy)
    if (!porGrupo[g]) porGrupo[g] = []
    porGrupo[g].push(f)
  })
  const visibles = grupos.filter(g => porGrupo[g.key]?.length > 0)

  return (
    <div className="card border-0 shadow-sm h-100">
      <div className="card-body">
        <p className="fw-semibold mb-3" style={{ fontSize: '0.85rem' }}>
          <i className={`bi bi-${icono} me-2`} style={{ color }} />
          {titulo}
          <span className="badge ms-2 text-white" style={{ fontSize: '0.65rem', background: color }}>{facturas.length}</span>
        </p>
        {facturas.length === 0 ? (
          <p className="text-muted small text-center py-3">
            <i className="bi bi-check-circle text-success d-block mb-1" style={{ fontSize: '1.5rem' }} />
            Sin facturas pendientes
          </p>
        ) : (
          <div style={{ maxHeight: 340, overflowY: 'auto', fontSize: '0.78rem' }}>
            {visibles.map(({ key, label, color: col }) => (
              <div key={key} className="mb-3">
                <div className={`fw-bold text-${col} mb-1`} style={{ fontSize: '0.68rem', letterSpacing: '0.04em' }}>
                  {label.toUpperCase()} ({porGrupo[key].length})
                </div>
                {porGrupo[key].map(f => {
                  const dias = f.fecha_vencimiento
                    ? Math.ceil((new Date(f.fecha_vencimiento + 'T00:00:00') - new Date(hoy + 'T00:00:00')) / 86400000)
                    : null
                  return (
                    <div key={f.id} className="d-flex justify-content-between align-items-center py-2 border-bottom gap-2">
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="text-truncate fw-semibold" style={{ maxWidth: 200 }} title={f.nombre}>{f.nombre || '—'}</div>
                        <div className="text-muted" style={{ fontSize: '0.7rem' }}>{f.numero}</div>
                      </div>
                      <div className="text-end flex-shrink-0">
                        <div className="fw-semibold">{fmtM(f.saldo_pesos)}</div>
                        <div className={`text-${col}`} style={{ fontSize: '0.7rem' }}>
                          {dias === null ? 'Sin fecha'
                            : dias < 0  ? `Hace ${-dias}d`
                            : dias === 0 ? 'Hoy'
                            : `${dias}d · ${fmtF(f.fecha_vencimiento)}`}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Vista Diaria ──────────────────────────────────────────────────────────────

function BankCard({ sb }) {
  const echeq = sb.echeq_pendiente || 0
  const disponible = sb.monto - echeq
  return (
    <div className="card border-0 shadow-sm h-100" style={{ borderLeft: '4px solid #0d6efd' }}>
      <div className="card-body py-3 px-3">
        <div className="d-flex justify-content-between align-items-start">
          <div style={{ minWidth: 0, flex: 1 }}>
            <p className="small text-muted mb-1 fw-semibold" style={{ letterSpacing: '0.04em', fontSize: '0.72rem' }}>
              {sb.entidad.toUpperCase()}
            </p>
            {echeq > 0 ? (
              <>
                <div style={{ fontSize: '0.78rem', lineHeight: 1.7 }}>
                  <div className="text-muted">Saldo:&nbsp;<span className="fw-semibold text-dark">{fmtM(sb.monto, sb.moneda)}</span></div>
                  <div className="text-danger">E-CHEQs:&nbsp;<span className="fw-semibold">−{fmtM(echeq, sb.moneda)}</span></div>
                </div>
                <p className="fw-bold mb-0 mt-1" style={{ fontSize: '1.25rem', color: '#0d6efd', lineHeight: 1.1 }}>
                  {fmtM(disponible, sb.moneda)}
                </p>
                <p className="mb-0" style={{ fontSize: '0.68rem', color: '#198754', fontWeight: 600 }}>disponible</p>
              </>
            ) : (
              <>
                <p className="fw-bold mb-0" style={{ fontSize: '1.35rem', color: '#0d6efd', lineHeight: 1.1 }}>
                  {fmtM(sb.monto, sb.moneda)}
                </p>
                <p className="small text-muted mb-0 mt-1" style={{ fontSize: '0.73rem' }}>
                  Registrado {fmtDT(sb.created_at)}
                </p>
              </>
            )}
          </div>
          <div className="rounded-circle d-flex align-items-center justify-content-center"
            style={{ width: 38, height: 38, background: '#0d6efd18', flexShrink: 0 }}>
            <i className="bi bi-bank" style={{ color: '#0d6efd', fontSize: '1rem' }} />
          </div>
        </div>
      </div>
    </div>
  )
}

function DailyView({ data, onConfirmar }) {
  if (!data) return null
  const { saldosBancarios, serviciosPendientes, comprasPendientes, ventasPendientes, facturasPorPagar = [], facturasPorCobrar = [], vencimientosProximos, echeqsEmitidos, ivaData, tipoCambioBNA } = data
  const hoy = new Date().toISOString().slice(0, 10)

  const vencidas = serviciosPendientes.filter(s => s.alerta === 'vencida')
  const hoyS    = serviciosPendientes.filter(s => s.alerta === 'hoy')
  const semanaS = serviciosPendientes.filter(s => s.alerta === 'semana')
  const mesS    = serviciosPendientes.filter(s => s.alerta === 'mes')

  const hayAlertas = serviciosPendientes.length > 0 || vencimientosProximos.length > 0

  return (
    <div>
      {/* ── KPIs: Bancos + Facturas pendientes ── */}
      <div className="row g-3 mb-4">
        {saldosBancarios.length === 0
          ? (
            <div className="col-6 col-lg-3">
              <KpiCard label="Saldo bancario" value="—" sub="Sin registros" color="#6c757d" icon="bank" />
            </div>
          )
          : saldosBancarios.map(sb => (
            <div key={sb.entidad} className="col-6 col-lg-3">
              <BankCard sb={sb} />
            </div>
          ))
        }
        {tipoCambioBNA && (
          <div className="col-6 col-lg-3">
            <KpiCard
              label="TC BNA Dólar"
              value={`$ ${parseFloat(tipoCambioBNA.valor).toLocaleString('es-AR', { minimumFractionDigits: 2 })}`}
              sub={tipoCambioBNA.fecha || tipoCambioBNA.created_at?.slice(0,10)}
              color="#198754" icon="currency-exchange"
            />
          </div>
        )}
        <div className="col-6 col-lg-3">
          <KpiCard
            label="Por pagar (Compras)"
            value={`$ ${fmtK(comprasPendientes.total_pesos)}`}
            sub={`${comprasPendientes.count} factura${comprasPendientes.count !== 1 ? 's' : ''} pendiente${comprasPendientes.count !== 1 ? 's' : ''}`}
            color="#dc3545" icon="cart3"
          />
        </div>
        <div className="col-6 col-lg-3">
          <KpiCard
            label="Por cobrar (Ventas)"
            value={`$ ${fmtK(ventasPendientes.total_pesos)}`}
            sub={`${ventasPendientes.count} factura${ventasPendientes.count !== 1 ? 's' : ''} pendiente${ventasPendientes.count !== 1 ? 's' : ''}`}
            color="#198754" icon="shop"
          />
        </div>
      </div>

      {/* ── E-CHEQs emitidos ── */}
      {echeqsEmitidos && echeqsEmitidos.length > 0 && (
        <div className="card border-0 shadow-sm mb-4" style={{ borderLeft: '4px solid #fd7e14' }}>
          <div className="card-body">
            <p className="fw-semibold mb-3" style={{ fontSize: '0.85rem' }}>
              <i className="bi bi-file-earmark-check me-2" style={{ color: '#fd7e14' }} />E-CHEQs emitidos pendientes de débito
              <span className="badge ms-2 text-dark" style={{ fontSize: '0.65rem', background: '#fd7e14' }}>{echeqsEmitidos.length}</span>
            </p>
            <div style={{ fontSize: '0.78rem' }}>
              {echeqsEmitidos.map(e => {
                const diasRest = e.fecha_acreditacion
                  ? Math.ceil((new Date(e.fecha_acreditacion + 'T00:00:00') - new Date()) / 86400000)
                  : null
                const colorD = diasRest === null ? 'secondary' : diasRest <= 0 ? 'danger' : diasRest <= 3 ? 'warning' : 'secondary'
                return (
                  <div key={e.id} className="d-flex justify-content-between align-items-center py-2 border-bottom gap-2">
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <span className="fw-semibold text-truncate d-inline-block" style={{ maxWidth: 180 }}>{e.proveedor_nombre}</span>
                      <div className="text-muted">{e.factura_numero}</div>
                    </div>
                    <div className="text-center flex-shrink-0" style={{ fontSize: '0.72rem' }}>
                      <span className="badge bg-light text-dark border">{e.entidad || '—'}</span>
                    </div>
                    <div className="text-end flex-shrink-0">
                      <div className="fw-semibold text-danger">−{fmtM(e.importe, e.moneda)}</div>
                      <span className={`text-${colorD}`} style={{ fontSize: '0.7rem' }}>
                        {diasRest === null
                          ? 'Sin fecha débito'
                          : diasRest <= 0
                            ? 'Débita hoy / vencido'
                            : `${diasRest}d · ${fmtF(e.fecha_acreditacion)}`}
                      </span>
                    </div>
                    <div className="flex-shrink-0">
                      <button className="btn btn-sm btn-success py-0 px-2" style={{ fontSize: '0.72rem' }}
                        title="Confirmar débito bancario"
                        onClick={async () => {
                          if (!confirm(`¿Confirmar que el E-CHEQ de ${e.proveedor_nombre} fue debitado del banco?`)) return
                          await api.patch(`/finanzas/facturas-compra/${e.factura_id}/pagos/${e.id}/confirmar`)
                          onConfirmar?.()
                        }}>
                        <i className="bi bi-check-lg me-1" />Confirmar
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── IVA acumulado ── */}
      {ivaData && ivaData.length > 0 && (
        <div className="card border-0 shadow-sm mb-4" style={{ borderLeft: '4px solid #6f42c1' }}>
          <div className="card-body">
            <p className="fw-semibold mb-3" style={{ fontSize: '0.85rem' }}>
              <i className="bi bi-percent me-2" style={{ color: '#6f42c1' }} />Posición IVA mensual
            </p>
            <div className="row g-3">
              {ivaData.map((m, i) => {
                const posicion = (m.iva_ventas || 0) - (m.iva_compras || 0) - (m.perc_iva_compras || 0)
                const esFavor = posicion <= 0
                return (
                  <div key={m.mes} className={`col-md-4`}>
                    <div className="rounded p-2" style={{ background: i === 0 ? '#f8f5ff' : '#f8f9fa', border: i === 0 ? '1px solid #d8c8f0' : '1px solid #dee2e6' }}>
                      <div className="fw-semibold text-capitalize mb-2" style={{ fontSize: '0.78rem', color: i === 0 ? '#6f42c1' : '#6c757d' }}>
                        {i === 0 ? '▶ ' : ''}{m.label}
                      </div>
                      <div style={{ fontSize: '0.75rem', lineHeight: 1.9 }}>
                        <div className="d-flex justify-content-between">
                          <span className="text-muted">Débito (ventas):</span>
                          <span className="fw-semibold text-success">{fmtM(m.iva_ventas)}</span>
                        </div>
                        <div className="d-flex justify-content-between">
                          <span className="text-muted">Crédito IVA (compras):</span>
                          <span className="fw-semibold text-danger">−{fmtM(m.iva_compras)}</span>
                        </div>
                        {(m.perc_iva_compras || 0) !== 0 && (
                          <div className="d-flex justify-content-between">
                            <span className="text-muted">Percepciones IVA:</span>
                            <span className="fw-semibold text-danger">−{fmtM(m.perc_iva_compras)}</span>
                          </div>
                        )}
                        <hr className="my-1" />
                        <div className="d-flex justify-content-between align-items-center">
                          <span className="fw-bold" style={{ fontSize: '0.78rem' }}>Posición:</span>
                          <span className="fw-bold" style={{ fontSize: '0.88rem', color: esFavor ? '#198754' : '#fd7e14' }}>
                            {esFavor
                              ? `A favor ${fmtM(-posicion)}`
                              : `A pagar ${fmtM(posicion)}`}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Todo en orden ── */}
      {!hayAlertas && (
        <div className="card border-0 shadow-sm mb-3" style={{ borderLeft: '4px solid #198754' }}>
          <div className="card-body py-3 px-3 d-flex align-items-center gap-2">
            <i className="bi bi-check-circle-fill text-success" style={{ fontSize: '1.5rem' }} />
            <div>
              <div className="fw-semibold text-success">Todo en orden</div>
              <div className="small text-muted">Sin servicios pendientes ni vencimientos próximos en 30 días</div>
            </div>
          </div>
        </div>
      )}

      {/* ── Facturas por pagar / por cobrar ── */}
      <div className="row g-3 mb-4">
        <div className="col-lg-6">
          <FacturasListCard
            titulo="Facturas por pagar"
            icono="cart3"
            color="#dc3545"
            facturas={facturasPorPagar}
            hoy={hoy}
          />
        </div>
        <div className="col-lg-6">
          <FacturasListCard
            titulo="Facturas por cobrar"
            icono="shop"
            color="#198754"
            facturas={facturasPorCobrar}
            hoy={hoy}
          />
        </div>
      </div>

      {hayAlertas && (
        <div className="row g-3">
          {/* ── Servicios con alerta ── */}
          {serviciosPendientes.length > 0 && (
            <div className={vencimientosProximos.length > 0 ? 'col-lg-7' : 'col-12'}>
              <div className="card border-0 shadow-sm h-100">
                <div className="card-body">
                  <p className="fw-semibold mb-3" style={{ fontSize: '0.85rem' }}>
                    <i className="bi bi-lightning-charge me-2 text-warning" />Servicios pendientes
                    <span className="badge bg-warning text-dark ms-2" style={{ fontSize: '0.65rem' }}>{serviciosPendientes.length}</span>
                  </p>
                  <div style={{ fontSize: '0.8rem' }}>
                    {[
                      { grupo: vencidas, label: 'Vencidos',     color: 'danger' },
                      { grupo: hoyS,     label: 'Vencen hoy',   color: 'danger' },
                      { grupo: semanaS,  label: 'Esta semana',  color: 'warning' },
                      { grupo: mesS,     label: 'Este mes',     color: 'secondary' },
                    ].filter(g => g.grupo.length > 0).map(({ grupo, label, color }) => (
                      <div key={label} className="mb-3">
                        <div className={`fw-bold text-${color} mb-2`} style={{ fontSize: '0.72rem', letterSpacing: '0.04em' }}>
                          {label.toUpperCase()}
                        </div>
                        {grupo.map(s => (
                          <div key={s.cuota_id} className="d-flex justify-content-between align-items-center py-2 border-bottom">
                            <div style={{ minWidth: 0 }}>
                              <span className="text-truncate d-inline-block" style={{ maxWidth: 200 }}>{s.descripcion}</span>
                              {s.usuario && (
                                <span className="text-muted ms-1" style={{ fontSize: '0.72rem' }}>({s.usuario})</span>
                              )}
                              <div className="text-muted" style={{ fontSize: '0.7rem' }}>{s.periodicidad}</div>
                            </div>
                            <div className="text-end flex-shrink-0 ms-2">
                              {s.monto ? (
                                <span className="fw-semibold">{fmtM(s.monto)}</span>
                              ) : (
                                <span className="text-muted fst-italic" style={{ fontSize: '0.75rem' }}>monto s/d</span>
                              )}
                              <div className={`text-${color}`} style={{ fontSize: '0.7rem' }}>{fmtF(s.vencimiento)}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Vencimientos próximos 7 días ── */}
          {vencimientosProximos.length > 0 && (
            <div className={serviciosPendientes.length > 0 ? 'col-lg-5' : 'col-12'}>
              <div className="card border-0 shadow-sm h-100">
                <div className="card-body">
                  <p className="fw-semibold mb-3" style={{ fontSize: '0.85rem' }}>
                    <i className="bi bi-clock-history me-2 text-danger" />Vencimientos próximos
                    <span className="badge bg-danger ms-2" style={{ fontSize: '0.65rem' }}>{vencimientosProximos.length}</span>
                    <span className="text-muted ms-1" style={{ fontSize: '0.72rem' }}>· próximos 7 días</span>
                  </p>
                  <div style={{ fontSize: '0.78rem' }}>
                    {vencimientosProximos.map((v, i) => {
                      const diasRest = Math.ceil((new Date(v.fecha_vencimiento + 'T00:00:00') - new Date()) / 86400000)
                      const colorV = diasRest <= 0 ? 'danger' : diasRest <= 2 ? 'warning' : 'secondary'
                      return (
                        <div key={i} className="d-flex justify-content-between align-items-center py-2 border-bottom">
                          <div style={{ minWidth: 0 }}>
                            <span className={`badge bg-${v.tipo === 'compra' ? 'danger' : 'success'} me-1`} style={{ fontSize: '0.6rem' }}>
                              {v.tipo === 'compra' ? 'C' : 'V'}
                            </span>
                            <span className="text-truncate d-inline-block" style={{ maxWidth: 140 }} title={v.nombre}>{v.nombre}</span>
                            <br />
                            <span className="text-muted">{v.numero}</span>
                          </div>
                          <div className="text-end flex-shrink-0">
                            <div className="fw-semibold">{fmtImporte(v.importe, v.moneda, v.tasa_cambio)}</div>
                            <span className={`text-${colorV}`} style={{ fontSize: '0.7rem' }}>
                              {diasRest <= 0 ? 'Hoy / Vencida' : `${diasRest}d · ${fmtF(v.fecha_vencimiento)}`}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Vista Periódica ───────────────────────────────────────────────────────────

function PeriodView({ data }) {
  if (!data) return null
  const { kpiC, kpiV, kpiVTotal, porMesC, porMesV, vencimientos, conAnticipo, topProv } = data
  const balance = (kpiV.total || 0) - (kpiC.total || 0)

  return (
    <div>
      {/* ── KPIs ── */}
      <div className="row g-3 mb-4">
        <div className="col-6 col-xl-3">
          <KpiCard label="Compras" value={`$ ${fmtK(kpiC.total)}`}
            sub={`${kpiC.count} facturas`} color="#dc3545" icon="cart3" />
        </div>
        <div className="col-6 col-xl-3">
          <KpiCard label="Ventas" value={`$ ${fmtK(kpiV.total)}`}
            sub={`${kpiV.count} facturas`} color="#198754" icon="shop" />
        </div>
        <div className="col-6 col-xl-3">
          <KpiCard label="Balance" value={`${balance >= 0 ? '+' : ''}$ ${fmtK(balance)}`}
            sub="Ventas − Compras" color={balance >= 0 ? '#198754' : '#dc3545'} icon={balance >= 0 ? 'graph-up-arrow' : 'graph-down-arrow'} />
        </div>
        <div className="col-6 col-xl-3">
          <div className="card border-0 shadow-sm h-100" style={{ borderLeft: '4px solid #0d6efd' }}>
            <div className="card-body py-3 px-3">
              <div className="d-flex justify-content-between align-items-start">
                <div style={{ minWidth: 0 }}>
                  <p className="small text-muted mb-1 fw-semibold" style={{ letterSpacing: '0.04em', fontSize: '0.72rem' }}>POR COBRAR (TOTAL)</p>
                  <p className="fw-bold mb-0" style={{ fontSize: '1.35rem', color: '#0d6efd', lineHeight: 1.1 }}>
                    $ {fmtK((kpiVTotal?.pendiente||0) + (kpiVTotal?.saldo_anticipo||0))}
                  </p>
                  <p className="small text-muted mb-0 mt-1">Toda la deuda pendiente</p>
                </div>
                <div className="rounded-circle d-flex align-items-center justify-content-center"
                  style={{ width: 38, height: 38, background: '#0d6efd18', flexShrink: 0 }}>
                  <i className="bi bi-currency-dollar" style={{ color: '#0d6efd', fontSize: '1rem' }} />
                </div>
              </div>
              <hr className="my-2" />
              <p className="small mb-0">
                <span className="text-muted" style={{ fontSize: '0.75rem' }}>Período seleccionado: </span>
                <strong style={{ color: '#0d6efd' }}>$ {fmtK((kpiV.pendiente||0) + (kpiV.saldo_anticipo||0))}</strong>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Gráfico + Estado pagos ── */}
      <div className="row g-3 mb-4">
        <div className="col-lg-7">
          <div className="card border-0 shadow-sm h-100">
            <div className="card-body">
              <p className="fw-semibold mb-3" style={{ fontSize: '0.85rem' }}>
                <i className="bi bi-bar-chart me-2 text-primary" />Evolución mensual
              </p>
              <GraficoBarras porMesC={porMesC} porMesV={porMesV} />
            </div>
          </div>
        </div>
        <div className="col-lg-5">
          <div className="card border-0 shadow-sm h-100">
            <div className="card-body">
              <p className="fw-semibold mb-3" style={{ fontSize: '0.85rem' }}>
                <i className="bi bi-pie-chart me-2 text-primary" />Estado de pagos
              </p>
              <div className="mb-3">
                <p className="small text-muted mb-2 fw-semibold">COMPRAS</p>
                <BarraEstado pagado={kpiC.pagado} con_anticipo={kpiC.con_anticipo} pendiente={kpiC.pendiente} />
                <div className="d-flex gap-3 mt-1" style={{ fontSize: '0.78rem' }}>
                  <span className="text-danger">Pendiente: <strong>{fmtM(kpiC.pendiente)}</strong></span>
                  {kpiC.saldo_anticipo > 0 && <span className="text-warning">Saldo anticipo: <strong>{fmtM(kpiC.saldo_anticipo)}</strong></span>}
                </div>
              </div>
              <hr className="my-2" />
              <div>
                <p className="small text-muted mb-2 fw-semibold">VENTAS</p>
                <BarraEstado pagado={kpiV.pagado} con_anticipo={kpiV.con_anticipo} pendiente={kpiV.pendiente} />
                <div className="d-flex gap-3 mt-1" style={{ fontSize: '0.78rem' }}>
                  <span className="text-success">Por cobrar: <strong>{fmtM(kpiV.pendiente)}</strong></span>
                  {kpiV.saldo_anticipo > 0 && <span className="text-warning">Saldo anticipo: <strong>{fmtM(kpiV.saldo_anticipo)}</strong></span>}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Vencimientos + Anticipo + Top Proveedores ── */}
      <div className="row g-3">
        <div className="col-lg-4">
          <div className="card border-0 shadow-sm h-100">
            <div className="card-body">
              <p className="fw-semibold mb-3" style={{ fontSize: '0.85rem' }}>
                <i className="bi bi-clock-history me-2 text-danger" />Vencimientos próximos
                <span className="badge bg-danger ms-2" style={{ fontSize: '0.65rem' }}>{vencimientos.length}</span>
              </p>
              {vencimientos.length === 0 ? (
                <p className="text-muted small text-center py-3">
                  <i className="bi bi-check-circle text-success d-block mb-1" style={{ fontSize: '1.5rem' }} />
                  Sin vencimientos en 30 días
                </p>
              ) : (
                <div style={{ fontSize: '0.78rem' }}>
                  {vencimientos.map((v, i) => {
                    const diasRest = Math.ceil((new Date(v.fecha_vencimiento + 'T00:00:00') - new Date()) / 86400000)
                    const color = diasRest < 0 ? 'danger' : diasRest <= 7 ? 'warning' : 'secondary'
                    return (
                      <div key={i} className="d-flex justify-content-between align-items-center py-2 border-bottom">
                        <div style={{ minWidth: 0 }}>
                          <span className={`badge bg-${v.tipo === 'compra' ? 'danger' : 'success'} me-1`} style={{ fontSize: '0.6rem' }}>
                            {v.tipo === 'compra' ? 'C' : 'V'}
                          </span>
                          <span className="text-truncate d-inline-block" style={{ maxWidth: 130 }} title={v.nombre}>{v.nombre}</span>
                          <br />
                          <span className="text-muted">{v.numero}</span>
                        </div>
                        <div className="text-end flex-shrink-0">
                          <div className="fw-semibold">{fmtImporte(v.anticipo > 0 ? v.importe - v.anticipo : v.importe, v.moneda, v.tasa_cambio)}</div>
                          <span className={`text-${color}`} style={{ fontSize: '0.7rem' }}>
                            {diasRest < 0 ? `Vencida hace ${-diasRest}d` : diasRest === 0 ? 'Hoy' : `${diasRest}d`}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="col-lg-4">
          <div className="card border-0 shadow-sm h-100">
            <div className="card-body">
              <p className="fw-semibold mb-3" style={{ fontSize: '0.85rem' }}>
                <i className="bi bi-hourglass-split me-2 text-warning" />Con anticipo (saldo pendiente)
                <span className="badge bg-warning text-dark ms-2" style={{ fontSize: '0.65rem' }}>{conAnticipo.length}</span>
              </p>
              {conAnticipo.length === 0 ? (
                <p className="text-muted small text-center py-3">
                  <i className="bi bi-check-circle text-success d-block mb-1" style={{ fontSize: '1.5rem' }} />
                  Sin anticipos pendientes
                </p>
              ) : (
                <div style={{ fontSize: '0.78rem' }}>
                  {conAnticipo.map((f, i) => (
                    <div key={i} className="d-flex justify-content-between align-items-center py-2 border-bottom">
                      <div style={{ minWidth: 0 }}>
                        <span className={`badge bg-${f.tipo === 'compra' ? 'danger' : 'success'} me-1`} style={{ fontSize: '0.6rem' }}>
                          {f.tipo === 'compra' ? 'C' : 'V'}
                        </span>
                        <span className="text-truncate d-inline-block" style={{ maxWidth: 130 }} title={f.nombre}>{f.nombre}</span>
                        <br />
                        <span className="text-muted">{f.fecha_anticipo ? fmtF(f.fecha_anticipo) : '—'}</span>
                      </div>
                      <div className="text-end flex-shrink-0">
                        <div className="fw-semibold text-warning">{fmtImporte(f.importe - f.anticipo, f.moneda, f.tasa_cambio)}</div>
                        <div className="text-muted" style={{ fontSize: '0.7rem' }}>saldo / {fmtImporte(f.importe, f.moneda, f.tasa_cambio)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="col-lg-4">
          <div className="card border-0 shadow-sm h-100">
            <div className="card-body">
              <p className="fw-semibold mb-3" style={{ fontSize: '0.85rem' }}>
                <i className="bi bi-building me-2 text-primary" />Top proveedores
              </p>
              {topProv.length === 0 ? (
                <p className="text-muted small text-center py-3">Sin datos</p>
              ) : (() => {
                const max = topProv[0].total
                return topProv.map((p, i) => <TopProvBar key={i} nombre={p.nombre} total={p.total} max={max} />)
              })()}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function FinanzasDashboard() {
  const [vista, setVista] = useState('hoy')
  const [dataDiario, setDataDiario] = useState(null)
  const [loadingD, setLoadingD]     = useState(false)
  const [data, setData]             = useState(null)
  const [loading, setLoading]       = useState(false)

  const cargarDiario = () => {
    setLoadingD(true)
    api.get('/finanzas/dashboard-diario')
      .then(r => setDataDiario(r.data))
      .finally(() => setLoadingD(false))
  }

  useEffect(() => {
    if (vista !== 'hoy') return
    cargarDiario()
  }, [vista])

  useEffect(() => {
    if (vista === 'hoy') return
    setLoading(true)
    const desde = getDesde(vista)
    const params = desde ? { desde } : {}
    api.get('/finanzas/dashboard', { params })
      .then(r => setData(r.data))
      .finally(() => setLoading(false))
  }, [vista])

  return (
    <div className="overflow-auto h-100" style={{ padding: '0 0.25rem 1.5rem' }}>
      <div className="d-flex align-items-center gap-2 mb-4 flex-wrap">
        {VISTAS.map(v => (
          <button key={v.key}
            className={`btn btn-sm py-1 px-3 ${vista === v.key ? 'btn-primary' : 'btn-outline-secondary'}`}
            style={{ fontSize: '0.82rem' }}
            onClick={() => setVista(v.key)}>
            <i className={`bi bi-${v.icon} me-1`} />{v.label}
          </button>
        ))}
      </div>

      {vista === 'hoy'
        ? (loadingD ? <Spinner /> : <DailyView data={dataDiario} onConfirmar={cargarDiario} />)
        : (loading  ? <Spinner /> : <PeriodView data={data} />)
      }
    </div>
  )
}
