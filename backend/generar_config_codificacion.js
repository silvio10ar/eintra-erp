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

function normalize(str) {
  return str.toUpperCase().trim()
    .replace(/Á/g,'A').replace(/É/g,'E').replace(/Í/g,'I').replace(/Ó/g,'O').replace(/Ú/g,'U').replace(/Ñ/g,'N')
    .replace(/\s+/g,' ')
}

// Parsea el campo posicion multilinea → { posLabel, subtipo, label }
// Formato: "SEXTO DIGITO\nCONTACTOR\nCONTACTO AUXILIAR" → subtipo=CONTACTOR, label=CONTACTO AUXILIAR
// Formato: "SEGUNDO Y TERCER DIGITO\nTIPO DE MATERIAL"  → subtipo=null, label=TIPO DE MATERIAL
function parsePosicionFull(rawPosicion) {
  const lines = rawPosicion.split('\n').map(l => l.trim()).filter(Boolean)
  if (lines.length >= 3) {
    return {
      posLabel:   lines[0],
      subtipo:    lines[1],
      label:      lines.slice(2).join(' ')
    }
  }
  return {
    posLabel:   lines[0],
    subtipo:    null,
    label:      lines[lines.length - 1] || lines[0]
  }
}

// Construye mapa normalizado: descripción del valor → codigo  para los valores de pos 2-3
function buildSubtipoMap(pos23Grupo) {
  if (!pos23Grupo) return {}
  const map = {}
  for (const v of pos23Grupo.valores) {
    if (!v.codigo || !v.descripcion) continue
    const key = normalize(v.descripcion)
    if (key) map[key] = v.codigo
  }
  return map
}

// Busca TODOS los códigos del subtipo — maneja enumeraciones y abreviaciones
function buscarCodigosSubtipo(subtipo, subtipoMap) {
  if (!subtipo) return null

  const normFull = normalize(subtipo).replace(/\.$/, '')

  // Caso enumeración: "TERMICA, DISYUNTOR Y LLAVE TERMOMAGNETICA" → partes individuales
  const parts = normFull.split(/\s*,\s*|\s+Y\s+/).map(p => p.trim()).filter(p => p.length >= 2)
  const terminos = parts.length > 1 ? parts : [normFull]

  const allCodes = new Set()

  for (const term of terminos) {
    for (const [desc, codigo] of Object.entries(subtipoMap)) {
      const normDesc = desc.replace(/\.$/, '')

      // Coincidencia exacta
      if (normDesc === term) { allCodes.add(codigo); continue }

      // Contiene (uno al otro)
      if (normDesc.includes(term) || term.includes(normDesc)) { allCodes.add(codigo); continue }

      // Palabras >= 2 chars, prefijo solo si ambas >= 4 (evita "CON" matchando "CONTACTOR")
      const termWords = term.split(/[\s/,]+/).map(w => w.replace(/[^A-Z0-9]/g, '')).filter(w => w.length >= 2)
      const descWords = normDesc.split(/\s+/).map(w => w.replace(/[^A-Z0-9]/g, '')).filter(w => w.length >= 2)

      if (!termWords.length || !descWords.length) continue

      const overlap = termWords.filter(tw =>
        descWords.some(dw => {
          if (dw === tw) return true
          if (tw.length >= 4 && dw.length >= 4) return dw.startsWith(tw) || tw.startsWith(dw)
          return false
        })
      ).length

      // Todas las palabras del término deben coincidir
      if (overlap >= termWords.length) allCodes.add(codigo)
    }
  }

  return allCodes.size > 0 ? [...allCodes] : null
}

const config = { version: 1, tipos: [], preguntas: {} }

for (const [hojaKey, grupos] of Object.entries(reglas)) {
  if (hojaKey === 'EXPLICACION GRAL') continue

  const dashIdx = hojaKey.indexOf('-')
  const codigoPos1  = dashIdx > 0 ? hojaKey.substring(0, dashIdx).trim() : hojaKey
  const descripcion = dashIdx > 0 ? hojaKey.substring(dashIdx + 1).trim() : hojaKey
  const tipoBase    = slugify(descripcion)

  // Mapa subtipo → codigo (basado en los valores de pos 2-3)
  const pos23Grupo   = grupos.find(g => parsePosicion(g.posicion.split('\n')[0])[0] === 2)
  const pos23PregId  = pos23Grupo ? `${tipoBase}_p2_3` : null
  const subtipoMap   = buildSubtipoMap(pos23Grupo)
  const tieneSubtipos = Object.keys(subtipoMap).length > 0

  const covered = new Set([1])
  if (codigoPos1 === 'ZZ') covered.add(2)

  const flujo = []

  for (const grupo of grupos) {
    const { posLabel, subtipo, label } = parsePosicionFull(grupo.posicion)
    const [pd, ph] = parsePosicion(posLabel)

    if (!pd) continue
    if (pd === 1 && ph <= 2) continue // posición 1 = familia, siempre auto

    for (let p = pd; p <= ph; p++) covered.add(p)

    // ID único: si hay subtipo, lo incluimos para que cada subtipo tenga su propia pregunta
    const subtipoSlug = subtipo ? slugify(subtipo) : null
    const pregId = subtipoSlug
      ? `${tipoBase}_p${pd}_${ph}_${subtipoSlug}`
      : `${tipoBase}_p${pd}_${ph}`

    const opciones = grupo.valores
      .filter(v => v.codigo !== '')
      .map(v => ({ codigo: v.codigo, descripcion: v.descripcion || '' }))

    if (!config.preguntas[pregId]) {
      const labelFinal = subtipo
        ? `${label} (${subtipo.toLowerCase()})`
        : label
      config.preguntas[pregId] = { label: labelFinal, tipo: 'opcion', opciones }
    }

    // Condición si: si el grupo tiene subtipo y tenemos la pregunta de pos 2-3
    let siCondition = null
    if (subtipo && tieneSubtipos && pos23PregId && pd > 3) {
      const codigos = buscarCodigosSubtipo(subtipo, subtipoMap)
      if (codigos) {
        siCondition = { pregunta_id: pos23PregId, en: codigos }
      } else {
        console.warn(`  [WARN] ${hojaKey}: subtipo "${subtipo}" (pos ${pd}-${ph}) sin código en pos2-3`)
      }
    }

    const step = { pregunta_id: pregId, pos_desde: pd, pos_hasta: ph }
    if (siCondition) step.si = siCondition
    flujo.push(step)
  }

  // Agregar libre para posiciones no cubiertas
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

  // Deduplicar: mismo pregunta_id nunca debe aparecer dos veces en el flujo
  const seen = new Set()
  const flujoDedup = flujo.filter(p => {
    if (seen.has(p.pregunta_id)) return false
    seen.add(p.pregunta_id)
    return true
  })

  config.tipos.push({ id: tipoBase, descripcion, codigo_pos1: codigoPos1, flujo: flujoDedup })
}

const outPath = path.join(__dirname, 'data/cod_config.json')
fs.writeFileSync(outPath, JSON.stringify(config, null, 2), 'utf8')
console.log(`Generado: ${config.tipos.length} tipos, ${Object.keys(config.preguntas).length} preguntas → ${outPath}`)
