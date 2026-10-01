'use strict'
const { db } = require('../db/database')

// Letra con la que termina el código interno de una OC de cliente, según su
// tipo — mismo esquema en todo el sistema: fijo por convención, no configurable.
const LETRA_TIPO_OC = { proyecto: 'C', repuesto: 'R', servicio: 'S' }

// Código interno de una OC de cliente nueva: código del cliente + nro de
// orden de OC de ESE cliente (cuenta todas sus OC juntas, sin importar el
// tipo) + letra según tipo (C/R/S). Compartido entre el alta manual en
// Finanzas → OC Clientes y el alta automática desde Venta de Repuestos
// (pedido sin OC elegida). Tiene que llamarse dentro de la misma transacción
// que el INSERT que usa el código, para que el conteo y la inserción sean
// atómicos (evita que dos OC del mismo cliente creadas a la vez se lleven el
// mismo número).
function generarCodigoOC(clienteId, tipo) {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id=?').get(clienteId)
  if (!cliente) { const e = new Error('Cliente no encontrado'); e.codigo = 'OC_CLIENTE_INVALIDO'; throw e }
  if (!cliente.codigo?.trim()) { const e = new Error('Este cliente no tiene código cargado — hace falta para generar el código de la OC'); e.codigo = 'OC_CLIENTE_SIN_CODIGO'; throw e }
  const letra = LETRA_TIPO_OC[tipo]
  if (!letra) { const e = new Error('Tipo de OC inválido'); e.codigo = 'OC_TIPO_INVALIDO'; throw e }
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM fin_oc_clientes WHERE cliente_id=?').get(cliente.id)
  const codigo = `${cliente.codigo.trim()}${String(n + 1).padStart(3, '0')}${letra}`
  return { cliente, codigo }
}

module.exports = { LETRA_TIPO_OC, generarCodigoOC }
