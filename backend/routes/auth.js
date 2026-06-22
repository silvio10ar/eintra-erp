const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { db }  = require('../db/database');
const { verificarToken, getPermisosEfectivos, MODULOS, MODULOS_LABEL, JERARQUIA } = require('../middleware/auth');

const router = express.Router();

router.post('/login',
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
    if (!u || !bcrypt.compareSync(password, u.password_hash))
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

    const token = jwt.sign(
      { id: u.id, username: u.username, nombre: u.nombre, rol: u.rol },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '10h' }
    );
    const permisos = getPermisosEfectivos(u.id, u.rol);
    res.json({ token, usuario: { id: u.id, username: u.username, nombre: u.nombre, rol: u.rol, empleado_nombre: u.empleado_nombre || null, rrhh_empleado_id: u.rrhh_empleado_id || null, permisos } });
  }
);

router.get('/modulos', verificarToken, (req, res) => {
  const submodulosMap = Object.entries(JERARQUIA).reduce((acc, [padre, hijos]) => {
    hijos.forEach(h => { acc[h] = padre });
    return acc;
  }, {});
  res.json(MODULOS.map(m => ({ id: m, label: MODULOS_LABEL[m] ?? m, padre: submodulosMap[m] ?? null })));
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
           u.rrhh_empleado_id, e.nombre AS empleado_nombre
    FROM usuarios u
    LEFT JOIN rrhh_empleados e ON e.id = u.rrhh_empleado_id
    ORDER BY u.nombre
  `).all());
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
    if (req.usuario.id !== parseInt(req.params.id) && req.usuario.rol !== 'admin')
      return res.status(403).json({ error: 'Sin permisos' });
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() });
    db.prepare('UPDATE usuarios SET password_hash=? WHERE id=?')
      .run(bcrypt.hashSync(req.body.password, 10), req.params.id);
    res.json({ mensaje: 'Contraseña actualizada' });
  }
);

router.delete('/usuarios/:id', verificarToken, (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  const id = parseInt(req.params.id);
  if (id === req.usuario.id) return res.status(400).json({ error: 'No podés eliminar tu propio usuario' });
  const u = db.prepare('SELECT rol FROM usuarios WHERE id=?').get(id);
  if (!u) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (u.rol === 'admin') {
    const { c } = db.prepare("SELECT COUNT(*) as c FROM usuarios WHERE rol='admin' AND activo=1").get();
    if (c <= 1) return res.status(400).json({ error: 'No se puede eliminar el único administrador' });
  }
  db.prepare('DELETE FROM usuarios WHERE id=?').run(id);
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

module.exports = router;
