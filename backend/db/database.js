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

    CREATE TABLE IF NOT EXISTS login_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
      fecha      TEXT DEFAULT (datetime('now','localtime')),
      ip         TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_login_log_usuario ON login_log(usuario_id);
    CREATE INDEX IF NOT EXISTS idx_login_log_fecha   ON login_log(fecha);

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

  // ── Columnas extra en productos (idempotente) ────────────────────────────────
  try { db.exec(`ALTER TABLE productos ADD COLUMN proveedor TEXT DEFAULT ''`) } catch(e) {}
  try { db.exec(`ALTER TABLE productos ADD COLUMN codigo_proveedor TEXT DEFAULT ''`) } catch(e) {}

  // ── SGC Compras: columnas extra (idempotente) ─────────────────────────────────
  try { db.exec(`ALTER TABLE proveedores ADD COLUMN critico INTEGER DEFAULT 0`) } catch(e) {}
  try { db.exec(`ALTER TABLE ordenes_compra ADD COLUMN fecha_entrega_est TEXT DEFAULT ''`) } catch(e) {}
  try { db.exec(`ALTER TABLE ordenes_compra ADD COLUMN numero_remito TEXT DEFAULT ''`) } catch(e) {}
  try { db.exec(`ALTER TABLE ordenes_compra ADD COLUMN fecha_recepcion TEXT DEFAULT ''`) } catch(e) {}
  try { db.exec(`ALTER TABLE ordenes_compra ADD COLUMN modo_plazo TEXT DEFAULT 'OC'`) } catch(e) {}
  try { db.exec(`ALTER TABLE ordenes_compra ADD COLUMN dias_plazo INTEGER`) } catch(e) {}
  try { db.exec(`ALTER TABLE oc_items ADD COLUMN dias_plazo INTEGER`) } catch(e) {}

  // ── Form 17 — Seguimiento de Compras (idempotente) ───────────────────────────
  try { db.exec(`ALTER TABLE ordenes_compra ADD COLUMN estado_doc TEXT DEFAULT ''`) } catch(e) {}
  try { db.exec(`ALTER TABLE ordenes_compra ADD COLUMN nro_factura TEXT DEFAULT ''`) } catch(e) {}
  try { db.exec(`ALTER TABLE ordenes_compra ADD COLUMN importe_facturado REAL DEFAULT 0`) } catch(e) {}
  try { db.exec(`ALTER TABLE ordenes_compra ADD COLUMN fecha_vencimiento TEXT DEFAULT ''`) } catch(e) {}
  try { db.exec(`ALTER TABLE ordenes_compra ADD COLUMN pago_confirmado INTEGER DEFAULT 0`) } catch(e) {}
  try { db.exec(`ALTER TABLE oc_items ADD COLUMN estado_calidad TEXT DEFAULT ''`) } catch(e) {}
  try { db.exec(`ALTER TABLE oc_items ADD COLUMN estado_factura TEXT DEFAULT ''`) } catch(e) {}
  try { db.exec(`ALTER TABLE oc_items ADD COLUMN sin_codificar INTEGER DEFAULT 0`) } catch(e) {}

  // ── Form 11 — Selección y Evaluación de Proveedores (idempotente) ────────────
  try { db.exec(`ALTER TABLE proveedores ADD COLUMN categoria_provision TEXT DEFAULT ''`) } catch(e) {}
  try { db.exec(`ALTER TABLE proveedores ADD COLUMN fecha_seleccion TEXT DEFAULT ''`) } catch(e) {}
  try { db.exec(`ALTER TABLE proveedores ADD COLUMN frecuencia_evaluacion TEXT DEFAULT 'Anual'`) } catch(e) {}
  try { db.exec(`ALTER TABLE proveedores ADD COLUMN responsable_seleccion TEXT DEFAULT ''`) } catch(e) {}
  try { db.exec(`ALTER TABLE proveedores ADD COLUMN responsable_evaluacion TEXT DEFAULT ''`) } catch(e) {}

  // Bonificaciones estándar del proveedor (se actualizan al emitir OC)
  try { db.exec(`ALTER TABLE proveedores ADD COLUMN bonif1 REAL DEFAULT 0`) } catch(e) {}
  try { db.exec(`ALTER TABLE proveedores ADD COLUMN bonif2 REAL DEFAULT 0`) } catch(e) {}
  try { db.exec(`ALTER TABLE proveedores ADD COLUMN bonif3 REAL DEFAULT 0`) } catch(e) {}
  try { db.exec(`ALTER TABLE proveedores ADD COLUMN bonif4 REAL DEFAULT 0`) } catch(e) {}

  // Precio de última compra en catálogo de productos
  try { db.exec(`ALTER TABLE productos ADD COLUMN precio_moneda TEXT DEFAULT ''`) } catch(e) {}
  try { db.exec(`ALTER TABLE productos ADD COLUMN precio_fecha  TEXT DEFAULT ''`) } catch(e) {}

  // Futura codificación — para migración gradual
  try { db.exec(`ALTER TABLE productos ADD COLUMN codigo_futuro        TEXT    DEFAULT ''`) } catch(e) {}
  try { db.exec(`ALTER TABLE productos ADD COLUMN codigo_futuro_estado TEXT    DEFAULT 'pendiente'`) } catch(e) {}
  // Sistema correlativo nuevo — 0=código original, 1=código asignado por nuevo sistema
  try { db.exec(`ALTER TABLE productos ADD COLUMN codigo_generado INTEGER DEFAULT 0`) } catch(e) {}

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
      n_lote      TEXT DEFAULT '',
      destino     TEXT DEFAULT 'uso_inmediato'
    );
  `);
  try { db.exec(`ALTER TABLE form49_items ADD COLUMN destino TEXT DEFAULT 'uso_inmediato'`) } catch(e) {}
  // Columnas OC generada desde form49
  for (const col of [
    `ALTER TABLE form49_ingresos ADD COLUMN oc_id INTEGER REFERENCES ordenes_compra(id)`,
    `ALTER TABLE form49_ingresos ADD COLUMN oc_numero TEXT DEFAULT ''`,
  ]) { try { db.exec(col) } catch(e) {} }
  // Nuevas columnas cabecera form49
  for (const col of [
    `ALTER TABLE form49_ingresos ADD COLUMN proveedor_cuit TEXT DEFAULT ''`,
    `ALTER TABLE form49_ingresos ADD COLUMN moneda TEXT DEFAULT 'PESOS'`,
    `ALTER TABLE form49_ingresos ADD COLUMN tasa_cambio REAL DEFAULT 0`,
    `ALTER TABLE form49_ingresos ADD COLUMN condicion_pago TEXT DEFAULT ''`,
    `ALTER TABLE form49_ingresos ADD COLUMN lugar_entrega TEXT DEFAULT ''`,
    `ALTER TABLE form49_ingresos ADD COLUMN presupuesto_n TEXT DEFAULT ''`,
    `ALTER TABLE form49_ingresos ADD COLUMN elaborado_por TEXT DEFAULT ''`,
    `ALTER TABLE form49_items ADD COLUMN precio_unitario REAL DEFAULT 0`,
    `ALTER TABLE form49_items ADD COLUMN precio_final REAL DEFAULT 0`,
    `ALTER TABLE form49_items ADD COLUMN plazo TEXT DEFAULT 'INMEDIATO'`,
    `ALTER TABLE form49_items ADD COLUMN producto_id INTEGER REFERENCES productos(id)`,
    `ALTER TABLE form49_items ADD COLUMN producto_codigo TEXT DEFAULT ''`,
  ]) { try { db.exec(col) } catch(e) {} }
  // Pendientes sin OC para stock
  try { db.exec(`
    CREATE TABLE IF NOT EXISTS ingresos_sin_oc_pendientes (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      form49_id        INTEGER REFERENCES form49_ingresos(id) ON DELETE CASCADE,
      form49_numero    TEXT DEFAULT '',
      proveedor_nombre TEXT DEFAULT '',
      descripcion      TEXT DEFAULT '',
      unidad           TEXT DEFAULT 'UND.',
      cantidad         REAL DEFAULT 0,
      n_parte          TEXT DEFAULT '',
      precio_costo     REAL DEFAULT 0,
      producto_id      INTEGER REFERENCES productos(id),
      producto_codigo  TEXT DEFAULT '',
      created_at       TEXT DEFAULT (datetime('now','localtime'))
    )
  `) } catch(e) {}

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

    CREATE TABLE IF NOT EXISTS rrhh_feriados (
      fecha       TEXT PRIMARY KEY,
      descripcion TEXT DEFAULT ''
    );
  `);

  // id_dispositivo en empleados (para vincular con el nro de empleado del terminal)
  try { db.exec(`ALTER TABLE rrhh_empleados ADD COLUMN id_dispositivo  TEXT DEFAULT ''`); } catch(e) {}
  try { db.exec(`ALTER TABLE rrhh_empleados ADD COLUMN horario_entrada TEXT DEFAULT ''`); } catch(e) {}
  try { db.exec(`ALTER TABLE rrhh_empleados ADD COLUMN horario_salida  TEXT DEFAULT ''`); } catch(e) {}
  try { db.exec(`ALTER TABLE rrhh_empleados ADD COLUMN obliga_fichar   INTEGER DEFAULT 1`); } catch(e) {}

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

  // ── Mensajería interna ───────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS mensajes (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      de_id        INTEGER NOT NULL REFERENCES usuarios(id),
      de_nombre    TEXT DEFAULT '',
      para_id      INTEGER NOT NULL REFERENCES usuarios(id),
      para_nombre  TEXT DEFAULT '',
      asunto       TEXT DEFAULT '',
      cuerpo       TEXT NOT NULL DEFAULT '',
      leido        INTEGER DEFAULT 0,
      borrado_para INTEGER DEFAULT 0,
      borrado_de   INTEGER DEFAULT 0,
      created_at   TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_msg_para ON mensajes(para_id, leido);
    CREATE INDEX IF NOT EXISTS idx_msg_de   ON mensajes(de_id);
  `);

  try { db.exec(`ALTER TABLE mensajes ADD COLUMN leido_at TEXT DEFAULT ''`) } catch(e) {}

  // ── Ingresos pendientes (recepción OC → espera confirmación en stock) ────────
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ingresos_pendientes (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        oc_id            INTEGER REFERENCES ordenes_compra(id),
        oc_numero        TEXT DEFAULT '',
        proveedor_nombre TEXT DEFAULT '',
        oc_item_id       INTEGER REFERENCES oc_items(id),
        producto_id      INTEGER NOT NULL REFERENCES productos(id),
        producto_codigo  TEXT DEFAULT '',
        producto_desc    TEXT DEFAULT '',
        unidad           TEXT DEFAULT 'UND.',
        cantidad         REAL NOT NULL,
        precio_costo     REAL DEFAULT 0,
        numero_remito    TEXT DEFAULT '',
        fecha_recepcion  TEXT DEFAULT '',
        created_at       TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_ing_pend_prod ON ingresos_pendientes(producto_id);
    `)
  } catch(e) {}

  // ── Documentos de proyecto (Form 30) ─────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS proyecto_documentos (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      proyecto_id      INTEGER NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
      item_num         INTEGER DEFAULT 1,
      item_nombre      TEXT DEFAULT '',
      categoria        TEXT DEFAULT '',
      item             TEXT DEFAULT '',
      subitem          TEXT DEFAULT '',
      responsable      TEXT DEFAULT '',
      aplica           TEXT DEFAULT '',
      estado           TEXT DEFAULT '',
      fecha_solicitado TEXT DEFAULT '',
      fecha_entregado  TEXT DEFAULT '',
      created_at       TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_proy_docs ON proyecto_documentos(proyecto_id);
  `);

  // ── Configuración del sistema ─────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS configuracion (
      clave      TEXT PRIMARY KEY,
      valor      TEXT NOT NULL DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
  `)
  // Migrar SMTP desde .env si la tabla está vacía
  {
    const ins = db.prepare('INSERT OR IGNORE INTO configuracion (clave, valor) VALUES (?, ?)')
    const envMap = [
      ['smtp_host',   process.env.SMTP_HOST   || ''],
      ['smtp_port',   process.env.SMTP_PORT   || '587'],
      ['smtp_user',   process.env.SMTP_USER   || ''],
      ['smtp_pass',   process.env.SMTP_PASS   || ''],
      ['smtp_from',   process.env.SMTP_FROM   || ''],
      ['smtp_secure', process.env.SMTP_SECURE || 'false'],
      ['backup_to',   process.env.BACKUP_TO   || ''],
    ]
    for (const [k, v] of envMap) if (v) ins.run(k, v)
  }

  // ── CRM / Ventas ──────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS crm_empresas (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre     TEXT NOT NULL,
      activo     INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_crm_emp_nombre ON crm_empresas(nombre);

    CREATE TABLE IF NOT EXISTS crm_contactos (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER REFERENCES crm_empresas(id),
      nombre     TEXT DEFAULT '',
      posicion   TEXT DEFAULT '',
      telefono   TEXT DEFAULT '',
      mail       TEXT DEFAULT '',
      activo     INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_crm_cont_emp ON crm_contactos(empresa_id);

    CREATE TABLE IF NOT EXISTS crm_cotizaciones (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id    INTEGER REFERENCES crm_empresas(id),
      contacto_id   INTEGER REFERENCES crm_contactos(id),
      fecha         TEXT DEFAULT '',
      equipo        TEXT DEFAULT '',
      indirecto     TEXT DEFAULT '',
      moneda        TEXT DEFAULT 'USD' CHECK(moneda IN ('ARS','USD')),
      presupuestado REAL DEFAULT 0,
      ganado        REAL DEFAULT 0,
      perdido       REAL DEFAULT 0,
      estado        TEXT DEFAULT 'Activo' CHECK(estado IN ('Activo','Ganado','Perdido','Desestimado')),
      observaciones TEXT DEFAULT '',
      seguimiento   TEXT DEFAULT '',
      actualizado   TEXT DEFAULT '',
      created_at    TEXT DEFAULT (datetime('now','localtime')),
      updated_at    TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_crm_cot_emp   ON crm_cotizaciones(empresa_id);
    CREATE INDEX IF NOT EXISTS idx_crm_cot_est   ON crm_cotizaciones(estado);
    CREATE INDEX IF NOT EXISTS idx_crm_cot_fecha ON crm_cotizaciones(fecha);
  `)

  // ── Correcciones de códigos de proyectos (idempotente) ───────────────────────
  try { db.exec(`UPDATE proyectos SET codigo='NIKIT002C' WHERE codigo='NIKIT005C'`) } catch(e) {}

  // ── Split NIKIT002C → NIKIT002C1 + NIKIT002C2 (idempotente) ─────────────────
  try {
    const orig = db.prepare(`SELECT * FROM proyectos WHERE codigo='NIKIT002C'`).get();
    if (orig) {
      db.prepare(`UPDATE proyectos SET codigo='NIKIT002C1' WHERE id=?`).run(orig.id);
      const ya2 = db.prepare(`SELECT id FROM proyectos WHERE codigo='NIKIT002C2'`).get();
      if (!ya2) {
        const r2 = db.prepare(`
          INSERT INTO proyectos (codigo, nombre, cliente_nombre, responsable, descripcion, fecha_inicio, fecha_fin_est, estado, presupuesto_venta)
          VALUES ('NIKIT002C2', ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(orig.nombre, orig.cliente_nombre||'', orig.responsable||'', orig.descripcion||'',
               orig.fecha_inicio||'', orig.fecha_fin_est||'', orig.estado, orig.presupuesto_venta||0);
        const items = db.prepare(`SELECT DISTINCT item_num FROM proyecto_documentos WHERE proyecto_id=? ORDER BY item_num`).all(orig.id);
        if (items.length >= 2) {
          db.prepare(`UPDATE proyecto_documentos SET proyecto_id=?, item_num=1 WHERE proyecto_id=? AND item_num=?`)
            .run(r2.lastInsertRowid, orig.id, items[1].item_num);
        }
      }
    }
  } catch(e) {}

  // ── Fix: mover docs ítem 2 a NIKIT002C2 si quedó vacío (idempotente) ─────────
  try {
    const p1 = db.prepare(`SELECT id FROM proyectos WHERE codigo='NIKIT002C1'`).get();
    const p2 = db.prepare(`SELECT id FROM proyectos WHERE codigo='NIKIT002C2'`).get();
    if (p1 && p2) {
      const vacios = db.prepare(`SELECT COUNT(*) as c FROM proyecto_documentos WHERE proyecto_id=?`).get(p2.id);
      if (vacios.c === 0) {
        const items = db.prepare(`SELECT DISTINCT item_num FROM proyecto_documentos WHERE proyecto_id=? ORDER BY item_num`).all(p1.id);
        if (items.length >= 2) {
          db.prepare(`UPDATE proyecto_documentos SET proyecto_id=?, item_num=1 WHERE proyecto_id=? AND item_num=?`)
            .run(p2.id, p1.id, items[1].item_num);
        }
      }
    }
  } catch(e) {}

  // ── Oferta Técnica ────────────────────────────────────────────────────────────
  try { db.exec(`ALTER TABLE presupuestos ADD COLUMN cotizacion_id INTEGER REFERENCES crm_cotizaciones(id)`) } catch(e) {}

  db.exec(`
    CREATE TABLE IF NOT EXISTS ofertas_tecnicas (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      presupuesto_id           INTEGER UNIQUE REFERENCES presupuestos(id) ON DELETE CASCADE,
      ref_codigo               TEXT DEFAULT '',
      tipo_equipo              TEXT DEFAULT '',
      modelo                   TEXT DEFAULT '',
      introduccion             TEXT DEFAULT '',
      principio_funcionamiento TEXT DEFAULT '',
      seleccion_equipo         TEXT DEFAULT '',
      componentes              TEXT DEFAULT '',
      alcance                  TEXT DEFAULT '',
      exclusiones              TEXT DEFAULT '',
      plazo_ejecucion          TEXT DEFAULT '',
      garantias                TEXT DEFAULT '',
      antecedentes             TEXT DEFAULT '',
      elaborado_por            TEXT DEFAULT '',
      created_at               TEXT DEFAULT (datetime('now','localtime')),
      updated_at               TEXT DEFAULT (datetime('now','localtime'))
    );
  `)

  // ── Migrar rrhh_registros.proyecto_id → referencia proyectos(id) ─────────────
  try {
    const check = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='rrhh_registros'`).get();
    if (check?.sql?.includes('rrhh_proyectos')) {
      db.pragma('foreign_keys = OFF');
      db.exec(`
        CREATE TABLE rrhh_registros_new (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          fecha        TEXT NOT NULL,
          empleado_id  INTEGER NOT NULL REFERENCES rrhh_empleados(id),
          proyecto_id  INTEGER REFERENCES proyectos(id),
          categoria_id INTEGER REFERENCES rrhh_categorias(id),
          hora_inicio  TEXT DEFAULT '',
          hora_fin     TEXT DEFAULT '',
          horas        REAL DEFAULT 0,
          modulo       TEXT DEFAULT '',
          descripcion  TEXT DEFAULT '',
          created_at   TEXT DEFAULT (datetime('now','localtime'))
        );
        INSERT INTO rrhh_registros_new SELECT * FROM rrhh_registros;
        DROP TABLE rrhh_registros;
        ALTER TABLE rrhh_registros_new RENAME TO rrhh_registros;
        CREATE INDEX IF NOT EXISTS idx_rrhh_reg_fecha    ON rrhh_registros(fecha);
        CREATE INDEX IF NOT EXISTS idx_rrhh_reg_empleado ON rrhh_registros(empleado_id);
        CREATE INDEX IF NOT EXISTS idx_rrhh_reg_proyecto ON rrhh_registros(proyecto_id);
      `);
      db.pragma('foreign_keys = ON');
      console.log('Migración: rrhh_registros.proyecto_id ahora referencia proyectos(id)');
    }
  } catch(e) { console.log('migration rrhh_registros FK:', e.message) }

  // ── Entrega de documentación (Form 56) ───────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS proyecto_entregas_doc (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      proyecto_id      INTEGER REFERENCES proyectos(id) ON DELETE SET NULL,
      proyecto_nombre  TEXT DEFAULT '',
      fecha            TEXT NOT NULL DEFAULT '',
      nro_oc           TEXT DEFAULT '',
      formato          TEXT DEFAULT '',
      documento        TEXT DEFAULT '',
      plano_nivel      TEXT DEFAULT '',
      codigo_plano     TEXT DEFAULT '',
      tipo             TEXT DEFAULT 'S',
      individuo        TEXT DEFAULT '',
      comentarios      TEXT DEFAULT '',
      created_by       INTEGER,
      created_at       TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_proy_ent_doc ON proyecto_entregas_doc(proyecto_id);
  `)
  try {
    db.exec(`ALTER TABLE proyecto_entregas_doc ADD COLUMN codigo_plano TEXT DEFAULT ''`)
  } catch(e) { /* columna ya existe */ }

  // ── Materiales previstos de proyecto ─────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS proyecto_materiales (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      proyecto_id   INTEGER NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
      producto_id   INTEGER REFERENCES productos(id) ON DELETE SET NULL,
      codigo        TEXT DEFAULT '',
      descripcion   TEXT NOT NULL DEFAULT '',
      unidad        TEXT DEFAULT 'UND.',
      cantidad      REAL DEFAULT 1,
      observaciones TEXT DEFAULT '',
      created_by    INTEGER REFERENCES usuarios(id),
      created_at    TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_proy_mat ON proyecto_materiales(proyecto_id);
  `)

  // ── Facturas ──────────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS facturas_compra (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo_factura      TEXT DEFAULT 'A',
      numero            TEXT NOT NULL,
      fecha             TEXT DEFAULT '',
      proveedor_id      INTEGER REFERENCES proveedores(id),
      proveedor_nombre  TEXT DEFAULT '',
      cuit              TEXT DEFAULT '',
      oc_id             INTEGER REFERENCES ordenes_compra(id),
      oc_numero         TEXT DEFAULT '',
      neto_gravado      REAL DEFAULT 0,
      no_grav_exento    REAL DEFAULT 0,
      iva_21            REAL DEFAULT 0,
      iva_10_5          REAL DEFAULT 0,
      iva_27            REAL DEFAULT 0,
      otros_imp         REAL DEFAULT 0,
      perc_iva          REAL DEFAULT 0,
      perc_iibb         REAL DEFAULT 0,
      importe           REAL DEFAULT 0,
      moneda            TEXT DEFAULT 'PESO',
      tasa_cambio       REAL DEFAULT 1,
      fecha_vencimiento TEXT DEFAULT '',
      pago_confirmado   INTEGER DEFAULT 0,
      observaciones     TEXT DEFAULT '',
      created_by        INTEGER REFERENCES usuarios(id),
      created_at        TEXT DEFAULT (datetime('now','localtime')),
      updated_at        TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_fact_compra_fecha ON facturas_compra(fecha);
    CREATE INDEX IF NOT EXISTS idx_fact_compra_prov  ON facturas_compra(proveedor_id);

    CREATE TABLE IF NOT EXISTS facturas_venta (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo_factura      TEXT DEFAULT 'A',
      numero            TEXT NOT NULL,
      fecha             TEXT DEFAULT '',
      cliente_id        INTEGER REFERENCES clientes(id),
      cliente_nombre    TEXT DEFAULT '',
      presupuesto_id    INTEGER REFERENCES presupuestos(id),
      presupuesto_ref   TEXT DEFAULT '',
      importe           REAL DEFAULT 0,
      moneda            TEXT DEFAULT 'PESO',
      tasa_cambio       REAL DEFAULT 1,
      fecha_vencimiento TEXT DEFAULT '',
      pago_confirmado   INTEGER DEFAULT 0,
      observaciones     TEXT DEFAULT '',
      created_by        INTEGER REFERENCES usuarios(id),
      created_at        TEXT DEFAULT (datetime('now','localtime')),
      updated_at        TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_fact_venta_fecha ON facturas_venta(fecha);
    CREATE INDEX IF NOT EXISTS idx_fact_venta_cli   ON facturas_venta(cliente_id);
  `);

  // Migraciones: agregar columnas nuevas a facturas_compra si no existen
  const colsFC = db.prepare('PRAGMA table_info(facturas_compra)').all().map(c => c.name);
  if (!colsFC.includes('cuit'))           db.prepare("ALTER TABLE facturas_compra ADD COLUMN cuit TEXT DEFAULT ''").run();
  if (!colsFC.includes('neto_gravado'))   db.prepare('ALTER TABLE facturas_compra ADD COLUMN neto_gravado REAL DEFAULT 0').run();
  if (!colsFC.includes('no_grav_exento')) db.prepare('ALTER TABLE facturas_compra ADD COLUMN no_grav_exento REAL DEFAULT 0').run();
  if (!colsFC.includes('iva_21'))         db.prepare('ALTER TABLE facturas_compra ADD COLUMN iva_21 REAL DEFAULT 0').run();
  if (!colsFC.includes('iva_10_5'))       db.prepare('ALTER TABLE facturas_compra ADD COLUMN iva_10_5 REAL DEFAULT 0').run();
  if (!colsFC.includes('iva_27'))         db.prepare('ALTER TABLE facturas_compra ADD COLUMN iva_27 REAL DEFAULT 0').run();
  if (!colsFC.includes('otros_imp'))      db.prepare('ALTER TABLE facturas_compra ADD COLUMN otros_imp REAL DEFAULT 0').run();
  if (!colsFC.includes('perc_iva'))       db.prepare('ALTER TABLE facturas_compra ADD COLUMN perc_iva REAL DEFAULT 0').run();
  if (!colsFC.includes('perc_iibb'))      db.prepare('ALTER TABLE facturas_compra ADD COLUMN perc_iibb REAL DEFAULT 0').run();
  if (!colsFC.includes('anticipo'))       db.prepare('ALTER TABLE facturas_compra ADD COLUMN anticipo REAL DEFAULT 0').run();
  if (!colsFC.includes('fecha_anticipo')) db.prepare("ALTER TABLE facturas_compra ADD COLUMN fecha_anticipo TEXT DEFAULT ''").run();
  if (!colsFC.includes('tipo_factura'))   db.prepare("ALTER TABLE facturas_compra ADD COLUMN tipo_factura TEXT DEFAULT 'A'").run();

  const colsFV = db.prepare('PRAGMA table_info(facturas_venta)').all().map(c => c.name);
  if (!colsFV.includes('anticipo'))         db.prepare('ALTER TABLE facturas_venta ADD COLUMN anticipo REAL DEFAULT 0').run();
  if (!colsFV.includes('fecha_anticipo'))   db.prepare("ALTER TABLE facturas_venta ADD COLUMN fecha_anticipo TEXT DEFAULT ''").run();
  if (!colsFV.includes('tipo_factura'))     db.prepare("ALTER TABLE facturas_venta ADD COLUMN tipo_factura TEXT DEFAULT 'A'").run();
  if (!colsFV.includes('concepto'))         db.prepare("ALTER TABLE facturas_venta ADD COLUMN concepto TEXT DEFAULT ''").run();
  if (!colsFV.includes('oc'))               db.prepare("ALTER TABLE facturas_venta ADD COLUMN oc TEXT DEFAULT ''").run();
  if (!colsFV.includes('neto_gravado'))     db.prepare('ALTER TABLE facturas_venta ADD COLUMN neto_gravado REAL DEFAULT 0').run();
  if (!colsFV.includes('iva_21'))           db.prepare('ALTER TABLE facturas_venta ADD COLUMN iva_21 REAL DEFAULT 0').run();
  if (!colsFV.includes('ret_iibb'))         db.prepare('ALTER TABLE facturas_venta ADD COLUMN ret_iibb REAL DEFAULT 0').run();
  if (!colsFV.includes('ret_iva'))          db.prepare('ALTER TABLE facturas_venta ADD COLUMN ret_iva REAL DEFAULT 0').run();
  if (!colsFV.includes('ret_gcia'))         db.prepare('ALTER TABLE facturas_venta ADD COLUMN ret_gcia REAL DEFAULT 0').run();
  if (!colsFV.includes('ret_contratista'))  db.prepare('ALTER TABLE facturas_venta ADD COLUMN ret_contratista REAL DEFAULT 0').run();
  if (!colsFV.includes('ret_ss'))           db.prepare('ALTER TABLE facturas_venta ADD COLUMN ret_ss REAL DEFAULT 0').run();
  if (!colsFV.includes('dif_cambio'))       db.prepare('ALTER TABLE facturas_venta ADD COLUMN dif_cambio REAL DEFAULT 0').run();
  if (!colsFV.includes('total_cobrado'))    db.prepare('ALTER TABLE facturas_venta ADD COLUMN total_cobrado REAL DEFAULT 0').run();
  if (!colsFV.includes('fecha_pago'))       db.prepare("ALTER TABLE facturas_venta ADD COLUMN fecha_pago TEXT DEFAULT ''").run();
  if (!colsFV.includes('proyecto_id'))      db.prepare('ALTER TABLE facturas_venta ADD COLUMN proyecto_id INTEGER REFERENCES proyectos(id)').run();

  // ── Pagos de facturas de compra ───────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS pagos_factura_compra (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      factura_id         INTEGER NOT NULL REFERENCES facturas_compra(id) ON DELETE CASCADE,
      tipo               TEXT NOT NULL DEFAULT 'parcial',
      forma_pago         TEXT NOT NULL DEFAULT 'transferencia',
      entidad            TEXT DEFAULT '',
      importe            REAL NOT NULL DEFAULT 0,
      moneda             TEXT DEFAULT 'PESO',
      fecha              TEXT DEFAULT '',
      fecha_acreditacion TEXT DEFAULT '',
      estado             TEXT DEFAULT 'confirmado',
      observaciones      TEXT DEFAULT '',
      created_by         INTEGER REFERENCES usuarios(id),
      created_at         TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  // ── Pagos de facturas de venta ────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS pagos_factura_venta (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      factura_id         INTEGER NOT NULL REFERENCES facturas_venta(id) ON DELETE CASCADE,
      tipo               TEXT NOT NULL DEFAULT 'parcial',
      forma_pago         TEXT NOT NULL DEFAULT 'transferencia',
      entidad            TEXT DEFAULT '',
      importe            REAL NOT NULL DEFAULT 0,
      moneda             TEXT DEFAULT 'PESO',
      fecha              TEXT DEFAULT '',
      fecha_acreditacion TEXT DEFAULT '',
      estado             TEXT DEFAULT 'confirmado',
      observaciones      TEXT DEFAULT '',
      created_by         INTEGER REFERENCES usuarios(id),
      created_at         TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_pagos_fv ON pagos_factura_venta(factura_id);
  `);

  // Retenciones que el cliente aplica al pagar (no somos agentes de retención al facturar)
  const colsPagosFV = db.prepare('PRAGMA table_info(pagos_factura_venta)').all().map(c => c.name);
  if (!colsPagosFV.includes('ret_iibb'))        db.prepare('ALTER TABLE pagos_factura_venta ADD COLUMN ret_iibb REAL DEFAULT 0').run();
  if (!colsPagosFV.includes('ret_iva'))         db.prepare('ALTER TABLE pagos_factura_venta ADD COLUMN ret_iva REAL DEFAULT 0').run();
  if (!colsPagosFV.includes('ret_gcia'))        db.prepare('ALTER TABLE pagos_factura_venta ADD COLUMN ret_gcia REAL DEFAULT 0').run();
  if (!colsPagosFV.includes('ret_contratista')) db.prepare('ALTER TABLE pagos_factura_venta ADD COLUMN ret_contratista REAL DEFAULT 0').run();
  if (!colsPagosFV.includes('ret_ss'))          db.prepare('ALTER TABLE pagos_factura_venta ADD COLUMN ret_ss REAL DEFAULT 0').run();

  // Migrar anticipos existentes a pagos_factura_venta (idempotente)
  try {
    const conAnticipo = db.prepare(`
      SELECT id, anticipo, fecha_anticipo, moneda FROM facturas_venta
      WHERE anticipo > 0
      AND NOT EXISTS (SELECT 1 FROM pagos_factura_venta WHERE factura_id = facturas_venta.id)
    `).all();
    const insPago = db.prepare(`
      INSERT INTO pagos_factura_venta (factura_id, tipo, forma_pago, importe, moneda, fecha, estado)
      VALUES (?, 'anticipo', 'transferencia', ?, ?, ?, 'confirmado')
    `);
    for (const f of conAnticipo) {
      insPago.run(f.id, f.anticipo, f.moneda || 'PESO', f.fecha_anticipo || '');
    }
    if (conAnticipo.length > 0) console.log(`Migrados ${conAnticipo.length} anticipos a pagos_factura_venta`);
  } catch(e) { console.log('Migración anticipos:', e.message) }

  // ── Saldo bancario ────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS saldo_bancario (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      entidad    TEXT NOT NULL,
      monto      REAL NOT NULL,
      moneda     TEXT NOT NULL DEFAULT 'PESO',
      created_by INTEGER REFERENCES usuarios(id),
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS tipo_cambio (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      moneda     TEXT NOT NULL DEFAULT 'DÓLAR',
      valor      REAL NOT NULL,
      fuente     TEXT DEFAULT 'BNA',
      fecha      TEXT DEFAULT '',
      created_by INTEGER REFERENCES usuarios(id),
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `)

  // ── Servicios recurrentes ─────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS servicios (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      descripcion  TEXT NOT NULL,
      usuario      TEXT DEFAULT '',
      info_pago    TEXT DEFAULT '',
      periodicidad TEXT NOT NULL DEFAULT 'mensual',
      activo       INTEGER DEFAULT 1,
      created_at   TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS servicios_cuotas (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      servicio_id  INTEGER NOT NULL REFERENCES servicios(id) ON DELETE CASCADE,
      monto        REAL,
      vencimiento  TEXT DEFAULT '',
      fecha_pagada TEXT DEFAULT '',
      estado       TEXT NOT NULL DEFAULT 'pendiente',
      created_at   TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  // ── Control OC Clientes ───────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS fin_oc_clientes (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id          INTEGER REFERENCES clientes(id),
      cliente             TEXT NOT NULL DEFAULT '',
      numero_oc           TEXT NOT NULL DEFAULT '',
      monto_oc            REAL,
      fecha_oc            TEXT DEFAULT '',
      fecha_recepcion_oc  TEXT DEFAULT '',
      anticipo_pct        REAL,
      monto_anticipo_usd  REAL,
      fecha_fact_anticipo TEXT DEFAULT '',
      fecha_pago_anticipo TEXT DEFAULT '',
      numero_poliza       TEXT DEFAULT '',
      fecha_pedido_poliza TEXT DEFAULT '',
      fecha_poliza        TEXT DEFAULT '',
      vigencia_poliza     TEXT DEFAULT '',
      fecha_entrega_doc   TEXT DEFAULT '',
      observaciones       TEXT DEFAULT '',
      final_pct           REAL,
      monto_final_usd     REAL,
      fecha_fact_final    TEXT DEFAULT '',
      cierre_tipo         TEXT DEFAULT '',
      fecha_cierre_admin  TEXT DEFAULT '',
      comentarios         TEXT DEFAULT '',
      activo              INTEGER NOT NULL DEFAULT 1,
      created_at          TEXT DEFAULT (datetime('now','localtime')),
      updated_at          TEXT DEFAULT (datetime('now','localtime'))
    )
  `);

  try { db.exec(`ALTER TABLE fin_oc_clientes ADD COLUMN cliente_id INTEGER REFERENCES clientes(id)`) } catch(e) {}
  try { db.exec(`ALTER TABLE fin_oc_clientes ADD COLUMN proyecto_id INTEGER REFERENCES proyectos(id)`) } catch(e) {}

  // ── Directivas del programa ───────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS directivas (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      titulo      TEXT NOT NULL,
      descripcion TEXT DEFAULT '',
      activa      INTEGER DEFAULT 1,
      orden       INTEGER DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now','localtime'))
    )
  `);
  if (db.prepare('SELECT COUNT(*) as c FROM directivas').get().c === 0) {
    const ins = db.prepare("INSERT INTO directivas (titulo, descripcion, orden) VALUES (?,?,?)");
    db.transaction(() => {
      ins.run('Formato de fecha', 'Usar formato DD/MM/AAAA en todo el sistema, en formularios, tablas y reportes.', 1);
      ins.run('Fuente de datos', 'Siempre trabajar sobre los datos que están en la base de datos del servidor. Nunca reimportar desde archivos externos (Excel, CSV) sin autorización explícita.', 2);
      ins.run('Archivos de importación', 'Eliminar scripts y dumps SQL después de cada importación para evitar re-ejecución accidental.', 3);
      ins.run('Deploy solo código', 'El deploy.ps1 solo sube código (.jsx, .js, etc.). Los datos se modifican únicamente con comandos scp o sqlite3 por SSH, de forma explícita.', 4);
      ins.run('Modificaciones de datos', 'Antes de modificar un archivo de configuración o datos del servidor, siempre descargarlo primero para trabajar sobre la versión actual.', 5);
      ins.run('Tipo de cambio', 'Las facturas en moneda extranjera (dólar, euro) deben incluir la tasa de cambio vigente al momento de la emisión.', 6);
    })();
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

  // ── Calidad ────────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS hoja_ruta (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      numero          TEXT UNIQUE NOT NULL,
      proyecto_id     INTEGER REFERENCES proyectos(id) ON DELETE SET NULL,
      descripcion     TEXT NOT NULL DEFAULT '',
      cliente_nombre  TEXT DEFAULT '',
      responsable     TEXT DEFAULT '',
      fecha_inicio    TEXT DEFAULT '',
      fecha_fin_est   TEXT DEFAULT '',
      fecha_despacho  TEXT DEFAULT '',
      estado          TEXT DEFAULT 'En proceso',
      observaciones   TEXT DEFAULT '',
      created_at      TEXT DEFAULT (datetime('now','localtime')),
      updated_at      TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_hr_estado ON hoja_ruta(estado);

    CREATE TABLE IF NOT EXISTS hoja_ruta_etapa (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      hoja_ruta_id   INTEGER NOT NULL REFERENCES hoja_ruta(id) ON DELETE CASCADE,
      nombre         TEXT NOT NULL,
      orden          INTEGER DEFAULT 0,
      responsable    TEXT DEFAULT '',
      fecha_prog     TEXT DEFAULT '',
      fecha_real     TEXT DEFAULT '',
      estado         TEXT DEFAULT 'Pendiente',
      criterios      TEXT DEFAULT '',
      medicion       TEXT DEFAULT '',
      observaciones  TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_hr_etapa ON hoja_ruta_etapa(hoja_ruta_id);

    CREATE TABLE IF NOT EXISTS no_conformidad (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      numero             TEXT UNIQUE NOT NULL,
      hoja_ruta_id       INTEGER REFERENCES hoja_ruta(id) ON DELETE SET NULL,
      proyecto_id        INTEGER REFERENCES proyectos(id) ON DELETE SET NULL,
      fecha              TEXT DEFAULT '',
      tipo               TEXT DEFAULT 'Producto',
      descripcion        TEXT NOT NULL DEFAULT '',
      causa              TEXT DEFAULT '',
      detectado_por      TEXT DEFAULT '',
      accion_correctiva  TEXT DEFAULT '',
      responsable        TEXT DEFAULT '',
      fecha_limite       TEXT DEFAULT '',
      fecha_cierre       TEXT DEFAULT '',
      estado             TEXT DEFAULT 'Abierta',
      created_at         TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_nc_estado ON no_conformidad(estado);

    CREATE TABLE IF NOT EXISTS calidad_inspeccion (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      hoja_ruta_id  INTEGER REFERENCES hoja_ruta(id) ON DELETE CASCADE,
      tipo          TEXT NOT NULL,
      fecha         TEXT DEFAULT '',
      inspector     TEXT DEFAULT '',
      resultado     TEXT DEFAULT 'Aprobado',
      datos         TEXT DEFAULT '',
      observaciones TEXT DEFAULT '',
      created_at    TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_cal_insp ON calidad_inspeccion(hoja_ruta_id);
  `);

  // Migraciones: agregar columnas nuevas si no existen
  try { db.prepare("ALTER TABLE hoja_ruta_etapa ADD COLUMN criterios TEXT DEFAULT ''").run() } catch {}
  try { db.prepare("ALTER TABLE hoja_ruta_etapa ADD COLUMN medicion  TEXT DEFAULT ''").run() } catch {}

  // ── Formularios de Calidad ─────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS form21 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT UNIQUE NOT NULL,
      hoja_ruta_id INTEGER REFERENCES hoja_ruta(id) ON DELETE SET NULL,
      fecha TEXT DEFAULT '',
      pintor TEXT DEFAULT '',
      operador_granalla TEXT DEFAULT '',
      observaciones TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS form21_item (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      form21_id INTEGER NOT NULL REFERENCES form21(id) ON DELETE CASCADE,
      item INTEGER DEFAULT 0,
      partida TEXT DEFAULT '',
      nro_chapa TEXT DEFAULT '',
      espesor TEXT DEFAULT '',
      conf_a INTEGER DEFAULT 0,
      noconf_a INTEGER DEFAULT 0,
      conf_b INTEGER DEFAULT 0,
      noconf_b INTEGER DEFAULT 0,
      observacion TEXT DEFAULT '',
      verificacion TEXT DEFAULT 'Pendiente'
    );

    CREATE TABLE IF NOT EXISTS form22 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT UNIQUE NOT NULL,
      hoja_ruta_id INTEGER REFERENCES hoja_ruta(id) ON DELETE SET NULL,
      form21_numero TEXT DEFAULT '',
      controlo TEXT DEFAULT '',
      fecha TEXT DEFAULT '',
      pintura_tipo TEXT DEFAULT '',
      partida_nro TEXT DEFAULT '',
      chapa_nro TEXT DEFAULT '',
      cano_nro TEXT DEFAULT '',
      perfil_nro TEXT DEFAULT '',
      med_a TEXT DEFAULT '[]',
      med_b TEXT DEFAULT '[]',
      med_cano TEXT DEFAULT '[]',
      observaciones TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS form26 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT UNIQUE NOT NULL,
      hoja_ruta_id INTEGER REFERENCES hoja_ruta(id) ON DELETE SET NULL,
      fecha TEXT DEFAULT '',
      id_proyecto TEXT DEFAULT '',
      pintor TEXT DEFAULT '',
      controlo TEXT DEFAULT '',
      aparato TEXT DEFAULT '',
      mediciones TEXT DEFAULT '{}',
      observaciones TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS form34 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT UNIQUE NOT NULL,
      hoja_ruta_id INTEGER REFERENCES hoja_ruta(id) ON DELETE SET NULL,
      proyecto TEXT DEFAULT '',
      oc TEXT DEFAULT '',
      fecha TEXT DEFAULT '',
      soldador TEXT DEFAULT '',
      observaciones TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS form34_item (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      form34_id INTEGER NOT NULL REFERENCES form34(id) ON DELETE CASCADE,
      item INTEGER DEFAULT 0,
      nro_chapa TEXT DEFAULT '',
      codigo TEXT DEFAULT '',
      lado TEXT DEFAULT 'Externo',
      u_long_der TEXT DEFAULT '',
      u_long_izq TEXT DEFAULT '',
      u_trans_der TEXT DEFAULT '',
      u_trans_izq TEXT DEFAULT '',
      observacion TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS form10 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT UNIQUE NOT NULL,
      tema TEXT DEFAULT '',
      fecha TEXT DEFAULT '',
      expositor TEXT DEFAULT '',
      duracion TEXT DEFAULT '',
      observaciones TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS form10_asistente (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      form10_id INTEGER NOT NULL REFERENCES form10(id) ON DELETE CASCADE,
      nro_leg TEXT DEFAULT '',
      apellido_nombre TEXT DEFAULT '',
      area TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS form37 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT UNIQUE NOT NULL,
      anio INTEGER DEFAULT (CAST(strftime('%Y','now','localtime') AS INTEGER)),
      hoja_ruta_id INTEGER REFERENCES hoja_ruta(id) ON DELETE SET NULL,
      equipo_tipo TEXT DEFAULT '',
      codigo TEXT DEFAULT '',
      cliente TEXT DEFAULT '',
      proyecto TEXT DEFAULT '',
      descripcion TEXT DEFAULT '',
      fecha_fabricacion TEXT DEFAULT '',
      observaciones TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS form_epp (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT UNIQUE NOT NULL,
      empleado TEXT DEFAULT '',
      dni TEXT DEFAULT '',
      puesto TEXT DEFAULT '',
      fecha TEXT DEFAULT '',
      observaciones TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS form_epp_item (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      epp_id INTEGER NOT NULL REFERENCES form_epp(id) ON DELETE CASCADE,
      producto TEXT DEFAULT '',
      tipo_modelo TEXT DEFAULT '',
      marca TEXT DEFAULT '',
      certificacion INTEGER DEFAULT 0,
      cantidad INTEGER DEFAULT 1,
      fecha_entrega TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS form_packing (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT UNIQUE NOT NULL,
      hoja_ruta_id INTEGER REFERENCES hoja_ruta(id) ON DELETE SET NULL,
      cliente TEXT DEFAULT '',
      obra_oc TEXT DEFAULT '',
      ubicacion TEXT DEFAULT '',
      preparo TEXT DEFAULT '',
      revisado TEXT DEFAULT '',
      pallet TEXT DEFAULT '',
      bulto TEXT DEFAULT '',
      lista_nro TEXT DEFAULT '',
      fecha TEXT DEFAULT '',
      observaciones TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE TABLE IF NOT EXISTS form_packing_item (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      packing_id INTEGER NOT NULL REFERENCES form_packing(id) ON DELETE CASCADE,
      item INTEGER DEFAULT 0,
      descripcion TEXT DEFAULT '',
      codigo TEXT DEFAULT '',
      cantidad TEXT DEFAULT ''
    );
  `);

  // ── Plan / Gantt de Proyectos ──────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS proyecto_tarea (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      proyecto_id     INTEGER NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
      orden           INTEGER DEFAULT 0,
      nombre          TEXT NOT NULL DEFAULT '',
      duracion_dias   INTEGER DEFAULT 1,
      responsable     TEXT DEFAULT '',
      estado          TEXT DEFAULT 'Pendiente',
      avance          INTEGER DEFAULT 0,
      fecha_inicio_calc TEXT DEFAULT '',
      fecha_fin_calc    TEXT DEFAULT '',
      color           TEXT DEFAULT '',
      observaciones   TEXT DEFAULT '',
      created_at      TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_pt_proyecto ON proyecto_tarea(proyecto_id);

    CREATE TABLE IF NOT EXISTS proyecto_tarea_predecesora (
      tarea_id       INTEGER NOT NULL REFERENCES proyecto_tarea(id) ON DELETE CASCADE,
      predecesora_id INTEGER NOT NULL REFERENCES proyecto_tarea(id) ON DELETE CASCADE,
      PRIMARY KEY (tarea_id, predecesora_id)
    );

    -- ── Plantilla base para Gantt (Master Plan + HR) ──────────────────────────
    CREATE TABLE IF NOT EXISTS gantt_plantilla_tarea (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      grupo         TEXT DEFAULT '',
      nombre        TEXT NOT NULL,
      duracion_dias INTEGER DEFAULT 1,
      es_grupo      INTEGER DEFAULT 0,
      origen        TEXT DEFAULT 'masterplan',
      color         TEXT DEFAULT '',
      orden         INTEGER DEFAULT 0
    );

    -- ── Sets de plantillas nombradas ──────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS gantt_plantilla_set (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre      TEXT NOT NULL,
      descripcion TEXT DEFAULT '',
      created_at  TEXT DEFAULT (datetime('now','localtime'))
    );
  `);

  // Migraciones incrementales
  try { db.exec(`ALTER TABLE gantt_plantilla_tarea ADD COLUMN plantilla_set_id INTEGER DEFAULT NULL`) } catch (_) {}
}

module.exports = { db, inicializar };
