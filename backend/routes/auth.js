const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { db }  = require('../db/database');
const { verificarToken, getPermisosEfectivos } = require('../middleware/auth');

const router = express.Router();

router.post('/login',
  body('username').trim().notEmpty(),
  body('password').notEmpty(),
  (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() });

    const { username, password } = req.body;
    const u = db.prepare('SELECT * FROM usuarios WHERE username=? AND activo=1').get(username);
    if (!u || !bcrypt.compareSync(password, u.password_hash))
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });

    const token = jwt.sign(
      { id: u.id, username: u.username, nombre: u.nombre, rol: u.rol },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '10h' }
    );
    const permisos = getPermisosEfectivos(u.id, u.rol);
    res.json({ token, usuario: { id: u.id, username: u.username, nombre: u.nombre, rol: u.rol, permisos } });
  }
);

router.get('/me', verificarToken, (req, res) => {
  const u = db.prepare('SELECT id,username,nombre,email,rol FROM usuarios WHERE id=?').get(req.usuario.id);
  if (!u) return res.status(404).json({ error: 'No encontrado' });
  res.json(u);
});

router.get('/usuarios', verificarToken, (req, res) => {
  if (!['admin','gerencia'].includes(req.usuario.rol))
    return res.status(403).json({ error: 'Sin permisos' });
  res.json(db.prepare('SELECT id,username,nombre,email,rol,activo FROM usuarios ORDER BY nombre').all());
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
    const { username, nombre, email, password, rol } = req.body;
    try {
      const r = db.prepare('INSERT INTO usuarios (username,nombre,email,password_hash,rol) VALUES (?,?,?,?,?)')
        .run(username, nombre, email||null, bcrypt.hashSync(password, 10), rol);
      res.status(201).json({ id: r.lastInsertRowid });
    } catch(e) {
      if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'El usuario ya existe' });
      throw e;
    }
  }
);

router.put('/usuarios/:id', verificarToken, (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Sin permisos' });
  const { nombre, email, rol, activo } = req.body;
  const sets = []; const vals = [];
  if (nombre  !== undefined) { sets.push('nombre=?');  vals.push(nombre); }
  if (email   !== undefined) { sets.push('email=?');   vals.push(email || null); }
  if (rol     !== undefined) { sets.push('rol=?');     vals.push(rol); }
  if (activo  !== undefined) { sets.push('activo=?');  vals.push(activo ? 1 : 0); }
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

module.exports = router;
