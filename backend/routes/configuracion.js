'use strict'
const express    = require('express')
const { db }     = require('../db/database')
const { verificarToken } = require('../middleware/auth')
const nodemailer = require('nodemailer')

const router = express.Router()
router.use(verificarToken)

const esAdmin = req => req.usuario?.rol === 'admin'
const CLAVES  = ['smtp_host','smtp_port','smtp_user','smtp_pass','smtp_from','smtp_secure','backup_to']

const get = clave => {
  const row = db.prepare('SELECT valor FROM configuracion WHERE clave=?').get(clave)
  return row?.valor || process.env[clave.toUpperCase()] || ''
}

// GET / — todas las claves (contraseña enmascarada)
router.get('/', (req, res) => {
  if (!esAdmin(req)) return res.status(403).json({ error: 'Sin permisos' })
  const cfg = Object.fromEntries(CLAVES.map(k => [k, '']))
  const rows = db.prepare(`SELECT clave, valor FROM configuracion WHERE clave IN (${CLAVES.map(() => '?').join(',')})`).all(...CLAVES)
  for (const r of rows) cfg[r.clave] = (r.clave === 'smtp_pass' && r.valor) ? '***' : r.valor
  res.json(cfg)
})

// PUT / — actualizar (ignora smtp_pass si vale '***')
router.put('/', (req, res) => {
  if (!esAdmin(req)) return res.status(403).json({ error: 'Sin permisos' })
  const upsert = db.prepare(`
    INSERT INTO configuracion (clave, valor, updated_at) VALUES (?, ?, datetime('now','localtime'))
    ON CONFLICT(clave) DO UPDATE SET valor=excluded.valor, updated_at=excluded.updated_at
  `)
  db.transaction(() => {
    for (const clave of CLAVES) {
      if (!(clave in req.body)) continue
      if (clave === 'smtp_pass' && req.body[clave] === '***') continue
      upsert.run(clave, req.body[clave] ?? '')
    }
  })()
  res.json({ ok: true })
})

// POST /test-email — enviar email de prueba (acepta config del body para probar sin guardar)
router.post('/test-email', async (req, res) => {
  if (!esAdmin(req)) return res.status(403).json({ error: 'Sin permisos' })
  const b = req.body || {}
  const host   = b.smtp_host   || get('smtp_host')
  const user   = b.smtp_user   || get('smtp_user')
  const pass   = (b.smtp_pass && b.smtp_pass !== '***') ? b.smtp_pass : get('smtp_pass')
  const port   = b.smtp_port   || get('smtp_port')   || '587'
  const secure = b.smtp_secure !== undefined ? b.smtp_secure === 'true' : get('smtp_secure') === 'true'
  const from   = b.smtp_from   || get('smtp_from')
  if (!host || !user) return res.status(400).json({ error: 'SMTP no configurado (host y usuario requeridos)' })
  const to = b.to || get('backup_to') || user
  try {
    const transport = nodemailer.createTransport({
      host, port: parseInt(port),
      secure,
      auth: { user, pass },
      tls: { rejectUnauthorized: false },
    })
    await transport.sendMail({
      from: from || user,
      to,
      subject: '[E-INTRA ERP] Email de prueba',
      text:    'Este es un email de prueba del sistema E-INTRA ERP.\nLa configuración SMTP es correcta.',
    })
    res.json({ ok: true, mensaje: `Email enviado a ${to}` })
  } catch(err) {
    res.status(500).json({ error: `Error SMTP: ${err.message}` })
  }
})

// POST /backup-ahora — enviar backup manual de la BD
router.post('/backup-ahora', async (req, res) => {
  if (!esAdmin(req)) return res.status(403).json({ error: 'Sin permisos' })
  const host = get('smtp_host'), user = get('smtp_user'), pass = get('smtp_pass')
  const to   = get('backup_to')
  if (!host || !user) return res.status(400).json({ error: 'SMTP no configurado (host y usuario requeridos)' })
  if (!to) return res.status(400).json({ error: 'Destinatario de backup no configurado' })

  const fs   = require('fs')
  const path = require('path')
  const rawPath = process.env.DB_PATH || './db/eintra_erp.db'
  const dbPath  = path.isAbsolute(rawPath) ? rawPath : path.resolve(__dirname, '..', rawPath)
  if (!fs.existsSync(dbPath)) return res.status(500).json({ error: 'Archivo de base de datos no encontrado' })

  const fecha = new Date().toISOString().slice(0, 10)
  const kb    = Math.round(fs.statSync(dbPath).size / 1024)

  try {
    const transport = nodemailer.createTransport({
      host, port: parseInt(get('smtp_port') || '587'),
      secure: get('smtp_secure') === 'true',
      auth: { user, pass },
      tls: { rejectUnauthorized: false },
    })
    await transport.sendMail({
      from:        get('smtp_from') || user,
      to,
      subject:     `[E-INTRA ERP] Backup BD ${fecha} (manual)`,
      text:        `Backup manual de la base de datos.\nFecha: ${fecha}\nTamaño: ${kb} KB\nArchivo adjunto: eintra_erp_${fecha}.db`,
      attachments: [{ filename: `eintra_erp_${fecha}.db`, path: dbPath }],
    })
    res.json({ ok: true, mensaje: `Backup enviado a ${to} (${kb} KB)` })
  } catch(err) {
    res.status(500).json({ error: `Error SMTP: ${err.message}` })
  }
})

module.exports = router
