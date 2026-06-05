# =============================================================================
#  migrar-stock.ps1  —  Migra productos de almacen.db al ERP
#  Ejecutar DESPUES de hacer deploy del nuevo codigo
# =============================================================================
$ERP_URL   = "http://10.1.1.10:3002"
$ALMACEN   = "S:\ALMACEN\almacen.db"
$USUARIO   = "admin"
$PASSWORD  = "eintra2026"
# =============================================================================

Write-Host "`n[1/4] Leyendo almacen.db..." -ForegroundColor Cyan

$pyScript = @'
import sqlite3, json, sys

conn = sqlite3.connect("S:/ALMACEN/almacen.db")
cur  = conn.cursor()

cur.execute("""
    SELECT
        p.codigo,
        p.descripcion,
        p.ubicacion,
        COALESCE(p.minimo, 0) as stock_minimo,
        ROUND(p.inicial + COALESCE(SUM(
            CASE
                WHEN m.tipo = 'entrada' THEN m.cantidad
                WHEN m.tipo = 'salida'  THEN -m.cantidad
                ELSE m.cantidad
            END
        ), 0), 4) as stock_actual
    FROM productos p
    LEFT JOIN movimientos m ON m.codigo_producto = p.codigo
    WHERE p.codigo != '' AND p.codigo IS NOT NULL
    GROUP BY p.codigo
    ORDER BY p.codigo
""")

productos = []
for r in cur.fetchall():
    productos.append({
        "codigo":      str(r[0]).strip(),
        "descripcion": str(r[1]).strip(),
        "ubicacion":   str(r[2] or "").strip(),
        "stock_minimo": float(r[3] or 0),
        "stock_actual": float(r[4] or 0),
        "categoria":   ""
    })

conn.close()
print(json.dumps(productos))
'@

$json = $pyScript | python3
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR leyendo almacen.db" -ForegroundColor Red; exit 1 }

$productos = $json | ConvertFrom-Json
Write-Host "      $($productos.Count) productos leidos" -ForegroundColor Green

# ── 2. Obtener token ────────────────────────────────────────────────────────────
Write-Host "[2/4] Autenticando en el ERP..." -ForegroundColor Cyan

$loginBody = @{ username = $USUARIO; password = $PASSWORD } | ConvertTo-Json
$loginResp = Invoke-RestMethod -Uri "$ERP_URL/api/v1/auth/login" -Method POST `
    -ContentType "application/json" -Body $loginBody
$token = $loginResp.token
Write-Host "      Autenticado como $USUARIO" -ForegroundColor Green

# ── 3. Migrar en lotes de 500 ──────────────────────────────────────────────────
Write-Host "[3/4] Importando productos al ERP (lotes de 500)..." -ForegroundColor Cyan

$headers  = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }
$total    = $productos.Count
$creados  = 0
$actualizados = 0
$lote     = 500

for ($i = 0; $i -lt $total; $i += $lote) {
    $fin   = [Math]::Min($i + $lote, $total)
    $batch = $productos[$i..($fin-1)]
    $body  = @{ productos = $batch } | ConvertTo-Json -Depth 5

    $resp = Invoke-RestMethod -Uri "$ERP_URL/api/v1/stock/migrar" -Method POST `
        -Headers $headers -Body $body

    $creados      += $resp.creados
    $actualizados += $resp.actualizados
    Write-Host "      Lote $([Math]::Floor($i/$lote)+1): $($resp.creados) creados, $($resp.actualizados) actualizados" -ForegroundColor Gray
}

# ── 4. Resultado ────────────────────────────────────────────────────────────────
Write-Host "[4/4] Migracion completada" -ForegroundColor Cyan
Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "  Productos creados:     $creados"               -ForegroundColor Green
Write-Host "  Productos actualizados: $actualizados"         -ForegroundColor Green
Write-Host "  Abrí http://10.1.1.10:3002/stock"             -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
