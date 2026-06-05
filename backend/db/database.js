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

  // ── Sistema de roles con permisos ────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS roles (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre      TEXT UNIQUE NOT NULL,
      descripcion TEXT DEFAULT '',
      activo      INTEGER DEFAULT 1,
      created_at  TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE TABLE IF NOT EXISTS rol_permisos (
      rol_id         INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      modulo         TEXT NOT NULL,
      puede_leer     INTEGER DEFAULT 0,
      puede_escribir INTEGER DEFAULT 0,
      PRIMARY KEY (rol_id, modulo)
    );

    CREATE TABLE IF NOT EXISTS usuario_roles (
      usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      rol_id     INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      PRIMARY KEY (usuario_id, rol_id)
    );
  `);

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
