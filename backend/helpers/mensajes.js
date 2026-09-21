'use strict'
const nodemailer = require('nodemailer')
const { db } = require('../db/database')
const { getConfig } = require('./config')

// Extraído de routes/mensajes.js para poder mandar un mensaje interno desde
// cualquier flujo del sistema (no solo desde la bandeja de Mensajes) — ej.
// avisarle al autorizante de un retiro de stock.
function notificarPorMail(para, de_nombre, asunto) {
  const host = getConfig('smtp_host')
  const user = getConfig('smtp_user')
  if (!host || !user || !para.email) return
  const transport = nodemailer.createTransport({
    host,
    port:   parseInt(getConfig('smtp_port', '587')),
    secure: getConfig('smtp_secure', 'false') === 'true',
    auth:   { user, pass: getConfig('smtp_pass') },
    // Valida el certificado TLS del servidor SMTP por default (evita un
    // MITM interceptando el correo) — si el proveedor de correo usado en
    // producción tiene un certificado que no valida (relay interno con
    // certificado propio, etc.), se puede desactivar cargando la clave de
    // configuración 'smtp_tls_reject_unauthorized' en 'false'.
    tls:    { rejectUnauthorized: getConfig('smtp_tls_reject_unauthorized', 'true') !== 'false' },
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

// Manda un mensaje interno de sistema a uno o varios usuarios (ej. el
// gerente que autorizó un retiro de stock) — mismo mecanismo que un mensaje
// mandado a mano desde la bandeja de Mensajes, incluyendo el aviso por mail
// a cada destinatario que tenga uno cargado. `para_id` acepta un solo id
// (los call sites existentes, que siempre notifican a un único autorizante)
// o un array — un mensaje, varios destinatarios, cada uno con su propio
// estado de lectura en mensaje_destinatarios.
function enviarMensajeSistema({ de_id, de_nombre, para_id, asunto, cuerpo }) {
  const ids = [...new Set((Array.isArray(para_id) ? para_id : [para_id]).map(id => parseInt(id)).filter(Boolean))]
  const destinatarios = ids
    .map(id => db.prepare('SELECT id, nombre, email FROM usuarios WHERE id=? AND activo=1').get(id))
    .filter(Boolean)
  if (!destinatarios.length) return false
  const r = db.prepare(`INSERT INTO mensajes (de_id, de_nombre, asunto, cuerpo) VALUES (?,?,?,?)`)
    .run(de_id, de_nombre, asunto, cuerpo)
  const insDestinatario = db.prepare(`
    INSERT INTO mensaje_destinatarios (mensaje_id, usuario_id, usuario_nombre) VALUES (?,?,?)
  `)
  for (const para of destinatarios) {
    insDestinatario.run(r.lastInsertRowid, para.id, para.nombre)
    notificarPorMail(para, de_nombre, asunto)
  }
  return true
}

module.exports = { notificarPorMail, enviarMensajeSistema }
