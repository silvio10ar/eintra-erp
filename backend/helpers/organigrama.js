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

module.exports = { encontrarRaiz };
