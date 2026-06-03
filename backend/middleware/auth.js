const jwt = require('jsonwebtoken');

const PERMISOS = {
  admin:      ['*'],
  gerencia:   ['read:*'],
  compras:    ['write:stock','write:compras','read:*'],
  ventas:     ['write:ventas','write:proyectos','read:*'],
  deposito:   ['write:stock','read:stock','read:compras'],
  produccion: ['write:produccion','read:stock','write:stock','read:*'],
  finanzas:   ['write:finanzas','read:*'],
  solo_lectura:['read:*'],
};

function verificarToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido o expirado' });
    req.usuario = user;
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

const ESCRITURA_STOCK    = ['admin','deposito','compras','produccion'];
const ESCRITURA_COMPRAS  = ['admin','compras'];
const ESCRITURA_VENTAS   = ['admin','ventas'];
const ESCRITURA_PROYECTOS = ['admin','ventas','produccion'];
const ESCRITURA_PRODUCCION = ['admin','produccion'];
const ESCRITURA_FINANZAS = ['admin','finanzas'];

module.exports = {
  verificarToken, requiereRol,
  ESCRITURA_STOCK, ESCRITURA_COMPRAS, ESCRITURA_VENTAS,
  ESCRITURA_PROYECTOS, ESCRITURA_PRODUCCION, ESCRITURA_FINANZAS,
};
