'use strict'
const nodemailer = require('nodemailer')
const { ImapFlow } = require('imapflow')
const { getConfig } = require('./config')
const { hoyArgentina } = require('./fecha')

// Compara asuntos ignorando mayúsculas/acentos/espacios de más — "Cómo
// está todo", "como esta todo " y "COMO ESTA TODO" tienen que matchear igual.
const normalizar = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().trim().replace(/\s+/g, ' ')

// Arma y manda la respuesta con el Dashboard de Finanzas — mismo contenido
// (imagen PNG generada al vuelo) que ya usa el reporte diario automático,
// solo que acá el destinatario es quien escribió el mail, no el email fijo
// configurado para el reporte diario. inReplyTo/references hacen que quede
// enhebrado como respuesta en el cliente de mail del CEO, no como un mail suelto.
async function responderConDashboard({ to, asuntoOriginal, messageId }) {
  const { obtenerDashboardDiario } = require('../routes/finanzas')
  const { generarPngDashboard } = require('./reporteDashboardFinanzas')
  const data = obtenerDashboardDiario()
  const png  = await generarPngDashboard(data)
  const fecha = hoyArgentina()

  const host = getConfig('smtp_host')
  const user = getConfig('smtp_user')
  const transport = nodemailer.createTransport({
    host,
    port:   parseInt(getConfig('smtp_port', '587')),
    secure: getConfig('smtp_secure', 'false') === 'true',
    auth:   { user, pass: getConfig('smtp_pass') },
    tls:    { rejectUnauthorized: getConfig('smtp_tls_reject_unauthorized', 'true') !== 'false' },
  })

  const asunto = asuntoOriginal && /^re:/i.test(asuntoOriginal.trim()) ? asuntoOriginal : `Re: ${asuntoOriginal || 'Como está todo'}`
  await transport.sendMail({
    from: getConfig('smtp_from') || user,
    to,
    subject: asunto,
    inReplyTo: messageId || undefined,
    references: messageId || undefined,
    html: `<p>¡Todo en marcha! Así está el Dashboard de Finanzas ahora mismo:</p>`
      + `<img src="cid:dashboard-finanzas" style="max-width:100%;border:1px solid #e9ecef;border-radius:8px" />`,
    attachments: [{
      filename: `dashboard-finanzas-${fecha}.png`,
      content:  png,
      cid:      'dashboard-finanzas',
    }],
  })
}

// Revisa la bandeja de entrada (misma casilla que ya manda los mails del
// sistema) buscando mails sin leer del CEO cuyo asunto sea el disparador
// configurado, y contesta cada uno con el Dashboard de Finanzas. Se apoya en
// el flag \Seen de IMAP para no contestar dos veces el mismo mail — recién se
// marca leído si la respuesta se mandó con éxito, así un error transitorio
// (SMTP caído, etc.) lo vuelve a intentar en la próxima corrida del cron en
// vez de perderlo.
async function revisarYResponderCEO({ forzar = false } = {}) {
  const activo = getConfig('respuesta_ceo_activo') === 'true'
  if (!forzar && !activo) return { revisados: 0, respondidos: 0, motivo: 'La respuesta automática al CEO no está activada' }

  const ceoEmail = getConfig('respuesta_ceo_email', 'antonio.palladino@e-intrasrl.com').trim()
  if (!ceoEmail) return { revisados: 0, respondidos: 0, motivo: 'Falta configurar el email del CEO' }
  const asuntoEsperado = normalizar(getConfig('respuesta_ceo_asunto', 'como esta todo'))

  const smtpHost = getConfig('smtp_host')
  const smtpUser = getConfig('smtp_user')
  const smtpPass = getConfig('smtp_pass')
  if (!smtpHost || !smtpUser) return { revisados: 0, respondidos: 0, motivo: 'SMTP no configurado (host y usuario requeridos)' }

  // Por defecto asume el mismo servidor que el SMTP (muy habitual: es la
  // misma casilla) — imap_host queda como override para cuando el proveedor
  // usa un host distinto para IMAP.
  const imapHost   = getConfig('imap_host') || smtpHost
  const imapPort   = parseInt(getConfig('imap_port', '993'))
  const imapSecure = getConfig('imap_secure', 'true') !== 'false'

  const client = new ImapFlow({
    host: imapHost, port: imapPort, secure: imapSecure,
    auth: { user: smtpUser, pass: smtpPass },
    logger: false,
  })

  let revisados = 0, respondidos = 0
  const errores = []
  await client.connect()
  try {
    const lock = await client.getMailboxLock('INBOX')
    try {
      const uids = await client.search({ seen: false, from: ceoEmail }, { uid: true })
      for (const uid of uids) {
        revisados++
        const msg = await client.fetchOne(uid, { envelope: true }, { uid: true })
        if (!msg?.envelope) continue
        if (!normalizar(msg.envelope.subject).includes(asuntoEsperado)) continue

        const remitente = msg.envelope.from?.[0]?.address || ceoEmail
        try {
          await responderConDashboard({ to: remitente, asuntoOriginal: msg.envelope.subject, messageId: msg.envelope.messageId })
          await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true })
          respondidos++
        } catch (e) {
          errores.push(`UID ${uid}: ${e.message}`)
        }
      }
    } finally {
      lock.release()
    }
  } finally {
    await client.logout().catch(() => {})
  }

  return { revisados, respondidos, errores: errores.length ? errores : undefined }
}

module.exports = { revisarYResponderCEO }
