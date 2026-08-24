// Áreas de trabajo — mismo vocabulario que agrupa las categorías de RRHH
// (ver rrhh_categorias.grupo en backend/db/database.js), reutilizado para
// "área responsable" en las tareas de Proyectos.
export const AREAS = [
  { grupo: 'Granallado',              color: '#6c757d' },
  { grupo: 'Mano de obra Herreria',   color: '#795548' },
  { grupo: 'Terminaciones y Montaje', color: '#dc3545' },
  { grupo: 'Electrico',               color: '#0d6efd' },
  { grupo: 'Infraestructura',         color: '#198754' },
  { grupo: 'Ingenieria',              color: '#6f42c1' },
  { grupo: 'General',                 color: '#20c997' },
]

export const COLOR_AREA = Object.fromEntries(AREAS.map(a => [a.grupo, a.color]))
