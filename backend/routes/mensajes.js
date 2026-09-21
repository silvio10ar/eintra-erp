'use strict'
const express = require('express')
const router  = express.Router()
const { db }  = require('../db/database')
const { verificarToken } = require('../middleware/auth')
const { enviarMensajeSistema } = require('../helpers/mensajes')

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
    'SELECT COUNT(*) as c FROM mensaje_destinatarios WHERE usuario_id=? AND leido=0 AND borrado=0'
  ).get(req.usuario.id)
  res.json({ count: r.c })
})

// Bandeja de entrada — incluye el cuerpo para poder filtrar por contenido en
// el frontend (buscador de mensajes), no solo por asunto.
router.get('/', (req, res) => {
  const msgs = db.prepare(`
    SELECT m.id, m.de_id, m.de_nombre, m.asunto, m.cuerpo, md.leido, m.created_at
    FROM mensaje_destinatarios md
    JOIN mensajes m ON m.id = md.mensaje_id
    WHERE md.usuario_id=? AND md.borrado=0
    ORDER BY m.created_at DESC LIMIT 100
  `).all(req.usuario.id)
  res.json(msgs)
})

// Enviados — cada mensaje puede tener varios destinatarios, cada uno con su
// propio estado de lectura (traído aparte, mismo patrón que pedidos+ítems).
router.get('/enviados', (req, res) => {
  const msgs = db.prepare(`
    SELECT id, asunto, cuerpo, created_at FROM mensajes
    WHERE de_id=? AND borrado_de=0
    ORDER BY created_at DESC LIMIT 100
  `).all(req.usuario.id)
  const ids = msgs.map(m => m.id)
  const destinatarios = ids.length ? db.prepare(`
    SELECT mensaje_id, usuario_id, usuario_nombre, leido, leido_at
    FROM mensaje_destinatarios WHERE mensaje_id IN (${ids.map(() => '?').join(',')})
  `).all(...ids) : []
  res.json(msgs.map(m => ({ ...m, destinatarios: destinatarios.filter(d => d.mensaje_id === m.id) })))
})

// Leer mensaje (marca leído SOLO la fila del destinatario que lo abre)
router.get('/:id', (req, res) => {
  const uid = req.usuario.id
  const m = db.prepare('SELECT * FROM mensajes WHERE id=?').get(req.params.id)
  if (!m) return res.status(404).json({ error: 'No encontrado' })
  let destinatarios = db.prepare('SELECT * FROM mensaje_destinatarios WHERE mensaje_id=?').all(m.id)
  const miDestino = destinatarios.find(d => d.usuario_id === uid)
  if (!miDestino && m.de_id !== uid) return res.status(404).json({ error: 'No encontrado' })
  if (miDestino && !miDestino.leido) {
    db.prepare("UPDATE mensaje_destinatarios SET leido=1, leido_at=datetime('now','localtime') WHERE id=?").run(miDestino.id)
    destinatarios = db.prepare('SELECT * FROM mensaje_destinatarios WHERE mensaje_id=?').all(m.id)
  }
  res.json({ ...m, destinatarios })
})

// Marcar como leído / no leído a mano — solo el propio destinatario puede
// togglear su fila (el marcado automático de arriba sigue existiendo al
// abrir; esto permite además volver a marcarlo como no leído).
router.patch('/:id/leido', (req, res) => {
  const uid = req.usuario.id
  const md = db.prepare('SELECT * FROM mensaje_destinatarios WHERE mensaje_id=? AND usuario_id=?').get(req.params.id, uid)
  if (!md) return res.status(404).json({ error: 'No encontrado' })
  const leido = !!req.body.leido
  db.prepare(`UPDATE mensaje_destinatarios SET leido=?, leido_at=${leido ? "datetime('now','localtime')" : 'NULL'} WHERE id=?`)
    .run(leido ? 1 : 0, md.id)
  res.json({ ok: true })
})

// Enviar mensaje — a uno o varios destinatarios
router.post('/', (req, res) => {
  const { para_ids, asunto, cuerpo } = req.body
  const ids = Array.isArray(para_ids) ? para_ids : (para_ids ? [para_ids] : [])
  if (!ids.length || !String(cuerpo || '').trim())
    return res.status(400).json({ error: 'Elegí al menos un destinatario y escribí el mensaje' })
  const asuntoFinal = String(asunto || '').trim() || '(sin asunto)'
  const enviado = enviarMensajeSistema({
    de_id: req.usuario.id, de_nombre: req.usuario.nombre, para_id: ids,
    asunto: asuntoFinal, cuerpo: String(cuerpo).trim(),
  })
  if (!enviado) return res.status(404).json({ error: 'Ningún destinatario válido' })
  res.status(201).json({ ok: true })
})

// Eliminar (soft delete según si es receptor o emisor)
router.delete('/:id', (req, res) => {
  const uid = req.usuario.id
  const m = db.prepare('SELECT * FROM mensajes WHERE id=?').get(req.params.id)
  if (!m) return res.status(404).json({ error: 'No encontrado' })
  const md = db.prepare('SELECT * FROM mensaje_destinatarios WHERE mensaje_id=? AND usuario_id=?').get(m.id, uid)
  if (md)                    db.prepare('UPDATE mensaje_destinatarios SET borrado=1 WHERE id=?').run(md.id)
  else if (m.de_id === uid)  db.prepare('UPDATE mensajes SET borrado_de=1 WHERE id=?').run(m.id)
  else return res.status(403).json({ error: 'Sin permisos' })
  res.json({ ok: true })
})

module.exports = router
