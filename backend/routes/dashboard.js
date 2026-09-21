const express = require('express');
const { db }  = require('../db/database');
const { verificarToken } = require('../middleware/auth');
const { hoyArgentina, fechaArgentinaHace, primerDiaMesArgentina } = require('../helpers/fecha');

const router = express.Router();

router.get('/resumen', verificarToken, (req, res) => {
  const hoy    = hoyArgentina();
  const en30d  = fechaArgentinaHace(-30);
  const desde  = primerDiaMesArgentina();

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
  const proyActivos  = db.prepare("SELECT COUNT(*) as c FROM proyectos WHERE estado='Activo'  AND codigo NOT LIKE 'HIST-%' AND codigo NOT LIKE 'PROV-%'").get().c;
  const proyEnEspera = db.prepare("SELECT COUNT(*) as c FROM proyectos WHERE estado='En espera' AND codigo NOT LIKE 'HIST-%' AND codigo NOT LIKE 'PROV-%'").get().c;

  // ── Producción ─────────────────────────────────────────────────────────────
  const otAbiertas  = db.prepare("SELECT COUNT(*) as c FROM ordenes_trabajo WHERE estado IN ('Pendiente','En proceso','Pausada')").get().c;
  const otUrgentes  = db.prepare("SELECT COUNT(*) as c FROM ordenes_trabajo WHERE prioridad='Urgente' AND estado NOT IN ('Completada','Cancelada')").get().c;
  const otVencidas  = db.prepare("SELECT COUNT(*) as c FROM ordenes_trabajo WHERE fecha_fin_est!='' AND fecha_fin_est<? AND estado NOT IN ('Completada','Cancelada')").get(hoy).c;

  // ── Finanzas (solo si tiene permiso de lectura del módulo) ──────────────────
  let finanzasResumen = null;
  if (req.usuario.rol === 'admin' || req.permisos?.finanzas?.leer) {
    const finRow = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN tipo='Ingreso' AND estado='Confirmado' THEN monto ELSE 0 END),0) as ingresos_mes,
        COALESCE(SUM(CASE WHEN tipo='Egreso'  AND estado='Confirmado' THEN monto ELSE 0 END),0) as egresos_mes
      FROM movimientos_caja WHERE fecha>=? AND moneda='ARS'
    `).get(desde);

    const cuentas = db.prepare("SELECT * FROM cuentas_financieras WHERE activa=1 AND moneda='ARS'").all();
    // Una sola consulta agregada para todas las cuentas, en vez de una por
    // cuenta (N+1) — esta pantalla se abre en cada login.
    const deltasPorCuenta = Object.fromEntries(
      db.prepare(`
        SELECT cuenta_id,
          COALESCE(SUM(CASE WHEN tipo='Ingreso' AND estado='Confirmado' THEN monto ELSE 0 END),0)
          - COALESCE(SUM(CASE WHEN tipo='Egreso' AND estado='Confirmado' THEN monto ELSE 0 END),0) as delta
        FROM movimientos_caja GROUP BY cuenta_id
      `).all().map(m => [m.cuenta_id, m.delta])
    );
    const saldoTotal = cuentas.reduce((s,c) => s + c.saldo_inicial + (deltasPorCuenta[c.id] || 0), 0);

    finanzasResumen = { ingresos_mes: finRow.ingresos_mes, egresos_mes: finRow.egresos_mes, saldo_total: saldoTotal };
  }

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

  // ── Fichadas del día (solo si tiene permiso de lectura de RRHH) ─────────────
  let fichadas_hoy = [];
  let sin_fichar_hoy = [];
  if (req.usuario.rol === 'admin' || req.permisos?.rrhh?.leer) try {
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
    finanzas:  finanzasResumen,
    alertas:   { ots_urgentes, stock_bajo, oc_pendientes },
    fichadas_hoy,
    sin_fichar_hoy,
  });
});

module.exports = router;
