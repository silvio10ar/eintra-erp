const express = require('express')
const router  = express.Router()
const path    = require('path')
const fs      = require('fs')
const { verificarToken } = require('../middleware/auth')

const CONFIG_PATH   = path.resolve(__dirname, '../data/cod_config.json')
const PEDIDOS_PATH  = path.resolve(__dirname, '../data/cod_pedidos.json')

const leerPedidos  = () => { try { return JSON.parse(fs.readFileSync(PEDIDOS_PATH, 'utf8')) } catch { return [] } }
const guardarPedidos = p => fs.writeFileSync(PEDIDOS_PATH, JSON.stringify(p, null, 2), 'utf8')

router.use(verificarToken)

const puede = (req, accion = 'leer') => {
  const p = req.permisos?.codificacion
  if (!p) return false
  if (accion === 'leer')     return !!(p.leer || p.escribir)
  if (accion === 'escribir') return !!p.escribir
  return false
}

// ── GET /config ──────────────────────────────────────────────────────────────────
router.get('/config', (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' })
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
    res.json(JSON.parse(raw))
  } catch (e) {
    res.status(500).json({ error: 'No se pudo leer la configuración' })
  }
})

// ── PUT /config ──────────────────────────────────────────────────────────────────
router.put('/config', (req, res) => {
  if (!puede(req, 'escribir')) return res.status(403).json({ error: 'Sin permisos' })
  const config = req.body
  if (!config?.tipos || !config?.preguntas) {
    return res.status(400).json({ error: 'Configuración inválida' })
  }
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: 'No se pudo guardar la configuración' })
  }
})

// ── GET /pedidos ─────────────────────────────────────────────────────────────
// Solo admin — lista pedidos de opciones faltantes
router.get('/pedidos', (req, res) => {
  if (req.usuario?.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' })
  res.json(leerPedidos())
})

// ── POST /pedido ──────────────────────────────────────────────────────────────
// Cualquier usuario — reporta que le falta una opción en un paso del asistente
router.post('/pedido', (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { familia_codigo, familia_desc, pregunta_id, pregunta_label, descripcion } = req.body
  if (!familia_codigo || !pregunta_id || !descripcion?.trim()) {
    return res.status(400).json({ error: 'Datos incompletos' })
  }
  const pedidos = leerPedidos()
  const nuevo = {
    id:             Date.now().toString(),
    familia_codigo,
    familia_desc:   familia_desc || '',
    pregunta_id,
    pregunta_label: pregunta_label || '',
    descripcion:    descripcion.trim(),
    usuario:        req.usuario?.nombre || req.usuario?.username || '?',
    fecha:          new Date().toISOString(),
  }
  pedidos.push(nuevo)
  guardarPedidos(pedidos)
  res.status(201).json({ ok: true })
})

// ── GET /desglose/:codigo ─────────────────────────────────────────────────────
// Devuelve el desglose posición por posición de un código de 10 dígitos
router.get('/desglose/:codigo', (req, res) => {
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

// ── DELETE /pedidos/:id ───────────────────────────────────────────────────────
// Solo admin — marca un pedido como resuelto (lo elimina)
router.delete('/pedidos/:id', (req, res) => {
  if (req.usuario?.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' })
  const pedidos = leerPedidos().filter(p => p.id !== req.params.id)
  guardarPedidos(pedidos)
  res.json({ ok: true })
})


module.exports = router
