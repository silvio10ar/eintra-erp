'use strict'
// Script de una sola vez: recalcula pago_confirmado de facturas_compra y
// facturas_venta usando la misma lógica ya en producción (recalcPagoFC/FV en
// routes/finanzas.js), que ahora también resta las Notas de Crédito vinculadas.
// Antes de este fix, una factura saldada por pago parcial + NC combinados se
// quedaba trabada mostrando saldo pendiente aunque no restara cobrar/pagar
// nada — este script corrige de una vez las filas que ya estaban en ese estado.
// Correr una sola vez tras el deploy: node scripts/recalc-pago-nc.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') })
const { db, inicializar } = require('../db/database')
const { recalcPagoFC, recalcPagoFV } = require('../routes/finanzas')

inicializar()

const idsCompra = db.prepare(`
  SELECT DISTINCT factura_id AS id FROM pagos_factura_compra
  UNION
  SELECT DISTINCT nc_factura_id AS id FROM facturas_compra WHERE nc_factura_id IS NOT NULL
`).all().map(r => r.id)

const idsVenta = db.prepare(`
  SELECT DISTINCT factura_id AS id FROM pagos_factura_venta
  UNION
  SELECT DISTINCT nc_factura_id AS id FROM facturas_venta WHERE nc_factura_id IS NOT NULL
`).all().map(r => r.id)

let cambiosC = 0
for (const id of idsCompra) {
  const antes = db.prepare('SELECT numero, pago_confirmado FROM facturas_compra WHERE id=?').get(id)
  if (!antes) continue
  recalcPagoFC(id)
  const despues = db.prepare('SELECT pago_confirmado FROM facturas_compra WHERE id=?').get(id)
  if (antes.pago_confirmado !== despues.pago_confirmado) {
    cambiosC++
    console.log(`facturas_compra #${id} (${antes.numero}): pago_confirmado ${antes.pago_confirmado} -> ${despues.pago_confirmado}`)
  }
}

let cambiosV = 0
for (const id of idsVenta) {
  const antes = db.prepare('SELECT numero, pago_confirmado FROM facturas_venta WHERE id=?').get(id)
  if (!antes) continue
  recalcPagoFV(id)
  const despues = db.prepare('SELECT pago_confirmado FROM facturas_venta WHERE id=?').get(id)
  if (antes.pago_confirmado !== despues.pago_confirmado) {
    cambiosV++
    console.log(`facturas_venta #${id} (${antes.numero}): pago_confirmado ${antes.pago_confirmado} -> ${despues.pago_confirmado}`)
  }
}

console.log(`\nListo. Revisadas ${idsCompra.length} facturas de compra (${cambiosC} corregidas) y ${idsVenta.length} facturas de venta (${cambiosV} corregidas).`)
