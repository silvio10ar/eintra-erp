const express = require('express');
const http    = require('http');
const https   = require('https');
const crypto  = require('crypto');
const { db } = require('../db/database');
const { verificarToken } = require('../middleware/auth');

const router = express.Router();
const puede = req => req.usuario?.rol === 'admin' || !!(req.permisos?.rrhh?.escribir);

// Fecha actual en zona horaria Argentina (evita desfase UTC)
const hoyAR = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })

// ── Hikvision ISAPI helper (Digest Auth) ──────────────────────────────────────
function md5(s) { return crypto.createHash('md5').update(s).digest('hex'); }

function hikRequest(ip, puerto, method, path, body, user, pass) {
  return new Promise((resolve, reject) => {
    const mod     = String(puerto) === '443' ? https : http;
    const bodyStr = body ? JSON.stringify(body) : '';

    function doReq(authHeader, cb) {
      const hdrs = { 'Content-Type': 'application/json' };
      if (bodyStr)    hdrs['Content-Length'] = Buffer.byteLength(bodyStr);
      if (authHeader) hdrs['Authorization']  = authHeader;
      const opts = {
        hostname: ip, port: Number(puerto), path,
        method: method.toUpperCase(), headers: hdrs,
        rejectUnauthorized: false, timeout: 14000,
      };
      const req = mod.request(opts, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => cb(null, res.statusCode, res.headers, data));
      });
      req.on('error', cb);
      req.on('timeout', () => { req.destroy(); cb(new Error('Timeout al conectar con el dispositivo')); });
      if (bodyStr) req.write(bodyStr);
      req.end();
    }

    doReq(null, (err, status, headers, data) => {
      if (err) return reject(err);
      if (status !== 401) {
        try { return resolve(JSON.parse(data)); } catch { return resolve(data); }
      }
      const www   = headers['www-authenticate'] || '';
      const get   = k => (www.match(new RegExp(`${k}="([^"]+)"`))||[])[1] || '';
      const realm  = get('realm'), nonce  = get('nonce'), opaque = get('opaque');
      const qop    = (www.match(/qop="?([^",\s]+)"?/)||[])[1] || '';
      const nc = '00000001', cnonce = crypto.randomBytes(8).toString('hex');
      const ha1  = md5(`${user}:${realm}:${pass}`);
      const ha2  = md5(`${method.toUpperCase()}:${path}`);
      const resp = qop
        ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
        : md5(`${ha1}:${nonce}:${ha2}`);
      let auth = `Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${path}", response="${resp}"`;
      if (qop)    auth += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
      if (opaque) auth += `, opaque="${opaque}"`;
      doReq(auth, (err2, _s, _h, data2) => {
        if (err2) return reject(err2);
        try { resolve(JSON.parse(data2)); } catch { resolve(data2); }
      });
    });
  });
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get('/dashboard', verificarToken, (req, res) => {
  const year  = req.query.year  || new Date().getFullYear();
  const month = req.query.month;

  const desde = month
    ? `${year}-${String(month).padStart(2,'0')}-01`
    : `${year}-01-01`;
  const hasta = month
    ? `${year}-${String(month).padStart(2,'0')}-31`
    : `${year}-12-31`;

  const totalHoras = db.prepare(
    `SELECT COALESCE(SUM(horas),0) AS total FROM rrhh_registros WHERE fecha BETWEEN ? AND ?`
  ).get(desde, hasta);

  const porEmpleado = db.prepare(`
    SELECT e.id, e.nombre, e.tipo,
           COALESCE(SUM(r.horas),0) AS horas
    FROM rrhh_empleados e
    LEFT JOIN rrhh_registros r ON r.empleado_id = e.id AND r.fecha BETWEEN ? AND ?
    WHERE e.activo = 1
    GROUP BY e.id
    ORDER BY horas DESC
  `).all(desde, hasta);

  const porProyecto = db.prepare(`
    SELECT p.id, p.nombre,
           COALESCE(SUM(r.horas),0) AS horas
    FROM proyectos p
    LEFT JOIN rrhh_registros r ON r.proyecto_id = p.id AND r.fecha BETWEEN ? AND ?
    WHERE p.codigo NOT LIKE 'HIST-%'
    GROUP BY p.id
    HAVING horas > 0
    ORDER BY horas DESC
    LIMIT 15
  `).all(desde, hasta);

  const porCategoria = db.prepare(`
    SELECT c.grupo,
           COALESCE(SUM(r.horas),0) AS horas
    FROM rrhh_categorias c
    LEFT JOIN rrhh_registros r ON r.categoria_id = c.id AND r.fecha BETWEEN ? AND ?
    GROUP BY c.grupo
    ORDER BY horas DESC
  `).all(desde, hasta);

  const porTipo = db.prepare(`
    SELECT e.tipo,
           COALESCE(SUM(r.horas),0) AS horas
    FROM rrhh_empleados e
    LEFT JOIN rrhh_registros r ON r.empleado_id = e.id AND r.fecha BETWEEN ? AND ?
    WHERE e.activo = 1
    GROUP BY e.tipo
  `).all(desde, hasta);

  const porMes = db.prepare(`
    SELECT substr(r.fecha,1,7) AS mes, e.tipo,
           COALESCE(SUM(r.horas),0) AS horas
    FROM rrhh_registros r
    JOIN rrhh_empleados e ON e.id = r.empleado_id
    WHERE r.fecha LIKE ?
    GROUP BY mes, e.tipo
    ORDER BY mes
  `).all(`${year}%`);

  res.json({ totalHoras: totalHoras.total, porEmpleado, porProyecto, porCategoria, porTipo, porMes });
});

// ── Registros ─────────────────────────────────────────────────────────────────
router.get('/registros', verificarToken, (req, res) => {
  const { year, month, empleado_id, proyecto_id, categoria_id } = req.query;
  const where = []; const params = [];

  if (year && month) {
    where.push(`r.fecha LIKE ?`);
    params.push(`${year}-${String(month).padStart(2,'0')}%`);
  } else if (year) {
    where.push(`r.fecha LIKE ?`);
    params.push(`${year}%`);
  }
  if (empleado_id)  { where.push(`r.empleado_id = ?`);  params.push(empleado_id); }
  if (proyecto_id)  { where.push(`r.proyecto_id = ?`);  params.push(proyecto_id); }
  if (categoria_id) { where.push(`r.categoria_id = ?`); params.push(categoria_id); }

  const rows = db.prepare(`
    SELECT r.*,
           e.nombre AS empleado_nombre, e.tipo AS empleado_tipo,
           COALESCE(rp.nombre, p.nombre, a.nombre) AS proyecto_nombre,
           c.codigo AS cat_codigo, c.descripcion AS cat_descripcion, c.grupo AS cat_grupo
    FROM rrhh_registros r
    LEFT JOIN rrhh_empleados   e  ON e.id = r.empleado_id
    LEFT JOIN rrhh_proyectos   rp ON rp.id = r.proyecto_id
    LEFT JOIN proyectos        p  ON p.id  = r.proyecto_id
    LEFT JOIN rrhh_actividades a  ON a.id  = r.actividad_id
    LEFT JOIN rrhh_categorias  c  ON c.id  = r.categoria_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY r.fecha DESC, r.id DESC
    LIMIT 5000
  `).all(...params);

  res.json(rows);
});

router.post('/registros', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permiso' });
  const { fecha, empleado_id, proyecto_id, categoria_id, hora_inicio, hora_fin, horas, modulo, descripcion } = req.body;
  if (!fecha || !empleado_id || !horas) return res.status(400).json({ error: 'fecha, empleado_id y horas son requeridos' });

  const r = db.prepare(`
    INSERT INTO rrhh_registros (fecha,empleado_id,proyecto_id,categoria_id,hora_inicio,hora_fin,horas,modulo,descripcion)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(fecha, empleado_id, proyecto_id || null, categoria_id || null,
         hora_inicio || '', hora_fin || '', Number(horas), modulo || '', descripcion || '');

  res.json({ id: r.lastInsertRowid });
});

router.post('/registros/batch', verificarToken, (req, res) => {
  if (!req.usuario) return res.status(403).json({ error: 'Sin permiso' });
  const { registros } = req.body;
  if (!Array.isArray(registros) || registros.length === 0)
    return res.status(400).json({ error: 'Se requiere un array de registros' });

  const esAdmin = req.usuario?.rol === 'admin'
    || !!(req.permisos?.rrhh?.escribir)
    || !!(req.permisos?.partes?.escribir);

  let empleadoForzado = null;
  if (!esAdmin) {
    const u = db.prepare('SELECT rrhh_empleado_id FROM usuarios WHERE id=?').get(req.usuario.id);
    if (!u?.rrhh_empleado_id)
      return res.status(400).json({ error: 'Tu usuario no tiene empleado asociado. Pedile al administrador que lo configure.' });
    empleadoForzado = u.rrhh_empleado_id;
  }

  const ins = db.prepare(`
    INSERT INTO rrhh_registros
      (fecha,empleado_id,proyecto_id,actividad_id,categoria_id,hora_inicio,hora_fin,horas,modulo,descripcion)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `);

  let insertados = 0;
  db.transaction(() => {
    for (const r of registros) {
      const empId = empleadoForzado ?? r.empleado_id;
      if (!r.fecha || !empId || !r.horas) continue;
      ins.run(r.fecha, empId, r.proyecto_id || null, r.actividad_id || null, r.categoria_id || null,
              r.hora_inicio || '', r.hora_fin || '', Number(r.horas), r.modulo || '', r.descripcion || '');
      insertados++;
    }
  })();

  res.json({ ok: true, insertados });
});

router.put('/registros/:id', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permiso' });
  const { fecha, empleado_id, proyecto_id, actividad_id, categoria_id, hora_inicio, hora_fin, horas, modulo, descripcion } = req.body;

  db.prepare(`
    UPDATE rrhh_registros
    SET fecha=?,empleado_id=?,proyecto_id=?,actividad_id=?,categoria_id=?,hora_inicio=?,hora_fin=?,horas=?,modulo=?,descripcion=?
    WHERE id=?
  `).run(fecha, empleado_id, proyecto_id || null, actividad_id || null, categoria_id || null,
         hora_inicio || '', hora_fin || '', Number(horas), modulo || '', descripcion || '',
         req.params.id);

  res.json({ ok: true });
});

router.delete('/registros/:id', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permiso' });
  db.prepare('DELETE FROM rrhh_registros WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── Empleados ─────────────────────────────────────────────────────────────────
router.get('/empleados', verificarToken, (req, res) => {
  const anio = new Date().getFullYear();
  const rows = db.prepare(`
    SELECT e.*,
           (SELECT COUNT(*) FROM rrhh_registros r WHERE r.empleado_id = e.id) AS total_registros,
           (SELECT COALESCE(SUM(horas),0) FROM rrhh_registros r WHERE r.empleado_id = e.id AND r.fecha LIKE ?) AS horas_anio
    FROM rrhh_empleados e
    ORDER BY e.tipo, e.nombre
  `).all(`${anio}%`);
  res.json(rows);
});

router.post('/empleados', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permiso' });
  const { nombre, tipo, empresa } = req.body;
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido' });
  const r = db.prepare(`INSERT INTO rrhh_empleados (nombre,tipo,empresa) VALUES (?,?,?)`)
    .run(nombre.trim().toUpperCase(), tipo || 'interno', empresa || '');
  res.json({ id: r.lastInsertRowid });
});

router.put('/empleados/:id', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permiso' });
  const { nombre, tipo, empresa, activo, id_dispositivo, horario_entrada, horario_salida, obliga_fichar } = req.body;
  db.prepare(`UPDATE rrhh_empleados SET nombre=?,tipo=?,empresa=?,activo=?,id_dispositivo=?,horario_entrada=?,horario_salida=?,obliga_fichar=? WHERE id=?`)
    .run(nombre.trim().toUpperCase(), tipo || 'interno', empresa || '',
         activo !== undefined ? Number(activo) : 1,
         id_dispositivo || '',
         horario_entrada || '',
         horario_salida  || '',
         obliga_fichar !== undefined ? Number(obliga_fichar) : 1,
         req.params.id);
  res.json({ ok: true });
});

router.delete('/empleados/:id', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permiso' });
  const { c } = db.prepare('SELECT COUNT(*) as c FROM rrhh_registros WHERE empleado_id=?').get(req.params.id);
  if (c > 0) {
    db.prepare('UPDATE rrhh_empleados SET activo=0 WHERE id=?').run(req.params.id);
    res.json({ ok: true, accion: 'desactivado', registros: c });
  } else {
    db.prepare('DELETE FROM rrhh_empleados WHERE id=?').run(req.params.id);
    res.json({ ok: true, accion: 'eliminado' });
  }
});

// ── Proyectos (vista de solo lectura desde módulo principal) ──────────────────
router.get('/proyectos', verificarToken, (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.codigo, p.nombre, p.estado, p.cliente_nombre,
           COALESCE((SELECT SUM(horas) FROM rrhh_registros r WHERE r.proyecto_id = p.id), 0) AS total_horas
    FROM proyectos p
    WHERE p.codigo NOT LIKE 'HIST-%'
    ORDER BY p.estado='Activo' DESC, p.nombre
  `).all();
  res.json(rows);
});

// ── Fusionador de proyectos legado ────────────────────────────────────────────
try { db.exec(`ALTER TABLE rrhh_proyectos ADD COLUMN revisado INTEGER DEFAULT 0`) } catch {}

// ── Actividades internas ───────────────────────────────────────────────────────
try { db.exec(`CREATE TABLE IF NOT EXISTS rrhh_actividades (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, activo INTEGER DEFAULT 1)`) } catch {}
try { db.exec(`ALTER TABLE rrhh_registros ADD COLUMN actividad_id INTEGER`) } catch {}

router.get('/actividades', verificarToken, (req, res) => {
  const rows = db.prepare(`SELECT * FROM rrhh_actividades ORDER BY activo DESC, nombre`).all();
  res.json(rows);
});
router.post('/actividades', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permiso' });
  const { nombre } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'nombre requerido' });
  const r = db.prepare(`INSERT INTO rrhh_actividades (nombre, activo) VALUES (?, 1)`).run(nombre.trim().toUpperCase());
  res.json({ id: r.lastInsertRowid });
});
router.put('/actividades/:id', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permiso' });
  const { nombre, activo } = req.body;
  db.prepare(`UPDATE rrhh_actividades SET nombre=?, activo=? WHERE id=?`)
    .run(nombre.trim().toUpperCase(), activo !== undefined ? Number(activo) : 1, req.params.id);
  res.json({ ok: true });
});

router.get('/proyectos-legado', verificarToken, (req, res) => {
  const rows = db.prepare(`
    SELECT rp.id, rp.nombre, rp.revisado,
           COUNT(r.id)  AS total_registros,
           MIN(r.fecha) AS fecha_desde,
           MAX(r.fecha) AS fecha_hasta
    FROM rrhh_proyectos rp
    LEFT JOIN rrhh_registros r ON r.proyecto_id = rp.id
    WHERE rp.revisado = 0
    GROUP BY rp.id
    HAVING total_registros > 0
    ORDER BY MAX(r.fecha) DESC
  `).all();
  res.json(rows);
});

router.post('/proyectos-legado/:id/fusionar', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permiso' });
  const { proyecto_id_nuevo } = req.body;
  if (!proyecto_id_nuevo) return res.status(400).json({ error: 'proyecto_id_nuevo requerido' });
  const cambios = db.prepare(
    `UPDATE rrhh_registros SET proyecto_id = ? WHERE proyecto_id = ?`
  ).run(proyecto_id_nuevo, req.params.id).changes;
  db.prepare(`UPDATE rrhh_proyectos SET revisado = 1 WHERE id = ?`).run(req.params.id);
  res.json({ ok: true, registros_actualizados: cambios });
});

router.post('/proyectos-legado/:id/conservar', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permiso' });
  db.prepare(`UPDATE rrhh_proyectos SET revisado = 1 WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// ── Categorías ────────────────────────────────────────────────────────────────
router.get('/categorias', verificarToken, (req, res) => {
  const rows = db.prepare(`SELECT * FROM rrhh_categorias WHERE activo=1 ORDER BY grupo, codigo`).all();
  res.json(rows);
});

// ── Empleados: campo id_dispositivo en PUT ────────────────────────────────────
// (override del PUT anterior para incluir id_dispositivo)
// El router.put('/empleados/:id') original se mantiene, solo extendemos el campo
// via ALTER TABLE + aqui lo manejamos si viene en el body

// ── Dispositivos (Hikvision) ──────────────────────────────────────────────────
router.get('/dispositivos', verificarToken, (req, res) => {
  res.json(db.prepare('SELECT * FROM rrhh_dispositivos ORDER BY id').all());
});

router.post('/dispositivos', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permiso' });
  const { nombre, modelo, ip, puerto, usuario, password } = req.body;
  if (!ip) return res.status(400).json({ error: 'ip es requerida' });
  const r = db.prepare(
    `INSERT INTO rrhh_dispositivos (nombre,modelo,ip,puerto,usuario,password)
     VALUES (?,?,?,?,?,?)`
  ).run(nombre||'Terminal', modelo||'DS-K1T320MFWX', ip, puerto||80, usuario||'admin', password||'');
  res.json({ id: r.lastInsertRowid });
});

router.put('/dispositivos/:id', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permiso' });
  const { nombre, modelo, ip, puerto, usuario, password, activo } = req.body;
  db.prepare(
    `UPDATE rrhh_dispositivos SET nombre=?,modelo=?,ip=?,puerto=?,usuario=?,password=?,activo=? WHERE id=?`
  ).run(nombre, modelo, ip, puerto||80, usuario, password,
        activo !== undefined ? Number(activo) : 1, req.params.id);
  res.json({ ok: true });
});

// ── Test conexión ─────────────────────────────────────────────────────────────
router.post('/dispositivos/:id/test', verificarToken, async (req, res) => {
  const disp = db.prepare('SELECT * FROM rrhh_dispositivos WHERE id=?').get(req.params.id);
  if (!disp) return res.status(404).json({ error: 'No encontrado' });
  try {
    const data = await hikRequest(disp.ip, disp.puerto, 'GET',
      '/ISAPI/System/deviceInfo', null, disp.usuario, disp.password);
    const info = data?.DeviceInfo;
    res.json({ ok: true, nombre: info?.deviceName || info?.model || 'Conectado', modelo: info?.model });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Debug: respuesta cruda del AcsEvent ───────────────────────────────────────
router.post('/dispositivos/:id/debug-acs', verificarToken, async (req, res) => {
  const disp = db.prepare('SELECT * FROM rrhh_dispositivos WHERE id=?').get(req.params.id);
  if (!disp) return res.status(404).json({ error: 'No encontrado' });
  const { desde, hasta } = req.body;
  const hoy = hoyAR();
  try {
    const body = {
      AcsEventCond: {
        searchID: '1', searchResultPosition: 0, maxResults: 10,
        major: 5,
        startTime: `${desde || hoy}T00:00:00`,
        endTime:   `${hasta || hoy}T23:59:59`,
      }
    };
    const data = await hikRequest(disp.ip, disp.puerto, 'POST',
      '/ISAPI/AccessControl/AcsEvent?format=json', body, disp.usuario, disp.password);
    res.json({ raw: data, bodyEnviado: body });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Helper: sincroniza un dispositivo para un rango de fechas ────────────────
async function syncDispositivo(disp, desde, hasta, empMap, ins) {
  let insertados = 0, duplicados = 0, position = 0, paginas = 0;
  const PAGE = 50, MAX_PAG = 200;
  const acsPath = '/ISAPI/AccessControl/AcsEvent?format=json';

  while (paginas < MAX_PAG) {
    const body = {
      AcsEventCond: {
        searchID: '1', searchResultPosition: position, maxResults: PAGE,
        major: 5, minor: 0,
        startTime: `${desde}T00:00:00`,
        endTime:   `${hasta}T23:59:59`,
      }
    };

    const data = await hikRequest(disp.ip, disp.puerto, 'POST', acsPath, body, disp.usuario, disp.password);
    if (position === 0) {
      const evt0 = data?.AcsEvent;
      console.log('[ACS debug] status:', evt0?.responseStatusStrg, '| total:', evt0?.totalNum, '| items:', evt0?.InfoList?.length);
      if (evt0?.InfoList?.[0]) console.log('[ACS item0]', JSON.stringify(evt0.InfoList[0]));
      if (!evt0) console.log('[ACS raw]', JSON.stringify(data).substring(0, 400));
    }

    const evt = data?.AcsEvent;
    if (!evt) break;

    const items = evt.InfoList || [];
    if (items.length === 0) break;

    for (const item of items) {
      const timeStr = item.time || '';
      const fecha   = timeStr.substring(0, 10);
      const hora    = timeStr.substring(11, 16);
      if (!fecha || fecha.length !== 10) continue;

      const empExt = item.employeeNoString || item.cardNo || '';
      if (!empExt) continue;

      const empId = empMap[empExt] || null;
      const vt    = item.verifyType;
      const tipo  = vt === 20 ? 'Facial'
        : vt === 1  ? 'Tarjeta'
        : vt === 2  ? 'Tarjeta+PIN'
        : vt === 21 ? 'Facial+Tarjeta'
        : vt === 15 ? 'Código QR'
        : vt != null ? `Tipo ${vt}` : '';
      const temp = item.temperature > 0 ? item.temperature : null;

      const r = ins.run(disp.id, empId, item.name || '', empExt, fecha, hora, tipo, temp);
      if (r.changes > 0) insertados++; else duplicados++;
    }

    position += items.length;
    paginas++;
    if (evt.responseStatusStrg !== 'MORE') break;
  }

  db.prepare('UPDATE rrhh_dispositivos SET ultima_sync=? WHERE id=?')
    .run(new Date().toISOString().replace('T', ' ').substring(0, 16), disp.id);

  return { insertados, duplicados, paginas };
}

// ── Sincronizar asistencia (un dispositivo) ───────────────────────────────────
router.post('/dispositivos/:id/sync', verificarToken, async (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permiso' });
  const disp = db.prepare('SELECT * FROM rrhh_dispositivos WHERE id=?').get(req.params.id);
  if (!disp) return res.status(404).json({ error: 'Dispositivo no encontrado' });

  const hoy   = hoyAR();
  const desde = req.body.desde || hoy;
  const hasta = req.body.hasta || hoy;

  const empMap = {};
  for (const e of db.prepare("SELECT id, id_dispositivo FROM rrhh_empleados WHERE id_dispositivo != ''").all()) {
    empMap[e.id_dispositivo] = e.id;
  }
  const ins = db.prepare(`
    INSERT OR IGNORE INTO rrhh_asistencia
      (dispositivo_id, empleado_id, empleado_nombre, empleado_ext, fecha, hora, tipo_acceso, temperatura)
    VALUES (?,?,?,?,?,?,?,?)
  `);

  try {
    const result = await syncDispositivo(disp, desde, hasta, empMap, ins);
    res.json({ ok: true, ...result });
  } catch (err) {
    console.error('[RRHH sync]', err.message);
    res.status(500).json({ error: err.message || 'Error al comunicarse con el dispositivo' });
  }
});

// ── Sincronizar todos los dispositivos activos ────────────────────────────────
router.post('/dispositivos/sync-todos', verificarToken, async (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permiso' });
  const dispositivos = db.prepare('SELECT * FROM rrhh_dispositivos WHERE activo=1').all();
  if (dispositivos.length === 0) return res.json({ ok: true, insertados: 0, duplicados: 0, dispositivos: [] });

  const hoy   = hoyAR();
  const desde = req.body.desde || hoy;
  const hasta = req.body.hasta || hoy;

  const empMap = {};
  for (const e of db.prepare("SELECT id, id_dispositivo FROM rrhh_empleados WHERE id_dispositivo != ''").all()) {
    empMap[e.id_dispositivo] = e.id;
  }
  const ins = db.prepare(`
    INSERT OR IGNORE INTO rrhh_asistencia
      (dispositivo_id, empleado_id, empleado_nombre, empleado_ext, fecha, hora, tipo_acceso, temperatura)
    VALUES (?,?,?,?,?,?,?,?)
  `);

  let totalInsertados = 0, totalDuplicados = 0;
  const resultados = [];

  for (const disp of dispositivos) {
    try {
      const r = await syncDispositivo(disp, desde, hasta, empMap, ins);
      totalInsertados += r.insertados;
      totalDuplicados += r.duplicados;
      resultados.push({ id: disp.id, nombre: disp.nombre, ...r, error: null });
    } catch (err) {
      console.error(`[RRHH sync-todos] ${disp.nombre}:`, err.message);
      resultados.push({ id: disp.id, nombre: disp.nombre, insertados: 0, duplicados: 0, error: err.message });
    }
  }

  res.json({ ok: true, insertados: totalInsertados, duplicados: totalDuplicados, dispositivos: resultados });
});

// ── Empleados detectados en el fichador ───────────────────────────────────────
router.get('/asistencia/empleados-dispositivo', verificarToken, (req, res) => {
  const rows = db.prepare(`
    SELECT
      a.empleado_ext,
      MAX(a.empleado_nombre)         AS nombre_dispositivo,
      COUNT(DISTINCT a.fecha)        AS dias,
      COUNT(*)                       AS lecturas,
      MAX(a.empleado_id)             AS empleado_id,
      MAX(e.nombre)                  AS nombre_erp
    FROM rrhh_asistencia a
    LEFT JOIN rrhh_empleados e ON e.id = a.empleado_id
    WHERE a.empleado_ext != ''
    GROUP BY a.empleado_ext
    ORDER BY nombre_dispositivo
  `).all();
  res.json(rows);
});

// Vincula un ext_id del dispositivo a un empleado ERP y actualiza registros históricos
router.post('/asistencia/vincular', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permiso' });
  const { emp_id, empleado_ext } = req.body;
  if (!empleado_ext) return res.status(400).json({ error: 'empleado_ext requerido' });

  try {
    db.prepare("UPDATE rrhh_empleados SET id_dispositivo = ? WHERE id = ?").run(empleado_ext, emp_id || null);
    if (emp_id) {
      // Actualiza registros históricos que no tienen empleado asignado
      db.prepare(`UPDATE rrhh_asistencia SET empleado_id = ?
                  WHERE empleado_ext = ? AND empleado_id IS NULL`).run(emp_id, empleado_ext);
    } else {
      // Desvincula: limpia registros que apuntaban a este ext
      db.prepare(`UPDATE rrhh_asistencia SET empleado_id = NULL
                  WHERE empleado_ext = ?`).run(empleado_ext);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/asistencia/resumen', verificarToken, (req, res) => {
  const { desde, hasta, empleado_id } = req.query;
  const where = [], params = [];
  if (desde)       { where.push('a.fecha >= ?');       params.push(desde); }
  if (hasta)       { where.push('a.fecha <= ?');       params.push(hasta); }
  if (empleado_id) { where.push('a.empleado_id = ?'); params.push(empleado_id); }

  const rows = db.prepare(`
    SELECT
      a.fecha,
      a.empleado_id,
      a.empleado_ext,
      COALESCE(e.nombre, a.empleado_nombre, a.empleado_ext) AS nombre,
      e.tipo            AS emp_tipo,
      e.horario_entrada AS horario_entrada,
      e.horario_salida  AS horario_salida,
      MIN(a.hora) AS entrada,
      MAX(a.hora) AS salida,
      COUNT(*)    AS n_lecturas,
      CASE WHEN MIN(a.hora) != MAX(a.hora) THEN
        ROUND((
          ( CAST(SUBSTR(MAX(a.hora),1,2) AS REAL)*60
          + CAST(SUBSTR(MAX(a.hora),4,2) AS REAL) )
        - ( CAST(SUBSTR(MIN(a.hora),1,2) AS REAL)*60
          + CAST(SUBSTR(MIN(a.hora),4,2) AS REAL) )
        ) / 60.0, 2)
      ELSE NULL END AS horas
    FROM rrhh_asistencia a
    LEFT JOIN rrhh_empleados e ON e.id = a.empleado_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    GROUP BY a.fecha, COALESCE(CAST(a.empleado_id AS TEXT), a.empleado_ext)
    ORDER BY a.fecha DESC, nombre
    LIMIT 2000
  `).all(...params);
  res.json(rows);
});

// ── Asistencia: lecturas individuales (raw) ───────────────────────────────────
router.get('/asistencia', verificarToken, (req, res) => {
  const { desde, hasta, empleado_id } = req.query;
  const where = [], params = [];

  if (desde)       { where.push('a.fecha >= ?');       params.push(desde); }
  if (hasta)       { where.push('a.fecha <= ?');       params.push(hasta); }
  if (empleado_id) { where.push('a.empleado_id = ?'); params.push(empleado_id); }

  const rows = db.prepare(`
    SELECT a.*,
           e.nombre AS emp_nombre_rrhh, e.tipo AS emp_tipo
    FROM rrhh_asistencia a
    LEFT JOIN rrhh_empleados e ON e.id = a.empleado_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY a.fecha DESC, a.hora ASC
    LIMIT 3000
  `).all(...params);
  res.json(rows);
});

// ── Partes: resumen semanal por empleado ──────────────────────────────────────
router.get('/partes/semana', verificarToken, (req, res) => {
  const dias = Math.min(Math.max(parseInt(req.query.dias) || 7, 1), 30);
  const fechas = [];
  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    fechas.push(d.toISOString().split('T')[0]);
  }
  const desde = fechas[0], hasta = fechas[fechas.length - 1];

  const empleados = db.prepare(
    `SELECT id, nombre, tipo FROM rrhh_empleados WHERE activo=1 ORDER BY tipo, nombre`
  ).all();

  const partes = db.prepare(`
    SELECT empleado_id, fecha,
           ROUND(SUM(horas), 2) AS horas_parte,
           COUNT(*) AS n_registros
    FROM rrhh_registros
    WHERE fecha BETWEEN ? AND ?
    GROUP BY empleado_id, fecha
  `).all(desde, hasta);

  const fichadas = db.prepare(`
    SELECT a.empleado_id, a.fecha,
           MIN(a.hora) AS entrada, MAX(a.hora) AS salida,
           CASE WHEN MIN(a.hora) != MAX(a.hora) THEN
             ROUND((
               (CAST(SUBSTR(MAX(a.hora),1,2) AS REAL)*60 + CAST(SUBSTR(MAX(a.hora),4,2) AS REAL))
             - (CAST(SUBSTR(MIN(a.hora),1,2) AS REAL)*60 + CAST(SUBSTR(MIN(a.hora),4,2) AS REAL))
             - CASE WHEN MIN(a.hora) <= '13:00' AND MAX(a.hora) >= '14:00' THEN 60 ELSE 0 END
             ) / 60.0, 2)
           ELSE NULL END AS horas_fichada
    FROM rrhh_asistencia a
    WHERE a.fecha BETWEEN ? AND ? AND a.empleado_id IS NOT NULL
    GROUP BY a.empleado_id, a.fecha
  `).all(desde, hasta);

  const partesMap = {};
  for (const p of partes) partesMap[`${p.empleado_id}_${p.fecha}`] = p;
  const fichadasMap = {};
  for (const f of fichadas) fichadasMap[`${f.empleado_id}_${f.fecha}`] = f;

  const resultado = empleados.map(emp => ({
    ...emp,
    dias: Object.fromEntries(fechas.map(fecha => {
      const p = partesMap[`${emp.id}_${fecha}`];
      const f = fichadasMap[`${emp.id}_${fecha}`];
      return [fecha, {
        horas_parte:   p ? +p.horas_parte : 0,
        n_registros:   p ? p.n_registros  : 0,
        tiene_parte:   !!p,
        horas_fichada: f ? f.horas_fichada : null,
        entrada:       f ? f.entrada       : null,
        salida:        f ? f.salida        : null,
      }];
    })),
  }));

  res.json({ fechas, empleados: resultado });
});

// ── Partes: horas por proyecto activo desglosadas por tarea ──────────────────
router.get('/partes/proyectos', verificarToken, (req, res) => {
  const dias = Math.min(Math.max(parseInt(req.query.dias) || 7, 1), 90);
  const hasta = hoyAR();
  const [hy, hm, hd] = hasta.split('-').map(Number);
  const desdeD = new Date(hy, hm - 1, hd - (dias - 1));
  const desde = desdeD.toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });

  const rows = db.prepare(`
    SELECT
      p.id   AS proyecto_id, p.nombre AS proyecto_nombre,
      c.codigo AS cat_codigo, c.descripcion AS cat_descripcion,
      c.grupo  AS cat_grupo,
      ROUND(SUM(r.horas), 2) AS horas
    FROM rrhh_registros r
    JOIN proyectos p ON p.id = r.proyecto_id
    LEFT JOIN rrhh_categorias c ON c.id = r.categoria_id
    WHERE r.fecha BETWEEN ? AND ?
    GROUP BY p.id, r.categoria_id
    ORDER BY p.nombre, horas DESC
  `).all(desde, hasta);

  const proyMap = {};
  for (const row of rows) {
    if (!proyMap[row.proyecto_id]) {
      proyMap[row.proyecto_id] = {
        id: row.proyecto_id, nombre: row.proyecto_nombre,
        total_horas: 0, tareas: [],
      };
    }
    proyMap[row.proyecto_id].total_horas =
      +(proyMap[row.proyecto_id].total_horas + row.horas).toFixed(2);
    proyMap[row.proyecto_id].tareas.push({
      cat_codigo:      row.cat_codigo      || 'OT',
      cat_descripcion: row.cat_descripcion || 'Sin categoría',
      cat_grupo:       row.cat_grupo       || '',
      horas:           row.horas,
    });
  }

  res.json(Object.values(proyMap).sort((a, b) => b.total_horas - a.total_horas));
});

// ── Informes ──────────────────────────────────────────────────────────────────

router.get('/informes/asistencia', verificarToken, (req, res) => {
  const { desde, hasta, empleado_id } = req.query;
  if (!desde || !hasta) return res.status(400).json({ error: 'Requerido: desde, hasta' });

  const where  = ['a.fecha BETWEEN ? AND ?', 'a.empleado_id IS NOT NULL']
  const params = [desde, hasta]
  if (empleado_id) { where.push('e.id = ?'); params.push(empleado_id) }

  const fichadas = db.prepare(`
    SELECT e.id AS empleado_id, e.nombre AS empleado, a.fecha,
           MIN(a.hora) AS entrada, MAX(a.hora) AS salida,
           CASE WHEN MIN(a.hora) != MAX(a.hora) THEN
             ROUND((
               (CAST(SUBSTR(MAX(a.hora),1,2) AS REAL)*60 + CAST(SUBSTR(MAX(a.hora),4,2) AS REAL))
             - (CAST(SUBSTR(MIN(a.hora),1,2) AS REAL)*60 + CAST(SUBSTR(MIN(a.hora),4,2) AS REAL))
             - CASE WHEN MIN(a.hora) <= '13:00' AND MAX(a.hora) >= '14:00' THEN 60 ELSE 0 END
             ) / 60.0, 2)
           ELSE NULL END AS horas_fichada
    FROM rrhh_asistencia a
    JOIN rrhh_empleados e ON e.id = a.empleado_id
    WHERE ${where.join(' AND ')}
    GROUP BY a.empleado_id, a.fecha
    ORDER BY e.nombre, a.fecha
  `).all(...params);

  const pParams = [desde, hasta]
  if (empleado_id) pParams.push(empleado_id)
  const partes = db.prepare(`
    SELECT empleado_id, fecha, ROUND(SUM(horas), 2) AS horas_parte
    FROM rrhh_registros
    WHERE fecha BETWEEN ? AND ?
    ${empleado_id ? 'AND empleado_id = ?' : ''}
    GROUP BY empleado_id, fecha
  `).all(...pParams);
  const pm = Object.fromEntries(partes.map(p => [`${p.empleado_id}_${p.fecha}`, p.horas_parte]));

  res.json(fichadas.map(f => ({
    empleado:      f.empleado,
    fecha:         f.fecha,
    entrada:       f.entrada      || '',
    salida:        f.salida       || '',
    horas_fichada: f.horas_fichada ?? '',
    horas_parte:   pm[`${f.empleado_id}_${f.fecha}`] ?? 0,
    diferencia:    f.horas_fichada != null
      ? +(f.horas_fichada - (pm[`${f.empleado_id}_${f.fecha}`] ?? 0)).toFixed(2)
      : '',
  })));
});

router.get('/informes/tareas', verificarToken, (req, res) => {
  const { desde, hasta, empleado_id } = req.query;
  if (!desde || !hasta) return res.status(400).json({ error: 'Requerido: desde, hasta' });

  const where  = ['r.fecha BETWEEN ? AND ?']
  const params = [desde, hasta]
  if (empleado_id) { where.push('r.empleado_id = ?'); params.push(empleado_id) }

  const rows = db.prepare(`
    SELECT e.nombre AS empleado, r.fecha,
           COALESCE(rp.nombre, p.nombre, a.nombre, '') AS proyecto,
           COALESCE(c.codigo, '') AS codigo,
           COALESCE(c.descripcion, '') AS tarea,
           COALESCE(c.grupo, '') AS grupo,
           COALESCE(r.hora_inicio, '') AS hora_inicio,
           COALESCE(r.hora_fin, '')    AS hora_fin,
           r.horas,
           COALESCE(r.descripcion, '') AS observacion
    FROM rrhh_registros r
    JOIN rrhh_empleados e ON e.id = r.empleado_id
    LEFT JOIN rrhh_proyectos   rp ON rp.id = r.proyecto_id
    LEFT JOIN proyectos        p  ON p.id  = r.proyecto_id
    LEFT JOIN rrhh_actividades a  ON a.id  = r.actividad_id
    LEFT JOIN rrhh_categorias  c  ON c.id  = r.categoria_id
    WHERE ${where.join(' AND ')}
    ORDER BY e.nombre, r.fecha, r.hora_inicio
  `).all(...params);

  res.json(rows);
});

// ── Resumen ayer (para admin/rrhh en dashboard) ───────────────────────────────

router.get('/resumen-ayer', verificarToken, (req, res) => {
  const puedeVer = req.usuario?.rol === 'admin'
    || !!(req.permisos?.rrhh?.leer)
    || !!(req.permisos?.partes?.leer);
  if (!puedeVer) return res.status(403).json({ error: 'Sin permiso' });

  const ayer = new Date();
  ayer.setDate(ayer.getDate() - 1);
  const fecha = ayer.toISOString().slice(0, 10);

  const fichadas = db.prepare(`
    SELECT e.id, e.nombre, COALESCE(e.obliga_fichar, 1) AS obliga_fichar,
           MIN(a.hora) AS entrada, MAX(a.hora) AS salida,
           CASE WHEN MIN(a.hora) != MAX(a.hora) THEN
             ROUND((
               (CAST(SUBSTR(MAX(a.hora),1,2) AS REAL)*60 + CAST(SUBSTR(MAX(a.hora),4,2) AS REAL))
             - (CAST(SUBSTR(MIN(a.hora),1,2) AS REAL)*60 + CAST(SUBSTR(MIN(a.hora),4,2) AS REAL))
             - CASE WHEN MIN(a.hora) <= '13:00' AND MAX(a.hora) >= '14:00' THEN 60 ELSE 0 END
             ) / 60.0, 2)
           ELSE NULL END AS horas_fichada
    FROM rrhh_asistencia a
    JOIN rrhh_empleados e ON e.id = a.empleado_id
    WHERE a.fecha = ? AND a.empleado_id IS NOT NULL AND e.activo = 1
      AND COALESCE(e.obliga_fichar, 1) != 0
    GROUP BY a.empleado_id
    ORDER BY e.nombre
  `).all(fecha);

  const partes = db.prepare(`
    SELECT empleado_id, ROUND(SUM(horas), 2) AS horas_parte, COUNT(*) AS n
    FROM rrhh_registros WHERE fecha = ?
    GROUP BY empleado_id
  `).all(fecha);
  const partesMap = Object.fromEntries(partes.map(p => [p.empleado_id, p]));

  const sinFichar = db.prepare(`
    SELECT e.id, e.nombre
    FROM rrhh_empleados e
    WHERE e.activo = 1
      AND NOT (e.tipo = 'interno' AND COALESCE(e.obliga_fichar, 1) = 0)
      AND e.id NOT IN (
        SELECT DISTINCT empleado_id FROM rrhh_asistencia
        WHERE fecha = ? AND empleado_id IS NOT NULL
      )
    ORDER BY e.nombre
  `).all(fecha);

  res.json({
    fecha,
    empleados: fichadas.map(f => ({
      ...f,
      requiere_parte: f.obliga_fichar !== 0,
      tiene_parte:    !!partesMap[f.id],
      horas_parte:    partesMap[f.id]?.horas_parte || 0,
    })),
    sin_fichar: sinFichar,
  });
});

// ── Mi Ayer ───────────────────────────────────────────────────────────────────

router.get('/mi-ayer', verificarToken, (req, res) => {
  const u = db.prepare(`
    SELECT u.rrhh_empleado_id, COALESCE(e.obliga_fichar, 1) AS obliga_fichar
    FROM usuarios u LEFT JOIN rrhh_empleados e ON e.id = u.rrhh_empleado_id
    WHERE u.id=?
  `).get(req.usuario.id);
  if (!u?.rrhh_empleado_id) return res.json(null);

  const ayer = new Date();
  ayer.setDate(ayer.getDate() - 1);
  const fecha = ayer.toISOString().slice(0, 10);

  const fichada = db.prepare(`
    SELECT MIN(hora) AS entrada, MAX(hora) AS salida,
      CASE WHEN MIN(hora) != MAX(hora) THEN
        ROUND((
          (CAST(SUBSTR(MAX(hora),1,2) AS REAL)*60 + CAST(SUBSTR(MAX(hora),4,2) AS REAL))
        - (CAST(SUBSTR(MIN(hora),1,2) AS REAL)*60 + CAST(SUBSTR(MIN(hora),4,2) AS REAL))
        - CASE WHEN MIN(hora) <= '13:00' AND MAX(hora) >= '14:00' THEN 60 ELSE 0 END
        ) / 60.0, 2)
      ELSE NULL END AS horas_fichada
    FROM rrhh_asistencia
    WHERE empleado_id = ? AND fecha = ?
  `).get(u.rrhh_empleado_id, fecha);

  const parte = db.prepare(`
    SELECT COUNT(*) AS n, ROUND(COALESCE(SUM(horas), 0), 2) AS horas_parte
    FROM rrhh_registros
    WHERE empleado_id = ? AND fecha = ?
  `).get(u.rrhh_empleado_id, fecha);

  res.json({
    fecha,
    entrada:        fichada?.entrada       || null,
    salida:         fichada?.salida        || null,
    horas_fichada:  fichada?.horas_fichada || null,
    requiere_parte: u.obliga_fichar !== 0,
    tiene_parte:    (parte?.n || 0) > 0,
    horas_parte:    parte?.horas_parte     || 0,
  });
});

// ── Mi Parte ──────────────────────────────────────────────────────────────────

router.get('/mi-parte', verificarToken, (req, res) => {
  const u = db.prepare('SELECT rrhh_empleado_id FROM usuarios WHERE id=?').get(req.usuario.id);
  if (!u?.rrhh_empleado_id) return res.json(null);
  const fecha = req.query.fecha || new Date().toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT r.*, c.codigo AS cat_codigo, c.descripcion AS cat_descripcion, c.grupo AS cat_grupo,
           COALESCE(rp.nombre, p.nombre, a.nombre) AS proyecto_nombre
    FROM rrhh_registros r
    LEFT JOIN rrhh_categorias  c  ON c.id  = r.categoria_id
    LEFT JOIN rrhh_proyectos   rp ON rp.id = r.proyecto_id
    LEFT JOIN proyectos        p  ON p.id  = r.proyecto_id
    LEFT JOIN rrhh_actividades a  ON a.id  = r.actividad_id
    WHERE r.empleado_id = ? AND r.fecha = ?
    ORDER BY r.hora_inicio
  `).all(u.rrhh_empleado_id, fecha);
  res.json(rows);
});

router.post('/mi-parte', verificarToken, (req, res) => {
  const u = db.prepare('SELECT rrhh_empleado_id FROM usuarios WHERE id=?').get(req.usuario.id);
  if (!u?.rrhh_empleado_id)
    return res.status(400).json({ error: 'Tu usuario no tiene empleado asociado. Pedile al administrador que lo configure.' });
  const { registros } = req.body;
  if (!Array.isArray(registros) || registros.length === 0)
    return res.status(400).json({ error: 'Sin registros' });
  const ins = db.prepare('INSERT INTO rrhh_registros (fecha,empleado_id,proyecto_id,categoria_id,hora_inicio,hora_fin,horas,modulo,descripcion) VALUES (?,?,?,?,?,?,?,?,?)');
  let insertados = 0;
  db.transaction(() => {
    for (const r of registros) {
      ins.run(r.fecha, u.rrhh_empleado_id, r.proyecto_id || null, r.categoria_id || null,
              r.hora_inicio || null, r.hora_fin || null, r.horas, r.modulo || '', r.descripcion || '');
      insertados++;
    }
  })();
  res.json({ ok: true, insertados });
});

module.exports = router;
