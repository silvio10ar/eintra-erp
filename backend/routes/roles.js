const express = require('express');
const { db }  = require('../db/database');
const { verificarToken, MODULOS } = require('../middleware/auth');

const router = express.Router();

function soloAdmin(req, res, next) {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
  next();
}

// ── Listar roles ───────────────────────────────────────────────────────────────
router.get('/', verificarToken, (req, res) => {
  const roles = db.prepare('SELECT * FROM roles ORDER BY nombre').all();
  const permisos = db.prepare('SELECT * FROM rol_permisos WHERE rol_id=?');
  res.json(roles.map(r => ({
    ...r,
    permisos: Object.fromEntries(
      permisos.all(r.id).map(p => [p.modulo, { leer: !!p.puede_leer, escribir: !!p.puede_escribir }])
    )
  })));
});

// ── Crear rol ──────────────────────────────────────────────────────────────────
router.post('/', verificarToken, soloAdmin, (req, res) => {
  const { nombre, descripcion } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre es requerido' });
  try {
    const r = db.prepare('INSERT INTO roles (nombre,descripcion) VALUES (?,?)').run(nombre.trim(), descripcion || '');
    res.status(201).json({ id: r.lastInsertRowid });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe un rol con ese nombre' });
    throw e;
  }
});

// ── Actualizar rol ─────────────────────────────────────────────────────────────
router.put('/:id', verificarToken, soloAdmin, (req, res) => {
  const { nombre, descripcion, activo } = req.body;
  const sets = []; const vals = [];
  if (nombre      !== undefined) { sets.push('nombre=?');      vals.push(nombre.trim()); }
  if (descripcion !== undefined) { sets.push('descripcion=?'); vals.push(descripcion); }
  if (activo      !== undefined) { sets.push('activo=?');      vals.push(activo ? 1 : 0); }
  if (!sets.length) return res.status(400).json({ error: 'Sin campos' });
  vals.push(req.params.id);
  db.prepare(`UPDATE roles SET ${sets.join(',')} WHERE id=?`).run(...vals);
  res.json({ ok: true });
});

// ── Eliminar rol ───────────────────────────────────────────────────────────────
router.delete('/:id', verificarToken, soloAdmin, (req, res) => {
  db.prepare('DELETE FROM roles WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── Guardar permisos de un rol ─────────────────────────────────────────────────
// Body: { stock: { leer: true, escribir: false }, compras: { leer: true, escribir: true }, ... }
router.put('/:id/permisos', verificarToken, soloAdmin, (req, res) => {
  const rolId = req.params.id;
  const del = db.prepare('DELETE FROM rol_permisos WHERE rol_id=?');
  const ins = db.prepare('INSERT INTO rol_permisos (rol_id,modulo,puede_leer,puede_escribir) VALUES (?,?,?,?)');

  db.transaction(() => {
    del.run(rolId);
    for (const modulo of MODULOS) {
      const p = req.body[modulo];
      if (p) ins.run(rolId, modulo, p.leer ? 1 : 0, p.escribir ? 1 : 0);
    }
  })();

  res.json({ ok: true });
});

// ── Permisos directos de un usuario ───────────────────────────────────────────
router.get('/usuario/:userId/permisos', verificarToken, (req, res) => {
  const rows = db.prepare('SELECT * FROM usuario_permisos WHERE usuario_id=?').all(req.params.userId);
  res.json(Object.fromEntries(rows.map(r => [r.modulo, { leer: !!r.puede_leer, escribir: !!r.puede_escribir }])));
});

router.put('/usuario/:userId/permisos', verificarToken, soloAdmin, (req, res) => {
  const userId = req.params.userId;
  const del = db.prepare('DELETE FROM usuario_permisos WHERE usuario_id=?');
  const ins = db.prepare('INSERT INTO usuario_permisos (usuario_id,modulo,puede_leer,puede_escribir) VALUES (?,?,?,?)');
  db.transaction(() => {
    del.run(userId);
    for (const [modulo, p] of Object.entries(req.body)) {
      if (p && typeof p === 'object') ins.run(userId, modulo, p.leer ? 1 : 0, p.escribir ? 1 : 0);
    }
  })();
  res.json({ ok: true });
});

// ── Roles de un usuario ────────────────────────────────────────────────────────
router.get('/usuario/:userId', verificarToken, (req, res) => {
  const rows = db.prepare(`
    SELECT r.* FROM usuario_roles ur
    JOIN roles r ON r.id = ur.rol_id
    WHERE ur.usuario_id = ? ORDER BY r.nombre
  `).all(req.params.userId);
  res.json(rows);
});

// ── Asignar roles a un usuario ─────────────────────────────────────────────────
// Body: { roles: [1, 3, 5] }  (array de IDs de rol)
router.put('/usuario/:userId', verificarToken, soloAdmin, (req, res) => {
  const userId = req.params.userId;
  const rolIds = req.body.roles ?? [];
  const del = db.prepare('DELETE FROM usuario_roles WHERE usuario_id=?');
  const ins = db.prepare('INSERT OR IGNORE INTO usuario_roles (usuario_id,rol_id) VALUES (?,?)');
  db.transaction(() => {
    del.run(userId);
    for (const rolId of rolIds) ins.run(userId, rolId);
  })();
  res.json({ ok: true });
});

module.exports = router;
