'use strict'
const fs         = require('fs')
const path       = require('path')
const nodemailer = require('nodemailer')
const sharp      = require('sharp')
const { getConfig } = require('./config')
const { hoyArgentina } = require('./fecha')

const LOGO_PATH = path.join(__dirname, '../assets/logo-eintra.png')

// Mismos formatos que usa la pantalla (FinanzasDashboard.jsx: fmtM/fmtK/fmtF)
// — el reporte por mail tiene que leerse exactamente igual que "Estado Hoy".
const fmtM = (n, mon = 'PESO') => {
  const v = parseFloat(n) || 0
  const sym = mon === 'DÓLAR' ? 'USD ' : mon === 'EURO' ? '€ ' : '$ '
  return sym + v.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const fmtK = n => {
  const v = Math.abs(parseFloat(n) || 0)
  const cd = (num, dec) => num.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec })
  if (v >= 1e9) return cd(v / 1e9, 1) + 'B'
  if (v >= 1e6) return cd(v / 1e6, 1) + 'M'
  if (v >= 1e3) return cd(v / 1e3, 0) + 'K'
  return cd(v, 0)
}
const fmtF = s => {
  if (!s) return '—'
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const trunc = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s }

const NOMBRE_DIA = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado']
const NOMBRE_MES_LARGO = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre']

function fechaLarga(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return `${NOMBRE_DIA[dt.getUTCDay()]} ${d} de ${NOMBRE_MES_LARGO[m - 1]} de ${y}`
}

// ── Arma la imagen del reporte diario como SVG (sin navegador headless: solo
// texto y formas dibujadas a mano, igual criterio que GanttSVG.jsx del
// frontend) — se convierte a PNG al final con sharp. Refleja exactamente los
// mismos datos que la pestaña "Estado Hoy" de Finanzas (GET
// /finanzas/dashboard-diario), no un resumen de todo el histórico.
function generarSvgDashboard(data) {
  const { saldosBancarios, serviciosMes, comprasPendientes, ventasPendientes,
    facturasPorPagar, facturasPorCobrar, echeqsRecibidos, ivaData, tipoCambioBNA } = data
  const W = 900
  const M = 24
  let y = 0
  const partes = []

  // ── Header ──
  const HDR_H = 96
  let logoTag = ''
  try {
    const b64 = fs.readFileSync(LOGO_PATH).toString('base64')
    logoTag = `<image href="data:image/png;base64,${b64}" x="${M}" y="22" height="52" width="${52 * 338 / 120}" />`
  } catch (e) { /* sin logo, no es crítico */ }
  partes.push(`<rect x="0" y="0" width="${W}" height="${HDR_H}" fill="#f8f9fa"/>`)
  partes.push(logoTag)
  partes.push(`<text x="${W - M}" y="42" text-anchor="end" font-size="20" font-weight="700" fill="#212529" font-family="Arial, sans-serif">Dashboard de Finanzas — Estado Hoy</text>`)
  partes.push(`<text x="${W - M}" y="64" text-anchor="end" font-size="12" fill="#6c757d" font-family="Arial, sans-serif">${esc(fechaLarga(hoyArgentina()))}</text>`)
  partes.push(`<line x1="0" y1="${HDR_H}" x2="${W}" y2="${HDR_H}" stroke="#dee2e6" stroke-width="1"/>`)
  y = HDR_H + 20

  // ── KPI cards: bancos + TC BNA + por pagar/cobrar + servicios del mes ──
  // Mismas tarjetas que arriba de la pantalla "Estado Hoy", en una grilla que
  // se acomoda sola según cuántos bancos haya cargados.
  const cards = []
  if (saldosBancarios.length === 0) {
    cards.push({ label: 'Saldo bancario', value: '—', sub: 'Sin registros', color: '#6c757d' })
  } else {
    saldosBancarios.forEach(sb => {
      const echeq = sb.echeq_pendiente || 0
      const disponible = (sb.monto || 0) - echeq
      cards.push({
        label: sb.entidad.toUpperCase(),
        value: fmtM(echeq > 0 ? disponible : sb.monto, sb.moneda),
        sub: echeq > 0 ? `Saldo ${fmtM(sb.monto, sb.moneda)} · E-CHEQs −${fmtM(echeq, sb.moneda)}` : `Registrado ${fmtF((sb.created_at || '').slice(0, 10))}`,
        color: '#0d6efd',
      })
    })
  }
  if (tipoCambioBNA) {
    cards.push({
      label: 'TC BNA Dólar',
      value: `$ ${parseFloat(tipoCambioBNA.valor).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      sub: tipoCambioBNA.fecha || (tipoCambioBNA.created_at || '').slice(0, 10),
      color: '#198754',
    })
  }
  cards.push({
    label: 'Por pagar (Compras)',
    value: `$ ${fmtK(comprasPendientes.total_pesos)}`,
    sub: `${comprasPendientes.count} factura${comprasPendientes.count !== 1 ? 's' : ''} pendiente${comprasPendientes.count !== 1 ? 's' : ''}`,
    color: '#dc3545',
  })
  const echeqV = ventasPendientes.echeq_pendiente || 0
  const totalPorCobrar = (ventasPendientes.total_pesos || 0) + echeqV
  cards.push({
    label: 'Por cobrar (Ventas)',
    value: `$ ${fmtK(totalPorCobrar)}`,
    sub: echeqV > 0
      ? `Facturas ${fmtK(ventasPendientes.total_pesos)} · E-CHEQs s/acred. +${fmtK(echeqV)}`
      : `${ventasPendientes.count} factura${ventasPendientes.count !== 1 ? 's' : ''} pendiente${ventasPendientes.count !== 1 ? 's' : ''}`,
    color: '#198754',
  })
  if (serviciosMes) {
    const debeTotal = (serviciosMes.monto_pendiente || 0) + (serviciosMes.monto_pendiente_estimado || 0)
    cards.push({
      label: 'Servicios del mes',
      value: fmtM(debeTotal > 0 ? debeTotal : serviciosMes.monto_pagado),
      sub: debeTotal > 0 ? `Debe total (pagado ${fmtM(serviciosMes.monto_pagado)})` : `Pagado ${fmtM(serviciosMes.monto_pagado)}`,
      color: '#6f42c1',
    })
  }

  const POR_FILA = 4
  const kpiH = 88
  const kpiW = (W - M * 2 - 16 * (POR_FILA - 1)) / POR_FILA
  cards.forEach((k, i) => {
    const col = i % POR_FILA, fila = Math.floor(i / POR_FILA)
    const x = M + col * (kpiW + 16)
    const cy = y + fila * (kpiH + 14)
    partes.push(`<rect x="${x}" y="${cy}" width="${kpiW}" height="${kpiH}" rx="8" fill="#fff" stroke="#e9ecef" stroke-width="1"/>`)
    partes.push(`<rect x="${x}" y="${cy}" width="6" height="${kpiH}" rx="3" fill="${k.color}"/>`)
    partes.push(`<text x="${x + 16}" y="${cy + 22}" font-size="10.5" font-weight="600" fill="#6c757d" font-family="Arial, sans-serif">${esc(k.label.toUpperCase())}</text>`)
    partes.push(`<text x="${x + 16}" y="${cy + 46}" font-size="17" font-weight="700" fill="#212529" font-family="Arial, sans-serif">${esc(k.value)}</text>`)
    partes.push(`<text x="${x + 16}" y="${cy + 66}" font-size="9.5" fill="#adb5bd" font-family="Arial, sans-serif">${esc(trunc(k.sub, 44))}</text>`)
  })
  const filas = Math.ceil(cards.length / POR_FILA)
  y += filas * kpiH + (filas - 1) * 14 + 24

  // ── E-CHEQs recibidos pendientes de acreditación ──
  if (echeqsRecibidos && echeqsRecibidos.length > 0) {
    const n = Math.min(echeqsRecibidos.length, 5)
    const h = 34 + n * 22 + 10
    partes.push(`<rect x="${M}" y="${y}" width="${W - M * 2}" height="${h}" rx="8" fill="#fff" stroke="#e9ecef" stroke-width="1"/>`)
    partes.push(`<text x="${M + 18}" y="${y + 24}" font-size="13" font-weight="700" fill="#212529" font-family="Arial, sans-serif">E-CHEQs recibidos pendientes de acreditación (${echeqsRecibidos.length})</text>`)
    echeqsRecibidos.slice(0, n).forEach((e, i) => {
      const fy = y + 44 + i * 22
      partes.push(`<text x="${M + 18}" y="${fy}" font-size="11" fill="#212529" font-family="Arial, sans-serif">${esc(trunc(e.cliente_nombre, 30))}</text>`)
      partes.push(`<text x="${M + 300}" y="${fy}" font-size="11" fill="#6c757d" font-family="Arial, sans-serif">${esc(e.entidad || '—')}</text>`)
      partes.push(`<text x="${M + 420}" y="${fy}" font-size="11" fill="#6c757d" font-family="Arial, sans-serif">${esc(fmtF(e.fecha_acreditacion))}</text>`)
      partes.push(`<text x="${W - M - 18}" y="${fy}" text-anchor="end" font-size="11" font-weight="700" fill="#198754" font-family="Arial, sans-serif">+${esc(fmtM(e.importe, e.moneda))}</text>`)
    })
    y += h + 24
  }

  // ── Posición IVA mensual (mes en curso + 2 anteriores) ──
  if (ivaData && ivaData.length > 0) {
    const ivaH = 128
    partes.push(`<text x="${M}" y="${y + 14}" font-size="13" font-weight="700" fill="#212529" font-family="Arial, sans-serif">Posición IVA mensual</text>`)
    y += 24
    const n = ivaData.length
    const boxW = (W - M * 2 - 16 * (n - 1)) / n
    ivaData.forEach((mes, i) => {
      const posicion = (mes.iva_ventas || 0) - (mes.iva_compras || 0) - (mes.perc_iva_compras || 0)
      const esFavor = posicion <= 0
      const x = M + i * (boxW + 16)
      partes.push(`<rect x="${x}" y="${y}" width="${boxW}" height="${ivaH}" rx="8" fill="${i === 0 ? '#f8f5ff' : '#f8f9fa'}" stroke="${i === 0 ? '#d8c8f0' : '#e9ecef'}" stroke-width="1"/>`)
      partes.push(`<text x="${x + 14}" y="${y + 22}" font-size="11.5" font-weight="700" fill="${i === 0 ? '#6f42c1' : '#6c757d'}" font-family="Arial, sans-serif">${i === 0 ? '▶ ' : ''}${esc(mes.label)}</text>`)
      partes.push(`<text x="${x + 14}" y="${y + 44}" font-size="10.5" fill="#6c757d" font-family="Arial, sans-serif">Débito (ventas):</text>`)
      partes.push(`<text x="${x + boxW - 14}" y="${y + 44}" text-anchor="end" font-size="10.5" font-weight="700" fill="#198754" font-family="Arial, sans-serif">${esc(fmtM(mes.iva_ventas))}</text>`)
      partes.push(`<text x="${x + 14}" y="${y + 62}" font-size="10.5" fill="#6c757d" font-family="Arial, sans-serif">Crédito IVA (compras):</text>`)
      partes.push(`<text x="${x + boxW - 14}" y="${y + 62}" text-anchor="end" font-size="10.5" font-weight="700" fill="#dc3545" font-family="Arial, sans-serif">−${esc(fmtM(mes.iva_compras))}</text>`)
      let ly = y + 62
      if ((mes.perc_iva_compras || 0) !== 0) {
        ly += 18
        partes.push(`<text x="${x + 14}" y="${ly}" font-size="10.5" fill="#6c757d" font-family="Arial, sans-serif">Percepciones IVA:</text>`)
        partes.push(`<text x="${x + boxW - 14}" y="${ly}" text-anchor="end" font-size="10.5" font-weight="700" fill="#dc3545" font-family="Arial, sans-serif">−${esc(fmtM(mes.perc_iva_compras))}</text>`)
      }
      partes.push(`<line x1="${x + 14}" y1="${ly + 10}" x2="${x + boxW - 14}" y2="${ly + 10}" stroke="#dee2e6" stroke-width="1"/>`)
      partes.push(`<text x="${x + 14}" y="${ly + 30}" font-size="11" font-weight="700" fill="#212529" font-family="Arial, sans-serif">Posición:</text>`)
      partes.push(`<text x="${x + boxW - 14}" y="${ly + 30}" text-anchor="end" font-size="12" font-weight="700" fill="${esFavor ? '#198754' : '#fd7e14'}" font-family="Arial, sans-serif">${esFavor ? 'A favor ' : 'A pagar '}${esc(fmtM(Math.abs(posicion)))}</text>`)
    })
    y += ivaH + 24
  }

  // ── Facturas por pagar / por cobrar ──
  const colW = (W - M * 2 - 20) / 2
  const listH = 32 + 24 * 6 + 16
  function listaFacturas(x, titulo, filas, color) {
    partes.push(`<rect x="${x}" y="${y}" width="${colW}" height="${listH}" rx="8" fill="#fff" stroke="#e9ecef" stroke-width="1"/>`)
    partes.push(`<text x="${x + 18}" y="${y + 26}" font-size="13" font-weight="700" fill="#212529" font-family="Arial, sans-serif">${esc(titulo)} (${filas.length})</text>`)
    if (!filas.length) {
      partes.push(`<text x="${x + 18}" y="${y + 50}" font-size="12" fill="#adb5bd" font-family="Arial, sans-serif">Sin pendientes</text>`)
      return
    }
    filas.slice(0, 6).forEach((f, i) => {
      const fy = y + 48 + i * 24
      partes.push(`<text x="${x + 18}" y="${fy}" font-size="11" fill="#212529" font-family="Arial, sans-serif">${esc(trunc(f.nombre, 24))}</text>`)
      partes.push(`<text x="${x + 18}" y="${fy + 11}" font-size="9" fill="#adb5bd" font-family="Arial, sans-serif">${esc(f.fecha_vencimiento ? fmtF(f.fecha_vencimiento) : 'Sin vencimiento')}</text>`)
      partes.push(`<text x="${x + colW - 18}" y="${fy}" text-anchor="end" font-size="11" font-weight="700" fill="${color}" font-family="Arial, sans-serif">${esc(fmtM(f.saldo_pesos))}</text>`)
    })
  }
  listaFacturas(M, 'Facturas por pagar', facturasPorPagar || [], '#dc3545')
  listaFacturas(M + colW + 20, 'Facturas por cobrar', facturasPorCobrar || [], '#198754')
  y += listH + 24

  // ── Footer ──
  partes.push(`<text x="${M}" y="${y}" font-size="10" fill="#adb5bd" font-family="Arial, sans-serif">Generado automáticamente por el Sistema de Gestión E-INTRA — no responder este correo.</text>`)
  y += 16

  const H = y
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>${partes.join('')}</svg>`
}

async function generarPngDashboard(data) {
  const svg = generarSvgDashboard(data)
  return sharp(Buffer.from(svg)).png().toBuffer()
}

// ── Orquesta todo: calcula los datos, genera la imagen y la manda por mail.
// `forzar=true` (botón "Enviar ahora" de Configuración) salta el chequeo de
// "está activado" para poder probarlo antes de dejarlo prendido — el script
// de cron (scripts/enviar-dashboard-finanzas.js) es el que decide CUÁNDO
// correr esto según la hora configurada; esta función no sabe de horarios.
// `overrides` — mismo criterio que ya usa POST /test-email: el botón de
// prueba manda lo que hay tipeado en el formulario (aunque todavía no se
// haya guardado con "Guardar configuración"), así probar el email
// destinatario recién cargado no depende de guardar primero.
async function enviarReporteDashboardFinanzas({ forzar = false, overrides = {} } = {}) {
  const cfg = (clave, fallback) => {
    const v = overrides[clave]
    return (v !== undefined && v !== '' && v !== '***') ? v : getConfig(clave, fallback)
  }
  const activo = cfg('dashboard_finanzas_activo') === 'true'
  if (!forzar && !activo) return { enviado: false, motivo: 'El envío diario no está activado' }

  const email = cfg('dashboard_finanzas_email')
  if (!email) return { enviado: false, motivo: 'Falta configurar el email destinatario' }

  const host = cfg('smtp_host')
  const user = cfg('smtp_user')
  if (!host || !user) return { enviado: false, motivo: 'SMTP no configurado (host y usuario requeridos)' }

  const { obtenerDashboardDiario } = require('../routes/finanzas')
  const data = obtenerDashboardDiario()
  const png  = await generarPngDashboard(data)
  const fecha = hoyArgentina()

  const transport = nodemailer.createTransport({
    host,
    port:   parseInt(cfg('smtp_port', '587')),
    secure: cfg('smtp_secure', 'false') === 'true',
    auth:   { user, pass: cfg('smtp_pass') },
    // Ver el mismo comentario en helpers/mensajes.js — valida el certificado
    // TLS por default, salvo que se cargue 'smtp_tls_reject_unauthorized'='false'.
    tls:    { rejectUnauthorized: cfg('smtp_tls_reject_unauthorized', 'true') !== 'false' },
  })
  await transport.sendMail({
    from:    cfg('smtp_from') || user,
    to:      email,
    subject: `[E-INTRA ERP] Dashboard de Finanzas — ${fecha}`,
    html:    `<p>Reporte diario del Dashboard de Finanzas (Estado Hoy).</p><img src="cid:dashboard-finanzas" style="max-width:100%;border:1px solid #e9ecef;border-radius:8px" />`,
    attachments: [{
      filename: `dashboard-finanzas-${fecha}.png`,
      content:  png,
      cid:      'dashboard-finanzas',
    }],
  })
  return { enviado: true, mensaje: `Reporte enviado a ${email}` }
}

module.exports = { generarSvgDashboard, generarPngDashboard, enviarReporteDashboardFinanzas }
