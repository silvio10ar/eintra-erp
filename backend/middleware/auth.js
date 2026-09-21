const jwt = require('jsonwebtoken');
const { db } = require('../db/database');

// "tareas_gerencia" (Mis Tareas) no es un módulo con permiso asignable — es
// abierto a cualquier usuario autenticado, ver routes/tareasGerencia.js.
const MODULOS = ['stock','pedidos_stock','compras','ventas','proyectos','produccion','finanzas','mantenimiento','administracion','usuarios','rrhh','partes','codificacion','materiales','calidad','crm','compras_informes','analisis_proyectos','costeo_equipos','venta_repuestos','electrico'];

const MODULOS_LABEL = {
  stock:'Stock', pedidos_stock:'Pedido de Stock', compras:'Compras', ventas:'Ventas', proyectos:'Proyectos',
  produccion:'Producción', finanzas:'Finanzas', mantenimiento:'Mantenimiento',
  administracion:'Administración', usuarios:'Usuarios', rrhh:'RRHH', partes:'Partes',
  codificacion:'Codificación', materiales:'Materiales', calidad:'Calidad', crm:'CRM',
  compras_informes:'Compras — Informes y exportación', analisis_proyectos:'Análisis de Proyectos',
  costeo_equipos:'Costeo de Equipos', venta_repuestos:'Venta de Repuestos', electrico:'Eléctrico',
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

  const puestosAsignados = db.prepare('SELECT puesto_id FROM usuario_puestos WHERE usuario_id=?').all(userId).map(r => r.puesto_id);

  if (puestosAsignados.length) {
    const ph = puestosAsignados.map(() => '?').join(',');

    // Puestos asignados: sus módulos se suman (OR, con el mismo nivel leer/escribir
    // configurado) a los permisos individuales de arriba.
    const puestoRows = db.prepare(`SELECT modulo, puede_leer, puede_escribir FROM puesto_modulos WHERE puesto_id IN (${ph})`).all(...puestosAsignados);
    for (const pr of puestoRows) {
      const actual = permisos[pr.modulo] || { leer: false, escribir: false };
      permisos[pr.modulo] = {
        leer:     actual.leer     || !!pr.puede_leer,
        escribir: actual.escribir || !!pr.puede_escribir,
      };
    }

    // Organigrama hacia abajo: los módulos de cualquier puesto que reporte
    // (directa o indirectamente) a uno de los puestos asignados se suman
    // también, pero SOLO de lectura — un jefe puede ver todo lo de su gente,
    // nunca al revés, y ver no es lo mismo que poder editar lo que no maneja.
    const todosPuestos = db.prepare('SELECT id, reporta_a_id FROM puestos').all();
    const hijosDe = {};
    for (const p of todosPuestos) {
      if (p.reporta_a_id) (hijosDe[p.reporta_a_id] ||= []).push(p.id);
    }
    const subordinados = new Set();
    const pila = [...puestosAsignados];
    while (pila.length) {
      const actualId = pila.pop();
      for (const hijoId of (hijosDe[actualId] || [])) {
        if (subordinados.has(hijoId) || puestosAsignados.includes(hijoId)) continue;
        subordinados.add(hijoId);
        pila.push(hijoId);
      }
    }
    if (subordinados.size) {
      const idsSub = [...subordinados];
      const phSub = idsSub.map(() => '?').join(',');
      const modulosSub = db.prepare(`
        SELECT DISTINCT modulo FROM puesto_modulos
        WHERE puesto_id IN (${phSub}) AND (puede_leer=1 OR puede_escribir=1)
      `).all(...idsSub);
      for (const { modulo } of modulosSub) {
        const actual = permisos[modulo] || { leer: false, escribir: false };
        permisos[modulo] = { ...actual, leer: true };
      }
    }
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

// La única ruta que un usuario marcado para cambiar su contraseña puede
// seguir usando es la de cambiarla — todo lo demás queda bloqueado en el
// propio backend (no alcanza con esconder el resto en el frontend: cualquiera
// con el token podría seguir pegándole a la API directamente).
const esRutaCambiarPassword = req => req.method === 'PUT' && req.path.endsWith('/password');

function verificarToken(req, res, next) {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  // Fija el algoritmo esperado — sin esto, la librería confía en el que venga
  // en el propio token para decidir cómo verificarlo. No explotable hoy (jwt
  // rechaza 'none' por default y acá no hay una clave pública RS256 de por
  // medio para una confusión de algoritmo), pero es una línea de defensa en
  // profundidad que cuesta nada tener.
  jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] }, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido o expirado' });
    if (user.debe_cambiar_password && !esRutaCambiarPassword(req)) {
      return res.status(403).json({ error: 'Tenés que cambiar tu contraseña antes de continuar', code: 'DEBE_CAMBIAR_PASSWORD' });
    }
    // El rol/estado va embebido en el token, que puede seguir vivo varias horas
    // después de que a alguien se lo desactive o se le cambie el rol — sin este
    // chequeo, seguiría operando con los privilegios viejos hasta que expire.
    const actual = db.prepare('SELECT rol, activo FROM usuarios WHERE id=?').get(user.id);
    if (!actual || !actual.activo || actual.rol !== user.rol) {
      return res.status(403).json({ error: 'Tu sesión ya no es válida, volvé a iniciar sesión', code: 'SESION_INVALIDADA' });
    }
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
