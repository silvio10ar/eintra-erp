import { hoyLocal } from '../utils/fecha'

const diasEntre = (a, b) => {
  if (!a || !b) return 0
  return Math.round((new Date(b) - new Date(a)) / 86400000)
}

// Dibuja el diagrama de Gantt de un plan de tareas — compartido entre la
// pantalla de edición (PlanGantt) y la vista de impresión/exportación, así
// las dos siempre muestran exactamente el mismo dibujo.
//
// `filas` es la lista de filas VISIBLES, en el mismo orden que se dibuja el
// panel izquierdo — así el dibujo siempre queda alineado con esa lista. Cada
// fila: { id, fecha_inicio_calc, fecha_fin_calc, color, avance, predecesoras,
// esGeneral }. esGeneral: tarea "resumen" real (marca un tramo, no trabajo en
// sí) — se dibuja angosta con puntas, sin barra de avance.
export default function GanttSVG({ filas, dayW = 22 }) {
  if (!filas.length) {
    return <div className="text-center text-muted py-5 small">Sin tareas para mostrar</div>
  }

  const ROW_H  = 28
  const HDR_H  = 44
  const PAD_L  = 0
  const DAY_W  = dayW

  // Rango total de fechas
  const fechas = filas.flatMap(t => [t.fecha_inicio_calc, t.fecha_fin_calc]).filter(Boolean)
  if (!fechas.length) return (
    <div className="text-center text-muted py-5 small">
      <i className="bi bi-calendar-x d-block fs-4 mb-2"/>
      Las fechas se calculan al guardar cada tarea.<br/>
      Si el proyecto no tiene fecha de inicio se usa la fecha actual.
    </div>
  )

  const minDate = new Date(fechas.reduce((a, b) => a < b ? a : b) + 'T00:00:00')
  const maxDate = new Date(fechas.reduce((a, b) => a > b ? a : b) + 'T00:00:00')
  const totalDias = diasEntre(minDate.toISOString().slice(0, 10), maxDate.toISOString().slice(0, 10)) + 2

  const svgW = PAD_L + totalDias * DAY_W + 20
  const svgH = HDR_H + filas.length * ROW_H + 10

  const xOf = iso => {
    if (!iso) return PAD_L
    return PAD_L + diasEntre(minDate.toISOString().slice(0, 10), iso) * DAY_W
  }

  // Meses en el header
  const meses = []
  const cur = new Date(minDate)
  while (cur <= maxDate) {
    const y = cur.getFullYear(), m = cur.getMonth()
    const label = cur.toLocaleString('es-AR', { month: 'short', year: '2-digit' })
    const x1 = xOf(cur.toISOString().slice(0, 10))
    // avanzar hasta fin de mes o fin de rango
    const nextM = new Date(y, m + 1, 1)
    const x2 = xOf((nextM <= maxDate ? nextM : new Date(maxDate.getTime() + 86400000)).toISOString().slice(0, 10))
    meses.push({ label, x1, x2 })
    cur.setMonth(cur.getMonth() + 1)
    cur.setDate(1)
  }

  // Hoy
  const hoy = hoyLocal()
  const xHoy = xOf(hoy)

  // Mapa id → orden para flechas.
  const idxMap = {}
  filas.forEach((t, i) => { idxMap[t.id] = i })

  return (
    <div style={{ overflowX: 'auto', overflowY: 'visible' }}>
      <svg width={svgW} height={svgH} style={{ display: 'block', fontFamily: 'inherit' }}>
        {/* ── fondo alternado ── */}
        {filas.map((f, i) => (
          <rect key={f.id} x={0} y={HDR_H + i * ROW_H} width={svgW} height={ROW_H}
            fill={i % 2 === 0 ? '#f8f9fa' : '#ffffff'} />
        ))}

        {/* ── líneas verticales de días ── */}
        {Array.from({ length: totalDias }, (_, d) => (
          <line key={d} x1={PAD_L + d * DAY_W} y1={HDR_H} x2={PAD_L + d * DAY_W} y2={svgH}
            stroke="#dee2e6" strokeWidth={0.5} />
        ))}

        {/* ── Header: meses ── */}
        <rect x={0} y={0} width={svgW} height={HDR_H} fill="#e9ecef" />
        {meses.map((m, i) => (
          <g key={i}>
            <line x1={m.x1} y1={0} x2={m.x1} y2={HDR_H} stroke="#adb5bd" strokeWidth={1} />
            <text x={(m.x1 + m.x2) / 2} y={14} textAnchor="middle" fontSize={10} fill="#495057" fontWeight="600">
              {m.label}
            </text>
          </g>
        ))}

        {/* ── Números de día ── */}
        {Array.from({ length: totalDias }, (_, d) => {
          const dd = new Date(minDate); dd.setDate(dd.getDate() + d)
          const dn = dd.getDate()
          return dn % 5 === 0 || dn === 1 ? (
            <text key={d} x={PAD_L + d * DAY_W + DAY_W / 2} y={32} textAnchor="middle" fontSize={8} fill="#6c757d">
              {dn}
            </text>
          ) : null
        })}

        {/* ── Línea de hoy ── */}
        {hoy >= minDate.toISOString().slice(0, 10) && hoy <= maxDate.toISOString().slice(0, 10) && (
          <>
            <line x1={xHoy} y1={HDR_H} x2={xHoy} y2={svgH} stroke="#dc3545" strokeWidth={1.5} strokeDasharray="4 3" />
            <text x={xHoy + 3} y={HDR_H + 10} fontSize={8} fill="#dc3545">Hoy</text>
          </>
        )}

        {/* ── Flechas de dependencia ── */}
        {filas.map(t =>
          (t.predecesoras || []).map(pid => {
            const pi = idxMap[pid]
            if (pi === undefined) return null
            const pred = filas[pi]
            if (!pred.fecha_fin_calc || !t.fecha_inicio_calc) return null
            const x1 = xOf(pred.fecha_fin_calc) + DAY_W
            const y1 = HDR_H + pi * ROW_H + ROW_H / 2
            const x2 = xOf(t.fecha_inicio_calc)
            const y2 = HDR_H + idxMap[t.id] * ROW_H + ROW_H / 2
            const mx = (x1 + x2) / 2
            return (
              <g key={`${pid}-${t.id}`}>
                <path d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                  fill="none" stroke="#6c757d" strokeWidth={1.2} markerEnd="url(#arr)" />
              </g>
            )
          })
        )}

        {/* ── Barras ── */}
        {filas.map((t, i) => {
          const x = xOf(t.fecha_inicio_calc)
          const w = Math.max(diasEntre(t.fecha_inicio_calc, t.fecha_fin_calc) + 1, 1) * DAY_W
          const yMid = HDR_H + i * ROW_H + ROW_H / 2
          const color = t.color || '#4e79a7'
          const pct = Math.min(Math.max(t.avance || 0, 0), 100)

          // Tarea general/resumen: barra angosta con puntas, estilo MS Project
          // — marca un tramo del plan, no es trabajo real, así que no compite
          // visualmente con las barras de tareas.
          if (t.esGeneral) {
            const h = 5
            const y = yMid - h / 2
            const wReal = Math.max(w, DAY_W)
            const tri = 5
            return (
              <g key={t.id}>
                <rect x={x} y={y} width={wReal} height={h} fill="#495057" />
                <path d={`M ${x} ${yMid - tri} L ${x + tri} ${yMid} L ${x} ${yMid + tri} L ${x - tri} ${yMid} Z`} fill="#495057" />
                <path d={`M ${x + wReal} ${yMid - tri} L ${x + wReal + tri} ${yMid} L ${x + wReal} ${yMid + tri} L ${x + wReal - tri} ${yMid} Z`} fill="#495057" />
              </g>
            )
          }

          // Tarea normal.
          const h = ROW_H - 8
          const y = yMid - h / 2
          return (
            <g key={t.id}>
              {/* barra fondo */}
              <rect x={x} y={y} width={w} height={h} rx={3} fill={color} opacity={0.3} />
              {/* avance */}
              {pct > 0 && (
                <rect x={x} y={y} width={w * pct / 100} height={h} rx={3} fill={color} opacity={0.85} />
              )}
              {/* borde */}
              <rect x={x} y={y} width={w} height={h} rx={3} fill="none" stroke={color} strokeWidth={1.2} />
              {/* texto si hay espacio */}
              {w > 30 && (
                <text x={x + w / 2} y={y + h / 2 + 3.5} textAnchor="middle" fontSize={9} fill="#fff"
                  style={{ pointerEvents: 'none' }}>
                  {pct > 0 ? `${pct}%` : ''}
                </text>
              )}
            </g>
          )
        })}

        {/* ── Marcador de flecha ── */}
        <defs>
          <marker id="arr" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="#6c757d" />
          </marker>
        </defs>
      </svg>
    </div>
  )
}
