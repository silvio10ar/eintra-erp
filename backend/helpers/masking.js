'use strict'

// Enmascarado genérico de montos reales para puestos marcados con
// `puestos.oculta_montos=1` (ej. Auditoría de Calidad) — se aplica a
// CUALQUIER respuesta JSON (ver el middleware en server.js), no hay que
// acordarse de tocar cada endpoint nuevo. El número real nunca sale del
// servidor para ese usuario.

// Montos de una factura que no comparten ninguna raíz de palabra con nada
// más (iva_21, otros_imp, perc_iva...) — no hay forma de matchearlos por
// patrón, es una lista a mano. Ya existía este inventario en finanzas.js
// para otro fin (validar que no haya importes negativos); se centraliza acá
// para que las dos cosas usen la misma lista y no se desincronicen.
const CAMPOS_MONTO_FACTURA_COMPRA = ['neto_gravado', 'no_grav_exento', 'iva_21', 'iva_10_5', 'iva_27', 'otros_imp', 'perc_iva', 'perc_iibb']
const CAMPOS_MONTO_FACTURA_VENTA  = ['neto_gravado', 'iva_21', 'iva_10_5', 'total_cobrado']

// Otras claves que son un monto real pero no matchean ninguna raíz de
// palabra (alias de JOIN, o un total que no se llama "monto_algo").
const CAMPOS_MONTO_EXACTOS = new Set([
  ...CAMPOS_MONTO_FACTURA_COMPRA, ...CAMPOS_MONTO_FACTURA_VENTA,
  'total_usd', 'factura_neto', 'factura_importe',
  // Retenciones y ajustes de una factura/pago (finanzas.js) — ninguno
  // comparte raíz con nada más (ret_iibb, dif_cambio...).
  'ret_iibb', 'ret_iva', 'ret_gcia', 'ret_contratista', 'ret_ss', 'dif_cambio',
  // Anticipo de una factura (monto real, no confundir con anticipo_pct/
  // fecha_anticipo, que son otras claves y no matchean acá).
  'anticipo', 'con_anticipo',
  // KPIs de Finanzas/Dashboard que agregan montos bajo un nombre que no
  // comparte raíz (ingresos_mes, egresos_mes) o son un total/saldo
  // parcial sin la palabra "monto/saldo/costo" (total_pagado, total_nc,
  // echeq_pendiente).
  'ingresos_mes', 'egresos_mes', 'total_pagado', 'total_nc', 'echeq_pendiente',
  // Precio de venta calculado en Costeo de Equipos (costo × margen).
  'venta_material', 'venta_mano_obra', 'venta_total',
  // Posición IVA mensual del Dashboard de Finanzas (finanzas.js, /dashboard-diario).
  'iva_compras', 'perc_iva_compras', 'iva_ventas',
])

// Claves que matchean una raíz de monto pero NO son un importe (código de
// moneda, fecha, o una referencia/FK de "presupuesto" que no es el monto del
// presupuesto en sí) — las únicas excepciones reales encontradas.
const CAMPOS_NO_MONTO_EXACTOS = new Set([
  'precio_moneda', 'precio_fecha', 'factura_moneda',
  'presupuesto_id', 'presupuesto_n', 'presupuesto_ref',
])

// Raíces de palabra (la clave partida por "_") que indican un monto real.
// Por raíz de palabra, no por "empieza con" — eso falla en casos reales
// como `factura_importe` o `substock_saldo`, donde la raíz no es el primer token.
const RAICES_MONTO = new Set(['precio', 'monto', 'costo', 'importe', 'saldo', 'neto', 'subtotal', 'presupuesto', 'ganado', 'perdido', 'presupuestado', 'pesos'])

const SENTINEL = '••••••'

function esClaveDeMonto(key) {
  if (CAMPOS_NO_MONTO_EXACTOS.has(key)) return false
  if (CAMPOS_MONTO_EXACTOS.has(key)) return true
  return key.toLowerCase().split('_').some(t => RAICES_MONTO.has(t))
}

function esValorNumerico(v) {
  if (typeof v === 'number') return true
  if (typeof v === 'string' && v.trim() !== '') return !isNaN(parseFloat(v))
  return false
}

function enmascarar(valor) {
  if (Array.isArray(valor)) return valor.map(enmascarar)
  if (valor && typeof valor === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(valor)) {
      if (esClaveDeMonto(k) && esValorNumerico(v)) {
        out[k] = SENTINEL
      } else if (v && typeof v === 'object') {
        out[k] = enmascarar(v)
      } else {
        out[k] = v
      }
    }
    return out
  }
  return valor
}

// Requerido acá adentro (no arriba del archivo) para no crear una
// dependencia circular con db/database.js, mismo criterio que ya usa
// helpers/organigrama.js.
function usuarioOcultaMontos(usuarioId) {
  if (!usuarioId) return false
  const { db } = require('../db/database')
  const row = db.prepare(`
    SELECT 1 FROM usuario_puestos up JOIN puestos p ON p.id = up.puesto_id
    WHERE up.usuario_id = ? AND p.oculta_montos = 1 LIMIT 1
  `).get(usuarioId)
  return !!row
}

module.exports = {
  enmascarar, usuarioOcultaMontos, SENTINEL,
  CAMPOS_MONTO_FACTURA_COMPRA, CAMPOS_MONTO_FACTURA_VENTA,
}
