require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const { inicializar, db } = require('./db/database');
const { generarCuotasDelMes } = require('./helpers/servicios');

const app  = express();
const PORT = process.env.PORT || 3002;
const isProd = process.env.NODE_ENV === 'production';

// Un error no atrapado en un handler async no debe tumbar el proceso en silencio:
// se loguea y, para uncaughtException (estado potencialmente inconsistente), se
// sale del proceso para que PM2 lo reinicie limpio.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  process.exit(1);
});

inicializar();

// Genera las cuotas "pendiente, monto 0" de los servicios recurrentes del mes
// en curso — al arrancar, y una vez por día para que el rollover de mes se
// detecte sin depender de que el proceso se reinicie justo el día 1.
function correrGeneracionCuotasServicios() {
  try {
    const generadas = generarCuotasDelMes();
    if (generadas > 0) console.log(`[servicios] ${generadas} cuota(s) pendiente(s) generada(s) para el mes en curso.`);
  } catch (e) {
    console.error('[servicios] Error generando cuotas del mes:', e);
  }
}
correrGeneracionCuotasServicios();
setInterval(correrGeneracionCuotasServicios, 24 * 60 * 60 * 1000);

if (!isProd) {
  app.use(cors({ origin: 'http://localhost:5174', credentials: true }));
}
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Enmascara montos reales en cualquier respuesta JSON para un usuario cuyo
// puesto está marcado `oculta_montos` (ej. Auditoría de Calidad) — ver
// helpers/masking.js. Se registra acá, antes de montar las rutas, pero solo
// ENVUELVE res.json sin invocarlo: para cuando efectivamente se manda la
// respuesta (adentro del handler de cada ruta) verificarToken ya corrió y
// req.usuario/req.permisos ya existen, así que el orden de registro no
// afecta la lectura diferida de req.usuario. Es un override por-request (no
// un patch al prototipo de Express), así que no hay riesgo de que una
// request pise el res.json de otra.
const { enmascarar, usuarioOcultaMontos } = require('./helpers/masking');
app.use((req, res, next) => {
  const original = res.json.bind(res);
  res.json = body => {
    if (req.usuario?.rol !== 'admin' && usuarioOcultaMontos(req.usuario?.id)) body = enmascarar(body);
    return original(body);
  };
  next();
});

const uploadsDir = process.env.UPLOADS_PATH || path.resolve(__dirname, '../uploads');
// Los documentos de Calidad son sensibles (pueden requerir revocarse el acceso
// cuando pasan a obsoletos) — se descargan solo por la ruta autenticada
// GET /api/v1/calidad/documentos/:id/archivo, nunca de forma estática/pública.
app.use('/uploads/documentos_calidad', (req, res) => res.status(403).json({ error: 'Acceso restringido' }));
// Mismo criterio para Entrega de Documentación de Proyectos: el permiso liviano
// entrega_documentacion controla el acceso vía GET /:id/entregas-doc/:ent_id/archivo
// (proyectos.js) — servir esta carpeta de forma estática bypasearía ese chequeo.
app.use('/uploads/entregas_doc', (req, res) => res.status(403).json({ error: 'Acceso restringido' }));
app.use('/uploads', express.static(uploadsDir));

// Health-check: para monitoreo externo y para el propio deploy (ver deploy.ps1)
app.get('/api/v1/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ ok: true, uptime: process.uptime(), timestamp: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

app.use('/api/v1/auth',       require('./routes/auth'));
app.use('/api/v1/stock',      require('./routes/stock'));
app.use('/api/v1/compras',    require('./routes/compras'));
app.use('/api/v1/ventas',     require('./routes/ventas'));
app.use('/api/v1/proyectos',  require('./routes/proyectos'));
app.use('/api/v1/analisis-proyectos', require('./routes/analisisProyectos'));
app.use('/api/v1/costeo-equipos', require('./routes/costeoEquipos'));
app.use('/api/v1/produccion', require('./routes/produccion'));
app.use('/api/v1/finanzas',   require('./routes/finanzas'));
app.use('/api/v1/dashboard',  require('./routes/dashboard'));
app.use('/api/v1/mantenimiento', require('./routes/mantenimiento'));
app.use('/api/v1/evaluaciones',  require('./routes/evaluaciones'));
app.use('/api/v1/rrhh',          require('./routes/rrhh'));
app.use('/api/v1/codificacion',        require('./routes/codificacion'));
app.use('/api/v1/materiales',    require('./routes/materiales'));
app.use('/api/v1/pedidos-precio', require('./routes/pedidosPrecio'));
app.use('/api/v1/configuracion', require('./routes/configuracion'));
app.use('/api/v1/mensajes',      require('./routes/mensajes'));
app.use('/api/v1/crm',           require('./routes/crm'));
app.use('/api/v1/calidad',       require('./routes/calidad'));
app.use('/api/v1/formularios',   require('./routes/formularios'));
app.use('/api/v1/gantt',         require('./routes/gantt'));
app.use('/api/v1/facturas',      require('./routes/facturas'));
app.use('/api/v1/tareas-gerencia', require('./routes/tareasGerencia'));
app.use('/api/v1/venta-repuestos', require('./routes/ventaRepuestos'));
app.use('/api/v1/substock',        require('./routes/substock'));

const frontendDist = isProd
  ? (process.env.FRONTEND_DIST || path.resolve(__dirname, '../frontend/dist'))
  : null;
if (frontendDist && fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/') && !req.path.startsWith('/uploads/'))
      res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

app.use((err, req, res, _next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Error interno del servidor', ...(isProd ? {} : { detalle: err.message }) });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ERP E-INTRA → http://localhost:${PORT}`);
});

// HTTPS opcional (necesario para que el service worker / instalación de la PWA
// funcione fuera de localhost) — solo se levanta si existen los certificados en
// backend/certs/. Corre en paralelo al servidor HTTP, no lo reemplaza.
const HTTPS_PORT  = process.env.HTTPS_PORT || 3443;
const SSL_KEY     = process.env.SSL_KEY_PATH  || path.resolve(__dirname, 'certs/key.pem');
const SSL_CERT    = process.env.SSL_CERT_PATH || path.resolve(__dirname, 'certs/cert.pem');
if (fs.existsSync(SSL_KEY) && fs.existsSync(SSL_CERT)) {
  const https = require('https');
  https.createServer({ key: fs.readFileSync(SSL_KEY), cert: fs.readFileSync(SSL_CERT) }, app)
    .listen(HTTPS_PORT, '0.0.0.0', () => {
      console.log(`ERP E-INTRA (HTTPS) → https://localhost:${HTTPS_PORT}`);
    });
} else {
  console.log('[https] Certificados no encontrados en backend/certs/ — solo corre HTTP.');
}

module.exports = { app };
