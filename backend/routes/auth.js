const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { db }  = require('../db/database');
const { verificarToken, getPermisosEfectivos, MODULOS, MODULOS_LABEL, JERARQUIA } = require('../middleware/auth');
const { encontrarRaiz } = require('../helpers/organigrama');

const router = express.Router();

// Política de seguridad: la contraseña NO caduca sola — solo hay que
// cambiarla cuando un admin lo pide explícitamente (ver PATCH
// /usuarios/:id/forzar-cambio-password) o todavía no la eligió el propio
// usuario (recién creada). En ambos casos password_changed_at queda en NULL.
function debeCambiarPassword(u) {
  return !u.password_changed_at;
}

// Arma el JWT + el objeto "usuario" que se le devuelve al cliente — login,
// impersonate y el cambio de contraseña armaban este mismo bloque cada uno
// por separado (duplicado 3 veces) y se habían desincronizado: impersonate
// no incluía debe_cambiar_password en el token, así que ese chequeo
// (middleware/auth.js) nunca se disparaba actuando como otro usuario, aunque
// a ESE usuario le tocara cambiarla — quedaba sin efecto mientras dura la
// impersonación. `debeCambiar` fuerza el valor cuando ya se sabe (ej. recién
// cambiada = false); si no se pasa, se calcula del estado real del usuario.
function emitirSesion(u, { debeCambiar } = {}) {
  const requiereCambio = debeCambiar ?? debeCambiarPassword(u);
  const token = jwt.sign(
    { id: u.id, username: u.username, nombre: u.nombre, rol: u.rol, debe_cambiar_password: requiereCambio },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '10h' }
  );
  const permisos = getPermisosEfectivos(u.id, u.rol);
  return {
    token,
    usuario: {
      id: u.id, username: u.username, nombre: u.nombre, rol: u.rol,
      empleado_nombre: u.empleado_nombre || null, rrhh_empleado_id: u.rrhh_empleado_id || null,
      permisos, debe_cambiar_password: requiereCambio,
    },
  };
}

// Máximo 8 intentos cada 15 min, por combinación IP+usuario (no bloquea a toda una IP compartida)
const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.username || '').toLowerCase()}`,
  message: { error: 'Demasiados intentos fallidos. Esperá unos minutos antes de volver a intentar.' },
});

router.post('/login', limiteLogin,
  body('username').trim().notEmpty(),
  body('password').notEmpty(),
  (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() });

    const { username, password } = req.body;
    const u = db.prepare(`
      SELECT u.*, e.nombre AS empleado_nombre
      FROM usuarios u
      LEFT JOIN rrhh_empleados e ON e.id = u.rrhh_empleado_id
      WHERE u.username=? AND u.activo=1
    `).get(username);
    if (!u || !bcrypt.compareSync(password, u.password_hash)) {
      db.prepare('INSERT INTO login_intentos_fallidos (username, ip) VALUES (?,?)').run(username || '', req.ip || '');
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    db.prepare('INSERT INTO login_log (usuario_id, ip) VALUES (?,?)').run(u.id, req.ip || '');
    res.json(emitirSesion(u));
  }
);

router.get('/modulos', verificarToken, (req, res) => {
  const submodulosMap = Object.entries(JERARQUIA).reduce((acc, [padre, hijos]) => {
    hijos.forEach(h => { acc[h] = padre });
    return acc;
  }, {});
  res.json(MODULOS.map(m => ({ id: m, label: MODULOS_LABEL[m] ?? m, padre: submodulosMap[m] ?? null })));
});

router.post('/impersonate/:id', verificarToken, (req, res) => {
  if (req.usuario?.rol !== 'admin') return res.status(403).json({ error: 'Solo admin' });
  const u = db.prepare(`
    SELECT u.*, e.nombre AS empleado_nombre
    FROM usuarios u
    LEFT JOIN rrhh_empleados e ON e.id = u.rrhh_empleado_id
    WHERE u.id=? AND u.activo=1
  `).get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  db.prepare('INSERT INTO login_log (usuario_id, admin_id, ip) VALUES (?,?,?)').run(u.id, req.usuario.id, req.ip || '');
  res.json(emitirSesion(u));
});

router.get('/me', verificarToken, (req, res) => {
  const u = db.prepare('SELECT id,username,nombre,email,rol FROM usuarios WHERE id=?').get(req.usuario.id);
  if (!u) return res.status(404).json({ error: 'No encontrado' });
  res.json(u);
});

router.get('/usuarios', verificarToken, (req, res) => {
  if (!['admin','gerencia'].includes(req.usuario.rol))
    return res.status(403).json({ error: 'Sin permisos' });
  res.json(db.prepare(`
    SELECT u.id, u.username, u.nombre, u.email, u.rol, u.activo,
           u.rrhh_empleado_id, e.nombre AS empleado_nombre,
           (SELECT MAX(fecha) FROM login_log WHERE usuario_id = u.id) AS ultimo_login
    FROM usuarios u
    LEFT JOIN rrhh_empleados e ON e.id = u.rrhh_empleado_id
    ORDER BY u.nombre
  `).all());
});

router.get('/usuarios/:id/login-log', verificarToken, (req, res) => {
  if (!['admin','gerencia'].includes(req.usuario.rol))
    return res.status(403).json({ error: 'Sin permisos' });
  res.json(db.prepare(`
    SELECT l.id, l.fecha, l.ip, a.nombre AS admin_nombre
    FROM login_log l
    LEFT JOIN usuarios a ON a.id = l.admin_id
    WHERE l.usuario_id = ? ORDER BY l.fecha DESC LIMIT 200
  `).all(req.params.id));
});

router.post('/usuarios', verificarToken,
  body('username').trim().notEmpty(),
  body('nombre').trim().notEmpty(),
  body('password').isLength({ min: 6 }),
  body('rol').notEmpty(),
  (req, res) => {
    if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() });
    const { username, nombre, email, password, rol, rrhh_empleado_id } = req.body;
    try {
      const r = db.prepare('INSERT INTO usuarios (username,nombre,email,password_hash,rol,rrhh_empleado_id) VALUES (?,?,?,?,?,?)')
        .run(username, nombre, email||null, bcrypt.hashSync(password, 10), rol, rrhh_empleado_id||null);
      res.status(201).json({ id: r.lastInsertRowid });
    } catch(e) {
      if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'El usuario ya existe' });
      throw e;
    }
  }
);

router.put('/usuarios/:id', verificarToken, (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  if (!db.prepare('SELECT id FROM usuarios WHERE id=?').get(req.params.id)) return res.status(404).json({ error: 'Usuario no encontrado' });
  const { nombre, email, rol, activo, rrhh_empleado_id } = req.body;
  const sets = []; const vals = [];
  if (nombre            !== undefined) { sets.push('nombre=?');           vals.push(nombre); }
  if (email             !== undefined) { sets.push('email=?');            vals.push(email || null); }
  if (rol               !== undefined) { sets.push('rol=?');              vals.push(rol); }
  if (activo            !== undefined) { sets.push('activo=?');           vals.push(activo ? 1 : 0); }
  if (rrhh_empleado_id  !== undefined) { sets.push('rrhh_empleado_id=?'); vals.push(rrhh_empleado_id || null); }
  if (!sets.length) return res.status(400).json({ error: 'Sin campos para actualizar' });
  vals.push(req.params.id);
  db.prepare(`UPDATE usuarios SET ${sets.join(',')} WHERE id=?`).run(...vals);
  res.json({ ok: true });
});

router.put('/usuarios/:id/password', verificarToken,
  body('password').isLength({ min: 6 }),
  (req, res) => {
    const esUnoMismo = req.usuario.id === parseInt(req.params.id);
    if (!esUnoMismo && req.usuario.rol !== 'admin')
      return res.status(403).json({ error: 'Sin permisos' });
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() });
    // Solo cuenta como "elegida por el dueño de la cuenta" (deja de pedir el
    // cambio) cuando el propio usuario la cambia. Si un admin resetea la
    // contraseña de OTRO usuario, queda igual que una cuenta nueva: a ese
    // usuario le va a tocar cambiarla de nuevo en su próximo login — no hay
    // forma de saber si el admin se la va a pasar de forma segura.
    db.prepare('UPDATE usuarios SET password_hash=?, password_changed_at=? WHERE id=?')
      .run(bcrypt.hashSync(req.body.password, 10), esUnoMismo ? new Date().toISOString() : null, req.params.id);

    if (!esUnoMismo) return res.json({ mensaje: 'Contraseña actualizada' });

    // El JWT que el usuario ya tenía puede seguir marcando debe_cambiar_password
    // (no se puede editar un token ya emitido) — se le devuelve uno nuevo, ya
    // sin esa marca, para que no tenga que volver a loguearse después de cambiarla.
    const u = db.prepare(`
      SELECT u.*, e.nombre AS empleado_nombre
      FROM usuarios u
      LEFT JOIN rrhh_empleados e ON e.id = u.rrhh_empleado_id
      WHERE u.id=?
    `).get(req.params.id);
    res.json({ mensaje: 'Contraseña actualizada', ...emitirSesion(u, { debeCambiar: false }) });
  }
);

// El admin no fija una contraseña nueva acá — solo marca que a ese usuario le
// toca elegir una propia en su próximo login (password_changed_at en NULL).
// La sesión que ese usuario ya tenga abierta sigue funcionando hasta que la
// cierre o expire; el bloqueo entra en efecto recién cuando vuelva a loguearse.
router.patch('/usuarios/:id/forzar-cambio-password', verificarToken, (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  const u = db.prepare('SELECT id FROM usuarios WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  db.prepare('UPDATE usuarios SET password_changed_at=NULL WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

router.delete('/usuarios/:id', verificarToken, (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  const id = parseInt(req.params.id);
  if (id === req.usuario.id) return res.status(400).json({ error: 'No podés eliminar tu propio usuario' });
  const u = db.prepare('SELECT rol FROM usuarios WHERE id=?').get(id);
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  try {
    // Contar admins y borrar en la misma transacción — separados, dos
    // eliminaciones concurrentes de los dos últimos admins podían pasar
    // ambas el chequeo "queda al menos uno" antes de que la primera
    // confirmara, dejando el sistema sin ningún administrador.
    db.transaction(() => {
      if (u.rol === 'admin') {
        const { c } = db.prepare("SELECT COUNT(*) as c FROM usuarios WHERE rol='admin' AND activo=1").get();
        if (c <= 1) throw Object.assign(new Error('No se puede eliminar el único administrador'), { esUltimoAdmin: true });
      }
      db.prepare('DELETE FROM usuarios WHERE id=?').run(id);
    })();
  } catch (e) {
    if (e.esUltimoAdmin) return res.status(400).json({ error: e.message });
    // Decenas de tablas referencian a un usuario (created_by, login_log, etc.)
    // sin ON DELETE — más simple y confiable que enumerarlas todas a mano.
    if (e.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      return res.status(409).json({ error: 'No se puede eliminar: el usuario tiene registros asociados en el sistema (movimientos, documentos creados, historial de conexiones, etc.). Desactivalo en vez de eliminarlo.' });
    }
    throw e;
  }
  res.json({ ok: true });
});

router.get('/usuarios/:id/permisos', verificarToken, (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  const rows = db.prepare('SELECT * FROM usuario_permisos WHERE usuario_id=?').all(req.params.id);
  res.json(Object.fromEntries(rows.map(r => [r.modulo, { leer: !!r.puede_leer, escribir: !!r.puede_escribir }])));
});

router.put('/usuarios/:id/permisos', verificarToken, (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  const del = db.prepare('DELETE FROM usuario_permisos WHERE usuario_id=?');
  const ins = db.prepare('INSERT INTO usuario_permisos (usuario_id,modulo,puede_leer,puede_escribir) VALUES (?,?,?,?)');
  db.transaction(() => {
    del.run(req.params.id);
    for (const [modulo, p] of Object.entries(req.body)) {
      if (p && typeof p === 'object' && MODULOS.includes(modulo))
        ins.run(req.params.id, modulo, p.leer ? 1 : 0, p.escribir ? 1 : 0);
    }
  })();
  res.json({ ok: true });
});

// ── Puestos: catálogo de plantillas de acceso, asignables 1 o más por usuario ──
router.get('/puestos', verificarToken, (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  const puestos = db.prepare('SELECT * FROM puestos ORDER BY nombre').all();
  const modulos = db.prepare('SELECT * FROM puesto_modulos').all();
  res.json(puestos.map(p => ({
    ...p,
    modulos: Object.fromEntries(
      modulos.filter(m => m.puesto_id === p.id)
        .map(m => [m.modulo, { leer: !!m.puede_leer, escribir: !!m.puede_escribir }])
    ),
  })));
});

router.post('/puestos', verificarToken, body('nombre').trim().notEmpty(), (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() });
  const { area = '', mision = '', responsabilidades = '', requisitos = '', reporta_a_id = null, gerente_autorizante = true, oculta_montos = false } = req.body;
  try {
    // El puesto y sus módulos se crean juntos o ninguno — a diferencia del
    // PUT equivalente (que sí ya usa una transacción), esta ruta hacía las
    // dos escrituras sueltas: un error a mitad del loop de módulos dejaba el
    // puesto creado pero sin (todos) sus permisos, sin ningún aviso distinto
    // al de un alta exitosa.
    const id = db.transaction(() => {
      const r = db.prepare(`
        INSERT INTO puestos (nombre,area,mision,responsabilidades,requisitos,reporta_a_id,gerente_autorizante,oculta_montos)
        VALUES (?,?,?,?,?,?,?,?)
      `).run(req.body.nombre.trim(), area, mision, responsabilidades, requisitos, reporta_a_id || null, gerente_autorizante ? 1 : 0, oculta_montos ? 1 : 0);
      const ins = db.prepare('INSERT INTO puesto_modulos (puesto_id,modulo,puede_leer,puede_escribir) VALUES (?,?,?,?)');
      for (const [modulo, p] of Object.entries(req.body.modulos || {})) {
        if (p && typeof p === 'object' && MODULOS.includes(modulo) && (p.leer || p.escribir))
          ins.run(r.lastInsertRowid, modulo, p.leer ? 1 : 0, p.escribir ? 1 : 0);
      }
      return r.lastInsertRowid
    })()
    res.status(201).json({ id });
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe un puesto con ese nombre' });
    throw e;
  }
});

router.put('/puestos/:id', verificarToken, body('nombre').trim().notEmpty(), (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  const errs = validationResult(req);
  if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() });
  const { area = '', mision = '', responsabilidades = '', requisitos = '', reporta_a_id = null, gerente_autorizante = true, oculta_montos = false } = req.body;
  if (reporta_a_id && Number(reporta_a_id) === Number(req.params.id))
    return res.status(400).json({ error: 'Un puesto no puede reportar a sí mismo' });
  // No alcanza con chequear la auto-referencia directa: A puede pasar a
  // reportar a B en una edición, y B a A en otra, formando un ciclo de a dos
  // pasos que desconecta esa rama entera de la raíz sin ningún aviso (mismo
  // riesgo que ya se protege, con este mismo patrón, en gerenciaDe() más abajo).
  if (reporta_a_id) {
    const puestos = db.prepare('SELECT id, reporta_a_id FROM puestos').all();
    const porId = new Map(puestos.map(p => [p.id, p]));
    const propioId = Number(req.params.id);
    let actual = porId.get(Number(reporta_a_id));
    const visitados = new Set();
    while (actual) {
      if (actual.id === propioId) return res.status(400).json({ error: 'Esa cadena de reporte formaría un ciclo en el organigrama' });
      if (visitados.has(actual.id)) break;
      visitados.add(actual.id);
      actual = actual.reporta_a_id != null ? porId.get(actual.reporta_a_id) : null;
    }
  }
  db.transaction(() => {
    db.prepare(`
      UPDATE puestos SET nombre=?,area=?,mision=?,responsabilidades=?,requisitos=?,reporta_a_id=?,gerente_autorizante=?,oculta_montos=? WHERE id=?
    `).run(req.body.nombre.trim(), area, mision, responsabilidades, requisitos, reporta_a_id || null, gerente_autorizante ? 1 : 0, oculta_montos ? 1 : 0, req.params.id);
    db.prepare('DELETE FROM puesto_modulos WHERE puesto_id=?').run(req.params.id);
    const ins = db.prepare('INSERT INTO puesto_modulos (puesto_id,modulo,puede_leer,puede_escribir) VALUES (?,?,?,?)');
    for (const [modulo, p] of Object.entries(req.body.modulos || {})) {
      if (p && typeof p === 'object' && MODULOS.includes(modulo) && (p.leer || p.escribir))
        ins.run(req.params.id, modulo, p.leer ? 1 : 0, p.escribir ? 1 : 0);
    }
  })();
  res.json({ ok: true });
});

router.delete('/puestos/:id', verificarToken, (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  try {
    db.prepare('DELETE FROM puestos WHERE id=?').run(req.params.id);
  } catch (e) {
    if (e.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
      return res.status(409).json({ error: 'No se puede eliminar: hay puestos que le reportan, usuarios asignados, u objetivos de calidad a su cargo. Reasigná esas referencias primero.' });
    }
    throw e;
  }
  res.json({ ok: true });
});

// Qué gerencia (rama del organigrama) "es dueña" de cada módulo, para agrupar
// el menú lateral por gerencia en vez de categorías fijas en el código — si el
// organigrama cambia (se agrega/mueve un puesto, se reasignan módulos), el
// agrupamiento del menú lo sigue automáticamente. Abierto a cualquier usuario
// autenticado (no solo admin) porque lo necesita el menú de todos.
router.get('/gerencias-modulos', verificarToken, (req, res) => {
  const puestos = db.prepare('SELECT id, nombre, area, reporta_a_id FROM puestos ORDER BY id').all();
  const porId = Object.fromEntries(puestos.map(p => [p.id, p]));

  const raiz = encontrarRaiz(puestos);
  const raizArea = raiz?.area?.trim() || raiz?.nombre || 'Gerencia General';
  if (!raiz) return res.json({ raizArea, modulos: {} });

  // Sube por reporta_a_id hasta encontrar la rama que cuelga directo de la
  // raíz (un "Gerente de X") — esa es la gerencia del puesto, sin importar
  // cuántos niveles tenga debajo (jefe de taller, operario, etc.). Un puesto
  // que nunca llega a la raíz (huérfano, fuera del árbol principal — ej. los
  // puestos de demostración de una instalación nueva, todos sin reporta_a_id)
  // no tiene gerencia determinable: no alcanza con que él mismo no tenga
  // padre, tiene que colgar realmente de la raíz elegida.
  const cacheGerencia = {};
  function gerenciaDe(puestoId) {
    if (puestoId in cacheGerencia) return cacheGerencia[puestoId];
    let actual = porId[puestoId];
    if (!actual || actual.id === raiz.id) return (cacheGerencia[puestoId] = null);
    const visitados = new Set();
    while (actual.reporta_a_id != null) {
      if (actual.reporta_a_id === raiz.id) return (cacheGerencia[puestoId] = (actual.area?.trim() || actual.nombre));
      if (visitados.has(actual.id)) break; // corta ante un ciclo mal cargado
      visitados.add(actual.id);
      const siguiente = porId[actual.reporta_a_id];
      if (!siguiente) break;
      actual = siguiente;
    }
    return (cacheGerencia[puestoId] = null);
  }

  const asignaciones = db.prepare(`
    SELECT puesto_id, modulo FROM puesto_modulos
    WHERE puede_leer=1 OR puede_escribir=1 ORDER BY puesto_id
  `).all();
  const modulos = {};
  for (const a of asignaciones) {
    if (modulos[a.modulo]) continue;
    const g = gerenciaDe(a.puesto_id);
    if (g) modulos[a.modulo] = g;
  }
  // Un módulo "padre" de JERARQUIA presta su gerencia a sus submódulos que
  // todavía no tengan una propia (ej: "materiales" nunca se asigna directo a
  // un puesto, viaja siempre junto con "compras").
  for (const [padre, hijos] of Object.entries(JERARQUIA)) {
    if (!modulos[padre]) continue;
    for (const hijo of hijos) if (!modulos[hijo]) modulos[hijo] = modulos[padre];
  }

  // Asignación manual (configurada en Usuarios → Puestos → "Módulos por
  // gerencia") — tiene la última palabra sobre lo deducido automáticamente.
  const overrides = db.prepare('SELECT modulo, puesto_id FROM modulo_gerencia').all();
  for (const o of overrides) {
    const p = porId[o.puesto_id];
    if (p) modulos[o.modulo] = p.area?.trim() || p.nombre;
  }

  // Lista simple de gerencias (la raíz + sus "Gerente de X" directos) — para
  // que cualquier pantalla del sistema (ej. "Área responsable" en Proyectos)
  // use las mismas gerencias reales en vez de una lista fija en el código.
  const gerencias = [...new Set(
    [raiz, ...puestos.filter(p => p.reporta_a_id === raiz.id)].map(g => g.area?.trim() || g.nombre)
  )]

  res.json({ raizArea, modulos, gerencias });
});

// Gerencias asignables (la raíz del organigrama + sus "Gerente de X" directos)
// y qué módulo tiene asignado manualmente cuál — para la pantalla de
// configuración en Usuarios → Puestos → "Módulos por gerencia".
router.get('/gerencias', verificarToken, (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  const puestos = db.prepare('SELECT id, nombre, area, reporta_a_id FROM puestos ORDER BY id').all();
  const raiz = encontrarRaiz(puestos);
  const gerencias = raiz
    ? [raiz, ...puestos.filter(p => p.reporta_a_id === raiz.id)]
    : [];
  const overrides = Object.fromEntries(
    db.prepare('SELECT modulo, puesto_id FROM modulo_gerencia').all().map(r => [r.modulo, r.puesto_id])
  );
  res.json({
    gerencias: gerencias.map(g => ({ id: g.id, nombre: g.nombre, area: g.area?.trim() || g.nombre })),
    overrides,
  });
});

router.put('/modulo-gerencia/:modulo', verificarToken, (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  const { modulo } = req.params;
  if (!MODULOS.includes(modulo)) return res.status(400).json({ error: 'Módulo inválido' });
  const { puesto_id } = req.body;
  if (puesto_id == null || puesto_id === '') {
    db.prepare('DELETE FROM modulo_gerencia WHERE modulo=?').run(modulo);
  } else {
    const p = db.prepare('SELECT id FROM puestos WHERE id=?').get(puesto_id);
    if (!p) return res.status(404).json({ error: 'Puesto no encontrado' });
    db.prepare(`
      INSERT INTO modulo_gerencia (modulo, puesto_id) VALUES (?,?)
      ON CONFLICT(modulo) DO UPDATE SET puesto_id=excluded.puesto_id
    `).run(modulo, puesto_id);
  }
  res.json({ ok: true });
});

router.get('/usuarios/:id/puestos', verificarToken, (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  const rows = db.prepare('SELECT puesto_id FROM usuario_puestos WHERE usuario_id=?').all(req.params.id);
  res.json(rows.map(r => r.puesto_id));
});

router.put('/usuarios/:id/puestos', verificarToken, (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  const puestoIds = Array.isArray(req.body.puesto_ids) ? req.body.puesto_ids : [];
  const del = db.prepare('DELETE FROM usuario_puestos WHERE usuario_id=?');
  const ins = db.prepare('INSERT INTO usuario_puestos (usuario_id,puesto_id) VALUES (?,?)');
  db.transaction(() => {
    del.run(req.params.id);
    for (const puestoId of puestoIds) ins.run(req.params.id, puestoId);
  })();
  res.json({ ok: true });
});

module.exports = router;
