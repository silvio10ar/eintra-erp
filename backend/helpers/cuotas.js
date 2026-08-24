'use strict';

// Si el % de las cuotas de facturación de una OC no suma 100, la base de
// comparación de Control OC (y el % facturado/cobrado que se muestra en
// Seguimiento OC Ventas) queda sesgada — mejor cortar acá que dejar guardar
// una OC con cuotas inconsistentes entre sí. Solo evalúa las cuotas que
// efectivamente cargan un %; si una OC mezcla cuotas por % y por monto fijo,
// no se le exige a esas últimas participar de la suma.
function validarPctCuotas(cuotas) {
  const conPct = (cuotas || []).filter(c => c.pct != null && c.pct !== '');
  if (!conPct.length) return;
  const suma = conPct.reduce((s, c) => s + (parseFloat(c.pct) || 0), 0);
  if (Math.abs(suma - 100) > 0.5) {
    const err = new Error(`Las cuotas suman ${suma}%, deberían sumar 100%`);
    err.codigo = 'CUOTAS_PCT_INVALIDO';
    throw err;
  }
}

module.exports = { validarPctCuotas };
