const express = require('express');
const { db }  = require('../db/database');
const { verificarToken } = require('../middleware/auth');

const router = express.Router();

router.get('/resumen', verificarToken, (req, res) => {
  const hoy    = new Date().toISOString().slice(0,10);
  const en30d  = new Date(Date.now()+30*864e5).toISOString().slice(0,10);
  const mesD   = new Date(); mesD.setDate(1);
  const desde  = mesD.toISOString().slice(0,10);

  // ── Stock ──────────────────────────────────────────────────────────────────
  const alertasStock = db.prepare(
    "SELECT COUNT(*) as c FROM productos WHERE activo=1 AND stock_minimo>0 AND stock_actual<=stock_minimo"
  ).get().c;
  const totalProductos = db.prepare("SELECT COUNT(*) as c FROM productos WHERE activo=1").get().c;

  // ── Compras ────────────────────────────────────────────────────────────────
  const ocAbiertas = db.prepare("SELECT COUNT(*) as c FROM ordenes_compra WHERE estado IN ('Emitida','Parcial')").get().c;
  const ocMes      = db.prepare("SELECT COUNT(*) as c FROM ordenes_compra WHERE fecha>=?").get(desde).c;
  const ocVencidas = db.prepare("SELECT COUNT(*) as c FROM ordenes_compra WHERE estado IN ('Emitida','Parcial') AND fecha_entrega_est!='' AND fecha_entrega_est<?").get(hoy).c;

  // ── Ventas ─────────────────────────────────────────────────────────────────
  const pptoBorrador = db.prepare("SELECT COUNT(*) as c FROM presupuestos WHERE estado='Borrador'").get().c;
  const pptoAprobado = db.prepare("SELECT COUNT(*) as c FROM presupuestos WHERE estado='Aprobado'").get().c;
  const pptoMes      = db.prepare("SELECT COUNT(*) as c FROM presupuestos WHERE fecha>=?").get(desde).c;

  // ── Proyectos ──────────────────────────────────────────────────────────────
  const proyActivos  = db.prepare("SELECT COUNT(*) as c FROM proyectos WHERE estado='Activo'  AND codigo NOT LIKE 'HIST-%'").get().c;
  const proyEnEspera = db.prepare("SELECT COUNT(*) as c FROM proyectos WHERE estado='En espera' AND codigo NOT LIKE 'HIST-%'").get().c;

  // ── Producción ─────────────────────────────────────────────────────────────
  const otAbiertas  = db.prepare("SELECT COUNT(*) as c FROM ordenes_trabajo WHERE estado IN ('Pendiente','En proceso','Pausada')").get().c;
  const otUrgentes  = db.prepare("SELECT COUNT(*) as c FROM ordenes_trabajo WHERE prioridad='Urgente' AND estado NOT IN ('Completada','Cancelada')").get().c;
  const otVencidas  = db.prepare("SELECT COUNT(*) as c FROM ordenes_trabajo WHERE fecha_fin_est!='' AND fecha_fin_est<? AND estado NOT IN ('Completada','Cancelada')").get(hoy).c;

  // ── Finanzas ───────────────────────────────────────────────────────────────
  const finRow = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN tipo='Ingreso' AND estado='Confirmado' THEN monto ELSE 0 END),0) as ingresos_mes,
      COALESCE(SUM(CASE WHEN tipo='Egreso'  AND estado='Confirmado' THEN monto ELSE 0 END),0) as egresos_mes
    FROM movimientos_caja WHERE fecha>=? AND moneda='ARS'
  `).get(desde);

  const cuentas = db.prepare("SELECT * FROM cuentas_financieras WHERE activa=1 AND moneda='ARS'").all();
  const saldoTotal = cuentas.reduce((s,c) => {
    const m = db.prepare("SELECT COALESCE(SUM(CASE WHEN tipo='Ingreso' AND estado='Confirmado' THEN monto ELSE 0 END),0)-COALESCE(SUM(CASE WHEN tipo='Egreso' AND estado='Confirmado' THEN monto ELSE 0 END),0) as delta FROM movimientos_caja WHERE cuenta_id=?").get(c.id);
    return s + c.saldo_inicial + m.delta;
  }, 0);

  // ── Actividad reciente ─────────────────────────────────────────────────────
  const ots_urgentes = db.prepare(
    "SELECT id,numero,descripcion,estado,prioridad,fecha_fin_est,proyecto_nombre FROM ordenes_trabajo WHERE prioridad='Urgente' AND estado NOT IN ('Completada','Cancelada') ORDER BY id DESC LIMIT 5"
  ).all();

  const stock_bajo = db.prepare(
    "SELECT id,codigo,descripcion,stock_actual,stock_minimo FROM productos WHERE activo=1 AND stock_minimo>0 AND stock_actual<=stock_minimo ORDER BY (stock_actual-stock_minimo) ASC LIMIT 8"
  ).all();

  const oc_pendientes = db.prepare(
    `SELECT id,numero,fecha,proveedor_nombre,estado,fecha_entrega_est,
            CASE WHEN fecha_entrega_est!='' AND fecha_entrega_est<? THEN 1 ELSE 0 END AS vencida
     FROM ordenes_compra WHERE estado IN ('Emitida','Parcial')
     ORDER BY CASE WHEN fecha_entrega_est!='' THEN 0 ELSE 1 END, fecha_entrega_est ASC, fecha ASC LIMIT 6`
  ).all(hoy);

  // ── Fichadas del día ───────────────────────────────────────────────────────
  let fichadas_hoy = [];
  let sin_fichar_hoy = [];
  try {
    fichadas_hoy = db.prepare(`
      SELECT
        COALESCE(e.nombre, a.empleado_nombre, a.empleado_ext) AS nombre,
        MIN(a.hora)        AS hora_entrada,
        MAX(a.tipo_acceso) AS tipo_acceso,
        e.horario_entrada  AS horario_entrada
      FROM rrhh_asistencia a
      LEFT JOIN rrhh_empleados e ON e.id = a.empleado_id
      WHERE a.fecha = ? AND a.empleado_ext != ''
        AND (e.id IS NULL OR e.tipo != 'interno' OR e.obliga_fichar != 0)
      GROUP BY COALESCE(CAST(a.empleado_id AS TEXT), a.empleado_ext)
      ORDER BY MIN(a.hora)
    `).all(hoy);
    sin_fichar_hoy = db.prepare(`
      SELECT e.id, e.nombre, e.horario_entrada
      FROM rrhh_empleados e
      WHERE e.activo = 1
        AND NOT (e.tipo = 'interno' AND COALESCE(e.obliga_fichar, 1) = 0)
        AND e.id NOT IN (
          SELECT DISTINCT empleado_id FROM rrhh_asistencia
          WHERE fecha = ? AND empleado_id IS NOT NULL
        )
      ORDER BY e.nombre
    `).all(hoy);
  } catch (_) {}

  res.json({
    stock:     { alertas: alertasStock, total: totalProductos },
    compras:   { abiertas: ocAbiertas, mes: ocMes, vencidas: ocVencidas },
    ventas:    { borrador: pptoBorrador, aprobado: pptoAprobado, mes: pptoMes },
    proyectos: { activos: proyActivos, en_espera: proyEnEspera },
    produccion:{ abiertas: otAbiertas, urgentes: otUrgentes, vencidas: otVencidas },
    finanzas:  { ingresos_mes: finRow.ingresos_mes, egresos_mes: finRow.egresos_mes, saldo_total: saldoTotal },
    alertas:   { ots_urgentes, stock_bajo, oc_pendientes },
    fichadas_hoy,
    sin_fichar_hoy,
  });
});

module.exports = router;
