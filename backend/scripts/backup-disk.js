'use strict'
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') })
const fs   = require('fs')
const path = require('path')
const { db } = require('../db/database')

const RETENCION_DIAS = 14

const rawPath = process.env.DB_PATH || './db/eintra_erp.db'
const dbPath  = path.isAbsolute(rawPath) ? rawPath : path.resolve(__dirname, '..', rawPath)

if (!fs.existsSync(dbPath)) {
  console.error(`[backup-disk] BD no encontrada: ${dbPath}`)
  process.exit(1)
}

const backupsDir = path.resolve(path.dirname(dbPath), 'backups')
fs.mkdirSync(backupsDir, { recursive: true })

const fecha   = new Date().toISOString().slice(0, 10)
const destino = path.join(backupsDir, `eintra_erp_${fecha}.db`)

db.backup(destino)
  .then(() => {
    const kb = Math.round(fs.statSync(destino).size / 1024)
    console.log(`[backup-disk] OK — ${fecha} — ${kb} KB — ${destino}`)

    const limite = Date.now() - RETENCION_DIAS * 864e5
    let eliminados = 0
    for (const f of fs.readdirSync(backupsDir)) {
      const full = path.join(backupsDir, f)
      if (fs.statSync(full).mtimeMs < limite) {
        fs.unlinkSync(full)
        eliminados++
      }
    }
    if (eliminados) console.log(`[backup-disk] Purgados ${eliminados} backups viejos (> ${RETENCION_DIAS} días)`)
    process.exit(0)
  })
  .catch(err => {
    console.error(`[backup-disk] Error: ${err.message}`)
    process.exit(1)
  })
