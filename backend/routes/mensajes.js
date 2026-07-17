'use strict'
const express    = require('express')
const nodemailer = require('nodemailer')
const router  = express.Router()
const { db }  = require('../db/database')
const { verificarToken } = require('../middleware/auth')
const { getConfig } = require('../helpers/config')

function notificarPorMail(para, de_nombre, asunto) {
  const host = getConfig('smtp_host')
  const user = getConfig('smtp_user')
  if (!host || !user || !para.email) return
  const transport = nodemailer.createTransport({
    host,
    port:   parseInt(getConfig('smtp_port', '587')),
    secure: getConfig('smtp_secure', 'false') === 'true',
    auth:   { user, pass: getConfig('smtp_pass') },
    tls:    { rejectUnauthorized: false },
  })
  transport.sendMail({
    from:    getConfig('smtp_from') || user,
    to:      para.email,
    subject: `[E-INTRA ERP] Nuevo mensaje de ${de_nombre}`,
    text:    `Tenés un nuevo mensaje en el Sistema de Gestión E-INTRA.\n\nDe: ${de_nombre}\nAsunto: ${asunto}\n\nIngresá al sistema para leerlo.`,
  }, err => {
    if (err) console.error(`[mensajes] Error enviando notificación a ${para.email}: ${err.message}`)
  })
}

router.use(verificarToken)

// Lista de usuarios para el selector (antes de /:id)
router.get('/usuarios/lista', (req, res) => {
  const users = db.prepare(
    'SELECT id, nombre, rol FROM usuarios WHERE activo=1 AND id!=? ORDER BY nombre'
  ).all(req.usuario.id)
  res.json(users)
})

// Conteo de no leídos (para polling)
router.get('/no-leidos', (req, res) => {
  const r = db.prepare(
    'SELECT COUNT(*) as c FROM mensajes WHERE para_id=? AND leido=0 AND borrado_para=0'
  ).get(req.usuario.id)
  res.json({ count: r.c })
})

// Bandeja de entrada
router.get('/', (req, res) => {
  const msgs = db.prepare(`
    SELECT id, de_id, de_nombre, asunto, leido, created_at
    FROM mensajes WHERE para_id=? AND borrado_para=0
    ORDER BY created_at DESC LIMIT 100
  `).all(req.usuario.id)
  res.json(msgs)
})

// Enviados
router.get('/enviados', (req, res) => {
  const msgs = db.prepare(`
    SELECT id, para_id, para_nombre, asunto, leido, leido_at, created_at
    FROM mensajes WHERE de_id=? AND borrado_de=0
    ORDER BY created_at DESC LIMIT 100
  `).all(req.usuario.id)
  res.json(msgs)
})

// Leer mensaje (marca como leído si es el destinatario)
router.get('/:id', (req, res) => {
  const uid = req.usuario.id
  const m = db.prepare(
    'SELECT * FROM mensajes WHERE id=? AND (para_id=? OR de_id=?)'
  ).get(req.params.id, uid, uid)
  if (!m) return res.status(404).json({ error: 'No encontrado' })
  if (m.para_id === uid && !m.leido)
    db.prepare("UPDATE mensajes SET leido=1, leido_at=datetime('now','localtime') WHERE id=?").run(m.id)
  res.json(m)
})

// Enviar mensaje
router.post('/', (req, res) => {
  const { para_id, asunto, cuerpo } = req.body
  if (!para_id || !String(cuerpo || '').trim())
    return res.status(400).json({ error: 'Destinatario y cuerpo son obligatorios' })
  const para = db.prepare('SELECT id, nombre, email FROM usuarios WHERE id=? AND activo=1').get(para_id)
  if (!para) return res.status(404).json({ error: 'Destinatario no encontrado' })
  const asuntoFinal = String(asunto || '').trim() || '(sin asunto)'
  db.prepare(`
    INSERT INTO mensajes (de_id, de_nombre, para_id, para_nombre, asunto, cuerpo)
    VALUES (?,?,?,?,?,?)
  `).run(req.usuario.id, req.usuario.nombre, para.id, para.nombre,
    asuntoFinal, String(cuerpo).trim())
  notificarPorMail(para, req.usuario.nombre, asuntoFinal)
  res.status(201).json({ ok: true })
})

// Eliminar (soft delete según si es receptor o emisor)
router.delete('/:id', (req, res) => {
  const uid = req.usuario.id
  const m = db.prepare('SELECT * FROM mensajes WHERE id=?').get(req.params.id)
  if (!m) return res.status(404).json({ error: 'No encontrado' })
  if (m.para_id === uid)      db.prepare('UPDATE mensajes SET borrado_para=1 WHERE id=?').run(m.id)
  else if (m.de_id === uid)   db.prepare('UPDATE mensajes SET borrado_de=1   WHERE id=?').run(m.id)
  else return res.status(403).json({ error: 'Sin permisos' })
  res.json({ ok: true })
})

module.exports = router
