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

// Manda un mensaje interno de sistema a un usuario puntual (ej. el gerente
// que autorizó un retiro de stock) — mismo mecanismo que un mensaje mandado
// a mano desde la bandeja de Mensajes, incluyendo el aviso por mail si el
// destinatario tiene uno cargado.
function enviarMensajeSistema({ de_id, de_nombre, para_id, asunto, cuerpo }) {
  const para = db.prepare('SELECT id, nombre, email FROM usuarios WHERE id=? AND activo=1').get(para_id)
  if (!para) return false
  db.prepare(`
    INSERT INTO mensajes (de_id, de_nombre, para_id, para_nombre, asunto, cuerpo)
    VALUES (?,?,?,?,?,?)
  `).run(de_id, de_nombre, para.id, para.nombre, asunto, cuerpo)
  notificarPorMail(para, de_nombre, asunto)
  return true
}

module.exports = { notificarPorMail, enviarMensajeSistema }
