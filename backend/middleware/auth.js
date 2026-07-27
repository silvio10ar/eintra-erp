const jwt = require('jsonwebtoken');
const { db } = require('../db/database');

const MODULOS = ['stock','compras','ventas','proyectos','produccion','finanzas','mantenimiento','administracion','usuarios','rrhh','partes','codificacion','materiales','calidad','crm','compras_fusion','compras_informes'];

const MODULOS_LABEL = {
  stock:'Stock', compras:'Compras', ventas:'Ventas', proyectos:'Proyectos',
  produccion:'Producción', finanzas:'Finanzas', mantenimiento:'Mantenimiento',
  administracion:'Administración', usuarios:'Usuarios', rrhh:'RRHH', partes:'Partes',
  codificacion:'Codificación', materiales:'Materiales', calidad:'Calidad', crm:'CRM',
  compras_fusion:'Compras — Fusión de proveedores', compras_informes:'Compras — Informes y exportación',
};

// padre → [submodulos]: acceso al padre otorga el mismo acceso a todos sus submodulos
const JERARQUIA = {
  rrhh:    ['partes'],
  compras: ['codificacion', 'materiales'],
  ventas:  ['crm'],
};

function getPermisosEfectivos(userId, rol) {
  if (rol === 'admin') {
    return Object.fromEntries(MODULOS.map(m => [m, { leer: true, escribir: true }]));
  }
  const rows = db.prepare('SELECT * FROM usuario_permisos WHERE usuario_id=?').all(userId);
  const permisos = Object.fromEntries(rows.map(r => [r.modulo, { leer: !!r.puede_leer, escribir: !!r.puede_escribir }]));

  // Puestos asignados: sus módulos se suman (OR) a los permisos individuales de arriba
  const puestoRows = db.prepare(`
    SELECT pm.modulo, pm.puede_leer, pm.puede_escribir
    FROM usuario_puestos up
    JOIN puesto_modulos pm ON pm.puesto_id = up.puesto_id
    WHERE up.usuario_id = ?
  `).all(userId);
  for (const pr of puestoRows) {
    const actual = permisos[pr.modulo] || { leer: false, escribir: false };
    permisos[pr.modulo] = {
      leer:     actual.leer     || !!pr.puede_leer,
      escribir: actual.escribir || !!pr.puede_escribir,
    };
  }

  // Herencia: si tiene el módulo padre, otorga mismo acceso a sus submodulos
  for (const [padre, hijos] of Object.entries(JERARQUIA)) {
    if (permisos[padre]) {
      for (const hijo of hijos) {
        if (!permisos[hijo]) permisos[hijo] = { ...permisos[padre] };
      }
    }
  }
  return permisos;
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

module.exports = { verificarToken, puede, getPermisosEfectivos, MODULOS, MODULOS_LABEL, JERARQUIA };
