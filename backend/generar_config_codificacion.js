// Script one-shot: genera backend/data/cod_config.json desde reglas_codificacion.json
// Uso: node backend/generar_config_codificacion.js
const path = require('path')
const fs   = require('fs')

const reglas = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/reglas_codificacion.json'), 'utf8'))

function parsePosicion(label) {
  const l = label.toLowerCase().replace(/\n/g, ' ')
    .replace(/á/g,'a').replace(/é/g,'e').replace(/í/g,'i').replace(/ó/g,'o').replace(/ú/g,'u')
    .replace(/ñ/g,'n')
  if (l.includes('primer y segundo'))                           return [1, 2]
  if (l.includes('primer'))                                     return [1, 1]
  if (l.includes('segundo y tercer') || l.includes('segundo y tecer')) return [2, 3]
  if (l.includes('tercer, cuarto y quinto'))                    return [3, 5]
  if (l.includes('tercer a quinto'))                            return [3, 5]
  if (l.includes('segundo digito'))                             return [2, 2]
  if (l.includes('tercer digito'))                              return [3, 3]
  if (l.includes('cuarto y quinto'))                            return [4, 5]
  if (l.includes('cuarto a sexto'))                             return [4, 6]
  if (l.includes('cuarto digito'))                              return [4, 4]
  if (l.includes('niples  quinto a septimo') || l.includes('quinto a septimo')) return [5, 7]
  if (l.includes('quinto a octavo'))                            return [5, 8]
  if (l.includes('quinto digito'))                              return [5, 5]
  if (l.includes('sexto y septimo'))                            return [6, 7]
  if (l.includes('sexto a decimo'))                             return [6, 10]
  if (l.includes('sexto digito'))                               return [6, 6]
  if (l.includes('septimo al decimo') || l.includes('septimo a decimo')) return [7, 10]
  if (l.includes('septimo y octavo'))                           return [7, 8]
  if (l.includes('septimo digito'))                             return [7, 7]
  if (l.includes('octavo, noveno y decimo') || l.includes('niples  octavo a decimo') || l.includes('octavo a decimo')) return [8, 10]
  if (l.includes('octavo digito'))                              return [8, 8]
  if (l.includes('noveno y decimo'))                            return [9, 10]
  if (l.includes('noveno digito'))                              return [9, 9]
  if (l.includes('decimo'))                                     return [10, 10]
  return [null, null]
}

function slugify(str) {
  return str.toLowerCase()
    .replace(/á/g,'a').replace(/é/g,'e').replace(/í/g,'i').replace(/ó/g,'o').replace(/ú/g,'u').replace(/ñ/g,'n')
    .replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').substring(0, 25)
}

function cleanLabel(posicion) {
  // Eliminar prefijos largos de tipo nombre-de-componente antes del dash
  // "SEXTO DIGITO\nCONTACTOR\nCONTACTO AUXILIAR" → lines → tomar la más descriptiva
  const lines = posicion.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length === 1) return lines[0]
  // Última línea suele ser la más descriptiva (el concepto real)
  return lines[lines.length - 1] + ` (pos. ${posicion.split('\n')[0].trim().toLowerCase()})`
}

const config = { version: 1, tipos: [], preguntas: {} }

for (const [hojaKey, grupos] of Object.entries(reglas)) {
  if (hojaKey === 'EXPLICACION GRAL') continue

  const dashIdx = hojaKey.indexOf('-')
  const codigoPos1  = dashIdx > 0 ? hojaKey.substring(0, dashIdx).trim() : hojaKey
  const descripcion = dashIdx > 0 ? hojaKey.substring(dashIdx + 1).trim() : hojaKey
  const tipoBase    = slugify(descripcion)

  const covered = new Set([1])
  if (codigoPos1 === 'ZZ') covered.add(2)

  const flujo = []

  for (const grupo of grupos) {
    const rawLabel    = grupo.posicion
    const labelClean  = cleanLabel(rawLabel)
    const [pd, ph]    = parsePosicion(rawLabel)

    if (!pd) continue
    if (pd === 1 && ph <= 2) continue // posición 1 = familia, siempre auto

    for (let p = pd; p <= ph; p++) covered.add(p)

    const pregId  = `${tipoBase}_p${pd}_${ph}`
    const opciones = grupo.valores
      .filter(v => v.codigo !== '')
      .map(v => ({ codigo: v.codigo, descripcion: v.descripcion || '' }))

    if (!config.preguntas[pregId]) {
      config.preguntas[pregId] = { label: labelClean, tipo: 'opcion', opciones }
    }

    flujo.push({ pregunta_id: pregId, pos_desde: pd, pos_hasta: ph })
  }

  // Agregar libre para posiciones no cubiertas (ej. medidas 6-10)
  const start2 = codigoPos1 === 'ZZ' ? 3 : 2
  let i = start2
  while (i <= 10) {
    if (!covered.has(i)) {
      const from = i
      while (i <= 10 && !covered.has(i)) i++
      const to      = i - 1
      const len     = to - from + 1
      const pregId  = `${tipoBase}_libre_${from}_${to}`
      if (!config.preguntas[pregId]) {
        config.preguntas[pregId] = {
          label: `Medida / código libre (${len} carácter${len > 1 ? 'es' : ''})`,
          tipo:  'libre',
          longitud: len
        }
      }
      flujo.push({ pregunta_id: pregId, pos_desde: from, pos_hasta: to })
    } else { i++ }
  }

  flujo.sort((a, b) => a.pos_desde - b.pos_desde)

  config.tipos.push({ id: tipoBase, descripcion, codigo_pos1: codigoPos1, flujo })
}

const outPath = path.join(__dirname, 'data/cod_config.json')
fs.writeFileSync(outPath, JSON.stringify(config, null, 2), 'utf8')
console.log(`Generado: ${config.tipos.length} tipos, ${Object.keys(config.preguntas).length} preguntas → ${outPath}`)
