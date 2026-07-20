import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'
import ExcelJS from 'exceljs'
import api from '../../api/client'
import DateInput from '../../components/DateInput'

// ── Estilo corporativo para exports .xlsx (ExcelJS) ───────────────────────────
const CORP = {
  navy:   'FF1A3A5C',
  navyTx: 'FFFFFFFF',
  gris:   'FFF2F2F2',
  borde:  'FFD9D9D9',
  verde:  'FF198754',
  naranja:'FFFD7E14',
  rojo:   'FFDC3545',
  totalBg:'FFDCE6F1',
}
const bordeFino = { style: 'thin', color: { argb: CORP.borde } }
function estiloTitulo(ws, fila, texto, colDesde, colHasta) {
  ws.mergeCells(fila, colDesde, fila, colHasta)
  const c = ws.getCell(fila, colDesde)
  c.value = texto
  c.font = { bold: true, color: { argb: CORP.navyTx }, size: 12 }
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CORP.navy } }
  c.alignment = { vertical: 'middle', horizontal: 'left' }
  ws.getRow(fila).height = 22
}
function estiloHeader(row) {
  row.eachCell(c => {
    c.font = { bold: true, color: { argb: CORP.navyTx } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CORP.navy } }
    c.alignment = { vertical: 'middle', horizontal: 'center' }
    c.border = { top: bordeFino, bottom: bordeFino, left: bordeFino, right: bordeFino }
  })
  row.height = 18
}
function estiloCeldas(row, bg) {
  row.eachCell(c => {
    c.border = { top: bordeFino, bottom: bordeFino, left: bordeFino, right: bordeFino }
    if (bg) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } }
  })
}
async function descargarWorkbook(wb, nombreArchivo) {
  const buf  = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = nombreArchivo; a.click()
  URL.revokeObjectURL(url)
}
// Dibuja el gráfico de barras de asistencia por empleado en un <canvas> y lo devuelve como PNG (base64)
function dibujarGraficoAsistenciaPNG(resumen) {
  const filas = resumen.slice().sort((a,b) => (b.inasistencia+b.tarde) - (a.inasistencia+a.tarde))
  const W = 760, ROWH = 26, PADTOP = 34, PADBOTTOM = 34, LABELW = 150, INFOW = 150
  const H = PADTOP + Math.max(filas.length, 1) * ROWH + PADBOTTOM
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H)
  ctx.font = 'bold 14px Arial'; ctx.fillStyle = '#1a3a5c'
  ctx.fillText('Asistencia por empleado', 0, 18)

  const barX = LABELW, barW = W - LABELW - INFOW
  filas.forEach((t, i) => {
    const y = PADTOP + i * ROWH
    const total = t.ok + t.tarde + t.inasistencia || 1
    ctx.font = '11px Arial'; ctx.fillStyle = '#212529'; ctx.textAlign = 'left'
    let nombre = t.empleado
    while (ctx.measureText(nombre).width > LABELW - 8 && nombre.length > 3) nombre = nombre.slice(0, -1)
    ctx.fillText(nombre, 0, y + 14)

    let x = barX
    const bh = 14
    ;[[t.ok, '#198754'], [t.tarde, '#fd7e14'], [t.inasistencia, '#dc3545']].forEach(([v, color]) => {
      const w = (v / total) * barW
      if (w > 0) { ctx.fillStyle = color; ctx.fillRect(x, y + 3, w, bh) }
      x += w
    })
    ctx.fillStyle = '#6c757d'; ctx.font = '10px Arial'
    ctx.fillText(`${t.ok} OK · ${t.tarde} tarde · ${t.inasistencia} inasist.`, barX + barW + 8, y + 13)
  })

  const legY = H - 20
  let lx = 0
  ;[['Presente', '#198754'], ['Tarde', '#fd7e14'], ['Inasistencia', '#dc3545']].forEach(([label, color]) => {
    ctx.fillStyle = color; ctx.fillRect(lx, legY, 10, 10)
    ctx.fillStyle = '#212529'; ctx.font = '10px Arial'; ctx.fillText(label, lx + 14, legY + 9)
    lx += ctx.measureText(label).width + 40
  })

  return { base64: canvas.toDataURL('image/png').split(',')[1], width: W, height: H }
}

const ANOS  = Array.from({ length: 9 }, (_, i) => 2020 + i)
const MESES = [
  { v: '', l: 'Todos los meses' },
  { v: '01', l: 'Enero'      }, { v: '02', l: 'Febrero'   }, { v: '03', l: 'Marzo'      },
  { v: '04', l: 'Abril'      }, { v: '05', l: 'Mayo'       }, { v: '06', l: 'Junio'      },
  { v: '07', l: 'Julio'      }, { v: '08', l: 'Agosto'     }, { v: '09', l: 'Septiembre' },
  { v: '10', l: 'Octubre'    }, { v: '11', l: 'Noviembre'  }, { v: '12', l: 'Diciembre'  },
]

function fmtH(h) {
  if (!h && h !== 0) return '—'
  const hh = Math.floor(h), mm = Math.round((h - hh) * 60)
  return mm > 0 ? `${hh}h ${mm}m` : `${hh}h`
}
function fmtF(f) {
  if (!f) return '—'
  const [y, m, d] = f.split('-')
  return `${d}/${m}/${y}`
}

export default function RRHH() {
  const [tab,       setTab]       = useState('dashboard')
  const [dash,      setDash]      = useState(null)
  const [registros, setRegistros] = useState([])
  const [empleados, setEmpleados] = useState([])
  const [proyectosMain,    setProyectosMain]    = useState([])
  const [proyectosActivos, setProyectosActivos] = useState([])
  const [actividades,      setActividades]      = useState([])
  const [modalAct,         setModalAct]         = useState(null)
  const [categorias,setCategorias]= useState([])
  const [loading,   setLoading]   = useState(false)
  const [saving,    setSaving]    = useState(false)

  // filtros período
  const [year,  setYear]  = useState(new Date().getFullYear())
  const [month, setMonth] = useState('')
  const [fEmp,  setFEmp]  = useState('')
  const [fProy, setFProy] = useState('')

  // modales — el objeto ES el form
  const [modalReg,   setModalReg]   = useState(null)
  const [modalEmp,   setModalEmp]   = useState(null)
  const [modalDisp,  setModalDisp]  = useState(null)
  const [verInactivos, setVerInactivos] = useState(false)

  // parte diario
  const [parteEmp,     setParteEmp]     = useState('')
  const [parteDate,    setParteDate]    = useState(new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }))
  const [parteFilas,   setParteFilas]   = useState([])
  const [savingParte,  setSavingParte]  = useState(false)

  // asistencia
  const [asistencia,   setAsistencia]   = useState([])
  const [dispositivos, setDispositivos] = useState([])
  const [syncDesde,    setSyncDesde]    = useState(new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }))
  const [syncHasta,    setSyncHasta]    = useState(new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }))
  const [syncLoading,  setSyncLoading]  = useState(false)
  const [syncResult,   setSyncResult]   = useState(null)
  const [fAsistFecha,  setFAsistFecha]  = useState(new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }))
  const [fAsistEmp,    setFAsistEmp]    = useState('')
  const [empDispositivo, setEmpDispositivo] = useState([])

  // informes
  const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
  const primerDiaMes = hoy.substring(0, 7) + '-01'
  const [infTab,        setInfTab]        = useState('asistencia')
  const [infDesde,      setInfDesde]      = useState(primerDiaMes)
  const [infHasta,      setInfHasta]      = useState(hoy)
  const [infEmpleado,   setInfEmpleado]   = useState('')
  const [infData,       setInfData]       = useState(null)
  const [infLoading,    setInfLoading]    = useState(false)
  const [infExportando, setInfExportando] = useState(false)
  const [feriados,      setFeriados]      = useState([])
  const [nuevoFeriado,  setNuevoFeriado]  = useState({ fecha: '', descripcion: '' })

  // ── fusionador ─────────────────────────────────────────────────────────────
  const [legado,       setLegado]       = useState([])
  const [legadoLoad,   setLegadoLoad]   = useState(false)
  const [fusSelect,    setFusSelect]    = useState({}) // { [legado_id]: proyectos_id_seleccionado }

  // ── datos maestros ─────────────────────────────────────────────────────────
  useEffect(() => {
    Promise.all([
      api.get('/rrhh/categorias'),
      api.get('/rrhh/empleados'),
      api.get('/rrhh/proyectos'),
      api.get('/rrhh/dispositivos'),
      api.get('/rrhh/asistencia/empleados-dispositivo'),
      api.get('/proyectos?estado=Activo'),
      api.get('/rrhh/actividades'),
    ]).then(([c, e, pm, d, ed, pa, act]) => {
      setCategorias(c.data)
      setEmpleados(e.data)
      setProyectosMain(pm.data)
      setDispositivos(d.data)
      setEmpDispositivo(ed.data)
      setActividades(act.data)
      setProyectosActivos(pa.data)
    }).catch(() => {})
  }, [])

  const [verLecturas, setVerLecturas] = useState(false)

  const cargarAsistencia = useCallback(() => {
    const q = new URLSearchParams({
      desde: fAsistFecha,
      hasta: fAsistFecha,
      ...(fAsistEmp && { empleado_id: fAsistEmp }),
    }).toString()
    const endpoint = verLecturas ? `/rrhh/asistencia?${q}` : `/rrhh/asistencia/resumen?${q}`
    api.get(endpoint).then(r => setAsistencia(r.data)).catch(() => {})
  }, [fAsistFecha, fAsistEmp, verLecturas])

  // ── dashboard ──────────────────────────────────────────────────────────────
  const cargarDash = useCallback(() => {
    setLoading(true)
    const q = new URLSearchParams({ year, ...(month && { month }) }).toString()
    api.get(`/rrhh/dashboard?${q}`)
      .then(r => setDash(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [year, month])

  // ── registros ──────────────────────────────────────────────────────────────
  const cargarReg = useCallback(() => {
    setLoading(true)
    const q = new URLSearchParams({
      year,
      ...(month && { month }),
      ...(fEmp  && { empleado_id: fEmp  }),
      ...(fProy && { proyecto_id: fProy }),
    }).toString()
    api.get(`/rrhh/registros?${q}`)
      .then(r => setRegistros(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [year, month, fEmp, fProy])

  useEffect(() => { if (tab === 'dashboard')   cargarDash()      }, [tab, cargarDash])
  useEffect(() => { if (tab === 'registros')   cargarReg()       }, [tab, cargarReg])
  useEffect(() => { if (tab === 'asistencia')  cargarAsistencia() }, [tab, cargarAsistencia])

  // ── feriados (para el informe de asistencia) ──────────────────────────────
  const cargarFeriados = useCallback(() => {
    const anio = (infDesde || hoy).slice(0, 4)
    api.get('/rrhh/feriados', { params: { anio } }).then(r => setFeriados(r.data)).catch(() => {})
  }, [infDesde])
  useEffect(() => { if (tab === 'informes' && infTab === 'asistencia') cargarFeriados() }, [tab, infTab, cargarFeriados])

  async function agregarFeriado() {
    if (!nuevoFeriado.fecha) return
    try {
      await api.post('/rrhh/feriados', nuevoFeriado)
      setNuevoFeriado({ fecha: '', descripcion: '' })
      cargarFeriados()
    } catch (e) { alert(e.response?.data?.error || 'Error al agregar feriado') }
  }
  async function eliminarFeriado(fecha) {
    try {
      await api.delete(`/rrhh/feriados/${fecha}`)
      cargarFeriados()
    } catch (e) { alert(e.response?.data?.error || 'Error al eliminar feriado') }
  }

  const reloadEmpleados = () => api.get('/rrhh/empleados').then(r => setEmpleados(r.data))
  const reloadProyectos  = () => Promise.all([
    api.get('/rrhh/proyectos'),
    api.get('/proyectos?estado=Activo'),
  ]).then(([pm, pa]) => { setProyectosMain(pm.data); setProyectosActivos(pa.data) })
  const reloadActividades = () => api.get('/rrhh/actividades').then(r => setActividades(r.data))

  // ── acciones dispositivo ──────────────────────────────────────────────────
  function guardarDispositivo() {
    const m = modalDisp
    if (!m.ip?.trim()) { alert('La IP es obligatoria'); return }
    setSaving(true)
    const req = m.id ? api.put(`/rrhh/dispositivos/${m.id}`, m) : api.post('/rrhh/dispositivos', m)
    req.then(() => {
      setModalDisp(null)
      api.get('/rrhh/dispositivos').then(r => setDispositivos(r.data))
    }).catch(e => alert(e.response?.data?.error || 'Error al guardar'))
      .finally(() => setSaving(false))
  }

  function testDispositivo() {
    const m = modalDisp
    if (!m.id) { alert('Guardá el dispositivo primero'); return }
    api.post(`/rrhh/dispositivos/${m.id}/test`)
      .then(r => alert(`Conexión exitosa\nDispositivo: ${r.data.nombre || 'OK'}`))
      .catch(e => alert(`Error: ${e.response?.data?.error || e.message}`))
  }

  function cargarEmpDispositivo() {
    api.get('/rrhh/asistencia/empleados-dispositivo').then(r => setEmpDispositivo(r.data)).catch(() => {})
  }

  function sincronizar() {
    const disp = dispositivos[0]
    if (!disp) { alert('Configurá el dispositivo primero'); return }
    setSyncLoading(true)
    setSyncResult(null)
    api.post(`/rrhh/dispositivos/${disp.id}/sync`, { desde: syncDesde, hasta: syncHasta })
      .then(r => {
        setSyncResult(r.data)
        api.get('/rrhh/dispositivos').then(d => setDispositivos(d.data))
        cargarAsistencia()
        cargarEmpDispositivo()
      })
      .catch(e => {
        const msg = e.response?.data?.error || e.response?.data || e.message || 'Error al sincronizar'
        alert('Error al sincronizar:\n' + (typeof msg === 'object' ? JSON.stringify(msg) : msg))
      })
      .finally(() => setSyncLoading(false))
  }

  // ── acciones ───────────────────────────────────────────────────────────────
  function guardarRegistro() {
    const m = modalReg
    if (!m.fecha || !m.empleado_id || !m.horas) {
      alert('Fecha, empleado y horas son obligatorios')
      return
    }
    setSaving(true)
    const esActividad = m.asignacion?.startsWith('a:')
    const asigId = m.asignacion ? Number(m.asignacion.slice(2)) : null
    const payload = {
      ...m,
      proyecto_id:  esActividad ? null : (asigId || null),
      actividad_id: esActividad ? asigId : null,
    }
    const req = m.id ? api.put(`/rrhh/registros/${m.id}`, payload) : api.post('/rrhh/registros', payload)
    req.then(() => {
      setModalReg(null)
      cargarReg()
      if (tab === 'dashboard') cargarDash()
    }).catch(e => alert(e.response?.data?.error || 'Error al guardar'))
      .finally(() => setSaving(false))
  }

  function eliminarRegistro(id) {
    if (!confirm('¿Eliminar este registro?')) return
    api.delete(`/rrhh/registros/${id}`).then(() => cargarReg()).catch(() => alert('Error al eliminar'))
  }

  function eliminarEmpleado(emp) {
    const msg = `¿Eliminar a ${emp.nombre}?` +
      (emp.total_registros > 0
        ? `\n\nTiene ${emp.total_registros} registros de horas. Se ocultará de la lista pero se conservarán los datos históricos.`
        : '\n\nNo tiene registros. Se eliminará definitivamente.')
    if (!confirm(msg)) return
    api.delete(`/rrhh/empleados/${emp.id}`)
      .then(r => {
        if (r.data.accion === 'desactivado') {
          alert(`${emp.nombre} fue ocultado de la lista. Sus ${r.data.registros} registros de horas se conservan.`)
        }
        reloadEmpleados()
      })
      .catch(() => alert('Error al eliminar'))
  }

  function guardarEmpleado() {
    const m = modalEmp
    if (!m.nombre?.trim()) { alert('El nombre es obligatorio'); return }
    setSaving(true)
    const req = m.id ? api.put(`/rrhh/empleados/${m.id}`, m) : api.post('/rrhh/empleados', m)
    req.then(() => { setModalEmp(null); reloadEmpleados() })
       .catch(e => alert(e.response?.data?.error || 'Error al guardar'))
       .finally(() => setSaving(false))
  }

  function calcHoras(inicio, fin) {
    if (!inicio || !fin) return null
    try {
      const [hI, mI] = inicio.split(':').map(Number)
      const [hF, mF] = fin.split(':').map(Number)
      const mins = hF * 60 + mF - (hI * 60 + mI)
      return mins > 0 ? +(mins / 60).toFixed(2) : null
    } catch { return null }
  }

  // ── tabs ───────────────────────────────────────────────────────────────────
  function TabDashboard() {
    if (!dash) return <div className="text-center text-muted py-5">{loading ? 'Cargando...' : 'Sin datos'}</div>

    const total   = dash.totalHoras || 0
    const interno = dash.porTipo?.find(t => t.tipo === 'interno')?.horas    || 0
    const contra  = dash.porTipo?.find(t => t.tipo === 'contratista')?.horas || 0
    const pctI    = total > 0 ? Math.round(interno / total * 100) : 0
    const nomMes  = month ? (MESES.find(m => m.v === month)?.l + ' ') : ''

    return (
      <div>
        {/* KPIs */}
        <div className="row g-3 mb-4">
          <div className="col-6 col-md-3">
            <div className="card text-center h-100 border-primary">
              <div className="card-body">
                <div className="fs-2 fw-bold text-primary">{fmtH(total)}</div>
                <div className="text-muted small">Total horas · {nomMes}{year}</div>
              </div>
            </div>
          </div>
          <div className="col-6 col-md-3">
            <div className="card text-center h-100 border-success">
              <div className="card-body">
                <div className="fs-2 fw-bold text-success">{fmtH(interno)}</div>
                <div className="text-muted small">E-INTRA · {pctI}%</div>
              </div>
            </div>
          </div>
          <div className="col-6 col-md-3">
            <div className="card text-center h-100 border-warning">
              <div className="card-body">
                <div className="fs-2 fw-bold text-warning">{fmtH(contra)}</div>
                <div className="text-muted small">Contratistas · {100-pctI}%</div>
              </div>
            </div>
          </div>
          <div className="col-6 col-md-3">
            <div className="card text-center h-100">
              <div className="card-body">
                <div className="fs-2 fw-bold text-info">
                  {empleados.filter(e=>e.activo).length} / {proyectosMain.filter(p=>p.estado==='Activo').length}
                </div>
                <div className="text-muted small">Empleados / Proyectos activos</div>
              </div>
            </div>
          </div>
        </div>

        <div className="row g-3 mb-3">
          {/* Horas por empleado */}
          <div className="col-md-6">
            <div className="card h-100">
              <div className="card-header fw-semibold">
                Horas por empleado &nbsp;<small className="text-muted fw-normal">{nomMes}{year}</small>
              </div>
              <div className="card-body p-0" style={{ maxHeight: 380, overflowY: 'auto' }}>
                <table className="table table-sm table-hover mb-0">
                  <thead className="table-light sticky-top">
                    <tr><th>Empleado</th><th>Tipo</th><th className="text-end">Horas</th></tr>
                  </thead>
                  <tbody>
                    {(dash.porEmpleado||[]).filter(e=>e.horas>0).map(e=>(
                      <tr key={e.id}>
                        <td>{e.nombre}</td>
                        <td><span className={`badge bg-${e.tipo==='interno'?'primary':'secondary'}`}>
                          {e.tipo==='interno'?'E-INTRA':'C'}
                        </span></td>
                        <td className="text-end fw-semibold">{fmtH(e.horas)}</td>
                      </tr>
                    ))}
                    {(dash.porEmpleado||[]).filter(e=>e.horas>0).length===0 && (
                      <tr><td colSpan={3} className="text-center text-muted py-3">Sin datos</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Horas por proyecto */}
          <div className="col-md-6">
            <div className="card h-100">
              <div className="card-header fw-semibold">
                Top proyectos &nbsp;<small className="text-muted fw-normal">{nomMes}{year}</small>
              </div>
              <div className="card-body p-0" style={{ maxHeight: 380, overflowY: 'auto' }}>
                <table className="table table-sm table-hover mb-0">
                  <thead className="table-light sticky-top">
                    <tr><th>Proyecto</th><th className="text-end">Horas</th></tr>
                  </thead>
                  <tbody>
                    {(dash.porProyecto||[]).filter(p=>p.horas>0).map(p=>(
                      <tr key={p.id}><td>{p.nombre}</td><td className="text-end fw-semibold">{fmtH(p.horas)}</td></tr>
                    ))}
                    {(dash.porProyecto||[]).filter(p=>p.horas>0).length===0 && (
                      <tr><td colSpan={2} className="text-center text-muted py-3">Sin datos</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        {/* Horas por grupo de actividad */}
        <div className="card">
          <div className="card-header fw-semibold">Distribución por grupo de actividad</div>
          <div className="card-body p-0">
            <table className="table table-sm mb-0">
              <thead className="table-light">
                <tr><th>Grupo</th><th className="text-end">Horas</th><th style={{width:'35%'}}>Distribución</th></tr>
              </thead>
              <tbody>
                {(dash.porCategoria||[]).filter(c=>c.horas>0).map(c => {
                  const pct = total > 0 ? Math.round(c.horas / total * 100) : 0
                  return (
                    <tr key={c.grupo}>
                      <td>{c.grupo || '—'}</td>
                      <td className="text-end fw-semibold">{fmtH(c.horas)}</td>
                      <td>
                        <div className="d-flex align-items-center gap-2">
                          <div className="flex-grow-1 rounded" style={{ height:8, background:'#e9ecef' }}>
                            <div className="rounded bg-primary" style={{ width:`${pct}%`, height:8 }} />
                          </div>
                          <small className="text-muted" style={{minWidth:32}}>{pct}%</small>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {(dash.porCategoria||[]).filter(c=>c.horas>0).length===0 && (
                  <tr><td colSpan={3} className="text-center text-muted py-3">Sin datos</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }

  function TabRegistros() {
    const totalH = registros.reduce((s,r) => s + (r.horas||0), 0)
    return (
      <div>
        <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
          <div className="d-flex gap-2 flex-wrap align-items-center">
            <select className="form-select form-select-sm" style={{width:170}} value={fEmp} onChange={e=>setFEmp(e.target.value)}>
              <option value="">Todos los empleados</option>
              <optgroup label="E-INTRA">
                {empleados.filter(e=>e.activo&&e.tipo==='interno').map(e=><option key={e.id} value={e.id}>{e.nombre}</option>)}
              </optgroup>
              <optgroup label="Contratistas">
                {empleados.filter(e=>e.activo&&e.tipo==='contratista').map(e=><option key={e.id} value={e.id}>{e.nombre}</option>)}
              </optgroup>
            </select>
            <select className="form-select form-select-sm" style={{width:180}} value={fProy} onChange={e=>setFProy(e.target.value)}>
              <option value="">Todos los proyectos</option>
              {proyectosActivos.map(p=><option key={p.id} value={p.id}>{p.codigo ? `${p.codigo} — ${p.nombre}` : p.nombre}</option>)}
            </select>
            <span className="badge bg-secondary align-self-center">
              {registros.length} registros · {fmtH(totalH)}
            </span>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setModalReg({
            fecha: new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }),
            empleado_id:'', asignacion:'', categoria_id:'',
            hora_inicio:'', hora_fin:'', horas:'', modulo:'', descripcion:''
          })}>
            <i className="bi bi-plus-lg me-1"/>Nuevo registro
          </button>
        </div>

        <div className="table-responsive">
          <table className="table table-sm table-hover">
            <thead className="table-dark">
              <tr>
                <th>Fecha</th><th>Empleado</th><th>T</th><th>Proyecto</th>
                <th>Cat</th><th>Inicio</th><th>Fin</th>
                <th className="text-end">Horas</th><th>Módulo</th>
                <th style={{minWidth:160}}>Descripción</th><th></th>
              </tr>
            </thead>
            <tbody>
              {registros.map(r => (
                <tr key={r.id}>
                  <td className="text-nowrap">{fmtF(r.fecha)}</td>
                  <td>{r.empleado_nombre}</td>
                  <td>
                    <span className={`badge bg-${r.empleado_tipo==='interno'?'primary':'secondary'}`}>
                      {r.empleado_tipo==='interno'?'E':'C'}
                    </span>
                  </td>
                  <td style={{maxWidth:140}} className="text-truncate">{r.proyecto_nombre||'—'}</td>
                  <td>
                    {r.cat_codigo
                      ? <span className="badge bg-light text-dark border" title={r.cat_descripcion}>{r.cat_codigo}</span>
                      : '—'}
                  </td>
                  <td>{r.hora_inicio||'—'}</td>
                  <td>{r.hora_fin||'—'}</td>
                  <td className="text-end fw-semibold text-nowrap">{fmtH(r.horas)}</td>
                  <td>{r.modulo||'—'}</td>
                  <td style={{maxWidth:160}} className="text-truncate" title={r.descripcion}>{r.descripcion||'—'}</td>
                  <td className="text-nowrap">
                    <button className="btn btn-sm btn-outline-secondary py-0 me-1" onClick={() => setModalReg({
                      ...r,
                      asignacion: r.actividad_id ? `a:${r.actividad_id}` : r.proyecto_id ? `p:${r.proyecto_id}` : ''
                    })}>
                      <i className="bi bi-pencil"/>
                    </button>
                    <button className="btn btn-sm btn-outline-danger py-0" onClick={() => eliminarRegistro(r.id)}>
                      <i className="bi bi-trash"/>
                    </button>
                  </td>
                </tr>
              ))}
              {registros.length===0 && (
                <tr><td colSpan={11} className="text-center text-muted py-4">Sin registros para el período seleccionado</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  function TabEmpleados() {
    const lista      = empleados.filter(e => verInactivos ? true : e.activo)
    const internos   = lista.filter(e => e.tipo === 'interno')
    const contratistas = lista.filter(e => e.tipo === 'contratista')
    const nInactivos = empleados.filter(e => !e.activo).length

    function FilaEmp({ e }) {
      return (
        <tr className={!e.activo ? 'table-secondary text-muted' : ''}>
          <td>
            {e.nombre}
            {!e.activo && <span className="badge bg-secondary ms-2" style={{fontSize:'0.65rem'}}>inactivo</span>}
            {e.activo && e.obliga_fichar === 0 && (
              <span className="badge bg-warning text-dark ms-2" style={{fontSize:'0.65rem'}}>
                <i className="bi bi-clock-history me-1"/>sin fichar
              </span>
            )}
          </td>
          <td>{e.empresa||'—'}</td>
          <td className="text-end">{fmtH(e.horas_anio)}</td>
          <td className="text-end text-muted small">{e.total_registros||0}</td>
          <td className="text-nowrap">
            <button className="btn btn-sm btn-outline-secondary py-0 me-1"
              onClick={() => setModalEmp({ ...e })}>
              <i className="bi bi-pencil"/>
            </button>
            <button className="btn btn-sm btn-outline-danger py-0"
              onClick={() => eliminarEmpleado(e)}
              title={e.activo ? (e.total_registros > 0 ? 'Ocultar de la lista (conserva historial)' : 'Eliminar definitivamente') : 'Reactivar en edición'}>
              <i className={`bi bi-${e.activo ? 'trash' : 'eye-slash'}`}/>
            </button>
          </td>
        </tr>
      )
    }

    function PanelEmpleados({ titulo, color, lista }) {
      return (
        <div className="card">
          <div className="card-header fw-semibold text-white" style={{background: color}}>
            {titulo}
            <span className="badge bg-white text-dark ms-2" style={{fontSize:'0.75rem'}}>{lista.length}</span>
          </div>
          <div className="card-body p-0" style={{maxHeight:420, overflowY:'auto'}}>
            <table className="table table-sm table-hover mb-0">
              <thead className="table-light sticky-top">
                <tr>
                  <th>Nombre</th><th>Empresa</th>
                  <th className="text-end">Horas {year}</th>
                  <th className="text-end">Registros</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lista.map(e => <FilaEmp key={e.id} e={e}/>)}
                {lista.length===0 && <tr><td colSpan={5} className="text-center text-muted py-3">Sin empleados</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )
    }

    return (
      <div>
        <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
          <div className="d-flex gap-2 align-items-center">
            <span className="badge bg-primary">{internos.filter(e=>e.activo).length} E-INTRA activos</span>
            <span className="badge bg-secondary">{contratistas.filter(e=>e.activo).length} Contratistas activos</span>
            {nInactivos > 0 && (
              <button className={`btn btn-sm ${verInactivos ? 'btn-warning' : 'btn-outline-secondary'}`}
                onClick={() => setVerInactivos(v => !v)}>
                <i className={`bi bi-eye${verInactivos?'-slash':''} me-1`}/>
                {verInactivos ? 'Ocultar inactivos' : `Ver inactivos (${nInactivos})`}
              </button>
            )}
          </div>
          <button className="btn btn-primary btn-sm"
            onClick={() => setModalEmp({ nombre:'', tipo:'interno', empresa:'', activo:1 })}>
            <i className="bi bi-plus-lg me-1"/>Nuevo empleado
          </button>
        </div>

        <div className="row g-3">
          <div className="col-lg-6">
            <PanelEmpleados titulo="Personal E-INTRA" color="#0d6efd" lista={internos}/>
          </div>
          <div className="col-lg-6">
            <PanelEmpleados titulo="Contratistas" color="#6c757d" lista={contratistas}/>
          </div>
        </div>

        {/* Panel fichador */}
        <div className="card mt-3">
          <div className="card-header fw-semibold d-flex align-items-center gap-2"
               style={{background:'#198754', color:'#fff'}}>
            <i className="bi bi-person-badge"/>
            Empleados detectados en el fichador
            <span className="badge bg-white text-dark ms-1">{empDispositivo.length}</span>
            <button className="btn btn-sm btn-outline-light ms-auto py-0"
              onClick={cargarEmpDispositivo} title="Actualizar">
              <i className="bi bi-arrow-repeat"/>
            </button>
          </div>
          {empDispositivo.length === 0 ? (
            <div className="card-body text-muted text-center py-4">
              <i className="bi bi-person-x d-block fs-3 mb-2 opacity-25"/>
              Sin datos del fichador — sincronizá desde la pestaña Asistencia
            </div>
          ) : (
            <div className="card-body p-0" style={{maxHeight:340, overflowY:'auto'}}>
              <table className="table table-sm table-hover mb-0">
                <thead className="table-light sticky-top">
                  <tr>
                    <th>ID fichador</th>
                    <th>Nombre en el dispositivo</th>
                    <th className="text-center">Días</th>
                    <th className="text-center">Lecturas</th>
                    <th style={{minWidth:220}}>Vincular a empleado ERP</th>
                  </tr>
                </thead>
                <tbody>
                  {empDispositivo.map(ed => (
                    <tr key={ed.empleado_ext}>
                      <td><code>{ed.empleado_ext}</code></td>
                      <td>{ed.nombre_dispositivo || '—'}</td>
                      <td className="text-center">{ed.dias}</td>
                      <td className="text-center">{ed.lecturas}</td>
                      <td>
                        <select
                          className="form-select form-select-sm"
                          value={ed.empleado_id || ''}
                          onChange={ev => {
                            const emp_id = ev.target.value ? Number(ev.target.value) : null
                            api.post('/rrhh/asistencia/vincular', { emp_id, empleado_ext: ed.empleado_ext })
                              .then(() => {
                                cargarEmpDispositivo()
                                api.get('/rrhh/empleados').then(r => setEmpleados(r.data))
                              })
                              .catch(e => alert(e.response?.data?.error || 'Error al vincular'))
                          }}
                        >
                          <option value="">— sin vincular —</option>
                          {empleados.filter(e => e.activo).map(e => (
                            <option key={e.id} value={e.id}>{e.nombre}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    )
  }

  function TabProyectos() {
    const COLORES = { 'Activo':'success', 'En espera':'warning', 'Completado':'primary', 'Cancelado':'danger' }
    return (
      <div>
        <div className="d-flex gap-2 align-items-center mb-3">
          <span className="badge bg-success">{proyectosMain.filter(p=>p.estado==='Activo').length} activos</span>
          <span className="badge bg-warning text-dark">{proyectosMain.filter(p=>p.estado==='En espera').length} en espera</span>
          <span className="text-muted small ms-2">Los proyectos se gestionan en el módulo Proyectos</span>
        </div>

        <div className="table-responsive">
          <table className="table table-sm table-hover">
            <thead className="table-dark">
              <tr>
                <th>Código</th>
                <th>Proyecto</th>
                <th>Cliente</th>
                <th className="text-end">Total horas</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {proyectosMain.map(p => (
                <tr key={p.id}>
                  <td className="text-nowrap"><span className="badge bg-secondary">{p.codigo||'—'}</span></td>
                  <td>{p.nombre}</td>
                  <td className="text-muted small">{p.cliente_nombre||'—'}</td>
                  <td className="text-end fw-semibold">{p.total_horas > 0 ? fmtH(p.total_horas) : <span className="text-muted">—</span>}</td>
                  <td>
                    <span className={`badge bg-${COLORES[p.estado]||'secondary'}`}>{p.estado||'—'}</span>
                  </td>
                </tr>
              ))}
              {proyectosMain.length===0 && (
                <tr><td colSpan={5} className="text-center text-muted py-4">Sin proyectos</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // ── tab parte diario ──────────────────────────────────────────────────────
  function TabParteDiario() {
    const GRUPOS = [
      { grupo:'Granallado',            color:'#6c757d' },
      { grupo:'Mano de obra Herreria', color:'#8B4513' },
      { grupo:'Terminaciones y Montaje', color:'#dc3545' },
      { grupo:'Electrico',             color:'#0d6efd' },
      { grupo:'Infraestructura',       color:'#198754' },
      { grupo:'Ingenieria',            color:'#6f42c1' },
      { grupo:'General',               color:'#20c997' },
    ]

    const addFila = (cat) => setParteFilas(fs => [...fs, {
      _key: Date.now() + Math.random(),
      cat_id: cat?.id || '', ini: '', fin: '', horas: '',
      asignacion: '', descripcion: '',
    }])

    const updFila = (key, field, val) => setParteFilas(fs => fs.map(f => {
      if (f._key !== key) return f
      const u = { ...f, [field]: val }
      if (field === 'ini' || field === 'fin') {
        const h = calcHoras(field === 'ini' ? val : f.ini, field === 'fin' ? val : f.fin)
        if (h !== null) u.horas = h
      }
      return u
    }))

    const setCat = (key, catId) => setParteFilas(fs => fs.map(f =>
      f._key !== key ? f : { ...f, cat_id: catId ? Number(catId) : '' }
    ))

    const delFila = (key) => setParteFilas(fs => fs.filter(f => f._key !== key))

    const totalHoras = parteFilas.reduce((s, f) => s + (parseFloat(f.horas) || 0), 0)

    // Insertar separador de almuerzo entre filas que cruzan 13:00 → 14:00
    const filasMostradas = []
    for (let i = 0; i < parteFilas.length; i++) {
      if (i > 0) {
        const prev = parteFilas[i - 1], curr = parteFilas[i]
        if (prev.fin && prev.fin <= '13:01' && curr.ini && curr.ini >= '13:59')
          filasMostradas.push({ _almuerzo: true, _key: 'alm' })
      }
      filasMostradas.push(parteFilas[i])
    }

    const gruposCats = categorias.reduce((acc, c) => {
      if (!acc[c.grupo]) acc[c.grupo] = []
      acc[c.grupo].push(c)
      return acc
    }, {})

    async function guardarParte() {
      if (!parteEmp)  { alert('Seleccioná un empleado'); return }
      if (!parteDate) { alert('Seleccioná una fecha');   return }
      const validas = parteFilas.filter(f => f.cat_id && f.ini && f.fin && parseFloat(f.horas) > 0)
      if (validas.length === 0) { alert('Completá al menos una fila con código, INI y FIN'); return }
      setSavingParte(true)
      try {
        const registros = validas.map(f => {
          const esAct = f.asignacion?.startsWith('a:')
          const asigId = f.asignacion ? Number(f.asignacion.slice(2)) : null
          return {
            fecha: parteDate, empleado_id: Number(parteEmp),
            categoria_id: f.cat_id || null,
            proyecto_id:  esAct ? null : (asigId || null),
            actividad_id: esAct ? asigId : null,
            hora_inicio: f.ini, hora_fin: f.fin, horas: parseFloat(f.horas),
            modulo: '', descripcion: f.descripcion || '',
          }
        })
        const r = await api.post('/rrhh/registros/batch', { registros })
        alert(`${r.data.insertados} registros guardados correctamente`)
        setParteFilas([])
        if (tab === 'registros') cargarReg()
        if (tab === 'dashboard') cargarDash()
      } catch (e) {
        alert(e.response?.data?.error || 'Error al guardar')
      } finally { setSavingParte(false) }
    }

    return (
      <div>
        {/* Cabecera */}
        <div className="card mb-3">
          <div className="card-body py-2">
            <div className="d-flex gap-3 align-items-end flex-wrap">
              <div style={{minWidth:240}}>
                <label className="form-label small mb-1 fw-semibold">Empleado</label>
                <select className="form-select form-select-sm" value={parteEmp}
                  onChange={e => setParteEmp(e.target.value)}>
                  <option value="">— seleccionar —</option>
                  <optgroup label="E-INTRA">
                    {empleados.filter(e => e.activo && e.tipo === 'interno').map(e =>
                      <option key={e.id} value={e.id}>{e.nombre}</option>
                    )}
                  </optgroup>
                  <optgroup label="Contratistas">
                    {empleados.filter(e => e.activo && e.tipo === 'contratista').map(e =>
                      <option key={e.id} value={e.id}>{e.nombre}</option>
                    )}
                  </optgroup>
                </select>
              </div>
              <div>
                <label className="form-label small mb-1 fw-semibold">Fecha</label>
                <DateInput className="form-control form-control-sm" style={{width:150}}
                  value={parteDate} onChange={v => setParteDate(v)}/>
              </div>
              <div className="ms-auto text-muted small align-self-center">
                <i className="bi bi-file-earmark-text me-1"/>Form 42 · Parte Diario
              </div>
            </div>
          </div>
        </div>

        {/* Grilla de códigos */}
        <div className="card mb-3">
          <div className="card-header py-2 small fw-semibold">
            <i className="bi bi-grid-3x3 me-1"/>Códigos de actividad — clic para agregar fila
          </div>
          <div className="card-body py-2 px-3">
            <div className="row g-2">
              {GRUPOS.map(({ grupo, color }) => {
                const cats = categorias.filter(c => c.grupo === grupo)
                if (!cats.length) return null
                return (
                  <div key={grupo} className="col-12 col-lg-6">
                    <div className="d-flex align-items-center gap-1 flex-wrap">
                      <span className="badge me-1 text-white"
                        style={{background: color, minWidth:100, fontSize:'0.7rem'}}>
                        {grupo}
                      </span>
                      {cats.map(c => (
                        <button key={c.id}
                          className="btn btn-sm py-0 px-2 border"
                          style={{fontSize:'0.75rem', background:'#f8f9fa'}}
                          title={c.descripcion}
                          onClick={() => addFila(c)}>
                          <strong>{c.codigo}</strong>
                          <span className="text-muted ms-1 d-none d-md-inline"
                            style={{fontSize:'0.68rem'}}>{c.descripcion}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Tabla de filas */}
        <div className="card">
          <div className="card-header py-2 d-flex align-items-center justify-content-between">
            <span className="fw-semibold small">
              <i className="bi bi-table me-1"/>Filas del parte
              {parteFilas.length > 0 &&
                <span className="badge bg-secondary ms-2">{parteFilas.length}</span>}
            </span>
            <button className="btn btn-sm btn-outline-primary" onClick={() => addFila(null)}>
              <i className="bi bi-plus-lg me-1"/>Agregar fila
            </button>
          </div>
          <div className="table-responsive">
            <table className="table table-sm mb-0 align-middle">
              <thead className="table-light">
                <tr>
                  <th style={{minWidth:170}}>Código</th>
                  <th style={{width:88}}>INI</th>
                  <th style={{width:88}}>FIN</th>
                  <th style={{width:64}} className="text-center">Horas</th>
                  <th style={{minWidth:150}}>Proyecto</th>
                  <th>Descripción de la tarea</th>
                  <th style={{width:36}}></th>
                </tr>
              </thead>
              <tbody>
                {parteFilas.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center text-muted py-5">
                      <i className="bi bi-file-earmark-plus d-block fs-2 mb-2 opacity-25"/>
                      Clic en un código de actividad o en "Agregar fila"
                    </td>
                  </tr>
                ) : filasMostradas.map(item => {
                  if (item._almuerzo) return (
                    <tr key="almuerzo" className="table-warning">
                      <td colSpan={7} className="text-center py-1 fw-semibold small text-warning-emphasis">
                        <i className="bi bi-cup-hot me-2"/>ALMUERZO · 13:00 – 14:00
                      </td>
                    </tr>
                  )
                  const f = item
                  return (
                    <tr key={f._key}>
                      <td>
                        <select className="form-select form-select-sm" style={{fontSize:'0.78rem'}}
                          value={f.cat_id}
                          onChange={e => setCat(f._key, e.target.value)}>
                          <option value="">— seleccionar —</option>
                          {Object.entries(gruposCats).map(([g, cats]) => (
                            <optgroup key={g} label={g}>
                              {cats.map(c =>
                                <option key={c.id} value={c.id}>{c.codigo} – {c.descripcion}</option>
                              )}
                            </optgroup>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input type="time" className="form-control form-control-sm"
                          value={f.ini} onChange={e => updFila(f._key, 'ini', e.target.value)}/>
                      </td>
                      <td>
                        <input type="time" className="form-control form-control-sm"
                          value={f.fin} onChange={e => updFila(f._key, 'fin', e.target.value)}/>
                      </td>
                      <td className="text-center fw-semibold text-primary">
                        {f.horas ? `${parseFloat(f.horas).toFixed(1)}h` : '—'}
                      </td>
                      <td>
                        <select className="form-select form-select-sm" style={{fontSize:'0.78rem'}}
                          value={f.asignacion}
                          onChange={e => updFila(f._key, 'asignacion', e.target.value)}>
                          <option value="">—</option>
                          <optgroup label="Proyectos activos">
                            {proyectosActivos.map(p =>
                              <option key={p.id} value={`p:${p.id}`}>{p.codigo ? `${p.codigo} — ${p.nombre}` : p.nombre}</option>
                            )}
                          </optgroup>
                          {actividades.filter(a=>a.activo).length > 0 && (
                            <optgroup label="Actividades">
                              {actividades.filter(a=>a.activo).map(a =>
                                <option key={a.id} value={`a:${a.id}`}>{a.nombre}</option>
                              )}
                            </optgroup>
                          )}
                        </select>
                      </td>
                      <td>
                        <input type="text" className="form-control form-control-sm"
                          placeholder="Módulo / descripción de la tarea"
                          value={f.descripcion}
                          onChange={e => updFila(f._key, 'descripcion', e.target.value)}/>
                      </td>
                      <td>
                        <button className="btn btn-sm btn-outline-danger py-0"
                          onClick={() => delFila(f._key)}>
                          <i className="bi bi-x-lg"/>
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              {parteFilas.length > 0 && (
                <tfoot className="table-light">
                  <tr>
                    <td colSpan={3} className="text-end text-muted small fw-semibold">Total horas:</td>
                    <td className="text-center fw-bold text-primary">
                      {totalHoras > 0 ? `${parseFloat(totalHoras.toFixed(1))}h` : '—'}
                    </td>
                    <td colSpan={3}/>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {parteFilas.length > 0 && (
            <div className="card-footer d-flex justify-content-between align-items-center">
              <button className="btn btn-sm btn-outline-secondary"
                onClick={() => { if (confirm('¿Limpiar todas las filas?')) setParteFilas([]) }}>
                <i className="bi bi-trash me-1"/>Limpiar
              </button>
              <button className="btn btn-primary" disabled={savingParte || !parteEmp}
                onClick={guardarParte}>
                {savingParte
                  ? <><span className="spinner-border spinner-border-sm me-1"/>Guardando...</>
                  : <><i className="bi bi-check-lg me-1"/>Guardar parte ({parteFilas.filter(f => f.cat_id && f.horas).length} filas)</>}
              </button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── tab asistencia ────────────────────────────────────────────────────────
  function TabAsistencia() {
    const disp = dispositivos[0]

    const TIPO_BADGE = {
      'Facial':         'primary',
      'Tarjeta':        'secondary',
      'Tarjeta+PIN':    'info',
      'Facial+Tarjeta': 'success',
    }

    return (
      <div>
        {/* Dispositivo + estado */}
        <div className="card mb-3">
          <div className="card-body py-2">
            <div className="d-flex gap-3 align-items-center flex-wrap">
              <div className="d-flex align-items-center gap-2">
                <i className="bi bi-hdd-network text-primary fs-5"/>
                {disp ? (
                  <>
                    <div>
                      <span className="fw-semibold">{disp.nombre}</span>
                      <span className="text-muted ms-2 small">{disp.modelo} · {disp.ip}:{disp.puerto}</span>
                    </div>
                    <span className="badge bg-success">Configurado</span>
                    {disp.ultima_sync && (
                      <span className="text-muted small">Última sync: {disp.ultima_sync.substring(0,16)}</span>
                    )}
                  </>
                ) : (
                  <span className="text-muted">Sin dispositivo configurado</span>
                )}
              </div>
              <button className="btn btn-sm btn-outline-secondary ms-auto"
                onClick={() => setModalDisp(disp || {
                  nombre:'Terminal entrada', modelo:'DS-K1T320MFWX',
                  ip:'', puerto:80, usuario:'admin', password:'', activo:1
                })}>
                <i className="bi bi-gear me-1"/>Configurar dispositivo
              </button>
            </div>
          </div>
        </div>

        {/* Sincronizar */}
        <div className="card mb-3">
          <div className="card-body py-2">
            <div className="d-flex gap-2 align-items-center flex-wrap">
              <span className="text-muted small fw-semibold">Sincronizar registros:</span>
              <DateInput className="form-control form-control-sm" style={{width:145}}
                value={syncDesde} onChange={v => setSyncDesde(v)}/>
              <span className="text-muted small">al</span>
              <DateInput className="form-control form-control-sm" style={{width:145}}
                value={syncHasta} onChange={v => setSyncHasta(v)}/>
              <button className="btn btn-sm btn-success" disabled={syncLoading || !disp}
                onClick={sincronizar}>
                {syncLoading
                  ? <><span className="spinner-border spinner-border-sm me-1"/>Sincronizando...</>
                  : <><i className="bi bi-arrow-repeat me-1"/>Sincronizar</>}
              </button>
              {syncResult && (
                <span className="badge bg-info text-dark">
                  {syncResult.insertados} nuevos · {syncResult.duplicados} ya existían
                  {syncResult.totalDisp > 0 && ` · ${syncResult.totalDisp} en dispositivo`}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Filtros */}
        <div className="d-flex gap-2 align-items-center mb-3 flex-wrap">
          <span className="text-muted small">Ver día:</span>
          <DateInput className="form-control form-control-sm" style={{width:145}}
            value={fAsistFecha} onChange={v => setFAsistFecha(v)}/>
          <select className="form-select form-select-sm" style={{width:200}}
            value={fAsistEmp} onChange={e => setFAsistEmp(e.target.value)}>
            <option value="">Todos los empleados</option>
            {empleados.filter(e => e.activo).map(e => (
              <option key={e.id} value={e.id}>{e.nombre}</option>
            ))}
          </select>
          <span className="badge bg-secondary">{asistencia.length} {verLecturas ? 'lecturas' : 'empleados'}</span>
          <button className={`btn btn-sm ms-auto ${verLecturas ? 'btn-warning' : 'btn-outline-secondary'}`}
            onClick={() => setVerLecturas(v => !v)}>
            <i className={`bi bi-${verLecturas ? 'grid-3x3' : 'list-ul'} me-1`}/>
            {verLecturas ? 'Ver resumen' : 'Ver lecturas individuales'}
          </button>
        </div>

        {/* Tabla resumen (entrada / salida / horas) */}
        {!verLecturas && (
          <div className="table-responsive">
            <table className="table table-sm table-hover">
              <thead className="table-dark">
                <tr>
                  <th>Empleado</th>
                  <th>Tipo</th>
                  <th className="text-center">Entrada</th>
                  <th className="text-center">Salida</th>
                  <th className="text-center">Horas</th>
                  <th className="text-center" title="Cantidad de lecturas del día">Lecturas</th>
                </tr>
              </thead>
              <tbody>
                {asistencia.map((a, i) => {
                  const soloUna          = a.n_lecturas === 1
                  const tardeLlegada     = a.horario_entrada && a.entrada && a.entrada > a.horario_entrada
                  const retiroAnticipado = !soloUna && a.horario_salida && a.salida && a.salida < a.horario_salida
                  return (
                    <tr key={i}>
                      <td>
                        <span className={a.empleado_id ? 'fw-semibold' : 'text-muted'}>
                          {a.nombre || a.empleado_ext || '—'}
                        </span>
                        {!a.empleado_id && (
                          <span className="badge bg-warning text-dark ms-1" style={{fontSize:'0.65rem'}}>
                            sin vincular
                          </span>
                        )}
                      </td>
                      <td>
                        {a.emp_tipo === 'interno'
                          ? <span className="badge bg-primary">E-INTRA</span>
                          : a.emp_tipo === 'contratista'
                          ? <span className="badge bg-secondary">Contratista</span>
                          : '—'}
                      </td>
                      <td className="text-center">
                        <span className={`fw-semibold ${tardeLlegada ? 'text-danger' : 'text-success'}`}
                              title={tardeLlegada ? `Horario: ${a.horario_entrada}` : ''}>
                          {a.entrada || '—'}
                          {tardeLlegada && <i className="bi bi-exclamation-circle ms-1" style={{fontSize:'0.75rem'}}/>}
                        </span>
                      </td>
                      <td className="text-center">
                        {soloUna
                          ? <span className="text-muted small">sin salida</span>
                          : <span className={`fw-semibold ${retiroAnticipado ? 'text-danger' : 'text-secondary'}`}
                                  title={retiroAnticipado ? `Horario: ${a.horario_salida}` : ''}>
                              {a.salida}
                              {retiroAnticipado && <i className="bi bi-exclamation-circle ms-1" style={{fontSize:'0.75rem'}}/>}
                            </span>}
                      </td>
                      <td className="text-center">
                        {a.horas != null
                          ? <span className={`fw-bold ${a.horas < 6 ? 'text-warning' : 'text-dark'}`}>
                              {fmtH(a.horas)}
                            </span>
                          : <span className="text-muted">—</span>}
                      </td>
                      <td className="text-center">
                        <span className="badge bg-light text-muted border">
                          {a.n_lecturas}
                        </span>
                      </td>
                    </tr>
                  )
                })}
                {asistencia.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center text-muted py-5">
                      <i className="bi bi-calendar-x d-block fs-3 mb-2 opacity-25"/>
                      Sin registros para esta fecha
                      {!disp && <div className="mt-1 small">Configurá el dispositivo y sincronizá</div>}
                    </td>
                  </tr>
                )}
              </tbody>
              {asistencia.length > 0 && (
                <tfoot className="table-light">
                  <tr>
                    <td colSpan={4} className="text-end text-muted small fw-semibold">Total horas del día:</td>
                    <td className="text-center fw-bold">
                      {fmtH(asistencia.reduce((s, a) => s + (a.horas || 0), 0))}
                    </td>
                    <td/>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}

        {/* Tabla lecturas individuales */}
        {verLecturas && (
          <div className="table-responsive">
            <table className="table table-sm table-hover">
              <thead className="table-dark">
                <tr><th>Hora</th><th>Empleado</th><th>Tipo verificación</th><th>Temp.</th></tr>
              </thead>
              <tbody>
                {asistencia.map(a => (
                  <tr key={a.id}>
                    <td className="fw-semibold">{a.hora}</td>
                    <td>
                      <span className={a.empleado_id ? '' : 'text-muted'}>
                        {a.emp_nombre_rrhh || a.empleado_nombre || a.empleado_ext || '—'}
                      </span>
                      {!a.empleado_id && (
                        <span className="badge bg-warning text-dark ms-1" style={{fontSize:'0.65rem'}}>sin vincular</span>
                      )}
                    </td>
                    <td>
                      {a.tipo_acceso
                        ? <span className={`badge bg-${TIPO_BADGE[a.tipo_acceso] || 'light text-dark border'}`}>
                            {a.tipo_acceso === 'Facial' && <i className="bi bi-person-fill me-1"/>}
                            {a.tipo_acceso === 'Tarjeta' && <i className="bi bi-credit-card me-1"/>}
                            {a.tipo_acceso}
                          </span>
                        : '—'}
                    </td>
                    <td>{a.temperatura != null ? `${a.temperatura} °C` : '—'}</td>
                  </tr>
                ))}
                {asistencia.length === 0 && (
                  <tr><td colSpan={4} className="text-center text-muted py-4">Sin lecturas</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  // ── modales ────────────────────────────────────────────────────────────────
  function ModalRegistro() {
    if (!modalReg) return null
    const m   = modalReg
    const upd = (k, v) => setModalReg(x => ({ ...x, [k]: v }))
    const gruposCats = categorias.reduce((acc, c) => {
      if (!acc[c.grupo]) acc[c.grupo] = []
      acc[c.grupo].push(c)
      return acc
    }, {})

    return (
      <div className="modal fade show d-block" style={{ background:'rgba(0,0,0,.5)' }}>
        <div className="modal-dialog modal-lg modal-dialog-scrollable">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">{m.id ? 'Editar registro' : 'Nuevo registro'}</h5>
              <button className="btn-close" onClick={() => setModalReg(null)}/>
            </div>
            <div className="modal-body">
              <div className="row g-3">
                <div className="col-md-4">
                  <label className="form-label fw-semibold">Fecha *</label>
                  <DateInput className="form-control form-control-sm"
                    value={m.fecha||''} onChange={v => upd('fecha', v)}/>
                </div>
                <div className="col-md-8">
                  <label className="form-label fw-semibold">Empleado *</label>
                  <select className="form-select form-select-sm"
                    value={m.empleado_id||''} onChange={e => upd('empleado_id', e.target.value)}>
                    <option value="">— seleccionar —</option>
                    <optgroup label="E-INTRA">
                      {empleados.filter(e=>e.activo&&e.tipo==='interno').map(e=>(
                        <option key={e.id} value={e.id}>{e.nombre}</option>
                      ))}
                    </optgroup>
                    <optgroup label="Contratistas">
                      {empleados.filter(e=>e.activo&&e.tipo==='contratista').map(e=>(
                        <option key={e.id} value={e.id}>{e.nombre}</option>
                      ))}
                    </optgroup>
                  </select>
                </div>

                <div className="col-md-6">
                  <label className="form-label fw-semibold">Proyecto / Actividad</label>
                  <select className="form-select form-select-sm"
                    value={m.asignacion||''} onChange={e => upd('asignacion', e.target.value)}>
                    <option value="">— sin asignar —</option>
                    {m.proyecto_id && !m.asignacion?.startsWith('a:') && !proyectosActivos.some(p => String(p.id) === String(m.proyecto_id)) && m.proyecto_nombre && (
                      <optgroup label="Proyecto actual (legado)">
                        <option value={`p:${m.proyecto_id}`}>{m.proyecto_nombre}</option>
                      </optgroup>
                    )}
                    <optgroup label="Proyectos activos">
                      {proyectosActivos.map(p=>(
                        <option key={p.id} value={`p:${p.id}`}>{p.codigo ? `${p.codigo} — ${p.nombre}` : p.nombre}</option>
                      ))}
                    </optgroup>
                    {actividades.filter(a=>a.activo).length > 0 && (
                      <optgroup label="Actividades">
                        {actividades.filter(a=>a.activo).map(a=>(
                          <option key={a.id} value={`a:${a.id}`}>{a.nombre}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
                <div className="col-md-6">
                  <label className="form-label fw-semibold">Categoría</label>
                  <select className="form-select form-select-sm"
                    value={m.categoria_id||''} onChange={e => upd('categoria_id', e.target.value)}>
                    <option value="">— sin categoría —</option>
                    {Object.entries(gruposCats).map(([grupo, cats]) => (
                      <optgroup key={grupo} label={grupo}>
                        {cats.map(c => (
                          <option key={c.id} value={c.id}>{c.codigo} – {c.descripcion}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                <div className="col-md-4">
                  <label className="form-label fw-semibold">Hora inicio</label>
                  <input type="time" className="form-control form-control-sm"
                    value={m.hora_inicio||''} onChange={e => {
                      const v = e.target.value
                      const h = calcHoras(v, m.hora_fin)
                      setModalReg(x => ({ ...x, hora_inicio: v, ...(h !== null && { horas: h }) }))
                    }}/>
                </div>
                <div className="col-md-4">
                  <label className="form-label fw-semibold">Hora fin</label>
                  <input type="time" className="form-control form-control-sm"
                    value={m.hora_fin||''} onChange={e => {
                      const v = e.target.value
                      const h = calcHoras(m.hora_inicio, v)
                      setModalReg(x => ({ ...x, hora_fin: v, ...(h !== null && { horas: h }) }))
                    }}/>
                </div>
                <div className="col-md-4">
                  <label className="form-label fw-semibold">Horas *</label>
                  <input type="number" className="form-control form-control-sm"
                    step="0.01" min="0" max="24"
                    value={m.horas||''} onChange={e => upd('horas', e.target.value)}/>
                </div>

                <div className="col-md-4">
                  <label className="form-label fw-semibold">Módulo</label>
                  <input type="text" className="form-control form-control-sm"
                    value={m.modulo||''} onChange={e => upd('modulo', e.target.value)}/>
                </div>
                <div className="col-md-8">
                  <label className="form-label fw-semibold">Descripción de la tarea</label>
                  <input type="text" className="form-control form-control-sm"
                    value={m.descripcion||''} onChange={e => upd('descripcion', e.target.value)}/>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary btn-sm" onClick={() => setModalReg(null)}>Cancelar</button>
              <button className="btn btn-primary btn-sm" disabled={saving} onClick={guardarRegistro}>
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  function ModalEmpleado() {
    if (!modalEmp) return null
    const m   = modalEmp
    const upd = (k, v) => setModalEmp(x => ({ ...x, [k]: v }))
    return (
      <div className="modal fade show d-block" style={{ background:'rgba(0,0,0,.5)' }}>
        <div className="modal-dialog">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">{m.id ? 'Editar empleado' : 'Nuevo empleado'}</h5>
              <button className="btn-close" onClick={() => setModalEmp(null)}/>
            </div>
            <div className="modal-body">
              <div className="row g-3">
                <div className="col-12">
                  <label className="form-label fw-semibold">Nombre *</label>
                  <input type="text" className="form-control form-control-sm"
                    value={m.nombre||''} onChange={e => upd('nombre', e.target.value)}
                    placeholder="Ej: GARCIA PABLO"/>
                </div>
                <div className="col-md-6">
                  <label className="form-label fw-semibold">Tipo *</label>
                  <select className="form-select form-select-sm"
                    value={m.tipo||'interno'} onChange={e => upd('tipo', e.target.value)}>
                    <option value="interno">E-INTRA (Interno)</option>
                    <option value="contratista">Contratista</option>
                  </select>
                </div>
                <div className="col-md-6">
                  <label className="form-label fw-semibold">Empresa (contratista)</label>
                  <input type="text" className="form-control form-control-sm"
                    value={m.empresa||''} onChange={e => upd('empresa', e.target.value)}/>
                </div>
                {m.id && (
                  <div className="col-md-6">
                    <label className="form-label fw-semibold">Estado</label>
                    <select className="form-select form-select-sm"
                      value={m.activo} onChange={e => upd('activo', Number(e.target.value))}>
                      <option value={1}>Activo</option>
                      <option value={0}>Inactivo</option>
                    </select>
                  </div>
                )}
                <div className={m.id ? 'col-md-6' : 'col-12'}>
                  <label className="form-label fw-semibold">ID en terminal biométrico</label>
                  <input type="text" className="form-control form-control-sm"
                    value={m.id_dispositivo||''} onChange={e => upd('id_dispositivo', e.target.value)}
                    placeholder="Nº de empleado en el dispositivo (ej: 1, 5, 123)"/>
                  <div className="form-text">Para vincular registros de asistencia automáticamente.</div>
                </div>
                <div className="col-12"><hr className="my-1"/><small className="text-muted fw-semibold">Horario y fichada</small></div>
                <div className="col-md-6">
                  <label className="form-label fw-semibold">Entrada esperada</label>
                  <input type="time" className="form-control form-control-sm"
                    value={m.horario_entrada||''} onChange={e => upd('horario_entrada', e.target.value)}/>
                  <div className="form-text">Llegadas posteriores se marcarán en rojo.</div>
                </div>
                <div className="col-md-6">
                  <label className="form-label fw-semibold">Salida esperada</label>
                  <input type="time" className="form-control form-control-sm"
                    value={m.horario_salida||''} onChange={e => upd('horario_salida', e.target.value)}/>
                  <div className="form-text">Salidas anteriores se marcarán en rojo.</div>
                </div>
                {m.tipo === 'interno' && (
                  <div className="col-12">
                    <div className="form-check form-switch">
                      <input className="form-check-input" type="checkbox" role="switch"
                        id="obligaFicharSwitch"
                        checked={m.obliga_fichar !== 0 && m.obliga_fichar !== false}
                        onChange={e => upd('obliga_fichar', e.target.checked ? 1 : 0)}
                      />
                      <label className="form-check-label" htmlFor="obligaFicharSwitch">
                        Obligado a fichar
                      </label>
                    </div>
                    <div className="form-text">
                      Si está desactivado, este empleado no aparece en el control de asistencia del Dashboard ni en "Sin fichar".
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary btn-sm" onClick={() => setModalEmp(null)}>Cancelar</button>
              <button className="btn btn-primary btn-sm" disabled={saving} onClick={guardarEmpleado}>
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  function ModalDispositivo() {
    if (!modalDisp) return null
    const m   = modalDisp
    const upd = (k, v) => setModalDisp(x => ({ ...x, [k]: v }))
    return (
      <div className="modal fade show d-block" style={{ background:'rgba(0,0,0,.5)' }}>
        <div className="modal-dialog">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">
                <i className="bi bi-hdd-network me-2"/>Configurar terminal de acceso
              </h5>
              <button className="btn-close" onClick={() => setModalDisp(null)}/>
            </div>
            <div className="modal-body">
              <div className="row g-3">
                <div className="col-md-6">
                  <label className="form-label fw-semibold">Nombre</label>
                  <input type="text" className="form-control form-control-sm"
                    value={m.nombre||''} onChange={e => upd('nombre', e.target.value)}
                    placeholder="Terminal entrada"/>
                </div>
                <div className="col-md-6">
                  <label className="form-label fw-semibold">Modelo</label>
                  <input type="text" className="form-control form-control-sm"
                    value={m.modelo||''} onChange={e => upd('modelo', e.target.value)}/>
                </div>
                <div className="col-md-8">
                  <label className="form-label fw-semibold">IP del dispositivo *</label>
                  <input type="text" className="form-control form-control-sm"
                    value={m.ip||''} onChange={e => upd('ip', e.target.value)}
                    placeholder="10.1.1.XXX"/>
                </div>
                <div className="col-md-4">
                  <label className="form-label fw-semibold">Puerto</label>
                  <input type="number" className="form-control form-control-sm"
                    value={m.puerto||80} onChange={e => upd('puerto', Number(e.target.value))}/>
                </div>
                <div className="col-md-6">
                  <label className="form-label fw-semibold">Usuario</label>
                  <input type="text" className="form-control form-control-sm"
                    value={m.usuario||''} onChange={e => upd('usuario', e.target.value)}/>
                </div>
                <div className="col-md-6">
                  <label className="form-label fw-semibold">Contraseña</label>
                  <input type="password" className="form-control form-control-sm"
                    value={m.password||''} onChange={e => upd('password', e.target.value)}/>
                </div>
                <div className="col-12">
                  <div className="alert alert-info py-2 mb-0" style={{fontSize:'0.82rem'}}>
                    <i className="bi bi-info-circle me-1"/>
                    Guardá el dispositivo y luego usá <strong>Probar conexión</strong> para verificar antes de sincronizar.
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              {m.id && (
                <button className="btn btn-outline-info btn-sm me-auto" onClick={testDispositivo}>
                  <i className="bi bi-wifi me-1"/>Probar conexión
                </button>
              )}
              <button className="btn btn-secondary btn-sm" onClick={() => setModalDisp(null)}>Cancelar</button>
              <button className="btn btn-primary btn-sm" disabled={saving} onClick={guardarDispositivo}>
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── TabActividades ────────────────────────────────────────────────────────────
  function TabActividades() {
    function guardar() {
      const m = modalAct
      if (!m.nombre?.trim()) { alert('El nombre es obligatorio'); return }
      const req = m.id
        ? api.put(`/rrhh/actividades/${m.id}`, m)
        : api.post('/rrhh/actividades', m)
      req.then(() => { setModalAct(null); reloadActividades() })
         .catch(e => alert(e.response?.data?.error || 'Error al guardar'))
    }
    return (
      <div>
        <div className="d-flex justify-content-between align-items-center mb-3">
          <div>
            <h6 className="mb-0 fw-semibold">Actividades internas</h6>
            <small className="text-muted">Tareas generales, mantenimiento, etc.</small>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => setModalAct({ nombre: '', activo: 1 })}>
            <i className="bi bi-plus-lg me-1"/>Nueva actividad
          </button>
        </div>
        <div className="table-responsive">
          <table className="table table-sm table-hover">
            <thead className="table-dark">
              <tr><th>Nombre</th><th>Estado</th><th></th></tr>
            </thead>
            <tbody>
              {actividades.filter(a => a.activo).map(a => (
                <tr key={a.id}>
                  <td className="fw-semibold">{a.nombre}</td>
                  <td><span className="badge bg-success">Activa</span></td>
                  <td>
                    <button className="btn btn-sm btn-outline-secondary py-0 me-1" onClick={() => setModalAct({...a})}>
                      <i className="bi bi-pencil"/>
                    </button>
                    <button className="btn btn-sm btn-outline-warning py-0" title="Desactivar"
                      onClick={() => api.put(`/rrhh/actividades/${a.id}`, {...a, activo:0}).then(reloadActividades)}>
                      <i className="bi bi-eye-slash"/>
                    </button>
                  </td>
                </tr>
              ))}
              {actividades.filter(a => !a.activo).map(a => (
                <tr key={a.id} className="text-muted">
                  <td>{a.nombre}</td>
                  <td><span className="badge bg-secondary">Inactiva</span></td>
                  <td>
                    <button className="btn btn-sm btn-outline-success py-0" title="Activar"
                      onClick={() => api.put(`/rrhh/actividades/${a.id}`, {...a, activo:1}).then(reloadActividades)}>
                      <i className="bi bi-eye"/>
                    </button>
                  </td>
                </tr>
              ))}
              {actividades.length === 0 && (
                <tr><td colSpan={3} className="text-center text-muted py-4">Sin actividades. Creá la primera.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {modalAct && (
          <div className="modal fade show d-block" style={{ background:'rgba(0,0,0,.5)' }}>
            <div className="modal-dialog">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">{modalAct.id ? 'Editar actividad' : 'Nueva actividad'}</h5>
                  <button className="btn-close" onClick={() => setModalAct(null)}/>
                </div>
                <div className="modal-body">
                  <label className="form-label fw-semibold">Nombre *</label>
                  <input type="text" className="form-control"
                    value={modalAct.nombre || ''}
                    onChange={e => setModalAct(x => ({...x, nombre: e.target.value}))}
                    autoFocus/>
                </div>
                <div className="modal-footer">
                  <button className="btn btn-secondary btn-sm" onClick={() => setModalAct(null)}>Cancelar</button>
                  <button className="btn btn-primary btn-sm" onClick={guardar}>Guardar</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── TabFusionador ────────────────────────────────────────────────────────────
  function TabFusionador() {
    function cargar() {
      setLegadoLoad(true)
      api.get('/rrhh/proyectos-legado')
        .then(r => setLegado(r.data))
        .catch(() => {})
        .finally(() => setLegadoLoad(false))
    }
    // Cargar la primera vez que se muestra
    if (legado.length === 0 && !legadoLoad) cargar()

    function fusionar(id) {
      const nuevo = fusSelect[id]
      if (!nuevo) { alert('Seleccioná un proyecto de destino'); return }
      if (!confirm('¿Fusionar? Todos los registros con ese nombre legado van a apuntar al proyecto seleccionado.')) return
      api.post(`/rrhh/proyectos-legado/${id}/fusionar`, { proyecto_id_nuevo: nuevo })
        .then(r => {
          alert(`Fusionado. ${r.data.registros_actualizados} registros actualizados.`)
          setLegado(prev => prev.filter(p => p.id !== id))
        })
        .catch(e => alert(e.response?.data?.error || 'Error al fusionar'))
    }

    function conservar(id, nombre) {
      if (!confirm(`¿Conservar el nombre "${nombre}"? Va a quedar como está, sin cambios en los registros.`)) return
      api.post(`/rrhh/proyectos-legado/${id}/conservar`)
        .then(() => setLegado(prev => prev.filter(p => p.id !== id)))
        .catch(e => alert(e.response?.data?.error || 'Error'))
    }

    const pendientes = legado.filter(p => !p.revisado)

    return (
      <div>
        <div className="d-flex justify-content-between align-items-center mb-3">
          <div>
            <h6 className="mb-0 fw-semibold">Proyectos legado sin resolver</h6>
            <small className="text-muted">Nombres importados que aún no fueron mapeados a un proyecto del módulo</small>
          </div>
          <button className="btn btn-outline-secondary btn-sm" onClick={cargar} disabled={legadoLoad}>
            <i className="bi bi-arrow-clockwise me-1"/>{legadoLoad ? 'Cargando...' : 'Actualizar'}
          </button>
        </div>

        {legadoLoad && <div className="text-center py-4"><span className="spinner-border text-primary"/></div>}

        {!legadoLoad && pendientes.length === 0 && (
          <div className="alert alert-success">
            <i className="bi bi-check-circle me-2"/>Todos los proyectos legado fueron resueltos.
          </div>
        )}

        {!legadoLoad && pendientes.length > 0 && (
          <div className="table-responsive">
            <table className="table table-sm table-hover align-middle">
              <thead className="table-dark">
                <tr>
                  <th>Nombre legado</th>
                  <th className="text-center">Registros</th>
                  <th>Desde</th>
                  <th>Hasta</th>
                  <th style={{minWidth:220}}>Fusionar con proyecto activo</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pendientes.map(p => (
                  <tr key={p.id}>
                    <td className="fw-semibold">{p.nombre}</td>
                    <td className="text-center">
                      <span className="badge bg-secondary">{p.total_registros}</span>
                    </td>
                    <td className="text-nowrap small">{p.fecha_desde || '—'}</td>
                    <td className="text-nowrap small">{p.fecha_hasta || '—'}</td>
                    <td>
                      <select className="form-select form-select-sm"
                        value={fusSelect[p.id] || ''}
                        onChange={e => setFusSelect(prev => ({ ...prev, [p.id]: e.target.value }))}>
                        <option value="">— seleccionar destino —</option>
                        {proyectosMain.map(pa => (
                          <option key={pa.id} value={pa.id}>
                            {pa.codigo ? `${pa.codigo} — ${pa.nombre}` : pa.nombre}{pa.estado !== 'Activo' ? ` (${pa.estado})` : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="text-nowrap">
                      <button className="btn btn-sm btn-primary me-1"
                        disabled={!fusSelect[p.id]}
                        onClick={() => fusionar(p.id)}>
                        <i className="bi bi-arrow-left-right me-1"/>Fusionar
                      </button>
                      <button className="btn btn-sm btn-outline-secondary"
                        onClick={() => conservar(p.id, p.nombre)}>
                        <i className="bi bi-check me-1"/>Conservar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  // ── TabActividades ───────────────────────────────────────────────────────────
  function TabActividades() {
    function guardarActividad() {
      const m = modalAct
      if (!m.nombre?.trim()) { alert('El nombre es obligatorio'); return }
      setSaving(true)
      const req = m.id
        ? api.put(`/rrhh/actividades/${m.id}`, { nombre: m.nombre, activo: m.activo })
        : api.post('/rrhh/actividades', { nombre: m.nombre })
      req.then(() => { setModalAct(null); reloadActividades() })
        .catch(e => alert(e.response?.data?.error || 'Error al guardar'))
        .finally(() => setSaving(false))
    }

    const activas   = actividades.filter(a => a.activo)
    const inactivas = actividades.filter(a => !a.activo)

    return (
      <div>
        <div className="d-flex justify-content-between align-items-center mb-3">
          <div>
            <h6 className="mb-0 fw-semibold">Actividades internas</h6>
            <small className="text-muted">Tareas generales que pueden seleccionarse en los partes</small>
          </div>
          <button className="btn btn-primary btn-sm"
            onClick={() => setModalAct({ nombre: '', activo: 1 })}>
            <i className="bi bi-plus-lg me-1"/>Nueva actividad
          </button>
        </div>

        {actividades.length === 0 && (
          <div className="text-center text-muted py-5">
            <i className="bi bi-list-task fs-1 d-block mb-2"/>
            No hay actividades cargadas
          </div>
        )}

        {activas.length > 0 && (
          <div className="card mb-3">
            <div className="card-header py-2 fw-semibold small">Activas</div>
            <div className="table-responsive">
              <table className="table table-sm table-hover align-middle mb-0">
                <tbody>
                  {activas.map(a => (
                    <tr key={a.id}>
                      <td>{a.nombre}</td>
                      <td className="text-end">
                        <button className="btn btn-outline-secondary btn-sm me-1"
                          onClick={() => setModalAct({ id: a.id, nombre: a.nombre, activo: a.activo })}>
                          <i className="bi bi-pencil"/>
                        </button>
                        <button className="btn btn-outline-warning btn-sm"
                          onClick={() => {
                            if (!confirm(`¿Desactivar "${a.nombre}"?`)) return
                            api.put(`/rrhh/actividades/${a.id}`, { nombre: a.nombre, activo: 0 })
                              .then(() => reloadActividades())
                              .catch(e => alert(e.response?.data?.error || 'Error'))
                          }}>
                          <i className="bi bi-pause-circle"/>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {inactivas.length > 0 && (
          <div className="card">
            <div className="card-header py-2 fw-semibold small text-muted">Inactivas</div>
            <div className="table-responsive">
              <table className="table table-sm table-hover align-middle mb-0">
                <tbody>
                  {inactivas.map(a => (
                    <tr key={a.id} className="text-muted">
                      <td>{a.nombre}</td>
                      <td className="text-end">
                        <button className="btn btn-outline-secondary btn-sm me-1"
                          onClick={() => setModalAct({ id: a.id, nombre: a.nombre, activo: a.activo })}>
                          <i className="bi bi-pencil"/>
                        </button>
                        <button className="btn btn-outline-success btn-sm"
                          onClick={() => {
                            api.put(`/rrhh/actividades/${a.id}`, { nombre: a.nombre, activo: 1 })
                              .then(() => reloadActividades())
                              .catch(e => alert(e.response?.data?.error || 'Error'))
                          }}>
                          <i className="bi bi-play-circle"/>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Modal actividad */}
        {modalAct && (
          <div className="modal show d-block" style={{background:'rgba(0,0,0,.4)'}}>
            <div className="modal-dialog">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">{modalAct.id ? 'Editar actividad' : 'Nueva actividad'}</h5>
                  <button className="btn-close" onClick={() => setModalAct(null)}/>
                </div>
                <div className="modal-body">
                  <div className="mb-3">
                    <label className="form-label fw-semibold small">Nombre</label>
                    <input className="form-control" value={modalAct.nombre}
                      onChange={e => setModalAct(p => ({ ...p, nombre: e.target.value }))}
                      placeholder="Ej: MANTENIMIENTO INTERNO"
                      autoFocus
                    />
                  </div>
                  {modalAct.id && (
                    <div className="form-check form-switch">
                      <input className="form-check-input" type="checkbox" id="actSwitch"
                        checked={!!modalAct.activo}
                        onChange={e => setModalAct(p => ({ ...p, activo: e.target.checked ? 1 : 0 }))}/>
                      <label className="form-check-label" htmlFor="actSwitch">Activa</label>
                    </div>
                  )}
                </div>
                <div className="modal-footer">
                  <button className="btn btn-secondary" onClick={() => setModalAct(null)}>Cancelar</button>
                  <button className="btn btn-primary" onClick={guardarActividad} disabled={saving}>
                    {saving ? <span className="spinner-border spinner-border-sm me-1"/> : null}
                    Guardar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── TabInformes ─────────────────────────────────────────────────────────────
  function TabInformes() {
    function exportarCSV(titulo) {
      if (!infData || infData.length === 0) return
      const keys   = Object.keys(infData[0])
      const header = keys.join(';')
      const rowsCSV = infData.map(r =>
        keys.map(k => {
          const v = r[k] ?? ''
          const s = String(v).replace(/"/g, '""')
          return s.includes(';') || s.includes('\n') ? `"${s}"` : s
        }).join(';')
      )
      const csv  = '﻿' + [header, ...rowsCSV].join('\r\n')
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url
      a.download = `${titulo}_${infDesde}_${infHasta}.csv`
      a.click()
      URL.revokeObjectURL(url)
    }

    async function consultar() {
      if (!infDesde || !infHasta) { alert('Seleccioná fechas'); return }
      setInfLoading(true)
      setInfData(null)
      try {
        const params = { desde: infDesde, hasta: infHasta }
        if (infEmpleado) params.empleado_id = infEmpleado
        const ep = infTab === 'asistencia' ? '/rrhh/informes/asistencia' : '/rrhh/informes/tareas'
        const r  = await api.get(ep, { params })
        setInfData(r.data)
      } catch (e) {
        alert(e.response?.data?.error || 'Error al consultar')
      } finally { setInfLoading(false) }
    }

    // Nombre de hoja válido para Excel: máx 31 caracteres, sin \ / ? * [ ]
    function nombreHoja(nombre, usados) {
      let base = String(nombre).replace(/[\\/?*[\]]/g, '').slice(0, 31) || 'Empleado'
      let final = base, i = 2
      while (usados.has(final)) { final = `${base.slice(0, 28)}~${i++}` }
      usados.add(final)
      return final
    }

    async function exportarTodosExcel() {
      if (!infDesde || !infHasta) { alert('Seleccioná fechas'); return }
      setInfExportando(true)
      try {
        const r = await api.get('/rrhh/informes/asistencia', { params: { desde: infDesde, hasta: infHasta } })
        const data = r.data
        if (!data || data.length === 0) { alert('Sin datos para el período seleccionado'); return }

        const porEmpleado = {}
        data.forEach(row => {
          if (!porEmpleado[row.empleado]) porEmpleado[row.empleado] = []
          porEmpleado[row.empleado].push(row)
        })

        // Totales por empleado (para el resumen y la barra)
        const resumen = Object.entries(porEmpleado).map(([empleado, filas]) => {
          const t = { empleado, ok: 0, tarde: 0, inasistencia: 0, fichada: 0, parte: 0, dif: 0, laboral: 0, difHorario: 0 }
          filas.forEach(f => {
            if (f.estado === 'inasistencia') t.inasistencia++
            else if (f.estado === 'tarde')    t.tarde++
            else if (f.estado === 'normal')   t.ok++
            t.fichada    += +f.horas_fichada || 0
            t.parte      += +f.horas_parte || 0
            t.dif        += +f.diferencia || 0
            t.laboral    += +f.horas_laborales || 0
            t.difHorario += +f.diferencia_horario || 0
          })
          return t
        })

        const wb = new ExcelJS.Workbook()
        wb.creator = 'Sistema de Gestión E-INTRA'

        // ── Hoja 1: Resumen ──────────────────────────────────────────────────
        const wsR = wb.addWorksheet('Resumen')
        wsR.columns = [{width:22},{width:9},{width:9},{width:11},{width:10},{width:9},{width:10},{width:10},{width:11}]
        estiloTitulo(wsR, 1, `INFORME DE ASISTENCIA — E-INTRA — ${infDesde} a ${infHasta}`, 1, 9)
        wsR.addRow([])
        const hR = wsR.addRow(['Empleado','Días OK','Tarde','Inasist.','Hs Fichada','Hs Parte','Diferencia','Hs Laboral','Dif. Horario'])
        estiloHeader(hR)
        let gFichada=0, gParte=0, gDif=0, gLaboral=0, gDifHorario=0, gOk=0, gTarde=0, gInasist=0
        resumen.forEach(t => {
          const row = wsR.addRow([t.empleado, t.ok, t.tarde, t.inasistencia,
            +t.fichada.toFixed(2), +t.parte.toFixed(2), +t.dif.toFixed(2), +t.laboral.toFixed(2), +t.difHorario.toFixed(2)])
          estiloCeldas(row)
          gFichada+=t.fichada; gParte+=t.parte; gDif+=t.dif; gLaboral+=t.laboral; gDifHorario+=t.difHorario
          gOk+=t.ok; gTarde+=t.tarde; gInasist+=t.inasistencia
        })
        const rowTot = wsR.addRow(['TOTAL GENERAL', gOk, gTarde, gInasist,
          +gFichada.toFixed(2), +gParte.toFixed(2), +gDif.toFixed(2), +gLaboral.toFixed(2), +gDifHorario.toFixed(2)])
        rowTot.font = { bold: true }
        estiloCeldas(rowTot, CORP.totalBg)
        wsR.getRow(hR.number).alignment = { horizontal: 'center' }

        // ── Gráfico de asistencia por empleado (insertado como imagen) ───────
        const fila = wsR.rowCount + 2
        const { base64, width, height } = dibujarGraficoAsistenciaPNG(resumen)
        const imgId = wb.addImage({ base64, extension: 'png' })
        wsR.addImage(imgId, { tl: { col: 0, row: fila - 1 }, ext: { width, height } })

        // ── Una hoja por empleado ─────────────────────────────────────────────
        const usados = new Set(['Resumen'])
        for (const [empleado, filas] of Object.entries(porEmpleado)) {
          const ws = wb.addWorksheet(nombreHoja(empleado, usados))
          ws.columns = [{width:10},{width:8},{width:8},{width:10},{width:9},{width:10},{width:10},{width:11},{width:14}]
          estiloTitulo(ws, 1, empleado, 1, 9)
          const h = ws.addRow(['Fecha','Entrada','Salida','Hs Fichada','Hs Parte','Diferencia','Hs Laboral','Dif. Horario','Novedad'])
          estiloHeader(h)
          let tFichada=0, tParte=0, tDif=0, tLaboral=0, tDifHorario=0
          for (const f of filas) {
            tFichada += +f.horas_fichada || 0; tParte += +f.horas_parte || 0; tDif += +f.diferencia || 0
            tLaboral += +f.horas_laborales || 0; tDifHorario += +f.diferencia_horario || 0
            const [yy,mm,dd] = f.fecha.split('-')
            const novedad = f.estado === 'inasistencia' ? 'Inasistencia'
                          : f.estado === 'tarde' ? `Tarde +${f.minutos_tarde}m`
                          : f.estado === 'normal' ? 'OK' : ''
            const row = ws.addRow([
              `${dd}/${mm}/${yy}`,
              f.entrada || '—', f.salida || '—',
              f.horas_fichada !== '' ? +f.horas_fichada : '',
              f.horas_parte !== '' ? +f.horas_parte : '',
              f.diferencia !== '' ? +f.diferencia : '',
              f.horas_laborales !== '' ? +f.horas_laborales : '',
              f.diferencia_horario !== '' ? +f.diferencia_horario : '',
              novedad,
            ])
            const bg = f.estado === 'inasistencia' ? 'FFFBE1E3' : f.estado === 'tarde' ? 'FFFEE7D6' : undefined
            estiloCeldas(row, bg)
          }
          const rowT = ws.addRow(['TOTAL','','', +tFichada.toFixed(2), +tParte.toFixed(2), +tDif.toFixed(2), +tLaboral.toFixed(2), +tDifHorario.toFixed(2), ''])
          rowT.font = { bold: true }
          estiloCeldas(rowT, CORP.totalBg)
          ws.views = [{ state: 'frozen', ySplit: 2 }]
        }

        await descargarWorkbook(wb, `asistencia_${infDesde}_${infHasta}.xlsx`)
      } catch (e) {
        alert(e.response?.data?.error || 'Error al exportar')
      } finally { setInfExportando(false) }
    }

    const COLS_ASIST = [
      { k:'empleado',      l:'Empleado'   },
      { k:'fecha',         l:'Fecha'      },
      { k:'entrada',       l:'Entrada'    },
      { k:'salida',        l:'Salida'     },
      { k:'horas_fichada', l:'Hs Fichada' },
      { k:'horas_parte',   l:'Hs Parte'   },
      { k:'diferencia',    l:'Diferencia' },
      { k:'horas_laborales',    l:'Hs Laboral'   },
      { k:'diferencia_horario', l:'Dif. Horario' },
      { k:'estado',        l:'Novedad'    },
    ]
    const COLS_TAREAS = [
      { k:'empleado',    l:'Empleado'    },
      { k:'fecha',       l:'Fecha'       },
      { k:'proyecto',    l:'Proyecto'    },
      { k:'codigo',      l:'Código'      },
      { k:'tarea',       l:'Tarea'       },
      { k:'grupo',       l:'Grupo'       },
      { k:'hora_inicio', l:'Inicio'      },
      { k:'hora_fin',    l:'Fin'         },
      { k:'horas',       l:'Horas'       },
      { k:'observacion', l:'Observación' },
    ]
    const cols = infTab === 'asistencia' ? COLS_ASIST : COLS_TAREAS

    return (
      <div>
        <div className="card mb-3">
          <div className="card-body py-2">
            <div className="d-flex gap-2 align-items-end flex-wrap">
              <div>
                <label className="form-label small mb-1 fw-semibold">Informe</label>
                <select className="form-select form-select-sm" style={{width:185}}
                  value={infTab} onChange={e => { setInfTab(e.target.value); setInfData(null) }}>
                  <option value="asistencia">Asistencia</option>
                  <option value="tareas">Tareas / Proyectos</option>
                </select>
              </div>
              <div>
                <label className="form-label small mb-1 fw-semibold">Desde</label>
                <DateInput className="form-control form-control-sm"
                  value={infDesde} onChange={v => setInfDesde(v)} />
              </div>
              <div>
                <label className="form-label small mb-1 fw-semibold">Hasta</label>
                <DateInput className="form-control form-control-sm"
                  value={infHasta} onChange={v => setInfHasta(v)} />
              </div>
              <div>
                <label className="form-label small mb-1 fw-semibold">Empleado</label>
                <select className="form-select form-select-sm" style={{width:200}}
                  value={infEmpleado} onChange={e => setInfEmpleado(e.target.value)}>
                  <option value="">— Todos —</option>
                  {empleados.filter(e => e.activo).map(e =>
                    <option key={e.id} value={e.id}>{e.nombre}</option>)}
                </select>
              </div>
              <button className="btn btn-primary btn-sm align-self-end" onClick={consultar} disabled={infLoading}>
                {infLoading
                  ? <><span className="spinner-border spinner-border-sm me-1"/>Consultando…</>
                  : <><i className="bi bi-search me-1"/>Consultar</>}
              </button>
              {infData && infData.length > 0 && (
                <button className="btn btn-success btn-sm align-self-end"
                  onClick={() => exportarCSV(infTab === 'asistencia' ? 'asistencia' : 'tareas')}>
                  <i className="bi bi-file-earmark-excel me-1"/>Exportar Excel
                </button>
              )}
              {infTab === 'asistencia' && (
                <button className="btn btn-outline-success btn-sm align-self-end"
                  onClick={exportarTodosExcel} disabled={infExportando}
                  title="Exporta todos los empleados del período, una hoja por empleado">
                  {infExportando
                    ? <><span className="spinner-border spinner-border-sm me-1"/>Exportando…</>
                    : <><i className="bi bi-file-earmark-spreadsheet me-1"/>Exportar todos (.xlsx)</>}
                </button>
              )}
            </div>
          </div>
        </div>

        {infTab === 'asistencia' && (
          <details className="mb-3">
            <summary className="small fw-semibold text-muted" style={{ cursor: 'pointer' }}>
              <i className="bi bi-calendar-x me-1" />Feriados ({(infDesde || hoy).slice(0,4)}) — no cuentan como inasistencia
            </summary>
            <div className="card mt-2">
              <div className="card-body py-2">
                <div className="d-flex gap-2 align-items-end flex-wrap mb-2">
                  <div>
                    <label className="form-label small mb-1">Fecha</label>
                    <DateInput className="form-control form-control-sm" value={nuevoFeriado.fecha} onChange={v => setNuevoFeriado(f => ({ ...f, fecha: v }))} />
                  </div>
                  <div>
                    <label className="form-label small mb-1">Descripción</label>
                    <input className="form-control form-control-sm" style={{width:220}}
                      value={nuevoFeriado.descripcion}
                      onChange={e => setNuevoFeriado(f => ({ ...f, descripcion: e.target.value }))}
                      placeholder="Ej: Día de la Independencia" />
                  </div>
                  <button className="btn btn-outline-primary btn-sm" onClick={agregarFeriado}>
                    <i className="bi bi-plus-lg me-1" />Agregar
                  </button>
                </div>
                {feriados.length === 0
                  ? <p className="text-muted small mb-0">Sin feriados cargados para este año.</p>
                  : (
                    <ul className="list-group list-group-flush">
                      {feriados.map(f => (
                        <li key={f.fecha} className="list-group-item d-flex justify-content-between align-items-center px-0 py-1">
                          <span className="small">{fmtF(f.fecha)} — {f.descripcion || 'Feriado'}</span>
                          <button className="btn btn-sm btn-outline-danger" onClick={() => eliminarFeriado(f.fecha)}>
                            <i className="bi bi-trash" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
              </div>
            </div>
          </details>
        )}

        {infData === null && !infLoading && (
          <div className="text-center text-muted py-5">
            <i className="bi bi-file-earmark-bar-graph d-block fs-2 mb-2 opacity-25"/>
            Seleccioná parámetros y presioná Consultar
          </div>
        )}
        {infData && infData.length === 0 && (
          <div className="alert alert-info">Sin datos para el período seleccionado.</div>
        )}
        {infData && infData.length > 0 && (
          <>
          {infTab === 'asistencia' && <GraficoAsistencia data={infData} />}
          <div className="card">
            <div className="card-header py-1 d-flex justify-content-between align-items-center">
              <span className="small fw-semibold">
                {infData.length} registro{infData.length !== 1 ? 's' : ''} · {infDesde} → {infHasta}
              </span>
              <span className="text-muted small">
                {infTab === 'asistencia'
                  ? `Fichado: ${infData.reduce((s,r)=>s+(+r.horas_fichada||0),0).toFixed(1)}h · Parte: ${infData.reduce((s,r)=>s+(+r.horas_parte||0),0).toFixed(1)}h`
                  : `Total: ${infData.reduce((s,r)=>s+(+r.horas||0),0).toFixed(1)}h`}
              </span>
            </div>
            <div className="table-responsive" style={{maxHeight:520, overflowY:'auto'}}>
              <table className="table table-sm table-hover mb-0" style={{fontSize:'0.8rem'}}>
                <thead className="table-dark" style={{position:'sticky', top:0}}>
                  <tr>{cols.map(c => <th key={c.k}>{c.l}</th>)}</tr>
                </thead>
                <tbody>
                  {infData.map((row, i) => {
                    const sinParte = infTab === 'asistencia' && !row.horas_parte && row.horas_fichada !== ''
                    const rowCls   = row.estado === 'inasistencia' ? 'table-danger'
                                   : row.estado !== 'tarde' && sinParte ? 'table-warning' : ''
                    const rowStyle = row.estado === 'tarde' ? { backgroundColor: 'rgba(253,126,20,0.15)' } : undefined
                    return (
                      <tr key={i} className={rowCls} style={rowStyle}>
                        {cols.map(c => {
                          let v = row[c.k] ?? ''
                          if (c.k === 'fecha' && v) {
                            const [yy,mm,dd] = v.split('-')
                            return <td key={c.k}>{dd}/{mm}/{yy}</td>
                          }
                          if ((c.k==='horas_fichada'||c.k==='horas'||c.k==='horas_parte'||c.k==='horas_laborales') && v !== '') {
                            return <td key={c.k}>{(+v).toFixed(1)}h</td>
                          }
                          if ((c.k === 'diferencia' || c.k === 'diferencia_horario') && v !== '') {
                            const n = +v
                            return <td key={c.k} className={Math.abs(n)>1?'text-danger fw-semibold':'text-success'}>
                              {n>0?`+${n.toFixed(1)}h`:`${n.toFixed(1)}h`}
                            </td>
                          }
                          if (c.k === 'estado') {
                            if (v === 'inasistencia') return <td key={c.k}><span className="badge bg-danger">Inasistencia</span></td>
                            if (v === 'tarde')        return <td key={c.k}><span className="badge" style={{ backgroundColor:'#fd7e14', color:'#fff' }}>Tarde +{row.minutos_tarde}m</span></td>
                            if (v === 'normal')       return <td key={c.k}><span className="badge bg-success bg-opacity-75">OK</span></td>
                            return <td key={c.k}>—</td>
                          }
                          return <td key={c.k}>{v===''?'—':v}</td>
                        })}
                      </tr>
                    )
                  })}
                </tbody>
                {infTab === 'asistencia' && (
                  <tfoot>
                    <tr className="table-light fw-bold">
                      <td colSpan={4}>TOTAL</td>
                      <td>{infData.reduce((s,r)=>s+(+r.horas_fichada||0),0).toFixed(1)}h</td>
                      <td>{infData.reduce((s,r)=>s+(+r.horas_parte||0),0).toFixed(1)}h</td>
                      <td>{infData.reduce((s,r)=>s+(+r.diferencia||0),0).toFixed(1)}h</td>
                      <td>{infData.reduce((s,r)=>s+(+r.horas_laborales||0),0).toFixed(1)}h</td>
                      <td>{infData.reduce((s,r)=>s+(+r.diferencia_horario||0),0).toFixed(1)}h</td>
                      <td></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
          </>
        )}
      </div>
    )
  }

  // ── GraficoAsistencia ───────────────────────────────────────────────────────
  function GraficoAsistencia({ data }) {
    const porEmp = {}
    data.forEach(r => {
      if (!porEmp[r.empleado]) porEmp[r.empleado] = { normal: 0, tarde: 0, inasistencia: 0 }
      if (porEmp[r.empleado][r.estado] !== undefined) porEmp[r.empleado][r.estado]++
    })
    const filas = Object.entries(porEmp)
      .map(([empleado, c]) => ({ empleado, ...c, total: c.normal + c.tarde + c.inasistencia }))
      .filter(f => f.total > 0)
      .sort((a, b) => (b.inasistencia + b.tarde) - (a.inasistencia + a.tarde))

    if (filas.length === 0) return null

    return (
      <div className="card mb-3">
        <div className="card-body">
          <h6 className="fw-semibold mb-3"><i className="bi bi-bar-chart me-2 text-primary" />Asistencia por empleado</h6>
          {filas.map(f => (
            <div key={f.empleado} className="mb-2">
              <div className="d-flex justify-content-between mb-1" style={{ fontSize: '0.78rem' }}>
                <span className="text-truncate fw-semibold" style={{ maxWidth: '60%' }} title={f.empleado}>{f.empleado}</span>
                <span className="text-muted">
                  {f.normal} OK{f.tarde > 0 && ` · ${f.tarde} tarde`}{f.inasistencia > 0 && ` · ${f.inasistencia} inasist.`}
                </span>
              </div>
              <div className="d-flex rounded overflow-hidden" style={{ height: 12 }}>
                {f.normal > 0 && <div style={{ width: `${f.normal / f.total * 100}%`, background: '#198754' }} title={`${f.normal} días OK`} />}
                {f.tarde > 0 && <div style={{ width: `${f.tarde / f.total * 100}%`, background: '#fd7e14' }} title={`${f.tarde} llegadas tarde`} />}
                {f.inasistencia > 0 && <div style={{ width: `${f.inasistencia / f.total * 100}%`, background: '#dc3545' }} title={`${f.inasistencia} inasistencias`} />}
              </div>
            </div>
          ))}
          <div className="d-flex gap-3 mt-2" style={{ fontSize: '0.72rem' }}>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#198754', marginRight: 4 }} />Presente</span>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#fd7e14', marginRight: 4 }} />Tarde</span>
            <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#dc3545', marginRight: 4 }} />Inasistencia</span>
          </div>
        </div>
      </div>
    )
  }

  // ── render ───────────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="d-flex align-items-center justify-content-between mb-3">
        <div>
          <h4 className="mb-0 fw-bold">RRHH — Análisis de horas</h4>
          <small className="text-muted">Form 43 · Gestión de horas utilizadas</small>
        </div>
      </div>

      {/* Filtro período */}
      <div className="card mb-3">
        <div className="card-body py-2">
          <div className="d-flex gap-2 align-items-center flex-wrap">
            <span className="text-muted small me-1">Período:</span>
            <select className="form-select form-select-sm" style={{width:90}}
              value={year} onChange={e => setYear(Number(e.target.value))}>
              {ANOS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <select className="form-select form-select-sm" style={{width:165}}
              value={month} onChange={e => setMonth(e.target.value)}>
              {MESES.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
            </select>
            {loading && <span className="spinner-border spinner-border-sm text-primary ms-1"/>}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <ul className="nav nav-tabs mb-3">
        {[
          { id:'dashboard',  icon:'speedometer2',           label:'Dashboard'   },
          { id:'parte',      icon:'file-earmark-text',      label:'Parte Diario'},
          { id:'asistencia', icon:'person-check',           label:'Asistencia'  },
          { id:'registros',  icon:'clock-history',          label:'Horas'       },
          { id:'empleados',  icon:'people',                  label:'Empleados'  },
          { id:'proyectos',   icon:'kanban',                  label:'Proyectos'   },
          { id:'actividades', icon:'list-task',              label:'Actividades' },
          { id:'fusionador',  icon:'arrow-left-right',       label:'Fusionador'  },
          { id:'informes',   icon:'file-earmark-bar-graph', label:'Informes'    },
        ].map(t => (
          <li key={t.id} className="nav-item">
            <button className={`nav-link ${tab===t.id?'active':''}`} onClick={() => setTab(t.id)}>
              <i className={`bi bi-${t.icon} me-1`}/>{t.label}
            </button>
          </li>
        ))}
      </ul>

      {/* Contenido */}
      {tab==='dashboard'  && TabDashboard()}
      {tab==='parte'      && TabParteDiario()}
      {tab==='asistencia' && TabAsistencia()}
      {tab==='registros'  && TabRegistros()}
      {tab==='empleados'  && TabEmpleados()}
      {tab==='proyectos'  && TabProyectos()}
      {tab==='actividades' && TabActividades()}
      {tab==='fusionador' && TabFusionador()}
      {tab==='informes'   && TabInformes()}

      {/* Modales */}
      {ModalRegistro()}
      {ModalEmpleado()}
      {ModalDispositivo()}
    </div>
  )
}
