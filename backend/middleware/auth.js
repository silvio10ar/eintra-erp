const jwt = require('jsonwebtoken');
const { db } = require('../db/database');

const MODULOS = ['stock','compras','ventas','proyectos','produccion','finanzas','mantenimiento','administracion','usuarios'];

function getPermisosEfectivos(userId, rol) {
  if (rol === 'admin') {
    return Object.fromEntries(MODULOS.map(m => [m, { leer: true, escribir: true }]));
  }
  const rows = db.prepare(`
    SELECT rp.modulo,
           MAX(rp.puede_leer)     as leer,
           MAX(rp.puede_escribir) as escribir
    FROM   usuario_roles ur
    JOIN   rol_permisos rp ON rp.rol_id = ur.rol_id
    JOIN   roles r         ON r.id = ur.rol_id AND r.activo = 1
    WHERE  ur.usuario_id = ?
    GROUP  BY rp.modulo
  `).all(userId);
  return Object.fromEntries(rows.map(r => [r.modulo, { leer: !!r.leer, escribir: !!r.escribir }]));
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

function requiereRol(...roles) {
  return (req, res, next) => {
    if (req.usuario.rol === 'admin') return next();
    if (!roles.includes(req.usuario.rol))
      return res.status(403).json({ error: 'Sin permisos para esta operación' });
    next();
  };
}

// Helpers de permiso para usar en rutas
const puede = {
  leer:    modulo => (req, res, next) => req.permisos[modulo]?.leer     ? next() : res.status(403).json({ error: 'Sin permisos de lectura'    }),
  escribir:modulo => (req, res, next) => req.permisos[modulo]?.escribir ? next() : res.status(403).json({ error: 'Sin permisos de escritura'  }),
};

module.exports = {
  verificarToken, requiereRol, puede, getPermisosEfectivos, MODULOS,
  // Mantenidos por compatibilidad (ya no los usa el middleware pero los importan las rutas)
  ESCRITURA_STOCK:     ['admin','deposito','compras','produccion'],
  ESCRITURA_COMPRAS:   ['admin','compras'],
  ESCRITURA_VENTAS:    ['admin','ventas'],
  ESCRITURA_PROYECTOS: ['admin','ventas','produccion'],
  ESCRITURA_PRODUCCION:['admin','produccion'],
  ESCRITURA_FINANZAS:  ['admin','finanzas'],
};
