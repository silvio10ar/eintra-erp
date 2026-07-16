const express = require('express')
const router  = express.Router()
const { db }  = require('../db/database')
const { verificarToken } = require('../middleware/auth')
const { buscarCondicion } = require('../helpers/buscar')

const toNum = v => {
  if (v === null || v === undefined || v === '') return 0
  const n = parseFloat(String(v).replace(/[^0-9.-]/g, ''))
  return isNaN(n) ? 0 : n
}

// ── Stats ─────────────────────────────────────────────────────────────────
router.get('/stats', verificarToken, (req, res) => {
  const total    = db.prepare('SELECT COUNT(*) c FROM crm_cotizaciones').get().c
  const activas  = db.prepare("SELECT COUNT(*) c, SUM(presupuestado) p FROM crm_cotizaciones WHERE estado='Activo'").get()
  const ganadas  = db.prepare("SELECT COUNT(*) c, SUM(ganado) m FROM crm_cotizaciones WHERE estado='Ganado'").get()
  const perdidas = db.prepare("SELECT COUNT(*) c, SUM(perdido) m FROM crm_cotizaciones WHERE estado='Perdido'").get()

  const porAnio = db.prepare(`
    SELECT SUBSTR(fecha,1,4) anio, COUNT(*) cotizaciones,
      SUM(presupuestado) presupuestado, SUM(ganado) ganado, SUM(perdido) perdido,
      COUNT(CASE WHEN estado='Ganado' THEN 1 END) ganadas_count
    FROM crm_cotizaciones
    WHERE fecha != ''
    GROUP BY anio ORDER BY anio DESC
  `).all()

  res.json({
    total,
    activas:  { count: activas.c,  presupuestado: activas.p  || 0 },
    ganadas:  { count: ganadas.c,  monto: ganadas.m  || 0 },
    perdidas: { count: perdidas.c, monto: perdidas.m || 0 },
    conversion: total > 0 ? Math.round(ganadas.c / total * 100) : 0,
    porAnio,
  })
})

// ── Cotizaciones ──────────────────────────────────────────────────────────
router.get('/cotizaciones', verificarToken, (req, res) => {
  const { page = 1, limit = 50, estado = '', anio = '', buscar = '', moneda = '' } = req.query
  const where = ['1=1'], p = []
  if (estado) { where.push('c.estado=?');              p.push(estado) }
  if (anio)   { where.push("SUBSTR(c.fecha,1,4)=?");   p.push(anio) }
  if (moneda) { where.push('c.moneda=?');              p.push(moneda) }
  if (buscar) {
    const bc = buscarCondicion(buscar, ['e.nombre', 'c.equipo', 'c.indirecto'])
    where.push(bc.cond); p.push(...bc.params)
  }
  const w = where.join(' AND ')
  const offset = (parseInt(page) - 1) * parseInt(limit)

  const total = db.prepare(`
    SELECT COUNT(*) c FROM crm_cotizaciones c
    LEFT JOIN crm_empresas e ON e.id=c.empresa_id WHERE ${w}
  `).get(...p).c

  const datos = db.prepare(`
    SELECT c.*, e.nombre empresa_nombre,
      ct.nombre contacto_nombre, ct.posicion contacto_posicion, ct.mail contacto_mail
    FROM crm_cotizaciones c
    LEFT JOIN crm_empresas e ON e.id=c.empresa_id
    LEFT JOIN crm_contactos ct ON ct.id=c.contacto_id
    WHERE ${w} ORDER BY c.fecha DESC, c.id DESC
    LIMIT ? OFFSET ?
  `).all(...p, parseInt(limit), offset)

  res.json({ total, datos })
})

router.post('/cotizaciones', verificarToken, (req, res) => {
  const { empresa_id, contacto_id, fecha='', equipo='', indirecto='', moneda='USD',
          presupuestado=0, ganado=0, perdido=0, estado='Activo',
          observaciones='', seguimiento='', actualizado='' } = req.body

  const r = db.prepare(`
    INSERT INTO crm_cotizaciones
      (empresa_id,contacto_id,fecha,equipo,indirecto,moneda,presupuestado,
       ganado,perdido,estado,observaciones,seguimiento,actualizado)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(empresa_id||null, contacto_id||null, fecha, equipo, indirecto, moneda,
         toNum(presupuestado), toNum(ganado), toNum(perdido),
         estado, observaciones, seguimiento, actualizado)

  res.status(201).json({ id: r.lastInsertRowid })
})

router.put('/cotizaciones/:id', verificarToken, (req, res) => {
  const { empresa_id, contacto_id, fecha='', equipo='', indirecto='', moneda='USD',
          presupuestado=0, ganado=0, perdido=0, estado='Activo',
          observaciones='', seguimiento='', actualizado='' } = req.body

  db.prepare(`
    UPDATE crm_cotizaciones SET
      empresa_id=?,contacto_id=?,fecha=?,equipo=?,indirecto=?,moneda=?,
      presupuestado=?,ganado=?,perdido=?,estado=?,
      observaciones=?,seguimiento=?,actualizado=?,
      updated_at=datetime('now','localtime')
    WHERE id=?
  `).run(empresa_id||null, contacto_id||null, fecha, equipo, indirecto, moneda,
         toNum(presupuestado), toNum(ganado), toNum(perdido), estado,
         observaciones, seguimiento, actualizado, req.params.id)

  res.json({ ok: true })
})

router.delete('/cotizaciones/:id', verificarToken, (req, res) => {
  db.prepare('DELETE FROM crm_cotizaciones WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

// ── Empresas ──────────────────────────────────────────────────────────────
router.get('/empresas', verificarToken, (req, res) => {
  const { buscar = '', page = 1, limit = 100 } = req.query
  const where = ['e.activo=1'], p = []
  if (buscar) { const bc = buscarCondicion(buscar, ['e.nombre']); where.push(bc.cond); p.push(...bc.params) }
  const w = where.join(' AND ')
  const offset = (parseInt(page) - 1) * parseInt(limit)

  const total = db.prepare(`SELECT COUNT(*) c FROM crm_empresas e WHERE ${w}`).get(...p).c
  const datos = db.prepare(`
    SELECT e.*,
      COUNT(DISTINCT ct.id) contactos_count,
      COUNT(DISTINCT c.id)  cotizaciones_count,
      SUM(c.presupuestado)  total_presupuestado,
      SUM(c.ganado)         total_ganado
    FROM crm_empresas e
    LEFT JOIN crm_contactos ct ON ct.empresa_id=e.id AND ct.activo=1
    LEFT JOIN crm_cotizaciones c ON c.empresa_id=e.id
    WHERE ${w}
    GROUP BY e.id ORDER BY e.nombre ASC
    LIMIT ? OFFSET ?
  `).all(...p, parseInt(limit), offset)

  res.json({ total, datos })
})

router.get('/empresas/:id', verificarToken, (req, res) => {
  const emp = db.prepare('SELECT * FROM crm_empresas WHERE id=?').get(req.params.id)
  if (!emp) return res.status(404).json({ error: 'No encontrada' })
  const contactos = db.prepare('SELECT * FROM crm_contactos WHERE empresa_id=? AND activo=1 ORDER BY nombre').all(req.params.id)
  const cotizaciones = db.prepare('SELECT * FROM crm_cotizaciones WHERE empresa_id=? ORDER BY fecha DESC').all(req.params.id)
  res.json({ ...emp, contactos, cotizaciones })
})

router.post('/empresas', verificarToken, (req, res) => {
  const { nombre } = req.body
  if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido' })
  const r = db.prepare('INSERT INTO crm_empresas (nombre) VALUES (?)').run(nombre.trim())
  res.status(201).json({ id: r.lastInsertRowid, nombre: nombre.trim() })
})

router.put('/empresas/:id', verificarToken, (req, res) => {
  const { nombre } = req.body
  if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido' })
  db.prepare("UPDATE crm_empresas SET nombre=?,updated_at=datetime('now','localtime') WHERE id=?")
    .run(nombre.trim(), req.params.id)
  res.json({ ok: true })
})

// ── Cliente desde empresa ─────────────────────────────────────────────────
router.get('/empresas/:id/cliente', verificarToken, (req, res) => {
  const emp = db.prepare('SELECT * FROM crm_empresas WHERE id=?').get(req.params.id)
  if (!emp) return res.status(404).json({ error: 'No encontrada' })
  const cliente = db.prepare('SELECT * FROM clientes WHERE LOWER(nombre)=LOWER(?)').get(emp.nombre)
  res.json({ existe: !!cliente, cliente: cliente || null, empresa: emp })
})

router.post('/empresas/:id/crear-cliente', verificarToken, (req, res) => {
  const emp = db.prepare('SELECT * FROM crm_empresas WHERE id=?').get(req.params.id)
  if (!emp) return res.status(404).json({ error: 'No encontrada' })

  const existe = db.prepare('SELECT id FROM clientes WHERE LOWER(nombre)=LOWER(?)').get(emp.nombre)
  if (existe) return res.json({ id: existe.id, ya_existia: true })

  const ct = db.prepare('SELECT * FROM crm_contactos WHERE empresa_id=? AND activo=1 ORDER BY id LIMIT 1').get(req.params.id)
  const { cuit='', direccion='', localidad='', cp='', condicion_pago='' } = req.body

  const r = db.prepare(`
    INSERT INTO clientes (nombre,contacto,telefono,email,cuit,direccion,localidad,cp,condicion_pago)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(emp.nombre, ct?.nombre||'', ct?.telefono||'', ct?.mail||'',
         cuit, direccion, localidad, cp, condicion_pago)

  res.status(201).json({ id: r.lastInsertRowid })
})

// ── Contactos ──────────────────────────────────────────────────────────────
router.get('/contactos', verificarToken, (req, res) => {
  const { empresa_id, buscar = '' } = req.query
  const where = ['activo=1'], p = []
  if (empresa_id) { where.push('empresa_id=?'); p.push(empresa_id) }
  if (buscar)     { const bc = buscarCondicion(buscar, ['nombre']); where.push(bc.cond); p.push(...bc.params) }
  const datos = db.prepare(`SELECT * FROM crm_contactos WHERE ${where.join(' AND ')} ORDER BY nombre`).all(...p)
  res.json({ datos })
})

router.post('/contactos', verificarToken, (req, res) => {
  const { empresa_id, nombre='', posicion='', telefono='', mail='' } = req.body
  const r = db.prepare('INSERT INTO crm_contactos (empresa_id,nombre,posicion,telefono,mail) VALUES (?,?,?,?,?)')
    .run(empresa_id||null, nombre, posicion, telefono, mail)
  res.status(201).json({ id: r.lastInsertRowid })
})

router.put('/contactos/:id', verificarToken, (req, res) => {
  const { nombre='', posicion='', telefono='', mail='' } = req.body
  db.prepare("UPDATE crm_contactos SET nombre=?,posicion=?,telefono=?,mail=?,updated_at=datetime('now','localtime') WHERE id=?")
    .run(nombre, posicion, telefono, mail, req.params.id)
  res.json({ ok: true })
})

router.delete('/contactos/:id', verificarToken, (req, res) => {
  db.prepare("UPDATE crm_contactos SET activo=0 WHERE id=?").run(req.params.id)
  res.json({ ok: true })
})

module.exports = router
