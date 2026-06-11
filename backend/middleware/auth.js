const jwt = require('jsonwebtoken');
const { db } = require('../db/database');

const MODULOS = ['stock','compras','ventas','proyectos','produccion','finanzas','mantenimiento','administracion','usuarios','rrhh','partes','codificacion'];

const MODULOS_LABEL = {
  stock:'Stock', compras:'Compras', ventas:'Ventas', proyectos:'Proyectos',
  produccion:'Producción', finanzas:'Finanzas', mantenimiento:'Mantenimiento',
  administracion:'Administración', usuarios:'Usuarios', rrhh:'RRHH', partes:'Partes',
  codificacion:'Codificación',
};

function getPermisosEfectivos(userId, rol) {
  if (rol === 'admin') {
    return Object.fromEntries(MODULOS.map(m => [m, { leer: true, escribir: true }]));
  }
  const rows = db.prepare('SELECT * FROM usuario_permisos WHERE usuario_id=?').all(userId);
  return Object.fromEntries(rows.map(r => [r.modulo, { leer: !!r.puede_leer, escribir: !!r.puede_escribir }]));
}

function verificarToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido o expirado' });
    req.usuario = user;
    req.permisos = getPermisosEfectivos(user.id, user.rol);
    next();
  });
}

// Helpers de permiso para usar en rutas
const puede = {
  leer:    modulo => (req, res, next) => req.permisos[modulo]?.leer     ? next() : res.status(403).json({ error: 'Sin permisos de lectura'    }),
  escribir:modulo => (req, res, next) => req.permisos[modulo]?.escribir ? next() : res.status(403).json({ error: 'Sin permisos de escritura'  }),
};

module.exports = { verificarToken, puede, getPermisosEfectivos, MODULOS, MODULOS_LABEL };
