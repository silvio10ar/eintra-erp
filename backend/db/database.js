const Database = require('better-sqlite3');
const path = require('path');
const fs   = require('fs');
if (!process.env.NODE_ENV) require('dotenv').config();

const rawPath = process.env.DB_PATH || './db/eintra_erp.db';
const dbPath  = path.isAbsolute(rawPath) ? rawPath : path.resolve(__dirname, '..', rawPath);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function inicializar() {
  db.exec(`
    -- ── Auth ─────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS usuarios (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT UNIQUE NOT NULL,
      nombre        TEXT NOT NULL,
      email         TEXT,
      password_hash TEXT NOT NULL,
      rol           TEXT NOT NULL DEFAULT 'solo_lectura',
      activo        INTEGER DEFAULT 1,
      created_at    TEXT DEFAULT (datetime('now','localtime'))
    );

    -- ── Stock ────────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS productos (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo        TEXT UNIQUE NOT NULL,
      descripcion   TEXT NOT NULL,
      categoria     TEXT DEFAULT '',
      unidad        TEXT DEFAULT 'UND.',
      stock_actual  REAL DEFAULT 0,
      stock_minimo  REAL DEFAULT 0,
      ubicacion     TEXT DEFAULT '',
      precio_costo  REAL DEFAULT 0,
      precio_venta  REAL DEFAULT 0,
      activo        INTEGER DEFAULT 1,
      updated_at    TEXT DEFAULT (datetime('now','localtime')),
      created_at    TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS movimientos_stock (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      producto_id  INTEGER NOT NULL REFERENCES productos(id),
      tipo         TEXT NOT NULL CHECK(tipo IN ('entrada','salida','devolucion','ajuste')),
      cantidad     REAL NOT NULL,
      fecha        TEXT NOT NULL,
      referencia   TEXT DEFAULT '',
      tipo_doc     TEXT DEFAULT '',
      doc_id       INTEGER,
      precio_unit  REAL DEFAULT 0,
      observaciones TEXT DEFAULT '',
      created_by   INTEGER REFERENCES usuarios(id),
      created_at   TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_mov_producto ON movimientos_stock(producto_id);
    CREATE INDEX IF NOT EXISTS idx_mov_fecha    ON movimientos_stock(fecha);

    -- ── Proveedores ───────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS proveedores (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo         TEXT DEFAULT '',
      nombre         TEXT UNIQUE NOT NULL,
      cuit           TEXT DEFAULT '',
      contacto       TEXT DEFAULT '',
      telefono       TEXT DEFAULT '',
      email          TEXT DEFAULT '',
      direccion      TEXT DEFAULT '',
      localidad      TEXT DEFAULT '',
      cp             TEXT DEFAULT '',
      vendedor       TEXT DEFAULT '',
      condicion_pago TEXT DEFAULT 'TRANSF. BANCARIA',
      activo         INTEGER DEFAULT 1,
      created_at     TEXT DEFAULT (datetime('now','localtime'))
    );

    -- ── Clientes ──────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS clientes (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo         TEXT DEFAULT '',
      nombre         TEXT UNIQUE NOT NULL,
      cuit           TEXT DEFAULT '',
      contacto       TEXT DEFAULT '',
      telefono       TEXT DEFAULT '',
      email          TEXT DEFAULT '',
      direccion      TEXT DEFAULT '',
      localidad      TEXT DEFAULT '',
      cp             TEXT DEFAULT '',
      condicion_pago TEXT DEFAULT '',
      activo         INTEGER DEFAULT 1,
      created_at     TEXT DEFAULT (datetime('now','localtime'))
    );

    -- ── Órdenes de Compra ─────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS ordenes_compra (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      numero         TEXT UNIQUE NOT NULL,
      fecha          TEXT DEFAULT '',
      proveedor_id   INTEGER REFERENCES proveedores(id),
      proveedor_nombre TEXT DEFAULT '',
      proveedor_cuit TEXT DEFAULT '',
      estado         TEXT DEFAULT 'Emitida' CHECK(estado IN ('Emitida','Parcial','Recibida','Cancelada')),
      moneda         TEXT DEFAULT 'DÓLAR',
      tasa_cambio    REAL DEFAULT 0,
      autorizado_por TEXT DEFAULT '',
      elaborado_por  TEXT DEFAULT '',
      condicion_pago TEXT DEFAULT 'TRANSF. BANCARIA',
      lugar_entrega  TEXT DEFAULT 'e-intra',
      presupuesto_n  TEXT DEFAULT '',
      observaciones  TEXT DEFAULT '',
      created_by     INTEGER REFERENCES usuarios(id),
      created_at     TEXT DEFAULT (datetime('now','localtime')),
      updated_at     TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS oc_items (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      oc_id            INTEGER NOT NULL REFERENCES ordenes_compra(id),
      item_num         INTEGER NOT NULL,
      producto_id      INTEGER REFERENCES productos(id),
      cantidad         REAL DEFAULT 0,
      unidad           TEXT DEFAULT 'UND.',
      descripcion      TEXT DEFAULT '',
      precio_unitario  REAL DEFAULT 0,
      bonif1           REAL DEFAULT 0,
      bonif2           REAL DEFAULT 0,
      bonif3           REAL DEFAULT 0,
      bonif4           REAL DEFAULT 0,
      precio_final     REAL DEFAULT 0,
      plazo            TEXT DEFAULT 'INMEDIATO',
      cant_recibida    REAL DEFAULT 0
    );

    -- ── Presupuestos (Ventas) ─────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS presupuestos (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      numero         TEXT UNIQUE NOT NULL,
      fecha          TEXT DEFAULT '',
      validez        TEXT DEFAULT '30 días',
      cliente_id     INTEGER REFERENCES clientes(id),
      cli_nombre     TEXT DEFAULT '',
      cli_cuit       TEXT DEFAULT '',
      cli_contacto   TEXT DEFAULT '',
      cli_telefono   TEXT DEFAULT '',
      cli_email      TEXT DEFAULT '',
      cli_direccion  TEXT DEFAULT '',
      cli_localidad  TEXT DEFAULT '',
      estado         TEXT DEFAULT 'Borrador' CHECK(estado IN ('Borrador','Enviado','Aprobado','Rechazado','Facturado')),
      moneda         TEXT DEFAULT 'DÓLAR',
      tasa_cambio    REAL DEFAULT 0,
      condicion_pago TEXT DEFAULT 'TRANSFERENCIA BANCARIA',
      lugar_entrega  TEXT DEFAULT 'E-INTRA',
      elaborado_por  TEXT DEFAULT '',
      observaciones  TEXT DEFAULT '',
      proyecto_id    INTEGER REFERENCES proyectos(id),
      created_by     INTEGER REFERENCES usuarios(id),
      created_at     TEXT DEFAULT (datetime('now','localtime')),
      updated_at     TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS presupuesto_items (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      presupuesto_id  INTEGER NOT NULL REFERENCES presupuestos(id),
      item_num        INTEGER NOT NULL,
      cantidad        REAL DEFAULT 0,
      unidad          TEXT DEFAULT 'UND.',
      descripcion     TEXT DEFAULT '',
      precio_unitario REAL DEFAULT 0,
      bonif1          REAL DEFAULT 0,
      bonif2          REAL DEFAULT 0,
      bonif3          REAL DEFAULT 0,
      bonif4          REAL DEFAULT 0,
      precio_final    REAL DEFAULT 0,
      plazo           TEXT DEFAULT 'A CONVENIR'
    );

    -- ── Proyectos ─────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS proyectos (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo           TEXT UNIQUE NOT NULL,
      nombre           TEXT NOT NULL,
      cliente_id       INTEGER REFERENCES clientes(id),
      cliente_nombre   TEXT DEFAULT '',
      descripcion      TEXT DEFAULT '',
      fecha_inicio     TEXT DEFAULT '',
      fecha_fin_est    TEXT DEFAULT '',
      fecha_cierre     TEXT DEFAULT '',
      estado           TEXT DEFAULT 'Activo' CHECK(estado IN ('Activo','En espera','Completado','Cancelado')),
      presupuesto_venta REAL DEFAULT 0,
      responsable      TEXT DEFAULT '',
      presupuesto_id   INTEGER REFERENCES presupuestos(id),
      created_by       INTEGER REFERENCES usuarios(id),
      created_at       TEXT DEFAULT (datetime('now','localtime')),
      updated_at       TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS proyecto_costos (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      proyecto_id  INTEGER NOT NULL REFERENCES proyectos(id),
      tipo         TEXT DEFAULT 'Material' CHECK(tipo IN ('Material','Mano de Obra','Servicio','Equipo','Otro')),
      descripcion  TEXT DEFAULT '',
      cantidad     REAL DEFAULT 1,
      precio_unit  REAL DEFAULT 0,
      total        REAL DEFAULT 0,
      fecha        TEXT DEFAULT '',
      origen       TEXT DEFAULT 'manual',
      origen_id    INTEGER,
      created_by   INTEGER REFERENCES usuarios(id),
      created_at   TEXT DEFAULT (datetime('now','localtime'))
    );

    -- ── Producción ────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS ordenes_trabajo (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      numero         TEXT UNIQUE NOT NULL,
      fecha_apertura TEXT DEFAULT '',
      fecha_inicio   TEXT DEFAULT '',
      fecha_fin_est  TEXT DEFAULT '',
      fecha_cierre   TEXT DEFAULT '',
      proyecto_id    INTEGER REFERENCES proyectos(id),
      proyecto_nombre TEXT DEFAULT '',
      descripcion    TEXT NOT NULL,
      responsable    TEXT DEFAULT '',
      estado         TEXT DEFAULT 'Pendiente' CHECK(estado IN ('Pendiente','En proceso','Pausada','Completada','Cancelada')),
      prioridad      TEXT DEFAULT 'Normal'    CHECK(prioridad IN ('Normal','Alta','Urgente')),
      observaciones  TEXT DEFAULT '',
      created_by     INTEGER REFERENCES usuarios(id),
      created_at     TEXT DEFAULT (datetime('now','localtime')),
      updated_at     TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS ot_tareas (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      ot_id            INTEGER NOT NULL REFERENCES ordenes_trabajo(id),
      orden            INTEGER DEFAULT 0,
      descripcion      TEXT DEFAULT '',
      responsable      TEXT DEFAULT '',
      estado           TEXT DEFAULT 'Pendiente',
      fecha_completado TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS ot_partes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      ot_id         INTEGER NOT NULL REFERENCES ordenes_trabajo(id),
      fecha         TEXT DEFAULT '',
      operario      TEXT DEFAULT '',
      horas         REAL DEFAULT 0,
      descripcion   TEXT DEFAULT '',
      observaciones TEXT DEFAULT ''
    );

    -- ── Finanzas ──────────────────────────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS cuentas_financieras (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre        TEXT UNIQUE NOT NULL,
      tipo          TEXT DEFAULT 'Caja',
      moneda        TEXT DEFAULT 'ARS',
      saldo_inicial REAL DEFAULT 0,
      activa        INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS categorias_financieras (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT UNIQUE NOT NULL,
      tipo   TEXT DEFAULT 'Egreso',
      color  TEXT DEFAULT '#6c7086'
    );

    CREATE TABLE IF NOT EXISTS movimientos_caja (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha         TEXT NOT NULL,
      tipo          TEXT NOT NULL CHECK(tipo IN ('Ingreso','Egreso')),
      categoria     TEXT DEFAULT '',
      descripcion   TEXT DEFAULT '',
      monto         REAL DEFAULT 0,
      moneda        TEXT DEFAULT 'ARS',
      tasa_cambio   REAL DEFAULT 1,
      cuenta_id     INTEGER REFERENCES cuentas_financieras(id),
      cuenta_nombre TEXT DEFAULT '',
      referencia    TEXT DEFAULT '',
      forma_pago    TEXT DEFAULT 'Transferencia',
      estado        TEXT DEFAULT 'Confirmado' CHECK(estado IN ('Confirmado','Pendiente','Anulado')),
      doc_tipo      TEXT DEFAULT '',
      doc_id        INTEGER,
      observaciones TEXT DEFAULT '',
      created_by    INTEGER REFERENCES usuarios(id),
      created_at    TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_mov_caja_fecha  ON movimientos_caja(fecha);
    CREATE INDEX IF NOT EXISTS idx_mov_caja_tipo   ON movimientos_caja(tipo);
    CREATE INDEX IF NOT EXISTS idx_ot_estado       ON ordenes_trabajo(estado);
    CREATE INDEX IF NOT EXISTS idx_proyectos_estado ON proyectos(estado);
    CREATE INDEX IF NOT EXISTS idx_ppto_estado     ON presupuestos(estado);
    CREATE INDEX IF NOT EXISTS idx_oc_estado       ON ordenes_compra(estado);
  `);

  // ── Columnas extra en movimientos_stock (idempotente) ────────────────────────
  ['proveedor','proyecto','cliente_interno'].forEach(col => {
    try { db.exec(`ALTER TABLE movimientos_stock ADD COLUMN ${col} TEXT DEFAULT ''`) } catch(e) {}
  });

  // ── Columna proveedor en productos (idempotente) ──────────────────────────────
  try { db.exec(`ALTER TABLE productos ADD COLUMN proveedor TEXT DEFAULT ''`) } catch(e) {}

  // ── SGC Compras: columnas extra (idempotente) ─────────────────────────────────
  try { db.exec(`ALTER TABLE proveedores ADD COLUMN critico INTEGER DEFAULT 0`) } catch(e) {}
  try { db.exec(`ALTER TABLE ordenes_compra ADD COLUMN fecha_entrega_est TEXT DEFAULT ''`) } catch(e) {}
  try { db.exec(`ALTER TABLE ordenes_compra ADD COLUMN numero_remito TEXT DEFAULT ''`) } catch(e) {}
  try { db.exec(`ALTER TABLE ordenes_compra ADD COLUMN fecha_recepcion TEXT DEFAULT ''`) } catch(e) {}

  // ── Form 17 — Seguimiento de Compras (idempotente) ───────────────────────────
  try { db.exec(`ALTER TABLE ordenes_compra ADD COLUMN estado_doc TEXT DEFAULT ''`) } catch(e) {}
  try { db.exec(`ALTER TABLE ordenes_compra ADD COLUMN nro_factura TEXT DEFAULT ''`) } catch(e) {}
  try { db.exec(`ALTER TABLE ordenes_compra ADD COLUMN importe_facturado REAL DEFAULT 0`) } catch(e) {}
  try { db.exec(`ALTER TABLE ordenes_compra ADD COLUMN fecha_vencimiento TEXT DEFAULT ''`) } catch(e) {}
  try { db.exec(`ALTER TABLE ordenes_compra ADD COLUMN pago_confirmado INTEGER DEFAULT 0`) } catch(e) {}
  try { db.exec(`ALTER TABLE oc_items ADD COLUMN estado_calidad TEXT DEFAULT ''`) } catch(e) {}
  try { db.exec(`ALTER TABLE oc_items ADD COLUMN estado_factura TEXT DEFAULT ''`) } catch(e) {}

  // ── Form 11 — Selección y Evaluación de Proveedores (idempotente) ────────────
  try { db.exec(`ALTER TABLE proveedores ADD COLUMN categoria_provision TEXT DEFAULT ''`) } catch(e) {}
  try { db.exec(`ALTER TABLE proveedores ADD COLUMN fecha_seleccion TEXT DEFAULT ''`) } catch(e) {}
  try { db.exec(`ALTER TABLE proveedores ADD COLUMN frecuencia_evaluacion TEXT DEFAULT 'Anual'`) } catch(e) {}
  try { db.exec(`ALTER TABLE proveedores ADD COLUMN responsable_seleccion TEXT DEFAULT ''`) } catch(e) {}
  try { db.exec(`ALTER TABLE proveedores ADD COLUMN responsable_evaluacion TEXT DEFAULT ''`) } catch(e) {}

  db.exec(`
    CREATE TABLE IF NOT EXISTS evaluaciones_proveedor (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      proveedor_id  INTEGER NOT NULL REFERENCES proveedores(id),
      tipo          TEXT NOT NULL CHECK(tipo IN ('seleccion','evaluacion')),
      anio          INTEGER NOT NULL,
      resultado     TEXT DEFAULT '',
      puntaje       REAL DEFAULT 0,
      fecha         TEXT DEFAULT '',
      observaciones TEXT DEFAULT '',
      created_by    INTEGER REFERENCES usuarios(id),
      created_at    TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS evaluacion_criterios (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      evaluacion_id INTEGER NOT NULL REFERENCES evaluaciones_proveedor(id) ON DELETE CASCADE,
      criterio      TEXT NOT NULL,
      puntaje       TEXT DEFAULT ''
    );
  `);

  // ── Form 49 — Ingreso sin OC/remito ───────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS form49_ingresos (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      numero           TEXT UNIQUE NOT NULL,
      fecha            TEXT DEFAULT '',
      proveedor_id     INTEGER REFERENCES proveedores(id),
      proveedor_nombre TEXT DEFAULT '',
      proyecto         TEXT DEFAULT '',
      autorizado_por   TEXT DEFAULT '',
      recibido_por     TEXT DEFAULT '',
      observaciones    TEXT DEFAULT '',
      created_by       INTEGER REFERENCES usuarios(id),
      created_at       TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS form49_items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      form49_id   INTEGER NOT NULL REFERENCES form49_ingresos(id) ON DELETE CASCADE,
      descripcion TEXT DEFAULT '',
      cantidad    REAL DEFAULT 0,
      unidad      TEXT DEFAULT 'UND.',
      n_parte     TEXT DEFAULT '',
      n_serie     TEXT DEFAULT '',
      n_lote      TEXT DEFAULT ''
    );
  `);

  // ── Mantenimiento ─────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS activos_mant (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo        TEXT UNIQUE NOT NULL,
      nombre        TEXT NOT NULL,
      tipo          TEXT DEFAULT 'Maquinaria',
      marca         TEXT DEFAULT '',
      modelo        TEXT DEFAULT '',
      n_serie       TEXT DEFAULT '',
      ubicacion     TEXT DEFAULT '',
      fecha_adq     TEXT DEFAULT '',
      estado        TEXT DEFAULT 'Activo',
      observaciones TEXT DEFAULT '',
      activo        INTEGER DEFAULT 1,
      created_at    TEXT DEFAULT (datetime('now','localtime')),
      updated_at    TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS mant_plan (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      activo_id     INTEGER REFERENCES activos_mant(id),
      activo_nombre TEXT DEFAULT '',
      descripcion   TEXT NOT NULL,
      frecuencia    TEXT DEFAULT 'Mensual',
      proxima_fecha TEXT DEFAULT '',
      ultima_fecha  TEXT DEFAULT '',
      activo        INTEGER DEFAULT 1,
      created_at    TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS mant_ot (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      numero          TEXT UNIQUE NOT NULL,
      activo_id       INTEGER REFERENCES activos_mant(id),
      activo_nombre   TEXT DEFAULT '',
      tipo            TEXT DEFAULT 'Correctivo',
      prioridad       TEXT DEFAULT 'Normal',
      estado          TEXT DEFAULT 'Pendiente',
      fecha_apertura  TEXT DEFAULT '',
      fecha_prog      TEXT DEFAULT '',
      fecha_cierre    TEXT DEFAULT '',
      descripcion     TEXT NOT NULL,
      ejecutor_tipo   TEXT DEFAULT 'interno',
      ejecutor_nombre TEXT DEFAULT '',
      observaciones   TEXT DEFAULT '',
      plan_id         INTEGER,
      created_by      INTEGER REFERENCES usuarios(id),
      created_at      TEXT DEFAULT (datetime('now','localtime')),
      updated_at      TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS mant_ot_tareas (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      ot_id           INTEGER NOT NULL REFERENCES mant_ot(id) ON DELETE CASCADE,
      orden           INTEGER DEFAULT 0,
      descripcion     TEXT DEFAULT '',
      estado          TEXT DEFAULT 'Pendiente',
      completado_por  TEXT DEFAULT '',
      fecha_comp      TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS mant_ot_costos (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ot_id       INTEGER NOT NULL REFERENCES mant_ot(id) ON DELETE CASCADE,
      tipo        TEXT DEFAULT 'Repuesto',
      descripcion TEXT DEFAULT '',
      cantidad    REAL DEFAULT 1,
      precio_unit REAL DEFAULT 0,
      total       REAL DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_mant_ot_estado  ON mant_ot(estado);
    CREATE INDEX IF NOT EXISTS idx_mant_ot_activo  ON mant_ot(activo_id);
  `);

  // ── Permisos directos de usuario ─────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS usuario_permisos (
      usuario_id     INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      modulo         TEXT    NOT NULL,
      puede_leer     INTEGER NOT NULL DEFAULT 0,
      puede_escribir INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (usuario_id, modulo)
    );
  `);

  // ── Mantenimiento (sistema de equipos e inspecciones) ─────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS mant_equipos (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo        TEXT UNIQUE NOT NULL,
      nombre        TEXT NOT NULL,
      categoria     TEXT DEFAULT '',
      marca         TEXT DEFAULT '',
      modelo        TEXT DEFAULT '',
      nro_serie     TEXT DEFAULT '',
      ubicacion     TEXT DEFAULT '',
      estado        TEXT NOT NULL DEFAULT 'activo' CHECK(estado IN ('activo','en_reparacion','baja')),
      fecha_baja    TEXT DEFAULT '',
      motivo_baja   TEXT DEFAULT '',
      observaciones TEXT DEFAULT '',
      created_at    TEXT DEFAULT (datetime('now','localtime')),
      updated_at    TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS mant_tareas_preventivas (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      equipo_id       INTEGER NOT NULL REFERENCES mant_equipos(id) ON DELETE CASCADE,
      componente      TEXT NOT NULL,
      accion          TEXT NOT NULL,
      tipo            TEXT DEFAULT '',
      frecuencia      TEXT DEFAULT 'Mensual',
      frecuencia_dias INTEGER DEFAULT 30,
      activa          INTEGER DEFAULT 1,
      created_at      TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS mant_ejecuciones_preventivas (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      tarea_id      INTEGER NOT NULL REFERENCES mant_tareas_preventivas(id) ON DELETE CASCADE,
      equipo_id     INTEGER NOT NULL REFERENCES mant_equipos(id),
      fecha         TEXT NOT NULL,
      resultado     TEXT DEFAULT 'OK' CHECK(resultado IN ('OK','NOK','Cuarentena')),
      observaciones TEXT DEFAULT '',
      responsable   TEXT DEFAULT '',
      created_at    TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS mant_intervenciones_correctivas (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      equipo_id         INTEGER NOT NULL REFERENCES mant_equipos(id),
      fecha_deteccion   TEXT NOT NULL,
      fecha_inicio      TEXT DEFAULT '',
      fecha_fin         TEXT DEFAULT '',
      descripcion_falla TEXT NOT NULL,
      accion_realizada  TEXT DEFAULT '',
      tipo_servicio     TEXT DEFAULT 'interno',
      proveedor         TEXT DEFAULT '',
      costo             REAL DEFAULT 0,
      repuestos_usados  TEXT DEFAULT '',
      resultado         TEXT DEFAULT 'pendiente',
      responsable       TEXT DEFAULT '',
      observaciones     TEXT DEFAULT '',
      created_at        TEXT DEFAULT (datetime('now','localtime')),
      updated_at        TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS mant_inspecciones (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      equipo_id            INTEGER NOT NULL REFERENCES mant_equipos(id),
      fecha                TEXT NOT NULL,
      estado_general       TEXT DEFAULT '',
      ubicacion_verificada TEXT DEFAULT '',
      etiqueta_ok          INTEGER DEFAULT 1,
      observaciones        TEXT DEFAULT '',
      responsable          TEXT DEFAULT '',
      created_at           TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS mant_historial_estados (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      equipo_id       INTEGER NOT NULL REFERENCES mant_equipos(id),
      fecha           TEXT NOT NULL DEFAULT (date('now')),
      estado_anterior TEXT DEFAULT '',
      estado_nuevo    TEXT NOT NULL,
      motivo          TEXT DEFAULT '',
      created_at      TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_mant_eq_estado   ON mant_equipos(estado);
  `);

  // ── RRHH (Recursos Humanos) ───────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS rrhh_empleados (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre     TEXT NOT NULL,
      tipo       TEXT NOT NULL DEFAULT 'interno' CHECK(tipo IN ('interno','contratista')),
      empresa    TEXT DEFAULT '',
      activo     INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS rrhh_categorias (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo      TEXT NOT NULL UNIQUE,
      descripcion TEXT NOT NULL,
      grupo       TEXT DEFAULT '',
      activo      INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS rrhh_proyectos (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre     TEXT NOT NULL UNIQUE,
      activo     INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS rrhh_registros (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha        TEXT NOT NULL,
      empleado_id  INTEGER NOT NULL REFERENCES rrhh_empleados(id),
      proyecto_id  INTEGER REFERENCES rrhh_proyectos(id),
      categoria_id INTEGER REFERENCES rrhh_categorias(id),
      hora_inicio  TEXT DEFAULT '',
      hora_fin     TEXT DEFAULT '',
      horas        REAL NOT NULL DEFAULT 0,
      modulo       TEXT DEFAULT '',
      descripcion  TEXT DEFAULT '',
      created_at   TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_rrhh_reg_fecha    ON rrhh_registros(fecha);
    CREATE INDEX IF NOT EXISTS idx_rrhh_reg_empleado ON rrhh_registros(empleado_id);
    CREATE INDEX IF NOT EXISTS idx_rrhh_reg_proyecto ON rrhh_registros(proyecto_id);

    CREATE INDEX IF NOT EXISTS idx_mant_tp_equipo   ON mant_tareas_preventivas(equipo_id);
    CREATE INDEX IF NOT EXISTS idx_mant_insp_equipo ON mant_inspecciones(equipo_id);
    CREATE INDEX IF NOT EXISTS idx_mant_insp_fecha  ON mant_inspecciones(fecha);
    CREATE INDEX IF NOT EXISTS idx_mant_hist_eq     ON mant_historial_estados(equipo_id);
  `);

  try {
    db.exec(`
      CREATE VIEW IF NOT EXISTS v_mant_historial_equipo AS
        SELECT e.codigo, 'inspeccion' AS tipo, i.fecha,
               i.estado_general AS estado, i.ubicacion_verificada AS ubicacion,
               i.etiqueta_ok, i.observaciones, i.responsable, i.id
        FROM mant_inspecciones i
        JOIN mant_equipos e ON e.id = i.equipo_id
        UNION ALL
        SELECT e.codigo, 'correctiva' AS tipo, ic.fecha_deteccion AS fecha,
               ic.resultado AS estado, NULL AS ubicacion,
               NULL AS etiqueta_ok, ic.descripcion_falla AS observaciones,
               ic.responsable, ic.id
        FROM mant_intervenciones_correctivas ic
        JOIN mant_equipos e ON e.id = ic.equipo_id
    `);
  } catch(e) {}

  // ── Poblar historial de estados desde bajas existentes (idempotente) ─────────
  try {
    db.exec(`
      INSERT INTO mant_historial_estados (equipo_id, fecha, estado_anterior, estado_nuevo, motivo)
      SELECT ic.equipo_id, ic.fecha_deteccion, 'activo', 'baja', ic.descripcion_falla
      FROM mant_intervenciones_correctivas ic
      WHERE ic.resultado = 'baja_definitiva'
      AND NOT EXISTS (
        SELECT 1 FROM mant_historial_estados hs
        WHERE hs.equipo_id = ic.equipo_id AND hs.estado_nuevo = 'baja'
      )
    `);
  } catch(e) {}

  // ── Estado equipos: corregir según correctivas pendientes (idempotente) ──────
  try {
    db.exec(`
      UPDATE mant_equipos SET estado='en_reparacion'
      WHERE id IN (
        SELECT equipo_id FROM mant_intervenciones_correctivas WHERE resultado='pendiente'
      ) AND estado='activo'
    `);
  } catch(e) {}

  // ── Dedup tareas preventivas (idempotente) ────────────────────────────────
  try {
    db.exec(`
      DELETE FROM mant_tareas_preventivas
      WHERE id NOT IN (
        SELECT MIN(id)
        FROM mant_tareas_preventivas
        GROUP BY equipo_id, componente, accion, tipo, frecuencia
      )
    `);
  } catch(e) {}

  // ── RRHH: Dispositivos y Asistencia ──────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS rrhh_dispositivos (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre      TEXT DEFAULT 'Terminal',
      modelo      TEXT DEFAULT 'DS-K1T320MFWX',
      ip          TEXT NOT NULL DEFAULT '',
      puerto      INTEGER DEFAULT 80,
      usuario     TEXT DEFAULT 'admin',
      password    TEXT DEFAULT '',
      activo      INTEGER DEFAULT 1,
      ultima_sync TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS rrhh_asistencia (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      dispositivo_id  INTEGER REFERENCES rrhh_dispositivos(id),
      empleado_id     INTEGER REFERENCES rrhh_empleados(id),
      empleado_nombre TEXT DEFAULT '',
      empleado_ext    TEXT DEFAULT '',
      fecha           TEXT NOT NULL,
      hora            TEXT NOT NULL,
      tipo_acceso     TEXT DEFAULT '',
      temperatura     REAL,
      created_at      TEXT DEFAULT (datetime('now','localtime')),
      UNIQUE(dispositivo_id, empleado_ext, fecha, hora)
    );

    CREATE INDEX IF NOT EXISTS idx_rrhh_asist_fecha ON rrhh_asistencia(fecha);
    CREATE INDEX IF NOT EXISTS idx_rrhh_asist_emp   ON rrhh_asistencia(empleado_id);
  `);

  // id_dispositivo en empleados (para vincular con el nro de empleado del terminal)
  try { db.exec(`ALTER TABLE rrhh_empleados ADD COLUMN id_dispositivo  TEXT DEFAULT ''`); } catch(e) {}
  try { db.exec(`ALTER TABLE rrhh_empleados ADD COLUMN horario_entrada TEXT DEFAULT ''`); } catch(e) {}
  try { db.exec(`ALTER TABLE rrhh_empleados ADD COLUMN horario_salida  TEXT DEFAULT ''`); } catch(e) {}

  // Asociación usuario ↔ empleado RRHH
  try { db.exec(`ALTER TABLE usuarios ADD COLUMN rrhh_empleado_id INTEGER REFERENCES rrhh_empleados(id) ON DELETE SET NULL`); } catch(e) {}

  // Índice único en nombre para evitar duplicados al reiniciar
  try { db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_rrhh_emp_nombre ON rrhh_empleados(nombre)`); } catch(e) {}

  // ── Seed RRHH: categorías (idempotente) ──────────────────────────────────────
  const CATS_RRHH = [
    ['CP','Chapas y perfiles',              'Granallado'],
    ['LM','Limpieza Manual',                'Granallado'],
    ['PM','Pintura/Marcado',                'Granallado'],
    ['MM','Movimiento Materiales',          'Granallado'],
    ['PC','Preparacion de Chapa',           'Mano de obra Herreria'],
    ['LC','Preparacion de Canos y Perfiles','Mano de obra Herreria'],
    ['SO','Soldadura',                      'Mano de obra Herreria'],
    ['LR','Limpieza y retoque de pintura',  'Terminaciones y Montaje'],
    ['PI','Pintura interior/exterior',      'Terminaciones y Montaje'],
    ['MC','Montaje de Canerias',            'Terminaciones y Montaje'],
    ['ME','Montaje de Equipos',             'Terminaciones y Montaje'],
    ['AM','Aislaciones y Molduras',         'Terminaciones y Montaje'],
    ['CT','Construccion de Tablero',        'Electrico'],
    ['IE','Instalacion Electrica',          'Electrico'],
    ['PP','Programacion de Software',       'Electrico'],
    ['MI','Mantenimiento edilicio',         'Infraestructura'],
    ['EP','Mantenimiento equipos propios',  'Infraestructura'],
    ['ET','Reparacion de equipos terceros', 'Infraestructura'],
    ['AL','Almacen de materiales',          'Ingenieria'],
    ['GC','Gestion de calidad documentos',  'Ingenieria'],
    ['DC','Dibujo CAD',                     'Ingenieria'],
    ['CC','Medicion y Control de Calidad',  'Ingenieria'],
    ['OT','Otros',                          'General'],
  ];
  {
    const ins = db.prepare('INSERT OR IGNORE INTO rrhh_categorias (codigo,descripcion,grupo) VALUES (?,?,?)');
    for (const [c,d,g] of CATS_RRHH) ins.run(c,d,g);
    // Corregir grupos que quedaron mal en instancias anteriores
    db.prepare("UPDATE rrhh_categorias SET grupo='Granallado'           WHERE codigo IN ('LM','PM','MM')").run();
    db.prepare("UPDATE rrhh_categorias SET grupo='Mano de obra Herreria' WHERE codigo IN ('PC','LC','SO')").run();
    db.prepare("UPDATE rrhh_categorias SET grupo='General'              WHERE codigo='OT'").run();
  }

  // ── Seed RRHH: empleados (idempotente) ────────────────────────────────────────
  // Internos = personal E-INTRA (hoja Selección del Form 43)
  // Contratistas = empleados externos del historial
  const EMPS_RRHH = [
    ['ARTURO JIMENEZ','interno'],
    ['GUSTAVO ORTEGA','interno'],
    ['DANIEL CORRADO','interno'],
    ['DANIEL RODRIGUEZ','interno'],
    ['NICOLAS RODRIGUEZ','interno'],
    ['MAXIMILIANO SERRANO','interno'],
    ['NICOLAS SAAVEDRA','interno'],
    ['JOE LUIS RODRIGUEZ','interno'],
    ['OSCAR PIÑANGO','interno'],
    ['JUAN EDER','interno'],
    ['JOSE LOPEZ','interno'],
    ['IAN SALAZAR','interno'],
    ['FABIAN GARELLI','interno'],
    ['YONATHAN VALIENTE','interno'],
    ['AGUSTIN GANDULFO','contratista'],
    ['AGUSTIN QUEVEDO','contratista'],
    ['ALAN TORRES','contratista'],
    ['ALEJO LUCIANO','contratista'],
    ['BASUALDO GONZALO','contratista'],
    ['BUTEX MATIAS','contratista'],
    ['CASTILLO GUSTAVO','contratista'],
    ['CESAR FERNANDEZ','contratista'],
    ['CESAR JIMENEZ','contratista'],
    ['CRISTIAN RAMIREZ','contratista'],
    ['GUSTAVO TOMADIN','contratista'],
    ['LARREA EMILIANO','contratista'],
    ['LUCAS ALBELO','contratista'],
    ['LUCAS QUEVEDO','contratista'],
    ['LUIS CARRERA','contratista'],
    ['LUIS QUEVEDO','contratista'],
    ['MARCOS FIORIO','contratista'],
    ['OSWALDO RODRIGUEZ','contratista'],
    ['PABLO ESCOBAR','contratista'],
    ['PABLO ZAGARI','contratista'],
    ['REYES JORGE','contratista'],
    ['RUBEN HURTADO','contratista'],
  ];
  {
    const ins = db.prepare('INSERT OR IGNORE INTO rrhh_empleados (nombre,tipo) VALUES (?,?)');
    for (const [n,t] of EMPS_RRHH) ins.run(n,t);
  }

  // Seed inicial si no hay usuarios
  const hay = db.prepare('SELECT COUNT(*) as c FROM usuarios').get();
  if (hay.c === 0) {
    const bcrypt = require('bcryptjs');
    const hash   = bcrypt.hashSync('eintra2026', 10);
    const roles  = [
      ['admin',      'Administrador',     'admin@eintra.com',     'admin'],
      ['gerencia',   'Gerencia',          'gerencia@eintra.com',  'gerencia'],
      ['compras',    'Compras',           'compras@eintra.com',   'compras'],
      ['ventas',     'Ventas',            'ventas@eintra.com',    'ventas'],
      ['deposito',   'Depósito',          'deposito@eintra.com',  'deposito'],
      ['produccion', 'Producción',        'prod@eintra.com',      'produccion'],
      ['finanzas',   'Finanzas',          'finanzas@eintra.com',  'finanzas'],
    ];
    const ins = db.prepare('INSERT INTO usuarios (username,nombre,email,password_hash,rol) VALUES (?,?,?,?,?)');
    for (const [u, n, e, r] of roles) ins.run(u, n, e, hash, r);

    // Cuentas y categorías por defecto
    for (const [n, t, m] of [['Caja ARS','Caja','ARS'],['Banco ARS','Banco','ARS'],['Caja USD','Caja','USD']]) {
      db.prepare('INSERT OR IGNORE INTO cuentas_financieras (nombre,tipo,moneda) VALUES (?,?,?)').run(n,t,m);
    }
    const cats = [
      ['Cobro cliente','Ingreso','#a6e3a1'],['Anticipo','Ingreso','#94e2d5'],['Otros ingresos','Ingreso','#a6e3a1'],
      ['Pago proveedor','Egreso','#f38ba8'],['Servicios','Egreso','#fab387'],['Sueldos','Egreso','#fab387'],
      ['Impuestos','Egreso','#f9e2af'],['Gastos operativos','Egreso','#cba6f7'],['Otros egresos','Egreso','#6c7086'],
    ];
    const insCat = db.prepare('INSERT OR IGNORE INTO categorias_financieras (nombre,tipo,color) VALUES (?,?,?)');
    for (const [n,t,c] of cats) insCat.run(n,t,c);

    console.log('DB inicializada. Usuarios creados (contraseña: eintra2026)');
  }
}

module.exports = { db, inicializar };
