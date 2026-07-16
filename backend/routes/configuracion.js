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

// ── Backup descargable ────────────────────────────────────────────────────────

// GET /backup-db — descarga la BD como archivo (backup seguro en caliente)
router.get('/backup-db', async (req, res) => {
  if (!esAdmin(req)) return res.status(403).json({ error: 'Sin permisos' })

  const path = require('path')
  const fs   = require('fs')
  const { db: sqliteDb } = require('../db/database')

  const rawPath = process.env.DB_PATH || './db/eintra_erp.db'
  const dbPath  = path.isAbsolute(rawPath) ? rawPath : path.resolve(__dirname, '..', rawPath)
  const fecha   = new Date().toISOString().slice(0, 10)
  const tmpPath = dbPath + '.download_tmp'

  try {
    await sqliteDb.backup(tmpPath)
    const size = fs.statSync(tmpPath).size
    res.setHeader('Content-Disposition', `attachment; filename="eintra_erp_backup_${fecha}.db"`)
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Length', size)
    const stream = fs.createReadStream(tmpPath)
    stream.pipe(res)
    stream.on('end',   () => fs.unlink(tmpPath, () => {}))
    stream.on('error', () => { fs.unlink(tmpPath, () => {}); if (!res.headersSent) res.status(500).json({ error: 'Error al leer backup' }) })
  } catch (e) {
    try { fs.unlinkSync(tmpPath) } catch (_) {}
    res.status(500).json({ error: 'Error al generar backup: ' + e.message })
  }
})

// GET /instalador — genera y descarga el paquete de instalación del sistema
router.get('/instalador', (req, res) => {
  if (!esAdmin(req)) return res.status(403).json({ error: 'Sin permisos' })

  const path   = require('path')
  const fs     = require('fs')
  const os     = require('os')
  const { spawn } = require('child_process')

  const appRoot  = path.resolve(__dirname, '../..')
  const fecha    = new Date().toISOString().slice(0, 10)
  const tmpDir   = fs.mkdtempSync(path.join(os.tmpdir(), 'eintra-inst-'))
  const cleanup  = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch(_) {} }

  // ── Generar install.sh ──────────────────────────────────────────────────────
  const installSh = `#!/bin/bash
# ================================================================
#  E-INTRA ERP — Script de instalación autónoma
#  Generado: ${fecha}
#  Uso: bash install.sh [ruta_destino]
#  Ejemplo: bash install.sh /home/administrador/eintra-erp
# ================================================================
set -e
RUTA=\${1:-/home/administrador/eintra-erp}
PORT=3002
SCRIPT_DIR="\$( cd "\$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"

echo "============================================"
echo " E-INTRA ERP — Instalación"
echo " Destino: \$RUTA"
echo "============================================"

# ── Verificar Node.js ───────────────────────────
if ! command -v node &>/dev/null; then
  echo ""
  echo "ERROR: Node.js no está instalado. Instalarlo manualmente:"
  echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -"
  echo "  sudo apt-get install -y nodejs"
  echo "  sudo npm install -g pm2"
  exit 1
fi
echo "[node] \$(node -v) / npm \$(npm -v)"

# ── Verificar PM2 ───────────────────────────────
if ! command -v pm2 &>/dev/null; then
  echo "[pm2] Instalando PM2..."
  sudo npm install -g pm2
fi

# ── Crear directorios ───────────────────────────
mkdir -p "\$RUTA/backend/db" "\$RUTA/frontend" "\$RUTA/uploads" "\$RUTA/logs"

# ── Copiar archivos ─────────────────────────────
echo "[copy] Copiando archivos..."
cp -r "\$SCRIPT_DIR/backend" "\$RUTA/"
cp -r "\$SCRIPT_DIR/frontend" "\$RUTA/"

# ── .env inicial (solo si no existe) ───────────
if [ ! -f "\$RUTA/backend/.env" ]; then
  echo "[env] Creando .env..."
  cat > "\$RUTA/backend/.env" << 'ENVEOF'
PORT=3002
JWT_SECRET=eintra_erp_secret_CAMBIAR_EN_PRODUCCION
JWT_EXPIRES_IN=10h
DB_PATH=./db/eintra_erp.db
UPLOADS_PATH=../uploads
NODE_ENV=production
ENVEOF
  echo "[env] IMPORTANTE: cambiar JWT_SECRET en \$RUTA/backend/.env"
fi

# ── Dependencias backend ────────────────────────
echo "[npm] Instalando dependencias backend..."
cd "\$RUTA/backend" && npm install --omit=dev

# ── Build frontend ──────────────────────────────
if [ -d "\$SCRIPT_DIR/frontend/dist" ]; then
  echo "[dist] Usando frontend ya compilado"
elif [ ! -d "\$RUTA/frontend/dist" ]; then
  echo "[vite] Compilando frontend..."
  cd "\$RUTA/frontend" && npm install && npm run build
fi

# ── PM2 ─────────────────────────────────────────
echo "[pm2] Gestionando servicio..."
if pm2 list 2>/dev/null | grep -q 'eintra-erp'; then
  pm2 restart eintra-erp --update-env
else
  cd "\$RUTA/backend"
  NODE_ENV=production pm2 start server.js --name eintra-erp
  pm2 save
  USUARIO=\${SUDO_USER:-\$(whoami)}
  sudo env PATH=\$PATH:/usr/bin pm2 startup systemd -u "\$USUARIO" --hp "/home/\$USUARIO" 2>/dev/null || true
  pm2 save
fi

# ── Cron backup nightly ─────────────────────────
NODE_BIN=\$(which node 2>/dev/null || echo /usr/bin/node)
CRON_JOB="0 0 * * * \$NODE_BIN \$RUTA/backend/scripts/backup-email.js >> \$RUTA/logs/backup.log 2>&1"
( crontab -l 2>/dev/null | grep -v "backup-email.js"; echo "\$CRON_JOB" ) | crontab -
echo "[cron] Backup programado a medianoche"

echo ""
echo "============================================"
echo " Instalación completada"
echo " Acceder: http://\$(hostname -I | awk '{print \$1}'):\$PORT"
echo "============================================"
`
  fs.writeFileSync(path.join(tmpDir, 'install.sh'), installSh, { mode: 0o755 })

  // ── Armar lista de archivos a incluir ───────────────────────────────────────
  const include = [
    'backend/server.js', 'backend/package.json',
    'backend/routes', 'backend/middleware', 'backend/helpers',
    'backend/db/database.js', 'backend/scripts',
    'frontend/src', 'frontend/package.json', 'frontend/vite.config.js', 'frontend/index.html',
  ]
  if (fs.existsSync(path.join(appRoot, 'frontend/dist'))) include.push('frontend/dist')

  const tarArgs = [
    '-czf', '-',
    '--exclude=node_modules', '--exclude=.env', '--exclude=*.db', '--exclude=.git',
    '-C', appRoot, ...include,
    '-C', tmpDir, 'install.sh',
  ]

  res.setHeader('Content-Disposition', `attachment; filename="eintra-erp-instalador-${fecha}.tar.gz"`)
  res.setHeader('Content-Type', 'application/gzip')

  const tar = spawn('tar', tarArgs)
  tar.stdout.pipe(res)
  tar.stderr.on('data', d => console.error('[instalador tar]', d.toString()))
  tar.on('error', e => { cleanup(); if (!res.headersSent) res.status(500).json({ error: 'Error: ' + e.message }) })
  tar.on('close', cleanup)
  res.on('close', cleanup)
})

// ── Directivas ────────────────────────────────────────────────────────────────

router.get('/directivas', (req, res) => {
  res.json(db.prepare('SELECT * FROM directivas ORDER BY orden, id').all())
})

router.post('/directivas', (req, res) => {
  if (!esAdmin(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { titulo, descripcion } = req.body
  if (!titulo?.trim()) return res.status(400).json({ error: 'Título requerido' })
  const maxOrden = db.prepare('SELECT COALESCE(MAX(orden),0) as m FROM directivas').get().m
  const r = db.prepare("INSERT INTO directivas (titulo, descripcion, orden) VALUES (?,?,?)").run(titulo.trim(), descripcion||'', maxOrden + 1)
  res.status(201).json(db.prepare('SELECT * FROM directivas WHERE id=?').get(r.lastInsertRowid))
})

router.put('/directivas/:id', (req, res) => {
  if (!esAdmin(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { titulo, descripcion, activa } = req.body
  if (!titulo?.trim()) return res.status(400).json({ error: 'Título requerido' })
  db.prepare('UPDATE directivas SET titulo=?, descripcion=?, activa=? WHERE id=?')
    .run(titulo.trim(), descripcion||'', activa !== undefined ? (activa ? 1 : 0) : 1, req.params.id)
  res.json(db.prepare('SELECT * FROM directivas WHERE id=?').get(req.params.id))
})

router.patch('/directivas/:id/toggle', (req, res) => {
  if (!esAdmin(req)) return res.status(403).json({ error: 'Sin permisos' })
  db.prepare('UPDATE directivas SET activa = CASE WHEN activa=1 THEN 0 ELSE 1 END WHERE id=?').run(req.params.id)
  res.json(db.prepare('SELECT * FROM directivas WHERE id=?').get(req.params.id))
})

router.delete('/directivas/:id', (req, res) => {
  if (!esAdmin(req)) return res.status(403).json({ error: 'Sin permisos' })
  db.prepare('DELETE FROM directivas WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

module.exports = router
