require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const { inicializar, db } = require('./db/database');

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

if (!isProd) {
  app.use(cors({ origin: 'http://localhost:5174', credentials: true }));
}
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const uploadsDir = process.env.UPLOADS_PATH || path.resolve(__dirname, '../uploads');
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
app.use('/api/v1/produccion', require('./routes/produccion'));
app.use('/api/v1/finanzas',   require('./routes/finanzas'));
app.use('/api/v1/dashboard',  require('./routes/dashboard'));
app.use('/api/v1/mantenimiento', require('./routes/mantenimiento'));
app.use('/api/v1/evaluaciones',  require('./routes/evaluaciones'));
app.use('/api/v1/rrhh',          require('./routes/rrhh'));
app.use('/api/v1/codificacion',        require('./routes/codificacion'));
app.use('/api/v1/codificacion-futura', require('./routes/codificacion-futura'));
app.use('/api/v1/materiales',    require('./routes/materiales'));
app.use('/api/v1/configuracion', require('./routes/configuracion'));
app.use('/api/v1/mensajes',      require('./routes/mensajes'));
app.use('/api/v1/crm',           require('./routes/crm'));
app.use('/api/v1/calidad',       require('./routes/calidad'));
app.use('/api/v1/formularios',   require('./routes/formularios'));
app.use('/api/v1/gantt',         require('./routes/gantt'));
app.use('/api/v1/facturas',      require('./routes/facturas'));

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

module.exports = { app };
