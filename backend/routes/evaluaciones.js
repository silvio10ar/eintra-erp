const router = require('express').Router();
const { db } = require('../db/database');
const { verificarToken } = require('../middleware/auth');

router.use(verificarToken);

// Criterios por tipo
const CRITERIOS = {
  seleccion: ['Calidad final', 'Precio', 'Experiencia laboral', 'Experiencia en mercado'],
  evaluacion: ['Cumplimiento de plazos', 'Capacidad de respuesta', 'Flexibilidad ante cambios', 'Calidad final']
};

const PUNTAJES = { 'MUY BUENO': 4, 'BUENO': 3, 'REGULAR': 2, 'MALO': 1 };

function calcularResultado(criterios) {
  const validos = criterios.filter(c => c.puntaje && c.puntaje !== 'NO APLICA' && PUNTAJES[c.puntaje] != null);
  if (validos.length === 0) return { puntaje: 0, resultado: '' };
  const suma = validos.reduce((acc, c) => acc + PUNTAJES[c.puntaje], 0);
  const avg = suma / validos.length;
  const resultado = avg < 1.8 ? 'INHABILITADO' : avg < 2.74 ? 'APROBADO CONDICIONAL' : 'APROBADO';
  return { puntaje: Math.round(avg * 100) / 100, resultado };
}

// GET /evaluaciones/proveedor/:id
router.get('/proveedor/:id', (req, res) => {
  try {
    const evals = db.prepare(`
      SELECT e.*, u.nombre as creado_por_nombre
      FROM evaluaciones_proveedor e
      LEFT JOIN usuarios u ON u.id = e.created_by
      WHERE e.proveedor_id = ?
      ORDER BY e.anio DESC, e.created_at DESC
    `).all(req.params.id);

    for (const ev of evals) {
      ev.criterios = db.prepare(`SELECT * FROM evaluacion_criterios WHERE evaluacion_id = ?`).all(ev.id);
    }
    res.json(evals);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /evaluaciones/:id
router.get('/:id', (req, res) => {
  try {
    const ev = db.prepare(`SELECT * FROM evaluaciones_proveedor WHERE id = ?`).get(req.params.id);
    if (!ev) return res.status(404).json({ error: 'No encontrado' });
    ev.criterios = db.prepare(`SELECT * FROM evaluacion_criterios WHERE evaluacion_id = ?`).all(ev.id);
    res.json(ev);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /evaluaciones
router.post('/', (req, res) => {
  try {
    const { proveedor_id, tipo, anio, fecha, observaciones, criterios } = req.body;
    if (!proveedor_id || !tipo || !anio) return res.status(400).json({ error: 'Faltan campos requeridos' });

    const { puntaje, resultado } = calcularResultado(criterios || []);

    const trx = db.transaction(() => {
      const ev = db.prepare(`
        INSERT INTO evaluaciones_proveedor (proveedor_id, tipo, anio, resultado, puntaje, fecha, observaciones, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(proveedor_id, tipo, anio, resultado, puntaje, fecha || '', observaciones || '', req.usuario?.id || null);

      const evId = ev.lastInsertRowid;
      const defaultCriterios = CRITERIOS[tipo] || [];
      const lista = criterios?.length ? criterios : defaultCriterios.map(c => ({ criterio: c, puntaje: '' }));

      for (const c of lista) {
        db.prepare(`INSERT INTO evaluacion_criterios (evaluacion_id, criterio, puntaje) VALUES (?, ?, ?)`)
          .run(evId, c.criterio, c.puntaje || '');
      }
      return evId;
    });

    const id = trx();
    res.status(201).json({ id, puntaje, resultado });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /evaluaciones/:id
router.put('/:id', (req, res) => {
  try {
    const ev = db.prepare(`SELECT * FROM evaluaciones_proveedor WHERE id = ?`).get(req.params.id);
    if (!ev) return res.status(404).json({ error: 'No encontrado' });

    const { anio, fecha, observaciones, criterios } = req.body;
    const { puntaje, resultado } = calcularResultado(criterios || []);

    const trx = db.transaction(() => {
      db.prepare(`
        UPDATE evaluaciones_proveedor SET anio=?, fecha=?, observaciones=?, puntaje=?, resultado=? WHERE id=?
      `).run(anio ?? ev.anio, fecha ?? ev.fecha, observaciones ?? ev.observaciones, puntaje, resultado, ev.id);

      if (criterios?.length) {
        db.prepare(`DELETE FROM evaluacion_criterios WHERE evaluacion_id = ?`).run(ev.id);
        for (const c of criterios) {
          db.prepare(`INSERT INTO evaluacion_criterios (evaluacion_id, criterio, puntaje) VALUES (?, ?, ?)`)
            .run(ev.id, c.criterio, c.puntaje || '');
        }
      }
    });
    trx();
    res.json({ puntaje, resultado });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /evaluaciones/:id
router.delete('/:id', (req, res) => {
  try {
    const ev = db.prepare(`SELECT id FROM evaluaciones_proveedor WHERE id = ?`).get(req.params.id);
    if (!ev) return res.status(404).json({ error: 'No encontrado' });
    db.prepare(`DELETE FROM evaluaciones_proveedor WHERE id = ?`).run(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
