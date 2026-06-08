-- =================================================================
-- MÓDULO DE MANTENIMIENTO - eintra-erp
-- Fuente: Form 14 rev 0 (Plan 2026, hojas de detalle 2020-2026)
-- 157 equipos · 116 tareas preventivas · 100 registros históricos
-- =================================================================

PRAGMA foreign_keys = ON;

-- ─────────────────────────────────────────────────────────────────
-- TABLA 1: equipos
-- Inventario maestro de máquinas y herramientas
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mant_equipos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo        TEXT NOT NULL UNIQUE,        -- EQ-001, EQ-300, etc.
  nombre        TEXT NOT NULL,
  categoria     TEXT NOT NULL,               -- Torno, Soldadora, Tablero eléctrico...
  marca         TEXT,
  modelo        TEXT,
  nro_serie     TEXT,
  ubicacion     TEXT,                        -- MIGUENS | POGGIO
  estado        TEXT NOT NULL DEFAULT 'activo',  -- activo | baja | en_reparacion
  fecha_baja    DATE,
  motivo_baja   TEXT,
  observaciones TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ─────────────────────────────────────────────────────────────────
-- TABLA 2: tareas_preventivas
-- Plan de mantenimiento preventivo por equipo
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mant_tareas_preventivas (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  equipo_id       INTEGER NOT NULL REFERENCES mant_equipos(id) ON DELETE CASCADE,
  componente      TEXT NOT NULL,             -- Caja Norton, Correas, Tablero eléctrico...
  accion          TEXT NOT NULL,             -- Verificar nivel, Limpieza general...
  tipo            TEXT NOT NULL,             -- V=Verificación L=Limpieza A=Ajuste M=Mantenimiento
  frecuencia      TEXT NOT NULL,             -- Mensual|Cuatrimestral|Bimestral|Anual|Luego de c/uso
  frecuencia_dias INTEGER,                   -- Calculado: 30|120|60|365|0
  activa          INTEGER NOT NULL DEFAULT 1
);

-- ─────────────────────────────────────────────────────────────────
-- TABLA 3: ejecuciones_preventivas
-- Registro de cada vez que se ejecuta una tarea preventiva
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mant_ejecuciones_preventivas (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tarea_id        INTEGER NOT NULL REFERENCES mant_tareas_preventivas(id),
  equipo_id       INTEGER NOT NULL REFERENCES mant_equipos(id),
  fecha           DATE NOT NULL,
  resultado       TEXT NOT NULL,             -- OK | NOK | Cuarentena
  observaciones   TEXT,
  responsable     TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ─────────────────────────────────────────────────────────────────
-- TABLA 4: intervenciones_correctivas
-- Registro de reparaciones no planificadas por falla
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mant_intervenciones_correctivas (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  equipo_id       INTEGER NOT NULL REFERENCES mant_equipos(id),
  fecha_deteccion DATE NOT NULL,
  fecha_inicio    DATE,
  fecha_fin       DATE,
  descripcion_falla TEXT NOT NULL,
  accion_realizada  TEXT,
  tipo_servicio   TEXT NOT NULL DEFAULT 'interno',  -- interno | externo
  proveedor       TEXT,                      -- si es externo
  costo           REAL,
  repuestos_usados TEXT,
  resultado       TEXT,                      -- resuelto | derivado_baja | pendiente
  responsable     TEXT,
  observaciones   TEXT,
  nc_id           INTEGER,                   -- FK a no_conformidades si corresponde
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ─────────────────────────────────────────────────────────────────
-- TABLA 5: inspecciones_periodicas
-- Rondas de inspección del estado general del equipo
-- (equivalente a las hojas de detalle del Form 14: estado + ubicación + fecha)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mant_inspecciones (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  equipo_id       INTEGER NOT NULL REFERENCES mant_equipos(id),
  fecha           DATE NOT NULL,
  estado_general  TEXT NOT NULL,             -- OK | NOK | requiere_atencion | en_reparacion
  ubicacion_verificada TEXT,
  etiqueta_ok     INTEGER DEFAULT 1,         -- 1=sí, 0=falta/rota
  observaciones   TEXT,
  responsable     TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ─────────────────────────────────────────────────────────────────
-- ÍNDICES
-- ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_mant_eq_codigo ON mant_equipos(codigo);
CREATE INDEX IF NOT EXISTS idx_mant_eq_estado ON mant_equipos(estado);
CREATE INDEX IF NOT EXISTS idx_mant_tp_equipo ON mant_tareas_preventivas(equipo_id);
CREATE INDEX IF NOT EXISTS idx_mant_ep_tarea  ON mant_ejecuciones_preventivas(tarea_id);
CREATE INDEX IF NOT EXISTS idx_mant_ep_fecha  ON mant_ejecuciones_preventivas(fecha);
CREATE INDEX IF NOT EXISTS idx_mant_ic_equipo ON mant_intervenciones_correctivas(equipo_id);
CREATE INDEX IF NOT EXISTS idx_mant_insp_equipo ON mant_inspecciones(equipo_id);

-- ─────────────────────────────────────────────────────────────────
-- VISTA: alertas de mantenimiento vencido
-- ─────────────────────────────────────────────────────────────────
CREATE VIEW IF NOT EXISTS v_mant_alertas AS
SELECT
  e.codigo,
  e.nombre,
  e.categoria,
  e.ubicacion,
  tp.componente,
  tp.accion,
  tp.frecuencia,
  tp.frecuencia_dias,
  MAX(ep.fecha) AS ultima_ejecucion,
  CASE
    WHEN tp.frecuencia = 'Luego de c/uso' THEN 'manual'
    WHEN MAX(ep.fecha) IS NULL THEN 'nunca_ejecutada'
    WHEN julianday('now') - julianday(MAX(ep.fecha)) > tp.frecuencia_dias THEN 'vencida'
    WHEN julianday('now') - julianday(MAX(ep.fecha)) > tp.frecuencia_dias * 0.8 THEN 'proxima'
    ELSE 'al_dia'
  END AS estado_alerta,
  CAST(julianday('now') - julianday(MAX(ep.fecha)) AS INTEGER) AS dias_desde_ultima
FROM mant_tareas_preventivas tp
JOIN mant_equipos e ON e.id = tp.equipo_id
LEFT JOIN mant_ejecuciones_preventivas ep ON ep.tarea_id = tp.id
WHERE e.estado = 'activo' AND tp.activa = 1
GROUP BY tp.id;

-- ─────────────────────────────────────────────────────────────────
-- VISTA: historial completo por equipo
-- ─────────────────────────────────────────────────────────────────
CREATE VIEW IF NOT EXISTS v_mant_historial_equipo AS
SELECT
  e.codigo, e.nombre, e.categoria,
  'preventiva' AS tipo,
  ep.fecha,
  tp.componente AS descripcion,
  tp.accion,
  ep.resultado AS estado,
  ep.observaciones,
  ep.responsable
FROM mant_ejecuciones_preventivas ep
JOIN mant_tareas_preventivas tp ON tp.id = ep.tarea_id
JOIN mant_equipos e ON e.id = ep.equipo_id
UNION ALL
SELECT
  e.codigo, e.nombre, e.categoria,
  'correctiva' AS tipo,
  ic.fecha_deteccion AS fecha,
  ic.descripcion_falla AS descripcion,
  ic.accion_realizada AS accion,
  ic.resultado AS estado,
  ic.observaciones,
  ic.responsable
FROM mant_intervenciones_correctivas ic
JOIN mant_equipos e ON e.id = ic.equipo_id
ORDER BY fecha DESC;

-- =================================================================
-- DATOS INICIALES - Inventario Form 14 rev 0 (157 equipos)
-- =================================================================

INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-001', 'TORNO CY', 'Torno', '110711717', 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-002', 'TORNO CASENEUVE', 'Torno', '307944', 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-003', 'PRENSA HIDRAULICA', 'Prensa', NULL, 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-004', 'CORTADORA SIN FIN SWIVEL 1', 'Cortadora', '5117695', NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-005', 'CORTADORA DELLE GRAZIE 1', 'Cortadora', '.083', 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-006', 'CORTADORA SIN FIN SWIVEL 2', 'Cortadora', 'Limpia', 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-007', 'COMPRESOR KAESER SM13', 'Compresor', '1173', 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-008', 'COMPRESOR KAESER ADS 60', 'Compresor', '1036', 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-009', 'GRANALLADORA CORBLAST', 'Granalladora', NULL, 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-010', 'GRANALLADORA BLASTING', 'Granalladora', '6900', 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-011', 'LAVADORA DE GRANALLA CORBLAST', 'Lavadora de granalla', '23030', 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-012', 'GRUPO ELECTROGENO 250KVA CRAN', 'Grupo electrógeno', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-013', 'EQUIPO DE ASPIRACION SALA DE GRANALLADO', 'Aspiración', '28403', 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-014', 'AUTOELEVADOR YALE', 'Autoelevador', '-', NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-015', 'AUTOELEVADOR HECHA', 'Autoelevador', '-', NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-016', 'SOLDADORA MERLE MEGAMATT 500', 'Soldadora', 'P4542', 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-017', 'SOLDADORA MERLE MEGA MIG 380', 'Soldadora', 'P4162', 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-018', 'SOLDADORA MERLE MEGA MIG 380', 'Soldadora', 'P4457', 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-019', 'SOLDADORA MERLE MEGAPLASMIG 50/300', 'Soldadora', 'N3825', 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-020', 'SOLDADORA MERLE MIG 390/4', 'Soldadora', '8110031', 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-021', 'SOLDADORA INVERTER LINCOLN V160', 'Soldadora', 'I2041000467', 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-022', 'SOLDADORA MERLE MIG 350/4', 'Soldadora', '7041048', 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-023', 'SOLDADOR MERLE MEGAMATIC 500', 'Soldadora', 'K4603', 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-024', 'SOLDADORA MERLE MEGAPLASMIG 50/300', 'Soldadora', 'L3428', 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-025', 'SOLDADORA MERLE ELECTRODO SPS 500', 'Soldadora', 'S4610', 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-026', 'SOLDADORA MIG DOGO', 'Soldadora', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-027', 'SOLDADORA INVERTER DE MANO ELECTRODO DOGO', 'Soldadora', 'Herramienta NO encontrada', 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-028', 'SOLDADORA INVERTER DE MANO ELECTRODO INTRAUD', 'Soldadora', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-029', 'SOLDADORA ELECTRICA ALTERNA 250 AMP', 'Soldadora', 'Herramienta NO encontrada', NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-030', 'SOLDADORA ELECTRICA ALTERNA 250 AMP', 'Soldadora', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-031', 'AGUJEREADORA DE BANCO BARBERO AB16', 'Taladro de banco', 'AEH000949', 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-032', 'FRESADORA DAVONIS', 'Fresadora', '4346/64', 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-033', 'AMOLADORA DE PIE 1', 'Amoladora', '91551S', 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-034', 'AMOLADORA DE PIE 2', 'Amoladora', NULL, 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-035', 'LIMADORA HUCE', 'Limadora', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-036', 'RECTIFICADORA', 'Rectificadora', '2816', 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-037', 'EQUIPO DE CORTE POR PLASMA HIPERTERM POWER MAX 45', 'Equipo de corte plasma', NULL, 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-038', 'EQUIPO DE CORTE POR PLASMA HIPERTERM POWER MAX 45', 'Equipo de corte plasma', '210516', 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-039', 'PUENTE GRUA  3TN', 'Puente grúa', NULL, 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-040', 'PUENTE GRUA 10TN', 'Puente grúa', NULL, 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-041', 'APAREJO ELECTRICO 1TN', 'Aparejo', '1108031', 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-042', 'APAREJO ELECTRICO 500KG', 'Aparejo', NULL, 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-043', 'APAREJO ELECTRICO 500KG', 'Aparejo', NULL, 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-044', 'APAREJO ELECTRICO 500KG', 'Aparejo', NULL, 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-045', 'MAQUINA DE PINTAR AIRLESS GRACO  60:1', 'Máquina de pintar', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-046', 'MAQUINA DE PINTAR AIRLESS GRACO NOVA 450', 'Máquina de pintar', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-047', 'MAQUINA DE PINTAR AIRLESS HASCO 60:1', 'Máquina de pintar', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-048', 'MAQUINA DE PINTAR AIRLESS HASCO 60:1', 'Máquina de pintar', NULL, 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-049', 'MAQUINA DE PINTAR AIRLESS VERITEC 48:1', 'Máquina de pintar', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-050', 'MAQUINA DE PINTAR AILES WAGNER 20:1', 'Máquina de pintar', NULL, 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-051', 'MAQUINA DE ROSCAR GAMA HASTA 2" Z1T-R2', 'Máquina de roscar', NULL, 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-052', 'MAQUINA DE ROSCAR GAMA HASTA 3"', 'Máquina de roscar', NULL, 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-053', 'CORTADORA SENSITIVA GOLDSTAR', 'Cortadora', '16836-9411', 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-054', 'CORTADORA SENSITIVA DEWALT', 'Cortadora', '.044827', 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-055', 'CORTADORA SENSITIVA PARA CORTE DE ALUMINIO', 'Cortadora', '.061572', 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-056', 'CORTADORA DE HIERRO MILWAUKEE', 'Cortadora', 'Herramienta NO encontrada', NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-057', 'CORTADORA DE HORMIGON HILTI', 'Cortadora', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-058', 'CORTADORA DELLE GRAZIE 2', 'Cortadora', '.077', 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-101', 'TALADRO INALAMBRICO MILWAUKEE  18V', 'Taladro', 'DPTO. ELECTRICO', NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-102', 'TALADRO INALAMBRICO MILWAUKEE  18V', 'Taladro', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-103', 'TALADRO INALAMBRICO MILWAUKEE  18V', 'Taladro', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-104', 'TALADRO INALAMBRICO DEWALT 18V', 'Taladro', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-106', 'TALADRO BOSCH GSB-20-2', 'Taladro', NULL, 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-107', 'TALADRO DEWALT DWD210G-A', 'Taladro', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-108', 'TALADRO DEWALT DWD210G-A', 'Taladro', NULL, 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-109', 'TALADRO BOSCH CSB-550-2', 'Taladro', '13470', 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-110', 'AMOLADORA BOSCH GWS-26-130-JBV', 'Amoladora', NULL, 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-111', 'AMOLADORA BOSCH  CORTA S/ET.', 'Amoladora', NULL, 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-112', 'AMOLADORA BOSCH  GWS- 11-125', 'Amoladora', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-113', 'AMOLADORA BOSCH  LARGA S/ET.', 'Amoladora', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-114', 'AMOLADORA METABO W8-115', 'Amoladora', NULL, 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-115', 'AMOLADORA MIKWAUKEE', 'Amoladora', NULL, 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-116', 'AMOLADORA MIKWAUKEE', 'Amoladora', NULL, 'POGGIO', 'baja');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-119', 'AMOLADORA STAYER', 'Amoladora', 'DPTO. ELECTRICO', NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-120', 'AMOLADORA DOWEN PIAGGIO', 'Amoladora', '2750', 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-121', 'CALADORA MAKITA', 'Caladora', '156901E', NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-122', 'CALADORA BOSCH', 'Caladora', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-123', 'SIERRA RECIPROCA MILWAUKEE', 'Sierra', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-124', 'SIERRA RECIPROCA DEWALT', 'Sierra', 'DPTO. ELECTRICO', NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-125', 'MINITORNO BOSCH', 'Minitorno', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-126', 'PISTOLA DE CALOR METABO', 'Herramienta', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-127', 'PISTOLA DE CALOR METABO', 'Herramienta', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-129', 'TALADRO MEZCLADOR ARGENTEC', 'Taladro', NULL, 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-130', 'REMACHADORA NEUMATICA M7 PA-301', 'Remachadora', '10041606', 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-131', 'TALADRO METABO SB E 13 R', 'Taladro', NULL, 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-132', 'REMACHADORA ROJA Y NEGRA', 'Remachadora', NULL, 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-133', 'REMACHADORA SANTIS', 'Remachadora', NULL, 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-134', 'TALADRO DE BANCO', 'Taladro', '16618', 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-135', 'TALADRO DE BANCO BARBERO', 'Taladro', 'AFK004495', 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-136', 'AMOLADORA DE BANCO', 'Amoladora', NULL, 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-137', 'SOLDADORA ESAB', 'Soldadora', NULL, 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-140', 'AMOLADORA NEUMÁTICA BREMEN', 'Amoladora', NULL, 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-141', 'APAREJO 500Kg ARMADO DE BOLUTA', 'Aparejo', NULL, 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-142', 'PRENSA HIDRAULICA MANUAL', 'Prensa', NULL, 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-144', 'TALADRO GSP550', 'Taladro', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-145', 'TALADRO BOSCH BSB2505', 'Taladro', '86600585', 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-146', 'PERCUTORA BOSCH GBH 2-24', 'Percutora', '13470', 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-147', 'PERCUTORA BOSCH GBH 2-24 SDR', 'Percutora', NULL, NULL, 'baja');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-148', 'TALADRO NEUMÁTICO BREMEN', 'Taladro', NULL, 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-149', 'TALADRO NEUMÁTICO BOSCH GBH 13-2', 'Taladro', NULL, 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-150', 'COMPRESOR KAESER 5Y6', 'Compresor', '1975', 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-151', 'APAREJO PLASMA', 'Aparejo', NULL, 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-152', 'TALADRO BOSCH 13-125', 'Taladro', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-153', 'TALADRO PSB550', 'Taladro', '86800031', 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-154', 'TALADRO A BATERIA DEWAL NUEVO', 'Taladro', '9695', NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-155', 'PLASMA HIPERTEN 45X5', 'Equipo de corte plasma', NULL, 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-156', 'AMOLADORA MILWAUKEE DE 115mm 4 1/2'''' GRIINDER', 'Amoladora', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-157', 'AMOLADORA MILWAUKEE DE 115mm 4 1/2'''' GRIINDER', 'Amoladora', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-158', 'LIJADORA ORBITAL STRINGRAY HOBBY', 'Lijadora', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-159', 'CORTADORA CIRCULAR PARA MADERA BOSCH SAW', 'Cortadora', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-160', 'AMOLADORA BOSCH GWS 10-125', 'Amoladora', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-161', 'APAREJO ELECTRICO 1TN DE GRANALLA', 'Aparejo', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-200', 'MEDIDOR DE ESPESORES SC116', 'Herramienta', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-201', 'PIROMETRO FLUKE 62 MINI', 'Herramienta', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-202', 'MEGOMETRO TES 1600', 'Herramienta', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-203', 'TELURIMETRO', 'Herramienta', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-204', 'AGUJEREADORA DE BANCO CONEXTUBE DRILL PRESS', 'Taladro de banco', 'ZJQ4116K', 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-210', 'MULTIMETRO KLEIN TOOLS MM300', 'Herramienta', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-211', 'MULTIMETRO HIOKI 3231', 'Herramienta', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-212', 'MULTIMETRO STRONGER EM890C', 'Herramienta', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-213', 'MULTIMETRO FLUKE 87', 'Herramienta', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-214', 'OSCILOSCOPIO KENWOOD CS-4025', 'Herramienta', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-215', 'OSCILOSCOPIO DF4320A', 'Herramienta', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-216', 'FUENTES TES 6102', 'Herramienta', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-250', 'MICROSCOPIO MEOPTA', 'Herramienta', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-251', 'ESPECTOFOTOMETRO HACH DR2700', 'Herramienta', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-252', 'HORNO HACH DRB200', 'Herramienta', NULL, NULL, 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-300', 'TABLERO ELÉCTRICO', 'Tablero eléctrico', 'NO funcionan la luz de la fase S', 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-301', 'TABLERO ELÉCTRICO', 'Tablero eléctrico', 'NO funcionan la luz de la fase S', 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-302', 'TABLERO ELÉCTRICO', 'Tablero eléctrico', NULL, 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-303', 'TABLERO ELÉCTRICO', 'Tablero eléctrico', NULL, 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-304', 'TABLERO ELÉCTRICO', 'Tablero eléctrico', NULL, 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-305', 'TABLERO ELÉCTRICO', 'Tablero eléctrico', NULL, 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-306', 'TABLERO ELÉCTRICO', 'Tablero eléctrico', 'NO Funcionan las luces de las 3 fases', 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-307', 'TABLERO ELÉCTRICO', 'Tablero eléctrico', NULL, 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-308', 'ALARGUE MONOFÁSICO', 'Alargue', 'NO encontrado', 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-309', 'ALARGUE TRIFÁSICO', 'Alargue', NULL, 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-310', 'ALARGUE TRIFÁSICO', 'Alargue', NULL, 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-311', 'TABLERO ELÉCTRICO', 'Tablero eléctrico', NULL, 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-312', 'TABLERO ELÉCTRICO', 'Tablero eléctrico', NULL, 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-313', 'TABLERO ELÉCTRICO', 'Tablero eléctrico', NULL, 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-314', 'TABLERO ELÉCTRICO', 'Tablero eléctrico', NULL, 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-315', 'TABLERO ELÉCTRICO', 'Tablero eléctrico', NULL, 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-316', 'TABLERO ELÉCTRICO', 'Tablero eléctrico', NULL, 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-317', 'ALARGUE MONOFÁSICO', 'Alargue', NULL, 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-318', 'ALARGUE MONOFÁSICO', 'Alargue', 'NO encontrado', 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-319', 'ALARGUE MONOFÁSICO', 'Alargue', NULL, 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-320', 'ALARGUE MONOFÁSICO', 'Alargue', NULL, 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-321', 'ALARGUE TRIFÁSICO', 'Alargue', 'NO encontrado', 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-322', 'ALARGUE TRIFÁSICO', 'Alargue', NULL, 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-323', 'ALARGUE TRIFÁSICO', 'Alargue', NULL, 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-324', 'ALARGUE TRIFÁSICO', 'Alargue', NULL, 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-325', 'ALARGUE MONOFÁSICO', 'Alargue', NULL, 'MIGUENS', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-326', 'ALARGUE TRIFÁSICO', 'Alargue', NULL, 'POGGIO', 'activo');
INSERT OR IGNORE INTO mant_equipos (codigo, nombre, categoria, nro_serie, ubicacion, estado) VALUES ('EQ-327', 'ALARGUE MONOFÁSICO', 'Alargue', NULL, 'POGGIO', 'activo');

-- TAREAS PREVENTIVAS (116 tareas del Plan 2026)

INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Correas', 'Control de tensión', 'V', 'Cuatrimestral', 120 FROM mant_equipos WHERE codigo='EQ-001';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Torno', 'Cambio de aceite', 'V', 'Cuatrimestral', 120 FROM mant_equipos WHERE codigo='EQ-001';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Caja Norton', 'Verificar nivel de aciete', 'V', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-001';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Caja de engranajes', 'Verificar nivel de aciete', 'V', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-001';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Caja automática', 'Verificar nivel de aciete', 'V', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-001';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Husillos', 'Verificar juego', 'V', 'Anual', 365 FROM mant_equipos WHERE codigo='EQ-001';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Contrapunta', 'Verificar alineación', 'V', 'Anual', 365 FROM mant_equipos WHERE codigo='EQ-001';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Torno', 'Limpieza general', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-001';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Freno de pie', 'verificar ajuste del mecanismo', 'V', 'Cuatrimestral', 120 FROM mant_equipos WHERE codigo='EQ-001';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Tablero eléctrico', 'Verificar funcionamiento de llaves y llave de emergencia', 'V', 'Cuatrimestral', 120 FROM mant_equipos WHERE codigo='EQ-001';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Correas', 'Control de tensión', 'V', 'Cuatrimestral', 120 FROM mant_equipos WHERE codigo='EQ-002';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Torno', 'Cambio de aceite', 'V', 'Cuatrimestral', 120 FROM mant_equipos WHERE codigo='EQ-002';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Caja Norton', 'Verificar nivel de aciete', 'V', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-002';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Caja de engranajes', 'Verificar nivel de aciete', 'V', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-002';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Caja automática', 'Verificar nivel de aciete', 'V', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-002';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Husillos', 'Verificar juego', 'V', 'Anual', 365 FROM mant_equipos WHERE codigo='EQ-002';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Contrapunta', 'Verificar alineación', 'V', 'Anual', 365 FROM mant_equipos WHERE codigo='EQ-002';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Torno', 'Limpieza general', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-002';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Freno de pie', 'verificar ajuste del mecanismo', 'V', 'Cuatrimestral', 120 FROM mant_equipos WHERE codigo='EQ-002';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Tablero eléctrico', 'Verificar funcionamiento de llaves y llave de emergencia', 'V', 'Cuatrimestral', 120 FROM mant_equipos WHERE codigo='EQ-002';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Tablero eléctrico', 'Verificar conexiones', 'V', 'Cuatrimestral', 120 FROM mant_equipos WHERE codigo='EQ-003';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Bomba hidráulica', 'Verificar funcionamiento', 'V', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-003';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Hoja de corte', 'Verificar filo', 'V', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-005';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Conexiones electricas', 'Verificar conexiones', 'V', 'Cuatrimestral', 120 FROM mant_equipos WHERE codigo='EQ-005';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Maquina', 'Limpieza general', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-005';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Hoja de corte', 'Verificar filo', 'V', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-006';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Conexiones electricas', 'Verificar conexiones', 'V', 'Cuatrimestral', 120 FROM mant_equipos WHERE codigo='EQ-006';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Maquina', 'Limpieza general', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-006';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Compresor', 'Verificación del estado de la pantalla', 'V', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-007';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Compresor', 'Verificación del estado de la pantalla', 'V', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-008';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Mangueras', 'Verificar estado', 'V', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-009';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Maquina', 'Verificar funcionamiento', 'V', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-009';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Mangueras', 'Verificar estado', 'V', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-010';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Maquina', 'Verificar funcionamiento', 'V', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-010';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Maquina', 'Verificar funcionamiento', 'V', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-011';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Verificar funcionamiento', 'V', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-012';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Horas de funcionamiento', 'Verificar en display', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-012';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Verificacion funcionamiento', 'V', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-013';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Filtros', 'Limpieza de filtros', 'L', 'Cuatrimestral', 120 FROM mant_equipos WHERE codigo='EQ-013';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'AUTOELEVADOR', 'Limpieza general', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-014';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'AUTOELEVADOR', 'Limpieza general', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-015';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-016';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-017';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-018';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-019';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-020';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-021';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-022';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-023';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-024';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-025';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'V', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-027';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-028';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'V', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-029';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-031';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-032';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-033';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-034';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-036';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-037';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'V', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-038';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-039';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-040';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-041';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-042';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-043';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-044';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza y prueba', 'L', 'Luego de c/uso', 0 FROM mant_equipos WHERE codigo='EQ-048';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza y prueba', 'L', 'Luego de c/uso', 0 FROM mant_equipos WHERE codigo='EQ-050';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza y prueba', 'L', 'Luego de c/uso', 0 FROM mant_equipos WHERE codigo='EQ-051';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza y prueba', 'L', 'Luego de c/uso', 0 FROM mant_equipos WHERE codigo='EQ-052';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Luego de c/uso', 0 FROM mant_equipos WHERE codigo='EQ-053';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Luego de c/uso', 0 FROM mant_equipos WHERE codigo='EQ-054';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-055';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'V', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-056';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Hoja de corte', 'Verificar filo', 'V', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-058';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Conexiones electricas', 'Verificar conexiones', 'V', 'Cuatrimestral', 120 FROM mant_equipos WHERE codigo='EQ-058';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Maquina', 'Limpieza general', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-058';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-102';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-106';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-107';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-108';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-109';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-120';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-121';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-122';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-123';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-125';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-127';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-129';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-130';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-131';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-132';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-133';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-134';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-135';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-136';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-140';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-141';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-142';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-145';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-146';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-148';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-149';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Compresor', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-150';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-151';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-153';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-154';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'V', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-155';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-156';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'V', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-157';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-158';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-159';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-160';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-161';
INSERT OR IGNORE INTO mant_tareas_preventivas (equipo_id, componente, accion, tipo, frecuencia, frecuencia_dias) SELECT id, 'Equipo', 'Limpieza general y sopleteado', 'L', 'Mensual', 30 FROM mant_equipos WHERE codigo='EQ-204';

-- INSPECCIONES HISTÓRICAS (100 registros de hojas de detalle 2024-2026)

INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-06-26', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-001';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-06-26', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-002';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-18', 'OK', 'MIGUENS', 0, 'OK -  falta etiqueta con numero' FROM mant_equipos WHERE codigo='EQ-003';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-22', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-005';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-11', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-007';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-11', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-008';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-06-04', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-009';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-06-05', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-010';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-06-05', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-011';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-06-04', 'OK', NULL, 1, 'OK' FROM mant_equipos WHERE codigo='EQ-012';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-11', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-013';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-06', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-016';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-27', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-017';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-06', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-018';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-27', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-019';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-27', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-020';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-06', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-021';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-06', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-023';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-12', 'OK', 'POGGIO', 1, 'OK - Se realizo un arreglo de puente de diodos' FROM mant_equipos WHERE codigo='EQ-024';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-18', 'OK', NULL, 1, 'OK' FROM mant_equipos WHERE codigo='EQ-028';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-18', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-031';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-18', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-032';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-18', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-033';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-18', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-034';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-18', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-036';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-06-05', 'OK', 'POGGIO', 1, 'OK -  Se cambió el cable de masa' FROM mant_equipos WHERE codigo='EQ-037';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-18', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-038';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-22', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-039';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-22', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-040';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-22', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-041';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-22', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-042';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-22', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-043';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-22', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-044';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-25', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-048';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-25', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-050';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-27', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-051';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-27', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-052';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-18', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-053';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-18', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-054';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-18', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-055';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-22', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-058';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-18', 'OK', NULL, 1, 'OK' FROM mant_equipos WHERE codigo='EQ-102';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-18', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-106';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-12', 'OK', NULL, 1, 'OK' FROM mant_equipos WHERE codigo='EQ-107';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-18', 'OK', 'MIGUENS', 0, 'OK - Falta etiqueta con numero' FROM mant_equipos WHERE codigo='EQ-108';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-22', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-109';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-22', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-110';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-22', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-111';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-28', 'requiere_atencion', 'MIGUENS', 1, 'En reparación por cambio de pulsador (a la espera de respuesto)' FROM mant_equipos WHERE codigo='EQ-114';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-28', 'NOK', 'POGGIO', 1, 'Colector quemado y falta de carbones (dada de baja)' FROM mant_equipos WHERE codigo='EQ-116';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-18', 'OK', 'MIGUENS', 0, 'OK - Falta etiqueta con numero' FROM mant_equipos WHERE codigo='EQ-120';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-12', 'OK', NULL, 1, 'OK' FROM mant_equipos WHERE codigo='EQ-121';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-12', 'OK', NULL, 1, 'OK' FROM mant_equipos WHERE codigo='EQ-122';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-22', 'OK', NULL, 1, 'OK' FROM mant_equipos WHERE codigo='EQ-123';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-12', 'OK', NULL, 1, 'OK' FROM mant_equipos WHERE codigo='EQ-125';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-12', 'OK', NULL, 1, 'OK' FROM mant_equipos WHERE codigo='EQ-127';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-22', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-129';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-22', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-130';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-22', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-131';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-22', 'OK', 'POGGIO', 0, 'OK - Etiquta con nuemro rota' FROM mant_equipos WHERE codigo='EQ-132';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-22', 'requiere_atencion', 'POGGIO', 1, 'Limpia - Pierde aceite hidráulico (a revisar)' FROM mant_equipos WHERE codigo='EQ-133';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-22', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-134';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-22', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-135';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-22', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-136';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-22', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-140';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-22', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-141';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-18', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-142';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-18', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-145';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-12', 'OK', 'MIGUENS', 1, 'OK - Cambio de la ficha macho' FROM mant_equipos WHERE codigo='EQ-146';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-12', 'NOK', NULL, 1, 'El mandril no sujeta bien la mecha (dada de baja)' FROM mant_equipos WHERE codigo='EQ-147';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-22', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-148';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-22', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-149';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-11', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-150';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-28', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-151';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-18', 'OK', 'MIGUENS', 0, 'OK - Falta etiqueta con numero' FROM mant_equipos WHERE codigo='EQ-153';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-18', 'OK', NULL, 1, 'OK' FROM mant_equipos WHERE codigo='EQ-154';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-06', 'OK', 'MIGUENS', 0, 'OK - Falta etiqueta con numero' FROM mant_equipos WHERE codigo='EQ-155';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-18', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-204';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-28', 'OK', 'MIGUENS', 1, 'Reubicado en la nueva zona del taller de Miguens - OK' FROM mant_equipos WHERE codigo='EQ-302';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-28', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-303';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-28', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-304';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-19', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-305';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-28', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-307';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-19', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-309';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-19', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-310';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-19', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-311';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-19', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-312';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-19', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-313';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-19', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-314';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-19', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-315';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-19', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-316';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-19', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-317';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-22', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-319';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-22', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-320';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-22', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-322';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-22', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-323';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-22', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-324';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-28', 'OK', 'MIGUENS', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-325';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-28', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-326';
INSERT OR IGNORE INTO mant_inspecciones (equipo_id, fecha, estado_general, ubicacion_verificada, etiqueta_ok, observaciones) SELECT id, '2025-08-18', 'OK', 'POGGIO', 1, 'OK' FROM mant_equipos WHERE codigo='EQ-327';