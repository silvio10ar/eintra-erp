const express = require('express');
const http    = require('http');
const https   = require('https');
const crypto  = require('crypto');
const { db } = require('../db/database');
const { verificarToken } = require('../middleware/auth');

const router = express.Router();
const puede = req => req.usuario?.rol === 'admin' || !!(req.permisos?.rrhh?.escribir);

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
    FROM rrhh_proyectos p
    LEFT JOIN rrhh_registros r ON r.proyecto_id = p.id AND r.fecha BETWEEN ? AND ?
    GROUP BY p.id
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
           p.nombre AS proyecto_nombre,
           c.codigo AS cat_codigo, c.descripcion AS cat_descripcion, c.grupo AS cat_grupo
    FROM rrhh_registros r
    LEFT JOIN rrhh_empleados e  ON e.id = r.empleado_id
    LEFT JOIN rrhh_proyectos p  ON p.id = r.proyecto_id
    LEFT JOIN rrhh_categorias c ON c.id = r.categoria_id
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

router.put('/registros/:id', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permiso' });
  const { fecha, empleado_id, proyecto_id, categoria_id, hora_inicio, hora_fin, horas, modulo, descripcion } = req.body;

  db.prepare(`
    UPDATE rrhh_registros
    SET fecha=?,empleado_id=?,proyecto_id=?,categoria_id=?,hora_inicio=?,hora_fin=?,horas=?,modulo=?,descripcion=?
    WHERE id=?
  `).run(fecha, empleado_id, proyecto_id || null, categoria_id || null,
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
  const { nombre, tipo, empresa, activo, id_dispositivo } = req.body;
  db.prepare(`UPDATE rrhh_empleados SET nombre=?,tipo=?,empresa=?,activo=?,id_dispositivo=? WHERE id=?`)
    .run(nombre.trim().toUpperCase(), tipo || 'interno', empresa || '',
         activo !== undefined ? Number(activo) : 1,
         id_dispositivo || '', req.params.id);
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

// ── Proyectos ─────────────────────────────────────────────────────────────────
router.get('/proyectos', verificarToken, (req, res) => {
  const rows = db.prepare(`
    SELECT p.*,
           (SELECT COALESCE(SUM(horas),0) FROM rrhh_registros r WHERE r.proyecto_id = p.id) AS total_horas
    FROM rrhh_proyectos p
    ORDER BY p.activo DESC, p.nombre
  `).all();
  res.json(rows);
});

router.post('/proyectos', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permiso' });
  const { nombre } = req.body;
  if (!nombre) return res.status(400).json({ error: 'nombre es requerido' });
  const r = db.prepare(`INSERT INTO rrhh_proyectos (nombre) VALUES (?)`).run(nombre.trim().toUpperCase());
  res.json({ id: r.lastInsertRowid });
});

router.put('/proyectos/:id', verificarToken, (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permiso' });
  const { nombre, activo } = req.body;
  db.prepare(`UPDATE rrhh_proyectos SET nombre=?,activo=? WHERE id=?`)
    .run(nombre.trim().toUpperCase(), activo !== undefined ? Number(activo) : 1, req.params.id);
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
  const hoy = new Date().toISOString().split('T')[0];
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

// ── Sincronizar asistencia ────────────────────────────────────────────────────
router.post('/dispositivos/:id/sync', verificarToken, async (req, res) => {
  if (!puede(req)) return res.status(403).json({ error: 'Sin permiso' });
  const disp = db.prepare('SELECT * FROM rrhh_dispositivos WHERE id=?').get(req.params.id);
  if (!disp) return res.status(404).json({ error: 'Dispositivo no encontrado' });

  const hoy   = new Date().toISOString().split('T')[0];
  const desde = req.body.desde || hoy;
  const hasta = req.body.hasta || hoy;

  let insertados = 0, duplicados = 0, position = 0, paginas = 0;
  const PAGE = 50, MAX_PAG = 200;
  const path = '/ISAPI/AccessControl/AcsEvent?format=json';

  try {
    // Mapa de id_dispositivo → empleado_id
    const empMap = {};
    for (const e of db.prepare("SELECT id, id_dispositivo FROM rrhh_empleados WHERE id_dispositivo != ''").all()) {
      empMap[e.id_dispositivo] = e.id;
    }

    const ins = db.prepare(`
      INSERT OR IGNORE INTO rrhh_asistencia
        (dispositivo_id, empleado_id, empleado_nombre, empleado_ext,
         fecha, hora, tipo_acceso, temperatura)
      VALUES (?,?,?,?,?,?,?,?)
    `);

    while (paginas < MAX_PAG) {
      const body = {
        AcsEventCond: {
          searchID:             '1',
          searchResultPosition: position,
          maxResults:           PAGE,
          major:                5,
          minor:                0,
          startTime:            `${desde}T00:00:00`,
          endTime:              `${hasta}T23:59:59`,
        }
      };

      const data = await hikRequest(disp.ip, disp.puerto, 'POST', path, body, disp.usuario, disp.password);
      if (position === 0) {
        const evt0 = data?.AcsEvent;
        console.log('[ACS debug] status:', evt0?.responseStatusStrg, '| total:', evt0?.totalNum, '| items:', evt0?.InfoList?.length);
        if (evt0?.InfoList?.[0]) console.log('[ACS item0]', JSON.stringify(evt0.InfoList[0]));
        if (!evt0) console.log('[ACS raw]', JSON.stringify(data).substring(0, 400));
      }
      const evt  = data?.AcsEvent;
      if (!evt) break;

      const items = evt.InfoList || [];
      if (items.length === 0) break;

      for (const item of items) {
        const timeStr = item.time || '';
        const fecha   = timeStr.substring(0, 10);    // "2024-01-15"
        const hora    = timeStr.substring(11, 16);   // "08:30"
        if (!fecha || fecha.length !== 10) continue;

        const empExt  = item.employeeNoString || item.cardNo || '';
        if (!empExt) continue;  // ignorar eventos de puerta sin empleado

        const empId   = empMap[empExt] || null;
        const vt      = item.verifyType;
        const tipo    = vt === 20 ? 'Facial'
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
      if (evt.responseStatusStrg !== 'MORE') break;  // el dispositivo dice que no hay más
    }

    db.prepare('UPDATE rrhh_dispositivos SET ultima_sync=? WHERE id=?')
      .run(new Date().toISOString().replace('T',' ').substring(0,16), disp.id);

    res.json({ ok: true, insertados, duplicados, paginas });
  } catch (err) {
    console.error('[RRHH sync]', err.message);
    res.status(500).json({ error: err.message || 'Error al comunicarse con el dispositivo' });
  }
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
      e.tipo  AS emp_tipo,
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

module.exports = router;
