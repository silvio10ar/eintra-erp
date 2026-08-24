import { useState, useEffect, useRef, useCallback } from 'react'
import api from '../../api/client'
import { useGerencias } from '../../hooks/useGerencias'
import { hoyLocal } from '../../utils/fecha'

const ROW_H = 28
const HDR_H = 44

const diasEntre = (a, b) => {
  if (!a || !b) return 0
  return Math.round((new Date(b) - new Date(a)) / 86400000)
}

// ── SVG del Gantt combinado (solo lectura) ────────────────────────────────────
function GanttSVG({ filas, minDate, maxDate, dayW, colorDe }) {
  const DAY_W = dayW
  const totalDias = diasEntre(minDate, maxDate) + 2
  const svgW = totalDias * DAY_W + 20
  const svgH = HDR_H + filas.length * ROW_H + 10

  const xOf = iso => !iso ? 0 : diasEntre(minDate, iso) * DAY_W

  const meses = []
  const cur = new Date(minDate + 'T00:00:00')
  const max = new Date(maxDate + 'T00:00:00')
  while (cur <= max) {
    const y = cur.getFullYear(), m = cur.getMonth()
    const label = cur.toLocaleString('es-AR', { month: 'short', year: '2-digit' })
    const x1 = xOf(cur.toISOString().slice(0, 10))
    const nextM = new Date(y, m + 1, 1)
    const x2 = xOf((nextM <= max ? nextM : new Date(max.getTime() + 86400000)).toISOString().slice(0, 10))
    meses.push({ label, x1, x2 })
    cur.setMonth(cur.getMonth() + 1)
    cur.setDate(1)
  }

  const hoy = hoyLocal()
  const xHoy = xOf(hoy)

  const idxMap = {}
  filas.forEach((f, i) => { if (f.tipo === 'tarea') idxMap[f.id] = i })

  return (
    <svg width={svgW} height={svgH} style={{ display: 'block', fontFamily: 'inherit' }}>
      {filas.map((f, i) => (
        <rect key={i} x={0} y={HDR_H + i * ROW_H} width={svgW} height={ROW_H}
          fill={f.tipo === 'proyecto' ? '#e9ecef' : (i % 2 === 0 ? '#f8f9fa' : '#ffffff')} />
      ))}

      {Array.from({ length: totalDias }, (_, d) => (
        <line key={d} x1={d * DAY_W} y1={HDR_H} x2={d * DAY_W} y2={svgH} stroke="#dee2e6" strokeWidth={0.5} />
      ))}

      <rect x={0} y={0} width={svgW} height={HDR_H} fill="#e9ecef" />
      {meses.map((m, i) => (
        <g key={i}>
          <line x1={m.x1} y1={0} x2={m.x1} y2={HDR_H} stroke="#adb5bd" strokeWidth={1} />
          <text x={(m.x1 + m.x2) / 2} y={14} textAnchor="middle" fontSize={10} fill="#495057" fontWeight="600">{m.label}</text>
        </g>
      ))}

      {hoy >= minDate && hoy <= maxDate && (
        <>
          <line x1={xHoy} y1={HDR_H} x2={xHoy} y2={svgH} stroke="#dc3545" strokeWidth={1.5} strokeDasharray="4 3" />
          <text x={xHoy + 3} y={HDR_H + 10} fontSize={8} fill="#dc3545">Hoy</text>
        </>
      )}

      {filas.map(f =>
        f.tipo === 'tarea' ? (f.predecesoras || []).map(pid => {
          const pi = idxMap[pid]
          if (pi === undefined) return null
          const pred = filas[pi]
          if (!pred.fecha_fin_calc || !f.fecha_inicio_calc) return null
          const x1 = xOf(pred.fecha_fin_calc) + DAY_W
          const y1 = HDR_H + pi * ROW_H + ROW_H / 2
          const x2 = xOf(f.fecha_inicio_calc)
          const y2 = HDR_H + idxMap[f.id] * ROW_H + ROW_H / 2
          const mx = (x1 + x2) / 2
          return (
            <path key={`${pid}-${f.id}`} d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
              fill="none" stroke="#adb5bd" strokeWidth={1} markerEnd="url(#arr)" />
          )
        }) : null
      )}

      {filas.map((f, i) => {
        if (f.tipo !== 'tarea' || !f.fecha_inicio_calc) return null
        const x = xOf(f.fecha_inicio_calc)
        const w = Math.max(diasEntre(f.fecha_inicio_calc, f.fecha_fin_calc) + 1, 1) * DAY_W
        const y = HDR_H + i * ROW_H + 4
        const h = ROW_H - 8
        const color = colorDe(f.area_responsable)
        const pct = Math.min(Math.max(f.avance || 0, 0), 100)
        return (
          <g key={f.id}>
            <rect x={x} y={y} width={w} height={h} rx={3} fill={color} opacity={0.3} />
            {pct > 0 && <rect x={x} y={y} width={w * pct / 100} height={h} rx={3} fill={color} opacity={0.85} />}
            <rect x={x} y={y} width={w} height={h} rx={3} fill="none" stroke={color} strokeWidth={1.2} />
            {w > 30 && (
              <text x={x + w / 2} y={y + h / 2 + 3.5} textAnchor="middle" fontSize={9} fill="#fff" style={{ pointerEvents: 'none' }}>
                {pct > 0 ? `${pct}%` : ''}
              </text>
            )}
          </g>
        )
      })}

      <defs>
        <marker id="arr" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#adb5bd" />
        </marker>
      </defs>
    </svg>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────
export default function PlanGeneral() {
  const { gerencias, colorDe, colorSinArea } = useGerencias()
  const [proyectos, setProyectos] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [zoom,      setZoom]      = useState(4)

  const leftScrollRef  = useRef(null)
  const rightScrollRef = useRef(null)

  const cargar = useCallback(() => {
    setLoading(true)
    api.get('/gantt/plan-general')
      .then(r => setProyectos(r.data))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const handleLeftScroll = () => { if (rightScrollRef.current) rightScrollRef.current.scrollTop = leftScrollRef.current.scrollTop }
  const handleRightScroll = () => { if (leftScrollRef.current) leftScrollRef.current.scrollTop = rightScrollRef.current.scrollTop }

  // Aplana proyectos + tareas en una sola lista de filas (fila "proyecto" = separador)
  const filas = []
  proyectos.forEach(p => {
    filas.push({ tipo: 'proyecto', ...p })
    p.tareas.forEach(t => filas.push({ tipo: 'tarea', ...t, proyecto: p }))
  })

  const fechas = filas.filter(f => f.tipo === 'tarea').flatMap(f => [f.fecha_inicio_calc, f.fecha_fin_calc]).filter(Boolean)
  const minDate = fechas.length ? fechas.reduce((a, b) => a < b ? a : b) : hoyLocal()
  const maxDate = fechas.length ? fechas.reduce((a, b) => a > b ? a : b) : hoyLocal()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, border: '1px solid #dee2e6', borderRadius: 8, background: '#fff', overflow: 'hidden' }}>
      <div style={{ padding: '6px 10px', borderBottom: '1px solid #dee2e6', background: '#f8f9fa', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div className="d-flex align-items-center gap-2 flex-wrap">
          <span className="small fw-semibold text-secondary">
            <i className="bi bi-bar-chart-steps me-1"/>Plan General — {proyectos.length} proyecto{proyectos.length !== 1 ? 's' : ''}
          </span>
          <div className="d-flex align-items-center gap-2 flex-wrap ms-2" style={{ fontSize: '0.7rem' }}>
            {gerencias.map(g => (
              <span key={g} className="d-flex align-items-center gap-1">
                <span style={{ width: 9, height: 9, borderRadius: 2, background: colorDe(g), display: 'inline-block' }}/>
                {g}
              </span>
            ))}
            <span className="d-flex align-items-center gap-1">
              <span style={{ width: 9, height: 9, borderRadius: 2, background: colorSinArea, display: 'inline-block' }}/>
              Sin área
            </span>
          </div>
        </div>
        <div className="d-flex gap-1">
          {[{ label: 'Día', v: 22 }, { label: 'Sem', v: 10 }, { label: 'Mes', v: 4 }, { label: 'Trim', v: 2 }].map(z => (
            <button key={z.v} className={`btn btn-xs py-0 px-2 ${zoom === z.v ? 'btn-primary' : 'btn-outline-secondary'}`}
              style={{ fontSize: '0.7rem' }} onClick={() => setZoom(z.v)}>
              {z.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-5"><span className="spinner-border text-primary" /></div>
      ) : filas.length === 0 ? (
        <div className="text-center text-muted py-5">
          <i className="bi bi-calendar-x d-block fs-4 mb-2"/>
          No hay proyectos activos con un plan de tareas cargado.
        </div>
      ) : (
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
          <div ref={leftScrollRef} onScroll={handleLeftScroll}
            style={{ width: 300, minWidth: 220, flexShrink: 0, overflowY: 'auto', borderRight: '1px solid #dee2e6' }}>
            <div style={{ height: HDR_H, display: 'flex', alignItems: 'center', background: '#f8f9fa', borderBottom: '2px solid #dee2e6', fontSize: '0.72rem', fontWeight: 600, color: '#495057', paddingLeft: 6 }}>
              Proyecto / Tarea
            </div>
            {filas.map((f, i) => f.tipo === 'proyecto' ? (
              <div key={`p${f.id}`} style={{ height: ROW_H, display: 'flex', alignItems: 'center', background: '#e9ecef', borderBottom: '1px solid #dee2e6', fontSize: '0.75rem', fontWeight: 700, color: '#343a40', paddingLeft: 6 }}
                className="text-truncate" title={`${f.codigo} — ${f.nombre}`}>
                {f.codigo} — {f.nombre}
              </div>
            ) : (
              <div key={f.id} style={{ height: ROW_H, display: 'flex', alignItems: 'center', borderBottom: '1px solid #f1f3f5', fontSize: '0.75rem', paddingLeft: 16, gap: 6 }}
                className={i % 2 === 0 ? 'bg-light' : ''}>
                <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: colorDe(f.area_responsable) }} />
                <span className="text-truncate" title={f.nombre}>{f.nombre}</span>
              </div>
            ))}
          </div>

          <div ref={rightScrollRef} onScroll={handleRightScroll} style={{ flex: 1, overflow: 'auto' }}>
            <GanttSVG filas={filas} minDate={minDate} maxDate={maxDate} dayW={zoom} colorDe={colorDe} />
          </div>
        </div>
      )}
    </div>
  )
}
