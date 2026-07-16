'use strict'
const express  = require('express')
const multer   = require('multer')
const { db }   = require('../db/database')
const { verificarToken } = require('../middleware/auth')

const router = express.Router()

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.mimetype)
    cb(null, ok)
  },
})

const PROMPT = `Extraé los datos de esta factura. Devolvé SOLO un JSON válido sin texto extra.
Formato:
{
  "numero_factura": "ej: 0001-00012345",
  "tipo_factura": "A", "B" o "C",
  "fecha": "YYYY-MM-DD",
  "emisor_nombre": "razón social del emisor",
  "emisor_cuit": "XX-XXXXXXXX-X",
  "receptor_nombre": "razón social del receptor",
  "receptor_cuit": "XX-XXXXXXXX-X",
  "moneda": "PESOS" | "DÓLAR" | "EURO",
  "condicion_pago": "condición de pago",
  "items": [
    { "descripcion": "...", "cantidad": número, "unidad": "UND.", "precio_unitario": número, "precio_final": número }
  ],
  "neto_gravado": número,
  "iva_21": número,
  "total": número,
  "observaciones": ""
}
Precios sin puntos de miles ni símbolos. Si un campo no está, usá null o "".`

// ── POST /facturas/procesar ────────────────────────────────────────────────────
router.post('/procesar', verificarToken, upload.single('factura'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Falta archivo (JPG, PNG, PDF hasta 15 MB)' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY no está configurada en el servidor. Agregala al .env' })

  let Anthropic
  try { Anthropic = require('@anthropic-ai/sdk') } catch {
    return res.status(500).json({ error: '@anthropic-ai/sdk no instalado. Corré npm install en el servidor.' })
  }

  try {
    const client  = new Anthropic({ apiKey })
    const base64  = req.file.buffer.toString('base64')
    const mime    = req.file.mimetype

    const contentItem = mime === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
      : { type: 'image',    source: { type: 'base64', media_type: mime, data: base64 } }

    const resp = await client.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages:   [{ role: 'user', content: [contentItem, { type: 'text', text: PROMPT }] }],
    })

    const text    = resp.content[0].text.trim()
    const jsonStr = text.startsWith('{') ? text : (text.match(/\{[\s\S]*\}/) || [])[0]
    if (!jsonStr) return res.status(422).json({ error: 'No se pudieron extraer datos de la factura' })

    res.json(JSON.parse(jsonStr))
  } catch (e) {
    console.error('FacturaIA error:', e.message)
    res.status(500).json({ error: e.message })
  }
})

// ── POST /facturas/buscar-oc ───────────────────────────────────────────────────
router.get('/buscar-oc', verificarToken, (req, res) => {
  const { numero } = req.query
  if (!numero?.trim()) return res.json(null)
  const oc = db.prepare(`SELECT id, numero, proveedor_nombre, estado, moneda, fecha FROM ordenes_compra WHERE LOWER(TRIM(numero))=LOWER(TRIM(?)) LIMIT 1`).get(numero.trim())
  res.json(oc || null)
})

// ── POST /facturas/guardar-compra ─────────────────────────────────────────────
router.post('/guardar-compra', verificarToken, (req, res) => {
  const {
    tipo_factura = 'A', numero, fecha = '', proveedor_nombre = '',
    proveedor_id, cuit = '', oc_id, oc_numero = '',
    importe = 0, neto_gravado = 0, iva_21 = 0,
    moneda = 'PESO', tasa_cambio = 1, condicion_pago = '', observaciones = '',
    crear_f49 = false, f49_items = [],
  } = req.body

  if (!numero?.trim()) return res.status(400).json({ error: 'Falta número de factura' })

  const r = db.prepare(`
    INSERT INTO facturas_compra
      (tipo_factura,numero,fecha,proveedor_id,proveedor_nombre,cuit,oc_id,oc_numero,
       neto_gravado,iva_21,importe,moneda,tasa_cambio,observaciones,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(tipo_factura, numero.trim(), fecha, proveedor_id || null, proveedor_nombre,
    cuit, oc_id || null, oc_numero,
    parseFloat(neto_gravado) || 0, parseFloat(iva_21) || 0, parseFloat(importe) || 0,
    moneda, parseFloat(tasa_cambio) || 1, observaciones, req.usuario.id)

  // Actualizar OC vinculada
  if (oc_id) {
    db.prepare(`UPDATE ordenes_compra SET nro_factura=?, importe_facturado=?, estado=
      CASE WHEN estado='Emitida' THEN 'Recibida' ELSE estado END WHERE id=?`)
      .run(numero.trim(), parseFloat(importe) || 0, oc_id)
  }

  // Crear Form49 si no hay OC
  let f49_numero = null
  if (crear_f49 && f49_items.length) {
    const lastF49 = db.prepare('SELECT numero FROM form49_ingresos ORDER BY id DESC LIMIT 1').get()
    let nextN = 1
    if (lastF49) { try { nextN = parseInt(lastF49.numero.replace('F49-', '')) + 1 } catch (_) {} }
    f49_numero = `F49-${String(nextN).padStart(6, '0')}`

    const fRow = db.prepare(`
      INSERT INTO form49_ingresos
        (numero,fecha,proveedor_id,proveedor_nombre,proveedor_cuit,condicion_pago,
         moneda,tasa_cambio,observaciones,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(f49_numero, fecha, proveedor_id || null, proveedor_nombre, cuit,
      condicion_pago, moneda, parseFloat(tasa_cambio) || 1,
      `Generado desde factura ${numero.trim()}`, req.usuario.id)

    const fid = fRow.lastInsertRowid
    const ins = db.prepare(`
      INSERT INTO form49_items
        (form49_id,descripcion,cantidad,unidad,precio_unitario,precio_final,plazo,destino,producto_id,producto_codigo)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `)
    for (const it of f49_items) {
      ins.run(fid, it.descripcion || '', parseFloat(it.cantidad) || 0, it.unidad || 'UND.',
        parseFloat(it.precio_unitario) || 0, parseFloat(it.precio_final) || 0,
        'INMEDIATO', it.destino || 'stock', it.producto_id || null, it.producto_codigo || '')
    }
  }

  res.status(201).json({ id: r.lastInsertRowid, f49_numero })
})

// ── POST /facturas/guardar-venta ──────────────────────────────────────────────
router.post('/guardar-venta', verificarToken, (req, res) => {
  const {
    tipo_factura = 'A', numero, fecha = '', cliente_nombre = '', cliente_id,
    oc = '', importe = 0, moneda = 'PESO', tasa_cambio = 1, observaciones = '',
  } = req.body

  if (!numero?.trim()) return res.status(400).json({ error: 'Falta número de factura' })

  const r = db.prepare(`
    INSERT INTO facturas_venta
      (tipo_factura,numero,fecha,cliente_id,cliente_nombre,oc,importe,moneda,tasa_cambio,observaciones,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(tipo_factura, numero.trim(), fecha, cliente_id || null, cliente_nombre,
    oc, parseFloat(importe) || 0, moneda, parseFloat(tasa_cambio) || 1,
    observaciones, req.usuario.id)

  res.status(201).json({ id: r.lastInsertRowid })
})

module.exports = router
