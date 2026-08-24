const Database = require('better-sqlite3');
const path = require('path');
const fs   = require('fs');
const { formatCuit } = require('../helpers/cuit');
const { encontrarRaiz } = require('../helpers/organigrama');
if (!process.env.NODE_ENV) require('dotenv').config();

const rawPath = process.env.DB_PATH || './db/eintra_erp.db';
const dbPath  = path.isAbsolute(rawPath) ? rawPath : path.resolve(__dirname, '..', rawPath);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Para cambios de esquema NUEVOS a partir de ahora: en vez de un ALTER TABLE
// suelto con try/catch, envolverlo en migrar('nombre_unico', () => { ... }).
// Se registra en `schema_migraciones` y no vuelve a correr una vez aplicado —
// da visibilidad de qué migración corrió y cuándo. Los ALTER TABLE existentes
// (más arriba, con su propio try/catch) quedan como están: ya se aplicaron en
// producción y retocarlos no aporta nada, solo agrega riesgo.
function migrar(nombre, fn) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS schema_migraciones (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre      TEXT NOT NULL UNIQUE,
      aplicada_at TEXT DEFAULT (datetime('now','localtime'))
    )
  `).run();
  if (db.prepare('SELECT 1 FROM schema_migraciones WHERE nombre=?').get(nombre)) return;
  db.transaction(() => {
    fn();
    db.prepare('INSERT INTO schema_migraciones (nombre) VALUES (?)').run(nombre);
  })();
}

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

    CREATE TABLE IF NOT EXISTS login_intentos_fallidos (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT DEFAULT '',
      ip       TEXT DEFAULT '',
      fecha    TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_login_fallidos_fecha ON login_intentos_fallidos(fecha);

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
    CREATE INDEX IF NOT EXISTS idx_proyecto_costos_proyecto ON proyecto_costos(proyecto_id);

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
    CREATE INDEX IF NOT EXISTS idx_ot_tareas_ot ON ot_tareas(ot_id);
    CREATE INDEX IF NOT EXISTS idx_ot_partes_ot ON ot_partes(ot_id);

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
    CREATE INDEX IF NOT EXISTS idx_mov_caja_cuenta ON movimientos_caja(cuenta_id);
    CREATE INDEX IF NOT EXISTS idx_ot_estado       ON ordenes_trabajo(estado);
    CREATE INDEX IF NOT EXISTS idx_proyectos_estado ON proyectos(estado);
    CREATE INDEX IF NOT EXISTS idx_ppto_estado     ON presupuestos(estado);
    CREATE INDEX IF NOT EXISTS idx_oc_estado       ON ordenes_compra(estado);
    CREATE INDEX IF NOT EXISTS idx_oc_proveedor    ON ordenes_compra(proveedor_id);
    CREATE INDEX IF NOT EXISTS idx_oc_fecha        ON ordenes_compra(fecha);
    CREATE INDEX IF NOT EXISTS idx_oc_items_oc     ON oc_items(oc_id);
    CREATE INDEX IF NOT EXISTS idx_oc_items_producto ON oc_items(producto_id);
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
  try { db.exec(`ALTER TABLE ordenes_compra ADD COLUMN tc_control_manual REAL`) } catch(e) {}
  try { db.exec(`ALTER TABLE oc_items ADD COLUMN estado_calidad TEXT DEFAULT ''`) } catch(e) {}
  try { db.exec(`ALTER TABLE oc_items ADD COLUMN estado_factura TEXT DEFAULT ''`) } catch(e) {}
  try { db.exec(`ALTER TABLE oc_items ADD COLUMN sin_codificar INTEGER DEFAULT 0`) } catch(e) {}

  // Cuotas de facturación de una OC de compra (anticipo + saldo, avances, etc.)
  // — mismo patrón que fin_oc_cliente_cuotas, para que Control OC deje de
  // marcar como error una OC que se factura de a partes mientras todavía
  // falta la próxima cuota, en vez de comparar siempre contra el total.
  db.exec(`
    CREATE TABLE IF NOT EXISTS oc_compra_cuotas (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      oc_id          INTEGER NOT NULL REFERENCES ordenes_compra(id) ON DELETE CASCADE,
      orden          INTEGER NOT NULL DEFAULT 1,
      tipo           TEXT DEFAULT 'avance',
      pct            REAL,
      monto_planeado REAL,
      fecha_estimada TEXT DEFAULT '',
      factura_id     INTEGER REFERENCES facturas_compra(id),
      created_at     TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_oc_compra_cuotas_oc ON oc_compra_cuotas(oc_id);
    CREATE INDEX IF NOT EXISTS idx_oc_compra_cuotas_factura ON oc_compra_cuotas(factura_id);
  `);

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

  // Precios críticos: algunos materiales necesitan que su precio se revise
  // cada cierto tiempo (ej. mensual) aunque nadie haya tocado nada — sin esto
  // "precio_fecha" solo se actualiza cuando alguien lo edita a mano o entra
  // una OC nueva, y un precio viejo puede quedar sin detectarse por meses.
  // precio_frecuencia_dias en 0 = no crítico (default, la gran mayoría).
  try { db.exec(`ALTER TABLE productos ADD COLUMN precio_critico INTEGER DEFAULT 0`) } catch(e) {}
  try { db.exec(`ALTER TABLE productos ADD COLUMN precio_frecuencia_dias INTEGER DEFAULT 0`) } catch(e) {}
  // El scan de "precios vencidos" (generarPedidosVencidos en pedidosPrecio.js)
  // filtra por activo+precio_critico en cada corrida — sin este índice hace un
  // full table scan de productos cada vez.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_productos_activo_critico ON productos(activo, precio_critico)`);

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
      plan_id         INTEGER REFERENCES mant_plan(id),
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

  // ── Puestos: catálogo de plantillas de acceso, asignables 1 o más por usuario ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS puestos (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre     TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS puesto_modulos (
      puesto_id      INTEGER NOT NULL REFERENCES puestos(id) ON DELETE CASCADE,
      modulo         TEXT    NOT NULL,
      puede_leer     INTEGER NOT NULL DEFAULT 0,
      puede_escribir INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (puesto_id, modulo)
    );

    CREATE TABLE IF NOT EXISTS usuario_puestos (
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      puesto_id  INTEGER NOT NULL REFERENCES puestos(id)  ON DELETE CASCADE,
      PRIMARY KEY (usuario_id, puesto_id)
    );
  `);

  // Seed inicial del catálogo de puestos (solo si está vacío — no pisa ediciones del admin)
  const totalPuestos = db.prepare('SELECT COUNT(*) c FROM puestos').get().c;
  if (totalPuestos === 0) {
    const PUESTOS_SEED = {
      'Operario Producción / Taller': [],
      'Mantenimiento (Técnico)':      [ ['mantenimiento',1,1], ['stock',1,0] ],
      'Depósito':                     [ ['stock',1,1] ],
      'Comprador':                    [ ['compras',1,1], ['partes',1,1], ['stock',1,0] ],
      'Gerente de Compras':           [ ['compras',1,1], ['compras_informes',1,0], ['partes',1,1], ['stock',1,0] ],
      'Coordinación de Proyectos':    [ ['proyectos',1,1] ],
      'Administración':               [ ['administracion',1,1] ],
      'Vendedor':                     [ ['ventas',1,1], ['proyectos',1,0] ],
      'Gerente de Ventas':            [ ['ventas',1,1], ['proyectos',1,1], ['finanzas',1,0] ],
      'Operador de Calidad':          [ ['calidad',1,1], ['produccion',1,0], ['stock',1,0] ],
      'Auditor de Calidad':           [ ['calidad',1,1], ['rrhh',1,0], ['compras',1,0], ['stock',1,0] ],
    };
    const insPuesto = db.prepare('INSERT INTO puestos (nombre) VALUES (?)');
    const insModulo = db.prepare('INSERT INTO puesto_modulos (puesto_id,modulo,puede_leer,puede_escribir) VALUES (?,?,?,?)');
    db.transaction(() => {
      for (const [nombre, modulos] of Object.entries(PUESTOS_SEED)) {
        const puestoId = insPuesto.run(nombre).lastInsertRowid;
        for (const [modulo, leer, escribir] of modulos) insModulo.run(puestoId, modulo, leer, escribir);
      }
    })();
  }

  // Descripción del puesto (Estructura Organizacional): un puesto deja de ser
  // solo una plantilla de permisos y pasa a tener misión, responsabilidades,
  // requisitos y a quién reporta (para el organigrama).
  try { db.exec(`ALTER TABLE puestos ADD COLUMN area            TEXT DEFAULT ''`); } catch(e) {}
  try { db.exec(`ALTER TABLE puestos ADD COLUMN mision           TEXT DEFAULT ''`); } catch(e) {}
  try { db.exec(`ALTER TABLE puestos ADD COLUMN responsabilidades TEXT DEFAULT ''`); } catch(e) {}
  try { db.exec(`ALTER TABLE puestos ADD COLUMN requisitos       TEXT DEFAULT ''`); } catch(e) {}
  try { db.exec(`ALTER TABLE puestos ADD COLUMN reporta_a_id     INTEGER REFERENCES puestos(id)`); } catch(e) {}

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
      fecha           TEXT NOT NULL DEFAULT (date('now','localtime')),
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

    -- Antes se creaba de forma perezosa (al cargar routes/rrhh.js) en vez de
    -- acá con el resto del esquema — movida para que rrhh_registros y
    -- pedidos_stock puedan declarar su FK a actividad_id correctamente.
    CREATE TABLE IF NOT EXISTS rrhh_actividades (
      id     INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      activo INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS rrhh_registros (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha        TEXT NOT NULL,
      empleado_id  INTEGER REFERENCES rrhh_empleados(id) ON DELETE SET NULL,
      proyecto_id  INTEGER REFERENCES rrhh_proyectos(id),
      categoria_id INTEGER REFERENCES rrhh_categorias(id),
      hora_inicio  TEXT DEFAULT '',
      hora_fin     TEXT DEFAULT '',
      horas        REAL NOT NULL DEFAULT 0,
      modulo       TEXT DEFAULT '',
      descripcion  TEXT DEFAULT '',
      created_at   TEXT DEFAULT (datetime('now','localtime')),
      actividad_id INTEGER REFERENCES rrhh_actividades(id)
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
      empleado_id     INTEGER REFERENCES rrhh_empleados(id) ON DELETE SET NULL,
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
  // Legajo (Estructura Organizacional / Form 12): identificación y fecha de alta/baja
  try { db.exec(`ALTER TABLE rrhh_empleados ADD COLUMN dni            TEXT DEFAULT ''`); } catch(e) {}
  try { db.exec(`ALTER TABLE rrhh_empleados ADD COLUMN fecha_ingreso  TEXT DEFAULT ''`); } catch(e) {}
  try { db.exec(`ALTER TABLE rrhh_empleados ADD COLUMN fecha_egreso   TEXT DEFAULT ''`); } catch(e) {}
  // Costo por hora: dato sensible (tipo sueldo) usado por el módulo de Análisis
  // de Proyectos para calcular el costo de mano de obra — se redacta en las
  // lecturas normales de RRHH, ver CAMPOS_SENSIBLES_EMPLEADO en rrhh.js.
  try { db.exec(`ALTER TABLE rrhh_empleados ADD COLUMN costo_hora     REAL DEFAULT 0`); } catch(e) {}

  // Historial de puestos por empleado: uno o más puestos a la vez, con vigencia
  db.exec(`
    CREATE TABLE IF NOT EXISTS rrhh_empleado_puestos (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      empleado_id  INTEGER NOT NULL REFERENCES rrhh_empleados(id) ON DELETE CASCADE,
      puesto_id    INTEGER NOT NULL REFERENCES puestos(id),
      fecha_desde  TEXT NOT NULL,
      fecha_hasta  TEXT DEFAULT '',
      created_at   TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_emp_puestos_empleado ON rrhh_empleado_puestos(empleado_id);
  `);

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
  // Solo en una base recién creada: si ya hay algún empleado cargado (aunque se
  // hayan borrado otros), no volver a insertar esta lista — si no, un empleado
  // borrado "resucita" en el próximo reinicio del servidor al no haber ya fila
  // con ese nombre que bloquee el INSERT OR IGNORE.
  if (db.prepare('SELECT COUNT(*) c FROM rrhh_empleados').get().c === 0) {
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
          created_at   TEXT DEFAULT (datetime('now','localtime')),
          actividad_id INTEGER REFERENCES rrhh_actividades(id)
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

  // ── Migrar rrhh_registros.empleado_id → nullable + ON DELETE SET NULL ────────
  // Permite eliminar definitivamente un empleado inactivo y conservar sus horas
  // cargadas en proyectos (quedan sin empleado asociado) en vez de solo poder
  // desactivarlo cuando ya tiene partes cargados.
  try {
    const check2 = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='rrhh_registros'`).get();
    if (check2?.sql && !check2.sql.includes('ON DELETE SET NULL')) {
      db.pragma('foreign_keys = OFF');
      db.exec(`
        DROP TABLE IF EXISTS rrhh_registros_new;
        CREATE TABLE rrhh_registros_new (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          fecha        TEXT NOT NULL,
          empleado_id  INTEGER REFERENCES rrhh_empleados(id) ON DELETE SET NULL,
          proyecto_id  INTEGER REFERENCES proyectos(id),
          categoria_id INTEGER REFERENCES rrhh_categorias(id),
          hora_inicio  TEXT DEFAULT '',
          hora_fin     TEXT DEFAULT '',
          horas        REAL DEFAULT 0,
          modulo       TEXT DEFAULT '',
          descripcion  TEXT DEFAULT '',
          created_at   TEXT DEFAULT (datetime('now','localtime')),
          actividad_id INTEGER REFERENCES rrhh_actividades(id)
        );
        INSERT INTO rrhh_registros_new SELECT * FROM rrhh_registros;
        DROP TABLE rrhh_registros;
        ALTER TABLE rrhh_registros_new RENAME TO rrhh_registros;
        CREATE INDEX IF NOT EXISTS idx_rrhh_reg_fecha    ON rrhh_registros(fecha);
        CREATE INDEX IF NOT EXISTS idx_rrhh_reg_empleado ON rrhh_registros(empleado_id);
        CREATE INDEX IF NOT EXISTS idx_rrhh_reg_proyecto ON rrhh_registros(proyecto_id);
      `);
      db.pragma('foreign_keys = ON');
      console.log('Migración: rrhh_registros.empleado_id ahora es nullable con ON DELETE SET NULL');
    }
  } catch(e) { console.log('migration rrhh_registros empleado_id nullable:', e.message) }

  // ── Migrar rrhh_asistencia.empleado_id → ON DELETE SET NULL (mismo motivo) ───
  try {
    const check3 = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='rrhh_asistencia'`).get();
    if (check3?.sql && !check3.sql.includes('ON DELETE SET NULL')) {
      db.pragma('foreign_keys = OFF');
      db.exec(`
        CREATE TABLE rrhh_asistencia_new (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          dispositivo_id  INTEGER REFERENCES rrhh_dispositivos(id),
          empleado_id     INTEGER REFERENCES rrhh_empleados(id) ON DELETE SET NULL,
          empleado_nombre TEXT DEFAULT '',
          empleado_ext    TEXT DEFAULT '',
          fecha           TEXT NOT NULL,
          hora            TEXT NOT NULL,
          tipo_acceso     TEXT DEFAULT '',
          temperatura     REAL,
          created_at      TEXT DEFAULT (datetime('now','localtime')),
          UNIQUE(dispositivo_id, empleado_ext, fecha, hora)
        );
        INSERT INTO rrhh_asistencia_new SELECT * FROM rrhh_asistencia;
        DROP TABLE rrhh_asistencia;
        ALTER TABLE rrhh_asistencia_new RENAME TO rrhh_asistencia;
        CREATE INDEX IF NOT EXISTS idx_rrhh_asist_fecha ON rrhh_asistencia(fecha);
        CREATE INDEX IF NOT EXISTS idx_rrhh_asist_emp   ON rrhh_asistencia(empleado_id);
      `);
      db.pragma('foreign_keys = ON');
      console.log('Migración: rrhh_asistencia.empleado_id ahora tiene ON DELETE SET NULL');
    }
  } catch(e) { console.log('migration rrhh_asistencia empleado_id nullable:', e.message) }

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
    CREATE INDEX IF NOT EXISTS idx_fact_compra_oc    ON facturas_compra(oc_id);

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
  if (!colsFC.includes('nc_factura_id'))  db.prepare('ALTER TABLE facturas_compra ADD COLUMN nc_factura_id INTEGER REFERENCES facturas_compra(id)').run();
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
  if (!colsFV.includes('iva_10_5'))         db.prepare('ALTER TABLE facturas_venta ADD COLUMN iva_10_5 REAL DEFAULT 0').run();
  if (!colsFV.includes('nc_factura_id'))    db.prepare('ALTER TABLE facturas_venta ADD COLUMN nc_factura_id INTEGER REFERENCES facturas_venta(id)').run();
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
    );
    CREATE INDEX IF NOT EXISTS idx_pagos_fc ON pagos_factura_compra(factura_id);
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

  // Un pago puede cargarse en una moneda distinta a la de la factura (ej. factura en
  // USD pagada con una transferencia en pesos al TC del día) — sin esta columna,
  // pagos en moneda extranjera se sumaban como si "importe" ya fuera pesos.
  if (!colsPagosFV.includes('tasa_cambio')) db.prepare('ALTER TABLE pagos_factura_venta ADD COLUMN tasa_cambio REAL DEFAULT 1').run();
  const colsPagosFC = db.prepare('PRAGMA table_info(pagos_factura_compra)').all().map(c => c.name);
  if (!colsPagosFC.includes('tasa_cambio')) db.prepare('ALTER TABLE pagos_factura_compra ADD COLUMN tasa_cambio REAL DEFAULT 1').run();

  // Migrar anticipos existentes a pagos_factura_venta (idempotente)
  try {
    const conAnticipo = db.prepare(`
      SELECT id, anticipo, fecha_anticipo, moneda, tasa_cambio FROM facturas_venta
      WHERE anticipo > 0
      AND NOT EXISTS (SELECT 1 FROM pagos_factura_venta WHERE factura_id = facturas_venta.id)
    `).all();
    const insPago = db.prepare(`
      INSERT INTO pagos_factura_venta (factura_id, tipo, forma_pago, importe, moneda, tasa_cambio, fecha, estado)
      VALUES (?, 'anticipo', 'transferencia', ?, ?, ?, ?, 'confirmado')
    `);
    for (const f of conAnticipo) {
      insPago.run(f.id, f.anticipo, f.moneda || 'PESO', f.tasa_cambio || 1, f.fecha_anticipo || '');
    }
    if (conAnticipo.length > 0) console.log(`Migrados ${conAnticipo.length} anticipos a pagos_factura_venta`);
  } catch(e) { console.log('Migración anticipos venta:', e.message) }

  // Idem para facturas de compra — este puente nunca existió de este lado, dejando
  // anticipos ya cargados desconectados del saldo calculado a partir de los pagos.
  try {
    const conAnticipoC = db.prepare(`
      SELECT id, anticipo, fecha_anticipo, moneda, tasa_cambio FROM facturas_compra
      WHERE anticipo > 0
      AND NOT EXISTS (SELECT 1 FROM pagos_factura_compra WHERE factura_id = facturas_compra.id)
    `).all();
    const insPagoC = db.prepare(`
      INSERT INTO pagos_factura_compra (factura_id, tipo, forma_pago, importe, moneda, tasa_cambio, fecha, estado)
      VALUES (?, 'anticipo', 'transferencia', ?, ?, ?, ?, 'confirmado')
    `);
    for (const f of conAnticipoC) {
      insPagoC.run(f.id, f.anticipo, f.moneda || 'PESO', f.tasa_cambio || 1, f.fecha_anticipo || '');
    }
    if (conAnticipoC.length > 0) console.log(`Migrados ${conAnticipoC.length} anticipos a pagos_factura_compra`);
  } catch(e) { console.log('Migración anticipos compra:', e.message) }

  // Antes de esta sesión, un pago con E-CHEQ no contaba como "pagado" para la
  // factura hasta confirmar la acreditación — facturas ya saldadas solo con
  // E-CHEQ quedaron con pago_confirmado=0 (se ven "Pendiente" en Seguimiento
  // OC Compras aunque el E-CHEQ ya se entregó). pago_confirmado es un valor
  // guardado que solo se recalcula al tocar el pago de nuevo, así que hace
  // falta recalcularlo una vez con el criterio nuevo al desplegar este fix.
  const totalPesosCol = (importeCol, monedaCol, tcCol) =>
    `(CASE WHEN ${monedaCol} IN ('PESO','PESOS') OR ${monedaCol} IS NULL OR ${monedaCol}='' THEN ${importeCol} ELSE ${importeCol} * COALESCE(${tcCol},1) END)`;
  migrar('recalcular_pago_confirmado_echeq', () => {
    const pagadoC = db.prepare(`
      SELECT factura_id, COALESCE(SUM(CASE WHEN estado='confirmado' OR forma_pago='e-cheq'
        THEN ${totalPesosCol('importe', 'moneda', 'tasa_cambio')} ELSE 0 END), 0) AS total
      FROM pagos_factura_compra WHERE factura_id=?
    `);
    const facturasC = db.prepare(`
      SELECT id, importe, moneda, tasa_cambio FROM facturas_compra
      WHERE pago_confirmado = 0
        AND EXISTS (SELECT 1 FROM pagos_factura_compra WHERE factura_id = facturas_compra.id AND forma_pago='e-cheq')
    `).all();
    const updC = db.prepare("UPDATE facturas_compra SET pago_confirmado=1, updated_at=datetime('now','localtime') WHERE id=?");
    let nC = 0;
    for (const f of facturasC) {
      const totalFactura = f.moneda === 'PESO' || f.moneda === 'PESOS' || !f.moneda ? (f.importe||0) : (f.importe||0) * (f.tasa_cambio||1);
      if (pagadoC.get(f.id).total >= totalFactura - 0.01) { updC.run(f.id); nC++; }
    }

    const pagadoV = db.prepare(`
      SELECT factura_id, COALESCE(SUM(CASE WHEN estado='confirmado' OR forma_pago='e-cheq'
        THEN ${totalPesosCol('importe', 'moneda', 'tasa_cambio')} + COALESCE(ret_iibb,0)+COALESCE(ret_iva,0)+COALESCE(ret_gcia,0)+COALESCE(ret_contratista,0)+COALESCE(ret_ss,0)
        ELSE 0 END), 0) AS total
      FROM pagos_factura_venta WHERE factura_id=?
    `);
    const facturasV = db.prepare(`
      SELECT id, importe, moneda, tasa_cambio FROM facturas_venta
      WHERE pago_confirmado = 0
        AND EXISTS (SELECT 1 FROM pagos_factura_venta WHERE factura_id = facturas_venta.id AND forma_pago='e-cheq')
    `).all();
    const updV = db.prepare("UPDATE facturas_venta SET pago_confirmado=1, updated_at=datetime('now','localtime') WHERE id=?");
    let nV = 0;
    for (const f of facturasV) {
      const totalFactura = f.moneda === 'PESO' || f.moneda === 'PESOS' || !f.moneda ? (f.importe||0) : (f.importe||0) * (f.tasa_cambio||1);
      if (pagadoV.get(f.id).total >= totalFactura - 0.01) { updV.run(f.id); nV++; }
    }

    if (nC > 0 || nV > 0) console.log(`Recalculadas ${nC} facturas de compra y ${nV} de venta pagadas con E-CHEQ`);
  });

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
    );
    CREATE INDEX IF NOT EXISTS idx_tc_moneda_fecha ON tipo_cambio(moneda, fecha);
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

  // Cuotas de facturación de una OC de cliente — reemplaza el esquema fijo de
  // 2 hitos (anticipo/final) por una cantidad variable de pagos, cada uno
  // vinculable a una factura de venta real (factura_id), en vez de copiar
  // fecha/monto como hacía la pantalla vieja.
  db.exec(`
    CREATE TABLE IF NOT EXISTS fin_oc_cliente_cuotas (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      oc_cliente_id    INTEGER NOT NULL REFERENCES fin_oc_clientes(id) ON DELETE CASCADE,
      orden            INTEGER NOT NULL DEFAULT 1,
      tipo             TEXT DEFAULT 'avance',
      pct              REAL,
      monto_planeado   REAL,
      fecha_estimada   TEXT DEFAULT '',
      factura_id       INTEGER REFERENCES facturas_venta(id),
      fecha_cobro      TEXT DEFAULT '',
      pago_id          INTEGER REFERENCES pagos_factura_venta(id),
      created_at       TEXT DEFAULT (datetime('now','localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_oc_cuotas_oc ON fin_oc_cliente_cuotas(oc_cliente_id);
  `);
  try { db.exec(`ALTER TABLE fin_oc_cliente_cuotas ADD COLUMN fecha_cobro TEXT DEFAULT ''`) } catch(e) {}
  // pago_id: vincula la cuota a un pago puntual ya registrado en el modal de
  // Pagos de esa factura (confirmado/pendiente, e-cheq/transferencia, fecha de
  // acreditación real) — reemplaza tener que tipear una fecha de cobro a mano,
  // que quedaba desconectada de los pagos reales ya cargados en el sistema.
  try { db.exec(`ALTER TABLE fin_oc_cliente_cuotas ADD COLUMN pago_id INTEGER REFERENCES pagos_factura_venta(id)`) } catch(e) {}
  // A diferencia de factura_id (que sí puede repetirse entre cuotas de una
  // misma OC, porque un solo comprobante se cobra en partes), un pago_id es un
  // movimiento de dinero puntual — no puede contarse dos veces en dos cuotas.
  // Se crea recién acá (después del ALTER de arriba) para que la columna ya
  // exista en bases viejas que todavía no la tenían.
  migrar('indice_unico_pago_cuotas', () => {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_oc_cuotas_pago_unico ON fin_oc_cliente_cuotas(pago_id)');
  });

  // Caso real: una cuota se cobra combinando varios medios de pago (ej. dos
  // e-cheques + una transferencia por el total de la cuota) — la columna
  // pago_id de arriba solo admitía UN pago por cuota. Se reemplaza por esta
  // tabla de vínculo (N pagos por cuota); pago_id queda sin usarse en cuotas
  // nuevas, pero no se borra (dato histórico de cuotas cargadas antes).
  migrar('crear_fin_oc_cliente_cuota_pagos', () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS fin_oc_cliente_cuota_pagos (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        cuota_id   INTEGER NOT NULL REFERENCES fin_oc_cliente_cuotas(id) ON DELETE CASCADE,
        pago_id    INTEGER NOT NULL REFERENCES pagos_factura_venta(id),
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_cuota_pagos_pago ON fin_oc_cliente_cuota_pagos(pago_id);
      CREATE INDEX IF NOT EXISTS idx_cuota_pagos_cuota ON fin_oc_cliente_cuota_pagos(cuota_id);
    `);
    // Volcar los vínculos existentes (1 por cuota) a la tabla nueva, para no perderlos.
    const conPago = db.prepare('SELECT id, pago_id FROM fin_oc_cliente_cuotas WHERE pago_id IS NOT NULL').all();
    const ins = db.prepare('INSERT INTO fin_oc_cliente_cuota_pagos (cuota_id, pago_id) VALUES (?,?)');
    for (const c of conPago) ins.run(c.id, c.pago_id);
  });

  // Caso real: se factura el 100% de la OC en una sola factura, pero el
  // cliente la paga en cuotas/plazos — varias cuotas comparten entonces la
  // misma factura_id, cada una con su propia fecha de cobro. Por eso NO puede
  // haber una restricción UNIQUE sobre factura_id (se probó y bloqueaba este
  // caso real) — lo único que se sigue evitando es que la misma factura quede
  // vinculada a cuotas de OC *distintas* (eso sí sería un error de carga), y
  // esa validación se hace en el código de guardado, no con un índice.
  migrar('quitar_unicidad_factura_cuotas', () => {
    db.exec('DROP INDEX IF EXISTS idx_oc_cuotas_factura_unica');
    db.exec('CREATE INDEX IF NOT EXISTS idx_oc_cuotas_factura ON fin_oc_cliente_cuotas(factura_id)');
  });

  // Migración única: las OC de clientes cargadas antes de este cambio tenían
  // anticipo/final como columnas fijas — se vuelcan a cuotas equivalentes para
  // no perder ese dato. No se intenta vincular automáticamente ninguna factura
  // (sería un emparejamiento frágil por fecha/monto) — quedan para vincularse
  // a mano una vez desde la pantalla nueva.
  migrar('migrar_fin_oc_clientes_a_cuotas', () => {
    const filas = db.prepare(`
      SELECT id, anticipo_pct, monto_anticipo_usd, final_pct, monto_final_usd
      FROM fin_oc_clientes
      WHERE (anticipo_pct IS NOT NULL) OR (final_pct IS NOT NULL)
    `).all();
    const ins = db.prepare(`
      INSERT INTO fin_oc_cliente_cuotas (oc_cliente_id, orden, tipo, pct, monto_planeado)
      VALUES (?,?,?,?,?)
    `);
    for (const f of filas) {
      if (f.anticipo_pct != null) ins.run(f.id, 1, 'anticipo', f.anticipo_pct, f.monto_anticipo_usd);
      if (f.final_pct != null)    ins.run(f.id, 2, 'saldo_final', f.final_pct, f.monto_final_usd);
    }
  });

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
    CREATE INDEX IF NOT EXISTS idx_nc_hoja_ruta ON no_conformidad(hoja_ruta_id);

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

  // ── Control de documentos de Calidad (ISO 9001:2015, cláusula 7.5) ────────────
  migrar('crear_documentos_calidad', () => {
    db.exec(`
      CREATE TABLE documentos_calidad (
        id                      INTEGER PRIMARY KEY AUTOINCREMENT,
        codigo                  TEXT NOT NULL,
        titulo                  TEXT NOT NULL,
        categoria               TEXT NOT NULL DEFAULT 'Procedimiento' CHECK(categoria IN ('Manual','Política','Procedimiento','Instructivo','Registro')),
        revision                INTEGER NOT NULL DEFAULT 0,
        estado                  TEXT NOT NULL DEFAULT 'Vigente' CHECK(estado IN ('Vigente','Obsoleto')),
        archivo_path            TEXT NOT NULL,
        archivo_nombre_original TEXT DEFAULT '',
        aprobado_por            TEXT DEFAULT '',
        fecha_aprobacion        TEXT DEFAULT '',
        observaciones           TEXT DEFAULT '',
        documento_anterior_id   INTEGER REFERENCES documentos_calidad(id),
        created_by              INTEGER REFERENCES usuarios(id),
        created_at              TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX idx_doc_calidad_codigo ON documentos_calidad(codigo);
    `)
  })

  // ── Objetivos de Calidad medibles (ISO 9001:2015, cláusula 6.2) ───────────────
  migrar('crear_objetivos_calidad', () => {
    db.exec(`
      CREATE TABLE objetivo_calidad (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre                TEXT NOT NULL,
        descripcion           TEXT DEFAULT '',
        fuente                TEXT NOT NULL DEFAULT 'manual'
          CHECK(fuente IN ('nc_cerradas_plazo','ot_entregas_tiempo','eval_proveedores_puntaje','inspecciones_aprobadas','manual')),
        meta                  REAL NOT NULL,
        unidad                TEXT NOT NULL DEFAULT '%',
        periodicidad          TEXT NOT NULL DEFAULT 'anual' CHECK(periodicidad IN ('mensual','trimestral','anual')),
        responsable_puesto_id INTEGER REFERENCES puestos(id),
        responsable_nombre    TEXT DEFAULT '',
        estado                TEXT NOT NULL DEFAULT 'Activo' CHECK(estado IN ('Activo','Cerrado')),
        created_by            INTEGER REFERENCES usuarios(id),
        created_at            TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE TABLE objetivo_calidad_medicion (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        objetivo_id   INTEGER NOT NULL REFERENCES objetivo_calidad(id) ON DELETE CASCADE,
        periodo       TEXT NOT NULL,
        valor         REAL NOT NULL,
        observaciones TEXT DEFAULT '',
        created_by    INTEGER REFERENCES usuarios(id),
        created_at    TEXT DEFAULT (datetime('now','localtime')),
        UNIQUE(objetivo_id, periodo)
      );
    `)
  })

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
  try { db.exec(`ALTER TABLE proyecto_tarea ADD COLUMN area_responsable TEXT DEFAULT ''`) } catch (_) {}

  // ── Cambio de contraseña obligatorio (seguridad): NULL = todavía no la
  // cambió por su cuenta (usuario nuevo, contraseña reseteada por un admin, o
  // un admin pidió el cambio vía PATCH /usuarios/:id/forzar-cambio-password) —
  // /auth/login exige cambiarla mientras esté en NULL. No hace falta ningún
  // backfill aparte: alcanza con agregar la columna para que todos los
  // usuarios existentes queden con NULL y les toque cambiarla en su próximo login.
  migrar('password_changed_at', () => {
    db.exec(`ALTER TABLE usuarios ADD COLUMN password_changed_at TEXT`);
  });

  // ── Pedido de Stock: solicitud interna de materiales ──────────────────────────
  // Un usuario con permiso de "pedidos_stock" pide materiales del catálogo; queda
  // pendiente hasta que alguien con permiso de "stock" confirma la entrega (total
  // o parcial) — recién ahí se descuenta stock_actual y queda el movimiento en el
  // kardex (movimientos_stock, tipo_doc='pedido_stock'), igual que ya se hace con
  // los ingresos de una OC.
  migrar('crear_pedidos_stock', () => {
    db.exec(`
      CREATE TABLE pedidos_stock (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        fecha              TEXT DEFAULT (datetime('now','localtime')),
        solicitante_id     INTEGER REFERENCES usuarios(id),
        solicitante_nombre TEXT DEFAULT '',
        estado             TEXT NOT NULL DEFAULT 'Pendiente' CHECK(estado IN ('Pendiente','Parcial','Entregado','Cancelado')),
        observaciones      TEXT DEFAULT '',
        proyecto_id        INTEGER,
        actividad_id       INTEGER REFERENCES rrhh_actividades(id),
        created_at         TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX idx_pedido_stock_solicitante ON pedidos_stock(solicitante_id);
      CREATE INDEX idx_pedido_stock_estado ON pedidos_stock(estado);

      CREATE TABLE pedido_stock_items (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        pedido_id          INTEGER NOT NULL REFERENCES pedidos_stock(id) ON DELETE CASCADE,
        producto_id        INTEGER NOT NULL REFERENCES productos(id),
        cantidad           REAL NOT NULL,
        cantidad_entregada REAL DEFAULT 0
      );
      CREATE INDEX idx_pedido_stock_items_pedido ON pedido_stock_items(pedido_id);
    `);
  });

  // Corrige instalaciones donde 'crear_pedidos_stock' ya corrió con el
  // esquema viejo (proyecto en texto libre, sin proyecto_id/actividad_id).
  migrar('pedidos_stock_agrega_proyecto_actividad', () => {
    const cols = db.prepare("PRAGMA table_info(pedidos_stock)").all().map(c => c.name);
    if (!cols.includes('proyecto_id'))  db.exec(`ALTER TABLE pedidos_stock ADD COLUMN proyecto_id INTEGER`);
    if (!cols.includes('actividad_id')) db.exec(`ALTER TABLE pedidos_stock ADD COLUMN actividad_id INTEGER REFERENCES rrhh_actividades(id)`);
  });

  // Normaliza a formato XX-XXXXXXXX-X todos los CUIT ya guardados (venían sin
  // guiones o con formatos mezclados, cargados a mano antes de que el propio
  // formulario los normalizara). Reformatea solo cuando cambia algo.
  migrar('normalizar_formato_cuit', () => {
    const tablas = [
      { tabla: 'proveedores',       col: 'cuit' },
      { tabla: 'clientes',          col: 'cuit' },
      { tabla: 'ordenes_compra',    col: 'proveedor_cuit' },
      { tabla: 'presupuestos',      col: 'cli_cuit' },
      { tabla: 'form49_ingresos',   col: 'proveedor_cuit' },
      { tabla: 'facturas_compra',   col: 'cuit' },
    ];
    for (const { tabla, col } of tablas) {
      const cols = db.prepare(`PRAGMA table_info(${tabla})`).all().map(c => c.name);
      if (!cols.includes(col)) continue;
      const filas = db.prepare(`SELECT rowid AS _rowid, ${col} AS valor FROM ${tabla} WHERE ${col} IS NOT NULL AND ${col} != ''`).all();
      const upd = db.prepare(`UPDATE ${tabla} SET ${col}=? WHERE rowid=?`);
      for (const f of filas) {
        const normalizado = formatCuit(f.valor);
        if (normalizado !== f.valor) upd.run(normalizado, f._rowid);
      }
    }
  });

  // Permite asignar a mano a qué gerencia pertenece cada módulo (antes se
  // deducía siempre del organigrama vía puesto_modulos) — sin fila para un
  // módulo, se sigue deduciendo automático como hasta ahora.
  migrar('crear_modulo_gerencia', () => {
    db.exec(`
      CREATE TABLE modulo_gerencia (
        modulo    TEXT PRIMARY KEY,
        puesto_id INTEGER NOT NULL REFERENCES puestos(id) ON DELETE CASCADE
      );
    `);
    // Semilla el comportamiento que ya venía funcionando (Finanzas siempre en
    // la gerencia general) como configuración explícita editable, pero solo
    // si ya hay un organigrama real armado — de instalaciones nuevas (solo
    // con los puestos de demostración, sin jerarquía real) no hay de dónde
    // deducir una raíz confiable todavía.
    const puestos = db.prepare('SELECT id, reporta_a_id FROM puestos').all();
    const raiz = encontrarRaiz(puestos);
    if (raiz && raiz._descendientes > 0) {
      db.prepare('INSERT OR IGNORE INTO modulo_gerencia (modulo, puesto_id) VALUES (?,?)').run('finanzas', raiz.id);
    }
  });

  // Un admin puede "ser" cualquier usuario (POST /auth/impersonate/:id) sin
  // pedirle la contraseña — útil para soporte, pero sin rastro quedaba sin
  // forma de auditar quién operó como quién. admin_id nulo = login normal.
  migrar('login_log_admin_id', () => {
    db.exec(`ALTER TABLE login_log ADD COLUMN admin_id INTEGER REFERENCES usuarios(id)`);
  });

  // precio_fecha se agregó con default '' (ver ALTER TABLE más arriba) y desde
  // entonces solo se completa cuando alguien vuelve a tocar el precio de ESE
  // material puntual — los materiales que ya tenían precio cargado antes de
  // este cambio quedaron con la fecha en blanco y no se completan solos. Se
  // rellena una única vez con la mejor fecha disponible (updated_at o, si no
  // hay, created_at) para que no se vean vacíos para siempre.
  migrar('backfill_precio_fecha_productos', () => {
    db.exec(`
      UPDATE productos
      SET precio_fecha = substr(COALESCE(NULLIF(updated_at,''), created_at), 1, 10)
      WHERE precio_costo > 0 AND (precio_fecha IS NULL OR precio_fecha = '')
    `);
  });

  // "Pedido de precio": desde Materiales o Análisis de Proyectos, cualquiera
  // puede marcar que un material necesita que Administración le cargue el
  // precio de costo — mismo espíritu que pedidos_stock (solicitud liviana,
  // resuelta por alguien de otro sector), pero acá no hace falta un permiso
  // de módulo nuevo: pedir es abierto a cualquier usuario logueado, y resolver
  // ya lo puede hacer cualquiera con permiso de escritura de "administracion".
  migrar('crear_materiales_pedidos_precio', () => {
    db.exec(`
      CREATE TABLE materiales_pedidos_precio (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        producto_id        INTEGER NOT NULL REFERENCES productos(id),
        solicitante_id     INTEGER REFERENCES usuarios(id),
        solicitante_nombre TEXT DEFAULT '',
        estado             TEXT NOT NULL DEFAULT 'Pendiente' CHECK(estado IN ('Pendiente','Resuelto','Cancelado')),
        observaciones      TEXT DEFAULT '',
        created_at         TEXT DEFAULT (datetime('now','localtime')),
        resuelto_at        TEXT DEFAULT ''
      );
      CREATE INDEX idx_pedido_precio_producto ON materiales_pedidos_precio(producto_id);
      CREATE INDEX idx_pedido_precio_estado ON materiales_pedidos_precio(estado);
    `);
  });

  // Bug ya corregido en el código (actualizarCatalogoDesdeOC en compras.js
  // copiaba el precio de la OC al catálogo pero nunca el proveedor) dejó
  // materiales con precio cargado por OC pero sin proveedor. Se completa una
  // única vez con el proveedor de la OC más reciente que tenga ese material,
  // SOLO para los que hoy están sin proveedor — nunca pisa uno ya cargado a mano.
  migrar('backfill_proveedor_productos_desde_oc', () => {
    db.exec(`
      UPDATE productos
      SET proveedor = (
        SELECT oc.proveedor_nombre
        FROM oc_items oi
        JOIN ordenes_compra oc ON oc.id = oi.oc_id
        WHERE oi.producto_id = productos.id AND oc.proveedor_nombre != ''
        ORDER BY oc.fecha DESC, oc.id DESC
        LIMIT 1
      )
      WHERE (proveedor IS NULL OR proveedor = '') AND EXISTS (
        SELECT 1 FROM oc_items oi
        JOIN ordenes_compra oc ON oc.id = oi.oc_id
        WHERE oi.producto_id = productos.id AND oc.proveedor_nombre != ''
      )
    `);
  });

  // Costeo de Equipos: reemplaza la planilla Excel que usa el gerente de
  // Ingeniería para cotizar plantas/equipos (materiales + mano de obra, por
  // "módulo" de equipo, con un margen sobre cada uno). Un costeo completo se
  // guarda de una — el frontend manda el documento entero (módulos + ítems) en
  // cada guardado, reemplazando lo anterior, en vez de altas/bajas item por
  // item (misma idea que ya se usa para oc_items).
  migrar('crear_costeo_equipos', () => {
    db.exec(`
      CREATE TABLE costeos_equipos (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre             TEXT NOT NULL DEFAULT '',
        cliente            TEXT DEFAULT '',
        fecha              TEXT DEFAULT (date('now','localtime')),
        utilidad_material  REAL DEFAULT 1.8,
        utilidad_mano_obra REAL DEFAULT 1.8,
        utilidad_extra     REAL DEFAULT 1.05,
        tipo_cambio        REAL DEFAULT 0,
        observaciones      TEXT DEFAULT '',
        creado_por         INTEGER REFERENCES usuarios(id),
        created_at         TEXT DEFAULT (datetime('now','localtime')),
        updated_at         TEXT DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE costeo_modulos (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        costeo_id  INTEGER NOT NULL REFERENCES costeos_equipos(id) ON DELETE CASCADE,
        orden      INTEGER NOT NULL DEFAULT 1,
        nombre     TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX idx_costeo_modulos_costeo ON costeo_modulos(costeo_id);

      CREATE TABLE costeo_items (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        modulo_id        INTEGER NOT NULL REFERENCES costeo_modulos(id) ON DELETE CASCADE,
        orden            INTEGER NOT NULL DEFAULT 1,
        tipo             TEXT NOT NULL DEFAULT 'material' CHECK(tipo IN ('material','mano_obra','otro')),
        producto_id      INTEGER REFERENCES productos(id),
        descripcion      TEXT NOT NULL DEFAULT '',
        unidad           TEXT DEFAULT '',
        cantidad         REAL DEFAULT 0,
        precio_unitario  REAL DEFAULT 0
      );
      CREATE INDEX idx_costeo_items_modulo ON costeo_items(modulo_id);
    `);
  });

  // El primer deploy de "Costeo de Equipos" creó costeo_items con
  // CHECK(tipo IN ('material','mano_obra')) — el tipo 'otro' (material que
  // todavía no está en el catálogo) se agregó después, pero un CHECK ya
  // creado no se puede ensanchar con ALTER TABLE en SQLite: hay que
  // reconstruir la tabla. Esto es lo que causaba el "Error interno del
  // servidor" al guardar un costeo en instalaciones donde la tabla ya
  // existía de antes — acá se reconstruye preservando todos los datos.
  // Si la tabla ya tenía el CHECK correcto (instalación nueva), esto solo
  // copia las mismas filas sin cambiar nada — inofensivo.
  migrar('costeo_items_permite_tipo_otro', () => {
    db.exec(`
      CREATE TABLE costeo_items_nuevo (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        modulo_id        INTEGER NOT NULL REFERENCES costeo_modulos(id) ON DELETE CASCADE,
        orden            INTEGER NOT NULL DEFAULT 1,
        tipo             TEXT NOT NULL DEFAULT 'material' CHECK(tipo IN ('material','mano_obra','otro')),
        producto_id      INTEGER REFERENCES productos(id),
        descripcion      TEXT NOT NULL DEFAULT '',
        unidad           TEXT DEFAULT '',
        cantidad         REAL DEFAULT 0,
        precio_unitario  REAL DEFAULT 0
      );
      INSERT INTO costeo_items_nuevo (id, modulo_id, orden, tipo, producto_id, descripcion, unidad, cantidad, precio_unitario)
        SELECT id, modulo_id, orden, tipo, producto_id, descripcion, unidad, cantidad, precio_unitario FROM costeo_items;
      DROP TABLE costeo_items;
      ALTER TABLE costeo_items_nuevo RENAME TO costeo_items;
      CREATE INDEX idx_costeo_items_modulo ON costeo_items(modulo_id);
    `);
  });

  // El código del material iba pegado adelante de la descripción
  // ("COD0001 — nombre"), lo que hacía imposible tener una columna de código
  // propia. Se agrega la columna y, para los ítems que ya vienen de un
  // material del catálogo (producto_id), se separa el código que la propia
  // app había concatenado — es reconocible porque empieza exactamente con
  // "<código del producto> — ".
  migrar('agrega_codigo_costeo_items', () => {
    db.exec(`ALTER TABLE costeo_items ADD COLUMN codigo TEXT DEFAULT ''`)
    const rows = db.prepare(`
      SELECT ci.id, ci.descripcion, p.codigo AS codigo_producto
      FROM costeo_items ci JOIN productos p ON p.id = ci.producto_id
      WHERE ci.producto_id IS NOT NULL AND ci.descripcion LIKE p.codigo || ' — %'
    `).all()
    const actualizar = db.prepare(`UPDATE costeo_items SET codigo=?, descripcion=? WHERE id=?`)
    for (const r of rows) {
      actualizar.run(r.codigo_producto, r.descripcion.slice((r.codigo_producto + ' — ').length), r.id)
    }
  })

  // Todo retiro de stock (pedido o salida directa) tiene que quedar con quién
  // lo autorizó — antes no había ningún campo para eso. Se guarda tanto el id
  // (para poder mandarle la notificación) como el nombre (para que el dato
  // sobreviva aunque a ese usuario lo desactiven después).
  migrar('agrega_autorizante_retiro_stock', () => {
    db.exec(`
      ALTER TABLE pedidos_stock ADD COLUMN autorizado_por_id INTEGER REFERENCES usuarios(id);
      ALTER TABLE pedidos_stock ADD COLUMN autorizado_por_nombre TEXT DEFAULT '';
      ALTER TABLE movimientos_stock ADD COLUMN autorizado_por_id INTEGER REFERENCES usuarios(id);
      ALTER TABLE movimientos_stock ADD COLUMN autorizado_por_nombre TEXT DEFAULT '';
    `)
  })
}

module.exports = { db, inicializar, migrar };
