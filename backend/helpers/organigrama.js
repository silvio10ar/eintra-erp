'use strict';

// La raíz real de un organigrama es el puesto sin padre con más descendientes,
// no "el primero sin padre" — una instalación nueva trae puestos de
// demostración ya cargados (Comprador, Gerente de Ventas, etc.), todos sin
// reporta_a_id y sin nadie debajo, que no hay que confundir con el CEO real.
function encontrarRaiz(puestos) {
  function contarDescendientes(id) {
    let total = 0;
    const pila = [id];
    while (pila.length) {
      const actual = pila.pop();
      for (const p of puestos) if (p.reporta_a_id === actual) { total++; pila.push(p.id); }
    }
    return total;
  }
  return puestos.filter(p => !p.reporta_a_id)
    .map(p => ({ ...p, _descendientes: contarDescendientes(p.id) }))
    .sort((a, b) => b._descendientes - a._descendientes || a.id - b.id)[0];
}

// Quién puede figurar como "autorizante" de una acción sensible (retiro de
// stock, confirmación de un pago grande, etc.): el rol admin, o quien ocupe
// un puesto de gerencia (la raíz del organigrama, o alguno de sus "Gerente
// de X" directos) — mismo criterio en todos lados donde el sistema pide
// elegir quién autoriza algo.
// El nombre a mostrar/guardar es siempre el de RRHH (rrhh_empleados.nombre),
// no el "nombre" de la cuenta de usuario — pueden ser distintos (cuentas
// genéricas tipo "Administrador"), y lo que tiene que quedar identificable
// para el resto del equipo es la persona real, no el login.
function obtenerAutorizantes() {
  // Requerido acá adentro (no arriba del archivo) para no crear una
  // dependencia circular: db/database.js también requiere este helper
  // (encontrarRaiz) durante su propia inicialización.
  const { db } = require('../db/database');
  const admins = db.prepare(`
    SELECT u.id, COALESCE(e.nombre, u.nombre) AS nombre
    FROM usuarios u LEFT JOIN rrhh_empleados e ON e.id = u.rrhh_empleado_id
    WHERE u.activo=1 AND u.rol='admin'
  `).all();
  const puestos = db.prepare('SELECT id, nombre, area, reporta_a_id, gerente_autorizante FROM puestos').all();
  const raiz = encontrarRaiz(puestos);
  const porId = new Map(admins.map(u => [u.id, u]));
  // gerente_autorizante=0 saca a un puesto de este universo aunque reporte
  // directo a la raíz (ej. Auditoría de Calidad) — reportar al CEO no es lo
  // mismo que ser gerencia real a los fines de autorizar algo.
  const esGerenteAutorizante = p => p.gerente_autorizante !== 0;
  if (raiz && esGerenteAutorizante(raiz)) {
    const puestosGerencia = [raiz.id, ...puestos.filter(p => p.reporta_a_id === raiz.id && esGerenteAutorizante(p)).map(p => p.id)];
    const ph = puestosGerencia.map(() => '?').join(',');
    const gerentes = db.prepare(`
      SELECT DISTINCT u.id, COALESCE(e.nombre, u.nombre) AS nombre
      FROM usuarios u
      JOIN usuario_puestos up ON up.usuario_id = u.id
      LEFT JOIN rrhh_empleados e ON e.id = u.rrhh_empleado_id
      WHERE u.activo=1 AND up.puesto_id IN (${ph})
    `).all(...puestosGerencia);
    for (const u of gerentes) porId.set(u.id, u);
  }
  return [...porId.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
}

module.exports = { encontrarRaiz, obtenerAutorizantes };
