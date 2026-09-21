const express = require('express')
const router  = express.Router()
const path    = require('path')
const fs      = require('fs')
const { verificarToken } = require('../middleware/auth')

const CONFIG_PATH = path.resolve(__dirname, '../data/cod_config.json')

router.use(verificarToken)

// Sin gate de módulo, cualquier usuario autenticado podía ver el desglose de
// CUALQUIER código — bajo impacto (solo explica cómo se arma un código, no
// hay dato sensible), pero inconsistente con el resto del sistema. Materiales
// es el único llamador real, así que el permiso que habilita esto es el mismo
// que ya habilita Materiales (materiales.leer, o codificacion/compras por la
// jerarquía de módulos de middleware/auth.js).
const puedeVer = req => req.usuario?.rol === 'admin'
  || !!req.permisos?.materiales?.leer || !!req.permisos?.materiales?.escribir
  || !!req.permisos?.codificacion?.leer || !!req.permisos?.compras?.leer

// ── GET /desglose/:codigo ─────────────────────────────────────────────────────
// Devuelve el desglose posición por posición de un código de 10 dígitos.
// Único uso restante del esquema de codificación: Materiales lo llama para
// explicar qué significa cada tramo de un código ya asignado.
router.get('/desglose/:codigo', (req, res) => {
  if (!puedeVer(req)) return res.status(403).json({ error: 'Sin permisos de lectura' })
  const codigo = req.params.codigo.toUpperCase()
  if (!codigo || codigo.length !== 10) {
    return res.status(400).json({ error: 'El código debe tener 10 caracteres', posiciones: [] })
  }

  let config
  try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) }
  catch { return res.status(500).json({ error: 'No se pudo leer la configuración' }) }

  // Buscar familia (ZZ primero, luego 1 char)
  const tipo = config.tipos.find(t => codigo.slice(0, t.codigo_pos1.length) === t.codigo_pos1)

  const posiciones = []
  const decoded    = new Array(10).fill(false)

  if (tipo) {
    const plen = tipo.codigo_pos1.length
    posiciones.push({
      pos: plen > 1 ? `1-${plen}` : '1',
      pos_desde: 1, pos_hasta: plen,
      etiqueta:    'Familia',
      valor:        tipo.codigo_pos1,
      descripcion:  tipo.descripcion,
      estado:       'familia',
    })
    for (let i = 0; i < plen; i++) decoded[i] = true

    const respuestas = {}
    for (const paso of tipo.flujo) {
      // Condicional: soporta {valor:'X'} y {en:['X','Y',...]}
      if (paso.si) {
        const respVal = respuestas[paso.si.pregunta_id]
        const pasa = Array.isArray(paso.si.en)
          ? paso.si.en.includes(respVal)
          : respVal === paso.si.valor
        if (!pasa) continue
      }

      const pregunta = config.preguntas[paso.pregunta_id]
      if (!pregunta) continue

      const pd    = paso.pos_desde
      const ph    = paso.pos_hasta

      // Si estas posiciones ya fueron decodificadas por una rama anterior, saltear
      if (decoded.slice(pd - 1, ph).every(Boolean)) continue

      const valor = codigo.slice(pd - 1, ph)

      let descripcion = valor
      let estado      = 'libre'

      if (pregunta.tipo === 'opcion') {
        const op = (pregunta.opciones || []).find(o => o.codigo === valor)
        descripcion          = op ? op.descripcion : `(${valor})`
        estado               = op ? 'ok' : 'obs'
        respuestas[paso.pregunta_id] = valor
      }

      for (let i = pd - 1; i < ph; i++) decoded[i] = true
      posiciones.push({
        pos:         pd === ph ? String(pd) : `${pd}-${ph}`,
        pos_desde:   pd,
        pos_hasta:   ph,
        etiqueta:    pregunta.label || paso.pregunta_id,
        valor,
        descripcion,
        estado,
        tipo_campo:  pregunta.tipo,
      })
    }
  } else {
    posiciones.push({
      pos: '1', pos_desde: 1, pos_hasta: 1,
      etiqueta: 'Familia', valor: codigo[0],
      descripcion: 'Familia no reconocida', estado: 'error',
    })
    decoded[0] = true
  }

  // Posiciones restantes no cubiertas → campo libre
  let i = 0
  while (i < 10) {
    if (!decoded[i]) {
      let j = i
      while (j < 10 && !decoded[j]) j++
      posiciones.push({
        pos:        i + 1 === j ? String(i + 1) : `${i + 1}-${j}`,
        pos_desde:  i + 1, pos_hasta: j,
        etiqueta:   'Dimensión / referencia',
        valor:       codigo.slice(i, j),
        descripcion: '(campo libre)',
        estado:      'libre',
        tipo_campo:  'libre',
      })
      i = j
    } else { i++ }
  }

  posiciones.sort((a, b) => (a.pos_desde || 0) - (b.pos_desde || 0))

  res.json({
    codigo,
    familia: tipo?.descripcion || null,
    posiciones,
  })
})

module.exports = router
