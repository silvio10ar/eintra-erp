const express = require('express')
const router  = express.Router()
const path    = require('path')
const fs      = require('fs')
const { verificarToken } = require('../middleware/auth')

const CONFIG_PATH = path.resolve(__dirname, '../data/cod_config.json')

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

module.exports = router
