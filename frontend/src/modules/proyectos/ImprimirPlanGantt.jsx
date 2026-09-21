import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import api from '../../api/client'
import { hoyLocal } from '../../utils/fecha'
import logo from '../../assets/logo.avif'

const fmtF = s => s ? s.slice(0, 10).split('-').reverse().join('/') : '—'
const ESTADO_CLASE = { Pendiente: '#6c757d', 'En proceso': '#0d6efd', Completado: '#198754', Cancelado: '#dc3545', Bloqueado: '#fd7e14' }
const diasEntre = (a, b) => { if (!a || !b) return 0; return Math.round((new Date(b) - new Date(a)) / 86400000) }

const ROW_H = 26
const HDR_H = 40
const DAY_W = 6

export default function ImprimirPlanGantt() {
  const { id } = useParams()
  const [proyecto, setProyecto] = useState(null)
  const [tareas, setTareas] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      api.get(`/proyectos/${id}`),
      api.get(`/gantt/proyecto/${id}/tareas`),
    ]).then(([rp, rt]) => { setProyecto(rp.data); setTareas(rt.data) })
      .catch(() => setError('No se pudo cargar el plan de este proyecto'))
  }, [id])

  useEffect(() => {
    if (proyecto && tareas) setTimeout(() => window.print(), 500)
  }, [proyecto, tareas])

  if (error) return <div className="p-4 text-danger">{error}</div>
  if (!proyecto || !tareas) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
      <div className="spinner-border text-primary" />
    </div>
  )

  const avancePromedio = tareas.length
    ? Math.round(tareas.reduce((s, t) => s + (t.avance || 0), 0) / tareas.length)
    : 0

  // Una sola escala de fechas para TODO el proyecto (no una por hoja) — así el
  // calendario del encabezado es el mismo de principio a fin, y cada fila usa
  // su propio SVG chiquito (una barra) en vez de un único dibujo gigante que
  // el navegador no puede partir entre hojas. La paginación la hace el propio
  // navegador con una <table> real: corta donde corresponde, sin adivinar
  // cuántas filas entran, y repite el encabezado de columnas en cada hoja.
  const fechas = tareas.flatMap(t => [t.fecha_inicio_calc, t.fecha_fin_calc]).filter(Boolean)
  const hayFechas = fechas.length > 0
  const minDate = hayFechas ? new Date(fechas.reduce((a, b) => a < b ? a : b) + 'T00:00:00') : null
  const maxDate = hayFechas ? new Date(fechas.reduce((a, b) => a > b ? a : b) + 'T00:00:00') : null
  const totalDias = hayFechas ? diasEntre(minDate.toISOString().slice(0, 10), maxDate.toISOString().slice(0, 10)) + 2 : 0
  const svgW = hayFechas ? totalDias * DAY_W + 20 : 200
  const xOf = iso => !iso || !hayFechas ? 0 : diasEntre(minDate.toISOString().slice(0, 10), iso) * DAY_W
  const hoy = hoyLocal()
  const hoyVisible = hayFechas && hoy >= minDate.toISOString().slice(0, 10) && hoy <= maxDate.toISOString().slice(0, 10)
  const xHoy = hoyVisible ? xOf(hoy) : 0

  // Meses para la regla del encabezado — se dibuja una sola vez y se repite
  // igual en cada hoja porque vive en el <thead>.
  const meses = []
  if (hayFechas) {
    const cur = new Date(minDate)
    while (cur <= maxDate) {
      const y = cur.getFullYear(), m = cur.getMonth()
      const label = cur.toLocaleString('es-AR', { month: 'short', year: '2-digit' })
      const x1 = xOf(cur.toISOString().slice(0, 10))
      const nextM = new Date(y, m + 1, 1)
      const x2 = xOf((nextM <= maxDate ? nextM : new Date(maxDate.getTime() + 86400000)).toISOString().slice(0, 10))
      meses.push({ label, x1, x2 })
      cur.setMonth(cur.getMonth() + 1)
      cur.setDate(1)
    }
  }

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        body { margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 10pt; color: #222; }
        @media print {
          @page { size: A3 landscape; margin: 8mm; }
          .no-print { display: none !important; }
          body { font-size: 9pt; }
        }
        .page { max-width: 1550px; margin: 0 auto; padding: 14px; background: rgba(255,255,255,.94); }
        .header { background: #1a3c6e; color: #fff; padding: 12px 18px;
                  display: flex; justify-content: space-between; align-items: center;
                  border-radius: 4px 4px 0 0; }
        .header-left { display: flex; align-items: center; }
        .header-logo { height: 46px; width: auto; flex-shrink: 0; }
        .header-right   { text-align: right; }
        .header-right h2 { margin: 0; font-size: 1.05rem; font-weight: 600; }
        .header-right p  { margin: 2px 0 0; font-size: 0.74rem; opacity: 0.85; }
        .info-block { border: 1px solid #1a3c6e; border-top: none;
                     padding: 8px 16px; display: flex; flex-wrap: wrap; gap: 18px;
                     font-size: 0.78rem; margin-bottom: 10px; }
        .info-block b { color: #1a3c6e; }

        /* Tabla real: el navegador la pagina solo, repitiendo el <thead>
           (identificación del proyecto + encabezado de columnas) en cada
           hoja — nada de adivinar cuántas filas entran a mano. */
        table.gantt { border-collapse: collapse; table-layout: fixed; }
        table.gantt thead { display: table-header-group; }
        .gt-proj td { background: #1a3c6e; color: #fff; font-weight: 600; font-size: 8pt; padding: 5px 8px; }
        .gt-labels th { background: #e9ecef; font-size: 7.3pt; font-weight: 600; color: #495057;
                        border-bottom: 1px solid #adb5bd; padding: 3px 4px; text-align: left; overflow: hidden; }
        .gt-labels th.c { text-align: center; }
        .gt-row td { font-size: 8pt; padding: 0 4px; border-bottom: 1px solid #f0f0f0; height: ${ROW_H}px;
                     overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
                     break-inside: avoid; page-break-inside: avoid; }
        .gt-row td.c { text-align: center; }
        .gt-row:nth-child(even) td { background: #f8f9fa; }
        .gt-row td.num { color: #6c757d; }
        .gt-row td.area { color: #6c757d; font-size: 7.3pt; }
        .gt-row td.fechas { color: #6c757d; font-size: 7pt; }
        .gt-row td.estado { font-weight: 600; font-size: 7.3pt; }
        .gt-row td.timeline, .gt-labels th.timeline { padding: 0; overflow: visible; }

        .legend { display: flex; gap: 16px; margin-top: 8px; font-size: 8pt; color: #6c757d; }
        .page-foot { margin-top: 14px; border-top: 1px solid #ddd; padding-top: 6px;
                     font-size: 7.5pt; color: #999; text-align: center;
                     display: flex; align-items: center; justify-content: center; gap: 6px; }
        .foot-logo { height: 20px; width: auto; opacity: .9; }
      `}</style>

      {/* Barra de impresión */}
      <div className="no-print" style={{
        padding: '8px 16px', background: '#f0f0f0', borderBottom: '1px solid #ccc',
        display: 'flex', gap: 8, alignItems: 'center',
      }}>
        <button onClick={() => window.print()}
          style={{ padding: '5px 14px', background: '#1a3c6e', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
          🖨 Imprimir / Guardar PDF
        </button>
        <button onClick={() => window.close()}
          style={{ padding: '5px 14px', background: '#fff', border: '1px solid #ccc', borderRadius: 4, cursor: 'pointer' }}>
          Cerrar
        </button>
        <span style={{ marginLeft: 8, color: '#666', fontSize: '0.82rem' }}>
          Para guardar como PDF elegí "Guardar como PDF" en el destino de impresión y tamaño de papel <b>A3</b> — el navegador corta las hojas solo, aprovechando todo el espacio de cada una.
        </span>
      </div>

      <div className="page">
        {/* Encabezado */}
        <div className="header">
          <div className="header-left">
            <img src={logo} alt="E-INTRA SRL" className="header-logo" />
          </div>
          <div className="header-right">
            <h2>PLAN DE PROYECTO</h2>
            <p>Generado el {fmtF(new Date().toISOString())}</p>
          </div>
        </div>

        {/* Datos del proyecto */}
        <div className="info-block">
          <div><b>Proyecto:</b> {proyecto.codigo} — {proyecto.nombre}</div>
          {proyecto.cliente_nombre && <div><b>Cliente:</b> {proyecto.cliente_nombre}</div>}
          {proyecto.responsable && <div><b>Responsable:</b> {proyecto.responsable}</div>}
          <div><b>Estado:</b> {proyecto.estado}</div>
          {proyecto.fecha_inicio && <div><b>Inicio:</b> {fmtF(proyecto.fecha_inicio)}</div>}
          {proyecto.fecha_fin_est && <div><b>Fin estimado:</b> {fmtF(proyecto.fecha_fin_est)}</div>}
          <div><b>Tareas:</b> {tareas.length}</div>
          <div><b>Avance promedio:</b> {avancePromedio}%</div>
        </div>

        <table className="gantt">
          <colgroup>
            <col style={{ width: 22 }} /><col style={{ width: 230 }} /><col style={{ width: 58 }} />
            <col style={{ width: 32 }} /><col style={{ width: 76 }} /><col style={{ width: 62 }} />
            <col style={{ width: 34 }} /><col style={{ width: svgW + 6 }} />
          </colgroup>
          <thead>
            <tr className="gt-proj">
              <td colSpan={8}>{proyecto.codigo} — {proyecto.nombre}</td>
            </tr>
            <tr className="gt-labels">
              <th>#</th><th>Tarea</th><th>Área</th><th className="c">Días</th>
              <th>Fechas</th><th>Estado</th><th className="c">Av.</th>
              <th className="timeline">
                {hayFechas && (
                  <svg width={svgW} height={HDR_H} style={{ display: 'block' }}>
                    {meses.map((m, i) => (
                      <g key={i}>
                        <line x1={m.x1} y1={0} x2={m.x1} y2={HDR_H} stroke="#adb5bd" strokeWidth={1} />
                        <text x={(m.x1 + m.x2) / 2} y={HDR_H / 2 + 3} textAnchor="middle" fontSize={9} fill="#495057" fontWeight="600">
                          {m.label}
                        </text>
                      </g>
                    ))}
                  </svg>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {tareas.map((t, i) => {
              const x = xOf(t.fecha_inicio_calc)
              const w = Math.max(diasEntre(t.fecha_inicio_calc, t.fecha_fin_calc) + 1, 1) * DAY_W
              const color = t.color || '#4e79a7'
              const pct = Math.min(Math.max(t.avance || 0, 0), 100)
              return (
                <tr key={t.id} className="gt-row">
                  <td className="num c">{i + 1}</td>
                  <td title={t.nombre}>{t.nombre}</td>
                  <td className="area" title={t.area_responsable}>{t.area_responsable || '—'}</td>
                  <td className="c">{t.duracion_dias}d</td>
                  <td className="fechas">{fmtF(t.fecha_inicio_calc)}–{fmtF(t.fecha_fin_calc)}</td>
                  <td className="estado" style={{ color: ESTADO_CLASE[t.estado] || '#222' }}>{t.estado}</td>
                  <td className="c">{pct}%</td>
                  <td className="timeline">
                    {hayFechas && (
                      <svg width={svgW} height={ROW_H} style={{ display: 'block' }}>
                        {meses.map((m, mi) => (
                          <line key={mi} x1={m.x1} y1={0} x2={m.x1} y2={ROW_H} stroke="#eee" strokeWidth={1} />
                        ))}
                        {hoyVisible && <line x1={xHoy} y1={0} x2={xHoy} y2={ROW_H} stroke="#dc3545" strokeWidth={1.2} strokeDasharray="3 2" />}
                        {t.es_general ? (
                          // Tarea general/resumen: mismo estilo MS-Project que ya usa
                          // GanttSVG.jsx en pantalla (barra angosta con puntas, sin %
                          // de avance) — antes acá se dibujaba como una tarea normal,
                          // así que en el PDF exportado se veía distinta a la pantalla.
                          (() => {
                            const yMid = ROW_H / 2, h = 5, y = yMid - h / 2, tri = 5
                            return (
                              <g>
                                <rect x={x} y={y} width={w} height={h} fill="#495057" />
                                <path d={`M ${x} ${yMid - tri} L ${x + tri} ${yMid} L ${x} ${yMid + tri} L ${x - tri} ${yMid} Z`} fill="#495057" />
                                <path d={`M ${x + w} ${yMid - tri} L ${x + w + tri} ${yMid} L ${x + w} ${yMid + tri} L ${x + w - tri} ${yMid} Z`} fill="#495057" />
                              </g>
                            )
                          })()
                        ) : (
                          <>
                            <rect x={x} y={4} width={w} height={ROW_H - 8} rx={3} fill={color} opacity={0.3} />
                            {pct > 0 && <rect x={x} y={4} width={w * pct / 100} height={ROW_H - 8} rx={3} fill={color} opacity={0.85} />}
                            <rect x={x} y={4} width={w} height={ROW_H - 8} rx={3} fill="none" stroke={color} strokeWidth={1} />
                            {w > 26 && (
                              <text x={x + w / 2} y={ROW_H / 2 + 3} textAnchor="middle" fontSize={8} fill="#fff" style={{ pointerEvents: 'none' }}>
                                {pct > 0 ? `${pct}%` : ''}
                              </text>
                            )}
                          </>
                        )}
                      </svg>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {tareas.length > 0 && (
          <div className="legend">
            <span><span style={{ display: 'inline-block', width: 12, height: 8, background: 'rgba(78,121,167,0.3)', border: '1px solid #4e79a7', borderRadius: 2, marginRight: 4 }}/>Planificado</span>
            <span><span style={{ display: 'inline-block', width: 12, height: 8, background: '#4e79a7', borderRadius: 2, marginRight: 4 }}/>Avance real</span>
            <span><span style={{ display: 'inline-block', width: 1, height: 10, background: '#dc3545', marginRight: 4 }}/>Hoy</span>
          </div>
        )}

        <div className="page-foot">
          <img src={logo} alt="" className="foot-logo" />
          E-INTRA SRL · silvio.licenziato@e-intrasrl.com
        </div>
      </div>
    </>
  )
}
