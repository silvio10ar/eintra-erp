'use strict'
const express = require('express')
const path = require('path')
const ExcelJS = require('exceljs')
const { db } = require('../db/database')
const { verificarToken, puede } = require('../middleware/auth')
const { tasaCambioSistema } = require('../helpers/tipoCambio')
const { hoyArgentina } = require('../helpers/fecha')

const LOGO_PATH = path.join(__dirname, '../assets/logo-eintra.png')
const AZUL = 'FF1F4E78'
const GRIS_CLARO = 'FFF2F2F2'
const fmtPesos = '"$" #,##0.00'
const fmtUsd   = '"USD" #,##0.00'

const router = express.Router()
router.use(verificarToken)
router.use(puede.leer('analisis_proyectos'))

// Costo de mano de obra: horas cargadas en "Mi Parte" (rrhh_registros) contra
// el costo_hora de cada empleado. Costo de materiales: lo efectivamente
// retirado de depósito (movimientos_stock, tipo 'salida' menos 'devolucion')
// atribuido al proyecto vía el campo de texto "proyecto" × precio_costo
// vigente del catálogo — no lo previsto en la pestaña Materiales de Proyectos.
//
// "proyecto" en movimientos_stock guarda el código del proyecto, PERO con dos
// formatos según de dónde salió el movimiento: un alta manual en Stock guarda
// solo el código (ver Stock.jsx), mientras que la entrega de un Pedido de
// Stock guarda "CODIGO — Nombre" (ver textoAsignacion en stock.js). El CASE de
// abajo extrae el código en ambos casos para poder agrupar por proyecto real.
const CODIGO_PROYECTO_DESDE_MOVIMIENTO = `
  CASE WHEN INSTR(m.proyecto, ' — ') > 0
    THEN SUBSTR(m.proyecto, 1, INSTR(m.proyecto, ' — ') - 1)
    ELSE m.proyecto
  END
`;

// El costo de mano de obra se carga siempre en pesos (costo_hora no tiene
// moneda propia), pero el precio de costo de un material puede estar en
// pesos, dólares o euros según en qué moneda se cargó (precio_moneda) — sin
// esta conversión, sumar ambos costos mezclaba unidades distintas como si
// fueran la misma (ej. "10 dólares" + "10 pesos" = "20"). Mismo criterio de
// conversión (tasaCambioSistema, pesos como moneda puente) que ya usa la
// lista de Materiales.
const PRECIO_COSTO_EN_PESOS = `
  (CASE
     WHEN pr.precio_moneda='DÓLAR' THEN COALESCE(pr.precio_costo,0) * ?
     WHEN pr.precio_moneda='EURO'  THEN COALESCE(pr.precio_costo,0) * ?
     ELSE COALESCE(pr.precio_costo,0)
   END)
`;

function listarAnalisis() {
  const hoy = hoyArgentina()
  const tcDolar = tasaCambioSistema('DÓLAR', hoy)
  const tcEuro = tasaCambioSistema('EURO', hoy)
  const rows = db.prepare(`
    SELECT p.id, p.codigo, p.nombre, p.cliente_nombre, p.estado, p.presupuesto_venta,
      COALESCE(h.horas_totales, 0)    AS horas_totales,
      COALESCE(h.costo_mano_obra, 0)  AS costo_mano_obra,
      COALESCE(mat.costo_materiales, 0) AS costo_materiales
    FROM proyectos p
    LEFT JOIN (
      SELECT r.proyecto_id,
        SUM(r.horas) AS horas_totales,
        SUM(r.horas * COALESCE(e.costo_hora, 0)) AS costo_mano_obra
      FROM rrhh_registros r
      JOIN rrhh_empleados e ON e.id = r.empleado_id
      WHERE r.proyecto_id IS NOT NULL
      GROUP BY r.proyecto_id
    ) h ON h.proyecto_id = p.id
    LEFT JOIN (
      SELECT ${CODIGO_PROYECTO_DESDE_MOVIMIENTO} AS codigo_proyecto,
        SUM((CASE WHEN m.tipo='salida' THEN m.cantidad WHEN m.tipo='devolucion' THEN -m.cantidad ELSE 0 END)
            * ${PRECIO_COSTO_EN_PESOS}) AS costo_materiales
      FROM movimientos_stock m
      LEFT JOIN productos pr ON pr.id = m.producto_id
      WHERE m.proyecto != '' AND m.tipo IN ('salida','devolucion')
      GROUP BY codigo_proyecto
    ) mat ON mat.codigo_proyecto = p.codigo
    WHERE p.codigo NOT LIKE 'HIST-%'
    ORDER BY p.id DESC
  `).all(tcDolar, tcEuro)
  // Además de pesos (moneda en la que se calcula y compara todo), se informa
  // el equivalente en dólares al tipo de cambio del sistema — mismo criterio
  // de conversión que el resto (null si no hay tasa cargada, en vez de un
  // 0 o un dato inventado).
  for (const r of rows) {
    r.costo_total = r.costo_mano_obra + r.costo_materiales
    r.costo_mano_obra_usd   = tcDolar ? r.costo_mano_obra / tcDolar : null
    r.costo_materiales_usd  = tcDolar ? r.costo_materiales / tcDolar : null
    r.costo_total_usd       = tcDolar ? r.costo_total / tcDolar : null
  }
  return rows
}

router.get('/', (req, res) => {
  res.json(listarAnalisis())
})

function detalleProyecto(id) {
  const proyecto = db.prepare(`
    SELECT id, codigo, nombre, cliente_nombre, estado, presupuesto_venta
    FROM proyectos WHERE id=?
  `).get(id)
  if (!proyecto) return null

  const hoy = hoyArgentina()
  const tcDolar = tasaCambioSistema('DÓLAR', hoy)
  const tcEuro = tasaCambioSistema('EURO', hoy)

  const porEmpleado = db.prepare(`
    SELECT e.id AS empleado_id, e.nombre, SUM(r.horas) AS horas, e.costo_hora,
      SUM(r.horas) * COALESCE(e.costo_hora, 0) AS subtotal
    FROM rrhh_registros r
    JOIN rrhh_empleados e ON e.id = r.empleado_id
    WHERE r.proyecto_id = ?
    GROUP BY e.id
    ORDER BY subtotal DESC
  `).all(id)
  for (const e of porEmpleado) e.subtotal_usd = tcDolar ? e.subtotal / tcDolar : null

  const porMaterial = db.prepare(`
    SELECT pr.id, pr.codigo, pr.descripcion, pr.unidad, pr.precio_costo, pr.precio_moneda,
      SUM(CASE WHEN m.tipo='salida' THEN m.cantidad WHEN m.tipo='devolucion' THEN -m.cantidad ELSE 0 END) AS cantidad,
      SUM(CASE WHEN m.tipo='salida' THEN m.cantidad WHEN m.tipo='devolucion' THEN -m.cantidad ELSE 0 END)
        * ${PRECIO_COSTO_EN_PESOS} AS subtotal
    FROM movimientos_stock m
    JOIN productos pr ON pr.id = m.producto_id
    WHERE m.tipo IN ('salida','devolucion')
      AND (m.proyecto = ? OR m.proyecto LIKE ? || ' — %')
    GROUP BY pr.id
    HAVING cantidad != 0
    ORDER BY subtotal DESC
  `).all(tcDolar, tcEuro, proyecto.codigo, proyecto.codigo)
  for (const m of porMaterial) m.subtotal_usd = tcDolar ? m.subtotal / tcDolar : null

  const costo_mano_obra = porEmpleado.reduce((s, e) => s + e.subtotal, 0)
  const costo_materiales = porMaterial.reduce((s, m) => s + m.subtotal, 0)
  const costo_total = costo_mano_obra + costo_materiales
  return {
    ...proyecto,
    horas_totales: porEmpleado.reduce((s, e) => s + e.horas, 0),
    costo_mano_obra, costo_materiales, costo_total,
    costo_mano_obra_usd:  tcDolar ? costo_mano_obra / tcDolar : null,
    costo_materiales_usd: tcDolar ? costo_materiales / tcDolar : null,
    costo_total_usd:      tcDolar ? costo_total / tcDolar : null,
    porEmpleado, porMaterial,
  }
}

router.get('/:id', (req, res) => {
  const detalle = detalleProyecto(req.params.id)
  if (!detalle) return res.status(404).json({ error: 'Proyecto no encontrado' })
  res.json(detalle)
})

// Encabezado de una sección (banda de color a todo el ancho de la tabla).
function bandaTitulo(ws, row, texto, ultimaCol) {
  ws.mergeCells(row, 1, row, ultimaCol)
  const c = ws.getCell(row, 1)
  c.value = texto
  c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }
  c.alignment = { vertical: 'middle', indent: 1 }
  ws.getRow(row).height = 20
}

function estiloHeaderTabla(cell) {
  cell.font = { bold: true, size: 10 }
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS_CLARO } }
  cell.border = { bottom: { style: 'thin', color: { argb: 'FFBBBBBB' } } }
  cell.alignment = { vertical: 'middle' }
}

function bordeFila(ws, row, desdeCol, hastaCol) {
  for (let c = desdeCol; c <= hastaCol; c++) {
    ws.getCell(row, c).border = { bottom: { style: 'hair', color: { argb: 'FFDDDDDD' } } }
  }
}

// Reporte de UN proyecto en una sola hoja, con logo y formato pensado para
// imprimir y entregar (no para reprocesar datos) — igual a lo que se ve al
// entrar al detalle: resumen + por empleado + por material.
// Exportar exige escribir — el resto del router solo pide leer, pero
// descargar el análisis no es lo mismo que verlo en pantalla.
router.get('/:id/exportar', puede.escribir('analisis_proyectos'), async (req, res) => {
  // Express 4 no enruta el rechazo de una promesa de un handler async al
  // middleware de errores — sin este try/catch, cualquier excepción acá
  // adentro (falta el logo, un dato inesperado, wb.xlsx.write que falla)
  // dejaba el request colgado hasta que el cliente/proxy lo cortara por
  // timeout, en vez de devolver un 500 claro.
  try {
  const d = detalleProyecto(req.params.id)
  if (!d) return res.status(404).json({ error: 'Proyecto no encontrado' })

  const wb = new ExcelJS.Workbook()
  wb.creator = 'E-INTRA ERP'
  wb.created = new Date()
  const ws = wb.addWorksheet('Análisis', {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
  })
  ws.headerFooter.oddFooter = '&L&8Generado automáticamente por E-INTRA ERP&C&8Página &P de &N&R&8&D &T'

  ws.columns = [
    { width: 14 }, { width: 30 }, { width: 12 }, { width: 12 },
    { width: 14 }, { width: 10 }, { width: 16 }, { width: 16 },
  ]
  const ULT_COL = 8

  // ── Encabezado con logo ──────────────────────────────────────────────
  const imgId = wb.addImage({ filename: LOGO_PATH, extension: 'png' })
  ws.addImage(imgId, { tl: { col: 0, row: 0 }, ext: { width: 169, height: 60 } })

  ws.mergeCells(1, 3, 1, ULT_COL)
  ws.getCell(1, 3).value = 'ANÁLISIS DE COSTOS POR PROYECTO'
  ws.getCell(1, 3).font = { bold: true, size: 16, color: { argb: AZUL } }
  ws.getCell(1, 3).alignment = { vertical: 'middle' }

  ws.mergeCells(2, 3, 2, ULT_COL)
  ws.getCell(2, 3).value = `${d.codigo} — ${d.nombre}`
  ws.getCell(2, 3).font = { bold: true, size: 12 }
  ws.getCell(2, 3).alignment = { vertical: 'middle' }

  ws.mergeCells(3, 3, 3, ULT_COL)
  ws.getCell(3, 3).value =
    `Cliente: ${d.cliente_nombre || '—'}    ·    Estado: ${d.estado}    ·    Generado: ${hoyArgentina()}`
  ws.getCell(3, 3).font = { italic: true, size: 9, color: { argb: 'FF666666' } }
  ws.getCell(3, 3).alignment = { vertical: 'middle' }

  // ── Resumen ───────────────────────────────────────────────────────────
  let r = 6
  bandaTitulo(ws, r, 'RESUMEN', ULT_COL)
  r++
  const tarjetas = [
    { label: 'Horas totales', valor: d.horas_totales.toLocaleString('es-AR', { maximumFractionDigits: 1 }) },
    { label: 'Mano de obra', valor: d.costo_mano_obra, usd: d.costo_mano_obra_usd },
    { label: 'Materiales', valor: d.costo_materiales, usd: d.costo_materiales_usd },
    { label: 'Costo total', valor: d.costo_total, usd: d.costo_total_usd, destacar: true },
  ]
  const filaLabel = r, filaValor = r + 1
  ws.getRow(filaValor).height = 30
  tarjetas.forEach((t, i) => {
    const c0 = i * 2 + 1
    ws.mergeCells(filaLabel, c0, filaLabel, c0 + 1)
    const lbl = ws.getCell(filaLabel, c0)
    lbl.value = t.label
    lbl.font = { size: 9, color: { argb: 'FF666666' } }

    ws.mergeCells(filaValor, c0, filaValor, c0 + 1)
    const val = ws.getCell(filaValor, c0)
    val.value = typeof t.valor === 'number'
      ? (t.usd != null ? `${new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(t.valor)}\nUSD ${t.usd.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : t.valor)
      : t.valor
    val.font = { bold: true, size: t.destacar ? 13 : 11 }
    val.alignment = { wrapText: true, vertical: 'middle' }
  })
  r = filaValor + 1

  if (d.presupuesto_venta > 0) {
    r++
    ws.mergeCells(r, 1, r, ULT_COL)
    const margen = d.presupuesto_venta - d.costo_total
    const margenPct = (margen / d.presupuesto_venta) * 100
    ws.getCell(r, 1).value =
      `Presupuesto de venta: ${new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(d.presupuesto_venta)}` +
      `    ·    Margen estimado: ${new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(margen)} (${margenPct.toFixed(1)}%)`
    ws.getCell(r, 1).font = { size: 10, bold: true, color: { argb: margen >= 0 ? 'FF1B7A3D' : 'FFB02A2A' } }
  }
  r += 2

  // ── Por empleado ──────────────────────────────────────────────────────
  bandaTitulo(ws, r, `MANO DE OBRA POR EMPLEADO (${d.horas_totales.toLocaleString('es-AR', { maximumFractionDigits: 1 })} hs)`, 5)
  r++
  const headerEmp = ['Empleado', 'Horas', 'Costo/hora', 'Subtotal ($)', 'Subtotal (USD)']
  headerEmp.forEach((h, i) => { const c = ws.getCell(r, i + 1); c.value = h; estiloHeaderTabla(c) })
  r++
  if (d.porEmpleado.length === 0) {
    ws.mergeCells(r, 1, r, 5)
    ws.getCell(r, 1).value = 'Sin horas cargadas para este proyecto todavía.'
    ws.getCell(r, 1).font = { italic: true, color: { argb: 'FF888888' } }
    r++
  } else {
    for (const e of d.porEmpleado) {
      ws.getCell(r, 1).value = e.nombre
      ws.getCell(r, 2).value = e.horas
      ws.getCell(r, 3).value = e.costo_hora || 0
      ws.getCell(r, 3).numFmt = fmtPesos
      ws.getCell(r, 4).value = e.subtotal
      ws.getCell(r, 4).numFmt = fmtPesos
      ws.getCell(r, 5).value = e.subtotal_usd
      if (e.subtotal_usd != null) ws.getCell(r, 5).numFmt = fmtUsd
      bordeFila(ws, r, 1, 5)
      r++
    }
    ws.getCell(r, 1).value = 'Total'
    ws.getCell(r, 1).font = { bold: true }
    ws.getCell(r, 4).value = d.costo_mano_obra
    ws.getCell(r, 4).numFmt = fmtPesos
    ws.getCell(r, 5).value = d.costo_mano_obra_usd
    if (d.costo_mano_obra_usd != null) ws.getCell(r, 5).numFmt = fmtUsd
    for (let c = 1; c <= 5; c++) {
      ws.getCell(r, c).font = { bold: true }
      ws.getCell(r, c).border = { top: { style: 'thin', color: { argb: 'FF333333' } } }
    }
    r++
  }
  r++

  // ── Por material ──────────────────────────────────────────────────────
  bandaTitulo(ws, r, 'MATERIALES RETIRADOS DE STOCK', ULT_COL)
  r++
  const headerMat = ['Código', 'Material', 'Cantidad', 'Unidad', 'Precio costo', 'Moneda', 'Subtotal ($)', 'Subtotal (USD)']
  headerMat.forEach((h, i) => { const c = ws.getCell(r, i + 1); c.value = h; estiloHeaderTabla(c) })
  r++
  if (d.porMaterial.length === 0) {
    ws.mergeCells(r, 1, r, ULT_COL)
    ws.getCell(r, 1).value = 'Sin materiales retirados de stock para este proyecto todavía.'
    ws.getCell(r, 1).font = { italic: true, color: { argb: 'FF888888' } }
    r++
  } else {
    for (const m of d.porMaterial) {
      ws.getCell(r, 1).value = m.codigo || ''
      ws.getCell(r, 2).value = m.descripcion
      ws.getCell(r, 3).value = m.cantidad
      ws.getCell(r, 4).value = m.unidad
      ws.getCell(r, 5).value = m.precio_costo || 0
      ws.getCell(r, 5).numFmt = '#,##0.00'
      ws.getCell(r, 6).value = m.precio_moneda
      ws.getCell(r, 7).value = m.subtotal
      ws.getCell(r, 7).numFmt = fmtPesos
      ws.getCell(r, 8).value = m.subtotal_usd
      if (m.subtotal_usd != null) ws.getCell(r, 8).numFmt = fmtUsd
      bordeFila(ws, r, 1, ULT_COL)
      r++
    }
    ws.getCell(r, 2).value = 'Total'
    ws.getCell(r, 7).value = d.costo_materiales
    ws.getCell(r, 7).numFmt = fmtPesos
    ws.getCell(r, 8).value = d.costo_materiales_usd
    if (d.costo_materiales_usd != null) ws.getCell(r, 8).numFmt = fmtUsd
    for (let c = 1; c <= ULT_COL; c++) {
      ws.getCell(r, c).font = { bold: true }
      ws.getCell(r, c).border = { top: { style: 'thin', color: { argb: 'FF333333' } } }
    }
    r++
  }

  ws.pageSetup.printArea = `A1:${String.fromCharCode(64 + ULT_COL)}${r}`

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename=analisis_${d.codigo}_${hoyArgentina()}.xlsx`)
  await wb.xlsx.write(res)
  res.end()
  } catch (e) {
    if (res.headersSent) { res.end(); return }
    res.status(500).json({ error: `Error al generar el Excel: ${e.message}` })
  }
})

module.exports = router
