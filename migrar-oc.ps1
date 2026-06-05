# =============================================================================
#  migrar-oc.ps1  —  Importa Órdenes de Compra desde almacen.db SIN precios
#  Ejecutar desde la PC que tiene acceso a S:/ALMACEN/almacen.db
# =============================================================================
$ERP_URL  = "http://10.1.1.10:3002"
$ALMACEN  = "S:/ALMACEN/almacen.db"
$USUARIO  = "admin"
$PASSWORD = "eintra2026"
$LOTE     = 100
# =============================================================================

function Paso($n, $msg) { Write-Host "`n[$n] $msg" -ForegroundColor Cyan }
function OK($msg)        { Write-Host "    OK: $msg" -ForegroundColor Green }
function Info($msg)      { Write-Host "    $msg" -ForegroundColor Gray }
function Err($msg)       { Write-Host "    ERROR: $msg" -ForegroundColor Red }

# ── Leer OC desde almacen.db ──────────────────────────────────────────────────
Paso 1 "Leyendo OC desde almacen.db..."

$pyLeer = @'
import sqlite3, json, sys

conn = sqlite3.connect("S:/ALMACEN/almacen.db")
conn.text_factory = lambda b: b.decode("latin-1")
cur = conn.cursor()

# Descubrir tablas disponibles
cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
tablas = [r[0] for r in cur.fetchall()]

def cols(tabla):
    cur.execute(f"PRAGMA table_info({tabla})")
    return [r[1].lower() for r in cur.fetchall()]

def rows(sql, params=()):
    cur.execute(sql, params)
    c = [d[0] for d in cur.description]
    return [dict(zip(c, r)) for r in cur.fetchall()]

# Buscar tabla de cabeceras OC
oc_tabla = None
for candidato in ['ordenes_compra','oc_compras','oc','compras','ordenes']:
    if candidato in tablas:
        oc_tabla = candidato
        break

# Buscar tabla de items OC
items_tabla = None
for candidato in ['oc_items','oc_detalles','oc_lineas','oc_detalle','compras_items','oc_productos']:
    if candidato in tablas:
        items_tabla = candidato
        break

if not oc_tabla:
    # Reportar tablas para diagnóstico
    info = {"error": f"No se encontró tabla de OC. Tablas disponibles: {tablas}"}
    print(json.dumps(info))
    conn.close()
    sys.exit(0)

oc_cols   = cols(oc_tabla)
item_cols = cols(items_tabla) if items_tabla else []

# Mapear columna: buscar entre posibles nombres
def col(lista, *opciones):
    for o in opciones:
        if o in lista: return o
    return None

# Columnas de cabecera OC
c_num   = col(oc_cols, 'numero','nro','num','n_oc','oc_numero','id') or oc_cols[0]
c_fecha = col(oc_cols, 'fecha','fecha_oc','fecha_emision','fecha_creacion')
c_prov  = col(oc_cols, 'prov_nombre','proveedor','nombre_proveedor','prov','proveedor_nombre')
c_cuit  = col(oc_cols, 'prov_cuit','cuit','cuit_proveedor')
c_moneda= col(oc_cols, 'moneda')
c_tc    = col(oc_cols, 'tasa_cambio','tc','tipo_cambio')
c_cond  = col(oc_cols, 'cond_compra','condicion_pago','condicion','cond_pago')
c_lugar = col(oc_cols, 'lugar_entrega','lugar','entrega')
c_autor = col(oc_cols, 'autorizado_por','autoriza','autorizado')
c_elab  = col(oc_cols, 'elaborado_por','elabora','elaborado')
c_ppto  = col(oc_cols, 'presupuesto_n','presupuesto','ppto','nro_presupuesto')
c_oc_id = col(oc_cols, 'id')

# Columnas de items
if items_tabla:
    c_oc_ref  = col(item_cols, 'oc_id','orden_id','compra_id','id_oc','numero_oc','numero')
    c_item_n  = col(item_cols, 'item_num','item','nro_item','orden','numero_item')
    c_cant    = col(item_cols, 'cantidad','cant','qty')
    c_unidad  = col(item_cols, 'unidad','und','unid')
    c_desc    = col(item_cols, 'descripcion','detalle','nombre','producto','articulo')
    c_plazo   = col(item_cols, 'plazo')

# Leer OC
select_oc = f"SELECT * FROM {oc_tabla}"
ocs_raw = rows(select_oc)

# Leer items si existe la tabla
items_raw = rows(f"SELECT * FROM {items_tabla}") if items_tabla else []

# Agrupar items por oc
from collections import defaultdict
items_por_oc = defaultdict(list)
if items_tabla and c_oc_ref:
    for it in items_raw:
        ref = str(it.get(c_oc_ref,''))
        items_por_oc[ref].append(it)

# Construir lista de OC en el formato esperado por el ERP
ordenes = []
for oc in ocs_raw:
    oc_id_val = str(oc.get(c_oc_id,'')) if c_oc_id else ''
    oc_num    = str(oc.get(c_num,'')).strip().zfill(6) if c_num else ''

    items_oc = items_por_oc.get(oc_id_val, []) or items_por_oc.get(oc_num, [])

    items_fmt = []
    for i, it in enumerate(items_oc):
        items_fmt.append({
            "item_num":     i+1,
            "cantidad":     float(it.get(c_cant,0) or 0) if c_cant else 0,
            "unidad":       str(it.get(c_unidad,'UND.') or 'UND.') if c_unidad else 'UND.',
            "descripcion":  str(it.get(c_desc,'') or '') if c_desc else '',
            "precio_usd":   0,
            "bonif1":       0,
            "bonif2":       0,
            "bonif3":       0,
            "bonif4":       0,
            "precio_final": 0,
            "plazo":        str(it.get(c_plazo,'INMEDIATO') or 'INMEDIATO') if c_plazo else 'INMEDIATO',
        })

    ordenes.append({
        "numero":        oc_num,
        "fecha":         str(oc.get(c_fecha,'') or '')[:10] if c_fecha else '',
        "prov_nombre":   str(oc.get(c_prov,'') or '') if c_prov else '',
        "prov_cuit":     str(oc.get(c_cuit,'') or '') if c_cuit else '',
        "moneda":        str(oc.get(c_moneda,'DÓLAR') or 'DÓLAR') if c_moneda else 'DÓLAR',
        "tasa_cambio":   float(oc.get(c_tc,0) or 0) if c_tc else 0,
        "cond_compra":   str(oc.get(c_cond,'') or '') if c_cond else '',
        "lugar_entrega": str(oc.get(c_lugar,'') or '') if c_lugar else '',
        "autorizado_por":str(oc.get(c_autor,'') or '') if c_autor else '',
        "elaborado_por": str(oc.get(c_elab,'') or '') if c_elab else '',
        "presupuesto_n": str(oc.get(c_ppto,'') or '') if c_ppto else '',
        "items":         items_fmt,
    })

conn.close()
print(json.dumps({
    "oc_tabla":    oc_tabla,
    "items_tabla": items_tabla,
    "oc_cols":     oc_cols,
    "item_cols":   item_cols,
    "ordenes":     ordenes,
}, default=str))
'@

$jsonData = $pyLeer | python3
if ($LASTEXITCODE -ne 0) { Err "Error ejecutando Python"; exit 1 }
$data = $jsonData | ConvertFrom-Json

# Verificar si hubo error de descubrimiento
if ($data.PSObject.Properties['error']) {
    Err $data.error
    exit 1
}

Info "Tabla OC encontrada:    $($data.oc_tabla)"
Info "Tabla items encontrada: $(if ($data.items_tabla) { $data.items_tabla } else { '(ninguna)' })"
Info "Columnas OC:   $($data.oc_cols -join ', ')"
if ($data.items_tabla) { Info "Columnas items: $($data.item_cols -join ', ')" }
Info "OC leídas: $($data.ordenes.Count)"

if ($data.ordenes.Count -eq 0) {
    Err "No se encontraron órdenes de compra. Verificar tabla: $($data.oc_tabla)"
    exit 1
}

# Confirmar antes de importar
Write-Host ""
$confirmar = Read-Host "    ¿Importar $($data.ordenes.Count) OC sin precios? (s/N)"
if ($confirmar -notmatch '^[sS]$') { Write-Host "    Cancelado." -ForegroundColor Yellow; exit 0 }

# ── Autenticar ────────────────────────────────────────────────────────────────
Paso 2 "Autenticando..."
$loginBody = @{ username=$USUARIO; password=$PASSWORD } | ConvertTo-Json
$token = (Invoke-RestMethod -Uri "$ERP_URL/api/v1/auth/login" -Method POST -ContentType "application/json" -Body $loginBody).token
$H = @{ Authorization="Bearer $token"; "Content-Type"="application/json" }
OK "Token obtenido"

# ── Importar en lotes ─────────────────────────────────────────────────────────
Paso 3 "Importando OC en lotes de $LOTE..."
$total   = $data.ordenes.Count
$creadas = 0
$errores = 0

for ($i = 0; $i -lt $total; $i += $LOTE) {
    $fin   = [Math]::Min($i + $LOTE, $total)
    $loteOC = $data.ordenes[$i..($fin-1)]
    $body  = @{ proveedores=@(); ordenes_compra=$loteOC } | ConvertTo-Json -Depth 15 -Compress
    try {
        $resp    = Invoke-RestMethod -Uri "$ERP_URL/api/v1/compras/migrar" -Method POST -Headers $H -Body $body
        $creadas += [int]$resp.ocCreadas
        Info "Lote $([Math]::Floor($i/$LOTE)+1)/$([Math]::Ceiling($total/$LOTE)): $($resp.ocCreadas) creadas, $($resp.itemsCreados) ítems"
    } catch {
        $errores++
        Err "Lote $([Math]::Floor($i/$LOTE)+1) falló: $_"
    }
}

# ── Resumen ───────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "  OC importadas: $creadas / $total"              -ForegroundColor Green
if ($errores -gt 0) { Write-Host "  Lotes con error: $errores" -ForegroundColor Yellow }
Write-Host "  Abrí: http://10.1.1.10:3002/compras"           -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
