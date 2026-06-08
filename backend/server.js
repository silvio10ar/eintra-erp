require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const { inicializar } = require('./db/database');

const app  = express();
const PORT = process.env.PORT || 3002;
const isProd = process.env.NODE_ENV === 'production';

inicializar();

if (!isProd) {
  app.use(cors({ origin: 'http://localhost:5174', credentials: true }));
}
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

const uploadsDir = process.env.UPLOADS_PATH || path.resolve(__dirname, '../uploads');
app.use('/uploads', express.static(uploadsDir));

app.use('/api/v1/auth',       require('./routes/auth'));
app.use('/api/v1/stock',      require('./routes/stock'));
app.use('/api/v1/compras',    require('./routes/compras'));
app.use('/api/v1/ventas',     require('./routes/ventas'));
app.use('/api/v1/proyectos',  require('./routes/proyectos'));
app.use('/api/v1/produccion', require('./routes/produccion'));
app.use('/api/v1/finanzas',   require('./routes/finanzas'));
app.use('/api/v1/dashboard',  require('./routes/dashboard'));
app.use('/api/v1/roles',         require('./routes/roles'));
app.use('/api/v1/mantenimiento', require('./routes/mantenimiento'));
app.use('/api/v1/evaluaciones',  require('./routes/evaluaciones'));

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
  res.status(500).json({ error: 'Error interno del servidor', detalle: err.message });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ERP E-INTRA → http://localhost:${PORT}`);
});

module.exports = { app };
