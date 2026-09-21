import { useState, useEffect, useCallback } from 'react'
import api from '../../api/client'
import { puedeEscribir } from '../../store/authStore'
import { nextItemKey } from '../../utils/itemKey'
import { manejarPegadoNumero } from '../../utils/numero'
import { MONTO_OCULTO, esMontoOculto } from '../../utils/montoOculto'

const fmtUsd = n => esMontoOculto(n) ? MONTO_OCULTO : new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n || 0)
const fmtArs = n => esMontoOculto(n) ? MONTO_OCULTO : new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0)
const fmtFecha = iso => {
  if (!iso) return '—'
  const d = new Date(iso.slice(0, 10) + 'T00:00:00')
  return isNaN(d) ? iso : d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const UNIDADES_MANO_OBRA = ['DIAS', 'GL', 'HORAS', 'UNIDAD']

const TIPO_ABBR = {
  material:  { label: 'MA', color: 'text-primary',   titulo: 'Material del catálogo del sistema' },
  mano_obra: { label: 'MO', color: 'text-warning',   titulo: 'Mano de obra' },
  otro:      { label: 'OT', color: 'text-secondary', titulo: 'Material que todavía no está en el catálogo — cargado a mano' },
}

const itemVacio = tipo => ({
  _key: nextItemKey(), tipo, producto_id: null,
  codigo: '', descripcion: '', unidad: tipo === 'mano_obra' ? 'DIAS' : 'UNIDAD',
  cantidad: 1, precio_unitario: 0,
})

const moduloVacio = () => ({ _key: nextItemKey(), nombre: '', items: [] })

// ── Exportar a Excel — arma un .xlsx parecido a la planilla que este módulo
// reemplaza: encabezado con nombre/cliente/fecha y resumen de costo/utilidad,
// y abajo una tabla por cada módulo con sus ítems y su subtotal. Usa siempre
// el costeo YA GUARDADO (se pide de nuevo al backend antes de exportar), así
// nunca exporta cambios sin guardar.
const NAVY = 'FF1A3A5C'
const GRIS_CLARO = 'FFF2F2F2'
const money = '"U$S" #,##0.00'

async function generarExcelCosteo(costeo) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Costeo')
  // A Item · B Código · C Descripción · D Cantidad · E Unidad · F Precio U$S · G Total U$S · H Tipo
  ws.columns = [{ width: 8 }, { width: 12 }, { width: 46 }, { width: 11 }, { width: 11 }, { width: 14 }, { width: 14 }, { width: 8 }]

  const barra = (row, texto) => {
    ws.mergeCells(`A${row}:H${row}`)
    const c = ws.getCell(`A${row}`)
    c.value = texto
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
  }
  const etiqueta = (row, texto) => {
    ws.getCell(`A${row}`).value = texto
    ws.getCell(`A${row}`).font = { bold: true }
  }
  // Etiqueta del resumen: fusiona A:C (en vez de dejar el texto en la angosta
  // columna A "desbordando" sobre las de al lado) para que la celda ocupe de
  // verdad todo el espacio hasta la columna D, con el texto pegado a la
  // derecha, contra el valor — así los bordes de celda coinciden con lo que
  // se ve.
  const etiquetaResumen = (row, texto) => {
    ws.mergeCells(`A${row}:C${row}`)
    const c = ws.getCell(`A${row}`)
    c.value = texto
    c.font = { bold: true }
    c.alignment = { horizontal: 'right' }
  }
  // Escribe un valor (o fórmula, pasando { formula: '...' }) en la celda
  // indicada. Se usa 'D' para el resumen (alineado con la columna Cantidad
  // de las tablas de ítems) y 'B' para Cliente/Fecha, que van pegados a su
  // etiqueta.
  const valor = (row, col, val, fmt) => {
    const c = ws.getCell(`${col}${row}`)
    c.value = val
    if (fmt) c.numFmt = fmt
    return c
  }

  barra(1, `COSTEO DE EQUIPOS — ${costeo.nombre || ''}`)
  etiqueta(2, 'Cliente:'); valor(2, 'B', costeo.cliente || '—')
  etiqueta(3, 'Fecha:'); valor(3, 'B', fmtFecha(costeo.fecha))

  // El resumen se deja con FÓRMULAS (no valores fijos) para que el excel se
  // pueda seguir usando como planilla de trabajo: si se corrige una cantidad,
  // un precio o un multiplicador de utilidad, todo se recalcula solo.
  barra(5, 'RESUMEN')
  etiquetaResumen(6, 'Costo material')
  etiquetaResumen(7, 'Costo mano de obra')
  etiquetaResumen(8, 'Costo total')
  etiquetaResumen(9, 'Utilidad material (multiplicador)')
  etiquetaResumen(10, 'Utilidad mano de obra (multiplicador)')
  etiquetaResumen(11, 'Utilidad extra (multiplicador)')
  etiquetaResumen(12, 'Venta material')
  etiquetaResumen(13, 'Venta mano de obra')
  const filaVentaTotal = 14
  etiquetaResumen(filaVentaTotal, 'PRECIO DE VENTA')
  ws.getCell(`A${filaVentaTotal}`).font = { bold: true, size: 12 }

  valor(9, 'D', parseFloat(costeo.utilidad_material) || 1)
  valor(10, 'D', parseFloat(costeo.utilidad_mano_obra) || 1)
  valor(11, 'D', parseFloat(costeo.utilidad_extra) || 1)
  valor(12, 'D', { formula: 'D6*D9' }, money)
  valor(13, 'D', { formula: 'D7*D10' }, money)
  // El tamaño de letra más grande de esta fila no entra en el ancho normal de
  // la columna D — sin este merge, Excel muestra "##########" en vez del
  // número (le pasa a cualquier celda numérica cuando el contenido no entra).
  ws.mergeCells(`D${filaVentaTotal}:E${filaVentaTotal}`)
  valor(filaVentaTotal, 'D', { formula: '(D12+D13)*D11' }, money).font = { bold: true, size: 12 }

  let row = 15
  let filaTipoCambio = null
  if (costeo.venta_total_pesos != null) {
    etiquetaResumen(row, 'Tipo de cambio')
    filaTipoCambio = row
    valor(row, 'D', costeo.tipo_cambio)
    row++
    etiquetaResumen(row, 'Precio de venta en pesos')
    valor(row, 'D', { formula: `D${filaVentaTotal}*D${filaTipoCambio}` }, '"$" #,##0')
    row++
  }
  row += 1

  const celdasSubtotalMaterial = []
  const celdasSubtotalManoObra = []
  const sumaOCero = celdas => celdas.length ? { formula: celdas.join('+') } : 0

  for (const modulo of costeo.modulos) {
    barra(row, modulo.nombre || 'Módulo sin nombre')
    row++
    const filaHeader = row
    ws.getRow(filaHeader).values = ['Item', 'Código', 'Descripción', 'Cantidad', 'Unidad', 'Precio U$S', 'Total U$S', 'Tipo']
    ws.getRow(filaHeader).font = { bold: true }
    ws.getRow(filaHeader).eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS_CLARO } } })
    row++
    const filasMaterial = []
    const filasManoObra = []
    modulo.items.forEach((it, idx) => {
      const filaItem = row
      const r = ws.getRow(filaItem)
      r.values = [idx + 1, it.codigo || '', it.descripcion, parseFloat(it.cantidad) || 0, it.unidad, parseFloat(it.precio_unitario) || 0, undefined, TIPO_ABBR[it.tipo]?.label || '']
      r.getCell(6).numFmt = money
      const celdaTotal = r.getCell(7)
      celdaTotal.value = { formula: `D${filaItem}*F${filaItem}` }
      celdaTotal.numFmt = money
      ;(it.tipo === 'mano_obra' ? filasManoObra : filasMaterial).push(`G${filaItem}`)
      row++
    })
    // Tres filas apiladas: total del módulo arriba (alineado con la columna
    // Total U$S de los ítems) y el detalle Material/Mano de obra debajo,
    // alineado con la columna Precio U$S.
    const filaTotalModulo = row
    const filaMaterialModulo = row + 1
    const filaManoObraModulo = row + 2
    const etiquetaSubtotal = (fila, texto) => {
      ws.mergeCells(`C${fila}:E${fila}`)
      ws.getCell(`C${fila}`).value = texto
      ws.getCell(`C${fila}`).alignment = { horizontal: 'right' }
    }
    etiquetaSubtotal(filaTotalModulo, 'Subtotal módulo:')
    ws.getCell(`G${filaTotalModulo}`).value = { formula: `F${filaMaterialModulo}+F${filaManoObraModulo}` }
    ws.getCell(`G${filaTotalModulo}`).numFmt = money
    etiquetaSubtotal(filaMaterialModulo, 'Material:')
    ws.getCell(`F${filaMaterialModulo}`).value = sumaOCero(filasMaterial)
    ws.getCell(`F${filaMaterialModulo}`).numFmt = money
    etiquetaSubtotal(filaManoObraModulo, 'Mano de obra:')
    ws.getCell(`F${filaManoObraModulo}`).value = sumaOCero(filasManoObra)
    ws.getCell(`F${filaManoObraModulo}`).numFmt = money
    ws.getRow(filaTotalModulo).font = { bold: true }
    ws.getRow(filaMaterialModulo).font = { bold: true }
    ws.getRow(filaManoObraModulo).font = { bold: true }
    celdasSubtotalMaterial.push(`F${filaMaterialModulo}`)
    celdasSubtotalManoObra.push(`F${filaManoObraModulo}`)
    row += 4
  }

  // Recién acá se conocen las celdas de subtotal de cada módulo, así que se
  // completan las dos primeras filas del resumen con la suma de todas ellas.
  valor(6, 'D', sumaOCero(celdasSubtotalMaterial), money)
  valor(7, 'D', sumaOCero(celdasSubtotalManoObra), money)
  valor(8, 'D', { formula: 'D6+D7' }, money)

  if (costeo.observaciones) {
    barra(row, 'OBSERVACIONES')
    row++
    ws.getCell(`A${row}`).value = costeo.observaciones
    ws.mergeCells(`A${row}:H${row}`)
    ws.getCell(`A${row}`).alignment = { wrapText: true }
  }

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const nombreArchivo = (costeo.nombre || 'costeo').trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '_')
  a.href = url
  a.download = `Costeo_${nombreArchivo || 'equipo'}_${(costeo.fecha || '').slice(0, 10) || new Date().toISOString().slice(0, 10)}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

export default function CosteoEquipos() {
  const canWrite = puedeEscribir('costeo_equipos')
  const [vista, setVista] = useState('lista') // 'lista' | 'editor'

  const [lista, setLista] = useState([])
  const [cargandoLista, setCargandoLista] = useState(true)

  const cargarLista = useCallback(() => {
    setCargandoLista(true)
    api.get('/costeo-equipos').then(r => setLista(r.data)).catch(e => console.error(e)).finally(() => setCargandoLista(false))
  }, [])

  useEffect(() => { if (vista === 'lista') cargarLista() }, [vista, cargarLista])

  const [costeo, setCosteo] = useState(null)
  const [cargandoCosteo, setCargandoCosteo] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [err, setErr] = useState('')

  // Materiales del catálogo con un "pedido de precio" pendiente hacia
  // Administración — mismo mecanismo que ya usa Materiales.jsx.
  const [pedidosPrecioIds, setPedidosPrecioIds] = useState(new Set())
  const cargarPedidosPrecio = useCallback(() => {
    api.get('/pedidos-precio/pendientes-ids').then(r => setPedidosPrecioIds(new Set(r.data.map(p => p.producto_id)))).catch(e => console.error(e))
  }, [])
  const pedirPrecioCatalogo = async productoId => {
    try {
      await api.post('/pedidos-precio', { producto_id: productoId })
      setPedidosPrecioIds(prev => new Set(prev).add(productoId))
    } catch (e) { alert(e.response?.data?.error || 'No se pudo enviar el pedido de precio') }
  }

  const abrirCosteo = id => {
    setVista('editor'); setCargandoCosteo(true); setErr('')
    cargarPedidosPrecio()
    api.get(`/costeo-equipos/${id}`)
      .then(r => setCosteo({
        ...r.data,
        modulos: r.data.modulos.map(m => ({ ...m, _key: nextItemKey(), items: m.items.map(it => ({ ...it, _key: nextItemKey() })) })),
      }))
      .catch(e => { console.error(e); alert('No se pudo abrir el costeo') })
      .finally(() => setCargandoCosteo(false))
  }

  const nuevoCosteo = async () => {
    try {
      const { data } = await api.post('/costeo-equipos', { nombre: 'Nuevo costeo' })
      abrirCosteo(data.id)
    } catch (e) { alert(e.response?.data?.error || 'No se pudo crear el costeo') }
  }

  const eliminarCosteo = async c => {
    if (!confirm(`¿Eliminar el costeo "${c.nombre}"? Esta acción no se puede deshacer.`)) return
    try {
      await api.delete(`/costeo-equipos/${c.id}`)
      cargarLista()
    } catch (e) { alert(e.response?.data?.error || 'No se pudo eliminar') }
  }

  const [exportando, setExportando] = useState(null)
  const exportarExcel = async id => {
    setExportando(id)
    try {
      const { data } = await api.get(`/costeo-equipos/${id}`)
      // El Excel arma subtotales con fórmulas numéricas por celda — no hay
      // forma prolija de mostrar el sentinel ahí adentro. Antes de este
      // chequeo, un precio oculto se colaba como 0 (parseFloat del
      // sentinel), mostrando un Excel con costos "gratis" en vez de avisar
      // que el dato está oculto.
      const hayMontoOculto = (data.modulos || []).some(m => (m.items || []).some(it => esMontoOculto(it.precio_unitario)))
      if (hayMontoOculto) { alert('Este costeo tiene montos ocultos para tu usuario — no se puede exportar a Excel.'); return }
      await generarExcelCosteo(data)
    } catch (e) {
      console.error(e)
      alert('No se pudo generar el Excel')
    } finally { setExportando(null) }
  }

  const volver = () => { setCosteo(null); setVista('lista') }

  const guardar = async () => {
    if (!costeo.nombre?.trim()) { setErr('Ponele un nombre al costeo antes de guardar'); return }
    setGuardando(true); setErr('')
    try {
      await api.put(`/costeo-equipos/${costeo.id}`, costeo)
      volver()
    } catch (e) {
      setErr(e.response?.data?.error || 'Error al guardar')
    } finally { setGuardando(false) }
  }

  /* ── Edición de módulos e ítems (todo en memoria, se guarda todo junto) ── */
  const setCampo = campo => valor => setCosteo(c => ({ ...c, [campo]: valor }))

  const agregarModulo = () => setCosteo(c => ({ ...c, modulos: [...c.modulos, moduloVacio()] }))
  const eliminarModulo = mKey => {
    if (!confirm('¿Eliminar este módulo y todos sus ítems?')) return
    setCosteo(c => ({ ...c, modulos: c.modulos.filter(m => m._key !== mKey) }))
  }
  const setNombreModulo = (mKey, nombre) =>
    setCosteo(c => ({ ...c, modulos: c.modulos.map(m => m._key === mKey ? { ...m, nombre } : m) }))

  const agregarItem = (mKey, item) =>
    setCosteo(c => ({ ...c, modulos: c.modulos.map(m => m._key === mKey ? { ...m, items: [...m.items, item] } : m) }))
  const quitarItem = (mKey, iKey) =>
    setCosteo(c => ({ ...c, modulos: c.modulos.map(m => m._key === mKey ? { ...m, items: m.items.filter(it => it._key !== iKey) } : m) }))
  const setCampoItem = (mKey, iKey, campo, valor) =>
    setCosteo(c => ({
      ...c,
      modulos: c.modulos.map(m => m._key !== mKey ? m : {
        ...m, items: m.items.map(it => it._key === iKey ? { ...it, [campo]: valor } : it),
      }),
    }))

  /* ── Cálculos en vivo ─────────────────────────────────────────────── */
  // Si el precio_unitario de algún ítem vino enmascarado (usuario con
  // "oculta_montos"), sumar el sentinel a un número da basura (concatenación
  // de string) — en cambio, todo el subtotal que dependa de ese ítem queda
  // igual de oculto que sus partes.
  const subtotalesModulo = m => {
    // "otro" (material fuera del catálogo, cargado a mano) cuenta como material para costo/margen.
    const itemsMaterial = m.items.filter(i => i.tipo === 'material' || i.tipo === 'otro')
    const itemsManoObra = m.items.filter(i => i.tipo === 'mano_obra')
    const material = itemsMaterial.some(i => esMontoOculto(i.precio_unitario))
      ? MONTO_OCULTO
      : itemsMaterial.reduce((s, i) => s + (parseFloat(i.cantidad) || 0) * (parseFloat(i.precio_unitario) || 0), 0)
    const manoObra = itemsManoObra.some(i => esMontoOculto(i.precio_unitario))
      ? MONTO_OCULTO
      : itemsManoObra.reduce((s, i) => s + (parseFloat(i.cantidad) || 0) * (parseFloat(i.precio_unitario) || 0), 0)
    const total = (esMontoOculto(material) || esMontoOculto(manoObra)) ? MONTO_OCULTO : material + manoObra
    return { material, manoObra, total }
  }
  const totales = () => {
    if (!costeo) return null
    const subs = costeo.modulos.map(subtotalesModulo)
    const acumMat = subs.some(s => esMontoOculto(s.material)) ? MONTO_OCULTO : subs.reduce((s, x) => s + x.material, 0)
    const acumMdo = subs.some(s => esMontoOculto(s.manoObra)) ? MONTO_OCULTO : subs.reduce((s, x) => s + x.manoObra, 0)
    const costoTotal = (esMontoOculto(acumMat) || esMontoOculto(acumMdo)) ? MONTO_OCULTO : acumMat + acumMdo
    const ventaMat = esMontoOculto(acumMat) ? MONTO_OCULTO : acumMat * (parseFloat(costeo.utilidad_material) || 1)
    const ventaMdo = esMontoOculto(acumMdo) ? MONTO_OCULTO : acumMdo * (parseFloat(costeo.utilidad_mano_obra) || 1)
    const ventaTotal = (esMontoOculto(ventaMat) || esMontoOculto(ventaMdo)) ? MONTO_OCULTO : (ventaMat + ventaMdo) * (parseFloat(costeo.utilidad_extra) || 1)
    const tc = parseFloat(costeo.tipo_cambio) || 0
    return {
      costoMat: acumMat, costoMdo: acumMdo, costoTotal, ventaMat, ventaMdo, ventaTotal,
      ventaTotalPesos: esMontoOculto(ventaTotal) ? MONTO_OCULTO : (tc > 0 ? ventaTotal * tc : null),
    }
  }

  /* ══════════════════════════════ VISTA: LISTADO ══════════════════════════════ */
  if (vista === 'lista') {
    return (
      <div>
        <div className="d-flex justify-content-between align-items-center mb-3">
          <div>
            <h4 className="mb-0 fw-bold"><i className="bi bi-calculator me-2 text-primary" />Costeo de Equipos</h4>
            <p className="text-muted small mb-0">Costo de materiales y mano de obra para cotizar una planta o equipo</p>
          </div>
          {canWrite && (
            <button className="btn btn-primary" onClick={nuevoCosteo}>
              <i className="bi bi-plus-circle me-2" />Nuevo costeo
            </button>
          )}
        </div>

        {cargandoLista ? (
          <div className="d-flex justify-content-center py-5"><span className="spinner-border text-secondary" /></div>
        ) : lista.length === 0 ? (
          <div className="text-center text-muted py-5">
            <i className="bi bi-calculator display-4 d-block mb-3" />
            Todavía no hay ningún costeo cargado.
          </div>
        ) : (
          <div className="card border-0 shadow-sm">
            <div className="table-responsive">
              <table className="table table-hover align-middle mb-0">
                <thead className="table-light">
                  <tr>
                    <th>Nombre</th><th>Cliente</th><th>Fecha</th>
                    <th className="text-end">Costo total</th><th className="text-end">Venta total</th><th></th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map(c => (
                    <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => abrirCosteo(c.id)}>
                      <td className="fw-semibold">{c.nombre}</td>
                      <td className="text-muted">{c.cliente || '—'}</td>
                      <td className="text-muted">{fmtFecha(c.fecha)}</td>
                      <td className="text-end">{fmtUsd(c.costo_total)}</td>
                      <td className="text-end fw-semibold">{fmtUsd(c.venta_total)}</td>
                      <td onClick={e => e.stopPropagation()} className="text-end">
                        {/* Exportar es una acción de lectura — no depende de canWrite */}
                        <button className="btn btn-sm btn-outline-success me-1" title="Exportar a Excel" disabled={exportando === c.id}
                          onClick={() => exportarExcel(c.id)}>
                          {exportando === c.id ? <span className="spinner-border spinner-border-sm" /> : <i className="bi bi-file-earmark-excel" />}
                        </button>
                        {canWrite && (
                          <button className="btn btn-sm btn-outline-danger" title="Eliminar" onClick={() => eliminarCosteo(c)}>
                            <i className="bi bi-trash" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    )
  }

  /* ══════════════════════════════ VISTA: EDITOR ══════════════════════════════ */
  if (cargandoCosteo || !costeo) {
    return <div className="d-flex justify-content-center py-5"><span className="spinner-border text-secondary" /></div>
  }
  const tot = totales()

  return (
    <div style={{ fontSize: '1.05rem' }}>
      <div className="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
        <button className="btn btn-outline-secondary" onClick={volver}>
          <i className="bi bi-arrow-left me-2" />Volver al listado
        </button>
        <div className="d-flex gap-2">
          {/* Exportar es una acción de lectura — no depende de canWrite */}
          <button className="btn btn-outline-success" disabled={exportando === costeo.id} onClick={() => exportarExcel(costeo.id)}
            title="Exporta lo último guardado — si hiciste cambios, guardalos primero">
            {exportando === costeo.id
              ? <><span className="spinner-border spinner-border-sm me-2" />Generando...</>
              : <><i className="bi bi-file-earmark-excel me-2" />Exportar a Excel</>}
          </button>
          {canWrite && (
            <button className="btn btn-primary btn-lg" disabled={guardando} onClick={guardar}>
              {guardando ? <><span className="spinner-border spinner-border-sm me-2" />Guardando...</> : <><i className="bi bi-check-lg me-2" />Guardar</>}
            </button>
          )}
        </div>
      </div>

      {err && <div className="alert alert-danger">{err}</div>}

      {/* ── Datos generales + resumen ─────────────────────────────────── */}
      <div className="card border-0 shadow-sm mb-3">
        <div className="card-body">
          <div className="row g-3">
            <div className="col-md-5">
              <label className="form-label fw-semibold">Nombre de la planta / equipo</label>
              <input className="form-control form-control-lg" value={costeo.nombre} disabled={!canWrite}
                onChange={e => setCampo('nombre')(e.target.value)} />
            </div>
            <div className="col-md-4">
              <label className="form-label fw-semibold">Cliente</label>
              <input className="form-control form-control-lg" value={costeo.cliente || ''} disabled={!canWrite}
                onChange={e => setCampo('cliente')(e.target.value)} />
            </div>
            <div className="col-md-3">
              <label className="form-label fw-semibold">Fecha</label>
              <input type="date" className="form-control form-control-lg" value={(costeo.fecha || '').slice(0, 10)} disabled={!canWrite}
                onChange={e => setCampo('fecha')(e.target.value)} />
            </div>
          </div>

          <hr />

          <div className="row g-3">
            <div className="col-6 col-md-3">
              <label className="form-label small">Utilidad Material</label>
              <input type="number" onPaste={manejarPegadoNumero} step="0.01" min="0" className="form-control" value={costeo.utilidad_material} disabled={!canWrite}
                onChange={e => setCampo('utilidad_material')(e.target.value)} />
              <div className="form-text">1.80 = 80% de ganancia</div>
            </div>
            <div className="col-6 col-md-3">
              <label className="form-label small">Utilidad Mano de obra</label>
              <input type="number" onPaste={manejarPegadoNumero} step="0.01" min="0" className="form-control" value={costeo.utilidad_mano_obra} disabled={!canWrite}
                onChange={e => setCampo('utilidad_mano_obra')(e.target.value)} />
            </div>
            <div className="col-6 col-md-3">
              <label className="form-label small">Utilidad extra</label>
              <input type="number" onPaste={manejarPegadoNumero} step="0.01" min="0" className="form-control" value={costeo.utilidad_extra} disabled={!canWrite}
                onChange={e => setCampo('utilidad_extra')(e.target.value)} />
              <div className="form-text">Se aplica sobre el total final</div>
            </div>
            <div className="col-6 col-md-3">
              <label className="form-label small">Tipo de cambio (opcional)</label>
              <input type="number" onPaste={manejarPegadoNumero} step="0.01" min="0" className="form-control" value={costeo.tipo_cambio || ''} disabled={!canWrite}
                placeholder="Ej: 1490.50" onChange={e => setCampo('tipo_cambio')(e.target.value)} />
              <div className="form-text">Para ver el total también en pesos</div>
            </div>
          </div>

          <hr />

          <div className="row g-2 text-center">
            <div className="col-6 col-md-3">
              <div className="text-muted small">Costo material</div>
              <div className="fs-5">{fmtUsd(tot.costoMat)}</div>
            </div>
            <div className="col-6 col-md-3">
              <div className="text-muted small">Costo mano de obra</div>
              <div className="fs-5">{fmtUsd(tot.costoMdo)}</div>
            </div>
            <div className="col-6 col-md-3">
              <div className="text-muted small">Costo total</div>
              <div className="fs-5 fw-semibold">{fmtUsd(tot.costoTotal)}</div>
            </div>
            <div className="col-6 col-md-3">
              <div className="text-muted small">Precio de venta</div>
              <div className="fs-4 fw-bold text-primary">{fmtUsd(tot.ventaTotal)}</div>
              {tot.ventaTotalPesos != null && <div className="text-muted small">≈ {fmtArs(tot.ventaTotalPesos)}</div>}
            </div>
          </div>
        </div>
      </div>

      {/* ── Módulos ────────────────────────────────────────────────────── */}
      {costeo.modulos.map(m => (
        <ModuloCard key={m._key} modulo={m} canWrite={canWrite}
          subtotales={subtotalesModulo(m)}
          onNombre={n => setNombreModulo(m._key, n)}
          onEliminar={() => eliminarModulo(m._key)}
          onAgregarItem={item => agregarItem(m._key, item)}
          onQuitarItem={iKey => quitarItem(m._key, iKey)}
          onCambiarItem={(iKey, campo, valor) => setCampoItem(m._key, iKey, campo, valor)}
          pedidosPrecioIds={pedidosPrecioIds}
          onPedirPrecioCatalogo={pedirPrecioCatalogo}
        />
      ))}

      {canWrite && (
        <button className="btn btn-outline-primary btn-lg w-100 mb-3" onClick={agregarModulo}>
          <i className="bi bi-plus-circle me-2" />Agregar módulo
        </button>
      )}

      <div className="card border-0 shadow-sm mb-3">
        <div className="card-body">
          <label className="form-label fw-semibold">Observaciones</label>
          <textarea className="form-control" rows={3} value={costeo.observaciones || ''} disabled={!canWrite}
            onChange={e => setCampo('observaciones')(e.target.value)} />
        </div>
      </div>

      {canWrite && (
        <div className="d-flex justify-content-end mb-4">
          <button className="btn btn-primary btn-lg" disabled={guardando} onClick={guardar}>
            {guardando ? <><span className="spinner-border spinner-border-sm me-2" />Guardando...</> : <><i className="bi bi-check-lg me-2" />Guardar</>}
          </button>
        </div>
      )}
    </div>
  )
}

/* ── Tarjeta de un módulo ─────────────────────────────────────────────── */
function ModuloCard({ modulo, canWrite, subtotales, onNombre, onEliminar, onAgregarItem, onQuitarItem, onCambiarItem, pedidosPrecioIds, onPedirPrecioCatalogo }) {
  return (
    <div className="card border-0 shadow-sm mb-3">
      <div className="card-body">
        <div className="d-flex gap-2 align-items-center mb-3">
          <input className="form-control form-control-lg fw-semibold" placeholder="Nombre del módulo (ej: Módulo Reactor Aeróbico)"
            value={modulo.nombre} disabled={!canWrite} onChange={e => onNombre(e.target.value)} />
          {canWrite && (
            <button className="btn btn-outline-danger" title="Eliminar módulo" onClick={onEliminar}>
              <i className="bi bi-trash" />
            </button>
          )}
        </div>

        {modulo.items.length > 0 && (
          <div className="table-responsive mb-2">
            <table className="table table-sm align-middle mb-0">
              <thead className="table-light">
                <tr>
                  <th style={{ width: 30 }} />
                  <th style={{ width: 90 }}>Código</th>
                  <th style={{ width: 'auto' }}>Descripción</th>
                  <th style={{ width: 46 }}>Cant.</th>
                  <th style={{ width: 55 }}>Un.</th>
                  <th style={{ width: 85 }} className="text-end">Precio U$S</th>
                  <th style={{ width: 95 }} className="text-end">Total U$S</th>
                  {canWrite && <th style={{ width: 36 }} />}
                </tr>
              </thead>
              <tbody>
                {modulo.items.map(it => (
                  <tr key={it._key}>
                    <td className={`fw-bold small ${TIPO_ABBR[it.tipo]?.color || ''}`} title={TIPO_ABBR[it.tipo]?.titulo}>
                      {TIPO_ABBR[it.tipo]?.label || '—'}
                    </td>
                    <td>
                      <input className="form-control form-control-sm" value={it.codigo || ''} disabled={!canWrite || it.producto_id != null}
                        title={it.producto_id != null ? 'Viene del material del catálogo' : undefined}
                        onChange={e => onCambiarItem(it._key, 'codigo', e.target.value)} />
                    </td>
                    <td>
                      <input className="form-control form-control-sm" value={it.descripcion} disabled={!canWrite}
                        onChange={e => onCambiarItem(it._key, 'descripcion', e.target.value)} />
                    </td>
                    <td>
                      <input type="number" onPaste={manejarPegadoNumero} step="any" className="form-control form-control-sm input-sin-flechas px-1" style={{ textAlign: 'right' }}
                        value={it.cantidad} disabled={!canWrite}
                        onChange={e => onCambiarItem(it._key, 'cantidad', e.target.value)} />
                    </td>
                    <td>
                      {it.tipo === 'mano_obra' ? (
                        <select className="form-select form-select-sm" value={it.unidad} disabled={!canWrite}
                          onChange={e => onCambiarItem(it._key, 'unidad', e.target.value)}>
                          {UNIDADES_MANO_OBRA.map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                      ) : (
                        <input className="form-control form-control-sm" value={it.unidad} disabled={!canWrite}
                          onChange={e => onCambiarItem(it._key, 'unidad', e.target.value)} />
                      )}
                    </td>
                    <td>
                      <div className="d-flex align-items-center gap-1">
                        <input type="number" onPaste={manejarPegadoNumero} step="0.01" className="form-control form-control-sm input-sin-flechas text-end px-1" value={it.precio_unitario} disabled={!canWrite}
                          onChange={e => onCambiarItem(it._key, 'precio_unitario', e.target.value)} />
                        {it.producto_id != null && it.precio_actual_usd != null && !esMontoOculto(it.precio_actual_usd)
                          && Math.abs(it.precio_actual_usd - (parseFloat(it.precio_unitario) || 0)) > 0.005 && (
                          canWrite ? (
                            <button type="button" className="btn btn-sm btn-outline-warning py-0 px-1 flex-shrink-0" style={{ fontSize: '0.7rem' }}
                              title={`El precio de hoy en Materiales es ${fmtUsd(it.precio_actual_usd)} — clic para usarlo en este costeo (no se aplica solo)`}
                              onClick={() => onCambiarItem(it._key, 'precio_unitario', it.precio_actual_usd)}>
                              <i className="bi bi-exclamation-triangle-fill" />
                            </button>
                          ) : (
                            <i className="bi bi-exclamation-triangle-fill text-warning flex-shrink-0"
                              title={`El precio de hoy en Materiales es ${fmtUsd(it.precio_actual_usd)} — este costeo sigue con el que se guardó`} />
                          )
                        )}
                        {canWrite && it.producto_id != null ? (
                          pedidosPrecioIds.has(it.producto_id) ? (
                            <span className="text-warning flex-shrink-0" style={{ fontSize: '0.7rem' }} title="Ya se le pidió el precio a Administración">
                              <i className="bi bi-clock-history" />
                            </span>
                          ) : (
                            <button type="button" className="btn btn-sm btn-outline-secondary py-0 px-1 flex-shrink-0" style={{ fontSize: '0.7rem' }}
                              title="Pedirle el precio de este material a Administración"
                              onClick={() => onPedirPrecioCatalogo(it.producto_id)}>
                              <i className="bi bi-cash-coin" />
                            </button>
                          )
                        ) : canWrite && (
                          <PedirPrecio onUsar={usd => onCambiarItem(it._key, 'precio_unitario', usd)} />
                        )}
                      </div>
                    </td>
                    <td className="text-end fw-semibold">
                      {esMontoOculto(it.precio_unitario) ? MONTO_OCULTO : fmtUsd((parseFloat(it.cantidad) || 0) * (parseFloat(it.precio_unitario) || 0))}
                    </td>
                    {canWrite && (
                      <td>
                        <button className="btn btn-sm btn-outline-danger py-0 px-2" onClick={() => onQuitarItem(it._key)}>
                          <i className="bi bi-x-lg" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {canWrite && (
          <div className="d-flex gap-2 flex-wrap align-items-center">
            <BuscadorMaterial onElegir={p => onAgregarItem({
              _key: nextItemKey(), tipo: 'material', producto_id: p.id,
              codigo: p.codigo, descripcion: p.descripcion, unidad: p.unidad, cantidad: 1, precio_unitario: p.precio_usd,
            })} />
            <button className="btn btn-outline-warning btn-sm" onClick={() => onAgregarItem(itemVacio('mano_obra'))}>
              <i className="bi bi-plus-lg me-1" />Mano de obra
            </button>
            <button className="btn btn-outline-secondary btn-sm" onClick={() => onAgregarItem(itemVacio('otro'))}
              title="Para un material que todavía no está cargado en el sistema">
              <i className="bi bi-plus-lg me-1" />Otros
            </button>
          </div>
        )}

        <div className="d-flex gap-4 justify-content-end mt-3 text-muted small">
          <span>Material: <strong className="text-dark">{fmtUsd(subtotales.material)}</strong></span>
          <span>Mano de obra: <strong className="text-dark">{fmtUsd(subtotales.manoObra)}</strong></span>
          <span>Subtotal módulo: <strong className="text-dark">{fmtUsd(subtotales.total)}</strong></span>
        </div>
      </div>
    </div>
  )
}

/* ── Buscador de materiales del catálogo del sistema ─────────────────── */
function BuscadorMaterial({ onElegir }) {
  const [q, setQ] = useState('')
  const [sugs, setSugs] = useState([])
  const [buscando, setBuscando] = useState(false)

  useEffect(() => {
    if (q.trim().length < 2) { setSugs([]); return }
    setBuscando(true)
    const t = setTimeout(() => {
      api.get('/costeo-equipos/materiales', { params: { buscar: q } })
        .then(r => setSugs(r.data))
        .catch(() => setSugs([]))
        .finally(() => setBuscando(false))
    }, 300)
    return () => clearTimeout(t)
  }, [q])

  return (
    <div className="position-relative" style={{ minWidth: 280 }}>
      <div className="input-group input-group-sm">
        <span className="input-group-text"><i className="bi bi-search" /></span>
        <input className="form-control" placeholder="Buscar material del catálogo..."
          value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {buscando && <div className="form-text">Buscando...</div>}
      {sugs.length > 0 && (
        <div className="list-group position-absolute w-100 shadow-sm" style={{ zIndex: 20, maxHeight: 260, overflowY: 'auto' }}>
          {sugs.map(p => (
            <button type="button" key={p.id} className="list-group-item list-group-item-action py-2"
              onClick={() => { onElegir(p); setQ(''); setSugs([]) }}>
              <div className="d-flex justify-content-between">
                <span><span className="fw-semibold">{p.codigo}</span> — {p.descripcion}</span>
                <span className="text-muted small ms-2">{fmtUsd(p.precio_usd)} / {p.unidad}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const TASA_EUR_USD = 1.2

/* ── Botón "Pedir precio" — carga rápida de un precio recién conseguido,
   convirtiendo a dólares si vino cotizado en euros ─────────────────────── */
function PedirPrecio({ onUsar }) {
  const [abierto, setAbierto] = useState(false)
  const [monto, setMonto] = useState('')
  const [moneda, setMoneda] = useState('USD')

  const usar = () => {
    const m = parseFloat(monto)
    if (!(m > 0)) return
    const usd = moneda === 'EUR' ? m * TASA_EUR_USD : m
    onUsar(Math.round(usd * 100) / 100)
    setAbierto(false); setMonto(''); setMoneda('USD')
  }

  return (
    <div className="position-relative flex-shrink-0">
      <button type="button" className="btn btn-sm btn-outline-secondary py-0 px-1" style={{ fontSize: '0.7rem' }}
        title="Cargar un precio que te acaban de pasar (en dólares o en euros)"
        onClick={() => setAbierto(a => !a)}>
        <i className="bi bi-cash-coin" />
      </button>
      {abierto && (
        <div className="card shadow-sm position-absolute p-2" style={{ zIndex: 30, top: '100%', right: 0, width: 210 }}>
          <label className="form-label small mb-1">Precio que te pasaron</label>
          <div className="input-group input-group-sm mb-2">
            <input type="number" onPaste={manejarPegadoNumero} step="0.01" min="0" className="form-control" autoFocus value={monto}
              onChange={e => setMonto(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && usar()} />
            <select className="form-select" style={{ maxWidth: 68 }} value={moneda} onChange={e => setMoneda(e.target.value)}>
              <option value="USD">US$</option>
              <option value="EUR">€</option>
            </select>
          </div>
          {moneda === 'EUR' && <div className="form-text mb-2">1 € = {TASA_EUR_USD.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} US$</div>}
          <div className="d-flex gap-1 justify-content-end">
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => setAbierto(false)}>Cancelar</button>
            <button type="button" className="btn btn-sm btn-primary" onClick={usar}>Usar</button>
          </div>
        </div>
      )}
    </div>
  )
}
