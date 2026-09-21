const express = require('express');
const multer  = require('multer');
const XLSX    = require('xlsx');
const { db }  = require('../db/database');
const { verificarToken, puede } = require('../middleware/auth');
const { traerCotizacionBNA } = require('../helpers/bnaScraper');
const { hoyArgentina } = require('../helpers/fecha');
const { obtenerAutorizantes } = require('../helpers/organigrama');
const { enviarMensajeSistema } = require('../helpers/mensajes');
const { getConfig } = require('../helpers/config');
const { MESES_POR_PERIODICIDAD, sumarMeses } = require('../helpers/servicios');
const leerFinanzas = puede.leer('finanzas');
// Una factura en moneda extranjera puede quedar con un resto de unos pocos
// pesos por redondeo del tipo de cambio al convertir pagos y NC a pesos para
// poder sumarlos — no es un saldo real pendiente de cobrar/pagar.
const TOLERANCIA_SALDO_PESOS = 10;
// Facturas de compra/venta, saldos, tipo de cambio, servicios y control OC son
// también carga de la secretaría desde Administración (no solo de Gerencia) —
// el lado de escritura (puedeEscribir, más abajo) ya contemplaba administracion,
// pero las lecturas se habían quedado exigiendo únicamente "finanzas".
const leerFinanzasOAdministracion = (req, res, next) => {
  const p = req.permisos || {};
  if (req.usuario?.rol === 'admin' || p.finanzas?.leer || p.finanzas?.escribir || p.administracion?.leer || p.administracion?.escribir) {
    return next();
  }
  return res.status(403).json({ error: 'Sin permisos de lectura' });
};
// Exportar (descargar) no es lo mismo que leer en pantalla — alguien con
// acceso de solo lectura (leer, sin escribir) puede ver los datos pero no
// llevárselos. Se exige escribir en al menos uno de los mismos módulos que
// habilitan la lectura de cada pantalla.
const puedeExportarFinanzas = puede.escribir('finanzas');
const puedeExportarFinanzasOAdministracion = (req, res, next) => {
  const p = req.permisos || {};
  if (req.usuario?.rol === 'admin' || p.finanzas?.escribir || p.administracion?.escribir) return next();
  return res.status(403).json({ error: 'No tenés permiso para exportar' });
};
const { buscarCondicion } = require('../helpers/buscar');
const { sqlFechaIso } = require('../helpers/fecha');
const { validarPctCuotas } = require('../helpers/cuotas');

const router = express.Router();

// Si la moneda de la factura ya es PESO, `importe` YA está en pesos (ej. una
// factura vinculada a una OC en dólares guarda el neto convertido, pero
// conserva la tasa_cambio de la OC como referencia) — multiplicar de nuevo
// por esa tasa duplica la conversión. Solo corresponde convertir cuando la
// factura está realmente en moneda extranjera.
function totalEnPesos(f) {
  const esPeso = f.moneda === 'PESO' || f.moneda === 'PESOS' || !f.moneda;
  return esPeso ? (parseFloat(f.importe) || 0) : (parseFloat(f.importe) || 0) * (parseFloat(f.tasa_cambio) || 1);
}
// Misma corrección, en SQL, para las queries de dashboard/KPIs que suman
// importe*tasa_cambio directamente — sin este CASE, cualquier factura en PESO
// con una tasa_cambio de referencia (ej. vinculada a una OC en USD) inflaba el
// total al reconvertir un importe que ya estaba en pesos.
const sqlTotalPesos = (col, monCol, tcCol) =>
  `(CASE WHEN ${monCol} IN ('PESO','PESOS') OR ${monCol} IS NULL OR ${monCol}='' THEN ${col} ELSE ${col} * COALESCE(${tcCol},1) END)`;
const esNC = tipo => typeof tipo === 'string' && tipo.startsWith('NC');

// Convierte un pago a un valor de referencia en USD, para compararlo contra
// el umbral de autorización (§4 del diagnóstico de organización: aplicar el
// mismo criterio de autorización del organigrama que ya usa el retiro de
// stock a lo que de verdad mueve plata). Se pasa primero a pesos con la
// misma lógica que ya usa el resto de Finanzas (totalEnPesos) y de ahí a
// USD con la última cotización BNA cargada — no hay otra fuente de "USD de
// hoy" más confiable en el sistema. Si nunca se cargó una cotización,
// devuelve null: no se puede evaluar el umbral, y se opta por no bloquear
// la confirmación en vez de trabar Tesorería por un dato de configuración.
function ultimaCotizacionUSD() {
  const row = db.prepare(`
    SELECT valor FROM tipo_cambio WHERE moneda='DÓLAR' ORDER BY created_at DESC, id DESC LIMIT 1
  `).get();
  return row ? parseFloat(row.valor) || null : null;
}
function montoEnUSD(p) {
  const cot = ultimaCotizacionUSD();
  if (!cot) return null;
  return totalEnPesos(p) / cot;
}

// Si el pago supera el umbral configurable, exige elegir un autorizante de
// la misma lista admin/gerentes que ya usa el retiro de stock. Se evalúa
// recién al confirmar (ahí es cuando la plata realmente se mueve), no al
// cargar el pago.
function resolverAutorizantePago(pago, body) {
  const umbral = parseFloat(getConfig('pago_umbral_autorizacion_usd', '1000')) || 1000;
  const usd = montoEnUSD(pago);
  if (usd === null || usd < umbral) return { ok: true, autorizante: null };
  const autorizante = obtenerAutorizantes().find(u => u.id === parseInt(body.autorizado_por_id));
  if (!autorizante) {
    return {
      ok: false,
      error: `Este pago es de USD ${usd.toFixed(0)} (supera el umbral de USD ${umbral}) — elegí quién lo autoriza`,
      requiereAutorizante: true, montoUsd: Math.round(usd), umbralUsd: umbral,
    };
  }
  return { ok: true, autorizante };
}

// Mismo aviso post-hecho que ya usa el retiro de stock: la plata ya se
// movió, se le informa al autorizante elegido qué fue lo que confirmó.
function notificarAutorizantePago(tipoOp, facturaId, pagoId, autorizante, usuario) {
  const esCompra = tipoOp === 'compra';
  const factura = db.prepare(`
    SELECT numero, ${esCompra ? 'proveedor_nombre' : 'cliente_nombre'} AS nombre
    FROM ${esCompra ? 'facturas_compra' : 'facturas_venta'} WHERE id=?
  `).get(facturaId);
  const pago = db.prepare(`
    SELECT importe, moneda, fecha, forma_pago FROM ${esCompra ? 'pagos_factura_compra' : 'pagos_factura_venta'} WHERE id=?
  `).get(pagoId);
  if (!factura || !pago) return;
  enviarMensajeSistema({
    de_id: usuario.id, de_nombre: usuario.nombre, para_id: autorizante.id,
    asunto: `Pago autorizado — Factura ${factura.numero}`,
    cuerpo: `Se confirmó un pago ${esCompra ? 'a proveedor' : 'de cliente'} que requería tu autorización:\n\n`
      + `${esCompra ? 'Proveedor' : 'Cliente'}: ${factura.nombre}\nFactura: ${factura.numero}\n`
      + `Importe: ${pago.importe} ${pago.moneda}\nForma de pago: ${pago.forma_pago}\nFecha: ${pago.fecha}\n`,
  });
}

// Mismo criterio que ya usan las rutas de pagos (importe > 0): el formulario
// nunca deja cargar un monto negativo (todos los inputs usan min="0"), así
// que si llega uno es un valor mal enviado, no un caso de uso real a soportar.
// Excepción: una Nota de Crédito SÍ guarda su "importe" en negativo a propósito
// (anula el monto de la factura que referencia, ver esNC/resolverNcFacturaId) —
// no se valida su signo. No incluye campos que pueden ser negativos por otra
// naturaleza (ej. dif_cambio, a favor o en contra) ni retenciones sin input propio.
// (Listas centralizadas en helpers/masking.js — las usa también el enmascarado
// de montos reales para puestos como Auditoría de Calidad.)
const { CAMPOS_MONTO_FACTURA_COMPRA, CAMPOS_MONTO_FACTURA_VENTA } = require('../helpers/masking');
function validarMontosFactura(body, campos, tipoFacturaEfectivo) {
  if (!esNC(tipoFacturaEfectivo ?? body.tipo_factura) && body.importe !== undefined && parseFloat(body.importe) < 0) return 'El importe no puede ser negativo';
  for (const campo of campos) {
    if (body[campo] !== undefined && parseFloat(body[campo]) < 0) return `El campo "${campo}" no puede ser negativo`;
  }
  return null;
}

// Una NC solo puede anular una factura real de la MISMA tabla (no otra NC, no
// a sí misma). Si el tipo no es NC, se ignora cualquier nc_factura_id recibido
// — el vínculo solo tiene sentido en un comprobante que anula a otro.
function resolverNcFacturaId(tabla, tipoFactura, ncFacturaIdRaw, propioId) {
  if (!esNC(tipoFactura)) return { ok: true, id: null };
  if (!ncFacturaIdRaw) return { ok: false, error: 'Falta indicar qué factura anula esta Nota de Crédito' };
  const ncFacturaId = parseInt(ncFacturaIdRaw, 10);
  if (propioId && ncFacturaId === parseInt(propioId, 10)) {
    return { ok: false, error: 'Una Nota de Crédito no puede anularse a sí misma' };
  }
  const target = db.prepare(`SELECT id, tipo_factura FROM ${tabla} WHERE id=?`).get(ncFacturaId);
  if (!target) return { ok: false, error: 'La factura que se intenta anular no existe' };
  if (esNC(target.tipo_factura)) return { ok: false, error: 'No se puede anular una Nota de Crédito con otra Nota de Crédito' };
  return { ok: true, id: ncFacturaId };
}

const puedeEscribir = req =>
  req.usuario?.rol === 'admin' ||
  req.permisos?.finanzas?.escribir ||
  req.permisos?.administracion?.escribir

// Confirmar un pago (e-cheq/cheque diferido acreditado) es una función de
// tesorería puntual, más restrictiva que el resto de la edición de pagos que
// sí comparten Finanzas y Administración: acá NO alcanza con administracion.escribir.
const puedeConfirmarPago = req =>
  req.usuario?.rol === 'admin' ||
  !!req.permisos?.finanzas?.escribir

// ── Dashboard ─────────────────────────────────────────────────────────────────

// Extraído a función propia para poder reusarlo también desde el reporte
// diario por mail (helpers/reporteDashboardFinanzas.js), que corre fuera de
// un request HTTP (vía script de cron) y necesita exactamente los mismos
// números que ve un usuario parado en esta pantalla.
function calcularDashboardFinanzas(desde = '', hasta = '') {
  hasta = hasta || hoyArgentina()
  const filtC = desde ? 'fecha >= ? AND fecha <= ?' : 'fecha <= ?'
  const argsC = desde ? [desde, hasta] : [hasta]

  // Alias con raíz "monto_"/"pesos" a propósito (no "total"/"pagado"/
  // "pendiente" a secas) para que el enmascarado de montos (helpers/masking.js)
  // los reconozca sin ambigüedad — esas mismas palabras sueltas se usan en
  // otros módulos (Stock, Producción, Ventas) para contadores, no para dinero.
  const tpC = sqlTotalPesos('importe', 'moneda', 'tasa_cambio')
  const tpV = sqlTotalPesos('importe', 'moneda', 'tasa_cambio')
  const kpiC = db.prepare(`
    SELECT COUNT(*) as count,
      COALESCE(SUM(${tpC}),0) as monto_total,
      COALESCE(SUM(CASE WHEN pago_confirmado=1 THEN ${tpC} ELSE 0 END),0) as monto_pagado,
      COALESCE(SUM(CASE WHEN pago_confirmado=0 AND (anticipo IS NULL OR anticipo=0) THEN ${tpC} ELSE 0 END),0) as monto_pendiente,
      COALESCE(SUM(CASE WHEN pago_confirmado=0 AND anticipo>0 THEN ${tpC} ELSE 0 END),0) as con_anticipo,
      COALESCE(SUM(CASE WHEN pago_confirmado=0 AND anticipo>0 THEN ${sqlTotalPesos('(importe-anticipo)', 'moneda', 'tasa_cambio')} ELSE 0 END),0) as saldo_anticipo
    FROM facturas_compra WHERE ${filtC}`).get(...argsC)

  const kpiV = db.prepare(`
    SELECT COUNT(*) as count,
      COALESCE(SUM(${tpV}),0) as monto_total,
      COALESCE(SUM(CASE WHEN pago_confirmado=1 THEN ${tpV} ELSE 0 END),0) as monto_pagado,
      COALESCE(SUM(CASE WHEN pago_confirmado=0 AND (anticipo IS NULL OR anticipo=0) THEN ${tpV} ELSE 0 END),0) as monto_pendiente,
      COALESCE(SUM(CASE WHEN pago_confirmado=0 AND anticipo>0 THEN ${tpV} ELSE 0 END),0) as con_anticipo,
      COALESCE(SUM(CASE WHEN pago_confirmado=0 AND anticipo>0 THEN ${sqlTotalPesos('(importe-anticipo)', 'moneda', 'tasa_cambio')} ELSE 0 END),0) as saldo_anticipo
    FROM facturas_venta WHERE ${filtC}`).get(...argsC)

  // Últimos 12 meses para el gráfico
  const porMesC = db.prepare(`
    SELECT strftime('%Y-%m', fecha) as mes, COALESCE(SUM(${tpC}),0) as monto_total, COUNT(*) as count
    FROM facturas_compra WHERE fecha >= date('now','-11 months','start of month') AND fecha <= ?
    GROUP BY mes ORDER BY mes`).all(hasta)

  const porMesV = db.prepare(`
    SELECT strftime('%Y-%m', fecha) as mes, COALESCE(SUM(${tpV}),0) as monto_total, COUNT(*) as count
    FROM facturas_venta WHERE fecha >= date('now','-11 months','start of month') AND fecha <= ?
    GROUP BY mes ORDER BY mes`).all(hasta)

  // Por cobrar total real (usando tabla de pagos, sin filtro de período).
  // Resta también las NC vinculadas: una factura anulada del todo no tiene
  // nada real pendiente de cobro, aunque nunca haya tenido un pago registrado.
  const kpiVTotal = db.prepare(`
    SELECT
      COALESCE(SUM(
        CASE WHEN fv.pago_confirmado=0
          THEN MAX(0, ${sqlTotalPesos('fv.importe', 'fv.moneda', 'fv.tasa_cambio')} - COALESCE(pag.total_pagado, 0) - COALESCE(nc.total_nc, 0))
          ELSE 0 END
      ), 0) as monto_pendiente,
      0 as saldo_anticipo
    FROM facturas_venta fv
    LEFT JOIN (
      SELECT factura_id, SUM(CASE WHEN estado='confirmado' OR forma_pago='e-cheq' THEN ${sqlTotalPesos('importe','moneda','tasa_cambio')}+COALESCE(ret_iibb,0)+COALESCE(ret_iva,0)+COALESCE(ret_gcia,0)+COALESCE(ret_contratista,0)+COALESCE(ret_ss,0) ELSE 0 END) AS total_pagado
      FROM pagos_factura_venta GROUP BY factura_id
    ) pag ON pag.factura_id = fv.id
    LEFT JOIN (
      SELECT nc_factura_id, SUM(ABS(${sqlTotalPesos('importe','moneda','tasa_cambio')})) AS total_nc
      FROM facturas_venta WHERE nc_factura_id IS NOT NULL GROUP BY nc_factura_id
    ) nc ON nc.nc_factura_id = fv.id
    WHERE fv.tipo_factura NOT LIKE 'NC%'`).get()

  // Próximos vencimientos (30 días) — ídem, una factura ya anulada del todo
  // por NC no es un vencimiento real aunque tenga fecha de vencimiento cargada.
  const vencimientos = db.prepare(`
    SELECT 'compra' as tipo, f.id, f.numero, f.proveedor_nombre as nombre, f.importe, f.moneda, f.tasa_cambio, f.fecha_vencimiento, f.anticipo
    FROM facturas_compra f
    LEFT JOIN (
      SELECT nc_factura_id, SUM(ABS(${sqlTotalPesos('importe','moneda','tasa_cambio')})) AS total_nc
      FROM facturas_compra WHERE nc_factura_id IS NOT NULL GROUP BY nc_factura_id
    ) nc ON nc.nc_factura_id = f.id
    WHERE f.pago_confirmado=0 AND f.tipo_factura NOT LIKE 'NC%'
      AND f.fecha_vencimiento > '' AND f.fecha_vencimiento BETWEEN date('now') AND date('now','+30 days')
      AND COALESCE(nc.total_nc, 0) < ${sqlTotalPesos('f.importe', 'f.moneda', 'f.tasa_cambio')} - 0.01
    UNION ALL
    SELECT 'venta', f.id, f.numero, f.cliente_nombre, f.importe, f.moneda, f.tasa_cambio, f.fecha_vencimiento, f.anticipo
    FROM facturas_venta f
    LEFT JOIN (
      SELECT nc_factura_id, SUM(ABS(${sqlTotalPesos('importe','moneda','tasa_cambio')})) AS total_nc
      FROM facturas_venta WHERE nc_factura_id IS NOT NULL GROUP BY nc_factura_id
    ) nc ON nc.nc_factura_id = f.id
    WHERE f.pago_confirmado=0 AND f.tipo_factura NOT LIKE 'NC%'
      AND f.fecha_vencimiento > '' AND f.fecha_vencimiento BETWEEN date('now') AND date('now','+30 days')
      AND COALESCE(nc.total_nc, 0) < ${sqlTotalPesos('f.importe', 'f.moneda', 'f.tasa_cambio')} - 0.01
    ORDER BY fecha_vencimiento LIMIT 15`).all()

  // Facturas con anticipo (saldo pendiente) — el anticipo es un campo aparte
  // (no pasa por NC), se deja tal cual, solo se excluyen las anuladas del todo.
  const conAnticipo = db.prepare(`
    SELECT 'compra' as tipo, f.id, f.numero, f.proveedor_nombre as nombre, f.importe, f.moneda, f.tasa_cambio, f.anticipo, f.fecha_anticipo
    FROM facturas_compra f
    LEFT JOIN (
      SELECT nc_factura_id, SUM(ABS(${sqlTotalPesos('importe','moneda','tasa_cambio')})) AS total_nc
      FROM facturas_compra WHERE nc_factura_id IS NOT NULL GROUP BY nc_factura_id
    ) nc ON nc.nc_factura_id = f.id
    WHERE f.pago_confirmado=0 AND f.anticipo>0
      AND COALESCE(nc.total_nc, 0) < ${sqlTotalPesos('f.importe', 'f.moneda', 'f.tasa_cambio')} - 0.01
    UNION ALL
    SELECT 'venta', f.id, f.numero, f.cliente_nombre, f.importe, f.moneda, f.tasa_cambio, f.anticipo, f.fecha_anticipo
    FROM facturas_venta f
    LEFT JOIN (
      SELECT nc_factura_id, SUM(ABS(${sqlTotalPesos('importe','moneda','tasa_cambio')})) AS total_nc
      FROM facturas_venta WHERE nc_factura_id IS NOT NULL GROUP BY nc_factura_id
    ) nc ON nc.nc_factura_id = f.id
    WHERE f.pago_confirmado=0 AND f.anticipo>0
      AND COALESCE(nc.total_nc, 0) < ${sqlTotalPesos('f.importe', 'f.moneda', 'f.tasa_cambio')} - 0.01
    ORDER BY fecha_anticipo DESC LIMIT 10`).all()

  // Top proveedores del período
  const topProv = db.prepare(`
    SELECT proveedor_nombre as nombre, COUNT(*) as count, COALESCE(SUM(${tpC}),0) as monto_total
    FROM facturas_compra WHERE ${filtC} AND proveedor_nombre != ''
    GROUP BY proveedor_nombre ORDER BY monto_total DESC LIMIT 8`).all(...argsC)

  return { kpiC, kpiV, kpiVTotal, porMesC, porMesV, vencimientos, conAnticipo, topProv }
}

router.get('/dashboard', verificarToken, leerFinanzas, (req, res) => {
  const { desde = '', hasta = '' } = req.query
  res.json(calcularDashboardFinanzas(desde, hasta))
})

// Extraído a función propia por el mismo motivo que calcularDashboardFinanzas
// — el reporte diario por mail (helpers/reporteDashboardFinanzas.js) tiene
// que reflejar EXACTAMENTE lo mismo que ve un usuario parado en la pestaña
// "Estado Hoy" de Finanzas, no un resumen aparte con otros números.
function obtenerDashboardDiario() {
  const hoy = hoyArgentina()

  // Último saldo por banco + E-CHEQs sin confirmar de ese banco — la resta
  // "saldo - e-cheqs pendientes" que hace el frontend (BankCard) asume que
  // ambos números están en la MISMA moneda que la cuenta (sb.moneda), así
  // que acá se suman solo los e-cheques de esa misma moneda (no se convierte
  // a pesos: eso rompería la resta para una cuenta en USD, y mezclar
  // monedas sin filtrar sumaba pesos y dólares como si fueran lo mismo).
  const saldosBancarios = db.prepare(`
    SELECT s1.entidad, s1.monto, s1.moneda, s1.created_at, u.nombre as usuario_nombre,
      COALESCE((
        SELECT SUM(pfc.importe)
        FROM pagos_factura_compra pfc
        WHERE pfc.forma_pago = 'e-cheq' AND pfc.estado = 'pendiente' AND pfc.entidad = s1.entidad
          AND COALESCE(NULLIF(pfc.moneda,''),'PESO') = COALESCE(NULLIF(s1.moneda,''),'PESO')
      ), 0) as echeq_pendiente
    FROM saldo_bancario s1
    LEFT JOIN usuarios u ON u.id = s1.created_by
    WHERE s1.id = (SELECT MAX(id) FROM saldo_bancario s2 WHERE s2.entidad = s1.entidad)
    ORDER BY s1.entidad
  `).all()

  // Solo servicios con monto cargado
  const serviciosPendientes = db.prepare(`
    SELECT sc.id as cuota_id, s.id as servicio_id, s.descripcion, s.periodicidad, s.usuario,
      sc.vencimiento, sc.monto, sc.estado,
      CASE
        WHEN sc.vencimiento < ? THEN 'vencida'
        WHEN sc.vencimiento = ? THEN 'hoy'
        WHEN sc.vencimiento <= date(?, '+7 days') THEN 'semana'
        ELSE 'mes'
      END as alerta
    FROM servicios s
    JOIN servicios_cuotas sc ON sc.servicio_id = s.id
    WHERE s.activo = 1 AND sc.estado = 'pendiente' AND sc.vencimiento > ''
      AND sc.vencimiento <= date(?, '+30 days')
      AND sc.monto IS NOT NULL AND sc.monto > 0
    ORDER BY sc.vencimiento ASC
  `).all(hoy, hoy, hoy, hoy)

  // Resumen de servicios recurrentes del mes en curso (por vencimiento, no por
  // cuándo se cargó el pago) — para el cuadro "Servicios del mes" del dashboard.
  // Las cuotas que `generarCuotasDelMes` crea automáticamente el día 1 nacen
  // con monto=0 (todavía nadie cargó el importe real) — antes quedaban afuera
  // de la cuenta por completo, mostrando una deuda del mes más baja de la que
  // realmente hay. Para esas, se estima la deuda con el monto de la última
  // cuota cargada de ese servicio, aparte de la deuda con monto real.
  const serviciosMesRow = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN c.estado='pagado' THEN c.monto ELSE 0 END),0) as pagado,
      COALESCE(SUM(CASE WHEN c.estado='pendiente' AND c.monto > 0 THEN c.monto ELSE 0 END),0) as pendiente,
      COALESCE(SUM(CASE WHEN c.estado='pendiente' AND (c.monto IS NULL OR c.monto = 0) THEN
        (SELECT c2.monto FROM servicios_cuotas c2 WHERE c2.servicio_id = c.servicio_id AND c2.id < c.id ORDER BY c2.id DESC LIMIT 1)
      ELSE 0 END),0) as pendiente_estimado
    FROM servicios_cuotas c
    WHERE substr(c.vencimiento,1,7) = substr(?,1,7)
  `).get(hoy)
  const serviciosMes = {
    // Nombres con raíz "monto_" a propósito (no "pagado"/"pendiente" a secas)
    // para que el enmascarado de montos (helpers/masking.js) los reconozca sin
    // ambigüedad — esas mismas palabras sueltas se usan en otros módulos para
    // contadores, no para dinero.
    monto_pagado: serviciosMesRow.pagado,
    monto_pendiente: serviciosMesRow.pendiente,
    monto_pendiente_estimado: serviciosMesRow.pendiente_estimado,
  }

  // Una factura anulada del todo por una NC no tiene nada realmente pendiente
  // (nunca se cobró/pagó, pero tampoco queda nada por cobrar/pagar) — sin
  // restar la NC acá, quedaba contada de más en estos totales "pendientes".
  const comprasPendientes = db.prepare(`
    SELECT COUNT(*) as count,
      COALESCE(SUM(MAX(0, ${sqlTotalPesos('f.importe', 'f.moneda', 'f.tasa_cambio')} - COALESCE(pag.total_pagado, 0) - COALESCE(nc.total_nc, 0))), 0) as total_pesos
    FROM facturas_compra f
    LEFT JOIN (
      SELECT factura_id, SUM(CASE WHEN estado='confirmado' OR forma_pago='e-cheq' THEN ${sqlTotalPesos('importe','moneda','tasa_cambio')} ELSE 0 END) AS total_pagado
      FROM pagos_factura_compra GROUP BY factura_id
    ) pag ON pag.factura_id = f.id
    LEFT JOIN (
      SELECT nc_factura_id, SUM(ABS(${sqlTotalPesos('importe','moneda','tasa_cambio')})) AS total_nc
      FROM facturas_compra WHERE nc_factura_id IS NOT NULL GROUP BY nc_factura_id
    ) nc ON nc.nc_factura_id = f.id
    WHERE f.pago_confirmado = 0 AND f.tipo_factura NOT LIKE 'NC%'
      AND MAX(0, ${sqlTotalPesos('f.importe', 'f.moneda', 'f.tasa_cambio')} - COALESCE(pag.total_pagado, 0) - COALESCE(nc.total_nc, 0)) > 0.01
  `).get()

  const ventasPendientes = db.prepare(`
    SELECT COUNT(*) as count,
      COALESCE(SUM(MAX(0, ${sqlTotalPesos('f.importe', 'f.moneda', 'f.tasa_cambio')} - COALESCE(pag.total_pagado, 0) - COALESCE(nc.total_nc, 0))), 0) as total_pesos
    FROM facturas_venta f
    LEFT JOIN (
      SELECT factura_id, SUM(CASE WHEN estado='confirmado' OR forma_pago='e-cheq' THEN ${sqlTotalPesos('importe','moneda','tasa_cambio')}+COALESCE(ret_iibb,0)+COALESCE(ret_iva,0)+COALESCE(ret_gcia,0)+COALESCE(ret_contratista,0)+COALESCE(ret_ss,0) ELSE 0 END) AS total_pagado
      FROM pagos_factura_venta GROUP BY factura_id
    ) pag ON pag.factura_id = f.id
    LEFT JOIN (
      SELECT nc_factura_id, SUM(ABS(${sqlTotalPesos('importe','moneda','tasa_cambio')})) AS total_nc
      FROM facturas_venta WHERE nc_factura_id IS NOT NULL GROUP BY nc_factura_id
    ) nc ON nc.nc_factura_id = f.id
    WHERE f.pago_confirmado = 0 AND f.tipo_factura NOT LIKE 'NC%'
      AND MAX(0, ${sqlTotalPesos('f.importe', 'f.moneda', 'f.tasa_cambio')} - COALESCE(pag.total_pagado, 0) - COALESCE(nc.total_nc, 0)) > 0.01
  `).get()

  // Un E-CHEQ recibido marca la factura como cobrada al toque (sin esperar a
  // que se acredite) — así que esa plata desaparece de "por cobrar" aunque
  // todavía no esté disponible de verdad. Se sigue mostrando acá aparte para
  // que "Por cobrar" no subestime lo que realmente falta llegar al banco.
  ventasPendientes.echeq_pendiente = db.prepare(`
    SELECT COALESCE(SUM(${sqlTotalPesos('importe','moneda','tasa_cambio')}),0) as total
    FROM pagos_factura_venta WHERE forma_pago='e-cheq' AND estado='pendiente'
  `).get().total

  const facturasPorPagar = db.prepare(`
    SELECT f.id, f.numero, f.proveedor_nombre as nombre, f.fecha, f.fecha_vencimiento,
      f.importe, f.moneda, f.tasa_cambio,
      COALESCE(pag.total_pagado, 0) as total_pagado,
      MAX(0, ${sqlTotalPesos('f.importe', 'f.moneda', 'f.tasa_cambio')} - COALESCE(pag.total_pagado, 0) - COALESCE(nc.total_nc, 0)) as saldo_pesos
    FROM facturas_compra f
    LEFT JOIN (
      SELECT factura_id, SUM(CASE WHEN estado='confirmado' OR forma_pago='e-cheq' THEN ${sqlTotalPesos('importe','moneda','tasa_cambio')} ELSE 0 END) AS total_pagado
      FROM pagos_factura_compra GROUP BY factura_id
    ) pag ON pag.factura_id = f.id
    LEFT JOIN (
      SELECT nc_factura_id, SUM(ABS(${sqlTotalPesos('importe','moneda','tasa_cambio')})) AS total_nc
      FROM facturas_compra WHERE nc_factura_id IS NOT NULL GROUP BY nc_factura_id
    ) nc ON nc.nc_factura_id = f.id
    WHERE f.pago_confirmado = 0 AND f.tipo_factura NOT LIKE 'NC%'
      AND MAX(0, ${sqlTotalPesos('f.importe', 'f.moneda', 'f.tasa_cambio')} - COALESCE(pag.total_pagado, 0) - COALESCE(nc.total_nc, 0)) > 0.01
    ORDER BY CASE WHEN f.fecha_vencimiento IS NULL OR f.fecha_vencimiento = '' THEN '9999' ELSE f.fecha_vencimiento END ASC
    LIMIT 30
  `).all()

  const facturasPorCobrar = db.prepare(`
    SELECT f.id, f.numero, f.cliente_nombre as nombre, f.fecha, f.fecha_vencimiento,
      f.importe, f.moneda, f.tasa_cambio,
      COALESCE(pag.total_pagado, 0) as total_pagado,
      MAX(0, ${sqlTotalPesos('f.importe', 'f.moneda', 'f.tasa_cambio')} - COALESCE(pag.total_pagado, 0) - COALESCE(nc.total_nc, 0)) as saldo_pesos
    FROM facturas_venta f
    LEFT JOIN (
      SELECT factura_id, SUM(CASE WHEN estado='confirmado' OR forma_pago='e-cheq' THEN ${sqlTotalPesos('importe','moneda','tasa_cambio')}+COALESCE(ret_iibb,0)+COALESCE(ret_iva,0)+COALESCE(ret_gcia,0)+COALESCE(ret_contratista,0)+COALESCE(ret_ss,0) ELSE 0 END) AS total_pagado
      FROM pagos_factura_venta GROUP BY factura_id
    ) pag ON pag.factura_id = f.id
    LEFT JOIN (
      SELECT nc_factura_id, SUM(ABS(${sqlTotalPesos('importe','moneda','tasa_cambio')})) AS total_nc
      FROM facturas_venta WHERE nc_factura_id IS NOT NULL GROUP BY nc_factura_id
    ) nc ON nc.nc_factura_id = f.id
    WHERE f.pago_confirmado = 0 AND f.tipo_factura NOT LIKE 'NC%'
      AND MAX(0, ${sqlTotalPesos('f.importe', 'f.moneda', 'f.tasa_cambio')} - COALESCE(pag.total_pagado, 0) - COALESCE(nc.total_nc, 0)) > 0.01
    ORDER BY CASE WHEN f.fecha_vencimiento IS NULL OR f.fecha_vencimiento = '' THEN '9999' ELSE f.fecha_vencimiento END ASC
    LIMIT 30
  `).all()

  // Idem: una factura con vencimiento próximo pero ya anulada del todo por
  // una NC no es un vencimiento real — no hay nada que pagar/cobrar en esa fecha.
  const vencimientosProximos = db.prepare(`
    SELECT 'compra' as tipo, f.id, f.numero, f.proveedor_nombre as nombre, f.importe, f.moneda, f.tasa_cambio, f.fecha_vencimiento
    FROM facturas_compra f
    LEFT JOIN (
      SELECT nc_factura_id, SUM(ABS(${sqlTotalPesos('importe','moneda','tasa_cambio')})) AS total_nc
      FROM facturas_compra WHERE nc_factura_id IS NOT NULL GROUP BY nc_factura_id
    ) nc ON nc.nc_factura_id = f.id
    WHERE f.pago_confirmado=0 AND f.tipo_factura NOT LIKE 'NC%'
      AND f.fecha_vencimiento >= ? AND f.fecha_vencimiento <= date(?, '+7 days')
      AND COALESCE(nc.total_nc, 0) < ${sqlTotalPesos('f.importe', 'f.moneda', 'f.tasa_cambio')} - 0.01
    UNION ALL
    SELECT 'venta', f.id, f.numero, f.cliente_nombre, f.importe, f.moneda, f.tasa_cambio, f.fecha_vencimiento
    FROM facturas_venta f
    LEFT JOIN (
      SELECT nc_factura_id, SUM(ABS(${sqlTotalPesos('importe','moneda','tasa_cambio')})) AS total_nc
      FROM facturas_venta WHERE nc_factura_id IS NOT NULL GROUP BY nc_factura_id
    ) nc ON nc.nc_factura_id = f.id
    WHERE f.pago_confirmado=0 AND f.tipo_factura NOT LIKE 'NC%'
      AND f.fecha_vencimiento >= ? AND f.fecha_vencimiento <= date(?, '+7 days')
      AND COALESCE(nc.total_nc, 0) < ${sqlTotalPesos('f.importe', 'f.moneda', 'f.tasa_cambio')} - 0.01
    ORDER BY fecha_vencimiento ASC LIMIT 10
  `).all(hoy, hoy, hoy, hoy)

  // E-CHEQs emitidos pendientes de confirmación por Finanzas
  const echeqsEmitidos = db.prepare(`
    SELECT pfc.id, pfc.factura_id, pfc.fecha, pfc.fecha_acreditacion, pfc.entidad, pfc.importe, pfc.moneda,
      fc.proveedor_nombre, fc.numero as factura_numero
    FROM pagos_factura_compra pfc
    JOIN facturas_compra fc ON fc.id = pfc.factura_id
    WHERE pfc.forma_pago = 'e-cheq' AND pfc.estado = 'pendiente'
    ORDER BY
      CASE WHEN pfc.fecha_acreditacion = '' OR pfc.fecha_acreditacion IS NULL THEN 1 ELSE 0 END,
      pfc.fecha_acreditacion ASC
  `).all()

  // E-CHEQs recibidos (de clientes, al cobrar una factura de venta) pendientes
  // de acreditación — mismo mecanismo que los emitidos, del otro lado.
  const echeqsRecibidos = db.prepare(`
    SELECT pfv.id, pfv.factura_id, pfv.fecha, pfv.fecha_acreditacion, pfv.entidad, pfv.importe, pfv.moneda,
      fv.cliente_nombre, fv.numero as factura_numero
    FROM pagos_factura_venta pfv
    JOIN facturas_venta fv ON fv.id = pfv.factura_id
    WHERE pfv.forma_pago = 'e-cheq' AND pfv.estado = 'pendiente'
    ORDER BY
      CASE WHEN pfv.fecha_acreditacion = '' OR pfv.fecha_acreditacion IS NULL THEN 1 ELSE 0 END,
      pfv.fecha_acreditacion ASC
  `).all()

  // Último tipo de cambio BNA registrado
  const tipoCambioBNA = db.prepare(`
    SELECT tc.valor, tc.fecha, tc.moneda, tc.fuente, tc.created_at, u.nombre as usuario_nombre
    FROM tipo_cambio tc LEFT JOIN usuarios u ON u.id = tc.created_by
    WHERE tc.moneda = 'DÓLAR'
    ORDER BY tc.created_at DESC, tc.id DESC LIMIT 1
  `).get() || null

  // IVA acumulado: mes actual + 2 anteriores
  const ivaData = [0, 1, 2].map(i => {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - i)
    const mes = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
    const label = d.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })
    // iva_21/iva_10_5/iva_27/perc_iva se cargan en la moneda propia de la factura,
    // no siempre en pesos — sin convertir, una factura en USD sumaba su IVA en
    // dólares como si fueran pesos, subestimando el IVA acumulado del mes.
    const ic = db.prepare(`
      SELECT
        COALESCE(SUM(${sqlTotalPesos('(iva_21 + iva_10_5 + iva_27)', 'moneda', 'tasa_cambio')}), 0) as iva_base,
        COALESCE(SUM(${sqlTotalPesos('perc_iva', 'moneda', 'tasa_cambio')}), 0) as percepciones
      FROM facturas_compra WHERE strftime('%Y-%m', fecha) = ?
    `).get(mes)
    const iv = db.prepare(`
      SELECT COALESCE(SUM(${sqlTotalPesos('(iva_21 + iva_10_5)', 'moneda', 'tasa_cambio')}), 0) as total
      FROM facturas_venta WHERE strftime('%Y-%m', fecha) = ?
    `).get(mes)
    return { mes, label, iva_compras: ic.iva_base, perc_iva_compras: ic.percepciones, iva_ventas: iv.total }
  })

  return { saldosBancarios, serviciosPendientes, serviciosMes, comprasPendientes, ventasPendientes, facturasPorPagar, facturasPorCobrar, vencimientosProximos, echeqsEmitidos, echeqsRecibidos, ivaData, tipoCambioBNA }
}

router.get('/dashboard-diario', verificarToken, leerFinanzas, (req, res) => {
  res.json(obtenerDashboardDiario())
})

// ── Cuentas ────────────────────────────────────────────────────────────────────

router.get('/cuentas', verificarToken, leerFinanzas, (req, res) => {
  const cuentas = db.prepare('SELECT * FROM cuentas_financieras WHERE activa=1 ORDER BY nombre').all();
  // Una sola consulta agregada para todas las cuentas, en vez de una por
  // cuenta (N+1) — cada movimiento_caja se recorre una sola vez.
  const movsPorCuenta = Object.fromEntries(
    db.prepare(`
      SELECT cuenta_id,
        COALESCE(SUM(CASE WHEN tipo='Ingreso' THEN monto ELSE 0 END),0) as ing,
        COALESCE(SUM(CASE WHEN tipo='Egreso' THEN monto ELSE 0 END),0) as egr
      FROM movimientos_caja WHERE estado='Confirmado' GROUP BY cuenta_id
    `).all().map(m => [m.cuenta_id, m])
  );
  const result = cuentas.map(c => {
    const mov = movsPorCuenta[c.id] || { ing: 0, egr: 0 };
    return { ...c, saldo_actual: c.saldo_inicial + mov.ing - mov.egr };
  });
  res.json(result);
});

router.post('/cuentas', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const { nombre, tipo, moneda, saldo_inicial } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    const r = db.prepare('INSERT INTO cuentas_financieras (nombre,tipo,moneda,saldo_inicial) VALUES (?,?,?,?)')
      .run(nombre.trim(), tipo||'Caja', moneda||'ARS', parseFloat(saldo_inicial)||0);
    res.status(201).json(db.prepare('SELECT * FROM cuentas_financieras WHERE id=?').get(r.lastInsertRowid));
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'La cuenta ya existe' });
    throw e;
  }
});

router.put('/cuentas/:id', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const c = db.prepare('SELECT * FROM cuentas_financieras WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Cuenta no encontrada' });
  const { nombre, tipo, moneda, saldo_inicial } = req.body;
  try {
    db.prepare('UPDATE cuentas_financieras SET nombre=?,tipo=?,moneda=?,saldo_inicial=? WHERE id=?')
      .run(nombre??c.nombre, tipo??c.tipo, moneda??c.moneda, saldo_inicial!=null ? parseFloat(saldo_inicial)||0 : c.saldo_inicial, req.params.id);
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'La cuenta ya existe' });
    throw e;
  }
  res.json(db.prepare('SELECT * FROM cuentas_financieras WHERE id=?').get(req.params.id));
});

// ── Categorías ────────────────────────────────────────────────────────────────

router.get('/categorias', verificarToken, leerFinanzas, (req, res) => {
  const { tipo } = req.query;
  const where = tipo ? 'WHERE tipo=?' : '';
  res.json(db.prepare(`SELECT * FROM categorias_financieras ${where} ORDER BY tipo,nombre`).all(...(tipo?[tipo]:[])));
});

router.post('/categorias', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const { nombre, tipo, color } = req.body;
  try {
    const r = db.prepare('INSERT INTO categorias_financieras (nombre,tipo,color) VALUES (?,?,?)').run(nombre, tipo||'Egreso', color||'#6c7086');
    res.status(201).json(db.prepare('SELECT * FROM categorias_financieras WHERE id=?').get(r.lastInsertRowid));
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Ya existe' });
    throw e;
  }
});

router.delete('/categorias/:id', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  db.prepare('DELETE FROM categorias_financieras WHERE id=?').run(req.params.id);
  res.json({ mensaje: 'Eliminada' });
});

// ── Movimientos ────────────────────────────────────────────────────────────────

router.get('/movimientos', verificarToken, leerFinanzas, (req, res) => {
  const { cuenta_id, tipo, categoria, estado, desde, hasta, buscar, page=1, limit=100 } = req.query;
  const conds=[], params=[];
  if (cuenta_id) { conds.push('cuenta_id=?');  params.push(cuenta_id); }
  if (tipo)      { conds.push('tipo=?');        params.push(tipo); }
  if (categoria) { conds.push('categoria=?');   params.push(categoria); }
  if (estado)    { conds.push('estado=?');      params.push(estado); }
  if (desde)     { conds.push('fecha>=?');       params.push(desde); }
  if (hasta)     { conds.push('fecha<=?');       params.push(hasta); }
  if (buscar)    { const b = buscarCondicion(buscar, ['descripcion','referencia']); conds.push(b.cond); params.push(...b.params); }
  const where     = conds.length ? 'WHERE '+conds.join(' AND ') : '';
  const pageNum   = Math.max(1, parseInt(page) || 1);
  const limitNum  = Math.min(500, Math.max(1, parseInt(limit) || 100));
  const offset    = (pageNum-1)*limitNum;
  const total  = db.prepare(`SELECT COUNT(*) as c FROM movimientos_caja ${where}`).get(...params).c;
  const datos  = db.prepare(`SELECT * FROM movimientos_caja ${where} ORDER BY fecha DESC,id DESC LIMIT ? OFFSET ?`).all(...params, limitNum, offset);
  res.json({ total, datos });
});

router.post('/movimientos', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const { fecha, tipo, categoria, descripcion, monto, moneda, tasa_cambio, cuenta_id, cuenta_nombre, referencia, forma_pago, estado, doc_tipo, doc_id, observaciones } = req.body;
  if (!fecha || !tipo || !descripcion?.trim()) return res.status(400).json({ error: 'Fecha, tipo y descripción son requeridos' });
  if (!parseFloat(monto) || parseFloat(monto) <= 0) return res.status(400).json({ error: 'Monto debe ser mayor a 0' });
  const r = db.prepare('INSERT INTO movimientos_caja (fecha,tipo,categoria,descripcion,monto,moneda,tasa_cambio,cuenta_id,cuenta_nombre,referencia,forma_pago,estado,doc_tipo,doc_id,observaciones,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(fecha, tipo, categoria||'', descripcion.trim(), parseFloat(monto), moneda||'ARS', parseFloat(tasa_cambio)||1,
         cuenta_id||null, cuenta_nombre||'', referencia||'', forma_pago||'Transferencia',
         estado||'Confirmado', doc_tipo||'', doc_id||null, observaciones||'', req.usuario.id);
  res.status(201).json(db.prepare('SELECT * FROM movimientos_caja WHERE id=?').get(r.lastInsertRowid));
});

router.put('/movimientos/:id', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const m = db.prepare('SELECT * FROM movimientos_caja WHERE id=?').get(req.params.id);
  if (!m) return res.status(404).json({ error: 'No encontrado' });
  if (m.estado === 'Anulado') return res.status(400).json({ error: 'No se puede editar un movimiento anulado' });
  const { fecha, tipo, categoria, descripcion, monto, moneda, tasa_cambio, cuenta_id, cuenta_nombre, referencia, forma_pago, estado, observaciones } = req.body;
  db.prepare('UPDATE movimientos_caja SET fecha=?,tipo=?,categoria=?,descripcion=?,monto=?,moneda=?,tasa_cambio=?,cuenta_id=?,cuenta_nombre=?,referencia=?,forma_pago=?,estado=?,observaciones=? WHERE id=?')
    .run(fecha??m.fecha, tipo??m.tipo, categoria??m.categoria, descripcion??m.descripcion,
         parseFloat(monto??m.monto), moneda??m.moneda, parseFloat(tasa_cambio??m.tasa_cambio),
         cuenta_id??m.cuenta_id, cuenta_nombre??m.cuenta_nombre, referencia??m.referencia,
         forma_pago??m.forma_pago, estado??m.estado, observaciones??m.observaciones, req.params.id);
  res.json(db.prepare('SELECT * FROM movimientos_caja WHERE id=?').get(req.params.id));
});

router.post('/movimientos/:id/anular', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  db.prepare("UPDATE movimientos_caja SET estado='Anulado' WHERE id=?").run(req.params.id);
  res.json({ mensaje: 'Movimiento anulado' });
});

router.delete('/movimientos/:id', verificarToken, (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Solo admins pueden eliminar movimientos' });
  db.prepare('DELETE FROM movimientos_caja WHERE id=?').run(req.params.id);
  res.json({ mensaje: 'Eliminado' });
});

// ── Resumen / KPIs ────────────────────────────────────────────────────────────

router.get('/resumen/mes', verificarToken, leerFinanzas, (req, res) => {
  const hoy  = new Date();
  const año  = parseInt(req.query.año)  || hoy.getFullYear();
  const mes  = parseInt(req.query.mes)  || hoy.getMonth()+1;
  const desde = `${año}-${String(mes).padStart(2,'0')}-01`;
  const hasta = `${año}-${String(mes).padStart(2,'0')}-31`;
  const row = db.prepare(`SELECT COALESCE(SUM(CASE WHEN tipo='Ingreso' AND estado='Confirmado' THEN monto ELSE 0 END),0) as ingresos, COALESCE(SUM(CASE WHEN tipo='Egreso' AND estado='Confirmado' THEN monto ELSE 0 END),0) as egresos, COALESCE(SUM(CASE WHEN tipo='Ingreso' AND estado='Pendiente' THEN monto ELSE 0 END),0) as ing_pendiente, COALESCE(SUM(CASE WHEN tipo='Egreso' AND estado='Pendiente' THEN monto ELSE 0 END),0) as egr_pendiente FROM movimientos_caja WHERE fecha BETWEEN ? AND ? AND moneda='ARS'`).get(desde, hasta);
  res.json(row);
});

router.get('/exportar', verificarToken, leerFinanzas, puedeExportarFinanzas, (req, res) => {
  const { desde, hasta } = req.query;
  const conds=['1=1'], params=[];
  if (desde) { conds.push('fecha>=?'); params.push(desde); }
  if (hasta)  { conds.push('fecha<=?'); params.push(hasta); }
  const movs = db.prepare(`SELECT * FROM movimientos_caja WHERE ${conds.join(' AND ')} ORDER BY fecha DESC`).all(...params);
  const ws = XLSX.utils.json_to_sheet(movs.map(m => ({
    'Fecha': m.fecha, 'Tipo': m.tipo, 'Categoría': m.categoria,
    'Descripción': m.descripcion, 'Monto': m.monto, 'Moneda': m.moneda,
    'Cuenta': m.cuenta_nombre, 'Referencia': m.referencia,
    'Forma pago': m.forma_pago, 'Estado': m.estado,
  })));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Finanzas');
  const buf = XLSX.write(wb, { type:'buffer', bookType:'xlsx' });
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition',`attachment; filename=finanzas_${new Date().toISOString().slice(0,10)}.xlsx`);
  res.send(buf);
});

// ── Facturas de Compra ────────────────────────────────────────────────────────

function recalcPagoFC(facturaId) {
  const total = db.prepare(`
    SELECT COALESCE(SUM(CASE WHEN estado='confirmado' OR forma_pago='e-cheq' THEN ${sqlTotalPesos('importe','moneda','tasa_cambio')} ELSE 0 END),0) AS total
    FROM pagos_factura_compra WHERE factura_id=?`).get(facturaId).total;
  const f = db.prepare('SELECT importe,moneda,tasa_cambio FROM facturas_compra WHERE id=?').get(facturaId);
  if (!f) return;
  // Una Nota de Crédito vinculada también reduce lo que realmente se debe —
  // sin restarla acá, una factura saldada por pago+NC combinados nunca pasa a
  // "Pagada" (el listado sí resta la NC al mostrar el saldo, pero este flag
  // guardado quedaba desactualizado por no recalcularse al cargar la NC).
  // Solo se resta si YA hubo algún pago real: una factura anulada del todo por
  // NC sin ningún pago no es "pagada", es "anulada" (nunca se cobró nada).
  const totalNc = total > 0 ? db.prepare(`
    SELECT COALESCE(SUM(ABS(${sqlTotalPesos('importe','moneda','tasa_cambio')})),0) AS s
    FROM facturas_compra WHERE nc_factura_id=?`).get(facturaId).s : 0;
  const saldo = Math.max(0, totalEnPesos(f) - total - totalNc);
  const pagado = saldo <= TOLERANCIA_SALDO_PESOS ? 1 : 0;
  db.prepare("UPDATE facturas_compra SET pago_confirmado=?,updated_at=datetime('now','localtime') WHERE id=?").run(pagado, facturaId);
}

router.get('/facturas-compra', verificarToken, leerFinanzasOAdministracion, (req, res) => {
  const { buscar, desde, hasta, moneda, pago, conOc } = req.query;

  const conds = [];
  const params = [];
  if (desde)  { conds.push('f.fecha >= ?'); params.push(desde); }
  if (hasta)  { conds.push('f.fecha <= ?'); params.push(hasta); }
  if (moneda) { conds.push('f.moneda = ?'); params.push(moneda); }
  if (pago === '1') conds.push('f.pago_confirmado = 1');
  if (pago === '0') conds.push('f.pago_confirmado = 0');
  if (conOc === 'con') conds.push('f.oc_id IS NOT NULL');
  if (conOc === 'sin') conds.push('f.oc_id IS NULL');
  if (buscar) { const b = buscarCondicion(buscar, ['f.numero','f.proveedor_nombre','f.oc_numero']); conds.push(b.cond); params.push(...b.params); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  let result = db.prepare(`
    SELECT 'manual' AS fuente, f.id, f.tipo_factura, f.numero, f.fecha,
      f.proveedor_nombre, f.proveedor_id, f.cuit,
      f.oc_id, COALESCE(f.oc_numero,'') AS ref_doc,
      f.neto_gravado, f.no_grav_exento,
      f.iva_21, f.iva_10_5, f.iva_27, f.otros_imp, f.perc_iva, f.perc_iibb,
      f.importe, f.moneda, f.tasa_cambio, f.fecha_vencimiento, f.pago_confirmado,
      f.anticipo, f.fecha_anticipo, f.observaciones, f.updated_at,
      f.nc_factura_id, rel.numero AS nc_factura_numero, rel.proveedor_nombre AS nc_factura_proveedor,
      COALESCE(pag.total_pagado, 0) AS total_pagado,
      COALESCE(pag.count_pagos,  0) AS count_pagos,
      COALESCE(ncsum.total_nc, 0) AS total_nc, ncsum.nc_numeros
    FROM facturas_compra f
    LEFT JOIN facturas_compra rel ON rel.id = f.nc_factura_id
    LEFT JOIN (
      SELECT factura_id,
        SUM(CASE WHEN estado='confirmado' OR forma_pago='e-cheq' THEN ${sqlTotalPesos('importe','moneda','tasa_cambio')} ELSE 0 END) AS total_pagado,
        COUNT(*) AS count_pagos
      FROM pagos_factura_compra GROUP BY factura_id
    ) pag ON pag.factura_id = f.id
    LEFT JOIN (
      SELECT nc_factura_id, SUM(ABS(${sqlTotalPesos('importe','moneda','tasa_cambio')})) AS total_nc,
        GROUP_CONCAT(numero, ', ') AS nc_numeros
      FROM facturas_compra WHERE nc_factura_id IS NOT NULL GROUP BY nc_factura_id
    ) ncsum ON ncsum.nc_factura_id = f.id
    ${where}
    ORDER BY f.fecha DESC, f.id DESC
  `).all(...params);
  result = result.map(r => {
    const saldoSinNc = r.pago_confirmado ? 0 : Math.max(0, totalEnPesos(r) - (r.total_pagado || 0));
    return {
      ...r,
      saldo_pendiente: Math.max(0, saldoSinNc - (r.total_nc || 0)),
      anulada: !esNC(r.tipo_factura) && r.total_nc > 0 && r.total_nc >= totalEnPesos(r) - 0.01,
    };
  });
  res.json(result);
});

// Excel mensual de Facturas de Compra para el estudio contable (liquidación de
// impuestos) — mismos filtros que el listado, pensado para desde/hasta = un mes.
router.get('/facturas-compra/exportar', verificarToken, leerFinanzasOAdministracion, puedeExportarFinanzasOAdministracion, (req, res) => {
  const { buscar, desde, hasta, moneda, pago, conOc } = req.query;

  const conds = [];
  const params = [];
  if (desde)  { conds.push('f.fecha >= ?'); params.push(desde); }
  if (hasta)  { conds.push('f.fecha <= ?'); params.push(hasta); }
  if (moneda) { conds.push('f.moneda = ?'); params.push(moneda); }
  if (pago === '1') conds.push('f.pago_confirmado = 1');
  if (pago === '0') conds.push('f.pago_confirmado = 0');
  if (conOc === 'con') conds.push('f.oc_id IS NOT NULL');
  if (conOc === 'sin') conds.push('f.oc_id IS NULL');
  if (buscar) { const b = buscarCondicion(buscar, ['f.numero','f.proveedor_nombre','f.oc_numero']); conds.push(b.cond); params.push(...b.params); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT f.tipo_factura, f.numero, f.fecha, f.proveedor_nombre, f.cuit, f.oc_numero,
      f.neto_gravado, f.no_grav_exento, f.iva_21, f.iva_10_5, f.iva_27,
      f.perc_iva, f.perc_iibb, f.otros_imp, f.importe, f.moneda, f.tasa_cambio,
      f.pago_confirmado, f.fecha_vencimiento, f.observaciones
    FROM facturas_compra f
    ${where}
    ORDER BY f.fecha ASC, f.id ASC
  `).all(...params);

  const datos = rows.map(f => ({
    'Fecha': f.fecha,
    'Tipo': f.tipo_factura,
    'N° Factura': f.numero,
    'Proveedor': f.proveedor_nombre,
    'CUIT': f.cuit,
    'N° OC': f.oc_numero || '',
    'Neto Gravado': f.neto_gravado,
    'No Gravado/Exento': f.no_grav_exento,
    'IVA 21%': f.iva_21,
    'IVA 10.5%': f.iva_10_5,
    'IVA 27%': f.iva_27,
    'Percepción IVA': f.perc_iva,
    'Percepción IIBB': f.perc_iibb,
    'Otros Impuestos': f.otros_imp,
    'Importe Total': f.importe,
    'Moneda': f.moneda,
    'Tasa de Cambio': f.moneda === 'PESO' || f.moneda === 'PESOS' ? '' : f.tasa_cambio,
    'Total en Pesos': totalEnPesos(f),
    'Estado de Pago': f.pago_confirmado ? 'Pagada' : 'Pendiente',
    'Fecha Vencimiento': f.fecha_vencimiento || '',
    'Observaciones': f.observaciones || '',
  }));

  const ws = XLSX.utils.json_to_sheet(datos);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Facturas de Compra');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const nombre = desde && hasta ? `facturas_compra_${desde}_a_${hasta}.xlsx` : `facturas_compra_${new Date().toISOString().slice(0,10)}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename=${nombre}`);
  res.send(buf);
});

// ── Comparar contra "Mis Comprobantes Recibidos" (ARCA) ─────────────────────────
// El usuario baja de ARCA el Excel oficial de comprobantes recibidos para el
// CUIT de la empresa y lo sube acá — se compara contra facturas_compra y se
// listan diferencias (nunca se carga nada automáticamente, es solo el reporte).

const uploadArca = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /\.xlsx?$/i.test(file.originalname || '') ||
      ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'].includes(file.mimetype);
    cb(null, ok);
  },
});

function normalizarHeaderArca(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

// Las fechas de ARCA pueden llegar como Date (si el lector interpreta la celda
// como fecha), como número de serie de Excel, o como texto "DD/MM/YYYY".
function excelFechaAIso(val) {
  if (val == null || val === '') return '';
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  if (typeof val === 'number') {
    const d = XLSX.SSF.parse_date_code(val);
    return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : '';
  }
  const s = String(val).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return '';
}

// Los importes pueden venir ya numéricos (xlsx real) o como texto en formato
// AR ("1.234,56") si la celda quedó formateada como texto.
function parseNumeroArca(val) {
  if (val == null || val === '') return 0;
  if (typeof val === 'number') return val;
  const s = String(val).trim();
  if (!s) return 0;
  if (/,\d{1,2}$/.test(s)) return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
  return parseFloat(s.replace(/,/g, '')) || 0;
}

const soloDigitos = s => String(s || '').replace(/\D/g, '');

// "0004-00012345" (sistema) o "4-12345" (armado desde ARCA) → "4-12345", para
// poder comparar sin que distintos criterios de relleno con ceros den falsos
// positivos de "factura faltante".
function numeroCanonico(numero) {
  const parts = String(numero || '').split('-');
  if (parts.length !== 2) return soloDigitos(numero);
  return `${parseInt(parts[0], 10) || 0}-${parseInt(parts[1], 10) || 0}`;
}

router.post('/facturas-compra/comparar-arca', verificarToken, leerFinanzasOAdministracion, uploadArca.single('archivo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Falta el archivo (.xlsx de "Mis Comprobantes Recibidos" de ARCA)' });

  let filas;
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    filas = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  } catch (e) {
    return res.status(400).json({ error: 'No se pudo leer el archivo. ¿Es un .xlsx válido?' });
  }

  // Busca la fila de encabezados entre las primeras filas (ARCA agrega un
  // título arriba, tipo "Mis Comprobantes Recibidos - CUIT ...").
  let cols = null;
  for (let i = 0; i < Math.min(filas.length, 10); i++) {
    const norm = (filas[i] || []).map(normalizarHeaderArca);
    if (norm.includes('fecha') && norm.includes('tipo')) {
      const idx = nombre => norm.indexOf(nombre);
      cols = {
        headerIdx: i,
        fecha: idx('fecha'), tipo: idx('tipo'),
        puntoVenta: idx('punto de venta'), numeroDesde: idx('numero desde'),
        cuitEmisor: idx('nro doc emisor'), proveedor: idx('denominacion emisor'),
        moneda: idx('moneda'), tasaCambio: idx('tipo cambio'),
        impTotal: idx('imp total'),
      };
      break;
    }
  }
  if (!cols || cols.impTotal < 0 || cols.puntoVenta < 0 || cols.numeroDesde < 0) {
    return res.status(400).json({ error: 'No se encontraron las columnas esperadas ("Fecha", "Punto de Venta", "Número Desde", "Imp. Total"...) — ¿es el archivo de "Mis Comprobantes Recibidos" de ARCA?' });
  }

  const FECHA_DATOS_CONFIABLES = '2026-07-01';
  const arcaTodas = filas.slice(cols.headerIdx + 1)
    .filter(f => f.length && f[cols.fecha] !== '')
    .map(f => {
      const puntoVenta = parseInt(f[cols.puntoVenta], 10) || 0;
      const numeroDesde = parseInt(f[cols.numeroDesde], 10) || 0;
      return {
        fecha: excelFechaAIso(f[cols.fecha]),
        tipo: String(f[cols.tipo] || '').trim(),
        numero: `${puntoVenta}-${numeroDesde}`,
        cuit: soloDigitos(f[cols.cuitEmisor]),
        proveedor: String(f[cols.proveedor] || '').trim(),
        moneda: /usd|dolar|dólar/i.test(String(f[cols.moneda] || '')) ? 'DÓLAR' : 'PESO',
        tasa_cambio: parseNumeroArca(f[cols.tasaCambio]) || 1,
        importe: parseNumeroArca(f[cols.impTotal]),
      };
    })
    .filter(r => r.fecha && r.numero !== '0-0');

  // Los comprobantes de antes del 01/07/2026 no se evalúan — el sistema para
  // esas fechas viene de una migración de planillas viejas, no confiable para
  // detectar diferencias (mismo criterio que Control OC / "OC sin factura").
  const excluidasViejas = arcaTodas.filter(r => r.fecha < FECHA_DATOS_CONFIABLES).length;
  const arca = arcaTodas.filter(r => r.fecha >= FECHA_DATOS_CONFIABLES);

  if (arca.length === 0) {
    return res.json({ desde: null, hasta: null, excluidasViejas, totalArca: 0, totalSistema: 0, coinciden: 0, faltantes: [], diferencias: [], sobrantes: [] });
  }

  const desde = arca.reduce((m, r) => (r.fecha < m ? r.fecha : m), arca[0].fecha);
  const hasta = arca.reduce((m, r) => (r.fecha > m ? r.fecha : m), arca[0].fecha);

  const sistema = db.prepare(`
    SELECT id, numero, proveedor_nombre, cuit, fecha, importe, moneda, tasa_cambio, tipo_factura
    FROM facturas_compra WHERE ${sqlFechaIso('fecha')} >= ? AND ${sqlFechaIso('fecha')} <= ?
  `).all(desde, hasta);

  const porClave = new Map();   // "cuit|numero_canonico" -> fila del sistema
  const porNumero = new Map();  // "numero_canonico" -> [filas del sistema] (respaldo si el CUIT no coincide/falta)
  for (const s of sistema) {
    const numCanon = numeroCanonico(s.numero);
    porClave.set(`${soloDigitos(s.cuit)}|${numCanon}`, s);
    if (!porNumero.has(numCanon)) porNumero.set(numCanon, []);
    porNumero.get(numCanon).push(s);
  }

  const totalArcaEnPesos = a => (a.moneda === 'DÓLAR' ? a.importe * (a.tasa_cambio || 1) : a.importe);

  const usados = new Set();
  const faltantes = [];
  const diferencias = [];
  for (const a of arca) {
    const numCanon = numeroCanonico(a.numero);
    let match = porClave.get(`${a.cuit}|${numCanon}`);
    if (!match) match = (porNumero.get(numCanon) || []).find(c => !usados.has(c.id)) || null;
    if (!match) { faltantes.push(a); continue; }
    usados.add(match.id);

    const impArca = totalArcaEnPesos(a);
    const impSistema = totalEnPesos(match);
    const tolerancia = Math.max(1, impSistema * 0.005);
    if (Math.abs(impArca - impSistema) > tolerancia) {
      diferencias.push({
        factura_id: match.id, numero: match.numero, proveedor: match.proveedor_nombre || a.proveedor,
        fecha: match.fecha, importe_arca: impArca, importe_sistema: impSistema, diferencia: impArca - impSistema,
      });
    }
  }
  const sobrantes = sistema.filter(s => !usados.has(s.id)).map(s => ({
    factura_id: s.id, numero: s.numero, proveedor: s.proveedor_nombre, fecha: s.fecha,
    importe: totalEnPesos(s), tipo_factura: s.tipo_factura,
  }));

  res.json({
    desde, hasta, excluidasViejas,
    totalArca: arca.length, totalSistema: sistema.length,
    coinciden: arca.length - faltantes.length - diferencias.length,
    faltantes, diferencias, sobrantes,
  });
});

router.post('/facturas-compra', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const { tipo_factura, numero, fecha, proveedor_id, proveedor_nombre, cuit, oc_id, oc_numero,
          neto_gravado, no_grav_exento, iva_21, iva_10_5, iva_27, otros_imp, perc_iva, perc_iibb,
          importe, moneda, tasa_cambio, fecha_vencimiento, observaciones, nc_factura_id } = req.body;
  if (!numero?.trim()) return res.status(400).json({ error: 'Número requerido' });
  const errMonto = validarMontosFactura(req.body, CAMPOS_MONTO_FACTURA_COMPRA);
  if (errMonto) return res.status(400).json({ error: errMonto });
  const nc = resolverNcFacturaId('facturas_compra', tipo_factura, nc_factura_id, null);
  if (!nc.ok) return res.status(400).json({ error: nc.error });
  const r = db.prepare(`INSERT INTO facturas_compra
    (tipo_factura,numero,fecha,proveedor_id,proveedor_nombre,cuit,oc_id,oc_numero,
     neto_gravado,no_grav_exento,iva_21,iva_10_5,iva_27,otros_imp,perc_iva,perc_iibb,
     importe,moneda,tasa_cambio,fecha_vencimiento,observaciones,nc_factura_id,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(tipo_factura||'A', numero.trim(), fecha||'', proveedor_id||null, proveedor_nombre||'', cuit||'',
         oc_id||null, oc_numero||'',
         parseFloat(neto_gravado)||0, parseFloat(no_grav_exento)||0,
         parseFloat(iva_21)||0, parseFloat(iva_10_5)||0, parseFloat(iva_27)||0,
         parseFloat(otros_imp)||0, parseFloat(perc_iva)||0, parseFloat(perc_iibb)||0,
         parseFloat(importe)||0, moneda||'PESO', parseFloat(tasa_cambio)||1,
         fecha_vencimiento||'', observaciones||'', nc.id, req.usuario.id);
  if (nc.id) recalcPagoFC(nc.id);
  res.status(201).json(db.prepare('SELECT * FROM facturas_compra WHERE id=?').get(r.lastInsertRowid));
});

router.put('/facturas-compra/:id', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const f = db.prepare('SELECT * FROM facturas_compra WHERE id=?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'No encontrada' });
  const { tipo_factura, numero, fecha, proveedor_id, proveedor_nombre, cuit, oc_id, oc_numero,
          neto_gravado, no_grav_exento, iva_21, iva_10_5, iva_27, otros_imp, perc_iva, perc_iibb,
          importe, moneda, tasa_cambio, fecha_vencimiento, observaciones, nc_factura_id } = req.body;
  const errMonto = validarMontosFactura(req.body, CAMPOS_MONTO_FACTURA_COMPRA, tipo_factura ?? f.tipo_factura);
  if (errMonto) return res.status(400).json({ error: errMonto });
  const nc = resolverNcFacturaId('facturas_compra', tipo_factura??f.tipo_factura, nc_factura_id===undefined ? f.nc_factura_id : nc_factura_id, f.id);
  if (!nc.ok) return res.status(400).json({ error: nc.error });
  db.prepare(`UPDATE facturas_compra SET
    tipo_factura=?,numero=?,fecha=?,proveedor_id=?,proveedor_nombre=?,cuit=?,oc_id=?,oc_numero=?,
    neto_gravado=?,no_grav_exento=?,iva_21=?,iva_10_5=?,iva_27=?,otros_imp=?,perc_iva=?,perc_iibb=?,
    importe=?,moneda=?,tasa_cambio=?,fecha_vencimiento=?,observaciones=?,nc_factura_id=?,updated_at=datetime('now','localtime')
    WHERE id=?`)
    .run(tipo_factura??f.tipo_factura??'A', numero??f.numero, fecha??f.fecha, proveedor_id||null, proveedor_nombre??f.proveedor_nombre,
         cuit??f.cuit, oc_id||null, oc_numero??f.oc_numero,
         parseFloat(neto_gravado??f.neto_gravado)||0, parseFloat(no_grav_exento??f.no_grav_exento)||0,
         parseFloat(iva_21??f.iva_21)||0, parseFloat(iva_10_5??f.iva_10_5)||0,
         parseFloat(iva_27??f.iva_27)||0,
         parseFloat(otros_imp??f.otros_imp)||0, parseFloat(perc_iva??f.perc_iva)||0,
         parseFloat(perc_iibb??f.perc_iibb)||0,
         parseFloat(importe??f.importe)||0, moneda??f.moneda, parseFloat(tasa_cambio??f.tasa_cambio)||1,
         fecha_vencimiento??f.fecha_vencimiento, observaciones??f.observaciones, nc.id, req.params.id);
  // Si se cambió o quitó a qué factura anula, la anterior también deja de tener
  // esta NC restándole saldo — hay que recalcularla además de la nueva/actual.
  if (f.nc_factura_id && f.nc_factura_id !== nc.id) recalcPagoFC(f.nc_factura_id);
  if (nc.id) recalcPagoFC(nc.id);
  res.json(db.prepare('SELECT * FROM facturas_compra WHERE id=?').get(req.params.id));
});

router.delete('/facturas-compra/:id', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  if (db.prepare('SELECT id FROM facturas_compra WHERE nc_factura_id=?').get(req.params.id)) {
    return res.status(400).json({ error: 'No se puede eliminar: tiene una Nota de Crédito que la anula' });
  }
  if (db.prepare('SELECT id FROM oc_compra_cuotas WHERE factura_id=?').get(req.params.id)) {
    return res.status(400).json({ error: 'No se puede eliminar: está vinculada a una cuota de facturación de una OC' });
  }
  const borrada = db.prepare('SELECT nc_factura_id FROM facturas_compra WHERE id=?').get(req.params.id);
  db.prepare('DELETE FROM facturas_compra WHERE id=?').run(req.params.id);
  if (borrada?.nc_factura_id) recalcPagoFC(borrada.nc_factura_id);
  res.json({ mensaje: 'Eliminada' });
});

router.patch('/facturas-compra/pago', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const { id, pago_confirmado } = req.body;
  const val = pago_confirmado ? 1 : 0;
  if (!db.prepare('SELECT id FROM facturas_compra WHERE id=?').get(id)) return res.status(404).json({ error: 'Factura no encontrada' });
  db.prepare("UPDATE facturas_compra SET pago_confirmado=?, anticipo=0, fecha_anticipo='', updated_at=datetime('now','localtime') WHERE id=?").run(val, id);
  res.json({ ok: true });
});

router.patch('/facturas-compra/reabrir', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const { id } = req.body;
  if (!db.prepare('SELECT id FROM facturas_compra WHERE id=?').get(id)) return res.status(404).json({ error: 'Factura no encontrada' });
  db.prepare("UPDATE facturas_compra SET pago_confirmado=0, updated_at=datetime('now','localtime') WHERE id=?").run(id);
  res.json({ ok: true });
});

router.patch('/facturas-compra/:id/anticipo', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const f = db.prepare('SELECT moneda, tasa_cambio FROM facturas_compra WHERE id=?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'No encontrada' });
  const { anticipo, fecha_anticipo } = req.body;
  const monto = parseFloat(anticipo) || 0;
  // Un anticipo se registra directo como pago confirmado (entra a Tesorería
  // ya efectivizado) — le aplica el mismo umbral que a cualquier otro pago.
  let autorizante = null;
  if (monto > 0) {
    const r = resolverAutorizantePago({ importe: monto, moneda: f.moneda, tasa_cambio: f.tasa_cambio }, req.body);
    if (!r.ok) return res.status(400).json(r);
    autorizante = r.autorizante;
  }
  // El anticipo también se registra como un pago real (tipo 'anticipo') — de lo
  // contrario queda en una columna que el cálculo de saldo (recalcPagoFC) nunca lee,
  // y la factura puede quedar "trabada" como impaga aunque esté saldada. Las tres
  // escrituras (factura + pago + recálculo) van en una sola transacción — un
  // crash a mitad de camino no puede dejar el anticipo cargado en la factura
  // sin su pago correspondiente (que es lo único que recalcPagoFC de verdad lee).
  let pagoId = null;
  db.transaction(() => {
    db.prepare("UPDATE facturas_compra SET anticipo=?, fecha_anticipo=?, updated_at=datetime('now','localtime') WHERE id=?")
      .run(monto, fecha_anticipo||'', req.params.id);
    if (monto > 0) {
      pagoId = db.prepare(`
        INSERT INTO pagos_factura_compra (factura_id, tipo, forma_pago, importe, moneda, tasa_cambio, fecha, estado, autorizado_por_id, autorizado_por_nombre)
        VALUES (?, 'anticipo', 'transferencia', ?, ?, ?, ?, 'confirmado', ?, ?)
      `).run(req.params.id, monto, f.moneda || 'PESO', f.tasa_cambio || 1, fecha_anticipo || '', autorizante?.id||null, autorizante?.nombre||null).lastInsertRowid;
    }
    recalcPagoFC(req.params.id);
  })();
  if (autorizante && pagoId) notificarAutorizantePago('compra', req.params.id, pagoId, autorizante, req.usuario);
  res.json(db.prepare('SELECT id,pago_confirmado,anticipo,fecha_anticipo FROM facturas_compra WHERE id=?').get(req.params.id));
});

// Lista de quién puede figurar como autorizante de un pago que supera el
// umbral configurado — mismo criterio (admin ∪ gerentes de gerencia) que ya
// usa el selector de autorizante de un retiro de stock.
router.get('/pagos-autorizantes', verificarToken, leerFinanzasOAdministracion, (req, res) => {
  res.json(obtenerAutorizantes());
});

// ── Pagos de facturas de compra ───────────────────────────────────────────────

router.get('/facturas-compra/:id/pagos', verificarToken, leerFinanzasOAdministracion, (req, res) => {
  res.json(db.prepare('SELECT * FROM pagos_factura_compra WHERE factura_id=? ORDER BY fecha,id').all(req.params.id));
});

router.post('/facturas-compra/:id/pagos', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const f = db.prepare('SELECT id FROM facturas_compra WHERE id=?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'Factura no encontrada' });
  const { tipo, forma_pago, entidad, importe, moneda, tasa_cambio, fecha, fecha_acreditacion, observaciones } = req.body;
  if (!parseFloat(importe) || parseFloat(importe) <= 0) return res.status(400).json({ error: 'Importe requerido' });
  if (!fecha) return res.status(400).json({ error: 'Fecha requerida' });
  const estadoFinal = (forma_pago === 'cheque_diferido' || forma_pago === 'e-cheq') ? 'pendiente' : 'confirmado';
  // Un pago puede nacer ya "confirmado" (transferencia/efectivo) sin pasar
  // nunca por /confirmar — el umbral tiene que evaluarse también acá, si no
  // alcanza con cargarlo directo para saltearse el control.
  let autorizante = null;
  if (estadoFinal === 'confirmado') {
    const r0 = resolverAutorizantePago({ importe, moneda, tasa_cambio }, req.body);
    if (!r0.ok) return res.status(400).json(r0);
    autorizante = r0.autorizante;
  }
  const r = db.prepare(`
    INSERT INTO pagos_factura_compra
      (factura_id,tipo,forma_pago,entidad,importe,moneda,tasa_cambio,fecha,fecha_acreditacion,estado,observaciones,created_by,autorizado_por_id,autorizado_por_nombre)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(req.params.id, tipo||'parcial', forma_pago||'transferencia', entidad||'',
         parseFloat(importe), moneda||'PESO', parseFloat(tasa_cambio)||1, fecha, fecha_acreditacion||'',
         estadoFinal, observaciones||'', req.usuario.id, autorizante?.id||null, autorizante?.nombre||null);
  recalcPagoFC(req.params.id);
  if (autorizante) notificarAutorizantePago('compra', req.params.id, r.lastInsertRowid, autorizante, req.usuario);
  res.status(201).json(db.prepare('SELECT * FROM pagos_factura_compra WHERE id=?').get(r.lastInsertRowid));
});

router.patch('/facturas-compra/:id/pagos/:pid', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const p = db.prepare('SELECT * FROM pagos_factura_compra WHERE id=? AND factura_id=?').get(req.params.pid, req.params.id);
  if (!p) return res.status(404).json({ error: 'Pago no encontrado' });
  const { tipo, forma_pago, entidad, importe, moneda, tasa_cambio, fecha, fecha_acreditacion, estado, observaciones } = req.body;
  // Pasar a "confirmado" es la misma acción de tesorería que /confirmar — no
  // se puede colar por esta vía genérica con un permiso más laxo.
  let autorizante = null;
  if (estado === 'confirmado' && p.estado !== 'confirmado') {
    if (!puedeConfirmarPago(req)) return res.status(403).json({ error: 'Solo Finanzas puede confirmar un pago' });
    // El umbral se evalúa contra el importe/moneda que va a quedar guardado
    // (si este mismo PATCH también los está cambiando), no contra el pago
    // viejo — si no, subir el importe y confirmar en el mismo request se
    // colaba sin la autorización que ese monto nuevo exige.
    const pNuevo = { ...p, importe: importe ?? p.importe, moneda: moneda ?? p.moneda, tasa_cambio: tasa_cambio ?? p.tasa_cambio };
    const r = resolverAutorizantePago(pNuevo, req.body);
    if (!r.ok) return res.status(400).json(r);
    autorizante = r.autorizante;
  }
  db.prepare(`UPDATE pagos_factura_compra SET
    tipo=?,forma_pago=?,entidad=?,importe=?,moneda=?,tasa_cambio=?,fecha=?,fecha_acreditacion=?,estado=?,observaciones=?,
    autorizado_por_id=COALESCE(?,autorizado_por_id), autorizado_por_nombre=COALESCE(?,autorizado_por_nombre) WHERE id=?`)
    .run(tipo??p.tipo, forma_pago??p.forma_pago, entidad??p.entidad,
         parseFloat(importe??p.importe)||0, moneda??p.moneda, parseFloat(tasa_cambio??p.tasa_cambio)||1, fecha??p.fecha,
         fecha_acreditacion??p.fecha_acreditacion, estado??p.estado,
         observaciones??p.observaciones, autorizante?.id||null, autorizante?.nombre||null, req.params.pid);
  recalcPagoFC(req.params.id);
  if (autorizante) notificarAutorizantePago('compra', req.params.id, req.params.pid, autorizante, req.usuario);
  res.json(db.prepare('SELECT * FROM pagos_factura_compra WHERE id=?').get(req.params.pid));
});

router.patch('/facturas-compra/:id/pagos/:pid/confirmar', verificarToken, (req, res) => {
  if (!puedeConfirmarPago(req)) return res.status(403).json({ error: 'Sin permisos' });
  const p = db.prepare('SELECT * FROM pagos_factura_compra WHERE id=? AND factura_id=?').get(req.params.pid, req.params.id);
  if (!p) return res.status(404).json({ error: 'Pago no encontrado' });
  let autorizante = null;
  if (p.estado !== 'confirmado') {
    const r = resolverAutorizantePago(p, req.body || {});
    if (!r.ok) return res.status(400).json(r);
    autorizante = r.autorizante;
  }
  db.prepare(`UPDATE pagos_factura_compra SET estado='confirmado',
    autorizado_por_id=COALESCE(?,autorizado_por_id), autorizado_por_nombre=COALESCE(?,autorizado_por_nombre) WHERE id=?`)
    .run(autorizante?.id||null, autorizante?.nombre||null, req.params.pid);
  recalcPagoFC(req.params.id);
  if (autorizante) notificarAutorizantePago('compra', req.params.id, req.params.pid, autorizante, req.usuario);
  res.json(db.prepare('SELECT * FROM pagos_factura_compra WHERE id=?').get(req.params.pid));
});

router.delete('/facturas-compra/:id/pagos/:pid', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  if (!db.prepare('SELECT id FROM pagos_factura_compra WHERE id=? AND factura_id=?').get(req.params.pid, req.params.id))
    return res.status(404).json({ error: 'Pago no encontrado' });
  db.prepare('DELETE FROM pagos_factura_compra WHERE id=?').run(req.params.pid);
  recalcPagoFC(req.params.id);
  res.json({ ok: true });
});

// ── Facturas de Venta ─────────────────────────────────────────────────────────

router.get('/facturas-venta', verificarToken, leerFinanzasOAdministracion, (req, res) => {
  const { buscar, desde, hasta, moneda, pago, proyecto_id, conOc } = req.query;

  const conds = [];
  const params = [];
  if (proyecto_id) { conds.push('fv.proyecto_id = ?'); params.push(proyecto_id); }
  if (desde)  { conds.push('fv.fecha >= ?'); params.push(desde); }
  if (hasta)  { conds.push('fv.fecha <= ?'); params.push(hasta); }
  if (moneda) { conds.push('fv.moneda = ?'); params.push(moneda); }
  if (pago === '1') conds.push('fv.pago_confirmado = 1');
  // Las notas de crédito (NC) nunca quedan "pagadas" (pago_confirmado=0 siempre,
  // no son una factura por cobrar) — no corresponde que aparezcan mezcladas
  // como si fueran facturas pendientes de cobro.
  if (pago === '0') conds.push("fv.pago_confirmado = 0 AND fv.tipo_factura NOT LIKE 'NC%'");
  if (conOc === 'con') conds.push("fv.oc IS NOT NULL AND fv.oc != ''");
  if (conOc === 'sin') conds.push("(fv.oc IS NULL OR fv.oc = '')");
  if (buscar) { const b = buscarCondicion(buscar, ['fv.numero','fv.cliente_nombre','fv.concepto','fv.oc','fv.presupuesto_ref','p.numero']); conds.push(b.cond); params.push(...b.params); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  let rows = db.prepare(`
    SELECT fv.*, p.numero AS ppto_numero, pr.codigo AS proy_codigo, pr.nombre AS proy_nombre,
      c.cuit AS cliente_cuit,
      rel.numero AS nc_factura_numero, rel.cliente_nombre AS nc_factura_cliente,
      COALESCE(pag.total_pagado, 0)  AS total_pagado,
      COALESCE(pag.count_pagos,  0)  AS count_pagos,
      COALESCE(ncsum.total_nc, 0)    AS total_nc, ncsum.nc_numeros
    FROM facturas_venta fv
    LEFT JOIN presupuestos p ON p.id = fv.presupuesto_id
    LEFT JOIN proyectos pr ON pr.id = fv.proyecto_id
    LEFT JOIN clientes c ON c.id = fv.cliente_id
    LEFT JOIN facturas_venta rel ON rel.id = fv.nc_factura_id
    LEFT JOIN (
      SELECT factura_id,
        SUM(CASE WHEN estado='confirmado' OR forma_pago='e-cheq' THEN ${sqlTotalPesos('importe','moneda','tasa_cambio')}+COALESCE(ret_iibb,0)+COALESCE(ret_iva,0)+COALESCE(ret_gcia,0)+COALESCE(ret_contratista,0)+COALESCE(ret_ss,0) ELSE 0 END) AS total_pagado,
        COUNT(*) AS count_pagos
      FROM pagos_factura_venta GROUP BY factura_id
    ) pag ON pag.factura_id = fv.id
    LEFT JOIN (
      SELECT nc_factura_id, SUM(ABS(${sqlTotalPesos('importe','moneda','tasa_cambio')})) AS total_nc,
        GROUP_CONCAT(numero, ', ') AS nc_numeros
      FROM facturas_venta WHERE nc_factura_id IS NOT NULL GROUP BY nc_factura_id
    ) ncsum ON ncsum.nc_factura_id = fv.id
    ${where}
    ORDER BY fv.fecha DESC, fv.id DESC`).all(...params);
  rows = rows.map(r => {
    const saldoSinNc = r.pago_confirmado ? 0 : Math.max(0, totalEnPesos(r) - (r.total_pagado || 0));
    return {
      ...r,
      saldo_pendiente: Math.max(0, saldoSinNc - (r.total_nc || 0)),
      anulada: !esNC(r.tipo_factura) && r.total_nc > 0 && r.total_nc >= totalEnPesos(r) - 0.01,
    };
  });
  res.json(rows);
});

router.post('/facturas-venta', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const { tipo_factura, numero, fecha, cliente_id, cliente_nombre, presupuesto_id, presupuesto_ref,
          concepto, oc, proyecto_id, neto_gravado, iva_21, iva_10_5,
          ret_iibb, ret_iva, ret_gcia, ret_contratista, ret_ss, dif_cambio, total_cobrado,
          importe, moneda, tasa_cambio, fecha_vencimiento, fecha_pago, observaciones, nc_factura_id } = req.body;
  if (!numero?.trim()) return res.status(400).json({ error: 'Número requerido' });
  const errMonto = validarMontosFactura(req.body, CAMPOS_MONTO_FACTURA_VENTA);
  if (errMonto) return res.status(400).json({ error: errMonto });
  const nc = resolverNcFacturaId('facturas_venta', tipo_factura, nc_factura_id, null);
  if (!nc.ok) return res.status(400).json({ error: nc.error });
  const r = db.prepare(`INSERT INTO facturas_venta
    (tipo_factura,numero,fecha,cliente_id,cliente_nombre,presupuesto_id,presupuesto_ref,
     concepto,oc,proyecto_id,neto_gravado,iva_21,iva_10_5,ret_iibb,ret_iva,ret_gcia,ret_contratista,ret_ss,dif_cambio,total_cobrado,
     importe,moneda,tasa_cambio,fecha_vencimiento,fecha_pago,observaciones,nc_factura_id,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(tipo_factura||'A', numero.trim(), fecha||'', cliente_id||null, cliente_nombre||'',
         presupuesto_id||null, presupuesto_ref||'',
         concepto||'', oc||'', proyecto_id||null,
         parseFloat(neto_gravado)||0, parseFloat(iva_21)||0, parseFloat(iva_10_5)||0,
         parseFloat(ret_iibb)||0, parseFloat(ret_iva)||0, parseFloat(ret_gcia)||0,
         parseFloat(ret_contratista)||0, parseFloat(ret_ss)||0,
         parseFloat(dif_cambio)||0, parseFloat(total_cobrado)||0,
         parseFloat(importe)||0, moneda||'PESO', parseFloat(tasa_cambio)||1,
         fecha_vencimiento||'', fecha_pago||'', observaciones||'', nc.id, req.usuario.id);
  if (nc.id) recalcPagoFV(nc.id);
  res.status(201).json(db.prepare('SELECT * FROM facturas_venta WHERE id=?').get(r.lastInsertRowid));
});

router.put('/facturas-venta/:id', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const f = db.prepare('SELECT * FROM facturas_venta WHERE id=?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'No encontrada' });
  const { tipo_factura, numero, fecha, cliente_id, cliente_nombre, presupuesto_id, presupuesto_ref,
          concepto, oc, proyecto_id, neto_gravado, iva_21, iva_10_5,
          ret_iibb, ret_iva, ret_gcia, ret_contratista, ret_ss, dif_cambio, total_cobrado,
          importe, moneda, tasa_cambio, fecha_vencimiento, fecha_pago, observaciones, nc_factura_id } = req.body;
  const errMonto = validarMontosFactura(req.body, CAMPOS_MONTO_FACTURA_VENTA, tipo_factura ?? f.tipo_factura);
  if (errMonto) return res.status(400).json({ error: errMonto });
  const nc = resolverNcFacturaId('facturas_venta', tipo_factura??f.tipo_factura, nc_factura_id===undefined ? f.nc_factura_id : nc_factura_id, f.id);
  if (!nc.ok) return res.status(400).json({ error: nc.error });
  db.prepare(`UPDATE facturas_venta SET
    tipo_factura=?,numero=?,fecha=?,cliente_id=?,cliente_nombre=?,presupuesto_id=?,presupuesto_ref=?,
    concepto=?,oc=?,proyecto_id=?,neto_gravado=?,iva_21=?,iva_10_5=?,ret_iibb=?,ret_iva=?,ret_gcia=?,ret_contratista=?,ret_ss=?,dif_cambio=?,total_cobrado=?,
    importe=?,moneda=?,tasa_cambio=?,fecha_vencimiento=?,fecha_pago=?,observaciones=?,nc_factura_id=?,updated_at=datetime('now','localtime')
    WHERE id=?`)
    .run(tipo_factura??f.tipo_factura??'A', numero??f.numero, fecha??f.fecha,
         cliente_id||null, cliente_nombre??f.cliente_nombre,
         presupuesto_id||null, presupuesto_ref??f.presupuesto_ref,
         concepto??f.concepto??'', oc??f.oc??'', proyecto_id!==undefined ? (proyecto_id||null) : f.proyecto_id,
         parseFloat(neto_gravado??f.neto_gravado)||0, parseFloat(iva_21??f.iva_21)||0, parseFloat(iva_10_5??f.iva_10_5)||0,
         parseFloat(ret_iibb??f.ret_iibb)||0, parseFloat(ret_iva??f.ret_iva)||0,
         parseFloat(ret_gcia??f.ret_gcia)||0, parseFloat(ret_contratista??f.ret_contratista)||0,
         parseFloat(ret_ss??f.ret_ss)||0, parseFloat(dif_cambio??f.dif_cambio)||0,
         parseFloat(total_cobrado??f.total_cobrado)||0,
         parseFloat(importe??f.importe)||0, moneda??f.moneda, parseFloat(tasa_cambio??f.tasa_cambio)||1,
         fecha_vencimiento??f.fecha_vencimiento, fecha_pago??f.fecha_pago??'',
         observaciones??f.observaciones, nc.id, req.params.id);
  if (f.nc_factura_id && f.nc_factura_id !== nc.id) recalcPagoFV(f.nc_factura_id);
  if (nc.id) recalcPagoFV(nc.id);
  res.json(db.prepare('SELECT * FROM facturas_venta WHERE id=?').get(req.params.id));
});

router.delete('/facturas-venta/:id', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  if (db.prepare('SELECT id FROM facturas_venta WHERE nc_factura_id=?').get(req.params.id)) {
    return res.status(400).json({ error: 'No se puede eliminar: tiene una Nota de Crédito que la anula' });
  }
  const borrada = db.prepare('SELECT nc_factura_id FROM facturas_venta WHERE id=?').get(req.params.id);
  db.prepare('DELETE FROM facturas_venta WHERE id=?').run(req.params.id);
  if (borrada?.nc_factura_id) recalcPagoFV(borrada.nc_factura_id);
  res.json({ mensaje: 'Eliminada' });
});

router.patch('/facturas-venta/:id/pago', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const { pago_confirmado, fecha_pago } = req.body;
  db.prepare("UPDATE facturas_venta SET pago_confirmado=?, fecha_pago=?, anticipo=0, fecha_anticipo='', updated_at=datetime('now','localtime') WHERE id=?")
    .run(pago_confirmado ? 1 : 0, fecha_pago||'', req.params.id);
  res.json({ ok: true });
});

router.patch('/facturas-venta/:id/reabrir', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  db.prepare("UPDATE facturas_venta SET pago_confirmado=0, fecha_pago='', updated_at=datetime('now','localtime') WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// ── Pagos de Facturas de Venta ────────────────────────────────────────────────

function recalcPagoFV(factura_id) {
  const fv = db.prepare('SELECT importe, moneda, tasa_cambio FROM facturas_venta WHERE id=?').get(factura_id);
  if (!fv) return;
  const pagado = db.prepare(
    `SELECT COALESCE(SUM(${sqlTotalPesos('importe','moneda','tasa_cambio')}+COALESCE(ret_iibb,0)+COALESCE(ret_iva,0)+COALESCE(ret_gcia,0)+COALESCE(ret_contratista,0)+COALESCE(ret_ss,0)),0) as s FROM pagos_factura_venta WHERE factura_id=? AND (estado='confirmado' OR forma_pago='e-cheq')`
  ).get(factura_id).s;
  // Ídem recalcPagoFC: una NC vinculada reduce lo que realmente se debe cobrar,
  // y sin restarla acá el flag guardado nunca reflejaba una factura saldada por
  // cobro parcial + NC (el listado sí lo hacía, mostrando saldos inconsistentes).
  // Solo se resta si YA hubo algún cobro real: una factura anulada del todo por
  // NC sin ningún cobro no es "cobrada", es "anulada" (nunca entró nada de plata).
  const totalNc = pagado > 0 ? db.prepare(`
    SELECT COALESCE(SUM(ABS(${sqlTotalPesos('importe','moneda','tasa_cambio')})),0) AS s
    FROM facturas_venta WHERE nc_factura_id=?`).get(factura_id).s : 0;
  const saldo = totalEnPesos(fv) - pagado - totalNc;
  const cobrada = saldo <= TOLERANCIA_SALDO_PESOS;
  // Quedaba "Cobrada" sin fecha_pago cuando se saldaba por pagos itemizados
  // (esta función) en vez del botón simple de "Marcar cobrada" (que sí la
  // pone) — la fecha de pago pasa a ser la del último pago real que la saldó,
  // no la de hoy, y se limpia si se reabre (se borra/edita un pago y deja de
  // estar cobrada).
  const fechaPago = cobrada
    ? db.prepare(`
        SELECT MAX(fecha) AS f FROM pagos_factura_venta
        WHERE factura_id=? AND (estado='confirmado' OR forma_pago='e-cheq')`).get(factura_id).f || ''
    : '';
  db.prepare("UPDATE facturas_venta SET pago_confirmado=?, fecha_pago=?, updated_at=datetime('now','localtime') WHERE id=?")
    .run(cobrada ? 1 : 0, fechaPago, factura_id);
}

router.get('/facturas-venta/:id/pagos', verificarToken, leerFinanzasOAdministracion, (req, res) => {
  res.json(db.prepare('SELECT * FROM pagos_factura_venta WHERE factura_id=? ORDER BY fecha ASC, id ASC').all(req.params.id));
});

router.post('/facturas-venta/:id/pagos', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const f = db.prepare('SELECT id FROM facturas_venta WHERE id=?').get(req.params.id);
  if (!f) return res.status(404).json({ error: 'Factura no encontrada' });
  const { tipo, forma_pago, entidad, importe, moneda, tasa_cambio, fecha, fecha_acreditacion, estado, observaciones,
          ret_iibb, ret_iva, ret_gcia, ret_contratista, ret_ss } = req.body;
  if (!parseFloat(importe) || parseFloat(importe) <= 0) return res.status(400).json({ error: 'Importe debe ser mayor a 0' });
  if (!fecha) return res.status(400).json({ error: 'Fecha requerida' });
  const estadoFinal = ((forma_pago === 'cheque_diferido' || forma_pago === 'e-cheq') && estado !== 'confirmado') ? 'pendiente' : (estado || 'confirmado');
  // Mismo umbral que del lado de compras — nace confirmado, no pasa por /confirmar.
  let autorizanteNuevo = null;
  if (estadoFinal === 'confirmado') {
    const r0 = resolverAutorizantePago({ importe, moneda, tasa_cambio }, req.body);
    if (!r0.ok) return res.status(400).json(r0);
    autorizanteNuevo = r0.autorizante;
  }
  const r = db.prepare(`
    INSERT INTO pagos_factura_venta
      (factura_id,tipo,forma_pago,entidad,importe,moneda,tasa_cambio,fecha,fecha_acreditacion,estado,observaciones,
       ret_iibb,ret_iva,ret_gcia,ret_contratista,ret_ss,created_by,autorizado_por_id,autorizado_por_nombre)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(req.params.id, tipo||'parcial', forma_pago||'transferencia', entidad||'',
         parseFloat(importe), moneda||'PESO', parseFloat(tasa_cambio)||1, fecha, fecha_acreditacion||'',
         estadoFinal, observaciones||'',
         parseFloat(ret_iibb)||0, parseFloat(ret_iva)||0, parseFloat(ret_gcia)||0,
         parseFloat(ret_contratista)||0, parseFloat(ret_ss)||0, req.usuario.id,
         autorizanteNuevo?.id||null, autorizanteNuevo?.nombre||null);
  recalcPagoFV(req.params.id);
  if (autorizanteNuevo) notificarAutorizantePago('venta', req.params.id, r.lastInsertRowid, autorizanteNuevo, req.usuario);
  res.status(201).json(db.prepare('SELECT * FROM pagos_factura_venta WHERE id=?').get(r.lastInsertRowid));
});

router.patch('/facturas-venta/:id/pagos/:pid', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const p = db.prepare('SELECT * FROM pagos_factura_venta WHERE id=? AND factura_id=?').get(req.params.pid, req.params.id);
  if (!p) return res.status(404).json({ error: 'Pago no encontrado' });
  let autorizante = null;
  if (req.body.estado === 'confirmado' && p.estado !== 'confirmado') {
    if (!puedeConfirmarPago(req)) return res.status(403).json({ error: 'Solo Finanzas puede confirmar un pago' });
    // Igual criterio que en facturas-compra: el umbral se evalúa contra el
    // importe/moneda que va a quedar guardado, no contra el pago viejo.
    const pNuevo = { ...p, importe: req.body.importe ?? p.importe, moneda: req.body.moneda ?? p.moneda, tasa_cambio: req.body.tasa_cambio ?? p.tasa_cambio };
    const r0 = resolverAutorizantePago(pNuevo, req.body);
    if (!r0.ok) return res.status(400).json(r0);
    autorizante = r0.autorizante;
  }
  const { tipo, forma_pago, entidad, importe, moneda, tasa_cambio, fecha, fecha_acreditacion, estado, observaciones,
          ret_iibb, ret_iva, ret_gcia, ret_contratista, ret_ss } = req.body;
  db.prepare(`UPDATE pagos_factura_venta SET
    tipo=?,forma_pago=?,entidad=?,importe=?,moneda=?,tasa_cambio=?,fecha=?,fecha_acreditacion=?,estado=?,observaciones=?,
    ret_iibb=?,ret_iva=?,ret_gcia=?,ret_contratista=?,ret_ss=?,
    autorizado_por_id=COALESCE(?,autorizado_por_id), autorizado_por_nombre=COALESCE(?,autorizado_por_nombre) WHERE id=?`)
    .run(tipo??p.tipo, forma_pago??p.forma_pago, entidad??p.entidad,
         parseFloat(importe??p.importe)||0, moneda??p.moneda, parseFloat(tasa_cambio??p.tasa_cambio)||1, fecha??p.fecha,
         fecha_acreditacion??p.fecha_acreditacion, estado??p.estado,
         observaciones??p.observaciones,
         parseFloat(ret_iibb??p.ret_iibb)||0, parseFloat(ret_iva??p.ret_iva)||0,
         parseFloat(ret_gcia??p.ret_gcia)||0, parseFloat(ret_contratista??p.ret_contratista)||0,
         parseFloat(ret_ss??p.ret_ss)||0, autorizante?.id||null, autorizante?.nombre||null, req.params.pid);
  recalcPagoFV(req.params.id);
  if (autorizante) notificarAutorizantePago('venta', req.params.id, req.params.pid, autorizante, req.usuario);
  res.json(db.prepare('SELECT * FROM pagos_factura_venta WHERE id=?').get(req.params.pid));
});

router.patch('/facturas-venta/:id/pagos/:pid/confirmar', verificarToken, (req, res) => {
  if (!puedeConfirmarPago(req)) return res.status(403).json({ error: 'Sin permisos' });
  const p = db.prepare('SELECT * FROM pagos_factura_venta WHERE id=? AND factura_id=?').get(req.params.pid, req.params.id);
  if (!p) return res.status(404).json({ error: 'Pago no encontrado' });
  let autorizante = null;
  if (p.estado !== 'confirmado') {
    const r0 = resolverAutorizantePago(p, req.body || {});
    if (!r0.ok) return res.status(400).json(r0);
    autorizante = r0.autorizante;
  }
  db.prepare(`UPDATE pagos_factura_venta SET estado='confirmado',
    autorizado_por_id=COALESCE(?,autorizado_por_id), autorizado_por_nombre=COALESCE(?,autorizado_por_nombre) WHERE id=?`)
    .run(autorizante?.id||null, autorizante?.nombre||null, req.params.pid);
  recalcPagoFV(req.params.id);
  if (autorizante) notificarAutorizantePago('venta', req.params.id, req.params.pid, autorizante, req.usuario);
  res.json(db.prepare('SELECT * FROM pagos_factura_venta WHERE id=?').get(req.params.pid));
});

router.delete('/facturas-venta/:id/pagos/:pid', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  if (!db.prepare('SELECT id FROM pagos_factura_venta WHERE id=? AND factura_id=?').get(req.params.pid, req.params.id))
    return res.status(404).json({ error: 'Pago no encontrado' });
  db.prepare('DELETE FROM pagos_factura_venta WHERE id=?').run(req.params.pid);
  recalcPagoFV(req.params.id);
  res.json({ ok: true });
});

// ── Saldo bancario ────────────────────────────────────────────────────────────

router.get('/saldo-bancario', verificarToken, leerFinanzasOAdministracion, (req, res) => {
  const { limit = 100 } = req.query;
  const rows = db.prepare(`
    SELECT sb.*, u.nombre AS usuario_nombre
    FROM saldo_bancario sb
    LEFT JOIN usuarios u ON u.id = sb.created_by
    ORDER BY sb.created_at DESC, sb.id DESC
    LIMIT ?`).all(parseInt(limit));
  res.json(rows);
});

router.post('/saldo-bancario', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const { entidad, monto, moneda } = req.body;
  if (!entidad?.trim()) return res.status(400).json({ error: 'Entidad requerida' });
  if (monto == null || isNaN(parseFloat(monto))) return res.status(400).json({ error: 'Monto requerido' });
  const r = db.prepare(`INSERT INTO saldo_bancario (entidad, monto, moneda, created_by) VALUES (?,?,?,?)`)
    .run(entidad.trim(), parseFloat(monto), moneda || 'PESO', req.usuario.id);
  const row = db.prepare(`
    SELECT sb.*, u.nombre AS usuario_nombre
    FROM saldo_bancario sb LEFT JOIN usuarios u ON u.id = sb.created_by
    WHERE sb.id=?`).get(r.lastInsertRowid);
  res.status(201).json(row);
});

router.delete('/saldo-bancario/:id', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  db.prepare('DELETE FROM saldo_bancario WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── Tipo de cambio BNA ────────────────────────────────────────────────────────

router.get('/tipo-cambio', verificarToken, leerFinanzasOAdministracion, (req, res) => {
  const rows = db.prepare(`
    SELECT tc.*, u.nombre AS usuario_nombre
    FROM tipo_cambio tc
    LEFT JOIN usuarios u ON u.id = tc.created_by
    ORDER BY tc.created_at DESC, tc.id DESC
    LIMIT 100
  `).all()
  res.json(rows)
})

router.post('/tipo-cambio', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' })
  const { moneda = 'DÓLAR', valor, fuente = 'BNA', fecha = '' } = req.body
  if (valor == null || isNaN(parseFloat(valor)) || parseFloat(valor) <= 0)
    return res.status(400).json({ error: 'Valor requerido' })
  const r = db.prepare(`INSERT INTO tipo_cambio (moneda, valor, fuente, fecha, created_by) VALUES (?,?,?,?,?)`)
    .run(moneda, parseFloat(valor), fuente, fecha, req.usuario.id)
  const row = db.prepare(`
    SELECT tc.*, u.nombre AS usuario_nombre FROM tipo_cambio tc
    LEFT JOIN usuarios u ON u.id = tc.created_by WHERE tc.id=?
  `).get(r.lastInsertRowid)
  res.status(201).json(row)
})

router.delete('/tipo-cambio/:id', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' })
  db.prepare('DELETE FROM tipo_cambio WHERE id=?').run(req.params.id)
  res.json({ ok: true })
})

// Trae del BNA la cotización "Billetes" (venta) de hoy para Dólar y Euro, y
// las carga las dos de un saque — reemplaza tener que ir a mirar la web del
// banco y tipear el número a mano. Si el banco cambió la página o no
// respondió, se avisa con claridad para que se pueda seguir cargando a mano.
router.post('/tipo-cambio/bna-hoy', verificarToken, async (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' })
  let cot
  try {
    cot = await traerCotizacionBNA()
  } catch (e) {
    return res.status(502).json({ error: `No se pudo traer la cotización del BNA (${e.message}) — probá cargarla a mano.` })
  }
  const hoy = hoyArgentina()
  const insertar = (moneda, valor) => {
    const r = db.prepare(`INSERT INTO tipo_cambio (moneda, valor, fuente, fecha, created_by) VALUES (?,?,?,?,?)`)
      .run(moneda, valor, 'BNA', hoy, req.usuario.id)
    return db.prepare(`
      SELECT tc.*, u.nombre AS usuario_nombre FROM tipo_cambio tc
      LEFT JOIN usuarios u ON u.id = tc.created_by WHERE tc.id=?
    `).get(r.lastInsertRowid)
  }
  // Las dos monedas se cargan juntas o ninguna — sin transacción, un error a
  // mitad de camino podía dejar cargado el dólar de hoy sin el euro (u otro
  // registro repetido si se reintenta a mano después).
  const { dolar, euro } = db.transaction(() => ({ dolar: insertar('DÓLAR', cot.dolar), euro: insertar('EURO', cot.euro) }))()
  res.status(201).json({ dolar, euro })
})

// ── Servicios recurrentes ─────────────────────────────────────────────────────

// Catálogo de servicios recurrentes (EDENOR, METROGAS, internet...) — para el
// selector de "Cargar pago" (elegir uno existente o cargar uno nuevo al vuelo).
// Ya no trae la cuota más reciente: eso ahora vive en /servicios-cuotas, que
// es la lista real de pagos (pendientes y pagados), sin filas fantasma.
router.get('/servicios', verificarToken, leerFinanzasOAdministracion, (req, res) => {
  const { soloActivos = '1' } = req.query;
  const filtro = soloActivos === '1' ? 'WHERE activo=1' : '';
  const rows = db.prepare(`SELECT * FROM servicios ${filtro} ORDER BY descripcion`).all();
  res.json(rows);
});

// Alta del servicio en el catálogo — ya no crea ninguna cuota en blanco acá.
// El pago (cuota real, con monto) se carga aparte con POST /servicios/:id/cuotas,
// típicamente en el mismo paso desde el selector "Cargar pago" cuando se elige
// "+ Nuevo servicio" en vez de uno ya existente.
router.post('/servicios', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const { descripcion, usuario, info_pago, periodicidad, tipo } = req.body;
  if (!descripcion?.trim()) return res.status(400).json({ error: 'Descripción requerida' });
  const r = db.prepare(`INSERT INTO servicios (descripcion,usuario,info_pago,periodicidad,tipo) VALUES (?,?,?,?,?)`)
    .run(descripcion.trim(), usuario||'', info_pago||'', periodicidad||'mensual', tipo||'otro');
  const serv = db.prepare('SELECT * FROM servicios WHERE id=?').get(r.lastInsertRowid);
  res.status(201).json(serv);
});

router.put('/servicios/:id', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const { descripcion, usuario, info_pago, periodicidad, tipo, activo } = req.body;
  db.prepare(`UPDATE servicios SET descripcion=?,usuario=?,info_pago=?,periodicidad=?,tipo=?,activo=? WHERE id=?`)
    .run(descripcion||'', usuario||'', info_pago||'', periodicidad||'mensual', tipo||'otro', activo??1, req.params.id);
  res.json(db.prepare('SELECT * FROM servicios WHERE id=?').get(req.params.id));
});

router.delete('/servicios/:id', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  db.prepare('UPDATE servicios SET activo=0 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Lista real de pagos de servicios (pendientes y pagados) — cada fila es una
// cuota real cargada a mano, nunca una fecha futura fabricada automáticamente.
// Reemplaza el viejo listado por-servicio (que solo mostraba la última cuota
// y mezclaba pendientes "sin importe" fabricadas al pagar la anterior).
router.get('/servicios-cuotas', verificarToken, leerFinanzasOAdministracion, (req, res) => {
  const { buscar, estado, periodicidad, tipo } = req.query;
  const conds = [];
  const params = [];
  if (buscar) { const b = buscarCondicion(buscar, ['s.descripcion', 's.usuario']); conds.push(b.cond); params.push(...b.params); }
  if (periodicidad) { conds.push('s.periodicidad = ?'); params.push(periodicidad); }
  if (tipo) { conds.push('s.tipo = ?'); params.push(tipo); }
  const hoy = hoyArgentina();
  if (estado === 'pendiente') conds.push("c.estado='pendiente'");
  else if (estado === 'pagado') conds.push("c.estado='pagado'");
  else if (estado === 'vencido') { conds.push("c.estado='pendiente' AND c.vencimiento!='' AND c.vencimiento<?"); params.push(hoy); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT c.*, s.descripcion, s.usuario, s.info_pago, s.periodicidad, s.tipo, s.activo AS servicio_activo,
      (SELECT c2.monto FROM servicios_cuotas c2 WHERE c2.servicio_id = c.servicio_id AND c2.id < c.id ORDER BY c2.id DESC LIMIT 1) AS monto_anterior
    FROM servicios_cuotas c
    JOIN servicios s ON s.id = c.servicio_id
    ${where}
    ORDER BY CASE c.estado WHEN 'pendiente' THEN 0 ELSE 1 END, c.vencimiento ASC, c.id DESC
  `).all(...params);
  res.json(rows);
});

// Carga un pago real (pendiente o ya pagado) para un servicio del catálogo —
// el único lugar donde nace una cuota, siempre con los datos reales que
// alguien cargó, nunca fabricada en blanco.
router.post('/servicios/:id/cuotas', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const serv = db.prepare('SELECT id FROM servicios WHERE id=?').get(req.params.id);
  if (!serv) return res.status(404).json({ error: 'Servicio no encontrado' });
  const { monto, vencimiento, pagado, fecha_pagada } = req.body;
  if (monto == null || monto === '' || isNaN(parseFloat(monto))) return res.status(400).json({ error: 'Falta el monto' });
  const esPagado = !!pagado;
  const r = db.prepare(`INSERT INTO servicios_cuotas (servicio_id, monto, vencimiento, estado, fecha_pagada) VALUES (?,?,?,?,?)`)
    .run(req.params.id, parseFloat(monto), vencimiento || '', esPagado ? 'pagado' : 'pendiente',
         esPagado ? (fecha_pagada || hoyArgentina()) : '');
  res.status(201).json(db.prepare('SELECT * FROM servicios_cuotas WHERE id=?').get(r.lastInsertRowid));
});

router.put('/servicios-cuotas/:id', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const c = db.prepare('SELECT * FROM servicios_cuotas WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Cuota no encontrada' });
  const { monto, vencimiento } = req.body;
  db.prepare('UPDATE servicios_cuotas SET monto=?,vencimiento=? WHERE id=?')
    .run(monto != null ? parseFloat(monto) : null, vencimiento??c.vencimiento, req.params.id);
  res.json(db.prepare('SELECT * FROM servicios_cuotas WHERE id=?').get(req.params.id));
});

router.delete('/servicios-cuotas/:id', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  db.prepare('DELETE FROM servicios_cuotas WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/servicios-cuotas/:id/pagar', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const c = db.prepare('SELECT * FROM servicios_cuotas WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Cuota no encontrada' });
  const { fecha_pagada } = req.body;
  const fecha = fecha_pagada || hoyArgentina();
  db.prepare(`UPDATE servicios_cuotas SET estado='pagado', fecha_pagada=? WHERE id=?`).run(fecha, req.params.id);
  res.json(db.prepare('SELECT * FROM servicios_cuotas WHERE id=?').get(req.params.id));
});

// ── Pólizas de seguro ─────────────────────────────────────────────────────────
// Catálogo separado de Servicios (número de póliza, aseguradora, vigencia),
// pero cada póliza tiene un "servicio" espejo (tipo='seguro') para que sus
// cuotas sigan viendo en la lista general de Servicios. Cada vez que llega
// la póliza (renovación) trae un plan de pago de varias cuotas mensuales —
// se cargan todas juntas de una vez, no una sola de monto estimado.
router.get('/polizas', verificarToken, leerFinanzasOAdministracion, (req, res) => {
  const { soloActivas = '1' } = req.query;
  const filtro = soloActivas === '1' ? 'WHERE p.activa=1' : '';
  const rows = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM servicios_cuotas c WHERE c.servicio_id=p.servicio_id AND c.estado='pendiente') AS cuotas_pendientes,
      (SELECT c.vencimiento FROM servicios_cuotas c WHERE c.servicio_id=p.servicio_id AND c.estado='pendiente' ORDER BY c.vencimiento ASC LIMIT 1) AS proxima_cuota_vencimiento
    FROM polizas p ${filtro} ORDER BY p.fecha_renovacion ASC, p.descripcion
  `).all();
  res.json(rows);
});

router.post('/polizas', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const { numero_poliza, aseguradora, descripcion, tipo_cobertura, fecha_inicio, fecha_renovacion, periodicidad, observaciones } = req.body;
  if (!descripcion?.trim()) return res.status(400).json({ error: 'Descripción (bien asegurado) requerida' });
  const periodicidadFinal = periodicidad || 'anual';
  const poliza = db.transaction(() => {
    const rs = db.prepare(`INSERT INTO servicios (descripcion, periodicidad, tipo) VALUES (?,?,'seguro')`)
      .run(`Póliza${numero_poliza ? ' ' + numero_poliza.trim() : ''} — ${descripcion.trim()}${aseguradora ? ' (' + aseguradora.trim() + ')' : ''}`, periodicidadFinal);
    const rp = db.prepare(`
      INSERT INTO polizas (numero_poliza, aseguradora, descripcion, tipo_cobertura, fecha_inicio, fecha_renovacion, periodicidad, observaciones, servicio_id)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(numero_poliza||'', aseguradora||'', descripcion.trim(), tipo_cobertura||'', fecha_inicio||'', fecha_renovacion||'',
           periodicidadFinal, observaciones||'', rs.lastInsertRowid);
    return db.prepare('SELECT * FROM polizas WHERE id=?').get(rp.lastInsertRowid);
  })();
  res.status(201).json(poliza);
});

router.put('/polizas/:id', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const p = db.prepare('SELECT * FROM polizas WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Póliza no encontrada' });
  const { numero_poliza, aseguradora, descripcion, tipo_cobertura, fecha_inicio, fecha_renovacion, periodicidad, observaciones, activa } = req.body;
  const numeroFinal = numero_poliza ?? p.numero_poliza;
  const aseguradoraFinal = aseguradora ?? p.aseguradora;
  const descripcionFinal = (descripcion ?? p.descripcion) || p.descripcion;
  const activaFinal = activa != null ? (activa ? 1 : 0) : p.activa;
  db.transaction(() => {
    db.prepare(`
      UPDATE polizas SET numero_poliza=?, aseguradora=?, descripcion=?, tipo_cobertura=?, fecha_inicio=?, fecha_renovacion=?,
        periodicidad=?, observaciones=?, activa=? WHERE id=?
    `).run(numeroFinal||'', aseguradoraFinal||'', descripcionFinal, tipo_cobertura??p.tipo_cobertura, fecha_inicio??p.fecha_inicio,
           fecha_renovacion??p.fecha_renovacion, periodicidad||p.periodicidad, observaciones??p.observaciones, activaFinal, p.id);
    // El servicio espejo tiene que seguir describiendo lo mismo (y activarse/
    // desactivarse junto con la póliza) para que la lista de Servicios no
    // quede desincronizada de su ficha en Pólizas.
    if (p.servicio_id) {
      db.prepare(`UPDATE servicios SET descripcion=?, periodicidad=?, activo=? WHERE id=?`)
        .run(`Póliza${numeroFinal ? ' ' + numeroFinal.trim() : ''} — ${descripcionFinal}${aseguradoraFinal ? ' (' + aseguradoraFinal.trim() + ')' : ''}`,
             periodicidad || p.periodicidad, activaFinal, p.servicio_id);
    }
  })();
  res.json(db.prepare('SELECT * FROM polizas WHERE id=?').get(p.id));
});

router.delete('/polizas/:id', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const p = db.prepare('SELECT * FROM polizas WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Póliza no encontrada' });
  db.transaction(() => {
    db.prepare('UPDATE polizas SET activa=0 WHERE id=?').run(p.id);
    if (p.servicio_id) db.prepare('UPDATE servicios SET activo=0 WHERE id=?').run(p.servicio_id);
  })();
  res.json({ ok: true });
});

// Carga de una sola vez el plan de cuotas que trae la renovación (varios
// meses, cada uno con su propio monto) en el servicio espejo de la póliza —
// cada cuota queda "pendiente" y se va marcando pagada desde Servicios a
// medida que vence, igual que cualquier otro pago recurrente. Adelanta la
// próxima renovación de la póliza según su periodicidad, una sola vez por
// carga (no una vez por cuota).
router.post('/polizas/:id/cargar-cuotas', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const p = db.prepare('SELECT * FROM polizas WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Póliza no encontrada' });
  if (!p.servicio_id) return res.status(400).json({ error: 'Esta póliza no tiene un servicio asociado' });
  const { cuotas } = req.body;
  if (!Array.isArray(cuotas) || cuotas.length === 0) return res.status(400).json({ error: 'Agregá al menos una cuota' });
  for (const c of cuotas) {
    if (c.monto == null || c.monto === '' || isNaN(parseFloat(c.monto))) return res.status(400).json({ error: 'Falta el monto de alguna cuota' });
    if (!c.vencimiento) return res.status(400).json({ error: 'Falta el vencimiento de alguna cuota' });
  }
  const insertadas = db.transaction(() => {
    const ins = db.prepare(`INSERT INTO servicios_cuotas (servicio_id, monto, vencimiento, estado) VALUES (?,?,?,'pendiente')`);
    const filas = cuotas.map(c => db.prepare('SELECT * FROM servicios_cuotas WHERE id=?').get(ins.run(p.servicio_id, parseFloat(c.monto), c.vencimiento).lastInsertRowid));
    const intervalo = MESES_POR_PERIODICIDAD[p.periodicidad] || 12;
    const anchor = p.fecha_renovacion || hoyArgentina();
    db.prepare('UPDATE polizas SET fecha_renovacion=? WHERE id=?').run(sumarMeses(anchor, intervalo), p.id);
    return filas;
  })();
  res.status(201).json(insertadas);
});

// ── Control: facturas vs OC (valores netos sin impuestos, agrupado por OC) ────
router.get('/control-oc', verificarToken, leerFinanzasOAdministracion, (req, res) => {
  // Agrupa por OC: compara la suma de netos de TODAS sus facturas contra el
  // total neto de la OC (precio_final × cantidad, convertido a pesos si aplica).
  // Tolerancia: alerta solo si la diferencia supera el 3% del neto de la OC
  // (en vez de un umbral fijo en pesos) — diferencias chicas por redondeo o
  // fluctuación normal del tipo de cambio no ameritan revisión manual.
  //
  // Cada factura puede cargarse en pesos O en la moneda original de la OC
  // (depende de cómo el proveedor emitió el comprobante) — neto_gravado NO
  // está siempre en pesos, hay que normalizarlo con la moneda/tasa_cambio de
  // CADA factura antes de sumar (mismo criterio que sqlTotalPesos).
  //
  // Tipo de cambio usado para convertir la OC a pesos, en orden de prioridad:
  //   1. tc_control_manual  — override manual cargado desde esta pantalla de control
  //   2. oc.tasa_cambio      — la cargada en la OC al crearla (mismo criterio que "Compras › OC",
  //                            para que una misma OC no muestre dos totales distintos según la pantalla)
  //   3. tipo_cambio del día — el registrado en el sistema a la fecha de la última factura (último recurso)
  const TC_DIA = `(
    SELECT tc.valor FROM tipo_cambio tc
    WHERE tc.moneda = oc.moneda AND tc.fecha <= fc_sub.fecha_ultima AND tc.fecha != ''
    ORDER BY tc.fecha DESC, tc.id DESC LIMIT 1
  )`
  const TC_USADO = `COALESCE(oc.tc_control_manual, NULLIF(oc.tasa_cambio, 0), ${TC_DIA})`
  const OC_NETO_PESOS = `
    CASE
      WHEN oc.moneda IN ('PESOS','PESO')
      THEN oc_sub.neto_orig
      ELSE oc_sub.neto_orig * COALESCE(${TC_USADO}, 1)
    END`
  // Si la OC tiene cuotas de facturación cargadas (anticipo + saldo, avances,
  // etc.), no corresponde compararla contra el total completo mientras falten
  // cuotas por facturar — eso generaría una alerta todos los días hasta que
  // llegue la última factura. En ese caso se compara solo contra lo planeado
  // para las cuotas que YA tienen una factura vinculada.
  const CUOTAS_PLANEADO_PESOS = `
    CASE
      WHEN oc.moneda IN ('PESOS','PESO')
      THEN cq_sub.planeado_orig
      ELSE cq_sub.planeado_orig * COALESCE(${TC_USADO}, 1)
    END`
  const BASE_COMPARACION = `
    CASE
      WHEN COALESCE(cq_sub.cant_cuotas_facturadas, 0) > 0 AND COALESCE(${CUOTAS_PLANEADO_PESOS}, 0) > 0
      THEN ${CUOTAS_PLANEADO_PESOS}
      ELSE ${OC_NETO_PESOS}
    END`
  const UMBRAL_PCT = 0.03
  // Los datos de antes del 01/07/2026 vienen de planillas viejas importadas al
  // migrar (ver CLAUDE.md, sección "Datos confiables") — no son confiables para
  // detectar diferencias, así que Control OC no las evalúa (sí siguen viéndose
  // en otras pantallas normales, como Seguimiento OC Compras).
  const FECHA_DATOS_CONFIABLES = '2026-07-01'
  const filas = db.prepare(`
    SELECT
      oc.id              AS oc_id,
      oc.numero          AS oc_numero,
      oc.proveedor_nombre,
      oc.moneda          AS oc_moneda,
      oc.tasa_cambio     AS oc_tc_original,
      oc.tc_control_manual AS oc_tc_manual,
      ${TC_DIA}          AS oc_tc_dia,
      ${TC_USADO}        AS oc_tc_usado,
      oc_sub.neto_orig   AS oc_neto_orig,
      CASE WHEN oc.moneda IN ('PESOS','PESO') OR ${TC_USADO} IS NOT NULL THEN 1 ELSE 0 END AS oc_tc_valido,
      ${OC_NETO_PESOS}   AS oc_neto_pesos,
      fc_sub.facturas_neto   AS facturas_neto_total,
      fc_sub.cant_facturas,
      fc_sub.facturas_lista,
      fc_sub.fecha_ultima,
      COALESCE(cq_sub.cant_cuotas, 0)           AS cant_cuotas,
      COALESCE(cq_sub.cant_cuotas_facturadas, 0) AS cant_cuotas_facturadas,
      ${BASE_COMPARACION} AS base_comparacion_pesos
    FROM ordenes_compra oc
    JOIN (
      SELECT oc_id, COALESCE(SUM(precio_final * cantidad), 0) AS neto_orig
      FROM oc_items
      GROUP BY oc_id
    ) oc_sub ON oc_sub.oc_id = oc.id
    JOIN (
      SELECT
        oc_id,
        COALESCE(SUM(${sqlTotalPesos('neto_gravado', 'moneda', 'tasa_cambio')}), 0) AS facturas_neto,
        COUNT(*)                                                AS cant_facturas,
        GROUP_CONCAT(tipo_factura || ' ' || numero, ' / ')     AS facturas_lista,
        MAX(fecha)                                              AS fecha_ultima
      FROM facturas_compra
      WHERE oc_id IS NOT NULL AND neto_gravado > 0
      GROUP BY oc_id
    ) fc_sub ON fc_sub.oc_id = oc.id
    LEFT JOIN (
      -- El monto planeado de cada cuota se toma tal cual si se cargó a mano;
      -- si no (quedó en 0 o vacío, caso típico: solo se cargó el %), se estima
      -- como pct% del neto de la OC — sin este fallback, una cuota con % pero
      -- sin monto planeado hacía caer la comparación al total completo de
      -- vuelta, mostrando error aunque el anticipo esté perfectamente facturado.
      SELECT cq.oc_id,
        COUNT(*) AS cant_cuotas,
        SUM(CASE WHEN cq.factura_id IS NOT NULL THEN 1 ELSE 0 END) AS cant_cuotas_facturadas,
        SUM(CASE WHEN cq.factura_id IS NOT NULL
          THEN COALESCE(NULLIF(NULLIF(cq.monto_planeado, ''), 0), (COALESCE(cq.pct, 0) / 100.0) * os.neto_orig)
          ELSE 0 END) AS planeado_orig
      FROM oc_compra_cuotas cq
      JOIN (SELECT oc_id, COALESCE(SUM(precio_final * cantidad), 0) AS neto_orig FROM oc_items GROUP BY oc_id) os
        ON os.oc_id = cq.oc_id
      GROUP BY cq.oc_id
    ) cq_sub ON cq_sub.oc_id = oc.id
    WHERE ${sqlFechaIso('oc.fecha')} >= ?
      AND ABS(fc_sub.facturas_neto - ${BASE_COMPARACION}) > ${BASE_COMPARACION} * ${UMBRAL_PCT}
    ORDER BY oc.numero DESC
  `).all(FECHA_DATOS_CONFIABLES);
  res.json(filas);
});

// Cargar / limpiar la tasa de cambio manual usada para reconciliar una OC puntual
router.put('/control-oc/:oc_id/tc-manual', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const oc = db.prepare('SELECT id FROM ordenes_compra WHERE id=?').get(req.params.oc_id);
  if (!oc) return res.status(404).json({ error: 'OC no encontrada' });
  const { valor } = req.body;
  const v = (valor === null || valor === '' || valor === undefined) ? null : parseFloat(valor);
  if (v != null && (isNaN(v) || v <= 0)) return res.status(400).json({ error: 'Valor inválido' });
  db.prepare('UPDATE ordenes_compra SET tc_control_manual=? WHERE id=?').run(v, req.params.oc_id);
  res.json({ ok: true });
});

// Seguimiento gerencial de OC de compras: a diferencia de /control-oc (que solo
// alerta discrepancias de facturación), esta trae TODAS las OC — sin importar
// si ya fueron recibidas o no — con su estado de recepción, de facturación y
// de pago, para que Gerencia pueda ver de un vistazo cómo viene cada una.
// Exclusiva de Finanzas (no se embebe en Administración, igual que Control OC).
router.get('/seguimiento-oc-compras', verificarToken, leerFinanzas, (req, res) => {
  const { proveedor_id, estado, buscar } = req.query;

  const conds = [];
  const params = [];
  if (proveedor_id) { conds.push('oc.proveedor_id = ?'); params.push(proveedor_id); }
  if (estado)       { conds.push('oc.estado = ?');       params.push(estado); }
  if (buscar)       { const b = buscarCondicion(buscar, ['oc.numero','oc.proveedor_nombre']); conds.push(b.cond); params.push(...b.params); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

  // Mismo criterio de tipo de cambio que /control-oc, pero con fallback a la
  // fecha de la propia OC cuando todavía no tiene ninguna factura asociada.
  const TC_DIA = `(
    SELECT tc.valor FROM tipo_cambio tc
    WHERE tc.moneda = oc.moneda AND tc.fecha <= COALESCE(fc_sub.fecha_ultima, oc.fecha) AND tc.fecha != ''
    ORDER BY tc.fecha DESC, tc.id DESC LIMIT 1
  )`
  const TC_USADO = `COALESCE(oc.tc_control_manual, NULLIF(oc.tasa_cambio, 0), ${TC_DIA})`

  const filas = db.prepare(`
    SELECT
      oc.id                AS oc_id,
      oc.numero            AS oc_numero,
      oc.proveedor_nombre,
      oc.fecha,
      oc.estado,
      oc.fecha_entrega_est,
      oc.fecha_recepcion,
      oc.moneda            AS oc_moneda,
      ${TC_USADO}          AS oc_tc_usado,
      COALESCE(oc_sub.neto_orig, 0) AS oc_neto_orig,
      CASE WHEN oc.moneda IN ('PESOS','PESO') THEN COALESCE(oc_sub.neto_orig, 0)
           ELSE COALESCE(oc_sub.neto_orig, 0) * COALESCE(${TC_USADO}, 1) END AS oc_neto_pesos,
      COALESCE(fc_sub.facturas_neto, 0) AS facturas_neto_total,
      COALESCE(fc_sub.cant_facturas, 0) AS cant_facturas,
      COALESCE(fc_sub.pagadas, 0)       AS facturas_pagadas,
      COALESCE(fc_sub.facturas_neto_pagado, 0) AS facturas_neto_pagado,
      fc_sub.fecha_ultima
    FROM ordenes_compra oc
    LEFT JOIN (
      SELECT oc_id, COALESCE(SUM(precio_final * cantidad), 0) AS neto_orig
      FROM oc_items GROUP BY oc_id
    ) oc_sub ON oc_sub.oc_id = oc.id
    LEFT JOIN (
      SELECT oc_id,
        COALESCE(SUM(${sqlTotalPesos('neto_gravado', 'moneda', 'tasa_cambio')}), 0) AS facturas_neto,
        COUNT(*)                                                    AS cant_facturas,
        SUM(CASE WHEN pago_confirmado=1 THEN 1 ELSE 0 END)          AS pagadas,
        COALESCE(SUM(CASE WHEN pago_confirmado=1 THEN ${sqlTotalPesos('neto_gravado', 'moneda', 'tasa_cambio')} ELSE 0 END), 0) AS facturas_neto_pagado,
        MAX(fecha)                                                  AS fecha_ultima
      FROM facturas_compra WHERE oc_id IS NOT NULL AND neto_gravado > 0 GROUP BY oc_id
    ) fc_sub ON fc_sub.oc_id = oc.id
    ${where}
    ORDER BY oc.id DESC
  `).all(...params);

  const hoy = hoyArgentina();
  // Los datos de antes del 01/07/2026 vienen de planillas viejas importadas
  // al migrar (ver CLAUDE.md) — se siguen listando acá (es un panorama
  // general, no hay que ocultarlas), pero no se les calcula un estado de
  // facturación/pago por comparación: esa cuenta puede dar "parcial" o
  // "pendiente" en falso contra datos de origen que no son confiables.
  const FECHA_DATOS_CONFIABLES = '2026-07-01';
  // Misma tolerancia que Control OC (3% del neto de la OC, no un monto fijo) — si
  // no, la misma OC podía figurar "completa" acá y con diferencia en Control OC.
  const datos = filas.map(r => {
    const datosConfiables = r.fecha >= FECHA_DATOS_CONFIABLES;
    const estadoFacturacion = !datosConfiables ? 'dato_legado'
      : r.cant_facturas === 0 ? 'sin_facturar'
      : (r.facturas_neto_total >= r.oc_neto_pesos * 0.97) ? 'completo' : 'parcial';
    const estadoPago = !datosConfiables ? 'dato_legado'
      : r.cant_facturas === 0 ? 'sin_facturar'
      : r.facturas_pagadas === 0 ? 'pendiente'
      : r.facturas_pagadas === r.cant_facturas ? 'pagado' : 'parcial';
    const atrasada = !!r.fecha_entrega_est && r.fecha_entrega_est < hoy && !['Recibida','Cancelada'].includes(r.estado);
    // % del neto de la OC ya facturado/pagado — igual que "% Facturado"/"%
    // Cobrado" en Seguimiento OC Ventas, pero acá se calcula directo por
    // proporción de importes (no por cuotas, que en Compras son opcionales y
    // la mayoría de las OC no las usan).
    const pctFacturado = r.oc_neto_pesos > 0 ? Math.min(100, Math.round(r.facturas_neto_total / r.oc_neto_pesos * 100)) : 0;
    const pctPagado = r.oc_neto_pesos > 0 ? Math.min(100, Math.round(r.facturas_neto_pagado / r.oc_neto_pesos * 100)) : 0;
    return { ...r, estado_facturacion: estadoFacturacion, estado_pago: estadoPago, atrasada, pct_facturado: pctFacturado, pct_pagado: pctPagado };
  }).filter(r => {
    if (req.query.estado_facturacion && r.estado_facturacion !== req.query.estado_facturacion) return false;
    if (req.query.estado_pago && r.estado_pago !== req.query.estado_pago) return false;
    return true;
  });

  res.json(datos);
});

// ── Control OC Clientes ──────────────────────────────────────────────────────

const OC_CLIENTE_SELECT = `
    SELECT f.*, c.nombre AS cli_nombre_cat, c.cuit AS cli_cuit_cat, p.codigo AS proy_codigo, p.nombre AS proy_nombre
    FROM fin_oc_clientes f
    LEFT JOIN clientes c ON c.id = f.cliente_id
    LEFT JOIN proyectos p ON p.id = f.proyecto_id`;

// Trae las cuotas de una o más OC de un solo pedido (no N+1), con los datos
// reales de la factura y del pago vinculados leídos en vivo (no copiados) —
// moneda, importe, fecha y si está cobrada vienen siempre de facturas_venta /
// pagos_factura_venta, nunca de una copia que se pueda desincronizar.
function cargarCuotas(ocClienteIds) {
  if (!ocClienteIds.length) return {};
  const placeholders = ocClienteIds.map(() => '?').join(',');
  const filas = db.prepare(`
    SELECT c.*, fv.fecha AS factura_fecha, fv.numero AS factura_numero,
           fv.importe AS factura_importe, fv.moneda AS factura_moneda,
           fv.pago_confirmado AS factura_pago_confirmado
    FROM fin_oc_cliente_cuotas c
    LEFT JOIN facturas_venta fv ON fv.id = c.factura_id
    WHERE c.oc_cliente_id IN (${placeholders})
    ORDER BY c.oc_cliente_id, c.orden
  `).all(...ocClienteIds);
  // Los pagos vinculados a cada cuota (0, 1 o varios — ej. dos e-cheques más
  // una transferencia por el total) se traen en un segundo pedido, no N+1.
  const cuotaIds = filas.map(f => f.id);
  const pagosPorCuota = {};
  if (cuotaIds.length) {
    const ph = cuotaIds.map(() => '?').join(',');
    const pagos = db.prepare(`
      SELECT cp.cuota_id, p.id, p.estado, p.forma_pago, p.entidad, p.importe, p.moneda, p.fecha, p.fecha_acreditacion
      FROM fin_oc_cliente_cuota_pagos cp
      JOIN pagos_factura_venta p ON p.id = cp.pago_id
      WHERE cp.cuota_id IN (${ph})
      ORDER BY p.fecha, p.id
    `).all(...cuotaIds);
    for (const p of pagos) (pagosPorCuota[p.cuota_id] ??= []).push(p);
  }
  for (const f of filas) f.pagos = pagosPorCuota[f.id] || [];
  const porOC = {};
  for (const f of filas) (porOC[f.oc_cliente_id] ??= []).push(f);
  return porOC;
}

// Una misma factura puede repartirse en varias cuotas de ESTA OC (caso real:
// se factura el 100% en un solo comprobante, pero el cliente lo paga en
// cuotas con distintos plazos) — lo que no puede pasar es que esa factura
// quede vinculada a cuotas de OTRA OC, eso sí sería un error de carga.
function guardarCuotas(ocClienteId, cuotas) {
  validarPctCuotas(cuotas);
  const facturasUsadas = [...new Set((cuotas || []).map(c => c.factura_id).filter(Boolean))];
  if (facturasUsadas.length) {
    const placeholders = facturasUsadas.map(() => '?').join(',');
    const conflicto = db.prepare(`
      SELECT 1 FROM fin_oc_cliente_cuotas WHERE factura_id IN (${placeholders}) AND oc_cliente_id != ? LIMIT 1
    `).get(...facturasUsadas, ocClienteId);
    if (conflicto) { const err = new Error('Factura ya vinculada a otra OC'); err.codigo = 'FACTURA_EN_USO'; throw err; }
  }
  // Un pago puntual no se comparte ni siquiera entre cuotas de la MISMA OC
  // (sería contar el mismo cobro dos veces) — a diferencia de la factura, que
  // sí puede repartirse en varias cuotas. Una cuota, en cambio, sí puede
  // tener VARIOS pagos (ej. dos e-cheques + una transferencia por el total).
  const pagosUsados = (cuotas || []).flatMap(c => c.pago_ids || []).filter(Boolean);
  if (new Set(pagosUsados).size !== pagosUsados.length) {
    const err = new Error('Pago repetido entre cuotas'); err.codigo = 'PAGO_EN_USO'; throw err;
  }
  if (pagosUsados.length) {
    const placeholders = pagosUsados.map(() => '?').join(',');
    const conflicto = db.prepare(`
      SELECT 1 FROM fin_oc_cliente_cuota_pagos cp
      JOIN fin_oc_cliente_cuotas c ON c.id = cp.cuota_id
      WHERE cp.pago_id IN (${placeholders}) AND c.oc_cliente_id != ? LIMIT 1
    `).get(...pagosUsados, ocClienteId);
    if (conflicto) { const err = new Error('Pago ya vinculado a otra cuota'); err.codigo = 'PAGO_EN_USO'; throw err; }
  }
  db.prepare('DELETE FROM fin_oc_cliente_cuotas WHERE oc_cliente_id=?').run(ocClienteId);
  const ins = db.prepare(`
    INSERT INTO fin_oc_cliente_cuotas (oc_cliente_id, orden, tipo, pct, monto_planeado, fecha_estimada, factura_id, fecha_cobro)
    VALUES (?,?,?,?,?,?,?,?)
  `);
  const insPago = db.prepare('INSERT INTO fin_oc_cliente_cuota_pagos (cuota_id, pago_id) VALUES (?,?)');
  (cuotas || []).forEach((c, i) => {
    const r = ins.run(ocClienteId, i + 1, c.tipo || 'avance', c.pct ?? null, c.monto_planeado ?? null, c.fecha_estimada || '', c.factura_id || null, c.fecha_cobro || '');
    const cuotaId = r.lastInsertRowid;
    for (const pagoId of (c.pago_ids || [])) insPago.run(cuotaId, pagoId);
  });
}

// Usado también desde Proyectos (sin permiso de finanzas) para mostrar N° de OC vinculada.
// Los montos y demás datos monetarios se ocultan si el usuario no tiene permiso de lectura en Finanzas.
const CAMPOS_MONETARIOS_OC_CLIENTE = ['monto_oc', 'anticipo_pct', 'monto_anticipo_usd', 'final_pct', 'monto_final_usd', 'observaciones', 'comentarios'];
const CAMPOS_MONETARIOS_CUOTA = ['monto_planeado', 'factura_importe', 'factura_numero'];
const CAMPOS_MONETARIOS_PAGO = ['importe', 'entidad', 'moneda'];
router.get('/oc-clientes', verificarToken, (req, res) => {
  const { buscar, proyecto_id } = req.query;
  let sql = `${OC_CLIENTE_SELECT} WHERE f.activo=1`;
  const params = [];
  if (proyecto_id) {
    sql += ' AND f.proyecto_id=?';
    params.push(proyecto_id);
  }
  if (buscar) {
    sql += ' AND (f.cliente LIKE ? OR f.numero_oc LIKE ? OR c.nombre LIKE ?)';
    params.push(`%${buscar}%`, `%${buscar}%`, `%${buscar}%`);
  }
  sql += ' ORDER BY f.id DESC';
  const rows = db.prepare(sql).all(...params);
  const cuotasPorOC = cargarCuotas(rows.map(r => r.id));
  for (const r of rows) r.cuotas = cuotasPorOC[r.id] || [];
  const puedeVerMontos = req.usuario?.rol === 'admin' || !!req.permisos?.finanzas?.leer;
  if (!puedeVerMontos) {
    for (const r of rows) {
      for (const c of CAMPOS_MONETARIOS_OC_CLIENTE) delete r[c];
      for (const cuota of r.cuotas) {
        for (const c of CAMPOS_MONETARIOS_CUOTA) delete cuota[c];
        for (const pago of cuota.pagos) for (const c of CAMPOS_MONETARIOS_PAGO) delete pago[c];
      }
    }
  }
  res.json(rows);
});

router.post('/oc-clientes', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const f = req.body;
  const trx = db.transaction(() => {
    const r = db.prepare(`
      INSERT INTO fin_oc_clientes
        (cliente_id,cliente,proyecto_id,numero_oc,monto_oc,fecha_oc,fecha_recepcion_oc,
         anticipo_pct,monto_anticipo_usd,fecha_fact_anticipo,fecha_pago_anticipo,
         numero_poliza,fecha_pedido_poliza,fecha_poliza,vigencia_poliza,fecha_entrega_doc,
         observaciones,final_pct,monto_final_usd,fecha_fact_final,
         cierre_tipo,fecha_cierre_admin,comentarios)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      f.cliente_id||null, f.cliente||'', f.proyecto_id||null,
      f.numero_oc||'', f.monto_oc||null, f.fecha_oc||'', f.fecha_recepcion_oc||'',
      f.anticipo_pct||null, f.monto_anticipo_usd||null, f.fecha_fact_anticipo||'', f.fecha_pago_anticipo||'',
      f.numero_poliza||'', f.fecha_pedido_poliza||'', f.fecha_poliza||'', f.vigencia_poliza||'', f.fecha_entrega_doc||'',
      f.observaciones||'', f.final_pct||null, f.monto_final_usd||null, f.fecha_fact_final||'',
      f.cierre_tipo||'', f.fecha_cierre_admin||'', f.comentarios||''
    );
    guardarCuotas(r.lastInsertRowid, f.cuotas);
    return r.lastInsertRowid;
  });
  let id;
  try { id = trx(); }
  catch (e) {
    if (e.codigo === 'FACTURA_EN_USO') return res.status(409).json({ error: 'Una de las facturas ya está vinculada a otra OC de cliente' });
    if (e.codigo === 'PAGO_EN_USO') return res.status(409).json({ error: 'Uno de los pagos ya está vinculado a otra cuota' });
    if (e.codigo === 'CUOTAS_PCT_INVALIDO') return res.status(400).json({ error: e.message });
    throw e;
  }
  const row = db.prepare(`${OC_CLIENTE_SELECT} WHERE f.id=?`).get(id);
  row.cuotas = cargarCuotas([id])[id] || [];
  res.status(201).json(row);
});

router.put('/oc-clientes/:id', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const f = req.body;
  const trx = db.transaction(() => {
    db.prepare(`
      UPDATE fin_oc_clientes SET
        cliente_id=?,cliente=?,proyecto_id=?,numero_oc=?,monto_oc=?,fecha_oc=?,fecha_recepcion_oc=?,
        anticipo_pct=?,monto_anticipo_usd=?,fecha_fact_anticipo=?,fecha_pago_anticipo=?,
        numero_poliza=?,fecha_pedido_poliza=?,fecha_poliza=?,vigencia_poliza=?,fecha_entrega_doc=?,
        observaciones=?,final_pct=?,monto_final_usd=?,fecha_fact_final=?,
        cierre_tipo=?,fecha_cierre_admin=?,comentarios=?,
        updated_at=datetime('now','localtime')
      WHERE id=? AND activo=1
    `).run(
      f.cliente_id||null, f.cliente||'', f.proyecto_id||null,
      f.numero_oc||'', f.monto_oc||null, f.fecha_oc||'', f.fecha_recepcion_oc||'',
      f.anticipo_pct||null, f.monto_anticipo_usd||null, f.fecha_fact_anticipo||'', f.fecha_pago_anticipo||'',
      f.numero_poliza||'', f.fecha_pedido_poliza||'', f.fecha_poliza||'', f.vigencia_poliza||'', f.fecha_entrega_doc||'',
      f.observaciones||'', f.final_pct||null, f.monto_final_usd||null, f.fecha_fact_final||'',
      f.cierre_tipo||'', f.fecha_cierre_admin||'', f.comentarios||'',
      req.params.id
    );
    guardarCuotas(req.params.id, f.cuotas);
  });
  try { trx(); }
  catch (e) {
    if (e.codigo === 'FACTURA_EN_USO') return res.status(409).json({ error: 'Una de las facturas ya está vinculada a otra OC de cliente' });
    if (e.codigo === 'PAGO_EN_USO') return res.status(409).json({ error: 'Uno de los pagos ya está vinculado a otra cuota' });
    if (e.codigo === 'CUOTAS_PCT_INVALIDO') return res.status(400).json({ error: e.message });
    throw e;
  }
  const row = db.prepare(`${OC_CLIENTE_SELECT} WHERE f.id=?`).get(req.params.id);
  row.cuotas = cargarCuotas([Number(req.params.id)])[req.params.id] || [];
  res.json(row);
});

router.delete('/oc-clientes/:id', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  db.prepare('UPDATE fin_oc_clientes SET activo=0 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Vincula (o desvincula, factura_id=null) una cuota puntual a una factura de
// venta real ya cargada — reemplaza el viejo "Usar como Anticipo/Final" que
// solo copiaba fecha/monto sin dejar ningún vínculo. Varias cuotas de la
// MISMA OC pueden compartir la misma factura (se facturó el 100% en un solo
// comprobante, pero el cliente lo paga en cuotas) — lo que se rechaza es que
// la use una cuota de OTRA OC.
router.patch('/oc-clientes/:ocId/cuotas/:cuotaId/vincular-factura', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const cuota = db.prepare('SELECT id FROM fin_oc_cliente_cuotas WHERE id=? AND oc_cliente_id=?').get(req.params.cuotaId, req.params.ocId);
  if (!cuota) return res.status(404).json({ error: 'Cuota no encontrada' });
  const { factura_id } = req.body;
  if (factura_id) {
    const enUso = db.prepare('SELECT id FROM fin_oc_cliente_cuotas WHERE factura_id=? AND oc_cliente_id!=?').get(factura_id, req.params.ocId);
    if (enUso) return res.status(409).json({ error: 'Esa factura ya está vinculada a otra OC de cliente' });
  }
  db.prepare('UPDATE fin_oc_cliente_cuotas SET factura_id=? WHERE id=?').run(factura_id || null, req.params.cuotaId);
  res.json({ ok: true });
});

// Agrega un PAGO real ya registrado en el modal de Pagos de la factura
// vinculada a esta cuota — una cuota puede tener VARIOS pagos (ej. se cobró
// con dos e-cheques y una transferencia por el total). Un pago puntual, a
// diferencia de la factura, NO se comparte ni siquiera entre cuotas de la
// MISMA OC — es un movimiento de dinero único, se rechaza si ya está tomado
// por cualquier otra cuota (de esta OC o de otra).
router.post('/oc-clientes/:ocId/cuotas/:cuotaId/pagos', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const cuota = db.prepare('SELECT id, factura_id FROM fin_oc_cliente_cuotas WHERE id=? AND oc_cliente_id=?').get(req.params.cuotaId, req.params.ocId);
  if (!cuota) return res.status(404).json({ error: 'Cuota no encontrada' });
  const { pago_id } = req.body;
  if (!pago_id) return res.status(400).json({ error: 'Falta indicar el pago' });
  const pago = db.prepare('SELECT id FROM pagos_factura_venta WHERE id=? AND factura_id=?').get(pago_id, cuota.factura_id);
  if (!pago) return res.status(400).json({ error: 'Ese pago no pertenece a la factura vinculada a esta cuota' });
  const enUso = db.prepare('SELECT id FROM fin_oc_cliente_cuota_pagos WHERE pago_id=?').get(pago_id);
  if (enUso) return res.status(409).json({ error: 'Ese pago ya está vinculado a otra cuota' });
  db.prepare('INSERT INTO fin_oc_cliente_cuota_pagos (cuota_id, pago_id) VALUES (?,?)').run(cuota.id, pago_id);
  res.status(201).json({ ok: true });
});

router.delete('/oc-clientes/:ocId/cuotas/:cuotaId/pagos/:pagoId', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const cuota = db.prepare('SELECT id FROM fin_oc_cliente_cuotas WHERE id=? AND oc_cliente_id=?').get(req.params.cuotaId, req.params.ocId);
  if (!cuota) return res.status(404).json({ error: 'Cuota no encontrada' });
  db.prepare('DELETE FROM fin_oc_cliente_cuota_pagos WHERE cuota_id=? AND pago_id=?').run(cuota.id, req.params.pagoId);
  res.json({ ok: true });
});

// Marca (o quita) la fecha de cobro de una cuota puntual a mano — alternativa
// para cuando el cobro no tiene un pago puntual cargado en el sistema (ej.
// efectivo sin registrar). Si la cuota ya tiene un pago vinculado, ese pago
// manda sobre esta fecha manual.
router.patch('/oc-clientes/:ocId/cuotas/:cuotaId/cobro', verificarToken, (req, res) => {
  if (!puedeEscribir(req)) return res.status(403).json({ error: 'Sin permisos' });
  const cuota = db.prepare('SELECT id FROM fin_oc_cliente_cuotas WHERE id=? AND oc_cliente_id=?').get(req.params.cuotaId, req.params.ocId);
  if (!cuota) return res.status(404).json({ error: 'Cuota no encontrada' });
  db.prepare('UPDATE fin_oc_cliente_cuotas SET fecha_cobro=? WHERE id=?').run(req.body.fecha_cobro || '', req.params.cuotaId);
  res.json({ ok: true });
});

module.exports = router;
module.exports.recalcPagoFC = recalcPagoFC;
module.exports.recalcPagoFV = recalcPagoFV;
module.exports.calcularDashboardFinanzas = calcularDashboardFinanzas;
module.exports.obtenerDashboardDiario = obtenerDashboardDiario;
