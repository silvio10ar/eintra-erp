'use strict'

/**
 * Genera condición SQL multi-palabra independiente del orden.
 * Cada token del término debe aparecer en alguna de las columnas.
 * @param {string}   termino - texto de búsqueda del usuario
 * @param {string[]} cols    - columnas SQL, ej: ['p.codigo', 'p.descripcion']
 * @returns {{ cond: string, params: any[] }}
 */
function buscarCondicion(termino, cols) {
  const palabras = String(termino).trim().split(/\s+/).filter(Boolean)
  if (!palabras.length) return { cond: '1=1', params: [] }
  const params = []
  const cond = palabras.map(pal => {
    cols.forEach(() => params.push(`%${pal}%`))
    return `(${cols.map(c => `${c} LIKE ?`).join(' OR ')})`
  }).join(' AND ')
  return { cond, params }
}

module.exports = { buscarCondicion }
