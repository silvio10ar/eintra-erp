// Identificador estable para una fila de ítem editable (OC, presupuesto,
// ingreso Form49...). Usar el índice del array como `key` de React se rompe
// en cuanto se borra una fila del medio: React reutiliza los inputs por
// posición en vez de por fila real, y el contenido de una fila termina
// apareciendo en otra. Con esto, cada fila conserva su identidad propia
// incluso después de agregar/quitar otras.
let contador = 0
export const nextItemKey = () => `item_${++contador}_${Math.random().toString(36).slice(2, 8)}`
