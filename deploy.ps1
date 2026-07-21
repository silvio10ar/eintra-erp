# =============================================================================
#  deploy.ps1  —  Despliega E-INTRA ERP al servidor Linux via SSH
#  Uso: .\deploy.ps1
# =============================================================================
#  CONFIGURAR ESTAS 3 VARIABLES ANTES DEL PRIMER USO:
$SSH_USUARIO = "administrador"           # usuario SSH del servidor Linux
$SSH_HOST    = "10.1.1.10"    # IP del servidor Linux  <-- CAMBIAR
$RUTA_REMOTA = "/home/administrador/eintra-erp" # ruta de instalacion en Linux
# =============================================================================

$LOCAL   = "C:\Users\silvi\eintra-erp"
$SSH     = "$SSH_USUARIO@$SSH_HOST"
$TMP_TAR = "$env:TEMP\eintra-erp.tar.gz"
$TMP_SH  = "$env:TEMP\eintra-setup.sh"
$O       = @("-o", "PubkeyAuthentication=no", "-o", "ConnectTimeout=10")

function Paso($n, $msg) { Write-Host "`n[$n/5] $msg" -ForegroundColor Cyan }
function OK($msg)        { Write-Host "      OK: $msg" -ForegroundColor Green }
function Fallo($msg)     { Write-Host "`n  ERROR: $msg" -ForegroundColor Red; exit 1 }

# ─── 1. Verificar conexion SSH ────────────────────────────────────────────────
Paso 1 "Verificando conexion SSH a $SSH_HOST..."
ssh @O $SSH "exit 0"
if ($LASTEXITCODE -ne 0) { Fallo "No se pudo conectar a $SSH`n  Verificar: IP correcta y servidor SSH activo." }
OK "Conectado a $SSH_HOST"

# ─── 2. Empaquetar codigo fuente ──────────────────────────────────────────────
Paso 2 "Empaquetando codigo fuente (sin node_modules, sin DB, sin .env)..."
Push-Location $LOCAL
tar -czf $TMP_TAR `
  "backend/server.js" `
  "backend/package.json" `
  "backend/routes" `
  "backend/middleware" `
  "backend/helpers" `
  "backend/db/database.js" `
  "backend/scripts" `
  "frontend/src" `
  "frontend/package.json" `
  "frontend/vite.config.js" `
  "frontend/index.html"
$exitTar = $LASTEXITCODE
Pop-Location
if ($exitTar -ne 0) { Fallo "Error al crear el paquete tar" }
$kb = [math]::Round((Get-Item $TMP_TAR).Length / 1KB)
OK "Paquete listo ($kb KB)"

# ─── 3. Subir y extraer en el servidor ───────────────────────────────────────
Paso 3 "Subiendo archivos al servidor (ingresar contrasena)..."
$dirs = "$RUTA_REMOTA/backend/routes $RUTA_REMOTA/backend/middleware $RUTA_REMOTA/backend/helpers $RUTA_REMOTA/backend/db $RUTA_REMOTA/backend/scripts $RUTA_REMOTA/backend/data $RUTA_REMOTA/frontend/src $RUTA_REMOTA/uploads"
scp @O -q $TMP_TAR "${SSH}:${RUTA_REMOTA}/deploy.tar.gz"
if ($LASTEXITCODE -ne 0) { Fallo "Error al subir el paquete" }
ssh @O $SSH "mkdir -p $dirs && cd $RUTA_REMOTA && tar -xzf deploy.tar.gz && rm deploy.tar.gz"
if ($LASTEXITCODE -ne 0) { Fallo "Error al extraer en el servidor" }
OK "Archivos en $RUTA_REMOTA"

# Los archivos de datos NO se sincronizan automaticamente.
# Para subir datos al servidor, hacerlo manualmente con scp.

# ─── 4. Script de configuracion remota ───────────────────────────────────────
Paso 4 "Instalando dependencias y compilando en el servidor..."

# Leer vars SMTP del .env local para sincronizar al servidor
function Read-EnvVar {
  param($f, $k)
  $l = Get-Content $f -ErrorAction SilentlyContinue | Where-Object { $_ -match "^${k}=(.*)$" } | Select-Object -First 1
  if ($l) { ($l -split '=', 2)[1].Trim() } else { '' }
}
$smtpHost   = Read-EnvVar "$LOCAL\backend\.env" 'SMTP_HOST'
$smtpPort   = Read-EnvVar "$LOCAL\backend\.env" 'SMTP_PORT'
$smtpUser   = Read-EnvVar "$LOCAL\backend\.env" 'SMTP_USER'
$smtpPass   = Read-EnvVar "$LOCAL\backend\.env" 'SMTP_PASS'
$smtpFrom   = Read-EnvVar "$LOCAL\backend\.env" 'SMTP_FROM'
$smtpSecure = Read-EnvVar "$LOCAL\backend\.env" 'SMTP_SECURE'
$backupTo   = Read-EnvVar "$LOCAL\backend\.env" 'BACKUP_TO'

$bash = @"
#!/bin/bash
set -e
RUTA="$RUTA_REMOTA"
USUARIO="$SSH_USUARIO"

# ── Node.js ──────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo ""
  echo "ERROR: Node.js no esta instalado en el servidor."
  echo "Instalar manualmente una sola vez:"
  echo "  ssh administrador@$SSH_HOST"
  echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -"
  echo "  sudo apt-get install -y nodejs"
  echo "  sudo npm install -g pm2"
  echo "  exit"
  echo "Luego volver a correr: .\deploy.ps1"
  exit 1
fi
echo "[node] `$(node -v) / npm `$(npm -v)"

# ── PM2 ──────────────────────────────────────────────────────────
if ! command -v pm2 &>/dev/null; then
  echo ""
  echo "ERROR: PM2 no esta instalado. Instalar manualmente:"
  echo "  ssh administrador@$SSH_HOST"
  echo "  sudo npm install -g pm2"
  echo "  exit"
  exit 1
fi

# ── .env (solo primer deploy) ─────────────────────────────────────
if [ ! -f "`$RUTA/backend/.env" ]; then
  echo "[env] Creando .env inicial..."
  printf 'PORT=3002\nJWT_SECRET=eintra_erp_secret_2026_cambiar_en_produccion\nJWT_EXPIRES_IN=10h\nDB_PATH=./db/eintra_erp.db\nUPLOADS_PATH=../uploads\n' > "`$RUTA/backend/.env"
else
  echo "[env] .env existente, sin cambios"
fi

# ── Sincronizar vars SMTP ─────────────────────────────────────────
_uenv() {
  local k="`$1" v="`$2"
  local tmp=`$(mktemp)
  grep -v "^`$k=" "`$RUTA/backend/.env" > "`$tmp" 2>/dev/null || true
  printf '%s=%s\n' "`$k" "`$v" >> "`$tmp"
  mv "`$tmp" "`$RUTA/backend/.env"
}
_uenv SMTP_HOST   "$smtpHost"
_uenv SMTP_PORT   "$smtpPort"
_uenv SMTP_USER   "$smtpUser"
_uenv SMTP_PASS   "$smtpPass"
_uenv SMTP_FROM   "$smtpFrom"
_uenv SMTP_SECURE "$smtpSecure"
_uenv BACKUP_TO   "$backupTo"
echo "[smtp] Vars SMTP sincronizadas"

# ── Dependencias backend ──────────────────────────────────────────
echo "[npm] Instalando dependencias del backend..."
cd "`$RUTA/backend" && npm install --omit=dev

# ── Build frontend ────────────────────────────────────────────────
echo "[vite] Compilando frontend..."
cd "`$RUTA/frontend" && npm install && npm run build

# ── PM2: reiniciar o arrancar por primera vez ─────────────────────
echo "[pm2] Gestionando servicio..."
if pm2 list 2>/dev/null | grep -q 'eintra-erp'; then
  pm2 restart eintra-erp --update-env
else
  cd "`$RUTA/backend"
  NODE_ENV=production pm2 start server.js --name eintra-erp
  pm2 save
  echo "[pm2] Configurando inicio automatico al boot..."
  sudo env PATH=`$PATH:/usr/bin pm2 startup systemd -u "`$USUARIO" --hp "/home/`$USUARIO" 2>/dev/null || true
  pm2 save
fi

# ── Cron backup BD ───────────────────────────────────────────────
mkdir -p "`$RUTA/logs"
NODE_BIN=`$(which node 2>/dev/null || echo /usr/bin/node)
CRON_JOB="0 0 * * * `$NODE_BIN `$RUTA/backend/scripts/backup-email.js >> `$RUTA/logs/backup.log 2>&1"
( crontab -l 2>/dev/null | grep -v "backup-email.js" || true ; echo "`$CRON_JOB" ) | crontab -
echo "[cron] Backup BD programado a medianoche"

echo ""
echo "[OK] Servicio activo en http://`$(hostname -I | awk '{print `$1}'):3002"
"@

$bash | ssh @O $SSH "bash -s"
if ($LASTEXITCODE -ne 0) { Fallo "Error durante la configuracion remota. Ver mensajes de arriba." }
OK "Configuracion completada"

# ─── 5. Verificar ────────────────────────────────────────────────────────────
Paso 5 "Verificando servicio..."
Start-Sleep -Seconds 2
Write-Host ""
ssh @O $SSH "pm2 list --no-color 2>/dev/null | grep -E 'App name|eintra-erp' || echo '  (no se pudo verificar)'"
Write-Host ""

# Limpieza local
Remove-Item $TMP_TAR -ErrorAction SilentlyContinue
Remove-Item $TMP_SH  -ErrorAction SilentlyContinue

Write-Host "================================================" -ForegroundColor Green
Write-Host "  Deploy completado exitosamente" -ForegroundColor Green
Write-Host "  ERP disponible en: http://${SSH_HOST}:3002" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
