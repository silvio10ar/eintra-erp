# =============================================================================
#  migrar-todo.ps1  —  Migra TODA la base almacen.db al ERP
#  Ejecutar una sola vez despues de hacer deploy
# =============================================================================
$ERP_URL  = "http://10.1.1.10:3002"
$ALMACEN  = "S:/ALMACEN/almacen.db"
$USUARIO  = "admin"
$PASSWORD = "eintra2026"
$LOTE     = 300
# =============================================================================

function Paso($n, $msg) { Write-Host "`n[$n/7] $msg" -ForegroundColor Cyan }
function OK($msg)        { Write-Host "      OK: $msg" -ForegroundColor Green }
function Info($msg)      { Write-Host "      $msg" -ForegroundColor Gray }

# ── Leer toda la base de datos ────────────────────────────────────────────────
Paso 1 "Leyendo almacen.db..."

$pyLeer = @'
import sqlite3, json, sys

conn = sqlite3.connect("S:/ALMACEN/almacen.db")
conn.text_factory = lambda b: b.decode("latin-1")  # manejo de encoding
cur  = conn.cursor()

def rows(sql, params=()):
    cur.execute(sql, params)
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, r)) for r in cur.fetchall()]

# Productos con stock calculado
productos = rows("""
    SELECT p.codigo, p.descripcion, COALESCE(p.ubicacion,'') as ubicacion,
           COALESCE(p.minimo,0) as stock_minimo,
           ROUND(p.inicial + COALESCE(SUM(
               CASE WHEN m.tipo='entrada' THEN m.cantidad
                    WHEN m.tipo='salida'  THEN -m.cantidad
                    ELSE m.cantidad END),0),4) as stock_actual,
           '' as categoria
    FROM productos p
    LEFT JOIN movimientos m ON m.codigo_producto=p.codigo
    WHERE p.codigo IS NOT NULL AND trim(p.codigo)!=''
    GROUP BY p.codigo
""")

# Movimientos historicos
movimientos = rows("""
    SELECT m.codigo_producto, m.tipo, m.cantidad, m.fecha,
           COALESCE(m.observacion,'') as observaciones,
           COALESCE(m.proveedor,'')   as proveedor,
           COALESCE(m.precio_unitario,0) as precio_unit,
           COALESCE(m.proyecto,'')    as proyecto,
           COALESCE(m.cliente_interno,'') as cliente_interno
    FROM movimientos m
    WHERE m.codigo_producto IS NOT NULL AND trim(m.codigo_producto)!=''
""")

# Proveedores (sin OCs)
proveedores = rows("SELECT * FROM oc_proveedores")

# Proyectos
proyectos = rows("SELECT id as id_original, nombre, cliente, descripcion, fecha_inicio, fecha_fin, estado, presupuesto FROM proyectos")

conn.close()

print(json.dumps({
    "productos":   productos,
    "movimientos": movimientos,
    "proveedores": proveedores,
    "proyectos":   proyectos
}, default=str))
'@

$jsonData = $pyLeer | python3
if ($LASTEXITCODE -ne 0) { Write-Host "ERROR leyendo almacen.db" -ForegroundColor Red; exit 1 }
$data = $jsonData | ConvertFrom-Json

Info "Productos:   $($data.productos.Count)"
Info "Movimientos: $($data.movimientos.Count)"
Info "Proveedores: $($data.proveedores.Count)"
Info "Proyectos:   $($data.proyectos.Count)"

# ── Autenticar ────────────────────────────────────────────────────────────────
Paso 2 "Autenticando..."
$loginBody = @{ username=$USUARIO; password=$PASSWORD } | ConvertTo-Json
$token = (Invoke-RestMethod -Uri "$ERP_URL/api/v1/auth/login" -Method POST -ContentType "application/json" -Body $loginBody).token
$H = @{ Authorization="Bearer $token"; "Content-Type"="application/json" }
OK "Token obtenido"

# ── Funcion de lote ───────────────────────────────────────────────────────────
function Enviar($url, $clave, $items, $loteSize) {
    $total = $items.Count; $creados = 0; $actu = 0
    for ($i=0; $i -lt $total; $i += $loteSize) {
        $fin   = [Math]::Min($i+$loteSize, $total)
        $batch = $items[$i..($fin-1)]
        $body  = @{$clave=$batch} | ConvertTo-Json -Depth 10 -Compress
        $resp  = Invoke-RestMethod -Uri $url -Method POST -Headers $H -Body $body
        $c = if ($null -ne $resp.creados) { $resp.creados } elseif ($null -ne $resp.importados) { $resp.importados } else { 0 }
        $a = if ($null -ne $resp.actualizados) { $resp.actualizados } else { 0 }
        $creados += [int]$c
        $actu    += [int]$a
        Write-Host "      Lote $([Math]::Floor($i/$loteSize)+1)/$([Math]::Ceiling($total/$loteSize)): OK" -ForegroundColor Gray
    }
    return @{ creados=$creados; actualizados=$actu }
}

# ── 1. Productos ──────────────────────────────────────────────────────────────
Paso 3 "Importando productos..."
$r = Enviar "$ERP_URL/api/v1/stock/migrar" "productos" $data.productos $LOTE
OK "Creados: $($r.creados)  Actualizados: $($r.actualizados)"

# ── 2. Movimientos ────────────────────────────────────────────────────────────
Paso 4 "Importando historial de movimientos..."
$r = Enviar "$ERP_URL/api/v1/stock/migrar-movimientos" "movimientos" $data.movimientos $LOTE
OK "Importados: $($r.creados)  Sin producto: $($r.actualizados)"

# ── 3. Proveedores ────────────────────────────────────────────────────────────
Paso 5 "Importando proveedores..."
$body = @{ proveedores=$data.proveedores; ordenes_compra=@() } | ConvertTo-Json -Depth 5 -Compress
$resp = Invoke-RestMethod -Uri "$ERP_URL/api/v1/compras/migrar" -Method POST -Headers $H -Body $body
OK "Proveedores creados: $($resp.provCreados)"

# ── 4. Proyectos ──────────────────────────────────────────────────────────────
Paso 6 "Importando proyectos..."
$r = Enviar "$ERP_URL/api/v1/proyectos/migrar" "proyectos" $data.proyectos $LOTE
OK "Creados: $($r.creados)"

# ── Resumen ───────────────────────────────────────────────────────────────────
Paso 7 "Migracion completada"
Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "  Migracion exitosa desde almacen.db"           -ForegroundColor Green
Write-Host "  Abrí: http://10.1.1.10:3002/stock"            -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
