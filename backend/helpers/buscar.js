'use strict'

/**
 * Genera condición SQL multi-palabra independiente del orden, mayúsculas y parcial.
 * Cada token debe aparecer (como subcadena) en alguna de las columnas.
 * Usa lower() en columnas y parámetros para case-insensitivity real en SQLite.
 * @param {string}   termino - texto de búsqueda
 * @param {string[]} cols    - columnas SQL, ej: ['p.codigo', 'p.descripcion']
 * @returns {{ cond: string, params: any[] }}
 */
function buscarCondicion(termino, cols) {
  const palabras = String(termino).trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!palabras.length) return { cond: '1=1', params: [] }
  const params = []
  const cond = palabras.map(pal => {
    cols.forEach(() => params.push(`%${pal}%`))
    return `(${cols.map(c => `lower(ifnull(${c},'')) LIKE ?`).join(' OR ')})`
  }).join(' AND ')
  return { cond, params }
}

module.exports = { buscarCondicion }
