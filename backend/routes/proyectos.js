'use strict'
const express = require('express')
const { body, validationResult } = require('express-validator')
const { db }  = require('../db/database')
const { verificarToken } = require('../middleware/auth')
const { buscarCondicion } = require('../helpers/buscar')

const router = express.Router()

const puedeL = req => !!(req.permisos?.proyectos?.leer || req.permisos?.proyectos?.escribir)
const puedeE = req => !!req.permisos?.proyectos?.escribir

// ── Listado ───────────────────────────────────────────────────────────────────
router.get('/', verificarToken, (req, res) => {
  const { estado, cliente_id, buscar } = req.query
  const conds = ["p.codigo NOT LIKE 'HIST-%'"], params = []
  if (estado)     { conds.push('p.estado=?');               params.push(estado) }
  if (cliente_id) { conds.push('p.cliente_id=?');           params.push(cliente_id) }
  if (buscar)     { const b = buscarCondicion(buscar, ['p.codigo','p.nombre','p.cliente_nombre']); conds.push(b.cond); params.push(...b.params) }
  const where = 'WHERE ' + conds.join(' AND ')
  const rows = db.prepare(`
    SELECT p.*,
      COALESCE((SELECT SUM(total) FROM proyecto_costos WHERE proyecto_id=p.id), 0) AS costo_total,
      COALESCE((SELECT COUNT(*) FROM proyecto_documentos WHERE proyecto_id=p.id AND lower(aplica)='aplica'), 0) AS docs_aplican,
      COALESCE((SELECT COUNT(*) FROM proyecto_documentos WHERE proyecto_id=p.id AND lower(aplica)='aplica' AND lower(estado)='realizado'), 0) AS docs_realizados
    FROM proyectos p
    ${where}
    ORDER BY p.created_at DESC
  `).all(...params)
  res.json(rows)
})

// ── Responsables distintos (admin) ───────────────────────────────────────────
router.get('/responsables-distintos', verificarToken, (req, res) => {
  if (req.usuario?.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' })
  const rows = db.prepare(`
    SELECT responsable, COUNT(*) as total
    FROM proyecto_documentos
    WHERE responsable IS NOT NULL AND responsable != ''
    GROUP BY responsable
    ORDER BY responsable
  `).all()
  res.json(rows)
})

// ── Entregas globales + importación Form 56 ──────────────────────────────────
router.get('/entregas-doc-global', verificarToken, (req, res) => {
  if (!puedeL(req)) return res.status(403).json({ error: 'Sin permisos' })
  const rows = db.prepare(`
    SELECT e.*, p.codigo AS proyecto_codigo
    FROM proyecto_entregas_doc e
    LEFT JOIN proyectos p ON p.id = e.proyecto_id
    ORDER BY e.fecha DESC, e.id DESC
  `).all()
  res.json(rows)
})

const leerForm56 = () => {
  const path = require('path')
  const fs   = require('fs')
  const file = path.join(__dirname, '../data/form56_datos.json')
  if (!fs.existsSync(file)) return null
  const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '')
  return JSON.parse(raw)
}

router.get('/form56-preview', verificarToken, (req, res) => {
  if (!puedeL(req)) return res.status(403).json({ error: 'Sin permisos' })
  const datos = leerForm56()
  if (!datos) return res.status(404).json({ error: 'No hay datos para importar. Subir form56_datos.json al servidor.' })
  const proyNames = [...new Set(datos.map(d => d.proyecto))].sort()
  let yaImportados = 0
  try { yaImportados = db.prepare(`SELECT COUNT(*) as c FROM proyecto_entregas_doc WHERE created_by = -56`).get().c } catch(e) {}
  res.json({ proyNames, yaImportados, total: datos.length })
})

router.post('/form56-importar', verificarToken, (req, res) => {
  try {
    if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
    let datos
    try { datos = leerForm56() } catch(e) { return res.status(500).json({ error: 'JSON inválido: ' + e.message }) }
    if (!datos) return res.status(404).json({ error: 'No hay datos para importar' })
    const { mapping } = req.body
    if (!mapping || typeof mapping !== 'object') return res.status(400).json({ error: 'mapping requerido' })
    db.exec(`
      CREATE TABLE IF NOT EXISTS proyecto_entregas_doc (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proyecto_id INTEGER REFERENCES proyectos(id) ON DELETE SET NULL,
        proyecto_nombre TEXT DEFAULT '',
        fecha TEXT NOT NULL DEFAULT '',
        nro_oc TEXT DEFAULT '', formato TEXT DEFAULT '',
        documento TEXT DEFAULT '', plano_nivel TEXT DEFAULT '',
        tipo TEXT DEFAULT 'S', individuo TEXT DEFAULT '',
        comentarios TEXT DEFAULT '', created_by INTEGER,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );
      CREATE INDEX IF NOT EXISTS idx_proy_ent_doc ON proyecto_entregas_doc(proyecto_id);
    `)
    try { db.exec(`ALTER TABLE proyecto_entregas_doc ADD COLUMN proyecto_nombre TEXT DEFAULT ''`) } catch(e) {}
    const ins = db.prepare(`
      INSERT INTO proyecto_entregas_doc (proyecto_id,proyecto_nombre,fecha,nro_oc,formato,documento,plano_nivel,tipo,individuo,comentarios,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `)
    let insertados = 0
    db.transaction(() => {
      db.prepare(`DELETE FROM proyecto_entregas_doc WHERE created_by = -56`).run()
      for (const d of datos) {
        const pId = mapping[d.proyecto] ? parseInt(mapping[d.proyecto]) : null
        ins.run(pId, d.proyecto, d.fecha, d.nro_oc||'', d.formato||'', d.documento||'', d.nivel||'', d.tipo||'S', d.individuo||'', d.comentarios||'', -56)
        insertados++
      }
    })()
    res.json({ ok: true, insertados })
  } catch(e) {
    res.status(500).json({ error: e.message })
  }
})

// ── Detalle ───────────────────────────────────────────────────────────────────
router.get('/:id', verificarToken, (req, res) => {
  if (!puedeL(req)) return res.status(403).json({ error: 'Sin permisos' })
  const p = db.prepare('SELECT * FROM proyectos WHERE id=?').get(req.params.id)
  if (!p) return res.status(404).json({ error: 'No encontrado' })
  const costos = db.prepare('SELECT * FROM proyecto_costos WHERE proyecto_id=? ORDER BY fecha DESC, id DESC').all(p.id)
  const ots    = db.prepare('SELECT id,numero,descripcion,estado,responsable FROM ordenes_trabajo WHERE proyecto_id=? ORDER BY id DESC').all(p.id)
  const total  = costos.reduce((s, c) => s + c.total, 0)
  res.json({ ...p, costos, ordenes_trabajo: ots, costo_total: total })
})

// ── Documentos Form 30 ────────────────────────────────────────────────────────
router.get('/:id/documentos', verificarToken, (req, res) => {
  if (!puedeL(req)) return res.status(403).json({ error: 'Sin permisos' })
  const docs = db.prepare('SELECT * FROM proyecto_documentos WHERE proyecto_id=? ORDER BY item_num, id').all(req.params.id)
  res.json(docs)
})

router.put('/:id/documentos/:doc_id', verificarToken, (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const doc = db.prepare('SELECT * FROM proyecto_documentos WHERE id=? AND proyecto_id=?').get(req.params.doc_id, req.params.id)
  if (!doc) return res.status(404).json({ error: 'No encontrado' })
  const { aplica, estado, fecha_solicitado, fecha_entregado, responsable } = req.body
  db.prepare('UPDATE proyecto_documentos SET aplica=?,estado=?,fecha_solicitado=?,fecha_entregado=?,responsable=? WHERE id=?')
    .run(aplica         ?? doc.aplica,
         estado         ?? doc.estado,
         fecha_solicitado ?? doc.fecha_solicitado,
         fecha_entregado  ?? doc.fecha_entregado,
         responsable      ?? doc.responsable,
         req.params.doc_id)
  res.json(db.prepare('SELECT * FROM proyecto_documentos WHERE id=?').get(req.params.doc_id))
})

// ── Crear ─────────────────────────────────────────────────────────────────────
router.post('/', verificarToken,
  body('codigo').trim().notEmpty(),
  body('nombre').trim().notEmpty(),
  (req, res) => {
    if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
    const errs = validationResult(req)
    if (!errs.isEmpty()) return res.status(400).json({ errores: errs.array() })
    const { codigo, nombre, cliente_id, cliente_nombre, descripcion, fecha_inicio, fecha_fin_est, estado, presupuesto_venta, responsable, presupuesto_id } = req.body
    try {
      const r = db.prepare('INSERT INTO proyectos (codigo,nombre,cliente_id,cliente_nombre,descripcion,fecha_inicio,fecha_fin_est,estado,presupuesto_venta,responsable,presupuesto_id,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(codigo, nombre, cliente_id || null, cliente_nombre || '', descripcion || '',
             fecha_inicio || '', fecha_fin_est || '', estado || 'Activo', presupuesto_venta || 0,
             responsable || '', presupuesto_id || null, req.usuario.id)
      res.status(201).json(db.prepare('SELECT * FROM proyectos WHERE id=?').get(r.lastInsertRowid))
    } catch(e) {
      if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'El código ya existe' })
      throw e
    }
  }
)

// ── Editar ────────────────────────────────────────────────────────────────────
router.put('/:id', verificarToken, (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const p = db.prepare('SELECT * FROM proyectos WHERE id=?').get(req.params.id)
  if (!p) return res.status(404).json({ error: 'No encontrado' })
  const { codigo, nombre, cliente_id, cliente_nombre, descripcion, fecha_inicio, fecha_fin_est, fecha_cierre, estado, presupuesto_venta, responsable } = req.body
  db.prepare(`UPDATE proyectos SET codigo=?,nombre=?,cliente_id=?,cliente_nombre=?,descripcion=?,fecha_inicio=?,fecha_fin_est=?,fecha_cierre=?,estado=?,presupuesto_venta=?,responsable=?,updated_at=datetime('now','localtime') WHERE id=?`)
    .run(codigo ?? p.codigo, nombre ?? p.nombre, cliente_id ?? p.cliente_id, cliente_nombre ?? p.cliente_nombre,
         descripcion ?? p.descripcion, fecha_inicio ?? p.fecha_inicio, fecha_fin_est ?? p.fecha_fin_est,
         fecha_cierre ?? p.fecha_cierre, estado ?? p.estado, presupuesto_venta ?? p.presupuesto_venta,
         responsable ?? p.responsable, req.params.id)
  res.json(db.prepare('SELECT * FROM proyectos WHERE id=?').get(req.params.id))
})

// ── Costos ────────────────────────────────────────────────────────────────────
router.post('/:id/costos', verificarToken, (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { tipo, descripcion, cantidad, precio_unit, fecha } = req.body
  const cant  = parseFloat(cantidad)    || 1
  const precio = parseFloat(precio_unit) || 0
  const r = db.prepare('INSERT INTO proyecto_costos (proyecto_id,tipo,descripcion,cantidad,precio_unit,total,fecha,origen,created_by) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(req.params.id, tipo || 'Material', descripcion || '', cant, precio, cant * precio,
         fecha || new Date().toISOString().slice(0, 10), 'manual', req.usuario.id)
  res.status(201).json(db.prepare('SELECT * FROM proyecto_costos WHERE id=?').get(r.lastInsertRowid))
})

router.delete('/:id/costos/:costo_id', verificarToken, (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  db.prepare('DELETE FROM proyecto_costos WHERE id=? AND proyecto_id=?').run(req.params.costo_id, req.params.id)
  res.json({ ok: true })
})

// ── Normalizar responsables (admin only) ─────────────────────────────────────
router.post('/normalizar-responsables', verificarToken, (req, res) => {
  if (req.usuario?.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' })
  const { mapping } = req.body
  if (!mapping || typeof mapping !== 'object') return res.status(400).json({ error: 'mapping requerido' })
  const upd = db.prepare('UPDATE proyecto_documentos SET responsable=? WHERE responsable=?')
  let actualizados = 0
  db.transaction(() => {
    for (const [desde, hasta] of Object.entries(mapping)) {
      actualizados += upd.run(hasta, desde).changes
    }
  })()
  res.json({ ok: true, actualizados })
})

// ── Importación bulk desde Excel (admin only) ─────────────────────────────────
router.post('/importar', verificarToken, (req, res) => {
  if (req.usuario?.rol !== 'admin') return res.status(403).json({ error: 'Solo administradores' })
  const { proyectos = [] } = req.body
  if (!Array.isArray(proyectos) || proyectos.length === 0)
    return res.status(400).json({ error: 'Se esperaba un array "proyectos"' })

  const insP = db.prepare(`
    INSERT OR IGNORE INTO proyectos
      (codigo, nombre, descripcion, cliente_nombre, fecha_inicio, fecha_fin_est, estado, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const insD = db.prepare(`
    INSERT INTO proyecto_documentos
      (proyecto_id, item_num, item_nombre, categoria, item, subitem, responsable, aplica, estado, fecha_solicitado, fecha_entregado)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  let creados = 0, omitidos = 0, docs_total = 0

  db.transaction(() => {
    for (const p of proyectos) {
      const r = insP.run(
        p.codigo, p.nombre, p.descripcion || '', p.cliente || '',
        p.fecha_inicio || '', p.fecha_fin_est || '', p.estado || 'Activo',
        req.usuario.id
      )
      if (!r.changes) { omitidos++; continue }
      creados++
      const pid = r.lastInsertRowid
      for (const d of (p.docs || [])) {
        insD.run(pid, d.item_num, d.item_nombre || '', d.categoria, d.item, d.subitem,
                 d.responsable, d.aplica, d.estado, d.fecha_solicitado, d.fecha_entregado)
        docs_total++
      }
    }
  })()

  res.json({ ok: true, creados, omitidos, docs_total })
})

router.get('/:id/entregas-doc', verificarToken, (req, res) => {
  if (!puedeL(req)) return res.status(403).json({ error: 'Sin permisos' })
  const rows = db.prepare('SELECT * FROM proyecto_entregas_doc WHERE proyecto_id=? ORDER BY fecha DESC, id DESC').all(req.params.id)
  res.json(rows)
})

router.post('/:id/entregas-doc', verificarToken, (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { fecha, nro_oc, formato, documento, plano_nivel, codigo_plano, tipo, individuo, comentarios } = req.body
  if (!fecha) return res.status(400).json({ error: 'La fecha es requerida' })
  const p = db.prepare('SELECT nombre FROM proyectos WHERE id=?').get(req.params.id)
  const r = db.prepare(`
    INSERT INTO proyecto_entregas_doc (proyecto_id,proyecto_nombre,fecha,nro_oc,formato,documento,plano_nivel,codigo_plano,tipo,individuo,comentarios,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(req.params.id, p?.nombre||'', fecha, nro_oc||'', formato||'', documento||'', plano_nivel||'', codigo_plano||'', tipo||'S', individuo||'', comentarios||'', req.usuario.id)
  res.status(201).json(db.prepare('SELECT * FROM proyecto_entregas_doc WHERE id=?').get(r.lastInsertRowid))
})

router.put('/:id/entregas-doc/:ent_id', verificarToken, (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const ent = db.prepare('SELECT * FROM proyecto_entregas_doc WHERE id=? AND proyecto_id=?').get(req.params.ent_id, req.params.id)
  if (!ent) return res.status(404).json({ error: 'No encontrado' })
  const { fecha, nro_oc, formato, documento, plano_nivel, codigo_plano, tipo, individuo, comentarios } = req.body
  db.prepare(`UPDATE proyecto_entregas_doc SET fecha=?,nro_oc=?,formato=?,documento=?,plano_nivel=?,codigo_plano=?,tipo=?,individuo=?,comentarios=? WHERE id=?`)
    .run(fecha??ent.fecha, nro_oc??ent.nro_oc, formato??ent.formato, documento??ent.documento,
         plano_nivel??ent.plano_nivel, codigo_plano??ent.codigo_plano, tipo??ent.tipo, individuo??ent.individuo, comentarios??ent.comentarios,
         req.params.ent_id)
  res.json(db.prepare('SELECT * FROM proyecto_entregas_doc WHERE id=?').get(req.params.ent_id))
})

router.delete('/:id/entregas-doc/:ent_id', verificarToken, (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  db.prepare('DELETE FROM proyecto_entregas_doc WHERE id=? AND proyecto_id=?').run(req.params.ent_id, req.params.id)
  res.json({ ok: true })
})

// ── Materiales previstos ──────────────────────────────────────────────────────
const SEL_MAT = `
  SELECT m.*, p.stock_actual, p.codigo AS prod_codigo
  FROM proyecto_materiales m
  LEFT JOIN productos p ON p.id = m.producto_id
  WHERE m.proyecto_id = ? ORDER BY m.id
`
const SEL_MAT_ONE = `
  SELECT m.*, p.stock_actual, p.codigo AS prod_codigo
  FROM proyecto_materiales m
  LEFT JOIN productos p ON p.id = m.producto_id
  WHERE m.id = ?
`

router.get('/:id/materiales', verificarToken, (req, res) => {
  if (!puedeL(req)) return res.status(403).json({ error: 'Sin permisos' })
  res.json(db.prepare(SEL_MAT).all(req.params.id))
})

router.post('/:id/materiales', verificarToken, (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { producto_id, codigo, descripcion, unidad, cantidad, observaciones } = req.body
  if (!descripcion?.trim()) return res.status(400).json({ error: 'La descripción es requerida' })
  const r = db.prepare(`
    INSERT INTO proyecto_materiales (proyecto_id,producto_id,codigo,descripcion,unidad,cantidad,observaciones,created_by)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(req.params.id, producto_id||null, codigo||'', descripcion.trim(), unidad||'UND.', parseFloat(cantidad)||1, observaciones||'', req.usuario.id)
  res.status(201).json(db.prepare(SEL_MAT_ONE).get(r.lastInsertRowid))
})

router.put('/:id/materiales/:mat_id', verificarToken, (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const mat = db.prepare('SELECT * FROM proyecto_materiales WHERE id=? AND proyecto_id=?').get(req.params.mat_id, req.params.id)
  if (!mat) return res.status(404).json({ error: 'No encontrado' })
  const { producto_id, codigo, descripcion, unidad, cantidad, observaciones } = req.body
  db.prepare(`UPDATE proyecto_materiales SET producto_id=?,codigo=?,descripcion=?,unidad=?,cantidad=?,observaciones=? WHERE id=?`)
    .run(producto_id??mat.producto_id, codigo??mat.codigo, descripcion??mat.descripcion,
         unidad??mat.unidad, parseFloat(cantidad)||mat.cantidad, observaciones??mat.observaciones, req.params.mat_id)
  res.json(db.prepare(SEL_MAT_ONE).get(req.params.mat_id))
})

router.delete('/:id/materiales/:mat_id', verificarToken, (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  db.prepare('DELETE FROM proyecto_materiales WHERE id=? AND proyecto_id=?').run(req.params.mat_id, req.params.id)
  res.json({ ok: true })
})

// ── Plantilla Form 30 ─────────────────────────────────────────────────────────
const PLANTILLA_FORM30 = [
  { categoria:'Lanzamiento de proyecto',     item:'OC cliente',                                       subitem:'',                                          responsable:'Jose L.'     },
  { categoria:'Lanzamiento de proyecto',     item:'Cronograma de proyecto',                           subitem:'',                                          responsable:'Jose L.'     },
  { categoria:'Ingeniería',                  item:'Memoria / Propuesta Técnica',                      subitem:'',                                          responsable:'Gustavo V.'  },
  { categoria:'Ingeniería',                  item:'Diseño (Ingeniería de detalle)',                    subitem:'',                                          responsable:'Gustavo V.'  },
  { categoria:'Ingeniería',                  item:'Planos',                                           subitem:'Plano de estructura',                        responsable:'Jose L.'     },
  { categoria:'Ingeniería',                  item:'Planos',                                           subitem:'Plano de soporte',                           responsable:'Jose L.'     },
  { categoria:'Ingeniería',                  item:'Planos',                                           subitem:'Plano de tuberias',                          responsable:'Jose L.'     },
  { categoria:'Ingeniería',                  item:'Planos',                                           subitem:'Plano del cliente',                          responsable:'Jose L.'     },
  { categoria:'Ingeniería',                  item:'Planos',                                           subitem:'P&D',                                        responsable:'Jose L.'     },
  { categoria:'Ingeniería',                  item:'Planos',                                           subitem:'Plano Eléctrico',                            responsable:'Silvio L.'   },
  { categoria:'Ingeniería',                  item:'Documentación',                                    subitem:'Software del PLC',                           responsable:'Silvio L.'   },
  { categoria:'Ingeniería',                  item:'Documentación',                                    subitem:'Certificados de la materia prima (Chapas)',  responsable:'Andreina V.' },
  { categoria:'Ingeniería',                  item:'Documentación',                                    subitem:'Certificados de la materia prima (Pintura)', responsable:'Andreina V.' },
  { categoria:'Ingeniería',                  item:'Documentación',                                    subitem:'Certificados de la materia prima (Caños)',   responsable:'Andreina V.' },
  { categoria:'Ingeniería',                  item:'Documentación',                                    subitem:'Certificados de la materia prima (Placas)',  responsable:'Andreina V.' },
  { categoria:'Ingeniería',                  item:'Documentación',                                    subitem:'Certificado de los soldadores',              responsable:'Jose L.'     },
  { categoria:'Ingeniería',                  item:'Documentación',                                    subitem:'Manuales del equipamiento',                  responsable:'Daniel R.'   },
  { categoria:'Ingeniería',                  item:'Manuales (Databook)',                              subitem:'',                                          responsable:'Jose L.'     },
  { categoria:'Ingeniería',                  item:'Manuales',                                         subitem:'',                                          responsable:'Jose L.'     },
  { categoria:'Gestión de calidad',          item:'Hoja de ruta',                                     subitem:'Form 8',                                    responsable:'Fabian G.'   },
  { categoria:'Gestión de calidad',          item:'Control de granallado de chapas y perfiles',       subitem:'Form 21',                                   responsable:'Fabian G.'   },
  { categoria:'Gestión de calidad',          item:'Control de espesor de pintura Base',               subitem:'Form 22',                                   responsable:'Fabian G.'   },
  { categoria:'Gestión de calidad',          item:'Verificación de soldadura',                        subitem:'Form 34',                                   responsable:'Fabian G.'   },
  { categoria:'Gestión de calidad',          item:'Listado de chapas utilizadas',                     subitem:'Form 36',                                   responsable:'Fabian G.'   },
  { categoria:'Gestión de calidad',          item:'Informe de No Conformidad (INC)',                  subitem:'Form 16',                                   responsable:'Fabian G.'   },
  { categoria:'Gestión de calidad',          item:'Acta de Inspección',                               subitem:'Form 35',                                   responsable:'Antonio'     },
  { categoria:'Gestión de calidad',          item:'Medición de espesor de pintura',                   subitem:'Form 26',                                   responsable:'Fabian G.'   },
  { categoria:'Gestión de calidad',          item:'Pruebas',                                          subitem:'Eléctricas Form 27',                         responsable:'Silvio L.'   },
  { categoria:'Gestión de calidad',          item:'Pruebas',                                          subitem:'Mecánicas (ver con Form 35)',                responsable:'Daniel R.'   },
  { categoria:'Gestión de calidad',          item:'Chapa identificadora de módulo',                   subitem:'Form 37',                                   responsable:'Jose L.'     },
  { categoria:'Gestión de calidad',          item:'Packing list',                                     subitem:'',                                          responsable:'Fabian G.'   },
  { categoria:'Gestión de No Conformidades', item:'No conformidades de gestión',                      subitem:'Form 5',                                    responsable:'Marcelo L.'  },
  { categoria:'Gestión de No Conformidades', item:'Informe de No Conformidad (INC)',                  subitem:'Form 16',                                   responsable:'Fabian G.'   },
  { categoria:'Comunicaciones',              item:'Comunicaciones',                                   subitem:'',                                          responsable:'Jose L.'     },
]

router.post('/:id/aplicar-plantilla-form30', verificarToken, (req, res) => {
  if (!puedeE(req)) return res.status(403).json({ error: 'Sin permisos' })
  const p = db.prepare('SELECT id FROM proyectos WHERE id=?').get(req.params.id)
  if (!p) return res.status(404).json({ error: 'No encontrado' })
  const ins = db.prepare(`
    INSERT INTO proyecto_documentos (proyecto_id, item_num, item_nombre, categoria, item, subitem, responsable, aplica, estado)
    VALUES (?, 1, ?, ?, ?, ?, ?, 'Aplica', 'Pendiente')
  `)
  db.transaction(() => {
    db.prepare('DELETE FROM proyecto_documentos WHERE proyecto_id=?').run(req.params.id)
    for (const t of PLANTILLA_FORM30) {
      ins.run(req.params.id, t.subitem || t.item, t.categoria, t.item, t.subitem, t.responsable)
    }
  })()
  res.json({ ok: true, insertados: PLANTILLA_FORM30.length })
})

module.exports = router
