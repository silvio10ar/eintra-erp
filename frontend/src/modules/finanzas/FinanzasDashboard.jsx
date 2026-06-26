import { useState, useEffect } from 'react'
import api from '../../api/client'

const fmtM = (n, mon = 'PESO') => {
  const v = parseFloat(n)
  if (!v || isNaN(v)) return '$ 0'
  const sym = mon === 'DÓLAR' ? 'USD ' : mon === 'EURO' ? '€ ' : '$ '
  return sym + v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Muestra importe con su símbolo y, si no es peso, agrega "($ pesos)" entre paréntesis
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

const PERIODOS = [
  { key: 'month',   label: 'Este mes' },
  { key: 'quarter', label: 'Últimos 3 meses' },
  { key: 'year',    label: 'Este año' },
  { key: 'all',     label: 'Todo' },
]

function getDesde(periodo) {
  const hoy = new Date()
  if (periodo === 'month')   return `${hoy.getFullYear()}-${String(hoy.getMonth()+1).padStart(2,'0')}-01`
  if (periodo === 'quarter') { hoy.setMonth(hoy.getMonth() - 2); hoy.setDate(1); return hoy.toISOString().slice(0,10) }
  if (periodo === 'year')    return `${hoy.getFullYear()}-01-01`
  return ''
}

function KpiCard({ label, value, sub, color = '#0d6efd', icon, trend }) {
  return (
    <div className="card border-0 shadow-sm h-100" style={{ borderLeft: `4px solid ${color}` }}>
      <div className="card-body py-3 px-3">
        <div className="d-flex justify-content-between align-items-start">
          <div>
            <p className="small text-muted mb-1 fw-semibold" style={{ letterSpacing: '0.04em', fontSize: '0.72rem' }}>{label.toUpperCase()}</p>
            <p className="fw-bold mb-0" style={{ fontSize: '1.4rem', color, lineHeight: 1.1 }}>{value}</p>
            {sub && <p className="small text-muted mb-0 mt-1">{sub}</p>}
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
  // Construir lista de los últimos 12 meses
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
  const CH = 140  // chart height
  const BW = 10   // bar width
  const GW = 36   // group width
  const PAD = 8
  const svgW = meses.length * GW + PAD * 2

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width="100%" viewBox={`0 0 ${svgW} ${CH + 28}`} preserveAspectRatio="none" style={{ minWidth: 340 }}>
        {/* Grid lines */}
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

export default function FinanzasDashboard() {
  const [periodo, setPeriodo] = useState('year')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    const desde = getDesde(periodo)
    const params = desde ? { desde } : {}
    api.get('/finanzas/dashboard', { params })
      .then(r => setData(r.data))
      .finally(() => setLoading(false))
  }, [periodo])

  if (loading) return (
    <div className="d-flex justify-content-center align-items-center py-5">
      <span className="spinner-border spinner-border-sm me-2 text-primary" />
      <span className="text-muted">Cargando dashboard...</span>
    </div>
  )

  if (!data) return null

  const { kpiC, kpiV, kpiVTotal, porMesC, porMesV, vencimientos, conAnticipo, topProv } = data
  const balance = (kpiV.total || 0) - (kpiC.total || 0)

  return (
    <div className="overflow-auto h-100" style={{ padding: '0 0.25rem 1.5rem' }}>

      {/* ── Período ── */}
      <div className="d-flex align-items-center gap-2 mb-4 flex-wrap">
        <span className="small text-muted fw-semibold me-1">PERÍODO:</span>
        {PERIODOS.map(p => (
          <button key={p.key}
            className={`btn btn-sm py-0 px-3 ${periodo === p.key ? 'btn-primary' : 'btn-outline-secondary'}`}
            style={{ fontSize: '0.8rem' }}
            onClick={() => setPeriodo(p.key)}>
            {p.label}
          </button>
        ))}
      </div>

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
            sub="Ventas − Compras" color={balance >= 0 ? '#198754' : '#dc3545'} icon={balance >= 0 ? 'trending-up' : 'trending-down'} />
        </div>
        <div className="col-6 col-xl-3">
          <div className="card border-0 shadow-sm h-100" style={{ borderLeft: '4px solid #0d6efd' }}>
            <div className="card-body py-3 px-3">
              <div className="d-flex justify-content-between align-items-start">
                <div style={{ minWidth: 0 }}>
                  <p className="small text-muted mb-1 fw-semibold" style={{ letterSpacing: '0.04em', fontSize: '0.72rem' }}>POR COBRAR (TOTAL)</p>
                  <p className="fw-bold mb-0" style={{ fontSize: '1.4rem', color: '#0d6efd', lineHeight: 1.1 }}>
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
                <p className="text-muted small text-center py-3"><i className="bi bi-check-circle text-success d-block mb-1" style={{ fontSize: '1.5rem' }} />Sin vencimientos en 30 días</p>
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
                <p className="text-muted small text-center py-3"><i className="bi bi-check-circle text-success d-block mb-1" style={{ fontSize: '1.5rem' }} />Sin anticipos pendientes</p>
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
