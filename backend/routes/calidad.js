'use strict'
const express = require('express')
const path    = require('path')
const fs      = require('fs')
const multer  = require('multer')
const { db }  = require('../db/database')
const { verificarToken, puede } = require('../middleware/auth')
const { buscarCondicion } = require('../helpers/buscar')

const router = express.Router()
router.use(verificarToken)

const puedeE = req => !!req.permisos?.calidad?.escribir
// Corta antes de que multer escriba el archivo a disco — si el chequeo fuera
// dentro del handler, un usuario sin permiso ya habría subido el archivo.
const soloEscribirCalidad = (req, res, next) => puedeE(req) ? next() : res.status(403).json({ error: 'Sin permisos' })

// ── Documentos de Calidad (control de documentos ISO 9001:2015, cláusula 7.5) ──
// Sin gate de calidad.leer/escribir en las lecturas: la Política de Calidad, en
// particular, tiene que poder consultarla cualquier empleado autenticado —
// por eso estas rutas van antes del router.use(puede.leer('calidad')) de abajo,
// que sí aplica al resto del módulo (hojas de ruta, no conformidades, etc).
const backendRoot = path.resolve(__dirname, '..')
const rawUploads   = process.env.UPLOADS_PATH || './uploads'
const uploadsDir   = path.isAbsolute(rawUploads) ? rawUploads : path.resolve(backendRoot, rawUploads)
const DOCS_DIR      = path.join(uploadsDir, 'documentos_calidad')
fs.mkdirSync(DOCS_DIR, { recursive: true })

const uploadDoc = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, DOCS_DIR),
    filename: (req, file, cb) => {
      const codigo = (req.params.codigo || req.body.codigo || 'DOC').replace(/[^A-Za-z0-9_-]/g, '')
      const ext = path.extname(file.originalname) || '.pdf'
      cb(null, `${codigo}_${Date.now()}${ext}`)
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['application/pdf', 'image/jpeg', 'image/png'].includes(file.mimetype)
    cb(null, ok)
  },
})

router.get('/documentos', (req, res) => {
  const rows = db.prepare(`
    SELECT d.*,
      (SELECT COUNT(*) FROM documentos_calidad h WHERE h.codigo = d.codigo) - 1 AS revisiones_anteriores
    FROM documentos_calidad d
    WHERE d.estado = 'Vigente'
    ORDER BY d.categoria, d.codigo
  `).all()
  res.json(rows)
})

router.get('/documentos/:codigo/historial', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM documentos_calidad WHERE codigo = ? ORDER BY revision DESC
  `).all(req.params.codigo)
  res.json(rows)
})

router.get('/documentos/:id/archivo', (req, res) => {
  const doc = db.prepare('SELECT * FROM documentos_calidad WHERE id=?').get(req.params.id)
  if (!doc) return res.status(404).json({ error: 'No encontrado' })
  const full = path.join(DOCS_DIR, path.basename(doc.archivo_path))
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'Archivo no encontrado en el servidor' })
  res.download(full, doc.archivo_nombre_original || path.basename(full))
})

router.post('/documentos', soloEscribirCalidad, uploadDoc.single('archivo'), (req, res) => {
  const { codigo, titulo, categoria, aprobado_por, fecha_aprobacion, observaciones } = req.body
  if (!codigo?.trim() || !titulo?.trim()) return res.status(400).json({ error: 'Código y título son requeridos' })
  if (!req.file) return res.status(400).json({ error: 'Falta el archivo (PDF, JPG o PNG)' })
  const existe = db.prepare('SELECT 1 FROM documentos_calidad WHERE codigo=?').get(codigo.trim())
  if (existe) return res.status(409).json({ error: `Ya existe un documento con código "${codigo.trim()}"` })
  const r = db.prepare(`
    INSERT INTO documentos_calidad
      (codigo,titulo,categoria,revision,archivo_path,archivo_nombre_original,aprobado_por,fecha_aprobacion,observaciones,created_by)
    VALUES (?,?,?,0,?,?,?,?,?,?)
  `).run(codigo.trim(), titulo.trim(), categoria || 'Procedimiento', req.file.filename,
         req.file.originalname, aprobado_por || '', fecha_aprobacion || '', observaciones || '', req.usuario.id)
  res.status(201).json({ id: r.lastInsertRowid })
})

router.post('/documentos/:codigo/revision', soloEscribirCalidad, uploadDoc.single('archivo'), (req, res) => {
  const vigente = db.prepare("SELECT * FROM documentos_calidad WHERE codigo=? AND estado='Vigente'").get(req.params.codigo)
  if (!vigente) return res.status(404).json({ error: 'No existe un documento vigente con ese código' })
  if (!req.file) return res.status(400).json({ error: 'Falta el archivo (PDF, JPG o PNG)' })
  const { aprobado_por, fecha_aprobacion, observaciones, titulo, categoria } = req.body
  const nuevaRev = vigente.revision + 1
  const id = db.transaction(() => {
    db.prepare("UPDATE documentos_calidad SET estado='Obsoleto' WHERE id=?").run(vigente.id)
    const r = db.prepare(`
      INSERT INTO documentos_calidad
        (codigo,titulo,categoria,revision,archivo_path,archivo_nombre_original,aprobado_por,fecha_aprobacion,observaciones,documento_anterior_id,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(vigente.codigo, titulo || vigente.titulo, categoria || vigente.categoria, nuevaRev,
           req.file.filename, req.file.originalname, aprobado_por || '', fecha_aprobacion || '',
           observaciones || '', vigente.id, req.usuario.id)
    return r.lastInsertRowid
  })()
  res.status(201).json({ id, revision: nuevaRev })
})

router.put('/documentos/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const doc = db.prepare('SELECT * FROM documentos_calidad WHERE id=?').get(req.params.id)
  if (!doc) return res.status(404).json({ error: 'No encontrado' })
  const { titulo, categoria, aprobado_por, fecha_aprobacion, observaciones } = req.body
  db.prepare(`
    UPDATE documentos_calidad SET titulo=?,categoria=?,aprobado_por=?,fecha_aprobacion=?,observaciones=? WHERE id=?
  `).run(titulo ?? doc.titulo, categoria ?? doc.categoria, aprobado_por ?? doc.aprobado_por,
         fecha_aprobacion ?? doc.fecha_aprobacion, observaciones ?? doc.observaciones, req.params.id)
  res.json({ ok: true })
})

router.use(puede.leer('calidad'))

// ── Objetivos de Calidad medibles (ISO 9001:2015, cláusula 6.2) ───────────────
// Las 4 fuentes automáticas nunca persisten un valor: se recalculan en cada
// request a partir de las tablas de origen (no_conformidad, ordenes_trabajo,
// evaluaciones_proveedor, calidad_inspeccion). Solo la fuente "manual" guarda
// mediciones cargadas a mano, para métricas que el sistema todavía no tiene.
function limitesPeriodo(periodicidad, ref = new Date()) {
  const y = ref.getFullYear()
  const m = ref.getMonth()
  const pad = n => String(n).padStart(2, '0')
  if (periodicidad === 'mensual') {
    const ultimoDia = new Date(y, m + 1, 0).getDate()
    return { periodo: `${y}-${pad(m + 1)}`, desde: `${y}-${pad(m + 1)}-01`, hasta: `${y}-${pad(m + 1)}-${pad(ultimoDia)}`, anio: y }
  }
  if (periodicidad === 'trimestral') {
    const q = Math.floor(m / 3) + 1
    const mDesde = (q - 1) * 3
    const mHasta = mDesde + 2
    const ultimoDia = new Date(y, mHasta + 1, 0).getDate()
    return { periodo: `${y}-Q${q}`, desde: `${y}-${pad(mDesde + 1)}-01`, hasta: `${y}-${pad(mHasta + 1)}-${pad(ultimoDia)}`, anio: y }
  }
  return { periodo: `${y}`, desde: `${y}-01-01`, hasta: `${y}-12-31`, anio: y }
}

function calcularValorFuente(fuente, { desde, hasta, anio }) {
  if (fuente === 'nc_cerradas_plazo') {
    const r = db.prepare(`
      SELECT COUNT(*) total,
        SUM(CASE WHEN estado='Cerrada' AND fecha_cierre<=fecha_limite THEN 1 ELSE 0 END) en_plazo
      FROM no_conformidad WHERE fecha BETWEEN ? AND ?
    `).get(desde, hasta)
    return r.total > 0 ? Math.round((r.en_plazo / r.total) * 1000) / 10 : null
  }
  if (fuente === 'ot_entregas_tiempo') {
    const r = db.prepare(`
      SELECT COUNT(*) total,
        SUM(CASE WHEN fecha_cierre<>'' AND fecha_cierre<=fecha_fin_est THEN 1 ELSE 0 END) a_tiempo
      FROM ordenes_trabajo WHERE fecha_cierre BETWEEN ? AND ? AND fecha_cierre<>''
    `).get(desde, hasta)
    return r.total > 0 ? Math.round((r.a_tiempo / r.total) * 1000) / 10 : null
  }
  if (fuente === 'eval_proveedores_puntaje') {
    const r = db.prepare(`SELECT AVG(puntaje) prom FROM evaluaciones_proveedor WHERE anio=?`).get(anio)
    return r.prom != null ? Math.round(r.prom * 10) / 10 : null
  }
  if (fuente === 'inspecciones_aprobadas') {
    const r = db.prepare(`
      SELECT COUNT(*) total, SUM(CASE WHEN resultado='Aprobado' THEN 1 ELSE 0 END) aprob
      FROM calidad_inspeccion WHERE fecha BETWEEN ? AND ?
    `).get(desde, hasta)
    return r.total > 0 ? Math.round((r.aprob / r.total) * 1000) / 10 : null
  }
  return null // 'manual' se resuelve aparte, leyendo objetivo_calidad_medicion
}

// Listado liviano de puestos (id+nombre) para el selector de responsable — la
// ruta completa /auth/puestos es solo-admin, y acá alcanza con el nombre.
router.get('/objetivos/puestos', (req, res) => {
  res.json(db.prepare('SELECT id, nombre FROM puestos ORDER BY nombre').all())
})

router.get('/objetivos', (req, res) => {
  const objetivos = db.prepare(`
    SELECT o.*, p.nombre AS puesto_nombre
    FROM objetivo_calidad o
    LEFT JOIN puestos p ON p.id = o.responsable_puesto_id
    WHERE o.estado='Activo'
    ORDER BY o.nombre
  `).all()
  const out = objetivos.map(o => {
    const periodo = limitesPeriodo(o.periodicidad)
    let valor_actual
    if (o.fuente === 'manual') {
      const m = db.prepare('SELECT valor FROM objetivo_calidad_medicion WHERE objetivo_id=? AND periodo=?').get(o.id, periodo.periodo)
      valor_actual = m ? m.valor : null
    } else {
      valor_actual = calcularValorFuente(o.fuente, periodo)
    }
    return { ...o, periodo_actual: periodo.periodo, valor_actual }
  })
  res.json(out)
})

router.post('/objetivos', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { nombre, descripcion, fuente, meta, unidad, periodicidad, responsable_puesto_id, responsable_nombre } = req.body
  if (!nombre?.trim()) return res.status(400).json({ error: 'nombre requerido' })
  if (meta === undefined || meta === null || isNaN(+meta)) return res.status(400).json({ error: 'meta requerida' })
  const info = db.prepare(`
    INSERT INTO objetivo_calidad (nombre, descripcion, fuente, meta, unidad, periodicidad, responsable_puesto_id, responsable_nombre, created_by)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(nombre.trim(), descripcion || '', fuente || 'manual', +meta, unidad || '%', periodicidad || 'anual',
         responsable_puesto_id || null, responsable_nombre || '', req.usuario.id)
  res.status(201).json({ id: info.lastInsertRowid })
})

router.put('/objetivos/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const ob = db.prepare('SELECT * FROM objetivo_calidad WHERE id=?').get(req.params.id)
  if (!ob) return res.status(404).json({ error: 'No encontrado' })
  const { nombre, descripcion, fuente, meta, unidad, periodicidad, responsable_puesto_id, responsable_nombre, estado } = req.body
  db.prepare(`
    UPDATE objetivo_calidad SET nombre=?, descripcion=?, fuente=?, meta=?, unidad=?, periodicidad=?,
      responsable_puesto_id=?, responsable_nombre=?, estado=? WHERE id=?
  `).run(
    nombre ?? ob.nombre, descripcion ?? ob.descripcion, fuente ?? ob.fuente, meta ?? ob.meta, unidad ?? ob.unidad,
    periodicidad ?? ob.periodicidad, responsable_puesto_id ?? ob.responsable_puesto_id, responsable_nombre ?? ob.responsable_nombre,
    estado ?? ob.estado, req.params.id
  )
  res.json({ ok: true })
})

router.delete('/objetivos/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const ob = db.prepare('SELECT * FROM objetivo_calidad WHERE id=?').get(req.params.id)
  if (!ob) return res.status(404).json({ error: 'No encontrado' })
  const tieneMediciones = db.prepare('SELECT COUNT(*) n FROM objetivo_calidad_medicion WHERE objetivo_id=?').get(req.params.id).n
  if (tieneMediciones > 0) {
    db.prepare("UPDATE objetivo_calidad SET estado='Cerrado' WHERE id=?").run(req.params.id)
    return res.json({ ok: true, cerrado: true })
  }
  db.prepare('DELETE FROM objetivo_calidad WHERE id=?').run(req.params.id)
  res.json({ ok: true, eliminado: true })
})

router.get('/objetivos/:id/serie', (req, res) => {
  const ob = db.prepare('SELECT * FROM objetivo_calidad WHERE id=?').get(req.params.id)
  if (!ob) return res.status(404).json({ error: 'No encontrado' })
  if (ob.fuente === 'manual') {
    const rows = db.prepare('SELECT periodo, valor, observaciones, created_at FROM objetivo_calidad_medicion WHERE objetivo_id=? ORDER BY periodo DESC').all(req.params.id)
    return res.json(rows)
  }
  const n = ob.periodicidad === 'mensual' ? 12 : ob.periodicidad === 'trimestral' ? 8 : 5
  const hoy = new Date()
  const out = []
  for (let i = 0; i < n; i++) {
    let ref
    if (ob.periodicidad === 'mensual') ref = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1)
    else if (ob.periodicidad === 'trimestral') ref = new Date(hoy.getFullYear(), hoy.getMonth() - i * 3, 1)
    else ref = new Date(hoy.getFullYear() - i, 0, 1)
    const periodo = limitesPeriodo(ob.periodicidad, ref)
    out.push({ periodo: periodo.periodo, valor: calcularValorFuente(ob.fuente, periodo) })
  }
  res.json(out)
})

router.post('/objetivos/:id/medicion', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const ob = db.prepare('SELECT * FROM objetivo_calidad WHERE id=?').get(req.params.id)
  if (!ob) return res.status(404).json({ error: 'No encontrado' })
  if (ob.fuente !== 'manual') return res.status(400).json({ error: 'Este objetivo tiene una fuente automática, no admite carga manual' })
  const { periodo, valor, observaciones } = req.body
  if (!periodo?.trim() || valor === undefined || valor === null || isNaN(+valor)) {
    return res.status(400).json({ error: 'periodo y valor son requeridos' })
  }
  db.prepare(`
    INSERT INTO objetivo_calidad_medicion (objetivo_id, periodo, valor, observaciones, created_by)
    VALUES (?,?,?,?,?)
    ON CONFLICT(objetivo_id, periodo) DO UPDATE SET
      valor=excluded.valor, observaciones=excluded.observaciones,
      created_by=excluded.created_by, created_at=datetime('now','localtime')
  `).run(req.params.id, periodo.trim(), +valor, observaciones || '', req.usuario.id)
  res.status(201).json({ ok: true })
})

const ETAPAS_DEFAULT = [
  'Corte de materiales',
  'Armado y soldadura',
  'Granallado',
  'Pintura base',
  'Pintura final',
  'Montaje',
  'Prueba funcional',
  'Control final',
  'Despacho',
]

function nextNumHR() {
  const anio = new Date().getFullYear()
  const last = db.prepare(`SELECT numero FROM hoja_ruta WHERE numero LIKE ? ORDER BY id DESC LIMIT 1`).get(`HR-${anio}-%`)
  if (!last) return `HR-${anio}-0001`
  const parts = last.numero.split('-')
  const n = parseInt(parts[parts.length - 1] || '0') + 1
  return `HR-${anio}-${String(n).padStart(4,'0')}`
}

function nextNumNC() {
  const anio = new Date().getFullYear()
  const last = db.prepare(`SELECT numero FROM no_conformidad WHERE numero LIKE ? ORDER BY id DESC LIMIT 1`).get(`NC-${anio}-%`)
  if (!last) return `NC-${anio}-001`
  const parts = last.numero.split('-')
  const n = parseInt(parts[parts.length - 1] || '0') + 1
  return `NC-${anio}-${String(n).padStart(3,'0')}`
}

// ── Resumen dashboard ─────────────────────────────────────────────────────────
router.get('/resumen', (req, res) => {
  const hrTotal     = db.prepare("SELECT COUNT(*) as c FROM hoja_ruta").get().c
  const hrEnProceso = db.prepare("SELECT COUNT(*) as c FROM hoja_ruta WHERE estado='En proceso'").get().c
  const hrTerminado = db.prepare("SELECT COUNT(*) as c FROM hoja_ruta WHERE estado='Terminado'").get().c
  const hrDespachado= db.prepare("SELECT COUNT(*) as c FROM hoja_ruta WHERE estado='Despachado'").get().c
  const ncAbiertas  = db.prepare("SELECT COUNT(*) as c FROM no_conformidad WHERE estado='Abierta'").get().c
  const ncEnProceso = db.prepare("SELECT COUNT(*) as c FROM no_conformidad WHERE estado='En proceso'").get().c
  const ncCerradas  = db.prepare("SELECT COUNT(*) as c FROM no_conformidad WHERE estado='Cerrada'").get().c
  const inspecciones= db.prepare("SELECT COUNT(*) as c FROM calidad_inspeccion").get().c
  res.json({ hrTotal, hrEnProceso, hrTerminado, hrDespachado, ncAbiertas, ncEnProceso, ncCerradas, inspecciones })
})

// ── Proyectos activos (combo) ──────────────────────────────────────────────────
router.get('/proyectos-activos', (req, res) => {
  const rows = db.prepare(
    `SELECT id, codigo, nombre, cliente_nombre FROM proyectos WHERE estado IN ('Activo','En espera') ORDER BY codigo`
  ).all()
  res.json(rows)
})

// ── Hojas de Ruta ─────────────────────────────────────────────────────────────
router.get('/hojas-ruta', (req, res) => {
  const { estado, buscar, proyecto_id } = req.query
  const conds = [], params = []
  if (estado)     { conds.push('h.estado=?'); params.push(estado) }
  if (proyecto_id){ conds.push('h.proyecto_id=?'); params.push(proyecto_id) }
  if (buscar) {
    const bc = buscarCondicion(buscar, ['h.numero', 'h.descripcion', 'h.cliente_nombre'])
    conds.push(bc.cond); params.push(...bc.params)
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const rows = db.prepare(`
    SELECT h.*,
      p.codigo AS proyecto_codigo,
      (SELECT COUNT(*) FROM hoja_ruta_etapa WHERE hoja_ruta_id=h.id) AS etapas_total,
      (SELECT COUNT(*) FROM hoja_ruta_etapa WHERE hoja_ruta_id=h.id AND estado='Completada') AS etapas_comp,
      (SELECT COUNT(*) FROM no_conformidad WHERE hoja_ruta_id=h.id AND estado!='Cerrada') AS nc_abiertas
    FROM hoja_ruta h
    LEFT JOIN proyectos p ON p.id=h.proyecto_id
    ${where}
    ORDER BY h.created_at DESC
  `).all(...params)
  res.json(rows)
})

router.get('/hojas-ruta/:id', (req, res) => {
  const hr = db.prepare(`
    SELECT h.*, p.codigo AS proyecto_codigo
    FROM hoja_ruta h LEFT JOIN proyectos p ON p.id=h.proyecto_id
    WHERE h.id=?
  `).get(req.params.id)
  if (!hr) return res.status(404).json({ error: 'No encontrada' })
  hr.etapas = db.prepare('SELECT * FROM hoja_ruta_etapa WHERE hoja_ruta_id=? ORDER BY orden').all(hr.id)
  hr.nc = db.prepare('SELECT * FROM no_conformidad WHERE hoja_ruta_id=? ORDER BY created_at DESC').all(hr.id)
  hr.inspecciones = db.prepare('SELECT * FROM calidad_inspeccion WHERE hoja_ruta_id=? ORDER BY created_at DESC').all(hr.id)
  res.json(hr)
})

router.post('/hojas-ruta', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { proyecto_id, descripcion, cliente_nombre, responsable, fecha_inicio, fecha_fin_est, observaciones } = req.body
  if (!descripcion?.trim()) return res.status(400).json({ error: 'Descripción requerida' })
  // Número + INSERT en una sola transacción: sin esto, dos altas casi
  // simultáneas podrían leer el mismo máximo y terminar con el mismo número.
  const { hrId, numero } = db.transaction(() => {
    const numero = nextNumHR()
    const r = db.prepare(`
      INSERT INTO hoja_ruta (numero, proyecto_id, descripcion, cliente_nombre, responsable, fecha_inicio, fecha_fin_est, observaciones)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(numero, proyecto_id || null, descripcion.trim(), cliente_nombre || '', responsable || '', fecha_inicio || '', fecha_fin_est || '', observaciones || '')
    const hrId = r.lastInsertRowid
    const insEtapa = db.prepare('INSERT INTO hoja_ruta_etapa (hoja_ruta_id, nombre, orden) VALUES (?,?,?)')
    ETAPAS_DEFAULT.forEach((nombre, i) => insEtapa.run(hrId, nombre, i + 1))
    return { hrId, numero }
  })()
  res.status(201).json({ id: hrId, numero })
})

router.put('/hojas-ruta/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { descripcion, cliente_nombre, responsable, fecha_inicio, fecha_fin_est, fecha_despacho, estado, observaciones, proyecto_id } = req.body
  db.prepare(`
    UPDATE hoja_ruta SET
      descripcion=?, cliente_nombre=?, responsable=?, fecha_inicio=?,
      fecha_fin_est=?, fecha_despacho=?, estado=?, observaciones=?, proyecto_id=?,
      updated_at=datetime('now','localtime')
    WHERE id=?
  `).run(
    descripcion || '', cliente_nombre || '', responsable || '', fecha_inicio || '',
    fecha_fin_est || '', fecha_despacho || '', estado || 'En proceso', observaciones || '',
    proyecto_id || null, req.params.id
  )
  res.json({ ok: true })
})

router.delete('/hojas-ruta/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  db.prepare('DELETE FROM hoja_ruta WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

// ── Etapas ─────────────────────────────────────────────────────────────────────
router.put('/hojas-ruta/:id/etapas/:etapaId', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { estado, responsable, fecha_prog, fecha_real, observaciones, criterios, medicion } = req.body
  db.prepare(`
    UPDATE hoja_ruta_etapa SET estado=?, responsable=?, fecha_prog=?, fecha_real=?,
      observaciones=?, criterios=?, medicion=?
    WHERE id=? AND hoja_ruta_id=?
  `).run(
    estado || 'Pendiente', responsable || '', fecha_prog || '', fecha_real || '',
    observaciones || '', criterios || '', medicion || '',
    req.params.etapaId, req.params.id
  )
  res.json({ ok: true })
})

// ── No Conformidades ──────────────────────────────────────────────────────────
router.get('/no-conformidades', (req, res) => {
  const { estado, tipo, buscar } = req.query
  const conds = [], params = []
  if (estado) { conds.push('n.estado=?'); params.push(estado) }
  if (tipo)   { conds.push('n.tipo=?');   params.push(tipo)   }
  if (buscar) {
    const bc = buscarCondicion(buscar, ['n.numero', 'n.descripcion', 'n.detectado_por'])
    conds.push(bc.cond); params.push(...bc.params)
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const rows = db.prepare(`
    SELECT n.*, h.numero AS hr_numero, h.descripcion AS hr_descripcion, p.codigo AS proyecto_codigo
    FROM no_conformidad n
    LEFT JOIN hoja_ruta h  ON h.id=n.hoja_ruta_id
    LEFT JOIN proyectos p  ON p.id=n.proyecto_id
    ${where}
    ORDER BY n.created_at DESC
  `).all(...params)
  res.json(rows)
})

router.post('/no-conformidades', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { hoja_ruta_id, proyecto_id, fecha, tipo, descripcion, causa, detectado_por, accion_correctiva, responsable, fecha_limite } = req.body
  if (!descripcion?.trim()) return res.status(400).json({ error: 'Descripción requerida' })
  const { id, numero } = db.transaction(() => {
    const numero = nextNumNC()
    const r = db.prepare(`
      INSERT INTO no_conformidad (numero, hoja_ruta_id, proyecto_id, fecha, tipo, descripcion, causa, detectado_por, accion_correctiva, responsable, fecha_limite)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(numero, hoja_ruta_id || null, proyecto_id || null, fecha || '', tipo || 'Producto', descripcion.trim(), causa || '', detectado_por || '', accion_correctiva || '', responsable || '', fecha_limite || '')
    return { id: r.lastInsertRowid, numero }
  })()
  res.status(201).json({ id, numero })
})

router.put('/no-conformidades/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { fecha, tipo, descripcion, causa, detectado_por, accion_correctiva, responsable, fecha_limite, fecha_cierre, estado, hoja_ruta_id, proyecto_id } = req.body
  db.prepare(`
    UPDATE no_conformidad SET
      fecha=?, tipo=?, descripcion=?, causa=?, detectado_por=?,
      accion_correctiva=?, responsable=?, fecha_limite=?, fecha_cierre=?, estado=?,
      hoja_ruta_id=?, proyecto_id=?
    WHERE id=?
  `).run(
    fecha || '', tipo || 'Producto', descripcion || '', causa || '', detectado_por || '',
    accion_correctiva || '', responsable || '', fecha_limite || '', fecha_cierre || '', estado || 'Abierta',
    hoja_ruta_id || null, proyecto_id || null,
    req.params.id
  )
  res.json({ ok: true })
})

router.delete('/no-conformidades/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  db.prepare('DELETE FROM no_conformidad WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

// ── Inspecciones ──────────────────────────────────────────────────────────────
router.get('/inspecciones', (req, res) => {
  const { hoja_ruta_id, tipo } = req.query
  const conds = [], params = []
  if (hoja_ruta_id) { conds.push('i.hoja_ruta_id=?'); params.push(hoja_ruta_id) }
  if (tipo)         { conds.push('i.tipo=?');          params.push(tipo)         }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : ''
  const rows = db.prepare(`
    SELECT i.*, h.numero AS hr_numero, h.descripcion AS hr_descripcion
    FROM calidad_inspeccion i
    LEFT JOIN hoja_ruta h ON h.id=i.hoja_ruta_id
    ${where}
    ORDER BY i.created_at DESC
    LIMIT 200
  `).all(...params)
  res.json(rows)
})

router.post('/inspecciones', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { hoja_ruta_id, tipo, fecha, inspector, resultado, observaciones } = req.body
  if (!tipo) return res.status(400).json({ error: 'Tipo requerido' })
  const r = db.prepare(`
    INSERT INTO calidad_inspeccion (hoja_ruta_id, tipo, fecha, inspector, resultado, observaciones)
    VALUES (?,?,?,?,?,?)
  `).run(hoja_ruta_id || null, tipo, fecha || '', inspector || '', resultado || 'Aprobado', observaciones || '')
  res.status(201).json({ id: r.lastInsertRowid })
})

router.delete('/inspecciones/:id', (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  db.prepare('DELETE FROM calidad_inspeccion WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

module.exports = router
