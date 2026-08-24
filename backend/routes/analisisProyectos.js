'use strict'
const express = require('express')
const { db } = require('../db/database')
const { verificarToken, puede } = require('../middleware/auth')

const router = express.Router()
router.use(verificarToken)
router.use(puede.leer('analisis_proyectos'))

// Costo de mano de obra: horas cargadas en "Mi Parte" (rrhh_registros) contra
// el costo_hora de cada empleado. Costo de materiales: lo efectivamente
// retirado de depósito (movimientos_stock, tipo 'salida' menos 'devolucion')
// atribuido al proyecto vía el campo de texto "proyecto" × precio_costo
// vigente del catálogo — no lo previsto en la pestaña Materiales de Proyectos.
//
// "proyecto" en movimientos_stock guarda el código del proyecto, PERO con dos
// formatos según de dónde salió el movimiento: un alta manual en Stock guarda
// solo el código (ver Stock.jsx), mientras que la entrega de un Pedido de
// Stock guarda "CODIGO — Nombre" (ver textoAsignacion en stock.js). El CASE de
// abajo extrae el código en ambos casos para poder agrupar por proyecto real.
const CODIGO_PROYECTO_DESDE_MOVIMIENTO = `
  CASE WHEN INSTR(m.proyecto, ' — ') > 0
    THEN SUBSTR(m.proyecto, 1, INSTR(m.proyecto, ' — ') - 1)
    ELSE m.proyecto
  END
`;

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT p.id, p.codigo, p.nombre, p.cliente_nombre, p.estado, p.presupuesto_venta,
      COALESCE(h.horas_totales, 0)    AS horas_totales,
      COALESCE(h.costo_mano_obra, 0)  AS costo_mano_obra,
      COALESCE(mat.costo_materiales, 0) AS costo_materiales
    FROM proyectos p
    LEFT JOIN (
      SELECT r.proyecto_id,
        SUM(r.horas) AS horas_totales,
        SUM(r.horas * COALESCE(e.costo_hora, 0)) AS costo_mano_obra
      FROM rrhh_registros r
      JOIN rrhh_empleados e ON e.id = r.empleado_id
      WHERE r.proyecto_id IS NOT NULL
      GROUP BY r.proyecto_id
    ) h ON h.proyecto_id = p.id
    LEFT JOIN (
      SELECT ${CODIGO_PROYECTO_DESDE_MOVIMIENTO} AS codigo_proyecto,
        SUM((CASE WHEN m.tipo='salida' THEN m.cantidad WHEN m.tipo='devolucion' THEN -m.cantidad ELSE 0 END)
            * COALESCE(pr.precio_costo, 0)) AS costo_materiales
      FROM movimientos_stock m
      LEFT JOIN productos pr ON pr.id = m.producto_id
      WHERE m.proyecto != '' AND m.tipo IN ('salida','devolucion')
      GROUP BY codigo_proyecto
    ) mat ON mat.codigo_proyecto = p.codigo
    WHERE p.codigo NOT LIKE 'HIST-%'
    ORDER BY p.id DESC
  `).all()
  for (const r of rows) r.costo_total = r.costo_mano_obra + r.costo_materiales
  res.json(rows)
})

router.get('/:id', (req, res) => {
  const proyecto = db.prepare(`
    SELECT id, codigo, nombre, cliente_nombre, estado, presupuesto_venta
    FROM proyectos WHERE id=?
  `).get(req.params.id)
  if (!proyecto) return res.status(404).json({ error: 'Proyecto no encontrado' })

  const porEmpleado = db.prepare(`
    SELECT e.id AS empleado_id, e.nombre, SUM(r.horas) AS horas, e.costo_hora,
      SUM(r.horas) * COALESCE(e.costo_hora, 0) AS subtotal
    FROM rrhh_registros r
    JOIN rrhh_empleados e ON e.id = r.empleado_id
    WHERE r.proyecto_id = ?
    GROUP BY e.id
    ORDER BY subtotal DESC
  `).all(req.params.id)

  const porMaterial = db.prepare(`
    SELECT pr.id, pr.codigo, pr.descripcion, pr.unidad, pr.precio_costo,
      SUM(CASE WHEN m.tipo='salida' THEN m.cantidad WHEN m.tipo='devolucion' THEN -m.cantidad ELSE 0 END) AS cantidad,
      SUM(CASE WHEN m.tipo='salida' THEN m.cantidad WHEN m.tipo='devolucion' THEN -m.cantidad ELSE 0 END)
        * COALESCE(pr.precio_costo, 0) AS subtotal
    FROM movimientos_stock m
    JOIN productos pr ON pr.id = m.producto_id
    WHERE m.tipo IN ('salida','devolucion')
      AND (m.proyecto = ? OR m.proyecto LIKE ? || ' — %')
    GROUP BY pr.id
    HAVING cantidad != 0
    ORDER BY subtotal DESC
  `).all(proyecto.codigo, proyecto.codigo)

  const costo_mano_obra = porEmpleado.reduce((s, e) => s + e.subtotal, 0)
  const costo_materiales = porMaterial.reduce((s, m) => s + m.subtotal, 0)
  res.json({
    ...proyecto,
    horas_totales: porEmpleado.reduce((s, e) => s + e.horas, 0),
    costo_mano_obra, costo_materiales, costo_total: costo_mano_obra + costo_materiales,
    porEmpleado, porMaterial,
  })
})

module.exports = router
