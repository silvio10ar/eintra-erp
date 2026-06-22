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

// ── DELETE /pedidos/:id ───────────────────────────────────────────────────────
// Solo admin — marca un pedido como resuelto (lo elimina)
router.delete('/pedidos/:id', (req, res) => {
  if (req.usuario?.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' })
  const pedidos = leerPedidos().filter(p => p.id !== req.params.id)
  guardarPedidos(pedidos)
  res.json({ ok: true })
})


module.exports = router
