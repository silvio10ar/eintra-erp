'use strict'
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') })
const nodemailer   = require('nodemailer')
const fs   = require('fs')
const path = require('path')
const { getConfig } = require('../helpers/config')

const rawPath = process.env.DB_PATH || './db/eintra_erp.db'
const dbPath  = path.isAbsolute(rawPath)
  ? rawPath
  : path.resolve(__dirname, '..', rawPath)

if (!fs.existsSync(dbPath)) {
  console.error(`[backup] BD no encontrada: ${dbPath}`)
  process.exit(1)
}

const host = getConfig('smtp_host')
const user = getConfig('smtp_user')
if (!host || !user) {
  console.error('[backup] SMTP no configurado (smtp_host y smtp_user requeridos)')
  process.exit(1)
}

const transport = nodemailer.createTransport({
  host,
  port:   parseInt(getConfig('smtp_port', '587')),
  secure: getConfig('smtp_secure', 'false') === 'true',
  auth:   { user, pass: getConfig('smtp_pass') },
  tls:    { rejectUnauthorized: false },
})

const fecha = new Date().toISOString().slice(0, 10)
const kb    = Math.round(fs.statSync(dbPath).size / 1024)

transport.sendMail({
  from:        getConfig('smtp_from') || user,
  to:          getConfig('backup_to'),
  subject:     `[E-INTRA ERP] Backup BD ${fecha}`,
  text:        `Backup automático diario de la base de datos.\nFecha: ${fecha}\nTamaño: ${kb} KB\nArchivo adjunto: eintra_erp_${fecha}.db`,
  attachments: [{ filename: `eintra_erp_${fecha}.db`, path: dbPath }],
}, (err, info) => {
  if (err) {
    console.error(`[backup] Error enviando mail: ${err.message}`)
    process.exit(1)
  }
  console.log(`[backup] OK — ${fecha} — ${kb} KB — ${info.messageId}`)
})
