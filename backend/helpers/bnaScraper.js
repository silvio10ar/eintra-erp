'use strict'

// Trae la cotización del Banco Nación directo de su página pública (no hay
// una API oficial) — se usa la tabla "Billetes" (efectivo), columna Venta.
// FRÁGIL A PROPÓSITO: si el BNA cambia el HTML de esta página, esto deja de
// funcionar y hay que ajustar el parseo — decisión consciente por pedir el
// valor exacto del BNA en vez de un promedio de una API de terceros.
const URL_BNA = 'https://www.bna.com.ar/Personas'

function extraerVenta(html, nombre) {
  const re = new RegExp(`<td class="tit">${nombre}[^<]*</td>\\s*<td>[\\d.,]+</td>\\s*<td>([\\d.,]+)</td>`)
  const m = html.match(re)
  return m ? parseFloat(m[1].replace(',', '.')) : null
}

async function traerCotizacionBNA() {
  const res = await fetch(URL_BNA, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`El BNA respondió ${res.status}`)
  const html = await res.text()

  const bloque = html.match(/id="billetes"[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/)
  if (!bloque) throw new Error('No se encontró la tabla de Billetes en la página del BNA — puede haber cambiado de formato')

  const dolar = extraerVenta(bloque[1], 'Dolar U\\.S\\.A')
  const euro = extraerVenta(bloque[1], 'Euro')
  if (!dolar || !euro) throw new Error('No se pudo leer el valor de dólar/euro en la página del BNA')
  return { dolar, euro }
}

module.exports = { traerCotizacionBNA }
